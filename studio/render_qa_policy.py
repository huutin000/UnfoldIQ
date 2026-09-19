"""Phase 9 versioned policy RENDER_QA_POLICY_V1.

Deterministic seconds->frame normalization (floor/ceil, 24fps, half-open),
threshold severity helpers, and verdict reduction. No I/O.
"""
from __future__ import annotations

import math
from collections.abc import Sequence

from studio.render_qa_types import (
    BlackPolicy,
    FreezePolicy,
    QaFinding,
    QaSeverity,
    QaVerdict,
    RenderQaPolicy,
    SilencePolicy,
)

RENDER_QA_POLICY_V1 = RenderQaPolicy(
    version="RENDER_QA_POLICY_V1",
    fps=24,
    black=BlackPolicy(detect_min_seconds=0.25, picture_black_ratio=0.98,
                      pixel_threshold=0.10, hard_fail_seconds=2.0),
    freeze=FreezePolicy(noise_threshold=0.001, detect_min_seconds=1.0,
                        video_hard_fail_seconds=3.0),
    silence=SilencePolicy(noise_db=-50.0, detect_min_seconds=2.0,
                          warning_seconds=5.0, hard_fail_seconds=8.0),
)


def seconds_to_frame_range(start_time: float, end_time: float, fps: int = 24) -> tuple[int, int]:
    """Half-open [floor(start*fps), ceil(end*fps))."""
    if end_time < start_time:
        raise ValueError("end_time must be >= start_time")
    return (int(math.floor(float(start_time) * fps)),
            int(math.ceil(float(end_time) * fps)))


def black_severity(duration_seconds: float,
                   policy: RenderQaPolicy = RENDER_QA_POLICY_V1) -> QaSeverity:
    if float(duration_seconds) >= policy.black.hard_fail_seconds:
        return QaSeverity.HARD_FAIL
    return QaSeverity.WARNING


def video_freeze_severity(duration_seconds: float,
                          policy: RenderQaPolicy = RENDER_QA_POLICY_V1) -> QaSeverity:
    if float(duration_seconds) >= policy.freeze.video_hard_fail_seconds:
        return QaSeverity.HARD_FAIL
    return QaSeverity.WARNING


def silence_severity(duration_seconds: float,
                     policy: RenderQaPolicy = RENDER_QA_POLICY_V1) -> QaSeverity:
    d = float(duration_seconds)
    if d >= policy.silence.hard_fail_seconds:
        return QaSeverity.HARD_FAIL
    if d >= policy.silence.warning_seconds:
        return QaSeverity.WARNING
    return QaSeverity.OBSERVED


def reduce_qa_verdict(findings: Sequence[QaFinding]) -> QaVerdict:
    severities = {f.severity for f in findings}
    if QaSeverity.HARD_FAIL in severities:
        return QaVerdict.FAIL
    if QaSeverity.WARNING in severities:
        return QaVerdict.PASS_WITH_WARNINGS
    return QaVerdict.PASS
