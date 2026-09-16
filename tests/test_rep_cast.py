"""Corrective — Representative cast tests (§56–60): semantics, suggestions,
bindings, caregiver fixture, invalidation FP/FN."""

import json
import shutil
import tempfile
import unittest
from pathlib import Path

import sys
BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from tests.visual_foundation_fixtures import (
    build_foundation_project, load_json, make_png_bytes, make_rep, bind_rep,
    reset_outdated,
)
from studio.visual_bible_v2 import (
    migrate_to_v2, load_bible, create_entity, find_entity,
    analyze_cast_suggestions, load_cast_suggestions,
    create_rep_from_suggestion, ignore_cast_suggestion,
    merge_suggestion_into_rep, character_completeness,
    add_reference_asset, replace_reference_asset, build_ref_prompts,
    validation_readiness, VisualBibleV2Error,
)
from studio.visual_prompt import generate_all, load_prompts
from studio.visual_dependencies import compute_impact, apply_impact
from studio.scene_planner import scene_planner, compute_file_sha256


CAREGIVER_SCENES = [
    ("scene_001",
     "If its mother is occupied, another familiar caregiver may be close. "
     "The infant stays near the group."),
    ("scene_002",
     "For caregivers who were not close relatives, reciprocity mattered. "
     "The mother rested while others watched."),
    ("scene_003",
     "An infant lying alone faces danger, but an infant carried by a caregiver "
     "with other people nearby is safer."),
]


def build_caregiver_project(root: Path, name: str = "proj_care") -> Path:
    p = build_foundation_project(root, name)
    data = load_json(p / "scene_plan.json")
    for sid, narr in CAREGIVER_SCENES:
        sc = next(s for s in data["scenes"] if s["scene_id"] == sid)
        sc["narration"] = narr
        sc["category"] = "reconstruction"
    (p / "scene_plan.json").write_text(json.dumps(data, indent=2), encoding="utf-8")
    script = " ".join(n for _, n in CAREGIVER_SCENES)
    (p / "script.txt").write_text(script, encoding="utf-8")
    return p


class TestEntitySemantics(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="unfoldiq_test_castsem_"))
        self.project = build_foundation_project(self.tmp)
        migrate_to_v2(self.project)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_group_taxonomy(self):
        bible = load_bible(self.project)
        kinds = {c["characterId"]: c.get("entityKind") for c in bible["characters"]}
        self.assertEqual(kinds["subject_alpha_01"], "SUBJECT_GROUP")
        self.assertEqual(kinds["subject_beta_01"], "ANIMAL_SUBJECT")

    def test_rep_requires_source_and_status(self):
        with self.assertRaises(VisualBibleV2Error):
            create_entity(self.project, "character",
                          {"characterId": "char_x_01", "entityKind": "REPRESENTATIVE_CHARACTER",
                           "name": "X"})
        rep = create_entity(self.project, "character",
                            {"characterId": "char_x_01", "entityKind": "REPRESENTATIVE_CHARACTER",
                             "name": "X", "role": "primary caregiver",
                             "sourceSubjectId": "subject_alpha_01"})
        self.assertEqual(rep["historicalStatus"], "RECONSTRUCTED_REPRESENTATIVE")
        self.assertTrue(rep["canonicalDescription"])
        self.assertIn("resolvedSubjectHash", rep)
        self.assertTrue(rep["recurring"])

    def test_rep_unknown_source_rejected(self):
        with self.assertRaises(VisualBibleV2Error):
            create_entity(self.project, "character",
                          {"characterId": "char_y_01", "entityKind": "REPRESENTATIVE_CHARACTER",
                           "name": "Y", "role": "r", "sourceSubjectId": "NOPE"})

    def test_character_family(self):
        for rid, role in (("char_a_mother_01", "primary caregiver"),
                          ("char_a_infant_01", "infant"),
                          ("char_a_second_01", "secondary caregiver")):
            create_entity(self.project, "character",
                          {"characterId": rid, "entityKind": "REPRESENTATIVE_CHARACTER",
                           "name": role, "role": role, "sourceSubjectId": "subject_alpha_01"})
        bible = load_bible(self.project)
        family = [c["characterId"] for c in bible["characters"]
                  if c.get("sourceSubjectId") == "subject_alpha_01"]
        self.assertEqual(len(family), 3)


class TestCastSuggestions(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="unfoldiq_test_castsugg_"))
        self.project = build_caregiver_project(self.tmp)
        migrate_to_v2(self.project)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_recurring_roles_suggested(self):
        res = analyze_cast_suggestions(self.project)
        by_role = {s["role"]: s for s in res["suggestions"]}
        for role in ("primary_caregiver", "infant", "secondary_caregiver"):
            self.assertIn(role, by_role, list(by_role))
            self.assertEqual(by_role[role]["strength"], "SUGGESTED")
            self.assertGreaterEqual(by_role[role]["matchCount"], 2)
            self.assertTrue(by_role[role]["sceneIds"])
            self.assertTrue(by_role[role]["evidence"])
        self.assertEqual(by_role["primary_caregiver"]["sourceSubjectId"], "subject_alpha_01")

    def test_single_incidental_not_suggested(self):
        res = analyze_cast_suggestions(self.project)
        roles = {s["role"] for s in res["suggestions"] if s["strength"] == "SUGGESTED"}
        # no role invented from thin air; every suggestion has >=2 scenes
        for s in res["suggestions"]:
            if s["strength"] == "SUGGESTED":
                self.assertGreaterEqual(len(s["sceneIds"]), 2)

    def test_ignore_create_merge(self):
        analyze_cast_suggestions(self.project)
        payload = load_cast_suggestions(self.project)
        first = payload["suggestions"][0]["suggestionId"]
        ignore_cast_suggestion(self.project, first)
        self.assertEqual(load_cast_suggestions(self.project)["suggestions"][0]["status"], "IGNORED")
        # re-analyze preserves decision
        analyze_cast_suggestions(self.project)
        again = next(s for s in load_cast_suggestions(self.project)["suggestions"]
                     if s["suggestionId"] == first)
        self.assertEqual(again["status"], "IGNORED")
        # create from another suggestion
        second = next(s for s in load_cast_suggestions(self.project)["suggestions"]
                      if s["status"] == "OPEN")
        rep = create_rep_from_suggestion(self.project, second["suggestionId"])
        self.assertEqual(rep["entityKind"], "REPRESENTATIVE_CHARACTER")
        self.assertEqual(rep["sourceSubjectId"], second["sourceSubjectId"])
        # merge a third into the created rep with binding
        third = next((s for s in load_cast_suggestions(self.project)["suggestions"]
                      if s["status"] == "OPEN"), None)
        if third:
            res = merge_suggestion_into_rep(self.project, third["suggestionId"],
                                            rep["characterId"], bind_scenes=True)
            self.assertEqual(res["mergedInto"], rep["characterId"])
            self.assertTrue(res["boundScenes"])


class TestSceneBindings(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="unfoldiq_test_castbind_"))
        self.project = build_caregiver_project(self.tmp)
        migrate_to_v2(self.project)
        self.rep = make_rep(self.project, "char_care_mother_01")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_subject_and_cast_coexist(self):
        bind_rep(self.project, "scene_001", self.rep["characterId"])
        data = load_json(self.project / "scene_plan.json")
        sc = next(s for s in data["scenes"] if s["scene_id"] == "scene_001")
        self.assertIn(self.rep["characterId"], sc["characterIds"])
        from studio.visual_prompt import backfill_scene_visual
        bible = load_bible(self.project)
        full = backfill_scene_visual(dict(sc), bible)
        self.assertIn("subject_alpha_01", full["subjectIds"])
        self.assertIn(self.rep["characterId"], full["characterIds"])

    def test_scene_035_pattern(self):
        infant = make_rep(self.project, "char_care_infant_01", role="infant")
        second = make_rep(self.project, "char_care_second_01", role="secondary caregiver")
        bind_rep(self.project, "scene_001", self.rep["characterId"])
        bind_rep(self.project, "scene_001", infant["characterId"])
        bind_rep(self.project, "scene_001", second["characterId"])
        data = load_json(self.project / "scene_plan.json")
        sc = next(s for s in data["scenes"] if s["scene_id"] == "scene_001")
        self.assertEqual(len(sc["characterIds"]), 3)

    def test_no_character_per_scene_explosion(self):
        # one rep reused across two scenes, not duplicated per scene
        bind_rep(self.project, "scene_001", self.rep["characterId"])
        bind_rep(self.project, "scene_002", self.rep["characterId"])
        bible = load_bible(self.project)
        reps = [c for c in bible["characters"]
                if c.get("entityKind") == "REPRESENTATIVE_CHARACTER"]
        self.assertEqual(len(reps), 1)


class TestCastInvalidation(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="unfoldiq_test_castinv_"))
        self.project = build_caregiver_project(self.tmp)
        migrate_to_v2(self.project)
        self.rep = make_rep(self.project, "char_care_mother_01")
        bind_rep(self.project, "scene_001", self.rep["characterId"])
        bind_rep(self.project, "scene_002", self.rep["characterId"])
        generate_all(self.project)
        reset_outdated(self.project)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _outdated_shots(self):
        return sorted(s["shot_id"] for s in
                      load_json(self.project / "veo_prompts.json")["shots"]
                      if s.get("outdated"))

    def test_rep_change_scoped(self):
        from studio.visual_bible_v2 import update_entity_v2
        update_entity_v2(self.project, "character", self.rep["characterId"],
                         {"hair": "changed anchor"})
        imp = compute_impact(self.project, {"kind": "character",
                                            "id": self.rep["characterId"]})
        # only explicitly bound scenes — NOT all group-member scenes
        self.assertEqual(imp["affectedScenes"], ["scene_001", "scene_002"])
        res = apply_impact(self.project, imp)
        self.assertEqual(res["markedShots"], 3)
        outdated = self._outdated_shots()
        self.assertNotIn("shot_003_01", outdated)
        self.assertEqual(len(outdated), 3)

    def test_group_change_covers_derived(self):
        from studio.visual_bible_v2 import update_entity_v2
        update_entity_v2(self.project, "character", "subject_alpha_01",
                         {"hair": "group morphology changed"})
        imp = compute_impact(self.project, {"kind": "character", "id": "subject_alpha_01"})
        self.assertIn("scene_001", imp["affectedScenes"])
        self.assertIn("scene_002", imp["affectedScenes"])

    def test_ref_replace_scoped(self):
        from studio.visual_bible_v2 import character_completeness
        png = make_png_bytes()
        for view in ("FRONT", "THREE_QUARTER", "PROFILE"):
            add_reference_asset(self.project, "CHARACTER", self.rep["characterId"],
                                view, f"{view.lower()}.png", png)
        self.assertEqual(character_completeness(
            load_bible(self.project), self.rep["characterId"])["status"], "READY")
        replace_reference_asset(self.project,
                                f"REF_{self.rep['characterId'].upper()}_FRONT",
                                "front.png", png)
        imp = compute_impact(self.project, {"kind": "referenceAsset",
                                            "entityType": "CHARACTER",
                                            "entityId": self.rep["characterId"],
                                            "assetId": "x"})
        self.assertEqual(imp["affectedScenes"], ["scene_001", "scene_002"])
        res = apply_impact(self.project, imp)
        self.assertEqual(res["markedShots"], 3)

    def test_binding_change_scoped(self):
        bind_rep(self.project, "scene_003", self.rep["characterId"])
        outdated = self._outdated_shots()
        self.assertEqual(outdated, ["shot_003_01"])

    def test_auto_reset(self):
        scene_planner.update_scene(self.project, "scene_001", {"selectedOutputType": "VEO"})
        data = load_json(self.project / "scene_plan.json")
        sc = next(s for s in data["scenes"] if s["scene_id"] == "scene_001")
        self.assertEqual(sc["selectedOutputType"], "VEO")
        scene_planner.update_scene(self.project, "scene_001", {"selectedOutputType": None})
        data = load_json(self.project / "scene_plan.json")
        sc = next(s for s in data["scenes"] if s["scene_id"] == "scene_001")
        self.assertIsNone(sc.get("selectedOutputType"))
        scene_planner.update_scene(self.project, "scene_001", {"selectedOutputType": "AUTO"})
        data = load_json(self.project / "scene_plan.json")
        sc = next(s for s in data["scenes"] if s["scene_id"] == "scene_001")
        self.assertIsNone(sc.get("selectedOutputType"))


class TestRefPromptPack(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="unfoldiq_test_refpack_"))
        self.project = build_foundation_project(self.tmp)
        migrate_to_v2(self.project)
        self.rep = make_rep(self.project)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_pack_sections(self):
        pack = build_ref_prompts(self.project, self.rep["characterId"])
        for view in ("FRONT", "THREE_QUARTER", "PROFILE"):
            self.assertIn(view, pack)
        self.assertIn("front-facing", pack["FRONT"])
        self.assertIn("three-quarter", pack["THREE_QUARTER"].lower())
        self.assertIn("profile", pack["PROFILE"].lower())
        self.assertIn("SAME character", pack["THREE_QUARTER"])
        self.assertIn("not a historically documented individual", pack["FRONT"])
        self.assertEqual(pack["historicalStatus"], "RECONSTRUCTED_REPRESENTATIVE")

    def test_pack_rejects_group(self):
        with self.assertRaises(VisualBibleV2Error):
            build_ref_prompts(self.project, "subject_alpha_01")


class TestValidationReadiness(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="unfoldiq_test_readiness_"))
        self.project = build_caregiver_project(self.tmp)
        migrate_to_v2(self.project)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_layers(self):
        r = validation_readiness(self.project)
        self.assertEqual(r["visualFoundation"], "READY")
        self.assertEqual(r["representativeCast"], "REVIEW")
        self.assertEqual(r["externalValidation"], "BLOCKED")
        self.assertTrue(r["blockers"])


if __name__ == "__main__":
    unittest.main()
