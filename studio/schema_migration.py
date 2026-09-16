"""
UnfoldIQ Project Schema Migration Engine — Phase 15A (P1)
Safely handles forward schema migrations with automatic backup, validation, and rollback.

Flow:
1. Detect schema version
2. Pre-migration backup
3. Migrate (idempotent, preserves all unknown fields)
4. Validate post-migration schema
5. Commit and log migration (or rollback on failure)
"""

import json
import logging
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, Optional, List

from studio.config import TEMP_DIR

logger = logging.getLogger("unfoldiq.migration")

CURRENT_SCHEMA_VERSION = "15.0"


class SchemaMigrationService:
    def __init__(self):
        pass

    def detect_schema_version(self, project_dir: Path) -> str:
        """Detect current schema version of the project."""
        settings_file = project_dir / "settings.json"
        if settings_file.exists():
            try:
                data = json.loads(settings_file.read_text(encoding="utf-8"))
                ver = data.get("schemaVersion")
                if ver:
                    return str(ver)
            except Exception:
                pass

        manifest_file = project_dir / "manifest.json"
        if manifest_file.exists():
            try:
                data = json.loads(manifest_file.read_text(encoding="utf-8"))
                ver = data.get("schema_version") or data.get("schemaVersion")
                if ver:
                    return str(ver)
            except Exception:
                pass

        # Legacy Phase 14 baseline
        return "14.0"

    def migrate_project(
        self,
        project_dir: Path,
        target_version: str = CURRENT_SCHEMA_VERSION
    ) -> Dict[str, Any]:
        """
        Migrate project data from detected schema version to target_version.
        Performs full backup before mutating, rolls back on any error.
        """
        current_ver = self.detect_schema_version(project_dir)
        project_id = project_dir.name
        now = datetime.now(timezone.utc).isoformat()

        if current_ver == target_version:
            return {
                "status": "ALREADY_UP_TO_DATE",
                "projectId": project_id,
                "currentVersion": current_ver,
                "targetVersion": target_version,
                "messageVi": "Dự án đã ở phiên bản lược đồ mới nhất."
            }

        # Step 2: Create pre-migration backup
        ts_str = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        backup_dir = TEMP_DIR / f"migration_backup_{project_id}_{ts_str}"
        shutil.copytree(project_dir, backup_dir)
        logger.info(f"Created pre-migration backup at {backup_dir}")

        migration_log = []

        try:
            # Step 3: Apply migrations step-by-step
            if current_ver == "14.0" and target_version == "15.0":
                # Migrate 14.0 -> 15.0:
                # 1. Update settings.json schemaVersion without dropping unknown fields
                settings_file = project_dir / "settings.json"
                settings_data = {}
                if settings_file.exists():
                    try:
                        settings_data = json.loads(settings_file.read_text(encoding="utf-8"))
                    except Exception:
                        settings_data = {}
                settings_data["schemaVersion"] = "15.0"
                settings_data["migratedAt"] = now
                settings_file.write_text(json.dumps(settings_data, indent=2, ensure_ascii=False), encoding="utf-8")
                migration_log.append("Updated settings.json with schemaVersion=15.0")

                # 2. Ensure jobs directory exists
                jobs_dir = project_dir / "jobs"
                jobs_dir.mkdir(parents=True, exist_ok=True)
                migration_log.append("Created project jobs directory")

                # 3. Upgrade asset ledger entries if present
                ledger_file = project_dir / "assets" / "intake_ledger.json"
                if ledger_file.exists():
                    try:
                        ledger_data = json.loads(ledger_file.read_text(encoding="utf-8"))
                        for a in ledger_data.get("assets", []):
                            if "assetId" not in a and "id" in a:
                                a["assetId"] = a["id"]
                            if "isLocked" not in a:
                                a["isLocked"] = (a.get("lifecycle") == "LOCKED")
                            if "status" not in a:
                                a["status"] = "VALID"
                        ledger_file.write_text(json.dumps(ledger_data, indent=2, ensure_ascii=False), encoding="utf-8")
                        migration_log.append("Normalized asset ledger for Phase 15A")
                    except Exception as e:
                        logger.warning(f"Error normalizing intake ledger: {e}")

                # 4. Initialize lineage.json if absent
                lineage_file = project_dir / "lineage.json"
                if not lineage_file.exists():
                    lineage_file.write_text(
                        json.dumps({"artifacts": [], "schemaVersion": "15.0"}, indent=2),
                        encoding="utf-8"
                    )
                    migration_log.append("Initialized lineage.json")

            # Step 4: Validate migrated schema
            new_detected = self.detect_schema_version(project_dir)
            if new_detected != target_version:
                raise ValueError(f"Xác thực lược đồ thất bại: phiên bản sau di chuyển là {new_detected}, mong đợi {target_version}")

            # Verify settings file is valid json
            settings_check = json.loads((project_dir / "settings.json").read_text(encoding="utf-8"))
            if settings_check.get("schemaVersion") != target_version:
                raise ValueError("Xác thực settings.json thất bại sau khi nâng cấp lược đồ.")

            # Step 5: Commit & log
            log_file = project_dir / "migration.log"
            with open(log_file, "a", encoding="utf-8") as f:
                f.write(f"\n[{now}] MIGRATION SUCCESS: {current_ver} -> {target_version}\n")
                for entry in migration_log:
                    f.write(f"  - {entry}\n")

            # Cleanup backup on success
            shutil.rmtree(backup_dir, ignore_errors=True)

            return {
                "status": "SUCCESS",
                "statusVi": "Nâng cấp lược đồ thành công",
                "projectId": project_id,
                "fromVersion": current_ver,
                "toVersion": target_version,
                "appliedSteps": migration_log
            }

        except Exception as e:
            # Step 6: ROLLBACK!
            logger.error(f"Migration failed: {e}. Performing immediate rollback...")
            if project_dir.exists():
                shutil.rmtree(project_dir, ignore_errors=True)
            shutil.copytree(backup_dir, project_dir)
            shutil.rmtree(backup_dir, ignore_errors=True)
            raise RuntimeError(f"Nâng cấp lược đồ thất bại, đã khôi phục trạng thái ban đầu: {str(e)}")


schema_migration_service = SchemaMigrationService()
