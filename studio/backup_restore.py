"""
UnfoldIQ Project Backup, Restore & Archive Service — Phase 15A (P0 & P2)
Safe, atomic backup and restore with manifest verification, collision detection,
rollback protection, and intelligent project archiving.

Principles:
- Never silent overwrite
- Always preview before destructive restore
- Full rollback snapshot on overwrite failure
- Zip Slip path traversal protection
- Checksum verification on every restored file
- Comprehensive archiving separating master artifacts from disposable cache
"""

import hashlib
import json
import logging
import os
import shutil
import time
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, Optional, List, Set

from studio.config import PROJECTS_DIR, BASE_DIR, TEMP_DIR
from studio.project_integrity import project_integrity_checker

logger = logging.getLogger("unfoldiq.backup_restore")

BACKUPS_DIR = BASE_DIR / "backups"
BACKUPS_DIR.mkdir(parents=True, exist_ok=True)

LIGHT_BACKUP_PATTERNS = [
    "*.json",
    "*.txt",
    "*.srt",
    "*.md",
    "manifests/*",
    "jobs/*",
    "research/*",
    "exports/*.json",
    "exports/manifests/*",
]


def _file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


class BackupRestoreService:
    def __init__(self, backups_dir: Path = BACKUPS_DIR):
        self.backups_dir = backups_dir
        self.backups_dir.mkdir(parents=True, exist_ok=True)

    def create_backup(
        self,
        project_dir: Path,
        backup_type: str = "light",
        include_final_render: bool = False,
        output_dir: Optional[Path] = None
    ) -> Path:
        """
        Create a zip backup package for a project.
        backup_type: 'light' (metadata/scripts/plans only) or 'full' (media master + locked assets).
        """
        project_id = project_dir.name
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        target_dir = output_dir or self.backups_dir
        target_dir.mkdir(parents=True, exist_ok=True)
        zip_filename = f"{project_id}_{backup_type}_{timestamp}.unfoldiq.zip"
        zip_path = target_dir / zip_filename

        # Collect files to include
        files_to_pack: List[Path] = []

        if backup_type == "light":
            # Only light artifacts
            for root, dirs, files in os.walk(project_dir):
                # Skip heavy caches and media binaries
                rel_root = Path(root).relative_to(project_dir)
                root_parts = rel_root.parts
                if any(p in ("render_cache", "renders", "assets") for p in root_parts):
                    # For assets, we only keep intake_ledger.json in light backup
                    for f in files:
                        if f == "intake_ledger.json":
                            files_to_pack.append(Path(root) / f)
                    continue
                for f in files:
                    fp = Path(root) / f
                    ext = fp.suffix.lower()
                    if ext in (".json", ".txt", ".srt", ".md", ".yaml", ".yml"):
                        files_to_pack.append(fp)
        else:
            # Full backup
            for root, dirs, files in os.walk(project_dir):
                rel_root = Path(root).relative_to(project_dir)
                root_parts = rel_root.parts
                # Never include ephemeral render cache or temp in full backup
                if any(p in ("render_cache", ".tmp") for p in root_parts):
                    continue
                for f in files:
                    fp = Path(root) / f
                    # If final.mp4 is in renders, only include if user opted in
                    if f.endswith(".mp4") and "renders" in root_parts and not include_final_render:
                        continue
                    files_to_pack.append(fp)

        # Build manifest
        file_manifest = []
        for fp in files_to_pack:
            try:
                rel_p = str(fp.relative_to(project_dir)).replace("\\", "/")
                file_manifest.append({
                    "path": rel_p,
                    "sha256": _file_sha256(fp),
                    "size": fp.stat().st_size
                })
            except Exception as e:
                logger.warning(f"Could not hash {fp}: {e}")

        manifest_data = {
            "manifestVersion": "1.0",
            "schemaVersion": "15.0",
            "backupType": backup_type,
            "projectId": project_id,
            "createdAt": datetime.now(timezone.utc).isoformat(),
            "fileCount": len(file_manifest),
            "files": file_manifest
        }

        # Write zip atomically
        temp_zip = target_dir / f".tmp_{zip_filename}"
        with zipfile.ZipFile(temp_zip, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("backup_manifest.json", json.dumps(manifest_data, indent=2, ensure_ascii=False))
            for fp in files_to_pack:
                rel_p = str(fp.relative_to(project_dir)).replace("\\", "/")
                zf.write(fp, arcname=f"project/{rel_p}")

        temp_zip.replace(zip_path)
        logger.info(f"Backup created: {zip_path} ({backup_type}, {len(files_to_pack)} files)")
        return zip_path

    def preview_backup(self, zip_path: Path) -> Dict[str, Any]:
        """Inspect and validate a backup archive prior to restoration."""
        if not zip_path.exists():
            raise FileNotFoundError(f"Không tìm thấy tệp sao lưu: {zip_path}")

        try:
            with zipfile.ZipFile(zip_path, "r") as zf:
                # Check for Zip Slip vulnerability
                for name in zf.namelist():
                    if name.startswith("/") or name.startswith("\\") or ".." in name or ":" in name:
                        raise ValueError(f"Tệp sao lưu chứa đường dẫn không an toàn: {name}")

                if "backup_manifest.json" not in zf.namelist():
                    raise ValueError("Tệp sao lưu không hợp lệ: thiếu backup_manifest.json")

                manifest_raw = zf.read("backup_manifest.json").decode("utf-8")
                manifest = json.loads(manifest_raw)
        except Exception as e:
            return {
                "valid": False,
                "error": f"Lỗi phân tích tệp sao lưu: {str(e)}"
            }

        project_id = manifest.get("projectId", "UNKNOWN")
        target_dir = PROJECTS_DIR / project_id
        collision = target_dir.exists()

        total_uncompressed = sum(f.get("size", 0) for f in manifest.get("files", []))

        return {
            "valid": True,
            "zipPath": str(zip_path),
            "projectId": project_id,
            "backupType": manifest.get("backupType", "light"),
            "backupTypeVi": "Sao lưu nhẹ" if manifest.get("backupType") == "light" else "Sao lưu đầy đủ",
            "createdAt": manifest.get("createdAt"),
            "fileCount": manifest.get("fileCount", len(manifest.get("files", []))),
            "uncompressedSizeBytes": total_uncompressed,
            "hasCollision": collision,
            "existingProject": collision,
            "files": manifest.get("files", [])[:30]  # sample
        }

    def restore_backup(
        self,
        zip_path: Path,
        target_project_id: Optional[str] = None,
        overwrite: bool = False,
        target_parent_dir: Optional[Path] = None
    ) -> Dict[str, Any]:
        """
        Restore a project backup with schema validation, collision detection, and rollback.
        """
        preview = self.preview_backup(zip_path)
        if not preview.get("valid"):
            raise ValueError(f"Không thể khôi phục bản sao lưu: {preview.get('error')}")

        manifest_proj_id = preview["projectId"]
        target_id = target_project_id or manifest_proj_id
        parent_dir = target_parent_dir or PROJECTS_DIR
        target_dir = parent_dir / target_id

        rollback_dir: Optional[Path] = None

        if target_dir.exists():
            if not overwrite:
                return {
                    "status": "COLLISION_DETECTED",
                    "projectId": target_id,
                    "messageVi": f"Dự án '{target_id}' đã tồn tại trên hệ thống. Cần xác nhận ghi đè hoặc chỉ định ID mới.",
                    "requiresConfirmation": True
                }
            # Create rollback snapshot before overwrite
            rollback_ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
            rollback_dir = TEMP_DIR / f"rollback_{target_id}_{rollback_ts}"
            shutil.copytree(target_dir, rollback_dir)
            logger.info(f"Created pre-restore rollback snapshot at {rollback_dir}")

        try:
            target_dir.mkdir(parents=True, exist_ok=True)
            with zipfile.ZipFile(zip_path, "r") as zf:
                manifest_raw = zf.read("backup_manifest.json").decode("utf-8")
                manifest = json.loads(manifest_raw)

                for item in manifest.get("files", []):
                    rel_p = item["path"]
                    zip_arcname = f"project/{rel_p}"
                    if zip_arcname in zf.namelist():
                        dest_path = target_dir / rel_p
                        dest_path.parent.mkdir(parents=True, exist_ok=True)
                        with open(dest_path, "wb") as f_out:
                            f_out.write(zf.read(zip_arcname))

                        # Verify SHA-256
                        if _file_sha256(dest_path) != item["sha256"]:
                            raise ValueError(f"Checksum mismatch on restored file: {rel_p}")

            # Run integrity check on restored project
            check_result = project_integrity_checker.run_check(target_dir)

            # Cleanup rollback on success
            if rollback_dir and rollback_dir.exists():
                shutil.rmtree(rollback_dir, ignore_errors=True)

            return {
                "status": "SUCCESS",
                "statusVi": "Khôi phục thành công",
                "projectId": target_id,
                "fileCount": preview["fileCount"],
                "integrityStatus": check_result["status"],
                "integrityStatusVi": check_result["statusVi"],
                "errorCount": check_result["errorCount"],
                "warningCount": check_result["warningCount"]
            }

        except Exception as e:
            # ROLLBACK!
            logger.error(f"Restore failed: {e}. Executing rollback...")
            if rollback_dir and rollback_dir.exists():
                if target_dir.exists():
                    shutil.rmtree(target_dir, ignore_errors=True)
                shutil.copytree(rollback_dir, target_dir)
                shutil.rmtree(rollback_dir, ignore_errors=True)
            raise RuntimeError(f"Khôi phục thất bại và đã phục hồi trạng thái cũ: {str(e)}")

    def preview_archive(self, project_dir: Path) -> Dict[str, Any]:
        """
        Preview what project archiving will keep vs purge.
        Keeps: script, metadata, visual bible, approved/locked assets, timeline, final.mp4, export metadata.
        Purges: render cache, draft renders, test/browser cache, rejected candidates, temp chunks.
        """
        files_to_keep: List[Dict[str, Any]] = []
        files_to_purge: List[Dict[str, Any]] = []
        reclaimable_bytes = 0

        # Scan project dir
        for root, dirs, files in os.walk(project_dir):
            rel_root = Path(root).relative_to(project_dir)
            root_parts = rel_root.parts

            is_purge_dir = any(p in ("render_cache", ".tmp") for p in root_parts)

            for f in files:
                fp = Path(root) / f
                rel_p = str(fp.relative_to(project_dir)).replace("\\", "/")
                size = fp.stat().st_size

                # Check if draft render
                is_draft = "renders" in root_parts and "draft" in f.lower()

                if is_purge_dir or is_draft:
                    files_to_purge.append({"path": rel_p, "size": size})
                    reclaimable_bytes += size
                else:
                    files_to_keep.append({"path": rel_p, "size": size})

        return {
            "projectId": project_dir.name,
            "keepCount": len(files_to_keep),
            "purgeCount": len(files_to_purge),
            "reclaimableBytes": reclaimable_bytes,
            "reclaimableMb": round(reclaimable_bytes / (1024 * 1024), 2),
            "purgeSample": files_to_purge[:20],
            "keepSample": files_to_keep[:20],
        }

    def execute_archive(self, project_dir: Path, confirmed: bool = False) -> Dict[str, Any]:
        """Execute project archiving by cleaning purgeable files and marking project archived."""
        if not confirmed:
            raise ValueError("Cần xác nhận trước khi lưu trữ dự án.")

        preview = self.preview_archive(project_dir)
        purged_count = 0
        freed_bytes = 0

        for item in preview["purgeSample"]:
            fp = project_dir / item["path"]
            if fp.exists():
                try:
                    fp.unlink()
                    purged_count += 1
                    freed_bytes += item["size"]
                except Exception as e:
                    logger.warning(f"Could not purge {fp}: {e}")

        # Remove render_cache dir if empty
        rc_dir = project_dir / "render_cache"
        if rc_dir.exists():
            shutil.rmtree(rc_dir, ignore_errors=True)

        # Mark project settings as archived
        settings_file = project_dir / "settings.json"
        if settings_file.exists():
            try:
                data = json.loads(settings_file.read_text(encoding="utf-8"))
                data["archivedAt"] = datetime.now(timezone.utc).isoformat()
                settings_file.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
            except Exception:
                pass

        # Post-archive integrity check
        check = project_integrity_checker.run_check(project_dir)

        return {
            "status": "SUCCESS",
            "projectId": project_dir.name,
            "purgedFilesCount": purged_count,
            "freedBytes": freed_bytes,
            "freedMb": round(freed_bytes / (1024 * 1024), 2),
            "integrityStatus": check["status"],
            "integrityStatusVi": check["statusVi"]
        }


backup_restore_service = BackupRestoreService()
