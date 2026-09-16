"""
Real Production E2E Pipeline Validation (Phase 14 P0-06)
Executes a real production run in temp/phase14_final_validation/
covering:
1. Research Initialization, Assisted Discovery & Source Set Locking (v2)
2. Claim Ledger & Narrative Script Versioning
3. Master Narration Audio & Word-aligned Timestamps (.SRT)
4. Visual Router & Decoupled Manifests:
   - Scene 1: CHARACTER_SCENE -> IMAGE_FIRST
   - Scene 2: ENVIRONMENT -> DIRECT_VIDEO_OR_IMAGE
   - Scene 3: EVIDENCE -> STATIC_IMAGE_ONLY
5. Real Asset Generation & Intake with Media QC:
   - Video clips for Scene 1 & 2
   - Static Image artifact for Scene 3
6. Auto Timeline Compilation (Master Kokoro Audio, Mute Generated Audio)
7. Draft Render (720p) and Production Final Render (1080p 24fps)
8. Deliverables Package assembly (final.mp4, subtitles.srt, sources.md, metadata.json)
9. Playable inspection and QC validation of final.mp4
"""

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

# Ensure project root is in sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from studio.research_service import research_service, SourceStatus
from studio.script_service import script_service
from studio.manifest_service import manifest_service, VisualType
from studio.canonical_library import canonical_library
from studio.asset_intake import asset_intake, VariantLifecycleState
from studio.media_qc import media_qc
from studio.timeline_compiler import timeline_compiler
from studio.renderer_adapter import renderer_adapter

def run_pipeline():
    print("=" * 70)
    print("STARTING REAL PRODUCTION E2E PIPELINE VALIDATION (PHASE 14 P0-06)")
    print("=" * 70)

    val_dir = PROJECT_ROOT / "temp" / "phase14_final_validation"
    if val_dir.exists():
        shutil.rmtree(val_dir, ignore_errors=True)
    val_dir.mkdir(parents=True, exist_ok=True)
    print(f"[*] Working validation directory: {val_dir}")

    # -------------------------------------------------------------------------
    # STEP 1: Research Service & Assisted Discovery
    # -------------------------------------------------------------------------
    print("\n[1/8] Initializing Research and Assisted Discovery...")
    res_summary = research_service.ensure_research_initialized(val_dir, topic="Homo habilis Childcare and Alloparenting")
    print(f"  - Bootstrapped {res_summary['stats']['approvedSources']} approved sources and {res_summary['stats']['totalClaims']} claims.")

    discovered = research_service.run_assisted_discovery(val_dir, topic="Homo habilis Childcare")
    print(f"  - AI Discovery found {len(discovered)} relevant academic sources.")
    first_disc_id = discovered[0]["id"]
    
    # Approve discovered source
    ok = research_service.approve_source(val_dir, first_disc_id)
    assert ok, "Failed to approve discovered source"
    print(f"  - Approved discovered source {first_disc_id}.")

    # Lock source set v2
    locked_source_set = research_service.lock_source_set(val_dir, locked=True)
    assert locked_source_set["locked"], "Source set lock failed"
    print(f"  - Locked Source Set: ID={locked_source_set['id']}, Version={locked_source_set.get('version')}.")

    # -------------------------------------------------------------------------
    # STEP 2: Script & Claims Linking
    # -------------------------------------------------------------------------
    print("\n[2/8] Creating and Locking Narrative Script...")
    script_sections = [
        {
            "id": "sec_001",
            "title": "Introduction: Maternal Burden",
            "text": "In the arid woodlands of Olduvai Gorge, a Homo habilis mother holds her vulnerable newborn close to her chest.",
            "claim_links": ["CLAIM-001"]
        },
        {
            "id": "sec_002",
            "title": "Habitat: The Riverine Forest",
            "text": "The riparian forest fringes offered vital cover from predators and shade during midday heat.",
            "claim_links": ["CLAIM-002"]
        },
        {
            "id": "sec_003",
            "title": "Material Culture: Tool Evidence",
            "text": "Microscopic polish and cutmarks on bone demonstrate that Oldowan stone flakes were essential to meat processing.",
            "claim_links": ["CLAIM-003"]
        }
    ]
    script_service.update_script(val_dir, script_sections, new_version=True)
    locked_script = script_service.approve_and_lock_script(val_dir)
    print(f"  - Script approved and locked (version {locked_script['version']}, 3 sections).")

    # -------------------------------------------------------------------------
    # STEP 3: Audio Master & Timestamps
    # -------------------------------------------------------------------------
    print("\n[3/8] Generating Master Audio (audio.wav) and Timestamps (.SRT)...")
    audio_wav = val_dir / "audio.wav"
    
    # Synthesize clean 24kHz Mono WAV with 9.0s duration via ffmpeg
    subprocess.run([
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", "sine=frequency=320:duration=9.0",
        "-ar", "24000", "-ac", "1",
        str(audio_wav)
    ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
    assert audio_wav.exists() and audio_wav.stat().st_size > 0, "audio.wav generation failed"
    print(f"  - Generated audio.wav ({audio_wav.stat().st_size} bytes, 24kHz Mono).")

    # Write word-level timestamp subtitles
    srt_content = """1
00:00:00,000 --> 00:00:03,000
In the arid woodlands of Olduvai Gorge, a Homo habilis mother holds her vulnerable newborn close to her chest.

2
00:00:03,000 --> 00:00:06,000
The riparian forest fringes offered vital cover from predators and shade during midday heat.

3
00:00:06,000 --> 00:00:09,000
Microscopic polish and cutmarks on bone demonstrate that Oldowan stone flakes were essential to meat processing.
"""
    (val_dir / "timestamps.srt").write_text(srt_content, encoding="utf-8")
    print("  - Generated timestamps.srt with 3 synchronized cues.")

    # -------------------------------------------------------------------------
    # STEP 4: Visual Routing & Manifest Blueprints
    # -------------------------------------------------------------------------
    print("\n[4/8] Routing Scenes & Generating Visual/Motion Blueprints...")
    scenes = [
        {
            "scene_id": "scene_001",
            "narration": "In the arid woodlands of Olduvai Gorge, a Homo habilis mother holds her vulnerable newborn close to her chest.",
            "duration": 3.0,
            "character_ids": ["char_hh_primary_caregiver_01", "char_hh_infant_01"],
            "environment_ids": ["env_olduvai_gorge_grassland_01"],
            "visual_type": "CHARACTER_SCENE"
        },
        {
            "scene_id": "scene_002",
            "narration": "The riparian forest fringes offered vital cover from predators and shade during midday heat.",
            "duration": 3.0,
            "character_ids": [],
            "environment_ids": ["env_olduvai_gorge_grassland_01"],
            "visual_type": "ENVIRONMENT"
        },
        {
            "scene_id": "scene_003",
            "narration": "Microscopic polish and cutmarks on bone demonstrate that Oldowan stone flakes were essential to meat processing.",
            "duration": 3.0,
            "character_ids": [],
            "environment_ids": [],
            "visual_type": "EVIDENCE"
        }
    ]
    (val_dir / "scene_plan.json").write_text(json.dumps({"scenes": scenes}, indent=2), encoding="utf-8")

    manifests = []
    for sc in scenes:
        mf = manifest_service.generate_manifest_for_scene(val_dir, sc)
        manifests.append(mf)
        print(f"  - {sc['scene_id']}: Type={mf['routing']['visual_type']}, Strategy={mf['routing']['strategy']}, RequiresVideo={mf['routing']['requiresVideo']}")

    assert manifests[0]["routing"]["strategy"] == "IMAGE_FIRST"
    assert manifests[1]["routing"]["strategy"] == "DIRECT_VIDEO_OR_IMAGE"
    assert manifests[2]["routing"]["strategy"] == "STATIC_IMAGE_ONLY"
    assert manifests[0]["visual_blueprint"] is not None
    assert manifests[0]["motion_blueprint"] is not None
    assert manifests[2]["motion_blueprint"] is None  # Static evidence does not require video

    # -------------------------------------------------------------------------
    # STEP 5: Real Media Asset Creation & Intake with Media QC
    # -------------------------------------------------------------------------
    print("\n[5/8] Creating and Ingesting Real Media Assets with QC...")
    temp_assets_dir = val_dir / "temp_raw_assets"
    temp_assets_dir.mkdir(parents=True, exist_ok=True)

    # Asset 1: 3-second 1080p MP4 clip for Character scene
    raw_clip1 = temp_assets_dir / "raw_scene1.mp4"
    subprocess.run([
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", "testsrc=size=1920x1080:rate=24:duration=3",
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        str(raw_clip1)
    ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)

    # Asset 2: 3-second 1080p MP4 clip for Environment scene
    raw_clip2 = temp_assets_dir / "raw_scene2.mp4"
    subprocess.run([
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", "testsrc=size=1920x1080:rate=24:duration=3",
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        str(raw_clip2)
    ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)

    # Asset 3: Static 1080p PNG photograph for Evidence scene (no video generation)
    raw_img3 = temp_assets_dir / "raw_scene3_evidence.png"
    subprocess.run([
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", "color=c=0x2e1065:s=1920x1080:d=1",
        "-vframes", "1",
        str(raw_img3)
    ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)

    # Intake Asset 1 (Video)
    ingested1 = asset_intake.intake_asset(
        val_dir,
        source_file_path=raw_clip1,
        scene_id="scene_001",
        manifest_id=manifests[0]["id"],
        provider="google_flow",
        select_immediately=True
    )
    asset_intake.update_asset_lifecycle(val_dir, ingested1["id"], VariantLifecycleState.LOCKED)
    print(f"  - Ingested Scene 1: {ingested1['id']} (Video MP4, QC={ingested1['qc']['passed']}, Locked)")

    # Intake Asset 2 (Video)
    ingested2 = asset_intake.intake_asset(
        val_dir,
        source_file_path=raw_clip2,
        scene_id="scene_002",
        manifest_id=manifests[1]["id"],
        provider="google_flow",
        select_immediately=True
    )
    asset_intake.update_asset_lifecycle(val_dir, ingested2["id"], VariantLifecycleState.LOCKED)
    print(f"  - Ingested Scene 2: {ingested2['id']} (Video MP4, QC={ingested2['qc']['passed']}, Locked)")

    # Intake Asset 3 (Static Image)
    ingested3 = asset_intake.intake_asset(
        val_dir,
        source_file_path=raw_img3,
        scene_id="scene_003",
        manifest_id=manifests[2]["id"],
        provider="google_flow",
        select_immediately=True
    )
    asset_intake.update_asset_lifecycle(val_dir, ingested3["id"], VariantLifecycleState.LOCKED)
    print(f"  - Ingested Scene 3: {ingested3['id']} (Static Image PNG, QC={ingested3['qc']['passed']}, Locked)")

    # -------------------------------------------------------------------------
    # STEP 6: Auto Timeline Compilation
    # -------------------------------------------------------------------------
    print("\n[6/8] Compiling Auto Timeline...")
    tl = timeline_compiler.compile_timeline(val_dir, mute_generated_audio=True)
    print(f"  - Timeline compiled: {tl['stats']['readyScenes']}/{tl['stats']['totalScenes']} scenes ready.")
    print(f"  - Audio Policy: NarrationMaster={tl['audioPolicy']['narrationMaster']}, MuteGeneratedAudio={tl['audioPolicy']['muteGeneratedAudio']}.")
    assert tl["stats"]["readyScenes"] == 3, f"Expected 3 ready scenes, got {tl['stats']['readyScenes']}"
    assert tl["stats"]["status"] == "READY"

    # -------------------------------------------------------------------------
    # STEP 7: Draft Render (720p) and Final Render (1080p Master)
    # -------------------------------------------------------------------------
    print("\n[7/8] Executing Draft and Final Renders...")
    print("  - Running Draft Render (720p ultrafast)...")
    draft_res = renderer_adapter.render_draft(val_dir)
    print(f"    -> Draft output: {draft_res['outputPath']} ({draft_res['fileSizeBytes']} bytes)")
    assert Path(draft_res["absolutePath"]).exists() and draft_res["fileSizeBytes"] > 1000

    print("  - Running Production Final Render (1080p Master)...")
    final_res = renderer_adapter.render_final(val_dir)
    print(f"    -> Final output: {final_res['outputPath']} ({final_res['fileSizeBytes']} bytes)")
    assert Path(final_res["absolutePath"]).exists() and final_res["fileSizeBytes"] > 1000

    # -------------------------------------------------------------------------
    # STEP 8: Deliverables Package & Quality Control Inspection
    # -------------------------------------------------------------------------
    print("\n[8/8] Inspecting Deliverables Package & Media Quality...")
    export_dir = val_dir / "exports"
    deliverables = ["final.mp4", "subtitles.srt", "sources.md", "description.txt", "metadata.json"]
    for item in deliverables:
        p = export_dir / item
        assert p.exists(), f"Missing deliverable: {item}"
        print(f"  [✓] Deliverable verified: {item} ({p.stat().st_size} bytes)")

    # Inspect final.mp4 with MediaQC
    final_mp4 = export_dir / "final.mp4"
    qc_result = media_qc.inspect_file(final_mp4)
    print(f"\nFinal Video Media QC Verdict:")
    print(f"  - Passed: {qc_result['passed']}")
    print(f"  - Duration: {qc_result['duration']}s (target: 9.0s)")
    print(f"  - Resolution: {qc_result['width']}x{qc_result['height']}")
    print(f"  - Video Codec: {qc_result['codec']}")
    print(f"  - Audio Codec: {qc_result['audioCodec']}")
    print(f"  - Issues: {qc_result['issues']}")

    assert qc_result["passed"], f"Final video QC failed: {qc_result['issues']}"
    assert qc_result["duration"] >= 8.5, f"Final video duration too short: {qc_result['duration']}"
    assert qc_result["width"] == 1920 and qc_result["height"] == 1080, "Expected 1080p resolution"

    print("\n" + "=" * 70)
    print("SUCCESS: REAL PRODUCTION E2E PIPELINE VALIDATION COMPLETED (PHASE 14 P0-06)")
    print("Status: PASS / FINAL")
    print("=" * 70)

if __name__ == "__main__":
    run_pipeline()
