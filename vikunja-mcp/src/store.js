import fs from "node:fs/promises";
import path from "node:path";

export class Store {
  constructor({ stateFile, taskCacheLimit, logger }) {
    this.stateFile = stateFile;
    this.taskCacheLimit = taskCacheLimit;
    this.logger = logger;
    this.state = {
      projects: {},
      labels: {},
      tasks: {},
      comments: {},
      events: [],
      sync: {
        lastPollAt: null,
        lastWebhookAt: null,
        projects: {}
      }
    };
  }

  async load() {
    await fs.mkdir(path.dirname(this.stateFile), { recursive: true });

    try {
      const raw = await fs.readFile(this.stateFile, "utf8");
      const parsed = JSON.parse(raw);
      this.state = {
        projects: {},
        labels: {},
        tasks: {},
        comments: {},
        events: [],
        sync: {
          lastPollAt: null,
          lastWebhookAt: null,
          projects: {}
        },
        ...parsed,
        sync: {
          lastPollAt: null,
          lastWebhookAt: null,
          projects: {},
          ...(parsed.sync ?? {})
        }
      };
    } catch (error) {
      if (error.code !== "ENOENT") {
        this.logger.warn("failed to load persisted state", { error: error.message });
      }
      await this.save();
    }
  }

  async save() {
    await fs.mkdir(path.dirname(this.stateFile), { recursive: true });
    await fs.writeFile(this.stateFile, JSON.stringify(this.state, null, 2));
  }

  async upsertTask(task, source = "unknown") {
    this.state.tasks[String(task.id)] = {
      ...task,
      _syncedFrom: source,
      _syncedAt: new Date().toISOString()
    };
    await this.save();
  }

  async upsertProjects(projects, source = "unknown") {
    for (const project of projects) {
      this.state.projects[String(project.id)] = {
        ...project,
        _syncedFrom: source,
        _syncedAt: new Date().toISOString()
      };
    }
    await this.save();
  }

  async upsertLabels(labels, source = "unknown") {
    for (const label of labels) {
      this.state.labels[String(label.id)] = {
        ...label,
        _syncedFrom: source,
        _syncedAt: new Date().toISOString()
      };
    }
    await this.save();
  }

  async removeProject(projectId) {
    delete this.state.projects[String(projectId)];
    await this.save();
  }

  async removeLabel(labelId) {
    delete this.state.labels[String(labelId)];
    await this.save();
  }

  async setComments(taskId, comments) {
    this.state.comments[String(taskId)] = comments;
    await this.save();
  }

  getProject(projectId) {
    return this.state.projects[String(projectId)] ?? null;
  }

  getLabel(labelId) {
    return this.state.labels[String(labelId)] ?? null;
  }

  getTask(taskId) {
    return this.state.tasks[String(taskId)] ?? null;
  }

  listProjects({ projectIds, search = "", includeArchived = false } = {}) {
    const projectIdSet = Array.isArray(projectIds) && projectIds.length
      ? new Set(projectIds)
      : null;
    const needle = search.trim().toLowerCase();

    return Object.values(this.state.projects)
      .filter((project) => (projectIdSet ? projectIdSet.has(project.id) : true))
      .filter((project) => (includeArchived ? true : !project.isArchived))
      .filter((project) => {
        if (!needle) {
          return true;
        }
        return `${project.title}\n${project.description}`.toLowerCase().includes(needle);
      })
      .sort((left, right) => left.title.localeCompare(right.title));
  }

  listLabels({ labelIds, search = "" } = {}) {
    const labelIdSet = Array.isArray(labelIds) && labelIds.length ? new Set(labelIds) : null;
    const needle = search.trim().toLowerCase();

    return Object.values(this.state.labels)
      .filter((label) => (labelIdSet ? labelIdSet.has(label.id) : true))
      .filter((label) => {
        if (!needle) {
          return true;
        }
        return `${label.title}\n${label.description}`.toLowerCase().includes(needle);
      })
      .sort((left, right) => left.title.localeCompare(right.title));
  }

  listTasks({ projectId, projectIds, includeCompleted = false, limit = 20, search = "" } = {}) {
    const needle = search.trim().toLowerCase();
    const projectIdSet = Array.isArray(projectIds) && projectIds.length
      ? new Set(projectIds)
      : null;
    const tasks = Object.values(this.state.tasks)
      .filter((task) => {
        if (projectId) {
          return task.projectId === projectId;
        }
        if (projectIdSet) {
          return projectIdSet.has(task.projectId);
        }
        return true;
      })
      .filter((task) => (includeCompleted ? true : !task.done))
      .filter((task) => {
        if (!needle) {
          return true;
        }
        return `${task.title}\n${task.description}`.toLowerCase().includes(needle);
      })
      .sort((left, right) => {
        const l = new Date(left.updated || left.created || 0).getTime();
        const r = new Date(right.updated || right.created || 0).getTime();
        return r - l;
      });

    return tasks.slice(0, Math.min(limit, this.taskCacheLimit));
  }

  getComments(taskId) {
    return this.state.comments[String(taskId)] ?? [];
  }

  async recordEvent(type, payload) {
    this.state.events.unshift({
      type,
      payload,
      at: new Date().toISOString()
    });
    this.state.events = this.state.events.slice(0, this.taskCacheLimit);
    await this.save();
  }

  async markPoll() {
    this.state.sync.lastPollAt = new Date().toISOString();
    await this.save();
  }

  async markProjectPoll(projectId) {
    this.state.sync.projects[String(projectId)] = {
      ...(this.state.sync.projects[String(projectId)] ?? {}),
      lastPollAt: new Date().toISOString()
    };
    await this.save();
  }

  async markWebhook() {
    this.state.sync.lastWebhookAt = new Date().toISOString();
    await this.save();
  }

  async markProjectWebhook(projectId) {
    this.state.sync.projects[String(projectId)] = {
      ...(this.state.sync.projects[String(projectId)] ?? {}),
      lastWebhookAt: new Date().toISOString()
    };
    await this.save();
  }
}
