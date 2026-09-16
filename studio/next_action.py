"""
UnfoldIQ Next Best Action Service — Phase 2
Provides:
- Deterministic, rule-based recommendation engine (Zero LLM, zero external API cost)
- Strict 5-tier priority ordering:
  1. BLOCKED items requiring immediate user remediation
  2. OUTDATED upstream-nearest actionable items
  3. NEEDS_REVIEW items requiring approval/verification
  4. DRAFT incomplete items
  5. READY — Workflow complete / ready for next stage or export
- Respects locking constraints (never recommends automated overwrite on locked artifacts)
"""

import logging
from typing import List, Optional

from studio.domain_models import (
    ArtifactNode,
    EffectiveStatus,
    NextAction,
)
from studio.dependency_graph import ArtifactDependencyGraph

logger = logging.getLogger("unfoldiq.next_action")


class NextBestActionService:
    """Evaluates project DAG state and computes the deterministic Next Best Action."""

    def __init__(self, graph: ArtifactDependencyGraph):
        self.graph = graph

    def get_next_action(self) -> NextAction:
        """
        Evaluates the current state of the dependency graph and returns
        the single highest-priority deterministic Next Best Action.
        """
        nodes = self.graph.list_nodes()
        if not nodes:
            return NextAction(
                action_type="INITIALIZE_PROJECT",
                target_stage="Overview",
                reason="Dự án chưa có dữ liệu thực thể. Hãy tạo kịch bản ban đầu.",
                priority=4,
            )

        # Retrieve topological order to prioritize upstream over downstream
        try:
            topo_order = self.graph.topological_sort()
        except Exception:
            topo_order = [n.artifact_id for n in nodes]

        node_map = {n.artifact_id: n for n in nodes}

        # ----------------------------------------------------------------------
        # Priority 1: BLOCKED Nodes
        # ----------------------------------------------------------------------
        for nid in topo_order:
            node = node_map.get(nid)
            if not node:
                continue
            if node.effective_status == EffectiveStatus.BLOCKED.value or (node.blockers and len(node.blockers) > 0):
                blocker_msg = node.blockers[0].message if node.blockers else "Ràng buộc kỹ thuật chưa được giải quyết."
                return NextAction(
                    action_type="RESOLVE_BLOCKER",
                    target_artifact_id=node.artifact_id,
                    target_artifact_type=node.artifact_type,
                    target_stage=self._map_stage(node.artifact_type),
                    reason=f"Thực thể {node.artifact_id} đang bị chặn: {blocker_msg}",
                    priority=1,
                    metadata={"blockers": [b.model_dump() for b in node.blockers]},
                )

        # ----------------------------------------------------------------------
        # Priority 2: OUTDATED Nodes (Nearest upstream actionable item)
        # ----------------------------------------------------------------------
        for nid in topo_order:
            node = node_map.get(nid)
            if not node:
                continue
            if node.effective_status == EffectiveStatus.OUTDATED.value or node.is_outdated:
                if node.is_locked:
                    return NextAction(
                        action_type="UNLOCK_TO_UPDATE",
                        target_artifact_id=node.artifact_id,
                        target_artifact_type=node.artifact_type,
                        target_stage=self._map_stage(node.artifact_type),
                        reason=f"Thực thể {node.artifact_id} đã lỗi thời nhưng đang bị khóa. Hãy mở khóa để tạo lại dữ liệu mới nhất.",
                        priority=2,
                        metadata={"is_locked": True},
                    )
                else:
                    return NextAction(
                        action_type="REGENERATE_OUTDATED",
                        target_artifact_id=node.artifact_id,
                        target_artifact_type=node.artifact_type,
                        target_stage=self._map_stage(node.artifact_type),
                        reason=f"Nút thượng nguồn đã thay đổi. Cần tạo lại dữ liệu cho {node.artifact_type} ({node.artifact_id}).",
                        priority=2,
                        metadata={"is_locked": False},
                    )

        # ----------------------------------------------------------------------
        # Priority 3: NEEDS_REVIEW Nodes
        # ----------------------------------------------------------------------
        for nid in topo_order:
            node = node_map.get(nid)
            if not node:
                continue
            if node.effective_status == EffectiveStatus.NEEDS_REVIEW.value:
                return NextAction(
                    action_type="REVIEW_ARTIFACT",
                    target_artifact_id=node.artifact_id,
                    target_artifact_type=node.artifact_type,
                    target_stage=self._map_stage(node.artifact_type),
                    reason=f"Thực thể {node.artifact_type} ({node.artifact_id}) đã sinh xong và đang chờ người dùng nghiệm thu.",
                    priority=3,
                )

        # ----------------------------------------------------------------------
        # Priority 4: DRAFT Nodes
        # ----------------------------------------------------------------------
        for nid in topo_order:
            node = node_map.get(nid)
            if not node:
                continue
            if node.effective_status == EffectiveStatus.DRAFT.value:
                return NextAction(
                    action_type="COMPLETE_DRAFT",
                    target_artifact_id=node.artifact_id,
                    target_artifact_type=node.artifact_type,
                    target_stage=self._map_stage(node.artifact_type),
                    reason=f"Thực thể {node.artifact_type} ({node.artifact_id}) còn ở trạng thái nháp, cần hoàn thiện nội dung.",
                    priority=4,
                )

        # ----------------------------------------------------------------------
        # Priority 5: All Ready — Proceed to Next Stage / Export
        # ----------------------------------------------------------------------
        return NextAction(
            action_type="PROCEED_TO_EXPORT",
            target_stage="Export",
            reason="Toàn bộ thực thể trong chu trình đều đồng bộ và đạt trạng thái READY. Sẵn sàng xuất bản gói sản xuất.",
            priority=5,
        )

    def _map_stage(self, artifact_type: str) -> str:
        """Maps artifact type to corresponding workbench stage."""
        mapping = {
            "story_beat": "Story",
            "script": "Story",
            "audio_chunk": "Voice",
            "voice_qa": "Voice",
            "scene_timing": "Visual",
            "scene": "Visual",
            "shot": "Visual",
            "visual_bible": "Visual",
            "media_asset": "Export",
            "render_manifest": "Export",
        }
        return mapping.get(artifact_type, "Overview")
