"""
Post-Final-Gate browser acceptance (pytest entry point).

Plan: 2026-19-post-final-gate-cleanup-ui-simplification-plan.md, Tasks 6 & 9.
Live browser automation itself is owned by tests/verify_post_final_cleanup.py
(RobustCDPClient + run_browser_verification) — this module does NOT duplicate
the CDP client. It adds:

1. Static acceptance-sequence contract: the harness must implement every step
   of the plan's modal state machine sequence.
2. A live gate that reuses the harness against the launcher-owned Studio
   (:7860). Skips (never fails) when Edge or the server is unavailable, so
   ordinary offline regression stays green; Task 9 runs it live.
"""

import importlib.util
import urllib.request
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
HARNESS_FILE = REPO / "tests" / "verify_post_final_cleanup.py"
EDGE_PATH = Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe")
APP = "http://127.0.0.1:7860"


def _harness_source() -> str:
    return HARNESS_FILE.read_text(encoding="utf-8")


def _load_harness():
    spec = importlib.util.spec_from_file_location(
        "verify_post_final_cleanup_harness", str(HARNESS_FILE)
    )
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


class TestBrowserAcceptanceSequence:
    @pytest.mark.parametrize("marker", [
        "btn-open-storage",          # 1. open Overview/System Maintenance
        "btn-preview-cleanup",       # 2. request preview
        "btn-execute-cleanup",       # 3/4. confirmation gated on preview -> open modal
        "modal-cleanup-confirm",     # 4. modal (not native confirm)
        "Escape",                    # 5. Escape closes without execute
        "btn-confirm-do-cleanup",    # 7. confirm
        "disabled",                  # 8. button disables immediately
        "cleanup-confirm-status",    # 9/11. loading + result banner
        "overview",                  # 12. storage overview refreshes
    ])
    def test_harness_implements_acceptance_step(self, marker):
        assert marker in _harness_source(), f"harness missing step marker: {marker}"

    def test_harness_targets_isolated_profile(self):
        src = _harness_source()
        assert "edge_cdp_profile_post_final" in src
        assert "localStorage.clear()" in src


class TestLiveBrowserCleanupAcceptance:
    def test_live_browser_cleanup_acceptance(self):
        if not EDGE_PATH.exists():
            pytest.skip("Edge not installed; live browser gate not runnable")
        try:
            with urllib.request.urlopen(APP + "/api/projects", timeout=5):
                pass
        except Exception:
            pytest.skip("Studio :7860 not running; start via launcher for Task 9")
        mod = _load_harness()
        assert mod.run_browser_verification() is True
