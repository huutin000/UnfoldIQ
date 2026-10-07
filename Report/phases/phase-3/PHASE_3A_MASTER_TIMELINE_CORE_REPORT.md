# PHASE 3A — MASTER TIMELINE CORE — REPORT

**Package:** Phase 3A (Canonical owner: Phase 3.1 — Master Timeline Manifest / EDL)
**Date:** 2026-10-07
**Spec:** `D:\Downloads All\UNFOLDIQ_PHASE_3A_MASTER_TIMELINE_CORE.md`
**Verdict:** **PHASE_3A = COMPLETE; PHASE_3B_READY = YES** (see §24)

---

## 1. Entry gate

PHASE_2 = COMPLETE; POST_PHASE_2_HARDENING = COMPLETE; PHASE_3_READY = YES; P0 = 0; P1_CRITICAL = 0; FULL_REGRESSION = PASS; HYGIENE = PASS — all verified against `Report/hardening/POST_PHASE_2_FLOW_PAIRING_RUNTIME_STORAGE_MARKET_GAP_REPORT.md`. Required planning inputs read: MARKET_GAP_REGISTRY (GAP-004 P1, GAP-005 P2 merged into this package per spec §4), FLOW_BRIDGE_TRANSPORT_DECISION, Phase 2 reports, current repo contracts. GAP-003 preserved as non-blocking live-gated item — not hijacked into 3A.

## 2. Repo baseline (3A-01/03)

- Phase 2 owns the proven **integer-millisecond** editorial clock (`lib/audio-timeline.js` `actualTimelineEndMs`, FinalAudioArtifact `durationMs`, alignment word timings in ms) — kept as `canonicalTimeUnit: MILLISECOND_INTEGER` (spec §6 allows the stable contract).
- No rational frame-rate representation existed anywhere; frame math was absent (nothing to migrate — clean introduction).
- `AssetRecord` carries `hash {algo, value}` — canonical asset identity = assetId + hash, satisfying RULE 5 without new registry work.
- `video-spec.schema.json` (composition/fps/duration) remains the renderer input; the timeline now supplies its canonical timing (§3 Remotion decision: renderer receives resolved deterministic values).

## 3. Market Gap Review (§3)

- **Premiere sequence settings:** timebase/frame-size/PAR/audio-format/color-management are sequence-level concerns → adopted as manifest-level policy refs (ADD NOW).
- **DaVinci Resolve:** source color ≠ working color ≠ output intent → three distinct concepts in `lib/timeline/color-policy.js` (ADD NOW); encoded-output verification stays Phase 4B (DEFER).
- **Remotion:** timeline owns canonical intended timing; renderer gets resolved values (ADD NOW).

## 4. GAP-004 evidence (Timeline Timebase / Frame Rounding)

`lib/timeline/timebase.js`:
- Rational `FrameRate {numerator, denominator}` with gcd reduction; `parseFrameRate` snaps 23.976→24000/1001, 29.97→30000/1001, 59.94→60000/1001.
- Versioned `TIMELINE_TIMEBASE_POLICIES`: `web-30@1.0.0`, `web-2997@1.0.0` (dropFrameTimecode: true), `film-24@1.0.0`, `pal-25@1.0.0`, `ntsc-23976@1.0.0` — each with frameRate, audioSampleRate (48000), canonicalTimeUnit, startFrameRounding FLOOR, endFrameRounding EXCLUSIVE_CEIL, durationPolicy FINAL_AUDIO_DURATION.
- Centralized deterministic integer conversions: `timeToFrameStart` (floor), `timeToFrameEndExclusive` (ceil), `frameToTimeStart/EndExclusive`, `frameCount`, `timestampToFrame` (audio/caption alias). No scattered `Math.round(seconds*fps)` on the canonical path.
- **Proofs (tests/timeline/test-timebase.js, 6/6 PASS):** exact boundaries at 30/1 (33/34ms), exact 1001ms=24 frames at 24000/1001, 2002ms=60 frames at 30000/1001, frame↔ms round-trip identity over **10,000 conversions × 5 policies with zero accumulation**, monotonicity over 20s of NTSC steps, negative/unknown rejected.

## 5. GAP-005 evidence (Media Conform / Color — partial owner)

- `lib/timeline/media-conform.js`: canonical `MediaConformMetadata` (mediaType, durationMs, width/height, rational frameRate, CFR/VFR + confidence, pixelAspectRatio, rotation, audioSampleRate/channels, color block with confidence) — injectable provider so real probing integrates without contract change.
- Versioned `MEDIA_CONFORM_POLICIES` (`web-standard-conform@1.0.0`): `evaluateConform` returns machine-readable **DIRECT_USE | CONFORM_REQUIRED | REVIEW_REQUIRED | REJECT** with per-reason codes. VFR → `VFR_REQUIRES_CONFORM` (RULE 8); rotation/PAR/fps mismatch → CONFORM_REQUIRED; unknown metadata/color → REVIEW_REQUIRED (RULE 9); HDR transfer under SDR policy → REVIEW_REQUIRED.
- `lib/timeline/color-policy.js`: versioned `sdr-web-standard@1.0.0` (workingColorSpace sRGB, outputColorIntent rec709-srgb@1.0.0); per-asset source color with confidence **DECLARED | DETECTED | ASSUMED | UNKNOWN**; ASSUMED requires an explicit `assumedPolicyRef` (no silent guess); audio tracks carry no color semantics (no false findings).
- Registry updated: **GAP-004 = FIXED; GAP-005 = PARTIALLY_FIXED / PLANNED_FOR_4B** (encoded-output verification + transcoding execution remain 4B).

## 6–7. Canonical time model + timebase/frame mapping

Canonical duration derives EXCLUSIVELY from current approved Final Audio (`durationPolicy: FINAL_AUDIO_DURATION`, RULE 1): `canonicalDuration = {time: finalAudio.durationMs, frameCount: timeToFrameEndExclusive(durationMs)}`. All item ranges store both ms and exact frames; QA re-verifies every stored frame against the deterministic conversion (`FRAME_MAPPING_MISMATCH` on drift).

## 8–9. Master Timeline schema + Track/Item model

`schemas/master-timeline.schema.json` v1.0.0: version/projectId/timelineId/revision, policy refs (timebase/conform/color), canonicalDuration {time, frameCount}, sourceTiming {finalAudioArtifactId, finalMixHash, narrationTimingHash, alignmentArtifactId, alignmentTranscriptHash, captionArtifactId}, tracks (12 canonical kinds: NARRATION MUSIC SFX AMBIENCE VIDEO IMAGE CHART MAP DIAGRAM OVERLAY CAPTION TITLE), items (spec §10 contract: assetId, sourceRange, timelineRange with startFrame/endFrameExclusive, scene/shot/beat/segment ids, zIndex, conformRef+decision, colorRef, speechBound, locked, per-item dependencyHashes), appliedPatchIds, dependencyHashes, qa findings, qaStatus.

## 10. Asset resolution

`assetResolver(assetId) → {assetId, hash, type, durationMs?, conform?} | null` bridges to the canonical asset library (`lib/asset-library`). Unresolvable/path-only → `UNKNOWN_ASSET` finding + item excluded from approved state + QA FAIL (Case E — RULE 4). Hash mismatch detection supports `STALE_ASSET` semantics via per-item dependencyHashes.

## 11–12. Media conform + color in the build

Every item: conform evaluation against the timeline's target frame rate (decision + reasons stored as `conformDecision`); color attach for visual tracks only; unknown/assumed metadata findings are blocking-or-review per policy (Cases J/K/L).

## 13. Timeline build (§17)

Full flow implemented: load inputs → validate hashes (`STALE_INPUT_HASH` when alignment was built against a different narrationTimingHash) → canonical duration → timebase → tracks → asset resolution → conform → color refs → frame ranges → overlap/gap validation → manifest (ajv-validated) → QA. Representative build: 2.5-min timeline, 12 items across 6 track kinds, QA PASS.

## 14. Timeline QA (§23)

Finding codes implemented: UNKNOWN_ASSET, INVALID_RANGE (+overlap), SOURCE_RANGE_OVERFLOW, TIMELINE_RANGE_OVERFLOW, FRAME_MAPPING_MISMATCH, INVALID_TRACK_TYPE, STALE_INPUT_HASH, VFR_REQUIRES_CONFORM, UNKNOWN_MEDIA_METADATA, UNKNOWN_COLOR_METADATA, COLOR_POLICY_REVIEW_REQUIRED — each with reason + corrective action. (`PATCH_CONFLICT`/`LOCK_VIOLATION`/`SPEECH_TIMING_PROTECTED` surface as patch-result codes per spec §23.)

## 15. Local patch (§18/§19)

`patchTimeline` implements INSERT_ITEM / REMOVE_ITEM / REPLACE_ASSET / RETIME_ITEM / UPDATE_SOURCE_RANGE / MOVE_ITEM with:
- **Conflict protection:** `expectedRevision` mismatch → `PATCH_CONFLICT` (RULE 14; Case H).
- **Idempotency:** `appliedPatchIds` — same patchId replays as a no-op (§21; Case P).
- **Locks:** locked items block REMOVE/RETIME/MOVE/REPLACE (`LOCK_VIOLATION`) and survive rebuilds via identity preservation (Case I; §19).
- **Speech protection:** narration/speech-bound items reject RETIME and cross-track moves (`SPEECH_TIMING_PROTECTED`) — Final Audio owns that clock (RULE 7).
- Each patch re-runs QA and revalidates the schema; REPLACE_ASSET updates only the affected item's dependency hash (Case F — unrelated items byte-identical).

## 16. Dependency / idempotency (§20/§21)

`resolveTimelineInvalidation`: speech-timing hash change → `timelineTimingDirty`; mix-only (finalMixHash) change → only `timelineMixRefDirty`, speech timeline CLEAN (Case O — Phase 2 distinction preserved); visual replacement → per-item only. Rebuild with identical inputs yields an identical semantic manifest (content-derived item ids, Case P).

## 17. Agent contract (§22)

`createTimelineStore()` — `buildTimeline / getTimeline / patchTimeline / validateTimeline / getTimelineFindings` per projectId; structured results only, no UI. MCP/public API deliberately NOT frozen.

## 18. Validation Cases A–P

All PASS in `tests/timeline/test-master-timeline.js` (18 tests incl. extras) + `tests/timeline/test-timebase.js` (6 tests):

| Case | Result | Evidence |
|---|---|---|
| A 2–3 min canonical timeline | PASS | 150s Final Audio anchor, 12 items, 6 track kinds, QA PASS |
| B exact frame mapping | PASS | 24/1, 25/1, 30/1, 24000/1001, 30000/1001 exact + round-trip |
| C audio-derived duration | PASS | 150000→158000ms updates duration+frames deterministically |
| D long visual source trim | PASS | source vs timeline ranges independent, duration preserved |
| E unknown asset | PASS | path-only rejected, UNKNOWN_ASSET, QA FAIL |
| F local replace asset | PASS | only affected item dirty; speech timing CLEAN |
| G local retime | PASS | frames recomputed; no mapping mismatch |
| H stale patch | PASS | PATCH_CONFLICT |
| I locked item | PASS | survives unrelated rebuild |
| J VFR media | PASS | CONFORM_REQUIRED + VFR_REQUIRES_CONFORM, never silent CFR |
| K color metadata present | PASS | preserved with policy refs |
| L color metadata unknown | PASS | REVIEW_REQUIRED; ASSUMED-without-ref flagged |
| M mixed sources | PASS | video/image/chart all resolve by assetId |
| N caption timing import | PASS | Phase 2 artifacts referenced; stale alignment detected, no regeneration |
| O mix-only change | PASS | speech timeline CLEAN, mix ref only |
| P idempotent rebuild | PASS | stable semantic manifest; patch replay no-op |

## 19. Performance baseline (§25, measured 2026-10-07, 62-item 3-min timeline)

| Metric | Value |
|---|---|
| Timeline build latency | 40 ms |
| Validation latency | < 1 ms |
| Single patch latency | 1 ms |
| Manifest serialization size | 39 KB |
| Asset resolution | inlined resolver (~µs/op) |
| time→frame conversion (10,000 ops) | 1 ms |
| Media conform evaluation | < 1 ms |
| Full rebuild vs local patch | patch path mutates one item + QA only (measured 1 ms vs 40 ms) — ~40× work avoided |

No budget claims beyond this baseline (no arbitrary caps invented).

## 20. Regression

```
node scripts/run-tests.js timeline → 6 + 18 = 24 tests PASS
npm test (final, after 3A)         → see AGENT_HANDOFF.md "FINAL REGRESSION" (executed after all 3A changes)
npm run check:repo-structure       → REPOSITORY_STRUCTURE_OK
```

## 21. Market Gap Registry update

GAP-004 → **FIXED** (evidence §4). GAP-005 → **PARTIALLY_FIXED / PLANNED_FOR_4B** (evidence §5). No newly discovered Phase-3-blocking P0/P1. New gaps registered: none beyond the existing registry entries (proxy/mezzanine remains 5C-triggered; watch pass remains 6A).

## 22. Quality Gate (§28)

All sections PASS: TIMING (7/7), MASTER TIMELINE (7/7), MEDIA CONFORM (7/7), COLOR (6/6), LOCAL PATCH (7/7), AGENT/TRACEABILITY (5/5), MARKET GAP (4/4), COMPLETION (Cases A–P PASS, performance persisted, P0=0, P1=0, regression PASS, hygiene PASS, report persisted).

## 23. Honest limitations

- **Media conform decides but does not transcode** — a `CONFORM_REQUIRED` item requires a Phase-4B/5 execution step; no probe backend is wired into the builder yet (metadata provider is injectable; `lib/media-preflight`/`media-probe` integrate as providers later).
- Color is metadata/policy only — no color conversion execution (Phase 4B verifies encoded output).
- VFR detection relies on the metadata provider declaring `scanType`; the builder trusts declared confidence and flags UNKNOWN.
- `UNRESOLVED_REQUIRED_GAP` (visual coverage gaps) is not yet enforced — visual track gap policy is a Phase 3B/3C concern once motion/scene coverage rules exist.
- Manifest persistence to the project workspace is left to callers (store facade is in-memory); wiring into the workspace governance layer is a natural Phase 3B step.

## 24. Final verdict (§30)

```
PHASE_3A_FUNCTIONAL                = PASS
PHASE_3A_QUALITY_GATE              = PASS
MASTER_TIMELINE                    = READY
TIMEBASE_POLICY                    = PASS
FRAME_ROUNDING                     = PROVEN
MEDIA_CONFORM                      = READY
COLOR_METADATA_FOUNDATION          = READY
LOCAL_TIMELINE_PATCH               = PROVEN
STALE_PATCH_PROTECTION             = PROVEN
GAP_004                            = FIXED
GAP_005                            = PARTIAL
P0                                 = 0
P1_CRITICAL                        = 0
FULL_REGRESSION                    = PASS
HYGIENE                            = PASS
PHASE_3A                           = COMPLETE
PHASE_3B_READY                     = YES
```

## 25. NEXT (§31)

```
PHASE 3A PASS → PHASE 3B — MOTION SYSTEM (3.2 Motion Primitive Library + 3.3 Editing/Motion Grammar)
```

Before 3B prompt freeze: latest roadmap + updated Market Gap Registry + this report + fresh market benchmark must be reviewed. GAP-004 is closed — the 3B blocker is cleared.
