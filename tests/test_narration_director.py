"""
Phase 9 Narration Director — core, validator, persistence, lifecycle tests.
Offline, deterministic, stdlib-only. No GPU, no server.
"""

import json
import shutil
import tempfile
import unittest
from pathlib import Path

import sys
BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from studio import narration_director as nd

SCRIPT = (
    "For years, researchers believed early humans were efficient hunters.\n\n"
    "But the fossil record tells another story.\n\n"
    "Some bones contain tooth marks from large predators.\n\n"
    "Early humans were not always the hunters.\n\n"
    "Sometimes, they were prey."
)


class TestNarrationCore(unittest.TestCase):
    def test_01_script_byte_identical(self):
        raw = SCRIPT
        p = nd.analyze_script(raw)
        joined = " ".join(b["text"] for b in p["beats"])
        self.assertEqual(nd._norm(joined), nd._norm(raw))

    def test_02_role_enum_strict(self):
        p = nd.analyze_script(SCRIPT)
        self.assertTrue(p["beats"])
        for b in p["beats"]:
            self.assertIn(b["role"], nd.NARRATIVE_ROLES)

    def test_03_style_enum_strict(self):
        p = nd.analyze_script(SCRIPT)
        for b in p["beats"]:
            self.assertIn(b["style"], nd.NARRATION_STYLES)

    def test_04_bounds(self):
        p = nd.analyze_script(SCRIPT)
        for b in p["beats"]:
            self.assertGreaterEqual(b["intensity"], 0.0)
            self.assertLessEqual(b["intensity"], 1.0)
            self.assertGreaterEqual(b["confidence"], 0.0)
            self.assertLessEqual(b["confidence"], 1.0)
            self.assertGreaterEqual(b["rate"], nd.RATE_MIN - 0.001)
            self.assertLessEqual(b["rate"], nd.RATE_MAX + 0.001)
            self.assertGreaterEqual(b["pauseBefore"], 0.0)
            self.assertGreaterEqual(b["pauseAfter"], 0.0)
            self.assertLessEqual(b["pauseBefore"], nd.PAUSE_BEFORE_MAX + 0.001)
            self.assertLessEqual(b["pauseAfter"], nd.PAUSE_AFTER_MAX + 0.001)

    def test_05_emphasis_in_source(self):
        p = nd.analyze_script(SCRIPT)
        low = nd._norm(SCRIPT).lower()
        for b in p["beats"]:
            for e in b["emphasis"]:
                self.assertIn(e.lower(), low)

    def test_06_reason_evidence_present(self):
        p = nd.analyze_script(SCRIPT)
        for b in p["beats"]:
            self.assertTrue(b["reason"])
            if b["style"] in nd.STRONG_STYLES:
                self.assertTrue(b["evidence"])

    def test_07_reuse_same_hash(self):
        d = Path(tempfile.mkdtemp(prefix="nd_reuse_"))
        try:
            p = nd.analyze_script(SCRIPT)
            nd.save_plan(d, p)
            self.assertEqual(nd.plan_status(d, SCRIPT), "READY")
            # identical script reuses (no re-analysis needed)
            self.assertEqual(nd.plan_status(d, SCRIPT + ""), "READY")
        finally:
            shutil.rmtree(d, ignore_errors=True)

    def test_08_script_change_outdated(self):
        d = Path(tempfile.mkdtemp(prefix="nd_old_"))
        try:
            nd.save_plan(d, nd.analyze_script(SCRIPT))
            self.assertEqual(nd.plan_status(d, SCRIPT + " Extra."), "OUTDATED")
            self.assertEqual(nd.plan_status(d, ""), "OUTDATED")
        finally:
            shutil.rmtree(d, ignore_errors=True)

    def test_09_empty_no_plan(self):
        d = Path(tempfile.mkdtemp(prefix="nd_empty_"))
        try:
            self.assertEqual(nd.plan_status(d, SCRIPT), "EMPTY")
        finally:
            shutil.rmtree(d, ignore_errors=True)

    def test_10_manual_edits_persist(self):
        d = Path(tempfile.mkdtemp(prefix="nd_man_"))
        try:
            p = nd.analyze_script(SCRIPT)
            nd.save_plan(d, p)
            bid = p["beats"][0]["beatId"]
            nd.update_beat(p, bid, {"style": "SOMBER", "intensity": 0.5})
            nd.save_plan(d, p)
            back = nd.load_plan(d)
            b0 = next(b for b in back["beats"] if b["beatId"] == bid)
            self.assertEqual(b0["style"], "SOMBER")
            self.assertTrue(b0["manualEdited"])
        finally:
            shutil.rmtree(d, ignore_errors=True)

    def test_11_manual_edit_validation(self):
        d = Path(tempfile.mkdtemp(prefix="nd_manv_"))
        try:
            p = nd.analyze_script(SCRIPT)
            with self.assertRaises(ValueError):
                nd.update_beat(p, p["beats"][0]["beatId"], {"style": "SUPER_DRAMATIC"})
            with self.assertRaises(ValueError):
                nd.update_beat(p, p["beats"][0]["beatId"], {"intensity": 9.0})
            with self.assertRaises(KeyError):
                nd.update_beat(p, "beat_999", {"style": "NEUTRAL"})
        finally:
            shutil.rmtree(d, ignore_errors=True)

    def test_12_low_confidence_conservative(self):
        p = nd.analyze_script("Um. Well. Hmm, stuff happened somehow.")
        for b in p["beats"]:
            if b["confidence"] < 0.5:
                self.assertIn(b["style"], ("NEUTRAL", "AUTHORITATIVE"))

    def test_13_strong_weak_evidence_review(self):
        plan = {"beats": [{
            "beatId": "beat_001", "sentenceIds": ["sentence_001"],
            "text": "It was a day.", "role": "EXPLANATION", "style": "OMINOUS",
            "intensity": 0.85, "confidence": 0.51, "rate": 0.9,
            "pauseBefore": 0.1, "pauseAfter": 0.3, "emphasis": ["day"],
            "reason": "weak", "evidence": [], "manualEdited": False}]}
        res = nd.validate_plan(plan, "It was a day.")
        self.assertEqual(res["status"], "REVIEW")
        self.assertTrue(any("evidence" in i for i in res["issues"]))

    def test_14_overacting_detection(self):
        beats = []
        for i in range(10):
            beats.append({
                "beatId": f"beat_{i:03d}", "sentenceIds": [f"sentence_{i:03d}"],
                "text": f"Terrible doom scanning predator death {i}.",
                "role": "THREAT",
                "style": ["OMINOUS", "REVEAL", "TENSE", "URGENT", "SOMBER"][i % 5],
                "intensity": 0.85, "confidence": 0.9, "rate": 0.9,
                "pauseBefore": 0.4, "pauseAfter": 1.1, "emphasis": ["doom"],
                "reason": "r", "evidence": ["doom"], "manualEdited": False})
        script = " ".join(b["text"] for b in beats)
        res = nd.validate_plan({"beats": beats}, script)
        self.assertEqual(res["status"], "REVIEW")
        joined = " ".join(res["issues"])
        self.assertIn("strong beats", joined)
        self.assertIn("switching", joined)
        self.assertIn("intensity", joined)

    def test_15_pause_density_and_oscillation(self):
        beats = []
        for i in range(6):
            beats.append({
                "beatId": f"beat_{i:03d}", "sentenceIds": [f"sentence_{i:03d}"],
                "text": f"Steady factual sentence number {i} here.",
                "role": "EXPLANATION",
                "style": "NEUTRAL" if i % 2 == 0 else "AUTHORITATIVE",
                "intensity": 0.3, "confidence": 0.8,
                "rate": 1.15 if i % 2 == 0 else 0.85,
                "pauseBefore": 0.1, "pauseAfter": 1.1, "emphasis": [],
                "reason": "r", "evidence": ["Steady"], "manualEdited": False})
        script = " ".join(b["text"] for b in beats)
        res = nd.validate_plan({"beats": beats}, script)
        joined = " ".join(res["issues"])
        self.assertIn("pause density", joined)
        self.assertIn("oscillation", joined)

    def test_16_excessive_reveal(self):
        beats = []
        for i in range(6):
            beats.append({
                "beatId": f"beat_{i:03d}", "sentenceIds": [f"sentence_{i:03d}"],
                "text": f"But twist number {i} changes everything.",
                "role": "REVEAL", "style": "REVEAL",
                "intensity": 0.5, "confidence": 0.8, "rate": 0.9,
                "pauseBefore": 0.2, "pauseAfter": 0.4, "emphasis": ["twist"],
                "reason": "r", "evidence": ["But"], "manualEdited": False})
        res = nd.validate_plan({"beats": beats}, " ".join(b["text"] for b in beats))
        self.assertTrue(any("REVEAL" in i for i in res["issues"]))

    def test_17_style_continuity_clean_plan(self):
        p = nd.analyze_script(SCRIPT)
        res = nd.validate_plan(p, SCRIPT)
        self.assertIn(res["status"], ("READY", "REVIEW"))

    def test_18_fingerprint_deterministic(self):
        p1 = nd.analyze_script(SCRIPT)
        p2 = nd.analyze_script(SCRIPT)
        f1 = [b["fingerprint"] for b in p1["beats"]]
        f2 = [b["fingerprint"] for b in p2["beats"]]
        self.assertEqual(f1, f2)
        self.assertEqual(len(set(f1)), len(f1))

    def test_19_no_pathological_fragmentation(self):
        p = nd.analyze_script(SCRIPT)
        stats = nd.beat_stats(p, SCRIPT)
        self.assertGreater(stats["avg_words_per_beat"], 4.0)
        # every beat maps to real sentences
        for b in p["beats"]:
            self.assertTrue(b["sentenceIds"])
            self.assertGreaterEqual(len(b["text"].split()), 2)

    def test_20_determinism(self):
        p1 = nd.analyze_script(SCRIPT)
        p2 = nd.analyze_script(SCRIPT)
        strip = lambda p: [{k: b[k] for k in
                            ("beatId", "sentenceIds", "text", "role", "style",
                             "intensity", "confidence", "rate", "pauseBefore",
                             "pauseAfter", "emphasis")} for b in p["beats"]]
        self.assertEqual(strip(p1), strip(p2))

    def test_21_semantic_beats_not_sentence_only(self):
        script = ("The valley was quiet. Birds circled far above. Wind moved the grass. "
                  "Nothing had changed in a thousand years.")
        p = nd.analyze_script("\n\n".join([script]))
        # 4 calm sentences should group into fewer than 4 beats
        self.assertLess(len(p["beats"]), 4)

    def test_22_context_window_matters(self):
        a = nd.analyze_script("Sometimes, they were prey.")
        solo_role = a["beats"][0]["role"]
        b = nd.analyze_script(
            "Early humans were not always the hunters.\n\nSometimes, they were prey.")
        second = [x for x in b["beats"] if "prey" in x["text"]][0]
        # with threatening contrast context, role must not be flat EXPLANATION
        self.assertNotEqual(
            (solo_role, second["role"]), ("EXPLANATION", "EXPLANATION"))
        self.assertIn(second["role"], ("REVEAL", "THREAT"))


if __name__ == "__main__":
    unittest.main()
