# Antigravity integration — unfoldiq-media MCP (STEP-10C Branch C)

Per https://www.antigravity.google/docs/mcp. Register the local stdio server
in the Antigravity agent configuration (project scope, no global edits):

- Command: `node mcp/unfoldiq-media/server.js`
- Working directory: `D:\Project\UNFOLDIQ`
- Transport: stdio (JSON-RPC 2.0 over stdin/stdout, logs on stderr)

## Suggested flow

1. Call `media_capabilities` (`{}` or `{ "projectId": "<id>" }`) to learn
   which provider/capability rows are `AVAILABLE` vs `UNKNOWN`/`UNAVAILABLE`.
2. Call `resolve_media_request` with the provider request for a dry-run
   candidate order. No generation happens at this step.
3. For generation, call `generate_image` / `generate_video` / `generate_tts`
   / `transcribe_media`. Flow-backed rows return `AWAITING_USER_APPROVAL` or
   `HANDOFF_REQUIRED` — complete those in the Flow UI, never fabricate media.

## Agent-native submit-back

If the Antigravity runtime has a native image (or audio) tool that wrote a
real file inside the project, submit it back with `submit_media_result`
(`submission`: identity + project-relative `artifactPath` + `provenanceNote`
+ `rightsStatus`). Step09 `BLOCKED` is terminal. Do NOT assume native video:
verify a native video tool exists and produced a persistent file before
claiming video capability.
