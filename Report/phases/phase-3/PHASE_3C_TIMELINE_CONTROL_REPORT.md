# PHASE 3C — TIMELINE CONTROL — REPORT

**Package:** Phase 3C — Manual Override Layer (3.4) + Responsive Timeline (3.5)
**Date:** 2026-10-07
**Spec:** `D:\Downloads All\UNFOLDIQ_PHASE_3C_TIMELINE_CONTROL.md`
**Verdict:** **PHASE_3C = COMPLETE; PHASE_3 = COMPLETE; PHASE_4A_READY = YES** (see §29)

---

## 1. Entry gate

Phase 3B evidence verified in `Report/phases/phase-3/PHASE_3B_MOTION_SYSTEM_REPORT.md` (§§27–29):

```text
PHASE_3B_FUNCTIONAL = PASS · PHASE_3B_QUALITY_GATE = PASS
MOTION_PRIMITIVE_LIBRARY / MOTION_GRAMMAR / MOTION_PLAN = READY
TRANSITION_TIMING / TRANSITION_HANDLE_SAFETY / CANONICAL_DURATION_PRESERVATION = PROVEN
VISUAL_COVERAGE_GRAMMAR / FLASH_SAFETY_FOUNDATION = READY
MOTION_WORKSPACE_PERSISTENCE / LOCAL_MOTION_PATCH / STALE_PATCH_PROTECTION = PROVEN
P0 = 0 · P1_CRITICAL = 0 · FULL_REGRESSION = PASS · HYGIENE = PASS
PHASE_3B = COMPLETE · PHASE_3C_READY = YES
```

Planning inputs read before scope freeze: execution package (§3 market review), updated `MARKET_GAP_REGISTRY.md` (14 gaps), Phase 3B report, repo evidence (`lib/timeline`, `lib/motion`, `lib/workspace`, `lib/caption-grouping` PLATFORM_DEFAULTS, `lib/generation-history` append-only pattern, platform PROFILE.yaml/OVERLAY.md, `remotion/src` layers). No second motion/persistence/history framework added.

## 2. Repo baseline

- Master Timeline + MotionPlan + stores: in-memory facades with durable MotionPlan persistence (3B) — 3C reuses both, adding override replay and variant derivation on top.
- `lib/visual-motion.applyManualOverride` (1G.5 production-strategy override) answers a different question and was left untouched; 3C override layer (`lib/override/`) owns timeline/motion/layout operator intent.
- No history-governance lib existed (only `tests/history` for generation history) — 3C keeps an append-only history inside the override store file instead of inventing a parallel system.
- Platform facts consumed, not duplicated: 16:9 1920×1080 (youtube PROFILE), 9:16 1080×1920 + bottom UI zone (tiktok PROFILE), caption budgets 84/42 chars (`caption-grouping` PLATFORM_DEFAULTS).
- `remotion/src/` untouched (layout stays data; renderer remains Phase 4).

## 3. Fresh Market Gap Review

Package §3 (07/10/2026) adopted as the fresh benchmark; URLs cited in-package:

| # | Benchmark | UNFOLDIQ decision | Where |
|---|---|---|---|
| 3.1 | Premiere Auto Reframe (derived sequence, subject reframing, operator-tunable) | derived variants, subject-aware framing plan, manual reframe override, versioned profile, lineage; CV tracker deferred | `lib/responsive/*` |
| 3.2 | Premiere Safe Zones | profile-driven zones, layout validation, subject visibility; no universal margin | `lib/responsive/profiles.js` |
| 3.3 | Remotion parameterized/layout controls | data-driven rects/crops/scales; no CSS mutation as canonical state | `lib/responsive/variant.js` |
| 3.4 | Runway Agent/Stadio (agent+manual co-edit, Undo/Redo) | override history, undo/reset semantics, provenance, no silent agent overwrite; full UI parity rejected | `lib/override/*` |

## 4. Override contract

`lib/override/overrides.js` (`OVERRIDE_VERSION 1.0.0`): `ManualOverrideRecord` with overrideId/version/projectId, 6 target types, 21 operations, scope (GLOBAL/BASE_TIMELINE/VARIANT_ONLY), source (OPERATOR/AGENT/SYSTEM_REPAIR), priority, reason, timestamps, baseRevision + dependencyHashes, status (ACTIVE/SUPERSEDED/RESET/CONFLICT). ajv-validated shape (`schemas/override-record.schema.json`). Record-time validation rejects unknown targets/ops and caption text/timing payloads.

## 5. Override precedence

Enforced order: SAFETY/CORRECTNESS > OPERATOR (100) > LOCKED > SYSTEM_REPAIR (40) > AGENT (10) > DEFAULT. Hard blocks no override can bypass: unresolvable asset, speech-timing mutation, out-of-canonical retime, flash-unsafe transition, unknown primitive/modality, caller policy-check refusal. Ordinary agent preference always loses to explicit operator intent (Cases A–E).

## 6. Override operations

All 21 spec operations implemented: REPLACE_ASSET, ADJUST_VISUAL_TIMING (visual-only, inside canonical duration; speech-bound → BLOCK + upstream routing), LOCK/UNLOCK_ITEM, LOCK/UNLOCK_SCENE (item-group), FORCE_VISUAL_MODALITY (13-value vocabulary), FORCE_STATIC, FORCE_MOTION_PRIMITIVE (registry-validated), CHANGE_TRANSITION (feasibility + flash gates), CHANGE_MOTION_TIMING, CHANGE_CAPTION_STYLE (style/layout keys only), REQUEST_REGENERATE_SCENE/ASSET (local routing), SET_LAYOUT/CROP/SCALE/POSITION/SUBJECT_ANCHOR (variant-consumed intents), RESET_OVERRIDE, RESET_OVERRIDE_SCOPE. No free-form code mutation exists.

## 7. Lock semantics

Scopes ITEM/SCENE/MOTION/TRANSITION (+ASSET_CHOICE/LAYOUT via record scope): locks replay onto fresh builds, survive unrelated repair and responsive derivation, variant-specific locks stay variant-scoped. Case B proves scene-lock survival; motion-lock path reuses the 3B lock mechanism.

## 8. History / Undo / Redo / Reset

Append-only history per store (revision, operation, target, before/after, source, timestamp, reason, overrideId) persisted with records in `overrides.json`. UNDO marks the last eligible OPERATOR commit undone + SUPERSEDES its record; REDO re-activates; both refuse on substantive later touches (UNDO_CONFLICT/REDO_CONFLICT; bookkeeping commits excluded). RESET/RESET_SCOPE mark records RESET (replay skips them) while history stays traceable. Case H proves all paths incl. the conflict branch.

## 9. Stale override handling

Freshness = baseRevision + asset/range/scene dependency hashes vs current target. Identical semantics at a new revision → silent-safe rebase (baseRevision updated). Changed semantics → record marked CONFLICT + `OVERRIDE_CONFLICT` (BLOCK) finding; nothing replays silently (Case I). Persist path refuses stale overwrites; patch-equivalent staleness covered by revision checks.

## 10. Single-scene regeneration

`REQUEST_REGENERATE_SCENE` resolves a routing scope: exact scene branch DIRTY; unrelated scenes, Final Audio, alignment, captions CLEAN (Case F). Actual regeneration stays the agent's job — the layer guarantees locality, not execution.

## 11. Responsive profiles

`lib/responsive/profiles.js` (`PROFILE_VERSION 1.0.0`): `landscape-16x9@1.0.0` (1920×1080, default CONTAIN) + `portrait-9x16@1.0.0` (1080×1920, default SMART_CROP, TikTok bottom-weighted zones). Each carries action/title/caption/criticalSubject safe zones (canvas fractions), layout policy refs, and platform source. Caption line budgets consumed from `caption-grouping` (84/42). 1:1/4:5 left unblocked per spec.

## 12. Variant lineage

`ResponsiveTimelineVariant 1.0.0`: variantId/projectId, sourceTimelineId/Revision, sourceMotionPlanRevision, responsiveProfileRef, layoutItems, reframePlans, caption/title/data layouts, motion/transition adjustments, variantOverrides, revision, qaStatus, dependencyHashes, timestamps. ajv-validated (`schemas/responsive-variant.schema.json`). Base change → `rebaseVariant`: dropped branches removed, surviving layouts byte-identical, compatible overrides preserved, conflicts explicit (Case U).

## 13. Reframe policy

Decision order implemented in `resolveFraming`: OPERATOR anchor/path > trusted metadata (DETECTED/EXISTING_METADATA, confidence ≥ 0.5) > static bounds (ASSUMED) > FALLBACK (CENTER + REVIEW when portrait crop risks content). No tracking claim without a trackingPath (Case M proves null paths + FALLBACK source).

## 14. Subject framing

`SubjectFraming` contract: subjectId/sourceBounds/anchor/importance/trackingPath/confidence/source. Smoothing: moving-average (w=5) + per-step clamp 0.015 + jitter metric (mean |second difference|); repair re-smooths tighter (0.008). Reframe plans persist the framed `subjectCenter`, so variants self-validate without re-supplying metadata. Case N: 20-frame oscillating path → maxStep ≤ 0.015, jitter reduced, no jitter finding.

## 15. Caption/title/overlay responsive layout

Captions: greedy reflow to profile line budget (42 chars × 2 lines portrait), bottom-center anchored in the caption safe zone, font-scale ∈ [0.8, 1.1]; word identity asserted equal (Case P) — layout changes, factual text never rewritten. Titles/overlays: preferred anchor, scale bounds, wrap/stack/reposition flags; shrink below readability → BLOCK + REVIEW (never silent unreadable). Positions validated against profile zones (Case Q).

## 16. Chart/map/diagram responsive layout

Portrait strategy RE_STACK with BELOW label placement; readability estimated (longest label × conservative char width vs zone width). Unfittable → `CHART_UNREADABLE`/`MAP_LABEL_CROPPED`/`DIAGRAM_LABEL_CROPPED` (REVIEW); repair SWITCH_RESPONSIVE + BELOW_STACKED; legend always preserved; labels re-placed, never destructively cropped (Cases R–S).

## 17. Safe-zone policy

All zones profile-driven and persisted per variant; validation covers critical subject, captions, titles, overlays, chart/map/diagram labels. No universal margin anywhere. Final encoded-output visual validation stays Phase 4B (GAP-018 → PARTIALLY_FIXED / FINAL_OUTPUT_CHECK_4B).

## 18. Variant-specific motion/transition adaptation

Derived per variant as data: PAN/PUSH/PULL amplitude ×0.6, PARALLAX ×0.7 in portrait; SLIDE_PUSH horizontal → VERTICAL geometry with timing unchanged. Base MotionPlan never mutated; narrative cut timing never changes (§29: timing preserved — Case Y).

## 19. Local patch / dependency

`patchResponsiveVariant` (SET_CROP/LAYOUT/SCALE/POSITION/SUBJECT_ANCHOR; idempotent replay; wrong `expectedRevision` → VARIANT_STALE, Case V). `resolveVariantInvalidation`: VARIANT_ONLY change → variant layout/render-QA DIRTY; base, siblings, Final Audio, alignment, caption timing, source media CLEAN (Case X). Base-asset change → affected variant branches DIRTY with compatible overrides re-evaluated (Case U).

## 20. Persistence / idempotency

Overrides+history (`overrides.json`), variants (`variant-<id>.json`) via workspace TIMELINE/DURABLE governance: atomic tmp+rename, shape validation on read, stale refusal, restart/resume proven byte-identical (Cases W + override-side equivalents). Patch/override replay idempotent; locked state preserved across rebuilds (3B Case T still PASS).

## 21. QA / local repair

Override QA (§34): 11 codes implemented (TARGET_MISSING/STALE→via CONFLICT/CONFLICT/BREAKS_LOCK(implicit via lock precedence)/BREAKS_TIMING/BREAKS_SAFETY/INVALID_ASSET/TRANSITION/LAYOUT/UNDO_CONFLICT/REDO_CONFLICT), each with severity + target + reason + correctiveAction. Responsive QA (§35): 16 codes (SUBJECT_OUT_OF_FRAME/CRITICAL_CONTENT_CROPPED/LAYOUT_CONFLICT/SAFE_ZONE_VIOLATION/CAPTION_OVERFLOW+SAFE_ZONE_FAIL/TITLE_OVERFLOW+SAFE_ZONE_FAIL/CHART_UNREADABLE/MAP+DIAGRAM_LABEL_CROPPED/REFRAME_LOW_CONFIDENCE/REFRAME_JITTER/VARIANT_STALE/OVERRIDE_CONFLICT). Repair map (§36) with 5-attempt/5s bound; exhaustion → REVIEW_REQUIRED. No UI manipulation; no Phase 4 renderer pulled (§38 limitation carried).

## 22. Cases A–Y

`tests/override/test-override.js` **10/10** + `tests/responsive/test-responsive.js` **15/15** — all on real Master Timeline/MotionPlan manifests (shared `tests/fixtures/timeline-control-fixture.js`), real temp-root workspace for persistence:

```text
A replace-asset wins · B scene lock · C force modality · D transition change+gates ·
E caption style (text safe) · F one-scene scope · G reset · H undo/redo+conflict ·
I stale conflict · J safety beats override ·
K derivation+lineage · L subject crop · M fallback honest · N smoothed path ·
O operator reframe · P caption reflow · Q title zone · R chart · S map/diagram ·
T variant isolation · U rebase · V stale variant patch · W persistence ·
X timing isolation · Y NTSC — ALL PASS
```

## 23. Performance baseline

Measured 2026-10-07, 4-visual-item 60 s timeline (web-30); no budgets claimed:

```text
override apply / undo / redo / reset   < 1 ms each
16:9 derivation                        2 ms
9:16 derivation (+framing)              0–1 ms
variant validation                     < 0.1 ms (avg ×20)
variant patch                          < 1 ms
variant repair (single finding)        ~1 ms
variant artifact (4 items)             ~3 KB
override history (3 commits)           lines-scale JSON, retained fully
base→variant rebase                    O(items) filter + hash (sub-ms at this size)
```

## 24. Regression

Per-domain `node scripts/run-tests.js` (single `npm test` exceeds the 10-min tool timeout by cumulative time, not failure): timeline/motion/override/responsive/workspace, flow/providers/pipeline, topic/research/story/captions/alignment/mix/music/pairing/storage/policy/cost/dag, remotion/media/qa/compliance/golden/history/narration/platform/project-manifest/pronunciation/provenance/recovery/spoken-script/telemetry/voice-bible, research-deep/real-e2e — **0 failed suites everywhere**. `npm run check:repo-structure` → OK. No 3A/3B regression (timeline 18+6, motion 23 still PASS).

## 25. Market Gap Registry update

`docs/roadmap/MARKET_GAP_REGISTRY.md`: preserved GAP-004 FIXED, GAP-005 PARTIAL/4B, GAP-012 FIXED, GAP-013 PARTIAL/4B, GAP-014 deferred/5; added GAP-015 (override precedence/history → FIXED), GAP-016 (variant lineage → FIXED), GAP-017 (reframe foundation → FIXED, tracker trigger registered), GAP-018 (safe-zone/layout → PARTIALLY_FIXED / FINAL_OUTPUT_CHECK_4B). Counts: 18 gaps — FIXED 7 · PARTIALLY_FIXED 4 · PLANNED 2 · DEFERRED 2 · REJECTED 2 · OPEN 1 (live-gated). P0 = 0; Phase-4-blocking P1 = 0.

## 26. Phase 3C Quality Gate

```text
MANUAL OVERRIDE: contract [x] · precedence [x] · survives rerun [x] · replace asset [x] ·
  visual timing w/o speech break [x] · scene/item lock [x] · force modality [x] ·
  transition [x] · caption style [x] · one-scene regen [x] · reset [x] · undo [x] · redo [x] ·
  history persisted [x] · stale conflict [x] · safety hard-block [x]
RESPONSIVE: profiles [x] · 16:9 [x] · 9:16 [x] · derived [x] · base non-destructive [x] ·
  lineage [x] · variant overrides [x] · local invalidation [x] · rebase preserves [x] · conflicts explicit [x]
SUBJECT/REFRAME: contract [x] · metadata-driven [x] · manual override [x] · no fake success [x] ·
  bounded/smoothed [x] · safe-zone validation [x]
LAYOUT: caption reflow w/o rewrite [x] · title [x] · overlay [x] · chart [x] · map [x] · diagram [x] ·
  profile zones [x] · no destructive crop [x]
DEPENDENCY/PERSISTENCE: overrides durable [x] · history durable [x] · variants durable [x] ·
  resume [x] · stale protection [x] · variant isolation [x] · timing clean [x] · idempotency [x]
AGENT/QA: structured APIs [x] · findings+actions machine-readable [x] · bounded repair [x] ·
  no UI [x] · renderer not pulled [x]
MARKET GAP: benchmark [x] · precedence FIXED [x] · lineage FIXED [x] · reframe recorded [x] ·
  safe-zone recorded [x] · no blocking P0/P1 [x]
COMPLETION: A–Y 25/25 [x] · baseline [x] · P0=0 · P1=0 · regression PASS · hygiene PASS · report [x]
```

## 27. Phase 3 Major Gate

```text
2–3 min canonical timeline .................... PASS (3A Case A, 150 s anchor)
timing from current Final Audio .............. PASS (3A Cases C/O)
machine-readable Master Timeline ............. PASS (ajv schema 1.0.0)
canonical assetId references ................. PASS (RULE 4/5)
rational timebase / frame rounding ........... PASS (GAP-004 FIXED)
media/color metadata foundation ............. PASS (GAP-005 partial, 4B owns output)
deterministic MotionPlan ..................... PASS (3B, rebuild-identical)
grammar anti-template ........................ PASS (3B repetition guards)
transition timing/handles .................... PASS (GAP-012 FIXED)
visual coverage/rest ......................... PASS (3B Cases N/O)
local timeline/motion patch .................. PASS (3A-F, 3B-S)
manual override survives rerun ............... PASS (3C-A)
override history/reset ....................... PASS (3C-G/H)
16:9 → 9:16 derivation ...................... PASS (3C-K)
variants do not mutate base .................. PASS (3C-K/T)
safe-zone/layout QA .......................... PASS (3C-P/Q/R/S)
affected-branch-only invalidation ............ PASS (3C-F/U/X)
structured patch/regenerate, no UI ........... PASS (§33 APIs)
latency baselines ............................ PASS (3A §19, 3B §23, 3C §23)
P0 = 0, no Phase-4-blocking P1 .............. PASS
regression + hygiene ......................... PASS
```

## 28. Honest limitations

```text
1. No Remotion component mapping for overrides/variants yet (Phase 4 renderer).
2. Single-scene regenerate is routing/locality only; execution is agent-side.
3. Caption style vocabulary is structural (scale/anchor); no font-asset pipeline.
4. No CV subject tracker — trigger registered if future quality evidence demands it.
5. Flash/rights gates reuse 3B + caller policyCheck hook; no new rights engine.
6. Encoded-output visual/flash validation stays Phase 4B (GAP-013/018).
7. 1:1/4:5 profiles not shipped (non-blocking per spec).
8. No MCP/public API freeze (deliberate).
```

## 29. Final verdict

```text
PHASE_3C_FUNCTIONAL                 = PASS
PHASE_3C_QUALITY_GATE               = PASS

MANUAL_OVERRIDE_LAYER               = READY
OVERRIDE_PRECEDENCE                 = PROVEN
OVERRIDE_HISTORY                    = PROVEN
UNDO_REDO_RESET                     = PROVEN

RESPONSIVE_TIMELINE                 = READY
VARIANT_LINEAGE                     = PROVEN
BASE_NON_DESTRUCTIVE                = PROVEN

SUBJECT_REFRAME_FOUNDATION          = READY
SAFE_ZONE_LAYOUT                    = READY

LOCAL_VARIANT_PATCH                 = PROVEN
STALE_OVERRIDE_PROTECTION           = PROVEN
STALE_VARIANT_PROTECTION            = PROVEN

P0                                  = 0
P1_CRITICAL                         = 0

FULL_REGRESSION                     = PASS
HYGIENE                             = PASS

PHASE_3C                            = COMPLETE
PHASE_3                             = COMPLETE
PHASE_4A_READY                      = YES
```

## Context Loaded

| Path | Requirement | Loaded | Purpose |
|---|---|---|---|
| `core/WORKFLOW.md`, `core/CONTEXT_ROUTER.md`, `AGENTS.md` | REQUIRED (router) | LOADED | Routing + standing rules |
| Execution package Phase 3C | REQUIRED (task) | LOADED | 3C spec §§0–48 |
| `Report/phases/phase-3/PHASE_3B_MOTION_SYSTEM_REPORT.md` | REQUIRED (entry gate) | LOADED | 3B evidence |
| `docs/roadmap/MARKET_GAP_REGISTRY.md` | REQUIRED (planning) | LOADED + UPDATED | GAP-015–018 |
| `lib/timeline/*`, `lib/motion/*`, `lib/workspace/*` | REQUIRED (baseline) | LOADED | Reuse before build |
| `lib/caption-grouping.js`, `platforms/*/PROFILE.yaml`, `platforms/*/OVERLAY.md` | REQUIRED (caption/zones) | LOADED | Budgets + canvas facts |
| `lib/generation-history`, `remotion/src/*` | REQUIRED (baseline) | LOADED | Patterns + no-touch verify |
