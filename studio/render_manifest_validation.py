"""Phase 7 pre-render validation: ten canonical gates, pure functions.

No validator mutates project state. All gates operate on the manifest +
project directory reads only.
"""
from pathlib import Path

from studio.render_manifest import (
    ManifestValidationResult,
    RenderManifest,
    ValidationIssue,
)

_VALID_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp"}
_VALID_VIDEO_EXTS = {".mp4", ".mov"}
OPTIONAL_MISSING_SEVERITY = "WARNING"


def _resolve(p: Path) -> Path | None:
    try:
        return p.resolve()
    except Exception:
        return None


def _get(clip, name, default=None):
    try:
        v = getattr(clip, name)
        return default if v is None and default is not None else v
    except Exception:
        return default


def validate_paths(manifest: RenderManifest, project_dir: Path) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    root = _resolve(Path(project_dir))
    for clip in manifest.videoTrack.clips:
        rel = (clip.filePath or "").replace("\\", "/")
        ctx = dict(sceneId=clip.sceneId, shotId=clip.shotId, assetId=clip.assetId or None)
        if not rel:
            issues.append(ValidationIssue(
                code="PATH_SANDBOX_AND_PRESENCE", severity="BLOCKER",
                message="Clip has no file path.", path=clip.filePath, **ctx))
            continue
        if rel.startswith(("..", "/", "C:", "c:")) or rel.startswith("\\\\") or ":" in rel.split("/")[0]:
            issues.append(ValidationIssue(
                code="PATH_SANDBOX_AND_PRESENCE", severity="BLOCKER",
                message="Path escapes the project sandbox.", path=clip.filePath, **ctx))
            continue
        if root is None:
            continue
        target = _resolve(root / rel)
        if target is None or root not in target.parents:
            issues.append(ValidationIssue(
                code="PATH_SANDBOX_AND_PRESENCE", severity="BLOCKER",
                message="Resolved path escapes the project sandbox.", path=clip.filePath, **ctx))
        elif not target.is_file():
            issues.append(ValidationIssue(
                code="PATH_SANDBOX_AND_PRESENCE", severity="BLOCKER",
                message="Referenced media file is missing.", path=clip.filePath, **ctx))
    return issues


def _registry_entries(project_dir: Path) -> dict[str, dict]:
    from studio.asset_registry import load_registry
    found: dict[str, dict] = {}
    try:
        for a in load_registry(project_dir).get("assets", []) or []:
            if isinstance(a, dict) and a.get("asset_id"):
                found[str(a["asset_id"])] = a
    except Exception:
        pass
    try:
        p = Path(project_dir) / "assets" / "intake_ledger.json"
        if p.is_file():
            import json
            for e in json.loads(p.read_text(encoding="utf-8")).get("assets", []) or []:
                if isinstance(e, dict) and (e.get("id") or e.get("asset_id")):
                    found.setdefault(str(e.get("id") or e.get("asset_id")), e)
    except Exception:
        pass
    return found


def validate_assets(manifest: RenderManifest, project_dir: Path) -> list[ValidationIssue]:
    from studio.asset_registry import resolve_asset_role
    issues: list[ValidationIssue] = []
    entries = _registry_entries(project_dir)
    for clip in manifest.videoTrack.clips:
        ctx = dict(sceneId=_get(clip, "sceneId"), shotId=_get(clip, "shotId"),
                   assetId=_get(clip, "assetId") or None)
        entry = entries.get(_get(clip, "assetId")) if _get(clip, "assetId") else None
        if entry is None:
            # No registry authority: clip must be self-consistent.
            if (not _get(clip, "assetId") or _get(clip, "acceptedAssetVersion") in (None, "")
                    or not _get(clip, "checksum")):
                issues.append(ValidationIssue(
                    code="ACCEPTED_ASSET_INTEGRITY", severity="BLOCKER",
                    message="Clip references no accepted asset (missing id/version/checksum).",
                    path=_get(clip, "filePath"), **ctx))
            continue
        res = resolve_asset_role(registry_entry=entry)
        if res.role in ("unapproved", "rejected"):
            issues.append(ValidationIssue(
                code="ACCEPTED_ASSET_INTEGRITY", severity="BLOCKER",
                message=f"Asset role '{res.role}' is not accepted for render.",
                expected="accepted|canonicalReference", actual=res.role,
                path=_get(clip, "filePath"), **ctx))
            continue
        want_version = entry.get("accepted_version", entry.get("version"))
        if want_version not in (None, "") and str(_get(clip, "acceptedAssetVersion")) != str(want_version):
            issues.append(ValidationIssue(
                code="ACCEPTED_ASSET_INTEGRITY", severity="BLOCKER",
                message="Accepted asset version mismatch.",
                expected=str(want_version), actual=str(_get(clip, "acceptedAssetVersion")),
                path=_get(clip, "filePath"), **ctx))
        if entry.get("checksum") and _get(clip, "checksum") and entry["checksum"] != _get(clip, "checksum"):
            issues.append(ValidationIssue(
                code="ACCEPTED_ASSET_INTEGRITY", severity="BLOCKER",
                message="Asset checksum mismatch.",
                expected=str(entry["checksum"])[:16] + "...",
                actual=str(_get(clip, "checksum"))[:16] + "...",
                path=_get(clip, "filePath"), **ctx))
    return issues


def validate_media_types(manifest: RenderManifest, project_dir: Path) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    for clip in manifest.videoTrack.clips:
        ext = Path(clip.filePath or "").suffix.lower()
        if not ext:
            continue  # path gate owns empty paths
        if clip.mediaType == "IMAGE" and ext not in _VALID_IMAGE_EXTS:
            issues.append(ValidationIssue(
                code="UNSUPPORTED_MEDIA_TYPE", severity="BLOCKER",
                message=f"Unsupported image extension '{ext}'.",
                expected=",".join(sorted(_VALID_IMAGE_EXTS)), actual=ext,
                sceneId=clip.sceneId, shotId=clip.shotId, path=clip.filePath))
        elif clip.mediaType == "VIDEO" and ext not in _VALID_VIDEO_EXTS:
            issues.append(ValidationIssue(
                code="UNSUPPORTED_MEDIA_TYPE", severity="BLOCKER",
                message=f"Unsupported video extension '{ext}'.",
                expected=",".join(sorted(_VALID_VIDEO_EXTS)), actual=ext,
                sceneId=clip.sceneId, shotId=clip.shotId, path=clip.filePath))
    return issues


def validate_durations(manifest: RenderManifest, project_dir: Path) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    for clip in manifest.videoTrack.clips:
        if clip.durationFrames <= 0:
            issues.append(ValidationIssue(
                code="NON_POSITIVE_DURATION", severity="BLOCKER",
                message="Clip duration must be > 0 frames.",
                expected=">0", actual=str(clip.durationFrames),
                sceneId=clip.sceneId, shotId=clip.shotId, path=clip.filePath))
    return issues


def validate_timestamps(manifest: RenderManifest, project_dir: Path) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    for clip in manifest.videoTrack.clips:
        if clip.startFrame < 0 or clip.endFrame != clip.startFrame + clip.durationFrames:
            issues.append(ValidationIssue(
                code="INVALID_TIMESTAMPS", severity="BLOCKER",
                message="Clip timestamps inconsistent (need end == start + duration, start >= 0).",
                expected=f"end={clip.startFrame + clip.durationFrames}",
                actual=f"end={clip.endFrame}",
                sceneId=clip.sceneId, shotId=clip.shotId, path=clip.filePath))
    return issues


def validate_overlaps(manifest: RenderManifest, project_dir: Path) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    clips = sorted(manifest.videoTrack.clips, key=lambda c: c.sequenceIndex)
    prev = None
    for clip in clips:
        if prev is not None:
            overlap = clip.transition.durationFrames if clip.transition.type == "CROSSFADE" else 0
            expected = prev.endFrame - overlap
            if clip.startFrame < expected:
                issues.append(ValidationIssue(
                    code="TRANSITION_AWARE_OVERLAPS", severity="BLOCKER",
                    message="Undeclared timeline overlap.",
                    expected=f"start={expected}", actual=f"start={clip.startFrame}",
                    sceneId=clip.sceneId, shotId=clip.shotId, path=clip.filePath))
        prev = clip
    return issues


def validate_gaps(manifest: RenderManifest, project_dir: Path) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    clips = sorted(manifest.videoTrack.clips, key=lambda c: c.sequenceIndex)
    prev = None
    for clip in clips:
        if prev is None:
            if clip.startFrame > 0:
                issues.append(ValidationIssue(
                    code="TIMELINE_GAPS", severity="BLOCKER",
                    message="Timeline does not start at frame 0.",
                    expected="start=0", actual=f"start={clip.startFrame}",
                    sceneId=clip.sceneId, shotId=clip.shotId, path=clip.filePath))
        else:
            overlap = clip.transition.durationFrames if clip.transition.type == "CROSSFADE" else 0
            expected = prev.endFrame - overlap
            if clip.startFrame > expected:
                issues.append(ValidationIssue(
                    code="TIMELINE_GAPS", severity="BLOCKER",
                    message="Unexplained hole in timeline.",
                    expected=f"start={expected}", actual=f"start={clip.startFrame}",
                    sceneId=clip.sceneId, shotId=clip.shotId, path=clip.filePath))
        prev = clip
    return issues


def validate_master_audio(manifest: RenderManifest, project_dir: Path) -> list[ValidationIssue]:
    rel = (manifest.voiceTrack.filePath or "")
    if not rel:
        return [ValidationIssue(code="REQUIRED_MASTER_AUDIO", severity="BLOCKER",
                                message="Master audio is not configured.")]
    p = Path(project_dir) / rel.replace("\\", "/")
    if not p.is_file():
        return [ValidationIssue(code="REQUIRED_MASTER_AUDIO", severity="BLOCKER",
                                message="Master audio file is missing.", path=rel)]
    try:
        import wave
        with wave.open(str(p), "rb") as w:
            if w.getnframes() <= 0 or w.getframerate() <= 0:
                raise ValueError("empty audio")
    except Exception:
        return [ValidationIssue(code="REQUIRED_MASTER_AUDIO", severity="BLOCKER",
                                message="Master audio is not readable/valid.", path=rel)]
    return []


def validate_audio_alignment(manifest: RenderManifest, project_dir: Path) -> list[ValidationIssue]:
    clips = manifest.videoTrack.clips
    if not clips or not manifest.voiceTrack.filePath:
        return []
    video_end = max(c.endFrame for c in clips)
    audio_frames = manifest.voiceTrack.durationFrames or 0
    if abs(video_end - audio_frames) <= 1:
        return []
    return [ValidationIssue(
        code="AUDIO_DURATION_ALIGNMENT", severity="BLOCKER",
        message="Master audio duration differs from video timeline by more than one frame.",
        expected=f"audioFrames~{video_end}", actual=f"audioFrames={audio_frames}")]


def validate_optional_tracks(manifest: RenderManifest, project_dir: Path) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    for label, track in (("bgm", manifest.musicTrack), ("subtitles", manifest.subtitlesTrack)):
        if not track.configured:
            continue
        if not track.filePath or not (Path(project_dir) / track.filePath.replace("\\", "/")).is_file():
            issues.append(ValidationIssue(
                code="OPTIONAL_TRACK_HANDLING", severity=OPTIONAL_MISSING_SEVERITY,
                message=f"Configured optional {label} track file is missing.",
                path=track.filePath))
    return issues


def validate_render_manifest(
    manifest: RenderManifest,
    *,
    project_dir: Path,
) -> ManifestValidationResult:
    issues: list[ValidationIssue] = []
    issues += validate_paths(manifest, project_dir)
    issues += validate_assets(manifest, project_dir)
    issues += validate_media_types(manifest, project_dir)
    issues += validate_durations(manifest, project_dir)
    issues += validate_timestamps(manifest, project_dir)
    issues += validate_overlaps(manifest, project_dir)
    issues += validate_gaps(manifest, project_dir)
    issues += validate_master_audio(manifest, project_dir)
    issues += validate_audio_alignment(manifest, project_dir)
    issues += validate_optional_tracks(manifest, project_dir)
    return ManifestValidationResult.from_issues(issues)
