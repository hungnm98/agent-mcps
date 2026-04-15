# OpenClaw Vikunja MCP

Bridge này cho `OpenClaw` đọc, tạo, cập nhật và đồng bộ task từ `Vikunja`.

## Thành phần

- `vikunja-task-mcp`: MCP server luôn chạy, expose:
  - `GET /sse`
  - `POST /messages`
  - `GET /healthz`
  - `POST /webhooks/vikunja`

## Chuẩn bị

1. Tạo API token trong `Vikunja`.
2. Sửa `openclaw/.env`:
   - `VIKUNJA_API_TOKEN`
   - tùy chọn `VIKUNJA_PROJECT_IDS` dạng `1,2,3` nếu muốn giới hạn project
   - tùy chọn `PUBLIC_WEBHOOK_BASE_URL` nếu muốn webhook near real-time
3. Khởi động stack:

```bash
cd /home/saga/works/hungnm/docker-composes/openclaw
docker compose up -d --build
```

## Kết nối vào OpenClaw

OpenClaw local đã được cấu hình để trỏ tới:

```json
{
  "mcp": {
    "servers": {
      "vikunjaTasks": {
        "url": "http://127.0.0.1:8765/sse"
      }
    }
  }
}
```

Sau khi bridge chạy, restart OpenClaw nếu cần để nạp lại config.

## Tool MCP hiện có

- `labels_list`
- `label_get`
- `label_create`
- `label_update`
- `label_delete`
- `projects_list`
- `project_get`
- `project_create`
- `project_update`
- `project_delete`
- `project_views_list`
- `project_view_create`
- `project_tasks_list`
- `buckets_list`
- `bucket_create`
- `bucket_update`
- `bucket_delete`
- `tasks_list`
- `task_get`
- `task_create`
- `task_labels_list`
- `task_label_add`
- `task_label_remove`
- `task_update_status`
- `task_add_comment`
- `task_attach_artifact`
- `task_suggest_execution`
- `task_mark_blocked`
- `task_move_bucket`
- `task_sync_now`
- `project_webhooks_sync`
- `project_webhooks_list`
- `project_webhook_create`
- `project_webhook_update`
- `project_webhook_delete`

## Webhook

Nếu `PUBLIC_WEBHOOK_BASE_URL` trỏ tới URL mà `Vikunja` gọi được, bridge có thể tạo webhook cho mọi project mà token hiện tại truy cập được. Nếu có `VIKUNJA_PROJECT_IDS`, bridge chỉ giới hạn trong danh sách đó.

Target webhook:

```text
${PUBLIC_WEBHOOK_BASE_URL}/webhooks/vikunja
```

Nếu chưa có webhook, bridge vẫn tự đồng bộ qua polling mỗi `POLL_INTERVAL_MS`.

## Khoi tao labels va buckets

Bridge da co san template workflow mac dinh tai:

```text
openclaw/vikunja-mcp/config/workflow-defaults.json
```

Template nay tao:
- labels nhu `ai:triage`, `ai:dev-ready`, `ai:review-ready`, `ai:blocked`
- buckets nhu `Inbox`, `Clarifying`, `ReadyForDev`, `InDev`, `InReview`, `ReadyForOwner`, `Done`

Khoi tao cho mot project:

```bash
cd /home/saga/works/hungnm/docker-composes/openclaw/vikunja-mcp
npm run init:workflow -- --project-id 123
```

Neu muon dung mot view co san:

```bash
npm run init:workflow -- --project-id 123 --view-id 456
```

Neu muon dat ten kanban view khac khi tao moi:

```bash
npm run init:workflow -- --project-id 123 --view-title "OpenClaw Workflow"
```

## Workflow va prompt library

Neu ban muon agent bam dung flow tren Vikunja, tai lieu va prompt mau da co san tai:

- `openclaw/docs/vikunja-agent-workflow.md`
- `openclaw/prompts/ba-techlead.md`
- `openclaw/prompts/senior-dev.md`
- `openclaw/prompts/reviewer.md`
- `openclaw/prompts/hard-task-handoff.md`

Bo nay duoc dung khi:
- task duoc dieu phoi bang labels va buckets tren Vikunja
- can prompt rieng cho BA/TechLead, Senior Dev, Reviewer
- task kho can handoff mot phan sang Codex hoac Cursor nhung van phai giu dung quy trinh, output, va review gate
