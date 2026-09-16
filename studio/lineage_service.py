"""
UnfoldIQ Version & Provenance Lineage Service — Phase 15A (P1)
Tracks artifact derivations and parentage without relying on filename conventions.

Script lineage:
Script vN -> TTS vN -> Timestamp vN -> Scene Plan vN -> Timeline vN -> Render vN

Asset lineage:
Image v1 (REJECTED)
Image v2 (APPROVED -> LOCKED)
Motion v1 (basedOn Image v2)

Required Schema:
- artifactId
- projectId
- artifactType
- sourceVersion
- sourceHash
- parentArtifactId
- createdAt
- replacedBy
"""

import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, Optional, List

logger = logging.getLogger("unfoldiq.lineage")


class LineageService:
    def __init__(self):
        pass

    def get_lineage_path(self, project_dir: Path) -> Path:
        return project_dir / "lineage.json"

    def load_lineage(self, project_dir: Path) -> Dict[str, Any]:
        lpath = self.get_lineage_path(project_dir)
        if lpath.exists():
            try:
                with open(lpath, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                logger.warning(f"Error loading lineage from {lpath}: {e}")
        return {"artifacts": []}

    def save_lineage(self, project_dir: Path, data: Dict[str, Any]) -> None:
        lpath = self.get_lineage_path(project_dir)
        lpath.parent.mkdir(parents=True, exist_ok=True)
        temp_path = lpath.parent / f".tmp_{lpath.name}"
        with open(temp_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        temp_path.replace(lpath)

    def record_artifact(
        self,
        project_dir: Path,
        artifact_id: str,
        artifact_type: str,
        source_version: str,
        source_hash: str,
        parent_artifact_id: Optional[str] = None,
        status: str = "ACTIVE",
        metadata: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Record an artifact's creation and provenance."""
        now = datetime.now(timezone.utc).isoformat()
        lineage_data = self.load_lineage(project_dir)
        artifacts = lineage_data.get("artifacts", [])

        # Check existing
        existing = next((a for a in artifacts if a.get("artifactId") == artifact_id), None)
        if existing:
            existing.update({
                "sourceVersion": source_version,
                "sourceHash": source_hash,
                "parentArtifactId": parent_artifact_id,
                "status": status,
                "updatedAt": now,
                "metadata": metadata or existing.get("metadata", {})
            })
            record = existing
        else:
            record = {
                "artifactId": artifact_id,
                "projectId": project_dir.name,
                "artifactType": artifact_type.upper(),
                "sourceVersion": source_version,
                "sourceHash": source_hash,
                "parentArtifactId": parent_artifact_id,
                "createdAt": now,
                "replacedBy": None,
                "status": status,
                "metadata": metadata or {}
            }
            artifacts.append(record)

        lineage_data["artifacts"] = artifacts
        self.save_lineage(project_dir, lineage_data)
        return record

    def replace_artifact(
        self,
        project_dir: Path,
        old_artifact_id: str,
        new_artifact_id: str
    ) -> None:
        """Mark an artifact as superseded/replaced by a newer version."""
        lineage_data = self.load_lineage(project_dir)
        artifacts = lineage_data.get("artifacts", [])
        for a in artifacts:
            if a.get("artifactId") == old_artifact_id:
                a["replacedBy"] = new_artifact_id
                a["status"] = "SUPERSEDED"
                break
        self.save_lineage(project_dir, lineage_data)

    def get_provenance_chain(self, project_dir: Path, artifact_id: str) -> List[Dict[str, Any]]:
        """Walk up parentArtifactId links to trace an artifact back to its origin."""
        lineage_data = self.load_lineage(project_dir)
        artifacts = {a["artifactId"]: a for a in lineage_data.get("artifacts", [])}

        chain = []
        curr_id = artifact_id
        visited = set()

        while curr_id and curr_id in artifacts and curr_id not in visited:
            visited.add(curr_id)
            node = artifacts[curr_id]
            chain.append(node)
            curr_id = node.get("parentArtifactId")

        return chain


lineage_service = LineageService()
