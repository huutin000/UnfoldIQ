"""Two-gate closure pins: human-perceived Narrator announcements + canonical
1080p-class actual 200% zoom (~960 CSS, Si Drawer). Real artifacts only.
"""
import json
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
TWOGATE = REPO / "temp" / "phase06_twogate_closure"
ZM = TWOGATE / "zoom1080"
SR = TWOGATE / "screenreader"
IMPL = REPO / "docs" / "implementation"


def load(p):
    return json.loads(p.read_text(encoding="utf-8"))


class TestHumanScreenReader:
    def test_scenario_artifacts_exist(self):
        assert (SR / "sr_scenario.json").is_file()
        assert (SR / "sr_human.json").is_file()

    def test_narrator_ran_throughout(self):
        s = load(SR / "sr_scenario.json")
        assert s["narratorRunningAfterLaunch"] is True
        assert s["narratorDuringNav"] is True
        assert s["narratorDuringDrawer"] is True
        assert all(m["narratorRunning"] is True for m in s["milestones"])
        assert s["narratorStoppedAfterRun"] is True
        assert s["console"] == {"errors": 0, "unhandled": 0}

    def test_human_perceived_announcements(self):
        h = load(SR / "sr_human.json")
        assert h["observer"] == "HUMAN"
        assert h["twentyfive_heard"].startswith("YES")
        assert h["fifty_heard"].startswith("YES")
        assert h["seventyfive_heard"].startswith("YES")
        assert h["completion_heard"].startswith("YES")
        assert h["control_names"]["perceived"].startswith("YES")
        # scenario triggers match what the human confirmed
        s = load(SR / "sr_scenario.json")
        live = [m["liveText"] for m in s["milestones"]]
        assert any("25%" in t for t in live)
        assert any("50%" in t for t in live)
        assert any("75%" in t for t in live)
        assert any("Hoàn tất" in t for t in live)

    def test_names_available_in_scenario(self):
        s = load(SR / "sr_scenario.json")
        assert len(s["tabNames"]) >= 5
        assert s["drawer"]["open"] is True
        assert "Inspector" in s["drawer"]["title"]


class TestZoom1080:
    def test_artifacts_exist(self):
        assert (ZM / "zoom1080.json").is_file()
        assert (ZM / "zoom1080_drawer.json").is_file()
        assert (ZM / "zoom1080_indicator.png").is_file()
        assert (ZM / "zoom1080_drawer.png").is_file()

    def test_1080p_start_real_200_percent(self):
        z = load(ZM / "zoom1080.json")
        assert z["displayPhysical"][0] >= 1900
        assert z["before"]["innerW"] >= 1850
        assert z["before"]["dpr"] == 1
        assert z["realZoom200"] is True
        assert z["zoomFactor"] == pytest.approx(2.0, abs=0.02)
        assert z["nearCanonical960"] is True
        assert abs(z["after"]["innerW"] - 960) <= 12
        assert "no emulation" in z["method"]

    def test_si_drawer_band(self):
        z = load(ZM / "zoom1080.json")
        assert z["after"]["mode"] == "Si"
        assert z["after"]["mm960_1279"] is True
        assert z["after"]["grid"].count("px") == 2
        assert z["after"]["hscroll"] is False
        d = load(ZM / "zoom1080_drawer.json")
        assert d["zoomedMetrics"]["mode"] == "Si"
        assert d["reach"]["found"] is True
        assert d["open"]["open"] is True and d["open"]["role"] == "dialog"
        assert d["open"]["keyArrived"] is True
        assert d["trap"]["pass"] is True
        assert d["escape"]["closed"] is True
        assert d["escape"]["focusReturn"] is True

    def test_workbenches_palette_focus(self):
        z = load(ZM / "zoom1080.json")
        for ws in ("story", "voice", "scenes", "export", "overview"):
            assert z["workbenches"][ws]["usable"] is True, ws
            assert z["workbenches"][ws]["hscroll"] is False, ws
        assert z["palette"]["fits"] is True and z["paletteClosed"] is True
        assert z["focusVisible"]["inView"] is True
        assert z["console"]["errors"] == 0 and z["console"]["unhandled"] == 0
        for u in z["console"].get("failedUrls", []):
            assert "ERR_ABORTED" in u and ("/audio/wav" in u or "/renders/" in u), u


class TestTwoGateGovernance:
    def test_report_exists(self):
        rep = IMPL / "PHASE_06_FINAL_TWO_GATE_CLOSURE_REPORT.md"
        assert rep.is_file()
        t = rep.read_text(encoding="utf-8")
        assert "aa-oriented accessibility hardening" in t.lower()
        assert "WCAG 2.2 AA fully compliant" not in t

    def test_roadmap_state(self):
        roadmap = (IMPL / "ROADMAP_STATUS.md").read_text(encoding="utf-8")
        # Phase 6 passed external review (provenance: Phase 7 micro-closure prompt §2).
        assert "Phase 6" in roadmap and "PASS / FINAL" in roadmap
        # Phase 7 passed external review (provenance: PHASE_07_FINAL_EXTERNAL_CLOSURE_REPORT.md).
        assert "Phase 7" in roadmap and "PASS / FINAL" in roadmap

    def test_future_phases_absent(self):
        assert not list(REPO.glob("**/render-manifest.json"))
        assert "TimelineCompiler" not in (REPO / "studio" / "static" / "app.js").read_text(encoding="utf-8")
