"""Phase 9 Task 9: QA API sandbox/security tests (TDD RED first)."""
import json
from pathlib import Path

import pytest
from starlette.testclient import TestClient

from studio.app import app

client = TestClient(app)


@pytest.fixture
def sec_fixture(tmp_path, monkeypatch):
    import shutil
    import studio.config as _cfg
    import studio.jobs_manager as _jm
    import studio.phase14_router as _r14
    root = tmp_path / "projects"
    root.mkdir()
    monkeypatch.setattr(_cfg, "PROJECTS_DIR", root)
    monkeypatch.setattr(_r14, "PROJECTS_DIR", root)
    _jm.jobs_manager.projects_dir = root
    if hasattr(_r14._render_service_singleton, "_instance"):
        delattr(_r14._render_service_singleton, "_instance")
    d = root / "projsec"
    (d / "exports" / "export_001" / "qa" / "qa_abc123").mkdir(parents=True)
    (d / "exports" / "export_001" / "qa" / "qa_abc123" / "report.json").write_text(
        json.dumps({"qaRunId": "qa_abc123", "verdict": "PASS",
                    "manifestHash": "m", "final": {"sha256Commit": "f"},
                    "qaPolicyVersion": "RENDER_QA_POLICY_V1",
                    "completedAt": "2026-09-18T00:00:00+00:00"}),
        encoding="utf-8")
    (d / "exports" / "export_002" / "qa").mkdir(parents=True)
    yield {"id": "projsec", "dir": d, "root": root}
    shutil.rmtree(root, ignore_errors=True)


def test_unknown_project_rejected(sec_fixture):
    r = client.get("/api/projects/nonexistent/exports/export_001/qa/latest")
    assert r.status_code == 404


def test_unknown_export_rejected(sec_fixture):
    r = client.get("/api/projects/projsec/exports/export_009/qa/latest")
    assert r.status_code == 404


def test_traversal_export_rejected(sec_fixture):
    for bad in ("..", "../app", "%2e%2e", "C:\\evil", "\\\\server\\x"):
        r = client.get(f"/api/projects/projsec/exports/{bad}/qa/latest")
        assert r.status_code in (400, 404, 422), bad


def test_qa_run_id_from_another_export_rejected(sec_fixture):
    r = client.get("/api/projects/projsec/exports/export_002/qa/runs/qa_abc123")
    assert r.status_code == 404


def test_qa_run_id_traversal_rejected(sec_fixture):
    r = client.get("/api/projects/projsec/exports/export_001/qa/runs/..%2F..%2Fapp")
    assert r.status_code in (400, 404, 422)
