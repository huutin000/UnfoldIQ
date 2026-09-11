"""
Project storage, directory management, and file persistence.
"""

import json
import re
import shutil
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, List, Optional

from studio.config import PROJECTS_DIR, OUTPUTS_DIR, TEMP_DIR


def sanitize_project_name(raw_name: str) -> str:
    """
    Sanitize user input string into safe filesystem folder/file name.
    Replaces non-alphanumeric chars (excluding hyphens/underscores) with underscores.
    Prevents path traversal and empty names.
    """
    if not raw_name or not raw_name.strip():
        return "unfoldiq_project"

    # Strip directory traversal characters
    cleaned = raw_name.strip().replace("..", "").replace("/", "_").replace("\\", "_")
    # Replace unsafe characters
    sanitized = re.sub(r'[^a-zA-Z0-9_\-]', '_', cleaned)
    # Deduplicate underscores
    sanitized = re.sub(r'_+', '_', sanitized).strip('._-')
    # Limit length
    if not sanitized:
        sanitized = "unfoldiq_project"
    return sanitized[:64]


def create_project_directory(project_name: str) -> Path:
    """
    Create a timestamped project directory avoiding collisions.
    Example: projects/2026-09-10_213000_video-01-ancient-human-babies
    """
    now_str = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    safe_name = sanitize_project_name(project_name)
    base_folder_name = f"{now_str}_{safe_name}"

    project_path = PROJECTS_DIR / base_folder_name

    # Handle collision if any
    counter = 1
    while project_path.exists():
        project_path = PROJECTS_DIR / f"{base_folder_name}_{counter}"
        counter += 1

    project_path.mkdir(parents=True, exist_ok=True)
    return project_path


def create_temp_job_dir(job_id: str) -> Path:
    """Create a temporary directory for chunk audio staging."""
    job_temp = TEMP_DIR / job_id
    job_temp.mkdir(parents=True, exist_ok=True)
    return job_temp


def cleanup_temp_job_dir(job_id: str) -> None:
    """Safely remove temporary job staging directory on success."""
    job_temp = TEMP_DIR / job_id
    if job_temp.exists():
        try:
            shutil.rmtree(job_temp)
        except Exception as e:
            print(f"[WARN] Failed to remove temp directory {job_temp}: {e}")


def save_project_metadata(
    project_dir: Path,
    script: str,
    settings: Dict[str, Any],
    manifest: Dict[str, Any]
) -> None:
    """Save script.txt, settings.json, and manifest.json into the project directory."""
    # 1. script.txt
    with open(project_dir / "script.txt", "w", encoding="utf-8") as f:
        f.write(script)

    # 2. settings.json
    with open(project_dir / "settings.json", "w", encoding="utf-8") as f:
        json.dump(settings, f, indent=2, ensure_ascii=False)

    # 3. manifest.json
    with open(project_dir / "manifest.json", "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)


def export_to_outputs(
    project_dir: Path,
    export_format: str = "wav",
    custom_filename: Optional[str] = None
) -> Path:
    """Copy final audio asset from project to outputs/ directory."""
    ext = export_format.lower().lstrip(".")
    source_file = project_dir / f"audio.{ext}"
    if not source_file.is_file():
        raise FileNotFoundError(f"Export source audio not found: {source_file}")

    target_name = sanitize_project_name(custom_filename or project_dir.name) + f".{ext}"
    target_path = OUTPUTS_DIR / target_name

    # Avoid silent overwrite in outputs
    counter = 1
    stem = target_path.stem
    while target_path.exists():
        target_path = OUTPUTS_DIR / f"{stem}_{counter}.{ext}"
        counter += 1

    shutil.copy2(source_file, target_path)
    return target_path


def list_projects() -> List[Dict[str, Any]]:
    """List all projects sorted by newest first."""
    projects = []
    if not PROJECTS_DIR.exists():
        return []

    for item in PROJECTS_DIR.iterdir():
        if item.is_dir():
            settings_path = item / "settings.json"
            meta = {}
            if settings_path.is_file():
                try:
                    with open(settings_path, "r", encoding="utf-8") as f:
                        meta = json.load(f)
                except Exception:
                    pass

            has_wav = (item / "audio.wav").is_file()
            has_mp3 = (item / "audio.mp3").is_file()
            has_timestamps = (item / "timestamps.json").is_file()
            has_scenes = (item / "scene_plan.json").is_file()

            projects.append({
                "directory_name": item.name,
                "project_name": meta.get("project_name", item.name),
                "timestamp": meta.get("timestamp", item.stat().st_mtime),
                "voice": meta.get("voice", "unknown"),
                "character_count": meta.get("character_count", 0),
                "chunk_count": meta.get("chunk_count", 0),
                "duration_seconds": meta.get("duration_seconds", 0.0),
                "has_wav": has_wav,
                "has_mp3": has_mp3,
                "has_timestamps": has_timestamps,
                "has_scenes": has_scenes,
                "status": meta.get("status", "completed" if has_wav else "incomplete"),
            })

    # Sort newest first
    projects.sort(key=lambda x: str(x["directory_name"]), reverse=True)
    return projects


def delete_project(directory_name: str) -> bool:
    """
    Safely delete a project directory from the projects root.
    Strictly verifies directory traversal and ensures canonical path is inside PROJECTS_DIR.
    """
    if not directory_name or not isinstance(directory_name, str) or not directory_name.strip():
        raise ValueError("Project directory name is required.")

    clean_name = directory_name.strip()
    if ".." in clean_name or "/" in clean_name or "\\" in clean_name:
        raise ValueError("Invalid project directory name: Path traversal not allowed.")

    canonical_root = PROJECTS_DIR.resolve()
    target_dir = (PROJECTS_DIR / clean_name).resolve()

    if not target_dir.exists() or not target_dir.is_dir():
        raise FileNotFoundError(f"Project directory '{clean_name}' not found.")

    if target_dir.parent != canonical_root:
        raise ValueError("Invalid project directory: Target is outside the projects root.")

    shutil.rmtree(target_dir)
    return True

