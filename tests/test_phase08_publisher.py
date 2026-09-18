"""Phase 8 Task 8: no-replace publish + provenance tests."""
import json

import pytest

from studio.final_artifact_publisher import (
    AlreadyRenderedError,
    publish_candidate,
    repair_missing_metadata,
)


def _prov(**over):
    base = {"exportId": "export_001", "manifestHash": "ab" * 32,
            "renderJobId": "job1", "renderEngine": "ffmpeg",
            "ffmpegVersion": "8.1.1", "encoderProfileRequested": "FINAL_QUALITY",
            "encoderActuallyUsed": "libx264", "encoderProfileVersion": "FINAL_QUALITY_V1",
            "fallbackAttempted": False, "attemptSummary": [],
            "expectedFinalFrames": 96, "subtitleMode": "none",
            "subtitleCodec": None, "duckingPreset": None}
    base.update(over)
    return base


def _export_dir(tmp_path):
    d = tmp_path / "exports" / "export_001"
    d.mkdir(parents=True)
    return d


def test_existing_final_is_never_overwritten(tmp_path):
    export_dir = _export_dir(tmp_path)
    final = export_dir / "final.mp4"
    final.write_bytes(b"old-final")
    candidate = tmp_path / "candidate.mp4"
    candidate.write_bytes(b"new-final")

    with pytest.raises(AlreadyRenderedError):
        publish_candidate(candidate, export_dir, _prov())

    assert final.read_bytes() == b"old-final"


def test_missing_candidate_fails(tmp_path):
    from studio.manifest_render_types import RenderFailureCode
    export_dir = _export_dir(tmp_path)
    with pytest.raises(Exception) as exc:
        publish_candidate(tmp_path / "nope.mp4", export_dir, _prov())
    assert "CANDIDATE" in str(exc.value.code if hasattr(exc.value, "code") else exc.value)


def test_empty_candidate_fails(tmp_path):
    export_dir = _export_dir(tmp_path)
    candidate = tmp_path / "candidate.mp4"
    candidate.write_bytes(b"")
    with pytest.raises(Exception):
        publish_candidate(candidate, export_dir, _prov())
    assert not (export_dir / "final.mp4").exists()


def test_cancel_requested_blocks_publish(tmp_path):
    export_dir = _export_dir(tmp_path)
    candidate = tmp_path / "candidate.mp4"
    candidate.write_bytes(b"bytes")
    with pytest.raises(Exception):
        publish_candidate(candidate, export_dir, _prov(), cancel_requested=True)
    assert not (export_dir / "final.mp4").exists()


def test_success_writes_final_and_metadata(tmp_path):
    export_dir = _export_dir(tmp_path)
    candidate = tmp_path / "candidate.mp4"
    candidate.write_bytes(b"final-bytes")
    result = publish_candidate(candidate, export_dir, _prov())
    assert (export_dir / "final.mp4").read_bytes() == b"final-bytes"
    assert not candidate.exists()
    meta = json.loads((export_dir / "render-metadata.json").read_text(encoding="utf-8"))
    assert meta["exportId"] == "export_001"
    assert meta["renderEngine"] == "ffmpeg"
    assert meta["fps"] == "24/1"
    assert result.final_path == export_dir / "final.mp4"


def test_competing_publish_exactly_one_wins(tmp_path):
    import threading
    export_dir = _export_dir(tmp_path)
    cands = []
    for i in (1, 2):
        c = tmp_path / f"cand{i}.mp4"
        c.write_bytes(f"candidate-{i}".encode() * 100)
        cands.append(c)
    outcomes = []

    def attempt(c):
        try:
            publish_candidate(c, export_dir, _prov())
            outcomes.append("published")
        except AlreadyRenderedError:
            outcomes.append("already")

    threads = [threading.Thread(target=attempt, args=(c,)) for c in cands]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert sorted(outcomes) == ["already", "published"]
    assert (export_dir / "final.mp4").read_bytes() in (
        b"candidate-1" * 100, b"candidate-2" * 100)


def test_repair_missing_metadata_only(tmp_path):
    export_dir = _export_dir(tmp_path)
    (export_dir / "final.mp4").write_bytes(b"final")
    assert repair_missing_metadata(export_dir, _prov()) is True
    assert json.loads((export_dir / "render-metadata.json").read_text())["exportId"] == "export_001"
    # never replaces existing sidecar
    (export_dir / "render-metadata.json").write_text('{"keep": true}')
    assert repair_missing_metadata(export_dir, _prov()) is False
    assert json.loads((export_dir / "render-metadata.json").read_text()) == {"keep": True}
    # never fabricates without a Final
    empty_dir = tmp_path / "exports" / "export_002"
    empty_dir.mkdir(parents=True)
    assert repair_missing_metadata(empty_dir, _prov()) is False


def test_metadata_atomic_write_protection_against_partial_json(tmp_path, monkeypatch):
    from studio.final_artifact_publisher import _write_sidecar
    export_dir = _export_dir(tmp_path)
    meta = export_dir / "render-metadata.json"

    # Simulate crash/interruption during write
    real_open = open
    class MockFile:
        def __init__(self, f):
            self._f = f
        def write(self, s):
            self._f.write('{"partial": ')
            self._f.flush()
            raise IOError("Simulated power loss/disk error during sidecar write")
        def flush(self): self._f.flush()
        def fileno(self): return self._f.fileno()
        def __enter__(self): return self
        def __exit__(self, *args): self._f.close()

    def mock_open(file, mode="r", *args, **kwargs):
        if "render-metadata.json.tmp." in str(file) and "w" in mode:
            return MockFile(real_open(file, mode, *args, **kwargs))
        return real_open(file, mode, *args, **kwargs)

    monkeypatch.setattr("builtins.open", mock_open)
    with pytest.raises(IOError):
        _write_sidecar(export_dir, _prov())

    # Verify no partial metadata file exists
    assert not meta.exists()
    # Verify temp file was cleaned up
    assert not any(p.name.startswith("render-metadata.json.tmp") for p in export_dir.iterdir())


def test_existing_valid_metadata_never_overwritten_with_conflicting_provenance(tmp_path):
    from studio.final_artifact_publisher import _write_sidecar
    export_dir = _export_dir(tmp_path)
    meta = export_dir / "render-metadata.json"
    meta.write_text('{"jobId": "original_job", "exportId": "export_001"}', encoding="utf-8")

    # Attempt to write with conflicting provenance
    conflicting = _prov(jobId="conflicting_attacker_job", exportId="export_001")
    res = _write_sidecar(export_dir, conflicting)
    assert res == meta
    assert json.loads(meta.read_text(encoding="utf-8"))["jobId"] == "original_job"

