"""
UnfoldIQ Phase 15A Production Hardening API Router
Exposes endpoints for:
- Storage Manager & Safe Cache Cleanup
- Project Backup, Restore & Archive
- Project Integrity Checker & Health Dashboard
- Startup Diagnostics & Secret-Sanitized Export
- Graceful Shutdown & Crash Recovery
- Asset Integrity Verification & Provenance Lineage
- Schema Migration with Rollback
"""

import logging
from pathlib import Path
from typing import Dict, Any, Optional, List

from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from studio.config import PROJECTS_DIR, TEMP_DIR
from studio.jobs_manager import jobs_manager, JobStatus
from studio.storage_manager import storage_manager
from studio.backup_restore import backup_restore_service
from studio.project_integrity import project_integrity_checker
from studio.system_check import system_check_service, resource_guard
from studio.graceful_shutdown import graceful_shutdown_manager
from studio.asset_integrity import asset_integrity_service
from studio.lineage_service import lineage_service
from studio.schema_migration import schema_migration_service

logger = logging.getLogger("unfoldiq.phase15a_router")

router = APIRouter(tags=["Phase 15A Production Hardening"])


def _get_project_dir(dir_name: str) -> Path:
    p = PROJECTS_DIR / dir_name
    if not p.is_dir():
        raise HTTPException(status_code=404, detail=f"Dự án không tồn tại: {dir_name}")
    return p


# ---------------------------------------------------------------------------
# 1. Storage Manager
# ---------------------------------------------------------------------------

@router.get("/api/storage/overview")
async def get_storage_overview():
    return storage_manager.get_storage_breakdown()


class StorageCleanupRequest(BaseModel):
    categories: Optional[List[str]] = None
    confirmed: bool = False


@router.post("/api/storage/cleanup/preview")
async def preview_storage_cleanup(req: StorageCleanupRequest):
    return storage_manager.preview_cleanup(categories=req.categories)


@router.post("/api/storage/cleanup/execute")
async def execute_storage_cleanup(req: StorageCleanupRequest):
    if not req.confirmed:
        raise HTTPException(status_code=400, detail="Cần xác nhận dọn dẹp trước khi thực hiện.")
    try:
        return storage_manager.execute_cleanup(categories=req.categories, confirmed=True)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# 2. Project Backup, Restore & Archive
# ---------------------------------------------------------------------------

class BackupCreateRequest(BaseModel):
    backup_type: str = "light"
    include_final_render: bool = False


@router.post("/api/projects/{dir_name}/backup")
async def create_backup(dir_name: str, req: BackupCreateRequest):
    p_dir = _get_project_dir(dir_name)
    try:
        zip_path = backup_restore_service.create_backup(
            project_dir=p_dir,
            backup_type=req.backup_type,
            include_final_render=req.include_final_render
        )
        return {
            "status": "SUCCESS",
            "messageVi": "Sao lưu dự án thành công",
            "backupFile": zip_path.name,
            "downloadUrl": f"/api/backup/download/{zip_path.name}"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi tạo bản sao lưu: {str(e)}")


@router.get("/api/backup/download/{file_name}")
async def download_backup_file(file_name: str):
    from studio.backup_restore import BACKUPS_DIR
    target = BACKUPS_DIR / file_name
    if not target.exists():
        raise HTTPException(status_code=404, detail="Không tìm thấy tệp sao lưu.")
    return FileResponse(
        path=str(target),
        filename=file_name,
        media_type="application/zip"
    )


@router.post("/api/backup/upload-preview")
async def upload_and_preview_backup(file: UploadFile = File(...)):
    if not file.filename.endswith(".zip"):
        raise HTTPException(status_code=400, detail="Chỉ chấp nhận tệp sao lưu định dạng .zip")
    temp_zip = TEMP_DIR / f"upload_{file.filename}"
    try:
        content = await file.read()
        temp_zip.write_bytes(content)
        preview = backup_restore_service.preview_backup(temp_zip)
        return preview
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


class RestoreExecuteRequest(BaseModel):
    backupFileName: str
    targetProjectId: Optional[str] = None
    overwrite: bool = False


@router.post("/api/backup/restore")
async def restore_backup(req: RestoreExecuteRequest):
    from studio.backup_restore import BACKUPS_DIR
    zip_path = BACKUPS_DIR / req.backupFileName
    if not zip_path.exists():
        zip_path = TEMP_DIR / req.backupFileName
    if not zip_path.exists():
        raise HTTPException(status_code=404, detail="Tệp sao lưu không tồn tại.")

    try:
        result = backup_restore_service.restore_backup(
            zip_path=zip_path,
            target_project_id=req.targetProjectId,
            overwrite=req.overwrite
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/api/projects/{dir_name}/archive/preview")
async def preview_archive(dir_name: str):
    p_dir = _get_project_dir(dir_name)
    return backup_restore_service.preview_archive(p_dir)


class ArchiveExecuteRequest(BaseModel):
    confirmed: bool = False


@router.post("/api/projects/{dir_name}/archive/execute")
async def execute_archive(dir_name: str, req: ArchiveExecuteRequest):
    p_dir = _get_project_dir(dir_name)
    if not req.confirmed:
        raise HTTPException(status_code=400, detail="Cần xác nhận lưu trữ trước khi thực hiện.")
    try:
        return backup_restore_service.execute_archive(p_dir, confirmed=True)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# 3. Project Integrity Checker & Health Dashboard
# ---------------------------------------------------------------------------

@router.get("/api/projects/{dir_name}/integrity/check")
async def check_project_integrity(dir_name: str):
    p_dir = _get_project_dir(dir_name)
    return project_integrity_checker.run_check(p_dir)


@router.get("/api/projects/{dir_name}/health-summary")
async def get_project_health_summary(dir_name: str):
    p_dir = _get_project_dir(dir_name)
    return project_integrity_checker.get_health_summary(p_dir)


# ---------------------------------------------------------------------------
# 4. System Diagnostics & Self-Check
# ---------------------------------------------------------------------------

@router.get("/api/system/self-check")
async def get_system_self_check():
    return system_check_service.run_self_check()


@router.get("/api/diagnostics/export")
async def export_diagnostics(projectId: Optional[str] = None):
    try:
        zip_path = system_check_service.export_diagnostics_package(project_id=projectId)
        return FileResponse(
            path=str(zip_path),
            filename=zip_path.name,
            media_type="application/zip"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi xuất gói chẩn đoán: {str(e)}")


# ---------------------------------------------------------------------------
# 5. Graceful Shutdown & Crash Recovery
# ---------------------------------------------------------------------------

@router.get("/api/system/shutdown/readiness")
async def check_shutdown_readiness():
    return graceful_shutdown_manager.check_shutdown_readiness()


@router.post("/api/system/shutdown/safe-stop")
async def execute_safe_stop():
    return graceful_shutdown_manager.execute_safe_stop()


# ---------------------------------------------------------------------------
# 6. Asset Integrity Verification & Provenance Lineage
# ---------------------------------------------------------------------------

@router.get("/api/projects/{dir_name}/assets/verify")
async def verify_project_assets(dir_name: str):
    p_dir = _get_project_dir(dir_name)
    return asset_integrity_service.verify_project_assets(p_dir)


@router.get("/api/projects/{dir_name}/lineage")
async def get_project_lineage(dir_name: str):
    p_dir = _get_project_dir(dir_name)
    return lineage_service.load_lineage(p_dir)


# ---------------------------------------------------------------------------
# 7. Schema Migration
# ---------------------------------------------------------------------------

@router.get("/api/projects/{dir_name}/schema/version")
async def get_schema_version(dir_name: str):
    p_dir = _get_project_dir(dir_name)
    version = schema_migration_service.detect_schema_version(p_dir)
    return {
        "projectId": dir_name,
        "schemaVersion": version,
        "currentSupportedVersion": "15.0"
    }


class MigrateRequest(BaseModel):
    targetVersion: str = "15.0"


@router.post("/api/projects/{dir_name}/schema/migrate")
async def migrate_project_schema(dir_name: str, req: MigrateRequest):
    p_dir = _get_project_dir(dir_name)
    try:
        return schema_migration_service.migrate_project(p_dir, target_version=req.targetVersion)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ---------------------------------------------------------------------------
# 8. Persistent Jobs (Pause, Resume, Prune)
# ---------------------------------------------------------------------------

@router.post("/api/activity/jobs/{job_id}/pause")
async def pause_activity_job(job_id: str):
    job = jobs_manager.pause_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Công việc không tồn tại")
    return job


@router.post("/api/activity/jobs/{job_id}/resume")
async def resume_activity_job(job_id: str):
    try:
        job = jobs_manager.resume_job(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Công việc không tồn tại")
        return job
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/api/activity/jobs/history")
async def prune_job_history(maxDays: int = 14, maxKeep: int = 100):
    return jobs_manager.cleanup_history(max_days=maxDays, max_keep=maxKeep)
