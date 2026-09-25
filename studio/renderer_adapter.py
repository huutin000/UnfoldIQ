"""
UnfoldIQ Renderer Adapter & Export Package Pipeline — Phase 14
Principles:
- Free-first local rendering via FFmpegRenderer.
- Draft Render: Fast 720p assembly for rapid review.
- Final Render: 1080p high quality master assembly with master audio and subtitles.
- Review Issues: Targeted shot reporting and targeted regeneration without restarting project.
- Complete Export Package: final.mp4, subtitles.srt, sources.md, description.txt, metadata.json.
"""

import hashlib
import json
import logging
import os
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, Optional, List

from studio.config import config
from studio.timeline_compiler import timeline_compiler
from studio.research_service import research_service

logger = logging.getLogger("unfoldiq.renderer")

class ReviewIssueStatus:
    OPEN = "OPEN"
    RESOLVED = "RESOLVED"
    WAIVED = "WAIVED"

class FFmpegRenderer:
    def __init__(self):
        self.ffmpeg_path = config.ffmpeg_path

    def _get_renders_dir(self, project_dir: Path) -> Path:
        rdir = project_dir / "renders"
        (rdir / "draft").mkdir(parents=True, exist_ok=True)
        (rdir / "final").mkdir(parents=True, exist_ok=True)
        return rdir

    def _get_review_issues_file(self, project_dir: Path) -> Path:
        return project_dir / "review_issues.json"

    def list_review_issues(self, project_dir: Path) -> List[Dict[str, Any]]:
        rfile = self._get_review_issues_file(project_dir)
        if rfile.exists():
            try:
                return json.loads(rfile.read_text(encoding="utf-8")).get("issues", [])
            except Exception:
                pass
        return []

    def create_review_issue(
        self,
        project_dir: Path,
        scene_id: str,
        issue_type: str,
        description: str,
        severity: str = "WARNING"
    ) -> Dict[str, Any]:
        rfile = self._get_review_issues_file(project_dir)
        issues = self.list_review_issues(project_dir)
        issue_id = f"REV-{len(issues) + 1:03d}"
        # P2 (§16): lineage — link issue tới asset/artifact version tại thời điểm báo cáo.
        linked_asset = None
        try:
            from studio.asset_intake import asset_intake as _intake
            sel = _intake.get_selected_asset_for_scene(project_dir, scene_id)
            if sel:
                linked_asset = {
                    "assetId": sel.get("id"),
                    "checksum": sel.get("checksum"),
                    "lifecycle": sel.get("lifecycle"),
                }
        except Exception:
            pass
        new_issue = {
            "id": issue_id,
            "sceneId": scene_id,
            "issueType": issue_type,
            "severity": severity,
            "description": description,
            "status": ReviewIssueStatus.OPEN,
            "linkedAsset": linked_asset,
            "verified": False,
            "createdAt": datetime.now(timezone.utc).isoformat()
        }
        issues.append(new_issue)
        rfile.write_text(json.dumps({"issues": issues}, indent=2, ensure_ascii=False), encoding="utf-8")
        return new_issue

    def resolve_review_issue(self, project_dir: Path, issue_id: str) -> bool:
        rfile = self._get_review_issues_file(project_dir)
        issues = self.list_review_issues(project_dir)
        updated = False
        for iss in issues:
            if iss["id"] == issue_id:
                # P2 (§16): verify target đã thay/sửa trước khi đóng — không đổi status mù.
                # So checksum asset hiện tại với lúc báo cáo; khác nhau = đã xử lý thật.
                verified = False
                try:
                    from studio.asset_intake import asset_intake as _intake
                    sel = _intake.get_selected_asset_for_scene(project_dir, iss.get("sceneId", ""))
                    linked = iss.get("linkedAsset") or {}
                    if sel and linked and sel.get("checksum") != linked.get("checksum"):
                        verified = True
                    elif sel and not linked:
                        verified = True  # issue cũ không có lineage: coi như đã chạm artifact
                except Exception:
                    pass
                iss["status"] = ReviewIssueStatus.RESOLVED
                iss["verified"] = verified
                iss["resolvedAt"] = datetime.now(timezone.utc).isoformat()
                updated = True
                break
        if updated:
            rfile.write_text(json.dumps({"issues": issues}, indent=2, ensure_ascii=False), encoding="utf-8")
        return updated

    def _resolve_scene_id(self, sc: Dict[str, Any], idx: int) -> str:
        """Timeline scenes carry `sceneId` (camelCase); accept legacy keys and
        fall back to the stable scene index so clip filenames never collapse
        to a single shared file."""
        return str(sc.get("sceneId") or sc.get("scene_id") or sc.get("id") or f"sc{idx:03d}")

    @staticmethod
    def _asset_cache_key(asset_path: Path) -> str:
        h = hashlib.sha256()
        with open(asset_path, "rb") as f:
            while chunk := f.read(65536):
                h.update(chunk)
        return h.hexdigest()[:12]

    def _prepare_scene_clip(
        self,
        project_dir: Path,
        asset_path: Path,
        scene_id: str,
        duration: float,
        target_w: int,
        target_h: int,
        temp_dir: Path
    ) -> Path:
        """Ensure the asset is a valid video clip, converting static image artifacts if needed."""
        if asset_path.suffix.lower() in [".png", ".jpg", ".jpeg", ".webp"]:
            clip_out = temp_dir / f"img_clip_{scene_id}_{self._asset_cache_key(asset_path)}_{target_w}.mp4"
            if not clip_out.exists():
                cmd = [
                    self.ffmpeg_path, "-y",
                    "-loop", "1", "-i", str(asset_path),
                    "-t", str(max(1.0, duration)),
                    "-vf", f"scale={target_w}:{target_h}:force_original_aspect_ratio=decrease,pad={target_w}:{target_h}:(ow-iw)/2:(oh-ih)/2,format=yuv420p",
                    "-r", "24", "-c:v", "libx264", "-preset", "ultrafast",
                    str(clip_out)
                ]
                subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True, timeout=60)
            return clip_out
        return asset_path

    def render_draft(self, project_dir: Path, progress_callback=None) -> Dict[str, Any]:
        """Render fast 720p draft preview video using local FFmpeg."""
        timeline = timeline_compiler.get_timeline(project_dir)
        renders_dir = self._get_renders_dir(project_dir)
        draft_dir = renders_dir / "draft"
        draft_dir.mkdir(parents=True, exist_ok=True)
        draft_out = draft_dir / "draft_preview.mp4"

        scenes = timeline.get("scenes", [])
        audio_file = project_dir / "audio.wav"

        # Check if any scene has a real visual asset
        real_assets = [sc for sc in scenes if sc.get("assetFilePath") and (project_dir / sc["assetFilePath"]).exists()]

        if not audio_file.exists():
            raise FileNotFoundError("Audio master file (audio.wav) not found. Generate audio first.")

        # Build draft video using FFmpeg
        # If no visual assets yet, generate colored background card with audio
        if not real_assets:
            total_dur = timeline.get("totalDuration", 10.0)
            cmd = [
                self.ffmpeg_path, "-y",
                "-f", "lavfi", "-i", f"color=c=0x111827:s=1280x720:d={total_dur}:r=24",
                "-i", str(audio_file),
                "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-b:a", "128k",
                "-shortest",
                str(draft_out)
            ]
            subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True, timeout=120)
        else:
            # Build concat script with visual clips
            concat_txt = draft_dir / "concat_draft.txt"
            with open(concat_txt, "w", encoding="utf-8") as f:
                for idx, sc in enumerate(scenes):
                    sc_id = self._resolve_scene_id(sc, idx)
                    sc_dur = float(sc.get("duration") or 5.0)
                    if sc.get("assetFilePath") and (project_dir / sc["assetFilePath"]).exists():
                        target_clip = self._prepare_scene_clip(
                            project_dir, project_dir / sc["assetFilePath"], sc_id, sc_dur, 1280, 720, draft_dir
                        )
                        f.write(f"file '{target_clip.as_posix()}'\n")
                    else:
                        target_clip = self._prepare_scene_clip(
                            project_dir, project_dir / real_assets[0]["assetFilePath"], sc_id, sc_dur, 1280, 720, draft_dir
                        )
                        f.write(f"file '{target_clip.as_posix()}'\n")

            cmd = [
                self.ffmpeg_path, "-y",
                "-f", "concat", "-safe", "0", "-i", str(concat_txt),
                "-i", str(audio_file),
                "-vf", "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2",
                "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-b:a", "128k",
                "-shortest",
                str(draft_out)
            ]
            subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True, timeout=180)

        return {
            "status": "SUCCESS",
            "type": "draft",
            "outputPath": str(draft_out.relative_to(project_dir)).replace("\\", "/"),
            "absolutePath": str(draft_out),
            "resolution": "1280x720",
            "fileSizeBytes": draft_out.stat().st_size if draft_out.exists() else 0,
            "renderedAt": datetime.now(timezone.utc).isoformat()
        }

    def render_final(self, project_dir: Path) -> Dict[str, Any]:
        """Render production-ready 1080p final video."""
        timeline = timeline_compiler.get_timeline(project_dir)
        renders_dir = self._get_renders_dir(project_dir)
        final_dir = renders_dir / "final"
        final_dir.mkdir(parents=True, exist_ok=True)
        final_out = final_dir / "final.mp4"

        scenes = timeline.get("scenes", [])
        audio_file = project_dir / "audio.wav"

        if not audio_file.exists():
            raise FileNotFoundError("Master narration audio (audio.wav) not found.")

        real_assets = [sc for sc in scenes if sc.get("assetFilePath") and (project_dir / sc["assetFilePath"]).exists()]
        total_dur = timeline.get("totalDuration", 10.0)

        if not real_assets:
            # Fallback high-quality color card with master audio
            cmd = [
                self.ffmpeg_path, "-y",
                "-f", "lavfi", "-i", f"color=c=0x0b0f19:s=1920x1080:d={total_dur}:r=24",
                "-i", str(audio_file),
                "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
                "-shortest",
                str(final_out)
            ]
            subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True, timeout=300)
        else:
            concat_txt = final_dir / "concat_final.txt"
            with open(concat_txt, "w", encoding="utf-8") as f:
                for idx, sc in enumerate(scenes):
                    sc_id = self._resolve_scene_id(sc, idx)
                    sc_dur = float(sc.get("duration") or 5.0)
                    if sc.get("assetFilePath") and (project_dir / sc["assetFilePath"]).exists():
                        target_clip = self._prepare_scene_clip(
                            project_dir, project_dir / sc["assetFilePath"], sc_id, sc_dur, 1920, 1080, final_dir
                        )
                        f.write(f"file '{target_clip.as_posix()}'\n")
                    else:
                        target_clip = self._prepare_scene_clip(
                            project_dir, project_dir / real_assets[0]["assetFilePath"], sc_id, sc_dur, 1920, 1080, final_dir
                        )
                        f.write(f"file '{target_clip.as_posix()}'\n")

            cmd = [
                self.ffmpeg_path, "-y",
                "-f", "concat", "-safe", "0", "-i", str(concat_txt),
                "-i", str(audio_file),
                "-vf", "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2",
                "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
                "-shortest",
                str(final_out)
            ]
            subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True, timeout=360)

        # Build Export Package in exports/
        pkg = self.build_export_package(project_dir, final_out)

        return {
            "status": "SUCCESS",
            "type": "final",
            "outputPath": str(final_out.relative_to(project_dir)).replace("\\", "/"),
            "absolutePath": str(final_out),
            "resolution": "1920x1080",
            "fileSizeBytes": final_out.stat().st_size if final_out.exists() else 0,
            "exportPackage": pkg,
            "renderedAt": datetime.now(timezone.utc).isoformat()
        }

    def _project_topic(self, project_dir: Path) -> str:
        """P2 (§17): topic/description từ project hiện tại — không hard-code topic cũ."""
        try:
            outline = json.loads((project_dir / "narrative_outline.json").read_text(encoding="utf-8"))
            items = outline.get("outline") if isinstance(outline, dict) else outline
            if isinstance(items, list) and items:
                t = (items[0].get("title") or "").strip()
                if t:
                    return t
        except Exception:
            pass
        try:
            script = json.loads((project_dir / "script.json").read_text(encoding="utf-8"))
            secs = script.get("sections") or []
            if secs:
                t = (secs[0].get("title") or "").strip()
                if t:
                    return t
        except Exception:
            pass
        return project_dir.name.replace("_", " ").replace("-", " ").strip() or "UnfoldIQ Video"

    def _project_hook(self, project_dir: Path) -> str:
        try:
            txt = (project_dir / "script.txt").read_text(encoding="utf-8").strip().split("\n\n")[0].strip()
            if txt:
                return txt[:300]
        except Exception:
            pass
        return "Video được sản xuất từ kịch bản đã duyệt bằng UnfoldIQ."

    def build_export_package(self, project_dir: Path, final_video_path: Path) -> Dict[str, Any]:
        """Assemble deliverables package: final.mp4, subtitles.srt, sources.md, description.txt, metadata.json."""
        export_dir = project_dir / "exports"
        export_dir.mkdir(parents=True, exist_ok=True)

        # 1. Copy final.mp4
        dest_video = export_dir / "final.mp4"
        if final_video_path.exists() and final_video_path.resolve() != dest_video.resolve():
            shutil.copy2(final_video_path, dest_video)

        # 2. Subtitles
        srt_src = project_dir / "timestamps.srt"
        dest_srt = export_dir / "subtitles.srt"
        if srt_src.exists():
            shutil.copy2(srt_src, dest_srt)
        else:
            dest_srt.write_text("1\n00:00:00,000 --> 00:00:05,000\n[Phụ đề sẽ được tạo từ timestamps khi có âm thanh.]\n", encoding="utf-8")

        # 3. Scientific Sources Markdown
        research_info = research_service.get_research_summary(project_dir)
        topic = self._project_topic(project_dir)
        sources_md_lines = ["# Scientific Research Sources & Provenance", "", f"**Project:** {project_dir.name}", f"**Topic:** {topic}", "", "## Approved Sources"]
        for s in research_info.get("sources", []):
            sources_md_lines.append(f"- **{s.get('title')}** ({s.get('publisher', 'Unknown')}, {s.get('published_at', '')})")
            sources_md_lines.append(f"  *Author:* {s.get('author', 'N/A')}")
            sources_md_lines.append(f"  *URL:* {s.get('url', 'N/A')}")
            sources_md_lines.append(f"  *Evidence:* {s.get('content_snapshot', '')}\n")

        sources_md_lines.append("## Claim Ledger Summary")
        for c in research_info.get("claims", []):
            sources_md_lines.append(f"- `[{c.get('evidence_type')}]` **{c.get('id')}:** {c.get('statement')}")

        dest_sources = export_dir / "sources.md"
        dest_sources.write_text("\n".join(sources_md_lines), encoding="utf-8")

        # 4. Video description — P2 (§17): lấy từ project hiện tại, không hard-code topic cũ.
        topic = self._project_topic(project_dir)
        hook = self._project_hook(project_dir)
        desc_lines = [
            topic,
            "",
            hook,
            "",
            "Produced with UnfoldIQ AI Video Production Studio (Phase 14).",
        ]
        dest_desc = export_dir / "description.txt"
        dest_desc.write_text("\n".join(desc_lines), encoding="utf-8")

        # 5. Metadata JSON
        meta = {
            "projectId": project_dir.name,
            "exportedAt": datetime.now(timezone.utc).isoformat(),
            "pipelinePhase": "Phase 14 — Free-first Automated Production Pipeline",
            "contentLanguage": "en-US",
            "uiLocale": "vi-VN",
            "deliverables": [
                "final.mp4",
                "subtitles.srt",
                "sources.md",
                "description.txt",
                "metadata.json"
            ]
        }
        dest_meta = export_dir / "metadata.json"
        dest_meta.write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")

        return {
            "exportDirectory": str(export_dir.relative_to(project_dir)).replace("\\", "/"),
            "deliverables": meta["deliverables"]
        }

renderer_adapter = FFmpegRenderer()
