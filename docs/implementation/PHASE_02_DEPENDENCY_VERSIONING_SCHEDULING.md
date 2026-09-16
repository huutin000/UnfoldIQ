# TÀI LIỆU THIẾT KẾ KIẾN TRÚC & QUY CHUẨN THỰC THI PHASE 2
## PHASE 02: DEPENDENCY ENGINE, VERSIONING, LOCKING, CACHE IDENTITY & LOCAL RESOURCE SCHEDULING

> **Phân kỳ:** Phase 2  
> **Trạng thái thực thi:** IN PROGRESS  
> **Điều kiện tiên quyết:** Phase 1 PASS / FINAL / VERIFIED (Baseline 451/451 canonical tests passed).  
> **Tài liệu căn cứ:** `docs/implementation/implementation_plan.md`, `UNFOLDIQ-PHASE02-IMPLEMENTATION-PROMPT.md`  

---

### 1. Mục Tiêu (Objective)
Thiết lập lớp điều khiển trạng thái sản xuất (Production-State Control Layer) hoàn chỉnh cho UnfoldIQ Workstation:
1. **Quản lý Đồ thị Phụ thuộc (Artifact-Level DAG):** Nhận biết chính xác thực thể nào đã thay đổi, thực thể nào phụ thuộc, và lan truyền vô hiệu hóa vi mô (micro-propagation invalidation) mà không làm ô nhiễm các nhánh không liên quan.
2. **Mô hình Trạng thái 4 Tầng & Chặn Thao Tác (Blockers):** Phân định rành mạch giữa Base Review Status (`DRAFT`, `NEEDS_REVIEW`, `READY`), Freshness Status dẫn xuất (`OUTDATED`), và Chốt chặn rõ ràng (`BLOCKERS`), tuân thủ thứ tự ưu tiên hiển thị:
   $$\mathbf{BLOCKED} > \mathbf{OUTDATED} > \mathbf{NEEDS\_REVIEW} > \mathbf{DRAFT} > \mathbf{READY}$$
3. **Định danh Nội dung Chuẩn tắc & Khóa Bộ Nhớ Đệm Hỗn Hợp (Composite Cache Key):** Sử dụng SHA-256 trên nội dung thực tế (loại bỏ siêu dữ liệu bay màu như timestamp `updated_at`); kết hợp mã băm phụ thuộc, thông tin provider, model, seed và settings.
4. **Hệ thống Lịch sử Phiên bản Thực thụ (`ArtifactRevision`):** Tạo checkpoint lịch sử chỉ khi có sự kiện có ý nghĩa (`GENERATE`, `REGENERATE`, `APPROVE`, `REPLACE_ASSET`, `RESTORE`, `MANUAL`). Tuyệt đối không tạo revision từ tác vụ lưu tự động (`Autosave`). Khôi phục (`Restore`) bảo toàn tuyệt đối Stable ID và ghi nhận lịch sử khôi phục.
5. **Cơ Chế Khóa An Toàn (`is_locked`):** Khóa bảo vệ Story Beat, Audio Chunk, Scene Timing, Shot Card, Media Asset khỏi các lệnh tạo lại hàng loạt (`bulk regenerate`) hoặc tự động; nhưng vẫn cho phép chuyển sang `OUTDATED` khi nút thượng nguồn thay đổi.
6. **Công Cụ Gợi Ý Hành Động Tiếp Theo Tối Ưu (`NextBestActionService`):** Đưa ra khuyến nghị tiếp theo mang tính tất định (deterministic rule-based) dựa trên nút bị chặn hoặc lỗi thời gần nhất, không phụ thuộc LLM hay API bên ngoài.
7. **Kho Lưu Trữ Trạng Thái Giao Dịch (`SQLite State Store`):** Cơ sở dữ liệu SQLite cục bộ theo từng dự án (`projects/<id>/state.db`) đảm bảo tính toàn vẹn giao dịch (ACID), an toàn khi ứng dụng khởi động lại hoặc gặp sự cố.
8. **Bộ Điều Phối Tài Nguyên Cục Bộ (`LocalResourceScheduler`):** Phân loại tài nguyên (`CUDA_HEAVY`, `GPU_ENCODER`, `CPU_BOUND`, `IO_BOUND`), áp dụng `CUDA_HEAVY concurrency=1` cho GPU 4GB (RTX 3050), tích hợp `ResourceGuard` bảo vệ VRAM chống OOM.

---

### 2. Phạm Vi Thực Thi (Scope)
- `studio/domain_models.py`: Bổ sung enums và schemas cho DAG node, edge, revision, blocker, next action, scheduler job.
- `studio/state_store.py`: Module quản lý SQLite state database theo chuẩn ACID.
- `studio/dependency_graph.py`: Cấu trúc DAG, thuật toán phát hiện chu trình (DFS/cycle detection), lan truyền vi mô, định danh SHA-256 và composite cache key.
- `studio/version_manager.py`: Quản lý revision, checkpoint, và restore logic.
- `studio/locking.py`: Quy tắc thực thi khóa an toàn, ngăn chặn ghi đè.
- `studio/next_action.py`: Dịch vụ tính toán Next Best Action theo luật ưu tiên.
- `studio/resource_scheduler.py`: Bộ điều phối phân lớp tài nguyên với queue, semaphore, cancellation, và ResourceGuard.
- `studio/smart_render.py`: Tích hợp kiểm tra khóa và DAG trước khi render.
- `studio/app.py`: Đăng ký các endpoints REST API Phase 2.
- `tests/test_phase02_dependency_versioning_scheduler.py`: Test suite toàn diện bao phủ 100% yêu cầu Phase 2.

### Ngoài Phạm Vi (Out of Scope)
- Tuyệt đối không can thiệp vào giao diện người dùng CSS, HTML, template (dành cho Phase 3).
- Không thêm thư viện ngoài (dùng hoàn toàn thư viện chuẩn Python `sqlite3`, `hashlib`, `asyncio`).
- Không làm gián đoạn các API tương thích Phase 1 cũ.

---

### 3. Mô Hình Thực Thể & Trạng Thái (Domain Contracts)

#### 3.1. Các Enums Trọng Yếu
```python
class ReviewStatus(str, Enum):
    DRAFT = "DRAFT"
    NEEDS_REVIEW = "NEEDS_REVIEW"
    READY = "READY"

class DerivedFreshness(str, Enum):
    CURRENT = "CURRENT"
    OUTDATED = "OUTDATED"

class EffectiveStatus(str, Enum):
    BLOCKED = "BLOCKED"
    OUTDATED = "OUTDATED"
    NEEDS_REVIEW = "NEEDS_REVIEW"
    DRAFT = "DRAFT"
    READY = "READY"

class ResourceClass(str, Enum):
    CUDA_HEAVY = "CUDA_HEAVY"      # Whisper, Kokoro bulk (concurrency=1)
    GPU_ENCODER = "GPU_ENCODER"    # NVENC render (concurrency=1)
    CPU_BOUND = "CPU_BOUND"        # CPU-heavy audio/video tasks (concurrency=bounded)
    IO_BOUND = "IO_BOUND"          # File read/write/network (concurrency=bounded)

class JobState(str, Enum):
    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"
```

#### 3.2. Cấu Trúc Đồ Thị Phụ Thuộc (DAG)
Các node trong DAG liên kết các cấp độ dữ liệu:
$$\text{StoryBeat} \longrightarrow \text{AudioChunk} \longrightarrow \text{SceneTiming} \longrightarrow \text{Scene / Shot} \longrightarrow \text{Prompt / Media}$$

Mỗi Node gồm:
- `artifact_id`: Stable ID duy nhất sinh từ Phase 1.
- `artifact_type`: Loại artifact (`story_beat`, `audio_chunk`, `scene_timing`, `shot`, `media_asset`).
- `content_hash`: SHA-256 của các trường ngữ nghĩa thực tế.
- `review_status`: Trạng thái duyệt người dùng (`DRAFT`, `NEEDS_REVIEW`, `READY`).
- `is_outdated`: Cờ dẫn xuất từ sự thay đổi băm của nút cha thượng nguồn.
- `is_locked`: Cờ bảo vệ chống ghi đè tự động.
- `blockers`: Danh sách các lỗi/ràng buộc chưa thỏa mãn.
- `effective_status`: Trạng thái hợp thành dựa trên thứ tự ưu tiên chuẩn tắc.

---

### 4. Quy Tắc Lan Truyền Vô Hiệu Hóa Vi Mô (Micro-propagation)
1. Khi `StoryBeat A` bị sửa đổi nội dung:
   - Tính toán lại `content_hash` của A.
   - Chỉ có nhánh con trực tiếp của A (ví dụ: `AudioChunk A`, timing liên quan đến A, `Shot` liên quan đến A) được đánh dấu `OUTDATED`.
   - Các nhánh anh em độc lập (`StoryBeat B`, `AudioChunk B`, `Shot B`) hoàn toàn giữ nguyên trạng thái `READY` hiện tại.
2. Phát hiện chu trình: Nếu đồ thị xuất hiện cạnh khép kín (ví dụ $A \rightarrow B \rightarrow C \rightarrow A$), hệ thống lập tức từ chối và ném ra ngoại lệ `CycleDetectedError`.

---

### 5. Lịch Sử Phiên Bản & Khôi Phục (ArtifactRevision & Restore)
- `ArtifactRevision` lưu trữ snapshot dữ liệu ngữ nghĩa tại thời điểm kiểm tra.
- Quy tắc:
  - Chỉ các sự kiện sau mới tạo revision: `GENERATE`, `REGENERATE`, `APPROVE`, `REPLACE_ASSET`, `RESTORE`, `MANUAL`.
  - Tác vụ `Autosave` chỉ ghi đè vào trạng thái đang làm việc (working state), tuyệt đối **KHÔNG** tạo bản ghi revision.
  - Thao tác `Restore` lấy dữ liệu snapshot cũ, khôi phục vào working state, giữ nguyên vẹn `artifact_id`, và tạo 1 revision mới mang loại sự kiện `RESTORE` tham chiếu `source_revision_id`.

---

### 6. Khóa Bảo Vệ (`is_locked`)
- Khi một artifact có `is_locked = True`:
  - Mọi thao tác `bulk_regenerate` hoặc sinh tự động nền đều bỏ qua artifact này.
  - Dữ liệu của artifact không bị ghi đè.
  - **Tuy nhiên**, nếu artifact thượng nguồn bị đổi, artifact bị khóa vẫn chuyển sang `OUTDATED` để cảnh báo trực quan cho người dùng.
  - Người dùng muốn sinh lại bắt buộc phải thực hiện thao tác mở khóa (`unlock`) tường minh.

---

### 7. Điều Phối Tài Nguyên & Ngăn Ngừa OOM (`LocalResourceScheduler`)
- Trên máy trạm cấu hình GPU 4GB (NVIDIA RTX 3050 Laptop GPU):
  - `CUDA_HEAVY` (Kokoro bulk generation, Faster-Whisper transcription) áp dụng `concurrency = 1`.
  - `GPU_ENCODER` áp dụng `concurrency = 1`.
  - Hàng đợi FIFO thông minh thông qua `asyncio.Queue` và `asyncio.Semaphore`.
  - Giải phóng permit đảm bảo 100% trong khối `finally`, không gây rò rỉ permit hay deadlock kể cả khi có ngoại lệ hoặc lệnh hủy (`cancel`).
  - `ResourceGuard` kiểm tra dung lượng VRAM trống và không gian đĩa; từ chối chạy song song `CUDA_HEAVY` và `GPU_ENCODER` nếu ngân sách bộ nhớ không an toàn.

---

### 8. Tiêu Chuẩn Nghiệm Thu (Acceptance Matrix)
- [ ] 100% tests của Phase 1 tiếp tục PASS (451/451 tests baseline).
- [ ] Test suite mới của Phase 2 bao phủ đầy đủ DAG, status precedence, hash/cache, revision, lock, next-action, scheduler, persistence, và API.
- [ ] Dữ liệu dự án tham chiếu 79 cảnh được bảo toàn nguyên vẹn 100%.
- [ ] Không có thay đổi nào trên giao diện người dùng frontend (Zero UI scope).
