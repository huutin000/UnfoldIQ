# OpenCode integration — unfoldiq-media MCP (STEP-10C Branch C)

Per https://opencode.ai/v2/docs/mcp-servers. Project-local config only.
Do NOT auto-edit the global config.

## Project-local config

Create `.opencode/mcp.json` in the repo root (`D:\Project\UNFOLDIQ`):

```json
{
  "mcp": {
    "unfoldiq-media": {
      "type": "local",
      "command": ["node", "mcp/unfoldiq-media/server.js"],
      "cwd": "D:\\Project\\UNFOLDIQ",
      "enabled": true
    }
  }
}
```

No external dependencies are required (Node.js builtins only), so no
`npm install` step is needed before starting the server.

## Health command

```sh
node mcp/unfoldiq-media/tests/run.js
```

Expect exit code 0: initialize handshake ok, `tools/list` count == 8,
`media_capabilities` READY, dry-run resolve with no-generation marker.

## Capability test example

1. Call `media_capabilities` with `{}` — expect a `READY` matrix with rows
   per registered provider (availability `AVAILABLE`/`UNAVAILABLE`/`UNKNOWN`,
   never a static live guarantee).
2. Call `resolve_media_request` with a provider request object — expect
   `status: DRY_RUN`, `dryRun: true`, `generated: false`, and a
   `candidateOrder` list. No artifact is produced.
3. `submit_media_result` accepts an agent-produced file already inside the
   project (path-confined, Step09 `BLOCKED` terminal) and returns `READY`.
