"""
UnfoldIQ Storage Manager & Safe Cache Policy — Phase 15A (P1)
Monitors disk usage across pipeline categories and provides safe, previewable,
permission-gated cleanup that strictly protects critical project assets.

Protected Resources (NEVER auto-deleted):
- approved assets
- locked assets
- project state / manifests / scripts
- final render (final.mp4)
- Visual Bible
- AI models (Kokoro, Whisper)
- source code
- .git, .env
"""

import logging
import os
import shutil
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Dict, Any, Optional, List

from studio.config import BASE_DIR, PROJECTS_DIR, OUTPUTS_DIR, TEMP_DIR
from studio.structured_logger import LOGS_DIR

logger = logging.getLogger("unfoldiq.storage_manager")

MODELS_DIR = BASE_DIR / "models"


def _dir_size(path: Path, exclude_subdirs: Optional[List[str]] = None) -> int:
    """Calculate total size of files under a directory, optionally excluding subdirectory names."""
    if not path.exists():
        return 0
    total = 0
    exclude = set(exclude_subdirs or [])
    for root, dirs, files in os.walk(path):
        # In-place modify dirs to skip excluded
        dirs[:] = [d for d in dirs if d not in exclude]
        for f in files:
            fp = Path(root) / f
            try:
                total += fp.stat().st_size
            except Exception:
                pass
    return total


class StorageManager:
    def __init__(self, projects_dir: Optional[Path] = None):
        self.projects_dir = projects_dir or PROJECTS_DIR

    def get_storage_breakdown(self) -> Dict[str, Any]:
        """Compute storage usage across all major pipeline categories."""
        # 1. Free disk space
        total_disk, used_disk, free_disk = shutil.disk_usage(BASE_DIR)

        # 2. Render cache
        render_cache_size = 0
        if self.projects_dir.exists():
            for p_dir in self.projects_dir.iterdir():
                if p_dir.is_dir():
                    rc = p_dir / "render_cache"
                    if rc.exists():
                        render_cache_size += _dir_size(rc)

        # 3. Projects (excluding render_cache)
        projects_size = _dir_size(self.projects_dir, exclude_subdirs=["render_cache"])

        # 4. Logs
        logs_size = _dir_size(LOGS_DIR)
        for lf in (BASE_DIR / "runtime").glob("*.log"):
            try:
                logs_size += lf.stat().st_size
            except Exception:
                pass

        # 5. Models
        models_size = _dir_size(MODELS_DIR)

        # 6. Python environment
        python_env_size = 0
        py_prefix = Path(sys.prefix)
        # Only measure if virtualenv inside project or accessible
        if py_prefix.exists() and (py_prefix.is_relative_to(BASE_DIR) or "venv" in str(py_prefix).lower()):
            try:
                python_env_size = _dir_size(py_prefix)
            except Exception:
                pass

        # 7. Exports
        exports_size = _dir_size(OUTPUTS_DIR)
        if PROJECTS_DIR.exists():
            for p_dir in PROJECTS_DIR.iterdir():
                if p_dir.is_dir():
                    exp = p_dir / "exports"
                    if exp.exists():
                        exports_size += _dir_size(exp)

        # 8. Temporary files & Test caches
        temp_size = _dir_size(TEMP_DIR)
        test_cache_size = 0
        scratch_dir = BASE_DIR / "scratch"
        if scratch_dir.exists():
            test_cache_size += _dir_size(scratch_dir)

        def to_mb(b: int) -> float:
            return round(b / (1024 * 1024), 2)

        def to_gb(b: int) -> float:
            return round(b / (1024 * 1024 * 1024), 2)

        return {
            "categories": {
                "projects": {"bytes": projects_size, "mb": to_mb(projects_size), "labelVi": "Dự án"},
                "renderCache": {"bytes": render_cache_size, "mb": to_mb(render_cache_size), "labelVi": "Render cache"},
                "testCache": {"bytes": test_cache_size, "mb": to_mb(test_cache_size), "labelVi": "Cache kiểm thử"},
                "logs": {"bytes": logs_size, "mb": to_mb(logs_size), "labelVi": "Nhật ký"},
                "models": {"bytes": models_size, "mb": to_mb(models_size), "labelVi": "Models"},
                "pythonEnv": {"bytes": python_env_size, "mb": to_mb(python_env_size), "labelVi": "Môi trường Python"},
                "exports": {"bytes": exports_size, "mb": to_mb(exports_size), "labelVi": "Exports"},
                "tempFiles": {"bytes": temp_size, "mb": to_mb(temp_size), "labelVi": "Temporary files"},
            },
            "disk": {
                "freeBytes": free_disk,
                "freeGb": to_gb(free_disk),
                "totalBytes": total_disk,
                "totalGb": to_gb(total_disk),
                "usedGb": to_gb(used_disk),
                "labelVi": "Dung lượng trống"
            }
        }

    def preview_cleanup(self, categories: Optional[List[str]] = None) -> Dict[str, Any]:
        """
        Scan candidates for cleanup without deleting anything.
        Explicitly displays protected resources warning.
        """
        selected_categories = set(categories or ["renderCache", "testCache", "tempFiles"])
        deletable_files: List[Dict[str, Any]] = []
        reclaimable_bytes = 0

        # 1. Render Cache
        if "renderCache" in selected_categories and self.projects_dir.exists():
            for p_dir in self.projects_dir.iterdir():
                if p_dir.is_dir():
                    rc = p_dir / "render_cache"
                    if rc.exists():
                        for fp in rc.glob("*"):
                            if fp.is_file():
                                sz = fp.stat().st_size
                                deletable_files.append({
                                    "category": "renderCache",
                                    "path": str(fp.relative_to(BASE_DIR)) if fp.is_relative_to(BASE_DIR) else str(fp),
                                    "absPath": str(fp),
                                    "size": sz
                                })
                                reclaimable_bytes += sz

        # 2. Temp files
        if "tempFiles" in selected_categories and TEMP_DIR.exists():
            cutoff = datetime.now() - timedelta(hours=1)
            for fp in TEMP_DIR.glob("**/*"):
                if fp.is_file():
                    try:
                        mtime = datetime.fromtimestamp(fp.stat().st_mtime)
                        if mtime < cutoff:
                            sz = fp.stat().st_size
                            deletable_files.append({
                                "category": "tempFiles",
                                "path": str(fp.relative_to(BASE_DIR)) if fp.is_relative_to(BASE_DIR) else str(fp),
                                "absPath": str(fp),
                                "size": sz
                            })
                            reclaimable_bytes += sz
                    except Exception:
                        pass

        # 3. Test Cache & Scratch
        if "testCache" in selected_categories:
            scratch_dir = BASE_DIR / "scratch"
            if scratch_dir.exists():
                for fp in scratch_dir.glob("**/*"):
                    if fp.is_file():
                        sz = fp.stat().st_size
                        deletable_files.append({
                            "category": "testCache",
                            "path": str(fp.relative_to(BASE_DIR)) if fp.is_relative_to(BASE_DIR) else str(fp),
                            "absPath": str(fp),
                            "size": sz
                        })
                        reclaimable_bytes += sz

        # 4. Old Archive files (veo_prompts_archive_*.json & visual_bible_archive_*.json beyond 3 newest)
        if "archiveFiles" in selected_categories and self.projects_dir.exists():
            for p_dir in self.projects_dir.iterdir():
                if p_dir.is_dir():
                    # veo prompts archives
                    veo_archives = sorted(p_dir.glob("veo_prompts_archive_*.json"), key=lambda f: f.name)
                    if len(veo_archives) > 3:
                        # Keep the newest 3, delete older
                        for fp in veo_archives[:-3]:
                            sz = fp.stat().st_size
                            deletable_files.append({
                                "category": "archiveFiles",
                                "path": str(fp.relative_to(BASE_DIR)) if fp.is_relative_to(BASE_DIR) else str(fp),
                                "absPath": str(fp),
                                "size": sz
                            })
                            reclaimable_bytes += sz
                    # visual bible archives
                    vb_archives = sorted(p_dir.glob("visual_bible_archive_*.json"), key=lambda f: f.name)
                    if len(vb_archives) > 3:
                        for fp in vb_archives[:-3]:
                            sz = fp.stat().st_size
                            deletable_files.append({
                                "category": "archiveFiles",
                                "path": str(fp.relative_to(BASE_DIR)) if fp.is_relative_to(BASE_DIR) else str(fp),
                                "absPath": str(fp),
                                "size": sz
                            })
                            reclaimable_bytes += sz

        return {
            "candidateCount": len(deletable_files),
            "reclaimableBytes": reclaimable_bytes,
            "reclaimableMb": round(reclaimable_bytes / (1024 * 1024), 2),
            "protectedWarningVi": "BẢO VỆ DỮ LIỆU: Các mục sau luôn được bảo vệ tuyệt đối và không bao giờ bị xóa: tài nguyên đã duyệt (approved assets), tài nguyên đã khóa (locked assets), trạng thái dự án (project state), bản kết xuất cuối (final.mp4), Visual Bible, models, mã nguồn, tệp .git và .env.",
            "candidatesSample": deletable_files[:30],
            "allCandidates": deletable_files
        }

    def execute_cleanup(self, categories: Optional[List[str]] = None, confirmed: bool = False) -> Dict[str, Any]:
        """
        Safely deletes only whitelisted disposable cache and temp files.
        Guarantees protected items are NEVER deleted.
        """
        if not confirmed:
            raise ValueError("Cần xác nhận dọn dẹp trước khi thực hiện.")

        preview = self.preview_cleanup(categories=categories)
        deleted_count = 0
        freed_bytes = 0
        errors: List[str] = []

        # Strict blacklist / protected markers
        PROTECTED_MARKERS = [
            ".git", ".env", "models", "script.json", "script.txt",
            "final.mp4", "intake_ledger.json", "audio.wav", "manifest.json"
        ]

        target_items = preview.get("allCandidates", preview.get("candidatesSample", []))
        for item in target_items:
            abs_p = Path(item["absPath"])
            # Strict protection: exact active project files
            if abs_p.name in ["visual_bible.json", "veo_prompts.json", "script.json", "settings.json", "manifest.json", "audio.wav", "final.mp4"]:
                logger.warning(f"Prevented deletion of protected file: {abs_p}")
                continue
            path_str = str(abs_p).lower()
            if any(marker in path_str for marker in PROTECTED_MARKERS):
                logger.warning(f"Prevented deletion of protected file: {abs_p}")
                continue

            if abs_p.exists() and abs_p.is_file():
                try:
                    abs_p.unlink()
                    deleted_count += 1
                    freed_bytes += item["size"]
                except Exception as e:
                    errors.append(f"{abs_p.name}: {e}")

        logger.info(f"Storage cleanup completed: {deleted_count} files removed, {freed_bytes} bytes freed")
        return {
            "status": "SUCCESS",
            "statusVi": "Đã dọn dẹp thành công",
            "deletedCount": deleted_count,
            "freedBytes": freed_bytes,
            "freedMb": round(freed_bytes / (1024 * 1024), 2),
            "errors": errors
        }


storage_manager = StorageManager()
