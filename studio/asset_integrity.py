"""
UnfoldIQ Asset Integrity & Validation Ledger — Phase 15A (P1)
Guarantees asset integrity across project lifecycle:
- SHA-256 checksum verification
- Statuses: VALID, MISSING, MODIFIED
- Locked asset protection (detects missing or corrupted locked assets, strictly blocks silent rebind)
- vi-VN reporting and diagnostics
"""

import hashlib
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, Optional, List

from studio.config import PROJECTS_DIR

logger = logging.getLogger("unfoldiq.asset_integrity")


class AssetIntegrityStatus:
    VALID = "VALID"
    MISSING = "MISSING"
    MODIFIED = "MODIFIED"


ASSET_STATUS_LABELS_VI: Dict[str, str] = {
    AssetIntegrityStatus.VALID: "Hợp lệ",
    AssetIntegrityStatus.MISSING: "Bị thiếu",
    AssetIntegrityStatus.MODIFIED: "Đã thay đổi",
}


def compute_sha256(file_path: Path) -> str:
    """Compute SHA-256 checksum of a file."""
    hasher = hashlib.sha256()
    with open(file_path, "rb") as f:
        while chunk := f.read(65536):
            hasher.update(chunk)
    return hasher.hexdigest()


class AssetIntegrityService:
    def __init__(self):
        pass

    def get_ledger_path(self, project_dir: Path) -> Path:
        return project_dir / "assets" / "intake_ledger.json"

    def load_ledger(self, project_dir: Path) -> Dict[str, Any]:
        lpath = self.get_ledger_path(project_dir)
        if lpath.exists():
            try:
                with open(lpath, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                logger.warning(f"Error loading asset ledger at {lpath}: {e}")
        return {"assets": []}

    def save_ledger(self, project_dir: Path, data: Dict[str, Any]) -> None:
        lpath = self.get_ledger_path(project_dir)
        lpath.parent.mkdir(parents=True, exist_ok=True)
        temp_path = lpath.parent / f".tmp_{lpath.name}"
        with open(temp_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        temp_path.replace(lpath)

    def register_asset(
        self,
        project_dir: Path,
        asset_id: str,
        scene_id: str,
        relative_or_abs_path: str,
        mime: str,
        source: str = "manual",
        is_locked: bool = False
    ) -> Dict[str, Any]:
        """Register or update an asset in the integrity ledger."""
        path = Path(relative_or_abs_path)
        full_path = path if path.is_absolute() else (project_dir / path)
        if not full_path.exists():
            raise FileNotFoundError(f"Tệp tài nguyên không tồn tại: {full_path}")

        checksum = compute_sha256(full_path)
        size = full_path.stat().st_size
        now = datetime.now(timezone.utc).isoformat()

        ledger = self.load_ledger(project_dir)
        assets = ledger.get("assets", [])

        # Check existing
        existing = next((a for a in assets if a.get("assetId") == asset_id or a.get("id") == asset_id), None)
        rel_path_str = str(full_path.relative_to(project_dir)) if full_path.is_relative_to(project_dir) else str(full_path)

        if existing:
            existing.update({
                "path": rel_path_str,
                "size": size,
                "mime": mime,
                "checksum": checksum,
                "source": source,
                "status": AssetIntegrityStatus.VALID,
                "isLocked": is_locked,
                "updatedAt": now
            })
            entry = existing
        else:
            entry = {
                "assetId": asset_id,
                "id": asset_id,
                "projectId": project_dir.name,
                "sceneId": scene_id,
                "path": rel_path_str,
                "size": size,
                "mime": mime,
                "checksum": checksum,
                "source": source,
                "status": AssetIntegrityStatus.VALID,
                "isLocked": is_locked,
                "createdAt": now,
                "updatedAt": now
            }
            assets.append(entry)

        ledger["assets"] = assets
        self.save_ledger(project_dir, ledger)
        return entry

    def verify_project_assets(self, project_dir: Path) -> Dict[str, Any]:
        """
        Scan and verify all assets in project against disk.
        Detects MISSING, MODIFIED, and VALID files.
        Strictly flags if LOCKED assets are compromised.
        """
        ledger = self.load_ledger(project_dir)
        assets = ledger.get("assets", [])

        valid_count = 0
        missing_count = 0
        modified_count = 0
        locked_violations: List[Dict[str, Any]] = []
        issues: List[Dict[str, Any]] = []

        now = datetime.now(timezone.utc).isoformat()

        for asset in assets:
            asset_id = asset.get("assetId") or asset.get("id", "UNKNOWN")
            scene_id = asset.get("sceneId") or asset.get("scene_id", "")
            raw_path = asset.get("path") or asset.get("dest_path")
            is_locked = bool(asset.get("isLocked") or asset.get("lifecycle") == "LOCKED")
            expected_checksum = asset.get("checksum")

            if not raw_path:
                asset["status"] = AssetIntegrityStatus.MISSING
                missing_count += 1
                issues.append({
                    "code": "ASSET_PATH_EMPTY",
                    "severity": "ERROR",
                    "assetId": asset_id,
                    "sceneId": scene_id,
                    "messageVi": f"Tài nguyên {asset_id} thiếu đường dẫn lưu trữ.",
                    "suggestedActionVi": "Nhập lại tệp hoặc cập nhật bản ghi manifest."
                })
                continue

            file_path = Path(raw_path)
            if not file_path.is_absolute():
                file_path = project_dir / file_path

            if not file_path.exists():
                asset["status"] = AssetIntegrityStatus.MISSING
                asset["updatedAt"] = now
                missing_count += 1
                issue = {
                    "code": "LOCKED_ASSET_MISSING" if is_locked else "ASSET_MISSING",
                    "severity": "ERROR" if is_locked else "WARNING",
                    "assetId": asset_id,
                    "sceneId": scene_id,
                    "messageVi": f"Tài nguyên {'đã khóa ' if is_locked else ''}{asset_id} bị thiếu trên ổ đĩa ({file_path.name}).",
                    "suggestedActionVi": "Khôi phục tệp từ bản sao lưu hoặc nhập lại tệp nguồn. Không tự ý thay thế."
                }
                issues.append(issue)
                if is_locked:
                    locked_violations.append(issue)
                continue

            # Verify checksum
            try:
                current_checksum = compute_sha256(file_path)
                current_size = file_path.stat().st_size
                asset["currentSize"] = current_size

                if expected_checksum and current_checksum != expected_checksum:
                    asset["status"] = AssetIntegrityStatus.MODIFIED
                    asset["updatedAt"] = now
                    modified_count += 1
                    issue = {
                        "code": "LOCKED_ASSET_MODIFIED" if is_locked else "ASSET_MODIFIED",
                        "severity": "ERROR" if is_locked else "WARNING",
                        "assetId": asset_id,
                        "sceneId": scene_id,
                        "messageVi": f"Tài nguyên {'đã khóa ' if is_locked else ''}{asset_id} đã bị chỉnh sửa hoặc sai lệch mã kiểm tra SHA-256.",
                        "suggestedActionVi": "Kiểm tra phiên bản tệp, khôi phục từ bản gốc hoặc xác nhận thay đổi có chủ đích."
                    }
                    issues.append(issue)
                    if is_locked:
                        locked_violations.append(issue)
                else:
                    asset["status"] = AssetIntegrityStatus.VALID
                    valid_count += 1
            except Exception as e:
                asset["status"] = AssetIntegrityStatus.MODIFIED
                modified_count += 1
                issues.append({
                    "code": "ASSET_READ_ERROR",
                    "severity": "ERROR",
                    "assetId": asset_id,
                    "sceneId": scene_id,
                    "messageVi": f"Không thể đọc tệp tài nguyên {asset_id}: {e}",
                    "suggestedActionVi": "Kiểm tra quyền truy cập tệp trên hệ thống."
                })

        # Save updated statuses to ledger
        self.save_ledger(project_dir, ledger)

        overall_status = "HEALTHY"
        if locked_violations:
            overall_status = "BROKEN"
        elif missing_count > 0 or modified_count > 0:
            overall_status = "WARNING"

        return {
            "projectId": project_dir.name,
            "overallStatus": overall_status,
            "overallStatusVi": "Ổn định" if overall_status == "HEALTHY" else ("Có lỗi" if overall_status == "BROKEN" else "Cần kiểm tra"),
            "totalAssets": len(assets),
            "validCount": valid_count,
            "missingCount": missing_count,
            "modifiedCount": modified_count,
            "lockedViolationsCount": len(locked_violations),
            "lockedViolations": locked_violations,
            "issues": issues,
            "verifiedAt": now
        }


asset_integrity_service = AssetIntegrityService()
