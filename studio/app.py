"""
UnfoldIQ TTS Studio — FastAPI Application
Provides REST and Server-Sent Events (SSE) endpoints, pronunciation dictionary management, and serves the Web UI.
"""

import asyncio
import hashlib
import json
import logging
import os
import shutil
import tempfile
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, Optional, List

from fastapi import FastAPI, HTTPException, BackgroundTasks, Request, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from studio.config import config, PROJECTS_DIR, BASE_DIR, TEMP_DIR
from studio.audio_service import (
    KokoroClient,
    stitch_wav_files,
    convert_wav_to_mp3,
    probe_audio
)
from studio.text_chunker import (
    build_and_verify_manifest,
    TextIntegrityError
)
from studio.smart_render import (
    DEFAULT_RENDER_MODE,
    RENDER_MODES,
    RENDER_PROFILES,
    RenderCache,
    RenderJobState,
    plan_render,
    render_chunk_with_retry,
    replace_file_atomically,
)
from studio.project_manager import (
    create_project_directory,
    cleanup_temp_job_dir,
    save_project_metadata,
    export_to_outputs,
    list_projects,
    delete_project
)
from studio.pronunciation_service import PronunciationDictionary
from studio.scene_planner import scene_planner, ScenePlanValidationError
from studio.narration_director import (
    NARRATION_MODES,
    DEFAULT_PROFILE,
    KNOWN_PROFILES,
    analyze_script as nd_analyze,
    validate_plan as nd_validate,
    save_plan as nd_save,
    load_plan as nd_load,
    plan_status as nd_status,
    update_beat as nd_update_beat,
    narration_synth_hash as nd_synth_hash,
    compile_for_chunks as nd_compile,
    assemble_master as nd_assemble,
    segment_script as nd_segment,
    beat_stats as nd_stats,
)
from studio.veo_prompt_generator import veo_generator, VeoPromptGenerator, VeoPlanValidationError
from studio.voice_qa import (
    voice_qa_manager,
    VoiceQAEvaluator,
    compute_file_sha256,
)
from studio.visual_continuity import visual_continuity_director
from studio.production_export import (
    ProductionExportError,
    execute_export as production_execute_export,
    production_status as production_get_status,
    validate_project_id as production_validate_project_id,
)
from studio.phase14_router import router as phase14_router
from studio.phase15a_router import router as phase15a_router
from studio.jobs_manager import jobs_manager
from studio.graceful_shutdown import graceful_shutdown_manager


# Setup logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("unfoldiq.studio")

app = FastAPI(
    title="UnfoldIQ TTS Studio",
    version="3.0.0",
    description="Local Windows TTS Studio for Kokoro-FastAPI with Pronunciation Dictionary"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(phase14_router)
app.include_router(phase15a_router)

@app.on_event("startup")
async def startup_event():
    """Startup self-check and crash recovery for interrupted persistent jobs."""
    recovered = jobs_manager.recover_crashed_jobs()
    if recovered > 0:
        logger.info(f"Phase 15A Startup: Recovered {recovered} interrupted jobs.")

from studio.providers import KokoroTTSProvider, WhisperSTTProvider, TTSProvider, STTProvider

tts_provider: TTSProvider = KokoroTTSProvider()
stt_provider: STTProvider = WhisperSTTProvider()
kokoro_client = getattr(tts_provider, "client", KokoroClient())
pron_dict = PronunciationDictionary(BASE_DIR / "config" / "pronunciation_dictionary.json")
USER_SETTINGS_PATH = BASE_DIR / "config" / "user_settings.json"

# In-memory active job tracker
active_jobs: Dict[str, Dict[str, Any]] = {}
job_cancel_events: Dict[str, asyncio.Event] = {}
active_project_dirs: set = set()
active_qa_jobs: Dict[str, Dict[str, Any]] = {}


def _is_project_busy(dir_name: str) -> bool:
    """Check if project has active TTS, transcription, scene, veo, or voice QA generation."""
    if not dir_name:
        return False
    if dir_name in active_project_dirs:
        return True
    for j in active_jobs.values():
        if j.get("state") in ("preparing", "generating"):
            if j.get("project_name") == dir_name or j.get("directory_name") == dir_name:
                return True
    qa_job = active_qa_jobs.get(dir_name)
    if qa_job and qa_job.get("status") == "running":
        return True
    try:
        ts_job = stt_provider.get_job(dir_name)
        if ts_job and ts_job.get("status") in ("queued", "running"):
            return True
    except Exception:
        pass
    return False


class JobRequest(BaseModel):
    script: Optional[str] = Field(default=None, description="Narration text")
    text: Optional[str] = Field(default=None, description="Alias for narration text")
    project_name: str = Field(default="unfoldiq_project", description="Project slug/name")
    voice: str = Field(default="af_heart", description="Kokoro voice identifier")
    speed: float = Field(default=1.0, ge=0.5, le=2.0, description="Speech rate multiplier")
    language: str = Field(default="American English", description="Narration language")
    output_formats: Optional[List[str]] = Field(default=None, description="Output formats e.g. ['wav', 'mp3']")
    export_mp3: bool = Field(default=True, description="Also generate MP3")
    render_mode: str = Field(default=DEFAULT_RENDER_MODE, description="Smart Render profile: eco|balanced|fast")
    narration_mode: str = Field(default="auto", description="Narration Director mode: auto|custom|off")
    narration_profile: str = Field(default=DEFAULT_PROFILE, description="Narration profile")
    narration_mode: str = Field(default="auto", description="Narration Director mode: auto|custom|off")


class PronunciationCreateRequest(BaseModel):
    original: str = Field(..., description="Original phrase to match")
    spoken_form: str = Field(..., description="Spoken pronunciation form")
    enabled: bool = Field(default=True, description="Whether entry is active")


class PronunciationUpdateRequest(BaseModel):
    original: Optional[str] = None
    spoken_form: Optional[str] = None
    enabled: Optional[bool] = None


class PronunciationPreviewRequest(BaseModel):
    text: str = Field(..., description="Sample text to test transformations on")


class PronunciationTestAudioRequest(BaseModel):
    text: str = Field(..., description="Word or phrase to speak")
    voice: Optional[str] = Field(default=None, description="Voice identifier")
    speed: Optional[float] = Field(default=1.0, ge=0.5, le=2.0, description="Speed")


class UserSettingsRequest(BaseModel):
    selected_language: Optional[str] = None
    selected_voice: Optional[str] = None
    speed: Optional[float] = None
    preferred_format: Optional[str] = None
    render_mode: Optional[str] = None
    narration_mode: Optional[str] = None
    narration_profile: Optional[str] = None


class SceneGenerateRequest(BaseModel):
    force: bool = Field(default=False, description="Force regeneration even if previous edits exist")
    target_duration: Optional[float] = Field(default=None, ge=2.0, le=30.0, description="Target duration in seconds")
    min_duration: Optional[float] = Field(default=None, ge=1.0, le=15.0, description="Minimum duration in seconds")
    max_duration: Optional[float] = Field(default=None, ge=3.0, le=60.0, description="Maximum duration in seconds")


class SceneUpdateRequest(BaseModel):
    visual_summary: Optional[str] = None
    category: Optional[str] = None
    evidence_mode: Optional[str] = None
    shot_type: Optional[str] = None
    camera_motion: Optional[str] = None
    continuity_group: Optional[str] = None
    image_prompt: Optional[str] = None
    negative_prompt: Optional[str] = None
    # Phase 13: canonical visual references
    visualType: Optional[str] = None
    subjectIds: Optional[List[str]] = None
    characterIds: Optional[List[str]] = None
    environmentId: Optional[str] = None
    objectIds: Optional[List[str]] = None
    composition: Optional[str] = None
    narrativePurpose: Optional[str] = None
    recommendedOutputType: Optional[str] = None
    selectedOutputType: Optional[str] = None
    historicalConstraints: Optional[List[str]] = None
    scientificConstraints: Optional[List[str]] = None
    visualStatus: Optional[str] = None
    notes: Optional[str] = None


class CastCreateRequest(BaseModel):
    name: Optional[str] = Field(default=None)


class CastMergeRequest(BaseModel):
    character_id: str = Field(...)
    bind_scenes: bool = Field(default=False)


class EditorialLockRequest(BaseModel):
    span_type: str = Field(..., description="PROPER_NOUN|NUMBER|DATE|SPECIES|PLACE|EVIDENCE_ANCHOR|CAVEAT")
    startOffset: int = Field(..., ge=0)
    endOffset: int = Field(..., ge=1)


class VisualEntityCreateRequest(BaseModel):
    kind: str = Field(..., description="character|environment|object")
    data: Dict[str, Any] = Field(...)


class VisualEntityUpdateRequest(BaseModel):
    kind: str = Field(..., description="character|environment|object")
    entity_id: str = Field(...)
    updates: Dict[str, Any] = Field(...)


class VisualStyleUpdateRequest(BaseModel):
    style: Dict[str, Any] = Field(...)


class VisualPresetApplyRequest(BaseModel):
    preset_id: str = Field(...)


class VisualPromptsGenerateRequest(BaseModel):
    scene_ids: Optional[List[str]] = Field(default=None)


class DependencyImpactRequest(BaseModel):
    kind: str = Field(..., description="character|environment|object|style|scene|visualType|selectedOutput|referenceAsset")
    id: Optional[str] = Field(default=None)
    sceneId: Optional[str] = Field(default=None)
    entityType: Optional[str] = Field(default=None)
    entityId: Optional[str] = Field(default=None)
    assetId: Optional[str] = Field(default=None)


class VeoGenerateRequest(BaseModel):
    force: bool = Field(default=False, description="Force regeneration even if previous edits exist")
    target_duration: Optional[float] = Field(default=None, ge=2.0, le=20.0, description="Target shot duration in seconds")
    preferred_max_duration: Optional[float] = Field(default=None, ge=3.0, le=30.0, description="Preferred max shot duration")
    min_duration: Optional[float] = Field(default=None, ge=1.0, le=15.0, description="Minimum shot duration in seconds")
    aspect_ratio: Optional[str] = Field(default=None, description="Aspect ratio e.g. 16:9 or 9:16")


class VeoShotUpdateRequest(BaseModel):
    shot_type: Optional[str] = None
    camera_motion: Optional[str] = None
    camera_framing: Optional[str] = None
    subject_action: Optional[str] = None
    environmental_action: Optional[str] = None
    lighting_atmosphere: Optional[str] = None
    continuity_anchor: Optional[str] = None
    veo_prompt: Optional[str] = None
    negative_prompt: Optional[str] = None
    aspect_ratio: Optional[str] = None


class VoiceQARunRequest(BaseModel):
    force_transcribe: bool = Field(default=False, description="Ignore cache and re-run Whisper ASR")


class VoiceQADecisionRequest(BaseModel):
    note: Optional[str] = Field(default=None, description="Optional note for human decision")


class VisualBibleEntityUpdateRequest(BaseModel):
    entity_type: str = Field(..., description="Type of entity: subject, environment, period, prop, continuityGroup")
    entity_id: str = Field(..., description="Canonical ID of the entity")
    updates: Dict[str, Any] = Field(..., description="Fields to update on the entity")


class TimestampGenerateRequest(BaseModel):
    force: bool = Field(default=False, description="Force timestamp generation even if Voice QA is FAIL")



def _seed_cache_from_siblings(
    cache: RenderCache,
    plan_hashes: List[str],
    exclude_dir: Path,
) -> Dict[str, str]:
    """Reuse validated chunks from the newest same-workspace sibling caches.

    Each Generate click creates a fresh timestamped project dir, so reuse
    across runs works by importing content-addressed chunks (validated on
    read) from previous project dirs. Returns {render_hash: render_hash}
    for imported hits.
    """
    imported: Dict[str, str] = {}
    try:
        siblings = sorted(
            (p for p in PROJECTS_DIR.iterdir()
             if p.is_dir() and p.resolve() != exclude_dir.resolve()),
            key=lambda p: p.name,
            reverse=True,
        )
    except Exception:
        return imported
    for h in plan_hashes:
        if cache.lookup(h) is not None:
            imported[h] = h
            continue
        for sib in siblings:
            sib_cache = RenderCache(sib)
            src = sib_cache.lookup(h)
            if src is not None:
                try:
                    cache.store(h, src)
                    imported[h] = h
                except Exception as e:
                    logger.warning(f"Cache seed failed for {h[:12]} from {sib.name}: {e}")
                break
    return imported


def _adopt_compatible_narration_plan(req: JobRequest, synthesis_text: str,
                                     narr_mode: str, narr_profile: str
                                     ) -> Optional[Dict[str, Any]]:
    """Reuse a sibling project's valid narration plan (preserves manual edits).

    Sibling = newest project dir sharing the request slug. Adopted only when
    the stored plan matches the current synthesis hash, analyzer version and
    profile, and revalidates cleanly (no ERROR). Returns None otherwise.
    """
    from studio.project_manager import sanitize_project_name
    from studio.narration_director import (
        script_content_hash as _nd_script_hash,
        ANALYZER_VERSION as _ND_ANALYZER_VERSION,
    )
    try:
        slug = sanitize_project_name(req.project_name or "unfoldiq_project")
        want_hash = _nd_script_hash(synthesis_text)
        candidates = sorted(
            (p for p in PROJECTS_DIR.iterdir()
             if p.is_dir() and p.name.endswith("_" + slug)),
            key=lambda p: p.name, reverse=True,
        )
        for sib in candidates:
            plan = nd_load(sib)
            if not plan or plan.get("profile") != narr_profile:
                continue
            if plan.get("sourceScriptHash") != want_hash:
                continue
            if plan.get("analyzerVersion") != _ND_ANALYZER_VERSION:
                continue
            res = nd_validate(plan, synthesis_text)
            if res["status"] == "ERROR":
                continue
            adopted = json.loads(json.dumps(plan))
            adopted["mode"] = narr_mode
            adopted["status"] = res["status"]
            logger.info(f"Adopted compatible narration plan from sibling {sib.name}")
            return adopted
    except Exception as e:
        logger.warning(f"Narration sibling adoption failed (non-fatal): {e}")
    return None


async def _run_tts_job(job_id: str, req: JobRequest):
    """Background task: Smart Render Engine (Phase 7) behind Generate Audio.

    Same external contract as the legacy pipeline (job states, settings.json /
    manifest.json schema, verbatim script.txt, audio.wav/.mp3 outputs), but
    chunk synthesis goes through content-addressed cache + bounded retry +
    ordered stitch + atomic replacement.
    """
    job = active_jobs[job_id]
    cancel_event = job_cancel_events[job_id]
    start_time = time.time()

    render_mode = (req.render_mode or DEFAULT_RENDER_MODE).lower()
    if render_mode not in RENDER_MODES:
        render_mode = DEFAULT_RENDER_MODE
    profile = RENDER_PROFILES[render_mode]
    concurrency = max(1, int(profile.get("concurrency", 1)))

    project_dir: Optional[Path] = None

    try:
        # Step 1: Health check
        job["state"] = "preparing"
        job["render_mode"] = render_mode
        health = await tts_provider.check_health()
        if not health.get("healthy"):
            job["state"] = "failed"
            job["error_message"] = "Kokoro TTS service is not available."
            logger.error(f"Job {job_id} failed: Kokoro offline. {health.get('error')}")
            return

        # Step 2: Pronunciation Dictionary Preprocessing (unchanged behavior)
        pron_dict.load()
        synthesis_text, applied_overrides = pron_dict.preprocess(req.script)
        synthesis_hash = hashlib.sha256(synthesis_text.encode("utf-8")).hexdigest()

        # Step 2b: Narration Director (Phase 9, hidden).
        # Auto/Custom: adopt a compatible sibling plan (preserves manual edits)
        # or analyze fresh (deterministic). Off: bypass with a distinct hash.
        # script.txt is never rewritten — narration produces metadata only.
        narr_mode = str(getattr(req, "narration_mode", "auto") or "auto").lower()
        if narr_mode not in NARRATION_MODES:
            narr_mode = "auto"
        narr_profile = str(getattr(req, "narration_profile", "") or "").strip()
        if narr_profile not in KNOWN_PROFILES:
            narr_profile = DEFAULT_PROFILE
        narr_plan = None
        narr_directives: Dict[int, Dict[str, Any]] = {}
        narr_hash = nd_synth_hash(None)
        job["narration_mode"] = narr_mode
        job["narration_warning"] = ""
        if narr_mode in ("auto", "custom"):
            try:
                narr_plan = _adopt_compatible_narration_plan(
                    req, synthesis_text, narr_mode, narr_profile)
                if narr_plan is None:
                    cand = nd_analyze(synthesis_text, profile=narr_profile, mode=narr_mode)
                    res = nd_validate(cand, synthesis_text)
                    if res["status"] == "ERROR":
                        raise ValueError("; ".join(res["issues"][:3]))
                    cand["status"] = res["status"]
                    cand["mode"] = narr_mode
                    narr_plan = cand
                else:
                    narr_plan["mode"] = narr_mode
                narr_hash = nd_synth_hash(narr_plan)
                sentences = nd_segment(synthesis_text)
                # chunk texts come from the same deterministic chunker Smart
                # Render uses (no I/O, no side effects)
                pre_manifest = build_and_verify_manifest(
                    synthesis_text,
                    target_chars=config.chunk_target_chars,
                    max_chars=config.chunk_max_chars,
                )
                chunk_texts = [c["text"] for c in pre_manifest["chunks"]]
                narr_directives = nd_compile(chunk_texts, sentences, narr_plan)
            except TextIntegrityError:
                raise
            except Exception as e:
                logger.warning(f"Job {job_id} narration unavailable, falling back to Off: {e}")
                narr_plan = None
                narr_hash = nd_synth_hash(None)
                narr_directives = {}
                job["narration_warning"] = (
                    "Narration analysis unavailable; rendered with plain narration.")
            job["narration_beats"] = len(narr_plan["beats"]) if narr_plan else 0

        # Step 3: Deterministic render plan (Phase 2 chunking guarantees kept)
        try:
            plan = plan_render(
                synthesis_text,
                voice=req.voice,
                speed=req.speed,
                applied_overrides=applied_overrides,
                target_chars=config.chunk_target_chars,
                max_chars=config.chunk_max_chars,
                pron_preprocess=pron_dict.preprocess,
                narration={"directives": narr_directives,
                           "narration_hash": narr_hash},
            )
        except TextIntegrityError as tie:
            job["state"] = "failed"
            job["error_message"] = f"Text integrity check failed: {tie}"
            logger.error(f"Job {job_id} text integrity failed: {tie}")
            return

        # Legacy-compatible manifest for downstream phases (timestamps/scenes).
        manifest = build_and_verify_manifest(
            synthesis_text,
            target_chars=config.chunk_target_chars,
            max_chars=config.chunk_max_chars,
        )
        manifest["source_character_count"] = len(req.script)
        manifest["synthesis_character_count"] = len(synthesis_text)
        manifest["pronunciation_dictionary_applied"] = bool(applied_overrides)
        manifest["pronunciation_overrides"] = applied_overrides
        manifest["synthesis_text_hash"] = synthesis_hash
        if narr_plan is not None:
            manifest["narration"] = {
                "mode": narr_plan.get("mode"),
                "profile": narr_plan.get("profile"),
                "beats": len(narr_plan.get("beats", [])),
                "status": narr_plan.get("status"),
                "sourceNarrationPlanHash": narr_hash,
            }

        job["total_chunks"] = plan.total_chunks
        job["manifest"] = manifest
        job["reused_chunks"] = 0
        job["rendered_chunks"] = 0
        job["retries"] = 0

        # Step 4: Create project directory + project-scoped cache/state
        project_dir = create_project_directory(req.project_name)
        job["project_dir"] = str(project_dir)
        job["project_name"] = project_dir.name

        # Phase 9: persist the narration plan inside the new project.
        if narr_plan is not None:
            try:
                nd_save(project_dir, narr_plan)
            except Exception as e:
                logger.warning(f"Job {job_id} narration plan save failed (non-fatal): {e}")

        cache = RenderCache(project_dir)
        job_state = RenderJobState(project_dir)
        state = job_state.new(job_id, plan.fingerprint, plan.total_chunks)

        # Step 5: Cache seeding = resume across runs/restarts.
        # Previously completed chunks are trusted only after per-chunk
        # hash + WAV validation inside lookup()/store().
        _seed_cache_from_siblings(
            cache, plan.hashes_in_order, exclude_dir=project_dir
        )

        # Step 6: Render missing chunks (bounded concurrency, one Kokoro service)
        job["state"] = "generating"
        semaphore = asyncio.Semaphore(concurrency)
        completed: Dict[str, str] = {}  # chunk_id -> render_hash
        failed: Dict[str, str] = {}
        lock = asyncio.Lock()

        # Count cache hits first so progress is truthful from the start.
        to_render: List[Any] = []
        for chunk in plan.chunks:
            hit = cache.lookup(chunk.render_hash)
            if hit is not None:
                completed[chunk.chunk_id] = chunk.render_hash
                job_state.mark_completed(state, chunk.chunk_id, chunk.render_hash, reused=True)
            else:
                to_render.append(chunk)
        job["reused_chunks"] = sum(1 for _ in completed)
        job["completed_chunks"] = len(completed)

        async def _render_one(chunk: Any) -> None:
            if cancel_event.is_set():
                return
            tmp_path = cache.chunks_dir / f".tmp_{chunk.chunk_id}_{chunk.render_hash[:12]}.wav"

            async def synth_fn(text: str, out: Path) -> None:
                # Phase 9: per-chunk narration rate (clamped to Kokoro-safe bounds).
                eff_speed = min(2.0, max(0.5, float(req.speed) * float(chunk.rate_factor)))
                await tts_provider.synthesize_chunk(
                    text=text,
                    voice=req.voice,
                    speed=eff_speed,
                    output_path=out,
                    cancel_event=cancel_event,
                )

            async with semaphore:
                if cancel_event.is_set():
                    return
                async with lock:
                    job["current_chunk"] = chunk.index
                    short = chunk.text[:80] + "..." if len(chunk.text) > 80 else chunk.text
                    job["current_chunk_text"] = short
                try:
                    res = await render_chunk_with_retry(
                        synth_fn, chunk.text, tmp_path,
                        cancel_check=cancel_event.is_set,
                    )
                except asyncio.CancelledError:
                    raise
                except Exception as e:  # defensive: retry helper already bounds failures
                    res = {"ok": False, "retries": 0, "error": str(e)}
                finally:
                    try:
                        if tmp_path.exists() and chunk.chunk_id not in completed:
                            pass  # tmp cleaned below on success path; leftovers pruned
                    except Exception:
                        pass
                async with lock:
                    job["retries"] = int(job.get("retries", 0)) + int(res.get("retries", 0))
                    if res.get("ok"):
                        try:
                            cache.store(chunk.render_hash, tmp_path, chunk.chunk_id)
                        finally:
                            try:
                                if tmp_path.exists():
                                    tmp_path.unlink()
                            except Exception:
                                pass
                        completed[chunk.chunk_id] = chunk.render_hash
                        job_state.mark_completed(
                            state, chunk.chunk_id, chunk.render_hash,
                            reused=False, retries=int(res.get("retries", 0)),
                        )
                        job["rendered_chunks"] = int(job.get("rendered_chunks", 0)) + 1
                    else:
                        failed[chunk.chunk_id] = res.get("error", "unknown error")
                        job_state.mark_failed(
                            state, chunk.chunk_id,
                            res.get("error", "unknown error"),
                            int(res.get("retries", 0)),
                        )
                    job["completed_chunks"] = len(completed)
                    done = len(completed) + len(failed)
                    job["progress_percent"] = int((done / max(1, plan.total_chunks)) * 85)
                    job["elapsed_seconds"] = round(time.time() - start_time, 1)

        try:
            await asyncio.gather(*(_render_one(c) for c in to_render))
        except asyncio.CancelledError:
            pass

        if cancel_event.is_set():
            job["state"] = "cancelled"
            job["elapsed_seconds"] = round(time.time() - start_time, 1)
            job_state.mark_status(state, "cancelled")
            # Preserve completed valid chunks + resumable state; no master audio.
            settings = {
                "project_name": req.project_name,
                "directory_name": project_dir.name,
                "voice": req.voice,
                "speed": req.speed,
                "language": req.language,
                "status": "cancelled",
                "character_count": len(req.script),
                "source_character_count": len(req.script),
                "synthesis_character_count": len(synthesis_text),
                "pronunciation_dictionary_applied": bool(applied_overrides),
                "pronunciation_overrides": applied_overrides,
                "chunk_count": plan.total_chunks,
                "completed_chunks": len(completed),
                "render_engine_version": 1,
                "render_mode": render_mode,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "elapsed_seconds": job["elapsed_seconds"],
            }
            save_project_metadata(project_dir, req.script, settings, manifest)
            return

        if failed:
            job["state"] = "failed"
            job["elapsed_seconds"] = round(time.time() - start_time, 1)
            first_id = sorted(failed.keys())[0]
            job["error_message"] = (
                f"Render failed for {len(failed)}/{plan.total_chunks} chunk(s) "
                f"after bounded retry (e.g. chunk {first_id}: {failed[first_id]}). "
                f"Completed chunks are preserved — retry generation to resume."
            )
            job_state.mark_status(state, "failed")
            # Old valid audio.wav (if any) untouched: we never wrote outputs.
            logger.error(f"Job {job_id} failed chunks: {sorted(failed.keys())}")
            return

        # Step 7: Ordered stitch (exact script order) + atomic replacement
        job["state"] = "stitching"
        job["progress_percent"] = 90
        job["elapsed_seconds"] = round(time.time() - start_time, 1)

        ordered = sorted(plan.chunks, key=lambda c: c.index)
        # Phase 9: master track = chunk audio + planned silence (pauses).
        # Pause-free legacy path produces an identical track to stitch_wav_files.
        track = []
        for chunk in ordered:
            p = cache.lookup(chunk.render_hash)
            if p is None:
                raise RuntimeError(
                    f"Chunk {chunk.chunk_id} missing from cache at stitch time."
                )
            if float(chunk.pause_before) > 0.01:
                track.append(("silence", round(float(chunk.pause_before), 2)))
            track.append(("wav", p))
            if float(chunk.pause_after) > 0.01:
                track.append(("silence", round(float(chunk.pause_after), 2)))

        master_tmp = project_dir / ".audio_new.wav"  # valid ext required by encoder
        try:
            if master_tmp.exists():
                master_tmp.unlink()
        except Exception:
            pass
        duration_s = nd_assemble(track, master_tmp)
        master_wav_path = project_dir / "audio.wav"
        replace_file_atomically(master_tmp, master_wav_path)
        job["final_duration_seconds"] = round(duration_s, 2)

        # Step 8: Optional MP3 conversion (atomic replacement as well)
        if req.export_mp3:
            job["progress_percent"] = 95
            master_mp3_tmp = project_dir / ".audio_new.mp3"  # valid ext required by ffmpeg
            try:
                if master_mp3_tmp.exists():
                    master_mp3_tmp.unlink()
            except Exception:
                pass
            convert_wav_to_mp3(master_wav_path, master_mp3_tmp)
            replace_file_atomically(master_mp3_tmp, project_dir / "audio.mp3")

        # Step 9: Save metadata, prune orphan cache entries, cleanup legacy temp
        settings = {
            "project_name": req.project_name,
            "directory_name": project_dir.name,
            "voice": req.voice,
            "speed": req.speed,
            "language": req.language,
            "status": "completed",
            "character_count": len(req.script),
            "source_character_count": len(req.script),
            "synthesis_character_count": len(synthesis_text),
            "word_count": manifest["total_words"],
            "chunk_count": plan.total_chunks,
            "pronunciation_dictionary_applied": bool(applied_overrides),
            "pronunciation_overrides": applied_overrides,
            "duration_seconds": job["final_duration_seconds"],
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "elapsed_seconds": round(time.time() - start_time, 1),
            "kokoro_base_url": config.kokoro_base_url,
            "has_wav": True,
            "has_mp3": req.export_mp3,
            "render_engine_version": 1,
            "render_mode": render_mode,
            "cache_hits": int(job.get("reused_chunks", 0)),
            "rendered_chunks": int(job.get("rendered_chunks", 0)),
            "retries": int(job.get("retries", 0)),
            "narration_mode": narr_mode,
            "narration_profile": narr_profile,
            "sourceNarrationPlanHash": narr_hash,
            "narration_beats": int(job.get("narration_beats", 0)),
            "narration_warning": job.get("narration_warning", ""),
        }
        save_project_metadata(project_dir, req.script, settings, manifest)
        try:
            cache.prune_orphans(plan.hashes_in_order)
        except Exception as e:
            logger.warning(f"Job {job_id} orphan prune failed (non-fatal): {e}")
        job_state.mark_status(state, "completed")
        cleanup_temp_job_dir(job_id)

        job["state"] = "completed"
        job["progress_percent"] = 100
        job["elapsed_seconds"] = round(time.time() - start_time, 1)
        job["audio_url"] = f"/api/projects/{project_dir.name}/audio/wav"
        logger.info(f"Job {job_id} successfully completed in {job['elapsed_seconds']}s (Audio: {job['final_duration_seconds']}s)")

        # Trigger Voice QA in background (Section 35)
        try:
            asyncio.create_task(_run_voice_qa_pipeline(project_dir.name))
        except Exception as ex:
            logger.warning(f"Voice QA auto-trigger failed for {project_dir.name}: {ex}")

    except asyncio.CancelledError:
        job["state"] = "cancelled"
        job["elapsed_seconds"] = round(time.time() - start_time, 1)
        logger.info(f"Job {job_id} cancellation acknowledged.")
    except Exception as e:
        job["state"] = "failed"
        job["error_message"] = str(e)
        job["elapsed_seconds"] = round(time.time() - start_time, 1)
        logger.exception(f"Job {job_id} failed with error: {e}")


@app.get("/health")
@app.get("/api/health")
async def health_check():
    """Health check for UnfoldIQ Studio and upstream Kokoro service."""
    kokoro_health = await tts_provider.check_health()
    return {
        "status": "healthy",
        "studio": "UnfoldIQ TTS Studio v3.0",
        "kokoro": kokoro_health,
        "config": {
            "kokoro_base_url": config.kokoro_base_url,
            "chunk_target_chars": config.chunk_target_chars,
            "chunk_max_chars": config.chunk_max_chars,
            "default_voice": config.default_voice,
        }
    }


@app.get("/api/voices")
async def get_voices():
    """Fetch enriched list of voices."""
    voices = await tts_provider.get_available_voices()
    return {"voices": voices}


def _is_tts_active() -> bool:
    for j in active_jobs.values():
        if j.get("state") in ("preparing", "generating"):
            return True
    return False


@app.post("/api/jobs")
@app.post("/api/generate")
async def start_job(req: JobRequest, background_tasks: BackgroundTasks):
    """Start a new TTS generation job."""
    content = (req.script or req.text or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="Script cannot be empty.")
    req.script = content
    if req.output_formats is not None:
        req.export_mp3 = ("mp3" in req.output_formats)

    if stt_provider.is_gpu_busy():
        raise HTTPException(
            status_code=409,
            detail="GPU is currently busy with transcription. Please wait or cancel transcription before starting TTS."
        )

    job_id = f"job_{uuid.uuid4().hex[:12]}"
    word_count = len(req.script.split())
    estimated_duration_s = round((word_count / 150.0) * 60.0 / req.speed, 1)

    active_jobs[job_id] = {
        "job_id": job_id,
        "state": "idle",
        "progress_percent": 0,
        "current_chunk": 0,
        "total_chunks": 0,
        "completed_chunks": 0,
        "reused_chunks": 0,
        "rendered_chunks": 0,
        "retries": 0,
        "render_mode": (req.render_mode or DEFAULT_RENDER_MODE).lower(),
        "current_chunk_text": "",
        "character_count": len(req.script),
        "word_count": word_count,
        "estimated_duration_seconds": estimated_duration_s,
        "elapsed_seconds": 0.0,
        "final_duration_seconds": 0.0,
        "error_message": "",
        "project_dir": "",
        "project_name": "",
        "audio_url": "",
    }
    job_cancel_events[job_id] = asyncio.Event()

    background_tasks.add_task(_run_tts_job, job_id, req)

    return {
        "job_id": job_id,
        "state": "preparing",
        "estimated_duration_seconds": estimated_duration_s,
    }


@app.get("/api/jobs/{job_id}")
async def get_job_status(job_id: str):
    """Get status of a specific job."""
    if job_id not in active_jobs:
        raise HTTPException(status_code=404, detail="Job not found.")
    return active_jobs[job_id]


@app.get("/api/projects/{dir_name}/render-state")
async def get_project_render_state(dir_name: str):
    """Smart Render diagnostics: persistent job state + cache stats.

    Powers the expandable Chi tiet progress panel. Read-only.
    """
    project_path = PROJECTS_DIR / dir_name
    if not project_path.is_dir():
        raise HTTPException(status_code=404, detail="Project not found.")
    cache = RenderCache(project_path)
    job_state = RenderJobState(project_path)
    manifest = cache.load_manifest()
    return {
        "project": dir_name,
        "job": job_state.load(),
        "cached_chunks": len((manifest.get("chunks") or {})),
        "render_engine_version": 1,
    }


# ==============================================================================
# NARRATION DIRECTOR API (Phase 9, hidden inside Voice)
# ==============================================================================

class NarrationAnalyzeRequest(BaseModel):
    mode: Optional[str] = Field(default=None, description="auto|custom|off")
    force: bool = Field(default=False, description="Regenerate even with manual edits")


class NarrationBeatUpdateRequest(BaseModel):
    style: Optional[str] = None
    intensity: Optional[float] = None
    rate: Optional[float] = None
    pauseBefore: Optional[float] = None
    pauseAfter: Optional[float] = None
    emphasis: Optional[List[str]] = None
    accepted: Optional[bool] = None


class NarrationPreviewRequest(BaseModel):
    beat_id: Optional[str] = Field(default=None, description="Beat to preview; omit for summary")


def _narration_script_of(project_path: Path) -> str:
    script_path = project_path / "script.txt"
    if not script_path.is_file():
        raise HTTPException(status_code=404, detail="Script not found.")
    return script_path.read_text(encoding="utf-8")


@app.get("/api/projects/{dir_name}/narration/plan")
async def get_narration_plan(dir_name: str):
    """Narration plan + lifecycle status (EMPTY/READY/OUTDATED/ERROR). Read-only."""
    project_path = PROJECTS_DIR / dir_name
    if not project_path.is_dir():
        raise HTTPException(status_code=404, detail="Project not found.")
    script = _narration_script_of(project_path)
    plan = nd_load(project_path)
    status = nd_status(project_path, script)
    summary = None
    if plan is not None:
        res = nd_validate(plan, script)
        summary = {"beats": len(plan.get("beats", [])),
                   "validation": res["status"],
                   "issues": res["issues"][:20],
                   "stats": res["stats"],
                   "manual_edited": sum(1 for b in plan.get("beats", [])
                                        if b.get("manualEdited"))}
    return {"project": dir_name, "status": status, "plan": plan, "summary": summary}


@app.post("/api/projects/{dir_name}/narration/analyze")
async def analyze_narration(dir_name: str, req: NarrationAnalyzeRequest = None):
    """Analyze → validate → atomic commit. Refuses silent manual-edit loss."""
    project_path = PROJECTS_DIR / dir_name
    if not project_path.is_dir():
        raise HTTPException(status_code=404, detail="Project not found.")
    req = req or NarrationAnalyzeRequest()
    mode = (req.mode or "auto").lower()
    if mode not in NARRATION_MODES:
        mode = "auto"
    script = _narration_script_of(project_path)
    existing = nd_load(project_path)
    manual = sum(1 for b in (existing.get("beats", []) if existing else [])
                 if b.get("manualEdited"))
    if manual and not req.force:
        raise HTTPException(
            status_code=409,
            detail={"message": "Narration Plan contains manual edits.",
                    "manual_edits": manual, "needs_confirm": True})
    cand = nd_analyze(script, mode=mode)
    res = nd_validate(cand, script)
    if res["status"] == "ERROR":
        raise HTTPException(status_code=422, detail="; ".join(res["issues"][:5]))
    cand["status"] = res["status"]
    nd_save(project_path, cand)
    return {"project": dir_name, "status": res["status"],
            "summary": {"beats": len(cand["beats"]), "stats": res["stats"],
                        "issues": res["issues"][:20]}}


@app.put("/api/projects/{dir_name}/narration/beats/{beat_id}")
async def update_narration_beat(dir_name: str, beat_id: str,
                                req: NarrationBeatUpdateRequest):
    """Manual beat edit (allowlisted fields); persists manualEdited. Never touches script."""
    project_path = PROJECTS_DIR / dir_name
    if not project_path.is_dir():
        raise HTTPException(status_code=404, detail="Project not found.")
    plan = nd_load(project_path)
    if plan is None:
        raise HTTPException(status_code=404, detail="Narration Plan not found.")
    try:
        beat = nd_update_beat(plan, beat_id,
                              {k: v for k, v in req.model_dump().items()
                               if v is not None})
    except (KeyError, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    script = _narration_script_of(project_path)
    res = nd_validate(plan, script)
    plan["status"] = res["status"]
    nd_save(project_path, plan)
    return {"project": dir_name, "beat": beat, "plan_status": res["status"],
            "issues": [i for i in res["issues"] if beat_id in i]}


def _cleanup_narration_previews(max_age_s: float = 3600.0) -> None:
    try:
        preview_dir = TEMP_DIR / "narration_preview"
        if not preview_dir.is_dir():
            return
        now = time.time()
        for p in preview_dir.glob("*.wav"):
            try:
                if now - p.stat().st_mtime > max_age_s:
                    p.unlink()
            except Exception:
                pass
    except Exception:
        pass


@app.post("/api/projects/{dir_name}/narration/preview")
async def preview_narration_beat(dir_name: str, req: NarrationPreviewRequest = None):
    """Render one beat (or representative summary) to TEMP audio. Never touches audio.wav."""
    project_path = PROJECTS_DIR / dir_name
    if not project_path.is_dir():
        raise HTTPException(status_code=404, detail="Project not found.")
    req = req or NarrationPreviewRequest()
    plan = nd_load(project_path)
    if plan is None or plan.get("mode") == "off":
        raise HTTPException(status_code=404, detail="No usable Narration Plan.")
    beats = plan.get("beats", [])
    if req.beat_id:
        sel = [b for b in beats if b.get("beatId") == req.beat_id]
        if not sel:
            raise HTTPException(status_code=404, detail="Beat not found.")
    else:
        # representative summary: one per style family + highest intensity, ≤60s
        fams = {"neutral": ("NEUTRAL", "AUTHORITATIVE"),
                "curious": ("CURIOUS", "MYSTERIOUS"),
                "tense": ("TENSE", "OMINOUS", "URGENT"),
                "reveal": ("REVEAL",)}
        sel = []
        for fam_styles in fams.values():
            cand = [b for b in beats if b.get("style") in fam_styles]
            if cand:
                sel.append(max(cand, key=lambda b: float(b.get("confidence", 0))))
        top = max(beats, key=lambda b: float(b.get("intensity", 0)), default=None)
        if top is not None and all(b.get("beatId") != top.get("beatId") for b in sel):
            sel.append(top)
        # cap ~60s at ~150wpm
        picked, words = [], 0
        for b in sel:
            w = len(b.get("text", "").split())
            if words + w > 150 and picked:
                break
            picked.append(b)
            words += w
        sel = picked or beats[:1]
        if not sel:
            raise HTTPException(status_code=404, detail="No beats to preview.")
    _cleanup_narration_previews()
    settings = {}
    try:
        settings = json.loads((project_path / "settings.json").read_text(encoding="utf-8"))
    except Exception:
        pass
    voice = settings.get("voice", config.default_voice)
    speed = float(settings.get("speed", config.default_speed))
    out_dir = TEMP_DIR / "narration_preview"
    out_dir.mkdir(parents=True, exist_ok=True)
    tag = req.beat_id or "summary"
    safe_tag = "".join(c if c.isalnum() or c in ("-", "_") else "_" for c in tag)[:40]
    out_path = out_dir / f"{dir_name}_{safe_tag}.wav"
    if out_path.exists():
        try:
            out_path.unlink()
        except Exception:
            pass
    pron_dict.load()
    track = []
    for b in sel:
        eff_text, _ = pron_dict.preprocess(b.get("text", ""))
        tmp = out_dir / f".tmp_{safe_tag}_{b.get('beatId')}.wav"
        eff_speed = min(2.0, max(0.5, speed * float(b.get("rate", 1.0))))
        await tts_provider.synthesize_chunk(
            text=eff_text, voice=voice, speed=eff_speed, output_path=tmp)
        if float(b.get("pauseBefore", 0)) > 0.01:
            track.append(("silence", float(b["pauseBefore"])))
        track.append(("wav", tmp))
        if float(b.get("pauseAfter", 0)) > 0.01:
            track.append(("silence", float(b["pauseAfter"])))
    nd_assemble(track, out_path)
    for _, p in track:
        if isinstance(p, Path) and p.name.startswith(".tmp_"):
            try:
                p.unlink()
            except Exception:
                pass
    return FileResponse(path=str(out_path), media_type="audio/wav",
                        filename=f"narration_preview_{safe_tag}.wav")


@app.get("/api/jobs/{job_id}/events")
async def stream_job_events(job_id: str):
    """Stream live progress updates via Server-Sent Events (SSE)."""
    if job_id not in active_jobs:
        raise HTTPException(status_code=404, detail="Job not found.")

    async def event_generator():
        while True:
            if job_id not in active_jobs:
                break
            job = active_jobs[job_id]
            data = json.dumps(job)
            yield f"data: {data}\n\n"
            if job["state"] in ("completed", "failed", "cancelled"):
                break
            await asyncio.sleep(0.3)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


@app.post("/api/jobs/{job_id}/cancel")
async def cancel_job(job_id: str):
    """Request safe cancellation of an in-progress job."""
    if job_id not in active_jobs:
        raise HTTPException(status_code=404, detail="Job not found.")

    cancel_event = job_cancel_events.get(job_id)
    if cancel_event:
        cancel_event.set()
        active_jobs[job_id]["state"] = "cancelling"
        logger.info(f"Cancellation requested for job {job_id}.")
        return {"status": "cancelling", "job_id": job_id}

    return {"status": "not_active", "job_id": job_id}


@app.get("/api/projects")
async def get_projects():
    """List historical projects."""
    projects = list_projects()
    return {"projects": projects}


@app.get("/api/projects/{dir_name}/audio/{audio_format}")
async def stream_project_audio(dir_name: str, audio_format: str):
    """Stream master WAV or MP3 from a project folder for in-browser playback."""
    ext = audio_format.lower().lstrip(".")
    if ext not in ("wav", "mp3"):
        raise HTTPException(status_code=400, detail="Invalid audio format.")

    project_path = PROJECTS_DIR / dir_name
    audio_file = project_path / f"audio.{ext}"

    if not audio_file.is_file():
        raise HTTPException(status_code=404, detail="Audio file not found in project.")

    media_type = "audio/wav" if ext == "wav" else "audio/mpeg"
    return FileResponse(
        path=str(audio_file),
        media_type=media_type,
        filename=f"{dir_name}.{ext}",
    )


@app.post("/api/projects/{dir_name}/export")
async def export_project_audio(dir_name: str, request: Request):
    """Export project audio (WAV or MP3) into outputs/ directory."""
    body = await request.json() if request.headers.get("content-type") == "application/json" else {}
    export_format = body.get("format", "wav").lower()

    project_path = PROJECTS_DIR / dir_name
    if not project_path.is_dir():
        raise HTTPException(status_code=404, detail="Project directory not found.")

    try:
        exported_path = export_to_outputs(project_path, export_format=export_format)
        return {
            "status": "success",
            "exported_file": exported_path.name,
            "full_path": str(exported_path),
            "format": export_format,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/projects/{dir_name}")
async def remove_project(dir_name: str):
    """Safely delete an entire project directory and its artifacts."""
    clean_dir = dir_name.strip()
    if not clean_dir:
        raise HTTPException(status_code=400, detail="Tên thư mục dự án không hợp lệ.")

    if _is_project_busy(clean_dir):
        raise HTTPException(
            status_code=409,
            detail="Dự án đang trong quá trình xử lý. Vui lòng dừng hoặc chờ xử lý hoàn tất trước khi xóa."
        )

    try:
        delete_project(clean_dir)
        logger.info(f"Project '{clean_dir}' deleted successfully.")
        return {
            "status": "success",
            "message": "Đã xóa dự án.",
            "directory_name": clean_dir
        }
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Không tìm thấy dự án.")
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"Failed to delete project '{clean_dir}': {e}")
        raise HTTPException(status_code=500, detail="Không thể xóa dự án. Vui lòng thử lại.")


# ==============================================================================
# PRONUNCIATION DICTIONARY API (Phase 3)
# ==============================================================================

@app.get("/api/pronunciations")
async def list_pronunciations():
    """List all configured pronunciation overrides."""
    pron_dict.load()
    return {"entries": pron_dict.list_entries()}


@app.post("/api/pronunciations")
async def add_pronunciation(req: PronunciationCreateRequest):
    """Add a new pronunciation dictionary entry with validation."""
    try:
        entry = pron_dict.add_entry(
            original=req.original,
            spoken_form=req.spoken_form,
            enabled=req.enabled,
        )
        return {"status": "success", "entry": entry.to_dict()}
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))


@app.put("/api/pronunciations/{entry_id}")
async def update_pronunciation(entry_id: str, req: PronunciationUpdateRequest):
    """Update or toggle an existing pronunciation dictionary entry."""
    try:
        entry = pron_dict.update_entry(
            entry_id=entry_id,
            original=req.original,
            spoken_form=req.spoken_form,
            enabled=req.enabled,
        )
        return {"status": "success", "entry": entry.to_dict()}
    except KeyError:
        raise HTTPException(status_code=404, detail="Entry not found.")
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))


@app.delete("/api/pronunciations/{entry_id}")
async def delete_pronunciation(entry_id: str):
    """Delete a pronunciation dictionary entry."""
    success = pron_dict.delete_entry(entry_id)
    if not success:
        raise HTTPException(status_code=404, detail="Entry not found.")
    return {"status": "success", "deleted_id": entry_id}


@app.post("/api/pronunciations/preview-transformation")
async def preview_pronunciation_transformation(req: PronunciationPreviewRequest):
    """Preview how text transforms under current enabled pronunciation dictionary."""
    pron_dict.load()
    transformed_text, applied_overrides = pron_dict.preprocess(req.text)
    return {
        "original_text": req.text,
        "transformed_text": transformed_text,
        "applied_overrides": applied_overrides,
        "transformed": transformed_text != req.text,
    }


@app.post("/api/pronunciations/test-audio")
async def generate_pronunciation_test_audio(req: PronunciationTestAudioRequest):
    """Generate a quick short audio clip to audition a pronunciation using Kokoro."""
    if not req.text or not req.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty.")

    voice = req.voice or config.default_voice
    speed = req.speed or config.default_speed

    # Create temporary WAV
    temp_dir = Path(tempfile.gettempdir()) / "unfoldiq_test_audio"
    temp_dir.mkdir(parents=True, exist_ok=True)
    temp_wav = temp_dir / f"pron_test_{uuid.uuid4().hex[:8]}.wav"

    try:
        await tts_provider.synthesize_chunk(
            text=req.text.strip(),
            voice=voice,
            speed=speed,
            output_path=temp_wav,
        )
        return FileResponse(
            path=str(temp_wav),
            media_type="audio/wav",
            filename="pronunciation_preview.wav",
        )
    except Exception as e:
        logger.error(f"Test audio generation failed: {e}")
        raise HTTPException(status_code=500, detail=f"Audio preview generation failed: {e}")


# ==============================================================================
# USER SETTINGS PERSISTENCE API (Phase 3)
# ==============================================================================

@app.get("/api/settings")
async def get_user_settings():
    """Retrieve persisted user defaults."""
    if USER_SETTINGS_PATH.exists():
        try:
            with open(USER_SETTINGS_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass

    return {
        "selected_language": "en-us",
        "selected_voice": config.default_voice,
        "speed": config.default_speed,
        "preferred_format": "mp3",
        "render_mode": DEFAULT_RENDER_MODE,
        "narration_mode": "auto",
        "narration_profile": DEFAULT_PROFILE,
    }


@app.post("/api/settings")
async def save_user_settings(req: UserSettingsRequest):
    """Save user preferences atomically."""
    current = {}
    if USER_SETTINGS_PATH.exists():
        try:
            with open(USER_SETTINGS_PATH, "r", encoding="utf-8") as f:
                current = json.load(f)
        except Exception:
            pass

    if req.selected_language is not None:
        current["selected_language"] = req.selected_language
    if req.selected_voice is not None:
        current["selected_voice"] = req.selected_voice
    if req.speed is not None:
        current["speed"] = req.speed
    if req.preferred_format is not None:
        current["preferred_format"] = req.preferred_format
    if req.render_mode is not None:
        mode = str(req.render_mode).lower()
        current["render_mode"] = mode if mode in RENDER_MODES else DEFAULT_RENDER_MODE
    if req.narration_mode is not None:
        nmode = str(req.narration_mode).lower()
        current["narration_mode"] = nmode if nmode in NARRATION_MODES else "auto"
    if req.narration_profile is not None:
        nprof = str(req.narration_profile)
        current["narration_profile"] = nprof if nprof in KNOWN_PROFILES else DEFAULT_PROFILE
    current["updated_at"] = datetime.now(timezone.utc).isoformat()

    # Atomic write
    USER_SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    temp_p = USER_SETTINGS_PATH.with_suffix(".tmp.json")
    try:
        with open(temp_p, "w", encoding="utf-8") as f:
            json.dump(current, f, indent=2)
        temp_p.replace(USER_SETTINGS_PATH)
    except Exception as e:
        if temp_p.exists():
            try:
                temp_p.unlink()
            except Exception:
                pass
        raise HTTPException(status_code=500, detail=f"Failed to save settings: {e}")

    return {"status": "success", "settings": current}


# ==============================================================================
# VOICE QA API (Phase 8.1)
# ==============================================================================

async def _rerender_chunk_impl(dir_name: str, chunk_index: int) -> Dict[str, Any]:
    project_dir = (PROJECTS_DIR / dir_name).resolve()
    if not project_dir.is_dir():
        raise HTTPException(status_code=404, detail=f"Project '{dir_name}' not found.")
    
    metadata_p = project_dir / "metadata.json"
    if not metadata_p.is_file():
        metadata_p = project_dir / "settings.json"
    if not metadata_p.is_file():
        raise HTTPException(status_code=400, detail="Missing metadata.json or settings.json in project.")
    
    with open(metadata_p, "r", encoding="utf-8") as f:
        meta = json.load(f)
    
    settings = meta.get("settings", meta)
    script_path = project_dir / "script.txt"
    if not script_path.is_file():
        raise HTTPException(status_code=400, detail="Missing script.txt in project.")
    
    with open(script_path, "r", encoding="utf-8") as f:
        script_text = f.read()

    voice = settings.get("voice", "af_heart")
    speed = float(settings.get("speed", 1.0))
    render_mode = settings.get("render_mode", DEFAULT_RENDER_MODE)
    export_mp3 = bool(settings.get("export_mp3", True)) or (project_dir / "audio.mp3").is_file()

    applied_overrides: List[Dict[str, Any]] = []
    synthesis_text = script_text
    try:
        pron_dict.load()
        synthesis_text, applied_overrides = pron_dict.preprocess(script_text)
    except Exception:
        pass
    plan = plan_render(
        synthesis_text,
        voice=voice,
        speed=speed,
        applied_overrides=applied_overrides,
        target_chars=config.chunk_target_chars,
        max_chars=config.chunk_max_chars,
        pron_preprocess=pron_dict.preprocess,
    )

    target_chunk = None
    for c in plan.chunks:
        if c.index == chunk_index or int(c.chunk_id) == chunk_index:
            target_chunk = c
            break

    if target_chunk is None:
        raise HTTPException(status_code=400, detail=f"Chunk index {chunk_index} not found in project (total {plan.total_chunks} chunks).")

    cache = RenderCache(project_dir)
    tmp_path = cache.chunks_dir / f".tmp_rerender_{target_chunk.chunk_id}_{target_chunk.render_hash[:12]}.wav"
    cancel_evt = asyncio.Event()

    async def synth_fn(text: str, out: Path) -> None:
        await tts_provider.synthesize_chunk(
            text=text,
            voice=voice,
            speed=speed,
            output_path=out,
            cancel_event=cancel_evt,
        )

    res = await render_chunk_with_retry(
        synth_fn, target_chunk.text, tmp_path,
        cancel_check=cancel_evt.is_set,
    )
    if not res.get("ok"):
        if tmp_path.exists():
            try:
                tmp_path.unlink()
            except Exception:
                pass
        raise HTTPException(status_code=500, detail=f"Failed to rerender chunk {chunk_index}: {res.get('error')}")

    cache.store(target_chunk.render_hash, tmp_path, target_chunk.chunk_id)
    if tmp_path.exists():
        try:
            tmp_path.unlink()
        except Exception:
            pass

    ordered = sorted(plan.chunks, key=lambda c: c.index)
    chunk_files = []
    for chunk in ordered:
        p = cache.lookup(chunk.render_hash)
        if p is None:
            raise HTTPException(status_code=500, detail=f"Chunk {chunk.chunk_id} missing from cache during re-stitch.")
        chunk_files.append(p)

    master_tmp = project_dir / ".audio_new.wav"
    if master_tmp.exists():
        master_tmp.unlink()
    stitch_wav_files(chunk_files, master_tmp)
    replace_file_atomically(master_tmp, project_dir / "audio.wav")

    if export_mp3:
        mp3_tmp = project_dir / ".audio_new.mp3"
        if mp3_tmp.exists():
            mp3_tmp.unlink()
        convert_wav_to_mp3(project_dir / "audio.wav", mp3_tmp)
        replace_file_atomically(mp3_tmp, project_dir / "audio.mp3")

    return {
        "status": "success",
        "message": f"Chunk {chunk_index} re-rendered successfully and master audio updated.",
        "chunk_id": target_chunk.chunk_id,
        "chunk_index": target_chunk.index
    }


async def _run_voice_qa_pipeline(dir_name: str):
    project_dir = PROJECTS_DIR / dir_name
    audio_path = project_dir / "audio.wav"
    script_path = project_dir / "script.txt"
    if not audio_path.is_file() or not script_path.is_file():
        if dir_name in active_qa_jobs:
            active_qa_jobs[dir_name]["status"] = "error"
            active_qa_jobs[dir_name]["error"] = "Missing audio.wav or script.txt"
        return

    job = active_qa_jobs.setdefault(dir_name, {})
    job["status"] = "running"
    job["progress"] = 10
    job["message"] = "Preparing Voice QA..."
    job["start_time"] = time.time()

    try:
        current_audio_hash = compute_file_sha256(audio_path)
        raw_transcription_path = project_dir / "transcription_raw.json"

        raw_data = None
        if raw_transcription_path.exists():
            try:
                with open(raw_transcription_path, "r", encoding="utf-8") as f:
                    cached_raw = json.load(f)
                if cached_raw.get("audio_sha256") == current_audio_hash and cached_raw.get("segments"):
                    raw_data = cached_raw
                    logger.info(f"Voice QA reusing cached raw transcription for {dir_name}")
            except Exception as ex:
                logger.warning(f"Error reading existing transcription_raw.json: {ex}")

        if not raw_data:
            job["progress"] = 20
            job["message"] = "Running Faster-Whisper ASR transcription..."

            ts_job = await stt_provider.start_transcription(
                project_id=dir_name,
                is_tts_active_fn=_is_tts_active
            )

            while True:
                await asyncio.sleep(0.5)
                if job.get("status") in ("cancelling", "cancelled"):
                    await stt_provider.cancel_transcription(dir_name)
                    job["status"] = "cancelled"
                    job["message"] = "Voice QA cancelled."
                    return

                curr_ts_job = stt_provider.get_job(dir_name)
                if not curr_ts_job:
                    break
                state = curr_ts_job.get("state")
                job["progress"] = 20 + int(curr_ts_job.get("percent", 0) * 0.6)
                job["message"] = curr_ts_job.get("message", "Transcribing...")

                if state == "completed":
                    break
                elif state in ("failed", "cancelled"):
                    job["status"] = "error" if state == "failed" else "cancelled"
                    job["error"] = curr_ts_job.get("error", "Transcription failed")
                    job["message"] = f"ASR transcription {state}: {job['error']}"
                    return

            if raw_transcription_path.exists():
                with open(raw_transcription_path, "r", encoding="utf-8") as f:
                    raw_data = json.load(f)
            else:
                job["status"] = "error"
                job["error"] = "transcription_raw.json not produced"
                return

        job["progress"] = 85
        job["message"] = "Evaluating speech accuracy and quality metrics..."

        with open(script_path, "r", encoding="utf-8") as f:
            script_text = f.read()

        dict_entries = pron_dict.entries if hasattr(pron_dict, "entries") else []
        existing_decisions = voice_qa_manager.load_decisions(dir_name)

        evaluator = VoiceQAEvaluator()
        eval_result = await asyncio.to_thread(
            evaluator.evaluate,
            script_text=script_text,
            raw_segments=raw_data.get("segments", []),
            audio_duration=raw_data.get("audio_duration", 0.0),
            audio_sha256=current_audio_hash,
            pronunciation_entries=dict_entries,
            human_decisions=existing_decisions
        )

        voice_qa_manager.save_evaluation(dir_name, eval_result)
        job["status"] = "completed"
        job["progress"] = 100
        job["message"] = f"Voice QA completed: {eval_result['status'].upper()}"
        job["eval_result"] = eval_result

    except asyncio.CancelledError:
        job["status"] = "cancelled"
        job["message"] = "Voice QA cancelled."
    except Exception as e:
        logger.exception(f"Voice QA pipeline error for {dir_name}: {e}")
        job["status"] = "error"
        job["error"] = str(e)
        job["message"] = f"Voice QA failed: {e}"


@app.post("/api/projects/{dir_name}/voice-qa")
@app.post("/api/projects/{dir_name}/voice-qa/run")
async def run_voice_qa(dir_name: str, req: Optional[VoiceQARunRequest] = None):
    project_path = PROJECTS_DIR / dir_name
    if not project_path.is_dir():
        raise HTTPException(status_code=404, detail="Project directory not found.")
    if not (project_path / "audio.wav").is_file():
        raise HTTPException(status_code=400, detail="Missing audio.wav in project. Generate TTS narration first.")
    if not (project_path / "script.txt").is_file():
        raise HTTPException(status_code=400, detail="Missing script.txt in project.")
    if _is_tts_active():
        raise HTTPException(status_code=409, detail="Cannot start Voice QA while TTS synthesis is active.")

    current_job = active_qa_jobs.get(dir_name)
    if current_job and current_job.get("status") == "running":
        return {"status": "running", "job": current_job}

    if req and req.force_transcribe:
        raw_p = project_path / "transcription_raw.json"
        if raw_p.exists():
            try:
                raw_p.unlink()
            except Exception:
                pass

    active_qa_jobs[dir_name] = {
        "status": "running",
        "progress": 0,
        "message": "Starting Voice QA...",
        "start_time": time.time()
    }
    asyncio.create_task(_run_voice_qa_pipeline(dir_name))
    return {"status": "started", "job": active_qa_jobs[dir_name]}


@app.get("/api/projects/{dir_name}/voice-qa")
async def get_voice_qa(dir_name: str):
    project_path = PROJECTS_DIR / dir_name
    if not project_path.is_dir():
        raise HTTPException(status_code=404, detail="Project directory not found.")

    active_job = active_qa_jobs.get(dir_name)
    if active_job and active_job.get("status") == "running":
        return {
            "status": "running",
            "progress": active_job.get("progress", 0),
            "message": active_job.get("message", "Evaluating Voice QA..."),
            "elapsed_seconds": round(time.time() - active_job.get("start_time", time.time()), 1)
        }

    status_data = voice_qa_manager.check_status(dir_name)
    if status_data.get("exists") and status_data.get("data"):
        eval_data = status_data["data"]
        raw_issues = eval_data.get("issues", [])
        normalized_issues = []
        for iss in raw_issues:
            iss_copy = dict(iss)
            st = iss_copy.get("start_time") if iss_copy.get("start_time") is not None else iss_copy.get("start_seconds", 0.0)
            et = iss_copy.get("end_time") if iss_copy.get("end_time") is not None else iss_copy.get("end_seconds", st)
            iss_copy["start_time"] = float(st)
            iss_copy["start_seconds"] = float(st)
            iss_copy["end_time"] = float(et)
            iss_copy["end_seconds"] = float(et)
            normalized_issues.append(iss_copy)

        return {
            "status": status_data.get("status", "review"),
            "state": "stale" if status_data.get("is_stale") else status_data.get("status", "review"),
            "is_stale": status_data.get("is_stale", False),
            "audio_duration": eval_data.get("audio_duration", 0.0),
            "metrics": eval_data.get("metrics", {}),
            "issues": normalized_issues,
            "summary": eval_data.get("summary", {}),
            "created_at": eval_data.get("created_at", "")
        }

    return {
        "status": "idle",
        "state": "idle",
        "exists": False,
        "has_audio": (project_path / "audio.wav").is_file()
    }


@app.post("/api/projects/{dir_name}/voice-qa/cancel")
async def cancel_voice_qa(dir_name: str):
    job = active_qa_jobs.get(dir_name)
    if job and job.get("status") == "running":
        job["status"] = "cancelling"
        job["message"] = "Cancelling Voice QA..."
        await stt_provider.cancel_transcription(dir_name)
        job["status"] = "cancelled"
        job["message"] = "Voice QA cancelled."
        return {"status": "cancelled"}
    return {"status": "not_running"}


@app.post("/api/projects/{dir_name}/voice-qa/issues/{fingerprint}/accept")
async def accept_voice_qa_issue(dir_name: str, fingerprint: str, req: Optional[VoiceQADecisionRequest] = None):
    note = req.note if req else None
    res = voice_qa_manager.record_decision(dir_name, fingerprint, "accepted", note=note)
    if not res:
        raise HTTPException(status_code=404, detail="Issue fingerprint not found or Voice QA report missing.")
    return {"status": "success", "fingerprint": fingerprint, "decision": "accepted", "qa_status": res}


@app.post("/api/projects/{dir_name}/voice-qa/issues/{fingerprint}/waive")
async def waive_voice_qa_issue(dir_name: str, fingerprint: str, req: Optional[VoiceQADecisionRequest] = None):
    note = req.note if req else None
    res = voice_qa_manager.record_decision(dir_name, fingerprint, "waived", note=note)
    if not res:
        raise HTTPException(status_code=404, detail="Issue fingerprint not found or Voice QA report missing.")
    return {"status": "success", "fingerprint": fingerprint, "decision": "waived", "qa_status": res}


@app.post("/api/projects/{dir_name}/voice-qa/rerender-chunk/{chunk_index}")
async def rerender_chunk_endpoint(dir_name: str, chunk_index: int):
    return await _rerender_chunk_impl(dir_name, chunk_index)


# ==============================================================================
# TIMESTAMPS & SUBTITLES API (Phase 4)
# ==============================================================================

@app.post("/api/projects/{dir_name}/timestamps")
@app.post("/api/projects/{dir_name}/timestamps/generate")
async def generate_project_timestamps(dir_name: str, req: Optional[TimestampGenerateRequest] = None):
    """Start on-demand local Whisper transcription and alignment for a project."""
    project_path = PROJECTS_DIR / dir_name
    if not project_path.is_dir():
        raise HTTPException(status_code=404, detail="Project directory not found.")
    if not (project_path / "audio.wav").is_file():
        raise HTTPException(status_code=400, detail="Missing audio.wav in project. Generate TTS narration first.")
    if not (project_path / "script.txt").is_file():
        raise HTTPException(status_code=400, detail="Missing script.txt in project.")

    # Voice QA Gating Check (Prompt Section 34)
    force = req.force if req else False
    qa_status = voice_qa_manager.check_status(dir_name)
    if qa_status.get("status") == "fail" and not force:
        raise HTTPException(
            status_code=400,
            detail="Voice QA còn lỗi nghiêm trọng (FAIL). Hãy sửa hoặc xác nhận bỏ qua trước khi tiếp tục."
        )

    try:
        job = await stt_provider.start_transcription(
            project_id=dir_name,
            is_tts_active_fn=_is_tts_active
        )
        return {"status": "started", "job": job}
    except RuntimeError as re:
        raise HTTPException(status_code=409, detail=str(re))
    except FileNotFoundError as fe:
        raise HTTPException(status_code=400, detail=str(fe))
    except Exception as e:
        logger.exception(f"Failed to start transcription for {dir_name}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/projects/{dir_name}/timestamps/status")
async def get_project_timestamps_status(dir_name: str):
    """Check current transcription/timestamp status, progress, and staleness."""
    status = stt_provider.check_project_timestamps_status(dir_name)
    active_states = ("preparing", "loading_model", "transcribing", "aligning", "writing", "processing")
    raw_state = status.get("state", "").lower()

    if raw_state in active_states:
        status["status"] = "Processing"
    elif "state" in status and "status" not in status:
        state_map = {"completed": "Ready", "stale": "Stale", "idle": "Not Generated"}
        status["status"] = state_map.get(status["state"], status["state"].capitalize())
    elif "status" in status and "state" not in status:
        status["state"] = status["status"].lower()

    if "percent" in status and "progress" not in status:
        status["progress"] = status["percent"]
    if "progress" in status and "percent" not in status:
        status["percent"] = status["progress"]

    if "coverage_pct" in status and "coverage" not in status:
        status["coverage"] = status["coverage_pct"]
    elif "coverage" in status and "coverage_pct" not in status:
        status["coverage_pct"] = status["coverage"]
    return status


@app.get("/api/projects/{dir_name}/timestamps")
@app.get("/api/projects/{dir_name}/timestamps.json")
@app.get("/api/projects/{dir_name}/timestamps/json")
async def get_project_timestamps_data(dir_name: str):
    """Retrieve canonical timestamps.json with sentence timing segments."""
    project_path = PROJECTS_DIR / dir_name
    ts_json = project_path / "timestamps.json"
    if not ts_json.is_file():
        raise HTTPException(status_code=404, detail="Timestamps not generated yet for this project.")

    try:
        with open(ts_json, "r", encoding="utf-8") as f:
            data = json.load(f)
        if "segments" in data and "sentences" not in data:
            data["sentences"] = data["segments"]
        elif "sentences" in data and "segments" not in data:
            data["segments"] = data["sentences"]
        return data
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load timestamps.json: {e}")


@app.get("/api/projects/{dir_name}/timestamps/srt")
async def download_project_srt(dir_name: str):
    """Download validated timestamps.srt file for video editors and media players."""
    project_path = PROJECTS_DIR / dir_name
    ts_srt = project_path / "timestamps.srt"
    if not ts_srt.is_file():
        raise HTTPException(status_code=404, detail="SRT subtitle file not found for this project.")

    return FileResponse(
        path=str(ts_srt),
        media_type="text/plain; charset=utf-8",
        filename=f"{dir_name}.srt"
    )


@app.post("/api/projects/{dir_name}/timestamps/cancel")
async def cancel_project_transcription(dir_name: str):
    """Cancel active transcription worker subprocess for a project."""
    await stt_provider.cancel_transcription(dir_name)
    return {"status": "cancelling", "project_id": dir_name}


# ==============================================================================
# VISUAL SCENE PLANNER & PROMPT PACK API (Phase 5)
# ==============================================================================

@app.get("/api/projects/{dir_name}/scenes")
async def get_project_scenes(dir_name: str):
    """Retrieve visual scene plan, metadata, and staleness status for a project."""
    project_path = PROJECTS_DIR / dir_name
    if not project_path.is_dir():
        raise HTTPException(status_code=404, detail="Project directory not found.")

    status_info = scene_planner.check_scene_plan_status(project_path)
    plan_path = project_path / "scene_plan.json"

    if not plan_path.is_file():
        return {
            "status": "Not Generated",
            "scene_count": 0,
            "coverage": 0.0,
            "audio_duration": 0.0,
            "scenes": [],
            "stale_reason": None,
        }

    try:
        with open(plan_path, "r", encoding="utf-8") as f:
            plan_data = json.load(f)
        return {
            "status": status_info["status"],
            "scene_count": status_info["scene_count"],
            "coverage": status_info["coverage"],
            "audio_duration": status_info["audio_duration"],
            "stale_reason": status_info["stale_reason"],
            "created_at": status_info.get("created_at"),
            "updated_at": status_info.get("updated_at"),
            "scenes": plan_data.get("scenes", []),
            "metadata": {
                "planner_version": plan_data.get("planner_version"),
                "source_script_sha256": plan_data.get("source_script_sha256"),
                "audio_sha256": plan_data.get("audio_sha256"),
                "timestamps_sha256": plan_data.get("timestamps_sha256"),
            }
        }
    except Exception as e:
        logger.exception(f"Failed to load scene_plan.json for {dir_name}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to read scene plan: {e}")


@app.post("/api/projects/{dir_name}/scenes/generate")
async def generate_project_scenes(dir_name: str, req: SceneGenerateRequest = SceneGenerateRequest()):
    """Generate or regenerate visual scene plan and prompt packs for a project."""
    project_path = PROJECTS_DIR / dir_name
    if not project_path.is_dir():
        raise HTTPException(status_code=404, detail="Project directory not found.")

    ts_path = project_path / "timestamps.json"
    if not ts_path.is_file():
        raise HTTPException(status_code=400, detail="Missing timestamps.json. Run timestamp alignment first.")

    active_project_dirs.add(dir_name)
    try:
        # Create planner instance with custom durations if provided
        planner = scene_planner
        if req.target_duration or req.min_duration or req.max_duration:
            from studio.scene_planner import ScenePlanner
            planner = ScenePlanner(
                target_duration=req.target_duration,
                min_duration=req.min_duration,
                max_duration=req.max_duration,
            )

        plan = planner.plan_project_scenes(project_path, force=req.force)
        return {
            "status": "Ready",
            "scene_count": plan.get("scene_count", 0),
            "coverage": plan.get("coverage", 100.0),
            "scenes": plan.get("scenes", []),
        }
    except FileNotFoundError as fnf:
        raise HTTPException(status_code=400, detail=str(fnf))
    except ScenePlanValidationError as ve:
        logger.error(f"Scene plan validation error in {dir_name}: {ve}")
        raise HTTPException(status_code=422, detail=str(ve))
    except Exception as e:
        logger.exception(f"Failed to generate scene plan for {dir_name}: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        active_project_dirs.discard(dir_name)


@app.put("/api/projects/{dir_name}/scenes/{scene_id}")
async def update_project_scene(dir_name: str, scene_id: str, req: SceneUpdateRequest):
    """Update a specific scene's visual prompt, category, summary, framing, or Phase 13 canonical visual refs."""
    project_path = PROJECTS_DIR / dir_name
    if not project_path.is_dir():
        raise HTTPException(status_code=404, detail="Project directory not found.")

    updates = req.dict(exclude_unset=True)
    try:
        updated_scene = scene_planner.update_scene(project_path, scene_id, updates)
        return {
            "status": "success",
            "scene_id": scene_id,
            "scene": updated_scene,
        }
    except KeyError as ke:
        raise HTTPException(status_code=404, detail=str(ke))
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except ScenePlanValidationError as spe:
        raise HTTPException(status_code=422, detail=str(spe))
    except Exception as e:
        logger.exception(f"Failed to update scene {scene_id} in {dir_name}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/projects/{dir_name}/scenes/prompts.json")
async def download_project_image_prompts_json(dir_name: str):
    """Download machine-readable image_prompts.json file."""
    project_path = PROJECTS_DIR / dir_name
    prompts_json = project_path / "image_prompts.json"
    if not prompts_json.is_file():
        raise HTTPException(status_code=404, detail="image_prompts.json not found for this project.")

    return FileResponse(
        path=str(prompts_json),
        media_type="application/json; charset=utf-8",
        filename=f"{dir_name}_image_prompts.json"
    )


@app.get("/api/projects/{dir_name}/scenes/prompts.md")
async def download_project_image_prompts_md(dir_name: str):
    """Download human-friendly copy-paste ready image_prompts.md file."""
    project_path = PROJECTS_DIR / dir_name
    prompts_md = project_path / "image_prompts.md"
    if not prompts_md.is_file():
        raise HTTPException(status_code=404, detail="image_prompts.md not found for this project.")

    return FileResponse(
        path=str(prompts_md),
        media_type="text/markdown; charset=utf-8",
        filename=f"{dir_name}_image_prompts.md"
    )


# ==============================================================================
# FLOW / VEO PROMPT GENERATOR API (Phase 6)
# ==============================================================================

@app.get("/api/projects/{dir_name}/veo")
async def get_project_veo(dir_name: str):
    """Retrieve Veo prompt plan, metadata, and staleness status for a project."""
    project_path = PROJECTS_DIR / dir_name
    if not project_path.is_dir():
        raise HTTPException(status_code=404, detail="Project directory not found.")

    status_info = veo_generator.check_veo_status(project_path)
    veo_path = project_path / "veo_prompts.json"

    if not veo_path.is_file():
        return {
            "status": "Not Generated",
            "shot_count": 0,
            "coverage": 0.0,
            "audio_duration": 0.0,
            "shots": [],
            "stale_reason": None,
        }

    try:
        with open(veo_path, "r", encoding="utf-8") as f:
            veo_data = json.load(f)
        return {
            "status": status_info["status"],
            "shot_count": status_info["shot_count"],
            "coverage": status_info["coverage"],
            "audio_duration": status_info["audio_duration"],
            "stale_reason": status_info["stale_reason"],
            "created_at": status_info.get("created_at"),
            "updated_at": status_info.get("updated_at"),
            "shots": veo_data.get("shots", []),
            "metadata": {
                "generator_version": veo_data.get("generator_version"),
                "source_script_sha256": veo_data.get("source_script_sha256"),
                "audio_sha256": veo_data.get("audio_sha256"),
                "timestamps_sha256": veo_data.get("timestamps_sha256"),
                "scene_plan_sha256": veo_data.get("scene_plan_sha256"),
                "target_shot_duration": veo_data.get("target_shot_duration"),
                "preferred_max_shot_duration": veo_data.get("preferred_max_shot_duration"),
                "aspect_ratio": veo_data.get("aspect_ratio"),
            }
        }
    except Exception as e:
        logger.exception(f"Failed to load veo_prompts.json for {dir_name}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to read Veo prompts: {e}")


@app.post("/api/projects/{dir_name}/veo/generate")
async def generate_project_veo(dir_name: str, req: VeoGenerateRequest = VeoGenerateRequest()):
    """Generate or regenerate Veo video prompt pack for a project."""
    project_path = PROJECTS_DIR / dir_name
    if not project_path.is_dir():
        raise HTTPException(status_code=404, detail="Project directory not found.")

    scene_plan_path = project_path / "scene_plan.json"
    if not scene_plan_path.is_file():
        raise HTTPException(status_code=400, detail="Missing scene_plan.json. Run scene planning first.")

    active_project_dirs.add(dir_name)
    try:
        # Create generator instance with custom settings if provided
        generator = veo_generator
        if (
            req.target_duration is not None
            or req.preferred_max_duration is not None
            or req.min_duration is not None
            or req.aspect_ratio is not None
        ):
            generator = VeoPromptGenerator(
                target_duration=req.target_duration or veo_generator.target_duration,
                preferred_max_duration=req.preferred_max_duration or veo_generator.preferred_max_duration,
                min_duration=req.min_duration or veo_generator.min_duration,
                aspect_ratio=req.aspect_ratio or veo_generator.aspect_ratio,
            )

        plan = generator.plan_project_veo(project_path, force=req.force)
        return {
            "status": "Ready",
            "shot_count": plan.get("shot_count", 0),
            "coverage": plan.get("coverage", 100.0),
            "shots": plan.get("shots", []),
        }
    except FileNotFoundError as fnf:
        raise HTTPException(status_code=400, detail=str(fnf))
    except VeoPlanValidationError as ve:
        logger.error(f"Veo plan validation error in {dir_name}: {ve}")
        raise HTTPException(status_code=422, detail=str(ve))
    except Exception as e:
        logger.exception(f"Failed to generate Veo prompts for {dir_name}: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        active_project_dirs.discard(dir_name)


@app.put("/api/projects/{dir_name}/veo/shots/{shot_id}")
async def update_project_veo_shot(dir_name: str, shot_id: str, req: VeoShotUpdateRequest):
    """Update a specific shot's Veo prompt, action, framing, or aspect ratio."""
    project_path = PROJECTS_DIR / dir_name
    if not project_path.is_dir():
        raise HTTPException(status_code=404, detail="Project directory not found.")

    updates = req.dict(exclude_unset=True)
    try:
        updated_shot = veo_generator.update_shot(project_path, shot_id, updates)
        return {
            "status": "success",
            "shot_id": shot_id,
            "shot": updated_shot,
        }
    except KeyError as ke:
        raise HTTPException(status_code=404, detail=str(ke))
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except VeoPlanValidationError as vpe:
        raise HTTPException(status_code=422, detail=str(vpe))
    except Exception as e:
        logger.exception(f"Failed to update shot {shot_id} in {dir_name}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/projects/{dir_name}/veo/prompts.json")
async def download_project_veo_prompts_json(dir_name: str):
    """Download machine-readable veo_prompts.json file."""
    project_path = PROJECTS_DIR / dir_name
    veo_json = project_path / "veo_prompts.json"
    if not veo_json.is_file():
        raise HTTPException(status_code=404, detail="veo_prompts.json not found for this project.")

    return FileResponse(
        path=str(veo_json),
        media_type="application/json; charset=utf-8",
        filename=f"{dir_name}_veo_prompts.json"
    )


@app.get("/api/projects/{dir_name}/veo/prompts.md")
async def download_project_veo_prompts_md(dir_name: str):
    """Download human-friendly copy-paste ready veo_prompts.md file."""
    project_path = PROJECTS_DIR / dir_name
    veo_md = project_path / "veo_prompts.md"
    if not veo_md.is_file():
        raise HTTPException(status_code=404, detail="veo_prompts.md not found for this project.")

    return FileResponse(
        path=str(veo_md),
        media_type="text/markdown; charset=utf-8",
        filename=f"{dir_name}_veo_prompts.md"
    )



@app.post("/api/projects/{dir_name}/veo/regenerate-all")
async def regenerate_all_veo_shots(dir_name: str):
    """
    Regenerate ALL Veo shots from the current Scene Plan using the Phase 7 engine.
    Archives existing veo_prompts.json before committing new data.
    Returns the new shot list on success; does not mutate canonical data on failure.
    """
    project_path = PROJECTS_DIR / dir_name
    if not project_path.is_dir():
        raise HTTPException(status_code=404, detail="Project directory not found.")

    scene_plan_path = project_path / "scene_plan.json"
    if not scene_plan_path.is_file():
        raise HTTPException(status_code=400, detail="Missing scene_plan.json. Run scene planning first.")

    active_project_dirs.add(dir_name)
    try:
        plan = veo_generator.plan_project_veo_shots(project_path, force=True)
        return {
            "status": "Ready",
            "shot_count": plan.get("shot_count", 0),
            "coverage": plan.get("full_timeline_coverage", 100.0),
            "generator_version": plan.get("generator_version"),
            "shots": plan.get("shots", []),
        }
    except FileNotFoundError as fnf:
        raise HTTPException(status_code=400, detail=str(fnf))
    except VeoPlanValidationError as ve:
        logger.error(f"Veo regenerate-all validation error in {dir_name}: {ve}")
        raise HTTPException(status_code=422, detail=str(ve))
    except Exception as e:
        logger.exception(f"Failed to regenerate all Veo shots for {dir_name}: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        active_project_dirs.discard(dir_name)


@app.post("/api/projects/{dir_name}/veo/regenerate-scene/{scene_id}")
async def regenerate_scene_veo_shots(dir_name: str, scene_id: str, force: bool = False):
    """
    Regenerate Veo shots for a single Scene without touching other Scenes.
    Archives existing veo_prompts.json before committing.
    P1 (§5): scene có asset LOCKED cần force=True (xác nhận rõ ràng).
    """
    project_path = PROJECTS_DIR / dir_name
    if not project_path.is_dir():
        raise HTTPException(status_code=404, detail="Project directory not found.")

    active_project_dirs.add(dir_name)
    try:
        updated_veo = veo_generator.regenerate_scene_shots(project_path, scene_id, force=force)
        return {
            "status": "Ready",
            "scene_id": scene_id,
            "shot_count": updated_veo.get("shot_count", 0),
            "shots": updated_veo.get("shots", []),
        }
    except (FileNotFoundError, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    except VeoPlanValidationError as ve:
        logger.error(f"Per-scene regeneration validation error for {scene_id} in {dir_name}: {ve}")
        raise HTTPException(status_code=422, detail=str(ve))
    except Exception as e:
        logger.exception(f"Failed to regenerate scene {scene_id} in {dir_name}: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        active_project_dirs.discard(dir_name)


@app.post("/api/projects/{dir_name}/complete")
async def complete_project(dir_name: str):
    """
    Mark a project as completed, export final audio to outputs/ if not already exported,
    and persist completed metadata in settings.json.
    """
    project_path = PROJECTS_DIR / dir_name
    if not project_path.is_dir():
        raise HTTPException(status_code=404, detail="Project directory not found.")

    settings_file = project_path / "settings.json"
    settings_data = {}
    if settings_file.is_file():
        try:
            with open(settings_file, "r", encoding="utf-8") as f:
                settings_data = json.load(f)
        except Exception as e:
            logger.warning(f"Could not read settings.json for {dir_name}: {e}")

    settings_data["status"] = "Completed"
    settings_data["completed_at"] = datetime.now(timezone.utc).isoformat()
    try:
        with open(settings_file, "w", encoding="utf-8") as f:
            json.dump(settings_data, f, indent=2, ensure_ascii=False)
    except Exception as e:
        logger.error(f"Failed to update settings.json for {dir_name}: {e}")

    exported_path = None
    if (project_path / "audio.wav").is_file():
        try:
            exported_path = str(export_to_outputs(project_path, "wav"))
        except Exception as e:
            logger.warning(f"Could not auto-export wav on complete: {e}")

    return {
        "status": "Completed",
        "project": dir_name,
        "completed_at": settings_data["completed_at"],
        "exported_audio": exported_path
    }


@app.get("/api/projects/{dir_name}/script")
async def get_project_script(dir_name: str):
    """Read-only: return canonical script.txt so the editor can hydrate on open."""
    project_path = PROJECTS_DIR / dir_name
    script_path = project_path / "script.txt"
    if not project_path.is_dir() or not script_path.is_file():
        raise HTTPException(status_code=404, detail="Script not found.")
    return {"project": dir_name, "script": script_path.read_text(encoding="utf-8")}


@app.get("/api/projects/{dir_name}/visual-bible")
async def get_project_visual_bible(dir_name: str):
    """Return visual_bible.json, status, and summary counts."""
    project_path = Path(PROJECTS_DIR) / dir_name
    if not project_path.is_dir():
        raise HTTPException(status_code=404, detail="Project directory not found.")

    status = visual_continuity_director.check_visual_bible_status(project_path)
    bible = visual_continuity_director.get_visual_bible(project_path)
    return {
        "status": status.get("status", "Not Generated"),
        "status_info": status,
        "visual_bible": bible,
    }


@app.post("/api/projects/{dir_name}/visual-bible/generate")
async def generate_project_visual_bible(dir_name: str, force: bool = False):
    """Derive or re-derive candidate Visual Bible from scene plan and script."""
    project_path = Path(PROJECTS_DIR) / dir_name
    if not project_path.is_dir():
        raise HTTPException(status_code=404, detail="Project directory not found.")

    active_project_dirs.add(dir_name)
    try:
        vb = visual_continuity_director.derive_and_save(project_path, force=force)
        status = visual_continuity_director.check_visual_bible_status(project_path)
        return {
            "status": "Ready",
            "visual_bible": vb,
            "status_info": status,
        }
    except (FileNotFoundError, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception(f"Failed to generate Visual Bible for {dir_name}: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        active_project_dirs.discard(dir_name)


@app.put("/api/projects/{dir_name}/visual-bible/entity")
async def update_visual_bible_entity(dir_name: str, req: VisualBibleEntityUpdateRequest):
    """Update a specific entity in the Visual Bible while preserving manual edits."""
    project_path = Path(PROJECTS_DIR) / dir_name
    if not project_path.is_dir():
        raise HTTPException(status_code=404, detail="Project directory not found.")

    try:
        updated = visual_continuity_director.update_entity(
            project_dir=project_path,
            entity_type=req.entity_type,
            entity_id=req.entity_id,
            updates=req.updates,
        )
        return {"status": "Updated", "entity": updated}
    except (KeyError, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception(f"Failed to update Visual Bible entity for {dir_name}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/projects/{dir_name}/visual-bible/issues")
async def get_visual_continuity_issues(dir_name: str):
    """Run full continuity validation and return issues list."""
    project_path = Path(PROJECTS_DIR) / dir_name
    if not project_path.is_dir():
        raise HTTPException(status_code=404, detail="Project directory not found.")

    try:
        report = visual_continuity_director.validate_continuity(project_path)
        return report
    except Exception as e:
        logger.exception(f"Failed to validate visual continuity for {dir_name}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ==============================================================================
# SCRIPT EDITORIAL QA + PROTECTED FACTS API (Phase 12)
# ==============================================================================

@app.get("/api/projects/{dir_name}/editorial")
async def get_editorial_qa(dir_name: str):
    """Read-only Editorial QA report + staleness flag. Missing -> NOT_STARTED."""
    from studio import editorial_qa as edq
    try:
        project_path = edq.resolve_project_dir(dir_name)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    report = edq.load_qa(project_path)
    if not report:
        return {"status": "NOT_STARTED", "exists": False, "issues": []}
    report = dict(report)
    report["exists"] = True
    report["stale"] = edq.check_stale(project_path)
    return report


@app.post("/api/projects/{dir_name}/editorial/analyze")
async def analyze_editorial_qa(dir_name: str):
    """Run deterministic editorial detection over canonical script.txt."""
    from studio import editorial_qa as edq
    try:
        project_path = edq.resolve_project_dir(dir_name)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not (project_path / "script.txt").is_file():
        raise HTTPException(status_code=400, detail="Missing script.txt.")
    try:
        return await asyncio.to_thread(edq.analyze_project, project_path)
    except Exception as e:
        logger.exception(f"Editorial QA analysis failed for {dir_name}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/projects/{dir_name}/editorial/issues/{issue_id}/apply")
async def apply_editorial_issue(dir_name: str, issue_id: str):
    """Apply one suggestion transactionally. 422 when a protected fact blocks."""
    from studio import editorial_qa as edq
    try:
        project_path = edq.resolve_project_dir(dir_name)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    try:
        return await asyncio.to_thread(edq.apply_suggestion, project_path, issue_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


@app.post("/api/projects/{dir_name}/editorial/issues/{issue_id}/ignore")
async def ignore_editorial_issue(dir_name: str, issue_id: str):
    from studio import editorial_qa as edq
    try:
        project_path = edq.resolve_project_dir(dir_name)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    try:
        return edq.ignore_issue(project_path, issue_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.get("/api/projects/{dir_name}/protection")
async def get_protection(dir_name: str):
    """Protected factual spans for the canonical script."""
    from studio import editorial_qa as edq
    try:
        project_path = edq.resolve_project_dir(dir_name)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    data = edq.load_protection(project_path)
    if not data:
        return {"exists": False, "protectedSpans": []}
    return {"exists": True, **data}


@app.post("/api/projects/{dir_name}/protection/refresh")
async def refresh_protection(dir_name: str):
    from studio import editorial_qa as edq
    try:
        project_path = edq.resolve_project_dir(dir_name)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    script_path = project_path / "script.txt"
    if not script_path.is_file():
        raise HTTPException(status_code=400, detail="Missing script.txt.")
    return await asyncio.to_thread(edq.ensure_protection, project_path,
                                   script_path.read_text(encoding="utf-8"))


@app.post("/api/projects/{dir_name}/protection/lock")
async def lock_protected_span(dir_name: str, req: EditorialLockRequest):
    from studio import editorial_qa as edq
    try:
        project_path = edq.resolve_project_dir(dir_name)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    try:
        return edq.lock_span(project_path, req.span_type, req.startOffset, req.endOffset)
    except (ValueError, FileNotFoundError) as e:
        raise HTTPException(status_code=400, detail=str(e))


# ==============================================================================
# VISUAL BIBLE V2 + REFERENCE ASSETS + VISUAL PROMPTS API (Phase 13)
# ==============================================================================

def _vb2_error(e: Exception) -> HTTPException:
    from studio.visual_bible_v2 import VisualBibleV2Error
    from studio.visual_prompt import VisualPromptError
    from studio.visual_dependencies import DependencyError
    if isinstance(e, (VisualBibleV2Error, VisualPromptError, DependencyError)):
        return HTTPException(status_code=400, detail=str(e))
    if isinstance(e, KeyError):
        return HTTPException(status_code=404, detail=str(e))
    if isinstance(e, FileNotFoundError):
        raise HTTPException(status_code=404, detail=str(e))
    return HTTPException(status_code=500, detail=str(e))


@app.get("/api/projects/{dir_name}/visual-bible/v2")
async def get_visual_bible_v2(dir_name: str):
    """Canonical V2 bible + per-character completeness. Unmigrated -> migrated:false."""
    from studio.visual_bible_v2 import (resolve_project_dir, load_bible,
                                        character_completeness, load_presets)
    try:
        project_path = resolve_project_dir(dir_name)
    except Exception as e:
        raise _vb2_error(e)
    bible = load_bible(project_path)
    if bible is None:
        return {"exists": False, "migrated": False}
    migrated = str(bible.get("schemaVersion", "1.0.0")).startswith("2.")
    chars = bible.get("characters", []) or bible.get("subjects", []) or []
    completeness = {}
    for c in chars:
        cid = c.get("characterId") or c.get("subjectId")
        if cid:
            completeness[cid] = character_completeness(bible, cid)
    return {"exists": True, "migrated": migrated,
            "schemaVersion": bible.get("schemaVersion"),
            "projectStyle": bible.get("projectStyle"),
            "characters": bible.get("characters", []),
            "environments": bible.get("environments", []),
            "objects": bible.get("objects", []),
            # Closure: expose legacy alias arrays read-only so canonical tabs
            # (subjects/groups) never depend on a parallel-merge side channel.
            "subjects": bible.get("subjects", []),
            "props": bible.get("props", []),
            "referenceAssets": bible.get("referenceAssets", []),
            "continuityGroups": bible.get("continuityGroups", []),
            "periods": bible.get("periods", []),
            "migration": bible.get("migration"),
            "visualBibleHash": bible.get("visualBibleHash"),
            "completeness": completeness,
            "presets": [{"presetId": p["presetId"], "presetVersion": p["presetVersion"],
                         "name": p.get("name", "")} for p in load_presets()]}


@app.post("/api/projects/{dir_name}/visual-bible/v2/migrate")
async def migrate_visual_bible_v2(dir_name: str):
    from studio.visual_bible_v2 import resolve_project_dir, migrate_to_v2
    try:
        project_path = resolve_project_dir(dir_name)
    except Exception as e:
        raise _vb2_error(e)
    try:
        return await asyncio.to_thread(migrate_to_v2, project_path)
    except Exception as e:
        raise _vb2_error(e)


@app.post("/api/projects/{dir_name}/visual-bible/v2/entities")
async def create_visual_entity(dir_name: str, req: VisualEntityCreateRequest):
    from studio.visual_bible_v2 import resolve_project_dir, create_entity
    try:
        project_path = resolve_project_dir(dir_name)
        return create_entity(project_path, req.kind, req.data)
    except Exception as e:
        raise _vb2_error(e)


@app.put("/api/projects/{dir_name}/visual-bible/v2/entities/{entity_id}")
async def update_visual_entity_v2(dir_name: str, entity_id: str, req: VisualEntityUpdateRequest):
    """Update a V2 entity + invalidate only dependent visual downstream."""
    from studio.visual_bible_v2 import resolve_project_dir, update_entity_v2
    from studio.visual_dependencies import compute_impact, apply_impact
    try:
        project_path = resolve_project_dir(dir_name)
        entity, affecting = await asyncio.to_thread(
            update_entity_v2, project_path, req.kind, entity_id, req.updates)
        impact = {"affectedScenes": [], "affectedShots": [], "reason": "UI-only change"}
        applied = {"markedVisualPrompts": 0, "markedShots": 0}
        if affecting:
            impact = await asyncio.to_thread(
                compute_impact, project_path,
                {"kind": req.kind, "id": entity_id})
            applied = await asyncio.to_thread(apply_impact, project_path, impact)
        return {"entity": entity, "promptAffecting": affecting,
                "impact": impact, "applied": applied}
    except Exception as e:
        raise _vb2_error(e)


@app.delete("/api/projects/{dir_name}/visual-bible/v2/entities/{entity_id}")
async def delete_visual_entity_v2(dir_name: str, entity_id: str, kind: str = "character",
                                  force: bool = False):
    from studio.visual_bible_v2 import resolve_project_dir, delete_entity
    try:
        project_path = resolve_project_dir(dir_name)
        return delete_entity(project_path, kind, entity_id, force=force)
    except Exception as e:
        raise _vb2_error(e)


@app.get("/api/projects/{dir_name}/visual-bible/v2/style")
async def get_project_style(dir_name: str):
    from studio.visual_bible_v2 import resolve_project_dir, get_style, load_presets
    try:
        project_path = resolve_project_dir(dir_name)
        return {"style": get_style(project_path),
                "presets": [{"presetId": p["presetId"], "presetVersion": p["presetVersion"],
                             "name": p.get("name", "")} for p in load_presets()]}
    except Exception as e:
        raise _vb2_error(e)


@app.put("/api/projects/{dir_name}/visual-bible/v2/style")
async def update_project_style(dir_name: str, req: VisualStyleUpdateRequest):
    """Project style edit invalidates all visual downstream only (never audio/QA/ts)."""
    from studio.visual_bible_v2 import resolve_project_dir, update_style
    from studio.visual_dependencies import compute_impact, apply_impact
    try:
        project_path = resolve_project_dir(dir_name)
        res = await asyncio.to_thread(update_style, project_path, req.style)
        impact = await asyncio.to_thread(
            compute_impact, project_path, {"kind": "style"})
        applied = await asyncio.to_thread(apply_impact, project_path, impact)
        return {**res, "impact": impact, "applied": applied}
    except Exception as e:
        raise _vb2_error(e)


@app.post("/api/projects/{dir_name}/visual-bible/v2/style/apply-preset")
async def apply_style_preset(dir_name: str, req: VisualPresetApplyRequest):
    from studio.visual_bible_v2 import resolve_project_dir, apply_preset
    from studio.visual_dependencies import compute_impact, apply_impact
    try:
        project_path = resolve_project_dir(dir_name)
        res = await asyncio.to_thread(apply_preset, project_path, req.preset_id)
        impact = await asyncio.to_thread(
            compute_impact, project_path, {"kind": "style"})
        applied = await asyncio.to_thread(apply_impact, project_path, impact)
        return {**res, "impact": impact, "applied": applied}
    except Exception as e:
        raise _vb2_error(e)


@app.get("/api/projects/{dir_name}/references")
async def list_reference_assets(dir_name: str):
    from studio.visual_bible_v2 import resolve_project_dir, load_bible, character_completeness
    try:
        project_path = resolve_project_dir(dir_name)
        bible = load_bible(project_path) or {}
        assets = bible.get("referenceAssets", []) or []
        chars = bible.get("characters", []) or []
        completeness = {}
        for c in chars:
            cid = c.get("characterId")
            if cid:
                completeness[cid] = character_completeness(bible, cid)
        return {"assets": assets, "completeness": completeness}
    except Exception as e:
        raise _vb2_error(e)


@app.post("/api/projects/{dir_name}/references/upload")
async def upload_reference_asset(dir_name: str, entity_type: str = "CHARACTER",
                                 entity_id: str = "", view: str = "FRONT",
                                 file: UploadFile = File(...)):
    from studio.visual_bible_v2 import (resolve_project_dir, add_reference_asset,
                                        VisualBibleV2Error)
    try:
        project_path = resolve_project_dir(dir_name)
        data = await file.read()
        meta = await asyncio.to_thread(
            add_reference_asset, project_path, entity_type, entity_id,
            view, file.filename or "reference.png", data)
        from studio.visual_dependencies import compute_impact, apply_impact
        impact = await asyncio.to_thread(
            compute_impact, project_path,
            {"kind": "referenceAsset", "entityType": entity_type,
             "entityId": entity_id, "assetId": meta["assetId"]})
        applied = await asyncio.to_thread(apply_impact, project_path, impact)
        return {"asset": meta, "impact": impact, "applied": applied}
    except VisualBibleV2Error as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception(f"Reference upload failed for {dir_name}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/projects/{dir_name}/references/{asset_id}/preview")
async def preview_reference_asset(dir_name: str, asset_id: str):
    from studio.visual_bible_v2 import resolve_project_dir, resolve_asset_path
    try:
        project_path = resolve_project_dir(dir_name)
        target = resolve_asset_path(project_path, asset_id)
    except Exception as e:
        raise _vb2_error(e)
    suffix = target.suffix.lower()
    media = {"png": "image/png", "jpg": "image/jpeg",
             "jpeg": "image/jpeg", "webp": "image/webp"}.get(suffix.lstrip("."), "image/png")
    return FileResponse(path=str(target), media_type=media, filename=target.name)


@app.post("/api/projects/{dir_name}/references/{asset_id}/replace")
async def replace_reference_asset(dir_name: str, asset_id: str,
                                  file: UploadFile = File(...)):
    from studio.visual_bible_v2 import resolve_project_dir, replace_reference_asset
    from studio.visual_dependencies import compute_impact, apply_impact
    try:
        project_path = resolve_project_dir(dir_name)
        data = await file.read()
        meta = await asyncio.to_thread(
            replace_reference_asset, project_path, asset_id,
            file.filename or "reference.png", data)
        impact = await asyncio.to_thread(
            compute_impact, project_path,
            {"kind": "referenceAsset", "entityType": meta["entityType"],
             "entityId": meta["entityId"], "assetId": asset_id})
        applied = await asyncio.to_thread(apply_impact, project_path, impact)
        return {"asset": meta, "impact": impact, "applied": applied}
    except Exception as e:
        raise _vb2_error(e)


@app.delete("/api/projects/{dir_name}/references/{asset_id}")
async def delete_reference_asset(dir_name: str, asset_id: str, force: bool = False):
    """Without force: impact preview only. With force: remove + invalidate dependents."""
    from studio.visual_bible_v2 import (resolve_project_dir, load_bible,
                                        remove_reference_asset)
    from studio.visual_dependencies import compute_impact, apply_impact
    try:
        project_path = resolve_project_dir(dir_name)
        bible = load_bible(project_path) or {}
        meta = next((a for a in bible.get("referenceAssets", []) or []
                     if a.get("assetId") == asset_id), None)
        if meta is None:
            raise HTTPException(status_code=404, detail=f"Unknown assetId: {asset_id}")
        impact = await asyncio.to_thread(
            compute_impact, project_path,
            {"kind": "referenceAsset", "entityType": meta["entityType"],
             "entityId": meta["entityId"], "assetId": asset_id})
        if not force:
            return {"removed": False, "impact": impact,
                    "confirm": "Replacing/removing affects listed scenes/shots. Retry with force=true."}
        res = await asyncio.to_thread(remove_reference_asset, project_path, asset_id)
        applied = await asyncio.to_thread(apply_impact, project_path, impact)
        return {**res, "impact": impact, "applied": applied}
    except HTTPException:
        raise
    except Exception as e:
        raise _vb2_error(e)


@app.get("/api/projects/{dir_name}/visual-prompts")
async def get_visual_prompts(dir_name: str):
    """Visual prompt entries with live CURRENT/OUTDATED status. Missing -> NOT_STARTED."""
    from studio.visual_bible_v2 import resolve_project_dir, load_bible
    from studio.visual_prompt import (load_prompts, check_entry_status,
                                      backfill_scene_visual)
    try:
        project_path = resolve_project_dir(dir_name)
    except Exception as e:
        raise _vb2_error(e)
    payload = load_prompts(project_path)
    if not payload.get("entries"):
        return {"status": "NOT_STARTED", "exists": False, "entries": []}
    bible = load_bible(project_path) or {}
    with open(project_path / "scene_plan.json", "r", encoding="utf-8") as f:
        scenes = {s["scene_id"]: s for s in json.load(f).get("scenes", [])}
    out = []
    for e in payload["entries"]:
        sc = scenes.get(e.get("sceneId"), {})
        full = backfill_scene_visual(dict(sc), bible) if sc else {}
        status, reason = check_entry_status(e, full, bible) if sc else ("OUTDATED", "scene missing")
        out.append({**e, "liveStatus": status, "liveReason": reason})
    outdated = sum(1 for e in out if e["liveStatus"] == "OUTDATED")
    return {"status": "OUTDATED" if outdated else "READY", "exists": True,
            "outdatedCount": outdated, "entries": out}


@app.post("/api/projects/{dir_name}/visual-prompts/generate")
async def generate_visual_prompts(dir_name: str, req: VisualPromptsGenerateRequest = None):
    from studio.visual_bible_v2 import resolve_project_dir
    from studio.visual_prompt import generate_all
    try:
        project_path = resolve_project_dir(dir_name)
    except Exception as e:
        raise _vb2_error(e)
    try:
        return await asyncio.to_thread(
            generate_all, project_path, req.scene_ids if req else None)
    except Exception as e:
        raise _vb2_error(e)


@app.get("/api/projects/{dir_name}/scenes/{scene_id}/visual")
async def get_scene_visual(dir_name: str, scene_id: str):
    """Backfilled scene visual refs + recommendation + override + prompt + Veo inheritance."""
    from studio.visual_bible_v2 import resolve_project_dir, load_bible
    from studio.visual_prompt import (backfill_scene_visual, recommend_output,
                                      load_prompts, inherit_for_shot)
    try:
        project_path = resolve_project_dir(dir_name)
    except Exception as e:
        raise _vb2_error(e)
    with open(project_path / "scene_plan.json", "r", encoding="utf-8") as f:
        scenes = {s["scene_id"]: s for s in json.load(f).get("scenes", [])}
    sc = scenes.get(scene_id)
    if sc is None:
        raise HTTPException(status_code=404, detail=f"Scene {scene_id} not found.")
    bible = load_bible(project_path) or {}
    full = backfill_scene_visual(dict(sc), bible)
    rec, reasons = recommend_output(full)
    entry = next((e for e in load_prompts(project_path).get("entries", [])
                  if e.get("sceneId") == scene_id), None)
    shots = []
    veo_path = project_path / "veo_prompts.json"
    if veo_path.is_file():
        with open(veo_path, "r", encoding="utf-8") as f:
            all_shots = json.load(f).get("shots", [])
        for sh in all_shots:
            parent = sh.get("parent_scene_id") or sh.get("parentSceneId") or sh.get("scene_id")
            if parent == scene_id:
                shots.append({**inherit_for_shot(sh, full, bible, entry),
                              "outdated": bool(sh.get("outdated"))})
    return {"scene": full, "recommendedOutputType": rec,
            "recommendationReasons": reasons,
            "effectiveOutputType": full.get("selectedOutputType") or rec,
            "visualEntry": entry, "veoInheritance": shots}


@app.get("/api/projects/{dir_name}/veo/shots/{shot_id}/inheritance")
async def get_veo_shot_inheritance(dir_name: str, shot_id: str):
    from studio.visual_bible_v2 import resolve_project_dir, load_bible
    from studio.visual_prompt import (backfill_scene_visual, load_prompts,
                                      inherit_for_shot)
    try:
        project_path = resolve_project_dir(dir_name)
    except Exception as e:
        raise _vb2_error(e)
    with open(project_path / "scene_plan.json", "r", encoding="utf-8") as f:
        scenes = {s["scene_id"]: s for s in json.load(f).get("scenes", [])}
    with open(project_path / "veo_prompts.json", "r", encoding="utf-8") as f:
        shots = json.load(f).get("shots", [])
    sh = next((s for s in shots if s.get("shot_id") == shot_id), None)
    if sh is None:
        raise HTTPException(status_code=404, detail=f"Shot {shot_id} not found.")
    parent = sh.get("parent_scene_id") or sh.get("parentSceneId") or sh.get("scene_id")
    bible = load_bible(project_path) or {}
    full = backfill_scene_visual(dict(scenes.get(parent, {})), bible)
    entry = next((e for e in load_prompts(project_path).get("entries", [])
                  if e.get("sceneId") == parent), None)
    return inherit_for_shot(sh, full, bible, entry)


@app.post("/api/projects/{dir_name}/dependencies/impact")
async def preview_dependency_impact(dir_name: str, req: DependencyImpactRequest):
    """Dry-run impact preview (no writes)."""
    from studio.visual_bible_v2 import resolve_project_dir
    from studio.visual_dependencies import compute_impact
    try:
        project_path = resolve_project_dir(dir_name)
        return await asyncio.to_thread(compute_impact, project_path, req.dict())
    except Exception as e:
        raise _vb2_error(e)


# ==============================================================================
# REPRESENTATIVE CAST + VALIDATION READINESS API (Corrective §9-10, §34-35)
# ==============================================================================

@app.post("/api/projects/{dir_name}/cast/suggestions/analyze")
async def analyze_cast_suggestions(dir_name: str):
    """Deterministic recurring-role analysis. Suggestion-first: creates nothing."""
    from studio.visual_bible_v2 import resolve_project_dir, analyze_cast_suggestions
    try:
        project_path = resolve_project_dir(dir_name)
        return await asyncio.to_thread(analyze_cast_suggestions, project_path)
    except Exception as e:
        raise _vb2_error(e)


@app.get("/api/projects/{dir_name}/cast/suggestions")
async def list_cast_suggestions(dir_name: str):
    from studio.visual_bible_v2 import resolve_project_dir, load_cast_suggestions
    try:
        project_path = resolve_project_dir(dir_name)
        return load_cast_suggestions(project_path)
    except Exception as e:
        raise _vb2_error(e)


@app.post("/api/projects/{dir_name}/cast/suggestions/{suggestion_id}/create")
async def create_cast_from_suggestion(dir_name: str, suggestion_id: str,
                                      req: CastCreateRequest = None):
    from studio.visual_bible_v2 import (resolve_project_dir,
                                        create_rep_from_suggestion)
    try:
        project_path = resolve_project_dir(dir_name)
        return await asyncio.to_thread(
            create_rep_from_suggestion, project_path, suggestion_id,
            (req.name if req else None))
    except Exception as e:
        raise _vb2_error(e)


@app.post("/api/projects/{dir_name}/cast/suggestions/{suggestion_id}/ignore")
async def ignore_cast_suggestion(dir_name: str, suggestion_id: str):
    from studio.visual_bible_v2 import resolve_project_dir, ignore_cast_suggestion
    try:
        project_path = resolve_project_dir(dir_name)
        return ignore_cast_suggestion(project_path, suggestion_id)
    except Exception as e:
        raise _vb2_error(e)


@app.post("/api/projects/{dir_name}/cast/suggestions/{suggestion_id}/merge")
async def merge_cast_suggestion(dir_name: str, suggestion_id: str,
                                req: CastMergeRequest):
    from studio.visual_bible_v2 import resolve_project_dir, merge_suggestion_into_rep
    try:
        project_path = resolve_project_dir(dir_name)
        return await asyncio.to_thread(
            merge_suggestion_into_rep, project_path, suggestion_id,
            req.character_id, req.bind_scenes)
    except Exception as e:
        raise _vb2_error(e)


@app.get("/api/projects/{dir_name}/cast/{character_id}/ref-prompts")
async def get_cast_ref_prompts(dir_name: str, character_id: str):
    """Copyable FRONT/3-4/PROFILE prompts for one representative. No images."""
    from studio.visual_bible_v2 import resolve_project_dir, build_ref_prompts
    try:
        project_path = resolve_project_dir(dir_name)
        return build_ref_prompts(project_path, character_id)
    except Exception as e:
        raise _vb2_error(e)


@app.get("/api/projects/{dir_name}/validation/readiness")
async def get_validation_readiness(dir_name: str):
    """Layered production/external-validation readiness (non-destructive)."""
    from studio.visual_bible_v2 import resolve_project_dir, validation_readiness
    try:
        project_path = resolve_project_dir(dir_name)
        return validation_readiness(project_path)
    except Exception as e:
        raise _vb2_error(e)


# ==============================================================================
# PRODUCTION EXPORT / FLOW HANDOFF API (Phase 11)
# ==============================================================================

@app.get("/api/projects/{dir_name}/production/status")
async def get_production_status(dir_name: str):
    """Read-only Production readiness, counts, blockers, and export history."""
    try:
        production_validate_project_id(dir_name)
    except ProductionExportError as e:
        raise HTTPException(status_code=400, detail=str(e))
    project_path = Path(PROJECTS_DIR) / dir_name
    if not project_path.is_dir():
        raise HTTPException(status_code=404, detail="Project directory not found.")
    try:
        return production_get_status(dir_name)
    except ProductionExportError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception(f"Failed to compute production status for {dir_name}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/projects/{dir_name}/production/export")
async def run_production_export(dir_name: str):
    """Create a new immutable production export snapshot (never overwrites)."""
    try:
        production_validate_project_id(dir_name)
    except ProductionExportError as e:
        raise HTTPException(status_code=400, detail=str(e))
    project_path = Path(PROJECTS_DIR) / dir_name
    if not project_path.is_dir():
        raise HTTPException(status_code=404, detail="Project directory not found.")
    if _is_project_busy(dir_name):
        raise HTTPException(status_code=409, detail="Project is busy (TTS/transcription/scene/veo/voice-QA running).")
    target_dir = dir_name
    try:
        result = await asyncio.to_thread(production_execute_export, target_dir)
        # Async ownership guard: response is project-scoped; the frontend
        # only applies it when currentProjectDir still matches.
        result["requestedProjectId"] = target_dir
        return result
    except ProductionExportError as e:
        raise HTTPException(status_code=422, detail={"message": str(e), "blockers": e.blockers,
                                                     "requestedProjectId": target_dir})
    except Exception as e:
        logger.exception(f"Production export failed for {dir_name}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/projects/{dir_name}/production/exports/{export_id}/open")
async def open_production_export_folder(dir_name: str, export_id: str):
    """Open the export folder in Explorer (local studio) or return its path to copy."""
    try:
        production_validate_project_id(dir_name)
    except ProductionExportError as e:
        raise HTTPException(status_code=400, detail=str(e))
    from studio.production_export import validate_export_id
    try:
        clean_export = validate_export_id(export_id)
    except ProductionExportError as e:
        raise HTTPException(status_code=400, detail=str(e))
    export_path = (Path(PROJECTS_DIR) / dir_name / "exports" / clean_export).resolve()
    canonical_root = Path(PROJECTS_DIR).resolve()
    try:
        export_path.relative_to(canonical_root)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid export path.")
    if not export_path.is_dir():
        raise HTTPException(status_code=404, detail="Export folder not found.")
    opened = False
    try:
        os.startfile(str(export_path))  # Windows local studio
        opened = True
    except Exception:
        opened = False
    return {"opened": opened, "path": str(export_path)}


@app.get("/api/projects/{dir_name}/status")
async def get_project_dependency_status(dir_name: str):
    """
    Return the dependency status for all pipeline modules in a project.
    Used by the frontend to automatically detect OUTDATED state on project open.
    """
    project_path = PROJECTS_DIR / dir_name
    if not project_path.is_dir():
        raise HTTPException(status_code=404, detail="Project directory not found.")

    def file_sha256(p: Path) -> Optional[str]:
        if not p.is_file():
            return None
        return compute_file_sha256(p)

    script_p = project_path / "script.txt"
    audio_p = project_path / "audio.wav"
    ts_p = project_path / "timestamps.json"
    scene_p = project_path / "scene_plan.json"
    veo_p = project_path / "veo_prompts.json"
    qa_p = project_path / "voice_qa.json"

    script_hash = file_sha256(script_p)
    audio_hash = file_sha256(audio_p)

    # Timestamps status
    ts_status = "EMPTY"
    if ts_p.is_file():
        with open(ts_p, encoding="utf-8") as f:
            ts_data = json.load(f)
        ts_audio_hash = ts_data.get("audio_sha256") or ts_data.get("source_audio_hash")
        ts_script_hash = ts_data.get("source_script_sha256") or ts_data.get("script_sha256")
        if (audio_hash and ts_audio_hash != audio_hash) or (script_hash and ts_script_hash and ts_script_hash != script_hash):
            ts_status = "OUTDATED"
        else:
            ts_status = "READY"

    # Scene Plan status
    scene_status = "EMPTY"
    if scene_p.is_file():
        with open(scene_p, encoding="utf-8") as f:
            sp_data = json.load(f)
        ts_hash_in_sp = sp_data.get("timestamps_sha256")
        ts_actual_hash = file_sha256(ts_p)
        if ts_actual_hash and ts_hash_in_sp != ts_actual_hash:
            scene_status = "OUTDATED"
        else:
            scene_status = "READY"

    # Veo status
    veo_status_info = veo_generator.check_veo_status(project_path)
    veo_status = veo_status_info["status"].upper() if veo_status_info["status"] else "EMPTY"

    # Voice QA status
    qa_status = "EMPTY"
    if qa_p.is_file():
        with open(qa_p, encoding="utf-8") as f:
            qa_data = json.load(f)
        qa_audio_hash = qa_data.get("audio_sha256")
        if audio_hash and qa_audio_hash != audio_hash:
            qa_status = "OUTDATED"
        else:
            qa_status = "READY"

    # Phase 10: Visual Bible status
    vb_status_info = visual_continuity_director.check_visual_bible_status(project_path)
    vb_status = vb_status_info["status"].upper() if vb_status_info["status"] else "EMPTY"

    return {
        "project": dir_name,
        "script": "READY" if script_p.is_file() else "EMPTY",
        "audio": "READY" if audio_p.is_file() else "EMPTY",
        "voiceQa": qa_status,
        "timestamp": ts_status,
        "scenePlan": scene_status,
        "visualBible": vb_status,
        "visualBibleInfo": vb_status_info,
        "veo": veo_status,
        "veoPartial": bool(veo_status_info.get("partial")),
        "veoOutdatedScenes": veo_status_info.get("outdated_scenes") or [],
        "staleReasons": {
            "veo": veo_status_info.get("stale_reason"),
            "visualBible": vb_status_info.get("stale_reason"),
        },
    }


@app.get("/api/projects/{dir_name}/v2/state")
async def get_project_v2_state(dir_name: str):
    """Unified ProjectV2 state endpoint for modern workbenches."""
    from studio.project_adapter import project_adapter
    try:
        state = project_adapter.load_project_v2(dir_name)
        return state.model_dump()
    except FileNotFoundError as fe:
        raise HTTPException(status_code=404, detail=str(fe))
    except Exception as e:
        logger.exception(f"Failed to load unified project state for {dir_name}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/projects/{dir_name}/v2/overview")
@app.get("/api/projects/{dir_name}/slice/overview")
async def get_project_overview(dir_name: str):
    """Selective loader: overview summary and stats for App Shell and Dashboard."""
    from studio.project_adapter import project_adapter
    try:
        overview = project_adapter.load_overview_slice(dir_name)
        return overview.model_dump()
    except FileNotFoundError as fe:
        raise HTTPException(status_code=404, detail=str(fe))
    except Exception as e:
        logger.exception(f"Failed to load project overview for {dir_name}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/projects/{dir_name}/v2/story")
@app.get("/api/projects/{dir_name}/story")
async def get_project_story(dir_name: str):
    """Selective loader: script and story beats for Story Workbench."""
    from studio.project_adapter import project_adapter
    try:
        story = project_adapter.load_story_slice(dir_name)
        return story.model_dump()
    except FileNotFoundError as fe:
        raise HTTPException(status_code=404, detail=str(fe))
    except Exception as e:
        logger.exception(f"Failed to load story slice for {dir_name}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/projects/{dir_name}/v2/voice")
@app.get("/api/projects/{dir_name}/voice")
async def get_project_voice(dir_name: str):
    """Selective loader: audio chunks, settings, and word cues for Voice Workbench."""
    from studio.project_adapter import project_adapter
    try:
        voice = project_adapter.load_voice_slice(dir_name)
        return voice.model_dump()
    except FileNotFoundError as fe:
        raise HTTPException(status_code=404, detail=str(fe))
    except Exception as e:
        logger.exception(f"Failed to load voice slice for {dir_name}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/projects/{dir_name}/visual/summary")
async def get_project_visual_summary(dir_name: str):
    """Contextual loader: high-level visual pipeline summary without full scene/shot trees."""
    from studio.project_adapter import project_adapter
    try:
        summary = project_adapter.load_visual_summary(dir_name)
        return summary.model_dump()
    except FileNotFoundError as fe:
        raise HTTPException(status_code=404, detail=str(fe))
    except Exception as e:
        logger.exception(f"Failed to load visual summary for {dir_name}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/projects/{dir_name}/visual/scenes")
async def get_project_visual_scenes(dir_name: str):
    """Contextual loader: lightweight scene list for Visual Navigator (no heavy prompt payloads)."""
    from studio.project_adapter import project_adapter
    try:
        scenes = project_adapter.load_visual_scenes_lightweight(dir_name)
        return [s.model_dump() for s in scenes]
    except FileNotFoundError as fe:
        raise HTTPException(status_code=404, detail=str(fe))
    except Exception as e:
        logger.exception(f"Failed to load lightweight scenes for {dir_name}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/projects/{dir_name}/visual/scenes/{scene_id}")
async def get_project_visual_scene_detail(dir_name: str, scene_id: str):
    """Contextual loader: full detail for a single scene with all its nested shots."""
    from studio.project_adapter import project_adapter
    try:
        scene = project_adapter.load_scene_detail(dir_name, scene_id)
        return scene.model_dump()
    except (FileNotFoundError, KeyError) as fe:
        raise HTTPException(status_code=404, detail=str(fe))
    except Exception as e:
        logger.exception(f"Failed to load scene {scene_id} for {dir_name}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/projects/{dir_name}/visual/shots/{shot_id}")
async def get_project_visual_shot_detail(dir_name: str, shot_id: str):
    """Contextual loader: full detail for a single shot card."""
    from studio.project_adapter import project_adapter
    try:
        shot = project_adapter.load_shot_detail(dir_name, shot_id)
        return shot.model_dump()
    except (FileNotFoundError, KeyError) as fe:
        raise HTTPException(status_code=404, detail=str(fe))
    except Exception as e:
        logger.exception(f"Failed to load shot {shot_id} for {dir_name}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/projects/{dir_name}/visual/bible")
async def get_project_visual_bible(dir_name: str):
    """Contextual loader: Visual Bible entities slice independently."""
    from studio.project_adapter import project_adapter
    try:
        vb_slice = project_adapter.load_visual_bible_slice(dir_name)
        return vb_slice.model_dump()
    except FileNotFoundError as fe:
        raise HTTPException(status_code=404, detail=str(fe))
    except Exception as e:
        logger.exception(f"Failed to load visual bible slice for {dir_name}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/projects/{dir_name}/v2/visual")
@app.get("/api/projects/{dir_name}/visual")
async def get_project_visual(dir_name: str):
    """Aggregate loader: scenes, shots, and visual bible for diagnostics/internal inspection."""
    from studio.project_adapter import project_adapter
    try:
        visual = project_adapter.load_visual_slice(dir_name)
        return visual.model_dump()
    except FileNotFoundError as fe:
        raise HTTPException(status_code=404, detail=str(fe))
    except Exception as e:
        logger.exception(f"Failed to load visual slice for {dir_name}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ==============================================================================
# PHASE 2 API ENDPOINTS: DEPENDENCY, NEXT ACTION, VERSIONING & LOCKING
# ==============================================================================

@app.get("/api/projects/{dir_name}/dependencies/graph")
async def get_project_dependency_graph(dir_name: str):
    """Returns artifact-level dependency graph with nodes, edges, statuses, and blockers."""
    from studio.project_bootstrap import bootstrap_project_graph, get_project_state_store
    p_dir = PROJECTS_DIR / dir_name
    if not p_dir.is_dir():
        raise HTTPException(
            status_code=404,
            detail={"code": "PROJECT_NOT_FOUND", "message": f"Dự án '{dir_name}' không tồn tại.", "project_id": dir_name}
        )
    try:
        store = get_project_state_store(dir_name)
        graph = bootstrap_project_graph(dir_name, state_store=store)
        return graph.to_dict()
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to get dependency graph for {dir_name}: {e}")
        raise HTTPException(status_code=500, detail={"code": "INTERNAL_ERROR", "message": str(e)})


@app.get("/api/projects/{dir_name}/next-action")
async def get_project_next_action(dir_name: str):
    """Returns the deterministic Next Best Action for the project."""
    from studio.project_bootstrap import bootstrap_project_graph, get_project_state_store
    from studio.next_action import NextBestActionService
    p_dir = PROJECTS_DIR / dir_name
    if not p_dir.is_dir():
        raise HTTPException(
            status_code=404,
            detail={"code": "PROJECT_NOT_FOUND", "message": f"Dự án '{dir_name}' không tồn tại.", "project_id": dir_name}
        )
    try:
        store = get_project_state_store(dir_name)
        graph = bootstrap_project_graph(dir_name, state_store=store)
        service = NextBestActionService(graph)
        action = service.get_next_action()
        return action.model_dump()
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to get next action for {dir_name}: {e}")
        raise HTTPException(status_code=500, detail={"code": "INTERNAL_ERROR", "message": str(e)})


@app.get("/api/projects/{dir_name}/history/{artifact_type}/{artifact_id}")
async def get_artifact_history(dir_name: str, artifact_type: str, artifact_id: str):
    """Returns historical revisions list for a specific artifact."""
    from studio.project_bootstrap import get_project_state_store
    from studio.version_manager import VersionManager
    from studio.locking import LOCKABLE_ARTIFACT_TYPES
    valid_types = LOCKABLE_ARTIFACT_TYPES.union({"script", "scene"})
    if artifact_type not in valid_types:
        raise HTTPException(
            status_code=400,
            detail={"code": "INVALID_ARTIFACT_TYPE", "message": f"Loại thực thể '{artifact_type}' không hợp lệ.", "artifact_type": artifact_type}
        )
    p_dir = PROJECTS_DIR / dir_name
    if not p_dir.is_dir():
        raise HTTPException(
            status_code=404,
            detail={"code": "PROJECT_NOT_FOUND", "message": f"Dự án '{dir_name}' không tồn tại.", "project_id": dir_name}
        )
    try:
        store = get_project_state_store(dir_name)
        vm = VersionManager(store)
        revisions = vm.list_history(artifact_type=artifact_type, artifact_id=artifact_id)
        return [r.model_dump() for r in revisions]
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to get history for {artifact_type}:{artifact_id}: {e}")
        raise HTTPException(status_code=500, detail={"code": "INTERNAL_ERROR", "message": str(e)})


@app.post("/api/projects/{dir_name}/history/{revision_id}/restore")
async def restore_artifact_revision(dir_name: str, revision_id: str, payload: Optional[Dict[str, Any]] = None):
    """Restores working state from a historical revision snapshot."""
    from studio.project_bootstrap import bootstrap_project_graph, get_project_state_store
    from studio.version_manager import VersionManager, RevisionNotFoundError
    from studio.locking import LockConflictError
    p_dir = PROJECTS_DIR / dir_name
    if not p_dir.is_dir():
        raise HTTPException(
            status_code=404,
            detail={"code": "PROJECT_NOT_FOUND", "message": f"Dự án '{dir_name}' không tồn tại.", "project_id": dir_name}
        )
    override_lock = bool(payload.get("override_lock", False)) if payload else False
    try:
        store = get_project_state_store(dir_name)
        graph = bootstrap_project_graph(dir_name, state_store=store)
        vm = VersionManager(store, graph=graph)
        result = vm.restore_revision(revision_id, override_lock=override_lock)
        return result
    except RevisionNotFoundError as rne:
        raise HTTPException(
            status_code=404,
            detail={"code": "REVISION_NOT_FOUND", "message": str(rne), "revision_id": revision_id}
        )
    except LockConflictError as lce:
        raise HTTPException(
            status_code=409,
            detail={"code": "LOCK_CONFLICT", "message": str(lce), "revision_id": revision_id}
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to restore revision {revision_id}: {e}")
        raise HTTPException(status_code=500, detail={"code": "INTERNAL_ERROR", "message": str(e)})


@app.post("/api/projects/{dir_name}/lock/{artifact_type}/{artifact_id}")
async def set_artifact_lock(dir_name: str, artifact_type: str, artifact_id: str, payload: Dict[str, Any]):
    """Locks or unlocks an artifact against automated bulk overwrites."""
    from studio.project_bootstrap import bootstrap_project_graph, get_project_state_store
    from studio.locking import LockManager, LOCKABLE_ARTIFACT_TYPES
    valid_types = LOCKABLE_ARTIFACT_TYPES.union({"script", "scene"})
    if artifact_type not in valid_types:
        raise HTTPException(
            status_code=400,
            detail={"code": "INVALID_ARTIFACT_TYPE", "message": f"Loại thực thể '{artifact_type}' không hợp lệ.", "artifact_type": artifact_type}
        )
    p_dir = PROJECTS_DIR / dir_name
    if not p_dir.is_dir():
        raise HTTPException(
            status_code=404,
            detail={"code": "PROJECT_NOT_FOUND", "message": f"Dự án '{dir_name}' không tồn tại.", "project_id": dir_name}
        )
    locked = bool(payload.get("locked", True))
    try:
        store = get_project_state_store(dir_name)
        graph = bootstrap_project_graph(dir_name, state_store=store)
        lm = LockManager(store, graph=graph)
        lm.set_lock(artifact_id, locked, artifact_type)
        return {
            "artifact_id": artifact_id,
            "artifact_type": artifact_type,
            "is_locked": locked,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to set lock for {artifact_id}: {e}")
        raise HTTPException(status_code=500, detail={"code": "INTERNAL_ERROR", "message": str(e)})



@app.on_event("shutdown")
async def shutdown_event():
    """Cancel all active transcription workers and safely checkpoint persistent jobs when Studio shuts down."""
    for project_id in stt_provider.get_active_projects():
        logger.info(f"Studio shutdown: terminating worker for {project_id}...")
        await stt_provider.cancel_transcription(project_id)
    # Safe stop and checkpoint active persistent jobs
    graceful_shutdown_manager.execute_safe_stop()


# Mount static directory for frontend
static_dir = BASE_DIR / "studio" / "static"
if static_dir.exists():
    app.mount("/", StaticFiles(directory=str(static_dir), html=True), name="static")
