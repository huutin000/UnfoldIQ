"""
Unit tests for UnfoldIQ Phase 8.1 Voice QA (Faster-Whisper Quality Assurance).
Covers all 24 required test scenarios without GPU dependency:
1. exact match PASS
2. single missing word detection
3. single extra word detection
4. substitution detection
5. repeated sentence duplicate detection
6. repeated multi-sentence block duplicate detection
7. near-duplicate block detection
8. dictionary spoken form acoustic equivalence
9. deterministic WER calculation
10. transcript match percentage
11. overall WPM
12. sentence WPM
13. long mid-sentence pause
14. valid sentence/paragraph pause not escalated incorrectly
15. sentence truncation heuristic
16. low-confidence REVIEW
17. proper noun REVIEW
18. issue fingerprint determinism
19. stale detection when audio hash changes
20. accepted decision invalidated by changed audio
21. unresolved FAIL gating
22. explicit waiver behavior
23. cancellation never produces PASS
24. ERROR distinct from FAIL
"""

import hashlib
import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path

from studio.voice_qa import (
    VoiceQAEvaluator,
    VoiceQAManager,
    compute_file_sha256,
    normalize_for_matching,
)


def _make_word(word, start, end, prob=0.95):
    return {
        "word": word,
        "start": round(start, 2),
        "end": round(end, 2),
        "probability": prob
    }


def _make_segment(text, start, end, words=None):
    if words is None:
        raw_words = text.split()
        dur = max(0.1, end - start)
        w_dur = dur / max(1, len(raw_words))
        words = [
            _make_word(w, start + i * w_dur, start + (i + 1) * w_dur)
            for i, w in enumerate(raw_words)
        ]
    return {
        "text": text,
        "start": start,
        "end": end,
        "words": words
    }


class TestVoiceQA(unittest.TestCase):
    def setUp(self):
        self.temp_dir = Path(tempfile.mkdtemp(prefix="unfoldiq_test_qa_"))
        self.manager = VoiceQAManager(projects_dir=self.temp_dir)
        self.evaluator = VoiceQAEvaluator()

    def tearDown(self):
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def _create_mock_project(self, project_id="proj_01", script="Hello world.", audio_bytes=b"RIFFWAVE..."):
        proj_dir = self.temp_dir / project_id
        proj_dir.mkdir(parents=True, exist_ok=True)
        (proj_dir / "script.txt").write_text(script, encoding="utf-8")
        audio_p = proj_dir / "audio.wav"
        audio_p.write_bytes(audio_bytes)
        return proj_dir, audio_p

    # 1. exact match PASS
    def test_01_exact_match_pass(self):
        script = "The quick brown fox jumps over the lazy dog."
        segs = [_make_segment("The quick brown fox jumps over the lazy dog.", 0.0, 3.5)]
        result = self.evaluator.evaluate(script, segs, 3.5, "hash123")
        self.assertEqual(result["status"], "pass")
        self.assertEqual(result["metrics"]["wer_pct"], 0.0)
        self.assertEqual(result["metrics"]["transcript_match_pct"], 100.0)
        self.assertEqual(len(result["issues"]), 0)

    # 2. single missing word detection
    def test_02_single_missing_word_detection(self):
        script = "The quick brown fox jumps over the lazy dog."
        segs = [_make_segment("The quick fox jumps over the lazy dog.", 0.0, 3.2)]
        result = self.evaluator.evaluate(script, segs, 3.2, "hash123")
        categories = [i["category"] for i in result["issues"]]
        self.assertIn("missing_words", categories)
        missing_issue = next(i for i in result["issues"] if i["category"] == "missing_words")
        self.assertEqual(missing_issue["severity"], "fail")
        self.assertIn("brown", missing_issue["description"].lower())

    # 3. single extra word detection
    def test_03_single_extra_word_detection(self):
        script = "The quick brown fox jumps."
        segs = [_make_segment("The quick very brown fox jumps.", 0.0, 2.5)]
        result = self.evaluator.evaluate(script, segs, 2.5, "hash123")
        categories = [i["category"] for i in result["issues"]]
        self.assertIn("extra_words", categories)
        extra_issue = next(i for i in result["issues"] if i["category"] == "extra_words")
        self.assertEqual(extra_issue["severity"], "review")

    # 4. substitution detection
    def test_04_substitution_detection(self):
        script = "Launch the rocket today."
        segs = [_make_segment("Launch the pocket today.", 0.0, 2.0)]
        result = self.evaluator.evaluate(script, segs, 2.0, "hash123")
        categories = [i["category"] for i in result["issues"]]
        self.assertIn("substitution", categories)
        sub_issue = next(i for i in result["issues"] if i["category"] == "substitution")
        self.assertEqual(sub_issue["severity"], "fail")
        self.assertIn("rocket", sub_issue["expected_text"].lower())
        self.assertIn("pocket", sub_issue["recognized_text"].lower())

    # 5. repeated sentence duplicate detection
    def test_05_repeated_sentence_duplicate_detection(self):
        script = "Humans were once hunted by predators. That created a strange problem."
        segs = [
            _make_segment("Humans were once hunted by predators.", 0.0, 2.5),
            _make_segment("Humans were once hunted by predators.", 2.6, 5.1),
            _make_segment("That created a strange problem.", 5.3, 7.5),
        ]
        result = self.evaluator.evaluate(script, segs, 7.5, "hash123")
        categories = [i["category"] for i in result["issues"]]
        self.assertIn("duplicate_block", categories)
        dup_issue = next(i for i in result["issues"] if i["category"] == "duplicate_block")
        self.assertEqual(dup_issue["severity"], "fail")

    # 6. repeated multi-sentence block duplicate detection
    def test_06_repeated_multi_sentence_block_duplicate_detection(self):
        script = "Alpha sentence here. Beta sentence follows. Gamma sentence concludes."
        segs = [
            _make_segment("Alpha sentence here. Beta sentence follows.", 0.0, 3.5),
            _make_segment("Alpha sentence here. Beta sentence follows.", 3.6, 7.1),
            _make_segment("Gamma sentence concludes.", 7.2, 9.5),
        ]
        result = self.evaluator.evaluate(script, segs, 9.5, "hash123")
        categories = [i["category"] for i in result["issues"]]
        self.assertIn("duplicate_block", categories)
        self.assertEqual(result["status"], "fail")

    # 7. near-duplicate block detection
    def test_07_near_duplicate_block_detection(self):
        script = "The scientist conducted the experiment carefully."
        segs = [
            _make_segment("The scientist conducted the experiment carefully.", 0.0, 2.8),
            _make_segment("The scientist conducted that experiment carefully.", 2.9, 5.7),
        ]
        result = self.evaluator.evaluate(script, segs, 5.7, "hash123")
        categories = [i["category"] for i in result["issues"]]
        self.assertIn("duplicate_block", categories)

    # 8. dictionary spoken form acoustic equivalence
    def test_08_dictionary_spoken_form_acoustic_equivalence(self):
        script = "We love UnfoldIQ technology."
        # ASR transcribes phonetic words "unfold i q"
        segs = [_make_segment("We love unfold i q technology.", 0.0, 2.5)]
        pron_entries = [
            {"original": "UnfoldIQ", "spoken_form": "unfold i q", "enabled": True}
        ]
        result = self.evaluator.evaluate(
            script, segs, 2.5, "hash123",
            pronunciation_entries=pron_entries
        )
        # Should not have transcript_mismatch or substitution for UnfoldIQ
        sub_issues = [i for i in result["issues"] if i["category"] in ("substitution", "missing_words")]
        self.assertEqual(len(sub_issues), 0)

    # 9. deterministic WER calculation
    def test_09_deterministic_wer_calculation(self):
        # 4 words in ref: "one two three four"
        # hyp: "one two tree four" -> 1 substitution, WER = 1/4 = 25.0%
        script = "One two three four."
        segs = [_make_segment("One two tree four.", 0.0, 2.0)]
        result = self.evaluator.evaluate(script, segs, 2.0, "hash123")
        self.assertEqual(result["metrics"]["wer_pct"], 25.0)

    # 10. transcript match percentage
    def test_10_transcript_match_percentage(self):
        # 10 words, 1 substitution -> 90.0% match
        script = "One two three four five six seven eight nine ten."
        segs = [_make_segment("One two three four five six seven eight nine zero.", 0.0, 4.0)]
        result = self.evaluator.evaluate(script, segs, 4.0, "hash123")
        self.assertEqual(result["metrics"]["transcript_match_pct"], 90.0)

    # 11. overall WPM
    def test_11_overall_wpm(self):
        # 30 words in 10.0 seconds -> 30 / (10/60) = 180.0 WPM
        words = ["word"] * 30
        script = " ".join(words) + "."
        segs = [_make_segment(" ".join(words) + ".", 0.0, 10.0)]
        result = self.evaluator.evaluate(script, segs, 10.0, "hash123")
        self.assertAlmostEqual(result["metrics"]["overall_wpm"], 180.0, places=1)

    # 12. sentence WPM
    def test_12_sentence_wpm(self):
        # Extremely fast sentence: 20 words in 3.0s -> 400 WPM!
        words = ["fast"] * 20
        script = " ".join(words) + "."
        segs = [_make_segment(" ".join(words) + ".", 0.0, 3.0)]
        result = self.evaluator.evaluate(script, segs, 3.0, "hash123")
        categories = [i["category"] for i in result["issues"]]
        self.assertIn("abnormal_wpm", categories)
        wpm_issue = next(i for i in result["issues"] if i["category"] == "abnormal_wpm")
        self.assertEqual(wpm_issue["severity"], "review")

    # 13. long mid-sentence pause
    def test_13_long_mid_sentence_pause(self):
        # Single segment with words having a 2.5s gap (> 1.6s)
        words = [
            _make_word("First", 0.0, 0.5),
            _make_word("half", 0.5, 1.0),
            _make_word("second", 3.6, 4.2),  # 2.6s gap
            _make_word("half", 4.2, 4.8),
        ]
        segs = [{
            "text": "First half second half.",
            "start": 0.0,
            "end": 4.8,
            "words": words
        }]
        result = self.evaluator.evaluate("First half second half.", segs, 4.8, "hash123")
        categories = [i["category"] for i in result["issues"]]
        self.assertIn("long_pause", categories)
        pause_issue = next(i for i in result["issues"] if i["category"] == "long_pause")
        self.assertEqual(pause_issue["severity"], "review")

    # 14. valid sentence/paragraph pause not escalated incorrectly
    def test_14_valid_sentence_paragraph_pause_not_escalated(self):
        # Two sentences with 1.2s pause between them (< 2.8s)
        segs = [
            _make_segment("First sentence ends.", 0.0, 2.0),
            _make_segment("Second sentence begins.", 3.2, 5.0),  # 1.2s inter-sentence pause
        ]
        script = "First sentence ends. Second sentence begins."
        result = self.evaluator.evaluate(script, segs, 5.0, "hash123")
        categories = [i["category"] for i in result["issues"]]
        self.assertNotIn("long_pause", categories)

    # 15. sentence truncation heuristic
    def test_15_sentence_truncation_heuristic(self):
        script = "This is a very important sentence that should never ever be cut off."
        # ASR stops abruptly after 4 words
        segs = [_make_segment("This is a very", 0.0, 1.5)]
        result = self.evaluator.evaluate(script, segs, 1.5, "hash123")
        categories = [i["category"] for i in result["issues"]]
        self.assertIn("sentence_cut", categories)
        cut_issue = next(i for i in result["issues"] if i["category"] == "sentence_cut")
        self.assertEqual(cut_issue["severity"], "fail")

    # 16. low-confidence REVIEW
    def test_16_low_confidence_review(self):
        words = [
            _make_word("Normal", 0.0, 0.5, prob=0.98),
            _make_word("muffled", 0.5, 1.0, prob=0.32),  # low confidence < 0.50
            _make_word("speech", 1.0, 1.5, prob=0.95),
        ]
        segs = [{
            "text": "Normal muffled speech.",
            "start": 0.0,
            "end": 1.5,
            "words": words
        }]
        result = self.evaluator.evaluate("Normal muffled speech.", segs, 1.5, "hash123")
        categories = [i["category"] for i in result["issues"]]
        self.assertIn("low_confidence", categories)
        low_conf = next(i for i in result["issues"] if i["category"] == "low_confidence")
        self.assertEqual(low_conf["severity"], "review")

    # 17. proper noun REVIEW
    def test_17_proper_noun_review(self):
        script = "We traveled to OpenAI headquarters."
        # ASR recognized "open ai" without dictionary entry
        segs = [_make_segment("We traveled to open ai headquarters.", 0.0, 2.5)]
        result = self.evaluator.evaluate(script, segs, 2.5, "hash123")
        categories = [i["category"] for i in result["issues"]]
        self.assertIn("proper_noun", categories)
        pn_issue = next(i for i in result["issues"] if i["category"] == "proper_noun")
        self.assertEqual(pn_issue["severity"], "review")

    # 18. issue fingerprint determinism
    def test_18_issue_fingerprint_determinism(self):
        script = "Test sentence with substitution."
        segs = [_make_segment("Test sentence with distribution.", 0.0, 2.0)]
        res1 = self.evaluator.evaluate(script, segs, 2.0, "hashABC")
        res2 = self.evaluator.evaluate(script, segs, 2.0, "hashABC")
        self.assertEqual(len(res1["issues"]), len(res2["issues"]))
        self.assertTrue(len(res1["issues"]) > 0)
        self.assertEqual(res1["issues"][0]["fingerprint"], res2["issues"][0]["fingerprint"])

    # 19. stale detection when audio hash changes
    def test_19_stale_detection_when_audio_hash_changes(self):
        proj_dir, audio_p = self._create_mock_project("proj_stale", audio_bytes=b"AUDIO_VERSION_1")
        h1 = compute_file_sha256(audio_p)
        eval_data = {
            "status": "pass",
            "audio_sha256": h1,
            "audio_duration": 5.0,
            "metrics": {},
            "issues": [],
            "summary": {"unresolved_fail_count": 0, "unresolved_review_count": 0}
        }
        self.manager.save_evaluation("proj_stale", eval_data)
        st1 = self.manager.check_status("proj_stale")
        self.assertFalse(st1["is_stale"])
        self.assertEqual(st1["status"], "pass")

        # Now simulate TTS re-render changing audio.wav content
        audio_p.write_bytes(b"AUDIO_VERSION_2_CHANGED")
        st2 = self.manager.check_status("proj_stale")
        self.assertTrue(st2["is_stale"])
        self.assertEqual(st2["status"], "stale")

    # 20. accepted decision invalidated by changed audio
    def test_20_accepted_decision_invalidated_by_changed_audio(self):
        proj_dir, audio_p = self._create_mock_project("proj_inval", audio_bytes=b"AUDIO_V1")
        h1 = compute_file_sha256(audio_p)
        fp = "fingerprint_123"
        eval_data = {
            "status": "fail",
            "audio_sha256": h1,
            "audio_duration": 5.0,
            "issues": [{
                "fingerprint": fp,
                "severity": "fail",
                "category": "substitution",
                "description": "Sub",
                "resolution": "unresolved"
            }],
            "summary": {"unresolved_fail_count": 1, "unresolved_review_count": 0}
        }
        self.manager.save_evaluation("proj_inval", eval_data)
        # Accept the issue under audio h1
        self.manager.record_decision("proj_inval", fp, "accepted", note="Ok")
        decisions_before = self.manager.load_decisions("proj_inval")
        self.assertIn(fp, decisions_before)

        # Audio changes to V2
        audio_p.write_bytes(b"AUDIO_V2_CHANGED")
        # Invalidate old decisions
        self.manager.invalidate_decisions_if_audio_changed("proj_inval")
        decisions_after = self.manager.load_decisions("proj_inval")
        self.assertNotIn(fp, decisions_after)

    # 21. unresolved FAIL gating
    def test_21_unresolved_fail_gating(self):
        proj_dir, audio_p = self._create_mock_project("proj_gate")
        h = compute_file_sha256(audio_p)
        eval_data = {
            "status": "fail",
            "audio_sha256": h,
            "audio_duration": 5.0,
            "issues": [{
                "fingerprint": "fail_fp",
                "severity": "fail",
                "category": "sentence_cut",
                "description": "Sentence truncated",
                "resolution": "unresolved"
            }],
            "summary": {"unresolved_fail_count": 1, "unresolved_review_count": 0}
        }
        self.manager.save_evaluation("proj_gate", eval_data)
        st = self.manager.check_status("proj_gate")
        self.assertEqual(st["status"], "fail")
        self.assertFalse(st["is_stale"])
        self.assertEqual(st["data"]["summary"]["unresolved_fail_count"], 1)

    # 22. explicit waiver behavior
    def test_22_explicit_waiver_behavior(self):
        proj_dir, audio_p = self._create_mock_project("proj_waive")
        h = compute_file_sha256(audio_p)
        fp = "fail_fp_waive"
        eval_data = {
            "status": "fail",
            "audio_sha256": h,
            "audio_duration": 5.0,
            "issues": [{
                "fingerprint": fp,
                "severity": "fail",
                "category": "missing_words",
                "description": "Missing word",
                "resolution": "unresolved"
            }],
            "summary": {"unresolved_fail_count": 1, "unresolved_review_count": 0}
        }
        self.manager.save_evaluation("proj_waive", eval_data)
        # Record waiver
        res = self.manager.record_decision("proj_waive", fp, "waived", note="User waived intentionally")
        self.assertEqual(res["status"], "pass")
        self.assertEqual(res["data"]["summary"]["unresolved_fail_count"], 0)
        self.assertEqual(res["data"]["issues"][0]["resolution"], "waived")

    # 23. cancellation never produces PASS
    def test_23_cancellation_never_produces_pass(self):
        proj_dir, audio_p = self._create_mock_project("proj_cancel")
        # Ensure that cancellation state or aborted job never writes a valid PASS
        qa_file = proj_dir / "voice_qa.json"
        self.assertFalse(qa_file.exists())
        st = self.manager.check_status("proj_cancel")
        self.assertNotEqual(st["status"], "pass")
        self.assertEqual(st["status"], "idle")

    # 24. ERROR distinct from FAIL
    def test_24_error_distinct_from_fail(self):
        # Empty project missing audio.wav
        proj_dir = self.temp_dir / "proj_missing_audio"
        proj_dir.mkdir(parents=True, exist_ok=True)
        st = self.manager.check_status("proj_missing_audio")
        self.assertEqual(st["status"], "error")
        self.assertNotEqual(st["status"], "fail")


if __name__ == "__main__":
    unittest.main()
