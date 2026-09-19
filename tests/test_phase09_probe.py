"""Phase 9 Task 2: lineage loader + ffprobe inspector (TDD RED first)."""
import json
from pathlib import Path

import pytest

from studio.render_qa_types import QaSeverity


def _write_export(project_dir: Path, export_id="export_001", n_frames=96,
                  subtitle_mode="none", manifest_hash_override=None,
                  metadata_overrides=None):
    from studio.render_manifest_hashing import compute_manifest_hash
    export_dir = project_dir / "exports" / export_id
    export_dir.mkdir(parents=True, exist_ok=True)
    manifest = {
        "schemaVersion": "1.0.0",
        "projectId": project_dir.name,
        "exportId": export_id,
        "frameRate": {"numerator": 24, "denominator": 1},
        "timeBase": {"numerator": 1, "denominator": 24},
        "output": {"width": 1920, "height": 1080},
        "videoTrack": {"clips": [
            {"clipId": "clip_0001", "sceneId": "scene_001", "shotId": "shot_001",
             "sequenceIndex": 1, "startFrame": 0, "durationFrames": n_frames,
             "endFrame": n_frames, "assetId": "a1", "acceptedAssetVersion": 1,
             "checksum": "0" * 64, "filePath": "assets/s1.png", "mediaType": "IMAGE",
             "transition": {"type": "CUT", "durationFrames": 0}},
        ]},
        "voiceTrack": {"filePath": None},
        "musicTrack": {"configured": False},
        "subtitlesTrack": {"configured": subtitle_mode != "none",
                           "burnIn": subtitle_mode == "hard",
                           "filePath": "subs.srt" if subtitle_mode == "soft" else None,
                           "format": "srt" if subtitle_mode == "soft" else None},
        "scenes": [],
    }
    manifest["manifestHash"] = manifest_hash_override or compute_manifest_hash(manifest)
    (export_dir / "render-manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    metadata = {"projectId": project_dir.name, "exportId": export_id,
                "manifestHash": manifest["manifestHash"],
                "expectedFinalFrames": n_frames}
    if metadata_overrides:
        metadata.update(metadata_overrides)
    (export_dir / "render-metadata.json").write_text(json.dumps(metadata), encoding="utf-8")
    (export_dir / "final.mp4").write_bytes(b"\x00" * 2048)
    return manifest, metadata


@pytest.fixture
def export_fixture(tmp_path):
    project_dir = tmp_path / "proj_qa"
    project_dir.mkdir()
    manifest, metadata = _write_export(project_dir)
    return {"project_dir": project_dir, "export_id": "export_001",
            "manifest": manifest, "render_metadata": metadata}


def test_lineage_mismatch_is_hard_failure(export_fixture):
    from studio.render_qa_probe import load_qa_input_snapshot
    (export_fixture["project_dir"] / "exports" / "export_001"
     / "render-metadata.json").write_text(json.dumps(
        {**export_fixture["render_metadata"], "manifestHash": "bad"}), encoding="utf-8")
    snapshot = load_qa_input_snapshot(export_fixture["project_dir"], "export_001")
    assert snapshot.preflight_findings[0].code == "QA_LINEAGE_MISMATCH"
    assert snapshot.preflight_findings[0].severity is QaSeverity.HARD_FAIL


def test_missing_inputs_are_hard_failures(tmp_path):
    from studio.render_qa_probe import load_qa_input_snapshot
    d = tmp_path / "empty_proj"
    (d / "exports" / "export_001").mkdir(parents=True)
    snapshot = load_qa_input_snapshot(d, "export_001")
    codes = {f.code for f in snapshot.preflight_findings}
    assert "QA_INPUT_MISSING" in codes


def test_traversal_rejected(tmp_path):
    from studio.render_qa_probe import load_qa_input_snapshot
    with pytest.raises(ValueError):
        load_qa_input_snapshot(tmp_path / "p", "../evil")
    with pytest.raises(ValueError):
        load_qa_input_snapshot(tmp_path / "p", "C:\\evil")


def test_ffprobe_parser_contract():
    from studio.render_qa_probe import parse_ffprobe_json
    payload = {
        "streams": [
            {"index": 0, "codec_type": "video", "codec_name": "h264",
             "width": 1920, "height": 1080, "pix_fmt": "yuv420p",
             "sample_aspect_ratio": "1:1",
             "avg_frame_rate": "24/1", "r_frame_rate": "24/1",
             "nb_read_frames": "96", "duration": "4.0"},
            {"index": 1, "codec_type": "audio", "codec_name": "aac",
             "sample_rate": "48000", "channels": 2,
             "channel_layout": "stereo", "duration": "4.0"},
        ],
        "format": {"format_name": "mov,mp4,m4a,3gp,3g2,mj2", "duration": "4.0"},
    }
    probe = parse_ffprobe_json(payload, expected_frames=96)
    assert probe.video.codec_name == "h264"
    assert probe.video.width == 1920
    assert probe.video.height == 1080
    assert probe.video.pix_fmt == "yuv420p"
    assert probe.video.sample_aspect_ratio == "1:1"
    assert probe.video.read_frames == 96
    assert probe.audio.codec_name == "aac"
    assert probe.audio.sample_rate == 48000
    assert probe.audio.channels == 2


def test_validate_probe_contract_clean(export_fixture):
    from studio.render_qa_probe import (
        load_qa_input_snapshot, parse_ffprobe_json, validate_probe_contract)
    snapshot = load_qa_input_snapshot(
        export_fixture["project_dir"], export_fixture["export_id"])
    assert not snapshot.preflight_findings
    payload = {
        "streams": [
            {"index": 0, "codec_type": "video", "codec_name": "h264",
             "width": 1920, "height": 1080, "pix_fmt": "yuv420p",
             "sample_aspect_ratio": "1:1", "avg_frame_rate": "24/1",
             "r_frame_rate": "24/1", "nb_read_frames": "96", "duration": "4.0"},
            {"index": 1, "codec_type": "audio", "codec_name": "aac",
             "sample_rate": "48000", "channels": 2,
             "channel_layout": "stereo", "duration": "4.0"},
        ],
        "format": {"format_name": "mov,mp4", "duration": "4.0"},
    }
    probe = parse_ffprobe_json(payload, expected_frames=96)
    findings = validate_probe_contract(snapshot, probe)
    assert findings == []


def test_validate_probe_contract_mismatches(export_fixture):
    from studio.render_qa_probe import (
        load_qa_input_snapshot, parse_ffprobe_json, validate_probe_contract)
    snapshot = load_qa_input_snapshot(
        export_fixture["project_dir"], export_fixture["export_id"])
    payload = {
        "streams": [
            {"index": 0, "codec_type": "video", "codec_name": "h264",
             "width": 1280, "height": 720, "pix_fmt": "yuv420p",
             "sample_aspect_ratio": "1:1", "avg_frame_rate": "30/1",
             "r_frame_rate": "30/1", "nb_read_frames": "90", "duration": "3.0"},
            {"index": 1, "codec_type": "audio", "codec_name": "aac",
             "sample_rate": "44100", "channels": 1,
             "channel_layout": "mono", "duration": "3.0"},
        ],
        "format": {"format_name": "mov,mp4", "duration": "3.0"},
    }
    probe = parse_ffprobe_json(payload, expected_frames=96)
    findings = validate_probe_contract(snapshot, probe)
    codes = {f.code for f in findings}
    assert "QA_VIDEO_RESOLUTION_MISMATCH" in codes
    assert "QA_VIDEO_FPS_MISMATCH" in codes
    assert "QA_FRAME_COUNT_MISMATCH" in codes
    assert "QA_AUDIO_RATE_MISMATCH" in codes
    assert "QA_AUDIO_CHANNELS_MISMATCH" in codes
    assert all(f.severity is QaSeverity.HARD_FAIL for f in findings)
