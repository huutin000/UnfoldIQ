"""Phase 9 real-media fixture helper (test-only, temp dirs only).

Generates genuine FFmpeg H.264/AAC finals plus matching export-scoped
manifest/metadata snapshots. Never touches real project data.
"""
import json
import subprocess
from pathlib import Path

from studio.render_manifest_hashing import compute_manifest_hash

FPS = 24
WIDTH, HEIGHT = 1920, 1080


def run(cmd: list[str], timeout: float = 600.0) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)


def _must(cmd: list[str], timeout: float = 600.0) -> None:
    proc = run(cmd, timeout)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg fixture failed: {' '.join(cmd)}\n{proc.stderr[-2000:]}")


def ubuntu_font() -> str | None:
    for cand in (Path("C:/Windows/Fonts/arial.ttf"), Path("/usr/share/fonts"),
                 Path("C:/Windows/Fonts/segoeui.ttf")):
        if cand.is_file():
            return str(cand)
    return None


def make_clean_final(path: Path, duration_s: float = 4.0,
                     width: int = WIDTH, height: int = HEIGHT,
                     fps: int = FPS, sample_rate: int = 48000,
                     channels: int = 2, with_audio: bool = True,
                     extra_video_args: list | None = None,
                     extra_args: list | None = None) -> Path:
    """Bright H.264 + loud sine AAC final with exact frame count."""
    n = int(round(duration_s * fps))
    dur = n / fps
    cmd = ["ffmpeg", "-y",
           "-f", "lavfi", "-i", f"testsrc2=size={width}x{height}:rate={fps}:duration={dur}"]
    if with_audio:
        cmd += ["-f", "lavfi", "-i",
                f"sine=frequency=440:sample_rate={sample_rate}:duration={dur}"]
    cmd += ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", str(fps),
            "-g", str(fps), "-preset", "veryfast", "-crf", "23"]
    if with_audio:
        cmd += ["-c:a", "aac", "-ac", str(channels), "-ar", str(sample_rate),
                "-b:a", "192k", "-shortest"]
    else:
        cmd += ["-an"]
    cmd += (extra_video_args or []) + (extra_args or []) + [str(path)]
    _must(cmd)
    return path


def make_black_gap_final(path: Path, black_s: float, total_s: float = 6.0,
                         black_at_s: float = 2.0) -> Path:
    """Bright video with a pure-black gap; loud audio throughout."""
    pre, post = black_at_s, total_s - black_at_s - black_s
    assert pre >= 0 and post >= 0
    cmd = ["ffmpeg", "-y",
           "-f", "lavfi", "-i", f"testsrc2=size={WIDTH}x{HEIGHT}:rate={FPS}:duration={pre}",
           "-f", "lavfi", "-i", f"color=c=black:size={WIDTH}x{HEIGHT}:rate={FPS}:duration={black_s}",
           "-f", "lavfi", "-i", f"testsrc2=size={WIDTH}x{HEIGHT}:rate={FPS}:duration={post}",
           "-f", "lavfi", "-i", f"sine=frequency=440:sample_rate=48000:duration={total_s}",
           "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]",
           "-map", "[v]", "-map", "3:a",
           "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", str(FPS),
           "-c:a", "aac", "-ac", "2", "-ar", "48000", "-b:a", "192k",
           "-shortest", str(path)]
    _must(cmd)
    return path


def make_freeze_final(path: Path, freeze_s: float, prefix_s: float = 2.0,
                      suffix_s: float = 2.0, workdir: Path | None = None) -> Path:
    """Bright prefix, truly static segment, bright suffix (motion resumes so
    freezedetect emits the full start/duration/end triple)."""
    workdir = Path(workdir or path.parent)
    frame = workdir / "freeze_frame.png"
    _must(["ffmpeg", "-y", "-f", "lavfi", "-i",
           f"testsrc2=size={WIDTH}x{HEIGHT}:rate={FPS}:duration={prefix_s + 0.2}",
           "-frames:v", "1", str(frame)])
    total_s = prefix_s + freeze_s + suffix_s
    _must(["ffmpeg", "-y",
           "-f", "lavfi", "-i", f"testsrc2=size={WIDTH}x{HEIGHT}:rate={FPS}:duration={prefix_s}",
           "-loop", "1", "-t", str(freeze_s), "-i", str(frame),
           "-f", "lavfi", "-i", f"testsrc2=size={WIDTH}x{HEIGHT}:rate={FPS}:duration={suffix_s}",
           "-f", "lavfi", "-i", f"sine=frequency=440:sample_rate=48000:duration={total_s}",
           "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]",
           "-map", "[v]", "-map", "3:a",
           "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", str(FPS),
           "-c:a", "aac", "-ac", "2", "-ar", "48000", "-b:a", "192k",
           "-shortest", str(path)])
    return path


def make_eof_freeze_final(path: Path, freeze_s: float, prefix_s: float = 2.0,
                          workdir: Path | None = None) -> Path:
    """Bright prefix, then a static segment held through EOF (no resuming
    motion, so freezedetect emits start-only evidence)."""
    workdir = Path(workdir or path.parent)
    frame = workdir / "freeze_frame.png"
    _must(["ffmpeg", "-y", "-f", "lavfi", "-i",
           f"testsrc2=size={WIDTH}x{HEIGHT}:rate={FPS}:duration={prefix_s + 0.2}",
           "-frames:v", "1", str(frame)])
    total_s = prefix_s + freeze_s
    _must(["ffmpeg", "-y",
           "-f", "lavfi", "-i", f"testsrc2=size={WIDTH}x{HEIGHT}:rate={FPS}:duration={prefix_s}",
           "-loop", "1", "-t", str(freeze_s), "-i", str(frame),
           "-f", "lavfi", "-i", f"sine=frequency=440:sample_rate=48000:duration={total_s}",
           "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]",
           "-map", "[v]", "-map", "2:a",
           "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", str(FPS),
           "-c:a", "aac", "-ac", "2", "-ar", "48000", "-b:a", "192k",
           "-shortest", str(path)])
    return path


def make_silence_gap_final(path: Path, silence_s: float, total_s: float = 12.0,
                           silence_at_s: float = 2.0) -> Path:
    """Bright video; audio with a digital-silence gap inside loud sine."""
    pre = silence_at_s
    post = total_s - silence_at_s - silence_s
    assert pre >= 0 and post >= 0
    cmd = ["ffmpeg", "-y",
           "-f", "lavfi", "-i", f"testsrc2=size={WIDTH}x{HEIGHT}:rate={FPS}:duration={total_s}",
           "-f", "lavfi", "-i", f"sine=frequency=440:sample_rate=48000:duration={pre}",
           "-f", "lavfi", "-i", f"aevalsrc=0:sample_rate=48000:duration={silence_s}",
           "-f", "lavfi", "-i", f"sine=frequency=880:sample_rate=48000:duration={post}",
           "-filter_complex", "[1:a][2:a][3:a]concat=n=3:v=0:a=1[a]",
           "-map", "0:v", "-map", "[a]",
           "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", str(FPS),
           "-c:a", "aac", "-ac", "2", "-ar", "48000", "-b:a", "192k",
           "-shortest", str(path)]
    _must(cmd)
    return path


def make_srt(path: Path, duration_s: float = 4.0) -> Path:
    path.write_text(
        "1\n00:00:00,000 --> 00:00:02,000\nHello world\n\n"
        f"2\n00:00:02,000 --> 00:00:{int(duration_s):02d},000\nGoodbye world\n",
        encoding="utf-8")
    return path


def mux_soft_subtitles(video_in: Path, srt: Path, out: Path) -> Path:
    _must(["ffmpeg", "-y", "-i", str(video_in), "-i", str(srt),
           "-c", "copy", "-c:s", "mov_text", str(out)])
    return out


def probe_frames(path: Path) -> int:
    from studio.render_qa_probe import run_ffprobe
    return run_ffprobe(path).video.read_frames


def write_export(project_dir: Path, export_id: str, final_src: Path,
                 clips: list | None = None, subtitle_mode: str = "none",
                 music_configured: bool = False,
                 n_frames: int | None = None) -> dict:
    """Copy final_src to canonical final.mp4 + matching manifest/metadata."""
    export_dir = project_dir / "exports" / export_id
    export_dir.mkdir(parents=True, exist_ok=True)
    import shutil
    shutil.copyfile(final_src, export_dir / "final.mp4")
    if n_frames is None:
        n_frames = probe_frames(export_dir / "final.mp4")
    if clips is None:
        clips = [{"clipId": "clip_0001", "sceneId": "scene_001",
                  "shotId": "shot_001", "sequenceIndex": 1,
                  "startFrame": 0, "durationFrames": n_frames,
                  "endFrame": n_frames, "assetId": "a1",
                  "acceptedAssetVersion": 1, "checksum": "0" * 64,
                  "filePath": "assets/s1.png", "mediaType": "VIDEO",
                  "transition": {"type": "CUT", "durationFrames": 0}}]
    manifest = {
        "schemaVersion": "1.0.0", "projectId": project_dir.name,
        "exportId": export_id,
        "frameRate": {"numerator": 24, "denominator": 1},
        "timeBase": {"numerator": 1, "denominator": 24},
        "output": {"width": 1920, "height": 1080},
        "videoTrack": {"clips": clips},
        "voiceTrack": {},
        "musicTrack": {"configured": bool(music_configured)},
        "subtitlesTrack": {"configured": subtitle_mode != "none",
                           "burnIn": subtitle_mode == "hard",
                           "filePath": "subs.srt" if subtitle_mode == "soft" else None,
                           "format": "srt" if subtitle_mode == "soft" else None},
        "scenes": [],
    }
    manifest["manifestHash"] = compute_manifest_hash(manifest)
    (export_dir / "render-manifest.json").write_text(
        json.dumps(manifest), encoding="utf-8")
    (export_dir / "render-metadata.json").write_text(json.dumps(
        {"projectId": project_dir.name, "exportId": export_id,
         "manifestHash": manifest["manifestHash"],
         "expectedFinalFrames": n_frames}), encoding="utf-8")
    return {"export_dir": export_dir, "manifest": manifest,
            "n_frames": n_frames}
