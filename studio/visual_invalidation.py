"""
studio/visual_invalidation.py — Gate I: selective dependency invalidation.

Phase 2 DAG integration for the Visual Workbench. Changing one entity
affects ONLY the shots bound to that entity — never the whole film.
No automatic prompt regeneration happens here; callers mark affected
prompts OUTDATED and leave content untouched for explicit user action.
"""
from __future__ import annotations

from typing import Any, Dict, List


def _shot_subject_ids(shot: Dict[str, Any]) -> List[str]:
    return list(shot.get("subjectIds") or shot.get("subject_ids") or [])


def _shot_env_id(shot: Dict[str, Any]) -> str | None:
    return shot.get("environmentId") or shot.get("environment_id")


def _shot_prop_ids(shot: Dict[str, Any]) -> List[str]:
    return list(shot.get("propIds") or shot.get("prop_ids") or [])


def shots_affected_by_subject(shots: List[Dict[str, Any]], subject_id: str) -> List[str]:
    """Return shot_ids bound to the changed Character/subject (stable entity ID)."""
    return [s.get("shot_id") for s in shots if subject_id in _shot_subject_ids(s)]


def shots_affected_by_environment(shots: List[Dict[str, Any]], environment_id: str) -> List[str]:
    """Return shot_ids bound to the changed Environment (stable entity ID)."""
    return [s.get("shot_id") for s in shots if _shot_env_id(s) == environment_id]


def shots_affected_by_prop(shots: List[Dict[str, Any]], prop_id: str) -> List[str]:
    """Return shot_ids bound to the changed Prop/Object (stable entity ID)."""
    return [s.get("shot_id") for s in shots if prop_id in _shot_prop_ids(s)]


def apply_blueprint_change(shots: List[Dict[str, Any]], shot_id: str) -> Dict[str, Any]:
    """Mark one Shot's dependent Image Prompt OUTDATED after a Blueprint change.

    Only the target shot is touched; siblings are never modified and no
    prompt text is regenerated.
    """
    affected = []
    for s in shots:
        if s.get("shot_id") == shot_id:
            s["outdated"] = True
            affected.append(shot_id)
            break
    return {"affected_shot_ids": affected, "total_shots": len(shots),
            "selective": True, "auto_regenerated": False}
