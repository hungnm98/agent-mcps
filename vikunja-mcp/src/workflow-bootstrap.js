import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  normalizeBucket,
  normalizeLabel,
  normalizeProjectView
} from "./task-utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DEFAULT_WORKFLOW_TEMPLATE_PATH = path.resolve(__dirname, "../config/workflow-defaults.json");
const DEFAULT_WORKFLOW_VIEW_TITLE = "Workflow";
const LEGACY_WORKFLOW_VIEW_TITLES = ["OpenClaw Workflow", "Kanban"];
const WORKFLOW_BUCKET_ALIASES = new Map([
  ["inbox", ["to-do", "todo", "to do"]],
  ["indev", ["doing"]]
]);

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeTemplateLabel(label) {
  return {
    title: clean(label?.title),
    description: clean(label?.description),
    hexColor: clean(label?.hexColor)
  };
}

function normalizeTemplateBucket(bucket, index) {
  return {
    title: clean(bucket?.title),
    limit: Number.isFinite(bucket?.limit) ? bucket.limit : 0,
    position: Number.isFinite(bucket?.position) ? bucket.position : (index + 1) * 100
  };
}

export function normalizeWorkflowTemplate(template) {
  const labels = Array.isArray(template?.labels)
    ? template.labels
        .map((label) => normalizeTemplateLabel(label))
        .filter((label) => label.title)
    : [];
  const buckets = Array.isArray(template?.buckets)
    ? template.buckets
        .map((bucket, index) => normalizeTemplateBucket(bucket, index))
        .filter((bucket) => bucket.title)
    : [];

  return {
    view: {
      title: clean(template?.view?.title) || DEFAULT_WORKFLOW_VIEW_TITLE,
      viewKind: clean(template?.view?.viewKind) || "kanban",
      bucketConfigurationMode: clean(template?.view?.bucketConfigurationMode) || "manual"
    },
    labels,
    buckets
  };
}

export async function loadWorkflowTemplate(templatePath = DEFAULT_WORKFLOW_TEMPLATE_PATH) {
  const raw = await fs.readFile(templatePath, "utf8");
  return normalizeWorkflowTemplate(JSON.parse(raw));
}

function isSameText(left, right) {
  return String(left || "").trim().toLowerCase() === String(right || "").trim().toLowerCase();
}

function labelNeedsUpdate(current, desired) {
  return (
    clean(current.description) !== desired.description ||
    clean(current.hex_color ?? current.hexColor) !== desired.hexColor
  );
}

function bucketNeedsUpdate(current, desired) {
  return (
    clean(current.title) !== desired.title ||
    Number(current.limit ?? 0) !== Number(desired.limit ?? 0) ||
    Number(current.position ?? 0) !== Number(desired.position ?? 0)
  );
}

function viewNeedsUpdate(current, desiredTitle, template) {
  return (
    clean(current.title) !== desiredTitle ||
    clean(current.viewKind) !== template.view.viewKind ||
    clean(current.bucketConfigurationMode) !== template.view.bucketConfigurationMode
  );
}

function isWorkflowViewShapeMatch(view, template) {
  return (
    clean(view.viewKind) === template.view.viewKind &&
    clean(view.bucketConfigurationMode) === template.view.bucketConfigurationMode
  );
}

function findWorkflowViewCandidate(views, desiredTitle, template) {
  const exact = views.find((view) => isSameText(view.title, desiredTitle));
  if (exact) {
    return exact;
  }

  const legacy = views.find((view) =>
    LEGACY_WORKFLOW_VIEW_TITLES.some((title) => isSameText(view.title, title)) &&
    isWorkflowViewShapeMatch(view, template)
  );
  if (legacy) {
    return legacy;
  }

  const compatibleViews = views.filter((view) => isWorkflowViewShapeMatch(view, template));
  if (compatibleViews.length === 1) {
    return compatibleViews[0];
  }

  return null;
}

function getBucketAliases(desiredTitle) {
  return WORKFLOW_BUCKET_ALIASES.get(clean(desiredTitle).toLowerCase()) ?? [];
}

function findBucketMatch(existing, matchedBucketIds, desired) {
  const exact = existing.find((bucket) =>
    !matchedBucketIds.has(bucket.id) && isSameText(bucket.title, desired.title)
  );
  if (exact) {
    return exact;
  }

  const aliases = getBucketAliases(desired.title);
  if (!aliases.length) {
    return null;
  }

  return existing.find((bucket) =>
    !matchedBucketIds.has(bucket.id) &&
    aliases.some((alias) => isSameText(bucket.title, alias))
  ) ?? null;
}

function getLegacyBucketDestinationTitle(bucketTitle) {
  const normalizedTitle = clean(bucketTitle).toLowerCase();

  for (const [destinationTitle, aliases] of WORKFLOW_BUCKET_ALIASES.entries()) {
    if (aliases.some((alias) => alias === normalizedTitle)) {
      return destinationTitle;
    }
  }

  return "";
}

async function cleanupLegacyWorkflowBuckets({
  client,
  projectId,
  viewId,
  existingBuckets,
  matchedBucketIds,
  ensuredBuckets
}) {
  const ensuredByTitle = new Map(
    ensuredBuckets.map((bucket) => [clean(bucket.title).toLowerCase(), bucket])
  );
  const cleanupCandidates = existingBuckets.filter((bucket) => {
    if (matchedBucketIds.has(bucket.id)) {
      return false;
    }

    const destinationTitle = getLegacyBucketDestinationTitle(bucket.title);
    if (!destinationTitle) {
      return false;
    }

    return ensuredByTitle.has(destinationTitle);
  });

  if (!cleanupCandidates.length) {
    return [];
  }

  let projectTasks = null;
  const results = [];

  for (const bucket of cleanupCandidates) {
    const destinationTitle = getLegacyBucketDestinationTitle(bucket.title);
    const destination = ensuredByTitle.get(destinationTitle);
    if (!destination || destination.id === bucket.id) {
      continue;
    }

    if (Number(bucket.count ?? 0) > 0) {
      projectTasks ??= await client.listProjectTasks(projectId);
      const tasksToMove = projectTasks.filter(
        (task) => Number(task.bucket_id ?? task.bucketId ?? 0) === bucket.id
      );

      for (const task of tasksToMove) {
        const position = Number(task.position);
        await client.moveTaskToBucket(projectId, viewId, destination.id, {
          task_id: task.id,
          ...(Number.isFinite(position) ? { position } : {})
        });
      }
    }

    await client.deleteBucket(projectId, viewId, bucket.id);
    results.push({ status: "deleted-legacy", bucket });
  }

  return results;
}

export async function ensureWorkflowView({
  client,
  projectId,
  viewId,
  viewTitle,
  template
}) {
  const views = (await client.listProjectViews(projectId)).map((view) => normalizeProjectView(view));

  if (viewId !== undefined && viewId !== null) {
    const view = views.find((item) => item.id === viewId);
    if (!view) {
      throw new Error(`view #${viewId} was not found in project #${projectId}`);
    }

    if (!viewNeedsUpdate(view, clean(viewTitle) || template.view.title, template)) {
      return { view, status: "exists", views };
    }

    const updated = normalizeProjectView(await client.updateProjectView(projectId, view.id, {
      ...view.raw,
      title: clean(viewTitle) || template.view.title,
      view_kind: template.view.viewKind,
      bucket_configuration_mode: template.view.bucketConfigurationMode
    }));
    return { view: updated, status: "updated", views };
  }

  const desiredTitle = clean(viewTitle) || template.view.title;
  const existing = findWorkflowViewCandidate(views, desiredTitle, template);
  if (existing) {
    if (!viewNeedsUpdate(existing, desiredTitle, template)) {
      return { view: existing, status: "exists", views };
    }

    const updated = normalizeProjectView(await client.updateProjectView(projectId, existing.id, {
      ...existing.raw,
      title: desiredTitle,
      view_kind: template.view.viewKind,
      bucket_configuration_mode: template.view.bucketConfigurationMode
    }));
    return { view: updated, status: "updated", views };
  }

  const created = normalizeProjectView(await client.createProjectView(projectId, {
    title: desiredTitle,
    view_kind: template.view.viewKind,
    bucket_configuration_mode: template.view.bucketConfigurationMode
  }));

  return {
    view: created,
    status: "created",
    views: [...views, created]
  };
}

export async function ensureWorkflowLabels({ client, template }) {
  const existing = await client.listLabels();
  const byTitle = new Map(
    existing.map((label) => [clean(label.title).toLowerCase(), label])
  );
  const results = [];

  for (const desired of template.labels) {
    const key = desired.title.toLowerCase();
    const current = byTitle.get(key);

    if (!current) {
      const created = await client.createLabel({
        title: desired.title,
        description: desired.description,
        hex_color: desired.hexColor
      });
      const label = normalizeLabel(created);
      byTitle.set(key, created);
      results.push({ status: "created", label });
      continue;
    }

    if (labelNeedsUpdate(current, desired)) {
      const updated = await client.updateLabel(current.id, {
        ...current,
        title: desired.title,
        description: desired.description,
        hex_color: desired.hexColor
      });
      results.push({ status: "updated", label: normalizeLabel(updated) });
      continue;
    }

    results.push({ status: "exists", label: normalizeLabel(current) });
  }

  return results;
}

export async function ensureWorkflowBuckets({
  client,
  projectId,
  viewId,
  template
}) {
  const existing = (await client.listProjectBuckets(projectId, viewId)).map((bucket) => normalizeBucket(bucket));
  const matchedBucketIds = new Set();
  const results = [];
  const ensuredBuckets = [];

  for (const desired of template.buckets) {
    const current = findBucketMatch(existing, matchedBucketIds, desired);

    if (!current) {
      const created = await client.createBucket(projectId, viewId, {
        title: desired.title,
        limit: desired.limit,
        position: desired.position
      });
      const bucket = normalizeBucket(created);
      matchedBucketIds.add(bucket.id);
      ensuredBuckets.push(bucket);
      results.push({ status: "created", bucket });
      continue;
    }

    matchedBucketIds.add(current.id);
    if (bucketNeedsUpdate(current, desired)) {
      const updated = await client.updateBucket(projectId, viewId, current.id, {
        ...current.raw,
        title: desired.title,
        limit: desired.limit,
        position: desired.position
      });
      const bucket = normalizeBucket(updated);
      ensuredBuckets.push(bucket);
      results.push({
        status: isSameText(current.title, desired.title) ? "updated" : "retitled",
        bucket
      });
      continue;
    }

    ensuredBuckets.push(current);
    results.push({ status: "exists", bucket: current });
  }

  const cleanupResults = await cleanupLegacyWorkflowBuckets({
    client,
    projectId,
    viewId,
    existingBuckets: existing,
    matchedBucketIds,
    ensuredBuckets
  });

  return [...results, ...cleanupResults];
}

export function formatWorkflowInitSummary({
  templatePath = DEFAULT_WORKFLOW_TEMPLATE_PATH,
  view,
  viewStatus,
  labelResults,
  bucketResults
}) {
  const lines = [
    `workflow template: ${templatePath}`,
    `view: ${view.title} (#${view.id}) status=${viewStatus}`
  ];

  if (labelResults.length) {
    lines.push("", "labels:");
    for (const item of labelResults) {
      lines.push(`- ${item.status}: ${item.label.title} (#${item.label.id})`);
    }
  }

  if (bucketResults.length) {
    lines.push("", "buckets:");
    for (const item of bucketResults) {
      lines.push(`- ${item.status}: ${item.bucket.title} (#${item.bucket.id})`);
    }
  }

  return lines.join("\n");
}
