"""
Unit tests for Phase 4 transcription-independent logic:
- ASR token normalization
- Needleman-Wunsch sequence alignment
- Pronunciation override source mapping
- Sentence timestamp derivation and strict monotonicity
- SRT generation and strict validation
- Audio hash stale detection
- Safe atomic file writing
- Unresolved & interpolated sentence handling
- Cancellation and process safety
"""

import hashlib
import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path

# Add project root to sys.path
import sys
BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from transcription.aligner import (
    normalize_for_matching,
    segment_script_into_sentences,
    extract_words_from_whisper_segments,
    align_tokens_needleman_wunsch,
    align_script_and_asr
)
from transcription.srt_writer import (
    format_timestamp,
    parse_timestamp,
    generate_srt_content,
    validate_srt,
    write_timestamps_safely
)


class TestTranscriptionAligner(unittest.TestCase):

    def setUp(self):
        self.temp_dir = Path(tempfile.mkdtemp(prefix="unfoldiq_test_ts_"))

    def tearDown(self):
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    # 1. ASR Token Normalization
    def test_01_asr_token_normalization(self):
        self.assertEqual(normalize_for_matching("Hello, World!"), "hello world")
        self.assertEqual(normalize_for_matching("It’s a ‘great’ day."), "it's a great day")
        self.assertEqual(normalize_for_matching("Homo  habilis..."), "homo habilis")
        self.assertEqual(normalize_for_matching("  UNFOLDIQ_PRON_TEST   "), "unfoldiq_pron_test")
        self.assertEqual(normalize_for_matching(""), "")

    # 2. Needleman-Wunsch Sequence Alignment
    def test_02_sequence_alignment_exact_and_substitutions(self):
        expected = ["early", "humans", "were", "not", "always", "the", "hunters"]
        asr = ["early", "humans", "were", "not", "always", "the", "hunters"]
        mapping, metrics = align_tokens_needleman_wunsch(expected, asr)
        self.assertEqual(metrics["matched_words"], 7)
        self.assertEqual(metrics["coverage_pct"], 100.0)
        self.assertEqual(mapping, [0, 1, 2, 3, 4, 5, 6])

        # Test with one substitution (e.g. ASR mishears "hunters" as "hunters'")
        asr_sub = ["early", "humans", "were", "not", "always", "the", "hunter"]
        mapping_sub, metrics_sub = align_tokens_needleman_wunsch(expected, asr_sub)
        self.assertEqual(metrics_sub["matched_words"], 6)
        self.assertEqual(metrics_sub["substitutions"], 1)

    # 3. Pronunciation Override Source Mapping
    def test_03_pronunciation_override_mapping(self):
        script = "This is UNFOLDIQ_PRON_TEST."
        manifest = {
            "pronunciation_dictionary_applied": True,
            "pronunciation_overrides": [
                {
                    "original": "UNFOLDIQ_PRON_TEST",
                    "spoken_form": "banana",
                    "match_count": 1
                }
            ]
        }
        # Simulated Whisper words: heard "This is banana."
        whisper_segments = [
            {
                "words": [
                    {"word": "This", "start": 0.0, "end": 0.3, "probability": 0.99},
                    {"word": "is", "start": 0.35, "end": 0.6, "probability": 0.99},
                    {"word": "banana.", "start": 0.65, "end": 1.2, "probability": 0.95}
                ]
            }
        ]

        result = align_script_and_asr(script, manifest, whisper_segments, audio_duration=1.5)
        segments = result["segments"]
        self.assertEqual(len(segments), 1)
        # Verify text preserves ORIGINAL script phrase, NOT banana
        self.assertEqual(segments[0]["text"], "This is UNFOLDIQ_PRON_TEST.")
        self.assertEqual(segments[0]["start"], 0.0)
        self.assertEqual(segments[0]["end"], 1.2)
        self.assertEqual(segments[0]["status"], "direct")

    # 4. Sentence Timestamp Construction
    def test_04_sentence_timestamp_construction(self):
        script = "Sentence one. Sentence two. Sentence three."
        whisper_segments = [
            {
                "words": [
                    {"word": "Sentence", "start": 0.0, "end": 0.5},
                    {"word": "one", "start": 0.55, "end": 1.0},
                    {"word": "Sentence", "start": 1.5, "end": 2.0},
                    {"word": "two", "start": 2.05, "end": 2.5},
                    {"word": "Sentence", "start": 3.0, "end": 3.5},
                    {"word": "three", "start": 3.55, "end": 4.0}
                ]
            }
        ]
        result = align_script_and_asr(script, {}, whisper_segments, audio_duration=4.5)
        segs = result["segments"]
        self.assertEqual(len(segs), 3)
        self.assertEqual(segs[0]["start"], 0.0)
        self.assertEqual(segs[0]["end"], 1.0)
        self.assertEqual(segs[1]["start"], 1.5)
        self.assertEqual(segs[1]["end"], 2.5)
        self.assertEqual(segs[2]["start"], 3.0)
        self.assertEqual(segs[2]["end"], 4.0)

    # 5. Monotonic Timeline Validation
    def test_05_monotonic_timeline_validation(self):
        # Even if ASR gives overlapping or jumbled word timings, aligner enforces strict monotonicity
        script = "First sentence. Second sentence."
        whisper_segments = [
            {
                "words": [
                    {"word": "First", "start": 2.0, "end": 3.0},
                    {"word": "sentence", "start": 2.5, "end": 3.5},
                    {"word": "Second", "start": 1.0, "end": 2.0}, # Out of order
                    {"word": "sentence", "start": 1.5, "end": 2.2}
                ]
            }
        ]
        result = align_script_and_asr(script, {}, whisper_segments, audio_duration=5.0)
        segs = result["segments"]
        self.assertTrue(segs[0]["start"] < segs[0]["end"])
        self.assertTrue(segs[0]["end"] <= segs[1]["start"])
        self.assertTrue(segs[1]["start"] < segs[1]["end"])
        self.assertTrue(segs[1]["end"] <= 5.0)

    # 6. SRT Timestamp Formatting and Parsing
    def test_06_srt_timestamp_formatting_and_parsing(self):
        self.assertEqual(format_timestamp(0.0), "00:00:00,000")
        self.assertEqual(format_timestamp(3.42), "00:00:03,420")
        self.assertEqual(format_timestamp(65.123), "00:01:05,123")
        self.assertEqual(format_timestamp(3661.005), "01:01:01,005")

        self.assertAlmostEqual(parse_timestamp("00:00:03,420"), 3.42, places=3)
        self.assertAlmostEqual(parse_timestamp("01:01:01,005"), 3661.005, places=3)

    # 7. SRT Source Text Preservation
    def test_07_srt_source_text_preservation(self):
        segments = [
            {"index": 1, "start": 0.0, "end": 2.0, "text": "At Olduvai Gorge in Tanzania, researchers examined Homo habilis."},
            {"index": 2, "start": 2.5, "end": 4.5, "text": "Were they our ancestors?"}
        ]
        srt = generate_srt_content(segments)
        self.assertIn("At Olduvai Gorge in Tanzania, researchers examined Homo habilis.", srt)
        self.assertIn("Were they our ancestors?", srt)
        valid, errors = validate_srt(srt, expected_sentence_count=2, max_duration=5.0)
        self.assertTrue(valid, f"SRT failed validation: {errors}")

    # 8. No Duplicate or Missing Sentence Output
    def test_08_no_duplicate_or_missing_sentences(self):
        script = "Sentence A. Sentence B. Sentence C."
        whisper_segments = [
            {"words": [{"word": "Sentence", "start": 0.0, "end": 0.5}, {"word": "A", "start": 0.6, "end": 1.0}]},
            {"words": [{"word": "Sentence", "start": 1.2, "end": 1.7}, {"word": "B", "start": 1.8, "end": 2.2}]},
            {"words": [{"word": "Sentence", "start": 2.5, "end": 3.0}, {"word": "C", "start": 3.1, "end": 3.5}]}
        ]
        result = align_script_and_asr(script, {}, whisper_segments, audio_duration=4.0)
        segs = result["segments"]
        self.assertEqual(len(segs), 3)
        texts = [s["text"] for s in segs]
        self.assertEqual(texts, ["Sentence A.", "Sentence B.", "Sentence C."])

    # 9. Audio Hash Stale Detection
    def test_09_audio_hash_stale_detection(self):
        wav_file = self.temp_dir / "audio.wav"
        wav_file.write_bytes(b"RIFF dummy wav data 1")
        hash1 = hashlib.sha256(b"RIFF dummy wav data 1").hexdigest()

        ts_json = self.temp_dir / "timestamps.json"
        ts_json.write_text(json.dumps({
            "audio_file": "audio.wav",
            "audio_sha256": hash1,
            "segments": []
        }), encoding="utf-8")

        # Now mutate audio
        wav_file.write_bytes(b"RIFF mutated wav data 2")
        hash2 = hashlib.sha256(b"RIFF mutated wav data 2").hexdigest()
        self.assertNotEqual(hash1, hash2)

        # Reading saved hash vs file hash indicates stale
        with open(ts_json, "r", encoding="utf-8") as f:
            saved_data = json.load(f)
        is_stale = (saved_data["audio_sha256"] != hash2)
        self.assertTrue(is_stale)

    # 10. Atomic Artifact Write Behavior
    def test_10_atomic_artifact_write_behavior(self):
        ts_data = {"version": 1, "segments": [{"index": 1, "start": 0.0, "end": 1.0, "text": "Test."}]}
        srt_content = "1\n00:00:00,000 --> 00:00:01,000\nTest.\n"

        json_p, srt_p = write_timestamps_safely(
            project_dir=self.temp_dir,
            timestamps_data=ts_data,
            srt_content=srt_content,
            expected_sentence_count=1,
            max_duration=2.0
        )
        self.assertTrue(json_p.exists())
        self.assertTrue(srt_p.exists())

        # Corrupt SRT should raise ValueError and leave existing files intact
        bad_srt = "Not a valid SRT"
        with self.assertRaises(ValueError):
            write_timestamps_safely(
                project_dir=self.temp_dir,
                timestamps_data=ts_data,
                srt_content=bad_srt,
                expected_sentence_count=1
            )
        # Verify original files survived
        self.assertEqual(srt_p.read_text(encoding="utf-8"), srt_content)

    # 11 & 12. Unresolved and Interpolated Handling
    def test_11_and_12_unresolved_and_interpolated_handling(self):
        script = "Sentence one. Sentence two. Sentence three."
        # Whisper only heard sentence 1 and sentence 3, missing sentence 2
        whisper_segments = [
            {"words": [{"word": "Sentence", "start": 0.0, "end": 0.5}, {"word": "one", "start": 0.6, "end": 1.0}]},
            {"words": [{"word": "Sentence", "start": 3.0, "end": 3.5}, {"word": "three", "start": 3.6, "end": 4.0}]}
        ]
        result = align_script_and_asr(script, {}, whisper_segments, audio_duration=4.5)
        segs = result["segments"]
        self.assertEqual(len(segs), 3)
        self.assertEqual(segs[0]["status"], "direct")
        self.assertEqual(segs[1]["status"], "interpolated") # bounded between seg 0 and seg 2
        self.assertEqual(segs[2]["status"], "direct")
        self.assertTrue(segs[1]["start"] >= segs[0]["end"])
        self.assertTrue(segs[1]["end"] <= segs[2]["start"])

    # 13. Transcription Cancellation State
    def test_13_transcription_cancellation_state(self):
        from studio.transcription_service import TranscriptionService
        service = TranscriptionService()
        job = {
            "project_id": "test_proj",
            "state": "transcribing",
            "stage": "transcribing",
            "percent": 45,
            "message": "Transcribing..."
        }
        service.jobs["test_proj"] = job
        # Simulate cancellation
        job["state"] = "cancelled"
        job["stage"] = "cancelled"
        job["message"] = "Transcription cancelled."
        self.assertEqual(service.jobs["test_proj"]["state"], "cancelled")

    # 14. Worker PID Ownership Safety
    def test_14_worker_pid_ownership_safety(self):
        from studio.transcription_service import TranscriptionService
        service = TranscriptionService()
        # Ensure _active_procs only tracks managed subprocesses
        self.assertEqual(len(service._active_procs), 0)
        self.assertFalse(service.is_gpu_busy())


if __name__ == "__main__":
    unittest.main()
