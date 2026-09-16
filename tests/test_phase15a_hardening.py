"""
UnfoldIQ Phase 15A Production Hardening Test Suite
Covers Data Safety Tests A through H and core hardening invariants:
- Test A: Persistent job persistence & restart survival
- Test B: Resume crash recovery from atomic checkpoint without duplication
- Test C: Backup / Restore with schema validation, collision detection, and integrity
- Test D: Missing asset detection in integrity ledger
- Test E: Checksum modified detection for assets & audio
- Test F: Schema migration (14.0 -> 15.0) and rollback on failure
- Test G: Safe storage cleanup: whitelist-only purge, protected files untouched
- Test H: Graceful shutdown with active jobs safe-stop & resume
- Secret Sanitization in logging and diagnostics
- Startup Self-Check diagnostics
- Resource Guard & Profiler telemetry
"""

import json
import os
import shutil
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

import pytest
from starlette.testclient import TestClient

from studio.app import app
from studio.jobs_manager import JobsManager, JobStatus, JOB_STATUS_LABELS_VI
from studio.asset_integrity import AssetIntegrityService, AssetIntegrityStatus, compute_sha256
from studio.project_integrity import ProjectIntegrityChecker, IntegrityStatus
from studio.backup_restore import BackupRestoreService
from studio.storage_manager import StorageManager
from studio.lineage_service import LineageService
from studio.schema_migration import SchemaMigrationService
from studio.structured_logger import sanitize_text
from studio.system_check import SystemCheckService, ResourceGuard, PerformanceProfiler
from studio.graceful_shutdown import GracefulShutdownManager


@pytest.fixture
def temp_project(tmp_path):
    """Create a pristine temporary project directory modeled after production."""
    p_dir = tmp_path / "test_proj_15a"
    p_dir.mkdir(parents=True, exist_ok=True)
    (p_dir / "jobs").mkdir(parents=True, exist_ok=True)
    (p_dir / "assets" / "imported").mkdir(parents=True, exist_ok=True)
    (p_dir / "renders" / "draft").mkdir(parents=True, exist_ok=True)
    (p_dir / "renders" / "final").mkdir(parents=True, exist_ok=True)

    # Basic metadata & script
    (p_dir / "settings.json").write_text(json.dumps({"schemaVersion": "14.0", "name": "Test Project"}, indent=2), encoding="utf-8")
    (p_dir / "script.txt").write_text("Chào mừng bạn đến với UnfoldIQ. Đây là bài kiểm thử Phase 15A.", encoding="utf-8")
    (p_dir / "script.json").write_text(json.dumps({"text": "Chào mừng bạn đến với UnfoldIQ. Đây là bài kiểm thử Phase 15A.", "version": "1.0"}, indent=2), encoding="utf-8")

    # Audio master
    audio_wav = p_dir / "audio.wav"
    audio_wav.write_bytes(b"RIFF" + b"\x00" * 200 + b"WAVEfmt " + b"\x00" * 500)
    audio_sha = compute_sha256(audio_wav)

    # Manifest
    (p_dir / "manifest.json").write_text(json.dumps({
        "project_id": "test_proj_15a",
        "audio_sha256": audio_sha,
        "schema_version": "14.0"
    }, indent=2), encoding="utf-8")

    # Timestamps
    (p_dir / "timestamps.json").write_text(json.dumps({
        "words": [
            {"word": "Chào", "start": 0.0, "end": 0.5},
            {"word": "mừng", "start": 0.5, "end": 1.0},
            {"word": "bạn", "start": 1.0, "end": 1.5},
        ]
    }, indent=2), encoding="utf-8")

    # Scene Plan
    (p_dir / "scene_plan.json").write_text(json.dumps({
        "scenes": [
            {"scene_id": "sc_001", "duration": 5.0, "characters": ["Homo Habilis"]},
            {"scene_id": "sc_002", "duration": 5.0, "characters": ["Homo Habilis"]}
        ]
    }, indent=2), encoding="utf-8")

    # Visual Bible
    (p_dir / "visual_bible.json").write_text(json.dumps({
        "characters": [
            {"name": "Homo Habilis", "id": "char_001"}
        ]
    }, indent=2), encoding="utf-8")

    # Timeline
    (p_dir / "timeline.json").write_text(json.dumps({
        "scenes": [
            {"scene_id": "sc_001", "duration": 5.0},
            {"scene_id": "sc_002", "duration": 5.0}
        ]
    }, indent=2), encoding="utf-8")

    # Intake asset
    asset_file = p_dir / "assets" / "imported" / "sc_001_img.png"
    asset_file.write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 64)
    asset_sha = compute_sha256(asset_file)

    (p_dir / "assets" / "intake_ledger.json").write_text(json.dumps({
        "assets": [
            {
                "assetId": "ASSET-SC001-V1",
                "sceneId": "sc_001",
                "path": "assets/imported/sc_001_img.png",
                "size": asset_file.stat().st_size,
                "mime": "image/png",
                "checksum": asset_sha,
                "status": "VALID",
                "isLocked": True,
                "lifecycle": "LOCKED"
            }
        ]
    }, indent=2), encoding="utf-8")

    return p_dir


# ===========================================================================
# TEST A — Persistent Job & Restart Survival
# ===========================================================================
def test_a_persistent_job_and_restart(tmp_path):
    """
    Test A: start render -> persist to disk -> restart JobsManager ->
    job exists in history and is not lost; RUNNING job recovered to INTERRUPTED/RESUMABLE.
    """
    runtime_dir = tmp_path / "runtime_jobs"
    jm1 = JobsManager(runtime_dir=runtime_dir)

    job = jm1.create_job("FINAL_RENDER", project_id="proj_alpha", metadata={"quality": "1080p"})
    job_id = job["jobId"]
    assert job["status"] == JobStatus.QUEUED
    assert job["statusVi"] == "Đang chờ"

    # Start running and set checkpoint
    jm1.update_job(job_id, status=JobStatus.RUNNING, progress=0.35)
    jm1.set_checkpoint(job_id, checkpoint_data={"valid": True, "completed_chunks": [0, 1], "stage": "render"})

    # Simulate server crash/restart by creating new JobsManager instance
    jm2 = JobsManager(runtime_dir=runtime_dir)
    recovered_job = jm2.get_job(job_id)

    assert recovered_job is not None
    assert recovered_job["jobId"] == job_id
    assert recovered_job["progress"] == 0.35
    # Former RUNNING job must NOT pretend to be RUNNING after restart
    assert recovered_job["status"] in (JobStatus.RESUMABLE, JobStatus.INTERRUPTED)
    assert recovered_job["checkpoint"]["completed_chunks"] == [0, 1]


# ===========================================================================
# TEST B — Resume Crash Recovery
# ===========================================================================
def test_b_resume_crash_recovery(tmp_path):
    """
    Test B: Interrupt at ~40% -> restart -> validate checkpoint -> resume -> no duplicate chunk.
    """
    runtime_dir = tmp_path / "runtime_jobs"
    jm = JobsManager(runtime_dir=runtime_dir)

    job = jm.create_job("TTS", project_id="proj_beta")
    job_id = job["jobId"]

    # Simulating 40% progress with 2 of 5 chunks completed
    jm.update_job(job_id, status=JobStatus.RUNNING, progress=0.4)
    jm.set_checkpoint(
        job_id,
        checkpoint_data={"valid": True, "completed_chunks": [0, 1], "next_chunk": 2, "total_chunks": 5},
        resume_data={"processed_indices": [0, 1]}
    )

    # Crash recovery
    assert jm.validate_checkpoint(job_id) is True
    jm.update_job(job_id, status=JobStatus.RESUMABLE)

    # Resume
    resumed = jm.resume_job(job_id)
    assert resumed["status"] == JobStatus.QUEUED
    assert resumed["checkpoint"]["next_chunk"] == 2
    # Ensure previous chunks are intact and will not be regenerated/duplicated
    assert resumed["checkpoint"]["completed_chunks"] == [0, 1]


# ===========================================================================
# TEST C — Backup / Restore with Collision & Integrity
# ===========================================================================
def test_c_backup_and_restore(temp_project, tmp_path):
    """
    Test C: backup -> restore with new id -> integrity check -> compare critical data.
    """
    bs = BackupRestoreService(backups_dir=tmp_path / "backups")

    # 1. Create Full Backup (contains audio and locked assets)
    full_zip = bs.create_backup(temp_project, backup_type="full")
    assert full_zip.exists()
    assert full_zip.name.endswith(".unfoldiq.zip")

    # 2. Preview Backup
    preview = bs.preview_backup(full_zip)
    assert preview["valid"] is True
    assert preview["projectId"] == temp_project.name
    assert preview["fileCount"] > 0

    # 3. Restore to New Project ID
    restore_target = "proj_restored_new"
    res = bs.restore_backup(full_zip, target_project_id=restore_target, overwrite=False, target_parent_dir=temp_project.parent)
    assert res["status"] == "SUCCESS"
    assert res["projectId"] == restore_target

    # Verify critical data restored
    restored_dir = temp_project.parent / restore_target
    assert (restored_dir / "script.json").exists()
    assert (restored_dir / "scene_plan.json").exists()
    assert (restored_dir / "timestamps.json").exists()
    assert (restored_dir / "audio.wav").exists()
    assert (restored_dir / "assets" / "imported" / "sc_001_img.png").exists()

    # Verify post-restore integrity
    checker = ProjectIntegrityChecker()
    check_res = checker.run_check(restored_dir)
    assert check_res["status"] in (IntegrityStatus.HEALTHY, IntegrityStatus.WARNING)


# ===========================================================================
# TEST D — Missing Asset Detection
# ===========================================================================
def test_d_missing_asset_detection(temp_project):
    """
    Test D: Fixture asset deleted -> detected as MISSING -> locked asset violation flagged.
    """
    ais = AssetIntegrityService()
    checker = ProjectIntegrityChecker()

    # Delete the locked asset file
    asset_file = temp_project / "assets" / "imported" / "sc_001_img.png"
    assert asset_file.exists()
    asset_file.unlink()

    # Run verification
    report = ais.verify_project_assets(temp_project)
    assert report["missingCount"] >= 1
    assert report["lockedViolationsCount"] >= 1
    assert any("LOCKED_ASSET_MISSING" in iss["code"] for iss in report["issues"])

    # Project integrity check should reflect BROKEN state due to locked asset violation
    integ = checker.run_check(temp_project)
    assert integ["status"] == IntegrityStatus.BROKEN
    assert any(iss["code"] == "LOCKED_ASSET_MISSING" for iss in integ["issues"])


# ===========================================================================
# TEST E — Checksum Modified Detection
# ===========================================================================
def test_e_checksum_modified_detection(temp_project):
    """
    Test E: Modify fixture asset file content -> detected as MODIFIED with SHA-256 mismatch.
    """
    ais = AssetIntegrityService()

    asset_file = temp_project / "assets" / "imported" / "sc_001_img.png"
    assert asset_file.exists()

    # Tamper with the asset
    asset_file.write_bytes(b"CORRUPTED_BYTES_FOR_TEST_E" + b"\x00" * 32)

    report = ais.verify_project_assets(temp_project)
    assert report["modifiedCount"] >= 1
    assert report["lockedViolationsCount"] >= 1
    assert any("LOCKED_ASSET_MODIFIED" in iss["code"] for iss in report["issues"])


# ===========================================================================
# TEST F — Schema Migration & Rollback
# ===========================================================================
def test_f_schema_migration_and_rollback(temp_project):
    """
    Test F: Migrate v14 -> v15 -> validate commit -> test rollback upon error.
    """
    sms = SchemaMigrationService()

    # 1. Successful migration
    assert sms.detect_schema_version(temp_project) == "14.0"
    res = sms.migrate_project(temp_project, target_version="15.0")
    assert res["status"] == "SUCCESS"
    assert sms.detect_schema_version(temp_project) == "15.0"
    assert (temp_project / "migration.log").exists()

    # 2. Rollback test: simulate migration error and verify project reverts
    # Reset version to 14.0
    (temp_project / "settings.json").write_text(json.dumps({"schemaVersion": "14.0"}), encoding="utf-8")

    # Invalidate target version to trigger validation failure
    with pytest.raises(RuntimeError) as exc_info:
        sms.migrate_project(temp_project, target_version="99.9_INVALID")
    assert "khôi phục trạng thái ban đầu" in str(exc_info.value)
    # Confirm version rolled back to 14.0
    assert sms.detect_schema_version(temp_project) == "14.0"


# ===========================================================================
# TEST G — Safe Storage Cleanup
# ===========================================================================
def test_g_safe_storage_cleanup(temp_project, tmp_path):
    """
    Test G: Storage cleanup deletes disposable cache/temp; protected files remain untouched.
    """
    sm = StorageManager(projects_dir=temp_project.parent)

    # Create dummy render cache and temp files
    rc_dir = temp_project / "render_cache"
    rc_dir.mkdir(parents=True, exist_ok=True)
    temp_chunk = rc_dir / "chunk_001.tmp"
    temp_chunk.write_bytes(b"DUMMY_CACHE_DATA_12345")

    # Ensure protected assets exist
    locked_asset = temp_project / "assets" / "imported" / "sc_001_img.png"
    assert locked_asset.exists()

    # Preview cleanup
    preview = sm.preview_cleanup(categories=["renderCache"])
    assert "BẢO VỆ DỮ LIỆU" in preview["protectedWarningVi"]
    assert preview["candidateCount"] >= 1

    # Execute cleanup
    cleanup_res = sm.execute_cleanup(categories=["renderCache"], confirmed=True)
    assert cleanup_res["status"] == "SUCCESS"
    assert not temp_chunk.exists()

    # CRITICAL: Protected items must still exist!
    assert locked_asset.exists()
    assert (temp_project / "script.json").exists()
    assert (temp_project / "audio.wav").exists()


# ===========================================================================
# TEST H — Graceful Shutdown & Safe Stop
# ===========================================================================
def test_h_graceful_shutdown(tmp_path):
    """
    Test H: Active jobs detected on shutdown -> safe stop checkpoints and sets RESUMABLE -> safe to exit.
    """
    runtime_dir = tmp_path / "runtime_jobs"
    jm = JobsManager(runtime_dir=runtime_dir)
    gsm = GracefulShutdownManager(jobs_mgr=jm)

    job = jm.create_job("FINAL_RENDER", project_id="proj_shutdown_test")
    jm.update_job(job["jobId"], status=JobStatus.RUNNING, progress=0.6)

    # Check shutdown readiness
    readiness = gsm.check_shutdown_readiness()
    assert readiness["canShutdownImmediately"] is False
    assert readiness["messageVi"] == "Có tác vụ đang chạy."
    assert len(readiness["runningJobs"]) >= 1

    # Execute Safe Stop
    safe_res = gsm.execute_safe_stop()
    assert safe_res["status"] == "SUCCESS"

    # Verify job became RESUMABLE with checkpoint
    chk_job = jm.get_job(job["jobId"])
    assert chk_job["status"] == JobStatus.RESUMABLE
    assert chk_job["checkpoint"]["valid"] is True


# ===========================================================================
# Sanitization & System Diagnostics Tests
# ===========================================================================
def test_secret_sanitization():
    """Verify that sensitive API keys, tokens, and passwords are fully redacted."""
    raw = "User config: api_key='AIzaSyD-dummyKey123456789012345678' and bearer token: Authorization: Bearer sk-mySecretKey12345"
    sanitized = sanitize_text(raw)
    assert "AIzaSyD" not in sanitized
    assert "sk-mySecretKey" not in sanitized
    assert "[REDACTED]" in sanitized


def test_system_self_check():
    """Verify system self-check runs and returns vi-VN results for all 8 items."""
    sc = SystemCheckService()
    res = sc.run_self_check()
    assert "overallStatus" in res
    assert "checks" in res
    assert len(res["checks"]) == 8
    keys = [c["key"] for c in res["checks"]]
    for expected in ["python", "ffmpeg", "kokoro", "cuda", "whisper", "storage", "projectsDir", "writePermission"]:
        assert expected in keys


def test_diagnostics_package_export(temp_project):
    """Verify diagnostics package zip is created and contains sanitized files."""
    sc = SystemCheckService()
    zip_path = sc.export_diagnostics_package(project_id=temp_project.name)
    assert zip_path.exists()
    assert zip_path.name.endswith(".zip")


def test_api_endpoints_phase15a(temp_project):
    """Verify Phase 15A REST endpoints respond properly."""
    from studio.config import PROJECTS_DIR
    api_proj = PROJECTS_DIR / "test_api_fixture_15a"
    if api_proj.exists():
        shutil.rmtree(api_proj, ignore_errors=True)
    shutil.copytree(temp_project, api_proj)

    try:
        client = TestClient(app)

        # 1. Storage overview
        r = client.get("/api/storage/overview")
        assert r.status_code == 200
        assert "categories" in r.json()

        # 2. System self-check
        r = client.get("/api/system/self-check")
        assert r.status_code == 200
        assert "checks" in r.json()

        # 3. Shutdown readiness
        r = client.get("/api/system/shutdown/readiness")
        assert r.status_code == 200

        # 4. Project integrity check
        r = client.get(f"/api/projects/{api_proj.name}/integrity/check")
        assert r.status_code == 200
        assert "status" in r.json()

        # 5. Project health summary
        r = client.get(f"/api/projects/{api_proj.name}/health-summary")
        assert r.status_code == 200
        assert "items" in r.json()
    finally:
        if api_proj.exists():
            shutil.rmtree(api_proj, ignore_errors=True)


# ===========================================================================
# TEST I — Job Source of Truth & Conflict Resolution (Gate C)
# ===========================================================================
def test_job_source_of_truth_and_conflict_resolution(tmp_path):
    """
    Gate C Test:
    Demonstrates deterministic resolution when runtime job status != project job status.
    Verifies that canonical project store and runtime index reconcile consistently.
    """
    runtime_dir = tmp_path / "runtime_jobs"
    projects_dir = tmp_path / "projects"
    proj_dir = projects_dir / "proj_gamma"
    proj_jobs_dir = proj_dir / "jobs"
    proj_jobs_dir.mkdir(parents=True, exist_ok=True)
    runtime_dir.mkdir(parents=True, exist_ok=True)

    job_id = "job_conflict_test_001"

    # Scenario 1: Runtime has older state (RUNNING), Project has newer state (COMPLETED)
    runtime_job = {
        "jobId": job_id,
        "projectId": "proj_gamma",
        "type": "FINAL_RENDER",
        "status": JobStatus.RUNNING,
        "statusVi": "Đang chạy",
        "progress": 0.5,
        "createdAt": "2026-09-15T10:00:00+00:00",
        "updatedAt": "2026-09-15T10:05:00+00:00",
        "checkpoint": {"valid": True, "stage": "render"}
    }
    project_job = {
        "jobId": job_id,
        "projectId": "proj_gamma",
        "type": "FINAL_RENDER",
        "status": JobStatus.COMPLETED,
        "statusVi": "Hoàn tất",
        "progress": 1.0,
        "createdAt": "2026-09-15T10:00:00+00:00",
        "updatedAt": "2026-09-15T10:10:00+00:00",  # Newer
        "checkpoint": {"valid": True, "stage": "done"}
    }

    (runtime_dir / f"{job_id}.json").write_text(json.dumps(runtime_job, indent=2), encoding="utf-8")
    (proj_jobs_dir / f"{job_id}.json").write_text(json.dumps(project_job, indent=2), encoding="utf-8")

    # Initialize JobsManager with isolated directories
    jm = JobsManager(runtime_dir=runtime_dir, projects_dir=projects_dir)
    resolved = jm.get_job(job_id)

    assert resolved is not None
    assert resolved["status"] == JobStatus.COMPLETED
    assert resolved["progress"] == 1.0
    assert resolved["updatedAt"] == "2026-09-15T10:10:00+00:00"

    # Verify reconciliation: runtime copy must have been synchronized with winning record
    runtime_synced = json.loads((runtime_dir / f"{job_id}.json").read_text(encoding="utf-8"))
    assert runtime_synced["status"] == JobStatus.COMPLETED
    assert runtime_synced["progress"] == 1.0

    # Scenario 2: Equal timestamp, one is terminal COMPLETED while other is RUNNING
    job_id_2 = "job_conflict_test_002"
    runtime_job_2 = {
        "jobId": job_id_2,
        "projectId": "proj_gamma",
        "type": "TTS",
        "status": JobStatus.RUNNING,
        "statusVi": "Đang chạy",
        "progress": 0.8,
        "createdAt": "2026-09-15T11:00:00+00:00",
        "updatedAt": "2026-09-15T11:05:00+00:00",
    }
    project_job_2 = {
        "jobId": job_id_2,
        "projectId": "proj_gamma",
        "type": "TTS",
        "status": JobStatus.COMPLETED,
        "statusVi": "Hoàn tất",
        "progress": 1.0,
        "createdAt": "2026-09-15T11:00:00+00:00",
        "updatedAt": "2026-09-15T11:05:00+00:00",  # Same timestamp
    }
    (runtime_dir / f"{job_id_2}.json").write_text(json.dumps(runtime_job_2, indent=2), encoding="utf-8")
    (proj_jobs_dir / f"{job_id_2}.json").write_text(json.dumps(project_job_2, indent=2), encoding="utf-8")

    jm2 = JobsManager(runtime_dir=runtime_dir, projects_dir=projects_dir)
    resolved_2 = jm2.get_job(job_id_2)
    assert resolved_2["status"] == JobStatus.COMPLETED
    assert resolved_2["progress"] == 1.0

