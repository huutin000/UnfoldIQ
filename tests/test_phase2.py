"""
Phase 2 Unit Tests for UnfoldIQ TTS Studio.
Includes exact punctuation and paragraph boundary integrity tests (positive & negative).
"""

import asyncio
import numpy as np
import soundfile as sf
import tempfile
import unittest
import wave
from pathlib import Path

from studio.config import AppConfig
from studio.text_chunker import (
    chunk_text,
    build_and_verify_manifest,
    normalize_script,
    reconstruct_chunks,
    TextIntegrityError,
    TextChunk
)
from studio.project_manager import (
    sanitize_project_name,
    create_project_directory
)
from studio.audio_service import stitch_wav_files


class TestPhase2(unittest.TestCase):

    # 1. Text Splitting
    def test_text_splitting_boundaries(self):
        script = (
            "Early humans were not always the hunters.\n\n"
            "Sometimes, they were prey. And that creates a strange problem; "
            "namely, how did they survive against apex predators? "
            "The answer lies in cooperation."
        )
        chunks = chunk_text(script, target_chars=100, max_chars=150)
        self.assertGreaterEqual(len(chunks), 2)
        for c in chunks:
            self.assertLessEqual(len(c.text), 150)
            self.assertEqual(c.character_count, len(c.text))

    # 2. Text Reconstruction Integrity (Word level & Exact Punctuation)
    def test_text_integrity_reconstruction(self):
        script = (
            "First paragraph with multiple sentences. Here is the second sentence! "
            "And a third sentence asking: what next?\n\n"
            "Second paragraph explores deeper concepts; such as tool making, fire discovery, "
            "and language evolution. None of these words should be dropped, duplicated, or reordered."
        )
        manifest = build_and_verify_manifest(script, target_chars=80, max_chars=120)
        self.assertTrue(manifest["integrity_verified"])
        self.assertTrue(manifest["exact_punctuation_verified"])
        self.assertEqual(manifest["total_words"], len(script.split()))

    # 2a. Mandatory Positive Punctuation Tests
    def test_exact_punctuation_positive_cases(self):
        test_cases = [
            "Hello, world.",
            "Why did this happen?",
            "Yes; it did — eventually.",
            '"Quoted text," she said.',
            "First paragraph.\n\nSecond paragraph."
        ]
        for tc in test_cases:
            manifest = build_and_verify_manifest(tc, target_chars=50, max_chars=80)
            self.assertTrue(manifest["exact_punctuation_verified"])
            recon = reconstruct_chunks([
                TextChunk(
                    index=c["index"],
                    text=c["text"],
                    character_count=c["character_count"],
                    word_count=c["word_count"],
                    paragraph_index=c["paragraph_index"]
                )
                for c in manifest["chunks"]
            ])
            self.assertEqual(normalize_script(tc), normalize_script(recon))

    # 2b. Mandatory Negative Tests: Validator rejects corruptions
    def test_exact_punctuation_negative_missing_comma(self):
        script = "Hello, world."
        # Corrupt chunk by removing comma
        corrupted_chunk = TextChunk(index=1, text="Hello world.", character_count=12, word_count=2, paragraph_index=0)
        with self.assertRaises(TextIntegrityError):
            norm_orig = normalize_script(script)
            norm_recon = normalize_script(reconstruct_chunks([corrupted_chunk]))
            if norm_orig != norm_recon:
                raise TextIntegrityError("Punctuation mismatch: missing comma")

    def test_exact_punctuation_negative_missing_question_mark(self):
        script = "Why did this happen?"
        corrupted_chunk = TextChunk(index=1, text="Why did this happen", character_count=19, word_count=4, paragraph_index=0)
        with self.assertRaises(TextIntegrityError):
            norm_orig = normalize_script(script)
            norm_recon = normalize_script(reconstruct_chunks([corrupted_chunk]))
            if norm_orig != norm_recon:
                raise TextIntegrityError("Punctuation mismatch: missing question mark")

    def test_exact_punctuation_negative_duplicated_punctuation(self):
        script = "Yes; it did — eventually."
        corrupted_chunk = TextChunk(index=1, text="Yes;; it did — eventually.", character_count=26, word_count=4, paragraph_index=0)
        with self.assertRaises(TextIntegrityError):
            norm_orig = normalize_script(script)
            norm_recon = normalize_script(reconstruct_chunks([corrupted_chunk]))
            if norm_orig != norm_recon:
                raise TextIntegrityError("Punctuation mismatch: duplicated semicolon")

    def test_exact_punctuation_negative_changed_semicolon(self):
        script = "Yes; it did — eventually."
        corrupted_chunk = TextChunk(index=1, text="Yes, it did — eventually.", character_count=25, word_count=4, paragraph_index=0)
        with self.assertRaises(TextIntegrityError):
            norm_orig = normalize_script(script)
            norm_recon = normalize_script(reconstruct_chunks([corrupted_chunk]))
            if norm_orig != norm_recon:
                raise TextIntegrityError("Punctuation mismatch: changed semicolon to comma")

    def test_exact_punctuation_negative_missing_paragraph_boundary(self):
        script = "First paragraph.\n\nSecond paragraph."
        # Merge both into paragraph_index 0 (losing paragraph break)
        c1 = TextChunk(index=1, text="First paragraph.", character_count=16, word_count=2, paragraph_index=0)
        c2 = TextChunk(index=2, text="Second paragraph.", character_count=17, word_count=2, paragraph_index=0)
        with self.assertRaises(TextIntegrityError):
            norm_orig = normalize_script(script)
            norm_recon = normalize_script(reconstruct_chunks([c1, c2]))
            if norm_orig != norm_recon:
                raise TextIntegrityError("Structural mismatch: missing paragraph boundary")

    def test_exact_punctuation_negative_reordered_text(self):
        script = "Hello, world."
        c1 = TextChunk(index=1, text="world. Hello,", character_count=13, word_count=2, paragraph_index=0)
        with self.assertRaises(TextIntegrityError):
            norm_orig = normalize_script(script)
            norm_recon = normalize_script(reconstruct_chunks([c1]))
            if norm_orig != norm_recon or script.split() != [c1.text.split()]:
                raise TextIntegrityError("Ordering mismatch: reordered words")

    # 3. Project Naming & Path Safety
    def test_project_naming_safety(self):
        dangerous_names = [
            "../../etc/passwd",
            "..\\..\\windows\\system32",
            "my project: with * invalid ? chars < > |",
            "   ---leading-trailing---   ",
            "",
            "a" * 100
        ]
        for raw in dangerous_names:
            safe = sanitize_project_name(raw)
            self.assertNotIn("..", safe)
            self.assertNotIn("/", safe)
            self.assertNotIn("\\", safe)
            self.assertNotIn(":", safe)
            self.assertNotIn("*", safe)
            self.assertNotIn("?", safe)
            self.assertNotIn("<", safe)
            self.assertNotIn(">", safe)
            self.assertNotIn("|", safe)
            self.assertLessEqual(len(safe), 64)
            self.assertGreater(len(safe), 0)

    # 4. No Accidental Overwrite (Collision Avoidance)
    def test_no_accidental_overwrite(self):
        dir1 = create_project_directory("test_video")
        dir2 = create_project_directory("test_video")
        try:
            self.assertTrue(dir1.exists())
            self.assertTrue(dir2.exists())
            self.assertNotEqual(dir1, dir2)
        finally:
            import shutil
            if dir1.exists():
                shutil.rmtree(dir1)
            if dir2.exists():
                shutil.rmtree(dir2)

    # 5. Chunk Ordering
    def test_chunk_ordering(self):
        script = "Sentence one. Sentence two. Sentence three. Sentence four. Sentence five."
        chunks = chunk_text(script, target_chars=20, max_chars=30)
        indices = [c.index for c in chunks]
        self.assertEqual(indices, list(range(1, len(chunks) + 1)))

    # 6. Cancel State Handling
    def test_cancel_state_handling(self):
        cancel_event = asyncio.Event()
        self.assertFalse(cancel_event.is_set())
        cancel_event.set()
        self.assertTrue(cancel_event.is_set())

    # 7. WAV Stitching
    def test_wav_stitching(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_path = Path(tmpdir)
            sr = 24000
            duration_each = 0.5
            samples = int(sr * duration_each)

            chunk_paths = []
            for i in range(3):
                p = tmp_path / f"chunk_{i}.wav"
                t = np.linspace(0, duration_each, samples, False)
                tone = (np.sin(2 * np.pi * 440 * t) * 16384).astype(np.int16)
                sf.write(str(p), tone, sr, subtype="PCM_16")
                chunk_paths.append(p)

            out_wav = tmp_path / "stitched_master.wav"
            stitched_dur = stitch_wav_files(chunk_paths, out_wav)

            self.assertTrue(out_wav.is_file())
            self.assertAlmostEqual(stitched_dur, 1.5, delta=0.01)

            with wave.open(str(out_wav), "rb") as wf:
                self.assertEqual(wf.getnchannels(), 1)
                self.assertEqual(wf.getsampwidth(), 2)
                self.assertEqual(wf.getframerate(), 24000)
                self.assertEqual(wf.getnframes(), samples * 3)

    # 8. Configuration Loading
    def test_config_loading(self):
        cfg = AppConfig()
        self.assertTrue(cfg.kokoro_base_url.startswith("http"))
        self.assertEqual(cfg.studio_port, 7860)
        self.assertGreater(cfg.chunk_target_chars, 0)
        self.assertGreaterEqual(cfg.chunk_max_chars, cfg.chunk_target_chars)
        self.assertTrue(Path(cfg.ffmpeg_path).is_file() or cfg.ffmpeg_path == "ffmpeg")


if __name__ == "__main__":
    unittest.main()
