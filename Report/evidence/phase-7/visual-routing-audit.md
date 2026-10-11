# Current Visual Routing Audit (Phase 7, read-only, 10/10/2026)

Method: code/docs read at HEAD `891c3c6` + this slice's uncommitted edits; no provider calls, no tests run (no code changed).

## What exists (reuse)
| Capability | Where | Finding |
|---|---|---|
| Visual Story Grammar / modality decision (1G.5) | `lib/visual-motion/{decision,grammar,shared,plan,validator,store}.js` | Pure, deterministic engine. One cost ladder: `STATIC_IMAGE -> EDITOR_MOTION -> GENERATED_MOTION_CANDIDATE -> GENERATED_MOTION_RECOMMENDED`; `resolveRenderMode` yields `STATIC_IMAGE / REMOTION_MOTION / VEO_FIRST_FRAME / VEO_FIRST_LAST / VEO_REFERENCE`. Modality caps (CHART, TYPOGRAPHY, SPLIT_SCREEN -> EDITOR_MOTION). |
| MotionPlan / editor-motion primitives | `lib/motion/*`, `lib/visual-motion/editor-motion.js` | Deterministic 2D motion; no depth-layer/parallax contract found. |
| Asset registry, provenance, rights | `lib/asset-library`, `lib/provenance`, `providers/license-evidence`, `core/POLICY_RIGHTS.md` | Present; to be bound to per-shot decisions. |
| Dependency DAG, generation history, budget guard | `lib/dependency-dag`, `lib/generation-history`, `lib/resource-budget`, `lib/output-cost` | Present; supports partial repair. |
| Capability registry / provider rules | `providers/INDEX.md`, `CONFIG.yaml`, `CAPABILITY_MATRIX.md` | "No hardcoded provider details" already a rule; Flow/Veo as adapters. |
| Visual Bible | `core/VISUAL_BIBLE.md` | Exists; GPS project needs its own style target (not yet authored). |

## Gaps vs the policy (NOT implemented)
1. **No independent VisualSource axis.** `grep` for `PROCEDURAL_GRAPHICS|FLOW_GENERATED_IMAGE|LICENSED_REAL_MEDIA|visualSource|motionEngine` over `lib schemas core context providers scripts tests` returns nothing. The engine's single ladder conflates source and motion (a Flow still and a hand-written SVG are both just `STATIC_IMAGE`/`EDITOR_MOTION`).
2. **No `REMOTION_PARALLAX` / `REMOTION_3D` / `EXISTING_FOOTAGE` / `STATIC_HOLD`** motion codes and no rule rejecting fake parallax from a flat still (ROUTE-04).
3. **No `ShotVisualDecision` contract** with `targetRealism`, `rightsReviewStatus`, `aiDisclosureReview`, `creditEstimate` (null = unknown), `creditApproval`, `alternativeRoutes`.
4. **No hard rule for REQUIRED_REALISTIC_VISUAL + poor local vector + no quota -> BLOCKED** (policy 6.4); the ladder cannot express "realism required".
5. **Flow credit accounting** (per-generation cost, balance before/after, correlation ID, no duplicate spend on reconnect: ROUTE-05/06/07/16) has no dedicated record type found.
6. Veo native audio vs Final Audio conflict check (ROUTE-12) not located.

## Risk on the current critical path
- Defaulting every GPS shot to SVG is exactly the failure the policy names; mitigated in the plan by the explicit shortlist, but nothing in code enforces it yet.
- Duplicate-rule risk: a second router must NOT be built; extend `lib/visual-motion` (add source axis + reason codes, map existing render modes to the new motion codes).

## Market Gap Registry delta (proposed, not written)
Highest existing ID is GAP-051. Proposed **GAP-052 — Independent Visual Source x Motion Engine routing contract** (gaps 1–4 above) and **GAP-053 — Flow credit accounting/idempotency record** (gap 5). Registry file `docs/roadmap/MARKET_GAP_REGISTRY.md` left untouched pending owner go.

## Not verified
Flow UI balance, per-generation cost, active image/video model and availability (`CAPABILITY_UNKNOWN`, `CREDIT_COST_UNKNOWN`). Policy and owner file quote different quotas (50/day free vs 200/month Plus); the account UI decides.
