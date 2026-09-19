"""Phase 9 one-pass full-decode detector runner.

One FFmpeg process decodes the entire Final; video feeds blackdetect +
freezedetect, audio feeds silencedetect. Decoded output goes to null sink.
Cancellation reuses Phase 8 graceful-then-force conventions.
"""
from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from studio.ffmpeg_process_runner import run_process_with_cancel
from studio.render_qa_policy import RENDER_QA_POLICY_V1
from studio.render_qa_types import QaDetectorKind, RawQaEvent

CANCEL_GRACE_SECONDS = 5.0

_BLACK_RE = re.compile(
    r"black_start:(?P<s>[\d.]+)\s+black_end:(?P<e>[\d.]+)\s+black_duration:(?P<d>[\d.]+)")
_SIL_START_RE = re.compile(r"silence_start:\s*(?P<s>[\d.\-]+)")
_SIL_END_RE = re.compile(r"silence_end:\s*(?P<e>[\d.\-]+)\s*\|\s*silence_duration:\s*(?P<d>[\d.\-]+)")
_FREEZE_START_RE = re.compile(r"freeze_start:\s*(?P<s>[\d.\-]+)")
_FREEZE_DUR_RE = re.compile(r"freeze_duration:\s*(?P<d>[\d.\-]+)")
_FREEZE_END_RE = re.compile(r"freeze_end:\s*(?P<e>[\d.\-]+)")

# Fatal decode indicators. FFmpeg often exits 0 while concealing corrupt
# macroblocks, so mid-stream corruption must be caught by log evidence —
# this is precisely what proves full decode beyond structural probing.
_FATAL_DECODE_RES = [
    re.compile(r"error while decoding", re.IGNORECASE),
    re.compile(r"corrupt decoded frame", re.IGNORECASE),
    re.compile(r"cabac decode .* failed", re.IGNORECASE),
    re.compile(r"concealing .* errors", re.IGNORECASE),
    re.compile(r"invalid data found", re.IGNORECASE),
    re.compile(r"decode_slice_header error", re.IGNORECASE),
    re.compile(r"truncat", re.IGNORECASE),
    re.compile(r"moov atom not found", re.IGNORECASE),
    re.compile(r"error reading packet", re.IGNORECASE),
]


def count_fatal_decode_errors(stderr_text: str) -> int:
    """Count log lines proving corrupt/undecodable stream content."""
    count = 0
    for line in (stderr_text or "").splitlines():
        lowered = line.lower()
        # Progress/status lines never count.
        if lowered.startswith(("frame=", "video:", "audio:", "subtitle:")):
            continue
        if any(rx.search(line) for rx in _FATAL_DECODE_RES):
            count += 1
    return count


def build_render_qa_ffmpeg_args(final_path: Path, ffmpeg_path: str = "ffmpeg") -> list[str]:
    policy = RENDER_QA_POLICY_V1
    vf = (f"blackdetect=d={policy.black.detect_min_seconds:g}"
          f":pic_th={policy.black.picture_black_ratio:g}"
          f":pix_th={policy.black.pixel_threshold:.2f},"
          f"freezedetect=n={policy.freeze.noise_threshold:g}"
          f":d={policy.freeze.detect_min_seconds:g}")
    af = (f"silencedetect=n={policy.silence.noise_db:g}dB"
          f":d={policy.silence.detect_min_seconds}")
    return [ffmpeg_path, "-hide_banner", "-nostdin",
            "-progress", "pipe:1", "-stats_period", "0.5",
            "-i", str(final_path),
            "-vf", vf, "-af", af,
            "-f", "null", "-"]


def parse_detector_stderr(stderr_text: str, total_frames: int | None = None,
                          fps: int = 24) -> list[RawQaEvent]:
    """Normalize FFmpeg detector logs to raw QA events.

    When freezedetect emits `freeze_start` with no duration/end before EOF
    (freeze held through end of file), the event is bounded to `total_frames`
    instead of being discarded — but only when `total_frames` is known.
    """
    events: list[RawQaEvent] = []
    policy = RENDER_QA_POLICY_V1
    for m in _BLACK_RE.finditer(stderr_text or ""):
        s, e, d = float(m.group("s")), float(m.group("e")), float(m.group("d"))
        events.append(RawQaEvent(
            detector=QaDetectorKind.BLACK, start_time=s, end_time=e, duration=d,
            raw_thresholds={"d": policy.black.detect_min_seconds,
                            "pic_th": policy.black.picture_black_ratio,
                            "pix_th": policy.black.pixel_threshold},
            raw_evidence={"line": m.group(0)}))
    pending_silence: float | None = None
    for line in (stderr_text or "").splitlines():
        ms = _SIL_START_RE.search(line)
        if ms:
            try:
                pending_silence = float(ms.group("s"))
            except ValueError:
                pending_silence = None
            continue
        me = _SIL_END_RE.search(line)
        if me and pending_silence is not None:
            try:
                e, d = float(me.group("e")), float(me.group("d"))
            except ValueError:
                pending_silence = None
                continue
            events.append(RawQaEvent(
                detector=QaDetectorKind.SILENCE, start_time=pending_silence,
                end_time=e, duration=d,
                raw_thresholds={"n": f"{policy.silence.noise_db:g}dB",
                                "d": policy.silence.detect_min_seconds},
                raw_evidence={"line": line.strip()}))
            pending_silence = None
    pending_freeze: float | None = None
    pending_freeze_dur: float | None = None
    for line in (stderr_text or "").splitlines():
        ms = _FREEZE_START_RE.search(line)
        if ms:
            try:
                pending_freeze = float(ms.group("s"))
            except ValueError:
                pending_freeze = None
            continue
        md = _FREEZE_DUR_RE.search(line)
        if md and pending_freeze is not None:
            try:
                pending_freeze_dur = float(md.group("d"))
            except ValueError:
                pending_freeze_dur = None
            continue
        me = _FREEZE_END_RE.search(line)
        if me and pending_freeze is not None and pending_freeze_dur is not None:
            try:
                e = float(me.group("e"))
            except ValueError:
                pending_freeze, pending_freeze_dur = None, None
                continue
            events.append(RawQaEvent(
                detector=QaDetectorKind.FREEZE, start_time=pending_freeze,
                end_time=e, duration=pending_freeze_dur,
                raw_thresholds={"n": policy.freeze.noise_threshold,
                                "d": policy.freeze.detect_min_seconds},
                raw_evidence={"line": line.strip()}))
            pending_freeze, pending_freeze_dur = None, None
    if pending_freeze is not None and total_frames:
        eof_time = float(total_frames) / float(fps or 24)
        if eof_time > pending_freeze:
            events.append(RawQaEvent(
                detector=QaDetectorKind.FREEZE, start_time=pending_freeze,
                end_time=eof_time, duration=eof_time - pending_freeze,
                raw_thresholds={"n": policy.freeze.noise_threshold,
                                "d": policy.freeze.detect_min_seconds},
                raw_evidence={"eof_truncated": True,
                              "total_frames": total_frames}))
    events.sort(key=lambda ev: (ev.start_time, ev.end_time))
    return events


def decode_progress_fraction(out_time_seconds: float, expected_duration_seconds: float) -> float:
    if not expected_duration_seconds or expected_duration_seconds <= 0:
        return 0.12
    ratio = max(0.0, min(1.0, float(out_time_seconds) / float(expected_duration_seconds)))
    return 0.12 + 0.76 * ratio


def _out_seconds(event: dict[str, Any]) -> float:
    if "out_time_us" in event:
        try:
            return float(event["out_time_us"]) / 1_000_000.0
        except (TypeError, ValueError):
            pass
    for key in ("out_time", "out_time_ms"):
        if key in event:
            try:
                if key == "out_time_ms":
                    return float(event[key]) / 1000.0
                text = str(event[key]).strip()
                if ":" in text:
                    parts = text.split(":")
                    return float(parts[0]) * 3600 + float(parts[1]) * 60 + float(parts[2])
                return float(text)
            except (TypeError, ValueError):
                continue
    return 0.0


@dataclass
class FullDecodeResult:
    completed: bool
    cancelled: bool
    return_code: int | None
    stderr_tail: str
    max_frame_seen: int = 0


@dataclass
class DetectorRunResult:
    completed: bool
    cancelled: bool
    return_code: int | None
    events: list[RawQaEvent] = field(default_factory=list)
    decode_error_count: int = 0
    stderr_tail: str = ""


async def run_full_decode_detectors(
    final_path: Path,
    expected_duration_seconds: float,
    expected_frames: int,
    log_path: Path,
    cancel_event: asyncio.Event,
    progress_cb: Callable[[float], Any] | None = None,
    ffmpeg_path: str = "ffmpeg",
) -> DetectorRunResult:
    argv = build_render_qa_ffmpeg_args(final_path, ffmpeg_path=ffmpeg_path)

    def _on_progress(event: dict[str, Any]):
        frac = decode_progress_fraction(_out_seconds(event), expected_duration_seconds)
        if progress_cb is not None:
            res = progress_cb(frac)
            if asyncio.iscoroutine(res):
                return res
        return None

    async def _cb(event: dict[str, Any]):
        r = _on_progress(event)
        if asyncio.iscoroutine(r):
            await r

    run = await run_process_with_cancel(
        argv, Path(log_path), cancel_event, CANCEL_GRACE_SECONDS, _cb,
        expected_frames, cwd=None)
    try:
        full_text = Path(log_path).read_text(encoding="utf-8", errors="replace")
    except OSError:
        full_text = run.stderr_tail
    events = parse_detector_stderr(full_text, total_frames=expected_frames)
    err_count = count_fatal_decode_errors(full_text)
    completed = run.completed and err_count == 0
    return DetectorRunResult(completed=completed, cancelled=run.cancelled,
                             return_code=run.return_code, events=events,
                             decode_error_count=err_count,
                             stderr_tail=run.stderr_tail)
