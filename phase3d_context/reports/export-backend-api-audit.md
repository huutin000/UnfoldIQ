# Export Backend/API Audit (read-only, 2026-09-17, main @ af5274a)

## Bảng route hiện hữu liên quan Export/Render/Download

| Method | Route | Handler/function | Source file | Purpose | Frontend caller |
|---|---|---|---|---|---|
| POST | /api/projects/{dir}/render/draft | trigger_draft_render | studio/phase14_router.py:500 | Draft 720p: gate audio.wav + timeline (422), ResourceGuard 503, jobs_manager background task → renderer_adapter.render_draft | btn-trigger-draft-render → pollRenderJob |
| POST | /api/projects/{dir}/render/final | trigger_final_render | studio/phase14_router.py:552 | Final 1080p: bắt buộc production_preflight (422 + blockers/readiness), ResourceGuard 503, background task → render_final | btn-trigger-final-render → pollRenderJob |
| GET | /api/projects/{dir}/render/status | get_render_status | studio/phase14_router.py:594 | hasDraft/hasFinal + paths + sizes (tồn tại file) | loadExportData |
| GET | /api/projects/{dir}/export/package | get_export_package | studio/phase14_router.py:608 | build_export_package(final.mp4) | CHƯA có caller frontend (chỉ test) |
| GET | /api/projects/{dir}/render-state | get_project_render_state | studio/app.py:914 | Smart Render diagnostics (audio): RenderJobState + cache stats, read-only | panel Chi tiết progress (audio) |
| POST | /api/projects/{dir}/export | export_project_audio | studio/app.py:1248 | Export audio WAV/MP3 vào outputs/ | audio export UI (không phải video) |
| GET | /api/projects/{dir}/audio/{format} | (audio download) | studio/app.py | Tải audio giọng đọc | voice/audio UI |
| GET | /api/projects/{dir}/chunks/{id}/audio | (chunk audio) | studio/app.py | Tải audio từng chunk | voice QA |
| GET | /api/projects/{dir}/timestamps/srt | download_project_srt | studio/app.py:1944 | Tải timestamps.srt | editor/export |
| GET | /api/projects/{dir}/validation/readiness | get_validation_readiness | studio/app.py:3094 | Layered visual/external-validation readiness (visual_bible_v2). KHÔNG phải export readiness | validation UI |
| GET | /api/projects/{dir}/production/status | get_production_status | studio/app.py:3109 | Production readiness + counts + blockers + export history (read-only) | production card |
| POST | /api/projects/{dir}/production/export | run_production_export | studio/app.py:3128 | Snapshot export bất biến (422 + blockers khi fail; 409 khi project busy) | production export UI |
| POST | /api/projects/{dir}/production/exports/{id}/open | open_production_export_folder | studio/app.py:3155 | Mở folder exports/ trong Explorer local | production UI |
| GET | download_* (image_prompts/veo_prompts json/md) | download_project_* | studio/app.py | Tải prompt json/md | workbench download buttons |
| GET/POST | /api/jobs, /api/jobs/{id}[/events][/cancel] | jobs API | studio/app.py + jobs_manager | Job lifecycle dùng chung (render jobs) | pollRenderJob, activity tab |
| GET | /api/activity/jobs?projectId= | activity jobs | (jobs/activity module) | Poll progress render | pollRenderJob 2s |
| GET | /api/backup/download/{file} | backup download | studio/phase15a_router.py:101 | Tải .zip backup | backup UI |

## Capability hỏi — trả lời KHÔNG suy đoán

- `GET /api/projects/{id}/export/readiness` — **NOT FOUND IN CURRENT SOURCE** (gần nhất: `validation/readiness` của visual layer và `production/status`; không có export readiness endpoint riêng).
- Preflight service — **EXISTS IN CURRENT SOURCE**: `production_export.preflight()` (readiness audio/voiceQa/timestamp/scenePlan/visualContinuity/veo + blockers); final render tái dùng trực tiếp (phase14_router.py:557).
- Render scheduler integration — **EXISTS (partial)**: `resource_scheduler` (GPU_ENCODER concurrency=1, anti CUDA OOM) + `system_check.ResourceGuard.can_start_heavy_job` (draft/final gọi; 503 khi deny) + `jobs_manager` background tasks. Không có hàng đợi ưu tiên/scheduling UI riêng cho render.
- `GPU_ENCODER` — **EXISTS** as enum (`domain_models` + `resource_scheduler`); dùng cho guard/concurrency, KHÔNG phải encoder thật.
- NVENC → CPU fallback — **NOT FOUND IN CURRENT SOURCE** (renderer chỉ dùng `-c:v libx264`; không có `h264_nvenc` ở bất kỳ file nào).
- Legacy FFmpeg/render path — **EXISTS**: `renderer_adapter.FFmpegRenderer` (draft concat 720p ultrafast/crf28; final 1080p medium/crf18; fallback color card khi chưa có asset; timeout 60–360s).
- Media serving `/renders/*.mp4` — **NOT FOUND IN CURRENT SOURCE** (không route nào phục vụ; xem §11 legacy-export-audit).
- timestamps.vtt — **NOT FOUND** (chỉ .srt). Portable Package mới/Asset Registry/WebP/Proxy — **NOT FOUND** (Phase 4+).
