"""
Governance contract for Subphase 3D (replaces stale 3C-era assertion).

Retired: TestScopeGovernance.test_no_3d_export_workbench_implemented
  (tests/test_phase03c_gap_closure.py) — semantic "3D must not exist" became
  obsolete once 3D was implemented, and it passed vacuously because the real
  3D routes (/export/readiness, /renders/{kind}/file) never matched its
  "export-workbench"/"preflight" substrings (false-positive coverage).

New semantic: 3D EXISTS (capability presence) AND Phase 4/7/8/9 boundaries
remain protected (capability absence). Uses registered routes, importable
modules, and actual callables — not fragile substrings where avoidable.
"""
import importlib

import pytest
from starlette.testclient import TestClient

from studio.app import app

client = TestClient(app)
PROJ = "2026-09-12_210003_youtube-narration-01"


def _paths():
    r = client.get("http://testserver/openapi.json")
    assert r.status_code == 200
    return list(r.json().get("paths", {}).keys())


def _absent_modules(names):
    present = []
    for m in names:
        try:
            importlib.import_module(m)
            present.append(m)
        except ImportError:
            pass
    return present


# --- 4.1 3D capability exists ---------------------------------------------

class TestGovernance3DExists:
    def test_3d_export_readiness_route_exists(self):
        paths = _paths()
        assert any(p.endswith("/export/readiness") for p in paths), \
            "canonical GET export/readiness missing"
        r = client.get(f"/api/projects/{PROJ}/export/readiness")
        assert r.status_code == 200

    def test_3d_safe_preview_route_exists(self):
        paths = _paths()
        assert any("/renders/" in p and "/file" in p for p in paths), \
            "safe renders/{kind}/file route missing"

    def test_3d_export_workbench_frontend_exists(self):
        from pathlib import Path
        html = Path("studio/static/index.html").read_text(encoding="utf-8")
        js = Path("studio/static/phase14_ui.js").read_text(encoding="utf-8")
        assert 'id="ws-export"' in html
        assert "Kiểm tra trước khi xuất" in js and "/export/readiness" in js

    def test_3d_render_triggers_preserved(self):
        paths = _paths()
        assert any(p.endswith("/render/draft") for p in paths)
        assert any(p.endswith("/render/final") for p in paths)
        assert any(p.endswith("/render/status") for p in paths)


# --- 4.2 Phase boundaries -------------------------------------------------

class TestGovernancePhaseBoundaries:
    def test_phase4_implemented_in_scope(self):
        """Phase 4 shipped: canonical media routes exist; production renderer
        stays libx264 (no blind NVENC switch — §31)."""
        from pathlib import Path
        paths = _paths()
        for needle in ("/assets/registry", "/thumbnail", "/proxy",
                       "/assets/", "/derivatives", "/export/portable-package"):
            assert any(needle in p for p in paths), f"Phase 4 route missing: {needle}"
        src = Path("studio/renderer_adapter.py").read_text(encoding="utf-8")
        assert "h264_nvenc" not in src, "production renderer must stay libx264"
        assert _absent_modules(["studio.asset_registry"]) != [], \
            "studio.asset_registry must exist (Phase 4 shipped)"

    def test_phase7_not_started(self):
        """Phase 7 started (authorized): render-manifest preview exists.

        Retired semantic "Phase 7 must not exist" became obsolete once Phase 7
        implementation began (same precedent as the retired 3C-era assertion
        in this file's header). New semantic: Phase 7 preview EXISTS
        (capability presence) AND Phase 8/9 boundaries remain protected.
        """
        paths = _paths()
        assert any(p.endswith("/render-manifest") for p in paths), \
            "canonical GET render-manifest preview missing"
        assert _absent_modules(["studio.render_manifest"]) == ["studio.render_manifest"]
        r = client.get(f"/api/projects/{PROJ}/render-manifest")
        assert r.status_code == 200
        body = r.json()
        assert body["persisted"] is False
        assert "manifest" in body and "validation" in body

    def test_phase8_not_started(self):
        """No manifest-driven FFmpeg renderer / new NVENC architecture."""
        from studio.renderer_adapter import renderer_adapter, FFmpegRenderer
        assert isinstance(renderer_adapter, FFmpegRenderer)
        assert not hasattr(renderer_adapter, "render_from_manifest"), \
            "manifest-driven renderer entrypoint leaked into 3D scope"
        paths = _paths()
        assert [p for p in paths if "nvenc" in p] == []
        assert _absent_modules(["studio.nvenc_renderer"]) == []

    def test_phase9_not_started(self):
        """No automated render QA / ffprobe hard-gate framework."""
        paths = _paths()
        bad_routes = [p for p in paths
                      if "render-qa" in p or "qa/render" in p or "ffprobe" in p]
        assert bad_routes == [], f"Phase 9 routes leaked: {bad_routes}"
        assert _absent_modules(["studio.render_qa", "studio.ffprobe_qa"]) == []
