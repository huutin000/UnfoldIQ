"""
Regression coverage for SQLite-safe project backup (Stage 2 corrective).

Covers: overlapping write transactions cannot produce a corrupt/inconsistent
state.db snapshot; archived snapshot passes integrity_check + foreign_key_check;
manifest hash matches archived bytes; sidecars are never archived; disposable
restore + canonical reopen preserve graph/revisions/locks/assets/settings.
All fixtures live under a temporary directory; canonical projects/ is asserted
untouched.
"""

import hashlib
import json
import shutil
import sqlite3
import tempfile
import threading
import time
import unittest
import zipfile
from pathlib import Path

from studio.backup_restore import BackupRestoreService
from studio.config import PROJECTS_DIR
from studio.dependency_graph import ArtifactDependencyGraph, compute_content_hash
from studio.state_store import StateStore


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


def _build_disposable_project(root: Path, name: str = "stage2_probe") -> Path:
    pdir = root / name
    (pdir / "assets").mkdir(parents=True)
    (pdir / "assets" / "shot_001.png").write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 64)
    png_hash = _sha256_file(pdir / "assets" / "shot_001.png")
    (pdir / "assets" / "intake_ledger.json").write_text(json.dumps({
        "schema_version": "1.0.0",
        "assets": [{
            "id": "ASSET-shot_001", "assetId": "ASSET-shot_001",
            "scene_id": "scene_001", "sceneId": "scene_001",
            "filePath": "assets/shot_001.png", "path": "assets/shot_001.png",
            "checksum": png_hash, "lifecycle": "APPROVED", "version": 1,
        }],
    }, indent=2), encoding="utf-8")
    (pdir / "settings.json").write_text(json.dumps({
        "name": name, "schemaVersion": "15.0", "voice": "vn_female_1",
        "speed": 1.0, "resolution": "1080p", "fps": 24,
    }, indent=2), encoding="utf-8")
    (pdir / "script.txt").write_text("probe narration", encoding="utf-8")

    store = StateStore(pdir / "state.db")
    g = ArtifactDependencyGraph(project_id=name)
    g.add_node("beat_001", "story_beat", compute_content_hash({"b": 1}))
    g.add_node("scene_001", "scene", compute_content_hash({"s": 1}))
    g.add_node("shot_001", "shot", compute_content_hash({"sh": 1}), is_locked=True)
    g.add_dependency("beat_001", "scene_001")
    g.add_dependency("scene_001", "shot_001")
    store.save_graph(g)
    del store, g
    return pdir


def _sqlite_health(db_path: Path):
    conn = sqlite3.connect(str(db_path), timeout=10.0)
    try:
        conn.execute("PRAGMA foreign_keys = ON;")
        integrity = conn.execute("PRAGMA integrity_check;").fetchone()[0]
        violations = conn.execute("PRAGMA foreign_key_check;").fetchall()
        nodes = sorted(r[0] for r in conn.execute("SELECT artifact_id FROM nodes"))
        edges = sorted(f"{r[0]}->{r[1]}" for r in conn.execute("SELECT parent_id, child_id FROM edges"))
        return integrity, len(violations), nodes, edges
    finally:
        conn.close()


class TestBackupSqliteConsistency(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="stage2_backup_test_")
        self.root = Path(self.tmp.name)
        self.projects_before = sorted(p.name for p in PROJECTS_DIR.iterdir())

    def tearDown(self):
        self.tmp.cleanup()
        self.assertEqual(sorted(p.name for p in PROJECTS_DIR.iterdir()), self.projects_before)

    def test_backup_during_open_write_tx_stays_consistent(self):
        src = _build_disposable_project(self.root)
        svc = BackupRestoreService(backups_dir=self.root / "bk")

        committed = {"done": False}

        def hold_write_tx():
            conn = sqlite3.connect(str(src / "state.db"), timeout=30.0, isolation_level="")
            try:
                conn.execute("BEGIN IMMEDIATE;")
                conn.execute(
                    "INSERT INTO nodes (artifact_id, artifact_type, content_hash, review_status,"
                    " is_outdated, is_locked, blockers_json, metadata_json, updated_at)"
                    " VALUES ('n_overlap', 'shot', 'h', 'READY', 0, 0, '[]', '{}', 't')")
                time.sleep(1.5)
                conn.execute("COMMIT;")
                committed["done"] = True
            finally:
                conn.close()

        writer = threading.Thread(target=hold_write_tx)
        writer.start()
        time.sleep(0.3)  # ensure the write tx (and hot journal) is open during backup
        try:
            zip_path = svc.create_backup(src, backup_type="full")
        finally:
            writer.join(timeout=30)
        self.assertTrue(committed["done"])
        self.assertTrue(zip_path.exists())

        with zipfile.ZipFile(zip_path) as zf:
            manifest = json.loads(zf.read("backup_manifest.json").decode("utf-8"))
            entry = next(e for e in manifest["files"] if e["path"] == "state.db")
            archived_bytes = zf.read("project/state.db")
            # Manifest hash must describe the bytes actually archived.
            self.assertEqual(hashlib.sha256(archived_bytes).hexdigest(), entry["sha256"])
            extract_dir = self.root / "extracted"
            zf.extract("project/state.db", extract_dir)

        integrity, violations, nodes, edges = _sqlite_health(extract_dir / "project" / "state.db")
        self.assertEqual(integrity, "ok")
        self.assertEqual(violations, 0)
        # Snapshot must be a consistent boundary: either pre- or post-commit,
        # with every edge endpoint present.
        self.assertIn(set(nodes), ({"beat_001", "scene_001", "shot_001"},
                                   {"beat_001", "scene_001", "shot_001", "n_overlap"}))
        endpoints = {e.split("->")[0] for e in edges} | {e.split("->")[1] for e in edges}
        self.assertTrue(endpoints.issubset(set(nodes)))

    def test_sqlite_sidecars_never_archived(self):
        src = _build_disposable_project(self.root)
        # Leave a real, valid WAL sidecar next to the database: switch to WAL,
        # commit a write, and close. The -wal file persists (no checkpoint),
        # exactly like a live database's sidecar.
        # Leave a real, valid WAL sidecar next to the database: switch to WAL,
        # commit a write, and keep one idle connection open so the -wal file
        # persists (clean last-close would checkpoint it away).
        holder = sqlite3.connect(str(src / "state.db"), timeout=10.0)
        try:
            holder.execute("PRAGMA journal_mode=WAL;")
            holder.execute(
                "INSERT INTO nodes (artifact_id, artifact_type, content_hash, review_status,"
                " is_outdated, is_locked, blockers_json, metadata_json, updated_at)"
                " VALUES ('n_wal', 'scene', 'h', 'READY', 0, 0, '[]', '{}', 't')")
            holder.commit()
            sidecars = [p.name for p in src.glob("state.db-*")]
            self.assertTrue(sidecars, "expected a WAL sidecar for this test")
            svc = BackupRestoreService(backups_dir=self.root / "bk")
            zip_path = svc.create_backup(src, backup_type="full")
        finally:
            holder.close()
        with zipfile.ZipFile(zip_path) as zf:
            names = zf.namelist()
            manifest_paths = [e["path"] for e in
                              json.loads(zf.read("backup_manifest.json").decode("utf-8"))["files"]]
        for sidecar in sidecars:
            self.assertNotIn(f"project/{sidecar}", names)
            self.assertNotIn(sidecar, manifest_paths)
        self.assertIn("project/state.db", names)
        # The archived snapshot is complete despite the live sidecar.
        with zipfile.ZipFile(zip_path) as zf:
            zf.extract("project/state.db", self.root / "wal_extract")
        integrity, violations, nodes, _ = _sqlite_health(self.root / "wal_extract" / "project" / "state.db")
        self.assertEqual(integrity, "ok")
        self.assertEqual(violations, 0)
        self.assertIn("n_wal", nodes)

    def test_restore_reopen_preserves_state(self):
        src = _build_disposable_project(self.root)
        svc = BackupRestoreService(backups_dir=self.root / "bk")
        zip_path = svc.create_backup(src, backup_type="full")

        restore_root = self.root / "restore_out"
        restore_root.mkdir()
        res = svc.restore_backup(zip_path, target_project_id="restored_probe",
                                 target_parent_dir=restore_root)
        self.assertEqual(res.get("status"), "SUCCESS")
        restored = restore_root / "restored_probe"

        store = StateStore(restored / "state.db")
        try:
            graph = store.load_graph(project_id="restored_probe")
            self.assertEqual(
                sorted(n.artifact_id for n in graph.list_nodes()),
                ["beat_001", "scene_001", "shot_001"])
            locked = graph.get_node("shot_001")
            self.assertIsNotNone(locked)
            self.assertTrue(locked.is_locked)
        finally:
            del store

        self.assertEqual(
            json.loads((restored / "settings.json").read_text(encoding="utf-8")),
            json.loads((src / "settings.json").read_text(encoding="utf-8")))
        self.assertEqual(
            _sha256_file(restored / "assets" / "shot_001.png"),
            _sha256_file(src / "assets" / "shot_001.png"))
        integrity, violations, _, _ = _sqlite_health(restored / "state.db")
        self.assertEqual(integrity, "ok")
        self.assertEqual(violations, 0)


if __name__ == "__main__":
    unittest.main()
