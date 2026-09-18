"""Phase 8 Task 10: Final Render API cutover + export-explicit file route."""
import json
import wave
from pathlib import Path

import pytest
from starlette.testclient import TestClient

from studio.app import app

client = TestClient(app)


def _wav(p: Path, seconds=4.0):
    with wave.open(str(p), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(24000)
        w.writeframes(b"\x00" * int(24000 * seconds) * 2)


@pytest.fixture
def project_fixture(tmp_path, monkeypatch):
    import shutil
    import hashlib as _hl
    import studio.config as _cfg
    import studio.jobs_manager as _jm
    import studio.phase14_router as _r14
    root = tmp_path / "projects"
    root.mkdir()
    monkeypatch.setattr(_cfg, "PROJECTS_DIR", root)
    monkeypatch.setattr(_r14, "PROJECTS_DIR", root)
    _jm.jobs_manager.projects_dir = root

    from studio.manifest_render_service import ManifestRenderService
    async def _noop_run(self, job_id):
        pass
    monkeypatch.setattr(ManifestRenderService, "_run_job", _noop_run)
    d = root / "proj8"
    (d / "assets").mkdir(parents=True)
    media = b"\x89PNG" + b"\x00" * 200
    (d / "assets" / "s1.png").write_bytes(media)
    _wav(d / "audio.wav", 4.0)
    (d / "script.txt").write_text("hello narration world")
    (d / "timestamps.srt").write_text("1\n00:00:00,000 --> 00:00:04,000\nHi\n")
    (d / "timestamps.json").write_text(json.dumps({"audio_duration": 4.0}))
    scenes = [{"scene_id": "scene_001", "index": 1}]
    (d / "scene_plan.json").write_text(json.dumps({"scenes": scenes}))

    def _sha(p):
        return _hl.sha256((d / p).read_bytes()).hexdigest()

    (d / "voice_qa.json").write_text(json.dumps(
        {"status": "PASS", "audio_sha256": _sha("audio.wav"),
         "issues": [], "summary": {}}))
    sp = json.loads((d / "scene_plan.json").read_text())
    sp["timestamps_sha256"] = _sha("timestamps.json")
    (d / "scene_plan.json").write_text(json.dumps(sp))
    vb_hash = "vbhash001"
    (d / "visual_bible.json").write_text(json.dumps({
        "generatorVersion": "10.0.0", "visualBibleHash": vb_hash,
        "subjects": [{"subjectId": "sub1"}], "environments": [{"environmentId": "env1"}],
        "periods": [{"periodId": "p1"}],
        "sourceScenePlanHash": _sha("scene_plan.json")}))
    from studio.veo_prompt_generator import compute_scene_hashes
    (d / "veo_prompts.json").write_text(json.dumps({
        "shotGeneratorVersion": "7.0.0",
        "source_script_sha256": _sha("script.txt"),
        "audio_sha256": _sha("audio.wav"),
        "timestamps_sha256": _sha("timestamps.json"),
        "sourceVisualBibleHash": vb_hash,
        "sceneHashes": compute_scene_hashes(scenes),
        "shots": [{"shot_id": "shot_001", "scene_id": "scene_001",
                   "start": 0.0, "end": 4.0, "duration": 4.0, "index": 1,
                   "veo_prompt": "a calm cinematic establishing shot of mist"}]}))
    (d / "assets" / "intake_ledger.json").write_text(json.dumps({
        "assets": [{"id": "A1", "scene_id": "scene_001", "shot_id": "shot_001",
                    "lifecycle": "LOCKED",
                    "checksum": _hl.sha256(media).hexdigest(),
                    "version": 1, "filePath": "assets/s1.png"}]}))
    from studio.timeline_compiler import compile_render_manifest
    assert compile_render_manifest(d, "export_001").persisted is True
    yield {"id": "proj8", "dir": d, "root": root}
    shutil.rmtree(root, ignore_errors=True)


def test_final_render_requires_persisted_export_snapshot(project_fixture):
    response = client.post(
        f"/api/projects/{project_fixture['id']}/render/final",
        json={"exportId": "export_001", "encoderProfile": "FINAL_QUALITY"},
    )
    assert response.status_code in (200, 202), response.text[:400]
    body = response.json()
    assert body["exportId"] == "export_001"
    assert body["encoderProfile"] == "FINAL_QUALITY"
    assert body["jobId"]


def test_final_render_rejects_unknown_export(project_fixture):
    response = client.post(
        f"/api/projects/{project_fixture['id']}/render/final",
        json={"exportId": "export_009", "encoderProfile": "FINAL_QUALITY"},
    )
    assert response.status_code in (400, 404, 422)


def test_final_render_does_not_recompile_manifest(project_fixture):
    before = (project_fixture["dir"] / "exports" / "export_001" / "render-manifest.json").read_bytes()
    client.post(f"/api/projects/{project_fixture['id']}/render/final",
                json={"exportId": "export_001", "encoderProfile": "FINAL_QUALITY"})
    import time
    time.sleep(1.0)
    after = (project_fixture["dir"] / "exports" / "export_001" / "render-manifest.json").read_bytes()
    assert before == after


def test_final_file_route_is_export_explicit(project_fixture):
    export_dir = project_fixture["dir"] / "exports" / "export_001"
    (export_dir / "final.mp4").write_bytes(b"\x00" * 1024)
    response = client.get(
        f"/api/projects/{project_fixture['id']}/exports/export_001/final/file")
    assert response.status_code == 200
    assert response.content == b"\x00" * 1024


def test_final_file_route_404_when_absent(project_fixture):
    response = client.get(
        f"/api/projects/{project_fixture['id']}/exports/export_001/final/file")
    assert response.status_code == 404


def test_final_file_route_rejects_traversal(project_fixture):
    response = client.get(
        f"/api/projects/{project_fixture['id']}/exports/../app/final/file")
    assert response.status_code in (400, 404)
