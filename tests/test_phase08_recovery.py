"""Phase 8 Task 9/11: crash reconciliation table (real entrypoint)."""
import json
from pathlib import Path

import pytest

from studio.jobs_manager import JobStatus, JobsManager
from studio.manifest_render_service import reconcile_final_render_jobs


def _manager(tmp_path):
    return JobsManager(runtime_dir=tmp_path / "runtime", projects_dir=tmp_path)


def _seed_job(jobs, project_id, job_id, status, export_id="export_001",
              manifest_hash="ab" * 32, phase="ENCODING"):
    job = jobs.create_job("FINAL_RENDER", project_id=project_id, metadata={
        "exportId": export_id, "manifestHash": manifest_hash,
        "encoderProfileRequested": "FINAL_QUALITY",
        "executionPhase": phase, "attempts": []})
    # create_job generates its own id; rewrite to the fixed one for clarity
    old_id = job["jobId"]
    job["jobId"] = job_id
    job["id"] = job_id
    job["status"] = status
    from studio.jobs_manager import _atomic_write_json
    _atomic_write_json(jobs.runtime_dir / f"{old_id}.json", {"superseded": True})
    (jobs.runtime_dir / f"{old_id}.json").unlink(missing_ok=True)
    pdir = jobs.projects_dir / project_id / "jobs"
    pdir.mkdir(parents=True, exist_ok=True)
    _atomic_write_json(pdir / f"{job_id}.json", job)
    jobs._jobs.pop(old_id, None)
    jobs._jobs[job_id] = job
    return job


def _write_manifest(project_dir: Path, export_id: str, manifest_hash: str):
    d = project_dir / "exports" / export_id
    d.mkdir(parents=True, exist_ok=True)
    (d / "render-manifest.json").write_text(json.dumps(
        {"manifestHash": "x", "_stub": True}))


def test_running_encoding_no_final_becomes_interrupted(tmp_path):
    jobs = _manager(tmp_path)
    (tmp_path / "proj" / "exports" / "export_001").mkdir(parents=True)
    _seed_job(jobs, "proj", "job-enc", JobStatus.RUNNING, phase="ENCODING")
    out = reconcile_final_render_jobs(jobs, tmp_path)
    assert jobs.get_job("job-enc")["status"] == JobStatus.INTERRUPTED
    assert ("job-enc", "RUNNING->INTERRUPTED") in out["reconciled"]


def test_running_candidate_ready_no_final_not_promoted(tmp_path):
    jobs = _manager(tmp_path)
    (tmp_path / "proj" / "exports" / "export_001").mkdir(parents=True)
    _seed_job(jobs, "proj", "job-cand", JobStatus.RUNNING, phase="CANDIDATE_READY")
    (tmp_path / "proj" / "renders" / ".scratch_job-cand").mkdir(parents=True)
    out = reconcile_final_render_jobs(jobs, tmp_path)
    assert jobs.get_job("job-cand")["status"] == JobStatus.INTERRUPTED
    assert not (tmp_path / "proj" / "exports" / "export_001" / "final.mp4").exists()


def test_publishing_with_final_and_lineage_completes(tmp_path):
    from studio.render_manifest_hashing import compute_manifest_hash
    jobs = _manager(tmp_path)
    export_dir = tmp_path / "proj" / "exports" / "export_001"
    export_dir.mkdir(parents=True)
    (export_dir / "final.mp4").write_bytes(b"final-bytes")
    payload = {"manifestHash": "x", "_stub": True}
    (export_dir / "render-manifest.json").write_text(json.dumps(payload))
    lineage = compute_manifest_hash(payload)
    _seed_job(jobs, "proj", "job-pub", JobStatus.RUNNING, phase="PUBLISHING",
              manifest_hash=lineage)
    out = reconcile_final_render_jobs(jobs, tmp_path)
    job = jobs.get_job("job-pub")
    assert job["status"] == JobStatus.COMPLETED
    assert job["progress"] == 1.0
    assert (export_dir / "final.mp4").read_bytes() == b"final-bytes"
    assert (export_dir / "render-metadata.json").is_file()


def test_completed_without_final_is_flagged(tmp_path):
    jobs = _manager(tmp_path)
    (tmp_path / "proj" / "exports" / "export_001").mkdir(parents=True)
    _seed_job(jobs, "proj", "job-gone", JobStatus.COMPLETED, phase="PUBLISHED")
    out = reconcile_final_render_jobs(jobs, tmp_path)
    job = jobs.get_job("job-gone")
    assert job["status"] == JobStatus.FAILED
    assert job["metadata"]["errorCode"] == "OUTPUT_CANDIDATE_MISSING"
    assert ("job-gone", "COMPLETED->FAILED integrity") in out["reconciled"]


def test_queued_left_alone_and_no_resumable(tmp_path):
    jobs = _manager(tmp_path)
    (tmp_path / "proj" / "exports" / "export_001").mkdir(parents=True)
    _seed_job(jobs, "proj", "job-q", JobStatus.QUEUED, phase="PREPARING")
    reconcile_final_render_jobs(jobs, tmp_path)
    assert jobs.get_job("job-q")["status"] == JobStatus.QUEUED


# Explicit test cases A, B, C, D matching external review micro-closure V3
def test_case_a_running_pre_publish_no_final_interrupted(tmp_path):
    """Case A: RUNNING + pre-publish phase + no Final -> INTERRUPTED."""
    jobs = _manager(tmp_path)
    (tmp_path / "proj" / "exports" / "exp_a").mkdir(parents=True)
    _seed_job(jobs, "proj", "job-a", JobStatus.RUNNING, export_id="exp_a", phase="PREPARING")
    out = reconcile_final_render_jobs(jobs, tmp_path)
    assert jobs.get_job("job-a")["status"] == JobStatus.INTERRUPTED
    assert ("job-a", "RUNNING->INTERRUPTED") in out["reconciled"]


def test_case_b_running_candidate_ready_no_final_not_promoted(tmp_path):
    """Case B: RUNNING + CANDIDATE_READY + no Final -> INTERRUPTED, candidate NOT promoted."""
    jobs = _manager(tmp_path)
    export_dir = tmp_path / "proj" / "exports" / "exp_b"
    export_dir.mkdir(parents=True)
    scratch_dir = tmp_path / "proj" / "renders" / ".scratch_job-b"
    scratch_dir.mkdir(parents=True)
    (scratch_dir / "candidate.mp4").write_bytes(b"candidate-bytes")
    _seed_job(jobs, "proj", "job-b", JobStatus.RUNNING, export_id="exp_b", phase="CANDIDATE_READY")
    out = reconcile_final_render_jobs(jobs, tmp_path)
    assert jobs.get_job("job-b")["status"] == JobStatus.INTERRUPTED
    assert not (export_dir / "final.mp4").exists()
    assert ("job-b", "RUNNING->INTERRUPTED") in out["reconciled"]


def test_case_c_running_publishing_or_published_lineage_matches_reconciles_to_completed(tmp_path):
    """Case C: RUNNING + PUBLISHING/PUBLISHED + final.mp4 exists + lineage matches -> COMPLETED, progress=100, Final retained."""
    from studio.render_manifest_hashing import compute_manifest_hash
    jobs = _manager(tmp_path)
    export_dir = tmp_path / "proj" / "exports" / "exp_c"
    export_dir.mkdir(parents=True)
    final_bytes = b"real-final-immutable-bytes-12345"
    (export_dir / "final.mp4").write_bytes(final_bytes)
    payload = {"manifestHash": "manifest_payload_xyz", "version": 1}
    (export_dir / "render-manifest.json").write_text(json.dumps(payload), encoding="utf-8")
    lineage = compute_manifest_hash(payload)
    _seed_job(jobs, "proj", "job-c", JobStatus.RUNNING, export_id="exp_c", phase="PUBLISHING",
              manifest_hash=lineage)
    out = reconcile_final_render_jobs(jobs, tmp_path)
    job = jobs.get_job("job-c")
    assert job["status"] == JobStatus.COMPLETED
    assert job["progress"] == 1.0  # 100%
    assert (export_dir / "final.mp4").read_bytes() == final_bytes  # Immutable Final retained
    assert (export_dir / "render-metadata.json").is_file()
    assert ("job-c", "RUNNING->COMPLETED reconciled") in out["reconciled"]


def test_case_d_completed_without_final_flags_integrity_failure(tmp_path):
    """Case D: COMPLETED claims published Final but final.mp4 is missing -> FAILED, no fabricated success."""
    jobs = _manager(tmp_path)
    (tmp_path / "proj" / "exports" / "exp_d").mkdir(parents=True)
    _seed_job(jobs, "proj", "job-d", JobStatus.COMPLETED, export_id="exp_d", phase="PUBLISHED")
    out = reconcile_final_render_jobs(jobs, tmp_path)
    job = jobs.get_job("job-d")
    assert job["status"] == JobStatus.FAILED
    assert job["metadata"]["errorCode"] == "OUTPUT_CANDIDATE_MISSING"
    assert ("job-d", "COMPLETED->FAILED integrity") in out["reconciled"]


def test_metadata_repair_reconstructs_metadata_without_rerender_or_overwriting_final(tmp_path):
    """Metadata repair: Final committed + sidecar missing + lineage matches -> reconstruct metadata, no rerender, no overwrite."""
    from studio.final_artifact_publisher import repair_missing_metadata
    export_dir = tmp_path / "proj" / "exports" / "exp_repair"
    export_dir.mkdir(parents=True)
    final_file = export_dir / "final.mp4"
    final_content = b"original-final-media-content-abcde"
    final_file.write_bytes(final_content)
    mtime_before = final_file.stat().st_mtime_ns

    prov = {"exportId": "exp_repair", "manifestHash": "hash123", "renderJobId": "job-rep"}
    # 1. First call: sidecar missing -> reconstructed
    repaired = repair_missing_metadata(export_dir, prov)
    assert repaired is True
    meta_file = export_dir / "render-metadata.json"
    assert meta_file.is_file()
    data = json.loads(meta_file.read_text(encoding="utf-8"))
    assert data["exportId"] == "exp_repair"
    assert data["manifestHash"] == "hash123"
    # Final was NOT touched or overwritten
    assert final_file.read_bytes() == final_content
    assert final_file.stat().st_mtime_ns == mtime_before

    # 2. Second call: sidecar already exists -> does not overwrite or touch
    assert repair_missing_metadata(export_dir, prov) is False
    assert final_file.read_bytes() == final_content

