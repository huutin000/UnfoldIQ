"""Phase 12 — Script Editorial QA + Protected Facts tests (§54)."""

import json
import shutil
import tempfile
import unittest
from pathlib import Path

import sys
BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from studio import editorial_qa as edq


def write_script(p: Path, text: str) -> Path:
    p.mkdir(parents=True, exist_ok=True)
    (p / "script.txt").write_text(text, encoding="utf-8")
    return p


class TestEditorialDetection(unittest.TestCase):
    def test_short_sentence_run(self):
        issues = edq.detect_issues("It ran. It hid. It survived. The long expedition continued for many more days across the valley.")
        self.assertTrue(any(i["type"] == "SHORT_SENTENCE_RUN" for i in issues))

    def test_no_run_for_varied_prose(self):
        text = ("The expedition continued across the wide valley for many days without pause. "
                "Supplies dwindled slowly as the river bent eastward toward the distant hills.")
        self.assertFalse(any(i["type"] == "SHORT_SENTENCE_RUN" for i in edq.detect_issues(text)))

    def test_fragment_overuse(self):
        text = "Darkness. Silence. A whisper. Then the long caravan resumed its steady march eastward."
        self.assertTrue(any(i["type"] == "FRAGMENT_OVERUSE" for i in edq.detect_issues(text)))

    def test_not_x_not_y(self):
        text = "Not strength. Not speed. Cooperation carried them through the harsh winter season."
        self.assertTrue(any(i["type"] == "NOT_X_NOT_Y" for i in edq.detect_issues(text)))

    def test_not_x_but_y_repetition(self):
        text = ("It was not strength, but endurance that mattered most that day. "
                "It was not luck, but preparation that saved them in the end.")
        self.assertTrue(any(i["type"] == "NOT_X_BUT_Y" for i in edq.detect_issues(text)))

    def test_starter_repetition(self):
        text = ("But the river was wide. The group camped early that evening. "
                "But the storm arrived. The fire held through the night regardless. "
                "But the ford was dangerous.")
        self.assertTrue(any(i["type"] == "REPEATED_TRANSITION_STARTER" for i in edq.detect_issues(text)))

    def test_single_starter_not_an_issue(self):
        text = ("But the river was wide and the crossing took the whole morning to complete safely. "
                "The group camped early that evening beside the cottonwood trees near the water.")
        self.assertFalse(any(i["type"] == "REPEATED_TRANSITION_STARTER" and i["severity"] == "REVIEW"
                             for i in edq.detect_issues(text)))

    def test_rhetorical_questions(self):
        text = ("What saved them? Who carried the fire? Why did they endure? "
                "The answers emerged slowly over the following season.")
        self.assertTrue(any(i["type"] == "RHETORICAL_QUESTION_OVERUSE" for i in edq.detect_issues(text)))

    def test_think_about_and_now_imagine(self):
        text = ("Think about what that changes for the group today. "
                "The evidence keeps accumulating every single season now. "
                "Think about the children too. Now imagine the river rising. "
                "Now imagine the crossing at dawn.")
        types = {i["type"] for i in edq.detect_issues(text)}
        self.assertIn("THINK_ABOUT_REPEAT", types)
        self.assertIn("NOW_IMAGINE_REPEAT", types)

    def test_long_sentence(self):
        text = ("The expedition, which had departed before the first thaw with limited supplies "
                "and only a vague map of the northern passes, continued steadily onward despite "
                "the growing exhaustion of both people and animals.")
        self.assertTrue(any(i["type"] == "TTS_LONG_SENTENCE" for i in edq.detect_issues(text)))

    def test_numbers_dates_species_protection(self):
        text = "In 1998, researchers counted 1,701 dyads of Homo habilis near Olduvai Gorge (about 1.8 Mya)."
        spans = edq.auto_detect_protected_spans(text)
        kinds = {s["type"] for s in spans}
        self.assertIn("NUMBER", kinds)
        self.assertIn("SPECIES", kinds)
        self.assertIn("PLACE", kinds)
        self.assertIn("DATE", kinds)
        locked = [s for s in spans if s.get("locked")]
        self.assertTrue(len(locked) >= 4)

    def test_caveat_flag_unlocked(self):
        spans = edq.auto_detect_protected_spans("The analysis suggests they may have cooperated.")
        caves = [s for s in spans if s["type"] == "CAVEAT"]
        self.assertTrue(caves)
        self.assertFalse(any(s["locked"] for s in caves))


class TestSuggestionSafety(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="unfoldiq_test_edq_"))

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_safe_suggestion_applies_transactionally(self):
        p = write_script(self.tmp / "a",
                         "But the river was wide and dangerous. "
                         "But the group crossed anyway. "
                         "The group camped early that evening by the water.")
        rep = edq.analyze_project(p)
        target = next((i for i in rep["issues"]
                       if i["type"] == "REPEATED_TRANSITION_STARTER" and i.get("suggestion")), None)
        self.assertIsNotNone(target, f"expected starter suggestion, got: {rep['issues']}")
        before = (p / "script.txt").read_text(encoding="utf-8")
        res = edq.apply_suggestion(p, target["issueId"])
        self.assertTrue(res["applied"])
        after = (p / "script.txt").read_text(encoding="utf-8")
        self.assertNotEqual(before, after)
        rep2 = edq.load_qa(p)
        self.assertEqual(rep2["scriptHash"], edq.compute_file_sha256(p / "script.txt"))

    def test_blocked_when_protected_fact_changes(self):
        p = write_script(self.tmp / "b", "The count was 1,701 dyads that season.")
        edq.analyze_project(p)
        protection = edq.ensure_protection(p, (p / "script.txt").read_text(encoding="utf-8"))
        locked = [s for s in protection["protectedSpans"] if s.get("locked")]
        self.assertTrue(locked)
        s = locked[0]
        script = (p / "script.txt").read_text(encoding="utf-8")
        evil = "9,999"
        safe, conflicts = edq.check_edit_safety(script, s["startOffset"], s["endOffset"],
                                                evil, protection["protectedSpans"])
        self.assertFalse(safe)
        self.assertTrue(conflicts)

    def test_apply_rejects_stale_script(self):
        p = write_script(self.tmp / "c",
                         "But the river was wide and dangerous. "
                         "But the group crossed anyway.")
        rep = edq.analyze_project(p)
        target = next((i for i in rep["issues"] if i.get("suggestion")), None)
        self.assertIsNotNone(target)
        with open(p / "script.txt", "a", encoding="utf-8") as f:
            f.write(" Extra.")
        with self.assertRaises(ValueError):
            edq.apply_suggestion(p, target["issueId"])

    def test_ignore_persists(self):
        p = write_script(self.tmp / "d", "Darkness. Silence. A whisper. Then the march resumed eastward.")
        rep = edq.analyze_project(p)
        self.assertTrue(rep["issues"])
        iid = rep["issues"][0]["issueId"]
        res = edq.ignore_issue(p, iid)
        self.assertTrue(res["ignored"])
        rep2 = edq.load_qa(p)
        self.assertEqual(next(i for i in rep2["issues"] if i["issueId"] == iid)["status"], "IGNORED")

    def test_manual_lock_blocks(self):
        p = write_script(self.tmp / "e", "The leader spoke at dawn.")
        edq.analyze_project(p)
        script = (p / "script.txt").read_text(encoding="utf-8")
        start = script.index("dawn")
        payload = edq.lock_span(p, "EVIDENCE_ANCHOR", start, start + 4)
        self.assertTrue(any(s["source"] == "MANUAL" and s["locked"] for s in payload["protectedSpans"]))
        safe, conflicts = edq.check_edit_safety(script, start, start + 4, "dusk",
                                                payload["protectedSpans"])
        self.assertFalse(safe)

    def test_tampered_suggestion_blocked_end_to_end(self):
        p = write_script(self.tmp / "f",
                         "But the count was 1,701 dyads. But the tally held firm.")
        rep = edq.analyze_project(p)
        target = next((i for i in rep["issues"] if i.get("suggestion")), None)
        self.assertIsNotNone(target)
        # Tamper the stored suggestion so it alters a locked number.
        qa = edq.load_qa(p)
        evil = qa["issues"][0]
        evil["suggestion"] = "The count was 9,999 dyads that season."
        evil["startOffset"] = 0
        evil["endOffset"] = len((p / "script.txt").read_text(encoding="utf-8"))
        edq._save_qa(p, qa)
        before = (p / "script.txt").read_text(encoding="utf-8")
        with self.assertRaises(ValueError) as ctx:
            edq.apply_suggestion(p, evil["issueId"])
        self.assertIn("BLOCKED", str(ctx.exception))
        self.assertEqual(before, (p / "script.txt").read_text(encoding="utf-8"))

    def test_missing_script_raises(self):
        p = self.tmp / "empty"
        p.mkdir()
        with self.assertRaises(FileNotFoundError):
            edq.analyze_project(p)


if __name__ == "__main__":
    unittest.main()
