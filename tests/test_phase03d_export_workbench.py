"""
Focused tests for Subphase 3D — Export Workbench UI (Preflight & Triggers).

Covers: readiness endpoint + schema, READY vs BLOCKED projects,
warnings vs blockers, optional vs required artifacts, render trigger guards,
job status vocabulary, artifact downloads, missing-preview behavior,
project isolation, file-route safety, legacy export compatibility.
"""
import json
import shutil
from pathlib import Path

import pytest
from starlette.testclient import TestClient

from studio.app import app

client = TestClient(app)

PROJ = "2026-09-12_210003_youtube-narration-01"
PROJ_DIR = Path("projects") / PROJ

KNOWN_STATES = {"READY", "MISSING", "OUTDATED", "EMPTY", "BLOCKED", "ERROR",
                "STALE", "NOT_READY", "NOT GENERATED", "NOT GENERATED".upper()}


def make_ready_copy(name: str) -> Path:
    """Isolated temp project healed to fully READY (hash chains re-synced)."""
    from studio.scene_planner import compute_file_sha256
    from studio.veo_prompt_generator import compute_scene_hashes
    dst = Path("projects") / name
    shutil.rmtree(dst, ignore_errors=True)
    shutil.copytree(PROJ_DIR, dst)
    vb_p = dst / "visual_bible.json"
    vb = json.loads(vb_p.read_text(encoding="utf-8"))
    vb["sourceScenePlanHash"] = compute_file_sha256(dst / "scene_plan.json")
    vb_p.write_text(json.dumps(vb, ensure_ascii=False, indent=2), encoding="utf-8")
    veo_p = dst / "veo_prompts.json"
    veo = json.loads(veo_p.read_text(encoding="utf-8"))
    sp = json.loads((dst / "scene_plan.json").read_text(encoding="utf-8"))
    veo["sceneHashes"] = compute_scene_hashes(sp.get("scenes", []))
    veo_p.write_text(json.dumps(veo, ensure_ascii=False, indent=2), encoding="utf-8")
    return dst


def test_readiness_endpoint_exists_with_schema():
    r = client.get(f"/api/projects/{PROJ}/export/readiness")
    assert r.status_code == 200
    d = r.json()
    for key in ("project", "status", "ready", "checks", "blockers",
                "warnings", "render", "artifacts"):
        assert key in d, f"schema key '{key}' missing"
    assert d["project"] == PROJ
    assert d["status"] in ("READY", "BLOCKED")
    assert d["ready"] == (d["status"] == "READY")
    assert isinstance(d["checks"], list) and len(d["checks"]) >= 7
    for c in d["checks"]:
        assert {"id", "label", "state", "ok", "action"} <= set(c.keys())
        assert c["state"] in KNOWN_STATES, f"unknown state {c['state']}"


def test_blocked_reference_project_reports_stale_checks():
    """Reference project is honestly BLOCKED (visualContinuity unfulfilled without fixtures)."""
    d = client.get(f"/api/projects/{PROJ}/export/readiness").json()
    assert d["status"] == "BLOCKED" and d["ready"] is False
    by_id = {c["id"]: c for c in d["checks"]}
    assert by_id["visualContinuity"]["ok"] is False
    assert "visualContinuity" in d["blockers"]
    assert len(d["rawBlockers"]) >= 1


def test_ready_project_reports_all_green():
    dst = make_ready_copy("test_3d_ready_tmp")
    try:
        d = client.get("/api/projects/test_3d_ready_tmp/export/readiness").json()
        assert d["status"] == "READY" and d["ready"] is True
        assert d["blockers"] == [] and d["rawBlockers"] == []
        assert all(c["ok"] for c in d["checks"])
    finally:
        shutil.rmtree(dst, ignore_errors=True)


def test_warnings_are_not_blockers():
    """Missing draft preview / mp3 are warnings, never blockers."""
    d = client.get(f"/api/projects/{PROJ}/export/readiness").json()
    warn_ids = [w["id"] for w in d["warnings"]]
    assert set(warn_ids) <= {"draft", "mp3"}
    assert not (set(warn_ids) & set(d["blockers"]))
    dst = make_ready_copy("test_3d_warn_tmp")
    try:
        (dst / "renders" / "draft" / "draft_preview.mp4").unlink()
        d2 = client.get("/api/projects/test_3d_warn_tmp/export/readiness").json()
        assert d2["status"] == "READY", "missing draft must not block"
        assert "draft" in [w["id"] for w in d2["warnings"]]
        assert d2["render"]["hasDraft"] is False
    finally:
        shutil.rmtree(dst, ignore_errors=True)


def test_missing_optional_mp3_is_not_blocker():
    d = client.get(f"/api/projects/{PROJ}/export/readiness").json()
    mp3 = [a for a in d["artifacts"] if a["id"] == "audio.mp3"]
    # mp3 absent from artifacts list or marked not-exists; either way no blocker mentions mp3
    assert not any("mp3" in b.lower() for b in d["rawBlockers"])


def test_missing_required_audio_blocks():
    dst = make_ready_copy("test_3d_noaudio_tmp")
    try:
        (dst / "audio.wav").unlink()
        d = client.get("/api/projects/test_3d_noaudio_tmp/export/readiness").json()
        assert d["status"] == "BLOCKED"
        assert "audio" in d["blockers"]
        by_id = {c["id"]: c for c in d["checks"]}
        assert by_id["audio"]["state"] == "MISSING"
        assert by_id["audio"]["ok"] is False
    finally:
        shutil.rmtree(dst, ignore_errors=True)


def test_render_trigger_guard_final_422_when_blocked():
    """Final render on the BLOCKED reference project must refuse with 422 + blockers."""
    r = client.post(f"/api/projects/{PROJ}/render/final")
    assert r.status_code == 422, f"expected 422, got {r.status_code}"
    body = r.json()
    detail = body.get("detail", body)
    assert "blockers" in detail and len(detail["blockers"]) > 0


def test_job_status_vocabulary_known():
    """Backend job statuses used by the UI mapping must stay within known vocabulary."""
    r = client.get(f"/api/activity/jobs?projectId={PROJ}")
    assert r.status_code in (200, 404)
    if r.status_code == 200:
        for j in r.json().get("jobs", []):
            assert j.get("status") in (
                "QUEUED", "RUNNING", "RENDERING", "SUCCESS", "COMPLETED",
                "FAILED", "CANCELLED"), f"unknown job status {j.get('status')}"


def test_existing_artifact_downloads_200():
    assert client.get(f"/api/projects/{PROJ}/audio/wav").status_code == 200
    assert client.get(f"/api/projects/{PROJ}/timestamps/srt").status_code == 200
    d = client.get(f"/api/projects/{PROJ}/export/readiness").json()
    assert any(a["id"] == "audio.wav" and a["exists"] for a in d["artifacts"])
    assert any(a["id"] == "timestamps.srt" and a["exists"] for a in d["artifacts"])


def test_missing_preview_returns_json_404_not_broken_bytes():
    dst = make_ready_copy("test_3d_noprev_tmp")
    try:
        (dst / "renders" / "draft" / "draft_preview.mp4").unlink()
        (dst / "renders" / "final" / "final.mp4").unlink()
        for kind in ("draft", "final"):
            r = client.get(f"/api/projects/test_3d_noprev_tmp/renders/{kind}/file")
            assert r.status_code == 404
            assert "Chưa có bản kết xuất" in r.json().get("detail", "")
    finally:
        shutil.rmtree(dst, ignore_errors=True)


def test_existing_preview_serves_mp4():
    r = client.get(f"/api/projects/{PROJ}/renders/draft/file")
    assert r.status_code == 200
    assert "video/mp4" in r.headers.get("content-type", "")
    assert len(r.content) > 1000
    rd = client.get(f"/api/projects/{PROJ}/renders/final/file?download=1")
    assert rd.status_code == 200
    assert "attachment" in rd.headers.get("content-disposition", "")


def test_project_isolation_between_copies():
    a = make_ready_copy("test_3d_iso_a")
    b = make_ready_copy("test_3d_iso_b")
    try:
        (b / "audio.wav").unlink()
        da = client.get("/api/projects/test_3d_iso_a/export/readiness").json()
        db = client.get("/api/projects/test_3d_iso_b/export/readiness").json()
        assert da["status"] == "READY" and db["status"] == "BLOCKED"
    finally:
        shutil.rmtree(a, ignore_errors=True)
        shutil.rmtree(b, ignore_errors=True)


def test_file_route_path_safety():
    assert client.get(f"/api/projects/{PROJ}/renders/../../secret/file").status_code in (400, 404)
    assert client.get(f"/api/projects/{PROJ}/renders/xYz/file").status_code == 404
    r = client.get("/api/projects/..%2Fsecret/export/readiness")
    assert r.status_code in (400, 404)


def test_legacy_export_compat_preserved():
    """Legacy render/status + export/package + production endpoints unchanged."""
    s = client.get(f"/api/projects/{PROJ}/render/status").json()
    assert {"hasDraft", "hasFinal"} <= set(s.keys())
    assert s["hasDraft"] is True and s["hasFinal"] is True
    st = client.get(f"/api/projects/{PROJ}/production/status")
    assert st.status_code == 200
    v = client.get(f"/api/projects/{PROJ}/validation/readiness")
    assert v.status_code == 200


def test_frontend_export_contract_in_source():
    """Export Workbench frontend must use canonical readiness + guarded preview (no blind 404 probe)."""
    js = Path("studio/static/phase14_ui.js").read_text(encoding="utf-8")
    assert "/export/readiness" in js
    assert "Kiểm tra trước khi xuất" in js
    assert "renders/draft/file" in js and "renders/final/file" in js
    assert "renders/draft/draft_preview.mp4" not in js
    assert "renders/final/final.mp4" not in js
    assert "exportActivePolls" in js  # single-loop guard
    assert "exportLoadToken" in js  # stale-response guard
    html = Path("studio/static/index.html").read_text(encoding="utf-8")
    assert 'id="ws-export"' in html and 'id="export-readiness-box"' in html
