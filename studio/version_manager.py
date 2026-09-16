"""
UnfoldIQ Version Manager — Phase 2
Provides:
- Meaningful-event revision checkpoints for artifacts
- Strict exclusion of autosaves from revision history (zero revision spam)
- Deterministic snapshot restore preserving stable artifact IDs
- Append-only audit history of restore events
- Automatic downstream DAG re-evaluation and invalidation upon restore
"""

import logging
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


from studio.domain_models import ArtifactRevision
from studio.dependency_graph import (
    ArtifactDependencyGraph,
    compute_content_hash,
)
from studio.state_store import StateStore

logger = logging.getLogger("unfoldiq.version_manager")

VALID_EVENT_TYPES = {
    "GENERATE",
    "REGENERATE",
    "APPROVE",
    "REPLACE_ASSET",
    "RESTORE",
    "MANUAL",
}


class VersionManagerError(Exception):
    """Base exception for version management errors."""
    pass


class RevisionNotFoundError(VersionManagerError):
    """Raised when a requested revision ID does not exist."""
    pass


class InvalidRevisionEventError(VersionManagerError):
    """Raised when an invalid event type (e.g. AUTOSAVE) attempts to create a revision."""
    pass


class VersionManager:
    """Manages historical revisions and rollback/restore for artifacts."""

    def __init__(self, state_store: StateStore, graph: Optional[ArtifactDependencyGraph] = None):
        self.state_store = state_store
        self.graph = graph

    def create_revision(
        self,
        project_id: str,
        artifact_type: str,
        artifact_id: str,
        snapshot_data: Dict[str, Any],
        event_type: str = "MANUAL",
        message: Optional[str] = None,
        source_revision_id: Optional[str] = None,
        author: str = "solo",
    ) -> ArtifactRevision:
        """
        Creates and stores a historical ArtifactRevision.
        Strictly rejects 'AUTOSAVE' events to prevent revision spam.
        """
        event_upper = event_type.upper()
        if event_upper == "AUTOSAVE":
            raise InvalidRevisionEventError(
                "Autosave writes to working state and must not create a revision record."
            )

        if event_upper not in VALID_EVENT_TYPES:
            raise InvalidRevisionEventError(
                f"Invalid event_type '{event_type}'. Must be one of {VALID_EVENT_TYPES}."
            )

        now_utc = datetime.now(timezone.utc)
        created_at_str = now_utc.isoformat()
        content_hash = compute_content_hash(snapshot_data)

        # Stable unique revision ID
        ts_nano = time.time_ns()
        unique_suffix = uuid.uuid4().hex[:6]
        revision_id = f"rev_{ts_nano}_{unique_suffix}_{content_hash[:8]}"


        revision = ArtifactRevision(
            revision_id=revision_id,
            project_id=project_id,
            artifact_type=artifact_type,
            artifact_id=artifact_id,
            created_at=created_at_str,
            content_hash=content_hash,
            snapshot_data=snapshot_data,
            message=message or f"Event: {event_upper}",
            source_revision_id=source_revision_id,
            event_type=event_upper,
            author=author,
        )

        self.state_store.save_revision(revision)
        logger.info(
            f"Created revision {revision_id} for {artifact_type}:{artifact_id} (event={event_upper})"
        )
        return revision

    def get_revision(self, revision_id: str) -> ArtifactRevision:
        """Gets a single revision by ID."""
        rev = self.state_store.get_revision(revision_id)
        if not rev:
            raise RevisionNotFoundError(f"Revision '{revision_id}' not found.")
        return rev

    def list_history(
        self,
        artifact_type: Optional[str] = None,
        artifact_id: Optional[str] = None,
        limit: int = 50,
    ) -> List[ArtifactRevision]:
        """Lists historical revisions in reverse chronological order."""
        return self.state_store.list_revisions(
            artifact_type=artifact_type,
            artifact_id=artifact_id,
            limit=limit,
        )

    def restore_revision(
        self,
        revision_id: str,
        message: Optional[str] = None,
        override_lock: bool = False,
    ) -> Dict[str, Any]:
        """
        Restores working state from a historical revision snapshot.
        Guarantees:
        - Preserves stable artifact ID.
        - History is append-only (creates a new RESTORE revision).
        - Re-evaluates content hash and triggers DAG invalidation for downstream nodes.
        - Enforces lock policy: raises LockConflictError if target artifact is locked unless override_lock=True.
        - Preserves lock state of the target node across restore.
        """
        target_rev = self.get_revision(revision_id)

        # 1. Extract snapshot data
        snapshot = target_rev.snapshot_data
        artifact_type = target_rev.artifact_type
        artifact_id = target_rev.artifact_id
        project_id = target_rev.project_id

        # Lock check: if target artifact is locked and override_lock is False, raise LockConflictError
        from studio.locking import LockManager, LockConflictError
        lm = LockManager(self.state_store, graph=self.graph)
        is_currently_locked = lm.is_locked(artifact_id)
        if is_currently_locked and not override_lock:
            raise LockConflictError(
                f"Artifact '{artifact_id}' is locked. Cannot restore revision '{revision_id}' without explicit override."
            )

        # 2. Record new RESTORE revision representing this restore event
        restore_msg = message or f"Restored snapshot from revision {revision_id}"
        new_rev = self.create_revision(
            project_id=project_id,
            artifact_type=artifact_type,
            artifact_id=artifact_id,
            snapshot_data=snapshot,
            event_type="RESTORE",
            message=restore_msg,
            source_revision_id=revision_id,
        )

        # 3. Update DAG if graph is present
        invalidated_downstream: List[str] = []
        if self.graph and self.graph.has_node(artifact_id):
            new_hash = target_rev.content_hash
            changed, invalidated = self.graph.update_node_content(artifact_id, new_hash)
            # Preserve lock state on target node
            self.graph.set_locked(artifact_id, is_currently_locked)
            invalidated_downstream = sorted(list(invalidated))
            self.state_store.save_graph(self.graph)
        else:
            self.state_store.set_lock(artifact_id, is_currently_locked)

        logger.info(
            f"Successfully restored {artifact_type}:{artifact_id} from {revision_id}. "
            f"New revision={new_rev.revision_id}. Downstream invalidated={len(invalidated_downstream)}"
        )

        return {
            "status": "RESTORED",
            "artifact_type": artifact_type,
            "artifact_id": artifact_id,
            "source_revision_id": revision_id,
            "new_revision_id": new_rev.revision_id,
            "content_hash": target_rev.content_hash,
            "is_locked": is_currently_locked,
            "restored_data": snapshot,
            "invalidated_downstream": invalidated_downstream,
        }

