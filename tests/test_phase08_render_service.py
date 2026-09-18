"""Phase 8 Task 9: render service orchestration + recovery tests."""
import asyncio
import json
import wave
from pathlib import Path

import pytest

from studio.jobs_manager import JobStatus, JobsManager
from studio.manifest_render_types import EncoderProfileName, RenderFailureCode


def _wav(p: Path, seconds=4.0):
    with wave.open(str(p), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(24000)
        w.writeframes(b"\x00" * int(24000 * seconds) * 2)


def _create_project(base_dir: Path, proj_name: str, export_id: str = "export_001"):
    import hashlib
    proj = base_dir / proj_name
    (proj / "assets").mkdir(parents=True, exist_ok=True)
    media = b"\x89PNG" + b"\x00" * 200
    (proj / "assets" / "s1.png").write_bytes(media)
    _wav(proj / "audio.wav", 4.0)
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
    result = compile_render_manifest(proj, export_id)
    assert result.persisted is True
    return proj


@pytest.fixture
def workdir(tmp_path):
    _create_project(tmp_path, "proj", "export_001")
    return tmp_path


class FakeScheduler:
    """Counting scheduler broker: submit_job acquires class permit, runs coro."""

    def __init__(self):
        self.acquired = []
        self.released = []
        self.held = {"CPU_BOUND": 0, "GPU_ENCODER": 0}

    async def submit_job(self, job_id, job_type, resource_class, coro_fn, metadata=None):
        self.acquired.append(resource_class)
        self.held[resource_class] = self.held.get(resource_class, 0) + 1
        try:
            return await coro_fn()
        finally:
            self.held[resource_class] -= 1
            self.released.append(resource_class)


@pytest.fixture
def service_fixture(workdir):
    from studio.manifest_render_service import ManifestRenderService
    jobs = JobsManager(runtime_dir=workdir / "runtime",
                       projects_dir=workdir)
    sched = FakeScheduler()
    service = ManifestRenderService(projects_dir=workdir, jobs=jobs,
                                    scheduler=sched, ffmpeg_path="ffmpeg")
    service.run_attempt_fn = None
    return {"service": service, "jobs": jobs, "sched": sched,
            "project_id": "proj", "workdir": workdir}


def _success_attempt_factory(candidate_bytes=b"fake-mp4-bytes" * 100):
    async def run(build, scratch_dir, cancel_event, progress_cb, expected_frames):
        candidate = scratch_dir / "candidate.mp4"
        candidate.write_bytes(candidate_bytes)
        await progress_cb({"frame": expected_frames, "progress": "end"})
        return {"return_code": 0, "stderr_tail": "", "max_frame": expected_frames}
    return run


def test_same_export_returns_existing_active_job(service_fixture):
    fx = service_fixture
    fx["service"].run_attempt_fn = _success_attempt_factory()

    async def scenario():
        first = await fx["service"].start_final_render(
            project_id=fx["project_id"], export_id="export_001",
            encoder_profile="FINAL_QUALITY")
        second = await fx["service"].start_final_render(
            project_id=fx["project_id"], export_id="export_001",
            encoder_profile="ACCELERATED")
        await fx["service"].wait_for_job(first["jobId"], timeout=30)
        return first, second

    first, second = asyncio.run(scenario())
    assert second["jobId"] == first["jobId"]


def test_existing_final_returns_already_rendered(service_fixture):
    fx = service_fixture
    (fx["workdir"] / "proj" / "exports" / "export_001" / "final.mp4").write_bytes(b"existing")

    async def scenario():
        return await fx["service"].start_final_render(
            project_id=fx["project_id"], export_id="export_001",
            encoder_profile="FINAL_QUALITY")

    result = asyncio.run(scenario())
    assert result["errorCode"] == "ALREADY_RENDERED"


def test_successful_render_completes_with_provenance(service_fixture):
    fx = service_fixture
    fx["service"].run_attempt_fn = _success_attempt_factory()

    async def scenario():
        started = await fx["service"].start_final_render(
            project_id=fx["project_id"], export_id="export_001",
            encoder_profile="FINAL_QUALITY")
        return await fx["service"].wait_for_job(started["jobId"], timeout=30)

    job = asyncio.run(scenario())
    assert job["status"] == JobStatus.COMPLETED
    assert job["progress"] == 1.0
    assert (fx["workdir"] / "proj" / "exports" / "export_001" / "final.mp4").is_file()
    meta = json.loads((fx["workdir"] / "proj" / "exports" / "export_001"
                       / "render-metadata.json").read_text(encoding="utf-8"))
    assert meta["encoderActuallyUsed"] == "libx264"
    assert job["metadata"]["artifactStatus"] == "NEEDS_REVIEW"
    assert job["metadata"]["artifactReasonCode"] == "PENDING_RENDER_QA"


def test_nvenc_hardware_failure_falls_back_exactly_once(service_fixture):
    fx = service_fixture
    calls = []

    async def run(build, scratch_dir, cancel_event, progress_cb, expected_frames):
        encoder = "h264_nvenc" if "h264_nvenc" in build.argv else "libx264"
        calls.append(encoder)
        if encoder == "h264_nvenc":
            return {"return_code": 1,
                    "stderr_tail": "No capable devices found",
                    "max_frame": 0}
        (scratch_dir / "candidate.mp4").write_bytes(b"cpu-bytes" * 100)
        return {"return_code": 0, "stderr_tail": "", "max_frame": expected_frames}

    fx["service"].run_attempt_fn = run

    async def scenario():
        started = await fx["service"].start_final_render(
            project_id=fx["project_id"], export_id="export_001",
            encoder_profile="ACCELERATED")
        return await fx["service"].wait_for_job(started["jobId"], timeout=30)

    job = asyncio.run(scenario())
    assert calls == ["h264_nvenc", "libx264"]
    assert job["status"] == JobStatus.COMPLETED
    assert job["metadata"]["fallbackAttempted"] is True
    assert job["metadata"]["encoderActuallyUsed"] == "libx264"
    assert len(job["metadata"]["attempts"]) == 2


def test_filter_error_does_not_fall_back(service_fixture):
    fx = service_fixture

    async def run(build, scratch_dir, cancel_event, progress_cb, expected_frames):
        return {"return_code": 1, "stderr_tail": "Error reinitializing filters",
                "max_frame": 0}

    fx["service"].run_attempt_fn = run

    async def scenario():
        started = await fx["service"].start_final_render(
            project_id=fx["project_id"], export_id="export_001",
            encoder_profile="ACCELERATED")
        return await fx["service"].wait_for_job(started["jobId"], timeout=30)

    job = asyncio.run(scenario())
    assert job["status"] == JobStatus.FAILED
    assert job["metadata"]["errorCode"] == "FILTERGRAPH_ERROR"
    assert len(job["metadata"]["attempts"]) == 1
    assert fx["sched"].acquired.count("CPU_BOUND") == 0


def test_permits_released_on_all_terminal_paths(service_fixture):
    fx = service_fixture
    fx["service"].run_attempt_fn = _success_attempt_factory()

    async def scenario():
        started = await fx["service"].start_final_render(
            project_id=fx["project_id"], export_id="export_001",
            encoder_profile="FINAL_QUALITY")
        await fx["service"].wait_for_job(started["jobId"], timeout=30)

    asyncio.run(scenario())
    assert fx["sched"].held == {"CPU_BOUND": 0, "GPU_ENCODER": 0}
    assert sorted(fx["sched"].acquired) == sorted(fx["sched"].released)


def test_global_final_concurrency_one_across_different_projects(service_fixture):
    """Project A and Project B render concurrently; global gate ensures concurrency == 1."""
    fx = service_fixture
    _create_project(fx["workdir"], "projB", "export_002")

    active_executions = 0
    max_active_executions = 0

    async def run(build, scratch_dir, cancel_event, progress_cb, expected_frames):
        nonlocal active_executions, max_active_executions
        active_executions += 1
        max_active_executions = max(max_active_executions, active_executions)
        await asyncio.sleep(0.05)
        candidate = scratch_dir / "candidate.mp4"
        candidate.write_bytes(b"cand" * 100)
        await progress_cb({"frame": expected_frames, "progress": "end"})
        active_executions -= 1
        return {"return_code": 0, "stderr_tail": "", "max_frame": expected_frames}

    fx["service"].run_attempt_fn = run

    async def scenario():
        start_a = await fx["service"].start_final_render(
            project_id="proj", export_id="export_001", encoder_profile="FINAL_QUALITY")
        start_b = await fx["service"].start_final_render(
            project_id="projB", export_id="export_002", encoder_profile="FINAL_QUALITY")
        job_a, job_b = await asyncio.gather(
            fx["service"].wait_for_job(start_a["jobId"], timeout=30),
            fx["service"].wait_for_job(start_b["jobId"], timeout=30),
        )
        return job_a, job_b

    job_a, job_b = asyncio.run(scenario())
    assert job_a["status"] == JobStatus.COMPLETED
    assert job_b["status"] == JobStatus.COMPLETED
    assert max_active_executions == 1, f"Expected concurrency 1, got {max_active_executions}"


def test_final_artifact_lifecycle_boundary_not_ready(service_fixture):
    """After successful Final Render, Artifact is NEVER marked READY; status is NEEDS_REVIEW."""
    fx = service_fixture
    fx["service"].run_attempt_fn = _success_attempt_factory()

    async def scenario():
        started = await fx["service"].start_final_render(
            project_id=fx["project_id"], export_id="export_001",
            encoder_profile="FINAL_QUALITY")
        return await fx["service"].wait_for_job(started["jobId"], timeout=30)

    job = asyncio.run(scenario())
    assert job["status"] == JobStatus.COMPLETED
    # Existing authority: metadata on job
    assert job["metadata"]["artifactStatus"] == "NEEDS_REVIEW"
    assert job["metadata"]["artifactReasonCode"] == "PENDING_RENDER_QA"
    assert job["metadata"]["artifactStatus"] != "READY"


def test_render_metadata_provenance_contents(service_fixture):
    """Verify render-metadata.json contains all required provenance keys."""
    fx = service_fixture
    fx["service"].run_attempt_fn = _success_attempt_factory()

    async def scenario():
        started = await fx["service"].start_final_render(
            project_id=fx["project_id"], export_id="export_001",
            encoder_profile="FINAL_QUALITY")
        return await fx["service"].wait_for_job(started["jobId"], timeout=30)

    job = asyncio.run(scenario())
    assert job["status"] == JobStatus.COMPLETED

    meta_file = fx["workdir"] / "proj" / "exports" / "export_001" / "render-metadata.json"
    assert meta_file.is_file(), f"Missing {meta_file}"

    data = json.loads(meta_file.read_text(encoding="utf-8"))
    required_keys = [
        "jobId", "projectId", "exportId", "manifestHash", "ffmpegVersion",
        "encoderProfileRequested", "encoderActuallyUsed", "encoderProfileVersion",
        "fallbackAttempted", "attemptHistory", "expectedFrames", "subtitleMode",
        "completedAt"
    ]
    for key in required_keys:
        assert key in data, f"Missing required provenance key: {key} in render-metadata.json"
    assert data["jobId"] == job["jobId"]
    assert data["projectId"] == "proj"
    assert data["exportId"] == "export_001"

