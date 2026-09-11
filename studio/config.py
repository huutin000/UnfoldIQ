import json
import os
import shutil
from pathlib import Path
from typing import Optional

BASE_DIR = Path(__file__).resolve().parent.parent
CONFIG_PATH = BASE_DIR / "config" / "app.json"
PROJECTS_DIR = BASE_DIR / "projects"
OUTPUTS_DIR = BASE_DIR / "outputs"
TEMP_DIR = BASE_DIR / "temp"

# Ensure runtime directories exist
for d in (PROJECTS_DIR, OUTPUTS_DIR, TEMP_DIR):
    d.mkdir(parents=True, exist_ok=True)


def _find_binary(name: str, preferred_path: Optional[str] = None) -> str:
    """Find binary from preferred path, PATH, or fallback."""
    if preferred_path and Path(preferred_path).is_file():
        return preferred_path
    which_path = shutil.which(name)
    if which_path:
        return which_path
    # Check winget packages fallback
    winget_dir = Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft" / "WinGet" / "Packages"
    if winget_dir.exists():
        matches = list(winget_dir.glob(f"**/{name}.exe"))
        if matches:
            return str(matches[0])
    return name


class AppConfig:
    def __init__(self):
        data = {}
        if CONFIG_PATH.exists():
            try:
                with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                    data = json.load(f)
            except Exception as e:
                print(f"[WARN] Failed to read {CONFIG_PATH}: {e}")

        self.kokoro_base_url: str = os.getenv(
            "KOKORO_BASE_URL", data.get("kokoro_base_url", "http://127.0.0.1:8880")
        ).rstrip("/")
        self.studio_host: str = os.getenv(
            "STUDIO_HOST", data.get("studio_host", "127.0.0.1")
        )
        self.studio_port: int = int(
            os.getenv("STUDIO_PORT", data.get("studio_port", 7860))
        )
        self.chunk_target_chars: int = int(data.get("chunk_target_chars", 400))
        self.chunk_max_chars: int = int(data.get("chunk_max_chars", 480))
        self.default_voice: str = data.get("default_voice", "af_heart")
        self.default_speed: float = float(data.get("default_speed", 1.0))
        self.ffmpeg_path: str = _find_binary("ffmpeg", data.get("ffmpeg_path"))
        self.ffprobe_path: str = _find_binary("ffprobe", data.get("ffprobe_path"))
        
        ts_data = data.get("transcription", {})
        self.transcription_enabled: bool = bool(ts_data.get("enabled", True))
        self.transcription_engine: str = ts_data.get("engine", "faster-whisper")
        self.transcription_model_path: str = ts_data.get("model_path", "models/whisper/small.en")
        self.transcription_device: str = ts_data.get("device", "cuda")
        self.transcription_compute_type: str = ts_data.get("compute_type", "int8_float16")
        self.transcription_language: str = ts_data.get("language", "en")
        self.transcription_word_timestamps: bool = bool(ts_data.get("word_timestamps", True))

        sp_data = data.get("scene_planner", {})
        self.scene_planner_target_duration: float = float(sp_data.get("target_duration_seconds", 6.0))
        self.scene_planner_min_duration: float = float(sp_data.get("min_duration_seconds", 3.0))
        self.scene_planner_max_duration: float = float(sp_data.get("max_duration_seconds", 10.0))
        self.scene_planner_default_aspect_ratio: str = str(sp_data.get("default_aspect_ratio", "16:9"))
        self.scene_planner_default_preset: str = str(sp_data.get("default_preset", "unfoldiq_documentary"))

        veo_data = data.get("veo_prompt_generator", {})
        self.veo_target_duration: float = float(veo_data.get("target_shot_duration_seconds", 6.0))
        self.veo_preferred_max_duration: float = float(veo_data.get("preferred_max_shot_duration_seconds", 8.0))
        self.veo_min_duration: float = float(veo_data.get("minimum_shot_duration_seconds", 3.0))
        self.veo_default_aspect_ratio: str = str(veo_data.get("default_aspect_ratio", "16:9"))


config = AppConfig()
