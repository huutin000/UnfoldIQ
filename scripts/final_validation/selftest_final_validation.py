"""Final-Gate harness self-tests (Task 2, step 1).

Plain assertions, stdlib unittest only. Named ``selftest_*`` (NOT ``test_*``)
so canonical G01 pytest discovery (``tests/test_*.py``) is unaffected.
Run: ``py -3 scripts/final_validation/selftest_final_validation.py``
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import (  # noqa: E402
    FAILURE_KINDS,
    GateResult,
    GateStatus,
    allocate_blocker_id,
    assert_within,
    inventory_tree,
    reduce_candidate_verdict,
    sha256_file,
    should_retry_infra,
    write_gate_result,
    write_json_create_only,
)


class TestPathContainment(unittest.TestCase):
    def test_inside_ok(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            p = assert_within(root, root / "sub" / "result.json")
            self.assertEqual(p, (root / "sub" / "result.json").resolve())

    def test_escape_refused(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            with self.assertRaises(ValueError):
                assert_within(root, root / ".." / "escape.json")
            with self.assertRaises(ValueError):
                assert_within(root, Path(r"C:\Windows\Temp\x.json"))


class TestHashing(unittest.TestCase):
    def test_sha256_known(self):
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "a.bin"
            p.write_bytes(b"abc")
            self.assertEqual(
                sha256_file(p),
                "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            )


class TestInventory(unittest.TestCase):
    def test_deterministic(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / "b.txt").write_bytes(b"2")
            (root / "a.txt").write_bytes(b"1")
            (root / "sub").mkdir()
            (root / "sub" / "c.txt").write_bytes(b"3")
            inv1 = inventory_tree(root)
            inv2 = inventory_tree(root)
            self.assertEqual(inv1, inv2)
            keys = [e["rel"] for e in inv1["files"]]
            self.assertEqual(keys, sorted(keys))
            self.assertEqual(inv1["count"], 3)


class TestCreateOnly(unittest.TestCase):
    def test_append_only(self):
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "result.json"
            write_json_create_only(p, {"gate": "G01"})
            with self.assertRaises(FileExistsError):
                write_json_create_only(p, {"gate": "G01", "forged": True})
            self.assertEqual(json.loads(p.read_text()), {"gate": "G01"})


class TestGateResultSchema(unittest.TestCase):
    def test_valid_statuses(self):
        for s in ("PASS", "FAIL", "NOT RUN"):
            r = GateResult(gate="G01", name="n", status=GateStatus(s), hard_blocker=True)
            d = write_gate_result(Path(tempfile.mkdtemp()), r)
            self.assertEqual(d["status"], s)

    def test_bad_status_rejected(self):
        with self.assertRaises(ValueError):
            GateStatus("GREEN")

    def test_failure_taxonomy(self):
        self.assertIn("FG_PRODUCT_FAILURE", FAILURE_KINDS)
        self.assertIn("FG_TEST_INFRA_FAILURE", FAILURE_KINDS)
        self.assertEqual(len(FAILURE_KINDS), 6)
        r = GateResult(gate="G12", name="n", status=GateStatus.FAIL,
                       hard_blocker=True, failure_kind="FG_PRODUCT_FAILURE")
        self.assertEqual(r.failure_kind, "FG_PRODUCT_FAILURE")
        with self.assertRaises(ValueError):
            GateResult(gate="G12", name="n", status=GateStatus.FAIL,
                       hard_blocker=True, failure_kind="FG_MADE_UP")


class TestBlockerIds(unittest.TestCase):
    def test_sequential(self):
        self.assertEqual(allocate_blocker_id([]), "FG-001")
        self.assertEqual(
            allocate_blocker_id([{"id": "FG-001"}, {"id": "FG-002"}]), "FG-003")
        self.assertEqual(allocate_blocker_id([{"id": "FG-007"}]), "FG-008")


class TestRetryPolicy(unittest.TestCase):
    def test_single_retry_only(self):
        self.assertTrue(should_retry_infra(attempt=0, product_failure=False))
        self.assertFalse(should_retry_infra(attempt=1, product_failure=False))
        self.assertFalse(should_retry_infra(attempt=0, product_failure=True))


class TestVerdictReduction(unittest.TestCase):
    def _r(self, gate, status, hard=True):
        return GateResult(gate=gate, name=gate, status=GateStatus(status),
                          hard_blocker=hard)

    def test_all_pass_ready(self):
        rs = [self._r(f"G{i:02d}", "PASS") for i in range(1, 14)]
        self.assertEqual(reduce_candidate_verdict(rs), "PRODUCTION READY")

    def test_core_fail_not_ready(self):
        rs = [self._r(f"G{i:02d}", "PASS") for i in range(1, 14)]
        rs[11] = self._r("G12", "FAIL")
        self.assertEqual(reduce_candidate_verdict(rs), "NOT READY")

    def test_mandatory_not_run_not_ready(self):
        rs = [self._r(f"G{i:02d}", "PASS") for i in range(1, 14)]
        rs[0] = self._r("G01", "NOT RUN")
        self.assertEqual(reduce_candidate_verdict(rs), "NOT READY")

    def test_minor_browser_only_conditional(self):
        rs = [self._r(f"G{i:02d}", "PASS") for i in range(1, 14)]
        rs[7] = self._r("G08", "FAIL", hard=False)
        self.assertEqual(reduce_candidate_verdict(rs), "CONDITIONAL")


class TestBaselineAndCopies(unittest.TestCase):
    def _tree(self, root):
        (root / "script.json").write_text('{"v":1}', encoding="utf-8")
        (root / "assets").mkdir(parents=True, exist_ok=True)
        (root / "assets" / "x.bin").write_bytes(b"data")

    def test_freeze_is_create_once(self):
        from prepare_final_gate import freeze_baseline
        with tempfile.TemporaryDirectory() as td:
            src = Path(td) / "src"
            src.mkdir()
            self._tree(src)
            base = Path(td) / "baseline" / "project"
            meta = {"sourceProjectId": "t", "expectedScenes": 1, "expectedShots": 1}
            freeze_baseline(src, base, meta)
            with self.assertRaises(FileExistsError):
                freeze_baseline(src, base, meta)

    def test_clone_leaves_source_untouched(self):
        from prepare_final_gate import freeze_baseline
        with tempfile.TemporaryDirectory() as td:
            src = Path(td) / "src"
            src.mkdir()
            self._tree(src)
            before = inventory_tree(src)
            freeze_baseline(src, Path(td) / "baseline" / "project", {})
            self.assertEqual(inventory_tree(src), before)

    def test_working_copy_from_baseline_not_source(self):
        from prepare_final_gate import create_working_copy, freeze_baseline
        with tempfile.TemporaryDirectory() as td:
            src = Path(td) / "src"
            src.mkdir()
            self._tree(src)
            base = Path(td) / "baseline" / "project"
            freeze_baseline(src, base, {})
            copies = Path(td) / "working_copies"
            wc = create_working_copy(base, copies, "G03_integrity",
                                       enforce_baseline_root=False)
            (wc / "probe_marker.txt").write_text("x", encoding="utf-8")
            self.assertFalse((base / "probe_marker.txt").exists())
            self.assertFalse((src / "probe_marker.txt").exists())

    def test_working_copy_name_allowlist(self):
        from prepare_final_gate import create_working_copy, freeze_baseline
        with tempfile.TemporaryDirectory() as td:
            src = Path(td) / "src"
            src.mkdir()
            self._tree(src)
            base = Path(td) / "baseline" / "project"
            freeze_baseline(src, base, {})
            with self.assertRaises(ValueError):
                create_working_copy(base, Path(td) / "wc", "G99_nope")

    def test_working_copy_enforces_baseline_root_by_default(self):
        from prepare_final_gate import create_working_copy, freeze_baseline
        with tempfile.TemporaryDirectory() as td:
            src = Path(td) / "src"
            src.mkdir()
            self._tree(src)
            base = Path(td) / "baseline" / "project"
            freeze_baseline(src, base, {})
            with self.assertRaises(ValueError):
                create_working_copy(base, Path(td) / "wc", "G03_integrity")
            with self.assertRaises(ValueError):
                create_working_copy(src, Path(td) / "wc2", "G03_integrity")


class TestFixtureIsolation(unittest.TestCase):
    def test_provision_refuses_baseline(self):
        import fixtures
        with tempfile.TemporaryDirectory() as td:
            with self.assertRaises(ValueError):
                fixtures.provision_shot_media(
                    Path(td), Path(td) / "f.png", [], is_baseline=True)

    def test_provision_provenance(self):
        import fixtures
        with tempfile.TemporaryDirectory() as td:
            proj = Path(td) / "proj"
            proj.mkdir()
            frame = Path(td) / "frame.png"
            fixtures.generate_validation_frame(frame)
            self.assertTrue(frame.is_file())
            got = fixtures.provision_shot_media(
                proj, frame,
                [{"shot_id": "shot_001", "scene_id": "scene_001"}],
                is_baseline=False)
            self.assertEqual(len(got), 1)
            import json as _json
            ledger = _json.loads(
                (proj / "assets" / "intake_ledger.json").read_text(encoding="utf-8"))
            entry = ledger["assets"][0]
            self.assertEqual(entry["provenance"], "VALIDATION_FIXTURE")
            self.assertEqual(entry["provider"], "LOCAL_VALIDATION")
            self.assertEqual(entry["lifecycle"], "APPROVED")
            self.assertEqual(entry["shot_id"], "shot_001")


if __name__ == "__main__":
    unittest.main(verbosity=2)
