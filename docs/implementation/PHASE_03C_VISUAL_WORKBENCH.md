# PHASE_03C_VISUAL_WORKBENCH.md
# TÀI LIỆU KỸ THUẬT — VISUAL WORKBENCH (SUBPHASE 3C)

> **Module:** Hình ảnh & Cảnh (Visual Workbench)  
> **Workspace ID:** scenes  
> **Phiên bản:** 1.1.0 (Final Verification — shot-level prompt identity, blueprint/prompt separation, router, handoff)  
> **Ngày:** 2026-09-17

> **Quy ước chuẩn (Gates B–D):**
> - **Bản thiết kế hình ảnh (Visual Blueprint)** ≠ **Prompt hình ảnh (provider text)**.
> - **Bản thiết kế chuyển động (Motion Blueprint)** ≠ **Prompt chuyển động Veo (provider text)**.
> - `shot.image_prompt` là identity cấp Shot; `image_prompts.json` cấp Scene chỉ là fallback tương thích ngược.

---

## 1. Tổng Quan

Visual Workbench là không gian làm việc trung tâm cho quy trình thiết kế hình ảnh:
- Xem và điều hướng cấu trúc phân cấp **Cảnh (Scenes) → Cảnh quay (Shots)**
- Xem **Bản thiết kế hình ảnh** (Visual Blueprint: mục tiêu, mục đích, ràng buộc ngữ nghĩa)
- Chỉnh sửa **Prompt hình ảnh** (provider text cho Google Flow/Imagen — tách biệt khỏi Blueprint)
- Xem **Bản thiết kế chuyển động** (Motion Blueprint: camera/subject/environment motion, timing)
- Chỉnh sửa **Prompt chuyển động Veo** (provider text cho Google Veo — tách biệt khỏi Blueprint)
- Sao chép **gói bàn giao Flow/Veo** kèm tham chiếu thực thể thật (manual-only, không tự động upload)
- Kiểm tra danh sách bàn giao (**Handoff Checklist**)
- Quản lý **Ràng buộc thực thể** (Visual Bible bindings)
- **Khóa/Mở khóa** cảnh quay đã hoàn thiện
- Xem và khôi phục **Lịch sử sửa đổi**

---

## 2. Kiến Trúc Dữ Liệu

### 2.1 Luồng Dữ Liệu

```
veo_prompts.json          ──► load_visual_scenes_lightweight()  ──► /visual/scenes  
veo_prompts.json          ──► load_shot_detail()                ──► /visual/shots/{id}
image_prompts.json        ──► load_shot_detail() (enrich)       ──┘
visual_bible.json         ──► load_visual_bible_slice()         ──► /visual/bible
```

### 2.2 Cấu Trúc Shot Detail Response

```json
{
  "shot_id": "shot_001",
  "parent_scene_id": "scene_001",
  "scene_id": "scene_001",          // alias
  "duration": 3.153,
  "duration_sec": 3.153,            // alias
  "is_locked": false,
  "status": "generated",
  "veo_prompt": "Cinematography: wide framing...",
  "image_prompt": "Atmospheric visual scene...",  // from image_prompts.json
  "visual_objective": "Cinematic atmospheric transition...",
  "shot_purpose": "ESTABLISH",
  "narration": "Early humans were not always...",
  "continuity_group": "cg_001",
  "category": "transition",
  "subject_ids": [],
  "environment_id": null,
  "prop_ids": [],
  "constraints": []
}
```

---

## 3. API Routes

### GET /api/projects/{dir_name}/visual/summary
Tổng quan nhanh: tổng số cảnh, cảnh quay, thời lượng, trạng thái.

### GET /api/projects/{dir_name}/visual/scenes
Danh sách lightweight tất cả cảnh. Không bao gồm prompts nặng.
Response: array of SceneSummary objects.

### GET /api/projects/{dir_name}/visual/scenes/{scene_id}
Chi tiết đầy đủ 1 cảnh bao gồm danh sách shot IDs.

### GET /api/projects/{dir_name}/visual/shots/{shot_id}
Chi tiết đầy đủ 1 cảnh quay. Được load on-demand khi user click.
`image_prompt` ưu tiên bản ghi cấp Shot trong `veo_prompts.json`; chỉ khi Shot chưa có
override mới fallback về prompt cấp Scene trong `image_prompts.json` (tương thích ngược).

### PATCH /api/projects/{dir_name}/visual/shots/{shot_id}
Ghi prompt cấp Shot độc lập (sibling-safe, không chạm `image_prompts.json`).
Hỗ trợ trường Blueprint; đổi Blueprint mà không ghi prompt sẽ đánh dấu `outdated=true`
(không tự tái sinh). Shot đang khóa trả 409 trừ khi `override_lock=true`.
Bảo toàn mọi trường legacy/unknown.

### GET /api/projects/{dir_name}/visual/route/{shot_id}
Visual Router tất định (không LLM): route, rationale, requires_start_frame/motion_prompt.

### GET /api/projects/{dir_name}/visual/handoff/{shot_id}
Gói bàn giao thủ công Flow/Veo: Shot ID, Image/Negative Prompt, tham chiếu Character/
Environment/Prop thật (stable entity ID), style, Motion Blueprint + Veo prompt,
ngữ cảnh start-frame. Manual-only — không upload tự động.

### GET /api/projects/{dir_name}/visual/bible
Visual Bible entities slice: characters, environments, objects.

---

## 4. Giao Diện Người Dùng

### 4.1 Cấu Trúc Layout

```
[ Scene Navigator #sp-scenes-list ]  [ Shot Workspace #vw-workspace ]  [ Inspector #inspector-scenes ]
  - Status filter #sp-filter-status    - Shot Identity Card              - Bindings #vw-bindings-card
  - Scene groups                       - Visual Blueprint Card            - Lock #vw-lock-card
    - Scene header                     - Motion Blueprint Card            - Revisions #vw-revisions-card
      - Shot tree items                - Handoff Checklist Card
```

### 4.2 UI Labels (Vietnamese-First)

| Element | Label |
|:---|:---|
| Workspace tab | Hình ảnh & Cảnh |
| Scene group | Cảnh |
| Shot item | Cảnh quay |
| Image prompt card | Bản thiết kế hình ảnh (Visual Blueprint) + Prompt hình ảnh (riêng biệt) |
| Veo prompt card | Bản thiết kế chuyển động (Motion Blueprint) + Prompt chuyển động Veo (riêng biệt) |
| Handoff card | Danh sách bàn giao |
| Bindings card | Ràng buộc thực thể & phong cách |
| Lock card | Khóa & Siêu dữ liệu cảnh quay |
| Revisions card | Lịch sử sửa đổi |
| Lock button | Khóa cảnh quay |
| Unlock button | Mở khóa cảnh quay |
| Status filter | Lọc theo trạng thái |
| Status: all | Tất cả |
| Status: ready | Sẵn sàng |
| Status: outdated | Cần cập nhật |
| Status: locked | Đã khóa |

---

## 5. JavaScript API

### loadVisualWorkbench(projectDir)
Entry point. Gọi /visual/summary và /visual/scenes song song.
Render Scene Navigator, cập nhật summary header.

### selectVisualShot(shotId, sceneId)
Load on-demand /visual/shots/{shotId}.
Render Shot Workspace và Inspector.

### copyVisualPrompt(type, shotId)
Copy text của image_prompt hoặc veo_prompt vào clipboard.
type: 'image' | 'veo'

### saveVisualPrompt(type, shotId)
PATCH /api/projects/{id}/visual/shots/{shotId} với trường prompt đã chỉnh sửa (cấp Shot).

### toggleShotLock(shotId)
POST /api/projects/{id}/lock/shot/{shotId}
Cập nhật trạng thái khóa và refresh UI.

### restoreShotRevision(revisionId)
POST /api/projects/{id}/history/{revisionId}/restore với **stable revision_id**
(không dùng array index; UI ánh xạ index hiển thị → revision_id qua `data-rev-id`).

---

## 6. Quy Trình Thủ Công (Manual Workflow)

Visual Workbench KHÔNG tự động hóa việc gửi prompts đến Google Flow / Veo.
Quy trình thủ công được hỗ trợ:

1. Mở Bản thiết kế hình ảnh → Click "Sao chép" → Paste vào Google Flow/Imagen
2. Mở Bản thiết kế chuyển động → Click "Sao chép" → Paste vào Google Veo
3. Sau khi xuất asset → Điền vào Danh sách bàn giao
4. Khi cảnh quay hoàn thiện → Click "Khóa cảnh quay"

---

## 7. Giới Hạn & Ghi Chú Kỹ Thuật

- `image_prompt` là **cấp Shot** (`veo_prompts.json` shot record) — mỗi Shot có identity độc lập,
  chỉnh Shot A không ảnh hưởng Shot B/C. `image_prompts.json` cấp Scene chỉ là fallback
  tương thích ngược khi Shot chưa có override (không bao giờ bị PATCH cấp Shot chạm tới).
- **Blueprint khác Prompt:** sửa prompt của nhà cung cấp không viết lại Blueprint; sửa Blueprint sẽ đánh dấu prompt phụ thuộc là `OUTDATED` (giữ nguyên nội dung, chờ người dùng xử lý, không tự tái sinh).
- Visual Router (`studio/visual_router.py`) tất định, không LLM; không phải Shot nào cũng qua Veo
  (STATIC_IMAGE / EVIDENCE / EDITOR_MOTION cho artifact, timeline, comparison, anatomy/science).
- Bàn giao Flow/Veo hoàn toàn thủ công (copy tay, không upload/spend tự động).
- Vòng đời candidate ảnh (GENERATED → SELECTED → APPROVED → LOCKED / REJECTED): N/A trong
  fixture tham chiếu hiện tại (chưa có bảng candidate); approval/lock/freshness là 3 chiều độc lập,
  LOCKED + OUTDATED cùng tồn tại hợp lệ.
- LockManager đọc từ SQLite state store; nếu store chưa khởi tạo thì `is_locked = False`.
- Scene Navigator chỉ hiển thị shot_ids từ scene lightweight endpoint;
  shot details không được preload để tránh gánh nặng khởi tạo.
