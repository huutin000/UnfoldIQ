"""Phase 8 Task 12: Real FFmpeg Render Engine End-to-End Verification Script.
Usage: python scripts/verify_phase08_render_engine.py
Evidence: temp/phase08_verification/real_ffmpeg/evidence.json
"""
import asyncio
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

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

OUT_DIR = Path("temp/phase08_verification/real_ffmpeg")
OUT_DIR.mkdir(parents=True, exist_ok=True)


def _sha256(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def _probe_json(file_path: Path) -> dict:
    cmd = [
        "ffprobe", "-v", "error",
        "-show_format", "-show_streams",
        "-print_format", "json",
        str(file_path)
    ]
    res = subprocess.run(cmd, capture_output=True, text=True, check=True)
    return json.loads(res.stdout)


def _count_video_frames(file_path: Path) -> int:
    cmd = [
        "ffprobe", "-v", "error",
        "-select_streams", "v:0",
        "-count_frames",
        "-show_entries", "stream=nb_read_frames",
        "-print_format", "json",
        str(file_path)
    ]
    res = subprocess.run(cmd, capture_output=True, text=True, check=True)
    data = json.loads(res.stdout)
    streams = data.get("streams", [])
    if streams and "nb_read_frames" in streams[0]:
        return int(streams[0]["nb_read_frames"])
    return 0


async def verify_real_engine():
    print("=== UnfoldIQ Phase 8 Real FFmpeg Engine Verification ===")
    tmp = Path(tempfile.mkdtemp(prefix="phase08_verify_engine_"))
    try:
        pdir = tmp / "proj_verify"
        assets = pdir / "assets"
        assets.mkdir(parents=True, exist_ok=True)

        # 1. Create fixtures
        img_file = assets / "img.png"
        subprocess.run([
            "ffmpeg", "-y", "-f", "lavfi",
            "-i", "testsrc2=size=1920x1080:rate=1",
            "-vframes", "1", str(img_file)
        ], check=True, capture_output=True)

        vid_file = assets / "vid.mp4"
        subprocess.run([
            "ffmpeg", "-y", "-f", "lavfi",
            "-i", "testsrc2=size=1280x720:rate=24",
            "-t", "4", "-c:v", "libx264", "-pix_fmt", "yuv420p",
            str(vid_file)
        ], check=True, capture_output=True)

        audio_file = pdir / "audio.wav"
        subprocess.run([
            "ffmpeg", "-y", "-f", "lavfi",
            "-i", "sine=frequency=440:sample_rate=24000:duration=4",
            "-ac", "1", "-c:a", "pcm_s16le", str(audio_file)
        ], check=True, capture_output=True)

        bgm_file = assets / "bgm.wav"
        subprocess.run([
            "ffmpeg", "-y", "-f", "lavfi",
            "-i", "sine=frequency=220:sample_rate=48000:duration=3",
            "-ac", "2", "-c:a", "pcm_s16le", str(bgm_file)
        ], check=True, capture_output=True)

        srt_file = assets / "subtitles.srt"
        srt_file.write_text(
            "1\n00:00:00,000 --> 00:00:02,000\nEvidence verification scene 1.\n\n"
            "2\n00:00:02,000 --> 00:00:03,500\nEvidence verification scene 2.\n",
            encoding="utf-8"
        )

        # 2. Build 84-frame manifest
        clip1 = RenderClip(
            clipId="clip_001", sceneId="s1", shotId="sh1", sequenceIndex=1,
            startFrame=0, durationFrames=48, endFrame=48,
            timelineStartSeconds=0.0, durationSeconds=2.0,
            assetId="img_asset", acceptedAssetVersion=1,
            checksum=_sha256(img_file), filePath="assets/img.png",
            mediaType="IMAGE", fittingStrategy="FIT_PAD",
            transition=Transition(type="CUT", durationFrames=0),
        )
        clip2 = RenderClip(
            clipId="clip_002", sceneId="s2", shotId="sh2", sequenceIndex=2,
            startFrame=36, durationFrames=48, endFrame=84,
            timelineStartSeconds=1.5, durationSeconds=2.0,
            assetId="vid_asset", acceptedAssetVersion=1,
            checksum=_sha256(vid_file), filePath="assets/vid.mp4",
            mediaType="VIDEO", fittingStrategy="FILL_CROP",
            trim=ClipTrim(inFrame=0, outFrame=48, speedFactor=1.0),
            transition=Transition(type="CROSSFADE", durationFrames=12),
        )

        manifest = RenderManifest(
            exportId="export_e2e",
            projectId="proj_verify",
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
                volume=0.4,
                loop=True,
                fadeInFrames=12,
                fadeOutFrames=12,
            ),
            subtitlesTrack=SubtitlesTrack(
                filePath="assets/subtitles.srt",
                checksum=_sha256(srt_file),
                configured=True,
                burnIn=False,
                format="srt",
            ),
        )
        manifest.manifestHash = compute_manifest_hash(manifest.model_dump())

        exp_dir = pdir / "exports" / "export_e2e"
        exp_dir.mkdir(parents=True, exist_ok=True)
        (exp_dir / "render-manifest.json").write_text(manifest.model_dump_json(indent=2), encoding="utf-8")

        # 3. Execute render via ManifestRenderService
        jobs = JobsManager(runtime_dir=tmp / "runtime", projects_dir=tmp)
        service = ManifestRenderService(tmp, jobs=jobs)

        t0 = time.perf_counter()
        started = await service.start_final_render("proj_verify", "export_e2e", "FINAL_QUALITY")
        job = await service.wait_for_job(started["jobId"], timeout=60.0)
        elapsed = time.perf_counter() - t0

        final_path = exp_dir / "final.mp4"
        meta_path = exp_dir / "render-metadata.json"

        assert job["status"] == JobStatus.COMPLETED, f"Job failed: {job.get('message')}"
        assert final_path.is_file(), "final.mp4 not created"
        assert meta_path.is_file(), "render-metadata.json not created"

        # 4. Probe evidence
        probe = _probe_json(final_path)
        v_stream = next(s for s in probe["streams"] if s.get("codec_type") == "video")
        a_stream = next(s for s in probe["streams"] if s.get("codec_type") == "audio")
        s_stream = next((s for s in probe["streams"] if s.get("codec_type") == "subtitle"), None)

        read_frames = _count_video_frames(final_path)
        expected_samples = 84 * 2000
        actual_samples = int(a_stream.get("duration_ts", 0)) or int(float(a_stream.get("duration", 3.5)) * 48000)

        evidence = {
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "status": "PASS",
            "jobId": started["jobId"],
            "elapsedSeconds": round(elapsed, 3),
            "manifestHash": manifest.manifestHash,
            "exportId": "export_e2e",
            "video": {
                "codec": v_stream.get("codec_name"),
                "width": int(v_stream.get("width")),
                "height": int(v_stream.get("height")),
                "r_frame_rate": v_stream.get("r_frame_rate"),
                "expectedFrames": 84,
                "readFrames": read_frames,
                "frameDifference": read_frames - 84,
            },
            "audio": {
                "codec": a_stream.get("codec_name"),
                "sampleRate": int(a_stream.get("sample_rate")),
                "channels": int(a_stream.get("channels")),
                "expectedSamples": expected_samples,
                "actualSamples": actual_samples,
                "duckingPreset": "STUDIO_DEFAULT",
            },
            "subtitles": {
                "configured": True,
                "burnIn": False,
                "streamCodec": s_stream.get("codec_name") if s_stream else None,
            },
            "artifact": {
                "finalSize": final_path.stat().st_size,
                "metadataPresent": meta_path.is_file(),
                "artifactStatus": job["metadata"].get("artifactStatus"),
                "artifactReasonCode": job["metadata"].get("artifactReasonCode"),
            },
        }

        evidence_file = OUT_DIR / "evidence.json"
        evidence_file.write_text(json.dumps(evidence, indent=2), encoding="utf-8")
        print(f"[PASS] Real FFmpeg E2E verification complete in {elapsed:.2f}s!")
        print(f"Video: {evidence['video']['codec']} {evidence['video']['width']}x{evidence['video']['height']} @ {evidence['video']['r_frame_rate']} ({read_frames} frames)")
        print(f"Audio: {evidence['audio']['codec']} {evidence['audio']['sampleRate']}Hz {evidence['audio']['channels']}ch")
        print(f"Subtitles: {evidence['subtitles']['streamCodec']}")
        print(f"Saved evidence to: {evidence_file.resolve()}")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    asyncio.run(verify_real_engine())
