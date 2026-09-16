"""Phase 13 — Scene integration tests (§56): refs, visualType, recommendation,
override, visual prompt composer, Veo inheritance."""

import shutil
import tempfile
import unittest
from pathlib import Path

import sys
BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from tests.visual_foundation_fixtures import (
    build_foundation_project, load_json, make_rep, bind_rep,
)
from studio.visual_bible_v2 import migrate_to_v2, load_bible
from studio.visual_prompt import (
    VISUAL_TYPE_ENUM, backfill_scene_visual, recommend_output,
    validate_scene_visual_refs, build_entry, generate_all, load_prompts,
    check_entry_status, inherit_for_shot, continuity_strategy_for_shot,
    VisualPromptError,
)
from studio.scene_planner import scene_planner


class TestSceneVisualRefs(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="unfoldiq_test_scenevis_"))
        self.project = build_foundation_project(self.tmp)
        migrate_to_v2(self.project)
        self.bible = load_bible(self.project)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_backfill_from_group_membership(self):
        scenes = load_json(self.project / "scene_plan.json")["scenes"]
        full = backfill_scene_visual(dict(scenes[0]), self.bible)
        self.assertEqual(full["visualType"], "CHARACTER_SCENE")
        # Corrective §11: groups -> subjectIds; cast stays explicit-only.
        self.assertIn("subject_alpha_01", full["subjectIds"])
        self.assertEqual(full["characterIds"], [])
        self.assertEqual(full["environmentId"], "env_plains_01")
        self.assertIn("prop_tool_01", full["objectIds"])

    def test_backfill_map_category(self):
        scenes = load_json(self.project / "scene_plan.json")["scenes"]
        full = backfill_scene_visual(dict(scenes[2]), self.bible)
        self.assertEqual(full["visualType"], "MAP")

    def test_invalid_character_rejected(self):
        with self.assertRaises(ValueError):
            scene_planner.update_scene(self.project, "scene_001",
                                       {"characterIds": ["CHAR_NOPE"]})

    def test_invalid_visual_type_rejected(self):
        with self.assertRaises(ValueError):
            scene_planner.update_scene(self.project, "scene_001",
                                       {"visualType": "HOLOGRAM"})

    def test_valid_refs_accepted_and_persisted(self):
        updated = scene_planner.update_scene(
            self.project, "scene_003",
            {"visualType": "MAP", "characterIds": [],
             "environmentId": "env_river_01", "objectIds": [],
             "selectedOutputType": "EDITOR_MOTION"})
        self.assertEqual(updated["environmentId"], "env_river_01")
        self.assertEqual(updated["selectedOutputType"], "EDITOR_MOTION")

    def test_group_id_rejected_as_character(self):
        with self.assertRaises(ValueError) as ctx:
            scene_planner.update_scene(self.project, "scene_001",
                                       {"characterIds": ["subject_alpha_01"]})
        self.assertIn("subjectIds", str(ctx.exception))

    def test_validate_refs_helper(self):
        scenes = load_json(self.project / "scene_plan.json")["scenes"]
        full = backfill_scene_visual(dict(scenes[0]), self.bible)
        self.assertEqual(validate_scene_visual_refs(full, self.bible), [])
        bad = dict(full, characterIds=["NOPE"])
        self.assertTrue(validate_scene_visual_refs(bad, self.bible))
        group_as_cast = dict(full, characterIds=["subject_alpha_01"])
        errs = validate_scene_visual_refs(group_as_cast, self.bible)
        self.assertTrue(any("subjectIds" in e for e in errs))


class TestRecommendation(unittest.TestCase):
    def test_character_scene_candidate(self):
        rec, reasons = recommend_output({"visualType": "CHARACTER_SCENE",
                                         "narration": "They rested quietly.",
                                         "visual_summary": "Calm camp."})
        self.assertEqual(rec, "VEO_CANDIDATE")
        self.assertTrue(reasons)

    def test_action_promotes_to_recommended(self):
        rec, reasons = recommend_output({"visualType": "CHARACTER_SCENE",
                                         "narration": "The band kept moving across the plains.",
                                         "visual_summary": "Tracking shot."})
        self.assertEqual(rec, "VEO_RECOMMENDED")

    def test_evidence_static(self):
        rec, _ = recommend_output({"visualType": "EVIDENCE", "narration": "x",
                                   "visual_summary": "y"})
        self.assertEqual(rec, "STATIC_IMAGE")

    def test_diagram_editor_motion(self):
        rec, _ = recommend_output({"visualType": "DIAGRAM", "narration": "x",
                                   "visual_summary": "y"})
        self.assertEqual(rec, "EDITOR_MOTION")

    def test_enum_closed(self):
        self.assertEqual(len(VISUAL_TYPE_ENUM), 8)

    # Closure §17: word boundaries + simple negation (stdlib only).
    def test_striking_vs_strikingly(self):
        rec, _ = recommend_output({"visualType": "CHARACTER_SCENE",
                                   "narration": "The band kept striking flint.",
                                   "visual_summary": ""})
        self.assertEqual(rec, "VEO_RECOMMENDED")
        rec, _ = recommend_output({"visualType": "CHARACTER_SCENE",
                                   "narration": "More strikingly, people helped.",
                                   "visual_summary": ""})
        self.assertEqual(rec, "VEO_CANDIDATE")

    def test_burning_vs_not_burning(self):
        rec, _ = recommend_output({"visualType": "CHARACTER_SCENE",
                                   "narration": "They kept the fire burning.",
                                   "visual_summary": ""})
        self.assertEqual(rec, "VEO_RECOMMENDED")
        rec, _ = recommend_output({"visualType": "CHARACTER_SCENE",
                                   "narration": "It cannot keep a fire burning.",
                                   "visual_summary": ""})
        self.assertEqual(rec, "VEO_CANDIDATE")

    def test_movement_vs_lack_of_movement(self):
        rec, _ = recommend_output({"visualType": "CHARACTER_SCENE",
                                   "narration": "The herd is moving across the plain.",
                                   "visual_summary": ""})
        self.assertEqual(rec, "VEO_RECOMMENDED")
        rec, _ = recommend_output({"visualType": "CHARACTER_SCENE",
                                   "narration": "There is a lack of movement in camp.",
                                   "visual_summary": ""})
        self.assertEqual(rec, "VEO_CANDIDATE")

    def test_stem_still_prefix_matches(self):
        rec, _ = recommend_output({"visualType": "CHARACTER_SCENE",
                                   "narration": "The migration began at dawn.",
                                   "visual_summary": ""})
        self.assertEqual(rec, "VEO_RECOMMENDED")


class TestVisualPromptComposer(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="unfoldiq_test_visprompt_"))
        self.project = build_foundation_project(self.tmp)
        migrate_to_v2(self.project)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_generate_all_and_status(self):
        res = generate_all(self.project)
        self.assertEqual(res, {"built": 3, "total": 3})
        payload = load_prompts(self.project)
        self.assertEqual(len(payload["entries"]), 3)
        entry = next(e for e in payload["entries"] if e["sceneId"] == "scene_001")
        self.assertIn("subject_alpha_01", entry["subjectIds"])
        self.assertEqual(entry["characterIds"], [])
        self.assertEqual(entry["environmentId"], "env_plains_01")
        self.assertIn("recommendedOutputType", entry)
        self.assertIn("SCENE ID", entry["prompt"])
        self.assertIn("REPRESENTATIVE CAST", entry["prompt"])
        self.assertIn("SOURCE SUBJECTS", entry["prompt"])
        self.assertIn("NEGATIVE CONSTRAINTS", entry["prompt"])
        self.assertEqual(entry["status"], "CURRENT")

    def test_generate_with_bound_cast(self):
        bind_rep(self.project, "scene_001", make_rep(self.project)["characterId"])
        res = generate_all(self.project)
        self.assertEqual(res["total"], 3)
        entry = next(e for e in load_prompts(self.project)["entries"]
                     if e["sceneId"] == "scene_001")
        self.assertEqual(entry["characterIds"], ["char_alpha_caregiver_01"])
        self.assertIn("char_alpha_caregiver_01", entry["prompt"])

    def test_entry_status_current_then_outdated(self):
        generate_all(self.project)
        entry = next(e for e in load_prompts(self.project)["entries"]
                     if e["sceneId"] == "scene_001")
        scenes = {s["scene_id"]: s for s in load_json(self.project / "scene_plan.json")["scenes"]}
        bible = load_bible(self.project)
        from studio.visual_prompt import backfill_scene_visual as bf
        status, _ = check_entry_status(entry, bf(dict(scenes["scene_001"]), bible), bible)
        self.assertEqual(status, "CURRENT")

    def test_source_hashes_persisted(self):
        generate_all(self.project)
        entry = load_prompts(self.project)["entries"][0]
        src = entry["sourceHashes"]
        self.assertIn("styleHash", src)
        self.assertIn("entityHashes", src)
        self.assertIn("sceneHash", src)

    def test_missing_scene_plan_raises(self):
        (self.project / "scene_plan.json").unlink()
        with self.assertRaises(VisualPromptError):
            generate_all(self.project)


class TestVeoInheritance(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="unfoldiq_test_inherit_"))
        self.project = build_foundation_project(self.tmp)
        migrate_to_v2(self.project)
        generate_all(self.project)
        self.bible = load_bible(self.project)
        data = load_json(self.project / "veo_prompts.json")
        self.shots = {s["shot_id"]: s for s in data["shots"]}
        scenes = load_json(self.project / "scene_plan.json")["scenes"]
        self.scenes = {s["scene_id"]: backfill_scene_visual(dict(s), self.bible)
                       for s in scenes}
        self.entries = {e["sceneId"]: e for e in load_prompts(self.project)["entries"]}

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_inherit_refs(self):
        rep_id = make_rep(self.project)["characterId"]
        bind_rep(self.project, "scene_002", rep_id)
        bible = load_bible(self.project)
        scenes = {s["scene_id"]: backfill_scene_visual(dict(s), bible)
                  for s in load_json(self.project / "scene_plan.json")["scenes"]}
        generate_all(self.project)
        entries = {e["sceneId"]: e for e in load_prompts(self.project)["entries"]}
        inh = inherit_for_shot(self.shots["shot_002_01"], scenes["scene_002"],
                               bible, entries["scene_002"])
        self.assertIn(rep_id, inh["characterIds"])
        self.assertIn("subject_beta_01", inh["subjectIds"])
        self.assertEqual(inh["environmentId"], "env_river_01")
        self.assertEqual(inh["visualBibleVersion"], "2.1.0")
        self.assertTrue(inh["sourceSceneHash"])
        self.assertTrue(inh["visualPromptHash"])

    def test_continuity_strategies(self):
        s1 = continuity_strategy_for_shot(self.shots["shot_001_01"],
                                          self.scenes["scene_001"], self.bible)
        self.assertIn(s1, ("SCENE_REFERENCE", "INDEPENDENT"))
        s2 = continuity_strategy_for_shot(self.shots["shot_002_02"],
                                          self.scenes["scene_002"], self.bible)
        self.assertIn(s2, ("SCENE_REFERENCE", "PREVIOUS_SHOT_END_FRAME", "INDEPENDENT"))


class TestClosureAuditRules(unittest.TestCase):
    """Closure §34: audit-logic guarantees on fixture projects."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="unfoldiq_test_closure_"))
        self.project = build_foundation_project(self.tmp)
        migrate_to_v2(self.project)
        generate_all(self.project)
        self.bible = load_bible(self.project)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_environment_scene_needs_no_cast(self):
        scene_planner.update_scene(self.project, "scene_001", {"visualType": "ENVIRONMENT"})
        scenes = {s["scene_id"]: s for s in load_json(self.project / "scene_plan.json")["scenes"]}
        full = backfill_scene_visual(dict(scenes["scene_001"]), self.bible)
        self.assertEqual(full["visualType"], "ENVIRONMENT")
        self.assertEqual(full["characterIds"], [])
        self.assertEqual(validate_scene_visual_refs(full, self.bible), [])

    def test_group_scene_needs_no_individual_refs(self):
        scenes = {s["scene_id"]: s for s in load_json(self.project / "scene_plan.json")["scenes"]}
        full = backfill_scene_visual(dict(scenes["scene_001"]), self.bible)
        self.assertTrue(full["subjectIds"])
        self.assertEqual(full["characterIds"], [])
        self.assertEqual(validate_scene_visual_refs(full, self.bible), [])

    def test_subject_and_cast_ids_coexist(self):
        rep_id = make_rep(self.project)["characterId"]
        bind_rep(self.project, "scene_001", rep_id)
        bible = load_bible(self.project)
        scenes = {s["scene_id"]: s for s in load_json(self.project / "scene_plan.json")["scenes"]}
        full = backfill_scene_visual(dict(scenes["scene_001"]), bible)
        self.assertIn("subject_alpha_01", full["subjectIds"])
        self.assertIn(rep_id, full["characterIds"])
        self.assertEqual(validate_scene_visual_refs(full, bible), [])

    def test_reclassify_invalidates_only_that_scene(self):
        generate_all(self.project)
        scene_planner.update_scene(self.project, "scene_001", {"visualType": "ENVIRONMENT"})
        payload = load_prompts(self.project)
        by_id = {e["sceneId"]: e for e in payload["entries"]}
        self.assertEqual(by_id["scene_001"]["status"], "OUTDATED")
        self.assertEqual(by_id["scene_002"]["status"], "CURRENT")
        self.assertEqual(by_id["scene_003"]["status"], "CURRENT")

    def test_recommendation_recalculates_after_reclassify(self):
        generate_all(self.project, ["scene_001"])
        scene_planner.update_scene(self.project, "scene_001", {"visualType": "ENVIRONMENT"})
        generate_all(self.project, ["scene_001"])
        after = next(e for e in load_prompts(self.project)["entries"]
                     if e["sceneId"] == "scene_001")
        self.assertEqual(after["visualType"], "ENVIRONMENT")
        # Entry matches a fresh deterministic recomputation (no stale value).
        scenes = {s["scene_id"]: s for s in load_json(self.project / "scene_plan.json")["scenes"]}
        full = backfill_scene_visual(dict(scenes["scene_001"]), load_bible(self.project))
        expected, _ = recommend_output(full)
        self.assertEqual(after["recommendedOutputType"], expected)
        self.assertEqual(after["status"], "CURRENT")


if __name__ == "__main__":
    unittest.main()
