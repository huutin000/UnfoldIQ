# POST-v1E.2C — FLOW PORTAL SURFACE RESOLUTION + PROBE ROLLBACK REPORT

Date: 2026-09-30
Scope: portal/overlay surface resolution without ARIA roles, mutation-based surface ownership, observe-only asset-picker fallback, guaranteed probe rollback, visible probe diagnostics
Mode: ponytail (prompt handling untouched; aspect/output untouched; notification lifecycle unchanged)

## 1. Latest clean-retry evidence

```text
prompt verified=true            (POST-v1E.1 LIVE PASS holds)
generationType=UNKNOWN verified=false
stage=generation-type
code=GENERATION_SURFACE_NOT_RESOLVED
```

While the Google Flow **Asset Picker was visibly open**: "Search assets / All /
Images / Videos / Voices / Characters / Avatars / Uploads / Upload media" — and
it REMAINED OPEN after preparation failed.

## 2. Root cause

1. The v1E.2B surface resolver only scanned `role=menu/listbox/dialog`. The
   live Asset Picker portal carries none of those roles → the probe resolved
   NOTHING (`opened = null`).
2. The cleanup guard was `if (opened && !verifiedSuccess)` — an unresolved
   surface **bypassed rollback entirely**, so the picker leaked and stayed open.
3. With nothing resolved, the run collapsed to `GENERATION_SURFACE_NOT_RESOLVED`
   even though a wrong surface was visibly present.

## 3. Mutation/portal surface ownership (P0)

`startSurfaceMutationCapture(root)`: a real MutationObserver on
`document.body` (childList+subtree) records element nodes added during the
probe window; `recordNode` is the driver/test seam; `stop()` always disconnects
(called in `finally`).

Per probe: `beforeVisibleSurfaces` (semantic surfaces) + pre-probe marker
container snapshot + candidate identity are captured, THEN exactly one
candidate is clicked. `mutationOwnedContainers` walks each added node to
bounded (≤6-level) container ancestors, deduplicates, and excludes the root,
pre-existing semantic surfaces, and the pre-existing marker container — a
pre-existing modal can never be attributed to the current probe (regression-tested).

## 4. Surface resolution — multiple evidence sources (P0)

`resolveProbeSurface(root, before, mutation, beforeMarker, timeoutMs)` resolves
in order, always returning a structured result (never null, so cleanup can
never be bypassed):

1. **ARIA** — newly visible `role=dialog/menu/listbox` surfaces.
2. **MUTATION** — mutation-owned portal subtrees classified by
   `generationChoicesIn` + `classifySurface` (exact Image+Video →
   GENERATION_MENU; ≥2 asset markers → ASSET_PICKER; plural "Images"/"Videos"
   never matches exact choices).
3. At the bounded window over: any newly introduced semantic surface or
   mutation container is still OWNED for rollback even when unclassifiable.
4. **OBSERVE_FALLBACK** — page-wide observe-only asset-picker detection
   (`findMarkerContainer`): scans visible controls, walks ≤5 ancestor levels,
   groups by container, requires ≥2 distinct strong markers. ZERO clicks —
   page-wide clicking/probing remains forbidden (regression-tested: every
   marker button `clicked === 0`).

## 5. Cleanup on unresolved surfaces (P0)

The rollback guard is now `if (!verifiedSuccess)` — UNCONDITIONAL on
resolution success. `closeProbeArtifacts(root, ownedContainer, …)`: Close
button inside the owned surface → Escape → verify disappearance including
**asset-picker marker disappearance** (`artifactGone` = owned identity gone
AND no marker container visible) AND composer usable (resolvability unchanged
from before the probe). Failure → `GENERATION_PROBE_CLEANUP_FAILED`, probing
stops immediately; the Asset Picker is never left open after a failed probe.

## 6. Candidate negative evidence (P0)

A candidate whose probe resolves a confirmed ASSET_PICKER is marked
`ASSET_REFERENCE` for the rest of the run and added to a runtime negative set
(element identity — no brittle DOM indexes persisted); it is never probed
again in that run. Wrong-surface cleanup is verified before the next candidate
continues.

## 7. Diagnostics in the developer log (P0)

`probeLog` lines are built for every probe and attached to BOTH the success
return (`probeLogs`) and every failure (`err.probeLog`); content-commands
passes them through (`probeLogs`) and autoPrepare writes each line into the
developer log:

```text
generationProbe: candidates=2 attempt=1
generationCandidate: role=button accessibleName="…" category=GENERATION_SETTINGS hasPopup=menu rankingSignals=[generation-settings-name,has-popup:menu,near-generate]
generationMutation: addedNodeCount=N visibleContainerCount=M
openedSurface: resolved=true|false resolutionSource=ARIA|MUTATION|OBSERVE_FALLBACK|NONE classification=ASSET_PICKER|GENERATION_MENU|UNKNOWN|NONE visibleOptionNames=[…]
cleanup: attempted=true method=CLOSE_BUTTON|ESCAPE|none verifiedClosed=true|false
```

Accessible names pass through `redactSafe` (FIX 02); no Bridge token, no
account data, no private asset names.

## 8. Error semantics

`GENERATION_SURFACE_NOT_RESOLVED` now means: no semantic surface, no
mutation-owned container, AND no observe-fallback wrong surface. A visibly
found Asset Picker → `GENERATION_WRONG_SURFACE` (after verified cleanup);
cleanup failure → `GENERATION_PROBE_CLEANUP_FAILED`. All still carry
`err.diagnostics {candidates, attempts}` in the command `detail`.

## 9. Notification lifecycle

Unchanged from POST-v1E.2B (regression suite still green): persistent keyed
"Đang chuẩn bị…" while preparation is pending; "Không thể hoàn tất chuẩn bị" /
"Đã chuẩn bị xong" at terminals; no stacking; attempt-id guard.

## 10. Tests

Extension suite: **passed=270 failed=0** (8 new v1E.2C regressions covering
the 13 required trigger scenarios; notification scenarios 15–24 and
scenario 14 remain covered by the v1E.2B suite):

1+2. portal overlay without role=dialog detected through MutationObserver; the
newly added visible subtree becomes the owned probe surface
(`resolutionSource=MUTATION`, observer attached + always disconnected).
3. pre-existing portal ignored (never consumed/closed).
4+8+9. role-less Asset Picker classified via mutation ownership; Escape
cleanup verifies MARKER disappearance (`findMarkerContainer` → null).
5+6. page-wide observe-only fallback works with zero clicks
(`resolutionSource=OBSERVE_FALLBACK` in the log; all marker buttons
`clicked === 0`).
7. unresolved semantic surface still enters rollback (dialog closed, precise
`GENERATION_SURFACE_NOT_RESOLVED`).
10. failed cleanup → `GENERATION_PROBE_CLEANUP_FAILED`, probing stopped with
markers still present.
11+12. confirmed Asset Picker candidate never re-probed; wrong cleanup then
valid settings candidate succeeds.
13. probe diagnostics (`generationProbe/generationCandidate/generationMutation/
openedSurface/cleanup`) present in the developer log via autoPrepare, not only
in error objects.
14. Generate never clicked during discovery (asserted in the portal test +
existing v1E.2 suite).

## 11. Regression result

Extension 270/0. All root Flow suites ALL TESTS PASSED: `test-flow-postv1e`,
`test-flow-postv1b`, `test-flow-postv1c`, `test-flow-postv1d`,
`test-flow-page-adapter`, `test-flow-state-machine`, `test-flow-safety-retry`,
`test-flow-bridge`, `test-flow-jobs`, `test-flow-origin`,
`test-flow-manual-assist`. Rebuilt `.output/chrome-mv3` (`BUILD_OK`;
`resolveProbeSurface`/`findMarkerContainer` verified in bundle).
`ADAPTER_VERSION = 0.4.4-postv1e2c`.

## 12. 3-run live validation matrix

Not yet executed — requires the real browser session. Required protocol:
clean Flow UI (no modal open) → Retry ×3 consecutive. EVERY run must show:
`prompt verified=true`; Asset Picker not leaked/open after any failed probe;
`generationType=IMAGE verified=true`. Deterministic across all 3 runs. Fill in
after live validation:

```text
Run 1: prompt=… pickerLeak=… generationType=… verified=…
Run 2: …
Run 3: …
```

## 13. Next blocker (if any)

After 3 consecutive clean generation passes, the next legitimate blocker is
`ASPECT_NOT_1_1` / `TARGET_ASPECT_NOT_AVAILABLE` (or `OUTPUT_COUNT_NOT_1`) —
do not implement aspect work before generation discovery is stable.

## 14. Conclusion

**POST-v1E.2C CODE COMPLETE — LIVE VALIDATION PENDING**
