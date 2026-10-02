# ZCode integration — unfoldiq-media MCP (STEP-10C Branch C)

Per https://github.com/zai-org/ZCode and zcode-plugins. No global edits.

## Option 1 — local project MCP config (use now)

Register the server in the project-local ZCode MCP configuration:

- Command: `node mcp/unfoldiq-media/server.js`
- Working directory: `D:\Project\UNFOLDIQ`
- Transport: stdio

Then call `media_capabilities` for the availability matrix and
`resolve_media_request` for dry-run selection before any generation tool
(`generate_image`, `generate_video`, `generate_tts`, `transcribe_media`).

## Option 2 — future plugin packaging (NOT publishing now)

A `zcode-plugins`-style packaged plugin wrapping this server is a possible
future step. Do not publish or install anything globally as part of STEP-10C.
Keep the local stdio registration above as the supported path.

## Health

```sh
node mcp/unfoldiq-media/tests/run.js
```

Exit 0 = pass (8 tools listed, capabilities READY, dry-run clean).
