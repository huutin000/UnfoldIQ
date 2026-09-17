# BÁO CÁO NGHIỆM THU ĐÓNG CÁC ĐIỂM NHỎ & TIẾP CẬN PHÂN ĐOẠN 3A
## (PHASE 03A MINOR CONSISTENCY & A11Y CLOSURE REPORT)

- **Thời điểm nghiệm thu**: 08:35:00 (Giờ địa phương) ngày 17/09/2026
- **Dự án kiểm thử thực tế**: `2026-09-12_210003_youtube-narration-01` (138 beats, 79 Cảnh, 141 Cảnh quay, 665.64s)
- **Hạ tầng kiểm thử**: Microsoft Edge Chromium Headless (CDP over native WebSocket), Pytest 9.1.1, Starlette TestClient, FastAPI / Uvicorn
- **Trạng thái cổng chất lượng**: **PASS / FINAL (ĐẠT 100% CÁC MỤC GATES A – D)**

---

## 1. Overview API Contract (Hợp đồng API Tổng quan)

### 1.1 Khảo sát và Đồng bộ Định tuyến
Trước đó tài liệu ghi nhận sự khác biệt giữa hai route:
- Phân loại mã nguồn / Phase 1: `GET /api/projects/{id}/v2/overview`
- Ghi nhận mạng runtime Phase 14 cũ: `GET /api/projects/{id}/overview`

### 1.2 Hành động chuẩn hóa
1. **Endpoint chuẩn tắc duy nhất (Single Canonical Dependency)**:
   - Route chuẩn: `GET /api/projects/{dir_name}/v2/overview` (kèm alias `GET /api/projects/{dir_name}/slice/overview`).
   - Được định nghĩa tại `studio/app.py`, xử lý bởi `project_adapter.load_overview_slice`.
   - Đã được làm giàu (enriched) để cung cấp trọn vẹn cả dữ liệu lát cắt (`status_summary`, `stats`) lẫn dữ liệu hiển thị (`totalDuration`, `stages`, `blockers`).
2. **Frontend kết nối độc quyền với Endpoint chuẩn**:
   - Tệp `studio/static/phase14_ui.js` (`loadOverviewData`) đã được chuyển đổi rõ ràng sang gọi:
     ```javascript
     const res = await fetch(`/api/projects/${encodeURIComponent(p)}/v2/overview`);
     ```
3. **Bề mặt tương thích ngược (Compatibility Alias)**:
   - Endpoint `GET /api/projects/{dir_name}/overview` tại `studio/phase14_router.py` được duy trì độc lập làm alias tương thích cho các script hoặc tích hợp bên ngoài cũ, không phải là nguồn dữ liệu thứ hai.
4. **Minh chứng**:
   - `temp/phase03a_minor_closure/api/overview_route_contract.md`
   - `temp/phase03a_minor_closure/api/network_route_verification.json` (ghi nhận 200 OK với thời gian phản hồi 15ms).

---

## 2. Story Navigator Keyboard Semantics (Ngữ nghĩa Bàn phím Trình điều hướng Nhịp)

### 2.1 Hiện trạng và Vấn đề
Story Navigator sử dụng composite widget ARIA:
```html
role="listbox"
role="option"
aria-selected="..."
```
Trước đây chỉ kiểm tra thứ tự phím Tab mà chưa kiểm tra/cài đặt tương tác bàn phím chuyên sâu bên trong danh sách 138 nhịp.

### 2.2 Triển khai WAI-ARIA Roving Tabindex & Phím điều hướng
Đã triển khai hoàn chỉnh trong `studio/static/app.js` và `studio/static/uq-shell.css`:
1. **Cơ chế Roving Tabindex**:
   - Nhịp đang chọn mang `tabindex="0"`.
   - Toàn bộ các nhịp còn lại mang `tabindex="-1"`.
   - Người dùng bấm phím `Tab` để bước vào danh sách trực tiếp tại nhịp đang chọn. Bấm `Tab` lần nữa sẽ thoát ra điều khiển tiếp theo (`#script-input`) trong đúng 1 lần bấm phím (không phải nhấn Tab 138 lần).
2. **Điều hướng phím dọc**:
   - `ArrowDown`: Di chuyển tiêu điểm và chọn nhịp kế tiếp (`i + 1`), cập nhật `aria-selected="true"`, đồng bộ dữ liệu sang Story Inspector, tự động cuộn hiển thị (`scrollIntoView`).
   - `ArrowUp`: Di chuyển tiêu điểm và chọn nhịp liền trước (`i - 1`).
   - `Home`: Nhảy nhanh về nhịp đầu tiên (`beat_001`).
   - `End`: Nhảy nhanh về nhịp cuối cùng (`beat_138`).
3. **Hiển thị tiêu điểm trực quan (Focus visible)**:
   - Bổ sung quy tắc CSS `:focus` / `:focus-visible` với viền `outline: 2px solid var(--uq-accent)` rõ ràng.
4. **Minh chứng tự động qua CDP**:
   - Tệp `temp/phase03a_minor_closure/accessibility/story_navigator_keyboard.json` ghi nhận chuyển đổi thành công 100% từ `beat_001` -> `beat_002` qua `ArrowDown`, quay về qua `ArrowUp`, nhảy đến `beat_138` qua `End`, nhảy về `beat_001` qua `Home`, và thoát khỏi widget qua `Tab`.

---

## 3. Performance Measurement Methodology (Phương pháp & Đơn vị Đo lường Hiệu năng)

### 3.1 Chuẩn hóa Đơn vị & Biên giới Đo lường
Đã loại bỏ hoàn toàn sự mập mờ dấu chấm/phẩy phân cách hàng nghìn, công bố song song cả đơn vị mili-giây (`ms`) và giây (`s`):

| Chỉ số đo kiểm | Đồng hồ / API | Điểm bắt đầu (Start) | Điểm kết thúc (End) | Trạng thái | Mạng | DOM | Giá trị Trung vị (Median) |
|---|---|---|---|---|---|---|---|
| **App Shell Initial Usable** | `time.perf_counter()` + CDP `Page.navigate` | Bắt đầu tải trang | Stepper & khung App Shell sẵn sàng tương tác | Cold | Có | Có | **2.513,83 ms** (~2,51s) |
| **Overview Data Render** | `performance.now()` in browser | `switchWorkspace('overview')` | `v2/overview` HTTP 200 parsed + 6 thẻ tiến độ render | Warm | Có | Có | **1.221,81 ms** (~1,22s) |
| **Workbench Switch** | `performance.now()` in browser | Nhấp chuyển `#ws-story` | Class `.active` kích hoạt, hiển thị khung nhìn | Warm | Không | Có | **809,75 ms** (~0,81s) |
| **Story Load & Render** | `performance.now()` in browser | Kích hoạt `loadStorySlice` | 138 nhịp hiển thị + nạp kịch bản + inspector sẵn sàng | Warm | Có | Có | **1.018,78 ms** (~1,02s) |
| **Script Save Round-Trip** | `performance.now()` in browser | Nhấp `"Lưu kịch bản"` | POST /script trả lời 200 + badge đổi "Đã lưu" | Warm | Có | Có | **1.202,36 ms** (~1,20s) |

- Minh chứng:
  - `temp/phase03a_minor_closure/performance/measurement_methodology.md`
  - `temp/phase03a_minor_closure/performance/verified_measurements.json`

---

## 4. Documentation Wording Sync (Đồng bộ Thuật ngữ Tài liệu)
1. **Chuẩn hóa Roadmap**:
   - Thay thế toàn bộ cụm từ mơ hồ `"Phase 4+ (Engine, Cloud, Scale)"` thành:
     ```text
     Phase 4+ = CHƯA BẮT ĐẦU (NOT STARTED)
     ```
   - Tuyệt đối không đưa phạm vi "Cloud" vào dự án cục bộ (local-first).
2. **Chuẩn hóa Phân loại Cảnh/Cảnh quay**:
   - `79 Scenes` được chuẩn hóa thành `79 Cảnh`.
   - `141 Shots` được chuẩn hóa thành `141 Cảnh quay`.
3. **Bảo tồn mã nguồn**: Không thay đổi bất kỳ định danh biến, class hay endpoint nội bộ nào.

---

## 5. Regression Status (Tình trạng Hồi quy Hệ thống)
Chạy toàn bộ bộ kiểm thử hồi quy chuẩn tắc:
```bash
python -m pytest --tb=short -q
```
- **Kết quả**: **491 / 491 tests PASSED (100% ĐẠT)** trong 45.56 giây.
- **Tỷ lệ thất bại**: **0% (0 failed, 0 errors)**.
- Kiểm thử phân đoạn 3A: `tests/test_phase03a_app_shell_overview_story.py` (8 / 8 tests PASSED).
- Kiểm thử CDP tổng thể: `tests/verify_phase03a_final_gates.py` (10 / 10 gates PASSED).
- Kiểm thử CDP bổ sung điểm nhỏ: `tests/verify_phase03a_minor_closure.py` (3 / 3 gates PASSED).

---

## 6. Scope Audit (Kiểm toán Phạm vi)
- **Subphase 3B (Voice Workbench)**: **CHƯA BẮT ĐẦU (NOT STARTED)**
- **Subphase 3C (Visual Workbench)**: **CHƯA BẮT ĐẦU (NOT STARTED)**
- **Subphase 3D (Export Workbench)**: **CHƯA BẮT ĐẦU (NOT STARTED)**
- **Phase 4+**: **CHƯA BẮT ĐẦU (NOT STARTED)**
- **An toàn tuyệt đối**: Không sử dụng lệnh `git clean -fd`.

---

## 7. Final Verdict (Phán quyết Cuối cùng)

```text
================================================================================
SUBPHASE 3A: PASS / FINAL
READY FOR SUBPHASE 3B
================================================================================
```

Tất cả các khoảng trống chất lượng và sự mâu thuẫn nhỏ về endpoint, ngữ nghĩa bàn phím và tài liệu đã được giải quyết trọn vẹn 100%. Dự án chính thức đóng Subphase 3A và sẵn sàng chuyển tiếp sang phân đoạn 3B.
