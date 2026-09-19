"""
UnfoldIQ Phase 14 Production Studio FastAPI Router
Binds all Phase 14 modules to REST API endpoints:
- i18n & Localization
- Free-first Provider Router & Cost Policy
- Jobs & Activity Tracker
- Reproducible Research & Claim Ledger
- Narrative Outline & Versioned Script
- Canonical Asset Library
- Structured Generation Manifests & Google Flow Adapter
- Asset Intake, Lineage & Media QC
- Auto Timeline Compiler
- FFmpegRenderer (Draft Render, Final Render, Review Issues, Export Package)
"""

import json
import logging
import shutil
import tempfile
import asyncio
from pathlib import Path
from typing import Dict, Any, Optional, List

from fastapi import APIRouter, HTTPException, Request, UploadFile, File, Form, BackgroundTasks
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from studio.config import PROJECTS_DIR
from studio.i18n import get_full_dictionary, get_status_label
from studio.provider_router import provider_router, CostPolicy
from studio.jobs_manager import jobs_manager, JobStatus
from studio.research_service import research_service
from studio.script_service import script_service
from studio.canonical_library import canonical_library
from studio.manifest_service import manifest_service
from studio.flow_adapter import flow_adapter
from studio.asset_intake import asset_intake
from studio.media_qc import media_qc
from studio.timeline_compiler import timeline_compiler
from studio.renderer_adapter import renderer_adapter
from studio.production_export import preflight as production_preflight
from studio.system_check import resource_guard

logger = logging.getLogger("unfoldiq.phase14_router")

router = APIRouter(tags=["Phase 14 Production Pipeline"])

def _get_project_dir(dir_name: str) -> Path:
    p = PROJECTS_DIR / dir_name
    if not p.is_dir():
        raise HTTPException(status_code=404, detail=f"Dự án không tồn tại: {dir_name}")
    return p

# ---------------------------------------------------------------------------
# 1. i18n & Providers
# ---------------------------------------------------------------------------

@router.get("/api/i18n/{locale}")
async def get_locale_dictionary(locale: str):
    return get_full_dictionary(locale)

@router.get("/api/provider/status")
async def get_provider_status():
    return provider_router.get_status_overview()

class CostPolicyRequest(BaseModel):
    policy: str
    allow_paid: bool = False

@router.post("/api/provider/cost-policy")
async def update_cost_policy(req: CostPolicyRequest):
    try:
        policy = CostPolicy(req.policy)
        provider_router.set_cost_policy(policy, allow_paid=req.allow_paid)
        return {"status": "SUCCESS", "policy": policy.value}
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# ---------------------------------------------------------------------------
# 2. Activity & Jobs
# ---------------------------------------------------------------------------

@router.get("/api/activity/jobs")
async def list_activity_jobs(projectId: Optional[str] = None):
    return {"jobs": jobs_manager.list_jobs(project_id=projectId)}

@router.post("/api/activity/jobs/{job_id}/retry")
async def retry_activity_job(job_id: str):
    job = jobs_manager.retry_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Công việc không tồn tại")
    return job

@router.post("/api/activity/jobs/{job_id}/cancel")
async def cancel_activity_job(job_id: str):
    job = jobs_manager.cancel_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Công việc không tồn tại")
    return job

# ---------------------------------------------------------------------------
# 3. Canonical Library
# ---------------------------------------------------------------------------

@router.get("/api/library/assets")
async def get_library_assets():
    return canonical_library.get_all_assets()

# ---------------------------------------------------------------------------
# 4. Project Overview (Phase 14 Multi-stage Progress)
# ---------------------------------------------------------------------------

@router.get("/api/projects/{dir_name}/overview")
async def get_project_overview(dir_name: str):
    pdir = _get_project_dir(dir_name)
    research_summary = research_service.get_research_summary(pdir)
    script_data = script_service.get_script_data(pdir)
    timeline_data = timeline_compiler.get_timeline(pdir)
    manifests = manifest_service.list_manifests(pdir)
    assets = asset_intake.list_assets(pdir)
    review_issues = renderer_adapter.list_review_issues(pdir)

    has_audio = (pdir / "audio.wav").exists()
    has_subtitles = (pdir / "timestamps.srt").exists()
    has_draft = (pdir / "renders" / "draft" / "draft_preview.mp4").exists()
    has_final = (pdir / "renders" / "final" / "final.mp4").exists()

    total_scenes = timeline_data.get("stats", {}).get("totalScenes", 0)
    ready_visuals = timeline_data.get("stats", {}).get("readyScenes", 0)
    open_issues = sum(1 for iss in review_issues if iss.get("status") == "OPEN")

    return {
        "projectId": dir_name,
        "topic": research_summary.get("snapshot", {}).get("topic", "Human Origins"),
        "totalDuration": timeline_data.get("totalDuration", 0.0),
        "stages": {
            "research": {
                "status": "READY" if research_summary["stats"]["isLocked"] else "IN_PROGRESS",
                "label": get_status_label("READY" if research_summary["stats"]["isLocked"] else "IN_PROGRESS"),
                "details": f"{research_summary['stats']['approvedSources']} nguồn, {research_summary['stats']['totalClaims']} nhận định"
            },
            "script": {
                "status": script_data.get("status", "DRAFT"),
                "label": get_status_label(script_data.get("status", "DRAFT")),
                "details": f"Phiên bản v{script_data.get('version', 1)} ({len(script_data.get('sections', []))} phân đoạn)"
            },
            "voice": {
                "status": "READY" if has_audio else "MISSING",
                "label": get_status_label("READY" if has_audio else "MISSING"),
                "details": "Kokoro Neural TTS (Local)"
            },
            "scenes": {
                "status": "READY" if total_scenes > 0 else "MISSING",
                "label": get_status_label("READY" if total_scenes > 0 else "MISSING"),
                "details": f"{ready_visuals} / {total_scenes} cảnh có visual"
            },
            "review": {
                "status": "BLOCKED" if open_issues > 0 else "READY",
                "label": get_status_label("BLOCKED" if open_issues > 0 else "READY"),
                "details": f"{open_issues} vấn đề mở" if open_issues > 0 else "Không có lỗi"
            },
            "export": {
                "status": "READY" if has_final else ("PARTIAL" if has_draft else "NOT_STARTED"),
                "label": get_status_label("READY" if has_final else ("PARTIAL" if has_draft else "NOT_STARTED")),
                "details": "Đã xuất bản video" if has_final else ("Có bản nháp" if has_draft else "Chưa render")
            }
        },
        "blockers": timeline_data.get("missingAssetScenes", []),
        "reviewIssues": review_issues,
        "isLocked": script_data.get("locked", False)
    }

# ---------------------------------------------------------------------------
# 5. Research & Claim Ledger
# ---------------------------------------------------------------------------

@router.get("/api/projects/{dir_name}/research")
async def get_project_research(dir_name: str):
    pdir = _get_project_dir(dir_name)
    return research_service.get_research_summary(pdir)

class AddSourceRequest(BaseModel):
    title: str
    url: str
    publisher: Optional[str] = ""
    author: Optional[str] = ""
    content_snapshot: Optional[str] = ""
    source_type: Optional[str] = "manual"

@router.post("/api/projects/{dir_name}/research/sources")
async def add_project_source(dir_name: str, req: AddSourceRequest):
    pdir = _get_project_dir(dir_name)
    res = research_service.add_source(
        pdir,
        title=req.title,
        url=req.url,
        publisher=req.publisher or "",
        author=req.author or "",
        content_snapshot=req.content_snapshot or "",
        source_type=req.source_type or "manual"
    )
    return {"status": "SUCCESS", "source": res}

class SourceStatusRequest(BaseModel):
    status: str

@router.post("/api/projects/{dir_name}/research/sources/{source_id}/status")
async def update_source_status(dir_name: str, source_id: str, req: SourceStatusRequest):
    pdir = _get_project_dir(dir_name)
    ok = research_service.update_source_status(pdir, source_id, req.status)
    if not ok:
        raise HTTPException(status_code=404, detail="Nguồn không tồn tại")
    return {"status": "SUCCESS", "sourceId": source_id, "newStatus": req.status}

class DiscoverSourcesRequest(BaseModel):
    topic: Optional[str] = "Human Origins"
    query: Optional[str] = None

@router.post("/api/projects/{dir_name}/research/discover")
async def run_research_discovery(dir_name: str, req: DiscoverSourcesRequest):
    pdir = _get_project_dir(dir_name)
    discovered = research_service.run_assisted_discovery(pdir, topic=req.topic or "Human Origins", query=req.query)
    return {"status": "SUCCESS", "discovered": discovered}

@router.post("/api/projects/{dir_name}/research/sources/{source_id}/approve")
async def approve_research_source(dir_name: str, source_id: str):
    pdir = _get_project_dir(dir_name)
    ok = research_service.approve_source(pdir, source_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Nguồn không tồn tại")
    return {"status": "SUCCESS", "sourceId": source_id, "statusLabel": "APPROVED"}

@router.post("/api/projects/{dir_name}/research/sources/{source_id}/reject")
async def reject_research_source(dir_name: str, source_id: str):
    pdir = _get_project_dir(dir_name)
    ok = research_service.reject_source(pdir, source_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Nguồn không tồn tại")
    return {"status": "SUCCESS", "sourceId": source_id, "statusLabel": "REJECTED"}

class LockRequest(BaseModel):
    locked: bool = True

@router.post("/api/projects/{dir_name}/research/lock")
async def lock_research_source_set(dir_name: str, req: LockRequest):
    pdir = _get_project_dir(dir_name)
    source_set = research_service.lock_source_set(pdir, locked=req.locked)
    return {"status": "SUCCESS", "sourceSet": source_set}

class AddClaimRequest(BaseModel):
    statement: str
    source_ids: List[str]
    evidence_type: Optional[str] = "DIRECT_EVIDENCE"
    confidence: Optional[str] = "HIGH"
    status: Optional[str] = "APPROVED"

@router.post("/api/projects/{dir_name}/research/claims")
async def add_project_claim(dir_name: str, req: AddClaimRequest):
    pdir = _get_project_dir(dir_name)
    claim = research_service.add_claim(
        pdir,
        statement=req.statement,
        source_ids=req.source_ids,
        evidence_type=req.evidence_type or "DIRECT_EVIDENCE",
        confidence=req.confidence or "HIGH",
        status=req.status or "APPROVED"
    )
    return {"status": "SUCCESS", "claim": claim}

@router.put("/api/projects/{dir_name}/research/claims/{claim_id}")
async def update_project_claim(dir_name: str, claim_id: str, updates: Dict[str, Any]):
    pdir = _get_project_dir(dir_name)
    claim = research_service.update_claim(pdir, claim_id, updates)
    if not claim:
        raise HTTPException(status_code=404, detail="Claim không tồn tại")
    return {"status": "SUCCESS", "claim": claim}

# ---------------------------------------------------------------------------
# 6. Narrative Outline & Versioned Script
# ---------------------------------------------------------------------------

@router.get("/api/projects/{dir_name}/script/outline")
async def get_narrative_outline(dir_name: str):
    pdir = _get_project_dir(dir_name)
    return {"outline": script_service.get_outline(pdir)}

@router.get("/api/projects/{dir_name}/script/v2")
async def get_versioned_script(dir_name: str):
    pdir = _get_project_dir(dir_name)
    return script_service.get_script_data(pdir)

class UpdateScriptRequest(BaseModel):
    sections: List[Dict[str, Any]]
    new_version: bool = False
    force: bool = False

@router.put("/api/projects/{dir_name}/script/v2")
async def update_versioned_script(dir_name: str, req: UpdateScriptRequest):
    pdir = _get_project_dir(dir_name)
    try:
        data = script_service.update_script(pdir, req.sections, new_version=req.new_version, force=req.force)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return {"status": "SUCCESS", "script": data}

@router.post("/api/projects/{dir_name}/script/approve")
async def approve_and_lock_script(dir_name: str):
    pdir = _get_project_dir(dir_name)
    data = script_service.approve_and_lock_script(pdir)
    return {"status": "SUCCESS", "script": data}

@router.get("/api/projects/{dir_name}/script/vi-explanation")
async def get_script_vi_explanation(dir_name: str):
    pdir = _get_project_dir(dir_name)
    return {"explanations": script_service.get_vietnamese_explanation(pdir)}

# ---------------------------------------------------------------------------
# 7. Generation Manifests & Google Flow Adapter
# ---------------------------------------------------------------------------

@router.get("/api/projects/{dir_name}/manifests")
async def list_generation_manifests(dir_name: str):
    pdir = _get_project_dir(dir_name)
    return {"manifests": manifest_service.list_manifests(pdir)}

@router.get("/api/projects/{dir_name}/scenes/{scene_id}/manifest")
async def get_scene_manifest(dir_name: str, scene_id: str):
    pdir = _get_project_dir(dir_name)
    manifest = manifest_service.get_manifest_for_scene(pdir, scene_id)
    if not manifest:
        # Auto compile manifest if scene exists
        sp = pdir / "scene_plan.json"
        scene_item = None
        if sp.exists():
            scenes = json.loads(sp.read_text(encoding="utf-8")).get("scenes", [])
            scene_item = next((s for s in scenes if s.get("scene_id") == scene_id or s.get("id") == scene_id), None)
        if not scene_item:
            scene_item = {"scene_id": scene_id, "narration": "Prehistoric scene", "duration": 6.0}
        manifest = manifest_service.generate_manifest_for_scene(pdir, scene_item)
    return manifest

@router.get("/api/projects/{dir_name}/scenes/{scene_id}/visual-blueprint")
async def get_scene_visual_blueprint(dir_name: str, scene_id: str):
    manifest = await get_scene_manifest(dir_name, scene_id)
    return {"visual_blueprint": manifest.get("visual_blueprint"), "visualType": manifest.get("visualType")}

@router.get("/api/projects/{dir_name}/scenes/{scene_id}/motion-blueprint")
async def get_scene_motion_blueprint(dir_name: str, scene_id: str):
    manifest = await get_scene_manifest(dir_name, scene_id)
    return {"motion_blueprint": manifest.get("motion_blueprint")}

@router.get("/api/projects/{dir_name}/scenes/{scene_id}/routing")
async def get_scene_routing(dir_name: str, scene_id: str):
    manifest = await get_scene_manifest(dir_name, scene_id)
    return {"routing": manifest.get("routing"), "visualType": manifest.get("visualType")}

@router.post("/api/projects/{dir_name}/manifests/generate-all")
async def generate_all_manifests(dir_name: str):
    pdir = _get_project_dir(dir_name)
    sp = pdir / "scene_plan.json"
    if not sp.exists():
        raise HTTPException(status_code=400, detail="Cần tạo Scene Plan trước khi sinh Generation Manifests.")
    scenes = json.loads(sp.read_text(encoding="utf-8")).get("scenes", [])
    results = []
    for sc in scenes:
        m = manifest_service.generate_manifest_for_scene(pdir, sc)
        results.append(m)
    return {"status": "SUCCESS", "count": len(results), "manifests": results}

@router.get("/api/projects/{dir_name}/scenes/{scene_id}/flow-instructions")
async def get_scene_flow_instructions(dir_name: str, scene_id: str):
    pdir = _get_project_dir(dir_name)
    manifest = manifest_service.get_manifest_for_scene(pdir, scene_id)
    if not manifest:
        manifest = manifest_service.generate_manifest_for_scene(pdir, {"scene_id": scene_id, "narration": "Prehistoric scene"})
    instructions = flow_adapter.prepare_flow_instructions(scene_id, manifest)
    return instructions

# ---------------------------------------------------------------------------
# 8. Asset Intake, Lineage & QC
# ---------------------------------------------------------------------------

@router.get("/api/projects/{dir_name}/assets")
async def list_project_assets(dir_name: str, sceneId: Optional[str] = None):
    pdir = _get_project_dir(dir_name)
    return {"assets": asset_intake.list_assets(pdir, scene_id=sceneId)}

@router.post("/api/projects/{dir_name}/assets/intake")
async def intake_media_asset(
    dir_name: str,
    scene_id: str = Form(...),
    shot_id: Optional[str] = Form(None),
    manifest_id: Optional[str] = Form(None),
    file: UploadFile = File(...)
):
    pdir = _get_project_dir(dir_name)
    temp_dir = tempfile.mkdtemp(prefix="unfoldiq_upload_")
    temp_path = Path(temp_dir) / file.filename
    try:
        with open(temp_path, "wb") as f:
            shutil.copyfileobj(file.file, f)
        
        asset = asset_intake.intake_asset(
            pdir,
            source_file_path=temp_path,
            scene_id=scene_id,
            shot_id=shot_id,
            manifest_id=manifest_id,
            provider="google_flow",
            select_immediately=True
        )

        # Auto update timeline on new intake
        timeline_compiler.compile_timeline(pdir)
        return {"status": "SUCCESS", "asset": asset}
    except (ValueError, FileNotFoundError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)

class AssetLifecycleRequest(BaseModel):
    state: str
    force_unlock: bool = False

@router.post("/api/projects/{dir_name}/assets/{asset_id}/lifecycle")
async def update_asset_lifecycle_endpoint(dir_name: str, asset_id: str, req: AssetLifecycleRequest):
    pdir = _get_project_dir(dir_name)
    try:
        updated = asset_intake.update_asset_lifecycle(
            pdir, asset_id, req.state, force_unlock=req.force_unlock
        )
        if not updated:
            raise HTTPException(status_code=404, detail="Asset không tồn tại")
        timeline_compiler.compile_timeline(pdir)
        return {"status": "SUCCESS", "asset": updated}
    except ValueError as e:
        raise HTTPException(status_code=403, detail=str(e))

# ---------------------------------------------------------------------------
# 9. Auto Timeline
# ---------------------------------------------------------------------------

@router.get("/api/projects/{dir_name}/timeline/v2")
async def get_project_timeline(dir_name: str):
    pdir = _get_project_dir(dir_name)
    return timeline_compiler.get_timeline(pdir)

class TimelineCompileRequest(BaseModel):
    mute_generated_audio: bool = True
    transition_type: str = "crossfade"
    transition_duration: float = 0.25

@router.post("/api/projects/{dir_name}/timeline/compile")
async def recompile_project_timeline(dir_name: str, req: TimelineCompileRequest):
    pdir = _get_project_dir(dir_name)
    timeline = timeline_compiler.compile_timeline(
        pdir,
        mute_generated_audio=req.mute_generated_audio,
        transition_type=req.transition_type,
        transition_duration=req.transition_duration
    )
    return {"status": "SUCCESS", "timeline": timeline}

# ---------------------------------------------------------------------------
# 10. Rendering & Review Loop
# ---------------------------------------------------------------------------

@router.get("/api/projects/{dir_name}/review/issues")
async def list_review_issues_endpoint(dir_name: str):
    pdir = _get_project_dir(dir_name)
    return {"issues": renderer_adapter.list_review_issues(pdir)}

class CreateReviewIssueRequest(BaseModel):
    scene_id: str
    issue_type: str
    description: str
    severity: str = "WARNING"

@router.post("/api/projects/{dir_name}/review/issues")
async def create_review_issue_endpoint(dir_name: str, req: CreateReviewIssueRequest):
    pdir = _get_project_dir(dir_name)
    issue = renderer_adapter.create_review_issue(
        pdir,
        scene_id=req.scene_id,
        issue_type=req.issue_type,
        description=req.description,
        severity=req.severity
    )
    return {"status": "SUCCESS", "issue": issue}

@router.post("/api/projects/{dir_name}/review/issues/{issue_id}/resolve")
async def resolve_review_issue_endpoint(dir_name: str, issue_id: str):
    pdir = _get_project_dir(dir_name)
    ok = renderer_adapter.resolve_review_issue(pdir, issue_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Issue không tồn tại")
    return {"status": "SUCCESS", "issueId": issue_id}

@router.post("/api/projects/{dir_name}/render/draft")
async def trigger_draft_render(dir_name: str, background_tasks: BackgroundTasks):
    # P1 (§7 FINAL-GAPS): Draft không chặt như Final nhưng chặn trường hợp vô nghĩa:
    # thiếu audio master hoặc timeline không compile được → 422, không vào job.
    pdir = _get_project_dir(dir_name)
    if not (pdir / "audio.wav").is_file():
        raise HTTPException(status_code=422, detail={
            "message": "Chưa thể dựng nháp: thiếu audio giọng đọc (audio.wav). Hãy tạo giọng đọc trước.",
            "blockers": ["missing-audio"],
        })
    try:
        tl = timeline_compiler.get_timeline(pdir)
    except Exception as e:
        raise HTTPException(status_code=422, detail={
            "message": f"Chưa thể dựng nháp: timeline không hợp lệ ({e}). Hãy đồng bộ dòng thời gian.",
            "blockers": ["invalid-timeline"],
        })
    if not (tl.get("scenes") or []):
        raise HTTPException(status_code=422, detail={
            "message": "Chưa thể dựng nháp: timeline chưa có scene nào.",
            "blockers": ["empty-timeline"],
        })
    guard = resource_guard.can_start_heavy_job("DRAFT_RENDER")
    if not guard.get("allowed"):
        raise HTTPException(status_code=503, detail={"message": guard.get("reasonVi"), "action": guard.get("actionVi")})

    job = jobs_manager.create_job(
        "draft_render",
        project_id=dir_name,
        provider="ffmpeg",
        checkpoint={"stage": "rendering", "valid": True, "target": "draft_preview"}
    )
    
    def _run():
        jobs_manager.update_job(job["id"], status=JobStatus.RUNNING, progress=0.2, message="Đang kết xuất nháp 720p...")
        try:
            res = renderer_adapter.render_draft(pdir)
            out_p = str(res.get("outputPath") or pdir / "renders" / "draft" / "draft_preview.mp4")
            jobs_manager.update_job(
                job["id"],
                status=JobStatus.COMPLETED,
                progress=1.0,
                message="Kết xuất nháp hoàn tất!",
                artifact_refs=[out_p]
            )
        except Exception as e:
            logger.error(f"Draft render failed: {e}")
            jobs_manager.update_job(job["id"], status=JobStatus.FAILED, error=str(e), message="Kết xuất nháp thất bại")

    background_tasks.add_task(_run)
    return {"status": "QUEUED", "job": job}

@router.post("/api/projects/{dir_name}/render/final")
async def trigger_final_render(dir_name: str, request: Request):
    """Phase 8 manifest-driven Final Render (Draft path untouched).

    Body: {exportId, encoderProfile}. Routes ONLY through
    ManifestRenderService against the persisted export snapshot; never
    compiles a manifest implicitly and never calls legacy render_final().
    """
    from typing import Literal as _Literal
    from pydantic import BaseModel as _BaseModel
    from studio import jobs_manager as _jobs_module
    from studio.manifest_render_service import ManifestRenderService
    from studio.production_export import validate_export_id as _validate_export_id

    class FinalRenderRequest(_BaseModel):
        exportId: str
        encoderProfile: _Literal["FINAL_QUALITY", "ACCELERATED"] = "FINAL_QUALITY"

    _validate_dir_name(dir_name)
    pdir = _get_project_dir(dir_name)
    pre = production_preflight(pdir)
    if not pre.get("ok"):
        raise HTTPException(status_code=422, detail={
            "message": "Final render bị chặn bởi kiểm tra điều kiện xuất bản.",
            "blockers": pre.get("blockers", []),
            "readiness": pre.get("readiness", {}),
        })
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Yêu cầu render chính thức thiếu nội dung JSON.")
    try:
        req = FinalRenderRequest(**(payload or {}))
    except Exception:
        raise HTTPException(status_code=400, detail="encoderProfile phải là FINAL_QUALITY hoặc ACCELERATED.")
    try:
        export_id = _validate_export_id(req.exportId)
    except Exception:
        raise HTTPException(status_code=400, detail="exportId không hợp lệ.")
    service = _render_service_singleton()
    result = await service.start_final_render(
        project_id=dir_name, export_id=export_id,
        encoder_profile=req.encoderProfile)
    if result.get("errorCode") == "ALREADY_RENDERED":
        raise HTTPException(status_code=409, detail={
            "message": "Export này đã có final.mp4 chính thức (không ghi đè).",
            "finalPath": result.get("finalPath")})
    if result.get("errorCode"):
        raise HTTPException(status_code=422, detail={
            "message": result.get("message", "Không thể khởi chạy Final Render."),
            "errorCode": result.get("errorCode")})
    job = _jobs_module.jobs_manager.get_job(result["jobId"]) or {}
    return {"status": job.get("status", "QUEUED"), "job": {"id": result["jobId"], **job},
            "jobId": result["jobId"], "exportId": export_id,
            "encoderProfile": req.encoderProfile,
            "reused": bool(result.get("reused"))}


def _render_service_singleton():
    """Process-wide ManifestRenderService; rebuilt if PROJECTS_DIR moves (tests)."""
    from studio import jobs_manager as _jobs_module
    from studio.config import PROJECTS_DIR as _ROOT
    from studio.manifest_render_service import ManifestRenderService
    from studio.resource_scheduler import resource_scheduler as _sched
    cached = getattr(_render_service_singleton, "_instance", None)
    if cached is None or cached.projects_dir != _ROOT:
        cached = ManifestRenderService(projects_dir=_ROOT,
                                       jobs=_jobs_module.jobs_manager,
                                       scheduler=_sched)
        _render_service_singleton._instance = cached
    return cached


def _qa_service_singleton():
    """Process-wide RenderQaService; rebuilt if PROJECTS_DIR moves (tests)."""
    from studio import jobs_manager as _jobs_module
    from studio.config import PROJECTS_DIR as _ROOT
    from studio.render_qa_service import RenderQaService
    from studio.resource_scheduler import resource_scheduler as _sched
    cached = getattr(_qa_service_singleton, "_instance", None)
    if cached is None or cached.projects_dir != _ROOT:
        cached = RenderQaService(projects_dir=_ROOT,
                                 jobs=_jobs_module.jobs_manager,
                                 scheduler=_sched)
        _qa_service_singleton._instance = cached
    return cached


def _resolve_qa_export(project_id: str, export_id: str) -> Path:
    """Validate IDs and resolve the export dir server-side (no client paths)."""
    from studio.production_export import validate_export_id as _validate_export_id
    _validate_dir_name(project_id)
    try:
        clean_export = _validate_export_id(export_id)
    except Exception:
        raise HTTPException(status_code=400, detail="exportId không hợp lệ.")
    pdir = _get_project_dir(project_id)
    export_dir = pdir / "exports" / clean_export
    if not export_dir.is_dir():
        raise HTTPException(status_code=404, detail="Export không tồn tại.")
    return export_dir


class QaRerunRequest(BaseModel):
    mode: str = "MANUAL_RERUN"

    model_config = {"extra": "ignore"}


@router.post("/api/projects/{project_id}/exports/{export_id}/qa")
async def request_render_qa(project_id: str, export_id: str, req: QaRerunRequest):
    """Manual QA rerun: reuse active same-export QA job, else start new run."""
    export_dir = _resolve_qa_export(project_id, export_id)
    service = _qa_service_singleton()
    result = service.request_qa(
        project_id, export_dir.name,
        "MANUAL_RERUN" if (req.mode or "").upper() != "AUTOMATIC" else "AUTOMATIC")
    if result.get("errorCode"):
        raise HTTPException(status_code=422, detail={
            "message": result.get("message", "Không thể khởi chạy kiểm định."),
            "errorCode": result.get("errorCode")})
    job = jobs_manager.get_job(result["jobId"]) or {} if result.get("jobId") else {}
    return {"jobId": result.get("jobId"), "qaRunId": result.get("qaRunId"),
            "exportId": result.get("exportId"), "reused": bool(result.get("reused")),
            "status": job.get("status", "QUEUED"),
            "verdict": result.get("verdict")}


@router.get("/api/projects/{project_id}/exports/{export_id}/qa/latest")
async def get_render_qa_latest(project_id: str, export_id: str):
    """Latest committed QA summary for the export (404 when none)."""
    from studio.render_qa_report_store import RenderQaReportStore
    export_dir = _resolve_qa_export(project_id, export_id)
    latest = RenderQaReportStore().read_latest(export_dir)
    if latest is None:
        raise HTTPException(status_code=404, detail="Chưa có báo cáo kiểm định.")
    return latest


@router.get("/api/projects/{project_id}/exports/{export_id}/qa/runs")
async def list_render_qa_runs(project_id: str, export_id: str):
    """Immutable QA history summaries (newest last)."""
    from studio.render_qa_report_store import RenderQaReportStore
    export_dir = _resolve_qa_export(project_id, export_id)
    return {"exportId": export_dir.name,
            "runs": RenderQaReportStore().list_reports(export_dir)}


@router.get("/api/projects/{project_id}/exports/{export_id}/qa/runs/{qa_run_id}")
async def get_render_qa_run(project_id: str, export_id: str, qa_run_id: str):
    """Exact committed QA report. Scoped to the URL export; no file serving."""
    from studio.render_qa_report_store import RenderQaReportStore
    export_dir = _resolve_qa_export(project_id, export_id)
    try:
        report = RenderQaReportStore().read_report(export_dir, qa_run_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="qaRunId không hợp lệ.")
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Báo cáo kiểm định không tồn tại.")
    except OSError:
        raise HTTPException(status_code=404, detail="Báo cáo kiểm định không tồn tại.")
    return report




@router.get("/api/projects/{project_id}/exports/{export_id}/final/file")
async def get_export_final_file(project_id: str, export_id: str, download: int = 0):
    """Export-explicit canonical Final resolver (fixed final.mp4, no traversal)."""
    from studio.production_export import validate_export_id as _validate_export_id
    _validate_dir_name(project_id)
    try:
        clean_export = _validate_export_id(export_id)
    except Exception:
        raise HTTPException(status_code=400, detail="exportId không hợp lệ.")
    pdir = _get_project_dir(project_id)
    target = pdir / "exports" / clean_export / "final.mp4"
    try:
        target.resolve().relative_to(pdir.resolve())
    except ValueError:
        raise HTTPException(status_code=400, detail="Đường dẫn artifact không hợp lệ.")
    if not target.is_file():
        raise HTTPException(status_code=404, detail="Export này chưa có final.mp4 chính thức.")
    return FileResponse(
        path=str(target),
        media_type="video/mp4",
        filename=target.name,
        content_disposition_type="attachment" if download else "inline",
    )

@router.get("/api/projects/{dir_name}/render/status")
async def get_render_status(dir_name: str):
    pdir = _get_project_dir(dir_name)
    draft_p = pdir / "renders" / "draft" / "draft_preview.mp4"
    final_p = pdir / "renders" / "final" / "final.mp4"
    return {
        "hasDraft": draft_p.exists(),
        "draftPath": str(draft_p.relative_to(pdir)).replace("\\", "/") if draft_p.exists() else None,
        "draftSizeBytes": draft_p.stat().st_size if draft_p.exists() else 0,
        "hasFinal": final_p.exists(),
        "finalPath": str(final_p.relative_to(pdir)).replace("\\", "/") if final_p.exists() else None,
        "finalSizeBytes": final_p.stat().st_size if final_p.exists() else 0
    }

@router.get("/api/projects/{dir_name}/export/package")
async def get_export_package(dir_name: str):
    pdir = _get_project_dir(dir_name)
    export_dir = pdir / "exports"
    final_video = pdir / "renders" / "final" / "final.mp4"
    pkg = renderer_adapter.build_export_package(pdir, final_video)
    return pkg


# ---------------------------------------------------------------------------
# 10b. Export Readiness (Subphase 3D) — canonical preflight API for the
# Export Workbench UI. Reuses production_export.preflight(); no second rule set.
# ---------------------------------------------------------------------------

# Render output slots served by the safe media route below. Fixed filenames —
# the client can never request an arbitrary path (traversal impossible).
_RENDER_SLOTS = {
    "draft": ("renders", "draft", "draft_preview.mp4"),
    "final": ("renders", "final", "final.mp4"),
}

# Check metadata: Vietnamese label + workspace CTA. States come from
# production_export.preflight() verbatim (code identifiers stay English).
_READINESS_CHECKS = (
    ("audio", "Âm thanh master (audio.wav)", "voice", "Sang Giọng đọc"),
    ("voiceQa", "Kiểm định giọng đọc (Voice QA)", "voice-qa", "Sang kiểm âm"),
    ("timestamp", "Mốc thời gian (timestamps.json)", "voice", "Sang Giọng đọc"),
    ("subtitles", "Phụ đề (timestamps.srt)", "voice", "Sang Giọng đọc"),
    ("scenePlan", "Kế hoạch cảnh (scene_plan.json)", "scenes", "Sang Hình ảnh & Cảnh"),
    ("visualContinuity", "Liên tục hình ảnh (Visual Bible)", "scenes", "Sang Hình ảnh & Cảnh"),
    ("veo", "Prompt hình ảnh/chuyển động (Veo)", "scenes", "Sang Hình ảnh & Cảnh"),
)

_OPTIONAL_OK_STATES = {"READY"}


def _validate_dir_name(dir_name: str) -> str:
    """Reject path traversal / illegal names before touching the filesystem."""
    if not dir_name or not isinstance(dir_name, str):
        raise HTTPException(status_code=400, detail="Tên dự án không hợp lệ.")
    clean = dir_name.strip()
    if not clean or ".." in clean or "/" in clean or "\\" in clean:
        raise HTTPException(status_code=400, detail="Tên dự án không hợp lệ (path traversal).")
    return clean


# ---------------------------------------------------------------------------
# Phase 7: read-only Render Manifest preview (no side effects, no persist).
# ---------------------------------------------------------------------------

@router.get("/api/projects/{dir_name}/render-manifest")
async def get_render_manifest_preview(dir_name: str):
    """Preview the renderer-independent Render Manifest for a project.

    Read-only: compiles in memory, validates, returns manifest +
    validation. Never persists, never creates exportId.
    """
    from studio.timeline_compiler import compile_manifest_preview
    _validate_dir_name(dir_name)
    pdir = _get_project_dir(dir_name)
    result = compile_manifest_preview(pdir)
    return {
        "manifest": result.manifest.model_dump(mode="json"),
        "validation": result.validation.model_dump(mode="json"),
        "persisted": False,
    }


@router.get("/api/projects/{dir_name}/export/readiness")
async def get_export_readiness(dir_name: str):
    """Canonical Export Readiness: preflight checks + warnings + render + artifacts.

    Read-only. Business rules come from production_export.preflight();
    this endpoint only shapes them for the Export Workbench UI.
    """
    _validate_dir_name(dir_name)
    pdir = _get_project_dir(dir_name)
    pre = production_preflight(pdir)
    readiness = pre.get("readiness", {}) or {}

    srt_path = pdir / "timestamps.srt"
    srt_state = "READY" if srt_path.is_file() else "MISSING"

    draft_p = pdir / "renders" / "draft" / "draft_preview.mp4"
    final_p = pdir / "renders" / "final" / "final.mp4"
    has_draft, has_final = draft_p.is_file(), final_p.is_file()

    checks = []
    blockers: List[str] = []
    for cid, label, ws, cta in _READINESS_CHECKS:
        state = readiness.get(cid, srt_state if cid == "subtitles" else "MISSING")
        state = str(state or "MISSING").upper()
        ok = state in _OPTIONAL_OK_STATES
        if not ok:
            blockers.append(cid)
        checks.append({
            "id": cid,
            "label": label,
            "state": state,
            "ok": ok,
            "action": {"workspace": ws, "label": cta},
        })

    warnings = []
    if not has_draft:
        warnings.append({"id": "draft", "message": "Chưa có bản nháp 720p. Có thể kết xuất nháp trước để kiểm tra nhịp độ."})
    mp3_path = pdir / "audio.mp3"
    if not mp3_path.is_file():
        warnings.append({"id": "mp3", "message": "Chưa có bản MP3 nhẹ (tùy chọn). Bản WAV master vẫn đủ để kết xuất."})

    def _dl(kind: str) -> str:
        return f"/api/projects/{dir_name}/renders/{kind}/file?download=1"

    def _pv(kind: str) -> str:
        return f"/api/projects/{dir_name}/renders/{kind}/file"

    audio_path = pdir / "audio.wav"
    artifacts = [
        {"id": "audio.wav", "label": "Âm thanh master (WAV)", "kind": "audio",
         "exists": audio_path.is_file(),
         "sizeBytes": audio_path.stat().st_size if audio_path.is_file() else 0,
         "url": f"/api/projects/{dir_name}/audio/wav"},
        {"id": "timestamps.srt", "label": "Phụ đề (SRT)", "kind": "subtitle",
         "exists": srt_path.is_file(),
         "sizeBytes": srt_path.stat().st_size if srt_path.is_file() else 0,
         "url": f"/api/projects/{dir_name}/timestamps/srt"},
        {"id": "draft_preview.mp4", "label": "Bản nháp 720p (MP4)", "kind": "video",
         "exists": has_draft,
         "sizeBytes": draft_p.stat().st_size if has_draft else 0,
         "url": _dl("draft"), "previewUrl": _pv("draft")},
        {"id": "final.mp4", "label": "Bản chính thức 1080p (MP4)", "kind": "video",
         "exists": has_final,
         "sizeBytes": final_p.stat().st_size if has_final else 0,
         "url": _dl("final"), "previewUrl": _pv("final")},
    ]
    if mp3_path.is_file():
        artifacts.append({"id": "audio.mp3", "label": "Âm thanh nhẹ (MP3)", "kind": "audio",
                          "exists": True, "sizeBytes": mp3_path.stat().st_size,
                          "url": f"/api/projects/{dir_name}/audio/mp3"})

    ready = pre.get("ok", False) and len(blockers) == 0
    return {
        "project": dir_name,
        "status": "READY" if ready else "BLOCKED",
        "ready": ready,
        "checks": checks,
        "blockers": blockers,
        "rawBlockers": pre.get("blockers", []),
        "warnings": warnings,
        "render": {
            "hasDraft": has_draft,
            "hasFinal": has_final,
            "draftSizeBytes": draft_p.stat().st_size if has_draft else 0,
            "finalSizeBytes": final_p.stat().st_size if has_final else 0,
            "engine": "FFmpeg (H.264, CPU)",
        },
        "artifacts": artifacts,
        "sceneCount": pre.get("sceneCount", 0),
        "shotCount": pre.get("shotCount", 0),
    }


@router.get("/api/projects/{dir_name}/renders/{kind}/file")
async def get_render_media_file(dir_name: str, kind: str, download: int = 0):
    """Serve one fixed render output (draft/final preview or download).

    Security: `kind` is whitelisted, filenames are fixed server-side, the
    project dir is resolved server-side — no arbitrary paths, no traversal,
    no directory exposure. 404 JSON (Vietnamese) when the artifact is absent
    so the UI can show an empty state instead of a broken player.
    """
    _validate_dir_name(dir_name)
    slot = _RENDER_SLOTS.get((kind or "").lower())
    if slot is None:
        raise HTTPException(status_code=404, detail="Loại bản kết xuất không hợp lệ (chỉ draft/final).")
    pdir = _get_project_dir(dir_name)
    target = pdir.joinpath(*slot)
    # Belt-and-braces: resolved path must stay inside the project dir.
    try:
        target.resolve().relative_to(pdir.resolve())
    except ValueError:
        raise HTTPException(status_code=400, detail="Đường dẫn artifact không hợp lệ.")
    if not target.is_file():
        raise HTTPException(status_code=404, detail="Chưa có bản kết xuất. Hãy chạy kết xuất khi dự án đã sẵn sàng.")
    return FileResponse(
        path=str(target),
        media_type="video/mp4",
        filename=target.name,
        content_disposition_type="attachment" if download else "inline",
    )


# ---------------------------------------------------------------------------
# 10c. Asset Registry & Derivatives (Phase 4) — thumbnail / proxy / registry.
# No auto-generation on read: derivatives are built at intake or via the
# explicit repair endpoint below (§40). All paths resolved server-side.
# ---------------------------------------------------------------------------

def _resolve_registry_file(project_dir: Path, rel: Optional[str], kind: str) -> Path:
    if not rel:
        raise HTTPException(status_code=404, detail="Chưa có ảnh thu nhỏ cho tài nguyên này.")
    target = (project_dir / rel).resolve()
    try:
        target.relative_to(project_dir.resolve())
    except ValueError:
        raise HTTPException(status_code=400, detail="Đường dẫn tài nguyên không hợp lệ.")
    if not target.is_file():
        raise HTTPException(status_code=404, detail="Chưa có ảnh thu nhỏ cho tài nguyên này.")
    return target


@router.get("/api/projects/{dir_name}/assets/registry")
async def get_asset_registry(dir_name: str):
    """Read the 3-tier Asset Registry (master/proxy/thumbnail by stable asset_id)."""
    from studio.asset_registry import sync_from_intake_ledger
    _validate_dir_name(dir_name)
    pdir = _get_project_dir(dir_name)
    return sync_from_intake_ledger(pdir)


@router.get("/api/projects/{dir_name}/assets/{asset_id}/thumbnail")
async def get_asset_thumbnail(dir_name: str, asset_id: str):
    """Canonical thumbnail route: serves image/webp, never generates on read."""
    from studio.asset_registry import get_asset
    _validate_dir_name(dir_name)
    pdir = _get_project_dir(dir_name)
    entry = get_asset(pdir, asset_id)
    if entry is None:
        raise HTTPException(status_code=404, detail=f"Không tìm thấy tài nguyên: {asset_id}")
    target = _resolve_registry_file(pdir, entry.get("thumbnail"), "thumbnail")
    return FileResponse(path=str(target), media_type="image/webp",
                        filename=target.name, content_disposition_type="inline")


@router.get("/api/projects/{dir_name}/assets/{asset_id}/proxy")
async def get_asset_proxy(dir_name: str, asset_id: str, download: int = 0):
    """Serve the 720p proxy (video only). 404 JSON when absent or N/A."""
    from studio.asset_registry import get_asset
    _validate_dir_name(dir_name)
    pdir = _get_project_dir(dir_name)
    entry = get_asset(pdir, asset_id)
    if entry is None:
        raise HTTPException(status_code=404, detail=f"Không tìm thấy tài nguyên: {asset_id}")
    if not entry.get("proxy"):
        raise HTTPException(status_code=404, detail="Tài nguyên này không có bản xem trước nhẹ.")
    target = _resolve_registry_file(pdir, entry.get("proxy"), "proxy")
    return FileResponse(path=str(target), media_type="video/mp4",
                        filename=target.name,
                        content_disposition_type="attachment" if download else "inline")


class DerivativesRequest(BaseModel):
    kinds: List[str] = ["thumbnail", "proxy"]

    model_config = {"extra": "ignore"}


@router.post("/api/projects/{dir_name}/assets/{asset_id}/derivatives")
async def build_asset_derivatives(dir_name: str, asset_id: str, req: DerivativesRequest):
    """Explicit repair/generation of thumbnail/proxy for one stable asset_id.

    Runs synchronously (single asset, seconds-scale). Master preservation is
    verified by checksum; failures leave master + registry intact.
    """
    from studio.asset_registry import ensure_thumbnail, ensure_proxy
    _validate_dir_name(dir_name)
    pdir = _get_project_dir(dir_name)
    kinds = [str(k or "").lower() for k in (req.kinds or [])]
    bad = [k for k in kinds if k not in ("thumbnail", "proxy")]
    if bad:
        raise HTTPException(status_code=400, detail=f"Loại derived không hợp lệ: {bad}")
    results: Dict[str, Any] = {}
    try:
        if "thumbnail" in kinds:
            results["thumbnail"] = ensure_thumbnail(pdir, asset_id)
        if "proxy" in kinds:
            results["proxy"] = ensure_proxy(pdir, asset_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Không tìm thấy tài nguyên: {asset_id}")
    except (FileNotFoundError, ValueError, RuntimeError) as e:
        raise HTTPException(status_code=422, detail=f"Không thể tạo derived media: {e}")
    return {"asset_id": asset_id, "results": results}


# ---------------------------------------------------------------------------
# 10d. Portable Production Package (Phase 4).
# GET builds the ZIP off the event loop (IO-bound) then downloads it.
# Missing REQUIRED group => 422 blocker; optional groups are skipped + noted.
# ---------------------------------------------------------------------------

@router.get("/api/projects/{dir_name}/export/portable-package")
async def download_portable_package(dir_name: str):
    """Build + download the portable production package (10 component groups)."""
    from studio.portable_package import build_portable_package
    _validate_dir_name(dir_name)
    pdir = _get_project_dir(dir_name)
    try:
        result = await asyncio.to_thread(build_portable_package, pdir)
    except ValueError as e:
        raise HTTPException(status_code=422, detail={
            "message": f"Chưa thể đóng gói sản xuất: {e}",
            "project": dir_name,
        })
    except Exception as e:
        logger.exception(f"Portable package failed for {dir_name}: {e}")
        raise HTTPException(status_code=500, detail="Không thể tạo gói sản xuất.")
    zip_path = Path(result["zip_path"])
    return FileResponse(
        path=str(zip_path),
        media_type="application/zip",
        filename=zip_path.name,
        content_disposition_type="attachment",
    )
