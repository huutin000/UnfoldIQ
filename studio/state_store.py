"""
UnfoldIQ Persistent State Store — Phase 2
Provides ACID-compliant, transactional SQLite persistence for:
- Dependency nodes and edges
- ArtifactRevision history snapshots
- Locking states
- Composite cache keys
- Blockers and review statuses

Database is scoped per project at `projects/<project_dir>/state.db`.
Uses standard library sqlite3 only — zero external dependencies.
Standard rollback journaling is used for clean Windows process safety.
"""

import json
import logging
import sqlite3
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Generator, List, Optional

from studio.domain_models import (
    ArtifactNode,
    ArtifactRevision,
    Blocker,
    CacheKeyRecord,
    ReviewStatus,
)
from studio.dependency_graph import ArtifactDependencyGraph

logger = logging.getLogger("unfoldiq.state_store")


class StateStore:
    """Project-scoped SQLite persistent state store."""

    def __init__(self, db_path: Path):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path), timeout=30.0)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON;")
        conn.execute("PRAGMA busy_timeout = 30000;")
        conn.execute("PRAGMA journal_mode = DELETE;")  # standard rollback journal
        return conn

    @contextmanager
    def transaction(self) -> Generator[sqlite3.Connection, None, None]:
        """Context manager providing an atomic transaction with automatic rollback and bounded retry on lock contention."""
        max_retries = 3
        retry_delay = 0.05
        for attempt in range(max_retries):
            conn = self._get_connection()
            try:
                yield conn
                conn.commit()
                conn.close()
                return
            except sqlite3.OperationalError as oe:
                conn.rollback()
                conn.close()
                err_msg = str(oe).lower()
                if ("locked" in err_msg or "busy" in err_msg) and attempt < max_retries - 1:
                    logger.warning(
                        f"SQLite busy/locked on {self.db_path}, retrying transaction ({attempt+1}/{max_retries})..."
                    )
                    time.sleep(retry_delay * (2 ** attempt))
                    continue
                logger.error(f"Transaction failed on {self.db_path} with operational error: {oe}")
                raise
            except Exception as e:
                conn.rollback()
                conn.close()
                logger.error(f"Transaction failed on {self.db_path}, rolled back: {e}")
                raise


    def _init_db(self) -> None:
        """Initializes database schema idempotently."""
        with self.transaction() as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS schema_info (
                    version INTEGER PRIMARY KEY,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS nodes (
                    artifact_id TEXT PRIMARY KEY,
                    artifact_type TEXT NOT NULL,
                    content_hash TEXT NOT NULL,
                    review_status TEXT NOT NULL,
                    is_outdated INTEGER NOT NULL DEFAULT 0,
                    is_locked INTEGER NOT NULL DEFAULT 0,
                    blockers_json TEXT NOT NULL DEFAULT '[]',
                    metadata_json TEXT NOT NULL DEFAULT '{}',
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS edges (
                    parent_id TEXT NOT NULL,
                    child_id TEXT NOT NULL,
                    PRIMARY KEY (parent_id, child_id),
                    FOREIGN KEY (parent_id) REFERENCES nodes(artifact_id) ON DELETE CASCADE,
                    FOREIGN KEY (child_id) REFERENCES nodes(artifact_id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS revisions (
                    revision_id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    artifact_type TEXT NOT NULL,
                    artifact_id TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    content_hash TEXT NOT NULL,
                    snapshot_json TEXT NOT NULL,
                    message TEXT,
                    source_revision_id TEXT,
                    event_type TEXT NOT NULL DEFAULT 'MANUAL',
                    author TEXT NOT NULL DEFAULT 'solo'
                );

                CREATE INDEX IF NOT EXISTS idx_rev_artifact 
                ON revisions(artifact_type, artifact_id, created_at);

                CREATE TABLE IF NOT EXISTS cache_keys (
                    cache_key TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    artifact_type TEXT NOT NULL,
                    artifact_id TEXT NOT NULL,
                    input_hash TEXT NOT NULL,
                    provider TEXT,
                    model TEXT,
                    settings_hash TEXT,
                    created_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_cache_artifact 
                ON cache_keys(artifact_type, artifact_id);
            """)

            # Ensure schema_info has initial entry
            cur = conn.execute("SELECT version FROM schema_info WHERE version = 1")
            if not cur.fetchone():
                now_str = datetime.now(timezone.utc).isoformat()
                conn.execute(
                    "INSERT INTO schema_info (version, updated_at) VALUES (1, ?)",
                    (now_str,)
                )

    # --------------------------------------------------------------------------
    # GRAPH PERSISTENCE
    # --------------------------------------------------------------------------

    def save_graph(self, graph: ArtifactDependencyGraph) -> None:
        """
        Atomically saves the complete DAG (nodes and edges).
        Uses a single transaction to guarantee consistency.
        """
        now_str = datetime.now(timezone.utc).isoformat()
        with self.transaction() as conn:
            # Delete old edges and nodes
            conn.execute("DELETE FROM edges")
            conn.execute("DELETE FROM nodes")

            # Insert nodes
            for node in graph.list_nodes():
                blockers_data = [b.model_dump() for b in node.blockers]
                conn.execute("""
                    INSERT INTO nodes (
                        artifact_id, artifact_type, content_hash, review_status,
                        is_outdated, is_locked, blockers_json, metadata_json, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    node.artifact_id,
                    node.artifact_type,
                    node.content_hash,
                    node.review_status,
                    1 if node.is_outdated else 0,
                    1 if node.is_locked else 0,
                    json.dumps(blockers_data, ensure_ascii=True),
                    json.dumps(node.metadata, ensure_ascii=True),
                    now_str,
                ))

            # Insert edges
            for node in graph.list_nodes():
                for child_id in graph.get_children(node.artifact_id):
                    conn.execute("""
                        INSERT INTO edges (parent_id, child_id) VALUES (?, ?)
                    """, (node.artifact_id, child_id))

        logger.info(f"Saved graph with {len(graph.list_nodes())} nodes to {self.db_path}")

    def load_graph(self, project_id: str = "") -> ArtifactDependencyGraph:
        """Loads DAG from the SQLite database."""
        graph = ArtifactDependencyGraph(project_id=project_id)
        with self.transaction() as conn:
            # Load nodes
            cur = conn.execute("SELECT * FROM nodes")
            for row in cur.fetchall():
                bl_raw = json.loads(row["blockers_json"])
                meta_raw = json.loads(row["metadata_json"])
                blockers = [Blocker(**b) for b in bl_raw]
                graph.add_node(
                    artifact_id=row["artifact_id"],
                    artifact_type=row["artifact_type"],
                    content_hash=row["content_hash"],
                    review_status=row["review_status"],
                    is_outdated=bool(row["is_outdated"]),
                    is_locked=bool(row["is_locked"]),
                    blockers=blockers,
                    metadata=meta_raw,
                )

            # Load edges
            cur = conn.execute("SELECT parent_id, child_id FROM edges")
            for row in cur.fetchall():
                try:
                    graph.add_dependency(row["parent_id"], row["child_id"])
                except Exception as e:
                    logger.warning(f"Error restoring edge {row['parent_id']} -> {row['child_id']}: {e}")

        return graph

    # --------------------------------------------------------------------------
    # REVISION PERSISTENCE
    # --------------------------------------------------------------------------

    def save_revision(self, revision: ArtifactRevision) -> None:
        """Saves a historical ArtifactRevision record atomically."""
        with self.transaction() as conn:
            conn.execute("""
                INSERT INTO revisions (
                    revision_id, project_id, artifact_type, artifact_id,
                    created_at, content_hash, snapshot_json, message,
                    source_revision_id, event_type, author
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                revision.revision_id,
                revision.project_id,
                revision.artifact_type,
                revision.artifact_id,
                revision.created_at,
                revision.content_hash,
                json.dumps(revision.snapshot_data, ensure_ascii=False),
                revision.message,
                revision.source_revision_id,
                revision.event_type,
                revision.author,
            ))
        logger.info(f"Saved revision {revision.revision_id} for {revision.artifact_id}")

    def list_revisions(
        self,
        artifact_type: Optional[str] = None,
        artifact_id: Optional[str] = None,
        limit: int = 50,
    ) -> List[ArtifactRevision]:
        """Lists revisions filtered by artifact_type/artifact_id, newest first."""
        revisions: List[ArtifactRevision] = []
        query = "SELECT * FROM revisions"
        params: List[Any] = []
        conditions: List[str] = []

        if artifact_type:
            conditions.append("artifact_type = ?")
            params.append(artifact_type)
        if artifact_id:
            conditions.append("artifact_id = ?")
            params.append(artifact_id)

        if conditions:
            query += " WHERE " + " AND ".join(conditions)

        query += " ORDER BY created_at DESC LIMIT ?"
        params.append(limit)

        with self.transaction() as conn:
            cur = conn.execute(query, params)
            for row in cur.fetchall():
                revisions.append(ArtifactRevision(
                    revision_id=row["revision_id"],
                    project_id=row["project_id"],
                    artifact_type=row["artifact_type"],
                    artifact_id=row["artifact_id"],
                    created_at=row["created_at"],
                    content_hash=row["content_hash"],
                    snapshot_data=json.loads(row["snapshot_json"]),
                    message=row["message"],
                    source_revision_id=row["source_revision_id"],
                    event_type=row["event_type"],
                    author=row["author"],
                ))
        return revisions

    def get_revision(self, revision_id: str) -> Optional[ArtifactRevision]:
        """Gets a single revision by its ID."""
        with self.transaction() as conn:
            cur = conn.execute("SELECT * FROM revisions WHERE revision_id = ?", (revision_id,))
            row = cur.fetchone()
            if not row:
                return None
            return ArtifactRevision(
                revision_id=row["revision_id"],
                project_id=row["project_id"],
                artifact_type=row["artifact_type"],
                artifact_id=row["artifact_id"],
                created_at=row["created_at"],
                content_hash=row["content_hash"],
                snapshot_data=json.loads(row["snapshot_json"]),
                message=row["message"],
                source_revision_id=row["source_revision_id"],
                event_type=row["event_type"],
                author=row["author"],
            )

    # --------------------------------------------------------------------------
    # LOCKING PERSISTENCE
    # --------------------------------------------------------------------------

    def set_lock(self, artifact_id: str, is_locked: bool) -> bool:
        """Sets is_locked flag on a node. Returns True if node was found and updated.
        Upserts a minimal node row when the artifact was never bootstrapped
        (e.g. hermetic fixture projects without state.db graph), so explicit
        locks are never silently dropped."""
        with self.transaction() as conn:
            cur = conn.execute(
                "UPDATE nodes SET is_locked = ? WHERE artifact_id = ?",
                (1 if is_locked else 0, artifact_id)
            )
            if cur.rowcount > 0:
                return True
            now = datetime.now(timezone.utc).isoformat()
            conn.execute(
                """INSERT OR IGNORE INTO nodes (
                    artifact_id, artifact_type, content_hash, review_status,
                    is_outdated, is_locked, blockers_json, metadata_json, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (artifact_id, "shot", "", "READY",
                 0, 1 if is_locked else 0, "[]", "{}", now)
            )
            return True

    def get_lock(self, artifact_id: str) -> bool:
        """Checks whether an artifact is locked."""
        with self.transaction() as conn:
            cur = conn.execute("SELECT is_locked FROM nodes WHERE artifact_id = ?", (artifact_id,))
            row = cur.fetchone()
            if row:
                return bool(row["is_locked"])
            return False

    # --------------------------------------------------------------------------
    # COMPOSITE CACHE KEY PERSISTENCE
    # --------------------------------------------------------------------------

    def save_cache_key(self, record: CacheKeyRecord) -> None:
        """Stores a composite cache key record."""
        with self.transaction() as conn:
            conn.execute("""
                INSERT OR REPLACE INTO cache_keys (
                    cache_key, project_id, artifact_type, artifact_id,
                    input_hash, provider, model, settings_hash, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                record.cache_key,
                record.project_id,
                record.artifact_type,
                record.artifact_id,
                record.input_hash,
                record.provider,
                record.model,
                record.settings_hash,
                record.created_at,
            ))

    def get_cache_key(self, cache_key: str) -> Optional[CacheKeyRecord]:
        """Retrieves a cache key record."""
        with self.transaction() as conn:
            cur = conn.execute("SELECT * FROM cache_keys WHERE cache_key = ?", (cache_key,))
            row = cur.fetchone()
            if not row:
                return None
            return CacheKeyRecord(
                cache_key=row["cache_key"],
                project_id=row["project_id"],
                artifact_type=row["artifact_type"],
                artifact_id=row["artifact_id"],
                input_hash=row["input_hash"],
                provider=row["provider"],
                model=row["model"],
                settings_hash=row["settings_hash"],
                created_at=row["created_at"],
            )
