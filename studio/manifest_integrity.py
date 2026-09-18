"""Phase 8 persisted-snapshot integrity: manifest hash + referenced bytes.

Reads ONLY the persisted render-manifest.json and files it references.
Never consults live Scene Plan / Visual Bible / Veo prompts / timestamps /
Asset Registry. Uses Phase 7 validation/hashing, no duplicate validators.
"""
from dataclasses import dataclass
from pathlib import Path

from studio.manifest_render_types import RenderFailureCode
from studio.render_manifest import RenderManifest
from studio.render_manifest_hashing import compute_manifest_hash, hash_file
from studio.render_manifest_validation import validate_render_manifest


class ManifestIntegrityError(RuntimeError):
    def __init__(self, code: RenderFailureCode, message: str):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class VerifiedRenderSnapshot:
    project_dir: Path
    export_dir: Path
    manifest_path: Path
    manifest: RenderManifest


def _sandboxed(project_dir: Path, rel: str) -> Path:
    """Resolve a manifest-relative path inside the project or raise."""
    clean = (rel or "").replace("\\", "/").strip()
    if not clean or clean.startswith("/") or clean.startswith(".."):
        raise ManifestIntegrityError(
            RenderFailureCode.INPUT_MISSING, f"unsafe manifest path: {rel!r}")
    first = clean.split("/")[0]
    if ":" in first or clean.startswith("//"):
        raise ManifestIntegrityError(
            RenderFailureCode.INPUT_MISSING, f"unsafe manifest path: {rel!r}")
    root = project_dir.resolve()
    target = (root / clean).resolve()
    try:
        target.relative_to(root)
    except ValueError:
        raise ManifestIntegrityError(
            RenderFailureCode.INPUT_MISSING, f"path escapes project: {rel!r}")
    if not target.is_file():
        raise ManifestIntegrityError(
            RenderFailureCode.INPUT_MISSING, f"referenced file missing: {rel!r}")
    try:
        with open(target, "rb") as f:
            f.read(1)
    except OSError:
        raise ManifestIntegrityError(
            RenderFailureCode.INPUT_CORRUPT, f"referenced file unreadable: {rel!r}")
    return target


def _check_bytes(target: Path, rel: str, want_checksum: str | None,
                 missing_code: RenderFailureCode,
                 corrupt_code: RenderFailureCode,
                 mismatch_code: RenderFailureCode) -> None:
    if want_checksum:
        try:
            actual = hash_file(target)
        except OSError:
            raise ManifestIntegrityError(corrupt_code, f"cannot hash: {rel!r}")
        if actual != want_checksum:
            raise ManifestIntegrityError(
                mismatch_code, f"checksum mismatch: {rel!r}")


def _verify_manifest_referenced_bytes(project_dir: Path, manifest: RenderManifest) -> None:
    for clip in manifest.videoTrack.clips:
        target = _sandboxed(project_dir, clip.filePath or "")
        _check_bytes(target, clip.filePath, clip.checksum or None,
                     RenderFailureCode.INPUT_MISSING, RenderFailureCode.INPUT_CORRUPT,
                     RenderFailureCode.INPUT_INTEGRITY_MISMATCH)
    voice = manifest.voiceTrack
    if voice.filePath:
        target = _sandboxed(project_dir, voice.filePath)
        _check_bytes(target, voice.filePath, voice.checksum or None,
                     RenderFailureCode.MASTER_AUDIO_MISSING,
                     RenderFailureCode.MASTER_AUDIO_CORRUPT,
                     RenderFailureCode.MASTER_AUDIO_CHECKSUM_MISMATCH)
    music = manifest.musicTrack
    if music.configured or music.filePath:
        if not music.filePath:
            raise ManifestIntegrityError(
                RenderFailureCode.MUSIC_INPUT_MISSING, "configured BGM has no file")
        target = _sandboxed(project_dir, music.filePath)
        _check_bytes(target, music.filePath, music.checksum or None,
                     RenderFailureCode.MUSIC_INPUT_MISSING,
                     RenderFailureCode.MUSIC_INPUT_CORRUPT,
                     RenderFailureCode.MUSIC_CHECKSUM_MISMATCH)
    subs = manifest.subtitlesTrack
    if subs.configured or subs.filePath:
        if not subs.filePath:
            raise ManifestIntegrityError(
                RenderFailureCode.SUBTITLE_INPUT_MISSING, "configured subtitle has no file")
        target = _sandboxed(project_dir, subs.filePath)
        _check_bytes(target, subs.filePath, subs.checksum or None,
                     RenderFailureCode.SUBTITLE_INPUT_MISSING,
                     RenderFailureCode.SUBTITLE_INPUT_CORRUPT,
                     RenderFailureCode.SUBTITLE_INPUT_CORRUPT)


def verify_render_snapshot(project_dir: Path, export_id: str) -> VerifiedRenderSnapshot:
    project_dir = Path(project_dir)
    export_dir = project_dir / "exports" / export_id
    manifest_path = export_dir / "render-manifest.json"
    if not manifest_path.is_file():
        raise ManifestIntegrityError(
            RenderFailureCode.INVALID_MANIFEST, "render-manifest.json is missing")

    try:
        manifest = RenderManifest.model_validate_json(
            manifest_path.read_text(encoding="utf-8"))
    except Exception as e:
        raise ManifestIntegrityError(
            RenderFailureCode.INVALID_MANIFEST, f"manifest unreadable: {e}") from e
    if manifest.exportId != export_id:
        raise ManifestIntegrityError(
            RenderFailureCode.INVALID_MANIFEST, "exportId does not match requested export")

    actual_hash = compute_manifest_hash(manifest.model_dump(mode="json"))
    if actual_hash != (manifest.manifestHash or ""):
        raise ManifestIntegrityError(
            RenderFailureCode.MANIFEST_HASH_MISMATCH, "manifestHash mismatch")

    validation = validate_render_manifest(manifest, project_dir=project_dir)
    if not validation.valid:
        first = validation.blockers[0]
        raise ManifestIntegrityError(
            RenderFailureCode.INVALID_MANIFEST,
            f"{first.code}: {first.message}")

    _verify_manifest_referenced_bytes(project_dir, manifest)

    return VerifiedRenderSnapshot(project_dir, export_dir, manifest_path, manifest)
