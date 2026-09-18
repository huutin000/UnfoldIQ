# Phase 8 Manifest-Driven FFmpeg Render Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. This project explicitly uses **one agent sequentially**; do not dispatch subagents. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Replace only UnfoldIQ's Final Render path with a manifest-driven FFmpeg engine that consumes one immutable Phase 7 export snapshot and publishes one immutable per-export `final.mp4`, while preserving the existing Draft renderer, persistent jobs, resource scheduler, Export Workbench, and Phase 9 boundary.

**Architecture:** `render-manifest.json` is the only composition authority. A verifier validates the immutable snapshot and referenced bytes, a planner derives a frame-accurate execution plan, focused FFmpeg builders construct visual/audio/subtitle graphs, a background runner reports progress/cancellation, `ManifestRenderService` coordinates persistent jobs and encoder fallback, and `FinalArtifactPublisher` performs strict no-overwrite same-filesystem publication to `exports/<exportId>/final.mp4`.

**Tech Stack:** Python 3, FastAPI/Pydantic already in the repo, FFmpeg 8.1.1 essentials already integrated, asyncio subprocesses, existing `studio/jobs_manager.py`, `studio/resource_scheduler.py`, Phase 7 render-manifest modules, vanilla JS Export Workbench, pytest/unittest as already used by the repository.

**Spec:** `docs/superpowers/specs/2026-09-18-phase08-manifest-driven-ffmpeg-render-engine-design.md`

## Global Constraints

- Phase 8 only. **Do not implement Phase 9 media QA/gatekeeping.**
- `frameRate = 24/1`; canonical `timeBase = 1/24`; frame ranges are `[startFrame, endFrame)`.
- Final renderer may read only the persisted `render-manifest.json` and files explicitly referenced by that manifest. It must not recompute from Scene Plan, Visual Bible, Veo prompts, timestamps, or live Asset Registry state.
- `FINAL_QUALITY -> libx264` is the production default. `ACCELERATED -> h264_nvenc` is explicit opt-in.
- NVENC may fallback to libx264 **exactly once** only for classified hardware/encoder failures.
- Draft/Preview renderer remains unchanged.
- Global Final Render concurrency is `1`; `FINAL_QUALITY` uses `CPU_BOUND`; `ACCELERATED` uses `GPU_ENCODER`.
- Soft subtitle (`mov_text`) is the default when `subtitlesTrack` exists and `burnIn=false`; hard burn-in is used only for `burnIn=true`.
- Narration drives BGM ducking through `sidechaincompress`; narration itself is not compressed by the sidechain path.
- Final output contract: MP4, H.264, 1920x1080, 24 CFR, yuv420p, SAR 1:1, AAC 192k target, 48 kHz stereo, faststart.
- Render to `projects/<projectId>/renders/.scratch_<jobId>/candidate.mp4`; publish with strict no-replace semantics to `projects/<projectId>/exports/<exportId>/final.mp4`.
- Canonical Final is immutable. Existing Final -> `ALREADY_RENDERED`; no overwrite and no `-y` against canonical output.
- Reuse persistent `jobs_manager`; do not create another mutable render-job authority.
- Reuse current `JobState`: `QUEUED`, `RUNNING`, `COMPLETED`, `FAILED`, `CANCELLED`, `INTERRUPTED`. Final Render does not use mid-render `RESUMABLE` checkpoints in Phase 8.
- Successful Phase 8 Final leaves the artifact at `NEEDS_REVIEW` with `reasonCode=PENDING_RENDER_QA`; it must not mark the artifact `READY`.
- UI keeps existing `/api/activity/jobs` polling; no new Final Render SSE channel.
- Do not use `-shortest` to hide audio/video duration errors.
- Do not download/bundle new fonts or add unrelated dependencies.
- Do not modify tracked Kokoro upstream source. Preserve expected upstream tag/commit if still current in the repo.
- Preserve existing user/project data. Destructive tests must use temp copies/fixtures.
- One agent executes all tasks in sequence. No subagent dispatch.
- Do not self-declare `PASS / FINAL / VERIFIED`; final Phase 8 report must stop at `IMPLEMENTED / REVIEW PENDING`.

## Pre-Execution Materialization

Before implementation begins, place both approved artifacts in the repository at these exact paths:

```text
docs/superpowers/specs/2026-09-18-phase08-manifest-driven-ffmpeg-render-engine-design.md
docs/superpowers/plans/2026-09-18-phase08-manifest-driven-ffmpeg-render-engine.md
```

The executor must read the project-local `.agents` / agent instructions first and preserve any stricter repository rule.

---

## File / Responsibility Map

### New focused modules

- `studio/manifest_render_types.py` — internal execution enums/dataclasses; no FFmpeg syntax.
- `studio/render_profiles.py` — versioned encoder and ducking profiles.
- `studio/manifest_integrity.py` — persisted manifest/file/hash verification only.
- `studio/render_planner.py` — deterministic manifest -> `RenderExecutionPlan` conversion.
- `studio/ffmpeg_graph_builder.py` — visual, audio, subtitle filter/input/stream-map construction.
- `studio/render_failure_classifier.py` — typed FFmpeg failure taxonomy and fallback eligibility.
- `studio/ffmpeg_process_runner.py` — background subprocess, progress, stderr, cancellation.
- `studio/final_artifact_publisher.py` — basic candidate sanity, no-replace publish, immutable provenance.
- `studio/manifest_render_service.py` — Final Render orchestration; the only module that coordinates all pieces.

### Existing modules expected to change narrowly

- `studio/jobs_manager.py` — minimal Final Render lookup/patch/recovery helpers; preserve existing storage authority/conflict rules.
- `studio/resource_scheduler.py` — reuse current resource classes; no duplicate scheduler. Add only the smallest helper needed if current API cannot express Final Render gating cleanly.
- `studio/phase14_router.py` and/or the file currently owning `POST /api/projects/{dir_name}/render/final` — route Final Render through `ManifestRenderService`, add export-explicit Final file resolver.
- `studio/static/app.js` and the existing Export Workbench markup/CSS owner — add encoder-mode selection and new status mapping without new workspace.
- `studio/renderer_adapter.py` — preserve Draft/legacy compatibility; extract/reuse current production x264 baseline only where needed. Do not migrate Draft to the new engine.
- `ROADMAP_STATUS.md` — Phase 8 becomes `IMPLEMENTED / REVIEW PENDING` only after evidence is complete.

### New focused tests / evidence tools

- `tests/test_phase08_render_types_profiles.py`
- `tests/test_phase08_manifest_integrity.py`
- `tests/test_phase08_render_planner.py`
- `tests/test_phase08_ffmpeg_graph_builder.py`
- `tests/test_phase08_failure_classifier.py`
- `tests/test_phase08_process_runner.py`
- `tests/test_phase08_publisher.py`
- `tests/test_phase08_render_service.py`
- `tests/test_phase08_api_ui_contract.py`
- `tests/test_phase08_recovery.py`
- `tests/test_phase08_real_ffmpeg.py`
- `scripts/verify_phase08_render_engine.py`
- `scripts/run_phase08_encoder_benchmark.py`
- `docs/implementation/PHASE_08_IMPLEMENTATION_REPORT.md`

If the current repository locates the existing Final Render route or Export Workbench JS in a different already-established file, modify that existing owner rather than creating a duplicate route/UI module. Record the actual owner in the implementation report.

---

### Task 1: Pin Baseline Contracts, Internal Types, and Versioned Profiles

**Files:**
- Create: `studio/manifest_render_types.py`
- Create: `studio/render_profiles.py`
- Create: `tests/test_phase08_render_types_profiles.py`
- Read only: `studio/renderer_adapter.py`, `studio/jobs_manager.py`, `studio/resource_scheduler.py`, `studio/render_manifest.py`
- Evidence: `temp/phase08_verification/baseline_contracts.json`

**Interfaces:**
- Consumes: Phase 7 `RenderManifest`; current `JobState`; current `ResourceClass` values; existing production Final x264 settings.
- Produces: `EncoderProfileName`, `CompositionStrategy`, `FinalRenderExecutionPhase`, `RenderFailureCode`, `EncoderProfile`, `DuckingPreset`, `RenderAttemptResult`, profile lookup helpers.

- [x] **Step 1: Record the actual baseline before changing source**

Run from the repo root:

```powershell
git status --short
git rev-parse HEAD
rg -n "def render_final|libx264|h264_nvenc|-crf|-preset|-cq|-b:a|48000|ac 2|JobState|ResourceClass|recover_crashed_jobs" studio tests
```

Create `temp/phase08_verification/baseline_contracts.json` from the actual command output, not hand-written placeholder values. A PowerShell-safe pattern is:

```powershell
New-Item -ItemType Directory -Force temp\phase08_verification | Out-Null
$head = (git rev-parse HEAD).Trim()
$status = @(git status --short)
$inspection = @(rg -n "def render_final|libx264|h264_nvenc|-crf|-preset|-cq|-b:a|48000|ac 2|JobState|ResourceClass|recover_crashed_jobs" studio tests)
[ordered]@{
  head = $head
  worktreeWasDirty = ($status.Count -gt 0)
  gitStatus = $status
  contractInspection = $inspection
} | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 temp\phase08_verification\baseline_contracts.json
```

Then inspect the matched production Final command and current enums directly from source and use those exact values when defining the versioned profiles/types. Do not reset, stash, discard, or overwrite pre-existing work.

- [x] **Step 2: Write failing tests for internal enums and fixed timing contracts**

Create `tests/test_phase08_render_types_profiles.py` with tests equivalent to:

```python
from studio.manifest_render_types import (
    CompositionStrategy,
    EncoderProfileName,
    FinalRenderExecutionPhase,
    RenderFailureCode,
)
from studio.render_profiles import get_encoder_profile, get_ducking_preset


def test_phase08_internal_contracts_are_stable():
    assert EncoderProfileName.FINAL_QUALITY.value == "FINAL_QUALITY"
    assert EncoderProfileName.ACCELERATED.value == "ACCELERATED"
    assert CompositionStrategy.SIMPLE_CUT.value == "SIMPLE_CUT"
    assert CompositionStrategy.FILTER_COMPLEX.value == "FILTER_COMPLEX"
    assert FinalRenderExecutionPhase.PREPARING.value == "PREPARING"
    assert FinalRenderExecutionPhase.PUBLISHED.value == "PUBLISHED"
    assert RenderFailureCode.ALREADY_RENDERED.value == "ALREADY_RENDERED"


def test_profiles_keep_same_output_contract():
    quality = get_encoder_profile(EncoderProfileName.FINAL_QUALITY)
    fast = get_encoder_profile(EncoderProfileName.ACCELERATED)
    assert quality.video_encoder == "libx264"
    assert fast.video_encoder == "h264_nvenc"
    assert quality.width == fast.width == 1920
    assert quality.height == fast.height == 1080
    assert quality.fps == fast.fps == 24
    assert quality.pixel_format == fast.pixel_format == "yuv420p"
    assert quality.audio_codec == fast.audio_codec == "aac"
    assert quality.audio_bitrate == fast.audio_bitrate == "192k"
    assert quality.audio_sample_rate == fast.audio_sample_rate == 48000
    assert quality.audio_channels == fast.audio_channels == 2


def test_ducking_preset_is_versioned_and_deterministic():
    preset = get_ducking_preset("NARRATION_DUCK_V1")
    assert preset.name == "NARRATION_DUCK_V1"
    assert preset.detection == "rms"
    assert preset.mode == "downward"
    assert preset.attack_ms > 0
    assert preset.release_ms > 0
    assert preset.ratio > 1
```

- [x] **Step 3: Run the test and confirm RED**

```powershell
python -m pytest tests/test_phase08_render_types_profiles.py -q
```

Expected: import/module failure because the Phase 8 modules do not exist.

- [x] **Step 4: Implement the internal types**

Use standard-library `Enum` / `dataclass`; do not create another persisted schema authority:

```python
# studio/manifest_render_types.py
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any


class EncoderProfileName(str, Enum):
    FINAL_QUALITY = "FINAL_QUALITY"
    ACCELERATED = "ACCELERATED"


class CompositionStrategy(str, Enum):
    SIMPLE_CUT = "SIMPLE_CUT"
    FILTER_COMPLEX = "FILTER_COMPLEX"
    STAGED_FALLBACK = "STAGED_FALLBACK"


class FinalRenderExecutionPhase(str, Enum):
    PREPARING = "PREPARING"
    WAITING_RESOURCE = "WAITING_RESOURCE"
    ENCODING = "ENCODING"
    CANDIDATE_READY = "CANDIDATE_READY"
    PUBLISHING = "PUBLISHING"
    PUBLISHED = "PUBLISHED"


class RenderFailureCode(str, Enum):
    INVALID_MANIFEST = "INVALID_MANIFEST"
    MANIFEST_HASH_MISMATCH = "MANIFEST_HASH_MISMATCH"
    INPUT_MISSING = "INPUT_MISSING"
    INPUT_CORRUPT = "INPUT_CORRUPT"
    INPUT_INTEGRITY_MISMATCH = "INPUT_INTEGRITY_MISMATCH"
    SOURCE_VIDEO_UNREADABLE = "SOURCE_VIDEO_UNREADABLE"
    SOURCE_IMAGE_UNREADABLE = "SOURCE_IMAGE_UNREADABLE"
    INVALID_SOURCE_TRIM = "INVALID_SOURCE_TRIM"
    INSUFFICIENT_SOURCE_DURATION = "INSUFFICIENT_SOURCE_DURATION"
    INVALID_SPEED_FACTOR = "INVALID_SPEED_FACTOR"
    UNSUPPORTED_FITTING_STRATEGY = "UNSUPPORTED_FITTING_STRATEGY"
    INVALID_TRANSITION = "INVALID_TRANSITION"
    TRANSITION_FRAME_MISMATCH = "TRANSITION_FRAME_MISMATCH"
    NORMALIZATION_FAILED = "NORMALIZATION_FAILED"
    FILTERGRAPH_ERROR = "FILTERGRAPH_ERROR"
    RENDER_FRAME_UNDERRUN = "RENDER_FRAME_UNDERRUN"
    MASTER_AUDIO_MISSING = "MASTER_AUDIO_MISSING"
    MASTER_AUDIO_CORRUPT = "MASTER_AUDIO_CORRUPT"
    MASTER_AUDIO_CHECKSUM_MISMATCH = "MASTER_AUDIO_CHECKSUM_MISMATCH"
    AUDIO_DURATION_MISMATCH = "AUDIO_DURATION_MISMATCH"
    AUDIO_RENDER_UNDERRUN = "AUDIO_RENDER_UNDERRUN"
    AUDIO_RESAMPLE_FAILED = "AUDIO_RESAMPLE_FAILED"
    MUSIC_INPUT_MISSING = "MUSIC_INPUT_MISSING"
    MUSIC_INPUT_CORRUPT = "MUSIC_INPUT_CORRUPT"
    MUSIC_CHECKSUM_MISMATCH = "MUSIC_CHECKSUM_MISMATCH"
    INVALID_MUSIC_VOLUME = "INVALID_MUSIC_VOLUME"
    INVALID_FADE_CONFIG = "INVALID_FADE_CONFIG"
    INVALID_DUCKING_CONFIG = "INVALID_DUCKING_CONFIG"
    AUDIO_FILTERGRAPH_ERROR = "AUDIO_FILTERGRAPH_ERROR"
    AUDIO_ENCODE_ERROR = "AUDIO_ENCODE_ERROR"
    SUBTITLE_INPUT_MISSING = "SUBTITLE_INPUT_MISSING"
    SUBTITLE_INPUT_CORRUPT = "SUBTITLE_INPUT_CORRUPT"
    UNSUPPORTED_SUBTITLE_FORMAT = "UNSUPPORTED_SUBTITLE_FORMAT"
    SUBTITLE_ENCODING_ERROR = "SUBTITLE_ENCODING_ERROR"
    SUBTITLE_FONT_UNAVAILABLE = "SUBTITLE_FONT_UNAVAILABLE"
    SUBTITLE_BURNIN_ERROR = "SUBTITLE_BURNIN_ERROR"
    ENCODER_HARDWARE_UNAVAILABLE = "ENCODER_HARDWARE_UNAVAILABLE"
    ENCODER_OUT_OF_MEMORY = "ENCODER_OUT_OF_MEMORY"
    ENCODER_INITIALIZATION_FAILED = "ENCODER_INITIALIZATION_FAILED"
    ENCODER_BUSY = "ENCODER_BUSY"
    VIDEO_ENCODE_ERROR = "VIDEO_ENCODE_ERROR"
    MUX_ERROR = "MUX_ERROR"
    OUTPUT_CANDIDATE_MISSING = "OUTPUT_CANDIDATE_MISSING"
    OUTPUT_CANDIDATE_EMPTY = "OUTPUT_CANDIDATE_EMPTY"
    ATOMIC_PUBLISH_FAILED = "ATOMIC_PUBLISH_FAILED"
    ALREADY_RENDERED = "ALREADY_RENDERED"
    CANCELLED = "CANCELLED"
    JOB_ALREADY_COMPLETED = "JOB_ALREADY_COMPLETED"
    UNKNOWN_RENDER_ERROR = "UNKNOWN_RENDER_ERROR"


@dataclass(frozen=True)
class RenderAttemptResult:
    attempt: int
    encoder: str
    return_code: int
    completed: bool
    cancelled: bool
    failure_code: RenderFailureCode | None
    stderr_tail: str
    progress: dict[str, Any] = field(default_factory=dict)
```

- [x] **Step 5: Implement versioned profiles without hidden CLI literals**

`studio/render_profiles.py` must define `EncoderProfile` and `DuckingPreset`. `FINAL_QUALITY_V1.video_args` must copy the **actual current production Final libx264 args recorded in Step 1**, preserving the current quality baseline. Do not substitute Benchmark B's CRF 28 automatically. `ACCELERATED_V1` starts from the Phase 4 proven NVENC profile `p4 / CQ 28`; Task 12 re-benchmarks it and records the tradeoff.

Use this structure:

```python
from dataclasses import dataclass

from studio.manifest_render_types import EncoderProfileName
from studio.resource_scheduler import ResourceClass


@dataclass(frozen=True)
class EncoderProfile:
    name: EncoderProfileName
    version: str
    video_encoder: str
    video_args: tuple[str, ...]
    resource_class: ResourceClass
    width: int = 1920
    height: int = 1080
    fps: int = 24
    pixel_format: str = "yuv420p"
    audio_codec: str = "aac"
    audio_bitrate: str = "192k"
    audio_sample_rate: int = 48000
    audio_channels: int = 2


@dataclass(frozen=True)
class DuckingPreset:
    name: str
    threshold: float
    ratio: float
    attack_ms: float
    release_ms: float
    knee: float
    detection: str = "rms"
    mode: str = "downward"


# Resolve FINAL_QUALITY_V1.video_args from the exact baseline captured above.
# Keep the Phase 4 measured accelerated candidate explicit and versioned.
ACCELERATED_V1 = EncoderProfile(
    name=EncoderProfileName.ACCELERATED,
    version="ACCELERATED_V1",
    video_encoder="h264_nvenc",
    video_args=("-preset", "p4", "-cq", "28"),
    resource_class=ResourceClass.GPU_ENCODER,
)

NARRATION_DUCK_V1 = DuckingPreset(
    name="NARRATION_DUCK_V1",
    threshold=0.05,
    ratio=6.0,
    attack_ms=20.0,
    release_ms=300.0,
    knee=2.828,
)
```

`FINAL_QUALITY_V1` is not shown with invented numeric args in this plan: the implementation requirement is to preserve the exact current production baseline captured from `renderer_adapter.py`, then version it. This is a preservation rule, not an unresolved design decision.

- [x] **Step 6: Run focused tests**

```powershell
python -m pytest tests/test_phase08_render_types_profiles.py -q
```

Expected: PASS.

- [x] **Step 7: Commit/checkpoint**

If commits are authorized in the current agent workflow:

```powershell
git add studio/manifest_render_types.py studio/render_profiles.py tests/test_phase08_render_types_profiles.py temp/phase08_verification/baseline_contracts.json
git commit -m "feat(phase8): define render execution contracts"
```

If commits are not authorized, do not commit; record `NO COMMIT — not authorized` in the final report and continue without losing the task boundary.

---

### Task 2: Implement Persisted Manifest and Referenced-Byte Integrity Verification

**Files:**
- Create: `studio/manifest_integrity.py`
- Create: `tests/test_phase08_manifest_integrity.py`
- Reuse: `studio/render_manifest.py`, `studio/render_manifest_hashing.py`, `studio/render_manifest_validation.py`

**Interfaces:**
- Consumes: `project_dir: Path`, `export_id: str`.
- Produces: `VerifiedRenderSnapshot`, `ManifestIntegrityError`, `verify_render_snapshot(project_dir, export_id)`.

- [x] **Step 1: Write failing tests for immutable-snapshot isolation**

Cover:

```python
from pathlib import Path

import pytest

from studio.manifest_integrity import ManifestIntegrityError, verify_render_snapshot
from studio.manifest_render_types import RenderFailureCode


def test_verify_snapshot_rejects_manifest_hash_mismatch(phase07_export_fixture):
    fixture = phase07_export_fixture
    manifest_path = fixture.export_dir / "render-manifest.json"
    data = fixture.load_manifest_json()
    data["projectTitle"] = "tampered"
    manifest_path.write_text(fixture.dumps(data), encoding="utf-8")

    with pytest.raises(ManifestIntegrityError) as exc:
        verify_render_snapshot(fixture.project_dir, fixture.export_id)
    assert exc.value.code is RenderFailureCode.MANIFEST_HASH_MISMATCH


def test_verify_snapshot_rejects_referenced_byte_mutation(phase07_export_fixture):
    fixture = phase07_export_fixture
    asset = fixture.first_referenced_asset()
    asset.write_bytes(asset.read_bytes() + b"tamper")

    with pytest.raises(ManifestIntegrityError) as exc:
        verify_render_snapshot(fixture.project_dir, fixture.export_id)
    assert exc.value.code is RenderFailureCode.INPUT_INTEGRITY_MISMATCH


def test_verifier_does_not_read_live_editorial_sources(phase07_export_fixture, monkeypatch):
    fixture = phase07_export_fixture
    for name in ("scene_plan.json", "veo_prompts.json", "visual_bible.json"):
        p = fixture.project_dir / name
        if p.exists():
            p.rename(p.with_suffix(p.suffix + ".hidden"))
    verified = verify_render_snapshot(fixture.project_dir, fixture.export_id)
    assert verified.manifest.exportId == fixture.export_id
```

- [x] **Step 2: Run RED**

```powershell
python -m pytest tests/test_phase08_manifest_integrity.py -q
```

Expected: module import failure.

- [x] **Step 3: Implement the verifier using Phase 7 code, not duplicate validators**

Use exact authority order:

```python
# studio/manifest_integrity.py
from dataclasses import dataclass
from pathlib import Path

from studio.manifest_render_types import RenderFailureCode
from studio.render_manifest import RenderManifest
from studio.render_manifest_hashing import compute_manifest_hash, hash_file
from studio.render_manifest_validation import validate_render_manifest


class ManifestIntegrityError(RuntimeError):
    def __init__(self, code: RenderFailureCode, message: str):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class VerifiedRenderSnapshot:
    project_dir: Path
    export_dir: Path
    manifest_path: Path
    manifest: RenderManifest


def verify_render_snapshot(project_dir: Path, export_id: str) -> VerifiedRenderSnapshot:
    export_dir = project_dir / "exports" / export_id
    manifest_path = export_dir / "render-manifest.json"
    if not manifest_path.is_file():
        raise ManifestIntegrityError(RenderFailureCode.INVALID_MANIFEST, "render-manifest.json is missing")

    manifest = RenderManifest.model_validate_json(manifest_path.read_text(encoding="utf-8"))
    if manifest.exportId != export_id:
        raise ManifestIntegrityError(RenderFailureCode.INVALID_MANIFEST, "exportId does not match requested export")

    actual_hash = compute_manifest_hash(manifest)
    if actual_hash != manifest.manifestHash:
        raise ManifestIntegrityError(RenderFailureCode.MANIFEST_HASH_MISMATCH, "manifestHash mismatch")

    validation = validate_render_manifest(manifest, project_dir)
    if not validation.valid:
        raise ManifestIntegrityError(RenderFailureCode.INVALID_MANIFEST, validation.blockers[0].message)

    # Re-hash every explicitly referenced visual/audio/music/subtitle file.
    # Compare against the checksum field that belongs to that manifest reference.
    # Resolve project-relative paths only; never query live registry/editorial files.
    _verify_manifest_referenced_bytes(project_dir, manifest, hash_file)

    return VerifiedRenderSnapshot(project_dir, export_dir, manifest_path, manifest)
```

Use the repo's actual Pydantic method (`model_validate_json` vs current-version equivalent) without upgrading dependencies.

- [x] **Step 4: Add traversal/absolute/UNC/missing-file cases**

Tests must explicitly cover:

```text
../escape
C:\absolute\escape
\\server\share\escape
missing referenced asset
missing configured BGM
missing configured subtitle
```

All must fail before FFmpeg is launched.

- [x] **Step 5: Run focused Phase 7 + Phase 8 integrity regression**

```powershell
python -m pytest tests/test_phase07_manifest_validation.py tests/test_phase07_manifest_hashing.py tests/test_phase08_manifest_integrity.py -q
```

Expected: PASS.

- [x] **Step 6: Commit/checkpoint**

```powershell
git add studio/manifest_integrity.py tests/test_phase08_manifest_integrity.py
git commit -m "feat(phase8): verify immutable render snapshots"
```

Use the same no-commit rule from Task 1 when commits are not authorized.

---

### Task 3: Implement Deterministic Frame-Accurate `RenderPlanner`

**Files:**
- Create: `studio/render_planner.py`
- Create: `tests/test_phase08_render_planner.py`
- Reuse: `studio/manifest_render_types.py`, `studio/manifest_integrity.py`, Phase 7 models.

**Interfaces:**
- Consumes: `VerifiedRenderSnapshot`, requested `EncoderProfileName`.
- Produces: `RenderExecutionPlan`, `ClipExecutionPlan`, `TransitionExecutionPlan`, `AudioExecutionPlan`, `SubtitleExecutionPlan`, `build_render_execution_plan(snapshot, profile_name, scratch_dir)`.

- [x] **Step 1: Write tests for frame authority and strategy selection**

```python
from studio.manifest_render_types import CompositionStrategy, EncoderProfileName
from studio.render_planner import build_render_execution_plan


def test_cut_only_manifest_uses_simple_cut(valid_snapshot, tmp_path):
    plan = build_render_execution_plan(valid_snapshot, EncoderProfileName.FINAL_QUALITY, tmp_path)
    assert plan.expected_final_frames == max(c.endFrame for c in valid_snapshot.manifest.videoTrack.clips)
    assert plan.composition_strategy is CompositionStrategy.SIMPLE_CUT


def test_crossfade_manifest_uses_filter_complex(crossfade_snapshot, tmp_path):
    plan = build_render_execution_plan(crossfade_snapshot, EncoderProfileName.FINAL_QUALITY, tmp_path)
    assert plan.composition_strategy is CompositionStrategy.FILTER_COMPLEX
    x = plan.transitions[0]
    assert x.duration_frames == crossfade_snapshot.manifest.videoTrack.clips[0].transition.durationFrames


def test_audio_sample_target_is_integer_frame_derived(valid_snapshot, tmp_path):
    plan = build_render_execution_plan(valid_snapshot, EncoderProfileName.FINAL_QUALITY, tmp_path)
    assert plan.audio.target_samples == plan.expected_final_frames * 2000
```

- [x] **Step 2: Run RED**

```powershell
python -m pytest tests/test_phase08_render_planner.py -q
```

- [x] **Step 3: Implement immutable execution-plan dataclasses**

Use structures equivalent to:

```python
@dataclass(frozen=True)
class ClipExecutionPlan:
    clip_id: str
    source_path: Path
    media_type: str
    source_fps: tuple[int, int] | None
    trim_in_frame: int | None
    trim_out_frame: int | None
    speed_factor: float
    start_frame: int
    end_frame: int
    target_frames: int
    fitting_strategy: str
    background_color: str


@dataclass(frozen=True)
class TransitionExecutionPlan:
    from_clip_id: str
    to_clip_id: str
    transition_type: str
    start_frame: int
    duration_frames: int


@dataclass(frozen=True)
class AudioExecutionPlan:
    narration_path: Path
    narration_volume: float
    target_samples: int
    music_path: Path | None
    music_volume: float | None
    music_loop: bool
    fade_in_frames: int
    fade_out_frames: int
    ducking_preset_name: str | None


@dataclass(frozen=True)
class SubtitleExecutionPlan:
    path: Path | None
    source_format: str | None
    burn_in: bool
    font_name: str | None
    font_size: int | None
    bottom_offset_px: int | None


@dataclass(frozen=True)
class RenderExecutionPlan:
    export_id: str
    manifest_hash: str
    expected_final_frames: int
    expected_duration_seconds: float
    composition_strategy: CompositionStrategy
    clips: tuple[ClipExecutionPlan, ...]
    transitions: tuple[TransitionExecutionPlan, ...]
    audio: AudioExecutionPlan
    subtitle: SubtitleExecutionPlan
    encoder_profile: EncoderProfileName
    scratch_dir: Path
```

- [x] **Step 4: Implement exact planning rules**

The planner must:

1. sort/preserve the manifest's canonical clip order;
2. reject unsupported transition/fitting values rather than substitute;
3. compute `expected_final_frames = max(endFrame)`;
4. keep all canonical placement/overlap math as integers;
5. derive seconds only as `frames / 24` for FFmpeg boundary metadata;
6. interpret `trim.inFrame/outFrame` as source-frame coordinates;
7. reject `speedFactor <= 0`;
8. select `SIMPLE_CUT` only when all transitions are CUT and no forced complex path is required;
9. select `FILTER_COMPLEX` when any CROSSFADE exists;
10. compute `target_samples = expected_final_frames * 2000`;
11. leave `STAGED_FALLBACK` available only as an explicit later execution fallback, not planner default.

- [x] **Step 5: Add 250/500-Shot planning tests**

Generate deterministic in-memory manifests; do not hard-code 141 as production logic. Assert:

```python
assert len(plan.clips) in (250, 500)
assert plan.expected_final_frames > 0
assert plan.composition_strategy in {CompositionStrategy.SIMPLE_CUT, CompositionStrategy.FILTER_COMPLEX}
```

Record wall-clock planning time as evidence; do not define a fabricated SLA.

- [x] **Step 6: Run focused tests**

```powershell
python -m pytest tests/test_phase08_render_planner.py tests/test_phase07_timeline_compiler.py -q
```

- [x] **Step 7: Commit/checkpoint**

```powershell
git add studio/render_planner.py tests/test_phase08_render_planner.py
git commit -m "feat(phase8): plan frame accurate final renders"
```

---

### Task 4: Build Visual FFmpeg Inputs and Composition Graphs

**Files:**
- Create: `studio/ffmpeg_graph_builder.py`
- Create: `tests/test_phase08_ffmpeg_graph_builder.py`
- Reuse: `studio/render_planner.py`, `studio/render_profiles.py`

**Interfaces:**
- Consumes: `RenderExecutionPlan`.
- Produces: `FFmpegBuild`, `FFmpegInput`, `build_ffmpeg_execution(plan)`, generated `filter-complex.txt` / optional concat list in scratch.

- [x] **Step 1: Write failing visual graph tests**

Pin these behaviors:

```python
from studio.ffmpeg_graph_builder import build_ffmpeg_execution


def test_image_input_is_24fps_held_stream(image_plan):
    build = build_ffmpeg_execution(image_plan)
    assert "-loop" in build.argv
    assert "-framerate" in build.argv
    assert "24" in build.argv


def test_fit_pad_preserves_aspect_and_uses_background(fit_pad_plan):
    build = build_ffmpeg_execution(fit_pad_plan)
    graph = build.filter_script_text
    assert "force_original_aspect_ratio=decrease" in graph
    assert "pad=1920:1080" in graph
    assert "0x0b0f19" in graph or "#0b0f19" in graph


def test_fill_crop_preserves_aspect_and_center_crops(fill_crop_plan):
    graph = build_ffmpeg_execution(fill_crop_plan).filter_script_text
    assert "force_original_aspect_ratio=increase" in graph
    assert "crop=1920:1080" in graph


def test_video_source_trim_occurs_before_fps_conformance(video_trim_plan):
    graph = build_ffmpeg_execution(video_trim_plan).filter_script_text
    assert graph.index("trim=") < graph.index("fps=24")


def test_crossfade_uses_manifest_frame_overlap(crossfade_plan):
    graph = build_ffmpeg_execution(crossfade_plan).filter_script_text
    assert "xfade=" in graph
    assert "duration=1" in graph  # 24 frames at 24fps fixture
```

- [x] **Step 2: Run RED**

```powershell
python -m pytest tests/test_phase08_ffmpeg_graph_builder.py -q
```

- [x] **Step 3: Implement a command description instead of raw shell strings**

Use:

```python
@dataclass(frozen=True)
class FFmpegInput:
    path: Path
    options: tuple[str, ...]


@dataclass(frozen=True)
class FFmpegBuild:
    inputs: tuple[FFmpegInput, ...]
    argv: tuple[str, ...]
    filter_script_path: Path
    filter_script_text: str
    expected_final_frames: int
    candidate_path: Path
```

All subprocess execution must later use argv lists, never `shell=True` string concatenation.

- [x] **Step 4: Implement per-clip visual normalization**

For VIDEO clips, generate filter order equivalent to:

```text
trim=start_frame=<in>:end_frame=<out>
,setpts=(PTS-STARTPTS)/<speedFactor>
,setpts=(PTS-STARTPTS)/<speedFactor>
,fps=24
,<FIT_PAD or FILL_CROP>
,setsar=1
,format=yuv420p
,settb=expr=1/24
,trim=end_frame=<targetFrames>
,setpts=PTS-STARTPTS
```

For IMAGE clips, use input options equivalent to:

```text
-loop 1 -framerate 24 -i <image>
```

then the same aspect/pixel/timebase normalization and exact `targetFrames` trim.

Do not use source video audio streams.

- [x] **Step 5: Implement CUT-only composition without raw-file concat assumptions**

For heterogeneous inputs, `SIMPLE_CUT` should use normalized video streams followed by FFmpeg's `concat` **filter**:

```text
[v0][v1][v2]concat=n=3:v=1:a=0[vout]
```

Do not feed mixed raw image/video provider files directly to the concat demuxer. The demuxer may be used only later for staged normalized files that already have identical stream structure.

- [x] **Step 6: Implement CROSSFADE chaining from manifest frames**

For each CROSSFADE, use:

```text
duration_seconds = duration_frames / 24
offset_seconds   = next_clip.start_frame / 24
```

Generate `xfade=transition=fade:duration=<duration_frames/24>:offset=<next_start_frame/24>` from the integer frame values only after both sides are normalized to 1920x1080 / 24fps / yuv420p / compatible timebase.

- [x] **Step 7: Enforce final visual clamp and fixed output mux options**

End the visual path with exact expected-frame enforcement. Extra boundary frames may be trimmed. The runtime must later treat an actual underrun as `RENDER_FRAME_UNDERRUN`; do not synthesize missing visual frames.

The final argv must also pin the container/output invariants rather than relying on FFmpeg defaults:

```text
-r 24
-pix_fmt yuv420p
-c:a aac
-b:a 192k
-ar 48000
-ac 2
-movflags +faststart
```

For non-trivial compositions, pass the generated graph with `-filter_complex_script <scratch/filter-complex.txt>` (or the current FFmpeg-equivalent option supported by the pinned build) instead of embedding the entire graph in one Windows command line. Do not add `-shortest`.

- [x] **Step 8: Run visual matrix tests**

Add fixture tests for:

```text
image/video
landscape/portrait/square
24/30/60 fps metadata
VFR-declared fixture
speedFactor 0.5/1/2
1-frame and 7-frame transition
mixed CUT/CROSSFADE
```

Then run:

```powershell
python -m pytest tests/test_phase08_ffmpeg_graph_builder.py tests/test_phase08_render_planner.py -q
```

- [x] **Step 9: Commit/checkpoint**

```powershell
git add studio/ffmpeg_graph_builder.py tests/test_phase08_ffmpeg_graph_builder.py
git commit -m "feat(phase8): build frame accurate ffmpeg graphs"
```

---

### Task 5: Add Narration/BGM Ducking, Exact Audio Length, and Subtitle Mapping

**Files:**
- Modify: `studio/ffmpeg_graph_builder.py`
- Modify: `studio/render_profiles.py`
- Extend: `tests/test_phase08_ffmpeg_graph_builder.py`
- Create: `tests/test_phase08_audio_subtitles.py`

**Interfaces:**
- Consumes: `AudioExecutionPlan`, `SubtitleExecutionPlan`, `NARRATION_DUCK_V1`.
- Produces: final audio label `[aout]`, optional soft subtitle stream mapping, hard-burn video label when requested.

- [x] **Step 1: Write failing audio-duration and sidechain tests**

```python

def test_target_audio_samples_is_exact(audio_plan):
    build = build_ffmpeg_execution(audio_plan)
    assert f"end_sample={audio_plan.expected_final_frames * 2000}" in build.filter_script_text


def test_sidechain_compresses_music_not_voice(music_plan):
    graph = build_ffmpeg_execution(music_plan).filter_script_text
    assert "asplit=2" in graph
    assert "sidechaincompress" in graph
    assert "amix=inputs=2:duration=first" in graph
    assert "normalize=0" in graph


def test_no_bgm_is_valid(narration_only_plan):
    graph = build_ffmpeg_execution(narration_only_plan).filter_script_text
    assert "sidechaincompress" not in graph
    assert "[aout]" in graph
```

- [x] **Step 2: Write failing subtitle tests**

```python

def test_soft_subtitle_maps_mov_text(soft_subtitle_plan):
    build = build_ffmpeg_execution(soft_subtitle_plan)
    assert "-c:s" in build.argv
    assert "mov_text" in build.argv
    assert "subtitles=" not in build.filter_script_text


def test_hard_subtitle_burns_and_does_not_mux_duplicate_soft_stream(hard_subtitle_plan):
    build = build_ffmpeg_execution(hard_subtitle_plan)
    assert "subtitles=" in build.filter_script_text
    assert "mov_text" not in build.argv
```

- [x] **Step 3: Run RED**

```powershell
python -m pytest tests/test_phase08_audio_subtitles.py -q
```

- [x] **Step 4: Implement narration canonicalization**

Use a filter chain that:

1. decodes narration master;
2. applies manifest narration volume;
3. resamples to `48000`;
4. converts to stereo before final encode;
5. pads only if the verified pre-render mismatch is `<= 2000` samples;
6. trims to `target_samples` exactly;
7. fails before execution if source mismatch is greater than one canonical frame.

The generated path should use sample-oriented trimming, e.g. `atrim=end_sample=<target_samples>`; do not use `-shortest`.

- [x] **Step 5: Implement optional BGM + deterministic sidechain preset**

For configured BGM:

```text
loop=true  -> add input loop option, then trim exact target
loop=false -> play once; do not make the mix longer than narration
```

Generate a graph equivalent to:

```text
[narration]volume=<voice>,aresample=48000,aformat=channel_layouts=stereo,asplit=2[voice][side]
[music]volume=<music>,aresample=48000,<fade filters>[music_pre]
[music_pre][side]sidechaincompress=<NARRATION_DUCK_V1 parameters>[music_duck]
[voice][music_duck]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]
[aout]atrim=end_sample=<targetSamples>[aout_exact]
```

Record the exact resolved ducking preset/version in `render-metadata.json` later.

- [x] **Step 6: Add a deterministic ducking fixture check**

Create short synthetic narration/BGM inputs in the test temp directory and verify:

- voice path samples are unchanged apart from required resample/channel mapping;
- music level during voiced section is lower than its base section;
- music recovers after a deliberate pause;
- no clipping/NaN filter failure occurs.

This is test evidence for the chosen deterministic preset; do not add LUFS normalization.

- [x] **Step 7: Implement soft subtitle mapping**

When `burnIn=false`:

```text
-map <explicit composed video label>
-map <explicit final audio label>
-map <explicit subtitle input stream>
-c:s mov_text
```

Never use automatic stream selection.

- [x] **Step 8: Implement hard subtitle path**

When `burnIn=true`, use the subtitle filter/libass on the composed canonical video and omit a soft subtitle stream. Resolve requested font from the existing runtime font environment / configured fonts directory. Missing requested font -> `SUBTITLE_FONT_UNAVAILABLE`; do not silently substitute.

- [x] **Step 9: Run focused tests**

```powershell
python -m pytest tests/test_phase08_audio_subtitles.py tests/test_phase08_ffmpeg_graph_builder.py -q
```

- [x] **Step 10: Commit/checkpoint**

```powershell
git add studio/ffmpeg_graph_builder.py studio/render_profiles.py tests/test_phase08_audio_subtitles.py tests/test_phase08_ffmpeg_graph_builder.py
git commit -m "feat(phase8): compose audio ducking and subtitles"
```

---

### Task 6: Implement Structured Failure Classification and Fallback Eligibility

**Files:**
- Create: `studio/render_failure_classifier.py`
- Create: `tests/test_phase08_failure_classifier.py`
- Reuse: `studio/manifest_render_types.py`

**Interfaces:**
- Consumes: `stderr_tail: str`, `encoder: str`, `execution_stage: str`, `return_code: int`, `cancel_requested: bool`.
- Produces: `FailureClassification(code, fallback_eligible)` and `classify_render_failure(stderr_tail, encoder, execution_stage, return_code, cancel_requested)`.

- [x] **Step 1: Write table-driven failing tests**

```python
import pytest

from studio.manifest_render_types import RenderFailureCode
from studio.render_failure_classifier import classify_render_failure


@pytest.mark.parametrize(
    "stderr, expected",
    [
        ("No capable devices found", RenderFailureCode.ENCODER_HARDWARE_UNAVAILABLE),
        ("Cannot load libcuda", RenderFailureCode.ENCODER_HARDWARE_UNAVAILABLE),
        ("OpenEncodeSessionEx failed: out of memory", RenderFailureCode.ENCODER_OUT_OF_MEMORY),
        ("InitializeEncoder failed", RenderFailureCode.ENCODER_INITIALIZATION_FAILED),
        ("encoder is busy", RenderFailureCode.ENCODER_BUSY),
    ],
)
def test_nvenc_hardware_failures_are_fallback_eligible(stderr, expected):
    result = classify_render_failure(stderr, "h264_nvenc", "ENCODING", 1, False)
    assert result.code is expected
    assert result.fallback_eligible is True


def test_filter_error_never_falls_back():
    result = classify_render_failure("Error reinitializing filters", "h264_nvenc", "ENCODING", 1, False)
    assert result.code is RenderFailureCode.FILTERGRAPH_ERROR
    assert result.fallback_eligible is False


def test_unknown_error_never_falls_back():
    result = classify_render_failure("unrecognized catastrophic thing", "h264_nvenc", "ENCODING", 1, False)
    assert result.code is RenderFailureCode.UNKNOWN_RENDER_ERROR
    assert result.fallback_eligible is False
```

- [x] **Step 2: Run RED**

```powershell
python -m pytest tests/test_phase08_failure_classifier.py -q
```

- [x] **Step 3: Implement stage-aware classification**

Use explicit, ordered signatures. Cancellation wins before generic classification. Input/filter/subtitle/mux signatures win before generic NVENC tokens. Only these four codes may return `fallback_eligible=True`:

```text
ENCODER_HARDWARE_UNAVAILABLE
ENCODER_OUT_OF_MEMORY
ENCODER_INITIALIZATION_FAILED
ENCODER_BUSY
```

All others are false.

- [x] **Step 4: Add regression for misleading CUDA/NVENC text**

A filter/input failure whose stderr also mentions GPU/NVENC context must still classify as the non-hardware root cause. Do not use `"CUDA" in stderr` as a fallback rule.

- [x] **Step 5: Run focused tests**

```powershell
python -m pytest tests/test_phase08_failure_classifier.py -q
```

- [x] **Step 6: Commit/checkpoint**

```powershell
git add studio/render_failure_classifier.py tests/test_phase08_failure_classifier.py
git commit -m "feat(phase8): classify render failures safely"
```

---

### Task 7: Implement Background FFmpeg Process Runner, Progress, and Cancellation

**Files:**
- Create: `studio/ffmpeg_process_runner.py`
- Create: `tests/test_phase08_process_runner.py`
- Reuse: `studio/manifest_render_types.py`, `studio/render_failure_classifier.py`

**Interfaces:**
- Consumes: FFmpeg argv list, `job_id`, async `progress_callback`, async/sync `cancel_check`.
- Produces: `RenderAttemptResult`; writes full runtime log to scratch; retains bounded stderr tail.

- [x] **Step 1: Write failing progress parser tests**

```python
from studio.ffmpeg_process_runner import FFmpegProgressParser


def test_progress_parser_emits_completed_blocks():
    parser = FFmpegProgressParser()
    event = None
    for line in [
        "frame=120\n",
        "fps=24.0\n",
        "out_time_ms=5000000\n",
        "progress=continue\n",
    ]:
        event = parser.feed_line(line) or event
    assert event["frame"] == 120
    assert event["progress"] == "continue"
```

- [x] **Step 2: Write cancellation/process-group tests with a local child fixture**

Use a tiny Python child process fixture in the test that runs until interrupted. Do not require FFmpeg for this unit test. Assert:

- runner starts a new process group on Windows;
- cancellation first requests graceful interruption;
- runner force-terminates only after configured grace timeout;
- pipes/tasks are awaited and closed;
- returned result is `cancelled=True`.

- [x] **Step 3: Run RED**

```powershell
python -m pytest tests/test_phase08_process_runner.py -q
```

- [x] **Step 4: Implement subprocess launch**

Use `asyncio.create_subprocess_exec` with argv values. Required FFmpeg invocation prefix:

```text
ffmpeg
-hide_banner
-nostdin
-progress pipe:1
-stats_period 0.5
```

On Windows add `subprocess.CREATE_NEW_PROCESS_GROUP`. Use `stdout=PIPE`, `stderr=PIPE`, `stdin=DEVNULL`.

- [x] **Step 5: Drain stdout and stderr concurrently**

Implement separate async reader tasks:

```python
async def _read_progress(stream, parser, callback):
    while True:
        raw = await stream.readline()
        if not raw:
            break
        event = parser.feed_line(raw.decode("utf-8", errors="replace"))
        if event is not None:
            await callback(event)


async def _read_stderr(stream, log_file, tail_buffer):
    while True:
        raw = await stream.readline()
        if not raw:
            break
        text = raw.decode("utf-8", errors="replace")
        log_file.write(text)
        log_file.flush()
        tail_buffer.append(text.rstrip("\r\n"))
```

Do not use `communicate()` for an unbounded FFmpeg stderr log. Stream full stderr to `scratch/ffmpeg.log` and keep only a bounded tail in memory/persistent job state.

- [x] **Step 6: Map runtime progress to max 99%**

Given `expected_final_frames`:

```python
percent = min(99, int(frame * 100 / expected_final_frames))
```

Persist/report monotonic progress only; never regress progress because FFmpeg repeats/rewinds a progress counter.

- [x] **Step 7: Implement cancellation sequence**

Windows:

```python
process.send_signal(signal.CTRL_BREAK_EVENT)
```

for a process created with `CREATE_NEW_PROCESS_GROUP`, wait configured grace duration, then `terminate()` if still alive.

Non-Windows: use the platform-appropriate graceful signal then terminate/kill escalation.

- [x] **Step 8: Run unit tests**

```powershell
python -m pytest tests/test_phase08_process_runner.py -q
```

- [x] **Step 9: Commit/checkpoint**

```powershell
git add studio/ffmpeg_process_runner.py tests/test_phase08_process_runner.py
git commit -m "feat(phase8): run ffmpeg with progress and cancellation"
```

---

### Task 8: Implement Strict No-Replace Final Publication and Provenance

**Files:**
- Create: `studio/final_artifact_publisher.py`
- Create: `tests/test_phase08_publisher.py`
- Reuse: `studio/manifest_render_types.py`

**Interfaces:**
- Consumes: `candidate_path`, `export_dir`, persisted render provenance.
- Produces: immutable `final.mp4`, immutable/repairable-if-missing `render-metadata.json`, typed publish result.

- [x] **Step 1: Write failing tests for no-overwrite semantics**

```python
from studio.final_artifact_publisher import AlreadyRenderedError, publish_candidate


def test_existing_final_is_never_overwritten(tmp_path):
    export_dir = tmp_path / "exports" / "export_001"
    export_dir.mkdir(parents=True)
    final = export_dir / "final.mp4"
    final.write_bytes(b"old-final")
    candidate = tmp_path / "candidate.mp4"
    candidate.write_bytes(b"new-final")

    try:
        publish_candidate(candidate, export_dir, {"exportId": "export_001"})
        assert False, "expected AlreadyRenderedError"
    except AlreadyRenderedError:
        pass

    assert final.read_bytes() == b"old-final"
```

Also test empty candidate, missing candidate, different volume/drive guard, and two simultaneous publish attempts.

- [x] **Step 2: Run RED**

```powershell
python -m pytest tests/test_phase08_publisher.py -q
```

- [x] **Step 3: Implement same-filesystem no-replace publish**

Required behavior:

```python
def _publish_no_replace(src: Path, dst: Path) -> None:
    if dst.exists():
        raise AlreadyRenderedError(dst)
    if os.name == "nt":
        # Windows os.rename fails when destination already exists and is same-volume atomic.
        os.rename(src, dst)
    else:
        # POSIX os.rename can overwrite, so use hard-link creation as atomic no-replace publish.
        os.link(src, dst)
        os.unlink(src)
```

Before this helper, prove src/dst are on the same volume/filesystem using platform-appropriate checks. Do not fall back to copy+delete for the canonical publish path.

- [x] **Step 4: Implement candidate sanity**

Before publish:

```text
candidate exists
candidate is a regular file
candidate size > 0
cancelRequested == false
```

No ffprobe quality gate here; Phase 9 owns product QA.

- [x] **Step 5: Implement provenance sidecar creation**

Create `render-metadata.json` only after `final.mp4` commit. Write to a temp file, flush/close, then create the final sidecar without silently overwriting an existing sidecar. Required fields:

```text
exportId
manifestHash
renderJobId
renderEngine=ffmpeg
ffmpegVersion
encoderProfileRequested
encoderActuallyUsed
encoderProfileVersion
fallbackAttempted
attemptSummary
expectedFinalFrames
fps=24/1
resolution=1920x1080
pixelFormat=yuv420p
audioCodec=aac
audioBitrateTarget=192k
audioSampleRate=48000
audioChannels=2
subtitleMode
subtitleCodec
duckingPreset
completedAt
```

Add a `repair_missing_metadata(export_dir: Path, provenance: dict)` helper that may create the sidecar only when `final.mp4` exists and persisted lineage matches; it must never replace an existing Final.

- [x] **Step 6: Run publisher tests**

```powershell
python -m pytest tests/test_phase08_publisher.py -q
```

- [x] **Step 7: Commit/checkpoint**

```powershell
git add studio/final_artifact_publisher.py tests/test_phase08_publisher.py
git commit -m "feat(phase8): publish immutable final artifacts"
```

---

### Task 9: Integrate Persistent Jobs, Global Final Gate, Resource Classes, Attempts, and Recovery

**Files:**
- Create: `studio/manifest_render_service.py`
- Modify: `studio/jobs_manager.py`
- Modify only if required by current API: `studio/resource_scheduler.py`
- Create: `tests/test_phase08_render_service.py`
- Create: `tests/test_phase08_recovery.py`

**Interfaces:**
- Consumes: all Phase 8 modules from Tasks 1-8, existing `jobs_manager`, existing `LocalResourceScheduler` / `ResourceGuard`.
- Produces: `ManifestRenderService.start_final_render(project_id, export_id, encoder_profile)`, `cancel_final_render(project_id, job_id)`, startup recovery integration, persistent attempt history.

- [x] **Step 1: Add minimal persistent-job helpers with tests**

Do not create a new storage location. Add helpers to the existing `jobs_manager.py` that operate through its current canonical project-job storage and mirror/conflict machinery:

Public signatures to add:

```python
def find_active_project_job(project_id: str, job_type: str, export_id: str) -> dict | None:
    """Return the existing non-terminal project job that owns this export, or None."""


def patch_project_job(project_id: str, job_id: str, **fields) -> dict:
    """Merge fields into the canonical project job through existing atomic persistence/mirroring."""
```

Implement both by calling the current `jobs_manager.py` load/list/update primitives already responsible for `projects/<projectId>/jobs/<jobId>.json` and runtime mirror conflict resolution. Do not open/write those JSON files directly from `manifest_render_service.py`. Active means a non-terminal job that can still own work for the export. Preserve the existing generic job status enum and existing atomic-write/conflict resolution.

Tests must prove the helper does not bypass `projects/<projectId>/jobs/<jobId>.json` as project storage-of-record.

- [x] **Step 2: Write failing service tests for idempotency and canonical-output exclusivity**

```python
async def test_same_export_returns_existing_active_job(service_fixture):
    first = await service_fixture.service.start_final_render(
        project_id=service_fixture.project_id,
        export_id="export_001",
        encoder_profile="FINAL_QUALITY",
    )
    second = await service_fixture.service.start_final_render(
        project_id=service_fixture.project_id,
        export_id="export_001",
        encoder_profile="ACCELERATED",
    )
    assert second["jobId"] == first["jobId"]


async def test_existing_final_returns_already_rendered(service_fixture):
    service_fixture.write_canonical_final(b"existing")
    result = await service_fixture.service.start_final_render(
        project_id=service_fixture.project_id,
        export_id="export_001",
        encoder_profile="FINAL_QUALITY",
    )
    assert result["errorCode"] == "ALREADY_RENDERED"
```

- [x] **Step 3: Implement one process-wide Final Render gate**

In `manifest_render_service.py`, own one singleton semaphore/lock for Final Render concurrency `1`. The FastAPI app must instantiate/reuse one service instance; do not create a new semaphore per request.

The global gate is held across an NVENC -> CPU fallback transition. The per-attempt scheduler resource permit changes from `GPU_ENCODER` to `CPU_BOUND` only after the GPU permit is released.

- [x] **Step 4: Implement `start_final_render` orchestration**

Required sequence:

```text
resolve project/export
-> final exists? ALREADY_RENDERED
-> active FINAL_RENDER same export? return existing
-> verify immutable snapshot
-> create QUEUED persistent job
-> background task waits for global Final gate
-> executionPhase=WAITING_RESOURCE
-> acquire profile-specific scheduler resource
-> status=RUNNING, executionPhase=PREPARING
-> build plan/build FFmpeg command
-> executionPhase=ENCODING
-> run attempt
-> hardware-only NVENC failure? release GPU permit, acquire CPU_BOUND, run one x264 fallback
-> FFmpeg exit 0 but final reported frame < expectedFinalFrames? fail RENDER_FRAME_UNDERRUN
-> success -> candidate gate -> publish
-> persist artifact NEEDS_REVIEW with reasonCode=PENDING_RENDER_QA through the current artifact-status owner
-> COMPLETED/100
```

- [x] **Step 5: Persist post-render artifact state through the existing artifact authority**

Before coding this step, locate the current artifact-status owner with:

```powershell
rg -n "ReviewStatus|EffectiveStatus|NEEDS_REVIEW|artifact.*status|review_status" studio
```

Use that existing owner/API. Do not create a second artifact-state JSON file merely for Phase 8. After canonical Final publication, persist:

```text
status = NEEDS_REVIEW
reasonCode = PENDING_RENDER_QA
artifact/export reference = the same exportId
```

If the existing artifact record supports metadata but not a dedicated `reasonCode` field, add the smallest backward-compatible optional field at that existing schema/record boundary and persist it. Do not add a new persisted `PENDING_QA` enum.

- [x] **Step 6: Persist attempt history exactly once per attempt**

Use records equivalent to:

```json
{
  "attempt": 1,
  "encoder": "h264_nvenc",
  "profileVersion": "ACCELERATED_V1",
  "status": "FAILED",
  "errorCode": "ENCODER_OUT_OF_MEMORY",
  "startedAt": "2026-09-18T00:00:00Z",
  "completedAt": "2026-09-18T00:00:05Z"
}
```

Fallback creates at most attempt 2. There is no attempt 3.

- [x] **Step 7: Wire progress to existing persistent job state**

The runner callback updates:

```text
frame
fps
outTime
eta
progress <= 99
updatedAt
```

Throttle writes enough to avoid a job-file write for every FFmpeg line while preserving the existing UI's 2-second polling usefulness. Use a deterministic minimum persistence interval (for example 0.5-1.0s) in service configuration, not scattered constants.

- [x] **Step 8: Implement cancellation with publish-boundary protection**

`cancel_final_render(project_id, job_id)`:

- `QUEUED` -> persist cancel and end `CANCELLED` without launching FFmpeg;
- `RUNNING` -> persist `cancelRequestedAt`, signal runner, then `CANCELLED` after process exit;
- candidate success but cancellation persisted before publish -> delete candidate/cleanup and `CANCELLED`;
- canonical Final already committed -> keep `COMPLETED`, return `JOB_ALREADY_COMPLETED`.

- [x] **Step 9: Implement Final Render crash reconciliation**

Integrate with the current startup recovery flow instead of replacing it. For `FINAL_RENDER` jobs:

```text
RUNNING + pre-publish phase + no Final -> INTERRUPTED
RUNNING + CANDIDATE_READY + no Final -> INTERRUPTED, no auto-promote
RUNNING + PUBLISHING/PUBLISHED + Final exists + lineage match -> COMPLETED + repair missing metadata
COMPLETED + Final absent -> integrity inconsistency, never fabricate file/success
```

Do not create a valid mid-render checkpoint; therefore generic recovery must not turn a Phase 8 Final Render into `RESUMABLE` merely because the generic job system supports that state.

- [x] **Step 10: Prove resource permits release on every terminal path**

Use fake scheduler permits/counters in tests for:

```text
success
NVENC fallback success
non-fallback failure
queued cancel
running cancel
exception during publish
startup interruption
```

Expected: no leaked `FINAL_RENDER`, `CPU_BOUND`, or `GPU_ENCODER` ownership.

- [x] **Step 11: Run focused orchestration tests**

```powershell
python -m pytest tests/test_phase08_render_service.py tests/test_phase08_recovery.py tests/test_phase15a_hardening.py -q
```

- [x] **Step 12: Commit/checkpoint**

```powershell
git add studio/manifest_render_service.py studio/jobs_manager.py studio/resource_scheduler.py tests/test_phase08_render_service.py tests/test_phase08_recovery.py
git commit -m "feat(phase8): orchestrate persistent final render jobs"
```

Do not stage `studio/resource_scheduler.py` if it did not require a source change.

---

### Task 10: Cut Over Only the Final Render API and Export Workbench

**Files:**
- Modify: current owner of `POST /api/projects/{dir_name}/render/final` (expected `studio/phase14_router.py` or current equivalent)
- Modify: `studio/static/app.js`
- Modify: existing Export Workbench markup/CSS owner only if needed
- Create: `tests/test_phase08_api_ui_contract.py`
- Reuse: existing `/api/activity/jobs`, existing cancellation endpoint, existing Draft route.

**Interfaces:**
- Consumes: `ManifestRenderService`.
- Produces: Final Render request with explicit `exportId`, encoder-profile selection, export-explicit Final file resolver, Vietnamese status mapping.

- [x] **Step 1: Write failing API tests**

Pin the request contract:

```python

def test_final_render_requires_persisted_export_snapshot(client, project_fixture):
    response = client.post(
        f"/api/projects/{project_fixture.id}/render/final",
        json={"exportId": "export_001", "encoderProfile": "FINAL_QUALITY"},
    )
    assert response.status_code in (200, 202)
    body = response.json()
    assert body["exportId"] == "export_001"
    assert body["encoderProfile"] == "FINAL_QUALITY"


def test_final_file_route_is_export_explicit(client, rendered_export_fixture):
    response = client.get(
        f"/api/projects/{rendered_export_fixture.project_id}/exports/{rendered_export_fixture.export_id}/final/file"
    )
    assert response.status_code == 200
```

Also assert Final Render does not invoke Phase 7 compile/persist as a side effect.

- [x] **Step 2: Run RED**

```powershell
python -m pytest tests/test_phase08_api_ui_contract.py -q
```

- [x] **Step 3: Add/modify Final Render request model**

Use the repo's current Pydantic style:

```python
class FinalRenderRequest(BaseModel):
    exportId: str
    encoderProfile: Literal["FINAL_QUALITY", "ACCELERATED"] = "FINAL_QUALITY"
```

Validate `exportId` with the same directory/identifier safety policy used by Phase 7 export persistence.

- [x] **Step 4: Route Final through `ManifestRenderService` only**

Do not call legacy `renderer_adapter.render_final()` for new Phase 8 Final renders. Draft continues using the existing renderer unchanged.

- [x] **Step 5: Add export-explicit safe Final file route**

Required canonical route:

```text
GET /api/projects/{projectId}/exports/{exportId}/final/file
```

Use fixed server-side filename `final.mp4`; validate project/export IDs; reject traversal; `404` when absent; support current inline/download semantics without exposing arbitrary paths.

The existing project-level `/renders/final/file` may remain for legacy pre-Phase-8 output but must not create/copy a new Phase 8 canonical file into `renders/final/`.

- [x] **Step 6: Add compact encoder-mode control to the existing Final card**

UI values:

```text
Chất lượng cuối (mặc định) -> FINAL_QUALITY
Tăng tốc GPU              -> ACCELERATED
```

Do not add a new workspace or expose CRF/CQ/preset knobs to the normal user.

The render click sends the currently selected persisted `exportId` and selected profile.

- [x] **Step 7: Reuse existing job polling**

Keep `pollRenderJob` / `/api/activity/jobs`. Add mappings only where missing:

```text
RUNNING + FINAL_RENDER -> Đang kết xuất
INTERRUPTED            -> Bị gián đoạn
NEEDS_REVIEW + PENDING_RENDER_QA -> Chờ kiểm định
```

Do not create another polling loop/SSE stream.

- [x] **Step 8: Point preview/download at the same exportId**

After a completed Final job, the player/download link must use:

```text
/api/projects/<project>/exports/<exportId>/final/file
```

No “latest Final” heuristic.

- [x] **Step 9: Run API/UI contract + existing Export Workbench regression**

```powershell
python -m pytest tests/test_phase08_api_ui_contract.py tests/test_phase03d_export_workbench.py -q
```

If the existing 3D test filename differs, use the actual current Export Workbench regression file and record it in the report.

- [x] **Step 10: Commit/checkpoint**

```powershell
git add studio/phase14_router.py studio/static/app.js tests/test_phase08_api_ui_contract.py
git commit -m "feat(phase8): cut final render over to manifest engine"
```

Stage only the actual route/markup/CSS files changed.

---

### Task 11: Prove Cancellation, Crash Recovery, No-Overwrite Races, and Scratch Cleanup

**Files:**
- Extend: `tests/test_phase08_recovery.py`
- Extend: `tests/test_phase08_render_service.py`
- Extend: `tests/test_phase08_publisher.py`
- Add only if useful: `scripts/verify_phase08_runtime_safety.py`
- Evidence: `temp/phase08_verification/runtime_safety/`

**Interfaces:**
- Consumes: complete service/runner/publisher stack.
- Produces: runtime-safety evidence, not new product features.

- [x] **Step 1: Add queued-cancel test**

Assert:

```text
QUEUED -> CANCELLED
FFmpeg launches = 0
final.mp4 absent
scratch absent/clean
```

- [x] **Step 2: Add running-cancel test**

Use a controllable fake/fixture runner that produces progress then waits. Assert:

```text
cancelRequestedAt persisted before process stop
status -> CANCELLED
candidate never published
all permits released
```

- [x] **Step 3: Add cancel-after-encode-before-publish race**

Block publisher with a barrier. Set cancellation after the runner returns success but before publish guard. Assert canonical Final remains absent and job becomes `CANCELLED`.

- [x] **Step 4: Add late-cancel-after-publish race**

Block immediately after Final commit. Issue cancel. Assert:

```text
final.mp4 remains byte-identical
job remains COMPLETED
cancel returns JOB_ALREADY_COMPLETED
```

- [x] **Step 5: Add crash-state reconciliation table tests**

Persist synthetic job records for each matrix row:

```text
QUEUED/no Final
RUNNING+ENCODING/no Final
RUNNING+CANDIDATE_READY/no Final
RUNNING+PUBLISHING/Final exists
RUNNING+PUBLISHED/Final exists/metadata absent
COMPLETED/Final absent
```

Call the actual recovery entrypoint. Assert exact expected status/reconciliation and that no candidate is auto-promoted.

- [x] **Step 6: Add competing publisher race**

Two tasks try to publish different candidate bytes to the same export. Exactly one succeeds. The other gets `ALREADY_RENDERED`; Final bytes equal one complete candidate, never a mixed/corrupt file.

- [x] **Step 7: Add scratch retention/cleanup assertions**

After success/failure/cancel/interruption, assert large candidate/intermediate files are removed according to existing retention policy while bounded persistent diagnostics remain available in job data/report evidence.

- [x] **Step 8: Run safety tests repeatedly**

```powershell
1..5 | ForEach-Object { python -m pytest tests/test_phase08_recovery.py tests/test_phase08_render_service.py tests/test_phase08_publisher.py -q }
```

All 5 repetitions must pass; report any flaky race rather than hiding/retrying it indefinitely.

- [x] **Step 9: Save evidence**

Write machine-readable results under:

```text
temp/phase08_verification/runtime_safety/results.json
```

Include each scenario, resulting status, Final existence/hash where relevant, and permit counts.

- [x] **Step 10: Commit/checkpoint**

```powershell
git add tests/test_phase08_recovery.py tests/test_phase08_render_service.py tests/test_phase08_publisher.py scripts/verify_phase08_runtime_safety.py
git commit -m "test(phase8): verify render runtime safety"
```

Stage the script only if created.

---

### Task 12: Run Real FFmpeg E2E Fixtures and Pin Encoder Evidence

**Files:**
- Create: `tests/test_phase08_real_ffmpeg.py`
- Create: `scripts/verify_phase08_render_engine.py`
- Create: `scripts/run_phase08_encoder_benchmark.py`
- Modify: `studio/render_profiles.py` only if evidence shows the versioned accelerated profile needs correction before acceptance.
- Evidence: `temp/phase08_verification/real_ffmpeg/`, `temp/phase08_verification/benchmark/`

**Interfaces:**
- Consumes: actual installed FFmpeg and complete Phase 8 Final Render stack.
- Produces: real MP4s/logs/ffprobe evidence used only for implementation verification; no Phase 9 product QA module.

**Note:** Task 11's `1..5 | ForEach-Object` loop, Task 12's benchmark loops, and the final full-suite runs in Task 13 are expected to be long. Prefer running long shell commands with explicit generous timeouts, running independent commands in parallel where the tool allows, and skipping redundant re-runs when earlier output already satisfies the requirement.

- [x] **Step 1: Generate deterministic media fixtures with FFmpeg**

In a temp/evidence fixture directory, create:

```text
landscape testsrc2 video 1280x720 / 30fps
portrait testsrc2 or color/video fixture 720x1280 / 60fps
single PNG/JPEG/WebP image fixtures
PCM s16le WAV narration / 24kHz / mono
short BGM fixture
SRT fixture
```

Use FFmpeg lavfi/testsrc/sine sources where possible; do not check large generated media into Git.

- [x] **Step 2: Build one persisted Phase 7-compatible export fixture**

The fixture must include at least:

```text
IMAGE + FIT_PAD
VIDEO + FILL_CROP
non-zero source trim
one CUT
one 24-frame CROSSFADE
narration master
BGM loop + ducking
soft subtitle
```

Persist a valid `render-manifest.json` using the Phase 7 model/hash code, then run the **actual Phase 8 service path**, not a direct ad-hoc FFmpeg command.

- [x] **Step 3: Assert actual Final output with ffprobe in the test/evidence layer**

It is acceptable for Phase 8 implementation tests to use ffprobe as evidence; do not add runtime Phase 9 gatekeeping.

Assert:

```text
video codec = h264
width/height = 1920/1080
nominal frame rate = 24/1
audio codec = aac
audio sample rate = 48000
audio channels = 2
soft subtitle codec/tag present when configured
Final path = exports/<exportId>/final.mp4
job = COMPLETED
artifact = NEEDS_REVIEW / PENDING_RENDER_QA
```

Also count decoded video frames in the fixture and compare with `expectedFinalFrames`. Record the evidence; do not wire this as product runtime QA.

- [x] **Step 4: Verify hard-burn subtitle fixture separately**

Run a second export with `burnIn=true`. Assert no soft subtitle stream is muxed and the render succeeds with the configured available font. Add a missing-font fixture that fails before publish.

- [x] **Step 5: Verify audio alignment and ducking with measured samples**

Record:

```text
expectedFinalFrames
expectedSamples = frames * 2000
actual decoded audio sample count/duration
narration-only reference level
BGM base level
BGM voiced-section level
BGM post-pause recovery level
```

Do not claim LUFS mastering. The evidence only proves deterministic ducking/alignment behavior.

- [x] **Step 6: Run actual NVENC capability and fallback scenario**

First verify the local FFmpeg lists and can run `h264_nvenc`. Then run the `ACCELERATED` fixture successfully when hardware is available.

For fallback behavior, inject or simulate a **classified hardware-only failure at the runner boundary** so the test deterministically proves exactly one libx264 retry. Do not destabilize the GPU/driver deliberately.

- [x] **Step 7: Benchmark the two versioned profiles on the same motion-complex fixture**

Run at least 3 measured runs/profile after one warmup. Record:

```text
FFmpeg version
GPU/CPU identifiers
profile version
exact args
elapsed time
output size
SSIM vs same reference
PSNR vs same reference
```

Use the same source/reference/resolution/fps/pixel format for both profiles. State explicitly that CRF/CQ scales are vendor-specific and not equivalent.

`FINAL_QUALITY_V1` remains the production default regardless of speed. `ACCELERATED_V1` is an explicit speed tradeoff. If the proven Phase 4 `p4/CQ28` profile fails to encode reliably on the current FFmpeg/GPU, adjust it once based on actual benchmark evidence, bump the profile version, update tests, and document why.

- [x] **Step 8: Verify 250/500-Shot graph generation without giant inline command**

Build large manifests and assert:

```text
filter graph written to scratch file
argv length remains bounded
no one-CLI-line graph explosion
planner/build completes
```

A full 500-shot real encode is not required unless runtime evidence shows it is practical; the scale gate is planning/build safety plus one representative long-form real render.

- [x] **Step 9: Run one representative real project/export if a valid persisted Phase 7 manifest exists**

Use a temp/copy-safe path or an export that has no existing canonical Final. Do not overwrite a user Final. If no real project has a valid persisted manifest + referenced accepted media, report `REAL PROJECT NOT AVAILABLE` and rely on the deterministic real-FFmpeg fixture; do not fabricate a real-project PASS.

- [x] **Step 10: Run the focused real-engine suite**

```powershell
python -m pytest tests/test_phase08_real_ffmpeg.py -q
python scripts/verify_phase08_render_engine.py
python scripts/run_phase08_encoder_benchmark.py
```

Expected: all mandatory deterministic fixtures PASS and evidence files are written.

- [x] **Step 11: Commit/checkpoint source/tests/scripts only**

```powershell
git add tests/test_phase08_real_ffmpeg.py scripts/verify_phase08_render_engine.py scripts/run_phase08_encoder_benchmark.py studio/render_profiles.py
git commit -m "test(phase8): verify real ffmpeg render engine"
```

Do not commit generated MP4/benchmark media unless the repository explicitly tracks such evidence.

---

### Task 13: Full Regression, Data Integrity, Scope Audit, Roadmap Sync, and Final Report

**Files:**
- Modify: `ROADMAP_STATUS.md`
- Create: `docs/implementation/PHASE_08_IMPLEMENTATION_REPORT.md`
- Evidence: `temp/phase08_verification/tests/`, `temp/phase08_verification/integrity/`
- No Phase 9 product source.

**Interfaces:**
- Consumes: all Phase 8 implementation/evidence.
- Produces: external-review-ready Phase 8 report; stops before Phase 9.

- [x] **Step 1: Run complete focused Phase 8 suite**

```powershell
python -m pytest `
  tests/test_phase08_render_types_profiles.py `
  tests/test_phase08_manifest_integrity.py `
  tests/test_phase08_render_planner.py `
  tests/test_phase08_ffmpeg_graph_builder.py `
  tests/test_phase08_failure_classifier.py `
  tests/test_phase08_process_runner.py `
  tests/test_phase08_publisher.py `
  tests/test_phase08_render_service.py `
  tests/test_phase08_api_ui_contract.py `
  tests/test_phase08_recovery.py `
  tests/test_phase08_real_ffmpeg.py `
  --tb=short -q 2>&1 | Tee-Object -FilePath temp\phase08_verification\tests\focused_pytest.log
```

Expected: 100% PASS.

- [x] **Step 2: Run nearby regressions with highest blast radius**

At minimum run the current equivalents of:

```powershell
python -m pytest tests/test_phase07_render_manifest_schema.py tests/test_phase07_manifest_hashing.py tests/test_phase07_timeline_compiler.py tests/test_phase07_manifest_validation.py tests/test_phase07_render_manifest_api.py tests/test_phase07_manifest_persistence.py -q
python -m pytest tests/test_phase04_closure_gaps.py tests/test_phase04_media_asset_pipeline.py -q
python -m pytest tests/test_phase03d_export_workbench.py -q
python -m pytest tests/test_phase15a_hardening.py -q
```

If a listed filename no longer exists, use the actual current test owner discovered with `Get-ChildItem tests -Filter "*phase07*"`, etc., and record the substitution in the report.

- [x] **Step 3: Run full regression**

```powershell
python -m pytest --tb=short -q 2>&1 | Tee-Object -FilePath temp\phase08_verification\tests\full_pytest.log
```

Do not disable/weaken an existing test to make the suite green.

- [x] **Step 4: Run upstream integrity checks**

```powershell
git -C "D:\Project\UnfoldIQ\upstream\kokoro-fastapi" rev-parse HEAD
git -C "D:\Project\UnfoldIQ\upstream\kokoro-fastapi" describe --tags --exact-match
git -C "D:\Project\UnfoldIQ\upstream\kokoro-fastapi" status --short
git -C "D:\Project\UnfoldIQ\upstream\kokoro-fastapi" diff --stat
```

Compare with the repository's currently approved upstream baseline. Do not reset upstream to force the historical value if the approved baseline was intentionally updated after the earlier reports.

- [x] **Step 5: Prove reference data integrity**

Before destructive/runtime acceptance tests, hash critical reference project files that must not change (script, audio master, timestamps, Scene Plan, Visual Bible, Veo prompts, Asset Registry, Phase 7 manifest snapshots). After tests, re-hash and write:

```text
temp/phase08_verification/integrity/reference_hashes_before.json
temp/phase08_verification/integrity/reference_hashes_after.json
temp/phase08_verification/integrity/result.json
```

Expected: all protected reference hashes identical. New per-export Final/metadata created intentionally by acceptance fixtures must be listed separately, not mistaken for corruption.

- [x] **Step 6: Audit scope leakage**

Run searches such as:

```powershell
rg -n "blackdetect|freezedetect|silencedetect|render_qa_report|Phase 9|Remotion|YouTube upload|smart crop|loudnorm" studio tests
```

Allowed: test/report/spec text or pre-existing unrelated code. Phase 8 implementation must not introduce Phase 9 QA product execution, timeline editor/Remotion, publishing, smart crop, or loudness mastering.

- [x] **Step 7: Update roadmap state conservatively**

Set only:

```text
Phase 8: IMPLEMENTED / REVIEW PENDING
Phase 9: NOT STARTED
```

Do not write `PASS`, `FINAL`, or `VERIFIED` for Phase 8.

- [x] **Step 8: Create the final implementation report**

Create `docs/implementation/PHASE_08_IMPLEMENTATION_REPORT.md` with this structure:

```markdown
# PHASE_08_IMPLEMENTATION_REPORT.md

> Phase: 8
> Date:
> Branch:
> HEAD:
> Approved spec:
> Baseline regression:
> Final regression:
> Verdict:

## 1. Executive Summary
## 2. Approved Design Decisions Implemented
## 3. Git / Baseline / Dirty-Worktree Handling
## 4. Files Created / Modified
## 5. Manifest-Only Input Boundary
## 6. Integrity Verification
## 7. RenderExecutionPlan Architecture
## 8. Visual Normalization
## 9. CUT / CROSSFADE Semantics
## 10. Frame-Accurate Evidence
## 11. Narration / BGM / Ducking
## 12. Audio Alignment Evidence
## 13. Subtitle Soft / Hard Modes
## 14. Encoder Profiles
## 15. Encoder Benchmark Evidence
## 16. Structured Failure Classifier
## 17. NVENC -> CPU Fallback Evidence
## 18. FFmpeg Process / Progress / Cancellation
## 19. Persistent Job Integration
## 20. Resource Scheduling / Permit Release
## 21. Crash Recovery / INTERRUPTED Semantics
## 22. Strict No-Replace Publish
## 23. Per-Export Canonical Final Path
## 24. Render Metadata / Provenance
## 25. API Contract
## 26. Export Workbench Integration
## 27. Real FFmpeg E2E Evidence
## 28. 250 / 500 Shot Scale Evidence
## 29. Focused Tests
## 30. Nearby Regression
## 31. Full Regression
## 32. Data Integrity
## 33. Upstream Integrity
## 34. Scope Audit
## 35. Known Limitations
## 36. Final Gate Matrix
## 37. Final Verdict
```

- [x] **Step 9: Include a strict final gate matrix**

At minimum:

| Gate | Requirement | Result |
|---|---|---|
| A | Approved Phase 8 spec present | PASS/FAIL |
| B | Baseline audited without destructive reset | PASS/FAIL |
| C | Manifest-only input boundary | PASS/FAIL |
| D | Manifest/hash/referenced-byte integrity | PASS/FAIL |
| E | 24/1 fps + 1/24 timebase contract | PASS/FAIL |
| F | `[startFrame,endFrame)` preserved | PASS/FAIL |
| G | Image/video normalization | PASS/FAIL |
| H | FIT_PAD/FILL_CROP | PASS/FAIL |
| I | Source-native trim before 24fps conform | PASS/FAIL |
| J | CUT exact | PASS/FAIL |
| K | CROSSFADE exact manifest frames | PASS/FAIL |
| L | Exact final frame count | PASS/FAIL |
| M | Narration master preserved | PASS/FAIL |
| N | 48k stereo AAC 192k target | PASS/FAIL |
| O | 2000 samples/frame alignment | PASS/FAIL |
| P | Narration-driven sidechain | PASS/FAIL |
| Q | Soft mov_text subtitle | PASS/FAIL |
| R | Hard burn-in/no duplicate soft stream | PASS/FAIL |
| S | FINAL_QUALITY libx264 default | PASS/FAIL |
| T | ACCELERATED NVENC opt-in | PASS/FAIL |
| U | Hardware-only fallback exactly once | PASS/FAIL |
| V | Non-hardware errors no fallback | PASS/FAIL |
| W | FFmpeg `-progress` / `-nostdin` background path | PASS/FAIL |
| X | Existing persistent jobs reused | PASS/FAIL |
| Y | Global Final Render concurrency=1 | PASS/FAIL |
| Z | CPU_BOUND/GPU_ENCODER routing | PASS/FAIL |
| AA | Cancellation safety | PASS/FAIL |
| AB | Crash -> INTERRUPTED/no unsafe resume | PASS/FAIL |
| AC | Strict no-overwrite per export | PASS/FAIL |
| AD | Scratch candidate never corrupts canonical Final | PASS/FAIL |
| AE | `render-metadata.json` provenance | PASS/FAIL |
| AF | Final API requires exportId | PASS/FAIL |
| AG | UI reuses `/api/activity/jobs` polling | PASS/FAIL |
| AH | Draft renderer unchanged | PASS/FAIL |
| AI | Successful render -> NEEDS_REVIEW/PENDING_RENDER_QA, not READY | PASS/FAIL |
| AJ | 250/500 Shot planning/build evidence | PASS/FAIL |
| AK | Real FFmpeg E2E fixture | PASS/FAIL |
| AL | Focused Phase 8 tests 100% | PASS/FAIL |
| AM | Full regression 100% | PASS/FAIL |
| AN | Data integrity | PASS/FAIL |
| AO | No Phase 9 product QA implementation | PASS/FAIL |
| AP | No Agent Integration implementation | PASS/FAIL |

Do not mark PASS without evidence.

- [x] **Step 10: Use the exact final verdict and stop**

If all mandatory implementation gates pass, report exactly:

```text
PHASE 8: IMPLEMENTED / REVIEW PENDING
READY FOR EXTERNAL REVIEW
PHASE 9: NOT STARTED
```

If a mandatory gate is unresolved, use:

```text
PHASE 8: IMPLEMENTATION INCOMPLETE
NOT READY FOR EXTERNAL REVIEW
PHASE 9: NOT STARTED
```

Stop after the Phase 8 report. Do not implement Phase 9 and do not self-promote Phase 8 to PASS/FINAL/VERIFIED.

- [x] **Step 11: Final commit/checkpoint if authorized**

```powershell
git add ROADMAP_STATUS.md docs/implementation/PHASE_08_IMPLEMENTATION_REPORT.md docs/superpowers/specs/2026-09-18-phase08-manifest-driven-ffmpeg-render-engine-design.md docs/superpowers/plans/2026-09-18-phase08-manifest-driven-ffmpeg-render-engine.md
git status --short
```

If commits are authorized and all intended source/test changes are already committed task-by-task:

```powershell
git commit -m "docs(phase8): report manifest render implementation"
```

Otherwise leave the worktree intact and document the no-commit state.

---

## Single-Agent Execution Protocol

This plan deliberately does **not** use `superpowers:subagent-driven-development`.

The executing agent must:

```text
read approved spec + plan
↓
Task 1
↓ self-review + tests
Task 2
↓ self-review + tests
Task 3 through Task 12
↓ self-review + tests at every boundary
Task 13
↓ full regression + final report
STOP
```

Rules:

1. Use `superpowers:executing-plans`.
2. One agent owns the entire Phase 8 context.
3. Do not dispatch implementation/review subtasks to other agents.
4. At every task boundary, read the task's changed diff and focused test output before continuing.
5. If a task exposes a contradiction with the approved spec, stop implementation of that contradictory branch and record the conflict; do not silently redesign Phase 8.
6. If a real repository signature/path differs from this plan, preserve the approved interface/behavior and adapt to the current owner rather than creating a duplicate subsystem. Record the concrete deviation in the final report.
7. Do not ask the user for routine implementation choices already locked by the approved spec.
8. Return only after the complete Phase 8 report is produced, unless a true blocking environment failure makes a mandatory gate impossible.

## External Review Handoff

The user will send `PHASE_08_IMPLEMENTATION_REPORT.md` back for an independent review. The implementation agent must not perform that external-review verdict itself.
