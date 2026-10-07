# PHASE 1G.11 — STRUCTURAL / SEMANTIC / VISUAL FACTUALITY / CONTINUITY QA REPORT

Date: 2026-10-04
Roadmap: V6 — Scope Frozen
Previous gates: 1G.9 COMPLETE, 1G.10 COMPLETE

```text
TASK_VALIDATION = PASS

PHASE 1G.11 — STRUCTURAL / SEMANTIC / VISUAL FACTUALITY / CONTINUITY QA = COMPLETE

STRUCTURAL_QA = VERIFIED
SEMANTIC_QA = VERIFIED
VISUAL_FACTUALITY_QA = VERIFIED
CONTINUITY_QA = VERIFIED
TEMPORAL_MOTION_INTEGRITY_QA = VERIFIED

WRONG_CHARACTER_REJECTION = VERIFIED
WRONG_OUTFIT_REJECTION = VERIFIED
WRONG_LOCATION_REJECTION = VERIFIED
WRONG_FACTUAL_VISUAL_REJECTION = VERIFIED

TIMELINE_ELIGIBILITY_GATE = VERIFIED
TARGETED_REPAIR = VERIFIED
QA_STALENESS = VERIFIED
ASSET_LIBRARY_INTEGRATION = VERIFIED

NEW_MEDIA_GENERATIONS = 0
FLOW_CREDITS_SPENT = 0

NEXT = PHASE 1G.12 — VEO REAL E2E
```

## 1. Status

One canonical QA owner (`lib/asset-qa/`, 11 modules) implements the four
Roadmap V6 layers independently plus asset-level temporal/motion integrity
inside those layers (no fifth top-level subsystem). All mandatory negative
injections (N1–N4, F1/F2, MO-negatives) are rejected before timeline
assembly. New suites: 170 asserts, all green. Full `npm test`: 0 failed
(13 domains, 297.4s). `check:repo-structure` OK. Extension suite untouched
(extension code not modified).

## 2. Entry Gate

`Report/PHASE_1G9_1G10_AGENT_INSTRUCTIONS_ASSET_LIBRARY_REPORT.md` reads
`TASK_VALIDATION = PASS`, `PHASE 1G.9 = COMPLETE`, `PHASE 1G.10 = COMPLETE`
(§60–61). Live gate: `LIVE_FLOW_SYNC = VERIFIED_HANDS_FREE`
(sy-8e0ac1726008), `LIVE_FLOW_READBACK = VERIFIED`,
`OPERATOR_TEXT_ENTRY = 0` (§21). Asset gates: `ASSET_DEDUP`,
`ASSET_LINEAGE`, `REFERENCE_LOCK + APPROVED_ASSET_IMMUTABILITY`,
`AGENT_INSTRUCTIONS_VERSION_LINKAGE` (all §60, proven live by
`tests/flow/test-asset-library.js` 41 asserts, re-green below §54).
Gate maps 1:1 onto the §5 contract (`LIVE_FLOW_SYNC` =
`LIVE_FLOW_INSTRUCTIONS_APPLY`, `LIVE_FLOW_READBACK` =
`LIVE_FLOW_INSTRUCTIONS_READBACK/PERSISTENCE`). No `ENTRY_GATE_FAIL`.

## 3. Roadmap Contract

Canonical flow implemented in `lib/asset-qa/index.js#evaluateAssetQa`:
`asset → structural → semantic → factuality → continuity → aggregate QA →
READY_FOR_TIMELINE | REVIEW_REQUIRED | REJECTED`. Roadmap gates
(wrong character / outfit / location / factual visual) are injected through
the real path and rejected before timeline assembly (§§41–44). 1G.12 not
started (§52 scope).

## 4. Repository QA Audit

| Component | Class | Disposition |
|---|---|---|
| `lib/media-probe.js` (ffprobe/PNG/WAV measurement) | **A** | reused as-is for decode/dims/duration measurement |
| `lib/asset-library/` (dedup, lineage, locks, instruction link) | **A** | reused read-only; zero modifications (1G.10 green) |
| `tests/fixtures/make-png.js` (deterministic PNG builder) | **A** | reused for byte-level fixtures |
| `lib/continuity-check.js` (registry structural invariants CT1–CT8) | **B** | left alone; per-asset visual continuity is new in `asset-qa/continuity.js` |
| `lib/visual-motion/*` (pre-generation motion decision, 1G.5) | **C** | boundary respected; never used as post-hoc QA |
| `qa/` frame-sampler/contact-sheet/visual-qa (render QA) | **C** | different stage; untouched |
| per-asset structural/semantic/factuality/continuity QA owner | **D** | created: `lib/asset-qa/` |
| `asset-qa-result` schema + timeline-eligibility boundary | **D** | created |

No second asset registry, no second scene/shot schema, no parallel
continuity Bible. Structural/media probing reused; Bibles and evidence
truth consumed as inputs, never duplicated; 1G.10 asset IDs/hashes reused.

## 5. Canonical QA Owner

`lib/asset-qa/` = `shared` (statuses, evidence, fingerprint/staleness) +
`structural` + `semantic` + `factuality` + `continuity` + `motion`
(provider-neutral helper, NOT a layer) + `aggregate` + `gate`
(timeline-gate) + `store` + `validator` + `index` (facade).

## 6. Scope/Non-Scope

In scope: decode/dims/duration/aspect/corruption/file-type, scene/subject/
action/text/composition/media-type, asset-level motion integrity, all 11
factuality domains, all continuity domains, evidence, aggregate policy,
timeline gate, fingerprint/staleness, targeted repair. Explicitly deferred
(per §2B, not omitted): voice/pronunciation/speech-rate/performance,
music/SFX/mix/loudness/clipping, caption alignment/readability/flicker,
editing rhythm/transition grammar, A/V sync, final-render QC, creative
pacing/originality (canonical owners: Phase 2/3/4/6/7, 1G.12, 1H.5).

## 7. QA Result Contract

`store.js#buildQaResult` emits `AssetQaResult` with `qaResultId`,
`projectId`, `assetId`, `assetHash`, `shotId`, `sceneId`,
`qaPolicyVersion`, `expectedContextFingerprint`, four layers, `aggregate`
(status/severity/eligibility/failed+warning+unknown layers/reasons/
recommendation), `sourceRefs[]`, `evidenceRefs[]`, `evidence[]`,
`evaluatedAt`. `qaResultId` is content-deterministic (volatile
evidenceIds/evaluatedAt excluded from the seed). Asset bytes never mutated.

## 8. Status/Severity

Statuses `PASS | FAIL | WARN | UNKNOWN | NOT_APPLICABLE`; severities
`INFO | WARNING | ERROR | BLOCKER` (`shared.js`). UNKNOWN never collapses
into PASS (enforced in every layer + validator + gate). Critical UNKNOWN
(`blocking:true`) forces `REVIEW_REQUIRED` and `timelineEligible=false`.

## 9. Structural QA

`structural.js#evaluateStructural`: file-type (magic table PNG/JPEG/GIF/
WEBP/MP4/WEBM/WAV + extension/signature cross-check), real decode via
`lib/media-probe`, media-type cross-check (`WRONG_MEDIA_TYPE`),
dimensions, aspect, duration, temporal-stream/truncation, unintended freeze,
zero-motion-when-required. Corruption is a `FAIL (CORRUPT_MEDIA)`, never a
crash. Unobservable checks are UNKNOWN, never PASS.

## 10. Structural Media Contract

`.jpg` over PNG bytes → `FAIL`; `.jpg/.jpeg` map to the `jpeg` signature
kind. Aspect compares actual measured ratio against the upstream 1G.7
expectation (2% tolerance); nothing hard-codes 16:9. Duration requires
`>0` and declared-length ± tolerance (default 500ms); provider duration
tables not copied. Video temporal checks consume supplied `streamMeta`;
images get `NOT_APPLICABLE`.

## 11. Semantic Expectation

Built by the caller from Story/Scene/Shot plans, Prompt Compiler, 1G.5
decision, 1G.7 adaptation: `sceneId/shotId/expectedSubject[]/
expectedAction[]/expectedEnvironment[]/expectedMediaType/
expectedComposition/textPolicy/expectedMotion`. The layer never infers
intent from the asset itself.

## 12. Semantic QA

`semantic.js`: scene, subject, action, motion intent (via motion helper),
accidental text, composition usability, media type. Null/absent observation
→ critical UNKNOWN (scene/subject/action/media-type), never PASS.

## 13. Text/Composition

Unexpected text/logo/watermark/UI artifact → `FAIL`, except
`TYPOGRAPHY` modality or `allowText` (SE7 proven). Composition is
task-usability only (subject cropped / key action hidden / safe area
missing → `FAIL`); generic beauty is never scored; pure platform reframe
(`reframedOnly`) never fails (SE10).

## 13A. Temporal / Motion Integrity

`motion.js` implements the §23A `MotionObservation` contract
(source ∈ `FRAME_SAMPLE | PROVIDER_METADATA | STATE_COMPARISON |
MANUAL_REVIEW`, direction/completion/gesture/trajectory/opening/ending/
freeze/confidence). Structural layer: freeze/truncation/zero-motion.
Semantic layer: action-occurs/direction/completion. Continuity layer:
direction/gesture/trajectory/start/end/state-coherence. No fake
observations (MO14); no Phase-3 editing-rhythm scoring (MO16 proven by
check-name audit); no timeline-pacing inference; no shot redesign.

## 14. Factuality Applicability

`FACTUAL` → required; `HYBRID` → factual assertions only (claim-less
HYBRID shot → `NOT_APPLICABLE`); `FICTION` → `NOT_APPLICABLE` unless
`hasFactualElements`; `UNKNOWN` → blocking UNKNOWN / `REVIEW_REQUIRED`.

## 15. Factual Expectation

`FactualExpectation` carries `claimIds[]/evidenceIds[]` plus the 11 domain
slots. Factual PASS requires provenance: a match without `claimIds[]+
evidenceIds[]` → UNKNOWN, and `validator.js` rejects provenance-free PASS
(`FACTUAL_PROVENANCE_MISSING`). No unsupported facts are evaluated.

## 16. Period/Location/Entity

`period`, `location`, `speciesPersonObject` each `PASS | FAIL | UNKNOWN |
NOT_APPLICABLE` with structured evidence. FA5/FA6/FA7 proven; F2
(leopard→lion) proven FAIL.

## 17. Clothing/Architecture/Tools

`clothing`, `architecture`, `toolsEquipment` per-domain PASS/FAIL.
FA8/FA9/FA10 proven.

## 18. Map Geography

`mapGeography` checks region/route/labels/direction from structured map
data (FA11 proven). Decorative art is never treated as exact geography.

## 19. Chart Direction

`chartDirection` mismatch (decline claim vs rising visual) → `FAIL`
(F1/FA12 proven). Structured chart source/data preferred when supplied.

## 20. Numbers/Labels

`numbersLabels` checks value/unit/sign/entity-label mapping (FA13/FA14
proven). Unreliably observed values → `UNKNOWN / REVIEW_REQUIRED`, not PASS
(FA17 proven).

## 21. Timeline Order

`timelineOrder` checks event/date order and label-to-event mapping;
source `A→B` vs visual `B→A` → `FAIL` (FA15 proven).

## 22. On-screen Factual Text

`onScreenFactualText` verified against source-backed strings; unsupported
factual text → `FAIL` (FA16 proven).

## 23. Continuity Sources

Consumed per evaluation: Character/World/Visual Bible versions, locked
1G.10 references, `AgentInstructionSet` version, previous approved shot
state, scene continuity state (`continuityStrictness`). Newest asset never
self-certifies: locked reference without observation → UNKNOWN (proven).

## 24. Character Identity

Expectations arrive per-project (fixture `HOST_A` in tests stands in for a
Bible entry). Nothing hard-codes mascot hair/outfit/trousers in
`lib/asset-qa/` (verified: no literal `mustard`/`HOST_` outside tests).

## 25. Hair/Clothing

Hair mutation → `FAIL` (CO4). Unapproved outfit change → `FAIL` (CO5/N2);
explicit approved change matched → `PASS` (CO6 + N2 positive proven).

## 26. Location/Props

Unexpected location replacement → `FAIL/WRONG_LOCATION` (CO7/N3);
declared `sceneTransitionTo` matched → `PASS` (CO8). Only tracked
`requiredProps[]` block (locked notebook vanishes → FAIL, CO9); irrelevant
background variation → non-blocker (CO10).

## 27. Time of Day

Same-moment day→night without transition → `FAIL` (CO11); declared
`timeJumpDeclared` → `PASS` (CO12).

## 28. Palette/Style

Compared against Visual Bible/instructions/reference; genuine mutation →
`WARN` non-blocking (CO13); platform crop/reframe alone → `PASS` (CO14).

## 29. Start/End State

Locked start/end vs actual opening/ending states; mismatch → `FAIL`
(CO15/CO16, MO10/MO12). 1G.10 lineage/frame refs reused as the lock source.

## 30. Motion Identity

Direction/gesture/trajectory/identity/opening/ending/state-transition
coherence when continuity-relevant (CO17, MO7/MO8/MO9/MO11 proven);
semantic temporal intent (occurs/completes/no inversion) checked alongside.
Faster/slower creative performance never fails unless the contract
constrains it; story-directed change → `PASS` (MO15).

## 31. QA Evidence

Every non-trivial decision retains a `QaEvidence` record
(layer/check/source/expected/observed/comparison/confidence/artifactRefs);
evidence IDs unique per result (validator rejects duplicates). No secrets
(hashes/paths/metadata only).

## 32. Visual Evaluator Boundary

Core interface is provider-neutral: layers consume structured observations
(`{source, …, confidence}`); the evaluator never owns truth, gate policy,
registry, or generation. No fake vision anywhere (missing observation →
UNKNOWN, proven in every layer suite).

## 33. Human Review/Override

Blocking UNKNOWN aggregates to `MANUAL_REVIEW` recommendation;
`validator.js` + `store.js` preserve full history so manual resolution
appends a new QA lineage entry without erasing the automated result.
Factual contradictions require factual evidence (provenance rule §15).

## 34. Aggregate Policy

`aggregate.js`: any `FAIL` at `ERROR/BLOCKER` → `REJECTED`;
`FAIL` at `WARNING` → `REVIEW_REQUIRED`; critical UNKNOWN →
`REVIEW_REQUIRED` + ineligible; non-critical UNKNOWN/WARN-only →
`READY_FOR_TIMELINE` with warnings listed (AG7 proven). Recommendation:
structural→`REPLACE_ASSET`, continuity→`REGENERATE_SHOT`,
factuality→`RELABEL`, semantic→`RECOMPOSE`, unknown→`MANUAL_REVIEW`.

## 35. Timeline Gate

`gate.js#assertAssetReadyForTimeline(assetId, shotId)` requires a current,
valid, fresh QA result: no QA → ineligible (AG8); shot binding mismatch →
reject; hash drift → reject (AG10); stale fingerprint → review (AG9);
non-READY aggregate → ineligible. `SELECTED/APPROVED` alone never suffices
(no registry quality field is consulted by the gate).

## 36. Asset Library Integration

Linkage lives in the QA index (`qa/index.json`: `assetId →
{currentQaResultId, history[]}`), not in 1G.10 records — `lib/asset-library/`
is 100% unmodified (verified `git status` clean outside new files; 1G.10
suite 41/41 re-green). No hash/content mutation through QA.

## 37. Locked Asset Behavior

New QA results attach to locked assets without touching locked bytes
(REAL4 proves repo bytes bit-identical after persist). Failure ⇒ timeline
ineligible for that context; replacement = new asset/new lineage (TR3).

## 38. Targeted Repair

Aggregate `recommendation` names exactly one action for the affected
shot/asset (`REPLACE_ASSET | REGENERATE_SHOT | RECOMPOSE | RELABEL |
MANUAL_REVIEW`); 1G.11 generates no media (TR5 proves only `qa/`
artifacts are written). One bad shot never invalidates the sequence
(TR1/TR2 proven).

## 39. Fingerprint/Staleness

`shared.js#buildExpectationFingerprint` covers assetId/hash,
shot/scene/script/narration versions, claim/evidence, three Bibles,
instructions, platform adaptation, QA policy. `checkStaleness` maps:
hash/policy → all; evidence → factuality; bibles/instructions → continuity;
adaptation → structural+semantic; shot/scene/script → semantic+factuality.
SL1–SL6 proven.

## 40. Persistence/Schema

`projects/<projectId>/qa/<assetId>/<qaResultId>.json` + `qa/index.json`,
atomic via `providers/runtime/artifact-store`, history append-only (SL7).
`schemas/asset-qa-result.schema.json` validates the accept instance;
`validator.js` enforces the §44 rejects (eligible+blocker FAIL,
eligible+critical UNKNOWN, provenance-free factual PASS, hash mismatch,
duplicate/missing evidence IDs).

## 41. N1 Wrong Character

Expected `HOST_A`, injected `HOST_B` through `evaluateAssetQa`:
`CONTINUITY FAIL (WRONG_CHARACTER)`, `REJECTED`, `timelineEligible=false`,
`REGENERATE_SHOT`. Proven `tests/qa/test-asset-qa-aggregate.js#N1`.

## 42. N2 Wrong Outfit

Unapproved `red jacket` vs locked `mustard overshirt`:
`CONTINUITY FAIL`, `timelineEligible=false`. Positive: approved change
matched → `PASS`. Both proven (layer CO5/CO6 + full-path N2).

## 43. N3 Wrong Location

`studio` → `beach-night` (+ scene drift): `SEMANTIC and CONTINUITY FAIL`,
`timelineEligible=false`. Positive: declared transition → `PASS`
(CO8 proven).

## 44. N4 Wrong Factual Visual

F1 decline-claim + rising chart → `FAIL/ineligible`; F2 leopard + lion →
`FAIL/ineligible`. Both through the real path (layer FA12/FA7 + full-path
N4). No hard-coded FAIL: each runs `evaluateAssetQa` end to end.

## 45. Real Existing Asset QA

Locked 1G.10 asset `as-1186233d1af6` (`GEN01_attempt-01.png`, 32×32,
sha256 `1186233d…b322e` verified against file bytes): structural `PASS` on
real bytes; full QA honestly `REVIEW_REQUIRED` (semantic/factuality/
continuity observations unavailable → explicit UNKNOWN, never forced
PASS); validator accepts the honest result; gate answers
`eligible=false/REVIEW_REQUIRED`; repo bytes bit-identical afterwards.
Proven `tests/qa/test-asset-qa-real.js` (13 asserts).

## 46. Structural Tests

ST1–ST10 all PASS (valid image/video decode, corrupt FAIL, wrong-type
FAIL, zero-duration FAIL, dims extracted, aspect match/mismatch,
ext/signature mismatch, idempotency) + zero-motion-required FAIL +
duration-UNKNOWN-critical. 20 asserts, `test-asset-qa-structural.js`.

## 47. Semantic Tests

SE1–SE10 + MO1–MO6/MO14/MO16 + null-observation UNKNOWN. 24 asserts,
`test-asset-qa-semantic.js`.

## 48. Factuality Tests

FA1–FA17 + F1/F2 + provenance-without-match UNKNOWN. 33 asserts,
`test-asset-qa-factuality.js`.

## 49. Continuity Tests

CO1–CO17 + MO7–MO12/MO15 + locked-ref-without-observation UNKNOWN. 25
asserts, `test-asset-qa-continuity.js`.

## 50. Aggregate Tests

AG1–AG10 (incl. warning-only-eligible policy, no-QA/stale/hash gates),
full-path N1–N4, schema accept + three validator rejects. 55 asserts,
`test-asset-qa-aggregate.js` §schema section.

## 51. Repair/Staleness Tests

TR1–TR5 (single-shot flagging, lineage/history, immutability, no-gen) +
SL1–SL7 (fingerprint idempotency, targeted staleness ×4, unrelated-clean,
history preserved), inside `test-asset-qa-aggregate.js` + `test-asset-qa-real.js#REAL4`.

## 52. Security/Privacy

No credentials/cookies/tokens/auth-state in code, tests, or QA artifacts;
untrusted media handled as data (magic/header parsing only, corruption →
FAIL never execution); no SAC/Defender/registry changes (nothing toggled;
`render:doctor` not needed — no render ran). `check:repo-structure` OK.

## 53. Schemas

New: `schemas/asset-qa-result.schema.json` (layer/check/evidence/
aggregate contracts). Accept instance validates via ajv; reject instances
enforced by `validator.js` (three rejects proven). No earlier schema
modified.

## 54. Targeted Regression

`node scripts/run-tests.js qa` 8/8 green (6 new + 2 existing, incl.
`test-qa-diff`, `test-visual-qa-evidence` untouched-green).
`node scripts/run-tests.js flow media` 21/21 green: 1G.9
agent-instructions 73/73, 1G.10 asset-library 41/41, FIX 03
write-persistence 94/94, live-instruction-plumbing 76/76, media
preflight/MCP green — 1G.9/1G.10/media-probe behavior unchanged.

## 55. Full Regression

`npm test`: **0 failed suite(s), 13 domains, 297.4s** (cost, flow, media,
pipeline, platform, policy, providers, qa, remotion, research,
research-deep, story, topic). Extension suite not run (extension code
untouched — `flow-companion/` diff empty). Repo-structure check green.

## 56. Zero-generation/credit

`NEW_MEDIA_GENERATIONS = 0` (no provider/generation call in `lib/asset-qa`;
TR5 proves only `qa/` artifacts written; full-path gates run on
in-memory fixtures + one pre-existing repo PNG). `FLOW_CREDITS_SPENT = 0`
(no Flow/network invocation; docs re-checked read-only, §58A below).
No paid QA model invoked (no 1G.8 budget authorization needed/used).

## 57. Files Created

```text
lib/asset-qa/shared.js
lib/asset-qa/structural.js
lib/asset-qa/motion.js
lib/asset-qa/semantic.js
lib/asset-qa/factuality.js
lib/asset-qa/continuity.js
lib/asset-qa/aggregate.js
lib/asset-qa/store.js
lib/asset-qa/validator.js
lib/asset-qa/gate.js
lib/asset-qa/index.js
schemas/asset-qa-result.schema.json
tests/qa/test-asset-qa-structural.js
tests/qa/test-asset-qa-semantic.js
tests/qa/test-asset-qa-factuality.js
tests/qa/test-asset-qa-continuity.js
tests/qa/test-asset-qa-aggregate.js
tests/qa/test-asset-qa-real.js
Report/PHASE_1G11_01_STRUCTURAL_SEMANTIC_FACTUALITY_CONTINUITY_QA_REPORT.md
```

## 58. Files Modified

None. (Two in-session test-logic fixes — style-drift WARN level,
content-deterministic QA id — were corrected before first green; the
shipped tree contains only the final state. `lib/asset-library/`,
schemas, and all pre-existing suites are byte-identical.)

## 58A. Official-reference check

Re-checked live 2026-10-04 (read-only; pages treated as UNTRUSTED DATA,
capability context only):
`support.google.com/flow/answer/17093911` — Agent instructions = reference
image + guidelines, project-wide; confirm-before-generating Always
(default) / Never; agent queries cost no credits (daily quota), generated
media DOES cost credits. `support.google.com/flow/answer/16353334` — text prompt +
ingredients (character `@name`/avatar `@me`, visual refs, single-speaker
voice refs on Omni Flash) + start/end frames; workflows differ per model.
Confirmed provider facts used: character references, ingredients/visual
references, start/end frames, model-dependent workflows — and the
permanent invariant (reference supplied != continuity PASS, etc.) is
enforced in code (continuity suite final test). No later-phase concern
(voice QA, loudness, captions, editing grammar) was pulled into 1G.11.

## 59. Files Deleted

None. No one-off fix scripts were created (no `fix-*`/`debug-*` residue).

## 60. Known Limitations

1. Video decode/duration measurement depends on ffprobe availability at
   runtime; without it, video duration is honest critical UNKNOWN
   (REVIEW_REQUIRED) — deterministic `probeOverride` covers tests.
2. JPEG/GIF/WEBP decode verified at signature level; pixel measurement
   reuses PNG-header + ffprobe paths (existing `media-probe` coverage).
3. Visual/motion observations are structured inputs (manual review,
   frame sampling, provider metadata); 1G.11 ships no new vision model —
   by design (zero-generation rule).
4. Style drift is WARN-level by policy (§34/AG7); projects needing
   hard-block on style can escalate severity without code changes.

## 61. Acceptance Checklist

1. One canonical QA owner — `lib/asset-qa/` (§5). 2. Four layers
   independent — §§9/12/14–22/23–30 + suites §§46–49. 3. Structural
   decode/dims/duration/aspect/corruption/file-type — §9/ST-suite. 4.
   Temporal stream integrity inside Structural/Semantic/Continuity — §13A.
   5. Semantic scene/subject/action/text/composition/media-type — §12/SE.
   6. Motion/action validated without fake observations — MO14. 7.
   Direction/completion/start/end blocking evidence — MO2/MO4/MO6/MO10/
   MO12. 8. Factuality applicability gating — §14/FA1–FA4. 9. Canonical
   evidence expectations — §15 + provenance rule. 10. All factual domains
   representable — §§16–22/DOMAINS. 11. Canonical Bibles/references/state
   — §23. 12. All continuity domains — §25–30/DOMAINS. 13. Motion
   continuity direction/gesture/trajectory/start/end/coherence — §30.
   14. No fake visual/motion observation — §32 + UNKNOWN suites. 15.
   UNKNOWN explicit — §8. 16. Critical UNKNOWN blocks — AG6. 17. Evidence
   persisted — §§31/40. 18. Bound to asset hash — §§7/40/AG10. 19. Bound
   to context fingerprint — §§7/39. 20. Bytes never mutated — REAL4/TR5.
   21. Locked assets immutable — REAL1/REAL4. 22. New-lineage replacement
   — TR3. 23–26. N1–N4 rejected — §§41–44. 27. Motion negatives rejected —
   MO2/MO4/MO6/MO8/MO10/MO12/MO13. 28. All blocked pre-timeline — §35/AG.
   29. Approved changes pass — CO6/CO8/CO12/MO15/N2-positive. 30. No QA →
   no timeline — AG8. 31. Stale QA → no timeline — AG9/SL. 32. Single-shot
   flagging — TR1/TR2. 33. Real asset evaluated honestly — §45/REAL.
   34. Later-phase QA deferred, not omitted — §6. 35. 1G.10 green — §54.
   36–37. Generations/credits zero — §56. 38. Host security unchanged —
   §52. 39–40. Targeted + full regression pass — §§54–55. 41. No 1G.12
   work — §52/§62A scope freeze honored.

## 62. Final Verdict

```text
TASK_VALIDATION = PASS

PHASE 1G.11 — STRUCTURAL / SEMANTIC / VISUAL FACTUALITY / CONTINUITY QA = COMPLETE

STRUCTURAL_QA = VERIFIED
SEMANTIC_QA = VERIFIED
VISUAL_FACTUALITY_QA = VERIFIED
CONTINUITY_QA = VERIFIED
TEMPORAL_MOTION_INTEGRITY_QA = VERIFIED

WRONG_CHARACTER_REJECTION = VERIFIED
WRONG_OUTFIT_REJECTION = VERIFIED
WRONG_LOCATION_REJECTION = VERIFIED
WRONG_FACTUAL_VISUAL_REJECTION = VERIFIED

TIMELINE_ELIGIBILITY_GATE = VERIFIED
TARGETED_REPAIR = VERIFIED
QA_STALENESS = VERIFIED
ASSET_LIBRARY_INTEGRATION = VERIFIED

NEW_MEDIA_GENERATIONS = 0
FLOW_CREDITS_SPENT = 0

NEXT = PHASE 1G.12 — VEO REAL E2E
```

Scope freeze (§62A) holds: 1G.11 = source-asset correctness before
timeline (structural + semantic + factuality + continuity incl.
asset-level temporal/motion integrity). No 1G.12/1H/Phase-2+ work started.

```text
STOP
```

Permanent invariants honored: `FLOW GENERATION SUCCESS != QA PASS`
· `REFERENCE PROVIDED != CONTINUITY PASS` · `GENERATED MOTION != MOTION
QA PASS` · `SELECTED ASSET != TIMELINE ELIGIBLE` · `UNKNOWN != PASS` ·
`FACTUAL VISUAL MUST TRACE TO EVIDENCE` · `QA RESULT MUST BIND TO ASSET
HASH` · `LOCKED ASSET MUST NOT BE MUTATED` · `ONE BAD SHOT != REGENERATE
WHOLE SEQUENCE` · `1G.11 DOES NOT GENERATE MEDIA`.
