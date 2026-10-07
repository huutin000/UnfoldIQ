# PHASE 1G.5 — PROMPT 01
# VISUAL / MOTION DECISION ENGINE REPORT

Date: 2026-10-03
Roadmap: V6 — cheapest-adequate visual strategy before Prompt Compiler

## 1. Status

```text
TASK_VALIDATION = PASS
PHASE 1G.5 — VISUAL STORY GRAMMAR + VISUAL / MOTION DECISION ENGINE = COMPLETE
NEXT = PHASE 1G.6 — PROVIDER / MODEL CAPABILITY REGISTRY
```

All Stage-B acceptance criteria proven (see Appendix A for the Stage-A fix). entry gate PASS, single canonical owner,
provider-neutral enum, legacy alias, explainable motion need, first-class
editor motion, cheapest-adequate with essential-evidence gating, no fixed
shares, working optional budget, selection/override separation with hard
blockers, asset roles + reference-first + first/last-frame capabilities, no
model/price/variant-count in canonical core, lazy prompt compilation per
strategy, content integrity intact, persistence/idempotency/targeted
staleness, mixed distributions on all fixtures, full `npm test` 0 failed,
schemas + structure PASS, 0 provider calls / 0 credits, no downstream phase
implemented early, SAC restored ON by operator (no native rerun after restore).

## 2. Entry Gate

```text
Report/PHASE_1G4_01_PROMPT_COMPILER_REPORT.md:
  TASK_VALIDATION = PASS
  PHASE 1G.4 — PROMPT COMPILER = COMPLETE
  NEXT = PHASE 1G.5 — VISUAL / MOTION DECISION ENGINE
```

Entry gate = PASS (verified by Read before any implementation).

## 3. Scope / Non-Scope

Implemented: canonical visualType classification, explainable motion-need
scoring (NONE/LOW/MEDIUM/HIGH), editor-motion viability + technique plans,
cheapest-adequate decision (STATIC→EDITOR→CANDIDATE→RECOMMENDED), continuity
risk handling, reference-first/image-to-video preference, first/last-frame
capability requests, optional budget allocation, recommendation/selection
separation + validated manual override, lazy Prompt Compiler handoff,
versioned persistence with targeted staleness, decision validator, project
summary + monotony/overuse advisories.

NOT implemented (per boundary): model selection, Flow/Veo/Gemini calls,
credit prices, Flow Companion automation, provider retry orchestration,
rendering, Remotion code, Spoken Script Humanizer, Narration Director,
TTS/captions, analytics/learning loop, any post-1G.5 work. 0 provider media
calls, 0 credits spent — verified by design (no provider imports in
`lib/visual-motion/`) and by test (P6 + source scans).

## 4. Official Provider Capability Check

Checked 2026-10-03 (web search, official sources only):

- `support.google.com/flow/answer/16352836` (Flow models & features):
  Text-to-Video, Frames-to-Video (First), Frames-to-Video (First+Last),
  Ingredients/References-to-Video exist as capability concepts; image models
  exist for frames/ingredients; aspect ratios 16:9 / 9:16.
- `cloud.google.com/vertex-ai/.../generate-videos-from-first-and-last-frames`:
  first+last-frame video generation is a real capability concept.
- `deepmind.google/models/veo/` + `blog.google` Veo 3.1 update: First/Last
  Frame, Ingredients-to-Video, reference-guided subject preservation.
- 1G.4 report (2026-10-03) already verified Gemini image + Veo prompt guides.

Adopted ONLY as capability concepts:
`IMAGE_GENERATION, IMAGE_REFERENCE, IMAGE_EDITING, VIDEO_GENERATION,
IMAGE_TO_VIDEO, FIRST_LAST_FRAME_VIDEO, REFERENCE_GUIDED_VIDEO,
PORTRAIT_OUTPUT, LANDSCAPE_OUTPUT`.
Recorded NOWHERE as canonical truth: model labels (Veo 3.1 / Lite / Fast /
Gemini Omni / Nano Banana), credit numbers, reference-image counts,
resolutions, output-count UI. Test B6 scans `lib/visual-motion/*.js` for
model/price patterns on every run.

## 5. Existing Capability Audit

Repository-wide search for `recommendedOutputType|selectedOutputType|
visualType|VEO_CANDIDATE|EDITOR_MOTION|GENERATED_MOTION|production-decision`
found ZERO existing owners.

| Module | Current role | Disposition | Reason |
|---|---|---|---|
| `lib/story-structure/*` | Beat/Scene/Shot planning (1G.3) | reuse as inputs | canonical upstream source |
| `lib/prompt-compiler/*` | lazy targetKind-driven prompt compilation (1G.4) | reuse via facade | compiler never selects strategy; 1G.5 supplies targetKind |
| `lib/creative-memory.js` | anti-repetition memory (1G.2) | advisory hook only | never forces decisions |
| `flow-companion/extension` PromptWriter | Flow UI insertion | leave alone | different concern |
| visual/motion recommendation | **absent** | **create** | classification **D — genuinely missing** |

No duplicate engine created; one canonical owner (below).

## 6. Canonical Owner Decision

One owner: `lib/visual-motion/` =
`shared.js` (version/enums/alias/capabilities) +
`decision.js` (visualType, motion need, cheapest-adequate) +
`editor-motion.js` (technique vocabulary + plan) +
`plan.js` (plan-level: budget, scenes, summary, guards) +
`validator.js` (structured validator) +
`store.js` (persistence/staleness) +
`index.js` (facade: decide/override/lazy-compile).
Schema: `schemas/production-decision.schema.json` v1.0.0.

## 7. Canonical Recommendation Enum

```text
STATIC_IMAGE → EDITOR_MOTION → GENERATED_MOTION_CANDIDATE → GENERATED_MOTION_RECOMMENDED
```

Provider-neutral by construction. The words "Veo/Flow/Gemini/model" appear in
canonical sources only inside the validator's *forbidden-pattern* guards and
the legacy alias map (see §8) — never as selections.

## 8. Legacy Compatibility / Migration

Audit found no `VEO_*` artifacts in the repo. Forward-compat strategy:
`LEGACY_ALIAS = { VEO_CANDIDATE → GENERATED_MOTION_CANDIDATE,
VEO_RECOMMENDED → GENERATED_MOTION_RECOMMENDED }` in `shared.js`;
`normalizeRecommendation()` accepts legacy labels on override/selection input
and always emits canonical enum. Covered by test (legacy override test).

## 9. Visual Type

Reused vocabulary:
`CHARACTER_SCENE, ENVIRONMENT, EVIDENCE, DIAGRAM, MAP, OBJECT, COMPARISON,
TIMELINE`. Explicit caller signal wins; only two safe purpose derivations
exist (`EVIDENCE_VISUAL→EVIDENCE`, `ESTABLISH→ENVIRONMENT`); anything else
without a signal returns `DECISION_REVIEW_REQUIRED` — never guessed (§33).

## 10. Decision Artifact Contract

Implemented per §8 concept fields in `schemas/production-decision.schema.json`
(decisionId `pd-…`, version, project/scene/shot, visualType,
recommended/selected/effectiveOutputType, motionNeed/score,
editorMotionViability, generatedMotionValue, referenceStrategy,
requiredCapabilities[], requiredAssetRoles[], editorMotionPlan,
decisionReasons[], warnings[], blockers[], framing, generationRisk,
costClass, externalCostEstimate=`UNKNOWN`, claimRefs, classificationRefs,
sourceRefs, sourceFingerprints, platform, contentClass, policyRef,
selectedReason, overrideState, fingerprint, status, timestamps).
Schema valid + instance accept/reject covered in `validate-schemas.js`.

## 11. Explainability

Every READY decision carries bounded `decisionReasons[]` (e.g.
`baseline EDITOR_MOTION for visualType MAP…`, `motion need = MEDIUM (score 3:
…)`, `reference-first: recurring subject…`). Validator rejects READY
decisions with empty reasons (`REASONS_REQUIRED`). No opaque scores: test D7
asserts reasons name technique families and carry no mystery numbers.

## 12. Motion Need

Weighted explainable signals: essential (×2) = physicalInteraction,
essentialToUnderstanding, temporalTransformation, causeEffectOverTime;
(×1) = subjectMovement, environmentalDynamics, revealProgression,
cameraMovementNeeded, turningPoint, emotionalPayoff.
Score 0→NONE, 1→LOW, 2–3→MEDIUM, ≥4 or ≥2 essential→HIGH — but HIGH alone
never forces video (see §14). All-undefined signals → REVIEW (no guessing).

## 13. Editor Motion Viability

Vocabulary (16 concepts): PAN, ZOOM, KEN_BURNS, CROP_REFRAME, PARALLAX_2_5D,
LAYER_REVEAL, HIGHLIGHT, POINTER, MAP_ROUTE, DIAGRAM_STEP,
TIMELINE_PROGRESS, COMPARISON_SLIDE, OBJECT_FOCUS, TEXT_CALLOUT, CROSSFADE,
MATCH_CUT. Per-type baselines in `editor-motion.js`; viability GOOD/ADEQUATE/
POOR with reasons. Editor motion is first-class, never a fallback label.

## 14. Cheapest-Adequate Rule

Implemented exactly in priority order STATIC→EDITOR→CANDIDATE→RECOMMENDED:

- NONE → baseline, EDITOR baselines drop to STATIC.
- LOW → CHARACTER_SCENE becomes CANDIDATE (G3); ENVIRONMENT/COMPARISON/
  OBJECT become EDITOR; evidence-class stays STATIC.
- MEDIUM → CHARACTER_SCENE becomes CANDIDATE; others EDITOR at most.
- HIGH → RECOMMENDED only with essential evidence
  (essentialToUnderstanding / physicalInteraction / causeEffectOverTime);
  else CHARACTER_SCENE→CANDIDATE, dynamic ENVIRONMENT→CANDIDATE,
  explanatory visuals→EDITOR (informational progression is synthesizable).
- Importance/cinematic weight alone never yields GENERATED (G4).
- No `CHARACTER_SCENE = video` shortcut anywhere.

## 15. STATIC_IMAGE Rules

Favored for single-state/evidence/reference-like visuals with no temporal
requirement (EVIDENCE/OBJECT baselines; NONE-motion downgrades). Static
decisions still allow downstream cut/crop/transition/overlay without
changing canonical type.

## 16. EDITOR_MOTION Rules

Favored when stills + synthesis communicate the shot: map routes, timeline
progression, diagram steps, comparisons, evidence emphasis, slow environment
exploration, parallax/detail reveals. Structured `editorMotionPlan`
(motionPlanId, techniques, focus, direction, intensity, relativeTiming,
layers, constraints, sourceImageRole) — no Remotion, no timestamps.

## 17. GENERATED_MOTION_CANDIDATE Rules

Used when motion may add value but is not essential (subtle gesture G3,
secondary beats, atmosphere dynamics, high continuity-risk cases). Downgrades
cleanly to EDITOR under budget with recorded reasons (B2–B4).

## 18. GENERATED_MOTION_RECOMMENDED Rules

Only with essential evidence: central interaction (G1), major physical action
(G2), comprehension-critical or cause/effect motion. Never for
"cinematic" alone (G4). Evidence-framed visuals are capped at CANDIDATE with
warning, never silently reenacted.

## 19. Scene vs Shot Recommendation

Shot decision = executable unit. Scene = derived aggregate only
(`all-static | mixed | editor-motion-heavy | generated-motion-present |
no-decisions`). Long-form run: scenes = `[generated-motion-present,
all-static]` — no silent overrides. Scene invalidation is targeted
(`invalidateByScene` touches only that scene's decisions).

## 20. Required Asset Roles

Per strategy: STATIC/EDITOR → `PRIMARY_IMAGE` (+`MAP_BASE`/`DIAGRAM_BASE`/
`BACKGROUND_LAYER`+`FOREGROUND_LAYER` implied by parallax/layer techniques);
generated reference-first → `START_FRAME` (+`END_FRAME` on transitions,
+`CHARACTER/ENVIRONMENT/OBJECT_REFERENCE` for recurring subjects);
text-only → none. No provider reference-count limits encoded.

## 21. Reference-First / Image-to-Video

Recurring subject + approved reference + generated strategy →
`referenceStrategy = START_FRAME_REQUIRED` (G5), capabilities include
`IMAGE_TO_VIDEO + REFERENCE_GUIDED_VIDEO`. Without approved reference →
`REFERENCE_GUIDED` preferred-but-missing (downgrade or block paths, §§26–27).
Generic non-recurring motion → `TEXT_BASED` (VIDEO only).

## 22. First/Last Frame Capability

State A→B transitions (`stateTransition` or distinct start/end states) add
`FIRST_LAST_FRAME_VIDEO` capability + `END_FRAME` role (G6) without assuming
any provider supports it — downstream capability resolution decides.

## 23. Generated-Motion Budget Policy

Optional caller policy only: `maxGeneratedMotionShots`,
`maxGeneratedMotionShare`, `maxGeneratedMotionSeconds` (+`perShotSeconds`
when seconds must be evaluated), `costSensitivity`. No universal default
exists in code (B5 scans for hard-coded shares). `HIGH` sensitivity without
caps only warns; seconds caps without per-shot seconds are honestly reported
unevaluable.

## 24. Cost / Credit Boundary

Canonical core stores no prices: `costClass` (LOW/MEDIUM/HIGH derived from
strategy tier) + `externalCostEstimate = "UNKNOWN"` always. Validator rejects
any credit-price text (`CREDIT_PRICE_HARDCODED`) and any non-UNKNOWN
external estimate. 0 credits spent; no Flow UI touched.

## 25. Budget Allocation

Over-cap generated shots are ranked by explainable value
(RECOMMENDED-first, essential signals, turningPoint, importance HIGH,
poor-editor-alternative) and the lowest are downgraded to EDITOR_MOTION with
`budget downgrade…` reasons + `BUDGET_DOWNGRADED_TO_EDITOR` warnings (B2–B4).
Highest-value motion retained; nothing randomly dropped.

## 26. Recommendation vs Selection

Separate fields; `effective = selected ?? recommended`. Fresh engine runs
preserve an existing operator selection on persist (O3) while still updating
the recommendation.

## 27. Manual Override Safety

`applyManualOverride` returns ACCEPTED / ACCEPTED_WITH_WARNING / BLOCKED with
reasons. Hard blockers: unknown strategy, stale input, STRICT entity missing
an approved reference for generated motion, unsupported downstream
capability, evidence→generated factual-integrity violation (O4). Downgrading
HIGH-value generated motion is accepted with warning, never silent.

## 28. Prompt Compiler Integration

Lazy mapping enforced in `compileForDecision` (P1–P5 all PASS):

| Strategy | IMAGE | VIDEO | Editor plan | Real call |
|---|---|---|---|---|
| STATIC_IMAGE | yes | no | no | no |
| EDITOR_MOTION | yes | no | yes | no |
| GENERATED reference-first | yes | yes | no | no |
| GENERATED text-only | no | yes | no | no |

P6 proves the compiler is still targetKind-driven (`PROMPT_TARGET_REQUIRED`
without caller target). 1G.4 ownership untouched (no 1G.4 files modified).

## 29. Editor Motion Plan

See §16. Built by `buildEditorMotionPlan`; attached to EDITOR decisions and
to lazy-compile output metadata. Renderer-neutral.

## 30. Remotion Boundary

No Remotion code, no component, no frame math in 1G.5 (verified: no
`remotion` imports in `lib/visual-motion/`). Techniques are production
concepts for a later render layer.

## 31. Lazy Prompt Compilation

Only needed packages compile; counts asserted per strategy (P5). No unused
packages, no speculative invalidation payload.

## 32. Decision Signals

Consumed read-only: visualType hint, 10 motion flags, importance,
stateTransition/start/end, recurringEntities (kind/reference/lock),
referenceAvailability/assetIds, framing, classificationRefs, claimRefs,
continuityRisk, focus/direction/intensity, platform, contentClass, policy
version. Nothing upstream is rewritten (C1/C3/C5).

## 33. FACTUAL Behavior

Evidence visuals stay `EVIDENCE_VISUAL`-framed and static/editor by default;
factual character/environment scenes carry `RECONSTRUCTION` framing (C4);
generated reenactment of evidence is capped at CANDIDATE with warning.
No fake certainty text is ever generated (validator `CLASSIFICATION_PROMOTED`
+ prompt-compiler certainty firewall downstream).

## 34. FICTION Behavior

Cheapest-adequate still applies: horror atmosphere → STATIC (2/3 shots),
action payoff → GENERATED RECOMMENDED (1/3, share 0.3333), never every shot.
Framing `FICTIONAL_STAGING`, zero claim refs (C2).

## 35. HYBRID Behavior

Classification labels preserved verbatim (C3); non-FACT labels without
illustrative/reconstruction framing fail validation (`CLASSIFICATION_PROMOTED`).
Folklore/speculation can never be evidence-framed.

## 36. YouTube / TikTok

Platform contributes orientation capability (`LANDSCAPE_OUTPUT` /
`PORTRAIT_OUTPUT` from canonical PROFILE.yaml) and hook-urgency context only.
Proven: tiktok short-form mixed share 0.25, youtube long-form 0.1538 — no
fixed per-platform ratio, no fixed shot counts.

## 37. Continuity Risk

Recurring-entity/reference signals drive LOW/MEDIUM/HIGH risk with reasons;
HIGH risk + marginal value downgrades to EDITOR (G7); STRICT entity without
an approved reference blocks continuity-critical generated motion
(`BLOCKED_MISSING_REFERENCE`) until the reference exists.

## 38. Safety / Generation Risk

Keyword advisory (`GENERATION_RISK` warning + planning fallback note) only.
No story rewrite, no filter-evasion logic anywhere.

## 39. Provider / Model Boundary

Canonical core selects no models. Validator rejects model names in decision
text (`MODEL_SELECTED`). B6 source scan runs per suite.

## 40. Flow Agent Settings Boundary

1G.5 configures nothing (no instructions/confirm/model/output-count/credit
settings). The artifact exposes strategy, orientation capability,
requiredCapabilities, referenceStrategy, asset roles — sufficient for the
downstream runtime layer.

## 41. Generation Count Boundary

Decisions count canonical assets (primary images, start/end frames, layers),
never provider variant counts ("generate N images/videos" absent by design).

## 42. Persistence

`projects/<projectId>/production-decisions/<shotId>.json`, atomic
tmp+rename via `artifact-store`, stable IDs, fingerprints, selection
preservation. Round-trip + listing verified (O2/persistence tests).

## 43. Staleness / Invalidation

`checkDecisionStaleness` (shot/scene/platform/reference/policy-version);
`markShotStale`, `invalidateByScene`, `invalidateByReference` — all targeted.
Upstream research/story/beat/prompt artifacts are never touched by this
module (no imports, no writes outside `production-decisions/`).

## 44. Idempotency

Same inputs + same policy version → same recommendation/reasons/fingerprint
(long-form double-run asserts identical fingerprint vectors; suite uses fixed
`NOW`).

## 45. Creative Memory

Advisory-only input (`avoidPatterns[]` → `MEMORY_ADVISORY:` warnings).
Claim sets byte-identical with/without memory (C5). Never forces strategy,
cost, or selection.

## 46. Anti-Monotony

Advisory warnings for ≥4 consecutive STATIC, ≥3 consecutive generated, ≥3
repeated editor technique. Never forces expensive variation.

## 47. Project Production Summary

Derived per plan: totals per strategy, review/blocked counts, generated
share, estimated image/start/end assets, technique distribution,
`externalCostEstimate: UNKNOWN`. Real measured outputs:

- factual long-form (26 shots): static 17 / editor 5 / rec 4, share 0.1538,
  images 22, 24 ms.
- factual doc (5): static 3 / editor 2 / generated 0.
- horror fiction (3): static 2 / rec 1, share 0.3333.
- tiktok short (4): static 3 / rec 1, share 0.25.

## 48. Overuse Guard

100% generated share → warning + explicit-review flag (not a failure).
Proven unnecessary in fixtures (max observed share 0.4 on the 5-shot mixed
plan, 0.1538 long-form).

## 49. STATIC / EDITOR Test Matrix

| Case | Visual Type | Motion Need | Recommended | Reference Strategy | Reasons | Result |
|---|---|---|---|---|---|---|
| evidence (D1) | EVIDENCE | NONE | STATIC_IMAGE | NONE | evidence default, no temporal need | PASS |
| map (D2) | MAP | LOW | EDITOR_MOTION | NONE | MAP_ROUTE synthesizable | PASS |
| timeline (D3) | TIMELINE | LOW | EDITOR_MOTION | NONE | TIMELINE_PROGRESS synthesizable | PASS |
| diagram (D4) | DIAGRAM | LOW | EDITOR_MOTION | NONE | explanatory motion synthesizable | PASS |
| object (D5) | OBJECT | NONE | STATIC_IMAGE | NONE | single state communicates | PASS |
| static env (D6) | ENVIRONMENT | NONE | STATIC_IMAGE | NONE | no dynamics | PASS |
| technique (D7) | MAP | LOW | EDITOR_MOTION | NONE | names MAP_ROUTE/PAN/ZOOM | PASS |

## 50. Generated Motion Test Matrix

| Case | Visual Type | Motion Need | Recommended | Reference Strategy | Reasons | Result |
|---|---|---|---|---|---|---|
| interaction (G1) | CHARACTER | HIGH+essential | RECOMMENDED | TEXT_BASED | central interaction, turning point | PASS |
| major action (G2) | CHARACTER | HIGH+essential | RECOMMENDED | TEXT_BASED | physical+temporal+cause/effect | PASS |
| subtle gesture (G3) | CHARACTER | LOW | CANDIDATE | TEXT_BASED | value unproven, not auto-rec | PASS |
| importance-only (G4) | CHARACTER | NONE | STATIC_IMAGE | NONE | cinematic weight insufficient | PASS |
| recurring (G5) | CHARACTER | HIGH+essential | RECOMMENDED | START_FRAME_REQUIRED | approved ref → image-first | PASS |
| A→B (G6) | CHARACTER | HIGH+essential | RECOMMENDED | REFERENCE_GUIDED | +FIRST_LAST_FRAME_VIDEO/END_FRAME | PASS |
| high-risk low-value (G7) | CHARACTER | LOW | EDITOR_MOTION | NONE | continuity risk outweighs | PASS |

## 51. Budget Test Matrix

B1 cheapest-adequate without budget — PASS. B2 cap honored
(`maxGeneratedMotionShots: 1` → 1 generated) — PASS. B3 highest value
retained (RECOMMENDED kept) — PASS. B4 clean downgrade (READY + reasons +
warning) — PASS. B5 no universal share in code; mixed shares differ across
plans — PASS. B6 no model/price tokens in canonical sources — PASS.

## 52. Override Test Matrix

O1 effective=recommended — PASS. O2 persists through reload — PASS. O3 never
silently overwritten — PASS. O4 invalid/evidence-violating blocked — PASS.
O5 stale blocks readiness + override — PASS.

## 53. Prompt Compiler Integration Tests

P1 STATIC→IMAGE only — PASS. P2 EDITOR→IMAGE+plan, no VIDEO — PASS. P3
reference-first→IMAGE+VIDEO — PASS. P4 text-only→VIDEO only — PASS. P5 exact
package sets, no unused — PASS. P6 compiler still caller-driven — PASS.

## 54. FACTUAL / FICTION / HYBRID Matrix

C1 zero added claims + validator lineage — PASS. C2 fiction zero evidence +
FICTIONAL_STAGING — PASS. C3 hybrid labels verbatim, never evidence-framed —
PASS. C4 reconstruction framing retained — PASS. C5 memory causes zero
evidence change — PASS.

## 55. Long-Form Distribution

26 shots (24-section factual draft, youtube): static 17 / editor 5 /
candidate 0 / recommended 4 / share 0.1538 / images 22 / start 0 / end 0 /
elapsed 24 ms / scenes [generated-motion-present, all-static] / deterministic
(double-run identical fingerprints). No magic ratio, no all-generated
routing, no fixed per-scene strategy. PASS.

## 56. Horror-Fiction Distribution

3 shots: static 2 (atmosphere/exposition) / recommended 1 (chase payoff, share
0.3333). Not every horror shot generated. PASS.

## 57. Documentary Distribution

5 shots: static 3 (evidence incl. archival ledger) / editor 2 (map route,
mechanism steps) / generated 0. Reconstruction framing intact; uncertainty
untouched. PASS.

## 58. Validator

`validateDecision` returns `{valid, errors[], warnings[]}` over schema,
lineage, explainability, strategy/capability/asset compatibility, selection
math, content integrity (FICTION/HYBRID), provider boundary, cost boundary.
Accept/reject proven (5 negative codes exercised).

## 59. 1G.1 Regression

`node scripts/run-tests.js research topic providers media policy qa` →
0 failed (research 14 suites incl. acquisition/evidence, topic, providers,
media, policy, qa all PASS, 59.8 s). research-deep fixture suites later
passed inside the final full `npm test` (no live API calls; DEEP code
unmodified).

## 60. 1G.2 Regression

`test-creative-memory.js` (pipeline domain) PASS; memory-advisory integration
covered by C5 (zero evidence change, advisory-only warnings).

## 61. 1G.3 Regression

`test-story-structure.js` + `test-story-e2e.js` + `test-story-draft.js` +
fiction/hybrid/audit suites (story domain) all PASS; 1G.5 distribution tests
build on the 1G.3 facade (`runStoryToVisualStructure` → READY in every
fixture).

## 62. 1G.4 Regression

`test-prompt-compiler.js` (story domain) PASS, unmodified; P6 proves the
compiler contract unchanged (still `PROMPT_TARGET_REQUIRED` without caller
targetKind). No 1G.4 file was modified in this phase.

## 63. 1G.5 Targeted Tests

`node tests/story/test-visual-motion-decision.js` → 133 passed, 0 failed
(D1–D7, G1–G7, B1–B6, O1–O5, P1–P6, C1–C5, long-form/horror/documentary/
tiktok distributions, validator negatives, persistence, idempotency,
targeted invalidation, legacy alias, platform orientation, REVIEW case).

## 64. Schema / Structure Checks

`node scripts/checks/validate-schemas.js` → ALL SCHEMA VALIDATIONS PASSED
(43 schemas incl. new `production-decision.schema.json` with accept + reject
instances). `npm run check:repo-structure` → REPOSITORY_STRUCTURE_OK.

## 65. SAC / Render Regression Gate

- Operator manually set SAC = OFF (agent never toggles security).
- `npm run render:doctor` → `RENDER_DOCTOR_RESULT: READY` (remotion 4.0.529,
  ffmpeg/ffprobe/remotion preflight OK, out/ writable, headless shell present).
- Gate satisfied; full regression executed in the tight SAC-off window
  (render doctor + test commands only).

## 66. Full Repository Regression

While SAC was manually OFF and render:doctor READY:

- `npm test` → `flow, media, pipeline, policy, providers, qa, remotion,
  research, research-deep, story, topic: 0 failed suite(s) in 273.8s`.
  All 18 remotion suites PASS (incl. `test-remotion-render-smoke`),
  all 11 story suites PASS (incl. `test-visual-motion-decision.js`:
  133 passed, 0 failed). No skipped suite, no swallowed exit codes.
- `npm run check:repo-structure` → `REPOSITORY_STRUCTURE_OK`.
- `node scripts/checks/validate-schemas.js` → `ALL SCHEMA VALIDATIONS
  PASSED` (43 schemas incl. new `production-decision.schema.json`).

## 67. Security Restoration

Required states: agent toggled SAC automatically = NO; Defender changed =
NO; exclusions/CodeIntegrity/registry = untouched; no secrets persisted; no
media provider called; 0 credits spent. SAC status: operator confirmed
restoration to **ON** after the regression window; no native suite was rerun
after restore (per boundary). Security chain closed by operator confirmation.

## 68. Files Created

```text
schemas/production-decision.schema.json
lib/visual-motion/shared.js
lib/visual-motion/decision.js
lib/visual-motion/editor-motion.js
lib/visual-motion/plan.js
lib/visual-motion/validator.js
lib/visual-motion/store.js
lib/visual-motion/index.js
tests/story/test-visual-motion-decision.js
Report/PHASE_1G5_01_VISUAL_MOTION_DECISION_ENGINE_REPORT.md
```

## 69. Files Modified

```text
scripts/checks/validate-schemas.js (+ production-decision schema + instances)
```

No 1G.1–1G.4 source file modified. No root code file added.

## 70. Files Deleted

None (no fix-*/debug-*/temp-* artifacts created; tmp test roots live in the
OS temp dir, outside the repo).

## 71. Known Limitations

- Visual-type for ambiguous purposes (REVEAL/DETAIL/CONTRAST/…) requires an
  explicit caller signal; otherwise the engine returns REVIEW rather than
  guessing. Future upstream semantic enrichment may reduce REVIEW rates, but
  the no-guessing rule stays.
- `maxGeneratedMotionSeconds` without `perShotSeconds` is reported
  unevaluable (honest non-enforcement, not a silent pass).
- Generation-risk detection is keyword-advisory only; provider-side safety
  behavior is a downstream runtime concern.
- Anti-monotony and overuse guards are advisory by design.

## 72. Required Decision Matrix

| Case | Visual Type | Motion Need | Recommended | Reference Strategy | Reasons | Result |
|---|---|---|---|---|---|---|
| evidence | EVIDENCE | NONE | STATIC_IMAGE | NONE | evidence default, no temporal need | PASS |
| map | MAP | LOW | EDITOR_MOTION | NONE | MAP_ROUTE synthesizable | PASS |
| timeline | TIMELINE | LOW | EDITOR_MOTION | NONE | TIMELINE_PROGRESS synthesizable | PASS |
| static environment | ENVIRONMENT | NONE | STATIC_IMAGE | NONE | no dynamics | PASS |
| dynamic environment | ENVIRONMENT | HIGH+essential | GENERATED_MOTION_RECOMMENDED | TEXT_BASED | comprehension-critical drift | PASS |
| subtle character gesture | CHARACTER_SCENE | LOW | GENERATED_MOTION_CANDIDATE | TEXT_BASED | value unproven, not auto-rec | PASS |
| major character action | CHARACTER_SCENE | HIGH+essential | GENERATED_MOTION_RECOMMENDED | TEXT_BASED | physical+temporal+cause/effect | PASS |
| recurring character | CHARACTER_SCENE | HIGH+essential | GENERATED_MOTION_RECOMMENDED | START_FRAME_REQUIRED | approved ref, image-first | PASS |
| state A→B transition | CHARACTER_SCENE | HIGH+essential | GENERATED_MOTION_RECOMMENDED | REFERENCE_GUIDED | +FIRST_LAST_FRAME_VIDEO | PASS |

## 73. Final Conclusion

```text
TASK_VALIDATION = PASS
PHASE 1G.5 — VISUAL / MOTION DECISION ENGINE = COMPLETE
NEXT = read the current canonical Roadmap V6 and continue to the first unfinished post-1G.5 work unit.
```

```text
TASK_VALIDATION = PASS
PHASE 1G.5 — VISUAL STORY GRAMMAR + VISUAL / MOTION DECISION ENGINE = COMPLETE
NEXT = PHASE 1G.6 — PROVIDER / MODEL CAPABILITY REGISTRY
```

Operator confirmed SAC = ON restored after full regression. No next phase
implemented inside this task. (Corrected verdict 2026-10-03 by FIX 1,
Appendix A §§74–92; the Stage-B-only verdict above is superseded.)

# APPENDIX A — V6 VISUAL STORY GRAMMAR + RENDER-MODE ALIGNMENT

## 74. Corrective Entry State

At FIX 1 start the report read `TASK_VALIDATION = PASS` for Stage B only,
while canonical Roadmap V6 defines 1G.5 as Stage A (Visual Story Grammar) +
Stage B (Renderer/Motion Decision). Status was corrected to `PARTIAL — V6
Visual Story Grammar Stage A not yet proven` before any FIX 1 code was
written, and is restored to PASS only here, after all criteria below passed
with evidence. 1G.6 was not started.

## 75. Canonical Roadmap V6 Gap

The frozen roadmap file `UNFOLDIQ_CANONICAL_ROADMAP_V6_SCOPE_FROZEN.md` does
not exist anywhere in the repo (glob-verified); the FIX 1 task text acts as
the frozen contract — no duplicate roadmap was created. The gap it names was
real and verified: repo-wide search for `visualModality|renderMode|
VEO_FIRST|VEO_REFERENCE|REMOTION_MOTION|MOTION_GRAPHIC|SPLIT_SCREEN|
CHARACTER_MOMENT|ANNOTATION` found NO existing owner (only unrelated
typography-direction tokens). Classification: D — genuinely missing, absorbed
into the existing `lib/visual-motion/` owner (no parallel subsystem).

## 76. Existing 1G.5 Capability Reuse

Stage B preserved intact and still green (old suite 136/136 after the fix,
C4 strengthened with explicit reconstruction intent): cheapest-adequate rule,
motionNeed, editor viability, reference-first, first/last-frame capability,
budget policy, manual override, lazy Prompt Compiler handoff, persistence,
idempotency, staleness, continuity risk, FACTUAL/FICTION/HYBRID safety,
0 provider calls / 0 credits. FIX 1 extends and aligns; nothing rewritten.
Two honest engine corrections landed during FIX 1: (1) TEXT_BASED A→B
transitions now request `FIRST_LAST_FRAME_VIDEO` + both frame roles (both
frames are created as canonical assets first); (2) decisions record
`referenceVersions` so version comparison is real. One honest new rule:
SPLIT_SCREEN forces at least EDITOR_MOTION (side-by-side must be composed).

## 77. Visual Story Grammar Contract

One canonical owner: `lib/visual-motion/grammar.js`
(`classifyVisualModality` + `applyModalityCap`), reused vocabulary in
`shared.js` (`VISUAL_MODALITIES`, `RENDER_MODES`, `MODALITY_STRATEGY_CAP`).
All 13 Roadmap V6 modalities representable: MAP, TIMELINE, CHART, DIAGRAM,
TYPOGRAPHY, COMPARISON, RECONSTRUCTION, CHARACTER_MOMENT, ATMOSPHERE,
METAPHOR, ANNOTATION, SPLIT_SCREEN, MOTION_GRAPHIC.

## 78. Modality Selection

Meaning-first precedence (deterministic, no provider/renderer input):
explicit caller modality (HIGH) → structured intent flags (HIGH:
reconstructionIntent, emotionalCharacterBeat, numericTrend,
historicalSequence, spatialMovement, mechanismProcess, evidenceLabeling,
conceptualAnalogy, textualEmphasis, kineticGraphic, moodWorld;
sideBySideDifference → COMPARISON, +simultaneousPresentation →
SPLIT_SCREEN) → motion-informed evidence (MEDIUM) → visualType-compat
default (LOW, alternatives listed) → REVIEW. Confidence is an explainable
HIGH/MEDIUM/LOW tier, never a scalar score.

## 79. Beat → Modality Lineage

Every decision carries `beatLineage` (beatIds, narrativeRoles,
narrativePurpose, visualObjective, shotPurpose); validator rejects lineage
mismatch with sourceRefs (`MODALITY_LINEAGE_MISMATCH`). Multiple Beats →
one modality/Scene and one Beat → multiple Shots preserved via 1G.3
cardinality (long-form: 26 shots from 24 sections, no 1=1 rule introduced).

## 80. Scene / Shot Integration

Shot decision = executable unit (modality + recommendation + renderMode);
Scene = derived aggregate only. `visualType` (broad category) and
`visualModality` (storytelling form) stored separately and never conflated
(test: CHARACTER_SCENE + reconstructionIntent → modality RECONSTRUCTION,
type unchanged; compat defaults recorded at LOW confidence with
alternatives; no blanket CHARACTER_SCENE→CHARACTER_MOMENT mapping exists).

## 81. Canonical Render-Mode Mapping

`resolveRenderMode` (decision.js, reused by budget/override paths):
STATIC_IMAGE → STATIC_IMAGE; EDITOR_MOTION → REMOTION_MOTION; generated +
FIRST_LAST_FRAME_VIDEO → VEO_FIRST_LAST (transition wins on overlap);
generated + approved recurring identity → VEO_REFERENCE; other generated →
VEO_FIRST_FRAME. VEO_* = workflow family, never a model (RM10 + source
scans). Modality caps bind first: CHART/TYPOGRAPHY/SPLIT_SCREEN ≤
EDITOR_MOTION with recorded reasons (chart animation can be HIGH motion and
still never Veo — RM3).

## 82. Visual Modality → Renderer Decision

Proven order per shot: modality (meaning) → cheapest adequate renderer →
capabilities. Conceptual chain from the fix text implemented and tested:
STATIC/REMOTION adequacy checked first; generated only on essential
evidence; then FIRST_LAST (A→B) / FIRST_FRAME (one frame) / REFERENCE
(identity). Baselines per §16 hold (MAP/TIMELINE/DIAGRAM/ANNOTATION/
MOTION_GRAPHIC → REMOTION; CHARACTER_MOMENT/RECONSTRUCTION depend on
semantic motion; METAPHOR cheapest-adequate; SPLIT_SCREEN deterministic
composition) as non-rigid defaults with semantic override. No Remotion
components implemented (§17: techniques only map to the mode).

## 83. Prompt Compiler Integration

Render-mode-driven lazy handoff, all PASS: STATIC_IMAGE → IMAGE only;
REMOTION_MOTION → IMAGE + motion metadata, no VIDEO; VEO_FIRST_FRAME →
IMAGE (start, when needed) + VIDEO; VEO_FIRST_LAST → IMAGE(S) + VIDEO;
VEO_REFERENCE → reference refs + VIDEO, IMAGE only when a start/reference
asset must first be created (text-based VEO → VIDEO only). Compiler still
refuses to infer targetKind (`PROMPT_TARGET_REQUIRED`); no 1G.4 file touched.

## 84. Provider / Model Boundary

No model IDs, no model matrix, no registry, no ranking, no doctor refresh,
no Flow settings mutation anywhere in FIX 1 (RM10 asserts decision text +
all 9 lib files clean after stripping guard patterns and VEO_* workflow
tokens). Official Flow docs re-verified 2026-10-03
(`support.google.com/flow/answer/16893917`, `.../16353334`): Text to Video,
Frames to Video (First), Frames to Video (First and Last),
Ingredients/References to Video — support differs by active model, hence
1G.5 emits required workflows/capabilities only; model choice is 1G.6.

## 85. Mixed 10-Shot Gate

Deterministic fixture, 10/10 READY, 10 distinct modalities, all validate:

| Shot | Beat Purpose | Visual Modality | Render Mode | Why | Result |
|---|---|---|---|---|---|
| 0001 | ESTABLISH | ATMOSPHERE | STATIC_IMAGE | mood/world, no motion | PASS |
| 0002 | DEMONSTRATE | MAP | REMOTION_MOTION | location/movement through space | PASS |
| 0003 | EVIDENCE_VISUAL | CHART | STATIC_IMAGE | number/trend | PASS |
| 0004 | DEMONSTRATE | DIAGRAM | REMOTION_MOTION | process/mechanism | PASS |
| 0005 | EVIDENCE_VISUAL | ANNOTATION | STATIC_IMAGE | evidence focus/labeling | PASS |
| 0006 | CONTRAST | SPLIT_SCREEN | REMOTION_MOTION | simultaneous side-by-side | PASS |
| 0007 | REVEAL | CHARACTER_MOMENT | VEO_FIRST_FRAME | essential interaction, turning point | PASS |
| 0008 | ESTABLISH | RECONSTRUCTION | STATIC_IMAGE | plausible reconstruction, still | PASS |
| 0009 | DETAIL | TYPOGRAPHY | STATIC_IMAGE | key phrase as visual | PASS |
| 0010 | PROCESS_STEP | TIMELINE | REMOTION_MOTION | historical sequence | PASS |

STATIC + REMOTION present, Veo exactly where earned (1/10), not all-Veo,
variation from narrative need (not manufactured counts).

## 86. FACTUAL / FICTION / HYBRID

FACTUAL numbers → CHART, never Veo; folklore → ATMOSPHERE/dramatized
modality with framing ≠ EVIDENCE_VISUAL (validator PASS, no promotion of
FOLKLORE); fiction horror mixed render (1/3 Veo) with zero claim refs;
HYBRID labels preserved. Memory warns on repeated modality patterns
(`MEMORY_ADVISORY` + `ANTI_TEMPLATE`) without forcing variation when
content genuinely repeats (all-MAP plan keeps MAP).

## 87. YouTube / TikTok

A MAP remains a MAP on both platforms (same modality asserted); only layout
adapts (`LANDSCAPE_OUTPUT` vs `PORTRAIT_OUTPUT` from canonical profiles).
No modality=Veo by platform, no fixed counts.

## 88. Persistence / Staleness

Same store (`production-decisions/<shotId>.json`, atomic, selection
preserved); schema extended with optional FIX 1 fields (version stays
1.0.0 — clean backward-compatible extension; old artifacts still validate).
`beatFingerprints` + `referenceAssetIds/Versions` recorded. Proven: beat
meaning change → modality stale; reference change → renderer-scoped
staleness with modality explicitly unaffected; model-availability change →
never stale (1G.6 boundary). Fingerprints cover modality + renderMode
(long-form double-run identical).

## 89. Regression

- New suite `tests/story/test-visual-story-grammar.js`: 158 passed, 0 failed
  (VG1–VG13, RM1–RM10, 10-shot gate, long-form, compiler, staleness,
  content classes, platform, memory).
- Old suite `tests/story/test-visual-motion-decision.js`: 136 passed,
  0 failed (Stage B intact).
- Targeted (SAC ON): story 12/12, pipeline/research/topic/providers/media/
  policy/qa/flow 0 failed, `validate-schemas` ALL PASSED (43 schemas),
  `check:repo-structure` OK.

## 90. SAC / Full Regression Gate

Operator manually set SAC=OFF (agent never toggles). `npm run
render:doctor` → `RENDER_DOCTOR_RESULT: READY` (remotion 4.0.529, preflights
OK). `npm test` → all 11 domains, **0 failed suite(s) in 263.9s**, incl. 18
remotion native suites (render smoke PASS, no skips) and both 1G.5 suites
(136 + 158). `check:repo-structure` → OK. `validate-schemas` → ALL PASSED.
Only test-adjacent commands ran in the SAC-off window.

## 91. Security Restoration

Agent toggled SAC automatically = NO; Defender/CodeIntegrity/registry/
exclusions untouched; no secrets persisted; Flow calls = 0, Veo generations
= 0, image generations = 0, credits = 0. Operator confirmed SAC = ON restored
after regression; no native suite rerun after restore (per boundary).

## 92. Final Corrected Verdict

```text
TASK_VALIDATION = PASS
PHASE 1G.5 — VISUAL STORY GRAMMAR + VISUAL / MOTION DECISION ENGINE = COMPLETE
NEXT = PHASE 1G.6 — PROVIDER / MODEL CAPABILITY REGISTRY
```

1G.6 is NOT implemented in this fix (no registry, discovery, selection,
ranking, or UI work). All §43 corrected criteria hold; no §44 PARTIAL
condition remains.