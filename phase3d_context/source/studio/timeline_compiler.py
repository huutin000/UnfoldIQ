"""
UnfoldIQ Auto Timeline Compiler — Phase 14
Principles:
- Compiles timeline.json directly from narration timing, scene plan, selected visuals, and captions.
- Audio Policy: Kokoro narration is MASTER. Generated clip audio is MUTED by default.
- Missing assets create clear blockers without crashing the timeline builder.
- Produces clean timeline specifications ready for FFmpegRenderer.
"""

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, Optional, List

from studio.asset_intake import asset_intake
from studio.scene_planner import compute_file_sha256

logger = logging.getLogger("unfoldiq.timeline")

class TimelineCompiler:
    def __init__(self):
        pass

    def get_timeline_file(self, project_dir: Path) -> Path:
        return project_dir / "timeline.json"

    def compile_timeline(
        self,
        project_dir: Path,
        mute_generated_audio: bool = True,
        transition_type: str = "crossfade",
        transition_duration: float = 0.25,
        strict: bool = False,
    ) -> Dict[str, Any]:
        """Compile complete production timeline for the project.

        P1 (§6): stale-check đầu vào. strict=True → từ chối input stale (raise);
        mặc định vẫn compile nhưng gắn cờ `staleInputs` để UI cảnh báo, không hiện READY giả.
        """
        scene_plan_file = project_dir / "scene_plan.json"
        audio_file = project_dir / "audio.wav"
        subtitles_file = project_dir / "timestamps.srt"

        scenes_data = []
        raw_sp: Dict[str, Any] = {}
        if scene_plan_file.exists():
            try:
                raw_sp = json.loads(scene_plan_file.read_text(encoding="utf-8"))
                scenes_data = raw_sp.get("scenes", [])
            except Exception as e:
                logger.warning(f"Failed to read scene plan: {e}")

        # P1 (§6): stale input detection (timestamps đổi sau khi plan scene).
        stale_inputs: List[str] = []
        try:
            ts_path = project_dir / "timestamps.json"
            if ts_path.is_file() and raw_sp.get("timestamps_sha256"):
                if compute_file_sha256(ts_path) != raw_sp.get("timestamps_sha256"):
                    stale_inputs.append("scene_plan")
        except Exception:
            pass
        try:
            if audio_file.is_file():
                ts_data_raw = json.loads((project_dir / "timestamps.json").read_text(encoding="utf-8"))
                ts_audio = ts_data_raw.get("audio_sha256") or ts_data_raw.get("source_audio_hash")
                if ts_audio and compute_file_sha256(audio_file) != ts_audio:
                    stale_inputs.append("timestamps")
        except Exception:
            pass
        if strict and stale_inputs:
            raise ValueError(
                "Timeline từ chối input stale: %s. Hãy đồng bộ lại trước khi compile."
                % ", ".join(stale_inputs)
            )

        total_audio_duration = 0.0
        if (project_dir / "timestamps.json").exists():
            try:
                ts_data = json.loads((project_dir / "timestamps.json").read_text(encoding="utf-8"))
                total_audio_duration = float(ts_data.get("duration", 0.0))
            except Exception:
                pass

        compiled_scenes = []
        missing_asset_scenes = []
        current_time = 0.0

        for i, sc in enumerate(scenes_data):
            sc_id = sc.get("scene_id") or sc.get("id") or f"scene_{i+1:03d}"
            target_dur = float(sc.get("target_duration") or sc.get("duration") or 6.0)
            voice_dur = float(sc.get("voice_duration") or target_dur)

            # Resolve selected asset from Asset Intake
            selected_asset = asset_intake.get_selected_asset_for_scene(project_dir, sc_id)
            has_asset = selected_asset is not None
            if not has_asset:
                missing_asset_scenes.append(sc_id)

            sc_entry = {
                "sceneId": sc_id,
                "sceneIndex": i + 1,
                "start": round(current_time, 2),
                "end": round(current_time + target_dur, 2),
                "duration": round(target_dur, 2),
                "voiceDuration": round(voice_dur, 2),
                "narrationText": sc.get("narration") or sc.get("narration_text") or "",
                "hasVisual": has_asset,
                "selectedAssetId": selected_asset.get("id") if selected_asset else None,
                "assetFilePath": selected_asset.get("filePath") if selected_asset else None,
                "transition": {
                    "type": transition_type if i > 0 else "cut",
                    "duration": transition_duration if i > 0 else 0.0
                }
            }
            compiled_scenes.append(sc_entry)
            current_time += target_dur

        if total_audio_duration == 0.0:
            total_audio_duration = current_time

        # P1 (§4 lineage + §6 stale): version + cờ stale trong output, không READY giả.
        try:
            script_version = int(json.loads((project_dir / "script.json").read_text(encoding="utf-8")).get("version", 1))
        except Exception:
            script_version = 1
        timeline_complete = len(missing_asset_scenes) == 0 and len(compiled_scenes) > 0
        timeline_data = {
            "timelineVersion": "1.0.0",
            "projectId": project_dir.name,
            "script_version": script_version,
            "staleInputs": stale_inputs,
            "totalDuration": round(total_audio_duration, 2),
            "targetDuration": round(current_time, 2),
            "fps": 24,
            "resolution": {"width": 1920, "height": 1080},
            "audioPolicy": {
                "narrationMaster": True,
                "narrationFile": "audio.wav" if audio_file.exists() else None,
                "muteGeneratedAudio": mute_generated_audio,
                "subtitlesFile": "timestamps.srt" if subtitles_file.exists() else None
            },
            "scenes": compiled_scenes,
            "stats": {
                "totalScenes": len(compiled_scenes),
                "readyScenes": len(compiled_scenes) - len(missing_asset_scenes),
                "missingScenes": len(missing_asset_scenes),
                "status": "READY" if timeline_complete and not stale_inputs else ("STALE" if stale_inputs else "PARTIAL")
            },
            "missingAssetScenes": missing_asset_scenes,
            "compiledAt": datetime.now(timezone.utc).isoformat()
        }

        # Save timeline.json
        self.get_timeline_file(project_dir).write_text(
            json.dumps(timeline_data, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        return timeline_data

    def get_timeline(self, project_dir: Path) -> Dict[str, Any]:
        tfile = self.get_timeline_file(project_dir)
        if tfile.exists():
            try:
                return json.loads(tfile.read_text(encoding="utf-8"))
            except Exception:
                pass
        return self.compile_timeline(project_dir)

timeline_compiler = TimelineCompiler()
