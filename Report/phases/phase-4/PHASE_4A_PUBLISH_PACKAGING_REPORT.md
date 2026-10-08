# PHASE 4A — PUBLISH PACKAGING — REPORT

**Package:** Phase 4A — Thumbnail / Title System + Publish Package Foundation (4.1)
**Date:** 2026-10-07
**Spec:** `D:\Downloads All\UNFOLDIQ_PHASE_4A_PUBLISH_PACKAGING.md`
**Verdict:** **PHASE_4A = COMPLETE; PHASE_4B_READY = YES** (see §29)

---

## 1. Entry gate

Phase 3C evidence verified in `Report/phases/phase-3/PHASE_3C_TIMELINE_CONTROL_REPORT.md` (§§27–29):

```text
PHASE_3C_FUNCTIONAL / QUALITY_GATE = PASS · PHASE_3 = COMPLETE
MANUAL_OVERRIDE_LAYER / RESPONSIVE_TIMELINE = READY
OVERRIDE_PRECEDENCE / HISTORY / UNDO_REDO_RESET = PROVEN
VARIANT_LINEAGE / BASE_NON_DESTRUCTIVE = PROVEN
SUBJECT_REFRAME_FOUNDATION / SAFE_ZONE_LAYOUT = READY
LOCAL_VARIANT_PATCH / STALE protections = PROVEN
P0 = 0 · P1_CRITICAL = 0 · FULL_REGRESSION = PASS · HYGIENE = PASS
PHASE_4A_READY = YES
```

Planning inputs read before scope freeze: execution package (§3 market review), updated `MARKET_GAP_REGISTRY.md` (18 gaps), Phase 3C report + major-gate evidence, repo evidence (`schemas/thumbnail-package.schema.json`, `schemas/asset-manifest.schema.json` provenance/rights, platform PROFILE.yaml/OVERLAY.md, `lib/caption-grouping`, no prior title/publish code — new `lib/packaging/` namespace, no second image-generation stack).

## 2. Repo baseline

- Prior thumbnail state: single-thumbnail plan/QA record (`thumbnail-package.schema.json`, POST-v1C: 16:9, min 640 wide, readability/accuracy/policy flags) — 4A builds the multi-variant experiment system above it and reuses its geometry floor (640px).
- Rights/provenance: canonical per-asset `provenance`+`rights` in asset-manifest — 4A references, never duplicates.
- Caption budgets (84/42) and platform canvas facts consumed from existing profiles.
- Thumbnail image production reuses the existing provider pipeline by contract (`generationRecord`: provider/model/attempt/assetId/provenance); no separate generation stack created.

## 3. Fresh Market Gap Review

Package §3 (07/10/2026) adopted as the fresh benchmark; URLs cited in-package:

| # | Benchmark | UNFOLDIQ decision | Where |
|---|---|---|---|
| 3.1 | YouTube A/B test (title/thumbnail/pair, ≤3 variants, watch-time winner) | PublishExperimentSet, paired variants, hypotheses, distinctness, watch-time-aware framing; no 3×3, no API integration | `lib/packaging/experiment.js` |
| 3.2 | Title ≤100 / description ≤5000 | versioned profile + hard-limit validators | `profiles.js` |
| 3.3 | Thumbnails 16:9, ≥640 wide, JPG/PNG | PlatformThumbnailProfile + geometry/format/size validators | `profiles.js` |
| 3.4 | Accurate, succinct, key-words-early titles; simple thumbnails | readability metrics, important-prefix, pair consistency, small-preview QA | `experiment.js`, `package.js` |
| 3.5 | Tags minimal (misspellings) | metadata priority model; tags capped 10, deduped | `package.js` |
| 3.6 | No misleading metadata | Claim Fidelity Gate; UNSUPPORTED material → BLOCK | `claims.js` |
| 3.7 | AI suggestions grounded in transcript/themes | concepts consume script/themes/hook/evidence (caller-supplied); no random generic generation | fixture + `buildVariant` inputs |

## 4. Platform Publish Profile

`lib/packaging/profiles.js` (`PROFILE_VERSION 1.0.0`): `YOUTUBE_LONG_FORM@1.0.0` — title 100 chars + invalid-char policy (control chars, edge whitespace), description 5000, thumbnail 16:9 / recommended 3840×2160 / min 640×360 / JPG-PNG / ≤2MB, required vs optional fields, audience/rights/metadata policy refs. Values are sourced snapshots, not global defaults. Encoded-output profile stays 4B (GAP-021 foundation FIXED).

## 5. Publish Experiment Set

`PublishExperimentSet 1.0.0`: experimentSetId (content-hash deterministic → idempotent retry), projectId/platform/profileRef, 2–3 `PackagingVariant`s, 3 experiment modes, selectionPolicy, selectedVariantId + selectionReason, hypothesisSummary, contentHashes, policy version, timestamps. Selection: operator or policy-default with persisted reason; unselected → REVIEW_REQUIRED at finalize. No YouTube A/B API integration (explicitly out of scope).

## 6. Packaging Variants

Paired `PackagingVariant`: variantId/concept/audience/hypothesis/title/thumbnail/semanticAngle/claimRefs/noveltyAxis/expectedTradeoff/status (CANDIDATE/SELECTED/REJECTED). Title carries angle (7-value), primaryClaim, claimRefs, characterCount, readability metrics. Thumbnail carries canonical assetId, concept, visualClaim, subjectRefs, optional textOverlay + legibility data, sourceType (6-value), geometry, format, size, claimRefs, provenanceRef, generationRecord. Target 3, minimum 2; pseudo-variants rejected by diversity QA (Case B).

## 7. Title System

Titles assemble deterministically from caller concepts (topic/hook/script/evidence/audience/channel inputs); readability metrics persisted (chars, words, important-prefix, ALL-CAPS ratio, emoji count, punctuation density) as review signals. Rules enforced: platform hard limits, no unsupported numeric/absolute claim (absolute-language scan → REVIEW), high-value info early is advisory via importantPrefix. Repair truncates at word boundary (Case C).

## 8. Thumbnail Concepts

`ThumbnailConcept` inputs (narrativeAngle, audience, focalSubject, candidate assets, composition/text/emotion/color intent, claim + refs, hypothesis) precede any image work (Ask-Studio pattern: grounded in actual video themes). Asset sourcing priority: approved hero/frame → approved image → composite → generated (with full generationRecord + provenance + fidelity validation). Stylized illustration allowed only without false-evidence implication (synthetic-as-footage scan → REVIEW).

## 9. Thumbnail Asset Production

No new image stack: production routes through the existing provider pipeline; packaging records provider/model/cost/latency/attempt/assetId/provenance via `generationRecord` (proven in Case L). Anonymous files refused at build (`MISSING_PROVENANCE`); unresolvable assetIds refused even with resolver present. Image-generation budget exists in repair constants (`maxImageAttempts: 2`); measured cost in this package: 0 tokens / 0 generations (deterministic assembly).

## 10. Variant Diversity

Structural, explainable rules (no magic similarity thresholds): same primaryClaim + same thumbnail asset → BLOCK; title Jaccard ≥ 0.8 on identical claim → BLOCK; same asset + near-identical hypothesis → REVIEW. Repair deliberately refuses to auto-mangle (`VARIANTS_TOO_SIMILAR` stops the loop → genuine REPLAN_VARIANT by operator/agent). Case B proves both detection and the honest stop.

## 11. Claim Fidelity

`PackagingClaim`: claimId/text/source (TITLE/THUMBNAIL_VISUAL/DESCRIPTION)/supportRefs/supportType (VIDEO_CONTENT/EVIDENCE/BOTH)/status (SUPPORTED/PARTIAL/UNSUPPORTED). Ref-backed visual claims inherit ref support; ref-less visual claims stand alone. Absolute-language and synthetic-as-footage scans add REVIEW findings. Repair reduces/replaces/aligns — never fabricates support.

## 12. Title↔Thumbnail↔Video QA

Three-way consistency: disjoint title/thumbnail ref sets → `TITLE_THUMBNAIL_MISMATCH` (repair aligns thumbnail refs toward the title anchor, Case J); title refs outside video+evidence → `PACKAGING_VIDEO_MISMATCH` BLOCK (Case K). Spec counter-example honored: dinosaur title with no support → `TITLE_UNSUPPORTED_CLAIM` + `MISLEADING_PACKAGING` BLOCK (Case H); misleading visual → `THUMBNAIL_UNSUPPORTED_CLAIM` (Case I).

## 13. Description

`buildDescription`: opening summary, learn-points, source/context note, chapters, music credit, corrections placeholder — length-capped by profile (Case D: 6000-char summary → `DESCRIPTION_TOO_LONG`). Description factual claims inherit evidence policy (unsupported refs gate identically). No keyword stuffing (tags live separately, capped).

## 14. Metadata

`PublishMetadata 1.0.0`: profileRef, title, description, language, tags (≤10, deduped), audience (madeForKids/ageRestriction: true/false/`REVIEW_REQUIRED` — unknown never silenced, Case O), category/playlist/visibility/license intents, selectedVariantId, sourceHashes. Priority model follows platform reality (title → thumbnail → description → captions/language → audience/compliance → rights → tags).

## 15. Rights/Provenance

`buildRightsProvenance` references canonical asset-manifest records (sourceType/provenance/rights) for every used asset; used-but-unrecorded → `MISSING_PROVENANCE` BLOCK. No duplication of the rights engine. Case X wire-up proven in package assembly.

## 16. Music Attribution

Exact canonical credit text carried verbatim when required (`musicAttribution.exactText`); required-but-missing → `MISSING_ATTRIBUTION` BLOCK; not-required → null, never invented (Cases M/N).

## 17. Sources/Citations

`buildSources` retains claimId → text → sources traceability from evidence claims. Public description citations follow channel strategy (not forced); package-level traceability always present. Case X includes `sources.json` ref.

## 18. Platform Compliance

`platform-compliance.json`: title/description limits, thumbnail profile (per-variant geometry in QA), metadata completeness, audience completeness, rights completeness — plus 4B-owned checks explicitly recorded as `PENDING_PHASE_4B` (never passed early): final render/output compliance, final flash/safe-zone validation. Blocking count excludes pending items honestly (Case X asserts the marker).

## 19. Upload Checklist

Generated `UPLOAD_CHECKLIST.md` (operator-friendly, 12 items): final.mp4 + 4B PASS gate, selected title/thumbnail, description, captions, language, audience flags, rights/provenance, music attribution, compliance state, sources retained, final human review. Manual upload acceptable for V1 (RULE 15).

## 20. Manual Override

3C principles carry forward via `patchPackaging` (EDIT_TITLE / REPLACE_THUMBNAIL / EDIT_DESCRIPTION_REF / SELECT / REJECT_VARIANT): operator edits preserved verbatim; claim + platform QA rerun by the caller (Cases R/S prove edit persistence and the rerun catching an invented claim). Overrides cannot bypass `MISLEADING_PACKAGING` hard blocks (fidelity gate runs after every patch — Case R's invented claim BLOCKs). History/provenance: patchIds idempotent, selectionReason persisted.

## 21. Dependency / Idempotency

`resolvePackagingInvalidation`: TITLE_ONLY → title/claim/metadata dirty, media clean; THUMBNAIL_ONLY → thumbnail/claim/rights dirty, render clean; UPSTREAM_CONTENT → experiment set STALE (Case T); RENDER_TECHNICAL_ONLY → text clean, video-ref/compliance dirty (Case U). Idempotency: same content hashes + policy + config → stable experimentSetId; store retry returns the existing set (`idempotent: true`, Case W); no duplicate experiment IDs or asset registrations. Generation provenance (model/prompt/seed/attempt) recorded when nondeterministic generation is used (§39 contract in `generationRecord`).

## 22. Persistence

`publish-experiment-set.json`, `publish-package.json`, `metadata.json`, `description.md`, `UPLOAD_CHECKLIST.md` via workspace OUTPUT/DURABLE governance: atomic tmp+rename, JSON shape on read, stale-revision refusal (Case V proves reload-identical + `STALE_PACKAGING_INPUT` on mismatched revision). Retry-safe by construction (§21).

## 23. Cases A–X

`tests/packaging/test-packaging.js` **24/24 PASS** on deterministic fixtures (`tests/fixtures/packaging-fixture.js`), temp-root workspace for persistence:

```text
A 3 pairs · B duplicates · C title limit+repair · D description limit ·
E valid thumb · F 4-way invalid thumb · G supported title · H clickbait BLOCK ·
I misleading visual · J pair mismatch+align · K video mismatch · L provenance+generation ·
M exact attribution · N no fake attribution · O audience unknown→review · P tags capped ·
Q small-preview · R title override+rerun · S thumb override+rerun · T stale on upstream ·
U media-clean patch · V persistence+stale · W idempotent retry · X completeness+PENDING — ALL PASS
```

## 24. Performance / Cost Baseline

Measured 2026-10-07, 3-variant set (web-30 fixture); no budgets claimed:

```text
experiment build                 < 1 ms
variant QA (full incl. fidelity) 0.15 ms (avg ×20)
repair (single finding)          < 1 ms
description build                < 1 ms
package assembly                 < 1 ms
experiment set artifact          ~4.2 KB
package manifest                 ~1.5 KB
variants                         3 (target met)
rejection rate                   0 (fixture); repair-stop path proven (Case B)
manual interventions             0 (fixture); operator paths proven (R/S/selection)
LLM tokens                       0 (deterministic assembly; generation path records when used)
image-generation cost            0 (reuse-by-contract; maxImageAttempts: 2 reserved)
```

## 25. Regression

Per-domain `node scripts/run-tests.js` (single `npm test` exceeds the 10-min tool timeout by cumulative time, not failure): timeline/motion/override/responsive/packaging/workspace, flow/providers/pipeline, topic/research/story/captions/alignment/mix/music/pairing/storage/policy/cost/dag, remotion/media/qa/compliance/golden/history/narration/platform/project-manifest/pronunciation/provenance/recovery/spoken-script/telemetry/voice-bible, research-deep/real-e2e — **0 failed suites everywhere**. `npm run check:repo-structure` → OK. No Phase 3 regression (timeline 18+6, motion 23, override 10, responsive 15 still PASS).

## 26. Market Gap Registry Update

`docs/roadmap/MARKET_GAP_REGISTRY.md`: all prior states preserved (004 FIXED; 005/013/018 partial→4B; 012/015/016/017 FIXED; 014→5); added GAP-019 (paired experiment → FIXED), GAP-020 (claim fidelity → PARTIALLY_FIXED / FINAL_REVALIDATION_4B), GAP-021 (publish profile → FIXED foundation, encoded profile → 4B), GAP-022 (experiment metrics artifact → FIXED, collection POST_V1). Counts: 22 gaps — FIXED 10 · PARTIALLY_FIXED 5 · PLANNED 2 · DEFERRED 2 · REJECTED 2 · OPEN 1 (live-gated). P0 = 0; Phase-4B-blocking P1 = 0.

## 27. Quality Gate

```text
PLATFORM PROFILE: versioned [x] · youtube-long-form [x] · title/description limits [x] ·
  thumb geometry/format/size [x] · audience [x] · language [x] · not global [x]
TITLE/THUMBNAIL: 2–3 variants [x] · target 3 [x] · pairs first-class [x] ·
  concept/audience/hypothesis [x] · distinct [x] · readability QA [x] · small-preview QA [x]
CLAIM FIDELITY: title→support [x] · thumb→support [x] · description policy [x] ·
  unsupported blocks [x] · pair consistency [x] · video consistency [x] · clickbait block [x]
DESCRIPTION/METADATA: canonical description [x] · no stuffing [x] · priority model [x] ·
  audience unknowns→review [x] · versioned artifact [x]
RIGHTS: canonical assetIds [x] · provenance [x] · rights refs [x] · exact music credit [x] ·
  no fake attribution [x] · sources traceable [x]
PACKAGE: manifest [x] · experiment set [x] · selection [x] · description [x] ·
  captions refs [x] · metadata [x] · rights [x] · compliance [x] · checklist [x] ·
  finalVideoRef PENDING_4B [x]
DEPENDENCY: durable artifacts [x] · selection durable [x] · overrides durable [x] ·
  upstream→stale [x] · media-clean patch [x] · idempotent retry [x] · stale protection [x]
AGENT/QA: structured APIs [x] · machine findings+actions [x] · bounded repair [x] ·
  cost/attempt budget [x] · no UI [x]
MARKET GAP: benchmark [x] · experiment FIXED [x] · fidelity recorded [x] ·
  profile recorded [x] · metrics recorded [x] · no blocking P0/P1 [x]
COMPLETION: A–X 24/24 [x] · baseline [x] · P0=0 · P1=0 · regression PASS · hygiene PASS · report [x]
```

## 28. Honest Limitations

```text
1. No final.mp4 exists from 4A; finalVideoRef = PENDING_PHASE_4B — no publishability claimed.
2. Claim fidelity is pre-render (script/evidence/timeline); revalidation vs actual final.mp4 is 4B.
3. Title assembly is deterministic from caller concepts; no LLM copywriter wired (generationRecord contract ready).
4. No thumbnail pixels rendered here (provider pipeline by contract; zero generations spent).
5. Encoded-output profile + visual/flash validation stay 4B (GAP-005/013/018/020/021 remainders).
6. No post-publish analytics collection (GAP-022 artifact only).
7. No MCP/public API freeze (deliberate).
```

## 29. Final Verdict

```text
PHASE_4A_FUNCTIONAL                    = PASS
PHASE_4A_QUALITY_GATE                  = PASS

PLATFORM_PUBLISH_PROFILE               = READY

TITLE_SYSTEM                           = READY
THUMBNAIL_SYSTEM                       = READY
PUBLISH_EXPERIMENT_SET                 = READY

CLAIM_FIDELITY_GATE                    = PROVEN
ANTI_MISLEADING_PACKAGING              = PROVEN

PUBLISH_METADATA                       = READY
RIGHTS_PROVENANCE_PACKAGE              = READY
UPLOAD_CHECKLIST                       = READY

PACKAGING_PERSISTENCE                  = PROVEN
PACKAGING_STALE_PROTECTION             = PROVEN

P0                                     = 0
P1_CRITICAL                            = 0

FULL_REGRESSION                        = PASS
HYGIENE                                = PASS

PHASE_4A                               = COMPLETE
PHASE_4B_READY                         = YES
```

## Context Loaded

| Path | Requirement | Loaded | Purpose |
|---|---|---|---|
| `core/WORKFLOW.md`, `core/CONTEXT_ROUTER.md`, `AGENTS.md` | REQUIRED (router) | LOADED | Routing + standing rules |
| Execution package Phase 4A | REQUIRED (task) | LOADED | 4A spec §§0–54 |
| `Report/phases/phase-3/PHASE_3C_TIMELINE_CONTROL_REPORT.md` | REQUIRED (entry gate) | LOADED | Phase 3 evidence |
| `docs/roadmap/MARKET_GAP_REGISTRY.md` | REQUIRED (planning) | LOADED + UPDATED | GAP-019–022 |
| `schemas/thumbnail-package.schema.json`, `schemas/asset-manifest.schema.json`, platform profiles, `lib/caption-grouping` | REQUIRED (baseline) | LOADED | Reuse before build |
