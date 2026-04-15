import crypto from "node:crypto";

import { normalizeLabel, normalizeProject, normalizeTask } from "./task-utils.js";

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export class SyncService {
  constructor({ config, client, store, logger }) {
    this.config = config;
    this.client = client;
    this.store = store;
    this.logger = logger;
    this.pollTimer = null;
  }

  async start() {
    await this.syncProjects("startup");
    await this.pollAllProjects("startup");
    await this.ensureConfiguredWebhooks();
    this.pollTimer = setInterval(() => {
      this.pollAllProjects("interval").catch((error) => {
        this.logger.error("poll failed", { error: error.message });
      });
    }, this.config.pollIntervalMs);
  }

  async stop() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  resolveTrackedProjectIds(projects) {
    if (this.config.vikunjaProjectIds.length) {
      return this.config.vikunjaProjectIds;
    }

    return projects.map((project) => project.id);
  }

  async syncProjects(reason) {
    const projects = await this.client.listProjects();
    const normalized = projects.map((project) => normalizeProject(project));
    const trackedIds = this.resolveTrackedProjectIds(normalized);
    const filtered = normalized.filter((project) => trackedIds.includes(project.id));

    await this.store.upsertProjects(filtered, `projects:${reason}`);
    return filtered;
  }

  async refreshProject(projectId, source = "refresh") {
    const project = await this.client.getProject(projectId);
    const normalized = normalizeProject(project);
    await this.store.upsertProjects([normalized], source);
    return normalized;
  }

  async refreshLabels(search = "", source = "labels:refresh") {
    const labels = (await this.client.listLabels(search)).map((label) => normalizeLabel(label));
    await this.store.upsertLabels(labels, source);
    return labels;
  }

  async refreshLabel(labelId, source = "label:refresh") {
    const label = normalizeLabel(await this.client.getLabel(labelId));
    await this.store.upsertLabels([label], source);
    return label;
  }

  async refreshTaskLabels(taskId, source = "task-labels:refresh") {
    const labels = (await this.client.listTaskLabels(taskId)).map((label) => normalizeLabel(label));
    await this.store.upsertLabels(labels, source);
    return labels;
  }

  async pollAllProjects(reason) {
    const projects = await this.syncProjects(reason);
    const trackedIds = this.resolveTrackedProjectIds(projects);

    for (const projectId of trackedIds) {
      const tasks = await this.client.listProjectTasks(projectId);
      for (const task of tasks) {
        await this.store.upsertTask(normalizeTask(task), `poll:${reason}`);
      }
      await this.store.markProjectPoll(projectId);
    }

    await this.store.recordEvent("poll", {
      reason,
      projectIds: trackedIds
    });
    await this.store.markPoll();
  }

  async refreshTask(taskId, source = "refresh") {
    const task = await this.client.getTask(taskId);
    const normalized = normalizeTask(task);
    await this.store.upsertTask(normalized, source);
    return normalized;
  }

  async refreshComments(taskId) {
    const comments = await this.client.listTaskComments(taskId);
    await this.store.setComments(taskId, comments);
    return comments;
  }

  async ensureConfiguredWebhooks(projectIds = undefined) {
    if (!this.config.publicWebhookBaseUrl) {
      return [];
    }

    const targetUrl = `${this.config.publicWebhookBaseUrl.replace(/\/+$/, "")}/webhooks/vikunja`;
    const results = [];
    const resolvedProjectIds = Array.isArray(projectIds) && projectIds.length
      ? projectIds
      : this.resolveTrackedProjectIds(await this.syncProjects("webhook-ensure"));

    for (const projectId of resolvedProjectIds) {
      const existing = await this.client.listProjectWebhooks(projectId);
      const alreadyPresent = existing.some((item) => item.target_url === targetUrl || item.targetUrl === targetUrl);

      if (alreadyPresent) {
        results.push({ projectId, status: "exists" });
        continue;
      }

      await this.client.createProjectWebhook(projectId, {
        target_url: targetUrl,
        events: ["task.created", "task.updated", "task.deleted"],
        secret: this.config.webhookSecret || undefined
      });

      results.push({ projectId, status: "created" });
    }

    if (results.length) {
      await this.store.recordEvent("webhook.ensure", { results, targetUrl });
    }

    return results;
  }

  verifyWebhookSignature(rawBody, signature) {
    if (!this.config.webhookSecret) {
      return true;
    }

    const digest = crypto
      .createHmac("sha256", this.config.webhookSecret)
      .update(rawBody)
      .digest("hex");

    const left = Buffer.from(digest);
    const right = Buffer.from(signature || "");
    if (left.length !== right.length) {
      return false;
    }

    return crypto.timingSafeEqual(left, right);
  }

  async handleWebhook(rawBody, signature) {
    if (this.config.webhookSecret && !this.verifyWebhookSignature(rawBody, signature)) {
      throw new Error("invalid webhook signature");
    }

    const payload = safeJsonParse(rawBody);
    if (!payload) {
      throw new Error("invalid webhook json payload");
    }

    const taskId = payload?.data?.task?.id;
    const projectId = payload?.data?.task?.project_id ?? payload?.data?.task?.projectId ?? null;
    if (taskId) {
      await this.refreshTask(taskId, `webhook:${payload.event_name}`);
    }
    if (projectId) {
      await this.store.markProjectWebhook(projectId);
    }

    await this.store.recordEvent("webhook", {
      eventName: payload.event_name,
      taskId: taskId ?? null,
      projectId
    });
    await this.store.markWebhook();

    return payload;
  }
}
