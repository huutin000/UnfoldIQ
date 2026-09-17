"""
Unit and Integration Tests for Subphase 3C: Visual Workbench
Covers:
- Selective Visual API contracts (GET /visual/summary, /visual/scenes, /visual/scenes/{id}, /visual/shots/{id}, /visual/bible)
- Scene Navigator lightweight contract (sub-100ms, stable IDs, no heavy payloads)
- Shot Workspace contract (Visual Blueprint, Motion Blueprint, Veo Prompt, parameters)
- Visual Bible binding resolution (Characters, Environments, Props)
- Lock & Protection contracts (POST /lock/shot/{id})
- Prompt mutation contract (PUT /scenes/{id}, PUT /veo/shots/{id})
- HTML & accessibility markup verification
- 3A and 3B regression preservation
"""

import json
import shutil
import time
from pathlib import Path
import pytest
from starlette.testclient import TestClient

from studio.app import app
from studio.config import PROJECTS_DIR
from studio.project_adapter import project_adapter
from studio.domain_models import Scene, Shot, SceneSummary, VisualSummarySlice, VisualBibleSlice
from studio.locking import LockManager
from studio.project_bootstrap import get_project_state_store

REFERENCE_PROJECT = "2026-09-12_210003_youtube-narration-01"


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def test_visual_summary_selective_route(client):
    """Verify GET /api/projects/{dir_name}/visual/summary is fast and returns canonical counts."""
    t0 = time.perf_counter()
    resp = client.get(f"/api/projects/{REFERENCE_PROJECT}/visual/summary")
    elapsed_ms = (time.perf_counter() - t0) * 1000

    assert resp.status_code == 200
    assert elapsed_ms < 150.0  # Fast budget

    data = resp.json()
    assert data["project_id"] == REFERENCE_PROJECT
    assert data["schema_version"] == "2.0.0"
    assert data["total_scenes"] == 79
    assert data["total_shots"] == 141
    assert data["total_duration_seconds"] > 600.0  # ~665.64s
    assert data["visual_status"] in ("READY", "Ready")
    assert "entity_counts" in data
    assert data["entity_counts"]["characters"] >= 1
    assert data["entity_counts"]["environments"] >= 1


def test_visual_scenes_lightweight_route(client):
    """Verify GET /api/projects/{dir_name}/visual/scenes returns lightweight summaries without heavy prompts."""
    t0 = time.perf_counter()
    resp = client.get(f"/api/projects/{REFERENCE_PROJECT}/visual/scenes")
    elapsed_ms = (time.perf_counter() - t0) * 1000

    assert resp.status_code == 200
    assert elapsed_ms < 100.0

    scenes = resp.json()
    assert len(scenes) == 79
    first_sc = scenes[0]
    assert first_sc["scene_id"] == "scene_001"
    assert first_sc["index"] == 1
    assert first_sc["shot_count"] == 3
    assert first_sc["shot_ids"] == ["shot_001", "shot_002", "shot_003"]
    assert "is_locked" in first_sc
    assert "status" in first_sc
    # Verify no heavy payloads leaked into lightweight scene summary
    assert "veo_prompt" not in first_sc
    assert "image_prompt" not in first_sc


def test_visual_scene_detail_route(client):
    """Verify GET /api/projects/{dir_name}/visual/scenes/{scene_id} resolves scene and nested shots."""
    resp = client.get(f"/api/projects/{REFERENCE_PROJECT}/visual/scenes/scene_001")
    assert resp.status_code == 200

    data = resp.json()
    assert data["scene_id"] == "scene_001"
    assert data["index"] == 1
    assert len(data["shots"]) == 3
    assert data["image_prompt"] != ""
    assert data["negative_prompt"] != ""
    assert data["visual_summary"] != ""
    assert "narration" in data

    # Child shots have valid data
    sh1 = data["shots"][0]
    assert sh1["shot_id"] == "shot_001"
    assert sh1["parent_scene_id"] == "scene_001"
    assert sh1["veo_prompt"] != ""
    assert "camera_motion" in sh1
    assert "subject_action" in sh1


def test_visual_shot_detail_route(client):
    """Verify GET /api/projects/{dir_name}/visual/shots/{shot_id} resolves single shot with parameters."""
    resp = client.get(f"/api/projects/{REFERENCE_PROJECT}/visual/shots/shot_001")
    assert resp.status_code == 200

    shot = resp.json()
    assert shot["shot_id"] == "shot_001"
    assert shot["parent_scene_id"] == "scene_001"
    assert shot["index"] == 1
    assert shot["duration"] == pytest.approx(3.153, 0.01)
    assert shot["veo_prompt"] != ""
    assert shot["subject_action"] != ""
    assert shot["environmental_action"] != ""
    assert shot["camera_motion"] != ""
    assert shot["lighting_atmosphere"] != ""
    assert shot["continuity_anchor"] != ""
    assert "subjectIds" in shot
    assert "environmentId" in shot
    assert "is_locked" in shot

    # Test 404 for non-existent shot
    resp_404 = client.get(f"/api/projects/{REFERENCE_PROJECT}/visual/shots/non_existent_shot_999")
    assert resp_404.status_code == 404


def test_visual_bible_slice_route(client):
    """Verify GET /api/projects/{dir_name}/visual/bible loads visual entities independently."""
    resp = client.get(f"/api/projects/{REFERENCE_PROJECT}/visual/bible")
    assert resp.status_code == 200

    data = resp.json()
    assert data["project_id"] == REFERENCE_PROJECT
    assert data["characters_count"] >= 1
    assert data["environments_count"] >= 1
    assert data["objects_count"] >= 1
    assert "visual_bible" in data
    vb = data["visual_bible"]
    assert "subjects" in vb or "characters" in vb
    assert "environments" in vb


def test_scene_shot_stable_id_integrity():
    """Verify all shots reference valid parent scenes by stable ID, never by ordinal index."""
    project_dir = PROJECTS_DIR / REFERENCE_PROJECT
    veo_data = json.loads((project_dir / "veo_prompts.json").read_text(encoding="utf-8"))
    sp_data = json.loads((project_dir / "scene_plan.json").read_text(encoding="utf-8"))

    valid_scene_ids = {sc["scene_id"] for sc in sp_data["scenes"]}
    assert len(valid_scene_ids) == 79

    shots = veo_data["shots"]
    assert len(shots) == 141

    for sh in shots:
        parent_id = sh.get("parent_scene_id") or sh.get("parentSceneId") or sh.get("scene_id")
        assert parent_id in valid_scene_ids, f"Shot {sh.get('shot_id')} has invalid parent {parent_id}"
        assert isinstance(sh["shot_id"], str) and sh["shot_id"].startswith("shot_")


def test_visual_workbench_lock_contract(client):
    """Verify lock toggles for shots update StateStore and are reflected in loader."""
    shot_id = "shot_001"
    store = get_project_state_store(REFERENCE_PROJECT)
    lock_mgr = LockManager(store)
    initial_locked = lock_mgr.is_locked(shot_id)

    try:
        # Lock shot
        lock_resp = client.post(
            f"/api/projects/{REFERENCE_PROJECT}/lock/shot/{shot_id}",
            json={"locked": True, "reason": "Test lock verification"}
        )
        assert lock_resp.status_code == 200
        assert lock_resp.json()["is_locked"] is True
        assert lock_resp.json()["artifact_id"] == shot_id

        # Verify loader reflects locked state
        shot = project_adapter.load_shot_detail(REFERENCE_PROJECT, shot_id)
        assert shot.is_locked is True

        # Unlock shot
        unlock_resp = client.post(
            f"/api/projects/{REFERENCE_PROJECT}/lock/shot/{shot_id}",
            json={"locked": False, "reason": "Test unlock"}
        )
        assert unlock_resp.status_code == 200
        assert unlock_resp.json()["is_locked"] is False

        # Verify loader reflects unlocked state
        shot_unlocked = project_adapter.load_shot_detail(REFERENCE_PROJECT, shot_id)
        assert shot_unlocked.is_locked is False

    finally:
        # Restore initial state
        lock_mgr.set_lock(shot_id, initial_locked, "shot")


def test_visual_workbench_prompt_mutation_isolated(client, tmp_path):
    """Test updating image prompt and veo prompt in an isolated project fixture."""
    temp_dir_name = f"test_visual_mut_{int(time.time())}"
    temp_project_path = PROJECTS_DIR / temp_dir_name

    try:
        shutil.copytree(PROJECTS_DIR / REFERENCE_PROJECT, temp_project_path)

        # 1. Update Image prompt on scene_001
        new_img_prompt = "Custom updated visual blueprint prompt for test"
        new_neg_prompt = "no artifacts, test negative"
        scene_resp = client.put(
            f"/api/projects/{temp_dir_name}/scenes/scene_001",
            json={"image_prompt": new_img_prompt, "negative_prompt": new_neg_prompt}
        )
        assert scene_resp.status_code == 200
        assert scene_resp.json()["scene"]["image_prompt"] == new_img_prompt

        # Verify persisted to disk
        sc = project_adapter.load_scene_detail(temp_dir_name, "scene_001")
        assert sc.image_prompt == new_img_prompt
        assert sc.negative_prompt == new_neg_prompt

        # 2. Update Veo prompt on shot_001
        new_veo_prompt = "Cinematography: drone push, Action: moving slowly forward"
        shot_resp = client.put(
            f"/api/projects/{temp_dir_name}/veo/shots/shot_001",
            json={"veo_prompt": new_veo_prompt}
        )
        assert shot_resp.status_code == 200
        assert shot_resp.json()["shot"]["veo_prompt"] == new_veo_prompt

        # Verify persisted to disk
        sh = project_adapter.load_shot_detail(temp_dir_name, "shot_001")
        assert sh.veo_prompt == new_veo_prompt

    finally:
        if temp_project_path.exists():
            shutil.rmtree(temp_project_path, ignore_errors=True)


def test_visual_workbench_markup_in_index_html():
    """Verify index.html contains all 3-column Visual Workbench elements and Vietnamese labels."""
    index_path = Path("studio/static/index.html")
    assert index_path.exists()
    html = index_path.read_text(encoding="utf-8")

    # Section & Header
    assert 'id="ws-scenes"' in html
    assert "Hình ảnh &amp; Cảnh (Visual Workbench)" in html
    assert 'id="sp-search-input"' in html
    assert 'id="sp-filter-category"' in html
    assert 'id="sp-filter-status"' in html
    assert 'id="sp-rows-container"' in html
    assert 'id="sp-selected-detail"' in html

    # Col 3: Inspector
    assert 'id="inspector-scenes"' in html
    assert 'id="vw-bindings-container"' in html
    assert 'id="vw-bindings-card"' in html
    assert 'id="vw-lock-card"' in html
    assert 'id="btn-lock-shot"' in html
    assert 'id="vw-revisions-card"' in html
    assert 'id="vw-revisions-container"' in html


def test_regression_3a_and_3b_preserved(client):
    """Verify Phase 3A (Overview, Story) and 3B (Voice) endpoints remain 100% operational."""
    resp_overview = client.get(f"/api/projects/{REFERENCE_PROJECT}/v2/overview")
    assert resp_overview.status_code == 200

    resp_story = client.get(f"/api/projects/{REFERENCE_PROJECT}/story")
    assert resp_story.status_code == 200

    resp_voice = client.get(f"/api/projects/{REFERENCE_PROJECT}/v2/voice")
    assert resp_voice.status_code == 200
    assert resp_voice.json()["total_chunks"] == 135
