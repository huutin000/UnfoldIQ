"""Phase 9 export lineage loader + ffprobe structural inspector.

Read-only against exports/<exportId>/{render-manifest.json,
render-metadata.json, final.mp4}. English identifiers.
"""
from __future__ import annotations

import hashlib
import json
import re
import subprocess
from dataclasses import dataclass, field
from fractions import Fraction
from pathlib import Path
from typing import Any

from studio.render_qa_types import QaDetectorKind, QaFinding, QaSeverity

_EXPORT_RE = re.compile(r"^export_\d{3}$")
_DURATION_TOLERANCE = 1.0 / 24.0


def _validate_ids(project_dir: Path, export_id: str) -> str:
    if not isinstance(export_id, str):
        raise ValueError("invalid exportId")
    clean = export_id.strip()
    if not _EXPORT_RE.match(clean):
        raise ValueError(f"invalid exportId: {export_id!r}")
    if ".." in clean or "/" in clean or "\\" in clean or ":" in clean:
        raise ValueError(f"invalid exportId: {export_id!r}")
    return clean


def _validate_project_dir(project_dir: Path) -> Path:
    p = Path(project_dir)
    if ".." in p.parts:
        raise ValueError("invalid project dir")
    return p


def compute_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _finding(code: str, message: str = "") -> QaFinding:
    return QaFinding(code=code, severity=QaSeverity.HARD_FAIL, message=message)


@dataclass
class QaInputSnapshot:
    project_dir: Path
    export_dir: Path
    export_id: str
    manifest: dict[str, Any] = field(default_factory=dict)
    manifest_hash: str = ""
    expected_final_frames: int = 0
    subtitle_mode: str = "none"
    metadata: dict[str, Any] = field(default_factory=dict)
    final_path: Path | None = None
    final_size_bytes: int = 0
    preflight_findings: list[QaFinding] = field(default_factory=list)


def _expected_frames_and_subtitle(manifest: dict) -> tuple[int, str]:
    clips = ((manifest.get("videoTrack") or {}).get("clips") or [])
    expected = 0
    for clip in clips:
        try:
            expected = max(expected, int(clip.get("endFrame", 0)))
        except (TypeError, ValueError):
            continue
    subs = manifest.get("subtitlesTrack") or {}
    configured = bool(subs.get("configured") or subs.get("filePath"))
    if not configured:
        mode = "none"
    elif bool(subs.get("burnIn")):
        mode = "hard"
    else:
        mode = "soft"
    return expected, mode


def load_qa_input_snapshot(project_dir: Path, export_id: str) -> QaInputSnapshot:
    clean_export = _validate_ids(project_dir, export_id)
    project_dir = Path(project_dir)
    export_dir = project_dir / "exports" / clean_export
    findings: list[QaFinding] = []
    manifest: dict[str, Any] = {}
    metadata: dict[str, Any] = {}
    manifest_path = export_dir / "render-manifest.json"
    metadata_path = export_dir / "render-metadata.json"
    final_path = export_dir / "final.mp4"

    if not manifest_path.is_file():
        findings.append(_finding("QA_INPUT_MISSING", "render-manifest.json is missing"))
    if not metadata_path.is_file():
        findings.append(_finding("QA_INPUT_MISSING", "render-metadata.json is missing"))
    if not final_path.is_file():
        findings.append(_finding("QA_INPUT_MISSING", "final.mp4 is missing"))
        return QaInputSnapshot(project_dir=project_dir, export_dir=export_dir,
                               export_id=clean_export, preflight_findings=findings,
                               final_path=final_path)
    try:
        if final_path.stat().st_size <= 0:
            findings.append(_finding("QA_FINAL_EMPTY", "final.mp4 is empty"))
            return QaInputSnapshot(project_dir=project_dir, export_dir=export_dir,
                                   export_id=clean_export, preflight_findings=findings,
                                   final_path=final_path, final_size_bytes=0)
    except OSError:
        findings.append(_finding("QA_INPUT_MISSING", "final.mp4 unreadable"))
        return QaInputSnapshot(project_dir=project_dir, export_dir=export_dir,
                               export_id=clean_export, preflight_findings=findings,
                               final_path=final_path)

    if manifest_path.is_file():
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            if not isinstance(manifest, dict):
                raise ValueError("manifest must be an object")
        except Exception as e:
            findings.append(_finding("QA_MANIFEST_INVALID", f"manifest unreadable: {e}"))
            manifest = {}
    if metadata_path.is_file():
        try:
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            if not isinstance(metadata, dict):
                raise ValueError("metadata must be an object")
        except Exception as e:
            findings.append(_finding("QA_METADATA_INVALID", f"metadata unreadable: {e}"))
            metadata = {}
    if findings:
        size = 0
        try:
            size = final_path.stat().st_size
        except OSError:
            size = 0
        return QaInputSnapshot(project_dir=project_dir, export_dir=export_dir,
                               export_id=clean_export, manifest=manifest,
                               metadata=metadata, final_path=final_path,
                               final_size_bytes=size, preflight_findings=findings)

    if manifest.get("exportId") != clean_export:
        findings.append(_finding("QA_LINEAGE_MISMATCH", "manifest exportId mismatch"))
    from studio.render_manifest_hashing import compute_manifest_hash
    try:
        actual = compute_manifest_hash(manifest)
    except Exception as e:
        findings.append(_finding("QA_MANIFEST_INVALID", f"hash failed: {e}"))
        actual = ""
    if actual and manifest.get("manifestHash") != actual:
        findings.append(_finding("QA_LINEAGE_MISMATCH", "manifestHash mismatch"))
    if metadata.get("exportId") != clean_export:
        findings.append(_finding("QA_LINEAGE_MISMATCH", "metadata exportId mismatch"))
    if metadata.get("manifestHash") != manifest.get("manifestHash"):
        findings.append(_finding("QA_LINEAGE_MISMATCH", "metadata manifestHash mismatch"))

    expected, subtitle_mode = _expected_frames_and_subtitle(manifest)
    size = final_path.stat().st_size
    return QaInputSnapshot(
        project_dir=project_dir, export_dir=export_dir, export_id=clean_export,
        manifest=manifest, manifest_hash=str(manifest.get("manifestHash") or ""),
        expected_final_frames=expected, subtitle_mode=subtitle_mode,
        metadata=metadata, final_path=final_path, final_size_bytes=size,
        preflight_findings=findings,
    )


@dataclass
class VideoStreamInfo:
    codec_name: str = ""
    width: int = 0
    height: int = 0
    pix_fmt: str = ""
    sample_aspect_ratio: str = ""
    avg_frame_rate: str = ""
    r_frame_rate: str = ""
    read_frames: int = 0
    duration: float | None = None


@dataclass
class AudioStreamInfo:
    codec_name: str = ""
    sample_rate: int = 0
    channels: int = 0
    channel_layout: str = ""
    duration: float | None = None


@dataclass
class SubtitleStreamInfo:
    codec_name: str = ""
    index: int = 0


@dataclass
class ProbeSummary:
    container: str = ""
    video: VideoStreamInfo = field(default_factory=VideoStreamInfo)
    audio: AudioStreamInfo = field(default_factory=AudioStreamInfo)
    subtitle_streams: list[SubtitleStreamInfo] = field(default_factory=list)
    video_stream_count: int = 0
    audio_stream_count: int = 0
    other_stream_count: int = 0
    observed_frame_count: int = 0
    observed_duration: float | None = None
    raw: dict[str, Any] = field(default_factory=dict)


def _to_float(value: Any) -> float | None:
    try:
        if value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _to_int(value: Any) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return 0


def parse_ffprobe_json(payload: dict[str, Any], expected_frames: int = 0) -> ProbeSummary:
    streams = payload.get("streams") or []
    fmt = payload.get("format") or {}
    summary = ProbeSummary(container=str(fmt.get("format_name") or ""),
                           observed_duration=_to_float(fmt.get("duration")),
                           raw=payload)
    videos = [s for s in streams if s.get("codec_type") == "video"]
    audios = [s for s in streams if s.get("codec_type") == "audio"]
    subs = [s for s in streams if s.get("codec_type") == "subtitle"]
    others = [s for s in streams if s.get("codec_type") not in ("video", "audio", "subtitle")]
    summary.video_stream_count = len(videos)
    summary.audio_stream_count = len(audios)
    summary.other_stream_count = len(others)
    if videos:
        v = videos[0]
        summary.video = VideoStreamInfo(
            codec_name=str(v.get("codec_name") or ""),
            width=_to_int(v.get("width")), height=_to_int(v.get("height")),
            pix_fmt=str(v.get("pix_fmt") or ""),
            sample_aspect_ratio=str(v.get("sample_aspect_ratio") or ""),
            avg_frame_rate=str(v.get("avg_frame_rate") or ""),
            r_frame_rate=str(v.get("r_frame_rate") or ""),
            read_frames=_to_int(v.get("nb_read_frames")),
            duration=_to_float(v.get("duration")),
        )
        summary.observed_frame_count = summary.video.read_frames
        if summary.observed_duration is None:
            summary.observed_duration = summary.video.duration
    if audios:
        a = audios[0]
        summary.audio = AudioStreamInfo(
            codec_name=str(a.get("codec_name") or ""),
            sample_rate=_to_int(a.get("sample_rate")),
            channels=_to_int(a.get("channels")),
            channel_layout=str(a.get("channel_layout") or ""),
            duration=_to_float(a.get("duration")),
        )
    for s in subs:
        summary.subtitle_streams.append(SubtitleStreamInfo(
            codec_name=str(s.get("codec_name") or ""), index=_to_int(s.get("index"))))
    return summary


def run_ffprobe(final_path: Path, ffprobe_path: str = "ffprobe",
                timeout: float = 120.0) -> ProbeSummary:
    final_path = Path(final_path)
    try:
        proc = subprocess.run(
            [ffprobe_path, "-v", "error", "-of", "json",
             "-show_format", "-show_streams", "-count_frames", str(final_path)],
            capture_output=True, text=True, timeout=timeout)
    except Exception as e:
        raise RuntimeError(f"QA_PROBE_FAILED: {e}") from e
    if proc.returncode != 0:
        raise RuntimeError(f"QA_PROBE_FAILED: {(proc.stderr or '')[:500]}")
    try:
        payload = json.loads(proc.stdout or "{}")
    except Exception as e:
        raise RuntimeError(f"QA_PROBE_FAILED: bad JSON: {e}") from e
    return parse_ffprobe_json(payload)


def _rate_ok(value: str) -> bool:
    try:
        return Fraction(value) == Fraction(24, 1)
    except Exception:
        return False


def validate_probe_contract(snapshot: QaInputSnapshot, probe: ProbeSummary) -> list[QaFinding]:
    findings: list[QaFinding] = []
    if probe.video_stream_count != 1:
        findings.append(_finding("QA_VIDEO_STREAM_MISSING" if probe.video_stream_count == 0
                                 else "QA_UNEXPECTED_STREAM_LAYOUT",
                                 f"video streams: {probe.video_stream_count}"))
    if probe.audio_stream_count != 1:
        findings.append(_finding("QA_AUDIO_STREAM_MISSING" if probe.audio_stream_count == 0
                                 else "QA_UNEXPECTED_STREAM_LAYOUT",
                                 f"audio streams: {probe.audio_stream_count}"))
    if probe.other_stream_count:
        findings.append(_finding("QA_UNEXPECTED_STREAM_LAYOUT",
                                 f"unexpected streams: {probe.other_stream_count}"))
    mode = (snapshot.subtitle_mode or "none").lower()
    n_sub = len(probe.subtitle_streams)
    if mode in ("none", "hard"):
        if n_sub != 0:
            findings.append(_finding("QA_SUBTITLE_CONTRACT_MISMATCH",
                                     f"mode {mode} must have 0 subtitle streams, got {n_sub}"))
    elif mode == "soft":
        if n_sub != 1 or (probe.subtitle_streams
                          and probe.subtitle_streams[0].codec_name != "mov_text"):
            got = probe.subtitle_streams[0].codec_name if probe.subtitle_streams else "none"
            findings.append(_finding("QA_SUBTITLE_CONTRACT_MISMATCH",
                                     f"soft mode needs one mov_text stream, got {n_sub}x {got}"))
    if probe.video_stream_count == 1:
        v = probe.video
        if v.codec_name.lower() not in ("h264", "avc"):
            findings.append(_finding("QA_VIDEO_CODEC_MISMATCH", f"codec {v.codec_name}"))
        if v.width != 1920 or v.height != 1080:
            findings.append(_finding("QA_VIDEO_RESOLUTION_MISMATCH",
                                     f"{v.width}x{v.height}"))
        if v.pix_fmt != "yuv420p":
            findings.append(_finding("QA_VIDEO_PIXEL_FORMAT_MISMATCH", v.pix_fmt))
        if v.sample_aspect_ratio not in ("1:1", "1/1"):
            findings.append(_finding("QA_VIDEO_SAR_MISMATCH", v.sample_aspect_ratio))
        if not _rate_ok(v.avg_frame_rate) or not _rate_ok(v.r_frame_rate):
            findings.append(_finding("QA_VIDEO_FPS_MISMATCH",
                                     f"{v.avg_frame_rate}/{v.r_frame_rate}"))
        if v.read_frames != snapshot.expected_final_frames:
            findings.append(_finding("QA_FRAME_COUNT_MISMATCH",
                                     f"expected {snapshot.expected_final_frames}, got {v.read_frames}"))
        expected_dur = snapshot.expected_final_frames / 24.0 if snapshot.expected_final_frames else None
        for label, observed in (("video", v.duration),
                                ("container", probe.observed_duration)):
            if expected_dur is not None and observed is not None:
                if abs(observed - expected_dur) > _DURATION_TOLERANCE + 1e-9:
                    findings.append(_finding("QA_VIDEO_DURATION_MISMATCH",
                                             f"{label} duration {observed} vs {expected_dur}"))
                    break
    if probe.audio_stream_count == 1:
        a = probe.audio
        if a.codec_name.lower() != "aac":
            findings.append(_finding("QA_AUDIO_CODEC_MISMATCH", a.codec_name))
        if a.sample_rate != 48000:
            findings.append(_finding("QA_AUDIO_RATE_MISMATCH", str(a.sample_rate)))
        if a.channels != 2:
            findings.append(_finding("QA_AUDIO_CHANNELS_MISMATCH", str(a.channels)))
        expected_dur = snapshot.expected_final_frames / 24.0 if snapshot.expected_final_frames else None
        if expected_dur is not None and a.duration is not None:
            if abs(a.duration - expected_dur) > _DURATION_TOLERANCE + 1e-9:
                findings.append(_finding("QA_AUDIO_DURATION_MISMATCH",
                                         f"audio duration {a.duration} vs {expected_dur}"))
    return findings
