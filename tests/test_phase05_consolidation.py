"""
Phase 5 contract tests — component consolidation, virtualization wiring,
palette wiring, no-regression guards. Behavioral verification lives in
CDP evidence scripts (temp/phase05_verification/); these contracts fail
if the migration actually regresses (missing module, unwired integration,
raw-English UI, lost 3C/3D behavior).
"""
import re
from pathlib import Path

STATIC = Path("studio/static")


def _read(name):
    return (STATIC / name).read_text(encoding="utf-8")


class TestPrimitiveContracts:
    def test_uq_primitives_module_contract(self):
        js = _read("uq-primitives.js")
        for fn in ("emptyState", "errorState", "statusBadge", "checkRow"):
            assert re.search(rf"\b{fn}\b", js), f"UQ.{fn} missing"
        assert "window.UQ" in js

    def test_uq_virtual_list_module_contract(self):
        js = _read("uq-virtual-list.js")
        assert "window.UQVirtualList" in js
        assert "computeWindow" in js and "layoutOffsets" in js
        assert "windowForOffsets" in js and "attachWindowedScroll" in js

    def test_uq_palette_module_contract(self):
        js = _read("uq-palette.js")
        assert "window.UQPalette" in js
        for fn in ("open", "close", "isOpen", "search", "fuzzyScore"):
            assert re.search(rf"\b{fn}\b", js), f"UQPalette.{fn} missing"

    def test_evidence_based_threshold(self):
        """THRESHOLD_GROUPS must stay at the evidence-backed value (200)."""
        js = _read("uq-virtual-list.js")
        m = re.search(r"THRESHOLD_GROUPS\s*=\s*(\d+)", js)
        assert m and int(m.group(1)) == 200, "threshold changed without evidence update"

    def test_primitive_css_contract(self):
        css = _read("uq-components.css")
        for cls in (".uq-vspacer", ".uq-check-row", ".uq-cmd-backdrop",
                    ".uq-cmd-dialog", ".uq-cmd-item", ".uq-cmd-empty"):
            assert cls in css, f"{cls} missing from uq-components.css"

    def test_script_load_order(self):
        html = _read("index.html")
        tags = [(m.group(1), m.start()) for m in re.finditer(
            r'<script src="(uq-virtual-list|uq-primitives|uq-palette|app)\.js', html)]
        assert [n for n, _ in tags] == ["uq-virtual-list", "uq-primitives",
                                        "uq-palette", "app"], f"script order broken: {tags}"


class TestConsolidationConsumers:
    def test_export_preflight_uses_check_row(self):
        js = _read("phase14_ui.js")
        assert "window.UQ.checkRow" in js or "UQ.checkRow" in js

    def test_phase14_delegates_empty_error(self):
        js = _read("phase14_ui.js")
        assert "window.UQ.emptyState" in js and "window.UQ.errorState" in js

    def test_palette_uses_shared_esc(self):
        js = _read("uq-palette.js")
        assert "window.UQ.esc" in js or "UQ.esc" in js

    def test_virtualization_wired_in_navigator(self):
        js = _read("app.js")
        assert "UQVirtualList" in js
        assert "ensureVisualShotVisible" in js
        assert "visualSceneGroupHtml" in js
        # lazy-mount: collapsed trees must not mount shot buttons unconditionally
        assert "mountShots" in js


class TestVietnameseFirst:
    def test_palette_kind_labels_vietnamese(self):
        js = _read("uq-palette.js")
        m = re.search(r"KIND_LABEL\s*=\s*\{([^}]*)\}", js)
        assert m
        body = m.group(1)
        assert "Cảnh" in body and "Cảnh quay" in body and "Nhân vật" in body
        assert '"Scene"' not in body and '"Shot"' not in body and '"Character"' not in body

    def test_palette_chrome_vietnamese(self):
        js = _read("uq-palette.js")
        for text in ("Tìm nhanh", "Tìm cảnh, cảnh quay hoặc nhân vật",
                     "Không tìm thấy kết quả"):
            assert text in js, f"missing Vietnamese string: {text}"

    def test_no_raw_enum_primary_in_new_ui(self):
        for name in ("uq-palette.js", "uq-virtual-list.js", "uq-primitives.js"):
            js = _read(name)
            for enum in ("BLOCKED", "QUEUED", "RENDERING", "COMPLETED", "OUTDATED"):
                assert enum not in js, f"raw enum {enum} leaked in {name}"


class TestNoRegressionGuards:
    def test_navigator_keeps_disclosure_semantics(self):
        html = _read("index.html")
        assert 'role="listbox"' in html  # unchanged 3C-approved pattern
        js = _read("app.js")
        assert 'role="tree"' not in js

    def test_3c_revision_restore_intact(self):
        js = _read("app.js")
        assert "data-rev-id" in js and "revision_id" in js

    def test_3c_shot_patch_intact(self):
        import pathlib
        app_py = pathlib.Path("studio/app.py").read_text(encoding="utf-8")
        assert 'visual/shots/{shot_id}' in app_py

    def test_3d_readiness_intact(self):
        js = _read("phase14_ui.js")
        assert "/export/readiness" in js
        assert "renders/draft/file" in js and "renders/final/file" in js

    def test_phase7_8_9_still_absent(self):
        import pathlib
        names = [p.name for p in pathlib.Path("studio").glob("*.py")]
        # Phase 7 start (authorized): render manifest + timeline compiler
        # sources are allowed; Phase 8 renderer / Phase 9 QA stay banned.
        for banned in ("timeline_compiler_v2.py",
                       "manifest_renderer.py", "render_qa.py",
                       "render_from_manifest.py", "manifest_qa.py"):
            assert banned not in names, f"Phase 8/9 file leaked: {banned}"
        src = pathlib.Path("studio/renderer_adapter.py").read_text(encoding="utf-8")
        assert "render_from_manifest" not in src
        assert "h264_nvenc" not in src
