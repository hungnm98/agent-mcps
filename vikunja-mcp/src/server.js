import express from "express";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";

import { assertConfig, config, resolveSessionConfig } from "./config.js";
import { logger } from "./logger.js";
import { createMcpServer } from "./mcp-server.js";
import { Store } from "./store.js";
import { SyncService } from "./sync-service.js";
import { VikunjaClient } from "./vikunja-client.js";

const startupIssues = assertConfig(config, { requireClientConfig: false });
if (startupIssues.length) {
  logger.warn("configuration issues detected", { issues: startupIssues });
}

const app = express();
const transports = new Map();

const store = new Store({
  stateFile: config.stateFile,
  taskCacheLimit: config.taskCacheLimit,
  logger
});
await store.load();

const runtime = {
  config: null,
  client: null,
  syncService: null,
  issues: startupIssues
};

function sameClientConfig(left, right) {
  return Boolean(left)
    && Boolean(right)
    && left.vikunjaApiBaseUrl === right.vikunjaApiBaseUrl
    && left.vikunjaApiToken === right.vikunjaApiToken
    && left.vikunjaBasicAuthHeader === right.vikunjaBasicAuthHeader;
}

async function ensureRuntime(sessionConfig) {
  const issues = assertConfig(sessionConfig);
  if (issues.length) {
    return { issues };
  }

  if (runtime.syncService && sameClientConfig(runtime.config, sessionConfig)) {
    runtime.issues = [];
    return {
      issues: [],
      config: runtime.config,
      client: runtime.client,
      syncService: runtime.syncService
    };
  }

  if (transports.size > 0) {
    throw new Error("single-client mode only supports one active client configuration at a time");
  }

  if (runtime.syncService) {
    await runtime.syncService.stop();
  }

  const client = new VikunjaClient({
    baseUrl: sessionConfig.vikunjaApiBaseUrl,
    apiToken: sessionConfig.vikunjaApiToken,
    basicAuthHeader: sessionConfig.vikunjaBasicAuthHeader
  });
  const syncService = new SyncService({
    config: sessionConfig,
    client,
    store,
    logger
  });

  await syncService.start();

  runtime.config = sessionConfig;
  runtime.client = client;
  runtime.syncService = syncService;
  runtime.issues = [];

  return {
    issues: [],
    config: sessionConfig,
    client,
    syncService
  };
}

app.get("/healthz", (_req, res) => {
  const activeConfig = runtime.config ?? config;
  const issues = runtime.config ? runtime.issues : startupIssues;
  res.json({
    ok: issues.length === 0,
    issues,
    configuredProjectIds: activeConfig.vikunjaProjectIds.length ? activeConfig.vikunjaProjectIds : "all",
    activeClient: runtime.config
      ? {
          baseUrl: runtime.config.vikunjaApiBaseUrl,
          serverName: runtime.config.serverName
        }
      : null,
    activeSessions: transports.size,
    projects: store.listProjects({ includeArchived: true }),
    sync: store.state.sync
  });
});

app.get("/sse", async (req, res) => {
  let session;

  try {
    const sessionConfig = resolveSessionConfig(req.query);
    session = await ensureRuntime(sessionConfig);
  } catch (error) {
    const statusCode = error.message.includes("single-client mode") ? 409 : 500;
    res.status(statusCode).json({
      ok: false,
      error: error.message
    });
    return;
  }

  if (session.issues.length) {
    res.status(400).json({
      ok: false,
      issues: session.issues
    });
    return;
  }

  const transport = new SSEServerTransport("/messages", res);
  const server = createMcpServer({
    config: session.config,
    client: session.client,
    store,
    syncService: session.syncService
  });

  transports.set(transport.sessionId, { transport, server });

  res.on("close", async () => {
    transports.delete(transport.sessionId);
    await server.close();
  });

  await server.connect(transport);
});

app.post("/messages", express.json(), async (req, res) => {
  const sessionId = String(req.query.sessionId || "");
  const session = transports.get(sessionId);

  if (!session) {
    res.status(404).json({ error: "unknown session id" });
    return;
  }

  await session.transport.handlePostMessage(req, res, req.body);
});

app.post("/webhooks/vikunja", express.raw({ type: "*/*" }), async (req, res) => {
  if (!runtime.syncService) {
    res.status(503).json({
      ok: false,
      error: "no active client configuration; connect one MCP client first"
    });
    return;
  }

  try {
    const rawBody = Buffer.from(req.body).toString("utf8");
    const signature = req.header("x-vikunja-signature") || "";
    const payload = await runtime.syncService.handleWebhook(rawBody, signature);
    res.json({
      ok: true,
      eventName: payload.event_name
    });
  } catch (error) {
    logger.warn("webhook processing failed", { error: error.message });
    res.status(400).json({
      ok: false,
      error: error.message
    });
  }
});

app.listen(config.port, () => {
  logger.info("vikunja task mcp bridge listening", {
    port: config.port,
    ssePath: "/sse",
    webhookPath: "/webhooks/vikunja"
  });
});
