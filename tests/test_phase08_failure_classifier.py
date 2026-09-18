"""Phase 8 Task 6: failure classification + fallback eligibility."""
import pytest

from studio.manifest_render_types import RenderFailureCode
from studio.render_failure_classifier import classify_render_failure


@pytest.mark.parametrize(
    "stderr, expected",
    [
        ("No capable devices found", RenderFailureCode.ENCODER_HARDWARE_UNAVAILABLE),
        ("Cannot load libcuda", RenderFailureCode.ENCODER_HARDWARE_UNAVAILABLE),
        ("OpenEncodeSessionEx failed: out of memory", RenderFailureCode.ENCODER_OUT_OF_MEMORY),
        ("InitializeEncoder failed", RenderFailureCode.ENCODER_INITIALIZATION_FAILED),
        ("encoder is busy", RenderFailureCode.ENCODER_BUSY),
    ],
)
def test_nvenc_hardware_failures_are_fallback_eligible(stderr, expected):
    result = classify_render_failure(stderr, "h264_nvenc", "ENCODING", 1, False)
    assert result.code is expected
    assert result.fallback_eligible is True


def test_filter_error_never_falls_back():
    result = classify_render_failure(
        "Error reinitializing filters", "h264_nvenc", "ENCODING", 1, False)
    assert result.code is RenderFailureCode.FILTERGRAPH_ERROR
    assert result.fallback_eligible is False


def test_unknown_error_never_falls_back():
    result = classify_render_failure(
        "unrecognized catastrophic thing", "h264_nvenc", "ENCODING", 1, False)
    assert result.code is RenderFailureCode.UNKNOWN_RENDER_ERROR
    assert result.fallback_eligible is False


def test_cancel_wins_over_any_signature():
    result = classify_render_failure(
        "No capable devices found", "h264_nvenc", "ENCODING", 1, True)
    assert result.code is RenderFailureCode.CANCELLED
    assert result.fallback_eligible is False


def test_libx264_failures_never_fall_back():
    result = classify_render_failure(
        "No capable devices found", "libx264", "ENCODING", 1, False)
    assert result.fallback_eligible is False


def test_misleading_cuda_text_keeps_root_cause():
    result = classify_render_failure(
        "Error reinitializing filters (CUDA-accelerated scale_cuda context lost)",
        "h264_nvenc", "ENCODING", 1, False)
    assert result.code is RenderFailureCode.FILTERGRAPH_ERROR
    assert result.fallback_eligible is False


def test_mux_and_subtitle_errors():
    mux = classify_render_failure(
        "Could not write header: mux failed", "libx264", "ENCODING", 1, False)
    assert mux.code is RenderFailureCode.MUX_ERROR
    sub = classify_render_failure(
        "Subtitle encoding failed", "libx264", "ENCODING", 1, False)
    assert sub.code is RenderFailureCode.SUBTITLE_ENCODING_ERROR


def test_missing_input_signatures():
    missing = classify_render_failure(
        "No such file or directory: assets/x.png", "libx264", "PREPARING", 1, False)
    assert missing.code is RenderFailureCode.INPUT_MISSING
    assert missing.fallback_eligible is False


def test_non_encoding_stage_never_falls_back():
    result = classify_render_failure(
        "No capable devices found", "h264_nvenc", "PREPARING", 1, False)
    assert result.code is RenderFailureCode.ENCODER_HARDWARE_UNAVAILABLE
    assert result.fallback_eligible is False, "Hardware failure during non-encoding stage must not fall back"


def test_subtitle_font_unavailable_never_falls_back():
    result = classify_render_failure(
        "Font not found: CustomFont.ttf", "h264_nvenc", "ENCODING", 1, False)
    assert result.code is RenderFailureCode.SUBTITLE_FONT_UNAVAILABLE
    assert result.fallback_eligible is False

