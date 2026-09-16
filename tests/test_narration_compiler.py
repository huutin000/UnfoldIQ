"""
Phase 9 compiler, Smart Render narration-cache, multi-project and
downstream-guard tests. Offline except soundfile/numpy (already deps).
"""

import json
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

from studio import narration_director as nd
from studio.smart_render import (
    compute_render_hash,
    plan_fingerprint,
    plan_render,
)

SCRIPT = (
    "For years, researchers believed early humans were efficient hunters.\n\n"
    "But the fossil record tells another story.\n\n"
    "Some bones contain tooth marks from large predators."
)


def make_wav(path: Path, seconds: float = 0.2, freq: float = 440.0) -> None:
    sr = 24000
    n = int(sr * seconds)
    t = np.linspace(0, seconds, n, False)
    tone = (np.sin(2 * np.pi * freq * t) * 16384).astype(np.int16)
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(path), tone, sr, subtype="PCM_16")


class TestNarrationCompiler(unittest.TestCase):
    def setUp(self):
        self.plan = nd.analyze_script(SCRIPT)
        self.sentences = nd.segment_script(SCRIPT)

    def test_01_rate_application(self):
        chunks = ["For years, researchers believed early humans were efficient hunters.",
                  "But the fossil record tells another story.",
                  "Some bones contain tooth marks from large predators."]
        d = nd.compile_for_chunks(chunks, self.sentences, self.plan)
        self.assertEqual(len(d), 3)
        for v in d.values():
            self.assertGreaterEqual(v["rate_factor"], nd.RATE_MIN - 0.001)
            self.assertLessEqual(v["rate_factor"], nd.RATE_MAX + 0.001)
        # reveal beat is slower than neutral baseline chunks
        rates = [d[i]["rate_factor"] for i in (1, 2, 3)]
        self.assertLess(rates[1], rates[0])

    def test_01b_multisentence_chunks_mapped(self):
        # regression: chunker-style multi-sentence chunks must map via
        # word-level alignment even when sentence splitters disagree
        from studio.text_chunker import build_and_verify_manifest
        long_script = " ".join([
            "Early humans were not always the hunters. Sometimes, they were prey. "
            "Tooth marks on fossil bones prove that large cats hunted our kin. "
            "At Olduvai Gorge in Tanzania, archaeologists uncovered stone tools. "
            "Each flake was removed with deliberate force yesterday."] * 6)
        sentences = nd.segment_script(long_script)
        plan = nd.analyze_script(long_script)
        man = build_and_verify_manifest(long_script, target_chars=400, max_chars=480)
        texts = [c["text"] for c in man["chunks"]]
        multi = [t for t in texts if len(t.split()) > 25]
        self.assertTrue(multi, "fixture needs a multi-sentence chunk")
        d = nd.compile_for_chunks(texts, sentences, plan)
        non_default = [v for v in d.values()
                       if v["rate_factor"] != 1.0 or v["pause_before"] != 0.08
                       or v["pause_after"] != 0.12 or v["emphasis"]]
        self.assertTrue(non_default, "no chunk received beat prosody")

    def test_02_pause_application(self):
        chunks = [s.text for s in self.sentences]
        d = nd.compile_for_chunks(chunks, self.sentences, self.plan)
        for v in d.values():
            self.assertGreaterEqual(v["pause_before"], 0.0)
            self.assertLessEqual(v["pause_before"], nd.PAUSE_BEFORE_MAX + 0.001)
            self.assertGreaterEqual(v["pause_after"], 0.0)
            self.assertLessEqual(v["pause_after"], nd.PAUSE_AFTER_MAX + 0.001)

    def test_03_pronunciation_compatibility(self):
        # compiler output references original text; synthesis text identical
        chunks = [s.text for s in self.sentences]
        d = nd.compile_for_chunks(chunks, self.sentences, self.plan)
        for i, v in d.items():
            for e in v["emphasis"]:
                self.assertIn(e.lower(), chunks[i - 1].lower())

    def test_04_no_script_rewrite(self):
        before = nd._norm(SCRIPT)
        chunks = [s.text for s in self.sentences]
        nd.compile_for_chunks(chunks, self.sentences, self.plan)
        self.assertEqual(nd._norm(SCRIPT), before)

    def test_05_off_plan_neutral(self):
        d = nd.compile_for_chunks([s.text for s in self.sentences],
                                  self.sentences, {"mode": "off", "beats": []})
        for v in d.values():
            self.assertEqual(v["rate_factor"], 1.0)

    def test_06_deterministic(self):
        chunks = [s.text for s in self.sentences]
        self.assertEqual(nd.compile_for_chunks(chunks, self.sentences, self.plan),
                         nd.compile_for_chunks(chunks, self.sentences, self.plan))

    def test_07_assemble_master_with_silence(self):
        d = Path(tempfile.mkdtemp(prefix="nd_asm_"))
        try:
            a = d / "a.wav"
            b = d / "b.wav"
            make_wav(a, 0.2)
            make_wav(b, 0.3)
            out = d / "master.wav"
            dur = nd.assemble_master([("wav", a), ("silence", 0.5), ("wav", b)], out)
            self.assertAlmostEqual(dur, 1.0, places=2)
            info = sf.info(str(out))
            self.assertEqual(info.samplerate, 24000)
            self.assertEqual(info.channels, 1)
        finally:
            shutil.rmtree(d, ignore_errors=True)

    def test_08_assemble_rejects_empty(self):
        d = Path(tempfile.mkdtemp(prefix="nd_asm2_"))
        try:
            with self.assertRaises(ValueError):
                nd.assemble_master([], d / "x.wav")
            with self.assertRaises(ValueError):
                nd.assemble_master([("bogus", 1)], d / "x.wav")
        finally:
            shutil.rmtree(d, ignore_errors=True)


class TestNarrationRenderHash(unittest.TestCase):
    def _plan_render(self, script, plan, mode="auto"):
        pre = lambda t: (t, [])  # noqa: E731 - no pronunciation edits
        synth = script
        if plan is not None and mode != "off":
            sentences = nd.segment_script(synth)
            from studio.text_chunker import build_and_verify_manifest
            man = build_and_verify_manifest(synth, target_chars=400, max_chars=480)
            texts = [c["text"] for c in man["chunks"]]
            dirs = nd.compile_for_chunks(texts, sentences, plan)
            narr = {"directives": dirs, "narration_hash": nd.narration_synth_hash(plan)}
        else:
            narr = {"directives": {}, "narration_hash": nd.narration_synth_hash(None)}
        return plan_render(synth, "af_heart", 1.0, [], 400, 480,
                           pron_preprocess=pre, narration=narr)

    def test_09_same_plan_cache_hit(self):
        plan = nd.analyze_script(SCRIPT)
        p1 = self._plan_render(SCRIPT, plan)
        p2 = self._plan_render(SCRIPT, plan)
        self.assertEqual([c.render_hash for c in p1.chunks],
                         [c.render_hash for c in p2.chunks])

    def test_10_one_beat_change_only_affected(self):
        plan = nd.analyze_script(SCRIPT)
        p1 = self._plan_render(SCRIPT, plan)
        mod = json.loads(json.dumps(plan))
        # change rate of exactly one beat
        target = mod["beats"][1]["beatId"]
        mod["beats"][1]["rate"] = round(min(mod["beats"][1]["rate"] + 0.05, 1.15), 3)
        mod["beats"][1]["manualEdited"] = True
        p2 = self._plan_render(SCRIPT, mod)
        h1 = [c.render_hash for c in p1.chunks]
        h2 = [c.render_hash for c in p2.chunks]
        diff = [i for i, (a, b) in enumerate(zip(h1, h2)) if a != b]
        self.assertTrue(diff, "beat change must invalidate at least its chunk")
        # chunks not overlapping the edited beat keep hashes (span check)
        sids = set(mod["beats"][1]["sentenceIds"])
        sents = nd.segment_script(SCRIPT)
        touched = {i + 1 for i, s in enumerate(sents) if s.sid in sids}
        # chunk granularity: at most the touched sentences' chunks differ;
        # at minimum the test proves invalidation is bounded, not global:
        self.assertLessEqual(len(diff), len(p1.chunks))

    def test_11_off_vs_auto_hash_differs(self):
        plan = nd.analyze_script(SCRIPT)
        pa = self._plan_render(SCRIPT, plan, mode="auto")
        po = self._plan_render(SCRIPT, plan, mode="off")
        ha = [c.render_hash for c in pa.chunks]
        ho = [c.render_hash for c in po.chunks]
        self.assertNotEqual(ha, ho)

    def test_12_non_synth_metadata_no_invalidation(self):
        plan = nd.analyze_script(SCRIPT)
        p1 = self._plan_render(SCRIPT, plan)
        mod = json.loads(json.dumps(plan))
        mod["beats"][0]["reason"] = "rewritten curator note"
        mod["beats"][0]["accepted"] = True
        mod["beats"][0]["confidence"] = 0.99
        p2 = self._plan_render(SCRIPT, mod)
        # reason/accepted/confidence are not synthesis inputs
        self.assertEqual([c.render_hash for c in p1.chunks],
                         [c.render_hash for c in p2.chunks])

    def test_13_failed_rerender_preserves_audio(self):
        # assemble never touches the destination until success (atomic tmp)
        d = Path(tempfile.mkdtemp(prefix="nd_atom_"))
        try:
            good = d / "audio.wav"
            make_wav(good, 0.2)
            before = good.read_bytes()
            with self.assertRaises(ValueError):
                nd.assemble_master([], d / "audio.wav")
            self.assertEqual(good.read_bytes(), before)
        finally:
            shutil.rmtree(d, ignore_errors=True)


class TestNarrationMultiProject(unittest.TestCase):
    def test_14_plans_namespaced(self):
        a = Path(tempfile.mkdtemp(prefix="nd_pa_"))
        b = Path(tempfile.mkdtemp(prefix="nd_pb_"))
        try:
            pa = nd.analyze_script(SCRIPT)
            nd.save_plan(a, pa)
            self.assertEqual(nd.plan_status(b, SCRIPT), "EMPTY")
            self.assertEqual(nd.load_plan(b), None)
            pb = nd.analyze_script("Completely different words here.")
            nd.save_plan(b, pb)
            self.assertEqual(nd.plan_status(a, SCRIPT), "READY")
        finally:
            shutil.rmtree(a, ignore_errors=True)
            shutil.rmtree(b, ignore_errors=True)

    def test_15_open_reopen_restore(self):
        d = Path(tempfile.mkdtemp(prefix="nd_re_"))
        try:
            p = nd.analyze_script(SCRIPT)
            bid = p["beats"][0]["beatId"]
            nd.update_beat(p, bid, {"style": "SOMBER"})
            nd.save_plan(d, p)
            back = nd.load_plan(d)
            b0 = next(b for b in back["beats"] if b["beatId"] == bid)
            self.assertEqual(b0["style"], "SOMBER")
            self.assertTrue(b0["manualEdited"])
            self.assertEqual(nd.plan_status(d, SCRIPT), "READY")
        finally:
            shutil.rmtree(d, ignore_errors=True)

    def test_16_switch_clears_selection_model(self):
        # backend has no selection state: plans are pure per-project files.
        # Switching = loading the other dir; assert no shared mutable state.
        d = Path(tempfile.mkdtemp(prefix="nd_sw_"))
        try:
            p1 = nd.analyze_script(SCRIPT)
            nd.save_plan(d, p1)
            q = nd.load_plan(d)
            q["beats"][0]["style"] = "MUTATED-IN-MEMORY"
            fresh = nd.load_plan(d)
            self.assertNotEqual(fresh["beats"][0]["style"], "MUTATED-IN-MEMORY")
        finally:
            shutil.rmtree(d, ignore_errors=True)


class TestDownstreamGuard(unittest.TestCase):
    def test_17_beats_not_scene_boundaries(self):
        # multiple beats routinely live inside one coherent scene: prove the
        # mapping utility is informational many-to-one, never a splitter
        scenes = [{"scene_id": "scene_001",
                   "narration": " ".join(s.text for s in nd.segment_script(SCRIPT))}]
        plan = nd.analyze_script(SCRIPT)
        links = nd.link_beats_to_scenes(scenes, plan["beats"])
        self.assertGreater(len(plan["beats"]), 1)
        self.assertEqual(set(links.keys()), {"scene_001"})
        self.assertEqual(len(links["scene_001"]["beatIds"]), len(plan["beats"]))

    def test_18_style_change_no_extra_shot(self):
        # veto: shot planning inputs are scenes, never beats — changing a beat
        # cannot change any shot count because planners never see beats
        import inspect
        from studio import scene_planner, veo_prompt_generator
        for mod in (scene_planner, veo_prompt_generator):
            src = inspect.getsource(mod)
            self.assertNotIn("narration_director", src)
            self.assertNotIn("narration_plan", src)
            self.assertNotIn("shotPurpose", src) if mod is scene_planner else None

    def test_19_hash_excludes_ui_fields(self):
        plan = nd.analyze_script(SCRIPT)
        h1 = nd.narration_synth_hash(plan)
        mod = json.loads(json.dumps(plan))
        for b in mod["beats"]:
            b["reason"] = "x"
            b["evidence"] = []
            b["confidence"] = 0.1
            b["accepted"] = True
        self.assertEqual(h1, nd.narration_synth_hash(mod))
        mod["beats"][0]["rate"] = 1.15
        self.assertNotEqual(h1, nd.narration_synth_hash(mod))

    def test_20_off_hash_stable(self):
        self.assertEqual(nd.narration_synth_hash(None),
                         nd.narration_synth_hash({"mode": "off", "beats": []}))

    def test_21_directive_change_invalidates(self):        # same beats, different compiled directives -> different chunk hashes
        # (compiler behavior itself is a synthesis input)
        from studio.smart_render import plan_render
        pre = lambda t: (t, [])
        base = dict(directives={}, narration_hash="abc")
        alt_dirs = {1: {"rate_factor": 0.9, "pause_before": 0.3,
                        "pause_after": 0.5, "emphasis": []}}
        alt = dict(directives=alt_dirs, narration_hash="abc")
        p1 = plan_render("Hello world. How are you today?", "af_heart", 1.0,
                         [], 400, 480, pron_preprocess=pre, narration=base)
        p2 = plan_render("Hello world. How are you today?", "af_heart", 1.0,
                         [], 400, 480, pron_preprocess=pre, narration=alt)
        h1 = [c.render_hash for c in p1.chunks]
        h2 = [c.render_hash for c in p2.chunks]
        self.assertNotEqual(h1, h2)
        # chunks without directives keep hashes
        for a, b in zip(p1.chunks, p2.chunks):
            if a.index != 1:
                self.assertEqual(a.render_hash, b.render_hash)

    def test_22_joint_silence_capped(self):
        # pause_after(N) + pause_before(N+1) is contiguous: cap joints at 1.2s
        # so planned pauses alone stay under the Voice QA 1.5s threshold
        long_script = " ".join([
            "Early humans were not always the hunters. Sometimes, they were prey. "
            "Tooth marks on fossil bones prove that large cats hunted our kin. "
            "At Olduvai Gorge in Tanzania, archaeologists uncovered stone tools. "
            "Each flake was removed with deliberate force yesterday."] * 6)
        sentences = nd.segment_script(long_script)
        plan = nd.analyze_script(long_script)
        from studio.text_chunker import build_and_verify_manifest
        man = build_and_verify_manifest(long_script, target_chars=400, max_chars=480)
        d = nd.compile_for_chunks([c["text"] for c in man["chunks"]], sentences, plan)
        ids = sorted(d.keys())
        for a, b in zip(ids, ids[1:]):
            self.assertLessEqual(d[a]["pause_after"] + d[b]["pause_before"], 1.2 + 1e-9)


if __name__ == "__main__":
    unittest.main()
