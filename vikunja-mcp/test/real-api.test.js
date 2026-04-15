import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createMcpServer } from "../src/mcp-server.js";
import { Store } from "../src/store.js";
import { SyncService } from "../src/sync-service.js";
import { VikunjaClient } from "../src/vikunja-client.js";
import {
  ensureWorkflowBuckets,
  ensureWorkflowLabels,
  ensureWorkflowView,
  formatWorkflowInitSummary
} from "../src/workflow-bootstrap.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REAL_ENV_PATH = path.resolve(__dirname, "../../.env");

const EXPECTED_TOOL_NAMES = [
  "labels_list",
  "label_get",
  "label_create",
  "label_update",
  "label_delete",
  "projects_list",
  "project_get",
  "project_create",
  "project_update",
  "project_delete",
  "project_views_list",
  "project_view_create",
  "project_tasks_list",
  "buckets_list",
  "bucket_create",
  "bucket_update",
  "bucket_delete",
  "task_labels_list",
  "task_label_add",
  "task_label_remove",
  "tasks_list",
  "task_get",
  "task_create",
  "task_update_status",
  "task_add_comment",
  "task_attach_artifact",
  "task_suggest_execution",
  "task_mark_blocked",
  "task_move_bucket",
  "task_sync_now",
  "project_webhooks_sync",
  "project_webhooks_list",
  "project_webhook_create",
  "project_webhook_update",
  "project_webhook_delete"
].sort();

function parseEnvFile(raw) {
  const values = {};

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    values[key] = value;
  }

  return values;
}

async function loadRealEnv() {
  const raw = await fs.readFile(REAL_ENV_PATH, "utf8");
  return parseEnvFile(raw);
}

function toApiBaseUrl(value) {
  const trimmed = String(value || "").trim();
  const normalized = trimmed.endsWith("/api/v1") ? trimmed : `${trimmed.replace(/\/+$/, "")}/api/v1`;
  return normalized.replace(/\/+$/, "");
}

function createTestConfig(env, dataDir, overrides = {}) {
  return {
    port: 0,
    serverName: "vikunja-tasks-real-api-test",
    dataDir,
    vikunjaApiBaseUrl: toApiBaseUrl(env.VIKUNJA_BASE_URL),
    vikunjaApiToken: String(env.VIKUNJA_API_TOKEN || "").trim(),
    vikunjaProjectIds: [],
    pollIntervalMs: 60_000,
    taskCacheLimit: 200,
    publicWebhookBaseUrl: "",
    webhookSecret: "",
    stateFile: path.join(dataDir, "state.json"),
    ...overrides
  };
}

function createSilentLogger() {
  return {
    info() {},
    warn() {},
    error() {}
  };
}

function resultText(result) {
  return result.content?.find((item) => item.type === "text")?.text ?? "";
}

function resultData(result) {
  return result.structuredContent ?? {};
}

function commentBodies(comments) {
  return comments.map((comment) => comment.comment ?? comment.comment_text ?? comment.text ?? "");
}

async function callTool(client, name, args = {}) {
  const result = await client.callTool({
    name,
    arguments: args
  });

  assert.notEqual(result.isError, true, `tool ${name} failed: ${resultText(result)}`);
  return result;
}

async function cleanupByPrefix(client, prefix) {
  let projects = [];
  try {
    projects = await client.listProjects();
  } catch {
    projects = [];
  }

  for (const project of projects.filter((item) => String(item.title || "").startsWith(prefix)).sort((a, b) => b.id - a.id)) {
    try {
      await client.deleteProject(project.id);
    } catch {
      // Best-effort cleanup.
    }
  }

  let labels = [];
  try {
    labels = await client.listLabels(prefix);
  } catch {
    labels = [];
  }

  for (const label of labels.filter((item) => String(item.title || "").startsWith(prefix)).sort((a, b) => b.id - a.id)) {
    try {
      await client.deleteLabel(label.id);
    } catch {
      // Best-effort cleanup.
    }
  }
}

async function createConnectedMcpClient(server) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({
    name: "vikunja-real-api-test-client",
    version: "0.1.0"
  });

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport)
  ]);

  return {
    client,
    async close() {
      await Promise.allSettled([
        client.close?.(),
        server.close(),
        clientTransport.close(),
        serverTransport.close()
      ]);
    }
  };
}

test("covers the real Vikunja-backed MCP API and cleans up created resources", async (t) => {
  const env = await loadRealEnv();
  assert.ok(env.VIKUNJA_BASE_URL, `Missing VIKUNJA_BASE_URL in ${REAL_ENV_PATH}`);
  assert.ok(env.VIKUNJA_API_TOKEN, `Missing VIKUNJA_API_TOKEN in ${REAL_ENV_PATH}`);

  const runId = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const prefix = `openclaw-real-api-test-${runId}`;
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "vikunja-mcp-real-api-"));
  const config = createTestConfig(env, dataDir, {
    publicWebhookBaseUrl: `https://example.com/${prefix}`,
    webhookSecret: `${prefix}-secret`
  });

  const directClient = new VikunjaClient({
    baseUrl: config.vikunjaApiBaseUrl,
    apiToken: config.vikunjaApiToken
  });

  const logger = createSilentLogger();
  const store = new Store({
    stateFile: config.stateFile,
    taskCacheLimit: config.taskCacheLimit,
    logger
  });
  await store.load();

  const syncService = new SyncService({
    config,
    client: directClient,
    store,
    logger
  });
  const server = createMcpServer({
    config,
    client: directClient,
    store,
    syncService
  });
  const { client: mcpClient, close } = await createConnectedMcpClient(server);

  let primaryProjectId = null;
  let primaryViewId = null;
  let primaryBucketId = null;
  let primaryLabelId = null;
  let primaryTaskId = null;

  try {
    await cleanupByPrefix(directClient, "openclaw-real-api-test-");

    await t.test("registers every documented MCP tool", async () => {
      const listed = await mcpClient.listTools();
      const actualNames = listed.tools.map((tool) => tool.name).sort();
      assert.deepEqual(actualNames, EXPECTED_TOOL_NAMES);
    });

    await t.test("runs the label lifecycle against the real API", async () => {
      const createResult = await callTool(mcpClient, "label_create", {
        title: `${prefix}-label-primary`,
        description: "primary label for real API integration test",
        hexColor: "3366ff"
      });
      primaryLabelId = resultData(createResult).label.id;
      assert.ok(primaryLabelId);

      const getResult = await callTool(mcpClient, "label_get", {
        labelId: primaryLabelId
      });
      assert.equal(resultData(getResult).label.id, primaryLabelId);

      const updateResult = await callTool(mcpClient, "label_update", {
        labelId: primaryLabelId,
        title: `${prefix}-label-primary-updated`,
        description: "updated primary label",
        hexColor: "00aa55"
      });
      assert.equal(resultData(updateResult).label.title, `${prefix}-label-primary-updated`);
      assert.equal(resultData(updateResult).label.hexColor, "00aa55");

      const listResult = await callTool(mcpClient, "labels_list", {
        search: prefix,
        refresh: true
      });
      assert.ok(resultData(listResult).labels.some((label) => label.id === primaryLabelId));

      const deleteCandidate = await callTool(mcpClient, "label_create", {
        title: `${prefix}-label-delete`,
        description: "label that should be removed by the test",
        hexColor: "ff6633"
      });
      const deleteLabelId = resultData(deleteCandidate).label.id;

      await callTool(mcpClient, "label_delete", {
        labelId: deleteLabelId
      });

      const refreshedList = await callTool(mcpClient, "labels_list", {
        search: `${prefix}-label-delete`,
        refresh: true
      });
      assert.equal(
        refreshedList.structuredContent.labels.some((label) => label.id === deleteLabelId),
        false
      );
    });

    await t.test("runs the project lifecycle against the real API", async () => {
      const createResult = await callTool(mcpClient, "project_create", {
        title: `${prefix}-project-primary`,
        description: "primary project for real API integration test"
      });
      primaryProjectId = resultData(createResult).project.id;
      assert.ok(primaryProjectId);

      config.vikunjaProjectIds = [primaryProjectId];
      await syncService.syncProjects("test-bootstrap");

      const getResult = await callTool(mcpClient, "project_get", {
        projectId: primaryProjectId
      });
      assert.equal(resultData(getResult).project.id, primaryProjectId);

      const updateResult = await callTool(mcpClient, "project_update", {
        projectId: primaryProjectId,
        title: `${prefix}-project-primary-updated`,
        description: "updated primary project description"
      });
      assert.equal(resultData(updateResult).project.title, `${prefix}-project-primary-updated`);

      const listResult = await callTool(mcpClient, "projects_list", {
        search: prefix,
        includeArchived: true
      });
      assert.ok(resultData(listResult).projects.some((project) => project.id === primaryProjectId));

      const deleteCandidate = await callTool(mcpClient, "project_create", {
        title: `${prefix}-project-delete`,
        description: "project that should be removed by the test"
      });
      const deleteProjectId = resultData(deleteCandidate).project.id;

      await callTool(mcpClient, "project_delete", {
        projectId: deleteProjectId
      });

      await syncService.syncProjects("after-project-delete");
      const refreshedList = await callTool(mcpClient, "projects_list", {
        search: `${prefix}-project-delete`,
        includeArchived: true
      });
      assert.equal(
        refreshedList.structuredContent.projects.some((project) => project.id === deleteProjectId),
        false
      );
    });

    await t.test("runs the project view and bucket lifecycle against the real API", async () => {
      assert.ok(primaryProjectId, "primary project must exist before view tests");

      const createViewResult = await callTool(mcpClient, "project_view_create", {
        projectId: primaryProjectId,
        title: `${prefix}-kanban-view`,
        viewKind: "kanban",
        bucketConfigurationMode: "manual"
      });
      primaryViewId = resultData(createViewResult).view.id;
      assert.ok(primaryViewId);

      const listViewsResult = await callTool(mcpClient, "project_views_list", {
        projectId: primaryProjectId
      });
      assert.ok(resultData(listViewsResult).views.some((view) => view.id === primaryViewId));

      const createBucketResult = await callTool(mcpClient, "bucket_create", {
        projectId: primaryProjectId,
        viewId: primaryViewId,
        title: `${prefix}-bucket-primary`,
        position: 100
      });
      primaryBucketId = resultData(createBucketResult).bucket.id;
      assert.ok(primaryBucketId);

      const updateBucketResult = await callTool(mcpClient, "bucket_update", {
        projectId: primaryProjectId,
        viewId: primaryViewId,
        bucketId: primaryBucketId,
        title: `${prefix}-bucket-primary-updated`,
        position: 150
      });
      assert.equal(resultData(updateBucketResult).bucket.title, `${prefix}-bucket-primary-updated`);

      const listBucketsResult = await callTool(mcpClient, "buckets_list", {
        projectId: primaryProjectId,
        viewId: primaryViewId
      });
      assert.ok(resultData(listBucketsResult).buckets.some((bucket) => bucket.id === primaryBucketId));

      const deleteBucketCandidate = await callTool(mcpClient, "bucket_create", {
        projectId: primaryProjectId,
        viewId: primaryViewId,
        title: `${prefix}-bucket-delete`,
        position: 200
      });
      const deleteBucketId = resultData(deleteBucketCandidate).bucket.id;

      await callTool(mcpClient, "bucket_delete", {
        projectId: primaryProjectId,
        viewId: primaryViewId,
        bucketId: deleteBucketId
      });

      const listBucketsAfterDelete = await callTool(mcpClient, "buckets_list", {
        projectId: primaryProjectId,
        viewId: primaryViewId
      });
      assert.equal(
        listBucketsAfterDelete.structuredContent.buckets.some((bucket) => bucket.id === deleteBucketId),
        false
      );
    });

    await t.test("bootstraps workflow resources idempotently against the real API", async () => {
      assert.ok(primaryProjectId, "primary project must exist before workflow bootstrap tests");

      const template = {
        view: {
          title: `${prefix}-workflow-view`,
          viewKind: "kanban",
          bucketConfigurationMode: "manual"
        },
        labels: [
          {
            title: `${prefix}-workflow-label`,
            description: "workflow bootstrap integration test label",
            hexColor: "8844ff"
          }
        ],
        buckets: [
          {
            title: `${prefix}-workflow-inbox`,
            limit: 0,
            position: 100
          },
          {
            title: `${prefix}-workflow-done`,
            limit: 0,
            position: 200
          }
        ]
      };

      const firstView = await ensureWorkflowView({
        client: directClient,
        projectId: primaryProjectId,
        template
      });
      assert.equal(firstView.status, "created");

      const secondView = await ensureWorkflowView({
        client: directClient,
        projectId: primaryProjectId,
        template
      });
      assert.equal(secondView.status, "exists");
      assert.equal(secondView.view.id, firstView.view.id);

      const firstLabels = await ensureWorkflowLabels({
        client: directClient,
        template
      });
      assert.deepEqual(firstLabels.map((item) => item.status), ["created"]);

      const secondLabels = await ensureWorkflowLabels({
        client: directClient,
        template
      });
      assert.deepEqual(secondLabels.map((item) => item.status), ["exists"]);

      const firstBuckets = await ensureWorkflowBuckets({
        client: directClient,
        projectId: primaryProjectId,
        viewId: firstView.view.id,
        template
      });
      assert.deepEqual(firstBuckets.map((item) => item.status), ["created", "created"]);

      const secondBuckets = await ensureWorkflowBuckets({
        client: directClient,
        projectId: primaryProjectId,
        viewId: firstView.view.id,
        template
      });
      assert.deepEqual(secondBuckets.map((item) => item.status), ["exists", "exists"]);

      const summary = formatWorkflowInitSummary({
        view: firstView.view,
        viewStatus: firstView.status,
        labelResults: firstLabels,
        bucketResults: firstBuckets
      });
      assert.match(summary, /workflow template:/);
      assert.match(summary, new RegExp(`${prefix}-workflow-view`));
      assert.match(summary, new RegExp(`${prefix}-workflow-label`));
      assert.match(summary, new RegExp(`${prefix}-workflow-inbox`));
    });

    await t.test("runs the task, comment, label, and sync lifecycle against the real API", async () => {
      assert.ok(primaryProjectId, "primary project must exist before task tests");
      assert.ok(primaryLabelId, "primary label must exist before task tests");

      const createResult = await callTool(mcpClient, "task_create", {
        projectId: primaryProjectId,
        title: `${prefix}-task-primary`,
        description: "primary task for real API integration test",
        priority: 3
      });
      primaryTaskId = resultData(createResult).task.id;
      assert.ok(primaryTaskId);

      const projectTasks = await callTool(mcpClient, "project_tasks_list", {
        projectId: primaryProjectId,
        includeCompleted: true
      });
      assert.ok(resultData(projectTasks).tasks.some((task) => task.id === primaryTaskId));

      await callTool(mcpClient, "task_add_comment", {
        taskId: primaryTaskId,
        comment: `${prefix} plain comment`
      });

      await callTool(mcpClient, "task_attach_artifact", {
        taskId: primaryTaskId,
        title: `${prefix} artifact`,
        body: `${prefix} artifact body`,
        kind: "log"
      });

      await callTool(mcpClient, "task_suggest_execution", {
        taskId: primaryTaskId,
        summary: `${prefix} execution summary`,
        workingDirectory: "/tmp",
        commands: ["echo real-api-test"],
        risk: "low",
        nextStep: "review output"
      });

      await callTool(mcpClient, "task_mark_blocked", {
        taskId: primaryTaskId,
        reason: `${prefix} blocked reason`
      });

      const statusResult = await callTool(mcpClient, "task_update_status", {
        taskId: primaryTaskId,
        done: true,
        note: `${prefix} status note`
      });
      assert.equal(resultData(statusResult).task.done, true);

      await callTool(mcpClient, "task_label_add", {
        taskId: primaryTaskId,
        labelId: primaryLabelId
      });

      const labelsAfterAdd = await callTool(mcpClient, "task_labels_list", {
        taskId: primaryTaskId
      });
      assert.ok(resultData(labelsAfterAdd).labels.some((label) => label.id === primaryLabelId));

      await callTool(mcpClient, "task_label_remove", {
        taskId: primaryTaskId,
        labelId: primaryLabelId
      });

      const labelsAfterRemove = await callTool(mcpClient, "task_labels_list", {
        taskId: primaryTaskId
      });
      assert.equal(
        labelsAfterRemove.structuredContent.labels.some((label) => label.id === primaryLabelId),
        false
      );

      await callTool(mcpClient, "task_sync_now", {
        projectIds: [primaryProjectId]
      });

      const cachedTasks = await callTool(mcpClient, "tasks_list", {
        projectId: primaryProjectId,
        includeCompleted: true,
        search: prefix,
        limit: 20
      });
      const cachedTask = resultData(cachedTasks).tasks.find((task) => task.id === primaryTaskId);
      assert.ok(cachedTask);
      assert.equal(cachedTask.done, true);

      const taskResult = await callTool(mcpClient, "task_get", {
        taskId: primaryTaskId
      });
      const comments = resultData(taskResult).comments;
      const bodies = commentBodies(comments);
      assert.ok(bodies.some((body) => body.includes(`${prefix} plain comment`)));
      assert.ok(bodies.some((body) => body.includes("[OpenClaw] log:")));
      assert.ok(bodies.some((body) => body.includes("[OpenClaw] execution proposal")));
      assert.ok(bodies.some((body) => body.includes("[OpenClaw] blocked")));
      assert.ok(bodies.some((body) => body.includes("[OpenClaw] status note")));
    });

    await t.test("creates a task directly in a kanban bucket against the real API", async () => {
      assert.ok(primaryProjectId, "primary project must exist before bucketed task tests");
      assert.ok(primaryViewId, "primary view must exist before bucketed task tests");
      assert.ok(primaryBucketId, "primary bucket must exist before bucketed task tests");

      const createResult = await callTool(mcpClient, "task_create", {
        projectId: primaryProjectId,
        viewId: primaryViewId,
        bucketId: primaryBucketId,
        title: `${prefix}-task-in-bucket`,
        description: "task should be assigned to a bucket during creation"
      });
      const task = resultData(createResult).task;
      assert.ok(task.id);
      assert.equal(task.projectId, primaryProjectId);

      const moveResult = await callTool(mcpClient, "task_move_bucket", {
        projectId: primaryProjectId,
        viewId: primaryViewId,
        bucketId: primaryBucketId,
        taskId: task.id
      });
      assert.equal(resultData(moveResult).task.id, task.id);
      assert.equal(resultData(moveResult).bucket.id, primaryBucketId);
    });

    await t.test("moves a task into a kanban bucket against the real API", async () => {
      assert.ok(primaryProjectId, "primary project must exist before move tests");
      assert.ok(primaryViewId, "primary view must exist before move tests");
      assert.ok(primaryBucketId, "primary bucket must exist before move tests");
      assert.ok(primaryTaskId, "primary task must exist before move tests");

      const moveResult = await callTool(mcpClient, "task_move_bucket", {
        projectId: primaryProjectId,
        viewId: primaryViewId,
        bucketId: primaryBucketId,
        taskId: primaryTaskId
      });
      assert.equal(resultData(moveResult).bucket.id, primaryBucketId);
      assert.match(resultText(moveResult), new RegExp(`Moved task #${primaryTaskId} to bucket #${primaryBucketId}`));
    });

    await t.test("runs the webhook lifecycle against the real API", async () => {
      assert.ok(primaryProjectId, "primary project must exist before webhook tests");

      const createTargetUrl = `https://example.com/${prefix}/manual-webhook`;
      const createResult = await callTool(mcpClient, "project_webhook_create", {
        projectId: primaryProjectId,
        targetUrl: createTargetUrl,
        events: ["task.created", "task.updated"],
        secret: `${prefix}-manual-secret`
      });
      const createdWebhookId = resultData(createResult).webhook.id;
      assert.ok(createdWebhookId);

      const listAfterCreate = await callTool(mcpClient, "project_webhooks_list", {
        projectId: primaryProjectId
      });
      assert.ok(
        resultData(listAfterCreate).webhooks.some((webhook) => webhook.id === createdWebhookId)
      );

      await callTool(mcpClient, "project_webhook_update", {
        projectId: primaryProjectId,
        webhookId: createdWebhookId,
        events: ["task.deleted"]
      });

      const listAfterUpdate = await callTool(mcpClient, "project_webhooks_list", {
        projectId: primaryProjectId
      });
      const updatedWebhook = resultData(listAfterUpdate).webhooks.find((webhook) => webhook.id === createdWebhookId);
      assert.deepEqual(updatedWebhook.events, ["task.deleted"]);

      await callTool(mcpClient, "project_webhook_delete", {
        projectId: primaryProjectId,
        webhookId: createdWebhookId
      });

      const listAfterDelete = await callTool(mcpClient, "project_webhooks_list", {
        projectId: primaryProjectId
      });
      assert.equal(
        listAfterDelete.structuredContent.webhooks.some((webhook) => webhook.id === createdWebhookId),
        false
      );

      const syncResult = await callTool(mcpClient, "project_webhooks_sync", {
        projectIds: [primaryProjectId]
      });
      assert.ok(resultData(syncResult).results.some((entry) => entry.projectId === primaryProjectId));

      const syncedTargetUrl = `${config.publicWebhookBaseUrl}/webhooks/vikunja`;
      const listAfterSync = await callTool(mcpClient, "project_webhooks_list", {
        projectId: primaryProjectId
      });
      assert.ok(
        resultData(listAfterSync).webhooks.some((webhook) => {
          const target = webhook.target_url || webhook.targetUrl;
          return target === syncedTargetUrl;
        })
      );
    });

    await t.test("refreshes the cached task from a signed webhook payload", async () => {
      assert.ok(primaryProjectId, "primary project must exist before webhook refresh tests");
      assert.ok(primaryTaskId, "primary task must exist before webhook refresh tests");

      const currentTask = await directClient.getTask(primaryTaskId);
      const remoteTitle = `${prefix}-task-primary-webhook-refresh`;
      await directClient.updateTask(primaryTaskId, {
        ...currentTask,
        title: remoteTitle
      });

      const payload = JSON.stringify({
        event_name: "task.updated",
        data: {
          task: {
            id: primaryTaskId,
            project_id: primaryProjectId
          }
        }
      });
      const signature = crypto
        .createHmac("sha256", config.webhookSecret)
        .update(payload)
        .digest("hex");

      const handledPayload = await syncService.handleWebhook(payload, signature);
      assert.equal(handledPayload.event_name, "task.updated");
      assert.equal(store.getTask(primaryTaskId).title, remoteTitle);
      assert.ok(store.state.sync.lastWebhookAt);
      assert.ok(store.state.sync.projects[String(primaryProjectId)].lastWebhookAt);

      await assert.rejects(
        () => syncService.handleWebhook(payload, "not-the-right-signature"),
        /invalid webhook signature/
      );
    });
  } finally {
    await syncService.stop();
    await cleanupByPrefix(directClient, "openclaw-real-api-test-");
    await close();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
