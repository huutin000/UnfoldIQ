"""Phase 9 Task 11: evaluator scale + >=20-minute QA_RTF performance tests."""
import asyncio
import time

import pytest


def test_evaluator_250_and_500_shot_timing():
    from studio.render_qa_evaluator import build_manifest_qa_context, evaluate_events
    from studio.render_qa_policy import RENDER_QA_POLICY_V1
    from studio.render_qa_types import QaDetectorKind, RawQaEvent
    for count in (250, 500):
        clips = [{"clipId": f"clip_{i:04d}", "sceneId": f"scene_{i // 10:03d}",
                  "shotId": f"shot_{i:04d}", "startFrame": i * 24,
                  "endFrame": (i + 1) * 24,
                  "mediaType": "VIDEO" if i % 2 else "IMAGE",
                  "transition": {"type": "CROSSFADE" if i % 7 == 0 else "CUT",
                                 "durationFrames": 12 if i % 7 == 0 else 0}}
                 for i in range(count)]
        ctx = build_manifest_qa_context({"videoTrack": {"clips": clips}})
        events = [RawQaEvent(detector=QaDetectorKind.FREEZE, start_time=10.0,
                             end_time=14.0, duration=4.0,
                             raw_thresholds={}, raw_evidence={}),
                  RawQaEvent(detector=QaDetectorKind.BLACK, start_time=20.0,
                             end_time=20.6, duration=0.6,
                             raw_thresholds={}, raw_evidence={}),
                  RawQaEvent(detector=QaDetectorKind.SILENCE, start_time=30.0,
                             end_time=36.0, duration=6.0,
                             raw_thresholds={}, raw_evidence={})]
        t0 = time.perf_counter()
        findings = evaluate_events(events, ctx, RENDER_QA_POLICY_V1)
        dt = time.perf_counter() - t0
        assert findings
        assert dt < 2.0, f"{count} shots took {dt:.2f}s"


def test_longform_qa_rtf(tmp_path):
    """20-minute Final must verify with QA_RTF <= 1.0 (temp media only)."""
    import json
    import subprocess
    from studio.render_manifest_hashing import compute_manifest_hash
    work = tmp_path / "longform"
    work.mkdir()
    final = work / "final20.mp4"
    dur = 20 * 60
    gen0 = time.perf_counter()
    proc = subprocess.run(
        ["ffmpeg", "-y",
         "-f", "lavfi", "-i", f"color=c=0x3b82f6:size=1920x1080:rate=24:duration={dur}",
         "-f", "lavfi", "-i", f"sine=frequency=440:sample_rate=48000:duration={dur}",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "24",
         "-preset", "ultrafast", "-crf", "30",
         "-c:a", "aac", "-ac", "2", "-ar", "48000", "-b:a", "128k",
         "-shortest", str(final)],
        capture_output=True, text=True, timeout=1800)
    assert proc.returncode == 0, proc.stderr[-1500:]
    gen_s = time.perf_counter() - gen0
    print(f"\nfixture generation: {gen_s:.1f}s")

    from studio.render_qa_probe import run_ffprobe
    probe = run_ffprobe(final)
    n_frames = probe.video.read_frames
    assert n_frames >= 20 * 60 * 24 - 24, n_frames
    clips = [{"clipId": "clip_all", "sceneId": "scene_001",
              "shotId": "shot_001", "sequenceIndex": 1,
              "startFrame": 0, "durationFrames": n_frames,
              "endFrame": n_frames, "assetId": "a1",
              "acceptedAssetVersion": 1, "checksum": "0" * 64,
              "filePath": "assets/s1.png", "mediaType": "IMAGE",
              "transition": {"type": "CUT", "durationFrames": 0}}]
    proj = tmp_path / "projLong"
    export_dir = proj / "exports" / "export_001"
    export_dir.mkdir(parents=True)
    import shutil
    shutil.copyfile(final, export_dir / "final.mp4")
    manifest = {
        "schemaVersion": "1.0.0", "projectId": "projLong",
        "exportId": "export_001",
        "frameRate": {"numerator": 24, "denominator": 1},
        "timeBase": {"numerator": 1, "denominator": 24},
        "output": {"width": 1920, "height": 1080},
        "videoTrack": {"clips": clips},
        "voiceTrack": {}, "musicTrack": {"configured": False},
        "subtitlesTrack": {"configured": False}, "scenes": [],
    }
    manifest["manifestHash"] = compute_manifest_hash(manifest)
    (export_dir / "render-manifest.json").write_text(json.dumps(manifest))
    (export_dir / "render-metadata.json").write_text(json.dumps(
        {"projectId": "projLong", "exportId": "export_001",
         "manifestHash": manifest["manifestHash"],
         "expectedFinalFrames": n_frames}))

    async def _go():
        from studio.jobs_manager import JobsManager
        from studio.render_qa_service import RenderQaService
        jobs = JobsManager(runtime_dir=tmp_path / "jobs_long",
                           projects_dir=tmp_path)
        svc = RenderQaService(projects_dir=tmp_path, jobs=jobs)
        t0 = time.perf_counter()
        req = svc.request_qa("projLong", "export_001", "MANUAL_RERUN")
        job = await svc.wait_for_job(req["jobId"], timeout=1800.0)
        total = time.perf_counter() - t0
        return job, total
    job, total_s = asyncio.run(_go())
    final_dur = n_frames / 24.0
    rtf = total_s / final_dur
    print(f"\nlongform: frames={n_frames} duration={final_dur:.1f}s "
          f"qa_wall={total_s:.1f}s RTF={rtf:.3f} verdict="
          f"{job['metadata'].get('qaVerdict')}")
    assert job["status"] == "COMPLETED"
    assert job["metadata"]["qaVerdict"] == "PASS"
    assert job["metadata"]["artifactStatus"] == "READY"
    assert final_dur >= 20 * 60
    assert rtf <= 1.0, f"QA_RTF {rtf:.3f} exceeds 1.0"
