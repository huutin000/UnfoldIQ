"""
studio/visual_router.py — Gate E: Deterministic Visual Router

Maps shot metadata to a production route WITHOUT any LLM calls.
Rules are derived from existing visual_prompts.json data:
  visualType  ∈ {ENVIRONMENT, CHARACTER_SCENE, TIMELINE, EVIDENCE, COMPARISON}
  recommendedOutputType ∈ {VEO_CANDIDATE, VEO_RECOMMENDED, EDITOR_MOTION, STATIC_IMAGE}
  shot category ∈ {reconstruction, transition, artifact, anatomy/science, timeline, comparison}

The router is deterministic and stable: same inputs → same route on every call.
"""
from __future__ import annotations

from typing import Any, Dict, Optional

# ---------------------------------------------------------------------------
# Route constants
# ---------------------------------------------------------------------------

ROUTE_VEO = "VEO"                   # Google Veo motion generation (primary)
ROUTE_STATIC_IMAGE = "STATIC_IMAGE" # Static frame / Google Flow / Imagen
ROUTE_EDITOR_MOTION = "EDITOR_MOTION" # Programmatic editor-driven motion
ROUTE_EVIDENCE = "EVIDENCE"         # Archival / documentary evidence asset
ROUTE_UNKNOWN = "UNKNOWN"           # Fallback — human review required

# Visual types from visual_prompts.json
_VT_VEO = {"ENVIRONMENT", "CHARACTER_SCENE"}
_VT_STATIC = {"EVIDENCE"}
_VT_EDITOR = {"TIMELINE", "COMPARISON"}

# Recommended output types from visual_prompts.json
_OT_VEO = {"VEO_CANDIDATE", "VEO_RECOMMENDED"}
_OT_STATIC = {"STATIC_IMAGE"}
_OT_EDITOR = {"EDITOR_MOTION"}

# Shot categories from veo_prompts.json
_CAT_STATIC = {"artifact"}
_CAT_EDITOR = {"timeline", "comparison"}
_CAT_EVIDENCE = {"anatomy/science"}


class VisualRouter:
    """
    Deterministic rules-based visual production router.

    Priority order:
    1. visual_prompts selectedOutputType (explicit user override)
    2. visual_prompts recommendedOutputType (planner recommendation)
    3. visual_prompts visualType (scene visual classification)
    4. shot category (fallback from veo_prompts)
    5. UNKNOWN (human review required)

    NOT every shot is forced through Veo.
    """

    @classmethod
    def route(cls, shot: Any, vp_entry: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Determine the production route for a shot.

        Args:
            shot: Shot domain model instance (must have .category, .shot_id, .parent_scene_id).
            vp_entry: Entry from visual_prompts.json for the parent scene (optional).

        Returns:
            Dict with keys: shot_id, scene_id, route, visual_type, recommended_output_type,
                            requires_start_frame, requires_motion_prompt, rationale
        """
        shot_id = getattr(shot, "shot_id", "unknown")
        scene_id = getattr(shot, "parent_scene_id", "")
        category = (getattr(shot, "category", "") or "").lower().strip()

        visual_type = None
        selected_output = None
        recommended_output = None

        if vp_entry:
            visual_type = (vp_entry.get("visualType") or "").upper().strip()
            selected_output = (vp_entry.get("selectedOutputType") or "").upper().strip() or None
            recommended_output = (vp_entry.get("recommendedOutputType") or "").upper().strip() or None

        # --- Routing logic ---
        route = ROUTE_UNKNOWN
        rationale = []

        # 1. Explicit user override (selectedOutputType)
        if selected_output in _OT_VEO:
            route = ROUTE_VEO
            rationale.append(f"selectedOutputType={selected_output}")
        elif selected_output in _OT_STATIC:
            route = ROUTE_STATIC_IMAGE
            rationale.append(f"selectedOutputType={selected_output}")
        elif selected_output in _OT_EDITOR:
            route = ROUTE_EDITOR_MOTION
            rationale.append(f"selectedOutputType={selected_output}")

        # 2. Planner recommendation (recommendedOutputType)
        elif recommended_output in _OT_VEO:
            route = ROUTE_VEO
            rationale.append(f"recommendedOutputType={recommended_output}")
        elif recommended_output in _OT_STATIC:
            route = ROUTE_STATIC_IMAGE
            rationale.append(f"recommendedOutputType={recommended_output}")
        elif recommended_output in _OT_EDITOR:
            route = ROUTE_EDITOR_MOTION
            rationale.append(f"recommendedOutputType={recommended_output}")

        # 3. Visual type classification
        elif visual_type in _VT_VEO:
            route = ROUTE_VEO
            rationale.append(f"visualType={visual_type}")
        elif visual_type in _VT_STATIC:
            route = ROUTE_EVIDENCE
            rationale.append(f"visualType={visual_type}")
        elif visual_type in _VT_EDITOR:
            route = ROUTE_EDITOR_MOTION
            rationale.append(f"visualType={visual_type}")

        # 4. Shot category fallback
        elif category in _CAT_STATIC:
            route = ROUTE_STATIC_IMAGE
            rationale.append(f"category={category}")
        elif category in _CAT_EDITOR:
            route = ROUTE_EDITOR_MOTION
            rationale.append(f"category={category}")
        elif category in _CAT_EVIDENCE:
            route = ROUTE_EVIDENCE
            rationale.append(f"category={category}")
        elif category in {"reconstruction", "transition"}:
            route = ROUTE_VEO
            rationale.append(f"category={category} (default reconstruction/transition → VEO)")

        # 5. Unknown — human review
        else:
            rationale.append("no matching rule — human review required")

        # Derived flags
        requires_start_frame = route == ROUTE_VEO or visual_type == "CHARACTER_SCENE"
        requires_motion_prompt = route in (ROUTE_VEO, ROUTE_EDITOR_MOTION)

        return {
            "shot_id": shot_id,
            "scene_id": scene_id,
            "route": route,
            "visual_type": visual_type or None,
            "recommended_output_type": recommended_output,
            "selected_output_type": selected_output,
            "shot_category": category or None,
            "requires_start_frame": requires_start_frame,
            "requires_motion_prompt": requires_motion_prompt,
            "rationale": "; ".join(rationale) if rationale else "default",
            "note": (
                "CHARACTER_SCENE: obtain approved start-frame before Veo motion."
                if visual_type == "CHARACTER_SCENE" else None
            ),
        }

    @classmethod
    def route_from_dict(cls, shot_dict: Dict[str, Any], vp_entry: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Convenience: route from a plain dict (e.g., from API JSON)."""
        class _FakeShot:
            pass
        s = _FakeShot()
        s.shot_id = shot_dict.get("shot_id", "unknown")
        s.parent_scene_id = shot_dict.get("parent_scene_id") or shot_dict.get("scene_id", "")
        s.category = shot_dict.get("category", "")
        return cls.route(s, vp_entry)
