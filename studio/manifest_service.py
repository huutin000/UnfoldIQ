"""
UnfoldIQ Generation Manifest Service — Phase 14 (Refined)
Principles:
- Scene is the central production orchestration unit.
- Separation of concerns:
  1. Visual Blueprint: WHAT THE FRAME LOOKS LIKE (Character, environment, composition, lighting, style, negative)
  2. Motion Blueprint: WHAT HAPPENS OVER TIME (Subject motion, camera movement, continuity preservation)
- Visual Router: Maps visual types (CHARACTER_SCENE, ENVIRONMENT, EVIDENCE, TIMELINE, COMPARISON, MAP)
  to targeted generation strategies (e.g. CHARACTER_SCENE uses image-first workflow; EVIDENCE does not require video).
- Generates Flow Image Prompt and Motion Prompt independently.
"""

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, Optional, List

from studio.canonical_library import canonical_library

logger = logging.getLogger("unfoldiq.manifest")

class VisualType:
    CHARACTER_SCENE = "CHARACTER_SCENE"
    ENVIRONMENT = "ENVIRONMENT"
    EVIDENCE = "EVIDENCE"
    TIMELINE = "TIMELINE"
    COMPARISON = "COMPARISON"
    MAP = "MAP"

class VisualRouter:
    """Routes scenes to optimal visual generation strategies."""
    
    @staticmethod
    def determine_visual_type(scene: Dict[str, Any]) -> str:
        # Check explicit type if set
        explicit = scene.get("visual_type") or scene.get("visualType")
        if explicit in (VisualType.CHARACTER_SCENE, VisualType.ENVIRONMENT, VisualType.EVIDENCE,
                        VisualType.TIMELINE, VisualType.COMPARISON, VisualType.MAP):
            return explicit
            
        category = (scene.get("category") or "").upper()
        narration = (scene.get("narration") or scene.get("narration_text") or "").lower()
        char_ids = scene.get("character_ids", [])
        
        if "TIMELINE" in category or "chronology" in narration or "timeline" in narration:
            return VisualType.TIMELINE
        if "MAP" in category or "geography" in narration or "migration route" in narration:
            return VisualType.MAP
        if "COMPARISON" in category or "contrast" in narration or "side-by-side" in narration:
            return VisualType.COMPARISON
        if "EVIDENCE" in category or "fossil" in narration or "stone tool" in narration or "archaeology" in narration:
            return VisualType.EVIDENCE
        if char_ids or "mother" in narration or "infant" in narration or "hominin" in narration:
            return VisualType.CHARACTER_SCENE
        return VisualType.ENVIRONMENT

    @staticmethod
    def get_strategy(visual_type: str) -> Dict[str, Any]:
        if visual_type == VisualType.CHARACTER_SCENE:
            return {
                "visual_type": visual_type,
                "visualType": visual_type,
                "strategy": "IMAGE_FIRST",
                "requiresVideo": True,
                "recommended_asset": "IMAGE_THEN_VIDEO",
                "workflow": "Visual Blueprint -> Flow Image -> Approve/Lock -> Motion Blueprint -> Video",
                "descriptionVi": "Ưu tiên tạo ảnh trước để chốt nhân vật và bố cục, sau đó mới tạo chuyển động."
            }
        elif visual_type == VisualType.ENVIRONMENT:
            return {
                "visual_type": visual_type,
                "visualType": visual_type,
                "strategy": "DIRECT_VIDEO_OR_IMAGE",
                "requiresVideo": True,
                "recommended_asset": "VIDEO",
                "workflow": "Flow Image or Direct Video",
                "descriptionVi": "Bối cảnh tự nhiên, có thể tạo trực tiếp video hoặc tạo ảnh nền tĩnh."
            }
        elif visual_type == VisualType.EVIDENCE:
            return {
                "visual_type": visual_type,
                "visualType": visual_type,
                "strategy": "STATIC_IMAGE_ONLY",
                "requiresVideo": False,
                "recommended_asset": "STATIC_IMAGE",
                "workflow": "Static Photographic Artifact / No Video Required",
                "descriptionVi": "Ảnh tư liệu/hiện vật khảo cổ chụp tĩnh — Không cần tạo video tốn credit."
            }
        elif visual_type == VisualType.TIMELINE:
            return {
                "visual_type": visual_type,
                "visualType": visual_type,
                "strategy": "PROGRAMMATIC_MOTION",
                "requiresVideo": False,
                "recommended_asset": "PROGRAMMATIC",
                "workflow": "Programmatic Infographic / Title Card",
                "descriptionVi": "Đồ họa niên đại xử lý tự động nội bộ bằng mã đồ họa."
            }
        elif visual_type == VisualType.COMPARISON:
            return {
                "visual_type": visual_type,
                "visualType": visual_type,
                "strategy": "PROGRAMMATIC_COMPOSITION",
                "requiresVideo": False,
                "recommended_asset": "PROGRAMMATIC",
                "workflow": "Programmatic Split Screen / Side-by-side",
                "descriptionVi": "So sánh giải phẫu song song xử lý bằng bố cục ghép ảnh."
            }
        elif visual_type == VisualType.MAP:
            return {
                "visual_type": visual_type,
                "visualType": visual_type,
                "strategy": "PROGRAMMATIC_MAP",
                "requiresVideo": False,
                "recommended_asset": "PROGRAMMATIC",
                "workflow": "Programmatic Animated Map",
                "descriptionVi": "Bản đồ di chuyển địa lý xử lý nội bộ."
            }
        return {
            "visual_type": visual_type,
            "visualType": visual_type,
            "strategy": "DEFAULT",
            "requiresVideo": True,
            "recommended_asset": "VIDEO",
            "workflow": "Default video workflow",
            "descriptionVi": "Quy trình video chuẩn."
        }

class ManifestService:
    def __init__(self):
        self.router = VisualRouter()

    def get_manifests_dir(self, project_dir: Path) -> Path:
        mdir = project_dir / "manifests"
        mdir.mkdir(parents=True, exist_ok=True)
        return mdir

    def generate_visual_blueprint(
        self,
        scene: Dict[str, Any],
        shot_id: str,
        visual_type: str,
        resolved: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Generate Visual Blueprint: WHAT THE FRAME LOOKS LIKE."""
        narration = scene.get("narration") or scene.get("narration_text") or ""
        char_tags = [f"@{c.get('flowName', c['id'])}" for c in resolved["characters"]]
        char_str = " ".join(char_tags) if char_tags else "Early Homo habilis hominins"
        env_desc = resolved["environments"][0]["description"] if resolved["environments"] else "East African savannah"

        # Image-specific prompt tailored for Google Flow Images
        image_prompt = (
            f"{char_str}. Authentic Pleistocene documentary photograph: {narration[:120]}. "
            f"Setting: {env_desc}. "
            f"Composition: Cinematic eye-level medium tracking shot, 35mm anamorphic lens. "
            f"Lighting: Golden hour warm directional sunlight with atmospheric dust haze. "
            f"Style: 8K documentary cinema photorealism, authentic hominin cranial morphology and natural dark hair texture."
        )

        return {
            "sceneId": scene.get("scene_id") or scene.get("id") or "scene_001",
            "shotId": shot_id,
            "visualType": visual_type,
            "purpose": f"Visual proof and narrative setting for: {narration[:80]}",
            "characters": [c["id"] for c in resolved["characters"]],
            "subject_anchor": [c["id"] for c in resolved["characters"]],
            "characterFlowTags": char_tags,
            "environment": resolved["environments"][0]["id"] if resolved["environments"] else "env_olduvai_gorge_grassland_01",
            "composition": {
                "framing": "medium_tracking",
                "cameraHeight": "eye_level",
                "lens": "35mm_anamorphic"
            },
            "blocking": {
                "primarySubject": "center_left",
                "secondarySubject": "center_right",
                "background": "open_savannah_horizon"
            },
            "style": "documentary_cinema_photorealism_8k",
            "lighting": "golden_hour_directional_sunlight",
            "aspectRatio": "16:9",
            "negative": [
                "modern clothing", "buildings", "plastic", "fantasy anatomy",
                "cartoon", "3d render", "oversaturated", "identity drift"
            ],
            "imagePrompt": image_prompt,
            "flowReferences": resolved.get("flowReferences", [])
        }

    def generate_motion_blueprint(
        self,
        scene: Dict[str, Any],
        shot_id: str,
        duration: float,
        approved_visual_ref: Optional[str] = None
    ) -> Dict[str, Any]:
        """Generate Motion Blueprint: WHAT HAPPENS OVER TIME."""
        narration = scene.get("narration") or scene.get("narration_text") or ""
        
        motion_prompt = (
            f"Subtle documentary cinematic motion over {duration:.1f}s. "
            f"Natural hominin behavior: gentle breathing, subtle head and eye movement, "
            f"infant small clinging shifts. Camera executes a very slow smooth push-in. "
            f"Preserve character facial structure, lighting, and background foliage stability."
        )

        return {
            "sceneId": scene.get("scene_id") or scene.get("id") or "scene_001",
            "shotId": shot_id,
            "durationSeconds": duration,
            "temporal_beat": {
                "duration": duration,
                "movement": "slow_push_in"
            },
            "approvedVisualRef": approved_visual_ref,
            "subjectMotion": {
                "primaryCaregiver": {"action": "subtle_observation_and_gathering", "intensity": "subtle"},
                "infant": {"action": "small_natural_clinging_movements", "intensity": "minimal"}
            },
            "camera": {
                "movement": "slow_push_in",
                "speed": "very_slow",
                "stabilization": "fluid_tripod"
            },
            "environmentMotion": {
                "grass": "gentle_breeze",
                "hair": "subtle_wind_flutter",
                "haze": "atmospheric_drift"
            },
            "preserve": [
                "character_identity", "body_proportions", "blocking",
                "environment", "lighting_direction"
            ],
            "avoid": [
                "sudden_jerky_motion", "morphing_limbs", "new_characters",
                "new_objects", "camera_shake", "warp_artifacts"
            ],
            "motionPrompt": motion_prompt
        }

    def generate_manifest_for_scene(
        self,
        project_dir: Path,
        scene: Dict[str, Any],
        shot_id: Optional[str] = None,
        approved_start_frame: Optional[str] = None
    ) -> Dict[str, Any]:
        """Compile a structured generation manifest for a scene with decoupled Visual & Motion blueprints."""
        scene_id = scene.get("scene_id") or scene.get("id") or "scene_001"
        s_id = shot_id or f"{scene_id}_shot_a"
        manifest_id = f"GEN-{scene_id.upper()}-v1"

        narration = scene.get("narration") or scene.get("narration_text") or ""
        duration = float(scene.get("target_duration") or scene.get("duration") or 6.0)

        # 1. Determine Visual Type & Routing
        visual_type = self.router.determine_visual_type(scene)
        routing = self.router.get_strategy(visual_type)

        # 2. Extract and resolve Canonical Assets
        char_ids = scene.get("character_ids", ["char_hh_primary_caregiver_01", "char_hh_infant_01"])
        env_ids = scene.get("environment_ids", ["env_olduvai_gorge_grassland_01"])
        resolved = canonical_library.resolve_scene_assets(char_ids, env_ids)

        # 3. Build Visual Blueprint (WHAT THE FRAME LOOKS LIKE)
        visual_bp = self.generate_visual_blueprint(scene, s_id, visual_type, resolved)

        # 4. Build Motion Blueprint (WHAT HAPPENS OVER TIME - if video required)
        motion_bp = None
        if routing["requiresVideo"]:
            motion_bp = self.generate_motion_blueprint(scene, s_id, duration, approved_start_frame)

        # Backward compatible prompt data for existing UI & Phase 14 tests
        flow_char_names = resolved["flowTags"]
        flow_chars_str = ", ".join(flow_char_names) if flow_char_names else "Homo habilis hominin"
        prompt_data = {
            "subject": f"{flow_chars_str} in authentic prehistoric state",
            "action": f"Natural behavioral movement corresponding to: {narration[:100]}",
            "environment": resolved["environments"][0]["description"] if resolved["environments"] else "East African savannah",
            "camera": "Cinematic eye-level medium tracking shot, 35mm anamorphic lens",
            "lighting": "Golden hour warm directional sunlight with atmospheric haze",
            "style": "8K documentary cinema photorealism, authentic hominin anatomy and hair physics",
            "negative": "modern objects, buildings, clothing, cartoon, saturated 3D, blur"
        }

        flow_full_prompt = (
            f"{' '.join(flow_char_names)}. {prompt_data['action']}. "
            f"Set in {prompt_data['environment']}. "
            f"{prompt_data['camera']}, {prompt_data['lighting']}, {prompt_data['style']}."
        )

        manifest = {
            "id": manifest_id,
            "sceneId": scene_id,
            "shotId": s_id,
            "visualType": visual_type,
            "routing": routing,
            "visual_blueprint": visual_bp,
            "motion_blueprint": motion_bp,
            # P2 (§14): semantic aliases theo spec (WHO/WHERE/...) trỏ tới cùng dữ liệu —
            # additive, không đổi schema hiện có để tương thích test/UI cũ.
            "blueprint_semantics": {
                "WHO": (visual_bp.get("characters") if isinstance(visual_bp, dict) else None),
                "WHERE": (visual_bp.get("environment") if isinstance(visual_bp, dict) else None),
                "LOOK": (visual_bp.get("style") if isinstance(visual_bp, dict) else None),
                "FRAMING": ((visual_bp.get("composition") or {}).get("framing") if isinstance(visual_bp, dict) else None),
                "LIGHTING": (visual_bp.get("lighting") if isinstance(visual_bp, dict) else None),
                "STYLE": (visual_bp.get("style") if isinstance(visual_bp, dict) else None),
                "REFERENCES": (visual_bp.get("flowReferences") if isinstance(visual_bp, dict) else None),
                "SUBJECT_MOTION": ((motion_bp or {}).get("subjectMotion") if isinstance(motion_bp, dict) else None),
                "CAMERA": ((motion_bp or {}).get("camera") if isinstance(motion_bp, dict) else None),
                "ENVIRONMENT_MOTION": ((motion_bp or {}).get("environmentMotion") if isinstance(motion_bp, dict) else None),
                "DURATION": ((motion_bp or {}).get("durationSeconds") if isinstance(motion_bp, dict) else None),
                "PRESERVE_RULES": ((motion_bp or {}).get("preserve") if isinstance(motion_bp, dict) else None),
            },
            "target": {
                "type": "image_then_video" if routing["requiresVideo"] else "image_only",
                "duration": duration,
                "aspectRatio": "16:9"
            },
            # Backward-compatibility fields
            "prompt": prompt_data,
            "flowPrompt": flow_full_prompt,
            "references": {
                "characterIds": char_ids,
                "environmentIds": env_ids,
                "objectIds": ["prop_stone_tool_01"]
            },
            "resolvedAssets": resolved,
            "continuity": {
                "wardrobe": "wild natural hominin state",
                "timeOfDay": "golden hour",
                "locks": True
            },
            "provider": {
                "mode": "flow_manual",
                "name": "Google Flow Manual Adapter"
            },
            "status": "NEEDS_GENERATION",
            "createdAt": datetime.now(timezone.utc).isoformat()
        }

        # P1 (§5): manifest regen không thay binding của asset đã LOCKED/APPROVED.
        # Binding cũ được giữ lại; prompt mới chỉ thay nội dung sinh, không thay asset.
        try:
            from studio.asset_intake import asset_intake as _intake
            bound = _intake.get_selected_asset_for_scene(project_dir, scene_id)
            if bound and bound.get("lifecycle") in ("LOCKED", "APPROVED"):
                manifest["boundAssetId"] = bound.get("id")
                manifest["boundAssetPath"] = bound.get("filePath")
                manifest["status"] = "LOCKED_BOUND"
        except Exception:
            pass

        # Save to disk
        mfile = self.get_manifests_dir(project_dir) / f"{manifest_id}.json"
        mfile.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
        return manifest

    def list_manifests(self, project_dir: Path) -> List[Dict[str, Any]]:
        mdir = self.get_manifests_dir(project_dir)
        manifests = []
        for mf in mdir.glob("*.json"):
            try:
                manifests.append(json.loads(mf.read_text(encoding="utf-8")))
            except Exception as e:
                logger.warning(f"Failed to read manifest {mf}: {e}")
        return manifests

    def get_manifest_for_scene(self, project_dir: Path, scene_id: str) -> Optional[Dict[str, Any]]:
        mfile = self.get_manifests_dir(project_dir) / f"GEN-{scene_id.upper()}-v1.json"
        if mfile.exists():
            return json.loads(mfile.read_text(encoding="utf-8"))
        return None

manifest_service = ManifestService()
