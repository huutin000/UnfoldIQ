# GIAI ĐOẠN 1: NỀN TẢNG LUỒNG CÔNG VIỆC & KIẾN TRÚC DỮ LIỆU
## PHASE 01 EXECUTION CONTRACT: WORKFLOW & DATA FOUNDATION

> **Tài liệu căn cứ:** `docs/implementation/implementation_plan.md` (Revision 2.0.0)  
> **Mã hợp đồng thực thi:** `PHASE-01-WDF`  
> **Trạng thái:** ACTIVE EXECUTION CONTRACT  
> **Ràng buộc tiên quyết:** Solo-first, Local-first, Free-first (0đ cloud API cost), bất biến chất lượng Master (WAV PCM 24kHz/16-bit Mono narration, video 1080p).

---

## 1. Objective (Mục tiêu)
Xây dựng nền tảng dữ liệu thực thể thống nhất với Stable IDs, thiết kế bộ API nạp dữ liệu chọn lọc (Selective & Contextual Loading), thiết lập Provider Boundaries tối thiểu cho TTS/STT để business logic không khóa vào Kokoro/Whisper, chuẩn hóa Fast Freshness Check `(st_mtime_ns, st_size)` kết hợp nguồn chân lý SHA-256, và bảo đảm tương thích ngược 100% với dữ liệu dự án hiện hữu.

---

## 2. Scope (Phạm vi Thực hiện)
1. **Domain Models V2 (`studio/domain_models.py`):**
   - Đặt `schema_version = "2.0.0"`.
   - Bổ sung định danh ổn định (Stable IDs): `beat_id`, `chunk_id`, `scene_id`, `shot_id`, `asset_id`.
   - Bổ sung các slice models: `StorySlice`, `VoiceSlice`, `VisualSlice`, `OverviewSlice`.
   - Bổ sung các mô hình phân mảnh ngữ cảnh Visual: `SceneSummary`, `VisualSummarySlice`, `VisualBibleSlice`.
2. **Provider Boundaries (`studio/providers/`):**
   - Tạo giao diện trừu tượng `TTSProvider` và `STTProvider` (`studio/providers/base.py`).
   - Xây dựng adapter bọc Kokoro (`KokoroTTSProvider`) và Faster-Whisper (`WhisperSTTProvider`).
3. **Selective & Contextual Loading (`studio/project_adapter.py`, `studio/app.py`):**
   - Không ép frontend phụ thuộc vào endpoint tải toàn bộ `/v2/state` hay `/visual` aggregate.
   - Endpoint tổng quan App Shell: `GET /api/projects/{id}/v2/overview`.
   - Endpoint Story Workbench: `GET /api/projects/{id}/story`.
   - Endpoint Voice Workbench: `GET /api/projects/{id}/voice`.
   - Hệ thống endpoint Visual theo ngữ cảnh làm việc (chịu tải 250–500+ Shots):
     - `GET /api/projects/{id}/visual/summary`: Tổng quan tiến độ, số cảnh/shot, entity counts.
     - `GET /api/projects/{id}/visual/scenes`: Danh sách cảnh siêu nhẹ cho Navigator (không chứa prompt nặng).
     - `GET /api/projects/{id}/visual/scenes/{scene_id}`: Chi tiết 1 cảnh và danh sách Shots trực thuộc.
     - `GET /api/projects/{id}/visual/shots/{shot_id}`: Chi tiết 1 thẻ Shot card khi người dùng click xem/sửa prompt.
     - `GET /api/projects/{id}/visual/bible`: Dữ liệu Visual Bible riêng biệt.
     - `GET /api/projects/{id}/visual`: Aggregate diagnostics endpoint nội bộ (tùy chọn, frontend không phụ thuộc).
4. **Fast Freshness Check vs. SHA-256 Identity (`studio/transcription_service.py`):**
   - `(st_mtime_ns, st_size)` được sử dụng làm Fast Freshness Check trong bộ nhớ đệm (`_audio_hash_cache`), bỏ qua đọc đĩa khi polling trạng thái phụ đề.
   - SHA-256 (Content Hash) là Source of Truth duy nhất cho cache identity và invalidation.
5. **An toàn Dữ liệu & Lưu trữ Nguyên tử (`studio/project_adapter.py`):**
   - Ghi file qua file tạm thời `.tmp.json` rồi thay thế nguyên tử (`replace`).
   - Tự động tạo snapshot sao lưu `.bak` cho các file dữ liệu dự án cũ (`scene_plan.json.bak`, `veo_prompts.json.bak`).

---

## 3. Out of Scope (Ngoài Phạm vi)
- Không triển khai đồ thị phụ thuộc phức tạp và lan truyền vi mô (chuyển sang Phase 2).
- Không triển khai lịch sử phiên bản `ArtifactRevision`, checkpoint generation và restore (chuyển sang Phase 2).
- Không triển khai LocalResourceScheduler khống chế concurrency GPU (chuyển sang Phase 2).
- Không sửa đổi hay tái cấu trúc giao diện CSS/HTML (chuyển sang Phase 3).
- Không can thiệp vào bộ render video xuất bản cuối cùng hay Media Export Pipeline (chuyển sang Phase 4).

---

## 4. Current → Target (Hiện trạng & Đích đến)
| Khía cạnh | Hiện trạng (Current) | Đích đến (Target) |
| :--- | :--- | :--- |
| **Nạp dữ liệu** | Phụ thuộc dàn trải nhiều file JSON hoặc gọi endpoint nặng tải toàn bộ dự án. | Phân vùng chọn lọc (`/story`, `/voice`, `/visual/scenes`, `/visual/summary`) theo đúng ngữ cảnh. |
| **Visual Navigator** | Phải tải toàn bộ mảng prompt nặng 364 KB để hiển thị danh sách cảnh. | Nạp danh sách Scene siêu nhẹ `SceneSummary` chỉ ~25 KB, nạp chi tiết theo nhu cầu. |
| **Tích hợp AI** | Business logic gọi trực tiếp hàm nội bộ của Kokoro và Faster-Whisper. | Decoupled hoàn toàn qua `TTSProvider` và `STTProvider`. |
| **Kiểm tra file** | Polling đọc đĩa và tính SHA-256 file 32MB mỗi giây một lần (31.9 MB/s I/O). | Fast freshness check `(mtime_ns, size)` trong $0.00\text{ ms}$, triệt tiêu 100% I/O lãng phí. |
| **Định danh thực thể**| Không đồng nhất, thiếu stable ID giữa các cảnh quay và phân đoạn. | Chuẩn hóa stable IDs (`beat_id`, `chunk_id`, `scene_id`, `shot_id`, `asset_id`). |

---

## 5. Exact Files / Modules Expected to Change
- `studio/domain_models.py` (Domain Schema V2, stable IDs, Slices, SceneSummary)
- `studio/providers/base.py` (TTSProvider & STTProvider interfaces, Result types)
- `studio/providers/kokoro_provider.py` (Kokoro adapter)
- `studio/providers/whisper_provider.py` (Faster-Whisper adapter)
- `studio/providers/__init__.py` (Provider exports)
- `studio/project_adapter.py` (Selective slice loaders & contextual visual loaders)
- `studio/transcription_service.py` (Fast freshness cache vs SHA-256)
- `studio/app.py` (Đăng ký selective & contextual endpoints)
- `tests/test_data_foundation.py` (Bộ kiểm thử tự động Phase 1)

---

## 6. Domain Model Changes
Khai báo cấu trúc thực thể Pydantic v2 chuẩn hóa trong `studio/domain_models.py`:
- `StoryBeat`: `beat_id`, `index`, `title`, `text`, `target_duration_seconds`, `estimated_word_count`.
- `AudioChunk`: `chunk_id`, `index`, `text`, `voice`, `speed`, `render_hash`, `audio_file`, `duration`, `is_locked`, `words`.
- `WordCue`: `word`, `start`, `end`, `score`.
- `Shot`: `shot_id`, `parent_scene_id`, `index`, `shot_type`, `camera_motion`, `aspect_ratio`, `veo_prompt`, `negative_prompt`, `continuity_anchor`, `subject_action`, `environmental_action`, `lighting_atmosphere`, `inherited_entities`.
- `Scene`: `scene_id`, `index`, `category`, `start`, `end`, `duration`, `visual_summary`, `narration`, `image_prompt`, `evidence_mode`, `shot_type`, `shots`.
- `AssetRef`: `asset_id`, `scene_id`, `shot_id`, `thumbnail_path`, `master_path`, `lifecycle_state`, `checksum`, `mime_type`.
- `SceneSummary`: `scene_id`, `index`, `category`, `start`, `end`, `duration`, `visual_summary`, `shot_count`, `shot_ids`, `has_narration`, `evidence_mode`.
- `VisualSummarySlice`: `project_id`, `total_scenes`, `total_shots`, `total_duration_seconds`, `visual_status`, `visual_bible_status`, `entity_counts`.
- `VisualBibleSlice`: `project_id`, `visual_bible`, `characters_count`, `environments_count`, `objects_count`, `status`.
- `ProjectV2State`: Thực thể hợp nhất với `schema_version="2.0.0"`.

---

## 7. API Contracts
| Endpoint | Method | Response Model | Mô tả chức năng |
| :--- | :---: | :--- | :--- |
| `/api/projects/{id}/v2/overview` | `GET` | `OverviewSlice` | Trạng thái tổng quan, số cảnh, trạng thái 5 Workbench (324 B). |
| `/api/projects/{id}/story` | `GET` | `StorySlice` | Kịch bản, StoryBeats, word count, estimated duration (~10 KB). |
| `/api/projects/{id}/voice` | `GET` | `VoiceSlice` | Audio chunks, settings giọng đọc, đường dẫn file audio (~29 KB). |
| `/api/projects/{id}/visual/summary` | `GET` | `VisualSummarySlice`| Tóm tắt tiến độ visual pipeline, số scene/shot, entity metrics (264 B). |
| `/api/projects/{id}/visual/scenes` | `GET` | `List[SceneSummary]`| Danh sách cảnh rút gọn cho Navigator, không kèm prompt nặng (25 KB). |
| `/api/projects/{id}/visual/scenes/{scene_id}` | `GET` | `Scene` | Chi tiết 1 cảnh và các Shot trực thuộc khi được chọn (6.4 KB). |
| `/api/projects/{id}/visual/shots/{shot_id}` | `GET` | `Shot` | Chi tiết 1 thẻ Shot card khi được click xem/sửa prompt (1.8 KB). |
| `/api/projects/{id}/visual/bible` | `GET` | `VisualBibleSlice` | Dữ liệu Visual Bible độc lập (24.9 KB). |
| `/api/projects/{id}/visual` | `GET` | `VisualSlice` | Aggregate diagnostics endpoint nội bộ (364 KB). |
| `/api/projects/{id}/v2/state` | `GET` | `ProjectV2State` | Snapshot hợp nhất toàn diện. |

---

## 8. Provider Interfaces
- `TTSProvider`:
  - `synthesize_chunk(text, voice, speed, output_path, **kwargs) -> AudioSynthesisResult`
  - `get_available_voices() -> List[Dict[str, Any]]`
  - `check_health() -> Dict[str, Any]`
- `STTProvider`:
  - `transcribe_segment(audio_path, language, **kwargs) -> TranscriptionResult`
  - `check_health() -> Dict[str, Any]`
- Concrete Adapters:
  - `KokoroTTSProvider`: Bọc `KokoroClient`.
  - `WhisperSTTProvider`: Bọc `transcription_service`.

---

## 9. Selective-Loading Design
- Không cho phép bất kỳ luồng người dùng nào trên frontend bị chặn bởi việc nạp dữ liệu toàn dự án.
- Visual Navigator gọi `/visual/scenes` chỉ nạp các trường cần thiết để vẽ danh sách bên trái.
- Khi người dùng tương tác với cảnh cụ thể, nạp theo lazy loading qua `/visual/scenes/{scene_id}`.
- Khi người dùng click vào thẻ Shot, nạp qua `/visual/shots/{shot_id}`.
- Cơ chế này bảo đảm khả năng mở rộng mượt mà ngay cả khi dự án mở rộng đến 250–500+ Shots.

---

## 10. Migration / Data Safety
- Tương thích ngược 2 chiều: `ProjectAdapter` tự động biên dịch và giữ đồng bộ với các file JSON legacy: `scene_plan.json`, `veo_prompts.json`, `timestamps.json`, `settings.json`.
- Ghi đĩa an toàn bằng nguyên tử hóa: Viết vào file `.tmp.json` rồi gọi `replace`.
- Trước khi ghi đè, tự động lưu lại bản sao `.bak` của các file JSON dự án.

---

## 11. Tests
Bộ test chuyên biệt `tests/test_data_foundation.py` bao gồm 9 bài kiểm thử độc lập:
1. `test_domain_models_instantiation`: Xác minh các model Pydantic v2 khởi tạo chuẩn xác.
2. `test_project_adapter_loads_real_project`: Xác minh adapter nạp dự án 79 cảnh và 141 shots.
3. `test_fast_audio_hash_caching`: Xác minh cache hit $< 1\text{ ms}$ cho băm file.
4. `test_check_project_timestamps_status_speed`: Xác minh kiểm tra trạng thái polling siêu tốc $< 10\text{ ms}$.
5. `test_api_get_project_v2_state`: Xác minh endpoint trạng thái hợp nhất trả về đúng cấu trúc.
6. `test_project_adapter_save_creates_backup`: Xác minh ghi nguyên tử và tạo bản sao `.bak`.
7. `test_selective_slice_endpoints`: Xác minh 4 endpoint phân vùng `/v2/overview`, `/story`, `/voice`, `/visual`.
8. `test_provider_abstractions`: Xác minh tính đa hình và độc lập của `TTSProvider`/`STTProvider`.
9. `test_contextual_visual_endpoints`: Xác minh toàn bộ các endpoint ngữ cảnh visual (`/summary`, `/scenes`, `/scenes/{id}`, `/shots/{id}`, `/bible`) cùng xử lý lỗi 404.

---

## 12. Regression Tests
Chạy toàn bộ test suite của kho mã nguồn để kiểm tra hồi quy:
```powershell
$env:PYTHONPATH="."; python -m pytest tests/ -v
```
Yêu cầu: 100% tests phải PASS (bao gồm hardening, voice qa, visual continuity, timeline, project isolation).

---

## 13. Performance Measurements
Đo đạc trên phần cứng thực tế (Intel i5-11400H / RTX 3050 Laptop / NVMe SSD) trên dự án `2026-09-12_210003_youtube-narration-01`:
- Polling status latency: $< 1.0\text{ ms}$ (đo thực tế: $0.00\text{ ms}$).
- I/O đọc đĩa khi polling: $0\text{ MB/s}$ (triệt tiêu hoàn toàn 31.9 MB/s cũ).
- Visual Summary latency: $< 10.0\text{ ms}$ (đo thực tế: $8.90\text{ ms}$).
- Lightweight Scenes latency: $< 15.0\text{ ms}$ (đo thực tế: $9.53\text{ ms}$, payload giảm 93%).
- Scene Detail latency: $< 15.0\text{ ms}$ (đo thực tế: $7.96\text{ ms}$).
- Shot Detail latency: $< 15.0\text{ ms}$ (đo thực tế: $6.82\text{ ms}$).
- Story Slice latency: $< 10.0\text{ ms}$ (đo thực tế: $3.13\text{ ms}$).
- Voice Slice latency: $< 10.0\text{ ms}$ (đo thực tế: $6.44\text{ ms}$).

---

## 14. Acceptance Criteria
- [ ] Các endpoint phân vùng và ngữ cảnh (`/v2/overview`, `/story`, `/voice`, `/visual/summary`, `/visual/scenes`, `/visual/scenes/{id}`, `/visual/shots/{id}`, `/visual/bible`) trả về mã 200 với dữ liệu chuẩn hóa của dự án 79 cảnh.
- [ ] Frontend không bị phụ thuộc vào endpoint tải toàn bộ (`/v2/state` hoặc `/visual` aggregate); danh sách Visual Navigator `/visual/scenes` không chứa trường prompt nặng.
- [ ] Provider interfaces bọc trọn vẹn Kokoro và Faster-Whisper mà không rò rỉ mã phụ thuộc vào router chính.
- [ ] Fast freshness check bằng `(st_mtime_ns, st_size)` đạt độ trễ $< 1.0\text{ ms}$ trên cache hit; SHA-256 là source of truth duy nhất cho cache identity.
- [ ] Toàn vẹn 100% dữ liệu thực thể và quan hệ cha-con của dự án mẫu.
- [ ] 100% các bài kiểm thử nền tảng và hồi quy tiếp tục PASS.

---

## 15. Rollback
- Khi có bất kỳ sự cố phá vỡ nào không thể khắc phục trong Phase 1:
  ```powershell
  git reset --hard audit-complete-baseline
  ```
- Dữ liệu dự án thử nghiệm được khôi phục từ thư mục sao lưu `projects/.backup_2026-09-12_baseline/`.

---

## 16. Phase Completion Report Requirements
Khi kết thúc Phase 1, bắt buộc tạo báo cáo `docs/implementation/PHASE_01_IMPLEMENTATION_REPORT.md` với đầy đủ 14 mục chuẩn chỉ:
1. Status: PASS / PARTIAL / FAIL
2. Files Changed
3. Scope item → implementation mapping
4. API Changes & contracts
5. Data Model changes
6. Provider Boundaries
7. Selective Loading proof
8. Performance Before / After
9. Tests & exact pass/fail counts
10. Data Integrity results
11. Remaining issues / risks
12. Acceptance Criteria verdict
13. Git Diff Summary
14. Phase Gate Verdict: `READY FOR PHASE 2` hoặc `NOT READY FOR PHASE 2`.
