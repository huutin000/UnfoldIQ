"""Phase 9 repeated runtime-safety verification.

Runs cancel/concurrency/crash-repair races plus five repetitions of the
critical recovery tests. Exit nonzero on any failure. Temp dirs only.
"""
import asyncio
import json
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def _make_export(project_dir: Path, export_id="export_001", n_frames=96):
    from studio.render_manifest_hashing import compute_manifest_hash
    export_dir = project_dir / "exports" / export_id
    export_dir.mkdir(parents=True, exist_ok=True)
    manifest = {
        "schemaVersion": "1.0.0", "projectId": project_dir.name, "exportId": export_id,
        "frameRate": {"numerator": 24, "denominator": 1},
        "timeBase": {"numerator": 1, "denominator": 24},
        "output": {"width": 1920, "height": 1080},
        "videoTrack": {"clips": [
            {"clipId": "c1", "sceneId": "s1", "shotId": "shot_001",
             "sequenceIndex": 1, "startFrame": 0, "durationFrames": n_frames,
             "endFrame": n_frames, "assetId": "a1", "acceptedAssetVersion": 1,
             "checksum": "0" * 64, "filePath": "assets/s1.png", "mediaType": "VIDEO",
             "transition": {"type": "CUT", "durationFrames": 0}}]},
        "voiceTrack": {}, "musicTrack": {"configured": False},
        "subtitlesTrack": {"configured": False}, "scenes": [],
    }
    manifest["manifestHash"] = compute_manifest_hash(manifest)
    (export_dir / "render-manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    (export_dir / "render-metadata.json").write_text(json.dumps(
        {"projectId": project_dir.name, "exportId": export_id,
         "manifestHash": manifest["manifestHash"],
         "expectedFinalFrames": n_frames}), encoding="utf-8")
    (export_dir / "final.mp4").write_bytes(b"\x01" * 4096)


def _clean_probe(n_frames=96):
    from studio.render_qa_probe import parse_ffprobe_json
    payload = {
        "streams": [
            {"index": 0, "codec_type": "video", "codec_name": "h264",
             "width": 1920, "height": 1080, "pix_fmt": "yuv420p",
             "sample_aspect_ratio": "1:1", "avg_frame_rate": "24/1",
             "r_frame_rate": "24/1", "nb_read_frames": str(n_frames),
             "duration": str(n_frames / 24)},
            {"index": 1, "codec_type": "audio", "codec_name": "aac",
             "sample_rate": "48000", "channels": 2,
             "channel_layout": "stereo", "duration": str(n_frames / 24)},
        ],
        "format": {"format_name": "mov,mp4", "duration": str(n_frames / 24)},
    }
    return parse_ffprobe_json(payload, expected_frames=n_frames)


async def _cancel_race(tmp: Path) -> None:
    from studio.jobs_manager import JobsManager
    from studio.render_qa_detector import DetectorRunResult
    from studio.render_qa_service import RenderQaService
    projects = tmp / "projects"
    projects.mkdir(exist_ok=True)
    jobs = JobsManager(runtime_dir=tmp / "jobs", projects_dir=projects)
    svc = RenderQaService(projects_dir=projects, jobs=jobs,
                          run_ffprobe_fn=lambda p: _clean_probe())
    proj = projects / "proj_cancel"
    proj.mkdir(exist_ok=True)
    _make_export(proj)
    entered = asyncio.Event()
    release = asyncio.Event()

    async def _det(cancel_event=None, **kwargs):
        entered.set()
        await asyncio.wait_for(release.wait(), timeout=30)
        if cancel_event is not None and cancel_event.is_set():
            return DetectorRunResult(completed=False, cancelled=True,
                                     return_code=None, events=[],
                                     decode_error_count=0, stderr_tail="")
        return DetectorRunResult(completed=True, cancelled=False,
                                 return_code=0, events=[],
                                 decode_error_count=0, stderr_tail="")
    svc.run_detector_fn = _det
    r = svc.request_qa("proj_cancel", "export_001", "AUTOMATIC")
    task = asyncio.ensure_future(svc.run_job(r["jobId"]))
    await asyncio.wait_for(entered.wait(), timeout=30)
    svc.cancel_job(r["jobId"])
    release.set()
    await asyncio.wait_for(task, timeout=30)
    job = jobs.get_job(r["jobId"])
    assert job["status"] == "CANCELLED", job["status"]


async def _concurrency_race(tmp: Path) -> None:
    from studio.jobs_manager import JobsManager
    from studio.render_qa_detector import DetectorRunResult
    from studio.render_qa_service import RenderQaService
    projects = tmp / "projects2"
    projects.mkdir(exist_ok=True)
    jobs = JobsManager(runtime_dir=tmp / "jobs2", projects_dir=projects)
    svc = RenderQaService(projects_dir=projects, jobs=jobs,
                          run_ffprobe_fn=lambda p: _clean_probe())
    overlap = {"active": 0, "max": 0}

    async def _det(**kwargs):
        overlap["active"] += 1
        overlap["max"] = max(overlap["max"], overlap["active"])
        await asyncio.sleep(0.15)
        overlap["active"] -= 1
        return DetectorRunResult(completed=True, cancelled=False,
                                 return_code=0, events=[],
                                 decode_error_count=0, stderr_tail="")
    svc.run_detector_fn = _det
    for pid in ("pA", "pB"):
        proj = projects / pid
        proj.mkdir(exist_ok=True)
        _make_export(proj)
    r1 = svc.request_qa("pA", "export_001", "MANUAL_RERUN")
    r2 = svc.request_qa("pB", "export_001", "MANUAL_RERUN")
    await asyncio.gather(svc.run_job(r1["jobId"]), svc.run_job(r2["jobId"]))
    assert overlap["max"] == 1, overlap


async def _crash_repair_race(tmp: Path) -> None:
    from studio import jobs_manager as _jm
    from studio.jobs_manager import JobsManager, JobStatus
    from studio.render_qa_detector import DetectorRunResult
    from studio.render_qa_service import RenderQaService
    projects = tmp / "projects3"
    projects.mkdir(exist_ok=True)
    jobs = JobsManager(runtime_dir=tmp / "jobs3", projects_dir=projects)
    svc = RenderQaService(projects_dir=projects, jobs=jobs,
                          run_ffprobe_fn=lambda p: _clean_probe())
    proj = projects / "proj_crash"
    proj.mkdir(exist_ok=True)
    _make_export(proj)

    async def _det(**kwargs):
        return DetectorRunResult(completed=True, cancelled=False,
                                 return_code=0, events=[],
                                 decode_error_count=0, stderr_tail="")
    svc.run_detector_fn = _det
    r = svc.request_qa("proj_crash", "export_001", "AUTOMATIC")
    await svc.run_job(r["jobId"])
    _jm.patch_project_job("proj_crash", r["jobId"], manager=jobs,
                          status=JobStatus.RUNNING,
                          metadata={"artifactStatus": "NEEDS_REVIEW"})
    out = svc.recover_incomplete_jobs()
    assert jobs.get_job(r["jobId"])["status"] == "COMPLETED"
    assert any("REPORT_COMMITTED" in v for _, v in out["recovered"])


def main() -> int:
    async def _all(tmp: Path) -> None:
        await _cancel_race(tmp)
        print("cancel race: OK")
        await _concurrency_race(tmp)
        print("concurrency race: OK")
        await _crash_repair_race(tmp)
        print("crash-repair race: OK")

    with tempfile.TemporaryDirectory(prefix="phase09_safety_") as td:
        asyncio.run(_all(Path(td)))
    # Five repetitions of critical recovery tests.
    for i in range(5):
        proc = subprocess.run(
            [sys.executable, "-m", "pytest", "tests/test_phase09_recovery.py", "-q"],
            cwd=str(ROOT), capture_output=True, text=True)
        print(f"recovery repetition {i + 1}/5: rc={proc.returncode}")
        if proc.returncode != 0:
            print(proc.stdout[-2000:])
            print(proc.stderr[-2000:])
            return 1
    print("PHASE09 RUNTIME SAFETY: ALL GREEN")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
