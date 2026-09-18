"""Phase 7 validation tests: issue model + ten gates."""
import pytest

from studio.render_manifest import (
    ManifestValidationResult,
    RenderClip,
    RenderManifest,
    ValidationIssue,
    VideoTrack,
)
from studio.render_manifest_validation import validate_render_manifest


def _clip(**over):
    base = dict(clipId="clip_0001", sceneId="scene_001", shotId="shot_001",
                sequenceIndex=1, startFrame=0, durationFrames=96, endFrame=96,
                timelineStartSeconds=0.0, durationSeconds=4.0,
                assetId="a1", acceptedAssetVersion=1, checksum="ab" * 32,
                filePath="assets/shot_001.png", mediaType="IMAGE")
    base.update(over)
    return RenderClip(**base)


def _manifest(clips, tmp_path, audio=True):
    (tmp_path / "assets").mkdir(exist_ok=True)
    for c in clips:
        if c.filePath and not c.filePath.startswith(("..", "C:", "\\\\")):
            p = tmp_path / c.filePath
            p.parent.mkdir(parents=True, exist_ok=True)
            if not p.exists():
                p.write_bytes(b"fake-media")
    if audio:
        import wave
        with wave.open(str(tmp_path / "audio.wav"), "wb") as w:
            w.setnchannels(2)
            w.setsampwidth(2)
            w.setframerate(48000)
            w.writeframes(b"\x00" * 48000 * 2 * 2)
    m = RenderManifest(projectId="p1", videoTrack=VideoTrack(clips=clips))
    m.voiceTrack.filePath = "audio.wav" if audio else None
    m.voiceTrack.durationFrames = clips[-1].endFrame if clips else 0
    return m


def test_issue_model_fields():
    i = ValidationIssue(code="X", severity="BLOCKER", message="m",
                        sceneId="s", shotId="sh", assetId="a",
                        expected="e", actual="a", path="p")
    assert (i.code, i.severity, i.message) == ("X", "BLOCKER", "m")
    r = ManifestValidationResult.from_issues([i])
    assert r.valid is False and len(r.blockers) == 1 and not r.warnings


def test_gate1_valid_relative_path(tmp_path):
    m = _manifest([_clip()], tmp_path)
    r = validate_render_manifest(m, project_dir=tmp_path)
    assert not [i for i in r.blockers if i.code == "PATH_SANDBOX_AND_PRESENCE"]


def test_gate1_missing_file_blocker(tmp_path):
    m = _manifest([_clip(filePath="assets/nope.png")], tmp_path)
    (tmp_path / "assets" / "nope.png").unlink(missing_ok=True)
    r = validate_render_manifest(m, project_dir=tmp_path)
    assert any(i.code == "PATH_SANDBOX_AND_PRESENCE" for i in r.blockers)


def test_gate1_traversal_absolute_unc_blocked(tmp_path):
    for bad in ("../secret.txt", "C:\\evil.png", "\\\\server\\x.png"):
        m = _manifest([_clip(filePath=bad)], tmp_path)
        r = validate_render_manifest(m, project_dir=tmp_path)
        assert any(i.code == "PATH_SANDBOX_AND_PRESENCE" for i in r.blockers), bad


def test_gate2_accepted_pass_and_unapproved_blocked(tmp_path):
    good = _manifest([_clip(assetId="a", acceptedAssetVersion=1)], tmp_path)
    assert not [i for i in validate_render_manifest(good, project_dir=tmp_path).blockers
                if i.code == "ACCEPTED_ASSET_INTEGRITY"]
    for bad_version in ("", None):
        m = _manifest([_clip(assetId="", acceptedAssetVersion=bad_version or "")], tmp_path)
        r = validate_render_manifest(m, project_dir=tmp_path)
        assert any(i.code == "ACCEPTED_ASSET_INTEGRITY" for i in r.blockers)


def test_gate3_media_allowlist(tmp_path):
    for ext in ("png", "jpg", "jpeg", "webp", "mp4", "mov"):
        m = _manifest([_clip(filePath=f"assets/x.{ext}",
                             mediaType="VIDEO" if ext in ("mp4", "mov") else "IMAGE")], tmp_path)
        r = validate_render_manifest(m, project_dir=tmp_path)
        assert not [i for i in r.blockers if i.code == "UNSUPPORTED_MEDIA_TYPE"], ext
    m = _manifest([_clip(filePath="assets/x.bmp")], tmp_path)
    assert any(i.code == "UNSUPPORTED_MEDIA_TYPE"
               for i in validate_render_manifest(m, project_dir=tmp_path).blockers)


def _raw_clips_pair():
    # model_construct bypasses schema validation to test gate logic itself
    c1 = RenderClip.model_construct(clipId="c1", sceneId="s", shotId="s1",
                                    sequenceIndex=1, startFrame=0, durationFrames=0,
                                    endFrame=0, assetId="a", filePath="assets/x.png",
                                    mediaType="IMAGE")
    c2 = RenderClip.model_construct(clipId="c2", sceneId="s", shotId="s2",
                                    sequenceIndex=2, startFrame=-5, durationFrames=10,
                                    endFrame=5, assetId="a", filePath="assets/x.png",
                                    mediaType="IMAGE")
    return [c1, c2]


def test_gate4_non_positive_duration(tmp_path):
    m = _manifest([], tmp_path)
    m.videoTrack.clips = _raw_clips_pair()
    r = validate_render_manifest(m, project_dir=tmp_path)
    assert any(i.code == "NON_POSITIVE_DURATION" for i in r.blockers)


def test_gate5_invalid_timestamps(tmp_path):
    m = _manifest([], tmp_path)
    m.videoTrack.clips = _raw_clips_pair()
    r = validate_render_manifest(m, project_dir=tmp_path)
    assert any(i.code == "INVALID_TIMESTAMPS" for i in r.blockers)


def test_gates6_7_cut_ok_crossfade_ok_gap_fails(tmp_path):
    from studio.render_manifest import Transition
    ok = [_clip(clipId="c1", startFrame=0, durationFrames=48, endFrame=48),
          _clip(clipId="c2", sequenceIndex=2, shotId="s2", startFrame=48,
                durationFrames=48, endFrame=96)]
    r = validate_render_manifest(_manifest(ok, tmp_path), project_dir=tmp_path)
    assert not [i for i in r.blockers if i.code in ("TRANSITION_AWARE_OVERLAPS", "TIMELINE_GAPS")]
    x = [_clip(clipId="c1", startFrame=0, durationFrames=96, endFrame=96,
               transition=Transition(type="CROSSFADE", durationFrames=12)),
         _clip(clipId="c2", sequenceIndex=2, shotId="s2", startFrame=84,
               durationFrames=96, endFrame=180,
               transition=Transition(type="CROSSFADE", durationFrames=12))]
    r = validate_render_manifest(_manifest(x, tmp_path), project_dir=tmp_path)
    assert not [i for i in r.blockers if i.code in ("TRANSITION_AWARE_OVERLAPS", "TIMELINE_GAPS")]
    gap = [_clip(clipId="c1", startFrame=0, durationFrames=48, endFrame=48),
           _clip(clipId="c2", sequenceIndex=2, shotId="s2", startFrame=49,
                 durationFrames=48, endFrame=97)]
    r = validate_render_manifest(_manifest(gap, tmp_path), project_dir=tmp_path)
    assert any(i.code == "TIMELINE_GAPS" for i in r.blockers)


def test_gate8_master_audio(tmp_path):
    m = _manifest([_clip()], tmp_path, audio=True)
    assert not [i for i in validate_render_manifest(m, project_dir=tmp_path).blockers
                if i.code == "REQUIRED_MASTER_AUDIO"]
    m2 = _manifest([_clip()], tmp_path, audio=False)
    assert any(i.code == "REQUIRED_MASTER_AUDIO"
               for i in validate_render_manifest(m2, project_dir=tmp_path).blockers)


def test_gate9_audio_alignment(tmp_path):
    m = _manifest([_clip()], tmp_path)
    assert not [i for i in validate_render_manifest(m, project_dir=tmp_path).blockers
                if i.code == "AUDIO_DURATION_ALIGNMENT"]
    m.voiceTrack.durationFrames = 200
    assert any(i.code == "AUDIO_DURATION_ALIGNMENT"
               for i in validate_render_manifest(m, project_dir=tmp_path).blockers)


def test_gate10_optional_tracks(tmp_path):
    m = _manifest([_clip()], tmp_path)
    r = validate_render_manifest(m, project_dir=tmp_path)
    assert not [i for i in r.blockers if i.code == "OPTIONAL_TRACK_HANDLING"]
    m.musicTrack.configured = True
    m.musicTrack.filePath = "assets/missing_bgm.mp3"
    r = validate_render_manifest(m, project_dir=tmp_path)
    assert any(i.code == "OPTIONAL_TRACK_HANDLING" for i in r.blockers + r.warnings)
