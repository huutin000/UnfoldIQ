"""Phase 9 RenderQaService: persistent QA orchestration.

Reuses JobsManager storage, CPU_BOUND scheduler permits, and one
process-wide QA gate (concurrency 1). Read-only against Final; verdicts
applied to artifact fields on the QA job and matching FINAL_RENDER jobs.
English identifiers; user messages Vietnamese-first.
"""
from __future__ import annotations

import asyncio
import logging
import subprocess
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from studio import jobs_manager as _jobs_module
from studio.jobs_manager import JobStatus
from studio.render_qa_evaluator import build_manifest_qa_context, evaluate_events
from studio.render_qa_policy import RENDER_QA_POLICY_V1, reduce_qa_verdict
from studio.render_qa_probe import (
    compute_sha256,
    load_qa_input_snapshot,
    run_ffprobe,
    validate_probe_contract,
)
from studio.render_qa_report_store import RenderQaReportStore
from studio.render_qa_types import (
    QaDetectorKind,
    QaFinding,
    QaSeverity,
    QaTrigger,
    QaVerdict,
    RenderQaExecutionPhase,
)

logger = logging.getLogger("unfoldiq.render_qa")

QA_JOB_TYPE = "RENDER_QA"
CPU_BOUND = "CPU_BOUND"
TERMINAL_JOB_STATUSES = frozenset({
    JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED,
    JobStatus.INTERRUPTED,
})

# One process-global permit: at most one RENDER_QA full decode at a time,
# regardless of event loop or thread. Plain threading primitive — never
# loop-bound — waited on in bounded slices so the event loop stays
# responsive and cancellation can never leak the permit.
_QA_GLOBAL_SEMAPHORE = threading.Semaphore(1)
_QA_GATE_POLL_SECONDS = 0.05


def _release_qa_gate() -> None:
    try:
        _QA_GLOBAL_SEMAPHORE.release()
    except ValueError:
        logger.error("QA gate over-release detected")


class _ProcessQaGate:
    """Async context manager over the process-global QA semaphore.

    The blocking wait runs bounded (`_QA_GATE_POLL_SECONDS`) slices on the
    event-loop thread with a cancellation checkpoint holding no permit, so
    every path — PASS, PASS_WITH_WARNINGS, FAIL, validator exception,
    CANCELLED, INTERRUPTED, loop teardown — frees the gate exactly once.
    Contention slices (≤50 ms) never overlap full decodes.
    """

    async def __aenter__(self) -> "_ProcessQaGate":
        while True:
            acquired = _QA_GLOBAL_SEMAPHORE.acquire(
                blocking=True, timeout=_QA_GATE_POLL_SECONDS)
            if not acquired:
                await asyncio.sleep(0)
                continue
            try:
                await asyncio.sleep(0)
            except BaseException:
                _release_qa_gate()
                raise
            return self

    async def __aexit__(self, *exc_info: Any) -> None:
        _release_qa_gate()


def _process_qa_gate() -> _ProcessQaGate:
    return _ProcessQaGate()

_PHASE_PROGRESS = {
    RenderQaExecutionPhase.PREPARING: 0.0,
    RenderQaExecutionPhase.WAITING_RESOURCE: 0.02,
    RenderQaExecutionPhase.HASHING_FINAL: 0.02,
    RenderQaExecutionPhase.PROBING: 0.07,
    RenderQaExecutionPhase.FULL_DECODING: 0.12,
    RenderQaExecutionPhase.DETECTING: 0.88,
    RenderQaExecutionPhase.EVALUATING: 0.88,
    RenderQaExecutionPhase.WRITING_REPORT: 0.94,
    RenderQaExecutionPhase.REPORT_COMMITTED: 0.97,
    RenderQaExecutionPhase.APPLYING_VERDICT: 0.97,
}

_PHASE_MESSAGE_VI = {
    RenderQaExecutionPhase.PREPARING: "Chuẩn bị kiểm định",
    RenderQaExecutionPhase.WAITING_RESOURCE: "Đang chờ tài nguyên",
    RenderQaExecutionPhase.HASHING_FINAL: "Đang xác minh tệp video",
    RenderQaExecutionPhase.PROBING: "Đang kiểm tra thông số",
    RenderQaExecutionPhase.FULL_DECODING: "Đang kiểm tra toàn bộ video",
    RenderQaExecutionPhase.DETECTING: "Đang kiểm tra toàn bộ video",
    RenderQaExecutionPhase.EVALUATING: "Đang đánh giá kết quả",
    RenderQaExecutionPhase.WRITING_REPORT: "Đang lưu báo cáo",
    RenderQaExecutionPhase.REPORT_COMMITTED: "Đã lưu báo cáo",
    RenderQaExecutionPhase.APPLYING_VERDICT: "Đang áp dụng kết quả",
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_trigger(trigger: Any) -> str:
    if isinstance(trigger, QaTrigger):
        return trigger.value
    text = str(trigger or "AUTOMATIC").upper()
    return QaTrigger.MANUAL_RERUN.value if "MANUAL" in text else QaTrigger.AUTOMATIC.value


class RenderQaService:
    """Orchestrates RENDER_QA jobs (injectable for tests)."""

    def __init__(self, projects_dir: Path, jobs=None, scheduler=None,
                 ffmpeg_path: str = "ffmpeg", ffprobe_path: str = "ffprobe",
                 run_ffprobe_fn: Callable | None = None,
                 run_detector_fn: Callable | None = None):
        self.projects_dir = Path(projects_dir)
        self.jobs = jobs or _jobs_module.jobs_manager
        self.scheduler = scheduler
        self.ffmpeg_path = ffmpeg_path
        self.ffprobe_path = ffprobe_path
        self.run_ffprobe_fn = run_ffprobe_fn
        self.run_detector_fn = run_detector_fn
        self.store = RenderQaReportStore()
        self._cancel_events: dict[str, asyncio.Event] = {}
        self._ffmpeg_version: str | None = None
        self._ffprobe_version: str | None = None

    # -- public API ------------------------------------------------------
    def request_qa(self, project_id: str, export_id: str, trigger: Any = "AUTOMATIC") -> dict:
        trig = _normalize_trigger(trigger)
        project_dir = self.projects_dir / project_id
        if not project_dir.is_dir():
            return {"errorCode": "QA_INPUT_MISSING", "message": f"unknown project {project_id!r}"}
        try:
            snapshot = load_qa_input_snapshot(project_dir, export_id)
        except ValueError as e:
            return {"errorCode": "QA_INPUT_MISSING", "message": str(e)}
        export_dir = project_dir / "exports" / snapshot.export_id
        if not (export_dir / "final.mp4").is_file():
            return {"errorCode": "QA_INPUT_MISSING", "message": "final.mp4 is missing"}
        existing = _jobs_module.find_active_project_job(
            project_id, QA_JOB_TYPE, snapshot.export_id, manager=self.jobs)
        if existing:
            meta = existing.get("metadata", {})
            return {"jobId": existing["jobId"], "qaRunId": meta.get("qaRunId"),
                    "exportId": snapshot.export_id, "reused": True}
        try:
            final_sha = compute_sha256(export_dir / "final.mp4")
        except OSError:
            final_sha = ""
        if trig == QaTrigger.AUTOMATIC.value:
            hit = self._find_valid_completed_report(
                export_dir, snapshot.manifest_hash, final_sha)
            if hit is not None:
                self._apply_artifact(project_id, snapshot.export_id,
                                     str(hit.get("verdict") or "PASS"),
                                     str(hit.get("qaRunId") or ""))
                return {"jobId": self._origin_job_id(project_id, snapshot.export_id,
                                                     str(hit.get("qaRunId") or "")),
                        "qaRunId": hit.get("qaRunId"), "exportId": snapshot.export_id,
                        "reused": True, "verdict": hit.get("verdict")}
        qa_run_id = f"qa_{uuid.uuid4().hex[:12]}"
        job = self.jobs.create_job(
            QA_JOB_TYPE, project_id=project_id,
            metadata={"exportId": snapshot.export_id,
                      "manifestHash": snapshot.manifest_hash,
                      "finalSha256Start": final_sha,
                      "qaRunId": qa_run_id,
                      "qaPolicyVersion": RENDER_QA_POLICY_V1.version,
                      "trigger": trig,
                      "executionPhase": RenderQaExecutionPhase.PREPARING.value,
                      "artifactStatus": "NEEDS_REVIEW",
                      "artifactReasonCode": "PENDING_RENDER_QA",
                      "cancelRequestedAt": None})
        self._cancel_events[job["jobId"]] = asyncio.Event()
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(self.run_job(job["jobId"]))
        except RuntimeError:
            pass
        return {"jobId": job["jobId"], "qaRunId": qa_run_id,
                "exportId": snapshot.export_id, "reused": False}

    async def run_job(self, job_id: str) -> None:
        job = self.jobs.get_job(job_id)
        if not job:
            return
        if job.get("status") in TERMINAL_JOB_STATUSES:
            return
        project_id = job["projectId"]
        self._set_phase(job_id, RenderQaExecutionPhase.WAITING_RESOURCE, 0.02)
        try:
            if self.scheduler is not None:
                await self.scheduler.submit_job(
                    job_id, QA_JOB_TYPE, CPU_BOUND,
                    lambda: self._execute(job_id))
            else:
                await self._execute(job_id)
        except Exception as e:  # never leave global/scheduler state stale
            logger.exception(f"render QA job {job_id} orchestration failed")
            job = self.jobs.get_job(job_id)
            if job is None:
                return
            meta = job.get("metadata", {})
            if meta.get("reportCommitted"):
                try:
                    self._apply_artifact(project_id, str(meta.get("exportId") or ""),
                                         str(meta.get("qaVerdict") or "FAIL"),
                                         str(meta.get("qaRunId") or ""))
                    _jobs_module.patch_project_job(
                        project_id, job_id, manager=self.jobs,
                        status=JobStatus.COMPLETED, progress=1.0,
                        message="Hoàn tất kiểm định")
                except Exception:
                    pass
                return
            if job.get("status") not in TERMINAL_JOB_STATUSES:
                _jobs_module.patch_project_job(
                    project_id, job_id, manager=self.jobs,
                    status=JobStatus.FAILED,
                    message=f"Kiểm định chưa hoàn tất: {e}",
                    metadata={"error": str(e)[:500],
                              "artifactStatus": "NEEDS_REVIEW",
                              "artifactReasonCode": "PENDING_RENDER_QA"})

    def cancel_job(self, job_id: str) -> dict:
        job = self.jobs.get_job(job_id)
        if not job:
            return {"errorCode": "UNKNOWN_JOB", "message": "job not found"}
        status = job.get("status")
        if status in TERMINAL_JOB_STATUSES:
            return {"jobId": job_id, "status": status, "reused": True}
        _jobs_module.patch_project_job(
            job["projectId"], job_id, manager=self.jobs,
            metadata={"cancelRequestedAt": _now_iso()})
        ev = self._cancel_events.get(job_id)
        if ev is not None:
            ev.set()
        if status == JobStatus.QUEUED:
            self.jobs.cancel_job(job_id)
        return {"jobId": job_id, "cancelRequested": True}

    async def wait_for_job(self, job_id: str, timeout: float = 300.0) -> dict:
        t0 = time.perf_counter()
        while time.perf_counter() - t0 < timeout:
            job = self.jobs.get_job(job_id)
            if job and job.get("status") in TERMINAL_JOB_STATUSES:
                return job
            await asyncio.sleep(0.2)
        raise TimeoutError(f"job {job_id} not terminal within {timeout}s")

    def recover_incomplete_jobs(self) -> dict:
        recovered: list[tuple[str, str]] = []
        for job in self.jobs.list_jobs(limit=10000):
            if (job.get("type") or "").upper() != QA_JOB_TYPE:
                continue
            job_id = job["jobId"]
            status = job.get("status")
            meta = job.get("metadata", {}) or {}
            if status in (JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED):
                if status == JobStatus.COMPLETED and meta.get("reportCommitted"):
                    self._repair_post_commit(job)
                continue
            if status == JobStatus.QUEUED:
                recovered.append((job_id, "QUEUED schedulable"))
                continue
            if meta.get("reportCommitted") and meta.get("qaRunId"):
                if self._repair_post_commit(job):
                    recovered.append((job_id, "REPORT_COMMITTED->COMPLETED"))
                else:
                    _jobs_module.patch_project_job(
                        job.get("projectId"), job_id, manager=self.jobs,
                        status=JobStatus.INTERRUPTED,
                        message="Bị gián đoạn; báo cáo không toàn vẹn, cần chạy lại.")
                    recovered.append((job_id, "RUNNING->INTERRUPTED integrity"))
                continue
            _jobs_module.patch_project_job(
                job.get("projectId"), job_id, manager=self.jobs,
                status=JobStatus.INTERRUPTED,
                message="Bị gián đoạn trước khi lưu báo cáo; chạy lại sẽ kiểm định mới.")
            recovered.append((job_id, "RUNNING->INTERRUPTED"))
        return {"recovered": recovered}

    # -- execution -------------------------------------------------------
    async def _execute(self, job_id: str) -> dict:
        async with _process_qa_gate():
            return await self._execute_guarded(job_id)

    async def _execute_guarded(self, job_id: str) -> dict:
        job = self.jobs.get_job(job_id)
        project_id = job["projectId"]
        meta = job.get("metadata", {}) or {}
        export_id = str(meta.get("exportId") or "")
        qa_run_id = str(meta.get("qaRunId") or "")
        project_dir = self.projects_dir / project_id
        export_dir = project_dir / "exports" / export_id
        started_at = _now_iso()
        if self._cancel_requested(job_id):
            return self._finish_cancelled(job_id)
        self._set_phase(job_id, RenderQaExecutionPhase.PREPARING, 0.0,
                        "Chuẩn bị kiểm định")
        _jobs_module.patch_project_job(
            project_id, job_id, manager=self.jobs, status=JobStatus.RUNNING,
            message="Đang kiểm định kỹ thuật")
        snapshot = load_qa_input_snapshot(project_dir, export_id)
        self._set_phase(job_id, RenderQaExecutionPhase.HASHING_FINAL, 0.02)
        try:
            sha_start = compute_sha256(export_dir / "final.mp4")
            size_bytes = (export_dir / "final.mp4").stat().st_size
        except OSError as e:
            raise RuntimeError(f"cannot hash final.mp4: {e}") from e
        _jobs_module.patch_project_job(
            project_id, job_id, manager=self.jobs,
            metadata={"finalSha256Start": sha_start, "finalSizeBytes": size_bytes})
        if self._cancel_requested(job_id):
            return self._finish_cancelled(job_id)
        if snapshot.preflight_findings:
            verdict = QaVerdict.FAIL
            return await self._commit_and_apply(
                job_id, snapshot, sha_start, sha_start, size_bytes,
                preflight=snapshot.preflight_findings, structural=[],
                detector_events=[], raw_settings={}, probe_summary=None,
                decode_completed=True, decode_errors=0, stderr_tail="",
                started_at=started_at, verdict_override=verdict)
        self._set_phase(job_id, RenderQaExecutionPhase.PROBING, 0.07)
        if self.run_ffprobe_fn is not None:
            probe = self.run_ffprobe_fn(export_dir / "final.mp4")
        else:
            probe = await asyncio.to_thread(run_ffprobe, export_dir / "final.mp4",
                                            self.ffprobe_path)
        structural = validate_probe_contract(snapshot, probe)
        if self._cancel_requested(job_id):
            return self._finish_cancelled(job_id)
        self._set_phase(job_id, RenderQaExecutionPhase.FULL_DECODING, 0.12)
        cancel_event = self._cancel_events.get(job_id) or asyncio.Event()
        self._cancel_events[job_id] = cancel_event
        expected_frames = snapshot.expected_final_frames
        expected_duration = expected_frames / 24.0 if expected_frames else 0.0
        log_path = export_dir / "qa" / f".tmp_{qa_run_id}" / "ffmpeg.log"

        def _progress(frac: float) -> None:
            try:
                job_now = self.jobs.get_job(job_id) or {}
                cur = float(job_now.get("progress") or 0.0)
            except (TypeError, ValueError):
                cur = 0.0
            self.jobs.update_job(job_id, progress=max(cur, min(0.88, float(frac))))

        if self.run_detector_fn is not None:
            det = await self.run_detector_fn(
                final_path=export_dir / "final.mp4",
                expected_duration_seconds=expected_duration,
                expected_frames=expected_frames, log_path=log_path,
                cancel_event=cancel_event, progress_cb=_progress,
                ffmpeg_path=self.ffmpeg_path)
        else:
            from studio.render_qa_detector import run_full_decode_detectors
            det = await run_full_decode_detectors(
                export_dir / "final.mp4", expected_duration, expected_frames,
                log_path, cancel_event, _progress, self.ffmpeg_path)
        if det.cancelled or self._cancel_requested(job_id):
            return self._finish_cancelled(job_id)
        self._set_phase(job_id, RenderQaExecutionPhase.EVALUATING, 0.88)
        detector_findings: list[QaFinding] = []
        if not det.completed or det.decode_error_count > 0:
            detector_findings.append(QaFinding(
                code="QA_FULL_DECODE_FAILED", severity=QaSeverity.HARD_FAIL,
                message=f"full decode failed rc={det.return_code} "
                        f"errors={det.decode_error_count}"))
        else:
            context = build_manifest_qa_context(snapshot.manifest)
            detector_findings.extend(
                evaluate_events(det.events, context, RENDER_QA_POLICY_V1))
        if self._cancel_requested(job_id):
            return self._finish_cancelled(job_id)
        try:
            sha_commit = compute_sha256(export_dir / "final.mp4")
        except OSError as e:
            raise RuntimeError(f"cannot re-hash final.mp4: {e}") from e
        stability: list[QaFinding] = []
        if sha_commit != sha_start:
            stability.append(QaFinding(
                code="QA_FINAL_CHANGED_DURING_RUN", severity=QaSeverity.HARD_FAIL,
                message="final.mp4 changed during QA"))
        return await self._commit_and_apply(
            job_id, snapshot, sha_start, sha_commit, size_bytes,
            preflight=[], structural=structural + stability,
            detector_events=det.events, raw_settings={},
            probe_summary=probe, decode_completed=det.completed,
            decode_errors=det.decode_error_count, stderr_tail=det.stderr_tail,
            started_at=started_at, verdict_override=None)

    async def _commit_and_apply(self, job_id: str, snapshot, sha_start: str,
                                sha_commit: str, size_bytes: int, preflight,
                                structural, detector_events, raw_settings,
                                probe_summary, decode_completed: bool,
                                decode_errors: int, stderr_tail: str,
                                started_at: str, verdict_override) -> dict:
        job = self.jobs.get_job(job_id)
        project_id, meta = job["projectId"], job.get("metadata", {}) or {}
        export_id, qa_run_id = str(meta.get("exportId") or ""), str(meta.get("qaRunId") or "")
        export_dir = self.projects_dir / project_id / "exports" / export_id
        if self._cancel_requested(job_id):
            return self._finish_cancelled(job_id)
        self._set_phase(job_id, RenderQaExecutionPhase.WRITING_REPORT, 0.94)
        all_findings = list(preflight) + list(structural)
        if verdict_override is None:
            from studio.render_qa_evaluator import build_manifest_qa_context, evaluate_events
            context = build_manifest_qa_context(snapshot.manifest)
            evaluated = evaluate_events(detector_events or [], context, RENDER_QA_POLICY_V1)
            if (not decode_completed or decode_errors > 0) and not any(
                    f.code == "QA_FULL_DECODE_FAILED" for f in all_findings):
                evaluated = [QaFinding(code="QA_FULL_DECODE_FAILED",
                                       severity=QaSeverity.HARD_FAIL,
                                       message="full decode failed")] + evaluated
            verdict = reduce_qa_verdict(list(all_findings) + list(evaluated))
            final_findings = list(all_findings) + list(evaluated)
        else:
            verdict = verdict_override
            final_findings = list(all_findings)
        completed_at = _now_iso()
        report = self._build_report(job, snapshot, sha_start, sha_commit, size_bytes,
                                    probe_summary, detector_events, final_findings,
                                    verdict, started_at, completed_at,
                                    decode_completed, decode_errors)
        try:
            self.store.commit_report(export_dir, report, {
                "ffprobe": getattr(probe_summary, "raw", {}),
                "events": [self._event_dict(e) for e in (detector_events or [])],
                "stderr": stderr_tail or "",
            })
        except FileExistsError:
            pass
        _jobs_module.patch_project_job(
            project_id, job_id, manager=self.jobs,
            metadata={"executionPhase": RenderQaExecutionPhase.REPORT_COMMITTED.value,
                      "reportCommitted": True, "qaVerdict": verdict.value,
                      "completedAt": completed_at})
        self.jobs.update_job(job_id, progress=0.97)
        if self._cancel_requested(job_id):
            # Late cancel cannot discard the committed result: still apply.
            pass
        self._set_phase(job_id, RenderQaExecutionPhase.APPLYING_VERDICT, 0.98)
        self._apply_artifact(project_id, export_id, verdict.value, qa_run_id)
        _jobs_module.patch_project_job(
            project_id, job_id, manager=self.jobs, status=JobStatus.COMPLETED,
            progress=1.0, message="Hoàn tất kiểm định")
        return self._summary(self.jobs.get_job(job_id))

    # -- helpers ---------------------------------------------------------
    def _event_dict(self, event) -> dict:
        return {"detector": event.detector.value, "start_time": event.start_time,
                "end_time": event.end_time, "duration": event.duration,
                "raw_thresholds": dict(event.raw_thresholds or {}),
                "raw_evidence": dict(event.raw_evidence or {})}

    def _finding_dict(self, finding: QaFinding) -> dict:
        return {"code": finding.code, "severity": finding.severity.value,
                "detector": finding.detector.value if finding.detector else None,
                "message": finding.message, "start_time": finding.start_time,
                "end_time": finding.end_time, "start_frame": finding.start_frame,
                "end_frame_exclusive": finding.end_frame_exclusive,
                "shot_id": finding.shot_id, "context": finding.context,
                "expected": finding.expected, "observed": finding.observed}

    def _build_report(self, job, snapshot, sha_start, sha_commit, size_bytes,
                      probe_summary, detector_events, findings, verdict,
                      started_at, completed_at, decode_completed,
                      decode_errors) -> dict:
        meta = job.get("metadata", {}) or {}
        warnings = [self._finding_dict(f) for f in findings
                    if f.severity is QaSeverity.WARNING]
        hard = [self._finding_dict(f) for f in findings
                if f.severity is QaSeverity.HARD_FAIL]
        observed = [self._finding_dict(f) for f in findings
                    if f.severity in (QaSeverity.EXPECTED, QaSeverity.OBSERVED)]
        probe_dict: dict[str, Any] = {}
        if probe_summary is not None:
            probe_dict = {
                "container": probe_summary.container,
                "videoStream": {"codec": probe_summary.video.codec_name,
                               "width": probe_summary.video.width,
                               "height": probe_summary.video.height,
                               "pix_fmt": probe_summary.video.pix_fmt,
                               "sar": probe_summary.video.sample_aspect_ratio,
                               "fps": probe_summary.video.avg_frame_rate},
                "audioStream": {"codec": probe_summary.audio.codec_name,
                               "sample_rate": probe_summary.audio.sample_rate,
                               "channels": probe_summary.audio.channels},
                "subtitleStreams": [{"codec": s.codec_name} for s in
                                    probe_summary.subtitle_streams],
                "observedFrameCount": probe_summary.observed_frame_count,
                "observedDuration": probe_summary.observed_duration,
            }
        policy = RENDER_QA_POLICY_V1
        return {
            "schemaVersion": "1.0.0",
            "qaRunId": meta.get("qaRunId"),
            "qaJobId": job["jobId"],
            "projectId": job["projectId"],
            "exportId": meta.get("exportId"),
            "trigger": meta.get("trigger", "AUTOMATIC"),
            "manifestHash": snapshot.manifest_hash,
            "final": {"relativePath": "final.mp4", "sha256Start": sha_start,
                      "sha256Commit": sha_commit, "sizeBytes": size_bytes},
            "qaPolicyVersion": policy.version,
            "tools": {"ffmpegVersion": self._tool_version(self.ffmpeg_path, "_ffmpeg"),
                      "ffprobeVersion": self._tool_version(self.ffprobe_path, "_ffprobe")},
            "startedAt": started_at,
            "completedAt": completed_at,
            "probe": probe_dict,
            "fullDecode": {"completed": bool(decode_completed),
                           "exitCode": 0 if decode_completed else 1,
                           "decodeErrorCount": int(decode_errors)},
            "detectorSettings": {
                "black": {"d": policy.black.detect_min_seconds,
                          "pic_th": policy.black.picture_black_ratio,
                          "pix_th": policy.black.pixel_threshold},
                "freeze": {"n": policy.freeze.noise_threshold,
                           "d": policy.freeze.detect_min_seconds},
                "silence": {"n": f"{policy.silence.noise_db:g}dB",
                            "d": policy.silence.detect_min_seconds}},
            "rawEvents": [self._event_dict(e) for e in (detector_events or [])],
            "contextEvaluations": [self._finding_dict(f) for f in findings],
            "warnings": warnings,
            "hardFailures": hard,
            "observed": observed,
            "verdict": verdict.value if isinstance(verdict, QaVerdict) else str(verdict),
        }

    def _tool_version(self, binary: str, attr: str) -> str:
        cached = getattr(self, attr + "_text", None)
        if cached:
            return cached
        try:
            out = subprocess.run([binary, "-version"], capture_output=True,
                                 text=True, timeout=10).stdout.splitlines()
            text = (out[0].strip() if out else "unknown")[:120]
        except Exception:
            text = "unknown"
        setattr(self, attr + "_text", text)
        return text

    def _set_phase(self, job_id: str, phase: RenderQaExecutionPhase,
                   progress: float, message: str | None = None) -> None:
        job = self.jobs.get_job(job_id)
        if not job:
            return
        try:
            cur = float(job.get("progress") or 0.0)
        except (TypeError, ValueError):
            cur = 0.0
        _jobs_module.patch_project_job(
            job["projectId"], job_id, manager=self.jobs,
            progress=max(cur, progress),
            message=message or _PHASE_MESSAGE_VI.get(phase, "Đang kiểm định"),
            metadata={"executionPhase": phase.value})

    def _cancel_requested(self, job_id: str) -> bool:
        job = self.jobs.get_job(job_id) or {}
        if (job.get("metadata") or {}).get("cancelRequestedAt"):
            return True
        ev = self._cancel_events.get(job_id)
        return bool(ev is not None and ev.is_set())

    def _finish_cancelled(self, job_id: str) -> dict:
        job = self.jobs.get_job(job_id)
        _jobs_module.patch_project_job(
            job["projectId"], job_id, manager=self.jobs,
            status=JobStatus.CANCELLED, message="Đã hủy kiểm định")
        return self._summary(self.jobs.get_job(job_id))

    def _apply_artifact(self, project_id: str, export_id: str,
                        verdict: str, qa_run_id: str) -> None:
        status = "READY" if verdict in ("PASS", "PASS_WITH_WARNINGS") else "BLOCKED"
        for job in self.jobs.list_jobs(project_id=project_id, limit=10000):
            if (job.get("type") or "").upper() not in (QA_JOB_TYPE, "FINAL_RENDER"):
                continue
            if (job.get("metadata") or {}).get("exportId") != export_id:
                continue
            if (job.get("type") or "").upper() == QA_JOB_TYPE and \
                    (job.get("metadata") or {}).get("qaRunId") != qa_run_id and qa_run_id:
                continue
            _jobs_module.patch_project_job(
                project_id, job["jobId"], manager=self.jobs,
                metadata={"artifactStatus": status,
                          "artifactReasonCode": verdict,
                          "qaVerdict": verdict, "qaRunId": qa_run_id})

    def _find_valid_completed_report(self, export_dir: Path, manifest_hash: str,
                                     final_sha: str) -> dict | None:
        latest = self.store.read_latest(export_dir)
        if latest and latest.get("manifestHash") == manifest_hash and \
                latest.get("finalSha256") == final_sha and \
                latest.get("qaPolicyVersion") == RENDER_QA_POLICY_V1.version:
            return latest
        if latest is None:
            repaired = self.store.repair_latest(export_dir)
            if repaired and repaired.get("manifestHash") == manifest_hash and \
                    repaired.get("finalSha256") == final_sha and \
                    repaired.get("qaPolicyVersion") == RENDER_QA_POLICY_V1.version:
                return repaired
        return None

    def _origin_job_id(self, project_id: str, export_id: str, qa_run_id: str) -> str | None:
        for job in self.jobs.list_jobs(project_id=project_id, limit=10000):
            if (job.get("type") or "").upper() != QA_JOB_TYPE:
                continue
            meta = job.get("metadata", {}) or {}
            if meta.get("exportId") == export_id and meta.get("qaRunId") == qa_run_id:
                return job["jobId"]
        return None

    def _repair_post_commit(self, job: dict) -> bool:
        try:
            meta = job.get("metadata", {}) or {}
            project_id, export_id = job.get("projectId"), str(meta.get("exportId") or "")
            export_dir = self.projects_dir / project_id / "exports" / export_id
            report = self.store.read_report(export_dir, str(meta.get("qaRunId") or ""))
        except Exception:
            return False
        final = report.get("final") or {}
        try:
            current = compute_sha256(export_dir / "final.mp4")
        except OSError:
            return False
        if current != (final.get("sha256Commit") or final.get("sha256Start")):
            return False
        self.store.repair_latest(export_dir)
        verdict = str(report.get("verdict") or "FAIL")
        self._apply_artifact(project_id, export_id, verdict, str(report.get("qaRunId") or ""))
        _jobs_module.patch_project_job(
            project_id, job["jobId"], manager=self.jobs,
            status=JobStatus.COMPLETED, progress=1.0,
            message="Hoàn tất kiểm định")
        return True

    def _summary(self, job: dict | None) -> dict:
        meta = (job or {}).get("metadata", {}) or {}
        return {"jobId": (job or {}).get("jobId"), "status": (job or {}).get("status"),
                "qaRunId": meta.get("qaRunId"), "exportId": meta.get("exportId"),
                "qaVerdict": meta.get("qaVerdict"),
                "artifactStatus": meta.get("artifactStatus")}
