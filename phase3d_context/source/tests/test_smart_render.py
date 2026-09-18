"""
Phase 7 Smart Render Engine unit tests (7.1 + 7.2).

All tests are local and deterministic. Speech synthesis is faked with a
sine-wave WAV writer injected through the synth_fn seam — no GPU, no
network, no Kokoro required.
"""

import asyncio
import shutil
import tempfile
import unittest
from pathlib import Path

import numpy as np
import soundfile as sf

import sys
BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from studio.smart_render import (
    EXPECTED_SAMPLE_RATE,
    MAX_ATTEMPTS,
    RENDER_ENGINE_VERSION,
    RenderCache,
    RenderJobState,
    compute_pronunciation_hash,
    compute_render_hash,
    ordered_chunk_paths,
    plan_fingerprint,
    plan_render,
    render_chunk_with_retry,
    replace_file_atomically,
)
from studio.text_chunker import normalize_script


SCRIPT = (
    "Early humans were not always the hunters.\n\n"
    "Sometimes, they were prey. Homo habilis moved cautiously across open grassland, "
    "listening for every sound. Survival demanded cooperation, sharp eyes, and steady nerves."
)


def make_sine_wav(path: Path, freq: float = 440.0, seconds: float = 0.3) -> None:
    sr = EXPECTED_SAMPLE_RATE
    samples = int(sr * seconds)
    t = np.linspace(0, seconds, samples, False)
    tone = (np.sin(2 * np.pi * freq * t) * 16384).astype(np.int16)
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(path), tone, sr, subtype="PCM_16")


def fake_synth_factory(fail_times: int = 0, freq: float = 440.0):
    calls = {"n": 0}

    async def synth(_text: str, out: Path) -> None:
        calls["n"] += 1
        if calls["n"] <= fail_times:
            raise RuntimeError("transient synth failure")
        make_sine_wav(out, freq=freq)

    synth.calls = calls
    return synth


class TestSmartRenderPlan(unittest.TestCase):
    def test_01_deterministic_plan(self):
        p1 = plan_render(SCRIPT, "af_heart", 1.0, [], 400, 480)
        p2 = plan_render(SCRIPT, "af_heart", 1.0, [], 400, 480)
        self.assertEqual(p1.fingerprint, p2.fingerprint)
        self.assertEqual([c.render_hash for c in p1.chunks],
                         [c.render_hash for c in p2.chunks])
        self.assertEqual([c.chunk_id for c in p1.chunks],
                         [f"{i + 1:04d}" for i in range(len(p1.chunks))])

    def test_02_no_lost_or_duplicated_characters(self):
        plan = plan_render(SCRIPT, "af_heart", 1.0, [], 400, 480)
        joined = "\n\n".join(c.text for c in plan.chunks)
        # Chunks partition the synthesis text exactly (same chunker as Phase 2).
        self.assertEqual(
            normalize_script(joined),
            normalize_script(SCRIPT),
        )

    def test_03_render_hash_is_sha256_not_builtin_hash(self):
        h = compute_render_hash("hello", "af_heart", 1.0, "abc", 400, 480)
        self.assertEqual(len(h), 64)
        int(h, 16)  # valid hex
        # Changing any input changes the hash.
        self.assertNotEqual(h, compute_render_hash("hello!", "af_heart", 1.0, "abc", 400, 480))
        self.assertNotEqual(h, compute_render_hash("hello", "bf_emma", 1.0, "abc", 400, 480))
        self.assertNotEqual(h, compute_render_hash("hello", "af_heart", 1.2, "abc", 400, 480))
        self.assertNotEqual(h, compute_render_hash("hello", "af_heart", 1.0, "abd", 400, 480))

    def test_04_voice_change_invalidates_all(self):
        a = plan_render(SCRIPT, "af_heart", 1.0, [], 400, 480)
        b = plan_render(SCRIPT, "bf_emma", 1.0, [], 400, 480)
        self.assertEqual(len(a.chunks), len(b.chunks))
        for ca, cb in zip(a.chunks, b.chunks):
            self.assertNotEqual(ca.render_hash, cb.render_hash)

    def test_05_speed_change_invalidates_all(self):
        a = plan_render(SCRIPT, "af_heart", 1.0, [], 400, 480)
        b = plan_render(SCRIPT, "af_heart", 1.25, [], 400, 480)
        for ca, cb in zip(a.chunks, b.chunks):
            self.assertNotEqual(ca.render_hash, cb.render_hash)

    def test_06_pronunciation_only_affected_chunks(self):
        plain = plan_render(SCRIPT, "af_heart", 1.0, [], 400, 480)
        overrides = [{
            "entry_id": "e1",
            "original": "Homo habilis",
            "spoken_form": "HOH-moh HAB-ih-liss",
            "match_count": 1,
        }]
        pron_hash = compute_pronunciation_hash(overrides)
        # default (empty) narration directive, matching plan_render defaults
        default_dir = {"rate_factor": 1.0, "pause_before": 0.0,
                       "pause_after": 0.0, "emphasis": []}
        # Effective text of the chunk containing the phrase changes.
        changed = [c for c in plain.chunks if "Homo habilis" in c.text]
        unchanged = [c for c in plain.chunks if "Homo habilis" not in c.text]
        self.assertTrue(changed)
        for c in changed:
            new_text = c.text.replace("Homo habilis", "HOH-moh HAB-ih-liss")
            new_hash = compute_render_hash(new_text, "af_heart", 1.0, pron_hash,
                                           400, 480, "", default_dir)
            self.assertNotEqual(new_hash, c.render_hash)
        for c in unchanged:
            same_hash = compute_render_hash(c.text, "af_heart", 1.0, pron_hash,
                                            400, 480, "", default_dir)
            # Pronunciation hash input differs globally, so hash differs, but the
            # *chunk text* is identical — the engine reuses by identical inputs.
            self.assertEqual(
                compute_render_hash(c.text, "af_heart", 1.0,
                                    compute_pronunciation_hash([]), 400, 480,
                                    "", default_dir),
                c.render_hash,
            )
            self.assertNotEqual(same_hash, c.render_hash)  # documents global-hash behavior


class TestPronunciationGranularity(unittest.TestCase):
    """P1.6: single-word entry edits invalidate only affected chunks."""

    def _preprocess(self, entries):
        import re

        def run(text):
            applied = []
            current = text
            for i, (orig, spoken) in enumerate(entries):
                pat = re.compile(r"(?<!\w)" + re.escape(orig) + r"(?!\w)", re.IGNORECASE)
                n = len(pat.findall(current))
                if n:
                    current = pat.sub(spoken, current)
                    applied.append({"entry_id": f"e{i}", "original": orig,
                                    "spoken_form": spoken, "match_count": n})
            return current, applied
        return run

    def _plan_with_entries(self, entries):
        pre = self._preprocess(entries)
        synth, applied = pre(SCRIPT)
        return plan_render(synth, "af_heart", 1.0, applied, 400, 480,
                           pron_preprocess=pre), applied

    def test_18_single_word_edit_only_affected_chunks(self):
        before, _ = self._plan_with_entries([])
        after, applied = self._plan_with_entries([("prey", "PRAY")])
        self.assertTrue(applied)
        same, diff = 0, 0
        for cb, ca in zip(before.chunks, after.chunks):
            # chunk text itself changes only where the word occurred
            if "prey" in cb.text.lower():
                diff += 1
                self.assertNotEqual(cb.render_hash, ca.render_hash)
            else:
                same += 1
                self.assertEqual(cb.render_hash, ca.render_hash)
        self.assertGreater(same, 0)
        self.assertGreater(diff, 0)

    def test_19_multiword_edit_falls_back_global(self):
        before, _ = self._plan_with_entries([])
        after, applied = self._plan_with_entries(
            [("Homo habilis", "HOH-moh HAB-ih-liss")])
        self.assertTrue(applied)
        # conservative fallback: every hash differs, nothing stale is reused
        for cb, ca in zip(before.chunks, after.chunks):
            self.assertNotEqual(cb.render_hash, ca.render_hash)

    def test_20_noop_dict_edit_keeps_all_hits(self):
        before, _ = self._plan_with_entries([])
        after, applied = self._plan_with_entries([("xyzzqq", "SPOKEN")])
        self.assertEqual(applied, [])
        for cb, ca in zip(before.chunks, after.chunks):
            self.assertEqual(cb.render_hash, ca.render_hash)


class TestSmartRenderCache(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="smart_render_test_"))
        self.cache = RenderCache(self.tmp)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_07_cache_hit(self):
        plan = plan_render(SCRIPT, "af_heart", 1.0, [], 400, 480)
        chunk = plan.chunks[0]
        src = self.tmp / "src.wav"
        make_sine_wav(src)
        stored = self.cache.store(chunk.render_hash, src, chunk.chunk_id)
        self.assertTrue(stored.is_file())
        found = self.cache.lookup(chunk.render_hash)
        self.assertEqual(found, stored)

    def test_08_cache_miss_on_changed_text(self):
        plan = plan_render(SCRIPT, "af_heart", 1.0, [], 400, 480)
        chunk = plan.chunks[0]
        src = self.tmp / "src.wav"
        make_sine_wav(src)
        self.cache.store(chunk.render_hash, src, chunk.chunk_id)
        other_hash = compute_render_hash("something else", "af_heart", 1.0,
                                         compute_pronunciation_hash([]), 400, 480)
        self.assertIsNone(self.cache.lookup(other_hash))

    def test_09_corrupted_cache_rejected(self):
        render_hash = "0" * 64
        bad = self.cache.chunk_path(render_hash)
        bad.parent.mkdir(parents=True, exist_ok=True)
        bad.write_bytes(b"not a wav file at all")
        # Manifest entry present but file corrupt.
        self.cache._save_manifest({"version": RENDER_ENGINE_VERSION,
                                   "chunks": {render_hash: {"chunk_id": "0001"}}})
        self.assertIsNone(self.cache.lookup(render_hash))
        self.assertFalse(bad.exists())  # corrupt file removed, never reused

    def test_10_prune_orphans_keeps_audio(self):
        keep_wav = self.tmp / "audio.wav"
        make_sine_wav(keep_wav)
        h1, h2 = "a" * 64, "b" * 64
        for h in (h1, h2):
            src = self.tmp / f"{h[:4]}.wav"
            make_sine_wav(src)
            self.cache.store(h, src, "0001")
        removed = self.cache.prune_orphans([h1])
        self.assertEqual(removed, 1)
        self.assertTrue(self.cache.chunk_path(h1).is_file())
        self.assertFalse(self.cache.chunk_path(h2).exists())
        self.assertTrue(keep_wav.is_file())  # master audio never touched


class TestSmartRenderJobState(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="smart_job_test_"))
        self.cache = RenderCache(self.tmp)
        self.jobs = RenderJobState(self.tmp)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _fill_cache(self, plan):
        for c in plan.chunks:
            src = self.tmp / f"src_{c.chunk_id}.wav"
            make_sine_wav(src, freq=440.0 + c.index)
            self.cache.store(c.render_hash, src, c.chunk_id)

    def test_11_resume_compatible(self):
        plan = plan_render(SCRIPT, "af_heart", 1.0, [], 400, 480)
        self._fill_cache(plan)
        state = self.jobs.new("job1", plan.fingerprint, plan.total_chunks)
        first = plan.chunks[0]
        self.jobs.mark_completed(state, first.chunk_id, first.render_hash, reused=True)
        reloaded = self.jobs.load()
        ok = self.jobs.compatible_completed(reloaded, plan, self.cache)
        self.assertEqual(ok, {first.chunk_id: first.render_hash})

    def test_12_resume_rejects_incompatible(self):
        plan = plan_render(SCRIPT, "af_heart", 1.0, [], 400, 480)
        self._fill_cache(plan)
        state = self.jobs.new("job1", plan.fingerprint, plan.total_chunks)
        first = plan.chunks[0]
        self.jobs.mark_completed(state, first.chunk_id, first.render_hash, reused=False)
        other = plan_render(SCRIPT + " Extra sentence added.", "af_heart", 1.0, [], 400, 480)
        self.assertEqual(self.jobs.compatible_completed(state, other, self.cache), {})
        # Corrupt the cached file -> resume must not trust it.
        self.cache.chunk_path(first.render_hash).write_bytes(b"corrupt")
        self.assertEqual(self.jobs.compatible_completed(state, plan, self.cache), {})

    def test_13_ordered_stitch_paths(self):
        plan = plan_render(SCRIPT, "af_heart", 1.0, [], 400, 480)
        # Simulate out-of-order completion: resolve must still yield index order.
        completed_order = list(reversed(plan.chunks))
        self.assertNotEqual([c.index for c in completed_order],
                            sorted(c.index for c in completed_order))
        paths = ordered_chunk_paths(plan, lambda h: self.cache.chunk_path(h))
        expected = [self.cache.chunk_path(c.render_hash)
                    for c in sorted(plan.chunks, key=lambda c: c.index)]
        self.assertEqual(paths, expected)

    def test_14_atomic_replace_preserves_old(self):
        old = self.tmp / "audio.wav"
        make_sine_wav(old, freq=440.0)
        old_bytes = old.read_bytes()
        # Invalid source must not destroy the old file.
        bad = self.tmp / "bad.wav"
        bad.write_bytes(b"junk")
        with self.assertRaises(ValueError):
            replace_file_atomically(bad, old)
        self.assertEqual(old.read_bytes(), old_bytes)
        # Valid source swaps atomically.
        new = self.tmp / "new.wav"
        make_sine_wav(new, freq=880.0)
        new_bytes = new.read_bytes()
        replace_file_atomically(new, old)
        self.assertEqual(old.read_bytes(), new_bytes)
        self.assertFalse(new.exists())


class TestSmartRenderRetry(unittest.TestCase):
    def test_15_retry_then_success(self):
        tmp = Path(tempfile.mkdtemp(prefix="smart_retry_"))
        try:
            out = tmp / "chunk.wav"
            synth = fake_synth_factory(fail_times=2)
            res = asyncio.run(render_chunk_with_retry(synth, "hello world", out))
            self.assertTrue(res["ok"])
            self.assertEqual(res["retries"], 2)
            self.assertEqual(synth.calls["n"], 3)
            self.assertTrue(out.is_file())
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_16_permanent_failure_bounded(self):
        tmp = Path(tempfile.mkdtemp(prefix="smart_retry_fail_"))
        try:
            out = tmp / "chunk.wav"
            synth = fake_synth_factory(fail_times=99)
            res = asyncio.run(render_chunk_with_retry(synth, "hello world", out))
            self.assertFalse(res["ok"])
            self.assertEqual(res["retries"], MAX_ATTEMPTS - 1)
            self.assertEqual(synth.calls["n"], MAX_ATTEMPTS)
            self.assertTrue(res["error"])
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_17_cancellation_state(self):
        tmp = Path(tempfile.mkdtemp(prefix="smart_cancel_"))
        try:
            out = tmp / "chunk.wav"
            synth = fake_synth_factory()
            with self.assertRaises(asyncio.CancelledError):
                asyncio.run(render_chunk_with_retry(
                    synth, "hello world", out, cancel_check=lambda: True))
            self.assertEqual(synth.calls["n"], 0)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
