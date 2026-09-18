"""Phase 5 micro-closure focused tests (§20).

- UQVirtualList pure-logic unit tests executed with real Node.js
  (computeWindow / windowForOffsets / layoutOffsets).
- Dense-fixture generator contract: stable IDs, counts, referential integrity.
- Evidence pinning: headed FPS + dense behavior JSONs meet the gates
  (fails if evidence is missing or regresses).
"""
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
NODE = r"D:\Downloads\NodeJS\node.exe"
CLOSURE_PERF = REPO / "temp" / "phase05_final_closure" / "performance"

NODE_PREAMBLE = """
const fs = require('fs');
const src = fs.readFileSync(%s, 'utf-8');
const window = {};
eval(src);
const UQ = window.UQVirtualList;
let failures = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { console.error('FAIL ' + name + ': got ' + a + ' want ' + e); failures++; }
  else { console.log('ok ' + name); }
}
"""


def run_node_checks(checks: str) -> None:
    lib = (REPO / "studio" / "static" / "uq-virtual-list.js").as_posix()
    script = (NODE_PREAMBLE % json.dumps(lib)) + checks
    script += "\nprocess.exit(failures ? 1 : 0);\n"
    r = subprocess.run([NODE, "-e", script], capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, f"node unit checks failed:\n{r.stdout}\n{r.stderr}"


class TestVirtualListLogic:
    def test_compute_window_basic(self):
        run_node_checks(
            "eq(UQ.computeWindow(100, 0, 600, 40, 6), {start:0,end:21}, 'top');\n"
            "eq(UQ.computeWindow(0, 0, 600, 40, 6), {start:0,end:0}, 'empty');\n"
            "const w = UQ.computeWindow(579, 21510, 600, 38, 6);\n"
            "eq(w.end - w.start <= 40, true, 'bounded');\n"
            "eq(w.start >= 0 && w.end <= 579, true, 'clamped');\n")

    def test_layout_offsets_exact(self):
        run_node_checks(
            "const L = UQ.layoutOffsets([0,3,0], 40, 27, 8);\n"
            "eq(L.offsets, [0,40,169], 'offsets');\n"
            "eq(L.totalH, 209, 'total');\n")

    def test_window_for_offsets(self):
        run_node_checks(
            "const L = UQ.layoutOffsets([0,3,0], 40, 27, 8);\n"
            "const w = UQ.windowForOffsets(L.offsets, L.totalH, 0, 100, 300);\n"
            "eq(w, {start:0,end:3}, 'all visible');\n"
            "const w2 = UQ.windowForOffsets(L.offsets, L.totalH, 500, 100, 0);\n"
            "eq(w2, {start:2,end:3}, 'scrolled past');\n")

    def test_threshold_is_evidence_backed(self):
        src = (REPO / "studio" / "static" / "uq-virtual-list.js").read_text(encoding="utf-8")
        m = re.search(r"THRESHOLD_GROUPS\s*=\s*(\d+)", src)
        assert m and int(m.group(1)) == 200


class TestDenseFixture:
    @pytest.fixture()
    def dense(self, tmp_path):
        name = "_p5c_dense300"
        dst = REPO / "projects" / name
        shutil.rmtree(dst, ignore_errors=True)
        r = subprocess.run(["python", "scripts/make_dense_fixture.py", name, "300"],
                           cwd=REPO, capture_output=True, text=True, timeout=300)
        assert r.returncode == 0, r.stderr[-2000:]
        yield dst
        shutil.rmtree(dst, ignore_errors=True)

    def test_dense_fixture_counts_and_ids(self, dense):
        veo = json.loads((dense / "veo_prompts.json").read_text(encoding="utf-8"))
        shots = [s for s in veo["shots"] if s.get("parent_scene_id") == "scene_900"]
        assert len(shots) >= 250
        ids = [s["shot_id"] for s in shots]
        assert len(set(ids)) == len(ids), "duplicate shot_ids"
        assert all(re.fullmatch(r"shot_d\d{3}", i) for i in ids)
        sp = json.loads((dense / "scene_plan.json").read_text(encoding="utf-8"))
        assert any(s["scene_id"] == "scene_900" for s in sp["scenes"])
        img = json.loads((dense / "image_prompts.json").read_text(encoding="utf-8"))
        assert any(s["scene_id"] == "scene_900" for s in img["scenes"])

    def test_dense_shots_have_valid_timing(self, dense):
        veo = json.loads((dense / "veo_prompts.json").read_text(encoding="utf-8"))
        for s in veo["shots"]:
            if s.get("parent_scene_id") != "scene_900":
                continue
            assert s["end"] > s["start"] >= 0
            assert s["scene_id"] == "scene_900"


class TestClosureEvidence:
    def _load(self, name):
        p = CLOSURE_PERF / name
        assert p.is_file(), f"missing closure evidence: {name}"
        return json.loads(p.read_text(encoding="utf-8"))

    def test_headed_fps_meets_gate(self):
        d = self._load("headed_scroll_runs.json")
        for mode in ("virtualized", "forced-direct"):
            runs = [r for r in d["runs"] if r["mode"] == mode and r.get("valid")]
            assert len(runs) >= 5, f"need >=5 valid runs for {mode}"
            fps = sorted(r["raf_fps"] for r in runs)
            median = fps[len(fps) // 2]
            assert median >= 55, f"{mode} median FPS {median} < 55"
            assert min(fps) >= 55, f"{mode} min FPS {min(fps)} < 55"
            assert sum(r["long_over_50ms"] for r in runs) == 0

    def test_headed_modes_parity(self):
        d = self._load("headed_scroll_runs.json")
        med = {}
        for mode in ("virtualized", "forced-direct"):
            fps = sorted(r["raf_fps"] for r in d["runs"]
                         if r["mode"] == mode and r.get("valid"))
            med[mode] = fps[len(fps) // 2]
        assert abs(med["virtualized"] - med["forced-direct"]) <= 10, med

    def test_dense_behavior_evidence(self):
        d = self._load("dense_behavior.json")
        assert d["render_p95_ms"] <= 50, d
        assert d["arrow_seq"] == ["shot_d002", "shot_d003", "shot_d004",
                                 "shot_d005", "shot_d006", "shot_d007"], d
        assert d["sel250_nav"] == "true" and d["sel250_remount"] == "true"
        assert d["sel250_survives"] is True and d["focus_valid"] is True
