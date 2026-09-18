# PHASE_03D_IMPLEMENTATION_REPORT.md
# BÁO CÁO TRIỂN KHAI SUBPHASE 3D — EXPORT WORKBENCH UI

> Phân kỳ: Subphase 3D — Export Workbench UI (Preflight & Triggers)
> Ngày: 2026-09-17
> Branch: main
> HEAD trước: af5274a (`docs(3C): add implementation report, technical docs, update ROADMAP_STATUS to PASS/FINAL`)
> HEAD sau: af5274a (không commit mới trong task — toàn bộ 3D nằm ở worktree, chờ external review)
> Baseline regression: 566 / 566 PASS
> Final regression: 581 / 566+15 PASS (0 failed, 0 errors)
> Verdict: SUBPHASE 3D: IMPLEMENTED / REVIEW PENDING — READY FOR EXTERNAL REVIEW (KHÔNG tự PASS/FINAL)

## 1. Executive Summary

Subphase 3D xây dựng Export Workbench local-first, Vietnamese-first trên đúng capability hiện có: canonical readiness API mới reuse 100% business rule `production_export.preflight()`; preflight UI checklist với blocker/warning/CTA; giữ nguyên render draft/final + polling, bổ sung guard (final disabled khi còn blocker, chống duplicate poll, chống stale cross-project); preview mp4 qua route an toàn mới (chấm dứt blind 404); downloads chỉ cho artifact đã tồn tại; 15 focused tests mới, full regression 581/581, browser Chrome thật 3 viewports PASS (0 console error, 0 failed XHR, 0 5xx). Không Phase 4+ nào bị chạm. Dữ liệu tham chiếu nguyên vẹn.

## 2. Git / Checkpoint
- Preflight ghi nhận: worktree DIRTY trước task gồm (a) 3C gap-closure changes (`M studio/app.py, domain_models.py, project_adapter.py, static/app.js` + untracked router/invalidation/tests/scripts/reports), (b) docs-cleanup deletions (18 files whitelist + 1 pre-existing), (c) untracked `phase3d_context/`, `docs_cleanup_backup/`. Tất cả được bảo toàn, không restore/sửa.
- Vì worktree không sạch nên KHÔNG tạo tag `pre-phase-3d` (không bịa checkpoint). Thay thế: HEAD `af5274a` + git status snapshot trong report này là baseline tham chiếu.
- Files changed by 3D (worktree): `studio/phase14_router.py` (+2 endpoints), `studio/static/phase14_ui.js` (Export Workbench rewrite có giữ API), `tests/test_phase03d_export_workbench.py` (mới, 15 tests), `scripts/verify_phase03d_browser.py` (mới, công cụ evidence), `docs/implementation/ROADMAP_STATUS.md` (governance sync 2.3.0→2.3.1), report này.

## 3. Source Audit
- Legacy Export UI: `#ws-export` + `Phase14.loadExportData` + 2 nút render + polling `pollRenderJob` + video preview gán src trực tiếp (phase14_ui.js, index.html). Vietnamese-first sẵn.
- Existing render path: `FFmpegRenderer` (draft concat 720p ultrafast/crf28; final 1080p medium/crf18; fallback color card) qua `POST render/draft|final` + `jobs_manager` + `ResourceGuard` + `production_preflight` gate cho final.
- Existing preflight: `production_export.preflight()` → `{ok, blockers, readiness{audio,voiceQa,timestamp,scenePlan,visualContinuity,veo}, sceneCount, shotCount, voiceQa}`. Không có warnings (mọi thiếu sót = blocker) — 3D derive warnings cho optional (draft/mp3) mà không sửa business rule.
- Download/preview paths: audio wav/mp3, timestamps.srt, prompts json/md có route; **`renders/draft|final/*.mp4` KHÔNG có route nào phục vụ** (verified 0 match) → nguyên nhân 404 ở browser closure 3C.
- Renderer capability: libx264 CPU-only; NVENC/VTT/portable/registry/proxy/webp/manifest: NOT FOUND (đúng scope, không implement).

## 4. Export Readiness API
- Route: `GET /api/projects/{dir_name}/export/readiness` (studio/phase14_router.py). Read-only.
- Schema: `{project, status: READY|BLOCKED, ready, checks[{id,label,state,ok,action{workspace,label}}], blockers[checkIds], rawBlockers, warnings[{id,message}], render{hasDraft,hasFinal,sizes,engine}, artifacts[{id,label,kind,exists,sizeBytes,url[,previewUrl]}], sceneCount, shotCount}`.
- Reuse: 100% `production_preflight()`; không bộ rule thứ hai. Checks ánh xạ 1-1 readiness keys + `subtitles` (srt, blocker theo preflight) + render outputs (warning/info).
- Phân biệt: blocker (required, từ preflight) / warning (draft/mp3 optional) / ready / missing-optional / missing-required. Không nâng optional thành blocker.
- Raw enum (READY/BLOCKED/...) chỉ nằm trong JSON code identifiers; UI map qua từ điển Việt (§10).

## 5. Export Workbench UI
- Layout giữ App Shell/IA: `#ws-export` “Xuất video”; main = preflight checklist “Kiểm tra trước khi xuất (Preflight)” + summary; secondary = render cards + status + preview + downloads artifact. Không navigation mới, không phá 3A/3B/3C.
- Vietnamese-first theo glossary: Xuất video, Kiểm tra trước khi xuất, Kết xuất bản nháp/chính thức, Tải xuống, Thử lại, Sẵn sàng/Bị chặn/Thất bại/Đang chờ/Đang kết xuất/Hoàn tất/Đã hủy; giữ FFmpeg/H.264/CPU/MP4/WAV/SRT/JSON. Không đổi API/schema/enum/routes để Việt hóa.

## 6. Render Triggers
- Reuse: Draft (`POST render/draft`) + Final (`POST render/final`) giữ nguyên capability, CTA tiếng Việt tự nhiên (“Kết xuất bản nháp 720p”, “Kết xuất video chính thức”).
- Guards: final disabled + tooltip khi còn blocker (cả lúc load qua `applyExportGuards` và tại click qua snapshot readiness — không trigger ngầm); draft disabled khi thiếu audio master. Warning không blocker vẫn cho render (đúng contract hiện tại). Không modal destructive mới.
- Scheduler/job integration: giữ `jobs_manager` + `ResourceGuard` (422/503 hiển thị tiếng Việt qua `renderBlockerText`).

## 7. Render Status / Progress
- Reuse `pollRenderJob` (poll `/api/activity/jobs` 2s, % trên nút, timeout 15p). 3D bổ sung: single-loop guard (`exportActivePolls` theo project+kind), dừng khi đổi project (chống timer leak), map trạng thái Việt (Đang chờ/Đang kết xuất/Hoàn tất/Thất bại/Đã hủy), FAILED hiển thị message Việt + nút restore-text chính là **Thử lại**. Không poll theo animation tick, không duplicate loop.

## 8. Preview Handling
- Audit: legacy gán `video.src` tới path không có handler → 404 ồn ào (đúng quan sát 3C closure).
- Fix: route an toàn mới `GET /renders/{kind}/file` (kind whitelist draft/final, filename cố định server-side, validate project, traversal-proof, `inline` preview / `?download=1` attachment, 404 JSON Việt khi absent). Frontend chỉ gán src khi `hasDraft/hasFinal` từ status API + empty state “Chưa có bản kết xuất. Hãy chạy kết xuất khi dự án đã sẵn sàng.”
- Verified browser: players load qua safe routes, **0 preview 404 mới** (console_errors=0, trong khi đợt 3C còn 2).
- Không mount directory rộng.

## 9. Artifact Downloads
- Chỉ artifact đã tồn tại: audio.wav, timestamps.srt, draft_preview.mp4, final.mp4 (+audio.mp3 nếu có), mỗi mục có size MB + nút “Tải xuống” (`download` attr) + engine note “Kết xuất bằng FFmpeg (H.264, CPU)” trung thực. VTT/Portable ZIP/package mới: KHÔNG implement (Phase 4). Không card “Coming soon”.

## 10. Accessibility
- Native `<button>`, visible text làm accessible name (không aria-label thừa); `#export-readiness-box` giữ `aria-live="polite"`; checklist `role="list"` + `aria-label` Việt; trạng thái badge có text (✓/✕ + chữ, không chỉ màu); progress % là text trên nút; keyboard hoàn thành core workflow (Tab/Enter native). Không role phức tạp giả.

## 11. Loading / Empty / Error / Recovery
- Loading: “Đang kiểm tra điều kiện xuất...”. Empty: “Chưa có bản kết xuất.” Blocked: “Chưa thể kết xuất video chính thức vì còn N mục kiểm tra chưa đạt.” Error: “Không tải được trạng thái xuất video.” + “Thử lại” (loadErrorHtml). 404 render/status → not-ready message. Không blank panel, không traceback.

## 12. Project Switching / Async Safety
- Đổi project: `exportLoadToken` hủy stale response (mọi await đều check), `clearExportPlayers()` xóa preview project cũ ngay, poll dừng khi `getActiveProject()` đổi, download links render lại theo project mới. Verified browser: switch qua 5 workbench không stale, smoke non-blank.

## 13. Security
- Media routes: kind whitelist + filename cố định + resolve trong project dir + `relative_to` check + validate `..`/`/` trong dir_name (400) + 404 Việt khi absent + đúng `video/mp4` (+attachment khi download). Không expose `.env`/DB/tree, không leak absolute path nhạy cảm (artifact url chỉ là route). Test traversal (`../`, kind lạ) → 400/404.

## 14. Tests
- Mới `tests/test_phase03d_export_workbench.py`: 15/15 PASS — readiness schema, BLOCKED reference (visual/veo STALE thật), READY fixture (heal hash chains trên temp copy, 7/7 READY), warnings≠blockers, mp3 optional, audio-required blocker, final 422 guard, job vocabulary, downloads 200, preview 404-JSON, preview mp4 200 + attachment, isolation 2 copies, path safety, legacy compat, frontend contract (readiness/preview/guard/poll markers + không còn legacy mp4 path).

## 15. Full Regression
- `python -m pytest --tb=short -q`: **581 / 581 PASS, 0 failed, 0 errors** (~76s). Baseline 566 + 15 mới. Không xóa/sửa test cũ (guard `test_no_3d_export_workbench_implemented` vẫn xanh vì route mới không chứa substring cấm).

## 16. Browser Validation
- App thật `uvicorn :7860` + Chrome CDP (`scripts/verify_phase03d_browser.py`): 1920×1080 / 1440×900 / 1366×768 đều PASS (preflight render, final disabled khi blocked, players qua safe routes, downloads hiện).
- Workflow: mở project → Xuất video → readiness/blockers/artifacts → preview có sẵn → guard trigger → chuyển project → smoke 3A/3B/3C non-blank.
- Console: 0 errors, 0 unhandled rejections. Network: 0 failed XHR/fetch phi-media, 0 5xx. Không duplicate polling, không probe 404, không stale cross-project.
- Evidence: `temp/phase03d_verification/browser/{screenshots×3,manual_viewport_3d.json,manual_console_3d.json,manual_network_3d.json,run_summary_3d.json}` + `tests/pytest_full_3d.log`. Không bịa screenshot/perf.

## 17. Data Integrity
- Browser run: `veo_prompts.json` sha256 trước/sau identical; không trigger render thật, không save nào. Mở/refresh Export UI không mutate script/beats/audio/timestamps/cues/pronunciation/voiceQA/scene/shots/IDs/Bible/prompts/locks/revisions/state.db. Stable IDs nguyên vẹn.

## 18. Scope Audit
Explicitly confirm NOT implemented: Phase 4 (Asset Registry/Thumbnail/Proxy/Portable Package/benchmark/refactor), Phase 5 (Palette/consolidation/virtualization), Phase 6 full hardening (chỉ không tạo regression hiển nhiên), Phase 7 (manifest/compiler), Phase 8 (manifest engine/NVENC), Phase 9 (ffprobe QA), localization, Flow/Veo automation, timeline editor/Remotion. Renderer/data model/schema/API ngoài 2 endpoints mới: không đổi.

## 19. Defects Found / Fixes
1. Preview paths không có backend route (root cause 404 ồn ào) → thêm 2 safe media routes + frontend chỉ gắn src khi exists. 2. Nút Final không guard ở UI → disabled + click-time snapshot guard. 3. Poll có thể duplicate/stale → single-loop + project guard. 4. Đổi project giữ preview cũ → clear + token. Tất cả fix trong scope 3D, có test.

## 20. Open Issues / Known Limitations
- Reference project honestly BLOCKED (visualContinuity + veo STALE sau edits 3C) — đúng business, không phải defect 3D; UI hiển thị + CTA sang Hình ảnh & Cảnh.
- Guide tour popup (“Bước 1/3”) phủ lần đầu vào export workspace — hành vi onboarding kỳ vọng, dismiss được, không chặn validation.
- `GET export/package` vẫn chưa có caller frontend (giữ nguyên cho Phase 4 quyết định).
- Không tạo tag `pre-phase-3d` vì worktree dirty (ghi nhận thay vì bịa).

## 21. Files Changed
- `studio/phase14_router.py`: +`GET export/readiness`, +`GET renders/{kind}/file`, helpers `_RENDER_SLOTS/_READINESS_CHECKS/_validate_dir_name` (~150 dòng).
- `studio/static/phase14_ui.js`: rewrite `loadExportData` + helpers preflight/guards/previews/downloads, `pollRenderJob` guards, click-time final guard (~200 dòng).
- `tests/test_phase03d_export_workbench.py`: mới (15 tests).
- `scripts/verify_phase03d_browser.py`: mới (công cụ evidence).
- `docs/implementation/ROADMAP_STATUS.md`: 2.3.0→2.3.1 (3C VERIFIED + 3D IMPLEMENTED/REVIEW PENDING).
- Report này. Không chạm 3A/3B/3C source, schema, data model.

## 22. Final Gate Matrix
| Gate | Requirement | Result |
|---|---|---|
| A | Git/source baseline audited | PASS (HEAD af5274a + status snapshot; no fabricated tag) |
| B | 3C remains PASS/FINAL/VERIFIED | PASS (3C source untouched; roadmap synced) |
| C | Canonical readiness API implemented/reused | PASS (reuses preflight, schema evidenced) |
| D | Preflight blocker/warning UI correct | PASS (7 checks, CTAs, browser shot) |
| E | Existing render trigger preserved | PASS (draft+final intact, 422/503 Vi) |
| F | Final render guarded by readiness | PASS (disabled + click guard + backend 422 test) |
| G | Render status/progress usable | PASS (single-loop poll, Vi labels, retry) |
| H | Missing preview handled without noisy blind 404 | PASS (safe routes + exists-gated src; 0 console errors) |
| I | Existing artifact downloads usable | PASS (4 artifacts + sizes, existing-only) |
| J | Vietnamese-first UI policy | PASS (glossary-mapped, no raw enum) |
| K | Accessibility basics | PASS (native buttons, live region, text statuses) |
| L | Project switching/async safety | PASS (token + clear + poll-stop, smoke PASS) |
| M | File-serving security | PASS (whitelist + traversal tests) |
| N | Browser 3 viewports usable | PASS (3/3 screenshots) |
| O | Console/network clean | PASS (0/0/0) |
| P | Data integrity | PASS (hash unchanged, no mutations) |
| Q | Full regression 100% | PASS (581/581) |
| R | Phase 4+ remains NOT STARTED | PASS (no routes/code for 4–9) |

## 23. Final Verdict
```text
SUBPHASE 3D: IMPLEMENTED / REVIEW PENDING
READY FOR EXTERNAL REVIEW
```
(KHÔNG tự PASS/FINAL — chờ external review. Không start Phase 4.)
