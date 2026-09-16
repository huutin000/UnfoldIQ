"""
UnfoldIQ Locking Enforcement Engine — Phase 2
Provides:
- Explicit is_locked flag management across StoryBeat, AudioChunk, SceneTiming, Shot, MediaAsset
- Overwrite protection against bulk regeneration, automated cascades, and background jobs
- Coexistence of LOCKED state and OUTDATED status (locked protects content, not staleness)
- Explicit unlock/override verification for manual user operations
"""

import logging
from typing import Any, Dict, List, Optional, Set, Tuple

from studio.dependency_graph import ArtifactDependencyGraph
from studio.state_store import StateStore

logger = logging.getLogger("unfoldiq.locking")

LOCKABLE_ARTIFACT_TYPES = {
    "story_beat",
    "audio_chunk",
    "scene_timing",
    "shot",
    "media_asset",
    "visual_bible",
}


class LockConflictError(Exception):
    """Raised when an automated or bulk operation attempts to overwrite a locked artifact."""
    pass


class LockManager:
    """Manages artifact lock states and guards against unauthorized automated overwrite."""

    def __init__(self, state_store: StateStore, graph: Optional[ArtifactDependencyGraph] = None):
        self.state_store = state_store
        self.graph = graph

    def is_locked(self, artifact_id: str) -> bool:
        """Checks if an artifact is locked in memory or database."""
        if self.graph and self.graph.has_node(artifact_id):
            node = self.graph.get_node(artifact_id)
            if node:
                return node.is_locked
        return self.state_store.get_lock(artifact_id)

    def set_lock(
        self,
        artifact_id: str,
        locked: bool,
        artifact_type: Optional[str] = None,
    ) -> bool:
        """
        Locks or unlocks an artifact.
        Updates both the in-memory graph and the persistent state store.
        """
        if artifact_type and artifact_type not in LOCKABLE_ARTIFACT_TYPES:
            logger.warning(
                f"Setting lock on non-standard lockable artifact_type '{artifact_type}'"
            )

        if self.graph and self.graph.has_node(artifact_id):
            self.graph.set_locked(artifact_id, locked)
            self.state_store.save_graph(self.graph)
        else:
            self.state_store.set_lock(artifact_id, locked)

        logger.info(f"Artifact {artifact_id} lock state set to: {locked}")
        return locked

    def filter_unlocked_for_bulk(self, artifact_ids: List[str]) -> Tuple[List[str], List[str]]:
        """
        Partitions an input list of artifact IDs into:
        (unlocked_ids_to_process, locked_ids_skipped).
        Guarantees that bulk operations safely skip locked items.
        """
        unlocked: List[str] = []
        skipped_locked: List[str] = []

        for aid in artifact_ids:
            if self.is_locked(aid):
                skipped_locked.append(aid)
            else:
                unlocked.append(aid)

        if skipped_locked:
            logger.info(
                f"Bulk operation skipped {len(skipped_locked)} locked artifacts: {skipped_locked}"
            )

        return unlocked, skipped_locked

    def verify_can_modify(
        self,
        artifact_id: str,
        is_automated: bool = True,
        override_lock: bool = False,
    ) -> None:
        """
        Enforces lock policy:
        - If automated: raises LockConflictError if locked.
        - If manual: raises LockConflictError if locked unless override_lock is True.
        """
        if self.is_locked(artifact_id):
            if is_automated:
                raise LockConflictError(
                    f"Artifact '{artifact_id}' is locked. Automated/bulk overwrite is forbidden."
                )
            elif not override_lock:
                raise LockConflictError(
                    f"Artifact '{artifact_id}' is locked. Manual modification requires explicit unlock or override."
                )
