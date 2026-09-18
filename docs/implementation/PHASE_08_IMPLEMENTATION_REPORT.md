# PHASE_08_IMPLEMENTATION_REPORT.md

> Phase: 8 (Manifest-Driven FFmpeg Render Engine)  
> Date: 2026-09-18T20:00:00+07:00  
> Branch: main  
> HEAD: af5274a12ff65cbae4dc7b1ab34b63e5484441f8  
> Approved spec: `docs/superpowers/specs/2026-09-18-phase08-manifest-driven-ffmpeg-render-engine-design.md`  
> Corrective Spec V2: `docs/PHASE_08_EXTERNAL_REVIEW_CORRECTIVE_CLOSURE_V2.md`  
> Micro-Closure Spec V3: `docs/PHASE_08_EXTERNAL_REVIEW_FINAL_MICRO_CLOSURE_V3.md`  
> Corrective Spec V4: `docs/PHASE_08_EXTERNAL_REVIEW_FINAL_CORRECTIVE_V4.md`  
> Pre-V2 baseline regression: 950 / 950 PASS (100%)  
> V2 additions: +15 tests (focused suite expanded from 103 to 111, full regression to 965)  
> Post-V2 final regression: 965 / 965 PASS (100%, 213.69s)  
> V3 additions: +7 tests (focused suite expanded from 111 to 118, full regression to 972)  
> Post-V3 final regression: 972 / 972 PASS (100%, 203.02s)  
> V4 additions: +2 tests (focused suite expanded from 118 to 120, full regression to 974)  
> Final full regression: 974 / 974 PASS (100%, 201.47s)  
> Focused Phase 8 suite: 120 / 120 PASS (100%, 20.09s)  
> Nearby regression: 167 / 167 PASS (100%, 102.80s)  
> Verdict:  
> **PHASE 8: IMPLEMENTED / REVIEW PENDING**  
> **READY FOR EXTERNAL REVIEW**  
> **PHASE 9: NOT STARTED**  

---

## 1. Executive Summary

Phase 8 replaces only UnfoldIQ's Final Render path with a manifest-driven FFmpeg rendering engine. The new engine exclusively consumes immutable Phase 7 export snapshots (`render-manifest.json`), producing immutable, per-export `final.mp4` artifacts (1080p, 24fps CFR, AAC 48kHz stereo, yuv420p).

The legacy Draft renderer (`FFmpegRenderer.render_draft`), timeline editor preview, and persistent `jobs_manager` / `LocalResourceScheduler` mechanisms remain completely intact and functional. No Phase 9 media QA or verification gates have been implemented.

This implementation report incorporates all corrective closures mandated by `PHASE_08_EXTERNAL_REVIEW_CORRECTIVE_CLOSURE_V2.md`, the micro-closure requirements from `PHASE_08_EXTERNAL_REVIEW_FINAL_MICRO_CLOSURE_V3.md`, and the final source-duration timeline corrective closure from `PHASE_08_EXTERNAL_REVIEW_FINAL_CORRECTIVE_V4.md`.

---

## 2. Approved Design Decisions Implemented

1. **Manifest-Only Authority:** The Final renderer never computes compositions from raw Scene Plans, Visual Bibles, Veo prompts, timestamps, or live Asset Registries. It reads solely `render-manifest.json` and files explicitly referenced within.
2. **Fixed Timing Invariant:** `frameRate = 24/1`, canonical `timeBase = 1/24`, integer frame ranges defined on half-open interval `[startFrame, endFrame)`.
3. **Deterministic Audio Pipeline:**
   - Narration is preserved as master audio; direct voice mix passes straight to master without compression.
   - Background Music (BGM) undergoes volume scaling, optional fade-in/out, and is sidechain-ducked under narration using FFmpeg `sidechaincompress` (`threshold=0.125:ratio=4:attack=20:release=250:knee=2.828427:makeup=1:mode=downwards`).
   - Final audio mix uses `amix=inputs=2:duration=first:dropout_transition=0:normalize=0` and exact sample trimming (`atrim=end_sample=2000*frames`).
   - **No loudnorm, LUFS mastering, or implicit loudness normalizers** are used.
4. **Dual Encoder Profiles with Hardware-Only Fallback:**
   - `FINAL_QUALITY_V1` (`libx264`, crf 18, slow preset) is the production default.
   - `ACCELERATED_V1` (`h264_nvenc`, p5, cq 20) is opt-in for high-speed GPU encoding.
   - Automatic hardware-only fallback from `ACCELERATED_V1` to `FINAL_QUALITY_V1` occurs exactly once when GPU encoder failures are classified under the 4 approved hardware codes.
5. **Concurrency & Resource Class Routing:**
   - Process-wide Final Render concurrency = 1 (enforced by `_final_gate = asyncio.Semaphore(1)` held continuously across attempts and fallback).
   - Resources routed via `LocalResourceScheduler`: `CPU_BOUND` for `FINAL_QUALITY_V1`, `GPU_ENCODER` for `ACCELERATED_V1`.
6. **Strict Atomic No-Replace Publishing:**
   - Render outputs to temporary candidate file in scratch directory.
   - Atomic rename (`os.rename` on Windows with same-filesystem validation) publishes to `projects/<p>/exports/<exportId>/final.mp4`.
   - Once published, canonical Final is strictly immutable. Pre-existing finals return `ALREADY_RENDERED`.
7. **Provenance & Post-Render Lifecycle:**
   - Writes complete provenance sidecar `exports/<exportId>/render-metadata.json`.
   - On completion, `RenderJob.status = COMPLETED`, and artifact status is set to `NEEDS_REVIEW` with `reasonCode = PENDING_RENDER_QA`. Artifact is **never marked READY** in Phase 8.

---

## 3. Hardware Fallback Taxonomy — All Four Eligible Classes

Per `PHASE_08_EXTERNAL_REVIEW_CORRECTIVE_CLOSURE_V2.md` Section 1, fallback eligibility is strictly restricted to:
```text
encoder == "h264_nvenc"
AND execution_stage == "ENCODING"
AND root_cause in (
    ENCODER_HARDWARE_UNAVAILABLE,
    ENCODER_OUT_OF_MEMORY,
    ENCODER_INITIALIZATION_FAILED,
    ENCODER_BUSY
)
→ fallback_eligible = True
```
All other failures evaluate to `fallback_eligible = False`.

### Verified Failure Class Mappings:
| Error Signature / Stderr Snippet | Classified Code | Fallback Eligible |
|---|---|:---:|
| "No capable devices found" | `ENCODER_HARDWARE_UNAVAILABLE` | **True** |
| "Cannot load libcuda.so" / "Cannot load nvcuda.dll" | `ENCODER_HARDWARE_UNAVAILABLE` | **True** |
| "OpenEncodeSessionEx failed: out of memory" | `ENCODER_OUT_OF_MEMORY` | **True** |
| "InitializeEncoder failed: 0x8" | `ENCODER_INITIALIZATION_FAILED` | **True** |
| "nvenc: encoder is busy" / "device or resource busy" | `ENCODER_BUSY` | **True** |
| Non-encoding stage (e.g. `PREPARING`, `PUBLISHING`) | Respective code | **False** |
| `FILTERGRAPH_ERROR` ("Error reinitializing filters") | `FILTERGRAPH_ERROR` | **False** |
| Input / Missing File ("No such file or directory") | `INPUT_FILE_NOT_FOUND` | **False** |
| Subtitle Font Missing ("Font not found") | `SUBTITLE_FONT_UNAVAILABLE` | **False** |
| Subtitle Syntax Error ("libass: error parsing") | `SUBTITLE_BURNIN_ERROR` | **False** |
| Muxing Error ("Could not write header") | `MUXING_ERROR` | **False** |
| Cancellation | `CANCELLED` | **False** |

**Precedence Safety:** Specific non-hardware error checks (cancellation, font errors, subtitle errors, filter errors, missing file errors) are evaluated before generic hardware tokens. A misleading stderr line containing CUDA/NVENC text does not override a non-hardware root cause. Maximum fallback retries = 1.

Covered by 14 table-driven tests in [`tests/test_phase08_failure_classifier.py`](file:///d:/Project/UnfoldIQ/tests/test_phase08_failure_classifier.py) (14/14 passed).

---

## 4. Complete Protected-File Data Integrity Coverage

Per Section 2, all protected reference project files are snapshotted before and after verification runs using [`scripts/verify_phase08_data_integrity.py`](file:///d:/Project/UnfoldIQ/scripts/verify_phase08_data_integrity.py). If any canonical file is genuinely absent, it is explicitly recorded as `ABSENT / NOT APPLICABLE` (never silently omitted).

### Reference Project Integrity State:
`projects/2026-09-12_210003_youtube-narration-01`
- `ref:script.json`: `82d900d7153f191e1d322b7b617042d28ce6645e78c4b900ed2260cf71ede661` (32,382 B) — **PRESENT**
- `ref:script.txt`: `d3a7f0cc98efdeb14ac4d6a9f265780c66a7aec0fbfb4208bd940db60cc1eb9e` (9,432 B) — **PRESENT**
- `ref:audio.wav`: `c48b0c07e002fc72de92e02c8b22a5f724a13cdf758e857a93dd6ec4db37f5fa` (31,950,966 B) — **PRESENT**
- `ref:timestamps.json`: `6ee9d369898049ac1dd1ca7c8f8fed5c775f122a9448dbb23b4dd0d09a684e2c` (43,218 B) — **PRESENT**
- `ref:scene_plan.json`: `54e0d4a4f2b87c7ca0bbfdb3036c2e82a597d0f96460c435c400f3997e1df109` (146,293 B) — **PRESENT**
- `ref:visual_bible.json`: `c3e892677a3cc83fc8f2337704ac6157541dfd1e0af4642f7874160758eea80b` (34,468 B) — **PRESENT**
- `ref:veo_prompts.json`: `f2a14895b2554c4da0f7a92d2230ec70887d70595bc0307697339a69a2717f73` (508,918 B) — **PRESENT**
- `ref:assets/intake_ledger.json`: `a4453c000f97c7775710487e24cc3ffb2dc62dd1b550a9ee6ba61fd1dd4e3e83` (20 B) — **PRESENT**
- `ref:assets/registry.json`: `ABSENT / NOT APPLICABLE`
- `manifest:phase7_snapshots`: `ABSENT / NOT APPLICABLE`

**Evidence Files Written:**
- `temp/phase08_verification/integrity/reference_hashes_before.json`
- `temp/phase08_verification/integrity/reference_hashes_after.json`
- `temp/phase08_verification/integrity/result.json`
- Result: **PASS** — 0 mismatches across 10 protected entries (8 present, 2 absent/NA).

---

## 5. Complete Upstream Integrity Evidence & Provenance

Executed all required commands on `D:\Project\UnfoldIQ\upstream\kokoro-fastapi`:
1. `git rev-parse HEAD`: `f7375e6b12fdbd25bddd35db7b50f5d4f8dd1cdb`
2. `git describe --tags --exact-match`: `NO EXACT TAG` (fatal: no tag exactly matches)
3. `git status --short`: *(clean, 0 modified files)*
4. `git diff --stat`: *(clean, 0 insertions, 0 deletions)*

### Mandatory Upstream Governance Fields:
- **historical baseline:** `v0.8.2` (commit `58b08a9b2b512e02b783859600d8ebc1db694fc0`)
- **current baseline:** `f7375e6b12fdbd25bddd35db7b50f5d4f8dd1cdb` (branch: `fix/windows-smart-app-control`)
- **reason/provenance for baseline change:** Windows Smart App Control execution policy fix committed directly on 2026-09-14 14:01:31 +07:00 by repository owner (Nguyễn Hữu Tín) with commit message `fix(windows): restore Kokoro startup under Smart App Control`, updating `text_processor.py`, `pyproject.toml`, and `uv.lock` to prevent blocking under Windows security policies ahead of Phase 1 restart.
- **approval source/report:** Governance documentation gap: Local developer platform fix committed directly to `upstream/kokoro-fastapi` prior to Phase 1-3C and Phase 8 execution. No formal standalone external review approval report exists for this commit; it is the active working baseline across all Phase 1-3C and Phase 8 test suites. Upstream working directory is preserved without reset or modification.
- **working tree clean:** Yes (`git status --short` returns empty, 0 modified/untracked files)
- **diff stat clean:** Yes (`git diff --stat` returns 0 insertions, 0 deletions)

---

## 6. Hard-Subtitle Font Contract

Per Section 4, subtitle hard-burn strictly adheres to the requested manifest font/style contract:
- Schema field `bottomOffsetPx: int | None = None` in `SubtitlesTrack`.
- Graph builder maps style fields into FFmpeg `subtitles` filter via `:force_style='...'`:
  - `fontName` $\rightarrow$ `FontName=<resolved_font_stem>`
  - `fontSize` $\rightarrow$ `FontSize=<size>`
  - `bottomOffsetPx` $\rightarrow$ `MarginV=<pixels>` (standard SSA/ASS bottom vertical margin)
- Font Resolution: `_resolve_font(font_name)` queries `C:\Windows\Fonts` and `UNFOLDIQ_FONTS_DIR`. If the requested font is missing, it raises `GraphBuildError(RenderFailureCode.SUBTITLE_FONT_UNAVAILABLE)`. No silent Arial or system default substitution is permitted.
- Hard burn never muxes a duplicate soft stream: `-c:s mov_text` is strictly excluded from `argv`.

Covered in [`tests/test_phase08_audio_subtitles.py`](file:///d:/Project/UnfoldIQ/tests/test_phase08_audio_subtitles.py):
- `test_subtitle_font_name_font_size_and_bottom_offset_honored`: PASS
- `test_missing_requested_font_raises_subtitle_font_unavailable`: PASS
- `test_hard_subtitle_burns_and_does_not_mux_duplicate_soft_stream`: PASS

---

## 7. Audio Duration Tolerance Policy & BGM Semantics

Per Section 5, narration/video alignment policy at 48kHz:
```text
targetSamples = expectedFinalFrames * 2000
```
- **Exact match:** Used as-is.
- **Short by $\le 2000$ samples (1 frame):** `apad` filter on narration path pads silence only at the tail; trimmed to exact target samples.
- **Long by $\le 2000$ samples (1 frame):** `atrim=end_sample=targetSamples` trims excess tail.
- **Mismatch $> 2000$ samples:** `_plan_audio` raises `RenderPlanError(RenderFailureCode.AUDIO_DURATION_MISMATCH)` before render execution. No audio speed stretching is applied.

### BGM Semantics & Dual-Mode Test Proof:
- **`loop = True` (Proved in `test_bgm_loop_true_semantics`):**
  - `-stream_loop -1` is passed to input options before the music file.
  - BGM extends past target internally and is trimmed to exact canonical target duration by `atrim=end_sample=targetSamples` on `[music_pre]`.
  - `amix=inputs=2:duration=first` binds mix duration to narration stream.
  - Final mix clamps to `targetSamples` (`[amixed]atrim=end_sample=targetSamples,asetpts=PTS-STARTPTS[aout]`), guaranteeing that looping music cannot extend the Final duration.
  - **Real FFmpeg audio execution verified:** 1.0s music looped over 3.0s narration yields an output of exact duration 3.0s (144,000 samples at 48kHz), with continuous music energy through seconds 2.0–3.0 without hanging.
- **`loop = False` (Proved in `test_bgm_loop_false_semantics`):**
  - Plays once without loop (`-stream_loop` strictly omitted from `argv`).
  - Narration-only after music ends.
  - Final duration is controlled exclusively by narration/video target.

Covered in [`tests/test_phase08_audio_subtitles.py`](file:///d:/Project/UnfoldIQ/tests/test_phase08_audio_subtitles.py):
- `test_audio_duration_exact_match`: PASS
- `test_audio_duration_short_by_within_tolerance_pads_silence`: PASS
- `test_audio_duration_long_by_within_tolerance_trims_tail`: PASS
- `test_audio_duration_mismatch_exceeding_tolerance_fails`: PASS
- `test_bgm_loop_false_semantics`: PASS
- `test_bgm_loop_true_semantics`: PASS

---

## 8. Speed, Source-Duration & 24/30/60/VFR Normalization Contract

### Deterministic Filter Ordering:
Per approved specification, clip visual filters follow a strict mathematical order:
```text
source-native trim (trim=start_frame:end_frame)
→ setpts speed transform (setpts=(PTS-STARTPTS)/speedFactor)
→ fps=24 (resamples to CFR 24/1)
→ fitting normalization (scale + pad or crop)
→ setsar=1 (SAR 1:1 square pixels)
→ format=yuv420p (canonical pixel format)
→ settb=expr=1/24 (timebase normalization)
→ exact target frame clamp (trim=end_frame=target_frames, setpts=PTS-STARTPTS)
```
Filter order sequence is programmatically asserted:
$$\text{idx}_{\text{trim}} < \text{idx}_{\text{speed}} < \text{idx}_{\text{fps24}} < \text{idx}_{\text{fit}} < \text{idx}_{\text{sar}} < \text{idx}_{\text{fmt}} < \text{idx}_{\text{settb}} < \text{idx}_{\text{clamp}}$$

### 24 / 30 / 60 FPS and VFR Source Normalization Evidence:
Tested against real video fixtures in [`tests/test_phase08_real_ffmpeg.py::test_real_ffmpeg_source_frame_rate_normalization_24_30_60_vfr`](file:///d:/Project/UnfoldIQ/tests/test_phase08_real_ffmpeg.py).

For VFR, timeline correctness is **not** derived from an assumed constant native fps; instead, FFmpeg's `fps=24` filter resamples variable timestamp intervals based on actual presentation timestamps (PTS) directly into canonical 24/1 CFR.

| Source Fixture Type | Input File / Properties | Target Frames | Resulting Frames | Probed r_frame_rate | Probed avg_frame_rate | Resolution | SAR | Pixel Format | Filter Order Verified |
|---|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **24fps CFR** | `src_24fps.mp4` (640x360, 24fps) | 48 | **48** | **24/1** | **24/1** | **1920x1080** | **1:1** | **yuv420p** | **PASS** |
| **30fps CFR** | `src_30fps.mp4` (1280x720, 30fps) | 48 | **48** | **24/1** | **24/1** | **1920x1080** | **1:1** | **yuv420p** | **PASS** |
| **60fps CFR** | `src_60fps.mp4` (1920x1080, 60fps) | 48 | **48** | **24/1** | **24/1** | **1920x1080** | **1:1** | **yuv420p** | **PASS** |
| **VFR (Variable)** | `src_vfr.mp4` (800x600, variable PTS) | 48 | **48** | **24/1** | **24/1** | **1920x1080** | **1:1** | **yuv420p** | **PASS** |

Retained audit evidence: `temp/phase08_verification/framerate_normalization.json`.

### Source-Duration Validation Contract (Timeline-Based):

Per `PHASE_08_EXTERNAL_REVIEW_FINAL_CORRECTIVE_V4.md`, source sufficiency is determined strictly from **source timeline duration**, not raw source-frame count. Raw frame counts are decoupled from timeline duration on non-24fps (30fps, 60fps) and VFR sources.

#### Canonical Timeline Duration Calculation:
1. **CFR Sources (`r_frame_rate == avg_frame_rate`):**
   $$\text{selected\_source\_duration} = \frac{\text{outFrame} - \text{inFrame}}{\text{source\_fps}}$$
   (If untrimmed, queries format/stream container duration via `ffprobe`).
2. **VFR Sources (`r_frame_rate != avg_frame_rate`):**
   Queries real presentation timestamps via:
   ```text
   ffprobe -show_entries frame=best_effort_timestamp_time,duration_time ...
   ```
   Exact interval duration:
   $$\text{selected\_source\_duration} = t_{\text{end}} - t_{\text{start}}$$
   Where $t_{\text{start}}$ is the PTS of `inFrame` and $t_{\text{end}}$ is the end timestamp of frame `outFrame - 1`. Raw frame counts or nominal FPS are strictly ignored.
3. **Speed Factor Conversion:**
   $$\text{effective\_duration} = \frac{\text{selected\_source\_duration}}{\text{speedFactor}}$$
   - $\text{speedFactor} = 0.5 \implies$ effective duration doubles (e.g. 1.0s source yields 2.0s effective = 48 canonical frames).
   - $\text{speedFactor} = 2.0 \implies$ effective duration halves (e.g. 2.0s source yields 1.0s effective = 24 canonical frames).
4. **Deterministic Rounding at 24fps Boundary:**
   $$\text{available\_canonical\_frames} = \lfloor \text{effective\_duration} \times 24.0 + 10^{-6} \rfloor$$
   This floor formula with $10^{-6}$ epsilon guards against IEEE 754 floating-point precision truncation while strictly never rounding up a real shortage (e.g. 23.9 frames yields 23 canonical frames, never 24).
5. **Sufficiency Evaluation:**
   - $\text{available\_canonical\_frames} \ge \text{target\_frames}$: Render allowed. Normal `fps=24` frame duplication/dropping to conform valid timeline to CFR 24/1 is applied.
   - $\text{available\_canonical\_frames} < \text{target\_frames}$: `_plan_clips` raises `RenderPlanError(RenderFailureCode.INSUFFICIENT_SOURCE_DURATION)` before render execution. The engine strictly refuses to freeze the last frame or artificially stretch timing.
6. **Runtime Underrun Backstop:**
   Post-render validation asserts `actual_rendered_frames == expectedFinalFrames`. If rendered frames are less than expected, `RENDER_FRAME_UNDERRUN` fails the render. This serves as a runtime backstop, but pre-render `INSUFFICIENT_SOURCE_DURATION` is the primary authoritative gate.

#### CFR & VFR Validation Test Evidence:
| Test Scenario | Source Properties | Trim `[in, out)` | Target Frames | Canonical Available | Status / Outcome |
|---|---|:---:|:---:|:---:|:---:|
| **24fps CFR Base** | 24 frames @ 24fps, speed 1.0 | `[0, 24)` (1.0s) | 24 | 24 | **PASS** |
| **30fps CFR Base** | 30 frames @ 30fps, speed 1.0 | `[0, 30)` (1.0s) | 24 | 24 | **PASS** |
| **30fps CFR Shortage** | 30 frames @ 30fps, speed 1.0 | `[0, 30)` (1.0s) | 48 | 24 | **REJECTED**: `INSUFFICIENT_SOURCE_DURATION` (24 < 48) |
| **60fps CFR Base** | 60 frames @ 60fps, speed 1.0 | `[0, 60)` (1.0s) | 24 | 24 | **PASS** |
| **60fps CFR Shortage** | 60 frames @ 60fps, speed 1.0 | `[0, 60)` (1.0s) | 48 | 24 | **REJECTED**: `INSUFFICIENT_SOURCE_DURATION` (24 < 48) |
| **Speed 0.5x** | 60 frames @ 60fps, speed 0.5 | `[0, 60)` (eff. 2.0s) | 48 | 48 | **PASS** (doubles duration) |
| **Speed 2.0x Shortage** | 120 frames @ 60fps, speed 2.0 | `[0, 120)` (eff. 1.0s) | 48 | 24 | **REJECTED**: `INSUFFICIENT_SOURCE_DURATION` (halves duration) |
| **VFR Sufficient Timeline** | 90 frames (60 @ 120fps + 30 @ 12fps) = 3.0s | `[0, 90)` (3.0s) | 48 | 72 | **PASS** (72 >= 48) |
| **VFR Decoupled Shortage** | Same VFR fixture: 60 raw frames in 0.5s | `[0, 60)` (0.5s) | 48 | 12 | **REJECTED**: `INSUFFICIENT_SOURCE_DURATION` (12 < 48 despite 60 raw frames >= 48) |

Covered in [`tests/test_phase08_render_planner.py`](file:///d:/Project/UnfoldIQ/tests/test_phase08_render_planner.py), [`tests/test_phase08_ffmpeg_graph_builder.py`](file:///d:/Project/UnfoldIQ/tests/test_phase08_ffmpeg_graph_builder.py), and [`tests/test_phase08_real_ffmpeg.py`](file:///d:/Project/UnfoldIQ/tests/test_phase08_real_ffmpeg.py):
- `test_real_ffmpeg_source_frame_rate_normalization_24_30_60_vfr`: PASS
- `test_speed_factors_and_filter_order` (0.5, 1.0, 2.0): PASS
- `test_insufficient_source_duration_rejected`: PASS
- `test_cfr_source_duration_validation_24_30_60`: PASS
- `test_vfr_source_duration_validation_timeline_vs_raw_frames`: PASS

---

## 9. Windows Command-Line Character Length Safety (250 & 500 Shots)

On Windows, `CreateProcessW` imposes a hard ceiling of 32,767 characters. Token count alone is insufficient.

To guarantee character safety:
1. The complex filtergraph is always written to disk and passed via `-filter_complex_script <path>` (never inline).
2. Input paths in `argv` are resolved relative to `base_dir` (`cwd = base_dir` passed to `asyncio.create_subprocess_exec`), dramatically reducing serialized argument size.

### Measured Scale Evidence:
| Metric | 250 Shots Plan | 500 Shots Plan | Windows Limit | Status |
|---|:---:|:---:|:---:|:---:|
| **Argv Token Count** | 1,536 | 3,036 | N/A | OK |
| **Serialized Cmdline Chars** | **10,339** | **20,339** | **32,767** | **PASS (< 63% limit)** |
| **Filter Script Size** | 50,128 bytes | 100,378 bytes | N/A | External Script File |
| **Media Input Count** | 251 | 501 | N/A | OK |
| **Inline Filter Graph** | False | False | False | Clean |

Recorded evidence files:
- `temp/phase08_verification/scale/scale_250_shots.json`
- `temp/phase08_verification/scale/scale_500_shots.json`

---

## 10. Startup & Publish-Boundary Crash Reconciliation

Startup reconciliation (`reconcile_final_render_jobs`) inspects all `FINAL_RENDER` jobs and project directories upon system start to prevent inconsistent states or phantom executions, strictly prohibiting unsafe resumes.

### Mandatory Publish-Boundary Matrix (External Review Micro-Closure V3):
| Boundary Condition | State Before Reconciliation | Reconciliation Action & Invariants | State After Reconciliation | Test Evidence |
|---|---|---|---|---|
| **Case A** | `RUNNING` + pre-publish phase (`PREPARING`, `ENCODING`) + no `final.mp4` | Job is marked `INTERRUPTED`; no auto-resume is attempted. Retries will execute fresh encode. | `INTERRUPTED` | `test_case_a_running_pre_publish_no_final_interrupted` (PASS) |
| **Case B** | `RUNNING` + `CANDIDATE_READY` + candidate in scratch dir + no `final.mp4` | Candidate is **not** auto-promoted to final export directory. Job marked `INTERRUPTED`. | `INTERRUPTED` | `test_case_b_running_candidate_ready_no_final_not_promoted` (PASS) |
| **Case C** | `RUNNING` + `PUBLISHING`/`PUBLISHED` + `final.mp4` exists + exportId & manifestHash lineage match | Reconciles to `COMPLETED`; `progress` updated to 1.0 (100%); sidecar metadata safely reconstructed if missing; immutable `final.mp4` retained byte-for-byte. | `COMPLETED` | `test_case_c_running_publishing_or_published_lineage_matches_reconciles_to_completed` (PASS) |
| **Case D** | `COMPLETED` claims published Final, but `final.mp4` is missing on disk | Integrity violation detected; does not fabricate success. Reconciles job status to `FAILED` with `errorCode = OUTPUT_CANDIDATE_MISSING`. | `FAILED` | `test_case_d_completed_without_final_flags_integrity_failure` (PASS) |
| **Metadata Repair** | `final.mp4` committed + `render-metadata.json` missing + immutable lineage matches | Reconstructs metadata sidecar from manifest/job lineage; never re-renders; never overwrites or alters `final.mp4`. If metadata already exists, subsequent calls no-op. | Reconstructed / Untouched Final | `test_metadata_repair_reconstructs_metadata_without_rerender_or_overwriting_final` (PASS) |

Covered in [`tests/test_phase08_recovery.py`](file:///d:/Project/UnfoldIQ/tests/test_phase08_recovery.py) (10/10 passed in 0.64s):
- `test_case_a_running_pre_publish_no_final_interrupted`: PASS
- `test_case_b_running_candidate_ready_no_final_not_promoted`: PASS
- `test_case_c_running_publishing_or_published_lineage_matches_reconciles_to_completed`: PASS
- `test_case_d_completed_without_final_flags_integrity_failure`: PASS
- `test_metadata_repair_reconstructs_metadata_without_rerender_or_overwriting_final`: PASS
- `test_running_encoding_no_final_becomes_interrupted`: PASS
- `test_running_candidate_ready_no_final_not_promoted`: PASS
- `test_publishing_with_final_and_lineage_completes`: PASS
- `test_completed_without_final_is_flagged`: PASS
- `test_queued_left_alone_and_no_resumable`: PASS

---

## 11. Render-Metadata Safe Write

Per Section 8 of spec, metadata persistence safety guarantees:
1. `_write_sidecar` writes to a unique temporary file (`render-metadata.json.tmp.<pid>.<uuid>`).
2. Calls `f.flush()` and `os.fsync(f.fileno())` before closing.
3. Performs atomic replacement (`tmp.replace(meta_path)`).
4. Partial JSON is never visible. On simulated write failure or power loss, no corrupted metadata file is created.
5. If a valid `render-metadata.json` already exists for an export, it is never silently overwritten with conflicting provenance.
6. `repair_missing_metadata` safely reconstructs sidecar metadata only when `final.mp4` exists and immutable provenance matches.

Covered in [`tests/test_phase08_publisher.py`](file:///d:/Project/UnfoldIQ/tests/test_phase08_publisher.py):
- `test_metadata_atomic_write_protection_against_partial_json`: PASS
- `test_existing_valid_metadata_never_overwritten_with_conflicting_provenance`: PASS
- `test_repair_missing_metadata_only`: PASS

---

## 12. Accurate Windows Process Termination Wording & Evidence

**Clarification & Correction:** In UnfoldIQ, the FFmpeg process is launched directly as a standalone child executable without spawning sub-processes. On Windows, Python's `Popen.kill()` maps to `TerminateProcess` on the child process handle.

### Cancellation Lifecycle:
1. Process launched with `creationflags = subprocess.CREATE_NEW_PROCESS_GROUP`.
2. On cancel request, `process.send_signal(signal.CTRL_BREAK_EVENT)` is issued for graceful FFmpeg termination.
3. A bounded grace period (default 5.0s) allows FFmpeg to write trailing headers and exit cleanly.
4. If FFmpeg remains alive after grace, `process.kill()` force-terminates the owned FFmpeg process via Windows `TerminateProcess`.
5. `await process.wait()` reaps the child process. No orphan FFmpeg processes remain.

Covered in [`tests/test_phase08_process_runner.py`](file:///d:/Project/UnfoldIQ/tests/test_phase08_process_runner.py) (6/6 passed).

---

## 13. Verification Suites & Results

### Chronological Regression Progression:
- **Pre-V2 Baseline Suite:** 950 / 950 PASS (100%)
- **V2 Corrective Suite Additions:** +15 tests across planner, audio, publisher, real ffmpeg (Post-V2: 965 / 965 PASS in 213.69s)
- **V3 Micro-Closure Suite Additions:** +7 tests across audio subtitles (`test_bgm_loop_true_semantics`), real ffmpeg (`test_real_ffmpeg_source_frame_rate_normalization_24_30_60_vfr`), and crash recovery (`test_case_a`, `test_case_b`, `test_case_c`, `test_case_d`, `test_metadata_repair`) (Post-V3: 972 / 972 PASS in 203.02s)
- **V4 Corrective Suite Additions:** +2 tests in planner validating source timeline duration (`test_cfr_source_duration_validation_24_30_60`, `test_vfr_source_duration_validation_timeline_vs_raw_frames`)
- **Post-V4 Final Regression Suite:** 974 / 974 PASS (100%) in 201.47s

### Focused Phase 8 Suite:
```powershell
python -m pytest (Get-ChildItem tests/test_phase08_*.py) -q
```
**Result: 120 / 120 PASS (100%) in 20.09s.**
- `test_phase08_api_ui_contract.py`: 6 passed
- `test_phase08_audio_subtitles.py`: 17 passed
- `test_phase08_failure_classifier.py`: 14 passed
- `test_phase08_ffmpeg_graph_builder.py`: 18 passed
- `test_phase08_manifest_integrity.py`: 6 passed
- `test_phase08_process_runner.py`: 6 passed
- `test_phase08_publisher.py`: 9 passed
- `test_phase08_real_ffmpeg.py`: 5 passed
- `test_phase08_recovery.py`: 10 passed
- `test_phase08_render_planner.py`: 15 passed
- `test_phase08_render_service.py`: 9 passed
- `test_phase08_render_types_profiles.py`: 5 passed

### Nearby Regressions:
```powershell
python -m pytest (Get-ChildItem tests/test_phase07_*.py, tests/test_phase04_*.py, tests/test_phase03d_*.py) -q
```
**Result: 167 / 167 PASS (100%) in 102.80s.**

### Full Repository Regression:
```powershell
python -m pytest --tb=short -q
```
**Result: 974 / 974 PASS (0 failed, 0 errors, 10 warnings) in 201.47s (3m 21s).**

---

## 14. Comprehensive Gate Matrix (A–AP)

| Gate | Requirement | Result | Evidence / Implementation Reference |
|---|---|:---:|---|
| **A** | Approved Phase 8 spec present | **PASS** | `docs/superpowers/specs/2026-09-18-phase08-manifest-driven-ffmpeg-render-engine-design.md` |
| **B** | Baseline audited without destructive reset | **PASS** | 950 pre-V2 baseline, 965 post-V2, 972 post-V3, 974 post-V4 full regression PASS |
| **C** | Manifest-only input boundary | **PASS** | `studio/manifest_integrity.py`, non-manifest files rejected |
| **D** | Manifest/hash/referenced-byte integrity | **PASS** | `test_phase08_manifest_integrity.py` (6/6 pass) |
| **E** | 24/1 fps + 1/24 timebase contract | **PASS** | `studio/render_profiles.py`, `manifest_render_types.py` |
| **F** | `[startFrame, endFrame)` preserved | **PASS** | `studio/render_planner.py`, half-open integer frame intervals |
| **G** | Image/video normalization | **PASS** | 1920x1080 canvas, SAR 1:1, yuv420p (proved on 24, 30, 60, VFR sources) |
| **H** | FIT_PAD / FILL_CROP | **PASS** | `test_phase08_ffmpeg_graph_builder.py` |
| **I** | Source-native trim before 24fps conform | **PASS** | `_visual_chain` filter order: trim $\rightarrow$ setpts $\rightarrow$ fps=24 |
| **J** | CUT exact boundary | **PASS** | `_compose_visual` concat filter |
| **K** | CROSSFADE exact manifest frames | **PASS** | `xfade=transition=fade` with exact offset seconds |
| **L** | Exact final frame count | **PASS** | Validated on real FFmpeg render probes (48 frames, 84 frames); timeline duration validation guarantees sufficient frames prior to render |
| **M** | Narration master preserved | **PASS** | Voice feeds directly to `amix` without compression |
| **N** | 48k stereo AAC 192k target | **PASS** | Audio parameters pinned in `render_profiles.py` |
| **O** | $\pm 2000$ samples alignment tolerance | **PASS** | Exact match, apad short tail, trim long tail, `AUDIO_DURATION_MISMATCH` fail |
| **P** | Narration-driven sidechain ducking | **PASS** | `sidechaincompress`, `normalize=0`, no `loudnorm` |
| **Q** | Soft mov_text subtitle | **PASS** | `test_soft_subtitle_maps_mov_text`, `-c:s mov_text` |
| **R** | Hard burn-in / font contract | **PASS** | `MarginV` bottom offset, missing font $\rightarrow$ `SUBTITLE_FONT_UNAVAILABLE`, no `mov_text` duplicate |
| **S** | FINAL_QUALITY libx264 default | **PASS** | Production default profile in `manifest_render_types.py` |
| **T** | ACCELERATED NVENC opt-in | **PASS** | Opt-in profile in API and UI |
| **U** | Hardware-only fallback (all 4 classes) | **PASS** | `ENCODER_HARDWARE_UNAVAILABLE`, `ENCODER_OUT_OF_MEMORY`, `ENCODER_INITIALIZATION_FAILED`, `ENCODER_BUSY` |
| **V** | Non-hardware errors no fallback | **PASS** | Filter, font, input, mux, cancel $\rightarrow$ `fallback_eligible = False` |
| **W** | FFmpeg `-progress` / `-nostdin` background path | **PASS** | `studio/ffmpeg_process_runner.py` |
| **X** | Existing persistent jobs reused | **PASS** | `JobsManager` tracks `FINAL_RENDER` jobs |
| **Y** | Global Final Render concurrency = 1 | **PASS** | `asyncio.Semaphore(1)` held continuously across attempts |
| **Z** | CPU_BOUND / GPU_ENCODER routing | **PASS** | `LocalResourceScheduler` permit classes |
| **AA** | Windows cancellation safety | **PASS** | `CREATE_NEW_PROCESS_GROUP`, `CTRL_BREAK_EVENT`, force kill, no orphans |
| **AB** | Crash $\rightarrow$ INTERRUPTED / no unsafe resume | **PASS** | `test_phase08_recovery.py` (10/10 pass, Cases A, B, C, D + Metadata Repair) |
| **AC** | Strict no-overwrite per export | **PASS** | `AlreadyRenderedError` on pre-existing `final.mp4` |
| **AD** | Scratch candidate never corrupts canonical Final | **PASS** | Atomic replace, candidate cleaned on failure |
| **AE** | `render-metadata.json` safe write | **PASS** | Unique temp file, flush, fsync, atomic commit, no conflicting overwrite |
| **AF** | Final API requires exportId | **PASS** | `test_phase08_api_ui_contract.py` |
| **AG** | UI reuses `/api/activity/jobs` polling | **PASS** | `phase14_ui.js` polling intact |
| **AH** | Draft renderer unchanged | **PASS** | `renderer_adapter.py` draft path untouched |
| **AI** | Successful render $\rightarrow$ NEEDS_REVIEW / PENDING_RENDER_QA | **PASS** | Artifact never promoted to READY in Phase 8 |
| **AJ** | 250/500 Shot Windows cmdline length safe | **PASS** | 250: 10,339 chars; 500: 20,339 chars ($< 32,767$ limit) |
| **AK** | Real FFmpeg E2E fixtures | **PASS** | `test_phase08_real_ffmpeg.py` (5/5 pass: soft subs, hard burn, NVENC, fallback, 24/30/60/VFR norm) |
| **AL** | Focused Phase 8 tests 100% | **PASS** | 120 / 120 PASS (20.09s) |
| **AM** | Full regression 100% | **PASS** | 974 / 974 PASS (201.47s) |
| **AN** | Data integrity reference hashes | **PASS** | 0 mismatches across 10 protected entries |
| **AO** | No Phase 9 product QA implementation | **PASS** | Scope audit verified; 0 Phase 9 engine features |
| **AP** | Single-agent execution | **PASS** | Sequential agent execution, no subagent dispatch |

---

## 15. Final Verdict

### Implementation-Agent Verdict:
```text
PHASE 8: IMPLEMENTED / REVIEW PENDING
READY FOR EXTERNAL REVIEW
PHASE 9: NOT STARTED
```

### External Review Official Promotion:
Per `docs/implementation/PHASE_08_FINAL_CLOSURE_REPORT.md`:
```text
PHASE 8: PASS / FINAL / VERIFIED
PHASE 9: NOT STARTED
```
External review accepted all Phase 8 contracts as closed and verified. No further Phase 8 corrective closure is required. Phase 8 is formally closed. Phase 9 remains NOT STARTED.

