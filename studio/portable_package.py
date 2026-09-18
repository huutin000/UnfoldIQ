"""
UnfoldIQ Portable Production Package — Phase 4.
Media, Asset & Export Pipeline.

Builds a self-contained ZIP with 10 canonical component groups plus a
PACKAGE INVENTORY manifest.json (packageSchemaVersion "1.0").

This manifest is NOT the Phase 7 render-manifest.json: it carries no
frame-accurate timeline, no FFmpeg filtergraph, no render instructions —
only file inventory (relative paths, sizes, checksums, roles).

Accepted-version rule: where lifecycle exists (intake assets), prefer
LOCKED > APPROVED > SELECTED > GENERATED; static artifacts use the current
canonical project files (no invented versions). Missing REQUIRED group =>
blocker (no partial package). Missing optional group => skipped + noted.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import logging
import re
import shutil
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple

logger = logging.getLogger("unfoldiq.portable_package")

PACKAGE_SCHEMA_VERSION = "1.0"

# Forbidden in packages: secrets, DBs, backups, logs, temp, weights.
_FORBIDDEN_NAMES = (".env", "state.db")
_FORBIDDEN_SUFFIXES = (".bak", ".log", ".tmp", ".pt", ".bin", ".ckpt", ".onnx")


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


# ---------------------------------------------------------------------------
# VTT: deterministic SRT -> WebVTT (timing/content preserved, SRT untouched)
# ---------------------------------------------------------------------------

_SRT_CUE_RE = re.compile(
    r"^\s*(\d+)\s*\r?\n"
    r"(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})[^\r\n]*\r?\n"
    r"((?:(?!\r?\n\r?\n).)*)",
    re.M | re.S,
)


def _srt_ts_to_vtt(ts: str) -> str:
    return ts.replace(",", ".")


def _ts_to_seconds(ts: str) -> float:
    h, m, rest = ts.split(":")
    s = rest.replace(",", ".")
    return int(h) * 3600 + int(m) * 60 + float(s)


def srt_to_vtt(srt_text: str) -> Tuple[str, Dict[str, Any]]:
    """Convert SRT to WebVTT. Returns (vtt_text, stats). Raises on bad cues."""
    cues = []
    for m in _SRT_CUE_RE.finditer(srt_text):
        num, start, end, body = m.group(1), m.group(2), m.group(3), m.group(4).strip()
        s_sec, e_sec = _ts_to_seconds(start), _ts_to_seconds(end)
        if s_sec < 0 or e_sec < 0:
            raise ValueError(f"VTT: negative timestamp in cue {num}")
        if e_sec <= s_sec:
            raise ValueError(f"VTT: inverted duration in cue {num}")
        text = "\n".join(line for line in body.splitlines() if line.strip())
        cues.append({"num": int(num), "start": _srt_ts_to_vtt(start),
                     "end": _srt_ts_to_vtt(end), "text": text})
    if not cues:
        raise ValueError("VTT: no cues parsed from SRT")
    starts = [c["start"] for c in cues]
    if starts != sorted(starts):
        raise ValueError("VTT: cues out of order")
    out = ["WEBVTT", ""]
    for c in cues:
        out += [str(c["num"]), f"{c['start']} --> {c['end']}", c["text"], ""]
    stats = {"cues": len(cues), "first_start": cues[0]["start"],
             "last_end": cues[-1]["end"]}
    return "\n".join(out), stats


# ---------------------------------------------------------------------------
# Shots CSV / JSON (stable IDs, same shot set in both)
# ---------------------------------------------------------------------------

def _load_json(path: Path) -> Optional[Dict[str, Any]]:
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def build_shots_payload(project_dir: Path) -> List[Dict[str, Any]]:
    project_dir = Path(project_dir)
    veo = _load_json(project_dir / "veo_prompts.json") or {}
    shots = veo.get("shots", []) or []
    vp_entries = {}
    vp = _load_json(project_dir / "visual_prompts.json") or {}
    for e in vp.get("entries", []) or []:
        if isinstance(e, dict) and e.get("sceneId"):
            vp_entries[e["sceneId"]] = e
    rows = []
    for s in shots:
        if not isinstance(s, dict) or not s.get("shot_id"):
            continue
        scene_id = s.get("parent_scene_id") or s.get("scene_id") or ""
        vp = vp_entries.get(scene_id, {})
        rows.append({
            "shot_id": s.get("shot_id"),
            "scene_id": scene_id,
            "index": s.get("index"),
            "start": s.get("start"),
            "end": s.get("end"),
            "duration": s.get("duration"),
            "category": s.get("category"),
            "route": None,  # resolved below when visual metadata exists
            "visual_type": vp.get("visualType"),
            "recommended_output_type": vp.get("recommendedOutputType"),
            "subject_ids": s.get("subjectIds") or s.get("subject_ids") or [],
            "environment_id": s.get("environmentId") or s.get("environment_id"),
            "prop_ids": s.get("propIds") or s.get("prop_ids") or [],
            "status": s.get("status"),
            "outdated": bool(s.get("outdated", False)),
            "is_locked": None,  # lock lives in state.db; not duplicated here
        })
    try:
        from studio.visual_router import VisualRouter

        class _S:
            pass
        for r, s in zip(rows, [x for x in shots if isinstance(x, dict) and x.get("shot_id")]):
            o = _S()
            o.shot_id = r["shot_id"]
            o.parent_scene_id = r["scene_id"]
            o.category = s.get("category", "")
            r["route"] = VisualRouter.route(o, vp_entries.get(r["scene_id"]))["route"]
    except Exception as e:
        logger.warning(f"Shot route enrichment skipped: {e}")
    return rows


def shots_to_csv(rows: List[Dict[str, Any]]) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["shot_id", "scene_id", "index", "start", "end", "duration",
                "category", "route", "visual_type", "recommended_output_type",
                "subject_ids", "environment_id", "prop_ids", "status", "outdated"])
    for r in rows:
        w.writerow([r.get("shot_id"), r.get("scene_id"), r.get("index"),
                    r.get("start"), r.get("end"), r.get("duration"),
                    r.get("category"), r.get("route"), r.get("visual_type"),
                    r.get("recommended_output_type"),
                    ";".join(r.get("subject_ids") or []), r.get("environment_id"),
                    ";".join(r.get("prop_ids") or []), r.get("status"),
                    r.get("outdated")])
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Asset manifest (registry-derived, no dangling paths)
# ---------------------------------------------------------------------------

# Canonical accepted lifecycles for intake candidates. SELECTED/GENERATED are
# NOT accepted (selection != approval); REJECTED is never packaged.
_ACCEPTED_LIFECYCLES = frozenset({"LOCKED", "APPROVED"})


def resolve_asset_role(item: Dict[str, Any]) -> str:
    """Truthful source role for one registry item (never fakes acceptance).

    Delegates to the shared Phase 7 resolver: an explicit lifecycle always
    governs (REJECTED->rejected, LOCKED/APPROVED->accepted, else unapproved);
    a canonical binding applies only when no lifecycle is recorded.
    """
    from studio.asset_registry import resolve_asset_role as _shared
    return _shared(registry_entry=item).role


def build_asset_manifest(project_dir: Path) -> Dict[str, Any]:
    from studio.asset_registry import sync_from_intake_ledger
    project_dir = Path(project_dir)
    reg = sync_from_intake_ledger(project_dir)
    items = []
    for a in reg.get("assets", []):
        for key in ("master", "proxy", "thumbnail"):
            rel = a.get(key)
            if rel and not (project_dir / rel).is_file():
                raise ValueError(f"Asset manifest: dangling {key} for {a.get('asset_id')}: {rel}")
        items.append({
            "asset_id": a.get("asset_id"),
            "media_type": a.get("media_type"),
            "master": a.get("master"),
            "proxy": a.get("proxy"),
            "thumbnail": a.get("thumbnail"),
            "checksum": a.get("checksum"),
            "lifecycle": a.get("lifecycle"),
            "sourceRole": resolve_asset_role(a),
            "entity_id": a.get("entity_id"),
            "view": a.get("view"),
            "locked": bool(a.get("locked", False)),
            "scene_id": a.get("scene_id"),
            "shot_id": a.get("shot_id"),
        })
    return {"assetManifestVersion": "1.0", "assets": items}


# ---------------------------------------------------------------------------
# Package builder
# ---------------------------------------------------------------------------

# (archive rel dir, project rel source, required?)
_PACKAGE_STATIC = (
    ("audio", "audio.wav", True),
    ("subtitles", "timestamps.srt", True),
    ("script", "script.txt", True),
    ("script", "script.json", True),
    ("visual", "visual_bible.json", True),
    ("visual", "image_prompts.json", True),
    ("visual", "veo_prompts.json", True),
    ("audio", "audio.mp3", False),
    ("video", "renders/final/final.mp4", False),
    ("video", "renders/draft/draft_preview.mp4", False),
)


def _forbidden(rel: str) -> bool:
    low = rel.lower().replace("\\", "/")
    if ".." in low.split("/"):
        return True
    name = low.rsplit("/", 1)[-1]
    if name in _FORBIDDEN_NAMES or name.endswith(_FORBIDDEN_SUFFIXES):
        return True
    return False


def build_portable_package(project_dir: Path, out_dir: Optional[Path] = None,
                         strict_media: bool = False) -> Dict[str, Any]:
    """Build the portable ZIP. Returns {zip_path, manifest, warnings}.

    Raises ValueError (blocker) when a REQUIRED group is missing.
    Intake media rule: only "accepted" (LOCKED/APPROVED) and
    "canonicalReference" (Visual Bible bindings) masters are packaged.
    SELECTED/GENERATED are omitted with a warning (strict_media=True turns
    them into a blocker); REJECTED is never packaged and never falls back.
    """
    project_dir = Path(project_dir)
    stage = Path(tempfile.mkdtemp(prefix="unfoldiq_pkg_"))
    try:
        root = stage / "unfoldiq-package"
        inventory: List[Dict[str, Any]] = []
        warnings: List[str] = []

        def _add_bytes(rel: str, data: bytes, role: str, media_type: str) -> None:
            if _forbidden(rel):
                raise ValueError(f"Refusing forbidden package path: {rel}")
            dest = root / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(data)
            inventory.append({"relative_path": rel, "size_bytes": len(data),
                              "sha256": hashlib.sha256(data).hexdigest(),
                              "role": role, "media_type": media_type})

        def _add_file(arc_dir: str, proj_rel: str, required: bool, role: str) -> None:
            src = project_dir / proj_rel
            arc = f"{arc_dir}/{Path(proj_rel).name}"
            if not src.is_file():
                if required:
                    raise ValueError(f"Portable package blocked: missing required {proj_rel}")
                warnings.append(f"Skipped optional missing: {proj_rel}")
                return
            _add_bytes(arc, src.read_bytes(), role, "application/octet-stream")

        # 1-2. audio + subtitles
        _add_file("audio", "audio.wav", True, "master-audio")
        _add_file("audio", "audio.mp3", False, "audio")
        _add_file("subtitles", "timestamps.srt", True, "subtitle")
        # 3. VTT (deterministic from canonical SRT; SRT untouched)
        srt_text = (project_dir / "timestamps.srt").read_text(encoding="utf-8", errors="replace")
        vtt_text, vtt_stats = srt_to_vtt(srt_text)
        _add_bytes("subtitles/timestamps.vtt", vtt_text.encode("utf-8"), "subtitle", "text/vtt")
        # 4. script
        _add_file("script", "script.txt", True, "script")
        _add_file("script", "script.json", True, "script")
        # 5. shots CSV/JSON (same stable-ID set)
        rows = build_shots_payload(project_dir)
        if not rows:
            raise ValueError("Portable package blocked: zero shots in veo_prompts.json")
        _add_bytes("shots/shots.json", json.dumps(rows, indent=2, ensure_ascii=False).encode("utf-8"),
                   "shots", "application/json")
        _add_bytes("shots/shots.csv", shots_to_csv(rows).encode("utf-8"), "shots", "text/csv")
        # 6-7. visual bible + prompts
        _add_file("visual", "visual_bible.json", True, "visual-bible")
        _add_file("visual", "image_prompts.json", True, "image-prompts")
        _add_file("visual", "veo_prompts.json", True, "motion-prompts")
        # 8-9. asset manifest + media (accepted/canonical only — never
        # silent-package SELECTED/GENERATED/REJECTED as accepted).
        asset_manifest = build_asset_manifest(project_dir)
        _add_bytes("assets/asset_manifest.json",
                   json.dumps(asset_manifest, indent=2, ensure_ascii=False).encode("utf-8"),
                   "asset-manifest", "application/json")
        if strict_media:
            pending = [a["asset_id"] for a in asset_manifest["assets"]
                       if resolve_asset_role(a) == "unapproved"]
            if pending:
                raise ValueError(
                    "Chưa thể tạo gói sản xuất vì còn tài nguyên chưa được duyệt: "
                    + ", ".join(pending[:5]) + ("..." if len(pending) > 5 else ""))
        media_count = 0
        for a in asset_manifest["assets"]:
            role = resolve_asset_role(a)
            if role == "rejected":
                continue  # never packaged, no fallback
            if role == "unapproved":
                warnings.append(
                    f"Tài nguyên {a.get('asset_id')} chưa được duyệt nên không đưa vào gói.")
                continue
            for key in ("master", "proxy", "thumbnail"):
                rel = a.get(key)
                if rel and (project_dir / rel).is_file():
                    data = (project_dir / rel).read_bytes()
                    _add_bytes(f"assets/media/{Path(rel).name}", data, f"asset-{key}",
                               "application/octet-stream")
                    media_count += 1
        # 10. renders if present (optional)
        _add_file("video", "renders/final/final.mp4", False, "video")
        _add_file("video", "renders/draft/draft_preview.mp4", False, "video")

        manifest = {
            "packageSchemaVersion": PACKAGE_SCHEMA_VERSION,
            "packageKind": "unfoldiq-portable-production-package",
            "project_id": project_dir.name,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "files": sorted(inventory, key=lambda x: x["relative_path"]),
            "vtt": vtt_stats,
            "shotCount": len(rows),
            "assetCount": len(asset_manifest["assets"]),
            "warnings": warnings,
        }
        _add_bytes("manifest.json",
                   json.dumps(manifest, indent=2, ensure_ascii=False).encode("utf-8"),
                   "package-manifest", "application/json")

        # Verify: re-read zip inventory (no dangling, no absolute, no forbidden).
        for f in manifest["files"]:
            rp = f["relative_path"]
            if rp.startswith("/") or ".." in rp.split("/") or _forbidden(rp):
                raise ValueError(f"Unsafe package path: {rp}")
            if not (root / rp).is_file():
                raise ValueError(f"Dangling package entry: {rp}")

        out_root = Path(out_dir) if out_dir else (project_dir / "exports" / "portable")
        out_root.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        zip_path = out_root / f"{project_dir.name}_portable_{stamp}.zip"
        tmp_zip = zip_path.with_suffix(".tmp.zip")
        with zipfile.ZipFile(tmp_zip, "w", zipfile.ZIP_DEFLATED) as zf:
            for fp in sorted(root.rglob("*")):
                if fp.is_file():
                    zf.write(fp, fp.relative_to(root).as_posix())
        # Verify zip opens + manifest readable + checksums match.
        with zipfile.ZipFile(tmp_zip, "r") as zf:
            names = zf.namelist()
            assert "manifest.json" in names
            assert not any(n.startswith("/") or ".." in n.split("/") for n in names)
            mf = json.loads(zf.read("manifest.json").decode("utf-8"))
            assert mf.get("packageSchemaVersion") == PACKAGE_SCHEMA_VERSION
            for f in mf["files"]:
                data = zf.read(f["relative_path"])
                assert hashlib.sha256(data).hexdigest() == f["sha256"], \
                    f"checksum mismatch: {f['relative_path']}"
        tmp_zip.replace(zip_path)
        return {"zip_path": str(zip_path), "bytes": zip_path.stat().st_size,
                "files": len(manifest["files"]), "warnings": warnings,
                "vtt_cues": vtt_stats["cues"], "shots": len(rows)}
    finally:
        shutil.rmtree(stage, ignore_errors=True)
