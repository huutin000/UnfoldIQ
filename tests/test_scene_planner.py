"""
Unit tests for UnfoldIQ Phase 5 Visual Scene Planner & Image Prompt Pack.
Covers:
1. scene duration grouping
2. short-segment merge
3. max-duration behavior
4. 100% timestamp coverage
5. no invalid timeline ranges
6. scene ID uniqueness
7. source narration preservation
8. pronunciation spoken-form leakage prevention
9. scene-plan staleness detection
10. manual-edit persistence
11. prompt count == scene count
12. prompt pack validation
13. atomic writes
14. deterministic planning
15. category validation
"""

import hashlib
import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path

from studio.scene_planner import (
    ScenePlanner,
    ScenePlanValidationError,
    compute_file_sha256,
)
from studio.prompt_builder import (
    VISUAL_CATEGORIES,
    EVIDENCE_MODES,
    SHOT_TYPES,
    CAMERA_MOTIONS,
    detect_narration_domain,
    build_negative_prompt,
    infer_visual_category,
    build_image_prompt,
)


class TestScenePlanner(unittest.TestCase):
    def setUp(self):
        self.temp_dir = Path(tempfile.mkdtemp(prefix="unfoldiq_test_sp_"))
        self.planner = ScenePlanner(
            target_duration=6.0,
            min_duration=3.0,
            max_duration=10.0,
            aspect_ratio="16:9",
        )

    def tearDown(self):
        if self.temp_dir.exists():
            shutil.rmtree(self.temp_dir, ignore_errors=True)

    def _create_mock_project(
        self,
        script_text: str,
        segments: list,
        audio_duration: float,
    ) -> Path:
        """Helper to create a fully formed mock project with audio, script, and timestamps."""
        proj = self.temp_dir / "test_project"
        proj.mkdir(parents=True, exist_ok=True)

        (proj / "script.txt").write_text(script_text, encoding="utf-8")
        # Dummy audio wav
        (proj / "audio.wav").write_bytes(b"RIFFmockwavcontent" + b"\x00" * 2000)

        ts_data = {
            "version": 1,
            "audio_file": "audio.wav",
            "audio_sha256": compute_file_sha256(proj / "audio.wav"),
            "audio_duration": audio_duration,
            "segments": segments,
        }
        (proj / "timestamps.json").write_text(json.dumps(ts_data, indent=2), encoding="utf-8")
        return proj

    def test_01_scene_duration_grouping(self):
        """Test grouping of contiguous segments aiming for target duration (~6.0s) and timeline gap absorption."""
        segments = [
            {"index": 1, "start": 0.0, "end": 2.5, "text": "First short segment."},
            {"index": 2, "start": 2.5, "end": 5.8, "text": "Second segment continuing thought."},
            {"index": 3, "start": 6.0, "end": 12.2, "text": "Third longer sentence here."},
        ]
        scenes = self.planner.group_segments_into_scenes(segments, audio_duration=12.5)
        # Segments 1 and 2 group into Scene 1, holding until 6.0s (speech start of Scene 2)
        self.assertEqual(len(scenes), 2)
        self.assertEqual(scenes[0]["timestamp_segment_ids"], [1, 2])
        self.assertEqual(scenes[1]["timestamp_segment_ids"], [3])
        self.assertEqual(scenes[0]["start"], 0.0)
        self.assertEqual(scenes[0]["end"], 6.0)
        self.assertEqual(scenes[0]["duration"], 6.0)
        self.assertEqual(scenes[0]["speech_start"], 0.0)
        self.assertEqual(scenes[0]["speech_end"], 5.8)
        self.assertAlmostEqual(scenes[0]["hold_duration"], 0.2, places=2)

        # Scene 2 holds from 6.0 to 12.5 (full audio duration)
        self.assertEqual(scenes[1]["start"], 6.0)
        self.assertEqual(scenes[1]["end"], 12.5)
        self.assertEqual(scenes[1]["duration"], 6.5)
        self.assertEqual(scenes[1]["speech_start"], 6.0)
        self.assertEqual(scenes[1]["speech_end"], 12.2)
        self.assertAlmostEqual(scenes[1]["hold_duration"], 0.3, places=2)

    def test_02_short_segment_merge(self):
        """Test that very short segments (< min_duration 3.0s) are merged with adjacent segments."""
        segments = [
            {"index": 1, "start": 0.0, "end": 1.2, "text": "Prey."},
            {"index": 2, "start": 1.2, "end": 2.4, "text": "Or predators."},
            {"index": 3, "start": 2.4, "end": 6.5, "text": "The distinction mattered for survival on the open African savannah."},
        ]
        scenes = self.planner.group_segments_into_scenes(segments, audio_duration=7.0)
        self.assertEqual(len(scenes), 1)
        self.assertEqual(scenes[0]["timestamp_segment_ids"], [1, 2, 3])
        self.assertEqual(scenes[0]["speech_start"], 0.0)
        self.assertEqual(scenes[0]["speech_end"], 6.5)
        self.assertEqual(scenes[0]["start"], 0.0)
        self.assertEqual(scenes[0]["end"], 7.0)
        self.assertEqual(scenes[0]["duration"], 7.0)
        self.assertAlmostEqual(scenes[0]["hold_duration"], 0.5, places=2)
        self.assertGreaterEqual(scenes[0]["duration"], self.planner.min_duration)

    def test_03_max_duration_behavior(self):
        """Test that segments exceeding max_duration close the current scene or stand on their own."""
        segments = [
            {"index": 1, "start": 0.0, "end": 5.5, "text": "Opening section."},
            {"index": 2, "start": 5.5, "end": 18.0, "text": "A single very long sentence that was spoken continuously without pausing."},
            {"index": 3, "start": 18.0, "end": 23.5, "text": "Concluding remarks."},
        ]
        scenes = self.planner.group_segments_into_scenes(segments, audio_duration=24.0)
        # Must produce 3 scenes: Scene 1 (0-5.5), Scene 2 (5.5-18.0 standalone), Scene 3 (18-23.5)
        self.assertEqual(len(scenes), 3)
        self.assertEqual(scenes[0]["timestamp_segment_ids"], [1])
        self.assertEqual(scenes[1]["timestamp_segment_ids"], [2])
        self.assertEqual(scenes[2]["timestamp_segment_ids"], [3])
        self.assertEqual(scenes[1]["duration"], 12.5)

    def test_04_100_percent_timestamp_coverage(self):
        """Test that 100% of timestamp segments are assigned to scenes with zero drops and zero duplicates."""
        segments = [
            {"index": i, "start": (i - 1) * 2.5, "end": i * 2.5, "text": f"Segment sentence number {i}."}
            for i in range(1, 21)
        ]
        scenes = self.planner.group_segments_into_scenes(segments, audio_duration=50.0)
        all_assigned = []
        for sc in scenes:
            all_assigned.extend(sc["timestamp_segment_ids"])

        # No drops
        self.assertEqual(len(all_assigned), 20)
        # No duplicates
        self.assertEqual(len(set(all_assigned)), 20)
        # Exactly matching 1 to 20
        self.assertEqual(sorted(all_assigned), list(range(1, 21)))

    def test_05_no_invalid_timeline_ranges(self):
        """Test timeline monotonicity: start < end, non-overlapping sequential bounds."""
        segments = [
            {"index": 1, "start": 0.0, "end": 4.1, "text": "Part one."},
            {"index": 2, "start": 4.2, "end": 8.5, "text": "Part two."},
            {"index": 3, "start": 8.7, "end": 14.0, "text": "Part three."},
        ]
        scenes = self.planner.group_segments_into_scenes(segments, audio_duration=15.0)
        prev_end = 0.0
        for sc in scenes:
            self.assertGreaterEqual(sc["start"], 0.0)
            self.assertGreater(sc["end"], sc["start"])
            self.assertGreaterEqual(sc["start"], prev_end)
            prev_end = sc["end"]

    def test_06_scene_id_uniqueness(self):
        """Test that every scene receives a unique formatted scene_id (e.g. scene_001)."""
        segments = [
            {"index": i, "start": (i - 1) * 7.0, "end": i * 7.0, "text": f"Sentence {i}."}
            for i in range(1, 10)
        ]
        scenes = self.planner.group_segments_into_scenes(segments, audio_duration=70.0)
        ids = [sc["scene_id"] for sc in scenes]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(ids[0], "scene_001")
        self.assertEqual(ids[-1], f"scene_{len(scenes):03d}")

    def test_07_source_narration_preservation(self):
        """Test that scene narration strictly preserves the verbatim source text from timestamps."""
        text1 = "At Olduvai Gorge in Tanzania, researchers found new clues."
        text2 = "They re-examined two fossils belonging to Homo habilis."
        segments = [
            {"index": 1, "start": 0.0, "end": 3.5, "text": text1},
            {"index": 2, "start": 3.5, "end": 7.0, "text": text2},
        ]
        scenes = self.planner.group_segments_into_scenes(segments, audio_duration=7.5)
        # Should be combined into one scene
        self.assertEqual(len(scenes), 1)
        self.assertEqual(scenes[0]["narration"], f"{text1} {text2}")
        self.assertIn("Olduvai Gorge", scenes[0]["narration"])
        self.assertIn("Tanzania", scenes[0]["narration"])
        self.assertIn("Homo habilis", scenes[0]["narration"])

    def test_08_pronunciation_spoken_form_leakage_prevention(self):
        """Test that pronunciation spoken forms never leak into scene plan or prompts."""
        source_text = "This is UNFOLDIQ_PRON_TEST."
        segments = [
            {"index": 1, "start": 0.0, "end": 2.5, "text": source_text}
        ]
        scenes = self.planner.group_segments_into_scenes(segments, audio_duration=3.0)
        self.assertIn("UNFOLDIQ_PRON_TEST", scenes[0]["narration"])
        self.assertNotIn("unfold eye cue", scenes[0]["narration"].lower())
        self.assertNotIn("unfold eye cue", scenes[0]["image_prompt"].lower())

    def test_09_scene_plan_staleness_detection(self):
        """Test staleness detection when script.txt or audio.wav is modified."""
        script_text = "Testing staleness behavior."
        segments = [{"index": 1, "start": 0.0, "end": 4.0, "text": script_text}]
        proj = self._create_mock_project(script_text, segments, audio_duration=4.5)

        # Generate plan
        self.planner.plan_project_scenes(proj)
        status = self.planner.check_scene_plan_status(proj)
        self.assertEqual(status["status"], "Ready")

        # Mutate script.txt
        (proj / "script.txt").write_text("Modified script text!", encoding="utf-8")
        stale_status = self.planner.check_scene_plan_status(proj)
        self.assertEqual(stale_status["status"], "Stale")
        self.assertIn("script.txt modified", stale_status["stale_reason"])

    def test_10_manual_edit_persistence(self):
        """Test editing a scene's prompt and visual summary, and verifying persistence."""
        script_text = "Ancient hominids foraging in savannah."
        segments = [{"index": 1, "start": 0.0, "end": 5.0, "text": script_text}]
        proj = self._create_mock_project(script_text, segments, audio_duration=5.5)

        self.planner.plan_project_scenes(proj)
        # Edit scene_001
        updates = {
            "visual_summary": "Handcrafted visual direction for hominids",
            "image_prompt": "Ultra-detailed archaeological reconstruction with custom lighting",
            "category": "environment",
            "shot_type": "wide",
        }
        updated = self.planner.update_scene(proj, "scene_001", updates)
        self.assertEqual(updated["status"], "edited")
        self.assertEqual(updated["visual_summary"], updates["visual_summary"])

        # Reload from disk and verify
        with open(proj / "scene_plan.json", "r", encoding="utf-8") as f:
            reloaded = json.load(f)
        sc = reloaded["scenes"][0]
        self.assertEqual(sc["visual_summary"], updates["visual_summary"])
        self.assertEqual(sc["image_prompt"], updates["image_prompt"])
        self.assertEqual(sc["category"], "environment")
        self.assertEqual(sc["status"], "edited")

        # Verify synced in image_prompts.json and image_prompts.md
        with open(proj / "image_prompts.json", "r", encoding="utf-8") as f:
            pack = json.load(f)
        self.assertEqual(pack["scenes"][0]["prompt"], updates["image_prompt"])

        with open(proj / "image_prompts.md", "r", encoding="utf-8") as f:
            md_content = f.read()
        self.assertIn(updates["visual_summary"], md_content)
        self.assertIn(updates["image_prompt"], md_content)

    def test_11_prompt_count_equals_scene_count(self):
        """Test prompt count in image_prompts.json matches scene_plan.json scene count."""
        segments = [
            {"index": 1, "start": 0.0, "end": 4.0, "text": "Intro."},
            {"index": 2, "start": 4.0, "end": 8.0, "text": "Body."},
            {"index": 3, "start": 8.0, "end": 13.0, "text": "Conclusion."},
        ]
        proj = self._create_mock_project("Intro. Body. Conclusion.", segments, audio_duration=14.0)
        plan = self.planner.plan_project_scenes(proj)

        with open(proj / "image_prompts.json", "r", encoding="utf-8") as f:
            pack = json.load(f)

        self.assertEqual(len(pack["scenes"]), len(plan["scenes"]))
        self.assertEqual(pack["scene_count"], plan["scene_count"])

    def test_12_prompt_pack_validation(self):
        """Test prompt pack validator catches mismatched scene IDs or empty prompts."""
        plan_data = {
            "scenes": [
                {"scene_id": "scene_001", "start": 0.0, "end": 5.0, "image_prompt": "Prompt 1"}
            ]
        }
        # Mismatched scene ID
        bad_pack = {
            "scenes": [
                {"scene_id": "scene_999", "start": 0.0, "end": 5.0, "prompt": "Prompt 1"}
            ]
        }
        errors = self.planner.validate_prompt_pack(bad_pack, plan_data)
        self.assertTrue(len(errors) > 0)
        self.assertIn("Scene ID mismatch", errors[0])

    def test_13_atomic_writes(self):
        """Test atomic file writing replaces targets cleanly without leaving temp artifacts."""
        test_file = self.temp_dir / "atomic_test.json"
        self.planner._atomic_write_file(test_file, '{"test": "ok"}')
        self.assertTrue(test_file.is_file())
        with open(test_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        self.assertEqual(data["test"], "ok")
        # Ensure no .tmp files left over
        tmp_files = list(self.temp_dir.glob("*.tmp*"))
        self.assertEqual(len(tmp_files), 0)

    def test_14_deterministic_planning(self):
        """Test that identical input segments produce bit-for-bit identical scene plans."""
        segments = [
            {"index": 1, "start": 0.0, "end": 4.5, "text": "Early hominids in Olduvai Gorge."},
            {"index": 2, "start": 4.5, "end": 9.2, "text": "They carefully shaped handaxes from volcanic stone."},
        ]
        scenes_a = self.planner.group_segments_into_scenes(segments, audio_duration=10.0)
        scenes_b = self.planner.group_segments_into_scenes(segments, audio_duration=10.0)
        self.assertEqual(json.dumps(scenes_a, sort_keys=True), json.dumps(scenes_b, sort_keys=True))

    def test_15_category_validation(self):
        """Test keyword classification covers controlled categories without error."""
        cases = [
            ("The map shows the migration corridor across the continent.", "map"),
            ("Two million years ago in the Pleistocene era.", "timeline"),
            ("The fossilized skull was excavated from the sediment.", "artifact"),
            ("Anatomical analysis of the brain and dental enamel.", "anatomy/science"),
            ("Knapping and flaking stone to create sharp butchery blades.", "process"),
            ("In contrast to earlier hominids, Homo habilis had longer limbs.", "comparison"),
            ("Microscopic inspection of striations and wear marks.", "detail/macro"),
            ("Chapter One: The vast African horizon and endless rift valley.", "establishing"),
            ("Dry savannah grassland during seasonal drought.", "environment"),
        ]
        for narration, expected_cat in cases:
            cat = infer_visual_category(narration)
            self.assertEqual(cat, expected_cat, f"Mismatch for '{narration}': got {cat}, expected {expected_cat}")
            self.assertIn(cat, VISUAL_CATEGORIES)

    def test_16_timeline_gap_absorption_continuous_coverage(self):
        """Test that speech silences/pauses are absorbed, producing a gapless 100% continuous visual timeline."""
        segments = [
            {"index": 1, "start": 0.5, "end": 3.0, "text": "Sentence one starts after 0.5s pause."},
            {"index": 2, "start": 4.5, "end": 7.0, "text": "Sentence two has a 1.5s pause before it."},
            {"index": 3, "start": 8.0, "end": 11.0, "text": "Sentence three has a 1.0s pause before it."},
        ]
        audio_duration = 13.0
        scenes = self.planner.group_segments_into_scenes(segments, audio_duration=audio_duration)

        # Invariant 1: First scene starts at 0.000 (absorbing introductory audio pause)
        self.assertEqual(scenes[0]["start"], 0.000)
        self.assertEqual(scenes[0]["speech_start"], 0.5)

        # Invariant 2: Every scene end exactly equals next scene start (0 gaps, 0 overlaps)
        for i in range(len(scenes) - 1):
            self.assertEqual(scenes[i]["end"], scenes[i + 1]["start"])
            self.assertEqual(scenes[i]["end"], scenes[i + 1]["speech_start"])
            self.assertAlmostEqual(scenes[i]["hold_duration"], scenes[i]["end"] - scenes[i]["speech_end"], places=3)

        # Invariant 3: Last scene extends to full audio_duration (absorbing outro silence)
        self.assertEqual(scenes[-1]["end"], audio_duration)
        self.assertEqual(scenes[-1]["speech_end"], 11.0)
        self.assertAlmostEqual(scenes[-1]["hold_duration"], 2.0, places=3)

        # Invariant 4: Sum of scene durations == audio_duration
        total_dur = sum(sc["duration"] for sc in scenes)
        self.assertAlmostEqual(total_dur, audio_duration, places=3)

    def test_17_cross_domain_negative_prompt_hygiene(self):
        """Test domain detection and negative prompts prevent inappropriate thematic leakage."""
        # 1. Astrophysics
        astro_text = "A spinning neutron star emits beams of radiation across the galaxy."
        astro_domain = detect_narration_domain(astro_text)
        astro_neg = build_negative_prompt(astro_domain)
        self.assertEqual(astro_domain, "astrophysics")
        self.assertNotIn("modern clothing", astro_neg)
        self.assertNotIn("modern objects", astro_neg)

        # 2. Computing History
        tech_text = "The integrated circuit was perfected on silicon microchips in 1968."
        tech_domain = detect_narration_domain(tech_text)
        tech_neg = build_negative_prompt(tech_domain)
        self.assertEqual(tech_domain, "computing_technology")
        self.assertNotIn("modern objects", tech_neg)
        self.assertNotIn("modern technology", tech_neg)

        # 3. Prehistory
        prehist_text = "Homo habilis used volcanic basalt stones to butcher animal carcasses."
        prehist_domain = detect_narration_domain(prehist_text)
        prehist_neg = build_negative_prompt(prehist_domain)
        self.assertEqual(prehist_domain, "prehistory")
        self.assertIn("modern clothing", prehist_neg)
        self.assertIn("modern objects", prehist_neg)

    def test_18_avoidable_long_scene_elimination(self):
        """Test that short introductory segments are not grouped with long sentences into avoidable > 10s scenes."""
        segments = [
            {"index": 1, "start": 0.0, "end": 2.4, "text": "Consider the following."},
            {"index": 2, "start": 2.4, "end": 11.2, "text": "A complex sentence detailing the intricate dynamics of evolutionary divergence over two million years."},
        ]
        scenes = self.planner.group_segments_into_scenes(segments, audio_duration=11.5)
        # Should split into two scenes rather than forming one 11.2s scene
        self.assertEqual(len(scenes), 2)
        self.assertEqual(scenes[0]["timestamp_segment_ids"], [1])
        self.assertEqual(scenes[1]["timestamp_segment_ids"], [2])


if __name__ == "__main__":
    unittest.main()
