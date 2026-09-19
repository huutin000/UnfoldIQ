"""Phase 9 Task 7: crash recovery + cancellation boundary tests (TDD RED first)."""
import asyncio
import json
from pathlib import Path

import pytest


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
    return manifest


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


@pytest.fixture
def svc(tmp_path):
    from studio.jobs_manager import JobsManager
    from studio.render_qa_service import RenderQaService
    projects = tmp_path / "projects"
    projects.mkdir()
    jobs = JobsManager(runtime_dir=tmp_path / "jobs", projects_dir=projects)
    service = RenderQaService(projects_dir=projects, jobs=jobs,
                              run_ffprobe_fn=lambda p: _clean_probe())
    return service, jobs, projects


def test_queued_remains_schedulable(svc):
    service, jobs, projects = svc
    proj = projects / "projR"
    proj.mkdir()
    _make_export(proj)
    r = service.request_qa("projR", "export_001", "AUTOMATIC")
    out = service.recover_incomplete_jobs()
    assert jobs.get_job(r["jobId"])["status"] == "QUEUED"
    assert any(v == "QUEUED schedulable" for _, v in out["recovered"])


def test_running_before_commit_becomes_interrupted(svc):
    from studio.jobs_manager import JobStatus
    service, jobs, projects = svc
    proj = projects / "projI"
    proj.mkdir()
    _make_export(proj)
    r = service.request_qa("projI", "export_001", "AUTOMATIC")
    jobs.update_job(r["jobId"], status=JobStatus.RUNNING)
    out = service.recover_incomplete_jobs()
    assert jobs.get_job(r["jobId"])["status"] == JobStatus.INTERRUPTED
    assert any(v == "RUNNING->INTERRUPTED" for _, v in out["recovered"])


def test_post_commit_repairs_and_completes(svc):
    async def _go():
        from studio.render_qa_detector import DetectorRunResult
        service, jobs, projects = svc
        proj = projects / "projC"
        proj.mkdir()
        _make_export(proj)

        async def _det(**kwargs):
            return DetectorRunResult(completed=True, cancelled=False,
                                     return_code=0, events=[],
                                     decode_error_count=0, stderr_tail="")
        service.run_detector_fn = _det
        r = service.request_qa("projC", "export_001", "AUTOMATIC")
        await service.run_job(r["jobId"])
        job = jobs.get_job(r["jobId"])
        assert job["status"] == "COMPLETED"
        # Simulate crash after REPORT_COMMITTED but before artifact apply:
        # flip job back to RUNNING with reportCommitted set, wipe artifact.
        from studio import jobs_manager as _jm
        _jm.patch_project_job("projC", r["jobId"], manager=jobs,
                              status="RUNNING",
                              metadata={"artifactStatus": "NEEDS_REVIEW"})
        (proj / "exports" / "export_001" / "qa" / "latest.json").unlink()
        out = service.recover_incomplete_jobs()
        job2 = jobs.get_job(r["jobId"])
        assert job2["status"] == "COMPLETED"
        assert job2["metadata"]["artifactStatus"] == "READY"
        assert (proj / "exports" / "export_001" / "qa" / "latest.json").is_file()
        assert any("REPORT_COMMITTED" in v for _, v in out["recovered"])
    asyncio.run(_go())


def test_cancel_queued_no_process(svc):
    service, jobs, projects = svc
    proj = projects / "projQ"
    proj.mkdir()
    _make_export(proj)
    r = service.request_qa("projQ", "export_001", "AUTOMATIC")
    out = service.cancel_job(r["jobId"])
    assert out.get("cancelRequested") or jobs.get_job(r["jobId"])["status"] == "CANCELLED"
    from studio.render_qa_report_store import RenderQaReportStore
    assert RenderQaReportStore().list_reports(proj / "exports" / "export_001") == []


def test_cancel_before_commit_no_report(svc):
    async def _go():
        from studio.render_qa_detector import DetectorRunResult
        service, jobs, projects = svc
        proj = projects / "projX"
        proj.mkdir()
        _make_export(proj)
        started = asyncio.Event()
        release = asyncio.Event()

        async def _det(cancel_event=None, **kwargs):
            started.set()
            await asyncio.wait_for(release.wait(), timeout=30)
            if cancel_event is not None and cancel_event.is_set():
                return DetectorRunResult(completed=False, cancelled=True,
                                         return_code=None, events=[],
                                         decode_error_count=0, stderr_tail="")
            return DetectorRunResult(completed=True, cancelled=False,
                                     return_code=0, events=[],
                                     decode_error_count=0, stderr_tail="")
        service.run_detector_fn = _det
        r = service.request_qa("projX", "export_001", "AUTOMATIC")
        task = asyncio.ensure_future(service.run_job(r["jobId"]))
        await asyncio.wait_for(started.wait(), timeout=30)
        service.cancel_job(r["jobId"])
        release.set()
        await asyncio.wait_for(task, timeout=30)
        job = jobs.get_job(r["jobId"])
        assert job["status"] == "CANCELLED"
        from studio.render_qa_report_store import RenderQaReportStore
        assert RenderQaReportStore().list_reports(proj / "exports" / "export_001") == []
    asyncio.run(_go())
