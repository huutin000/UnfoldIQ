"""Phase 8 failure classification: ordered signatures, safe fallback rule.

Order: cancellation first; input/filter/subtitle/mux signatures before any
NVENC token; only the four hardware/encoder codes are fallback-eligible,
and only for nvenc attempts. Never match bare "CUDA" as a fallback rule.
"""
from studio.manifest_render_types import (
    FALLBACK_ELIGIBLE_CODES,
    FailureClassification,
    RenderFailureCode,
)


def _has(text: str, *tokens: str) -> bool:
    low = text.lower()
    return any(t.lower() in low for t in tokens)


def classify_render_failure(stderr_tail: str, encoder: str, execution_stage: str,
                            return_code: int, cancel_requested: bool) -> FailureClassification:
    err = stderr_tail or ""

    if cancel_requested:
        return FailureClassification(RenderFailureCode.CANCELLED, False)

    # Subtitles & Fonts (checked before generic "not found").
    if _has(err, "font not found", "font unavailable", "cannot open font", "subtitle_font"):
        return FailureClassification(RenderFailureCode.SUBTITLE_FONT_UNAVAILABLE, False)
    if _has(err, "subtitle encoding failed", "subtitle_encoding"):
        return FailureClassification(RenderFailureCode.SUBTITLE_ENCODING_ERROR, False)
    if _has(err, "libass", "subtitles filter"):
        return FailureClassification(RenderFailureCode.SUBTITLE_BURNIN_ERROR, False)

    # Input / filesystem.
    if _has(err, "no such file or directory", "not found", "cannot open"):
        return FailureClassification(RenderFailureCode.INPUT_MISSING, False)

    # Filtergraph (checked before NVENC tokens: a filter failure inside a
    # CUDA context is still a filter failure, never hardware fallback).
    if _has(err, "error reinitializing filters", "filtergraph", "filter ",
            "invalid filter", "no such filter", "asplit", "frame sync error"):
        return FailureClassification(RenderFailureCode.FILTERGRAPH_ERROR, False)

    # Mux.
    if _has(err, "mux", "could not write header", "could not write trailer",
            "invalid data found when processing input", "moov"):
        return FailureClassification(RenderFailureCode.MUX_ERROR, False)

    # Hardware/encoder (nvenc attempts only; explicit signatures, no bare CUDA).
    code = None
    if _has(err, "no capable devices found", "cannot load libcuda",
            "cuda driver", "nvcuda", "no cuda-capable device",
            "failed to create nvenc", "nvenc device"):
        code = RenderFailureCode.ENCODER_HARDWARE_UNAVAILABLE
    elif _has(err, "out of memory", "failed to allocate"):
        if encoder == "h264_nvenc" and _has(err, "openencodesessionex", "nvenc", "encoder"):
            code = RenderFailureCode.ENCODER_OUT_OF_MEMORY
    elif _has(err, "initializeencoder failed", "failed to initialize encoder",
             "nvenc initialization failed"):
        code = RenderFailureCode.ENCODER_INITIALIZATION_FAILED
    elif _has(err, "encoder is busy", "session is busy", "too many sessions",
             "nvenc is busy"):
        code = RenderFailureCode.ENCODER_BUSY

    if code is not None:
        eligible = (encoder == "h264_nvenc"
                    and execution_stage == "ENCODING"
                    and code in FALLBACK_ELIGIBLE_CODES)
        return FailureClassification(code, eligible)

    if _has(err, "error encoding", "encoding failed", "conversion failed",
            "encode error"):
        return FailureClassification(RenderFailureCode.VIDEO_ENCODE_ERROR, False)
    return FailureClassification(RenderFailureCode.UNKNOWN_RENDER_ERROR, False)
