# BÁO CÁO NGHIỆM THU VI MÔ VÀ ĐÓNG ĐIỂM CHỐT CUỐI CÙNG SUBPHASE 3B
## SUBPHASE 3B FINAL MICRO-CLOSURE REPORT
### Close Git checkpoint, scheduler call-graph, final evidence mapping, and roadmap governance before 3C

> **Loại tác vụ**: FINAL TARGETED VERIFY / FIX 3B ONLY  
> **Dự án**: UnfoldIQ Workstation  
> **Thời điểm thẩm định**: 2026-09-17  
> **Dự án tham chiếu thực tế**: `2026-09-12_210003_youtube-narration-01` (135 chunks, 1.422 word cues, 11:05 thời lượng)  
> **Hồi quy kiểm thử**: **507 / 507 PASS (100%)**, 0 failed, 0 errors (68.64s)  
> **Trạng thái Subphase 3C**: **CHƯA BẮT ĐẦU (NOT STARTED)**

---

## 1. Phân giải & Khắc phục Điểm chốt Git (Git Checkpoint Resolution)

### 1.1. Mâu thuẫn cũ & Nguyên nhân
Trước đây, tag `pre-phase-3b` được gắn cùng commit với `pre-phase-3a` (`c1fa0ab`), trong khi Subphase 3A đã có các thay đổi mã nguồn được nghiệm thu đầy đủ (491 tests pass) nhưng chưa được đóng gói thành commit độc lập trong lịch sử Git. Do đó, việc checkout `pre-phase-3b` trước đây chỉ trả về trạng thái cuối Phase 2 mà không chứa mã nguồn đã duyệt của 3A.

### 1.2. Biện pháp khắc phục chuẩn xác
Hệ thống đã sử dụng cơ chế chỉ mục cô lập (isolated Git index) để phân tách rành mạch:
1. **Commit 3A (`fa576ea`)**:
   - **Mã commit**: `fa576ea5649bd2596424cd68dd1f27c4b3452884`
   - **Parent**: `c1fa0ab` (Phase 2 completion baseline)
   - **Thông điệp**: `feat(phase3a): complete Subphase 3A App Shell, Overview, and Story Workbench (491 tests pass)`
   - **Nội dung**: Chứa 100% mã nguồn đã duyệt của Subphase 3A (App Shell, Overview, Story Workbench, tests 3A, reports 3A).
   - **Cô lập**: Chứa 0 dòng code của Subphase 3B (không có Voice Workbench UI `#ws-voice`, không có chunk rerender route, không có `test_phase03b_*`).
   - **Tag `pre-phase-3b`**: Đã được trỏ chính xác về commit `fa576ea`. Khi thực hiện `git checkout pre-phase-3b`, cây thư mục trả về nguyên vẹn trạng thái hoàn thiện của 3A và 491/491 tests pass.
2. **Commit 3B (`b41a993`)**:
   - **Mã commit**: `b41a9937e4a161225ceffca5f5c2d20111fb9c72`
   - **Parent**: `fa576ea` (Commit 3A)
   - **Thông điệp**: `feat(phase3b): complete Subphase 3B Voice Workbench, chunk identity, and scheduler closure (507 tests pass)`
   - **Nhánh `main` (HEAD)**: Trỏ về commit `b41a993`.

### 1.3. Cây phả hệ Git xác minh
```text
* b41a993 (HEAD -> main) feat(phase3b): complete Subphase 3B Voice Workbench, chunk identity, and scheduler closure (507 tests pass)
* fa576ea (tag: pre-phase-3b) feat(phase3a): complete Subphase 3A App Shell, Overview, and Story Workbench (491 tests pass)
* c1fa0ab (tag: pre-phase-3a, main-backup-before-micro-closure) feat(phase2): complete Phase 2 dependency graph, versioning, resource scheduler, and real-engine closure (483/483 pass)
* 3c04b72 (tag: pre-phase-2) feat(phase1): complete phase 1 workflow and data foundation with canonical 451-test baseline
```

- **Tệp bằng chứng**:
  - `temp/phase03b_micro_closure/git/checkpoint_audit.md`
  - `temp/phase03b_micro_closure/git/checkpoint_diff_summary.txt`

---

## 2. Biểu đồ Điều phối TTS qua LocalResourceScheduler (TTS Scheduler Call Graph)

Toàn bộ các tác vụ tính toán TTS (kết xuất đoạn đơn lẻ hoặc tổng hợp hàng loạt) bắt buộc phải tuân thủ điều phối tài nguyên máy trạm thông qua `LocalResourceScheduler` (`ResourceClass.CUDA_HEAVY`, giới hạn concurrency = 1 cho card đồ họa RTX 3050 4GB).

### 2.1. Call Graph chuẩn tắc
```text
Voice Action (Re-render Chunk / Bulk SSE)
└── API Endpoint: POST /api/projects/{dir_name}/voice/chunks/{chunk_id}/regenerate
    └── studio.app: _rerender_chunk_impl / generate_tts_sse
        └── LocalResourceScheduler.submit_job(job_type="kokoro_tts_synthesis", resource_class="CUDA_HEAVY")
            ├── ResourceGuard: Kiểm tra VRAM (>500MB) & Chặn xung đột đồng thời GPU_ENCODER
            ├── Chờ cấp Semaphore permit (concurrency = 1)
            ├── TTSProvider / KokoroTTSProvider.synthesize_chunk
            │   └── Ghi tệp candidate tạm thời: .tmp_rerender_{chunk_id}_{hash}.wav
            ├── Atomic Commit: replace_file_atomically(".audio_new.wav", "audio.wav")
            └── Finally: Giải phóng Semaphore permit & Cập nhật active_counts["CUDA_HEAVY"] -= 1
```

### 2.2. Kiểm chứng mã nguồn
- `studio/app.py` (`_rerender_chunk_impl` & `generate_tts_sse`): Coroutine tổng hợp âm thanh được bọc trực tiếp trong `await resource_scheduler.submit_job(..., resource_class=ResourceClass.CUDA_HEAVY.value)`.
- 0 lệnh gọi tổng hợp Kokoro nào trong luồng sản xuất đi tắt (bypass) scheduler.
- Tệp bằng chứng: `temp/phase03b_micro_closure/scheduler/tts_scheduler_callgraph.md`.

---

## 3. Biểu đồ Điều phối STT qua LocalResourceScheduler (STT Scheduler Call Graph)

Tác vụ phiên mã và căn chỉnh từ Faster-Whisper ASR là tác vụ nặng trên GPU (`CUDA_HEAVY`). Toàn bộ việc khởi tạo tiến trình worker hiện đã được điều phối tuần tự hóa qua scheduler.

### 3.1. Call Graph chuẩn tắc
```text
Alignment Action (POST /api/projects/{id}/timestamps hoặc Voice QA pipeline)
└── TranscriptionService.start_transcription
    └── TranscriptionService._run_worker_task
        └── LocalResourceScheduler.submit_job(job_type="faster_whisper_stt", resource_class="CUDA_HEAVY")
            ├── ResourceGuard: Xác nhận tài nguyên phần cứng sẵn sàng
            ├── Chờ cấp Semaphore permit (concurrency = 1)
            ├── Khởi tạo tiến trình worker subprocess: transcription/worker.py
            ├── Thu thập dữ liệu mốc từ word cues và sentence segments
            ├── Ghi nguyên tử: timestamps.json và timestamps.srt
            └── Finally: Thu hồi giấy phép permit và dọn dẹp PID tiến trình
```

### 3.2. Kiểm chứng mã nguồn
- `studio/transcription_service.py` (`_run_worker_task`): Lệnh gọi tiến trình con `asyncio.create_subprocess_exec` được bọc toàn diện trong hàm `_execute()` và chuyển vào `await resource_scheduler.submit_job(...)`.
- Tệp bằng chứng: `temp/phase03b_micro_closure/scheduler/stt_scheduler_callgraph.md` và `temp/phase03b_micro_closure/scheduler/scheduler_path_results.json`.

---

## 4. Tách biệt Trạng thái Tác vụ vs Trạng thái Thực thể (Job State vs Artifact State)

Hệ thống tuân thủ nghiêm ngặt mô hình trạng thái đa tầng:
- **Job State** (Trạng thái thực thi tức thời trong RAM/Scheduler): `QUEUED` $\rightarrow$ `RUNNING` $\rightarrow$ `COMPLETED` / `FAILED` / `CANCELLED`.
- **Artifact State** (Trạng thái vòng đời sản phẩm bền vững trên Disk/DAG): `DRAFT` / `NEEDS_REVIEW` / `READY` / `OUTDATED` / `BLOCKED`.

### Minh chứng cụ thể:
1. **Artifact = OUTDATED khi Job = QUEUED**:
   - Khi kịch bản `script.txt` thay đổi, `DependencyGraph` lập tức đánh dấu các đoạn âm thanh phụ thuộc là `OUTDATED`.
   - Tác vụ tái tổng hợp được nạp vào scheduler và ở trạng thái `QUEUED` chờ permit GPU.
   - Hai trạng thái cùng tồn tại độc lập mà không xảy ra xung đột ngữ nghĩa.
2. **Old Artifact = READY khi Replacement Job = FAILED**:
   - Một đoạn âm thanh đã có tệp audio chuẩn (`READY`). Người dùng bấm tạo lại nhưng backend TTS gặp sự cố ngoại lệ.
   - Tác vụ chuyển sang `FAILED`. Tệp tạm `.tmp_rerender_*` lập tức bị xóa bỏ (`unlink`).
   - Tệp `audio.wav` master và cache đoạn cũ hoàn toàn **nguyên vẹn**, giữ nguyên trạng thái `READY`.
- Tệp bằng chứng: `temp/phase03b_micro_closure/job_artifact_state/state_matrix.md`.

---

## 5. Ma trận Toàn vẹn Dữ liệu 25 Thực thể (Full Data-Integrity Matrix)

Kiểm tra toàn diện trên dự án tham chiếu `2026-09-12_210003_youtube-narration-01`:

| STT | Thực Thể / Hạng Mục Dữ Liệu | Trạng Thái Dự Kiến | Trạng Thái Kiểm Chứng | Sai Lệch Ngữ Nghĩa | Kết Quả |
|:---:|---|---|---|:---:|:---:|
| 1 | **Script (`script.txt`)** | 1.422 từ tiếng Anh gốc | 1.422 từ nguyên vẹn | 0 bytes | ✅ **PASS** |
| 2 | **Story Beats** | 138 beats trong DAG/metadata | 138 beats nguyên vẹn | 0 diffs | ✅ **PASS** |
| 3 | **Audio Chunks** | 135 chunks trong manifest.json | 135 chunks nguyên vẹn | 0 diffs | ✅ **PASS** |
| 4 | **Voice Settings** | Kokoro `af_heart`, speed `1.10` | Khớp metadata.json | 0 diffs | ✅ **PASS** |
| 5 | **Master Narration (`audio.wav`)** | 11:05 duration mono WAV | 11:05 duration mono WAV | SHA256 match | ✅ **PASS** |
| 6 | **Chunk Audio References** | 135 liên kết cache chunk | 135 liên kết nguyên vẹn | 0 broken | ✅ **PASS** |
| 7 | **Transcript** | Toàn văn bản dẫn truyện | Khớp script.txt | 0 deviation | ✅ **PASS** |
| 8 | **Timestamps (`timestamps.json`)** | Phân đoạn câu có start/end | Segments & duration khớp | 0 corruption | ✅ **PASS** |
| 9 | **Word Cues** | 1.422 mốc từ sắp xếp tăng dần | 1.422 mốc từ nguyên vẹn | 0 đảo thứ tự | ✅ **PASS** |
| 10 | **Pronunciation Data** | Tệp từ điển `pronunciation.json`| Lược đồ JSON hợp lệ | 0 rule loss | ✅ **PASS** |
| 11 | **Voice QA Data** | `voice_qa_report.json` | Chỉ số và quyết định còn nguyên | 0 corruption | ✅ **PASS** |
| 12 | **79 Scenes** | `scene_plan.json` (79 scenes) | 79 scenes nguyên vẹn | 0 mất cảnh | ✅ **PASS** |
| 13 | **141 Shots** | `veo_prompts.json` (141 shots) | 141 shots nguyên vẹn | 0 mất shot | ✅ **PASS** |
| 14 | **Visual Bible** | Nhân vật và bối cảnh quy chuẩn | Lược đồ v2.0 hợp lệ | 0 diffs | ✅ **PASS** |
| 15 | **Image Prompts** | Prompts tạo ảnh tĩnh cho shot | Bảo toàn trong scene plan | 0 diffs | ✅ **PASS** |
| 16 | **Motion / Veo Prompts** | 141 prompts chuyển động video | Bảo toàn trong veo_prompts.json| 0 diffs | ✅ **PASS** |
| 17 | **Negative Prompts** | Cấu hình prompt phủ định | Bảo toàn trong visual bible | 0 diffs | ✅ **PASS** |
| 18 | **Asset References** | Đường dẫn tài nguyên media | Các tệp tham chiếu tồn tại | 0 file mất | ✅ **PASS** |
| 19 | **Project Settings** | `settings.json` / `metadata.json` | Lược đồ v2.0.0 nguyên vẹn | 0 diffs | ✅ **PASS** |
| 20 | **Stable IDs** | `c_01`..`c_135`, `shot_001`.. | Định danh chuỗi ổn định | 0 dịch chuyển | ✅ **PASS** |
| 21 | **Parent-Child Hierarchy** | Cây phân cấp Scene -> Shot | Đồ thị DAG phản ánh đúng | 0 node mồ côi | ✅ **PASS** |
| 22 | **state.db** | Cơ sở dữ liệu SQLite 357 nodes | 357 nodes, schema v2.0 | 0 corrupted | ✅ **PASS** |
| 23 | **Revision History** | Bảng `artifact_revisions` | Các bản ghi lịch sử truy cập tốt| 0 mất revision| ✅ **PASS** |
| 24 | **Lock States** | Bảng `artifact_locks` | Cờ khóa đoạn âm thanh bảo lưu | 0 mất khóa | ✅ **PASS** |
| 25 | **Unknown / Legacy Fields** | Các trường tùy biến cũ | `model_config extra='allow'` giữ | 0 stripped | ✅ **PASS** |

- **Tổng kết sai lệch ngoài ý muốn**: **0** (Tệp bằng chứng: `temp/phase03b_micro_closure/integrity/full_integrity_matrix.md`).

---

## 6. Đóng Cổng O: Trình Duyệt / API / Ngôn Ngữ / Tương Thích (Gate O)

1. **Khung nhìn kiểm thử máy trạm**:
   - `1920x1080`: PASS (0 horizontal overflow).
   - `1440x900`: PASS (0 horizontal overflow).
   - `1366x768`: PASS (0 horizontal overflow).
   - Minh chứng ảnh chụp đã lưu tại: `temp/phase03b_final_verification/responsive/`.
2. **Bảng điều khiển & Mạng**:
   - Lỗi console ngoài ý muốn: **0**.
   - Unhandled promise rejections: **0**.
   - Yêu cầu API thất bại: **0**.
3. **Phụ thuộc Frontend Canonical**:
   - Giao diện Voice Workbench nạp dữ liệu chuẩn qua canonical route: `GET /api/projects/{dir_name}/v2/voice`.
   - Tuyến cũ `GET /api/projects/{dir_name}/voice` chỉ đóng vai trò alias tương thích ngược.
4. **Khả năng tiếp cận các Workbench khác**:
   - `Tổng quan` (`#ws-overview`): Hoạt động ổn định, nạp metrics và Next Action tức thời.
   - `Kịch bản` (`#ws-story`): Hoạt động ổn định, autosave và dirty tracking mượt mà.
   - `Hình ảnh & Cảnh` (`#ws-scenes`) và `Xuất video` (`#ws-export`): Tiếp cận bình thường, không bị phá vỡ cấu trúc DOM.
5. **Chính sách ngôn ngữ (UI Language Policy)**:
   - Toàn bộ nhãn nút, tiêu đề thẻ thanh tra, thông báo lỗi: **Tiếng Việt ưu tiên (Vietnamese-first)**.
   - Nội dung kịch bản văn học (`script.txt`), lời thoại và transcript giữ nguyên ngôn ngữ gốc (English), không tự ý dịch thuật hay biến dạng.
6. **Thu hồi thuộc tính aria-label dư thừa**:
   - Đã xóa `aria-label="Tốc độ tạo giọng đọc"` trên `#voice-tts-speed`, cho phép nhãn chuẩn `<label for="voice-tts-speed">Tốc độ đọc (TTS Speed)</label>` có hiệu lực cao nhất theo tiêu chuẩn WCAG 2.1 Label in Name (2.5.3).

---

## 7. Quản Trị Lộ Trình (Gate P — Roadmap Governance)

Tuân thủ nguyên tắc kỷ luật vận hành nghiêm ngặt của dự án:
- Trong quá trình thẩm định này, trạng thái tại `docs/implementation/ROADMAP_STATUS.md` được ghi nhận chính xác:
  - **Subphase 3B**: `🟡 IMPLEMENTED / REVIEW PENDING` (Đã hoàn thành mã nguồn, kiểm thử và bằng chứng; chờ quyết định đóng chốt).
  - **Subphase 3C**: `⏳ NOT STARTED` (Tuyệt đối chưa khởi động).
- Báo cáo này **kiến nghị chính thức**: Sau khi xem xét tài liệu này, người dùng có thể phê duyệt đóng chốt Subphase 3B và chuyển trạng thái sang `PASS / FINAL` để sẵn sàng cho Subphase 3C.

---

## 8. Trạng Thái Hồi Quy Toàn Diện (Regression Status)

- **Lệnh thực thi**: `pytest -q`
- **Kết quả**:
  ```text
  507 passed, 6 warnings in 68.64s (0:01:08)
  0 failed, 0 errors
  ```
- **Tệp log chi tiết**: `temp/phase03b_micro_closure/regression/pytest_micro_closure.log`.
- Toàn bộ 507 tests (bao gồm 451 Phase 1, 32 Phase 2, 8 Phase 3A, 10 Phase 3B Workbench, 6 Phase 3B Gap Closure) đều đạt 100%.

---

## 9. Thẩm Định Phạm Vi Kỷ Luật (Scope Audit)

| Tiêu Chí Kỷ Luật | Đánh Giá | Kết Quả |
|---|---|:---:|
| Không bắt đầu Subphase 3C | 0 dòng code hoặc test nào của Visual Workbench được tạo trước | ✅ **TUÂN THỦ** |
| Không tái thiết kế Visual/Export | Không chạm vào các thành phần ngoài phạm vi 3B | ✅ **TUÂN THỦ** |
| Không dùng `git clean -fd` | Không xóa tệp bừa bãi, không mất mát dữ liệu | ✅ **TUÂN THỦ** |
| Không ngụy tạo bằng chứng | Toàn bộ tệp bằng chứng được sinh ra từ lệnh thực thi thật | ✅ **TUÂN THỦ** |

---

## 10. Phán Quyết Cuối Cùng (Final Verdict)

Đối chiếu với 11 điều kiện tiên quyết tại Mục 11 của Prompt:
- [x] `pre-phase-3b` đại diện chính xác cho trạng thái cuối cùng đã duyệt của Subphase 3A (Commit `fa576ea`).
- [x] Điểm chốt Git có thể sử dụng làm điểm rollback thực tế độc lập (`checkout pre-phase-3b` cho ra 491 tests pass, 0 dòng code 3B).
- [x] Tác vụ tính toán TTS tuân thủ `LocalResourceScheduler` (`ResourceClass.CUDA_HEAVY`, concurrency = 1).
- [x] Tác vụ tính toán STT tuân thủ `LocalResourceScheduler` (`ResourceClass.CUDA_HEAVY`, concurrency = 1).
- [x] Sự phân tách giữa Job State và Artifact State được chứng minh cụ thể.
- [x] Ma trận toàn vẹn dữ liệu 25 hạng mục đạt 100% PASS (0 sai lệch ngữ nghĩa).
- [x] Cổng O (Trình duyệt, API canonical, Ngôn ngữ tiếng Việt, Tương thích) đạt 100% PASS.
- [x] Cổng P (Quản trị lộ trình, kiểm soát trạng thái) đạt 100% PASS.
- [x] Hồi quy kiểm thử duy trì 507 / 507 PASS (100%).
- [x] Subphase 3C duy trì trạng thái NOT STARTED trong suốt tác vụ.
- [x] Không còn bất kỳ blocker P0/P1 nào tồn tại.

> [!TIP]
> ### KẾT LUẬN CHÍNH THỨC:
> **SUBPHASE 3B: PASS / FINAL**  
> **SẴN SÀNG CHO SUBPHASE 3C (READY FOR SUBPHASE 3C)**

---

## 11. Dừng Tiến Trình (Stop)

> [!IMPORTANT]
> **DỪNG TẠI ĐÂY.**  
> Tiến trình đã dừng chính xác sau khi hoàn thành báo cáo vi mô. Hệ thống **KHÔNG** tự ý bắt đầu Subphase 3C cho đến khi có chỉ thị tiếp theo từ người dùng.
