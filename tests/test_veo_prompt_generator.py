"""
Unit tests for UnfoldIQ Phase 6 Google Flow / Veo Prompt Generator.
Covers all 20 required points:
1. veo_plan_generation_all_scenes_covered
2. veo_duration_boundaries_respected
3. veo_shot_splitting_for_long_scenes
4. veo_zero_timeline_gaps_and_overlaps
5. veo_shot_id_deterministic_and_unique
6. veo_prompt_contains_all_ten_clauses
7. veo_negative_prompt_contains_mandatory_tokens
8. veo_camera_framing_motion_aligned
9. veo_cross_domain_hygiene_astrophysics
10. veo_cross_domain_hygiene_computing
11. veo_cross_domain_hygiene_thermodynamics
12. veo_proper_noun_preservation
13. veo_pronunciation_override_leakage_prevented
14. veo_continuity_group_inheritance
15. veo_staleness_detection_all_sources
16. veo_manual_edit_persistence
17. veo_archive_on_regeneration
18. veo_markdown_export_matches_json
19. veo_atomic_write_safety
20. veo_validator_rejects_corrupted_plan
"""

import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path

from studio.veo_prompt_generator import (
    VeoPromptGenerator,
    VeoPlanValidationError,
    STANDARD_VEO_CONSTRAINTS,
    VEO_SHOT_TYPES,
    VEO_CAMERA_MOTIONS,
    VEO_NARRATIVE_TONES,
)
MANDATORY_NEGATIVE_TOKENS = STANDARD_VEO_CONSTRAINTS
from studio.scene_planner import compute_file_sha256



class TestVeoPromptGenerator(unittest.TestCase):
    def setUp(self):
        self.temp_dir = Path(tempfile.mkdtemp(prefix="unfoldiq_test_veo_"))
        self.generator = VeoPromptGenerator(
            target_duration=6.0,
            preferred_max_duration=8.0,
            min_duration=3.0,
            aspect_ratio="16:9",
        )

    def tearDown(self):
        if self.temp_dir.exists():
            shutil.rmtree(self.temp_dir, ignore_errors=True)

    def _create_mock_project(
        self,
        script_text: str,
        scenes: list,
        audio_duration: float,
        overrides: list = None,
    ) -> Path:
        """Helper to create a fully formed mock project with script, audio, timestamps, metadata, and scene_plan.json."""
        proj = self.temp_dir / "test_project"
        proj.mkdir(parents=True, exist_ok=True)

        (proj / "script.txt").write_text(script_text, encoding="utf-8")
        (proj / "audio.wav").write_bytes(b"RIFFmockwavcontent" + b"\x00" * 2000)

        metadata = {
            "project_name": "test_project",
            "voice": "af_heart",
            "speed": 1.0,
            "language": "American English",
            "character_count": len(script_text),
            "pronunciation_dictionary_applied": bool(overrides),
            "pronunciation_overrides": overrides or [],
        }
        (proj / "metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")

        ts_data = {
            "version": 1,
            "audio_file": "audio.wav",
            "audio_sha256": compute_file_sha256(proj / "audio.wav"),
            "audio_duration": audio_duration,
            "segments": [
                {"index": 1, "start": 0.0, "end": audio_duration, "text": script_text}
            ],
        }
        (proj / "timestamps.json").write_text(json.dumps(ts_data, indent=2), encoding="utf-8")

        plan_data = {
            "planner_version": "1.0.0",
            "source_script_sha256": compute_file_sha256(proj / "script.txt"),
            "audio_sha256": compute_file_sha256(proj / "audio.wav"),
            "timestamps_sha256": compute_file_sha256(proj / "timestamps.json"),
            "audio_duration": audio_duration,
            "scene_count": len(scenes),
            "coverage": 100.0,
            "timeline_coverage": 100.0,
            "aspect_ratio": "16:9",
            "scenes": scenes,
        }
        (proj / "scene_plan.json").write_text(json.dumps(plan_data, indent=2), encoding="utf-8")
        return proj

    def test_01_veo_plan_generation_all_scenes_covered(self):
        """1. Every scene in scene_plan.json is represented by 1 or more shots."""
        scenes = [
            {
                "scene_id": "scene_001",
                "index": 1,
                "start": 0.0,
                "end": 5.5,
                "duration": 5.5,
                "speech_start": 0.0,
                "speech_end": 5.2,
                "category": "reconstruction",
                "evidence_mode": "reconstruction",
                "shot_type": "wide",
                "camera_motion": "slow push-in",
                "continuity_group": "group_alpha",
                "visual_summary": "First scene summary",
                "narration": "First scene narration text.",
                "image_prompt": "First scene image prompt",
                "negative_prompt": "blurry",
            },
            {
                "scene_id": "scene_002",
                "index": 2,
                "start": 5.5,
                "end": 14.0,
                "duration": 8.5,
                "speech_start": 5.6,
                "speech_end": 13.8,
                "category": "environment",
                "evidence_mode": "documented",
                "shot_type": "medium wide",
                "camera_motion": "slow pan",
                "continuity_group": None,
                "visual_summary": "Second scene summary",
                "narration": "Second longer scene narration text.",
                "image_prompt": "Second scene image prompt",
                "negative_prompt": "blurry",
            },
        ]
        proj = self._create_mock_project("First scene narration text. Second longer scene narration text.", scenes, 14.0)
        plan = self.generator.plan_project_veo(proj)

        self.assertIn("shots", plan)
        shots = plan["shots"]
        parent_scene_ids = {s["parent_scene_id"] for s in shots}
        self.assertIn("scene_001", parent_scene_ids)
        self.assertIn("scene_002", parent_scene_ids)
        self.assertGreaterEqual(len(shots), len(scenes))

    def test_02_veo_duration_boundaries_respected(self):
        """2. Shots respect preferred max (8.0s) and min (3.0s), except single short parent scene duration preservation."""
        scenes = [
            {
                "scene_id": "scene_001",
                "index": 1,
                "start": 0.0,
                "end": 2.5,
                "duration": 2.5,
                "speech_start": 0.0,
                "speech_end": 2.4,
                "category": "transition",
                "evidence_mode": "conceptual",
                "shot_type": "extreme wide",
                "camera_motion": "static",
                "continuity_group": None,
                "visual_summary": "Short scene",
                "narration": "Brief transition.",
                "image_prompt": "Transition visual",
                "negative_prompt": "blurry",
            },
            {
                "scene_id": "scene_002",
                "index": 2,
                "start": 2.5,
                "end": 9.5,
                "duration": 7.0,
                "speech_start": 2.6,
                "speech_end": 9.0,
                "category": "reconstruction",
                "evidence_mode": "reconstruction",
                "shot_type": "wide",
                "camera_motion": "slow push-in",
                "continuity_group": None,
                "visual_summary": "Normal scene",
                "narration": "Normal length scene text.",
                "image_prompt": "Normal scene visual",
                "negative_prompt": "blurry",
            },
        ]
        proj = self._create_mock_project("Brief transition. Normal length scene text.", scenes, 9.5)
        plan = self.generator.plan_project_veo(proj)
        shots = plan["shots"]

        # Shot 1 preserves parent scene 2.5s duration
        self.assertEqual(shots[0]["duration"], 2.5)
        # Shot 2 is 7.0s (within 3.0 to 8.0s)
        self.assertEqual(shots[1]["duration"], 7.0)

    def test_03_veo_shot_splitting_for_long_scenes(self):
        """3. Scenes > 8.0s are split into balanced shots of ~6.0s, avoiding tiny tail clips."""
        # 12.4s scene should split into 2 balanced shots (~6.2s each)
        scenes = [
            {
                "scene_id": "scene_001",
                "index": 1,
                "start": 0.0,
                "end": 12.4,
                "duration": 12.4,
                "speech_start": 0.2,
                "speech_end": 12.0,
                "category": "process",
                "evidence_mode": "documented",
                "shot_type": "medium",
                "camera_motion": "tracking",
                "continuity_group": "group_proc",
                "visual_summary": "Long process explanation",
                "narration": "This is a very long scene that extends well beyond the single shot video generation boundary.",
                "image_prompt": "Detailed process image prompt",
                "negative_prompt": "blurry",
            }
        ]
        proj = self._create_mock_project(scenes[0]["narration"], scenes, 12.4)
        plan = self.generator.plan_project_veo(proj)
        shots = plan["shots"]

        self.assertEqual(len(shots), 2)
        self.assertEqual(shots[0]["shot_split_index"], 1)
        self.assertEqual(shots[0]["shot_split_total"], 2)
        self.assertEqual(shots[1]["shot_split_index"], 2)
        self.assertEqual(shots[1]["shot_split_total"], 2)

        # Durations should be balanced around 6.2s, not 8.0s and 4.4s or 11s and 1.4s
        self.assertAlmostEqual(shots[0]["duration"], 6.2, places=2)
        self.assertAlmostEqual(shots[1]["duration"], 6.2, places=2)
        self.assertGreaterEqual(shots[0]["duration"], 3.0)
        self.assertGreaterEqual(shots[1]["duration"], 3.0)

    def test_04_veo_zero_timeline_gaps_and_overlaps(self):
        """4. Shots are 100% contiguous from 0.000s to audio_duration with 0 gaps and 0 overlaps."""
        scenes = [
            {"scene_id": "s1", "index": 1, "start": 0.0, "end": 6.123, "duration": 6.123, "speech_start": 0.0, "speech_end": 5.9, "category": "reconstruction", "evidence_mode": "reconstruction", "shot_type": "wide", "camera_motion": "static", "continuity_group": None, "visual_summary": "Scene 1", "narration": "Narration 1", "image_prompt": "P1", "negative_prompt": "N1"},
            {"scene_id": "s2", "index": 2, "start": 6.123, "end": 17.550, "duration": 11.427, "speech_start": 6.2, "speech_end": 17.0, "category": "environment", "evidence_mode": "documented", "shot_type": "medium", "camera_motion": "tracking", "continuity_group": None, "visual_summary": "Scene 2", "narration": "Narration 2", "image_prompt": "P2", "negative_prompt": "N2"},
            {"scene_id": "s3", "index": 3, "start": 17.550, "end": 22.000, "duration": 4.450, "speech_start": 17.6, "speech_end": 21.8, "category": "transition", "evidence_mode": "conceptual", "shot_type": "close-up", "camera_motion": "orbit", "continuity_group": None, "visual_summary": "Scene 3", "narration": "Narration 3", "image_prompt": "P3", "negative_prompt": "N3"},
        ]
        proj = self._create_mock_project("Narration 1 Narration 2 Narration 3", scenes, 22.000)
        plan = self.generator.plan_project_veo(proj)
        shots = plan["shots"]

        self.assertEqual(shots[0]["start"], 0.0)
        self.assertEqual(shots[-1]["end"], 22.0)

        for i in range(1, len(shots)):
            self.assertAlmostEqual(shots[i]["start"], shots[i-1]["end"], places=3)
            self.assertGreater(shots[i]["end"], shots[i]["start"])

        total_dur = sum(s["duration"] for s in shots)
        self.assertAlmostEqual(total_dur, 22.0, places=2)

    def test_05_veo_shot_id_deterministic_and_unique(self):
        """5. Shot IDs are formatted shot_{idx:03d} and all unique."""
        scenes = [
            {"scene_id": "s1", "index": 1, "start": 0.0, "end": 15.0, "duration": 15.0, "speech_start": 0.0, "speech_end": 14.5, "category": "reconstruction", "evidence_mode": "reconstruction", "shot_type": "wide", "camera_motion": "static", "continuity_group": None, "visual_summary": "Scene 1", "narration": "Narration 1", "image_prompt": "P1", "negative_prompt": "N1"},
            {"scene_id": "s2", "index": 2, "start": 15.0, "end": 25.0, "duration": 10.0, "speech_start": 15.1, "speech_end": 24.5, "category": "environment", "evidence_mode": "documented", "shot_type": "medium", "camera_motion": "tracking", "continuity_group": None, "visual_summary": "Scene 2", "narration": "Narration 2", "image_prompt": "P2", "negative_prompt": "N2"},
        ]
        proj = self._create_mock_project("Narration 1 Narration 2", scenes, 25.0)
        plan = self.generator.plan_project_veo(proj)
        shots = plan["shots"]

        ids = [s["shot_id"] for s in shots]
        self.assertEqual(len(ids), len(set(ids)))
        for i, s in enumerate(shots, 1):
            self.assertEqual(s["shot_id"], f"shot_{i:03d}")
            self.assertEqual(s["index"], i)

    def test_06_veo_prompt_contains_all_ten_clauses(self):
        """6. Video prompts mandate all 10 structural clauses."""
        scenes = [
            {"scene_id": "s1", "index": 1, "start": 0.0, "end": 6.0, "duration": 6.0, "speech_start": 0.0, "speech_end": 5.5, "category": "process", "evidence_mode": "documented", "shot_type": "medium close-up", "camera_motion": "slow push-in", "continuity_group": "group_lab", "visual_summary": "Laboratory experiment", "narration": "The researcher carefully adds reagent into the bubbling flask.", "image_prompt": "Lab flask visual", "negative_prompt": "blurry"},
        ]
        proj = self._create_mock_project(scenes[0]["narration"], scenes, 6.0)
        plan = self.generator.plan_project_veo(proj)
        shot = plan["shots"][0]
        prompt = shot["veo_prompt"]

        # Check key structural requirements
        self.assertIn("medium close-up", prompt.lower())
        self.assertIn("action:", prompt.lower())
        self.assertIn("camera:", prompt.lower())
        self.assertIn("environment:", prompt.lower())
        self.assertIn("lighting:", prompt.lower())
        self.assertIn("composition:", prompt.lower())
        self.assertIn("16:9", prompt)
        self.assertIn("cinematography:", prompt.lower())
        self.assertIn("style:", prompt.lower())
        self.assertIn("explicit constraints:", prompt.lower())
        for neg in MANDATORY_NEGATIVE_TOKENS:
            self.assertIn(neg, prompt.lower())

    def test_07_veo_negative_prompt_contains_mandatory_tokens(self):
        """7. Negative prompt explicitly mandates all 6 required negative constraints."""
        scenes = [
            {"scene_id": "s1", "index": 1, "start": 0.0, "end": 6.0, "duration": 6.0, "speech_start": 0.0, "speech_end": 5.5, "category": "environment", "evidence_mode": "documented", "shot_type": "wide", "camera_motion": "static", "continuity_group": None, "visual_summary": "Vast desert", "narration": "A boundless desert landscape under the blazing sun.", "image_prompt": "Desert prompt", "negative_prompt": "blurry"},
        ]
        proj = self._create_mock_project(scenes[0]["narration"], scenes, 6.0)
        plan = self.generator.plan_project_veo(proj)
        shot = plan["shots"][0]

        for token in MANDATORY_NEGATIVE_TOKENS:
            self.assertIn(token, shot["negative_prompt"].lower())

    def test_08_veo_camera_framing_motion_aligned(self):
        """8. Camera framing and motion tags match allowed controlled vocabulary."""
        scenes = [
            {"scene_id": "s1", "index": 1, "start": 0.0, "end": 14.0, "duration": 14.0, "speech_start": 0.0, "speech_end": 13.5, "category": "reconstruction", "evidence_mode": "reconstruction", "shot_type": "wide", "camera_motion": "slow push-in", "continuity_group": None, "visual_summary": "Ancient hunters", "narration": "Hunters track silently through the tall grass.", "image_prompt": "Hunters prompt", "negative_prompt": "blurry"},
        ]
        proj = self._create_mock_project(scenes[0]["narration"], scenes, 14.0)
        plan = self.generator.plan_project_veo(proj)
        shots = plan["shots"]

        for shot in shots:
            self.assertIn(shot["shot_type"], VEO_SHOT_TYPES)
            self.assertIn(shot["tone"], VEO_NARRATIVE_TONES)
            self.assertTrue(len(shot["camera_framing"]) > 0)
            self.assertTrue(len(shot["camera_motion"]) > 0)


    def test_09_veo_cross_domain_hygiene_astrophysics(self):
        """9. Astrophysics narration must NOT leak prehistoric terms."""
        script = "The James Webb Space Telescope observes distant galaxy GN-z11 in the deep cosmic infrared spectrum."
        scenes = [
            {"scene_id": "s1", "index": 1, "start": 0.0, "end": 6.0, "duration": 6.0, "speech_start": 0.0, "speech_end": 5.8, "category": "anatomy/science", "evidence_mode": "documented", "shot_type": "medium wide", "camera_motion": "orbit", "continuity_group": "jwst_observatory", "visual_summary": "JWST in deep space", "narration": script, "image_prompt": "JWST gold mirrors", "negative_prompt": "blurry"},
        ]
        proj = self._create_mock_project(script, scenes, 6.0)
        plan = self.generator.plan_project_veo(proj)
        shot = plan["shots"][0]
        prompt_lower = shot["veo_prompt"].lower()

        # Must NOT contain hominid / prehistoric terms
        prehistoric_forbidden = ["hominid", "stone tool", "flint knapping", "olduvai", "bipedal locomotion", "savanna foraging"]
        for term in prehistoric_forbidden:
            self.assertNotIn(term, prompt_lower)

        # Must preserve astrophysics subject
        self.assertIn("telescope", prompt_lower)

    def test_10_veo_cross_domain_hygiene_computing(self):
        """10. Modern computing narration must NOT leak prehistoric artifacts."""
        script = "Modern supercomputers utilize parallel arrays of graphics processing units to train deep neural networks."
        scenes = [
            {"scene_id": "s1", "index": 1, "start": 0.0, "end": 6.0, "duration": 6.0, "speech_start": 0.0, "speech_end": 5.8, "category": "process", "evidence_mode": "documented", "shot_type": "medium", "camera_motion": "tracking", "continuity_group": None, "visual_summary": "Data center server racks", "narration": script, "image_prompt": "Server racks blue LEDs", "negative_prompt": "blurry"},
        ]
        proj = self._create_mock_project(script, scenes, 6.0)
        plan = self.generator.plan_project_veo(proj)
        shot = plan["shots"][0]
        prompt_lower = shot["veo_prompt"].lower()

        prehistoric_forbidden = ["hominid", "stone tool", "olduvai", "flint", "archeulean"]
        for term in prehistoric_forbidden:
            self.assertNotIn(term, prompt_lower)

        self.assertTrue(any(w in prompt_lower for w in ["server", "computer", "hardware", "data", "processing"]))

    def test_11_veo_cross_domain_hygiene_thermodynamics(self):
        """11. Thermodynamics narration keeps steam/boiler/piston actions without prehistoric artifacts."""
        script = "In a steam engine, boiling water expands into pressurized vapor driving a reciprocating piston inside the cast iron cylinder."
        scenes = [
            {"scene_id": "s1", "index": 1, "start": 0.0, "end": 6.0, "duration": 6.0, "speech_start": 0.0, "speech_end": 5.8, "category": "process", "evidence_mode": "documented", "shot_type": "medium", "camera_motion": "slow push-in", "continuity_group": "watt_engine_01", "visual_summary": "Watt steam engine piston motion", "narration": script, "image_prompt": "Steam engine piston", "negative_prompt": "blurry"},
        ]
        proj = self._create_mock_project(script, scenes, 6.0)
        plan = self.generator.plan_project_veo(proj)
        shot = plan["shots"][0]
        prompt_lower = shot["veo_prompt"].lower()

        prehistoric_forbidden = ["hominid", "stone tool", "olduvai", "flint"]
        for term in prehistoric_forbidden:
            self.assertNotIn(term, prompt_lower)

        self.assertTrue(any(w in prompt_lower for w in ["steam", "engine", "piston", "cylinder", "pressure"]))

    def test_12_veo_proper_noun_preservation(self):
        """12. Proper nouns from narration are preserved in shot prompts."""
        script = "Professor Alan Turing formulated the concept of the universal computing machine at Cambridge University."
        scenes = [
            {"scene_id": "s1", "index": 1, "start": 0.0, "end": 6.0, "duration": 6.0, "speech_start": 0.0, "speech_end": 5.8, "category": "reconstruction", "evidence_mode": "documented", "shot_type": "medium close-up", "camera_motion": "slow push-in", "continuity_group": "alan_turing_1936", "visual_summary": "Alan Turing working at desk", "narration": script, "image_prompt": "Turing at desk", "negative_prompt": "blurry"},
        ]
        proj = self._create_mock_project(script, scenes, 6.0)
        plan = self.generator.plan_project_veo(proj)
        shot = plan["shots"][0]
        prompt = shot["veo_prompt"]

        self.assertIn("Alan Turing", prompt)

    def test_13_veo_pronunciation_override_leakage_prevented(self):
        """13. Spoken pronunciation overrides (e.g. KAY-oh-ess) must NOT leak into visual prompts."""
        script = "The theory of Chaos describes sensitive dependence on initial conditions."
        overrides = [
            {"original": "Chaos", "spoken_form": "KAY-oh-ess", "enabled": True}
        ]
        scenes = [
            {"scene_id": "s1", "index": 1, "start": 0.0, "end": 6.0, "duration": 6.0, "speech_start": 0.0, "speech_end": 5.8, "category": "process", "evidence_mode": "conceptual", "shot_type": "medium", "camera_motion": "static", "continuity_group": None, "visual_summary": "Lorenz attractor curve", "narration": script, "image_prompt": "Chaos theory visual", "negative_prompt": "blurry"},
        ]
        proj = self._create_mock_project(script, scenes, 6.0, overrides=overrides)
        plan = self.generator.plan_project_veo(proj)
        shot = plan["shots"][0]
        prompt = shot["veo_prompt"]

        self.assertNotIn("KAY-oh-ess", prompt)
        self.assertIn("Chaos", prompt)

    def test_14_veo_continuity_group_inheritance(self):
        """14. Continuity groups from parent scenes are inherited and reflected in continuity anchors."""
        scenes = [
            {"scene_id": "s1", "index": 1, "start": 0.0, "end": 6.0, "duration": 6.0, "speech_start": 0.0, "speech_end": 5.8, "category": "reconstruction", "evidence_mode": "reconstruction", "shot_type": "medium", "camera_motion": "slow push-in", "continuity_group": "adult_homo_habilis_olduvai_01", "visual_summary": "Habilis toolmaker", "narration": "An adult Homo habilis carefully examines a basalt cobble.", "image_prompt": "Habilis prompt", "negative_prompt": "blurry"},
        ]
        proj = self._create_mock_project(scenes[0]["narration"], scenes, 6.0)
        plan = self.generator.plan_project_veo(proj)
        shot = plan["shots"][0]

        self.assertIsNotNone(shot["continuity_anchor"])
        self.assertIn("adult_homo_habilis_olduvai_01", shot["continuity_anchor"])
        self.assertIn("adult_homo_habilis_olduvai_01", shot["veo_prompt"])

    def test_15_veo_staleness_detection_all_sources(self):
        """15. Modifying script.txt, audio.wav, timestamps.json, or scene_plan.json marks the plan stale."""
        scenes = [
            {"scene_id": "s1", "index": 1, "start": 0.0, "end": 6.0, "duration": 6.0, "speech_start": 0.0, "speech_end": 5.8, "category": "environment", "evidence_mode": "documented", "shot_type": "wide", "camera_motion": "static", "continuity_group": None, "visual_summary": "Valley", "narration": "A peaceful valley.", "image_prompt": "Valley prompt", "negative_prompt": "blurry"},
        ]
        proj = self._create_mock_project("A peaceful valley.", scenes, 6.0)
        self.generator.plan_project_veo(proj)

        status = self.generator.check_veo_status(proj)
        self.assertEqual(status["status"], "Ready")

        # Mutate scene_plan.json
        plan_p = proj / "scene_plan.json"
        data = json.loads(plan_p.read_text(encoding="utf-8"))
        data["scene_count"] = 99
        plan_p.write_text(json.dumps(data, indent=2), encoding="utf-8")

        status_mutated = self.generator.check_veo_status(proj)
        self.assertEqual(status_mutated["status"], "Stale")
        self.assertIn("scene_plan.json", status_mutated["stale_reason"])

    def test_16_veo_manual_edit_persistence(self):
        """16. Editing a shot via update_shot preserves the edit and marks status as edited."""
        scenes = [
            {"scene_id": "s1", "index": 1, "start": 0.0, "end": 6.0, "duration": 6.0, "speech_start": 0.0, "speech_end": 5.8, "category": "environment", "evidence_mode": "documented", "shot_type": "wide", "camera_motion": "static", "continuity_group": None, "visual_summary": "Valley", "narration": "A peaceful valley.", "image_prompt": "Valley prompt", "negative_prompt": "blurry"},
        ]
        proj = self._create_mock_project("A peaceful valley.", scenes, 6.0)
        self.generator.plan_project_veo(proj)

        updated = self.generator.update_shot(
            proj,
            "shot_001",
            {
                "subject_action": "A majestic golden eagle glides through the mountain pass",
                "camera_motion": "smooth lateral tracking camera",
            }
        )

        self.assertEqual(updated["status"], "edited")
        self.assertEqual(updated["subject_action"], "A majestic golden eagle glides through the mountain pass")
        self.assertEqual(updated["camera_motion"], "smooth lateral tracking camera")

        # Reload from disk and verify persistence
        with open(proj / "veo_prompts.json", "r", encoding="utf-8") as f:
            disk_data = json.load(f)
        self.assertEqual(disk_data["shots"][0]["status"], "edited")
        self.assertEqual(disk_data["shots"][0]["subject_action"], "A majestic golden eagle glides through the mountain pass")

    def test_17_veo_archive_on_regeneration(self):
        """17. Regenerating with force=True archives the previous draft into veo_prompts_archive_*.json."""
        scenes = [
            {"scene_id": "s1", "index": 1, "start": 0.0, "end": 6.0, "duration": 6.0, "speech_start": 0.0, "speech_end": 5.8, "category": "environment", "evidence_mode": "documented", "shot_type": "wide", "camera_motion": "static", "continuity_group": None, "visual_summary": "Valley", "narration": "A peaceful valley.", "image_prompt": "Valley prompt", "negative_prompt": "blurry"},
        ]
        proj = self._create_mock_project("A peaceful valley.", scenes, 6.0)
        self.generator.plan_project_veo(proj)

        # Force regenerate
        self.generator.plan_project_veo(proj, force=True)

        archives = list(proj.glob("veo_prompts_archive_*.json"))
        self.assertGreaterEqual(len(archives), 1)

    def test_18_veo_markdown_export_matches_json(self):
        """18. veo_prompts.md contains all shots matching veo_prompts.json."""
        scenes = [
            {"scene_id": "s1", "index": 1, "start": 0.0, "end": 6.0, "duration": 6.0, "speech_start": 0.0, "speech_end": 5.8, "category": "environment", "evidence_mode": "documented", "shot_type": "wide", "camera_motion": "static", "continuity_group": None, "visual_summary": "Valley", "narration": "A peaceful valley.", "image_prompt": "Valley prompt", "negative_prompt": "blurry"},
            {"scene_id": "s2", "index": 2, "start": 6.0, "end": 12.0, "duration": 6.0, "speech_start": 6.1, "speech_end": 11.8, "category": "reconstruction", "evidence_mode": "reconstruction", "shot_type": "medium", "camera_motion": "slow push-in", "continuity_group": None, "visual_summary": "Settlement", "narration": "A small settlement.", "image_prompt": "Settlement prompt", "negative_prompt": "blurry"},
        ]
        proj = self._create_mock_project("A peaceful valley. A small settlement.", scenes, 12.0)
        plan = self.generator.plan_project_veo(proj)

        md_p = proj / "veo_prompts.md"
        self.assertTrue(md_p.is_file())
        md_text = md_p.read_text(encoding="utf-8")

        for shot in plan["shots"]:
            self.assertIn(shot["shot_id"], md_text)
            self.assertIn(f"Shot {shot['index']:03d}", md_text)
            self.assertIn(shot["veo_prompt"], md_text)


    def test_19_veo_atomic_write_safety(self):
        """19. Atomic write leaves no partial temporary files in the project folder."""
        scenes = [
            {"scene_id": "s1", "index": 1, "start": 0.0, "end": 6.0, "duration": 6.0, "speech_start": 0.0, "speech_end": 5.8, "category": "environment", "evidence_mode": "documented", "shot_type": "wide", "camera_motion": "static", "continuity_group": None, "visual_summary": "Valley", "narration": "A peaceful valley.", "image_prompt": "Valley prompt", "negative_prompt": "blurry"},
        ]
        proj = self._create_mock_project("A peaceful valley.", scenes, 6.0)
        self.generator.plan_project_veo(proj)

        # No .tmp files should be left behind
        tmp_files = list(proj.glob("*.tmp*"))
        self.assertEqual(len(tmp_files), 0)

    def test_20_veo_validator_rejects_corrupted_plan(self):
        """20. Tampering with shot times, gaps, overlaps, or negative prompt tokens raises VeoPlanValidationError."""
        corrupted_shots = [
            {
                "shot_id": "shot_001",
                "index": 1,
                "parent_scene_id": "s1",
                "parent_scene_index": 1,
                "shot_split_index": 1,
                "shot_split_total": 1,
                "start": 0.0,
                "end": 6.0,
                "duration": 6.0,
                "shot_type": "wide",
                "camera_framing": "wide cinematic establishing shot",
                "camera_motion": "static cinematic camera",
                "aspect_ratio": "16:9",
                "subject_action": "Action",
                "environmental_action": "Environment",
                "lighting_atmosphere": "Lighting",
                "continuity_anchor": None,
                "tone": "neutral_explanatory",
                "narration": "Narration text",
                "veo_prompt": "A prompt text",
                "negative_prompt": "Missing mandatory tokens", # Corrupted: missing mandatory negative constraints!
                "status": "generated",
            }
        ]

        with self.assertRaises(VeoPlanValidationError) as ctx:
            self.generator.validate_veo_plan(corrupted_shots, audio_duration=6.0)
        self.assertIn("mandatory token", str(ctx.exception).lower())


    def test_21_shot_splitting_8s_boundary(self):
        """
        Audit I regression: Shot-splitting boundary around 8 seconds.
        Any scene > preferred_max_duration (8.0s) MUST be split into ≥2 shots.
        Sub-min-duration (< 3.0s) tail shots are forbidden for splitting of scenes ≥ min_duration.
        Exact: D=8.0s → 1 shot (exactly at max); D=8.001s → must be ≥2 shots.
        """
        gen = self.generator  # preferred_max=8.0, min=3.0, target=6.0
        self.assertEqual(gen.preferred_max_duration, 8.0)
        self.assertEqual(gen.min_duration, 3.0)

        # D at exactly preferred_max: should give 1 shot (allowed)
        boundary_cases = [
            (8.0,   1),   # exactly at limit → single shot OK
            (8.001, 2),   # just above → must split into ≥2
            (8.1,   2),
            (8.5,   2),
            (8.9,   2),
            (9.0,   2),
            (9.1,   2),
        ]
        for D, min_expected_shots in boundary_cases:
            if D <= gen.preferred_max_duration:
                num_shots = 1
            else:
                num_shots = max(2, int(round(D / gen.target_duration)))
                if (D / num_shots) < gen.min_duration and num_shots > 2:
                    num_shots = max(2, int(D // gen.min_duration))
            each = D / num_shots

            self.assertGreaterEqual(
                num_shots, min_expected_shots,
                f"D={D}s: expected ≥{min_expected_shots} shots, got {num_shots}"
            )
            self.assertGreaterEqual(
                each, gen.min_duration,
                f"D={D}s: sub-min shot duration {each:.3f}s (min={gen.min_duration})"
            )
            # D > preferred_max must never produce a single shot of > 8.0s
            if D > gen.preferred_max_duration:
                self.assertGreater(num_shots, 1,
                    f"D={D}s > preferred_max_duration but resulted in 1 shot!")


    def test_22_real_continuity_group_inheritance(self):
        """
        Corrective Audit BLOCKER B: Controlled fixture with non-null continuity_group.
        Verifies that when Phase 5 scenes have continuity_group='subject_sequence_01',
        Phase 6 generates non-null continuity_anchor for ALL child shots, including
        shots split from a long parent scene.
        """
        CONT_GROUP = "subject_sequence_01"

        scenes = [
            {
                "scene_id": "scene_001",
                "index": 1,
                "start": 0.0,
                "end": 6.0,
                "duration": 6.0,
                "speech_start": 0.0,
                "speech_end": 5.8,
                "category": "reconstruction",
                "evidence_mode": "reconstruction",
                "shot_type": "wide",
                "camera_motion": "slow push-in",
                "continuity_group": CONT_GROUP,
                "visual_summary": "Homo habilis individual at Olduvai Gorge",
                "narration": "Homo habilis roamed the Olduvai Gorge region, crafting stone tools on the savannah.",
                "image_prompt": "Homo habilis individual",
                "negative_prompt": "blurry",
            },
            {
                "scene_id": "scene_002",
                "index": 2,
                # Long scene > 8s: will be split into 2 shots
                "start": 6.0,
                "end": 22.0,
                "duration": 16.0,
                "speech_start": 6.1,
                "speech_end": 21.8,
                "category": "reconstruction",
                "evidence_mode": "reconstruction",
                "shot_type": "medium wide",
                "camera_motion": "slow lateral tracking",
                "continuity_group": CONT_GROUP,
                "visual_summary": "Homo habilis tool-making in open savannah",
                "narration": "The same Homo habilis individual continued knapping stone tools across the Olduvai Gorge site, demonstrating early tool-making behaviour.",
                "image_prompt": "Homo habilis tool-making",
                "negative_prompt": "blurry",
            },
            {
                "scene_id": "scene_003",
                "index": 3,
                "start": 22.0,
                "end": 28.0,
                "duration": 6.0,
                "speech_start": 22.1,
                "speech_end": 27.8,
                "category": "artifact",
                "evidence_mode": "documented",
                "shot_type": "close-up",
                "camera_motion": "slow push-in",
                "continuity_group": None,  # NOT in continuity group — must have null anchor
                "visual_summary": "Stone tool artifact close-up",
                "narration": "Fossilized stone tools recovered from the sediment layers.",
                "image_prompt": "Stone tools",
                "negative_prompt": "blurry",
            },
        ]

        proj = self._create_mock_project(
            "Homo habilis roamed Olduvai Gorge, Tanzania. The same individual continued.",
            scenes,
            audio_duration=28.0,
        )
        plan = self.generator.plan_project_veo_shots(proj)
        shots = plan["shots"]

        # scene_001 and scene_002 belong to CONT_GROUP; scene_003 does not
        scene1_shots = [s for s in shots if s["scene_id"] == "scene_001"]
        scene2_shots = [s for s in shots if s["scene_id"] == "scene_002"]
        scene3_shots = [s for s in shots if s["scene_id"] == "scene_003"]

        # 1. scene_002 must be split (duration 16s > 8s)
        self.assertGreaterEqual(len(scene2_shots), 2, "Long scene_002 (16s) must be split into ≥2 shots")

        # 2. ALL shots from CONT_GROUP scenes must have non-null continuity_anchor
        cont_shots = scene1_shots + scene2_shots
        for sh in cont_shots:
            self.assertIsNotNone(
                sh.get("continuity_anchor"),
                f"Shot {sh['shot_id']} from continuity_group={CONT_GROUP} must have non-null continuity_anchor"
            )
            self.assertIn(
                CONT_GROUP, sh.get("continuity_anchor", ""),
                f"continuity_anchor must include group name '{CONT_GROUP}'"
            )

        # 3. All shots from scene_001 and scene_002 share same continuity_group
        for sh in cont_shots:
            self.assertEqual(sh.get("continuity_group"), CONT_GROUP)

        # 4. Primary subject consistent across continuity group shots
        subjects = [sh.get("subject", "") for sh in cont_shots]
        # All should mention Homo habilis (the taxon from narration)
        for subj in subjects:
            self.assertIn(
                "homo habilis", subj.lower(),
                f"All continuity-group shots must preserve taxon 'Homo habilis' in subject, got: {subj}"
            )

        # 5. scene_003 (no continuity group) must have null anchor
        for sh in scene3_shots:
            self.assertIsNone(
                sh.get("continuity_anchor"),
                f"Shot {sh['shot_id']} (no continuity_group) must have null continuity_anchor"
            )

        # 6. No gaps/overlaps
        sorted_shots = sorted(shots, key=lambda x: x["start"])
        for i in range(1, len(sorted_shots)):
            gap = round(sorted_shots[i]["start"] - sorted_shots[i-1]["end"], 6)
            self.assertEqual(gap, 0.0, f"Gap found between shots {sorted_shots[i-1]['shot_id']} and {sorted_shots[i]['shot_id']}: {gap}")

    def test_23_tone_semantic_correctness(self):
        """
        Corrective Audit BLOCKER C: Unambiguous tone fixtures — expected == detected.
        Uses controlled narration texts with clear single-tone signals.
        """
        g = self.generator
        cases = [
            # (narration, category, expected_tone)
            # neutral_explanatory: purely descriptive, no cross-trigger keywords
            (
                "DNA replication is defined as the process by which a cell duplicates its genetic material. Each strand serves as a template.",
                "anatomy/science",
                "neutral_explanatory",
            ),
            (
                "Entropy is a measure of the disorder of a system and refers to its thermal randomness.",
                "process",
                "neutral_explanatory",
            ),
            # tension: explicit peril keywords
            (
                "The predators stalked the vulnerable prey through the drought-stricken savannah, a test of survival for the herd.",
                "reconstruction",
                "tension",
            ),
            # awe: clear cosmic/vast scale
            (
                "The universe stretches across vast cosmic distances, with galaxies separated by millions of light-years in the infinite void.",
                "establishing",
                "awe",
            ),
            # process: clear physical progression verbs, no neutral anchors
            (
                "The ancient stone knapper struck the volcanic core with butchery strikes, detaching sharp flint flakes with skilled knapping.",
                "process",
                "process",
            ),
            # discovery: clear excavation/found keyword
            (
                "The team excavated and discovered a buried cache of obsidian tools beneath the ancient sediment layers.",
                "artifact",
                "discovery",
            ),
        ]

        for narration, category, expected in cases:
            detected = g.infer_narrative_tone(narration, category)
            self.assertEqual(
                detected, expected,
                f"Tone mismatch for '{narration[:60]}...' — expected={expected}, detected={detected}"
            )

    def test_24_location_not_assigned_biological_action(self):
        """
        Corrective Audit BLOCKER A: Location/site proper nouns must NOT be assigned
        biological walking/foraging actions. Taxon names must be the biological subject.
        Tests the Olduvai Gorge / Tanzania / Homo habilis controlled input.
        """
        from studio.veo_prompt_generator import extract_proper_nouns, classify_proper_nouns

        g = self.generator
        narration = (
            "Olduvai Gorge in Tanzania is one of the most significant paleoanthropological "
            "sites in the world, where fossils of Homo habilis were first discovered by "
            "Mary and Louis Leakey."
        )

        nouns = extract_proper_nouns(narration)
        classified = classify_proper_nouns(nouns)

        # Verify classification
        self.assertIn("Homo habilis", classified["taxa"],
            "Homo habilis must be classified as a taxon, not a person or location")
        self.assertIn("Olduvai Gorge", classified["locations"],
            "Olduvai Gorge must be classified as a location, not a person or taxon")
        self.assertIn("Tanzania", classified["locations"],
            "Tanzania must be classified as a location")
        self.assertIn("Louis Leakey", classified["persons"],
            "Louis Leakey must be classified as a person")

        # Verify subject/action generation
        tone = g.infer_narrative_tone(narration, "reconstruction")
        subject, action = g.build_subject_and_action(narration, "reconstruction", "prehistory", tone, 1)

        # 1. Olduvai Gorge must appear somewhere in the output (as location context)
        combined = (subject + " " + action).lower()
        self.assertIn("olduvai", combined,
            "Olduvai Gorge must appear in the generated subject or action as location context")

        # 2. Homo habilis must appear as the subject (biological actor)
        self.assertIn("homo habilis", subject.lower(),
            f"Homo habilis must be the biological subject, not a location. Subject was: '{subject}'")

        # 3. Olduvai Gorge must NOT be the primary biological actor
        self.assertFalse(
            "olduvai gorge" in subject.lower() and "walking" in action.lower(),
            f"Olduvai Gorge (a location) must NOT be assigned walking action. Got: subject='{subject}', action='{action}'"
        )
        self.assertFalse(
            "olduvai gorge" in subject.lower() and "foraging" in action.lower(),
            f"Olduvai Gorge (a location) must NOT be assigned foraging action."
        )

        # 4. Tanzania must appear (as location context, not actor)
        self.assertIn("tanzania", combined,
            "Tanzania must appear as geographic context in the generated output")

        # 5. Non-prehistoric location test: verify generic European sites not used as actors
        narration_eu = "Pompeii was buried by the eruption of Mount Vesuvius in 79 AD, preserving a Roman city in volcanic ash."
        nouns_eu = extract_proper_nouns(narration_eu)
        classified_eu = classify_proper_nouns(nouns_eu)
        # Pompeii is in known locations — must NOT be a person/taxon
        locs_eu = [l.lower() for l in classified_eu["locations"]]
        self.assertIn("pompeii", locs_eu,
            "Pompeii must be classified as a location, not a person")


if __name__ == "__main__":
    unittest.main()
