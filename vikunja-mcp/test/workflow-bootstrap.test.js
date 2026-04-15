import test from "node:test";
import assert from "node:assert/strict";

import {
  ensureWorkflowBuckets,
  ensureWorkflowView,
  normalizeWorkflowTemplate
} from "../src/workflow-bootstrap.js";

function createTemplate() {
  return normalizeWorkflowTemplate({
    view: {
      title: "Workflow",
      viewKind: "kanban",
      bucketConfigurationMode: "manual"
    },
    labels: [],
    buckets: [
      { title: "Inbox", limit: 0, position: 100 },
      { title: "Clarifying", limit: 0, position: 200 },
      { title: "ReadyForDev", limit: 0, position: 300 },
      { title: "InDev", limit: 0, position: 400 },
      { title: "InReview", limit: 0, position: 500 },
      { title: "ReadyForOwner", limit: 0, position: 600 },
      { title: "Done", limit: 0, position: 700 }
    ]
  });
}

class FakeClient {
  constructor({ views = [], buckets = [], tasks = [] } = {}) {
    this.views = views.map((view) => ({ ...view }));
    this.buckets = buckets.map((bucket) => ({ ...bucket }));
    this.tasks = tasks.map((task) => ({ ...task }));
    this.createdViews = [];
    this.updatedViews = [];
    this.createdBuckets = [];
    this.updatedBuckets = [];
    this.deletedBuckets = [];
    this.movedTasks = [];
    this.nextViewId = 1000;
    this.nextBucketId = 2000;
  }

  async listProjectViews() {
    return this.views.map((view) => ({ ...view }));
  }

  async createProjectView(projectId, view) {
    const created = {
      id: this.nextViewId++,
      project_id: projectId,
      title: view.title,
      view_kind: view.view_kind,
      bucket_configuration_mode: view.bucket_configuration_mode
    };
    this.views.push(created);
    this.createdViews.push(created);
    return { ...created };
  }

  async updateProjectView(projectId, viewId, view) {
    const index = this.views.findIndex((item) => item.id === viewId);
    assert.notEqual(index, -1);
    const updated = {
      ...this.views[index],
      ...view,
      id: viewId,
      project_id: projectId
    };
    this.views[index] = updated;
    this.updatedViews.push(updated);
    return { ...updated };
  }

  async listProjectBuckets(projectId, viewId) {
    return this.buckets
      .filter((bucket) => bucket.project_id === projectId && bucket.project_view_id === viewId)
      .map((bucket) => ({ ...bucket }));
  }

  async createBucket(projectId, viewId, bucket) {
    const created = {
      id: this.nextBucketId++,
      project_id: projectId,
      project_view_id: viewId,
      title: bucket.title,
      limit: bucket.limit,
      position: bucket.position,
      count: 0
    };
    this.buckets.push(created);
    this.createdBuckets.push(created);
    return { ...created };
  }

  async updateBucket(projectId, viewId, bucketId, bucket) {
    const index = this.buckets.findIndex((item) => item.id === bucketId);
    assert.notEqual(index, -1);
    const updated = {
      ...this.buckets[index],
      ...bucket,
      id: bucketId,
      project_id: projectId,
      project_view_id: viewId
    };
    this.buckets[index] = updated;
    this.updatedBuckets.push(updated);
    return { ...updated };
  }

  async deleteBucket(projectId, viewId, bucketId) {
    this.buckets = this.buckets.filter(
      (bucket) => !(bucket.project_id === projectId && bucket.project_view_id === viewId && bucket.id === bucketId)
    );
    this.deletedBuckets.push(bucketId);
    return { message: "deleted" };
  }

  async listProjectTasks(projectId) {
    return this.tasks
      .filter((task) => task.project_id === projectId)
      .map((task) => ({ ...task }));
  }

  async moveTaskToBucket(projectId, viewId, bucketId, payload) {
    const task = this.tasks.find((item) => item.id === payload.task_id);
    assert.ok(task);
    task.project_id = projectId;
    task.project_view_id = viewId;
    task.bucket_id = bucketId;
    this.movedTasks.push({ taskId: payload.task_id, bucketId, position: payload.position ?? null });
    return { success: true };
  }
}

test("normalizeWorkflowTemplate defaults the workflow view title", () => {
  const template = normalizeWorkflowTemplate({
    view: { viewKind: "kanban", bucketConfigurationMode: "manual" },
    labels: [],
    buckets: []
  });

  assert.equal(template.view.title, "Workflow");
});

test("ensureWorkflowView reuses the default Kanban view", async () => {
  const template = createTemplate();
  const client = new FakeClient({
    views: [
      { id: 5, project_id: 2, title: "List", view_kind: "list", bucket_configuration_mode: "none" },
      { id: 8, project_id: 2, title: "Kanban", view_kind: "kanban", bucket_configuration_mode: "manual" }
    ]
  });

  const result = await ensureWorkflowView({
    client,
    projectId: 2,
    template
  });

  assert.equal(result.status, "updated");
  assert.equal(result.view.id, 8);
  assert.equal(result.view.title, "Workflow");
  assert.equal(client.createdViews.length, 0);
  assert.equal(client.updatedViews.length, 1);
});

test("ensureWorkflowBuckets repurposes the default kanban buckets", async () => {
  const template = createTemplate();
  const client = new FakeClient({
    buckets: [
      { id: 4, project_id: 2, project_view_id: 8, title: "To-Do", limit: 0, position: 100, count: 0 },
      { id: 5, project_id: 2, project_view_id: 8, title: "Doing", limit: 0, position: 200, count: 0 },
      { id: 6, project_id: 2, project_view_id: 8, title: "Done", limit: 0, position: 300, count: 0 }
    ]
  });

  const results = await ensureWorkflowBuckets({
    client,
    projectId: 2,
    viewId: 8,
    template
  });

  const titles = client.buckets
    .filter((bucket) => bucket.project_view_id === 8)
    .map((bucket) => bucket.title)
    .sort();

  assert.deepEqual(titles, [
    "Clarifying",
    "Done",
    "InDev",
    "InReview",
    "Inbox",
    "ReadyForDev",
    "ReadyForOwner"
  ]);
  assert.equal(client.createdBuckets.length, 4);
  assert.equal(
    results.filter((item) => item.status === "retitled").length,
    2
  );
});

test("ensureWorkflowBuckets removes legacy duplicates without dropping tasks", async () => {
  const template = createTemplate();
  const client = new FakeClient({
    buckets: [
      { id: 7, project_id: 2, project_view_id: 9, title: "To-Do", limit: 0, position: 100, count: 1 },
      { id: 10, project_id: 2, project_view_id: 9, title: "Inbox", limit: 0, position: 100, count: 0 },
      { id: 8, project_id: 2, project_view_id: 9, title: "Doing", limit: 0, position: 200, count: 1 },
      { id: 11, project_id: 2, project_view_id: 9, title: "Clarifying", limit: 0, position: 200, count: 0 },
      { id: 12, project_id: 2, project_view_id: 9, title: "ReadyForDev", limit: 0, position: 300, count: 0 },
      { id: 13, project_id: 2, project_view_id: 9, title: "InDev", limit: 0, position: 400, count: 0 },
      { id: 14, project_id: 2, project_view_id: 9, title: "InReview", limit: 0, position: 500, count: 0 },
      { id: 15, project_id: 2, project_view_id: 9, title: "ReadyForOwner", limit: 0, position: 600, count: 0 },
      { id: 9, project_id: 2, project_view_id: 9, title: "Done", limit: 0, position: 700, count: 0 }
    ],
    tasks: [
      { id: 101, project_id: 2, project_view_id: 9, bucket_id: 7, position: 123 },
      { id: 102, project_id: 2, project_view_id: 9, bucket_id: 8, position: 456 }
    ]
  });

  const results = await ensureWorkflowBuckets({
    client,
    projectId: 2,
    viewId: 9,
    template
  });

  assert.equal(results.filter((item) => item.status === "deleted-legacy").length, 2);
  assert.deepEqual(client.deletedBuckets.sort((left, right) => left - right), [7, 8]);
  assert.deepEqual(client.movedTasks, [
    { taskId: 101, bucketId: 10, position: 123 },
    { taskId: 102, bucketId: 13, position: 456 }
  ]);
  assert.deepEqual(
    client.tasks.map((task) => task.bucket_id).sort((left, right) => left - right),
    [10, 13]
  );
});
