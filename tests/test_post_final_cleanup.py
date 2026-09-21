"""
Post-Final-Gate Cleanup & UI Simplification focused contract tests.

Plan: 2026-09-19-post-final-gate-cleanup-ui-simplification-plan.md
Covers Tasks 2-7. Tokens below are the ACTUAL identifiers found by the
Task 1 audit (no invented function names).

Conventions: pytest, stdlib only for static/source-contract tests.
"""

import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
STATIC = REPO / "studio" / "static"


def _read(name: str) -> str:
    return (STATIC / name).read_text(encoding="utf-8")


def _all_js() -> str:
    return "\n".join(
        p.read_text(encoding="utf-8", errors="ignore") for p in sorted(STATIC.glob("*.js"))
    )


def _all_css() -> str:
    return "\n".join(
        p.read_text(encoding="utf-8", errors="ignore") for p in sorted(STATIC.glob("*.css"))
    )


# ---------------------------------------------------------------------------
# Task 2 — Guided Help / Onboarding removal
# ---------------------------------------------------------------------------

class TestGuidedHelpRemoval:
    def test_guided_help_feature_removed(self):
        html = _read("index.html")
        for token in (
            "guide.js",
            "btn-open-tour",
            "onboarding-tour-overlay",
            "contextual-help-modal",
            "modal-help-center",
            "btn-module-help",
            "? H\u01b0\u1edbng d\u1eabn",
        ):
            assert token not in html, f"help remnant in index.html: {token}"

    def test_no_onboarding_autostart_source(self):
        src = _all_js()
        for token in (
            "startOnboarding(",
            "startProductTour(",
            "showWelcomeTour(",
            "startTour(",
            "renderTourStep",
            "window.closeTour",
            "closeTour()",
            # The exact obsolete key may appear ONLY in the startup purge
            # (removeItem); any setItem/write recreates onboarding state.
            "unfoldiq_tour_completed\", \"true",
            "localStorage.setItem(\"unfoldiq_tour_completed",
            "sessionStorage.setItem(\"unfoldiq_tour_completed",
            "UQGuide",
            "uq_guide_",
            "uq_tour_",
        ):
            assert token not in src, f"onboarding remnant in JS: {token}"

    def test_no_tour_css(self):
        css = _all_css()
        for sel in (
            ".tour-overlay",
            ".tour-spotlight",
            ".tour-card",
            ".tour-header",
            ".tour-step-badge",
            ".tour-close-btn",
            ".tour-title",
            ".tour-body",
            ".tour-footer",
            ".btn-help-guide",
            "--uq-z-tour",
            ".uq-welcome-overlay",
            ".uq-welcome-card",
            ".uq-welcome-title",
            ".uq-welcome-body",
            ".uq-welcome-actions",
            ".uq-help-menu",
            ".uq-tip",
            ".help-modal-card",
            ".help-section",
            ".btn-module-help",
        ):
            assert sel not in css, f"tour CSS remnant: {sel}"

    def test_obsolete_onboarding_keys_purged_at_startup(self):
        src = _read("app.js")
        # Exact historical key is named only to be removed, never written.
        assert "unfoldiq_tour_completed" in src
        assert "removeItem" in src

    def test_no_dead_guide_attrs(self):
        html = _read("index.html")
        assert "data-guide-id" not in html
        assert "data-guide-tip" not in html

    def test_ordinary_control_tooltips_preserved(self):
        html = _read("index.html")
        # Real-control tooltips are independent of the tour engine and stay.
        assert 'title="Xem h\u01b0\u1edbng d\u1eabn Google Flow"' in html
        assert 'aria-label="C\u00e0i \u0111\u1eb7t gi\u1ecdng \u0111\u1ecdc n\u00e2ng cao"' in html
        assert _read("app.js").strip() != ""


# ---------------------------------------------------------------------------
# Task 4 — StorageManager classification + preview fingerprint
# ---------------------------------------------------------------------------

import os

import pytest

import studio.storage_manager as sm_mod


@pytest.fixture
def isolated_workspace(tmp_path, monkeypatch):
    projects = tmp_path / "projects"
    projects.mkdir(parents=True, exist_ok=True)
    tempd = tmp_path / "temp"
    tempd.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(sm_mod, "BASE_DIR", tmp_path)
    monkeypatch.setattr(sm_mod, "TEMP_DIR", tempd)
    mgr = sm_mod.StorageManager(projects_dir=projects)
    return mgr, projects, tempd


def _seed_render_file(projects: Path, name: str = "seg_0001.bin", size: int = 16) -> Path:
    rc = projects / "projA" / "render_cache"
    rc.mkdir(parents=True, exist_ok=True)
    fp = rc / name
    fp.write_bytes(b"x" * size)
    return fp


class TestPreviewClassification:
    def test_preview_never_marks_protected_roots_safe(self):
        from studio.storage_manager import CLASS_PROTECTED, classify_cleanup_path

        for root in (".git", "studio", "scripts", "tests", "config",
                     "models", "upstream", "transcription", "docs"):
            cls, _ = classify_cleanup_path(f"{root}/some/nested/file.txt")
            assert cls == CLASS_PROTECTED, root
            cls_bare, _ = classify_cleanup_path(root)
            assert cls_bare == CLASS_PROTECTED, root

    def test_unknown_temp_child_is_needs_review_not_safe(self, isolated_workspace):
        mgr, _, tempd = isolated_workspace
        mystery = tempd / "mystery_widget_zzz"
        mystery.mkdir(parents=True, exist_ok=True)
        (mystery / "dat.bin").write_bytes(b"?")
        preview = mgr.build_cleanup_preview(scope="routine")
        assert not any("mystery_widget_zzz" in i["path"] for i in preview["items"])
        assert any("mystery_widget_zzz" in i["path"] for i in preview["needs_review"])

    def test_user_exports_need_review(self, isolated_workspace):
        mgr, _, tempd = isolated_workspace
        (tempd / "unfoldiq_diagnostics_20260920_000000.zip").write_bytes(b"PK")
        preview = mgr.build_cleanup_preview(scope="routine")
        assert not any("unfoldiq_diagnostics_" in i["path"] for i in preview["items"])
        assert any("unfoldiq_diagnostics_" in i["path"] for i in preview["needs_review"])

    def test_known_cdp_profile_is_safe(self, isolated_workspace):
        mgr, _, tempd = isolated_workspace
        prof = tempd / "headed_profile_p5test"
        prof.mkdir(parents=True, exist_ok=True)
        (prof / "cache.dat").write_bytes(b"z" * 32)
        preview = mgr.build_cleanup_preview(scope="routine")
        assert any("headed_profile_p5test" in i["path"] for i in preview["items"])

    def test_preview_id_changes_when_candidate_metadata_changes(self, isolated_workspace):
        mgr, projects, _ = isolated_workspace
        fp = _seed_render_file(projects)
        id1 = mgr.build_cleanup_preview(scope="routine")["preview_id"]
        fp.write_bytes(b"x" * 64)
        os.utime(fp, ns=(fp.stat().st_mtime_ns + 5_000_000, fp.stat().st_mtime_ns + 5_000_000))
        id2 = mgr.build_cleanup_preview(scope="routine")["preview_id"]
        assert id1 != id2
        (fp.parent / "seg_0002.bin").write_bytes(b"y")
        id3 = mgr.build_cleanup_preview(scope="routine")["preview_id"]
        assert id3 not in (id1, id2)

    def test_preview_response_shape(self, isolated_workspace):
        mgr, projects, _ = isolated_workspace
        _seed_render_file(projects)
        preview = mgr.build_cleanup_preview(scope="routine")
        assert preview["scope"] == "routine"
        assert preview["status"] == "READY"
        assert re.fullmatch(r"[0-9a-f]{64}", preview["preview_id"])
        assert isinstance(preview["bytes_reclaimable"], int)
        assert isinstance(preview["items"], list)
        assert isinstance(preview["protected_items"], list)
        assert isinstance(preview["needs_review"], list)

    def test_archive_newest_three_preserved(self, isolated_workspace):
        mgr, projects, _ = isolated_workspace
        for i in range(5):
            (projects / "projA").mkdir(parents=True, exist_ok=True)
            (projects / "projA" / f"veo_prompts_archive_{i:03d}.json").write_text("{}", encoding="utf-8")
        preview = mgr.build_cleanup_preview(scope="routine")
        offered = [i["path"] for i in preview["items"]]
        assert any("veo_prompts_archive_000.json" in p for p in offered)
        assert any("veo_prompts_archive_001.json" in p for p in offered)
        for kept in ("veo_prompts_archive_002.json", "veo_prompts_archive_003.json",
                     "veo_prompts_archive_004.json"):
            assert not any(kept in p for p in offered), kept


# ---------------------------------------------------------------------------
# Task 5 — Confirmed execution: stale preview + partial failure + idempotency
# ---------------------------------------------------------------------------

class TestCleanupExecuteSafety:
    def test_execute_rejects_stale_preview_without_deleting(self, isolated_workspace):
        mgr, projects, _ = isolated_workspace
        candidate = _seed_render_file(projects)
        preview = mgr.build_cleanup_preview(scope="routine")
        candidate.write_bytes(b"changed-after-preview")
        result = mgr.execute_cleanup_with_preview(
            preview_id=preview["preview_id"], scope="routine", confirmed=True
        )
        assert result["status"] == "FAILURE"
        assert result.get("reason") == "STALE_PREVIEW"
        assert result["items_deleted"] == []
        assert candidate.exists()

    def test_partial_failure_records_deleted_and_failed(self, isolated_workspace, monkeypatch):
        mgr, projects, _ = isolated_workspace
        good = _seed_render_file(projects, name="good.bin")
        bad = _seed_render_file(projects, name="locked.bin")
        real_remove = sm_mod._remove_file

        def flaky_remove(path):
            if Path(path).name == "locked.bin":
                raise PermissionError("file is locked")
            return real_remove(path)

        monkeypatch.setattr(sm_mod, "_remove_file", flaky_remove)
        preview = mgr.build_cleanup_preview(scope="routine")
        result = mgr.execute_cleanup_with_preview(
            preview_id=preview["preview_id"], scope="routine", confirmed=True
        )
        assert result["status"] == "PARTIAL_FAILURE"
        assert any("good.bin" in p for p in result["items_deleted"])
        assert any("locked.bin" in p for p in result["items_failed"])
        assert not good.exists()
        assert bad.exists()

    def test_execute_idempotent_second_run(self, isolated_workspace):
        mgr, projects, _ = isolated_workspace
        candidate = _seed_render_file(projects)
        first = mgr.execute_cleanup_with_preview(
            preview_id=mgr.build_cleanup_preview(scope="routine")["preview_id"],
            scope="routine",
            confirmed=True,
        )
        assert first["status"] == "SUCCESS"
        assert not candidate.exists()
        second = mgr.execute_cleanup_with_preview(
            preview_id=mgr.build_cleanup_preview(scope="routine")["preview_id"],
            scope="routine",
            confirmed=True,
        )
        assert second["status"] == "SUCCESS"
        assert second["items_deleted"] == []
        assert second["items_failed"] == []


# ---------------------------------------------------------------------------
# Task 6 — Confirmation modal, loading state, result feedback
# ---------------------------------------------------------------------------

class TestCleanupModalContract:
    def test_cleanup_confirmation_modal_contract(self):
        html = (STATIC / "index.html").read_text(encoding="utf-8")
        assert 'id="modal-cleanup-confirm"' in html
        assert 'role="dialog"' in html
        assert 'id="cleanup-confirm-title"' in html
        assert 'id="cleanup-confirm-summary"' in html
        assert "T\u00c0I NGUY\u00caN \u0110\u01af\u1ee2C B\u1ea2O V\u1ec6" in html
        assert 'id="cleanup-confirm-status"' in html
        assert 'id="btn-confirm-do-cleanup"' in html
        assert 'id="btn-confirm-cancel-cleanup"' in html
        assert "D\u1ecdn d\u1eb9p" in html
        assert "H\u1ee7y" in html

    def test_cleanup_preview_id_flow(self):
        src = (STATIC / "phase15a_ui.js").read_text(encoding="utf-8")
        # Fingerprint-gated flow: preview stores preview_id, execute sends it.
        assert "preview_id" in src
        assert "preview.preview_id" in src or "previewId" in src
        # Double-submit guard.
        assert "inFlight" in src
        # CLEANING state is explicit and visible.
        assert "\u0110ang d\u1ecdn d\u1eb9p..." in src
        # Result mapping covers all backend states incl. stale preview.
        assert "PARTIAL_FAILURE" in src
        assert "STALE_PREVIEW" in src or "stale" in src.lower()
        # Focus returns to a logical control after modal work.
        assert "returnFocus" in src or "__cleanupReturnFocus" in src

    def test_cleanup_result_banner_stays_concise(self):
        src = (STATIC / "phase15a_ui.js").read_text(encoding="utf-8")
        assert "D\u1ecdn d\u1eb9p ho\u00e0n t\u1ea5t." in src
        assert "T\u00e0i nguy\u00ean \u0111\u01b0\u1ee3c b\u1ea3o v\u1ec7:" in src
        assert "(${protectedSkipped} t\u00e0i nguy\u00ean" not in src


# ---------------------------------------------------------------------------
# Task 7 — Blank start, no demo auto-hydration
# ---------------------------------------------------------------------------

class TestBlankStart:
    def test_no_hardcoded_demo_startup(self):
        src = (STATIC / "app.js").read_text(encoding="utf-8")
        assert "2026-09-12_210003_youtube-narration-01" not in src
        assert "seedDemo" not in src
        assert "autoSeed" not in src
        assert "ensureDemo" not in src

    def test_no_autoload_first_project(self):
        src = (STATIC / "app.js").read_text(encoding="utf-8")
        assert "projects[0].directory_name" not in src
        # Startup only reopens a validated persisted selection.
        assert "resolveStartupProject" in src
        assert 'localStorage.getItem("unfoldiq_project")' in src

    def test_stale_project_reference_discarded(self):
        src = (STATIC / "app.js").read_text(encoding="utf-8")
        assert 'localStorage.removeItem("unfoldiq_project")' in src
        assert "resetWorkstationToCleanState" in src

    def test_global_settings_preserved(self):
        src = (STATIC / "app.js").read_text(encoding="utf-8")
        assert "APPEAR_KEY" in src
        assert "SHELL_KEY" in src

    def test_no_recent_projects_seed(self):
        src = (STATIC / "app.js").read_text(encoding="utf-8")
        assert "recentProjects" not in src
        assert "recent_projects" not in src


# ---------------------------------------------------------------------------
# Task 3 — Free-Priority UI removal, shared provider policy preserved
# ---------------------------------------------------------------------------

class TestFreePriorityRemoval:
    def test_free_priority_header_control_removed(self):
        html = _read("index.html")
        css = _all_css()
        assert "\u01afu ti\u00ean mi\u1ec5n ph\u00ed" not in html
        assert "cost-policy-badge" not in html
        assert "cost-policy-pill" not in html
        assert "cost-policy-badge" not in css
        assert "cost-policy-pill" not in css

    def test_provider_router_module_still_imports(self):
        from studio.provider_router import CostPolicy, provider_router

        assert provider_router.cost_policy == CostPolicy.FREE_FIRST
        status = provider_router.get_status_overview()
        assert status["costPolicy"] == "FREE_FIRST"
