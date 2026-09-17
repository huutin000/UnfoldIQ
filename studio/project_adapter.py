"""
UnfoldIQ Project Adapter — Backward-compatible storage adapter (Phase 1)
Maps legacy files (scene_plan.json, veo_prompts.json, visual_bible.json, timestamps.json)
into unified ProjectV2State entities and saves with atomic writes and automatic backups.
"""

import json
import logging
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple

from studio.config import PROJECTS_DIR
from studio.domain_models import (
    ProjectV2State,
    Scene,
    Shot,
    AudioChunk,
    WordCue,
    StoryBeat,
    AssetRef,
    StorySlice,
    VoiceSlice,
    VisualSlice,
    OverviewSlice,
    SceneSummary,
    VisualSummarySlice,
    VisualBibleSlice,
)

logger = logging.getLogger("unfoldiq.project_adapter")

# In-memory document cache to avoid repeated multi-megabyte JSON deserialization:
# project_id -> (cache_timestamp, ProjectV2State)
_project_cache: Dict[str, Tuple[float, ProjectV2State]] = {}


class ProjectAdapter:
    def __init__(self, projects_dir: Optional[Path] = None):
        self.projects_dir = projects_dir or PROJECTS_DIR

    def resolve_project_dir(self, dir_name: str) -> Path:
        p = self.projects_dir / dir_name
        if not p.is_dir():
            raise FileNotFoundError(f"Project directory not found: {dir_name}")
        return p

    def load_project_v2(self, dir_name: str, force_reload: bool = False) -> ProjectV2State:
        """
        Load project files and assemble unified ProjectV2State with stable IDs.
        Caches in memory for fast retrieval; force_reload bypasses cache.
        """
        project_dir = self.resolve_project_dir(dir_name)
        project_id = project_dir.name

        # 1. Read script.txt
        script_text = ""
        script_path = project_dir / "script.txt"
        if script_path.is_file():
            try:
                script_text = script_path.read_text(encoding="utf-8")
            except Exception as e:
                logger.warning(f"Failed to read script.txt for {project_id}: {e}")

        # 2. Read settings.json
        settings: Dict[str, Any] = {}
        settings_path = project_dir / "settings.json"
        if settings_path.is_file():
            try:
                settings = json.loads(settings_path.read_text(encoding="utf-8"))
            except Exception as e:
                logger.warning(f"Failed to read settings.json for {project_id}: {e}")

        # 3. Read manifest.json (Audio chunks)
        audio_chunks: List[AudioChunk] = []
        manifest_path = project_dir / "manifest.json"
        if manifest_path.is_file():
            try:
                mdata = json.loads(manifest_path.read_text(encoding="utf-8"))
                for idx, c in enumerate(mdata.get("chunks", [])):
                    chunk_id = c.get("chunk_id") or c.get("id") or f"c_{idx+1:02d}"
                    c_kwargs = dict(c)
                    c_kwargs["chunk_id"] = chunk_id
                    c_kwargs["index"] = idx + 1
                    c_kwargs["text"] = c.get("text") or c.get("synthesis_text", "")
                    if "voice" not in c_kwargs or not c_kwargs["voice"]:
                        c_kwargs["voice"] = settings.get("voice")
                    if "speed" not in c_kwargs or c_kwargs["speed"] is None:
                        c_kwargs["speed"] = float(settings.get("speed") or 1.0)
                    c_kwargs["render_hash"] = c.get("render_hash")
                    c_kwargs["audio_file"] = c.get("output_file")
                    c_kwargs["duration"] = float(c.get("duration", 0.0))
                    c_kwargs["is_locked"] = bool(c.get("is_locked", False))
                    audio_chunks.append(AudioChunk(**c_kwargs))
            except Exception as e:
                logger.warning(f"Failed to read manifest.json for {project_id}: {e}")

        # 4. Read timestamps.json (Word cues)
        ts_path = project_dir / "timestamps.json"
        if ts_path.is_file():
            try:
                tdata = json.loads(ts_path.read_text(encoding="utf-8"))
                words_raw = tdata.get("words") or []
                if words_raw and audio_chunks:
                    # Map word cues into first chunk or across chunks if available
                    for w in words_raw:
                        if isinstance(w, dict) and "word" in w:
                            audio_chunks[0].words.append(
                                WordCue(
                                    word=w["word"],
                                    start=float(w.get("start", 0.0)),
                                    end=float(w.get("end", 0.0)),
                                    score=w.get("score"),
                                )
                            )
            except Exception as e:
                logger.warning(f"Failed to read timestamps.json for {project_id}: {e}")

        # 5. Read visual_bible.json
        visual_bible: Dict[str, Any] = {}
        vb_path = project_dir / "visual_bible.json"
        if vb_path.is_file():
            try:
                visual_bible = json.loads(vb_path.read_text(encoding="utf-8"))
            except Exception as e:
                logger.warning(f"Failed to read visual_bible.json for {project_id}: {e}")

        # 6. Read veo_prompts.json (Shots)
        veo_shots_raw: List[Dict[str, Any]] = []
        veo_path = project_dir / "veo_prompts.json"
        if veo_path.is_file():
            try:
                veo_data = json.loads(veo_path.read_text(encoding="utf-8"))
                veo_shots_raw = veo_data.get("shots", [])
            except Exception as e:
                logger.warning(f"Failed to read veo_prompts.json for {project_id}: {e}")

        # 7. Read scene_plan.json (Scenes)
        scenes: List[Scene] = []
        scene_plan_path = project_dir / "scene_plan.json"
        if scene_plan_path.is_file():
            try:
                sp_data = json.loads(scene_plan_path.read_text(encoding="utf-8"))
                raw_scenes = sp_data.get("scenes", [])
                for sc in raw_scenes:
                    sc_id = str(sc.get("scene_id") or f"sc_{sc.get('index', 1):02d}")
                    # Collect shots belonging to this scene
                    matching_shots: List[Shot] = []
                    for sh in veo_shots_raw:
                        parent_id = sh.get("parent_scene_id") or sh.get("parentSceneId") or sh.get("scene_id")
                        if parent_id == sc_id:
                            sh_kwargs = dict(sh)
                            sh_kwargs["shot_id"] = str(sh.get("shot_id") or f"{sc_id}_sh1")
                            sh_kwargs["parent_scene_id"] = sc_id
                            sh_kwargs["index"] = int(sh.get("index") or 1)
                            sh_kwargs["shot_type"] = sh.get("shot_type") or sc.get("shot_type", "medium wide")
                            sh_kwargs["camera_motion"] = sh.get("camera_motion") or "static cinematic camera"
                            sh_kwargs["aspect_ratio"] = sh.get("aspect_ratio") or "16:9"
                            sh_kwargs["veo_prompt"] = sh.get("veo_prompt") or ""
                            sh_kwargs["negative_prompt"] = sh.get("negative_prompt") or ""
                            matching_shots.append(Shot(**sh_kwargs))

                    # If no matching shots in veo_prompts, create default shot from scene
                    if not matching_shots:
                        matching_shots.append(
                            Shot(
                                shot_id=f"{sc_id}_sh1",
                                parent_scene_id=sc_id,
                                index=1,
                                shot_type=sc.get("shot_type") or "medium wide",
                                camera_motion="static cinematic camera",
                                veo_prompt=sc.get("image_prompt") or sc.get("visual_summary") or "",
                                negative_prompt="",
                                start=sc.get("start", 0.0),
                                end=sc.get("end", 0.0),
                                duration=sc.get("duration", 0.0),
                            )
                        )

                    sc_kwargs = dict(sc)
                    sc_kwargs["scene_id"] = sc_id
                    sc_kwargs["index"] = int(sc.get("index") or len(scenes) + 1)
                    sc_kwargs["category"] = sc.get("category", "reconstruction")
                    sc_kwargs["start"] = float(sc.get("start", 0.0))
                    sc_kwargs["end"] = float(sc.get("end", 0.0))
                    sc_kwargs["duration"] = float(sc.get("duration", 0.0))
                    sc_kwargs["visual_summary"] = sc.get("visual_summary", "")
                    sc_kwargs["narration"] = sc.get("narration", "")
                    sc_kwargs["image_prompt"] = sc.get("image_prompt", "")
                    sc_kwargs["evidence_mode"] = sc.get("evidence_mode", "reconstruction")
                    sc_kwargs["shot_type"] = sc.get("shot_type", "medium wide")
                    sc_kwargs["shots"] = matching_shots
                    scenes.append(Scene(**sc_kwargs))
            except Exception as e:
                logger.warning(f"Failed to read scene_plan.json for {project_id}: {e}")

        # 8. Read assets/intake_ledger.json
        assets: List[AssetRef] = []
        ledger_path = project_dir / "assets" / "intake_ledger.json"
        if ledger_path.is_file():
            try:
                ldata = json.loads(ledger_path.read_text(encoding="utf-8"))
                for a in ldata.get("assets", []):
                    assets.append(
                        AssetRef(
                            asset_id=a.get("id") or a.get("asset_id", ""),
                            scene_id=a.get("scene_id"),
                            shot_id=a.get("shot_id"),
                            thumbnail_path=a.get("thumbnail_path"),
                            master_path=a.get("filepath") or a.get("master_path"),
                            lifecycle_state=a.get("lifecycle_state", "GENERATED"),
                            checksum=a.get("checksum"),
                            mime_type=a.get("mime_type"),
                        )
                    )
            except Exception as e:
                logger.warning(f"Failed to read intake_ledger.json for {project_id}: {e}")

        # 9. Read story_beats.json (Beats)
        story_beats: List[StoryBeat] = []
        beats_path = project_dir / "story_beats.json"
        if beats_path.is_file():
            try:
                bdata = json.loads(beats_path.read_text(encoding="utf-8"))
                for b in bdata.get("beats", []):
                    story_beats.append(StoryBeat(**b))
            except Exception as e:
                logger.warning(f"Failed to read story_beats.json for {project_id}: {e}")

        # Assemble ProjectV2State
        state = ProjectV2State(
            project_id=project_id,
            schema_version="2.0.0",
            title=settings.get("project_name") or project_id,
            script_text=script_text,
            audio_chunks=audio_chunks,
            scenes=scenes,
            visual_bible=visual_bible,
            story_beats=story_beats,
            assets=assets,
            metadata=settings,
        )

        return state

    def save_project_v2(self, project_dir: Path, state: ProjectV2State, make_backup: bool = True) -> None:
        """
        Save ProjectV2State safely with .bak backups and sync to legacy files
        so existing endpoints and readers continue working with 100% compatibility.
        """
        project_dir = Path(project_dir).resolve()
        now_iso = datetime.now(timezone.utc).isoformat()

        # 1. Backup existing files if requested
        if make_backup:
            for fname in ("scene_plan.json", "veo_prompts.json", "settings.json", "manifest.json", "visual_bible.json", "story_beats.json"):
                fp = project_dir / fname
                if fp.is_file():
                    shutil.copy2(fp, project_dir / f"{fname}.bak")
            ledger_fp = project_dir / "assets" / "intake_ledger.json"
            if ledger_fp.is_file():
                shutil.copy2(ledger_fp, project_dir / "assets" / "intake_ledger.json.bak")

        # 2. Sync to scene_plan.json
        scenes_export = []
        all_shots = []
        for sc in state.scenes:
            sc_dump = sc.model_dump(exclude={"shots"})
            scenes_export.append(sc_dump)
            for sh in sc.shots:
                sh_dump = sh.model_dump()
                sh_dump["parent_scene_id"] = sc.scene_id
                sh_dump["parentSceneId"] = sc.scene_id
                sh_dump["scene_id"] = sc.scene_id
                all_shots.append(sh_dump)

        sp_payload = {
            "schema_version": "2.0.0",
            "updated_at": now_iso,
            "scenes": scenes_export,
            "total_scenes": len(scenes_export),
        }
        tmp_sp = project_dir / "scene_plan.tmp.json"
        tmp_sp.write_text(json.dumps(sp_payload, indent=2, ensure_ascii=False), encoding="utf-8")
        tmp_sp.replace(project_dir / "scene_plan.json")

        # 3. Sync to veo_prompts.json
        veo_payload = {
            "schema_version": "2.0.0",
            "updated_at": now_iso,
            "shots": all_shots,
            "total_shots": len(all_shots),
        }
        tmp_veo = project_dir / "veo_prompts.tmp.json"
        tmp_veo.write_text(json.dumps(veo_payload, indent=2, ensure_ascii=False), encoding="utf-8")
        tmp_veo.replace(project_dir / "veo_prompts.json")

        # 4. Sync manifest.json (Audio chunks with chunk_id)
        if state.audio_chunks:
            manifest_path = project_dir / "manifest.json"
            base_manifest: Dict[str, Any] = {}
            if manifest_path.is_file():
                try:
                    base_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
                except Exception:
                    pass

            chunks_export = []
            for c in state.audio_chunks:
                c_dump = c.model_dump(exclude={"words"})
                if c.audio_file:
                    c_dump["output_file"] = c.audio_file
                chunks_export.append(c_dump)

            base_manifest["schema_version"] = "2.0.0"
            base_manifest["updated_at"] = now_iso
            base_manifest["total_chunks"] = len(chunks_export)
            base_manifest["chunks"] = chunks_export

            tmp_mf = project_dir / "manifest.tmp.json"
            tmp_mf.write_text(json.dumps(base_manifest, indent=2, ensure_ascii=False), encoding="utf-8")
            tmp_mf.replace(manifest_path)

        # 5. Sync story_beats.json (if present)
        if state.story_beats:
            beats_payload = {
                "schema_version": "2.0.0",
                "updated_at": now_iso,
                "total_beats": len(state.story_beats),
                "beats": [b.model_dump() for b in state.story_beats],
            }
            tmp_sb = project_dir / "story_beats.tmp.json"
            tmp_sb.write_text(json.dumps(beats_payload, indent=2, ensure_ascii=False), encoding="utf-8")
            tmp_sb.replace(project_dir / "story_beats.json")

        # 6. Sync visual_bible.json (if present)
        if state.visual_bible:
            tmp_vb = project_dir / "visual_bible.tmp.json"
            tmp_vb.write_text(json.dumps(state.visual_bible, indent=2, ensure_ascii=False), encoding="utf-8")
            tmp_vb.replace(project_dir / "visual_bible.json")

        # 7. Sync assets/intake_ledger.json (if present)
        if state.assets:
            assets_dir = project_dir / "assets"
            assets_dir.mkdir(parents=True, exist_ok=True)
            ledger_path = assets_dir / "intake_ledger.json"
            base_ledger: Dict[str, Any] = {}
            if ledger_path.is_file():
                try:
                    base_ledger = json.loads(ledger_path.read_text(encoding="utf-8"))
                except Exception:
                    pass

            assets_export = [
                {
                    "id": a.asset_id,
                    "asset_id": a.asset_id,
                    "scene_id": a.scene_id,
                    "shot_id": a.shot_id,
                    "thumbnail_path": a.thumbnail_path,
                    "filepath": a.master_path,
                    "master_path": a.master_path,
                    "lifecycle_state": a.lifecycle_state,
                    "checksum": a.checksum,
                    "mime_type": a.mime_type,
                }
                for a in state.assets
            ]
            base_ledger["schema_version"] = "2.0.0"
            base_ledger["updated_at"] = now_iso
            base_ledger["total_assets"] = len(assets_export)
            base_ledger["assets"] = assets_export

            tmp_ledger = assets_dir / "intake_ledger.tmp.json"
            tmp_ledger.write_text(json.dumps(base_ledger, indent=2, ensure_ascii=False), encoding="utf-8")
            tmp_ledger.replace(ledger_path)

        logger.info(f"Project {project_dir.name} successfully saved with {len(scenes_export)} scenes, {len(all_shots)} shots, {len(state.audio_chunks)} chunks, {len(state.assets)} assets.")

    def load_story_slice(self, dir_name: str) -> StorySlice:
        """
        Selective loader for Story Workbench.
        Reads only script.txt and story beats/metadata without parsing heavy scene/shot trees.
        """
        project_dir = self.resolve_project_dir(dir_name)
        project_id = project_dir.name

        script_text = ""
        script_path = project_dir / "script.txt"
        if script_path.is_file():
            try:
                script_text = script_path.read_text(encoding="utf-8")
            except Exception as e:
                logger.warning(f"Failed to read script.txt for {project_id}: {e}")

        # Story beats if saved
        beats: List[StoryBeat] = []
        beats_path = project_dir / "story_beats.json"
        if beats_path.is_file():
            try:
                bdata = json.loads(beats_path.read_text(encoding="utf-8"))
                for b in bdata.get("beats", []):
                    beats.append(StoryBeat(**b))
            except Exception as e:
                logger.warning(f"Failed to read story_beats.json for {project_id}: {e}")

        # Fallback to narration_plan.json if story_beats.json not present
        if not beats:
            narr_plan_path = project_dir / "narration_plan.json"
            if narr_plan_path.is_file():
                try:
                    np_data = json.loads(narr_plan_path.read_text(encoding="utf-8"))
                    raw_beats = np_data.get("beats", [])
                    for idx, rb in enumerate(raw_beats):
                        b_text = rb.get("text", "")
                        w_count = len(b_text.split())
                        dur = round(w_count / 2.33, 2)
                        beats.append(
                            StoryBeat(
                                beat_id=rb.get("beatId", f"beat_{idx+1:03d}"),
                                index=idx + 1,
                                title=f"Beat {idx+1} ({rb.get('role', 'NHỊP')})",
                                text=b_text,
                                target_duration_seconds=dur,
                                estimated_duration_sec=dur,
                                estimated_word_count=w_count,
                                style=rb.get("style", "NEUTRAL"),
                                confidence=rb.get("confidence", 1.0),
                                rate=rb.get("rate", 1.0),
                                intensity=rb.get("intensity", 0.3),
                                emphasis=rb.get("emphasis", []),
                                notes=rb.get("reason", ""),
                                is_locked=bool(rb.get("manualEdited", False) or rb.get("accepted", False)),
                            )
                        )
                except Exception as e:
                    logger.warning(f"Failed to read narration_plan.json fallback for {project_id}: {e}")

        word_count = len(script_text.split())
        est_duration = round(word_count / 2.33, 2)  # ~140 words per minute average

        # Settings for metadata
        settings: Dict[str, Any] = {}
        settings_path = project_dir / "settings.json"
        if settings_path.is_file():
            try:
                settings = json.loads(settings_path.read_text(encoding="utf-8"))
            except Exception:
                pass

        return StorySlice(
            project_id=project_id,
            schema_version="2.0.0",
            script_text=script_text,
            beats=beats,
            word_count=word_count,
            estimated_duration_seconds=est_duration,
            metadata=settings,
        )

    def load_voice_slice(self, dir_name: str) -> VoiceSlice:
        """
        Selective loader for Voice Workbench.
        Loads manifest chunks, audio paths, settings, transcript segments, word cues,
        Voice QA metrics, and pronunciation counts without loading heavy visual assets or prompts.
        """
        project_dir = self.resolve_project_dir(dir_name)
        project_id = project_dir.name

        settings: Dict[str, Any] = {}
        settings_path = project_dir / "settings.json"
        if settings_path.is_file():
            try:
                settings = json.loads(settings_path.read_text(encoding="utf-8"))
            except Exception:
                pass

        voice_id = settings.get("voice", "af_sarah")
        speed = float(settings.get("speed", 1.0))

        # 1. Transcript text
        transcript_text = ""
        script_path = project_dir / "script.txt"
        if script_path.is_file():
            try:
                transcript_text = script_path.read_text(encoding="utf-8")
            except Exception:
                pass

        # 2. Timestamps and sentence segments
        segments: List[Dict[str, Any]] = []
        audio_duration = 0.0
        ts_path = project_dir / "timestamps.json"
        if ts_path.is_file():
            try:
                ts_data = json.loads(ts_path.read_text(encoding="utf-8"))
                segments = ts_data.get("segments", [])
                audio_duration = float(ts_data.get("audio_duration", 0.0))
            except Exception:
                pass

        # 3. Word-level cues from transcription_raw.json
        words: List[Dict[str, Any]] = []
        raw_ts_path = project_dir / "transcription_raw.json"
        if raw_ts_path.is_file():
            try:
                raw_data = json.loads(raw_ts_path.read_text(encoding="utf-8"))
                if not audio_duration:
                    audio_duration = float(raw_data.get("audio_duration", 0.0))
                for seg in raw_data.get("segments", []):
                    for w in seg.get("words", []):
                        words.append({
                            "word": str(w.get("word", "")).strip(),
                            "start": round(float(w.get("start", 0.0)), 2),
                            "end": round(float(w.get("end", 0.0)), 2),
                            "score": round(float(w.get("probability", 1.0)), 3)
                        })
            except Exception:
                pass

        # 4. Voice QA metrics, summary, and issue index
        qa_summary = None
        qa_issues_by_sentence: Dict[int, List[Dict[str, Any]]] = {}
        qa_path = project_dir / "voice_qa.json"
        if qa_path.is_file():
            try:
                qa_data = json.loads(qa_path.read_text(encoding="utf-8"))
                metrics = qa_data.get("metrics", {})
                summary = qa_data.get("summary", {})
                issues = qa_data.get("issues", [])
                for iss in issues:
                    s_idx = iss.get("sentence_index")
                    if s_idx is not None:
                        qa_issues_by_sentence.setdefault(s_idx, []).append(iss)
                qa_summary = {
                    "status": qa_data.get("status", "idle"),
                    "metrics": metrics,
                    "summary": summary,
                    "total_issues": len(issues),
                    "unresolved_issues": summary.get("unresolved_fail_count", 0) + summary.get("unresolved_review_count", 0),
                    "issues": issues[:100]  # Cap payload to keep response ultra fast
                }
            except Exception:
                pass

        # 5. Pronunciation count
        pron_count = 0
        pron_path = project_dir.parent.parent / "config" / "pronunciation_dictionary.json"
        if pron_path.is_file():
            try:
                p_data = json.loads(pron_path.read_text(encoding="utf-8"))
                pron_count = len(p_data.get("entries", []))
            except Exception:
                pass

        # 6. Check main audio file
        audio_file = None
        for candidate in ("narration.wav", "audio.wav"):
            cand_p = project_dir / candidate
            if cand_p.is_file():
                audio_file = candidate
                break

        # 7. Audio Chunks from manifest
        audio_chunks: List[AudioChunk] = []
        manifest_path = project_dir / "manifest.json"
        if manifest_path.is_file():
            try:
                mdata = json.loads(manifest_path.read_text(encoding="utf-8"))
                for idx, c in enumerate(mdata.get("chunks", [])):
                    chunk_id = c.get("chunk_id") or c.get("id") or f"c_{idx+1:02d}"
                    c_text = c.get("text") or c.get("synthesis_text", "")
                    c_duration = float(c.get("duration", 0.0))

                    # Estimate duration from matching segment if manifest chunk duration is 0
                    matching_issues: List[Dict[str, Any]] = []
                    if idx < len(segments):
                        seg = segments[idx]
                        if not c_duration and seg.get("start") is not None and seg.get("end") is not None:
                            c_duration = round(float(seg["end"]) - float(seg["start"]), 2)
                        s_idx = seg.get("index", idx + 1)
                        matching_issues = qa_issues_by_sentence.get(s_idx, [])

                    audio_chunks.append(
                        AudioChunk(
                            chunk_id=chunk_id,
                            index=idx + 1,
                            text=c_text,
                            voice=c.get("voice") or voice_id,
                            speed=float(c.get("speed") or speed),
                            render_hash=c.get("render_hash"),
                            audio_file=c.get("output_file") or (audio_file if audio_file else None),
                            duration=c_duration,
                            is_locked=bool(c.get("is_locked", False)),
                            status="READY" if (audio_file or c.get("output_file")) else "EMPTY",
                            qa_issues_count=len(matching_issues),
                            qa_issues=matching_issues,
                        )
                    )
            except Exception as e:
                logger.warning(f"Failed to read manifest.json for {project_id}: {e}")

        has_audio = audio_file is not None or any(c.audio_file for c in audio_chunks)
        has_mp3 = (project_dir / "audio.mp3").is_file()
        total_duration = audio_duration or sum(c.duration or 0.0 for c in audio_chunks)
        audio_status = "READY" if has_audio else "EMPTY"

        return VoiceSlice(
            project_id=project_id,
            schema_version="2.0.0",
            voice_id=voice_id,
            speed=speed,
            chunks=audio_chunks,
            total_chunks=len(audio_chunks),
            total_duration_seconds=round(total_duration, 2),
            has_audio=has_audio,
            has_mp3=has_mp3,
            audio_status=audio_status,
            audio_file=audio_file,
            transcript_text=transcript_text,
            segments=segments,
            words=words,
            qa_summary=qa_summary,
            pronunciation_count=pron_count,
        )

    def load_visual_summary(self, dir_name: str) -> VisualSummarySlice:
        """
        Ultra-fast visual pipeline summary.
        Provides scene/shot counts, total duration, and entity stats without full payload.
        """
        project_dir = self.resolve_project_dir(dir_name)
        project_id = project_dir.name

        total_scenes = 0
        total_duration = 0.0
        sp_path = project_dir / "scene_plan.json"
        if sp_path.is_file():
            try:
                sp_data = json.loads(sp_path.read_text(encoding="utf-8"))
                scenes_list = sp_data.get("scenes", [])
                total_scenes = len(scenes_list)
                total_duration = sum(float(sc.get("duration", 0.0)) for sc in scenes_list)
            except Exception:
                pass

        total_shots = 0
        veo_path = project_dir / "veo_prompts.json"
        if veo_path.is_file():
            try:
                veo_data = json.loads(veo_path.read_text(encoding="utf-8"))
                total_shots = len(veo_data.get("shots", []))
            except Exception:
                pass

        entity_counts = {"characters": 0, "environments": 0, "objects": 0}
        vb_status = "EMPTY"
        vb_path = project_dir / "visual_bible.json"
        if vb_path.is_file():
            try:
                vb_data = json.loads(vb_path.read_text(encoding="utf-8"))
                entity_counts["characters"] = len(vb_data.get("characters", []))
                entity_counts["environments"] = len(vb_data.get("environments", []))
                entity_counts["objects"] = len(vb_data.get("objects", []))
                vb_status = "READY" if any(entity_counts.values()) else "EMPTY"
            except Exception:
                pass

        visual_status = "READY" if total_scenes > 0 else "EMPTY"

        return VisualSummarySlice(
            project_id=project_id,
            schema_version="2.0.0",
            total_scenes=total_scenes,
            total_shots=total_shots,
            total_duration_seconds=round(total_duration, 2),
            visual_status=visual_status,
            visual_bible_status=vb_status,
            entity_counts=entity_counts,
        )

    def load_visual_scenes_lightweight(self, dir_name: str) -> List[SceneSummary]:
        """
        Lightweight Scene list for Navigator.
        Does NOT include heavy veo_prompts or negative prompts, enabling sub-10ms loads
        and instant rendering even on 250-500+ shot projects.
        """
        project_dir = self.resolve_project_dir(dir_name)
        project_id = project_dir.name

        # Read veo_prompts to map shot IDs to scenes quickly
        scene_to_shots: Dict[str, List[str]] = {}
        veo_path = project_dir / "veo_prompts.json"
        if veo_path.is_file():
            try:
                veo_data = json.loads(veo_path.read_text(encoding="utf-8"))
                for sh in veo_data.get("shots", []):
                    parent_id = sh.get("parent_scene_id") or sh.get("parentSceneId") or sh.get("scene_id")
                    shot_id = str(sh.get("shot_id") or "")
                    if parent_id and shot_id:
                        scene_to_shots.setdefault(parent_id, []).append(shot_id)
            except Exception as e:
                logger.warning(f"Error parsing veo_prompts for lightweight scenes: {e}")

        summaries: List[SceneSummary] = []
        sp_path = project_dir / "scene_plan.json"
        if sp_path.is_file():
            try:
                sp_data = json.loads(sp_path.read_text(encoding="utf-8"))
                for idx, sc in enumerate(sp_data.get("scenes", [])):
                    sc_id = str(sc.get("scene_id") or f"sc_{sc.get('index', idx+1):02d}")
                    shots = scene_to_shots.get(sc_id, [f"{sc_id}_sh1"])
                    v_sum = sc.get("visual_summary", "")
                    summaries.append(
                        SceneSummary(
                            scene_id=sc_id,
                            index=int(sc.get("index") or idx + 1),
                            category=sc.get("category", "reconstruction"),
                            start=float(sc.get("start", 0.0)),
                            end=float(sc.get("end", 0.0)),
                            duration=float(sc.get("duration", 0.0)),
                            visual_summary=v_sum[:160] if v_sum else "",
                            shot_count=len(shots),
                            shot_ids=shots,
                            has_narration=bool(sc.get("narration")),
                            evidence_mode=sc.get("evidence_mode", "reconstruction"),
                        )
                    )
            except Exception as e:
                logger.warning(f"Error parsing scene_plan for lightweight scenes: {e}")

        return summaries

    def load_scene_detail(self, dir_name: str, scene_id: str) -> Scene:
        """
        Load complete detail of a single Scene with all its child Shots.
        Called on-demand when the user selects or edits a specific scene.
        """
        project_dir = self.resolve_project_dir(dir_name)

        # 1. Read target scene from scene_plan.json
        sp_path = project_dir / "scene_plan.json"
        found_sc: Optional[Dict[str, Any]] = None
        if sp_path.is_file():
            try:
                sp_data = json.loads(sp_path.read_text(encoding="utf-8"))
                for sc in sp_data.get("scenes", []):
                    if str(sc.get("scene_id")) == scene_id:
                        found_sc = sc
                        break
            except Exception as e:
                logger.warning(f"Failed to read scene_plan for {scene_id}: {e}")

        if not found_sc:
            raise KeyError(f"Scene '{scene_id}' not found in project '{dir_name}'")

        # 2. Read matching shots from veo_prompts.json
        matching_shots: List[Shot] = []
        veo_path = project_dir / "veo_prompts.json"
        if veo_path.is_file():
            try:
                veo_data = json.loads(veo_path.read_text(encoding="utf-8"))
                for sh in veo_data.get("shots", []):
                    parent_id = str(sh.get("parent_scene_id") or sh.get("parentSceneId") or sh.get("scene_id") or "")
                    if parent_id == scene_id:
                        matching_shots.append(
                            Shot(
                                shot_id=str(sh.get("shot_id") or f"{scene_id}_sh1"),
                                parent_scene_id=scene_id,
                                index=int(sh.get("index") or 1),
                                shot_type=sh.get("shot_type") or found_sc.get("shot_type", "medium wide"),
                                camera_motion=sh.get("camera_motion") or "static cinematic camera",
                                aspect_ratio=sh.get("aspect_ratio") or "16:9",
                                veo_prompt=sh.get("veo_prompt") or "",
                                negative_prompt=sh.get("negative_prompt") or "",
                                continuity_anchor=sh.get("continuity_anchor"),
                                subject_action=sh.get("subject_action"),
                                environmental_action=sh.get("environmental_action"),
                                lighting_atmosphere=sh.get("lighting_atmosphere"),
                                start=sh.get("start") or found_sc.get("start"),
                                end=sh.get("end") or found_sc.get("end"),
                                duration=sh.get("duration") or found_sc.get("duration"),
                            )
                        )
            except Exception as e:
                logger.warning(f"Failed to read veo_prompts for {scene_id}: {e}")

        if not matching_shots:
            matching_shots.append(
                Shot(
                    shot_id=f"{scene_id}_sh1",
                    parent_scene_id=scene_id,
                    index=1,
                    shot_type=found_sc.get("shot_type") or "medium wide",
                    camera_motion="static cinematic camera",
                    veo_prompt=found_sc.get("image_prompt") or found_sc.get("visual_summary") or "",
                    negative_prompt="",
                    start=found_sc.get("start", 0.0),
                    end=found_sc.get("end", 0.0),
                    duration=found_sc.get("duration", 0.0),
                )
            )

        return Scene(
            scene_id=scene_id,
            index=int(found_sc.get("index") or 1),
            category=found_sc.get("category", "reconstruction"),
            start=float(found_sc.get("start", 0.0)),
            end=float(found_sc.get("end", 0.0)),
            duration=float(found_sc.get("duration", 0.0)),
            visual_summary=found_sc.get("visual_summary", ""),
            narration=found_sc.get("narration", ""),
            image_prompt=found_sc.get("image_prompt", ""),
            evidence_mode=found_sc.get("evidence_mode", "reconstruction"),
            shot_type=found_sc.get("shot_type", "medium wide"),
            shots=matching_shots,
        )

    def load_shot_detail(self, dir_name: str, shot_id: str) -> Shot:
        """
        Load complete detail of a single Shot card directly.
        Called on-demand when user clicks into a shot for inspection or prompt editing.
        """
        project_dir = self.resolve_project_dir(dir_name)
        veo_path = project_dir / "veo_prompts.json"
        if veo_path.is_file():
            try:
                veo_data = json.loads(veo_path.read_text(encoding="utf-8"))
                for sh in veo_data.get("shots", []):
                    cur_id = str(sh.get("shot_id") or "")
                    if cur_id == shot_id:
                        parent_id = str(sh.get("parent_scene_id") or sh.get("parentSceneId") or sh.get("scene_id") or "")
                        return Shot(
                            shot_id=cur_id,
                            parent_scene_id=parent_id,
                            index=int(sh.get("index") or 1),
                            shot_type=sh.get("shot_type") or "medium wide",
                            camera_motion=sh.get("camera_motion") or "static cinematic camera",
                            aspect_ratio=sh.get("aspect_ratio") or "16:9",
                            veo_prompt=sh.get("veo_prompt") or "",
                            negative_prompt=sh.get("negative_prompt") or "",
                            continuity_anchor=sh.get("continuity_anchor"),
                            subject_action=sh.get("subject_action"),
                            environmental_action=sh.get("environmental_action"),
                            lighting_atmosphere=sh.get("lighting_atmosphere"),
                            start=sh.get("start"),
                            end=sh.get("end"),
                            duration=sh.get("duration"),
                        )
            except Exception as e:
                logger.warning(f"Failed to read veo_prompts for shot {shot_id}: {e}")

        raise KeyError(f"Shot '{shot_id}' not found in project '{dir_name}'")

    def load_visual_bible_slice(self, dir_name: str) -> VisualBibleSlice:
        """
        Load Visual Bible entities slice independently.
        """
        project_dir = self.resolve_project_dir(dir_name)
        project_id = project_dir.name

        visual_bible: Dict[str, Any] = {}
        vb_path = project_dir / "visual_bible.json"
        if vb_path.is_file():
            try:
                visual_bible = json.loads(vb_path.read_text(encoding="utf-8"))
            except Exception as e:
                logger.warning(f"Failed to read visual_bible.json for {project_id}: {e}")

        chars = len(visual_bible.get("characters", []))
        envs = len(visual_bible.get("environments", []))
        objs = len(visual_bible.get("objects", []))
        status = "READY" if (chars or envs or objs) else "EMPTY"

        return VisualBibleSlice(
            project_id=project_id,
            schema_version="2.0.0",
            visual_bible=visual_bible,
            characters_count=chars,
            environments_count=envs,
            objects_count=objs,
            status=status,
        )

    def load_visual_slice(self, dir_name: str) -> VisualSlice:
        """
        Aggregate loader for Visual Workbench (diagnostics / internal inspect).
        """
        state = self.load_project_v2(dir_name)
        total_shots = sum(len(sc.shots) for sc in state.scenes)
        visual_status = "READY" if state.scenes else "EMPTY"

        return VisualSlice(
            project_id=state.project_id,
            schema_version=state.schema_version,
            scenes=state.scenes,
            total_scenes=len(state.scenes),
            total_shots=total_shots,
            visual_bible=state.visual_bible,
            visual_status=visual_status,
        )

    def load_overview_slice(self, dir_name: str) -> OverviewSlice:
        """
        Ultra-fast selective loader for Project Shell & Overview.
        Provides summary stats and workbench readiness statuses with minimal disk I/O.
        """
        project_dir = self.resolve_project_dir(dir_name)
        project_id = project_dir.name

        settings: Dict[str, Any] = {}
        settings_path = project_dir / "settings.json"
        if settings_path.is_file():
            try:
                settings = json.loads(settings_path.read_text(encoding="utf-8"))
            except Exception:
                pass

        # Check key files existence
        script_exists = (project_dir / "script.txt").is_file()
        audio_exists = (project_dir / "narration.wav").is_file() or (project_dir / "audio.wav").is_file()
        manifest_exists = (project_dir / "manifest.json").is_file()
        scene_plan_exists = (project_dir / "scene_plan.json").is_file()

        # Count scenes and shots quickly if files exist
        scene_count = 0
        if scene_plan_exists:
            try:
                sp_data = json.loads((project_dir / "scene_plan.json").read_text(encoding="utf-8"))
                scene_count = len(sp_data.get("scenes", []))
            except Exception:
                pass

        shot_count = 0
        veo_path = project_dir / "veo_prompts.json"
        if veo_path.is_file():
            try:
                veo_data = json.loads(veo_path.read_text(encoding="utf-8"))
                shot_count = len(veo_data.get("shots", []))
            except Exception:
                pass

        duration_seconds = settings.get("duration_seconds")
        if duration_seconds is None:
            ts_path = project_dir / "timestamps.json"
            if ts_path.is_file():
                try:
                    ts_data = json.loads(ts_path.read_text(encoding="utf-8"))
                    duration_seconds = ts_data.get("audio_duration")
                except Exception:
                    pass

        # Status summary
        status_summary = {
            "story": "READY" if script_exists else "DRAFT",
            "voice": "READY" if (audio_exists or manifest_exists) else "DRAFT",
            "visual": "READY" if (scene_plan_exists and scene_count > 0) else "DRAFT",
            "export": "READY" if (project_dir / "export").is_dir() or (project_dir / "final_render.mp4").is_file() else "DRAFT",
        }

        stats = {
            "scene_count": scene_count,
            "shot_count": shot_count,
            "duration_seconds": duration_seconds,
            "has_script": script_exists,
            "has_audio": audio_exists,
            "voice_configured": settings.get("voice", "af_sarah"),
        }

        return OverviewSlice(
            project_id=project_id,
            schema_version="2.0.0",
            title=settings.get("project_name") or project_id,
            status_summary=status_summary,
            stats=stats,
        )


project_adapter = ProjectAdapter()
