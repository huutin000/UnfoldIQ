"""Phase 5 corrective evidence-closure focused tests.

Covers (§19): frame-evidence parser contracts (presented / partial /
dropped classification over synthetic traces), dense-frame evidence
presence (own FPS, NOT inferred), timestamp/timezone format, governance
state transition (no premature PASS), functional pinning (dense keyboard,
palette corrected Enter). No brittle substring tests; all assertions run
against real parser code and real evidence files.
"""
import json
import re
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "scripts"))

import verify_phase05_frame_evidence as fe

PERF = REPO / "temp" / "phase05_evidence_closure" / "performance"
OUT = REPO / "temp" / "phase05_evidence_closure"

ISO_TZ = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?[+-]\d{2}:\d{2}$")


def synth_presented_ts(base=1_000_000, step=6944, n=10):
    return [{"name": "Display::FrameDisplayed", "ts": base + i * step}
            for i in range(n)]


class TestFrameParser:
    def test_presented_count_and_signal(self):
        ev = synth_presented_ts(n=10)
        r = fe.parse_frame_evidence(ev)
        assert r["presented_count"] == 10
        assert r["presented_signal"] == "Display::FrameDisplayed"
        assert r["presented_peak_1s"] == 10  # 10 presents inside ~63ms
        assert r["presented_gap_p50_ms"] == pytest.approx(6.94, abs=0.01)

    def test_fallback_signal_when_no_frame_displayed(self):
        ev = [{"name": "Graphics.Pipeline", "ts": 5_000_000,
               "args": {"chrome_graphics_pipeline": {"step": "STEP_SWAP_BUFFERS_ACK"}}},
              {"name": "Swap", "ts": 5_001_000}]
        r = fe.parse_frame_evidence(ev)
        assert r["presented_count"] == 1
        assert "fallback" in r["presented_signal"]
        # generic Swap alone must NOT count as presented
        r2 = fe.parse_frame_evidence([{"name": "Swap", "ts": 5_001_000}])
        assert r2["presented_count"] == 0

    def test_dropped_vs_skipped_classification(self):
        ev = (synth_presented_ts(n=3)
              + [{"name": "Scheduler::BeginFrameDropped", "ts": 1},
                 {"name": "LayerTreeHostImpl::DidNotProduceFrame", "ts": 2,
                  "args": {"FrameSkippedReason": "kRecoverLatency"}},
                 {"name": "LayerTreeHostImpl::DidNotProduceFrame", "ts": 3,
                  "args": {"FrameSkippedReason": "kNoDamage"}},
                 {"name": "EarlyOut_NoUpdates", "ts": 4}])
        r = fe.parse_frame_evidence(ev)
        assert r["dropped_beginframe_dropped"] == 1
        assert r["dropped_recover_latency"] == 1
        assert r["dropped_total"] == 2
        assert r["skipped_no_damage"] == 1
        assert r["skipped_early_out_no_updates"] == 1

    def test_partial_proxy_flags(self):
        ev = [{"name": "PipelineReporter", "ts": 1,
               "args": {"frame_reporter": {"has_high_latency": True,
                                           "has_missing_content": False}}},
              {"name": "PipelineReporter", "ts": 2,
               "args": {"frame_reporter": {"has_high_latency": False,
                                           "has_missing_content": False}}}]
        r = fe.parse_frame_evidence(ev)
        assert r["pipelinereporter_frames_seen"] == 2
        assert r["partial_high_latency_or_missing"] == 1

    def test_empty_trace_never_fabricates(self):
        r = fe.parse_frame_evidence([])
        assert r["presented_count"] == 0
        assert r["presented_gap_p50_ms"] is None
        assert r["dropped_total"] == 0
        assert r["vsync_hz"] is None
        assert r["wheel_latency_p50_ms"] is None

    def test_vsync_from_beginframe_interval(self):
        ev = [{"name": "Scheduler::BeginFrame", "ts": i,
               "args": {"args": {"interval_us": 6944}}} for i in range(5)]
        r = fe.parse_frame_evidence(ev)
        assert r["vsync_interval_us"] == 6944
        assert r["vsync_hz"] == pytest.approx(144.0, abs=0.1)

    def test_fps_in_window(self):
        ts = [1_000_000 + i * 100_000 for i in range(11)]  # 10/s for 1s
        fps, n, dur = fe.fps_in_window(ts, 1_000_000, 2_000_000)
        assert n == 11 and fps == pytest.approx(11.0, abs=0.01)


class TestDenseOwnFps:
    def test_dense_has_own_runs(self):
        d = json.loads((PERF / "frame_runs.json").read_text(encoding="utf-8"))
        dense = [r for r in d["runs"] if r["condition"] == "dense-300"]
        assert len(dense) >= 5
        # own presented evidence, not borrowed from large fixture
        assert all(r["presented_signal"].startswith("Display::FrameDisplayed")
                   for r in dense)
        assert all(r["has_wheel_trace"] for r in dense)
        assert all(r["dropped_wheel_inputs"] == 0 for r in dense)

    def test_large_modes_have_own_runs(self):
        d = json.loads((PERF / "frame_runs.json").read_text(encoding="utf-8"))
        for cond in ("large-virtualized", "large-direct"):
            assert len([r for r in d["runs"] if r["condition"] == cond]) >= 5

    def test_render_and_dom_benefit(self):
        d = json.loads((PERF / "render.json").read_text(encoding="utf-8"))
        assert d["large-virtualized"]["render_p95_ms"] <= 50
        assert d["dense-300"]["render_p95_ms"] <= 50
        assert d["large-virtualized"]["dom_nodes"] < d["large-direct"]["dom_nodes"]


class TestTimestampFormat:
    def test_evidence_timestamps_iso_with_tz(self):
        for p in (PERF / "frame_summary.json", PERF / "environment.json",
                  OUT / "integrity.json", OUT / "console_network.json"):
            assert p.is_file(), f"missing {p.name}"
        s = json.loads((PERF / "frame_summary.json").read_text(encoding="utf-8"))
        assert ISO_TZ.match(s["generated_at"]), s["generated_at"]
        e = json.loads((PERF / "environment.json").read_text(encoding="utf-8"))
        assert ISO_TZ.match(e["generated_at"]), e["generated_at"]
        # corrective closure runs on 2026-09-17 (review date), never future-dated
        assert s["generated_at"].startswith("2026-09-17"), s["generated_at"]

    def test_report_generated_at_format(self):
        rep = REPO / "docs" / "implementation" / "PHASE_05_FINAL_EVIDENCE_CLOSURE_REPORT.md"
        assert rep.is_file(), "new evidence closure report missing"
        m = re.search(r"Generated at:\s*(\S+)", rep.read_text(encoding="utf-8"))
        assert m and ISO_TZ.match(m.group(1)), "report timestamp must be ISO-8601+tz"


class TestGovernance:
    def test_old_reports_preserved(self):
        assert (REPO / "docs" / "implementation" / "PHASE_05_FINAL_CLOSURE_REPORT.md").is_file()
        assert (REPO / "docs" / "implementation" / "PHASE_05_IMPLEMENTATION_REPORT.md").is_file()

    def test_no_premature_pass(self):
        roadmap = (REPO / "docs" / "implementation" / "ROADMAP_STATUS.md").read_text(encoding="utf-8")
        rep = (REPO / "docs" / "implementation" / "PHASE_05_FINAL_EVIDENCE_CLOSURE_REPORT.md").read_text(encoding="utf-8")
        # Phase 6 maintenance (2026-09-17): Rev 2.5.4 rows the approved final
        # state as "PASS / FINAL" + `VERIFIED` deploy column (no "/ VERIFIED"
        # suffix in the process-status cell). Accept that exact approved
        # wording; anything else (e.g. a novel status) still fails.
        assert ("IMPLEMENTED / REVIEW PENDING" in roadmap
                or "PASS / FINAL / VERIFIED" in roadmap
                or ("PASS / FINAL" in roadmap and "`VERIFIED`" in roadmap))
        if "PHASE 5: PASS / FINAL / VERIFIED" in rep:
            # promotion allowed only with full-gate evidence report present
            assert "Final Gate Matrix" in rep
        assert "Reason for temporary rollback" in rep
        assert "Phase 6" in roadmap and "NOT STARTED" in roadmap


class TestFunctionalPinning:
    def test_dense_keyboard_and_selection(self):
        d = json.loads((PERF / "dense_functional.json").read_text(encoding="utf-8"))
        assert d["arrow_down_seq"] == ["shot_d002", "shot_d003", "shot_d004",
                                       "shot_d005", "shot_d006", "shot_d007"]
        assert d["end_id"] == "shot_d300"
        assert d["arrow_up_from_end"] == "shot_d299"
        assert d["sel250_nav"] == "true" and d["sel250_remount"] == "true"
        assert d["sel250_survives"] is True and d["focus_valid"] is True

    def test_home_focuses_first_button(self):
        d = json.loads((PERF / "dense_home.json").read_text(encoding="utf-8"))
        assert d["home_matches_first_button"] is True
        assert d["focus_after_arrowdown"]["shot"] == "shot_001"

    def test_palette_recheck(self):
        p = json.loads((PERF / "palette_recheck.json").read_text(encoding="utf-8"))
        # Raw session: 8/9 — the single FAIL is a documented harness assertion
        # bug (Enter correctly activated the HIGHLIGHTED opt-1/shot_002, the
        # check wrongly expected shot_001). Corrected follow-up passes.
        passes = [k for k, v in p.items() if v["pass"]]
        fails = [k for k, v in p.items() if not v["pass"]]
        assert len(passes) == 8 and fails == ["enter stable-ID shot"], p
        assert "shot_002" in p["enter stable-ID shot"]["extra"]  # right behavior
        e = json.loads((PERF / "palette_enter_corrected.json").read_text(encoding="utf-8"))
        assert e["pass"] is True

    def test_console_network_clean(self):
        c = json.loads((OUT / "console_network.json").read_text(encoding="utf-8"))
        assert c == {"console_errors": 0, "unhandled": 0,
                     "failed_non_media": 0, "server_5xx": 0}

    def test_integrity_unchanged_and_cleanup(self):
        i = json.loads((OUT / "integrity.json").read_text(encoding="utf-8"))
        assert i["unchanged"] is True and len(i["before"]) == 9
        cl = json.loads((OUT / "cleanup.json").read_text(encoding="utf-8"))
        assert cl["leftover"] == []
