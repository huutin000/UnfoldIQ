# Subphase 3A Architecture & Implementation Guide: App Shell, Overview Workbench, and Story Workbench

## 1. Executive Summary
Subphase 3A represents **Sequential Gate 1 of Phase 3**, establishing the core App Shell navigation and transforming the single-textarea script view and blocking modals into modern, non-blocking workbenches:
1. **Canonical 5-Workbench Navigation**: Replaced fragmented legacy navigation with a unified 5-stage pipeline (`Tổng quan`, `Kịch bản`, `Giọng đọc`, `Hình ảnh & Cảnh`, `Xuất video`).
2. **Overview Workbench (`#ws-overview`)**: Integrated project metadata, Phase 2 deterministic **Next Best Action** recommendations (`/api/projects/{dir_name}/next-action`), and an embedded non-blocking **System Maintenance Drawer** (migrated from `modal-storage-manager`).
3. **Story Workbench (`#ws-story`)**: Built a professional 3-column workstation:
   - **Column 1 (Story Navigator)**: 138 story beats with stable `beat_id` selection (`beat_001`..`beat_138`), style tags, confidence scores, and instant selection.
   - **Column 2 (Story Workspace)**: Full script editor (`#script-input`) equipped with real-time dirty tracking badge (`Đã lưu` / `Chưa lưu`), live character/word counters, and explicit atomic save (`POST /api/projects/{dir_name}/script`).
   - **Column 3 (Story Inspector)**: Contextual beat details inspector combined with inline **Editorial QA** (migrated from `edq-modal`).
4. **Zero Capability Loss**: 3 blocking modals (`narration-beats-modal`, `modal-storage-manager`, `edq-modal`) were successfully relocated into native inline workbenches.
5. **Strict Scope Control**: No Phase 3B (Voice), 3C (Visual), or 3D (Export) redesign was introduced; legacy surfaces remain accessible and compatible.

---

## 2. Capability Migration Matrix

| Legacy Modal / Component | Subphase 3A Inline Destination | Accessibility & User Flow | Capability Status |
| :--- | :--- | :--- | :--- |
| `narration-beats-modal` (Phase 9) | **Story Navigator** (`#story-beats-container`) + **Beat Inspector** (`#story-beat-inspector-card`) | Always visible on the left; selecting a beat immediately loads details into the inspector without blocking the editor. | 100% Migrated (No capability loss) |
| `edq-modal` (Phase 12) | **Story Inspector** (`#story-edq-card`) | Embedded inline on the right; provides score badge, filter controls (Tất cả, Cần xem xét, Chặn), Before/After comparison, and one-click "Áp dụng sửa câu". | 100% Migrated (No capability loss) |
| `modal-storage-manager` (Phase 15A) | **Overview System Maintenance Drawer** (`#overview-system-maintenance`) | Embedded drawer inside Overview Workbench; provides storage breakdown, cleanup preview with data protection warning, and confirmed cleanup. | 100% Migrated (No capability loss) |

---

## 3. Data Flow & Endpoints

### 3.1 Overview Workbench
- `GET /api/projects/{dir_name}/v2/overview`: Returns `OverviewSlice` with `status_summary`, `stats` (including `shot_count: 141`, `duration_seconds: 665.64s`), and Phase 2 status badges.
- `GET /api/projects/{dir_name}/next-action`: Evaluates project DAG via `NextBestActionService` and returns deterministic next action:
  ```json
  {
    "action_type": "PROCEED_TO_EXPORT",
    "target_workbench": "export",
    "title": "Sẵn sàng xuất video",
    "reason": "Toàn bộ thực thể trong chu trình đều đồng bộ và đạt trạng thái READY. Sẵn sàng xuất bản gói sản xuất.",
    "label": "Xuất video ngay →",
    "priority": 5
  }
  ```
- `GET /api/storage/overview` & `POST /api/storage/cleanup/preview`: Powers the non-blocking system maintenance drawer.

### 3.2 Story Workbench
- `GET /api/projects/{dir_name}/story`: Returns `StorySlice` with `script_text` and `beats` mapped to stable IDs `beat_001` through `beat_138`.
- `POST /api/projects/{dir_name}/script`: Atomically writes new script text via temporary file swap (`replace_file_atomically`), synchronizes content hash, updates `script.json`, invalidates dependent downstream stages (`story_beat_root`), and returns updated character/word metrics.

---

## 4. UI Language Glossary Alignment
All visible text strictly complies with `UI_LANGUAGE_GLOSSARY.md`:
- `Tổng quan` (Overview)
- `Kịch bản & Tuyến truyện` (Story Workbench)
- `Giọng đọc` (Voice Workbench)
- `Hình ảnh & Cảnh` (Visual Workbench)
- `Xuất video` (Export Workbench)
- `Đã lưu` / `Chưa lưu` (Save Status Badges)
- `Bước tiếp theo khuyến nghị` (Next Best Action)
- `Bảo trì hệ thống & Quản lý bộ nhớ` (System Maintenance Drawer)
- `Kiểm định biên tập kịch bản` (Editorial QA)
