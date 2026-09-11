"""
Unit and API integration tests for safe project deletion.
"""

import os
import shutil
import unittest
from pathlib import Path
from starlette.testclient import TestClient

from studio.config import PROJECTS_DIR
from studio.project_manager import delete_project
from studio.app import app, active_project_dirs


class TestProjectDeletion(unittest.TestCase):
    def setUp(self):
        self.test_dir_name = "2026-09-11_test_delete_unit_project"
        self.test_dir = PROJECTS_DIR / self.test_dir_name
        self.test_dir.mkdir(parents=True, exist_ok=True)
        (self.test_dir / "script.txt").write_text("Test narration content", encoding="utf-8")
        (self.test_dir / "settings.json").write_text('{"voice": "af_heart"}', encoding="utf-8")

        self.client = TestClient(app)

    def tearDown(self):
        if self.test_dir.exists():
            try:
                shutil.rmtree(self.test_dir)
            except Exception:
                pass
        active_project_dirs.discard(self.test_dir_name)

    def test_delete_project_function_success(self):
        self.assertTrue(self.test_dir.exists())
        result = delete_project(self.test_dir_name)
        self.assertTrue(result)
        self.assertFalse(self.test_dir.exists())

    def test_delete_project_path_traversal_rejection(self):
        # Empty
        with self.assertRaises(ValueError):
            delete_project("")

        # Parent directory traversal
        with self.assertRaises(ValueError):
            delete_project("../something")

        with self.assertRaises(ValueError):
            delete_project("..\\models")

        # Absolute paths
        with self.assertRaises(ValueError):
            delete_project("/etc/passwd")

    def test_delete_project_nonexistent_raises_404(self):
        with self.assertRaises(FileNotFoundError):
            delete_project("non_existent_folder_2026_xyz")

    def test_api_delete_project_success(self):
        resp = self.client.delete(f"/api/projects/{self.test_dir_name}")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["status"], "success")
        self.assertFalse(self.test_dir.exists())

    def test_api_delete_nonexistent_returns_404(self):
        resp = self.client.delete("/api/projects/2026-09-11_does_not_exist_xyz")
        self.assertEqual(resp.status_code, 404)

    def test_api_delete_active_project_returns_409(self):
        active_project_dirs.add(self.test_dir_name)
        resp = self.client.delete(f"/api/projects/{self.test_dir_name}")
        self.assertEqual(resp.status_code, 409)
        self.assertIn("Dự án đang trong quá trình xử lý", resp.json()["detail"])
        # Project should still exist
        self.assertTrue(self.test_dir.exists())


if __name__ == "__main__":
    unittest.main()
