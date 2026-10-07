# FLOW BRIDGE ONE COMMAND AND REMEMBER TOKEN — REPORT

Date: 2026-10-01
Spec: `D:\Downloads All\FLOW_BRIDGE_ONE_COMMAND_AND_REMEMBER_TOKEN_PROMPT.md`
Mode: ponytail full (minimum that works; no new dependencies; node built-ins only)

## Previous manual workflow

The operator set `FLOW_BRIDGE_TOKEN` in every shell session before starting the
bridge, then re-typed Bridge URL + token into Flow Companion on every panel
open. No persistence on either side.

## New token lifecycle

```
resolveBridgeToken (flow-companion/bridge/run.js):
  1. FLOW_BRIDGE_TOKEN env set → use for this process only
     (logs FLOW_BRIDGE_TOKEN_SOURCE=ENV; never printed, never persisted)
  2. token file exists and non-empty → reuse
     (logs FLOW_BRIDGE_TOKEN_SOURCE=LOCAL_FILE)
  3. neither → crypto.randomBytes(32).toString("hex") (256-bit),
     exclusive-create ("wx", 0600) to the persistent file, print ONCE
     (FLOW_BRIDGE_TOKEN_CREATED=true + raw token, terminal only)
  --reset-token → same as 3 but overwrites the existing file
```

Unreadable or empty persistent token file → `FLOW_BRIDGE_TOKEN_ERROR` and the
bridge refuses to start. No silent rotation: that would unexpectedly
invalidate the token the extension remembers. Explicit reset required.

## Persistent token path

`%LOCALAPPDATA%\UNFOLDIQ\flow-bridge-token` (resolved via env; fallback
`~/.unfoldiq/UNFOLDIQ/flow-bridge-token` on non-Windows). Outside the
repository by construction — verified by test.

## Environment override behavior

Precedence: env > local file > generate. ENV path does not overwrite the
persistent file. Reset ignores env and rotates the persistent file. Min length
16 enforced on env tokens.

## npm scripts (root package.json)

- `npm run flow:bridge` → `node flow-companion/bridge/run.js --port 4317`
- `npm run flow:bridge:reset-token` → same + `--reset-token`

## start-flow.ps1

Repository-root wrapper. Uses `$PSScriptRoot` (no hard-coded path), verifies
`package.json` exists, runs `npm run flow:bridge`. Foreground; Ctrl+C stops
the bridge.

## Extension remember-on-device

- Settings → "Nhớ mã truy cập trên thiết bị này" checkbox (explicit opt-in,
  unchecked by default) + "Quên mã truy cập" button.
- Token is persisted to `chrome.storage.local` under the existing
  `flowCompanionBridge` key (`{ bridgeUrl, projectId, jobId, rememberToken,
  bridgeToken?, schemaVersion: 1 }`) ONLY after an authenticated bridge call
  succeeded (`fetchJob` → `persistRememberedToken`). An unverified/wrong token
  is never persisted.
- `saveConfigSilent` is read-modify-write: a bridge outage or failed job fetch
  can never erase a remembered token; the token key is removed only when the
  user unchecks the box or presses "Quên mã truy cập".
- On panel open, a remembered token is restored into connection state before
  the auto-bootstrap pipeline runs → authenticated auto-reconnect, no paste.
- Remembered token is never echoed back into the DOM (placeholder
  "đã nhớ trên thiết bị này" only) and never logged.
- Auth rejection (`TOKEN_REJECTED` / HTTP 401) maps to a dedicated message
  ("Mã truy cập Bridge không còn hợp lệ…") and a single pipeline failure —
  no reconnect loop. Bridge-unreachable maps to `BRIDGE_UNREACHABLE`
  ("Hãy chạy npm run flow:bridge rồi thử lại" guidance via bridge error card).

## Storage / security decision

- `chrome.storage.local` only; `chrome.storage.sync` is never used for the
  token (asserted by test).
- Token ownership stays where it already was: side panel (and the
  fetch-agnostic `background/bridge-client.js` helper, config injected by the
  caller). Content scripts never receive the token — no exposure expansion,
  no refactor needed. TRUSTED_CONTEXTS access-level restriction: not applicable
  (no new trusted-context surface introduced).
- Bridge auth now uses constant-time comparison
  (`security.tokenMatches`: SHA-256 digest then `crypto.timingSafeEqual`,
  so token length never leaks). Missing/wrong/correct behavior unchanged;
  transport stays in the `x-bridge-token` header — never in URLs.
- Logs: bridge logs only the source marker; the raw token is printed exactly
  once (first creation or explicit reset), in the local terminal only.
  No token in reports, job JSON, request dumps, or toasts.

## Token reset flow

`npm run flow:bridge:reset-token` → new token generated + persisted + printed
once → old token rejected (timing-safe compare against new value) → extension
shows the rotated-token error → user pastes the new token once, keeps the
remember checkbox ticked → `persistRememberedToken` overwrites the stored
token on the next successful authenticated call. Documented in
`flow-companion/README.md`.

## Changed files

- `flow-companion/bridge/run.js` — token resolution/generation/reset, first-run
  output, `--reset-token`; exports `resolveBridgeToken`/`defaultTokenFile`.
- `flow-companion/bridge/security.js` — added `tokenMatches` (constant-time).
- `flow-companion/bridge/server.js` — auth check uses `tokenMatches`.
- `package.json` (root) — `flow:bridge`, `flow:bridge:reset-token` scripts.
- `start-flow.ps1` (new).
- `flow-companion/extension/src/ui/sidepanel.html` — remember checkbox +
  forget button + hints.
- `flow-companion/extension/src/ui/sidepanel.js` — `BRIDGE_UNREACHABLE`
  mapping, rotated-token error, read-modify-write storage, remember/forget,
  bootstrap auto-reconnect.
- `flow-companion/README.md` — setup/rotation docs.
- `test-flow-bridge-token.js` (new), `test-flow-bridge-remember.js` (new).

## Tests

New suites (plain node, zero deps):
- `test-flow-bridge-token.js` — 40 assertions / 0 failed: generation is
  64-hex from randomBytes(32); persisted outside repo; first run prints once;
  second run reuses + never prints; env override without overwrite; reset
  produces a different token and old token fails; EEXIST race keeps the
  other process's token (no corruption/overwrite); unreadable/empty file
  fails safely without rotation; tokenMatches missing/wrong/correct; spawned
  first/second run output contracts; bind stays 127.0.0.1, port 4317;
  package.json + start-flow.ps1 static assertions.
- `test-flow-bridge-remember.js` — 21 assertions / 0 failed: checkbox/forget
  UI present and opt-in; storage.local only (no sync); token persisted only
  after authenticated call; uncheck/forget clears; read-modify-write keeps
  token through outages; token never rendered/logged; remembered token
  restored before auto-pipeline.

Regression (all PASS, nothing weakened):
- `node test-flow-bridge.js` → 15/15 assertions, 0 failed
- `node test-flow-jobs.js` → 34/0
- `node test-flow-postv1e.js` → 56/0
- `node test-flow-safety-retry.js` → 34/0
- `node test-flow-state-machine.js` → 15/0
- `flow-companion/extension` `npm test` → passed=356 failed=0
- `flow-companion/extension` `npm run build` → BUILD_OK (29 files)

## Acceptance results (terminal parts, run live 2026-10-01)

- First run `npm run flow:bridge` (no env, no token file):
  `FLOW_BRIDGE_TOKEN_CREATED=true`, token printed once (64 hex),
  `FLOW_BRIDGE_LISTENING host=127.0.0.1 port=4317`,
  `FLOW_BRIDGE_URL=http://127.0.0.1:4317` — PASS. Token persisted to
  `%LOCALAPPDATA%\UNFOLDIQ\flow-bridge-token`.
- Second run: `FLOW_BRIDGE_TOKEN_SOURCE=LOCAL_FILE`, raw token NOT printed —
  PASS.
- `.\start-flow.ps1`: identical bridge behavior, no env setup — PASS.
- `npm run flow:bridge:reset-token`: covered by unit tests (new token, old
  rejected, file replaced).

## Known limitations / pending live validation

- Extension UI behaviors (checkbox persist on successful connect, auto-
  reconnect after panel restart, outage-does-not-clear, forget action,
  rotated-token re-entry) are covered by static regressions only; LIVE
  VALIDATION PENDING USER (§27–§30 browser steps, incl. the 3-run gate).
- §25 items 23–35 require a real browser profile; not automatable here.
- The extension build output (`extension/.output/chrome-mv3`) must be
  reloaded in Chrome to pick up the side-panel changes.
- Reset while `FLOW_BRIDGE_TOKEN` env is set: the reset rotates and uses the
  persistent file for that run (env override is bypassed by design; remove
  the env var for normal operation).

No real token appears in this report.
