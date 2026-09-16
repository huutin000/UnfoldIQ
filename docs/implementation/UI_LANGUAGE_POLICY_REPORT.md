# BÁO CÁO THIẾT LẬP CHÍNH SÁCH NGÔN NGỮ GIAO DIỆN UNFOLDIQ
## UI LANGUAGE POLICY ESTABLISHMENT & SYNCHRONIZATION REPORT

> **Tài liệu:** `UI_LANGUAGE_POLICY_REPORT.md`  
> **Thời điểm cập nhật:** 2026-09-16  
> **Căn cứ chỉ đạo:** `UNFOLDIQ-UI-LANGUAGE-POLICY-FINAL-CONSISTENCY-FIX-PROMPT.md`  
> **Trạng thái thực thi:** Hoàn tất chuẩn hóa nhất quán tài liệu, phân định ranh giới Policy vs Implementation, không sửa source code ứng dụng.

---

### 1. Trạng Thái Chính Sách & Triển Khai (Policy vs Implementation Distinction)
- **Policy status:** `ACTIVE` (Chính thức có hiệu lực và là khế ước bắt buộc từ Subphase 3A trở đi).
- **Implementation status:** `ENFORCED FOR ALL NEW/TOUCHED USER-FACING UI FROM PHASE 3A ONWARD` (Bắt buộc áp dụng cho toàn bộ UI mới hoặc được chỉnh sửa khi tái cấu trúc).
- **Current legacy UI compliance:** `NOT CLAIMED` (Không khẳng định UI cũ đã tuân thủ 100%; việc di chuyển sang chuẩn tiếng Việt được thực hiện tuần tự khi tái cấu trúc từng Workbench từ Phase 3A $\rightarrow$ Phase 6).
- **Vị trí tích hợp trong kiến trúc:**
  - `docs/implementation/implementation_plan.md` — Mục **2.9: Chính sách Ngôn ngữ Giao diện (UI Language Policy)**.
  - `docs/implementation/UI_LANGUAGE_GLOSSARY.md` — Bảng từ điển thuật ngữ chuẩn mực (`Single Source of Truth`).
  - `docs/implementation/ROADMAP_STATUS.md` — Kỷ luật thực thi Mục 2.6.

---

### 2. Ngôn Ngữ Giao Diện Mặc Định & Xác Minh Thẻ HTML (Default UI Language & HTML Lang)
- **Ngôn ngữ mặc định:** **Tiếng Việt (`Vietnamese-first`)**.
- **Xác minh mã nguồn hiện hữu (`<html lang="vi">`):**
  - Đã rà soát trực tiếp file App Shell nguồn: `studio/static/index.html` dòng 2 đã khai báo sẵn `<html lang="vi">`.
  - Không cần thay đổi mã nguồn trong tác vụ tài liệu này.
  - **Tiêu chí nghiệm thu Subphase 3A:** Toàn bộ quá trình tái cấu trúc App Shell tại Subphase 3A bắt buộc phải duy trì và bảo toàn khai báo `<html lang="vi">`.
- **Phạm vi áp dụng:** Chính sách áp dụng cho 100% bề mặt user-facing khi được xây mới hoặc chỉnh sửa từ Subphase 3A trở đi, bao gồm: Navigation, Menu, Tab, Button, CTA, Label, Helper text, Validation, Error messages, Warnings, Tooltips, Empty states, Modal dialogs, Toasts, Table headers, Search placeholders, Preflight checklists và User-facing job progress.

---

### 3. Quy Tắc Giữ Nguyên Tiếng Anh Kỹ Thuật (Canonical Technology Naming)
Giữ nguyên 100% tiếng Anh cho các nhóm thực thể sau, tuyệt đối không dịch máy móc gây méo mó hoặc sai lệch ngữ nghĩa kỹ thuật:
1. **Tên công nghệ, thư viện, engine:** `FFmpeg`, `ffprobe` (viết thường khi chỉ công cụ/lệnh CLI), `Kokoro`, `Faster-Whisper`, `Whisper`, `Veo`, `Flow`, `Playwright`, `axe-core`, `SQLite`, `WAL`.
2. **Bộ mã hóa, định dạng, giao thức & chuẩn quốc tế:** `NVENC`, `CUDA`, `H.264`, `H.265`, `AV1`, `AAC`, `PCM`, `MP3`, `WebP`, `PNG`, `JPEG`, `MP4`, `MOV`, `JSON`, `CSV`, `SRT`, `VTT`, `API`, `HTTP`, `REST`, `WCAG 2.2 AA`.
3. **Phần cứng & thuật toán tính toán:** `GPU`, `CPU`, `VRAM`, `SHA-256`.
4. **Thuật ngữ tạo sinh AI chuyên biệt:** `Negative Prompt`, `Visual Bible`, `Render Manifest`.
5. **Cú pháp song ngữ khi giải thích lần đầu:** Đối với các thuật ngữ trừu tượng, áp dụng công thức: `Tiếng Việt (Thuật ngữ tiếng Anh gốc)`. Ví dụ: `Đồ thị phụ thuộc (Dependency Graph)`, `Bản sửa đổi (Revision)`, `Khóa nội dung (Lock)`, `Bộ nhớ đệm (Cache)`, `Bản xem trước nhẹ (Proxy)`, `Cổng kiểm tra trước khi xuất (Preflight)`.

---

### 4. Ranh Giới Kỹ Thuật Nội Bộ & Giao Diện Người Dùng (Internal-vs-User-Facing Boundary)
- **Kỹ thuật nội bộ (Backend / Internal Implementation):** Giữ nguyên 100% tiếng Anh.
  - Tên biến, hàm, class, module, database fields, schema keys, API routes (`/api/projects/{id}/story`), test case names, developer logs.
  - Giá trị enum thực sự trong code và cơ sở dữ liệu (`DRAFT`, `NEEDS_REVIEW`, `READY`, `OUTDATED`, `BLOCKED`, `QUEUED`, `RENDERING`, `COMPLETED`, `FAILED`, `CANCELLED`).
  - Cờ trạng thái boolean (ví dụ: `is_locked = true / false`), tuyệt đối không bịa đặt thành các enum giả tưởng.
  - Tuyệt đối **không đổi tên API, enum, schema hay database field** chỉ để phục vụ Việt hóa.
- **Giao diện người dùng (User-Facing UI):**
  - Mọi enum và mã lỗi phải đi qua lớp ánh xạ từ điển (Locale Dictionary) trước khi render.
  - Tuyệt đối không để lộ raw string như `OUTDATED` hay `MISSING_ASSET` trên giao diện thông thường của người dùng (chỉ hiển thị mã lỗi trong phần chi tiết kỹ thuật của Developer/Debug mode nếu được kích hoạt).

---

### 5. Bảng Ánh Xạ Trạng Thái & Hành Động Cốt Lõi (Status / Action Mappings)

#### 5.1. Ánh xạ Trạng thái Thực thể & Tiến trình (Internal Enum $\rightarrow$ Nhãn UI):
| Giá trị Enum Nội Bộ | Nhãn Hiển Thị Giao Diện (Tiếng Việt) | Là Enum Thật? | Phân Lớp / Ghi Chú |
| :--- | :--- | :---: | :--- |
| `DRAFT` | **Bản nháp** | Có | Vòng đời thực thể ban đầu |
| `NEEDS_REVIEW` | **Cần kiểm tra** | Có | Vòng đời thực thể / Cảnh báo QA |
| `READY` | **Sẵn sàng** | Có | Vòng đời thực thể hoàn tất |
| `OUTDATED` | **Cần cập nhật** | Có | DAG Dependency lan truyền |
| `BLOCKED` | **Bị chặn** | Có | Cổng kiểm tra / Thiếu điều kiện tiên quyết |
| `QUEUED` | **Đang chờ** | Có | Bộ điều phối tài nguyên (Scheduler) |
| `RENDERING` | **Đang kết xuất** | Có | Tiến trình FFmpeg / NVENC |
| `COMPLETED` | **Hoàn tất** | Có | Tác vụ hoàn thành |
| `FAILED` | **Thất bại** | Có | Tác vụ gặp lỗi |
| `CANCELLED` | **Đã hủy** | Có | Tác vụ bị hủy bỏ |

#### 5.2. Ánh xạ Cờ Bảo Vệ Khóa (Derived Boolean UI State):
> [!NOTE]
> Khóa trong Phase 2 được mô hình hóa chính xác là trường boolean `is_locked: bool` trong `ArtifactLock` / `ArtifactRevision`, **không phải là enum `LOCKED`/`UNLOCKED`**. Dưới đây là bảng ánh xạ hiển thị:

| Giá trị Boolean Nội Bộ | Nhãn Hiển Thị Giao Diện (Tiếng Việt) | Loại Dữ Liệu | Ngữ Cảnh Giao Diện |
| :--- | :--- | :---: | :--- |
| `is_locked = true` | **Đã khóa** | `boolean` | Badge trạng thái bảo vệ, nút chuyển `Mở khóa` |
| `is_locked = false` | **Mở khóa** | `boolean` | Trạng thái cho phép tạo lại, nút chuyển `Khóa` |

#### 5.3. Ánh xạ Hành động & Nút tương tác:
| Nút Hành Động Gốc | Nhãn Nút Tiếng Việt | Ghi Chú |
| :--- | :--- | :--- |
| `Save` | **Lưu** | Lưu thay đổi |
| `Cancel` | **Hủy** | Hủy thao tác |
| `Delete` | **Xóa** | Xóa thực thể (kèm confirm modal) |
| `Restore` | **Khôi phục** | Phục hồi snapshot checkpoint |
| `Retry` | **Thử lại** | Chạy lại tác vụ lỗi |
| `Generate` | **Tạo** | Kích hoạt AI tạo nội dung |
| `Regenerate` | **Tạo lại** | Kích hoạt AI sinh lại |
| `Lock` / `Unlock` | **Khóa** / **Mở khóa** | Thao tác đổi cờ `is_locked` |
| `Download` / `Upload` | **Tải xuống** / **Tải lên** | Tương tác file |
| `Approve` / `Reject` | **Duyệt** / **Từ chối** | Phê duyệt chất lượng |
| `Search` / `Filter` / `Reset` | **Tìm kiếm** / **Lọc** / **Đặt lại** | Thanh công cụ |
| `Export` / `Render` | **Xuất dữ liệu** / **Kết xuất video** | Xuất xưởng video |

---

### 6. Quy Tắc Tên Tiếp Cận / Trợ Năng (Accessible-Name Implementation Rule)
Áp dụng kỷ luật trợ năng tiếng Việt theo thứ tự ưu tiên:
1. **Ưu tiên nhãn HTML tự nhiên và văn bản tiếng Việt hiển thị:** Luôn sử dụng thẻ `<label for="...">` hoặc văn bản hiển thị trực tiếp trên nút làm accessible name chính.
2. **Sử dụng `aria-labelledby`:** Khi đã có một nhãn tiếng Việt hiển thị trực quan và cần liên kết ngữ nghĩa với phần tử điều khiển.
3. **Chỉ dùng `aria-label` khi không có nhãn hiển thị trực quan:** Áp dụng cho các nút icon-only hoặc các thành phần đồ họa không chứa text.
4. **Tuyệt đối không thêm `aria-label` dư thừa đè lên text hiển thị rõ ràng:** Ví dụ không viết `<button aria-label="Lưu">Lưu</button>` vì text `Lưu` đã cung cấp đầy đủ accessible name chuẩn xác.
5. **Toàn bộ văn bản trợ năng ẩn bắt buộc là tiếng Việt:** Mọi `aria-label`, `aria-description`, `title`, `.sr-only` khi bắt buộc phải dùng đều phải viết bằng tiếng Việt tự nhiên đồng bộ với giao diện.

**Ví dụ minh họa:**
- *Khuyến nghị (Native label):*
  ```html
  <label for="voice-speed">Tốc độ đọc</label>
  <input id="voice-speed" type="range" min="0.5" max="2.0">
  ```
- *Hành động Icon-only (Cần aria-label tiếng Việt):*
  ```html
  <button aria-label="Khóa cảnh quay 12"><i class="icon-lock"></i></button>
  ```
- *Không lạm dụng thừa thãi:*
  ```html
  <!-- ĐÚNG: Tận dụng text hiển thị -->
  <button type="submit">Lưu kịch bản</button>

  <!-- SAI: Thừa thãi và ghi đè không cần thiết -->
  <button type="submit" aria-label="Lưu kịch bản">Lưu kịch bản</button>
  ```

---

### 7. Phân Bổ Áp Dụng Xuyên Suốt Lộ Trình (Phase 1–9 Application Matrix)
- **Phase 1 (Workflow & Data Foundation):** Giữ nguyên backend APIs/schemas; mọi thông báo user-facing phát sinh trong bảo trì phải dùng tiếng Việt.
- **Phase 2 (Dependency Engine, Versioning & Scheduler):** Internal models dùng tiếng Anh (`ArtifactRevision`, `DependencyGraph`, `ResourceScheduler`); thông báo người dùng (`Next Best Action`, `Lock conflict`, `Resource busy`) dùng tiếng Việt.
- **Subphase 3A (App Shell + Overview + Story):** Duy trì `<html lang="vi">`; menu `Tổng quan`, `Kịch bản`, bảng `Kiểm tra nội dung`, `Số từ`, `Thời lượng ước tính` 100% tiếng Việt.
- **Subphase 3B (Voice Workbench):** Giao diện chỉnh sửa giọng, `Phát âm`, `Kiểm tra giọng đọc` (Voice QA) tiếng Việt; giữ nguyên tên model `Kokoro`, `Faster-Whisper`.
- **Subphase 3C (Visual Workbench):** `Cảnh` (Scene), `Cảnh quay` (Shot), `Chuyển động máy quay`; giữ nguyên thuật ngữ kỹ thuật `Visual Bible`, `Negative Prompt`.
- **Subphase 3D (Export Workbench):** `Xuất video`, `Kiểm tra trước khi xuất` (Preflight), `Kết xuất video`, `Tải xuống`.
- **Phase 4 (Media & Asset Pipeline):** `Tài nguyên` (Asset), `Ảnh thu nhỏ` (Thumbnail), `Bản xem trước nhẹ (Proxy)`, `Bản gốc / Master`, `Gói sản xuất` (Portable Package); giữ nguyên WebP, MP4, AAC.
- **Phase 5 (UI Polish & Virtualization):** Command Palette (`Tìm cảnh hoặc cảnh quay...`), danh sách lọc và phím tắt (`Ctrl + K`) tuân thủ chuẩn tiếng Việt.
- **Phase 6 (Accessibility & Responsive):** Kiểm chuẩn `WCAG 2.2 AA`; accessible names tuân thủ quy tắc ưu tiên native label; 100% text trợ năng tiếng Việt.
- **Phase 7 (Render Manifest):** File `render-manifest.json` giữ schema tiếng Anh; thông báo lỗi biên dịch hiển thị bằng tiếng Việt.
- **Phase 8 (Manifest-Driven FFmpeg Render Engine):** Giữ nguyên tên `FFmpeg`, `NVENC`; thông báo trạng thái kết xuất (`Đang kết xuất bằng NVENC...`) bằng tiếng Việt.
- **Phase 9 (Automated Render QA):** Báo cáo nghiệm thu hiển thị tiếng Việt; giữ nguyên log chẩn đoán `ffprobe` cho developers.

---

### 8. Danh Sách Kiểm Tra Sẵn Sàng Cho Subphase 3A (Subphase 3A Readiness Checklist)
Trước khi bắt đầu thực thi code UI cho Subphase 3A, toàn bộ các điều kiện sau đã được đáp ứng:
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

### 9. Rà Soát Sửa Đổi Mã Nguồn Ứng Dụng (Source Code Changed?)
- **Kết quả kiểm tra:** **`NO`**
- **Cam kết kỷ luật:** Tác vụ này thuần túy là `DOCUMENTATION / POLICY CONSISTENCY`. Không thay đổi bất kỳ file mã nguồn ứng dụng nào trong `studio/`, `tests/`, `static/`, hay `templates/`.

---

### 10. Phán Quyết Cuối Cùng (Final Verdict)

```text
================================================================================
UI LANGUAGE POLICY PASS / FINAL
READY FOR SUBPHASE 3A APPLICATION
================================================================================
Canonical UI Language Policy has been fully normalized and synchronized with
zero application source code drift. All 10 checklist gates for Subphase 3A
readiness have been satisfied.
================================================================================
```
