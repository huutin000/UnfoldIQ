"""Phase 8 Task 4: visual FFmpeg graph builder tests."""
import wave

import pytest

from studio.ffmpeg_graph_builder import build_ffmpeg_execution
from studio.manifest_render_types import EncoderProfileName
from studio.render_planner import build_render_execution_plan


def _wav(p, seconds=8.0):
    import pathlib
    p = pathlib.Path(p)
    with wave.open(str(p), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(24000)
        w.writeframes(b"\x00" * int(24000 * seconds) * 2)


def _clip(i, media="IMAGE", path="assets/a.png", fitting="FIT_PAD",
          start=0, dur=96, speed=1.0, trans=None):
    from studio.render_manifest import ClipTrim, RenderClip, Transition
    trim = None
    if media == "VIDEO" or speed != 1.0:
        trim = ClipTrim(inFrame=0, outFrame=96, speedFactor=speed)
    return RenderClip(
        clipId=f"clip_{i:04d}", sceneId="s", shotId=f"sh{i}", sequenceIndex=i,
        startFrame=start, durationFrames=dur, endFrame=start + dur,
        timelineStartSeconds=start / 24, durationSeconds=dur / 24,
        assetId=f"a{i}", acceptedAssetVersion=1, checksum="ab" * 32,
        filePath=path, mediaType=media, fittingStrategy=fitting, trim=trim,
        transition=trans or Transition(type="CUT", durationFrames=0))


def _plan(tmp_path, clips, scratch_name="scratch"):
    from studio.render_manifest import RenderManifest, VideoTrack, VoiceTrack
    from studio.manifest_integrity import VerifiedRenderSnapshot
    (tmp_path / "assets").mkdir(exist_ok=True)
    for c in clips:
        p = tmp_path / c.filePath
        if not p.exists():
            p.write_bytes(b"\x89PNG" + b"\x00" * 64)
    total = max(c.endFrame for c in clips)
    _wav(tmp_path / "audio.wav", total / 24)
    m = RenderManifest(projectId="p", videoTrack=VideoTrack(clips=clips),
                       voiceTrack=VoiceTrack(filePath="audio.wav",
                                              checksum="e" * 64,
                                              durationFrames=total))
    snap = VerifiedRenderSnapshot(tmp_path, tmp_path, tmp_path / "m.json", m)
    scratch = tmp_path / scratch_name
    scratch.mkdir(exist_ok=True)
    return build_render_execution_plan(snap, EncoderProfileName.FINAL_QUALITY, scratch)


@pytest.fixture
def image_plan(tmp_path):
    return _plan(tmp_path, [_clip(1)])


@pytest.fixture
def fit_pad_plan(tmp_path):
    return _plan(tmp_path, [_clip(1, fitting="FIT_PAD")])


@pytest.fixture
def fill_crop_plan(tmp_path):
    return _plan(tmp_path, [_clip(1, fitting="FILL_CROP")])


@pytest.fixture
def video_trim_plan(tmp_path):
    (tmp_path / "assets").mkdir(exist_ok=True)
    (tmp_path / "assets" / "v.mp4").write_bytes(b"\x00" * 256)
    return _plan(tmp_path, [_clip(1, media="VIDEO", path="assets/v.mp4")])


@pytest.fixture
def crossfade_plan(tmp_path):
    from studio.render_manifest import Transition
    return _plan(tmp_path, [
        _clip(1, dur=96),
        _clip(2, start=72, dur=96,
              trans=Transition(type="CROSSFADE", durationFrames=24)),
    ])


@pytest.fixture
def cut_plan(tmp_path):
    return _plan(tmp_path, [_clip(1, dur=48), _clip(2, start=48, dur=48)])


@pytest.fixture
def speed_plan(tmp_path):
    (tmp_path / "assets").mkdir(exist_ok=True)
    (tmp_path / "assets" / "v.mp4").write_bytes(b"\x00" * 256)
    return _plan(tmp_path, [_clip(1, media="VIDEO", path="assets/v.mp4", speed=2.0, dur=48)])


@pytest.fixture
def cut_plan_factory(tmp_path):
    def make(w, h):
        return _plan(tmp_path, [_clip(1, dur=48), _clip(2, start=48, dur=48)])
    return make


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


def test_cut_only_uses_concat_filter(cut_plan):
    graph = build_ffmpeg_execution(cut_plan).filter_script_text
    assert "concat=" in graph
    assert "xfade=" not in graph


def test_output_invariants_pinned(cut_plan):
    build = build_ffmpeg_execution(cut_plan)
    for token in ("-r", "24", "-pix_fmt", "yuv420p", "-c:a", "aac",
                  "-b:a", "192k", "-ar", "48000", "-ac", "2",
                  "-movflags", "+faststart"):
        assert token in build.argv, token
    assert "-shortest" not in build.argv


def test_filter_script_written_to_scratch(cut_plan):
    build = build_ffmpeg_execution(cut_plan)
    assert build.filter_script_path.is_file()
    assert build.filter_script_path.read_text(encoding="utf-8") == build.filter_script_text


def test_speed_factor_scales_pts(speed_plan):
    graph = build_ffmpeg_execution(speed_plan).filter_script_text
    assert "setpts=(PTS-STARTPTS)/2.0" in graph


@pytest.mark.parametrize("w,h", [(1280, 720), (720, 1280), (800, 800)])
def test_aspect_shapes_normalize(cut_plan_factory, w, h):
    build = build_ffmpeg_execution(cut_plan_factory(w, h))
    assert "scale=" in build.filter_script_text


@pytest.mark.parametrize("frames,sec", [(1, "0.041666666666666664"), (7, "0.2916666666666667"),
                                        (12, "0.5"), (24, "1")])
def test_transition_seconds_derive_from_frames(tmp_path, frames, sec):
    from studio.render_manifest import Transition
    plan = _plan(tmp_path, [
        _clip(1, dur=96),
        _clip(2, start=96 - frames, dur=96,
              trans=Transition(type="CROSSFADE", durationFrames=frames)),
    ], scratch_name=f"sc{frames}")
    graph = build_ffmpeg_execution(plan).filter_script_text
    assert f"duration={sec}" in graph


def test_mixed_cut_and_crossfade(tmp_path):
    from studio.render_manifest import Transition
    plan = _plan(tmp_path, [
        _clip(1, dur=48),
        _clip(2, start=48, dur=48),
        _clip(3, start=72, dur=48,
              trans=Transition(type="CROSSFADE", durationFrames=24)),
    ], scratch_name="mixed")
    graph = build_ffmpeg_execution(plan).filter_script_text
    assert "xfade=" in graph
    assert "concat=" not in graph


def test_speed_half_slows_pts(tmp_path):
    (tmp_path / "assets").mkdir(exist_ok=True)
    (tmp_path / "assets" / "v.mp4").write_bytes(b"\x00" * 256)
    plan = _plan(tmp_path, [_clip(1, media="VIDEO", path="assets/v.mp4", speed=0.5)],
                 scratch_name="half")
    assert "setpts=(PTS-STARTPTS)/0.5" in build_ffmpeg_execution(plan).filter_script_text
