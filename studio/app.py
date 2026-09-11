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

from fastapi import FastAPI, HTTPException, BackgroundTasks, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from studio.config import config, PROJECTS_DIR, BASE_DIR
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
from studio.transcription_service import transcription_service
from studio.scene_planner import scene_planner, ScenePlanValidationError
from studio.veo_prompt_generator import veo_generator, VeoPromptGenerator, VeoPlanValidationError


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

kokoro_client = KokoroClient()
pron_dict = PronunciationDictionary(BASE_DIR / "config" / "pronunciation_dictionary.json")
USER_SETTINGS_PATH = BASE_DIR / "config" / "user_settings.json"

# In-memory active job tracker
active_jobs: Dict[str, Dict[str, Any]] = {}
job_cancel_events: Dict[str, asyncio.Event] = {}
active_project_dirs: set = set()


def _is_project_busy(dir_name: str) -> bool:
    """Check if project has active TTS, transcription, scene, or veo generation."""
    if not dir_name:
        return False
    if dir_name in active_project_dirs:
        return True
    for j in active_jobs.values():
        if j.get("state") in ("preparing", "generating"):
            if j.get("project_name") == dir_name or j.get("directory_name") == dir_name:
                return True
    try:
        ts_job = transcription_service.get_job(dir_name)
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
        health = await kokoro_client.check_health()
        if not health.get("healthy"):
            job["state"] = "failed"
            job["error_message"] = "Kokoro TTS service is not available."
            logger.error(f"Job {job_id} failed: Kokoro offline. {health.get('error')}")
            return

        # Step 2: Pronunciation Dictionary Preprocessing (unchanged behavior)
        pron_dict.load()
        synthesis_text, applied_overrides = pron_dict.preprocess(req.script)
        synthesis_hash = hashlib.sha256(synthesis_text.encode("utf-8")).hexdigest()

        # Step 3: Deterministic render plan (Phase 2 chunking guarantees kept)
        try:
            plan = plan_render(
                synthesis_text,
                voice=req.voice,
                speed=req.speed,
                applied_overrides=applied_overrides,
                target_chars=config.chunk_target_chars,
                max_chars=config.chunk_max_chars,
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

        job["total_chunks"] = plan.total_chunks
        job["manifest"] = manifest
        job["reused_chunks"] = 0
        job["rendered_chunks"] = 0
        job["retries"] = 0

        # Step 4: Create project directory + project-scoped cache/state
        project_dir = create_project_directory(req.project_name)
        job["project_dir"] = str(project_dir)
        job["project_name"] = project_dir.name

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
                await kokoro_client.synthesize_chunk(
                    text=text,
                    voice=req.voice,
                    speed=req.speed,
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
        chunk_files = []
        for chunk in ordered:
            p = cache.lookup(chunk.render_hash)
            if p is None:
                raise RuntimeError(
                    f"Chunk {chunk.chunk_id} missing from cache at stitch time."
                )
            chunk_files.append(p)

        master_tmp = project_dir / ".audio_new.wav"  # valid ext required by encoder
        try:
            if master_tmp.exists():
                master_tmp.unlink()
        except Exception:
            pass
        duration_s = stitch_wav_files(chunk_files, master_tmp)
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
    kokoro_health = await kokoro_client.check_health()
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
    voices = await kokoro_client.get_voices()
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

    if transcription_service.is_gpu_busy():
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
        await kokoro_client.synthesize_chunk(
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
# TIMESTAMPS & SUBTITLES API (Phase 4)
# ==============================================================================

@app.post("/api/projects/{dir_name}/timestamps")
@app.post("/api/projects/{dir_name}/timestamps/generate")
async def generate_project_timestamps(dir_name: str):
    """Start on-demand local Whisper transcription and alignment for a project."""
    project_path = PROJECTS_DIR / dir_name
    if not project_path.is_dir():
        raise HTTPException(status_code=404, detail="Project directory not found.")
    if not (project_path / "audio.wav").is_file():
        raise HTTPException(status_code=400, detail="Missing audio.wav in project. Generate TTS narration first.")
    if not (project_path / "script.txt").is_file():
        raise HTTPException(status_code=400, detail="Missing script.txt in project.")

    try:
        job = await transcription_service.start_transcription(
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
    status = transcription_service.check_project_timestamps_status(dir_name)
    if "state" in status and "status" not in status:
        state_map = {"completed": "Ready", "processing": "Processing", "stale": "Stale", "idle": "Not Generated"}
        status["status"] = state_map.get(status["state"], status["state"].capitalize())
    elif "status" in status and "state" not in status:
        status["state"] = status["status"].lower()
    return status


@app.get("/api/projects/{dir_name}/timestamps")
async def get_project_timestamps_data(dir_name: str):
    """Retrieve canonical timestamps.json with sentence timing segments."""
    project_path = PROJECTS_DIR / dir_name
    ts_json = project_path / "timestamps.json"
    if not ts_json.is_file():
        raise HTTPException(status_code=404, detail="Timestamps not generated yet for this project.")

    try:
        with open(ts_json, "r", encoding="utf-8") as f:
            data = json.load(f)
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
    await transcription_service.cancel_transcription(dir_name)
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
    """Update a specific scene's visual prompt, category, summary, or framing."""
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



@app.on_event("shutdown")
async def shutdown_event():
    """Cancel all active transcription workers when Studio shuts down."""
    for project_id in list(transcription_service._active_procs.keys()):
        logger.info(f"Studio shutdown: terminating worker for {project_id}...")
        await transcription_service.cancel_transcription(project_id)


# Mount static directory for frontend
static_dir = BASE_DIR / "studio" / "static"
if static_dir.exists():
    app.mount("/", StaticFiles(directory=str(static_dir), html=True), name="static")
