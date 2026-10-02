# unfoldiq-media MCP server (STEP-10C Branch C)

MCP is a bridge/protocol. It does not itself provide GPU, video model, image model, or TTS model. The backend/provider still supplies compute.

This server exposes the UNFOLDIQ provider runtime over MCP stdio: capability
matrix, dry-run request resolution, image/video/TTS generation, STT
transcription, agent result submit-back, and Flow job lookup. All generation
delegates to `providers/runtime/resolver.js`; no resolver logic is duplicated.

## Stdio usage

Run from the repo root (`D:\Project\UNFOLDIQ`):

```sh
node mcp/unfoldiq-media/server.js
```

The server speaks JSON-RPC 2.0 line-delimited over stdin/stdout. Logs go to
stderr only. Supported methods: `initialize`, `tools/list`, `tools/call`,
`notifications/cancelled` (ack). The server exits cleanly when stdin closes.

No external dependencies — only Node.js builtins — so it runs without
`npm install`.

## Working directory and env

- Expected cwd: repo root `D:\Project\UNFOLDIQ` (server resolves
  `PROJECT_ROOT` as two levels above `server.js`, so any cwd works as long as
  the file layout is intact).
- Cloud providers additionally require `ctx.enableCloud`-equivalent opt-in
  (`enableCloud` tool arg or `UNFOLDIQ_ENABLE_CLOUD=1`) plus per-request
  `costConstraints.allowPaidCloud=true`, plus provider API keys:
  `OPENAI_API_KEY`, `GEMINI_API_KEY` (or `GOOGLE_API_KEY`),
  `ELEVENLABS_API_KEY`, `UNFOLDIQ_CONFIGURED_CLOUD_<CAP>_ENDPOINT/_KEY`.
- Backend keys are read from the environment only and are never echoed in
  responses.

## Health / test command

```sh
node mcp/unfoldiq-media/tests/run.js
```

Checks initialize handshake, `tools/list` count (8), `media_capabilities`
matrix, and a dry-run `resolve_media_request` with no-generation marker.
Exit code 0 = pass, 1 = fail.

Capability smoke test (from repo root):

```sh
echo {"jsonrpc":"2.0","id":1,"method":"initialize","params":{}} | node mcp/unfoldiq-media/server.js
```

## Security notes

- Path traversal rejected everywhere via `resolveProjectPath`; absolute and
  `..` escapes return `PATH_TRAVERSAL_BLOCKED`.
- Responses strip keys matching `secret|token|api[_-]?key|password|credential|auth`.
- `promptSummary` truncated to 200 chars; tool text payloads bounded (~32 KB).
- Cloud generation is disabled by default (double opt-in); paid adapters are
  `PAID` cost class so the resolver skips them under `SKIPPED_COST_POLICY`.
- Safety refusals surface as `PROVIDER_SAFETY_REFUSED` and are never
  auto-retried or rewritten by this bridge.
