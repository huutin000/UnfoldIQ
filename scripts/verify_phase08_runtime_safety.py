"""Phase 8 Task 11: Runtime Safety, Cancellation, Crash Recovery & Races Verification.
Usage: python scripts/verify_phase08_runtime_safety.py
Evidence: temp/phase08_verification/runtime_safety/results.json
"""
import asyncio
import hashlib
import json
import shutil
import sys
import tempfile
import time
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from studio.final_artifact_publisher import (
    AlreadyRenderedError,
    publish_candidate,
)
from studio.jobs_manager import JobStatus, JobsManager, _atomic_write_json
from studio.manifest_render_service import (
    ManifestRenderService,
    reconcile_final_render_jobs,
)
from studio.manifest_render_types import (
    FinalRenderExecutionPhase,
    RenderFailureCode,
)
from studio.render_manifest_hashing import compute_manifest_hash
from studio.timeline_compiler import compile_render_manifest

OUT = Path("temp/phase08_verification/runtime_safety")
OUT.mkdir(parents=True, exist_ok=True)


class SafetyCountingScheduler:
    def __init__(self):
        self.acquired = []
        self.released = []
        self.held = {"CPU_BOUND": 0, "GPU_ENCODER": 0}

    async def submit_job(self, job_id, job_type, resource_class, coro_fn):
        self.acquired.append(resource_class)
        self.held[resource_class] = self.held.get(resource_class, 0) + 1
        try:
            return await coro_fn()
        finally:
            self.held[resource_class] -= 1
            self.released.append(resource_class)


def _create_mock_project(root: Path, proj_name: str = "proj_safety"):
    pdir = root / proj_name
    (pdir / "assets").mkdir(parents=True, exist_ok=True)
    media = b"\x89PNG\r\n\x1a\n" + b"\x00" * 200
    (pdir / "assets" / "s1.png").write_bytes(media)

    with wave.open(str(pdir / "audio.wav"), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(24000)
        w.writeframes(b"\x00" * int(24000 * 4.0) * 2)

    (pdir / "script.txt").write_text("safety test narration")
    (pdir / "timestamps.srt").write_text("1\n00:00:00,000 --> 00:00:04,000\nSafety\n")
    (pdir / "timestamps.json").write_text(json.dumps({"audio_duration": 4.0}))
    (pdir / "scene_plan.json").write_text(json.dumps({
        "scenes": [{"scene_id": "scene_001", "index": 1}]}))
    (pdir / "veo_prompts.json").write_text(json.dumps({
        "shots": [{"shot_id": "shot_001", "scene_id": "scene_001",
                   "start": 0.0, "end": 4.0, "duration": 4.0, "index": 1}]}))
    (pdir / "assets" / "intake_ledger.json").write_text(json.dumps({
        "assets": [{"id": "A1", "scene_id": "scene_001", "shot_id": "shot_001",
                    "lifecycle": "LOCKED",
                    "checksum": hashlib.sha256(media).hexdigest(),
                    "version": 1, "filePath": "assets/s1.png"}]}))

    res = compile_render_manifest(pdir, "export_001")
    assert res.persisted is True
    return pdir


async def run_scenario_1_queued_cancel():
    """Scenario 1: Cancel requested while job is in QUEUED state."""
    tmp = Path(tempfile.mkdtemp(prefix="phase08_safety_s1_"))
    try:
        pdir = _create_mock_project(tmp)
        jobs = JobsManager(runtime_dir=tmp / "runtime", projects_dir=tmp)
        sched = SafetyCountingScheduler()
        svc = ManifestRenderService(tmp, jobs=jobs, scheduler=sched)

        launches = []
        async def dummy_run(build, scratch, cancel_ev, progress_cb, frames):
            launches.append(1)
            return {"return_code": 0, "stderr_tail": "", "max_frame": frames}
        svc.run_attempt_fn = dummy_run

        started = await svc.start_final_render("proj_safety", "export_001", "FINAL_QUALITY")
        job_id = started["jobId"]

        # Cancel immediately
        cancel_res = await svc.cancel_final_render("proj_safety", job_id)
        job = await svc.wait_for_job(job_id, timeout=10.0)

        final_path = pdir / "exports" / "export_001" / "final.mp4"
        scratch_dir = pdir / "renders" / f".scratch_{job_id}"
        has_candidate = (scratch_dir / "candidate.mp4").exists()

        assert job["status"] == JobStatus.CANCELLED
        assert len(launches) == 0, "FFmpeg should not launch for cancelled queued job"
        assert not final_path.exists(), "final.mp4 should not exist"
        assert not has_candidate, "scratch candidate should not remain"

        return {
            "scenario": "queued_cancel",
            "passed": True,
            "status": job["status"],
            "launches": len(launches),
            "finalExists": final_path.exists(),
        }
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


async def run_scenario_2_running_cancel():
    """Scenario 2: Cancel during active execution with graceful subprocess stop."""
    tmp = Path(tempfile.mkdtemp(prefix="phase08_safety_s2_"))
    try:
        pdir = _create_mock_project(tmp)
        jobs = JobsManager(runtime_dir=tmp / "runtime", projects_dir=tmp)
        sched = SafetyCountingScheduler()
        svc = ManifestRenderService(tmp, jobs=jobs, scheduler=sched)

        started_running = asyncio.Event()

        async def controllable_run(build, scratch, cancel_ev, progress_cb, frames):
            started_running.set()
            # Wait until cancellation arrives
            for _ in range(50):
                if cancel_ev.is_set():
                    return {"return_code": -15, "stderr_tail": "Terminated by cancel", "max_frame": 10}
                await asyncio.sleep(0.05)
            return {"return_code": 0, "stderr_tail": "", "max_frame": frames}

        svc.run_attempt_fn = controllable_run

        started = await svc.start_final_render("proj_safety", "export_001", "FINAL_QUALITY")
        job_id = started["jobId"]

        # Wait until runner starts
        await asyncio.wait_for(started_running.wait(), timeout=5.0)
        # Request cancel
        await svc.cancel_final_render("proj_safety", job_id)

        job = await svc.wait_for_job(job_id, timeout=10.0)
        final_path = pdir / "exports" / "export_001" / "final.mp4"

        assert job["status"] == JobStatus.CANCELLED
        assert not final_path.exists(), "candidate should never be published on cancel"
        assert sched.held["CPU_BOUND"] == 0, "all resource permits must be released"
        assert len(sched.acquired) == len(sched.released)

        return {
            "scenario": "running_cancel",
            "passed": True,
            "status": job["status"],
            "permitsHeld": sched.held,
            "permitsReleased": len(sched.released),
            "finalExists": final_path.exists(),
        }
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


async def run_scenario_3_cancel_after_encode_before_publish():
    """Scenario 3: Cancel requested right after encode returns, before publish guard."""
    tmp = Path(tempfile.mkdtemp(prefix="phase08_safety_s3_"))
    try:
        pdir = _create_mock_project(tmp)
        jobs = JobsManager(runtime_dir=tmp / "runtime", projects_dir=tmp)
        sched = SafetyCountingScheduler()
        svc = ManifestRenderService(tmp, jobs=jobs, scheduler=sched)

        current_job_id = [None]
        async def fast_encode_then_cancel(build, scratch, cancel_ev, progress_cb, frames):
            (scratch / "candidate.mp4").write_bytes(b"dummy candidate data")
            if current_job_id[0]:
                await svc.cancel_final_render("proj_safety", current_job_id[0])
            return {"return_code": 0, "stderr_tail": "", "max_frame": frames}

        svc.run_attempt_fn = fast_encode_then_cancel

        started = await svc.start_final_render("proj_safety", "export_001", "FINAL_QUALITY")
        job_id = started["jobId"]
        current_job_id[0] = job_id

        job = await svc.wait_for_job(job_id, timeout=10.0)
        final_path = pdir / "exports" / "export_001" / "final.mp4"

        assert job["status"] == JobStatus.CANCELLED
        assert not final_path.exists(), "must not publish candidate when cancel requested"

        return {
            "scenario": "cancel_after_encode_before_publish",
            "passed": True,
            "status": job["status"],
            "finalExists": final_path.exists(),
        }
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


async def run_scenario_4_late_cancel_after_publish():
    """Scenario 4: Cancel requested after publication commit."""
    tmp = Path(tempfile.mkdtemp(prefix="phase08_safety_s4_"))
    try:
        pdir = _create_mock_project(tmp)
        jobs = JobsManager(runtime_dir=tmp / "runtime", projects_dir=tmp)
        sched = SafetyCountingScheduler()
        svc = ManifestRenderService(tmp, jobs=jobs, scheduler=sched)

        async def successful_run(build, scratch, cancel_ev, progress_cb, frames):
            (scratch / "candidate.mp4").write_bytes(b"good candidate mp4")
            return {"return_code": 0, "stderr_tail": "", "max_frame": frames}

        svc.run_attempt_fn = successful_run

        started = await svc.start_final_render("proj_safety", "export_001", "FINAL_QUALITY")
        job_id = started["jobId"]
        job = await svc.wait_for_job(job_id, timeout=10.0)

        final_path = pdir / "exports" / "export_001" / "final.mp4"
        assert final_path.is_file()
        orig_bytes = final_path.read_bytes()

        # Now issue late cancel
        late_res = await svc.cancel_final_render("proj_safety", job_id)

        assert late_res.get("errorCode") == RenderFailureCode.JOB_ALREADY_COMPLETED.value
        assert job["status"] == JobStatus.COMPLETED
        assert final_path.read_bytes() == orig_bytes, "final.mp4 must remain byte-identical"

        return {
            "scenario": "late_cancel_after_publish",
            "passed": True,
            "lateCancelCode": late_res.get("errorCode"),
            "status": job["status"],
            "fileIdentical": True,
        }
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def run_scenario_5_crash_reconciliation():
    """Scenario 5: Crash-state reconciliation matrix."""
    tmp = Path(tempfile.mkdtemp(prefix="phase08_safety_s5_"))
    try:
        jobs = JobsManager(runtime_dir=tmp / "runtime", projects_dir=tmp)
        pdir = tmp / "proj_crash"
        exp_dir = pdir / "exports" / "export_001"
        exp_dir.mkdir(parents=True, exist_ok=True)

        manifest_data = {"manifestHash": "mhash123", "exportId": "export_001", "scenes": []}
        (exp_dir / "render-manifest.json").write_text(json.dumps(manifest_data))
        mhash = compute_manifest_hash(manifest_data)

        def _seed(jid, status, phase, with_final=False, m_hash=mhash):
            job = jobs.create_job("FINAL_RENDER", project_id="proj_crash", metadata={
                "exportId": "export_001", "manifestHash": m_hash,
                "encoderProfileRequested": "FINAL_QUALITY",
                "executionPhase": phase, "attempts": []})
            old_id = job["jobId"]
            job["jobId"] = jid
            job["id"] = jid
            job["status"] = status
            _atomic_write_json(tmp / "runtime" / f"{old_id}.json", {"superseded": True})
            (tmp / "runtime" / f"{old_id}.json").unlink(missing_ok=True)
            jdir = pdir / "jobs"
            jdir.mkdir(parents=True, exist_ok=True)
            _atomic_write_json(jdir / f"{jid}.json", job)
            jobs._jobs.pop(old_id, None)
            jobs._jobs[jid] = job

            if with_final:
                (exp_dir / "final.mp4").write_bytes(b"canonical-final-bytes")
            return job

        # 1. QUEUED / no final -> remains QUEUED
        _seed("j-queued", JobStatus.QUEUED, FinalRenderExecutionPhase.PREPARING.value)
        # 2. RUNNING + ENCODING / no final -> INTERRUPTED
        _seed("j-encoding", JobStatus.RUNNING, FinalRenderExecutionPhase.ENCODING.value)
        # 3. RUNNING + CANDIDATE_READY / no final -> INTERRUPTED (candidate not auto-promoted)
        _seed("j-cand", JobStatus.RUNNING, FinalRenderExecutionPhase.CANDIDATE_READY.value)
        (pdir / "renders" / ".scratch_j-cand").mkdir(parents=True, exist_ok=True)
        (pdir / "renders" / ".scratch_j-cand" / "candidate.mp4").write_bytes(b"candidate-orphan")
        # 4. COMPLETED / final absent -> FAILED
        _seed("j-ghost", JobStatus.COMPLETED, FinalRenderExecutionPhase.PUBLISHED.value)

        out = reconcile_final_render_jobs(jobs, tmp)

        assert jobs.get_job("j-queued")["status"] == JobStatus.QUEUED
        assert jobs.get_job("j-encoding")["status"] == JobStatus.INTERRUPTED
        assert jobs.get_job("j-cand")["status"] == JobStatus.INTERRUPTED
        assert not (exp_dir / "final.mp4").exists(), "Candidate must not be auto-promoted"
        assert jobs.get_job("j-ghost")["status"] == JobStatus.FAILED
        assert jobs.get_job("j-ghost")["metadata"]["errorCode"] == "OUTPUT_CANDIDATE_MISSING"

        # 5. RUNNING + PUBLISHING with valid final -> COMPLETED with metadata repair
        (exp_dir / "final.mp4").write_bytes(b"real-final-bytes")
        _seed("j-pub", JobStatus.RUNNING, FinalRenderExecutionPhase.PUBLISHING.value, with_final=True)
        out2 = reconcile_final_render_jobs(jobs, tmp)
        assert jobs.get_job("j-pub")["status"] == JobStatus.COMPLETED
        assert (exp_dir / "render-metadata.json").is_file()

        return {
            "scenario": "crash_reconciliation",
            "passed": True,
            "reconciledCount": len(out["reconciled"]) + len(out2["reconciled"]),
        }
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def run_scenario_6_competing_publish():
    """Scenario 6: Competing publisher race on the same export."""
    tmp = Path(tempfile.mkdtemp(prefix="phase08_safety_s6_"))
    try:
        exp_dir = tmp / "proj" / "exports" / "export_race"
        exp_dir.mkdir(parents=True, exist_ok=True)

        c1 = tmp / "c1.mp4"
        c1.write_bytes(b"A" * 1024)
        c2 = tmp / "c2.mp4"
        c2.write_bytes(b"B" * 1024)

        prov1 = {"exportId": "export_race", "renderJobId": "job1", "tag": "first"}
        prov2 = {"exportId": "export_race", "renderJobId": "job2", "tag": "second"}

        r1 = publish_candidate(c1, exp_dir, prov1)
        assert r1.final_path.is_file()
        first_bytes = r1.final_path.read_bytes()

        # Second publisher must raise AlreadyRenderedError
        second_caught = False
        try:
            publish_candidate(c2, exp_dir, prov2)
        except AlreadyRenderedError:
            second_caught = True

        assert second_caught, "Second competing publisher must receive AlreadyRenderedError"
        assert (exp_dir / "final.mp4").read_bytes() == first_bytes, "Final must never be corrupted"

        return {
            "scenario": "competing_publish",
            "passed": True,
            "secondCaught": second_caught,
            "dataCorrupted": False,
        }
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


async def run_scenario_7_scratch_cleanup():
    """Scenario 7: Scratch candidate removed while diagnostics are preserved."""
    tmp = Path(tempfile.mkdtemp(prefix="phase08_safety_s7_"))
    try:
        pdir = _create_mock_project(tmp)
        jobs = JobsManager(runtime_dir=tmp / "runtime", projects_dir=tmp)
        sched = SafetyCountingScheduler()
        svc = ManifestRenderService(tmp, jobs=jobs, scheduler=sched)

        async def encode_with_logs(build, scratch, cancel_ev, progress_cb, frames):
            (scratch / "candidate.mp4").write_bytes(b"heavy media" * 10000)
            (scratch / "ffmpeg.log").write_text("ffmpeg diagnostics line 1\nline 2")
            return {"return_code": 0, "stderr_tail": "", "max_frame": frames}

        svc.run_attempt_fn = encode_with_logs

        started = await svc.start_final_render("proj_safety", "export_001", "FINAL_QUALITY")
        job_id = started["jobId"]
        job = await svc.wait_for_job(job_id, timeout=10.0)

        scratch_dir = pdir / "renders" / f".scratch_{job_id}"
        candidate_file = scratch_dir / "candidate.mp4"
        log_file = scratch_dir / "ffmpeg.log"
        plan_file = scratch_dir / "execution-plan.json"

        assert not candidate_file.exists(), "Heavy candidate file must be removed after publish"
        assert log_file.exists(), "Diagnostics log file must be preserved"
        assert plan_file.exists(), "Execution plan must be preserved for post-mortem diagnostics"

        return {
            "scenario": "scratch_cleanup",
            "passed": True,
            "candidateRemoved": not candidate_file.exists(),
            "diagnosticsPreserved": log_file.exists() and plan_file.exists(),
        }
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


async def async_main():
    print("=== UnfoldIQ Phase 8 Runtime Safety Verification ===")
    results = []

    s1 = await run_scenario_1_queued_cancel()
    print(f"[PASS] Scenario 1 (Queued Cancel): launches={s1['launches']}")
    results.append(s1)

    s2 = await run_scenario_2_running_cancel()
    print(f"[PASS] Scenario 2 (Running Cancel): permitsReleased={s2['permitsReleased']}")
    results.append(s2)

    s3 = await run_scenario_3_cancel_after_encode_before_publish()
    print(f"[PASS] Scenario 3 (Cancel Before Publish): finalExists={s3['finalExists']}")
    results.append(s3)

    s4 = await run_scenario_4_late_cancel_after_publish()
    print(f"[PASS] Scenario 4 (Late Cancel): lateCancelCode={s4['lateCancelCode']}")
    results.append(s4)

    s5 = run_scenario_5_crash_reconciliation()
    print(f"[PASS] Scenario 5 (Crash Reconciliation): count={s5['reconciledCount']}")
    results.append(s5)

    s6 = run_scenario_6_competing_publish()
    print(f"[PASS] Scenario 6 (Competing Publish Race): secondCaught={s6['secondCaught']}")
    results.append(s6)

    s7 = await run_scenario_7_scratch_cleanup()
    print(f"[PASS] Scenario 7 (Scratch Cleanup): candidateRemoved={s7['candidateRemoved']}")
    results.append(s7)

    payload = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "totalScenarios": len(results),
        "passed": all(r["passed"] for r in results),
        "results": results,
    }

    out_file = OUT / "results.json"
    out_file.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"\nSaved runtime safety evidence to: {out_file.resolve()}")


if __name__ == "__main__":
    asyncio.run(async_main())
