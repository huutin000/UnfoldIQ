# BẢNG TỔNG QUAN TRẠNG THÁI LỘ TRÌNH UNFOLDIQ WORKSTATION
## ROADMAP EXECUTION & GOVERNANCE STATUS

> **Phiên bản:** Revision 2.1.0 (Extended Video Rendering Pipeline & Final Quality Gate)  
> **Cập nhật:** 2026-09-16  
> **Tổng số Top-Level Phases:** **9 Phases** (Phase 3 gồm 4 subphases tuần tự) + **1 Final Quality Gate** (không phải Phase 10).

---

### 1. Trạng Thái Các Phân Kỳ (Phases & Gates Status)

| Phase / Gate | Tên Phân Kỳ / Chốt Chặn | Trạng Thái Quy Trình | Trạng Thái Triển Khai | Kết Quả Nghiệm Thu / Ghi Chú |
| :--- | :--- | :---: | :---: | :--- |
| **Pre-Gate** | Pre-Implementation Baseline | ✅ **PASSED** | `VERIFIED` | 43/43 tests khởi điểm (8.38s) |
| **Phase 1** | **Workflow & Data Foundation** | ✅ **PASS / FINAL** | `VERIFIED` | **451/451 tests PASSED (100%)** (35.34s) tại `PHASE_01_FINAL_VERIFICATION_REPORT.md` |
| **Phase 2** | **Dependency Engine, Versioning & Scheduler** | ✅ **PASS / FINAL** | `VERIFIED` | **483/483 tests PASSED (100%)** (42.72s) tại `PHASE_02_FINAL_CLOSURE_REPORT.md` & `PHASE_02_MICRO_CLOSURE_REPORT.md` (baseline ban đầu 467 tests) \| Sẵn sàng khởi động Subphase 3A |
| **Phase 3** | **Core Workbenches Restructuring** | ⏳ **NOT STARTED** | `NOT STARTED` | Chuỗi 4 subphases tuần tự (3A $\rightarrow$ 3D) |
| ↳ *Subphase 3A* | *App Shell + Overview + Story Workbench* | ⏭ **READY TO START** | `NOT STARTED` | Sequential Execution Gate 1 (Sẵn sàng khởi động) |
| ↳ *Subphase 3B* | *Voice Workbench (Sync & Pronunciation)* | ⏳ *NOT STARTED* | `NOT STARTED` | Sequential Execution Gate 2 (sau 3A) |
| ↳ *Subphase 3C* | *Visual Workbench (Scenes, Shots, Bible)* | ⏳ *NOT STARTED* | `NOT STARTED` | Sequential Execution Gate 3 (sau 3B) |
| ↳ *Subphase 3D* | *Export Workbench UI (Preflight & Triggers)*| ⏳ *NOT STARTED* | `NOT STARTED` | Sequential Execution Gate 4 (sau 3C) |
| **Phase 4** | **Media, Asset & Export Pipeline** | ⏳ **NOT STARTED** | `NOT STARTED` | Thumbnail WebP, Proxy 720p, Portable Package |
| **Phase 5** | **UI Polish, Consolidation & Virtualization**| ⏳ **NOT STARTED** | `NOT STARTED` | 7 primitives, ảo hóa DOM, Command Palette |
| **Phase 6** | **Responsive & WCAG 2.2 AA-Oriented Accessibility Hardening** | ⏳ **NOT STARTED** | `NOT STARTED` | Thích ứng laptop 768p, kiểm thử tiếp cận 8 bước |
| **Phase 7** | **Render Manifest & Timeline Compiler** | 🔵 **FUTURE** | `FUTURE` | Execution Note: NOT STARTED \| Manifest trung gian độc lập, 141 Shots, 10 Gates |
| **Phase 8** | **Manifest-Driven FFmpeg Render Engine** | 🔵 **FUTURE** | `FUTURE` | Execution Note: NOT STARTED \| Tái cấu trúc engine FFmpeg hiện hữu, NVENC/CPU |
| **Phase 9** | **Automated Render QA & Verification** | 🔵 **FUTURE** | `FUTURE` | Execution Note: NOT STARTED \| ffprobe inspection, Hard Gates vs Warnings |
| **Final Gate** | **Final System Integration & Validation Gate** | 🏁 **NOT YET RUN** | `NOT RUN` | **Cổng Nghiệm thu Toàn diện Hệ thống** (13 tiêu chuẩn) |
| **Future** | **Web Preview & Timeline Editor** | 💡 *CONSIDERATION* | `RESEARCH` | Nghiên cứu tương lai (Remotion / Custom Timeline) |

---

### 2. Quy Tắc Kỷ Luật Vận Hành (Execution Discipline)
1. **Một Task = Một Phase/Subphase:** Tuyệt đối không gộp nhiều top-level phases vào cùng một execution task.
2. **Tuần Tự Tuyệt Đối:** Mỗi phase bắt buộc phải hoàn thành trọn vẹn: `Code` $\rightarrow$ `Unit Tests` $\rightarrow$ `Regression Tests` $\rightarrow$ `Report` $\rightarrow$ `Review Gate PASS` trước khi bắt đầu phase tiếp theo.
3. **Phase 3 Tuần Tự:** `3A` $\rightarrow$ `3B` $\rightarrow$ `3C` $\rightarrow$ `3D` (không chạy song song vì chia sẻ frontend state và App Shell).
4. **Rendering Milestone Tuần Tự:** `Phase 7` (Manifest) $\rightarrow$ `Phase 8` (Engine) $\rightarrow$ `Phase 9` (QA).
5. **Final Quality Gate:** Chạy nghiệm thu xuyên suốt 13 hạng mục sau khi hoàn tất các phase đã chọn.
6. **Chính Sách Ngôn Ngữ Giao Diện (UI Language Policy):**
   - **Policy status:** `ACTIVE` (Có hiệu lực toàn diện).
   - **Implementation status:** `ENFORCED FOR ALL NEW/TOUCHED USER-FACING UI FROM PHASE 3A ONWARD` (Bắt buộc cho mọi bề mặt UI mới/chỉnh sửa).
   - **Legacy UI compliance:** `NOT CLAIMED` (Di chuyển tuần tự khi từng Workbench được tái cấu trúc).
   - Mọi phase có tác động đến UI bắt buộc phải tuân thủ chuẩn tiếng Việt ưu tiên (`Vietnamese-first` cho UI, `English` cho code/API/schema, giữ nguyên danh từ riêng công nghệ: `FFmpeg`, `ffprobe`, `Kokoro`, `Faster-Whisper`, `NVENC`, `CUDA`, `SQLite`, `Playwright`, `axe-core`) theo quy định tại `implementation_plan.md` (Mục 2.9), từ điển tra cứu tại `UI_LANGUAGE_GLOSSARY.md`, và báo cáo kiểm định `UI_LANGUAGE_POLICY_FINAL_VERIFICATION_REPORT.md`.

