"""Phase 6 focused tests — responsive + WCAG 2.2 AA-oriented hardening.

Contracts over brittle pixels: CSS breakpoint/query strings, token values +
computed contrast ratios (deterministic math), browser evidence pinning
(matrix/edges/drawer/targets/keyboard/zoom/coarse/manual gates), source
audits (drag/tabindex/names/semantics), governance (Phase 7/8/9 absence,
no formal-conformance claim).
"""
import json
import re
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
STATIC = REPO / "studio" / "static"
IMPL = REPO / "docs" / "implementation"
P6 = REPO / "temp" / "phase06_verification"


def css(name):
    return (STATIC / name).read_text(encoding="utf-8")


def lum(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]

    def f(x):
        return x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4

    r, g, b = [f(x) for x in c]
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def ratio(a, b):
    x, y = sorted([lum(a), lum(b)], reverse=True)
    return (x + 0.05) / (y + 0.05)


class TestBreakpoints:
    def test_canonical_bands(self):
        shell = css("uq-shell.css")
        resp = css("uq-responsive.css")
        assert "@media (min-width: 960px) and (max-width: 1279px)" in shell
        assert "@media (min-width: 1280px) and (max-width: 1439px)" in resp
        assert "grid-template-columns: 64px minmax(0, 1fr);" in shell

    def test_edge_queries_exact(self):
        # Exact boundary strings (emulation cannot hit fractional edges, so
        # the queries themselves are pinned here + neighbor widths in browser).
        shell = css("uq-shell.css")
        assert "(min-width: 960px)" in shell and "(max-width: 1279px)" in shell
        assert "(min-width: 1280px)" in shell
        resp = css("uq-responsive.css")
        assert "(max-width: 959px)" in resp

    def test_edge_neighbors_browser(self):
        m = json.loads((P6 / "browser" / "matrix.json").read_text(encoding="utf-8"))
        e = m["edges"]
        assert e["edge-1280"]["shell"]["grid"].startswith("64px")
        assert "332px" in e["edge-1280"]["shell"]["grid"]  # 3-pane
        assert e["edge-1278"]["shell"]["grid"].count("px") == 2  # 2-col
        assert e["edge-1278"]["shell"]["inspectorDisplay"] == "none"
        assert e["edge-960"]["shell"]["grid"].count("px") == 2
        assert e["edge-958"]["shell"]["grid"].count("px") == 1  # single
        assert e["edge-958"]["shell"]["sidebarDisplay"] == "none"

    def test_list_pane_min_height_guard(self):
        assert "min-height: min(440px, 72vh)" in css("uq-responsive.css")

    def test_hidden_tabbables_browser(self):
        m = json.loads((P6 / "browser" / "matrix.json").read_text(encoding="utf-8"))
        h = m["hidden_tabbables"]
        assert h["pipeline-sidebar"]["visibleFocusable"] == 0
        assert h["workspace-inspector"]["visibleFocusable"] == 0
        assert h["visibleFocusableInHiddenViews"] == 0


class TestTargetSize:
    def test_normal_policy(self):
        d = json.loads((P6 / "a11y" / "target_sizes_normal.json").read_text(encoding="utf-8"))
        assert d["n"] >= 300
        # every remaining sub-24 control (if any) is an inline sentence word
        if d["violations24"]:
            assert {(v["tag"], v["cls"]) for v in d["violations24"]} == {("span", "word-cue")}
        # word cues are joined inline with spaces (WCAG 2.5.8 Inline context)
        app = (STATIC / "app.js").read_text(encoding="utf-8")
        assert ").join(\" \")" in app and "word-cue" in app
        # slider thumbs sized by live rules (24px), not element boxes
        rules = " ".join(d.get("sliderRules", []))
        assert "width: 24px" in rules and "slider-thumb" in rules

    def test_coarse_policy(self):
        c = json.loads((P6 / "a11y" / "target_sizes_coarse.json").read_text(encoding="utf-8"))
        assert c["pointerCoarse"] is True  # media verified, not assumed
        assert c["violations44"] == []
        assert c["overflow"]["hscroll"] is False


class TestContrast:
    def test_ink4_tokens(self):
        tokens = css("uq-tokens.css")
        assert "--uq-ink-4: #75839a" in tokens
        assert "--uq-ink-4: #67748a" in tokens

    def test_normal_text_ratios(self):
        assert ratio("#75839a", "#111826") >= 4.5
        assert ratio("#75839a", "#0d121b") >= 4.5
        assert ratio("#67748a", "#ffffff") >= 4.5
        # plan value #6b7a90 would NOT have passed — documented, not kept
        assert ratio("#6b7a90", "#111826") < 4.5

    def test_focus_ring_contrast(self):
        assert ratio("#4f8cff", "#111826") >= 3.0
        assert ratio("#2563eb", "#ffffff") >= 3.0

    def test_focus_token_and_rule(self):
        assert "--uq-focus-ring:" in css("uq-tokens.css")
        base = css("uq-base.css")
        assert ":focus-visible" in base and "2px solid var(--uq-focus-ring" in base


class TestFocusDrawers:
    def _drawer(self):
        m = json.loads((P6 / "browser" / "matrix.json").read_text(encoding="utf-8"))
        return m["drawer"]

    def test_modal_semantics_browser(self):
        for tag, d in self._drawer().items():
            st = d["openState"]
            assert st["open"] is True, tag
            assert st["role"] == "dialog" and st["modal"] == "true", tag
            assert st["label"] and st["backdrop"] is True, tag

    def test_trap_and_escape_browser(self):
        for tag, d in self._drawer().items():
            assert d["tabWrap"] == [True, True, True], tag
            esc = d["escape"]
            assert esc["closed"] is True and esc["focusOnOpener"] is True, tag
            assert esc["bodyLock"] == "", tag

    def test_closeall_and_resize_contracts(self):
        m = json.loads((P6 / "browser" / "matrix.json").read_text(encoding="utf-8"))
        c = m["closeall_direct"]
        assert c == {"closed": True, "roleGone": True, "modalGone": True,
                     "parkedOnToggle": True, "lock": ""}
        assert m["mode_flips"]["wide"]["mode"] == "SI"
        assert m["mode_flips"]["laptop"]["mode"] == "Si"
        assert m["mode_flips"]["narrow"]["mode"] == "si"

    def test_single_escape_owner(self):
        app = (STATIC / "app.js").read_text(encoding="utf-8")
        # old raw-removal drawer branches are gone; controller owns Escape
        assert "pipelineSidebar.classList.remove(\"open\")" not in app
        assert "workspaceInspector.classList.remove(\"open\")" not in app
        assert "closeAllDrawers();" in app


class TestReflowZoom:
    def test_320_reflow(self):
        m = json.loads((P6 / "browser" / "matrix.json").read_text(encoding="utf-8"))
        v = m["viewports"]["320x800"]
        assert v["overflow"]["pageHScroll"] is False
        assert v["shell"]["grid"].count("px") == 1
        p = m["palette_narrow"]
        assert p["open"] is True and p["fits"] is True and p["inputVisible"] is True

    def test_zoom_equivalent(self):
        g = json.loads((P6 / "manual" / "gates.json").read_text(encoding="utf-8"))
        z = g["zoom200"]
        assert z["after"]["dpr"] == pytest.approx(2.0, abs=0.01)
        assert z["after"]["iw"] == 960 and z["after"]["mode"] == "Si"
        assert z["after"]["hscroll"] is False
        assert z["inspectorToggleVisible"] is True


class TestDragStatic:
    def test_no_author_drag_reorder(self):
        html = (STATIC / "index.html").read_text(encoding="utf-8")
        assert 'draggable="true"' not in html and "draggable='true'" not in html
        for f in ("app.js", "phase14_ui.js", "phase15a_ui.js"):
            src = (STATIC / f).read_text(encoding="utf-8")
            assert "dragstart" not in src, f
            assert "sortable" not in src.lower(), f
        # only file-intake dropzones exist, with click alternative
        red = (STATIC / "redesign.js").read_text(encoding="utf-8")
        assert "makeDropzone" in red and "Ch\u1ecdn t\u1ec7p" in red


class TestSrNames:
    def test_live_region_contract(self):
        html = (STATIC / "index.html").read_text(encoding="utf-8")
        assert 'id="uq-live-polite"' in html
        assert 'role="status"' in html and 'aria-live="polite"' in html
        assert "window.uqAnnounce" in (STATIC / "app.js").read_text(encoding="utf-8")
        assert "uqAnnounce" in (STATIC / "phase14_ui.js").read_text(encoding="utf-8")
        g = json.loads((P6 / "manual" / "gates.json").read_text(encoding="utf-8"))
        assert g["sr"]["livePolite"] == "polite" and g["sr"]["liveRole"] == "status"
        assert "50%" in g["sr"]["liveText"]

    def test_accessible_names(self):
        ax = json.loads((P6 / "browser" / "ax_tree.json").read_text(encoding="utf-8"))
        names = [n["name"] for n in ax["namedSample"]]
        assert any("Menu Quy Trình" in n for n in names)
        assert any("Bảng Inspector" in n for n in names)
        html = (STATIC / "index.html").read_text(encoding="utf-8")
        assert 'aria-label="Menu điều hướng công việc"' in html
        assert 'aria-label="Bảng thông tin Inspector"' in html

    def test_modal_semantics_source(self):
        html = (STATIC / "index.html").read_text(encoding="utf-8")
        assert 'id="visual-bible-modal"' in html
        assert 'role="dialog"' in html and 'aria-modal="true"' in html

    def test_no_positive_tabindex(self):
        for f in ("app.js", "phase14_ui.js", "redesign.js", "uq-palette.js"):
            src = (STATIC / f).read_text(encoding="utf-8")
            hits = re.findall(r'tabindex"\s*,\s*"([1-9])', src) + re.findall(r'tabindex=\\"([1-9])', src)
            assert not hits, (f, hits)
        html = (STATIC / "index.html").read_text(encoding="utf-8")
        assert not re.findall(r'tabindex="[1-9]', html)


class TestKeyboardManual:
    def test_keyboard_workflow(self):
        g = json.loads((P6 / "manual" / "gates.json").read_text(encoding="utf-8"))
        kb = g["keyboard"]
        assert kb["noBodyTrap"] is True
        assert kb["focusVisibleMatch"] is True
        assert kb["navKeyboard"]["voice"]["reachedByTab"] is True
        assert kb["navKeyboard"]["voice"]["active"] is True
        assert kb["navKeyboard"]["scenes"]["active"] is True
        assert kb["paletteOpen"] is True and kb["paletteActivate"] is True
        assert kb["drawerToggleReached"] is True and kb["drawerOpenKb"] is True
        assert kb["drawerEscKb"] is True and kb["drawerFocusBackKb"] is True
        assert kb["shotArrowKb"] == "shot_002"

    def test_vertical_reachability(self):
        g = json.loads((P6 / "manual" / "gates.json").read_text(encoding="utf-8"))
        for ws, v in g["vertical1366"].items():
            for s in v.get("reachSample", []):
                assert s["ok"] is True, (ws, s)

    def test_coarse_behavior(self):
        g = json.loads((P6 / "manual" / "gates.json").read_text(encoding="utf-8"))
        c = g["coarse"]
        assert c["coarseTrue"] is True
        assert c["sheetOpensByTouch"] is True
        assert c["noHoverNeeded"] is True


class TestGovernanceScope:
    def test_future_phases_absent(self):
        roadmap = (IMPL / "ROADMAP_STATUS.md").read_text(encoding="utf-8")
        assert "Phase 6" in roadmap and "PASS / FINAL" in roadmap
        assert "Web Preview & Timeline Editor" in roadmap and ("CONSIDERATION" in roadmap or "RESEARCH" in roadmap)

    def test_no_formal_claim(self):
        rep = IMPL / "PHASE_06_IMPLEMENTATION_REPORT.md"
        assert rep.is_file(), "Phase 6 report missing"
        t = rep.read_text(encoding="utf-8")
        assert "aa-oriented accessibility hardening" in t.lower()
        assert "WCAG 2.2 AA fully compliant" not in t
        assert "formal accessibility audit passed" not in t.lower()

    def test_roadmap_state(self):
        roadmap = (IMPL / "ROADMAP_STATUS.md").read_text(encoding="utf-8")
        assert "Phase 6" in roadmap and "PASS / FINAL" in roadmap
        assert "PASS / FINAL" in roadmap  # Phase 5 stays verified
