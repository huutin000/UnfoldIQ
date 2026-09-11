"""
UnfoldIQ Visual Scene Planner — Core Engine
Orchestrates scene segmentation, duration-based grouping, 100% timestamp segment coverage,
prompt pack generation, staleness tracking, atomic persistence, and manual edit safety.
"""

import hashlib
import json
import logging
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple

from studio.config import config, PROJECTS_DIR
from studio.prompt_builder import (
    VISUAL_CATEGORIES,
    EVIDENCE_MODES,
    SHOT_TYPES,
    CAMERA_MOTIONS,
    DEFAULT_NEGATIVE_PROMPT,
    GLOBAL_NEGATIVE_PROMPT,
    detect_narration_domain,
    build_negative_prompt,
    infer_visual_category,
    infer_evidence_mode,
    infer_shot_type,
    infer_camera_motion,
    build_visual_summary,
    build_image_prompt,
)

logger = logging.getLogger("unfoldiq.scene_planner")


def compute_file_sha256(filepath: Path) -> str:
    """Compute hex SHA-256 hash of a file."""
    if not filepath.is_file():
        return ""
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


def format_timestamp_hms(seconds: float) -> str:
    """Format seconds into HH:MM:SS.mmm string."""
    ms = int(round((seconds - int(seconds)) * 1000))
    total_seconds = int(seconds)
    hours = total_seconds // 3600
    minutes = (total_seconds % 3600) // 60
    secs = total_seconds % 60
    return f"{hours:02d}:{minutes:02d}:{secs:02d}.{ms:03d}"


class ScenePlanValidationError(Exception):
    """Raised when scene plan fails validation."""
    pass


class ScenePlanner:
    """Production visual scene planner and prompt generator."""

    def __init__(
        self,
        target_duration: Optional[float] = None,
        min_duration: Optional[float] = None,
        max_duration: Optional[float] = None,
        aspect_ratio: Optional[str] = None,
    ):
        self.target_duration = target_duration or config.scene_planner_target_duration
        self.min_duration = min_duration or config.scene_planner_min_duration
        self.max_duration = max_duration or config.scene_planner_max_duration
        self.aspect_ratio = aspect_ratio or config.scene_planner_default_aspect_ratio

    def group_segments_into_scenes(
        self,
        segments: List[Dict[str, Any]],
        audio_duration: float
    ) -> List[Dict[str, Any]]:
        """
        Deterministic duration-based grouping of contiguous sentence timestamp segments.
        Ensures 100% segment coverage AND 100% continuous visual timeline coverage from 0.000 to audio_duration.
        Inter-scene speech silences/pauses are absorbed by holding the preceding visual scene.
        """
        if not segments:
            return []

        grouped_scenes: List[Dict[str, Any]] = []
        current_segments: List[Dict[str, Any]] = []
        scene_counter = 1

        def _make_scene(segs: List[Dict[str, Any]], idx: int) -> Dict[str, Any]:
            seg_start = segs[0]["start"]
            seg_end = segs[-1]["end"]
            seg_ids = [s["index"] for s in segs]
            # Concatenate verbatim narration preserving source sentence spaces
            narration_text = " ".join(s["text"].strip() for s in segs)

            domain = detect_narration_domain(narration_text)
            category = infer_visual_category(narration_text)
            evidence_mode = infer_evidence_mode(narration_text, category)
            shot_type = infer_shot_type(category, narration_text)
            camera_motion = infer_camera_motion(category, shot_type)
            visual_summary = build_visual_summary(narration_text, category)
            prompt = build_image_prompt(
                narration=narration_text,
                category=category,
                shot_type=shot_type,
                evidence_mode=evidence_mode,
                aspect_ratio=self.aspect_ratio,
            )
            negative_prompt = build_negative_prompt(domain)

            return {
                "scene_id": f"scene_{idx:03d}",
                "index": idx,
                "start": round(seg_start, 3),
                "end": round(seg_end, 3),
                "duration": round(seg_end - seg_start, 3),
                "speech_start": round(seg_start, 3),
                "speech_end": round(seg_end, 3),
                "hold_duration": 0.0,
                "timestamp_segment_ids": seg_ids,
                "narration": narration_text,
                "visual_summary": visual_summary,
                "category": category,
                "evidence_mode": evidence_mode,
                "shot_type": shot_type,
                "camera_motion": camera_motion,
                "continuity_group": None,
                "image_prompt": prompt,
                "negative_prompt": negative_prompt,
                "status": "generated",
            }

        for i, seg in enumerate(segments):
            if not current_segments:
                current_segments.append(seg)
                continue

            current_start = current_segments[0]["start"]
            current_dur = seg["end"] - current_start
            existing_dur = current_segments[-1]["end"] - current_start
            seg_dur = seg["end"] - seg["start"]

            # Decision criteria to close current group before adding seg:
            # 1. Existing duration is already >= target_duration
            if existing_dur >= self.target_duration:
                grouped_scenes.append(_make_scene(current_segments, scene_counter))
                scene_counter += 1
                current_segments = [seg]
                continue

            # 2. If adding next segment exceeds max_duration:
            # Close current group if existing duration is sufficient (>= 2.0s) or next segment is substantial (>= target_duration)
            if current_dur > self.max_duration and (existing_dur >= 2.0 or seg_dur >= self.target_duration):
                grouped_scenes.append(_make_scene(current_segments, scene_counter))
                scene_counter += 1
                current_segments = [seg]
                continue

            current_segments.append(seg)

        # Flush remaining
        if current_segments:
            # If the last scene is extremely short (< min_duration) and we have previous scenes,
            # and merging with previous wouldn't exceed max_duration + 3s, merge it
            if (
                len(grouped_scenes) > 0
                and (current_segments[-1]["end"] - current_segments[0]["start"]) < self.min_duration
                and (current_segments[-1]["end"] - grouped_scenes[-1]["start"]) <= (self.max_duration + 3.0)
            ):
                prev_scene = grouped_scenes.pop()
                prev_ids = prev_scene["timestamp_segment_ids"]
                combined_segs = [s for s in segments if s["index"] in prev_ids] + current_segments
                grouped_scenes.append(_make_scene(combined_segs, prev_scene["index"]))
            else:
                grouped_scenes.append(_make_scene(current_segments, scene_counter))

        # Timeline Gap Absorption: ensure 100.0% continuous visual timeline from 0.000 to audio_duration
        # Inter-scene speech silences/pauses are absorbed by holding the preceding visual scene.
        if grouped_scenes:
            grouped_scenes[0]["start"] = 0.000
            for i in range(len(grouped_scenes) - 1):
                next_speech_start = grouped_scenes[i + 1]["speech_start"]
                grouped_scenes[i]["end"] = round(next_speech_start, 3)
                grouped_scenes[i]["duration"] = round(grouped_scenes[i]["end"] - grouped_scenes[i]["start"], 3)
                grouped_scenes[i]["hold_duration"] = max(0.0, round(grouped_scenes[i]["end"] - grouped_scenes[i]["speech_end"], 3))
                grouped_scenes[i + 1]["start"] = grouped_scenes[i]["end"]

            # Final scene extends to audio_duration
            last_sc = grouped_scenes[-1]
            last_sc["end"] = round(audio_duration, 3)
            last_sc["duration"] = round(last_sc["end"] - last_sc["start"], 3)
            last_sc["hold_duration"] = max(0.0, round(last_sc["end"] - last_sc["speech_end"], 3))

        return grouped_scenes

    def validate_scene_plan(
        self,
        plan: Dict[str, Any],
        audio_duration: float,
        expected_segments: List[Dict[str, Any]],
    ) -> List[str]:
        """Validate scene plan integrity against strict Phase 5 invariants."""
        errors = []
        scenes = plan.get("scenes", [])
        if not scenes:
            return ["Scene plan contains no scenes."]

        expected_ids = set(s["index"] for s in expected_segments)
        seen_ids = set()
        seen_scene_ids = set()
        prev_end = 0.0

        for i, sc in enumerate(scenes, start=1):
            sc_id = sc.get("scene_id")
            if not sc_id or sc_id in seen_scene_ids:
                errors.append(f"Duplicate or missing scene_id: {sc_id}")
            seen_scene_ids.add(sc_id)

            if sc.get("index") != i:
                errors.append(f"Scene {sc_id} index mismatch: expected {i}, got {sc.get('index')}")

            start = sc.get("start", -1.0)
            end = sc.get("end", -1.0)
            dur = sc.get("duration", -1.0)

            if start < 0:
                errors.append(f"Scene {sc_id} start < 0: {start}")
            if end <= start:
                errors.append(f"Scene {sc_id} end <= start: {start} -> {end}")
            if round(end - start, 3) != round(dur, 3):
                errors.append(f"Scene {sc_id} duration mismatch: calculated {round(end - start, 3)} != {dur}")
            if i == 1 and abs(start - 0.0) > 0.001:
                errors.append(f"Scene 1 start must be 0.000, got {start}")
            elif i > 1 and abs(start - prev_end) > 0.001:
                errors.append(f"Scene {sc_id} timing discontinuity with previous scene: start {start} != prev_end {prev_end}")

            prev_end = end

            # Segment coverage
            seg_ids = sc.get("timestamp_segment_ids", [])
            if not seg_ids:
                errors.append(f"Scene {sc_id} has no timestamp segments assigned.")
            for sid in seg_ids:
                if sid in seen_ids:
                    errors.append(f"Timestamp segment {sid} assigned multiple times (in {sc_id}).")
                seen_ids.add(sid)
                if sid not in expected_ids:
                    errors.append(f"Timestamp segment {sid} in scene {sc_id} not in source timestamps.")

            # Content checks
            if not sc.get("narration", "").strip():
                errors.append(f"Scene {sc_id} has empty narration.")
            if not sc.get("visual_summary", "").strip():
                errors.append(f"Scene {sc_id} has empty visual_summary.")
            if not sc.get("image_prompt", "").strip():
                errors.append(f"Scene {sc_id} has empty image_prompt.")
            if sc.get("category") not in VISUAL_CATEGORIES:
                errors.append(f"Scene {sc_id} has invalid category: {sc.get('category')}")
            if sc.get("evidence_mode") not in EVIDENCE_MODES:
                errors.append(f"Scene {sc_id} has invalid evidence_mode: {sc.get('evidence_mode')}")
            if sc.get("shot_type") not in SHOT_TYPES:
                errors.append(f"Scene {sc_id} has invalid shot_type: {sc.get('shot_type')}")

        # Invariant: 100% coverage
        missing = expected_ids - seen_ids
        if missing:
            errors.append(f"Uncovered timestamp segments: {sorted(list(missing))}")

        return errors

    def validate_prompt_pack(
        self,
        prompt_pack: Dict[str, Any],
        scene_plan: Dict[str, Any]
    ) -> List[str]:
        """Validate exported image_prompts.json matches scene plan."""
        errors = []
        plan_scenes = scene_plan.get("scenes", [])
        prompt_scenes = prompt_pack.get("scenes", [])

        if len(prompt_scenes) != len(plan_scenes):
            errors.append(f"Prompt count ({len(prompt_scenes)}) does not match scene count ({len(plan_scenes)}).")

        for p_sc, s_sc in zip(prompt_scenes, plan_scenes):
            if p_sc.get("scene_id") != s_sc.get("scene_id"):
                errors.append(f"Scene ID mismatch: prompt {p_sc.get('scene_id')} vs plan {s_sc.get('scene_id')}")
            if p_sc.get("start") != s_sc.get("start") or p_sc.get("end") != s_sc.get("end"):
                errors.append(f"Timing mismatch in {p_sc.get('scene_id')}")
            if not p_sc.get("prompt", "").strip():
                errors.append(f"Empty prompt in {p_sc.get('scene_id')}")

        return errors

    def build_markdown_prompt_pack(self, scene_plan: Dict[str, Any]) -> str:
        """Generate human-friendly copy-paste ready image_prompts.md document."""
        project = scene_plan.get("project", "UnfoldIQ Project")
        audio_dur = scene_plan.get("audio_duration", 0.0)
        scenes = scene_plan.get("scenes", [])
        total_scenes = len(scenes)
        dur_str = format_timestamp_hms(audio_dur)

        lines = [
            f"# Image Prompts — {project}",
            "",
            f"> **Generated by**: UnfoldIQ Visual Scene Planner v{scene_plan.get('planner_version', '5.0.0')}  ",
            f"> **Audio Duration**: {dur_str} ({audio_dur:.2f}s) &bull; **Scenes**: {total_scenes} &bull; **Coverage**: 100.0%  ",
            f"> **Aspect Ratio**: 16:9 Documentary Composition",
            "",
            "---",
            "",
        ]

        for sc in scenes:
            s_str = format_timestamp_hms(sc["start"])
            e_str = format_timestamp_hms(sc["end"])
            cg = f" &bull; Continuity: `{sc['continuity_group']}`" if sc.get("continuity_group") else ""
            lines.append(f"## Scene {sc['index']:03d} — {s_str} → {e_str} ({sc['duration']:.2f}s)")
            lines.append(f"- **Category**: `{sc['category']}` &bull; **Evidence**: `{sc['evidence_mode']}` &bull; **Framing**: {sc['shot_type']} ({sc['camera_motion']}){cg}")
            lines.append("")
            lines.append("### Narration")
            lines.append(f"> {sc['narration']}")
            lines.append("")
            lines.append("### Visual Objective")
            lines.append(f"{sc['visual_summary']}")
            lines.append("")
            lines.append("### Image Prompt")
            lines.append("```text")
            lines.append(sc['image_prompt'])
            lines.append("```")
            lines.append("")
            lines.append("### Negative Prompt")
            lines.append("```text")
            lines.append(sc['negative_prompt'])
            lines.append("```")
            lines.append("")
            lines.append("---")
            lines.append("")

        return "\n".join(lines)

    def _atomic_write_file(self, target_path: Path, content: str) -> None:
        """Safely write file to temporary path then atomic replace."""
        temp_path = target_path.with_suffix(target_path.suffix + f".tmp_{datetime.now().strftime('%f')}")
        try:
            with open(temp_path, "w", encoding="utf-8") as f:
                f.write(content)
                f.flush()
            temp_path.replace(target_path)
        finally:
            if temp_path.exists():
                try:
                    temp_path.unlink()
                except Exception:
                    pass

    def check_scene_plan_status(self, project_dir: Path) -> Dict[str, Any]:
        """
        Check scene plan status and staleness against source audio, script, and timestamps.
        Returns:
            {"status": "Not Generated" | "Ready" | "Stale" | "Failed", ...}
        """
        plan_path = project_dir / "scene_plan.json"
        if not plan_path.is_file():
            return {
                "status": "Not Generated",
                "scene_count": 0,
                "coverage": 0.0,
                "audio_duration": 0.0,
                "stale_reason": None,
            }

        try:
            with open(plan_path, "r", encoding="utf-8") as f:
                plan = json.load(f)
        except Exception as e:
            return {
                "status": "Failed",
                "scene_count": 0,
                "coverage": 0.0,
                "audio_duration": 0.0,
                "stale_reason": f"Corrupt scene_plan.json: {e}",
            }

        # Check hashes
        script_path = project_dir / "script.txt"
        audio_path = project_dir / "audio.wav"
        ts_path = project_dir / "timestamps.json"

        curr_script_hash = compute_file_sha256(script_path)
        curr_audio_hash = compute_file_sha256(audio_path)
        curr_ts_hash = compute_file_sha256(ts_path)

        stale_reasons = []
        if plan.get("source_script_sha256") and curr_script_hash != plan.get("source_script_sha256"):
            stale_reasons.append("script.txt modified")
        if plan.get("audio_sha256") and curr_audio_hash != plan.get("audio_sha256"):
            stale_reasons.append("audio.wav modified")
        if plan.get("timestamps_sha256") and curr_ts_hash != plan.get("timestamps_sha256"):
            stale_reasons.append("timestamps.json modified")

        status = "Stale" if stale_reasons else "Ready"
        return {
            "status": status,
            "scene_count": len(plan.get("scenes", [])),
            "coverage": plan.get("coverage", 100.0),
            "timeline_coverage": plan.get("timeline_coverage", 100.0),
            "audio_duration": plan.get("audio_duration", 0.0),
            "stale_reason": ", ".join(stale_reasons) if stale_reasons else None,
            "created_at": plan.get("created_at"),
            "updated_at": plan.get("updated_at"),
        }

    def plan_project_scenes(
        self,
        project_dir: Path,
        force: bool = False,
    ) -> Dict[str, Any]:
        """
        Generate or regenerate complete scene plan and prompt packs for a project.
        Enforces regeneration backup archive to prevent data loss.
        """
        ts_path = project_dir / "timestamps.json"
        script_path = project_dir / "script.txt"
        audio_path = project_dir / "audio.wav"

        if not ts_path.is_file():
            raise FileNotFoundError(f"Missing timestamps.json in {project_dir}. Generate timestamps first.")
        if not script_path.is_file():
            raise FileNotFoundError(f"Missing script.txt in {project_dir}.")
        if not audio_path.is_file():
            raise FileNotFoundError(f"Missing audio.wav in {project_dir}.")

        with open(ts_path, "r", encoding="utf-8") as f:
            ts_data = json.load(f)

        audio_duration = float(ts_data.get("audio_duration", 0.0))
        segments = ts_data.get("segments", [])
        if not segments:
            raise ValueError("timestamps.json contains no segments.")

        script_sha256 = compute_file_sha256(script_path)
        audio_sha256 = compute_file_sha256(audio_path)
        ts_sha256 = compute_file_sha256(ts_path)

        # Regeneration safety: archive existing plan if present
        existing_plan_path = project_dir / "scene_plan.json"
        if existing_plan_path.is_file():
            archive_name = f"scene_plan_archive_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
            shutil.copy2(existing_plan_path, project_dir / archive_name)
            shutil.copy2(existing_plan_path, project_dir / "scene_plan.json.bak")
            logger.info(f"Archived previous scene plan to {archive_name}")

        # Group segments
        scenes = self.group_segments_into_scenes(segments, audio_duration)

        now_iso = datetime.now(timezone.utc).isoformat()
        plan_data: Dict[str, Any] = {
            "version": 1,
            "project": project_dir.name,
            "created_at": now_iso,
            "updated_at": now_iso,
            "planner_version": "5.0.0",
            "source_script_sha256": script_sha256,
            "audio_sha256": audio_sha256,
            "timestamps_sha256": ts_sha256,
            "audio_duration": audio_duration,
            "scene_count": len(scenes),
            "timestamp_segment_count": len(segments),
            "coverage": 100.0,
            "narration_segment_coverage": 100.0,
            "timeline_coverage": 100.0,
            "inter_scene_gaps": 0,
            "total_uncovered_time": 0.0,
            "status": "Ready",
            "scenes": scenes,
        }

        # Validate
        errors = self.validate_scene_plan(plan_data, audio_duration, segments)
        if errors:
            raise ScenePlanValidationError(f"Scene plan validation failed: {'; '.join(errors)}")

        # Build prompt pack json
        prompt_pack: Dict[str, Any] = {
            "version": 1,
            "project": project_dir.name,
            "audio_duration": audio_duration,
            "scene_count": len(scenes),
            "scenes": [
                {
                    "scene_id": sc["scene_id"],
                    "index": sc["index"],
                    "start": sc["start"],
                    "end": sc["end"],
                    "duration": sc["duration"],
                    "speech_start": sc.get("speech_start", sc["start"]),
                    "speech_end": sc.get("speech_end", sc["end"]),
                    "hold_duration": sc.get("hold_duration", 0.0),
                    "category": sc["category"],
                    "prompt": sc["image_prompt"],
                    "negative_prompt": sc["negative_prompt"],
                    "continuity_group": sc["continuity_group"],
                }
                for sc in scenes
            ]
        }

        prompt_errors = self.validate_prompt_pack(prompt_pack, plan_data)
        if prompt_errors:
            raise ScenePlanValidationError(f"Prompt pack validation failed: {'; '.join(prompt_errors)}")

        # Build markdown prompt pack
        prompt_md = self.build_markdown_prompt_pack(plan_data)

        # Atomic writes
        self._atomic_write_file(project_dir / "scene_plan.json", json.dumps(plan_data, indent=2, ensure_ascii=False))
        self._atomic_write_file(project_dir / "image_prompts.json", json.dumps(prompt_pack, indent=2, ensure_ascii=False))
        self._atomic_write_file(project_dir / "image_prompts.md", prompt_md)

        logger.info(f"Successfully generated {len(scenes)} scenes for {project_dir.name} (100% coverage).")
        return plan_data

    def update_scene(
        self,
        project_dir: Path,
        scene_id: str,
        updates: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Manually edit scene visual attributes while preserving timing and segment bindings.
        Re-validates and atomically persists scene_plan.json, image_prompts.json, and image_prompts.md.
        """
        plan_path = project_dir / "scene_plan.json"
        if not plan_path.is_file():
            raise FileNotFoundError(f"Scene plan not found in {project_dir}")

        with open(plan_path, "r", encoding="utf-8") as f:
            plan = json.load(f)

        target_scene = None
        for sc in plan.get("scenes", []):
            if sc.get("scene_id") == scene_id:
                target_scene = sc
                break

        if not target_scene:
            raise KeyError(f"Scene {scene_id} not found in project scene plan.")

        # Allowed editable fields
        allowed_fields = [
            "visual_summary",
            "category",
            "evidence_mode",
            "shot_type",
            "camera_motion",
            "continuity_group",
            "image_prompt",
            "negative_prompt",
        ]

        changed = False
        for field in allowed_fields:
            if field in updates and updates[field] is not None:
                val = updates[field]
                if field == "category" and val not in VISUAL_CATEGORIES:
                    raise ValueError(f"Invalid visual category: {val}")
                if field == "evidence_mode" and val not in EVIDENCE_MODES:
                    raise ValueError(f"Invalid evidence mode: {val}")
                if field == "shot_type" and val not in SHOT_TYPES:
                    raise ValueError(f"Invalid shot type: {val}")
                if field == "camera_motion" and val not in CAMERA_MOTIONS:
                    raise ValueError(f"Invalid camera motion: {val}")
                target_scene[field] = val
                changed = True

        if changed:
            target_scene["status"] = "edited"
            plan["updated_at"] = datetime.now(timezone.utc).isoformat()

            # Validate
            ts_path = project_dir / "timestamps.json"
            expected_segments = []
            if ts_path.is_file():
                with open(ts_path, "r", encoding="utf-8") as f:
                    ts_data = json.load(f)
                expected_segments = ts_data.get("segments", [])

            errors = self.validate_scene_plan(plan, plan.get("audio_duration", 0.0), expected_segments)
            if errors:
                raise ScenePlanValidationError(f"Edited scene plan validation failed: {'; '.join(errors)}")

            # Sync prompt pack
            prompt_pack: Dict[str, Any] = {
                "version": 1,
                "project": project_dir.name,
                "audio_duration": plan.get("audio_duration", 0.0),
                "scene_count": len(plan["scenes"]),
                "scenes": [
                    {
                        "scene_id": sc["scene_id"],
                        "index": sc["index"],
                        "start": sc["start"],
                        "end": sc["end"],
                        "duration": sc["duration"],
                        "speech_start": sc.get("speech_start", sc["start"]),
                        "speech_end": sc.get("speech_end", sc["end"]),
                        "hold_duration": sc.get("hold_duration", 0.0),
                        "category": sc["category"],
                        "prompt": sc["image_prompt"],
                        "negative_prompt": sc["negative_prompt"],
                        "continuity_group": sc["continuity_group"],
                    }
                    for sc in plan["scenes"]
                ]
            }

            prompt_md = self.build_markdown_prompt_pack(plan)

            # Atomic writes
            self._atomic_write_file(plan_path, json.dumps(plan, indent=2, ensure_ascii=False))
            self._atomic_write_file(project_dir / "image_prompts.json", json.dumps(prompt_pack, indent=2, ensure_ascii=False))
            self._atomic_write_file(project_dir / "image_prompts.md", prompt_md)

        return target_scene


scene_planner = ScenePlanner()
