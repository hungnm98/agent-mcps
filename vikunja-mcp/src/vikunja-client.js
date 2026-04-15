function joinUrl(baseUrl, pathname, query = {}) {
  const normalizedPath = String(pathname || "").replace(/^\/+/, "");
  const url = new URL(normalizedPath, `${baseUrl.replace(/\/+$/, "")}/`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

function parseResponseBody(text) {
  const trimmed = text.trim();
  if (!trimmed) {
    return text;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return text;
  }
}

export class VikunjaClient {
  constructor({ baseUrl, apiToken, basicAuthHeader = "" }) {
    this.baseUrl = baseUrl;
    this.apiToken = apiToken;
    this.basicAuthHeader = basicAuthHeader;
  }

  async request(pathname, { method = "GET", body, query } = {}) {
    const authorization = this.basicAuthHeader
      || (this.apiToken ? `Bearer ${this.apiToken}` : "");
    const response = await fetch(joinUrl(this.baseUrl, pathname, query), {
      method,
      headers: {
        ...(authorization ? { Authorization: authorization } : {}),
        ...(body ? { "Content-Type": "application/json" } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`vikunja ${method} ${pathname} failed: ${response.status} ${text}`);
    }

    if (response.status === 204) {
      return null;
    }

    const text = await response.text();
    const data = parseResponseBody(text);

    return { data, headers: response.headers };
  }

  async listProjectTasks(projectId) {
    let page = 1;
    let totalPages = 1;
    const tasks = [];

    while (page <= totalPages) {
      const response = await this.request(`/projects/${projectId}/tasks`, {
        query: { page }
      });
      tasks.push(...response.data);
      totalPages = Number.parseInt(response.headers.get("x-pagination-total-pages") || "1", 10);
      page += 1;
    }

    return tasks;
  }

  async listLabels(search = "") {
    let page = 1;
    let totalPages = 1;
    const labels = [];

    while (page <= totalPages) {
      const response = await this.request("/labels", {
        query: { page, per_page: 100, ...(search ? { s: search } : {}) }
      });
      labels.push(...response.data);
      totalPages = Number.parseInt(response.headers.get("x-pagination-total-pages") || "1", 10);
      page += 1;
    }

    return labels;
  }

  async getLabel(labelId) {
    const response = await this.request(`/labels/${labelId}`);
    return response.data;
  }

  async createLabel(label) {
    const response = await this.request("/labels", {
      method: "PUT",
      body: label
    });
    return response.data;
  }

  async updateLabel(labelId, label) {
    const response = await this.request(`/labels/${labelId}`, {
      method: "POST",
      body: label
    });
    return response.data;
  }

  async deleteLabel(labelId) {
    const response = await this.request(`/labels/${labelId}`, {
      method: "DELETE"
    });
    return response?.data ?? null;
  }

  async listProjects() {
    let page = 1;
    let totalPages = 1;
    const projects = [];

    while (page <= totalPages) {
      const response = await this.request("/projects", {
        query: { page, per_page: 100 }
      });
      projects.push(...response.data);
      totalPages = Number.parseInt(response.headers.get("x-pagination-total-pages") || "1", 10);
      page += 1;
    }

    return projects;
  }

  async getProject(projectId) {
    const response = await this.request(`/projects/${projectId}`);
    return response.data;
  }

  async listProjectViews(projectId) {
    const response = await this.request(`/projects/${projectId}/views`);
    return response.data;
  }

  async createProjectView(projectId, view) {
    const response = await this.request(`/projects/${projectId}/views`, {
      method: "PUT",
      body: view
    });
    return response.data;
  }

  async updateProjectView(projectId, viewId, view) {
    const response = await this.request(`/projects/${projectId}/views/${viewId}`, {
      method: "POST",
      body: view
    });
    return response.data;
  }

  async deleteProjectView(projectId, viewId) {
    const response = await this.request(`/projects/${projectId}/views/${viewId}`, {
      method: "DELETE"
    });
    return response?.data ?? null;
  }

  async createProject(project) {
    const response = await this.request("/projects", {
      method: "PUT",
      body: project
    });
    return response.data;
  }

  async updateProject(projectId, project) {
    const response = await this.request(`/projects/${projectId}`, {
      method: "POST",
      body: project
    });
    return response.data;
  }

  async deleteProject(projectId) {
    const response = await this.request(`/projects/${projectId}`, {
      method: "DELETE"
    });
    return response?.data ?? null;
  }

  async getTask(taskId) {
    const response = await this.request(`/tasks/${taskId}`);
    return response.data;
  }

  async listProjectBuckets(projectId, viewId) {
    const response = await this.request(`/projects/${projectId}/views/${viewId}/buckets`);
    return response.data;
  }

  async createBucket(projectId, viewId, bucket) {
    const response = await this.request(`/projects/${projectId}/views/${viewId}/buckets`, {
      method: "PUT",
      body: bucket
    });
    return response.data;
  }

  async updateBucket(projectId, viewId, bucketId, bucket) {
    const response = await this.request(`/projects/${projectId}/views/${viewId}/buckets/${bucketId}`, {
      method: "POST",
      body: bucket
    });
    return response.data;
  }

  async deleteBucket(projectId, viewId, bucketId) {
    const response = await this.request(`/projects/${projectId}/views/${viewId}/buckets/${bucketId}`, {
      method: "DELETE"
    });
    return response?.data ?? null;
  }

  async createTask(projectId, task) {
    const response = await this.request(`/projects/${projectId}/tasks`, {
      method: "PUT",
      body: task
    });
    return response.data;
  }

  async updateTask(taskId, task) {
    const response = await this.request(`/tasks/${taskId}`, {
      method: "POST",
      body: task
    });
    return response.data;
  }

  async moveTaskToBucket(projectId, viewId, bucketId, taskBucket) {
    const response = await this.request(`/projects/${projectId}/views/${viewId}/buckets/${bucketId}/tasks`, {
      method: "POST",
      body: taskBucket
    });
    return response.data;
  }

  async listTaskComments(taskId) {
    const response = await this.request(`/tasks/${taskId}/comments`);
    return response.data;
  }

  async createTaskComment(taskId, comment) {
    const response = await this.request(`/tasks/${taskId}/comments`, {
      method: "PUT",
      body: { comment }
    });
    return response.data;
  }

  async listTaskLabels(taskId) {
    const response = await this.request(`/tasks/${taskId}/labels`, {
      query: { per_page: 100 }
    });
    return response.data;
  }

  async addTaskLabel(taskId, labelId) {
    const response = await this.request(`/tasks/${taskId}/labels`, {
      method: "PUT",
      body: { label_id: labelId }
    });
    return response.data;
  }

  async removeTaskLabel(taskId, labelId) {
    const response = await this.request(`/tasks/${taskId}/labels/${labelId}`, {
      method: "DELETE"
    });
    return response?.data ?? null;
  }

  async listProjectWebhooks(projectId) {
    const response = await this.request(`/projects/${projectId}/webhooks`);
    return response.data;
  }

  async createProjectWebhook(projectId, webhook) {
    const response = await this.request(`/projects/${projectId}/webhooks`, {
      method: "PUT",
      body: webhook
    });
    return response.data;
  }

  async updateProjectWebhook(projectId, webhookId, webhook) {
    const response = await this.request(`/projects/${projectId}/webhooks/${webhookId}`, {
      method: "POST",
      body: webhook
    });
    return response.data;
  }

  async deleteProjectWebhook(projectId, webhookId) {
    const response = await this.request(`/projects/${projectId}/webhooks/${webhookId}`, {
      method: "DELETE"
    });
    return response?.data ?? null;
  }
}
