# BÁO CÁO KIỂM ĐỊNH VÀ CHUẨN HÓA NHẤT QUÁN CHÍNH SÁCH NGÔN NGỮ GIAO DIỆN
## UI LANGUAGE POLICY FINAL CONSISTENCY VERIFICATION REPORT

- **Dự án**: UnfoldIQ Workstation
- **Tài liệu**: `docs/implementation/UI_LANGUAGE_POLICY_FINAL_VERIFICATION_REPORT.md`
- **Ngày thực hiện**: 2026-09-16
- **Phân loại tác vụ**: `DOCUMENTATION / POLICY CONSISTENCY ONLY`
- **Cam kết kỷ luật**: Tuyệt đối **không sửa source code ứng dụng**; **không bắt đầu Subphase 3A**.

---

### 1. Trạng Thái Chính Sách (Policy Status)
- **Trạng thái chính thức:** **`ACTIVE`**
- Chính sách ngôn ngữ giao diện (UI Language Policy) đã được phê duyệt, thiết lập làm khế ước bắt buộc và được tích hợp đầy đủ vào:
  1. `docs/implementation/implementation_plan.md` (Mục 2.9)
  2. `docs/implementation/UI_LANGUAGE_GLOSSARY.md` (Phiên bản chuẩn 1.1.0)
  3. `docs/implementation/ROADMAP_STATUS.md` (Mục 2.6)
  4. `docs/implementation/UI_LANGUAGE_POLICY_REPORT.md`

---

### 2. Phân Định Ranh Giới Policy vs Implementation (Policy-vs-Implementation Distinction)
Đã chuẩn hóa và làm rõ ranh giới pháp lý kỹ thuật:
- **Policy status = `ACTIVE`**: Khế ước chính sách có hiệu lực ngay lập tức trên toàn bộ quy trình thiết kế và tài liệu hệ thống.
- **Implementation status = `ENFORCED FOR ALL NEW/TOUCHED USER-FACING UI FROM PHASE 3A ONWARD`**: Bắt buộc áp dụng cho 100% bề mặt giao diện người dùng khi được tạo mới hoặc chỉnh sửa/tái cấu trúc từ Subphase 3A trở đi.
- **Current legacy UI compliance = `NOT CLAIMED`**: Không tuyên bố giao diện legacy cũ đã tuân thủ 100% tiếng Việt trước khi được audit và tái cấu trúc. Toàn bộ các câu từ khẳng định tuyệt đối trước đây (như *"100% bề mặt tương tác người dùng sử dụng tiếng Việt"*) đã được chuẩn hóa lại thành:
  > *"Chính sách áp dụng cho 100% bề mặt user-facing khi được xây mới hoặc chỉnh sửa từ Subphase 3A trở đi."*
  Hệ thống sẽ di chuyển (migrate) UI cũ sang tiếng Việt tuần tự theo từng Workbench (3A: App Shell, Overview, Story $\rightarrow$ 3B: Voice $\rightarrow$ 3C: Visual $\rightarrow$ 3D: Export).

---

### 3. Kết Quả Xác Minh Khai Báo HTML Lang (`<html lang="vi">` Verification)
- **Kiểm tra trực tiếp mã nguồn App Shell hiện hữu:**
  - File: `studio/static/index.html` (dòng 2)
  - Khai báo thực tế:
    ```html
    <!DOCTYPE html>
    <html lang="vi">
    ```
- **Kết luận:**
  - File App Shell nguồn đã khai báo sẵn `<html lang="vi">`.
  - Không cần sửa đổi source code trong tác vụ tài liệu này.
  - **Tiêu chí nghiệm thu Subphase 3A:** Quá trình tái cấu trúc App Shell tại Subphase 3A bắt buộc phải duy trì và bảo toàn khai báo `<html lang="vi">`.

---

### 4. Hiệu Chỉnh Mô Hình Trạng Thái Khóa (Lock-State Model Correction)
- **Hiện trạng kỹ thuật lõi Phase 2:**
  - Khóa thực thể được biểu diễn chính xác dưới dạng trường boolean `is_locked: bool` trong `ArtifactLock` / `ArtifactRevision` và cơ sở dữ liệu SQLite.
  - Hệ thống **không có enum nội bộ nào mang tên `LOCKED` hay `UNLOCKED`**.
- **Hiệu chỉnh tài liệu:**
  - Đã xóa bỏ hoàn toàn `LOCKED` và `UNLOCKED` khỏi bảng enum nội bộ trong `UI_LANGUAGE_POLICY_REPORT.md` và `UI_LANGUAGE_GLOSSARY.md`.
  - Phân loại rõ ràng sang danh mục **Derived UI States & Booleans**:
    ```text
    Internal boolean:
      is_locked = true   →  Nhãn UI: "Đã khóa"  (Hiển thị icon khóa đóng, tooltip giải thích bảo vệ)
      is_locked = false  →  Nhãn UI: "Mở khóa"  (Nút bấm cho phép khóa lại hoặc trạng thái bình thường)
    ```

---

### 5. Quy Tắc Tên Tiếp Cận / Trợ Năng (Accessible-Name Implementation Rule)
Đã ban hành quy tắc cài đặt tên tiếp cận (Accessible Name) rõ ràng, ngăn chặn việc lạm dụng ARIA:
1. **Ưu tiên nhãn HTML tự nhiên và text tiếng Việt hiển thị:** Luôn sử dụng `<label for="...">` hoặc văn bản hiển thị trên nút làm accessible name chính.
2. **Sử dụng `aria-labelledby`:** Khi đã có một nhãn tiếng Việt hiển thị trực quan và cần liên kết ngữ nghĩa ARIA.
3. **Chỉ dùng `aria-label` khi không có nhãn hiển thị trực quan:** Áp dụng riêng cho các nút icon-only hoặc điều khiển đồ họa không chứa text.
4. **Tuyệt đối không thêm `aria-label` dư thừa đè lên text hiển thị rõ ràng:** Ví dụ: không viết `<button aria-label="Lưu">Lưu</button>` vì text hiển thị `Lưu` đã cung cấp accessible name hoàn hảo.
5. **Toàn bộ văn bản trợ năng ẩn bắt buộc là tiếng Việt:** Mọi `aria-label`, `aria-description`, `title`, `.sr-only` khi sử dụng đều phải viết bằng tiếng Việt tự nhiên đồng bộ với giao diện.

---

### 6. Chuẩn Hóa Bảng Từ Điển Thuật Ngữ (Glossary Normalization)
Tài liệu `docs/implementation/UI_LANGUAGE_GLOSSARY.md` đã được nâng cấp lên phiên bản 1.1.0:
- Bổ sung metadata chính sách rõ ràng (`Policy status: ACTIVE`, `Applies from: Subphase 3A`).
- Bổ sung các cột phân biệt minh bạch:
  - `Internal Value`
  - `Vietnamese Display Label`
  - `Is Actual Enum?` (Phân biệt enum thật và giả)
  - `Derived UI State?` (Chỉ định trạng thái suy diễn từ boolean)
  - `Keep English?` (Chỉ định danh từ riêng/chuẩn kỹ thuật giữ nguyên)
- Chuẩn hóa tên công nghệ và công cụ:
  - Sử dụng `ffprobe` viết thường khi đề cập đến công cụ thực thi CLI / câu lệnh.
  - Giữ nguyên casing chuẩn: `FFmpeg`, `Kokoro`, `Faster-Whisper`, `NVENC`, `CUDA`, `SQLite`, `Playwright`, `axe-core`.

---

### 7. Danh Sách Kiểm Tra Sẵn Sàng Cho Subphase 3A (Subphase 3A Readiness Checklist)
Toàn bộ 10/10 điều kiện tiên quyết về mặt chính sách ngôn ngữ đã được thỏa mãn đầy đủ:
- [x] `UI_LANGUAGE_POLICY_REPORT.md` = `ACTIVE`.
- [x] `UI_LANGUAGE_GLOSSARY.md` = Canonical wording source of truth.
- [x] `<html lang="vi">` đã được kiểm chứng tồn tại trong mã nguồn hiện hữu (`studio/static/index.html`) và là tiêu chí nghiệm thu bắt buộc của 3A.
- [x] Các nhãn Top-level Workbench đã có tên tiếng Việt chuẩn hóa (`Tổng quan`, `Kịch bản`, `Giọng đọc`, `Hình ảnh & Cảnh`, `Xuất video`).
- [x] Bảng ánh xạ trạng thái cho toàn bộ 10 trạng thái Phase 2 đã sẵn sàng.
- [x] Cờ boolean `is_locked` có ánh xạ hiển thị tiếng Việt rõ ràng (`Đã khóa` / `Mở khóa`), không nhầm lẫn thành enum.
- [x] Toàn bộ mã lỗi Phase 2 (`MISSING_ASSET`, `LOCK_CONFLICT`, v.v.) có chiến lược hiển thị thông báo tiếng Việt hành động được.
- [x] Quy tắc accessible-name ưu tiên nhãn native/visible trước khi dùng ARIA đã được ban hành.
- [x] Toàn bộ định danh API/schema/enum giữ nguyên tiếng Anh.
- [x] Không dịch tràn lan các định danh kỹ thuật, tên công cụ hoặc codec.

---

### 8. Rà Soát Sửa Đổi Mã Nguồn Ứng Dụng (Source Code Changed?)
- **Kết quả kiểm tra:** **`NO`**
- Tuyệt đối **không có bất kỳ file mã nguồn ứng dụng nào** trong `studio/`, `tests/`, `static/`, hay `templates/` bị sửa đổi hoặc tạo mới trong tác vụ này.
- Mọi thay đổi đều được giới hạn tuyệt đối trong 5 file tài liệu:
  - `docs/implementation/implementation_plan.md`
  - `docs/implementation/ROADMAP_STATUS.md`
  - `docs/implementation/UI_LANGUAGE_GLOSSARY.md`
  - `docs/implementation/UI_LANGUAGE_POLICY_REPORT.md`
  - `docs/implementation/UI_LANGUAGE_POLICY_FINAL_VERIFICATION_REPORT.md`

---

### 9. Phán Quyết Cuối Cùng (Final Verdict)

```text
================================================================================
UI LANGUAGE POLICY PASS / FINAL
READY FOR SUBPHASE 3A APPLICATION
================================================================================
```
