"""Phase 7 preview API tests: read-only, idempotent, structured blockers."""
import hashlib
import json
import shutil
import wave
from pathlib import Path

import pytest
from starlette.testclient import TestClient

from studio.app import app

client = TestClient(app)
PROJECTS = Path("projects")


def _wav(p: Path, seconds=4.0):
    with wave.open(str(p), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(48000)
        w.writeframes(b"\x00" * int(48000 * seconds) * 2 * 2)


@pytest.fixture
def proj(tmp_path):
    name = "_p7api_case"
    dest = PROJECTS / name
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)
    (dest / "assets").mkdir()
    (dest / "assets" / "s1.png").write_bytes(b"\x89PNG" + b"\x00" * 100)
    _wav(dest / "audio.wav", 4.0)
    (dest / "scene_plan.json").write_text(json.dumps({
        "scenes": [{"scene_id": "scene_001", "index": 1}]}, ensure_ascii=False))
    (dest / "veo_prompts.json").write_text(json.dumps({
        "shots": [{"shot_id": "shot_001", "scene_id": "scene_001",
                   "start": 0.0, "end": 4.0, "duration": 4.0, "index": 1}],
        "shot_count": 1, "scene_count": 1}, ensure_ascii=False))
    (dest / "timestamps.json").write_text(json.dumps(
        {"audio_duration": 4.0}, ensure_ascii=False))
    (dest / "assets" / "intake_ledger.json").write_text(json.dumps({
        "assets": [{"id": "ASSET-shot_001", "scene_id": "scene_001",
                    "shot_id": "shot_001", "lifecycle": "LOCKED",
                    "checksum": hashlib.sha256(b"x").hexdigest(),
                    "filePath": "assets/s1.png"}]}, ensure_ascii=False))
    yield dest
    shutil.rmtree(dest, ignore_errors=True)


def _snap(p: Path):
    out = {}
    for f in ("scene_plan.json", "timestamps.json", "audio.wav",
              "assets/intake_ledger.json"):
        fp = p / f
        out[f] = (hashlib.sha256(fp.read_bytes()).hexdigest(), fp.stat().st_mtime_ns)
    out["exports"] = sorted(x.name for x in (p / "exports").iterdir()) if (p / "exports").exists() else []
    return out


def test_preview_valid_no_side_effects(proj):
    before = _snap(proj)
    r = client.get(f"/api/projects/{proj.name}/render-manifest")
    assert r.status_code == 200, r.text[:300]
    body = r.json()
    assert body["persisted"] is False
    assert body["validation"]["valid"] is True
    assert body["manifest"]["videoTrack"]["clips"][0]["shotId"] == "shot_001"
    assert _snap(proj) == before


def test_preview_repeated_idempotent(proj):
    h1 = client.get(f"/api/projects/{proj.name}/render-manifest").json()["manifest"]["manifestHash"]
    h2 = client.get(f"/api/projects/{proj.name}/render-manifest").json()["manifest"]["manifestHash"]
    assert h1 == h2 and len(h1) == 64


def test_preview_invalid_state_returns_blockers(proj):
    (proj / "assets" / "s1.png").unlink()
    r = client.get(f"/api/projects/{proj.name}/render-manifest")
    assert r.status_code == 200
    body = r.json()
    assert body["validation"]["valid"] is False
    assert body["validation"]["blockers"]
    assert body["persisted"] is False


def test_preview_unknown_project_404():
    r = client.get("/api/projects/_p7api_missing/render-manifest")
    assert r.status_code == 404


def test_preview_rejects_traversal():
    r = client.get("/api/projects/../app/render-manifest")
    assert r.status_code in (400, 404)
