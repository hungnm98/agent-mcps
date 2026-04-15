# agent-mcps

Single-client MCP setup for Vikunja.

## What This Repo Contains

`vikunja-mcp/` runs an MCP server over SSE at `http://<host>:8765/sse`.

This server now supports a simple single-client mode:

- The MCP client can pass `token` and `vikunja_url` directly on the `/sse` URL.
- Only one active client configuration is supported at a time.
- If a second client connects with a different config while one session is active, the server returns `409`.

## Start The Server

```bash
cd vikunja-mcp
npm install
npm start
```

The client must always send `vikunja_url` in the SSE URL.

Authentication options:

- `token` on the SSE URL query (`Bearer` auth).
- Or Basic Auth loaded from env (`Authorization: Basic ...`) using:
  - `VIKUNJA_BASIC_AUTH_HEADER` (full header value or just base64 payload), or
  - `VIKUNJA_BASIC_AUTH_USERNAME` + `VIKUNJA_BASIC_AUTH_PASSWORD`.

## Client Config

Example config:

```json
{
  "mcpServers": {
    "vikunjaTasks": {
      "url": "http://192.168.1.17:8765/sse?token=YOUR_TOKEN&vikunja_url=https%3A%2F%2Fyour-vikunja-instance.com"
    }
  }
}
```

Notes:

- Replace `YOUR_TOKEN` with a real Vikunja API token (skip this query param if you use env-based Basic Auth).
- `vikunja_url` should be the Vikunja base URL, not `/api/v1`. The server appends `/api/v1` automatically.
- URL-encode the `vikunja_url` value when embedding it in the query string.

## Use With Cursor

Put the example above into your MCP client config, then reconnect MCP servers.

The ready-to-copy sample also lives in `cursor-mcp.single-client.example.json`.
