"""
Phase 7 / lifecycle tests for Veo shot generation architecture (§63):

parentSceneId, timeline, coverage, dynamic counts, shotPurpose enum,
CONTINUATION progression, exact + semantic duplicate detection, bounded
duplicate regeneration, continuity, narration coverage, global timeline,
OUTDATED on hash/version mismatch, per-scene preservation, full replacement,
archive-before-replace, project isolation.

Offline: synthetic scenes + temp project dirs. No GPU, no server.
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

from studio.scene_planner import compute_file_sha256
from studio.veo_prompt_generator import (
    SHOT_PURPOSE_ENUM,
    VeoPromptGenerator,
    detect_adjacent_duplicates,
)


def make_scene(sid, idx, start, end, narration, category="reconstruction",
               continuity_group="group_alpha"):
    return {
        "scene_id": sid,
        "index": idx,
        "start": float(start),
        "end": float(end),
        "duration": round(float(end) - float(start), 3),
        "speech_start": float(start),
        "speech_end": float(end),
        "category": category,
        "evidence_mode": "reconstruction",
        "shot_type": "wide",
        "camera_motion": "slow push-in",
        "continuity_group": continuity_group,
        "visual_summary": f"Visual summary for {sid}",
        "narration": narration,
        "image_prompt": f"Image prompt for {sid}",
        "negative_prompt": "blurry",
    }


NARR_4S = "Early humans moved cautiously across open grassland."
NARR_11S = ("Homo habilis shaped stone tools at Olduvai Gorge in Tanzania. "
            "Each flake removal followed a planned sequence. "
            "The group shared knowledge across generations. "
            "Firelight extended their working day into the night.")
NARR_19S = ("At Barnham in East Anglia, knappers tested flint nodules for quality. "
            "They struck the core with hammerstones of quartzite. "
            "Long blades detached with a ringing sound. "
            "Apprentices watched every gesture closely. "
            "The debitage scattered across the ancient land surface. "
            "Thousands of years later, archaeologists mapped each scatter. "
            "Refitting revealed the order of every single blow.")


class TestVeoLifecycle(unittest.TestCase):
    def setUp(self):
        self.temp_dir = Path(tempfile.mkdtemp(prefix="unfoldiq_test_veo_lc_"))
        self.gen = VeoPromptGenerator(
            target_duration=6.0, preferred_max_duration=8.0,
            min_duration=3.0, aspect_ratio="16:9",
        )

    def tearDown(self):
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def _scenes(self):
        return [
            make_scene("scene_001", 1, 0.0, 4.0, NARR_4S),
            make_scene("scene_002", 2, 4.0, 15.0, NARR_11S, category="environment"),
            make_scene("scene_003", 3, 15.0, 34.0, NARR_19S, category="artifact"),
        ]

    def _mock_project(self, scenes, audio_duration):
        proj = self.temp_dir / "proj"
        proj.mkdir(parents=True, exist_ok=True)
        script = " ".join(s["narration"] for s in scenes)
        (proj / "script.txt").write_text(script, encoding="utf-8")
        (proj / "audio.wav").write_bytes(b"RIFFmockwavcontent" + b"\x00" * 2000)
        (proj / "timestamps.json").write_text(json.dumps({
            "version": 1, "audio_file": "audio.wav",
            "audio_sha256": compute_file_sha256(proj / "audio.wav"),
            "audio_duration": audio_duration,
            "segments": [{"index": 1, "start": 0.0, "end": audio_duration, "text": script}],
        }), encoding="utf-8")
        (proj / "scene_plan.json").write_text(json.dumps({
            "planner_version": "1.0.0",
            "source_script_sha256": compute_file_sha256(proj / "script.txt"),
            "audio_sha256": compute_file_sha256(proj / "audio.wav"),
            "timestamps_sha256": compute_file_sha256(proj / "timestamps.json"),
            "audio_duration": audio_duration,
            "scene_count": len(scenes),
            "coverage": 100.0, "timeline_coverage": 100.0,
            "aspect_ratio": "16:9", "scenes": scenes,
        }), encoding="utf-8")
        return proj

    # -- §63: parent mapping -------------------------------------------------
    def test_01_parent_scene_id_always_present(self):
        shots = self.gen.plan_shots_from_scenes(self._scenes(), 34.0)
        self.assertTrue(shots)
        for s in shots:
            pid = s.get("parentSceneId") or s.get("parent_scene_id")
            self.assertTrue(pid, f"shot {s.get('shot_id')} missing parent")

    def test_02_unknown_parent_rejected(self):
        from studio.veo_prompt_generator import VeoPlanValidationError
        shots = self.gen.plan_shots_from_scenes(self._scenes(), 34.0)
        bad = dict(shots[0])
        bad["parent_scene_id"] = "scene_999"
        bad["parentSceneId"] = "scene_999"
        with self.assertRaises(VeoPlanValidationError) as ctx:
            self.gen.validate_veo_plan(
                [bad] + shots[1:], 34.0,
                parent_scenes=self._scenes())
        self.assertIn("scene_999", str(ctx.exception))

    # -- §63: timeline + coverage --------------------------------------------
    def test_03_shots_inside_boundaries_and_covered(self):
        scenes = self._scenes()
        shots = self.gen.plan_shots_from_scenes(scenes, 34.0)
        for sc in scenes:
            ch = sorted([s for s in shots
                         if (s.get("parentSceneId") or s.get("parent_scene_id")) == sc["scene_id"]],
                        key=lambda s: s["start"])
            self.assertTrue(ch, f"{sc['scene_id']} has no shots")
            self.assertAlmostEqual(ch[0]["start"], sc["start"], places=3)
            self.assertAlmostEqual(ch[-1]["end"], sc["end"], places=3)
            for i, s in enumerate(ch):
                self.assertGreater(s["end"], s["start"])
                self.assertGreaterEqual(s["start"], sc["start"] - 0.005)
                self.assertLessEqual(s["end"], sc["end"] + 0.005)
                if i > 0:
                    self.assertAlmostEqual(s["start"], ch[i - 1]["end"], places=3)

    # -- §63: dynamic counts ---------------------------------------------------
    def test_04_dynamic_counts_not_fixed(self):
        scenes = self._scenes()
        shots = self.gen.plan_shots_from_scenes(scenes, 34.0)
        counts = {}
        for sc in scenes:
            n = len([s for s in shots
                     if (s.get("parentSceneId") or s.get("parent_scene_id")) == sc["scene_id"]])
            counts[sc["scene_id"]] = n
        # short scene -> single shot; longer denser scenes -> more (beats matter, not just duration)
        self.assertEqual(counts["scene_001"], 1)   # 4s short scene
        self.assertGreaterEqual(counts["scene_002"], 2)  # 11s scene
        self.assertGreaterEqual(counts["scene_003"], 3)  # 19s dense scene
        self.assertGreater(len(set(counts.values())), 1, "counts must vary dynamically")

    # -- §63: purpose enum ------------------------------------------------------
    def test_05_purpose_enum_valid(self):
        shots = self.gen.plan_shots_from_scenes(self._scenes(), 34.0)
        for s in shots:
            p = s.get("shotPurpose") or s.get("shot_purpose")
            self.assertIn(p, SHOT_PURPOSE_ENUM, f"bad purpose {p}")

    def test_06_adjacent_purposes_progress(self):
        scenes = self._scenes()
        shots = self.gen.plan_shots_from_scenes(scenes, 34.0)
        for sc in scenes:
            ch = sorted([s for s in shots
                         if (s.get("parentSceneId") or s.get("parent_scene_id")) == sc["scene_id"]],
                        key=lambda s: s["start"])
            dups = detect_adjacent_duplicates(ch)
            self.assertEqual(dups, [], f"dup in {sc['scene_id']}: {dups}")

    # -- §63: duplication detection ----------------------------------------------
    def _dup_pair(self):
        base = {
            "shot_id": "shot_001", "scene_id": "scene_001",
            "start": 0.0, "end": 4.0, "shotPurpose": "ACTION",
            "subject_action": "hunter walking through grass",
            "camera_framing": "medium shot", "camera_motion": "tracking",
            "visual_objective": "show hunter crossing grassland",
            "environment": "dry grassland",
        }
        other = dict(base, shot_id="shot_002", start=4.0, end=8.0)
        return [base, other]

    def test_07_exact_duplicate_detected(self):
        self.assertTrue(detect_adjacent_duplicates(self._dup_pair()))

    def test_08_semantic_near_duplicate_detected(self):
        a, b = self._dup_pair()
        b["subject_action"] = "hunter moving through grassland"
        b["camera_motion"] = "tracking camera follows hunter"
        self.assertTrue(detect_adjacent_duplicates([a, b]))

    def test_09_distinct_shots_not_flagged(self):
        a, b = self._dup_pair()
        b["shotPurpose"] = "DETAIL"
        b["subject_action"] = "close-up of flint tool edge"
        b["camera_framing"] = "close-up"
        b["camera_motion"] = "static"
        b["visual_objective"] = "inspect tool craftsmanship"
        b["environment"] = "workshop floor"
        self.assertEqual(detect_adjacent_duplicates([a, b]), [])

    def test_10_continuation_without_progression_flagged(self):
        a, b = self._dup_pair()
        a["shotPurpose"] = b["shotPurpose"] = "CONTINUATION"
        self.assertTrue(detect_adjacent_duplicates([a, b]))

    def test_11_duplicate_regeneration_bounded(self):
        scenes = self._scenes()
        shots = self.gen.plan_shots_from_scenes(scenes, 34.0)
        # Force a duplicate: clone shot 2 over shot 3 (same scene if possible)
        by_scene = {}
        for s in shots:
            by_scene.setdefault(s.get("scene_id"), []).append(s)
        target = next(sid for sid, ch in by_scene.items() if len(ch) >= 2)
        ch = sorted(by_scene[target], key=lambda s: s["start"])
        victim = dict(ch[0])
        victim["shot_id"] = ch[1]["shot_id"]
        victim["index"] = ch[1]["index"]
        victim["start"] = ch[1]["start"]
        victim["end"] = ch[1]["end"]
        idx = shots.index(ch[1])
        shots[idx] = victim
        self.assertTrue(detect_adjacent_duplicates(
            sorted([s for s in shots if s.get("scene_id") == target],
                   key=lambda s: s["start"])))
        fixed = self.gen._resolve_duplicates(list(shots), scenes, 34.0, max_retries=3)
        remaining = detect_adjacent_duplicates(
            sorted([s for s in fixed if s.get("scene_id") == target],
                   key=lambda s: s["start"]))
        self.assertEqual(remaining, [])
        # timing + parent preserved
        newb = [s for s in fixed if s["shot_id"] == victim["shot_id"]][0]
        self.assertAlmostEqual(newb["start"], victim["start"], places=3)
        self.assertAlmostEqual(newb["end"], victim["end"], places=3)
        self.assertEqual(newb.get("parentSceneId") or newb.get("parent_scene_id"),
                         victim.get("parentSceneId") or victim.get("parent_scene_id"))

    # -- §63: continuity + narration ----------------------------------------------
    def test_12_continuity_group_preserved(self):
        shots = self.gen.plan_shots_from_scenes(self._scenes(), 34.0)
        for s in shots:
            if (s.get("parentSceneId") or s.get("parent_scene_id")) == "scene_001":
                self.assertEqual(s.get("continuity_group"), "group_alpha")

    def test_13_narration_coverage(self):
        scenes = {s["scene_id"]: s for s in self._scenes()}
        shots = self.gen.plan_shots_from_scenes(self._scenes(), 34.0)
        for s in shots:
            self.assertTrue((s.get("narration") or "").strip())
            sc = scenes[s.get("parentSceneId") or s.get("parent_scene_id")]
            # shot narration must come from its parent scene narration
            first_word = (s["narration"].split() or [""])[0].strip(",.").lower()
            self.assertIn(first_word, sc["narration"].lower())

    def test_14_global_timeline(self):
        shots = sorted(self.gen.plan_shots_from_scenes(self._scenes(), 34.0),
                       key=lambda s: s["start"])
        self.assertAlmostEqual(shots[0]["start"], 0.0, places=3)
        self.assertAlmostEqual(shots[-1]["end"], 34.0, places=2)
        for i in range(1, len(shots)):
            self.assertAlmostEqual(shots[i]["start"], shots[i - 1]["end"], places=3)

    # -- §63: OUTDATED triggers -----------------------------------------------------
    def test_15_scene_hash_mismatch_outdated(self):
        proj = self._mock_project(self._scenes(), 34.0)
        self.gen.plan_project_veo(proj)
        st = self.gen.check_veo_status(proj)
        self.assertEqual(st["status"], "Ready")
        # mutate scene plan -> status must flip
        sp_path = proj / "scene_plan.json"
        data = json.loads(sp_path.read_text(encoding="utf-8"))
        data["scenes"][0]["narration"] += " Extra sentence."
        sp_path.write_text(json.dumps(data), encoding="utf-8")
        st2 = self.gen.check_veo_status(proj)
        self.assertNotEqual(st2["status"], "Ready")
        self.assertIn(st2["status"], ("Stale", "OUTDATED", "Outdated"))

    def test_16_generator_version_mismatch_outdated(self):
        proj = self._mock_project(self._scenes(), 34.0)
        self.gen.plan_project_veo(proj)
        veo_path = proj / "veo_prompts.json"
        data = json.loads(veo_path.read_text(encoding="utf-8"))
        data["shotGeneratorVersion"] = "0.0.0"
        data["generator_version"] = "0.0.0"
        veo_path.write_text(json.dumps(data), encoding="utf-8")
        st = self.gen.check_veo_status(proj)
        self.assertNotEqual(st["status"], "Ready")

    # -- §63: per-scene preservation + full replacement + archive ---------------------
    def test_17_perscene_regen_preserves_others(self):
        proj = self._mock_project(self._scenes(), 34.0)
        before = self.gen.plan_project_veo(proj)
        others_before = {s["shot_id"]: s["veo_prompt"] for s in before["shots"]
                         if s.get("scene_id") != "scene_002"}
        self.gen.regenerate_scene_shots(proj, "scene_002")
        after = json.loads((proj / "veo_prompts.json").read_text(encoding="utf-8"))
        others_after = {s["shot_id"]: s["veo_prompt"] for s in after["shots"]
                        if s.get("scene_id") != "scene_002"}
        # other scenes' prompts identical (ids re-sequenced by design)
        self.assertEqual(sorted(others_before.values()), sorted(others_after.values()))
        self.assertTrue(any(s.get("scene_id") == "scene_002" for s in after["shots"]))

    def test_18_full_regen_archives_and_replaces(self):
        proj = self._mock_project(self._scenes(), 34.0)
        first = self.gen.plan_project_veo(proj)
        n1 = len(first["shots"])
        second = self.gen.plan_project_veo(proj)
        self.assertEqual(len(second["shots"]), n1)
        archives = list(proj.glob("veo_prompts_archive_*.json"))
        self.assertTrue(archives, "archive must exist before replacement")
        self.assertTrue((proj / "veo_prompts.json.bak").is_file())

    # -- §64: project isolation ----------------------------------------------------------
    def test_19_projects_isolated(self):
        a = self.temp_dir / "projA"
        b = self.temp_dir / "projB"
        a.mkdir()
        b.mkdir()
        pa = self._mock_project(self._scenes(), 34.0)
        shutil.rmtree(pa)
        # build two independent projects manually
        for d, tag in ((a, "A"), (b, "B")):
            (d / "script.txt").write_text(f"Script {tag}", encoding="utf-8")
            (d / "audio.wav").write_bytes(b"RIFF" + tag.encode() + b"\x00" * 100)
            (d / "timestamps.json").write_text(json.dumps({
                "audio_sha256": compute_file_sha256(d / "audio.wav"),
                "audio_duration": 10.0,
                "segments": [{"index": 1, "start": 0.0, "end": 10.0, "text": f"Script {tag}"}],
            }), encoding="utf-8")
            (d / "scene_plan.json").write_text(json.dumps({
                "audio_duration": 10.0,
                "scenes": [make_scene("scene_001", 1, 0.0, 10.0, f"Narration {tag} " * 20)],
            }), encoding="utf-8")
        va = self.gen.plan_project_veo(a)
        vb = self.gen.plan_project_veo(b)
        self.assertIn("A", va["shots"][0]["narration"])
        self.assertIn("B", vb["shots"][0]["narration"])
        self.assertNotIn("B", va["shots"][0]["narration"])
        # mutating B's scene plan stales only B
        spb = json.loads((b / "scene_plan.json").read_text(encoding="utf-8"))
        spb["scenes"][0]["narration"] += " changed."
        (b / "scene_plan.json").write_text(json.dumps(spb), encoding="utf-8")
        self.assertEqual(self.gen.check_veo_status(a)["status"], "Ready")
        self.assertNotEqual(self.gen.check_veo_status(b)["status"], "Ready")

    def test_20_no_hardcoded_counts(self):
        # generator must not assume 71/94 or any magic totals
        import inspect
        src = inspect.getsource(self.gen.plan_shots_from_scenes)
        self.assertNotIn("94", src)
        self.assertNotIn("71", src)

    # -- P0.2: per-scene invalidation --------------------------------------------
    def _mutate_scene(self, proj, scene_id, suffix=" [probe]"):
        sp_path = proj / "scene_plan.json"
        data = json.loads(sp_path.read_text(encoding="utf-8"))
        for sc in data["scenes"]:
            if sc["scene_id"] == scene_id:
                sc["visual_summary"] = sc.get("visual_summary", "") + suffix
        sp_path.write_text(json.dumps(data), encoding="utf-8")

    def test_21_scene_hashes_recorded(self):
        proj = self._mock_project(self._scenes(), 34.0)
        out = self.gen.plan_project_veo(proj)
        self.assertIn("sceneHashes", out)
        self.assertEqual(set(out["sceneHashes"].keys()),
                         {s["scene_id"] for s in self._scenes()})

    def test_22_single_scene_edit_partial_only(self):
        proj = self._mock_project(self._scenes(), 34.0)
        self.gen.plan_project_veo(proj)
        self.assertEqual(self.gen.check_veo_status(proj)["status"], "Ready")
        self._mutate_scene(proj, "scene_002")
        st = self.gen.check_veo_status(proj)
        self.assertEqual(st["status"], "Stale")
        self.assertTrue(st.get("partial"), st)
        self.assertEqual(st.get("outdated_scenes"), ["scene_002"])

    def test_23_added_scene_full_stale(self):
        proj = self._mock_project(self._scenes(), 34.0)
        self.gen.plan_project_veo(proj)
        sp_path = proj / "scene_plan.json"
        data = json.loads(sp_path.read_text(encoding="utf-8"))
        data["scenes"].append(make_scene("scene_004", 4, 34.0, 40.0, "Extra scene."))
        sp_path.write_text(json.dumps(data), encoding="utf-8")
        st = self.gen.check_veo_status(proj)
        self.assertEqual(st["status"], "Stale")
        self.assertFalse(st.get("partial"))
        self.assertEqual(st.get("outdated_scenes"), [])

    def test_24_upstream_change_full_stale(self):
        proj = self._mock_project(self._scenes(), 34.0)
        self.gen.plan_project_veo(proj)
        (proj / "audio.wav").write_bytes(b"RIFFchanged" + b"\x00" * 100)
        self._mutate_scene(proj, "scene_001")
        st = self.gen.check_veo_status(proj)
        self.assertEqual(st["status"], "Stale")
        self.assertFalse(st.get("partial"), "upstream change must invalidate globally")

    def test_25_perscene_regen_clears_partial(self):
        proj = self._mock_project(self._scenes(), 34.0)
        self.gen.plan_project_veo(proj)
        self._mutate_scene(proj, "scene_003")
        st = self.gen.check_veo_status(proj)
        self.assertTrue(st.get("partial"))
        self.gen.regenerate_scene_shots(proj, "scene_003")
        st2 = self.gen.check_veo_status(proj)
        self.assertEqual(st2["status"], "Ready")
        self.assertFalse(st2.get("partial"))
        self.assertEqual(st2.get("outdated_scenes"), [])

    def test_26_legacy_no_map_falls_back_full(self):
        proj = self._mock_project(self._scenes(), 34.0)
        out = self.gen.plan_project_veo(proj)
        del out["sceneHashes"]
        (proj / "veo_prompts.json").write_text(json.dumps(out), encoding="utf-8")
        self._mutate_scene(proj, "scene_001")
        st = self.gen.check_veo_status(proj)
        self.assertEqual(st["status"], "Stale")
        self.assertFalse(st.get("partial"))

    # -- P2.7: duplicate-repair instrumentation ------------------------------------
    def test_27_repair_metrics_recorded(self):
        proj = self._mock_project(self._scenes(), 34.0)
        out = self.gen.plan_project_veo(proj)
        self.assertIn("duplicate_repair", out)
        m = out["duplicate_repair"]
        self.assertIn("initial_pairs", m)
        self.assertIn("passes_used", m)
        self.assertIn("remaining", m)
        self.assertEqual(m["remaining"], 0)
        # forced duplicate run records a repair
        scenes = self._scenes()
        shots = self.gen.plan_shots_from_scenes(scenes, 34.0)
        by_scene = {}
        for s in shots:
            by_scene.setdefault(s.get("scene_id"), []).append(s)
        target = next(sid for sid, ch in by_scene.items() if len(ch) >= 2)
        ch = sorted(by_scene[target], key=lambda s: s["start"])
        victim = dict(ch[0])
        for k in ("shot_id", "index", "start", "end"):
            victim[k] = ch[1][k]
        shots[shots.index(ch[1])] = victim
        self.gen._resolve_duplicates(list(shots), scenes, 34.0, max_retries=3)
        m2 = self.gen.last_dup_metrics
        self.assertGreaterEqual(m2["initial_pairs"], 1)
        self.assertGreaterEqual(m2["passes_used"], 1)
        self.assertEqual(m2["remaining"], 0)


if __name__ == "__main__":
    unittest.main()
