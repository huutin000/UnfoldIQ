"""
UnfoldIQ Phase 12–13 — Fine-grained visual dependency / invalidation (§39–40).

Precise ownership: entity/style/scene edits invalidate ONLY dependent visual
prompts + Veo shots. Audio, Voice QA and Timestamp are never touched by visual
changes (untouched files by construction; asserted in tests).

UI-only metadata (notes/reviewNotes/manualEdited/status/timestamps) never
invalidates (hash-excluded upstream).
"""

import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger("unfoldiq.visual_dependencies")


class DependencyError(Exception):
    pass


def _load_scenes(project_dir: Path) -> List[Dict[str, Any]]:
    p = Path(project_dir) / "scene_plan.json"
    if not p.is_file():
        return []
    with open(p, "r", encoding="utf-8") as f:
        return json.load(f).get("scenes", []) or []


def _load_shots(project_dir: Path) -> List[Dict[str, Any]]:
    p = Path(project_dir) / "veo_prompts.json"
    if not p.is_file():
        return []
    with open(p, "r", encoding="utf-8") as f:
        return json.load(f).get("shots", []) or []


def backfilled_scene(scene: Dict[str, Any], bible: Dict[str, Any]) -> Dict[str, Any]:
    from studio.visual_prompt import backfill_scene_visual
    return backfill_scene_visual(dict(scene), bible or {})


def scenes_referencing_entity(project_dir: Path, kind: str, entity_id: str) -> List[str]:
    """Scene IDs whose canonical visual refs include the entity.

    kind: character | environment | object. Corrective (§29): representative
    individuals match EXPLICIT characterIds bindings only; groups/animals
    match broad subjectIds membership. Uses V2 refs with legacy
    continuity_group fallback so unmigrated scenes resolve correctly.
    """
    from studio.visual_bible_v2 import load_bible, find_entity
    project_dir = Path(project_dir)
    bible = load_bible(project_dir) or {}
    out: List[str] = []
    ent_kind = None
    if kind == "character":
        ent = find_entity(bible, "character", entity_id)
        ent_kind = (ent or {}).get("entityKind") or "SUBJECT_GROUP"
    for sc in _load_scenes(project_dir):
        full = backfilled_scene(sc, bible)
        if kind == "character":
            if ent_kind == "REPRESENTATIVE_CHARACTER":
                if entity_id in (full.get("characterIds", []) or []):
                    out.append(sc["scene_id"])
            else:
                if entity_id in (full.get("subjectIds", []) or []):
                    out.append(sc["scene_id"])
        elif kind == "environment" and full.get("environmentId") == entity_id:
            out.append(sc["scene_id"])
        elif kind == "object" and entity_id in (full.get("objectIds", []) or []):
            out.append(sc["scene_id"])
    return sorted(out)


def rep_bound_scenes(project_dir: Path, rep_id: str) -> List[str]:
    """Scenes explicitly binding one representative character."""
    return scenes_referencing_entity(project_dir, "character", rep_id)


def group_impact_scenes(project_dir: Path, group_id: str) -> List[str]:
    """Group change impact (§28): member scenes + scenes binding derived reps."""
    from studio.visual_bible_v2 import load_bible
    project_dir = Path(project_dir)
    bible = load_bible(project_dir) or {}
    affected = set(scenes_referencing_entity(project_dir, "character", group_id))
    for c in bible.get("characters", []) or []:
        if (c.get("entityKind") == "REPRESENTATIVE_CHARACTER"
                and c.get("sourceSubjectId") == group_id):
            affected.update(rep_bound_scenes(project_dir, c.get("characterId")))
    return sorted(affected)


def shots_for_scenes(project_dir: Path, scene_ids: List[str]) -> List[str]:
    wanted = set(scene_ids)
    out = []
    for sh in _load_shots(project_dir):
        parent = sh.get("parent_scene_id") or sh.get("parentSceneId") or sh.get("scene_id")
        if parent in wanted:
            out.append(sh.get("shot_id"))
    return sorted(out)


def compute_impact(project_dir: Path, change: Dict[str, Any]) -> Dict[str, Any]:
    """change: {kind: character|environment|object|style|scene|visualType|
    selectedOutput|referenceAsset, id?, sceneId?}.

    Returns affected scenes/shots with reasons. Never touches audio/QA/timestamp.
    """
    project_dir = Path(project_dir)
    kind = change.get("kind")
    scenes = _load_scenes(project_dir)
    all_scene_ids = sorted(s["scene_id"] for s in scenes if s.get("scene_id"))

    if kind in ("character", "environment", "object"):
        from studio.visual_bible_v2 import load_bible, find_entity
        bible = load_bible(project_dir) or {}
        ent_kind = None
        if kind == "character":
            ent = find_entity(bible, "character", change.get("id", ""))
            ent_kind = (ent or {}).get("entityKind") or "SUBJECT_GROUP"
        if kind == "character" and ent_kind != "REPRESENTATIVE_CHARACTER":
            # Group/animal change (§28): members + derived reps' bound scenes.
            affected = group_impact_scenes(project_dir, change.get("id", ""))
        else:
            affected = scenes_referencing_entity(project_dir, kind, change.get("id", ""))
        reason = f"{kind} {change.get('id')} changed"
    elif kind == "style":
        affected = all_scene_ids
        reason = "project visual style changed"
    elif kind in ("scene", "visualType", "selectedOutput", "composition"):
        affected = [change["sceneId"]] if change.get("sceneId") in all_scene_ids else []
        reason = f"{kind} changed for {change.get('sceneId')}"
    elif kind == "referenceAsset":
        affected = scenes_referencing_entity(
            project_dir, {"CHARACTER": "character", "ENVIRONMENT": "environment",
                          "OBJECT": "object"}[change.get("entityType", "CHARACTER")],
            change.get("entityId", ""))
        reason = f"reference asset {change.get('assetId')} changed"
    else:
        raise DependencyError(f"Unknown change kind: {kind}")

    shots = shots_for_scenes(project_dir, affected)
    return {"affectedScenes": affected, "affectedShots": shots,
            "reason": reason, "kind": kind}


def _save_veo_shots(project_dir: Path, shots: List[Dict[str, Any]]) -> None:
    p = Path(project_dir) / "veo_prompts.json"
    with open(p, "r", encoding="utf-8") as f:
        veo = json.load(f)
    veo["shots"] = shots
    tmp = p.with_suffix(".json.dep.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(veo, f, indent=2, ensure_ascii=False)
    tmp.replace(p)


def apply_impact(project_dir: Path, impact: Dict[str, Any]) -> Dict[str, Any]:
    """Mark dependent visual prompts OUTDATED + Veo shots outdated. Returns counts."""
    from studio.visual_prompt import load_prompts, save_prompts
    project_dir = Path(project_dir)
    affected = set(impact.get("affectedScenes", []))
    reason = impact.get("reason", "dependency changed")

    vp = load_prompts(project_dir)
    marked_prompts = 0
    for e in vp.get("entries", []):
        if e.get("sceneId") in affected and e.get("status") != "OUTDATED":
            e["status"] = "OUTDATED"
            e["outdatedReason"] = reason
            marked_prompts += 1
    if marked_prompts:
        save_prompts(project_dir, vp)

    marked_shots = 0
    if (project_dir / "veo_prompts.json").is_file():
        shots = _load_shots(project_dir)
        for sh in shots:
            parent = sh.get("parent_scene_id") or sh.get("parentSceneId") or sh.get("scene_id")
            if parent in affected and not sh.get("outdated"):
                sh["outdated"] = True
                marked_shots += 1
        if marked_shots:
            _save_veo_shots(project_dir, shots)

    logger.info(f"Invalidation ({impact.get('kind')}: {reason}): "
                f"{len(affected)} scenes, {marked_prompts} visual prompts, {marked_shots} shots")
    return {"markedVisualPrompts": marked_prompts, "markedShots": marked_shots,
            "affectedScenes": sorted(affected),
            "affectedShots": shots_for_scenes(project_dir, sorted(affected))}
