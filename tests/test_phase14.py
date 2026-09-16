"""
Unit Tests for Phase 14 — Free-first Automated Production Pipeline
Covers:
- Vietnamese Localization & status translation
- Free-first provider policy & secret masking
- Jobs & Activity tracker
- Reproducible Research, Source Set locking, and Claim Ledger
- Narrative Outline, Script versioning, and Outdated Dependency Tracking
- Canonical Asset Library and Reference Coverage
- Generation Manifests & Google Flow Adapter
- Media QC & Asset Intake Lineage with Lock Semantics
- Auto Timeline Compilation & Audio Policy (Master Narration, Mute generated audio)
- Renderer Adapter, Review Issues, and Export Package
"""

import json
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from studio.i18n import get_status_label, t, get_full_dictionary
from studio.provider_router import provider_router, CostPolicy, ProviderCapability
from studio.jobs_manager import jobs_manager, JobStatus
from studio.research_service import research_service, EvidenceType, SourceStatus
from studio.script_service import script_service
from studio.canonical_library import canonical_library
from studio.manifest_service import manifest_service
from studio.flow_adapter import flow_adapter
from studio.asset_intake import asset_intake, VariantLifecycleState
from studio.media_qc import media_qc
from studio.timeline_compiler import timeline_compiler
from studio.renderer_adapter import renderer_adapter

class TestPhase14Foundation(unittest.TestCase):
    def test_localization_status_mapping(self):
        self.assertEqual(get_status_label("READY"), "Sẵn sàng")
        self.assertEqual(get_status_label("LOCKED"), "Đã khóa")
        self.assertEqual(get_status_label("REVIEW"), "Cần xem xét")
        self.assertEqual(get_status_label("DIRECT_EVIDENCE"), "Bằng chứng trực tiếp")
        self.assertEqual(get_status_label("SUPPORTED_INFERENCE"), "Suy luận có cơ sở")
        self.assertEqual(get_status_label("PLAUSIBLE_RECONSTRUCTION"), "Tái hiện hợp lý")
        self.assertEqual(get_status_label("FREE_FIRST"), "Ưu tiên miễn phí")

    def test_ui_dictionary_defaults(self):
        full_dict = get_full_dictionary("vi-VN")
        self.assertEqual(full_dict["defaultUiLocale"], "vi-VN")
        self.assertEqual(full_dict["defaultContentLanguage"], "en-US")
        self.assertEqual(t("nav.home", "vi-VN"), "Trang chủ")
        self.assertEqual(t("project.tab.content", "vi-VN"), "Nội dung")
        self.assertEqual(t("project.tab.export", "vi-VN"), "Xuất video")

    def test_provider_router_cost_policy(self):
        self.assertEqual(provider_router.cost_policy, CostPolicy.FREE_FIRST)
        tts_prov = provider_router.get_active_provider(ProviderCapability.TTS)
        self.assertTrue(tts_prov["is_free"])
        self.assertEqual(tts_prov["name"], "Kokoro Neural TTS (Local)")

        vis_prov = provider_router.get_active_provider(ProviderCapability.VISUAL)
        self.assertTrue(vis_prov["is_free"])
        self.assertEqual(vis_prov["name"], "Google Flow")

        status = provider_router.get_status_overview()
        self.assertFalse(status["providers"]["veo_api"]["active"])
        self.assertEqual(provider_router.mask_secret("AIzaSyD-1234567890"), "AIza...7890")

    def test_jobs_manager_lifecycle(self):
        job = jobs_manager.create_job("test_render", project_id="test_proj")
        self.assertEqual(job["status"], JobStatus.QUEUED)

        jobs_manager.update_job(job["id"], status=JobStatus.RUNNING, progress=0.5, message="Đang chạy...")
        j = jobs_manager.get_job(job["id"])
        self.assertEqual(j["status"], JobStatus.RUNNING)
        self.assertEqual(j["progress"], 0.5)

        jobs_manager.cancel_job(job["id"])
        self.assertEqual(jobs_manager.get_job(job["id"])["status"], JobStatus.CANCELLED)

class TestPhase14ResearchAndScript(unittest.TestCase):
    def setUp(self):
        self.test_dir = Path(tempfile.mkdtemp(prefix="unfoldiq_test_p14_"))

    def tearDown(self):
        shutil.rmtree(self.test_dir, ignore_errors=True)

    def test_research_initialization_and_locking(self):
        summary = research_service.ensure_research_initialized(self.test_dir, topic="Homo habilis Childcare")
        self.assertGreaterEqual(summary["stats"]["totalSources"], 4)
        self.assertGreaterEqual(summary["stats"]["totalClaims"], 5)
        self.assertTrue(summary["stats"]["isLocked"])

        # Add a new source
        new_src = research_service.add_source(
            self.test_dir,
            title="New discovery on Oldowan tool use",
            url="https://doi.org/10.1038/example",
            publisher="Nature",
            author="Test Author",
            content_snapshot="Tool analysis confirms meat slicing"
        )
        self.assertEqual(new_src["status"], SourceStatus.APPROVED)

        # Lock source set
        locked_set = research_service.lock_source_set(self.test_dir, locked=True)
        self.assertTrue(locked_set["locked"])

        # Check claim ledger structure
        claims = summary["claims"]
        has_direct = any(c["evidence_type"] == EvidenceType.DIRECT_EVIDENCE for c in claims)
        has_inference = any(c["evidence_type"] == EvidenceType.SUPPORTED_INFERENCE for c in claims)
        self.assertTrue(has_direct)
        self.assertTrue(has_inference)

    def test_script_versioning_and_dependency_invalidation(self):
        (self.test_dir / "script.txt").write_text("Sentence one.\n\nSentence two.", encoding="utf-8")
        script = script_service.get_script_data(self.test_dir)
        self.assertEqual(len(script["sections"]), 2)
        self.assertEqual(script["version"], 1)

        # Update script with new version
        new_sections = [
            {"id": "sec_001", "title": "Section 1", "text": "Modified sentence one.", "claim_links": ["CLAIM-001"]},
            {"id": "sec_002", "title": "Section 2", "text": "Sentence two.", "claim_links": ["CLAIM-002"]}
        ]
        updated = script_service.update_script(self.test_dir, new_sections, new_version=True)
        self.assertEqual(updated["version"], 2)
        self.assertIn("voice", updated["outdatedDependencies"])
        self.assertIn("timing", updated["outdatedDependencies"])
        self.assertIn("scene_plan", updated["outdatedDependencies"])

        # Approve and lock
        locked = script_service.approve_and_lock_script(self.test_dir)
        self.assertTrue(locked["locked"])
        self.assertEqual(locked["status"], "APPROVED")

        # Narrative outline
        outline = script_service.get_outline(self.test_dir)
        self.assertGreaterEqual(len(outline), 8)
        self.assertEqual(outline[0]["type"], "HOOK")

    def test_assisted_discovery_and_approve_reject(self):
        research_service.ensure_research_initialized(self.test_dir)
        discovered = research_service.run_assisted_discovery(self.test_dir, topic="Homo habilis Childcare")
        self.assertGreaterEqual(len(discovered), 1)
        disc_id = discovered[0]["id"]

        # Approve discovered source
        ok = research_service.approve_source(self.test_dir, disc_id)
        self.assertTrue(ok)

        # Locking bumps version from v1 to v2
        locked_set = research_service.lock_source_set(self.test_dir, locked=True)
        self.assertTrue(locked_set["locked"])
        self.assertEqual(locked_set.get("sourceSetVersion"), 2)

class TestPhase14CanonicalLibraryAndManifest(unittest.TestCase):
    def test_canonical_library_coverage(self):
        chars = canonical_library.list_characters()
        self.assertGreaterEqual(len(chars), 3)

        mother = next(c for c in chars if c["id"] == "char_hh_primary_caregiver_01")
        self.assertIn("FRONT", mother["referenceCoverage"])
        self.assertIn("THREE_QUARTER", mother["referenceCoverage"])
        self.assertIn("PROFILE", mother["referenceCoverage"])
        self.assertIn("FULL_BODY", mother["referenceCoverage"])
        self.assertEqual(mother["flowName"], "Homo habilis Mother")

        # Resolve for scene
        resolved = canonical_library.resolve_scene_assets(
            ["char_hh_primary_caregiver_01", "char_hh_infant_01"],
            ["env_olduvai_gorge_grassland_01"]
        )
        self.assertIn("@Homo habilis Mother", resolved["flowTags"])
        self.assertIn("@Homo habilis Infant", resolved["flowTags"])

    def test_manifest_and_flow_adapter(self):
        test_dir = Path(tempfile.mkdtemp(prefix="unfoldiq_test_mf_"))
        try:
            scene = {
                "scene_id": "scene_035",
                "narration": "If its mother is occupied, an alloparent steps forward to hold the infant.",
                "duration": 6.0,
                "character_ids": ["char_hh_primary_caregiver_01", "char_hh_infant_01", "char_hh_secondary_caregiver_01"],
                "environment_ids": ["env_olduvai_gorge_grassland_01"]
            }
            manifest = manifest_service.generate_manifest_for_scene(test_dir, scene)
            self.assertEqual(manifest["id"], "GEN-SCENE_035-v1")
            self.assertEqual(manifest["provider"]["mode"], "flow_manual")
            self.assertIn("prompt", manifest)
            self.assertIn("camera", manifest["prompt"])
            self.assertIn("lighting", manifest["prompt"])

            # Flow instruction generation
            instructions = flow_adapter.prepare_flow_instructions("scene_035", manifest)
            self.assertIn("@Homo habilis Mother", instructions["flowPrompt"])
            self.assertIn("@Homo habilis Infant", instructions["flowPrompt"])
            self.assertEqual(len(instructions["userSteps"]), 4)
        finally:
            shutil.rmtree(test_dir, ignore_errors=True)

    def test_secondary_caregiver_and_reference_pack_policy(self):
        chars = canonical_library.list_characters()
        caregiver = next((c for c in chars if c["id"] == "char_hh_secondary_caregiver_01"), None)
        self.assertIsNotNone(caregiver)
        self.assertEqual(caregiver["status"], "APPROVED")
        self.assertTrue(caregiver["isLocked"])
        self.assertEqual(caregiver["flowName"], "Homo habilis Caregiver")

        ref_pack = caregiver.get("referencePack", {})
        self.assertEqual(ref_pack["FRONT"]["policy"], "REQUIRED")
        self.assertEqual(ref_pack["THREE_QUARTER"]["policy"], "REQUIRED")
        self.assertEqual(ref_pack["PROFILE"]["policy"], "REQUIRED")
        self.assertEqual(ref_pack["FULL_BODY"]["policy"], "RECOMMENDED")

        # Provider subset selection
        google_flow_refs = canonical_library.get_provider_references("char_hh_secondary_caregiver_01", "google_flow")
        self.assertGreaterEqual(len(google_flow_refs), 2)

    def test_visual_and_motion_blueprint_and_router(self):
        test_dir = Path(tempfile.mkdtemp(prefix="unfoldiq_test_bp_"))
        try:
            # 1. Character scene routes to IMAGE_FIRST
            char_scene = {
                "scene_id": "scene_010",
                "narration": "The Homo habilis mother holds her newborn close.",
                "duration": 5.0,
                "character_ids": ["char_hh_primary_caregiver_01"],
                "visual_type": "CHARACTER_SCENE"
            }
            manifest_char = manifest_service.generate_manifest_for_scene(test_dir, char_scene)
            self.assertEqual(manifest_char["routing"]["visual_type"], "CHARACTER_SCENE")
            self.assertEqual(manifest_char["routing"]["strategy"], "IMAGE_FIRST")
            self.assertIn("visual_blueprint", manifest_char)
            self.assertIn("motion_blueprint", manifest_char)
            self.assertIn("subject_anchor", manifest_char["visual_blueprint"])
            self.assertIn("temporal_beat", manifest_char["motion_blueprint"])

            # 2. Evidence scene routes to STATIC_IMAGE_ONLY
            evidence_scene = {
                "scene_id": "scene_011",
                "narration": "Microscopic wear on Oldowan flakes shows direct evidence of butchery.",
                "duration": 4.0,
                "visual_type": "EVIDENCE"
            }
            manifest_ev = manifest_service.generate_manifest_for_scene(test_dir, evidence_scene)
            self.assertEqual(manifest_ev["routing"]["visual_type"], "EVIDENCE")
            self.assertEqual(manifest_ev["routing"]["strategy"], "STATIC_IMAGE_ONLY")
            self.assertEqual(manifest_ev["routing"]["recommended_asset"], "STATIC_IMAGE")
        finally:
            shutil.rmtree(test_dir, ignore_errors=True)

class TestPhase14AssetIntakeAndTimeline(unittest.TestCase):
    def setUp(self):
        self.test_dir = Path(tempfile.mkdtemp(prefix="unfoldiq_test_intake_"))
        # Create dummy video clip
        self.dummy_video = self.test_dir / "dummy_clip.mp4"
        self.dummy_video.write_bytes(b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom" + b"\x00" * 200)

    def tearDown(self):
        shutil.rmtree(self.test_dir, ignore_errors=True)

    def test_asset_intake_and_lock_semantics(self):
        # Lifecycle semantics với QC PASS (mock ffprobe — dummy bytes không phải media thật).
        good_qc = {"readable": True, "passed": True, "issues": [], "mediaType": "video"}
        with mock.patch("studio.asset_intake.media_qc.inspect_media_file", return_value=good_qc):
            asset = asset_intake.intake_asset(
                self.test_dir,
                source_file_path=self.dummy_video,
                scene_id="scene_001",
                manifest_id="GEN-SCENE_001-V1",
                provider="google_flow",
                select_immediately=True
            )
        self.assertEqual(asset["lifecycle"], VariantLifecycleState.SELECTED)
        self.assertEqual(asset["scene_id"], "scene_001")
        self.assertIsNotNone(asset["checksum"])
        self.assertTrue(asset["qcPassed"])

        # Approve and lock
        locked_asset = asset_intake.update_asset_lifecycle(
            self.test_dir, asset["id"], VariantLifecycleState.LOCKED
        )
        self.assertTrue(locked_asset["locked"])
        self.assertEqual(locked_asset["lifecycle"], VariantLifecycleState.LOCKED)

        # Attempting to change locked asset without force_unlock raises ValueError
        with self.assertRaises(ValueError):
            asset_intake.update_asset_lifecycle(
                self.test_dir, asset["id"], VariantLifecycleState.REJECTED, force_unlock=False
            )

        # Force unlock allows transition
        unlocked = asset_intake.update_asset_lifecycle(
            self.test_dir, asset["id"], "UNLOCKED", force_unlock=True
        )
        self.assertFalse(unlocked["locked"])

    def test_qc_fail_asset_rejected_not_selected(self):
        # P0 (§3 FINAL-GAPS): QC FAIL → REJECTED + lý do, không auto-selected,
        # không vào timeline.
        bad_qc = {"readable": True, "passed": False, "issues": ["Độ phân giải dưới chuẩn HD"],
                  "error": "Độ phân giải dưới chuẩn HD", "mediaType": "video"}
        with mock.patch("studio.asset_intake.media_qc.inspect_media_file", return_value=bad_qc):
            asset = asset_intake.intake_asset(
                self.test_dir,
                source_file_path=self.dummy_video,
                scene_id="scene_009",
                select_immediately=True
            )
        self.assertEqual(asset["lifecycle"], VariantLifecycleState.REJECTED)
        self.assertFalse(asset["qcPassed"])
        self.assertTrue(asset["qcReason"])
        sel = asset_intake.get_selected_asset_for_scene(self.test_dir, "scene_009")
        self.assertIsNone(sel)

    def test_auto_timeline_compilation_and_audio_policy(self):
        # Set up mock scene plan
        sp = {
            "scenes": [
                {"scene_id": "scene_001", "duration": 5.0, "narration": "First scene."},
                {"scene_id": "scene_002", "duration": 6.5, "narration": "Second scene."}
            ]
        }
        (self.test_dir / "scene_plan.json").write_text(json.dumps(sp), encoding="utf-8")
        (self.test_dir / "audio.wav").write_bytes(b"RIFF" + b"\x00" * 100)

        # Intake asset for scene_001 (QC PASS qua mock — dummy bytes không phải media thật)
        good_qc = {"readable": True, "passed": True, "issues": [], "mediaType": "video"}
        with mock.patch("studio.asset_intake.media_qc.inspect_media_file", return_value=good_qc):
            asset_intake.intake_asset(
                self.test_dir,
                source_file_path=self.dummy_video,
                scene_id="scene_001"
            )

        timeline = timeline_compiler.compile_timeline(self.test_dir, mute_generated_audio=True)
        self.assertEqual(len(timeline["scenes"]), 2)
        self.assertTrue(timeline["audioPolicy"]["muteGeneratedAudio"])
        self.assertTrue(timeline["audioPolicy"]["narrationMaster"])
        self.assertTrue(timeline["scenes"][0]["hasVisual"])
        self.assertFalse(timeline["scenes"][1]["hasVisual"])
        self.assertIn("scene_002", timeline["missingAssetScenes"])
        self.assertEqual(timeline["stats"]["status"], "PARTIAL")

    def test_review_issues_and_export_package(self):
        # Create review issue
        iss = renderer_adapter.create_review_issue(
            self.test_dir,
            scene_id="scene_001",
            issue_type="CHARACTER_INCONSISTENCY",
            description="Mẹ Homo habilis thiếu ánh nhìn bảo bọc",
            severity="WARNING"
        )
        self.assertEqual(iss["status"], "OPEN")
        issues = renderer_adapter.list_review_issues(self.test_dir)
        self.assertEqual(len(issues), 1)

        # Resolve review issue
        ok = renderer_adapter.resolve_review_issue(self.test_dir, iss["id"])
        self.assertTrue(ok)
        resolved_issues = renderer_adapter.list_review_issues(self.test_dir)
        self.assertEqual(resolved_issues[0]["status"], "RESOLVED")

        # Build Export Package deliverables
        research_service.ensure_research_initialized(self.test_dir)
        fake_final = self.test_dir / "fake_final.mp4"
        fake_final.write_bytes(b"\x00" * 100)
        pkg = renderer_adapter.build_export_package(self.test_dir, fake_final)
        self.assertIn("final.mp4", pkg["deliverables"])
        self.assertIn("sources.md", pkg["deliverables"])
        self.assertIn("metadata.json", pkg["deliverables"])
        self.assertTrue((self.test_dir / "exports" / "sources.md").exists())

if __name__ == "__main__":
    unittest.main()
