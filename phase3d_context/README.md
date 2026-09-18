# UnfoldIQ Phase 3D Source Context

> Package chỉ-đọc phục vụ review/viết implementation prompt cho **Subphase 3D — Export Workbench UI (Preflight & Triggers)**. Không implement, không sửa source.

## Repository
- Repo path: `D:\Project\UnfoldIQ` (repo thực tế đã dùng; `D:\Project\UnfoldIQ\upstream\kokoro-fastapi` là service TTS phụ, không chứa Workstation source `studio/` nên không phù hợp)
- Branch: `main`
- HEAD: `af5274a` — `docs(3C): add implementation report, technical docs, update ROADMAP_STATUS to PASS/FINAL`
- Current worktree clean?: **NO** — có thay đổi chưa commit (ghi nhận nguyên trạng, không động tới):
  - `M studio/app.py, studio/domain_models.py, studio/project_adapter.py, studio/static/app.js` (3C gap-closure đã verify 566/566, chờ commit/review)
  - `M docs/implementation/PHASE_03C_VISUAL_WORKBENCH.md, ROADMAP_STATUS.md` (3C: `IMPLEMENTED / REVIEW PENDING`)
  - `D docs/UNFOLDIQ-PHASE03A-FINAL-MINOR-CONSISTENCY-A11Y-FIX-PROMPT.md` — **entry delete bất thường**: file prompt tài liệu Phase 3A bị xóa ở worktree (unstaged). Tác vụ này KHÔNG gây ra (không chạm file này) và KHÔNG restore theo chỉ thị; reviewer lưu ý kiểm tra riêng.
  - `??` 3C mới: 2 báo cáo verification/closure, `studio/visual_router.py`, `studio/visual_invalidation.py`, `tests/test_phase03c_gap_closure.py`, 3 script evidence/browser.
- Package lấy **working-tree version hiện tại** cho mọi file liên quan 3D (đúng §12).

## Current governance
- 3C đã được external review bên ngoài và được coi là:
  PASS / FINAL / VERIFIED
- 3D:
  READY TO START / NOT STARTED

Lưu ý:
ROADMAP_STATUS trong repo có thể vẫn chưa được đồng bộ và còn ghi
3C IMPLEMENTED / REVIEW PENDING.
Không dùng trạng thái cũ này để mở lại 3C.

## Export implementation found
- Existing Export UI: **CÓ** — `#ws-export` (“Xuất bản video cuối cùng”, Phase 14): readiness box, 2 render cards (draft 720p / final 1080p), 2 video preview, deliverables checklist; xem `reports/legacy-export-audit.md`
- Existing preflight: **CÓ (backend)** — `production_export.preflight()` (audio/voiceQa/timestamp/scenePlan/visualContinuity/veo + blockers); final render bắt buộc qua; frontend chỉ hiển thị blocker 422, chưa có preflight panel riêng
- Existing render trigger: **CÓ** — `POST render/draft` (gate audio+timeline, 422/503), `POST render/final` (gate preflight, 422/503), jobs nền + poll 2s/timeout 15p
- Existing render status: **CÓ** — `GET render/status` (hasDraft/hasFinal/paths/sizes) + activity jobs progress
- Existing downloads: **CÓ (rải rác)** — audio wav/mp3, chunks, timestamps.srt, prompts json/md, backup .zip, `exports/{id}/open`; **KHÔNG** có download final.mp4/package qua HTTP trong Export UI
- Existing preview: **NỬA VỜI** — `<video>` + gán src `/renders/draft|final/*.mp4` khi has* true, nhưng **backend không có route phục vụ 2 path này** (0 match toàn studio/) → gap thật cho 3D
- Existing FFmpeg path: **CÓ (CPU-only)** — `FFmpegRenderer`: draft concat 720p ultrafast/crf28, final 1080p medium/crf18, fallback color card khi chưa có asset; **không NVENC, không fallback chain**
- Existing scheduler integration: **CÓ (một phần)** — ResourceGuard `can_start_heavy_job` (draft/final gọi) + GPU_ENCODER concurrency=1 (enum/guard, không phải encoder) + jobs_manager; không scheduling UI riêng

## Known observation to verify
- `renders/final/final.mp4` 404 when no final render exists
- `renders/draft/draft_preview.mp4` 404 when no draft render exists
- **Kết luận source**: ĐÚNG — đây là Export behavior hiện tại có căn cứ: frontend (`phase14_ui.js:543,550`) trỏ tới 2 path mà backend **không có route nào phục vụ** (verified 0 match `renders` trong `studio/app.py`, không `:path` catch-all, chỉ mount static frontend). Khi chưa render, Export UI ẩn player nên không tự 404; request 404 quan sát ở browser closure 3C đến từ code gán src khi `has*` true trong điều kiện file vắng. 3D cần quyết định: thêm media/download route đúng chuẩn hoặc đổi cơ chế preview.

## Files copied
Xem `source/` (giữ nguyên relative structure, working-tree versions):
- `studio/app.py`, `studio/phase14_router.py`, `studio/project_adapter.py`, `studio/domain_models.py`, `studio/config.py`
- `studio/renderer_adapter.py`, `studio/production_export.py`, `studio/smart_render.py`, `studio/resource_scheduler.py`, `studio/system_check.py`, `studio/jobs_manager.py`, `studio/timeline_compiler.py`
- `studio/static/index.html`, `studio/static/app.js`, `studio/static/phase14_ui.js`, `studio/static/style.css`, `studio/static/uq-components.css`, `studio/static/uq-responsive.css`, `studio/static/uq-screens.css`
- `tests/test_phase14.py`, `tests/test_phase14_api.py`, `tests/test_production_export.py`, `tests/test_smart_render.py`
- `docs/implementation/ROADMAP_STATUS.md`, `docs/implementation/PHASE_03C_BROWSER_CLOSURE_REPORT.md` (governance context)
- Tổng 25 files. Không copy secrets/media theo §11 (đã Sweep: không phát hiện credential trong file được chọn; không có giá trị nào cần [REDACTED]).

## Files intentionally excluded
Secrets (.env/tokens), `.git`, `.venv/venv/node_modules`, `projects/` (production data + state.db), `temp/`, `renders/`, `models/` (weights), `cache/`, media (*.mp4/*.wav/*.mp3/*.png/*.jpg/*.webp...), `upstream/` (service ngoài scope), toàn bộ phần còn lại của repo không liên quan Export/Render.

## Open questions for Phase 3D
Chỉ liệt kê câu hỏi thực sự không thể trả lời từ source:
1. 3D có được phép thêm route phục vụ media (`/renders/*`) hay phải dùng cơ chế download/FileResponse mới? (route hiện không tồn tại; quyết định thiết kế)
2. Preflight panel của 3D tái dùng `production_export.preflight()` nguyên trạng hay tách `GET export/readiness` riêng? (endpoint riêng hiện NOT FOUND)
3. Có đưa NVENC vào 3D không, hay giữ CPU-only và để Phase 8? (hiện NOT FOUND; roadmap Phase 8 mới refactor renderer)
4. `GET export/package` đã có nhưng frontend chưa gọi — 3D có wire nút download package không, hay để Phase 4 Portable Package? (ranh giới 3D/Phase 4)
5. Test `test_no_3d_export_workbench_implemented` (khẳng định không có route export-workbench/preflight) sẽ phải update khi 3D thêm route — ai sở hữu thay đổi test này?
