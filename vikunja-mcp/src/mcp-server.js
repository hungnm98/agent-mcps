import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  formatArtifactComment,
  formatExecutionProposal,
  normalizeBucket,
  normalizeLabel,
  normalizeProjectView,
  renderProjectSummary,
  renderBucketSummary,
  renderLabelSummary,
  renderProjectViewSummary,
  normalizeTask,
  renderTaskSummary
} from "./task-utils.js";

function textResult(text, structuredContent = undefined) {
  return {
    content: [
      {
        type: "text",
        text
      }
    ],
    ...(structuredContent ? { structuredContent } : {})
  };
}

function mergeTaskUpdate(currentTask, patch) {
  return {
    ...currentTask.raw,
    ...patch
  };
}

function mergeProjectUpdate(currentProject, patch) {
  return {
    ...currentProject.raw,
    ...patch
  };
}

export function createMcpServer({ config, client, store, syncService }) {
  const server = new McpServer({
    name: config.serverName,
    version: "0.1.0"
  });

  server.tool(
    "labels_list",
    "List Vikunja labels from the local cache or refresh them from the API.",
    {
      labelIds: z.array(z.number().int()).optional(),
      search: z.string().optional(),
      refresh: z.boolean().default(false)
    },
    async ({ labelIds, search, refresh }) => {
      if (refresh) {
        await syncService.refreshLabels(search || "", "mcp:labels-list");
      }

      const labels = store.listLabels({ labelIds, search: search || "" });
      const summary = labels.length
        ? labels.map((label) => renderLabelSummary(label)).join("\n\n")
        : "No labels matched the current filter.";

      return textResult(summary, { labels });
    }
  );

  server.tool(
    "label_get",
    "Get one Vikunja label and refresh its cached metadata.",
    {
      labelId: z.number().int()
    },
    async ({ labelId }) => {
      const label = await syncService.refreshLabel(labelId, "mcp:label-get");
      return textResult(renderLabelSummary(label), { label });
    }
  );

  server.tool(
    "label_create",
    "Create a new Vikunja label.",
    {
      title: z.string().min(1),
      description: z.string().optional(),
      hexColor: z.string().optional()
    },
    async ({ title, description, hexColor }) => {
      const created = await client.createLabel({
        title,
        description,
        hex_color: hexColor
      });
      const label = normalizeLabel(created);
      await store.upsertLabels([label], "mcp:label-create");
      return textResult(`Created label #${label.id}: ${label.title}`, { label });
    }
  );

  server.tool(
    "label_update",
    "Update an existing Vikunja label.",
    {
      labelId: z.number().int(),
      title: z.string().optional(),
      description: z.string().optional(),
      hexColor: z.string().optional()
    },
    async ({ labelId, title, description, hexColor }) => {
      const current = await syncService.refreshLabel(labelId, "mcp:label-update:before");
      const updated = await client.updateLabel(labelId, {
        ...current.raw,
        ...(title !== undefined ? { title } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(hexColor !== undefined ? { hex_color: hexColor } : {})
      });
      const label = normalizeLabel(updated);
      await store.upsertLabels([label], "mcp:label-update");
      return textResult(`Updated label #${label.id}: ${label.title}`, { label });
    }
  );

  server.tool(
    "label_delete",
    "Delete a Vikunja label.",
    {
      labelId: z.number().int()
    },
    async ({ labelId }) => {
      const result = await client.deleteLabel(labelId);
      await store.removeLabel(labelId);
      return textResult(`Deleted label #${labelId}`, { result, labelId });
    }
  );

  server.tool(
    "projects_list",
    "List configured Vikunja projects handled by this bridge.",
    {
      projectIds: z.array(z.number().int()).optional(),
      search: z.string().optional(),
      includeArchived: z.boolean().default(false)
    },
    async ({ projectIds, search, includeArchived }) => {
      const projects = store.listProjects({ projectIds, search, includeArchived });
      const summary = projects.length
        ? projects.map((project) => renderProjectSummary(project)).join("\n\n")
        : "No configured projects matched the current filter.";

      return textResult(summary, { projects });
    }
  );

  server.tool(
    "project_get",
    "Get one project from Vikunja and refresh its cached metadata.",
    {
      projectId: z.number().int()
    },
    async ({ projectId }) => {
      const project = await syncService.refreshProject(projectId, "mcp:project-get");
      return textResult(renderProjectSummary(project), { project });
    }
  );

  server.tool(
    "project_create",
    "Create a new Vikunja project.",
    {
      title: z.string().min(1),
      description: z.string().optional(),
      isArchived: z.boolean().optional()
    },
    async ({ title, description, isArchived }) => {
      const project = await client.createProject({
        title,
        description,
        is_archived: isArchived
      });
      const refreshed = await syncService.refreshProject(project.id, "mcp:project-create");
      return textResult(`Created project #${refreshed.id}: ${refreshed.title}`, { project: refreshed });
    }
  );

  server.tool(
    "project_update",
    "Update a Vikunja project title, description, or archive flag.",
    {
      projectId: z.number().int(),
      title: z.string().optional(),
      description: z.string().optional(),
      isArchived: z.boolean().optional()
    },
    async ({ projectId, title, description, isArchived }) => {
      const current = await syncService.refreshProject(projectId, "mcp:project-update:before");
      const updated = await client.updateProject(
        projectId,
        mergeProjectUpdate(current, {
          ...(title !== undefined ? { title } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(isArchived !== undefined ? { is_archived: isArchived } : {})
        })
      );
      const project = await syncService.refreshProject(updated.id, "mcp:project-update");
      return textResult(`Updated project #${project.id}: ${project.title}`, { project });
    }
  );

  server.tool(
    "project_delete",
    "Delete a Vikunja project.",
    {
      projectId: z.number().int()
    },
    async ({ projectId }) => {
      await client.deleteProject(projectId);
      await store.removeProject(projectId);
      return textResult(`Deleted project #${projectId}`, { projectId });
    }
  );

  server.tool(
    "project_views_list",
    "List all views configured for a Vikunja project.",
    {
      projectId: z.number().int()
    },
    async ({ projectId }) => {
      const views = (await client.listProjectViews(projectId)).map((view) => normalizeProjectView(view));
      const summary = views.length
        ? views.map((view) => renderProjectViewSummary(view)).join("\n\n")
        : `No views found for project #${projectId}.`;
      return textResult(summary, { views });
    }
  );

  server.tool(
    "project_view_create",
    "Create a new view for a Vikunja project.",
    {
      projectId: z.number().int(),
      title: z.string().min(1),
      viewKind: z.enum(["list", "gantt", "table", "kanban"]).default("kanban"),
      bucketConfigurationMode: z.enum(["none", "manual", "filter"]).optional()
    },
    async ({ projectId, title, viewKind, bucketConfigurationMode }) => {
      const view = normalizeProjectView(await client.createProjectView(projectId, {
        title,
        view_kind: viewKind,
        ...(bucketConfigurationMode ? { bucket_configuration_mode: bucketConfigurationMode } : {})
      }));
      return textResult(`Created view #${view.id}: ${view.title}`, { view });
    }
  );

  server.tool(
    "project_tasks_list",
    "Fetch and return tasks for a single project directly from Vikunja.",
    {
      projectId: z.number().int(),
      includeCompleted: z.boolean().default(true)
    },
    async ({ projectId, includeCompleted }) => {
      const tasks = (await client.listProjectTasks(projectId))
        .map((task) => normalizeTask(task))
        .filter((task) => (includeCompleted ? true : !task.done));

      for (const task of tasks) {
        await store.upsertTask(task, "mcp:project-tasks-list");
      }

      const summary = tasks.length
        ? tasks.map((task) => renderTaskSummary(task)).join("\n\n")
        : `No tasks found for project #${projectId}.`;
      return textResult(summary, { tasks });
    }
  );

  server.tool(
    "buckets_list",
    "List all buckets configured for a project view.",
    {
      projectId: z.number().int(),
      viewId: z.number().int()
    },
    async ({ projectId, viewId }) => {
      const buckets = (await client.listProjectBuckets(projectId, viewId)).map((bucket) => normalizeBucket(bucket));
      const summary = buckets.length
        ? buckets.map((bucket) => renderBucketSummary(bucket)).join("\n\n")
        : `No buckets found for project #${projectId} view #${viewId}.`;
      return textResult(summary, { buckets });
    }
  );

  server.tool(
    "bucket_create",
    "Create a bucket in a Vikunja kanban view.",
    {
      projectId: z.number().int(),
      viewId: z.number().int(),
      title: z.string().min(1),
      limit: z.number().int().min(0).optional(),
      position: z.number().optional()
    },
    async ({ projectId, viewId, title, limit, position }) => {
      const bucket = normalizeBucket(await client.createBucket(projectId, viewId, {
        title,
        ...(limit !== undefined ? { limit } : {}),
        ...(position !== undefined ? { position } : {})
      }));
      return textResult(`Created bucket #${bucket.id}: ${bucket.title}`, { bucket });
    }
  );

  server.tool(
    "bucket_update",
    "Update a bucket title, limit, or position.",
    {
      projectId: z.number().int(),
      viewId: z.number().int(),
      bucketId: z.number().int(),
      title: z.string().optional(),
      limit: z.number().int().min(0).optional(),
      position: z.number().optional()
    },
    async ({ projectId, viewId, bucketId, title, limit, position }) => {
      const current = (await client.listProjectBuckets(projectId, viewId))
        .map((bucket) => normalizeBucket(bucket))
        .find((bucket) => bucket.id === bucketId);

      if (!current) {
        throw new Error(`bucket #${bucketId} was not found in project #${projectId} view #${viewId}`);
      }

      const bucket = normalizeBucket(await client.updateBucket(projectId, viewId, bucketId, {
        ...current.raw,
        ...(title !== undefined ? { title } : {}),
        ...(limit !== undefined ? { limit } : {}),
        ...(position !== undefined ? { position } : {})
      }));
      return textResult(`Updated bucket #${bucket.id}: ${bucket.title}`, { bucket });
    }
  );

  server.tool(
    "bucket_delete",
    "Delete a bucket from a Vikunja kanban view.",
    {
      projectId: z.number().int(),
      viewId: z.number().int(),
      bucketId: z.number().int()
    },
    async ({ projectId, viewId, bucketId }) => {
      const result = await client.deleteBucket(projectId, viewId, bucketId);
      return textResult(`Deleted bucket #${bucketId} from view #${viewId}`, {
        result,
        bucketId,
        viewId
      });
    }
  );

  server.tool(
    "task_labels_list",
    "List all labels currently attached to a task.",
    {
      taskId: z.number().int()
    },
    async ({ taskId }) => {
      const labels = await syncService.refreshTaskLabels(taskId, "mcp:task-labels-list");
      const summary = labels.length
        ? labels.map((label) => renderLabelSummary(label)).join("\n\n")
        : `Task #${taskId} has no labels.`;
      return textResult(summary, { labels });
    }
  );

  server.tool(
    "task_label_add",
    "Attach a label to a task.",
    {
      taskId: z.number().int(),
      labelId: z.number().int()
    },
    async ({ taskId, labelId }) => {
      const relation = await client.addTaskLabel(taskId, labelId);
      const labels = await syncService.refreshTaskLabels(taskId, "mcp:task-label-add");
      const task = await syncService.refreshTask(taskId, "mcp:task-label-add");
      return textResult(`Added label #${labelId} to task #${taskId}`, {
        relation,
        labels,
        task
      });
    }
  );

  server.tool(
    "task_label_remove",
    "Remove a label from a task.",
    {
      taskId: z.number().int(),
      labelId: z.number().int()
    },
    async ({ taskId, labelId }) => {
      const result = await client.removeTaskLabel(taskId, labelId);
      const labels = await syncService.refreshTaskLabels(taskId, "mcp:task-label-remove");
      const task = await syncService.refreshTask(taskId, "mcp:task-label-remove");
      return textResult(`Removed label #${labelId} from task #${taskId}`, {
        result,
        labels,
        task
      });
    }
  );

  server.tool(
    "tasks_list",
    "List synced Vikunja tasks from the local bridge cache.",
    {
      projectId: z.number().int().optional(),
      projectIds: z.array(z.number().int()).optional(),
      includeCompleted: z.boolean().default(false),
      limit: z.number().int().min(1).max(100).default(20),
      search: z.string().optional()
    },
    async ({ projectId, projectIds, includeCompleted, limit, search }) => {
      const tasks = store.listTasks({ projectId, projectIds, includeCompleted, limit, search });
      const summary = tasks.length
        ? tasks.map((task) => renderTaskSummary(task)).join("\n\n")
        : "No tasks matched the current filter.";

      return textResult(summary, { tasks });
    }
  );

  server.tool(
    "task_get",
    "Get a task and its latest comments from Vikunja.",
    {
      taskId: z.number().int()
    },
    async ({ taskId }) => {
      const task = await syncService.refreshTask(taskId, "mcp:get");
      const comments = await syncService.refreshComments(taskId);
      return textResult(renderTaskSummary(task), { task, comments });
    }
  );

  server.tool(
    "task_create",
    "Create a new task in a Vikunja project.",
    {
      projectId: z.number().int(),
      title: z.string().min(1),
      description: z.string().optional(),
      priority: z.number().int().min(0).max(5).optional(),
      done: z.boolean().optional(),
      viewId: z.number().int().optional(),
      bucketId: z.number().int().optional()
    },
    async ({ projectId, title, description, priority, done, viewId, bucketId }) => {
      if (bucketId !== undefined && viewId === undefined) {
        throw new Error("viewId is required when bucketId is provided");
      }

      const created = await client.createTask(projectId, {
        title,
        description,
        priority,
        done
      });
      let task = normalizeTask(created);
      await store.upsertTask(task, "mcp:create");

      if (bucketId !== undefined) {
        await client.moveTaskToBucket(projectId, viewId, bucketId, {
          task_id: task.id
        });
        task = await syncService.refreshTask(task.id, "mcp:create:bucket");
      }

      return textResult(`Created task #${task.id}: ${task.title}`, { task });
    }
  );

  server.tool(
    "task_update_status",
    "Mark a task done or not done and optionally leave a note.",
    {
      taskId: z.number().int(),
      done: z.boolean(),
      note: z.string().optional()
    },
    async ({ taskId, done, note }) => {
      const current = await syncService.refreshTask(taskId, "mcp:update-status:before");
      const updated = await client.updateTask(taskId, mergeTaskUpdate(current, { done }));
      const task = normalizeTask(updated);
      await store.upsertTask(task, "mcp:update-status");

      if (note) {
        await client.createTaskComment(taskId, `[OpenClaw] status note\n\n${note}`);
        await syncService.refreshComments(taskId);
      }

      return textResult(`Updated task #${task.id} done=${task.done}`, { task });
    }
  );

  server.tool(
    "task_add_comment",
    "Add a plain text comment to a task.",
    {
      taskId: z.number().int(),
      comment: z.string().min(1)
    },
    async ({ taskId, comment }) => {
      const created = await client.createTaskComment(taskId, comment);
      const comments = await syncService.refreshComments(taskId);
      return textResult(`Comment added to task #${taskId}`, {
        comment: created,
        comments
      });
    }
  );

  server.tool(
    "task_attach_artifact",
    "Attach a run result, log, or other artifact as a formatted task comment.",
    {
      taskId: z.number().int(),
      title: z.string().min(1),
      body: z.string().min(1),
      kind: z.string().optional()
    },
    async ({ taskId, title, body, kind }) => {
      const commentText = formatArtifactComment({ title, body, kind });
      const created = await client.createTaskComment(taskId, commentText);
      const comments = await syncService.refreshComments(taskId);
      return textResult(`Artifact added to task #${taskId}`, {
        comment: created,
        comments
      });
    }
  );

  server.tool(
    "task_suggest_execution",
    "Post an execution proposal back to the task before running work.",
    {
      taskId: z.number().int(),
      summary: z.string().min(1),
      workingDirectory: z.string().optional(),
      commands: z.array(z.string()).optional(),
      risk: z.string().optional(),
      nextStep: z.string().optional()
    },
    async ({ taskId, summary, workingDirectory, commands, risk, nextStep }) => {
      const commentText = formatExecutionProposal({
        summary,
        workingDirectory,
        commands,
        risk,
        nextStep
      });
      const created = await client.createTaskComment(taskId, commentText);
      const comments = await syncService.refreshComments(taskId);
      return textResult(`Execution proposal posted to task #${taskId}`, {
        comment: created,
        comments
      });
    }
  );

  server.tool(
    "task_mark_blocked",
    "Mark a task as blocked by adding a structured blocker comment.",
    {
      taskId: z.number().int(),
      reason: z.string().min(1)
    },
    async ({ taskId, reason }) => {
      const created = await client.createTaskComment(
        taskId,
        `[OpenClaw] blocked\n\nreason: ${reason}`
      );
      const comments = await syncService.refreshComments(taskId);
      return textResult(`Task #${taskId} marked blocked`, {
        comment: created,
        comments
      });
    }
  );

  server.tool(
    "task_move_bucket",
    "Move a task into a different bucket within the same project view.",
    {
      projectId: z.number().int(),
      viewId: z.number().int(),
      bucketId: z.number().int(),
      taskId: z.number().int(),
      position: z.number().optional()
    },
    async ({ projectId, viewId, bucketId, taskId, position }) => {
      const result = await client.moveTaskToBucket(projectId, viewId, bucketId, {
        task_id: taskId,
        ...(position !== undefined ? { position } : {})
      });
      const task = await syncService.refreshTask(taskId, "mcp:task-move-bucket");
      const bucket = (await client.listProjectBuckets(projectId, viewId))
        .map((item) => normalizeBucket(item))
        .find((item) => item.id === bucketId) ?? null;
      return textResult(`Moved task #${taskId} to bucket #${bucketId}`, {
        result,
        task,
        bucket
      });
    }
  );

  server.tool(
    "task_sync_now",
    "Force an immediate sync from Vikunja to refresh the local task cache.",
    {
      projectIds: z.array(z.number().int()).optional()
    },
    async ({ projectIds }) => {
      if (Array.isArray(projectIds) && projectIds.length) {
        await syncService.syncProjects("mcp:manual");
        for (const projectId of projectIds) {
          const tasks = await client.listProjectTasks(projectId);
          for (const task of tasks) {
            await store.upsertTask(normalizeTask(task), "poll:mcp:manual:selected");
          }
          await store.markProjectPoll(projectId);
        }
      } else {
        await syncService.pollAllProjects("mcp:manual");
      }

      const tasks = store.listTasks({
        projectIds,
        limit: config.taskCacheLimit,
        includeCompleted: true
      });
      return textResult(`Synced ${tasks.length} tasks into the local cache.`, { tasks });
    }
  );

  server.tool(
    "project_webhooks_sync",
    "Ensure webhook targets exist for all configured Vikunja projects.",
    {
      projectIds: z.array(z.number().int()).optional()
    },
    async ({ projectIds }) => {
      const results = await syncService.ensureConfiguredWebhooks(projectIds);
      const text = results.length
        ? results.map((item) => `project ${item.projectId}: ${item.status}`).join("\n")
        : "Webhook sync skipped because PUBLIC_WEBHOOK_BASE_URL is not configured.";
      return textResult(text, { results });
    }
  );

  server.tool(
    "project_webhooks_list",
    "List webhook targets for a Vikunja project.",
    {
      projectId: z.number().int()
    },
    async ({ projectId }) => {
      const webhooks = await client.listProjectWebhooks(projectId);
      const text = webhooks.length
        ? webhooks
            .map((item) => `#${item.id} ${item.target_url || item.targetUrl} events=${(item.events || []).join(",")}`)
            .join("\n")
        : `No webhooks configured for project #${projectId}.`;
      return textResult(text, { webhooks });
    }
  );

  server.tool(
    "project_webhook_create",
    "Create a webhook target for a Vikunja project.",
    {
      projectId: z.number().int(),
      targetUrl: z.string().url(),
      events: z.array(z.string()).min(1),
      secret: z.string().optional()
    },
    async ({ projectId, targetUrl, events, secret }) => {
      const webhook = await client.createProjectWebhook(projectId, {
        target_url: targetUrl,
        events,
        secret
      });
      return textResult(`Created webhook #${webhook.id} for project #${projectId}`, { webhook });
    }
  );

  server.tool(
    "project_webhook_update",
    "Update the events for an existing Vikunja project webhook.",
    {
      projectId: z.number().int(),
      webhookId: z.number().int(),
      events: z.array(z.string()).min(1)
    },
    async ({ projectId, webhookId, events }) => {
      const current = (await client.listProjectWebhooks(projectId))
        .find((item) => item.id === webhookId);

      if (!current) {
        throw new Error(`webhook #${webhookId} was not found in project #${projectId}`);
      }

      const webhook = await client.updateProjectWebhook(projectId, webhookId, {
        ...current,
        events
      });
      return textResult(`Updated webhook #${webhookId} for project #${projectId}`, { webhook });
    }
  );

  server.tool(
    "project_webhook_delete",
    "Delete a Vikunja project webhook.",
    {
      projectId: z.number().int(),
      webhookId: z.number().int()
    },
    async ({ projectId, webhookId }) => {
      const result = await client.deleteProjectWebhook(projectId, webhookId);
      return textResult(`Deleted webhook #${webhookId} from project #${projectId}`, { result });
    }
  );

  return server;
}
