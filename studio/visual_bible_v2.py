"""
UnfoldIQ Phase 13 — Visual Bible V2.

Single canonical identity source: projects/<id>/visual_bible.json with
schemaVersion 2.x (in-place migration, §15 preferred approach).
Legacy alias keys (subjects/props) are preserved read-only for backward
compatibility; V2 readers prefer characters/objects with fallback.

Continuity groups stay co-located in visual_bible.json (§22): identity
ownership is unambiguous (characters/environments/objects/projectStyle),
while continuityGroups remain explicit bindings — no destructive split.

No image generation. Stdlib only.
"""

import hashlib
import json
import logging
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from studio.config import PROJECTS_DIR, BASE_DIR
from studio.scene_planner import compute_file_sha256

logger = logging.getLogger("unfoldiq.visual_bible_v2")

VB_SCHEMA_V2 = "2.0.0"
VB_SCHEMA_V2_1 = "2.1.0"
VB_SCHEMA_V1 = "1.0.0"
VB_MODEL_VERSION = "13.0.0"
VB_MODEL_VERSION_CORRECTIVE = "13.1.0"
LEGACY_CONTINUITY_ENGINE_VERSION = "10.0.0"

# P2 (§15 FINAL-GAPS): source-of-truth contract. V2 owns referenceAssets +
# characters/objects identity trên visual_bible.json; V1 (visual_continuity)
# chỉ derive subjects/environments/props và PHẢI giữ nguyên keys của V2.
V2_OWNED_KEYS = ("referenceAssets", "characters", "objects", "characterCompleteness")

PRESETS_PATH = BASE_DIR / "config" / "visual_style_presets.json"

REFERENCE_VIEWS = ("FRONT", "THREE_QUARTER", "PROFILE", "EXPRESSION", "POSE", "OTHER")
CORE_VIEWS = ("FRONT", "THREE_QUARTER", "PROFILE")
ALLOWED_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp"}
ENTITY_STATUSES = ("NOT_STARTED", "REVIEW", "READY")

# Corrective (§4): semantic entity taxonomy. Groups are NOT individuals.
ENTITY_KINDS = ("SUBJECT_GROUP", "REPRESENTATIVE_CHARACTER", "ANIMAL_SUBJECT")
HISTORICAL_STATUSES = ("RECONSTRUCTED_REPRESENTATIVE", "HISTORICALLY_IDENTIFIED",
                       "GENERIC_BACKGROUND")
_PREDATOR_KEYWORDS = ("predator", "lion", "leopard", "panthera", "hyena",
                      "carnivore", "raptor", "crocodile")

_ID_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_\-]{0,63}$")

# §41: prompt-affecting fields per entity kind (hash-covered).
# Includes legacy Phase 10 field names (species/hair/…): migration preserves
# them on the record, and they still drive prompts — so they still count.
# UI-only metadata (notes/reviewNotes/editorNotes/uiNotes/manualEdited,
# createdAt/updatedAt/status/migration) is ALWAYS excluded.
PROMPT_FIELDS = {
    "character": (
        "characterId", "entityKind", "name", "role", "taxonomy", "demographics",
        "visualDescription", "canonicalDescription", "identityAnchors",
        "clothingRules", "allowedProps", "forbiddenProps",
        "scientificConstraints", "historicalConstraints", "referenceAssetIds",
        "sourceSubjectId", "resolvedSubjectHash", "historicalStatus",
        "recurring",
        "species", "type", "groupSize", "ageProfile", "sexProfile",
        "bodyCharacteristics", "hair", "skinAppearance", "clothing",
        "carriedProps", "visualAnchors",
    ),
    "environment": (
        "environmentId", "name", "period", "locationType", "terrain",
        "vegetation", "weather", "lighting", "visualAnchors",
        "forbiddenElements", "referenceAssetIds",
        "historicalConstraints", "scientificConstraints",
        "biome", "baselineLighting", "baselineWeather",
        "lightingState", "weatherState",
    ),
    "object": (
        "objectId", "name", "period", "visualDescription",
        "referenceAssetIds", "historicalConstraints", "scientificConstraints",
        "description", "type",
    ),
    "style": (
        "presetId", "presetVersion", "visualStyleId", "styleName",
        "storyStyle", "explanationStyle", "evidenceStyle", "negativeStyleRules",
    ),
}

KIND_COLLECTION = {
    "character": "characters",
    "environment": "environments",
    "object": "objects",
}
KIND_ID_KEY = {
    "character": "characterId",
    "environment": "environmentId",
    "object": "objectId",
}


class VisualBibleV2Error(Exception):
    pass


# ---------------------------------------------------------------------------
# Loading / presets
# ---------------------------------------------------------------------------

def resolve_project_dir(project_id: str) -> Path:
    clean = (project_id or "").strip()
    if not clean or ".." in clean or "/" in clean or "\\" in clean:
        raise VisualBibleV2Error(f"Invalid project id: {project_id!r}")
    target = (PROJECTS_DIR / clean).resolve()
    if target.parent != PROJECTS_DIR.resolve() or not target.is_dir():
        raise VisualBibleV2Error(f"Project directory not found: {clean}")
    return target


def load_bible(project_dir: Path) -> Optional[Dict[str, Any]]:
    p = Path(project_dir) / "visual_bible.json"
    if not p.is_file():
        return None
    with open(p, "r", encoding="utf-8") as f:
        return json.load(f)


def save_bible(project_dir: Path, bible: Dict[str, Any]) -> None:
    bible["updatedAt"] = datetime.now(timezone.utc).isoformat()
    tmp = Path(project_dir) / "visual_bible.tmp.json"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(bible, f, indent=2, ensure_ascii=False)
    tmp.replace(Path(project_dir) / "visual_bible.json")


def load_presets() -> List[Dict[str, Any]]:
    if not PRESETS_PATH.is_file():
        return []
    with open(PRESETS_PATH, "r", encoding="utf-8") as f:
        return json.load(f).get("presets", [])


def get_preset(preset_id: str) -> Optional[Dict[str, Any]]:
    for p in load_presets():
        if p.get("presetId") == preset_id:
            return p
    return None


# ---------------------------------------------------------------------------
# Hashing (§41)
# ---------------------------------------------------------------------------

def _canonical(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def compute_entity_prompt_hash(entity: Dict[str, Any], kind: str) -> str:
    fields = PROMPT_FIELDS.get(kind, ())
    payload = {k: entity.get(k) for k in fields if k in entity}
    return hashlib.sha256(_canonical(payload).encode("utf-8")).hexdigest()


def compute_bible_v2_hash(bible: Dict[str, Any]) -> str:
    """Extended bible hash: legacy core + V2 identity keys, UI metadata excluded."""
    try:
        from studio.visual_continuity import _clean_entity_for_hash
    except Exception:
        def _clean_entity_for_hash(obj: Any) -> Any:  # fallback
            if isinstance(obj, dict):
                return {k: _clean_entity_for_hash(v) for k, v in obj.items()
                        if k not in ("notes", "status", "updatedAt", "createdAt",
                                     "manualEdited", "migration")}
            if isinstance(obj, list):
                return [_clean_entity_for_hash(e) for e in obj]
            return obj
    core = {
        "schemaVersion": bible.get("schemaVersion", VB_SCHEMA_V1),
        "subjects": _clean_entity_for_hash(bible.get("subjects", [])),
        "environments": _clean_entity_for_hash(bible.get("environments", [])),
        "periods": _clean_entity_for_hash(bible.get("periods", [])),
        "props": _clean_entity_for_hash(bible.get("props", [])),
        "continuityGroups": _clean_entity_for_hash(bible.get("continuityGroups", [])),
        "visualStyle": _clean_entity_for_hash(bible.get("visualStyle", {})),
        "characters": _clean_entity_for_hash(bible.get("characters", [])),
        "objects": _clean_entity_for_hash(bible.get("objects", [])),
        "referenceAssets": _clean_entity_for_hash(bible.get("referenceAssets", [])),
        "projectStyle": _clean_entity_for_hash(bible.get("projectStyle", {})),
    }
    return hashlib.sha256(_canonical(core).encode("utf-8")).hexdigest()


def script_entity_signature(script: str) -> str:
    """Conservative visual-requirement signature of a script (§13/§40J).

    Wording-only edits keep the signature; added/removed taxa, places or
    persons change it. Used instead of raw script-hash staleness for VB identity.
    """
    try:
        from studio.veo_prompt_generator import extract_proper_nouns, classify_proper_nouns
        nouns = extract_proper_nouns(script or "")
        classified = classify_proper_nouns(nouns)
        payload = {
            "taxa": sorted(set(classified.get("taxa", []))),
            "locations": sorted(set(classified.get("locations", []))),
            "persons": sorted(set(classified.get("persons", []))),
        }
    except Exception:
        payload = {"text": script or ""}
    return hashlib.sha256(_canonical(payload).encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Migration (§15, §45)
# ---------------------------------------------------------------------------

def _default_project_style(legacy_visual_style: Dict[str, Any]) -> Dict[str, Any]:
    preset = get_preset("preset_documentary_photorealism") or {}
    return {
        "presetId": preset.get("presetId", "preset_documentary_photorealism"),
        "presetVersion": preset.get("presetVersion", "1.0.0"),
        "visualStyleId": "style_unfoldiq_hybrid_01",
        "styleName": (legacy_visual_style or {}).get("styleName", "UnfoldIQ Hybrid"),
        "storyStyle": dict(preset.get("storyStyle", {})),
        "explanationStyle": dict(preset.get("explanationStyle", {})),
        "evidenceStyle": dict(preset.get("evidenceStyle", {})),
        "negativeStyleRules": list(preset.get("negativeStyleRules", [])),
        "resolvedStyleSnapshot": {
            "presetId": preset.get("presetId"),
            "presetVersion": preset.get("presetVersion"),
            "legacyVisualStyle": dict(legacy_visual_style or {}),
        },
    }


def classify_legacy_subject(subj: Dict[str, Any]) -> str:
    """Corrective taxonomy (§4): legacy GROUP subjects stay groups; predator-like
    individuals become ANIMAL_SUBJECT. Nothing auto-promotes to representative."""
    if (subj.get("type") or "").upper() == "GROUP":
        return "SUBJECT_GROUP"
    hay = f"{subj.get('species', '')} {subj.get('name', '')} {subj.get('subjectId', '')}".lower()
    if any(k in hay for k in _PREDATOR_KEYWORDS):
        return "ANIMAL_SUBJECT"
    return "SUBJECT_GROUP"


def _subject_to_character(subj: Dict[str, Any]) -> Dict[str, Any]:
    char = _subject_to_character_base(subj)
    char["entityKind"] = classify_legacy_subject(subj)
    return char


def _subject_to_character_base(subj: Dict[str, Any]) -> Dict[str, Any]:
    anchors = list(subj.get("visualAnchors", []) or [])
    for key in ("bodyCharacteristics", "hair", "skinAppearance", "clothing"):
        val = subj.get(key)
        if val and val not in anchors:
            anchors.append(f"{key}: {val}")
    return {
        **{k: v for k, v in subj.items() if k != "subjectId"},
        "characterId": subj.get("subjectId"),
        "role": subj.get("role", "recurring subject"),
        "taxonomy": {
            "speciesOrPopulation": subj.get("species", ""),
            "period": subj.get("period", ""),
        },
        "demographics": {
            "ageGroup": subj.get("ageProfile", ""),
            "sex": subj.get("sexProfile", ""),
            "groupSize": subj.get("groupSize", 1),
        },
        "visualDescription": subj.get("visualDescription", subj.get("bodyCharacteristics", "")),
        "identityAnchors": anchors,
        "clothingRules": ([subj.get("clothing")] if isinstance(subj.get("clothing"), str)
                          else list(subj.get("clothing", []) or [])),
        "allowedProps": list(subj.get("carriedProps", []) or []),
        "forbiddenProps": list(subj.get("forbiddenProps", []) or []),
        "scientificConstraints": list(subj.get("scientificConstraints", []) or []),
        "historicalConstraints": list(subj.get("historicalConstraints", []) or []),
        "referenceAssetIds": list(subj.get("referenceAssetIds", []) or []),
        "status": "REVIEW",
    }


def _env_to_v2(env: Dict[str, Any]) -> Dict[str, Any]:
    return {
        **env,
        "visualAnchors": list(env.get("visualAnchors", []) or []),
        "forbiddenElements": list(env.get("forbiddenElements", []) or []),
        "referenceAssetIds": list(env.get("referenceAssetIds", []) or []),
        "historicalConstraints": list(env.get("historicalConstraints", []) or []),
        "scientificConstraints": list(env.get("scientificConstraints", []) or []),
        "status": env.get("status", "REVIEW"),
    }


def _prop_to_object(prop: Dict[str, Any]) -> Dict[str, Any]:
    obj = {k: v for k, v in prop.items() if k != "propId"}
    obj.update({
        "objectId": prop.get("propId"),
        "visualDescription": prop.get("visualDescription", prop.get("description", prop.get("name", ""))),
        "referenceAssetIds": list(prop.get("referenceAssetIds", []) or []),
        "historicalConstraints": list(prop.get("historicalConstraints", []) or []),
        "scientificConstraints": list(prop.get("scientificConstraints", []) or []),
        "status": prop.get("status", "REVIEW"),
    })
    return obj


def migrate_to_v2(project_dir: Path) -> Dict[str, Any]:
    """In-place migration of visual_bible.json to schema 2.x. Idempotent.

    Fresh 1.x bibles migrate straight to 2.1.0 (taxonomy included).
    Existing 2.0.x bibles get the minor 2.1.0 taxonomy backfill (§69).
    """
    project_dir = Path(project_dir)
    bible = load_bible(project_dir)
    if bible is None:
        raise VisualBibleV2Error("Missing visual_bible.json. Generate the Visual Bible first.")
    schema = str(bible.get("schemaVersion", "1.0.0"))
    if schema.startswith("2.1."):
        return {"migrated": False, "already": True, "bible": bible}
    if schema.startswith("2."):
        return _upgrade_2_0_to_2_1(project_dir, bible)

    pre_hash = compute_file_sha256(project_dir / "visual_bible.json")
    try:
        from studio.visual_continuity import compute_visual_bible_hash as legacy_hash_fn
        pre_bible_hash = legacy_hash_fn(bible)
    except Exception:
        pre_bible_hash = None
    manual_count = sum(1 for coll in ("subjects", "environments", "props")
                       for e in bible.get(coll, []) if e.get("manualEdited"))

    subjects = bible.get("subjects", []) or []
    characters = [_subject_to_character(s) for s in subjects if s.get("subjectId")]
    environments = [_env_to_v2(e) for e in bible.get("environments", [])]
    objects = [_prop_to_object(p) for p in bible.get("props", []) if p.get("propId")]

    script_text = ""
    if (project_dir / "script.txt").is_file():
        script_text = (project_dir / "script.txt").read_text(encoding="utf-8")

    bible["characters"] = characters
    bible["environments"] = environments
    bible["objects"] = objects
    bible["referenceAssets"] = list(bible.get("referenceAssets", []) or [])
    bible["projectStyle"] = _default_project_style(bible.get("visualStyle", {}) or {})
    bible["sourceScriptEntityHash"] = script_entity_signature(script_text)
    bible["migration"] = {
        "fromSchema": bible.get("schemaVersion", "1.0.0"),
        "toSchema": VB_SCHEMA_V2_1,
        "modelVersion": VB_MODEL_VERSION_CORRECTIVE,
        "migratedAt": datetime.now(timezone.utc).isoformat(),
        "idMapping": {
            "characters": {c["characterId"]: c["characterId"] for c in characters},
            "objects": {o["objectId"]: o["objectId"] for o in objects},
        },
        "preservedManualEdits": manual_count,
        "entityCounts": {
            "characters": len(characters), "environments": len(environments),
            "objects": len(objects),
            "continuityGroups": len(bible.get("continuityGroups", []) or []),
        },
        "taxonomy": {
            c["characterId"]: c.get("entityKind") for c in characters
        },
        "previousFileHash": pre_hash,
    }
    bible["schemaVersion"] = VB_SCHEMA_V2_1
    # Continuity engine version stays 10.0.0 (§50: behavior preserved).
    bible["generatorVersion"] = bible.get("generatorVersion", LEGACY_CONTINUITY_ENGINE_VERSION)
    bible["visualBibleHash"] = compute_bible_v2_hash(bible)
    save_bible(project_dir, bible)

    # Rebase dependent stored hash (semantics-preserving migration, not silent edit).
    # Compare against the pre-migration bible hash so entity-preserving
    # migrations rebase cleanly while divergent edits are left untouched.
    rebased: List[str] = []
    veo_path = project_dir / "veo_prompts.json"
    if veo_path.is_file():
        try:
            with open(veo_path, "r", encoding="utf-8") as f:
                veo = json.load(f)
            old_ref = veo.get("sourceVisualBibleHash")
            if old_ref is None or (pre_bible_hash is not None and old_ref == pre_bible_hash):
                veo["sourceVisualBibleHash"] = bible["visualBibleHash"]
                tmp = veo_path.with_suffix(".json.v2tmp")
                with open(tmp, "w", encoding="utf-8") as f:
                    json.dump(veo, f, indent=2, ensure_ascii=False)
                tmp.replace(veo_path)
                rebased.append("veo_prompts.json.sourceVisualBibleHash")
            else:
                logger.info("VB migration: veo sourceVisualBibleHash diverged; rebase skipped.")
        except Exception as e:
            logger.warning(f"VB migration rebase skipped for veo_prompts.json: {e}")

    logger.info(f"Migrated visual_bible.json to {VB_SCHEMA_V2_1} in {project_dir.name}: "
                f"{len(characters)} characters, {len(environments)} envs, {len(objects)} objects")
    return {"migrated": True, "bible": bible, "rebased": rebased,
            "migration": bible["migration"]}


def _upgrade_2_0_to_2_1(project_dir: Path, bible: Dict[str, Any]) -> Dict[str, Any]:
    """Minor compatible upgrade (§69): backfill entityKind taxonomy only.

    No IDs change, no data dropped, manual edits untouched.
    """
    project_dir = Path(project_dir)
    pre_hash = compute_file_sha256(project_dir / "visual_bible.json")
    pre_bible_hash = compute_bible_v2_hash(bible)
    taxonomy: Dict[str, str] = {}
    for char in bible.get("characters", []) or []:
        if not char.get("entityKind"):
            legacy = next((s for s in bible.get("subjects", []) or []
                           if s.get("subjectId") == char.get("characterId")), {})
            char["entityKind"] = classify_legacy_subject({**legacy, **char})
        taxonomy[char["characterId"]] = char["entityKind"]
    mig = bible.get("migration") or {}
    upgrades = list(mig.get("minorUpgrades", []) or [])
    upgrades.append({
        "from": bible.get("schemaVersion"), "to": VB_SCHEMA_V2_1,
        "modelVersion": VB_MODEL_VERSION_CORRECTIVE,
        "upgradedAt": datetime.now(timezone.utc).isoformat(),
        "taxonomy": taxonomy, "previousFileHash": pre_hash,
    })
    mig["minorUpgrades"] = upgrades
    bible["migration"] = mig
    bible["schemaVersion"] = VB_SCHEMA_V2_1
    bible["visualBibleHash"] = compute_bible_v2_hash(bible)
    save_bible(project_dir, bible)
    # Same semantics-preserving rebase as the major migration: the 2.1
    # taxonomy backfill changes no identity, so a matching stored hash
    # is rebased instead of leaving Veo spuriously stale.
    rebased: List[str] = []
    veo_path = project_dir / "veo_prompts.json"
    if veo_path.is_file():
        try:
            with open(veo_path, "r", encoding="utf-8") as f:
                veo = json.load(f)
            old_ref = veo.get("sourceVisualBibleHash")
            if old_ref is None or old_ref == pre_bible_hash:
                veo["sourceVisualBibleHash"] = bible["visualBibleHash"]
                tmp = veo_path.with_suffix(".json.v2tmp")
                with open(tmp, "w", encoding="utf-8") as f:
                    json.dump(veo, f, indent=2, ensure_ascii=False)
                tmp.replace(veo_path)
                rebased.append("veo_prompts.json.sourceVisualBibleHash")
        except Exception as e:
            logger.warning(f"VB 2.1 rebase skipped: {e}")
    logger.info(f"Upgraded visual_bible.json to {VB_SCHEMA_V2_1} in {project_dir.name}")
    return {"migrated": True, "minor": True, "bible": bible,
            "rebased": rebased, "migration": mig}


# ---------------------------------------------------------------------------
# Entity access (V2 keys preferred, legacy aliases fallback)
# ---------------------------------------------------------------------------

def _collection(bible: Dict[str, Any], kind: str) -> List[Dict[str, Any]]:
    coll = KIND_COLLECTION[kind]
    items = bible.get(coll) or []
    if items:
        return items
    # Legacy fallback (pre-migration read path)
    if kind == "character":
        return bible.get("subjects", []) or []
    if kind == "object":
        return bible.get("props", []) or []
    return []


def _legacy_id_key(kind: str) -> str:
    return {"character": "subjectId", "environment": "environmentId",
            "object": "propId"}[kind]


def entity_ids(bible: Dict[str, Any], kind: str) -> List[str]:
    ids: List[str] = []
    for e in _collection(bible, kind):
        eid = e.get(KIND_ID_KEY[kind]) or e.get(_legacy_id_key(kind))
        if eid:
            ids.append(eid)
    return ids


def find_entity(bible: Dict[str, Any], kind: str, entity_id: str) -> Optional[Dict[str, Any]]:
    for e in _collection(bible, kind):
        if e.get(KIND_ID_KEY[kind]) == entity_id or e.get(_legacy_id_key(kind)) == entity_id:
            return e
    return None


def validate_entity_id(entity_id: str) -> str:
    if not entity_id or not _ID_RE.match(entity_id):
        raise VisualBibleV2Error(
            f"Invalid entity id {entity_id!r}: use letters/digits/_/- starting with a letter.")
    return entity_id


def compose_rep_canonical_description(data: Dict[str, Any]) -> str:
    """Production-useful canonical description for a representative character
    (§18). Composed from role/taxonomy/anchors — editable, and never presented
    as excavated fact (see historicalStatus)."""
    tax = data.get("taxonomy", {}) or {}
    demo = data.get("demographics", {}) or {}
    anchors = data.get("identityAnchors", []) or []
    clothing = data.get("clothingRules", []) or []
    bits = [
        f"{data.get('name', data.get('characterId', ''))} — recurring "
        f"{data.get('role', 'role')} reconstructed for documentary scenes.",
        f"Population: {tax.get('speciesOrPopulation', 'unspecified')}; "
        f"period: {tax.get('period', 'unspecified')}.",
        f"Depicted as: {demo.get('ageGroup', 'unspecified')} "
        f"{demo.get('sex', '')}".strip() + ".",
    ]
    if anchors:
        bits.append("Identity anchors: " + "; ".join(anchors[:8]) + ".")
    if clothing:
        bits.append("Clothing: " + "; ".join(clothing[:6]) + ".")
    bits.append("Production identity choice — not a historically documented individual.")
    return " ".join(bits)


def _validate_representative(data: Dict[str, Any], bible: Dict[str, Any]) -> Dict[str, Any]:
    """Enforce rep model (§6–7): source link + explicit historical status."""
    data = dict(data)
    data["entityKind"] = "REPRESENTATIVE_CHARACTER"
    source = data.get("sourceSubjectId")
    if not source:
        raise VisualBibleV2Error("Representative character requires sourceSubjectId.")
    if find_entity(bible, "character", source) is None:
        raise VisualBibleV2Error(f"Unknown sourceSubjectId: {source}")
    status = data.get("historicalStatus", "RECONSTRUCTED_REPRESENTATIVE")
    if status not in HISTORICAL_STATUSES:
        raise VisualBibleV2Error(f"Invalid historicalStatus: {status}")
    data["historicalStatus"] = status
    data.setdefault("recurring", True)
    data.setdefault("status", "REVIEW")
    if not data.get("canonicalDescription"):
        data["canonicalDescription"] = compose_rep_canonical_description(data)
    return data


def create_entity(project_dir: Path, kind: str, data: Dict[str, Any]) -> Dict[str, Any]:
    if kind not in KIND_COLLECTION:
        raise VisualBibleV2Error(f"Unknown entity kind: {kind}")
    project_dir = Path(project_dir)
    bible = load_bible(project_dir)
    if bible is None:
        raise VisualBibleV2Error("Missing visual_bible.json.")
    id_key = KIND_ID_KEY[kind]
    eid = validate_entity_id(str(data.get(id_key) or ""))
    if find_entity(bible, kind, eid):
        raise VisualBibleV2Error(f"{kind} '{eid}' already exists.")
    data = dict(data)
    if kind == "character" and data.get("entityKind") == "REPRESENTATIVE_CHARACTER":
        data = _validate_representative(data, bible)
        # Snapshot the source group constraint hash (live inheritance, §45).
        try:
            source = find_entity(bible, "character", data["sourceSubjectId"])
            data["resolvedSubjectHash"] = compute_entity_prompt_hash(source, "character")
        except Exception:
            pass
    elif kind == "character":
        data.setdefault("entityKind", "SUBJECT_GROUP")
        if data["entityKind"] not in ENTITY_KINDS:
            raise VisualBibleV2Error(f"Invalid entityKind: {data['entityKind']}")
    entity = {"status": "REVIEW", **data, id_key: eid}
    coll = KIND_COLLECTION[kind]
    bible.setdefault(coll, []).append(entity)
    # Keep legacy alias in sync (single source, dual view).
    # Representative characters are V2-only: no legacy subject twin, so legacy
    # readers never mistake an individual for a group subject.
    if kind == "character" and entity.get("entityKind") != "REPRESENTATIVE_CHARACTER":
        legacy = dict(entity)
        legacy["subjectId"] = eid
        legacy.pop("characterId", None)
        bible.setdefault("subjects", []).append(legacy)
    elif kind == "object":
        legacy = dict(entity)
        legacy["propId"] = eid
        legacy.pop("objectId", None)
        bible.setdefault("props", []).append(legacy)
    bible["visualBibleHash"] = compute_bible_v2_hash(bible)
    save_bible(project_dir, bible)
    return entity


def update_entity_v2(project_dir: Path, kind: str, entity_id: str,
                     updates: Dict[str, Any]) -> Tuple[Dict[str, Any], bool]:
    """Update a V2 entity. Returns (entity, prompt_affecting). Syncs legacy alias."""
    if kind not in KIND_COLLECTION:
        raise VisualBibleV2Error(f"Unknown entity kind: {kind}")
    project_dir = Path(project_dir)
    bible = load_bible(project_dir)
    if bible is None:
        raise VisualBibleV2Error("Missing visual_bible.json.")
    target = find_entity(bible, kind, entity_id)
    if target is None:
        raise KeyError(f"{kind} '{entity_id}' not found.")
    id_key = KIND_ID_KEY[kind]
    prompt_fields = set(PROMPT_FIELDS[kind])
    affecting = any(k in prompt_fields for k in updates.keys())
    for k, v in updates.items():
        if k != id_key:
            target[k] = v
    target["manualEdited"] = True
    # Sync legacy alias twin if present
    legacy_coll = {"character": "subjects", "object": "props"}.get(kind)
    if legacy_coll:
        for leg in bible.get(legacy_coll, []):
            if leg.get(_legacy_id_key(kind)) == entity_id:
                for k, v in updates.items():
                    if k != id_key:
                        leg[k] = v
                leg["manualEdited"] = True
                break
    bible["visualBibleHash"] = compute_bible_v2_hash(bible)
    save_bible(project_dir, bible)
    return target, affecting


def delete_entity(project_dir: Path, kind: str, entity_id: str,
                   force: bool = False) -> Dict[str, Any]:
    """Delete only when unreferenced (unless force). Returns impact preview."""
    from studio.visual_dependencies import scenes_referencing_entity
    if kind not in KIND_COLLECTION:
        raise VisualBibleV2Error(f"Unknown entity kind: {kind}")
    project_dir = Path(project_dir)
    affected = scenes_referencing_entity(project_dir, kind, entity_id)
    if affected and not force:
        raise VisualBibleV2Error(
            f"Cannot delete {kind} '{entity_id}': referenced by scenes {affected}. "
            f"Confirm with force=true.")
    bible = load_bible(project_dir)
    if bible is None:
        raise VisualBibleV2Error("Missing visual_bible.json.")
    if find_entity(bible, kind, entity_id) is None:
        raise VisualBibleV2Error(f"Unknown {kind} '{entity_id}': nothing to delete.")
    id_key = KIND_ID_KEY[kind]
    coll = KIND_COLLECTION[kind]
    before = len(bible.get(coll, []) or [])
    bible[coll] = [e for e in bible.get(coll, [])
                   if e.get(id_key) != entity_id and e.get(_legacy_id_key(kind)) != entity_id]
    removed = before - len(bible.get(coll, []) or [])
    legacy_coll = {"character": "subjects", "object": "props"}.get(kind)
    if legacy_coll:
        bible[legacy_coll] = [e for e in bible.get(legacy_coll, [])
                              if e.get(_legacy_id_key(kind)) != entity_id
                              and e.get(id_key) != entity_id]
    if removed == 0:
        raise VisualBibleV2Error(
            f"Delete failed: {kind} '{entity_id}' matched no record in '{coll}'.")
    bible["visualBibleHash"] = compute_bible_v2_hash(bible)
    save_bible(project_dir, bible)
    return {"deleted": True, "affectedScenes": affected}


# ---------------------------------------------------------------------------
# Project style + presets (§18)
# ---------------------------------------------------------------------------

def get_style(project_dir: Path) -> Dict[str, Any]:
    bible = load_bible(project_dir) or {}
    return bible.get("projectStyle") or {}


def update_style(project_dir: Path, style_patch: Dict[str, Any]) -> Dict[str, Any]:
    project_dir = Path(project_dir)
    bible = load_bible(project_dir)
    if bible is None:
        raise VisualBibleV2Error("Missing visual_bible.json.")
    style = bible.get("projectStyle") or {}
    allowed = ("styleName", "storyStyle", "explanationStyle", "evidenceStyle",
               "negativeStyleRules")
    affecting = any(k in allowed for k in style_patch.keys())
    for k in allowed:
        if k in style_patch:
            style[k] = style_patch[k]
    bible["projectStyle"] = style
    bible["visualBibleHash"] = compute_bible_v2_hash(bible)
    save_bible(project_dir, bible)
    return {"style": style, "promptAffecting": affecting}


def apply_preset(project_dir: Path, preset_id: str) -> Dict[str, Any]:
    """Explicit preset adoption: snapshot art direction into project style."""
    preset = get_preset(preset_id)
    if preset is None:
        raise VisualBibleV2Error(f"Unknown style preset: {preset_id}")
    project_dir = Path(project_dir)
    bible = load_bible(project_dir)
    if bible is None:
        raise VisualBibleV2Error("Missing visual_bible.json.")
    style = bible.get("projectStyle") or {}
    style.update({
        "presetId": preset["presetId"],
        "presetVersion": preset["presetVersion"],
        "storyStyle": dict(preset.get("storyStyle", {})),
        "explanationStyle": dict(preset.get("explanationStyle", {})),
        "evidenceStyle": dict(preset.get("evidenceStyle", {})),
        "negativeStyleRules": list(preset.get("negativeStyleRules", [])),
        "resolvedStyleSnapshot": {"presetId": preset["presetId"],
                                  "presetVersion": preset["presetVersion"]},
    })
    bible["projectStyle"] = style
    bible["visualBibleHash"] = compute_bible_v2_hash(bible)
    save_bible(project_dir, bible)
    return {"style": style}


# ---------------------------------------------------------------------------
# Reference assets (§23–26, §68)
# ---------------------------------------------------------------------------

def _assets_root(project_dir: Path) -> Path:
    return Path(project_dir) / "assets" / "references"


def _validate_asset_upload(project_dir: Path, entity_type: str, entity_id: str,
                           view: str, filename: str, data: bytes) -> Tuple[str, Path]:
    if entity_type not in ("CHARACTER", "ENVIRONMENT", "OBJECT"):
        raise VisualBibleV2Error(f"Invalid entityType: {entity_type}")
    if view not in REFERENCE_VIEWS:
        raise VisualBibleV2Error(f"Invalid view: {view}. One of {REFERENCE_VIEWS}.")
    if not data:
        raise VisualBibleV2Error("Empty file.")
    ext = Path(filename or "").suffix.lower()
    if ext not in ALLOWED_IMAGE_EXTS:
        raise VisualBibleV2Error(f"Unsupported image type {ext!r}. Use PNG/JPG/WebP.")
    safe_name = re.sub(r"[^A-Za-z0-9_\-.]", "_", Path(filename).name)
    if not safe_name or safe_name.startswith("."):
        raise VisualBibleV2Error("Invalid filename.")
    dest_dir = _assets_root(project_dir) / {"CHARACTER": "characters",
                                            "ENVIRONMENT": "environments",
                                            "OBJECT": "objects"}[entity_type] / entity_id
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = (dest_dir / f"{view.lower()}{ext}").resolve()
    if _assets_root(project_dir).resolve() not in dest.parents:
        raise VisualBibleV2Error("Path escape blocked.")
    return safe_name, dest


def add_reference_asset(project_dir: Path, entity_type: str, entity_id: str,
                        view: str, filename: str, data: bytes) -> Dict[str, Any]:
    """Store image bytes project-confined + register metadata. Unique assetId."""
    project_dir = Path(project_dir)
    bible = load_bible(project_dir)
    if bible is None:
        raise VisualBibleV2Error("Missing visual_bible.json.")
    kind = {"CHARACTER": "character", "ENVIRONMENT": "environment",
            "OBJECT": "object"}[entity_type]
    ent = find_entity(bible, kind, entity_id)
    if ent is None:
        raise VisualBibleV2Error(f"{kind} '{entity_id}' not found.")
    # Corrective §5: only representative individuals are eligible for
    # FRONT/3-4/PROFILE character references — never a group/animal subject.
    if kind == "character" and (ent.get("entityKind") or "SUBJECT_GROUP") != "REPRESENTATIVE_CHARACTER":
        raise VisualBibleV2Error(
            f"'{entity_id}' is a {ent.get('entityKind') or 'SUBJECT_GROUP'}, not an individual. "
            f"Create a representative character first; groups cannot hold FRONT/3/4/PROFILE identity.")
    _, dest = _validate_asset_upload(project_dir, entity_type, entity_id, view, filename, data)
    asset_id = f"REF_{entity_id.upper()}_{view}"
    existing = bible.get("referenceAssets", []) or []
    if any(a.get("assetId") == asset_id for a in existing):
        raise VisualBibleV2Error(f"assetId '{asset_id}' already exists. Replace instead.")
    dest.write_bytes(data)
    content_hash = hashlib.sha256(data).hexdigest()
    now = datetime.now(timezone.utc).isoformat()
    meta = {
        "assetId": asset_id,
        "entityType": entity_type,
        "entityId": entity_id,
        "view": view,
        "path": str(dest.relative_to(project_dir)).replace("\\", "/"),
        "contentHash": content_hash,
        "status": "READY",
        "createdAt": now,
        "updatedAt": now,
    }
    existing.append(meta)
    bible["referenceAssets"] = existing
    # Auto-bind to entity
    ent = find_entity(bible, kind, entity_id)
    bound = list(ent.get("referenceAssetIds", []) or [])
    if asset_id not in bound:
        bound.append(asset_id)
        ent["referenceAssetIds"] = bound
    bible["visualBibleHash"] = compute_bible_v2_hash(bible)
    save_bible(project_dir, bible)
    logger.info(f"Added reference asset {asset_id} in {project_dir.name}")
    return meta


def resolve_asset_path(project_dir: Path, asset_id: str) -> Path:
    """Return confined absolute path or raise (missing/traversal → error)."""
    bible = load_bible(project_dir) or {}
    meta = next((a for a in bible.get("referenceAssets", []) or []
                 if a.get("assetId") == asset_id), None)
    if meta is None:
        raise VisualBibleV2Error(f"Unknown assetId: {asset_id}")
    root = Path(project_dir).resolve()
    target = (root / meta["path"]).resolve()
    if root not in target.parents or not target.is_file():
        raise VisualBibleV2Error(f"Reference asset unavailable: {asset_id}")
    return target


def replace_reference_asset(project_dir: Path, asset_id: str, filename: str,
                            data: bytes) -> Dict[str, Any]:
    project_dir = Path(project_dir)
    bible = load_bible(project_dir) or {}
    meta = next((a for a in bible.get("referenceAssets", []) or []
                 if a.get("assetId") == asset_id), None)
    if meta is None:
        raise VisualBibleV2Error(f"Unknown assetId: {asset_id}")
    # P1 (§5): archive file ảnh cũ trước khi ghi đè (retain lineage).
    try:
        old_path = (project_dir / meta["path"]).resolve() if meta.get("path") else None
        if old_path and old_path.is_file():
            arch_dir = project_dir / "assets" / "references" / "_archive"
            arch_dir.mkdir(parents=True, exist_ok=True)
            ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
            shutil.copy2(old_path, arch_dir / f"{asset_id}_{ts}{old_path.suffix}")
            meta["previousPath"] = meta.get("path")
    except Exception:
        pass
    _, dest = _validate_asset_upload(project_dir, meta["entityType"], meta["entityId"],
                                     meta["view"], filename, data)
    dest.write_bytes(data)
    meta["contentHash"] = hashlib.sha256(data).hexdigest()
    meta["updatedAt"] = datetime.now(timezone.utc).isoformat()
    meta["path"] = str(dest.relative_to(project_dir)).replace("\\", "/")
    bible["visualBibleHash"] = compute_bible_v2_hash(bible)
    save_bible(project_dir, bible)
    return meta


def remove_reference_asset(project_dir: Path, asset_id: str) -> Dict[str, Any]:
    project_dir = Path(project_dir)
    bible = load_bible(project_dir) or {}
    assets = bible.get("referenceAssets", []) or []
    meta = next((a for a in assets if a.get("assetId") == asset_id), None)
    if meta is None:
        raise VisualBibleV2Error(f"Unknown assetId: {asset_id}")
    root = Path(project_dir).resolve()
    target = (root / meta["path"]).resolve()
    if root in target.parents and target.is_file():
        target.unlink()
    bible["referenceAssets"] = [a for a in assets if a.get("assetId") != asset_id]
    for coll in ("characters", "environments", "objects", "subjects", "props"):
        for ent in bible.get(coll, []) or []:
            bound = ent.get("referenceAssetIds", []) or []
            if asset_id in bound:
                ent["referenceAssetIds"] = [b for b in bound if b != asset_id]
    bible["visualBibleHash"] = compute_bible_v2_hash(bible)
    save_bible(project_dir, bible)
    return {"removed": True, "assetId": asset_id}


def character_completeness(bible: Dict[str, Any], character_id: str) -> Dict[str, Any]:
    """Readiness over FRONT+THREE_QUARTER+PROFILE. Informational only.

    Corrective §5/§20: applies ONLY to REPRESENTATIVE_CHARACTER. Groups and
    animal subjects return NOT_APPLICABLE (never reference-complete).
    Missing entityKind (pre-2.1 data) keeps legacy eligibility.
    """
    ent = find_entity(bible, "character", character_id)
    kind = (ent or {}).get("entityKind")
    if kind and kind != "REPRESENTATIVE_CHARACTER":
        return {"characterId": character_id, "status": "NOT_APPLICABLE",
                "viewsPresent": [], "viewsMissing": list(CORE_VIEWS),
                "reason": f"{kind} is not an individual; create a representative character."}
    views = {a["view"] for a in bible.get("referenceAssets", []) or []
             if a.get("entityType") == "CHARACTER" and a.get("entityId") == character_id
             and a.get("status") == "READY"}
    have = sorted(set(CORE_VIEWS) & views)
    missing = sorted(set(CORE_VIEWS) - views)
    status = "READY" if not missing else ("PARTIAL" if have else "NOT_STARTED")
    out = {"characterId": character_id, "status": status,
           "viewsPresent": have, "viewsMissing": missing}
    if ent is not None:
        derived = rep_derived_status(bible, ent)
        out.update(derived)
    return out


def rep_derived_status(bible: Dict[str, Any], rep: Dict[str, Any]) -> Dict[str, Any]:
    """Live-inheritance state (§45–46): is the rep stale vs its source group?
    Frozen (reference-complete) reps flag REVIEW on conflict instead of silently
    staying READY."""
    source_id = rep.get("sourceSubjectId")
    if not source_id:
        return {"derivedStale": False, "frozenConflict": False}
    source = find_entity(bible, "character", source_id)
    if source is None:
        return {"derivedStale": True, "frozenConflict": False,
                "reason": f"source {source_id} missing"}
    current = compute_entity_prompt_hash(source, "character")
    stale = bool(rep.get("resolvedSubjectHash")) and rep["resolvedSubjectHash"] != current
    frozen = False
    if stale:
        views = {a["view"] for a in bible.get("referenceAssets", []) or []
                 if a.get("entityId") == rep.get("characterId") and a.get("status") == "READY"}
        frozen = bool(set(CORE_VIEWS) <= views)
    return {"derivedStale": stale, "frozenConflict": frozen}


# ---------------------------------------------------------------------------
# Representative cast suggestions (§9–10, suggestion-first, deterministic)
# ---------------------------------------------------------------------------

def rep_derived_status(bible: Dict[str, Any], rep: Dict[str, Any]) -> Dict[str, Any]:
    """Live-inheritance state (§45–46): is the rep stale vs its source group?
    Frozen (reference-complete) reps flag REVIEW on conflict instead of silently
    staying READY."""
    source_id = rep.get("sourceSubjectId")
    if not source_id:
        return {"derivedStale": False, "frozenConflict": False}
    source = find_entity(bible, "character", source_id)
    if source is None:
        return {"derivedStale": True, "frozenConflict": False,
                "reason": f"source {source_id} missing"}
    current = compute_entity_prompt_hash(source, "character")
    stale = bool(rep.get("resolvedSubjectHash")) and rep["resolvedSubjectHash"] != current
    frozen = False
    if stale:
        views = {a["view"] for a in bible.get("referenceAssets", []) or []
                 if a.get("entityId") == rep.get("characterId") and a.get("status") == "READY"}
        frozen = bool(set(CORE_VIEWS) <= views)
    return {"derivedStale": stale, "frozenConflict": frozen}


CAST_SUGGESTION_VERSION = "1.0.0"
CAST_MIN_SCENES = 2  # fewer matches -> weak candidate, never auto-anything

ROLE_PATTERNS = (
    {"role": "primary_caregiver", "label": "Primary caregiver / mother",
     "patterns": (r"\bmother\b", r"\bprimary caregiver\b", r"\bmaternity\b"),
     "demographics": {"ageGroup": "adult", "sex": "female"},
     "roleDesc": "primary caregiver"},
    {"role": "infant", "label": "Infant",
     "patterns": (r"\binfant\b", r"\bbab(?:y|ies)\b", r"\bnewborn\b", r"\bchild\b"),
     "demographics": {"ageGroup": "infant", "sex": "unspecified"},
     "roleDesc": "infant"},
    {"role": "secondary_caregiver", "label": "Secondary / familiar caregiver",
     "patterns": (r"\banother \w+ caregiver\b", r"\bfamiliar caregiver\b",
                  r"\bsecondary caregiver\b", r"\bnot close relatives?\b",
                  r"\balloparent\w*\b", r"\bother \w+ caregiver\b",
                  r"\btrusted caregiver\b"),
     "demographics": {"ageGroup": "adult", "sex": "unspecified"},
     "roleDesc": "secondary caregiver"},
    {"role": "adult_member", "label": "Other recurring adult group member",
     "patterns": (r"\bother people\b", r"\badults?\b", r"\bgroup\b",
                  r"\bparents?\b", r"\bkin\b"),
     "demographics": {"ageGroup": "adult", "sex": "unspecified"},
     "roleDesc": "adult group member"},
)


def _scene_group_subjects(scene: Dict[str, Any], bible: Dict[str, Any]) -> List[str]:
    """Broad group subjects for a scene (group membership, both directions)."""
    out: List[str] = []
    gid = scene.get("continuity_group")
    groups = bible.get("continuityGroups", []) or []
    if not gid:
        for g in groups:
            if scene.get("scene_id") in (g.get("sceneIds", []) or []):
                gid = g.get("continuityGroupId")
                break
    for g in groups:
        if g.get("continuityGroupId") == gid:
            out.extend(g.get("subjectIds", []) or [])
    # default to first hominid-like subject for character scenes without groups
    if not out and (scene.get("category") in ("reconstruction", "transition")
                    or not scene.get("category")):
        for c in bible.get("characters", []) or []:
            if (c.get("entityKind") or "SUBJECT_GROUP") == "SUBJECT_GROUP":
                out.append(c.get("characterId"))
                break
    return out


def analyze_cast_suggestions(project_dir: Path) -> Dict[str, Any]:
    """Propose recurring roles from scene narrations. Never creates anything."""
    from studio.visual_prompt import backfill_scene_visual  # local: cycle-safe
    project_dir = Path(project_dir)
    bible = load_bible(project_dir) or {}
    sp_path = project_dir / "scene_plan.json"
    if not sp_path.is_file():
        raise VisualBibleV2Error("Missing scene_plan.json.")
    with open(sp_path, "r", encoding="utf-8") as f:
        scenes = json.load(f).get("scenes", [])
    existing_reps = {c.get("characterId") for c in bible.get("characters", []) or []
                     if c.get("entityKind") == "REPRESENTATIVE_CHARACTER"}
    suggestions: List[Dict[str, Any]] = []
    for role in ROLE_PATTERNS:
        matches: List[Dict[str, str]] = []
        subjects: Dict[str, int] = {}
        for sc in scenes:
            text = f"{sc.get('narration', '')} {sc.get('visual_summary', '')}"
            hit = None
            for pat in role["patterns"]:
                m = re.search(pat, text, re.IGNORECASE)
                if m:
                    start = max(0, m.start() - 60)
                    hit = text[start:m.end() + 60].strip()
                    break
            if hit:
                for sid in _scene_group_subjects(sc, bible):
                    subjects[sid] = subjects.get(sid, 0) + 1
                matches.append({"sceneId": sc.get("scene_id"), "snippet": hit[:140]})
        if not matches:
            continue
        source = max(subjects, key=subjects.get) if subjects else None
        n = len(matches)
        suggestions.append({
            "suggestionId": f"CAST_{role['role'].upper()}",
            "role": role["role"],
            "label": role["label"],
            "sourceSubjectId": source,
            "matchCount": n,
            "sceneIds": sorted(m["sceneId"] for m in matches),
            "evidence": matches[:5],
            "suggestedRecurring": n >= CAST_MIN_SCENES,
            "strength": "SUGGESTED" if n >= CAST_MIN_SCENES else "WEAK",
            "demographics": role["demographics"],
            "roleDesc": role["roleDesc"],
            "alreadyExists": [],
        })
    # annotate reps that already cover the role+source
    for s in suggestions:
        for c in bible.get("characters", []) or []:
            if (c.get("entityKind") == "REPRESENTATIVE_CHARACTER"
                    and c.get("sourceSubjectId") == s["sourceSubjectId"]
                    and (c.get("role") or "") == (s["roleDesc"] or "")):
                s["alreadyExists"].append(c.get("characterId"))
    payload = {
        "schemaVersion": CAST_SUGGESTION_VERSION,
        "suggestions": suggestions,
        "existingReps": sorted(existing_reps),
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }
    _save_cast_suggestions(project_dir, payload, merge_decisions=True)
    return payload


def _cast_path(project_dir: Path) -> Path:
    return Path(project_dir) / "cast_suggestions.json"


def load_cast_suggestions(project_dir: Path) -> Dict[str, Any]:
    p = _cast_path(project_dir)
    if not p.is_file():
        return {"schemaVersion": CAST_SUGGESTION_VERSION, "suggestions": []}
    with open(p, "r", encoding="utf-8") as f:
        return json.load(f)


def _save_cast_suggestions(project_dir: Path, payload: Dict[str, Any],
                           merge_decisions: bool = False) -> None:
    if merge_decisions and _cast_path(project_dir).is_file():
        try:
            prev = {s.get("suggestionId"): s.get("status")
                    for s in load_cast_suggestions(project_dir).get("suggestions", [])}
            for s in payload.get("suggestions", []):
                if prev.get(s["suggestionId"]) in ("IGNORED", "CREATED", "MERGED"):
                    s["status"] = prev[s["suggestionId"]]
        except Exception:
            pass
    for s in payload.get("suggestions", []):
        s.setdefault("status", "OPEN")
    tmp = Path(project_dir) / "cast_suggestions.tmp.json"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
    tmp.replace(_cast_path(project_dir))


def _set_suggestion_status(project_dir: Path, suggestion_id: str,
                           status: str, **extra: Any) -> Dict[str, Any]:
    payload = load_cast_suggestions(project_dir)
    target = next((s for s in payload.get("suggestions", [])
                   if s.get("suggestionId") == suggestion_id), None)
    if target is None:
        raise VisualBibleV2Error(f"Unknown suggestion: {suggestion_id}")
    target["status"] = status
    target.update(extra)
    payload["updatedAt"] = datetime.now(timezone.utc).isoformat()
    _save_cast_suggestions(project_dir, payload)
    return target


def ignore_cast_suggestion(project_dir: Path, suggestion_id: str) -> Dict[str, Any]:
    return _set_suggestion_status(project_dir, suggestion_id, "IGNORED")


def _rep_id_for(role: str, source: str, taken: set = frozenset()) -> str:
    """Compact stable IDs: char_<species-initials>_<role>[_NN] (e.g. char_hh_primary_caregiver_01)."""
    parts = (source or "").split("_")
    core = [p for p in parts[1:3] if p and p not in ("subject",)]
    tag = "".join(p[0] for p in core) or "xx"
    role_slug = re.sub(r"[^a-z0-9]+", "_", (role or "role").lower()).strip("_")
    base = f"char_{tag}_{role_slug}_01"
    if base not in taken:
        return base[:64]
    n = 2
    while f"char_{tag}_{role_slug}_{n:02d}" in taken:
        n += 1
    return f"char_{tag}_{role_slug}_{n:02d}"[:64]


def create_rep_from_suggestion(project_dir: Path, suggestion_id: str,
                               name: Optional[str] = None) -> Dict[str, Any]:
    """Create a representative character from a suggestion (no auto-binding)."""
    project_dir = Path(project_dir)
    bible = load_bible(project_dir) or {}
    payload = load_cast_suggestions(project_dir)
    sugg = next((s for s in payload.get("suggestions", [])
                 if s.get("suggestionId") == suggestion_id), None)
    if sugg is None:
        raise VisualBibleV2Error(f"Unknown suggestion: {suggestion_id}")
    if not sugg.get("sourceSubjectId"):
        raise VisualBibleV2Error("Suggestion has no source subject; pick one explicitly.")
    source = find_entity(bible, "character", sugg["sourceSubjectId"])
    tax = {}
    if source:
        tax = {"speciesOrPopulation": source.get("species", ""),
               "period": source.get("period", "")}
    if not tax.get("period"):
        periods = bible.get("periods", []) or []
        if periods:
            tax["period"] = periods[0].get("label", periods[0].get("periodId", ""))
    rep_id = _rep_id_for(sugg["role"], sugg["sourceSubjectId"],
                         taken={c.get("characterId") for c in bible.get("characters", []) or []})
    if find_entity(bible, "character", rep_id):
        raise VisualBibleV2Error(f"Representative '{rep_id}' already exists; merge instead.")
    rep = create_entity(project_dir, "character", {
        "characterId": rep_id,
        "entityKind": "REPRESENTATIVE_CHARACTER",
        "name": name or sugg["label"],
        "role": sugg.get("roleDesc", sugg["role"]),
        "sourceSubjectId": sugg["sourceSubjectId"],
        "historicalStatus": "RECONSTRUCTED_REPRESENTATIVE",
        "taxonomy": tax,
        "demographics": dict(sugg.get("demographics", {}) or {}),
        "recurring": bool(sugg.get("suggestedRecurring", True)),
        "identityAnchors": [],
        "clothingRules": [],
    })
    _set_suggestion_status(project_dir, suggestion_id, "CREATED",
                           createdCharacterId=rep_id)
    return rep


def merge_suggestion_into_rep(project_dir: Path, suggestion_id: str,
                              character_id: str, bind_scenes: bool = False) -> Dict[str, Any]:
    """Merge a suggestion into an existing rep; optionally bind its scenes."""
    from studio.visual_dependencies import compute_impact, apply_impact
    project_dir = Path(project_dir)
    bible = load_bible(project_dir) or {}
    rep = find_entity(bible, "character", character_id)
    if rep is None or rep.get("entityKind") != "REPRESENTATIVE_CHARACTER":
        raise VisualBibleV2Error(f"'{character_id}' is not a representative character.")
    payload = load_cast_suggestions(project_dir)
    sugg = next((s for s in payload.get("suggestions", [])
                 if s.get("suggestionId") == suggestion_id), None)
    if sugg is None:
        raise VisualBibleV2Error(f"Unknown suggestion: {suggestion_id}")
    bound: List[str] = []
    if bind_scenes:
        from studio.scene_planner import scene_planner
        for sid in sugg.get("sceneIds", []):
            try:
                with open(project_dir / "scene_plan.json", "r", encoding="utf-8") as f:
                    plan = json.load(f)
                sc = next((x for x in plan.get("scenes", []) if x.get("scene_id") == sid), None)
                if sc is None:
                    continue
                chars = list(sc.get("characterIds", []) or [])
                if character_id not in chars:
                    chars.append(character_id)
                    scene_planner.update_scene(project_dir, sid, {"characterIds": chars})
                    bound.append(sid)
            except Exception as e:
                logger.warning(f"Merge-bind skipped {sid}: {e}")
    _set_suggestion_status(project_dir, suggestion_id, "MERGED",
                           mergedInto=character_id, boundScenes=bound)
    return {"mergedInto": character_id, "boundScenes": bound}


# ---------------------------------------------------------------------------
# Reference prompt pack (§21, §54) — copyable, no image generation
# ---------------------------------------------------------------------------

def build_ref_prompts(project_dir: Path, character_id: str) -> Dict[str, Any]:
    """FRONT / THREE_QUARTER / PROFILE prompts for one representative."""
    project_dir = Path(project_dir)
    bible = load_bible(project_dir) or {}
    rep = find_entity(bible, "character", character_id)
    if rep is None or rep.get("entityKind") != "REPRESENTATIVE_CHARACTER":
        raise VisualBibleV2Error(f"'{character_id}' is not a representative character.")
    source = find_entity(bible, "character", rep.get("sourceSubjectId") or "")
    style = bible.get("projectStyle", {}) or {}
    story = style.get("storyStyle", {}) or {}
    tax = rep.get("taxonomy", {}) or {}
    demo = rep.get("demographics", {}) or {}
    anchors = rep.get("identityAnchors", []) or []
    clothing = rep.get("clothingRules", []) or []
    sci = list(rep.get("scientificConstraints", []) or [])
    hist = list(rep.get("historicalConstraints", []) or [])
    if source:
        sci = list(dict.fromkeys(
            sci + list(source.get("scientificConstraints", []) or [])
            + ([f"Species morphology: {source.get('species', '')}"] if source.get("species") else [])))
        hist = list(dict.fromkeys(
            hist + list(source.get("historicalConstraints", []) or [])))
    neg = list(style.get("negativeStyleRules", []) or [])
    base = [
        f"CHARACTER: {rep.get('name', character_id)} "
        f"({demo.get('ageGroup', '')} {demo.get('sex', '')}, "
        f"{tax.get('speciesOrPopulation', '')}, {tax.get('period', '')})".strip(),
        f"ROLE: {rep.get('role', '')} — reconstructed representative "
        f"(not a historically documented individual).",
        f"STYLE: {style.get('styleName', '')} — {story.get('renderStyle', '')}; "
        f"palette {story.get('palette', '')}; lighting {story.get('lighting', '')}.",
    ]
    if anchors:
        base.append("IDENTITY: " + "; ".join(anchors[:8]) + ".")
    if clothing:
        base.append("CLOTHING: " + "; ".join(clothing[:6]) + ".")
    if sci:
        base.append("SCIENTIFIC CONSTRAINTS: " + "; ".join(sci[:8]) + ".")
    if hist:
        base.append("HISTORICAL CONSTRAINTS: " + "; ".join(hist[:8]) + ".")
    if neg:
        base.append("NEGATIVE: " + "; ".join(neg) + ".")
    front = base + [
        "COMPOSITION: front-facing character reference, neutral standing pose, "
        "simple plain background, minimal unrelated objects, full upper-body "
        "silhouette readable, even light, no action storytelling.",
    ]
    continuity = ("Use the approved FRONT reference as the primary identity. "
                  "Generate the SAME character — do not redesign face, hair, "
                  "clothing, body proportions or art style.")
    three_quarter = base + [
        "COMPOSITION: three-quarter view of the same character, neutral pose, "
        "simple plain background.",
        "CONTINUITY: " + continuity,
    ]
    profile = base + [
        "COMPOSITION: side profile view of the same character, neutral pose, "
        "simple plain background.",
        "CONTINUITY: " + continuity,
    ]
    return {
        "characterId": character_id,
        "sourceSubjectId": rep.get("sourceSubjectId"),
        "historicalStatus": rep.get("historicalStatus"),
        "FRONT": "\n".join(front),
        "THREE_QUARTER": "\n".join(three_quarter),
        "PROFILE": "\n".join(profile),
    }


# ---------------------------------------------------------------------------
# External validation readiness (§34–35, §51)
# ---------------------------------------------------------------------------

DEFAULT_VALIDATION_SCENES = ("scene_035", "scene_040", "scene_044",
                             "scene_001", "scene_005", "scene_002")


def validation_readiness(project_dir: Path) -> Dict[str, Any]:
    """Layered readiness: pipeline health is never conflated with external
    visual readiness. Non-destructive (no ERROR escalation of existing flows)."""
    from studio.visual_prompt import backfill_scene_visual
    project_dir = Path(project_dir)
    bible = load_bible(project_dir) or {}
    migrated = str(bible.get("schemaVersion", "1.0.0")).startswith("2.")
    sp_path = project_dir / "scene_plan.json"
    scenes = {}
    if sp_path.is_file():
        with open(sp_path, "r", encoding="utf-8") as f:
            scenes = {s["scene_id"]: s for s in json.load(f).get("scenes", [])}
    reps = [c for c in bible.get("characters", []) or []
            if c.get("entityKind") == "REPRESENTATIVE_CHARACTER"]
    cast_state = "READY" if reps else "REVIEW"
    if not migrated:
        cast_state = "NOT_STARTED"
    blockers: List[str] = []
    scene_states: Dict[str, Any] = {}
    for sid in DEFAULT_VALIDATION_SCENES:
        sc = scenes.get(sid)
        if sc is None:
            scene_states[sid] = {"state": "MISSING", "missing": ["scene"]}
            blockers.append(f"{sid}: scene missing")
            continue
        full = backfill_scene_visual(dict(sc), bible)
        bound_reps = [cid for cid in full.get("characterIds", []) or []
                      if (find_entity(bible, "character", cid) or {}).get("entityKind")
                      == "REPRESENTATIVE_CHARACTER"]
        missing: List[str] = []
        if full.get("visualType") == "CHARACTER_SCENE" and not bound_reps:
            missing.append("representative cast binding")
        for cid in bound_reps:
            comp = character_completeness(bible, cid)
            if comp["status"] != "READY":
                missing.append(f"references for {cid} ({comp['status']})")
        state = "READY" if not missing else ("REVIEW" if bound_reps else "NOT_READY")
        if missing:
            blockers.append(f"{sid}: " + "; ".join(missing))
        scene_states[sid] = {"state": state, "missing": missing,
                             "characterIds": bound_reps,
                             "subjectIds": full.get("subjectIds", [])}
    ref_states = [character_completeness(bible, c["characterId"])["status"] for c in reps]
    if not reps:
        ref_state = "NOT_STARTED"
    elif all(s == "READY" for s in ref_states):
        ref_state = "READY"
    elif any(s in ("PARTIAL", "READY") for s in ref_states):
        ref_state = "REVIEW"
    else:
        ref_state = "NOT_READY"
    external = "READY_FOR_EXTERNAL_VALIDATION" if not blockers else "BLOCKED"
    return {
        "pipelineHealth": "see /status (unchanged semantics)",
        "visualFoundation": "READY" if migrated else "NOT_STARTED",
        "representativeCast": cast_state,
        "referenceCoverage": ref_state,
        "externalValidation": external,
        "blockers": blockers,
        "validationScenes": scene_states,
        "repCount": len(reps),
    }
