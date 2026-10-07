# PHASE 1G.6 — PROMPT 01
# PROVIDER / MODEL CAPABILITY REGISTRY REPORT (CORRECTED BY FIX 01)

Date: 2026-10-03 (FIX 01 corrections verified live same day)
Roadmap: V6 — deterministic model resolution downstream of 1G.5
Previous gate: `TASK_VALIDATION = PASS / PHASE 1G.5 — VISUAL STORY GRAMMAR + VISUAL / MOTION DECISION ENGINE = COMPLETE / NEXT = PHASE 1G.6 — PROVIDER / MODEL CAPABILITY REGISTRY` (verified in-repo before any edit)

```text
TASK_VALIDATION = PASS
PHASE 1G.6 — PROVIDER / MODEL CAPABILITY REGISTRY = COMPLETE
REPORT_INTEGRITY = COMPLETE
OFFICIAL_COST_SOURCE = VERIFIED
CURRENT_CAPABILITY_SNAPSHOT = VERIFIED
NEXT = read the current canonical Roadmap V6 and continue to the first unfinished post-1G.6 work unit.
```

(No next phase name is present in any in-repo canonical roadmap file — the
frozen V6 scope file itself is absent from the repo, as documented in the
1G.5 FIX 1 report §75 — so no next phase is invented here.)

```text
REPORT_INTEGRITY = COMPLETE
TRUNCATION_MARKERS = 0
```

Integrity verified by: file exists; 40/40 required sections present (§§1–40
enumerated below); last section is §40 Final Verdict; truncation-marker
scan = 0; ellipsization-marker scan = 0 (checked by scan at finalization time).

FIX 01 correction note (why this report was rewritten): the first submitted
artifact was physically truncated at §17; it recorded zero cost observations
for lack of a verified authority (the official Flow credit table has since
been verified live and is now seeded as dated observations); and it carried
an Omni First+Last CONFLICT that the current canonical model/features page
no longer supports (corrected to SUPPORTED with live evidence; conflict
handling itself is preserved and still proven by an explicitly synthetic
fixture). Architecture unchanged except two narrow, justified engine
refinements (§13): workflow-scoped cost matching and evidence-tier ranking
(clean support outranks conflict/unknown evidence; unverified availability
stays orthogonal and warned, never ranked).

## 1. Status

All acceptance criteria proven with evidence below: one canonical owner;
hard compatibility filter before ranking; explainable deterministic
resolution; officially-sourced per-generation costs as data; targeted
staleness with the 1G.5 boundary intact; 152-assert suite green; full
`npm test` 0 failed (236.0s, incl. native Remotion); schemas (45 + 4 new
instances) + structure green; 0 provider calls / 0 credits / 0 secrets;
SAC restored ON by operator with no post-restore rerun.

## 2. Entry Gate

1G.5 `TASK_VALIDATION = PASS`, `NEXT = PHASE 1G.6`. Repository contracts
re-verified live (no ENTRY_GATE_FAIL):

- `visualType` ≠ `visualModality`; shot = executable unit, scene = derived.
- Canonical render modes intact and provider-neutral:
  `STATIC_IMAGE, REMOTION_MOTION, VEO_FIRST_FRAME, VEO_FIRST_LAST, VEO_REFERENCE`.
- `VEO_*` = workflow family; 1G.5 emits `requiredCapabilities[]`, reference
  strategy, asset roles, orientation capability, render mode; no model IDs or
  prices in `lib/visual-motion` (source scan at gate time: clean).
- `checkDecisionStaleness` ignores model-availability context (boundary live).
- Prompt Compiler without targetKind → `PROMPT_TARGET_REQUIRED` (live call).

## 3. Repository Capability Audit

| Module | Role | Class | Disposition + reason |
|---|---|---|---|
| `providers/runtime/artifact-store.js` | atomic persistence + fingerprint index | **A** | reused as-is for resolution persistence |
| `providers/runtime/request-fingerprint.js` | stableStringify + fingerprinting | **A** | reused as-is (hash/identity) |
| `providers/runtime/registry.js` | execution provider registration (adapter.execute) | **B** | left alone — execution path, not capability data |
| `providers/runtime/resolver.js` | execution resolver (rights → execute → READY) | **B** | left alone — 1G.6 selects, never executes |
| `providers/runtime/cost-policy.js` | costClass vocabulary + COST_RANK | **B** | vocabulary-compatible; 1G.6 stores own sourced observations |
| `providers/CONFIG.yaml` | cost/provider preference policy | **B** | read as context, not owned |
| `providers/CAPABILITY_MATRIX.md` | NOT_VERIFIED_BY_DEFAULT principle | **B** | principle reused (availability defaults UNKNOWN) |
| `providers/PROVIDER_CONTRACT.md`, `PROVIDERS.md`, `INDEX.md` | contracts/notes | **B** | vocabulary alignment, no code change |
| `providers/runtime/adapters/*` (incl. flow-web) | execution adapters | **B** | untouched; no 1G.6 dependency |
| `flow-companion/bridge/*` | live automation workstream | **C** | left alone; future UI observations ingestible as `OFFICIAL_PROVIDER_UI_OBSERVATION` sources, no code written |
| model descriptors w/ constrained rules + provenance + freshness + ranking + resolution artifacts | absent (old registry is coarse `capabilities[]` + costClass) | **D** | created minimal owner `providers/model-registry/` |

No new root: owner under existing `providers/`; tests under `tests/providers/`; schemas under `schemas/`.

## 4. Canonical Owner

One owner: `providers/model-registry/` =
`shared.js` (versions/enums/stable IDs/hashing/1G.5 bridge constants) +
`registry.js` (normalize + provenance + freshness + snapshot/fingerprint) +
`resolver.js` (requirement → hard filter → ranking → override → artifact) +
`validator.js` (snapshot + resolution validation) +
`store.js` (persistence + targeted staleness) +
`index.js` (facade: `resolveFromDecision`, seed loading, re-exports) +
`snapshots/flow-baseline-2026-10-03.json` (dated seed, corrected by FIX 01).
Schemas: `schemas/model-registry-snapshot.schema.json`,
`schemas/model-resolution.schema.json`.

## 5. Scope / Non-Scope

Implemented: all 15 primary objectives (registry, constrained rules,
provenance, availability separation, cost observations, freshness, conflict
preservation, filtering, ranking, override validation, explainability,
separate artifacts, targeted invalidation, UNKNOWN-safe design, 0 credits).

NOT implemented (verified by source scans + tests B1–B4): Flow live
automation, model-control clicks, image/video generation, credit spend,
retry orchestration, queue/job execution, download/import, Remotion changes,
prompt rewriting by model, humanizer/narration/TTS/captions, analytics,
media scoring/benchmarking, new secret handling, region/VPN bypass, safety
evasion, story rewriting for availability, strategy inflation for provider
existence.

## 6. Provider Surface Contract

`providerId / surfaceId / displayName / status (AVAILABLE|UNAVAILABLE|UNKNOWN)
/ sourceRefs[] / observedAt / freshness / metadata`. Registered:
`GOOGLE_FLOW_WEB` (UNKNOWN — documented product, account access unobserved),
`GOOGLE_VERTEX_VEO` (UNKNOWN — unobserved, zero models registered, honest
emptiness). Documented ≠ accessible, enforced.

## 7. Model Descriptor Contract

`modelId` (stable slug) + providerId/surfaceId + `providerLabel` (external
truth, verbatim) + family/version + mediaKinds + capabilityRules +
availability (+optional UI/API sources) + providerTier (declared label only,
never a score) + costObservations + sourceRefs + observedAt + status.
Unknown version/tier allowed; no numeric quality invented from
Fast/Lite/Quality names (ranking uses declared fit + freshness + observed
cost only, then modelId tie-break).

## 8. Capability Rule Contract

`capability (canonical 1G.5 value) / support (SUPPORTED|UNSUPPORTED|UNKNOWN|
CONFLICT) / constraints{mediaKind, workflow label (data), orientations,
durations, resolutions, inputRoles, outputKinds, subscription, region, notes}
/ sourceRefs[] (min 1, enforced) / observedAt / freshness / conflict[]`.
All 9 current 1G.5 capabilities reasoned about. No upstream rename (R2
rejects non-canonical names; no alias map was needed).

## 9. Source Provenance

`sourceId / sourceType (5 canonical) / url / publisher / scope /
retrievedAt / locale / fieldAuthority[] / contentFingerprint / notes`.
Schema + normalizer require type + timestamp; rules/observations without
resolvable sourceRefs are rejected at build (R2). A third-party API mirror
with exact credit numbers was found during research and **rejected as
non-authoritative** — it never drives compatibility or cost.

## 10. Field-Specific Authority

Authority lives per-field, never global-newest-wins:

```text
model/features page (16352836) => capability/workflow/duration/orientation truth
credit page (16526234)          => credit unit/value/subscription/duration/resolution observations
creation workflow docs (16353334) => product workflow existence / UI semantics
DeepMind model page             => capability existence/background only
live UI observation (future)    => account-visible model/access/setting/credit observation
```

The credit table is NOT a capability authority (its rows never create
support rules); the features page is NOT a price authority. Selection
reasons cite the satisfying rule + workflow.

## 11. Freshness

Per-observation `FRESH|STALE|UNKNOWN`, rolled up separately for capability /
availability / cost (never collapsed; T2 proves stale cost coexists with
fresh capability truth). No universal TTL: freshness is stored evidence, no
magic numbers. Current seed: capability rules FRESH (2026-10-03),
availability UNKNOWN (unobserved), costs FRESH where officially verified.

## 12. Official Provider Research with retrieval dates

Re-verified live 2026-10-03 (all `support.google.com/flow`, `deepmind.google`):

- `.../flow/answer/16352836?hl=en` — workflow × model matrix: Veo 3.1
  Lite/Fast (T2V + Frames First + First+Last 4/6/8s both aspects; Ingredients
  8s-only), Quality (same minus Ingredients = No), Omni Flash 1.1 (all four
  workflows 4/6/8/10s both aspects; coming-soon = Extend only), Nano Banana
  Pro/2/2-Lite image models. **This live read supersedes the earlier cached
  "Omni First+Last coming soon" snapshot.**
- `.../flow/answer/16893917?hl=en` — Omni exclusives (10s, web start/end
  frames, 360p, upscale notes); retained as a source, no longer cited for a
  First+Last conflict.
- `.../flow/answer/16353334?hl=en` — frames/ingredients workflow existence.
- `.../flow/answer/16526234?hl=en` — **Manage credits**: exact per-generation
  costs (Lite 10/5, Fast 20/10 by Ultra/non-Ultra; Quality 100 @8s; Omni
  720p 7/10/12/15 @4/6/8/10s; Omni 360p 4/5/6/7; Omni edit 40; 4K upscale 50
  Ultra / 1080p upscale 0 Plus-Pro-Ultra). "Per generation, not per request"
  (official emphasis); "may change, check Flow settings".
- `https://deepmind.google/models/veo/` — existence/background only.

## 13. Conflict Handling

Current seed carries **no live conflict** (FIX C): the prior Omni
First+Last disagreement was a historical/cached snapshot, removed from live
data rather than enshrined. Generic CONFLICT support is untouched and still
proven — by an explicitly labeled **synthetic** fixture (R5: two
official-style observations, named `fix-doc`/`fix-doc-2`, never described
as Google state): candidate preserved, status PROVISIONAL, conflict warning,
never merged. Cost conflicts likewise preserved (K5, E2E-10).

## 14. Current Dated Registry Snapshot

`snapshots/flow-baseline-2026-10-03.json` (same observation date, content
corrected by FIX 01): 2 surfaces, 7 models, 6 official sources, fingerprint
`e25b991d875d6ff8` (recomputed for the corrected content; the pre-fix value
is retired and retained nowhere as truth). Availability UNKNOWN everywhere; 19 sourced
cost observations (Lite 2, Fast 2, Quality 1, Omni 11, Nano 0 — image costs
unpublished). Seed loader marks it dated baseline, never truth.

## 15. Image Model Coverage

Same normalized contract: Nano Banana Pro/2/2-Lite with IMAGE_GENERATION +
IMAGE_REFERENCE + IMAGE_EDITING; orientations/durations undeclared (UNKNOWN,
exact reference counts not inferred). F5: STATIC missing-asset resolves to
Nano Banana with zero video models in candidates.

## 16. Video Model Coverage

Veo tiers + Omni with per-workflow duration/orientation constraints and
input roles (START/END frames; reference roles on ingredients rules).
Quality: REFERENCE_GUIDED_VIDEO UNSUPPORTED (F4 rejects it for
VEO_REFERENCE). Lite/Fast reference rules duration-locked to 8s (F2 resolves
at 8s; F3 rejects them at 6s with duration reasons while Omni covers 6s).
Omni First+Last 4/6/8/10s SUPPORTED (G1: only omni proves 10s first+last;
Veo tiers honestly rejected at 10s).

## 17. Availability / Account / Region Semantics

Optional non-secret context only (`subscriptionTier`, `region`, `surface`).
Unverified → UNKNOWN + `RUNTIME_AVAILABILITY_NOT_VERIFIED` (never AVAILABLE).
Region/subscription rule mismatches reject; undeclared rules pass with the
gap recorded (provisional path). No VPN/bypass logic exists.

## 18. Resolver Input Contract

`buildRequirement` (read-only over the 1G.5 decision) supports the full §13
contract: ids, renderMode, requiredCapabilities (+ render-mode-implied
workflows), referenceStrategy, asset roles, platform, orientation (derived),
mediaTargetKind (IMAGE for STATIC/REMOTION, VIDEO for VEO_*), duration,
resolution, provider workflow label (new, caller-named only, never assumed),
quality/cost/provider/model preferences, account/region context, outputCount,
existingAssetSatisfied, missingInputImage, policyVersion, source decision
id+fingerprint → requirement fingerprint. 1G.5-absent optionals stay null.

## 19. Hard Compatibility Filter

Order: surface policy → surface/model availability (UNAVAILABLE/RETIRED
reject) → media kind → per-capability rules (UNSUPPORTED rejects; UNKNOWN →
policy PROVISIONAL(default)/REVIEW; CONFLICT → preserved provisional/review)
→ orientation/duration/resolution/region/subscription constraints →
START/END/reference input roles (END without first+last evidence rejects —
no silent downgrade, C3) → zero candidates = BLOCKED +
`NO_COMPATIBLE_MODEL` + per-model reasons + honest replan note (C9).
Output-shape caps agree with orientation instead of re-proving durations.

## 20. Ranking Policy

Compatible-only, deterministic, explicit-policy-driven: explicit model
(−1000) → provider (−500) → verified availability (−100) → fresh evidence
(−50) → fresh comparable exact cost under HIGH sensitivity (ordinal bonus,
never absolute) → modelId ascending tie-break (recorded factor).
Evidence-weak (conflict/unknown) candidates sort below clean support
(+200/+400 penalties); unverified availability is orthogonal (warned, never
ranked — FIX 01 refinement). No cinematic/quality scores exist. Tie-breaks
and cost comparisons are exposed as factors (S1/S7).

## 21. Cost / Credit Contract

Observations = `{unit (credits_per_generation|currency_per_generation|
credits_per_upscale), value, context{workflow?, durationSeconds?,
subscriptionTier?, resolution?}, sourceRefs[], observedAt, freshness}`.
Applies only when fresh and every specified context dimension matches (tiered
values never assumed; workflow-scoped values never leak across workflows).
Exact = single fresh applicable value; else UNKNOWN/CONFLICT. Total =
value × outputCount only for per-generation units with explicit count (K2–K4).
Stale/conflicting cost never becomes exact (S6/T2/K5). `externalCostEstimate
= UNKNOWN` upstream untouched (K6 byte-identity proof).

## 22. Current Official Cost Observations

Seeded verbatim from the verified credit page (all `credits_per_generation`
except upscale rows, all FRESH 2026-10-03, source `flow-credits-16526234`):

```text
Veo 3.1 - Lite:   10 (non-Ultra) / 5 (Ultra)            [4s/6s/8s row scope]
Veo 3.1 - Fast:   20 (non-Ultra) / 10 (Ultra)           [4s/6s/8s row scope]
Veo 3.1 - Quality: 100 (all users, 8s)
Omni 720p:        7 / 10 / 12 / 15 @ 4/6/8/10s
Omni 360p:        4 / 5 / 6 / 7 @ 4/6/8/10s (resolution-scoped)
Omni edit:        40 (workflow-scoped: Edit uploaded & generated videos)
4K upscale:       50 (Ultra, credits_per_upscale)
1080p upscale:    0 (Plus/Pro/Ultra, credits_per_upscale)
```

Data-driven proof: K7 resolves omni 8s × outputCount 2 → `12 × 2 = 24`
from the snapshot (no constant in code); K8 same request without count →
rate KNOWN, total UNKNOWN. Unknown tier → cost UNKNOWN (tier never assumed).

## 23. Override Safety

`applyModelOverride` re-validates the named model against the stored
requirement: unknown ID / stale source decision / UNSUPPORTED capability /
duration / orientation / reference workflow → BLOCKED (`INCOMPATIBLE_OVERRIDE_*`).
UNKNOWN availability → ACCEPTED_WITH_WARNING under default policy. Valid
compatible selection → ACCEPTED + effective swap; refreshes never silently
overwrite it (S2–S4, persistence preservation test).

## 24. Resolution Artifact

Versioned `mr-…` artifact per §17 plus `resolutionKind
(ASSET_SATISFIED|RENDERER_NOT_REQUIRED|ASSET_MODEL|VIDEO_MODEL)`,
`requirement` echo, candidate/rejected lists with per-model reasons,
freshness triple, cost estimate, snapshot ref, fingerprint, timestamps.
`effective = selected ?? recommended` (S2/S3). Schema + semantic validation
(recommended ∈ candidates, effective math, reasons on resolved, blocker on
BLOCKED, no-downgrade check, cost-math check, snapshot ref present).

## 25. Persistence

`projects/<projectId>/model-resolutions/<shotId>.json`, atomic via the
canonical artifact-store, Ajv-validated shape, operator selection preserved
across refreshes without force (S3). No secrets persistable by construction
(only tier/region strings, never tokens).

## 26. Staleness / Invalidation

`checkResolutionStaleness`: requirement change, snapshot fingerprint change,
source-decision fingerprint change, policy change, cost-observation change
under HIGH sensitivity → stale with reasons. Only resolution artifacts are
affected — research/story/modality/prompt/1G.5 decision artifacts are never
touched (T3/T4 + T6 boundary proof from both sides).

## 27. 1G.5 Integration Boundary

Read-only bridge (`buildRequirement` copies fields; K6 + E2E prove
byte-identity after resolution). No provider/model ID in 1G.5 logic (B5/B6
source scans green). No strategy/modality/framing/claim mutation possible
(validator `UPSTREAM_REWRITTEN` guard + tests). Model availability changes
never stale 1G.5 (T6, both directions). Optional `workflow` requirement
field is caller-supplied only — 1G.5 is never asked to produce it.

## 28. Prompt Compiler Boundary

Compiler untouched (no 1G.4 file modified); B7 re-proves
`PROMPT_TARGET_REQUIRED` without caller target. 1G.6 attaches no metadata
to prompt packages in this phase (future runtime layer concern only).

## 29. Required Test Matrix Results

`tests/providers/test-model-capability-registry.js`: **152 passed, 0 failed**.
R1–R5 (R5 synthetic-labeled) · C1–C9 (incl. REVIEW-policy branch) ·
F1–F6 + G1 current-page checks · S1–S7 · K1–K8 (K7/K8 official-data,
K5 conflict, K6 refresh) · T1–T6 · B1–B8. Every §27 ID maps to a passing
assertion; G-checks pin Lite/Fast 8s-only ingredients, Quality reference
exclusion, Omni 10s first+last.

## 30. E2E Fixture Results

10-case mixed fixture, all green: (1) satisfied static → NOT_REQUIRED; (2)
missing image → Nano Banana ASSET_MODEL; (3) REMOTION → no video model; (4)
first-frame resolves; (5) first+last resolves with first+last evidence; (6)
reference 8s resolves; (7) 10s-vs-8s-only → BLOCKED; (8) availability
UNKNOWN + warning (never AVAILABLE); (9) fresh cheaper cost wins under HIGH;
(10) conflicting costs → exact UNKNOWN. Outcome vector requirement-driven
(`NOT_REQUIRED,PROVISIONAL,…,BLOCKED,…`); all 10 decisions re-resolve
without mutation.

## 31. Schema Validation

`node scripts/checks/validate-schemas.js` → ALL TESTS PASSED (45 schemas:
43 existing + `model-registry-snapshot` + `model-resolution`, each with
accept + reject instances, incl. provenance-missing rejection).

## 32. Targeted Regression

SAC ON: `providers` 9/9 (incl. 152-assert 1G.6 suite) + `story` 12/12
(1G.4 + both 1G.5 suites intact: 136 + 158) + pipeline/research/topic/
media/policy/qa/flow 0 failed + schemas + `check:repo-structure`
REPOSITORY_STRUCTURE_OK. No 1G.1–1G.5 source file modified by FIX 01 except
`validate-schemas.js` (additive instances) and `resolver.js` requirement
`workflow` passthrough (additive optional field).

## 33. Full Regression

SAC manually OFF by operator; `npm run render:doctor` → READY (remotion
4.0.529, preflights OK). `npm test` → all 11 domains,
**0 failed suite(s) in 236.0s**, incl. 18 native Remotion suites (render
smoke PASS, no skips) and the 152-assert 1G.6 suite. `check:repo-structure`
→ OK. `validate-schemas.js` → ALL PASSED. Only established test commands ran
in the SAC-off window. SAC restored ON by operator afterward; no native
rerun after restore (per boundary).

## 34. Security Restoration

Agent toggled SAC = NO; Defender/CodeIntegrity/registry/exclusions
untouched; no secrets persisted; Flow calls = 0, Veo generations = 0, image
generations = 0, credits spent = 0, Flow UI mutations = 0, no live
automation, no bypass logic. Operator-confirmed SAC = ON closes the chain.

## 35. Files Created

```text
providers/model-registry/shared.js
providers/model-registry/registry.js
providers/model-registry/resolver.js
providers/model-registry/validator.js
providers/model-registry/store.js
providers/model-registry/index.js
providers/model-registry/snapshots/flow-baseline-2026-10-03.json
schemas/model-registry-snapshot.schema.json
schemas/model-resolution.schema.json
tests/providers/test-model-capability-registry.js
Report/PHASE_1G6_01_PROVIDER_MODEL_CAPABILITY_REGISTRY_REPORT.md
```

## 36. Files Modified

```text
scripts/checks/validate-schemas.js (registered 2 schemas + 4 accept/reject instances)
```

No 1G.1–1G.5, provider-runtime, or Flow Companion source modified. No root
code added.

## 37. Files Deleted

None. No fix-*/debug-*/temp-* artifacts created (tmp test roots live in the
OS temp dir, outside the repo).

## 38. Known Limitations

- Availability is UNKNOWN across the seed (no account UI observation yet);
  every video resolution is therefore PROVISIONAL — honest, not a defect.
- Image-model costs and reference-image counts are unpublished → UNKNOWN.
- Subscription matching is exact-string; near-miss tiers (e.g. operator
  "Pro" vs documented "Plus/Pro/Ultra" bundle) conservatively yield UNKNOWN.
- "Extend videos" and Lower-Priority variant are documented but unmodeled
  (outside the 1G.5 workflow vocabulary).
- The seed is a same-day observation, not a live feed; refresh is a data
  update by design (§39 holds: new tier/disappearing model/cost change =
  snapshot edit, no architecture change).

## 39. Acceptance Criteria Checklist

Architecture: audited ✓ / one owner ✓ / no duplicate subsystem ✓ / 1G.5
neutral ✓ / 1G.4 target-driven ✓ / downstream direction ✓.
Registry: descriptors ✓ / constrained rules ✓ / image+video ✓ / availability
split ✓ / UNKNOWN preserved ✓ / provenance required ✓ / field authority ✓ /
conflicts preserved ✓ / freshness ✓ / snapshot+fingerprint ✓.
Resolver: filter-before-rank ✓ / unsupported unselectable ✓ / unknown never
silent ✓ / deterministic ✓ / explainable ✓ / selection preserved ✓ /
incompatible blocked ✓ / structured blocker ✓.
Cost: sourced+timestamped ✓ / no price truth in logic ✓ / per-generation
semantics ✓ / count required for totals ✓ / stale/conflict never exact ✓ /
subscription-aware or UNKNOWN ✓.
Staleness: resolution-only ✓ / 1G.5 untouched ✓ / cost-only surgical ✓ /
idempotent ✓.
Safety/scope: 0/0/0/0 generations-calls-credits-UI ✓ / no automation ✓ / no
bypass ✓ / no secrets ✓.
Gates: 1G.6 suite ✓ / providers ✓ / 1G.4 ✓ / both 1G.5 suites ✓ / schemas ✓ /
structure ✓ / full regression 0 failed ✓.

## 40. Final Verdict

```text
TASK_VALIDATION = PASS
PHASE 1G.6 — PROVIDER / MODEL CAPABILITY REGISTRY = COMPLETE
REPORT_INTEGRITY = COMPLETE
OFFICIAL_COST_SOURCE = VERIFIED
CURRENT_CAPABILITY_SNAPSHOT = VERIFIED
NEXT = read the current canonical Roadmap V6 and continue to the first unfinished post-1G.6 work unit.
```

STOP per §14: no post-1G.6 work, no Flow generation, no settings mutation,
no credit spend. (No next phase name exists in-repo, so none is invented.)
