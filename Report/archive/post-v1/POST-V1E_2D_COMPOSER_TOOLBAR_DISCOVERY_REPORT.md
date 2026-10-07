# POST-v1E.2D — COMPOSER TOOLBAR DISCOVERY + REAL ASSET PICKER CLEANUP REPORT

Date: 2026-09-30
Scope: toolbar inventory before filtering, broadened in-toolbar eligibility, runtime negative evidence, real marker detection (placeholder/text/deep containers), cleanup false-pass fix, detection-vs-switch tracking, model label gate
Mode: ponytail (prompt handling untouched; aspect/output untouched; notification lifecycle unchanged)

## 1. Latest clean-retry evidence

```text
prompt verified=true
generationProbe: candidates=1 attempt=1
generationCandidate: role=button accessibleName="add" category=UNKNOWN hasPopup=true rankingSignals=[has-popup:true]
generationMutation: addedNodeCount=51 visibleContainerCount=72
openedSurface: resolved=false resolutionSource=MUTATION classification=UNKNOWN visibleOptionNames=[]
cleanup: attempted=true method=none verifiedClosed=true
→ GENERATION_SURFACE_NOT_RESOLVED
```

…while the Asset Picker ("Search assets / All / Images / Videos / Voices /
Characters / Avatars / Uploads / Upload media") was visibly STILL OPEN.

## 2. Root causes (all addressed)

1. **Candidate discovery too restrictive** — only the "add" control entered the
   candidate set; the real generation-settings/sliders button (no
   aria-haspopup/expanded) was invisible to the selector scan.
2. **Marker detection missed the real DOM** — "Search assets" is an input
   PLACEHOLDER (placeholders were never read), "Images"/"Videos" tabs were not
   scanned, and the ≤5-ancestor-level cap was too shallow for Flow's portal
   depth.
3. **Cleanup false-pass** — with no resolved surface and no marker hit,
   `artifactGone` saw "nothing" and reported `verifiedClosed=true method=none`
   while the picker remained open. `method=none` could false-pass.
4. **No detection/switch separation** — an already-selected IMAGE state could
   be mistaken for discovery capability.
5. **Model label false-positive** — "Sep 28 - 20:48" (project/session
   dropdown) surfaced as modelLabel via a generic structural fallback.

## 3. Composer toolbar inventory (P0)

`findComposerToolbar(root, generateEl)` — the smallest stable cluster: nearest
ancestor of Generate holding ≥2 interactive controls (bounded 5-level walk).
`interactiveControlsIn` observes EVERY interactive element (button, role=button,
input, combobox, switch, textarea; deduped, bounded 24).

`composerToolbarInventory` logs every control BEFORE filtering:

```text
composerToolbar: found=true controlCount=N
composerControl[i]: tag=… role=… accessibleName="…" ariaLabel="…" title="…" hasPopup=… expanded=… disabled=… nearGenerate=… category=… eligible=… exclusionReason=…
```

(no CSS classes, no index selectors — index is diagnostic only). These lines go
into `probeLog` → developer log on every run, before `generationProbe`.

## 4. Broadened eligibility (toolbar only, P0)

Inside the verified toolbar, every interactive control is an eligible UNKNOWN
probe candidate even without aria-haspopup/expanded/combobox semantics — probing
is transactional. Excluded with explicit `exclusionReason`: `generate-control`
(identity), `submit-semantics`, `asset-reference-semantics` (static accessible
semantics), `runtime-negative-asset-picker` (session WeakSet — see §5),
`forbidden-control` (Search/CAPTCHA/account, FIX 02), `editor-input`
(input/textarea/contenteditable), `disabled`. When no toolbar can be resolved,
the previous bounded composer-scope selector scan applies; interactive probing
is NEVER broadened outside the composer toolbar.

## 5. Runtime negative evidence for "add" (P0)

A candidate that verifiably opens a confirmed ASSET_PICKER is: (a) reclassified
`ASSET_REFERENCE` for the run (surfaces in `err.diagnostics.attempts`), (b) held
in a run-level element set, and (c) added to a session-scoped `WeakSet`
(`sessionPickerTriggers`) so later retries on the same page session exclude it
up front — no brittle DOM indexes persisted, and a button merely NAMED "add" is
never globally blacklisted without runtime evidence (regression-tested both
directions).

## 6. Real Asset Picker marker detection (P0)

`findMarkerContainer` rewritten: marker sources now include aria-label, title,
**placeholder**, and short visible text (≤30 chars) across buttons, role=
button/menuitem/tab/option/menuitemradio/combobox and inputs (bounded 300
elements). Markers include **"images"/"videos" (plural)** as ASSET-PICKER
markers — they can never be generation choices (exact "image"/"video" only).
Common container = bounded ancestor (≤30 levels, no fixed ≤5 cap) holding the
most distinct markers, deepest on ties; a container holding BOTH exact choices
is a generation menu, not a picker.

## 7. Cleanup verification must not false-pass (P0)

Snapshot comparison per probe: `beforeMarkerContainer` + new-semantic surfaces
+ mutation-owned container list (`mutationContainerList` from
`resolveProbeSurface`) recorded before/at resolution. `closeProbeArtifacts`
now takes the artifact set:

1. surface-local Close button (owned surface),
2. Escape,
3. re-scan asset-picker markers,
4. re-check mutation-owned visible containers (`elementStillVisible`:
   disconnected → gone; zero client rects → gone; not contained by root →
   gone; otherwise assumed present — conservative),
5. verify composer usable.

`method=none + verifiedClosed=true` is only reachable when the probe introduced
no persistent visible artifact. A marker/container that was not visible before
but remains after cleanup → `verifiedClosed=false` →
`GENERATION_PROBE_CLEANUP_FAILED` (no `GENERATION_SURFACE_NOT_RESOLVED` with a
leaked overlay). The unresolved-but-introduced surface is also owned and rolled
back (regression-tested).

## 8. Detection vs switching (P1) + model label gate (P1)

Every run logs and returns:

```text
generationTypeDetection: value=IMAGE|VIDEO|UNKNOWN verified=… method=already-selected|menu-selection|…
generationTypeSwitch: attempted=true|false verified=true|false
```

The already-selected path returns `switch.attempted=false` — an already-IMAGE
state never claims switching capability (regression-tested); menu resolution
returns `switch={attempted:true, verified:true}`.

`readModelLabel` gate: modelLabel is exposed ONLY when the control matched the
primary selector or a model-semantic selector (`model|veo|imagen`); generic
structural fallbacks (e.g. `button[aria-haspopup="listbox"]` showing
"Sep 28 - 20:48") yield UNKNOWN. Verified controls still populate (tested).

## 8A. POST-v1E.2D-A — portal cleanup containment safety fix

Pre-live review found one unsafe cleanup rule: `elementStillVisible` treated
"not contained by root" as "gone". Flow portals render under `document.body`
OUTSIDE the composer root while fully connected and visible —
`composerRoot.contains(portal) === false` must NEVER imply gone (the live
Asset Picker leak could false-pass cleanup exactly this way).

Fix: the ownership boundary is now the DOCUMENT — `document.contains(el)` (or
`isConnected`) decides connectivity, never composer-root containment; visibility
additionally excludes zero client rects, `display:none` / `visibility:hidden`,
and hidden/aria-hidden semantics. Conservative: an artifact is present unless
proven gone. Classification also skips INVISIBLE mutation containers
(`resolveProbeSurface`), so a disconnected stale node is never attributed to a
probe. `ADAPTER_VERSION = 0.4.6-postv1e2da`.

Regressions (3, with a document-connectivity shim):
1. External connected portal (outside composer root) that cannot be closed →
   `verifiedClosed=false` → `GENERATION_PROBE_CLEANUP_FAILED` (despite
   `composerRoot.contains(portal) === false`).
2. Same external portal hidden by Escape → `verifiedClosed=true`
   (`method=ESCAPE`) → `GENERATION_WRONG_SURFACE` reported cleanly.
3. Disconnected stale portal node → correctly considered gone; cleanup
   verifies trivially; nothing attributed to it.

## 9. Changed files

- `flow-companion/extension/src/content/flow-page-adapter.js` — toolbar inventory + broadened eligibility, session negative evidence, marker detection rewrite, snapshot-comparison cleanup, detection/switch tracking, model gate, document-level visibility boundary (§8A), ADAPTER_VERSION `0.4.6-postv1e2da`
- `flow-companion/extension/src/content/content-commands.js` — `generationType.detection/switch` in the response
- `flow-companion/extension/tests/mock-dom.js` — `FakeDocument.contains` for visibility snapshots
- `flow-companion/extension/tests/run.js` — 10 new v1E.2D regressions
- Rebuilt: `.output/chrome-mv3` (`BUILD_OK`; new code verified in bundle)

## 10. Tests

Extension suite: **passed=309 failed=0** — 10 v1E.2D regressions (§10 below)
plus 3 POST-v1E.2D-A containment-safety regressions (§8A). New v1E.2D
regressions map the required list: (1) toolbar contains Add + unlabeled
settings + Generate with full inventory logging; (2) settings without
aria-haspopup eligible and verified; (3)+(4) add control runtime-reclassified
ASSET_REFERENCE and never re-probed (session WeakSet; NOT_FOUND without
clicking); (5) placeholder "Search assets" participates; (6) deep descendants
(10 levels) resolve the common container; (7) plural Images/Videos never
generation choices; (8)+(10) Escape closes role-less marker-based picker with
`method=ESCAPE verifiedClosed=true`; (9) mutation-owned artifact forces cleanup
attempts (`addedNodeCount=1`, `cleanup: attempted=true`); (11) leaked picker →
`GENERATION_PROBE_CLEANUP_FAILED` (no false pass); (12) clean rollback lets the
next toolbar candidate succeed; (13) via (2); (14) already-selected tracked
separately (`switch.attempted=false`); (15)+(16) model label gate both ways;
(17) Generate never clicked; (18) all previous regressions green.

## 11. Regression result

Extension 309/0. All root Flow suites ALL TESTS PASSED (full batch re-run in a
single pass): `test-flow-postv1e`, `test-flow-postv1b`, `test-flow-postv1c`,
`test-flow-postv1d`, `test-flow-page-adapter`, `test-flow-state-machine`,
`test-flow-safety-retry`, `test-flow-bridge`, `test-flow-jobs`,
`test-flow-origin`, `test-flow-manual-assist`.

## 12. Live validation status + 3-run matrix

**POST-v1E.2D CODE COMPLETE — LIVE VALIDATION PENDING.** Required protocol:
Case A (Flow already Image): `generationTypeDetection method=already-selected`,
no Asset Picker leak. Case B (manually set Flow to Video BEFORE Retry, ≥3
consecutive runs): `generationTypeSwitch attempted=true verified=true`,
`generationType=IMAGE verified=true`, `leaked=false`. Only 3/3 Case B with
zero leak counts as generation discovery LIVE PASS; then aspect work
(`ASPECT_NOT_1_1` / `TARGET_ASPECT_NOT_AVAILABLE`) may begin.

## 13. Conclusion

**POST-v1E.2D CODE COMPLETE — LIVE VALIDATION PENDING**
