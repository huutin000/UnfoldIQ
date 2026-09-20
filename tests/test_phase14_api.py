"""
API Integration Tests for Phase 14 Endpoints
Tests FastAPI endpoints with Starlette TestClient:
- i18n & locale dictionaries
- Provider status & cost policy
- Background activity & jobs
- Global canonical library
- Project overview dashboard
- Reproducible research & claim ledger
- Versioned script & narrative outline
- Structured generation manifests & Google Flow instructions
- Auto timeline compiler
- Review issues & targeted fix
- Final deliverables package
"""

import json
import unittest
from starlette.testclient import TestClient

from studio.app import app

from pathlib import Path

class TestPhase14API(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)
        cls.project_id = "2026-09-12_210003_youtube-narration-01"
        cls.p_dir = Path(f"projects/{cls.project_id}")
        cls.p_dir.mkdir(parents=True, exist_ok=True)

        (cls.p_dir / "settings.json").write_text(json.dumps({"name": "Test Project", "schemaVersion": "15.0"}), encoding="utf-8")
        (cls.p_dir / "script.txt").write_text("Test narration script.", encoding="utf-8")
        (cls.p_dir / "script.json").write_text(json.dumps({"text": "Test narration script.", "version": "2.0", "contentLanguage": "en-US", "sections": [{"section_id": "sec_01", "title": "Intro", "content": "Test narration script."}]}), encoding="utf-8")
        (cls.p_dir / "manifest.json").write_text(json.dumps({"chunks": []}), encoding="utf-8")
        (cls.p_dir / "scene_plan.json").write_text(json.dumps({"scenes": [{"scene_id": "scene_001", "duration": 5.0}]}), encoding="utf-8")
        (cls.p_dir / "timeline.json").write_text(json.dumps({"timelineVersion": "1.0.0", "audioPolicy": {"narrationMaster": True, "muteGeneratedAudio": True}, "scenes": [{"scene_id": "scene_001", "duration": 5.0}]}), encoding="utf-8")
        (cls.p_dir / "research.json").write_text(json.dumps({"notes": [], "claims": []}), encoding="utf-8")
        (cls.p_dir / "review_issues.json").write_text(json.dumps({"issues": []}), encoding="utf-8")

        exp_pkg = cls.p_dir / "exports" / "package"
        exp_pkg.mkdir(parents=True, exist_ok=True)
        (exp_pkg / "manifest.json").write_text(json.dumps({"status": "ready"}), encoding="utf-8")

    @classmethod
    def tearDownClass(cls):
        import shutil
        if cls.p_dir.exists():
            shutil.rmtree(cls.p_dir, ignore_errors=True)

    def test_i18n_endpoint(self):
        resp = self.client.get("/api/i18n/vi-VN")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["defaultUiLocale"], "vi-VN")
        self.assertEqual(data["defaultContentLanguage"], "en-US")
        self.assertEqual(data["statuses"]["READY"], "Sẵn sàng")
        self.assertEqual(data["statuses"]["LOCKED"], "Đã khóa")

    def test_provider_status_and_cost_policy(self):
        resp = self.client.get("/api/provider/status")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["costPolicy"], "FREE_FIRST")
        self.assertTrue(data["providers"]["kokoro"]["isFree"])
        self.assertTrue(data["providers"]["google_flow"]["isFree"])
        self.assertFalse(data["providers"]["veo_api"]["active"])

        # Update cost policy
        post_resp = self.client.post("/api/provider/cost-policy", json={"policy": "FREE_ONLY"})
        self.assertEqual(post_resp.status_code, 200)
        self.assertEqual(post_resp.json()["policy"], "FREE_ONLY")

        # Revert to FREE_FIRST
        self.client.post("/api/provider/cost-policy", json={"policy": "FREE_FIRST"})

    def test_activity_jobs(self):
        resp = self.client.get("/api/activity/jobs")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("jobs", resp.json())

    def test_library_assets(self):
        resp = self.client.get("/api/library/assets")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("characters", data)
        self.assertIn("environments", data)
        self.assertIn("objects", data)
        self.assertIn("styles", data)
        self.assertGreaterEqual(len(data["characters"]), 3)

    def test_project_overview(self):
        resp = self.client.get(f"/api/projects/{self.project_id}/overview")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["projectId"], self.project_id)
        self.assertIn("stages", data)
        self.assertIn("research", data["stages"])
        self.assertIn("script", data["stages"])
        self.assertIn("voice", data["stages"])
        self.assertIn("scenes", data["stages"])
        self.assertIn("export", data["stages"])

    def test_research_and_claims(self):
        resp = self.client.get(f"/api/projects/{self.project_id}/research")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("sources", data)
        self.assertIn("claims", data)
        self.assertGreaterEqual(len(data["sources"]), 4)
        self.assertGreaterEqual(len(data["claims"]), 5)

        # Lock / unlock
        lock_resp = self.client.post(f"/api/projects/{self.project_id}/research/lock", json={"locked": True})
        self.assertEqual(lock_resp.status_code, 200)
        self.assertTrue(lock_resp.json()["sourceSet"]["locked"])

    def test_script_v2_and_outline(self):
        # Outline
        out_resp = self.client.get(f"/api/projects/{self.project_id}/script/outline")
        self.assertEqual(out_resp.status_code, 200)
        self.assertIn("outline", out_resp.json())

        # Versioned Script
        scr_resp = self.client.get(f"/api/projects/{self.project_id}/script/v2")
        self.assertEqual(scr_resp.status_code, 200)
        data = scr_resp.json()
        self.assertIn("sections", data)
        self.assertEqual(data["contentLanguage"], "en-US")

    def test_manifest_and_flow_instructions(self):
        resp = self.client.get(f"/api/projects/{self.project_id}/scenes/scene_001/manifest")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("flowPrompt", data)
        self.assertEqual(data["provider"]["mode"], "flow_manual")

        # Flow instructions
        flow_resp = self.client.get(f"/api/projects/{self.project_id}/scenes/scene_001/flow-instructions")
        self.assertEqual(flow_resp.status_code, 200)
        flow_data = flow_resp.json()
        self.assertIn("flowPrompt", flow_data)
        self.assertIn("userSteps", flow_data)

    def test_timeline_v2(self):
        resp = self.client.get(f"/api/projects/{self.project_id}/timeline/v2")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["timelineVersion"], "1.0.0")
        self.assertTrue(data["audioPolicy"]["narrationMaster"])
        self.assertTrue(data["audioPolicy"]["muteGeneratedAudio"])
        self.assertIn("scenes", data)

    def test_review_issues_lifecycle(self):
        # Create issue
        post_resp = self.client.post(
            f"/api/projects/{self.project_id}/review/issues",
            json={
                "scene_id": "scene_002",
                "issue_type": "VISUAL_ARTIFACT",
                "description": "Lỗi bóng mờ chuyển động",
                "severity": "WARNING"
            }
        )
        self.assertEqual(post_resp.status_code, 200)
        issue = post_resp.json()["issue"]
        self.assertEqual(issue["status"], "OPEN")

        # Resolve issue
        res_resp = self.client.post(f"/api/projects/{self.project_id}/review/issues/{issue['id']}/resolve")
        self.assertEqual(res_resp.status_code, 200)

    def test_export_package(self):
        resp = self.client.get(f"/api/projects/{self.project_id}/export/package")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("deliverables", data)
        self.assertIn("final.mp4", data["deliverables"])
        self.assertIn("sources.md", data["deliverables"])
        self.assertIn("metadata.json", data["deliverables"])

if __name__ == "__main__":
    unittest.main()
