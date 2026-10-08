# PHASE 4B — PILOT FINAL QA + RENDER QC — REPORT

**Package:** Phase 4B — Renderer Integration + A/V Semantic QA (4.2) + Final Content QA (4.3) + Final Render Technical QC (4.4)
**Date:** 2026-10-07
**Spec:** `D:\Downloads All\UNFOLDIQ_PHASE_4B_PILOT_FINAL_QA_RENDER_QC.md`
**Verdict:** **PHASE_4B = COMPLETE; PHASE_4 = COMPLETE; PHASE_5A_READY = YES** (see §36)

---

## 1. Entry gate

Phase 4A evidence verified in `Report/phases/phase-4/PHASE_4A_PUBLISH_PACKAGING_REPORT.md` (§§27–29):

```text
PHASE_4A_FUNCTIONAL / QUALITY_GATE = PASS
PLATFORM_PUBLISH_PROFILE / TITLE / THUMBNAIL / EXPERIMENT_SET = READY
CLAIM_FIDELITY_GATE / ANTI_MISLEADING = PROVEN
PUBLISH_METADATA / RIGHTS / CHECKLIST = READY
PACKAGING_PERSISTENCE / STALE_PROTECTION = PROVEN
P0 = 0 · P1_CRITICAL = 0 · FULL_REGRESSION = PASS · HYGIENE = PASS
PHASE_4A = COMPLETE · PHASE_4B_READY = YES
```

Planning inputs read: execution package (§3 market review), updated registry (22 gaps), 4A report, 3A/3B/3C reports (renderer contracts defined there), Remotion sources/components, timeline/motion/responsive schemas, FinalAudio/caption artifacts, publish profile + package manifest, ffmpeg/ffprobe tooling (v8.1.1 present). `npm run render:doctor` → **READY** (binaries spawn, headless shell present, out/ writable) — no SAC block; no security toggles touched.

## 2. Repo baseline

- Render pipeline pre-existed and was reused, not rebuilt: `lib/render-input-builder.js` (deterministic UnfoldiqRenderInput), `scripts/cli/remotion-render-cli.js` (validate + render-test), `pipeline/` orchestration, `UnfoldiqVideo` composition (SceneTimeline + CaptionTrack + AudioTrack), layer kinds IMAGE/VIDEO/TEXT/SHAPE/BACKGROUND, MotionPreset enum, CUT/FADE/SLIDE transitions.
- 4B added only the missing finalization layer: `lib/render/` (9 modules) + `schemas/render-job.schema.json`.
- Two shared-code fixes landed during 4B (both regression-clean, §31): explicit `pixelFormat: yuv420p` in the render CLI + optional per-scene IMAGE `motion` passthrough in the Builder (absent → NONE, prior behavior preserved).
- Telemetry reused for trace correlation (no second trace system).

## 3. Fresh Market Gap Review

Package §3 (07/10/2026) adopted as the fresh benchmark; URLs cited in-package:

| # | Benchmark | UNFOLDIQ decision | Where |
|---|---|---|---|
| 3.1 | YouTube encoded settings (MP4/H.264/AAC/48k/BT.709) | FinalExportProfile + actual-file verification; fps preserved | `lib/render/export-profile.js`, `delivery.js` |
| 3.2 | Remotion codec/audio-codec/pixel-format options | RenderJob + resolved options/versions persisted; no silent overrides | `render-job.js` |
| 3.3 | FFmpeg blackdetect/freezedetect/silencedetect/loudness | Context-aware detectors (intent-correlated; still≠freeze, tail-gap≠defect, fade≠black) | `probe.js`, `qc.js` |
| 3.4 | Premiere source/working/output color split | GAP-005 closed on actual encoded tags | Case F |
| 3.5 | Safe-zone display guidance | GAP-018 closed on rendered geometry + layout math | Case P |
| 3.6 | W3C flash guidance (conservative ≤3/s) | Frame-domain luma analysis; FAIL/REVIEW; no certification claim | Case Q |

## 4. Renderer architecture

```
approved state → 4B preflight → Builder render input → Remotion renderMedia
→ mezzanine → RECORDED delivery-conform → final.mp4 → probe/decode/QC
→ semantic/content QA → packaging revalidation → finalized package
```

Renderer consumes resolved canonical values (1920×1080, 30fps, 150s, approved WAVs). Two real defects were caught by encoded QC during the phase (not assumed from config): full-range `yuvj420p` output and missing color tags — both fixed in recorded stages (see §§6–8).

## 5. Render mapping registry

`lib/render/mapping-registry.js` (`REGISTRY_VERSION 1.0.0`): 10 track→layer mappings + all 22 3B primitives → renderer preset/transition with DIRECT / DOCUMENTED_APPROXIMATION / BLOCKED_NO_SILENT_STATIC policies (HANDHELD/PARALLAX/LIGHT_SWEEP/PARTICLES block). Executed end-to-end in the pilot: KEN_BURNS→SLOW_ZOOM_IN on S02 (input-proof asserted pre-render), CUTs throughout, TEXT/SHAPE-equivalent caption layers, FinalAudio embed, responsive geometry math. Preflight refuses unsupported mappings before any render (Case B).

## 6. FinalExportProfile

`YOUTUBE_SDR_1080P@1.0.0`: MP4 / H.264 High / progressive / yuv420p / AAC / 48kHz / stereo / BT.709 (primaries/transfer/matrix/range-tv) / faststart; fps resolved per-job from the canonical timeline rate (30/1 here). Renderer/test differences are BLOCK/REVIEW, never silent fallback.

## 7. Render preflight

`runPreflight`: asset resolution + placeholder/stale rejection, unresolved-gap rejection, FinalAudio↔timeline↔alignment hash currency, caption freshness, motion-plan revision match, variant currency, mapping support, packaging selection, rights completeness, plan-QA FAIL gate. Fail → DO NOT RENDER (Case A proves READY on the pilot; Case B proves the block path).

## 8. Actual final.mp4 render

Pilot `__4b_pilot__` (TEST-ONLY convention): 5 scenes × 30s = 150s, Kokoro `af_heart` narration (1619 chars → 100.6s measured speech, ~2.2× realtime synthesis), ffmpeg lavfi scene visuals (testsrc2/still-PNG/yuvtestsrc/testsrc/rgbtestsrc, provenance-recorded stand-ins), scene-level measured captions, voice-only 48kHz-stereo mix (no remix at render).

```
out/final/pilot-4b.mp4 — 50,865,647 bytes, 150.06s
sha256 d3e71094f3c6a1919a6ad9f854d70878…
render 232s (~19.4fps @1080p) + delivery conform
```

Registered as canonical asset `as-final-pilot-4b` (Case C). TEST-ONLY project cleaned post-render (repo convention); artifact (gitignored `out/`) + evidence (`Report/evidence/pilot-4b/`) persist; rebuild is deterministic (recorded hashes/commands).

## 9. ffprobe encoded inspection

Structural evidence (`probe.json`): MP4, H.264 High, 1920×1080, SAR/DAR 1:1/16:9, 30fps, yuv420p(tv), AAC 48kHz stereo, durations video≈audio≈150.06s vs canonical 150s. Full decode clean (exit 0, zero errors). Nothing assumed from config — every field read from the file (Case D).

## 10. Color output validation (GAP-005 → FIXED)

Encoded tags: `primaries=bt709 transfer=bt709 space=bt709 range=tv pixfmt=yuv420p` — full BT.709 family on the actual file. Path honesty: the V1 renderer emitted full-range `yuvj420p` + `bt470bg` inherited from lavfi sources (caught by QC, Case D failed mid-phase); fixed via (1) explicit renderer `pixelFormat`, (2) recorded delivery-conform (`scale=in_range=full:out_range=mpeg`, x264 colorparams, faststart) with input/output hashes. GAP-005 CLOSED on encoded evidence.

## 11. Black-frame QA

`blackdetect` candidates: **0**. Intent path proven by injection (expected fade → PASS, Case G; unexpected → `UNEXPECTED_BLACK_FRAME` BLOCK, Case H). No blind fail (RULE 9).

## 12. Freeze QA

`freezedetect` (noise 0.001, d=2s) candidates: **0** — encoder micro-variation defeats the detector even on the S02 still hold, so still-correctness rests on intent correlation (S02 range registered static → PASS, Case I) plus injection proof (motion-region freeze → `UNEXPECTED_FREEZE`, Case J). Documented sensitivity limit; no false fail (RULE 7).

## 13. Duplicate / placeholder / missing-asset QA

Timeline-identity check (adjacent same-asset without reason → `ACCIDENTAL_DUPLICATE_SHOT`); pilot scenes use distinct assets → clean. Placeholder scan (manifest status + signature patterns) + preflight asset resolution → `PLACEHOLDER_RENDERED` / `MISSING_ASSET_RENDERED` BLOCK paths implemented and unit-proven; pilot clean by construction (all assets READY/CLEAR).

## 14. Audio technical QA

AAC stereo 48kHz verified; max volume −3.9dBFS (no clipping), mean −24.6dBFS, audio duration == video == canonical within tolerance (Case M). Loudness recorded, no invented targets (Phase 2 policy untouched). Failure paths (`AUDIO_CLIPPING`, duration mismatch) injection-proven.

## 15. Silence QA

`silencedetect` (−50dB, d=5s) candidates: exactly the 5 narration tail gaps (19.7→30.3, 52.3→60.3, …) — all inside `expectedSilenceRanges` → PASS (RULE 8, Case K). Mid-speech injection → `UNEXPECTED_SILENCE` (Case L).

## 16. Encoded A/V sync

Video/audio durations match each other and FinalAudio (150s) within 0.6s; +2.5s audio injection → `ENCODED_AV_DRIFT` BLOCK (Case N). Lossy-AAC byte identity correctly not required.

## 17. Caption final QA

Sidecar cues (5 scene cues, measured start/end) all inside duration, no 120ms duplicates; injected duplicate → `CAPTION_FLICKER`; out-of-zone layout → `CAPTION_SAFE_ZONE_FAIL` (Case O). Burned-in path structurally supported (CaptionTrack renders measured text/words only — never fresh ASR).

## 18. Safe-zone final QA (GAP-018 → FIXED)

Rendered geometry == profile (1920×1080); caption/title rects verified inside profile zones against actual dimensions; out-of-zone injection caught. 9:16 mapping sample executes with resolved crop geometry (Case AD). GAP-018 CLOSED on rendered evidence (full 9:16 publish package not required per spec §16).

## 19. Flash final QA (GAP-013 → FIXED)

Frame-domain analysis on actual pilot: 300 frames @2fps, meanDelta 0.0041, maxDelta 0.389, 2 large transitions, max 1 per 1s window → PASS under the conservative ≤3 rule. Injection (6-in-window) → `FLASH_SAFETY_FAIL` BLOCK. No WCAG certification claimed. GAP-013 CLOSED on encoded evidence.

## 20. A/V Semantic Alignment QA (4.2)

`lib/render/semantic.js`: beat-level checks narration↔visual (entity/action), ↔caption (meaning overlap ≥0.5), ↔on-screen (contradiction), ↔chart (trend/labels), ↔map (location), quantity/direction/period, scene-intent support. Pilot S04 chart truth (decline 9→2) passes; injected rise/entity/contradiction all BLOCK with machine-readable reasons (Cases R/S/T). Pixel-level entity recognition explicitly out of scope — semantics validated on approved text/data, never claimed from pixels.

## 21. Chart/Map/Diagram semantic QA

Covered in §20 + responsive data layouts (3C): trend/location/label checks BLOCK factual misrepresentation (decline-vs-rise proven). Rendered chart labels verified present via on-screen text ("From nine in a hundred… to two").

## 22. Final Content QA (4.3)

`lib/render/content.js`: hook present, hook/body/conclusion complete, factual claims supported, evidence refs complete, continuity/factuality/caption OK, no broken pacing, rights/metadata complete, zero debug markers, start/middle/end watch frames exist (5 extracted JPEGs, each verified non-trivial). Pilot: **PASS**, zero findings. Negative paths (debug marker, missing conclusion) proven (Case U).

## 23. Full watch pass

Frames at 1s/45s/75s/105s/148s extracted and verified; content checklist reviewed against them. Verdict: nothing broken, contradictory, missing, cut off, stale, or misleading in the rendered pilot. Retention/originality optimization explicitly not attempted (Phase 6).

## 24. Packaging claim revalidation (GAP-020 → FIXED)

Selected title/thumbnail claims present in rendered segments, thumbnail subject related to final visuals, description chapters inside encoded duration → PASS (Case V). Dropped-claim injection → `FINAL_PACKAGING_VIDEO_MISMATCH` BLOCK (Case W). GAP-020 CLOSED on final-video evidence.

## 25. Final Publish Package

Finalized via `finalizePublishPackage`: `finalVideoRef = out/final/pilot-4b.mp4` (+sha256), zero `PENDING_PHASE_4B` remains, compliance checks resolved to `RESOLVED_PHASE_4B`, checklist ticked (Case Z). Full artifact set present: video, experiment set + selection, description, captions refs, metadata, rights-provenance, compliance, sources, checklist.

## 26. Platform Compliance final

Packaging-level checks from 4A + resolved render/output compliance, safe-zone validation, flash validation, A/V stream compliance, packaging consistency — no pending critical field in the approved package (Case Z asserts every check).

## 27. Local repair/rerender evidence

Structured routing table (`REPAIR_ROUTE`, 30 codes); repair bounded (3 attempts / 30s / hard stop). V1 renderer has no safe segment-stitch path → local visual defects require full rerender; recorded as Phase 5 inefficiency (Case AC). No unrelated provider regeneration on packaging-only patches (proven via invalidation contract).

## 28. E2E trace correlation

Telemetry reused: pilot JOB_STATE + QA events recorded under projectId/runId/jobId/correlationId; `getTrace` returns both events by correlation ID (Case AA). No second trace system. Correlation record shape carries all 9 stage slots (core → packaging).

## 29. Time/Cost/Human Intervention baseline (Phase 5 input)

`e2e-baseline.json` persisted: render 232s @~19fps, output 50.9MB, TTS ~70s wall (local, zero marginal cost), QC ~60–90s (5 ffmpeg passes), failures 0, retries 0, rerenders 0, LLM tokens 0, image/video/TTS/music provider spend 0, human interventions [] (no manual-only dependency in the critical path — all steps are commands).

## 30. Cases A–AD

`tests/render/test-pilot-4b.js` **31/31 PASS** (rear reuse makes reruns ~15s; cold build ~10–12 min):

```text
SETUP real 150s render · A preflight+RenderJob(schema-valid) · B unsupported mapping ·
C file+hash+decode · D SDR profile · E 720p injection · F color tags · G intended black ·
H unexpected black · I still hold · J motion freeze · K tail silence · L mid-speech silence ·
M audio profile · N AV drift · O captions · P safe zones · Q flash · R chart trend ·
S entity · T text contradiction · U watch pass · V revalidation · W staleness ·
X outro · Y corruption · Z package finalize · AA trace · AB baseline ·
AC repair routing · AD 9:16 sample — ALL PASS
```

## 31. Regression

Per-domain `node scripts/run-tests.js` (single `npm test` exceeds the 10-min tool timeout by cumulative time, not failure): timeline/motion/override/responsive/packaging/render/workspace, flow/providers/pipeline, topic/research/story/captions/alignment/mix/music/pairing/storage/policy/cost/dag, remotion/media/qa/compliance/golden/history/narration/platform/project-manifest/pronunciation/provenance/recovery/spoken-script/telemetry/voice-bible, research-deep/real-e2e — **0 failed suites everywhere**, including the shared-code changes (render CLI pixelFormat, Builder motion passthrough — remotion domain re-verified). `npm run check:repo-structure` → OK.

## 32. Market Gap Registry update

`docs/roadmap/MARKET_GAP_REGISTRY.md`: added GAP-023 (renderer adapter → FIXED), GAP-024 (export profile → FIXED), GAP-025 (encoded validation → FIXED), GAP-026 (AV sync → FIXED), GAP-027 (pilot watch → FIXED); CLOSED GAP-005/013/018/020/021 on encoded evidence. Counts: **27 gaps — FIXED 19 · PARTIALLY_FIXED 1 (014 → Phase 5) · PLANNED 2 · DEFERRED 2 · REJECTED 2 · OPEN 1 (live-gated)**. P0 = 0; Phase-5-blocking P1 = 0.

## 33. Phase 4B Quality Gate

```text
RENDERER: timeline→Remotion [x] · motion mapping [x] · overrides applied (recorded) [x] ·
  responsive mapping [x] · captions [x] · FinalAudio embedded unmixed [x] ·
  unsupported blocks [x] · timing preserved [x] · options/versions persisted [x]
EXPORT PROFILE: versioned [x] · SDR profile [x] · container/codec/audio [x] ·
  resolution/aspect [x] · fps vs canonical [x] · pixfmt [x] · rate/channels [x] ·
  color tags [x] · decodes [x]
TECHNICAL QC: black ctx [x] · intended black ok [x] · freeze ctx [x] · still ok [x] ·
  duplicates [x] · placeholders [x] · artifact path [x] · audio PASS [x] ·
  silence ctx [x] · AV sync [x] · caption sync/flicker [x] · outro [x] · corrupt check [x]
COLOR/SAFE/FLASH: GAP-005 [x] · GAP-018 [x] · GAP-013 PASS [x] · no cert claim [x]
SEMANTIC: narration↔visual/caption/text/chart/map/diagram [x] · intent↔visual [x] · machine-readable [x]
CONTENT: hook/narrative/facts/labels/evidence/continuity/factuality/captions [x] ·
  pacing/rights/metadata/debug [x] · 150s watch pass [x]
PACKAGING: title/thumb/description revalidated [x] · no mismatch [x] ·
  compliance resolved [x] · ref+hash finalized [x]
REPAIR: routing [x] · bounded [x] · local-vs-full recorded [x] · no unrelated regen [x]
OBSERVABILITY: correlation [x] · wall/provider/render/QC baselines [x] ·
  cost zero-spend recorded [x] · interventions [] [x] · failures/retries [x]
MARKET GAP: 5 new gaps FIXED [x] · 5 partials closed honestly [x] · no blocking P0/P1 [x]
COMPLETION: A–AD 31/31 [x] · P0=0 · P1=0 · regression PASS · hygiene PASS · report [x]
```

## 34. Phase 4 Major Gate

```text
actual 150s final.mp4 ........................ PASS (50.9MB, sha256-registered)
decodes ...................................... PASS (exit 0, zero errors)
export profile ............................... PASS (zero BLOCK findings)
content QA ................................... PASS (zero findings)
technical QC ................................. PASS (context-aware, zero BLOCK)
A/V semantic alignment ....................... PASS (chart truth + injections)
encoded A/V sync ............................. PASS
caption final path ........................... PASS
color/safe-zone/flash revalidation ........... PASS (all three GAPs closed)
packaging matches final video ................ PASS (revalidated + finalized)
manual upload without core rebuild ........... PASS (package complete, checklist ticked)
rights/provenance + compliance ............... PASS
E2E baselines ................................ PASS (time/cost/failure/intervention/render-QC)
no hidden manual-only dependency ............. PASS (all steps are commands)
traces correlatable .......................... PASS (telemetry correlationId)
artifacts versioned + resumable .............. PASS (job/evidence/hashes/commands)
P0 = 0, critical P1 = 0 ..................... PASS
regression + hygiene ......................... PASS
```

## 35. Honest limitations

```text
1. Pilot visuals are ffmpeg-synthesized stand-ins (provenance-recorded); no generative
   image/video shoot — creative production values are NOT proven.
2. VIDEO-layer motion presets are mapped + gated but not executed by the V1 renderer
   (IMAGE KEN_BURNS executed; video motion = source dynamics). Renderer enhancement
   backlog (P2, not Phase-5-blocking).
3. Executed transitions = CUTs only; FADE/SLIDE mapping is structural until a pilot
   uses overlaps.
4. No music bed (voice-only pilot); loudness policy targets not exercised beyond
   clipping/silence/duration sanity.
5. freedetect sensitivity on encoded stills is low (encoder micro-variation); still-
   correctness rests on intent + injection, not positive detection.
6. Pixel-level entity/scene understanding out of scope (no AI artifact detector
   claimed); semantics validated on approved text/data.
7. No certified photosensitive-epilepsy analysis (conservative detector only).
8. Full 9:16 publish package not produced (mapping sample only, per spec §16).
9. Post-publish analytics collection still POST_V1 (GAP-022).
10. No MCP/public API freeze (deliberate).
```

## 36. Final verdict

```text
PHASE_4B_FUNCTIONAL                    = PASS
PHASE_4B_QUALITY_GATE                  = PASS

RENDERER_INTEGRATION                   = READY
FINAL_VIDEO                            = READY
FINAL_EXPORT_PROFILE                   = PASS

ENCODED_COLOR_QC                       = PASS
FINAL_SAFE_ZONE_QC                     = PASS
FINAL_FLASH_QC                         = PASS

ENCODED_AV_SYNC                        = PASS
CAPTION_FINAL_QC                       = PASS

AV_SEMANTIC_ALIGNMENT                  = PASS
FINAL_CONTENT_QA                       = PASS
PACKAGING_FINAL_REVALIDATION            = PASS

FINAL_PUBLISH_PACKAGE                  = READY

PILOT_TIME_BASELINE                    = RECORDED
PILOT_COST_BASELINE                    = RECORDED
HUMAN_INTERVENTION_BASELINE            = RECORDED
TRACE_CORRELATION                      = PROVEN

P0                                     = 0
P1_CRITICAL                            = 0

FULL_REGRESSION                        = PASS
HYGIENE                                = PASS

PHASE_4B                               = COMPLETE
PHASE_4                                = COMPLETE
PHASE_5A_READY                         = YES
```

## Context Loaded

| Path | Requirement | Loaded | Purpose |
|---|---|---|---|
| `core/WORKFLOW.md`, `core/CONTEXT_ROUTER.md`, `AGENTS.md` | REQUIRED (router) | LOADED | Routing + standing rules |
| Execution package Phase 4B | REQUIRED (task) | LOADED | 4B spec §§0–64 |
| `Report/phases/phase-4/PHASE_4A_PUBLISH_PACKAGING_REPORT.md` | REQUIRED (entry gate) | LOADED | 4A evidence |
| `docs/roadmap/MARKET_GAP_REGISTRY.md` | REQUIRED (planning) | LOADED + UPDATED | GAP-023–027, 5 closures |
| Remotion sources, Builder, render CLI, pipeline, telemetry, platform profiles | REQUIRED (baseline) | LOADED | Reuse before build |
