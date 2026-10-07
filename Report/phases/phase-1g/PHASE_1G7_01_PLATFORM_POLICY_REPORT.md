# PHASE 1G.7 — PROMPT 01
# PLATFORM POLICY REPORT

Date: 2026-10-03
Roadmap: V6 — Scope Frozen
Previous gate: `TASK_VALIDATION = PASS / PHASE 1G.6 — PROVIDER / MODEL CAPABILITY REGISTRY = COMPLETE` (verified in-repo before any edit)

```text
TASK_VALIDATION = PASS
PHASE 1G.7 — PLATFORM POLICY = COMPLETE
ASPECT_SEMANTICS = VERIFIED
TIKTOK_SAFEZONE_PROVENANCE = VERIFIED
PLATFORM_TARGETS = YOUTUBE_LONG,YOUTUBE_SHORTS,TIKTOK
MASTER_TO_16_9 = VERIFIED
MASTER_TO_9_16 = VERIFIED
FULL_SEQUENCE_REGENERATION = NOT_REQUIRED
PROVIDER_CALLS = 0
GENERATIONS = 0
CREDITS_SPENT = 0
NEXT = PHASE 1G.8 — OUTPUT / COST / CREDIT PLANNER
```

(The next phase name comes verbatim from the task contract §43; no in-repo
canonical roadmap file exists to cross-check it against, so it is reported
exactly as specified and not elaborated.)

## 1. Status

All §40 acceptance criteria proven with evidence below: no duplicate owner;
3 canonical targets; 16:9/9:16 as production policy with preferred/accepted/
required separated; Shorts square/vertical fact preserved; TikTok guidance
source-scoped; first-class source-aware safe zones with zero invented
geometry; preserve→reframe→relayout→recompose→regenerate ladder;
deterministic relayout for 9 portrait modalities; modality/render/story/model
invariants intact; factual chart/map/diagram preservation verified verbatim;
targeted-only regeneration; 8-shot sequence usable on 16:9 + Shorts 9:16 +
TikTok 9:16 with no full regeneration; versioned/fingerprinted/idempotent
persistence with platform-scoped staleness; 171-assert suite green (148 base +
AR1–AR8 + SZ1–SZ3 FIX 01 corrections); full `npm test` 0 failed (206.6s,
incl. native Remotion, run continuously under the operator-owned security
state per project rule §41A — no SAC gate); schemas + structure
green; 0 calls / 0 generations / 0 credits; no post-1G.7
work implemented.

FIX 01 correction (2026-10-03, same day): `acceptedAspectRatios` for
YOUTUBE_LONG and TIKTOK corrected from narrow one-item lists to UNKNOWN with
documenting acceptance notes (external acceptance is non-exhaustive; narrow
lists risked reading as exhaustive truth); TikTok bottom-band geometry
labeled `geometryOrigin = INTERNAL_POLICY` (PARTIAL, sourced, never official
universal truth); loader/validator/test coverage added for null-acceptance
semantics. Shorts [9:16, 1:1] source-backed acceptance unchanged.

## 2. Entry Gate

1G.5 PASS and 1G.6 PASS verified in-report before implementation. Live
contracts re-verified (no ENTRY_GATE_FAIL):

1. `visualType` ≠ `visualModality` (separate fields, grammar owner present).
2. 1G.5 still owns modality, cheapest-adequate renderer decision, render
   mode, requiredCapabilities, reference strategy (read back live).
3. 1G.6 still owns registry, compatibility filtering, model resolution, cost
   observations (facade + seed intact, untouched by this phase).
4. Source scan of `lib/visual-motion/`: zero model IDs, zero price constants.
5. Prompt Compiler without targetKind → `PROMPT_TARGET_REQUIRED` (live call).
6. Platform/profile/orientation configuration audited first (§3); existing
   `PROFILE.yaml` files referenced, never shadowed.
7. `artifact-store` (atomic writes) and `request-fingerprint`
   (stableStringify/hash) reused as-is.

No contradiction found; no earlier phase patched (only additive
`validate-schemas.js` instances for the new schema).

## 3. Repository Capability Audit

| Existing component | Disposition | Reason |
|---|---|---|
| `platforms/INDEX.md` (youtube/tiktok resolution, aliases) | **A** | reused untouched; 1G.7 targets are a separate axis (LONG/SHORTS), no alias change |
| `platforms/youtube/PROFILE.yaml`, `platforms/tiktok/PROFILE.yaml` (aspect, orientation, caption profile, source verification) | **A** | referenced via `baseProfile` + `baseProfileAspect`; composition truth not duplicated |
| `platforms/*/OVERLAY.md` (prompt contracts) | **C** | different concern; left alone |
| `lib/caption-grouping.js`, `lib/caption-check.js` (timing/grouping) | **C** | timing authority stays later; 1G.7 owns composition policy only |
| `lib/visual-motion/editor-motion.js` techniques (incl. CROP_REFRAME) | **B** | vocabulary-compatible reframe building blocks; referenced, not owned |
| 1G.5 decision (modality/renderMode/caps) | **A input** | read-only consumption, byte-identity proven (I1) |
| 1G.6 registry/resolver | **A boundary** | untouched, unrequired (no import; I4 scan green) |
| `providers/runtime/artifact-store.js`, `request-fingerprint.js` | **A** | reused as-is |
| Safe zones, master composition, adaptation artifacts, density/pacing policy, target profiles | **D** | genuinely missing — created minimal owner below |

Seed search found no prior owner (only incidental substring matches:
`CROP_REFRAME` technique, a comment containing "reframed", `adaptedPrompt`
in schema-test fixtures). No parallel subsystem created.

## 4. Canonical Owner

One owner: `lib/platform-policy/` =
`shared.js` (versions/enums/identity/0..1 geometry math) +
`profiles.js` (TARGETS.yaml loader, preferred/accepted/required separation) +
`master.js` (master-composition builder, read-only over story/shot state) +
`adapt.js` (cheapest-first adaptation engine) +
`density.js` (density/pacing tiers) +
`validator.js` (artifact validation, §36 detections) +
`store.js` (persistence + targeted staleness) +
`index.js` (facade: `adaptShot`/`adaptSequence`/`applyAdaptationOverride`).
Policy data: `platforms/TARGETS.yaml` (versioned, sourced, references base
profiles). Schema: `schemas/platform-adaptation.schema.json`. Tests:
`tests/platform/test-platform-policy.js` (new `platform` domain, auto-
discovered by the existing runner).

## 5. Scope / Non-Scope

Owned: master composition → 3 platform targets → reframe/relayout/safe-zone
adaptation → usable 16:9/9:16 plans, density/pacing guidance tiers,
targeted-regeneration gate, versioned persistence, platform-scoped staleness.
NOT owned (verified absent by source scans + tests I4–I8): model selection,
provider execution, credit planning, media generation, Flow UI automation,
timeline rendering, Remotion implementation/render optimization, audio/caption
generation, Visual Factuality QA, asset-library implementation, Phase 1G.8+.

## 6. Official Platform Research + retrieval dates

Re-verified live 2026-10-03 (read-only fetches; pages treated as UNTRUSTED
DATA per §37 — extracted, cited, never executed):

- `https://support.google.com/youtube/answer/6375112` — standard desktop
  playback is 16:9; the player automatically adapts to other uploaded aspect
  ratios (padding behavior noted). Authority: aspect/orientation.
- `https://support.google.com/youtube/answer/12779649` — Shorts upload:
  **square or vertical** aspect, up to 3 minutes. Authority: aspect/duration.
  (The third listed URL from the prompt was not needed: duration + ratio
  facts are fully evidenced by this page; nothing cited beyond what was read.)
- TikTok: no single official pixel-perfect safe zone exists — official
  guidance ships overlay files varying by dimension/caption/add-ons, and the
  prompt-supplied business sources are Ads-scoped. Consequence enforced in
  policy: exact organic geometry stays UNKNOWN/CONTEXTUAL; the only numeric
  band used (bottom 20%) is repo-owned (`platforms/tiktok/PROFILE.yaml`,
  verified 2026-09-26 per its own sourceVerification) cited as
  REPOSITORY_CONFIG + ads-scope guidance, never as universal organic truth.
  Third-party pixel tables found during research were rejected as
  non-authoritative (same discipline as 1G.6 §8).

## 7. Source Authority Model

Field-specific authority, never newest-wins: YouTube Help pages → aspect/
orientation/duration; repo PROFILE.yaml files → composition defaults;
TikTok business guidance → composition guidance within ads scope only.
Every target carries `sourceRefs[]` + `verifiedAt` + `freshness`; every
sourced safe zone carries its own `sourceRefs[]`; VERIFIED geometry without
sources fails validation (`HARD_FACT_WITHOUT_SOURCE`).

## 8. Platform Profile Contract

Implemented per §5 in `platforms/TARGETS.yaml` + normalized by
`profiles.js`: platformId, profileVersion, displayName, preferredAspectRatio,
acceptedAspectRatios[] (nullable: null = UNKNOWN / non-exhaustive, with
documenting acceptanceNote), requiredAspectRatio (null = UNKNOWN), orientation,
composition/safeZone/crop/text/caption/graphic/pacing/shotDensity policies,
sourceRefs[], verifiedAt, freshness, status — plus loader-computed
`baseProfileAspect` (reference, not copy) and profile `fingerprint`.
Canonical interpretation (FIX 01): preferred = UNFOLDIQ production
preference; accepted = source-backed platform acceptance only when
sufficiently known, otherwise UNKNOWN; required = actual hard external
requirement only (null everywhere — no hard evidence exists).

## 9. YouTube Long Policy

`YOUTUBE_LONG`: preferred 16:9, accepted UNKNOWN (null) with documenting
acceptanceNote — external acceptance is non-exhaustive because the player
adapts to uploaded aspects; only 16:9 is documented standard. Never claims
16:9-only (player adapts — cited). Required null, LANDSCAPE, base
`platforms/youtube/PROFILE.yaml`. External evidence: 6375112 (16:9
standard + adaptive player). 16:9 masters PRESERVE natively (A1); adaptation
is defensive. (FIX 01: corrected from `accepted [16:9]`, which risked reading
as exhaustive external truth.)

## 10. YouTube Shorts Policy

`YOUTUBE_SHORTS`: preferred 9:16 (UNFOLDIQ production preference),
accepted [9:16, 1:1] (square qualifies per 12779649 — A3/P5 prove no
9:16-only reduction), required null, PORTRAIT. Right-rail + bottom-metadata
zones modeled with region null / status UNKNOWN (variant-dependent, no
official geometry). Hook urgency HIGH, density MEDIUM default.

## 11. TikTok Policy

`TIKTOK`: preferred 9:16 (production default, orientation PORTRAIT),
accepted UNKNOWN (null) with documenting note — general organic acceptance
is not 9:16-only and not exhaustively evidenced; 9:16 is the recommended
creative format (ads-scope guidance). No Ads-scoped fact promoted to
universal organic truth. Required null, base
`platforms/tiktok/PROFILE.yaml`. Safe zones: bottom UI band WITH geometry
`{x:0,y:0.8,w:1,h:0.2}`, status PARTIAL, `geometryOrigin = INTERNAL_POLICY`
(conservative heuristic from the repo-owned 20% rule — explicitly NOT an
official universal organic measurement; caption-length/variant dependency
preserved in notes); right rail + top nav region null / UNKNOWN. (FIX 01:
corrected from `accepted [9:16]`; geometry provenance made explicit.)

## 12. Preferred / Accepted / Required Semantics

Separate fields, enforced by loader + validator: YOUTUBE_SHORTS preferred
9:16 ∈ accepted [9:16, 1:1] (source-scoped square/vertical fact), required
null; YOUTUBE_LONG and TIKTOK accepted null (UNKNOWN) with documenting
acceptanceNotes — valid per AR6, enforced per AR8 (`ACCEPTANCE_UNDOCUMENTED`
when the note is missing). Validator rejects preferred ∉ accepted only when
accepted is a list (`PREFERRED_ACCEPTED_CONFLATION`, P5/AR8) and
required-without-source. Geometry presented as VERIFIED without geometric
provenance fails (`UNVERIFIED_GEOMETRY_AS_VERIFIED`, SZ2); INTERNAL_POLICY
geometry can never be VERIFIED. Test asserts required stays UNKNOWN without
a hard constraint (AR7).

## 13. Safe-Zone Contract

First-class `safeZonePolicy` per target: status (VERIFIED/PARTIAL/UNKNOWN/
CONFLICT), normalized 0..1 coordinate space, zones[] with optional region,
overlays[], sourceRefs[], verifiedAt, freshness, notes[]. Covers top nav,
right rail, bottom nav/metadata, caption area, title/text area, CTA/metadata
overlays as zone records (geometry only where sourced, each with explicit
`geometryOrigin`: INTERNAL_POLICY for the TikTok band, which therefore caps
at PARTIAL). Rules honored: no invented geometry (Z4 scans policy data for
pixel margins); UNKNOWN valid (Z2); UI/caption-length dependencies preserved
(Z3); REVIEW_REQUIRED emittable (Z5); uncertainty never forces regeneration
(UNKNOWN zones constrain nothing — Z1 relocates only against sourced zones);
future live UI observations ingestible as new zone sources without
architecture change. Provenance fields per zone: source type, scope,
verifiedAt, field authority, and whether the number is external truth or an
internal conservative heuristic (SZ1–SZ3).

## 14. Master Composition Contract

Implemented per §8 in `master.js`: compositionId (`mc-…`), sourceShotId,
visualModality + renderMode (copied read-only from 1G.5 decision when
present), sourceAspectRatio, subject anchors / protected / text / caption
intent / graphic / focal / essential-context / data-point regions (0..1,
content verbatim), sceneIntent, factualMeaningRefs (shot + decision
claimRefs, deduped), continuityRefs, sourceDecisionRef, sourceFingerprint,
policyVersion. No story semantics rebuilt; undeclared regions honestly
absent (declaredRegionCount tracked; downstream warns instead of inventing).

## 15. Platform Adaptation Artifact

Implemented per §9 (`pa-…`, persisted at
`projects/<projectId>/platform-adaptations/<platformId>/<shotId>.json`):
ids, project/scene/shot, platformId + profile version/fingerprint +
safeZoneEvidenceVersion, source composition id/fingerprint, source modality +
render mode echoes, targetAspectRatio, action (7 canonical), crop/reframe/
relayout/recompose-assets/text/caption/graphic plans, density + pacing
guidance, preservedIntent[], risks[], warnings[], blockers[],
regenerationDecision + reasons, sourceRefs[], policyVersion, fingerprint,
status, timestamps. Upstream-asset lineage allowed (1G.5 decision refs);
no provider/model fields (validator `MODEL_SELECTION_LEAKAGE`).

## 16. Reframe Policy

Crop window math in 0..1 space (subject-or-center anchor, clamped);
preserves subject/action/focal/intent/factual/continuity where declared (§11
list). Essential set = protected + subject anchors + data points + text
regions + (graphic panels iff COMPARISON/SPLIT_SCREEN, where arrangement IS
the message). Inadequate reframe never silently drops meaning — ladder
continues to relayout/recompose/regenerate with explicit reasons.

## 17. Relayout Policy

First-class deterministic adaptation for MAP, TIMELINE, CHART, DIAGRAM,
TYPOGRAPHY, COMPARISON, ANNOTATION, SPLIT_SCREEN, MOTION_GRAPHIC
(strategies: portrait-crop-with-label-relocation, vertical-segmented,
chart-reflow-values-verbatim, diagram-reflow, type-reflow, stacked,
relocated-callouts, stacked-split, portrait-motion-composition).
Gate-proven: 16:9 SPLIT_SCREEN → 9:16 stacked-split (R5/E); wide chart →
portrait reflow with values verbatim + ordered (R3/E). RELAYOUT ≠
REGENERATE: relayout wins whenever meaning is preserved (G2).

## 18. Text / Caption Composition Policy

Titles/labels/annotations/CTA/burned-in/diagram/chart/map labels reasoned
as regions: relocate (above/below/shift) out of sourced overlays; content
carried verbatim (R6/E: quote equality asserted); never scaled unreadable,
cropped, covered, or silently removed. Exhaustion order reflow → relocate →
split → simplify-presentation → REVIEW_REQUIRED (Z5), regeneration never
for text alone. Factual text unchanged unless an upstream content owner
re-versions it (no such path exists in 1G.7). Caption plan = region
preference + max occupancy + placement intent + caption intent; zero timings
(§14 boundary; I5 + pacing test assert no temporal QA fields).

## 19. Chart / Map / Diagram Semantic Preservation

Adaptation carries factual elements verbatim and proves it: R3 chart values
ordered-equal; R2 map route + North Harbor label preserved; R4 mechanism
labels survive; E-gate chart values verbatim. Unverifiable meaning →
`ADAPTATION_SEMANTIC_RISK` + REVIEW_REQUIRED (relayout without declared
verifiable elements), never silent distortion. 1G.7 is not full Visual
Factuality QA, but introduces no semantic distortion of its own (E6).

## 20. Shot Density

Contextual LOW/MEDIUM/HIGH tiers from platform + content class + narrative
role + modality + importance + duration band — no per-second cut rules
anywhere (source scan + density test). TikTok hook → HIGH; long-form
explanatory diagram → LOW; TIMELINE/CHART/DIAGRAM cap HIGH→MEDIUM (reading
room). Explainable reasons attached; no scalar scores.

## 21. Pacing

Guidance only (hook urgency, change frequency, rest allowance, information
density, transition restraint, short/long-form room) from platform policy +
duration band. Zero timestamps/frame math in outputs (asserted). Final audio
→ forced alignment → master timeline authority untouched (Roadmap Rule N
respected; nothing in 1G.7 emits timing).

## 22. Regeneration Gate

`NOT_REQUIRED` default; `TARGETED_REGENERATION_REQUIRED` only on
irrecoverable essential loss (full-width protected action, un-relayoutable
modality) with explicit essential reasons (R7); `REVIEW_REQUIRED` for
judgment calls (Z5). Aesthetic inputs do not exist — G5 proves junk
aesthetic options are ignored and leave no trace. Later orchestrator (not
1G.7) decides on generation jobs.

## 23. Platform / Modality Boundary

MAP stays MAP on all three targets (A4); E-gate modality strings identical
across LONG/SHORTS/TIKTOK; validator `MODALITY_MUTATION` guard; override
blocklist rejects `visualModality`. Render mode likewise immutable
(I2/I3 record non-promotion/non-demotion per target).

## 24. Provider / Model Boundary

1G.6 authoritative and untouched (no import; I4 scan green; blocklist
rejects `recommendedModel/selectedModel/modelId` in overrides).
Adaptations emit orientation/aspect/composition constraints only. No
`TikTok → model X` mapping exists anywhere (A5 validates all targets clean).

## 25. Persistence

Canonical artifact-store atomic writes; stable `pa-…` IDs; fingerprints over
master + profile + aspect + action + plans + policy; idempotent re-resolution
(S1/E5 double-run equality, fixed clock); manual choices (`manual_*` +
`_manual`) survive refresh (S6: forced anchor byte-survives; fresh
recommendation still recomputed underneath).

## 26. Freshness / Staleness

`checkAdaptationStaleness`: master change, target-profile change, safe-zone
evidence change, policy-version change → dependent adaptation(s) only.
Proven scoped: TikTok change dirties TikTok, Long stays clean (S2); Shorts
change leaves Long clean (S3); composition change detected (S4); unrelated
asset change clean (S5). Never touches Research Pack, Story, scripts,
modality, 1G.5 decisions, 1G.6 snapshots, or other platforms' adaptations.

## 27. Idempotency

Same master + profile + policy + safe-zone evidence → same action, plans,
warnings, blockers, fingerprint (S1, E5; timestamps excluded from hash).

## 28. Manual Override

`applyAdaptationOverride`: forceCropAnchor, forceTextRegions (via placements
recompute), keepMasterAspect, approveReview (REVIEW→ADAPTED with operator
accountability warning), requestRegeneration (operator reason recorded),
acknowledgeRisk. Blocked: essential-info crop without acknowledgment (S6),
modality/provider/story rewrites (S6), missing re-evaluation context.
ACCEPTED / ACCEPTED_WITH_WARNING / BLOCKED with reasons; choices persist.

## 29. Mixed Sequence Fixture

8-shot deterministic fixture (CHARACTER_MOMENT, MAP, CHART, DIAGRAM,
TYPOGRAPHY, COMPARISON with labeled panels, ATMOSPHERE, ANNOTATION) with
declared regions/contents enabling honest verification. Same shot intent,
same modality, same factual meaning, same reusable assets across targets.

## 30. 16:9 / 9:16 Gate

ONE master sequence → YOUTUBE_LONG 16:9 USABLE (8/8 ADAPTED, NOT_REQUIRED) +
YOUTUBE_SHORTS 9:16 USABLE (8/8) + TIKTOK 9:16 USABLE (8/8): no full asset
regeneration, no modality mutation (identical modality strings), no model
hard-coding, no story mutation, no factual distortion (chart values verbatim;
all 24 artifacts schema-valid). True relayout demonstrated (SPLIT_SCREEN →
stacked; CHART portrait reflow) alongside cheap PRESERVE/REFRAME.

## 31. Required Test Matrix Results

`tests/platform/test-platform-policy.js`: **171 passed, 0 failed** (148 base
+ AR1–AR8 + SZ1–SZ3 FIX 01 corrections).
P1–P5 · A1–A5 · Z1–Z5 · R1–R7 · G1–G5 · I1–I8 · S1–S6 · E1–E6 + density/pacing
tiers + AR/SZ matrices. Every §35 ID maps to passing assertions; validator negatives
(unknown platform, conflation, undocumented acceptance, false VERIFIED
geometry, bad action) covered; schema accept/reject
instances added to `validate-schemas.js`.

## 32. Schema Validation

`node scripts/checks/validate-schemas.js` → ALL TESTS PASSED (46 schemas:
45 existing + `platform-adaptation`, each with accept + reject instances).

## 33. Targeted Regression

SAC ON: `platform` 1/1 + `story` 12/12 (1G.4 + both 1G.5 suites: 136 + 158)
+ `providers` 9/9 (1G.6: 152) + pipeline/research/topic/media/policy/qa/flow
0 failed + schemas + `check:repo-structure` REPOSITORY_STRUCTURE_OK.
No 1G.1–1G.6 source modified (only additive schema-check instances).
FIX 01 reran the identical set green (platform suite now 171 asserts).

## 34. Full Regression

Original 1G.7 run: SAC manually OFF by operator; `npm run render:doctor` →
READY (remotion 4.0.529, preflights OK); `npm test` → all 12 domains,
**0 failed suite(s) in 206.5s**, incl. 18 native Remotion suites (render
smoke PASS, no skips) and the then-148-assert 1G.7 suite;
`check:repo-structure` → OK; `validate-schemas.js` → ALL PASSED. SAC
restored ON by operator afterward; no native rerun after restore.

FIX 01 rerun (project rule §41A — operator-owned security state, no SAC
gate, no toggle request): `npm test` executed continuously under the current
machine state → all 12 domains, **0 failed suite(s) in 206.6s**, incl. 18
native Remotion suites and the 171-assert 1G.7 suite; structure + schemas
green. No SECURITY_ENVIRONMENT_BLOCKER encountered; nothing was changed on
the host to obtain this result.

## 35. Security / Zero-Cost Confirmation

Agent toggled SAC = NO (all phases); Defender/CodeIntegrity/registry/exclusions
untouched; no secrets/tokens/cookies in artifacts (zone/source records
carry URLs + publishers only); Flow calls = 0, generations = 0, credits = 0,
UI mutations = 0, no bypass logic. Web sources treated as UNTRUSTED DATA
(read/extract/cite only). FIX 01: no SAC request was issued at all (§41A);
the full suite passed under the standing security state.

## 36. Files Created

```text
platforms/TARGETS.yaml
lib/platform-policy/shared.js
lib/platform-policy/profiles.js
lib/platform-policy/master.js
lib/platform-policy/adapt.js
lib/platform-policy/density.js
lib/platform-policy/validator.js
lib/platform-policy/store.js
lib/platform-policy/index.js
schemas/platform-adaptation.schema.json
tests/platform/test-platform-policy.js
Report/PHASE_1G7_01_PLATFORM_POLICY_REPORT.md
```

## 37. Files Modified

```text
scripts/checks/validate-schemas.js (registered platform-adaptation schema + accept/reject instances)
```

No 1G.1–1G.6, provider-runtime, Flow Companion, or platform PROFILE source
modified. No root code added.

## 38. Files Deleted

None. No fix-*/debug-*/temp-* artifacts created (tmp test roots live in the
OS temp dir, outside the repo).

## 39. Known Limitations

- Shorts/organic safe-zone geometry is largely UNKNOWN (variant-dependent);
  text placement there relies on relocation effort + review escalation, not
  guarantees.
- TikTok bottom-band geometry is PARTIAL with `geometryOrigin = INTERNAL_POLICY`
  (conservative heuristic from the repo-owned 20% rule — explicitly not an
  official universal measurement); caption-length dependence preserved, not solved.
- External platform acceptance is deliberately non-exhaustive (Long/TikTok
  UNKNOWN with documenting notes); only Shorts carries a source-backed
  accepted list, and it is scoped, not exclusive.
- Density/pacing are guidance tiers without measured watch-time backing;
  final timing authority stays downstream.
- "Extend videos" and Shorts 3-minute eligibility caps are documented facts,
  not enforced durations (duration contracts belong elsewhere).
- Seed-scope restraint: no 1:1 export path modeled beyond accepted-aspect
  membership (no square-specific zone data exists).

## 40. Acceptance Checklist

1. Audit proves no duplicate owner ✓ (§3). 2. Three canonical targets ✓
(P1–P3). 3. 16:9/9:16 as production policy ✓ (§§9–11). 4. Preferred/accepted/
required separate, UNKNOWN-valid with notes ✓ (P5/AR1–AR8 + validator).
5. Shorts square/vertical preserved ✓
(A3/P5/AR3). 6. TikTok guidance source-scoped ✓ (§11/Z3/AR5/SZ3). 7. Safe zones
first-class, source-aware, UNKNOWN-capable, geometry-origin explicit ✓ (Z1–Z3/SZ1–SZ2). 8. No invented geometry
✓ (Z4 scan). 9. Preserve/reframe/relayout before regeneration ✓ (§10/R/G).
10. Deterministic relayout for portrait ✓ (R3/R5/E). 11. Modality immutable ✓
(A4/I2). 12. No model selection ✓ (A5/I4). 13. Story/evidence intact ✓
(I1/E6). 14. Chart/map/diagram meaning survives ✓ (R2–R4/E). 15. Targeted
regeneration only ✓ (R7/G3). 16. No cascade ✓ (G4). 17. Usable 16:9 + 9:16 ✓
(§30). 18. Persistent/versioned/fingerprinted/idempotent ✓ (S1/S6). 19.
Platform-scoped invalidation ✓ (S2–S4). 20. 1G.5 + 1G.6 green ✓ (§33). 21–23.
Zero UI/generation/credits ✓ (I6–I8 + commands). 24. Full regression passes ✓
(§34). 25. No post-1G.7 work ✓ (§§5/35 scans).

## 41. Final Verdict

```text
TASK_VALIDATION = PASS
PHASE 1G.7 — PLATFORM POLICY = COMPLETE
ASPECT_SEMANTICS = VERIFIED
TIKTOK_SAFEZONE_PROVENANCE = VERIFIED
PLATFORM_TARGETS = YOUTUBE_LONG,YOUTUBE_SHORTS,TIKTOK
MASTER_TO_16_9 = VERIFIED
MASTER_TO_9_16 = VERIFIED
FULL_SEQUENCE_REGENERATION = NOT_REQUIRED
PROVIDER_CALLS = 0
GENERATIONS = 0
CREDITS_SPENT = 0
NEXT = PHASE 1G.8 — OUTPUT / COST / CREDIT PLANNER
```

FIX 01 closure: aspect semantics corrected in data (Long/TikTok acceptance
UNKNOWN with scope notes; Shorts source-backed list intact), TikTok geometry
provenance explicit (`INTERNAL_POLICY`, PARTIAL), AR1–AR8 + SZ1–SZ3 green,
171-assert suite green, full regression green under the standing security
state with no SAC gate per project rule §41A. No PARTIAL condition remains.

STOP per §44: no 1G.8+ work started (source scans + suite confirm no cost
planner, ledger, humanizer, QA, or E2E automation was added).
