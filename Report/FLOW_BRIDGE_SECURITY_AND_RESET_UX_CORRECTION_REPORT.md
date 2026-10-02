# FLOW BRIDGE — SECURITY AND RESET UX CORRECTION — REPORT

Date: 2026-10-01
Scope: remembered-token storage hardening (TRUSTED_CONTEXTS) + reset-token env-override warning.
Out of scope (per spec): Agent automation, POST-v1E.2G behavior, live validation.

## 1. Files changed

- `flow-companion/extension/src/background/service-worker.js` — startup call to `chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })`, guarded.
- `flow-companion/bridge/run.js` — `resolveBridgeToken` prints a reset warning + PowerShell remediation when `--reset-token` runs while `FLOW_BRIDGE_TOKEN` is set.
- `tests/flow/test-flow-bridge-remember.js` — 2 new test groups (9 assertions): TRUSTED_CONTEXTS static assertions + token-exposure review.
- `tests/flow/test-flow-bridge-token.js` — 1 new test group (7 assertions): reset-under-env-override behavior.
- `flow-companion/extension/.output/chrome-mv3/**` — rebuilt.

No Agent automation, content-script automation, adapter, or POST-v1E.2G code touched (extension delta is 13 lines in the service worker header only).

## 2. TRUSTED_CONTEXTS implementation

At service-worker startup (the extension's always-on trusted context):

```js
try {
  if (typeof chrome !== "undefined" && chrome.storage && typeof chrome.storage.local.setAccessLevel === "function") {
    chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }, () => void (chrome.runtime.lastError && true));
  }
} catch (e) { void e; }
```

- Content scripts lose direct `chrome.storage.local` read access once applied → the remembered Bridge token (`flowCompanionBridge.bridgeToken`) is not directly readable by them.
- Side panel + service worker are trusted contexts and keep full access (remember/auto-reconnect flows unchanged).
- Graceful fallback: if `setAccessLevel` does not exist (older runtimes) the call is skipped and `runtime.lastError` is swallowed; startup never breaks. Default behavior = pre-change semantics, no token exposure expansion.
- Still `chrome.storage.local` only; `chrome.storage.sync` remains unused (asserted by test).

## 3. Token ownership / exposure review

- Owner: side panel reads/writes the remembered credential (`persistRememberedToken`, `saveConfigSilent` read-modify-write, bootstrap restore). Service worker enforces the storage access level at startup. `background/bridge-client.js` remains fetch-agnostic with caller-injected config.
- Content scripts (`src/content/*`): verified by test — zero `chrome.storage` usage and zero `bridgeToken` references; they communicate via action/data messages only. No token moves through messages, DOM, logs, or diagnostics (pre-existing redaction asserted by the remember suite).
- Token never in URLs, never in `chrome.storage.sync`, never printed after creation/reset (bridge side asserted by token suite).

## 4. Reset warning behavior

`npm run flow:bridge:reset-token` with `FLOW_BRIDGE_TOKEN` present in the environment now prints (in addition to the normal one-time new-token display):

```text
FLOW_BRIDGE_RESET_WARNING: FLOW_BRIDGE_TOKEN is still set in this shell.
Future normal Bridge starts in this SAME shell will still use the environment override instead of the new persistent token.
PowerShell remediation: Remove-Item Env:FLOW_BRIDGE_TOKEN
```

- Rotation semantics unchanged: the persistent token file is still replaced and used for THIS run (reset intentionally bypasses the env override).
- The environment token itself is never printed (asserted by test, including with a realistic-looking secret value).
- Normal (non-reset) env-override starts remain warning-free (`FLOW_BRIDGE_TOKEN_SOURCE=ENV` stays the only signal).
- Verified on the real code path (`resolveBridgeToken` with env set, reset=true) — warning block above is the actual output shape.

## 5. Tests executed (exact results)

- `npm run test:flow` → **0 failed suites** (14 suites incl. the two updated ones).
- `node tests/flow/test-flow-bridge-token.js` → **47 passed, 0 failed** (40 previous + 7 new reset-warning assertions).
- `node tests/flow/test-flow-bridge-remember.js` → **30 passed, 0 failed** (21 previous + 9 new security assertions).
- `cd flow-companion/extension && npm test` → **passed=394 failed=0** (all Flow/POST-v1E.2G regressions green).
- Full other domains were green in the same-day cleanup baseline (`npm test` 56/59; the 3 real-render failures are the documented pre-existing `ffmpeg.exe spawn UNKNOWN` environment issue, unrelated to this change).

## 6. Build result

`cd flow-companion/extension && npm run build` → **BUILD_OK** (`29 files, MV3, minimal permissions`); `diff -q` confirms `.output/chrome-mv3/src/background/service-worker.js` is byte-identical to source (rebuild picked up the hardening). Reload the unpacked extension in Chrome to activate.

## 7. Remaining issues

- `setAccessLevel` cannot be exercised outside a real Chrome runtime (node tests cover it statically; behavior degrades gracefully on unsupported runtimes). Verify in the next normal live session that the panel still auto-reconnects (expected: yes — panel is a trusted context).
- The 3 pre-existing real-render environment failures (remotion `ffmpeg.exe` spawn block) remain out of scope, unchanged.

## 8. Final conclusion

**PASS**
