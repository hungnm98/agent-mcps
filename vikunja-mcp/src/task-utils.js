export function normalizeTask(task) {
  const labels = Array.isArray(task.labels)
    ? task.labels
        .map((label) => ({
          id: label.id,
          title: label.title || label.name || String(label.id)
        }))
        .filter((label) => label.title)
    : [];

  return {
    id: task.id,
    projectId: task.project_id ?? task.projectId ?? null,
    projectViewId: task.project_view_id ?? task.projectViewId ?? null,
    bucketId: task.bucket_id ?? task.bucketId ?? null,
    bucketTitle: task.bucket?.title ?? task.bucket_title ?? task.bucketTitle ?? null,
    title: task.title ?? "",
    description: task.description ?? "",
    done: Boolean(task.done),
    priority: task.priority ?? 0,
    position: task.position ?? null,
    percentDone: task.percent_done ?? task.percentDone ?? null,
    dueDate: task.due_date ?? task.dueDate ?? null,
    created: task.created ?? null,
    updated: task.updated ?? null,
    labels,
    raw: task
  };
}

export function normalizeProject(project) {
  return {
    id: project.id,
    title: project.title ?? "",
    description: project.description ?? "",
    isArchived: Boolean(project.is_archived ?? project.isArchived),
    created: project.created ?? null,
    updated: project.updated ?? null,
    raw: project
  };
}

export function normalizeLabel(label) {
  return {
    id: label.id,
    title: label.title ?? "",
    description: label.description ?? "",
    hexColor: label.hex_color ?? label.hexColor ?? "",
    created: label.created ?? null,
    updated: label.updated ?? null,
    raw: label
  };
}

export function normalizeProjectView(view) {
  return {
    id: view.id,
    projectId: view.project_id ?? view.projectId ?? null,
    title: view.title ?? "",
    viewKind: view.view_kind ?? view.viewKind ?? "",
    bucketConfigurationMode: view.bucket_configuration_mode ?? view.bucketConfigurationMode ?? "",
    created: view.created ?? null,
    updated: view.updated ?? null,
    raw: view
  };
}

export function normalizeBucket(bucket) {
  return {
    id: bucket.id,
    projectId: bucket.project_id ?? bucket.projectId ?? null,
    projectViewId: bucket.project_view_id ?? bucket.projectViewId ?? null,
    title: bucket.title ?? "",
    limit: bucket.limit ?? 0,
    position: bucket.position ?? null,
    count: bucket.count ?? (Array.isArray(bucket.tasks) ? bucket.tasks.length : null),
    created: bucket.created ?? null,
    updated: bucket.updated ?? null,
    raw: bucket
  };
}

export function renderTaskSummary(task) {
  const labels = task.labels?.map((label) => label.title).join(", ") || "-";
  return [
    `#${task.id} ${task.title}`,
    `project: ${task.projectId ?? "-"}`,
    `bucket: ${task.bucketTitle ?? task.bucketId ?? "-"}`,
    `done: ${task.done ? "yes" : "no"}`,
    `priority: ${task.priority ?? 0}`,
    `labels: ${labels}`,
    `updated: ${task.updated ?? "-"}`
  ].join("\n");
}

export function renderProjectSummary(project) {
  return [
    `#${project.id} ${project.title}`,
    `archived: ${project.isArchived ? "yes" : "no"}`,
    `updated: ${project.updated ?? "-"}`
  ].join("\n");
}

export function renderLabelSummary(label) {
  return [
    `#${label.id} ${label.title}`,
    `color: ${label.hexColor || "-"}`,
    `updated: ${label.updated ?? "-"}`
  ].join("\n");
}

export function renderProjectViewSummary(view) {
  return [
    `#${view.id} ${view.title}`,
    `project: ${view.projectId ?? "-"}`,
    `kind: ${view.viewKind || "-"}`,
    `bucket_mode: ${view.bucketConfigurationMode || "-"}`,
    `updated: ${view.updated ?? "-"}`
  ].join("\n");
}

export function renderBucketSummary(bucket) {
  return [
    `#${bucket.id} ${bucket.title}`,
    `project_view: ${bucket.projectViewId ?? "-"}`,
    `limit: ${bucket.limit ?? 0}`,
    `position: ${bucket.position ?? "-"}`,
    `count: ${bucket.count ?? "-"}`,
    `updated: ${bucket.updated ?? "-"}`
  ].join("\n");
}

export function formatArtifactComment({ title, body, kind = "artifact" }) {
  return [
    `[OpenClaw] ${kind}: ${title}`,
    "",
    "```text",
    body.trim(),
    "```"
  ].join("\n");
}

export function formatExecutionProposal({
  summary,
  workingDirectory,
  commands,
  risk,
  nextStep
}) {
  const lines = [
    "[OpenClaw] execution proposal",
    "",
    `summary: ${summary}`
  ];

  if (workingDirectory) {
    lines.push(`working_directory: ${workingDirectory}`);
  }

  if (risk) {
    lines.push(`risk: ${risk}`);
  }

  if (Array.isArray(commands) && commands.length) {
    lines.push("", "commands:");
    for (const command of commands) {
      lines.push(`- ${command}`);
    }
  }

  if (nextStep) {
    lines.push("", `next_step: ${nextStep}`);
  }

  return lines.join("\n");
}
