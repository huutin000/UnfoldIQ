# POST-v1E.2 — FLOW GENERATION TYPE LIVE RESOLVER REPORT

Date: 2026-09-30
Scope: generation-type resolution on the live Flow composer (menu-based)
Mode: ponytail (prompt path untouched — POST-v1E.1 is LIVE PASS)

## 1. Previous live evidence

POST-v1E.1 confirmed LIVE: `prompt input resolved` / `prompt verified=true`
(the 82-vs-83 trailing-newline mismatch is fixed). Pipeline now advances to:

```text
stage=generation-type
code=GENERATION_TYPE_NOT_IMAGE
```

with live diagnostics: `generationType: UNKNOWN (verified=false)`,
MODE_IMAGE FAIL, MODE_VIDEO DEGRADED `text:/\bvideo\b/i`, GENERATION_TYPE
FAIL, MODEL_CONTROL FAIL, Generate found+enabled.

**Confirmed: POST-v1E.1 prompt verification = LIVE PASS.** Prompt
normalization/PromptWriter untouched in this fix (no regression discovered).

## 2. Generation-type root cause

The old resolver assumed MODE_IMAGE/MODE_VIDEO are independent, always-visible
controls. On the current Flow desktop UI, generation type lives INSIDE the
model/generation settings control in the prompt box:
`prompt box → settings trigger → Image / Video menu → image preferences`.
With MODE_IMAGE absent and MODE_VIDEO only text-DEGRADED, the old logic had
nothing to click and no way to verify — and a global `\bvideo\b` text match
must never count as current-state VIDEO (it may be an inactive option,
hidden DOM, project content, history, a tooltip, or unrelated UI).

## 3. Implementation (all in the Flow adapter — single DOM owner)

- `detectGenerationType(root)` — rewritten EVIDENCE-based. Verified
  IMAGE/VIDEO only from strong semantics: selected mode control (text-matched
  controls excluded), a selected `role=tab`, a SELECTED choice inside an
  ALREADY-OPEN generation menu, or a Generate accessible label matching
  /generate\s*image/i. Everything else returns UNKNOWN with a structured
  `evidence` list; image-prefs presence is informational only.
- `findGenerationTriggerCandidates(root, excludeEl)` — observe-only, bounded
  (`GENERATION_TRIGGER_MAX = 6`): role=button/native button with
  `aria-haspopup`, combobox semantics, `aria-expanded` controls — scoped to
  the CURRENT composer root, widening to the page only if the composer scope
  yields nothing. Forbidden controls (Search/CAPTCHA/account, FIX 02) and
  the Generate control itself are excluded. No CSS classes.
- `generationChoicesIn(surface)` — exact accessible-name matching
  (`Image` / `Video`, case-insensitive equality) inside ONE resolved surface
  via role semantics (menuitem/option/radio/menuitemradio + short-labelled
  buttons). Never a document-wide regex.
- `findOpenGenerationMenu(root)` — observe-only scan of menu/listbox/dialog
  surfaces that contain generation choices.
- `selectGenerationType(root, type, opts)` — now async, ordered:
  1. **Already-mode check** — strong evidence of the requested mode →
     `method: "already-selected"`, ZERO clicks (avoids unnecessary UI state
     changes).
  2. Legacy direct mode control (older UIs) — click + re-verify; a
     text-matched VIDEO control is never clicked.
  3. Trigger discovery: per candidate — click/open → bounded wait for the
     newly opened surface (`FLOW_GENERATION_MENU_TIMEOUT_MS = 2000`) →
     inspect ONLY that surface → a surface WITHOUT both Image and Video is
     closed safely (Escape) and the next candidate probed. Both found →
     VERIFIED generation trigger → click the exact-name choice → bounded
     post-click verification (`FLOW_GENERATION_VERIFY_TIMEOUT_MS = 2500`)
     re-reading live state. Click without positive post-state evidence =
     FAIL (`GENERATION_TYPE_NOT_IMAGE` with trigger+menu evidence attached);
     never retried against other candidates, never assumed success.
- `generationTypeDiagnostics(root)` — observe-only bundle for diagnostics:
  `generationTrigger {found, selectorSource, accessibleName, role, hasPopup}`,
  `generationMenu {found, role, visibleOptionNames}`, `generationType
  {value, verified, verificationSources, evidence}`. No tokens/account data;
  wired into `buildLiveDiagnostics`.
- `assessGenerationReady` — generation type must now be VERIFIED IMAGE;
  `GENERATION_TYPE_NOT_VERIFIED` is a distinct missing condition. Enabled
  Generate alone can never make the gate pass.

MODEL_CONTROL split: generation-settings trigger (discovery), generation
type (this resolver), and image model are treated as distinct concerns; the
job requests no model, so no model selection is attempted and the observed
label stays `UNKNOWN` unless reliably readable (test-asserted).

## 4. Generation gate

Unchanged and strengthened: `generationReady=READY` requires prompt verified
AND generation type IMAGE **verified** AND aspect AND output count AND
Generate found AND Generate enabled. `selectGenerationType` failures stop
the pipeline before aspect/output stages. Generate is never force-enabled
and is never clicked during discovery (test-asserted `clicked === 0`).

## 5. Selector/discovery strategy

Preference order per candidate: role/native button semantics →
`aria-haspopup`/`aria-expanded`/combobox → accessible name (recorded) →
stable attributes (recorded as `selectorSource`) → composer-scoped
structural relationship. Verified at runtime: only a surface containing
both Image and Video marks its trigger verified. `ADAPTER_VERSION` bumped
to `0.4.2-postv1e2`.

## 6. Verification evidence rules

`{ value, verified, evidence: [{source, value}] }` — sources:
`mode-control-selected`, `tab-selected`, `generation-menu-open`,
`menu-option-selected`, `generate-label`, `image-prefs-available`
(informational). TEXT_FALLBACKS matches (`text:/\bvideo\b/i`) are explicitly
excluded from positive verification; they remain discovery candidates only
inside a verified popover surface.

## 7. Changed files

- `flow-companion/extension/src/content/flow-page-adapter.js` — detectGenerationType rewrite, trigger discovery, menu probing, async selectGenerationType, generationTypeDiagnostics, version bump
- `flow-companion/extension/src/content/content-commands.js` — awaited resolver, precise codes, `generationType` block in response
- `flow-companion/extension/src/ui/state/auto-prepare.js` — verification-sources log line
- `flow-companion/extension/tests/run.js` — 13 new v1E.2 regressions
- `test-flow-postv1e.js` — E3 updated to `await` the now-async resolver (intent unchanged)
- Rebuilt: `.output/chrome-mv3` (`BUILD_OK`, new code verified in bundle)

## 8. Tests

Extension suite: **passed=197 failed=0** after the POST-v1E.2A safety
correction (§8A below). POST-v1E.2 added **11 new test cases covering the 14
required scenarios** (several tests each pin two related scenarios, e.g.
enabled-Generate-alone + unresolved-type-cannot-be-READY, Image-verified +
no-model-forced); POST-v1E.2A adds **5 more** safety regressions. Full
coverage list: already-Image no-click; trigger opens Image+Video menu;
Image selected-semantics verification; global "Video" text ≠ VIDEO; hidden
"Image" text ≠ IMAGE verified; option scoped to opened popover; wrong
candidate closed + next probed; bounded discovery; Generate never clicked
during discovery; enabled Generate alone ≠ IMAGE nor READY; click without
post-state evidence fails precisely (with evidence); Image verified →
pipeline advances to aspect (1:1) with output 1 and no model forced;
unresolved type cannot become READY. v1E.2A: Generate label alone never
verifies IMAGE (telemetry-only evidence entry); VIDEO selected stays VIDEO
despite a "Generate Image" label; no composer candidate → NOT_FOUND with
page controls never probed; verified in-composer trigger still resolves
(page decoy untouched); probing stays bounded in composer scope.

## 8A. POST-v1E.2A — generation-type verification safety correction

Pre-live review surfaced two safety issues; both fixed, all other POST-v1E.2
behavior unchanged (exact Image/Video matching in the verified popover,
Escape close of wrong menus, post-click semantic verification,
already-selected path, Generate never clicked during discovery, no forced
model, generation gate, precise codes, diagnostics, aspect/output untouched;
prompt handling untouched).

1. **Generate label is NOT strong IMAGE evidence.** Flow uses "Generate
   Image" wording in both image and video workflows, so the label is not a
   generation-type discriminator. The `/generate\s*image/i` strong-verify
   branch is removed: `generate-label` now appears only as an
   `informational: true` evidence entry and can never by itself produce
   `{ value: "IMAGE", verified: true }`. Strong IMAGE verification requires
   semantic state from the verified generation-type UI (option
   aria-selected/aria-checked/checked/data-state selected, a verified
   trigger explicitly reflecting Image, or the reopened verified menu
   observing Image selected). No strong semantics → UNKNOWN / verified=false.
2. **Document-wide trigger probing removed.** The composer-scope → page
   widening fallback in `findGenerationTriggerCandidates` is deleted.
   Discovery is limited to the current composer root / composer toolbar /
   structurally adjacent settings area when explicitly resolved. No verified
   candidate in that bounded scope → `GENERATION_TRIGGER_NOT_FOUND` with
   observe-only diagnostics; unrelated page controls are never probed or
   clicked.

New regressions (5): Generate label alone never verifies IMAGE; VIDEO
selected stays VIDEO despite "Generate Image" label; no composer candidate →
NOT_FOUND with page button untouched; verified in-composer trigger still
resolves; probing stays bounded.

## 9. Regression result

All root suites re-run after POST-v1E.2A — ALL TESTS PASSED: `test-flow-postv1e`,
`test-flow-postv1b`, `test-flow-postv1c`, `test-flow-postv1d`, `test-flow-page-adapter`,
`test-flow-state-machine`, `test-flow-safety-retry`, `test-flow-bridge`,
`test-flow-jobs`, `test-flow-origin`, `test-flow-manual-assist`.

## 10. Live validation status

**LIVE VALIDATION PENDING.** Expected progression after reload/retry:

```text
prompt verified=true            (POST-v1E.1, already live PASS)
generationType=IMAGE
generationTypeVerified=true     (menu discovery + post-click evidence)
→ aspect=1:1 verified
→ outputCount=1 verified
→ generationReady=READY → AWAITING_USER_APPROVAL
```

## 11. Next blocker (if any)

If the live run passes generation type and then fails settings, the next
blocker will be reported exactly as `ASPECT_NOT_1_1` / `OUTPUT_COUNT_NOT_1`
(or the matching precise code). Aspect/output selectors are NOT patched
blindly in this task. Full automation PASS still requires a real Generate
trigger → result detected → asset imported.

## 12. Conclusion

**POST-v1E.2 (incl. POST-v1E.2A safety correction) FLOW GENERATION TYPE LIVE
RESOLVER: CODE COMPLETE — LIVE VALIDATION PENDING**
