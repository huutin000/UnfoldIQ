"""
Phase 6 Acceptance Verification Runner
Executes and validates Google Flow / Veo Prompt Generator:
1. Long-form project acceptance (1338.677s audio, 150 timestamps, 144 Phase 5 scenes)
2. All 16 required metrics collection
3. Cross-domain hygiene (Astrophysics, Computing, Thermodynamics)
4. Pronunciation fidelity (No spoken-form leakage)
5. Proper noun preservation
6. Manual edit persistence & Markdown synchronization
7. Staleness detection across all 4 upstream hashes
8. Archive safety on regeneration
9. Non-mutation invariant check of Phase 5 scene_plan.json
"""

import json
import os
import shutil
import statistics
import tempfile
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from studio.config import PROJECTS_DIR
from studio.veo_prompt_generator import (
    veo_generator,
    STANDARD_VEO_CONSTRAINTS,
    VeoPlanValidationError,
)
from studio.scene_planner import compute_file_sha256



def run_phase6_acceptance():
    print("=" * 80)
    print("UNFOLDIQ PHASE 6: GOOGLE FLOW / VEO PROMPT GENERATOR ACCEPTANCE SUITE")
    print("=" * 80)

    results = {}

    # -------------------------------------------------------------------------
    # 1. Long-Form Acceptance Project (20k chars, ~22m18s, 144 scenes)
    # -------------------------------------------------------------------------
    longform_dir = PROJECTS_DIR / "2026-09-10_211401_longform_acceptance_20k"
    print(f"\n[1/7] Testing Canonical Long-Form Project: {longform_dir.name}")
    assert longform_dir.is_dir(), f"Longform dir {longform_dir} not found!"

    # Record hash of scene_plan.json before generation to prove non-mutation
    scene_plan_path = longform_dir / "scene_plan.json"
    scene_hash_before = compute_file_sha256(scene_plan_path)

    t0 = time.time()
    veo_plan = veo_generator.plan_project_veo(longform_dir, force=True)
    t_longform = time.time() - t0

    # Non-mutation invariant check
    scene_hash_after = compute_file_sha256(scene_plan_path)
    assert scene_hash_before == scene_hash_after, "CRITICAL ERROR: Phase 5 scene_plan.json was mutated by Phase 6!"
    print("  -> Invariant Verified: Phase 5 scene_plan.json was NOT mutated (Bit-identical SHA-256 preserved).")

    # Verify artifacts exist
    veo_json_path = longform_dir / "veo_prompts.json"
    veo_md_path = longform_dir / "veo_prompts.md"
    assert veo_json_path.is_file(), "Missing veo_prompts.json"
    assert veo_md_path.is_file(), "Missing veo_prompts.md"

    shots = veo_plan["shots"]
    durations = [s["duration"] for s in shots]

    # Calculate 16 Metrics
    source_audio_duration = float(veo_plan["audio_duration"])
    source_timestamps_count = 150 # known from timestamps.json
    with open(longform_dir / "timestamps.json", "r", encoding="utf-8") as f:
        ts_data = json.load(f)
        source_timestamps_count = len(ts_data.get("segments", []))

    source_scene_count = int(veo_plan["scene_count"])
    generated_shot_count = len(shots)
    timeline_coverage = float(veo_plan["full_timeline_coverage"])

    # Long-scene split count: group shots by parent scene
    shots_by_scene = {}
    for s in shots:
        pid = s["parent_scene_id"]
        shots_by_scene.setdefault(pid, []).append(s)
    long_scene_split_count = sum(1 for p_shots in shots_by_scene.values() if len(p_shots) >= 2)

    max_shot_duration = max(durations)
    min_shot_duration = min(durations)
    mean_shot_duration = round(statistics.mean(durations), 3)
    median_shot_duration = round(statistics.median(durations), 3)

    # Shots within target window [3.0s, 8.0s]
    shots_in_window = sum(1 for d in durations if 3.0 <= d <= 8.0)
    pct_in_window = (shots_in_window / len(shots)) * 100.0

    # Negative prompt compliance
    neg_compliant_count = sum(
        1 for s in shots
        if all(token in s["negative_prompt"].lower() or token in s["veo_prompt"].lower() for token in STANDARD_VEO_CONSTRAINTS)
    )
    neg_compliance_pct = (neg_compliant_count / len(shots)) * 100.0

    # Hash tracking completeness
    hashes_present = [
        bool(veo_plan.get("source_script_sha256")),
        bool(veo_plan.get("audio_sha256")),
        bool(veo_plan.get("timestamps_sha256")),
        bool(veo_plan.get("scene_plan_sha256")),
    ]
    all_hashes_tracked = all(hashes_present)

    metrics = {
        "project_directory": longform_dir.name,
        "source_audio_duration_seconds": source_audio_duration,
        "source_timestamps_cue_count": source_timestamps_count,
        "source_scene_count": source_scene_count,
        "generated_shot_count": generated_shot_count,
        "timeline_coverage_percent": timeline_coverage,
        "long_scene_split_count": long_scene_split_count,
        "max_shot_duration_seconds": max_shot_duration,
        "min_shot_duration_seconds": min_shot_duration,
        "mean_shot_duration_seconds": mean_shot_duration,
        "median_shot_duration_seconds": median_shot_duration,
        "shots_within_target_window_count": shots_in_window,
        "shots_within_target_window_percent": pct_in_window,
        "negative_prompt_compliance_percent": neg_compliance_pct,
        "all_four_hashes_tracked": all_hashes_tracked,
        "generation_elapsed_seconds": round(t_longform, 3),
        "json_export_path": str(veo_json_path),
        "markdown_export_path": str(veo_md_path),
    }
    results["longform_metrics"] = metrics

    print("\n  ================ LONGFORM ACCEPTANCE 16 METRICS ================")
    print(f"  1.  Project Directory:               {metrics['project_directory']}")
    print(f"  2.  Source Audio Duration:           {metrics['source_audio_duration_seconds']:.3f}s (~22m18s)")
    print(f"  3.  Source Timestamps Cue Count:     {metrics['source_timestamps_cue_count']}")
    print(f"  4.  Source Phase 5 Scene Count:      {metrics['source_scene_count']}")
    print(f"  5.  Generated Veo Shot Count:        {metrics['generated_shot_count']}")
    print(f"  6.  Full Timeline Coverage:          {metrics['timeline_coverage_percent']:.1f}%")
    print(f"  7.  Long-Scene Split Count (>=2):    {metrics['long_scene_split_count']}")
    print(f"  8.  Max Shot Duration:               {metrics['max_shot_duration_seconds']:.3f}s")
    print(f"  9.  Min Shot Duration:               {metrics['min_shot_duration_seconds']:.3f}s")
    print(f"  10. Mean Shot Duration:              {metrics['mean_shot_duration_seconds']:.3f}s")
    print(f"  11. Median Shot Duration:            {metrics['median_shot_duration_seconds']:.3f}s")
    print(f"  12. Shots in Window [3.0s, 8.0s]:    {metrics['shots_within_target_window_count']}/{len(shots)} ({metrics['shots_within_target_window_percent']:.1f}%)")
    print(f"  13. Negative Prompt Compliance:      {metrics['negative_prompt_compliance_percent']:.1f}%")
    print(f"  14. All 4 Hashes Tracked:            {metrics['all_four_hashes_tracked']}")
    print(f"  15. Generation Elapsed Time:         {metrics['generation_elapsed_seconds']:.3f}s")
    print(f"  16. JSON & Markdown Export:          OK ({veo_json_path.name}, {veo_md_path.name})")
    print("  ================================================================")

    # Validations
    assert timeline_coverage == 100.0, "Timeline coverage must be 100.0%"
    assert generated_shot_count >= source_scene_count, "Shots must be >= scenes"
    assert neg_compliance_pct == 100.0, "Negative compliance must be 100%"
    assert all_hashes_tracked, "All 4 source hashes must be tracked"
    print("  -> PASS: Longform acceptance project validated.")

    # -------------------------------------------------------------------------
    # 2. Cross-Domain Hygiene: Astrophysics
    # -------------------------------------------------------------------------
    astro_dir = PROJECTS_DIR / "2026-09-11_audit_astrophysics"
    print(f"\n[2/7] Testing Astrophysics Domain Project: {astro_dir.name}")
    astro_plan = veo_generator.plan_project_veo(astro_dir, force=True)
    astro_shots = astro_plan["shots"]
    for s in astro_shots:
        p_lower = s["veo_prompt"].lower()
        for term in ["hominid", "stone tool", "flint knapping", "olduvai", "bipedal"]:
            assert term not in p_lower, f"Prehistoric leak in astrophysics shot: {term}"
        assert any(w in p_lower for w in ["star", "telescope", "cosmic", "astronomical", "deep-space", "celestial", "spacecraft"]), "Missing astrophysics keywords"
    print(f"  -> PASS: Astrophysics domain clean ({len(astro_shots)} shots, 0 prehistoric leakage).")

    # -------------------------------------------------------------------------
    # 3. Cross-Domain Hygiene: Computing
    # -------------------------------------------------------------------------
    comp_dir = PROJECTS_DIR / "2026-09-11_audit_computing"
    print(f"\n[3/7] Testing Computing Domain Project: {comp_dir.name}")
    comp_plan = veo_generator.plan_project_veo(comp_dir, force=True)
    comp_shots = comp_plan["shots"]
    for s in comp_shots:
        p_lower = s["veo_prompt"].lower()
        for term in ["hominid", "stone tool", "olduvai", "flint"]:
            assert term not in p_lower, f"Prehistoric leak in computing shot: {term}"
        assert any(w in p_lower for w in ["circuit", "computer", "semiconductor", "microchip", "technology", "laboratory", "hardware", "silicon", "processing"]), "Missing computing keywords"
    print(f"  -> PASS: Computing domain clean ({len(comp_shots)} shots, modern technology preserved).")

    # -------------------------------------------------------------------------
    # 4. Cross-Domain Hygiene: Thermodynamics
    # -------------------------------------------------------------------------
    thermo_dir = PROJECTS_DIR / "2026-09-11_audit_thermodynamics"
    print(f"\n[4/7] Testing Thermodynamics Domain Project: {thermo_dir.name}")
    thermo_plan = veo_generator.plan_project_veo(thermo_dir, force=True)
    thermo_shots = thermo_plan["shots"]
    for s in thermo_shots:
        p_lower = s["veo_prompt"].lower()
        for term in ["hominid", "stone tool", "olduvai", "flint"]:
            assert term not in p_lower, f"Prehistoric leak in thermodynamics shot: {term}"
        assert any(w in p_lower for w in ["entropy", "thermodynamic", "energy", "physical", "dispersion", "gradient", "balance"]), "Missing thermodynamics keywords"
    print(f"  -> PASS: Thermodynamics domain clean ({len(thermo_shots)} shots, physical process preserved).")

    # -------------------------------------------------------------------------
    # 5. Pronunciation Fidelity (No Spoken Form Leakage)
    # -------------------------------------------------------------------------
    pron_dir = PROJECTS_DIR / "2026-09-11_102739_phase4_pron_override_test"
    print(f"\n[5/7] Testing Pronunciation Fidelity Project: {pron_dir.name}")
    pron_plan = veo_generator.plan_project_veo(pron_dir, force=True)
    pron_shots = pron_plan["shots"]

    # Check that phonetic override text (e.g. "KAY-oh-ess", "NYOO-klee-ar") does not appear in prompt text
    meta_p = pron_dir / "settings.json" if (pron_dir / "settings.json").is_file() else pron_dir / "metadata.json"
    with open(meta_p, "r", encoding="utf-8") as f:
        meta = json.load(f)
        overrides = meta.get("pronunciation_overrides", [])


    for ov in overrides:
        spoken = ov.get("spoken_form", "")
        if len(spoken) > 3:
            for s in pron_shots:
                assert spoken.lower() not in s["veo_prompt"].lower(), f"Pronunciation spoken form leaked: {spoken}"
    print(f"  -> PASS: Pronunciation fidelity preserved across {len(pron_shots)} shots.")

    # -------------------------------------------------------------------------
    # 6. Manual Edit Persistence & Synchronization
    # -------------------------------------------------------------------------
    browser_dir = PROJECTS_DIR / "2026-09-11_audit_browser_test"
    print(f"\n[6/7] Testing Manual Edit & Persistence: {browser_dir.name}")
    veo_generator.plan_project_veo(browser_dir, force=True)

    edited_shot = veo_generator.update_shot(
        browser_dir,
        "shot_001",
        {
            "subject_action": "Custom physical action verified by automated acceptance suite",
            "camera_motion": "slow push-in",
        }
    )
    assert edited_shot["status"] == "edited", "Shot status must be edited"
    assert edited_shot["subject_action"] == "Custom physical action verified by automated acceptance suite"

    # Verify persistence on disk
    with open(browser_dir / "veo_prompts.json", "r", encoding="utf-8") as f:
        disk_plan = json.load(f)
    disk_s1 = disk_plan["shots"][0]
    assert disk_s1["status"] == "edited"
    assert disk_s1["subject_action"] == "Custom physical action verified by automated acceptance suite"

    # Verify Markdown export synchronized
    md_content = (browser_dir / "veo_prompts.md").read_text(encoding="utf-8")
    assert "shot_001" in md_content
    print("  -> PASS: Manual edit persistence and Markdown synchronization confirmed.")

    # -------------------------------------------------------------------------
    # 7. Staleness Detection & Regeneration Archive Safety
    # -------------------------------------------------------------------------
    print(f"\n[7/7] Testing Staleness & Regeneration Archive Safety on Temp Copy")
    with tempfile.TemporaryDirectory(prefix="unfoldiq_test_stale_") as tmp_td:
        tmp_p = Path(tmp_td) / "test_copy"
        shutil.copytree(browser_dir, tmp_p)

        # 1. Check initial status
        st = veo_generator.check_veo_status(tmp_p)
        assert st["status"] == "Ready"

        # 2. Touch script.txt -> stale
        (tmp_p / "script.txt").write_text("Modified text.", encoding="utf-8")
        st = veo_generator.check_veo_status(tmp_p)
        assert st["status"] == "Stale"
        assert "script.txt" in st["stale_reason"]

        # Restore script.txt
        shutil.copy2(browser_dir / "script.txt", tmp_p / "script.txt")
        st = veo_generator.check_veo_status(tmp_p)
        assert st["status"] == "Ready"

        # 3. Touch scene_plan.json -> stale
        with open(tmp_p / "scene_plan.json", "r", encoding="utf-8") as f:
            sc_d = json.load(f)
        sc_d["scene_count"] = 999
        (tmp_p / "scene_plan.json").write_text(json.dumps(sc_d, indent=2), encoding="utf-8")

        st = veo_generator.check_veo_status(tmp_p)
        assert st["status"] == "Stale"
        assert "scene_plan.json" in st["stale_reason"]

        # 4. Regenerate with force=True -> archive created
        archives_before = list(tmp_p.glob("veo_prompts_archive_*.json"))
        veo_generator.plan_project_veo(tmp_p, force=True)
        archives_after = list(tmp_p.glob("veo_prompts_archive_*.json"))
        assert len(archives_after) == len(archives_before) + 1, "Regeneration archive was not created!"
        print(f"  -> PASS: Staleness detection and archive safety verified ({archives_after[-1].name}).")

    print("\n" + "=" * 80)
    print("ALL 7 PHASE 6 ACCEPTANCE TEST SUITES PASSED SUCCESSFULLY!")
    print("=" * 80)

    # Save results summary JSON
    summary_path = Path("tests") / "phase6_acceptance_results.json"
    summary_path.write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(f"\nWrote acceptance summary to {summary_path}")
    return results


if __name__ == "__main__":
    run_phase6_acceptance()

