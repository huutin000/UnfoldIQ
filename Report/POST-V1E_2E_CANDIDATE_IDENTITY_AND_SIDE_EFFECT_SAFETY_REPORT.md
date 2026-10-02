# POST-v1E.2E — CANDIDATE IDENTITY + PROBE SIDE-EFFECT SAFETY REPORT

Date: 2026-09-30
Scope: semantic identity diagnostics, evidence-based classification/ranking, generation side-effect guard, mutation artifact ownership refinement
Mode: ponytail (toolbar discovery structure, switching, prompt, aspect/output, notifications, cleanup safety — all unchanged in substance)

## 1. Live evidence recap

Clean retry: `prompt verified=true`, `generationTypeDetection UNKNOWN/verified=false`.
Toolbar inventory (4 controls): `Settings trigger` (GENERATION_SETTINGS),
`article_spark`/`Agent instructions` (UNKNOWN), `tune`/`Settings` (UNKNOWN),
`arrow_forward`/`Start generation` (SUBMIT, excluded). The resolver probed
"Settings trigger" → 55 added nodes / 92 visible containers, surface UNKNOWN,
cleanup `method=ESCAPE verifiedClosed=false` → `GENERATION_PROBE_CLEANUP_FAILED`.
The screenshot showed a **square Stop control where Start generation normally
appears** — a possible unintended generation side effect (credits unknown).

Root problems: (1) accessible names were dominated by material icon ligature
text ("tune", "article_spark") so the real `ariaLabel="Settings"` control
classified UNKNOWN; (2) 72 mutation ancestors were all treated as rollback
artifacts, so ordinary re-render nodes forced cleanup failure; (3) no guard
existed for a probe causing a generation-running state.

## 2. Canonical semantic identity + evidence classification (P0)

`semanticIdentity(el)`: real DOM semantics first — `aria-label` → `title` →
short visible text (≤30 chars); the icon/material ligature text is recorded
separately as `iconText` and NEVER used as the accessible name when a real
aria-label/title exists. `accessibleSource` records which source produced the
name (`aria-label` | `title` | `visible-text`).

`classifyWithEvidence(el)`: classification evidence is taken aria-label →
title → visible-text; the winning source is returned as
`categoryEvidence={source,value}`. A control with `ariaLabel="Settings"` and
icon text "tune" now classifies GENERATION_SETTINGS with
`categoryEvidence=aria-label:Settings` (regression-tested). "Settings"
semantics remain a stronger CANDIDATE signal — never verification.

New category `AGENT`: `/\bagent\b/` (Agent Instructions) — excluded with
`exclusionReason=agent-control` unless live evidence later proves otherwise.

## 3. Evidence-source ranking (P0)

`composerControl` and `generationCandidate` logs now include
`nameSource=…`, `iconText="…"`, `semanticSources=[aria-label:…,title:…,icon-text:…]`,
`categoryEvidence=source:value`. Ranking: real DOM source bonus
(aria-label +6 / title +4 / visible-text +2), exact settings/model keyword
(+6) outranks compound names, on top of the existing category/hasPopup/
proximity signals. Proximity and "Settings" are still ranking only — a
verified trigger requires the owned surface to contain exact Image + Video
choices (unchanged gate).

## 4. Generation side-effect guard (P0)

`captureGenerationRunState(root)` snapshots (before every discovery run): the
Start-generation control presence/label and any existing stop/cancel-generation
control. After EVERY candidate click (and again after surface resolution),
`detectGenerationRunning(root, before)` checks:

- a NEW stop/cancel-generation control appeared (exact conservative semantics:
  `stop`, `cancel`, `hủy`, `stop generation`, …);
- the Start-generation control's label flipped to Stop/Cancel
  ("Start generation" → "Stop").

Detected → **discovery stops immediately** (no further probing) with
`GENERATION_PROBE_UNEXPECTED_GENERATION` and full diagnostics:

```text
generationSideEffect: detected=true reason=start-replaced-by-stop|stop-control-appeared
  beforeStartState=… afterStartState=… stopControlAppeared=…
  cancellationAttempted=… cancellationVerified=…
```

Cancellation is attempted ONLY for a reliably identified separate new Stop
control (caused by this probe — it was absent before the click) and only when
cancellation verifies (the Stop control disappears). A "Start→Stop" flip on
the SAME control is never "cancelled" by clicking it (that could re-trigger);
it is reported and discovery stops. Generate is never clicked during discovery
(regression-tested throughout).

## 5. Mutation artifact ownership refinement (P0)

`isRollbackArtifact(c)`: a mutation container is a rollback artifact only with
surface evidence — non-UNKNOWN surface classification (generation menu / asset
picker / marker semantics) or `aria-modal="true"`. Ordinary React re-render
nodes no longer enter the artifact set, so their remaining visibility can never
fail cleanup (regression-tested: inert container stays visible →
`verifiedClosed=true` → `GENERATION_SURFACE_NOT_RESOLVED`, NOT
CLEANUP_FAILED). Evidence-backed portals remaining visible still fail cleanup
(2D-A suite regression green). The POST-v1E.2D-A document-level portal
containment safety is kept unchanged.

## 6. Candidate probing order (P0)

Inside the verified composer toolbar: Generate excluded (identity) → known
Asset/Reference controls excluded (static semantics + session runtime negative
evidence) → Agent Instructions excluded → ranked strong real-DOM settings/model
semantics first (aria-label source, exact keyword) → UNKNOWN controls last. No
button index; `composerControl[i]` index is diagnostic only.

## 7. Changed files

- `flow-companion/extension/src/content/flow-page-adapter.js` — semanticIdentity, classifyWithEvidence, AGENT category, evidence ranking, side-effect guard (findStopControl/captureGenerationRunState/detectGenerationRunning/generationSideEffectError), isRollbackArtifact, ADAPTER_VERSION `0.4.7-postv1e2e`
- `flow-companion/extension/tests/run.js` — 7 new v1E.2E regressions
- Rebuilt: `.output/chrome-mv3` (`BUILD_OK`; new code verified in bundle)

## 8. Tests

Extension suite: **passed=328 failed=0**. New v1E.2E regressions: (1) iconText
"tune" + ariaLabel "Settings" → GENERATION_SETTINGS with
`categoryEvidence=aria-label:Settings`, icon text recorded separately, sources
logged; (2) real "Settings" ranks above compound "Settings trigger"; (3)
semantic source logged (`nameSource=aria-label`,
`categoryEvidence=aria-label:Settings` in developer-log lines); (4) Agent
Instructions excluded and never probed while other candidates are; (5) Start→
Stop flip → `GENERATION_PROBE_UNEXPECTED_GENERATION`, no cancellation attempt,
discovery stops (second candidate never clicked); (6) covered by (5);
(7) separate appeared Stop control cancelled with
`cancellationAttempted=true cancellationVerified=true`; (8) inert re-render
container remaining visible does NOT fail cleanup (`verifiedClosed=true`);
(9) real portal remaining visible still fails — covered by the POST-v1E.2D-A
containment regressions (green); (10) verified Settings surface with exact
Image/Video works — covered by v1E.2D toolbar suite (green); (11) Generate
never clicked during discovery — asserted in (5), (7) and the v1E.2D suite;
(12) all previous suites green (below).

## 9. Regression result

Extension 328/0. All root Flow suites ALL TESTS PASSED (single batch):
`test-flow-postv1e`, `test-flow-postv1b`, `test-flow-postv1c`,
`test-flow-postv1d`, `test-flow-page-adapter`, `test-flow-state-machine`,
`test-flow-safety-retry`, `test-flow-bridge`, `test-flow-jobs`,
`test-flow-origin`, `test-flow-manual-assist`.

## 10. Live validation status

**POST-v1E.2E CODE COMPLETE — LIVE VALIDATION PENDING.** The next live retry
must show: full semantic inventory per control (nameSource/iconText/
categoryEvidence); the real `ariaLabel="Settings"` control ranked FIRST and
probed first; `generationTypeDetection/Switch` lines; and — if any probe again
flips Start→Stop — an immediate
`GENERATION_PROBE_UNEXPECTED_GENERATION` with the `generationSideEffect`
diagnostics instead of a silent cleanup failure. Case A/Case B protocol
(3/3 Video→Image switches, zero picker leak) remains the discovery LIVE PASS
gate; aspect work only after that.

## 11. Conclusion

**POST-v1E.2E CODE COMPLETE — LIVE VALIDATION PENDING**
