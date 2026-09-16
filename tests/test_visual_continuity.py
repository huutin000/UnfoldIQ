"""
Unit tests for Hidden Visual Continuity Director (Phase 10).
Covers:
- Visual Bible derivation and canonical schema validation
- Stable entity identity, hashing, and fingerprints
- Multi-rule continuity validation (PASS, WARNING, ERROR)
- Shot Count Guard: Visual Bible must NEVER alter shot count or shot timing
- Partial Veo invalidation
- Manual edit persistence
- Multi-project isolation
- FastAPI endpoints for Visual Bible
"""

import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path
from starlette.testclient import TestClient

from studio.app import app
from studio.visual_continuity import (
    VisualContinuityDirector,
    compute_visual_bible_hash,
    derive_visual_bible_from_scenes,
    VISUAL_BIBLE_SCHEMA_VERSION,
    VISUAL_CONTINUITY_VERSION,
)
from studio.veo_prompt_generator import (
    VeoPromptGenerator,
    CURRENT_GENERATOR_VERSION,
)


class TestVisualContinuityCore(unittest.TestCase):
    def setUp(self):
        self.test_dir = Path(tempfile.mkdtemp(prefix="unfoldiq_test_vc_core_"))
        self.director = VisualContinuityDirector()

    def tearDown(self):
        if self.test_dir.exists():
            shutil.rmtree(self.test_dir)

    def test_derive_visual_bible_from_scenes(self):
        scenes = [
            {
                "sceneNumber": 1,
                "heading": "EXT. SAVANNAH - DAWN",
                "visualDescription": "Homo erectus hominid band traverses dry savanna plain near acacia grove.",
                "subjects": ["Homo erectus band"],
                "environments": ["East African savannah grassland"],
                "period": "Early Pleistocene",
                "props": ["Wooden digging sticks", "Stone handaxe"],
                "lighting": "Golden sunrise with low mist",
                "weather": "Dry, clear morning sky",
                "continuityGroup": "Savannah Trek",
            },
            {
                "sceneNumber": 2,
                "heading": "EXT. RIVERBANK - DAY",
                "visualDescription": "The Homo erectus hominid band approaches muddy riverbank with river stones.",
                "subjects": ["Homo erectus band"],
                "environments": ["Muddy riverbank with basalt rocks"],
                "period": "Early Pleistocene",
                "props": ["Stone handaxe"],
                "lighting": "Bright midday equatorial sunlight",
                "weather": "Dry, hot sun",
                "continuityGroup": "Savannah Trek",
            },
        ]
        bible = derive_visual_bible_from_scenes(scenes)
        self.assertEqual(bible["schemaVersion"], VISUAL_BIBLE_SCHEMA_VERSION)
        self.assertEqual(bible["generatorVersion"], VISUAL_CONTINUITY_VERSION)
        self.assertTrue(len(bible["subjects"]) >= 1)
        self.assertTrue(len(bible["environments"]) >= 1)
        self.assertTrue(len(bible["periods"]) >= 1)
        self.assertTrue(len(bible["continuityGroups"]) >= 1)

        # Stable hashing
        h1 = compute_visual_bible_hash(bible)
        h2 = compute_visual_bible_hash(bible)
        self.assertEqual(h1, h2)
        self.assertEqual(len(h1), 64)

    def test_atomic_persistence_and_load(self):
        scene_plan = {
            "schemaVersion": "1.0.0",
            "scenes": [
                {
                    "sceneNumber": 1,
                    "heading": "INT. ARCHIVE ROOM - NIGHT",
                    "visualDescription": "Researcher examines ancient clay tablet under desk lamp.",
                    "subjects": ["Elderly archaeologist"],
                    "environments": ["Dusty archive room with wooden shelves"],
                    "period": "Modern Late 20th Century",
                    "props": ["Clay tablet", "Desk lamp"],
                    "lighting": "Tungsten directional warm lamp",
                    "weather": "Indoor dry air",
                }
            ]
        }
        with open(self.test_dir / "scene_plan.json", "w", encoding="utf-8") as f:
            json.dump(scene_plan, f)

        bible = self.director.derive_and_save(self.test_dir)
        bible_path = self.test_dir / "visual_bible.json"
        self.assertTrue(bible_path.exists())

        loaded = self.director.get_visual_bible(self.test_dir)
        self.assertIsNotNone(loaded)
        self.assertEqual(loaded["visualBibleHash"], bible["visualBibleHash"])

    def test_manual_edit_persistence(self):
        scene_plan = {
            "schemaVersion": "1.0.0",
            "scenes": [
                {
                    "sceneNumber": 1,
                    "heading": "EXT. LAB - DAY",
                    "visualDescription": "Scientist in white lab coat tests beaker.",
                    "subjects": ["Dr. Henderson"],
                }
            ]
        }
        with open(self.test_dir / "scene_plan.json", "w", encoding="utf-8") as f:
            json.dump(scene_plan, f)

        self.director.derive_and_save(self.test_dir)
        bible = self.director.get_visual_bible(self.test_dir)
        subj_id = bible["subjects"][0]["subjectId"]

        # Apply manual edit
        updated = self.director.update_entity(
            self.test_dir,
            entity_type="subjects",
            entity_id=subj_id,
            updates={"notes": "Special silver spectacles and gray hair"},
        )
        self.assertIsNotNone(updated)

        # Reload and check manualEdited is True
        reloaded = self.director.get_visual_bible(self.test_dir)
        subj = next(s for s in reloaded["subjects"] if s["subjectId"] == subj_id)
        self.assertTrue(subj.get("manualEdited"))
        self.assertIn("silver spectacles", subj.get("notes", ""))

        # Regenerate bible from scenes: manual edit MUST be preserved
        regen = self.director.derive_and_save(self.test_dir, force=False)
        regen_subj = next(s for s in regen["subjects"] if s["subjectId"] == subj_id)
        self.assertTrue(regen_subj.get("manualEdited"))
        self.assertIn("silver spectacles", regen_subj.get("notes", ""))


class TestContinuityValidation(unittest.TestCase):
    def setUp(self):
        self.test_dir = Path(tempfile.mkdtemp(prefix="unfoldiq_test_vc_val_"))
        self.director = VisualContinuityDirector()

    def tearDown(self):
        if self.test_dir.exists():
            shutil.rmtree(self.test_dir)

    def test_pass_on_consistent_group(self):
        bible = {
            "schemaVersion": "1.0.0",
            "generatorVersion": "10.0.0",
            "createdAt": "2026-09-12T00:00:00Z",
            "updatedAt": "2026-09-12T00:00:00Z",
            "subjects": [{"subjectId": "subj_homo_erectus", "name": "Homo erectus early hominid"}],
            "environments": [{"environmentId": "env_savanna", "locationName": "East African savannah"}],
            "periods": [{"periodId": "period_pleistocene", "label": "Early Pleistocene", "forbiddenModernElements": ["modern clothing", "watch"]}],
            "props": [],
            "continuityGroups": [
                {
                    "continuityGroupId": "group_trek",
                    "label": "Savannah Trek",
                    "sceneIds": ["scene_001", "scene_002"],
                    "subjectIds": ["subj_homo_erectus"],
                    "environmentId": "env_savanna",
                    "periodId": "period_pleistocene",
                }
            ],
            "visualBibleHash": "test_hash"
        }
        scenes = [
            {
                "sceneNumber": 1,
                "sceneId": "scene_001",
                "subjects": ["subj_homo_erectus"],
                "environments": ["env_savanna"],
                "period": "Early Pleistocene",
                "continuityGroup": "Savannah Trek",
                "lighting": "Morning sun",
            },
            {
                "sceneNumber": 2,
                "sceneId": "scene_002",
                "subjects": ["subj_homo_erectus"],
                "environments": ["env_savanna"],
                "period": "Early Pleistocene",
                "continuityGroup": "Savannah Trek",
                "lighting": "Midday sun",
            },
        ]
        shots = [
            {
                "shotNumber": 1,
                "sceneNumber": 1,
                "continuityGroupId": "group_trek",
                "subjectIds": ["subj_homo_erectus"],
                "environmentId": "env_savanna",
                "periodId": "period_pleistocene",
                "visualPrompt": "Homo erectus walking across savannah grass, morning sun.",
            },
            {
                "shotNumber": 2,
                "sceneNumber": 2,
                "continuityGroupId": "group_trek",
                "subjectIds": ["subj_homo_erectus"],
                "environmentId": "env_savanna",
                "periodId": "period_pleistocene",
                "visualPrompt": "Homo erectus searching for roots in savannah grassland, midday sun.",
            },
        ]
        with open(self.test_dir / "visual_bible.json", "w", encoding="utf-8") as f:
            json.dump(bible, f)
        with open(self.test_dir / "scene_plan.json", "w", encoding="utf-8") as f:
            json.dump({"scenes": scenes}, f)
        with open(self.test_dir / "veo_prompts.json", "w", encoding="utf-8") as f:
            json.dump({"shots": shots}, f)

        res = self.director.validate_continuity(self.test_dir)
        errors = [i for i in res["issues"] if i["severity"] == "ERROR"]
        self.assertEqual(len(errors), 0)

    def test_error_on_period_forbidden_element(self):
        bible = {
            "schemaVersion": "1.0.0",
            "generatorVersion": "10.0.0",
            "createdAt": "2026-09-12T00:00:00Z",
            "updatedAt": "2026-09-12T00:00:00Z",
            "subjects": [],
            "environments": [],
            "periods": [
                {
                    "periodId": "period_pleistocene",
                    "label": "Pleistocene Epoch",
                    "forbiddenModernElements": ["wristwatch", "cellphone", "modern vehicle"],
                }
            ],
            "props": [],
            "continuityGroups": [],
            "visualBibleHash": "test_hash"
        }
        shots = [
            {
                "shotNumber": 1,
                "sceneNumber": 1,
                "periodId": "period_pleistocene",
                "visualPrompt": "A hominid checking his digital wristwatch in the wild savanna.",
            }
        ]
        with open(self.test_dir / "visual_bible.json", "w", encoding="utf-8") as f:
            json.dump(bible, f)
        with open(self.test_dir / "veo_prompts.json", "w", encoding="utf-8") as f:
            json.dump({"shots": shots}, f)

        res = self.director.validate_continuity(self.test_dir)
        errors = [i for i in res["issues"] if i["severity"] == "ERROR"]
        self.assertTrue(any("forbidden element 'wristwatch'" in i["message"] for i in errors))

    def test_error_on_unknown_reference(self):
        bible = {
            "schemaVersion": "1.0.0",
            "generatorVersion": "10.0.0",
            "createdAt": "2026-09-12T00:00:00Z",
            "updatedAt": "2026-09-12T00:00:00Z",
            "subjects": [{"subjectId": "subj_1"}],
            "environments": [],
            "periods": [],
            "props": [],
            "continuityGroups": [],
            "visualBibleHash": "test_hash"
        }
        shots = [
            {
                "shotNumber": 1,
                "sceneNumber": 1,
                "subjectIds": ["subj_unknown_99"],
                "environmentId": "env_nonexistent",
                "visualPrompt": "Test prompt.",
            }
        ]
        with open(self.test_dir / "visual_bible.json", "w", encoding="utf-8") as f:
            json.dump(bible, f)
        with open(self.test_dir / "veo_prompts.json", "w", encoding="utf-8") as f:
            json.dump({"shots": shots}, f)

        res = self.director.validate_continuity(self.test_dir)
        errors = [i for i in res["issues"] if i["severity"] == "ERROR"]
        self.assertTrue(any("unknown subjectId 'subj_unknown_99'" in i["message"].lower() or "subj_unknown_99" in i["message"] for i in errors))
        self.assertTrue(any("unknown environmentId 'env_nonexistent'" in i["message"].lower() or "env_nonexistent" in i["message"] for i in errors))


class TestShotCountGuard(unittest.TestCase):
    """
    CRITICAL REQUIREMENT (Section 30 & Section 76):
    Visual continuity metadata alone must NEVER increment or decrement shot count
    for an unchanged Scene Plan.
    """
    def test_shot_count_identical_with_and_without_visual_bible(self):
        scenes_variations = [
            # Single scene, single beat
            [
                {
                    "sceneNumber": 1,
                    "scene_id": "scene_001",
                    "start": 0.0,
                    "end": 4.5,
                    "startTime": 0.0,
                    "endTime": 4.5,
                    "duration": 4.5,
                    "heading": "EXT. FOREST - DAY",
                    "visualDescription": "Dense pine woods in mist.",
                    "subjects": ["Lone traveler"],
                    "environments": ["Pine woods"],
                    "visualBeats": ["Traveler walks"],
                }
            ],
            # Multi-scene with multi-beats
            [
                {
                    "sceneNumber": 1,
                    "scene_id": "scene_001",
                    "start": 0.0,
                    "end": 7.2,
                    "startTime": 0.0,
                    "endTime": 7.2,
                    "duration": 7.2,
                    "heading": "EXT. OCEAN - DUSK",
                    "visualDescription": "Waves crashing against sea cliffs.",
                    "subjects": ["Seagulls"],
                    "environments": ["Sea cliffs"],
                    "visualBeats": ["Waves crash against rock", "Seagulls take flight into dusk"],
                },
                {
                    "sceneNumber": 2,
                    "scene_id": "scene_002",
                    "start": 7.2,
                    "end": 16.0,
                    "startTime": 7.2,
                    "endTime": 16.0,
                    "duration": 8.8,
                    "heading": "INT. LIGHTHOUSE - NIGHT",
                    "visualDescription": "Keeper turns the giant brass lens.",
                    "subjects": ["Lighthouse keeper"],
                    "environments": ["Lighthouse tower"],
                    "visualBeats": ["Keeper oiling gears", "Lens rotating", "Beam sweeping across sea"],
                },
            ],
            # 5-scene narrative sequence
            [
                {"sceneNumber": i, "scene_id": f"scene_{i:03d}", "start": (i-1)*5.0, "end": i*5.0, "startTime": (i-1)*5.0, "endTime": i*5.0, "duration": 5.0,
                 "heading": f"SCENE {i}", "visualDescription": f"Description for scene {i}",
                 "visualBeats": [f"Beat {i}.1", f"Beat {i}.2"]}
                for i in range(1, 6)
            ],
        ]

        generator = VeoPromptGenerator()
        for idx, scenes in enumerate(scenes_variations):
            with self.subTest(scene_variation_index=idx):
                audio_duration = float(scenes[-1]["end"])
                # 1. Plan WITHOUT Visual Bible
                shots_no_bible = generator.plan_shots_from_scenes(scenes, audio_duration, visual_bible=None)

                # 2. Plan WITH Visual Bible
                bible = derive_visual_bible_from_scenes(scenes)
                shots_with_bible = generator.plan_shots_from_scenes(scenes, audio_duration, visual_bible=bible)

                # Assert Shot Counts match 100%
                self.assertEqual(
                    len(shots_no_bible),
                    len(shots_with_bible),
                    f"Shot count mismatch! Without Bible: {len(shots_no_bible)}, With Bible: {len(shots_with_bible)}"
                )

                # Assert timing matches exactly for each shot
                for s_no, s_wb in zip(shots_no_bible, shots_with_bible):
                    self.assertEqual(s_no.get("parent_scene_id"), s_wb.get("parent_scene_id"))
                    self.assertEqual(s_no.get("shot_id"), s_wb.get("shot_id"))
                    self.assertAlmostEqual(s_no["start"], s_wb["start"], places=3)
                    self.assertAlmostEqual(s_no["end"], s_wb["end"], places=3)
                    self.assertAlmostEqual(s_no["duration"], s_wb["duration"], places=3)


class TestPartialInvalidation(unittest.TestCase):
    def test_partial_invalidation_by_subject(self):
        director = VisualContinuityDirector()
        shots = [
            {"shotNumber": 1, "subjectIds": ["subj_A"], "outdated": False},
            {"shotNumber": 2, "subjectIds": ["subj_B"], "outdated": False},
            {"shotNumber": 3, "subjectIds": ["subj_A", "subj_B"], "outdated": False},
        ]
        invalidated = director.invalidate_affected_shots(shots, entity_type="subjects", entity_id="subj_A")
        self.assertEqual(invalidated, 2)
        self.assertTrue(shots[0]["outdated"])
        self.assertFalse(shots[1]["outdated"])
        self.assertTrue(shots[2]["outdated"])

    def test_global_invalidation(self):
        director = VisualContinuityDirector()
        shots = [
            {"shotNumber": 1, "outdated": False},
            {"shotNumber": 2, "outdated": False},
        ]
        invalidated = director.invalidate_affected_shots(shots, entity_type="periods", entity_id="period_global")
        self.assertEqual(invalidated, 2)
        self.assertTrue(shots[0]["outdated"])
        self.assertTrue(shots[1]["outdated"])


class TestMultiProjectIsolation(unittest.TestCase):
    def setUp(self):
        self.root_dir = Path(tempfile.mkdtemp(prefix="unfoldiq_test_vc_multi_"))
        self.proj_a = self.root_dir / "proj_A"
        self.proj_b = self.root_dir / "proj_B"
        self.proj_a.mkdir(parents=True, exist_ok=True)
        self.proj_b.mkdir(parents=True, exist_ok=True)
        self.director = VisualContinuityDirector()

    def tearDown(self):
        if self.root_dir.exists():
            shutil.rmtree(self.root_dir)

    def test_project_isolation(self):
        scenes_a = [{"sceneNumber": 1, "visualDescription": "Homo erectus in savanna."}]
        scenes_b = [{"sceneNumber": 1, "visualDescription": "Vintage computing lab in 1950."}]

        with open(self.proj_a / "scene_plan.json", "w", encoding="utf-8") as f:
            json.dump({"scenes": scenes_a}, f)
        with open(self.proj_b / "scene_plan.json", "w", encoding="utf-8") as f:
            json.dump({"scenes": scenes_b}, f)

        bible_a = self.director.derive_and_save(self.proj_a)
        bible_b = self.director.derive_and_save(self.proj_b)

        # Mutate Project A with manual edit
        subj_a_id = bible_a["subjects"][0]["subjectId"]
        self.director.update_entity(self.proj_a, "subjects", subj_a_id, {"hair": "distinct project A hair", "notes": "Specific to Project A"})

        # Reload both
        loaded_a = self.director.get_visual_bible(self.proj_a)
        loaded_b = self.director.get_visual_bible(self.proj_b)

        self.assertNotEqual(loaded_a["visualBibleHash"], loaded_b["visualBibleHash"])
        self.assertIn("Specific to Project A", str(loaded_a))
        self.assertNotIn("Specific to Project A", str(loaded_b))


class TestVisualBibleAPIEndpoints(unittest.TestCase):
    def setUp(self):
        self.temp_projects_dir = Path(tempfile.mkdtemp(prefix="unfoldiq_test_vc_api_"))
        self.client = TestClient(app)

        # Create a mock project
        self.proj_name = "2026-09-12_test_api_vc"
        self.proj_path = self.temp_projects_dir / self.proj_name
        self.proj_path.mkdir(parents=True, exist_ok=True)

        # Create scene_plan.json
        scene_plan = {
            "schemaVersion": "1.0.0",
            "scenes": [
                {
                    "sceneNumber": 1,
                    "startTime": 0.0,
                    "endTime": 5.0,
                    "duration": 5.0,
                    "heading": "EXT. DESERT - NOON",
                    "visualDescription": "Homo habilis hominin group in savanna.",
                    "subjects": ["Homo habilis hominin group"],
                    "environments": ["Olduvai Gorge savanna"],
                    "period": "Early Pleistocene",
                    "lighting": "Harsh midday sun",
                    "weather": "Dry heatwave",
                    "continuityGroup": "Savannah Journey",
                    "visualBeats": ["Hominin walks over ridge"],
                }
            ]
        }
        with open(self.proj_path / "scene_plan.json", "w", encoding="utf-8") as f:
            json.dump(scene_plan, f)

        # Patch PROJECTS_DIR in app
        import studio.app
        self.orig_projects_dir = studio.app.PROJECTS_DIR
        studio.app.PROJECTS_DIR = self.temp_projects_dir

    def tearDown(self):
        import studio.app
        studio.app.PROJECTS_DIR = self.orig_projects_dir
        if self.temp_projects_dir.exists():
            shutil.rmtree(self.temp_projects_dir)

    def test_generate_and_get_visual_bible_endpoint(self):
        # 1. Initially visual bible should return status "Not Generated"
        res = self.client.get(f"/api/projects/{self.proj_name}/visual-bible")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "Not Generated")
        self.assertIsNone(data["visual_bible"])

        # 2. POST generate
        res = self.client.post(f"/api/projects/{self.proj_name}/visual-bible/generate")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "Ready")
        self.assertIn("visual_bible", data)
        self.assertEqual(data["visual_bible"]["schemaVersion"], "1.0.0")

        # 3. GET visual-bible
        res = self.client.get(f"/api/projects/{self.proj_name}/visual-bible")
        self.assertEqual(res.status_code, 200)
        loaded = res.json()
        self.assertIn("visual_bible", loaded)
        self.assertEqual(loaded["visual_bible"]["visualBibleHash"], data["visual_bible"]["visualBibleHash"])

        # 4. PUT entity update
        subj_id = loaded["visual_bible"]["subjects"][0]["subjectId"]
        res = self.client.put(
            f"/api/projects/{self.proj_name}/visual-bible/entity",
            json={
                "entity_type": "subjects",
                "entity_id": subj_id,
                "updates": {"notes": "Custom updated field note"},
            },
        )
        self.assertEqual(res.status_code, 200)
        update_data = res.json()
        self.assertEqual(update_data["status"], "Updated")

        # 5. GET issues
        res = self.client.get(f"/api/projects/{self.proj_name}/visual-bible/issues")
        self.assertEqual(res.status_code, 200)
        issues_data = res.json()
        self.assertIn("issues", issues_data)



class TestContinuityValidatorComprehensive(unittest.TestCase):
    """
    Focused tests for Phase 10 Final Audit continuity validation:
    - Species mismatch
    - Group size mismatch & intentional exit/entry control
    - Clothing mismatch & wardrobe transition control
    - Environment mismatch & explicit transition control
    - Weather mismatch & smooth weather progression control
    - Lighting oscillation & smooth time-of-day progression control
    - Prop disappearance, owner mismatch, and handoff controls
    - Cinematic camera & shotPurpose progression false-positive immunity
    - Anachronistic modern element blocking
    """
    def setUp(self):
        self.director = VisualContinuityDirector()
        self.sample_bible = {
            "schemaVersion": "1.0.0",
            "generatorVersion": "10.0.0",
            "subjects": [
                {
                    "subjectId": "subject_homo_habilis_01",
                    "name": "Homo habilis family band",
                    "species": "Homo habilis",
                    "groupSize": 4,
                    "clothing": "none, historically accurate wild hominin state",
                    "visualAnchors": ["compact bipedal posture", "pronounced brow ridge"]
                }
            ],
            "environments": [
                {
                    "environmentId": "env_olduvai_gorge_grassland_01",
                    "locationName": "Olduvai Savannah Grassland",
                    "biome": "semi-arid Pleistocene grassland",
                    "periodId": "period_early_pleistocene"
                },
                {
                    "environmentId": "env_olduvai_gorge_riverbed_01",
                    "locationName": "Olduvai Riverbed Fluvial Site",
                    "biome": "paleo-lake alluvial channel",
                    "periodId": "period_early_pleistocene"
                }
            ],
            "periods": [
                {
                    "periodId": "period_early_pleistocene",
                    "label": "Early Pleistocene (~1.8 Mya)",
                    "forbiddenModernElements": ["watch", "motorcycle", "concrete", "smartphone", "plastic"]
                }
            ],
            "props": [
                {
                    "propId": "prop_stone_tool_01",
                    "name": "Oldowan flaked stone chopper",
                    "ownerSubjectId": "subject_homo_habilis_01"
                }
            ],
            "continuityGroups": [
                {
                    "continuityGroupId": "cg_001",
                    "label": "Savannah Trek",
                    "sceneIds": ["scene_001"],
                    "subjectIds": ["subject_homo_habilis_01"],
                    "environmentId": "env_olduvai_gorge_grassland_01",
                    "periodId": "period_early_pleistocene",
                    "persistentPropIds": ["prop_stone_tool_01"]
                }
            ]
        }

    def test_species_mismatch_fails(self):
        shots = [
            {
                "shot_id": "shot_001_01",
                "parentSceneId": "scene_001",
                "continuityGroupId": "cg_001",
                "subject": "Homo habilis adult",
                "veo_prompt": "A Homo habilis adult inspects the ground."
            },
            {
                "shot_id": "shot_001_02",
                "parentSceneId": "scene_001",
                "continuityGroupId": "cg_001",
                "subject": "modern Homo sapiens adult",
                "veo_prompt": "A modern Homo sapiens adult walks into frame."
            }
        ]
        res = self.director.validate_continuity(bible=self.sample_bible, shots=shots)
        self.assertEqual(res["status"], "Review")
        self.assertTrue(res["blocking_count"] >= 1)
        err_cats = [i["category"] for i in res["issues"]]
        self.assertIn("species_mismatch", err_cats)

    def test_group_size_mismatch_unexplained(self):
        shots = [
            {
                "shot_id": "shot_001_01",
                "parentSceneId": "scene_001",
                "continuityGroupId": "cg_001",
                "subject": "four hominins foraging together",
                "veo_prompt": "Four hominins dig for roots in the dry soil."
            },
            {
                "shot_id": "shot_001_02",
                "parentSceneId": "scene_001",
                "continuityGroupId": "cg_001",
                "subject": "six hominins standing alert",
                "veo_prompt": "Six hominins stand alert near the acacia."
            }
        ]
        res = self.director.validate_continuity(bible=self.sample_bible, shots=shots)
        warn_cats = [i["category"] for i in res["issues"] if i["severity"] == "WARNING"]
        self.assertIn("group_size_mismatch", warn_cats)

    def test_group_size_intentional_exit_passes(self):
        shots = [
            {
                "shot_id": "shot_001_01",
                "parentSceneId": "scene_001",
                "continuityGroupId": "cg_001",
                "subject": "four hominins foraging together",
                "veo_prompt": "Four hominins dig for roots in the dry soil."
            },
            {
                "shot_id": "shot_001_02",
                "parentSceneId": "scene_001",
                "continuityGroupId": "cg_001",
                "subject": "one hominin leaves the group",
                "veo_prompt": "One hominin leaves frame to scout the ridge ahead."
            },
            {
                "shot_id": "shot_001_03",
                "parentSceneId": "scene_001",
                "continuityGroupId": "cg_001",
                "subject": "three hominins remaining",
                "veo_prompt": "Three hominins remain digging under the acacia."
            }
        ]
        res = self.director.validate_continuity(bible=self.sample_bible, shots=shots)
        group_size_issues = [i for i in res["issues"] if i["category"] == "group_size_mismatch"]
        self.assertEqual(len(group_size_issues), 0)

    def test_clothing_mismatch_unexplained(self):
        shots = [
            {
                "shot_id": "shot_001_01",
                "parentSceneId": "scene_001",
                "continuityGroupId": "cg_001",
                "subject": "wearing established hide garment against the cold wind",
                "veo_prompt": "Hominin wearing hide garment walks across the plain."
            },
            {
                "shot_id": "shot_001_02",
                "parentSceneId": "scene_001",
                "continuityGroupId": "cg_001",
                "subject": "wearing tailored tweed jacket in open sunlight",
                "veo_prompt": "Hominin suddenly wearing tailored tweed jacket."
            }
        ]
        res = self.director.validate_continuity(bible=self.sample_bible, shots=shots)
        clothing_issues = [i for i in res["issues"] if i["category"] == "clothing_mismatch"]
        self.assertTrue(len(clothing_issues) >= 1)

    def test_clothing_change_with_transition_passes(self):
        shots = [
            {
                "shot_id": "shot_001_01",
                "parentSceneId": "scene_001",
                "continuityGroupId": "cg_001",
                "subject": "wearing hide garment in early chill",
                "veo_prompt": "Hominin wearing hide garment."
            },
            {
                "shot_id": "shot_001_02",
                "parentSceneId": "scene_001",
                "continuityGroupId": "cg_001",
                "subject": "removes the hide garment as warmth returns",
                "veo_prompt": "Subject removes hide garment and sets it down."
            }
        ]
        res = self.director.validate_continuity(bible=self.sample_bible, shots=shots)
        clothing_issues = [i for i in res["issues"] if i["category"] == "clothing_mismatch"]
        self.assertEqual(len(clothing_issues), 0)

    def test_environment_mismatch_unexplained(self):
        shots = [
            {
                "shot_id": "shot_001_01",
                "parentSceneId": "scene_001",
                "continuityGroupId": "cg_001",
                "environment": "semi-arid Pleistocene grassland with acacia",
                "veo_prompt": "Savannah grassland expanse under raking sun."
            },
            {
                "shot_id": "shot_001_02",
                "parentSceneId": "scene_001",
                "continuityGroupId": "cg_001",
                "environment": "dense tropical rainforest with moss and high canopy",
                "veo_prompt": "Tropical rainforest interior with dripping ferns."
            }
        ]
        res = self.director.validate_continuity(bible=self.sample_bible, shots=shots)
        env_issues = [i for i in res["issues"] if i["category"] == "environment_mismatch"]
        self.assertTrue(len(env_issues) >= 1)
        self.assertEqual(env_issues[0]["severity"], "ERROR")

    def test_environment_transition_allowed(self):
        shots = [
            {
                "shot_id": "shot_001_01",
                "parentSceneId": "scene_001",
                "continuityGroupId": "cg_001",
                "environment": "savannah grassland",
                "veo_prompt": "Savannah terrain with distant acacia."
            },
            {
                "shot_id": "shot_001_02",
                "parentSceneId": "scene_001",
                "continuityGroupId": "cg_001",
                "environment": "riverbed terrace",
                "veo_prompt": "Transition journey across alluvial terrace as group travels to the gravel bank."
            }
        ]
        res = self.director.validate_continuity(bible=self.sample_bible, shots=shots)
        env_issues = [i for i in res["issues"] if i["category"] == "environment_mismatch"]
        self.assertEqual(len(env_issues), 0)

    def test_weather_mismatch_unexplained(self):
        shots = [
            {
                "shot_id": "shot_001_01",
                "parentSceneId": "scene_001",
                "continuityGroupId": "cg_001",
                "weather": "clear dry sky",
                "veo_prompt": "Arid sky with dry heat."
            },
            {
                "shot_id": "shot_001_02",
                "parentSceneId": "scene_001",
                "continuityGroupId": "cg_001",
                "weather": "torrential rain and heavy downpour",
                "veo_prompt": "Torrential rain drenching the ground."
            }
        ]
        res = self.director.validate_continuity(bible=self.sample_bible, shots=shots)
        weath_issues = [i for i in res["issues"] if i["category"] == "weather_mismatch"]
        self.assertTrue(len(weath_issues) >= 1)

    def test_weather_progression_passes(self):
        shots = [
            {
                "shot_id": "shot_001_01",
                "parentSceneId": "scene_001",
                "continuityGroupId": "cg_001",
                "weather": "clear dry sky",
                "veo_prompt": "Arid sky with dry heat."
            },
            {
                "shot_id": "shot_001_02",
                "parentSceneId": "scene_001",
                "continuityGroupId": "cg_001",
                "weather": "cloud build-up on horizon",
                "veo_prompt": "Dark clouds gather on the horizon."
            }
        ]
        res = self.director.validate_continuity(bible=self.sample_bible, shots=shots)
        weath_issues = [i for i in res["issues"] if i["category"] == "weather_mismatch"]
        self.assertEqual(len(weath_issues), 0)

    def test_lighting_jump_oscillation(self):
        shots = [
            {
                "shot_id": "shot_001_01",
                "parentSceneId": "scene_001",
                "continuityGroupId": "cg_001",
                "lighting": "late afternoon sunlight",
                "veo_prompt": "Warm late afternoon sun."
            },
            {
                "shot_id": "shot_001_02",
                "parentSceneId": "scene_001",
                "continuityGroupId": "cg_001",
                "lighting": "pitch midnight darkness",
                "veo_prompt": "Pitch black midnight darkness."
            },
            {
                "shot_id": "shot_001_03",
                "parentSceneId": "scene_001",
                "continuityGroupId": "cg_001",
                "lighting": "harsh midday noon sunlight",
                "veo_prompt": "Harsh midday noon sunlight."
            }
        ]
        res = self.director.validate_continuity(bible=self.sample_bible, shots=shots)
        light_errors = [i for i in res["issues"] if i["category"] == "lighting_jump" and i["severity"] == "ERROR"]
        self.assertTrue(len(light_errors) >= 1)

    def test_smooth_lighting_progression_passes(self):
        shots = [
            {
                "shot_id": "shot_001_01",
                "parentSceneId": "scene_001",
                "continuityGroupId": "cg_001",
                "lighting": "late afternoon sun",
                "veo_prompt": "Warm late afternoon sun."
            },
            {
                "shot_id": "shot_001_02",
                "parentSceneId": "scene_001",
                "continuityGroupId": "cg_001",
                "lighting": "golden hour glow",
                "veo_prompt": "Golden hour glow."
            },
            {
                "shot_id": "shot_001_03",
                "parentSceneId": "scene_001",
                "continuityGroupId": "cg_001",
                "lighting": "sunset ambient",
                "veo_prompt": "Sunset ambient."
            }
        ]
        res = self.director.validate_continuity(bible=self.sample_bible, shots=shots)
        light_errors = [i for i in res["issues"] if i["category"] == "lighting_jump" and i["severity"] == "ERROR"]
        self.assertEqual(len(light_errors), 0)

    def test_prop_disappearance_unexplained(self):
        shots = [
            {
                "shot_id": "shot_001_01",
                "parentSceneId": "scene_001",
                "continuityGroupId": "cg_001",
                "veo_prompt": "Subject knapping the Oldowan flaked stone chopper."
            },
            {
                "shot_id": "shot_001_02",
                "parentSceneId": "scene_001",
                "continuityGroupId": "cg_001",
                "veo_prompt": "Subject standing with hands are empty with no tool visible."
            }
        ]
        res = self.director.validate_continuity(bible=self.sample_bible, shots=shots)
        prop_issues = [i for i in res["issues"] if i["category"] == "prop_disappearance"]
        self.assertTrue(len(prop_issues) >= 1)

    def test_prop_transition_handoff_passes(self):
        shots = [
            {
                "shot_id": "shot_001_01",
                "parentSceneId": "scene_001",
                "continuityGroupId": "cg_001",
                "veo_prompt": "Oldowan flaked stone chopper resting on basalt ground."
            },
            {
                "shot_id": "shot_001_02",
                "parentSceneId": "scene_001",
                "continuityGroupId": "cg_001",
                "veo_prompt": "Stone chopper is picked up and handed to companion."
            }
        ]
        res = self.director.validate_continuity(bible=self.sample_bible, shots=shots)
        prop_issues = [i for i in res["issues"] if i["category"] == "prop_disappearance"]
        self.assertEqual(len(prop_issues), 0)

    def test_cinematic_camera_and_purpose_progression_passes(self):
        shots = [
            {
                "shot_id": "shot_001_01",
                "parentSceneId": "scene_001",
                "continuityGroupId": "cg_001",
                "shotPurpose": "ESTABLISH",
                "shot_type": "extreme wide",
                "camera_motion": "slow push-in",
                "veo_prompt": "Wide vista across savannah plain."
            },
            {
                "shot_id": "shot_001_02",
                "parentSceneId": "scene_001",
                "continuityGroupId": "cg_001",
                "shotPurpose": "ACTION",
                "shot_type": "medium",
                "camera_motion": "tracking",
                "veo_prompt": "Hominin walks forward across terrain."
            },
            {
                "shot_id": "shot_001_03",
                "parentSceneId": "scene_001",
                "continuityGroupId": "cg_001",
                "shotPurpose": "DETAIL",
                "shot_type": "close-up",
                "camera_motion": "static",
                "veo_prompt": "Detailed fingers striking the basalt cobble."
            },
            {
                "shot_id": "shot_001_04",
                "parentSceneId": "scene_001",
                "continuityGroupId": "cg_001",
                "shotPurpose": "REVEAL",
                "shot_type": "wide",
                "camera_motion": "tilt-up",
                "veo_prompt": "Camera tilts up to reveal distant predator on ridge."
            }
        ]
        res = self.director.validate_continuity(bible=self.sample_bible, shots=shots)
        self.assertEqual(res["blocking_count"], 0)
        self.assertEqual(res["warning_count"], 0)
        self.assertEqual(res["status"], "Ready")

    def test_anachronistic_modern_element_blocked(self):
        shots = [
            {
                "shot_id": "shot_001_01",
                "parentSceneId": "scene_001",
                "continuityGroupId": "cg_001",
                "veo_prompt": "Hominin walks past a modern concrete barrier with a smartphone in hand."
            }
        ]
        res = self.director.validate_continuity(bible=self.sample_bible, shots=shots)
        self.assertEqual(res["status"], "Review")
        period_violations = [i for i in res["issues"] if i["category"] == "period_violation"]
        self.assertTrue(len(period_violations) >= 1)

    def test_reveal_prompt_contract(self):
        """Verify the canonical REVEAL prompt contract and continuity invariants."""
        from studio.veo_prompt_generator import veo_generator

        scene = {
            "scene_id": "scene_reveal_001",
            "scene_number": 1,
            "heading": "EXT. OLDUVAI GORGE - DUSK",
            "start": 0.0,
            "end": 14.0,
            "duration": 14.0,
            "narration": "The team reaches the rocky ridge as the sun sets. A sudden discovery reveals the breakthrough evidence that scientists found buried deep within the strata.",
            "visual_summary": "Archaeologists walking along ridge, followed by unexpected discovery emerging from volcanic ash.",
            "continuity_group": "cg_001",
            "continuityGroupId": "cg_001",
        }

        shots = veo_generator.plan_shots_from_scenes(
            [scene], audio_duration=14.0, visual_bible=self.sample_bible
        )
        self.assertTrue(len(shots) >= 1)
        reveal_shots = [s for s in shots if s.get("shotPurpose") == "REVEAL"]
        self.assertTrue(len(reveal_shots) >= 1, "Scene with reveal keywords must trigger at least one REVEAL shot")

        r_shot = reveal_shots[0]
        self.assertEqual(r_shot["camera_motion"], "slow pull-back")
        self.assertEqual(r_shot["shot_type"], "medium close-up")
        self.assertTrue(
            "coming into focus" in r_shot["subject_action"] or "emerging into frame" in r_shot["subject_action"]
        )
        self.assertIn("continuity_anchor", r_shot)
        self.assertTrue(len(r_shot["continuity_anchor"]) > 0)
        self.assertIn("negative_prompt", r_shot)

        # Validate with continuity director
        res = self.director.validate_continuity(bible=self.sample_bible, shots=shots)
        self.assertEqual(res["status"], "Ready")
        self.assertEqual(res["blocking_count"], 0)

    def test_partial_invalidation_precision_matrix(self):
        """Verify Gap B precision matrix: Subject (partial), Env (partial), Global (all), Notes (0)."""
        from studio.veo_prompt_generator import veo_generator
        proj_dir = Path("projects/2026-09-12_210003_youtube-narration-01")
        if not (proj_dir / "veo_prompts.json").is_file():
            self.skipTest("Reference project not found")

        bak_vb = (proj_dir / "visual_bible.json").read_text(encoding="utf-8")
        bak_veo = (proj_dir / "veo_prompts.json").read_text(encoding="utf-8")
        orig_st = veo_generator.check_veo_status(proj_dir)

        try:
            # 1. Subject invalidation (subject_pleistocene_predator_01)
            aff_sub = self.director.invalidate_affected_shots(proj_dir, entity_id="subject_pleistocene_predator_01")
            st_sub = veo_generator.check_veo_status(proj_dir)
            self.assertEqual(len(aff_sub), 43)
            self.assertTrue(st_sub.get("partial"))

            # Restore
            (proj_dir / "visual_bible.json").write_text(bak_vb, encoding="utf-8")
            (proj_dir / "veo_prompts.json").write_text(bak_veo, encoding="utf-8")

            # 2. Environment invalidation (env_olduvai_gorge_hearth_site_01)
            aff_env = self.director.invalidate_affected_shots(proj_dir, entity_id="env_olduvai_gorge_hearth_site_01")
            st_env = veo_generator.check_veo_status(proj_dir)
            self.assertEqual(len(aff_env), 13)
            self.assertTrue(st_env.get("partial"))

            # Restore
            (proj_dir / "visual_bible.json").write_text(bak_vb, encoding="utf-8")
            (proj_dir / "veo_prompts.json").write_text(bak_veo, encoding="utf-8")

            # 3. Global style/period invalidation
            aff_global = self.director.invalidate_affected_shots(proj_dir, entity_type="periods", entity_id="period_early_pleistocene")
            st_global = veo_generator.check_veo_status(proj_dir)
            self.assertEqual(len(aff_global), 141)
            self.assertFalse(st_global.get("partial"))

            # Restore
            (proj_dir / "visual_bible.json").write_text(bak_vb, encoding="utf-8")
            (proj_dir / "veo_prompts.json").write_text(bak_veo, encoding="utf-8")

            # 4. UI-only note edit (P0-07 Audit: Non-semantic editorial metadata must preserve
            # visualBibleHash and avoid spurious prompt invalidation across scenes/shots).
            orig_hash = json.loads(bak_vb)["visualBibleHash"]
            orig_outdated = sum(1 for s in json.loads(bak_veo).get("shots", []) if s.get("outdated"))
            self.director.update_entity(
                proj_dir, entity_type="subjects", entity_id="subject_homo_habilis_01", updates={"notes": "Editorial note"}
            )
            new_vb = json.loads((proj_dir / "visual_bible.json").read_text(encoding="utf-8"))
            st_note = veo_generator.check_veo_status(proj_dir)
            veo_shots = json.loads((proj_dir / "veo_prompts.json").read_text(encoding="utf-8"))["shots"]
            outdated_count = sum(1 for s in veo_shots if s.get("outdated"))
            self.assertEqual(outdated_count, orig_outdated)
            self.assertEqual(new_vb["visualBibleHash"], orig_hash)
            self.assertEqual(st_note["status"], orig_st["status"])
        finally:
            (proj_dir / "visual_bible.json").write_text(bak_vb, encoding="utf-8")
            (proj_dir / "veo_prompts.json").write_text(bak_veo, encoding="utf-8")


if __name__ == "__main__":
    unittest.main()
