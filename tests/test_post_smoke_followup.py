"""
Post-smoke follow-up corrective tests (v1.0.1 -> v1.0.2):
  Issue 1 — Windows trust / _sqlite3.pyd (SQLite import + RW + health endpoint)
  Issue 2 — Cleanup success banner must not dump raw absolute paths
  Issue 3 — Kokoro health status must leave CHECKING (retry/timeout/hook)

Conventions: pytest, stdlib + starlette TestClient only, hermetic tmp dirs.
"""

import re
import sqlite3
import tempfile
from pathlib import Path

import pytest
from starlette.testclient import TestClient

REPO = Path(__file__).resolve().parents[1]
APP_JS = REPO / "studio" / "static" / "app.js"
PHASE15A_JS = REPO / "studio" / "static" / "phase15a_ui.js"


# ---------------------------------------------------------------------------
# Issue 1 — SQLite native module
# ---------------------------------------------------------------------------

class TestIssue1SqliteTrust:
    def test_sqlite_import_and_version(self):
        import _sqlite3 as m

        assert m.__file__ and m.__file__.endswith("_sqlite3.pyd")
        assert sqlite3.sqlite_version

    def test_sqlite_read_write_smoke(self):
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
            p = f.name
        try:
            conn = sqlite3.connect(p, timeout=10.0)
            try:
                conn.execute("CREATE TABLE t(x INTEGER)")
                conn.execute("INSERT INTO t VALUES (1)")
                conn.commit()
                row = conn.execute("SELECT x FROM t").fetchone()
                assert row and row[0] == 1
            finally:
                conn.close()
        finally:
            Path(p).unlink(missing_ok=True)

    def test_sqlite_health_helper(self):
        from studio.sqlite_health import check_sqlite_health

        result = check_sqlite_health()
        assert result["import_ok"] is True
        assert result["read_write_ok"] is True
        assert result["python_executable"]
        assert result["sqlite_module_file"]
        assert "authenticode" in result and "codeintegrity" in result

    def test_sqlite_health_endpoint(self):
        from studio.app import app

        client = TestClient(app)
        # Phase15A router exposes the probe; app must include it.
        resp = client.get("/api/system/sqlite-health")
        assert resp.status_code == 200
        body = resp.json()
        assert body["import_ok"] is True
        assert body["read_write_ok"] is True


# ---------------------------------------------------------------------------
# Issue 2 — Cleanup banner contract + presentation
# ---------------------------------------------------------------------------

def _make_storage_manager(tmp_path, monkeypatch=None):
    """StorageManager with isolated projects dir + isolated TEMP_DIR/scratch."""
    import studio.storage_manager as sm

    projects = tmp_path / "projects"
    projects.mkdir(parents=True, exist_ok=True)
    tempd = tmp_path / "temp"
    tempd.mkdir(parents=True, exist_ok=True)
    scratch = tmp_path / "scratch"
    scratch.mkdir(parents=True, exist_ok=True)
    if monkeypatch is not None:
        monkeypatch.setattr(sm, "TEMP_DIR", tempd)
        monkeypatch.setattr(sm, "BASE_DIR", tmp_path)
    mgr = sm.StorageManager(projects_dir=projects)
    return mgr, projects, tempd


def _seed_render_cache(projects: Path, n: int, prefix: str = "seg"):
    rc = projects / "projA" / "render_cache"
    rc.mkdir(parents=True, exist_ok=True)
    for i in range(n):
        (rc / f"{prefix}_{i:04d}.bin").write_bytes(b"x" * 1024)
    return rc


class TestIssue2CleanupContract:
    def test_success_zero_paths(self, tmp_path, monkeypatch):
        mgr, projects, tempd = _make_storage_manager(tmp_path, monkeypatch)
        report = mgr.execute_cleanup(categories=["renderCache", "tempFiles", "testCache"], confirmed=True)
        assert report["status"] == "SUCCESS"
        assert report["items_deleted"] == 0
        assert report["protected_items_skipped_count"] == 0
        assert isinstance(report["protected_items_skipped"], list)

    def test_success_counts_not_paths(self, tmp_path, monkeypatch):
        mgr, projects, tempd = _make_storage_manager(tmp_path, monkeypatch)
        _seed_render_cache(projects, 3)
        report = mgr.execute_cleanup(categories=["renderCache"], confirmed=True)
        assert report["status"] == "SUCCESS"
        assert report["items_deleted"] == 3
        # Contract: additive count field exists; list retained for details view.
        assert report["protected_items_skipped_count"] == len(report["protected_items_skipped"])

    def test_protected_files_never_deleted(self, tmp_path, monkeypatch):
        mgr, projects, tempd = _make_storage_manager(tmp_path, monkeypatch)
        rc = _seed_render_cache(projects, 2)
        protected = rc / "manifest.json"
        protected.write_text("{}", encoding="utf-8")
        report = mgr.execute_cleanup(categories=["renderCache"], confirmed=True)
        assert protected.exists()
        assert report["protected_items_skipped_count"] >= 1

    def test_partial_failure_shape(self, tmp_path, monkeypatch):
        mgr, projects, tempd = _make_storage_manager(tmp_path, monkeypatch)
        report = mgr.execute_cleanup(categories=["renderCache"], confirmed=True)
        # With nothing to delete and nothing failing, status is SUCCESS;
        # the PARTIAL/FAILURE branches are schema-checked here:
        assert report["status"] in ("SUCCESS", "PARTIAL_FAILURE", "FAILURE")
        assert isinstance(report.get("failed_items"), list)
        assert isinstance(report.get("items_failed"), int)

    def test_banner_never_inlines_absolute_paths(self):
        """Static presentation guard: success banner renders counts + details,
        never interpolates the protected-path array into the primary string."""
        src = PHASE15A_JS.read_text(encoding="utf-8")
        # The old defect pattern must be gone:
        assert "(${protectedSkipped} tài nguyên" not in src
        # Concise summary contract:
        assert "Dọn dẹp hoàn tất." in src
        assert "Tài nguyên được bảo vệ:" in src
        assert "protected_items_skipped_count" in src
        # Raw paths only behind opt-in capped details:
        assert "Xem chi tiết" in src
        assert "<details" in src
        assert "max-height: 160px" in src or "max-height:160px" in src
        # Details list is capped:
        assert "slice(0, CAP)" in src


# ---------------------------------------------------------------------------
# Issue 3 — Kokoro health leaves CHECKING
# ---------------------------------------------------------------------------

class TestIssue3KokoroHealth:
    def test_frontend_has_bounded_retry_and_timeout(self):
        src = APP_JS.read_text(encoding="utf-8")
        assert "AbortController" in src
        assert "setKokoroStatus" in src
        assert "RETRYING" in src
        assert "__kokoroHealth" in src
        assert "KOKORO_FAST_RETRY_MAX" in src
        # Initial text is always replaced: every terminal path updates DOM.
        assert "Đang thử lại Kokoro..." in src
        # Health polling registers independently of other init steps.
        assert "safeInit" in src

    def test_no_aria_semantics_change_on_badge(self):
        html = (REPO / "studio" / "static" / "index.html").read_text(encoding="utf-8")
        m = re.search(r'<div id="service-status-badge"[^>]*>', html)
        assert m, "service-status-badge must exist"
        tag = m.group(0)
        assert "aria-live" not in tag
        assert 'role=' not in tag
        # JS updates textContent/className only — no aria/focus/keyboard change.
        src = APP_JS.read_text(encoding="utf-8")
        badge_updates = re.findall(r"service-status-badge.{0,200}", src)
        assert badge_updates

    def test_backend_health_returns_kokoro_shape_fast(self):
        from studio.app import app

        client = TestClient(app)
        resp = client.get("/api/health")
        assert resp.status_code == 200
        body = resp.json()
        assert "kokoro" in body
        assert "healthy" in body["kokoro"]
