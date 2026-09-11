"""
Audio service for Kokoro-FastAPI communication, WAV stitching, and MP3 conversion.
"""

import asyncio
import json
import logging
import subprocess
from pathlib import Path
from typing import List, Dict, Any, Optional

import httpx
import numpy as np
import soundfile as sf
import wave

from studio.config import config

logger = logging.getLogger("unfoldiq.audio")

VOICE_PREFIXES = {
    "af": {"lang": "en-us", "lang_name": "American English", "gender": "Female"},
    "am": {"lang": "en-us", "lang_name": "American English", "gender": "Male"},
    "bf": {"lang": "en-gb", "lang_name": "British English", "gender": "Female"},
    "bm": {"lang": "en-gb", "lang_name": "British English", "gender": "Male"},
    "ef": {"lang": "es", "lang_name": "Spanish", "gender": "Female"},
    "em": {"lang": "es", "lang_name": "Spanish", "gender": "Male"},
    "ff": {"lang": "fr", "lang_name": "French", "gender": "Female"},
    "hf": {"lang": "hi", "lang_name": "Hindi", "gender": "Female"},
    "hm": {"lang": "hi", "lang_name": "Hindi", "gender": "Male"},
    "if": {"lang": "it", "lang_name": "Italian", "gender": "Female"},
    "im": {"lang": "it", "lang_name": "Italian", "gender": "Male"},
    "jf": {"lang": "ja", "lang_name": "Japanese", "gender": "Female"},
    "jm": {"lang": "ja", "lang_name": "Japanese", "gender": "Male"},
    "pf": {"lang": "pt-br", "lang_name": "Portuguese", "gender": "Female"},
    "pm": {"lang": "pt-br", "lang_name": "Portuguese", "gender": "Male"},
    "zf": {"lang": "zh", "lang_name": "Mandarin Chinese", "gender": "Female"},
    "zm": {"lang": "zh", "lang_name": "Mandarin Chinese", "gender": "Male"},
}


class KokoroClient:
    def __init__(self, base_url: Optional[str] = None):
        self.base_url = (base_url or config.kokoro_base_url).rstrip("/")

    async def check_health(self) -> Dict[str, Any]:
        """Check if Kokoro server is running and healthy."""
        url = f"{self.base_url}/health"
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                resp = await client.get(url)
                if resp.status_code == 200:
                    return {"healthy": True, "data": resp.json()}
                return {"healthy": False, "error": f"HTTP {resp.status_code}: {resp.text}"}
        except Exception as e:
            return {"healthy": False, "error": str(e)}

    async def get_voices(self) -> List[Dict[str, Any]]:
        """Fetch available voices from Kokoro and parse metadata."""
        url = f"{self.base_url}/v1/audio/voices"
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(url)
                resp.raise_for_status()
                data = resp.json()
                raw_voices = data.get("voices", [])

                enriched = []
                for v in raw_voices:
                    vid = v.get("id") or v.get("name")
                    prefix = vid[:2].lower() if len(vid) >= 2 else ""
                    meta = VOICE_PREFIXES.get(prefix, {
                        "lang": "unknown",
                        "lang_name": "Other",
                        "gender": "Unknown"
                    })
                    enriched.append({
                        "id": vid,
                        "name": v.get("name", vid),
                        "language": meta["lang_name"],
                        "lang_code": meta["lang"],
                        "gender": meta["gender"],
                        "grade": v.get("overall_grade", "Standard"),
                        "is_default": (vid == config.default_voice),
                    })

                # Sort: default first, then American English, then others alphabetically
                enriched.sort(key=lambda x: (not x["is_default"], x["language"] != "American English", x["id"]))
                return enriched
        except Exception as e:
            logger.error(f"Failed to fetch voices: {e}")
            # Fallback list if offline
            return [{
                "id": config.default_voice,
                "name": config.default_voice,
                "language": "American English",
                "lang_code": "en-us",
                "gender": "Female",
                "grade": "A",
                "is_default": True
            }]

    async def synthesize_chunk(
        self,
        text: str,
        voice: str,
        speed: float,
        output_path: Path,
        cancel_event: Optional[asyncio.Event] = None
    ) -> None:
        """
        Synthesize a single text chunk via Kokoro HTTP API and write WAV stream.
        """
        if cancel_event and cancel_event.is_set():
            raise asyncio.CancelledError("Synthesis cancelled before chunk start.")

        url = f"{self.base_url}/v1/audio/speech"
        payload = {
            "model": "kokoro",
            "input": text,
            "voice": voice,
            "speed": speed,
            "response_format": "wav"
        }

        async with httpx.AsyncClient(timeout=180.0) as client:
            async with client.stream("POST", url, json=payload) as resp:
                if resp.status_code != 200:
                    err_body = await resp.aread()
                    raise RuntimeError(f"Kokoro synthesis failed (HTTP {resp.status_code}): {err_body.decode('utf-8', errors='replace')}")

                output_path.parent.mkdir(parents=True, exist_ok=True)
                with open(output_path, "wb") as f:
                    async for chunk in resp.aiter_bytes(chunk_size=16384):
                        if cancel_event and cancel_event.is_set():
                            raise asyncio.CancelledError("Synthesis cancelled during chunk stream.")
                        f.write(chunk)


def stitch_wav_files(chunk_paths: List[Path], output_wav_path: Path) -> float:
    """
    Losslessly stitch multiple 24kHz 16-bit Mono WAV chunks into a single master WAV.
    Returns: duration in seconds.
    """
    if not chunk_paths:
        raise ValueError("No audio chunks provided for stitching.")

    audio_arrays = []
    target_sr = 24000

    for idx, path in enumerate(chunk_paths):
        if not path.is_file():
            raise FileNotFoundError(f"Chunk file not found: {path}")

        # soundfile natively parses streaming WAV chunks even with 0x7fffffff sentinel headers
        data, sr = sf.read(str(path), dtype="int16")
        if sr != target_sr:
            raise ValueError(f"Chunk {path.name} sample rate {sr} does not match expected {target_sr}")
        if data.ndim > 1:
            data = data[:, 0]  # Mono
        audio_arrays.append(data)

    # Concatenate all PCM samples
    master_pcm = np.concatenate(audio_arrays)
    duration_s = float(len(master_pcm)) / float(target_sr)

    # Write pristine, valid RIFF WAV
    output_wav_path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(output_wav_path), master_pcm, target_sr, subtype="PCM_16")

    # Validate output with Python standard wave library
    with wave.open(str(output_wav_path), "rb") as wf:
        nframes = wf.getnframes()
        framerate = wf.getframerate()
        if nframes != len(master_pcm) or framerate != target_sr:
            raise RuntimeError("Stitched WAV verification failed: frame count or sample rate mismatch.")

    return duration_s


def convert_wav_to_mp3(wav_path: Path, mp3_path: Path, bitrate: str = "160k") -> Path:
    """
    Convert master WAV to high-quality MP3 using ffmpeg.
    Note: For 24kHz audio (MPEG-2 Layer III), 160 kbps is the maximum standard bitrate
    defined by ISO/IEC 13818-3.
    """
    if not wav_path.is_file():
        raise FileNotFoundError(f"WAV source not found: {wav_path}")

    mp3_path.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        config.ffmpeg_path,
        "-y",
        "-i", str(wav_path),
        "-codec:a", "libmp3lame",
        "-b:a", bitrate,
        str(mp3_path)
    ]

    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"FFmpeg MP3 export failed: {res.stderr}")

    return mp3_path


def probe_audio(file_path: Path) -> Dict[str, Any]:
    """
    Run ffprobe on an audio file and return metadata.
    """
    if not file_path.is_file():
        raise FileNotFoundError(f"Audio file not found: {file_path}")

    cmd = [
        config.ffprobe_path,
        "-v", "quiet",
        "-print_format", "json",
        "-show_format",
        "-show_streams",
        str(file_path)
    ]

    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"ffprobe failed: {res.stderr}")

    data = json.loads(res.stdout)
    stream = data.get("streams", [{}])[0]
    fmt = data.get("format", {})

    return {
        "file": file_path.name,
        "sample_rate": int(stream.get("sample_rate", 0)),
        "channels": int(stream.get("channels", 0)),
        "channel_layout": stream.get("channel_layout", "mono"),
        "codec_name": stream.get("codec_name", ""),
        "duration": float(fmt.get("duration", 0.0)),
        "bit_rate": int(fmt.get("bit_rate", 0)),
        "size_bytes": int(fmt.get("size", 0)),
    }
