"""
UnfoldIQ Faster-Whisper STT Provider Adapter (Phase 1)
Wraps transcription worker and aligner behind the vendor-neutral STTProvider interface.
"""

from pathlib import Path
from typing import Dict, Any, List, Optional
import json

from studio.providers.base import STTProvider, TranscriptionResult
from studio.transcription_service import transcription_service


class WhisperSTTProvider(STTProvider):
    name: str = "faster-whisper"

    def __init__(self, service=None):
        self.service = service or transcription_service

    def is_available(self) -> bool:
        return True

    async def transcribe_segment(
        self,
        audio_path: Path,
        language: str = "en",
        **kwargs
    ) -> TranscriptionResult:
        """
        Transcribe an audio file using configured Whisper worker.
        """
        project_dir = audio_path.parent
        project_id = project_dir.name

        status = self.service.check_project_timestamps_status(project_id)
        ts_json = project_dir / "timestamps.json"
        
        segments = []
        words = []
        full_text = ""

        if ts_json.is_file():
            try:
                data = json.loads(ts_json.read_text(encoding="utf-8"))
                segments = data.get("segments", [])
                words = data.get("words", [])
                full_text = " ".join(s.get("text", "") for s in segments)
            except Exception:
                pass

        return TranscriptionResult(
            text=full_text,
            segments=segments,
            words=words,
            metadata={"engine": "faster-whisper", "language": language, "status": status}
        )

    def check_health(self) -> Dict[str, Any]:
        ready = self.service.is_worker_env_ready()
        model_installed = self.service.is_model_installed()
        return {
            "healthy": ready and model_installed,
            "worker_env_ready": ready,
            "model_installed": model_installed,
            "gpu_busy": self.service.is_gpu_busy(),
        }

    async def start_transcription(self, project_id: str, script_text: str = "", force: bool = False, **kwargs) -> Dict[str, Any]:
        # Adapter translation (v1.0.1 corrective): the provider-level contract
        # exposes script_text/force, but the concrete TranscriptionService has
        # the intentionally narrower API (project_id, is_tts_active_fn). The
        # service reads the script from disk (script.txt) and has no force
        # semantics, so those provider-level args are intentionally consumed
        # here — never leaked into the service call (see
        # tests/test_stt_provider_delegation.py).
        is_tts_active_fn = kwargs.get("is_tts_active_fn")
        return await self.service.start_transcription(
            project_id, is_tts_active_fn=is_tts_active_fn)

    async def cancel_transcription(self, project_id: str) -> bool:
        return await self.service.cancel_transcription(project_id)

    def get_job(self, project_id: str) -> Optional[Dict[str, Any]]:
        return self.service.get_job(project_id)

    def check_project_timestamps_status(self, project_id: str) -> Dict[str, Any]:
        return self.service.check_project_timestamps_status(project_id)

    def is_gpu_busy(self) -> bool:
        return self.service.is_gpu_busy()

    def get_active_projects(self) -> List[str]:
        return list(getattr(self.service, "_active_procs", {}).keys())


