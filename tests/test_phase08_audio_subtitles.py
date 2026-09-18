"""Phase 8 Task 5: audio duration/sidechain + subtitle mapping tests."""
import wave

import pytest

from studio.ffmpeg_graph_builder import build_ffmpeg_execution
from studio.manifest_render_types import EncoderProfileName
from studio.render_planner import build_render_execution_plan


def _wav(p, seconds=8.0, rate=24000, channels=1):
    import pathlib
    p = pathlib.Path(p)
    with wave.open(str(p), "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"\x00" * int(rate * seconds) * channels * 2)


def _base_clips():
    from studio.render_manifest import RenderClip, Transition
    return [RenderClip(
        clipId="clip_0001", sceneId="s", shotId="sh1", sequenceIndex=1,
        startFrame=0, durationFrames=192, endFrame=192,
        timelineStartSeconds=0.0, durationSeconds=8.0,
        assetId="a1", acceptedAssetVersion=1, checksum="ab" * 32,
        filePath="assets/a.png", mediaType="IMAGE",
        transition=Transition(type="CUT", durationFrames=0))]


def _plan(tmp_path, music=None, subtitles=None, scratch="sc5"):
    from studio.render_manifest import (
        MusicTrack, RenderManifest, SubtitlesTrack, VideoTrack, VoiceTrack)
    from studio.manifest_integrity import VerifiedRenderSnapshot
    (tmp_path / "assets").mkdir(exist_ok=True)
    (tmp_path / "assets" / "a.png").write_bytes(b"\x89PNG" + b"\x00" * 64)
    _wav(tmp_path / "audio.wav", 8.0)
    voice = VoiceTrack(filePath="audio.wav", checksum="e" * 64, durationFrames=192)
    m_kwargs = {}
    if music is not None:
        (tmp_path / "assets" / "m.wav").write_bytes(b"RIFF" + b"\x00" * 200)
        _wav(tmp_path / "assets" / "m.wav", 8.0)
        m_kwargs["musicTrack"] = MusicTrack(
            filePath="assets/m.wav", checksum="f" * 64, configured=True,
            volume=music.get("volume", 0.5), loop=music.get("loop", True),
            fadeInFrames=music.get("fadeInFrames", 0),
            fadeOutFrames=music.get("fadeOutFrames", 0))
    if subtitles is not None:
        (tmp_path / "assets" / "s.srt").write_text(
            "1\n00:00:00,000 --> 00:00:02,000\nHello\n", encoding="utf-8")
        m_kwargs["subtitlesTrack"] = SubtitlesTrack(
            filePath="assets/s.srt", checksum="g" * 64, configured=True,
            burnIn=subtitles.get("burnIn", False),
            format=subtitles.get("format", "srt"),
            fontName=subtitles.get("fontName"),
            fontSize=subtitles.get("fontSize"),
            bottomOffsetPx=subtitles.get("bottomOffsetPx"))
    m = RenderManifest(projectId="p", videoTrack=VideoTrack(clips=_base_clips()),
                       voiceTrack=voice, **m_kwargs)
    snap = VerifiedRenderSnapshot(tmp_path, tmp_path, tmp_path / "m.json", m)
    scratch_d = tmp_path / scratch
    scratch_d.mkdir(exist_ok=True)
    plan = build_render_execution_plan(snap, EncoderProfileName.FINAL_QUALITY, scratch_d)
    return plan


@pytest.fixture
def audio_plan(tmp_path):
    return _plan(tmp_path)


@pytest.fixture
def music_plan(tmp_path):
    return _plan(tmp_path, music={"volume": 0.5, "loop": True,
                                  "fadeInFrames": 24, "fadeOutFrames": 48})


@pytest.fixture
def narration_only_plan(tmp_path):
    return _plan(tmp_path)


@pytest.fixture
def soft_subtitle_plan(tmp_path):
    return _plan(tmp_path, subtitles={"burnIn": False})


@pytest.fixture
def hard_subtitle_plan(tmp_path):
    return _plan(tmp_path, subtitles={"burnIn": True})


def test_target_audio_samples_is_exact(audio_plan):
    build = build_ffmpeg_execution(audio_plan)
    assert f"end_sample={audio_plan.expected_final_frames * 2000}" in build.filter_script_text


def test_no_loudnorm_in_product_render_graph(music_plan, narration_only_plan):
    for plan in (music_plan, narration_only_plan):
        build = build_ffmpeg_execution(plan)
        assert "loudnorm" not in build.filter_script_text
        # Ensure loudnorm is not an ffmpeg filter argument
        assert not any("loudnorm" in arg.lower() and not arg.endswith(".mp4") and not ("\\" in arg or "/" in arg)
                       for arg in build.argv)


def test_sidechain_compresses_music_not_voice(music_plan):
    graph = build_ffmpeg_execution(music_plan).filter_script_text
    assert "asplit=2" in graph
    assert "sidechaincompress" in graph
    # sidechaincompress affects BGM path: [music_pre][side]sidechaincompress=...[music_duck]
    assert "[music_pre][side]sidechaincompress=" in graph
    # narration direct path remains intact: [voice] goes directly to amix, NOT compressed
    assert "[voice][music_duck]amix=" in graph
    assert "amix=inputs=2:duration=first" in graph
    assert "dropout_transition=0" in graph
    assert "normalize=0" in graph
    assert "loudnorm" not in graph


def test_no_bgm_is_valid(narration_only_plan):
    graph = build_ffmpeg_execution(narration_only_plan).filter_script_text
    assert "sidechaincompress" not in graph
    assert "[aout]" in graph


def test_soft_subtitle_maps_mov_text(soft_subtitle_plan):
    build = build_ffmpeg_execution(soft_subtitle_plan)
    assert "-c:s" in build.argv
    assert "mov_text" in build.argv
    assert "subtitles=" not in build.filter_script_text


def test_hard_subtitle_burns_and_does_not_mux_duplicate_soft_stream(hard_subtitle_plan):
    build = build_ffmpeg_execution(hard_subtitle_plan)
    assert "subtitles=" in build.filter_script_text
    assert "mov_text" not in build.argv


def test_music_fade_filters_present(music_plan):
    graph = build_ffmpeg_execution(music_plan).filter_script_text
    assert "afade=" in graph


def test_music_loop_trims_to_target(music_plan):
    build = build_ffmpeg_execution(music_plan)
    assert "-stream_loop" in build.argv or "aloop=" in build.filter_script_text


def test_ducking_preset_behaves_deterministically(tmp_path):
    """Real FFmpeg: voice passes through, music ducks under voice, recovers after."""
    import subprocess
    from studio.encoder_probe import _ffmpeg
    ff = _ffmpeg()
    work = tmp_path / "duck"
    work.mkdir()
    voice = work / "voice.wav"
    music = work / "music.wav"
    # voice: 1s tone, 1s silence, 1s tone (pause lets music recover)
    subprocess.run([ff, "-y", "-f", "lavfi", "-i",
                    "sine=frequency=440:duration=1",
                    "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo:d=1",
                    "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
                    "-filter_complex", "[0:a][1:a][2:a]concat=n=3:v=0:a=1",
                    str(voice)], capture_output=True, check=True)
    subprocess.run([ff, "-y", "-f", "lavfi", "-i",
                    "sine=frequency=880:duration=3", str(music)],
                   capture_output=True, check=True)
    from studio.ffmpeg_graph_builder import _duck_params
    out = work / "mixed.wav"
    graph = (f"[0:a]aresample=48000,aformat=channel_layouts=stereo,asplit=2[voice][side];"
             f"[1:a]aresample=48000,aformat=channel_layouts=stereo[music_pre];"
             f"[music_pre][side]sidechaincompress={_duck_params()}[music_duck];"
             f"[voice][music_duck]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]")
    r = subprocess.run([ff, "-y", "-i", str(voice), "-i", str(music),
                        "-filter_complex", graph, "-map", "[aout]", str(out)],
                       capture_output=True, text=True)
    assert r.returncode == 0, r.stderr[-800:]
    assert out.stat().st_size > 0

    def section_level(path, start, dur):
        rr = subprocess.run(
            [ff, "-ss", str(start), "-t", str(dur), "-i", str(path),
             "-af", "volumedetect", "-f", "null", "-"],
            capture_output=True, text=True)
        import re
        m = re.search(r"mean_volume:\s*(-?[\d.]+)\s*dB", rr.stderr)
        assert m, rr.stderr[-500:]
        return float(m.group(1))

    # control mix without sidechain: same voice + full-level music
    plain = work / "plain.wav"
    plain_graph = (f"[0:a]aresample=48000,aformat=channel_layouts=stereo[voice];"
                   f"[1:a]aresample=48000,aformat=channel_layouts=stereo[music_pre];"
                   f"[voice][music_pre]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]")
    r = subprocess.run([ff, "-y", "-i", str(voice), "-i", str(music),
                        "-filter_complex", plain_graph, "-map", "[aout]", str(plain)],
                       capture_output=True, text=True)
    assert r.returncode == 0, r.stderr[-800:]
    ducked_voiced = section_level(out, 0.2, 0.6)
    plain_voiced = section_level(plain, 0.2, 0.6)
    ducked_pause = section_level(out, 1.2, 0.6)
    plain_pause = section_level(plain, 1.2, 0.6)
    # music is attenuated under voice, and recovers in the pause
    assert ducked_voiced < plain_voiced, (ducked_voiced, plain_voiced)
    assert abs(ducked_pause - plain_pause) < 1.0, (ducked_pause, plain_pause)


def test_subtitle_font_name_font_size_and_bottom_offset_honored(tmp_path):
    plan = _plan(tmp_path, subtitles={
        "burnIn": True,
        "fontName": "Arial",
        "fontSize": 32,
        "bottomOffsetPx": 45,
    }, scratch="sc_sub_style")
    build = build_ffmpeg_execution(plan)
    assert ":force_style='FontName=arial,FontSize=32,MarginV=45'" in build.filter_script_text
    assert "-c:s" not in build.argv
    assert "mov_text" not in build.argv


def test_missing_requested_font_raises_subtitle_font_unavailable(tmp_path):
    from studio.ffmpeg_graph_builder import GraphBuildError
    from studio.manifest_render_types import RenderFailureCode
    plan = _plan(tmp_path, subtitles={
        "burnIn": True,
        "fontName": "NonExistentFontTotallyMissing12345",
    }, scratch="sc_sub_missing")
    with pytest.raises(GraphBuildError) as exc_info:
        build_ffmpeg_execution(plan)
    assert exc_info.value.code == RenderFailureCode.SUBTITLE_FONT_UNAVAILABLE
    assert "not available" in str(exc_info.value)


def test_audio_duration_exact_match(tmp_path):
    plan = _plan(tmp_path, scratch="sc_exact")
    build = build_ffmpeg_execution(plan)
    assert "end_sample=384000" in build.filter_script_text


def test_audio_duration_short_by_within_tolerance_pads_silence(tmp_path):
    wav_path = tmp_path / "audio_short.wav"
    with wave.open(str(wav_path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(24000)
        w.writeframes(b"\x00" * (192 * 1000 - 500) * 2)
    from studio.render_manifest import RenderManifest, VideoTrack, VoiceTrack
    from studio.manifest_integrity import VerifiedRenderSnapshot
    (tmp_path / "assets").mkdir(exist_ok=True)
    (tmp_path / "assets" / "a.png").write_bytes(b"\x89PNG" + b"\x00" * 64)
    m = RenderManifest(
        projectId="p",
        videoTrack=VideoTrack(clips=_base_clips()),
        voiceTrack=VoiceTrack(filePath="audio_short.wav", checksum="e" * 64, durationFrames=192)
    )
    snap = VerifiedRenderSnapshot(tmp_path, tmp_path, tmp_path / "m.json", m)
    scratch = tmp_path / "sc_short"
    scratch.mkdir(exist_ok=True)
    plan = build_render_execution_plan(snap, EncoderProfileName.FINAL_QUALITY, scratch)
    build = build_ffmpeg_execution(plan)
    assert "apad" in build.filter_script_text
    assert "end_sample=384000" in build.filter_script_text


def test_audio_duration_long_by_within_tolerance_trims_tail(tmp_path):
    wav_path = tmp_path / "audio_long.wav"
    with wave.open(str(wav_path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(24000)
        w.writeframes(b"\x00" * (192 * 1000 + 500) * 2)
    from studio.render_manifest import RenderManifest, VideoTrack, VoiceTrack
    from studio.manifest_integrity import VerifiedRenderSnapshot
    (tmp_path / "assets").mkdir(exist_ok=True)
    (tmp_path / "assets" / "a.png").write_bytes(b"\x89PNG" + b"\x00" * 64)
    m = RenderManifest(
        projectId="p",
        videoTrack=VideoTrack(clips=_base_clips()),
        voiceTrack=VoiceTrack(filePath="audio_long.wav", checksum="e" * 64, durationFrames=192)
    )
    snap = VerifiedRenderSnapshot(tmp_path, tmp_path, tmp_path / "m.json", m)
    scratch = tmp_path / "sc_long"
    scratch.mkdir(exist_ok=True)
    plan = build_render_execution_plan(snap, EncoderProfileName.FINAL_QUALITY, scratch)
    build = build_ffmpeg_execution(plan)
    assert "atrim=end_sample=384000" in build.filter_script_text


def test_audio_duration_mismatch_exceeding_tolerance_fails(tmp_path):
    from studio.render_planner import RenderPlanError
    from studio.manifest_render_types import RenderFailureCode
    wav_path = tmp_path / "audio_bad.wav"
    with wave.open(str(wav_path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(24000)
        w.writeframes(b"\x00" * (192 * 1000 + 3000) * 2)
    from studio.render_manifest import RenderManifest, VideoTrack, VoiceTrack
    from studio.manifest_integrity import VerifiedRenderSnapshot
    (tmp_path / "assets").mkdir(exist_ok=True)
    (tmp_path / "assets" / "a.png").write_bytes(b"\x89PNG" + b"\x00" * 64)
    m = RenderManifest(
        projectId="p",
        videoTrack=VideoTrack(clips=_base_clips()),
        voiceTrack=VoiceTrack(filePath="audio_bad.wav", checksum="e" * 64, durationFrames=192)
    )
    snap = VerifiedRenderSnapshot(tmp_path, tmp_path, tmp_path / "m.json", m)
    scratch = tmp_path / "sc_bad"
    scratch.mkdir(exist_ok=True)
    with pytest.raises(RenderPlanError) as exc_info:
        build_render_execution_plan(snap, EncoderProfileName.FINAL_QUALITY, scratch)
    assert exc_info.value.code == RenderFailureCode.AUDIO_DURATION_MISMATCH


def test_bgm_loop_false_semantics(tmp_path):
    plan = _plan(tmp_path, music={"volume": 0.5, "loop": False}, scratch="sc_bgm_noloop")
    build = build_ffmpeg_execution(plan)
    assert "-stream_loop" not in build.argv
    assert "apad,atrim=end_sample=384000" in build.filter_script_text
    assert "amix=inputs=2:duration=first" in build.filter_script_text
    assert "atrim=end_sample=384000,asetpts=PTS-STARTPTS[aout]" in build.filter_script_text


def test_bgm_loop_true_semantics(tmp_path):
    """loop = True: BGM actually loops (-stream_loop -1), extends past target internally, trims to exact canonical target duration, cannot extend Final duration."""
    plan = _plan(tmp_path, music={"volume": 0.5, "loop": True}, scratch="sc_bgm_loop")
    build = build_ffmpeg_execution(plan)
    # 1. -stream_loop -1 is passed to input options before music file
    assert "-stream_loop" in build.argv
    assert "-1" in build.argv
    loop_idx = build.argv.index("-stream_loop")
    assert build.argv[loop_idx + 1] == "-1"
    # 2. music_pre trims looped stream to exact target_samples
    assert "atrim=end_sample=384000,asetpts=PTS-STARTPTS" in build.filter_script_text
    # 3. amix duration=first locks duration to narration
    assert "amix=inputs=2:duration=first" in build.filter_script_text
    # 4. final mix clamps to exact target_samples so looping cannot extend Final duration
    assert "[amixed]atrim=end_sample=384000,asetpts=PTS-STARTPTS[aout]" in build.filter_script_text

    # Real FFmpeg test: 1.0s music looped over 3.0s narration
    import json
    import subprocess
    from studio.encoder_probe import _ffmpeg
    ff = _ffmpeg()
    work = tmp_path / "bgm_loop_real"
    work.mkdir()
    nar = work / "narration.wav"
    music = work / "music.wav"
    subprocess.run([ff, "-y", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=3",
                    "-ac", "2", "-c:a", "pcm_s16le", str(nar)], check=True, capture_output=True)
    subprocess.run([ff, "-y", "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=48000:duration=1",
                    "-ac", "2", "-c:a", "pcm_s16le", str(music)], check=True, capture_output=True)

    from studio.ffmpeg_graph_builder import _duck_params
    out_wav = work / "out.wav"
    # Filter graph exactly as constructed for loop=True
    graph = (
        "[0:a]volume=1.0,aresample=48000,aformat=channel_layouts=stereo,apad,atrim=end_sample=144000,asetpts=PTS-STARTPTS,asplit=2[voice][side];"
        f"[1:a]volume=0.5,aresample=48000,aformat=channel_layouts=stereo,atrim=end_sample=144000,asetpts=PTS-STARTPTS[music_pre];"
        f"[music_pre][side]sidechaincompress={_duck_params()}[music_duck];"
        "[voice][music_duck]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[amixed];"
        "[amixed]atrim=end_sample=144000,asetpts=PTS-STARTPTS[aout]"
    )
    cmd = [ff, "-y", "-i", str(nar), "-stream_loop", "-1", "-i", str(music),
           "-filter_complex", graph, "-map", "[aout]", "-c:a", "pcm_s16le", str(out_wav)]
    subprocess.run(cmd, check=True, capture_output=True)

    # Probe resulting audio
    probe_cmd = ["ffprobe", "-v", "error", "-show_streams", "-of", "json", str(out_wav)]
    probe = json.loads(subprocess.run(probe_cmd, check=True, capture_output=True).stdout)
    st = probe["streams"][0]
    dur = float(st["duration"])
    # Exact 3.0s duration (144,000 samples at 48kHz)
    assert abs(dur - 3.0) < 0.01
    assert int(st["duration_ts"]) == 144000


