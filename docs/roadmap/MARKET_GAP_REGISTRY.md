# UNFOLDIQ MARKET GAP REGISTRY

**Created:** 2026-10-07 (Post-Phase-2 retroactive audit, spec §13–§15)
**Rule 12:** future prompts MUST read this registry before scope freeze.
**Rule 10:** every gap has an owner + severity + explicit decision.

Decision rule: `ADD_NOW` (P0/P1 or security/data-loss/rights/duplicate-spend risk or major downstream rework) · `MERGE_FUTURE_PACKAGE` · `POST_V1` · `REJECT`.

---

## GAP-001 — Trusted Device Pairing

- **Owner capability:** Flow Companion / Bridge auth (Track E)
- **Discovered:** 07/10/2026
- **Benchmark:** Chrome externally_connectable + origin allowlist; DPAPI-protected local secrets; device-identity + short-lived-session patterns (Premiere/Descript-class companion apps never expose token UX)
- **Current UNFOLDIQ (pre-fix):** normal user had to copy/paste a long-lived bridge bearer token; "remember token" = plaintext file
- **Gap:** user-managed secret UX; long-lived bearer persisted as plaintext
- **Severity:** P1 (security + UX)
- **Downstream impact:** blocks normal-user adoption of the Flow integration
- **Decision:** **ADD_NOW — FIXED in this package**
- **Target package:** POST-PHASE-2 (this)
- **Evidence:** `lib/device-pairing` (DeviceIdentity, DPAPI SecretStore, challenge/proof, RuntimeSession); bridge pairing routes; tests/pairing 18 tests PASS
- **Status:** FIXED

## GAP-002 — Runtime Browser/Profile Storage Lifecycle

- **Owner capability:** local runtime storage (Track E)
- **Discovered:** 07/10/2026 (measured: `pw-flow-profile` = 4.45 GB, of which 4.17 GB = Chrome `OptGuideOnDeviceModel` — pure disposable model cache; real auth data `Default` = 94 MB)
- **Benchmark:** browser profile lifecycle management; cache classification + retention budgets
- **Current UNFOLDIQ (pre-fix):** no lifecycle classification, no cleanup, unbounded growth of reproducible model caches mixed with durable auth state
- **Gap:** unbounded disposable growth; no measurement/cleanup tooling
- **Severity:** P2 (disk growth; not security)
- **Downstream impact:** user-visible disk pressure over long automation use
- **Decision:** **ADD_NOW — FIXED in this package** (policy + scan/dry-run/clean, path-guarded)
- **Target package:** POST-PHASE-2 (this)
- **Evidence:** `lib/runtime-storage` + CLIs; real cleanup reclaimed 4237.4 MB (4.45 GB → 111 MB) with auth data intact; tests/storage 5/5
- **Status:** FIXED

## GAP-003 — storageState vs Persistent Profile

- **Owner capability:** Playwright browser-session persistence (Track E, spec §11.3)
- **Discovered:** 07/10/2026
- **Benchmark:** Playwright `storageState` vs `launchPersistentContext`
- **Current UNFOLDIQ:** full persistent profile `pw-flow-profile` used for Flow automation
- **Gap:** cannot yet prove the full profile is required vs a minimal isolated `storageState`
- **Severity:** P2
- **Decision:** **MERGE_FUTURE_PACKAGE** — experiment tooling shipped (`scripts/diagnostics/storage-state-experiment.js`); live run on 2026-10-07 returned **NOT_PROVEN: baseline itself not logged in** (Google session in `pw-flow-profile` expired — last live use 2026-10-05). Decision locked once the operator performs one fresh live Flow login and re-runs the script.
- **Status:** OPEN (blocked on live operator login, not on engineering)

## GAP-004 — Timeline Timebase / Frame Rounding

- **Owner capability:** Master Timeline (Phase 3A)
- **Discovered:** 07/10/2026
- **Severity:** P1 (architectural; causes expensive rework if deferred past 3A)
- **Decision:** **ADD_NOW — FIXED in Phase 3A** (2026-10-07): rational `FrameRate {numerator, denominator}` + versioned `TIMELINE_TIMEBASE_POLICIES` (web-30, web-2997 w/ drop-frame, film-24, pal-25, ntsc-23976) + centralized deterministic integer time↔frame conversion (`lib/timeline/timebase.js`); exact-boundary + round-trip + no-accumulating-drift proofs over 24/1, 25/1, 30/1, 24000/1001, 30000/1001 (`tests/timeline/test-timebase.js` 6/6).
- **Evidence:** Phase 3A report §4; canonical time unit remains proven integer-ms with derived frames.
- **Status:** FIXED

## GAP-005 — Media Conform / Color Management

- **Owner capability:** visual pipeline (Track B)
- **Severity:** P2
- **Decision:** **PARTIALLY_FIXED in Phase 3A** (2026-10-07): canonical `MediaConformMetadata` (dims/fps-rational/CFR-VFR/PAR/rotation/audio/color with per-field confidence DECLARED|DETECTED|ASSUMED|UNKNOWN), versioned `MediaConformPolicy` (DIRECT_USE/CONFORM_REQUIRED/REVIEW_REQUIRED/REJECT, VFR never silent-CFR), versioned `ColorManagementPolicy` (input/working/output distinct; unknown explicit). Remaining owner — **Phase 4B**: final encoded-output color verification, delivery compliance, actual transcoding execution.
- **Evidence:** `lib/timeline/media-conform.js`, `lib/timeline/color-policy.js`, tests in `tests/timeline/`.
- **Status:** PARTIALLY_FIXED / PLANNED_FOR_4B

## GAP-006 — Versioned Export Profiles

- **Owner capability:** render/export (Track B/C)
- **Severity:** P2
- **Decision:** **MERGE_FUTURE_PACKAGE → Phase 4B**
- **Status:** PLANNED

## GAP-007 — Proxy / Mezzanine Media

- **Severity:** P3
- **Decision:** **MERGE_FUTURE_PACKAGE → Phase 5C, only if profiling proves a bottleneck**
- **Status:** DEFERRED

## GAP-008 — Final Multimodal Watch Pass

- **Owner capability:** QA (Track B/C)
- **Severity:** P2
- **Decision:** **MERGE_FUTURE_PACKAGE → Phase 6A**
- **Update 08/10/2026 (Phase 6A):** **FIXED** — `lib/creative-retention/watch.js`: FULL_WATCH / SEGMENT_REWATCH over synchronized video/audio/narration/music/SFX/captions/on-screen text/story/packaging promise; semantic segmentation (hook windows, beats, scenes, transitions, payoff, outro; equal windows only fill gaps); redundancy / contradiction (routed to Phase 4 taxonomy) / cognitive-overload / payoff-emphasis / transition / outro checks; injectable reviewer with persisted trace and REVIEW_REQUIRED on disagreement. Real pilot FULL_WATCH consumed `final.mp4` (sha256 == accepted artifact). Residual: no autonomous multimodal-model provider is integrated (GAP-046).
- **Status:** FIXED

## GAP-009 — Alignment Provider Real-Production Quality

- **Owner capability:** forced alignment (Track D)
- **Benchmark:** WhisperX/MFA-class acoustic-model aligners
- **Current UNFOLDIQ:** `local-energy-known-text` deterministic energy-based aligner (word boundaries are estimates inside continuous speech)
- **Severity:** P2
- **Decision:** **MERGE_FUTURE_PACKAGE** — trigger-registered: upgrade the provider ONLY if real Kokoro/long-form validation fails the alignment quality target (spec §13.4); the `AlignmentProvider` contract accepts a drop-in replacement with no contract change
- **Status:** DEFERRED (trigger registered)

## GAP-010 — Full interactive caption editor UI / NLE-style timeline UI

- **Benchmark:** Premiere Speech-to-Text panel, Descript editor
- **Severity:** P3
- **Decision:** **REJECT for V1** — UNFOLDIQ is a headless, agent-driven product; manual editor parity does not fit; revisit POST_V1 only if operator workflow proves a need
- **Status:** REJECTED

## GAP-011 — Chrome Native Messaging transport

- **Benchmark:** Chrome Native Messaging with `allowed_origins` per extension ID
- **Severity:** P3
- **Decision:** **REJECT for V1** — measured trade-off recorded in `docs/roadmap/FLOW_BRIDGE_TRANSPORT_DECISION.md` (KEEP_AND_HARDEN wins); revisit only if loopback ports get blocked by enterprise policy
- **Status:** REJECTED (with re-open condition)

## GAP-012 — Transition Timing / Handle Semantics

- **Owner capability:** Motion System (Phase 3B)
- **Discovered:** 07/10/2026
- **Benchmark:** Remotion `TransitionSeries` (presentation/from/timing separation; transition duration cannot exceed adjacent sequence duration; invalid adjacent combinations rejected — https://www.remotion.dev/docs/transitioning); Premiere transition alignment (CENTER_AT_CUT / START_AT_CUT / END_AT_CUT) + handle/duration requirements (https://helpx.adobe.com/premiere/desktop/add-video-effects/apply-video-transitions/align-transitions.html)
- **Current UNFOLDIQ (pre-fix):** no transition model at all — duration/alignment could break canonical timing or require unavailable source frames
- **Gap:** transition duration/alignment/handle semantics missing; naive overlap math could drift canonical timeline duration
- **Severity:** P1 (architectural)
- **Downstream impact:** silent canonical-duration drift, frozen-frame fabrication, invalid transition adjacency
- **Decision:** **ADD_NOW — FIXED in Phase 3B** (2026-10-07): separate presentation/timing contracts (`lib/motion/primitives.js` + `lib/motion/timing.js`), explicit `alignment`/`durationFrames`/`sourceHandleRequirement` per transition, feasibility validator (duration ≤ adjacent usable range, handles exist, cut-boundary exactness, duplicate-cut rejection), canonical-duration preservation proof (`lib/motion/motion-plan.js`; `tests/motion/test-motion-system.js` Cases G–J)
- **Evidence:** Phase 3B report §§9–10; 22-primitive registry; transition windows frame-exact
- **Status:** FIXED

## GAP-013 — Motion Flash Safety

- **Owner capability:** Motion System (Phase 3B) / Final QC (Phase 4B)
- **Discovered:** 07/10/2026
- **Benchmark:** W3C WCAG 2.2 seizures/physical-reactions + three-flashes (>3 flashes in any 1s period must not be exceeded — https://www.w3.org/WAI/WCAG22/Understanding/three-flashes.html)
- **Current UNFOLDIQ (pre-fix):** no flash policy; high-contrast effects undeclarable
- **Gap:** flashing transitions/effects could pass planning without any safety gate
- **Severity:** P1 (safety)
- **Downstream impact:** photosensitive-epilepsy risk in rendered output
- **Decision:** **ADD_NOW foundation in Phase 3B** (2026-10-07): versioned `FlashSafetyPolicy` (max 3 flashes/1s sliding window), `safety.mayFlash` metadata on LIGHT_SWEEP/WIPE, plan-level validation (`FLASH_SAFETY_FAIL` BLOCK / `FLASH_SAFETY_REVIEW`), structured repair (replace with FADE/CUT). Final **encoded-output** flash validation stays Phase 4B. No certified-analyzer claim.
- **Evidence:** `lib/motion/grammar.js` `validateFlashSafety`; Case P injection blocked
- **Status:** PARTIALLY_FIXED / FINAL_OUTPUT_CHECK_4B

## GAP-014 — Motion Blur Cost Awareness

- **Owner capability:** Motion System (Phase 3B) / Render profiling (Phase 5)
- **Discovered:** 07/10/2026
- **Benchmark:** Remotion motion blur costs real render work (multi-frame sampling; higher samples = more cost — https://www.remotion.dev/docs/motion-blur)
- **Current UNFOLDIQ (pre-fix):** motion blur not modeled anywhere
- **Gap:** no cost class, no enable-by-default guard, no samples/shutterAngle record
- **Severity:** P2
- **Downstream impact:** unbounded render-cost growth if blur becomes default decoration
- **Decision:** **ADD_NOW metadata + baseline in Phase 3B** (2026-10-07): `renderCostClass` LOW/MEDIUM/HIGH per primitive, `supportsMotionBlur` capability, blur OFF by default with reason/samples/shutterAngle persisted when enabled, `MOTION_COST_REVIEW` finding + disable-blur repair. Optimization DEFERRED to Phase 5 profiling.
- **Evidence:** `lib/motion/primitives.js` cost classes; Case Q
- **Status:** PARTIALLY_FIXED / OPTIMIZATION_DEFERRED_5

---

## GAP-015 — Override Precedence / Reset / History

- **Owner capability:** Timeline Control (Phase 3C)
- **Discovered:** 07/10/2026
- **Benchmark:** Runway Agent/Timeline Studio (agent + manual co-editing, Undo/Redo, manual trim — https://help.runwayml.com/hc/en-us/articles/51601639579667-Creating-with-Runway-Agent)
- **Current UNFOLDIQ (pre-fix):** roadmap promised override-survives-rerun but no precedence/history/reset semantics — agent could overwrite human intent, stale overrides could silently persist, rollback undefined
- **Gap:** explicit override precedence, attributable history, deterministic undo/redo/reset, stale-conflict semantics
- **Severity:** P1 (architectural)
- **Downstream impact:** lost operator intent, ambiguous rollback, silent stale replay
- **Decision:** **ADD_NOW — FIXED in Phase 3C** (2026-10-07): versioned `ManualOverrideRecord` + precedence SAFETY > OPERATOR > LOCKED > REPAIR > AGENT > DEFAULT, replay-onto-fresh-build (survives rerun), append-only history with conflict-aware undo/redo, RESET/RESET_SCOPE, freshness check → OVERRIDE_CONFLICT (`lib/override/overrides.js`; Cases A–J)
- **Evidence:** Phase 3C report §§4–10; `tests/override/test-override.js` 10/10
- **Status:** FIXED

## GAP-016 — Responsive Variant Lineage

- **Owner capability:** Timeline Control (Phase 3C)
- **Discovered:** 07/10/2026
- **Benchmark:** Premiere Auto Reframe (duplicate reframed sequence derived from source, operator-tunable — https://helpx.adobe.com/premiere/desktop/add-video-effects/commonly-used-effects/auto-reframe-overview.html); Remotion parameterized rendering (contract-driven layout values)
- **Current UNFOLDIQ (pre-fix):** single-canvas timeline only; any second aspect ratio would become an independent duplicated project state
- **Gap:** derived-variant model with traceable lineage + variant-scoped overrides + local rebase
- **Severity:** P1 (architectural)
- **Downstream impact:** divergent timelines, base mutations from portrait edits, full blind regeneration on base change
- **Decision:** **ADD_NOW — FIXED in Phase 3C** (2026-10-07): BASE → derived variant (layout/reframe plan + variant-only overrides), lineage (source timeline/motion revisions, profile version, override revisions), `rebaseVariant` (affected branches only, compatible overrides preserved, conflicts explicit), variant patch isolation (`lib/responsive/variant.js`; Cases K/T/U/V)
- **Evidence:** Phase 3C report §§12–18; `tests/responsive/test-responsive.js` 15/15
- **Status:** FIXED

## GAP-017 — Subject-aware Reframe / Manual Reframe Override

- **Owner capability:** Timeline Control (Phase 3C)
- **Discovered:** 07/10/2026
- **Benchmark:** Premiere Auto Reframe subject identification + generated keyframed path + operator overwrite (same refs as GAP-016)
- **Current UNFOLDIQ (pre-fix):** no framing contract; nothing to drive a portrait crop honestly
- **Gap:** framing contract + confidence + manual override + review fallback, without a heavyweight CV tracker unless proven necessary
- **Severity:** P2
- **Downstream impact:** decapitated subjects in 9:16 or false tracking claims
- **Decision:** **ADD_NOW foundation in Phase 3C** (2026-10-07): `SubjectFraming` contract (OPERATOR > trusted metadata ≥0.5 > static bounds > FALLBACK+REVIEW), smoothed bounded reframe paths (moving-average + step clamp + jitter metric), operator anchor/path override wins, no tracker built — quality gate did not prove metadata insufficient. Cases L–O prove it.
- **Evidence:** `lib/responsive/variant.js` `resolveFraming`/`smoothPath`; Case N (jitter reduced, maxStep ≤ 0.015)
- **Status:** FIXED (foundation; tracker trigger registered: add CV only if future quality evidence demands it)

## GAP-018 — Safe-Zone / Layout Validation

- **Owner capability:** Timeline Control (Phase 3C) / Final QC (Phase 4B)
- **Discovered:** 07/10/2026
- **Benchmark:** Premiere safe-zone guides (titles/graphics visibility across displays); TikTok UI overlay regions (platform PROFILE: 9:16 + bottom UI zone)
- **Current UNFOLDIQ (pre-fix):** no safe zones; caption/title/overlay/data layout unvalidated per aspect ratio
- **Gap:** profile-driven safe zones + layout validation for captions/titles/overlays/charts/maps/diagrams
- **Severity:** P1 (layout correctness; safety-adjacent for readability)
- **Downstream impact:** cropped labels, overflowing captions, unreadable titles in 9:16
- **Decision:** **ADD_NOW foundation in Phase 3C** (2026-10-07): per-profile safe zones (action/title/caption/criticalSubject, TikTok bottom-weighted), caption reflow (text identity preserved), title/overlay bounds (never below readability scale), data-graphic re-layout (RE_STACK/SWITCH_RESPONSIVE, never destructive crop), machine-readable findings + bounded repair. Final **encoded-output** visual validation stays Phase 4B.
- **Evidence:** `lib/responsive/profiles.js` + variant QA; Cases P–S
- **Status:** PARTIALLY_FIXED / FINAL_OUTPUT_CHECK_4B

---

## GAP-019 — Paired Title/Thumbnail Experiment Model

- **Owner capability:** Publish Packaging (Phase 4A)
- **Discovered:** 07/10/2026
- **Benchmark:** YouTube Studio A/B testing (TITLE ONLY / THUMBNAIL ONLY / TITLE+THUMBNAIL, up to 3 variants, winner by watch time — https://support.google.com/youtube/answer/16391400)
- **Current UNFOLDIQ (pre-fix):** single-thumbnail plan schema only (POST-v1C `thumbnail-package.schema.json`); no variant, hypothesis, or pairing model
- **Gap:** title+thumbnail pairs as first-class testable units with stored hypotheses and material distinctness
- **Severity:** P1 (product-quality)
- **Downstream impact:** cosmetic pseudo-variants, untestable packaging, CTR-only thinking
- **Decision:** **ADD_NOW — FIXED in Phase 4A** (2026-10-07): `PublishExperimentSet` (2–3 paired variants, concept/audience/hypothesis each, 3 experiment modes, watch-time-aware hypotheses, selection with reason), structural diversity QA (same-claim+same-asset / ≥0.8 title overlap → VARIANTS_TOO_SIMILAR), no 3×3 explosion. No YouTube A/B API integration (explicitly out of scope).
- **Evidence:** `lib/packaging/experiment.js`; Cases A/B/W
- **Status:** FIXED

## GAP-020 — Claim Fidelity / Anti-Misleading Packaging

- **Owner capability:** Publish Packaging (Phase 4A) / Final Content QA (Phase 4B)
- **Discovered:** 07/10/2026
- **Benchmark:** YouTube misleading-metadata policy (no titles/thumbnails/descriptions promising undelivered content — https://support.google.com/youtube/answer/2801973); title quality guidance (accurate, succinct, key words early — https://support.google.com/youtube/answer/12340300)
- **Current UNFOLDIQ (pre-fix):** no packaging claim model; a catchy title could ship with zero content support
- **Gap:** claim extraction → evidence/video mapping → blocking false promise
- **Severity:** P1
- **Downstream impact:** clickbait publish, platform strikes, trust loss
- **Decision:** **ADD_NOW foundation in Phase 4A** (2026-10-07): `PackagingClaim` map (TITLE/THUMBNAIL_TEXT/THUMBNAIL_VISUAL/DESCRIPTION → VIDEO_CONTENT/EVIDENCE/BOTH), gate (UNSUPPORTED material → BLOCK, PARTIAL/absolute-language/synthetic-as-footage → REVIEW), title↔thumbnail↔video consistency, repair reduces/replaces (never fabricates support). Final revalidation against actual final.mp4 stays Phase 4B.
- **Evidence:** `lib/packaging/claims.js`; Cases G–K (incl. dinosaur counter-example BLOCK)
- **Status:** PARTIALLY_FIXED / FINAL_REVALIDATION_4B

## GAP-021 — Platform Publish Profile

- **Owner capability:** Publish Packaging (Phase 4A) / Final Render QC (Phase 4B)
- **Discovered:** 07/10/2026
- **Benchmark:** YouTube title/description limits (100 / 5000 chars — https://support.google.com/youtube/answer/57407); thumbnail guidance (16:9, ≥640 wide, JPG/PNG — https://support.google.com/youtube/answer/72431); tags minimal role (https://support.google.com/youtube/answer/146402)
- **Current UNFOLDIQ (pre-fix):** limits scattered or absent; old 1280×720 assumption risk; no publish schema
- **Gap:** versioned per-platform profile (title/description/thumbnail/required metadata/audience/rights) + publish package schema
- **Severity:** P1 (architectural)
- **Downstream impact:** over-limit uploads, wrong-aspect thumbnails, incomplete publish metadata
- **Decision:** **ADD_NOW — FIXED foundation in Phase 4A** (2026-10-07): `YOUTUBE_LONG_FORM@1.0.0` profile, hard-limit validators, thumbnail geometry/format/size validators, metadata priority model (tags last, capped 10, dedupe), versioned manifest + experiment + metadata artifacts. Final encoded-output profile remains Phase 4B.
- **Evidence:** `lib/packaging/profiles.js` + `package.js`; Cases C–F/P/X
- **Status:** FIXED (foundation; encoded-output profile → 4B)

## GAP-022 — Packaging Experiment Metrics

- **Owner capability:** Publish Packaging (Phase 4A) / post-publish analytics
- **Discovered:** 07/10/2026
- **Benchmark:** YouTube picks A/B winners by watch time, not CTR alone (same ref as GAP-019)
- **Current UNFOLDIQ (pre-fix):** no artifact carried variant identity beyond publish
- **Gap:** variant ID + hypothesis + selection must survive so later analytics can join
- **Severity:** P2
- **Downstream impact:** unmeasurable packaging experiments
- **Decision:** **ADD_NOW artifact/schema in Phase 4A** (2026-10-07): experimentSetId/variantId/hypothesis/selectionReason persisted in set + manifest + metadata `sourceHashes`; hypotheses framed as click-appeal + content-match + watch-time quality (no fabricated metric predictions). No automatic post-publish analytics collection in V1.
- **Evidence:** experiment set + manifest schemas; Case X
- **Status:** FIXED (artifact; analytics collection POST_V1)

---

## GAP-023 — Renderer Adapter / Production Composition Mapping

- **Owner capability:** Pilot Finalization (Phase 4B)
- **Discovered:** 07/10/2026
- **Benchmark:** Remotion renderer/encoding options (codec, audio codec, pixel format, dims, fps, bitrate — https://www.remotion.dev/docs/encoding); prior phases stopped at planning data by design
- **Current UNFOLDIQ (pre-fix):** MasterTimeline/MotionPlan/overrides/variants/captions/audio had no path to real Remotion components
- **Gap:** centralized planning→renderer mapping with honest unsupported-primitive blocking
- **Severity:** P1 (architectural)
- **Downstream impact:** unrenderable plans, silent STATIC fallbacks
- **Decision:** **ADD_NOW — FIXED in Phase 4B** (2026-10-07): versioned `RenderMappingDefinition` registry (track→layer, 22 primitives → MotionPreset/transition with DIRECT/DOCUMENTED_APPROXIMATION/BLOCKED policies), preflight `UNSUPPORTED_RENDER_MAPPING` (HANDHELD/PARALLAX/LIGHT_SWEEP/PARTICLES block, never silent STATIC), renderer consumes resolved canonical values, options+versions persisted in RenderJob
- **Evidence:** `lib/render/mapping-registry.js`; Cases A/B; real 150s pilot rendered through the mapped path
- **Status:** FIXED

## GAP-024 — Versioned Final Export Profile

- **Owner capability:** Pilot Finalization (Phase 4B)
- **Discovered:** 07/10/2026
- **Benchmark:** YouTube recommended encoded upload settings (MP4/H.264/AAC/48kHz/BT.709 SDR — https://support.google.com/youtube/answer/1722171)
- **Current UNFOLDIQ (pre-fix):** no encoded-output profile; renderer defaults assumed compliant
- **Gap:** versioned profile + actual-file verification (assumption caused a real miss: V1 renderer emitted full-range yuvj420p, caught only by encoded QC)
- **Severity:** P1
- **Downstream impact:** non-compliant uploads, wrong-range luma
- **Decision:** **ADD_NOW — FIXED in Phase 4B** (2026-10-07): `YOUTUBE_SDR_1080P@1.0.0` + recorded delivery-conform stage (mezzanine→profile with hashes + ffmpeg args), pilot final proves MP4/H.264/AAC/48k/stereo/1080p/30fps/yuv420p/BT.709
- **Evidence:** `lib/render/export-profile.js` + `delivery.js`; pilot probe.json; Cases C–F
- **Status:** FIXED

## GAP-025 — Encoded Output Validation

- **Owner capability:** Pilot Finalization (Phase 4B)
- **Discovered:** 07/10/2026
- **Benchmark:** FFmpeg deterministic filters (blackdetect/freezedetect/silencedetect/loudnorm — https://ffmpeg.org/ffmpeg-filters.html)
- **Current UNFOLDIQ (pre-fix):** plan-level PASS treated as sufficient; no file inspection
- **Gap:** actual-file proof of container/codecs/dims/fps/duration/rate/channels/pixfmt/color/decodability + context-aware black/freeze/silence/duplicate/placeholder/artifact/audio/sync/caption/outro QC
- **Severity:** P1
- **Downstream impact:** corrupt/mismatched finals shipped as PASS
- **Decision:** **ADD_NOW — FIXED in Phase 4B** (2026-10-07): ffprobe evidence + full-decode check + contextualized detectors (static-image ≠ freeze, tail-gap ≠ silence defect, fade ≠ black defect) + full §49 finding taxonomy + bounded repair routing
- **Evidence:** `lib/render/probe.js` + `qc.js`; pilot qc-evidence.json; Cases C–Q/X/Y
- **Status:** FIXED

## GAP-026 — Final A/V Encoded Sync Validation

- **Owner capability:** Pilot Finalization (Phase 4B)
- **Discovered:** 07/10/2026
- **Benchmark:** Phase 2 source-artifact sync (distinct concern); encoding/render must not introduce drift
- **Current UNFOLDIQ (pre-fix):** no post-encode timing proof
- **Gap:** encoded audio/video/caption start-end + drift validation against FinalAudioArtifact
- **Severity:** P1
- **Downstream impact:** lip/drift defects invisible to plan QA
- **Decision:** **ADD_NOW — FIXED in Phase 4B** (2026-10-07): `checkAVSync` (stream durations + FinalAudio duration match, 2.5s injection → ENCODED_AV_DRIFT BLOCK), caption final path, outro cutoff; pilot proves sync on real encode
- **Evidence:** `lib/render/qc.js`; Cases N/O/X
- **Status:** FIXED

## GAP-027 — Pilot Watch / Render Reality Check

- **Owner capability:** Pilot Finalization (Phase 4B)
- **Discovered:** 07/10/2026
- **Benchmark:** internal (Phase 6 owns creative optimization; 4B owns faithful-representation check)
- **Current UNFOLDIQ (pre-fix):** no end-to-end proof the chain reaches a watchable file
- **Gap:** real 2–3 min pilot, watched start/middle/end, packaging revalidated vs actual file, E2E baselines for Phase 5
- **Severity:** P1 (quality)
- **Downstream impact:** hidden manual-only dependencies, unmeasurable pipeline
- **Decision:** **ADD_NOW — FIXED in Phase 4B** (2026-10-07): 150s Kokoro-narrated pilot rendered + QC'd + content-watched (5 extracted frames) + packaging revalidated + finalized (hash-persisted, no PENDING) + telemetry-correlated + baselined (render 232s @19fps, 48.5MB, 0 failures, 0 interventions)
- **Evidence:** `out/final/pilot-4b.mp4` (gitignored artifact) + `Report/evidence/pilot-4b/` + `tests/render/test-pilot-4b.js` 31/31
- **Status:** FIXED

## GAP-005 — Media Conform / Color Management (CLOSED)

- **Update 07/10/2026 (Phase 4B):** final encoded-output verification complete — pilot proves `primaries=bt709 transfer=bt709 space=bt709 range=tv pixfmt=yuv420p` on actual file (probe.json). Full-range V1 renderer miss caught by QC and fixed via recorded delivery-conform. **Status: FIXED.**

## GAP-013 — Motion Flash Safety (CLOSED)

- **Update 07/10/2026 (Phase 4B):** encoded-output validation complete — frame-domain luminance analysis on actual pilot (300 frames @2fps: meanDelta/maxDelta/bigCount/maxInWindow) with conservative ≤3-flashes/1s rule; pilot shows no flash fail; injection (6-window) → FLASH_SAFETY_FAIL BLOCK. No WCAG certification claimed. **Status: FIXED** (plan-level + encoded-level; certified analysis explicitly out of scope).

## GAP-018 — Safe-Zone / Layout Validation (CLOSED)

- **Update 07/10/2026 (Phase 4B):** final-output validation complete — rendered geometry equals profile (1920×1080), caption/title layout rects verified inside profile zones against actual dimensions, 9:16 mapping sample executes with geometry. **Status: FIXED.**

## GAP-020 — Claim Fidelity / Anti-Misleading Packaging (CLOSED)

- **Update 07/10/2026 (Phase 4B):** revalidation against actual final.mp4 complete — selected claims present in rendered segments, thumbnail subject related, chapters inside encoded duration; render-change staleness → FINAL_PACKAGING_VIDEO_MISMATCH BLOCK (Cases V/W). **Status: FIXED.**

## GAP-021 — Platform Publish Profile (CLOSED)

- **Update 07/10/2026 (Phase 4B):** encoded-output profile complete — FinalExportProfile enforced + verified on file; 4A packaging profile linked. **Status: FIXED.**

## GAP-014 — Motion Blur Cost Awareness (MEASURED → ROUTED 5C → DEFERRED_WITH_EVIDENCE)

- **Update 07/10/2026 (Phase 5A):** runtime cost measured at registry level — `lib/motion/primitives.js` carries 1 HIGH `renderCostClass` reference; blur remains OFF by default with reason/samples/shutterAngle persisted when enabled (evidence: `Report/evidence/perf-5a/core-efficiency.json` → `motionBlurGap014`). Optimization stays deferred to Phase 5C per plan. **Status: PARTIALLY_FIXED / OPTIMIZATION_5C.**
- **Update 08/10/2026 (Phase 5C Task O):** no motion-blur renderer feature exists to benchmark — sole blur in codebase is a static CSS background-fill (`ImageLayer.tsx:102`), not temporal motion blur; no global toggle exists. Blur-OFF default preserved (nothing to change). Revisit trigger registered: benchmark on the 120-frame fixture before enabling any future motion-blur effect. Evidence: `Report/evidence/perf-5c/gap-014-motion-blur.json`. **Status: DEFERRED_WITH_EVIDENCE.**

## GAP-028 — Reproducible Performance Benchmark Protocol

- **Owner capability:** System profiling (Phase 5A)
- **Discovered:** 07/10/2026
- **Benchmark:** Chrome MV3 lifecycle docs (~30s inactivity timer, no indefinite keepalive); Node `perf_hooks` (marks/measures, eventLoopUtilization, monitorEventLoopDelay, histograms); OpenTelemetry context propagation (causal trace pattern); Remotion benchmark methodology (multiple concurrencies × multiple runs); Remotion memory/speed trade-offs (concurrency, media cache, OffthreadVideo cache, parallel encoding, HW accel); Core Web Vitals percentile distributions (directional UI reference only)
- **Gap:** no versioned environment fingerprint, no cold/warm separation, no raw-sample + percentile discipline, no instrumentation-overhead bound, no quality guard on budgets
- **Severity:** P1 (measurement integrity)
- **Decision:** **ADD_NOW — FIXED in Phase 5A** (2026-10-07): `benchmark-environment.json` (fingerprint incl. git commit/node/remotion/ffmpeg, unavailable = NOT_MEASURED), `raw-performance-samples.json` (raw before summaries, p95 n≥5 / p99 n≥100), cold/warm split (telemetry cold-first vs warm, bundle-cold vs render, no mixed averages), `summaries.json`, telemetry-overhead bound, budget regression policy with noise tolerance, RULE 1–20 permanent rules
- **Evidence:** `Report/evidence/perf-5a/` (12 artifacts) + `tests/perf/test-phase-5a.js` 18/18 + `lib/perf/` (stats/env/trace)
- **Status:** FIXED

## GAP-029 — Representative Provider Performance Baseline

- **Owner capability:** Provider profiling (Phase 5A)
- **Discovered:** 07/10/2026
- **Current UNFOLDIQ:** pilot used synthetic visuals + local TTS; cost policy `allowPaidCloud: false`; zero paid calls in history
- **Gap:** no representative provider wait/cost measurement; fabricating one would corrupt every downstream budget
- **Severity:** P1 (measurement integrity)
- **Decision:** **ADD_NOW — recorded as NOT_MEASURED with explicit plan** (2026-10-07): `provider-baseline.json` (status NOT_MEASURED, evidence order followed, paid dims never zero-filled); bounded live sample plan registered for Phase 5C (operator-authorized: 1 image + 1 video via flow-web, UNFOLDIQ overhead separated from provider wait)
- **Status:** OPEN (measurement-planned, not blocking: no Phase-5B work depends on paid-provider numbers)
- **Update 08/10/2026 (Phase 5C Task H):** baseline RECORDED from existing real traces — no new credits spent (evidence priority 1): live session FLOW-COMPANION-LIVE-GEN-01 (2026-10-01, Nano Banana 2, image 1:1): warm SESSION_REVALIDATED restore (~9ms tab ping), provider wait 5023ms (n=1, single sample — not a distribution), human waits separated (deliberation 33s, gesture 289s excluded from system wall), cost UNKNOWN (never zero-filled), restart reconciled without resubmit. Repeat trigger: n≥5 + verified credit readout on operator-authorized bounded sample. Evidence: `Report/evidence/perf-5c/provider-baseline.json`. **Status: FIXED (historical-sample grade).**

## GAP-030 — Cross-Boundary Causal Trace Completeness

- **Owner capability:** Observability (Phase 5A)
- **Discovered:** 07/10/2026
- **Benchmark:** OpenTelemetry context-propagation pattern (causal timing across process/service boundaries)
- **Current UNFOLDIQ:** projectId/runId/jobId/correlationId + job history chain + telemetry spans reconstruct the Core↔Bridge path (proven: restart-safe history, getTrace by correlationId)
- **Gap:** Extension actions emit no telemetry spans — Core→Bridge→Extension→provider action→result→import→ACK is NOT yet reconstructable end-to-end
- **Severity:** P1 (observability)
- **Decision:** **ADD_NOW — PARTIALLY_FIXED in Phase 5A** (2026-10-07): no telemetry rewrite for standards parity (current IDs suffice where emitted); follow-up registered (Extension span emission: submit/result/ACK events with traceId/parentSpanId into the existing store). Full OTel migration explicitly REJECTED without evidence
- **Evidence:** `Report/evidence/perf-5a/integration-performance-profile.json` → `traceCausality: PARTIAL`
- **Status:** PARTIALLY_FIXED
- **Update 08/10/2026 (Phase 5C Task G):** FIXED with live-browser proof. Root-caused why emission never fired in production: `trace-contract.js` was missing from the extension build manifest (`build.js` REQUIRED_FILES) so `importScripts` failed silently and spans were never attached — fixed (1 line + rebuild, build 31 files, extension unit 533/533). Added backward-compatible `msg.trace.{traceId,parentSpanId}` passthrough (no OTel rewrite). Proven end-to-end in real Chromium: Core span → sidepanel-origin APPROVE_RECORD → real SW span (APPROVAL_RECORDED, joined chain) → bridge `/trace` ingest → `reconstructTrace` yields one complete ordered chain (core→extension→bridge, latencies 560/1/13ms). Evidence: `Report/evidence/perf-5c/trace-chain.json` + `tests/e2e/mv3-lifecycle.spec.js` (Q). **Status: FIXED.**

## GAP-031 — Extension MV3 Lifecycle Performance

- **Owner capability:** Extension runtime (Phase 5A)
- **Discovered:** 07/10/2026
- **Benchmark:** Chrome MV3 service-worker lifecycle (event-driven, ~30s inactivity termination, long-request limits)
- **Gap:** cold wake / warm path / termination-restart / reconnect / message-wake amplification never measured; keepalive temptation unguarded
- **Severity:** P1/P2
- **Decision:** **ADD_NOW — PARTIALLY_FIXED in Phase 5A** (2026-10-07): Node-measurable subset measured (sender/message validation p95 ~µs, poll success/timeout paths, correlateDownload, DOM-scan worst-case sub-0.05ms over 200 nodes, payload bytes); keepalive audit PASS (bounded per-request timeouts only, approvals survive termination via storage.session mirror, fail-safe BLOCK); live-browser subset registered with plan (Playwright side-panel timing, MV3 terminate→wake harness, observer/polling/CPU/memory/storage harness). No indefinite keepalive adopted without evidence (RULE 12)
- **Evidence:** `Report/evidence/perf-5a/extension-runtime-profile.json`
- **Status:** PARTIALLY_FIXED
- **Update 08/10/2026 (Phase 5C Task F):** FIXED with live-browser proof (real Chromium, unpacked extension, no mocks): cold wake 4ms (fresh profile) / restart wake 375–408ms, warm storage round-trip 1–10ms, terminate (process-exit on persistent profile) → wake → storage restore OK, no keepalive added. Documented environment limit: natural ~30s idle termination is unobservable under Playwright (CDP attachment keeps the worker alive) — termination variant is process-exit, honestly labeled. Bridge reconnect/state-restore ownership stays with `flow-companion.spec.js` (still green). Evidence: `Report/evidence/perf-5c/mv3-lifecycle.json` + `tests/e2e/mv3-lifecycle.spec.js` (N,O,P). **Status: FIXED.**

## GAP-032 — Full Rerender on Local Visual Repair

- **Owner capability:** Render efficiency (Phase 5A measure → Phase 5B fix)
- **Discovered:** 07/10/2026 (Phase 4B Case AC: V1 renderer has no safe segment-stitch path)
- **Gap:** any local visual defect costs one FULL rerender (232s at pilot scale)
- **Severity:** P1 (efficiency)
- **Decision:** **FIXED in Phase 5B** (2026-10-07): representative local repair (S03 visual swap on the 150s/4500-frame pilot timeline) reaches approved output rendering only dirty frames [1800,2700) — 900/4500 browser frames (165s vs 213s full reference), 3600 cached frames reused, range-aware conform, full structural equivalence vs fresh full-render oracle (container/resolution/fps/pixfmt/duration/audio exact), complete partial-QA coverage (7 local + 3 boundary + 4 global). Pass condition met with real proof
- **Evidence:** `Report/evidence/perf-5b/repair-benchmark.json` + `tests/incremental/test-pilot-repair-{a,b}.js` 7/7
- **Status:** FIXED

## GAP-033 — Content-Addressed Cache / Action-Key Correctness

- **Owner capability:** Incremental compute (Phase 5B, 5.2)
- **Discovered:** 07/10/2026
- **Benchmark:** Bazel action cache + CAS pattern (action hash → result metadata; content hash → immutable bytes)
- **Gap:** no safe reuse identity — filename/mtime keys risk stale reuse; identical bytes duplicated
- **Severity:** P1
- **Decision:** **ADD_NOW — FIXED in Phase 5B** (2026-10-07): ActionKey = hash(action type + schema + input hashes + tool/renderer + policy versions + config + frame range); CAS `sha256/<content-hash>` immutable bytes (write-temp → fsync → verify → rename → publish); 10 type-specific namespaces; HIT_VALID/MISS/HIT_INVALID with 11 persisted miss reasons; same-key single-flight; secrets/auth-state rejected from cache
- **Evidence:** `lib/render-cache/index.js` + `tests/incremental/test-render-cache.js` 12/12 (Cases H–T)
- **Status:** FIXED

## GAP-034 — Incremental Boundary / Transition Safety

- **Owner capability:** Incremental compute (Phase 5B, 5.1)
- **Discovered:** 07/10/2026
- **Benchmark:** Premiere preview reuse (changed sections invalidate locally) + section rendering (exact In/Out ranges); Remotion frame-range rendering (`frameRange`, `renderFrames`, `stitchFramesToVideo`)
- **Gap:** naive per-scene invalidation drops transition overlaps, motion temporal handles, caption pads → stale boundary frames
- **Severity:** P1
- **Decision:** **ADD_NOW — FIXED in Phase 5B** (2026-10-07): raw → expanded ranges with persisted reasons (transition overlap, motion temporal samples, caption pads); global invalidation for fps/timebase/canvas/renderer/theme/font/color/primitive-impl changes; exact-once assembly validation (gap/overlap/duplicate/profile guards); Remotion range primitive owned by UNFOLDIQ invalidation/cache/assembly/QA
- **Evidence:** `lib/incremental/index.js` + `pipeline/incremental-render.js` + Cases B/C/D/AF/AB/AC/AD/AG
- **Status:** FIXED

## GAP-035 — Partial QA Invalidation Completeness

- **Owner capability:** Incremental compute (Phase 5B, 5.3)
- **Discovered:** 07/10/2026
- **Gap:** partial QA degrades into partial coverage — stale PASS surviving policy/rule/dependency change
- **Severity:** P1
- **Decision:** **ADD_NOW — FIXED in Phase 5B** (2026-10-07): QA dependency registry (14 rules: LOCALIZABLE/BOUNDARY_SENSITIVE/GLOBAL_MANDATORY with context handles + invalidatedBy + cacheable); PartialQAPlan (local + boundary + reused + global + invalidated); QAKey = hash(artifact + rule/tool/policy versions + range/context); PASS reuse only on exact key + current rights; coverage completeness = reuse + fresh; no detector merge without equivalence proof (5A's 7-pass/16.3s cost kept)
- **Evidence:** `lib/render/partial-qa.js` + `tests/incremental/test-partial-qa.js` 8/8 (Cases U–Y)
- **Status:** FIXED

## GAP-036 — Cache Lifecycle / Poison Protection

- **Owner capability:** Incremental compute (Phase 5B, 5.2)
- **Discovered:** 07/10/2026
- **Benchmark:** Bazel disk-cache GC (size/age-oriented collection)
- **Gap:** unbounded disk growth; partial/corrupt writes becoming valid; restart resurrecting incomplete state
- **Severity:** P1/P2
- **Decision:** **ADD_NOW — FIXED in Phase 5B** (2026-10-07): versioned lifecycle policy (2GB/30d/HYBRID default, measured); pinning (active-job/approved-artifact/recovery-critical/operator-pinned + CANONICAL_REF distinction); SCAN/DRY_RUN/GC/REPORT (pilot: 34MB/6 entries, dry-run removes 0); crash-write invisibility; corrupt detection + quarantine + recompute; restart rejects incomplete; traversal/symlink-escape guards
- **Evidence:** `lib/render-cache/index.js` (scan/gc) + Cases M/N/P/Q/AJ + pilot storage economics
- **Status:** FIXED

## GAP-037 — Extension Build Excluded the Trace Contract (FOUND + FIXED in 5C)

- **Owner capability:** Observability packaging (Phase 5C Task G)
- **Discovered:** 08/10/2026 (live MV3 trace E2E: SW returned ok:true with no span attached)
- **Gap:** `trace-contract.js` missing from `build.js` REQUIRED_FILES → shipped extension lacked the file → `importScripts` failed silently → span emission dead in production builds while unit tests (which load from src) stayed green
- **Severity:** P1 (silent observability loss; same class of bug can silence any SW-side contract)
- **Decision:** **FIXED in Phase 5C**: 1-line build fix + rebuild (31 files) + live E2E proving real span emission. Structural lesson recorded: build output must contain every file the SW `importScripts`-loads; the MV3 spec now guards the behavior, not just the module.
- **Evidence:** `flow-companion/extension/build.js` + `tests/e2e/mv3-lifecycle.spec.js` (Q) + `Report/evidence/perf-5c/trace-chain.json`
- **Status:** FIXED

## GAP-038 — Renderer Browser-Startup Bottleneck Attribution (CORRECTED in 5C)

- **Owner capability:** Render efficiency (Phase 5B estimate → Phase 5C measurement)
- **Discovered:** 08/10/2026 (Phase 5C Task A pilot-scale experiment)
- **Gap:** 5B attributed ~100s+/range pilot cost to per-call browser startup; pilot-scale measurement shows browser open costs 95–108ms — the range-wall variance (68–200s) is machine/render noise, not startup. Reuse still reduces starts 5→1 with byte-identical output, but the wall saving is ~0.4s, immaterial at pilot scale
- **Severity:** P2 (planning accuracy; no product defect)
- **Decision:** **CORRECTED with evidence**: PerformanceBudgetProfile v2 carries the measured 95–108ms/start budget; render-strategy decision explicitly excludes startup-removal as a migration reason. No code change (pool direction kept: starts bounded, no leaks).
- **Evidence:** `Report/evidence/perf-5c/pilot-reuse-benchmark.json` + `tests/incremental/test-pilot-reuse-5c.js` 6/6
- **Status:** FIXED

## GAP-039 — Unbounded Render Concurrency / No Production Queue (FIXED in 5C)

- **Owner capability:** Runtime scale (Phase 5C Tasks B/C/D)
- **Discovered:** 08/10/2026 (Phase 5C completion pass)
- **Gap:** scheduler existed standalone; the real render path had no admission, no queue bound, no persist/restore, no duplicate protection
- **Severity:** P1 (oversubscribe + duplicate expensive work risk)
- **Decision:** **FIXED in Phase 5C**: every `renderOp` attempt flows through `lib/scheduler` (enqueue → budget admit → RUNNING → COMPLETED/FAILED/CANCELLED → release) with `render/scheduler-queue.json` persistence, stale-reconcile-never-resubmit, in-process duplicate guard (DUPLICATE_EXPENSIVE_ACTION), 30-min watchdog, cross-process entry via `renderBudgetPrecheck` (default cap 2). e2e render path green through the queue.
- **Evidence:** `pipeline/render-orchestrator.js` (queue section) + `tests/runtime/test-orchestrator-queue.js` 6/6 + `tests/pipeline/test-step13-pipeline-e2e.js` PASS
- **Status:** FIXED

## GAP-040 — Provider Session Production Safety (FIXED in 5C)

- **Owner capability:** Provider safety (Phase 5C Task I)
- **Discovered:** 08/10/2026 (Phase 5C completion pass)
- **Gap:** ProviderSession contract was logic-only with no production-behavior proof
- **Severity:** P1 (session/auth risk)
- **Decision:** **FIXED in Phase 5C**: contract 7/7 unit + live-trace production proof — single-owner session throughout (one tabId), warm SESSION_REVALIDATED restore, synthetic submit REFUSED with read-only poll until human gesture (no bypass), restart adopted already-counted results without resubmitting (no blind retry). Live double-lease/stale-auth paths not exercised (session risk) — recorded as the explicit residual.
- **Evidence:** `Report/evidence/perf-5c/provider-baseline.json` (sessionSafety) + `tests/runtime/test-provider-session.js` 7/7
- **Status:** FIXED

## GAP-041 — Long-form Render Strategy Undecided (FIXED in 5C)

- **Owner capability:** Strategic scaling (Phase 5C Tasks J–N)
- **Discovered:** 08/10/2026 (Phase 5C completion pass)
- **Gap:** no representative long-form evidence; cloud migration pressure without numbers
- **Severity:** P1 (strategy)
- **Decision:** **FIXED in Phase 5C**: deterministic mixed fixture (video/still/grid-chart + voice stubs + captions + audio-mix) measured at 10min (1216s wall, 14.8fps) and 20min (2198s, 16.4fps), 1080p30 c=4, RSS <0.5GB; 30min estimated ~3200s from validated 1.43–2.03x scaling; server candidate viable-but-unjustified; Lambda not selected (unmeasured, unknowns dominate); **V1 = LOCAL** with 4 evidence-driven migration triggers.
- **Evidence:** `tests/perf/test-longform-5c.js` + `Report/evidence/perf-5c/longform-benchmark.json` + `server-candidate.json` + `distributed-candidate.json` + `render-strategy-decision.json`
- **Status:** FIXED

## GAP-042 — Retention Proxy vs Actual Analytics (FIXED in 6A)

- **Owner capability:** Creative Retention (Phase 6A)
- **Discovered:** 08/10/2026 (fresh review; YouTube retention report re-fetched: intro = share still watching after 30s, plus top moments / spikes / dips — all post-publish viewer data)
- **Gap:** a pre-publish assessment could be mistaken for, or fabricated as, audience retention
- **Severity:** P1 (product semantics)
- **Decision:** **ADD_NOW — FIXED in 6A**: `CREATIVE_RETENTION_RISK` (categorical LOW/MEDIUM/HIGH/REVIEW_REQUIRED, finding-driven) with `actualRetention: null`, `NOT_AVAILABLE_PRE_PUBLISH`; `assertNoFabricatedRetention` guards every persisted artifact; analytics vocabulary kept as future-only; stable anchors for Phase 10.
- **Evidence:** `lib/creative-retention/contract.js`, `tests/creative/test-creative-contract.js` (Case AD)
- **Status:** FIXED

## GAP-043 — Packaging Promise → Opening Delivery (FIXED in 6A)

- **Owner capability:** Hook System (Phase 6A)
- **Gap:** Phase 4 proves package truthfulness; nothing proved the opening delivers the promised subject/value in time
- **Severity:** P1 (creative quality)
- **Decision:** **ADD_NOW — FIXED in 6A**: PackagingPromise (reuses Phase 4 claim refs, no second fidelity engine); 5s/15s/30s checkpoints; PACKAGING_PROMISE_DELAYED / HOOK_PROMISE_MISMATCH / HOOK_PROMISE_DELAYED; content-class-aware policy.
- **Evidence:** `lib/creative-retention/hook.js`, `tests/creative/test-hook-system.js`, golden `delayed-hook` / `packaging-promise-mismatch`
- **Status:** FIXED

## GAP-044 — Actionable Creative QA (FIXED in 6A)

- **Owner capability:** Creative QA / Repair router (Phase 6A)
- **Gap:** score-only creative verdicts cannot drive an agent
- **Severity:** P1 (agent usability)
- **Decision:** **ADD_NOW — FIXED in 6A**: every CreativeFinding has where/why/reasonClass/evidence/repairClass/confidence/status; router maps to owning subsystem, DAG invalidation, bounded loop, local-first with script-root-cause override.
- **Evidence:** `lib/creative-retention/{contract,repair}.js`, `tests/creative/test-creative-repair.js`, `test-creative-golden.js`
- **Status:** FIXED

## GAP-045 — Cross-video Rhythm Fingerprint Foundation (FOUNDATION FIXED in 6A)

- **Owner capability:** Visual Rhythm (6A collects) / Originality Gate (6B consumes)
- **Benchmark:** YouTube inauthentic-content policy (re-fetched 08/10/2026): mass-produced / template-like / minimally varied content is a monetization risk; shared intro/outro/series format is allowed when each video has distinct substance
- **Severity:** P2
- **Decision:** **ADD_NOW (collection only)**: `CreativeFingerprint` persisted with durations, modality/framing/motion/transition sequences, energy timelines, rest ranges, metrics, stable anchors. No originality verdict in 6A (RULE 12).
- **Status:** PARTIALLY_FIXED / CONSUMER_6B

## GAP-046 — Autonomous Multimodal Reviewer Not Integrated

- **Owner capability:** Final Multimodal Watch Pass (6A contract) → 6B/Quality Scoring
- **Discovered:** 08/10/2026 (Phase 6A)
- **Gap:** the reviewer interface, trace, cost and disagreement handling exist and are tested, but no real multimodal provider is wired; the pilot review was a recorded session-agent review of 5 viewed frames (3 extracted frames not viewed, not claimed). Subjective codes (curiosity, payoff strength, semantic redundancy) therefore rely on text heuristics unless a reviewer is supplied.
- **Severity:** P2
- **Decision:** **MERGE_FUTURE_PACKAGE → Phase 6B (Quality Scoring)**; trigger: first run needing unattended subjective review.
- **Status:** DEFERRED

## GAP-047 — Creative Analysis Lexical Layer Is English-Tuned

- **Owner capability:** Creative Retention text helpers (`lib/creative-retention/text.js`)
- **Discovered:** 08/10/2026 (Phase 6A)
- **Gap:** stop-words and stemming are English; promise coverage, redundancy and loop resolution degrade for other languages (e.g. Vietnamese). Structural/timing checks are language-independent.
- **Severity:** P2
- **Decision:** **MERGE_FUTURE_PACKAGE** — before any non-English production; replace `text.js` tokenization behind the same functions.
- **Status:** PLANNED

---

**Counts (after Phase 6A):** 47 gaps — FIXED 37 (the 33 above + 008, 042, 043, 044) · PARTIALLY_FIXED 1 (045) · PLANNED 2 (006, 047) · DEFERRED 4 (007, 009, 014, 046) · REJECTED 2 (010, 011) · OPEN 1 (003 live-gated).
**Unresolved P0 = 0. Unresolved Phase-6B-blocking P0/P1 = 0.**
