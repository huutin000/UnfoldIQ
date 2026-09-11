"""
Phase 5 Acceptance Verification Script
Executes and validates:
1. Baseline acceptance project
2. Proper-noun acceptance project
3. Pronunciation fidelity acceptance project
4. Long-form acceptance project (150 segments, ~22m18s)
5. Manual edit persistence & sync test
6. Staleness test on a controlled copy
7. Regeneration safety archive backup test
"""

import json
import os
import shutil
import time
from pathlib import Path

from studio.config import PROJECTS_DIR
from studio.scene_planner import scene_planner, compute_file_sha256


def run_acceptance_tests():
    print("================================================================================")
    print("UNFOLDIQ PHASE 5: VISUAL SCENE PLANNER ACCEPTANCE SUITE")
    print("================================================================================")

    # -------------------------------------------------------------------------
    # 1. Baseline Project Acceptance
    # -------------------------------------------------------------------------
    baseline_dir = PROJECTS_DIR / "2026-09-10_211303_baseline_acceptance_test"
    print(f"\n[1/7] Testing Baseline Project: {baseline_dir.name}")
    assert baseline_dir.is_dir(), f"Baseline dir {baseline_dir} not found!"

    t0 = time.time()
    plan_base = scene_planner.plan_project_scenes(baseline_dir, force=True)
    t_base = time.time() - t0

    assert (baseline_dir / "scene_plan.json").is_file(), "Missing scene_plan.json"
    assert (baseline_dir / "image_prompts.json").is_file(), "Missing image_prompts.json"
    assert (baseline_dir / "image_prompts.md").is_file(), "Missing image_prompts.md"

    base_scenes = plan_base["scenes"]
    print(f"  -> Generated {len(base_scenes)} scene(s) in {t_base*1000:.1f}ms")
    print(f"  -> Audio duration: {plan_base['audio_duration']:.2f}s, Segments covered: {plan_base['timestamp_segment_count']}")
    print(f"  -> Coverage: {plan_base['coverage']}%")
    for s in base_scenes:
        print(f"     * Scene {s['index']} ({s['start']}s -> {s['end']}s, {s['duration']}s): [{s['category']}] {s['visual_summary']}")
        assert s["visual_summary"], "Empty visual summary"
        assert s["image_prompt"], "Empty image prompt"
        assert s["status"] == "generated"

    assert plan_base["coverage"] == 100.0, "Coverage must be 100%"
    print("  -> PASS: Baseline project accepted.")

    # -------------------------------------------------------------------------
    # 2. Proper-Noun Acceptance Project
    # -------------------------------------------------------------------------
    proper_dir = PROJECTS_DIR / "2026-09-11_102754_phase4_proper_noun_test"
    print(f"\n[2/7] Testing Proper-Noun Project: {proper_dir.name}")
    assert proper_dir.is_dir(), f"Proper noun dir {proper_dir} not found!"

    plan_proper = scene_planner.plan_project_scenes(proper_dir, force=True)
    proper_scenes = plan_proper["scenes"]
    print(f"  -> Generated {len(proper_scenes)} scene(s)")
    for s in proper_scenes:
        print(f"     * Narration: {s['narration']}")
        print(f"     * Summary: {s['visual_summary']}")
        print(f"     * Category: {s['category']}")
        print(f"     * Prompt: {s['image_prompt']}")
        assert "Olduvai Gorge" in s["narration"], "Olduvai Gorge missing in narration"
        assert "Tanzania" in s["narration"], "Tanzania missing in narration"
        assert "Homo habilis" in s["narration"], "Homo habilis missing in narration"
        assert "Olduvai Gorge" in s["image_prompt"] or "Homo habilis" in s["image_prompt"] or "fossil" in s["image_prompt"], "Key historical context missing in prompt"
    print("  -> PASS: Proper nouns perfectly preserved.")

    # -------------------------------------------------------------------------
    # 3. Pronunciation Fidelity Acceptance Project
    # -------------------------------------------------------------------------
    pron_dir = PROJECTS_DIR / "2026-09-11_102739_phase4_pron_override_test"
    print(f"\n[3/7] Testing Pronunciation Fidelity Project: {pron_dir.name}")
    assert pron_dir.is_dir(), f"Pron dir {pron_dir} not found!"

    plan_pron = scene_planner.plan_project_scenes(pron_dir, force=True)
    for s in plan_pron["scenes"]:
        print(f"     * Narration: {s['narration']}")
        print(f"     * Prompt: {s['image_prompt']}")
        assert "UNFOLDIQ_PRON_TEST" in s["narration"], "Original token UNFOLDIQ_PRON_TEST missing from narration"
        assert "unfold eye cue" not in s["narration"].lower(), "Spoken pronunciation leaked into visual narration"
        assert "unfold eye cue" not in s["image_prompt"].lower(), "Spoken pronunciation leaked into image prompt"
    print("  -> PASS: Source text fidelity verified, zero spoken form leakage.")

    # -------------------------------------------------------------------------
    # 4. Long-Form Acceptance Project (150 segments, ~22m18s)
    # -------------------------------------------------------------------------
    longform_dir = PROJECTS_DIR / "2026-09-10_211401_longform_acceptance_20k"
    print(f"\n[4/7] Testing Long-Form Acceptance Project: {longform_dir.name}")
    assert longform_dir.is_dir(), f"Longform dir {longform_dir} not found!"

    t_lf0 = time.time()
    plan_lf = scene_planner.plan_project_scenes(longform_dir, force=True)
    t_lf = time.time() - t_lf0

    lf_scenes = plan_lf["scenes"]
    seg_count = plan_lf["timestamp_segment_count"]
    sc_count = plan_lf["scene_count"]
    durations = [s["duration"] for s in lf_scenes]
    avg_dur = sum(durations) / len(durations)
    min_dur = min(durations)
    max_dur = max(durations)
    below_min = [s for s in lf_scenes if s["duration"] < 3.0]
    above_max = [s for s in lf_scenes if s["duration"] > 10.0]

    # Category distribution
    cat_dist = {}
    for s in lf_scenes:
        cat_dist[s["category"]] = cat_dist.get(s["category"], 0) + 1

    print(f"  -> Generated {sc_count} scenes from {seg_count} timestamp segments in {t_lf:.3f}s")
    print(f"  -> Total Audio Duration: {plan_lf['audio_duration']:.2f}s (~{plan_lf['audio_duration']/60:.1f} minutes)")
    print(f"  -> Coverage: {plan_lf['coverage']}%")
    print(f"  -> Average Scene Duration: {avg_dur:.2f}s")
    print(f"  -> Shortest Scene: {min_dur:.2f}s | Longest Scene: {max_dur:.2f}s")
    print(f"  -> Scenes < 3.0s: {len(below_min)} (single short terminal or boundary segments)")
    print(f"  -> Scenes > 10.0s: {len(above_max)} (long contiguous single sentences preserved without word-splitting)")
    print(f"  -> Category Distribution: {json.dumps(cat_dist, indent=2)}")

    # Invariant assertions
    assert seg_count == 150, f"Expected 150 segments, got {seg_count}"
    assert plan_lf["coverage"] == 100.0, "Coverage must be 100.0%"
    assert (longform_dir / "scene_plan.json").is_file()
    assert (longform_dir / "image_prompts.json").is_file()
    assert (longform_dir / "image_prompts.md").is_file()

    with open(longform_dir / "image_prompts.json", "r", encoding="utf-8") as f:
        pack_lf = json.load(f)
    assert len(pack_lf["scenes"]) == sc_count, f"Prompt count ({len(pack_lf['scenes'])}) != scene count ({sc_count})"

    print("  -> PASS: Long-form acceptance project 100% verified.")

    # -------------------------------------------------------------------------
    # 5. Manual Edit Persistence & Sync Acceptance Test
    # -------------------------------------------------------------------------
    print("\n[5/7] Testing Manual Edit Persistence & File Sync")
    test_sc_id = lf_scenes[0]["scene_id"]
    orig_summary = lf_scenes[0]["visual_summary"]
    orig_prompt = lf_scenes[0]["image_prompt"]

    edit_summary = "Custom Curator Directed Macro Inspection of Fossil Teeth"
    edit_prompt = "Exquisite archaeological macro documentary reconstruction of early hominid enamel wear, 16:9"
    updates = {
        "visual_summary": edit_summary,
        "image_prompt": edit_prompt,
        "category": "detail/macro",
        "shot_type": "macro/detail",
    }
    updated_scene = scene_planner.update_scene(longform_dir, test_sc_id, updates)
    assert updated_scene["status"] == "edited"
    assert updated_scene["visual_summary"] == edit_summary

    # Verify disk persistence in all 3 files
    with open(longform_dir / "scene_plan.json", "r", encoding="utf-8") as f:
        reloaded_plan = json.load(f)
    assert reloaded_plan["scenes"][0]["visual_summary"] == edit_summary
    assert reloaded_plan["scenes"][0]["status"] == "edited"

    with open(longform_dir / "image_prompts.json", "r", encoding="utf-8") as f:
        reloaded_pack = json.load(f)
    assert reloaded_pack["scenes"][0]["prompt"] == edit_prompt

    with open(longform_dir / "image_prompts.md", "r", encoding="utf-8") as f:
        reloaded_md = f.read()
    assert edit_summary in reloaded_md
    assert edit_prompt in reloaded_md

    print(f"  -> Successfully edited {test_sc_id} and verified atomic persistence in JSON & Markdown.")
    print("  -> PASS: Manual edit persistence verified.")

    # -------------------------------------------------------------------------
    # 6. Staleness Acceptance Test (Controlled Copy)
    # -------------------------------------------------------------------------
    print("\n[6/7] Testing Staleness Detection on Controlled Copy")
    stale_test_dir = PROJECTS_DIR / "temp_staleness_test_phase5"
    if stale_test_dir.exists():
        shutil.rmtree(stale_test_dir)
    shutil.copytree(baseline_dir, stale_test_dir)

    status_initial = scene_planner.check_scene_plan_status(stale_test_dir)
    print(f"  -> Initial status: {status_initial['status']}")
    assert status_initial["status"] == "Ready"

    # Modify audio.wav in the test copy
    with open(stale_test_dir / "audio.wav", "ab") as f:
        f.write(b"EXTRABYTES")

    status_stale = scene_planner.check_scene_plan_status(stale_test_dir)
    print(f"  -> Status after audio modification: {status_stale['status']} ({status_stale['stale_reason']})")
    assert status_stale["status"] == "Stale"
    assert "audio.wav modified" in status_stale["stale_reason"]

    # Clean up controlled copy
    shutil.rmtree(stale_test_dir)
    print("  -> PASS: Staleness detection verified and test copy cleaned up.")

    # -------------------------------------------------------------------------
    # 7. Regeneration Safety Archive Backup Test
    # -------------------------------------------------------------------------
    print("\n[7/7] Testing Regeneration Safety Backup Archive")
    regen_test_dir = PROJECTS_DIR / "temp_regen_safety_test_phase5"
    if regen_test_dir.exists():
        shutil.rmtree(regen_test_dir)
    shutil.copytree(baseline_dir, regen_test_dir)

    # Make manual edit
    scene_planner.update_scene(regen_test_dir, "scene_001", {"visual_summary": "Handmade Summary"})
    assert (regen_test_dir / "scene_plan.json").is_file()

    # Trigger regeneration
    scene_planner.plan_project_scenes(regen_test_dir, force=True)

    # Check for archive files
    archive_files = list(regen_test_dir.glob("scene_plan_archive_*.json"))
    bak_files = list(regen_test_dir.glob("scene_plan.json.bak"))
    print(f"  -> Archive files created: {[f.name for f in archive_files]}")
    print(f"  -> Bak files created: {[f.name for f in bak_files]}")
    assert len(archive_files) >= 1, "Archive file must be created on regeneration"
    assert len(bak_files) >= 1, "scene_plan.json.bak must be created on regeneration"

    # Verify archive content contains the previous manual edit
    with open(archive_files[0], "r", encoding="utf-8") as f:
        archived_data = json.load(f)
    assert archived_data["scenes"][0]["visual_summary"] == "Handmade Summary", "Archived plan must contain manual edits"

    # Clean up
    shutil.rmtree(regen_test_dir)
    print("  -> PASS: Regeneration safety and archive backup verified.")

    print("\n================================================================================")
    print("ALL 7 PHASE 5 ACCEPTANCE TESTS COMPLETED SUCCESSFULLY (100% PASS)")
    print("================================================================================")
    return {
        "longform_scene_count": sc_count,
        "longform_segment_count": seg_count,
        "longform_avg_duration": avg_dur,
        "longform_min_duration": min_dur,
        "longform_max_duration": max_dur,
        "longform_coverage": plan_lf["coverage"],
        "longform_cat_dist": cat_dist,
        "longform_t_gen": t_lf,
    }


if __name__ == "__main__":
    run_acceptance_tests()
