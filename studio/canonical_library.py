"""
UnfoldIQ Global Canonical Asset Library & Visual Bible Bindings — Phase 14
Principles:
- Canonical entities are the source of truth for identities.
- Reuse: Characters, environments, objects are created once in the Global Library and reused across projects.
- Three tiers:
    1. GLOBAL CANONICAL LIBRARY (library/characters, environments, objects, styles)
    2. PROJECT VISUAL BIBLE (Project-level wardrobe locks, lighting, continuity constraints)
    3. SCENE BINDINGS (Scene references canonical entities)
- Canonical Reference Coverage: FRONT, THREE_QUARTER, PROFILE, FULL_BODY.
- Separation of concerns: Human-readable display names (vi/en) + Flow friendly names (@name) + System IDs (char_...).
"""

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, Optional, List

from studio.config import BASE_DIR

logger = logging.getLogger("unfoldiq.canonical_library")

LIBRARY_DIR = BASE_DIR / "library"
CHARACTERS_DIR = LIBRARY_DIR / "characters"
ENVIRONMENTS_DIR = LIBRARY_DIR / "environments"
OBJECTS_DIR = LIBRARY_DIR / "objects"
STYLES_DIR = LIBRARY_DIR / "styles"
MEDIA_DIR = LIBRARY_DIR / "media"

for d in (CHARACTERS_DIR, ENVIRONMENTS_DIR, OBJECTS_DIR, STYLES_DIR, MEDIA_DIR):
    d.mkdir(parents=True, exist_ok=True)

# Bootstrap Human Origins Canonical Assets
HUMAN_ORIGINS_CHARACTERS = [
    {
        "id": "char_hh_primary_caregiver_01",
        "type": "character",
        "displayName": {
            "vi": "Người chăm sóc chính / Mẹ",
            "en": "Primary caregiver / mother"
        },
        "flowName": "Homo habilis Mother",
        "species": "Homo habilis",
        "period": "Early Pleistocene",
        "sex": "female",
        "ageClass": "adult",
        "role": "primary_caregiver",
        "status": "APPROVED",
        "isLocked": True,
        "description": "Adult female Homo habilis with weathered skin, natural dark body hair, maternal gaze, authentic hominin cranial morphology.",
        "referencePackName": {
            "vi": "Bộ tham chiếu chuẩn nhân vật — Người mẹ",
            "en": "Canonical Character Reference Pack — Mother"
        },
        "referencePack": {
            "FRONT": {"file": "ref_hh_mother_front.png", "policy": "REQUIRED", "labelVi": "Chính diện"},
            "THREE_QUARTER": {"file": "ref_hh_mother_three_quarter.png", "policy": "REQUIRED", "labelVi": "Góc 3/4"},
            "PROFILE": {"file": "ref_hh_mother_profile.png", "policy": "REQUIRED", "labelVi": "Góc nghiêng"},
            "FULL_BODY": {"file": "ref_hh_mother_full_body.png", "policy": "RECOMMENDED", "labelVi": "Toàn thân"}
        },
        "referenceCoverage": {
            "FRONT": "ref_hh_mother_front.png",
            "THREE_QUARTER": "ref_hh_mother_three_quarter.png",
            "PROFILE": "ref_hh_mother_profile.png",
            "FULL_BODY": "ref_hh_mother_full_body.png"
        },
        "providerSelection": {
            "google_flow": ["THREE_QUARTER", "FULL_BODY"],
            "veo": ["FRONT", "PROFILE", "THREE_QUARTER"]
        },
        "tags": ["hominin", "mother", "olduvai", "caregiver"]
    },
    {
        "id": "char_hh_infant_01",
        "type": "character",
        "displayName": {
            "vi": "Trẻ sơ sinh / Con non",
            "en": "Infant / newborn"
        },
        "flowName": "Homo habilis Infant",
        "species": "Homo habilis",
        "period": "Early Pleistocene",
        "sex": "indeterminate",
        "ageClass": "infant",
        "role": "dependent_offspring",
        "status": "APPROVED",
        "isLocked": True,
        "description": "Vulnerable dependent hominin infant with soft fine hair, clinging reflex, compact facial proportions.",
        "referencePackName": {
            "vi": "Bộ tham chiếu chuẩn nhân vật — Con non",
            "en": "Canonical Character Reference Pack — Infant"
        },
        "referencePack": {
            "FRONT": {"file": "ref_hh_infant_front.png", "policy": "REQUIRED", "labelVi": "Chính diện"},
            "THREE_QUARTER": {"file": "ref_hh_infant_three_quarter.png", "policy": "REQUIRED", "labelVi": "Góc 3/4"},
            "PROFILE": {"file": "ref_hh_infant_profile.png", "policy": "REQUIRED", "labelVi": "Góc nghiêng"},
            "FULL_BODY": {"file": "ref_hh_infant_full_body.png", "policy": "RECOMMENDED", "labelVi": "Toàn thân"}
        },
        "referenceCoverage": {
            "FRONT": "ref_hh_infant_front.png",
            "THREE_QUARTER": "ref_hh_infant_three_quarter.png",
            "PROFILE": "ref_hh_infant_profile.png",
            "FULL_BODY": "ref_hh_infant_full_body.png"
        },
        "providerSelection": {
            "google_flow": ["THREE_QUARTER", "FULL_BODY"],
            "veo": ["FRONT", "PROFILE", "THREE_QUARTER"]
        },
        "tags": ["hominin", "infant", "vulnerable", "altricial"]
    },
    {
        "id": "char_hh_secondary_caregiver_01",
        "type": "character",
        "displayName": {
            "vi": "Người hỗ trợ chăm sóc / Thành viên nhóm",
            "en": "Secondary caregiver / alloparent"
        },
        "flowName": "Homo habilis Caregiver",
        "species": "Homo habilis",
        "period": "Early Pleistocene",
        "sex": "female",
        "ageClass": "subadult",
        "role": "alloparent",
        "status": "APPROVED",
        "isLocked": True,
        "description": "Subadult hominin helper, vigilant posture, sharing burden of carrying and guarding infant.",
        "referencePackName": {
            "vi": "Bộ tham chiếu chuẩn nhân vật — Người hỗ trợ",
            "en": "Canonical Character Reference Pack — Caregiver"
        },
        "referencePack": {
            "FRONT": {"file": "ref_hh_caregiver_front.png", "policy": "REQUIRED", "labelVi": "Chính diện"},
            "THREE_QUARTER": {"file": "ref_hh_caregiver_three_quarter.png", "policy": "REQUIRED", "labelVi": "Góc 3/4"},
            "PROFILE": {"file": "ref_hh_caregiver_profile.png", "policy": "REQUIRED", "labelVi": "Góc nghiêng"},
            "FULL_BODY": {"file": "ref_hh_caregiver_full_body.png", "policy": "RECOMMENDED", "labelVi": "Toàn thân"}
        },
        "referenceCoverage": {
            "FRONT": "ref_hh_caregiver_front.png",
            "THREE_QUARTER": "ref_hh_caregiver_three_quarter.png",
            "PROFILE": "ref_hh_caregiver_profile.png",
            "FULL_BODY": "ref_hh_caregiver_full_body.png"
        },
        "providerSelection": {
            "google_flow": ["THREE_QUARTER", "FULL_BODY"],
            "veo": ["FRONT", "PROFILE", "THREE_QUARTER"]
        },
        "tags": ["hominin", "alloparent", "helper"]
    },
    {
        "id": "char_pleistocene_predator_01",
        "type": "character",
        "displayName": {
            "vi": "Thú săn mồi Pleistocene / Báo tiền sử",
            "en": "Pleistocene predator"
        },
        "flowName": "Pleistocene Predator",
        "species": "Megantereon / Ancestral Panthera",
        "period": "Early Pleistocene",
        "sex": "indeterminate",
        "ageClass": "adult",
        "role": "apex_predator",
        "status": "APPROVED",
        "isLocked": True,
        "description": "Muscular Pleistocene predator, stalking stance through dry savannah grass.",
        "referencePackName": {
            "vi": "Bộ tham chiếu chuẩn nhân vật — Báo săn mồi",
            "en": "Canonical Character Reference Pack — Predator"
        },
        "referencePack": {
            "FRONT": {"file": "ref_predator_front.png", "policy": "REQUIRED", "labelVi": "Chính diện"},
            "THREE_QUARTER": {"file": "ref_predator_three_quarter.png", "policy": "REQUIRED", "labelVi": "Góc 3/4"},
            "PROFILE": {"file": "ref_predator_profile.png", "policy": "REQUIRED", "labelVi": "Góc nghiêng"},
            "FULL_BODY": {"file": "ref_predator_full_body.png", "policy": "RECOMMENDED", "labelVi": "Toàn thân"}
        },
        "referenceCoverage": {
            "FRONT": "ref_predator_front.png",
            "THREE_QUARTER": "ref_predator_three_quarter.png",
            "PROFILE": "ref_predator_profile.png",
            "FULL_BODY": "ref_predator_full_body.png"
        },
        "providerSelection": {
            "google_flow": ["THREE_QUARTER", "FULL_BODY"],
            "veo": ["FRONT", "PROFILE", "THREE_QUARTER"]
        },
        "tags": ["carnivore", "threat", "savannah"]
    }
]

HUMAN_ORIGINS_ENVIRONMENTS = [
    {
        "id": "env_olduvai_gorge_grassland_01",
        "type": "environment",
        "displayName": {
            "vi": "Thảo nguyên Olduvai Gorge",
            "en": "Olduvai Gorge grassland"
        },
        "flowName": "Olduvai Grassland",
        "period": "Early Pleistocene",
        "status": "APPROVED",
        "isLocked": True,
        "description": "Vast East African savannah basin with acacia trees, golden dry grass, volcanic hills on the horizon.",
        "tags": ["grassland", "savannah", "olduvai"]
    },
    {
        "id": "env_olduvai_gorge_hearth_site_01",
        "type": "environment",
        "displayName": {
            "vi": "Bãi trú ẩn / Nơi tập trung nhóm",
            "en": "Olduvai Gorge sheltered site"
        },
        "flowName": "Olduvai Shelter Site",
        "period": "Early Pleistocene",
        "status": "APPROVED",
        "isLocked": True,
        "description": "Shaded rocky outcrop and river terrace shelter with scattered basalt cobbles.",
        "tags": ["shelter", "river_terrace"]
    }
]

HUMAN_ORIGINS_OBJECTS = [
    {
        "id": "prop_stone_tool_01",
        "type": "object",
        "displayName": {
            "vi": "Công cụ đá Oldowan",
            "en": "Oldowan stone chopper"
        },
        "flowName": "Oldowan Stone Tool",
        "period": "Early Pleistocene",
        "status": "APPROVED",
        "isLocked": True,
        "description": "Sharp flaked basalt river cobble core with distinct conchoidal fracture scars.",
        "tags": ["lithic", "tool", "oldowan"]
    }
]

HUMAN_ORIGINS_STYLES = [
    {
        "id": "style_documentary_cinematic_01",
        "type": "style",
        "displayName": {
            "vi": "Phim tài liệu điện ảnh 8K chân thực",
            "en": "Documentary photorealism 8K"
        },
        "flowName": "Documentary Photorealism",
        "status": "APPROVED",
        "isLocked": True,
        "description": "BBC Earth / National Geographic cinema aesthetic, natural golden hour sunlight, anamorphic lens bokeh, photorealistic skin and hair physics.",
        "negativePrompt": "modern clothing, buildings, plastic, distorted limbs, blurry face, cartoon, 3d render, oversaturated"
    }
]

class CanonicalLibrary:
    def __init__(self):
        self._ensure_bootstrap(force_refresh=True)

    def _ensure_bootstrap(self, force_refresh: bool = False):
        """Bootstrap default library entities on disk."""
        cfile = CHARACTERS_DIR / "manifest.json"
        if force_refresh or not cfile.exists():
            cfile.write_text(json.dumps({"characters": HUMAN_ORIGINS_CHARACTERS}, indent=2, ensure_ascii=False), encoding="utf-8")

        efile = ENVIRONMENTS_DIR / "manifest.json"
        if force_refresh or not efile.exists():
            efile.write_text(json.dumps({"environments": HUMAN_ORIGINS_ENVIRONMENTS}, indent=2, ensure_ascii=False), encoding="utf-8")

        ofile = OBJECTS_DIR / "manifest.json"
        if force_refresh or not ofile.exists():
            ofile.write_text(json.dumps({"objects": HUMAN_ORIGINS_OBJECTS}, indent=2, ensure_ascii=False), encoding="utf-8")

        sfile = STYLES_DIR / "manifest.json"
        if force_refresh or not sfile.exists():
            sfile.write_text(json.dumps({"styles": HUMAN_ORIGINS_STYLES}, indent=2, ensure_ascii=False), encoding="utf-8")

    def list_characters(self) -> List[Dict[str, Any]]:
        cfile = CHARACTERS_DIR / "manifest.json"
        if cfile.exists():
            return json.loads(cfile.read_text(encoding="utf-8")).get("characters", [])
        return []

    def list_environments(self) -> List[Dict[str, Any]]:
        efile = ENVIRONMENTS_DIR / "manifest.json"
        if efile.exists():
            return json.loads(efile.read_text(encoding="utf-8")).get("environments", [])
        return []

    def list_objects(self) -> List[Dict[str, Any]]:
        ofile = OBJECTS_DIR / "manifest.json"
        if ofile.exists():
            return json.loads(ofile.read_text(encoding="utf-8")).get("objects", [])
        return []

    def list_styles(self) -> List[Dict[str, Any]]:
        sfile = STYLES_DIR / "manifest.json"
        if sfile.exists():
            return json.loads(sfile.read_text(encoding="utf-8")).get("styles", [])
        return []

    def get_all_assets(self) -> Dict[str, Any]:
        return {
            "characters": self.list_characters(),
            "environments": self.list_environments(),
            "objects": self.list_objects(),
            "styles": self.list_styles()
        }

    def get_provider_references(self, character_id: str, provider: str = "google_flow") -> List[Dict[str, Any]]:
        """Select provider-specific reference subset from Canonical Reference Pack."""
        all_chars = {c["id"]: c for c in self.list_characters()}
        char = all_chars.get(character_id)
        if not char:
            return []
        
        selection_keys = char.get("providerSelection", {}).get(provider, ["THREE_QUARTER", "FULL_BODY"])
        pack = char.get("referencePack", {})
        result = []
        for key in selection_keys:
            if key in pack:
                item = dict(pack[key])
                item["view"] = key
                item["characterId"] = character_id
                item["flowName"] = char.get("flowName")
                result.append(item)
        return result

    def resolve_scene_assets(self, character_ids: List[str], environment_ids: List[str]) -> Dict[str, Any]:
        """Resolve canonical references and Flow triggers for a scene."""
        all_chars = {c["id"]: c for c in self.list_characters()}
        all_envs = {e["id"]: e for e in self.list_environments()}

        matched_chars = [all_chars[cid] for cid in character_ids if cid in all_chars]
        matched_envs = [all_envs[eid] for eid in environment_ids if eid in all_envs]

        flow_tags = [f"@{c.get('flowName', c['id'])}" for c in matched_chars]
        flow_refs = []
        for c in matched_chars:
            flow_refs.extend(self.get_provider_references(c["id"], provider="google_flow"))

        return {
            "characters": matched_chars,
            "environments": matched_envs,
            "flowTags": flow_tags,
            "flowPromptFragment": " ".join(flow_tags),
            "flowReferences": flow_refs
        }

canonical_library = CanonicalLibrary()
