"""
Verification test for Phase 4 Audit F:
Pronunciation Override Token Expansion & Contraction
- 1-to-many token expansion
- many-to-1 token contraction
- Multi-sentence mixed script
- Strict source text preservation in SRT output
- Zero dropped and zero duplicated cues
- Clean dictionary teardown
"""

import sys
import unittest
from pathlib import Path
import tempfile
import shutil

BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from transcription.aligner import align_script_and_asr, segment_script_into_sentences
from transcription.srt_writer import generate_srt_content, validate_srt
from studio.pronunciation_service import PronunciationDictionary


class TestPronunciationExpansionContraction(unittest.TestCase):
    def setUp(self):
        self.temp_dir = Path(tempfile.mkdtemp(prefix="unfoldiq_audit_f_"))
        self.dict_path = self.temp_dir / "pronunciation_dictionary.json"
        self.dict = PronunciationDictionary(self.dict_path)

    def tearDown(self):
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_01_one_to_many_expansion(self):
        """1 token -> 3 spoken words (XQEXP -> alpha beta gamma)."""
        script = "In the wild, XQEXP was clearly visible."
        manifest = {
            "pronunciation_overrides": [
                {
                    "original": "XQEXP",
                    "spoken_form": "alpha beta gamma",
                    "match_count": 1
                }
            ]
        }
        whisper_segments = [
            {
                "words": [
                    {"word": "In", "start": 0.1, "end": 0.3},
                    {"word": "the", "start": 0.35, "end": 0.5},
                    {"word": "wild,", "start": 0.55, "end": 0.9},
                    {"word": "alpha", "start": 1.1, "end": 1.4},
                    {"word": "beta", "start": 1.45, "end": 1.7},
                    {"word": "gamma", "start": 1.75, "end": 2.1},
                    {"word": "was", "start": 2.2, "end": 2.4},
                    {"word": "clearly", "start": 2.45, "end": 2.8},
                    {"word": "visible.", "start": 2.85, "end": 3.4}
                ]
            }
        ]
        res = align_script_and_asr(script, manifest, whisper_segments, audio_duration=3.8)
        segs = res["segments"]
        self.assertEqual(len(segs), 1, "Exactly 1 cue must be generated (no dropped or duplicated cues)")
        self.assertEqual(segs[0]["text"], "In the wild, XQEXP was clearly visible.", "Source text must be strictly preserved")
        self.assertAlmostEqual(segs[0]["start"], 0.1, places=2)
        self.assertAlmostEqual(segs[0]["end"], 3.4, places=2)
        self.assertEqual(segs[0]["status"], "direct")

        # Validate SRT formatting
        srt_content = generate_srt_content(segs)
        self.assertIn("XQEXP", srt_content)
        self.assertNotIn("alpha beta gamma", srt_content)
        valid, errors = validate_srt(srt_content, expected_sentence_count=1, max_duration=4.0)
        self.assertTrue(valid, f"SRT failed validation: {errors}")

    def test_02_many_to_one_contraction(self):
        """Multi-word phrase -> 1 spoken token (deep neural network -> DNN)."""
        script = "The deep neural network achieved state of the art results."
        manifest = {
            "pronunciation_overrides": [
                {
                    "original": "deep neural network",
                    "spoken_form": "DNN",
                    "match_count": 1
                }
            ]
        }
        whisper_segments = [
            {
                "words": [
                    {"word": "The", "start": 0.2, "end": 0.4},
                    {"word": "DNN", "start": 0.5, "end": 1.1},
                    {"word": "achieved", "start": 1.2, "end": 1.6},
                    {"word": "state", "start": 1.65, "end": 1.9},
                    {"word": "of", "start": 1.92, "end": 2.05},
                    {"word": "the", "start": 2.08, "end": 2.2},
                    {"word": "art", "start": 2.25, "end": 2.5},
                    {"word": "results.", "start": 2.55, "end": 3.1}
                ]
            }
        ]
        res = align_script_and_asr(script, manifest, whisper_segments, audio_duration=3.5)
        segs = res["segments"]
        self.assertEqual(len(segs), 1, "Exactly 1 cue must be generated")
        self.assertEqual(segs[0]["text"], "The deep neural network achieved state of the art results.", "Source text must be strictly preserved")
        self.assertAlmostEqual(segs[0]["start"], 0.2, places=2)
        self.assertAlmostEqual(segs[0]["end"], 3.1, places=2)
        self.assertEqual(segs[0]["status"], "direct")

        # Validate SRT formatting
        srt_content = generate_srt_content(segs)
        self.assertIn("deep neural network", srt_content)
        self.assertNotIn("DNN", srt_content)
        valid, errors = validate_srt(srt_content, expected_sentence_count=1, max_duration=3.5)
        self.assertTrue(valid, f"SRT failed validation: {errors}")

    def test_03_mixed_script_expansion_and_contraction(self):
        """Mixed multi-sentence script with both expansion and contraction."""
        script = (
            "Sentence one features EXPAND_ITEM for clarity. "
            "Sentence two contains normal conversational phrasing. "
            "Sentence three uses compact phrase contraction."
        )
        manifest = {
            "pronunciation_overrides": [
                {
                    "original": "EXPAND_ITEM",
                    "spoken_form": "alpha beta gamma delta",
                    "match_count": 1
                },
                {
                    "original": "compact phrase contraction",
                    "spoken_form": "CPC",
                    "match_count": 1
                }
            ]
        }
        whisper_segments = [
            {
                "words": [
                    # Sentence 1: 0.0 - 2.5
                    {"word": "Sentence", "start": 0.0, "end": 0.4},
                    {"word": "one", "start": 0.45, "end": 0.7},
                    {"word": "features", "start": 0.75, "end": 1.1},
                    {"word": "alpha", "start": 1.15, "end": 1.3},
                    {"word": "beta", "start": 1.35, "end": 1.5},
                    {"word": "gamma", "start": 1.55, "end": 1.7},
                    {"word": "delta", "start": 1.75, "end": 1.95},
                    {"word": "for", "start": 2.0, "end": 2.15},
                    {"word": "clarity.", "start": 2.2, "end": 2.5},
                    # Sentence 2: 3.0 - 5.2
                    {"word": "Sentence", "start": 3.0, "end": 3.4},
                    {"word": "two", "start": 3.45, "end": 3.7},
                    {"word": "contains", "start": 3.75, "end": 4.1},
                    {"word": "normal", "start": 4.15, "end": 4.4},
                    {"word": "conversational", "start": 4.45, "end": 4.9},
                    {"word": "phrasing.", "start": 4.95, "end": 5.2},
                    # Sentence 3: 5.8 - 7.5
                    {"word": "Sentence", "start": 5.8, "end": 6.2},
                    {"word": "three", "start": 6.25, "end": 6.5},
                    {"word": "uses", "start": 6.55, "end": 6.8},
                    {"word": "CPC.", "start": 6.85, "end": 7.5}
                ]
            }
        ]
        res = align_script_and_asr(script, manifest, whisper_segments, audio_duration=8.0)
        segs = res["segments"]
        self.assertEqual(len(segs), 3, "Exactly 3 cues expected")

        # Check texts preserve source
        self.assertEqual(segs[0]["text"], "Sentence one features EXPAND_ITEM for clarity.")
        self.assertEqual(segs[1]["text"], "Sentence two contains normal conversational phrasing.")
        self.assertEqual(segs[2]["text"], "Sentence three uses compact phrase contraction.")

        # Check strict monotonicity
        self.assertTrue(0.0 <= segs[0]["start"] < segs[0]["end"] <= segs[1]["start"])
        self.assertTrue(segs[1]["start"] < segs[1]["end"] <= segs[2]["start"])
        self.assertTrue(segs[2]["start"] < segs[2]["end"] <= 8.0)

        # Validate SRT content
        srt_content = generate_srt_content(segs)
        self.assertIn("EXPAND_ITEM", srt_content)
        self.assertNotIn("alpha beta gamma delta", srt_content)
        self.assertIn("compact phrase contraction", srt_content)
        self.assertNotIn("CPC", srt_content)

        valid, errors = validate_srt(srt_content, expected_sentence_count=3, max_duration=8.0)
        self.assertTrue(valid, f"SRT validation failed: {errors}")

    def test_04_dictionary_lifecycle_and_clean_teardown(self):
        """Add entries to dictionary, test preprocessing, and cleanly delete."""
        e1 = self.dict.add_entry("TEST_EXPAND", "one two three")
        e2 = self.dict.add_entry("complex term phrase", "CTP")
        self.assertEqual(len(self.dict.entries), 2)

        raw_text = "Here is TEST_EXPAND and complex term phrase."
        preprocessed, overrides = self.dict.preprocess(raw_text)
        self.assertEqual(preprocessed, "Here is one two three and CTP.")
        self.assertEqual(len(overrides), 2)

        # Teardown / cleanup
        self.dict.delete_entry(e1.id)
        self.dict.delete_entry(e2.id)
        self.assertEqual(len(self.dict.entries), 0, "Dictionary must be cleanly empty after teardown")

        # Verify raw text is unaffected after deletion
        clean_text, clean_overrides = self.dict.preprocess(raw_text)
        self.assertEqual(clean_text, raw_text)
        self.assertEqual(len(clean_overrides), 0)


if __name__ == "__main__":
    unittest.main()
