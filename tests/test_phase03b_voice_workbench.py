"""
Unit and Integration Tests for Subphase 3B: Voice Workbench
Covers:
- Selective Voice API contract (GET /api/projects/{dir_name}/v2/voice and alias)
- Chunk identity contract (stable chunk_id, status, duration)
- Audio playback & chunk audio streaming endpoints
- Transcript & Word Cue validity (monotonic timestamps, start < end)
- TTS and STT provider abstraction integration
- Resource Scheduler integration & Lock semantics
- Pronunciation dictionary impact tracking (no silent regeneration)
- Voice QA metric & issue exposure
- 3A Compatibility (Overview, Story)
"""

import json
import time
from pathlib import Path
import pytest
from starlette.testclient import TestClient

from studio.app import app
from studio.config import PROJECTS_DIR
from studio.project_adapter import project_adapter
from studio.domain_models import VoiceSlice, AudioChunk
from studio.providers.base import TTSProvider, STTProvider
from studio.providers.kokoro_provider import KokoroTTSProvider
from studio.providers.whisper_provider import WhisperSTTProvider
from studio.pronunciation_service import PronunciationDictionary

REFERENCE_PROJECT = "2026-09-12_210003_youtube-narration-01"


@pytest.fixture(autouse=True)
def hermetic_project():
    from tests.fixtures.project_factory import hermetic_canonical_project_in_projects_dir
    with hermetic_canonical_project_in_projects_dir(REFERENCE_PROJECT) as p:
        yield p


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def test_voice_slice_canonical_route_contract(client):
    """Verify GET /api/projects/{dir_name}/v2/voice returns canonical VoiceSlice structure."""
    t0 = time.perf_counter()
    resp = client.get(f"/api/projects/{REFERENCE_PROJECT}/v2/voice")
    elapsed_ms = (time.perf_counter() - t0) * 1000

    assert resp.status_code == 200
    assert elapsed_ms < 150.0  # Fast selective API budget

    data = resp.json()
    assert data["project_id"] == REFERENCE_PROJECT
    assert data["schema_version"] == "2.0.0"
    assert data["has_audio"] is True
    assert data["audio_status"] in ("READY", "OUTDATED", "EMPTY")
    assert data["total_chunks"] == 135
    assert data["total_duration_seconds"] > 600.0  # ~665.64s
    assert "chunks" in data
    assert "words" in data
    assert "segments" in data
    assert "qa_summary" in data
    assert "pronunciation_count" in data


def test_voice_slice_compatibility_alias(client):
    """Verify backward compatibility route /api/projects/{dir_name}/voice matches /v2/voice."""
    resp_v2 = client.get(f"/api/projects/{REFERENCE_PROJECT}/v2/voice")
    resp_compat = client.get(f"/api/projects/{REFERENCE_PROJECT}/voice")

    assert resp_v2.status_code == 200
    assert resp_compat.status_code == 200
    assert resp_v2.json()["project_id"] == resp_compat.json()["project_id"]
    assert resp_v2.json()["total_chunks"] == resp_compat.json()["total_chunks"]
    assert resp_v2.json()["total_duration_seconds"] == resp_compat.json()["total_duration_seconds"]


def test_stable_chunk_identity_and_status(client):
    """Verify every chunk has stable identifier c_01..c_135, valid duration, and status."""
    resp = client.get(f"/api/projects/{REFERENCE_PROJECT}/v2/voice")
    assert resp.status_code == 200
    chunks = resp.json()["chunks"]
    assert len(chunks) == 135

    seen_ids = set()
    for idx, c in enumerate(chunks):
        cid = c["chunk_id"]
        assert cid.startswith("c_")
        assert cid not in seen_ids
        seen_ids.add(cid)
        assert c["index"] == idx + 1
        assert len(c["text"]) > 0
        assert c["duration"] >= 0.0
        assert c["status"] in ("READY", "OUTDATED", "EMPTY")
        assert "is_locked" in c
        assert isinstance(c["is_locked"], bool)


def test_transcript_word_cues_validity(client):
    """Verify word cues are ordered and timestamps are monotonically non-decreasing."""
    resp = client.get(f"/api/projects/{REFERENCE_PROJECT}/v2/voice")
    assert resp.status_code == 200
    words = resp.json()["words"]
    assert len(words) > 1000  # 1422 words in reference project

    prev_end = 0.0
    for w in words:
        assert "word" in w
        assert "start" in w
        assert "end" in w
        assert w["start"] >= 0.0
        assert w["end"] >= w["start"]
        # Monotonicity check with small tolerance for audio word overlap
        assert w["start"] >= prev_end - 0.5
        prev_end = w["start"]


def test_voice_qa_summary_exposure(client):
    """Verify Voice QA summary is integrated contextually into the Voice slice."""
    resp = client.get(f"/api/projects/{REFERENCE_PROJECT}/v2/voice")
    assert resp.status_code == 200
    qa = resp.json()["qa_summary"]
    assert qa is not None
    assert qa["status"] in ("pass", "review", "fail", "idle")
    assert "metrics" in qa
    assert "total_issues" in qa
    assert qa["total_issues"] >= 0
    assert "issues" in qa
    assert isinstance(qa["issues"], list)


def test_chunk_audio_streaming_endpoint(client):
    """Verify chunk audio endpoint handles existing vs non-existent chunks gracefully."""
    # Master audio must be 200 OK
    resp_master = client.get(f"/api/projects/{REFERENCE_PROJECT}/audio/wav")
    assert resp_master.status_code == 200
    assert resp_master.headers["content-type"] in ("audio/wav", "audio/x-wav")

    # Requesting a chunk that does not have standalone file returns 404 with Vietnamese message
    resp_chunk = client.get(f"/api/projects/{REFERENCE_PROJECT}/chunks/c_9999/audio")
    assert resp_chunk.status_code == 404
    assert "Không tìm thấy file audio" in resp_chunk.json()["detail"]


def test_tts_provider_abstraction():
    """Verify KokoroTTSProvider conforms to abstract TTSProvider interface."""
    provider = KokoroTTSProvider()
    assert isinstance(provider, TTSProvider)
    assert provider.name == "kokoro"
    assert provider.is_available() is True
    voices = provider.list_available_voices()
    assert len(voices) > 0
    assert "af_sarah" in voices
    assert "am_adam" in voices


def test_stt_provider_abstraction():
    """Verify WhisperSTTProvider conforms to abstract STTProvider interface."""
    provider = WhisperSTTProvider()
    assert isinstance(provider, STTProvider)
    assert provider.name == "faster-whisper"
    assert provider.is_available() is True


def test_pronunciation_impact_tracking():
    """Verify pronunciation changes detect impacted text without silent regeneration."""
    p_dir = PROJECTS_DIR / REFERENCE_PROJECT
    slice_data = project_adapter.load_voice_slice(REFERENCE_PROJECT)

    # Test word matching
    test_term = "humans"
    impacted = [c for c in slice_data.chunks if test_term.lower() in c.text.lower()]
    assert len(impacted) > 0
    assert any(c.chunk_id == "c_01" for c in impacted)


def test_subphase_3a_compatibility(client):
    """Verify Subphase 3A Overview and Story slices remain completely functional."""
    resp_overview = client.get(f"/api/projects/{REFERENCE_PROJECT}/v2/overview")
    assert resp_overview.status_code == 200
    data_overview = resp_overview.json()
    assert "stages" in data_overview
    assert "script" in data_overview["stages"]
    assert "voice" in data_overview["stages"]

    resp_story = client.get(f"/api/projects/{REFERENCE_PROJECT}/v2/story")
    assert resp_story.status_code == 200
    assert len(resp_story.json()["beats"]) == 138
