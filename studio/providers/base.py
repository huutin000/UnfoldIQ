"""
UnfoldIQ Provider Abstraction Interfaces (Phase 1)
Defines minimal vendor-neutral boundaries for Audio Synthesis (TTS) and Transcription (STT).
Ensures business logic is never tightly coupled to specific local engines (Kokoro/Whisper).
"""

from abc import ABC, abstractmethod
from pathlib import Path
from typing import Dict, Any, List, Optional


class AudioSynthesisResult:
    def __init__(self, output_path: Path, duration_seconds: float, sample_rate: int = 24000, metadata: Optional[Dict[str, Any]] = None):
        self.output_path = output_path
        self.duration_seconds = duration_seconds
        self.sample_rate = sample_rate
        self.metadata = metadata or {}


class TranscriptionResult:
    def __init__(self, text: str, segments: List[Dict[str, Any]], words: Optional[List[Dict[str, Any]]] = None, metadata: Optional[Dict[str, Any]] = None):
        self.text = text
        self.segments = segments
        self.words = words or []
        self.metadata = metadata or {}


class TTSProvider(ABC):
    """Abstract interface for text-to-speech engines."""

    @abstractmethod
    async def synthesize_chunk(
        self,
        text: str,
        voice: str,
        speed: float,
        output_path: Path,
        **kwargs
    ) -> AudioSynthesisResult:
        """Synthesize a single text chunk into output audio file."""
        pass

    @abstractmethod
    async def get_available_voices(self) -> List[Dict[str, Any]]:
        """Return list of supported voice models with metadata."""
        pass

    @abstractmethod
    async def check_health(self) -> Dict[str, Any]:
        """Check provider operational status."""
        pass


class STTProvider(ABC):
    """Abstract interface for speech-to-text / alignment engines."""

    @abstractmethod
    async def transcribe_segment(
        self,
        audio_path: Path,
        language: str = "en",
        **kwargs
    ) -> TranscriptionResult:
        """Transcribe and align an audio segment."""
        pass

    @abstractmethod
    def check_health(self) -> Dict[str, Any]:
        """Check provider operational status."""
        pass

    async def start_transcription(self, project_id: str, script_text: str = "", force: bool = False, **kwargs) -> Dict[str, Any]:
        """Start an asynchronous transcription job for a project."""
        raise NotImplementedError

    async def cancel_transcription(self, project_id: str) -> bool:
        """Cancel an active transcription worker."""
        raise NotImplementedError

    def get_job(self, project_id: str) -> Optional[Dict[str, Any]]:
        """Get running job metadata."""
        return None

    def check_project_timestamps_status(self, project_id: str) -> Dict[str, Any]:
        """Check project timestamps status."""
        return {"exists": False, "has_audio": False}

    def is_gpu_busy(self) -> bool:
        """Check if STT engine currently occupies GPU resources."""
        return False

    def get_active_projects(self) -> List[str]:
        """Return list of project IDs with active STT processes."""
        return []


