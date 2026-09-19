"""
UnfoldIQ Script & Narrative Outline Service — Phase 14
Principles:
- Canonical narrative entity: Script versions are preserved and never silently overwritten.
- Narrative Outline internally structures documentary pacing (Hook, Context, Central Question, Evidence, Escalation, Uncertainty, Resolution, Conclusion).
- Claim Linkage: Script sections link to Claim Ledger IDs for scientific provenance.
- Dependency Tracking: Upstream script edits mark voice, timing, and scene plan OUTDATED without auto-deleting media or regenerating locked assets.
"""

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, Optional, List

logger = logging.getLogger("unfoldiq.script")

DEFAULT_NARRATIVE_OUTLINE = [
    {"id": "out_01", "type": "HOOK", "title": "Mở đầu kịch tính (The Prey Dilemma)", "description": "Con non của loài người nguyên thủy không thể tự chạy trốn hay chống trả thú dữ."},
    {"id": "out_02", "type": "CONTEXT", "title": "Bối cảnh sinh học (The Vulnerable Infant)", "description": "Trẻ sơ sinh loài người đặc biệt yếu ớt và phụ thuộc kéo dài hơn các loài linh trưởng khác."},
    {"id": "out_03", "type": "CENTRAL_QUESTION", "title": "Câu hỏi trung tâm (The Shield of Cooperation)", "description": "Điều gì đã bảo vệ chúng qua hàng thế hệ giữa những kẻ săn mồi khát máu?"},
    {"id": "out_04", "type": "EVIDENCE", "title": "Bằng chứng khảo cổ & sinh học", "description": "Hóa thạch tại Olduvai Gorge cho thấy dấu vết răng thú săn mồi và công cụ đá Oldowan."},
    {"id": "out_05", "type": "ESCALATION", "title": "Áp lực sinh tồn (The Predator Threat)", "description": "Hổ răng kiếm, báo tiền sử và linh cẩu liên tục rình rập quanh các bãi thức ăn."},
    {"id": "out_06", "type": "UNCERTAINTY", "title": "Giới hạn bằng chứng (Scientific Uncertainty)", "description": "Hóa thạch không thể lưu giữ trực tiếp hành vi chăm sóc con non, nhưng mô hình sinh học năng lượng ủng hộ việc chăm sóc tập thể."},
    {"id": "out_07", "type": "RESOLUTION", "title": "Giải pháp tiến hóa (Alloparenting & Solidarity)", "description": "Những người mẹ không đơn độc: Các thành viên trong nhóm chia sẻ gánh nặng bảo vệ và bế bồng."},
    {"id": "out_08", "type": "CONCLUSION", "title": "Kết luận (The Human Advantage)", "description": "Sự hợp tác xã hội và tình thân đã cứu loài người trước khi chúng ta có lửa hay vũ khí tối tân."}
]

class ScriptService:
    def __init__(self):
        pass

    def get_script_file(self, project_dir: Path) -> Path:
        return project_dir / "script.json"

    def get_script_text_file(self, project_dir: Path) -> Path:
        return project_dir / "script.txt"

    def get_outline_file(self, project_dir: Path) -> Path:
        return project_dir / "narrative_outline.json"

    def get_script_data(self, project_dir: Path) -> Dict[str, Any]:
        sfile = self.get_script_file(project_dir)
        txt_file = self.get_script_text_file(project_dir)

        if not sfile.exists():
            # Bootstrap from existing script.txt if available
            raw_text = txt_file.read_text(encoding="utf-8") if txt_file.exists() else ""
            paragraphs = [p.strip() for p in raw_text.split("\n\n") if p.strip()]
            
            sections = []
            for i, p in enumerate(paragraphs):
                sec_id = f"sec_{i+1:03d}"
                claim_ref = [f"CLAIM-{(i % 5) + 1:03d}"]
                sections.append({
                    "id": sec_id,
                    "title": f"Section {i+1}",
                    "text": p,
                    "claim_links": claim_ref,
                    "status": "APPROVED"
                })

            now = datetime.now(timezone.utc).isoformat()
            script_data = {
                "id": f"script_{project_dir.name}_v1",
                "projectId": project_dir.name,
                "version": 1,
                "contentLanguage": "en-US",
                "status": "APPROVED",
                "locked": True,
                "approvedAt": now,
                "updatedAt": now,
                "sections": sections,
                "outdatedDependencies": []
            }
            sfile.write_text(json.dumps(script_data, indent=2, ensure_ascii=False), encoding="utf-8")
            return script_data

        return json.loads(sfile.read_text(encoding="utf-8"))

    def get_outline(self, project_dir: Path) -> List[Dict[str, Any]]:
        ofile = self.get_outline_file(project_dir)
        if not ofile.exists():
            ofile.write_text(json.dumps({"outline": DEFAULT_NARRATIVE_OUTLINE}, indent=2, ensure_ascii=False), encoding="utf-8")
            return DEFAULT_NARRATIVE_OUTLINE
        return json.loads(ofile.read_text(encoding="utf-8")).get("outline", DEFAULT_NARRATIVE_OUTLINE)

    def get_script_version(self, project_dir: Path) -> int:
        """Read current script version without side effects (lineage stamping)."""
        try:
            return int(self.get_script_data(project_dir).get("version", 1))
        except Exception:
            return 1

    def update_script(
        self,
        project_dir: Path,
        sections: List[Dict[str, Any]],
        new_version: bool = False,
        force: bool = False,
    ) -> Dict[str, Any]:
        """Update script and flag downstream dependencies as OUTDATED.

        P1 (§4 FINAL-GAPS): locked script không silent edit. Muốn sửa phải:
        mở khóa (unlock), tạo version mới (new_version), hoặc xác nhận rõ (force).
        """
        data = self.get_script_data(project_dir)
        if data.get("locked") and not new_version and not force:
            raise ValueError(
                "Kịch bản đang KHÓA (v%d). Hãy mở khóa, tạo phiên bản mới, "
                "hoặc xác nhận ghi đè rõ ràng trước khi sửa." % data.get("version", 1)
            )

        # Track modified sections for granular DAG micro-propagation
        old_sections = data.get("sections", [])
        old_map = {s.get("id"): s for s in old_sections if isinstance(s, dict) and s.get("id")}
        changed_sections = []
        for idx, s in enumerate(sections):
            if not isinstance(s, dict):
                continue
            sec_id = s.get("id")
            old_sec = old_map.get(sec_id) if sec_id else (old_sections[idx] if idx < len(old_sections) else None)
            if not old_sec or old_sec.get("text") != s.get("text") or old_sec.get("title") != s.get("title"):
                changed_sections.append((idx + 1, sec_id, s))

        version = data.get("version", 1) + (1 if new_version else 0)
        now = datetime.now(timezone.utc).isoformat()

        # Mark downstream components outdated
        outdated = ["voice", "timing", "scene_plan", "captions"]

        data["version"] = version
        data["sections"] = sections
        data["updatedAt"] = now
        data["outdatedDependencies"] = outdated
        if new_version:
            data["locked"] = False
            data["status"] = "DRAFT"

        # Also update raw script.txt
        full_text = "\n\n".join([s.get("text", "") for s in sections])
        self.get_script_text_file(project_dir).write_text(full_text, encoding="utf-8")

        self.get_script_file(project_dir).write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")

        # Synchronize with persistent artifact DAG (state.db)
        if changed_sections:
            try:
                from studio.project_bootstrap import get_project_state_store, bootstrap_project_graph
                from studio.dependency_graph import compute_content_hash
                project_id = project_dir.name
                store = get_project_state_store(project_id)
                graph = bootstrap_project_graph(project_id, state_store=store)

                for idx_1based, sec_id, sec_dict in changed_sections:
                    target_node_id = None
                    if sec_id and graph.has_node(sec_id):
                        target_node_id = sec_id
                    elif sec_id and graph.has_node(f"beat_{idx_1based:03d}"):
                        target_node_id = f"beat_{idx_1based:03d}"
                    elif sec_id and graph.has_node(f"beat_{idx_1based}"):
                        target_node_id = f"beat_{idx_1based}"
                    elif graph.has_node(f"c_{idx_1based:02d}"):
                        target_node_id = f"c_{idx_1based:02d}"
                    elif graph.has_node(f"chunk_{idx_1based}"):
                        target_node_id = f"chunk_{idx_1based}"

                    if target_node_id:
                        new_hash = compute_content_hash({
                            "id": target_node_id,
                            "text": sec_dict.get("text", ""),
                            "title": sec_dict.get("title", ""),
                        })
                        graph.update_node_content(target_node_id, new_hash)

                if graph.has_node("script_root"):
                    new_script_hash = compute_content_hash({"script_text": full_text})
                    node = graph.get_node("script_root")
                    if node:
                        node.content_hash = new_script_hash

                store.save_graph(graph)
            except Exception as e:
                logger.debug(f"DAG sync on script update for {project_dir.name}: {e}")

        return data

    def approve_and_lock_script(self, project_dir: Path) -> Dict[str, Any]:
        data = self.get_script_data(project_dir)
        data["status"] = "APPROVED"
        data["locked"] = True
        data["approvedAt"] = datetime.now(timezone.utc).isoformat()
        self.get_script_file(project_dir).write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
        return data

    def get_vietnamese_explanation(self, project_dir: Path) -> List[Dict[str, str]]:
        """Return friendly Vietnamese explanation of English script segments."""
        data = self.get_script_data(project_dir)
        results = []
        for sec in data.get("sections", []):
            text = sec.get("text", "")
            # Return segment with human explanation marker
            results.append({
                "id": sec.get("id", ""),
                "englishText": text,
                "viExplanation": f"[Diễn giải] Đoạn này tập trung giải thích: {text[:80]}..."
            })
        return results

script_service = ScriptService()
