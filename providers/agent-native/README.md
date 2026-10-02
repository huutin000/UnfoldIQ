# agent-native protocol (STEP-10C Branch B)

Agent-executed generation without product hard dependencies.

## Flow

1. **request** — a provider request (`capability` in `image/video/tts/stt`)
   reaches the `agent-native` adapter.
2. **adapter** — checks runtime-declared capabilities for this session:
   - `ctx.bridge = { capabilities[], execute }` (injected native tool), or
   - `ctx.agentSessionId` + session declaration in
     `providers/runtime/adapters/agent-native-registry.js`.
   - No declared capability → `unavailable AGENT_NATIVE_NOT_AVAILABLE`
     (or `AGENT_NATIVE_BRIDGE_NOT_CONFIGURED` when no bridge/session at all).
3. **HANDOFF_REQUIRED / AGENT_ACTION packet** — the adapter returns a
   handoff packet with `agentAction { action: 'AGENT_NATIVE_GENERATE',
   sessionId, agentName, toolName, capability, promptOrText,
   expectedSubmitCommand, continuity }`.
4. **agent native tool** — the agent (Antigravity, ZCode, OpenCode, or any
   other tool with local media skills) generates the artifact out-of-band
   using whatever tool it actually has. Capabilities are runtime-declared
   per session; never assume a specific product can do image/video/tts/stt.
5. **submit** — the agent writes a result doc conforming to
   `providers/agent-native/result-submission.schema.json` and runs:
   `node scripts/cli/provider-cli.js --submit-agent-result <result.json>`.
6. **validate/import** — the CLI validates the submission (schema, path
   safety, artifact presence, safety attestation), imports the file into
   `assets/<capability>/<sceneId>/<requestId>-agent.<ext>`, records
   provenance `{ agentName, toolName, submittedAt }`, and prints READY.
7. **READY** — downstream steps resume through the normal resolver path.

## Rules

- Capabilities are runtime-declared per session (`ctx.bridge` or a
  `capability-contract.schema.json` session declaration). Never assume
  Antigravity/ZCode/OpenCode media support.
- No product hard dependency: the repo never imports agent products;
  the bridge is injected by the runtime.
- Safety attestations are enforced at submit time (BLOCKED stays terminal).
- No secrets are serialized in handoff packets or READY results.
