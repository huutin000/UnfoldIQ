# PHASE 3B — MOTION SYSTEM — REPORT

**Package:** Phase 3B — Motion Primitive Library (3.2) + Editing / Motion Grammar (3.3)
**Date:** 2026-10-07
**Spec:** `D:\Downloads All\UNFOLDIQ_PHASE_3B_MOTION_SYSTEM.md`
**Verdict:** **PHASE_3B = COMPLETE; PHASE_3C_READY = YES** (see §28)

---

## 1. Entry gate

Phase 3A evidence verified in `Report/phases/phase-3/PHASE_3A_MASTER_TIMELINE_CORE_REPORT.md`:

```text
PHASE_3A_FUNCTIONAL           = PASS
PHASE_3A_QUALITY_GATE         = PASS
MASTER_TIMELINE               = READY
TIMEBASE_POLICY               = PASS
FRAME_ROUNDING                = PROVEN
MEDIA_CONFORM                 = READY
COLOR_METADATA_FOUNDATION     = READY
LOCAL_TIMELINE_PATCH          = PROVEN
STALE_PATCH_PROTECTION        = PROVEN
GAP_004                       = FIXED
GAP_005                       = PARTIAL
P0                            = 0
P1_CRITICAL                   = 0
FULL_REGRESSION               = PASS
HYGIENE                       = PASS
PHASE_3A                      = COMPLETE
PHASE_3B_READY                = YES
```

Planning inputs read before scope freeze: this execution package (§3 market review), `docs/roadmap/MARKET_GAP_REGISTRY.md` (pre-update state), Phase 3A report, current repo evidence (`lib/timeline/*`, `lib/visual-motion/*`, `lib/workspace/*`, `remotion/src/*`, `schemas/master-timeline.schema.json`). No second motion framework added: the pre-existing `lib/visual-motion/` (shot-production strategy decisions, 1G.5) answers a different question (which *production route* per shot) and was left untouched; Phase 3B adds the new `lib/motion/` namespace (which *deterministic primitive* on which *timeline frames*, and *why*).

## 2. Repo baseline

- Master Timeline: `lib/timeline/master-timeline.js` + `timebase.js` (rational frame rates, integer-ms editorial clock) + `media-conform.js` + `color-policy.js`; store is an in-memory facade (`createTimelineStore`) — §31 wiring required and done (§19).
- Pre-3B motion: `lib/visual-motion/` (decision/plan/grammar/editor-motion for production routing) — reused conceptually (presence restraint, anti-template warnings), not duplicated.
- Workspace governance: `lib/workspace/index.js` (`resolveArtifactPath`, `validateWorkspacePath`, registry `projects/registry.json`) — reused for durable persistence, no second persistence system.
- Renderer: `remotion/src/` untouched by 3B (motion plans are data; renderer mapping is Phase 4). `npx remotion compositions` not re-run: no `remotion/` files changed.

## 3. Fresh Market Gap Review

Package §3 (dated 07/10/2026) adopted as the fresh benchmark; URLs cited in-package, no separate live browse (no new facts needed beyond the package):

| # | Benchmark | UNFOLDIQ decision | Where |
|---|---|---|---|
| 3.1 | Remotion `TransitionSeries` (presentation/from/timing split; duration ≤ adjacent; invalid adjacency rejected) | presentation/timing split; overlap semantics; feasibility validator; no duration drift | `lib/motion/primitives.js`, `timing.js`, `motion-plan.js` |
| 3.2 | Premiere alignment (CENTER/START/END/CUSTOM) + handle requirements | `alignment`, `durationFrames`, `sourceHandleRequirement`, honest fallback | `motion-plan.js` `buildMotionPlan`/`validateMotionPlan` |
| 3.3 | Premiere keyframes/interpolation | normalized keyframe contract, no scattered frame math | `timing.js` |
| 3.4 | Remotion easing/spring | versioned `MotionTimingPreset` (linear/ease-in-out/ease-out/gentle-spring) | `timing.js` |
| 3.5 | Remotion motion-blur render cost | cost class + capability metadata; blur OFF by default; optimization deferred to Phase 5 | `primitives.js`, `grammar.js` |
| 3.6 | W3C WCAG 2.2 flash guidance (>3 flashes/s) | versioned `FlashSafetyPolicy`; BLOCK/REVIEW; no certified-analyzer claim | `grammar.js` |

## 4. Primitive Registry

`lib/motion/primitives.js` (`REGISTRY_VERSION 1.0.0`): **22 versioned primitives**, all `deterministic: true`, each with category, `supportedAssetTypes` (Master Timeline track vocabulary), `parameterSchemaRef`, required params, timing capabilities, min/max duration, `supportsMotionBlur`, `renderCostClass` (LOW/MEDIUM/HIGH), `safety {mayFlash, mayCauseRapidMotion}`, fallback. `validatePrimitiveParams` enforces required keys, persisted seeds, bounded PARTICLES density [1,500], bounded camera transforms (scale [0.5,4], offsets [-1,2]), asset-type support. No unversioned primitive on the canonical path.

## 5. Timing / Keyframes / Easing

`lib/motion/timing.js` (`TIMING_VERSION 1.0.0`): 4 presets — `linear`, `ease-in-out` (cubic-in-out), `ease-out` (cubic-out), `gentle-spring` (damping 20 / stiffness 120 / mass 1 / overshootClamping true). `evaluateTiming` is pure (preset, progress). `normalizeKeyframes` accepts `{frame}` or `{progress}`, validates integer in-range placement and known `easingRef`; `sampleKeyframes` interpolates numerically. `seededRandom` (mulberry32, string-hashed) is the single seeded-PRNG owner for HANDHELD/PARTICLES.

## 6. Camera primitives

PAN, ZOOM, KEN_BURNS, PUSH, PULL (bounded, easing-capable, blur-capable) + HANDHELD (seed-required, LINEAR-only, MEDIUM cost, rapid-motion flagged, fallback PAN). Subject/frame-safe bounds enforced at param validation (§4). Case C proves deterministic paths + in-range keyframes; Case R proves seed persistence + identical rebuilds.

## 7. Reveal / Focus / Depth

REVEAL, MASK_REVEAL, BLUR_TO_FOCUS, FOCUS_TO_BLUR (all LOW/MEDIUM, non-flashing) + LIGHT_SWEEP (`mayFlash: true`, MEDIUM, fallback REVEAL) + PARALLAX (MEDIUM, fallback PAN). Parallax honesty: asset without layers/depth metadata → REVIEW finding, never fake success (Case D). Case E proves purposeful blur reveal.

## 8. Chart / Diagram animation

CHART_REVEAL, CHART_HIGHLIGHT, DIAGRAM_STEP_REVEAL, PATH_DRAW (all LOW, EASING-capable). `validateChartSemantics` blocks hidden labels, dramatized scales, decorative reordering, and order-vs-narration mismatch as `MISLEADING_CHART_ANIMATION` (BLOCK). Case F proves both directions.

## 9. Transition system

CUT, FADE, CROSSFADE, SLIDE_PUSH, WIPE (roadmap baseline; no Remotion-catalog copying). Per-transition contract: `transitionId`, from/to, `primitiveRef`, `timingPresetRef`, `alignment`, `durationFrames`, `cutFrame` (resolved from timeline adjacency), `sourceHandleRequirement` (derived from alignment per Premiere semantics), `fallback` (CUT/FADE/REVIEW_REQUIRED), `reason`/`cutMotivation`, `locked`. `transitionWindow()` computes frame-exact overlap windows per alignment.

## 10. Transition handles / duration preservation

Feasibility per transition: duration > 0, ≤ min(adjacent usable), handles available (else `TRANSITION_HANDLE_MISSING` → honest CUT/FADE fallback, never silent freeze), cut-boundary exactness, duplicate-cut rejection, unknown-primitive rejection, flash-capable review. Canonical invariant: motion span is computed from items only; transitions are overlaps — `TRANSITION_CHANGES_CANONICAL_DURATION` (BLOCK) fires on any drift. Cases G (exact windows 444–456 / 450–462 / 438–450 @ cut 450, d 12), H, I (3 transitions, span == canonical), J, W (NTSC exactness) prove it.

## 11. Editing / Motion Grammar

`lib/motion/grammar.js` (`MOTION_GRAMMAR_POLICY_VERSION 1.0.0`): pure policy over narrative beat, shot role, modality, source dynamics, speech/caption density, tone/energy/tension, reveal timing, motion/transition history. Cut motivations: 10-value vocabulary (`CUT_MOTIVATIONS`); no reason → prefer CUT/HOLD (transitions carry `reason`, default "transition at editorial boundary", and `cutMotivation`).

## 12. Motion Presence / Purpose

`decidePresence`: 11 purposes (`MOTION_PURPOSES`); `REDUCE_MONOTONY` alone caps at SUBTLE; no purpose → STATIC (RULE 1); unknown purpose → STATIC; already-dynamic source → STATIC unless FOLLOW_SUBJECT/EXPLAIN_STRUCTURE; caption-heavy + decorative → STATIC; chapter/major-reveal → FEATURED. Case A proves no-purpose → STATIC + QA PASS.

## 13. Visual Rest / Coverage

`buildCoveragePlan`: COVERED / INTENTIONAL_VISUAL_REST / UNRESOLVED_REQUIRED_GAP. This closes the Phase 3A conceptual gap: stillness can be planned rest instead of auto-flagged missing creativity. Case N (rest ≠ gap), Case O (required gap BLOCKs with `REQUEST_VISUAL_ASSET`).

## 14. Repetition / Anti-template foundation

`detectRepetition`: same primitive+direction+timing runs (≥3 in 4-window) → `REPETITIVE_MOTION_PATTERN`; transition runs (≥3, non-CUT) → `REPETITIVE_TRANSITION_PATTERN`. Repair alternates primitive via `fallbackPrimitiveId` or settles STATIC. Phase 6 owns global originality scoring — this is the measurable foundation. Case K proves detect + repair.

## 15. Caption-aware motion

`captionRestraint`: ACTIVE/FEATURED decorative motion over HIGH caption density → `CAPTION_DISTRACTION_RISK` → repair SET_STATIC. Grammar pre-restraints the direct path; QA is the independent net (Case L). Phase 3C owns responsive collision/layout; 3B owns intent restraint.

## 16. Flash safety

`FLASH_SAFETY_POLICY 1.0.0` (max 3 flashes / sliding 1s window, conservative red-flash review posture). `validateFlashSafety` → PASS / REVIEW (flash-capable declared inside policy) / BLOCK. Repair replaces with FADE/CUT and clears flashes. No certified-analyzer claim anywhere. Case P proves >threshold injection BLOCKs. GAP-013 → PARTIALLY_FIXED / FINAL_OUTPUT_CHECK_4B.

## 17. Motion blur / cost baseline

`MOTION_BLUR_POLICY 1.0.0` (default OFF). `decideMotionBlur` + QA: blur on non-capable primitive or without reason → `MOTION_COST_REVIEW` → repair disables blur. Cost classes: 15 LOW / 5 MEDIUM / 1 HIGH (PARTICLES) / transitions LOW–MEDIUM. Samples/shutterAngle persisted when enabled. No Phase 5 optimization pulled forward. Case Q proves both directions. GAP-014 → PARTIALLY_FIXED / OPTIMIZATION_DEFERRED_5.

## 18. MotionPlan

`MOTION_PLAN_VERSION 1.0.0`: version/projectId/timelineId/timelineRevision/`timebasePolicyRef`/revision, items (motionItemId, timelineItemId, presence, purpose, primitiveRef, timingPresetRef, frameRange, params, keyframes, motionBlur, safetyDecision, locked, reason, confidence, layer, dependencyHashes), transitions (§9), coverage (§13), qaStatus, inputHashes, appliedPatchIds. ajv-validated against `schemas/motion-plan.schema.json` (proven valid, §25). Defaults: IMAGE→KEN_BURNS, VIDEO→PAN, CHART→CHART_REVEAL, DIAGRAM→DIAGRAM_STEP_REVEAL, MAP→PAN, OVERLAY/TITLE→REVEAL; seeded primitives auto-seed deterministically (persisted hash, not RNG).

## 19. Persistence

`persistMotionPlan` / `loadMotionPlan` / `persistTimelineSnapshot` via workspace governance (`resolveArtifactPath` TIMELINE/DURABLE + `validateWorkspacePath`): atomic tmp+rename write, schema-shape validation on read, stale-overwrite refusal (`PATCH_CONFLICT` vs `expectedRevision`), project-dir isolation. Case V proves persist → simulated restart → byte-identical reload + stale refusal. MasterTimeline snapshot path provided alongside MotionPlan (§31 both artifacts covered).

## 20. Local patch / lock

Patch ops: LOCK/UNLOCK_MOTION, REPLAN_MOTION, REPLACE_PRIMITIVE, RETIME_MOTION, SET_STATIC, CHANGE_TIMING_PRESET. `expectedRevision` mismatch → PATCH_CONFLICT; `appliedPatchIds` replay = idempotent no-op; locked items reject all mutating ops (`LOCK_VIOLATION`); store rebuild preserves locked items when timeline revision unchanged (Case T). `resolveMotionInvalidation`: motion/scene-render/QA branches DIRTY; Final Audio, alignment, captions, source media CLEAN (Case S). Bounded repair: maxAttempts 5, 5000 ms budget, hard stop with unresolved list (repair never loops forever; budget exhaustion → REVIEW_REQUIRED).

## 21. QA / local repair

QA dimensions implemented (§35): primitive validity, frame-range validity, transition feasibility + handles, canonical-duration preservation, keyframe/timing validity, determinism, motion/transition repetition, hierarchy (≥3 simultaneous layers → decorative conflict), caption restraint, visual coverage, chart semantics, flash safety, cost classification, locked-state preservation (store), stale dependency. Finding taxonomy (§36): 20 codes, all with severity + frame range + reason + correctiveAction. Repair map (§37): 8 corrective actions; cases H/K/L/P/Q prove repair convergence.

## 22. Cases A–W

`tests/motion/test-motion-system.js`: **23/23 PASS** (real Master Timeline manifests from `lib/timeline`, real workspace temp-root for persistence; no mocks of the timeline contract):

```text
A STATIC-valid · B Ken Burns · C Pan/path+keyframes · D Parallax honest ·
E Blur reveal · F Chart order · G Alignment exact · H Handle fallback ·
I Duration preserved · J Structural conflict · K Repetition · L Caption restraint ·
M Dynamic-source restraint · N Visual rest · O Required gap · P Flash block ·
Q Blur cost · R Seeded determinism · S Local patch · T Lock survival ·
U Stale conflict · V Persistence/resume · W NTSC exactness — ALL PASS
```

## 23. Performance baseline

Measured 2026-10-07, 30-item 3-minute timeline (web-30), no budgets claimed:

```text
MotionPlan build latency        2 ms
MotionPlan validate latency     0.1 ms (avg ×20)
Local motion patch latency      1 ms
Repair (single-finding path)    < 1 ms (within validate loop)
MotionPlan serialization        23,414 bytes (30 items)
STATIC/SUBTLE/ACTIVE split      fixture-dependent (Case A: 100% STATIC; perf fixture: 100% ACTIVE by construction)
Primitive distribution          tracked per plan (summarizeMotionStats)
Transition density              0–10/min measured via summarizeMotionStats
Full rebuild vs local patch     patch mutates one item + re-QA (~1 ms vs ~2 ms build; gap widens with item count — patch is O(items) QA only, build is O(items) timeline+motion)
```

## 24. Dependency / idempotency

Stale timeline revision → `STALE_TIMELINE_INPUT` (BLOCK, rebuild required). Identical inputs → byte-identical items across rebuilds (Case B determinism assertion). Patch replay → idempotent no-op. Locked + unchanged revision → preserved across reruns (Case T).

## 25. Regression

Full `node scripts/run-tests.js` equivalent executed per-domain (single `npm test` exceeded the 10-min tool timeout by cumulative time, not by failure): flow/providers/pipeline, timeline/motion/workspace, remotion/media/qa, topic/research/story/captions/alignment/mix/music/pairing/storage/policy/cost/dag, compliance/golden/history/narration/platform/project-manifest/pronunciation/provenance/recovery/spoken-script/telemetry/voice-bible, research-deep/real-e2e — **0 failed suites everywhere**. `npm run check:repo-structure` → OK. No Phase 3A regression (timeline 18+6 still PASS).

## 26. Market Gap Registry update

`docs/roadmap/MARKET_GAP_REGISTRY.md`: GAP-004 stays FIXED; GAP-005 stays PARTIALLY_FIXED / PLANNED_FOR_4B; added GAP-012 (transition timing/handles → FIXED), GAP-013 (flash safety → PARTIALLY_FIXED / FINAL_OUTPUT_CHECK_4B), GAP-014 (blur cost → PARTIALLY_FIXED / OPTIMIZATION_DEFERRED_5). Counts: 14 gaps — FIXED 4 · PARTIALLY_FIXED 3 · PLANNED 2 · DEFERRED 2 · REJECTED 2 · OPEN 1 (live-gated). P0 = 0; Phase-3-blocking P1 = 0.

## 27. Quality Gate

```text
PRIMITIVE LIBRARY: registry versioned [x] · roadmap families implemented (22/22 incl. all baseline) [x] ·
  params schemas/contracts [x] · timing presets versioned [x] · keyframes deterministic [x] ·
  seeded randomness [x] · cost class [x] · safety metadata [x]
TRANSITIONS: alignment [x] · duration [x] · handles [x] · feasibility [x] ·
  honest fallback [x] · duration preserved [x] · speech/caption timing preserved [x] · conflicts rejected [x]
GRAMMAR: presence gate [x] · no-purpose→STATIC [x] · cut motivation [x] · shot/cut-density stats [x] ·
  camera policy [x] · hierarchy [x] · visual rest [x] · repetition guard [x] ·
  dynamic-source restraint [x] · caption restraint [x] · chart semantics [x]
COVERAGE: COVERED [x] · INTENTIONAL_VISUAL_REST [x] · UNRESOLVED_REQUIRED_GAP blocks [x]
SAFETY: policy versioned [x] · flash metadata [x] · injection detected [x] · no certified claim [x]
COST: blur metadata [x] · blur off default [x] · effects classified [x] · baseline [x] · no premature optimization [x]
PERSISTENCE: timeline+plan durable via governance [x] · resume proven [x] · locks survive [x] ·
  local patch clean [x] · stale protection [x] · idempotency [x]
AGENT/QA: structured contract [x] · machine-readable findings+actions [x] · bounded repair [x] ·
  local preview strategy documented (affected shot + handles; full pilot stays Phase 4) [~] · no UI needed [x]
MARKET GAP: benchmark [x] · handle gap FIXED [x] · flash recorded [x] · blur recorded [x] · no blocking P0/P1 [x]
COMPLETION: A–W 23/23 [x] · P0=0 · P1=0 · regression PASS · hygiene PASS · report persisted [x]
```

Local preview: strategy is documented policy (affected shot/transition + context handles, caption overlay, audio reference); executable preview rendering belongs to the Phase 4 renderer and was not built here — the only non-executable checkbox above.

## 28. Honest limitations

```text
1. MotionPlan is planning data; no Remotion component mapping exists yet (Phase 4 renderer work).
2. VFR relies on Phase 3A metadata providers (unchanged); media conform decides but does not transcode (4B).
3. Color stays metadata/policy (4B owns encoded-output verification).
4. Flash safety is plan-level; final encoded-output flash validation is Phase 4B.
5. Motion-blur optimization deferred to Phase 5 profiling.
6. Local preview is strategy-only; no preview renderer shipped.
7. UNRESOLVED_REQUIRED_GAP enforcement exists in QA; upstream asset acquisition is out of scope.
8. No MCP/public API freeze (deliberate, RULE 18).
```

## 29. Final verdict

```text
PHASE_3B_FUNCTIONAL                 = PASS
PHASE_3B_QUALITY_GATE               = PASS

MOTION_PRIMITIVE_LIBRARY            = READY
MOTION_GRAMMAR                      = READY
MOTION_PLAN                         = READY

TRANSITION_TIMING                   = PROVEN
TRANSITION_HANDLE_SAFETY            = PROVEN
CANONICAL_DURATION_PRESERVATION     = PROVEN

VISUAL_COVERAGE_GRAMMAR             = READY
FLASH_SAFETY_FOUNDATION             = READY

MOTION_WORKSPACE_PERSISTENCE        = PROVEN
LOCAL_MOTION_PATCH                  = PROVEN
STALE_PATCH_PROTECTION              = PROVEN

P0                                  = 0
P1_CRITICAL                         = 0

FULL_REGRESSION                     = PASS
HYGIENE                             = PASS

PHASE_3B                            = COMPLETE
PHASE_3C_READY                      = YES
```

## Context Loaded

| Path | Requirement | Loaded | Purpose |
|---|---|---|---|
| `core/WORKFLOW.md` | REQUIRED (router) | LOADED | Stage routing |
| `core/CONTEXT_ROUTER.md` | REQUIRED (router) | LOADED | Routing procedure |
| `AGENTS.md` | REQUIRED (router) | LOADED | Standing rules |
| Execution package Phase 3B | REQUIRED (task) | LOADED | 3B spec §§0–48 |
| `Report/phases/phase-3/PHASE_3A_MASTER_TIMELINE_CORE_REPORT.md` | REQUIRED (entry gate) | LOADED | 3A evidence |
| `docs/roadmap/MARKET_GAP_REGISTRY.md` | REQUIRED (planning) | LOADED + UPDATED | Gap freeze + GAP-012–014 |
| `lib/timeline/*`, `lib/workspace/*`, `lib/visual-motion/*`, `remotion/src/*` | REQUIRED (baseline) | LOADED | Reuse-before-build |
