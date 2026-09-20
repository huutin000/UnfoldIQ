"""
Automated Test Suite for Subphase 3A: App Shell + Overview Workbench + Story Workbench.
Tests canonical 5-workbench navigation, overview v2 + next-action, story slice loading,
story beats stable ID mapping, atomic script save, and static assets consistency.
"""

import json
from pathlib import Path
import pytest
from starlette.testclient import TestClient

from studio.app import app
from studio.project_adapter import project_adapter


TEST_PROJECT_ID = "2026-09-12_210003_youtube-narration-01"


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def setup_test_project():
    p = Path(f"projects/{TEST_PROJECT_ID}")
    had_existed = p.exists()
    p.mkdir(parents=True, exist_ok=True)

    beats = [
        {
            "beat_id": f"beat_{i:03d}",
            "index": i,
            "title": f"Beat {i}",
            "text": f"Sentence number {i} for narration.",
            "style": "cinematic",
            "confidence": 0.95,
            "estimated_duration_sec": 5.0
        }
        for i in range(1, 139)
    ]
    (p / "story_beats.json").write_text(json.dumps({"schema_version": "2.0.0", "beats": beats}), encoding="utf-8")
    (p / "script.txt").write_text(" ".join(b["text"] for b in beats), encoding="utf-8")
    (p / "script.json").write_text(json.dumps({"text": " ".join(b["text"] for b in beats), "version": "1.0"}), encoding="utf-8")
    (p / "settings.json").write_text(json.dumps({"name": "Test Project", "schemaVersion": "15.0", "duration_seconds": 690.0}), encoding="utf-8")

    shots = [
        {
            "shot_id": f"shot_{i:03d}",
            "scene_id": f"scene_{(i-1)//2 + 1:03d}",
            "duration": 5.0
        }
        for i in range(1, 142)
    ]
    (p / "veo_prompts.json").write_text(json.dumps({"schema_version": "2.0.0", "shots": shots, "total_shots": 141}), encoding="utf-8")

    scenes = [{"scene_id": f"scene_{i:03d}", "duration": 10.0} for i in range(1, 72)]
    (p / "scene_plan.json").write_text(json.dumps({"schema_version": "2.0.0", "scenes": scenes}), encoding="utf-8")
    (p / "manifest.json").write_text(json.dumps({"chunks": []}), encoding="utf-8")
    (p / "timeline.json").write_text(json.dumps({"scenes": scenes}), encoding="utf-8")

    yield

    if not had_existed:
        import shutil
        shutil.rmtree(p, ignore_errors=True)


def test_3a_workbench_nav_in_index_html():
    """Verify index.html contains canonical 5 workbenches and Story Workbench 3-column markup."""
    index_path = Path("studio/static/index.html")
    assert index_path.exists(), "studio/static/index.html must exist"
    content = index_path.read_text(encoding="utf-8")

    # Stepper canonical 5 workbenches
    assert 'data-workspace="overview"' in content
    assert 'data-workspace="story"' in content
    assert 'data-workspace="audio"' in content
    assert 'data-workspace="scenes"' in content
    assert 'data-workspace="export"' in content

    # Vietnamese workbench names
    assert "Tổng quan" in content
    assert "Kịch bản" in content
    assert "Giọng đọc" in content
    assert "Hình ảnh & Cảnh" in content
    assert "Xuất video" in content

    # 3-Column Story Workbench structure
    assert 'id="ws-story"' in content
    assert 'class="story-navigator"' in content
    assert 'class="story-workspace"' in content
    assert 'class="story-inspector"' in content
    assert 'id="script-input"' in content
    assert 'id="btn-save-story-script"' in content
    assert 'id="story-save-badge"' in content
    assert 'id="story-beats-container"' in content
    assert 'id="story-edq-card"' in content
    assert 'id="story-beat-inspector-card"' in content

    # Overview enhancements
    assert 'id="overview-next-action-card"' in content
    assert 'id="overview-system-maintenance"' in content


def test_3a_overview_v2_endpoint(client):
    """Verify GET /api/projects/{dir_name}/v2/overview returns valid metrics."""
    res = client.get(f"/api/projects/{TEST_PROJECT_ID}/v2/overview")
    assert res.status_code == 200
    data = res.json()
    assert data["project_id"] == TEST_PROJECT_ID
    assert "status_summary" in data
    assert "stats" in data
    assert data["stats"]["shot_count"] >= 130
    assert data["stats"]["duration_seconds"] > 0


def test_3a_next_action_endpoint(client):
    """Verify deterministic Next Best Action endpoint."""
    res = client.get(f"/api/projects/{TEST_PROJECT_ID}/next-action")
    assert res.status_code == 200
    data = res.json()
    assert "next_action" in data
    action = data["next_action"]
    assert "target_workbench" in action
    assert "title" in action
    assert "reason" in action
    assert "label" in action
    # Target workbench should be one of canonical workbenches
    assert action["target_workbench"] in ["overview", "story", "audio", "scenes", "export"]


def test_3a_story_slice_endpoint(client):
    """Verify GET /api/projects/{dir_name}/story returns complete story slice with stable beat IDs."""
    res = client.get(f"/api/projects/{TEST_PROJECT_ID}/story")
    assert res.status_code == 200
    data = res.json()
    assert data["project_id"] == TEST_PROJECT_ID
    assert len(data["script"]) > 0
    assert len(data["beats"]) == 138  # exact match for YouTube narration project

    # Check stable beat_id format
    first_beat = data["beats"][0]
    assert first_beat["beat_id"] == "beat_001"
    assert "text" in first_beat
    assert "style" in first_beat
    assert "confidence" in first_beat
    assert first_beat["estimated_duration_sec"] > 0

    last_beat = data["beats"][-1]
    assert last_beat["beat_id"] == "beat_138"


def test_3a_story_slice_python_adapter():
    """Verify load_story_slice adapter function directly."""
    slice_data = project_adapter.load_story_slice(TEST_PROJECT_ID)
    assert slice_data is not None
    assert slice_data.project_id == TEST_PROJECT_ID
    assert len(slice_data.beats) == 138
    assert slice_data.beats[0].beat_id == "beat_001"


def test_3a_overview_slice_python_adapter():
    """Verify load_overview_slice adapter function directly."""
    overview = project_adapter.load_overview_slice(TEST_PROJECT_ID)
    assert overview is not None
    assert overview.project_id == TEST_PROJECT_ID
    assert overview.stats["shot_count"] == 141
    assert overview.stats["duration_seconds"] > 600.0


def test_3a_atomic_script_save(client, tmp_path):
    """Verify atomic script save endpoint preserves existing script or updates gracefully."""
    proj_dir = Path(f"projects/{TEST_PROJECT_ID}")
    s_json = proj_dir / "script.json"
    orig_bytes = s_json.read_bytes() if s_json.is_file() else None
    try:
        # Fetch current script first
        res = client.get(f"/api/projects/{TEST_PROJECT_ID}/script")
        assert res.status_code == 200
        orig_script = res.json()["script"]

        # Re-save the same script (no data corruption)
        res_save = client.post(
            f"/api/projects/{TEST_PROJECT_ID}/script",
            json={"script": orig_script}
        )
        assert res_save.status_code == 200
        save_data = res_save.json()
        assert save_data["ok"] is True
        assert save_data["char_count"] == len(orig_script)
        assert save_data["word_count"] > 0
        assert save_data["est_duration_sec"] > 0

        # Non-existent project should return 404
        res_404 = client.post(
            "/api/projects/non_existent_project_99999/script",
            json={"script": "Hello"}
        )
        assert res_404.status_code == 404
    finally:
        if orig_bytes is not None:
            s_json.write_bytes(orig_bytes)


def test_3a_css_styles_exist():
    """Verify uq-shell.css includes 3A classes."""
    css_path = Path("studio/static/uq-shell.css")
    assert css_path.exists()
    css_content = css_path.read_text(encoding="utf-8")
    assert ".uq-workbench-nav" in css_content
    assert ".story-workbench-grid" in css_content
    assert ".story-navigator" in css_content
    assert ".story-workspace" in css_content
    assert ".story-inspector" in css_content
    assert ".uq-next-action-card" in css_content
    assert ".uq-system-drawer" in css_content
