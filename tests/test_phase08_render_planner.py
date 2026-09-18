"""Phase 8 Task 3: deterministic frame-accurate RenderPlanner."""
import wave

import pytest

from studio.manifest_render_types import CompositionStrategy, EncoderProfileName
from studio.render_planner import build_render_execution_plan


def _wav(p, seconds=4.0):
    import pathlib
    p = pathlib.Path(p)
    with wave.open(str(p), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(24000)
        w.writeframes(b"\x00" * int(24000 * seconds) * 2)


def _manifest(tmp_path, transitions=None, fitting="FIT_PAD", speed=1.0):
    from studio.render_manifest import (
        ClipTrim, RenderClip, RenderManifest, Transition, VideoTrack, VoiceTrack)
    (tmp_path / "assets").mkdir(exist_ok=True)
    (tmp_path / "assets" / "a.png").write_bytes(b"\x89PNG" + b"\x00" * 64)
    (tmp_path / "assets" / "b.png").write_bytes(b"\x89PNG" + b"\x00" * 64)
    _wav(tmp_path / "audio.wav", 8.0)
    trim = ClipTrim(inFrame=0, outFrame=96, speedFactor=speed) \
        if speed != 1.0 and speed > 0 else None
    # Note: non-positive speed / bad fitting bypass schema via model_copy
    # below, proving the planner itself rejects them.
    clips = [
        RenderClip(clipId="clip_0001", sceneId="s", shotId="sh1", sequenceIndex=1,
                   startFrame=0, durationFrames=96, endFrame=96,
                   timelineStartSeconds=0.0, durationSeconds=4.0,
                   assetId="a1", acceptedAssetVersion=1, checksum="ab" * 32,
                   filePath="assets/a.png", mediaType="IMAGE",
                   fittingStrategy="FIT_PAD", trim=trim,
                   transition=Transition(type="CUT", durationFrames=0)),
        RenderClip(clipId="clip_0002", sceneId="s", shotId="sh2", sequenceIndex=2,
                   startFrame=96, durationFrames=96, endFrame=192,
                   timelineStartSeconds=4.0, durationSeconds=4.0,
                   assetId="a2", acceptedAssetVersion=1, checksum="cd" * 32,
                   filePath="assets/b.png", mediaType="IMAGE",
                   fittingStrategy="FIT_PAD",
                   transition=(transitions[1] if transitions else Transition(
                       type="CUT", durationFrames=0))),
    ]
    if fitting not in ("FIT_PAD", "FILL_CROP"):
        # Bypass schema to prove the planner itself rejects bad fitting.
        clips[0] = clips[0].model_copy(update={"fittingStrategy": fitting})
    if speed != 1.0:
        # Bypass schema to prove the planner itself rejects bad speed.
        bad_trim = clips[0].trim.model_copy(update={"speedFactor": speed}) \
            if clips[0].trim else ClipTrim.model_construct(
                inFrame=0, outFrame=96, speedFactor=speed)
        clips[0] = clips[0].model_copy(update={"trim": bad_trim})
    m = RenderManifest(projectId="p", videoTrack=VideoTrack(clips=clips),
                       voiceTrack=VoiceTrack(filePath="audio.wav",
                                              checksum="e" * 64, durationFrames=192))
    from studio.manifest_integrity import VerifiedRenderSnapshot
    return VerifiedRenderSnapshot(tmp_path, tmp_path, tmp_path / "m.json", m)


@pytest.fixture
def valid_snapshot(tmp_path):
    return _manifest(tmp_path)


@pytest.fixture
def crossfade_snapshot(tmp_path):
    from studio.render_manifest import Transition
    return _manifest(tmp_path, transitions={
        1: Transition(type="CROSSFADE", durationFrames=24)})


@pytest.fixture
def bad_speed_snapshot(tmp_path):
    return _manifest(tmp_path, speed=0.0)


@pytest.fixture
def bad_fitting_snapshot(tmp_path):
    return _manifest(tmp_path, fitting="STRETCH")


def test_cut_only_manifest_uses_simple_cut(valid_snapshot, tmp_path):
    plan = build_render_execution_plan(
        valid_snapshot, EncoderProfileName.FINAL_QUALITY, tmp_path)
    assert plan.expected_final_frames == max(
        c.endFrame for c in valid_snapshot.manifest.videoTrack.clips)
    assert plan.composition_strategy is CompositionStrategy.SIMPLE_CUT


def test_crossfade_manifest_uses_filter_complex(crossfade_snapshot, tmp_path):
    plan = build_render_execution_plan(
        crossfade_snapshot, EncoderProfileName.FINAL_QUALITY, tmp_path)
    assert plan.composition_strategy is CompositionStrategy.FILTER_COMPLEX
    x = plan.transitions[0]
    assert x.duration_frames == crossfade_snapshot.manifest.videoTrack.clips[1].transition.durationFrames


def test_audio_sample_target_is_integer_frame_derived(valid_snapshot, tmp_path):
    plan = build_render_execution_plan(
        valid_snapshot, EncoderProfileName.FINAL_QUALITY, tmp_path)
    assert plan.audio.target_samples == plan.expected_final_frames * 2000


def test_plan_preserves_clip_order_and_ids(valid_snapshot, tmp_path):
    plan = build_render_execution_plan(
        valid_snapshot, EncoderProfileName.FINAL_QUALITY, tmp_path)
    src = valid_snapshot.manifest.videoTrack.clips
    assert [c.clip_id for c in plan.clips] == [c.clipId for c in src]
    assert [c.target_frames for c in plan.clips] == [c.durationFrames for c in src]


def test_plan_rejects_bad_speed_factor(bad_speed_snapshot, tmp_path):
    from studio.render_planner import RenderPlanError
    with pytest.raises(RenderPlanError):
        build_render_execution_plan(
            bad_speed_snapshot, EncoderProfileName.FINAL_QUALITY, tmp_path)


def test_plan_rejects_unsupported_fitting(bad_fitting_snapshot, tmp_path):
    from studio.render_planner import RenderPlanError
    with pytest.raises(RenderPlanError):
        build_render_execution_plan(
            bad_fitting_snapshot, EncoderProfileName.FINAL_QUALITY, tmp_path)


def test_plan_encoder_profile_recorded(valid_snapshot, tmp_path):
    plan = build_render_execution_plan(
        valid_snapshot, EncoderProfileName.ACCELERATED, tmp_path)
    assert plan.encoder_profile is EncoderProfileName.ACCELERATED
    assert plan.scratch_dir == tmp_path


@pytest.mark.parametrize("n", [250, 500])
def test_large_manifest_planning(n, tmp_path):
    import time
    from studio.render_planner import build_render_execution_plan
    from studio.ffmpeg_graph_builder import build_ffmpeg_execution
    manifest = _big_manifest(n)
    from studio.manifest_integrity import VerifiedRenderSnapshot
    snapshot = VerifiedRenderSnapshot(tmp_path, tmp_path, tmp_path / "m.json", manifest)
    t0 = time.perf_counter()
    plan = build_render_execution_plan(snapshot, EncoderProfileName.FINAL_QUALITY, tmp_path)
    plan_ms = (time.perf_counter() - t0) * 1000
    assert len(plan.clips) == n
    assert plan.expected_final_frames > 0
    assert plan.composition_strategy in {CompositionStrategy.SIMPLE_CUT,
                                         CompositionStrategy.FILTER_COMPLEX}

    t1 = time.perf_counter()
    build = build_ffmpeg_execution(plan)
    graph_ms = (time.perf_counter() - t1) * 1000

    # Prove filter graph is written to file/script
    assert build.filter_script_path.is_file()
    assert build.filter_script_path.stat().st_size > 0
    assert "-filter_complex_script" in build.argv
    assert str(build.filter_script_path) in build.argv
    assert "-filter_complex" not in build.argv, "Must use -filter_complex_script, not inline -filter_complex"

    # Prove argv has no giant inline Windows filter graph
    argv_str = " ".join(build.argv)
    assert "scale=1920:1080" not in argv_str, "Filter details must be in the script file, not in argv"
    assert "[vout]" in argv_str and "[aout]" in argv_str

    # Record scale evidence to temp/phase08_verification/scale/
    import json
    import subprocess
    from pathlib import Path
    evidence_dir = Path("temp/phase08_verification/scale")
    evidence_dir.mkdir(parents=True, exist_ok=True)
    evidence_file = evidence_dir / f"scale_{n}_shots.json"
    cmdline_str = subprocess.list2cmdline(build.argv)
    cmdline_chars = len(cmdline_str)
    assert cmdline_chars < 32767, f"Windows CreateProcess limit 32767 exceeded: {cmdline_chars}"
    evidence_file.write_text(json.dumps({
        "shotCount": n,
        "plannerMs": round(plan_ms, 2),
        "graphBuilderMs": round(graph_ms, 2),
        "filterScriptSizeBytes": build.filter_script_path.stat().st_size,
        "argvTokenCount": len(build.argv),
        "serializedCommandLineCharCount": cmdline_chars,
        "mediaInputCount": len(build.inputs),
        "windowsLimit": 32767,
        "withinWindowsLimit": cmdline_chars < 32767,
        "filterComplexScriptUsed": True,
        "inlineFilterComplexAvoided": True,
    }, indent=2), encoding="utf-8")
    print(f"\nScale {n} shots -> Plan: {plan_ms:.1f}ms, Graph: {graph_ms:.1f}ms, Script: {build.filter_script_path.stat().st_size} bytes, Argv tokens: {len(build.argv)}, Cmdline chars: {cmdline_chars} (< 32767)")


def _big_manifest(n):
    from studio.render_manifest import RenderClip, RenderManifest, VideoTrack
    clips = [RenderClip(clipId=f"clip_{i:04d}", sceneId="s", shotId=f"sh{i}",
                        sequenceIndex=i + 1, startFrame=i * 48,
                        durationFrames=48, endFrame=(i + 1) * 48,
                        timelineStartSeconds=i * 2.0, durationSeconds=2.0,
                        assetId=f"a{i}", acceptedAssetVersion=1,
                        checksum="ab" * 32, filePath=f"assets/{i}.png",
                        mediaType="IMAGE")
             for i in range(n)]
    return RenderManifest(projectId="big", videoTrack=VideoTrack(clips=clips))


def test_insufficient_source_duration_rejected(tmp_path):
    from studio.render_manifest import (
        ClipTrim, RenderClip, RenderManifest, Transition, VideoTrack, VoiceTrack)
    from studio.manifest_integrity import VerifiedRenderSnapshot
    from studio.render_planner import RenderPlanError
    from studio.manifest_render_types import RenderFailureCode
    (tmp_path / "assets").mkdir(exist_ok=True)
    (tmp_path / "assets" / "v.mp4").write_bytes(b"\x00" * 128)
    _wav(tmp_path / "audio.wav", 4.0)
    # Native source has 48 frames (in=0, out=48).
    # With speed=2.0, usable frames is 48 / 2.0 = 24 frames.
    # But durationFrames is 48 frames -> insufficient!
    trim = ClipTrim(inFrame=0, outFrame=48, speedFactor=2.0)
    clip = RenderClip(
        clipId="c1", sceneId="s", shotId="sh1", sequenceIndex=1,
        startFrame=0, durationFrames=48, endFrame=48,
        timelineStartSeconds=0.0, durationSeconds=2.0,
        assetId="a1", acceptedAssetVersion=1, checksum="ab" * 32,
        filePath="assets/v.mp4", mediaType="VIDEO",
        fittingStrategy="FIT_PAD", trim=trim,
        transition=Transition(type="CUT", durationFrames=0))
    m = RenderManifest(projectId="p", videoTrack=VideoTrack(clips=[clip]),
                       voiceTrack=VoiceTrack(filePath="audio.wav", checksum="e" * 64, durationFrames=48))
    snap = VerifiedRenderSnapshot(tmp_path, tmp_path, tmp_path / "m.json", m)
    with pytest.raises(RenderPlanError) as exc_info:
        build_render_execution_plan(snap, EncoderProfileName.FINAL_QUALITY, tmp_path / "sc_insuf")
    assert exc_info.value.code == RenderFailureCode.INSUFFICIENT_SOURCE_DURATION


@pytest.mark.parametrize("speed,in_f,out_f,target_dur", [
    (0.5, 0, 48, 96),  # 48 frames / 0.5 = 96 usable frames == 96 target frames
    (1.0, 0, 48, 48),  # 48 frames / 1.0 = 48 usable frames == 48 target frames
    (2.0, 0, 96, 48),  # 96 frames / 2.0 = 48 usable frames == 48 target frames
])
def test_speed_factors_and_filter_order(tmp_path, speed, in_f, out_f, target_dur):
    from studio.render_manifest import (
        ClipTrim, RenderClip, RenderManifest, Transition, VideoTrack, VoiceTrack)
    from studio.manifest_integrity import VerifiedRenderSnapshot
    from studio.ffmpeg_graph_builder import build_ffmpeg_execution
    (tmp_path / "assets").mkdir(exist_ok=True)
    (tmp_path / "assets" / "v.mp4").write_bytes(b"\x00" * 128)
    _wav(tmp_path / "audio.wav", target_dur / 24)
    trim = ClipTrim(inFrame=in_f, outFrame=out_f, speedFactor=speed)
    clip = RenderClip(
        clipId="c1", sceneId="s", shotId="sh1", sequenceIndex=1,
        startFrame=0, durationFrames=target_dur, endFrame=target_dur,
        timelineStartSeconds=0.0, durationSeconds=target_dur / 24,
        assetId="a1", acceptedAssetVersion=1, checksum="ab" * 32,
        filePath="assets/v.mp4", mediaType="VIDEO",
        fittingStrategy="FIT_PAD", trim=trim,
        transition=Transition(type="CUT", durationFrames=0))
    m = RenderManifest(projectId="p", videoTrack=VideoTrack(clips=[clip]),
                       voiceTrack=VoiceTrack(filePath="audio.wav", checksum="e" * 64, durationFrames=target_dur))
    snap = VerifiedRenderSnapshot(tmp_path, tmp_path, tmp_path / "m.json", m)
    scratch = tmp_path / f"sc_speed_{int(speed * 10)}"
    scratch.mkdir(exist_ok=True)
    plan = build_render_execution_plan(snap, EncoderProfileName.FINAL_QUALITY, scratch)
    build = build_ffmpeg_execution(plan)
    graph = build.filter_script_text

    # Verify filter order: source trim -> setpts -> fps=24 -> fitting -> target frame trim
    idx_trim = graph.index(f"trim=start_frame={in_f}:end_frame={out_f}")
    idx_setpts = graph.index(f"setpts=(PTS-STARTPTS)/{speed}")
    idx_fps = graph.index("fps=24")
    idx_fit = graph.index("scale=1920:1080")
    idx_end_trim = graph.index(f"trim=end_frame={target_dur}")
    assert idx_trim < idx_setpts < idx_fps < idx_fit < idx_end_trim


def _make_cfr_video(path, rate: int, duration_sec: float):
    import subprocess
    subprocess.run([
        "ffmpeg", "-y", "-f", "lavfi",
        "-i", f"testsrc2=size=320x240:rate={rate}",
        "-t", str(duration_sec),
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        str(path)
    ], check=True, capture_output=True)


def test_cfr_source_duration_validation_24_30_60(tmp_path):
    """Prove source sufficiency using actual source timebase/fps across 24, 30, and 60fps CFR.
    Includes rejection cases when source frames produce insufficient canonical 24fps frames,
    and validates speedFactor 0.5 (doubles effective duration) and 2.0 (halves effective duration).
    """
    from studio.render_manifest import (
        ClipTrim, RenderClip, RenderManifest, Transition, VideoTrack, VoiceTrack)
    from studio.manifest_integrity import VerifiedRenderSnapshot
    from studio.render_planner import RenderPlanError
    from studio.manifest_render_types import RenderFailureCode

    assets = tmp_path / "assets"
    assets.mkdir(exist_ok=True)
    _wav(tmp_path / "audio.wav", 10.0)

    # 1. 24fps source (3.0s = 72 frames)
    v24 = assets / "v24.mp4"
    _make_cfr_video(v24, 24, 3.0)

    # 2. 30fps source (3.0s = 90 frames)
    v30 = assets / "v30.mp4"
    _make_cfr_video(v30, 30, 3.0)

    # 3. 60fps source (3.0s = 180 frames)
    v60 = assets / "v60.mp4"
    _make_cfr_video(v60, 60, 3.0)

    def _plan(file_rel, in_f, out_f, speed, target_f):
        audio_name = f"audio_{target_f}.wav"
        _wav(tmp_path / audio_name, target_f / 24)
        clip = RenderClip(
            clipId="c1", sceneId="s", shotId="sh1", sequenceIndex=1,
            startFrame=0, durationFrames=target_f, endFrame=target_f,
            timelineStartSeconds=0.0, durationSeconds=target_f / 24,
            assetId="a1", acceptedAssetVersion=1, checksum="ab" * 32,
            filePath=file_rel, mediaType="VIDEO",
            fittingStrategy="FIT_PAD",
            trim=ClipTrim(inFrame=in_f, outFrame=out_f, speedFactor=speed),
            transition=Transition(type="CUT", durationFrames=0))
        m = RenderManifest(projectId="p", videoTrack=VideoTrack(clips=[clip]),
                           voiceTrack=VoiceTrack(filePath=audio_name, checksum="e" * 64, durationFrames=target_f))
        snap = VerifiedRenderSnapshot(tmp_path, tmp_path, tmp_path / "m.json", m)
        return build_render_execution_plan(snap, EncoderProfileName.FINAL_QUALITY, tmp_path / f"sc_cfr_{target_f}_{in_f}_{out_f}")

    # --- 24fps CFR tests ---
    # 24 source frames @ 24fps at speed 1.0 = 1.0s = 24 canonical frames. Target = 24 -> ALLOWED.
    assert _plan("assets/v24.mp4", 0, 24, 1.0, 24) is not None

    # --- 30fps CFR tests ---
    # 30 source frames @ 30fps at speed 1.0 = 1.0s = 24 canonical frames. Target = 24 -> ALLOWED.
    assert _plan("assets/v30.mp4", 0, 30, 1.0, 24) is not None
    # 30 source frames @ 30fps at speed 1.0 = 1.0s = 24 canonical frames. Target = 48 -> INSUFFICIENT!
    with pytest.raises(RenderPlanError) as exc_info:
        _plan("assets/v30.mp4", 0, 30, 1.0, 48)
    assert exc_info.value.code == RenderFailureCode.INSUFFICIENT_SOURCE_DURATION

    # --- 60fps CFR tests ---
    # 60 source frames @ 60fps at speed 1.0 = 1.0s = 24 canonical frames. Target = 24 -> ALLOWED.
    assert _plan("assets/v60.mp4", 0, 60, 1.0, 24) is not None
    # 60 source frames @ 60fps at speed 1.0 = 1.0s = 24 canonical frames. Target = 48 -> INSUFFICIENT!
    with pytest.raises(RenderPlanError) as exc_info:
        _plan("assets/v60.mp4", 0, 60, 1.0, 48)
    assert exc_info.value.code == RenderFailureCode.INSUFFICIENT_SOURCE_DURATION

    # --- speedFactor tests ---
    # speedFactor = 0.5: 60 source frames @ 60fps (1.0s / 0.5 = 2.0s = 48 canonical frames). Target = 48 -> ALLOWED.
    assert _plan("assets/v60.mp4", 0, 60, 0.5, 48) is not None
    # speedFactor = 2.0: 120 source frames @ 60fps (2.0s / 2.0 = 1.0s = 24 canonical frames). Target = 48 -> INSUFFICIENT!
    with pytest.raises(RenderPlanError) as exc_info:
        _plan("assets/v60.mp4", 0, 120, 2.0, 48)
    assert exc_info.value.code == RenderFailureCode.INSUFFICIENT_SOURCE_DURATION


def test_vfr_source_duration_validation_timeline_vs_raw_frames(tmp_path):
    """Prove that VFR source sufficiency is decided from source timeline duration (PTS), NOT raw frame count.
    Deterministic fixture: 60 frames in first 0.5s (120fps burst), 30 frames in next 2.5s (12fps).
    Total 90 frames, 3.0s duration.
    Case 1: inFrame=0, outFrame=90 (spans 3.0s = 72 canonical frames >= 48) -> ALLOWED.
    Case 2: inFrame=0, outFrame=60 (60 raw frames >= 48 target frames, but spans only 0.5s = 12 canonical frames < 48)
            -> INSUFFICIENT_SOURCE_DURATION.
    """
    import subprocess
    from studio.render_manifest import (
        ClipTrim, RenderClip, RenderManifest, Transition, VideoTrack, VoiceTrack)
    from studio.manifest_integrity import VerifiedRenderSnapshot
    from studio.render_planner import RenderPlanError
    from studio.manifest_render_types import RenderFailureCode

    assets = tmp_path / "assets"
    assets.mkdir(exist_ok=True)

    # Concat fixture: 60 frames in 0.5s + 30 frames in 2.5s
    c1 = tmp_path / "c1.mp4"
    c2 = tmp_path / "c2.mp4"
    vfr_path = assets / "vfr_burst.mp4"
    subprocess.run(["ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=120",
                    "-t", "0.5", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(c1)], check=True, capture_output=True)
    subprocess.run(["ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=12",
                    "-t", "2.5", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(c2)], check=True, capture_output=True)
    subprocess.run(["ffmpeg", "-y", "-i", str(c1), "-i", str(c2),
                    "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]",
                    "-map", "[v]", "-vsync", "vfr", "-c:v", "libx264", str(vfr_path)], check=True, capture_output=True)

    def _plan_vfr(in_f, out_f, target_f):
        audio_name = f"audio_vfr_{target_f}.wav"
        _wav(tmp_path / audio_name, target_f / 24)
        clip = RenderClip(
            clipId="c_vfr", sceneId="s", shotId="sh1", sequenceIndex=1,
            startFrame=0, durationFrames=target_f, endFrame=target_f,
            timelineStartSeconds=0.0, durationSeconds=target_f / 24,
            assetId="a1", acceptedAssetVersion=1, checksum="ab" * 32,
            filePath="assets/vfr_burst.mp4", mediaType="VIDEO",
            fittingStrategy="FIT_PAD",
            trim=ClipTrim(inFrame=in_f, outFrame=out_f, speedFactor=1.0),
            transition=Transition(type="CUT", durationFrames=0))
        m = RenderManifest(projectId="p", videoTrack=VideoTrack(clips=[clip]),
                           voiceTrack=VoiceTrack(filePath=audio_name, checksum="e" * 64, durationFrames=target_f))
        snap = VerifiedRenderSnapshot(tmp_path, tmp_path, tmp_path / "m.json", m)
        return build_render_execution_plan(snap, EncoderProfileName.FINAL_QUALITY, tmp_path / f"sc_vfr_{target_f}_{in_f}_{out_f}")

    # Case 1: inFrame=0, outFrame=90 spans 3.0s -> 72 canonical frames >= 48 target -> ALLOWED
    assert _plan_vfr(0, 90, 48) is not None

    # Case 2: inFrame=0, outFrame=60 has 60 raw frames >= 48 target, BUT spans only 0.5s -> 12 canonical frames < 48
    # MUST raise INSUFFICIENT_SOURCE_DURATION
    with pytest.raises(RenderPlanError) as exc_info:
        _plan_vfr(0, 60, 48)
    assert exc_info.value.code == RenderFailureCode.INSUFFICIENT_SOURCE_DURATION
    assert "available 12 canonical frames" in str(exc_info.value)

