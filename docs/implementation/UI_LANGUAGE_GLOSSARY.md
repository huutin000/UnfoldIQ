# BẢNG TỪ ĐIỂN THUẬT NGỮ GIAO DIỆN UNFOLDIQ
## CANONICAL UI LANGUAGE GLOSSARY — VIETNAMESE-FIRST STANDARD

> **Phiên bản:** 1.1.0 (Áp dụng thống nhất từ Subphase 3A $\rightarrow$ Phase 9)  
> **Policy status:** `ACTIVE`  
> **Applies from:** Subphase 3A onward for all new/touched user-facing UI  
> **Legacy UI:** Di chuyển tuần tự khi từng Workbench được tái cấu trúc (không khẳng định compliance trước khi audit)  
> **Căn cứ chính sách:** `docs/implementation/implementation_plan.md` (Mục 2.9: UI Language Policy)  
> **Nguyên tắc cốt lõi:**  
> - **Giao diện người dùng (User-Facing UI):** Ưu tiên tiếng Việt tự nhiên (`Vietnamese-first`).  
> - **Kỹ thuật nội bộ (Code / API / Schema / DB):** 100% Tiếng Anh chuẩn mực (`English`).  
> - **Danh từ riêng, Chuẩn kỹ thuật, Codec, Hardware, AI Models:** Giữ nguyên tên gốc tiếng Anh quốc tế.

---

### 1. Nguyên Tắc Tra Cứu & Sử Dụng Thuật Ngữ

1. **Nguồn sự thật duy nhất (Single Source of Truth):** Mọi màn hình, modal, toast, nút bấm và nhãn trợ năng (accessibility labels) trên giao diện UnfoldIQ phải tuân thủ nghiêm ngặt các thuật ngữ được quy định trong tài liệu này.
2. **Không để lộ Raw Enum:** Không bao giờ render trực tiếp các giá trị enum nội bộ (ví dụ: `OUTDATED`, `NEEDS_REVIEW`) lên giao diện thông thường; bắt buộc phải map qua cột **Vietnamese UI Label**.
3. **Cấu trúc song ngữ khi giải thích lần đầu:** Đối với các thuật ngữ kỹ thuật trừu tượng lần đầu xuất hiện hoặc trong tooltip hướng dẫn, sử dụng cú pháp: `Thuật ngữ tiếng Việt (Thuật ngữ tiếng Anh)`. Ví dụ: `Đồ thị phụ thuộc (Dependency Graph)`.
4. **Quy tắc Accessible-Name (Tên Tiếp Cận):**
   - Ưu tiên nhãn HTML tự nhiên (`<label for="...">`) và văn bản hiển thị tiếng Việt trên phần tử.
   - Sử dụng `aria-labelledby` khi đã có nhãn tiếng Việt hiển thị trực quan và cần liên kết ARIA.
   - Chỉ sử dụng `aria-label` khi không có nhãn hiển thị trực quan (ví dụ: nút chỉ có icon).
   - Tuyệt đối không thêm `aria-label` dư thừa đè lên text hiển thị rõ ràng (ví dụ: không viết `<button aria-label="Lưu">Lưu</button>`).
   - Mọi văn bản trợ năng ẩn bắt buộc phải là tiếng Việt đồng bộ.

---

### 2. Khu Làm Việc & Điều Hướng (Navigation & Workbenches)

| Internal Value | Vietnamese Display Label | Is Actual Enum? | Derived UI State? | Keep English? | Domain / Context | Notes |
| :--- | :--- | :---: | :---: | :---: | :--- | :--- |
| **Overview** | Tổng quan | No | No | No | App Shell / Workbench | Màn hình dashboard tổng quan dự án |
| **Story** | Kịch bản | No | No | No | App Shell / Workbench | Khu vực biên tập kịch bản & phân beat |
| **Voice** | Giọng đọc | No | No | No | App Shell / Workbench | Khu vực tạo âm thanh, QA giọng & timeline word cue |
| **Visual** | Hình ảnh & Cảnh | No | No | No | App Shell / Workbench | Khu vực quản lý cảnh (Scene), cảnh quay (Shot) & Visual Bible |
| **Export** | Xuất video | No | No | No | App Shell / Workbench | Khu vực kiểm tra preflight, xuất zip & render video |
| **Settings** | Cài đặt | No | No | No | App Shell / Global | Cấu hình ứng dụng, đường dẫn, theme |
| **Project Selector** | Chọn dự án | No | No | No | App Shell / Header | Menu chuyển đổi hoặc tạo dự án mới |
| **Diagnostics** | Chẩn đoán kỹ thuật | No | No | No | Global / Debug | Công cụ kiểm tra log, DAG, tài nguyên |
| **Timeline** | Dòng thời gian | No | No | No | Story / Voice / Visual | Trục thời gian hiển thị nhịp độ và cue âm thanh |

---

### 3. Trạng Thái & Enum Nghiệp Vụ Thực Tế (Actual Domain Enums)

> [!IMPORTANT]
> Bảng này chỉ liệt kê các **enum nội bộ thực sự** có trong mã nguồn hoặc domain models. Các cờ boolean (như khóa) được phân tách riêng tại Mục 4.

| Internal Value (Enum) | Vietnamese Display Label | Is Actual Enum? | Derived UI State? | Keep English? | Domain / Context | Notes |
| :--- | :--- | :---: | :---: | :---: | :--- | :--- |
| `DRAFT` | Bản nháp | **Yes** | No | No | Entity Lifecycle | Khởi tạo ban đầu, chưa hoàn thiện |
| `NEEDS_REVIEW` | Cần kiểm tra | **Yes** | No | No | Entity Lifecycle | Cảnh báo hoặc thay đổi cần xác nhận |
| `READY` | Sẵn sàng | **Yes** | No | No | Entity Lifecycle | Đạt toàn bộ kiểm tra chất lượng, sẵn sàng downstream |
| `OUTDATED` | Cần cập nhật | **Yes** | No | No | DAG Dependency | Đầu vào thượng nguồn đã đổi, cần tái tạo/cập nhật |
| `BLOCKED` | Bị chặn | **Yes** | No | No | Workflow Gate | Bị chặn bởi blocker tiên quyết (lỗi QA, thiếu asset) |
| `QUEUED` | Đang chờ | **Yes** | No | No | Job / Scheduler | Tác vụ đang xếp hàng chờ tài nguyên khả dụng |
| `RENDERING` | Đang kết xuất | **Yes** | No | No | Render Engine | Tiến trình FFmpeg / mã hóa video đang thực thi |
| `COMPLETED` | Hoàn tất | **Yes** | No | No | Job / Task | Tác vụ kết thúc thành công |
| `FAILED` | Thất bại | **Yes** | No | No | Job / Task | Tác vụ gặp lỗi không thể tự phục hồi |
| `CANCELLED` | Đã hủy | **Yes** | No | No | Job / Task | Tác vụ do người dùng chủ động hủy |

---

### 4. Ánh Xạ Trạng Thái Suy Diễn & Cờ Boolean (Derived UI States & Booleans)

> [!NOTE]
> Khóa trong Phase 2 là trường boolean `is_locked: bool` trong database / `ArtifactLock`. Tuyệt đối **không coi `LOCKED`/`UNLOCKED` là enum nội bộ**. Dưới đây là quy tắc hiển thị ra UI:

| Internal Value / Expression | Vietnamese Display Label | Is Actual Enum? | Derived UI State? | Keep English? | Component / Context | Notes |
| :--- | :--- | :---: | :---: | :---: | :--- | :--- |
| `is_locked === true` | **Đã khóa** | **No** | **Yes** | No | ShotCard / Chunk Badge | Hiển thị icon ổ khóa đã đóng, tooltip giải thích bảo vệ |
| `is_locked === false` | **Mở khóa** | **No** | **Yes** | No | ShotCard / Chunk Badge | Hiển thị icon ổ khóa mở hoặc trạng thái bình thường |
| `is_dirty === true` | **Chưa lưu** | **No** | **Yes** | No | Editor Toolbar | Cảnh báo có thay đổi chưa commit |
| `is_stale === true` | **Chưa đồng bộ** | **No** | **Yes** | No | Cache State | Trạng thái cache không khớp hash hiện thời |

---

### 5. Hành Động & Động Từ Tương Tác (Actions & Verbs)

| Internal Value / Verb | Vietnamese Display Label | Is Actual Enum? | Derived UI State? | Keep English? | Domain / Context | Notes |
| :--- | :--- | :---: | :---: | :--- | :--- | :--- |
| `save` | **Lưu** | No | No | No | Global Action | Lưu thay đổi hiện tại |
| `cancel` | **Hủy** | No | No | No | Global Action | Hủy thao tác đang thực hiện |
| `delete` | **Xóa** | No | No | No | Entity Action | Xóa thực thể (kèm hộp thoại xác nhận) |
| `restore` | **Khôi phục** | No | No | No | Revision / History | Phục hồi phiên bản snapshot trước |
| `retry` | **Thử lại** | No | No | No | Job / Error | Thử lại tác vụ thất bại |
| `generate` | **Tạo** | No | No | No | AI Action | Kích hoạt AI tạo mới nội dung/âm thanh/ảnh |
| `regenerate` | **Tạo lại** | No | No | No | AI Action | Kích hoạt AI sinh lại nội dung |
| `regenerate_all` | **Tạo lại tất cả** | No | No | No | Bulk Action | Kích hoạt sinh lại toàn bộ (bỏ qua locked) |
| `lock` | **Khóa** | No | No | No | Entity Action | Đặt cờ bảo vệ `is_locked = true` |
| `unlock` | **Mở khóa** | No | No | No | Entity Action | Hủy cờ bảo vệ `is_locked = false` |
| `download` | **Tải xuống** | No | No | No | Export / Media | Tải file về máy tính |
| `upload` | **Tải lên** | No | No | No | Media Action | Tải file tài nguyên lên dự án |
| `copy` | **Sao chép** | No | No | No | Clipboard | Sao chép nội dung vào khay nhớ tạm |
| `edit` | **Chỉnh sửa** | No | No | No | Entity Action | Mở chế độ biên tập |
| `approve` | **Duyệt** | No | No | No | QA Action | Đánh dấu phê duyệt nội dung |
| `reject` | **Từ chối** | No | No | No | QA Action | Đánh dấu không đạt yêu cầu |
| `replace` | **Thay thế** | No | No | No | Media / Text | Thay thế tài sản/nội dung hiện hữu |
| `continue` | **Tiếp tục** | No | No | No | Wizard / Dialog | Tiến hành bước tiếp theo |
| `back` | **Quay lại** | No | No | No | Navigation | Trở lại bước hoặc màn hình trước |
| `close` | **Đóng** | No | No | No | Modal / Panel | Đóng cửa sổ hoặc panel hiện tại |
| `search` | **Tìm kiếm** | No | No | No | Filter / Table | Tra cứu nhanh nội dung |
| `filter` | **Lọc** | No | No | No | Filter / Table | Thu hẹp danh sách theo điều kiện |
| `reset` | **Đặt lại** | No | No | No | Form / Filter | Khôi phục trạng thái mặc định ban đầu |
| `export` | **Xuất dữ liệu** | No | No | No | Production | Xuất gói dữ liệu dự án |
| `render` | **Kết xuất video** | No | No | No | Video Production | Ghép nối và biên dịch ra file MP4 hoàn chỉnh |
| `preflight` | **Kiểm tra trước khi xuất** | No | No | No | Export Gate | Chạy checklist nghiệm thu toàn diện |
| `inspect` | **Kiểm tra kỹ thuật** | No | No | No | QA / Diagnostic | Phân tích chi tiết luồng media bằng `ffprobe` |
| `split` | **Tách đoạn** | No | No | No | Story / Beat | Chia một beat hoặc chunk làm hai |
| `merge` | **Gộp đoạn** | No | No | No | Story / Beat | Gộp các beat hoặc chunk liền kề |

---

### 6. Thực Thể Sản Xuất Nội Dung (Production Entities)

| Internal Value | Vietnamese Display Label | Is Actual Enum? | Derived UI State? | Keep English? | Domain / Context | Notes |
| :--- | :--- | :---: | :---: | :---: | :--- | :--- |
| **Project** | Dự án | No | No | No | Core Domain | Một dự án video cụ thể |
| **StoryBeat** | Đoạn kịch bản | No | No | No | Story Domain | Một nhịp kịch bản nội dung độc lập |
| **AudioChunk** | Đoạn âm thanh | No | No | No | Voice Domain | Một phân đoạn audio tạo từ TTS |
| **Word Cue / Cue** | Mốc thời gian từ | No | No | No | Voice / Subtitle | Cặp (từ, start_time, end_time) phục vụ karaoke/sync |
| **Scene** | Cảnh | No | No | No | Visual Domain | Một phân cảnh lớn trong kịch bản |
| **Shot** | Cảnh quay | No | No | No | Visual Domain | Một góc quay/cắt cảnh cụ thể trong Scene |
| **ShotCard** | Thẻ cảnh quay | No | No | No | Visual Domain | Đơn vị UI hiển thị thông tin chi tiết một Shot |
| **Visual Bible** | Visual Bible | No | No | **Yes** | Visual Domain | Sổ tay quy chuẩn phong cách hình ảnh (thuật ngữ chuyên ngành) |
| **Render Manifest** | Render Manifest | No | No | **Yes** | Render Pipeline | Bản mô tả kỹ thuật trung gian độc lập dùng cho rendering |
| **Script** | Kịch bản gốc | No | No | No | Story Domain | Toàn văn nội dung lời thoại/dẫn chuyện |
| **Narration** | Lời bình / Thuyết minh | No | No | No | Story / Voice | Văn bản đọc thuyết minh |
| **Pronunciation** | Phát âm / Phiên âm | No | No | No | Voice Domain | Từ điển sửa lỗi phát âm TTS |
| **Timeline** | Dòng thời gian | No | No | No | Editor Domain | Trục thời gian hiển thị nhịp điệu & đồng bộ |
| **Track** | Luồng / Rãnh | No | No | No | Timeline Domain | Rãnh âm thanh hoặc hình ảnh |
| **Layer** | Lớp hiển thị | No | No | No | Visual Domain | Lớp hình ảnh, chữ, filter |
| **Proxy** | Bản xem trước nhẹ (Proxy) | No | No | No (First use) | Media Pipeline | Video 720p độ phân giải thấp dùng cho preview mượt mà |
| **Thumbnail** | Ảnh thu nhỏ | No | No | No | Media Pipeline | Ảnh tĩnh WebP kích thước nhỏ đại diện cho Shot |
| **Master** | Bản gốc / Master | No | No | No (First use) | Media Pipeline | Tệp âm thanh WAV PCM 24kHz/16-bit hoặc video 1080p chuẩn |
| **Asset** | Tài nguyên | No | No | No | Media Pipeline | Hình ảnh, video nền, âm thanh hiệu ứng |
| **Clip** | Đoạn phim | No | No | No | Timeline Domain | Phân đoạn video được đặt lên timeline |
| **Transition** | Hiệu ứng chuyển cảnh | No | No | No | Render Pipeline | Hiệu ứng fade, dissolve giữa hai shot |
| **Subtitle / Caption** | Phụ đề | No | No | No | Media / Video | Văn bản phụ đề hiển thị trên video |
| **Revision** | Bản sửa đổi | No | No | No | Versioning | Mốc lưu checkpoint có chủ đích của thực thể |
| **Snapshot** | Bản chụp dữ liệu | No | No | No | Versioning | Bản sao lưu trạng thái dữ liệu tại một thời điểm |
| **Dependency Graph** | Đồ thị phụ thuộc | No | No | No | Core Engine | Đồ thị liên kết thực thể (DAG) |
| **Resource Scheduler** | Bộ điều phối tài nguyên | No | No | No | Compute Engine | Bộ lập lịch quản lý concurrency CPU/GPU/VRAM |
| **Portable Package** | Gói sản xuất di động | No | No | No | Export Domain | Gói ZIP chứa toàn bộ tài nguyên sẵn sàng lưu trữ |

---

### 7. Danh Từ Riêng & Thuật Ngữ Kỹ Thuật Giữ Nguyên Tiếng Anh

| Technical Name | Vietnamese UI Context | Keep English? | Classification | Notes |
| :--- | :--- | :---: | :--- | :--- |
| **FFmpeg** | `FFmpeg` (ví dụ: *Đang kết xuất bằng FFmpeg...*) | **Yes** | Engine Name | Bộ công cụ xử lý đa phương tiện chuẩn |
| **ffprobe** | `ffprobe` (ví dụ: *Đang kiểm tra tệp bằng ffprobe...*) | **Yes** | CLI Tool | Công cụ kiểm tra thông số media (viết thường khi chỉ lệnh) |
| **NVENC** | `NVENC` (ví dụ: *Bộ mã hóa phần cứng NVENC*) | **Yes** | Hardware Codec | Bộ tăng tốc phần cứng NVIDIA |
| **CUDA** | `CUDA` (ví dụ: *Tăng tốc tính toán CUDA*) | **Yes** | Compute Platform | Nền tảng tính toán song song của NVIDIA |
| **GPU / CPU / VRAM** | `GPU / CPU / VRAM` (ví dụ: *Bộ nhớ VRAM khả dụng*) | **Yes** | Hardware | Viết tắt phần cứng tiêu chuẩn quốc tế |
| **Kokoro** | `Kokoro` (ví dụ: *Mô hình giọng đọc Kokoro-82M*) | **Yes** | Model Name | Tên mô hình AI TTS |
| **Faster-Whisper** | `Faster-Whisper` (ví dụ: *Trích xuất mốc thời gian bằng Faster-Whisper*) | **Yes** | Engine / Model | Bộ nhận diện giọng nói STT |
| **Veo / Flow** | `Veo / Flow` | **Yes** | Model / Provider | Mô hình sinh video AI của Google |
| **SHA-256** | `SHA-256` (ví dụ: *Mã băm SHA-256 xác thực nội dung*) | **Yes** | Algorithm | Thuật toán băm mật mã |
| **JSON / CSV** | `JSON / CSV` | **Yes** | File Format | Định dạng dữ liệu |
| **SRT / VTT** | `SRT / VTT` | **Yes** | Subtitle Format | Định dạng tệp phụ đề |
| **WebP / PNG / JPEG** | `WebP / PNG / JPEG` | **Yes** | Image Format | Định dạng tệp hình ảnh |
| **MP4 / MOV** | `MP4 / MOV` | **Yes** | Video Container | Định dạng tệp video |
| **H.264 / H.265 / AV1** | `H.264 / H.265 / AV1` | **Yes** | Video Codec | Bộ chuẩn nén video |
| **AAC / PCM / MP3** | `AAC / PCM / MP3` | **Yes** | Audio Codec | Bộ chuẩn nén âm thanh |
| **API / HTTP / REST** | `API / HTTP / REST` | **Yes** | Protocol | Giao thức truyền thông |
| **WCAG 2.2 AA** | `WCAG 2.2 AA` (ví dụ: *Chuẩn tiếp cận WCAG 2.2 AA*) | **Yes** | Standard | Tiêu chuẩn trợ năng quốc tế |
| **Playwright** | `Playwright` | **Yes** | Test Framework | Thư viện kiểm thử trình duyệt tự động |
| **axe-core** | `axe-core` | **Yes** | A11y Engine | Engine kiểm tra tiếp cận tự động |
| **SQLite / WAL** | `SQLite / WAL` | **Yes** | Database | Cơ sở dữ liệu nhúng & chế độ Write-Ahead-Logging |
| **Negative Prompt** | `Negative Prompt` | **Yes** | AI Prompting | Thuật ngữ tạo ảnh/video AI chuẩn |
| **fps (Frames per second)**| `khung hình/giây (fps)` | **Yes** (abbr) | Video Spec | Tốc độ khung hình (24fps, 30fps) |

---

### 8. Thông Báo Lỗi & Hướng Dẫn Hành Động (Error Messages & Actionable Alerts)

| Internal Error Code | Raw Code (Debug only) | User-Facing Vietnamese Message | Actionable Guidance / Fix |
| :--- | :--- | :--- | :--- |
| `MISSING_ASSET` | `MISSING_ASSET` | Cảnh quay {shot_id} chưa có tài nguyên hình ảnh hoặc video. | Vui lòng tải lên tài nguyên hoặc tạo ảnh mới cho cảnh quay này. |
| `INVALID_TIMESTAMP` | `INVALID_TIMESTAMP` | Mốc thời gian không hợp lệ: thời điểm kết thúc phải lớn hơn thời điểm bắt đầu. | Vui lòng kiểm tra lại mốc thời gian của đoạn âm thanh hoặc cảnh quay. |
| `DEPENDENCY_CYCLE` | `DEPENDENCY_CYCLE` | Không thể cập nhật quan hệ phụ thuộc vì phát hiện vòng lặp dữ liệu. | Hệ thống đã khôi phục trạng thái an toàn trước đó. |
| `RESOURCE_BUSY` | `RESOURCE_BUSY` | Tài nguyên GPU đang được sử dụng bởi tác vụ khác. | Tác vụ của bạn đã được đưa vào hàng đợi và sẽ tự động chạy khi GPU sẵn sàng. |
| `VRAM_EXCEEDED` | `VRAM_EXCEEDED` | Bộ nhớ VRAM không đủ để kích hoạt song song tác vụ này. | Hệ thống đã tự động chuyển sang chế độ xếp hàng tuần tự để bảo vệ an toàn. |
| `AUDIO_STREAM_MISSING` | `AUDIO_STREAM_MISSING` | Video xuất ra không đạt chuẩn: thiếu luồng âm thanh master. | Vui lòng kiểm tra lại giai đoạn Voice và kết xuất lại video. |
| `RENDER_FAILED` | `RENDER_FAILED` | Quá trình kết xuất video bằng FFmpeg thất bại. | Vui lòng kiểm tra chi tiết lỗi kỹ thuật bên dưới và thử lại. |
| `LOCK_CONFLICT` | `LOCK_CONFLICT` | Không thể ghi đè vì cảnh quay này đang ở trạng thái khóa. | Hãy mở khóa cảnh quay nếu bạn thực sự muốn tạo lại nội dung này. |
| `UNSAVED_CHANGES` | `UNSAVED_CHANGES` | Bạn có thay đổi chưa được lưu trên kịch bản. | Hãy bấm "Lưu" trước khi chuyển sang khu làm việc khác. |
| `PREFLIGHT_BLOCKED` | `PREFLIGHT_BLOCKED` | Chưa thể xuất video: còn 3 mục kiểm tra chưa đạt yêu cầu. | Bấm vào từng mục cảnh báo màu đỏ bên dưới để hoàn tất nội dung còn thiếu. |

---

### 9. Quy Chuẩn Thuộc Tính Trợ Năng (Accessible-Name Implementation Examples)

| Phác thảo phần tử UI | Cách Làm Chuẩn Khuyến Nghị | Cách Làm Dự Phòng (ARIA) | Vi Phạm (Bị Cấm) |
| :--- | :--- | :--- | :--- |
| Nút có nhãn rõ ràng | `<button type="button">Lưu kịch bản</button>` | *(Không cần aria-label)* | `<button aria-label="Lưu kịch bản">Lưu kịch bản</button>` (thừa thãi)<br>`<button aria-label="Save">Lưu</button>` (sai tiếng) |
| Ô nhập có label | `<label for="speed">Tốc độ đọc</label><input id="speed">` | *(Tận dụng native label)* | `<input placeholder="Speed" aria-label="Speed">` |
| Nút Icon-only Khóa | `<button type="button" aria-label="Khóa cảnh quay 12"><i class="icon-lock"></i></button>` | `aria-label="Khóa cảnh quay 12"` | `<button aria-label="Lock shot 12"><i class="icon-lock"></i></button>` |
| Nút Icon-only Mở khóa | `<button type="button" aria-label="Mở khóa cảnh quay 12"><i class="icon-unlock"></i></button>` | `aria-label="Mở khóa cảnh quay 12"` | `<button aria-label="Unlock shot 12"><i class="icon-unlock"></i></button>` |
| Nút Nghe thử âm thanh | `<button type="button" aria-label="Phát đoạn âm thanh 3"><i class="icon-play"></i></button>` | `aria-label="Phát đoạn âm thanh 3"` | `<button aria-label="Play chunk 3"><i class="icon-play"></i></button>` |
| Badge trạng thái Outdated | `<span class="badge" aria-label="Trạng thái: Cần cập nhật">Cần cập nhật</span>` | Dùng visible text | `<span class="badge" aria-label="OUTDATED">OUTDATED</span>` |
| Ô tìm kiếm cảnh | `<input type="search" placeholder="Tìm cảnh hoặc cảnh quay..." aria-label="Tìm kiếm cảnh quay">` | `aria-label` tiếng Việt | `<input type="search" placeholder="Search..." aria-label="Search">` |

---

### 10. Mẫu Cấu Trúc Từ Điển Mã Nguồn Giao Diện (Implementation Pattern)

```javascript
// studio/static/js/locale.js (Khuyến nghị áp dụng từ Subphase 3A)
export const UI_TEXT = {
  workbenches: {
    overview: "Tổng quan",
    story: "Kịch bản",
    voice: "Giọng đọc",
    visual: "Hình ảnh & Cảnh",
    export: "Xuất video",
  },
  status: {
    DRAFT: "Bản nháp",
    NEEDS_REVIEW: "Cần kiểm tra",
    READY: "Sẵn sàng",
    OUTDATED: "Cần cập nhật",
    BLOCKED: "Bị chặn",
    QUEUED: "Đang chờ",
    RENDERING: "Đang kết xuất",
    COMPLETED: "Hoàn tất",
    FAILED: "Thất bại",
    CANCELLED: "Đã hủy",
  },
  lockState(isLocked) {
    return isLocked ? "Đã khóa" : "Mở khóa";
  },
  actions: {
    save: "Lưu",
    cancel: "Hủy",
    delete: "Xóa",
    restore: "Khôi phục",
    retry: "Thử lại",
    generate: "Tạo",
    regenerate: "Tạo lại",
    lock: "Khóa",
    unlock: "Mở khóa",
    download: "Tải xuống",
    upload: "Tải lên",
    edit: "Chỉnh sửa",
    close: "Đóng",
    search: "Tìm kiếm",
    filter: "Lọc",
  },
  formatStatus(statusEnum) {
    return this.status[statusEnum] || statusEnum;
  }
};
```
