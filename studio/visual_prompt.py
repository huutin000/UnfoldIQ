"""
UnfoldIQ Phase 13 — Scene visual integration + Visual Prompt composer.

Scene Plan references canonical Visual Bible IDs (never duplicates identity).
Visual Type enum, deterministic production recommendation, user override,
canonical visual_prompts.json composer, Veo inheritance metadata.

Vendor-neutral. No image generation. Stdlib only.
"""

import hashlib
import json
import logging
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger("unfoldiq.visual_prompt")

VISUAL_TYPE_ENUM = (
    "CHARACTER_SCENE", "ENVIRONMENT", "EVIDENCE", "DIAGRAM",
    "MAP", "OBJECT", "COMPARISON", "TIMELINE",
)

VISUAL_LAYER = {
    "CHARACTER_SCENE": "STORY",
    "ENVIRONMENT": "STORY",
    "DIAGRAM": "EXPLANATION",
    "MAP": "EXPLANATION",
    "COMPARISON": "EXPLANATION",
    "TIMELINE": "EXPLANATION",
    "EVIDENCE": "EVIDENCE",
    "OBJECT": "EVIDENCE",
}

RECOMMENDED_OUTPUTS = ("STATIC_IMAGE", "EDITOR_MOTION", "VEO_CANDIDATE", "VEO_RECOMMENDED")
SELECTED_OUTPUTS = ("STATIC_IMAGE", "EDITOR_MOTION", "VEO")

# Legacy scene category -> visualType backfill.
CATEGORY_VISUAL_TYPE = {
    "reconstruction": "CHARACTER_SCENE",
    "transition": "CHARACTER_SCENE",
    "environment": "ENVIRONMENT",
    "establishing": "ENVIRONMENT",
    "artifact": "EVIDENCE",
    "detail/macro": "OBJECT",
    "process": "OBJECT",
    "map": "MAP",
    "timeline": "TIMELINE",
    "comparison": "COMPARISON",
    "anatomy/science": "EVIDENCE",
}

_BASE_RECOMMENDATION = {
    "CHARACTER_SCENE": "VEO_CANDIDATE",
    "ENVIRONMENT": "VEO_CANDIDATE",
    "EVIDENCE": "STATIC_IMAGE",
    "DIAGRAM": "EDITOR_MOTION",
    "MAP": "EDITOR_MOTION",
    "OBJECT": "STATIC_IMAGE",
    "COMPARISON": "EDITOR_MOTION",
    "TIMELINE": "EDITOR_MOTION",
}

_MOTION_SIGNALS = (
    "moving", "running", "walking", "striking", "chasing", "fleeing", "migrat",
    "tracking", "flowing", "burning", "erupting", "stalking", "gathering",
    "knapping", "flaking", "hunting", "emerging", "shifting", "drifting",
)
_TURNING_POINT_SIGNALS = (
    "reveals", "discovered", "surprising", "unexpected", "first time",
    "breakthrough", "turns out", "in fact", "decisive", "turning point",
)


class VisualPromptError(Exception):
    pass


def _canonical(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def scene_prompt_hash(scene: Dict[str, Any]) -> str:
    """Prompt-affecting hash of scene visual fields (timing excluded)."""
    payload = {k: scene.get(k) for k in (
        "visualType", "subjectIds", "characterIds", "environmentId", "objectIds",
        "visual_summary", "composition", "narrativePurpose",
        "selectedOutputType", "historicalConstraints", "scientificConstraints",
    )}
    return hashlib.sha256(_canonical(payload).encode("utf-8")).hexdigest()


# Closure §17: word boundaries + simple negation. "migrat" is intentionally a
# stem (migration/migrating); every other signal is a whole word.
_STEM_SIGNALS = frozenset({"migrat"})
_NEGATIONS = frozenset({"not", "no", "never", "neither", "nor", "cannot",
                        "can't", "couldn't", "wouldn't", "without", "lack",
                        "lacks", "lacking", "against", "fails", "failed"})


def _signal_hits(text: str, signals) -> List[str]:
    """Whole-word (or stem-prefix) hits, ignoring occurrences negated within
    the 4 preceding tokens. Pure, deterministic, stdlib only."""
    hits: List[str] = []
    for sig in signals:
        if " " in sig:
            pat = r"\b" + r"\s+".join(re.escape(w) for w in sig.split()) + r"\b"
        elif sig in _STEM_SIGNALS:
            pat = r"\b" + re.escape(sig)
        else:
            pat = r"\b" + re.escape(sig) + r"\b"
        for m in re.finditer(pat, text):
            prior = re.findall(r"[a-z']+", text[:m.start()])[-4:]
            if any(tok in _NEGATIONS for tok in prior):
                continue
            hits.append(sig)
            break
    return hits


def recommend_output(scene: Dict[str, Any]) -> Tuple[str, List[str]]:
    """Deterministic recommendation + human-readable reasons."""
    vtype = scene.get("visualType", "CHARACTER_SCENE")
    base = _BASE_RECOMMENDATION.get(vtype, "VEO_CANDIDATE")
    reasons = [f"base rule: {vtype} -> {base}"]
    if base not in ("VEO_CANDIDATE",):
        return base, reasons
    text = f"{scene.get('narration', '')} {scene.get('visual_summary', '')}".lower()
    motion = _signal_hits(text, _MOTION_SIGNALS)
    turning = _signal_hits(text, _TURNING_POINT_SIGNALS)
    if motion or turning:
        if motion:
            reasons.append(f"meaningful subject action: {', '.join(sorted(set(motion))[:4])}")
        if turning:
            reasons.append("narrative turning point")
        return "VEO_RECOMMENDED", reasons
    return base, reasons


def backfill_scene_visual(scene: Dict[str, Any], bible: Dict[str, Any]) -> Dict[str, Any]:
    """Fill missing V2 visual fields from legacy category/continuity data. Pure.

    Corrective (§11): subjectIds = broad group entities (backfilled from group
    membership); characterIds = representative individuals (explicit only —
    NEVER group subjects). Both levels coexist.
    """
    s = dict(scene)
    if not s.get("visualType"):
        s["visualType"] = CATEGORY_VISUAL_TYPE.get(s.get("category", ""), "CHARACTER_SCENE")
    if s.get("subjectIds") is None or s.get("environmentId") is None or s.get("objectIds") is None:
        subjects: List[str] = []
        env: Optional[str] = None
        objs: List[str] = []
        group_id = s.get("continuity_group")
        if not group_id:
            # Reverse lookup: groups declare member sceneIds even when the
            # scene record carries no continuity_group (legacy projects).
            for g in bible.get("continuityGroups", []) or []:
                if s.get("scene_id") in (g.get("sceneIds", []) or []):
                    group_id = g.get("continuityGroupId")
                    break
        if group_id:
            for g in bible.get("continuityGroups", []) or []:
                if g.get("continuityGroupId") == group_id:
                    subjects = list(g.get("subjectIds", []) or [])
                    env = g.get("environmentId")
                    objs = list(g.get("persistentPropIds", []) or [])
                    break
        s.setdefault("subjectIds", subjects)
        s.setdefault("environmentId", env)
        s.setdefault("objectIds", objs)
    # Representative cast: explicit bindings only (no group conflation).
    s.setdefault("characterIds", [])
    s.setdefault("composition", s.get("shot_type") or "medium-wide")
    s.setdefault("narrativePurpose", "")
    s.setdefault("historicalConstraints", [])
    s.setdefault("scientificConstraints", [])
    if not s.get("recommendedOutputType"):
        rec, _ = recommend_output(s)
        s["recommendedOutputType"] = rec
    s.setdefault("selectedOutputType", None)
    s.setdefault("visualStatus", "NOT_STARTED")
    return s


def validate_scene_visual_refs(scene: Dict[str, Any], bible: Dict[str, Any]) -> List[str]:
    """Unknown canonical IDs are rejected (blocking for editors).

    Corrective (§58): characterIds must be REPRESENTATIVE_CHARACTER — a group
    ID is rejected with guidance to use subjectIds instead.
    """
    from studio.visual_bible_v2 import entity_ids, find_entity
    errors: List[str] = []
    vt = scene.get("visualType")
    if vt is not None and vt not in VISUAL_TYPE_ENUM:
        errors.append(f"Unknown visualType: {vt}")
    sel = scene.get("selectedOutputType")
    if sel is not None and sel not in SELECTED_OUTPUTS:
        errors.append(f"Unknown selectedOutputType: {sel}")
    known_chars = set(entity_ids(bible, "character"))
    known_envs = set(entity_ids(bible, "environment"))
    known_objs = set(entity_ids(bible, "object"))
    for cid in scene.get("characterIds", []) or []:
        ent = find_entity(bible, "character", cid)
        if ent is None:
            errors.append(f"Unknown characterId: {cid}")
        elif (ent.get("entityKind") or "SUBJECT_GROUP") != "REPRESENTATIVE_CHARACTER":
            errors.append(f"'{cid}' is a {ent.get('entityKind') or 'SUBJECT_GROUP'}, "
                          f"not a representative individual — bind it via subjectIds, "
                          f"not characterIds.")
    for sid in scene.get("subjectIds", []) or []:
        if sid not in known_chars:
            errors.append(f"Unknown subjectId: {sid}")
    env = scene.get("environmentId")
    if env and env not in known_envs:
        errors.append(f"Unknown environmentId: {env}")
    for oid in scene.get("objectIds", []) or []:
        if oid not in known_objs:
            errors.append(f"Unknown objectId: {oid}")
    return errors


# ---------------------------------------------------------------------------
# Visual prompt composer
# ---------------------------------------------------------------------------

def _entity_brief(entity: Dict[str, Any], kind: str) -> str:
    if kind == "character":
        tax = entity.get("taxonomy", {}) or {}
        demo = entity.get("demographics", {}) or {}
        bits = [entity.get("name", ""), tax.get("speciesOrPopulation", ""),
                demo.get("ageGroup", ""), demo.get("sex", ""),
                entity.get("visualDescription", "")]
        anchors = entity.get("identityAnchors", []) or []
        if anchors:
            bits.append("Anchors: " + "; ".join(anchors[:6]))
        return " | ".join(b for b in bits if b)
    if kind == "environment":
        bits = [entity.get("name", ""), entity.get("terrain", ""),
                entity.get("vegetation", ""), entity.get("lighting", "")]
        return " | ".join(b for b in bits if b)
    bits = [entity.get("name", ""), entity.get("visualDescription", "")]
    return " | ".join(b for b in bits if b)


def _rep_brief(rep: Dict[str, Any]) -> str:
    bits = [f"{rep.get('characterId')}: {rep.get('name', '')} "
            f"({rep.get('role', '')}, {rep.get('historicalStatus', '')})"]
    if rep.get("canonicalDescription"):
        bits.append(str(rep["canonicalDescription"])[:220])
    else:
        bits.append(_entity_brief(rep, "character"))
    return " | ".join(b for b in bits if b)


def compose_prompt_text(scene: Dict[str, Any], bible: Dict[str, Any],
                        ref_assets: List[Dict[str, Any]]) -> str:
    from studio.visual_bible_v2 import find_entity
    reps = [find_entity(bible, "character", cid) for cid in scene.get("characterIds", []) or []]
    reps = [c for c in reps if c]
    subjects = [find_entity(bible, "character", sid) for sid in scene.get("subjectIds", []) or []]
    subjects = [s for s in subjects if s]
    env = find_entity(bible, "environment", scene.get("environmentId")) if scene.get("environmentId") else None
    objs = [find_entity(bible, "object", oid) for oid in scene.get("objectIds", []) or []]
    objs = [o for o in objs if o]
    style = bible.get("projectStyle", {}) or {}
    story = style.get("storyStyle", {}) or {}
    lines = [
        f"SCENE ID: {scene.get('scene_id')}",
        f"VISUAL TYPE: {scene.get('visualType')} (layer: {VISUAL_LAYER.get(scene.get('visualType'), 'STORY')})",
        "",
        "REPRESENTATIVE CAST:",
        *([f"- {_rep_brief(c)}" for c in reps] or ["- none bound (bind cast for individual continuity)"]),
        "",
        "SOURCE SUBJECTS / GROUPS:",
        *([f"- {s.get('characterId') or s.get('subjectId')}: {_entity_brief(s, 'character')}" for s in subjects] or ["- none"]),
        "",
        "ENVIRONMENT:",
        f"- {(env.get('environmentId') + ': ' + _entity_brief(env, 'environment') if env else 'none')}",
        "",
        "OBJECTS:",
        *([f"- {o.get('objectId')}: {_entity_brief(o, 'object')}" for o in objs] or ["- none"]),
        "",
        "STYLE:",
        f"- {style.get('styleName', '')}: {(story.get('renderStyle', ''))}",
        f"- Palette: {story.get('palette', '')}",
        f"- Lighting: {story.get('lighting', '')}",
        "",
        "COMPOSITION:",
        f"- {scene.get('composition', '')}",
        "",
        "VISUAL ACTION:",
        f"- {(scene.get('visual_summary') or '').strip()}",
        "",
        "HISTORICAL CONSTRAINTS:",
        *([f"- {c}" for c in scene.get("historicalConstraints", []) or []] or ["- none"]),
        "",
        "SCIENTIFIC CONSTRAINTS:",
        *([f"- {c}" for c in scene.get("scientificConstraints", []) or []] or ["- none"]),
        "",
        "NEGATIVE CONSTRAINTS:",
        *([f"- {c}" for c in style.get("negativeStyleRules", []) or []] or ["- none"]),
        "",
        "REFERENCE ASSETS:",
        *([f"- {a['assetId']} ({a['view']})" for a in ref_assets] or ["- none"]),
    ]
    return "\n".join(lines).strip() + "\n"


def build_entry(scene: Dict[str, Any], bible: Dict[str, Any]) -> Dict[str, Any]:
    from studio.visual_bible_v2 import compute_entity_prompt_hash
    # bound assets of explicitly bound representatives (+env/object entities):
    bound_ids: List[str] = []
    for coll, ids in (("characters", scene.get("characterIds", []) or []),
                      ("objects", scene.get("objectIds", []) or [])):
        for ent in bible.get(coll, []) or []:
            key = "characterId" if coll == "characters" else "objectId"
            if ent.get(key) in ids:
                bound_ids.extend(ent.get("referenceAssetIds", []) or [])
    if scene.get("environmentId"):
        for ent in bible.get("environments", []) or []:
            if ent.get("environmentId") == scene["environmentId"]:
                bound_ids.extend(ent.get("referenceAssetIds", []) or [])
    ref_assets = [a for a in bible.get("referenceAssets", []) or []
                  if a.get("assetId") in set(bound_ids)]
    rec, reasons = recommend_output(scene)
    entity_hashes = {}
    from studio.visual_bible_v2 import find_entity
    for cid in list(scene.get("characterIds", []) or []) + list(scene.get("subjectIds", []) or []):
        ent = find_entity(bible, "character", cid)
        if ent and cid not in entity_hashes:
            entity_hashes[cid] = compute_entity_prompt_hash(ent, "character")
    if scene.get("environmentId"):
        ent = find_entity(bible, "environment", scene["environmentId"])
        if ent:
            entity_hashes[scene["environmentId"]] = compute_entity_prompt_hash(ent, "environment")
    for oid in scene.get("objectIds", []) or []:
        ent = find_entity(bible, "object", oid)
        if ent:
            entity_hashes[oid] = compute_entity_prompt_hash(ent, "object")
    style = bible.get("projectStyle", {}) or {}
    style_hash = hashlib.sha256(_canonical(
        {k: style.get(k) for k in ("presetId", "presetVersion", "storyStyle",
                                   "explanationStyle", "evidenceStyle",
                                   "negativeStyleRules")}).encode("utf-8")).hexdigest()
    entry = {
        "sceneId": scene.get("scene_id"),
        "visualType": scene.get("visualType"),
        "visualLayer": VISUAL_LAYER.get(scene.get("visualType"), "STORY"),
        "subjectIds": list(scene.get("subjectIds", []) or []),
        "characterIds": list(scene.get("characterIds", []) or []),
        "environmentId": scene.get("environmentId"),
        "objectIds": list(scene.get("objectIds", []) or []),
        "referenceAssetIds": [a["assetId"] for a in ref_assets],
        "recommendedOutputType": rec,
        "recommendationReasons": reasons,
        "selectedOutputType": scene.get("selectedOutputType"),
        "composition": scene.get("composition"),
        "visualAction": (scene.get("visual_summary") or "").strip(),
        "historicalConstraints": list(scene.get("historicalConstraints", []) or []),
        "scientificConstraints": list(scene.get("scientificConstraints", []) or []),
        "negativeConstraints": list(style.get("negativeStyleRules", []) or []),
        "prompt": compose_prompt_text(scene, bible, ref_assets),
        "sourceHashes": {
            "styleHash": style_hash,
            "entityHashes": entity_hashes,
            "sceneHash": scene_prompt_hash(scene),
            "visualBibleHash": bible.get("visualBibleHash"),
        },
        "status": "CURRENT",
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }
    return entry


def load_prompts(project_dir: Path) -> Dict[str, Any]:
    p = Path(project_dir) / "visual_prompts.json"
    if not p.is_file():
        return {"schemaVersion": "1.0.0", "entries": []}
    with open(p, "r", encoding="utf-8") as f:
        return json.load(f)


def save_prompts(project_dir: Path, payload: Dict[str, Any]) -> None:
    payload["updatedAt"] = datetime.now(timezone.utc).isoformat()
    tmp = Path(project_dir) / "visual_prompts.tmp.json"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
    tmp.replace(Path(project_dir) / "visual_prompts.json")


def check_entry_status(entry: Dict[str, Any], scene: Dict[str, Any],
                       bible: Dict[str, Any]) -> Tuple[str, Optional[str]]:
    """Recompute expected hashes; report CURRENT vs OUTDATED + reason."""
    from studio.visual_bible_v2 import compute_entity_prompt_hash, find_entity
    src = entry.get("sourceHashes", {}) or {}
    if scene_prompt_hash(scene) != src.get("sceneHash"):
        return "OUTDATED", "scene composition changed"
    style = bible.get("projectStyle", {}) or {}
    style_hash = hashlib.sha256(_canonical(
        {k: style.get(k) for k in ("presetId", "presetVersion", "storyStyle",
                                   "explanationStyle", "evidenceStyle",
                                   "negativeStyleRules")}).encode("utf-8")).hexdigest()
    if style_hash != src.get("styleHash"):
        return "OUTDATED", "project style changed"
    expected: Dict[str, str] = {}
    for cid in list(scene.get("characterIds", []) or []) + list(scene.get("subjectIds", []) or []):
        ent = find_entity(bible, "character", cid)
        if ent is None:
            return "OUTDATED", f"character {cid} missing"
        expected[cid] = compute_entity_prompt_hash(ent, "character")
    if scene.get("environmentId"):
        ent = find_entity(bible, "environment", scene["environmentId"])
        if ent is None:
            return "OUTDATED", f"environment {scene['environmentId']} missing"
        expected[scene["environmentId"]] = compute_entity_prompt_hash(ent, "environment")
    for oid in scene.get("objectIds", []) or []:
        ent = find_entity(bible, "object", oid)
        if ent is None:
            return "OUTDATED", f"object {oid} missing"
        expected[oid] = compute_entity_prompt_hash(ent, "object")
    if expected != (src.get("entityHashes", {}) or {}):
        return "OUTDATED", "referenced entity changed"
    return "CURRENT", None


def generate_all(project_dir: Path, scene_ids: Optional[List[str]] = None) -> Dict[str, Any]:
    """(Re)build visual prompt entries. Pure derivation, no image generation."""
    from studio.visual_bible_v2 import load_bible
    project_dir = Path(project_dir)
    sp_path = project_dir / "scene_plan.json"
    if not sp_path.is_file():
        raise VisualPromptError("Missing scene_plan.json.")
    bible = load_bible(project_dir)
    if bible is None:
        raise VisualPromptError("Missing visual_bible.json.")
    with open(sp_path, "r", encoding="utf-8") as f:
        scenes = json.load(f).get("scenes", [])
    payload = load_prompts(project_dir)
    payload["schemaVersion"] = "1.0.0"
    payload["generatorVersion"] = "13.0.0"
    by_id = {e.get("sceneId"): e for e in payload.get("entries", [])}
    built = 0
    for sc in scenes:
        sid = sc.get("scene_id")
        if scene_ids is not None and sid not in scene_ids:
            continue
        full = backfill_scene_visual(sc, bible)
        entry = build_entry(full, bible)
        by_id[sid] = entry
        built += 1
    payload["entries"] = [by_id[s.get("scene_id")] for s in scenes if s.get("scene_id") in by_id]
    save_prompts(project_dir, payload)
    return {"built": built, "total": len(payload["entries"])}


# ---------------------------------------------------------------------------
# Veo inheritance (§36–38, read-side view + continuity strategy)
# ---------------------------------------------------------------------------

def _rep_ready_assets(bible: Dict[str, Any], rep_ids: List[str]) -> List[str]:
    """READY reference assets bound to representative characters (§27)."""
    out: List[str] = []
    assets = {a.get("assetId"): a for a in bible.get("referenceAssets", []) or []}
    for cid in rep_ids:
        for ent in bible.get("characters", []) or []:
            if ent.get("characterId") == cid and (
                    ent.get("entityKind") or "SUBJECT_GROUP") == "REPRESENTATIVE_CHARACTER":
                for aid in ent.get("referenceAssetIds", []) or []:
                    if (assets.get(aid) or {}).get("status") == "READY":
                        out.append(aid)
    return out


def continuity_strategy_for_shot(shot: Dict[str, Any], scene: Dict[str, Any],
                                 bible: Dict[str, Any]) -> str:
    """SCENE_REFERENCE ONLY with a valid representative+reference binding (§27);
    PREVIOUS_SHOT_END_FRAME for same-scene continuations; else INDEPENDENT."""
    if _rep_ready_assets(bible, list(scene.get("characterIds", []) or [])):
        return "SCENE_REFERENCE"
    sub_idx = int(shot.get("scene_shot_index", shot.get("index", 1)) or 1)
    if sub_idx > 1:
        return "PREVIOUS_SHOT_END_FRAME"
    return "INDEPENDENT"


def inherit_for_shot(shot: Dict[str, Any], scene: Dict[str, Any],
                     bible: Dict[str, Any],
                     visual_entry: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Canonical refs inherited by a Veo shot (read-side; no file rewrite)."""
    return {
        "shotId": shot.get("shot_id"),
        "sceneId": scene.get("scene_id"),
        "subjectIds": list(scene.get("subjectIds", []) or []),
        "characterIds": list(scene.get("characterIds", []) or []),
        "environmentId": scene.get("environmentId"),
        "objectIds": list(scene.get("objectIds", []) or []),
        "referenceAssetIds": list((visual_entry or {}).get("referenceAssetIds", []) or []),
        "continuityStrategy": continuity_strategy_for_shot(shot, scene, bible),
        "visualBibleVersion": bible.get("schemaVersion"),
        "sourceSceneHash": scene_prompt_hash(scene),
        "visualPromptHash": hashlib.sha256(
            _canonical((visual_entry or {}).get("prompt", "")).encode("utf-8")).hexdigest()
        if visual_entry else None,
    }
