# BÁO CÁO RÀ SOÁT & HIỆU CHỈNH TÍNH NHẤT QUÁN KẾ HOẠCH TRIỂN KHAI (REVISION 2.1)
## IMPLEMENTATION PLAN REVISION 2.1 CONSISTENCY & ARCHITECTURE REVIEW REPORT

> **Tài liệu mục tiêu:** `docs/implementation/implementation_plan.md`  
> **Căn cứ chỉ đạo:** `UNFOLDIQ-IMPLEMENTATION-PLAN-R2.1-CONSISTENCY-FIX-PROMPT.md`  
> **Thời điểm hoàn thành:** 2026-09-16  
> **Loại tác vụ:** `DOCUMENTATION & ARCHITECTURE CONTRACT CORRECTION ONLY`  

---

### 1. Status (Trạng thái Rà soát)
- **Tiến trình:** Đã hoàn thành 100% việc rà soát và hiệu chỉnh tài liệu Master Plan `implementation_plan.md` (Revision 2.1).
- **Phạm vi can thiệp:** 100% thuộc tài liệu kế hoạch kiến trúc và lộ trình.
- **Kỷ luật vận hành:** **ZERO application source code changes.** Không sửa đổi code Python/JS/HTML/CSS của ứng dụng, không cài đặt dependency mới (không cài FFmpeg, OpenShot, Remotion), không khởi động Phase 2, giữ nguyên vẹn trạng thái `FUTURE / NOT STARTED` của Phases 7–9.

---

### 2. Sections Corrected (Các Phần Đã Được Hiệu Chỉnh Trong Plan)
1. **Pre-Implementation Gate & Phase 1 Evidence Alignment:**
   - Phân định rành mạch giữa Baseline lịch sử khởi điểm (**43/43 tests PASSED**) và Full Regression hiện tại (**451/451 tests PASSED** bao gồm 25 tests chuyên biệt của Phase 1).
   - Loại bỏ số liệu giả định `0.00 ms`; cập nhật kết quả đo kiểm thực tế của Fast Metadata Cache Hit: **median $\approx 4.5\text{ µs}$, p95 $\approx 4.7\text{ µs}$**. Khẳng định `(st_mtime_ns, st_size)` là tối ưu hóa freshness, còn **SHA-256 là Source of Truth duy nhất** cho định danh nội dung.
   - Chuẩn hóa một endpoint overview duy nhất: `GET /api/projects/{id}/v2/overview`.
   - Hiệu chỉnh tiêu chí chuyển đổi frontend: Khẳng định Phase 1 cung cấp và xác thực các selective API contracts sẵn sàng cho Phase 3 Workbench migration, trong khi legacy UI tiếp tục dùng compatibility endpoints.
   - Chuẩn hóa tuyên bố tương thích ngược: Xác nhận trong phạm vi dự án mẫu 79 cảnh và các bộ test fixtures (không phát hiện mất mát dữ liệu ngữ nghĩa).
2. **Phase 2 & Phase 3 Capability Preservation & Hardcoding Cleanup:**
   - Chuẩn hóa điều phối tài nguyên: `CUDA_HEAVY concurrency=1`, `GPU_ENCODER concurrency=1`. Coexistence chỉ được phép khi cơ chế `ResourceGuard` xác nhận đủ ngân sách bộ nhớ động (loại bỏ con số gán cứng tĩnh).
   - Bổ sung `Capability Migration Map` bảo toàn 100% nghiệp vụ khi loại bỏ các modal cũ (`edq-modal`, `narration-beats-modal`, `modal-storage-manager`, `sp-edit-modal`, `veo-edit-modal`, `visual-bible-modal`).
   - Loại bỏ các ví dụ kịch bản gán cứng ("Kael", "Tundra", "Shot 1.1") khỏi contract kiến trúc; thay bằng phân giải động thực thể nhân vật/bối cảnh đã được duyệt.
   - Chuyển đổi SLA tái sinh giọng đọc (Voice chunk regeneration) sang phương pháp đo kiểm baseline warm/cold p50/p95 thực nghiệm.
3. **Phase 4 & Phase 8 Rendering Ownership Clarification:**
   - Phân định rõ ràng: Phase 4 tập trung vào media representations (Thumbnail WebP $256\times 144$, định mức dung lượng $\approx 15\text{ KB}$, Proxy 720p, Asset Registry 3 tầng, và Portable Production Package 10 thành phần). Phase 4 **không tạo ra kiến trúc render engine mới**.
   - Chuẩn hóa âm thanh đầu ra: Master Narration là **WAV PCM 16-bit 24kHz Mono** nguyên bản (độc lập); Muxed Audio trong container video MP4 là **AAC 192 kbps, 48 kHz stereo**.
4. **Phase 5 Performance Virtualization:**
   - Chuyển ngưỡng ảo hóa từ con số cố định sang **ngưỡng ứng viên khởi điểm 30 phần tử**, ngưỡng chính thức dựa trên đo kiểm thực tế (evidence-based from profiling).
5. **Phase 6 Accessibility Scope Alignment:**
   - Đổi tên thành **WCAG 2.2 AA-Oriented Accessibility Hardening**.
   - Xác định rõ nghiệm thu dựa trên các chốt chặn tiếp cận trọng yếu (8 bước kiểm tra thủ công + automated tests, SC 2.5.8 $24\times 24\text{px}$, touch target $44\times 44\text{px}$, non-drag alternative theo SC 2.5.7), không tuyên bố tương đương cuộc kiểm toán chứng chỉ toàn diện 50+ SC W3C.
6. **Phase 7 Shot-Centric Render Manifest & Timebase:**
   - Cấu trúc `videoTrack.clips[]` biểu diễn đầy đủ toàn bộ 141 Shots của dự án mẫu.
   - Hệ quy chiếu thời gian số nguyên khung hình: `timeBase: { numerator: 24, denominator: 1 }` (24fps), `startFrame`, `durationFrames`, `endFrame`.
   - Ngữ nghĩa chuyển cảnh tường minh (`CUT`, `CROSSFADE`), dung sai dựa trên khung hình (`frameTolerance = 1 frame`).
   - Đường dẫn bất biến chuẩn tắc: `projects/<projectId>/exports/<exportId>/render-manifest.json`.
   - Chuẩn hóa 10 pre-render validation gates: Sandbox đường dẫn, checksum khớp intake ledger, chuyển cảnh có tính đến overlap, cảnh báo nhạc nền thiếu là warning, phụ đề là optional.
7. **Phase 8 Manifest-Driven FFmpeg Render Engine:**
   - Tái cấu trúc engine kết xuất hiện hữu theo ranh giới Renderer Abstraction (không gọi là first engine).
   - Machine-readable progress reporting: `-progress pipe:1` (`key=value`, `out_time_us=...`, `progress=continue`).
   - Chính sách CPU fallback: Chỉ áp dụng 01 lần duy nhất cho lỗi encoder/phần cứng NVENC; các lỗi dữ liệu/filter/input bị chặn đứng ngay lập tức (FAIL) và báo cáo trực tiếp, không retry CPU vô ích.
   - Cấu hình NVENC dựa trên benchmark đo kiểm của Phase 4.
   - Xử lý dự án lớn (250–500 shots) bằng concat demuxer list và filtergraph script file, tránh tràn giới hạn dòng lệnh Windows (`lpCommandLine` 32,767 ký tự), không mặc định batch encoding khi chưa có bằng chứng.
8. **Phase 9 Render QA: Hard Blockers vs Context-Aware Warnings:**
   - Phân biệt rõ Hard Blockers kỹ thuật (missing file, unreadable container, missing streams, decode errors, wrong codec/resolution, duration mismatch) $\rightarrow$ `FAILED`.
   - Heuristic Warnings (blackdetect, freezedetect) $\rightarrow$ Cho phép `READY` kèm `warnings[]` nếu khớp với ngữ cảnh manifest (ví dụ clip ảnh tĩnh STATIC IMAGE cố tình freeze hoặc cảnh fade-to-black).
   - Tách biệt vòng đời thực thi `RenderJob.status` (`IDLE`, `QUEUED`, `RENDERING`, `VALIDATING`, `READY`, `FAILED`, `CANCELLED`) khỏi trạng thái sẵn sàng của artifact `Artifact.status` (`DRAFT`, `NEEDS_REVIEW`, `READY`, `OUTDATED`, `BLOCKED`).
9. **Future Horizon Compiler Model:**
   - Web Timeline Editor đọc `render-manifest.json`. Nếu người dùng chỉnh sửa, các thay đổi được ghi vào canonical `TimelineOverrides` / `CompositionTimeline` và gọi Timeline Compiler để sinh ra một tệp manifest phiên bản mới bất biến, **tuyệt đối không ghi đè trực tiếp (mutate in-place)** lên manifest cũ.
10. **Requirement Coverage Matrix (Req 1–80):**
    - Thay thế cột kết quả gộp chung bằng 2 cột minh bạch: **Roadmap Coverage** (`COVERED`) và **Implementation State** (`VERIFIED` cho Phase 1; `NOT STARTED` cho Phase 2–6; `FUTURE` cho Phase 7–9).
    - Cập nhật kết luận chuẩn tắc: "80 / 80 requirements mapped/covered by the roadmap. Implementation and verification status remain phase-dependent."

---

### 3. Contradictions Resolved (Các Điểm Mâu Thuẫn Đã Được Tháo Gỡ)
| Điểm Mâu Thuẫn Trước Đây | Nguyên Nhân | Giải Pháp Đã Hiệu Chỉnh Trong Plan Revision 2.1 |
| :--- | :--- | :--- |
| **Requirement Matrix đánh `PASS` cho Phase 2–9** | Nhầm lẫn giữa "được đưa vào lộ trình" và "đã kiểm thử code thực tế". | Phân tách thành 2 cột: `Roadmap Coverage` (COVERED) và `Implementation State` (VERIFIED / NOT STARTED / FUTURE). |
| **Chồng lấn Rendering giữa Phase 4 và Phase 8** | Cả hai phase đều mô tả xây dựng engine render và NVENC. | Phase 4 sở hữu Thumbnail, Proxy, Asset Registry, Portable Package. Phase 8 sở hữu Manifest-driven Render Engine. |
| **Render Manifest làm phẳng 141 Shots thành 79 Scenes** | Schema mẫu dùng mảng `scenes[]` với 1 visual asset duy nhất. | Đổi schema sang `videoTrack.clips[]` với độ hạt từng Shot, bảo toàn nguyên vẹn 141 Shots độc lập. |
| **Timeline dùng floating seconds gây trôi khung hình** | Sai số số thực khi cộng dồn hàng trăm shot. | Chuẩn hóa `timeBase: { numerator: 24, denominator: 1 }` với tọa độ số nguyên khung hình (`startFrame`, `durationFrames`, `endFrame`). |
| **Manifest mutable tại thư mục gốc vs Bất biến lịch sử** | Manifest dùng chung bị ghi đè làm mất khả năng tái lập xuất bản. | Lưu chuẩn tắc tại `exports/<exportId>/render-manifest.json` gắn liền snapshot bất biến và source hashes. |
| **Future Editor ghi đè trực tiếp manifest vs Compiler model** | Mâu thuẫn giữa nguyên tắc intermediate compilation và direct mutation. | Editor lưu vào canonical timeline state; compiler biên dịch ra manifest mới; không bao giờ mutate in-place. |
| **Retry CPU cho mọi lỗi render FFmpeg** | Gây lãng phí tài nguyên khi lỗi do thiếu file hoặc hỏng dữ liệu. | Phân loại: Lỗi encoder/GPU $\rightarrow$ retry CPU 1 lần; Lỗi dữ liệu/đầu vào $\rightarrow$ FAIL ngay lập tức. |
| **Heuristic black/freeze block video ảnh tĩnh** | Thuật toán kiểm tra đen/đứng hình chặn nhầm các cảnh ảnh tĩnh cố ý. | Phân định Hard Gates (blocker) vs Heuristic Warnings (cho phép READY kèm cảnh báo đối chiếu manifest). |
| **Tuyên bố WCAG 2.2 AA Conformance toàn diện** | Checklist 8 bước không đủ đại diện cho 50+ tiêu chí W3C. | Đổi thành WCAG 2.2 AA-Oriented Accessibility Hardening với phạm vi kiểm định tự động + thủ công minh bạch. |

---

### 4. Rendering Ownership Matrix (Ma Trận Phân Định Ranh Giới Rendering)
| Phân Vùng Kiến Trúc | Phase Sở Hữu | Trách Nhiệm Cốt Lõi | Ranh Giới / Không Thuộc Phạm Vi |
| :--- | :---: | :--- | :--- |
| **Media Representations & Asset Registry** | **Phase 4** | Sinh Thumbnail WebP $256\times 144$ ($\approx 15\text{ KB}$ budget); Proxy 720p; Asset Registry 3 tầng; Portable Production Package 10 thành phần; Benchmark bộ mã hóa NVENC vs libx264. | Không tạo ra kiến trúc render engine mới. Không thay đổi ranh giới renderer hiện hữu ngoài benchmark và bugfix tối thiểu. |
| **Timeline Compilation & Manifest** | **Phase 7** `[FUTURE]` | Đọc Scene Plan, Timestamps, Assets, Audio, Subtitles $\rightarrow$ Biên dịch ra `exports/<exportId>/render-manifest.json` Shot-centric, frame-accurate; Thực thi 10 Pre-render Validation Gates. | Không gọi tiến trình FFmpeg CLI. Không nhúng UI Timeline Editor. |
| **Manifest-Driven FFmpeg Render Engine** | **Phase 8** `[FUTURE]` | Nhận đầu vào duy nhất `render-manifest.json`; điều phối tiến trình render nền; `-progress pipe:1`; CPU fallback cho lỗi NVENC; xuất `final.mp4` 1080p H.264 / AAC 192k 48kHz. | Tuyệt đối không dùng OpenShot. Không nhúng logic chỉnh sửa đồ họa GUI vào engine. |
| **Technical Render QA & Gatekeeping** | **Phase 9** `[FUTURE]` | Phân tích tự động `final.mp4` bằng `ffprobe`; thực thi 6 Hard Blockers kỹ thuật và 3 Context-aware Heuristic Warnings; ghi nhận `render_qa_report.json`; gatekeeping trạng thái `READY`. | Không chặn nhầm clip ảnh tĩnh hoặc fade đen có chủ đích. Tách biệt `RenderJob.status` khỏi `Artifact.status`. |
| **Web Preview & Interactive Editing** | **Future Horizon** `[FUTURE]` | Xem trước timeline trên trình duyệt (Browser Preview Player); chỉnh sửa điểm cắt, âm lượng, phụ đề; lưu canonical timeline overrides $\rightarrow$ biên dịch manifest mới. | Không ghi đè trực tiếp lên manifest đã biên dịch. Không thay thế vai trò xuất xưởng master của FFmpeg engine. |

---

### 5. Render Manifest Architecture Summary
- **Mô hình Dữ liệu:**
  - `timeBase: { numerator: 24, denominator: 1 }` (24fps).
  - Tọa độ số nguyên khung hình: `startFrame`, `durationFrames`, `endFrame`.
  - Độ hạt Cảnh quay: `videoTrack.clips[]` chứa đầy đủ 141 Shots với các trường `clipId`, `sceneId`, `shotId`, `sequenceIndex`, `assetId`, `acceptedAssetVersion`, `checksum`, `mediaType`, `filePath`, `trim` (`inFrame`, `outFrame`, `speedFactor`), `fittingStrategy` (`FIT_PAD` / `FILL_CROP`), `transition` (`CUT` / `CROSSFADE`).
  - Âm thanh chuẩn tắc: Master Narration `audio.wav` (PCM 24kHz Mono); Nhạc nền `musicTrack` (hỗ trợ ducking, fade in/out theo khung hình); Phụ đề `subtitlesTrack` (SRT/VTT, soft/hard burn-in).
  - Xuất bản chuẩn tắc: MP4 1080p 24fps yuv420p, Muxed Audio AAC 192 kbps 48 kHz stereo.
- **Tính Bất Biến & Đường Dẫn:** `projects/<projectId>/exports/<exportId>/render-manifest.json`.
- **Pre-Render Validation Gates:** 10 chốt chặn nghiêm ngặt (Path traversal sandbox, accepted asset checksum, media type allowlist, positive duration, chronological timestamps, transition-aware overlaps, frame-tolerance gap check, master audio presence, audio duration alignment, optional track tolerance).

---

### 6. Phase/Requirement Status Semantics (Ngữ Nghĩa Trạng Thái)
- **Roadmap Coverage:**
  - `COVERED`: Yêu cầu đã được phân tích, định vị và thiết kế giải pháp hoàn chỉnh trong cấu trúc các Phase của lộ trình.
  - `NOT COVERED`: Yêu cầu chưa được đề cập trong tài liệu.
  - `NEEDS DECISION`: Yêu cầu còn tồn tại phương án kỹ thuật chưa chốt quyết định.
- **Implementation State:**
  - `VERIFIED`: Đã được triển khai mã nguồn và nghiệm thu thực tế bằng các bài kiểm thử tự động chuyên biệt (Áp dụng cho các yêu cầu thuộc phạm vi Phase 1 đã hoàn thành).
  - `NOT STARTED`: Đã được lập kế hoạch chi tiết nhưng chưa bắt đầu viết code (Áp dụng cho Phase 2–6).
  - `FUTURE`: Thuộc phạm vi mở rộng trong tương lai sau khi hoàn thiện các Phase cốt lõi (Áp dụng cho Phase 7–9 và Future Horizon).
- **Trạng thái Tiến trình Render (`RenderJob.status`):** `IDLE` $\rightarrow$ `QUEUED` $\rightarrow$ `RENDERING` $\rightarrow$ `VALIDATING` $\rightarrow$ `READY` / `FAILED` / `CANCELLED`.
- **Trạng thái Sản xuất Artifact (`Artifact.status`):** `DRAFT`, `NEEDS_REVIEW`, `READY`, `OUTDATED`, `BLOCKED`.

---

### 7. Remaining Open Decisions (Các Quyết Định Kỹ Thuật Còn Bỏ Ngỏ Cần Benchmarking)
1. **Hồ sơ Mã hóa NVENC Tối ưu (`EncoderProfile`):** Tham số NVENC chính thức (`preset`, `rate_control`, `cq` vs `crf`) sẽ được chốt dựa trên kết quả đo kiểm SSIM/PSNR thực tế ở Phase 4, không gán cứng trước khi đo kiểm.
2. **Ngưỡng Kích hoạt DOM Virtualization:** Bắt đầu với ngưỡng ứng viên 30 phần tử; ngưỡng kích hoạt chính thức cho danh sách Shot/Scene sẽ được xác lập sau khi đo profiling thời gian render thực tế ở Phase 5.
3. **Công nghệ Web Timeline Preview Tương lai:** Lựa chọn giữa Remotion (React-based player) hay Custom Canvas/DOM Timeline nhẹ nhàng sẽ được quyết định tại thời điểm nghiên cứu Future Horizon dựa trên yêu cầu kích thước bundle và trải nghiệm người dùng.

---

### 8. Source Code Changed? (Kiểm Tra Biến Động Mã Nguồn)
# 🛑 NO — ABSOLUTELY ZERO APPLICATION SOURCE CODE CHANGED
- Toàn bộ mã nguồn ứng dụng (`studio/`, `tests/`, `templates/`, `static/`) được bảo toàn nguyên vẹn 100%.
- Không thêm mới hoặc chỉnh sửa bất kỳ dòng mã nguồn Python/JS nào trong suốt tác vụ rà soát này.
- Không cài đặt dependency mới (không cài FFmpeg, OpenShot, Remotion).

---

### 9. Final Plan Verdict (Phán Quyết Trạng Thái Kế Hoạch)

# 🟢 PLAN PASS / READY TO CONTINUE CURRENT PHASE

> **Kết luận chỉ đạo:**  
> Bản Kế hoạch Triển khai Revision 2.1 (`docs/implementation/implementation_plan.md`) đã đáp ứng 100% các tiêu chuẩn về tính nhất quán kiến trúc, không còn mâu thuẫn nội bộ, phân định rành mạch ranh giới sở hữu, và phản ánh trung thực số liệu thực nghiệm.  
> Căn cứ theo `PHASE_01_FINAL_VERIFICATION_REPORT.md`, Phase 1 đã hoàn thành xuất sắc toàn bộ các bài kiểm thử nghiệm thu (**451/451 tests PASSED (100%)**, 0 failed, 0 skipped, Final Verdict: `PHASE 1 = PASS / FINAL`, `READY FOR PHASE 2`). Kế hoạch Master đã được đồng bộ hóa hoàn toàn để phản ánh trạng thái hoàn tất của Phase 1 và sẵn sàng chuyển giao cho Phase 2 (`READY TO START`).
