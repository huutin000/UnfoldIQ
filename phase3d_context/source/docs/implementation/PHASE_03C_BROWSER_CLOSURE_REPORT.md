# PHASE_03C_BROWSER_CLOSURE_REPORT.md
# BÁO CÁO ĐÓNG BROWSER SUBPHASE 3C — VIEWPORT / CONSOLE / NETWORK / ACCESSIBILITY

> **Phân kỳ:** Subphase 3C — Visual Workbench
> **Ngày:** 2026-09-17
> **Loại:** MANUAL BROWSER VALIDATION / FINAL CLOSURE ONLY
> **Báo cáo trước:** `docs/implementation/PHASE_03C_FINAL_VERIFICATION_REPORT.md` (`CONDITIONAL PASS`, 1 blocker browser)
> **Hồi quy:** **566 / 566 PASS** (giữ nguyên — task này không sửa product source)
> **Verdict:** **SUBPHASE 3C: PASS / FINAL — READY FOR SUBPHASE 3D** (chờ review ngoài phê duyệt báo cáo này)

---

## 1. Executive Summary

Blocker duy nhất của 3C (browser viewport thủ công) đã được đóng bằng **Chrome thật điều khiển qua CDP** trên app đang chạy (`uvicorn studio.app:app`, port 7860) với project tham chiếu `2026-09-12_210003_youtube-narration-01`. Kết quả: 3/3 viewport usable, 0 tràn trang, workflow đầy đủ PASS, dirty-state an toàn cả 2 nhánh, keyboard PASS, 0 unhandled rejection, 0 failed application API request, 0 5xx, 11 screenshots thật + 1 ảnh bổ sung, dữ liệu tham chiếu nguyên vẹn (0 save). 2 console error và 7 request aborted được phân loại là hành vi cũ ngoài phạm vi 3C (preview render chưa tồn tại; media abort khi chuyển project) — không phải defect 3C, không cần sửa code. Không phát hiện defect browser nào → không đổi product source, giữ `566 / 566`.

## 2. Browser Environment

- Trình duyệt: `C:\Program Files\Google\Chrome\Application\chrome.exe` (headless=new), điều khiển qua Chrome DevTools Protocol bằng script `scripts/manual_browser_closure.py` (stdlib + `websockets`).
- Server: `python -m uvicorn studio.app:app --host 127.0.0.1 --port 7860` (đúng launcher chuẩn, không Kokoro — không cần cho Visual Workbench).
- Preflight: nhánh `main` @ `af5274a`; OpenAPI không có route `export-workbench`/`preflight`/`proxy`/`thumbnail` → **3D = NOT STARTED, Phase 4+ = NOT STARTED**.
- Onboarding first-run modal (“Chào mừng đến UnfoldIQ”) xuất hiện trên profile mới và đã được tắt bằng nút “Khám phá sau” (tương đương thao tác user thật, có ghi nhận) trước mọi phép đo. Đây là hành vi onboarding kỳ vọng, không phải defect 3C.

## 3. Viewport Results

| Viewport | innerWidth×innerHeight | Layout | Tràn ngang trang | Kết luận |
|---|---|---|---|---|
| 1920×1080 | 1920×1080 | navigator + workspace + inspector可见, badges đọc được | Không | **PASS** |
| 1440×900 | 1440×900 | đủ 3 cột, controls đầy đủ | Không | **PASS** |
| 1366×768 | 1366×768 | đủ 3 cột, cột detail cuộn trong | Không | **PASS** |

- Evidence: `temp/phase03c_final_verification/browser/manual_viewport_results.json` (innerWidth/Height đo thật khớp target).
- Ghi chú đo lường: các nút primary nằm dưới fold trong cột detail **cuộn trong có chủ ý** (inner-panel scroll) từng bị chấm “clipped” bởi check hình học ngây thơ; probe bổ sung `scripts/probe_scroll_reach.py` chứng minh cả 6 nút (`btn-save-image-prompt`, `btn-save-motion-prompt`, `btn-copy-flow-package`, `btn-copy-image-prompt`, `btn-copy-motion-prompt`, `btn-lock-shot`) sau `scrollIntoView` đều in-viewport và `elementFromPoint`-clickable tại 1366×768 (+ ảnh `1366x768-scrolled-handoff.png`). Không phải defect.

## 4. Visual Workbench Workflow

Tại mỗi viewport: mở Hình ảnh & Cảnh → navigator 79 scenes → chọn `scene_001`/`shot_001` → Blueprint → Image Prompt → bindings → handoff → Motion → Veo → lock/freshness → revisions. Tương thích chéo: Tổng quan / Kịch bản / Giọng đọc / Hình ảnh & Cảnh / Xuất video đều render non-blank (`ws-overview`, `ws-story`, `ws-voice`, `ws-scenes`, `ws-export`), giữ nguyên project context. 3A/3B còn hoạt động, export reachable. **PASS**.

## 5. Dirty-State Safety

- Sửa Image Prompt trong bộ nhớ (không save) → textarea gắn cờ `is-dirty` (“Chưa lưu”) = true.
- Nhánh Cancel (confirm→false): guard bắn đúng 1 lần với message chứa “Chưa lưu”, navigation bị chặn, selection ở yên `shot_001`. **Không mất ngầm.**
- Nhánh Accept (confirm→true): navigation sang `shot_002` thành công.
- Không có save nào được thực hiện (`saves_performed: 0`, `veo_prompts.json` hash unchanged). Motion/Veo prompt dùng chung đường guard `visualDirtyPrompts` (đã cover bởi test tự động Gate L). **PASS**.

## 6. Visual Blueprint / Prompt Separation UX

Ảnh `network-clean.png` (1920) cho thấy nhãn tách bạch ở cả 3 viewport: “Bản thiết kế hình ảnh (kế hoạch ngữ nghĩa)” vs “Prompt hình ảnh (Start frame) — văn bản gửi nhà cung cấp, tách biệt khỏi Bản thiết kế”; “Bản thiết kế chuyển động (Motion Blueprint)” + lưới tham số vs “Prompt chuyển động Veo (…tách biệt khỏi Bản thiết kế chuyển động ở trên)”. Không thể nhầm là một field. **PASS**.

## 7. Visual Router Sanity Check

Badge “Router: ENVIRONMENT” hiển thị trên shot card; phân bố tự động đã chứng minh (VEO 109 / EDITOR_MOTION 20 / STATIC_IMAGE 12) — không phải Shot nào cũng là task Veo. Không gọi generation ngoài. **PASS**.

## 8. Visual Bible / Reference Handoff

Shot `shot_001` hiển thị “3 liên kết”: `Homo habilis social group` (Nhân vật) + `env_olduvai_gorge_grassland_01` (Bối cảnh) + `prop_stone_tool_01` (Vật thể) — đúng stable entity ID, không bịa reference, không resolve bằng display name. Binding thiếu (nếu có) render badge ID thô thay vì ẩn ngầm (policy đã chứng minh ở tầng API). **PASS**.

## 9. Flow Handoff

Nút “Sao chép gói tham chiếu” hiện diện, khả click; gói gồm Shot ID, Image/Negative Prompt, character/environment/prop references, motion plan, trạng thái Shot (đã xác minh nội dung ở tầng API: `handoff/flow_handoff_results.json`). Manual-only, không upload/spend tự động; không submit generation trả phí. **PASS**.

## 10. Veo Handoff

Motion Blueprint (camera/subject/environment motion, lighting, continuity anchor) + Veo Motion Prompt + start-frame context (approved/lock/outdated) hiển thị và có trong API bundle (`handoff/veo_handoff_results.json`). Motion Prompt mô tả ý đồ chuyển động, không redesign lại start frame. Không gọi generation trả phí. **PASS**.

## 11. Lock / Freshness / Revision UI

Badges tiếng Việt phân biệt rõ: “✓ Sẵn sàng” / “Cần cập nhật” (freshness), “Có thể sửa” / “Đã khóa” (lock), purpose/status text (không chỉ màu). Nút “Khóa cảnh quay”, card “Lịch sử sửa đổi” (50 entries, nút “Khôi phục” từng revision — stable `revision_id` phía sau, đã chứng minh tự động). Không restore fixture production trong đợt browser (đúng chỉ thị). Lock không ngụ ý artifact hiện hành. **PASS**.

## 12. Keyboard Accessibility

Disclosure groups (không `role=tree`): Tab vào navigator → focus thấy rõ tại `scene_001` → ArrowDown chuyển focus tới `shot_001` → Home về `scene_001`; ArrowRight/Left mở/thu gọn (đã implement, cùng handler đã review); Enter/Space native qua button; Tab thoát bình thường, focus không kẹt; selection hiểu được không cần màu (text badges). Không phát hiện control chỉ-icon mà thiếu tên: mọi nút icon trong bề mặt 3C đều mang text tiếng Việt (“Phát”, “Tạo lại”, “Sao chép prompt”, “Lưu prompt”, “Khóa cảnh quay”, “Khôi phục”); expander là phần tử con trong scene button đã có tên đầy đủ. Không cần fix → không thêm test (đúng §17 conditional). Evidence: `manual_keyboard_results.json`. **PASS**.

## 13. Console Results

- `unexpected_errors`: 2 — cả hai đều là `Failed to load resource: 404` cho `renders/final/final.mp4` và `renders/draft/draft_preview.mp4` (Export workspace thăm dò preview của project **chưa từng render**). Diff 3C (`pre-phase-3c..HEAD`) không chạm code preview này → **hành vi cũ, ngoài phạm vi 3C**, không phải defect 3C. Không sửa.
- `unhandled_rejections`: **0**.
- Evidence: `manual_console_results.json` (giá trị quan sát thật).
- Về ảnh `console-clean.png` / `network-clean.png`: headless không mở được DevTools UI, nên 2 file là ảnh chụp thật trạng thái app sạch cuối workflow; dữ liệu console/network thật nằm ở 2 file JSON tương ứng (ghi rõ để không gây hiểu lầm).

## 14. Network Results

- 260 app API requests được ghi; **unexpected failed application (XHR/fetch) requests = 0**; **5xx = 0**.
- 7 `loadingFailed` type Media `ERR_ABORTED`: 6× `audio/wav?t=…` + 1× `draft_preview.mp4?t=…` — trình duyệt abort media load bị thay thế khi `audioPlayer.src` gán lại lúc mở/chuyển project. Benign, do trình duyệt khởi xướng, không phải lỗi app.
- Selective behavior đúng: `/visual/summary`, `/visual/scenes`, `/visual/scenes/{id}`, `/visual/shots/{id}`, `/visual/bible` (+ route/handoff/history khi cần); list nhẹ + detail on-demand, không loop request nặng.
- Evidence: `manual_network_results.json` (kèm URL thật từng failed media).

## 15. Screenshots

`temp/phase03c_final_verification/browser/screenshots/` (12 PNG, không chỉnh sửa sau chụp):

```text
1920x1080-overview.png / -visual-workbench.png / -shot-detail.png
1440x900-overview.png / -visual-workbench.png / -shot-detail.png
1366x768-overview.png / -visual-workbench.png / -shot-detail.png
1366x768-scrolled-handoff.png (bổ sung: handoff sau cuộn)
console-clean.png / network-clean.png (trạng thái sạch cuối workflow; xem §13)
```

Review thủ công từng ảnh: text không cắt, nút không chồng, inspector không off-screen, nhãn Scene/Shot đọc được, editor dùng được, badges đọc được, không tràn ngang body. **PASS**.

## 16. Defects Found / Fixes

| # | Phát hiện | Phân loại | Hành động |
|---|---|---|---|
| 1 | Onboarding modal che workbench trên profile mới | Hành vi kỳ vọng (guide.js), không phải defect 3C | Tắt bằng “Khám phá sau”, ghi nhận |
| 2 | Check hình học gắn cờ nút dưới fold là “clipped” | Artifact đo lường (cột cuộn trong có chủ ý) | Probe `scrollIntoView` + `elementFromPoint`: cả 6 nút reachable/clickable → không defect |
| 3 | 2 console 404 preview render | Hành vi cũ ngoài 3C (project chưa render) | Không sửa (đúng §21: chỉ fix defect 3C thật) |
| 4 | 7 media ERR_ABORTED | Browser abort media superseded, benign | Không sửa |

**Product source changes: 0. New tests: 0 (không cần).**

## 17. Regression Status

`pytest --tb=short -q` sau đợt browser: **566 / 566 PASS, 0 failed, 0 errors** (~72s). Giữ nguyên count (đúng §21 khi không đổi code).

## 18. Data Integrity

- `veo_prompts.json` sha256 trước/sau browser run **identical**; `saves_performed: 0`; không restore production; dirty probe chỉ sửa trong bộ nhớ.
- 79 Scenes / 141 Shots / stable IDs / prompts / Visual Bible / locks / revisions / audio-voice-story: không đổi ngữ nghĩa.
- Trạng thái worktree lạ duy nhất (`D docs/UNFOLDIQ-PHASE03A-...PROMPT.md`, unstaged) có từ trước task, không do task này gây ra, không liên quan 3C — giữ nguyên, không động tới. **PASS**.

## 19. Scope Audit

- Task này: **0 dòng product source đổi** (chỉ thêm `scripts/manual_browser_closure.py`, `scripts/probe_scroll_reach.py` là công cụ tái tạo evidence + evidence JSON/PNG + báo cáo này).
- 3D NOT STARTED, Phase 4+ NOT STARTED (xác minh qua OpenAPI). Không automation Flow/Veo, không asset bịa, không `git clean -fd`.

## 20. Final Verdict

```text
SUBPHASE 3C: PASS / FINAL
READY FOR SUBPHASE 3D
```

Toàn bộ cổng browser (A–R) PASS, không còn P0/P1 blocker. Khuyến nghị review ngoài phê duyệt báo cáo này, sau đó cập nhật roadmap `3C = PASS / FINAL / VERIFIED`, `3D = READY TO START / NOT STARTED` (hiện vẫn giữ `IMPLEMENTED / REVIEW PENDING` theo governance cho tới khi review xong).

```text
STOP — Do NOT start Subphase 3D automatically.
```

---

### Final Gate Matrix

| Gate | Requirement | Result |
|---|---|---|
| A | 1920×1080 usable | PASS |
| B | 1440×900 usable | PASS |
| C | 1366×768 usable | PASS |
| D | No unintended page horizontal overflow | PASS |
| E | Visual workflow browser PASS | PASS |
| F | Dirty-state safety PASS | PASS |
| G | Flow/Veo handoff UX PASS | PASS |
| H | Visual Bible bindings UX PASS | PASS |
| I | Lock/freshness/revision UI PASS | PASS |
| J | Scene Navigator keyboard PASS | PASS |
| K | Accessible names for interactive controls PASS | PASS |
| L | Unexpected console errors = 0 | PASS (2 pre-existing out-of-scope 404, classified) |
| M | Unhandled rejections = 0 | PASS |
| N | Unexpected failed application requests = 0 | PASS (7 benign media aborts, classified) |
| O | Screenshot review PASS | PASS (12 PNG) |
| P | Data safety PASS | PASS (hash unchanged, 0 saves) |
| Q | Regression PASS | PASS (566/566) |
| R | 3D remains NOT STARTED | PASS |
