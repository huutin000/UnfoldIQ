"""
UnfoldIQ Phase 11 — Production Export / Flow Handoff.

Reads canonical project artifacts and packages an immutable, self-contained
production snapshot under projects/<projectId>/exports/<exportId>/ for the
manual workflow: Google Flow / Veo -> downloaded MP4 -> CapCut.

Non-goals: no video generation, no Veo/Flow API, no CapCut automation.
No LLM, no cloud SDK. Standard library only.
"""

import csv
import hashlib
import json
import logging
import os
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from studio.config import PROJECTS_DIR
from studio.scene_planner import compute_file_sha256

logger = logging.getLogger("unfoldiq.production_export")

SCHEMA_VERSION = "1.0.0"
EXPORTER_VERSION = "11.0.0"

EXPORT_ID_PATTERN = re.compile(r"^export_\d{3}$")
_SCENE_NUM_PATTERN = re.compile(r"^scene_(\d+)$", re.IGNORECASE)
_INVALID_FILENAME_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_TIMELINE_TOLERANCE = 0.005
_COVERAGE_TOLERANCE = 0.05


class ProductionExportError(Exception):
    """Raised when a production export is blocked or fails."""

    def __init__(self, message: str, blockers: Optional[List[str]] = None):
        super().__init__(message)
        self.blockers = blockers or [message]


# ---------------------------------------------------------------------------
# Path safety
# ---------------------------------------------------------------------------

def validate_project_id(project_id: str) -> str:
    if not project_id or not isinstance(project_id, str):
        raise ProductionExportError("Invalid project id: empty.")
    clean = project_id.strip()
    if not clean or ".." in clean or "/" in clean or "\\" in clean:
        raise ProductionExportError(f"Invalid project id (path traversal): {project_id!r}")
    if _INVALID_FILENAME_CHARS.search(clean):
        raise ProductionExportError(f"Invalid project id (illegal filename chars): {project_id!r}")
    return clean


def validate_export_id(export_id: str) -> str:
    if not export_id or not isinstance(export_id, str):
        raise ProductionExportError("Invalid export id: empty.")
    clean = export_id.strip()
    if not EXPORT_ID_PATTERN.match(clean):
        raise ProductionExportError(f"Invalid export id (expected export_NNN): {export_id!r}")
    return clean


def _resolve_project_dir(project_id: str) -> Path:
    clean = validate_project_id(project_id)
    canonical_root = PROJECTS_DIR.resolve()
    target = (PROJECTS_DIR / clean).resolve()
    if not target.is_dir():
        raise ProductionExportError(f"Project directory not found: {clean}")
    try:
        if target.parent != canonical_root:
            raise ProductionExportError("Invalid project directory: outside projects root.")
    except ProductionExportError:
        raise
    except Exception:
        raise ProductionExportError("Invalid project directory.")
    return target


# ---------------------------------------------------------------------------
# Loading helpers
# ---------------------------------------------------------------------------

def _load_json(path: Path) -> Optional[Dict[str, Any]]:
    if not path.is_file():
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else None
    except Exception as e:
        raise ProductionExportError(f"Corrupted JSON artifact: {path.name}: {e}")


def _file_hash(path: Path) -> Optional[str]:
    if not path.is_file():
        return None
    return compute_file_sha256(path)


def collect_source_hashes(project_dir: Path) -> Dict[str, Optional[str]]:
    """SHA-256 snapshot of canonical inputs (never Python hash())."""
    return {
        "scriptHash": _file_hash(project_dir / "script.txt"),
        "audioHash": _file_hash(project_dir / "audio.wav"),
        "timestampsHash": _file_hash(project_dir / "timestamps.json"),
        "scenePlanHash": _file_hash(project_dir / "scene_plan.json"),
        "visualBibleHash": _file_hash(project_dir / "visual_bible.json"),
        "veoPromptsHash": _file_hash(project_dir / "veo_prompts.json"),
        "narrationPlanHash": _file_hash(project_dir / "narration_plan.json"),
        "voiceQaHash": _file_hash(project_dir / "voice_qa.json"),
    }


# ---------------------------------------------------------------------------
# Shot normalization
# ---------------------------------------------------------------------------

def _first_present(shot: Dict[str, Any], *keys: str, default: Any = None) -> Any:
    for k in keys:
        v = shot.get(k)
        if v is not None and v != "":
            return v
    return default


def _as_float(v: Any, default: float = 0.0) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def _as_int(v: Any, default: int = 1) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def normalize_shot(raw: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize one canonical shot (tolerates legacy/camelCase key variants)."""
    shot_id = str(_first_present(raw, "shot_id", "shotId", default="")).strip()
    parent_scene_id = str(
        _first_present(raw, "parent_scene_id", "parentSceneId", "scene_id", "sceneId", default="")
    ).strip()
    shot_index = _as_int(_first_present(raw, "scene_shot_index", "shotIndex", "index", default=1))
    start = _as_float(_first_present(raw, "start", "startTime", default=0.0))
    end = _as_float(_first_present(raw, "end", "endTime", default=0.0))
    duration = _as_float(_first_present(raw, "duration", default=end - start))
    purpose = str(_first_present(raw, "shotPurpose", "shot_purpose", "purpose", default="")).strip().upper()
    prompt = str(_first_present(raw, "veo_prompt", "prompt", default="")).strip()
    narration = str(_first_present(raw, "narration", default="")).strip()
    continuity_group = _first_present(raw, "continuity_group", "continuityGroupId", default=None)
    subjects = _first_present(raw, "subjectIds", "subject_ids", default=[]) or []
    env_id = _first_present(raw, "environmentId", "environment_id", default=None)
    period_id = _first_present(raw, "periodId", "period_id", default=None)
    props = _first_present(raw, "propIds", "prop_ids", default=[]) or []
    status = str(_first_present(raw, "status", default="generated")).strip()
    outdated = bool(raw.get("outdated", False))
    if isinstance(subjects, str):
        subjects = [subjects]
    if isinstance(props, str):
        props = [props]
    return {
        "shotId": shot_id,
        "parentSceneId": parent_scene_id,
        "shotIndex": shot_index,
        "startTime": start,
        "endTime": end,
        "duration": duration,
        "shotPurpose": purpose or "CONTINUATION",
        "prompt": prompt,
        "narration": narration,
        "continuityGroupId": continuity_group,
        "subjectIds": list(subjects),
        "environmentId": env_id,
        "periodId": period_id,
        "propIds": list(props),
        "status": status,
        "outdated": outdated,
    }


def expected_filename_for(parent_scene_id: str, shot_index: int) -> str:
    """Deterministic stable MP4 filename: scene_001_shot_01.mp4."""
    m = _SCENE_NUM_PATTERN.match(parent_scene_id or "")
    if m:
        scene_num = int(m.group(1))
        name = f"scene_{scene_num:03d}_shot_{int(shot_index):02d}.mp4"
    else:
        safe_scene = re.sub(r"[^A-Za-z0-9_\-]", "_", parent_scene_id or "scene")
        name = f"{safe_scene}_shot_{int(shot_index):02d}.mp4"
    if _INVALID_FILENAME_CHARS.search(name):
        raise ProductionExportError(f"Unsafe generated filename: {name!r}")
    return name


def sort_shots(shots: List[Dict[str, Any]], scene_order: List[str]) -> List[Dict[str, Any]]:
    order = {sid: i for i, sid in enumerate(scene_order)}
    return sorted(
        shots,
        key=lambda s: (order.get(s["parentSceneId"], 10 ** 9), s["startTime"], s["shotIndex"], s["shotId"]),
    )


# ---------------------------------------------------------------------------
# Voice QA gate
# ---------------------------------------------------------------------------

def check_voice_qa_for_export(project_dir: Path) -> Tuple[bool, str, Dict[str, Any]]:
    """PASS or fully accepted/waived REVIEW passes; anything unresolved blocks."""
    qa_path = project_dir / "voice_qa.json"
    if not qa_path.is_file():
        return False, "Missing voice_qa.json. Run Voice QA first.", {"status": "EMPTY"}
    try:
        with open(qa_path, "r", encoding="utf-8") as f:
            qa = json.load(f)
    except Exception as e:
        return False, f"Corrupted voice_qa.json: {e}", {"status": "ERROR"}
    audio_hash = _file_hash(project_dir / "audio.wav")
    if audio_hash and qa.get("audio_sha256") and qa.get("audio_sha256") != audio_hash:
        return False, "Voice QA is OUTDATED (audio.wav changed). Re-run Voice QA.", {"status": "OUTDATED"}
    unresolved_fail = 0
    unresolved_review = 0
    for iss in qa.get("issues", []) or []:
        if iss.get("resolution") in ("accepted", "waived") or iss.get("decision") in ("accepted", "waived"):
            continue
        if iss.get("severity") == "fail":
            unresolved_fail += 1
        elif iss.get("severity") == "review":
            unresolved_review += 1
    summary = qa.get("summary", {}) or {}
    unresolved_fail = int(summary.get("unresolved_fail_count", unresolved_fail))
    unresolved_review = int(summary.get("unresolved_review_count", unresolved_review))
    info = {"status": str(qa.get("status", "review")).upper(),
            "unresolved_fail": unresolved_fail, "unresolved_review": unresolved_review}
    if unresolved_fail > 0:
        return False, f"Voice QA FAIL: {unresolved_fail} unresolved fail issue(s).", info
    if unresolved_review > 0:
        return False, (f"Voice QA REVIEW: {unresolved_review} open review issue(s). "
                       "Accept or waive them in Voice QA first."), info
    return True, "PASS" if info["status"] == "PASS" else "Accepted REVIEW", info


# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------

def _timeline_blockers(shots: List[Dict[str, Any]], audio_duration: float) -> List[str]:
    blockers: List[str] = []
    if not shots:
        return ["Veo shot plan contains zero shots."]
    ids = [s["shotId"] for s in shots]
    if len(ids) != len(set(ids)):
        blockers.append(f"Duplicate shot IDs detected: {len(ids) - len(set(ids))} duplicate(s).")
    prev_end = 0.0
    for i, s in enumerate(shots):
        if s["startTime"] >= s["endTime"]:
            blockers.append(f"Shot {s['shotId']} has invalid range [{s['startTime']}, {s['endTime']}].")
        if i == 0 and abs(s["startTime"] - 0.0) > _TIMELINE_TOLERANCE:
            blockers.append(f"First shot {s['shotId']} does not start at 0.000 (got {s['startTime']}).")
        if i > 0 and abs(s["startTime"] - prev_end) > _TIMELINE_TOLERANCE:
            if s["startTime"] < prev_end - _TIMELINE_TOLERANCE:
                blockers.append(f"Shot overlap at {s['shotId']}: expected {prev_end}, got {s['startTime']}.")
            else:
                blockers.append(f"Shot timeline gap at {s['shotId']}: expected {prev_end}, got {s['startTime']}.")
        prev_end = s["endTime"]
    if audio_duration and abs(shots[-1]["endTime"] - audio_duration) > _COVERAGE_TOLERANCE:
        blockers.append(f"Last shot end ({shots[-1]['endTime']}) does not cover audio duration ({audio_duration}).")
    return blockers


def preflight(project_dir: Path) -> Dict[str, Any]:
    """Validate the live project for production export. Pure read-only."""
    blockers: List[str] = []
    readiness: Dict[str, str] = {}

    audio_path = project_dir / "audio.wav"
    srt_path = project_dir / "timestamps.srt"
    if not audio_path.is_file():
        blockers.append("Missing audio.wav. Generate narration audio first.")
        readiness["audio"] = "MISSING"
    else:
        readiness["audio"] = "READY"

    # Voice QA
    qa_ok, qa_msg, qa_info = check_voice_qa_for_export(project_dir)
    readiness["voiceQa"] = "READY" if qa_ok else qa_info.get("status", "BLOCKED")
    if not qa_ok:
        blockers.append(qa_msg)

    # Timestamps
    ts_data = _load_json(project_dir / "timestamps.json")
    if ts_data is None:
        blockers.append("Missing timestamps.json. Generate timestamps first.")
        readiness["timestamp"] = "MISSING"
    else:
        audio_hash = _file_hash(audio_path)
        ts_audio = ts_data.get("audio_sha256") or ts_data.get("source_audio_hash")
        if audio_hash and ts_audio and ts_audio != audio_hash:
            blockers.append("Timestamp is OUTDATED (audio.wav changed). Regenerate timestamps.")
            readiness["timestamp"] = "OUTDATED"
        else:
            readiness["timestamp"] = "READY"
    if not srt_path.is_file():
        blockers.append("Missing timestamps.srt subtitle file.")
    audio_duration = float((ts_data or {}).get("audio_duration", 0.0))

    # Scene plan
    sp_data = _load_json(project_dir / "scene_plan.json")
    scenes: List[Dict[str, Any]] = []
    if sp_data is None:
        blockers.append("Missing scene_plan.json. Run scene planning first.")
        readiness["scenePlan"] = "MISSING"
    else:
        scenes = sp_data.get("scenes", []) or []
        if not scenes:
            blockers.append("Scene plan contains zero scenes.")
            readiness["scenePlan"] = "EMPTY"
        else:
            ts_hash_actual = _file_hash(project_dir / "timestamps.json")
            if ts_hash_actual and sp_data.get("timestamps_sha256") and sp_data.get("timestamps_sha256") != ts_hash_actual:
                blockers.append("Scene Plan is OUTDATED (timestamps.json changed). Regenerate scenes.")
                readiness["scenePlan"] = "OUTDATED"
            else:
                readiness["scenePlan"] = "READY"
    scene_ids = [s.get("scene_id") for s in scenes if s.get("scene_id")]
    scene_order = scene_ids or sorted({s.get("scene_id", "") for s in scenes if s.get("scene_id")})

    # Visual continuity (lazy import to avoid circulars)
    vb_data = _load_json(project_dir / "visual_bible.json")
    if vb_data is None:
        blockers.append("Missing visual_bible.json. Generate the Visual Bible first.")
        readiness["visualContinuity"] = "MISSING"
    else:
        try:
            from studio.visual_continuity import visual_continuity_director
            vb_status = visual_continuity_director.check_visual_bible_status(project_dir)
            if (vb_status.get("status") or "").lower() != "ready":
                blockers.append(f"Visual Continuity is {vb_status.get('status')}: {vb_status.get('stale_reason') or 'not ready'}.")
                readiness["visualContinuity"] = str(vb_status.get("status", "NOT READY")).upper()
            else:
                readiness["visualContinuity"] = "READY"
            report = visual_continuity_director.validate_continuity(project_dir)
            issues = report.get("issues", []) if isinstance(report, dict) else []
            err_count = sum(1 for i in issues if (i.get("severity") or "").upper() == "ERROR")
            if err_count > 0:
                first = next(i for i in issues if (i.get("severity") or "").upper() == "ERROR")
                blockers.append(f"Visual Continuity has {err_count} ERROR issue(s). First: {first.get('message')}.")
        except ProductionExportError:
            raise
        except Exception as e:
            blockers.append(f"Visual Continuity validation failed: {e}")
            readiness.setdefault("visualContinuity", "ERROR")

    # Veo prompts
    veo_data = _load_json(project_dir / "veo_prompts.json")
    shots: List[Dict[str, Any]] = []
    if veo_data is None:
        blockers.append("Missing veo_prompts.json. Generate Veo prompts first.")
        readiness["veo"] = "MISSING"
    else:
        try:
            from studio.veo_prompt_generator import veo_generator
            veo_status = veo_generator.check_veo_status(project_dir)
            if (veo_status.get("status") or "").lower() != "ready":
                blockers.append(f"Veo Prompt is {veo_status.get('status')}: {veo_status.get('stale_reason') or 'not ready'}.")
                readiness["veo"] = str(veo_status.get("status", "NOT READY")).upper()
            else:
                readiness["veo"] = "READY"
        except Exception as e:
            blockers.append(f"Veo status check failed: {e}")
            readiness.setdefault("veo", "ERROR")
        raw_shots = veo_data.get("shots", []) or []
        shots = [normalize_shot(s) for s in raw_shots if isinstance(s, dict)]
        if len(shots) != len(raw_shots):
            blockers.append("Veo plan contains malformed shot entries.")
        # OUTDATED shots
        outdated = [s["shotId"] for s in shots if s["outdated"]]
        if outdated:
            blockers.append(f"{len(outdated)} OUTDATED shot(s): {', '.join(outdated[:5])}"
                            + ("..." if len(outdated) > 5 else "") + ". Regenerate Veo shots.")
        # Missing prompts
        empty_prompt = [s["shotId"] for s in shots if not s["prompt"] or len(s["prompt"]) < 10]
        if empty_prompt:
            blockers.append(f"{len(empty_prompt)} shot(s) with missing/empty prompt: {', '.join(empty_prompt[:5])}.")
        # Invalid parent scenes
        if scene_ids:
            bad_parent = [s["shotId"] for s in shots if s["parentSceneId"] not in scene_ids]
            if bad_parent:
                blockers.append(f"{len(bad_parent)} shot(s) with invalid parentSceneId: {', '.join(bad_parent[:5])}.")
        # Scene coverage: every scene must have >= 1 shot
        if scene_ids and shots:
            covered = {s["parentSceneId"] for s in shots}
            missing = [sid for sid in scene_ids if sid not in covered]
            if missing:
                blockers.append(f"Scene coverage error: {len(missing)} scene(s) without shots: {', '.join(missing[:5])}.")
        # Timeline
        blockers.extend(_timeline_blockers(shots, audio_duration or float(veo_data.get("audio_duration", 0.0))))
        # Continuity references
        if vb_data is not None and shots:
            subjects = {s.get("subjectId") for s in vb_data.get("subjects", []) if isinstance(s, dict)}
            envs = {e.get("environmentId") for e in vb_data.get("environments", []) if isinstance(e, dict)}
            periods = {p.get("periodId") for p in vb_data.get("periods", []) if isinstance(p, dict)}
            props = {p.get("propId") for p in vb_data.get("props", []) if isinstance(p, dict)}
            groups = {g.get("continuityGroupId") for g in vb_data.get("continuityGroups", []) if isinstance(g, dict)}
            bad_refs: List[str] = []
            for s in shots:
                for sid in s["subjectIds"]:
                    if sid not in subjects:
                        bad_refs.append(f"{s['shotId']}: unknown subject {sid}")
                if s["environmentId"] and s["environmentId"] not in envs:
                    bad_refs.append(f"{s['shotId']}: unknown environment {s['environmentId']}")
                if s["periodId"] and s["periodId"] not in periods:
                    bad_refs.append(f"{s['shotId']}: unknown period {s['periodId']}")
                for pid in s["propIds"]:
                    if pid not in props:
                        bad_refs.append(f"{s['shotId']}: unknown prop {pid}")
                if s["continuityGroupId"] and s["continuityGroupId"] not in groups:
                    bad_refs.append(f"{s['shotId']}: unknown continuity group {s['continuityGroupId']}")
            if bad_refs:
                blockers.append(f"Invalid continuity references ({len(bad_refs)}): {'; '.join(bad_refs[:3])}"
                                + ("..." if len(bad_refs) > 3 else ""))

    # Filenames unique (case-insensitive, Windows-safe)
    if shots:
        try:
            names = [expected_filename_for(s["parentSceneId"], s["shotIndex"]) for s in shots]
            lowered = [n.lower() for n in names]
            if len(set(lowered)) != len(lowered):
                seen: Dict[str, str] = {}
                dupes = sorted({n for n in names if lowered.count(n.lower()) > 1 and not seen.setdefault(n.lower(), n)})
                blockers.append(f"Duplicate expected filenames: {', '.join(dupes[:5])}.")
        except ProductionExportError as e:
            blockers.append(str(e))

    return {
        "ok": len(blockers) == 0,
        "blockers": blockers,
        "readiness": readiness,
        "sceneCount": len(scenes),
        "shotCount": len(shots),
        "audioDuration": audio_duration or float((veo_data or {}).get("audio_duration", 0.0)),
        "voiceQa": qa_info,
    }


# ---------------------------------------------------------------------------
# Export plan (in-memory)
# ---------------------------------------------------------------------------

def _next_export_id(exports_root: Path) -> str:
    taken = set()
    if exports_root.is_dir():
        for child in exports_root.iterdir():
            if child.is_dir() and EXPORT_ID_PATTERN.match(child.name):
                taken.add(child.name)
    n = 1
    while f"export_{n:03d}" in taken:
        n += 1
    return f"export_{n:03d}"


def build_export_plan(project_dir: Path, export_id: Optional[str] = None) -> Dict[str, Any]:
    pre = preflight(project_dir)
    if not pre["ok"]:
        raise ProductionExportError("Export blocked by project health gate.", blockers=pre["blockers"])

    exports_root = project_dir / "exports"
    if export_id is None:
        export_id = _next_export_id(exports_root)
    else:
        export_id = validate_export_id(export_id)
        if (exports_root / export_id).exists():
            raise ProductionExportError(f"Export {export_id} already exists. Refusing to overwrite.")

    veo_data = _load_json(project_dir / "veo_prompts.json") or {}
    sp_data = _load_json(project_dir / "scene_plan.json") or {}
    scenes = sp_data.get("scenes", []) or []
    scene_order = [s.get("scene_id") for s in scenes if s.get("scene_id")]
    raw_shots = veo_data.get("shots", []) or []
    shots = sort_shots([normalize_shot(s) for s in raw_shots if isinstance(s, dict)], scene_order)

    # Enrich with filenames + prompt files (deterministic 1:1)
    enriched: List[Dict[str, Any]] = []
    for s in shots:
        fname = expected_filename_for(s["parentSceneId"], s["shotIndex"])
        scene_num = (re.match(r"^scene_(\d+)$", s["parentSceneId"], re.IGNORECASE).group(1)
                     if _SCENE_NUM_PATTERN.match(s["parentSceneId"]) else "000")
        prompt_rel = f"shots/scene_{int(scene_num):03d}/shot_{int(scene_num):03d}_{int(s['shotIndex']):02d}.txt" \
            if _SCENE_NUM_PATTERN.match(s["parentSceneId"]) else f"shots/other/{s['shotId']}.txt"
        enriched.append({**s, "expectedFileName": fname, "promptFile": prompt_rel})

    hashes = collect_source_hashes(project_dir)
    try:
        with open(project_dir / "settings.json", "r", encoding="utf-8") as f:
            settings = json.load(f)
        title = settings.get("project_name") or project_dir.name
    except Exception:
        title = project_dir.name

    scene_summaries = []
    for sc in scenes:
        sid = sc.get("scene_id")
        scene_summaries.append({
            "sceneId": sid,
            "startTime": _as_float(sc.get("start", 0.0)),
            "endTime": _as_float(sc.get("end", 0.0)),
            "shotIds": [s["shotId"] for s in enriched if s["parentSceneId"] == sid],
        })

    return {
        "exportId": export_id,
        "projectId": project_dir.name,
        "projectTitle": title,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "sceneCount": len(scenes),
        "shotCount": len(enriched),
        "audioDuration": pre["audioDuration"],
        "sourceHashes": hashes,
        "scenes": scenes,
        "sceneSummaries": scene_summaries,
        "shots": enriched,
        "preflight": {"readiness": pre["readiness"], "voiceQa": pre["voiceQa"]},
    }


# ---------------------------------------------------------------------------
# Artifact builders
# ---------------------------------------------------------------------------

def _fmt_csv_time(v: float) -> str:
    return f"{float(v):.3f}"


def _fmt_md_time(v: float) -> str:
    total_ms = int(round(float(v) * 1000))
    minutes, rem = divmod(total_ms, 60000)
    seconds, ms = divmod(rem, 1000)
    return f"{minutes:02d}:{seconds:02d}.{ms:03d}"


def build_manifest(plan: Dict[str, Any]) -> Dict[str, Any]:
    shots = []
    for s in plan["shots"]:
        shots.append({
            "shotId": s["shotId"],
            "parentSceneId": s["parentSceneId"],
            "shotIndex": s["shotIndex"],
            "shotPurpose": s["shotPurpose"],
            "startTime": s["startTime"],
            "endTime": s["endTime"],
            "duration": s["duration"],
            "narration": s["narration"],
            "continuityGroupId": s["continuityGroupId"],
            "subjectIds": s["subjectIds"],
            "environmentId": s["environmentId"],
            "periodId": s["periodId"],
            "propIds": s["propIds"],
            "promptFile": s["promptFile"],
            "expectedFileName": s["expectedFileName"],
            "status": "PENDING",
        })
    files = {
        "manifest": "production_manifest.json",
        "promptPack": "flow_prompt_pack.md",
        "shotManifest": "shot_manifest.csv",
        "checklist": "production_checklist.md",
        "audioWav": "audio/audio.wav",
        "subtitle": "audio/timestamps.srt",
    }
    return {
        "schemaVersion": SCHEMA_VERSION,
        "exporterVersion": EXPORTER_VERSION,
        "exportId": plan["exportId"],
        "projectId": plan["projectId"],
        "projectTitle": plan["projectTitle"],
        "createdAt": plan["createdAt"],
        "sceneCount": plan["sceneCount"],
        "shotCount": plan["shotCount"],
        "audioDuration": plan["audioDuration"],
        "sourceHashes": plan["sourceHashes"],
        "files": files,
        "scenes": plan["sceneSummaries"],
        "shots": shots,
    }


def build_shot_csv(plan: Dict[str, Any]) -> str:
    import io
    buf = io.StringIO()
    writer = csv.writer(buf, quoting=csv.QUOTE_MINIMAL, lineterminator="\n")
    writer.writerow(["scene_id", "shot_id", "shot_index", "shot_purpose", "start_time",
                     "end_time", "duration", "expected_filename", "continuity_group_id",
                     "subject_ids", "environment_id", "period_id", "prop_ids",
                     "status", "prompt_file"])
    for s in plan["shots"]:
        writer.writerow([
            s["parentSceneId"], s["shotId"], s["shotIndex"], s["shotPurpose"],
            _fmt_csv_time(s["startTime"]), _fmt_csv_time(s["endTime"]), _fmt_csv_time(s["duration"]),
            s["expectedFileName"], s["continuityGroupId"] or "",
            ";".join(s["subjectIds"]), s["environmentId"] or "", s["periodId"] or "",
            ";".join(s["propIds"]), "PENDING", s["promptFile"],
        ])
    return buf.getvalue()


def build_flow_prompt_pack(plan: Dict[str, Any]) -> str:
    scenes_by_id = {s.get("scene_id"): s for s in plan["scenes"] if isinstance(s, dict)}
    shots_by_scene: Dict[str, List[Dict[str, Any]]] = {}
    for s in plan["shots"]:
        shots_by_scene.setdefault(s["parentSceneId"], []).append(s)
    lines = [
        "# UnfoldIQ Production Prompt Pack",
        "",
        f"Project: {plan['projectTitle']} (`{plan['projectId']}`)",
        f"Export: `{plan['exportId']}` — {plan['createdAt']}",
        "",
        f"Scenes: {plan['sceneCount']}",
        f"Shots: {plan['shotCount']}",
        f"Audio duration: {float(plan['audioDuration']):.2f}s",
        "",
        "Workflow: copy Prompt -> generate in Google Flow / Veo -> download -> "
        "rename to Expected Filename -> edit in CapCut with audio/audio.wav + audio/timestamps.srt.",
        "",
        "---",
        "",
    ]
    for summary in plan["sceneSummaries"]:
        sid = summary["sceneId"]
        sc = scenes_by_id.get(sid, {})
        lines.extend([
            f"# Scene {sid}",
            "",
            f"Time: {_fmt_md_time(summary['startTime'])} -> {_fmt_md_time(summary['endTime'])}",
            "",
            f"Narration: {(sc.get('narration') or '').strip()}",
            "",
            f"Continuity Group: {sc.get('continuity_group') or '—'}",
            f"Environment: {(sc.get('visual_summary') or '').strip() or '—'}",
            "",
            "---",
            "",
        ])
        for s in shots_by_scene.get(sid, []):
            sub = f"{s['shotIndex']:02d}"
            scene_no = sid.split("_")[-1] if "_" in sid else sid
            lines.extend([
                f"## Shot {scene_no}-{sub} (`{s['shotId']}`)",
                "",
                f"Scene ID: {s['parentSceneId']}",
                f"Shot ID: {s['shotId']}",
                f"Purpose: {s['shotPurpose']}",
                f"Duration: {float(s['duration']):.1f}s ({_fmt_md_time(s['startTime'])} -> {_fmt_md_time(s['endTime'])})",
                f"Expected Filename: {s['expectedFileName']}",
                f"Continuity Group: {s['continuityGroupId'] or '—'}",
                "",
                "Prompt:",
                "",
                "```text",
                s["prompt"].strip(),
                "```",
                "",
                "---",
                "",
            ])
    return "\n".join(lines)


def build_checklist(plan: Dict[str, Any]) -> str:
    shots_by_scene: Dict[str, List[Dict[str, Any]]] = {}
    for s in plan["shots"]:
        shots_by_scene.setdefault(s["parentSceneId"], []).append(s)
    lines = ["# Production Checklist", "",
             f"Project: {plan['projectTitle']} (`{plan['projectId']}`) — Export `{plan['exportId']}`", ""]
    for summary in plan["sceneSummaries"]:
        sid = summary["sceneId"]
        lines.append(f"## {sid}")
        lines.append("")
        for s in shots_by_scene.get(sid, []):
            lines.append(f"- [ ] {s['shotId']} — {s['shotPurpose']} — {s['expectedFileName']}")
        lines.append("")
    return "\n".join(lines)


def build_shot_txt(shot: Dict[str, Any]) -> str:
    return "\n".join([
        f"Shot ID: {shot['shotId']}",
        f"Parent Scene: {shot['parentSceneId']}",
        f"Purpose: {shot['shotPurpose']}",
        f"Duration: {float(shot['duration']):.1f}s ({_fmt_md_time(shot['startTime'])} -> {_fmt_md_time(shot['endTime'])})",
        f"Expected Filename: {shot['expectedFileName']}",
        "",
        f"Prompt: {shot['prompt'].strip()}",
        "",
        f"Continuity Group: {shot['continuityGroupId'] or '—'}",
        f"Subjects: {', '.join(shot['subjectIds']) or '—'}",
        f"Environment: {shot['environmentId'] or '—'}",
        f"Period: {shot['periodId'] or '—'}",
        f"Props: {', '.join(shot['propIds']) or '—'}",
        "",
    ])


# ---------------------------------------------------------------------------
# Export execution (atomic)
# ---------------------------------------------------------------------------

def _write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(content)


def _validate_written_export(tmp_dir: Path, plan: Dict[str, Any]) -> List[str]:
    errors: List[str] = []
    required = ["production_manifest.json", "flow_prompt_pack.md",
                "shot_manifest.csv", "production_checklist.md",
                "audio/audio.wav", "audio/timestamps.srt"]
    for rel in required:
        if not (tmp_dir / rel).is_file():
            errors.append(f"Missing written file: {rel}")
    try:
        with open(tmp_dir / "production_manifest.json", "r", encoding="utf-8") as f:
            manifest = json.load(f)
    except Exception as e:
        return errors + [f"Manifest unreadable: {e}"]

    n = plan["shotCount"]
    if len(manifest.get("shots", [])) != n:
        errors.append(f"Manifest shot count {len(manifest.get('shots', []))} != canonical {n}.")
    txt_files = list((tmp_dir / "shots").rglob("*.txt")) if (tmp_dir / "shots").is_dir() else []
    if len(txt_files) != n:
        errors.append(f"Prompt txt count {len(txt_files)} != canonical {n}.")
    try:
        with open(tmp_dir / "shot_manifest.csv", "r", encoding="utf-8", newline="") as f:
            rows = list(csv.reader(f))
        if len(rows) - 1 != n:
            errors.append(f"CSV row count {len(rows) - 1} != canonical {n}.")
    except Exception as e:
        errors.append(f"CSV unreadable: {e}")
    try:
        with open(tmp_dir / "production_checklist.md", "r", encoding="utf-8") as f:
            checklist = f.read()
        if checklist.count("- [ ]") != n:
            errors.append(f"Checklist item count {checklist.count('- [ ]')} != canonical {n}.")
    except Exception as e:
        errors.append(f"Checklist unreadable: {e}")
    for s in manifest.get("shots", []):
        if not (tmp_dir / s.get("promptFile", "")).is_file():
            errors.append(f"Missing prompt file for {s.get('shotId')}: {s.get('promptFile')}.")
            break
    names = [(s.get("expectedFileName", "")) for s in manifest.get("shots", [])]
    if len({x.lower() for x in names}) != len(names):
        errors.append("Duplicate expected filenames in manifest.")
    ids = [s.get("shotId") for s in manifest.get("shots", [])]
    if len(set(ids)) != len(ids):
        errors.append("Duplicate shot IDs in manifest.")
    return errors


def execute_export(project_id: str, export_id: Optional[str] = None) -> Dict[str, Any]:
    """Run full export: preflight -> in-memory plan -> temp write -> validate -> atomic commit."""
    t0 = datetime.now(timezone.utc)
    project_dir = _resolve_project_dir(project_id)
    exports_root = project_dir / "exports"
    exports_root.mkdir(parents=True, exist_ok=True)

    plan = build_export_plan(project_dir, export_id)
    final_dir = exports_root / plan["exportId"]
    if final_dir.exists():
        raise ProductionExportError(f"Export {plan['exportId']} already exists. Refusing to overwrite.")
    tmp_dir = exports_root / f".tmp_{plan['exportId']}"
    if tmp_dir.exists():
        shutil.rmtree(tmp_dir, ignore_errors=True)

    timings: Dict[str, float] = {}
    try:
        import time as _time
        t = _time.perf_counter()
        manifest = build_manifest(plan)
        _write_text(tmp_dir / "production_manifest.json",
                    json.dumps(manifest, indent=2, ensure_ascii=False))
        _write_text(tmp_dir / "flow_prompt_pack.md", build_flow_prompt_pack(plan))
        _write_text(tmp_dir / "shot_manifest.csv", build_shot_csv(plan))
        _write_text(tmp_dir / "production_checklist.md", build_checklist(plan))
        for s in plan["shots"]:
            _write_text(tmp_dir / s["promptFile"], build_shot_txt(s))
        timings["metadata_s"] = round(_time.perf_counter() - t, 3)

        t = _time.perf_counter()
        audio_dir = tmp_dir / "audio"
        audio_dir.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(project_dir / "audio.wav", audio_dir / "audio.wav")
        shutil.copyfile(project_dir / "timestamps.srt", audio_dir / "timestamps.srt")
        mp3_src = project_dir / "audio.mp3"
        if mp3_src.is_file():
            shutil.copyfile(mp3_src, audio_dir / "audio.mp3")
        snap_dir = tmp_dir / "source_snapshot"
        snap_dir.mkdir(parents=True, exist_ok=True)
        for name in ("scene_plan.json", "visual_bible.json", "veo_prompts.json"):
            src = project_dir / name
            if src.is_file():
                shutil.copyfile(src, snap_dir / name)
        timings["copy_s"] = round(_time.perf_counter() - t, 3)

        errors = _validate_written_export(tmp_dir, plan)
        if errors:
            raise ProductionExportError("Export integrity validation failed.", blockers=errors)

        os.replace(tmp_dir, final_dir)
    except Exception:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise

    total = (datetime.now(timezone.utc) - t0).total_seconds()
    size_bytes = sum(p.stat().st_size for p in final_dir.rglob("*") if p.is_file())
    logger.info(f"Production export {plan['exportId']} for {project_id}: "
                f"{plan['shotCount']} shots in {total:.1f}s")
    return {
        "projectId": project_dir.name,
        "exportId": plan["exportId"],
        "exportPath": str(final_dir),
        "sceneCount": plan["sceneCount"],
        "shotCount": plan["shotCount"],
        "audioDuration": plan["audioDuration"],
        "promptFileCount": plan["shotCount"],
        "sourceHashes": plan["sourceHashes"],
        "runtime_s": round(total, 3),
        "timings": timings,
        "size_bytes": size_bytes,
    }


# ---------------------------------------------------------------------------
# History / staleness
# ---------------------------------------------------------------------------

def list_exports(project_id: str) -> List[Dict[str, Any]]:
    """Lightweight read-only history for the active project. Never loads full content."""
    project_dir = _resolve_project_dir(project_id)
    exports_root = project_dir / "exports"
    result: List[Dict[str, Any]] = []
    if not exports_root.is_dir():
        return result
    for child in sorted(exports_root.iterdir(), key=lambda p: p.name, reverse=True):
        if not child.is_dir() or not EXPORT_ID_PATTERN.match(child.name):
            continue
        manifest_path = child / "production_manifest.json"
        if not manifest_path.is_file():
            continue
        try:
            with open(manifest_path, "r", encoding="utf-8") as f:
                m = json.load(f)
            result.append({
                "exportId": m.get("exportId", child.name),
                "projectId": m.get("projectId", project_dir.name),
                "projectTitle": m.get("projectTitle", ""),
                "createdAt": m.get("createdAt", ""),
                "sceneCount": m.get("sceneCount", 0),
                "shotCount": m.get("shotCount", 0),
                "audioDuration": m.get("audioDuration", 0.0),
                "path": str(child),
                "snapshot": _snapshot_state(project_dir, m.get("sourceHashes") or {}),
            })
        except Exception:
            continue
    return result


def _snapshot_state(project_dir: Path, saved_hashes: Dict[str, Any]) -> str:
    current = collect_source_hashes(project_dir)
    for key in ("scriptHash", "audioHash", "timestampsHash", "scenePlanHash",
                "visualBibleHash", "veoPromptsHash"):
        if saved_hashes.get(key) and current.get(key) and saved_hashes.get(key) != current.get(key):
            return "OLDER SNAPSHOT"
    return "CURRENT"


def production_status(project_id: str) -> Dict[str, Any]:
    """Combined readiness + counts + history for the Production card."""
    project_dir = _resolve_project_dir(project_id)
    pre = preflight(project_dir)
    exports = list_exports(project_id)
    latest = exports[0] if exports else None
    return {
        "projectId": project_dir.name,
        "ready": pre["ok"],
        "blockers": pre["blockers"],
        "blockerCount": len(pre["blockers"]),
        "readiness": pre["readiness"],
        "sceneCount": pre["sceneCount"],
        "shotCount": pre["shotCount"],
        "audioDuration": pre["audioDuration"],
        "voiceQa": pre["voiceQa"],
        "outdatedShotCount": sum(1 for _b in pre["blockers"] if "OUTDATED shot" in _b),
        "exports": exports,
        "latestExport": latest,
        "hasMp3": (project_dir / "audio.mp3").is_file(),
    }
