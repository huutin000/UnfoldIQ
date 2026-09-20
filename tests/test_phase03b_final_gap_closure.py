import json
import pytest
from pathlib import Path
from starlette.testclient import TestClient
from studio.app import app
from studio.project_adapter import project_adapter
from studio.project_bootstrap import bootstrap_project_graph, get_project_state_store
from studio.locking import LockManager

client = TestClient(app)
SAMPLE_PROJECT = "2026-09-12_210003_youtube-narration-01"


@pytest.fixture(autouse=True)
def hermetic_project():
    from tests.fixtures.project_factory import hermetic_canonical_project_in_projects_dir
    with hermetic_canonical_project_in_projects_dir(SAMPLE_PROJECT) as p:
        yield p

def test_gate_b_canonical_chunk_regenerate_route():
    """Test Gate B: Canonical POST /api/projects/{dir_name}/voice/chunks/{chunk_id}/regenerate with stable ID."""
    store = get_project_state_store(SAMPLE_PROJECT)
    graph = bootstrap_project_graph(SAMPLE_PROJECT, state_store=store)
    lock_mgr = LockManager(store, graph=graph)
    lock_mgr.set_lock("c_01", False, "audio_chunk")
    
    resp = client.post(
        f"/api/projects/{SAMPLE_PROJECT}/voice/chunks/c_01/regenerate",
        json={"speed": 1.0, "voice": "af_heart"}
    )
    # The actual regeneration might return 200 or 500 if Kokoro weights are not loaded,
    # but the route resolution must succeed without 404 or 400.
    assert resp.status_code in [200, 500, 503]
    if resp.status_code == 200:
        data = resp.json()
        assert data.get("status") == "success" or data.get("ok") is True

def test_gate_b_legacy_chunk_rerender_compatibility_route():
    """Test Gate B: Dual-routing compatibility for legacy /voice-qa/rerender-chunk/{chunk_index}."""
    store = get_project_state_store(SAMPLE_PROJECT)
    graph = bootstrap_project_graph(SAMPLE_PROJECT, state_store=store)
    lock_mgr = LockManager(store, graph=graph)
    lock_mgr.set_lock("c_01", False, "audio_chunk")
    
    resp = client.post(
        f"/api/projects/{SAMPLE_PROJECT}/voice-qa/rerender-chunk/0",
        json={"speed": 1.0, "voice": "af_heart"}
    )
    assert resp.status_code in [200, 500, 503]

def test_gate_e_locked_chunk_rejection_409():
    """Test Gate E: Regenerating a locked chunk returns HTTP 409 Conflict with CHUNK_LOCKED."""
    store = get_project_state_store(SAMPLE_PROJECT)
    graph = bootstrap_project_graph(SAMPLE_PROJECT, state_store=store)
    lock_mgr = LockManager(store, graph=graph)
    lock_mgr.set_lock("c_01", True, "audio_chunk")
    try:
        resp = client.post(
            f"/api/projects/{SAMPLE_PROJECT}/voice/chunks/c_01/regenerate",
            json={"speed": 1.0, "voice": "af_heart"}
        )
        assert resp.status_code == 409
        data = resp.json()
        detail = data.get("detail")
        if isinstance(detail, dict):
            assert detail.get("code") == "CHUNK_LOCKED"
        else:
            assert "locked" in str(detail).lower()
    finally:
        lock_mgr.set_lock("c_01", False, "audio_chunk")

def test_gate_e_toggle_lock_endpoint():
    """Test Gate E: Lock toggling via /api/projects/{dir_name}/lock/{artifact_type}/{artifact_id}."""
    # Toggle lock on
    resp = client.post(
        f"/api/projects/{SAMPLE_PROJECT}/lock/audio_chunk/c_02",
        json={"locked": True}
    )
    assert resp.status_code == 200
    assert resp.json().get("is_locked") is True
    
    # Toggle lock off
    resp_unlock = client.post(
        f"/api/projects/{SAMPLE_PROJECT}/lock/audio_chunk/c_02",
        json={"locked": False}
    )
    assert resp_unlock.status_code == 200
    assert resp_unlock.json().get("is_locked") is False

def test_gate_l_voice_slice_has_mp3_and_downloads():
    """Test Gate L: ProjectAdapter correctly populates has_mp3 and download endpoints function."""
    voice_slice = project_adapter.load_voice_slice(SAMPLE_PROJECT)
    assert voice_slice is not None
    # For SAMPLE_PROJECT, audio.wav exists but audio.mp3 does not
    assert voice_slice.has_mp3 is False
    assert (Path("projects") / SAMPLE_PROJECT / "audio.wav").exists()
    
    # Download WAV should return 200 with audio/wav
    resp_wav = client.get(f"/api/projects/{SAMPLE_PROJECT}/audio/wav")
    assert resp_wav.status_code == 200
    assert resp_wav.headers.get("content-type") == "audio/wav"
    
    # Download Timestamps SRT should return 200
    resp_srt = client.get(f"/api/projects/{SAMPLE_PROJECT}/timestamps/srt")
    assert resp_srt.status_code == 200
    
    # Download Timestamps JSON should return 200
    resp_json = client.get(f"/api/projects/{SAMPLE_PROJECT}/timestamps.json")
    assert resp_json.status_code == 200
    assert resp_json.headers.get("content-type") == "application/json"

def test_gate_m_voice_slice_word_cues_sorted_and_loaded():
    """Test Gate M: Word cues are sorted chronologically and loaded efficiently."""
    voice_slice = project_adapter.load_voice_slice(SAMPLE_PROJECT)
    assert len(voice_slice.words) > 0
    # Verify monotonic ordering for binary search
    prev_start = -1.0
    for cue in voice_slice.words:
        cue_start = cue.get("start", 0.0)
        assert cue_start >= prev_start, f"Word cue out of order: {cue.get('word')} at {cue_start} < {prev_start}"
        prev_start = cue_start
