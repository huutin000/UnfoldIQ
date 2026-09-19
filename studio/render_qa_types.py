"""Phase 9 domain types — enums/dataclasses only.

No subprocess, storage, or UI logic. English identifiers.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class QaVerdict(str, Enum):
    PASS = "PASS"
    PASS_WITH_WARNINGS = "PASS_WITH_WARNINGS"
    FAIL = "FAIL"


class QaSeverity(str, Enum):
    EXPECTED = "EXPECTED"
    OBSERVED = "OBSERVED"
    WARNING = "WARNING"
    HARD_FAIL = "HARD_FAIL"


class QaDetectorKind(str, Enum):
    BLACK = "BLACK"
    FREEZE = "FREEZE"
    SILENCE = "SILENCE"


class RenderQaExecutionPhase(str, Enum):
    PREPARING = "PREPARING"
    WAITING_RESOURCE = "WAITING_RESOURCE"
    HASHING_FINAL = "HASHING_FINAL"
    PROBING = "PROBING"
    FULL_DECODING = "FULL_DECODING"
    DETECTING = "DETECTING"
    EVALUATING = "EVALUATING"
    WRITING_REPORT = "WRITING_REPORT"
    REPORT_COMMITTED = "REPORT_COMMITTED"
    APPLYING_VERDICT = "APPLYING_VERDICT"


class QaFailureCode(str, Enum):
    QA_INPUT_MISSING = "QA_INPUT_MISSING"
    QA_FINAL_EMPTY = "QA_FINAL_EMPTY"
    QA_MANIFEST_INVALID = "QA_MANIFEST_INVALID"
    QA_METADATA_INVALID = "QA_METADATA_INVALID"
    QA_LINEAGE_MISMATCH = "QA_LINEAGE_MISMATCH"
    QA_PROBE_FAILED = "QA_PROBE_FAILED"
    QA_CONTAINER_UNREADABLE = "QA_CONTAINER_UNREADABLE"
    QA_VIDEO_STREAM_MISSING = "QA_VIDEO_STREAM_MISSING"
    QA_AUDIO_STREAM_MISSING = "QA_AUDIO_STREAM_MISSING"
    QA_UNEXPECTED_STREAM_LAYOUT = "QA_UNEXPECTED_STREAM_LAYOUT"
    QA_SUBTITLE_CONTRACT_MISMATCH = "QA_SUBTITLE_CONTRACT_MISMATCH"
    QA_VIDEO_CODEC_MISMATCH = "QA_VIDEO_CODEC_MISMATCH"
    QA_VIDEO_RESOLUTION_MISMATCH = "QA_VIDEO_RESOLUTION_MISMATCH"
    QA_VIDEO_PIXEL_FORMAT_MISMATCH = "QA_VIDEO_PIXEL_FORMAT_MISMATCH"
    QA_VIDEO_SAR_MISMATCH = "QA_VIDEO_SAR_MISMATCH"
    QA_VIDEO_FPS_MISMATCH = "QA_VIDEO_FPS_MISMATCH"
    QA_FRAME_COUNT_MISMATCH = "QA_FRAME_COUNT_MISMATCH"
    QA_VIDEO_DURATION_MISMATCH = "QA_VIDEO_DURATION_MISMATCH"
    QA_AUDIO_CODEC_MISMATCH = "QA_AUDIO_CODEC_MISMATCH"
    QA_AUDIO_RATE_MISMATCH = "QA_AUDIO_RATE_MISMATCH"
    QA_AUDIO_CHANNELS_MISMATCH = "QA_AUDIO_CHANNELS_MISMATCH"
    QA_AUDIO_DURATION_MISMATCH = "QA_AUDIO_DURATION_MISMATCH"
    QA_FULL_DECODE_FAILED = "QA_FULL_DECODE_FAILED"
    QA_BLACK_EXCESSIVE = "QA_BLACK_EXCESSIVE"
    QA_VIDEO_FREEZE_EXCESSIVE = "QA_VIDEO_FREEZE_EXCESSIVE"
    QA_AUDIO_SILENCE_EXCESSIVE = "QA_AUDIO_SILENCE_EXCESSIVE"
    QA_FINAL_CHANGED_DURING_RUN = "QA_FINAL_CHANGED_DURING_RUN"


class QaTrigger(str, Enum):
    AUTOMATIC = "AUTOMATIC"
    MANUAL_RERUN = "MANUAL_RERUN"


@dataclass(frozen=True)
class QaIdentity:
    project_id: str
    export_id: str
    manifest_hash: str
    final_sha256: str
    qa_policy_version: str


@dataclass(frozen=True)
class RawQaEvent:
    detector: QaDetectorKind
    start_time: float
    end_time: float
    duration: float
    raw_thresholds: dict[str, Any] = field(default_factory=dict)
    raw_evidence: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class QaContextSlice:
    shot_id: str
    scene_id: str
    media_type: str
    start_frame: int
    end_frame: int
    transition: str = "CUT"


@dataclass(frozen=True)
class QaFinding:
    code: str
    severity: QaSeverity
    detector: QaDetectorKind | None = None
    message: str = ""
    start_time: float | None = None
    end_time: float | None = None
    start_frame: int | None = None
    end_frame_exclusive: int | None = None
    shot_id: str | None = None
    context: str | None = None
    expected: str | None = None
    observed: str | None = None


@dataclass(frozen=True)
class BlackPolicy:
    detect_min_seconds: float = 0.25
    picture_black_ratio: float = 0.98
    pixel_threshold: float = 0.10
    hard_fail_seconds: float = 2.0


@dataclass(frozen=True)
class FreezePolicy:
    noise_threshold: float = 0.001
    detect_min_seconds: float = 1.0
    video_hard_fail_seconds: float = 3.0


@dataclass(frozen=True)
class SilencePolicy:
    noise_db: float = -50.0
    detect_min_seconds: float = 2.0
    warning_seconds: float = 5.0
    hard_fail_seconds: float = 8.0


@dataclass(frozen=True)
class RenderQaPolicy:
    version: str
    fps: int = 24
    black: BlackPolicy = field(default_factory=BlackPolicy)
    freeze: FreezePolicy = field(default_factory=FreezePolicy)
    silence: SilencePolicy = field(default_factory=SilencePolicy)
