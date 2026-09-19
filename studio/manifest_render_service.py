"""Phase 8 ManifestRenderService: persistent Final Render orchestration.

Single coordinator over verifier/planner/builder/runner/publisher using the
existing jobs_manager storage, LocalResourceScheduler permits, and one
process-wide FINAL_RENDER gate (concurrency 1, held across NVENC->CPU
fallback). Post-render artifact state persists on the existing job record
(metadata.artifactStatus/artifactReasonCode) — no second artifact JSON, no
new PENDING_QA enum, render success never means READY.
"""
import asyncio
import logging
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable

from studio import jobs_manager as _jobs_module
from studio.final_artifact_publisher import (
    AlreadyRenderedError,
    PublishError,
    publish_candidate,
    repair_missing_metadata,
)
from studio.ffmpeg_graph_builder import GraphBuildError, build_ffmpeg_execution
from studio.ffmpeg_process_runner import run_process_with_cancel
from studio.jobs_manager import JobStatus
from studio.manifest_integrity import ManifestIntegrityError, verify_render_snapshot
from studio.manifest_render_types import (
    FALLBACK_ELIGIBLE_CODES,
    EncoderProfileName,
    FinalRenderExecutionPhase,
    RenderAttemptResult,
    RenderFailureCode,
    candidate_path_for,
    canonical_final_for,
    scratch_dir_for,
)
from studio.render_failure_classifier import classify_render_failure
from studio.render_planner import RenderPlanError, build_render_execution_plan
from studio.render_profiles import get_ducking_preset, get_encoder_profile

logger = logging.getLogger("unfoldiq.manifest_render")

TERMINAL_JOB_STATUSES = frozenset({
    JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED,
    JobStatus.INTERRUPTED,
})

_VALID_PROFILES = ("FINAL_QUALITY", "ACCELERATED")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class ManifestRenderService:
    """Orchestrates manifest-driven Final Render jobs (injectable for tests)."""

    progress_interval = 0.75
    grace_seconds = 5.0

    def __init__(self, projects_dir: Path, jobs=None, scheduler=None,
                 ffmpeg_path: str = "ffmpeg", run_attempt_fn=None,
                 qa_service_factory=None):
        self.projects_dir = Path(projects_dir)
        self.jobs = jobs or _jobs_module.jobs_manager
        self.scheduler = scheduler
        self.ffmpeg_path = ffmpeg_path
        self.run_attempt_fn = run_attempt_fn
        self.qa_service_factory = qa_service_factory
        self._final_gate = asyncio.Semaphore(1)
        self._cancel_events: dict[str, asyncio.Event] = {}
        self._ffmpeg_version: str | None = None

    # -- public API ------------------------------------------------------
    async def start_final_render(self, project_id: str, export_id: str,
                                 encoder_profile: str = "FINAL_QUALITY") -> dict:
        if encoder_profile not in _VALID_PROFILES:
            return {"errorCode": "INVALID_MANIFEST",
                    "message": f"unknown encoderProfile {encoder_profile!r}"}
        project_dir = self.projects_dir / project_id
        if not project_dir.is_dir():
            return {"errorCode": "INVALID_MANIFEST",
                    "message": f"unknown project {project_id!r}"}
        final_path = canonical_final_for(project_dir, export_id)
        if final_path.is_file():
            return {"errorCode": RenderFailureCode.ALREADY_RENDERED.value,
                    "finalPath": str(final_path)}
        existing = _jobs_module.find_active_project_job(
            project_id, "FINAL_RENDER", export_id, manager=self.jobs)
        if existing:
            return self._summary(existing, reused=True)
        try:
            snapshot = verify_render_snapshot(project_dir, export_id)
        except ManifestIntegrityError as e:
            return {"errorCode": e.code.value, "message": str(e)}
        job = self.jobs.create_job(
            "FINAL_RENDER", project_id=project_id,
            metadata={"exportId": export_id,
                      "manifestHash": snapshot.manifest.manifestHash,
                      "encoderProfileRequested": encoder_profile,
                      "executionPhase": FinalRenderExecutionPhase.PREPARING.value,
                      "attempts": [], "fallbackAttempted": False,
                      "frame": 0, "fps": 0.0, "outTime": None, "eta": None,
                      "errorCode": None, "errorMessage": None, "stderrTail": "",
                      "cancelRequestedAt": None})
        self._cancel_events[job["jobId"]] = asyncio.Event()
        asyncio.ensure_future(self._run_job(job["jobId"]))
        return self._summary(self.jobs.get_job(job["jobId"]), reused=False)

    async def wait_for_job(self, job_id: str, timeout: float = 120.0) -> dict:
        t0 = time.perf_counter()
        while time.perf_counter() - t0 < timeout:
            job = self.jobs.get_job(job_id)
            if job and job.get("status") in TERMINAL_JOB_STATUSES:
                return job
            await asyncio.sleep(0.2)
        raise TimeoutError(f"job {job_id} not terminal within {timeout}s")

    async def cancel_final_render(self, project_id: str, job_id: str) -> dict:
        job = self.jobs.get_job(job_id)
        if not job or job.get("projectId") != project_id:
            return {"errorCode": "UNKNOWN_RENDER_ERROR", "message": "job not found"}
        status = job.get("status")
        if status == JobStatus.COMPLETED:
            return {"errorCode": RenderFailureCode.JOB_ALREADY_COMPLETED.value,
                    "jobId": job_id, "status": status}
        if status in (JobStatus.FAILED, JobStatus.CANCELLED, JobStatus.INTERRUPTED):
            return {"jobId": job_id, "status": status, "reused": True}
        _jobs_module.patch_project_job(
            project_id, job_id, manager=self.jobs,
            metadata={"cancelRequestedAt": _now_iso()})
        ev = self._cancel_events.get(job_id)
        if ev is not None:
            ev.set()
        if status == JobStatus.QUEUED:
            self.jobs.cancel_job(job_id)
        return {"jobId": job_id, "cancelRequested": True}

    # -- orchestration ---------------------------------------------------
    async def _run_job(self, job_id: str) -> None:
        job = self.jobs.get_job(job_id)
        if not job:
            return
        project_id = job["projectId"]
        project_dir = self.projects_dir / project_id
        meta = job.get("metadata", {})
        export_id = meta.get("exportId")
        requested = meta.get("encoderProfileRequested", "FINAL_QUALITY")
        if (meta.get("cancelRequestedAt")
                or job.get("status") == JobStatus.CANCELLED):
            return
        async with self._final_gate:
            job = self.jobs.get_job(job_id)
            if not job or job.get("status") == JobStatus.CANCELLED:
                return
            _jobs_module.patch_project_job(
                project_id, job_id, manager=self.jobs,
                metadata={"executionPhase": FinalRenderExecutionPhase.WAITING_RESOURCE.value})
            profile = get_encoder_profile(EncoderProfileName(requested))
            resource = profile.resource_class.value
            try:
                if self.scheduler is not None:
                    await self.scheduler.submit_job(
                        job_id, "FINAL_RENDER", resource,
                        lambda: self._execute_attempts(job_id, profile, resource))
                else:
                    await self._execute_attempts(job_id, profile, resource)
            except Exception as e:  # never leak the global gate with stale state
                job = self.jobs.get_job(job_id)
                if job and job.get("status") not in TERMINAL_JOB_STATUSES:
                    _jobs_module.patch_project_job(
                        project_id, job_id, manager=self.jobs,
                        status=JobStatus.FAILED,
                        message=f"Render orchestration failed: {e}",
                        metadata={"errorCode": RenderFailureCode.UNKNOWN_RENDER_ERROR.value,
                                  "errorMessage": str(e)[:500]})

    async def _execute_attempts(self, job_id: str, profile, resource: str) -> dict:
        from studio.domain_models import ResourceClass
        job = self.jobs.get_job(job_id)
        project_id, project_dir = job["projectId"], self.projects_dir / job["projectId"]
        meta = job.get("metadata", {})
        export_id = meta["exportId"]
        _jobs_module.patch_project_job(
            project_id, job_id, manager=self.jobs, status=JobStatus.RUNNING,
            message="Đang kết xuất",
            metadata={"executionPhase": FinalRenderExecutionPhase.PREPARING.value})
        try:
            snapshot = verify_render_snapshot(project_dir, export_id)
        except ManifestIntegrityError as e:
            return self._fail(job_id, e.code, str(e))
        scratch = scratch_dir_for(project_dir, job_id)
        scratch.mkdir(parents=True, exist_ok=True)
        try:
            plan = build_render_execution_plan(
                snapshot, EncoderProfileName(meta.get("encoderProfileRequested",
                                                       "FINAL_QUALITY")), scratch)
        except RenderPlanError as e:
            code = getattr(e, "code", RenderFailureCode.INVALID_MANIFEST)
            return self._fail(job_id, code, str(e))
        try:
            build = build_ffmpeg_execution(plan)
        except GraphBuildError as e:
            return self._fail(job_id, e.code, str(e))
        except RenderPlanError as e:
            return self._fail(job_id, RenderFailureCode.INVALID_MANIFEST, str(e))
        (scratch / "execution-plan.json").write_text(
            __import__("json").dumps(
                {"exportId": export_id, "manifestHash": plan.manifest_hash,
                 "expectedFinalFrames": plan.expected_final_frames,
                 "strategy": plan.composition_strategy.value,
                 "encoderProfile": profile.name.value}, indent=2),
            encoding="utf-8")
        cancel_event = self._cancel_events.get(job_id) or asyncio.Event()
        self._cancel_events[job_id] = cancel_event
        _jobs_module.patch_project_job(
            project_id, job_id, manager=self.jobs,
            metadata={"executionPhase": FinalRenderExecutionPhase.ENCODING.value})

        attempts = list(meta.get("attempts", []))
        fallback_done = False
        current_profile, current_resource = profile, resource
        attempt_no = 0
        while True:
            attempt_no += 1
            if self._cancel_requested(job_id):
                return await self._finish_cancelled(job_id, scratch)
            started = _now_iso()
            raw = await self._run_attempt(build, scratch, cancel_event,
                                          job_id, plan.expected_final_frames)
            classification = classify_render_failure(
                raw.get("stderr_tail", ""), current_profile.video_encoder,
                "ENCODING", raw.get("return_code", 1),
                self._cancel_requested(job_id))
            if self._cancel_requested(job_id) or classification.code == RenderFailureCode.CANCELLED:
                return await self._finish_cancelled(job_id, scratch)
            record = {"attempt": attempt_no, "encoder": current_profile.video_encoder,
                      "profileVersion": current_profile.version, "status": "RUNNING",
                      "errorCode": None, "startedAt": started, "completedAt": None}
            attempts.append(record)
            self._save_attempts(job_id, attempts)
            if raw.get("return_code") == 0:
                if (raw.get("max_frame", 0) or 0) < plan.expected_final_frames:
                    record.update(status="FAILED", completedAt=_now_iso(),
                                  errorCode=RenderFailureCode.RENDER_FRAME_UNDERRUN.value)
                    self._save_attempts(job_id, attempts)
                    return self._fail(job_id, RenderFailureCode.RENDER_FRAME_UNDERRUN,
                                      "encoded fewer frames than manifest")
                record.update(status="SUCCESS", completedAt=_now_iso())
                self._save_attempts(job_id, attempts)
                return await self._publish_success(
                    job_id, build, plan, current_profile, meta, attempts, fallback_done)
            record.update(status="FAILED", completedAt=_now_iso(),
                          errorCode=classification.code.value)
            self._save_attempts(job_id, attempts)
            if (not fallback_done and classification.fallback_eligible
                    and current_profile.name == EncoderProfileName.ACCELERATED):
                fallback_done = True
                # Release GPU permit, keep global FINAL_RENDER slot, take CPU.
                if self.scheduler is not None:
                    cpu = ResourceClass.CPU_BOUND.value
                    return await self.scheduler.submit_job(
                        f"{job_id}-fallback", "FINAL_RENDER", cpu,
                        lambda: self._fallback_attempt(
                            job_id, snapshot, scratch, cancel_event,
                            attempts, meta))
                return await self._fallback_attempt(
                    job_id, snapshot, scratch, cancel_event, attempts, meta)
            return self._fail(job_id, classification.code,
                              raw.get("stderr_tail", "")[-500:])

    async def _fallback_attempt(self, job_id, snapshot, scratch, cancel_event,
                                attempts, meta):
        from studio.render_profiles import FINAL_QUALITY_V1
        job = self.jobs.get_job(job_id)
        _jobs_module.patch_project_job(
            job["projectId"], job_id, manager=self.jobs,
            metadata={"fallbackAttempted": True,
                      "encoderActuallyUsed": FINAL_QUALITY_V1.video_encoder})
        plan = build_render_execution_plan(
            snapshot, EncoderProfileName.FINAL_QUALITY, scratch)
        build = build_ffmpeg_execution(plan, EncoderProfileName.FINAL_QUALITY)
        raw = await self._run_attempt(build, scratch, cancel_event, job_id,
                                      plan.expected_final_frames)
        classification = classify_render_failure(
            raw.get("stderr_tail", ""), "libx264", "ENCODING",
            raw.get("return_code", 1), self._cancel_requested(job_id))
        if self._cancel_requested(job_id):
            return await self._finish_cancelled(job_id, scratch)
        record = {"attempt": len(attempts) + 1, "encoder": "libx264",
                  "profileVersion": FINAL_QUALITY_V1.version,
                  "status": "RUNNING", "errorCode": None,
                  "startedAt": _now_iso(), "completedAt": None}
        attempts.append(record)
        self._save_attempts(job_id, attempts)
        if raw.get("return_code") == 0:
            if (raw.get("max_frame", 0) or 0) >= plan.expected_final_frames:
                record.update(status="SUCCESS", completedAt=_now_iso())
                self._save_attempts(job_id, attempts)
                return await self._publish_success(
                    job_id, build, plan, FINAL_QUALITY_V1, meta, attempts, True)
            record.update(status="FAILED", completedAt=_now_iso(),
                          errorCode=RenderFailureCode.RENDER_FRAME_UNDERRUN.value)
            self._save_attempts(job_id, attempts)
            return self._fail(job_id, RenderFailureCode.RENDER_FRAME_UNDERRUN,
                              "fallback encoded fewer frames than manifest")
        record.update(status="FAILED", completedAt=_now_iso(),
                      errorCode=classification.code.value)
        self._save_attempts(job_id, attempts)
        return self._fail(job_id, classification.code, raw.get("stderr_tail", "")[-500:])

    async def _run_attempt(self, build, scratch, cancel_event, job_id,
                           expected_frames) -> dict:
        if self.run_attempt_fn is not None:
            return await self.run_attempt_fn(build, scratch, cancel_event,
                                             lambda e: self._on_progress(job_id, e),
                                             expected_frames)
        res = await run_process_with_cancel(
            [self.ffmpeg_path, *build.argv[1:]], scratch / "ffmpeg.log",
            cancel_event, self.grace_seconds,
            lambda e: self._on_progress(job_id, e), expected_frames,
            cwd=getattr(build, "cwd", None))
        return {"return_code": res.return_code, "stderr_tail": res.stderr_tail,
                "max_frame": res.max_frame_seen}

    async def _on_progress(self, job_id: str, event: dict) -> None:
        job = self.jobs.get_job(job_id)
        if not job:
            return
        meta = job.get("metadata", {})
        last = float(meta.get("_lastProgressAt", 0) or 0)
        now = time.perf_counter()
        if now - last < self.progress_interval and event.get("progress") != "end":
            return
        frame = event.get("frame", 0) or 0
        try:
            frame = int(frame)
        except (TypeError, ValueError):
            frame = 0
        expected = int(meta.get("expectedFrames") or 0)
        percent = min(99, int(frame * 100 / expected)) if expected else 0
        fps = event.get("fps", 0.0) or 0.0
        try:
            fps = float(fps)
        except (TypeError, ValueError):
            fps = 0.0
        eta = round((expected - frame) / fps, 1) if fps > 0 and expected else None
        _jobs_module.patch_project_job(
            job["projectId"], job_id, manager=self.jobs,
            progress=percent / 100,
            metadata={"frame": frame, "fps": fps,
                      "outTime": event.get("out_time"),
                      "eta": eta, "_lastProgressAt": now})

    async def _publish_success(self, job_id, build, plan, profile_used, meta,
                               attempts, fallback_done):
        from studio.final_artifact_publisher import AlreadyRenderedError as _ARE
        job = self.jobs.get_job(job_id)
        project_id, project_dir = job["projectId"], self.projects_dir / job["projectId"]
        export_id = meta["exportId"]
        if self._cancel_requested(job_id):
            return await self._finish_cancelled(job_id, scratch_dir_for(project_dir, job_id))
        _jobs_module.patch_project_job(
            project_id, job_id, manager=self.jobs,
            metadata={"executionPhase": FinalRenderExecutionPhase.CANDIDATE_READY.value})
        export_dir = project_dir / "exports" / export_id
        provenance = {"jobId": job_id, "projectId": project_id,
                      "exportId": export_id, "manifestHash": plan.manifest_hash,
                      "renderJobId": job_id, "renderEngine": "ffmpeg",
                      "ffmpegVersion": self._ffmpeg_version_text(),
                      "encoderProfileRequested": meta.get("encoderProfileRequested"),
                      "encoderActuallyUsed": profile_used.video_encoder,
                      "encoderProfileVersion": profile_used.version,
                      "fallbackAttempted": fallback_done,
                      "attemptHistory": attempts,
                      "attemptSummary": attempts,
                      "expectedFrames": plan.expected_final_frames,
                      "expectedFinalFrames": plan.expected_final_frames,
                      "subtitleMode": ("burn-in" if plan.subtitle.burn_in
                                       else ("soft" if plan.subtitle.path else "none")),
                      "subtitleCodec": ("mov_text" if plan.subtitle.path
                                        and not plan.subtitle.burn_in else None),
                      "duckingPreset": plan.audio.ducking_preset_name}
        _jobs_module.patch_project_job(
            project_id, job_id, manager=self.jobs,
            metadata={"executionPhase": FinalRenderExecutionPhase.PUBLISHING.value})
        try:
            result = publish_candidate(build.candidate_path, export_dir, provenance)
        except AlreadyRenderedError:
            return self._fail(job_id, RenderFailureCode.ALREADY_RENDERED,
                              "canonical Final already exists")
        except PublishError as e:
            return self._fail(job_id, e.code, str(e))
        _jobs_module.patch_project_job(
            project_id, job_id, manager=self.jobs, status=JobStatus.COMPLETED,
            progress=1.0, message="Hoàn tất kết xuất",
            metadata={"executionPhase": FinalRenderExecutionPhase.PUBLISHED.value,
                      "encoderActuallyUsed": profile_used.video_encoder,
                      "encoderProfileVersion": profile_used.version,
                      "fallbackAttempted": fallback_done, "attempts": attempts,
                      "frame": plan.expected_final_frames, "progress": 1.0,
                      "artifactStatus": "NEEDS_REVIEW",
                      "artifactReasonCode": "PENDING_RENDER_QA",
                      "exportId": export_id})
        self._cleanup_scratch(project_dir, job_id, keep_diagnostics=True)
        self._enqueue_post_render_qa(project_id, export_id)
        return self._summary(self.jobs.get_job(job_id))

    def _enqueue_post_render_qa(self, project_id: str, export_id: str) -> None:
        """Phase 8 -> Phase 9 automatic handoff (direct service call).

        Failure isolation: QA enqueue problems must never rollback/delete
        the immutable Final or change the NEEDS_REVIEW/PENDING_RENDER_QA
        artifact state set above.
        """
        try:
            factory = self.qa_service_factory
            if factory is None:
                from studio.render_qa_service import RenderQaService
                qa_service = RenderQaService(projects_dir=self.projects_dir,
                                             jobs=self.jobs)
            else:
                qa_service = factory()
                if qa_service is None:
                    return
            qa_service.request_qa(project_id, export_id, "AUTOMATIC")
        except Exception as e:  # failure isolation: Final stays published
            logger.warning(f"post-render QA enqueue failed for "
                           f"{project_id}/{export_id}: {e}")

    async def _finish_cancelled(self, job_id, scratch) -> dict:
        job = self.jobs.get_job(job_id)
        _jobs_module.patch_project_job(
            job["projectId"], job_id, manager=self.jobs, status=JobStatus.CANCELLED,
            message="Đã hủy kết xuất")
        self._cleanup_scratch(self.projects_dir / job["projectId"], job_id,
                              keep_diagnostics=True)
        return self._summary(self.jobs.get_job(job_id))

    def _fail(self, job_id, code: RenderFailureCode, message: str) -> dict:
        job = self.jobs.get_job(job_id)
        _jobs_module.patch_project_job(
            job["projectId"], job_id, manager=self.jobs, status=JobStatus.FAILED,
            message=str(message)[:300],
            metadata={"errorCode": code.value, "errorMessage": str(message)[:500]})
        self._cleanup_scratch(self.projects_dir / job["projectId"], job_id,
                              keep_diagnostics=True)
        return self._summary(self.jobs.get_job(job_id))

    def _save_attempts(self, job_id, attempts) -> None:
        job = self.jobs.get_job(job_id)
        _jobs_module.patch_project_job(
            job["projectId"], job_id, manager=self.jobs,
            metadata={"attempts": attempts})

    def _cancel_requested(self, job_id: str) -> bool:
        job = self.jobs.get_job(job_id) or {}
        if (job.get("metadata") or {}).get("cancelRequestedAt"):
            return True
        ev = self._cancel_events.get(job_id)
        return bool(ev is not None and ev.is_set())

    def _cleanup_scratch(self, project_dir: Path, job_id: str,
                         keep_diagnostics: bool = True) -> None:
        scratch = scratch_dir_for(project_dir, job_id)
        if not scratch.is_dir():
            return
        for child in scratch.iterdir():
            try:
                if keep_diagnostics and child.suffix in (".json", ".txt", ".log"):
                    continue
                if child.is_file() or child.is_symlink():
                    child.unlink()
                elif child.is_dir():
                    import shutil
                    shutil.rmtree(child, ignore_errors=True)
            except OSError:
                continue

    def _ffmpeg_version_text(self) -> str:
        if self._ffmpeg_version is None:
            try:
                out = subprocess.run([self.ffmpeg_path, "-version"],
                                     capture_output=True, text=True,
                                     timeout=15).stdout.splitlines()
                self._ffmpeg_version = (out[0].strip() if out else "unknown")[:120]
            except Exception:
                self._ffmpeg_version = "unknown"
        return self._ffmpeg_version

    def _summary(self, job: dict, reused: bool = False) -> dict:
        meta = (job or {}).get("metadata", {})
        return {"jobId": (job or {}).get("jobId"), "status": (job or {}).get("status"),
                "reused": reused, "exportId": meta.get("exportId"),
                "encoderProfile": meta.get("encoderProfileRequested"),
                "errorCode": meta.get("errorCode")}

    # -- crash reconciliation ------------------------------------------
    def reconcile_final_render_jobs(self) -> dict:
        """Startup reconciliation for FINAL_RENDER jobs (no unsafe resume)."""
        reconciled = []
        for job in self.jobs.list_jobs(limit=10000):
            if (job.get("type") or "").upper() != "FINAL_RENDER":
                continue
            job_id = job["jobId"]
            project_dir = self.projects_dir / (job.get("projectId") or "")
            export_id = (job.get("metadata") or {}).get("exportId", "")
            final_path = canonical_final_for(project_dir, export_id)
            status = job.get("status")
            if status == JobStatus.COMPLETED:
                if not final_path.is_file():
                    _jobs_module.patch_project_job(
                        job["projectId"], job_id, manager=self.jobs,
                        status=JobStatus.FAILED,
                        message="COMPLETED nhưng final.mp4 không tồn tại (integrity).",
                        metadata={"errorCode": RenderFailureCode.OUTPUT_CANDIDATE_MISSING.value})
                    reconciled.append((job_id, "COMPLETED->FAILED integrity"))
                continue
            if status not in (JobStatus.RUNNING, JobStatus.INTERRUPTED):
                continue
            if final_path.is_file() and self._lineage_matches(job, project_dir, export_id):
                repair_missing_metadata(
                    project_dir / "exports" / export_id,
                    {"exportId": export_id,
                     "manifestHash": (job.get("metadata") or {}).get("manifestHash"),
                     "renderJobId": job_id})
                _jobs_module.patch_project_job(
                    job["projectId"], job_id, manager=self.jobs,
                    status=JobStatus.COMPLETED, progress=1.0,
                    message="Hoàn tất kết xuất (reconciled)",
                    metadata={"executionPhase": FinalRenderExecutionPhase.PUBLISHED.value})
                reconciled.append((job_id, "RUNNING->COMPLETED reconciled"))
            else:
                _jobs_module.patch_project_job(
                    job["projectId"], job_id, manager=self.jobs,
                    status=JobStatus.INTERRUPTED,
                    message="Bị gián đoạn; thử lại sẽ encode mới (không resume).")
                reconciled.append((job_id, "RUNNING->INTERRUPTED"))
        return {"reconciled": reconciled}

    def _lineage_matches(self, job: dict, project_dir: Path, export_id: str) -> bool:
        import json
        try:
            data = json.loads((project_dir / "exports" / export_id
                               / "render-manifest.json").read_text(encoding="utf-8"))
        except Exception:
            return False
        want = (job.get("metadata") or {}).get("manifestHash")
        if not want:
            return False
        from studio.render_manifest_hashing import compute_manifest_hash
        return compute_manifest_hash(data) == want


def reconcile_final_render_jobs(jobs=None, projects_dir: Path | None = None) -> dict:
    """Module entrypoint for startup wiring and tests."""
    from studio.config import PROJECTS_DIR
    service = ManifestRenderService(projects_dir=projects_dir or PROJECTS_DIR,
                                    jobs=jobs)
    return service.reconcile_final_render_jobs()
