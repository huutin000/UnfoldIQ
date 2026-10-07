# POST-v1E FIX 03 — PROMPT INSERT/VERIFY REPORT

Date: 2026-09-30
Scope: prompt insertion + verification on the live Flow composer
Mode: ponytail (minimal diffs; FIX 02 systems untouched)

## 1. Status

Code complete, all tests green, build refreshed. **LIVE VALIDATION PENDING** (§17).

## 2. Live evidence

Composer layers all PASS (tab, PING, bridge, job, orchestration, composer
wait/anchor/root/editor/writable — diagnostics `composer: anchor=true
root=true editor=true editorType=contenteditable writable=true`), but
`PREPARE_GENERATION` failed:

```text
autoPrepare: generationReady=NOT_EVALUATED missing=[PROMPT_VERIFY_FAILED]
autoPrepare: preparation failed stage=prompt code=PROMPT_VERIFY_FAILED
```

Failure is specifically INSERT and/or VERIFY on the contenteditable editor.

## 3. Root-cause matrix (instrumented, not guessed)

The prompt stage now returns structured evidence that distinguishes:

- **Case A** — insertion changed nothing: `afterObservedLength=0` immediately after insert → `PROMPT_INSERT_FAILED`.
- **Case B** — verifier reads wrong editor/root: wait re-resolves the composer from fresh DOM and reads the CURRENT editor (§7); mismatch on non-empty observed → `PROMPT_TEXT_MISMATCH`.
- **Case C** — Flow re-rendered the editor: fresh editor identity ≠ inserted editor → `editorReplaced=true`; if the fresh editor is empty → `PROMPT_EDITOR_REPLACED_EMPTY`.
- **Case D** — formatting differences: canonical normalization (§5/§7) applied to BOTH expected and observed.
- **Case E** — DOM verified but Flow reverted: bounded stability re-check (§15) → `PROMPT_APP_STATE_NOT_COMMITTED`.

## 4. Editor type handling

`resolvePromptComposer` (FIX 02) supplies the editor; `readPromptEditorText`
(§6) reads `value` for input/textarea, `innerText` preferred with
`textContent` fallback for contenteditable. Only the already-scoped editor is
read — never page-wide text. Property access is single-read per prop.

## 5. Contenteditable insertion strategies

`insertPromptText` — multi-strategy, always verified against the live editor:

- **Strategy 1** (compatibility): focus → select existing contents only
  (Selection/Range) → `execCommand("insertText")`. The success boolean is
  NEVER treated as acceptance — the live editor is re-read immediately; if
  empty, Strategy 2 runs.
- **Strategy 2**: focus → replace editable contents with text nodes + `<br>`
  line breaks → ordinary `input` event. No React/Angular private state, no
  framework internals, no private Google APIs.

`execCommand` is deliberately not the only path (§11): deprecated API, and
its boolean ≠ Flow accepted the prompt. Verification always re-resolves the
composer and reads the fresh editor (§7), so a stale-node insert surfaces as
`editorReplaced` evidence instead of a false pass.

## 6. Input insertion strategy

Native property setter when available
(`Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set.call(...)`,
§8), plain `value` assignment fallback (mocked DOMs), then ordinary
`input`/`change` events. Live value re-read afterward. No framework-private
internals.

## 7. Text normalization

One canonical `normalizePromptText` used for expected AND observed:
`\r\n`/`\r`→`\n`, NBSP→space, zero-width (`\u200B\u200C\u200D\uFEFF`)
removed, per-line trailing whitespace stripped, trailing browser blank
line(s) collapsed, ends trimmed. Internal whitespace and line structure are
preserved ("…background.\nNo text." stays two lines if the editor keeps the
break). Regression: genuinely different text never normalizes to equality.

## 8. Verification wait

`waitForPromptValue(root, expected, { timeoutMs, pollMs, originalEditor })`:
immediate read → MutationObserver on fresh DOM (bounded poll fallback, same
shared `waitUntilFreshDOM` engine as the composer wait) → normalize both
sides → success on match. Timeout `FLOW_PROMPT_VERIFY_TIMEOUT_MS = 4000`
(safety boundary only, never a fixed-sleep success; tunable per call via
`promptVerifyTimeoutMs`). Observer always disconnected.

## 9. Editor replacement handling

`editorReplaced` is computed against the inserted editor's identity on every
fresh read. Verification always binds to the CURRENT composer editor — never
a globally-queried first contenteditable. Replaced+empty is its own code
(§22), replaced+correct text verifies normally (§21).

## 10. App-state stability check

`confirmPromptStable`: after a verified match, re-read the fresh live editor
after a bounded `FLOW_PROMPT_STABILITY_MS = 500` window. Reverted →
`PROMPT_APP_STATE_NOT_COMMITTED`. Generate-enabled is deliberately NOT used
as the commit signal (§15) — it may stay disabled until settings resolve.

## 11. Error taxonomy

Distinct codes replace the collapsed `PROMPT_VERIFY_FAILED`:

```text
PROMPT_EDITOR_NOT_WRITABLE
PROMPT_INSERT_FAILED        (incl. Case A: no observable change)
PROMPT_EDITOR_REPLACED_EMPTY
PROMPT_VERIFY_TIMEOUT
PROMPT_TEXT_MISMATCH
PROMPT_APP_STATE_NOT_COMMITTED
```

The UI still shows one friendly preparation message; the precise code is
preserved in Developer Mode details and reports (`PROMPT_[A-Z_]+` mapping).

## 12. Safe logging

Evidence object contains only: `inserted, verified, editorType, strategy,
editorReplaced, expectedLength, observedLength, fingerprintMatch, stable,
beforeLength, elapsedMs` — fingerprint is a short non-crypto digest
(`fingerprintText`), never the prompt body. autoPrepare logs (§17):

```text
autoPrepare: prompt editor resolved type=contenteditable
autoPrepare: prompt insert strategy=...
autoPrepare: prompt inserted=true
autoPrepare: prompt verification expectedLength=… observedLength=… match=true
autoPrepare: prompt stable=true
autoPrepare: prompt verified=true
```

Failure logs carry `expectedLength`/`observedLength`. No prompt body in any
diagnostic surface.

## 13. Retry semantics

FIX 02 latch semantics unchanged: any prompt insertion/verification failure
clears state, adds no successful key, and `Thử lại` re-runs the pipeline
(fresh tab → fresh composer → fresh editor → fresh insertion). Regression
asserts `already prepared` never appears after a verify timeout.

## 14. Tests

Extension suite: **passed=116 failed=0** (9 new FIX03 regressions):

- §19 contenteditable insert+verify success (fingerprintMatch, stable, stage PASS)
- §20 input insert via value + observed input event + verified
- §21 editor replaced after insert → verified on the fresh editor (`editorReplaced=true`)
- §22 editor replaced EMPTY → `PROMPT_EDITOR_REPLACED_EMPTY`, no settings stage, `settings` absent
- §23 normalization matrix (CRLF/NBSP/zero-width/trailing newline equal; different text not)
- §24 mismatch → `PROMPT_TEXT_MISMATCH` with lengths + `fingerprintMatch=false`
- §25 verify timeout → `PROMPT_VERIFY_TIMEOUT`, NEED_ATTENTION, `Cần xử lý`/`Thử lại`, retry runs (no latch)
- §26 no raw prompt in ANY diagnostic surface (response JSON, probe, composerProbe, live diagnostics)
- generic `PROMPT_VERIFY_FAILED` forbidden (root-cause codes only)

Adjacent root suites re-run — all pass: `test-flow-postv1e` 56/0,
`test-flow-page-adapter` 20/0, `test-flow-state-machine` 15/0,
`test-flow-safety-retry` 34/0, `test-flow-bridge` 15/0.

## 15. Security regression

Unchanged: no private Flow API, no framework-private state mutation, no
cookie access, no token persistence, no CAPTCHA interaction, no `<all_urls>`,
no remote executable code. No new Chrome permission. Insertion uses only
ordinary editing semantics + ordinary events; synthetic events are never
claimed to be trusted.

## 16. Files modified

- `flow-companion/extension/src/content/flow-page-adapter.js` — canonical `normalizePromptText`, `readPromptEditorText`, `fingerprintText`, `insertPromptText` (multi-strategy), `waitForPromptValue`, `confirmPromptStable`, shared `waitUntilFreshDOM` engine (FIX02 composer wait refactored onto it, behavior identical)
- `flow-companion/extension/src/content/content-commands.js` — verified prompt stage (insert → wait → stability) with precise codes + `promptInsert` evidence + `stages` in response
- `flow-companion/extension/src/ui/state/auto-prepare.js` — safe prompt telemetry logs
- `flow-companion/extension/src/ui/sidepanel.js` — `PROMPT_[A-Z_]+` friendly-error mapping
- `flow-companion/extension/tests/run.js` — 9 FIX03 regressions
- Rebuilt: `.output/chrome-mv3` (`BUILD_OK`, 29 files; new code verified in bundle)

## 17. Live validation status

Not yet performed (requires real browser: chrome://extensions → Reload →
Flow refresh → side panel → token if needed). Expected: `PREPARED` →
autoPrepare → composer ready → prompt inserted → `prompt verified=true` →
then generation settings may proceed. No Generate, no credits.

## 18. Next blocker

May legitimately become `GENERATION_TYPE` / `MODE_IMAGE` / `MODEL_CONTROL` /
`ASPECT_CONTROL` / `OUTPUT_COUNT` selector failures. That is acceptable and
must NOT be masked here.

## 19. Conclusion

**POST-v1E FIX 03 PROMPT INSERT/VERIFY: LIVE VALIDATION PENDING**
