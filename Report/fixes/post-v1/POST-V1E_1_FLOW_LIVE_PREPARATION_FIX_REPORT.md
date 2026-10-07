# POST-v1E.1 — FLOW LIVE PREPARATION FIX REPORT

Date: 2026-09-30
Scope: P0 prompt verification (82 vs 83 mismatch), PromptWriter refactor, P1 generation config, P2 error UI, retry semantics
Mode: ponytail (minimal diffs, approved UI untouched)

## 1. Root cause

Live evidence: `PROMPT_TEXT_MISMATCH expectedLength=82 observedLength=83`,
strategy `execCommand-insertText`, contenteditable composer.

Three contributing defects, all fixed:

1. **execCommand as primary path** — `execCommand("insertText")` is deprecated
   and in the live Flow editor it left one extra trailing character
   (observed 83 vs expected 82). FIX 03 treated it as the primary strategy
   with DOM-replacement only as backup — now inverted (see PromptWriter).
2. **Normalization gaps** — normalization lacked Unicode NFC and did not
   guarantee symmetric end-of-editor whitespace stripping; `includes()`
   comparison allowed partial matches to pass and never surfaced WHERE the
   strings diverged.
3. **Blind failure** — a mismatch carried only lengths, so the live run could
   not distinguish trailing-newline noise from real corruption.

## 2. P0 — prompt verification (now exact + diagnosable)

- One canonical `normalizePromptText`, applied symmetrically to expected and
  observed: (1) Unicode NFC, (2) CRLF/CR → LF, (3) NBSP → space, (4)
  zero-width U+200B/U+200C/U+200D/U+FEFF removed, (5) whitespace at the END
  of the editor text removed (per-line trailing + final), (6) meaningful
  internal newlines/text preserved — no broad collapse, (7) comparison is now
  EXACT equality (not `includes`) — `verifyPromptContent`,
  `waitForPromptValue`, `confirmPromptStable` all compare exactly.
- `diffPromptText(expectedRaw, observedRaw)` produces the mandated failure
  diagnostics: `expectedRaw`/`observedRaw` (JSON.stringify'd), raw lengths,
  normalized lengths, `firstDiffIndex`, `firstDiffCodePoint` ("U+000A" form),
  `observedTrailingCodePoints`. Attached to every prompt-stage failure
  response as `mismatch`; autoPrepare dumps it in the developer log on
  failure only. Success paths remain free of prompt content. Secrets/tokens
  are never involved (probe redaction from FIX 02 untouched).
- The live 82-vs-83 case now verifies: trailing `\n` normalizes away on both
  sides (regression-tested); if the extra character is NOT trailing
  whitespace, the new diagnostics will pinpoint the exact index/code point on
  the next live run.

### PromptWriter abstraction

`PROMPT_WRITERS` (versioned, v2) in the adapter:

- `native` — input/textarea: native prototype value setter when available
  (`Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")`),
  assignment fallback, ordinary input/change events.
- `contenteditable` — PRIMARY: focus → DOM replacement (text nodes + `<br>`
  line breaks) → ordinary input event → immediate live re-read. COMPATIBILITY
  FALLBACK ONLY: `execCommand("insertText")` (deprecated; its boolean is
  never acceptance). If both produce nothing observable, strategy `"none"` →
  `PROMPT_INSERT_FAILED` (Case A).
- `insertPromptText` resolves the CURRENT composer editor (FIX 02 scoping),
  dispatches to the writer, returns safe telemetry. Nothing assumes Flow
  state updated: after insertion the caller waits for editor/UI
  stabilization (`waitForPromptValue` — MutationObserver on fresh DOM,
  bounded 4s), rereads, normalizes both values, verifies EXACTLY, then
  re-checks stability (500ms window → `PROMPT_APP_STATE_NOT_COMMITTED` if
  Flow reverted the prompt).
- **At most one safe insertion retry** (`MAX_ATTEMPTS = 2`): attempt 2
  re-resolves the composer and re-inserts (e.g. after a Flow re-render wiped
  the editor). A deeper first-attempt failure code is never downgraded by a
  shallower retry failure. If normalized verification still fails, the
  pipeline STOPS — generation settings are never entered and Generate is
  never reached.

## 3. P1 — generation configuration (already canonical, verified by tests)

`PREPARE_GENERATION` after prompt PASS: STANDARD mode enforced →
`selectGenerationType(root, "IMAGE")` → `selectAspect(root, "1:1")` →
`selectOutputCount(root, 1)` — each click verified by re-reading live state;
UNSC values stay honestly UNKNOWN. No model is forced (job requests none;
model/credit remain observational). `assessGenerationReady` requires
Generate FOUND **and ENABLED** — a disabled Generate is reported
(`GENERATE_STILL_DISABLED_AFTER_PROMPT`), never force-enabled or bypassed;
`SUBMIT_GENERATE` re-checks enabled state at submit time and throws
`GENERATE_STILL_DISABLED` (regression-tested: `clicked === 0`).

## 4. Selector strategy

Selector candidate set is now versioned (`SELECTORS_VERSION = 3`,
`ADAPTER_VERSION = 0.4.1-postv1e1`). Existing candidates already follow the
prescribed preference order (accessible roles/names → visible short labels →
structural), and every DEGRADED match used for an ACTION is runtime-verified
before it counts (mode/aspect/output selections re-read live state after
clicking; the prompt editor must be writable). No new blind candidates were
invented without live evidence — see "Remaining degraded selectors" below.

## 5. P2 — error UI ("[object Object]")

`JobCard.errorText(x)`: strings pass through; `Error` → message; objects →
`code`/`error`/`message` string field, else `JSON.stringify`; empty →
`UNKNOWN`. `[object Object]` is now unreachable. `friendlyError` and the
approve-failure toast/log use it. Prompt-verification failures get the
dedicated friendly body "Không thể xác minh nội dung prompt sau khi nhập vào
Google Flow." with `Mã lỗi` preserved in the expandable technical section.
Regression-tested.

## 6. Retry behavior

`Thử lại` (existing FIX 02 semantics, verified): no extension reload, token
stays in memory, tab + composer re-resolved, preparation re-runs from clean
state (`inFlightKeys`/`successfulKeys` — failures never latch). No
generation counter is incremented anywhere during preparation (grep-verified
— `generationCount` does not exist client-side; attempt accounting stays
bridge-side and only moves on real Generate).

## 7. Tests

Extension suite: **passed=156 failed=0** (16 new v1E.1 tests):

- Normalization units (9 cases): exact text, trailing LF, trailing CRLF,
  NBSP, zero-width space, meaningful internal newline preserved, real
  character mismatch, extra internal space = corruption, NFC equivalence
  (decomposed vs composed).
- Integration: successful contenteditable verification; mismatch diagnostics
  (raw JSON evidence, `firstDiffIndex`, `U+0078`, trailing code points,
  `attempts=2`); live 82-vs-83 trailing-newline case normalizes to equality;
  re-render recovery (retry lands on the fresh editor, verifies);
  retry-after-mismatch at orchestrator level (no latch, no `already
  prepared`); Generate blocked on mismatch (no settings, no approval state);
  disabled Generate never force-clicked; `[object Object]` unreachable in
  error text.

## 8. Regression result

Full existing suites re-run — all pass:
extension 156/0; root: `test-flow-postv1e` / `postv1b` / `postv1c` /
`postv1d` (136/0 after patch) / `test-flow-page-adapter` / `test-flow-state-machine` /
`test-flow-safety-retry` / `test-flow-bridge` / `test-flow-jobs` /
`test-flow-origin` — ALL TESTS PASSED.

Note: `test-flow-postv1d.js` D2/D9 asserted the pre-POST-v1E implementation
strings (`prepareState()`, `INSERT_PROMPT_DRYRUN` in sidepanel) that the
accepted canonical-orchestrator refactor had already replaced; the
assertions were updated to the current canonical architecture
(`ensureCurrentJobPrepared`, `PREPARE_GENERATION`). No behavior was weakened:
the intent (automated pipeline, no infra buttons, no Generate outside
approval) is unchanged.

## 9. Changed files

- `flow-companion/extension/src/content/flow-page-adapter.js` — normalization v2 (NFC, end-only strip), exact comparisons, `diffPromptText`, `PROMPT_WRITERS` (v2) + writer functions, `insertPromptText` on writers, version bumps
- `flow-companion/extension/src/content/content-commands.js` — prompt stage: retry loop (max 2 attempts, no code downgrade), `mismatch` diagnostics on failure, stability gate
- `flow-companion/extension/src/ui/state/auto-prepare.js` — mismatch diagnostics log on failure
- `flow-companion/extension/src/ui/components/job-card.js` — `errorText` (no `[object Object]`)
- `flow-companion/extension/src/ui/sidepanel.js` — `errorText` in `friendlyError`/toast, prompt-verify friendly body
- `flow-companion/extension/tests/run.js` — 16 v1E.1 regressions
- `test-flow-postv1d.js` — stale architecture assertions patched (see §8)
- Rebuilt: `.output/chrome-mv3` (`BUILD_OK`, 29 files; new code verified in bundle)

## 10. Live evidence

Not yet re-run against the real Flow UI (requires browser session). Code
level: the exact live symptom (82 vs 83, trailing U+000A) is regression-tested
to normalize to a PASS, and the DOM-replacement-primary writer removes the
deprecated execCommand path that produced the extra character.

## 11. Remaining degraded selectors

From the live diagnostics (unchanged by this fix — no blind candidates
invented):

- `PROMPT_INPUT` DEGRADED — but prompt access is composer-anchor-scoped
  (FIX 02) and writability-verified at runtime.
- `GENERATE_BUTTON` DEGRADED via `button[type="submit"]` — used read-only
  (found/enabled check); enabled-state is verified at submit time.
- `MODE_IMAGE`/`GENERATION_TYPE`/`MODEL_CONTROL` FAIL on the live page —
  surfaced as precise per-stage codes, never masked (§16 FIX 03).
- `ASPECT_CONTROL`/`OUTPUT_COUNT` DEGRADED — any use is click-then-re-verify.

## 12. Live validation status + next blocker

**LIVE VALIDATION PENDING.** Acceptance gate: live retry must progress from
`PROMPT_TEXT_MISMATCH` to `prompt verified=true`, then Image/1:1/outputCount=1
resolution. If a later control cannot be resolved, the run stops with that
specific new blocker. Full automation PASS is only claimable after a real
Google Flow generation is triggered and its result detected.

## 13. Conclusion

**POST-v1E.1 FLOW LIVE PREPARATION FIX: CODE COMPLETE — LIVE VALIDATION
PENDING** (`PROMPT_TEXT_MISMATCH` → verified path is fixed and tested; next
live run either reaches `prompt verified=true` or produces pinpoint mismatch
diagnostics for the residual difference).
