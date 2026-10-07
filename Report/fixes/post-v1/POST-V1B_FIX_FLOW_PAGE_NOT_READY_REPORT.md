# POST-v1B FIX REPORT — FLOW_PAGE_NOT_READY DURING ZERO-CREDIT DRY-RUN

Date: 2026-09-29
Fix spec: `POST-V1B_FIX_FLOW_PAGE_NOT_READY.md` (handoff §20–§23)
Scope: `live page → prompt injection → verify → stop safely`. No other controls solved. No Generate click. No credit consumption.

## 1. Status

`CODE_FIX_COMPLETE — LIVE DRY-RUN PENDING USER BROWSER RUN` (NOT_VERIFIED live, per reporting policy)

## 2. Root cause (evidence-based)

`INSERT_PROMPT_DRYRUN` in `flow-companion/extension/src/content/content-commands.js` gated prompt insertion behind
`adapter.prepareJob(root, { capability })`, which requires `PROMPT_INPUT + MODE_IMAGE/MODE_VIDEO + GENERATE_BUTTON +
RESULT_CONTAINER`.

Latest live probe state (handoff §20–§21):

```text
PROMPT_INPUT      DEGRADED (found via [contenteditable="true"])
GENERATE_BUTTON   DEGRADED (found via button[type="submit"], disabled — expected pre-insert)
MODE_*            DEGRADED/FAIL
RESULT_CONTAINER  FAIL
```

→ `prepareJob` returned `{ manualAssist: true, missing: [MODE_*, RESULT_CONTAINER, ...] }`
→ dispatcher mapped it to the generic `FLOW_PAGE_NOT_READY`
→ dry-run aborted **before any prompt insertion**, although the page was fully capable of accepting a prompt.

This is exactly the "global page-ready gate" anti-pattern the fix spec §1 predicted.

## 3. Fix implemented

### 3.1 Capability-scoped readiness (`flow-page-adapter.js`)

New functions (exported in both node module and browser namespace):

- `isPromptWritable(el)` — interactability check: not disabled/readonly, and contenteditable / textarea / input.
- `assessDryRunReadiness(root)` → `{ prompt: {found, writable, matchedSelector, fallbackUsed}, generate: {found, enabled, fallbackUsed}, PROMPT_READY, DRY_RUN_READY }`.
  - `PROMPT_READY` = prompt found + writable.
  - `DRY_RUN_READY` = PROMPT_READY + Generate control **found**. Disabled Generate is explicitly allowed (§2/§22 of fix spec).
  - Optional controls (`MODEL_CONTROL`, `GENERATION_TYPE`, `MODE_IMAGE/VIDEO`, `OUTPUT_COUNT`, `CREDIT_DISPLAY`, `RESULT_*`, `DOWNLOAD_CONTROL`) are deliberately **not** required (§10: do not over-fix).
- `verifyPromptContent(el, expectedText)` — visible-DOM verification against the control's actual `value`/`textContent`/`innerText` (whitespace-normalized containment).
- `dispatchEditEvents(el)` — normal `InputEvent("input", {bubbles:true})` (Event fallback) + `change` for textarea/input.

### 3.2 Contenteditable prompt insertion (`insertPromptDryRun` rewritten)

Per fix spec §5:

- focus → select existing contents → `document.execCommand("insertText", false, text)` (ordinary browser editing semantics the page's own handlers observe);
- falls back to `textContent` assignment when execCommand/selection is unavailable (mocked DOMs);
- normal input/change events dispatched after insertion;
- no private Google APIs, no framework-private properties, no session/auth scraping;
- evidence now includes `verified`, `insertMethod` (`execCommand:insertText` | `textContent` | `value`), plus the existing zero-credit fields.
- Insertion failure throws/returns `PROMPT_INSERT_FAILED`; text-not-visible-after-insert reports `verified: false` → `PROMPT_VERIFY_FAILED`.

### 3.3 Dry-run execution order (`content-commands.js` `INSERT_PROMPT_DRYRUN`)

`prepareJob` removed from the dry-run path (it remains for the future real-generation path). New order (fix spec §3):

```text
assessDryRunReadiness()
→ PROMPT_INPUT_NOT_FOUND          if prompt not found
→ PROMPT_INPUT_NOT_WRITABLE       if not writable
→ GENERATE_CONTROL_NOT_FOUND      if Generate not found (disabled is fine)
→ assert DRY_RUN_READY
→ insertPromptDryRun()
→ PROMPT_INSERT_FAILED            on insert exception
→ PROMPT_VERIFY_FAILED            if verified=false
→ re-read Generate → generateEnabledAfterPrompt / GENERATE_STILL_DISABLED_AFTER_PROMPT (observation, NOT a failure)
→ STOP — never clicks Generate
```

`PROMPT_INJECTION_PASS` (dry-run ok) is now separate from `GENERATION_SETTINGS_READY` (Generate enabled after prompt), per fix spec §6.

### 3.4 Error classification (`service-worker.js`)

`ERROR_CODES` extended (fix spec §7) with: `FLOW_TAB_NOT_FOUND`, `PROMPT_INPUT_NOT_WRITABLE`, `PROMPT_INSERT_FAILED`, `PROMPT_VERIFY_FAILED`, `GENERATE_STILL_DISABLED_AFTER_PROMPT`, `GENERATION_SETTINGS_NOT_RESOLVED`. `FLOW_PAGE_NOT_READY` remains reserved for genuinely unresolved base page state; the dry-run path no longer emits it.

### 3.5 Side panel (`sidepanel.js`)

`onDryRun` now logs the readiness levels, `verified`, `insertMethod`, `generateEnabledAfterPrompt`, the still-disabled observation, and observed model/aspect/cost; failures log the precise code + readiness detail instead of the generic `FLOW_PAGE_NOT_READY`.

## 4. Security posture unchanged

- No new permissions; manifest untouched; no `<all_urls>` (build.js still fails on it).
- No cookie/token/session access anywhere in the changed paths (M4 assertions still pass).
- Approval gate untouched: dry-run still never reaches `SUBMIT_GENERATE`; `consumeLocalApproval` unchanged.
- Probe/verification reads only the prompt control's own visible text; no unrelated page content read or persisted.

## 5. Verification (command output)

| Check | Result |
|---|---|
| `node test-flow-postv1b.js` (now incl. R1–R7 readiness regressions) | `SUMMARY: passed assertions 177, failed tests 0 — ALL TESTS PASSED` |
| `flow-companion/extension` `npm test` | `passed=6 failed=0` |
| `test-flow-page-adapter.js` | ALL TESTS PASSED |
| `test-flow-manual-assist.js` | ALL TESTS PASSED |
| `test-flow-bridge.js` | ALL TESTS PASSED |
| `test-flow-jobs.js` | ALL TESTS PASSED |
| `test-flow-state-machine.js` | ALL TESTS PASSED |
| `test-flow-download-import.js` | ALL TESTS PASSED |
| `test-flow-origin.js` | ALL TESTS PASSED |
| `test-flow-safety-retry.js` | ALL TESTS PASSED |
| `test-agent-native-bridge.js` | ALL TESTS PASSED |
| `flow-companion-doctor.js` | 18/18 OK |
| `npm run build` (extension) | `BUILD_OK: .output/chrome-mv3 (12 files, MV3, minimal permissions)` |
| Staged output spot-check | readiness gate + new error codes present in `.output/chrome-mv3` |

### New regressions (fix spec §9)

- **R1** optional selectors FAIL but `DRY_RUN_READY = true` (contenteditable prompt + disabled `button[type=submit]`; MODEL/GEN-TYPE/OUTPUT/CREDIT absent) — PASS
- **R2** Generate disabled before prompt is not a readiness failure — PASS
- **R3** contenteditable prompt populated + verified (execCommand path and textContent fallback) — PASS
- **R4** dry-run click count on Generate stays `0` — PASS
- **R5** prompt missing → `PROMPT_INPUT_NOT_FOUND` — PASS
- **R6** Generate missing → `GENERATE_CONTROL_NOT_FOUND` — PASS
- **R7** tab-resolver regression (L10) intact + unverifiable control → `PROMPT_VERIFY_FAILED` + new codes registered — PASS

## 6. Live status — NOT_VERIFIED (honest boundary)

The live dry-run has **not** been re-executed after this fix (agent has no access to the authenticated Flow session; fix spec §11 forbids auto-running it). The following remain `NOT_VERIFIED` until the user-side run:

- live `PROMPT_READY` / `DRY_RUN_READY` = PASS on the real Flow page
- live `promptInserted: true, promptVerified: true`
- live `generateEnabledAfterPrompt: true|false` observation
- `generateClicked: false, creditsConsumed: 0` on the live run

## 7. User instruction (next live run)

```text
1. chrome://extensions → Reload "UNFOLDIQ Flow Companion"
2. Refresh the Google Flow tab
3. Open the side panel → Save config
4. Check Flow tab   (expect matched=1, ping=true)
5. Fetch job        (FLOW-COMPANION-LIVE-DRYRUN-01)
6. Run dry-run (zero credit)
```

Expected log:

```text
readiness: PROMPT_READY=PASS DRY_RUN_READY=PASS
dry-run inserted=true verified=true clickedGenerate=false creditsConsumed=false
DRY-RUN PASS (PROMPT_INJECTION): prompt inserted and verified, stopped before Generate.
```

If the prompt appears in Flow but Generate stays disabled, the log will show `GENERATE_STILL_DISABLED_AFTER_PROMPT` — that is an observation for checkpoint 4 (resolve minimum generation controls), **not** a dry-run failure.

## 8. Files modified

- `flow-companion/extension/src/content/flow-page-adapter.js` — readiness + writable + verify + edit-events helpers; `insertPromptDryRun` rewritten (contenteditable, verified evidence); exports extended (module + window namespace)
- `flow-companion/extension/src/content/content-commands.js` — `INSERT_PROMPT_DRYRUN` capability-scoped gate + precise error codes + post-insert Generate observation
- `flow-companion/extension/src/background/service-worker.js` — `ERROR_CODES` extended (6 new precise codes)
- `flow-companion/extension/src/ui/sidepanel.js` — dry-run logging per §8 of fix spec
- `test-flow-postv1b.js` — R1–R7 regression section (7 new tests, +37 assertions total since last report)
- `flow-companion/extension/.output/chrome-mv3/` — rebuilt
- No architecture replaced; tab resolver, bridge, approval gate, security untouched.
