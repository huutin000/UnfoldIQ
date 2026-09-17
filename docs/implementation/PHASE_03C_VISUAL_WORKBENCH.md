# PHASE_03C_VISUAL_WORKBENCH.md
# TÀI LIỆU KỸ THUẬT — VISUAL WORKBENCH (SUBPHASE 3C)

> **Module:** Hình ảnh & Cảnh (Visual Workbench)  
> **Workspace ID:** scenes  
> **Phiên bản:** 1.0.0  
> **Ngày:** 2026-09-17

---

## 1. Tổng Quan

Visual Workbench là không gian làm việc trung tâm cho quy trình thiết kế hình ảnh:
- Xem và điều hướng cấu trúc phân cấp **Cảnh (Scenes) → Cảnh quay (Shots)**
- Chỉnh sửa **Bản thiết kế hình ảnh** (Image Prompt cho Google Flow/Imagen)
- Chỉnh sửa **Bản thiết kế chuyển động** (Veo Prompt cho Google Veo)
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
Bao gồm image_prompt từ image_prompts.json của cảnh cha.

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
| Image prompt card | Bản thiết kế hình ảnh |
| Veo prompt card | Bản thiết kế chuyển động |
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
PATCH /api/projects/{id}/visual/shots/{shotId} với trường prompt đã chỉnh sửa.

### toggleShotLock(shotId)
POST /api/projects/{id}/lock/shot/{shotId}
Cập nhật trạng thái khóa và refresh UI.

### restoreVisualRevision(shotId, revIndex)
Khôi phục revision tại index từ danh sách revision history.

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

- `image_prompt` là scene-level (không phải shot-level) trong `image_prompts.json` —
  tất cả shots thuộc cùng 1 scene chia sẻ cùng 1 image_prompt.
- Revision history phụ thuộc vào dữ liệu `revisions` field trong `veo_prompts.json`.
  Nếu field không tồn tại, card Lịch sử sửa đổi hiển thị trống.
- LockManager đọc từ SQLite state store; nếu store chưa khởi tạo thì `is_locked = False`.
- Scene Navigator chỉ hiển thị shot_ids từ scene lightweight endpoint;
  shot details không được preload để tránh gánh nặng khởi tạo.
