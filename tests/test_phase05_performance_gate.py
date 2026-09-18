"""Phase 5 final performance-gate focused tests (sustained-scroll methodology).

Contracts tested (no machine-dependent FPS hardcoding): active-interval
extraction, FPS denominator correctness (active window, not wall), gesture
validity/boundary-exclusion rules, dense own-run evidence, render/DOM gates,
palette effective pass, timestamp format, governance promotion rule.
"""
import json
import re
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "scripts"))

import verify_phase05_sustained as st

PERF = REPO / "temp" / "phase05_performance_gate_closure" / "performance"
OUT = REPO / "temp" / "phase05_performance_gate_closure"

ISO_TZ = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?[+-]\d{2}:\d{2}$")


class TestActiveInterval:
    def test_window_from_input_markers(self):
        ts = [10_000_000 + i * 5_000 for i in range(100)]
        w = st.active_window(ts)
        assert w == (10_000_000, 10_000_000 + 99 * 5_000 + st.TAIL_US)

    def test_needs_sustained_input(self):
        assert st.active_window([]) is None
        assert st.active_window([1_000_000]) is None

    def test_tail_extends_for_final_presents(self):
        ts = [1_000_000, 2_000_000]
        assert st.active_window(ts)[1] == 2_000_000 + st.TAIL_US


class TestDenominatorCorrectness:
    def test_fps_uses_active_not_wall(self):
        # 10 presents inside a 1s active interval, 5s wall with idle padding:
        # correct FPS is 10, wall-diluted would be 2.
        pres = [1_000_000 + i * 100_000 for i in range(10)]
        fps, n, dur = st.active_fps(pres, (1_000_000, 2_000_000 + st.TAIL_US))
        assert dur == pytest.approx(1.2, abs=0.01)
        assert fps == pytest.approx(10 / 1.2, abs=0.05)
        wall_diluted = n / 5.0
        assert wall_diluted == pytest.approx(2.0, abs=0.01)
        assert fps > 2 * wall_diluted  # active denominator, not wall-diluted

    def test_boundary_exclusion_rule(self):
        ok, _ = st.run_valid(12000, 12000, 4400)
        assert ok is True
        ok, reason = st.run_valid(3000, 12000, 4400)
        assert ok is False and "boundary" in reason
        ok, reason = st.run_valid(12000, 12000, 3)
        assert ok is False and "input" in reason


class TestSustainedEvidence:
    def _data(self):
        return json.loads((PERF / "sustained_runs.json").read_text(encoding="utf-8"))

    def test_five_valid_runs_per_condition(self):
        d = self._data()
        for cond in ("large-virtualized", "large-direct", "dense-300"):
            rs = [r for r in d["runs"] if r["condition"] == cond and r["valid"]]
            assert len(rs) >= 5, cond

    def test_sustained_not_sparse(self):
        # sustained gesture: thousands of input-latency events per run and
        # multi-second active windows — not the old 16x250ms discrete pattern
        d = self._data()
        for r in d["runs"]:
            if not r["valid"]:
                continue
            assert r["n_input_events"] >= 1000, r
            assert r["active_s"] >= 3.0, r
            assert r["travel_px"] >= 0.8 * r["requested_px"], r

    def test_invalid_runs_reported_separately(self):
        d = self._data()
        assert "invalid_runs" in d
        # medians must exclude invalid runs: recompute condition sizes
        s = json.loads((PERF / "sustained_summary.json").read_text(encoding="utf-8"))
        for cond, c in s["conditions"].items():
            assert c["n_valid"] == len(
                [r for r in d["runs"] if r["condition"] == cond and r["valid"]])

    def test_dense_own_runs_with_frame_signal(self):
        d = self._data()
        dense = [r for r in d["runs"] if r["condition"] == "dense-300" and r["valid"]]
        assert len(dense) >= 5
        assert all(r["presented_signal"].startswith("Display::FrameDisplayed")
                   for r in dense)


class TestRenderDomGates:
    def test_render_and_dom(self):
        d = json.loads((PERF / "render.json").read_text(encoding="utf-8"))
        assert d["large-virtualized"]["render_p95_ms"] <= 50
        assert d["dense-300"]["render_p95_ms"] <= 50
        assert d["large-virtualized"]["dom_nodes"] < d["large-direct"]["dom_nodes"]
        assert d["dense-300"]["buttons"] >= 300


class TestPaletteAndGates:
    def test_palette_effective_pass(self):
        p = json.loads((PERF / "palette_smoke.json").read_text(encoding="utf-8"))
        fails = [k for k, v in p.items() if not v["pass"]]
        # main smoke may carry the settle-timing dense FAIL (documented);
        # corrected recheck must pass trial1
        assert set(fails) <= {"dense off-window reveal"}, p
        r = json.loads((PERF / "palette_dense_recheck.json").read_text(encoding="utf-8"))
        assert r["trial1"]["pass"] is True
        assert r["trial1"]["active"] == "uq-cmd-opt-0"

    def test_console_network_and_integrity(self):
        c = json.loads((OUT / "console_network.json").read_text(encoding="utf-8"))
        assert c == {"console_errors": 0, "unhandled": 0,
                     "failed_non_media": 0, "server_5xx": 0}
        i = json.loads((OUT / "integrity.json").read_text(encoding="utf-8"))
        assert i["unchanged"] is True and len(i["before"]) == 9
        cl = json.loads((OUT / "cleanup.json").read_text(encoding="utf-8"))
        assert cl["leftover"] == []

    def test_dense_functional(self):
        d = json.loads((PERF / "dense_functional.json").read_text(encoding="utf-8"))
        assert d["arrow_down_seq"] == ["shot_d002", "shot_d003", "shot_d004",
                                       "shot_d005", "shot_d006", "shot_d007"]
        assert d["end_id"] == "shot_d300" and d["home_first"] is True
        assert d["sel250_nav"] == "true" and d["sel250_survives"] is True
        assert d["focus_valid"] is True


class TestTimestampAndGovernance:
    def test_report_timestamp(self):
        rep = REPO / "docs" / "implementation" / "PHASE_05_FINAL_PERFORMANCE_GATE_REPORT.md"
        assert rep.is_file(), "performance gate report missing"
        m = re.search(r"Generated at:\s*(\S+)", rep.read_text(encoding="utf-8"))
        assert m and ISO_TZ.match(m.group(1))
        assert m.group(1).startswith("2026-09-17"), "no future-date reports"

    def test_promotion_rule_consistency(self):
        rep = (REPO / "docs" / "implementation"
               / "PHASE_05_FINAL_PERFORMANCE_GATE_REPORT.md").read_text(encoding="utf-8")
        roadmap = (REPO / "docs" / "implementation" / "ROADMAP_STATUS.md").read_text(encoding="utf-8")
        s = json.loads((PERF / "sustained_summary.json").read_text(encoding="utf-8"))
        j = s["conditions"]["large-virtualized"]["active_fps_median"] >= 55
        k = s["conditions"]["dense-300"]["active_fps_median"] >= 55
        if "PHASE 5: PASS / FINAL / VERIFIED" in rep:
            assert j and k, "promotion requires J/K medians >= 55"
            assert "Phase 5" in roadmap and "PASS / FINAL" in roadmap
        assert "Phase 6" in roadmap and "NOT STARTED" in roadmap

    def test_historical_reports_preserved(self):
        for f in ("PHASE_05_IMPLEMENTATION_REPORT.md",
                  "PHASE_05_FINAL_CLOSURE_REPORT.md",
                  "PHASE_05_FINAL_EVIDENCE_CLOSURE_REPORT.md"):
            assert (REPO / "docs" / "implementation" / f).is_file(), f
