"""Phase 9 Task 5: immutable report store tests (TDD RED first)."""
import json


def _report(run_id="qa_001", verdict="PASS", completed="2026-09-18T00:00:00+00:00"):
    return {
        "schemaVersion": "1.0.0", "qaRunId": run_id, "qaJobId": "job_1",
        "projectId": "proj", "exportId": "export_001", "trigger": "AUTOMATIC",
        "manifestHash": "m" * 64,
        "final": {"relativePath": "final.mp4", "sha256Start": "a" * 64,
                  "sha256Commit": "a" * 64, "sizeBytes": 10},
        "qaPolicyVersion": "RENDER_QA_POLICY_V1",
        "tools": {"ffmpegVersion": "t", "ffprobeVersion": "t"},
        "startedAt": completed, "completedAt": completed,
        "probe": {}, "fullDecode": {"completed": True},
        "detectorSettings": {}, "rawEvents": [], "contextEvaluations": [],
        "warnings": [], "hardFailures": [], "verdict": verdict,
    }


def _diag():
    return {"ffprobe": {"streams": []}, "events": [],
            "stderr": "log"}


def test_create_only_report(tmp_path):
    from studio.render_qa_report_store import RenderQaReportStore
    store = RenderQaReportStore()
    export_dir = tmp_path / "export_001"
    export_dir.mkdir()
    p = store.commit_report(export_dir, _report("qa_001"), _diag())
    assert p.is_file()
    before = p.read_bytes()
    try:
        store.commit_report(export_dir, _report("qa_001"), _diag())
        raise AssertionError("expected conflict")
    except FileExistsError:
        pass
    assert p.read_bytes() == before


def test_latest_pointer_safe(tmp_path):
    from studio.render_qa_report_store import RenderQaReportStore
    store = RenderQaReportStore()
    export_dir = tmp_path / "export_001"
    export_dir.mkdir()
    store.commit_report(export_dir, _report("qa_001"), _diag())
    latest = store.read_latest(export_dir)
    assert latest["qaRunId"] == "qa_001"
    assert (export_dir / "qa" / "latest.json").is_file()


def test_latest_reconstructs(tmp_path):
    from studio.render_qa_report_store import RenderQaReportStore
    store = RenderQaReportStore()
    export_dir = tmp_path / "export_001"
    export_dir.mkdir()
    store.commit_report(export_dir, _report("qa_001", completed="2026-09-18T00:00:00+00:00"), _diag())
    store.commit_report(export_dir, _report("qa_002", completed="2026-09-18T01:00:00+00:00"), _diag())
    (export_dir / "qa" / "latest.json").unlink()
    latest = store.repair_latest(export_dir)
    assert latest["qaRunId"] == "qa_002"
    assert store.read_latest(export_dir)["qaRunId"] == "qa_002"


def test_diagnostics_persisted(tmp_path):
    from studio.render_qa_report_store import RenderQaReportStore
    store = RenderQaReportStore()
    export_dir = tmp_path / "export_001"
    export_dir.mkdir()
    store.commit_report(export_dir, _report("qa_001"), _diag())
    base = export_dir / "qa" / "qa_001" / "diagnostics"
    assert (base / "ffprobe.json").is_file()
    assert (base / "detector-events.json").is_file()
    assert (base / "ffmpeg-stderr.log").is_file()
