"""Phase 8 versioned encoder + ducking profiles (configuration, not CLI literals).

FINAL_QUALITY_V1 preserves the exact current production Final baseline from
renderer_adapter.render_final: libx264 medium CRF18 yuv420p + AAC 192k/48k/stereo.
ACCELERATED_V1 starts from the Phase 4 proven NVENC candidate (p4/CQ28);
Task 12 re-benchmarks it and records the tradeoff before acceptance.
"""
from dataclasses import dataclass

from studio.domain_models import ResourceClass
from studio.manifest_render_types import EncoderProfileName


@dataclass(frozen=True)
class EncoderProfile:
    name: EncoderProfileName
    version: str
    video_encoder: str
    video_args: tuple[str, ...]
    resource_class: ResourceClass
    width: int = 1920
    height: int = 1080
    fps: int = 24
    pixel_format: str = "yuv420p"
    audio_codec: str = "aac"
    audio_bitrate: str = "192k"
    audio_sample_rate: int = 48000
    audio_channels: int = 2


@dataclass(frozen=True)
class DuckingPreset:
    name: str
    threshold: float
    ratio: float
    attack_ms: float
    release_ms: float
    knee: float
    detection: str = "rms"
    mode: str = "downward"


FINAL_QUALITY_V1 = EncoderProfile(
    name=EncoderProfileName.FINAL_QUALITY,
    version="FINAL_QUALITY_V1",
    video_encoder="libx264",
    video_args=("-c:v", "libx264", "-preset", "medium", "-crf", "18",
                "-pix_fmt", "yuv420p"),
    resource_class=ResourceClass.CPU_BOUND,
)

ACCELERATED_V1 = EncoderProfile(
    name=EncoderProfileName.ACCELERATED,
    version="ACCELERATED_V1",
    video_encoder="h264_nvenc",
    video_args=("-c:v", "h264_nvenc", "-preset", "p4", "-cq", "28"),
    resource_class=ResourceClass.GPU_ENCODER,
)

NARRATION_DUCK_V1 = DuckingPreset(
    name="NARRATION_DUCK_V1",
    threshold=0.05,
    ratio=6.0,
    attack_ms=20.0,
    release_ms=300.0,
    knee=2.828,
)

_ENCODER_PROFILES = {
    EncoderProfileName.FINAL_QUALITY: FINAL_QUALITY_V1,
    EncoderProfileName.ACCELERATED: ACCELERATED_V1,
}

_DUCKING_PRESETS = {
    "NARRATION_DUCK_V1": NARRATION_DUCK_V1,
}


def get_encoder_profile(name: EncoderProfileName) -> EncoderProfile:
    return _ENCODER_PROFILES[name]


def get_ducking_preset(name: str) -> DuckingPreset:
    return _DUCKING_PRESETS[name]
