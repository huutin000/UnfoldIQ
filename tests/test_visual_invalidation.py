"""Phase 12–13 — Invalidation matrix (§40/§57), multi-project (§58),
backward compatibility (§59)."""

import json
import shutil
import tempfile
import unittest
from pathlib import Path

import sys
BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from tests.visual_foundation_fixtures import build_foundation_project, load_json
from studio.visual_bible_v2 import migrate_to_v2, load_bible, update_entity_v2
from studio.visual_prompt import generate_all, load_prompts
from studio.visual_dependencies import compute_impact, apply_impact
from studio.visual_continuity import visual_continuity_director
from studio.scene_planner import compute_file_sha256


class MatrixCase(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="unfoldiq_test_invmat_"))
        self.project = build_foundation_project(self.tmp)
        migrate_to_v2(self.project)
        generate_all(self.project)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _veo(self):
        return load_json(self.project / "veo_prompts.json")

    def test_A_character_local(self):
        update_entity_v2(self.project, "character", "subject_beta_01", {"hair": "changed"})
        imp = compute_impact(self.project, {"kind": "character", "id": "subject_beta_01"})
        # beta only in scene_002 (2 shots), NOT in scene_001/scene_003
        self.assertEqual(imp["affectedScenes"], ["scene_002"])
        self.assertEqual(imp["affectedShots"], ["shot_002_01", "shot_002_02"])
        res = apply_impact(self.project, imp)
        self.assertEqual(res["markedVisualPrompts"], 1)
        self.assertEqual(res["markedShots"], 2)
        outdated = [s["shot_id"] for s in self._veo()["shots"] if s.get("outdated")]
        self.assertEqual(sorted(outdated), ["shot_002_01", "shot_002_02"])

    def test_C_environment_local(self):
        imp = compute_impact(self.project, {"kind": "environment", "id": "env_plains_01"})
        self.assertEqual(imp["affectedScenes"], ["scene_001"])
        res = apply_impact(self.project, imp)
        self.assertEqual(res["markedShots"], 1)

    def test_D_object_local(self):
        imp = compute_impact(self.project, {"kind": "object", "id": "prop_tool_01"})
        self.assertEqual(imp["affectedScenes"], ["scene_001"])

    def test_E_style_global_visual_only(self):
        audio_before = compute_file_sha256(self.project / "audio.wav")
        qa_before = compute_file_sha256(self.project / "voice_qa.json")
        ts_before = compute_file_sha256(self.project / "timestamps.json")
        imp = compute_impact(self.project, {"kind": "style"})
        self.assertEqual(len(imp["affectedScenes"]), 3)
        apply_impact(self.project, imp)
        self.assertEqual(compute_file_sha256(self.project / "audio.wav"), audio_before)
        self.assertEqual(compute_file_sha256(self.project / "voice_qa.json"), qa_before)
        self.assertEqual(compute_file_sha256(self.project / "timestamps.json"), ts_before)
        self.assertEqual(sum(1 for s in self._veo()["shots"] if s.get("outdated")), 4)

    def test_F_scene_composition_local(self):
        from studio.scene_planner import scene_planner
        scene_planner.update_scene(self.project, "scene_003", {"composition": "close-up"})
        outdated = [s["shot_id"] for s in self._veo()["shots"] if s.get("outdated")]
        self.assertEqual(outdated, ["shot_003_01"])

    def test_H_selected_output_local(self):
        from studio.scene_planner import scene_planner
        scene_planner.update_scene(self.project, "scene_001",
                                   {"selectedOutputType": "VEO"})
        outdated = [s["shot_id"] for s in self._veo()["shots"] if s.get("outdated")]
        self.assertEqual(outdated, ["shot_001_01"])

    def test_K_ui_notes_zero_invalidation(self):
        update_entity_v2(self.project, "character", "subject_alpha_01",
                         {"notes": "curator note", "reviewNotes": "r"})
        imp = compute_impact(self.project, {"kind": "character", "id": "subject_alpha_01"})
        # notes are hash-excluded: entity prompt hash unchanged -> no stale entries
        from studio.visual_bible_v2 import compute_entity_prompt_hash
        bible = load_bible(self.project)
        ent = next(c for c in bible["characters"] if c["characterId"] == "subject_alpha_01")
        self.assertNotIn("notes", str(compute_entity_prompt_hash(ent, "character")))
        # apply path marks by binding, but visual prompt hashes still verify CURRENT:
        from studio.visual_prompt import check_entry_status, backfill_scene_visual, load_prompts as lp
        entries = {e["sceneId"]: e for e in lp(self.project)["entries"]}
        scenes = {s["scene_id"]: s for s in load_json(self.project / "scene_plan.json")["scenes"]}
        status, _ = check_entry_status(
            entries["scene_001"],
            backfill_scene_visual(dict(scenes["scene_001"]), bible), bible)
        self.assertEqual(status, "CURRENT")

    def test_I_timestamp_keeps_vb_identity(self):
        ts = load_json(self.project / "timestamps.json")
        ts["segments"] = [{"index": 1, "text": "x", "start": 0.0, "end": 1.0}]
        (self.project / "timestamps.json").write_text(json.dumps(ts, indent=2), encoding="utf-8")
        st = visual_continuity_director.check_visual_bible_status(self.project)
        self.assertEqual(st["status"], "Ready")

    def test_J_wording_edit_keeps_vb_ready(self):
        script = (self.project / "script.txt").read_text(encoding="utf-8")
        (self.project / "script.txt").write_text(
            "Skilfully, stone tools were shaped at Olduvai Gorge by Homo habilis. " +
            "The group shared knowledge across generations. " +
            "Firelight extended their working day into the night.", encoding="utf-8")
        self.assertNotEqual(script, (self.project / "script.txt").read_text(encoding="utf-8"))
        st = visual_continuity_director.check_visual_bible_status(self.project)
        self.assertEqual(st["status"], "Ready")

    def test_J_entity_change_stales_vb(self):
        (self.project / "script.txt").write_text(
            "Homo erectus shaped stone tools at Olduvai Gorge. Nothing else changed here.",
            encoding="utf-8")
        st = visual_continuity_director.check_visual_bible_status(self.project)
        self.assertEqual(st["status"], "Stale")


class TestMultiProject(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="unfoldiq_test_vbmp_"))
        self.a = build_foundation_project(self.tmp, name="proj_A")
        self.b = build_foundation_project(self.tmp, name="proj_B")
        migrate_to_v2(self.a)
        migrate_to_v2(self.b)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_isolation(self):
        update_entity_v2(self.a, "character", "subject_alpha_01", {"hair": "A-hair"})
        ha = load_bible(self.a)["visualBibleHash"]
        hb = load_bible(self.b)["visualBibleHash"]
        self.assertNotEqual(ha, hb)
        ent_b = next(c for c in load_bible(self.b)["characters"]
                     if c["characterId"] == "subject_alpha_01")
        self.assertNotEqual(ent_b.get("hair"), "A-hair")
        imp_b = compute_impact(self.b, {"kind": "character", "id": "subject_alpha_01"})
        self.assertEqual(imp_b["affectedScenes"], ["scene_001", "scene_002"])

    def test_blank_unknown_project(self):
        from studio.visual_bible_v2 import resolve_project_dir, VisualBibleV2Error
        with self.assertRaises(VisualBibleV2Error):
            resolve_project_dir("../escape")


class TestBackwardCompat(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="unfoldiq_test_vbcompat_"))
        self.project = build_foundation_project(self.tmp)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_legacy_opens_v2_not_started(self):
        from studio.visual_bible_v2 import load_bible
        bible = load_bible(self.project)
        self.assertFalse(str(bible.get("schemaVersion", "")).startswith("2."))
        self.assertEqual(bible.get("characters", []), [])
        # legacy scenes/veo readable
        self.assertEqual(len(load_json(self.project / "scene_plan.json")["scenes"]), 3)
        self.assertEqual(len(load_json(self.project / "veo_prompts.json")["shots"]), 4)

    def test_phase11_export_survives_on_legacy(self):
        import studio.production_export as aspex
        orig = aspex.PROJECTS_DIR
        aspex.PROJECTS_DIR = self.tmp
        try:
            res = aspex.execute_export(self.project.name)
            self.assertEqual(res["shotCount"], 4)
        finally:
            aspex.PROJECTS_DIR = orig

    def test_phase11_export_survives_after_migration(self):
        import studio.production_export as aspex
        migrate_to_v2(self.project)
        orig = aspex.PROJECTS_DIR
        aspex.PROJECTS_DIR = self.tmp
        try:
            res = aspex.execute_export(self.project.name)
            self.assertEqual(res["shotCount"], 4)
        finally:
            aspex.PROJECTS_DIR = orig


if __name__ == "__main__":
    unittest.main()
