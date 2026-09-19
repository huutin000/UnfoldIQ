"""Phase 9 Task 9: export-scoped QA API contract + security (TDD RED first)."""
import json
import time
from pathlib import Path

import pytest
from starlette.testclient import TestClient

from studio.app import app

client = TestClient(app)


def _manifest_dict(project_name, export_id="export_001", n_frames=96):
    from studio.render_manifest_hashing import compute_manifest_hash
    manifest = {
        "schemaVersion": "1.0.0", "projectId": project_name, "exportId": export_id,
        "frameRate": {"numerator": 24, "denominator": 1},
        "timeBase": {"numerator": 1, "denominator": 24},
        "output": {"width": 1920, "height": 1080},
        "videoTrack": {"clips": [
            {"clipId": "c1", "sceneId": "s1", "shotId": "shot_001",
             "sequenceIndex": 1, "startFrame": 0, "durationFrames": n_frames,
             "endFrame": n_frames, "assetId": "a1", "acceptedAssetVersion": 1,
             "checksum": "0" * 64, "filePath": "assets/s1.png", "mediaType": "VIDEO",
             "transition": {"type": "CUT", "durationFrames": 0}}]},
        "voiceTrack": {}, "musicTrack": {"configured": False},
        "subtitlesTrack": {"configured": False}, "scenes": [],
    }
    manifest["manifestHash"] = compute_manifest_hash(manifest)
    return manifest


@pytest.fixture
def qa_api_fixture(tmp_path, monkeypatch):
    import shutil
    import studio.config as _cfg
    import studio.jobs_manager as _jm
    import studio.phase14_router as _r14
    root = tmp_path / "projects"
    root.mkdir()
    monkeypatch.setattr(_cfg, "PROJECTS_DIR", root)
    monkeypatch.setattr(_r14, "PROJECTS_DIR", root)
    _jm.jobs_manager.projects_dir = root
    if hasattr(_r14._render_service_singleton, "_instance"):
        delattr(_r14._render_service_singleton, "_instance")
    if hasattr(_r14, "_qa_service_singleton") and hasattr(
            _r14._qa_service_singleton, "_instance"):
        delattr(_r14._qa_service_singleton, "_instance")

    from studio.render_qa_probe import parse_ffprobe_json

    def _clean_probe(final_path, n_frames=96):
        payload = {
            "streams": [
                {"index": 0, "codec_type": "video", "codec_name": "h264",
                 "width": 1920, "height": 1080, "pix_fmt": "yuv420p",
                 "sample_aspect_ratio": "1:1", "avg_frame_rate": "24/1",
                 "r_frame_rate": "24/1", "nb_read_frames": str(n_frames),
                 "duration": str(n_frames / 24)},
                {"index": 1, "codec_type": "audio", "codec_name": "aac",
                 "sample_rate": "48000", "channels": 2,
                 "channel_layout": "stereo", "duration": str(n_frames / 24)},
            ],
            "format": {"format_name": "mov,mp4", "duration": str(n_frames / 24)},
        }
        return parse_ffprobe_json(payload, expected_frames=n_frames)

    async def _instant_pass(**kwargs):
        from studio.render_qa_detector import DetectorRunResult
        return DetectorRunResult(completed=True, cancelled=False,
                                 return_code=0, events=[],
                                 decode_error_count=0, stderr_tail="")

    from studio.render_qa_service import RenderQaService
    qa_service = RenderQaService(projects_dir=root, jobs=_jm.jobs_manager,
                                 scheduler=None,
                                 run_ffprobe_fn=_clean_probe,
                                 run_detector_fn=_instant_pass)
    monkeypatch.setattr(_r14._qa_service_singleton, "_instance", qa_service,
                        raising=False)

    d = root / "projqa"
    d.mkdir()
    manifest = _manifest_dict("projqa")
    export_dir = d / "exports" / "export_001"
    export_dir.mkdir(parents=True)
    (export_dir / "render-manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    (export_dir / "render-metadata.json").write_text(json.dumps(
        {"projectId": "projqa", "exportId": "export_001",
         "manifestHash": manifest["manifestHash"],
         "expectedFinalFrames": 96}), encoding="utf-8")
    (export_dir / "final.mp4").write_bytes(b"\x01" * 4096)
    yield {"id": "projqa", "dir": d, "root": root}
    shutil.rmtree(root, ignore_errors=True)


def _wait_latest(project_id, timeout=30.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        r = client.get(f"/api/projects/{project_id}/exports/export_001/qa/latest")
        if r.status_code == 200:
            return r.json()
        time.sleep(0.5)
    raise TimeoutError("qa latest never appeared")


def test_manual_rerun_returns_job_and_run_ids(qa_api_fixture):
    r = client.post("/api/projects/projqa/exports/export_001/qa",
                    json={"mode": "MANUAL_RERUN"})
    assert r.status_code == 200, r.text[:400]
    body = r.json()
    assert body["jobId"]
    assert body["qaRunId"]
    assert body["exportId"] == "export_001"


def test_latest_history_and_exact_run(qa_api_fixture):
    r = client.post("/api/projects/projqa/exports/export_001/qa",
                    json={"mode": "MANUAL_RERUN"})
    assert r.status_code == 200
    latest = _wait_latest("projqa")
    assert latest["verdict"] == "PASS"
    assert latest["qaRunId"] == r.json()["qaRunId"]
    runs = client.get("/api/projects/projqa/exports/export_001/qa/runs")
    assert runs.status_code == 200
    assert any(x["qaRunId"] == latest["qaRunId"] for x in runs.json()["runs"])
    exact = client.get(
        f"/api/projects/projqa/exports/export_001/qa/runs/{latest['qaRunId']}")
    assert exact.status_code == 200
    assert exact.json()["verdict"] == "PASS"
    assert exact.json()["qaRunId"] == latest["qaRunId"]


# ---------------------------------------------------------------------------
# Task 10: Export Workbench QA UI + accessibility static contract.
# ---------------------------------------------------------------------------

def _static(name):
    from pathlib import Path as _P
    return (_P(__file__).resolve().parents[1] / "studio" / "static" / name
            ).read_text(encoding="utf-8")


def test_qa_result_region_present():
    html = _static("index.html")
    assert 'id="render-qa-box"' in html
    assert 'id="render-qa-status"' in html
    assert 'aria-live="polite"' in html


def test_qa_rerun_history_cancel_controls_present():
    html = _static("index.html")
    assert 'id="btn-qa-rerun"' in html
    assert "Chạy kiểm định lại" in html
    assert 'id="btn-qa-history"' in html
    assert 'id="btn-qa-cancel"' in html
    assert 'id="render-qa-findings"' in html
    assert 'id="render-qa-tech"' in html
    assert 'id="render-qa-history"' in html


def test_qa_vietnamese_labels_present():
    blob = _static("index.html") + _static("phase14_ui.js")
    for label in ("Chờ kiểm định", "Đang chờ kiểm định",
                  "Đang chờ tài nguyên", "Đang xác minh tệp video",
                  "Đang kiểm tra thông số", "Đang kiểm tra toàn bộ video",
                  "Đang đánh giá kết quả", "Đang lưu báo cáo",
                  "Đạt, có cảnh báo", "Không đạt",
                  "Kiểm định chưa hoàn tất", "Đã hủy kiểm định"):
        assert label in blob, label


def test_qa_evidence_seek_and_polite_updates():
    js = _static("phase14_ui.js")
    assert "Xem tại" in js
    assert "final-video-player" in js
    assert 'role="alert"' in js or "role='alert'" in js
