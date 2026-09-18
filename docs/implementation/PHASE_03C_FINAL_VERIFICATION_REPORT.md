# PHASE_03C_FINAL_VERIFICATION_REPORT.md
# BÁO CÁO XÁC MINH CUỐI SUBPHASE 3C — VISUAL WORKBENCH (FINAL VERIFICATION & GAP CLOSURE)

> **Phân kỳ:** Subphase 3C — Visual Workbench (Scenes, Shots & Visual Bible)
> **Ngày:** 2026-09-17
> **Phạm vi:** VERIFY / FIX SUBPHASE 3C ONLY (không bắt đầu 3D, không Phase 4+)
> **Hồi quy:** **566 / 566 PASS** (517 baseline + 49 gap-closure mới), 0 failed, 0 errors
> **Verdict:** **SUBPHASE 3C: CONDITIONAL PASS — NOT READY FOR SUBPHASE 3D** (1 blocker thủ tục: browser viewport thủ công)

---

## 1. Executive Summary

Đợt xác minh cuối phát hiện implementation 3C ban đầu (`693c7b7`, báo cáo 517/517) có các khiếm khuyết kiến trúc thật: image prompt dùng chung cấp Scene (sửa Shot A lan sang Shot B), Blueprint bị đồng nhất với prompt, thiếu Visual Router, loader bỏ qua trường `image_prompt` cấp Shot đã tồn tại trong dữ liệu, revision restore dùng index, keyboard navigator thiếu phím, motion save đi sai endpoint, tra cứu binding/prop dùng display name. Tất cả đã được sửa ở cấp nguồn + test (49 test gap-closure mới, tổng 566/566 PASS) với bằng chứng thật trong `temp/phase03c_final_verification/` (27 files). Dữ liệu tham chiếu nguyên vẹn (79 Scenes / 141 Shots, 0 khác biệt ngữ nghĩa ngoài ý muốn). 3A/3B và tương thích export còn hoạt động. Còn đúng 1 blocker: browser viewport + screenshot thủ công (môi trường này không có browser automation) — xem §15, §21.

## 2. Git Checkpoint

- `pre-phase-3c` = `3d256bd` (approved 3B micro-closure: 4 files, không có code 3C).
- `HEAD` (trước task) = `af5274a`; diff `pre-phase-3c..HEAD` chỉ thêm 10 files 3C (+4271/−21).
- Baseline 507-test 3B nằm ở commit cha của feature 3C; file 3B không bị 3C chạm tới (trừ ROADMAP_STATUS).
- Không dùng `git clean -fd`, không sửa lịch sử.
- Evidence: `temp/phase03c_final_verification/git/checkpoint_audit.md` — **PASS**.

## 3. Shot-Level Image Prompt Identity

- Chuẩn: `shot.image_prompt` (record trong `veo_prompts.json`) là identity chuẩn cấp Shot; prompt cấp Scene trong `image_prompts.json` chỉ là fallback tương thích ngược (loader read-only, không sao chép mù).
- Sửa: `Shot.image_prompt` khai báo tường minh (`domain_models.py`); `load_shot_detail` ưu tiên Shot-level, fallback Scene-level; `PATCH /visual/shots/{id}` chỉ ghi record mục tiêu; frontend textarea/copy/save dùng Shot-level trước.
- Kiểm chứng Scene `scene_001` (3 Shots): A=X, B=Y độc lập; sửa A không đổi B; `image_prompts.json` không bị chạm; reload ổn định; trường legacy (`continuityGroupId`, `shotPurpose`) được bảo toàn.
- Evidence: `shot_prompt_identity/` — **PASS**.

## 4. Visual Blueprint Contract

- Blueprint (kế hoạch ngữ nghĩa): `visual_objective`, `shot_purpose`, `category`, `subject_ids`, `environment_id`, `prop_ids`, `constraints`, `continuity_group`.
- Image Prompt (provider text): `shot.image_prompt` + `negative_prompt`.
- UI Card A tách 2 khối với nhãn riêng (“Bản thiết kế hình ảnh (kế hoạch ngữ nghĩa)” vs “Prompt hình ảnh (Start frame) — văn bản gửi nhà cung cấp, tách biệt khỏi Bản thiết kế”).
- Luật: sửa prompt không viết lại Blueprint (đã test); sửa Blueprint mà không ghi prompt → `outdated=true`, giữ nguyên nội dung, không tự tái sinh.
- Evidence: `blueprints/visual_blueprint_contract.md` — **PASS**.

## 5. Motion Blueprint Contract

- Motion Blueprint (cái gì chuyển động): `camera_motion`, `subject_action`, `environment_motion`, `lighting_atmosphere`, `continuity_anchor`, `duration`, motion constraints.
- Veo Motion Prompt (provider text): `shot.veo_prompt`.
- UI Card B giữ lưới tham số Blueprint tách khỏi textarea “Prompt chuyển động Veo (…tách biệt khỏi Bản thiết kế chuyển động ở trên)”; motion save chuyển sang `PATCH /visual/shots` thống nhất.
- Evidence: `blueprints/motion_blueprint_contract.md` — **PASS**.

## 6. Visual Router

- Mới: `studio/visual_router.py` — tất định, không LLM. Thứ tự: `selectedOutputType` > `recommendedOutputType` > `visualType` > shot category > UNKNOWN. Endpoint `GET /visual/route/{shot_id}`.
- Phân bố thật trên 141 Shots: VEO 109 / EDITOR_MOTION 20 / STATIC_IMAGE 12 — **không phải Shot nào cũng qua Veo**.
- CHARACTER_SCENE yêu cầu start-frame trước motion; ổn định sau reload (hàm thuần trên metadata lưu trữ).
- Evidence: `visual_router/` — **PASS**.

## 7. Visual Bible Bindings

- Binding dùng stable entity ID (`characterId`/`subjectId`/`environmentId`/`propId`/`objectId`/`id`), không dùng display name hay index (frontend đã bỏ fallback `name`).
- Đổi tên hiển thị không đổi ID → binding sống sót (by construction); ID thiếu/mất → badge ID thô, không xóa ngầm (policy BLOCKED theo Phase 2).
- Evidence: `visual_bible/binding_identity_results.json` — **PASS**.

## 8. Character Reference-Pack Contract

- Reference views (FRONT/THREE_QUARTER/PROFILE/FULL_BODY) là view của **một** Character entity qua `referenceAssetIds`, không phải 4 Character.
- Fixture thật: 5 characters, 1 reference asset (`FRONT` của `char_hh_primary_caregiver_01`); không trùng tên Character; full 4-view pack là N/A trong fixture — không bịa asset.
- Evidence: `visual_bible/character_reference_pack_results.json` — **PASS**.

## 9. Flow / Veo Manual Handoff

- Mới: `GET /visual/handoff/{shot_id}` — Shot ID, Image/Negative Prompt, character/environment/prop references thật (stable ID, resolve từ `visual_bible.json`), style snapshot; motion: start-frame context (approved/lock/outdated) + Motion Blueprint + Veo prompt + required references. `manual_only=true`, 0 upload.
- Nút “Sao chép gói tham chiếu” trong UI cũng đã nâng cấp tương đương (kèm trạng thái Shot + motion plan).
- Không automation trình duyệt, không spend tự động.
- Evidence: `handoff/` — **PASS**.

## 10. Approval / Lock / Freshness

- 3 chiều độc lập trên Shot detail: `is_locked` (bool) / `status` (str) / `outdated` (bool); UI badge chữ tiếng Việt (“Đã khóa/Có thể sửa”, “Cần cập nhật/Sẵn sàng”, purpose/status).
- LOCKED + OUTDATED cùng tồn tại hợp lệ (đã chứng minh trên model).
- Lock = không ghi đè ngầm: PATCH shot bị khóa trả **409 LOCK_CONFLICT** trừ khi `override_lock=true`; frontend confirm tiếng Việt; restore revision đã tôn trọng lock từ Phase 2 (`override_lock`).
- Vòng đời candidate ảnh: **N/A trong fixture hiện tại** (chưa có bảng candidate) — ghi nhận rõ ràng, không bịa record.
- Evidence: `approval_freshness/lifecycle_results.json` — **PASS**.

## 11. Selective Dependency Invalidation

- Mới: `studio/visual_invalidation.py` — `shots_affected_by_subject/environment/prop` chỉ trả Shot bound tới entity đổi; entity lạ → 0 Shot (không bao giờ invalidate cả 141).
- Sửa Shot A không đổi Shot B (đã chứng minh qua PATCH + GET); không tái sinh prompt tự động.
- Evidence: `freshness/selective_invalidation_results.json` — **PASS**.

## 12. Stable Revision Restore

- Chuẩn: `POST /history/{revision_id}/restore` với **stable revision_id** (`ArtifactRevision.revision_id`); UI lưu `data-rev-id`, không còn `restoreVisualRevision(shotId, revIndex)`; tôn trọng lock/conflict (Phase 2 `VersionManager`).
- Evidence: `revisions/stable_revision_restore_results.json` — **PASS**.

## 13. Accessibility

- Navigator là **disclosure groups** (buttons + `aria-expanded`/`aria-pressed`), KHÔNG dùng `role=tree` sai ngữ nghĩa.
- Keyboard đầy đủ: ArrowUp/Down/Home/End/ArrowRight (mở rộng)/ArrowLeft (thu gọn); Enter/Space native qua button.
- Trạng thái Scene/Shot chọn có text (không chỉ màu); nút icon-only có `title` tiếng Việt.
- Evidence: `accessibility/scene_navigator_keyboard.json` — **PASS** (mức nguồn; chờ đối chiếu browser thủ công).

## 14. Loading / Empty / Error / Dirty State

- Loading (“Đang tải danh sách cảnh…”), empty (“Chưa có Scene Plan…”, “Không tìm thấy cảnh…”), error tiếng Việt (“Lỗi tải…”, “Không thể tải chi tiết…”), 404 cho Shot lạ (không 500).
- Dirty: `visualDirtyPrompts` + confirm “Chưa lưu” chặn chuyển Shot khi prompt chưa lưu — không mất ngầm.
- Evidence: `states/` — **PASS**.

## 15. Browser / Network / Viewports

- Workflow API đầy đủ (summary → scenes → scene → shot → bible → route → handoff → story/voice/visual tương thích): 10/10 bước 200, 0 failed, 0 5xx, không phát hiện duplicate heavy request (list nhẹ + detail on-demand + bible slice).
- Evidence: `browser/console_results.json`, `browser/network_results.json` — **PASS ở tầng API**.
- **BLOCKER thủ tục:** viewport 1920×1080 / 1440×900 / 1366×768 + console trình duyệt + screenshots cần pass thủ công (môi trường này không có Playwright/Selenium/browser). Checklist tại `browser/screenshots/VIEWPORT_CHECKLIST.md` — **PENDING**.

## 16. Performance

- Phương pháp: TestClient in-process, `perf_counter` quanh HTTP+JSON, 7 runs/case, báo median (không bịa SLA; không gồm DOM paint).
- Quan sát (median): workbench usable 35.4ms; navigator render 26.8ms; scene switch 9.5ms; shot switch ~7.6ms; bible/route/handoff tương tự đơn-chục ms.
- Không cần ảo hóa Phase 5 ở quy mô 79 scenes (disclosure nhóm).
- Evidence: `performance/methodology.md`, `measurements.json` — **PASS (số liệu thật)**.

## 17. Data Integrity

- Ma trận: script, story beats, audio/voice, transcript/timestamps/word-cues/pronunciation/QA (qua hồi quy 3A/3B), 79 Scenes / 141 Shots / IDs / hierarchy, Visual Bible, prompts (image/negative/motion), references, approval/lock, settings, `state.db`, revision history, unknown/legacy fields — **0 khác biệt ngữ nghĩa ngoài ý muốn** (mutation trong evidence đều revert/copy cô lập).
- Evidence: `integrity/` — **PASS**.

## 18. Full Regression

- `pytest --tb=short -q`: **566 / 566 PASS, 0 failed, 0 errors** (~70s). Baseline 517 giữ nguyên + 49 test gap-closure mới (`test_phase03c_gap_closure.py`).
- Không giảm bất hợp lý; 3A/3B còn xanh; export compatibility (`/v2/visual`) reachable.
- Evidence: `regression/pytest_full.log`, `pytest_summary.json` — **PASS**.

## 19. Scope Audit

- Diff `pre-phase-3c..HEAD`: chỉ 3C (Visual Workbench shell, selective APIs, router, handoff, PATCH, docs, tests).
- 3D NOT STARTED (không route export-workbench/preflight); Phase 4+ NOT STARTED (không proxy/thumbnail); không automation Flow/Veo; không asset bịa; không `git clean -fd`.
- Evidence: `scope/git_diff_review.md` — **PASS**.

## 20. Roadmap Governance

- Trong task: 3C = **IMPLEMENTED / REVIEW PENDING**, 3D = NOT STARTED (đúng Gate P; trước đó roadmap ghi PASS/FINAL sớm đã được hạ cấp cho tới khi review ngoài chấp nhận).
- Chỉ sau review ngoài chấp nhận báo cáo này mới được ghi `3C = PASS / FINAL / VERIFIED`, `3D = READY TO START / NOT STARTED`. Không bắt đầu 3D trong task.

## 21. Final Gate Matrix

| # | Điều kiện | Kết quả |
|---|---|---|
| 1 | pre-phase-3c là checkpoint 3B hợp lệ | ✅ PASS |
| 2 | Image prompt cấp Shot, sibling-safe | ✅ PASS |
| 3 | Scene prompt cũ tương thích ngược | ✅ PASS |
| 4 | Visual Blueprint ≠ Image Prompt | ✅ PASS |
| 5 | Motion Blueprint ≠ Veo Prompt | ✅ PASS |
| 6 | Visual Router tất định tồn tại | ✅ PASS |
| 7 | Không ép mọi Shot qua Veo | ✅ PASS (109/20/12) |
| 8 | Mutation dùng stable ID | ✅ PASS |
| 9 | Binding dùng stable entity ID | ✅ PASS |
| 10 | Reference views là 1 entity | ✅ PASS |
| 11 | Flow handoff có references thật | ✅ PASS |
| 12 | Veo handoff có start-frame + motion plan | ✅ PASS |
| 13 | Không automation/spend Flow/Veo | ✅ PASS |
| 14 | Approval/lock/freshness tách bạch | ✅ PASS |
| 15 | LOCKED + OUTDATED cùng tồn tại | ✅ PASS |
| 16 | Selective invalidation | ✅ PASS |
| 17 | Không tái sinh prompt tự động | ✅ PASS |
| 18 | Restore dùng stable revision_id | ✅ PASS |
| 19 | Keyboard navigator hợp lệ | ✅ PASS (mức nguồn) |
| 20 | Loading/empty/error/dirty | ✅ PASS |
| 21 | Viewports bắt buộc | ⏳ **PENDING thủ công** |
| 22 | Console/network trình duyệt | ⏳ **PENDING thủ công** (tầng API: 0 lỗi) |
| 23 | Performance thật | ✅ PASS |
| 24 | Data integrity | ✅ PASS |
| 25 | Full regression | ✅ PASS 566/566 |
| 26 | 3A/3B + export tương thích | ✅ PASS |
| 27 | 3D / Phase 4+ NOT STARTED | ✅ PASS |
| 28 | Không P0/P1 | ✅ PASS (trừ blocker thủ tục viewport) |

## 22. Final Verdict

```text
SUBPHASE 3C: CONDITIONAL PASS
NOT READY FOR SUBPHASE 3D
```

**Blocker duy nhất:** pass browser thủ công (3 viewports + console/network + screenshots) — môi trường thực thi này không có browser automation; mọi tầng kiểm chứng được bằng code đều PASS với bằng chứng thật. Sau khi reviewer chạy checklist tại `temp/phase03c_final_verification/browser/screenshots/VIEWPORT_CHECKLIST.md` và đính screenshots, verdict có thể nâng lên `SUBPHASE 3C: PASS / FINAL — READY FOR SUBPHASE 3D` mà không cần sửa code thêm (trừ khi browser pass phát hiện lỗi hiển thị).

```text
STOP — Do NOT start Subphase 3D automatically.
```

