"""
UnfoldIQ Kokoro TTS Provider Adapter (Phase 1)
Wraps KokoroClient behind the vendor-neutral TTSProvider interface.
"""

from pathlib import Path
from typing import Dict, Any, List, Optional
import soundfile as sf

from studio.audio_service import KokoroClient
from studio.providers.base import TTSProvider, AudioSynthesisResult


class KokoroTTSProvider(TTSProvider):
    name: str = "kokoro"

    def __init__(self, client: Optional[KokoroClient] = None):
        self.client = client or KokoroClient()

    def is_available(self) -> bool:
        return True

    def list_available_voices(self) -> List[str]:
        return ["af_sarah", "af_bella", "af_nicole", "af_sky", "am_adam", "am_michael"]

    async def synthesize_chunk(
        self,
        text: str,
        voice: str,
        speed: float,
        output_path: Path,
        **kwargs
    ) -> AudioSynthesisResult:
        cancel_event = kwargs.get("cancel_event")
        await self.client.synthesize_chunk(
            text=text,
            voice=voice,
            speed=speed,
            output_path=output_path,
            cancel_event=cancel_event
        )

        # Probe output duration
        duration = 0.0
        sr = 24000
        if output_path.is_file():
            info = sf.info(str(output_path))
            duration = info.duration
            sr = info.samplerate

        return AudioSynthesisResult(
            output_path=output_path,
            duration_seconds=duration,
            sample_rate=sr,
            metadata={"engine": "kokoro", "voice": voice, "speed": speed}
        )

    async def get_available_voices(self) -> List[Dict[str, Any]]:
        return await self.client.get_voices()

    async def check_health(self) -> Dict[str, Any]:
        return await self.client.check_health()
