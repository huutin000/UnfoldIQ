# BẢNG TỔNG QUAN TRẠNG THÁI LỘ TRÌNH UNFOLDIQ WORKSTATION
## ROADMAP EXECUTION & GOVERNANCE STATUS

> **Phiên bản:** Revision 2.9.3 (Phases 1–9 PASS / FINAL / VERIFIED; Final System Gate PASS / FINAL / VERIFIED, Candidate verdict: PRODUCTION READY)
> **Cập nhật:** 2026-09-19
> **Tổng số Top-Level Phases:** **9 Phases** (Phase 3 gồm 4 subphases tuần tự) + **1 Final Quality Gate** (không phải Phase 10).

---

### 1. Trạng Thái Các Phân Kỳ (Phases & Gates Status)

| Phase / Gate | Tên Phân Kỳ / Chốt Chặn | Trạng Thái Quy Trình | Trạng Thái Triển Khai | Kết Quả Nghiệm Thu / Ghi Chú |
| :--- | :--- | :---: | :---: | :--- |
| **Pre-Gate** | Pre-Implementation Baseline | ✅ **PASSED** | `VERIFIED` | 43/43 tests khởi điểm (8.38s) |
| **Phase 1** | **Workflow \& Data Foundation** | ✅ **PASS / FINAL** | `VERIFIED` | **451/451 tests PASSED (100%)** (35.34s) tại `PHASE_01_FINAL_VERIFICATION_REPORT.md` |
| **Phase 2** | **Dependency Engine, Versioning \& Scheduler** | ✅ **PASS / FINAL** | `VERIFIED` | **483/483 tests PASSED (100%)** (42.72s) tại `PHASE_02_FINAL_CLOSURE_REPORT.md` \& `PHASE_02_MICRO_CLOSURE_REPORT.md` (baseline ban đầu 467 tests) \| Sẵn sàng khởi động Subphase 3A |
| **Phase 3** | **Core Workbenches Restructuring** | ✅ **PASS / FINAL** | `VERIFIED` | Chuỗi 4 subphases tuần tự (3A $\rightarrow$ 3D) — tất cả VERIFIED tại `PHASE_03D_FINAL_CLOSURE_REPORT.md` |
| ↳ *Subphase 3A* | *App Shell + Overview + Story Workbench* | ✅ **PASS / FINAL** | `VERIFIED` | Sequential Execution Gate 1 (8/8 tests, browser verified) |
| ↳ *Subphase 3B* | *Voice Workbench (Sync \& Pronunciation)* | ✅ **PASS / FINAL** | `VERIFIED` | Toàn bộ Cổng A-P ĐẠT (507/507 tests PASSED, LocalResourceScheduler integrated, 0 network overhead) — Đã phê duyệt đóng chốt tại `PHASE_03B_MICRO_CLOSURE_REPORT.md` |
| ↳ *Subphase 3C* | *Visual Workbench (Scenes, Shots, Bible)* | ✅ **PASS / FINAL** | `VERIFIED` | **566/566 tests PASSED** + browser closure (Chrome CDP, 3 viewports, 12 screenshots). Xem `PHASE_03C_FINAL_VERIFICATION_REPORT.md` + `PHASE_03C_BROWSER_CLOSURE_REPORT.md` |
| ↳ *Subphase 3D* | *Export Workbench UI (Preflight \& Triggers)*| ✅ **PASS / FINAL** | `VERIFIED` | Readiness API + preflight UI + render guards/status + safe preview/downloads. 588/588 tests (replaced stale 3D-absence guard bằng governance contract). Xem `PHASE_03D_IMPLEMENTATION_REPORT.md` + `PHASE_03D_FINAL_CLOSURE_REPORT.md` |
| **Phase 4** | **Media, Asset & Export Pipeline** | ✅ **PASS / FINAL** | `VERIFIED` | Benchmark B phân biệt quality + final-render AAC/48k/stereo ffprobe + accepted-version semantics + package re-verify. 634/634 tests. Xem `PHASE_04_IMPLEMENTATION_REPORT.md` + `PHASE_04_FINAL_CLOSURE_REPORT.md` |
| **Phase 5** | **UI Polish, Consolidation & Virtualization**| ✅ **PASS / FINAL** | `VERIFIED` | Sustained-scroll gate: virt median 67.4 + dense 134.0 active FPS + render/DOM/functional/palette sạch + 696/696 tests. Xem `PHASE_05_IMPLEMENTATION_REPORT.md` + `PHASE_05_FINAL_CLOSURE_REPORT.md` (historical) + `PHASE_05_FINAL_EVIDENCE_CLOSURE_REPORT.md` (discrete-wheel evidence) + `PHASE_05_FINAL_PERFORMANCE_GATE_REPORT.md` (decisive) |
| **Phase 6** | **Responsive & WCAG 2.2 AA-Oriented Accessibility Hardening** | ✅ **PASS / FINAL** | `VERIFIED` | External review PASSED (manual-closure + two-gate evidence). Xem `PHASE_06_IMPLEMENTATION_REPORT.md` + closure reports |
| **Phase 7** | **Render Manifest & Timeline Compiler** | ✅ **PASS / FINAL** | `VERIFIED` | Renderer-independent manifest + frame-accurate compiler (24fps integer frames) + lifecycle precedence + assetRegistryHash + structured timing pre-validation + read-only preview + immutable snapshots. Final closure regression **854/854 PASS**; external review status: **PASS / FINAL / VERIFIED**. Xem `PHASE_07_IMPLEMENTATION_REPORT.md`, `PHASE_07_FINAL_CLOSURE_REPORT.md` & `PHASE_07_FINAL_EXTERNAL_CLOSURE_REPORT.md` |
| **Phase 8** | **Manifest-Driven FFmpeg Render Engine** | ✅ **PASS / FINAL** | `VERIFIED` | Manifest-driven Final render engine consuming Phase 7 snapshots (`render-manifest.json`). Visual composition + crossfades + audio ducking + soft/hard subtitles + NVENC/libx264 dual profiles + timeline source validation + immutable atomic publish to `exports/<exportId>/final.mp4`. 120 Phase 8 tests passed, 974 full repo regression passed. External review status: **PASS / FINAL / VERIFIED**. Xem `PHASE_08_IMPLEMENTATION_REPORT.md` & `PHASE_08_FINAL_CLOSURE_REPORT.md` |
| **Phase 9** | **Automated Render QA & Verification** | ✅ **PASS / FINAL** | `VERIFIED` | Deterministic manifest-aware full-file technical QA (`RENDER_QA`, `RENDER_QA_POLICY_V1`): ffprobe inspection + one-pass full decode (black/freeze/silence) + immutable reports + PASS/PASS_WITH_WARNINGS→READY, FAIL→BLOCKED. Corrective closure (EOF freeze §45.1, process-wide gate §45.2, automatic browser handoff §45.3) on branch `phase09-render-qa`. Focused suite 88/88, nearby 337/337, full repo 1062/1062, browser 22/22. External review FINAL: **PHASE 9: PASS / FINAL / VERIFIED**. Xem `PHASE_09_IMPLEMENTATION_REPORT.md` (§§45–46) |
| **Final Gate** | **Final System Integration & Validation Gate** | ✅ **PASS / FINAL** | `VERIFIED` | **Cổng Nghiệm thu Toàn diện Hệ thống**: **13/13 PASS (100%)**. Đã đóng toàn bộ FG-001 (DAG micro-propagation), FG-002 (hồi quy 1062/1062 PASS), FG-003 (render manifest 10/10 gates PASS), FG-004 (launcher safety). Thẩm định độc lập chính thức phê chuẩn: **PASS / FINAL / VERIFIED** (Candidate verdict: **PRODUCTION READY**). Xem `FINAL_SYSTEM_GATE_CORRECTIVE_CLOSURE_REPORT.md` & `FINAL_SYSTEM_GATE_EXTERNAL_REVIEW_FINAL.md` |
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

