# BÁO CÁO KIỂM ĐỊNH TOÀN DIỆN VÀ ĐÓNG GÓI CHÍNH THỨC PHASE 2
## UnfoldIQ Phase 2: Engine Core, State Store & DAG Execution Contract

- **Dự án**: UnfoldIQ Studio Engine
- **Ngày kiểm định**: 2026-09-16
- **Phạm vi kiểm định**: Hoàn tất toàn diện Phase 2 theo 10 chốt chặn kỹ thuật (Gates A – J). Không xâm lấn Phase 3 UI.
- **Trạng thái phê duyệt**: **PASS / FINAL — READY TO START SUBPHASE 3A**

---

## 1. TỔNG QUAN ĐIỀU HÀNH (EXECUTIVE SUMMARY)

Phase 2 của dự án UnfoldIQ chịu trách nhiệm xây dựng và chuẩn hóa toàn bộ nền tảng lõi:
1. **Dependency Graph (DAG)**: Quản lý phụ thuộc đa cấp (Script -> Chunks -> Audio -> Visual Prompts -> Video Clips -> Timeline Manifest) với cơ chế đánh dấu Closure `OUTDATED` tự động.
2. **Deterministic Composite Cache Key**: Tính toán hash cache key dựa trên effective input thuần túy, loại bỏ hoàn toàn metadata thực thể để đảm bảo chia sẻ/tái sử dụng kết quả sinh giữa các artifact tương đương.
3. **Canonical Version Manager & State Store**: Quản lý lịch sử revision, restore transactional, và lock persistence bền vững qua các phiên làm việc và restart tiến trình.
4. **API Domain Error Contract**: Chuẩn hóa toàn bộ lỗi nghiệp vụ thành HTTP 4xx (400, 404, 409) có cấu trúc, loại bỏ 100% lỗi unhandled 500 cho các tình huống dự kiến.
5. **Concurrency & Resource Scheduling**: Đảm bảo an toàn luồng SQLite với timeout 30s và exponential retry; bảo vệ tài nguyên GPU/CPU (ResourceGuard) tích hợp nhận diện phần cứng NVIDIA thực tế trên máy host.

Toàn bộ 10/10 cổng kiểm tra kỹ thuật (Gates A - J) đều đạt kết quả **PASS**. Toàn bộ bộ kiểm thử hồi quy gồm **479/479 tests** (100%) vượt qua thành công mà không có lỗi hay bỏ qua nào.

---

## 2. XÁC MINH CƠ CHẾ ĐỊNH DANH CACHE (GATE A: CACHE IDENTITY)

### 2.1. Yêu cầu & Thay đổi Kiến trúc
- **A1 (Tách biệt Identity khỏi Location/Artifact ID)**: Khóa cache tổng hợp `composite_cache_key` phải được tính toán hoàn toàn từ *effective input*, không phụ thuộc vào `artifact_id`. Hai artifact khác nhau có cùng nội dung, prompt, audio, model, seed, params, và code version bắt buộc phải sinh ra cùng một `composite_cache_key`.
- **A2 (Độ nhạy độc lập với 7 yếu tố đầu vào)**: Đã kiểm chứng độc lập rằng bất kỳ thay đổi nào trong 7 yếu tố sau đều tạo ra cache key khác nhau:
  1. `prompt_content` (Nội dung prompt hoặc script chunk)
  2. `model_name` (Mô hình sinh hình ảnh/âm thanh, vd: kokoro, flux-schnell, v.v.)
  3. `model_version` (Phiên bản checkpoint/trọng số mô hình)
  4. `generation_parameters` (Kích thước khung hình, bước lấy mẫu, sampler, v.v.)
  5. `seed` (Hạt giống ngẫu nhiên)
  6. `upstream_dependencies_hash` (Hash đầu ra của các nút phụ thuộc thượng nguồn, vd: audio hash)
  7. `code_generation_version` (Phiên bản pipeline/code logic sinh)
- **A3 (Bảo tồn Lineage Metadata)**: `artifact_id` vẫn được lưu trữ nguyên vẹn trong đối tượng `CacheKeyRecord` làm metadata phục vụ việc truy vết nguồn gốc (lineage), nhưng không tham gia vào chuỗi băm `effective_inputs_dict`.

### 2.2. Bằng chứng kiểm thử
- Script kiểm định: `tests/test_phase02_gap_verification.py::TestPhase02Gates::test_gate_a_cache_identity_cross_reuse` và `test_gate_a_sensitivity_to_7_factors`.
- File bằng chứng: `temp/phase02_final_verification/cache/audit_evidence.json`.
- Kết quả: **PASS**.

---

## 3. CHUẨN HÓA MÃ LỖI API DOMAIN (GATE B: API ERROR MAPPING)

### 3.1. Yêu cầu & Chuẩn hóa
Toàn bộ các endpoint nghiệp vụ Phase 2 trong `studio/app.py` đã được bọc xử lý lỗi miền chặt chẽ:
- **HTTP 404 (PROJECT_NOT_FOUND)**: Khi `project_id` không tồn tại trong hệ thống.
- **HTTP 404 (REVISION_NOT_FOUND)**: Khi cố gắng truy vấn hoặc khôi phục một `revision_id` không tồn tại.
- **HTTP 400 (INVALID_ARTIFACT_TYPE)**: Khi truyền loại artifact không nằm trong tập hợp hợp lệ (`VALID_ARTIFACT_TYPES`).
- **HTTP 409 (LOCK_CONFLICT)**: Khi yêu cầu khôi phục (`restore_revision`) trên một artifact đang bị khóa (`is_locked=True`) mà không có cờ `override_lock=True`.

Mọi phản hồi lỗi đều tuân thủ cấu trúc JSON tiêu chuẩn:
```json
{
  "error": {
    "code": "PROJECT_NOT_FOUND | REVISION_NOT_FOUND | INVALID_ARTIFACT_TYPE | LOCK_CONFLICT",
    "message": "Human readable detail in English",
    "details": { ... }
  }
}
```
Không còn bất kỳ lỗi client-domain nào bị rơi vào unhandled HTTP 500.

### 3.2. Bằng chứng kiểm thử
- Script kiểm định: `tests/test_phase02_gap_verification.py::TestPhase02Gates::test_gate_b_api_error_mapping`.
- File bằng chứng: `temp/phase02_final_verification/api/audit_evidence.json`.
- Kết quả: **PASS** (Zero unhandled 500s).

---

## 4. TÍNH BỀN VỮNG CỦA KHÓA ARTIFACT (GATE C: LOCK PERSISTENCE)

### 4.1. Cơ chế hoạt động
- Khóa (`ArtifactLock`) được lưu trữ trực tiếp trong cơ sở dữ liệu SQLite thông qua bảng `artifact_locks` và ánh xạ qua `StateStore`.
- Khi đóng dự án, dừng server hoặc khởi động lại tiến trình Python, toàn bộ thông tin khóa được bảo toàn 100%.
- **Sự cùng tồn tại của Lock và Outdated**: Một node có thể đồng thời vừa ở trạng thái `is_locked = True` vừa có `status = OUTDATED`. Khóa ngăn chặn việc ghi đè/sinh lại tự động ngoài ý muốn, trong khi `OUTDATED` ghi nhận trung thực việc thượng nguồn đã thay đổi.
- **Quy tắc khôi phục an toàn (Safe Restore Contract)**:
  - Nếu node bị khóa và gọi `restore_revision` không có `override_lock=True`, hệ thống từ chối và ném `LockConflictError` (HTTP 409).
  - Khi `override_lock=True`, hệ thống cho phép khôi phục nội dung revision nhưng vẫn bảo lưu trạng thái `is_locked = True` sau khi khôi phục.

### 4.2. Bằng chứng kiểm thử
- Script kiểm định: `tests/test_phase02_gap_verification.py::TestPhase02Gates::test_gate_c_lock_persistence_and_restore_conflict`.
- File bằng chứng: `temp/phase02_final_verification/locks/audit_evidence.json`.
- Kết quả: **PASS**.

---

## 5. ĐỒNG THỜI VÀ CHIẾN LƯỢC NHẬT KÝ SQLITE (GATE D: CONCURRENCY & JOURNAL)

### 5.1. Quyết định kỹ thuật: Chế độ Rollback Journal `DELETE` + Bounded Retry
Trên môi trường Windows, việc sử dụng chế độ `WAL` (Write-Ahead Logging) có thể gặp phải các vấn đề về khóa file ngầm (file locking semantics) khi nhiều tiến trình hoặc thread truy cập song song và tạo các file `-shm` / `-wal`.
Do đó, UnfoldIQ quyết định áp dụng:
1. Chế độ nhật ký chuẩn: `DELETE` mode với tính toàn vẹn ACID tuyệt đối.
2. Thiết lập timeout: `PRAGMA busy_timeout = 30000;` (30 giây) ngay khi khởi tạo kết nối.
3. Cơ chế thử lại có giới hạn (Bounded Exponential Backoff): Lớp `StateStore.transaction()` tự động bắt lỗi `sqlite3.OperationalError: database is locked` và thực hiện thử lại tối đa 3 lần với khoảng chờ tăng dần ngẫu nhiên (50ms - 200ms).

### 5.2. Bằng chứng kiểm thử
- Thực nghiệm kiểm thử đồng thời với 4 luồng đọc (Readers) và 2 luồng ghi (Writers) hoạt động liên tục trong 1 giây.
- Kết quả: Toàn bộ 100% các thao tác đọc và ghi đều thành công, 0 dữ liệu bị hỏng (corrupted), 0 giao dịch bị deadlock.
- File bằng chứng: `temp/phase02_final_verification/persistence/audit_evidence.json`.
- Kết quả: **PASS**.

---

## 6. LẬP LỊCH TÀI NGUYÊN VÀ NHẬN DIỆN PHẦN CỨNG THỰC TẾ (GATE E: SCHEDULER EVIDENCE)

### 6.1. Nhận diện phần cứng Host & ResourceGuard
- **Phát hiện VRAM thực tế**: Hệ thống Python của dự án chạy trong môi trường host mà không cài sẵn PyTorch (PyTorch được đóng gói biệt lập trong Kokoro virtualenv). `ResourceGuard.get_vram_info()` đã được bổ sung cơ chế fallback trực tiếp sang lệnh hệ thống `nvidia-smi`.
- **Kết quả đo đạc thực tế trên máy chạy**:
  - GPU: **NVIDIA GeForce RTX 3050 Laptop GPU**
  - VRAM Tổng: **4,096 MB (4.0 GB)**
  - VRAM Khả dụng: **~3,960 MB**
- **Chuẩn hóa tuyên bố kỹ thuật**:
  - Không sử dụng tuyên bố tuyệt đối sai lệch ("ResourceGuard eliminates all OOM").
  - Tuyên bố chính xác: *"ResourceGuard manages execution slots and hardware limits, reducing GPU memory contention; tested concurrency scenarios completed with 0 CUDA OOM."*
- Bổ sung property tiện ích `@property def active_counts(self)` để phục vụ giám sát.

### 6.2. Bằng chứng kiểm thử
- Script kiểm định: `tests/test_phase02_gap_verification.py::TestPhase02Gates::test_gate_e_scheduler_vram_and_scoped_oom`.
- File bằng chứng: `temp/phase02_final_verification/scheduler/audit_evidence.json`.
- Kết quả: **PASS**.

---

## 7. NGỮ NGHĨA HỦY HIỆU LỰC GIAO DỊCH (GATE F: TRANSACTIONAL INVALIDATION)

### 7.1. Nguyên tắc cốt lõi
Hệ thống DAG không được phép đánh dấu các node hạ nguồn thành `OUTDATED` trong quá trình sinh thử nghiệm (candidate generation) hoặc khi quá trình sinh bị lỗi/aborted.
- **Thao tác Abort/Fail**: Khi một candidate generation thất bại hoặc bị hủy, hash của artifact không thay đổi. Các node hạ nguồn giữ nguyên trạng thái `READY` / `CURRENT`.
- **Thao tác Commit**: Chỉ khi một artifact mới được ghi nhận thành công và commit một hash mới khác với hash cũ, giao dịch cập nhật DAG mới kích hoạt việc duyệt DFS để đánh dấu toàn bộ hạ nguồn bị ảnh hưởng thành `OUTDATED`.

### 7.2. Bằng chứng kiểm thử
- Script kiểm định: `tests/test_phase02_gap_verification.py::TestPhase02Gates::test_gate_f_transactional_invalidation_on_commit_only`.
- File bằng chứng: `temp/phase02_final_verification/dependency/audit_evidence.json`.
- Kết quả: **PASS**.

---

## 8. LÀM RÕ PHƯƠNG PHÁP ĐO HIỆU NĂNG BENCHMARK (GATE G: BENCHMARK METHODOLOGY)

### 8.1. Phân định ranh giới đo lường
Các báo cáo trước đây trích dẫn số liệu `p95 = 0.0003 ms` mà không nêu rõ điều kiện đo. Báo cáo này chuẩn hóa và phân tách minh bạch hai trường hợp:
1. **In-memory Downstream Closure Marking (`in_memory_downstream_closure_marking`)**:
   - Thao tác: Duyệt đồ thị DFS trên cấu trúc bộ nhớ Python (in-memory adjacency list) với 100 nút phụ thuộc.
   - Kết quả: **p95 = 0.0003 ms (0.3 µs)**.
2. **Persisted DAG State Transaction (`persisted_dag_transaction`)**:
   - Thao tác: Ghi nhận trạng thái thay đổi vào SQLite, cập nhật bảng `artifacts` và `dependencies` trong một transaction hoàn chỉnh.
   - Kết quả: **p95 = 3.82 ms**.

### 8.2. Bằng chứng kiểm thử
- File bằng chứng: `temp/phase02_final_verification/performance/audit_evidence.json`.
- Kết quả: **PASS**.

---

## 9. TÍNH TOÀN VẸN DỮ LIỆU DỰ ÁN MẪU (GATE J: DATA INTEGRITY)

### 9.1. Kiểm tra Reference Project
- Dự án kiểm chứng: `project_sample_ref` / `sample_project` chứa kịch bản thực tế 79 cảnh, 141 cú máy, 135 phân đoạn lồng tiếng (chunks).
- Toàn bộ Stable ID (`scene_id`, `shot_id`, `chunk_id`) được duy trì bất biến, không bị xáo trộn hoặc mất mát sau các đợt kiểm thử StateStore và VersionManager.
- Số lượng node hợp lệ:
  - Scenes: 79
  - Shots: 141
  - Chunks: 135
  - Sai lệch cấu trúc (Semantic Diffs): 0

### 9.2. Bằng chứng kiểm thử
- File bằng chứng: `temp/phase02_final_verification/integrity/audit_evidence.json`.
- Kết quả: **PASS**.

---

## 10. KẾT QUẢ BỘ KIỂM THỬ HỒI QUY TOÀN DIỆN (GATE I: FULL REGRESSION SUITE)

Hệ thống đã thực thi toàn bộ test suite từ thư mục `tests/`:
```text
============================== 479 passed in 41.92s ==============================
```
- **Tổng số test**: 479
- **Thành công (Passed)**: 479 (100.0%)
- **Thất bại (Failed)**: 0
- **Lỗi runtime (Errors)**: 0
- **Bỏ qua (Skipped)**: 0
- File bằng chứng: `temp/phase02_final_verification/regression/full_suite_result.json`.
- Kết quả: **PASS**.

---

## 11. ĐỒNG BỘ HÓA TÀI LIỆU VÀ LỘ TRÌNH (GATE H: DOCUMENTATION SYNC)

Toàn bộ các tài liệu kỹ thuật đã được đồng bộ hóa hoàn toàn:
1. `docs/implementation/implementation_plan.md`:
   - Xóa bỏ chỉ dẫn dọn dẹp nguy hiểm `git clean -fd`.
   - Cập nhật Section 7 và Mục lục: Phase 2 là `PASS / FINAL — VERIFIED`; Subphase 3A là `READY TO START / NOT STARTED`.
   - Chuẩn hóa mô tả Phase 8: *"Manifest-driven refactor/adaptation of existing FFmpeg rendering path"*.
   - Chuẩn hóa giao ước Timeline Editor: *"Read manifest for preview -> write canonical TimelineOverrides -> compile NEW immutable manifest"*.
2. `docs/implementation/ROADMAP_STATUS.md`:
   - Ghi nhận Phase 2 hoàn thành 100%, 0 blockers.
   - Trạng thái Subphase 3A: `Ready to start`.
3. `docs/implementation/PHASE_02_IMPLEMENTATION_REPORT.md`:
   - Cập nhật số liệu benchmark p95 và liên kết tới báo cáo kiểm định cuối cùng này.

---

## 12. RỦI RO CÒN LẠI VÀ RANH GIỚI BẮT ĐẦU SUBPHASE 3A (REMAINING RISKS & BOUNDARIES)

### 12.1. Rủi ro còn lại & Biện pháp giảm thiểu
1. **Dung lượng VRAM hạn chế (4GB RTX 3050)**:
   - *Rủi ro*: Khi thực thi sinh video hoặc hình ảnh độ phân giải cao ở Phase 4/5, VRAM 4GB có thể đạt ngưỡng giới hạn.
   - *Biện pháp*: `ResourceGuard` đã được cấu hình slot tối đa = 1 cho các tác vụ nặng, tự động tuần tự hóa và giải phóng bộ nhớ đệm sau mỗi bước sinh.
2. **Kích thước file SQLite khi lưu trữ lượng lớn revision**:
   - *Rủi ro*: Sau hàng ngàn lần sinh thử nghiệm, kích thước DB có thể phình to.
   - *Biện pháp*: Hệ thống đã phân tách metadata lưu trong DB và binary artifacts lưu trên filesystem theo content-hash; DB chỉ lưu chuỗi hash 64 ký tự.

### 12.2. Ranh giới tuyệt đối đối với Subphase 3A
- Trong đợt kiểm định này: **Hoàn toàn không có bất kỳ thay đổi nào trong `studio/static/` hoặc `studio/templates/`**.
- Không có bất kỳ dòng mã JavaScript, HTML, hoặc CSS nào thuộc Subphase 3A được viết trước khi có lệnh chính thức.
- Mã nguồn và kiến trúc của Phase 2 hoàn toàn đóng băng ở trạng thái ổn định nhất.

---

## 13. MA TRẬN 10 CHỐT CHẶN KIỂM ĐỊNH (FINAL GATE MATRIX)

| Chốt Chặn (Gate) | Tên Tiêu Chí Kỹ Thuật | Trạng Thái | Minh Chứng & Bằng Chứng Cụ Thể |
| :---: | :--- | :---: | :--- |
| **Gate A** | Effective-input cache identity semantics | **PASS** | `dependency_graph.py`, `test_gate_a_*`, loại bỏ `artifact_id` khỏi payload băm. |
| **Gate B** | Domain errors map to explicit 4xx | **PASS** | `app.py`, 400/404/409, 0 unhandled 500s. |
| **Gate C** | Lock persistence across reopen & coexistence | **PASS** | `version_manager.py`, `test_gate_c_*`, bảo lưu qua restart và cùng tồn tại với OUTDATED. |
| **Gate D** | SQLite concurrency verified, DELETE mode | **PASS** | `state_store.py`, `busy_timeout=30000`, 3 retries, 4 readers + 2 writers an toàn. |
| **Gate E** | Scheduler VRAM detection active, scoped claims | **PASS** | `resource_scheduler.py`, fallback `nvidia-smi`, phát hiện RTX 3050 4GB, 0 OOM. |
| **Gate F** | Transactional invalidation on commit only | **PASS** | `test_gate_f_*`, candidate generation thất bại không làm hỏng DAG hạ nguồn. |
| **Gate G** | Benchmark methodology clearly defined | **PASS** | Phân định minh bạch In-memory (0.0003 ms) vs Persisted SQLite (3.82 ms). |
| **Gate H** | Documentation, conclusion & roadmap synced | **PASS** | `implementation_plan.md`, `ROADMAP_STATUS.md`, loại bỏ `git clean -fd`. |
| **Gate I** | Full regression test suite (100%) | **PASS** | **479/479 tests passed** trong 41.92s, 0 failed, 0 skipped. |
| **Gate J** | Data integrity of reference project | **PASS** | 79 scenes, 141 shots, 135 chunks, Stable IDs bảo toàn nguyên vẹn. |

---

## 14. KẾT LUẬN VÀ TUYÊN BỐ CHÍNH THỨC (FINAL VERDICT)

```text
PHASE 2: PASS / FINAL
READY TO START SUBPHASE 3A
```
