# Render Architecture — Current State (read-only, 2026-09-17, main @ af5274a)

## Module tồn tại thật

- `studio/renderer_adapter.py` — **EXISTS IN CURRENT SOURCE**: `FFmpegRenderer` (class duy nhất, `renderer_adapter` singleton dòng 392). Draft/final/export-package/review-issues như bảng backend audit. `ffmpeg_path` từ `studio/config.py`.
- `studio/production_export.py` — **EXISTS**: preflight + immutable snapshot export (33 defs; xem backend audit). Final render phụ thuộc preflight này.
- `studio/smart_render.py` — **EXISTS nhưng KHÁC DOMAIN**: TTS audio chunk planning/cache/resume (`RenderJobState` around `render_job.json`), KHÔNG phải video renderer. 3D không được nhầm lẫn hai “render” này.
- `studio/resource_scheduler.py` — **EXISTS**: `ResourceClass` (CUDA_HEAVY/GPU_ENCODER/CPU_BOUND/IO_BOUND), GPU_ENCODER concurrency=1, deny coexist VRAM 4GB.
- `studio/system_check.py` — **EXISTS**: `ResourceGuard.can_start_heavy_job()` (min disk 1000MB + heavy-job gate), diagnostics .zip.
- `studio/jobs_manager.py` — **EXISTS**: `jobs_manager` + `JobStatus`; render jobs chạy BackgroundTasks, frontend poll qua activity jobs.
- `studio/timeline_compiler.py` — **EXISTS**: `get_timeline()` (nguồn scenes/duration cho concat + draft gate).

## FFmpeg / codec

- **EXISTS**: `libx264` CPU ở mọi lệnh (`ultrafast/crf28` draft+clip, `medium/crf18` final, `yuv420p`, aac 128k/192k, 24fps, concat demuxer, image→clip qua `-loop 1`).
- NVENC (`h264_nvenc`/`hevc_nvenc`) — **NOT FOUND**. NVENC→CPU fallback — **NOT FOUND**. Mọi timeout subprocess 60–360s, chạy trong BackgroundTasks (không cancel giữa chừng ngoài jobs_manager CANCELLED flag).

## RenderJob / progress

- Video render jobs: `jobs_manager.create_job("draft_render"|"final_render", provider="ffmpeg")` + progress 0.2→1.0 + artifact_refs (phase14_router). **EXISTS**.
- `RenderJobState` (smart_render): audio-only resume state. **LEGACY / COMPATIBILITY** đối với 3D (không dùng cho video).
- Progress UI: `pollRenderJob` 2s + % trên nút + timeout 15 phút. **EXISTS** (frontend).

## Draft / Final render

- Draft 720p (`renders/draft/draft_preview.mp4`): gate audio.wav + timeline hợp lệ + guard; fallback color card `0x111827` khi chưa có visual asset. **EXISTS**.
- Final 1080p (`renders/final/final.mp4`): gate preflight chuẩn + guard; fallback color card `0x0b0f19`; xong thì `build_export_package` vào `exports/`. **EXISTS**.
- Preview serving 2 file trên qua HTTP API: **NOT FOUND** (gap cho 3D).

## Không nhầm roadmap với implementation

- Render Manifest / Timeline Compiler (Phase 7), Manifest-driven FFmpeg renderer (Phase 8), Automated Render QA (Phase 9), Asset Registry / WebP / Proxy 720p / Portable Package (Phase 4): **PLANNED ONLY** — không code trong source hiện tại. 3D chỉ làm **Export Workbench UI (Preflight & Triggers)** trên nền API đã có, không được lấn các phase trên.
