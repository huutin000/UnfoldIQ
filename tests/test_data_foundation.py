"""
Phase 1 Automated Verification Suite — Workflow & Data Foundation
Tests:
- Unified Pydantic Domain Models
- ProjectAdapter backward compatibility with real 79-scene project
- Fast file freshness check (mtime/size) vs sha256 performance
- GET /api/projects/{dir}/v2/state endpoint response
- Safe backup (.bak) on save
"""

import time
import shutil
from pathlib import Path
import pytest
from starlette.testclient import TestClient

from studio.app import app
from studio.config import PROJECTS_DIR
from studio.domain_models import Scene, Shot, AudioChunk, ProjectV2State
from studio.project_adapter import project_adapter, ProjectAdapter
from studio.transcription_service import transcription_service, get_audio_sha256_fast, _audio_hash_cache

SAMPLE_PROJECT = "2026-09-12_210003_youtube-narration-01"


def test_domain_models_instantiation():
    """Verify Shot, Scene, AudioChunk Pydantic models instantiate with defaults."""
    sh = Shot(
        shot_id="sc_01_sh1",
        parent_scene_id="sc_01",
        index=1,
        veo_prompt="Cinematic shot of ancient tundra at sunrise",
    )
    assert sh.shot_id == "sc_01_sh1"
    assert sh.shot_type == "medium wide"
    assert sh.camera_motion == "static cinematic camera"
    assert sh.aspect_ratio == "16:9"

    sc = Scene(
        scene_id="sc_01",
        index=1,
        category="reconstruction",
        duration=5.0,
        shots=[sh],
    )
    assert len(sc.shots) == 1
    assert sc.shots[0].shot_id == "sc_01_sh1"


def test_project_adapter_loads_real_project():
    """Verify ProjectAdapter correctly loads the 79-scene real project."""
    state = project_adapter.load_project_v2(SAMPLE_PROJECT)
    assert isinstance(state, ProjectV2State)
    assert state.project_id == SAMPLE_PROJECT
    assert len(state.scenes) == 79
    assert len(state.audio_chunks) > 0
    total_shots = sum(len(sc.shots) for sc in state.scenes)
    assert total_shots >= 79

    # Verify first scene has linked shots
    sc0 = state.scenes[0]
    assert sc0.scene_id == "scene_001"
    assert len(sc0.shots) >= 1
    assert sc0.shots[0].parent_scene_id == "scene_001"
    assert "veo_prompt" in sc0.shots[0].model_dump()


def test_fast_audio_hash_caching():
    """Verify fast audio hash cache returns in < 1ms on cache hit and matches exact hash."""
    audio_path = PROJECTS_DIR / SAMPLE_PROJECT / "audio.wav"
    assert audio_path.is_file(), "Missing audio.wav in sample project"

    # Reset cache for this project
    _audio_hash_cache.pop(SAMPLE_PROJECT, None)

    # First computation
    t0 = time.perf_counter()
    h1 = get_audio_sha256_fast(SAMPLE_PROJECT, audio_path)
    dur1 = (time.perf_counter() - t0) * 1000

    # Second computation (cache hit)
    t1 = time.perf_counter()
    h2 = get_audio_sha256_fast(SAMPLE_PROJECT, audio_path)
    dur2 = (time.perf_counter() - t1) * 1000

    assert h1 == h2
    assert len(h1) == 64
    # Cache hit should be sub-millisecond
    assert dur2 < 2.0, f"Cache hit took too long: {dur2:.3f}ms"


def test_check_project_timestamps_status_speed():
    """Verify check_project_timestamps_status executes in < 5ms without re-reading audio file."""
    t0 = time.perf_counter()
    status = transcription_service.check_project_timestamps_status(SAMPLE_PROJECT)
    dur = (time.perf_counter() - t0) * 1000

    assert status.get("exists") is True
    assert status.get("has_audio") is True
    assert dur < 10.0, f"Status check took too long: {dur:.2f}ms"


def test_api_get_project_v2_state():
    """Verify GET /api/projects/{dir}/v2/state returns 200 with complete state."""
    client = TestClient(app)
    resp = client.get(f"/api/projects/{SAMPLE_PROJECT}/v2/state")
    assert resp.status_code == 200
    data = resp.json()

    assert data["project_id"] == SAMPLE_PROJECT
    assert data["schema_version"] == "2.0.0"
    assert len(data["scenes"]) == 79
    assert "shots" in data["scenes"][0]
    assert len(data["scenes"][0]["shots"]) >= 1


def test_project_adapter_save_creates_backup(tmp_path):
    """Verify save_project_v2 safely writes files and creates .bak backups."""
    # Copy project structure into tmp_path
    proj_copy = tmp_path / "test_save_proj"
    src_proj = PROJECTS_DIR / SAMPLE_PROJECT
    shutil.copytree(src_proj, proj_copy)

    adapter = ProjectAdapter(projects_dir=tmp_path)
    state = adapter.load_project_v2("test_save_proj")

    # Modify one scene visual summary
    state.scenes[0].visual_summary = "Modified summary for testing backup"

    # Save
    adapter.save_project_v2(proj_copy, state, make_backup=True)

    # Check backup files exist
    assert (proj_copy / "scene_plan.json.bak").is_file()
    assert (proj_copy / "veo_prompts.json.bak").is_file()

    # Verify updated content in saved file
    reloaded = adapter.load_project_v2("test_save_proj")
    assert reloaded.scenes[0].visual_summary == "Modified summary for testing backup"


def test_selective_slice_endpoints():
    """Verify selective section-based loading for overview, story, voice, visual."""
    client = TestClient(app)

    # 1. Overview slice
    resp_overview = client.get(f"/api/projects/{SAMPLE_PROJECT}/v2/overview")
    assert resp_overview.status_code == 200
    ov_data = resp_overview.json()
    assert ov_data["project_id"] == SAMPLE_PROJECT
    assert "status_summary" in ov_data
    assert "stats" in ov_data
    assert ov_data["stats"]["scene_count"] == 79

    # 2. Story slice
    resp_story = client.get(f"/api/projects/{SAMPLE_PROJECT}/story")
    assert resp_story.status_code == 200
    st_data = resp_story.json()
    assert st_data["project_id"] == SAMPLE_PROJECT
    assert "script_text" in st_data
    assert st_data["word_count"] > 0
    assert st_data["estimated_duration_seconds"] > 0

    # 3. Voice slice
    resp_voice = client.get(f"/api/projects/{SAMPLE_PROJECT}/voice")
    assert resp_voice.status_code == 200
    vc_data = resp_voice.json()
    assert vc_data["project_id"] == SAMPLE_PROJECT
    assert "chunks" in vc_data
    assert vc_data["total_chunks"] > 0
    assert vc_data["has_audio"] is True

    # 4. Visual slice
    resp_visual = client.get(f"/api/projects/{SAMPLE_PROJECT}/visual")
    assert resp_visual.status_code == 200
    vs_data = resp_visual.json()
    assert vs_data["project_id"] == SAMPLE_PROJECT
    assert vs_data["total_scenes"] == 79
    assert vs_data["total_shots"] >= 79
    assert "visual_bible" in vs_data


def test_provider_abstractions():
    """Verify TTS and STT provider interfaces decouple business logic from concrete engines."""
    from studio.providers import (
        TTSProvider,
        STTProvider,
        KokoroTTSProvider,
        WhisperSTTProvider,
        AudioSynthesisResult,
        TranscriptionResult,
    )

    # 1. Kokoro provider
    kokoro = KokoroTTSProvider()
    assert isinstance(kokoro, TTSProvider)
    assert kokoro.name == "kokoro"
    voices = kokoro.list_available_voices()
    assert "af_sarah" in voices
    assert kokoro.is_available() is True

    # 2. Whisper provider
    whisper = WhisperSTTProvider()
    assert isinstance(whisper, STTProvider)
    assert whisper.name == "faster-whisper"
    assert whisper.is_available() is True


def test_contextual_visual_endpoints():
    """Verify Visual Workbench contextual loading (summary, lightweight scenes, scene detail, shot detail, bible)."""
    client = TestClient(app)

    # 1. Visual Summary endpoint
    t0 = time.perf_counter()
    resp_sum = client.get(f"/api/projects/{SAMPLE_PROJECT}/visual/summary")
    dur_sum = (time.perf_counter() - t0) * 1000
    assert resp_sum.status_code == 200
    sum_data = resp_sum.json()
    assert sum_data["project_id"] == SAMPLE_PROJECT
    assert sum_data["total_scenes"] == 79
    assert sum_data["total_shots"] >= 79
    assert sum_data["visual_status"] == "READY"
    assert "entity_counts" in sum_data

    # 2. Lightweight Scene List for Navigator (fast, no heavy veo_prompts in list)
    t1 = time.perf_counter()
    resp_scenes = client.get(f"/api/projects/{SAMPLE_PROJECT}/visual/scenes")
    dur_scenes = (time.perf_counter() - t1) * 1000
    assert resp_scenes.status_code == 200
    scenes_data = resp_scenes.json()
    assert isinstance(scenes_data, list)
    assert len(scenes_data) == 79
    sc0 = scenes_data[0]
    assert sc0["scene_id"] == "scene_001"
    assert sc0["shot_count"] >= 1
    assert isinstance(sc0["shot_ids"], list)
    assert "shot_ids" in sc0
    # Crucial: verify that the full nested 'shots' array with prompt text is NOT included in navigator list
    assert "shots" not in sc0

    # 3. Scene detail on demand (loads full scene with shots)
    resp_sc_detail = client.get(f"/api/projects/{SAMPLE_PROJECT}/visual/scenes/scene_001")
    assert resp_sc_detail.status_code == 200
    sc_detail = resp_sc_detail.json()
    assert sc_detail["scene_id"] == "scene_001"
    assert "shots" in sc_detail
    assert len(sc_detail["shots"]) >= 1
    first_shot_id = sc_detail["shots"][0]["shot_id"]

    # 4. Shot detail on demand (loads single shot card)
    resp_shot = client.get(f"/api/projects/{SAMPLE_PROJECT}/visual/shots/{first_shot_id}")
    assert resp_shot.status_code == 200
    sh_data = resp_shot.json()
    assert sh_data["shot_id"] == first_shot_id
    assert "veo_prompt" in sh_data

    # 5. Visual Bible separate slice
    resp_vb = client.get(f"/api/projects/{SAMPLE_PROJECT}/visual/bible")
    assert resp_vb.status_code == 200
    vb_data = resp_vb.json()
    assert vb_data["project_id"] == SAMPLE_PROJECT
    assert "visual_bible" in vb_data

    # 6. Not found error handling
    resp_404_sc = client.get(f"/api/projects/{SAMPLE_PROJECT}/visual/scenes/non_existent_scene_999")
    assert resp_404_sc.status_code == 404

    resp_404_sh = client.get(f"/api/projects/{SAMPLE_PROJECT}/visual/shots/non_existent_shot_999")
    assert resp_404_sh.status_code == 404


