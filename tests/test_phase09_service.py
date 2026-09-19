"""Phase 9 Task 6: RenderQaService tests (TDD RED first)."""
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
                              run_ffprobe_fn=lambda p: _clean_probe(),
                              run_detector_fn=None)
    return service, jobs, projects


async def _run(svc, job_id):
    service, _, _ = svc
    await service.run_job(job_id)
    return service.jobs.get_job(job_id)


def test_automatic_idempotency_reuses_valid_report(svc, tmp_path):
    async def _go():
        service, jobs, projects = svc
        proj = projects / "projA"
        proj.mkdir()
        _make_export(proj)
        calls = {"n": 0}

        async def _det(**kwargs):
            calls["n"] += 1
            from studio.render_qa_detector import DetectorRunResult
            return DetectorRunResult(completed=True, cancelled=False,
                                     return_code=0, events=[],
                                     decode_error_count=0, stderr_tail="")
        service.run_detector_fn = _det
        r1 = service.request_qa("projA", "export_001", "AUTOMATIC")
        await service.run_job(r1["jobId"])
        assert calls["n"] == 1
        r2 = service.request_qa("projA", "export_001", "AUTOMATIC")
        assert r2.get("reused") is True
        assert calls["n"] == 1
    asyncio.run(_go())


def test_manual_rerun_creates_new_run_id(svc):
    async def _go():
        service, jobs, projects = svc
        proj = projects / "projB"
        proj.mkdir()
        _make_export(proj)

        async def _det(**kwargs):
            from studio.render_qa_detector import DetectorRunResult
            return DetectorRunResult(completed=True, cancelled=False,
                                     return_code=0, events=[],
                                     decode_error_count=0, stderr_tail="")
        service.run_detector_fn = _det
        r1 = service.request_qa("projB", "export_001", "AUTOMATIC")
        await service.run_job(r1["jobId"])
        r2 = service.request_qa("projB", "export_001", "MANUAL_RERUN")
        assert r2.get("reused") is not True
        assert r2["qaRunId"] != r1["qaRunId"]
        await service.run_job(r2["jobId"])
        from studio.render_qa_report_store import RenderQaReportStore
        reports = RenderQaReportStore().list_reports(proj / "exports" / "export_001")
        assert len(reports) == 2
    asyncio.run(_go())


def test_pass_promotes_ready_and_fail_blocks(svc):
    async def _go():
        from studio.render_qa_types import QaDetectorKind, RawQaEvent
        service, jobs, projects = svc
        for pid, events, want_artifact in (
            ("projP", [], "READY"),
            ("projF", [RawQaEvent(detector=QaDetectorKind.BLACK, start_time=0.0,
                                  end_time=4.0, duration=4.0,
                                  raw_thresholds={}, raw_evidence={})], "BLOCKED"),
        ):
            proj = projects / pid
            proj.mkdir()
            _make_export(proj)

            async def _det(ev=events, **kwargs):
                from studio.render_qa_detector import DetectorRunResult
                return DetectorRunResult(completed=True, cancelled=False,
                                         return_code=0, events=list(ev),
                                         decode_error_count=0, stderr_tail="")
            service.run_detector_fn = _det
            r = service.request_qa(pid, "export_001", "MANUAL_RERUN")
            job = await _run(svc, r["jobId"])
            assert job["status"] == "COMPLETED"
            assert job["metadata"]["artifactStatus"] == want_artifact
    asyncio.run(_go())


def test_engine_exception_preserves_needs_review(svc):
    async def _go():
        service, jobs, projects = svc
        proj = projects / "projE"
        proj.mkdir()
        _make_export(proj)

        def _boom(p):
            raise RuntimeError("ffprobe exploded")
        service.run_ffprobe_fn = _boom
        r = service.request_qa("projE", "export_001", "AUTOMATIC")
        job = await _run(svc, r["jobId"])
        assert job["status"] == "FAILED"
        assert job["metadata"]["artifactStatus"] == "NEEDS_REVIEW"
        assert job["metadata"]["artifactReasonCode"] == "PENDING_RENDER_QA"
    asyncio.run(_go())


def test_final_changed_during_run_is_hard_fail(svc, tmp_path):
    async def _go():
        service, jobs, projects = svc
        proj = projects / "projC"
        proj.mkdir()
        _make_export(proj)

        async def _det(final_path=None, **kwargs):
            from studio.render_qa_detector import DetectorRunResult
            Path(final_path).write_bytes(b"\x02" * 4096)
            return DetectorRunResult(completed=True, cancelled=False,
                                     return_code=0, events=[],
                                     decode_error_count=0, stderr_tail="")
        service.run_detector_fn = _det
        r = service.request_qa("projC", "export_001", "AUTOMATIC")
        job = await _run(svc, r["jobId"])
        assert job["status"] == "COMPLETED"
        assert job["metadata"]["qaVerdict"] == "FAIL"
        assert job["metadata"]["artifactStatus"] == "BLOCKED"
    asyncio.run(_go())


def test_global_concurrency_and_cpu_bound_release(svc):
    async def _go():
        import time
        from studio.resource_scheduler import LocalResourceScheduler
        service, jobs, projects = svc
        service.scheduler = LocalResourceScheduler()
        overlap = {"active": 0, "max": 0}

        async def _det(**kwargs):
            overlap["active"] += 1
            overlap["max"] = max(overlap["max"], overlap["active"])
            await asyncio.sleep(0.2)
            overlap["active"] -= 1
            from studio.render_qa_detector import DetectorRunResult
            return DetectorRunResult(completed=True, cancelled=False,
                                     return_code=0, events=[],
                                     decode_error_count=0, stderr_tail="")
        service.run_detector_fn = _det
        for pid in ("projG1", "projG2"):
            proj = projects / pid
            proj.mkdir()
            _make_export(proj)
        r1 = service.request_qa("projG1", "export_001", "MANUAL_RERUN")
        r2 = service.request_qa("projG2", "export_001", "MANUAL_RERUN")
        await asyncio.gather(service.run_job(r1["jobId"]), service.run_job(r2["jobId"]))
        assert overlap["max"] == 1
        assert service.scheduler.active_counts.get("CPU_BOUND", 0) == 0
    asyncio.run(_go())


def test_process_wide_gate_across_threads_and_loops(tmp_path):
    """Two QA executions on distinct threads/event loops must not overlap decode."""
    import threading
    from studio.jobs_manager import JobsManager
    from studio.render_qa_service import RenderQaService
    projects = tmp_path / "projects"
    projects.mkdir()
    for pid in ("projT1", "projT2"):
        (projects / pid).mkdir()
        _make_export(projects / pid)
    lock = threading.Lock()
    overlap = {"active": 0, "max": 0}

    def _worker(pid, idx):
        from studio.render_qa_probe import parse_ffprobe_json

        def _probe(final_path, n_frames=96):
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

        async def _det(**kwargs):
            import time as _t
            with lock:
                overlap["active"] += 1
                overlap["max"] = max(overlap["max"], overlap["active"])
            await asyncio.sleep(0.5)
            with lock:
                overlap["active"] -= 1
            from studio.render_qa_detector import DetectorRunResult
            return DetectorRunResult(completed=True, cancelled=False,
                                     return_code=0, events=[],
                                     decode_error_count=0, stderr_tail="")

        async def _go():
            jobs = JobsManager(runtime_dir=tmp_path / f"jobs_t{idx}",
                               projects_dir=projects)
            service = RenderQaService(projects_dir=projects, jobs=jobs,
                                      run_ffprobe_fn=_probe,
                                      run_detector_fn=_det)
            r = service.request_qa(pid, "export_001", "MANUAL_RERUN")
            return await service.wait_for_job(r["jobId"], timeout=120.0)
        return asyncio.run(_go())

    t1 = threading.Thread(target=_worker, args=("projT1", 1))
    t2 = threading.Thread(target=_worker, args=("projT2", 2))
    t1.start()
    t2.start()
    t1.join(150)
    t2.join(150)
    assert not t1.is_alive() and not t2.is_alive()
    assert overlap["max"] == 1, overlap


def test_gate_released_on_all_terminal_paths(svc):
    async def _go():
        from studio.jobs_manager import JobStatus
        from studio.render_qa_types import QaDetectorKind, RawQaEvent
        service, jobs, projects = svc
        orig_probe = service.run_ffprobe_fn

        async def _instant(**kwargs):
            from studio.render_qa_detector import DetectorRunResult
            return DetectorRunResult(completed=True, cancelled=False,
                                     return_code=0, events=[],
                                     decode_error_count=0, stderr_tail="")
        service.run_detector_fn = _instant
        seq = 0

        async def _fresh(tag):
            nonlocal seq
            seq += 1
            pid = f"projR{tag}{seq}"
            proj = projects / pid
            proj.mkdir()
            _make_export(proj)
            r = service.request_qa(pid, "export_001", "MANUAL_RERUN")
            return await service.wait_for_job(r["jobId"], timeout=60.0)

        black4 = [RawQaEvent(detector=QaDetectorKind.BLACK, start_time=0.0,
                             end_time=4.0, duration=4.0,
                             raw_thresholds={}, raw_evidence={})]

        async def _det_events(events, **kwargs):
            from studio.render_qa_detector import DetectorRunResult
            return DetectorRunResult(completed=True, cancelled=False,
                                     return_code=0, events=list(events),
                                     decode_error_count=0, stderr_tail="")
        import functools
        # PASS
        assert (await _fresh("pass"))["status"] == "COMPLETED"
        # PASS_WITH_WARNINGS (0.5s black)
        async def _det_warn(**kwargs):
            from studio.render_qa_detector import DetectorRunResult
            from studio.render_qa_types import QaDetectorKind as _K, RawQaEvent as _E
            return DetectorRunResult(
                completed=True, cancelled=False, return_code=0,
                events=[_E(detector=_K.BLACK, start_time=0.0, end_time=0.5,
                           duration=0.5, raw_thresholds={}, raw_evidence={})],
                decode_error_count=0, stderr_tail="")
        service.run_detector_fn = _det_warn
        w = await _fresh("warn")
        assert w["status"] == "COMPLETED"
        assert w["metadata"]["qaVerdict"] == "PASS_WITH_WARNINGS"
        # media FAIL
        service.run_detector_fn = functools.partial(_det_events, black4)
        f = await _fresh("fail")
        assert f["metadata"]["qaVerdict"] == "FAIL"
        # validator exception -> job FAILED
        service.run_detector_fn = _instant

        def _boom(p):
            raise RuntimeError("boom")
        service.run_ffprobe_fn = _boom
        proj = projects / "projRexc"
        proj.mkdir()
        _make_export(proj)
        r = service.request_qa("projRexc", "export_001", "MANUAL_RERUN")
        failed = await service.wait_for_job(r["jobId"], timeout=60.0)
        assert failed["status"] == "FAILED"
        service.run_ffprobe_fn = orig_probe
        # CANCELLED
        started = asyncio.Event()
        release = asyncio.Event()

        async def _blocking(cancel_event=None, **kwargs):
            from studio.render_qa_detector import DetectorRunResult
            started.set()
            await asyncio.wait_for(release.wait(), timeout=30)
            if cancel_event is not None and cancel_event.is_set():
                return DetectorRunResult(completed=False, cancelled=True,
                                         return_code=None, events=[],
                                         decode_error_count=0, stderr_tail="")
            return DetectorRunResult(completed=True, cancelled=False,
                                     return_code=0, events=[],
                                     decode_error_count=0, stderr_tail="")
        service.run_detector_fn = _blocking
        proj = projects / "projRcancel"
        proj.mkdir()
        _make_export(proj)
        rc = service.request_qa("projRcancel", "export_001", "MANUAL_RERUN")
        task = asyncio.ensure_future(service.run_job(rc["jobId"]))
        await asyncio.wait_for(started.wait(), timeout=30)
        service.cancel_job(rc["jobId"])
        release.set()
        await asyncio.wait_for(task, timeout=30)
        assert jobs.get_job(rc["jobId"])["status"] == "CANCELLED"
        # INTERRUPTED via recovery
        service.run_detector_fn = _instant
        proj = projects / "projRint"
        proj.mkdir()
        _make_export(proj)
        ri = service.request_qa("projRint", "export_001", "MANUAL_RERUN")
        jobs.update_job(ri["jobId"], status=JobStatus.RUNNING)
        service.recover_incomplete_jobs()
        assert jobs.get_job(ri["jobId"])["status"] == JobStatus.INTERRUPTED
        # gate must be free after every path above
        end = await _fresh("free")
        assert end["status"] == "COMPLETED"
    asyncio.run(_go())


# ---------------------------------------------------------------------------
# Task 8: automatic Phase 8 -> Phase 9 handoff.
# ---------------------------------------------------------------------------

def _wav8(p, seconds=4.0):
    import wave
    with wave.open(str(p), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(24000)
        w.writeframes(b"\x00" * int(24000 * seconds) * 2)


def _phase8_project(base_dir, proj_name="projH", export_id="export_001"):
    import hashlib
    proj = base_dir / proj_name
    (proj / "assets").mkdir(parents=True, exist_ok=True)
    media = b"\x89PNG" + b"\x00" * 200
    (proj / "assets" / "s1.png").write_bytes(media)
    _wav8(proj / "audio.wav", 4.0)
    (proj / "scene_plan.json").write_text(json.dumps(
        {"scenes": [{"scene_id": "scene_001", "index": 1}]}))
    (proj / "veo_prompts.json").write_text(json.dumps({
        "shots": [{"shot_id": "shot_001", "scene_id": "scene_001",
                   "start": 0.0, "end": 4.0, "duration": 4.0, "index": 1}]}))
    (proj / "timestamps.json").write_text(json.dumps({"audio_duration": 4.0}))
    (proj / "assets" / "intake_ledger.json").write_text(json.dumps({
        "assets": [{"id": "A1", "scene_id": "scene_001", "shot_id": "shot_001",
                    "lifecycle": "LOCKED",
                    "checksum": hashlib.sha256(media).hexdigest(),
                    "version": 1, "filePath": "assets/s1.png"}]}))
    from studio.timeline_compiler import compile_render_manifest
    assert compile_render_manifest(proj, export_id).persisted is True
    return proj


def _success_attempt(candidate_bytes=b"fake-mp4-bytes" * 100):
    async def run(build, scratch_dir, cancel_event, progress_cb, expected_frames):
        candidate = scratch_dir / "candidate.mp4"
        candidate.write_bytes(candidate_bytes)
        await progress_cb({"frame": expected_frames, "progress": "end"})
        return {"return_code": 0, "stderr_tail": "", "max_frame": expected_frames}
    return run


def _render_service(tmp_path, qa_factory):
    from studio.jobs_manager import JobsManager
    from studio.manifest_render_service import ManifestRenderService
    jobs = JobsManager(runtime_dir=tmp_path / "rt", projects_dir=tmp_path)
    service = ManifestRenderService(projects_dir=tmp_path, jobs=jobs,
                                    scheduler=None, ffmpeg_path="ffmpeg",
                                    qa_service_factory=qa_factory)
    service.run_attempt_fn = _success_attempt()
    return service, jobs


def test_final_render_completion_enqueues_exactly_one_render_qa(tmp_path):
    from studio.render_qa_service import RenderQaService
    _phase8_project(tmp_path)
    calls = []

    def _factory():
        return RenderQaService(projects_dir=tmp_path,
                               jobs=svc_jobs[0],
                               run_ffprobe_fn=lambda p: _clean_probe(),
                               run_detector_fn=None)
    svc_jobs = []
    service, jobs = _render_service(tmp_path, _factory)
    svc_jobs.append(jobs)

    async def _go():
        res = await service.start_final_render(
            project_id="projH", export_id="export_001",
            encoder_profile="FINAL_QUALITY")
        await service.wait_for_job(res["jobId"], timeout=60)
        return res
    res = asyncio.run(_go())
    qa = [j for j in jobs.list_jobs(limit=10000) if j.get("type") == "RENDER_QA"]
    assert len(qa) == 1
    assert qa[0]["metadata"]["exportId"] == "export_001"


def test_duplicate_completion_hook_no_duplicate_qa(tmp_path):
    from studio.render_qa_service import RenderQaService
    _phase8_project(tmp_path)
    holder = {}
    service, jobs = _render_service(
        tmp_path, lambda: holder.get("qa"))
    holder["qa"] = RenderQaService(projects_dir=tmp_path, jobs=jobs,
                                   run_ffprobe_fn=lambda p: _clean_probe())

    async def _go():
        res = await service.start_final_render(
            project_id="projH", export_id="export_001",
            encoder_profile="FINAL_QUALITY")
        await service.wait_for_job(res["jobId"], timeout=60)
        service._enqueue_post_render_qa("projH", "export_001")
        service._enqueue_post_render_qa("projH", "export_001")
    asyncio.run(_go())
    qa = [j for j in jobs.list_jobs(limit=10000) if j.get("type") == "RENDER_QA"]
    assert len(qa) == 1


def test_qa_enqueue_failure_keeps_final_and_pending_qa(tmp_path):
    _phase8_project(tmp_path)

    def _boom_factory():
        raise RuntimeError("qa subsystem down")
    service, jobs = _render_service(tmp_path, _boom_factory)

    async def _go():
        res = await service.start_final_render(
            project_id="projH", export_id="export_001",
            encoder_profile="FINAL_QUALITY")
        return await service.wait_for_job(res["jobId"], timeout=60)
    job = asyncio.run(_go())
    assert job["status"] == "COMPLETED"
    assert job["metadata"]["artifactStatus"] == "NEEDS_REVIEW"
    assert job["metadata"]["artifactReasonCode"] == "PENDING_RENDER_QA"
    assert (tmp_path / "projH" / "exports" / "export_001" / "final.mp4").is_file()


def test_qa_routes_through_cpu_bound_scheduler(svc):
    async def _go():
        service, jobs, projects = svc
        seen = []

        class _RecordingScheduler:
            async def submit_job(self, job_id, job_type, resource_class,
                                 coro_fn, metadata=None):
                seen.append(resource_class)
                return await coro_fn()
        service.scheduler = _RecordingScheduler()

        async def _instant(**kwargs):
            from studio.render_qa_detector import DetectorRunResult
            return DetectorRunResult(completed=True, cancelled=False,
                                     return_code=0, events=[],
                                     decode_error_count=0, stderr_tail="")
        service.run_detector_fn = _instant
        proj = projects / "projCPU"
        proj.mkdir()
        _make_export(proj)
        r = service.request_qa("projCPU", "export_001", "MANUAL_RERUN")
        job = await service.wait_for_job(r["jobId"], timeout=60.0)
        assert job["status"] == "COMPLETED"
        assert seen and all(s == "CPU_BOUND" for s in seen)
    asyncio.run(_go())


def test_default_production_factory_wires_cpu_bound_scheduler(tmp_path, monkeypatch):
    import studio.config as _cfg
    import studio.phase14_router as _r14
    root = tmp_path / "projects"
    root.mkdir()
    monkeypatch.setattr(_cfg, "PROJECTS_DIR", root)
    monkeypatch.setattr(_r14, "PROJECTS_DIR", root)
    if hasattr(_r14._qa_service_singleton, "_instance"):
        delattr(_r14._qa_service_singleton, "_instance")
    try:
        svc = _r14._qa_service_singleton()
        assert svc.projects_dir == root
        assert svc.scheduler is not None
        assert type(svc.scheduler).__name__ == "LocalResourceScheduler"
    finally:
        if hasattr(_r14._qa_service_singleton, "_instance"):
            delattr(_r14._qa_service_singleton, "_instance")
