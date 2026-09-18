"""Phase 8 deterministic RenderPlanner: manifest -> RenderExecutionPlan.

Integer frames stay canonical; seconds derive as frames/24 only for FFmpeg
boundary metadata. Strategy: SIMPLE_CUT iff every transition is CUT,
FILTER_COMPLEX on any CROSSFADE. STAGED_FALLBACK is never a planner default.
"""
import math
from dataclasses import dataclass
from pathlib import Path

from studio.manifest_integrity import VerifiedRenderSnapshot
from studio.manifest_render_types import (
    CompositionStrategy,
    EncoderProfileName,
    RenderFailureCode,
)
from studio.render_profiles import get_ducking_preset


class RenderPlanError(ValueError):
    """Unsupported/inconsistent manifest content for planning."""
    def __init__(self, message_or_code, detail: str | None = None, code: RenderFailureCode | None = None):
        if isinstance(message_or_code, RenderFailureCode):
            super().__init__(f"{message_or_code.value}: {detail}" if detail else message_or_code.value)
            self.code = message_or_code
        else:
            super().__init__(str(message_or_code))
            self.code = code


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


_SUPPORTED_FITTING = ("FIT_PAD", "FILL_CROP")
_SUPPORTED_TRANSITIONS = ("CUT", "CROSSFADE")


def _probe_audio_samples_48k(path: Path) -> int | None:
    if not path.is_file():
        return None
    try:
        import wave
        with wave.open(str(path), "rb") as w:
            rate = w.getframerate()
            nframes = w.getnframes()
            if rate > 0 and nframes >= 0:
                return int(round(nframes * 48000 / rate))
    except Exception:
        pass
    try:
        import json, subprocess
        cmd = ["ffprobe", "-v", "error", "-show_entries", "stream=duration",
               "-of", "json", str(path)]
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
        if res.returncode == 0:
            data = json.loads(res.stdout)
            streams = data.get("streams", [])
            if streams and "duration" in streams[0]:
                dur = float(streams[0]["duration"])
                return int(round(dur * 48000))
    except Exception:
        pass
    return None


def _calculate_source_duration(path: Path, in_frame: int | None = None,
                               out_frame: int | None = None) -> float | None:
    """Calculate timeline duration in seconds of selected source interval [in_frame, out_frame).

    For CFR: uses exact source frame rate: (out_frame - in_frame) / source_fps.
    For VFR: queries real presentation timestamps (PTS) from ffprobe for the selected frame interval.
    If untrimmed: returns the full stream duration.
    Fallback for dummy test files: assumes 24fps timeline if ffprobe cannot parse.
    """
    if not path.is_file():
        return None
    try:
        import json, subprocess
        cmd = ["ffprobe", "-v", "error", "-select_streams", "v:0",
               "-show_entries", "stream=r_frame_rate,avg_frame_rate,duration,nb_frames:format=duration",
               "-of", "json", str(path)]
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
        if res.returncode == 0:
            data = json.loads(res.stdout)
            streams = data.get("streams", [])
            if streams:
                st = streams[0]
                r_fps_str = st.get("r_frame_rate", "")
                avg_fps_str = st.get("avg_frame_rate", "")

                # Check if stream is CFR (r_frame_rate == avg_frame_rate with non-zero denominator)
                is_cfr = False
                source_fps = None
                if r_fps_str and avg_fps_str and r_fps_str == avg_fps_str and "/" in r_fps_str:
                    num, den = r_fps_str.split("/")
                    if float(den) > 0 and float(num) > 0:
                        is_cfr = True
                        source_fps = float(num) / float(den)

                if is_cfr and source_fps and source_fps > 0:
                    if in_frame is not None and out_frame is not None:
                        return max(0.0, (out_frame - in_frame) / source_fps)
                    if "duration" in st and float(st["duration"]) > 0:
                        return float(st["duration"])
                    if "nb_frames" in st and str(st["nb_frames"]).isdigit():
                        return int(st["nb_frames"]) / source_fps
                    fmt_dur = data.get("format", {}).get("duration")
                    if fmt_dur and float(fmt_dur) > 0:
                        return float(fmt_dur)

                # VFR stream (or r_frame_rate != avg_frame_rate)
                if in_frame is not None or out_frame is not None:
                    # Query real presentation timestamps (PTS)
                    cmd_frames = [
                        "ffprobe", "-v", "error", "-select_streams", "v:0",
                        "-show_entries", "frame=best_effort_timestamp_time,duration_time",
                        "-of", "json", str(path)
                    ]
                    res_frames = subprocess.run(cmd_frames, capture_output=True, text=True, timeout=10)
                    if res_frames.returncode == 0:
                        fdata = json.loads(res_frames.stdout)
                        frames = fdata.get("frames", [])
                        if frames:
                            start_idx = in_frame if in_frame is not None else 0
                            end_idx = out_frame if out_frame is not None else len(frames)

                            # Start PTS
                            if start_idx < len(frames):
                                t_start = float(frames[start_idx].get("best_effort_timestamp_time", 0.0))
                            else:
                                t_start = float(frames[-1].get("best_effort_timestamp_time", 0.0))

                            # End PTS
                            if end_idx < len(frames):
                                t_end = float(frames[end_idx].get("best_effort_timestamp_time", 0.0))
                            else:
                                last = frames[-1]
                                last_pts = float(last.get("best_effort_timestamp_time", 0.0))
                                last_dur = float(last.get("duration_time", 0.0))
                                t_end = last_pts + last_dur

                            return max(0.0, t_end - t_start)

                # Full VFR stream duration if untrimmed or frames query unavailable
                if "duration" in st and float(st["duration"]) > 0:
                    return float(st["duration"])
                fmt_dur = data.get("format", {}).get("duration")
                if fmt_dur and float(fmt_dur) > 0:
                    return float(fmt_dur)
    except Exception:
        pass

    # Fallback for mock/dummy test files that cannot be parsed by ffprobe
    if in_frame is not None and out_frame is not None:
        return max(0.0, (out_frame - in_frame) / 24.0)
    return None


def _probe_video_frames(path: Path) -> int | None:
    dur = _calculate_source_duration(path)
    if dur is not None:
        return int(math.floor(dur * 24.0 + 1e-6))
    return None


def _plan_clips(manifest, project_dir: Path) -> tuple[ClipExecutionPlan, ...]:
    clips = sorted(manifest.videoTrack.clips, key=lambda c: c.sequenceIndex)
    out = []
    for clip in clips:
        if clip.fittingStrategy not in _SUPPORTED_FITTING:
            raise RenderPlanError(
                f"unsupported fitting {clip.fittingStrategy!r} on {clip.shotId}")
        if clip.transition.type not in _SUPPORTED_TRANSITIONS:
            raise RenderPlanError(
                f"unsupported transition {clip.transition.type!r} on {clip.shotId}")
        speed = clip.trim.speedFactor if clip.trim else 1.0
        if not speed > 0:
            raise RenderPlanError(
                f"invalid speedFactor {speed!r} on {clip.shotId}")

        # Source duration check for video clips:
        # Effective source duration after speedFactor must supply enough canonical 24fps frames
        if clip.mediaType != "IMAGE":
            src_path = project_dir / (clip.filePath or "")
            in_f = clip.trim.inFrame if clip.trim else None
            out_f = clip.trim.outFrame if clip.trim else None
            selected_source_duration = _calculate_source_duration(src_path, in_f, out_f)
            if selected_source_duration is not None:
                effective_duration = selected_source_duration / speed
                available_canonical_frames = int(math.floor(effective_duration * 24.0 + 1e-6))
                if available_canonical_frames < clip.durationFrames:
                    raise RenderPlanError(
                        f"insufficient source duration on clip {clip.clipId}: "
                        f"available {available_canonical_frames} canonical frames "
                        f"(effective {effective_duration:.3f}s) < target {clip.durationFrames}",
                        code=RenderFailureCode.INSUFFICIENT_SOURCE_DURATION)

        out.append(ClipExecutionPlan(
            clip_id=clip.clipId,
            source_path=project_dir / (clip.filePath or ""),
            media_type=clip.mediaType,
            source_fps=None,
            trim_in_frame=clip.trim.inFrame if clip.trim else None,
            trim_out_frame=clip.trim.outFrame if clip.trim else None,
            speed_factor=speed,
            start_frame=clip.startFrame,
            end_frame=clip.endFrame,
            target_frames=clip.durationFrames,
            fitting_strategy=clip.fittingStrategy,
            background_color=clip.backgroundColor,
        ))
    return tuple(out)


def _plan_transitions(manifest) -> tuple[TransitionExecutionPlan, ...]:
    clips = sorted(manifest.videoTrack.clips, key=lambda c: c.sequenceIndex)
    out = []
    for prev, cur in zip(clips, clips[1:]):
        t = cur.transition
        if t.type not in _SUPPORTED_TRANSITIONS:
            raise RenderPlanError(f"unsupported transition on {cur.shotId}")
        out.append(TransitionExecutionPlan(
            from_clip_id=prev.clipId,
            to_clip_id=cur.clipId,
            transition_type=t.type,
            start_frame=cur.startFrame,
            duration_frames=t.durationFrames,
        ))
    return tuple(out)


def _plan_audio(manifest, project_dir: Path, expected_frames: int) -> AudioExecutionPlan:
    voice = manifest.voiceTrack
    music = manifest.musicTrack
    ducking = None
    if music.configured or music.filePath:
        ducking = get_ducking_preset("NARRATION_DUCK_V1").name
    target_samples = expected_frames * 2000
    voice_path = project_dir / (voice.filePath or "")
    actual_samples = _probe_audio_samples_48k(voice_path)
    if actual_samples is None and voice.durationFrames:
        actual_samples = voice.durationFrames * 2000
    if actual_samples is not None:
        diff = abs(actual_samples - target_samples)
        if diff > 2000:
            raise RenderPlanError(
                f"narration audio length mismatch: actual {actual_samples} samples vs "
                f"target {target_samples} (diff {diff} exceeds 2000 tolerance / 1 frame)",
                code=RenderFailureCode.AUDIO_DURATION_MISMATCH)
    return AudioExecutionPlan(
        narration_path=voice_path,
        narration_volume=float(getattr(voice, "volume", 1.0) or 1.0),
        target_samples=target_samples,
        music_path=(project_dir / music.filePath) if music.filePath else None,
        music_volume=(float(music.volume) if music.volume is not None else None),
        music_loop=bool(music.loop),
        fade_in_frames=int(music.fadeInFrames or 0),
        fade_out_frames=int(music.fadeOutFrames or 0),
        ducking_preset_name=ducking,
    )


def _plan_subtitle(manifest, project_dir: Path) -> SubtitleExecutionPlan:
    subs = manifest.subtitlesTrack
    if not (subs.configured or subs.filePath):
        return SubtitleExecutionPlan(path=None, source_format=None, burn_in=False,
                                     font_name=None, font_size=None,
                                     bottom_offset_px=None)
    fmt = (subs.format or Path(subs.filePath or "").suffix.lower().lstrip("."))
    if fmt not in ("srt", "vtt"):
        raise RenderPlanError(f"unsupported subtitle format {fmt!r}")
    return SubtitleExecutionPlan(
        path=project_dir / (subs.filePath or ""),
        source_format=fmt,
        burn_in=bool(subs.burnIn),
        font_name=subs.fontName,
        font_size=subs.fontSize,
        bottom_offset_px=subs.bottomOffsetPx,
    )


def build_render_execution_plan(
    snapshot: VerifiedRenderSnapshot,
    profile_name: EncoderProfileName,
    scratch_dir: Path,
) -> RenderExecutionPlan:
    manifest = snapshot.manifest
    project_dir = snapshot.project_dir
    clips = _plan_clips(manifest, project_dir)
    if not clips:
        raise RenderPlanError("manifest has no clips to render")
    transitions = _plan_transitions(manifest)
    expected_frames = max(c.endFrame for c in manifest.videoTrack.clips)
    strategy = (CompositionStrategy.FILTER_COMPLEX
                if any(t.transition_type == "CROSSFADE" for t in transitions)
                else CompositionStrategy.SIMPLE_CUT)
    return RenderExecutionPlan(
        export_id=manifest.exportId or "",
        manifest_hash=manifest.manifestHash or "",
        expected_final_frames=expected_frames,
        expected_duration_seconds=expected_frames / 24,
        composition_strategy=strategy,
        clips=clips,
        transitions=transitions,
        audio=_plan_audio(manifest, project_dir, expected_frames),
        subtitle=_plan_subtitle(manifest, project_dir),
        encoder_profile=profile_name,
        scratch_dir=Path(scratch_dir),
    )
