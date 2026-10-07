# PHASE 1G.8 — PROMPT 01
# OUTPUT / COST / CREDIT PLANNER REPORT

Date: 2026-10-03
Roadmap: V6 — Scope Frozen
Previous gate: `TASK_VALIDATION = PASS / PHASE 1G.7 — PLATFORM POLICY = COMPLETE` (verified in-repo before any edit)

```text
TASK_VALIDATION = PASS
PHASE 1G.8 — OUTPUT / COST / CREDIT PLANNER = COMPLETE
EFFECTIVE_SELECTION_SEMANTICS = VERIFIED
UNSELECTED_CANDIDATE_SPEND = 0
CURRENT_COST_SOURCE = VERIFIED
REGISTRY_SOURCE_DRIFT = DETECTED_AND_REFRESHED
HARD_BUDGET_GATE = VERIFIED
RETRY_BUDGET_GATE = VERIFIED
CREDIT_LEDGER = VERIFIED
PROVIDER_CALLS = 0
GENERATIONS = 0
CREDITS_SPENT = 0
NEXT = PHASE 1G.9 + 1G.10 — FLOW AGENT INSTRUCTIONS MANAGER + REFERENCE / ASSET LIBRARY
```
MULTI_OUTPUT_POLICY = VERIFIED
PER_GENERATION_COSTING = VERIFIED
HARD_BUDGET_GATE = VERIFIED
RETRY_BUDGET_GATE = VERIFIED
CREDIT_LEDGER = VERIFIED
PLATFORM_REUSE_DEDUP = VERIFIED
PROVIDER_CALLS = 0
GENERATIONS = 0
CREDITS_SPENT = 0
NEXT = PHASE 1G.9 + 1G.10 — FLOW AGENT INSTRUCTIONS MANAGER + REFERENCE / ASSET LIBRARY
```

(The next work unit comes verbatim from the task contract §65; no in-repo
canonical roadmap file exists to cross-check it against, so it is reported
exactly as specified and not elaborated.)

## 1. Status

All §64 acceptance criteria plus all 21 FIX 01 pass criteria proven:
existing cost/retry ownership audited and reused where applicable; default
output count x1 with roadmap-approved x2–x4 roles; request≠generation;
per-generation math from 1G.6 only; no price hard-coding (source scans);
data-refresh cost changes (K6/drift tests); exact context matching; UNKNOWN/
STALE/CONFLICT honesty; image cost never assumed zero; reuse/dedupe (1G.7
platforms, shared references); Remotion never counted as Flow credit;
correct image/Veo/variant estimates with certainty states;
generation time UNKNOWN without evidence; hard budget before authorization;
exact over-budget blocked; unknown-cost never guaranteed; bounded budgeted
retry; failed spend never assumed zero; full planned/actual/failed/retried/
observed ledger with idempotent reconciliation; shortfall never mutates
creative/model decisions; cost-only staleness scoped; 1G.5/1G.6/1G.7
byte-intact; 161-assert suite green (132 base + SEL1–SEL8 + FAM1–FAM6 + E9);
full `npm test` 0 failed (219.9s, 13 domains incl. native Remotion, run
continuously with no host-security gate); schemas + structure green; 0 calls /
0 generations / 0 UI / 0 credits; no post-1G.8 work.

FIX 01 corrections (2026-10-03, same day): (A) unselected
GENERATED_MOTION_CANDIDATE no longer becomes required paid spend — 0 units,
AWAITING_SELECTION status, advisory potential kept strictly separate from
required/planned/committed (SEL1–SEL8, E9); explicit selection (generated)
or RECOMMENDED effective fallback still authorizes spend; (B) official cost
pages re-read live (EN + VI + features page): main-row values match the 1G.6
seed (no drift there), but the Lower Priority variant row (EN-only on this
read) adds spend-relevant family context the seed lacked → additive
data-only registry refresh (new variant model, fingerprint
`e25b991d875d6ff8` → `471533c89b27d43b`), so
COST_SOURCE_DRIFT = DETECTED_AND_REFRESHED; 1G.8 logic itself needed no
provider-truth change (exact-string tier matching already handled it).

## 2. Entry Gate

1G.5/1G.6/1G.7 reports all `TASK_VALIDATION = PASS`. Live contracts
re-verified (no ENTRY_GATE_FAIL): render modes intact + provider-neutral;
`lib/visual-motion` source scan clean (no model IDs/prices); 1G.6 seed loads
(`fp=e25b991d875d6ff8`, cost observations present); Prompt Compiler without
targetKind → `PROMPT_TARGET_REQUIRED`. No earlier phase patched (only
additive `validate-schemas.js` instances for the two new schemas).

## 3. Repository Capability Audit

| Component | Class | Disposition + reason |
|---|---|---|
| `providers/model-registry/*` (observations, estimateCost, freshness) | **A** | sole cost authority; planner consumes estimates + snapshot lookup, duplicates nothing |
| `providers/runtime/artifact-store.js`, `request-fingerprint.js` | **A** | persistence + stable identity reused as-is |
| `providers/runtime/cost-policy.js` (costClass vocabulary) | **B** | vocabulary-compatible; 1G.8 budgets use CREDITS unit + 1G.6 observations |
| `schemas/render-attempt.schema.json` (`attemptId ^attempt-[0-9]{3}$`) | **B** | ID-style precedent noted; 1G.8 uses lineage-scoped `unitGroup:attempt-N` + entry `le-…` hashes (different scope, no collision) |
| `schemas/flow-job.schema.json` (`jobId`), `flow-companion/bridge/job-store.js` | **C** | Flow runtime execution jobs — different concern, untouched |
| `providers/runtime/resolver.js` `MAX_TRANSIENT_ATTEMPTS = 2` | **C** | execution retry loop — different concern; 1G.8 default is no automatic retry, explicit policy only |
| `lib/render-time.js` (frame math) | **C** | unrelated to generation latency; latency stays UNKNOWN without measured evidence |
| Budget plan / cost ledger / generation units / output-count policy / hard budget / retry budget / reconciliation | **D** | genuinely missing — created minimal owner below |

Seed search confirmed: no `hardBudget`, `maxCredits`, credit ledger, output-count, or variant planning owner existed.

## 4. Canonical Owner

One owner: `lib/output-cost/` =
`shared.js` (versions/enums/OUTPUT_COUNT_DEFAULT=1/MAX=4/special roles/ids) +
`units.js` (output-count validation, unit builder, platform/reference
dedupe, 1G.6 cost lookup, output plan + credit summary, generation-time
estimator) +
`budget.js` (budget plan, authorization, hard stop, retry authorization,
ledger record/recompute, staleness) +
`validator.js` (plan + ledger validation, §60 detections) +
`store.js` (budget-plans/ + cost-ledgers/ persistence) +
`index.js` (facade: the §5 concept list verbatim).
Schemas: `schemas/production-budget-plan.schema.json`,
`schemas/generation-cost-ledger.schema.json`. Tests:
`tests/cost/test-output-cost-credit.js` (new `cost` domain, auto-discovered
by the existing runner). No execution adapters; no parallel credit subsystem.

## 5. Scope / Non-Scope

Owned: requirements → output-count policy → generation units → dedupe/reuse
→ 1G.6 cost lookup → credit estimate → time-estimate state → hard budget →
pre-generation gate → retry allowance → planned/actual/failed/retried/
observed ledger → hard stop. NOT owned (verified absent by source scans +
I6–I10): model selection, Flow UI, generation, download/import, Agent
Instructions, Asset Library, QA, rendering, audio/captions, analytics, 1G.9+.

## 6. Official Cost Source Check + retrieval dates

Re-verified live 2026-10-03 (read-only; pages are UNTRUSTED DATA):

- EN `.../flow/answer/16526234?hl=en` — per-generation table: Lite 10/5,
  Fast 20/10 (Ultra/non-Ultra), Quality 100 @8s, Omni 720p 7/10/12/15,
  360p 4/5/6/7, edit 40, upscales 0/50; "per generation, not per request;
  one request may produce multiple generations; costs may change, check Flow
  settings."
- `.../flow/answer/16526234?hl=en` — per-generation table including the
  Lower Priority variant row (Ultra subscribers & family plan managers: 0;
  Ultra family members & non-Ultra: Not available).
- `.../flow/answer/16526234?hl=vi` — main rows identical to EN on this read
  (Lite 10/5, Fast 20/10, Quality 100, Omni values, edit 40, upscales); the
  Lower Priority row is ABSENT from the VI table on this read.
- `.../flow/answer/16352836?hl=en` — capability matrix unchanged for modeled
  workflows (Lite/Fast ingredients 8s-only, Quality no ingredients).

Cross-check vs 1G.6 seed: every modeled main-row value matches in both
locales → no drift on existing models. The family-scoped Lower Priority
context (0 vs Not available) was missing from the seed → additive data-only
refresh (FIX 01 §9 path): new variant model + `notes` provenance field, new
fingerprint `471533c89b27d43b`, full 1G.6 suite re-green (152 asserts).
1G.8 consumed the refresh automatically (FAM1–FAM6). No 1G.8 cost logic
changed — exact-string tier matching already excluded unscoped tiers.

## 7. 1G.6 Cost Authority Boundary

1G.8 never owns prices: every unit cost flows from a 1G.6 resolution
estimate or a snapshot observation looked up by model + exact context
(duration/resolution/workflow/tier/region). A dedicated drift test proves a
cost change propagates via data refresh with zero source-code change, and a
source scan proves no price literals or model names in planner code (guard
regex hoisted to a named constant per repo convention).

## 8. Source Drift / Conflict Handling

EN≡VI≡seed on 2026-10-03 for all previously modeled rows: no drift, no
conflict to report there. FIX 01 found one genuine gap — the Lower Priority
variant's family-scoped cost/availability context (EN-only row) was absent
from the seed — and refreshed it as data (see §6), so
COST_SOURCE_DRIFT = DETECTED_AND_REFRESHED. Mechanism proven anyway:
conflicting observations → CONFLICT state (C8/K5-style fixture); stale →
STALE; drift test (value recompute) green. If future live research diverges,
the contract emits COST_SOURCE_DRIFT/CONFLICT and never silently replaces
1G.6 truth.

## 9. Output Count Policy

Default x1 enforced in code (`OUTPUT_COUNT_DEFAULT`); anything else is
rejected unless it satisfies §10. Importance is not an input at all, so
"important = x4" is unrepresentable by construction (O7).

## 10. Special Multi-output Roles

Exactly `CHARACTER_MASTER, THUMBNAIL, HERO_SHOT, STYLE_BAKE_OFF,
CRITICAL_VISUAL`, range 2..4, each requiring role + explicit reason +
budget impact (units carry variantIndex; summary splits baseOutputs/
extraVariants). O2–O6 prove each role; O8 rejects x5; O7 rejects roless x2.

## 11. Request vs Generation Semantics

Distinct concepts throughout: units are generations; `outputCount` expands
to N generation units; validator rejects `requests × rate` phrasing (C4);
totals use known-per-generation × generation count only when dimensions
match. `outputCount` on a resolution means generations per request there —
never conflated with request counts in planner math.

## 12. Generation Unit Contract

Implemented per §10: unitId (`gu-…`), sourceShotId/DecisionId/
ModelResolutionId, mediaKind, workflow, modelId/providerId, duration,
resolution, orientation, subscriptionTier, role (MASTER_OUTPUT /
PLATFORM_TARGETED_VARIANT / IMAGE_ASSET), assetRole/assetKey, variantIndex,
outputCount/baseOutputs/extraVariants, platformVariantIndex,
reusableAcrossPlatforms, dedupeKey, costObservationRef,
estimatedCreditState/Credits/Unit/reason, latencyEstimateState, status.
1G.8 plans and account-controls units; it never generates them.

## 13. 1G.5 Strategy Integration

Strategy consumed read-only via the canonical 1G.5 selection contract
(`recommendedOutputType` / `selectedOutputType` / `effectiveOutputType =
selected ?? recommended`, audited live): STATIC (missing→image units,
satisfied→0), REMOTION (0 Flow units; missing base→1 image unit),
GENERATED_MOTION_RECOMMENDED with effective-generated fallback → video
units, GENERATED_MOTION_CANDIDATE → units ONLY under explicit selected
generated strategy, otherwise 0 units + AWAITING_SELECTION + advisory
potential kept strictly separate (FIX 01 §§2–6; SEL1–SEL8, E9). Candidate
downgrades to editor/static via selection naturally yield no video units.
Shortfall path reports over-budget items/knowns/unknowns/reducible scope —
never rewrites strategy (no strategy fields exist on planner artifacts;
validator `UPSTREAM_MUTATION` guard).

## 14. 1G.7 Platform Reuse / Deduplication

Adaptations consumed per item: all-NOT_REQUIRED across N platforms → 1 base
unit (P4/P5 + dedupe reason); each TARGETED platform adds exactly one
labeled variant unit (P6/E); no adaptations supplied → single-platform
assumption noted. One failed shot never cascades (units are per-shot).

## 15. Required Image Estimate

`estimatedImages` counts required image generations post-dedupe: missing
primaries/start/end frames + missing prerequisite references (deduped by
asset id, P3); excludes satisfied assets, reused references, reframes,
relayouts, cached duplicates. E2E: 2.

## 16. Required Veo Shot Estimate

`estimatedVeoShots` = distinct video unit groups after strategy + reuse +
dedupe. Excludes STATIC/REMOTION/adaptation-only/existing reuse. E2E: 5.

## 17. Variant Estimate

`estimatedVariants` = total generation units (sum of planned outputCounts);
base vs extra tracked separately (O9: 1 base + 1 extra, no attempt lineage
on variants). E2E: 9 units = 7 base + 2 extra. Unselected candidates
contribute 0 to required variants; their shadow counts live only in
`potentialVeoShots` (FIX 01).

## 18. Cost Observation Matching

Exact-dimension matching via 1G.6 `estimateCost` + mediaKind verification
from the snapshot (never label sniffing — a real FIX-during-build replaced
a `nano-banana` regex with snapshot `mediaKinds` checks): duration,
resolution, workflow, tier, region must all match when specified; tiered
values never assumed (C5: "Pro" matches nothing); workflow-scoped values
(edit 40) never leak into generation requirements; model-kind mismatches
yield UNKNOWN, not cross-subsidy.

## 19. Credit Estimate States

EXACT (single fresh applicable value) / UNKNOWN / CONFLICT / STALE (+
NOT_APPLICABLE design state for zero-generation paths). Summary:
knownCredits, unknown/conflicting/staleUnitCount, exactTotalCredits (only
when every spend-relevant unit is EXACT), plus strictly separate
`potentialCredits` for unselected candidates (never reserved/committed).
Uncertainty is never hidden behind one number (PARTIAL/UNKNOWN/CONFLICT/
STALE summary states).

## 20. Unknown / Conflict / Stale Cost

UNKNOWN valid data (image costs unpublished → C6/C9); unknown paid cost →
PRE_GENERATION_REVIEW_REQUIRED by default, BLOCKED_COST_UNKNOWN under
strict policy (B5); CONFLICT → exact refused (C8); STALE → flagged, exact
refused (C7). Fresh capability never implies fresh price (orthogonal
freshness preserved from 1G.6).

## 21. Generation-time Estimate

UNKNOWN without measured runtime evidence (T1; no latency history exists in
repo — `render-time.js` is frame math, unrelated). Never derived from output
duration, model names, or tier labels (T2/T3 include source scans proving
absence). Caller-supplied measured evidence
`{estimateMs, sampleCount, percentile, source, observedAt}` yields a sourced
KNOWN estimate (T4). Never fails the budget plan.

## 22. Hard Budget Contract

`{unit: CREDITS, limit ≥ 0, scope ∈ PROJECT/SEQUENCE/SCENE/SHOT/
GENERATION_JOB, source}` — explicit before any spend-capable authorization
(B1: missing budget fails closed). Authorization spends required units only;
unselected-candidate potential never consumes reservations, never reduces
remaining, never triggers over-budget blockers (SEL3/SEL4). CREDITS only; no
VND/USD conversion, no invented credit value. Scope explicit on every plan.

## 23. Reservation / Commitment

`remaining = limit − observed − committed`; committed = Σ reservedCredits
on ledger entries. Authorization math states all three terms explicitly
(B2–B4 reasons). Failed jobs never release reservations without
authoritative evidence of non-spend (R6: remaining unchanged on unknown
failed cost).

## 24. Hard Stop

`HARD_BUDGET_STOP` on proven exceed/exhaustion (B4, checkHardStop ≤ 0);
`BLOCKED_BUDGET_EXCEEDED` on exact-known over-budget attempts; unknown-cost
paths can never claim safety (§17). No silent over-budget state exists in
the state vocabulary.

## 25. Retry Budget

Per-unit-group policy `{maxAdditionalAttempts, reservedCredits?,
allowedFailureClasses?, requiresApprovalClasses?}`; default (absent policy)
= no automatic retry (R1). Authorization checks lineage (R2: `group:
attempt-N` ids, prior attempt required), bounds (R4), failure-class gates,
and reserved/exact cost fit (R3); unknown unreserved retry cost →
REVIEW_REQUIRED (conservative). Over-budget retry = hard stop.

## 26. Failure Accounting

Failed attempts counted, never assumed zero-credit (R6): unknown failed
spend → UNRECONCILED, remaining budget unchanged (no refund assumption);
late authoritative observation reconciles + recalculates remaining (L5) and
is idempotent on re-apply.

## 27. Runtime Cost Ledger

`cl-…` ledger: entries per §38 (ids, planned/reserved/observed credits,
status, failureClass, retryOfAttemptId, result/resolution/observation refs,
timestamps, fingerprints; no secrets). Totals derived per §41 semantics:
planned = distinct intended units; actual = submitted attempts; failed;
retried = attempts with retry lineage; creditsObserved = authoritative
observed sum only (L1/L2). Mismatched sums and double-counts fail validation.

## 28. Credit Reconciliation

RECONCILED (all observed, empty ledger included) / PARTIAL (some unknown) /
UNRECONCILED (none observed) / CONFLICT (opt-in disagreement preserved, L6
— never merged, never smallest-wins). Late observations reconcile (L5);
re-application is a no-op (L3/L5/R7 via attemptId+observationId identity).

## 29. Planned / Actual / Failed / Retried Metrics

Per §41 definitions, derived in `recomputeLedger`, asserted in L1
(2/3/1/1 over a 3-observation fixture with creditsObserved = 24 from
authoritative values only — never from failure counts).

## 30. Persistence

`projects/<projectId>/budget-plans/<scopeId>.json` +
`projects/<projectId>/cost-ledgers/<scopeId>.json`, atomic artifact-store
writes, stable `bp-…`/`cl-…`/`le-…` IDs, Ajv-validated shapes, round-trip
stable fingerprints/totals/budgets (L7 + S1), idempotent observation updates,
attempt-level dedupe. No parallel framework.

## 31. Staleness / Invalidation

`checkBudgetStaleness`: planned-units change, 1G.6 cost-evidence change
(scoped message “…creative artifacts clean”), hard-budget change, retry
policy change, policy-version change. Cost-only changes stale the budget
plan alone — 1G.5 decisions stay byte-identical (S6 asserts both halves).
Never touches Research/Story/unrelated adaptations or shots.

## 32. Idempotency

Same inputs → same plan/budget fingerprints (S1); same observation twice →
totals unchanged (L3/L5/R7). Manual budget raises create new fingerprints
via `supersedes` links (B7), never silent history mutation.

## 33. Manual Override

Allowed: raise/change hard budget with reason+source (B7, new fingerprint),
reduce output count / disable variants (replan path), approve fresh
exact-cost plans, acknowledge unknown time estimate, approve review-gated
attempts. Forbidden (no such code paths; B8 proves no force flag):
over-budget calls without budget change, zero-marking unknown cost, price
rewrites, resolution rewrites, modality changes, accounting disable.

## 34. Mixed Production Fixture

10-case deterministic E2E (§47): satisfied/missing STATIC, satisfied/missing
REMOTION base, FIRST_FRAME, FIRST_LAST, REFERENCE, TikTok-targeted
regeneration, HERO x2, invalid normal x4 (per-item rejection, plan survives).
Proven: images 2, Veo jobs 5, variants 9, credits PARTIAL with known 72
(6 exact omni-8s units), time UNKNOWN, invalid x4 blocked with
MULTI_OUTPUT_ROLE_REQUIRED, deterministic re-run identical.
FIX 01 E9 extension: unselected CANDIDATE excluded from required counts
(0 Veo, potential exposed separately, AWAITING_SELECTION); explicit
selection replans deterministically (required 1, credits 12, fingerprint
changes, 1G.5 input byte-identical).

## 35. Output Planning Gate

Estimates + hardBudget exposed together: images 2, Veo jobs 5, variants 9,
credits PARTIAL/72-known, time UNKNOWN, budget echoed (never invented in
planner — `hardBudget: null` until `buildBudgetPlan` attaches it).
Existing assets uncounted, platform reuse deduped, prerequisites counted
once, default x1, hero variants explicit, normal x4 rejected, known credits
from 1G.6, unknowns unknown, time UNKNOWN without evidence. ✓

## 36. Hard-budget Gate

Fixture data (omni 8s = 12/generation, never a planner constant): A 24/30
→ APPROVED; B 30/30 → APPROVED; C 31/30 → BLOCKED_BUDGET_EXCEEDED; D unknown
unit → PRE_GENERATION_REVIEW_REQUIRED (strict variant BLOCKED_COST_UNKNOWN);
E conflict/stale → no exact total. FIX 01 addition: unselected candidate
alone never triggers BLOCKED_BUDGET_EXCEEDED (0 required spend). ✓

## 37. Retry Gate

Base approved → failure recorded → retry requested with lineage
(`gu:shot:attempt-1`) → reserved/exact budget checked → over-budget retry
hard-stops; unreserved unknown-cost retry reviews conservatively. No
provider call, no loop (maxAdditionalAttempts enforced). ✓

## 38. Ledger Reconciliation Gate

Unknown failed spend → UNRECONCILED + conservative retry posture; late
authoritative 12 arrives → reconciled, remaining 30−12=18 recalculated,
re-apply idempotent. ✓

## 39. Required Test Matrix Results

`tests/cost/test-output-cost-credit.js`: **161 passed, 0 failed** (132 base
+ SEL1–SEL8 + FAM1–FAM6 + E9).
O1–O9 (incl. all five special roles, x5 + roleless-x2 rejections, variant≠
retry) · P1–P8 (reuse/dedupe/platform/remotion rules) · C1–C10 (1G.6-sourced,
per-generation, outputCount math, anti-conflation, mismatch/unknown/stale/
conflict honesty, image≠free, no price/model literals) · B1–B8 (gates A–E +
project-scope + raise-with-history + no-bypass) · R1–R7 · L1–L7 · T1–T4 ·
I1–I10 · S1–S6 · E1–E9 + drift test + SEL/FAM matrices. Every §52 ID maps to passing assertions.

## 40. Schema Validation

`node scripts/checks/validate-schemas.js` → ALL TESTS PASSED (47 schemas:
45 existing + `production-budget-plan` + `generation-cost-ledger`, each with
accept + reject instances).

## 41. Targeted Regression

`cost` 1/1 (161 asserts) + `story` 12/12 (1G.4 + both 1G.5 suites) +
`providers` 9/9 (1G.6: 152, seed refreshed to 8 models) + `platform` 1/1
(1G.7: 171) + pipeline/research/topic/media/policy/qa/flow
0 failed + schemas + `check:repo-structure`
REPOSITORY_STRUCTURE_OK. Outside the new owner: only additive
`validate-schemas.js` instances, one R1 count update (7→8 models), and the
data-only 1G.6 seed refresh (Lower Priority variant + `notes` field).

## 42. Full Regression

`npm test` executed continuously under the standing host security state (no
SAC gate per §58) → all 13 domains,
**0 failed suite(s) in 219.9s**, incl. 18 native Remotion suites (render
smoke PASS, no skips) and the 161-assert 1G.8 suite. `check:repo-structure`
→ OK. `validate-schemas.js` → ALL PASSED. No SECURITY_ENVIRONMENT_BLOCKER;
nothing on the host was changed to obtain this result.

## 43. Security / Zero-Spend Confirmation

No host-security changes (per §58: nothing requested, nothing toggled);
no secrets/tokens/cookies accessed or stored (I-scan: no `process.env.*KEY/
TOKEN/SECRET` in owner code); provider calls = 0, Flow UI mutations = 0,
generations = 0, credits spent = 0; web sources read-only (EN+VI credit
pages fetched as UNTRUSTED DATA — extracted, compared, cited; identical
values, no drift).

## 44. Files Created

```text
lib/output-cost/shared.js
lib/output-cost/units.js
lib/output-cost/budget.js
lib/output-cost/validator.js
lib/output-cost/store.js
lib/output-cost/index.js
schemas/production-budget-plan.schema.json
schemas/generation-cost-ledger.schema.json
tests/cost/test-output-cost-credit.js
Report/PHASE_1G8_01_OUTPUT_COST_CREDIT_PLANNER_REPORT.md
```

## 45. Files Modified

```text
scripts/checks/validate-schemas.js (registered 2 schemas + 4 accept/reject instances)
```

No 1G.1–1G.7, provider-runtime, Flow Companion, or platform source modified.
No root code added.

## 46. Files Deleted

None. No fix-*/debug-*/temp-* artifacts created (tmp test roots live in the
OS temp dir, outside the repo).

## 47. Known Limitations

- Image-model credit costs are unpublished → image units stay UNKNOWN
  (quantity planning unaffected).
- Tier matching is exact-string; near-miss tiers conservatively yield UNKNOWN
  (this is what keeps family-member contexts honest).
- The Lower Priority variant row exists on the EN credit table but was absent
  from the VI table on this read; the seed records EN-only provenance for it.
- Retry `reservedCredits` is caller-declared; no runtime price feed confirms it.
- Generation-time has no evidence source in-repo (UNKNOWN by default).
- Project-scope budgeting is supported structurally (`parentBudget`); repo
  has no pre-existing project-wide budget rollup to reconcile against.

## 48. Acceptance Checklist

1. Audit reuses existing ownership ✓ (§3). 2. Default x1 ✓ (O1). 3. x2–x4
special-role-only ✓ (O2–O8). 4. Request≠generation ✓ (C4/units). 5.
Per-generation math ✓ (C1–C3). 6. 1G.6 sole cost authority ✓ (§7/drift). 7.
No hard-coded prices ✓ (C10/drift scans). 8. Data-refresh cost changes ✓
(drift test). 9. Exact context matching ✓ (C5 + kind checks). 10. UNKNOWN
stays UNKNOWN ✓ (C6/B5). 11. STALE/CONFLICT never exact ✓ (C7/C8). 12.
Image≠free ✓ (C9). 13. Reuse uncounted ✓ (P1/P4). 14. Reframe/relayout
free ✓ (P4/P5). 15. Targeted-only regen cost ✓ (P6). 16. Remotion≠Flow
credit ✓ (P7). 17–19. Image/Veo/variant estimates ✓ (§34). 20. Certainty
states ✓ (§19). 21. Time UNKNOWN w/o evidence ✓ (T1). 22. Hard budget before
authorization ✓ (B1). 23. Over-budget blocked ✓ (B4). 24. Unknown-cost
unguarranteed ✓ (B5). 25. Bounded budgeted retry ✓ (R1–R4). 26. Failed≠zero
✓ (R6). 27. Ledger metrics ✓ (L1). 28. Idempotent observations ✓
(L3/R7). 29. Late reconciliation ✓ (L5). 30. Shortfall never mutates
decisions ✓ (§13/§31/B8). 31. Cost-only staleness scoped ✓ (S2/S6). 32–34.
1G.5/1G.6/1G.7 intact ✓ (§41/I). 35–38. Zero call/generation/UI/spend ✓
(I6–I10 + commands). 39. Targeted green ✓ (§41). 40. Full green ✓ (§42).
41. No post-1G.8 work ✓ (scans + suite).
FIX 01 addenda: unselected-candidate zero spend ✓ (SEL1–SEL4); explicit
selection replans deterministically ✓ (SEL5–SEL7, E9); 1G.5 read-only ✓
(SEL8); family contexts source-backed ✓ (FAM1–FAM6); drift honestly
reported as DETECTED_AND_REFRESHED ✓ (§§6–8).

## 49. Final Verdict

```text
TASK_VALIDATION = PASS
PHASE 1G.8 — OUTPUT / COST / CREDIT PLANNER = COMPLETE
EFFECTIVE_SELECTION_SEMANTICS = VERIFIED
UNSELECTED_CANDIDATE_SPEND = 0
CURRENT_COST_SOURCE = VERIFIED
REGISTRY_SOURCE_DRIFT = DETECTED_AND_REFRESHED
HARD_BUDGET_GATE = VERIFIED
RETRY_BUDGET_GATE = VERIFIED
CREDIT_LEDGER = VERIFIED
PROVIDER_CALLS = 0
GENERATIONS = 0
CREDITS_SPENT = 0
NEXT = PHASE 1G.9 + 1G.10 — FLOW AGENT INSTRUCTIONS MANAGER + REFERENCE / ASSET LIBRARY
```

STOP per §66: no 1G.9+ work started (owner scans + suite confirm no
instructions manager, asset library, QA, E2E, analytics, or TTS was added).
