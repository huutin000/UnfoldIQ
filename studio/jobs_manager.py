"""
UnfoldIQ Persistent Job System & Crash Recovery — Phase 15A (P0)
Provides robust, disk-persisted job lifecycle management for all pipeline jobs:
TTS, TIMESTAMP, SCENE_PLANNING, ASSET_QC, DRAFT_RENDER, FINAL_RENDER, EXPORT.

Features:
- Full state persistence to disk (atomic write with temp file + rename)
- Crash recovery on startup (RUNNING -> INTERRUPTED / RESUMABLE)
- Safe resume with atomic checkpoint validation
- History retention policy that never touches referenced artifacts
- vi-VN UI label mapping
"""

import json
import logging
import os
import shutil
import time
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Dict, Any, Optional, List

from studio.config import BASE_DIR, PROJECTS_DIR

logger = logging.getLogger("unfoldiq.jobs")

RUNTIME_JOBS_DIR = BASE_DIR / "runtime" / "jobs"
RUNTIME_JOBS_DIR.mkdir(parents=True, exist_ok=True)


class JobStatus:
    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    PAUSED = "PAUSED"
    INTERRUPTED = "INTERRUPTED"
    RESUMABLE = "RESUMABLE"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"
    # Backward-compat alias
    SUCCESS = "COMPLETED"


JOB_STATUS_LABELS_VI: Dict[str, str] = {
    JobStatus.QUEUED: "Đang chờ",
    JobStatus.RUNNING: "Đang chạy",
    JobStatus.PAUSED: "Tạm dừng",
    JobStatus.INTERRUPTED: "Bị gián đoạn",
    JobStatus.RESUMABLE: "Có thể tiếp tục",
    JobStatus.COMPLETED: "Hoàn tất",
    JobStatus.FAILED: "Thất bại",
    JobStatus.CANCELLED: "Đã hủy",
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _atomic_write_json(file_path: Path, data: Dict[str, Any]) -> None:
    file_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = file_path.parent / f".tmp_{file_path.name}_{uuid.uuid4().hex[:6]}"
    with open(temp_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(temp_path, file_path)


class JobsManager:
    """Persistent Job Manager storing job state across server restarts."""

    def __init__(self, runtime_dir: Path = RUNTIME_JOBS_DIR, projects_dir: Optional[Path] = None):
        self.runtime_dir = runtime_dir
        self.projects_dir = projects_dir or PROJECTS_DIR
        self.runtime_dir.mkdir(parents=True, exist_ok=True)
        self._jobs: Dict[str, Dict[str, Any]] = {}
        self._load_persisted_jobs()
        self.recover_crashed_jobs()

    def _get_project_jobs_dir(self, project_id: Optional[str]) -> Optional[Path]:
        if not project_id:
            return None
        p_dir = self.projects_dir / project_id / "jobs"
        p_dir.mkdir(parents=True, exist_ok=True)
        return p_dir

    def _persist_job(self, job: Dict[str, Any]) -> None:
        job_id = job["jobId"]
        # Persist to runtime directory
        runtime_file = self.runtime_dir / f"{job_id}.json"
        _atomic_write_json(runtime_file, job)

        # Persist to project directory if attached
        p_dir = self._get_project_jobs_dir(job.get("projectId"))
        if p_dir:
            project_file = p_dir / f"{job_id}.json"
            _atomic_write_json(project_file, job)

    @staticmethod
    def _resolve_job_conflict(job_a: Dict[str, Any], job_b: Dict[str, Any]) -> Dict[str, Any]:
        """
        Deterministically resolve conflict between two copies of the same job.
        Rules:
        1. Compare 'updatedAt' timestamps. The newer record wins.
        2. If timestamps are equal:
           - Prefer terminal status (COMPLETED, FAILED, CANCELLED) over non-terminal.
           - Prefer higher progress.
           - Prefer project copy (job_b) as canonical store of record.
        """
        def _parse_ts(ts_str):
            if not ts_str:
                return datetime.min.replace(tzinfo=timezone.utc)
            try:
                return datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
            except Exception:
                return datetime.min.replace(tzinfo=timezone.utc)

        ts_a = _parse_ts(job_a.get("updatedAt") or job_a.get("createdAt"))
        ts_b = _parse_ts(job_b.get("updatedAt") or job_b.get("createdAt"))

        if ts_a > ts_b:
            return job_a
        elif ts_b > ts_a:
            return job_b

        terminal = {JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED}
        a_term = job_a.get("status") in terminal
        b_term = job_b.get("status") in terminal
        if a_term and not b_term:
            return job_a
        if b_term and not a_term:
            return job_b

        prog_a = job_a.get("progress", 0.0) or 0.0
        prog_b = job_b.get("progress", 0.0) or 0.0
        if prog_a > prog_b:
            return job_a
        elif prog_b > prog_a:
            return job_b

        # If completely identical, project copy (job_b) is canonical
        return job_b

    def _load_persisted_jobs(self) -> None:
        """Scan both runtime jobs dir and project job directories to populate memory with deterministic conflict resolution."""
        # 1. Load from runtime directory
        for f in self.runtime_dir.glob("*.json"):
            try:
                with open(f, "r", encoding="utf-8") as fp:
                    data = json.load(fp)
                    job_id = data.get("jobId") or data.get("id")
                    if job_id:
                        data["jobId"] = job_id
                        data["id"] = job_id
                        self._jobs[job_id] = data
            except Exception as e:
                logger.warning(f"Could not load job from {f}: {e}")

        # 2. Also check project directories and resolve any conflicts
        if self.projects_dir.exists():
            for p_dir in self.projects_dir.iterdir():
                if p_dir.is_dir():
                    jobs_sub = p_dir / "jobs"
                    if jobs_sub.is_dir():
                        for jf in jobs_sub.glob("*.json"):
                            try:
                                with open(jf, "r", encoding="utf-8") as fp:
                                    data = json.load(fp)
                            except Exception as e:
                                logger.warning(f"Could not load project job from {jf}: {e}")
                                continue

                            try:
                                job_id = data.get("jobId") or data.get("id")
                                if job_id:
                                    data["jobId"] = job_id
                                    data["id"] = job_id
                                    if job_id in self._jobs:
                                        # Conflict scenario: resolve deterministically
                                        resolved = self._resolve_job_conflict(self._jobs[job_id], data)
                                        self._jobs[job_id] = resolved
                                        # Mirror winning copy to both locations (safe after jf is closed)
                                        self._persist_job(resolved)
                                    else:
                                        self._jobs[job_id] = data
                                        # Seed runtime index
                                        runtime_file = self.runtime_dir / f"{job_id}.json"
                                        if not runtime_file.exists():
                                            _atomic_write_json(runtime_file, data)
                            except Exception as e:
                                logger.warning(f"Error resolving project job {jf}: {e}")

    def recover_crashed_jobs(self) -> int:
        """
        Scan all jobs. Any job left in RUNNING on server boot was interrupted by a crash/shutdown.
        Mark as INTERRUPTED or RESUMABLE if a valid checkpoint is present.
        Returns count of recovered jobs.
        """
        recovered_count = 0
        for job_id, job in list(self._jobs.items()):
            status = job.get("status")
            if status == JobStatus.RUNNING:
                # Validate checkpoint
                checkpoint = job.get("checkpoint")
                if checkpoint and isinstance(checkpoint, dict) and checkpoint.get("valid", True):
                    job["status"] = JobStatus.RESUMABLE
                    job["message"] = "Tác vụ bị gián đoạn do khởi động lại; có thể tiếp tục từ điểm kiểm tra."
                else:
                    job["status"] = JobStatus.INTERRUPTED
                    job["message"] = "Tác vụ bị gián đoạn do khởi động lại hệ thống."
                job["updatedAt"] = _now_iso()
                self._persist_job(job)
                recovered_count += 1
                logger.info(f"Recovered crashed job {job_id} -> {job['status']}")
        return recovered_count

    def create_job(
        self,
        job_type: str,
        project_id: Optional[str] = None,
        scene_id: Optional[str] = None,
        provider: str = "local",
        metadata: Optional[Dict[str, Any]] = None,
        resume_data: Optional[Dict[str, Any]] = None,
        checkpoint: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        now = _now_iso()
        job_id = f"job_{int(time.time())}_{uuid.uuid4().hex[:6]}"
        job = {
            "jobId": job_id,
            "id": job_id,  # backward-compat alias
            "projectId": project_id,
            "sceneId": scene_id,
            "type": job_type.upper(),
            "status": JobStatus.QUEUED,
            "statusVi": JOB_STATUS_LABELS_VI[JobStatus.QUEUED],
            "progress": 0.0,
            "createdAt": now,
            "startedAt": None,
            "updatedAt": now,
            "completedAt": None,
            "error": None,
            "resumeData": resume_data or {},
            "checkpoint": checkpoint or {},
            "artifactRefs": [],
            "provider": provider,
            "message": "Đang xếp hàng...",
            "retryCount": 0,
            "metadata": metadata or {}
        }
        self._jobs[job_id] = job
        self._persist_job(job)
        return job

    def update_job(
        self,
        job_id: str,
        status: Optional[str] = None,
        progress: Optional[float] = None,
        message: Optional[str] = None,
        error: Optional[str] = None,
        resume_data: Optional[Dict[str, Any]] = None,
        checkpoint: Optional[Dict[str, Any]] = None,
        artifact_refs: Optional[List[str]] = None
    ) -> Optional[Dict[str, Any]]:
        job = self._jobs.get(job_id)
        if not job:
            return None

        now = _now_iso()
        job["updatedAt"] = now

        if status:
            if status == "SUCCESS":
                status = JobStatus.COMPLETED
            job["status"] = status
            job["statusVi"] = JOB_STATUS_LABELS_VI.get(status, status)
            if status == JobStatus.RUNNING and not job.get("startedAt"):
                job["startedAt"] = now
            elif status in (JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED):
                job["completedAt"] = now
                job["finishedAt"] = now  # backward-compat

        if progress is not None:
            job["progress"] = min(1.0, max(0.0, float(progress)))

        if message is not None:
            job["message"] = message

        if error is not None:
            job["error"] = error

        if resume_data is not None:
            job["resumeData"].update(resume_data)

        if checkpoint is not None:
            job["checkpoint"].update(checkpoint)

        if artifact_refs:
            existing_refs = set(job.get("artifactRefs", []))
            for ref in artifact_refs:
                if ref not in existing_refs:
                    job["artifactRefs"].append(ref)

        self._persist_job(job)
        return job

    def set_checkpoint(
        self,
        job_id: str,
        checkpoint_data: Dict[str, Any],
        resume_data: Optional[Dict[str, Any]] = None,
        progress: Optional[float] = None,
        artifact_refs: Optional[List[str]] = None
    ) -> Optional[Dict[str, Any]]:
        """Atomically set job checkpoint for resume."""
        job = self._jobs.get(job_id)
        if not job:
            return None
        return self.update_job(
            job_id,
            checkpoint=checkpoint_data,
            resume_data=resume_data,
            progress=progress,
            artifact_refs=artifact_refs
        )

    def validate_checkpoint(self, job_id: str) -> bool:
        """Validate whether the job has a coherent, non-empty checkpoint capable of resume."""
        job = self._jobs.get(job_id)
        if not job:
            return False
        checkpoint = job.get("checkpoint", {})
        if not checkpoint or not isinstance(checkpoint, dict):
            return False
        # Checkpoint is valid if explicitly marked valid or has completed_chunks/stage
        return checkpoint.get("valid", True) and ("completed_chunks" in checkpoint or "stage" in checkpoint or "last_index" in checkpoint)

    def resume_job(self, job_id: str) -> Optional[Dict[str, Any]]:
        """Transition an INTERRUPTED, PAUSED, or RESUMABLE job back to RUNNING or QUEUED."""
        job = self._jobs.get(job_id)
        if not job:
            return None
        if job["status"] not in (JobStatus.INTERRUPTED, JobStatus.PAUSED, JobStatus.RESUMABLE):
            raise ValueError(f"Không thể tiếp tục công việc ở trạng thái {job['status']}")

        if not self.validate_checkpoint(job_id):
            job["status"] = JobStatus.FAILED
            job["statusVi"] = JOB_STATUS_LABELS_VI[JobStatus.FAILED]
            job["error"] = "Điểm kiểm tra không hợp lệ hoặc bị hỏng, từ chối phục hồi."
            job["message"] = "Không thể tiếp tục do checkpoint không hợp lệ."
            self._persist_job(job)
            return job

        job["status"] = JobStatus.QUEUED
        job["statusVi"] = JOB_STATUS_LABELS_VI[JobStatus.QUEUED]
        job["message"] = "Chuẩn bị tiếp tục tác vụ từ điểm kiểm tra..."
        job["error"] = None
        job["updatedAt"] = _now_iso()
        self._persist_job(job)
        return job

    def pause_job(self, job_id: str) -> Optional[Dict[str, Any]]:
        job = self._jobs.get(job_id)
        if not job:
            return None
        if job["status"] == JobStatus.RUNNING:
            job["status"] = JobStatus.PAUSED
            job["statusVi"] = JOB_STATUS_LABELS_VI[JobStatus.PAUSED]
            job["message"] = "Tác vụ đã tạm dừng an toàn."
            job["updatedAt"] = _now_iso()
            self._persist_job(job)
        return job

    def get_job(self, job_id: str) -> Optional[Dict[str, Any]]:
        return self._jobs.get(job_id)

    def list_jobs(self, project_id: Optional[str] = None, limit: int = 100) -> List[Dict[str, Any]]:
        jobs = list(self._jobs.values())
        if project_id:
            jobs = [j for j in jobs if j.get("projectId") == project_id]
        jobs.sort(key=lambda j: j.get("createdAt", ""), reverse=True)
        return jobs[:limit]

    def retry_job(self, job_id: str) -> Optional[Dict[str, Any]]:
        job = self._jobs.get(job_id)
        if not job:
            return None
        job["status"] = JobStatus.QUEUED
        job["statusVi"] = JOB_STATUS_LABELS_VI[JobStatus.QUEUED]
        job["progress"] = 0.0
        job["error"] = None
        job["retryCount"] = job.get("retryCount", 0) + 1
        job["message"] = f"Thử lại lần {job['retryCount']}..."
        job["startedAt"] = None
        job["completedAt"] = None
        job["finishedAt"] = None
        job["updatedAt"] = _now_iso()
        self._persist_job(job)
        return job

    def cancel_job(self, job_id: str) -> Optional[Dict[str, Any]]:
        job = self._jobs.get(job_id)
        if not job:
            return None
        if job["status"] in (JobStatus.QUEUED, JobStatus.RUNNING, JobStatus.PAUSED, JobStatus.RESUMABLE):
            job["status"] = JobStatus.CANCELLED
            job["statusVi"] = JOB_STATUS_LABELS_VI[JobStatus.CANCELLED]
            job["completedAt"] = _now_iso()
            job["finishedAt"] = job["completedAt"]
            job["message"] = "Đã hủy bởi người dùng"
            job["updatedAt"] = _now_iso()
            self._persist_job(job)
        return job

    def cleanup_history(self, max_days: int = 14, max_keep: int = 100) -> Dict[str, Any]:
        """
        Prunes old finished jobs metadata from history.
        CRITICAL SAFETY: Never removes any artifacts referenced in artifactRefs!
        """
        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(days=max_days)
        pruned_ids = []

        all_completed = [
            j for j in self._jobs.values()
            if j["status"] in (JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED)
        ]
        all_completed.sort(key=lambda j: j.get("createdAt", ""))

        # Delete older than max_days or exceeding max_keep
        for job in all_completed:
            job_id = job["jobId"]
            created_dt = None
            try:
                created_dt = datetime.fromisoformat(job["createdAt"].replace("Z", "+00:00"))
            except Exception:
                pass

            should_prune = False
            if created_dt and created_dt < cutoff:
                should_prune = True
            elif len(self._jobs) - len(pruned_ids) > max_keep:
                should_prune = True

            if should_prune:
                pruned_ids.append(job_id)
                # Remove disk files
                rf = self.runtime_dir / f"{job_id}.json"
                if rf.exists():
                    try:
                        rf.unlink()
                    except Exception:
                        pass
                p_dir = self._get_project_jobs_dir(job.get("projectId"))
                if p_dir:
                    pf = p_dir / f"{job_id}.json"
                    if pf.exists():
                        try:
                            pf.unlink()
                        except Exception:
                            pass
                self._jobs.pop(job_id, None)

        return {
            "prunedCount": len(pruned_ids),
            "remainingCount": len(self._jobs),
            "prunedJobIds": pruned_ids
        }


jobs_manager = JobsManager()


# ---------------------------------------------------------------------------
# Phase 8: minimal Final Render helpers through canonical storage authority.
# ---------------------------------------------------------------------------

_NON_TERMINAL_JOB_STATUSES = frozenset({
    JobStatus.QUEUED, JobStatus.RUNNING, JobStatus.PAUSED, JobStatus.RESUMABLE,
})


def find_active_project_job(project_id: str, job_type: str, export_id: str,
                            manager: "JobsManager | None" = None) -> Optional[Dict[str, Any]]:
    """Return the existing non-terminal project job owning this export, or None.

    Reads through the canonical project-job storage (never a side index).
    """
    mgr = manager or jobs_manager
    want = (job_type or "").upper()
    for job in mgr.list_jobs(project_id=project_id, limit=1000):
        if (job.get("type") or "").upper() != want:
            continue
        if (job.get("metadata") or {}).get("exportId") != export_id:
            continue
        if job.get("status") in _NON_TERMINAL_JOB_STATUSES:
            return job
    return None


def patch_project_job(project_id: str, job_id: str,
                      manager: "JobsManager | None" = None, **fields) -> Optional[Dict[str, Any]]:
    """Merge fields into the canonical project job via atomic persistence.

    Uses the same _persist_job machinery (runtime mirror + project copy with
    conflict resolution) as every other job mutation.
    """
    mgr = manager or jobs_manager
    job = mgr.get_job(job_id)
    if not job:
        return None
    if job.get("projectId") != project_id:
        return None
    status = fields.pop("status", None)
    if status:
        job["status"] = status
        job["statusVi"] = JOB_STATUS_LABELS_VI.get(status, status)
        if status == JobStatus.RUNNING and not job.get("startedAt"):
            job["startedAt"] = _now_iso()
        if status in (JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED):
            job["completedAt"] = job.get("completedAt") or _now_iso()
    if "progress" in fields and fields["progress"] is not None:
        job["progress"] = min(1.0, max(0.0, float(fields.pop("progress"))))
    if "message" in fields and fields["message"] is not None:
        job["message"] = fields.pop("message")
    if "error" in fields and fields["error"] is not None:
        job["error"] = fields.pop("error")
    meta = fields.pop("metadata", None)
    if isinstance(meta, dict):
        job.setdefault("metadata", {}).update(meta)
    for key, value in fields.items():
        job[key] = value
    job["updatedAt"] = _now_iso()
    mgr._persist_job(job)
    return job
