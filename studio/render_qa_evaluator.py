"""Phase 9 manifest-aware event evaluator.

Raw detector seconds are normalized to canonical 24fps half-open frames,
then intersected with Shot ranges. Severity decisions use frame-derived
durations. English identifiers.
"""
from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field

from studio.render_qa_policy import (
    black_severity,
    seconds_to_frame_range,
    silence_severity,
    video_freeze_severity,
)
from studio.render_qa_types import (
    QaContextSlice,
    QaDetectorKind,
    QaFinding,
    QaSeverity,
    RawQaEvent,
    RenderQaPolicy,
)


@dataclass
class ManifestQaContext:
    slices: list[QaContextSlice] = field(default_factory=list)
    total_frames: int = 0
    transition_ranges: list[tuple[int, int]] = field(default_factory=list)


def build_manifest_qa_context(manifest: dict) -> ManifestQaContext:
    clips = ((manifest or {}).get("videoTrack") or {}).get("clips") or []
    slices: list[QaContextSlice] = []
    transitions: list[tuple[int, int]] = []
    total = 0
    for clip in clips:
        try:
            start = int(clip.get("startFrame", 0))
            end = int(clip.get("endFrame", start))
        except (TypeError, ValueError):
            continue
        if end <= start:
            continue
        trans = ((clip.get("transition") or {}).get("type") or "CUT").upper()
        try:
            dur = int((clip.get("transition") or {}).get("durationFrames", 0))
        except (TypeError, ValueError):
            dur = 0
        slices.append(QaContextSlice(
            shot_id=str(clip.get("shotId") or clip.get("clipId") or ""),
            scene_id=str(clip.get("sceneId") or ""),
            media_type=str(clip.get("mediaType") or "VIDEO").upper(),
            start_frame=start, end_frame=end, transition=trans))
        if trans == "CROSSFADE" and dur > 0:
            transitions.append((start, min(end, start + dur)))
        total = max(total, end)
    slices.sort(key=lambda s: s.start_frame)
    return ManifestQaContext(slices=slices, total_frames=total,
                             transition_ranges=transitions)


def _intersect(a_start: int, a_end: int, b_start: int, b_end: int) -> tuple[int, int] | None:
    s, e = max(a_start, b_start), min(a_end, b_end)
    return (s, e) if e > s else None


def _black_context(seg_start: int, seg_end: int, sl: QaContextSlice,
                   transitions: list[tuple[int, int]]) -> str:
    for ts, te in transitions:
        if seg_start < te and seg_end > ts:
            return "BLACK_NEAR_TRANSITION"
    if seg_start - sl.start_frame <= 6 or sl.end_frame - seg_end <= 6:
        return "BLACK_NEAR_SHOT_BOUNDARY"
    return "BLACK_INSIDE_SHOT"


def evaluate_events(events: Sequence[RawQaEvent], context: ManifestQaContext,
                    policy: RenderQaPolicy) -> list[QaFinding]:
    findings: list[QaFinding] = []
    for ev in events:
        start_f, end_f = seconds_to_frame_range(ev.start_time, ev.end_time, policy.fps)
        if end_f <= start_f:
            continue
        if ev.detector is QaDetectorKind.SILENCE:
            sev = silence_severity(ev.duration, policy)
            findings.append(QaFinding(
                code="QA_AUDIO_SILENCE_EXCESSIVE", severity=sev, detector=ev.detector,
                message=f"silence {ev.duration:.2f}s",
                start_time=ev.start_time, end_time=ev.end_time,
                start_frame=start_f, end_frame_exclusive=end_f,
                expected=f">={policy.silence.hard_fail_seconds:g}s hard fail",
                observed=f"{ev.duration:.2f}s"))
            continue
        matched = False
        for sl in context.slices:
            seg = _intersect(start_f, end_f, sl.start_frame, sl.end_frame)
            if seg is None:
                continue
            matched = True
            seg_start, seg_end = seg
            seg_dur = (seg_end - seg_start) / float(policy.fps)
            seg_s = seg_start / float(policy.fps)
            seg_e = seg_end / float(policy.fps)
            if ev.detector is QaDetectorKind.BLACK:
                sev = black_severity(seg_dur, policy)
                findings.append(QaFinding(
                    code="QA_BLACK_EXCESSIVE", severity=sev, detector=ev.detector,
                    message=f"black {seg_dur:.2f}s",
                    start_time=seg_s, end_time=seg_e,
                    start_frame=seg_start, end_frame_exclusive=seg_end,
                    shot_id=sl.shot_id,
                    context=_black_context(seg_start, seg_end, sl, context.transition_ranges),
                    expected=f">={policy.black.hard_fail_seconds:g}s hard fail",
                    observed=f"{seg_dur:.2f}s"))
            elif ev.detector is QaDetectorKind.FREEZE:
                if sl.media_type == "IMAGE":
                    findings.append(QaFinding(
                        code="QA_VIDEO_FREEZE_EXCESSIVE", severity=QaSeverity.EXPECTED,
                        detector=ev.detector,
                        message=f"static IMAGE {seg_dur:.2f}s expected",
                        start_time=seg_s, end_time=seg_e,
                        start_frame=seg_start, end_frame_exclusive=seg_end,
                        shot_id=sl.shot_id, context="FREEZE_INSIDE_IMAGE",
                        expected="static image", observed=f"{seg_dur:.2f}s"))
                else:
                    sev = video_freeze_severity(seg_dur, policy)
                    findings.append(QaFinding(
                        code="QA_VIDEO_FREEZE_EXCESSIVE", severity=sev,
                        detector=ev.detector,
                        message=f"freeze {seg_dur:.2f}s",
                        start_time=seg_s, end_time=seg_e,
                        start_frame=seg_start, end_frame_exclusive=seg_end,
                        shot_id=sl.shot_id, context="FREEZE_INSIDE_VIDEO",
                        expected=f">={policy.freeze.video_hard_fail_seconds:g}s hard fail",
                        observed=f"{seg_dur:.2f}s"))
        if not matched:
            if ev.detector is QaDetectorKind.BLACK:
                sev = black_severity(ev.duration, policy)
                findings.append(QaFinding(
                    code="QA_BLACK_EXCESSIVE", severity=sev, detector=ev.detector,
                    message=f"black {ev.duration:.2f}s outside manifest",
                    start_time=ev.start_time, end_time=ev.end_time,
                    start_frame=start_f, end_frame_exclusive=end_f,
                    context="BLACK_OUTSIDE_MANIFEST",
                    expected=f">={policy.black.hard_fail_seconds:g}s hard fail",
                    observed=f"{ev.duration:.2f}s"))
            elif ev.detector is QaDetectorKind.FREEZE:
                sev = video_freeze_severity(ev.duration, policy)
                findings.append(QaFinding(
                    code="QA_VIDEO_FREEZE_EXCESSIVE", severity=sev, detector=ev.detector,
                    message=f"freeze {ev.duration:.2f}s outside manifest",
                    start_time=ev.start_time, end_time=ev.end_time,
                    start_frame=start_f, end_frame_exclusive=end_f,
                    context="FREEZE_OUTSIDE_MANIFEST",
                    expected=f">={policy.freeze.video_hard_fail_seconds:g}s hard fail",
                    observed=f"{ev.duration:.2f}s"))
    return findings
