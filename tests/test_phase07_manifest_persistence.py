"""Phase 7 persistence tests: explicit exportId, blockers, idempotency, conflict."""
import json
import wave
from pathlib import Path

import pytest

from studio.timeline_compiler import (
    RenderManifestConflictError,
    compile_render_manifest,
)


def _wav(p: Path, seconds=4.0):
    with wave.open(str(p), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(48000)
        w.writeframes(b"\x00" * int(48000 * seconds) * 2 * 2)


@pytest.fixture
def proj(tmp_path):
    d = tmp_path / "proj"
    (d / "assets").mkdir(parents=True)
    (d / "assets" / "s1.png").write_bytes(b"\x89PNG" + b"\x00" * 100)
    _wav(d / "audio.wav", 4.0)
    (d / "scene_plan.json").write_text(json.dumps(
        {"scenes": [{"scene_id": "scene_001", "index": 1}]}))
    (d / "veo_prompts.json").write_text(json.dumps({
        "shots": [{"shot_id": "shot_001", "scene_id": "scene_001",
                   "start": 0.0, "end": 4.0, "duration": 4.0, "index": 1}]}))
    (d / "timestamps.json").write_text(json.dumps({"audio_duration": 4.0}))
    (d / "assets" / "intake_ledger.json").write_text(json.dumps({
        "assets": [{"id": "ASSET-1", "scene_id": "scene_001", "shot_id": "shot_001",
                    "lifecycle": "LOCKED",
                    "checksum": "ab" * 32, "version": 3,
                    "filePath": "assets/s1.png"}]}))
    return d


def test_compile_persists_under_existing_export_id(proj):
    result = compile_render_manifest(proj, "export_001")
    assert result.path == proj / "exports/export_001/render-manifest.json"
    assert result.path.exists()
    assert result.persisted is True
    body = json.loads(result.path.read_text(encoding="utf-8"))
    assert body["exportId"] == "export_001"
    assert len(body["manifestHash"]) == 64


def test_blockers_prevent_persistence(proj):
    (proj / "assets" / "s1.png").unlink()
    result = compile_render_manifest(proj, "export_001")
    assert result.validation.valid is False
    assert result.persisted is False
    assert not (proj / "exports/export_001/render-manifest.json").exists()


def test_same_hash_existing_snapshot_is_idempotent(proj):
    first = compile_render_manifest(proj, "export_001")
    second = compile_render_manifest(proj, "export_001")
    assert first.manifest_hash == second.manifest_hash
    assert first.path.read_bytes() == second.path.read_bytes()
    assert second.reused is True


def test_different_hash_same_export_id_conflicts(proj):
    compile_render_manifest(proj, "export_001")
    before = (proj / "exports/export_001/render-manifest.json").read_bytes()
    # Valid-but-different semantic change: extend shot AND master audio to 5s.
    data = json.loads((proj / "veo_prompts.json").read_text(encoding="utf-8"))
    data["shots"][0]["end"] = 5.0
    data["shots"][0]["duration"] = 5.0
    (proj / "veo_prompts.json").write_text(json.dumps(data))
    _wav(proj / "audio.wav", 5.0)
    with pytest.raises(RenderManifestConflictError):
        compile_render_manifest(proj, "export_001")
    assert (proj / "exports/export_001/render-manifest.json").read_bytes() == before


def test_blockers_take_precedence_over_conflict(proj):
    compile_render_manifest(proj, "export_001")
    before = (proj / "exports/export_001/render-manifest.json").read_bytes()
    (proj / "assets" / "s1.png").unlink()  # invalid new state: blocked, not conflicted
    result = compile_render_manifest(proj, "export_001")
    assert result.validation.valid is False and result.persisted is False
    assert (proj / "exports/export_001/render-manifest.json").read_bytes() == before


def test_rejects_export_id_traversal(proj):
    with pytest.raises(ValueError):
        compile_render_manifest(proj, "../evil")
    with pytest.raises(ValueError):
        compile_render_manifest(proj, "a/b")
