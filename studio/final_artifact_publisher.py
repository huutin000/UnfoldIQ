"""Phase 8 no-replace publisher: candidate sanity, atomic publish, provenance.

Windows os.rename is atomic no-replace on the same volume; POSIX uses
hard-link creation as the atomic no-replace primitive. Same-filesystem is
proven before either path; no copy+delete canonical publish.
"""
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from studio.manifest_render_types import RenderFailureCode


class AlreadyRenderedError(RuntimeError):
    def __init__(self, dst: Path):
        super().__init__(f"canonical Final already exists: {dst}")
        self.code = RenderFailureCode.ALREADY_RENDERED


class PublishError(RuntimeError):
    def __init__(self, code: RenderFailureCode, message: str):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class PublishResult:
    final_path: Path
    metadata_path: Path
    reused: bool = False


def _same_filesystem(src: Path, dst_dir: Path) -> bool:
    try:
        if os.name == "nt":
            import ctypes
            GetVolumePathName = ctypes.windll.kernel32.GetVolumePathNameW
            a = ctypes.create_unicode_buffer(260)
            b = ctypes.create_unicode_buffer(260)
            GetVolumePathName(str(src.resolve()), a, 260)
            GetVolumePathName(str(dst_dir.resolve()), b, 260)
            return a.value.lower() == b.value.lower()
        return os.stat(src.resolve()).st_dev == os.stat(dst_dir.resolve()).st_dev
    except OSError:
        return False


def _publish_no_replace(src: Path, dst: Path) -> None:
    if dst.exists():
        raise AlreadyRenderedError(dst)
    if os.name == "nt":
        try:
            os.rename(src, dst)
        except FileExistsError:
            raise AlreadyRenderedError(dst)
        except OSError as e:
            # Cross-volume rename is not atomic: refuse, never copy+delete.
            raise PublishError(RenderFailureCode.ATOMIC_PUBLISH_FAILED,
                               f"no-replace publish failed: {e}")
    else:
        try:
            os.link(src, dst)
        except FileExistsError:
            raise AlreadyRenderedError(dst)
        os.unlink(src)


def _sidecar_payload(provenance: dict) -> dict:
    job_id = provenance.get("jobId") or provenance.get("renderJobId")
    expected_frames = (provenance.get("expectedFrames")
                       if provenance.get("expectedFrames") is not None
                       else provenance.get("expectedFinalFrames"))
    attempts = provenance.get("attemptHistory") or provenance.get("attemptSummary", [])
    payload = {
        "jobId": job_id,
        "projectId": provenance.get("projectId"),
        "exportId": provenance.get("exportId"),
        "manifestHash": provenance.get("manifestHash"),
        "renderJobId": job_id,
        "renderEngine": "ffmpeg",
        "ffmpegVersion": provenance.get("ffmpegVersion"),
        "encoderProfileRequested": provenance.get("encoderProfileRequested"),
        "encoderActuallyUsed": provenance.get("encoderActuallyUsed"),
        "encoderProfileVersion": provenance.get("encoderProfileVersion"),
        "fallbackAttempted": bool(provenance.get("fallbackAttempted", False)),
        "attemptHistory": attempts,
        "attemptSummary": attempts,
        "expectedFrames": expected_frames,
        "expectedFinalFrames": expected_frames,
        "fps": "24/1",
        "resolution": "1920x1080",
        "pixelFormat": "yuv420p",
        "audioCodec": "aac",
        "audioBitrateTarget": "192k",
        "audioSampleRate": 48000,
        "audioChannels": 2,
        "subtitleMode": provenance.get("subtitleMode", "none"),
        "subtitleCodec": provenance.get("subtitleCodec"),
        "duckingPreset": provenance.get("duckingPreset"),
        "completedAt": provenance.get("completedAt")
        or datetime.now(timezone.utc).isoformat(),
    }
    return payload


def _write_sidecar(export_dir: Path, provenance: dict) -> Path:
    import json
    import uuid
    meta_path = export_dir / "render-metadata.json"
    if meta_path.exists():
        return meta_path
    tmp = export_dir / f"render-metadata.json.tmp.{os.getpid()}.{uuid.uuid4().hex[:8]}"
    content = json.dumps(_sidecar_payload(provenance), indent=2, ensure_ascii=False) + "\n"
    try:
        with open(tmp, "w", encoding="utf-8", newline="\n") as f:
            f.write(content)
            f.flush()
            try:
                os.fsync(f.fileno())
            except OSError:
                pass
        tmp.replace(meta_path)
    except Exception:
        if tmp.exists():
            try:
                tmp.unlink()
            except OSError:
                pass
        raise
    return meta_path


def publish_candidate(candidate_path: Path, export_dir: Path, provenance: dict,
                       cancel_requested: bool = False) -> PublishResult:
    """Sanity-check, no-replace publish, then provenance sidecar."""
    candidate = Path(candidate_path)
    export_dir = Path(export_dir)
    if cancel_requested:
        raise PublishError(RenderFailureCode.CANCELLED,
                           "cancellation persisted before publish")
    if not candidate.is_file():
        raise PublishError(RenderFailureCode.OUTPUT_CANDIDATE_MISSING,
                           f"candidate missing: {candidate}")
    try:
        if candidate.stat().st_size <= 0:
            raise PublishError(RenderFailureCode.OUTPUT_CANDIDATE_EMPTY,
                               "candidate is empty")
    except OSError:
        raise PublishError(RenderFailureCode.OUTPUT_CANDIDATE_MISSING,
                           f"candidate unreadable: {candidate}")
    final_path = export_dir / "final.mp4"
    if final_path.exists():
        raise AlreadyRenderedError(final_path)
    if not _same_filesystem(candidate, export_dir):
        raise PublishError(RenderFailureCode.ATOMIC_PUBLISH_FAILED,
                           "candidate and export are on different filesystems")
    _publish_no_replace(candidate, final_path)
    meta_path = _write_sidecar(export_dir, provenance)
    return PublishResult(final_path=final_path, metadata_path=meta_path)


def repair_missing_metadata(export_dir: Path, provenance: dict) -> bool:
    """Create the sidecar only when Final exists and lineage matches.

    Never replaces an existing Final or an existing sidecar. Returns True
    when a sidecar was created.
    """
    export_dir = Path(export_dir)
    if not (export_dir / "final.mp4").is_file():
        return False
    meta_path = export_dir / "render-metadata.json"
    if meta_path.exists():
        return False
    try:
        import json
        prov = dict(provenance)
        if prov.get("exportId") and prov["exportId"] != export_dir.name:
            return False
        prov.setdefault("exportId", export_dir.name)
        _write_sidecar(export_dir, prov)
        return True
    except OSError:
        return False
