"""
UnfoldIQ Domain Models — Unified Entity Architecture (Phase 1)
Represents the unified domain model for Story, Voice, Visual, Media Assets, and Export.
Fully compatible with Pydantic v2 and backward-compatible with legacy Phase 1-15 project formats.
"""

from typing import Dict, Any, List, Optional
from pydantic import BaseModel, Field


class WordCue(BaseModel):
    word: str
    start: float
    end: float
    score: Optional[float] = None

    model_config = {"extra": "allow"}


class AudioChunk(BaseModel):
    chunk_id: str
    index: int
    text: str
    voice: Optional[str] = None
    speed: Optional[float] = 1.0
    render_hash: Optional[str] = None
    audio_file: Optional[str] = None
    duration: Optional[float] = 0.0
    is_locked: bool = False
    words: List[WordCue] = Field(default_factory=list)

    model_config = {"extra": "allow"}


class StoryBeat(BaseModel):
    beat_id: str
    index: int
    title: str
    text: str
    target_duration_seconds: Optional[float] = None
    estimated_word_count: Optional[int] = None
    notes: Optional[str] = None

    model_config = {"extra": "allow"}


class AssetRef(BaseModel):
    asset_id: str
    scene_id: Optional[str] = None
    shot_id: Optional[str] = None
    thumbnail_path: Optional[str] = None
    master_path: Optional[str] = None
    lifecycle_state: str = "GENERATED"  # GENERATED, SELECTED, APPROVED, LOCKED, REJECTED
    checksum: Optional[str] = None
    mime_type: Optional[str] = None

    model_config = {"extra": "allow"}


class Shot(BaseModel):
    shot_id: str
    parent_scene_id: str
    index: int
    shot_type: str = "medium wide"
    camera_motion: str = "static cinematic camera"
    aspect_ratio: str = "16:9"
    veo_prompt: str = ""
    negative_prompt: Optional[str] = ""
    continuity_anchor: Optional[str] = None
    subject_action: Optional[str] = None
    environmental_action: Optional[str] = None
    lighting_atmosphere: Optional[str] = None
    inherited_entities: Dict[str, Any] = Field(default_factory=dict)
    asset_ref: Optional[AssetRef] = None
    start: Optional[float] = None
    end: Optional[float] = None
    duration: Optional[float] = None

    model_config = {"extra": "allow"}


class Scene(BaseModel):
    scene_id: str
    index: int
    category: str = "reconstruction"
    start: float = 0.0
    end: float = 0.0
    duration: float = 0.0
    visual_summary: Optional[str] = ""
    narration: Optional[str] = ""
    image_prompt: Optional[str] = ""
    evidence_mode: Optional[str] = "reconstruction"
    shot_type: Optional[str] = "medium wide"
    shots: List[Shot] = Field(default_factory=list)

    model_config = {"extra": "allow"}


class StorySlice(BaseModel):
    project_id: str
    schema_version: str = "2.0.0"
    script_text: str = ""
    beats: List[StoryBeat] = Field(default_factory=list)
    word_count: int = 0
    estimated_duration_seconds: float = 0.0
    metadata: Dict[str, Any] = Field(default_factory=dict)

    model_config = {"extra": "allow"}


class VoiceSlice(BaseModel):
    project_id: str
    schema_version: str = "2.0.0"
    voice_id: str = "af_sarah"
    speed: float = 1.0
    chunks: List[AudioChunk] = Field(default_factory=list)
    total_chunks: int = 0
    total_duration_seconds: float = 0.0
    has_audio: bool = False
    audio_status: str = "EMPTY"  # EMPTY, READY, OUTDATED
    audio_file: Optional[str] = None

    model_config = {"extra": "allow"}


class SceneSummary(BaseModel):
    """Lightweight representation of a Scene for the Visual Navigator list (no heavy prompts)."""
    scene_id: str
    index: int
    category: str = "reconstruction"
    start: float = 0.0
    end: float = 0.0
    duration: float = 0.0
    visual_summary: Optional[str] = ""
    shot_count: int = 0
    shot_ids: List[str] = Field(default_factory=list)
    has_narration: bool = False
    evidence_mode: Optional[str] = "reconstruction"

    model_config = {"extra": "allow"}


class VisualSummarySlice(BaseModel):
    """High-level summary of the visual pipeline status, scene/shot counts, and entity metrics."""
    project_id: str
    schema_version: str = "2.0.0"
    total_scenes: int = 0
    total_shots: int = 0
    total_duration_seconds: float = 0.0
    visual_status: str = "EMPTY"  # EMPTY, READY, OUTDATED
    visual_bible_status: str = "EMPTY"
    entity_counts: Dict[str, int] = Field(default_factory=dict)

    model_config = {"extra": "allow"}


class VisualBibleSlice(BaseModel):
    """Dedicated context slice for Visual Bible entities without mixing into scene loads."""
    project_id: str
    schema_version: str = "2.0.0"
    visual_bible: Dict[str, Any] = Field(default_factory=dict)
    characters_count: int = 0
    environments_count: int = 0
    objects_count: int = 0
    status: str = "EMPTY"

    model_config = {"extra": "allow"}


class VisualSlice(BaseModel):
    """Aggregate Visual slice for diagnostics/internal usage."""
    project_id: str
    schema_version: str = "2.0.0"
    scenes: List[Scene] = Field(default_factory=list)
    total_scenes: int = 0
    total_shots: int = 0
    visual_bible: Dict[str, Any] = Field(default_factory=dict)
    visual_status: str = "EMPTY"  # EMPTY, READY, OUTDATED

    model_config = {"extra": "allow"}


class OverviewSlice(BaseModel):
    project_id: str
    schema_version: str = "2.0.0"
    title: str = ""
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    status_summary: Dict[str, str] = Field(default_factory=dict)
    stats: Dict[str, Any] = Field(default_factory=dict)

    model_config = {"extra": "allow"}


class ProjectV2State(BaseModel):
    project_id: str
    schema_version: str = "2.0.0"
    title: str = ""
    script_text: str = ""
    story_beats: List[StoryBeat] = Field(default_factory=list)
    audio_chunks: List[AudioChunk] = Field(default_factory=list)
    scenes: List[Scene] = Field(default_factory=list)
    visual_bible: Dict[str, Any] = Field(default_factory=dict)
    assets: List[AssetRef] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)

    model_config = {"extra": "allow"}
