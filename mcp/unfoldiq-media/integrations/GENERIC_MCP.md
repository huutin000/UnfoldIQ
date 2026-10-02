# Generic MCP client — unfoldiq-media (STEP-10C Branch C)

Any MCP-compatible client can use this server over stdio.

## Stdio command

- Command: `node mcp/unfoldiq-media/server.js`
- Working directory (cwd): `D:\Project\UNFOLDIQ`
- Transport: stdio, JSON-RPC 2.0 line-delimited; logs on stderr only
- Dependencies: none beyond Node.js (builtins only, no `npm install`)

## Environment

- Base tools work with no secrets.
- Paid cloud rows additionally need provider keys in the server environment
  (`OPENAI_API_KEY`, `GEMINI_API_KEY` or `GOOGLE_API_KEY`,
  `ELEVENLABS_API_KEY`, `UNFOLDIQ_CONFIGURED_CLOUD_<CAP>_ENDPOINT/_KEY`)
  plus opt-in (`enableCloud` arg or `UNFOLDIQ_ENABLE_CLOUD=1`) plus
  per-request `costConstraints.allowPaidCloud=true`.

## Health / test

```sh
node mcp/unfoldiq-media/tests/run.js
```

Exit 0 = pass.

## Capability test

1. `initialize` → expect `protocolVersion: 2024-11-05`.
2. `tools/list` → expect 8 tools.
3. `tools/call media_capabilities {}` → expect `status: READY` with a
   provider matrix (availability `AVAILABLE`/`UNAVAILABLE`/`UNKNOWN`).
4. `tools/call resolve_media_request { request }` → expect `DRY_RUN` with
   `generated: false` and no `artifactPath`.

## Security notes

- Path traversal rejected (`PATH_TRAVERSAL_BLOCKED`); all artifacts stay
  inside `projects/<projectId>/`.
- Secret-like keys stripped from every response; keys never logged.
- `promptSummary` truncated to 200 chars; payloads bounded.
- Safety refusals return `PROVIDER_SAFETY_REFUSED` without retry or rewrite.
