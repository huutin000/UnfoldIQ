"""Phase 8 Task 2: immutable-snapshot integrity verification."""
import hashlib
import json
import wave
from pathlib import Path

import pytest

from studio.manifest_integrity import ManifestIntegrityError, verify_render_snapshot
from studio.manifest_render_types import RenderFailureCode
from studio.timeline_compiler import compile_render_manifest


def _wav(p: Path, seconds=4.0):
    with wave.open(str(p), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(24000)
        w.writeframes(b"\x00" * int(24000 * seconds) * 2)


class Phase07ExportFixture:
    def __init__(self, project_dir: Path, export_id: str):
        self.project_dir = project_dir
        self.export_id = export_id
        self.export_dir = project_dir / "exports" / export_id

    def load_manifest_json(self):
        return json.loads((self.export_dir / "render-manifest.json").read_text(encoding="utf-8"))

    @staticmethod
    def dumps(data):
        return json.dumps(data, indent=2, ensure_ascii=False)

    def first_referenced_asset(self):
        data = self.load_manifest_json()
        rel = data["videoTrack"]["clips"][0]["filePath"]
        return self.project_dir / rel


@pytest.fixture
def phase07_export_fixture(tmp_path):
    d = tmp_path / "proj"
    (d / "assets").mkdir(parents=True)
    media = b"\x89PNG" + b"\x00" * 200
    (d / "assets" / "s1.png").write_bytes(media)
    _wav(d / "audio.wav", 4.0)
    (d / "scene_plan.json").write_text(json.dumps(
        {"scenes": [{"scene_id": "scene_001", "index": 1}]}))
    (d / "veo_prompts.json").write_text(json.dumps({
        "shots": [{"shot_id": "shot_001", "scene_id": "scene_001",
                   "start": 0.0, "end": 4.0, "duration": 4.0, "index": 1}]}))
    (d / "timestamps.json").write_text(json.dumps({"audio_duration": 4.0}))
    (d / "assets" / "intake_ledger.json").write_text(json.dumps({
        "assets": [{"id": "A1", "scene_id": "scene_001", "shot_id": "shot_001",
                    "lifecycle": "LOCKED",
                    "checksum": hashlib.sha256(media).hexdigest(),
                    "version": 1, "filePath": "assets/s1.png"}]}))
    result = compile_render_manifest(d, "export_001")
    assert result.persisted is True
    return Phase07ExportFixture(d, "export_001")


def test_verify_snapshot_accepts_valid_export(phase07_export_fixture):
    fixture = phase07_export_fixture
    verified = verify_render_snapshot(fixture.project_dir, fixture.export_id)
    assert verified.manifest.exportId == fixture.export_id
    assert len(verified.manifest.videoTrack.clips) == 1


def test_verify_snapshot_rejects_manifest_hash_mismatch(phase07_export_fixture):
    fixture = phase07_export_fixture
    manifest_path = fixture.export_dir / "render-manifest.json"
    data = fixture.load_manifest_json()
    data["videoTrack"]["clips"][0]["backgroundColor"] = "#ffffff"
    manifest_path.write_text(fixture.dumps(data), encoding="utf-8")

    with pytest.raises(ManifestIntegrityError) as exc:
        verify_render_snapshot(fixture.project_dir, fixture.export_id)
    assert exc.value.code is RenderFailureCode.MANIFEST_HASH_MISMATCH


def test_verify_snapshot_rejects_referenced_byte_mutation(phase07_export_fixture):
    fixture = phase07_export_fixture
    asset = fixture.first_referenced_asset()
    asset.write_bytes(asset.read_bytes() + b"tamper")

    with pytest.raises(ManifestIntegrityError) as exc:
        verify_render_snapshot(fixture.project_dir, fixture.export_id)
    assert exc.value.code is RenderFailureCode.INPUT_INTEGRITY_MISMATCH


def test_verifier_does_not_read_live_editorial_sources(phase07_export_fixture):
    fixture = phase07_export_fixture
    for name in ("scene_plan.json", "veo_prompts.json", "visual_bible.json"):
        p = fixture.project_dir / name
        if p.exists():
            p.rename(p.with_suffix(p.suffix + ".hidden"))
    verified = verify_render_snapshot(fixture.project_dir, fixture.export_id)
    assert verified.manifest.exportId == fixture.export_id


def test_verify_snapshot_rejects_traversal(phase07_export_fixture):
    import copy
    fixture = phase07_export_fixture
    data = fixture.load_manifest_json()
    evil = copy.deepcopy(data["videoTrack"]["clips"][0])
    evil["clipId"] = "clip_evil"
    evil["sequenceIndex"] = 99
    evil["filePath"] = "../secret.txt"
    data["videoTrack"]["clips"].append(evil)
    # re-hash so only the path gate fires, not the hash gate
    from studio.render_manifest_hashing import compute_manifest_hash
    data.pop("manifestHash", None)
    data["manifestHash"] = compute_manifest_hash(data)
    (fixture.export_dir / "render-manifest.json").write_text(
        fixture.dumps(data), encoding="utf-8")
    with pytest.raises(ManifestIntegrityError) as exc:
        verify_render_snapshot(fixture.project_dir, fixture.export_id)
    assert exc.value.code is RenderFailureCode.INVALID_MANIFEST


def test_verify_snapshot_rejects_missing_export():
    from pathlib import Path as _P
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        with pytest.raises(ManifestIntegrityError) as exc:
            verify_render_snapshot(_P(tmp), "export_001")
        assert exc.value.code is RenderFailureCode.INVALID_MANIFEST
