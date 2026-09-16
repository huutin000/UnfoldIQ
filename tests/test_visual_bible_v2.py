"""Phase 13 — Visual Bible V2 tests (§55): migration, CRUD, style, refs, hashes."""

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
    build_foundation_project, load_json, make_png_bytes, make_rep,
)
from studio.visual_bible_v2 import (
    VB_SCHEMA_V2, VB_SCHEMA_V2_1, migrate_to_v2, load_bible, create_entity, update_entity_v2,
    delete_entity, get_style, update_style, apply_preset, load_presets,
    add_reference_asset, replace_reference_asset, remove_reference_asset,
    resolve_asset_path, character_completeness, compute_entity_prompt_hash,
    compute_bible_v2_hash, script_entity_signature, VisualBibleV2Error,
)


class TestMigration(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="unfoldiq_test_vbv2_"))
        self.project = build_foundation_project(self.tmp)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_migrate_preserves_entities_and_ids(self):
        before = load_json(self.project / "visual_bible.json")
        res = migrate_to_v2(self.project)
        self.assertTrue(res["migrated"])
        after = load_bible(self.project)
        self.assertEqual(after["schemaVersion"], VB_SCHEMA_V2_1)
        self.assertEqual([c["characterId"] for c in after["characters"]],
                         [s["subjectId"] for s in before["subjects"]])
        self.assertEqual([o["objectId"] for o in after["objects"]],
                         [p["propId"] for p in before["props"]])
        self.assertEqual(len(after["environments"]), len(before["environments"]))
        self.assertEqual(len(after["continuityGroups"]), len(before["continuityGroups"]))
        # legacy aliases intact
        self.assertEqual(after["subjects"], before["subjects"])
        self.assertEqual(after["props"], before["props"])

    def test_migrate_preserves_manual_edits(self):
        res = migrate_to_v2(self.project)
        self.assertEqual(res["migration"]["preservedManualEdits"], 1)
        after = load_bible(self.project)
        beta = next(c for c in after["characters"] if c["characterId"] == "subject_beta_01")
        self.assertTrue(beta["manualEdited"])

    def test_migrate_idempotent(self):
        migrate_to_v2(self.project)
        res2 = migrate_to_v2(self.project)
        self.assertTrue(res2.get("already"))

    def test_migrate_rebases_veo_hash(self):
        res = migrate_to_v2(self.project)
        self.assertIn("veo_prompts.json.sourceVisualBibleHash", res["rebased"])
        veo = load_json(self.project / "veo_prompts.json")
        bible = load_bible(self.project)
        self.assertEqual(veo["sourceVisualBibleHash"], bible["visualBibleHash"])

    def test_engine_version_stable(self):
        migrate_to_v2(self.project)
        self.assertEqual(load_bible(self.project)["generatorVersion"], "10.0.0")

    def test_legacy_alias_edit_keeps_v2_hash(self):
        from studio.visual_continuity import visual_continuity_director
        migrate_to_v2(self.project)
        before = load_bible(self.project)["visualBibleHash"]
        visual_continuity_director.update_entity(
            self.project, entity_type="subjects",
            entity_id="subject_alpha_01", updates={"notes": "curator note"})
        after = load_bible(self.project)
        self.assertEqual(after["visualBibleHash"], before)
        # legacy twin synced, V2 character synced (single source, dual view)
        twin = next(s for s in after["subjects"] if s["subjectId"] == "subject_alpha_01")
        char = next(c for c in after["characters"] if c["characterId"] == "subject_alpha_01")
        self.assertEqual(twin["notes"], "curator note")
        self.assertEqual(char["notes"], "curator note")


class TestEntityCrud(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="unfoldiq_test_vbv2c_"))
        self.project = build_foundation_project(self.tmp)
        migrate_to_v2(self.project)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_create_character_and_legacy_sync(self):
        ent = create_entity(self.project, "character",
                            {"characterId": "CHAR_NEW_01", "name": "New",
                             "visualDescription": "A newcomer."})
        self.assertEqual(ent["characterId"], "CHAR_NEW_01")
        bible = load_bible(self.project)
        self.assertTrue(any(s.get("subjectId") == "CHAR_NEW_01" for s in bible["subjects"]))

    def test_create_duplicate_rejected(self):
        with self.assertRaises(VisualBibleV2Error):
            create_entity(self.project, "character",
                          {"characterId": "subject_alpha_01", "name": "Dup"})

    def test_create_bad_id_rejected(self):
        with self.assertRaises(VisualBibleV2Error):
            create_entity(self.project, "character",
                          {"characterId": "../evil", "name": "Evil"})

    def test_update_prompt_affecting_flag(self):
        _, affecting = update_entity_v2(self.project, "character", "subject_alpha_01",
                                        {"hair": "new anchor"})
        self.assertTrue(affecting)
        _, affecting2 = update_entity_v2(self.project, "character", "subject_alpha_01",
                                         {"notes": "just a note", "status": "READY"})
        self.assertFalse(affecting2)

    def test_delete_blocked_when_referenced(self):
        with self.assertRaises(VisualBibleV2Error):
            delete_entity(self.project, "character", "subject_alpha_01")
        res = delete_entity(self.project, "character", "subject_alpha_01", force=True)
        self.assertTrue(res["deleted"])
        self.assertIn("scene_001", res["affectedScenes"])

    def test_environment_object_crud(self):
        create_entity(self.project, "environment",
                      {"environmentId": "ENV_NEW_01", "name": "New land"})
        create_entity(self.project, "object",
                      {"objectId": "OBJ_NEW_01", "name": "New thing"})
        bible = load_bible(self.project)
        self.assertIn("ENV_NEW_01", [e["environmentId"] for e in bible["environments"]])
        self.assertIn("OBJ_NEW_01", [o["objectId"] for o in bible["objects"]])


class TestStylePreset(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="unfoldiq_test_vbstyle_"))
        self.project = build_foundation_project(self.tmp)
        migrate_to_v2(self.project)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_style_project_scoped(self):
        style = get_style(self.project)
        self.assertIn("presetId", style)
        self.assertIn("resolvedStyleSnapshot", style)

    def test_global_preset_has_no_entities(self):
        for p in load_presets():
            for key in ("characters", "environments", "objects",
                        "referenceAssets", "referenceassets"):
                self.assertNotIn(key, p)

    def test_preset_update_explicit(self):
        before = get_style(self.project)
        self.assertEqual(before["presetId"], "preset_documentary_photorealism")
        apply_preset(self.project, "preset_unfoldiq_editorial_hybrid")
        after = get_style(self.project)
        self.assertEqual(after["presetId"], "preset_unfoldiq_editorial_hybrid")
        self.assertEqual(after["resolvedStyleSnapshot"]["presetId"],
                         "preset_unfoldiq_editorial_hybrid")

    def test_style_update_affecting(self):
        # styleName lands in the composed STYLE line -> prompt-affecting.
        res = update_style(self.project, {"styleName": "Renamed"})
        self.assertTrue(res["promptAffecting"])
        # unknown keys are ignored -> non-affecting.
        res2 = update_style(self.project, {"notes": "curator note"})
        self.assertFalse(res2["promptAffecting"])


class TestReferenceAssets(unittest.TestCase):
    REP = "char_alpha_caregiver_01"
    ASSET_FRONT = "REF_CHAR_ALPHA_CAREGIVER_01_FRONT"

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="unfoldiq_test_ref_"))
        self.project = build_foundation_project(self.tmp)
        migrate_to_v2(self.project)
        make_rep(self.project, self.REP)
        self.png = make_png_bytes()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_group_ref_rejected(self):
        with self.assertRaises(VisualBibleV2Error) as ctx:
            add_reference_asset(self.project, "CHARACTER", "subject_alpha_01",
                                "FRONT", "front.png", self.png)
        self.assertIn("not an individual", str(ctx.exception))

    def test_group_completeness_not_applicable(self):
        comp = character_completeness(load_bible(self.project), "subject_alpha_01")
        self.assertEqual(comp["status"], "NOT_APPLICABLE")

    def test_add_preview_completeness(self):
        for view in ("FRONT", "THREE_QUARTER", "PROFILE"):
            meta = add_reference_asset(self.project, "CHARACTER", self.REP,
                                       view, f"{view.lower()}.png", self.png)
            self.assertTrue(meta["assetId"].endswith(view))
        bible = load_bible(self.project)
        comp = character_completeness(bible, self.REP)
        self.assertEqual(comp["status"], "READY")
        self.assertEqual(comp["viewsMissing"], [])
        target = resolve_asset_path(self.project, self.ASSET_FRONT)
        self.assertTrue(target.is_file())
        rel = str(target.relative_to(self.project)).replace("\\", "/")
        self.assertTrue(rel.startswith("assets/references/"))

    def test_partial_completeness(self):
        add_reference_asset(self.project, "CHARACTER", self.REP,
                            "FRONT", "front.png", self.png)
        comp = character_completeness(load_bible(self.project), self.REP)
        self.assertEqual(comp["status"], "PARTIAL")

    def test_reject_bad_extension(self):
        with self.assertRaises(VisualBibleV2Error):
            add_reference_asset(self.project, "CHARACTER", self.REP,
                                "FRONT", "evil.exe", b"MZ")

    def test_reject_unknown_entity(self):
        with self.assertRaises(VisualBibleV2Error):
            add_reference_asset(self.project, "CHARACTER", "CHAR_NOPE",
                                "FRONT", "front.png", self.png)

    def test_duplicate_asset_rejected(self):
        add_reference_asset(self.project, "CHARACTER", self.REP,
                            "FRONT", "front.png", self.png)
        with self.assertRaises(VisualBibleV2Error):
            add_reference_asset(self.project, "CHARACTER", self.REP,
                                "FRONT", "front2.png", self.png)

    def test_replace_and_remove(self):
        add_reference_asset(self.project, "CHARACTER", self.REP,
                            "FRONT", "front.png", self.png)
        meta = replace_reference_asset(self.project, self.ASSET_FRONT,
                                       "front.png", self.png)
        self.assertEqual(meta["assetId"], self.ASSET_FRONT)
        res = remove_reference_asset(self.project, self.ASSET_FRONT)
        self.assertTrue(res["removed"])
        comp = character_completeness(load_bible(self.project), self.REP)
        self.assertEqual(comp["status"], "NOT_STARTED")


class TestHashes(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="unfoldiq_test_vbhash_"))
        self.project = build_foundation_project(self.tmp)
        migrate_to_v2(self.project)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_ui_only_change_keeps_hash(self):
        bible = load_bible(self.project)
        ent = next(c for c in bible["characters"] if c["characterId"] == "subject_alpha_01")
        h1 = compute_entity_prompt_hash(ent, "character")
        ent2 = dict(ent, notes="ui note", status="READY", manualEdited=True)
        self.assertEqual(h1, compute_entity_prompt_hash(ent2, "character"))

    def test_identity_change_moves_hash(self):
        bible = load_bible(self.project)
        ent = next(c for c in bible["characters"] if c["characterId"] == "subject_alpha_01")
        h1 = compute_entity_prompt_hash(ent, "character")
        ent2 = dict(ent, hair="totally different anchor")
        self.assertNotEqual(h1, compute_entity_prompt_hash(ent2, "character"))

    def test_entity_signature_stable_for_wording(self):
        a = "Homo habilis shaped stone tools at Olduvai Gorge with great skill today."
        b = "Skilfully today, stone tools were shaped at Olduvai Gorge by Homo habilis."
        self.assertEqual(script_entity_signature(a), script_entity_signature(b))

    def test_entity_signature_moves_for_new_taxon(self):
        a = "Homo habilis shaped stone tools at Olduvai Gorge."
        b = "Homo erectus shaped stone tools at Olduvai Gorge."
        self.assertNotEqual(script_entity_signature(a), script_entity_signature(b))


if __name__ == "__main__":
    unittest.main()
