"""
Transcription Service for UnfoldIQ TTS Studio.
Orchestrates on-demand transcription worker subprocesses, enforces GPU mutual exclusion,
tracks live progress, and handles job cancellation.
"""

import asyncio
import hashlib
import json
import logging
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from studio.config import BASE_DIR, PROJECTS_DIR, config

logger = logging.getLogger("unfoldiq.transcription")


# In-memory cache for audio sha256 to avoid repeated multi-megabyte disk reads during status polling:
# {project_id: (st_mtime_ns, st_size, sha256_hex)}
_audio_hash_cache: Dict[str, Tuple[int, int, str]] = {}


def _compute_sha256(filepath: Path) -> str:
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


def get_audio_sha256_fast(project_id: str, audio_path: Path) -> str:
    """Return sha256 of audio_path, reusing cached value if mtime and size are unchanged."""
    try:
        st = audio_path.stat()
        cached = _audio_hash_cache.get(project_id)
        if cached and cached[0] == st.st_mtime_ns and cached[1] == st.st_size:
            return cached[2]
        new_hash = _compute_sha256(audio_path)
        _audio_hash_cache[project_id] = (st.st_mtime_ns, st.st_size, new_hash)
        return new_hash
    except Exception:
        return _compute_sha256(audio_path)


class TranscriptionService:
    def __init__(self):
        self.worker_venv_python = BASE_DIR / "transcription" / ".venv" / "Scripts" / "python.exe"
        self.worker_script = BASE_DIR / "transcription" / "worker.py"
        
        # In-memory tracking of transcription jobs: {project_id: job_dict}
        self.jobs: Dict[str, Dict[str, Any]] = {}
        # Active subprocesses: {project_id: asyncio.subprocess.Process}
        self._active_procs: Dict[str, asyncio.subprocess.Process] = {}
        # Lock to guard GPU mutual exclusion
        self._lock = asyncio.Lock()

    def is_worker_env_ready(self) -> bool:
        return self.worker_venv_python.exists() and self.worker_script.exists()

    def get_configured_model_path(self) -> Path:
        model_p = Path(config.transcription_model_path)
        if not model_p.is_absolute():
            model_p = BASE_DIR / model_p
        return model_p

    def is_model_installed(self) -> bool:
        return self.get_configured_model_path().exists()

    def is_gpu_busy(self) -> bool:
        """Returns True if any GPU transcription is currently active."""
        for j in self.jobs.values():
            if j.get("state") in ("preparing", "loading_model", "transcribing", "aligning", "writing"):
                if j.get("device") == "cuda":
                    return True
        return False

    def get_job(self, project_id: str) -> Optional[Dict[str, Any]]:
        return self.jobs.get(project_id)

    def check_project_timestamps_status(self, project_id: str) -> Dict[str, Any]:
        """Inspects project directory to check if timestamps exist and if audio is fresh or stale."""
        project_dir = PROJECTS_DIR / project_id
        if not project_dir.exists():
            return {"exists": False, "error": "Project does not exist."}

        audio_path = project_dir / "audio.wav"
        if not audio_path.exists():
            return {"exists": False, "has_audio": False}

        ts_json = project_dir / "timestamps.json"
        ts_srt = project_dir / "timestamps.srt"

        if not ts_json.exists() or not ts_srt.exists():
            # Check if active in memory
            active = self.get_job(project_id)
            if active and active.get("state") != "completed":
                return active
            return {
                "exists": False,
                "has_audio": True,
                "state": "idle"
            }

        # Check audio hash staleness
        try:
            with open(ts_json, "r", encoding="utf-8") as f:
                data = json.load(f)
            saved_hash = data.get("audio_sha256", "")
            current_hash = get_audio_sha256_fast(project_id, audio_path)
            is_stale = (saved_hash != current_hash)
            
            # Active job status takes precedence if currently running
            active = self.get_job(project_id)
            if active and active.get("state") not in ("completed", "failed", "cancelled"):
                return active

            return {
                "exists": True,
                "has_audio": True,
                "state": "stale" if is_stale else "completed",
                "is_stale": is_stale,
                "audio_sha256": current_hash,
                "saved_sha256": saved_hash,
                "audio_duration": data.get("audio_duration", 0.0),
                "coverage_pct": data.get("alignment", {}).get("coverage_pct", 0.0),
                "total_sentences": len(data.get("segments", [])),
                "model": data.get("transcription", {}).get("model", ""),
                "device": data.get("transcription", {}).get("device", ""),
                "compute_type": data.get("transcription", {}).get("compute_type", "")
            }
        except Exception as e:
            logger.warning(f"Error reading timestamps for {project_id}: {e}")
            return {"exists": False, "has_audio": True, "error": str(e)}

    async def start_transcription(
        self,
        project_id: str,
        is_tts_active_fn: Optional[Any] = None
    ) -> Dict[str, Any]:
        """
        Starts a background transcription job for a project.
        Enforces GPU mutual exclusion with TTS.
        """
        project_dir = (PROJECTS_DIR / project_id).resolve()
        if not project_dir.exists():
            raise FileNotFoundError(f"Project '{project_id}' not found.")

        audio_path = project_dir / "audio.wav"
        if not audio_path.exists():
            raise FileNotFoundError(f"Audio file 'audio.wav' not found in project '{project_id}'.")

        script_path = project_dir / "script.txt"
        if not script_path.exists():
            raise FileNotFoundError(f"Script file 'script.txt' not found in project '{project_id}'.")

        if not self.is_worker_env_ready():
            raise RuntimeError(f"Transcription virtual environment is not configured at {self.worker_venv_python}.")

        model_path = self.get_configured_model_path()
        if not model_path.exists():
            raise FileNotFoundError(f"Local Whisper model is not installed at {model_path}.")

        # Check GPU mutual exclusion
        device = config.transcription_device
        if device == "cuda" and is_tts_active_fn and is_tts_active_fn():
            raise RuntimeError("Cannot start GPU transcription while TTS synthesis is active.")

        async with self._lock:
            # Check if already transcribing this project
            existing = self.jobs.get(project_id)
            if existing and existing.get("state") in ("preparing", "loading_model", "transcribing", "aligning", "writing"):
                return existing

            job = {
                "project_id": project_id,
                "state": "preparing",
                "stage": "preparing",
                "percent": 0,
                "message": "Starting transcription worker...",
                "model": model_path.name,
                "device": device,
                "compute_type": config.transcription_compute_type,
                "start_time": time.time(),
                "elapsed_seconds": 0.0,
                "error": None
            }
            self.jobs[project_id] = job

        # Launch background task
        asyncio.create_task(self._run_worker_task(project_id, project_dir, model_path))
        return job

    async def _run_worker_task(self, project_id: str, project_dir: Path, model_path: Path):
        job = self.jobs[project_id]
        from studio.resource_scheduler import resource_scheduler
        from studio.domain_models import ResourceClass
        rc = ResourceClass.CUDA_HEAVY.value if job.get("device") == "cuda" else ResourceClass.CPU_BOUND.value

        async def _execute():
            cmd = [
                str(self.worker_venv_python),
                str(self.worker_script),
                str(project_dir),
                "--model-path", str(model_path),
                "--device", job["device"],
                "--compute-type", job["compute_type"],
                "--language", config.transcription_language
            ]

            logger.info(f"Spawning transcription worker for {project_id} via LocalResourceScheduler ({rc}): {' '.join(cmd)}")
            try:
                proc = await asyncio.create_subprocess_exec(
                    *cmd,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                self._active_procs[project_id] = proc
                job["pid"] = proc.pid

                # Record worker PID in runtime directory for launcher tracking
                worker_pid_file = BASE_DIR / "runtime" / "transcription_worker.pid"
                try:
                    worker_pid_file.parent.mkdir(parents=True, exist_ok=True)
                    worker_pid_file.write_text(str(proc.pid), encoding="utf-8")
                except Exception:
                    pass

                # Read stdout line by line
                while True:
                    line = await proc.stdout.readline()
                    if not line:
                        break
                    decoded = line.decode("utf-8", errors="replace").strip()
                    if not decoded:
                        continue

                    try:
                        data = json.loads(decoded)
                        if data.get("event") == "progress":
                            job["stage"] = data.get("stage", job["stage"])
                            job["state"] = data.get("stage", job["state"])
                            job["percent"] = data.get("percent", job["percent"])
                            job["message"] = data.get("message", job["message"])
                            job["elapsed_seconds"] = round(time.time() - job["start_time"], 1)
                            if "metrics" in data:
                                job["metrics"] = data["metrics"]
                    except json.JSONDecodeError:
                        logger.debug(f"Worker raw output: {decoded}")

                returncode = await proc.wait()
                job["elapsed_seconds"] = round(time.time() - job["start_time"], 1)

                if returncode == 0:
                    job["state"] = "completed"
                    job["stage"] = "completed"
                    job["percent"] = 100
                    job["message"] = "Timestamps generated successfully."
                    logger.info(f"Transcription worker {project_id} completed in {job['elapsed_seconds']}s.")
                elif job.get("state") == "cancelling" or job.get("state") == "cancelled":
                    job["state"] = "cancelled"
                    job["stage"] = "cancelled"
                    job["message"] = "Transcription cancelled by user."
                    logger.info(f"Transcription worker {project_id} cancelled.")
                else:
                    stderr_bytes = await proc.stderr.read()
                    err_text = stderr_bytes.decode("utf-8", errors="replace").strip()
                    job["state"] = "failed"
                    job["stage"] = "failed"
                    job["error"] = err_text or f"Worker exited with code {returncode}"
                    job["message"] = f"Transcription failed: {job['error']}"
                    logger.error(f"Transcription worker {project_id} failed: {job['error']}")

            except asyncio.CancelledError:
                logger.info(f"Transcription worker task {project_id} cancelled.")
                await self.cancel_transcription(project_id)
            except Exception as e:
                logger.exception(f"Unexpected error in transcription worker task for {project_id}: {e}")
                job["state"] = "failed"
                job["stage"] = "failed"
                job["error"] = str(e)
                job["message"] = f"Transcription failed: {e}"
            finally:
                self._active_procs.pop(project_id, None)

        try:
            await resource_scheduler.submit_job(
                job_id=f"whisper_{project_id}_{int(time.time()*1000)}",
                job_type="faster_whisper_stt",
                resource_class=rc,
                coro_fn=_execute,
                metadata={"project_id": project_id, "device": job["device"]}
            )
        except Exception as e:
            if job.get("state") not in ("cancelled", "completed"):
                job["state"] = "failed"
                job["stage"] = "failed"
                job["error"] = str(e)
                job["message"] = f"Scheduling failed: {e}"
                logger.error(f"Failed to schedule transcription job for {project_id}: {e}")
            logger.exception(f"Transcription worker exception for {project_id}: {e}")
        finally:
            self._active_procs.pop(project_id, None)
            worker_pid_file = BASE_DIR / "runtime" / "transcription_worker.pid"
            if worker_pid_file.exists():
                try:
                    worker_pid_file.unlink()
                except Exception:
                    pass

    async def cancel_transcription(self, project_id: str) -> bool:
        """Terminates ONLY the owned transcription worker process."""
        proc = self._active_procs.get(project_id)
        job = self.jobs.get(project_id)

        if job:
            job["state"] = "cancelling"
            job["stage"] = "cancelling"
            job["message"] = "Cancelling transcription..."

        if proc:
            logger.info(f"Terminating owned transcription worker PID {proc.pid} for {project_id}...")
            try:
                proc.terminate()
                await asyncio.sleep(0.2)
                if proc.returncode is None:
                    proc.kill()
                await proc.wait()
            except Exception as e:
                logger.warning(f"Error terminating worker for {project_id}: {e}")
            finally:
                self._active_procs.pop(project_id, None)

        if job:
            job["state"] = "cancelled"
            job["stage"] = "cancelled"
            job["message"] = "Transcription cancelled."

        return True


transcription_service = TranscriptionService()
