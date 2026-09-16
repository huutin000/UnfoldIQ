"""
UnfoldIQ Visual Continuity Director (Phase 10)
Provides a hidden, project-scoped canonical Visual Bible (visual_bible.json)
for recurring subjects, environments, historical/period constraints, props,
lighting states, and continuity groups.

Ensures strict cross-shot visual continuity while preserving existing
Scene Plan segmentation and Shot count guarantees.
"""

import hashlib
import json
import logging
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple, Set

from studio.prompt_builder import (
    detect_narration_domain,
    extract_proper_nouns,
)
from studio.scene_planner import compute_file_sha256
from studio.veo_prompt_generator import classify_proper_nouns

logger = logging.getLogger("unfoldiq.visual_continuity")

VISUAL_BIBLE_SCHEMA_VERSION = "1.0.0"
VISUAL_CONTINUITY_VERSION = "10.0.0"

# Standard Historical Periods & Forbidden Modern Elements
PERIOD_PROFILES: Dict[str, Dict[str, Any]] = {
    "period_early_pleistocene": {
        "periodId": "period_early_pleistocene",
        "label": "Early Pleistocene (~1.8 Mya)",
        "approxDate": "1.8 Million Years Ago",
        "allowedMaterials": ["unmodified stone", "flaked basalt", "wood", "natural bone", "plant fibers"],
        "forbiddenModernElements": [
            "modern clothing", "stitched fabric", "synthetic textiles", "metal tools",
            "forged metal", "modern buildings", "concrete", "glass windows", "vehicles",
            "electric lighting", "domesticated dogs", "domesticated horses", "plastic",
            "printed signs", "footwear", "jewelry of refined metal"
        ],
        "notes": ["Authentic Pleistocene fauna and flora only. Early Oldowan lithic technology."]
    },
    "period_mid_century_computing": {
        "periodId": "period_mid_century_computing",
        "label": "Mid-20th Century Computing (1940s-1960s)",
        "approxDate": "circa 1940-1969",
        "allowedMaterials": ["vacuum tubes", "magnetic tape", "germanium", "planar silicon", "punch cards", "steel chassis", "bakelite"],
        "forbiddenModernElements": [
            "smartphones", "laptops", "LCD screens", "LED monitors", "flat panel displays",
            "modern USB connectors", "contemporary casual streetwear", "modern plastic keyboards"
        ],
        "notes": ["Period engineering cleanrooms, discrete components, oscilloscopes, tape drives."]
    },
    "period_modern_science": {
        "periodId": "period_modern_science",
        "label": "Contemporary Scientific Era",
        "approxDate": "20th-21st Century",
        "allowedMaterials": ["optical glass", "carbon fiber", "silicon", "cryogenic cooling", "beryllium mirrors"],
        "forbiddenModernElements": ["anachronistic fantasy elements", "unphysical energy weapons"],
        "notes": ["High precision observatories, scientific laboratory instrumentation."]
    },
    "period_general_documentary": {
        "periodId": "period_general_documentary",
        "label": "General Documentary Historical",
        "approxDate": "Historical Context",
        "allowedMaterials": ["historically authentic materials"],
        "forbiddenModernElements": ["anachronistic elements inconsistent with narrated era"],
        "notes": ["Naturalistic documentary reconstruction."]
    }
}


def _clean_entity_for_hash(obj: Any) -> Any:
    """Recursively strip non-prompt metadata keys like notes, reviewNotes, uiNotes, manualEdited, timestamps."""
    ignored_keys = {"notes", "reviewNotes", "editorNotes", "uiNotes", "manualEdited",
                    "updatedAt", "createdAt", "status", "migration"}
    if isinstance(obj, dict):
        return {k: _clean_entity_for_hash(v) for k, v in obj.items() if k not in ignored_keys}
    elif isinstance(obj, list):
        return [_clean_entity_for_hash(elem) for elem in obj]
    return obj


def compute_visual_bible_hash(bible_data: Dict[str, Any]) -> str:
    """
    Compute a deterministic SHA-256 hash over canonical visual entities.
    Ignores volatile timestamps, notes, and status flags to ensure true semantic comparison.
    """
    core_payload = {
        "schemaVersion": bible_data.get("schemaVersion", VISUAL_BIBLE_SCHEMA_VERSION),
        "subjects": _clean_entity_for_hash(bible_data.get("subjects", [])),
        "environments": _clean_entity_for_hash(bible_data.get("environments", [])),
        "periods": _clean_entity_for_hash(bible_data.get("periods", [])),
        "props": _clean_entity_for_hash(bible_data.get("props", [])),
        "continuityGroups": _clean_entity_for_hash(bible_data.get("continuityGroups", [])),
        "visualStyle": _clean_entity_for_hash(bible_data.get("visualStyle", {})),
    }
    raw = json.dumps(core_payload, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def derive_visual_bible_from_scenes(
    scenes: List[Dict[str, Any]],
    script: str = "",
    project_dir: Optional[Path] = None,
) -> Dict[str, Any]:
    """
    Derive candidate Visual Bible from an established Scene Plan.
    Extracts recurring subjects, environments, period constraints, props,
    and constructs continuous visual continuity groups.
    """
    domain = detect_narration_domain(script) if script else "prehistory"
    if not scenes and script:
        scenes = []

    # 1. Determine Historical Period
    if domain == "prehistory":
        period_key = "period_early_pleistocene"
    elif domain == "computing_technology":
        period_key = "period_mid_century_computing"
    elif domain == "astrophysics" or domain == "physics_chemistry":
        period_key = "period_modern_science"
    else:
        period_key = "period_general_documentary"

    primary_period = dict(PERIOD_PROFILES.get(period_key, PERIOD_PROFILES["period_general_documentary"]))
    periods = [primary_period]

    # 2. Extract Entities from Narration & Scene summaries
    subjects: List[Dict[str, Any]] = []
    environments: List[Dict[str, Any]] = []
    props: List[Dict[str, Any]] = []
    continuity_groups: List[Dict[str, Any]] = []

    subject_map: Dict[str, Dict[str, Any]] = {}
    env_map: Dict[str, Dict[str, Any]] = {}
    prop_map: Dict[str, Dict[str, Any]] = {}

    all_nouns: List[str] = []
    for sc in scenes:
        narr = sc.get("narration", "")
        all_nouns.extend(extract_proper_nouns(narr))
    classified_nouns = classify_proper_nouns(list(set(all_nouns)))

    # Process Subjects based on Domain & Nouns
    if domain == "prehistory":
        taxa = classified_nouns.get("taxa", [])
        primary_taxon = taxa[0] if taxa else "Homo habilis"

        subj_id = f"subject_{primary_taxon.lower().replace(' ', '_')}_01"
        subject_map[subj_id] = {
            "subjectId": subj_id,
            "type": "GROUP",
            "name": f"{primary_taxon} social group",
            "species": primary_taxon,
            "groupSize": 4,
            "ageProfile": "mixed adult hominins",
            "sexProfile": "mixed male and female",
            "bodyCharacteristics": f"compact bipedal stature, pronounced brow ridge, authentic {primary_taxon} cranial morphology",
            "hair": "coarse weathered dark body hair",
            "skinAppearance": "dark sun-exposed textured skin with natural field dust",
            "clothing": "none, historically accurate wild hominin state",
            "carriedProps": ["prop_stone_tool_01"],
            "visualAnchors": [
                f"matching adult {primary_taxon} cranial proportions",
                "consistent weathered dark skin tone and natural coarse hair coverage",
                "habitual upright bipedal posture with slight forward lean"
            ],
            "sourceSceneIds": [],
            "manualEdited": False
        }

        # Check for potential predator / fauna in narration
        script_lower = script.lower()
        if any(w in script_lower for w in ["predator", "carnivore", "cat", "hyena", "sabertooth", "leopard"]):
            pred_id = "subject_pleistocene_predator_01"
            subject_map[pred_id] = {
                "subjectId": pred_id,
                "type": "INDIVIDUAL",
                "name": "Pleistocene apex carnivore",
                "species": "Dinofelis / Megantereon",
                "groupSize": 1,
                "ageProfile": "adult predator",
                "sexProfile": "unspecified",
                "bodyCharacteristics": "muscular feline stalking posture with sharp alert gaze",
                "hair": "short tawny coat with subtle camouflaged rosette markings",
                "skinAppearance": "dense predatory fur with muscular definition under raking sunlight",
                "clothing": "none",
                "carriedProps": [],
                "visualAnchors": ["low stalking posture", "tawny camouflaged coat"],
                "sourceSceneIds": [],
                "manualEdited": False
            }

    elif domain == "computing_technology":
        persons = classified_nouns.get("persons", [])
        primary_person = persons[0] if persons else "Alan Turing"
        subj_id = f"subject_{primary_person.lower().replace(' ', '_')}_01"
        subject_map[subj_id] = {
            "subjectId": subj_id,
            "type": "INDIVIDUAL",
            "name": primary_person,
            "species": "Homo sapiens",
            "groupSize": 1,
            "ageProfile": "adult researcher, mid-30s",
            "sexProfile": "male",
            "bodyCharacteristics": "slender intellectual build, focused posture, mid-century grooming",
            "hair": "neatly parted short dark hair",
            "skinAppearance": "pale laboratory complexion",
            "clothing": "period-accurate tailored tweed jacket, wool trousers, knitted tie",
            "carriedProps": ["prop_technical_manuscript_01"],
            "visualAnchors": [f"consistent appearance of {primary_person}", "period-authentic tailoring"],
            "sourceSceneIds": [],
            "manualEdited": False
        }
    else:
        subj_id = "subject_documentary_observer_01"
        subject_map[subj_id] = {
            "subjectId": subj_id,
            "type": "INDIVIDUAL",
            "name": "Documentary subject",
            "species": "Homo sapiens",
            "groupSize": 1,
            "ageProfile": "adult researcher",
            "sexProfile": "neutral",
            "bodyCharacteristics": "focused realistic posture",
            "hair": "natural dark hair",
            "skinAppearance": "naturalistic skin tone",
            "clothing": "practical field documentation attire",
            "carriedProps": [],
            "visualAnchors": ["methodical operational posture"],
            "sourceSceneIds": [],
            "manualEdited": False
        }

    # Environments
    locations = classified_nouns.get("locations", [])
    primary_loc = locations[0] if locations else ("Olduvai Gorge" if domain == "prehistory" else "Research Facility")
    loc_slug = primary_loc.lower().replace(" ", "_")

    if domain == "prehistory":
        env_1 = f"env_{loc_slug}_grassland_01"
        env_map[env_1] = {
            "environmentId": env_1,
            "locationName": f"{primary_loc} Savannah Grassland",
            "biome": "semi-arid Pleistocene grassland with acacia scrub",
            "terrain": "dry riverbed gulley, pale volcanic silt, rocky basalt outcrops",
            "vegetation": "dry golden perennial bunchgrass and sparse flat-topped acacia bushes",
            "periodId": primary_period["periodId"],
            "baselineLighting": "warm directional sunlight with long late-afternoon atmospheric shadows",
            "baselineWeather": "clear arid sky with heat shimmer on distant horizon",
            "visualAnchors": [
                "prominent eroded volcanic ridgeline along background horizon",
                "pale silt riverbed terrace with weathered basalt boulders",
                "sparse drought-resistant acacia thorn scrub"
            ],
            "sourceSceneIds": [],
            "manualEdited": False
        }
        env_2 = f"env_{loc_slug}_riverbed_01"
        env_map[env_2] = {
            "environmentId": env_2,
            "locationName": f"{primary_loc} Dry Riverbed Fluvial Site",
            "biome": "paleo-lake margin and alluvial gravel channel",
            "terrain": "scoured sedimentary river terrace with water-smoothed quartz and basalt cobbles",
            "vegetation": "patches of dry sedges and sparse riverine bushes",
            "periodId": primary_period["periodId"],
            "baselineLighting": "raking sunlight highlighting stone fracture facets and sedimentary strata",
            "baselineWeather": "dry ambient atmosphere with faint dust drift in warm breeze",
            "visualAnchors": [
                "exposed geological stratification layers along the eroded cut-bank",
                "water-deposited cobble gravel bed"
            ],
            "sourceSceneIds": [],
            "manualEdited": False
        }
        # Check if project narration includes fire, campfire, or hearth contexts
        script_lower_all = (script + " " + " ".join(s.get("narration", "") for s in scenes)).lower()
        if any(w in script_lower_all for w in ["fire", "hearth", "campfire", "darkness", "after dark"]):
            env_3 = f"env_{loc_slug}_hearth_site_01"
            env_map[env_3] = {
                "environmentId": env_3,
                "locationName": f"{primary_loc} Nocturnal Campfire Hearth Site",
                "biome": "prehistoric sheltered hearth clearing",
                "terrain": "compacted earth circle around central stone-lined campfire hearth",
                "vegetation": "acacia branch perimeter windbreak",
                "periodId": primary_period["periodId"],
                "baselineLighting": "flickering amber campfire radiance casting protective warm light into surrounding nocturnal shadows",
                "baselineWeather": "still cool night air with gentle rising woodsmoke",
                "visualAnchors": [
                    "central glowing campfire embers and stone hearth boundary",
                    "protective thorn brush perimeter circle"
                ],
                "sourceSceneIds": [],
                "manualEdited": False
            }
    elif domain == "computing_technology":
        env_1 = f"env_{loc_slug}_cleanroom_01"
        env_map[env_1] = {
            "environmentId": env_1,
            "locationName": f"{primary_loc} Engineering Cleanroom",
            "biome": "industrial mid-century technology cleanroom",
            "terrain": "polished linoleum flooring, metal partition walls, workbench tables",
            "vegetation": "none",
            "periodId": primary_period["periodId"],
            "baselineLighting": "cool overhead diffused fluorescent illumination with soft equipment reflections",
            "baselineWeather": "temperature-controlled indoor laboratory atmosphere",
            "visualAnchors": ["period electronics racks with circular dial gauges", "vintage tape reel drives"],
            "sourceSceneIds": [],
            "manualEdited": False
        }
    else:
        env_1 = f"env_{loc_slug}_laboratory_01"
        env_map[env_1] = {
            "environmentId": env_1,
            "locationName": primary_loc,
            "biome": "modern research laboratory setting",
            "terrain": "clean analytical workstations and demonstration benches",
            "vegetation": "none",
            "periodId": primary_period["periodId"],
            "baselineLighting": "balanced diffused daylight illumination",
            "baselineWeather": "controlled ambient environment",
            "visualAnchors": ["clean technical instruments and balanced depth"],
            "sourceSceneIds": [],
            "manualEdited": False
        }

    # Props
    if domain == "prehistory":
        p_id = "prop_stone_tool_01"
        prop_map[p_id] = {
            "propId": p_id,
            "type": "LITHIC_TOOL",
            "name": "Oldowan flaked stone chopper",
            "description": "hand-held basalt cobble with unidirectional flake removals forming a jagged cutting edge",
            "material": "dark volcanic basalt stone",
            "condition": "freshly flaked sharp cutting facets with visible negative flake scars",
            "ownerSubjectId": list(subject_map.keys())[0] if subject_map else None,
            "manualEdited": False
        }
    elif domain == "computing_technology":
        p_id = "prop_silicon_wafer_01"
        prop_map[p_id] = {
            "propId": p_id,
            "type": "SEMICONDUCTOR_ARTIFACT",
            "name": "Early planar integrated circuit substrate",
            "description": "small gold-mounted silicon die with etched interconnect paths and thin wire bonds",
            "material": "silicon crystal substrate and gold bonding wire",
            "condition": "pristine laboratory sample held under inspection loupe",
            "ownerSubjectId": list(subject_map.keys())[0] if subject_map else None,
            "manualEdited": False
        }

    # Associate Scenes to Entities & Build Continuity Groups
    primary_subject_id = list(subject_map.keys())[0] if subject_map else None
    primary_env_id = list(env_map.keys())[0] if env_map else None
    secondary_env_id = list(env_map.keys())[1] if len(env_map) > 1 else primary_env_id
    tertiary_env_id = list(env_map.keys())[2] if len(env_map) > 2 else None
    primary_prop_id = list(prop_map.keys())[0] if prop_map else None

    # Group clustering
    current_cg_idx = 1
    current_cg_scenes: List[str] = []
    current_cg_env = primary_env_id
    current_cg_tag = None
    current_cg_lighting = "late-afternoon warm sunlight"
    current_cg_weather = "dry-clear"

    for i, sc in enumerate(scenes):
        sc_id = sc.get("scene_id", f"scene_{i+1:03d}")
        sc_tag = sc.get("continuity_group")
        sc_narr = (sc.get("narration", "") + " " + sc.get("visual_summary", "")).lower()

        # Decide environment
        if any(w in sc_narr for w in ["river", "fluvial", "cobble", "sediment", "bank", "stream", "alluvial"]):
            assigned_env = secondary_env_id
        elif tertiary_env_id and (
            any(w in sc_narr for w in ["hearth", "campfire", "controlled fire", "making fire", "after dark", "sheltered hearth"]) or
            ("fire" in sc_narr and not any(neg in sc_narr for neg in ["not fire", "even fire", "without fire", "fire was not"]))
        ):
            assigned_env = tertiary_env_id
        else:
            assigned_env = primary_env_id

        # Transition detection
        is_transition = False
        trans_reason = None
        if i > 0:
            if sc.get("category") == "transition":
                is_transition = True
                trans_reason = "category_transition"
            elif (sc_tag is not None and current_cg_tag is not None and sc_tag != current_cg_tag):
                is_transition = True
                trans_reason = f"tag_change:{sc_tag}"
            elif any(phrase in sc_narr for phrase in [
                "later in human evolution",
                "so return to the original scene",
                "modern hunter-gatherer societies",
                "years later",
                "meanwhile",
                "turning to",
                "elsewhere"
            ]):
                is_transition = True
                trans_reason = "thematic_temporal_progression"
            elif assigned_env != current_cg_env:
                is_transition = True
                trans_reason = f"environment_shift:{current_cg_env}->{assigned_env}"

        if is_transition and current_cg_scenes:
            cg_id = f"cg_{current_cg_idx:03d}"
            cg_subs = [primary_subject_id] if primary_subject_id else []
            if "subject_pleistocene_predator_01" in subject_map:
                group_texts = " ".join((sc.get("narration", "") + " " + sc.get("visual_summary", "")).lower() for sc in scenes if sc.get("scene_id") in current_cg_scenes)
                if current_cg_idx == 1 or len(re.findall(r"\b(predator|carnivore|feline|hyena|sabertooth|leopard)\b", group_texts)) >= 2:
                    cg_subs.append("subject_pleistocene_predator_01")
                    if "sourceSceneIds" in subject_map["subject_pleistocene_predator_01"]:
                        subject_map["subject_pleistocene_predator_01"]["sourceSceneIds"].extend(current_cg_scenes)

            continuity_groups.append({
                "continuityGroupId": cg_id,
                "label": f"Continuity Sequence {current_cg_idx}",
                "sceneIds": list(current_cg_scenes),
                "subjectIds": cg_subs,
                "environmentId": current_cg_env,
                "periodId": primary_period["periodId"],
                "persistentPropIds": [primary_prop_id] if primary_prop_id else [],
                "lightingState": current_cg_lighting,
                "weatherState": current_cg_weather,
                "continuityNotes": [f"Bounded by {trans_reason}"] if trans_reason else []
            })
            current_cg_idx += 1
            current_cg_scenes = []

        # Update environment & lighting for next sequence
        if assigned_env == tertiary_env_id:
            current_cg_lighting = "flickering campfire glow against deep nocturnal shadow"
            current_cg_weather = "still night air with rising embers"
        else:
            current_cg_lighting = "late-afternoon warm sunlight"
            current_cg_weather = "dry-clear"

        current_cg_scenes.append(sc_id)
        current_cg_env = assigned_env
        current_cg_tag = sc_tag

        # Attach scene to subject & environment
        if primary_subject_id:
            subject_map[primary_subject_id]["sourceSceneIds"].append(sc_id)
        if assigned_env and assigned_env in env_map:
            env_map[assigned_env]["sourceSceneIds"].append(sc_id)

    # Finalize last continuity group
    if current_cg_scenes:
        cg_id = f"cg_{current_cg_idx:03d}"
        cg_subs = [primary_subject_id] if primary_subject_id else []
        if "subject_pleistocene_predator_01" in subject_map:
            group_texts = " ".join((sc.get("narration", "") + " " + sc.get("visual_summary", "")).lower() for sc in scenes if sc.get("scene_id") in current_cg_scenes)
            if current_cg_idx == 1 or len(re.findall(r"\b(predator|carnivore|feline|hyena|sabertooth|leopard)\b", group_texts)) >= 2:
                cg_subs.append("subject_pleistocene_predator_01")
                if "sourceSceneIds" in subject_map["subject_pleistocene_predator_01"]:
                    subject_map["subject_pleistocene_predator_01"]["sourceSceneIds"].extend(current_cg_scenes)

        continuity_groups.append({
            "continuityGroupId": cg_id,
            "label": f"Continuity Sequence {current_cg_idx}",
            "sceneIds": list(current_cg_scenes),
            "subjectIds": cg_subs,
            "environmentId": current_cg_env,
            "periodId": primary_period["periodId"],
            "persistentPropIds": [primary_prop_id] if primary_prop_id else [],
            "lightingState": current_cg_lighting,
            "weatherState": current_cg_weather,
            "continuityNotes": []
        })

    subjects = list(subject_map.values())
    environments = list(env_map.values())
    props = list(prop_map.values())

    visual_style = {
        "styleName": "documentary_photorealism",
        "renderingTone": "historically and scientifically authentic period documentary reconstruction",
        "colorTreatment": "naturalistic daylight with realistic environmental reflection and authentic atmospheric depth",
        "cameraTreatment": "stable cinematic framing, deliberate physical motivation, no handheld shake or synthetic zoom"
    }

    now_iso = datetime.now(timezone.utc).isoformat()
    raw_bible = {
        "schemaVersion": VISUAL_BIBLE_SCHEMA_VERSION,
        "generatorVersion": VISUAL_CONTINUITY_VERSION,
        "createdAt": now_iso,
        "updatedAt": now_iso,
        "subjects": subjects,
        "environments": environments,
        "periods": periods,
        "props": props,
        "continuityGroups": continuity_groups,
        "visualStyle": visual_style,
    }
    raw_bible["visualBibleHash"] = compute_visual_bible_hash(raw_bible)
    return raw_bible


class VisualContinuityDirector:
    """
    Project-scoped Visual Continuity Director.
    Generates, stores, validates, and manages visual_bible.json.
    """

    def __init__(self):
        pass

    def _atomic_write_file(self, target_path: Path, content: str) -> None:
        """Atomically persist content to target_path using an isolated temporary file."""
        target_path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = target_path.with_name(f"{target_path.name}.tmp_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S%f')}")
        with open(tmp_path, "w", encoding="utf-8") as f:
            f.write(content)
        shutil.move(str(tmp_path), str(target_path))

    def get_visual_bible_path(self, project_dir: Path) -> Path:
        return project_dir / "visual_bible.json"

    def get_visual_bible(self, project_dir: Path) -> Optional[Dict[str, Any]]:
        """Load visual_bible.json from project directory if available."""
        path = self.get_visual_bible_path(project_dir)
        if not path.is_file():
            return None
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Failed to read visual_bible.json in {project_dir}: {e}")
            return None

    def check_visual_bible_status(self, project_dir: Path) -> Dict[str, Any]:
        """Check status of visual_bible.json against scene_plan.json and script.txt."""
        vb_path = self.get_visual_bible_path(project_dir)
        scene_plan_path = project_dir / "scene_plan.json"
        script_path = project_dir / "script.txt"

        if not vb_path.is_file():
            return {
                "status": "Not Generated",
                "subject_count": 0,
                "environment_count": 0,
                "continuity_group_count": 0,
                "stale_reason": None,
                "visual_bible_hash": None,
            }

        try:
            with open(vb_path, "r", encoding="utf-8") as f:
                vb = json.load(f)
        except Exception as e:
            return {
                "status": "Error",
                "subject_count": 0,
                "environment_count": 0,
                "continuity_group_count": 0,
                "stale_reason": f"Corrupted visual_bible.json: {e}",
                "visual_bible_hash": None,
            }

        stale_reasons: List[str] = []
        if scene_plan_path.is_file():
            sp_hash = compute_file_sha256(scene_plan_path)
            if vb.get("sourceScenePlanHash") and sp_hash != vb.get("sourceScenePlanHash"):
                stale_reasons.append("scene_plan.json modified")

        if script_path.is_file():
            # Phase 12/13 (§13, §40J): Visual Bible identity is entity-driven, not
            # wording-driven. Migrated bibles carry sourceScriptEntityHash: purely
            # stylistic script edits keep the signature and do NOT stale identity.
            # Legacy bibles without a signature keep the conservative hash check.
            stored_sig = vb.get("sourceScriptEntityHash")
            if stored_sig:
                try:
                    from studio.visual_bible_v2 import script_entity_signature
                    current_sig = script_entity_signature(
                        script_path.read_text(encoding="utf-8"))
                    if current_sig != stored_sig:
                        stale_reasons.append(
                            "script visual entities changed (taxa/places/persons)")
                except Exception as e:
                    stale_reasons.append(f"script entity check failed: {e}")
            else:
                sc_hash = compute_file_sha256(script_path)
                if vb.get("sourceScriptHash") and sc_hash != vb.get("sourceScriptHash"):
                    stale_reasons.append("script.txt modified")

        if vb.get("generatorVersion") != VISUAL_CONTINUITY_VERSION:
            stale_reasons.append(f"version mismatch (saved={vb.get('generatorVersion')}, current={VISUAL_CONTINUITY_VERSION})")

        status = "Stale" if stale_reasons else "Ready"
        return {
            "status": status,
            "subject_count": len(vb.get("subjects", [])),
            "environment_count": len(vb.get("environments", [])),
            "continuity_group_count": len(vb.get("continuityGroups", [])),
            "stale_reason": "; ".join(stale_reasons) if stale_reasons else None,
            "visual_bible_hash": vb.get("visualBibleHash"),
            "updated_at": vb.get("updatedAt"),
        }

    def derive_and_save(
        self,
        project_dir: Path,
        force: bool = False,
    ) -> Dict[str, Any]:
        """
        Derive canonical Visual Bible from scene_plan.json and script.txt and save atomically.
        If existing file has manual edits and force is True, creates backup archive.
        """
        scene_plan_path = project_dir / "scene_plan.json"
        script_path = project_dir / "script.txt"
        vb_path = self.get_visual_bible_path(project_dir)

        if not scene_plan_path.is_file():
            raise FileNotFoundError(f"Missing scene_plan.json in {project_dir}")

        with open(scene_plan_path, "r", encoding="utf-8") as f:
            sp_data = json.load(f)

        script = ""
        if script_path.is_file():
            with open(script_path, "r", encoding="utf-8") as f:
                script = f.read()

        scenes = sp_data.get("scenes", [])
        existing_vb = self.get_visual_bible(project_dir)

        # Phase 13: never silently downgrade a migrated (schema 2.x) bible by
        # regenerating the legacy-only shape over it. Explicit force archives first.
        if existing_vb and str(existing_vb.get("schemaVersion", "1.0.0")).startswith("2.") and not force:
            raise ValueError(
                "Visual Bible is already migrated to schema 2.x. "
                "Re-derivation would drop V2 identity data; edit V2 entities instead, "
                "or re-run with force=true (archives the migrated bible first).")

        # Check for manual edits preservation or archiving
        if existing_vb:
            has_manual_edits = (
                any(s.get("manualEdited") for s in existing_vb.get("subjects", [])) or
                any(e.get("manualEdited") for e in existing_vb.get("environments", [])) or
                any(p.get("manualEdited") for p in existing_vb.get("props", []))
            )
            if has_manual_edits or (force and existing_vb):
                ts_str = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
                archive_path = project_dir / f"visual_bible_archive_{ts_str}.json"
                try:
                    with open(archive_path, "w", encoding="utf-8") as f:
                        json.dump(existing_vb, f, indent=2, ensure_ascii=False)
                    logger.info(f"Archived visual_bible with manual edits to {archive_path.name}")
                except Exception as e:
                    logger.warning(f"Could not archive visual_bible: {e}")

        # Derive candidate Visual Bible
        candidate = derive_visual_bible_from_scenes(scenes, script=script, project_dir=project_dir)

        # P2 (§15): V1 derive không được xóa dữ liệu do V2 quản lý trên cùng file.
        # V2 là source of truth cho referenceAssets/characters — mang theo sang candidate.
        if existing_vb:
            try:
                from studio.visual_bible_v2 import V2_OWNED_KEYS as _V2_KEYS
            except Exception:
                _V2_KEYS = ("referenceAssets", "characters", "objects", "characterCompleteness")
            for _k in _V2_KEYS:
                if existing_vb.get(_k) and not candidate.get(_k):
                    candidate[_k] = existing_vb.get(_k)

        # Preserve manual edits if not force
        if existing_vb and not force:
            existing_sub_map = {s["subjectId"]: s for s in existing_vb.get("subjects", []) if s.get("manualEdited")}
            for s in candidate.get("subjects", []):
                if s.get("subjectId") in existing_sub_map:
                    s.update(existing_sub_map[s["subjectId"]])

            existing_env_map = {e["environmentId"]: e for e in existing_vb.get("environments", []) if e.get("manualEdited")}
            for e in candidate.get("environments", []):
                if e.get("environmentId") in existing_env_map:
                    e.update(existing_env_map[e["environmentId"]])

            existing_prop_map = {p["propId"]: p for p in existing_vb.get("props", []) if p.get("manualEdited")}
            for p in candidate.get("props", []):
                if p.get("propId") in existing_prop_map:
                    p.update(existing_prop_map[p["propId"]])

        candidate["sourceScenePlanHash"] = compute_file_sha256(scene_plan_path)
        if script_path.is_file():
            candidate["sourceScriptHash"] = compute_file_sha256(script_path)
        # Phase 12/13: persist entity signature so stylistic script edits
        # do not stale canonical identity (§13, §40J).
        try:
            from studio.visual_bible_v2 import script_entity_signature
            candidate["sourceScriptEntityHash"] = script_entity_signature(script)
        except Exception:
            pass
        candidate["visualBibleHash"] = compute_visual_bible_hash(candidate)

        # Validate Visual Bible schema and internal integrity before persisting
        validation_issues = self.validate_bible_schema(candidate)
        errors = [iss for iss in validation_issues if iss.get("severity") == "ERROR"]
        if errors:
            raise ValueError(f"Candidate Visual Bible validation failed: {errors[0].get('message')}")

        # Atomic persistence
        raw_json = json.dumps(candidate, indent=2, ensure_ascii=False)
        self._atomic_write_file(vb_path, raw_json)
        logger.info(f"Successfully generated visual_bible.json in {project_dir} (hash={candidate['visualBibleHash'][:8]})")
        return candidate

    def validate_bible_schema(self, bible: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Validate structural schema of a Visual Bible dictionary."""
        issues: List[Dict[str, Any]] = []
        if not bible.get("subjects"):
            issues.append({"severity": "WARNING", "category": "schema", "message": "Visual Bible has no subjects defined."})
        if not bible.get("environments"):
            issues.append({"severity": "WARNING", "category": "schema", "message": "Visual Bible has no environments defined."})
        if not bible.get("periods"):
            issues.append({"severity": "ERROR", "category": "schema", "message": "Visual Bible has no period constraints."})

        sub_ids = [s.get("subjectId") for s in bible.get("subjects", []) if s.get("subjectId")]
        if len(sub_ids) != len(set(sub_ids)):
            issues.append({"severity": "ERROR", "category": "schema", "message": "Duplicate subjectId detected in Visual Bible."})

        env_ids = [e.get("environmentId") for e in bible.get("environments", []) if e.get("environmentId")]
        if len(env_ids) != len(set(env_ids)):
            issues.append({"severity": "ERROR", "category": "schema", "message": "Duplicate environmentId detected in Visual Bible."})

        cg_ids = [cg.get("continuityGroupId") for cg in bible.get("continuityGroups", []) if cg.get("continuityGroupId")]
        if len(cg_ids) != len(set(cg_ids)):
            issues.append({"severity": "ERROR", "category": "schema", "message": "Duplicate continuityGroupId detected in Visual Bible."})

        return issues

    def validate_continuity(
        self,
        project_dir: Optional[Path] = None,
        bible: Optional[Dict[str, Any]] = None,
        shots: Optional[List[Dict[str, Any]]] = None
    ) -> Dict[str, Any]:
        """
        Comprehensive continuity validation across Visual Bible, Scene Plan, and Veo Shots.
        Returns structured list of issues classified into PASS, WARNING, ERROR.
        Supports both file-based project directory validation and direct in-memory fixtures.
        """
        vb = bible
        if vb is None and project_dir:
            vb = self.get_visual_bible(project_dir)

        issues: List[Dict[str, Any]] = []

        if not vb:
            return {
                "status": "Not Generated",
                "issues": [{"severity": "WARNING", "category": "bible", "message": "Chưa có Visual Bible trong dự án."}],
                "blocking_count": 0,
                "warning_count": 1,
                "pass_count": 0,
            }

        issues.extend(self.validate_bible_schema(vb))

        subject_index = {s["subjectId"]: s for s in vb.get("subjects", [])}
        env_index = {e["environmentId"]: e for e in vb.get("environments", [])}
        period_index = {p["periodId"]: p for p in vb.get("periods", [])}
        prop_index = {pr["propId"]: pr for pr in vb.get("props", [])}
        cg_index = {cg["continuityGroupId"]: cg for cg in vb.get("continuityGroups", [])}

        scenes: List[Dict[str, Any]] = []
        if project_dir:
            scene_plan_path = project_dir / "scene_plan.json"
            if scene_plan_path.is_file():
                try:
                    with open(scene_plan_path, "r", encoding="utf-8") as f:
                        scenes = json.load(f).get("scenes", [])
                except Exception as e:
                    issues.append({"severity": "ERROR", "category": "scene_plan", "message": f"Cannot load scene_plan.json: {e}"})

        if shots is None and project_dir:
            veo_path = project_dir / "veo_prompts.json"
            if veo_path.is_file():
                try:
                    with open(veo_path, "r", encoding="utf-8") as f:
                        shots = json.load(f).get("shots", [])
                except Exception as e:
                    issues.append({"severity": "ERROR", "category": "veo", "message": f"Cannot load veo_prompts.json: {e}"})

        if shots is None:
            shots = []

        # 1. Validate Continuity Group Reference Integrity
        for cg in vb.get("continuityGroups", []):
            cg_id = cg.get("continuityGroupId")
            env_id = cg.get("environmentId")
            period_id = cg.get("periodId")

            if env_id and env_id not in env_index:
                issues.append({
                    "severity": "ERROR",
                    "category": "reference",
                    "groupId": cg_id,
                    "message": f"Continuity group '{cg_id}' references unknown environmentId '{env_id}'."
                })
            if period_id and period_id not in period_index:
                issues.append({
                    "severity": "ERROR",
                    "category": "reference",
                    "groupId": cg_id,
                    "message": f"Continuity group '{cg_id}' references unknown periodId '{period_id}'."
                })
            for sub_id in cg.get("subjectIds", []):
                if sub_id not in subject_index:
                    issues.append({
                        "severity": "ERROR",
                        "category": "reference",
                        "groupId": cg_id,
                        "message": f"Continuity group '{cg_id}' references unknown subjectId '{sub_id}'."
                    })
            for prop_id in cg.get("persistentPropIds", []):
                if prop_id not in prop_index:
                    issues.append({
                        "severity": "ERROR",
                        "category": "reference",
                        "groupId": cg_id,
                        "message": f"Continuity group '{cg_id}' references unknown propId '{prop_id}'."
                    })

        # Validate shot entity references against Visual Bible
        for sh in shots:
            shot_id = sh.get("shot_id") or sh.get("shotNumber") or ""
            for sub_id in sh.get("subjectIds", []):
                if sub_id and sub_id not in subject_index:
                    issues.append({
                        "severity": "ERROR",
                        "category": "reference",
                        "shotId": shot_id,
                        "message": f"Shot '{shot_id}' references unknown subjectId '{sub_id}'."
                    })
            sh_env = sh.get("environmentId")
            if sh_env and sh_env not in env_index:
                issues.append({
                    "severity": "ERROR",
                    "category": "reference",
                    "shotId": shot_id,
                    "message": f"Shot '{shot_id}' references unknown environmentId '{sh_env}'."
                })
            sh_period = sh.get("periodId")
            if sh_period and sh_period not in period_index:
                issues.append({
                    "severity": "ERROR",
                    "category": "reference",
                    "shotId": shot_id,
                    "message": f"Shot '{shot_id}' references unknown periodId '{sh_period}'."
                })
            sh_cg = sh.get("continuityGroupId")
            if sh_cg and sh_cg not in cg_index:
                issues.append({
                    "severity": "ERROR",
                    "category": "reference",
                    "shotId": shot_id,
                    "message": f"Shot '{shot_id}' references unknown continuityGroupId '{sh_cg}'."
                })

        # 2. Validate Shots vs Period Constraints (Forbidden Modern Elements)
        periods = vb.get("periods", [])
        primary_period = periods[0] if periods else {}
        forbidden_tokens = [t.lower() for t in primary_period.get("forbiddenModernElements", [])]

        for sh in shots:
            shot_id = sh.get("shot_id") or sh.get("shotNumber") or ""
            prompt_lower = (sh.get("veo_prompt") or sh.get("visualPrompt") or sh.get("prompt") or "").lower()
            subject_lower = (sh.get("subject") or "").lower()
            action_lower = (sh.get("subject_action") or "").lower()
            env_lower = (sh.get("environment") or "").lower()
            combined_text = f"{prompt_lower} {subject_lower} {action_lower} {env_lower}"

            for forbidden in forbidden_tokens:
                pattern = r'\b' + re.escape(forbidden) + r'\b'
                if re.search(pattern, combined_text):
                    issues.append({
                        "severity": "ERROR",
                        "category": "period_violation",
                        "shotId": shot_id,
                        "sceneId": sh.get("parentSceneId") or sh.get("parent_scene_id") or sh.get("sceneNumber"),
                        "message": f"Shot '{shot_id}' violates period constraint '{primary_period.get('label', 'Unknown')}': contains forbidden element '{forbidden}'."
                    })

        # 3. Validate Character Species Consistency
        for cg in vb.get("continuityGroups", []):
            cg_scenes = set(cg.get("sceneIds", []))
            cg_shots = [s for s in shots if (
                s.get("parentSceneId") in cg_scenes or
                s.get("parent_scene_id") in cg_scenes or
                s.get("continuity_group") == cg.get("continuityGroupId") or
                s.get("continuityGroupId") == cg.get("continuityGroupId")
            )]

            expected_subjects = [subject_index[sid] for sid in cg.get("subjectIds", []) if sid in subject_index]
            for exp_sub in expected_subjects:
                species = (exp_sub.get("species") or "").lower()
                if not species:
                    continue

                for sh in cg_shots:
                    sh_subject = (sh.get("subject") or "").lower()
                    prompt_text = (sh.get("veo_prompt") or sh.get("visualPrompt") or sh.get("prompt") or "").lower()
                    combined_sub = f"{sh_subject} {prompt_text}"

                    if "homo habilis" in species:
                        contradictory_species = ["homo sapiens", "neanderthal", "modern human", "homo erectus"]
                        for bad_spec in contradictory_species:
                            # Avoid false positive on comparison clauses e.g. "unlike modern humans"
                            has_bad = re.search(r'(?<!unlike\s)(?<!not\s)\b' + re.escape(bad_spec) + r'\b', combined_sub)
                            if has_bad and "homo habilis" not in sh_subject:
                                issues.append({
                                    "severity": "ERROR",
                                    "category": "species_mismatch",
                                    "shotId": sh.get("shot_id"),
                                    "groupId": cg.get("continuityGroupId"),
                                    "message": f"Species mismatch in shot '{sh.get('shot_id')}': expected '{species}', found '{bad_spec}'."
                                })

        # 4. Adjacent Shots Validation (Group Size, Clothing, Environment, Weather, Lighting, Props)
        num_word_map = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8}
        def extract_count(txt: str) -> Optional[int]:
            m = re.search(r'\b(one|two|three|four|five|six|seven|eight|\d+)\s+(?:subjects?|individuals?|adults?|hominins?|humans?|figures?|caregivers?|people)', txt)
            if m:
                v = m.group(1)
                return num_word_map.get(v, int(v) if v.isdigit() else None)
            return None

        for i in range(len(shots) - 1):
            sh_a = shots[i]
            sh_b = shots[i + 1]
            parent_a = sh_a.get("parentSceneId") or sh_a.get("parent_scene_id")
            parent_b = sh_b.get("parentSceneId") or sh_b.get("parent_scene_id")
            cg_a = sh_a.get("continuityGroupId") or sh_a.get("continuity_group")
            cg_b = sh_b.get("continuityGroupId") or sh_b.get("continuity_group")

            txt_a = f"{sh_a.get('subject') or ''} {sh_a.get('veo_prompt') or sh_a.get('visualPrompt') or ''}".lower()
            txt_b = f"{sh_b.get('subject') or ''} {sh_b.get('veo_prompt') or sh_b.get('visualPrompt') or ''}".lower()

            # A. Group Size Consistency within same scene
            if parent_a and parent_a == parent_b:
                cnt_a = extract_count(txt_a)
                cnt_b = extract_count(txt_b)
                if cnt_a and cnt_b and cnt_a != cnt_b:
                    has_exit_or_entry = any(w in txt_b or w in txt_a for w in ["leaves frame", "leaves the group", "departs", "runs away", "joins", "arrive", "separated", "enters frame", "remain", "remaining"])
                    if not has_exit_or_entry:
                        issues.append({
                            "severity": "WARNING",
                            "category": "group_size_mismatch",
                            "shotId": sh_b.get("shot_id"),
                            "message": f"Unexplained group size change from {cnt_a} to {cnt_b} between consecutive shots '{sh_a.get('shot_id')}' and '{sh_b.get('shot_id')}'."
                        })

            # B. Clothing Consistency within same scene
            if parent_a and parent_a == parent_b:
                garments = ["hide garment", "animal skin", "linen robe", "tailored tweed jacket", "modern coat", "wool tunic"]
                found_a = [g for g in garments if g in txt_a]
                found_b = [g for g in garments if g in txt_b]
                if found_a and found_b and found_a[0] != found_b[0]:
                    has_wardrobe_change = any(w in txt_b for w in ["changes into", "puts on", "removes", "sheds", "dons", "wardrobe change"])
                    if not has_wardrobe_change:
                        issues.append({
                            "severity": "WARNING",
                            "category": "clothing_mismatch",
                            "shotId": sh_b.get("shot_id"),
                            "message": f"Sudden clothing change from '{found_a[0]}' to '{found_b[0]}' between consecutive shots without transition."
                        })

            # C. Environment Mismatch within same continuity group
            if cg_a and cg_b and cg_a == cg_b:
                env_a = (sh_a.get("environment") or "").lower()
                env_b = (sh_b.get("environment") or "").lower()
                incompatible_biomes = [
                    ("grassland", "rainforest"),
                    ("savannah", "rainforest"),
                    ("desert", "snowy"),
                    ("savannah", "laboratory"),
                    ("semi-arid", "dense jungle")
                ]
                for b1, b2 in incompatible_biomes:
                    if (b1 in env_a and b2 in env_b) or (b2 in env_a and b1 in env_a):
                        has_env_transition = any(w in txt_b for w in ["transition", "journey", "reaches", "travels to", "arrives at", "moves into"])
                        if not has_env_transition:
                            issues.append({
                                "severity": "ERROR",
                                "category": "environment_mismatch",
                                "shotId": sh_b.get("shot_id"),
                                "message": f"Contradictory environment shift from '{env_a}' to '{env_b}' within continuity group '{cg_a}' without transition."
                            })

            # D. Weather Mismatch within same scene
            if parent_a and parent_a == parent_b:
                weath_a = f"{sh_a.get('weather') or ''} {txt_a}".lower()
                weath_b = f"{sh_b.get('weather') or ''} {txt_b}".lower()
                is_dry_a = any(w in weath_a for w in ["clear dry", "sunny", "arid sky", "dry weather"])
                is_storm_b = any(w in weath_b for w in ["heavy rain", "torrential rain", "downpour", "storm"])
                if is_dry_a and is_storm_b:
                    has_weather_prog = any(w in weath_b for w in ["cloud build-up", "clouds gather", "gradual storm", "approaching storm"])
                    if not has_weather_prog:
                        issues.append({
                            "severity": "WARNING",
                            "category": "weather_mismatch",
                            "shotId": sh_b.get("shot_id"),
                            "message": f"Sudden weather jump from clear dry to heavy rain within same scene '{parent_a}'."
                        })

            # E. Lighting Jump within same scene
            if parent_a and parent_a == parent_b:
                light_a = (sh_a.get("lighting") or "").lower()
                light_b = (sh_b.get("lighting") or "").lower()
                if ("daylight" in light_a or "noon" in light_a or "sun" in light_a) and ("night" in light_b or "midnight" in light_b):
                    issues.append({
                        "severity": "WARNING",
                        "category": "lighting_jump",
                        "shotId": sh_b.get("shot_id"),
                        "message": f"Sudden lighting shift from '{sh_a.get('lighting')}' to '{sh_b.get('lighting')}' within same scene."
                    })

            # F. Prop Disappearance & Owner Mismatch
            if parent_a and parent_a == parent_b:
                for prop in vb.get("props", []):
                    p_name = (prop.get("name") or "").lower()
                    p_owner = prop.get("ownerSubjectId")
                    if p_name and p_name in txt_a:
                        # If prop disappeared without intentional drop/placement
                        if ("hands are empty" in txt_b or "empty hands" in txt_b or "without the tool" in txt_b):
                            has_drop = any(w in txt_b for w in ["dropped", "put down", "set down", "placed on ground", "leaves behind", "handed to"])
                            if not has_drop:
                                issues.append({
                                    "severity": "WARNING",
                                    "category": "prop_disappearance",
                                    "shotId": sh_b.get("shot_id"),
                                    "message": f"Persistent prop '{p_name}' disappeared without intentional action in shot '{sh_b.get('shot_id')}'."
                                })
                        # Prop owner mismatch
                        if p_owner and "handed to" not in txt_b and "takes the" not in txt_b and "passes" not in txt_b:
                            for other_sub_id, other_sub in subject_index.items():
                                if other_sub_id != p_owner:
                                    other_name = (other_sub.get("name") or "").lower()
                                    if other_name and other_name in txt_b and f"held by {other_name}" in txt_b:
                                        issues.append({
                                            "severity": "WARNING",
                                            "category": "prop_owner_mismatch",
                                            "shotId": sh_b.get("shot_id"),
                                            "message": f"Prop '{p_name}' assigned to '{p_owner}' appears with '{other_sub_id}' without handoff."
                                        })

        # 5. Lighting 3-step Oscillation (late afternoon -> midnight -> midday)
        for i in range(len(shots) - 2):
            sh1 = shots[i]
            sh2 = shots[i + 1]
            sh3 = shots[i + 2]
            p1 = sh1.get("parentSceneId") or sh1.get("parent_scene_id")
            p3 = sh3.get("parentSceneId") or sh3.get("parent_scene_id")
            if p1 and p1 == p3:
                l1 = f"{sh1.get('lighting') or ''} {sh1.get('veo_prompt') or ''}".lower()
                l2 = f"{sh2.get('lighting') or ''} {sh2.get('veo_prompt') or ''}".lower()
                l3 = f"{sh3.get('lighting') or ''} {sh3.get('veo_prompt') or ''}".lower()
                if ("afternoon" in l1 or "midday" in l1 or "day" in l1) and ("midnight" in l2 or "night" in l2) and ("midday" in l3 or "noon" in l3 or "day" in l3):
                    issues.append({
                        "severity": "ERROR",
                        "category": "lighting_jump",
                        "shotId": sh3.get("shot_id"),
                        "message": f"Erratic lighting oscillation (day -> night -> day) within continuous scene '{p1}'."
                    })

        blocking_count = sum(1 for i in issues if i["severity"] == "ERROR")
        warning_count = sum(1 for i in issues if i["severity"] == "WARNING")
        pass_count = 1 if blocking_count == 0 else 0

        status = "Ready" if blocking_count == 0 else "Review"
        if not vb:
            status = "Not Generated"

        return {
            "status": status,
            "issues": issues,
            "blocking_count": blocking_count,
            "warning_count": warning_count,
            "pass_count": pass_count,
        }

    def build_compact_continuity_anchor(
        self,
        arg1: Any,
        arg2: Any = None,
    ) -> Optional[str]:
        """
        Produce a compact, high-signal continuity anchor clause for Veo shot prompts.
        Supports both:
        - (shot_or_scene: Dict, visual_bible: Dict)
        - (visual_bible: Dict, continuity_group_id: Optional[str])
        """
        if isinstance(arg1, dict) and "schemaVersion" in arg1:
            visual_bible = arg1
            continuity_group_id = arg2
            shot_or_scene = {}
        else:
            shot_or_scene = arg1 if isinstance(arg1, dict) else {}
            visual_bible = arg2 if isinstance(arg2, dict) else None
            continuity_group_id = shot_or_scene.get("continuity_group") or shot_or_scene.get("continuityGroupId")

        if not visual_bible or not continuity_group_id:
            return None

        cg = None
        for g in visual_bible.get("continuityGroups", []):
            if g.get("continuityGroupId") == continuity_group_id or g.get("label") == continuity_group_id:
                cg = g
                break

        clauses: List[str] = [f"matching {continuity_group_id} visual sequence"]

        if cg:
            subject_index = {s["subjectId"]: s for s in visual_bible.get("subjects", [])}
            env_index = {e["environmentId"]: e for e in visual_bible.get("environments", [])}

            for sub_id in cg.get("subjectIds", []):
                sub = subject_index.get(sub_id)
                if sub:
                    anchors = sub.get("visualAnchors", [])
                    if anchors:
                        clauses.append(anchors[0])
                    else:
                        clauses.append(f"consistent {sub.get('species') or sub.get('name')} morphology")

            env_id = cg.get("environmentId")
            if env_id and env_id in env_index:
                env = env_index[env_id]
                anchors = env.get("visualAnchors", [])
                if anchors:
                    clauses.append(anchors[0])
                elif env.get("baselineLighting"):
                    clauses.append(env["baselineLighting"])

        return ", ".join(clauses)

    def update_entity(
        self,
        project_dir: Path,
        entity_type: str,
        entity_id: str,
        updates: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        Manually edit a visual entity (subject, environment, prop, continuityGroup).
        Marks the entity as manualEdited: True and recomputes the visualBibleHash.
        """
        project_dir = Path(project_dir)
        vb_path = self.get_visual_bible_path(project_dir)
        if not vb_path.is_file():
            raise FileNotFoundError(f"visual_bible.json not found in {project_dir}")

        with open(vb_path, "r", encoding="utf-8") as f:
            vb = json.load(f)

        collection_key = {
            "subject": "subjects",
            "subjects": "subjects",
            "environment": "environments",
            "environments": "environments",
            "period": "periods",
            "periods": "periods",
            "prop": "props",
            "props": "props",
            "continuityGroup": "continuityGroups",
            "continuityGroups": "continuityGroups",
        }.get(entity_type)

        if not collection_key or collection_key not in vb:
            raise ValueError(f"Invalid entity_type '{entity_type}'. Must be one of: subject, environment, period, prop, continuityGroup.")

        id_key = {
            "subjects": "subjectId",
            "environments": "environmentId",
            "periods": "periodId",
            "props": "propId",
            "continuityGroups": "continuityGroupId",
        }[collection_key]

        target = None
        for item in vb[collection_key]:
            if item.get(id_key) == entity_id:
                target = item
                break

        if not target:
            raise KeyError(f"Entity '{entity_id}' not found in {collection_key}.")

        PROMPT_AFFECTING_KEYS = {
            "name", "species", "groupSize", "ageProfile", "sexProfile",
            "bodyCharacteristics", "hair", "skinAppearance", "clothing",
            "carriedProps", "visualAnchors", "biome", "terrain",
            "vegetation", "baselineLighting", "baselineWeather",
            "lightingState", "weatherState", "styleName", "renderingTone",
            "colorPalette", "cinematographyStyle", "primaryLens",
            "grainLevel", "eraName", "timeSpan", "keyAestheticTraits",
            "subjectIds", "environmentId", "periodId", "persistentPropIds"
        }

        is_prompt_affecting = any(k in PROMPT_AFFECTING_KEYS for k in updates.keys())

        for k, v in updates.items():
            if k != id_key:
                target[k] = v

        target["manualEdited"] = True
        # Phase 13: mirror legacy alias edits into the V2 twin so the dual
        # view never diverges (single canonical source).
        if str(vb.get("schemaVersion", "1.0.0")).startswith("2."):
            twin_coll = {"subjects": ("characters", "characterId", "subjectId"),
                         "props": ("objects", "objectId", "propId")}.get(collection_key)
            if twin_coll:
                coll_name, twin_id_key, legacy_id_key = twin_coll
                for twin in vb.get(coll_name, []) or []:
                    if twin.get(twin_id_key) == entity_id or twin.get(legacy_id_key) == entity_id:
                        for k, v in updates.items():
                            if k not in (id_key, legacy_id_key, twin_id_key):
                                twin[k] = v
                        twin["manualEdited"] = True
                        break
        vb["updatedAt"] = datetime.now(timezone.utc).isoformat()
        # Phase 13: migrated (schema 2.x) bibles keep the V2 hash so legacy
        # alias edits never downgrade/clobber the canonical V2 hash.
        try:
            from studio.visual_bible_v2 import compute_bible_v2_hash
            if str(vb.get("schemaVersion", "1.0.0")).startswith("2."):
                vb["visualBibleHash"] = compute_bible_v2_hash(vb)
            else:
                vb["visualBibleHash"] = compute_visual_bible_hash(vb)
        except Exception:
            vb["visualBibleHash"] = compute_visual_bible_hash(vb)

        self._atomic_write_file(vb_path, json.dumps(vb, indent=2, ensure_ascii=False))
        logger.info(f"Updated {entity_type} '{entity_id}' in visual_bible.json (new hash={vb['visualBibleHash'][:8]})")

        if is_prompt_affecting:
            self.invalidate_affected_shots(project_dir, entity_id=entity_id, entity_type=entity_type)

        return target

    def invalidate_affected_shots(
        self,
        target: Any,
        modified_entity_ids: Any = None,
        entity_id: Optional[str] = None,
        entity_type: Optional[str] = None,
    ) -> Any:
        """
        Identify and mark shots affected by modified visual entities as outdated.
        Supports:
        - target: Path, modified_entity_ids: List[str] -> returns List[str] affected shot_ids
        - target: List[Dict], entity_type: str, entity_id: str -> mutates shots in-place, returns count int
        """
        # Case A: target is a list of shot dictionaries (in-memory test/execution)
        if isinstance(target, list):
            shots = target
            eid = entity_id or (modified_entity_ids if isinstance(modified_entity_ids, str) else None)
            etype = entity_type or ""
            count = 0

            is_global = etype in ("period", "periods", "visualStyle", "global") or eid in ("period_global", "global")

            for sh in shots:
                sh_subs = set(sh.get("subjectIds", []))
                sh_env = sh.get("environmentId")
                sh_cg = sh.get("continuityGroupId") or sh.get("continuity_group")
                sh_props = set(sh.get("propIds", []))

                match = is_global
                if not match and eid:
                    if eid in sh_subs or eid == sh_env or eid == sh_cg or eid in sh_props:
                        match = True

                if match:
                    sh["outdated"] = True
                    count += 1

            return count

        # Case B: target is a project directory Path
        project_dir = Path(target)
        veo_path = project_dir / "veo_prompts.json"
        if not veo_path.is_file():
            return []

        with open(veo_path, "r", encoding="utf-8") as f:
            veo_data = json.load(f)

        vb_path = project_dir / "visual_bible.json"
        cg_map: Dict[str, Dict[str, Any]] = {}
        if vb_path.is_file():
            try:
                vb_data = json.loads(vb_path.read_text(encoding="utf-8"))
                for cg in vb_data.get("continuityGroups", []):
                    cg_map[cg.get("continuityGroupId")] = cg
            except Exception:
                pass

        affected_shot_ids: List[str] = []
        if isinstance(modified_entity_ids, str):
            mod_set = {modified_entity_ids}
        elif isinstance(modified_entity_ids, (list, set)):
            mod_set = set(modified_entity_ids)
        else:
            mod_set = {entity_id} if entity_id else set()

        is_global = (
            entity_type in ("period", "periods", "visualStyle", "global")
            or "period_global" in mod_set
            or "visualStyle" in mod_set
            or "global" in mod_set
            or any("period" in str(m) for m in mod_set)
        )

        for sh in veo_data.get("shots", []):
            sh_id = sh.get("shot_id")
            sh_cg = sh.get("continuityGroupId") or sh.get("continuity_group")
            sh_subs = set(sh.get("subjectIds", []))
            sh_env = sh.get("environmentId")
            sh_prop = set(sh.get("propIds", []))

            cg_info = cg_map.get(sh_cg, {})
            cg_subs = set(cg_info.get("subjectIds", []))
            cg_env = cg_info.get("environmentId")
            cg_props = set(cg_info.get("persistentPropIds", []))

            all_subs = sh_subs | cg_subs
            all_props = sh_prop | cg_props

            match = (
                is_global
                or (sh_cg in mod_set)
                or (sh_env in mod_set)
                or (cg_env in mod_set)
                or bool(all_subs & mod_set)
                or bool(all_props & mod_set)
            )

            if match:
                affected_shot_ids.append(sh_id)
                sh["outdated"] = True

        if affected_shot_ids:
            self._atomic_write_file(veo_path, json.dumps(veo_data, indent=2, ensure_ascii=False))

        return affected_shot_ids


# Global singleton instance
visual_continuity_director = VisualContinuityDirector()
