import { assertConfig, config } from "./config.js";
import { VikunjaClient } from "./vikunja-client.js";
import {
  DEFAULT_WORKFLOW_TEMPLATE_PATH,
  ensureWorkflowBuckets,
  ensureWorkflowLabels,
  ensureWorkflowView,
  formatWorkflowInitSummary,
  loadWorkflowTemplate
} from "./workflow-bootstrap.js";

function parseArgs(argv) {
  const options = {
    projectId: null,
    viewId: null,
    viewTitle: "",
    templatePath: DEFAULT_WORKFLOW_TEMPLATE_PATH,
    withLabels: true,
    withBuckets: true
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--project-id") {
      options.projectId = Number.parseInt(argv[index + 1] || "", 10);
      index += 1;
      continue;
    }

    if (arg === "--view-id") {
      options.viewId = Number.parseInt(argv[index + 1] || "", 10);
      index += 1;
      continue;
    }

    if (arg === "--view-title") {
      options.viewTitle = String(argv[index + 1] || "").trim();
      index += 1;
      continue;
    }

    if (arg === "--template") {
      options.templatePath = String(argv[index + 1] || "").trim() || DEFAULT_WORKFLOW_TEMPLATE_PATH;
      index += 1;
      continue;
    }

    if (arg === "--labels-only") {
      options.withLabels = true;
      options.withBuckets = false;
      continue;
    }

    if (arg === "--buckets-only") {
      options.withLabels = false;
      options.withBuckets = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    throw new Error(`unknown argument: ${arg}`);
  }

  return options;
}

function usage() {
  return [
    "Usage:",
    "  node src/init-workflow.js --project-id <id> [--view-id <id>] [--view-title <title>] [--template <path>]",
    "  node src/init-workflow.js --project-id <id> --labels-only",
    "  node src/init-workflow.js --project-id <id> --buckets-only"
  ].join("\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const issues = assertConfig();
  if (issues.length) {
    throw new Error(issues.join("\n"));
  }

  if (!Number.isInteger(options.projectId)) {
    throw new Error("missing or invalid --project-id");
  }

  const client = new VikunjaClient({
    baseUrl: config.vikunjaApiBaseUrl,
    apiToken: config.vikunjaApiToken
  });
  const template = await loadWorkflowTemplate(options.templatePath);
  const { view, status: viewStatus } = await ensureWorkflowView({
    client,
    projectId: options.projectId,
    viewId: options.viewId,
    viewTitle: options.viewTitle,
    template
  });

  const labelResults = options.withLabels
    ? await ensureWorkflowLabels({ client, template })
    : [];
  const bucketResults = options.withBuckets
    ? await ensureWorkflowBuckets({
        client,
        projectId: options.projectId,
        viewId: view.id,
        template
      })
    : [];

  console.log(formatWorkflowInitSummary({
    templatePath: options.templatePath,
    view,
    viewStatus,
    labelResults,
    bucketResults
  }));
}

main().catch((error) => {
  console.error(error.message);
  console.error("");
  console.error(usage());
  process.exitCode = 1;
});
