# POST-v1E FIX — AUTO-PREPARATION STALL AFTER JOB FETCH — REPORT

Date: 2026-09-30
Extension version: 0.5.0 → **0.5.1**
Scope: fix per `D:\Downloads All\POST-V1E_FIX_AUTO_PREPARATION_STALL.md`

---

## 1. Status

`POST-v1E AUTO-PREPARATION STALL FIX: LIVE VALIDATION PENDING`

All code fixes implemented, 46/46 unit/regression tests pass, build OK. Real-browser live validation (§27/§28) remains for the user.

## 2. Exact live symptom

After Bridge token entry, the side panel fetched `FLOW-COMPANION-LIVE-GEN-01 (PREPARED)` successfully, then logged nothing further. Normal UI stayed at `Đang chuẩn bị…` forever with a disabled CTA; Developer Mode showed the stale placeholder `Đang chờ kết nối content-script…` although `liveTab ping=true`.

## 3. Root cause (control-flow traced, not guessed)

Three stacked defects, all verified in source:

1. **UI-state deadlock (the visible stall).** `uiStateForJob()` mapped `PREPARED`/`VALIDATED` → `"PREPARING"` unconditionally. When the pipeline finished without readiness, `render()` displayed "Đang chuẩn bị…" with `ctaEnabled=false` — permanently, with no retry path. This is exactly the live symptom.
2. **Readiness deadlock (the functional stall).** `assessGenerationReady()` counted `APPROVAL_NOT_RECORDED` as missing unless the bridge job was already `AWAITING_USER_APPROVAL`, but `markAwaitingApproval()` only ran when `ready === true`. A `PREPARED` job could therefore never become ready — a circular dependency.
3. **Preparation pipeline never existed.** The POST-v1E adapter functions (`ensureStandardMode`, `selectGenerationType`, `selectAspect`, `selectOutputCount`, `openGenerationSettings`) were defined but **nothing called them** — there was no `PREPARE_GENERATION` command. The old pipeline only did `INSERT_PROMPT_DRYRUN` + `GET_GENERATION_STATE`.

Contributing defects: no token-recovery re-entry (§7), no canonical content-script diagnostic (§12 — dev tools gated on a divergent `devMode` flag while auto-bootstrap force-showed the section, freezing the static placeholder), no stage logs, no watchdog, single-flight only on the CTA guard.

## 4. Token-recovery flow (§7, §20)

`sidepanel.js` now listens on the `bridge-token` field (input + change, 500 ms debounce). When a token is entered and the panel is latched (`BRIDGE_TOKEN_REQUIRED` error, `NEED_CONFIG`, `NEED_FLOW`, `ERROR_RETRYABLE`, or no job), it calls `preparer.reset()` (clears stale error state, in-flight set, and completed-key latch) and re-runs the pipeline via the existing single-flight guard. No panel reload required. Token stays memory-only (never persisted).

## 5. Canonical auto-preparation orchestration (§5, §6, §15)

New module `src/ui/state/auto-prepare.js` — `createAutoPreparer()` with the single entry point `ensureCurrentJobPrepared(job)`:

- `PREPARED`/`VALIDATED` → `prepareLiveGeneration()` — resolves the live tab, sends the new **`PREPARE_GENERATION`** content command, emits `autoPrepare:` stage logs, freezes the approval snapshot, transitions the bridge job to `AWAITING_USER_APPROVAL`, UI → `Sẵn sàng`, **STOP** (§16 — Generate is never clicked).
- `AWAITING_USER_APPROVAL` → `hydrateApprovalSnapshot()` — re-probes readiness, re-freezes the snapshot.
- `GENERATING`/`RESULT_DETECTED`/`DOWNLOADING`/`IMPORTED` → read-only `resumeCurrentAttempt()` (side panel captures a fresh result baseline first, so pre-existing media is never attributed to the attempt, per POST-v1E §28).
- `READY` → `showReady()`; default → honest state mapping.

`sidepanel.js` keeps zero Flow DOM knowledge: preparation runs in the content script via `PREPARE_GENERATION` (`content-commands.js`), which orchestrates the existing adapter functions only: prompt readiness+verified insert → `ensureStandardMode` → `selectGenerationType("IMAGE")` → `selectAspect("1:1")` → `selectOutputCount(1)` (aspect/output only where the live UI exposes the control, per §28 "where exposed") → model/cost read → `assessGenerationReady` with `approvalPendingExpected: true`. Every failure returns a precise per-stage code (§17): `PROMPT_INPUT_NOT_FOUND`, `PROMPT_INPUT_NOT_WRITABLE`, `PROMPT_INSERT_FAILED`, `PROMPT_VERIFY_FAILED`, `AGENT_MODE_DETECTED`, `GENERATION_TYPE_NOT_IMAGE`, `TARGET_ASPECT_NOT_AVAILABLE`, `ASPECT_VERIFY_FAILED`, `OUTPUT_COUNT_NOT_AVAILABLE`, `OUTPUT_COUNT_VERIFY_FAILED`, `GENERATION_NOT_READY` — never a generic `PREPARATION_FAILED`.

The readiness deadlock is fixed in the adapter: `assessGenerationReady(root, { approvalPendingExpected: true })` does not count `APPROVAL_NOT_RECORDED` during the pre-approval preparation stage (the transition happens only after readiness). Default behavior (without the flag) is unchanged.

## 6. Single-flight behavior (§8, §22)

Material key = `jobId | attempt | fingerprint(status+prompt)`. Same key in-flight → duplicate triggers ignored; completed same key → no rerun; material change (e.g. new attempt) → new key. Verified by test: three concurrent triggers (panel init / config change / job refresh) → exactly one `PREPARE`.

## 7. Content-script diagnostic fix (§12, §13, §23)

- The canonical source of truth is `resolveLiveFlowTab()` + `tabs.sendMessage(PING)`: every worker response now records `lastResolution` (tabId, origin, ping, source, timestamp) in the side panel, stamped into diagnostics as `contentScriptStatus: CONNECTED | NOT_CONNECTED` + tabId/Origin/Nguồn/Ping lần cuối.
- `developer-tools.js` renders `Content script: Đã kết nối` from that ping; port presence (`helloPorts`) is supplementary and can never contradict it (old tab bug stays fixed — routing still goes through the action-time resolver, §14).
- Auto-bootstrap bug fixed: the dev-mode checkbox, the dev-tools section visibility, and the `devMode` flag now agree; while no ping has happened the panel shows an honest "Chưa kết nối (đang chờ PING đầu tiên)" line instead of a frozen stale placeholder.

## 8. State mapping (§10, §11, §24)

`ui-state.js` no longer lies:

| Situation | Normal UI |
|---|---|
| PREPARED + actively preparing | Đang chuẩn bị… (CTA disabled, watchdog-bounded) |
| PREPARED + token absent | Cần cấu hình (`NEED_CONFIG`) |
| PREPARED + preparation failed / finished unready / idle | **Cần xử lý** (new `NEED_ATTENTION` state) + `Thử lại` |
| AWAITING_USER_APPROVAL | Sẵn sàng + `Duyệt & Tạo` |
| READY | Hoàn tất |

## 9. Error handling (§10, §17, §18)

- **Watchdog**: if preparation produces no completion within 120 s, the orchestrator emits `PREPARATION_TIMEOUT`, UI → "Không thể hoàn tất chuẩn bị." + `[Thử lại]`, and Developer Mode keeps the precise last stage/code. The watchdog is only a stalled-orchestration breaker — never a fixed-sleep success signal.
- **Retry** (`Thử lại` / CTA): resolves a fresh tab, re-fetches fresh job state, restarts zero-credit preparation — no stale DOM nodes.
- `friendlyError` maps all precise preparation codes to a dedicated Vietnamese message while preserving the exact code under "Chi tiết kỹ thuật".

## 10. Tests

`extension/tests/run.js` (plain node, zero deps): **46 passed, 0 failed** (`npm test`).

New regressions, mapped to the fix doc: §20 token recovery (latch cleared, prepare runs once, no reload), §21 PREPARED auto-advance, §22 single-flight (3 concurrent triggers → 1 prepare), §8 new-key-on-material-change, §23 canonical ping wins (`Đã kết nối` rendered from ping despite no port evidence), §24 failed preparation (`SETTINGS_POPOVER_NOT_OBSERVED` preserved; UI = Cần xử lý + Thử lại; no spinner; no bridge transition), §25 successful preparation (snapshot frozen, `AWAITING_USER_APPROVAL`, `clickedGenerate=false`, `creditsConsumed=false`, Generate click count 0), §10 watchdog (`PREPARATION_TIMEOUT` on a never-settling prepare), plus adapter tests for `approvalPendingExpected` and an end-to-end `PREPARE_GENERATION` dispatch on a mock Flow page (prompt+IMAGE+1:1+output=1+model+cost verified, Generate never clicked).

## 11. Security regression (§26)

No manifest permission changes (only version bump 0.5.0 → 0.5.1). Kept: bridge token memory-only (still not persisted by `saveConfigSilent`), no cookies permission, no private Flow API, no `<all_urls>`, no password persistence, no remote executable code. Build-time credential scan passes.

## 12. Files modified

- `extension/src/ui/state/auto-prepare.js` — **new** canonical orchestrator (node-testable, wired as `window.FlowAutoPrepare`)
- `extension/src/content/content-commands.js` — new `PREPARE_GENERATION` command (zero-credit preparation pipeline, precise stage codes)
- `extension/src/content/flow-page-adapter.js` — `assessGenerationReady` option `approvalPendingExpected` (fixes the readiness deadlock)
- `extension/src/ui/state/ui-state.js` — honest mapping; new `NEED_ATTENTION` state
- `extension/src/ui/sidepanel.js` — orchestrator wiring, token recovery listener, `autoPrepare:` stage logs, canonical content-script diagnostics, watchdog, honest `NEED_CONFIG` on `BRIDGE_TOKEN_REQUIRED`
- `extension/src/ui/components/developer-tools.js` — content-script status fields from canonical ping; honest pending renderer
- `extension/src/ui/state/labels.vi.js` — `statusAttention`, `errPreparationTitle`, `errPreparationBody`
- `extension/src/ui/sidepanel.html` — `auto-prepare.js` script tag (before `sidepanel.js`)
- `extension/build.js` — `auto-prepare.js` added to REQUIRED_FILES
- `extension/manifest.json` — version 0.5.1
- `extension/tests/run.js`, `extension/tests/mock-dom.js` — new tests + `tagName` on the mock element

## 13. Live validation status

**PENDING USER.** Steps (§27): `chrome://extensions` → Reload extension → refresh the Flow tab → open the Side Panel → enter the Bridge token once if asked. Expected without any infrastructure click: `Đang chuẩn bị…` → `Sẵn sàng` with `[Duyệt & Tạo]`, and `autoPrepare:` stages in the developer log. Do **not** press `Duyệt & Tạo` during this validation.

## 14. Remaining blocker

None known in code. Live pass requires the real browser session (§28): `FLOW-COMPANION-LIVE-GEN-01` must reach `AWAITING_USER_APPROVAL` with `generationType=IMAGE verified=true`, `aspect=1:1 verified=true` (where exposed), `outputCount=1` or honest UNKNOWN, exact live model/cost or UNKNOWN, Generate found+enabled, snapshot frozen — and the normal UI showing `● Sẵn sàng [Duyệt & Tạo]`.

Note for live validation: the new `PREPARE_GENERATION` pipeline enforces settings selection against the real Flow DOM. If Flow's actual UI doesn't expose a control (e.g. aspect), the panel will surface the precise code (e.g. `TARGET_ASPECT_NOT_AVAILABLE`) instead of a silent stall — that is the intended §17 behavior and would identify the exact selector to add next, all still owned by `FlowPageAdapter`.

## 15. Conclusion

The stall had three verified root causes (unconditional PREPARED→PREPARING mapping; readiness/approval circular dependency; a never-wired preparation pipeline). All are fixed with a single canonical orchestrator (`ensureCurrentJobPrepared`), single-flight keys, token recovery, a bounded watchdog, honest state mapping, canonical ping-based diagnostics, and full stage logging. No Generate clicks, no credit consumption, no UI redesign, no new permissions.

**Before live validation: `POST-v1E AUTO-PREPARATION STALL FIX: LIVE VALIDATION PENDING`**
