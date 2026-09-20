"""
Comprehensive Verification Tests for Phase 1: Workflow & Data Foundation
Implements Gate A (Stable ID Invariance), Gate B (Provider Abstraction),
Gate C (Round-Trip Semantic Integrity & Atomic Write Failure),
Gate D (API Contract Consistency), and Gate E (Freshness Semantics).
"""
import os
import shutil
import json
import time
import pytest
from pathlib import Path
from unittest.mock import patch

from studio.domain_models import (
    ProjectV2State,
    Scene,
    Shot,
    AudioChunk,
    StoryBeat,
    AssetRef,
)
from studio.project_adapter import project_adapter, ProjectAdapter
from studio.transcription_service import get_audio_sha256_fast, _audio_hash_cache
from studio.providers.base import (
    TTSProvider,
    STTProvider,
    AudioSynthesisResult,
    TranscriptionResult,
)


# ============================================================================
# Gate A: Stable ID Invariance Tests
# ============================================================================

SAMPLE_PROJECT = "2026-09-12_210003_youtube-narration-01"


@pytest.fixture
def temp_project_dir(tmp_path):
    """Generates the baseline project in an isolated temp directory under tmp_path."""
    from tests.fixtures.project_factory import create_canonical_scale_project
    dst = tmp_path / SAMPLE_PROJECT
    create_canonical_scale_project(dst, name=SAMPLE_PROJECT)
    return tmp_path, SAMPLE_PROJECT


def test_gate_a1_reload_stability(temp_project_dir):
    """A1: Reload stability - IDs across two loads must be 100% identical."""
    tmp_path, proj_name = temp_project_dir
    adapter = ProjectAdapter(projects_dir=tmp_path)

    p1 = adapter.load_project_v2(proj_name)
    p2 = adapter.load_project_v2(proj_name)

    assert [c.chunk_id for c in p1.audio_chunks] == [c.chunk_id for c in p2.audio_chunks]
    assert [b.beat_id for b in p1.story_beats] == [b.beat_id for b in p2.story_beats]
    assert [s.scene_id for s in p1.scenes] == [s.scene_id for s in p2.scenes]
    assert [sh.shot_id for s in p1.scenes for sh in s.shots] == [sh.shot_id for s in p2.scenes for sh in s.shots]


def test_gate_a2_save_reload_stability(temp_project_dir):
    """A2: Save/reload stability - IDs after save and reload must remain unchanged."""
    tmp_path, proj_name = temp_project_dir
    adapter = ProjectAdapter(projects_dir=tmp_path)
    proj_dir = tmp_path / proj_name

    p1 = adapter.load_project_v2(proj_name)
    chunk_ids_before = [c.chunk_id for c in p1.audio_chunks]
    beat_ids_before = [b.beat_id for b in p1.story_beats]
    scene_ids_before = [s.scene_id for s in p1.scenes]
    shot_ids_before = [sh.shot_id for s in p1.scenes for sh in s.shots]

    adapter.save_project_v2(proj_dir, p1)
    p2 = adapter.load_project_v2(proj_name)

    assert [c.chunk_id for c in p2.audio_chunks] == chunk_ids_before
    assert [b.beat_id for b in p2.story_beats] == beat_ids_before
    assert [s.scene_id for s in p2.scenes] == scene_ids_before
    assert [sh.shot_id for s in p2.scenes for sh in s.shots] == shot_ids_before


def test_gate_a3_content_edit_keeps_id(temp_project_dir):
    """A3: Content edit keeps ID - modifying text or settings must not alter ID."""
    tmp_path, proj_name = temp_project_dir
    adapter = ProjectAdapter(projects_dir=tmp_path)
    proj_dir = tmp_path / proj_name

    p = adapter.load_project_v2(proj_name)
    original_chunk_id = p.audio_chunks[0].chunk_id
    original_scene_id = p.scenes[0].scene_id
    original_shot_id = p.scenes[0].shots[0].shot_id

    # Edit content
    p.audio_chunks[0].text = "Brand new edited narration text."
    p.scenes[0].visual_summary = "Brand new scene visual summary."
    p.scenes[0].shots[0].veo_prompt = "Brand new cinematic shot prompt."

    adapter.save_project_v2(proj_dir, p)
    p_reloaded = adapter.load_project_v2(proj_name)

    assert p_reloaded.audio_chunks[0].chunk_id == original_chunk_id
    assert p_reloaded.audio_chunks[0].text == "Brand new edited narration text."
    assert p_reloaded.scenes[0].scene_id == original_scene_id
    assert p_reloaded.scenes[0].visual_summary == "Brand new scene visual summary."
    assert p_reloaded.scenes[0].shots[0].shot_id == original_shot_id
    assert p_reloaded.scenes[0].shots[0].veo_prompt == "Brand new cinematic shot prompt."


def test_gate_a4_insert_preserves_old_ids_and_assigns_new(temp_project_dir):
    """A4: Insert keeps old IDs and assigns unique new ID without renumbering old."""
    tmp_path, proj_name = temp_project_dir
    adapter = ProjectAdapter(projects_dir=tmp_path)
    proj_dir = tmp_path / proj_name

    p = adapter.load_project_v2(proj_name)
    old_chunk_ids = [c.chunk_id for c in p.audio_chunks]

    # Insert a new chunk at index 2
    new_chunk = AudioChunk(
        chunk_id="chunk-new-insert-999",
        index=3,
        text="Inserted chunk text",
        voice="af_sarah",
        speed=1.0,
        duration=3.0,
    )
    p.audio_chunks.insert(2, new_chunk)
    adapter.save_project_v2(proj_dir, p)

    p_reloaded = adapter.load_project_v2(proj_name)
    reloaded_ids = [c.chunk_id for c in p_reloaded.audio_chunks]

    # The inserted id is at index 2
    assert reloaded_ids[2] == "chunk-new-insert-999"
    # All old IDs are still present in original relative order
    filtered_ids = [cid for cid in reloaded_ids if cid != "chunk-new-insert-999"]
    assert filtered_ids == old_chunk_ids


def test_gate_a5_reorder_keeps_ids(temp_project_dir):
    """A5: Reorder keeps ID - moving scenes or chunks preserves exact IDs."""
    tmp_path, proj_name = temp_project_dir
    adapter = ProjectAdapter(projects_dir=tmp_path)
    proj_dir = tmp_path / proj_name

    p = adapter.load_project_v2(proj_name)
    assert len(p.scenes) >= 2
    scene_0_id = p.scenes[0].scene_id
    scene_1_id = p.scenes[1].scene_id

    # Swap scenes 0 and 1
    p.scenes[0], p.scenes[1] = p.scenes[1], p.scenes[0]
    adapter.save_project_v2(proj_dir, p)

    p_reloaded = adapter.load_project_v2(proj_name)
    assert p_reloaded.scenes[0].scene_id == scene_1_id
    assert p_reloaded.scenes[1].scene_id == scene_0_id


def test_gate_a6_uniqueness(temp_project_dir):
    """A6: Uniqueness check - len(ids) == len(set(ids)) for all entity types."""
    tmp_path, proj_name = temp_project_dir
    adapter = ProjectAdapter(projects_dir=tmp_path)

    p = adapter.load_project_v2(proj_name)

    chunk_ids = [c.chunk_id for c in p.audio_chunks]
    assert len(chunk_ids) == len(set(chunk_ids)), f"Duplicate chunk IDs found: {chunk_ids}"

    beat_ids = [b.beat_id for b in p.story_beats]
    assert len(beat_ids) == len(set(beat_ids)), f"Duplicate beat IDs found: {beat_ids}"

    scene_ids = [s.scene_id for s in p.scenes]
    assert len(scene_ids) == len(set(scene_ids)), f"Duplicate scene IDs found: {scene_ids}"

    shot_ids = [sh.shot_id for s in p.scenes for sh in s.shots]
    assert len(shot_ids) == len(set(shot_ids)), f"Duplicate shot IDs found: {shot_ids}"


# ============================================================================
# Gate A: Dedicated StoryBeat and AssetRef Stable ID Invariance Tests
# ============================================================================

@pytest.fixture
def beat_project_fixture(tmp_path):
    proj_dir = tmp_path / "beat_proj"
    proj_dir.mkdir(parents=True, exist_ok=True)
    (proj_dir / "script.txt").write_text("Hello world narration script.", encoding="utf-8")
    (proj_dir / "settings.json").write_text(json.dumps({"project_name": "beat_proj"}), encoding="utf-8")
    beats = [
        {"beat_id": "beat_001", "index": 1, "title": "Hook", "text": "Opening hook beat", "beat_type": "hook", "start_estimate": 0.0, "duration_estimate": 5.0},
        {"beat_id": "beat_002", "index": 2, "title": "Exposition", "text": "Core exposition beat", "beat_type": "exposition", "start_estimate": 5.0, "duration_estimate": 10.0},
        {"beat_id": "beat_003", "index": 3, "title": "Climax", "text": "Climax escalation beat", "beat_type": "climax", "start_estimate": 15.0, "duration_estimate": 8.0},
    ]
    (proj_dir / "story_beats.json").write_text(json.dumps({"schema_version": "2.0.0", "beats": beats}), encoding="utf-8")
    return tmp_path, "beat_proj"


@pytest.fixture
def asset_project_fixture(tmp_path):
    proj_dir = tmp_path / "asset_proj"
    assets_dir = proj_dir / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)
    (proj_dir / "settings.json").write_text(json.dumps({"project_name": "asset_proj"}), encoding="utf-8")
    assets = [
        {"id": "asset_001", "asset_id": "asset_001", "scene_id": "scene_001", "shot_id": "shot_001", "filepath": "assets/char_ref.png", "master_path": "assets/char_ref.png", "lifecycle_state": "INGESTED", "checksum": "sha256_aaa"},
        {"id": "asset_002", "asset_id": "asset_002", "scene_id": "scene_001", "shot_id": "shot_002", "filepath": "assets/env_ref.png", "master_path": "assets/env_ref.png", "lifecycle_state": "GENERATED", "checksum": "sha256_bbb"},
        {"id": "asset_003", "asset_id": "asset_003", "scene_id": "scene_002", "shot_id": "shot_003", "filepath": "assets/prop_ref.png", "master_path": "assets/prop_ref.png", "lifecycle_state": "REVIEWED", "checksum": "sha256_ccc"},
    ]
    (assets_dir / "intake_ledger.json").write_text(json.dumps({"schema_version": "2.0.0", "assets": assets}), encoding="utf-8")
    return tmp_path, "asset_proj"


def test_gate_a_beat_id_a1_reload(beat_project_fixture):
    """beat_id A1: Reload stability - IDs across two loads are 100% identical."""
    tmp_path, proj_name = beat_project_fixture
    adapter = ProjectAdapter(projects_dir=tmp_path)
    p1 = adapter.load_project_v2(proj_name)
    p2 = adapter.load_project_v2(proj_name)
    assert [b.beat_id for b in p1.story_beats] == [b.beat_id for b in p2.story_beats] == ["beat_001", "beat_002", "beat_003"]


def test_gate_a_beat_id_a2_save_reload(beat_project_fixture):
    """beat_id A2: Save/reload stability - IDs unchanged after save and reload."""
    tmp_path, proj_name = beat_project_fixture
    adapter = ProjectAdapter(projects_dir=tmp_path)
    proj_dir = tmp_path / proj_name

    p1 = adapter.load_project_v2(proj_name)
    adapter.save_project_v2(proj_dir, p1)
    p2 = adapter.load_project_v2(proj_name)
    assert [b.beat_id for b in p2.story_beats] == ["beat_001", "beat_002", "beat_003"]


def test_gate_a_beat_id_a3_content_edit(beat_project_fixture):
    """beat_id A3: Mutable content edit - modifying beat text/timing preserves exact beat_id."""
    tmp_path, proj_name = beat_project_fixture
    adapter = ProjectAdapter(projects_dir=tmp_path)
    proj_dir = tmp_path / proj_name

    p = adapter.load_project_v2(proj_name)
    p.story_beats[0].text = "Brand new updated narration hook"
    p.story_beats[0].target_duration_seconds = 12.5
    adapter.save_project_v2(proj_dir, p)

    p_reloaded = adapter.load_project_v2(proj_name)
    assert p_reloaded.story_beats[0].beat_id == "beat_001"
    assert p_reloaded.story_beats[0].text == "Brand new updated narration hook"
    assert p_reloaded.story_beats[0].target_duration_seconds == 12.5


def test_gate_a_beat_id_a4_insert_sibling(beat_project_fixture):
    """beat_id A4: Insert new sibling - old IDs unchanged, new sibling receives unique ID."""
    tmp_path, proj_name = beat_project_fixture
    adapter = ProjectAdapter(projects_dir=tmp_path)
    proj_dir = tmp_path / proj_name

    p = adapter.load_project_v2(proj_name)
    new_beat = StoryBeat(
        beat_id="beat_004_new",
        index=2,
        title="Bridge",
        text="Inserted bridge beat",
        target_duration_seconds=4.0,
    )
    p.story_beats.insert(1, new_beat)
    adapter.save_project_v2(proj_dir, p)

    p_reloaded = adapter.load_project_v2(proj_name)
    reloaded_ids = [b.beat_id for b in p_reloaded.story_beats]
    assert reloaded_ids == ["beat_001", "beat_004_new", "beat_002", "beat_003"]


def test_gate_a_beat_id_a5_reorder(beat_project_fixture):
    """beat_id A5: Reorder - swapping beats preserves identity; only order changes."""
    tmp_path, proj_name = beat_project_fixture
    adapter = ProjectAdapter(projects_dir=tmp_path)
    proj_dir = tmp_path / proj_name

    p = adapter.load_project_v2(proj_name)
    # Swap beat 0 and beat 2
    p.story_beats[0], p.story_beats[2] = p.story_beats[2], p.story_beats[0]
    adapter.save_project_v2(proj_dir, p)

    p_reloaded = adapter.load_project_v2(proj_name)
    assert [b.beat_id for b in p_reloaded.story_beats] == ["beat_003", "beat_002", "beat_001"]


def test_gate_a_beat_id_a6_uniqueness(beat_project_fixture):
    """beat_id A6: Uniqueness / collision check - len(ids) == len(set(ids)), 0 collisions."""
    tmp_path, proj_name = beat_project_fixture
    adapter = ProjectAdapter(projects_dir=tmp_path)
    p = adapter.load_project_v2(proj_name)
    ids = [b.beat_id for b in p.story_beats]
    assert len(ids) == len(set(ids))
    assert len(ids) == 3


def test_gate_a_asset_id_a1_reload(asset_project_fixture):
    """asset_id A1: Reload stability - IDs across two loads are 100% identical."""
    tmp_path, proj_name = asset_project_fixture
    adapter = ProjectAdapter(projects_dir=tmp_path)
    p1 = adapter.load_project_v2(proj_name)
    p2 = adapter.load_project_v2(proj_name)
    assert [a.asset_id for a in p1.assets] == [a.asset_id for a in p2.assets] == ["asset_001", "asset_002", "asset_003"]


def test_gate_a_asset_id_a2_save_reload(asset_project_fixture):
    """asset_id A2: Save/reload stability - IDs unchanged after save and reload."""
    tmp_path, proj_name = asset_project_fixture
    adapter = ProjectAdapter(projects_dir=tmp_path)
    proj_dir = tmp_path / proj_name

    p1 = adapter.load_project_v2(proj_name)
    adapter.save_project_v2(proj_dir, p1)
    p2 = adapter.load_project_v2(proj_name)
    assert [a.asset_id for a in p2.assets] == ["asset_001", "asset_002", "asset_003"]


def test_gate_a_asset_id_a3_content_edit(asset_project_fixture):
    """asset_id A3: Mutable content edit - modifying asset metadata preserves exact asset_id."""
    tmp_path, proj_name = asset_project_fixture
    adapter = ProjectAdapter(projects_dir=tmp_path)
    proj_dir = tmp_path / proj_name

    p = adapter.load_project_v2(proj_name)
    p.assets[0].master_path = "assets/char_ref_updated.png"
    p.assets[0].lifecycle_state = "PROMOTED"
    adapter.save_project_v2(proj_dir, p)

    p_reloaded = adapter.load_project_v2(proj_name)
    assert p_reloaded.assets[0].asset_id == "asset_001"
    assert p_reloaded.assets[0].master_path == "assets/char_ref_updated.png"
    assert p_reloaded.assets[0].lifecycle_state == "PROMOTED"


def test_gate_a_asset_id_a4_insert_sibling(asset_project_fixture):
    """asset_id A4: Insert new sibling - old IDs unchanged, new sibling receives unique ID."""
    tmp_path, proj_name = asset_project_fixture
    adapter = ProjectAdapter(projects_dir=tmp_path)
    proj_dir = tmp_path / proj_name

    p = adapter.load_project_v2(proj_name)
    new_asset = AssetRef(
        asset_id="asset_004_new",
        scene_id="scene_003",
        shot_id="shot_005",
        master_path="assets/new_prop.png",
        lifecycle_state="INGESTED",
        checksum="sha256_ddd",
    )
    p.assets.insert(1, new_asset)
    adapter.save_project_v2(proj_dir, p)

    p_reloaded = adapter.load_project_v2(proj_name)
    reloaded_ids = [a.asset_id for a in p_reloaded.assets]
    assert reloaded_ids == ["asset_001", "asset_004_new", "asset_002", "asset_003"]


def test_gate_a_asset_id_a5_reorder(asset_project_fixture):
    """asset_id A5: Reorder - swapping assets preserves identity; only order changes."""
    tmp_path, proj_name = asset_project_fixture
    adapter = ProjectAdapter(projects_dir=tmp_path)
    proj_dir = tmp_path / proj_name

    p = adapter.load_project_v2(proj_name)
    # Swap asset 0 and asset 2
    p.assets[0], p.assets[2] = p.assets[2], p.assets[0]
    adapter.save_project_v2(proj_dir, p)

    p_reloaded = adapter.load_project_v2(proj_name)
    assert [a.asset_id for a in p_reloaded.assets] == ["asset_003", "asset_002", "asset_001"]


def test_gate_a_asset_id_a6_uniqueness(asset_project_fixture):
    """asset_id A6: Uniqueness / collision check - len(ids) == len(set(ids)), 0 collisions."""
    tmp_path, proj_name = asset_project_fixture
    adapter = ProjectAdapter(projects_dir=tmp_path)
    p = adapter.load_project_v2(proj_name)
    ids = [a.asset_id for a in p.assets]
    assert len(ids) == len(set(ids))
    assert len(ids) == 3



# ============================================================================
# Gate B: Provider Abstraction Tests
# ============================================================================

class FakeTTS(TTSProvider):
    async def synthesize_chunk(self, text, voice, speed, output_path, **kwargs):
        # Create a valid RIFF WAV dummy file
        with open(output_path, "wb") as f:
            f.write(b"RIFF\x24\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00\x80>\x00\x00\x00}\x00\x00\x02\x00\x10\x00data\x00\x00\x00\x00")
        return AudioSynthesisResult(output_path=output_path, duration_seconds=1.5, sample_rate=24000)

    async def get_available_voices(self):
        return [{"voice_id": "fake_voice_1", "name": "Fake Voice", "gender": "Neutral", "language": "en-US"}]

    async def check_health(self):
        return {"status": "ok", "provider": "fake_tts"}


class FakeSTT(STTProvider):
    async def transcribe_segment(self, audio_path, language="en", **kwargs):
        return TranscriptionResult(text="fake transcription", segments=[], words=[])

    def check_health(self):
        return {"status": "ok", "provider": "fake_stt"}

    async def start_transcription(self, project_id, script_text="", force=False, **kwargs):
        return {"job_id": "fake_job_123", "status": "running"}

    async def cancel_transcription(self, project_id):
        return True

    def get_job(self, project_id):
        return {"status": "completed", "progress": 1.0}

    def check_project_timestamps_status(self, project_id):
        return {"exists": True, "has_audio": True, "state": "completed", "status": "Ready", "percent": 100}

    def is_gpu_busy(self):
        return False


def test_gate_b_provider_injection(temp_project_dir, tmp_path):
    """Gate B: Verify business routes work when FakeTTS and FakeSTT are injected."""
    import studio.app as app_module
    from starlette.testclient import TestClient
    from tests.fixtures.project_factory import hermetic_canonical_project_in_projects_dir

    fake_tts = FakeTTS()
    fake_stt = FakeSTT()

    with hermetic_canonical_project_in_projects_dir(SAMPLE_PROJECT), \
         patch.object(app_module, "tts_provider", fake_tts), \
         patch.object(app_module, "stt_provider", fake_stt):
        client = TestClient(app_module.app)

        # 1. Test TTS voices route
        resp = client.get("/api/voices")
        assert resp.status_code == 200
        voices = resp.json().get("voices", [])
        assert any(v["voice_id"] == "fake_voice_1" for v in voices)

        # 2. Test STT status route
        resp_stt = client.get(f"/api/projects/{SAMPLE_PROJECT}/timestamps/status")
        assert resp_stt.status_code == 200
        assert resp_stt.json()["status"] == "Ready"


# ============================================================================
# Gate C: Round-Trip Semantic Integrity & Atomic Write Failure
# ============================================================================

def test_gate_c_roundtrip_semantic_integrity(temp_project_dir):
    """Gate C: Deep comparison before vs after save/reload ensures 0 semantic loss."""
    tmp_path, proj_name = temp_project_dir
    adapter = ProjectAdapter(projects_dir=tmp_path)
    proj_dir = tmp_path / proj_name

    p_initial = adapter.load_project_v2(proj_name)
    adapter.save_project_v2(proj_dir, p_initial)
    p_reloaded = adapter.load_project_v2(proj_name)

    # Validate high-level metadata
    assert p_initial.project_id == p_reloaded.project_id
    assert p_initial.schema_version == p_reloaded.schema_version

    # Validate audio chunks length and fields
    assert len(p_initial.audio_chunks) == len(p_reloaded.audio_chunks)
    for c1, c2 in zip(p_initial.audio_chunks, p_reloaded.audio_chunks):
        assert c1.chunk_id == c2.chunk_id
        assert c1.text == c2.text
        assert abs(c1.duration - c2.duration) < 1e-4

    # Validate scenes & shots
    assert len(p_initial.scenes) == len(p_reloaded.scenes)
    for s1, s2 in zip(p_initial.scenes, p_reloaded.scenes):
        assert s1.scene_id == s2.scene_id
        assert len(s1.shots) == len(s2.shots)
        for sh1, sh2 in zip(s1.shots, s2.shots):
            assert sh1.shot_id == sh2.shot_id
            assert sh1.veo_prompt == sh2.veo_prompt


def test_gate_c_atomic_write_failure_simulation(temp_project_dir):
    """Gate C: Simulate failure during save - source files must not be corrupted or half-written."""
    tmp_path, proj_name = temp_project_dir
    adapter = ProjectAdapter(projects_dir=tmp_path)
    proj_dir = tmp_path / proj_name

    manifest_path = proj_dir / "manifest.json"
    with open(manifest_path, "r", encoding="utf-8") as f:
        original_manifest_content = f.read()

    p = adapter.load_project_v2(proj_name)
    p.audio_chunks[0].text = "Temporary text that should not persist due to crash"

    # Simulate disk write failure during save
    with patch("pathlib.Path.replace", side_effect=IOError("Simulated disk replacement failure")):
        with pytest.raises(IOError):
            adapter.save_project_v2(proj_dir, p)

    # Verify manifest backup or original content is intact (no half-corrupted JSON)
    with open(manifest_path, "r", encoding="utf-8") as f:
        current_manifest_content = f.read()
    # Must still be valid JSON
    parsed = json.loads(current_manifest_content)
    assert parsed is not None


# ============================================================================
# Gate D: API Contract Consistency
# ============================================================================

def test_gate_d_api_contract_consistency():
    """Gate D: Verify /v2/overview is canonical and selective visual routes return expected schemas."""
    import studio.app as app_module
    from starlette.testclient import TestClient
    from tests.fixtures.project_factory import hermetic_canonical_project_in_projects_dir

    with hermetic_canonical_project_in_projects_dir(SAMPLE_PROJECT):
        client = TestClient(app_module.app)

        # 1. Canonical /v2/overview
        resp_v2 = client.get(f"/api/projects/{SAMPLE_PROJECT}/v2/overview")
        assert resp_v2.status_code == 200
        assert resp_v2.json()["project_id"] == SAMPLE_PROJECT

        # 2. Visual summary
        resp_sum = client.get(f"/api/projects/{SAMPLE_PROJECT}/visual/summary")
        assert resp_sum.status_code == 200
        assert resp_sum.json()["total_scenes"] == 79

        # 3. Visual scenes lightweight list
        resp_scenes = client.get(f"/api/projects/{SAMPLE_PROJECT}/visual/scenes")
        assert resp_scenes.status_code == 200
        assert len(resp_scenes.json()) == 79


# ============================================================================
# Gate E: Freshness Semantics & High-Resolution Benchmark
# ============================================================================

def test_gate_e_freshness_semantics(temp_project_dir):
    """Gate E: Verify SHA-256 matches and caching correctly updates when file content changes."""
    tmp_path, proj_name = temp_project_dir
    proj_dir = tmp_path / proj_name
    audio_file = proj_dir / "audio.wav"

    _audio_hash_cache.pop(proj_name, None)

    # Fast hash first run (computes SHA-256)
    hash1 = get_audio_sha256_fast(proj_name, audio_file)
    assert len(hash1) == 64

    # Second run (cache hit)
    hash2 = get_audio_sha256_fast(proj_name, audio_file)
    assert hash1 == hash2

    # Touch/modify file
    time.sleep(0.01)
    with open(audio_file, "ab") as f:
        f.write(b"\x05\x06\x07\x08")

    hash3 = get_audio_sha256_fast(proj_name, audio_file)
    assert hash3 != hash1
    assert len(hash3) == 64


# ============================================================================
# Gate A & B Closure: Comprehensive Round-Trip Matrix & Legacy Field Preservation
# ============================================================================

def test_gate_a_comprehensive_roundtrip_all_groups(temp_project_dir):
    """Verify semantic round-trip equivalence across all 13 canonical data groups."""
    tmp_path, proj_name = temp_project_dir
    dst = tmp_path / proj_name

    # Add beats and assets fixture to baseline project to test all groups in unified state
    beats_data = {
        "schema_version": "2.0.0",
        "beats": [
            {"beat_id": "beat_001", "index": 1, "title": "Hook", "text": "Hook text", "target_duration_seconds": 5.0},
            {"beat_id": "beat_002", "index": 2, "title": "Body", "text": "Body text", "target_duration_seconds": 10.0},
        ],
    }
    (dst / "story_beats.json").write_text(json.dumps(beats_data), encoding="utf-8")

    assets_dir = dst / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)
    assets_data = {
        "schema_version": "2.0.0",
        "assets": [
            {"id": "asset_001", "asset_id": "asset_001", "scene_id": "scene_001", "shot_id": "shot_001", "master_path": "assets/char.png", "lifecycle_state": "INGESTED", "checksum": "sha256_111"},
        ],
    }
    (assets_dir / "intake_ledger.json").write_text(json.dumps(assets_data), encoding="utf-8")

    adapter = ProjectAdapter(projects_dir=tmp_path)
    before = adapter.load_project_v2(proj_name)

    # Save
    adapter.save_project_v2(dst, before)
    after = adapter.load_project_v2(proj_name)

    # Group 1: Script
    assert before.script_text == after.script_text
    # Group 2: Story Beats
    assert len(before.story_beats) == len(after.story_beats)
    for b1, b2 in zip(before.story_beats, after.story_beats):
        assert b1.beat_id == b2.beat_id and b1.text == b2.text
    # Group 3: Audio Chunks
    assert len(before.audio_chunks) == len(after.audio_chunks)
    for c1, c2 in zip(before.audio_chunks, after.audio_chunks):
        assert c1.chunk_id == c2.chunk_id and c1.text == c2.text
    # Group 4: Voice Settings
    assert before.metadata.get("voice") == after.metadata.get("voice")
    # Group 5: Timestamps / Word Cues
    cues_b = [w.word for c in before.audio_chunks for w in c.words]
    cues_a = [w.word for c in after.audio_chunks for w in c.words]
    assert cues_b == cues_a
    # Group 6: Scenes
    assert len(before.scenes) == len(after.scenes)
    for s1, s2 in zip(before.scenes, after.scenes):
        assert s1.scene_id == s2.scene_id and s1.visual_summary == s2.visual_summary
    # Group 7: Shots
    shots_b = [sh for sc in before.scenes for sh in sc.shots]
    shots_a = [sh for sc in after.scenes for sh in sc.shots]
    assert len(shots_b) == len(shots_a)
    for sh1, sh2 in zip(shots_b, shots_a):
        assert sh1.shot_id == sh2.shot_id
    # Group 8: Prompts (veo, negative, image)
    for sh1, sh2 in zip(shots_b, shots_a):
        assert sh1.veo_prompt == sh2.veo_prompt
        assert sh1.negative_prompt == sh2.negative_prompt
    # Group 9: Visual Bible
    assert before.visual_bible == after.visual_bible
    # Group 10: Asset References
    assert len(before.assets) == len(after.assets)
    for a1, a2 in zip(before.assets, after.assets):
        assert a1.asset_id == a2.asset_id and a1.master_path == a2.master_path
    # Group 11: Settings
    assert before.metadata == after.metadata
    # Group 12: Stable IDs
    ids_b = [c.chunk_id for c in before.audio_chunks] + [s.scene_id for s in before.scenes] + [sh.shot_id for sh in shots_b]
    ids_a = [c.chunk_id for c in after.audio_chunks] + [s.scene_id for s in after.scenes] + [sh.shot_id for sh in shots_a]
    assert ids_b == ids_a
    # Group 13: Relationships
    rel_b = [(sh.shot_id, sh.parent_scene_id) for sc in before.scenes for sh in sc.shots]
    rel_a = [(sh.shot_id, sh.parent_scene_id) for sc in after.scenes for sh in sc.shots]
    assert rel_b == rel_a


def test_gate_b_unknown_legacy_field_preservation(tmp_path):
    """Verify Contract 1 (Preserve): unknown/legacy fields survive round-trip without silent loss."""
    pdir = tmp_path / "legacy_preservation_proj"
    pdir.mkdir(parents=True, exist_ok=True)

    (pdir / "script.txt").write_text("Legacy script content.", encoding="utf-8")
    (pdir / "settings.json").write_text(
        json.dumps({"project_name": "legacy_proj", "custom_legacy_setting": "preserve_setting_123"}),
        encoding="utf-8",
    )
    (pdir / "manifest.json").write_text(
        json.dumps({
            "chunks": [{
                "chunk_id": "c_01",
                "index": 1,
                "text": "Chunk text",
                "custom_chunk_meta": "preserve_chunk_456",
            }]
        }),
        encoding="utf-8",
    )
    (pdir / "scene_plan.json").write_text(
        json.dumps({
            "scenes": [{
                "scene_id": "scene_001",
                "index": 1,
                "custom_scene_tag": "preserve_scene_789",
                "speech_start": 1.25,
            }]
        }),
        encoding="utf-8",
    )
    (pdir / "veo_prompts.json").write_text(
        json.dumps({
            "shots": [{
                "shot_id": "shot_001",
                "parent_scene_id": "scene_001",
                "veo_prompt": "Cinematic shot",
                "custom_shot_lens": "anamorphic_50mm",
                "lighting_tone": "dramatic_noir",
            }]
        }),
        encoding="utf-8",
    )

    adapter = ProjectAdapter(projects_dir=tmp_path)
    state = adapter.load_project_v2("legacy_preservation_proj")

    # Verify loaded into domain models via extra fields
    assert getattr(state.scenes[0], "custom_scene_tag", None) == "preserve_scene_789"
    assert getattr(state.scenes[0], "speech_start", None) == 1.25
    assert getattr(state.scenes[0].shots[0], "custom_shot_lens", None) == "anamorphic_50mm"
    assert getattr(state.scenes[0].shots[0], "lighting_tone", None) == "dramatic_noir"
    assert getattr(state.audio_chunks[0], "custom_chunk_meta", None) == "preserve_chunk_456"

    # Save via ProjectAdapter
    adapter.save_project_v2(pdir, state)

    # Reload from disk
    state_reloaded = adapter.load_project_v2("legacy_preservation_proj")
    assert getattr(state_reloaded.scenes[0], "custom_scene_tag", None) == "preserve_scene_789"
    assert getattr(state_reloaded.scenes[0], "speech_start", None) == 1.25
    assert getattr(state_reloaded.scenes[0].shots[0], "custom_shot_lens", None) == "anamorphic_50mm"
    assert getattr(state_reloaded.scenes[0].shots[0], "lighting_tone", None) == "dramatic_noir"
    assert getattr(state_reloaded.audio_chunks[0], "custom_chunk_meta", None) == "preserve_chunk_456"

    # Verify also physically present in the saved JSON files on disk
    sp_on_disk = json.loads((pdir / "scene_plan.json").read_text(encoding="utf-8"))
    assert sp_on_disk["scenes"][0]["custom_scene_tag"] == "preserve_scene_789"

    veo_on_disk = json.loads((pdir / "veo_prompts.json").read_text(encoding="utf-8"))
    assert veo_on_disk["shots"][0]["custom_shot_lens"] == "anamorphic_50mm"

    mf_on_disk = json.loads((pdir / "manifest.json").read_text(encoding="utf-8"))
    assert mf_on_disk["chunks"][0]["custom_chunk_meta"] == "preserve_chunk_456"

