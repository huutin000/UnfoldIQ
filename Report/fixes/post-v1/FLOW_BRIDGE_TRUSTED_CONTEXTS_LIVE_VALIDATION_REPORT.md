# FLOW BRIDGE TRUSTED_CONTEXTS — LIVE CHROME VALIDATION REPORT

Date: 2026-10-01
Scope: real-Chrome validation of the remembered-token + TRUSTED_CONTEXTS implementation.
No code was modified in this task (live validation exposed no real blocker; one minor cosmetic finding noted in §9).

## 1. Environment

- **Chrome**: 154.0.8037.92 (branded, x64) on Windows 11 Insider build 10.0.26300.
- **Extension**: UNFOLDIQ Flow Companion **v0.5.1** (manifest version), loaded unpacked from
  `flow-companion/extension/.output/chrome-mv3` (the build containing the setAccessLevel hardening;
  `diff`-verified byte-identical to source at build time).
- **Load method**: dedicated automation Chrome profile (temp dir, separate from the user's daily
  profile) + `--remote-debugging-port` + `--enable-unsafe-extension-debugging`, installed via the CDP
  `Extensions.loadUnpacked` mechanism → extension ID `caokkkcclnfdpecnjhbcekphlfkcjiic`, service
  worker target visible and running.
  Note: Chrome 137+ removed `--load-extension` (attempted first, silently rejected), and the
  chrome://extensions "Load unpacked" dialog flow completed 5× without installing (silent — recorded
  as an automation quirk of this Chrome build, not an extension problem; the same UI path works when
  driven by a human, as in previous live runs). The CDP mechanism performed the real install.
- **Bridge**: `npm run flow:bridge` with the persistent token from
  `%LOCALAPPDATA%\UNFOLDIQ\flow-bridge-token` (64 hex chars, first-run created earlier today).
  A test job (`LIVE-VAL-01`) was created via the normal authenticated `POST /jobs` API.
- All evidence below is **redacted**: the raw token never appears; it is reported only as
  "64-char token present / length 64".

## 2. First run: paste once → remember → connect (spec §2 inverted: fresh profile first-run)

- Fresh profile → side panel auto-bootstrapped: `connected Flow tabs: 1`, `ping=true`
  (content script live on `https://flow.google.com`), then stopped at
  `BRIDGE_TOKEN_REQUIRED` with the friendly error card — correct pre-config state.
- Pasted the 64-char token + ticked **"Nhớ mã truy cập trên thiết bị này"** → the token-input
  recovery path auto-ran the pipeline **without reload**: Flow tab re-resolved (`ping=true`),
  authenticated `GET /jobs` succeeded (`job fetched: … (AWAITING_USER_APPROVAL)`),
  and the token was persisted **only after that authenticated success**:
  `rememberToken=true`, `bridgeToken` present (length 64), `schemaVersion=1`.
- **PASS** — one copy/paste is sufficient; auto-connect works.

## 3. TRUSTED_CONTEXTS runtime result (spec §3)

Evaluated in every execution context of the live tabs (CDP `Runtime.evaluate` per context):

| Context | Origin | Result |
|---|---|---|
| Content-script **isolated world** (Flow tab) | `chrome-extension://caokkk…` (world name "UNFOLDIQ Flow Companion") | `chrome.storage.local.get` → **"Access to storage is not allowed from this context."** — remembered token NOT readable |
| Page main world (flow.google.com) | `https://flow.google.com` | `chrome.storage` not exposed at all (normal web page) |
| **Side panel** (trusted) | `chrome-extension://caokkk…/src/ui/sidepanel.html` | `readOk=true`, `rememberToken=true`, token readable — full access |
| **Service worker** (trusted, woken) | `…/src/background/service-worker.js` | `readOk=true`, `rememberToken=true`, token readable — full access |

- `chrome.storage.sync` is not used anywhere (asserted statically + no sync keys in storage).
- **No token leakage**: the side panel never renders the raw token after remembering
  (field value length 0 with placeholder "•••••••••••••• (đã nhớ trên thiết bị này)"), logs carry
  no token (verified across all captured log tails), and content scripts hold no token reference.
- **PASS**.

## 4. Reload extension / reopen side panel (spec §4)

- `chrome.developerPrivate.reload(<id>)` succeeded (`lastError: null`).
- Fresh side panel page after reload: token field EMPTY (raw token not echoed), placeholder
  "đã nhớ trên thiết bị này", remember checkbox restored checked, error card null, and the
  bootstrap pipeline **auto-reconnected with the remembered token**
  (`job fetched: … (AWAITING_USER_APPROVAL)`, `ping=true`) — no token re-entry.
- **PASS**.

## 5. Bridge offline → retention → restart → reconnect (spec §5)

- Bridge process stopped (`/health` unreachable).
- Panel action after the outage: status "Có lỗi" with the dedicated error card
  **"Không kết nối được Bridge… BRIDGE_UNREACHABLE: không thể kết nối Bridge tại http://127.0.0.1:4317 (Failed to fetch)"**
  (the new unreachable mapping working live).
- **Remembered token NOT deleted** by the outage: `rememberToken=true`, `bridgeToken` still present
  (length 64) in `chrome.storage.local`.
- Bridge restarted → Retry → status back to "Chờ duyệt" (awaiting approval = connected + job
  loaded), error card cleared, **no token paste** — pure remembered-token reconnect.
- (No media generation occurred at any point; the approval-path attempt while the bridge was down
  failed harmlessly with BRIDGE_UNREACHABLE and consumed nothing.)
- **PASS**.

## 6. "Quên mã truy cập" (spec §6)

- Clicked the button in Settings →
  `beforeHasToken=true` → `afterHasToken=false`, `afterRemember=false`;
  non-secret config kept (`bridgeUrl`, `projectId`, `jobId`, `schemaVersion`);
  Bridge URL preserved (`http://127.0.0.1:4317`); toast "Đã quên mã truy cập trên thiết bị này".
- Post-forget pipeline run returns to **token-entry state**: `BRIDGE_TOKEN_REQUIRED` error card,
  remember checkbox unchecked.
- **Bridge-side token unchanged** (no rotation — `/health` authenticated with the same persistent
  token after the test; rotation was not performed per task constraints).
- **PASS** (one cosmetic note, §9).

## 7. Automated suites unaffected (regression cross-check)

- `npm run test:flow` → 0 failed suites (bridge token 47/0, remember static 30/0, +12 flow suites).
- Flow Companion extension suite → passed=394 failed=0.
- These were re-run earlier the same day after the hardening change; no code changed since.

## 8. Redacted evidence log (key excerpts)

```text
[panel bootstrap, fresh profile]  connected Flow tabs: 1 | ping=true
[panel bootstrap, fresh profile]  fetch job failed: BRIDGE_TOKEN_REQUIRED
[token paste + remember]          job fetched: FLOW-COMPANION-LIVE-DRYRUN-01 (AWAITING_USER_APPROVAL)
[token paste + remember]          bridge token remembered on this device (storage.local)
[storage after connect]           { rememberToken: true, bridgeToken: <64 chars>, schemaVersion: 1 }
[content-script world]            "Access to storage is not allowed from this context."
[side panel / service worker]     readOk=true, rememberToken=true, tokenReadable=true
[bridge down]                     BRIDGE_UNREACHABLE: không thể kết nối Bridge tại http://127.0.0.1:4317
[bridge down]                     stored: rememberToken=true, bridgeToken=<64 chars> (retained)
[bridge restart + retry]          job fetched: FLOW-COMPANION-LIVE-DRYRUN-01 (AWAITING_USER_APPROVAL) — no token entry
[forget]                          { rememberToken: false } — bridgeToken key removed; URL/project/job kept
[after forget]                    BRIDGE_TOKEN_REQUIRED (token-entry state); bridge token not rotated
```

## 9. Minor findings (non-blockers, no code change made)

1. **Placeholder not reset by "Quên mã truy cập"**: after forgetting, the token field is empty and
   the checkbox unchecked (functionally token-entry state, enforced by BRIDGE_TOKEN_REQUIRED), but
   the field placeholder still reads "•••••••••••••• (đã nhớ trên thiết bị này)" until the next
   panel reopen. Cosmetic only; it never displays the raw token.
2. The chrome://extensions "Load unpacked" dialog flow in this Chrome 154 automation instance
   completed without installing 5× (silent). Same build installs fine via the CDP mechanism, and
   the user's interactive installs of earlier builds worked; recording as an automation-environment
   quirk.

## 10. Remaining issues

- NONE blocking. The setAccessLevel call is now verified live on this Chrome build; older-Chrome
  fallback remains covered by the guarded call + static tests.

## 11. Final conclusion

**PASS** — every real-Chrome check passed: first-run paste-once + remember, TRUSTED_CONTEXTS
enforcement (content-script world denied, trusted contexts full access), no token leakage through
DOM/logs/messages/diagnostics, extension reload + panel reopen auto-reconnect, offline token
retention with honest BRIDGE_UNREACHABLE reporting, reconnect without paste, and Quên mã truy cập
clearing the remembered credential without rotating the bridge token.
