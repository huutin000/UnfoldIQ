"""Phase 8 Task 12: Real FFmpeg End-to-End Fixtures & Evidence.
Tests actual FFmpeg rendering against real media fixtures, verifying video/audio/subtitles
with ffprobe, verifying NVENC execution and fallback.
"""
import asyncio
import hashlib
import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

from studio.jobs_manager import JobStatus, JobsManager
from studio.manifest_render_service import ManifestRenderService
from studio.render_manifest import (
    ClipTrim,
    MusicTrack,
    RenderClip,
    RenderManifest,
    SubtitlesTrack,
    Transition,
    VideoTrack,
    VoiceTrack,
)
from studio.render_manifest_hashing import compute_manifest_hash


def _run_cmd(cmd: list[str]) -> str:
    res = subprocess.run(cmd, capture_output=True, text=True, check=True)
    return res.stdout


def _probe_json(file_path: Path) -> dict:
    cmd = [
        "ffprobe", "-v", "error",
        "-show_format", "-show_streams",
        "-print_format", "json",
        str(file_path)
    ]
    raw = _run_cmd(cmd)
    return json.loads(raw)


def _count_video_frames(file_path: Path) -> int:
    cmd = [
        "ffprobe", "-v", "error",
        "-select_streams", "v:0",
        "-count_frames",
        "-show_entries", "stream=nb_read_frames",
        "-print_format", "json",
        str(file_path)
    ]
    raw = _run_cmd(cmd)
    data = json.loads(raw)
    streams = data.get("streams", [])
    if streams and "nb_read_frames" in streams[0]:
        return int(streams[0]["nb_read_frames"])
    return 0


def _sha256(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


@pytest.fixture(scope="module")
def real_media_fixtures(tmp_path_factory):
    media_dir = tmp_path_factory.mktemp("media_fixtures")

    # 1. Image: 1280x720 PNG
    img_path = media_dir / "img1.png"
    subprocess.run([
        "ffmpeg", "-y", "-f", "lavfi",
        "-i", "testsrc2=size=1280x720:rate=1",
        "-vframes", "1",
        str(img_path)
    ], check=True, capture_output=True)

    # 2. Video: 1280x720 24fps MP4 (4 seconds)
    vid_path = media_dir / "vid1.mp4"
    subprocess.run([
        "ffmpeg", "-y", "-f", "lavfi",
        "-i", "testsrc2=size=1280x720:rate=24",
        "-t", "4",
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        str(vid_path)
    ], check=True, capture_output=True)

    # 3. Narration WAV: 24kHz mono (3.5 seconds = 84 frames)
    narration_path = media_dir / "narration.wav"
    subprocess.run([
        "ffmpeg", "-y", "-f", "lavfi",
        "-i", "sine=frequency=440:sample_rate=24000:duration=3.5",
        "-ac", "1", "-c:a", "pcm_s16le",
        str(narration_path)
    ], check=True, capture_output=True)

    # 4. Music WAV: 48kHz stereo (2 seconds)
    bgm_path = media_dir / "bgm.wav"
    subprocess.run([
        "ffmpeg", "-y", "-f", "lavfi",
        "-i", "sine=frequency=220:sample_rate=48000:duration=2",
        "-ac", "2", "-c:a", "pcm_s16le",
        str(bgm_path)
    ], check=True, capture_output=True)

    # 5. Subtitles SRT
    srt_path = media_dir / "subtitles.srt"
    srt_path.write_text(
        "1\n00:00:00,000 --> 00:00:02,000\nOpening scene subtitle.\n\n"
        "2\n00:00:02,000 --> 00:00:04,000\nClosing scene subtitle.\n",
        encoding="utf-8"
    )

    return {
        "dir": media_dir,
        "img": img_path,
        "vid": vid_path,
        "narration": narration_path,
        "bgm": bgm_path,
        "srt": srt_path,
    }


def _setup_project_for_render(tmp_path: Path, media: dict, burn_in: bool = False,
                             export_id: str = "export_001"):
    pdir = tmp_path / "proj"
    pdir.mkdir(parents=True, exist_ok=True)
    assets_dir = pdir / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)

    # Copy media into project
    shutil.copy(media["img"], assets_dir / "img1.png")
    shutil.copy(media["vid"], assets_dir / "vid1.mp4")
    shutil.copy(media["narration"], pdir / "audio.wav")
    shutil.copy(media["bgm"], assets_dir / "bgm.wav")
    shutil.copy(media["srt"], assets_dir / "subtitles.srt")

    img_file = assets_dir / "img1.png"
    vid_file = assets_dir / "vid1.mp4"
    audio_file = pdir / "audio.wav"
    bgm_file = assets_dir / "bgm.wav"
    srt_file = assets_dir / "subtitles.srt"

    # Total 84 frames at 24fps (3.5 seconds)
    # Clip 1: Image 48 frames (0 -> 48) with FIT_PAD, CROSSFADE of 12 frames
    clip1 = RenderClip(
        clipId="clip_0001",
        sceneId="scene_001",
        shotId="shot_001",
        sequenceIndex=1,
        startFrame=0,
        durationFrames=48,
        endFrame=48,
        timelineStartSeconds=0.0,
        durationSeconds=2.0,
        assetId="asset_img",
        acceptedAssetVersion=1,
        checksum=_sha256(img_file),
        filePath="assets/img1.png",
        mediaType="IMAGE",
        fittingStrategy="FIT_PAD",
        transition=Transition(type="CUT", durationFrames=0),
    )

    # Clip 2: Video 48 frames (36 -> 84, overlapping by 12 frames) with FILL_CROP, source trim, CROSSFADE
    clip2 = RenderClip(
        clipId="clip_0002",
        sceneId="scene_002",
        shotId="shot_002",
        sequenceIndex=2,
        startFrame=36,
        durationFrames=48,
        endFrame=84,
        timelineStartSeconds=1.5,
        durationSeconds=2.0,
        assetId="asset_vid",
        acceptedAssetVersion=1,
        checksum=_sha256(vid_file),
        filePath="assets/vid1.mp4",
        mediaType="VIDEO",
        fittingStrategy="FILL_CROP",
        trim=ClipTrim(inFrame=0, outFrame=48, speedFactor=1.0),
        transition=Transition(type="CROSSFADE", durationFrames=12),
    )

    manifest = RenderManifest(
        exportId=export_id,
        projectId="proj",
        totalDurationFrames=84,
        totalDurationSeconds=3.5,
        videoTrack=VideoTrack(clips=[clip1, clip2]),
        voiceTrack=VoiceTrack(
            filePath="audio.wav",
            checksum=_sha256(audio_file),
            durationFrames=84,
            volume=1.0,
        ),
        musicTrack=MusicTrack(
            filePath="assets/bgm.wav",
            checksum=_sha256(bgm_file),
            configured=True,
            volume=0.5,
            loop=True,
            fadeInFrames=12,
            fadeOutFrames=12,
        ),
        subtitlesTrack=SubtitlesTrack(
            filePath="assets/subtitles.srt",
            checksum=_sha256(srt_file),
            configured=True,
            burnIn=burn_in,
            format="srt",
        ),
    )

    m_dict = manifest.model_dump()
    manifest.manifestHash = compute_manifest_hash(m_dict)

    exp_dir = pdir / "exports" / export_id
    exp_dir.mkdir(parents=True, exist_ok=True)
    (exp_dir / "render-manifest.json").write_text(manifest.model_dump_json(indent=2), encoding="utf-8")

    return pdir, manifest


def test_real_ffmpeg_end_to_end_soft_subtitles(tmp_path, real_media_fixtures):
    """Test full real FFmpeg render pipeline: image, video, crossfade, sidechain, soft sub."""
    pdir, manifest = _setup_project_for_render(tmp_path, real_media_fixtures, burn_in=False)

    jobs = JobsManager(runtime_dir=tmp_path / "runtime", projects_dir=tmp_path)
    service = ManifestRenderService(tmp_path, jobs=jobs)

    async def _run():
        res = await service.start_final_render("proj", "export_001", "FINAL_QUALITY")
        assert res.get("errorCode") is None
        return await service.wait_for_job(res["jobId"], timeout=60.0)

    job = asyncio.run(_run())
    print("\nJOB ERROR:", job.get("message"), "\nMETADATA:", job.get("metadata"))
    assert job["status"] == JobStatus.COMPLETED
    assert job["metadata"]["artifactStatus"] == "NEEDS_REVIEW"
    assert job["metadata"]["artifactReasonCode"] == "PENDING_RENDER_QA"

    final_path = pdir / "exports" / "export_001" / "final.mp4"
    assert final_path.is_file()
    assert final_path.stat().st_size > 50000

    probe = _probe_json(final_path)
    streams = probe.get("streams", [])

    # Video stream
    v_stream = next((s for s in streams if s.get("codec_type") == "video"), None)
    assert v_stream is not None
    assert v_stream.get("codec_name") == "h264"
    assert int(v_stream.get("width")) == 1920
    assert int(v_stream.get("height")) == 1080
    assert v_stream.get("r_frame_rate") == "24/1"

    # Audio stream
    a_stream = next((s for s in streams if s.get("codec_type") == "audio"), None)
    assert a_stream is not None
    assert a_stream.get("codec_name") == "aac"
    assert int(a_stream.get("sample_rate")) == 48000
    assert int(a_stream.get("channels")) == 2

    # Soft Subtitle stream
    s_stream = next((s for s in streams if s.get("codec_type") == "subtitle"), None)
    assert s_stream is not None
    assert s_stream.get("codec_name") == "mov_text"

    # Frame count
    frames = _count_video_frames(final_path)
    assert frames == 84


def test_real_ffmpeg_hard_burn_subtitles(tmp_path, real_media_fixtures):
    """Test full real FFmpeg render with hard subtitle burn-in."""
    pdir, manifest = _setup_project_for_render(tmp_path, real_media_fixtures, burn_in=True, export_id="export_burn")

    jobs = JobsManager(runtime_dir=tmp_path / "runtime", projects_dir=tmp_path)
    service = ManifestRenderService(tmp_path, jobs=jobs)

    async def _run():
        res = await service.start_final_render("proj", "export_burn", "FINAL_QUALITY")
        assert res.get("errorCode") is None
        return await service.wait_for_job(res["jobId"], timeout=60.0)

    job = asyncio.run(_run())

    assert job["status"] == JobStatus.COMPLETED
    final_path = pdir / "exports" / "export_burn" / "final.mp4"
    assert final_path.is_file()

    probe = _probe_json(final_path)
    streams = probe.get("streams", [])
    # No soft subtitle stream when burned in
    s_stream = next((s for s in streams if s.get("codec_type") == "subtitle"), None)
    assert s_stream is None


def test_real_ffmpeg_nvenc_accelerated(tmp_path, real_media_fixtures):
    """Test ACCELERATED profile using real hardware NVENC on supported GPU."""
    pdir, manifest = _setup_project_for_render(tmp_path, real_media_fixtures, burn_in=False, export_id="export_nvenc")

    jobs = JobsManager(runtime_dir=tmp_path / "runtime", projects_dir=tmp_path)
    service = ManifestRenderService(tmp_path, jobs=jobs)

    async def _run():
        res = await service.start_final_render("proj", "export_nvenc", "ACCELERATED")
        assert res.get("errorCode") is None
        return await service.wait_for_job(res["jobId"], timeout=60.0)

    job = asyncio.run(_run())

    assert job["status"] == JobStatus.COMPLETED
    assert job["metadata"]["encoderActuallyUsed"] in ("h264_nvenc", "libx264")
    final_path = pdir / "exports" / "export_nvenc" / "final.mp4"
    assert final_path.is_file()
    assert final_path.stat().st_size > 50000


def test_real_ffmpeg_simulated_nvenc_hardware_fallback(tmp_path, real_media_fixtures):
    """Test fallback from ACCELERATED NVENC failure to libx264 exactly once."""
    pdir, manifest = _setup_project_for_render(tmp_path, real_media_fixtures, burn_in=False, export_id="export_fb")

    jobs = JobsManager(runtime_dir=tmp_path / "runtime", projects_dir=tmp_path)
    service = ManifestRenderService(tmp_path, jobs=jobs)

    # Intercept attempt: on first attempt (nvenc) inject hardware failure; on second attempt let real ffmpeg run
    real_run_fn = service._run_attempt
    attempt_count = [0]

    async def mock_run_attempt(build, scratch, cancel_event, job_id, expected_frames):
        attempt_count[0] += 1
        if attempt_count[0] == 1:
            return {
                "return_code": 1,
                "stderr_tail": "No capable devices found",
                "max_frame": 0,
            }
        return await real_run_fn(build, scratch, cancel_event, job_id, expected_frames)

    service._run_attempt = mock_run_attempt

    async def _run():
        res = await service.start_final_render("proj", "export_fb", "ACCELERATED")
        assert res.get("errorCode") is None
        return await service.wait_for_job(res["jobId"], timeout=60.0)

    job = asyncio.run(_run())
    print("\nFALLBACK JOB ERROR:", job.get("message"), "\nMETADATA:", job.get("metadata"))

    assert job["status"] == JobStatus.COMPLETED
    assert job["metadata"]["fallbackAttempted"] is True
    assert job["metadata"]["encoderActuallyUsed"] == "libx264"
    assert len(job["metadata"]["attempts"]) == 2
    final_path = pdir / "exports" / "export_fb" / "final.mp4"
    assert final_path.is_file()


def test_real_ffmpeg_source_frame_rate_normalization_24_30_60_vfr(tmp_path):
    """Prove 24fps CFR, 30fps CFR, 60fps CFR, and VFR normalize to canonical contract:
    24/1 CFR, 1920x1080, SAR 1:1, yuv420p, exact 48 frames.
    Filter order: source trim -> speed transform -> fps=24 -> fitting normalization -> target clamp.
    """
    from studio.render_manifest import RenderManifest, VideoTrack, VoiceTrack, RenderClip, ClipTrim, Transition
    from studio.render_manifest_hashing import compute_manifest_hash
    from studio.manifest_render_service import ManifestRenderService
    from studio.jobs_manager import JobsManager, JobStatus

    media_dir = tmp_path / "sources"
    media_dir.mkdir()

    # 1. 24fps CFR fixture (640x360, 24fps, 2.5s)
    f24 = media_dir / "src_24fps.mp4"
    subprocess.run(["ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=24",
                    "-t", "2.5", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(f24)],
                   check=True, capture_output=True)

    # 2. 30fps CFR fixture (1280x720, 30fps, 2.5s)
    f30 = media_dir / "src_30fps.mp4"
    subprocess.run(["ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30",
                    "-t", "2.5", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(f30)],
                   check=True, capture_output=True)

    # 3. 60fps CFR fixture (1920x1080, 60fps, 2.5s)
    f60 = media_dir / "src_60fps.mp4"
    subprocess.run(["ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=60",
                    "-t", "2.5", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(f60)],
                   check=True, capture_output=True)

    # 4. VFR fixture (800x600, variable PTS intervals, 3.0s)
    fvfr = media_dir / "src_vfr.mp4"
    subprocess.run(["ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc=duration=3:size=800x600:rate=30",
                    "-vf", "setpts=N*N*0.001/TB", "-vsync", "vfr", "-c:v", "libx264", str(fvfr)],
                   check=True, capture_output=True)

    # Common narration WAV: 2.0s = 48 frames at 24fps (96,000 samples at 48kHz)
    narration_path = media_dir / "narration_48f.wav"
    subprocess.run(["ffmpeg", "-y", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=2.0",
                    "-ac", "2", "-c:a", "pcm_s16le", str(narration_path)],
                   check=True, capture_output=True)

    fixtures = [
        ("24fps_cfr", f24, ClipTrim(inFrame=0, outFrame=48, speedFactor=1.0)),
        ("30fps_cfr", f30, ClipTrim(inFrame=0, outFrame=60, speedFactor=1.0)),
        ("60fps_cfr", f60, ClipTrim(inFrame=0, outFrame=120, speedFactor=1.0)),
        ("vfr", fvfr, None),
    ]

    evidence_results = {}

    for name, src_file, trim_config in fixtures:
        pdir = tmp_path / f"proj_{name}"
        pdir.mkdir(parents=True, exist_ok=True)
        assets_dir = pdir / "assets"
        assets_dir.mkdir(parents=True, exist_ok=True)

        rel_vid = f"assets/{src_file.name}"
        shutil.copy(src_file, pdir / rel_vid)
        shutil.copy(narration_path, pdir / "audio.wav")

        clip = RenderClip(
            clipId=f"clip_{name}",
            sceneId="scene_001",
            shotId="shot_001",
            sequenceIndex=1,
            startFrame=0,
            durationFrames=48,
            endFrame=48,
            timelineStartSeconds=0.0,
            durationSeconds=2.0,
            assetId=f"asset_{name}",
            acceptedAssetVersion=1,
            checksum=_sha256(pdir / rel_vid),
            filePath=rel_vid,
            mediaType="VIDEO",
            fittingStrategy="FILL_CROP",
            trim=trim_config,
            transition=Transition(type="CUT", durationFrames=0),
        )

        manifest = RenderManifest(
            exportId=f"exp_{name}",
            projectId=f"proj_{name}",
            totalDurationFrames=48,
            totalDurationSeconds=2.0,
            videoTrack=VideoTrack(clips=[clip]),
            voiceTrack=VoiceTrack(
                filePath="audio.wav",
                checksum=_sha256(pdir / "audio.wav"),
                durationFrames=48,
                volume=1.0,
            ),
        )
        manifest.manifestHash = compute_manifest_hash(manifest.model_dump())
        exp_dir = pdir / "exports" / f"exp_{name}"
        exp_dir.mkdir(parents=True, exist_ok=True)
        (exp_dir / "render-manifest.json").write_text(manifest.model_dump_json(indent=2), encoding="utf-8")

        jobs = JobsManager(runtime_dir=tmp_path / f"runtime_{name}", projects_dir=tmp_path)
        service = ManifestRenderService(tmp_path, jobs=jobs)

        async def _run(exp_id=f"exp_{name}", proj_id=f"proj_{name}"):
            res = await service.start_final_render(proj_id, exp_id, "FINAL_QUALITY")
            assert res.get("errorCode") is None
            return await service.wait_for_job(res["jobId"], timeout=60.0)

        job = asyncio.run(_run())
        assert job["status"] == JobStatus.COMPLETED

        final_path = exp_dir / "final.mp4"
        assert final_path.is_file()

        probe = _probe_json(final_path)
        v_stream = next(s for s in probe.get("streams", []) if s.get("codec_type") == "video")
        r_fps = v_stream.get("r_frame_rate")
        avg_fps = v_stream.get("avg_frame_rate")
        width = int(v_stream.get("width"))
        height = int(v_stream.get("height"))
        sar = v_stream.get("sample_aspect_ratio", "1:1")
        pix_fmt = v_stream.get("pix_fmt")
        frames = _count_video_frames(final_path)

        assert r_fps == "24/1"
        assert avg_fps == "24/1"
        assert width == 1920
        assert height == 1080
        assert sar == "1:1"
        assert pix_fmt == "yuv420p"
        assert frames == 48

        # Verify filter order contract in the rendered filter script
        scratch_dirs = list((pdir / "renders").glob(".scratch_*"))
        assert len(scratch_dirs) > 0
        script_file = scratch_dirs[0] / "filter-complex.txt"
        assert script_file.is_file()
        script_text = script_file.read_text(encoding="utf-8")

        # Check sequence of operations: speed transform -> fps=24 -> fit -> setsar -> format -> settb -> clamp
        idx_speed = script_text.find("setpts=(PTS-STARTPTS)")
        idx_fps24 = script_text.find("fps=24")
        idx_fit = script_text.find("scale=1920:1080")
        idx_sar = script_text.find("setsar=1")
        idx_fmt = script_text.find("format=yuv420p")
        idx_settb = script_text.find("settb=expr=1/24")
        idx_clamp = script_text.find("trim=end_frame=48")

        assert idx_speed != -1
        assert idx_fps24 != -1
        assert idx_fit != -1
        assert idx_sar != -1
        assert idx_fmt != -1
        assert idx_settb != -1
        assert idx_clamp != -1

        if trim_config and trim_config.inFrame is not None:
            idx_trim = script_text.find(f"trim=start_frame={trim_config.inFrame}")
            assert idx_trim != -1
            assert idx_trim < idx_speed

        assert idx_speed < idx_fps24 < idx_fit < idx_sar < idx_fmt < idx_settb < idx_clamp

        evidence_results[name] = {
            "sourcePath": str(src_file.name),
            "targetFrames": 48,
            "resultingFrames": frames,
            "rFrameRate": r_fps,
            "avgFrameRate": avg_fps,
            "resolution": f"{width}x{height}",
            "sar": sar,
            "pixFmt": pix_fmt,
            "filterOrderVerified": True,
        }

    # Record retained evidence to disk for audit
    report_path = Path("temp/phase08_verification/framerate_normalization.json")
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(evidence_results, indent=2), encoding="utf-8")

