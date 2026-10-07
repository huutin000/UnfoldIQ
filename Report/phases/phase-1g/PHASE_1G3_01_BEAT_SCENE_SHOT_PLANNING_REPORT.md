# PHASE 1G.3 — PROMPT 01
# BEAT MAP + SCENE GRAPH + SHOT PLAN REPORT

Date: 2026-10-03
Roadmap: V6 — story structure → visual production structure

## 1. Status

```text
TASK_VALIDATION = PASS
PHASE 1G.3 — BEAT MAP / SCENE GRAPH / SHOT PLAN = COMPLETE
NEXT = read the current canonical Roadmap V6 and continue to the first
       unfinished post-1G.3 work unit
```

## 2. Entry Gate

```text
Report/PHASE_1G2_01_CREATIVE_MEMORY_REPORT.md:
  TASK_VALIDATION = PASS
  PHASE 1G.2 — PROMPT 01 = COMPLETE
  NEXT = PHASE 1G.3 — BEAT MAP / SCENE GRAPH / SHOT PLAN
```

Entry gate = PASS.

## 3. Scope / Non-Scope

Implemented: Story Beat Map, Scene Graph, Shot Plan (versioned contracts +
deterministic planners + validator + persistence + staleness chain + facade),
cross-platform metadata, FICTION/FACTUAL/HYBRID behavior, Creative Memory
advisory hook, provider-neutral exchange seams.

NOT implemented: Spoken Script Humanizer, Narration Director, TTS/voice,
captions, Prompt Compiler, Flow/Veo/Imagen prompt generation, any media
generation, Visual/Motion Decision Engine, provider selection, Remotion work,
rendering, publishing, analytics, 1G.4+. This phase creates STRUCTURE only.

## 4. Existing Capability Audit

| Existing file/module | Current responsibility | Decision | Reason |
|---|---|---|---|
| `schemas/scene-script.schema.json` (Stage 8) | scenes with MEASURED timings, narration, asset requirements — downstream production stage | keep, do not touch | consumes narrative structure later; owns real timing |
| `lib/duration-planner.js`, `lib/audio-timeline.js` | duration contract / audio timing owners | keep | V6 must not create a second timing source (§24) |
| `pipeline/render-plan.js`, `render-orchestrator.js`, `render-config.js` | Remotion frame timeline | keep | downstream; Remotion is not the source of truth |
| `core/VISUAL_BIBLE.md`, `schemas/continuity-registry.schema.json` | canonical identity concepts | reference-only | 1G.3 stores refs/hints only (§26) |
| beatMap / sceneGraph / shotPlan / parentSceneId / shotPurpose | **absent** | create | genuinely missing (classification C) |

Classification: **C** — canonical V6 Beat/Scene/Shot owners did not exist; the
media-era structures above are downstream consumers, not duplicates.

## 5. Canonical Owner Decision

One canonical owner directory:

```text
lib/story-structure/
  shared.js           deterministic normalization/role/bucket/purpose tables
  beat-map.js         buildBeatMap + beatShapeSignature
  scene-graph.js      buildSceneGraph (stable-turn cuts + exchange seam)
  shot-plan.js        buildShotPlan (role-run shots + exchange seam)
  validator.js        validateStructure (final authority)
  store.js            persistence/staleness/lock (projects/<id>/planning/)
  planning-facade.js  planStructure sequencer
  index.js            runStoryToVisualStructure + STATUS enum
```

Schemas: `schemas/beat-map.schema.json`, `scene-graph.schema.json`,
`shot-plan.schema.json` (registered in `validate-schemas.js`).

## 6. Source-of-Truth Hierarchy

```text
Story Draft = narrative source
Beat Map    = narrative meaning/progression (claimRefs inherited only)
Scene Graph = visual production unit structure
Shot Plan   = child visual views inside exactly one parent Scene
```

Shot Plan cannot rewrite story text, claims, evidence status, classification,
or scene narrative purpose — enforced structurally (planners only inherit) and
by the validator (`CLAIM_INVENTED`, `FICTION_FAKE_EVIDENCE`).

## 7. Beat Map Contract

`beatMapId (bm-<sha12>), version 1.0.0, projectId, platform, contentClass,
sourceStoryDraftRef {draftId, fingerprint}, sourceNarrativeBriefRef {briefId},
beats[], fingerprint (sha16), status, createdAt/updatedAt`. Beat: `beatId
(bt-<sha12> stable on projectId+section+textHash+role+index), order,
storySectionRef, narrativeRole, summary, claimRefs, classificationRefs,
importance, visualNeed, continuityHints, textHash`. Excerpts/refs only — no
draft bodies.

## 8. Beat Boundary Rules

Beats are meaningful narrative units: adjacent sentences with the SAME
deterministic narrative role merge into one beat; roles (QUESTION / SETUP /
EXPLANATION / EVIDENCE / REVEAL / CONTRAST / RESOLUTION / REFLECTION) come
from bounded marker heuristics (question form, dispute/evidence/reveal/
resolution markers). Punctuation alone never splits (§6).

## 9. Story Coverage

Every story section is covered by >= 1 beat; validator dimension
`storyCoverage` fails on any uncovered section (`STORY_SECTION_UNCOVERED`).
Beats referencing unknown sections fail (`BEAT_UNKNOWN_SECTION`).

## 10. Claim / Evidence Lineage

`claims(Beat/Scene/Shot) ⊆ claims(Story Draft)` — validators flag
`CLAIM_INVENTED` at every layer. No evidence status upgrades exist in the
structural layer at all (it carries only refs). Proven in B3.

## 11. FICTION Behavior

FICTION beats/shots carry zero claim refs; injected fake evidence fails
validation with `FICTION_FAKE_EVIDENCE` (B4). Structure tracks narrative
roles/mood/plot progression only.

## 12. HYBRID Behavior

HYBRID classification labels (FACT/FOLKLORE/…) pass through beats
unmodified; the validator blocks label upgrades (B5); scenes may dramatize
without promoting dramatization to fact.

## 13. Scene Graph Contract

`sceneGraphId (sg-<sha12>), sourceBeatMapRef {beatMapId, fingerprint},
sourceStoryDraftRef, scenes[], edges[], fingerprint, status`. Scene:
`sceneId (sc-<sha12>), order, beatIds[], storySectionRefs[], claimRefs[],
narrativePurpose, visualObjective (ORIENT|EXPLAIN|SHIFT|RESOLVE),
subjectRefs[], environmentRefs[], continuityGroup, stateBefore/stateAfter,
transitionReason, constraints[]`.

## 14. Scene Boundary Rules

Cuts follow only meaningful turns: a visual-objective bucket change that is
STABLE (the next beat agrees, or end-of-run). Single-beat bucket flips are
absorbed — this prevents sentence-churn scene explosion (proven: 6 sentences
in one bucket → 1 scene, S4; long-form 120 sentences → 30 scenes, L1).

## 15. Beat ↔ Scene Cardinality

Multiple beats → one scene (S2: same objective stays together); one beat →
multiple scenes ONLY via a justified provider-neutral exchange candidate,
accepted because the validator (not the provider) is the authority (S3). No
`beatCount == sceneCount` rule exists anywhere (§45).

## 16. Scene Continuity

`continuityGroup` carried on scenes and referenced by shots
(`continuityRefs`); framing/camera intents stay null unless supplied — a
camera change alone cannot alter world state (S5).

## 17. Shot Plan Contract

`shotPlanId (sp-<sha12>), sourceSceneGraphRef {sceneGraphId, fingerprint},
shots[], fingerprint, status`. Shot: `shotId (sh-<sha12>), parentSceneId
(mandatory), orderWithinScene, beatIds[], claimRefs[], shotPurpose,
visualObjective, subjectRefs[], actionIntent/framingIntent/cameraIntent
(null unless supplied), continuityRefs[], startState/endState,
relativeWeight`.

## 18. Shot Purpose / Visual Objective

Purposes derive deterministically from narrative roles (SETUP→ESTABLISH,
QUESTION→ORIENT, EXPLANATION→DEMONSTRATE, EVIDENCE→EVIDENCE_VISUAL,
REVEAL→REVEAL, CONTRAST→CONTRAST, RESOLUTION→RESOLUTION). No meaningless
SHOT_1/SHOT_2 labels.

## 19. Dynamic Shot Count

Shot count = distinct visual micro-objectives per scene (role runs), plus a
deterministic evidence split when a single-objective scene is entirely
claim-bearing. No magic per-scene counts (SH2: ratios vary naturally).

## 20. Beat ↔ Shot Cardinality

Multiple beats → one shot (SH3); one beat → multiple shots via justified
exchange candidate (SH4). No `beatCount == shotCount` or
`sceneCount × fixed` logic exists (§45).

## 21. Parent Scene Mapping

`parentSceneId` is an explicit validated field (regex-checked); position
inference is impossible — the validator fails `ORPHAN_SHOT` on unknown
parents (SH1/SH7).

## 22. Scene Coverage

Every scene has >= 1 shot; all shot beats resolve within the plan; complete
objective coverage validated (`SCENE_UNCOVERED`). No final timestamps are
invented: only `order` + `relativeWeight` (§23).

## 23. Timing Ownership

No second timing source created. Final measured timing remains owned by the
Stage-8 scene-script / duration-contract owners downstream; 1G.3 emits order +
relative weight only and marks final time alignment as downstream work.

## 24. Creative Memory Integration

Advisory only: `runStoryToVisualStructure` attaches
`memoryAdvisory {advisoryOnly: true, repetition, warnings}` from the 1G.2
owner when `options.creativeMemory` is present. M1/M2 prove memory changes
zero counts (beats/scenes/shots identical) and never forces splits.

## 25. Anti-Template Structural Check

Repetition signals surface via the 1G.2 owner (deterministic fingerprint
match — `HIGH_TEMPLATE_REUSE` in M1) with explainable warnings; no vector DB,
no paid embeddings, no AI-detector scores (§28).

## 26. YouTube / TikTok

Platform flows into all three artifacts as metadata (P1/P2); platform never
alters narrative structure truth or claim refs (asserted identical across
platform runs). No hardcoded "TikTok = N scenes" rules; composition metadata
left to platform profiles (§46) — no aspect strings inside planning fields.

## 27. Provider-Agnostic Boundary

No provider named anywhere in the owner. Exchange seams
(`beatExchange`/`shotExchange`) accept candidate groupings; the deterministic
validator is the final authority — invalid candidates are rejected
(`SCENE_CANDIDATE_INVALID` / `SHOT_CANDIDATE_INVALID`), never repaired (§30).

## 28. Visual Bible / Asset Boundary

subjectRefs/environmentRefs are empty reference slots; no canonical identity
duplicated or invented; continuity uses group refs only (§26).

## 29. Persistence

```text
projects/<projectId>/planning/beat-map.json
projects/<projectId>/planning/scene-graph.json
projects/<projectId>/planning/shot-plan.json
```

Atomic tmp+rename via the artifact store; versioned schemas; stable IDs;
explicit source refs; no partial valid artifact (writes are whole-file
atomic); nothing in repository root.

## 30. Lineage / Staleness

Dependency chain enforced by `checkStructureStaleness` + `markStale`:
Story Draft change → beatMap stale → sceneGraph stale → shotPlan stale; each
layer compares stored source refs/fingerprints (I3). Upstream evidence
artifacts are never invalidated — the layer writes only `planning/`.

## 31. Idempotency

Same canonical inputs → same beatMapId/sceneGraphId/shotPlanId/fingerprints
(B1/I1); re-persist overwrites atomically with identical content; no
duplicate artifacts.

## 32. Manual Override Contract

`GENERATED | REVIEWED | APPROVED | STALE` on every artifact. APPROVED
artifacts are never silently overwritten: re-planning returns
`PLANNING_LOCKED` unless `force: true` (I4). No UI built.

## 33. Validator

`validateStructure` returns `{valid, errors[], warnings[]}` with structured
entries across dimensions: schema validity, story coverage, beat coverage,
scene lineage (`ORPHAN_SCENE`), shot parent mapping (`ORPHAN_SHOT`), shot
coverage (`SCENE_UNCOVERED`), claim lineage (`CLAIM_INVENTED`),
FICTION boundary (`FICTION_FAKE_EVIDENCE`), duplicate shots
(`PATHOLOGICAL_DUPLICATE_SHOTS` error / `NEAR_DUPLICATE_SHOTS` warning, >=2
or >=4 matching signals). Serious invalid plans are never auto-corrected.

## 34. FACTUAL E2E

Real Prompt-04 story chain draft + synthetic documentary draft: full chain
VISUAL_STRUCTURE_READY, lineage intact, claims preserved (B2/B3, I-suite).

## 35. FICTION / Horror E2E

Horror fixture: coherent hook→tension→reveal→payoff beats, scene splits follow
tension/reveal turns, zero fake refs (B4), no mechanical repetition (S-suite
ratios).

## 36. HYBRID E2E

Folklore/documentary fixture: FACT + FOLKLORE labels preserved, no promotion,
plan READY (B5).

## 37. Long-Form Scaling

30-section fixture (~10 min): `sections=30 beats=120 scenes=30 shots=114,
planning 19ms`. No sentence=scene, no beat=shot, no explosion, bounded time.

## 38. Structural Duplicate Tests

SH5: adjacent same-scene shots matching >=4 signals → error; 2-3 signals →
warning; clean plans unflagged.

## 39. Backward Compatibility

Legacy project (story artifacts only, no planning/): no false staleness,
plans cleanly; APPROVED plans locked from silent overwrite (I4).

## 40. 1G.1 Regression

```text
node scripts/run-tests.js pipeline       → 0 failed suite(s) (incl. 1G.1 E2E, 122 assertions)
node scripts/run-tests.js research       → 0 failed suite(s)
node scripts/run-tests.js research-deep  → 0 failed suite(s)
```
(SAC = ON, non-render; no live provider path touched.)

## 41. 1G.2 Regression

```text
tests/pipeline/test-creative-memory.js (in pipeline domain) → PASS
lib/creative-memory.js reused as-is; no modification.
```

## 42. 1G.3 Targeted Tests

```text
tests/story/test-story-structure.js
  25 tests / 100 assertions — RESULT: ALL TESTS PASSED
  B1-B5 beats, S1-S6 scenes, SH1-SH7 shots, P1-P2 platforms,
  M1-M2 memory advisory, I1-I4 integration, L1 long-form scaling
```

## 43. Schema / Structure Checks

```text
node scripts/checks/validate-schemas.js → ALL PASS (3 new schemas registered)
npm run check:repo-structure            → REPOSITORY_STRUCTURE_OK
node scripts/run-tests.js story         → 0 failed suite(s)
node scripts/run-tests.js topic         → 0 failed suite(s)
```

## 44. SAC / Render Regression Gate

1G.3 functional work needed no rendering; SAC stayed ON throughout
implementation and targeted tests. The final repository-wide regression was
executed inside an operator-controlled SAC-off window:

```text
operator manually set SAC = OFF        (confirmed in-session)
agent toggled SAC automatically        = NO
npm run render:doctor                  → RENDER_DOCTOR_RESULT: READY
```

## 45. Full Repository Regression

Executed while SAC was manually OFF and render:doctor = READY:

| Command | Expected | Actual | Result |
|---|---|---|---|
| npm run render:doctor | READY | READY (ffmpeg/ffprobe/remotion.exe OK, compositor 4.0.529) | PASS |
| npm test | 0 failed suites | 0 failed suites — flow, media, pipeline, policy, providers, qa, remotion, research, research-deep, story, topic (257.7s, zero FAIL lines verified) | PASS |
| npm run check:repo-structure | REPOSITORY_STRUCTURE_OK | REPOSITORY_STRUCTURE_OK | PASS |
| node scripts/checks/validate-schemas.js | ALL PASS | ALL TESTS PASSED | PASS |

No skipped Remotion tests. No environmental PASS.

## 46. Security Restoration

```text
operator manually restored SAC = ON    (confirmed in-session)
no native Remotion rerun after restoration
SAC toggled automatically by agent     = NO
Defender changed                       = NO
security exclusion added               = NO
Code Integrity policy modified         = NO
registry bypass                        = NO
secrets leaked                         = NO
provider/API secret stored             = NO
```

## 47. Files Created

```text
lib/story-structure/shared.js
lib/story-structure/beat-map.js
lib/story-structure/scene-graph.js
lib/story-structure/shot-plan.js
lib/story-structure/validator.js
lib/story-structure/store.js
lib/story-structure/planning-facade.js
lib/story-structure/index.js
schemas/beat-map.schema.json
schemas/scene-graph.schema.json
schemas/shot-plan.schema.json
tests/story/test-story-structure.js
Report/PHASE_1G3_01_BEAT_SCENE_SHOT_PLANNING_REPORT.md
```

## 48. Files Modified

```text
scripts/checks/validate-schemas.js (registered the 3 new schemas)
```

## 49. Files Deleted

```text
sp-debug.tmp.js (temporary debug artifact, removed immediately)
```

## 50. Known Limitations

- Scene/shot boundaries are deterministic heuristics over the story draft;
  a later semantic planner may use the exchange seams without changing the
  validator contract.
- subjectRefs/environmentRefs are empty reference slots until a canonical
  entity/asset registry phase owns them.
- No final timing (downstream owner: Stage-8 scene-script + duration
  contract).
- No provider prompt text is produced anywhere (Prompt Compiler is 1G.4).

## 51. Remaining Issues

```text
(none — all PASS criteria met, including the SAC-gated full regression and
 operator-confirmed SAC restoration)
```

## 52. Final Conclusion

```text
TASK_VALIDATION = PASS
PHASE 1G.3 — BEAT MAP / SCENE GRAPH / SHOT PLAN = COMPLETE
NEXT = read the current canonical Roadmap V6 and continue to the first
       unfinished post-1G.3 work unit (do not infer/reorder the roadmap)
```
