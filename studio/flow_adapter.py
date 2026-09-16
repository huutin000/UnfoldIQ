"""
UnfoldIQ Google Flow Manual Adapter — Phase 14 Default
Handles integration between UnfoldIQ's structured scene manifests and Google Flow's visual generation workstation.
Features:
- Generates Flow-optimized prompts with @Character triggers.
- Flow friendly name mapping vs UnfoldIQ system IDs.
- Package reference assets for Google Flow character creation.
"""

from typing import Dict, Any, List, Optional
from studio.canonical_library import canonical_library

class GoogleFlowManualAdapter:
    def __init__(self):
        self.provider_id = "google_flow"
        self.mode = "manual"

    def format_flow_prompt(self, manifest: Dict[str, Any]) -> str:
        """Create prompt string formatted directly for Google Flow prompt bar."""
        prompt = manifest.get("prompt", {})
        subject = prompt.get("subject", "")
        action = prompt.get("action", "")
        env = prompt.get("environment", "")
        camera = prompt.get("camera", "")
        lighting = prompt.get("lighting", "")
        style = prompt.get("style", "")

        resolved = manifest.get("resolvedAssets", {})
        flow_tags = resolved.get("flowTags", [])
        tags_prefix = " ".join(flow_tags)

        body_parts = []
        if tags_prefix:
            body_parts.append(tags_prefix)
        if action:
            body_parts.append(action)
        if env:
            body_parts.append(f"Setting: {env}")
        if camera:
            body_parts.append(f"Cinematography: {camera}")
        if lighting:
            body_parts.append(f"Lighting: {lighting}")
        if style:
            body_parts.append(f"Style: {style}")

        return ". ".join(body_parts) + "."

    def get_character_mapping(self) -> Dict[str, str]:
        """Return mapping of system IDs to Google Flow @name handles."""
        chars = canonical_library.list_characters()
        return {c["id"]: c.get("flowName", c["id"]) for c in chars}

    def prepare_flow_instructions(self, scene_id: str, manifest: Dict[str, Any]) -> Dict[str, Any]:
        """Produce complete instruction card for the user to perform in Google Flow."""
        flow_prompt = self.format_flow_prompt(manifest)
        mapping = self.get_character_mapping()

        char_ids = manifest.get("references", {}).get("characterIds", [])
        characters_used = [
            {
                "systemId": cid,
                "flowTag": f"@{mapping.get(cid, cid)}",
                "role": cid
            }
            for cid in char_ids
        ]

        visual_bp = manifest.get("visual_blueprint", {})
        motion_bp = manifest.get("motion_blueprint", {})
        routing = manifest.get("routing", {})
        visual_type = manifest.get("visualType", "CHARACTER_SCENE")

        image_prompt = visual_bp.get("imagePrompt") or flow_prompt
        motion_prompt = motion_bp.get("motionPrompt") if motion_bp else None

        user_steps = [
            "1. Với cảnh nhân vật: Ưu tiên tạo ảnh trong Google Flow để chốt tạo hình và bố cục.",
            "2. Kiểm tra các nhân vật (@Homo habilis Mother, v.v.) đã được gắn đúng trong Google Flow.",
            "3. Tải ảnh hoặc video clip MP4 về máy.",
            "4. Dùng nút 'Tiếp nhận Visual' trong UnfoldIQ để đưa vào quy trình kiểm tra QC tự động."
        ]

        return {
            "sceneId": scene_id,
            "manifestId": manifest.get("id"),
            "visualType": visual_type,
            "routing": routing,
            "targetDuration": manifest.get("target", {}).get("duration", 6.0),
            "aspectRatio": manifest.get("target", {}).get("aspectRatio", "16:9"),
            "flowPrompt": flow_prompt,
            "imagePrompt": image_prompt,
            "motionPrompt": motion_prompt,
            "charactersUsed": characters_used,
            "flowReferences": manifest.get("resolvedAssets", {}).get("flowReferences", []),
            "userSteps": user_steps
        }

flow_adapter = GoogleFlowManualAdapter()
