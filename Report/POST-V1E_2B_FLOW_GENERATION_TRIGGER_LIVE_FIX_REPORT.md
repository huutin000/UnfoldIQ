# POST-v1E.2B — FLOW GENERATION TRIGGER LIVE FIX + RETRY PREPARATION STATUS REPORT

Date: 2026-09-30
Scope: wrong generation trigger (Asset Picker) exclusion + probe cleanup contract + retry notification lifecycle
Mode: ponytail (prompt handling untouched — POST-v1E.1 remains LIVE PASS; aspect/output untouched)

## 1. Live evidence

- POST-v1E.1 LIVE PASS holds: `prompt input resolved`, `prompt verified=true`.
- POST-v1E.2 live run reaches generation discovery but fails:
  `stage=generation-type code=GENERATION_MENU_NOT_RESOLVED`, `generationType=UNKNOWN verified=false`, Generate found=true enabled=false.
- **Critical visual evidence**: during the failed probe, Google Flow opened an
  **ASSET PICKER** modal ("Search assets / All / Images / Videos / Voices /
  Characters / Avatars / Uploads / Upload media") — the resolver had clicked an
  asset/reference control inside the composer instead of the generation-settings
  trigger. Live-confirmed trigger misclassification.

## 2. Asset Picker misclassification root cause

The v1E.2 candidate finder accepted any composer `aria-haspopup`/`aria-expanded`
control; the asset/reference control (e.g. "Add media") matched that shape, was
probed, and opened the picker. The opened surface was then unresolvable as a
generation menu (its "Images"/"Videos" are plural tabs, never exact choices) and
the old code collapsed everything into `GENERATION_MENU_NOT_RESOLVED` with no
guaranteed cleanup.

## 3. Candidate classification (P0)

`classifyGenerationTrigger(cand)` → `ASSET_REFERENCE | GENERATION_SETTINGS |
SUBMIT | UNKNOWN`, from accessible metadata (aria-label/title/name — no CSS
classes, not a bare text blacklist):

- ASSET_REFERENCE: /add (image|media|video|audio|asset|voice|character|avatar)/, "media", "asset(s)", "upload", "referenc*", "ingredient", "attach", "search assets".
- SUBMIT: generate/create/submit/tạo.
- GENERATION_SETTINGS: generation/settings/preferences/model/sliders/quality/advanced.

`findGenerationTriggerCandidates` now annotates every candidate with
`category`, `nearGenerate`, `rankingSignals`, and RANKS them (P1):
GENERATION_SETTINGS +30, hasPopup +5, near-generate (same toolbar /
parent-contains-Generate) +10, ASSET_REFERENCE −50, SUBMIT −60. Proximity is
ranking evidence only — never verification. `ASSET_REFERENCE` and `SUBMIT`
candidates are EXCLUDED before any interactive probing.

## 4. Surface classification (P0, observe-only)

`classifySurface(surface, choices)` → `GENERATION_MENU` (exact "Image" AND
"Video" choices present) | `ASSET_PICKER` (≥2 markers from "search assets",
"upload media", "uploads", "voices", "characters", "avatars") | `UNKNOWN`.
Plural "Images"/"Videos" never match the exact generation choices, so an asset
picker can never produce IMAGE/VIDEO generation state (regression-tested both
through `detectGenerationType` and `classifySurface`).

## 5. Probe cleanup contract (P0, transaction-like)

Every probe: capture currently open surfaces (menus/listboxes/dialogs) → click
candidate → bounded wait → classify ONLY newly visible surfaces (surface
identity; pre-existing dialogs are never consumed) → verified generation menu
continues selection; anything else is ROLLED BACK:

- cleanup order: surface-local Close button (when reliably resolved) → Escape;
- disappearance verified (bounded poll) + composer still usable
  (resolvability unchanged from before the probe);
- cleanup is guaranteed on EVERY failure/timeout path (try/finally) — the
  verified-selection path is the only one that persists;
- cleanup failure → **STOP** with `GENERATION_PROBE_CLEANUP_FAILED`; probing
  never continues while a foreign surface remains open;
- no page coordinates, no nth-child/index (source-scanned regression), Generate
  never clicked during discovery.

## 6. Precise error codes (replacing GENERATION_MENU_NOT_RESOLVED)

`GENERATION_TRIGGER_NOT_FOUND` (with candidate diagnostics),
`GENERATION_SURFACE_NOT_RESOLVED`, `GENERATION_WRONG_SURFACE` (confirmed
ASSET_PICKER and no later verified candidate), `GENERATION_PROBE_CLEANUP_FAILED`,
`IMAGE_OPTION_NOT_FOUND`, `GENERATION_TYPE_NOT_IMAGE`. Failures carry
`err.diagnostics = { candidates, attempts }` (accessibleName/role/hasPopup/
category/rankingSignals per candidate; openedSurface classification + cleanup
method/verifiedClosed per attempt) which flows into the command `detail` and
the error card's technical section. sidepanel maps `GENERATION_[A-Z_]+` and
`IMAGE_OPTION_NOT_FOUND` to the preparation friendly message.

## 7. Retry / preparation notification lifecycle (P1)

`Toast.createPreparationStatus(container, { labels, createEl })` — ONE
persistent keyed element (`data-toast-key="auto-prepare-status"`), injectable
element factory for node tests:

- `begin()` → attempt id + persistent "Đang chuẩn bị…" (replaces any stale
  notification from the previous attempt — retry cannot stack duplicates);
- intermediate toasts ("Đã kết nối Google Flow", "Đã tải công việc") remain
  transient and can never remove/trim the keyed element (showToast trim loop
  now skips it);
- `success(id)` → replaces with "Đã chuẩn bị xong"; `failure(id)` → replaces
  with "Không thể hoàn tất chuẩn bị" (error detail stays in the technical
  section; no internal objects in toasts);
- attempt-id guard: a stale attempt's success/failure/clear is a no-op —
  superseded attempts can never touch the current notification;
- NO auto-dismiss timer anywhere — lifetime follows the async operation;
  terminal states always clear the preparing element.

sidepanel `runPipeline`: `begin()` immediately on Retry (before resolve), the
old transient "Đang chuẩn bị…" info toast removed, `failure()` on
resolve/fetch/preparation failure (including GENERATION_WRONG_SURFACE /
CLEANUP_FAILED / TRIGGER_NOT_FOUND), `success()` on AWAITING_USER_APPROVAL,
`clear()` on the resumed-generation path. Concurrent duplicate runs remain
blocked by the existing `guard("primary", …)`.

## 8. Changed files

- `flow-companion/extension/src/content/flow-page-adapter.js` — candidate classification + ranking, surface classification, surface identity, cleanup contract, rewritten discovery with precise codes, ADAPTER_VERSION `0.4.3-postv1e2b`
- `flow-companion/extension/src/content/content-commands.js` — failure detail carries structured diagnostics
- `flow-companion/extension/src/ui/toast.js` — `createPreparationStatus`, keyed-element trim protection
- `flow-companion/extension/src/ui/state/labels.vi.js` — `prepDone`, `prepFailed`
- `flow-companion/extension/src/ui/sidepanel.js` — prep-status lifecycle in runPipeline, GENERATION_*/IMAGE_OPTION_NOT_FOUND friendly mapping
- `flow-companion/extension/tests/run.js` — 19 new regressions (KeyboardEvent shim for the Escape path)
- Rebuilt: `.output/chrome-mv3` (`BUILD_OK`; new code verified in bundle)

## 9. Tests

Extension suite: **passed=237 failed=0**. New v1E.2B regressions (required
scenarios → tests): asset candidate excluded before probing (1); asset picker
plural "Images/Videos" never a generation menu (2); wrong candidate opens
picker → closed → next probed (3); Escape closes wrong modal (4); surface-local
Close cleanup (5); cleanup failure → GENERATION_PROBE_CLEANUP_FAILED (6);
wait-timeout path still cleans up (7); pre-existing dialog never mistaken for
the probe surface (8); settings+proximity candidate ranks first (9); proximity
alone never verifies (10); no nth-child/index/coordinate dependency
(source-scanned, comments excluded) (11); Generate never clicked (12, plus
existing v1E.2 test); verified Image/Video menu still works (13, existing
v1E.2 suite); all previous v1E.1/v1E.2/v1E.2A regressions green (14).
Notifications: exactly one persistent "Đang chuẩn bị…" on retry, no duplicate
stacking (15, 21); persists with no auto-dismiss while pending (16, 23);
intermediate connection/job-loaded toasts never remove it (17, 18); success →
"Đã chuẩn bị xong" (19, 24); failure → "Không thể hoàn tất chuẩn bị" (20, 24);
stale attempt id cannot close/update the current attempt (22).

## 10. Regression result

Extension 237/0. All root suites ALL TESTS PASSED: `test-flow-postv1e`,
`test-flow-postv1b`, `test-flow-postv1c`, `test-flow-postv1d`,
`test-flow-page-adapter`, `test-flow-state-machine`, `test-flow-safety-retry`,
`test-flow-bridge`, `test-flow-jobs`, `test-flow-origin`,
`test-flow-manual-assist`.

## 11. Live validation status

**POST-v1E.2B CODE COMPLETE — LIVE VALIDATION PENDING.** After reload +
Thử lại: "Đang chuẩn bị…" appears immediately and persists; the Asset Picker
must NOT remain open after a misfire; expected progression `prompt
verified=true → generationTriggerFound=true → generationMenu options=[Image,
Video] → generationType=IMAGE verified=true → aspect/output`. Terminal states
replace the preparing notification with "Đã chuẩn bị xong" / "Không thể hoàn
tất chuẩn bị".

## 12. Next blocker (if any)

If discovery still fails on the live UI, the failure detail now contains the
full candidate diagnostics (accessible names, categories, ranking signals),
opened-surface classification, and cleanup results — report those verbatim;
do not guess selectors. Acceptable next blockers after IMAGE verification:
`ASPECT_NOT_1_1` / `OUTPUT_COUNT_NOT_1` (do not patch before live evidence).
Full automation PASS still requires real Generate → result detected → import.

## 13. Conclusion

**POST-v1E.2B CODE COMPLETE — LIVE VALIDATION PENDING**
