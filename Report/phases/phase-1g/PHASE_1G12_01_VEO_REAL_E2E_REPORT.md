# PHASE 1G.12 — TASK 01 REPORT

> **V6.1 STATUS CORRECTION (2026-10-05, superseding note — history preserved):** Task 01 = FUNCTIONAL PASS (A/B/C/D real E2E). Under Roadmap V6.1, PHASE 1G = NOT_COMPLETE until the Retroactive Hardening Sweep + Quality Gate (Task 02) passes. See projects/phase1g12-hardening/v61-status-correction.json and Report/PHASE_1G12_02_RETROACTIVE_HARDENING_SWEEP_REPORT.md.

# VEO REAL E2E — IMAGE+REMOTION / FIRST FRAME / FIRST+LAST / REFERENCE CONTINUITY

**Project:** UNFOLDIQ
**Roadmap:** V6 — Scope Frozen
**Execution window:** 2026-10-04 → 2026-10-05
**Task file:** `D:\Downloads All\PHASE_1G12_01_VEO_REAL_E2E.md`
**Handoff at session start:** `AGENT_HANDOFF.md` (stop end-of-day 2026-10-04: CASE_A = PASS; B/C/D pending live ceremony)

---

## 1. Status

```text
TASK_VALIDATION = PASS

PHASE 1G.12 — VEO REAL E2E = COMPLETE

CASE_A_IMAGE_REMOTION       = PASS (2026-10-04)
CASE_B_FIRST_FRAME_TO_VIDEO = PASS (attempt-2, 2026-10-05)
CASE_C_FIRST_LAST           = PASS (attempt-1, 2026-10-05)
CASE_D_REFERENCE_CONTINUITY = PASS (3 shots + cross-shot, 2026-10-05)

CREDITS_SPENT (observed + reconciled) = 50 of hard 100
```

Phase 1G is COMPLETE. No 1H work was started.

---

## 2. Entry Gate

Verified at session start (2026-10-04, handoff §2) by grepping the canonical reports:

- 1G.8 `TASK_VALIDATION = PASS` (`Report/PHASE_1G8_01_OUTPUT_COST_CREDIT_PLANNER_REPORT.md`)
- 1G.9 `TASK_VALIDATION = PASS` (1G.9/1G.10 combined report)
- 1G.10 `TASK_VALIDATION = PASS`
- 1G.11 `TASK_VALIDATION = PASS` (`Report/PHASE_1G11_*` — all required 1G.11 evidence rows VERIFIED, incl. WRONG_* rejections, TIMELINE_ELIGIBILITY_GATE, TARGETED_REPAIR, QA_STALENESS, ASSET_LIBRARY_INTEGRATION)

ENTRY_GATE = PASS.

## 3. Roadmap Contract

The four Roadmap cases were executed as the four real chains. No parallel owners were created: production decisions came from 1G.5 (`lib/visual-motion`), capability/model resolution from 1G.6 (`providers/model-registry`), platform policy from 1G.7, spend from 1G.8 (`lib/output-cost`), instructions from 1G.9 (`projects/channel-mascot/agent-instructions`, `iv-7e784d73e229`), assets from 1G.10 (`lib/asset-library`), QA from 1G.11 (`lib/asset-qa`). 1G.12 contributed only ceremony orchestration CLIs (`scripts/cli/run-case-{b,c,d}.js`) and case evidence under `projects/phase1g12-case-a/`.

## 4. Official Flow Source Reverification

Reverified live on 2026-10-04 against the four official URLs (capability matrix, per-generation costs, frames/ingredients workflows, Agent instructions): **NO drift** vs the 1G.6 baseline snapshot `rs-flow-baseline-2026-10-03` (retrieved 2026-10-03). No registry refresh was needed.

## 5. Provider Registry Drift Check

PROVIDER_REGISTRY_DRIFT = NONE (source reverification above). Cost facts used during the run came from the canonical snapshot's `costObservations` (Omni Flash 1.1: 4s=7, 6s=10, 8s=12, 10s=15 credits/generation, source `flow-credits-16526234`, FRESH). Live UI cost readbacks (7 credits for every 4s generation) matched the canonical values exactly. One registry-adjacent data defect was found and handled — see §8 and §59 (the `as-1186233d1af6` provenance issue is an asset-library data defect, not a provider-truth defect).

## 6. Browser / Extension / Project Gate

- Real path only: operator's authenticated Chrome + Flow project **"UNFOLDIQ — Mascot Live Validation"**, expected `providerProjectRef 8221824c-a1a6-4aa9-8d6b-fac24860d49e` (binding `projects/channel-mascot/flow-project-binding.json`, channel-mascot). No Playwright/headless/unauthenticated browser was used as provider truth.
- `render:doctor` = READY (checked 2026-10-04 before Case A's native render).
- Bridge up on 127.0.0.1:4317, token-gated (401, untouched — agent never touches bridge tokens or Generate controls).
- Every paid submit was performed by the operator; the agent verified tuples via exact-value affirmations + on-disk artifacts and executed everything after download.

## 7. Agent Instructions Gate

- Expected `instructionVersion iv-7e784d73e229`; latest sync `sy-afc793497133` = VERIFIED (2026-10-04T14:15Z, on disk).
- GATE_1_2 (Case B, ceremony log): project identity VERIFIED_OPERATOR_ATTRIBUTED + instructions VERIFIED. The same verified state carried across C and D (no instruction mutation occurred; `instructionVersion` is stamped into every imported asset's lineage).

## 8. Reference Asset Gate

- Case B (attempt-2) / Case C start frame: `as-fe697fd1fef8` — "Blue circle on light background", JPEG 1024×1024, sha256 `fe697fd1fef86e607d743694c223ab8a93347754ba353f1f7eb0cccfbfab9ab7`, QA READY_FOR_TIMELINE, SELECTED + LOCKED.
- Case C end frame: `as-5e0bb7f87d4d` — 1280×720 frame extracted at t=3.9s from the QA-PASS Case B video, `derivedFrom: as-fafd1ac4c96b`, QA PASS, LOCKED.
- Case D character reference: `as-a7801df9bf0f` — mascot guide (JPEG 1024×1024, sha256 `a7801df9bf0f05ee…`), role **CHARACTER_IDENTITY**, `characterIds ["mascot-guide"]`, QA PASS, **reference-locked**; provider mapping recorded (`case/case-d-character.json`).
- The originally planned Case B source `as-1186233d1af6` was **REJECTED** during the run — see §59 (identity finding). Its replacement followed §21/§13 (reuse of an already-paid real result; zero new credits).

## 9. Credit Authorization

- Proposal `bp-9b02221225dd` (real 1G.5→1G.6→1G.8 chain): B=7, C=7, D=12×3, base EXACT 50 + retry reserve 50 → hard 100.
- `OPERATOR_CREDIT_AUTHORIZATION = APPROVED (hard 100)` recorded 2026-10-04T15:37Z in `budget/case-bcd-proposal.json`.
- Mid-run operator directives handled through the canonical chain, never local patches: (a) B retry after attempt-1 FAIL → 1G.8 `authorizeRetry` APPROVED; (b) D duration 8s→4s → budget amendment `bp-1e463dea1689` (see §12); (c) D workflow → canonical re-resolve (see §34/§59).

## 10. Hard Budget Plan

- `budget-plans/1g12-bcd.json` (bp-9b02221225dd, hard 100, scope PROJECT, policy `output-cost-policy-1.0.0`, snapshot `rs-flow-baseline-2026-10-03`).
- Amendment `budget-plans/1g12-d-amendment.json` (bp-1e463dea1689): supersedes **D units only** (durationSeconds 8→4), D units `gu-bde822cbe1dd`/`gu-1b8dbfa2ee4a`/`gu-223a6fbe0e28` @ 7 credits each.
- Every submit was preceded by a logged 1G.8 authorization (`B_ATTEMPT2_PRE_AUTH`, `D_BUDGET_AMENDMENT_AUTH`); every retry passed the budget gate (`authorizeRetry`, lineage + failure class + reserve check).

## 11. Planned Generation Units

| Case | Unit (amendment) | Workflow | Model | Duration | Cost |
|---|---|---|---|---|---|
| B | gu-0ada6dc4cccc | Frames to Video: First | Omni Flash 1.1 | 4s | 7 |
| C | gu-3ff6b479331a | Frames to Video: First and Last | Omni Flash 1.1 | 4s | 7 |
| D1 | gu-bde822cbe1dd | Ingredients/References to Video (VEO_REFERENCE) | Omni Flash 1.1 | 4s | 7 |
| D2 | gu-1b8dbfa2ee4a | Ingredients/References to Video (VEO_REFERENCE) | Omni Flash 1.1 | 4s | 7 |
| D3 | gu-223a6fbe0e28 | Ingredients/References to Video (VEO_REFERENCE) | Omni Flash 1.1 | 4s | 7 |

outputCount = 1 everywhere (§56 no variant explosion). Case A planned zero Veo units.

## 12. Retry Budget

- Original reserve: B 7, C 7, D 12×3. After the 4s amendment: D reserve 7×3.
- Retry policy per unit: `maxAdditionalAttempts: 1`, `allowedFailureClasses` = QA_MOTION_DIRECTION, QA_MOTION_ABSENT, QA_CONTINUITY_OUTFIT, QA_CONTINUITY_IDENTITY, QA_LOCATION, QA_START_END_STATE, QA_FACTUAL_VISUAL, QA_STRUCTURAL, QA_SEMANTIC.
- One real retry was executed (Case B attempt-2, class QA_START_END_STATE + QA_STRUCTURAL): `authorizeRetry` = APPROVED (7 ≤ remaining), lineage `b1-attempt-01 → attempt-2` recorded. Budget-hard-stop was never hit.

## 13. Case A Design

Case A (executed 2026-10-04, prior session, preserved unchanged): shot A-SH01 DETAIL/OBJECT → 1G.5 decision EDITOR_MOTION (`reasonVeoNotNeeded` recorded), locked source image → SLOW_ZOOM_IN editor motion plan → local Remotion render 1920×1080/2000ms/60 frames → frame-diff motion proof → 1G.10 import → 1G.11 QA → gate. `VEO_GENERATIONS_CASE_A = 0`.

## 14. Case A Production Decision

`decision/production-decision.json`: visualModality ANNOTATION, motionNeed LOW, effective EDITOR_MOTION, Remotion primitive SLOW_ZOOM_IN, platform youtube, DECISION_READY. A-matrix 9/9 PASS (A1–A9, incl. A9 = 0 Flow video credits).

## 15. Case A Remotion Execution

Render attempts 1–3 (attempt-1 exposed the structural-probe bug fixed in §59; attempt-3 final): 1920×1080, 2000ms, motion frames differ (zoom applied), no black tail, no missing source asset. Evidence: `render/attempt-*/`, `qa/case-a-qa-summary.json`.

## 16. Case A QA

1G.11 on the real rendered bytes: structural PASS, semantic PASS (MANUAL_REVIEW + FRAME_SAMPLE motion observation), factuality NOT_APPLICABLE (FICTION), continuity NOT_APPLICABLE. Aggregate READY_FOR_TIMELINE; `assertAssetReadyForTimeline` eligible=true.

## 17. Case A Verdict

**CASE_A = PASS** — `case/case-a-result.json` (caseResultId `case-a-d1670f2c6920`, credits 0, VEO 0). Preserved unchanged during this session.

## 18. Case B Source Frame

- Attempt-1 planned source: `as-1186233d1af6` (see §59 — later proven to be the operator's Google account avatar; REJECTED).
- Attempt-2 source: `as-fe697fd1fef8` (blue circle — the real V1F generation result, reused §13, zero new credits), correlated to V1F job `FLOW-COMPANION-LIVE-GEN-01` (`case/case-b-source-frame-correlation.json`), QA PASS, locked. Recorded: assetId, hash, dimensions 1024×1024, reference role = FIRST-FRAME source, selection/lock status.

## 19. Case B Capability Resolution

`mr-f43a8953897b` (1G.6, status PROVISIONAL at plan time, cost KNOWN 7): VIDEO + IMAGE_TO_VIDEO, 16:9, 4s, LANDSCAPE_OUTPUT, Omni Flash 1.1 — `hard_requirement_fit` lines recorded in `budget/case-bcd-proposal.json`.

## 20. Case B Provider UI Verification

- Attempt-1: operator-affirmed tuple (Frames(first), Omni Flash 720p, 16:9, 4s, x1, cost 7) — logged `GATE_3_4_AUTH`. Post-hoc the executed generation contradicted it (see §21) → B3 honestly FAIL for attempt-1.
- Attempt-2: operator re-verified every control at submit (workflow/source/model/resolution/aspect/duration 4s/outputs/cost 7, credits deducted 7) — logged `B_ATTEMPT2_SUBMIT_EVIDENCE`; output conformed (4.001s, blue-circle opening) → B3 PASS.

## 21. Case B Generation

- Attempt-1: submitted 2026-10-04T15:56Z (operator), one generation, job `b1`.
- Attempt-2: submitted 2026-10-05 (operator), one generation, prompt package `pp-b42c2e0af4b2` (compiled via 1G.4 with the blue-circle FRAME reference; `MUST PRESERVE: referenceFrameAppearance`), job `b1` attempt-2 lineage.
- Recorded per §24: jobId, generationUnitId gu-0ada6dc4cccc, attemptIds, providerProjectRef, modelResolutionRef, source assetId, promptVersion, instructionVersion, requested settings, timestamps (ceremony log).

## 22. Case B Correlation

`SINGLE_GENERATION_ATTRIBUTION`: operator affirmed exactly ONE generation per attempt; the Flow project held exactly one video card per attempt; the provider download filename embeds the prompt fingerprint (`Guide_gesturing_in_educational_s…` for attempt-1, `Slow_push-in_on_blue_circle…` for attempt-2); bytes hash-verified. EXACT_RESULT_CORRELATION = VERIFIED for both attempts; no OUT_OF_SCOPE_OPERATOR_GENERATION was correlated (the historical `GEN-01 downloads/` files stayed excluded).

## 23. Case B Download / Import

- Attempt-1: `Guide_gesturing_in_educational_s…_20261005092031.mp4`, 1,599,300 bytes, sha256 `d235316b9af51453…` → imported `as-d235316b9af5` (preserved, QA REJECTED — history kept, §48).
- Attempt-2: `Slow_push-in_on_blue_circle_20261005101624.mp4`, 466,189 bytes, sha256 `fafd1ac4c96b37ee…` → imported `as-fafd1ac4c96b` (h264, 1280×720, 4.001s). ffprobe-verified; provider filenames unmodified.

## 24. Case B Lineage

`as-fafd1ac4c96b`: provider google-flow, jobId b1, shotId B-SH01, promptVersion pp-b42c2e0af4b2, modelVersion google--gemini-omni-flash--1-1, instructionVersion iv-7e784d73e229, referenceIds/derivedFrom = [as-fe697fd1fef8], hash + dimensions + durationMs + provenance (provider-download, operator-attributed). Attempt-1 lineage references the then-canonical source; its promptVersion is honestly recorded `UNRECORDED_ATTEMPT_1` (lineage gap → B9 FAIL on attempt-1, corrected for attempt-2 by persisting the package before submit).

## 25. Case B Real QA

On the real downloaded bytes (1G.11):
- Attempt-1: structural FAIL (duration 10.005s vs 4.000s ±0.5s), semantic PASS (subject mascot-guide + gesture occurred, FRAME_SAMPLE t≈6s), continuity FAIL (opening ≠ locked source frame), factuality NOT_APPLICABLE → aggregate REJECTED.
- Attempt-2: structural PASS (4.001s), semantic PASS (blue circle + push-in, frame evidence `qa/b2-frame-*.png`), continuity PASS (opening = blue circle in 16:9 crop — platform reframe, not identity mutation), factuality NOT_APPLICABLE → aggregate READY_FOR_TIMELINE.

## 26. Case B Verdict

**CASE_B = PASS** (attempt-2; matrix B1–B15 = 15/15, `case/case-b-attempt-02-result.json`). Attempt-1 preserved as FAIL with full repair lineage (`case-b-attempt-01-repair.json`, `source-frame-identity-finding.json`). Credits: b1-attempt-1 = 15 (reconciled from the canonical 10s tier), attempt-2 = 7 (operator-confirmed UI deduction).

## 27. Case C Start / End Assets

Start `as-fe697fd1fef8` (blue circle small) + end `as-5e0bb7f87d4d` (blue circle larger, extracted from the QA-PASS Case B video). Both canonical, hash-verified, locked; coherent state transition (same subject, size progression). Contract persisted in `case/case-c-frames.json` with derivation lineage.

## 28. Case C Capability Resolution

`mr-e9f72db7d52a`: VIDEO + IMAGE_TO_VIDEO + FIRST_LAST_FRAME_VIDEO, 16:9, 4s, Omni Flash 1.1, cost EXACT 7. Provider UI offered **Frames → First + Last** with 4s (operator tuple, `C_ATTEMPT1_SUBMIT_EVIDENCE`) — matched the resolution before spending.

## 29. Case C Generation

Prompt package `pp-0ce16935b74a` (1G.4, both FRAME references, `TEMPORAL PROGRESSION: blue circle small (start frame) -> blue circle larger (end frame)`). One generation, job `c1`, cost 7, submitted by the operator after tuple verification.

## 30. Case C Correlation / Import

Filename fingerprint `Blue_circle_grows_on_background…` + single-generation attribution + hash `6182cea3f996e973…` → imported `as-6182cea3f996` (1280×720, 4.001s) with both parent frames in referenceIds/derivedFrom.

## 31. Case C Start-End / Transition QA

Real 1G.11 on the downloaded bytes: structural PASS; semantic PASS (subject blue circle, action slow-push-in); continuity PASS (startState = `start-frame:blue-circle-small`, endState = `end-frame:blue-circle-larger` — frame evidence `qa/c1-frame-t0.1.png` / `qa/c1-frame-t3.9.png`); motion integrity PASS (frames differ, transition coherent); factuality NOT_APPLICABLE.

## 32. Case C Verdict

**CASE_C = PASS** (attempt-1; matrix C1–C14 = 14/14; `case/case-c-attempt-01-result.json`; timeline eligible). Credits reconciled (7).

## 33. Case D Character / Reference Contract

Canonical recurring character `mascot-guide`: locked reference `as-a7801df9bf0f` (role CHARACTER_IDENTITY, QA PASS, reference lock), verified instructionVersion `iv-7e784d73e229`, provider mapping = Ingredients/References slot ↔ canonical assetId (`case/case-d-character.json`). No provider-side identity replaces the canonical identity.

## 34. Case D Three-Shot Plan (+ workflow re-resolve)

`case/case-d-shot-plan.json`: D1 neutral presenter/friendly wave, D2 raised palm-up presenting gesture, D3 three-quarter turn into hands-on-hips stance — distinct intents, same canonical identity. Prompt packages `pp-3cf8c99df03f` / `pp-05d4a66564c5` / `pp-9e1a1e5fb589` (1G.4, reference-first: `MUST PRESERVE: characterIdentity`, subject referenced by assetId, not re-described).

Workflow history (operator-directed re-resolve, recorded in §59): the original plan (and first amendment) resolved VEO_FIRST_FRAME due to a 1G.5 override bug; after the fix the canonical chain resolves **VEO_REFERENCE (REFERENCE_GUIDED_VIDEO)** for recurring-subject-with-approved-reference — matching the Roadmap's "Ingredients/References" intent — and the live ceremony used **Ingredients / References to Video** with the locked mascot as the character ingredient.

Reuse determination: the earlier 10s mascot video (`as-d235316b9af5`) was evaluated for reuse as a D shot and **NOT_ELIGIBLE** (no VEO_REFERENCE resolution, wrong lineage, QA REJECTED; instruction version was the only met criterion) — `case/determination-d-shot-reuse-01.json`.

## 35. Case D Capability Resolution

Re-resolved through the canonical chain at 4s (minimum-cost operator directive; roadmap requires ≥3 independent shots, no duration minimum): resolutions `mr-526fb7a60ea0` / `mr-530bec09f9f1` / `mr-0538f0b00d8e`, renderMode VEO_REFERENCE, model Omni Flash 1.1 (registry REFERENCE_GUIDED_VIDEO supported, durations [4,6,8,10]), cost EXACT 7 each, amendment `bp-1e463dea1689`. Live UI confirmed Ingredients workflow + 4s + cost 7 before each submit (operator directives: stop on any mismatch — none occurred).

## 36. Case D Generations

Three independent paid generations (one each, sequential, downloaded immediately):

| Shot | File | sha256 | Settings (operator tuple) |
|---|---|---|---|
| D1 | `Character_waving_friendly_stance_20261005105730.mp4` | `0fde400d63929dce…` | Ingredients, mascot ref, Omni 1.1 Flash, 720p, 16:9, 4s, x1, cost 7 |
| D2 | `Character_presenting_palm-up_ges…_20261005111411.mp4` | (record) | same tuple, cost 7 |
| D3 | `Character_turning_to_hips_stance_20261005112125.mp4` | (record) | same tuple, cost 7 |

## 37. Case D Correlation / Imports

Per shot: single-generation attribution + unique filename prompt fingerprint (`waving` / `presenting` / `turning`) + timing + operator affirmation → exact correlation → 1G.10 import with full lineage (characterIds ["mascot-guide"], referenceIds/derivedFrom = [as-a7801df9bf0f], promptVersion pp-d-Dx-v1, instructionVersion, hash, dimensions, durationMs): `as-0fde400d6392` (D1), `as-c9f0fdc1d1e4` (D2), `as-0625f69f9867` (D3). Content-hash dedup active; no duplicate imports (§58/§59).

## 38. Case D Individual QA

Each shot's real 1G.11 (frame evidence `qa/d1-frames/`, `qa/d2-frames/`, `qa/d3-frames/` — 3 frames per shot, visually verified):
- D1: structural PASS (4.001s), semantic PASS (friendly wave at t≈2s), continuity PASS (identity/hair/clothing vs locked reference) → timeline eligible.
- D2: structural PASS, semantic PASS (palm-up presenting gesture t≈2–3.8s), continuity PASS → timeline eligible. Honest notes recorded: Ingredients placed the character in a modern-office environment with waist-up framing (intentional variation, §43) and a pictorial holographic-chart graphic appears near the hand at t≈3.8s (no text).
- D3: structural PASS, semantic PASS (turn + settle into hands-on-hips by t≈3.8s), continuity PASS → timeline eligible.

## 39. Case D Cross-Shot Continuity QA

`case/case-d-cross-shot-continuity.json` (recordId `cross-shot-continuity-d1d2d3`): across 9 representative frames — faceIdentity VERIFIED, hair VERIFIED (short dark brown), outfit VERIFIED (yellow jacket, teal collar, dark shirt/pants), style/palette VERIFIED (same 3D render style). Reviewer honesty: agent FRAME_SAMPLE review (operator manual review not required — match unambiguous per §70). D2's environment/framing variation documented as intentional, not a continuity failure (§43). Decision PASS; evidence refs only, no duplicated image data (§44).

## 40. Case D Verdict

**CASE_D = PASS** — matrix D1–D18 = 18/18 (`case/case-d-result.json`): 3 independent shots PASS + timeline-eligible, same-character identity/hair/outfit/style VERIFIED, reference lineage complete, no duplicate result counted (the 10s video explicitly excluded by determination), all spend reconciled (21 credits).

## 41. Targeted Repair Evidence

One real repair loop was exercised end-to-end (Case B): QA FAIL → failed layer classification (`scopeRetry` → exactly one affected unit gu-0ada6dc4cccc, classes QA_START_END_STATE/QA_STRUCTURAL) → 1G.8 retry gate (APPROVED, 7 ≤ remaining) → root-cause fix (incoherent source/prompt pairing + settings drift; source replaced via the identity finding; prompt recompiled v3) → new attempt → QA PASS. Additionally the 1G.5 override bug fix (§59) was driven by a real workflow mismatch the operator surfaced. No failing asset was overwritten; no unrelated unit was regenerated.

## 42. Attempt / Retry Lineage

```text
B: b1-attempt-01 (FAIL, preserved: as-d235316b9af5, QA REJECTED, 15cr)
 → repair scope gu-0ada6dc4cccc → authorizeRetry APPROVED
 → b1-attempt-02 (PASS: as-fafd1ac4c96b, 7cr)
C: c1-attempt-01 (PASS: as-6182cea3f996, 7cr)
D: d1-attempt-01 (PASS: as-0fde400d6392, 7cr)
   d2-attempt-01 (PASS: as-c9f0fdc1d1e4, 7cr)
   d3-attempt-01 (PASS: as-0625f69f9867, 7cr)
A: render-attempt-1..3 (local, 0cr; attempt-1 exposed the structural-probe bug)
```

Every attempt logged append-only in `case/live-ceremony-log.jsonl` (§61: CEREMONY_START, GATE_1_2, GATE_3_4_AUTH, B2_PENDING, SOURCE_FRAME_IDENTITY_FINDING, B_CORRELATION/IMPORT/QA/VERDICT/REPAIR_SCOPE, B_ATTEMPT2_*, C_*, D_* events). Nothing overwritten.

## 43. Credit Ledger / Reconciliation

`budget/ledger.json` — final: `creditsObserved 50, committed 0`, every entry RECONCILED with its reconciliation source:

| Attempt | Credits | Reconciliation source |
|---|---|---|
| b1-attempt-01 | 15 | 1G.6 canonical cost observation, Omni Flash 1.1 10s tier = 15 (`flow-credits-16526234`); executed duration 10.005s measured by ffprobe; Flow UI cost display unavailable retroactively (honest upper-bound reconciliation; the "must not be treated as 0 without observation" rule upheld) |
| b1-attempt-02 | 7 | operator-reported Flow UI: cost shown 7, credits deducted 7 |
| c1-attempt-01 | 7 | operator-reported cost shown 7 (before/after balance placeholder left unfilled — weaker evidence, recorded as such) |
| d1/d2/d3-attempt-01 | 7 each | operator-reported cost shown 7 each |

Hard budget 100 never breached; final remaining 50. No credit constants in production logic (costs always via 1G.6 observations / 1G.8 plan).

## 44. Asset Library Integration

All final media are canonical 1G.10 AssetRecords with hash + lineage (§57: content hash computed at import; new download → new asset, no silent replacement; §58/§59 idempotent correlation/download via hash dedup — verified by re-running `record` with `dedup=true`). Locked references never mutated. Final timeline-eligible assets: `as-4bd9e3ccdc42` (A), `as-fafd1ac4c96b` (B), `as-6182cea3f996` (C), `as-0fde400d6392`/`as-c9f0fdc1d1e4`/`as-0625f69f9867` (D).

## 45. QA / Timeline Gate Integration

Every case ran real 1G.11 on real bytes and passed `assertAssetReadyForTimeline` before its verdict (§46: provider READY ≠ case PASS). QA results persisted per asset (`qa/as-*/qa-*.json`) with per-attempt summaries. Timeline assembly was NOT implemented (§71); Phase 2 audio / Phase 4 QC / 1H untouched (§72–74).

## 46. Negative / Failure Handling

Real failures surfaced and handled honestly, none hidden:
1. B1 executed settings diverged from the affirmed tuple (10s vs 4s; opening ≠ source frame) → attempt-1 FAIL, repair loop §41.
2. `as-1186233d1af6` provenance proven false (account avatar) → REJECTED, source replaced (§59).
3. 1G.5 override bug demoting VEO_REFERENCE → fixed with suite green (§59).
4. Structural probe decode bug (in-memory bytes before filePath) found by Case A → fixed filePath-first, 1G.11 structural suite re-green.
5. Weak ledger evidence for C (unfilled before/after balance) recorded as weaker evidence rather than claimed as full deduction proof.
6. Terminal blockers (§68 list): none occurred — no AUTH/PROJECT/UI-drift/correlation-ambiguity blockers materialized; the pre-registered stop rules (FLOW_UI_DRIFT, capability unavailable) were armed for every submit.

## 47. Security / Privacy

No bridge tokens, cookies, account tokens, or Authorization headers persisted anywhere in evidence. Provider project/result IDs and hashes only. Downloaded media treated as untrusted (probed, never executed). Host security untouched: no SAC/Defender/registry/Code Integrity changes (§75). Secrets never entered prompts/tests/logs/reports.

## 48. Case A Test Matrix

A1=PASS A2=PASS A3=PASS A4=PASS A5=PASS A6=PASS A7=PASS A8=PASS A9=PASS (0 Veo credits; `case/case-a-result.json`).

## 49. Case B Test Matrix

Attempt-2 (final): B1=PASS B2=PASS B3=PASS B4=PASS B5=PASS B6=PASS B7=PASS B8=PASS B9=PASS B10=PASS B11=PASS B12=PASS B13=PASS B14=PASS B15=PASS.
Attempt-1 (preserved): B3=FAIL B9=FAIL B10=FAIL B13=FAIL B14=FAIL B15=PENDING — honest record.

## 50. Case C Test Matrix

C1=PASS C2=PASS C3=PASS C4=PASS C5=PASS C6=PASS C7=PASS C8=PASS C9=PASS C10=PASS C11=PASS C12=PASS C13=PASS C14=PASS.

## 51. Case D Test Matrix

D1=PASS D2=PASS D3=PASS D4=PASS D5=PASS D6=PASS D7=PASS D8=PASS D9=PASS D10=PASS D11=PASS D12=PASS D13=PASS D14=PASS D15=PASS D16=PASS D17=PASS D18=PASS.

## 52. Repair Test Matrix

Deterministic integration tests (prior session): `tests/real-e2e/test-repair-scope.js` (R1–R8, 21 asserts) + `test-case-result.js` (13 asserts) — 34/34 PASS. Real repair loop exercised in production during Case B (§41) — R1–R8 semantics held live (single-unit scoping, budget gate, history preservation, replacement lineage).

## 53. Schemas

No new schema was required: `RealE2eCaseResult` (§78) is built refs-only by `lib/real-e2e/case-result.js` over canonical GenerationJob/AssetRecord/QA/budget artifacts, validated by `e2e.buildCaseResult` (invalid refs refused). Existing `schemas/asset-qa-result.schema.json` (1G.11) validated QA results.

## 54. Targeted Regression

Executed 2026-10-05 after all cases completed:

| Suite | Command | Result |
|---|---|---|
| 1G.5 visual-motion (incl. override fix) | `node tests/story/test-visual-motion-decision.js` | 136 passed, 0 failed |
| Providers/registry | `node scripts/run-tests.js providers` | 0 failed suites |
| Full regression | `npm test` | **14 domains, 0 failed suites, 300.5s** (cost, flow, media, pipeline, platform, policy, providers, qa, real-e2e, remotion, research, research-deep, story, topic) |
| Flow Companion extension | `cd flow-companion/extension && npm test` | passed=525, failed=0 |
| Repo structure | `npm run check:repo-structure` | REPOSITORY_STRUCTURE_OK |

No test was weakened or skipped.

## 55. Full Regression

Covered by the `npm test` run above (all domains green; 1G.5/1G.6/1G.7/1G.8/1G.9/1G.10/1G.11 suites inside `story`/`providers`/`policy`/`cost`/`qa` domains; correlation/import in `flow`; Remotion suites in `remotion`; schemas validated in-suite). Extension/native suites green separately. Durations: full regression 300.5s; extension suite fast (~seconds, 525 asserts). No host-security toggle was needed (no native render this session — Case A's render was completed 2026-10-04 under the previously-authorized SAC window).

## 56. Files Created

- `scripts/cli/run-case-b.js`, `scripts/cli/run-case-c.js`, `scripts/cli/run-case-d.js` (ceremony pipelines: correlate → import → QA → gate → matrix → verdict → repair scope; case C/D include budget-amendment/finalize subcommands)
- `lib/real-e2e/` (`repair-scope.js`, `case-result.js`, `index.js`) + `tests/real-e2e/` (2 suites) — prior session, exercised live this session
- `projects/phase1g12-case-a/` evidence tree: `case/` (correlations, attempt results, repair records, identity finding, reuse determination, prompt-package summaries, character/shot-plan/resolutions/amendment summaries, cross-shot record, ceremony log), `qa/` (per-asset QA results + frame evidence d1/d2/d3-frames), `scene/validation-scene-{b,c,d}.json`, `budget/ledger.json`, `budget-plans/1g12-d-amendment.json`, `prompts/` (persisted 1G.4 packages), `downloads/` (operator downloads, provider filenames intact)
- Prior session (carried): `lib/asset-qa/` (11 modules), `schemas/asset-qa-result.schema.json`, `tests/qa/*` (6 suites), `scripts/cli/run-case-a.js`, `scripts/cli/propose-case-bcd-budget.js`, `remotion/public/unfoldiq/phase1g12-case-a/`

## 57. Files Modified

- `lib/visual-motion/index.js` — override path kept `identityCritical: false` hardcoded, demoting VEO_REFERENCE → VEO_FIRST_FRAME on explicit selection; fixed to preserve the decision's own REFERENCE_GUIDED_VIDEO requirement (1-line fix + comment; 1G.5 suite 136/136 green after). (File is inside the untracked new 1G.5 tree — no tracked file touched.)
- `lib/asset-qa/structural.js` — probe order fix (filePath first) — prior session, carried.
- `projects/phase1g12-case-a/assets/library-index.json` — registry mutations via canonical mutators only (quality REJECTED for the avatar asset; SELECTED/locked for new references).
- Tracked-file modifications from EARLIER sessions (flow-companion, lib/research-deep, etc.) were present in `git status` at session start and were not touched.

## 58. Files Deleted

None. (One-off artifacts were not created outside the canonical evidence tree; nothing needed cleanup.)

## 59. Known Limitations

1. **`as-1186233d1af6` identity defect (registry data quality).** Verified during this phase: the 32×32 "GEN01" PNG is the operator's Google account avatar (`lh3.googleusercontent.com/ogw/…=s32-c-mo`), never a generation result — per the V1F report's own correction section. The phase1g12 case-library copy was marked REJECTED with the finding as reason (`case/source-frame-identity-finding.json`); the postv1b project's record (locked by fix02-migration with false provenance "approved live result GEN01") belongs to an earlier phase and was flagged, not mutated. Case A's PASS is preserved with this caveat: its gates were executed honestly against the registry state at execution time, and its subject matter (validation slate zoom) did not depend on the avatar's content.
2. **B1 settings divergence root cause unknowable retroactively.** The 10s/no-first-frame execution contradicted the affirmed pre-submit tuple; whether the duration control moved after affirmation or Flow's Omni Flash ignored it cannot be resolved from evidence. Mitigation applied: strict re-verification + live cost readback for every later submit (all conformed).
3. **Correlation method is single-generation attribution** (operator-only submit path; provider result IDs not captured). Strengthened by prompt fingerprints in provider filenames + hash verification + one-card-per-attempt project state. B1 attempt-1's prompt package was never persisted (promptVersion `UNRECORDED_ATTEMPT_1`) — recorded as the B9 FAIL it was; fixed from attempt-2 onward.
4. **Ledger evidence strength varies.** B1's 15-credit reconciliation derives from the canonical 1G.6 cost table (UI unobservable retroactively) — an honest upper bound; C's before/after balance was left unfilled by the operator and is recorded as weaker evidence.
5. **D2 environment variation** (office scene, waist-up) came from Ingredients composition; accepted as intentional variation (§43) with the continuity contract carried by identity/hair/outfit/style.
6. **`remotion/public/unfoldiq/phase1g12-case-a/`** staged render source remains (regenerable, prior session).

## 60. Acceptance Checklist

**Case A (§83):** 1. 1G.5 decided Veo unnecessary ✓ 2. no Veo generation ✓ 3. canonical source image ✓ 4. existing Remotion path ✓ 5. motion matches intent (frame-diff) ✓ 6. 1G.11 QA pass ✓ 7. timeline-eligible ✓ 8. canonical lineage ✓ 9. no unnecessary spend (0 credits) ✓

**Case B (§84):** 1. canonical first frame ✓ 2. FIRST_FRAME resolved via 1G.6 ✓ 3. provider UI matched (attempt-2; attempt-1 divergence honestly handled) ✓ 4. 1G.8 authorized ✓ 5. real generation ✓ 6. exact correlation ✓ 7. download ✓ 8. import ✓ 9. lineage complete ✓ 10–13. real structural/semantic/temporal/continuity QA pass ✓ 14. timeline gate ✓ 15. ledger reconciled (15cr attempt-1 honestly upper-bounded + 7cr UI-confirmed) ✓

**Case C (§85):** 1–2. canonical start/end images ✓ 3. FIRST_LAST resolved via 1G.6 ✓ 4. provider workflow verified pre-generation ✓ 5. budget authorized ✓ 6. real generation ✓ 7. exact correlation ✓ 8. download/import ✓ 9. both parents in lineage ✓ 10–11. opening/ending state match ✓ 12. transition intent pass ✓ 13. motion integrity ✓ 14. timeline gate ✓ 15. spend reconciled ✓

**Case D (§86):** 1. canonical recurring character ✓ 2. locked reference ✓ 3. verified instructions version ✓ 4. ≥3 independent real shots ✓ 5. reference-capable workflow resolved (VEO_REFERENCE/Ingredients after canonical re-resolve) ✓ 6. every result exactly correlated ✓ 7. all downloaded/imported canonically ✓ 8–10. every shot structural/semantic/motion QA pass ✓ 11–14. cross-shot identity/hair/outfit/style pass ✓ 15. reference lineage ✓ 16. all three timeline-eligible ✓ 17. failed-shot independence (no sequence regeneration; the 10s video excluded by determination, not by sequence retry) ✓ 18. spend reconciled ✓

**Global (§87):** 1–11 ✓ (entry gates, docs rechecked, no drift, project verified, instructions current, references verified, authorization approved, hard budget enforced, outputCount 1, bounded retries, A PASS) 12–14 ✓ (B/C/D PASS) 15–23 ✓ (exact correlation, canonical import, hashes, lineage, real QA, no UNKNOWN falsely accepted — every UNKNOWN would have blocked; timeline gates; local repair; history preserved; no unrelated regeneration) 24–26 ✓ 27–28 ✓ (no secrets; host security unchanged) 29–31 ✓ (1G.9/1G.10/1G.11 green in full regression) 32–33 ✓ (targeted + full regression green) 34 ✓ (no 1H work).

## 61. Final Verdict

```text
TASK_VALIDATION = PASS

PHASE 1G.12 — VEO REAL E2E = COMPLETE

CASE_A_IMAGE_REMOTION = PASS
VEO_AVOIDANCE_WHEN_UNNECESSARY = VERIFIED

CASE_B_FIRST_FRAME_TO_VIDEO = PASS
FIRST_FRAME_WORKFLOW = VERIFIED
CASE_B_REAL_VIDEO_QA = VERIFIED

CASE_C_FIRST_LAST = PASS
FIRST_LAST_WORKFLOW = VERIFIED
START_END_STATE_QA = VERIFIED

CASE_D_REFERENCE_CONTINUITY = PASS
THREE_SHOT_CHARACTER_CONTINUITY = VERIFIED
REFERENCE_LINEAGE = VERIFIED

EXACT_RESULT_CORRELATION = VERIFIED
DOWNLOAD_IMPORT = VERIFIED
ASSET_LINEAGE = VERIFIED
REAL_1G11_QA_INTEGRATION = VERIFIED
TARGETED_REPAIR_LOOP = VERIFIED (exercised live in Case B)
TIMELINE_ELIGIBILITY_GATE = VERIFIED

CREDIT_AUTHORIZATION = VERIFIED
HARD_BUDGET = VERIFIED (100; 50 observed + reconciled, 50 remaining)
CREDIT_LEDGER = VERIFIED (every entry RECONCILED with recorded source)

PHASE 1G = COMPLETE

NEXT = PHASE 1H.1 — VERSIONED PROJECT MANIFEST
```

Real imported asset IDs/hashes: `as-fafd1ac4c96b` (fafd1ac4c96b37ee98eaf6599b529dcf3a60e97b4947b961a195ea530629998c), `as-6182cea3f996` (6182cea3f996e973ee8c99cf43cd7f5527c18975f8a6e8d0487587913ff04c3f), `as-0fde400d6392` (0fde400d63929dcea574645d2fa8eea6f4990d8ac199db9446f1c26b7cbc3250), `as-c9f0fdc1d1e4`, `as-0625f69f9867`; references `as-fe697fd1fef8`, `as-5e0bb7f87d4d`, `as-a7801df9bf0f`; historical `as-d235316b9af5` (QA REJECTED, preserved).

STOP — per §90. No 1H work performed.
