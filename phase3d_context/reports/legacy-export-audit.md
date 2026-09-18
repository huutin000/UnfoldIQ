# Legacy Export Workbench Audit (read-only, 2026-09-17, main @ af5274a)

Nguồn: `studio/static/index.html` (§ ws-export, dòng ~1553–1621), `studio/static/phase14_ui.js` (§6 Export Workspace + § render buttons/polling), `studio/static/app.js` (switchWorkspace hook), CSS export rules.

## 1. Export Workbench hiện nằm ở đâu
- Section `#ws-export` trong `index.html`, class `workspace-view`, tiêu đề “Xuất bản video cuối cùng” (Phase 14). Vào qua sidebar/stepper `switchWorkspace('export')` → `Phase14.handleWorkspaceSwitch('export')` → `loadExportData()` (phase14_ui.js:1215–1227; app.js:1245 gọi hook).

## 2. Workspace/container ID hiện tại
- View: `#ws-export`. Vùng trạng thái: `#export-readiness-box` (aria-live polite). Cards: `.export-card-grid` > `.render-action-card` ×2. Players: `#draft-render-player-container` > `video#draft-video-player`; `#final-render-player-container` > `video#final-video-player`. Gói bàn giao: `#export-deliverables-box` (display:none cho tới khi hasFinal). Nút: `#btn-trigger-draft-render`, `#btn-trigger-final-render`.

## 3. Function JS load/render Export
- `loadExportData(projectDir)` (phase14_ui.js:513): fetch `GET render/status` → set video src khi hasDraft/hasFinal → render readinessBox (success/warning/not-ready) → ẩn/hiện deliverables.
- `pollRenderJob(jobId, projectDir, btn, restoreText, kind)` (phase14_ui.js:958): poll `GET /api/activity/jobs?projectId=` mỗi 2s, cập nhật % lên nút, SUCCESS→reload export data, FAILED→toast, timeout 15 phút.
- `renderBlockerText(res, fallback)` (phase14_ui.js:943): parse blocker 422 hiển thị tiếng Việt.
- Render Draft/Final click handlers (phase14_ui.js:999–1040): POST tương ứng → `pollRenderJob`.

## 4. API frontend đang gọi
- `GET /api/projects/{p}/render/status`
- `POST /api/projects/{p}/render/draft`, `POST /api/projects/{p}/render/final`
- `GET /api/activity/jobs?projectId={p}` (polling)
- Media src trực tiếp: `/api/projects/{p}/renders/draft/draft_preview.mp4?t=`, `/api/projects/{p}/renders/final/final.mp4?t=`

## 5. Nút render hiện có
- `#btn-trigger-draft-render` “Kết xuất bản nháp 720p” (secondary), `#btn-trigger-final-render` “Kết xuất video chính thức” (primary). Disable + % progress trong lúc chạy, restore text khi xong.

## 6. Nút/download artifact hiện có
- Trong `#ws-export`: KHÔNG có nút download file (chỉ checklist tĩnh `exports/` liệt kê final.mp4/subtitles.srt/sources.md/description.txt/metadata.json). Download tồn tại ở nơi khác: audio/srt/prompts (app.py download_*), backup .zip (phase15a), `exports/{id}/open` (mở folder local). Export package qua `GET export/package` chưa được frontend gọi (chỉ test gọi).

## 7. Preview draft/final hiện tại
- `<video controls>` nhận src khi `hasDraft`/`hasFinal`. Khi chưa có file: container giữ `display:none` → không 404 từ chính Export UI; tuy nhiên request preview vẫn 404 ở nơi khác nếu src gán khi file vắng (đã quan sát ở browser closure 3C).

## 8. Logic polling render status
- `pollRenderJob`: 2s/tick qua activity jobs, không setTimeout mù; nút hiện %; toast Việt success/fail; timeout 15 phút → warning “kiểm tra tab Hoạt động”.

## 9. Loading / empty / error state hiện tại
- Không project: `noProjectHtml()`. Chưa có render: `setNotReady` (“Chưa thể xuất video… Kết xuất bản nháp trước”). Lỗi fetch: `loadErrorHtml` + nút “Tải lại trạng thái”. 404 render/status → not-ready message (isNotFound branch). Đầy đủ, tiếng Việt.

## 10. Raw English labels còn tồn tại
- Gần như không: UI export tiếng Việt toàn diện. Còn lại là status kỹ thuật qua I18N (`status-ready/partial`), badge “720p Siêu tốc/1080p Full HD”, tên file kỹ thuật (final.mp4, subtitles.srt…), và comment code tiếng Anh. Không phát hiện raw English user-facing cần 3D dọn (verify lại khi implement).

## 11. Request renders/*.mp4 kích hoạt ở đâu
- `loadExportData` phase14_ui.js:543 (`draftVideo.src = .../renders/draft/draft_preview.mp4`) và :550 (`finalVideo.src = .../renders/final/final.mp4`), chỉ khi `data.hasDraft/hasFinal` true. **Backend KHÔNG có route phục vụ 2 path này** (search toàn studio/*.py: 0 match) → request luôn 404 ở tầng HTTP hiện tại trừ khi static/proxy ngoài phục vụ. Đây là gap thật mà 3D cần quyết định (thêm media route hoặc đổi cơ chế preview/download).
