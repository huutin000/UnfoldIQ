# PHASE 1G.4 — PROMPT 01
# PROMPT COMPILER REPORT

Date: 2026-10-03
Roadmap: V6 — structured visual intent → provider-ready prompt package

## 1. Status

```text
TASK_VALIDATION = PASS
PHASE 1G.4 — PROMPT COMPILER = COMPLETE
NEXT = PHASE 1G.5 — VISUAL / MOTION DECISION ENGINE
```

## 2. Entry Gate

```text
Report/PHASE_1G3_01_BEAT_SCENE_SHOT_PLANNING_REPORT.md:
  TASK_VALIDATION = PASS
  PHASE 1G.3 — BEAT MAP / SCENE GRAPH / SHOT PLAN = COMPLETE
```

Entry gate = PASS.

## 3. Scope / Non-Scope

Implemented: canonical Prompt Spec, reference-first continuity locks, IMAGE +
VIDEO generic adapters (lazy targetKind), deterministic validator, Prompt
Package persistence/status/staleness/targeted reference invalidation, prompt
injection + secret firewalls, budget handling, Creative Memory advisory hook.

NOT implemented: media-type decision (IMAGE vs VIDEO belongs to 1G.5),
model selection, Flow/Veo/Imagen generation, credits, Remotion work, TTS/
captions/humanizer, 1G.5+. The compiler NEVER infers targetKind — the caller
always supplies it (tests use both explicitly; this is not auto-selection).

## 4. Existing Capability Audit

| Module | Responsibility | Decision | Why |
|---|---|---|---|
| `flow-companion/extension` PromptWriter | types prompts into the Google Flow UI (browser automation) | leave alone | different concern: UI insertion, not compilation |
| `lib/research-story/*` | narrative/story artifacts | reuse as inputs | canonical upstream sources |
| `lib/story-structure/*` | Beat/Scene/Shot planning | reuse as inputs | canonical upstream sources |
| prompt compiler / builder / visual prompt / motion blueprint / continuity lock | **absent** | create | classification **D** — genuinely missing |

## 5. Current Official Provider Guidance Check

Checked 2026-10-03 against current official documentation:

- `ai.google.dev/gemini-api/docs/image-generation` (Gemini image generation):
  prompt templates emphasize shot type, subject, setting, lighting, camera
  angle, lens; aspect ratio is a **config parameter** (e.g. 16:9, 9:16), not
  prose; reference images supported (counts vary by model); no documented
  negative-prompt parameter.
- `ai.google.dev/gemini-api/docs/veo` (Veo prompt guide): elements = subject,
  action, style, camera positioning/motion (optional), composition (optional),
  focus/lens effects (optional), ambiance (optional); image-to-video uses the
  input image as the **first frame** and reference images preserve
  appearance; `aspect_ratio` parameter 16:9/9:16; limitations documented
  (duration/resolution coupling, safety filters, SynthID).

Behavior adopted: element ordering (critical constraints first, then
subject/action/context/style/camera/composition/focus/ambiance), aspect ratio
in generation metadata (config semantics), reference-frame-first motion
prompts (animate the established visual; appearance locked), mustAvoid
compiled only when relevant (no universal negative boilerplate).

Intentionally NOT hard-coded: model labels (Nano Banana / Veo 3.1 / Omni
Flash etc.), reference-image counts, resolutions, EU/UK personGeneration
policies — all adapter/runtime-config concerns.

## 6. Canonical Owner Decision

One owner: `lib/prompt-compiler/` (shared, prompt-spec, reference-resolver,
continuity, compiler, validator, store, adapters/image-generic,
adapters/video-generic, index). No ImagePromptService/VeoPromptService/
FlowPromptService/ShotPromptService fragmentation.

## 7. Prompt Spec Contract

Provider-neutral spec (`promptSpecId = ps-<sha12>` stable over canonical
inputs): sourceRefs (shotId/sceneId/beatIds/storySectionRefs/draftRef/
beatMapFingerprint/sourceShotFingerprint/sourceSceneFingerprint),
referenceRefs, continuityRefs, subject {refs, descriptor, referenceFirst},
action, environment, composition, camera, focusLens, lightingAmbiance, style,
environmentMotion, historical/scientificConstraints, narrativeIntent,
mustPreserve[], mustAvoid[], claimRefs, classificationRefs, fingerprint,
status. Cinematic fields stay null unless canonically supplied (§19, §34).

## 8. Source Lineage

Shot → parent Scene → Beats → Story Draft enforced at build (orphan shot →
`ORPHAN_SHOT`) and by validator (`LINEAGE_INCOMPLETE`,
`LINEAGE_FINGERPRINTS_MISSING`). Reference/continuity/platform refs recorded
with versions for deterministic stale detection.

## 9. Evidence Firewall

`facts(prompt) ⊆ facts(Story/Evidence/Scene intent)`: claimRefs are refs only
and validated against canonical beats (`CLAIM_INVENTED` otherwise); the
compiler adds no historical/scientific facts — constraint fields pass through
from canonical inputs verbatim.

## 10. FICTION Behavior

FICTION packages carry zero claim/source/evidence refs (`FICTION_FAKE_EVIDENCE`
otherwise); descriptive horror/mood content is allowed inside the canonical
scene intent (E2).

## 11. HYBRID Behavior

FACT/FOLKLORE/TESTIMONY/SPECULATION/FICTIONALIZED_ELEMENT labels flow into the
spec; any certainty phrasing ("verified fact", "documented fact",
"historically proven") in the compiled text while carrying non-FACT labels →
`CLASSIFICATION_PROMOTED` error (E4). Historical uncertainty is retained
verbatim in HISTORICAL CONSTRAINTS (E5).

## 12. Reference-First Continuity

Reference identity wins: locked subjects are referenced by assetId
(`established character [CHAR_X]`) and their identity text is NOT re-described
(I2/I6). Environment/object/style refs included as refs only (I5).

## 13. Character Identity Locks

Lockable dimensions: identity, wardrobe, ageSpecies, hairFace, style,
environment, timeOfDayWorldState. Compile-time override conflicts →
`CONTINUITY_CONFLICT` (blocked) naming dimension + locked value (C2); matching
overrides accepted (C4); camera-only changes never mutate identity (C6).

## 14. Image Prompt Compiler

Sections: CRITICAL (locks + historical/scientific constraints) → SUBJECT →
ACTION → ENVIRONMENT → COMPOSITION → CAMERA → LIGHTING → STYLE → AVOID.
Object-safe camera rendering. No model selection, no generation.

## 15. Video Prompt Compiler

Sections: CRITICAL → SUBJECT → ACTION → CAMERA MOTION (only when canonical;
static-position phrasing permitted) → ENVIRONMENT MOTION → TEMPORAL
PROGRESSION (startState → endState) → COMPOSITION → FOCUS/LENS → AMBIANCE →
STYLE → AVOID. Absent cinematic fields are never hallucinated (V2).

## 16. Image-to-Video Continuity

With a FRAME/CHARACTER reference: requiredCapabilities include IMAGE_TO_VIDEO;
subject = "animate the established visual; appearance already locked by the
reference"; STYLE section is dropped (style locked by reference); mustPreserve
includes referenceFrameAppearance/characterIdentity (V5/V6, C5).

## 17. Prompt Quality Validator

Structured `{valid, errors[], warnings[]}` across: target fields, lineage,
identity consistency, reference validity, claim/evidence safety, FICTION/
HYBRID safety, duplicates, budget, injection/secret safety. No scalar score.

## 18. Provider Capability / Length Handling

`requiredCapabilities` emitted (IMAGE_GENERATION, IMAGE_REFERENCE,
VIDEO_GENERATION, IMAGE_TO_VIDEO, PORTRAIT_OUTPUT, LANDSCAPE_OUTPUT) — never
model names. Budgets are per-adapter (IMAGE 1600 / VIDEO 2000 defaults,
caller-overridable); shortening preserves priority (identity/continuity >
factual constraints > subject/action/environment > objective > composition/
camera > aesthetics); impossible budgets fail with
`BUDGET_EXCEEDED_REQUIRED_LOSS` instead of losing required content (B1-B4).

## 19. Aspect Ratio / Platform Boundary

Platform composition is consumed from `platforms/<platform>/PROFILE.yaml`
(the canonical owner) via `readPlatformComposition` — youtube 16:9 landscape,
tiktok 9:16 portrait — carried in generationMetadata, never duplicated as a
second platform map and never compiled as prose.

## 20. Negative Constraints

mustAvoid[] compiled only from canonical/analyst-relevant constraints
(bounded ≤8); instruction-flavored content is rejected outright (§24, §28).

## 21. Historical / Scientific Constraints

Pass through verbatim into CRITICAL sections; uncertainty words retained;
validator blocks certainty promotion (§25, E5).

## 22. Creative Memory Integration

Advisory only: memory text never enters the compiled prompt; explainable
warnings attached as `memoryAdvisory {advisoryOnly: true}` (S1). Memory never
changes identity, truth, structure, or target.

## 23. Anti-Template Prompt Check

Deterministic identity-repetition check (identity phrase appears exactly once;
`IDENTITY_REPEATED` warning otherwise) + duplicate-section detection; no paid
embeddings, no AI-detector claims (§27).

## 24. Prompt Injection Firewall

Untrusted text (memory, freeform imports, retrieved content) remains data;
instruction-flavored patterns in compiled text → `PROMPT_INJECTION_TEXT`
error (package BLOCKED); no eval/Function/vm/child_process anywhere in the
owner (statically asserted, S4/S5); secrets rejected via `SECRET_SUSPECTED`
(S3).

## 25. Prompt Package Contract

`promptPackageId (pp-<sha12> stable over spec fingerprint + targetKind +
adapter version)`, version, projectId, sceneId, shotId, targetKind,
sourceRefs, referenceRefs, continuityLockRef, promptSpec, compiledPrompt,
generationMetadata, requiredCapabilities, validation, fingerprint, status.
No credentials.

## 26. Persistence

`projects/<projectId>/prompts/<shotId>/<targetKind>.json`, atomic tmp+rename,
versioned schema (`prompt-package.schema.json` registered in
validate-schemas.js), stable IDs, no root clutter.

## 27. Idempotency

Same canonical inputs + adapter version → same spec fingerprint, package ID,
compiled text (I7/V10/golden). No random regeneration.

## 28. Staleness / Targeted Invalidation

Per-package source fingerprints enable TARGETED staleness: changed shot →
only that shot's packages stale; changed parent scene → its shots' packages;
changed reference asset version → only referencing packages
(`invalidateByReference`, verified: 1 invalidated, sibling untouched);
platform context change → affected packages; adapter version change →
recompile required. Research evidence / Story Draft / unrelated scenes are
never invalidated.

## 29. Manual Edit / Lock Contract

`DRAFT | VALID | APPROVED | STALE | BLOCKED`. APPROVED packages are locked
(`PROMPT_LOCKED`) unless explicit `force` recompile (verified). No UI.

## 30. Provider-Neutral Core

Canonical spec holds zero provider assumptions; adapter text never leaks into
Shot Plan / Scene Graph / Story Draft / Visual Bible.

## 31. Flow Boundary

No Flow automation in this phase (opening, modes, model choice, paste,
generate, download all remain downstream Flow Companion concerns).

## 32. Veo Boundary

A Veo-compatible VIDEO_GENERIC prompt can be compiled when the caller
requests it, but the compiler never decides that a Shot uses Veo (1G.5 owns
that decision).

## 33. Remotion Boundary

No Veo-vs-Remotion decision compiled; VIDEO targets only on explicit caller
request (§39-§40).

## 34-38. Test Matrices (actual outcomes)

IMAGE matrix: factual historical (IMAGE, refs, VALID), fiction horror
(IMAGE, zero claims, VALID), hybrid folklore (IMAGE tiktok, labels kept,
VALID), locked recurring character (reference-first, identity once),
reference-frame motion (VIDEO, IMAGE_TO_VIDEO), stale source (blocked/stale).

| Test | Assertions | Result |
|---|---|---|
| I1/I3/I4 subject+style present, no invented facts, platform metadata canonical | 4 | PASS |
| I2/I5 reference-first identity by asset ID + refs | 4 | PASS |
| I6/I7 no identity boilerplate duplication; deterministic | 4 | PASS |
| I8 targeted per-shot staleness | 4 | PASS |
| V1-V4 subject/action, camera only when canonical, composition, ambiance | 4 | PASS |
| V5/V6 reference-frame continuity, no style/identity redefinition | 3 | PASS |
| V7/V8 environment motion + temporal progression | 2 | PASS |
| V9/V10 must-preserve survives shortening; deterministic | 4 | PASS |
| E1/E2 claims as refs; fiction zero fake evidence | 4 | PASS |
| E3/E4/E5 HYBRID labels; certainty promotion rejected; uncertainty retained | 5 | PASS |
| C1/C3/C4 adjacent-shot refs; environment continuity; allowed override | 4 | PASS |
| C2 wardrobe conflict rejected | 2 | PASS |
| C5/C6 reference-frame appearance; camera never mutates identity | 3 | PASS |
| S1/S2 injection stays data; freeform rejected | 4 | PASS |
| S3/S4/S5 secrets rejected; no eval/vm/shell paths | 12 | PASS |
| B1-B4 budgets: per-adapter, critical survival, aesthetic-first reduction, hard-fail | 5 | PASS |
| Long-form scaling | 4 | PASS |
| Golden fixture | 3 | PASS |
| Targeted reference invalidation (§34) | 3 | PASS |
| Manual lock (§35) | 3 | PASS |

## 39. Prompt Budget Tests

See B1-B4 above: adapter-specific budgets; shortening priority
identity/factual → subject/action/environment → objective → composition/
camera → aesthetics; validation fails when required information would be lost.

## 40. Long-Form Scaling

1G.3 long-form plan (30 sections → 114 shots): 114/114 packages compiled,
0 blocked, ~775ms, all distinct fingerprints, deterministic.

## 41. Golden Fixtures

Structured (not full-string) assertions: exact section ordering
`SUBJECT > COMPOSITION > CAMERA > LIGHTING > STYLE`, critical-before-flavor
ordering, identity text stability, evidence-drain absence, cross-run
fingerprint equality.

## 42. 1G.1 Regression

```text
node scripts/run-tests.js pipeline → 0 failed (incl. 1G.1 E2E, 122 assertions)
node scripts/run-tests.js research → 0 failed
node scripts/run-tests.js research-deep → 0 failed
```
(SAC = ON; no live provider path changed; no API spend.)

## 43. 1G.2 Regression

`tests/pipeline/test-creative-memory.js` (pipeline domain) → PASS;
`lib/creative-memory.js` unmodified.

## 44. 1G.3 Regression

`node scripts/run-tests.js story` → 0 failed (incl. test-story-structure.js,
100 assertions); story-structure modules unmodified.

## 45. 1G.4 Targeted Tests

```text
tests/story/test-prompt-compiler.js
  20 tests / 93 assertions — RESULT: ALL TESTS PASSED
```

## 46. Schema / Structure Checks

```text
node scripts/checks/validate-schemas.js → ALL PASS (prompt-package registered)
npm run check:repo-structure            → REPOSITORY_STRUCTURE_OK
node scripts/run-tests.js topic         → 0 failed
```

## 47. SAC / Render Regression Gate

1G.4 functional work needed no rendering; SAC stayed ON throughout
implementation and targeted tests. The final repository-wide regression was
executed inside an operator-controlled SAC-off window:

```text
operator manually set SAC = OFF        (confirmed in-session)
agent toggled SAC automatically        = NO
npm run render:doctor                  → RENDER_DOCTOR_RESULT: READY
```

## 48. Full Repository Regression

Executed while SAC was manually OFF and render:doctor = READY:

| Command | Expected | Actual | Result |
|---|---|---|---|
| npm run render:doctor | READY | READY (ffmpeg/ffprobe/remotion.exe OK, compositor 4.0.529) | PASS |
| npm test | 0 failed suites | 0 failed suites — flow, media, pipeline, policy, providers, qa, remotion, research, research-deep, story, topic (247.9s, zero FAIL lines verified) | PASS |
| npm run check:repo-structure | REPOSITORY_STRUCTURE_OK | REPOSITORY_STRUCTURE_OK | PASS |
| node scripts/checks/validate-schemas.js | ALL PASS | ALL TESTS PASSED | PASS |

No skipped Remotion tests. No environmental PASS.

## 49. Security Restoration

```text
operator manually restored SAC = ON    (confirmed in-session)
no native Remotion rerun after restoration
SAC toggled automatically by agent     = NO
Defender changed                       = NO
security exclusion added               = NO
Code Integrity policy modified         = NO
registry bypass                        = NO
provider secrets persisted             = NO
prompt content executed as code        = NO
```

## 50. Files Created

```text
lib/prompt-compiler/shared.js
lib/prompt-compiler/prompt-spec.js
lib/prompt-compiler/reference-resolver.js
lib/prompt-compiler/continuity.js
lib/prompt-compiler/compiler.js
lib/prompt-compiler/validator.js
lib/prompt-compiler/store.js
lib/prompt-compiler/index.js
lib/prompt-compiler/adapters/image-generic.js
lib/prompt-compiler/adapters/video-generic.js
schemas/prompt-package.schema.json
tests/story/test-prompt-compiler.js
Report/PHASE_1G4_01_PROMPT_COMPILER_REPORT.md
```

## 51. Files Modified

```text
scripts/checks/validate-schemas.js (registered prompt-package.schema.json)
```

## 52. Files Deleted

```text
(none)
```

## 53. Known Limitations

- IMAGE/VIDEO generic adapters only; FLOW_IMAGE/VEO_VIDEO-specific adapters
  deferred until the runtime benefits from them (permitted, not required).
- Reference assets are caller-supplied canonical sets; no asset registry
  owner exists yet (store only refs/versions).
- No semantic similarity for anti-template checks (deterministic only, by
  design).
- generationMetadata carries aspect/orientation; final output size/codec
  decisions belong downstream.

## 54. Remaining Issues

```text
(none — all PASS criteria met, including the SAC-gated full regression and
 operator-confirmed SAC restoration)
```

## 55. Final Conclusion

```text
TASK_VALIDATION = PASS
PHASE 1G.4 — PROMPT COMPILER = COMPLETE
NEXT = PHASE 1G.5 — VISUAL / MOTION DECISION ENGINE
```
