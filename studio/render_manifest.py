"""Phase 7 Render Manifest schema — renderer-independent, frame-accurate.

Contracts:
- Canonical video ``frameRate = 24/1`` and ``timeBase = 1/24``.
- Clip ranges are half-open: ``[startFrame, endFrame)`` with
  ``endFrame == startFrame + durationFrames``.
- Integer frame coordinates are canonical; ``*Seconds`` fields are derived
  metadata only and must never reconstruct placement.
- Stable IDs (scene/shot/clip) are explicit, never derived from indices.
- Code/API/schema/enums are English (UI Vietnamese-first lives outside).
"""
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

SCHEMA_VERSION = "1.0.0"
RENDER_MANIFEST_VERSION = "1.0.0"
CANONICAL_FRAME_RATE = (24, 1)
CANONICAL_TIME_BASE = (1, 24)

FPS_NUM, FPS_DEN = CANONICAL_FRAME_RATE
TIME_BASE_NUM, TIME_BASE_DEN = CANONICAL_TIME_BASE


class Rational(BaseModel):
    numerator: int
    denominator: int

    @model_validator(mode="after")
    def validate_rational(self):
        if self.denominator <= 0:
            raise ValueError("denominator must be > 0")
        return self


class CanonicalTimeBase(Rational):
    """timeBase locked to the canonical v1 profile (1/24)."""

    @model_validator(mode="after")
    def validate_canonical(self):
        if (self.numerator, self.denominator) != CANONICAL_TIME_BASE:
            raise ValueError(
                f"canonical v1 timeBase must be {CANONICAL_TIME_BASE[0]}/"
                f"{CANONICAL_TIME_BASE[1]}"
            )
        return self


class OutputSettings(BaseModel):
    width: int = 1920
    height: int = 1080
    frameRate: Rational = Field(
        default_factory=lambda: Rational(
            numerator=CANONICAL_FRAME_RATE[0], denominator=CANONICAL_FRAME_RATE[1]))
    videoCodecTarget: str = "h264"
    audioSampleRate: int = 48000
    audioChannels: int = 2


class ClipTrim(BaseModel):
    inFrame: int = 0
    outFrame: int
    speedFactor: float = 1.0

    @model_validator(mode="after")
    def validate_trim(self):
        if self.inFrame < 0 or self.outFrame <= self.inFrame:
            raise ValueError("trim requires 0 <= inFrame < outFrame")
        if self.speedFactor <= 0:
            raise ValueError("speedFactor must be > 0")
        return self


class Transition(BaseModel):
    type: Literal["CUT", "CROSSFADE"] = "CUT"
    durationFrames: int = 0

    @model_validator(mode="after")
    def validate_transition(self):
        if self.durationFrames < 0:
            raise ValueError("durationFrames must be >= 0")
        if self.type == "CUT" and self.durationFrames != 0:
            raise ValueError("CUT must have durationFrames == 0")
        if self.type == "CROSSFADE" and self.durationFrames <= 0:
            raise ValueError("CROSSFADE must have durationFrames > 0")
        return self


class RenderClip(BaseModel):
    clipId: str
    sceneId: str
    shotId: str
    sequenceIndex: int
    startFrame: int
    durationFrames: int
    endFrame: int
    timelineStartSeconds: float = 0.0
    durationSeconds: float = 0.0
    assetId: str
    acceptedAssetVersion: int | str
    checksum: str
    filePath: str
    mediaType: Literal["IMAGE", "VIDEO"]
    trim: ClipTrim | None = None
    fittingStrategy: Literal["FIT_PAD", "FILL_CROP"] = "FIT_PAD"
    backgroundColor: str = "#0b0f19"
    transition: Transition = Field(default_factory=Transition)

    @model_validator(mode="after")
    def validate_half_open_interval(self):
        if self.startFrame < 0:
            raise ValueError("startFrame must be >= 0")
        if self.durationFrames <= 0:
            raise ValueError("durationFrames must be > 0")
        if self.endFrame != self.startFrame + self.durationFrames:
            raise ValueError("endFrame must equal startFrame + durationFrames")
        return self


class VoiceTrack(BaseModel):
    filePath: str | None = None
    checksum: str | None = None
    durationFrames: int = 0
    volume: float = 1.0


class MusicTrack(BaseModel):
    filePath: str | None = None
    checksum: str | None = None
    configured: bool = False
    volume: float = 1.0
    loop: bool = False
    fadeInFrames: int = 0
    fadeOutFrames: int = 0


class SubtitlesTrack(BaseModel):
    filePath: str | None = None
    checksum: str | None = None
    configured: bool = False
    burnIn: bool = False
    format: str | None = None
    fontName: str | None = None
    fontSize: int | None = None
    bottomOffsetPx: int | None = None


class VideoTrack(BaseModel):
    clips: list[RenderClip] = Field(default_factory=list)


class SceneMetadata(BaseModel):
    sceneId: str
    sceneIndex: int
    clipIds: list[str] = Field(default_factory=list)


class ValidationIssue(BaseModel):
    code: str
    severity: Literal["BLOCKER", "WARNING"]
    message: str
    sceneId: str | None = None
    shotId: str | None = None
    assetId: str | None = None
    expected: str | None = None
    actual: str | None = None
    path: str | None = None


class ManifestValidationResult(BaseModel):
    valid: bool = True
    blockers: list[ValidationIssue] = Field(default_factory=list)
    warnings: list[ValidationIssue] = Field(default_factory=list)

    @classmethod
    def from_issues(cls, issues: list[ValidationIssue]) -> "ManifestValidationResult":
        blockers = [i for i in issues if i.severity == "BLOCKER"]
        warnings = [i for i in issues if i.severity == "WARNING"]
        return cls(valid=not blockers, blockers=blockers, warnings=warnings)


class RenderManifest(BaseModel):
    schemaVersion: str = SCHEMA_VERSION
    manifestHash: str | None = None
    projectId: str
    exportId: str | None = None
    createdAt: str | None = None
    frameRate: Rational = Field(
        default_factory=lambda: Rational(
            numerator=CANONICAL_FRAME_RATE[0], denominator=CANONICAL_FRAME_RATE[1]))
    timeBase: CanonicalTimeBase = Field(
        default_factory=lambda: CanonicalTimeBase(
            numerator=CANONICAL_TIME_BASE[0], denominator=CANONICAL_TIME_BASE[1]))
    output: OutputSettings = Field(default_factory=OutputSettings)
    videoTrack: VideoTrack = Field(default_factory=VideoTrack)
    voiceTrack: VoiceTrack = Field(default_factory=VoiceTrack)
    musicTrack: MusicTrack = Field(default_factory=MusicTrack)
    subtitlesTrack: SubtitlesTrack = Field(default_factory=SubtitlesTrack)
    scenes: list[SceneMetadata] = Field(default_factory=list)
    sourceHashes: dict[str, str] = Field(default_factory=dict)
    expectedFinalFrames: int | None = None

    @field_validator("frameRate")
    @classmethod
    def validate_canonical_frame_rate(cls, v: Rational) -> Rational:
        if (v.numerator, v.denominator) != CANONICAL_FRAME_RATE:
            raise ValueError(
                f"canonical v1 frameRate must be {CANONICAL_FRAME_RATE[0]}/"
                f"{CANONICAL_FRAME_RATE[1]}"
            )
        return v

    @classmethod
    def minimal_for_test(cls) -> "RenderManifest":
        clip = RenderClip(
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
            acceptedAssetVersion=1,
            checksum="0" * 64,
            filePath="assets/scene_001/shot_001.png",
            mediaType="IMAGE",
        )
        return cls(projectId="test_project", videoTrack=VideoTrack(clips=[clip]))


def frame_to_seconds(frame: int, time_base: Rational | None = None) -> float:
    """Derived metadata only: frames -> seconds. Never invert for placement."""
    tb = time_base or Rational(numerator=TIME_BASE_NUM, denominator=TIME_BASE_DEN)
    return frame * tb.numerator / tb.denominator


def seconds_to_frame(seconds: float) -> int:
    """Boundary import only: round half away from zero to nearest frame.

    Downstream timeline placement must use integer frames exclusively.
    """
    import math
    return int(math.floor(seconds * FPS_NUM / FPS_DEN + 0.5))
