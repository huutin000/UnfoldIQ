"""Phase 8 FFmpeg graph builder: manifest plan -> argv + filter script.

Visual normalization per clip, CUT concat filter, CROSSFADE xfade chains,
narration canonicalization, explicit stream maps, pinned output invariants.
No shell strings: argv lists only. No -shortest, no -y on canonical paths.
"""
from dataclasses import dataclass
from pathlib import Path

from studio.manifest_render_types import RenderFailureCode
from studio.render_planner import (
    AudioExecutionPlan,
    RenderExecutionPlan,
    RenderPlanError,
    SubtitleExecutionPlan,
)
from studio.render_profiles import get_ducking_preset, get_encoder_profile


class GraphBuildError(RenderPlanError):
    """Typed build failure carrying a RenderFailureCode for the service."""

    def __init__(self, code: RenderFailureCode, message: str):
        super().__init__(f"{code.value}: {message}")
        self.code = code


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
    cwd: Path | None = None


def _fmt_sec(frames: int) -> str:
    value = frames / 24
    return str(int(value)) if float(value).is_integer() else repr(value)


def _hex_color(value: str) -> str:
    v = (value or "#0b0f19").strip()
    if v.startswith("#") and len(v) == 7:
        return "0x" + v[1:]
    return v


def _fit_filters(strategy: str, background: str) -> str:
    if strategy == "FILL_CROP":
        return ("scale=1920:1080:force_original_aspect_ratio=increase,"
                "crop=1920:1080")
    return ("scale=1920:1080:force_original_aspect_ratio=decrease,"
            f"pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color={_hex_color(background)}")


def _visual_chain(idx: int, clip, profile) -> tuple[FFmpegInput, str]:
    """Return (input, filterchain producing [v{idx}])."""
    src = clip.source_path
    if clip.media_type == "IMAGE":
        filt = (f"[{idx}:v]"
                f"{_fit_filters(clip.fitting_strategy, clip.background_color)},"
                f"setsar=1,format=yuv420p,settb=expr=1/24,"
                f"trim=end_frame={clip.target_frames},setpts=PTS-STARTPTS[v{idx}]")
        return FFmpegInput(path=src, options=("-loop", "1", "-framerate", "24")), filt
    parts = []
    if clip.trim_in_frame is not None and clip.trim_out_frame is not None:
        parts.append(f"trim=start_frame={clip.trim_in_frame}:end_frame={clip.trim_out_frame}")
    parts.append(f"setpts=(PTS-STARTPTS)/{clip.speed_factor}")
    parts.append("fps=24")
    parts.append(_fit_filters(clip.fitting_strategy, clip.background_color))
    parts.append("setsar=1")
    parts.append("format=yuv420p")
    parts.append("settb=expr=1/24")
    parts.append(f"trim=end_frame={clip.target_frames}")
    parts.append("setpts=PTS-STARTPTS")
    filt = f"[{idx}:v]" + ",".join(parts) + f"[v{idx}]"
    return FFmpegInput(path=src, options=()), filt


def _compose_visual(chains: list[str], clip_ids: list[str], transitions: list,
                    expected_frames: int) -> tuple[list[str], str]:
    """Return (filter lines, final_video_label)."""
    lines = list(chains)
    trans = [t for t in transitions if t.transition_type == "CROSSFADE"]
    if not trans:
        if len(chains) == 1:
            label = "v0"
        else:
            joined = "".join(f"[v{i}]" for i in range(len(chains)))
            lines.append(f"{joined}concat=n={len(chains)}:v=1:a=0[vcat]")
            label = "vcat"
        lines.append(f"[{label}]trim=end_frame={expected_frames},setpts=PTS-STARTPTS[vout]")
        return lines, "vout"
    # CROSSFADE chain over normalized streams.
    prev_label = "v0"
    for k, t in enumerate(trans):
        try:
            cur_label = f"v{clip_ids.index(t.to_clip_id)}"
        except ValueError:
            cur_label = f"v{k + 1}"
        out_label = f"x{k}"
        lines.append(
            f"[{prev_label}][{cur_label}]xfade=transition=fade:"
            f"duration={_fmt_sec(t.duration_frames)}:"
            f"offset={_fmt_sec(t.start_frame)}[{out_label}]")
        prev_label = out_label
    lines.append(f"[{prev_label}]trim=end_frame={expected_frames},setpts=PTS-STARTPTS[vout]")
    return lines, "vout"


def _duck_params() -> str:
    p = get_ducking_preset("NARRATION_DUCK_V1")
    return (f"threshold={p.threshold}:ratio={p.ratio}:attack={p.attack_ms}:"
            f"release={p.release_ms}:knee={p.knee}:makeup=1:mode={p.mode}")


def _fade_chain(prefix: str, fade_in_frames: int, fade_out_frames: int,
                target_samples: int) -> str:
    parts = [prefix]
    if fade_in_frames > 0:
        parts.append(f"afade=t=in:st=0:d={_fmt_sec(fade_in_frames)}")
    if fade_out_frames > 0:
        start_sample = max(0, target_samples - fade_out_frames * 2000)
        parts.append(f"afade=t=out:st={start_sample / 48000}:d={_fmt_sec(fade_out_frames)}")
    return ",".join(parts)


def _build_audio(audio: AudioExecutionPlan, nar_idx: int,
                 inputs: list) -> tuple[list[str], int | None, str]:
    """Return (filter lines, music input index or None, final audio label)."""
    lines = []
    if audio.music_path is None:
        lines.append(
            f"[{nar_idx}:a]volume={audio.narration_volume},aresample=48000,"
            f"aformat=channel_layouts=stereo,"
            f"apad,atrim=end_sample={audio.target_samples},asetpts=PTS-STARTPTS[aout]")
        return lines, None, "aout"
    if audio.music_volume is not None and not (audio.music_volume >= 0):
        raise GraphBuildError(RenderFailureCode.INVALID_MUSIC_VOLUME,
                              f"bad music volume {audio.music_volume!r}")
    if audio.fade_in_frames < 0 or audio.fade_out_frames < 0:
        raise GraphBuildError(RenderFailureCode.INVALID_FADE_CONFIG,
                              "negative fade length")
    music_idx = len(inputs)
    music_opts = ("-stream_loop", "-1") if audio.music_loop else ()
    inputs.append(FFmpegInput(path=audio.music_path, options=music_opts))
    voice_vol = audio.narration_volume
    lines.append(
        f"[{nar_idx}:a]volume={voice_vol},aresample=48000,"
        f"aformat=channel_layouts=stereo,apad,atrim=end_sample={audio.target_samples},"
        f"asetpts=PTS-STARTPTS,asplit=2[voice][side]")
    music_pre = _fade_chain(
        f"[{music_idx}:a]volume={audio.music_volume},aresample=48000,"
        f"aformat=channel_layouts=stereo,"
        f"atrim=end_sample={audio.target_samples},asetpts=PTS-STARTPTS",
        audio.fade_in_frames, audio.fade_out_frames, audio.target_samples)
    lines.append(f"{music_pre}[music_pre]")
    lines.append(f"[music_pre][side]sidechaincompress={_duck_params()}[music_duck]")
    lines.append("[voice][music_duck]amix=inputs=2:duration=first:"
                 "dropout_transition=0:normalize=0[amixed]")
    lines.append(f"[amixed]atrim=end_sample={audio.target_samples},"
                 f"asetpts=PTS-STARTPTS[aout]")
    return lines, music_idx, "aout"


def _font_dirs() -> list[Path]:
    import os
    dirs = [Path(r"C:\Windows\Fonts")]
    extra = os.environ.get("UNFOLDIQ_FONTS_DIR")
    if extra:
        dirs.append(Path(extra))
    return [d for d in dirs if d.is_dir()]


def _resolve_font(font_name: str) -> Path:
    def norm(s: str) -> str:
        return "".join(ch for ch in s.lower() if ch.isalnum())
    want = norm(font_name)
    for d in _font_dirs():
        try:
            for f in d.iterdir():
                if f.suffix.lower() in (".ttf", ".otf", ".ttc") and norm(f.stem) == want:
                    return f
        except OSError:
            continue
    raise GraphBuildError(RenderFailureCode.SUBTITLE_FONT_UNAVAILABLE,
                          f"requested burn-in font not available: {font_name!r}")


def _escape_sub_path(path: Path) -> str:
    text = path.as_posix()
    return text.replace("\\", "/").replace(":", "\\:").replace("'", "\\'")


def build_ffmpeg_execution(plan: RenderExecutionPlan,
                           profile_name=None,
                           base_dir: Path | None = None) -> FFmpegBuild:
    from studio.manifest_render_types import EncoderProfileName
    profile = get_encoder_profile(profile_name or plan.encoder_profile)
    scratch = Path(plan.scratch_dir)
    scratch.mkdir(parents=True, exist_ok=True)

    # Determine base_dir for relative input paths to ensure Windows 32,767 char limit safety
    base = base_dir
    if base is None and plan.clips:
        try:
            import os
            all_media = [str(c.source_path) for c in plan.clips if c.source_path]
            if plan.audio and plan.audio.narration_path:
                all_media.append(str(plan.audio.narration_path))
            if all_media:
                comm = Path(os.path.commonpath(all_media))
                if not comm.is_dir():
                    comm = comm.parent
                if comm.name.lower() in ("assets", "shots", "images", "videos"):
                    comm = comm.parent
                base = comm
        except (ValueError, OSError):
            pass
    if base is None:
        for cand in (plan.scratch_dir, plan.scratch_dir.parent, plan.scratch_dir.parent.parent):
            if cand and cand.is_dir():
                if plan.clips and all(c.source_path.is_relative_to(cand) for c in plan.clips if c.source_path):
                    base = cand
                    break

    def _fmt_path(p: Path) -> str:
        if base is not None:
            try:
                if p.is_relative_to(base):
                    return str(p.relative_to(base)).replace("\\", "/")
            except (ValueError, TypeError):
                pass
        return str(p)

    inputs: list[FFmpegInput] = []
    filters: list[str] = []
    for i, clip in enumerate(plan.clips):
        ff_in, chain = _visual_chain(i, clip, profile)
        inputs.append(ff_in)
        filters.append(chain)

    # Expose transitions/clip order to the composer without globals leakage.
    filters, video_label = _compose_visual(
        filters, [c.clip_id for c in plan.clips], list(plan.transitions),
        plan.expected_final_frames)

    nar_in = FFmpegInput(path=plan.audio.narration_path, options=())
    inputs.append(nar_in)
    audio_lines, _music_idx, audio_label = _build_audio(
        plan.audio, len(inputs) - 1, inputs)
    filters.extend(audio_lines)

    # Subtitles: soft maps mov_text; hard burns into video (never both).
    video_label = video_label
    maps = ["-map", f"[{video_label}]", "-map", f"[{audio_label}]"]
    sub = plan.subtitle
    if sub.path is not None:
        if sub.burn_in:
            style_parts = []
            if sub.font_name:
                font_path = _resolve_font(sub.font_name)
                style_parts.append(f"FontName={font_path.stem}")
            if sub.font_size is not None:
                style_parts.append(f"FontSize={sub.font_size}")
            if sub.bottom_offset_px is not None:
                style_parts.append(f"MarginV={sub.bottom_offset_px}")
            style = ""
            if style_parts:
                style = f":force_style='{','.join(style_parts)}'"
            filters.append(
                f"[{video_label}]subtitles='{_escape_sub_path(sub.path)}'{style}[vburn]")
            video_label = "vburn"
            maps = ["-map", f"[{video_label}]", "-map", f"[{audio_label}]"]
        else:
            sub_idx = len(inputs)
            inputs.append(FFmpegInput(path=sub.path, options=()))
            maps.extend(["-map", f"{sub_idx}", "-c:s", "mov_text"])

    argv: list[str] = ["ffmpeg", "-hide_banner", "-nostdin",
                       "-progress", "pipe:1", "-stats_period", "0.5"]
    for ff_in in inputs:
        argv.extend(ff_in.options)
        argv.extend(["-i", _fmt_path(ff_in.path)])
    script_path = scratch / "filter-complex.txt"
    script_text = ";\n".join(filters) + "\n"
    script_path.write_text(script_text, encoding="utf-8")
    argv.extend(["-filter_complex_script", str(script_path)])
    argv.extend(maps)
    argv.extend(["-r", "24"])
    argv.extend(profile.video_args)
    argv.extend(["-c:a", profile.audio_codec, "-b:a", profile.audio_bitrate,
                 "-ar", str(profile.audio_sample_rate),
                 "-ac", str(profile.audio_channels),
                 "-movflags", "+faststart"])
    candidate = scratch / "candidate.mp4"
    argv.append(str(candidate))
    return FFmpegBuild(inputs=tuple(inputs), argv=tuple(argv),
                       filter_script_path=script_path,
                       filter_script_text=script_text,
                       expected_final_frames=plan.expected_final_frames,
                       candidate_path=candidate,
                       cwd=base)
