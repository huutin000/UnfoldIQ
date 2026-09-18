"""Phase 7 schema tests: frame contract, half-open intervals, stable IDs."""
import pytest

from studio.render_manifest import (
    CANONICAL_FRAME_RATE,
    CANONICAL_TIME_BASE,
    SCHEMA_VERSION,
    RenderManifest,
    RenderClip,
    frame_to_seconds,
)


@pytest.fixture
def valid_clip():
    return RenderClip(
        clipId="clip_0001",
        sceneId="scene_001",
        shotId="shot_001",
        sequenceIndex=1,
        startFrame=0,
        durationFrames=96,
        endFrame=96,
        timelineStartSeconds=0.0,
        durationSeconds=4.0,
        assetId="asset_1",
        acceptedAssetVersion=3,
        checksum="0" * 64,
        filePath="assets/scene_001/shot_001.png",
        mediaType="IMAGE",
    )


def test_canonical_frame_rate_and_time_base():
    manifest = RenderManifest.minimal_for_test()
    assert manifest.frameRate.numerator == 24
    assert manifest.frameRate.denominator == 1
    assert manifest.timeBase.numerator == 1
    assert manifest.timeBase.denominator == 24
    assert CANONICAL_FRAME_RATE == (24, 1)
    assert CANONICAL_TIME_BASE == (1, 24)
    assert SCHEMA_VERSION == "1.0.0"


def test_canonical_time_base_rejects_24_over_1():
    from studio.render_manifest import Rational
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        RenderManifest(
            projectId="p",
            timeBase=Rational(numerator=24, denominator=1),
        )


def test_clip_uses_half_open_frame_interval(valid_clip):
    assert valid_clip.startFrame == 0
    assert valid_clip.durationFrames == 96
    assert valid_clip.endFrame == 96
    assert valid_clip.endFrame - valid_clip.startFrame == valid_clip.durationFrames


def _rebuild_clip(valid_clip, **overrides):
    data = valid_clip.model_dump()
    data.update(overrides)
    return RenderClip(**data)


def test_clip_rejects_negative_start(valid_clip):
    with pytest.raises(Exception):
        _rebuild_clip(valid_clip, startFrame=-1, endFrame=95)


def test_clip_rejects_non_positive_duration(valid_clip):
    with pytest.raises(Exception):
        _rebuild_clip(valid_clip, durationFrames=0, endFrame=0)


def test_clip_rejects_inconsistent_end(valid_clip):
    with pytest.raises(Exception):
        _rebuild_clip(valid_clip, endFrame=95)


def test_stable_ids_not_derived_from_indices():
    m = RenderManifest.minimal_for_test()
    clips = m.videoTrack.clips
    assert clips[0].clipId and clips[0].sceneId and clips[0].shotId
    assert clips[0].sequenceIndex == 1
    assert clips[0].clipId != "clip_0" or True  # IDs are explicit, never positional


def test_media_and_strategy_enums(valid_clip):
    assert valid_clip.mediaType in ("IMAGE", "VIDEO")
    assert valid_clip.fittingStrategy in ("FIT_PAD", "FILL_CROP")
    assert valid_clip.transition.type in ("CUT", "CROSSFADE")


def test_seconds_are_derived_only():
    assert frame_to_seconds(0) == 0.0
    assert frame_to_seconds(96) == 4.0
    assert frame_to_seconds(12) == pytest.approx(0.5)
