"""Phase 6 FINAL manual-accessibility micro-closure pins.

These tests pin the REAL evidence artifacts produced by OS-level/manual
browser runs (keyboard / actual 200% zoom / exact breakpoints / Narrator).
They assert artifact existence + gated values; they do NOT fabricate manual
evidence (no artifact -> FAIL, never synthetic PASS).
"""
import json
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
CLOSE = REPO / "temp" / "phase06_final_closure"
KB = CLOSE / "keyboard"
ZM = CLOSE / "zoom200"
BP = CLOSE / "breakpoints"
SR = CLOSE / "screenreader"
IMPL = REPO / "docs" / "implementation"


def load(p):
    return json.loads(p.read_text(encoding="utf-8"))


class TestKeyboardEvidence:
    def test_artifacts_exist(self):
        for f in ("methodology.md", "keyboard_flow.json",
                  "focus_sequence.json", "focus_recheck.json"):
            assert (KB / f).is_file(), f"missing {f}"
        for f in ("drawer_open.png", "kb_final.png"):
            assert (KB / f).is_file() and (KB / f).stat().st_size > 0

    def test_no_pointer_fallback(self):
        d = load(KB / "keyboard_flow.json")
        assert d["pointerOrClickFallback"] is False
        assert "keybd_event" in d["method"]

    def test_native_activation_all_workbenches(self):
        d = load(KB / "keyboard_flow.json")
        steps = {s["step"]: s for s in d["flow"]}
        for ws in ("overview", "story", "voice", "scenes", "export"):
            s = steps[f"nav-{ws}"]
            assert s["reachedByTab"] is True, ws
            assert s["key"] in ("Enter", "Space")
            assert s["keyArrived"] is True, ws
            last = (s["keySeenByPage"] or "").split("+")[-1]
            assert (s["key"] == "Enter" and last == "Enter") or \
                (s["key"] == "Space" and last == " "), ws
            assert s["activated"] is True, ws

    def test_palette_keyboard(self):
        d = load(KB / "keyboard_flow.json")
        steps = {s["step"]: s for s in d["flow"]}
        assert steps["palette-open"]["open"] is True
        assert "ArrowDown" in steps["palette-arrows"]["keysSeen"]
        assert "shot_002" in steps["palette-arrows"]["afterDown"]
        assert steps["palette-enter"]["activatesStableTarget"] is True
        assert steps["palette-enter"]["paletteOpenAfter"] is False
        assert steps["palette-escape"]["closed"] is True

    def test_drawer_keyboard(self):
        d = load(KB / "keyboard_flow.json")
        steps = {s["step"]: s for s in d["flow"]}
        assert steps["drawer-reach-toggle"]["reached"] is True
        assert steps["drawer-open-enter"]["open"] is True
        assert steps["drawer-open-enter"]["role"] == "dialog"
        assert steps["drawer-trap"]["passTrap"] is True
        assert steps["drawer-escape"]["closed"] is True
        assert steps["drawer-escape"]["focusBackOnOpener"] is True
        assert steps["shot-arrow"]["afterArrowDown"] == "shot_002"

    def test_focus_visible_recheck(self):
        recs = load(KB / "focus_recheck.json")
        assert len(recs) >= 3
        for r in recs:
            assert r["tabArrived"] is True
            assert r["match"] is True

    def test_keyboard_console_clean(self):
        d = load(KB / "keyboard_flow.json")
        steps = {s["step"]: s for s in d["flow"]}
        c = steps["console"]
        assert c["errors"] in (0, 2) and c["unhandled"] == 0
        # only benign media-preload aborts (navigation side effect), no XHR/fetch
        for u in c.get("failedUrls", []):
            assert "ERR_ABORTED" in u and ("/audio/wav" in u or "/renders/" in u), u


class TestZoomEvidence:
    def test_artifacts_exist(self):
        assert (ZM / "zoom200.json").is_file()
        assert (ZM / "chrome_zoom200_indicator.png").is_file()

    def test_real_200_percent(self):
        z = load(ZM / "zoom200.json")
        assert z["realZoom200"] is True
        assert z["zoomFactor"] == pytest.approx(2.0, abs=0.02)
        assert z["before"]["dpr"] < z["after"]["dpr"]
        assert z["after"]["innerW"] * 2 == z["before"]["innerW"]
        assert "no emulation" in z["method"]

    def test_layout_adapts_band_correct(self):
        z = load(ZM / "zoom200.json")
        assert z["after"]["mode"] == "si"  # 753 CSS px -> sheets band
        for ws, st in z["workbenches"].items():
            assert st["active"] is True, ws
            assert st["nonBlank"] > 500, ws
            assert st["hscroll"] is False, ws

    def test_palette_sheet_keyboard(self):
        z = load(ZM / "zoom200.json")
        assert z["palette"]["fits"] is True and z["palette"]["inputVisible"] is True
        assert z["paletteClosed"] is True
        assert z["sheet"]["opened"] is True and z["sheet"]["fits"] is True
        assert z["sheet"]["role"] == "dialog" and z["sheet"]["closedAfter"] is True
        assert z["kbReach"]["visible"] is True

    def test_zoom_console_clean(self):
        z = load(ZM / "zoom200.json")
        assert z["console"]["errors"] in (0, 2) and z["console"]["unhandled"] == 0
        for u in z["console"].get("failedUrls", []):
            assert "ERR_ABORTED" in u and ("/audio/wav" in u or "/renders/" in u), u


class TestBreakpointEvidence:
    def test_real_exact_viewports(self):
        r = load(BP / "exact_breakpoints_real.json")
        assert "force-device-scale-factor" in r["method"] and "no emulation" in r["method"]
        w = r["widths"]
        for key in ("1280", "1279", "960", "959"):
            assert w[key]["exact"] is True, key
            assert w[key]["clientWidthOs"] == int(key)
            assert w[key]["fracWidth"] == int(key)
        assert w["1280"]["mode"] == "SI" and w["1280"]["mm1280"] is True
        assert "332px" in w["1280"]["grid"]
        assert w["1279"]["mode"] == "Si" and w["1279"]["mm960_1279"] is True
        assert w["1279"]["inspectorTrigger"]["opened"] is True
        assert w["1279"]["inspectorTrigger"]["closed"] is True
        assert w["960"]["mode"] == "Si" and w["960"]["mm960_1279"] is True
        assert w["959"]["mode"] == "si" and w["959"]["mm959"] is True
        assert w["959"]["sidebarDisplay"] == "none"
        assert r["console"] == {"errors": 0, "unhandled": 0}

    def test_emulation_supporting_artifact_exists(self):
        assert (BP / "exact_breakpoints.json").is_file()
        for key in ("1280", "1279", "960", "959"):
            assert (BP / f"edge-{key}.png").is_file()
            assert (BP / f"real-{key}.png").is_file()


class TestScreenReaderEvidence:
    def test_artifacts_exist(self):
        assert (SR / "screenreader2.json").is_file()
        assert (SR / "sr2_drawer.png").is_file()

    def test_narrator_really_ran(self):
        s = load(SR / "screenreader2.json")
        assert s["narratorRunningAfterLaunch"] is True
        assert s["narratorDuringNav"] is True
        assert s["narratorDuringDrawer"] is True
        assert all(m["narratorRunning"] is True for m in s["milestones"])
        assert "10.0.26100" in s["narratorFileVersion"]
        assert s["narratorStoppedAfterRun"] is True

    def test_names_and_progress_under_at(self):
        s = load(SR / "screenreader2.json")
        assert any("shot_002" in n or "Cảnh" in n for n in s["tabNames"])
        assert s["drawer"]["open"] is True and s["drawer"]["role"] == "dialog"
        assert "Inspector" in s["drawer"]["title"]
        assert s["drawerEsc"]["closed"] is True
        texts = [m["liveText"] for m in s["milestones"]]
        assert any("25%" in t for t in texts)
        assert any("50%" in t for t in texts)
        assert any("75%" in t for t in texts)
        assert any("Hoàn tất" in t for t in texts)
        assert s["console"]["unhandled"] == 0 and s["console"]["errors"] in (0, 2)
        assert "no audio transcript" in s["observerNote"].lower() or \
            "no spoken transcript" in s["observerNote"].lower()

    def test_no_fabricated_speech(self):
        raw = (SR / "screenreader2.json").read_text(encoding="utf-8").lower()
        assert "narrator said" not in raw and "heard:" not in raw


class TestClosureGovernance:
    def test_closure_report_exists(self):
        rep = IMPL / "PHASE_06_FINAL_MANUAL_CLOSURE_REPORT.md"
        assert rep.is_file(), "closure report missing"
        t = rep.read_text(encoding="utf-8")
        assert "aa-oriented accessibility hardening" in t.lower()
        assert "WCAG 2.2 AA fully compliant" not in t
        assert "formal accessibility audit passed" not in t.lower()

    def test_roadmap_not_promoted(self):
        roadmap = (IMPL / "ROADMAP_STATUS.md").read_text(encoding="utf-8")
        # Phase 6 passed external review (provenance: Phase 7 micro-closure prompt §2).
        assert "Phase 6" in roadmap and "PASS / FINAL" in roadmap
        # Phase 7 passed external review (provenance: PHASE_07_FINAL_EXTERNAL_CLOSURE_REPORT.md).
        assert "Phase 7" in roadmap and "PASS / FINAL" in roadmap
        assert "Phase 5" in roadmap and "PASS / FINAL" in roadmap

    def test_future_phases_absent(self):
        assert not list(REPO.glob("**/render-manifest.json"))
        assert "TimelineCompiler" not in (REPO / "studio" / "static" / "app.js").read_text(encoding="utf-8")
