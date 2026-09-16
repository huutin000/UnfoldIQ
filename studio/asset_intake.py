"""
UnfoldIQ Asset Intake & Lineage Management — Phase 14
Principles:
- Complete provenance: Records project_id, scene_id, shot_id, manifest_id, variant_index, checksum, ffprobe metadata.
- Variant lifecycle: GENERATED -> SELECTED -> APPROVED -> LOCKED (or REJECTED).
- Lock protection: LOCKED assets cannot be replaced, overwritten, or auto-regenerated.
"""

import hashlib
import json
import logging
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, Optional, List

from studio.media_qc import media_qc

logger = logging.getLogger("unfoldiq.asset_intake")

class VariantLifecycleState:
    GENERATED = "GENERATED"
    SELECTED = "SELECTED"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    LOCKED = "LOCKED"

class AssetIntakeService:
    def __init__(self):
        pass

    def get_assets_dir(self, project_dir: Path) -> Path:
        adir = project_dir / "assets" / "imported"
        adir.mkdir(parents=True, exist_ok=True)
        return adir

    def get_intake_ledger_file(self, project_dir: Path) -> Path:
        return project_dir / "assets" / "intake_ledger.json"

    def _load_ledger(self, project_dir: Path) -> Dict[str, Any]:
        lfile = self.get_intake_ledger_file(project_dir)
        if lfile.exists():
            try:
                return json.loads(lfile.read_text(encoding="utf-8"))
            except Exception as e:
                logger.warning(f"Error reading intake ledger: {e}")
        return {"assets": []}

    def _save_ledger(self, project_dir: Path, data: Dict[str, Any]):
        lfile = self.get_intake_ledger_file(project_dir)
        lfile.parent.mkdir(parents=True, exist_ok=True)
        lfile.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")

    def intake_asset(
        self,
        project_dir: Path,
        source_file_path: Path,
        scene_id: str,
        shot_id: Optional[str] = None,
        manifest_id: Optional[str] = None,
        provider: str = "google_flow",
        select_immediately: bool = True
    ) -> Dict[str, Any]:
        """Intake an external media file into UnfoldIQ with full provenance tracking."""
        if not source_file_path.exists():
            raise FileNotFoundError(f"Source file not found: {source_file_path}")

        # P0 (§3): allowlist client/server thống nhất + MIME sniff, extension chỉ phụ.
        ext = source_file_path.suffix.lower() or ".mp4"
        if not media_qc.is_allowed_upload(source_file_path, fallback_ext=ext):
            sniffed = media_qc.sniff_mime_type(source_file_path, fallback_ext=ext)
            raise ValueError(
                f"Tệp không hợp lệ: định dạng '{ext}' không khớp nội dung thật ({sniffed}). "
                f"Chỉ nhận PNG/JPG/WebP/MP4/MOV/WebM."
            )

        # Compute file checksum
        hasher = hashlib.sha256()
        with open(source_file_path, "rb") as f:
            while chunk := f.read(65536):
                hasher.update(chunk)
        checksum = hasher.hexdigest()

        # Destination in project (ext đã validate ở trên)
        assets_dir = self.get_assets_dir(project_dir)
        dest_filename = f"{scene_id}_{checksum[:8]}{ext}"
        dest_path = assets_dir / dest_filename

        if not dest_path.exists() or dest_path.resolve() != source_file_path.resolve():
            shutil.copy2(source_file_path, dest_path)

        # Technical QC
        tech_qc = media_qc.inspect_media_file(dest_path)
        qc_passed = bool(tech_qc.get("passed"))

        # P0 (§3 FINAL-GAPS): QC FAIL không bao giờ auto-selected. Failing asset
        # vào REJECTED (lý do rõ ràng), không vào production timeline.
        if select_immediately and not qc_passed:
            select_immediately = False
        lifecycle = VariantLifecycleState.GENERATED
        if qc_passed and select_immediately:
            lifecycle = VariantLifecycleState.SELECTED
        elif not qc_passed:
            lifecycle = VariantLifecycleState.REJECTED

        now = datetime.now(timezone.utc).isoformat()
        ledger = self._load_ledger(project_dir)
        existing_assets = ledger.get("assets", [])

        variant_idx = sum(1 for a in existing_assets if a.get("scene_id") == scene_id) + 1
        asset_id = f"ASSET-{scene_id.upper()}-V{variant_idx}"

        # If select_immediately, mark other variants of this scene as unselected
        if select_immediately:
            for a in existing_assets:
                if a.get("scene_id") == scene_id and a.get("lifecycle") == VariantLifecycleState.SELECTED:
                    a["lifecycle"] = VariantLifecycleState.GENERATED

        is_image = ext in (".png", ".jpg", ".jpeg", ".webp")
        mime_type = media_qc.sniff_mime_type(dest_path, fallback_ext=ext)
        asset_type = "image" if is_image else "video"

        asset_entry = {
            "id": asset_id,
            "projectId": project_dir.name,
            "scene_id": scene_id,
            "shot_id": shot_id or f"{scene_id}_shot_a",
            "generation_manifest_id": manifest_id or f"GEN-{scene_id.upper()}-v1",
            "variant_index": variant_idx,
            "assetType": asset_type,
            "filePath": str(dest_path.relative_to(project_dir)).replace("\\", "/"),
            "absolutePath": str(dest_path),
            "checksum": checksum,
            "mimeType": mime_type,
            "provider": provider,
            "mode": "manual",
            "technicalMetadata": tech_qc,
            "qc": tech_qc,
            "qcPassed": qc_passed,
            "qcReason": None if qc_passed else (tech_qc.get("error") or "Không đạt kiểm tra kỹ thuật (ffprobe)."),
            "lifecycle": lifecycle,
            "locked": False,
            "createdAt": now,
            "importedAt": now
        }

        existing_assets.append(asset_entry)
        ledger["assets"] = existing_assets
        self._save_ledger(project_dir, ledger)
        return asset_entry

    def list_assets(self, project_dir: Path, scene_id: Optional[str] = None) -> List[Dict[str, Any]]:
        ledger = self._load_ledger(project_dir)
        assets = ledger.get("assets", [])
        if scene_id:
            assets = [a for a in assets if a.get("scene_id") == scene_id]
        return assets

    def get_selected_asset_for_scene(self, project_dir: Path, scene_id: str) -> Optional[Dict[str, Any]]:
        assets = self.list_assets(project_dir, scene_id=scene_id)
        # P0 (§3): REJECTED (QC fail) không bao giờ vào timeline, kể cả fallback.
        usable = [a for a in assets if a.get("lifecycle") != VariantLifecycleState.REJECTED
                  and a.get("qcPassed", True) is not False]
        # Prioritize LOCKED or SELECTED
        for state in (VariantLifecycleState.LOCKED, VariantLifecycleState.APPROVED, VariantLifecycleState.SELECTED):
            for a in usable:
                if a.get("lifecycle") == state:
                    return a
        return usable[0] if usable else None

    def update_asset_lifecycle(
        self,
        project_dir: Path,
        asset_id: str,
        new_state: str,
        force_unlock: bool = False
    ) -> Optional[Dict[str, Any]]:
        """Transition asset through variant lifecycle adhering to lock constraints."""
        ledger = self._load_ledger(project_dir)
        assets = ledger.get("assets", [])
        target = next((a for a in assets if a["id"] == asset_id), None)
        if not target:
            return None

        # Lock check: Cannot modify locked asset unless explicitly unlocked
        if target.get("locked") and not force_unlock and new_state != VariantLifecycleState.LOCKED:
            raise ValueError(f"Asset {asset_id} is LOCKED. Unlock explicitly before modifying.")

        if new_state == VariantLifecycleState.LOCKED:
            target["locked"] = True
            target["lifecycle"] = VariantLifecycleState.LOCKED
        elif new_state == "UNLOCKED":
            target["locked"] = False
            target["lifecycle"] = VariantLifecycleState.APPROVED
        elif new_state == VariantLifecycleState.SELECTED:
            # Unselect others in the same scene
            for a in assets:
                if a.get("scene_id") == target.get("scene_id") and a["id"] != asset_id:
                    if a.get("lifecycle") == VariantLifecycleState.SELECTED:
                        a["lifecycle"] = VariantLifecycleState.GENERATED
            target["lifecycle"] = VariantLifecycleState.SELECTED
        else:
            target["lifecycle"] = new_state

        target["updatedAt"] = datetime.now(timezone.utc).isoformat()
        self._save_ledger(project_dir, ledger)
        return target

asset_intake = AssetIntakeService()
