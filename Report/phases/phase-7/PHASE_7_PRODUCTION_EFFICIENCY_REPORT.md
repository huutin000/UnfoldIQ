# PHASE 7 — Production Efficiency Optimization Report

Scope: owner request "Production Efficiency Optimization" (10/10/2026), attached to Phase 7; no new phase, Phase 7 not restarted. 0 provider calls, 0 Flow credits, 0 VND. No full render was run (all benchmarks are 240-frame ranges). Phase 5/6 results reused, not redone.

## 1. Time classification (MEASURED vs ESTIMATED)
Classifier: `lib/perf/time-class.js` (maps the existing 5A stage taxonomy onto AUTHORING / COMPUTE / PROVIDER_WAIT / HUMAN_REVIEW and keeps measured apart from estimated; an estimate without a basis is rejected). Existing 5A spans/trace/stage taxonomy, 5C concurrency matrix and 5B cache/incremental stay the instrumentation base.

| Class | Typical for the GPS video | Label |
|---|---|---|
| Authoring (engine, specs, research, script) | 2–5 sessions (was 3–6) | ESTIMATED, unproven until Slice B |
| Compute (TTS, alignment, previews, final render, QC) | ~35 min (band 25–70), was ~72 | ESTIMATED from the measurements below |
| Provider waiting (Flow, 5 images) | NOT_MEASURED (needs Flow UI readback) | NOT_MEASURED |
| Human review (watch, approvals) | ~15–30 min | ESTIMATED |

## 2. Bottleneck findings (MEASURED on this host, `Report/evidence/phase-7/efficiency/*.json`)
Benchmarks: 240-frame range, 1080p, h264, bundle once per process.
1. **Scene content dominates, not render flags.** Filter-heavy SVG (`SkyDiagram`, blur/glow filters): 10.2–10.3 fps (PNG frames) or 22.7–23.6 fps (default JPEG frames). Plain spec scene (`DiagramScene`, no filters): 31.6–32.7 fps full, 35–38 fps frames-only. Roughly 3x from avoiding SVG filters.
2. **Frame rendering (browser raster) is the bottleneck; encoding is not.** For the spec scene, encode+stitch adds ~0.6–1.3 s on 240 frames. For the filter-heavy scene, frame rendering is the whole cost.
3. **Frame image format matters most among flags:** PNG vs JPEG on the same scene is ~2.3x. Important: the repo's `renderMedia` runner passes no `imageFormat`, so it uses the Remotion API default (JPEG), while `remotion.config.ts` PNG applies to the CLI only and `incremental-render` uses PNG. Final quality was QC-approved on the current path; I changed nothing. The A/B was run afterwards, see section 3b.
4. **Concurrency:** c=2 / 4 / 6 = 9.9 / 10.3 / 11.2 fps (single run each; c=4 repeat 10.2, so noise ~1%). c=6 gives +9% over c=4 on 6 cores / 15.8 GB: marginal, memory risk. Keep c=4.
5. **NVIDIA NVENC** (`hardwareAcceleration: if-possible`): +12% fps, output file 68% larger (different rate control), and encode is not the bottleneck. Not worth it for final.
6. **Preview profile:** JPEG + scale 0.5 at c=4 = 49 fps vs ~10 fps PNG full scale on the same scene (~5x).
Limits: one composition family, 240-frame ranges, single run for c=2/6/HW/preview, no captions/audio/Flow stills/transitions in the sample; real GPS composition may be slower.

## 3. Reusable visual system
- **Audit of the 39 proposed components:** the pilot's `SkyDiagram` is ~390 lines for 6 scenes (a switch per scene); 39–50 bespoke components would repeat that. The 39 collapse to 9 primitives (done earlier), and the primitives are in fact *spec generators*, not React components.
- **Implemented now:** one `DiagramScene` composition (`remotion/src/diagram/`) driven by a validated JSON `DiagramSpec` (circle/line/rect/path/text, keyframe tracks, draw-on, show windows, palette). Pure timeline math in `track.ts` is shared by renderer and tests. `lib/diagram` validates specs at the boundary and provides `barChart`. Two fixtures: 2D trilateration (geometry verified in the contact sheet: three rings meet at the point) and a bar-chart layout example (labels only; values not sourced).
- **Reuse, not replace:** Flow-image shots use the existing IMAGE layer path with a spec overlay for labels/numbers; Hybrid Visual Routing (Flow/Veo) is unchanged. Scene count stays a draft (50 is not a quota).
- Gaps (LATER): ellipse/orbit helpers (orbits can use `path` arcs and keyframe tracks today), group/transform, 3D look for trilateration (perspective via paths), reusable `orbitTrack` helper.

## 3b. Pre-commit checks (owner decision 10/10/2026)
- **Spec validation:** `schemas/diagram-spec.schema.json` (draft-07, versioned `version: 1`, registered in `scripts/checks/validate-schemas.js`) plus semantic checks (unique ids, ordered keyframes, finite numbers, show windows). Bad specs are rejected before any render (tests: wrong version, zero duration, duplicate id, unknown type, unordered keyframes, NaN, extra properties).
- **Deterministic rendering:** `tests/remotion/test-diagram-render-determinism.js` renders the same frame twice with real Remotion: identical sha256; a different time gives a different frame.
- **Backward compatibility:** SkyDiagram (S03 f100, S06 f200) and blank stills have identical sha256 before and after the Root.tsx change (stash comparison, one-off). Targeted suite results are in section 7.
- **No fake data in production:** the bar-chart fixture now uses placeholder labels ("Bar A, 7 units", title "LAYOUT EXAMPLE - PLACEHOLDER DATA, NOT FOR PRODUCTION") and lives only under `tests/fixtures/`. Real values enter only from the sourced claim map.
- **JPEG vs PNG** (4 representative scenes, 60-frame h264 renders, frame vs lossless still; `efficiency/jpeg-vs-png-quality.json`): SSIM vs lossless still, PNG / JPEG q80 (current runner default) / JPEG q95 = glow scene 0.9843 / 0.9785 / 0.9829; SkyDiagram S06 0.9803 / 0.9735 / 0.9789; thin lines+text 0.9922 / 0.9866 / 0.9925; bars+text 0.9951 / 0.9914 / 0.9954. So **q80 is measurably softer than PNG (about -0.004 to -0.007 SSIM), q95 is equal to PNG within ~0.0015**. Wall time for 60 frames: PNG 6.0 and 7.9 s vs JPEG 3.3 and 3.5 s on the two filter-heavy scenes; no difference on simple scenes. Decision: planned final = JPEG q95 (higher quality than today, no slowdown); recorded in `production-profiles.js` as `plannedFinalImage` with `wired: false`. The runner (`pipeline/remotion-render-runner.js`) is unchanged and still uses the Remotion default (JPEG q80); wiring and its tests happen at the Final Render gate, not before. Limit: 4 scenes, one frame each, SSIM/PSNR only (no VMAF), no motion/captions.

## 4. Preview, profiles, reuse
- **Contact sheet:** `scripts/cli/diagram-contact-sheet.js` (validated specs → stills at 85% → one PNG). Measured 4.8 s for two scenes including bundling. Review static coverage first; render motion only for risky shots.
- **Profiles:** `lib/render/production-profiles.js`: DEVELOPMENT (spec validation + contact sheet, no motion), PRODUCTION_FAST_PREVIEW (jpeg, scale 0.5, c=4, never final-eligible), PRODUCTION_FINAL (no option overrides; export profile `youtube-sdr-1080p@1.0.0`; guard throws if someone adds quality overrides).
- **Dependency-aware production:** already provided by 5B (range render/cache/dirty set), the DAG, and the routing `dirtyScope`/`reuseLocked` from this phase; nothing re-implemented. Final Audio is the timeline authority and is not regenerated by visual repairs.
- **QA:** nothing removed. Local QA before lock, full QA on the final artifact; no full 199-suite regression per video unless code/config changes.

## 5. Before / after
| Item | Before (v1.1 budget) | After | Label |
|---|---|---|---|
| Final render | 20 min typical (19–39), 5C synthetic fixture | 12 min (9–25) | ESTIMATED; 32 fps measured only on a simple spec scene |
| Preview | 4 min for 5 segments | ~1.5 min | ESTIMATED from 49 fps measurement |
| Machine total | ~72 min | ~35 min (25–70) | ESTIMATED |
| Authoring | 3–6 sessions, 9 React primitives | 2–5 sessions, 1 engine + JSON specs | ESTIMATED |
| Render fps, filter-heavy vs plain scene | n/a | ~10 vs ~32 | MEASURED |
Budget file updated: `PHASE7_RESOURCE_AND_CREDIT_BUDGET.json` v1.2.0 (`efficiency` block; v1.1 estimates kept as superseded).

## 6. Classification
- **NOW (done):** DiagramScene engine + validation + fixtures; time-class instrumentation; production profiles; contact sheet; benchmarks; keep c=4; authoring rule "no heavy SVG filters (blur/glow) in diagram specs".
- **LATER:** PNG vs JPEG quality A/B before locking final; re-benchmark c=4 vs c=6 on the real GPS composition (and with captions/audio); orbit/group helpers; ledger wiring into real stage spans in Slice B; Flow provider wait measurement (needs real generation).
- **NOT_WORTH_IT:** NVENC for final (+12%, larger files, wrong bottleneck); concurrency above 4 now (+9%, memory risk); cloud/Lambda render (5C decision stands); rewriting Phase 5/6 machinery; lowering final scale/quality for speed.

## 7. Tests and gate
Commands run (targeted only): `npm run test:remotion` 19/19 suites PASS (includes the real render smoke, composition registration and the new determinism test); `node scripts/run-tests.js perf media motion` 9/9 suites PASS (5A 18/18 unchanged, diagram 5/5, efficiency 3/3, visual-routing 18/18); `node scripts/checks/validate-schemas.js` exit 0 with diagram-spec registered; `npx remotion compositions` lists DiagramScene; `npm run render:doctor` READY. The perf domain rewrote `Report/evidence/perf-5c/concurrency-matrix.json` (known Regression Output Isolation debt); restored with git checkout, not committed. No full 199-suite regression, no full render.
```text
TIME_CLASSIFICATION            = READY
BOTTLENECK_IDENTIFIED          = PROVEN (frame raster / scene content; MEASURED, small sample)
REUSABLE_VISUAL_SYSTEM         = READY (engine proven on 2 fixtures; GPS specs not yet authored)
PREVIEW_PROFILES               = READY
RENDER_TUNING                  = KEEP_C4 / NO_HW_ENCODE / RUNNER_UNCHANGED / PLANNED_FINAL_JPEG_Q95_NOT_WIRED
FULL_RENDER_BENCHMARKS_RUN     = 0
QUALITY_TRADEOFF               = NONE (final profile unchanged)
EXTERNAL_PAID_COST_VND         = 0
PHASE_7                        = NOT_COMPLETE
```
