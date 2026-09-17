# PHASE_03C_IMPLEMENTATION_REPORT.md
# BÁO CÁO TRIỂN KHAI SUBPHASE 3C — VISUAL WORKBENCH

> **Phân kỳ:** Subphase 3C — Visual Workbench (Scenes, Shots & Visual Bible)  
> **Thời gian:** 2026-09-17  
> **Commit:** `693c7b7`  
> **Checkpoint:** `pre-phase-3c` @ `3d256bd`  
> **Trạng thái nghiệm thu:** PASS / FINAL

---

## 1. Phạm Vi & Ranh Giới Thực Hiện

### Nằm trong phạm vi (In-Scope)
- Selective loader API cho Visual Workbench (5 routes)
- Scene Navigator (cây phân cấp Cảnh → Cảnh quay)
- Shot Workspace: Visual Blueprint Card, Motion Blueprint Card, Handoff Checklist Card
- Inspector Panel: Ràng buộc thực thể, Khóa cảnh quay, Lịch sử sửa đổi
- Status filter dropdown cho Scene Navigator
- Vietnamese-first UI labels toàn bộ bề mặt 3C

### Ngoài phạm vi (Out-of-Scope)
- Subphase 3D, Phase 4+
- Browser automation Google Flow / Veo

---

## 2. Kiến Trúc Backend

### 2.1 Domain Models (studio/domain_models.py)
Shot model mở rộng: is_locked, status, subject_ids, environment_id, prop_ids,
visual_objective, shot_purpose, outdated, narration, continuity_group, category, constraints.
Extra allow: scene_id alias, duration_sec alias, image_prompt.

### 2.2 Project Adapter (studio/project_adapter.py)
- load_visual_scenes_lightweight: không load prompts nặng
- load_scene_detail: đầy đủ khi cần
- load_shot_detail: on-demand + enrich image_prompt từ image_prompts.json
- load_visual_bible_slice: độc lập

### 2.3 API Routes

| Route | Status |
|:---|:---:|
| /visual/summary | 200 OK |
| /visual/scenes | 200 OK (79 scenes) |
| /visual/scenes/{id} | 200 OK |
| /visual/shots/{id} | 200 OK |
| /visual/bible | 200 OK |

---

## 3. Frontend

### index.html
- #ws-scenes title: Hình ảnh & Cảnh (Visual Workbench)
- #sp-filter-status dropdown: Tất cả / Sẵn sàng / Cần cập nhật / Đã khóa
- Inspector: #vw-bindings-card, #vw-lock-card, #vw-revisions-card

### uq-shell.css
New classes: .visual-scene-group, .visual-shot-tree-btn, .visual-blueprint-card,
.motion-blueprint-card, .handoff-checklist-card, .vw-binding-item, .vw-revision-item

### app.js (Section 13d)
Functions: loadVisualWorkbench, renderVisualSceneNavigator, selectVisualShot,
renderVisualShotWorkspace, renderVisualInspector, copyVisualPrompt,
saveVisualPrompt, toggleShotLock, restoreVisualRevision

---

## 4. Kết Quả Kiểm Thử

### 4.1 Test Suite 3C — 10/10 PASS

| # | Test | Result |
|---|:---|:---:|
| 1 | test_visual_summary_selective_route | PASS |
| 2 | test_visual_scenes_lightweight_route | PASS |
| 3 | test_visual_scene_detail_route | PASS |
| 4 | test_visual_shot_detail_route | PASS |
| 5 | test_visual_bible_slice_route | PASS |
| 6 | test_scene_shot_stable_id_integrity | PASS |
| 7 | test_visual_workbench_lock_contract | PASS |
| 8 | test_visual_workbench_prompt_mutation_isolated | PASS |
| 9 | test_visual_workbench_markup_in_index_html | PASS |
| 10 | test_regression_3a_and_3b_preserved | PASS |

### 4.2 Hồi Quy Toàn Bộ
**517/517 PASS — 0 failures, 0 errors (80.04s)**

### 4.3 API Field Verification (shot_001)
12/12 fields OK: shot_id, scene_id, duration_sec, is_locked, status,
image_prompt, veo_prompt, visual_objective, shot_purpose, narration,
continuity_group, category

---

## 5. Governance

| Hạng mục | Trạng thái |
|:---|:---:|
| Subphase 3D KHÔNG bắt đầu | Tuân thủ |
| Phase 4+ KHÔNG triển khai | Tuân thủ |
| Vietnamese-first UI labels | Toàn bộ 3C |
| git clean -fd KHÔNG dùng | Tuân thủ |
| Checkpoint pre-phase-3c | Tag tồn tại |
| Dữ liệu dự án tham chiếu | 100% nguyên vẹn |

---

## 6. Kết Luận

Subphase 3C PASS / FINAL. Commit 693c7b7 trên nhánh main.
Sẵn sàng khởi động Subphase 3D khi được phê duyệt.
