"""
UnfoldIQ Auto Timeline Compiler — Phase 14
Principles:
- Compiles timeline.json directly from narration timing, scene plan, selected visuals, and captions.
- Audio Policy: Kokoro narration is MASTER. Generated clip audio is MUTED by default.
- Missing assets create clear blockers without crashing the timeline builder.
- Produces clean timeline specifications ready for FFmpegRenderer.
"""

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, Optional, List

from studio.asset_intake import asset_intake
from studio.scene_planner import compute_file_sha256

logger = logging.getLogger("unfoldiq.timeline")

class TimelineCompiler:
    def __init__(self):
        pass

    def get_timeline_file(self, project_dir: Path) -> Path:
        return project_dir / "timeline.json"

    def compile_timeline(
        self,
        project_dir: Path,
        mute_generated_audio: bool = True,
        transition_type: str = "crossfade",
        transition_duration: float = 0.25,
        strict: bool = False,
    ) -> Dict[str, Any]:
        """Compile complete production timeline for the project.

        P1 (§6): stale-check đầu vào. strict=True → từ chối input stale (raise);
        mặc định vẫn compile nhưng gắn cờ `staleInputs` để UI cảnh báo, không hiện READY giả.
        """
        scene_plan_file = project_dir / "scene_plan.json"
        audio_file = project_dir / "audio.wav"
        subtitles_file = project_dir / "timestamps.srt"

        scenes_data = []
        raw_sp: Dict[str, Any] = {}
        if scene_plan_file.exists():
            try:
                raw_sp = json.loads(scene_plan_file.read_text(encoding="utf-8"))
                scenes_data = raw_sp.get("scenes", [])
            except Exception as e:
                logger.warning(f"Failed to read scene plan: {e}")

        # P1 (§6): stale input detection (timestamps đổi sau khi plan scene).
        stale_inputs: List[str] = []
        try:
            ts_path = project_dir / "timestamps.json"
            if ts_path.is_file() and raw_sp.get("timestamps_sha256"):
                if compute_file_sha256(ts_path) != raw_sp.get("timestamps_sha256"):
                    stale_inputs.append("scene_plan")
        except Exception:
            pass
        try:
            if audio_file.is_file():
                ts_data_raw = json.loads((project_dir / "timestamps.json").read_text(encoding="utf-8"))
                ts_audio = ts_data_raw.get("audio_sha256") or ts_data_raw.get("source_audio_hash")
                if ts_audio and compute_file_sha256(audio_file) != ts_audio:
                    stale_inputs.append("timestamps")
        except Exception:
            pass
        if strict and stale_inputs:
            raise ValueError(
                "Timeline từ chối input stale: %s. Hãy đồng bộ lại trước khi compile."
                % ", ".join(stale_inputs)
            )

        total_audio_duration = 0.0
        if (project_dir / "timestamps.json").exists():
            try:
                ts_data = json.loads((project_dir / "timestamps.json").read_text(encoding="utf-8"))
                total_audio_duration = float(ts_data.get("duration", 0.0))
            except Exception:
                pass

        compiled_scenes = []
        missing_asset_scenes = []
        current_time = 0.0

        for i, sc in enumerate(scenes_data):
            sc_id = sc.get("scene_id") or sc.get("id") or f"scene_{i+1:03d}"
            target_dur = float(sc.get("target_duration") or sc.get("duration") or 6.0)
            voice_dur = float(sc.get("voice_duration") or target_dur)

            # Resolve selected asset from Asset Intake
            selected_asset = asset_intake.get_selected_asset_for_scene(project_dir, sc_id)
            has_asset = selected_asset is not None
            if not has_asset:
                missing_asset_scenes.append(sc_id)

            sc_entry = {
                "sceneId": sc_id,
                "sceneIndex": i + 1,
                "start": round(current_time, 2),
                "end": round(current_time + target_dur, 2),
                "duration": round(target_dur, 2),
                "voiceDuration": round(voice_dur, 2),
                "narrationText": sc.get("narration") or sc.get("narration_text") or "",
                "hasVisual": has_asset,
                "selectedAssetId": selected_asset.get("id") if selected_asset else None,
                "assetFilePath": selected_asset.get("filePath") if selected_asset else None,
                "transition": {
                    "type": transition_type if i > 0 else "cut",
                    "duration": transition_duration if i > 0 else 0.0
                }
            }
            compiled_scenes.append(sc_entry)
            current_time += target_dur

        if total_audio_duration == 0.0:
            total_audio_duration = current_time

        # P1 (§4 lineage + §6 stale): version + cờ stale trong output, không READY giả.
        try:
            script_version = int(json.loads((project_dir / "script.json").read_text(encoding="utf-8")).get("version", 1))
        except Exception:
            script_version = 1
        timeline_complete = len(missing_asset_scenes) == 0 and len(compiled_scenes) > 0
        timeline_data = {
            "timelineVersion": "1.0.0",
            "projectId": project_dir.name,
            "script_version": script_version,
            "staleInputs": stale_inputs,
            "totalDuration": round(total_audio_duration, 2),
            "targetDuration": round(current_time, 2),
            "fps": 24,
            "resolution": {"width": 1920, "height": 1080},
            "audioPolicy": {
                "narrationMaster": True,
                "narrationFile": "audio.wav" if audio_file.exists() else None,
                "muteGeneratedAudio": mute_generated_audio,
                "subtitlesFile": "timestamps.srt" if subtitles_file.exists() else None
            },
            "scenes": compiled_scenes,
            "stats": {
                "totalScenes": len(compiled_scenes),
                "readyScenes": len(compiled_scenes) - len(missing_asset_scenes),
                "missingScenes": len(missing_asset_scenes),
                "status": "READY" if timeline_complete and not stale_inputs else ("STALE" if stale_inputs else "PARTIAL")
            },
            "missingAssetScenes": missing_asset_scenes,
            "compiledAt": datetime.now(timezone.utc).isoformat()
        }

        # Save timeline.json
        self.get_timeline_file(project_dir).write_text(
            json.dumps(timeline_data, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        return timeline_data

    def get_timeline(self, project_dir: Path) -> Dict[str, Any]:
        tfile = self.get_timeline_file(project_dir)
        if tfile.exists():
            try:
                return json.loads(tfile.read_text(encoding="utf-8"))
            except Exception:
                pass
        return self.compile_timeline(project_dir)

timeline_compiler = TimelineCompiler()


# ===========================================================================
# Phase 7: renderer-independent Render Manifest & frame-accurate compilation.
# Integer frames are canonical (24fps); seconds are derived metadata only.
# Read-only preview + immutable explicit persistence (Tasks 7-8 wire the rest).
# This section does not alter the Phase 14 TimelineCompiler above.
# ===========================================================================

from dataclasses import dataclass as _dataclass

from studio.render_manifest import (
    ManifestValidationResult as _ManifestValidationResult,
    MusicTrack as _MusicTrack,
    OutputSettings as _OutputSettings,
    RenderClip as _RenderClip,
    RenderManifest as _RenderManifest,
    SceneMetadata as _SceneMetadata,
    SubtitlesTrack as _SubtitlesTrack,
    Transition as _Transition,
    VideoTrack as _VideoTrack,
    VoiceTrack as _VoiceTrack,
    frame_to_seconds as _frame_to_seconds,
    seconds_to_frame as _seconds_to_frame,
)
from studio.render_manifest_hashing import (
    compute_manifest_hash as _compute_manifest_hash,
    hash_file as _hash_file,
)

# filename -> sourceHashes key (plan contract; assetRegistryHash required
# because the registry is an actual compiler input for asset resolution).
_PHASE7_SOURCE_FILES = (
    ("scene_plan.json", "scenePlanHash"),
    ("veo_prompts.json", "veoPromptsHash"),
    ("timestamps.json", "timestampsHash"),
    ("audio.wav", "audioHash"),
    ("assets/intake_ledger.json", "intakeLedgerHash"),
    ("assets/registry.json", "assetRegistryHash"),
    ("visual_bible.json", "visualBibleHash"),
)


@_dataclass(frozen=True)
class ManifestCompilation:
    manifest: _RenderManifest
    validation: _ManifestValidationResult


def _validate_or_pass(manifest: _RenderManifest, project_dir: Path) -> _ManifestValidationResult:
    """Preview validation: full Task 6 gates (pure, read-only)."""
    from studio.render_manifest_validation import validate_render_manifest
    return validate_render_manifest(manifest, project_dir=project_dir)


def _ordered_shots(shots: list) -> list:
    def key(s: dict) -> tuple:
        return (
            str(s.get("scene_id") or s.get("parent_scene_id") or ""),
            int(s.get("index") or s.get("scene_shot_index") or 0),
        )
    by_scene: dict[str, list] = {}
    for s in shots:
        if isinstance(s, dict) and s.get("shot_id"):
            by_scene.setdefault(str(s.get("scene_id") or ""), []).append(s)
    ordered: list = []
    for scene_id in sorted(by_scene):
        ordered.extend(sorted(by_scene[scene_id], key=key))
    return ordered


def _scene_order_index(scenes: list) -> dict[str, int]:
    order: dict[str, int] = {}
    for i, sc in enumerate(scenes):
        if isinstance(sc, dict) and sc.get("scene_id"):
            order.setdefault(str(sc["scene_id"]), int(sc.get("index") or i + 1))
    return order


def _source_numbers(shot: dict) -> tuple[float | None, float | None, float | None, float | None]:
    """Parse source timing; None on non-numeric (never raises).

    Returns (start, end, explicit_duration_field, implied_end_minus_start).
    """
    def _num(v):
        try:
            return float(v)
        except (TypeError, ValueError):
            return None
    start = _num(shot.get("start", 0.0))
    raw_end = shot.get("end")
    end = _num(raw_end) if raw_end is not None else None
    explicit = _num(shot.get("duration")) if shot.get("duration") is not None else None
    implied = (end - start) if (start is not None and end is not None) else None
    return start, end, explicit, implied


def prevalidate_source_timing(shots: list) -> list:
    """Structured blockers for invalid source timing, before quantization.

    No RenderClip is constructed here (schema invariant preserved).
    """
    from studio.render_manifest import ValidationIssue as _ValidationIssue
    issues: list = []
    for s in shots:
        if not isinstance(s, dict) or not s.get("shot_id"):
            continue
        shot_id = str(s["shot_id"])
        scene_id = str(s.get("scene_id") or "")
        ctx = dict(sceneId=scene_id or None, shotId=shot_id)
        start, end, explicit, implied = _source_numbers(s)
        if start is None or end is None:
            issues.append(_ValidationIssue(
                code="INVALID_TIMESTAMPS", severity="BLOCKER",
                message="Source shot timing is non-numeric.",
                expected="numeric start/end", actual="non-numeric", **ctx))
            continue
        if start < 0:
            issues.append(_ValidationIssue(
                code="INVALID_TIMESTAMPS", severity="BLOCKER",
                message="Source shot starts before zero.",
                expected="start>=0", actual=f"start={start}", **ctx))
        if explicit is not None and explicit <= 0:
            issues.append(_ValidationIssue(
                code="NON_POSITIVE_DURATION", severity="BLOCKER",
                message="Source shot duration field is not positive.",
                expected="duration>0", actual=f"duration={explicit}", **ctx))
        if implied is not None and implied <= 0:
            issues.append(_ValidationIssue(
                code="INVALID_TIMESTAMPS", severity="BLOCKER",
                message="Source shot end does not follow start.",
                expected="end>start", actual=f"start={start},end={end}", **ctx))
            issues.append(_ValidationIssue(
                code="NON_POSITIVE_DURATION", severity="BLOCKER",
                message="Source shot interval duration is not positive.",
                expected="end-start>0", actual=f"end-start={implied}", **ctx))
    return issues


def _invalid_shot_ids(issues: list) -> set[str]:
    return {str(i.shotId) for i in issues if i.shotId}


def build_render_manifest(
    project_id: str,
    scenes: list,
    shots: list,
    assets_by_shot: dict,
    vb_bindings: dict | None = None,
    master_audio: dict | None = None,
    output: dict | None = None,
    transitions: dict | None = None,
    source_hashes: dict | None = None,
    collect_issues: list | None = None,
) -> _RenderManifest:
    """Pure builder: stable IDs, CUT adjacency, integer frames only.

    Shots failing source pre-validation are skipped (schema invariant: never
    build an invalid RenderClip); their structured issues are appended to
    `collect_issues` when provided, and compile paths merge them into the
    returned ManifestValidationResult.
    """
    from studio.asset_registry import resolve_asset_role
    from studio.render_manifest import ValidationIssue as _ValidationIssue

    pre_issues = prevalidate_source_timing(shots)
    if collect_issues is not None:
        collect_issues.extend(pre_issues)
    skipped = _invalid_shot_ids(pre_issues)

    order = _scene_order_index(scenes)
    shots_sorted = sorted(
        [s for s in shots if isinstance(s, dict) and s.get("shot_id")],
        key=lambda s: (order.get(str(s.get("scene_id") or ""), 10 ** 9),
                       int(s.get("index") or s.get("scene_shot_index") or 0),
                       str(s.get("shot_id"))),
    )
    clips: list[_RenderClip] = []
    cursor = 0
    seq = 0
    for s in shots_sorted:
        shot_id = str(s["shot_id"])
        scene_id = str(s.get("scene_id") or "")
        if shot_id in skipped:
            continue
        start_f = _seconds_to_frame(float(s.get("start") or 0.0))
        end_f = _seconds_to_frame(float(s.get("end") if s.get("end") is not None else s.get("duration") or 0.0))
        if end_f <= start_f or start_f < 0:
            # Valid source that degenerates under quantization: skip the clip
            # (schema invariant) and record the exact structured blocker.
            if collect_issues is not None:
                from studio.render_manifest import ValidationIssue as _VI
                ctx = dict(sceneId=scene_id or None, shotId=shot_id)
                if start_f < 0:
                    collect_issues.append(_VI(
                        code="INVALID_TIMESTAMPS", severity="BLOCKER",
                        message="Quantized shot starts before zero.",
                        expected="startFrame>=0",
                        actual=f"startFrame={start_f}", **ctx))
                else:
                    collect_issues.append(_VI(
                        code="NON_POSITIVE_DURATION", severity="BLOCKER",
                        message="Quantized shot duration is not positive.",
                        expected="durationFrames>0",
                        actual=f"durationFrames={end_f - start_f}", **ctx))
            continue
        trans = (transitions or {}).get(shot_id) or _Transition(type="CUT", durationFrames=0)
        overlap = trans.durationFrames if trans.type == "CROSSFADE" else 0
        if seq == 0:
            clip_start = start_f
            cursor = end_f
        else:
            clip_start = cursor - overlap
            cursor = max(cursor, clip_start + (end_f - start_f))
        duration_f = (end_f - start_f)
        entry = (assets_by_shot or {}).get(shot_id)
        binding = (vb_bindings or {}).get(shot_id)
        if entry is not None or binding is not None:
            res = resolve_asset_role(registry_entry=entry, canonical_binding=binding)
        else:
            res = resolve_asset_role(registry_entry={"asset_id": None})
        seq += 1
        clips.append(_RenderClip(
            clipId=f"clip_{seq:04d}",
            sceneId=scene_id,
            shotId=shot_id,
            sequenceIndex=seq,
            startFrame=clip_start,
            durationFrames=duration_f,
            endFrame=clip_start + duration_f,
            timelineStartSeconds=_frame_to_seconds(clip_start),
            durationSeconds=_frame_to_seconds(duration_f),
            assetId=res.asset_id or "",
            acceptedAssetVersion=res.accepted_version if res.accepted_version is not None else "",
            checksum=res.checksum or "",
            filePath=res.file_path or "",
            mediaType="VIDEO" if str(res.file_path or "").lower().endswith((".mp4", ".mov")) else "IMAGE",
            transition=trans,
        ))
    scene_clips: dict[str, list[str]] = {}
    for c in clips:
        scene_clips.setdefault(c.sceneId, []).append(c.clipId)
    scene_meta = [_SceneMetadata(
        sceneId=str(sc.get("scene_id")),
        sceneIndex=int(sc.get("index") or 0),
        clipIds=scene_clips.get(str(sc.get("scene_id")), []),
    ) for sc in scenes if isinstance(sc, dict) and sc.get("scene_id")]
    audio = master_audio or {}
    manifest = _RenderManifest(
        projectId=project_id,
        output=_OutputSettings(**(output or {})),
        videoTrack=_VideoTrack(clips=clips),
        voiceTrack=_VoiceTrack(
            filePath=audio.get("filePath"),
            checksum=audio.get("checksum"),
            durationFrames=int(audio.get("durationFrames") or 0),
        ),
        musicTrack=_MusicTrack(configured=bool((output or {}).get("bgmPath"))),
        subtitlesTrack=_SubtitlesTrack(configured=bool((output or {}).get("subtitlesPath"))),
        scenes=scene_meta,
        sourceHashes=dict(source_hashes or {}),
    )
    manifest.manifestHash = _compute_manifest_hash(manifest.model_dump(mode="json"))
    return manifest


def load_scene_shots(project_dir: Path) -> list:
    """Canonical shot list from veo_prompts.json (read-only)."""
    p = Path(project_dir) / "veo_prompts.json"
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return []
    shots = data.get("shots") or []
    return [s for s in shots if isinstance(s, dict) and s.get("shot_id")]


def load_scene_list(project_dir: Path) -> list:
    p = Path(project_dir) / "scene_plan.json"
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return []
    return [s for s in (data.get("scenes") or []) if isinstance(s, dict)]


def load_assets_by_shot(project_dir: Path) -> dict:
    """Read-only merge of intake ledger + persisted registry + VB refs."""
    from studio.asset_registry import load_registry
    project_dir = Path(project_dir)
    merged: dict[str, dict] = {}
    try:
        reg = load_registry(project_dir)
        for a in reg.get("assets", []) or []:
            if isinstance(a, dict) and a.get("shot_id"):
                merged.setdefault(str(a["shot_id"]), dict(a))
    except Exception:
        pass
    try:
        ledger_p = project_dir / "assets" / "intake_ledger.json"
        if ledger_p.is_file():
            entries = json.loads(ledger_p.read_text(encoding="utf-8")).get("assets", []) or []
            for e in entries:
                if isinstance(e, dict) and e.get("shot_id"):
                    merged.setdefault(str(e["shot_id"]), {
                        "asset_id": e.get("id") or e.get("asset_id"),
                        "lifecycle": e.get("lifecycle", "GENERATED"),
                        "checksum": e.get("checksum"),
                        "version": e.get("version"),
                        "master": e.get("filePath"),
                        "scene_id": e.get("scene_id"),
                        "shot_id": e.get("shot_id"),
                    })
    except Exception:
        pass
    return merged


def load_vb_bindings(project_dir: Path, shots: list) -> dict:
    """Map shot_id -> canonical binding when a VB entity id matches."""
    try:
        vb = json.loads((Path(project_dir) / "visual_bible.json").read_text(encoding="utf-8"))
    except Exception:
        return {}
    entity_files: dict[str, dict] = {}
    for ra in vb.get("referenceAssets", []) or []:
        if isinstance(ra, dict) and ra.get("entityId") and ra.get("path"):
            entity_files[str(ra["entityId"])] = {
                "entity_id": str(ra["entityId"]),
                "master": str(ra["path"]),
                "checksum": ra.get("contentHash"),
                "version": ra.get("contentHash", "")[:12],
            }
    bindings: dict[str, dict] = {}
    for s in shots:
        if not isinstance(s, dict):
            continue
        ids: list[str] = []
        for key in ("subjectIds", "propIds"):
            ids.extend([str(x) for x in (s.get(key) or []) if x])
        if s.get("environmentId"):
            ids.append(str(s["environmentId"]))
        for eid in ids:
            if eid in entity_files:
                bindings[str(s["shot_id"])] = entity_files[eid]
                break
    return bindings


def load_master_audio_info(project_dir: Path) -> dict:
    """Master audio presence + duration frames (header-only, read-only)."""
    p = Path(project_dir) / "audio.wav"
    info: dict = {"filePath": None, "checksum": None, "durationFrames": 0}
    if not p.is_file():
        return info
    try:
        from studio.render_manifest_hashing import hash_file
        info["checksum"] = hash_file(p)
    except Exception:
        pass
    info["filePath"] = "audio.wav"
    try:
        import wave
        with wave.open(str(p), "rb") as w:
            frames = w.getnframes()
            rate = w.getframerate() or 48000
            info["durationFrames"] = _seconds_to_frame(frames / rate)
            info["sampleRate"] = rate
            info["channels"] = w.getnchannels()
    except Exception:
        try:
            ts = json.loads((Path(project_dir) / "timestamps.json").read_text(encoding="utf-8"))
            info["durationFrames"] = _seconds_to_frame(float(ts.get("audio_duration") or 0.0))
        except Exception:
            pass
    return info


def load_output_settings(project_dir: Path) -> dict:
    return {}


def load_source_hashes(project_dir: Path) -> dict:
    """Hash every actual compiler input; absent files hash as "absent"."""
    hashes: dict[str, str] = {}
    for name, key in _PHASE7_SOURCE_FILES:
        p = Path(project_dir) / name
        if p.is_file():
            try:
                hashes[key] = _hash_file(p)
            except Exception:
                hashes[key] = "unreadable"
        else:
            hashes[key] = "absent"
    return hashes


def _merge_issues(pre: list, result: _ManifestValidationResult) -> _ManifestValidationResult:
    from studio.render_manifest import ManifestValidationResult as _MVR
    if not pre:
        return result
    return _MVR.from_issues(list(pre) + list(result.blockers) + list(result.warnings))


def compile_manifest_preview(project_dir: Path) -> ManifestCompilation:
    """Read-only preview: loads sources, builds manifest, validates."""
    project_dir = Path(project_dir)
    scenes = load_scene_list(project_dir)
    shots = load_scene_shots(project_dir)
    assets = load_assets_by_shot(project_dir)
    bindings = load_vb_bindings(project_dir, shots)
    audio = load_master_audio_info(project_dir)
    output = load_output_settings(project_dir)
    hashes = load_source_hashes(project_dir)
    pre: list = []
    manifest = build_render_manifest(
        project_dir.name, scenes, shots, assets, bindings, audio, output, None, hashes,
        collect_issues=pre)
    validation = _merge_issues(pre, _validate_or_pass(manifest, project_dir))
    return ManifestCompilation(manifest=manifest, validation=validation)


# ---------------------------------------------------------------------------
# Phase 7 persistence: immutable snapshots under an existing exportId.
# ---------------------------------------------------------------------------

class RenderManifestConflictError(Exception):
    """Same exportId already holds a different historical manifest."""

    def __init__(self, export_id: str, existing_hash: str, new_hash: str):
        super().__init__(
            f"Export {export_id} already holds a different render manifest "
            f"(existing {existing_hash[:12]} vs new {new_hash[:12]}). Refusing to overwrite.")
        self.export_id = export_id
        self.existing_hash = existing_hash
        self.new_hash = new_hash


@_dataclass(frozen=True)
class PersistedManifestResult:
    manifest: _RenderManifest
    validation: _ManifestValidationResult
    manifest_hash: str
    path: Path | None
    persisted: bool
    reused: bool = False
    persisted_text: str = ""


def _validate_persist_export_id(export_id: str) -> str:
    from studio.production_export import validate_export_id, ProductionExportError
    try:
        return validate_export_id(export_id)
    except ProductionExportError as e:
        raise ValueError(str(e)) from e


def _manifest_file_text(manifest: _RenderManifest) -> str:
    import json as _json
    return _json.dumps(manifest.model_dump(mode="json"), indent=2, ensure_ascii=False)


def _persist_manifest_to_dir(manifest: _RenderManifest, export_dir: Path) -> Path:
    """Atomic write of render-manifest.json into an export directory."""
    export_dir = Path(export_dir)
    export_dir.mkdir(parents=True, exist_ok=True)
    final_path = export_dir / "render-manifest.json"
    tmp_path = export_dir / "render-manifest.json.tmp"
    tmp_path.write_text(_manifest_file_text(manifest), encoding="utf-8", newline="\n")
    try:
        import os as _os
        _os.replace(tmp_path, final_path)
    except Exception:
        try:
            tmp_path.unlink(missing_ok=True)
        except Exception:
            pass
        raise
    return final_path


def _stable_created_at(project_dir: Path, export_id: str, export_dir: Path) -> str:
    """createdAt owned by the existing export snapshot, else now (once)."""
    import json as _json
    from datetime import datetime as _dt, timezone as _tz
    existing = export_dir / "render-manifest.json"
    if existing.is_file():
        try:
            ts = _json.loads(existing.read_text(encoding="utf-8")).get("createdAt")
            if ts:
                return str(ts)
        except Exception:
            pass
    prod = export_dir / "production_manifest.json"
    if prod.is_file():
        try:
            ts = _json.loads(prod.read_text(encoding="utf-8")).get("createdAt")
            if ts:
                return str(ts)
        except Exception:
            pass
    return _dt.now(_tz.utc).isoformat()


def build_render_manifest_for_export(
    project_dir: Path,
    export_id: str,
    created_at: str | None = None,
) -> PersistedManifestResult:
    """Build + validate a manifest bound to an exportId (no disk write)."""
    project_dir = Path(project_dir)
    export_id = _validate_persist_export_id(export_id)
    export_dir = project_dir / "exports" / export_id
    scenes = load_scene_list(project_dir)
    shots = load_scene_shots(project_dir)
    assets = load_assets_by_shot(project_dir)
    bindings = load_vb_bindings(project_dir, shots)
    audio = load_master_audio_info(project_dir)
    output = load_output_settings(project_dir)
    hashes = load_source_hashes(project_dir)
    pre: list = []
    manifest = build_render_manifest(
        project_dir.name, scenes, shots, assets, bindings, audio, output, None, hashes,
        collect_issues=pre)
    manifest.exportId = export_id
    manifest.createdAt = created_at or _stable_created_at(project_dir, export_id, export_dir)
    manifest.manifestHash = _compute_manifest_hash(manifest.model_dump(mode="json"))
    validation = _merge_issues(pre, _validate_or_pass(manifest, project_dir))
    return PersistedManifestResult(
        manifest=manifest, validation=validation,
        manifest_hash=manifest.manifestHash or "",
        path=export_dir / "render-manifest.json",
        persisted=False, reused=False,
        persisted_text=_manifest_file_text(manifest))


def compile_render_manifest(project_dir: Path, export_id: str) -> PersistedManifestResult:
    """Explicit persistence of an immutable render-manifest snapshot.

    - Blockers -> no write (result.persisted False).
    - Same canonical hash already present -> idempotent reuse (no rewrite).
    - Different hash already present -> RenderManifestConflictError.
    """
    import json as _json
    project_dir = Path(project_dir)
    export_id = _validate_persist_export_id(export_id)
    built = build_render_manifest_for_export(project_dir, export_id)
    if not built.validation.valid:
        return PersistedManifestResult(
            manifest=built.manifest, validation=built.validation,
            manifest_hash=built.manifest_hash, path=None,
            persisted=False, reused=False, persisted_text=built.persisted_text)
    final_path = Path(project_dir) / "exports" / export_id / "render-manifest.json"
    if final_path.is_file():
        try:
            existing = _json.loads(final_path.read_text(encoding="utf-8"))
            existing_hash = _compute_manifest_hash(existing)
        except Exception:
            existing_hash = ""
        if existing_hash == built.manifest_hash:
            return PersistedManifestResult(
                manifest=built.manifest, validation=built.validation,
                manifest_hash=built.manifest_hash, path=final_path,
                persisted=True, reused=True, persisted_text=built.persisted_text)
        raise RenderManifestConflictError(export_id, existing_hash, built.manifest_hash)
    _persist_manifest_to_dir(built.manifest, final_path.parent)
    return PersistedManifestResult(
        manifest=built.manifest, validation=built.validation,
        manifest_hash=built.manifest_hash, path=final_path,
        persisted=True, reused=False, persisted_text=built.persisted_text)
