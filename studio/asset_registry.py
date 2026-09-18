"""
UnfoldIQ Asset Registry & Media Derivatives — Phase 4
Media, Asset & Export Pipeline.

- Stable asset identity (asset_id from intake ledger, never index/name).
- 3-tier relation: master -> proxy -> thumbnail (paths relative to project).
- JSON persistence (assets/registry.json) with atomic writes; lazy build
  from the intake ledger so legacy projects load without migration.
- Thumbnail: WebP 256x144 canvas, aspect preserved (scale+pad), ~15KB budget.
- Proxy: video-only 720p-max H.264 (libx264 default; NVENC never auto-used).
- Master preservation verified by SHA-256 before/after every job.
- Cache/idempotent: unchanged master checksum + valid derived file => skip.
- Failure isolation: tmp + verify + atomic rename; registry touched on success.
"""
from __future__ import annotations

import hashlib
import json
import logging
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, List, Optional

logger = logging.getLogger("unfoldiq.asset_registry")

REGISTRY_VERSION = 1
THUMB_CANVAS = (256, 144)
THUMB_QUALITY = 80
PROXY_MAX = (1280, 720)

_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp"}
_VIDEO_EXTS = {".mp4", ".mov", ".webm"}


def get_registry_path(project_dir: Path) -> Path:
    return Path(project_dir) / "assets" / "registry.json"


def get_derived_dir(project_dir: Path) -> Path:
    d = Path(project_dir) / "assets" / "derived"
    (d / "thumbs").mkdir(parents=True, exist_ok=True)
    (d / "proxies").mkdir(parents=True, exist_ok=True)
    return d


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


def load_registry(project_dir: Path) -> Dict[str, Any]:
    """Load registry; missing/corrupt => empty (legacy projects keep loading)."""
    rp = get_registry_path(project_dir)
    if rp.is_file():
        try:
            data = json.loads(rp.read_text(encoding="utf-8"))
            if isinstance(data, dict) and isinstance(data.get("assets"), list):
                data.setdefault("version", REGISTRY_VERSION)
                return data
        except Exception as e:
            logger.warning(f"Corrupt asset registry, treating as empty: {e}")
    return {"version": REGISTRY_VERSION, "assets": []}


def _save_atomic(project_dir: Path, data: Dict[str, Any]) -> None:
    rp = get_registry_path(project_dir)
    rp.parent.mkdir(parents=True, exist_ok=True)
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    fd, tmp = tempfile.mkstemp(dir=str(rp.parent), prefix="registry.", suffix=".tmp")
    try:
        with open(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        Path(tmp).replace(rp)
    except Exception:
        try:
            Path(tmp).unlink()
        except Exception:
            pass
        raise


def _media_type(master: Path, mime: Optional[str] = None) -> str:
    ext = master.suffix.lower()
    if ext in _IMAGE_EXTS:
        return "image"
    if ext in _VIDEO_EXTS:
        return "video"
    if ext in {".wav", ".mp3"} or (mime or "").startswith("audio"):
        return "audio"
    return "other"


def sync_from_intake_ledger(project_dir: Path) -> Dict[str, Any]:
    """Merge intake-ledger assets into the registry (lazy, idempotent).

    Unknown/legacy fields on existing registry entries are preserved;
    only intake-owned fields are refreshed. Never drops entries.
    """
    project_dir = Path(project_dir)
    reg = load_registry(project_dir)
    by_id = {a.get("asset_id"): a for a in reg["assets"] if a.get("asset_id")}
    ledger_p = project_dir / "assets" / "intake_ledger.json"
    entries: List[Dict[str, Any]] = []
    if ledger_p.is_file():
        try:
            entries = json.loads(ledger_p.read_text(encoding="utf-8")).get("assets", []) or []
        except Exception as e:
            logger.warning(f"Cannot read intake ledger: {e}")
    changed = False
    for e in entries:
        if not isinstance(e, dict) or not e.get("id"):
            continue
        aid = str(e["id"])
        cur = by_id.get(aid)
        master_rel = str(e.get("filePath") or "")
        if cur is None:
            by_id[aid] = {
                "asset_id": aid,
                "media_type": "image" if str(e.get("assetType") or "").lower() == "image" else (
                    "video" if str(e.get("assetType") or "").lower() == "video" else "other"),
                "master": master_rel,
                "proxy": None,
                "thumbnail": None,
                "checksum": e.get("checksum"),
                "lifecycle": e.get("lifecycle", "GENERATED"),
                "locked": bool(e.get("locked", False)),
                "scene_id": e.get("scene_id"),
                "shot_id": e.get("shot_id"),
                "derived_from_checksum": None,
            }
            changed = True
        else:
            for k, v in (("lifecycle", e.get("lifecycle")), ("locked", bool(e.get("locked", False))),
                         ("scene_id", e.get("scene_id")), ("shot_id", e.get("shot_id"))):
                if v is not None and cur.get(k) != v:
                    cur[k] = v
                    changed = True
            if master_rel and cur.get("master") != master_rel:
                # Master moved => derived files are stale; drop derived pointers.
                cur["master"] = master_rel
                cur["proxy"] = None
                cur["thumbnail"] = None
                cur["derived_from_checksum"] = None
                changed = True
    # Phase 4 §34: Visual Bible reference assets (assets/references/...) join
    # the same registry under their stable assetId so thumbnails can serve
    # them. Reference entries are NOT intake candidates, so they carry NO
    # intake lifecycle (GAP A: lifecycle must be explicit to govern; a
    # fabricated lifecycle would let bindings bypass it). Readiness stays in
    # `referenceStatus`; role resolution yields canonicalReference.
    # NOTE: reference entries merge in-memory only. Nothing is persisted on
    # read — the file is written solely by explicit derivative jobs or by
    # intake changes above (no auto-generated files from page loads).
    intake_changed = changed
    try:
        vb_p = project_dir / "visual_bible.json"
        if vb_p.is_file():
            vb = json.loads(vb_p.read_text(encoding="utf-8"))
            for ra in vb.get("referenceAssets", []) or []:
                if not isinstance(ra, dict) or not ra.get("assetId"):
                    continue
                aid = str(ra["assetId"])
                master_rel = str(ra.get("path") or "")
                if not master_rel or not (project_dir / master_rel).is_file():
                    continue
                if aid not in by_id:
                    by_id[aid] = {
                        "asset_id": aid,
                        "media_type": _media_type(project_dir / master_rel),
                        "master": master_rel,
                        "proxy": None,
                        "thumbnail": None,
                        "checksum": None,  # computed on first derivative job
                        "lifecycle": None,
                        "referenceStatus": str(ra.get("status") or ""),
                        "locked": False,
                        "scene_id": None,
                        "shot_id": None,
                        "entity_id": ra.get("entityId"),
                        "view": ra.get("view"),
                        "derived_from_checksum": None,
                    }
                    changed = True
    except Exception as e:
        logger.warning(f"Cannot sync reference assets: {e}")
    if intake_changed:
        reg["assets"] = list(by_id.values())
        _save_atomic(project_dir, reg)
    else:
        reg["assets"] = list(by_id.values())
    return reg


def get_asset(project_dir: Path, asset_id: str) -> Optional[Dict[str, Any]]:
    reg = sync_from_intake_ledger(project_dir)
    for a in reg["assets"]:
        if a.get("asset_id") == asset_id:
            return a
    return None


def _ffmpeg() -> str:
    from studio.config import config
    return config.ffmpeg_path


def _run(cmd: List[str], timeout: int) -> None:
    subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                   check=True, timeout=timeout)


def _master_verified(project_dir: Path, entry: Dict[str, Any]) -> Path:
    """Resolve master path and verify checksum stability (master preservation)."""
    master = (Path(project_dir) / str(entry.get("master") or "")).resolve()
    if not master.is_file():
        raise FileNotFoundError(f"Master file missing for asset {entry.get('asset_id')}")
    current = sha256_file(master)
    stored = entry.get("checksum")
    if stored and stored != current:
        # Master bytes changed out-of-band: refresh stored checksum, invalidate derived.
        entry["checksum"] = current
        entry["proxy"] = None
        entry["thumbnail"] = None
        entry["derived_from_checksum"] = None
    return master


def _derived_valid(project_dir: Path, rel: Optional[str], checksum: Optional[str]) -> bool:
    if not rel or not checksum:
        return False
    p = Path(project_dir) / rel
    return p.is_file() and p.stat().st_size > 0


def ensure_thumbnail(project_dir: Path, asset_id: str) -> Dict[str, Any]:
    """Ensure WebP 256x144 thumbnail. Audio/other => N/A (no fake derivatives)."""
    project_dir = Path(project_dir)
    reg = sync_from_intake_ledger(project_dir)
    entry = next((a for a in reg["assets"] if a.get("asset_id") == asset_id), None)
    if entry is None:
        raise KeyError(f"Unknown asset_id: {asset_id}")
    master = _master_verified(project_dir, entry)
    mtype = _media_type(master)
    if mtype not in ("image", "video"):
        return {"asset_id": asset_id, "thumbnail": None, "status": "N/A",
                "reason": f"media_type={mtype} has no visual thumbnail"}
    checksum = sha256_file(master)
    if (entry.get("derived_from_checksum") == checksum
            and _derived_valid(project_dir, entry.get("thumbnail"), checksum)):
        return {"asset_id": asset_id, "thumbnail": entry["thumbnail"],
                "status": "CACHED", "bytes": (project_dir / str(entry["thumbnail"])).stat().st_size}
    before = checksum
    derived = get_derived_dir(project_dir) / "thumbs"
    out = derived / f"{asset_id}_256x144.webp"
    vf = (f"scale={THUMB_CANVAS[0]}:{THUMB_CANVAS[1]}:force_original_aspect_ratio=decrease,"
          f"pad={THUMB_CANVAS[0]}:{THUMB_CANVAS[1]}:(ow-iw)/2:(oh-ih)/2,format=yuv420p")
    if mtype == "video":
        cmd = [_ffmpeg(), "-y", "-ss", "0.5", "-i", str(master), "-vframes", "1",
               "-vf", vf, "-q:v", str(THUMB_QUALITY), str(out)]
    else:
        cmd = [_ffmpeg(), "-y", "-i", str(master), "-vf", vf,
               "-q:v", str(THUMB_QUALITY), str(out)]
    tmp = out.with_suffix(".tmp.webp")
    try:
        _run([c for c in cmd[:-1]] + [str(tmp)], timeout=120)
        if not tmp.is_file() or tmp.stat().st_size == 0:
            raise RuntimeError("Thumbnail encoder produced no output")
        tmp.replace(out)
    finally:
        try:
            if tmp.is_file() and tmp != out:
                tmp.unlink()
        except Exception:
            pass
    if sha256_file(master) != before:
        raise RuntimeError("Master bytes changed during thumbnail generation")
    rel = str(out.relative_to(project_dir)).replace("\\", "/")
    entry["thumbnail"] = rel
    entry["checksum"] = before
    entry["derived_from_checksum"] = before
    entry["media_type"] = mtype
    _save_atomic(project_dir, reg)
    return {"asset_id": asset_id, "thumbnail": rel, "status": "GENERATED",
            "bytes": out.stat().st_size}


def ensure_proxy(project_dir: Path, asset_id: str,
                 encoder: str = "libx264") -> Dict[str, Any]:
    """Ensure 720p-max H.264 proxy for video. Images/audio => null per contract."""
    project_dir = Path(project_dir)
    reg = sync_from_intake_ledger(project_dir)
    entry = next((a for a in reg["assets"] if a.get("asset_id") == asset_id), None)
    if entry is None:
        raise KeyError(f"Unknown asset_id: {asset_id}")
    master = _master_verified(project_dir, entry)
    mtype = _media_type(master)
    if mtype != "video":
        return {"asset_id": asset_id, "proxy": None, "status": "N/A",
                "reason": f"media_type={mtype}: still images use thumbnail; audio has no video proxy"}
    if encoder not in ("libx264", "h264_nvenc"):
        raise ValueError(f"Unsupported proxy encoder: {encoder}")
    checksum = sha256_file(master)
    if (entry.get("derived_from_checksum") == checksum
            and _derived_valid(project_dir, entry.get("proxy"), checksum)):
        return {"asset_id": asset_id, "proxy": entry["proxy"],
                "status": "CACHED", "bytes": (project_dir / str(entry["proxy"])).stat().st_size}
    before = checksum
    derived = get_derived_dir(project_dir) / "proxies"
    out = derived / f"{asset_id}_720p.mp4"
    vf = (f"scale={PROXY_MAX[0]}:{PROXY_MAX[1]}:force_original_aspect_ratio=decrease")
    if encoder == "h264_nvenc":
        vcodec = ["-c:v", "h264_nvenc", "-preset", "p4", "-b:v", "4M"]
    else:
        vcodec = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23"]
    cmd = ([_ffmpeg(), "-y", "-i", str(master), "-vf", vf] + vcodec +
           ["-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k",
            "-movflags", "+faststart", str(out)])
    tmp = out.with_suffix(".tmp.mp4")
    try:
        _run(cmd[:-1] + [str(tmp)], timeout=600)
        if not tmp.is_file() or tmp.stat().st_size == 0:
            raise RuntimeError("Proxy encoder produced no output")
        tmp.replace(out)
    finally:
        try:
            if tmp.is_file() and tmp != out:
                tmp.unlink()
        except Exception:
            pass
    if sha256_file(master) != before:
        raise RuntimeError("Master bytes changed during proxy generation")
    rel = str(out.relative_to(project_dir)).replace("\\", "/")
    entry["proxy"] = rel
    entry["checksum"] = before
    entry["derived_from_checksum"] = before
    entry["media_type"] = mtype
    _save_atomic(project_dir, reg)
    return {"asset_id": asset_id, "proxy": rel, "status": "GENERATED",
            "bytes": out.stat().st_size, "encoder": encoder}


class AssetRegistry:
    """Thin facade preserving existing service-style usage."""

    def get_registry(self, project_dir: Path) -> Dict[str, Any]:
        return sync_from_intake_ledger(project_dir)


asset_registry = AssetRegistry()


# ---------------------------------------------------------------------------
# Phase 7: shared canonical asset-role resolver (Phase 4 semantics, reused).
# Precedence (micro-closure GAP A): an explicit intake lifecycle ALWAYS
# governs; a canonical binding NEVER bypasses it.
#   REJECTED (+binding) -> rejected (never accepted, never fallback)
#   SELECTED/GENERATED (+binding) -> unapproved
#   LOCKED/APPROVED -> accepted
#   NO lifecycle + valid binding -> canonicalReference
# ---------------------------------------------------------------------------

from dataclasses import dataclass


@dataclass(frozen=True)
class AssetResolution:
    role: str
    asset_id: str | None
    accepted_version: int | str | None
    checksum: str | None
    file_path: str | None
    entity_id: str | None = None
    view: str | None = None


_ACCEPTED_LIFECYCLES = frozenset({"LOCKED", "APPROVED"})


def resolve_asset_role(
    *,
    registry_entry: Dict[str, Any] | None = None,
    intake_entry: Dict[str, Any] | None = None,
    canonical_binding: Dict[str, Any] | None = None,
) -> AssetResolution:
    """Single shared resolver. Canonical binding never bypasses lifecycle."""
    entry: Dict[str, Any] = dict(registry_entry or {})
    if intake_entry:
        merged = dict(intake_entry)
        merged.update({k: v for k, v in entry.items() if v is not None})
        entry = merged
    lc = str(entry.get("lifecycle") or "").strip().upper()
    binding_entity = (canonical_binding or {}).get("entity_id") or entry.get("entity_id")
    if lc:
        # Explicit lifecycle governs, with or without a binding.
        if lc == "REJECTED":
            role = "rejected"
        elif lc in _ACCEPTED_LIFECYCLES:
            role = "accepted"
        else:
            role = "unapproved"
        return AssetResolution(
            role=role,
            asset_id=entry.get("asset_id"),
            accepted_version=entry.get("accepted_version") or entry.get("version"),
            checksum=entry.get("checksum"),
            file_path=entry.get("master") or entry.get("filePath"),
            entity_id=entry.get("entity_id") or binding_entity,
            view=entry.get("view"),
        )
    if binding_entity:
        return AssetResolution(
            role="canonicalReference",
            asset_id=entry.get("asset_id"),
            accepted_version=entry.get("accepted_version") or entry.get("version"),
            checksum=entry.get("checksum"),
            file_path=entry.get("master") or entry.get("filePath"),
            entity_id=binding_entity,
            view=entry.get("view"),
        )
    return AssetResolution(
        role="unapproved",
        asset_id=entry.get("asset_id"),
        accepted_version=entry.get("accepted_version") or entry.get("version"),
        checksum=entry.get("checksum"),
        file_path=entry.get("master") or entry.get("filePath"),
        entity_id=None,
        view=entry.get("view"),
    )
