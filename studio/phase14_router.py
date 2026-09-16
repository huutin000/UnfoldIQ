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
from pathlib import Path
from typing import Dict, Any, Optional, List

from fastapi import APIRouter, HTTPException, UploadFile, File, Form, BackgroundTasks
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
async def trigger_final_render(dir_name: str, background_tasks: BackgroundTasks):
    # P0 (§2 FINAL-GAPS): Final Render bắt buộc qua cùng preflight chuẩn với
    # production/export. Preflight FAIL → không render, trả blocker rõ ràng (422).
    pdir = _get_project_dir(dir_name)
    pre = production_preflight(pdir)
    if not pre.get("ok"):
        raise HTTPException(status_code=422, detail={
            "message": "Final render bị chặn bởi kiểm tra điều kiện xuất bản.",
            "blockers": pre.get("blockers", []),
            "readiness": pre.get("readiness", {}),
        })
    guard = resource_guard.can_start_heavy_job("FINAL_RENDER")
    if not guard.get("allowed"):
        raise HTTPException(status_code=503, detail={"message": guard.get("reasonVi"), "action": guard.get("actionVi")})

    job = jobs_manager.create_job(
        "final_render",
        project_id=dir_name,
        provider="ffmpeg",
        checkpoint={"stage": "rendering", "valid": True, "target": "final_master"}
    )
    
    def _run():
        jobs_manager.update_job(job["id"], status=JobStatus.RUNNING, progress=0.2, message="Đang kết xuất bản chính 1080p Master...")
        try:
            res = renderer_adapter.render_final(pdir)
            out_p = str(res.get("outputPath") or pdir / "renders" / "final" / "final.mp4")
            jobs_manager.update_job(
                job["id"],
                status=JobStatus.COMPLETED,
                progress=1.0,
                message="Kết xuất video chính thức thành công!",
                artifact_refs=[out_p]
            )
        except Exception as e:
            logger.error(f"Final render failed: {e}")
            jobs_manager.update_job(job["id"], status=JobStatus.FAILED, error=str(e), message="Kết xuất thất bại")

    background_tasks.add_task(_run)
    return {"status": "QUEUED", "job": job}

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
