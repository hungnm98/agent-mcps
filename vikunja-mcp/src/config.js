import path from "node:path";

export function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseIntOr(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBasicAuthorization() {
  const inlineHeader = clean(process.env.VIKUNJA_BASIC_AUTH_HEADER);
  if (inlineHeader) {
    return inlineHeader.startsWith("Basic ") ? inlineHeader : `Basic ${inlineHeader}`;
  }

  const username = clean(process.env.VIKUNJA_BASIC_AUTH_USERNAME);
  const password = clean(process.env.VIKUNJA_BASIC_AUTH_PASSWORD);
  if (!username && !password) {
    return "";
  }

  const encoded = Buffer.from(`${username}:${password}`).toString("base64");
  return `Basic ${encoded}`;
}

export function toApiBaseUrl(value) {
  const trimmed = clean(value);
  if (!trimmed) {
    return "";
  }

  return trimmed.endsWith("/api/v1")
    ? trimmed.replace(/\/+$/, "")
    : `${trimmed.replace(/\/+$/, "")}/api/v1`;
}

export const config = {
  port: parseIntOr(process.env.PORT, 8765),
  serverName: clean(process.env.MCP_SERVER_NAME) || "vikunja-tasks",
  dataDir: clean(process.env.DATA_DIR) || "/app/data",
  vikunjaApiBaseUrl: "",
  vikunjaApiToken: "",
  vikunjaBasicAuthHeader: toBasicAuthorization(),
  vikunjaProjectIds: [],
  pollIntervalMs: parseIntOr(process.env.POLL_INTERVAL_MS, 30000),
  taskCacheLimit: parseIntOr(process.env.TASK_CACHE_LIMIT, 200),
  publicWebhookBaseUrl: clean(process.env.PUBLIC_WEBHOOK_BASE_URL),
  webhookSecret: clean(process.env.VIKUNJA_WEBHOOK_SECRET),
  stateFile: path.join(clean(process.env.DATA_DIR) || "/app/data", "state.json")
};

export function resolveSessionConfig(query = {}) {
  return {
    ...config,
    vikunjaApiBaseUrl: toApiBaseUrl(query.vikunja_url),
    vikunjaApiToken: clean(query.token)
  };
}

export function assertConfig(runtimeConfig = config, options = {}) {
  const { requireClientConfig = true } = options;
  const issues = [];

  if (requireClientConfig && !runtimeConfig.vikunjaApiBaseUrl) {
    issues.push("vikunja_url is missing");
  }

  if (requireClientConfig && !runtimeConfig.vikunjaBasicAuthHeader
    && (!runtimeConfig.vikunjaApiToken || runtimeConfig.vikunjaApiToken === "CHANGE_ME")) {
    issues.push("token is missing (or configure VIKUNJA_BASIC_AUTH_*)");
  }

  return issues;
}
