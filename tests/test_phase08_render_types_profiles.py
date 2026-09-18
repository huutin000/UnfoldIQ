"""Phase 8 Task 1: stable internal contracts + versioned profiles."""
from studio.manifest_render_types import (
    CompositionStrategy,
    EncoderProfileName,
    FinalRenderExecutionPhase,
    RenderFailureCode,
)
from studio.render_profiles import get_ducking_preset, get_encoder_profile


def test_phase08_internal_contracts_are_stable():
    assert EncoderProfileName.FINAL_QUALITY.value == "FINAL_QUALITY"
    assert EncoderProfileName.ACCELERATED.value == "ACCELERATED"
    assert CompositionStrategy.SIMPLE_CUT.value == "SIMPLE_CUT"
    assert CompositionStrategy.FILTER_COMPLEX.value == "FILTER_COMPLEX"
    assert FinalRenderExecutionPhase.PREPARING.value == "PREPARING"
    assert FinalRenderExecutionPhase.PUBLISHED.value == "PUBLISHED"
    assert RenderFailureCode.ALREADY_RENDERED.value == "ALREADY_RENDERED"


def test_profiles_keep_same_output_contract():
    quality = get_encoder_profile(EncoderProfileName.FINAL_QUALITY)
    fast = get_encoder_profile(EncoderProfileName.ACCELERATED)
    assert quality.video_encoder == "libx264"
    assert fast.video_encoder == "h264_nvenc"
    assert quality.width == fast.width == 1920
    assert quality.height == fast.height == 1080
    assert quality.fps == fast.fps == 24
    assert quality.pixel_format == fast.pixel_format == "yuv420p"
    assert quality.audio_codec == fast.audio_codec == "aac"
    assert quality.audio_bitrate == fast.audio_bitrate == "192k"
    assert quality.audio_sample_rate == fast.audio_sample_rate == 48000
    assert quality.audio_channels == fast.audio_channels == 2


def test_ducking_preset_is_versioned_and_deterministic():
    preset = get_ducking_preset("NARRATION_DUCK_V1")
    assert preset.name == "NARRATION_DUCK_V1"
    assert preset.detection == "rms"
    assert preset.mode == "downward"
    assert preset.attack_ms > 0
    assert preset.release_ms > 0
    assert preset.ratio > 1


def test_final_quality_preserves_production_baseline():
    quality = get_encoder_profile(EncoderProfileName.FINAL_QUALITY)
    assert quality.version == "FINAL_QUALITY_V1"
    # Exact current production Final args from renderer_adapter.render_final.
    assert quality.video_args == ("-c:v", "libx264", "-preset", "medium",
                                  "-crf", "18", "-pix_fmt", "yuv420p")


def test_accelerated_starts_from_proven_phase4_profile():
    fast = get_encoder_profile(EncoderProfileName.ACCELERATED)
    assert fast.version == "ACCELERATED_V1"
    assert fast.video_args == ("-c:v", "h264_nvenc", "-preset", "p4", "-cq", "28")
