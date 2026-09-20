# Prompt: Cải thiện UnfoldIQ TTS Launcher

Bạn đang làm việc trực tiếp trên project Windows:

```text
D:\Project\UnfoldIQ
```

Project hiện có 4 file dùng để khởi động và dừng hệ thống UnfoldIQ TTS Studio:

```text
D:\Project\UnfoldIQ\
├── start-unfoldiq-tts.bat
├── stop-unfoldiq-tts.bat
└── scripts\
    ├── start-unfoldiq-tts.ps1
    └── stop-unfoldiq-tts.ps1
```

## Bối cảnh

Tôi đã rollback về **các file gốc ban đầu**, chưa áp dụng các bản chỉnh sửa trước đó.

Hãy coi **4 file hiện tại trong repository là source of truth**.

Không dựa vào bất kỳ phiên bản launcher cũ nào khác.

---

# 1. Mục tiêu

Hãy review và cải thiện trực tiếp 4 file hiện tại theo các mục tiêu sau:

1. Giữ nguyên logic nghiệp vụ/startup hiện tại nếu đang hoạt động đúng.
2. Cải thiện giao diện terminal để dễ đọc và chuyên nghiệp hơn.
3. Giao diện mặc định bằng **tiếng Việt**.
4. Chỉ giữ tiếng Anh đối với thuật ngữ kỹ thuật mà dịch sang tiếng Việt làm khó đọc hơn.
5. Thông báo rõ:
   - đang xử lý;
   - thành công;
   - cảnh báo;
   - thất bại.
6. Cải thiện error handling.
7. Cải thiện quản lý PID/process/port nếu logic hiện tại còn thiếu.
8. Không tạo dependency mới không cần thiết.
9. Phải tương thích tốt với Windows 10/11 và Windows PowerShell 5.1.

---

# 2. Bước đầu tiên bắt buộc

Trước khi sửa code, hãy đọc đầy đủ cả 4 file:

```text
start-unfoldiq-tts.bat
stop-unfoldiq-tts.bat
scripts/start-unfoldiq-tts.ps1
scripts/stop-unfoldiq-tts.ps1
```

Sau đó xác định chính xác:

- Studio được start bằng command nào.
- Kokoro-FastAPI được start bằng command nào.
- Python executable nằm ở đâu.
- Port nào đang sử dụng.
- Health endpoint nào đang được dùng.
- PID hiện được quản lý như thế nào.
- Browser được mở ở đâu.
- Runtime/log đang được lưu ở đâu.
- Stop script đang dừng process như thế nào.
- Có process/service phụ nào khác không.

Không tự đoán các thông tin này.

---

# 3. Nguyên tắc sửa

Ưu tiên:

```text
Đọc source hiện tại
        ↓
Hiểu logic thực tế
        ↓
Giữ nguyên phần đang đúng
        ↓
Cải thiện UI + reliability
        ↓
Verify
```

Không rewrite toàn bộ launcher chỉ để làm đẹp nếu không cần thiết.

Không thay đổi:

- port;
- Python path;
- startup command;
- health endpoint;
- folder runtime;
- architecture hiện tại;

trừ khi source cho thấy có lỗi thực sự cần sửa.

Nếu thay đổi, phải giải thích lý do.

---

# 4. Ngôn ngữ giao diện

Giao diện mặc định phải là **tiếng Việt**.

Ví dụ:

```text
Starting...
```

đổi thành:

```text
Đang khởi động...
```

```text
Stopping...
```

đổi thành:

```text
Đang dừng...
```

```text
Ready
```

đổi thành:

```text
Hệ thống đã sẵn sàng
```

```text
Failed
```

đổi thành:

```text
Thất bại
```

```text
Waiting...
```

đổi thành:

```text
Đang chờ...
```

Có thể giữ các thuật ngữ kỹ thuật:

```text
PID
port
API
health check
runtime
log
workspace
repository
Kokoro-FastAPI
Transcription Worker
Studio
Python
PowerShell
```

Không dịch máy móc nếu làm câu khó đọc hơn.

---

# 5. Giao diện terminal mong muốn

Tôi muốn launcher nhìn giống một CLI tool gọn và chuyên nghiệp.

Không cần quá màu mè.

Ví dụ:

```text
================================================================================
  UNFOLDIQ TTS STUDIO
  Khởi động môi trường TTS cục bộ
================================================================================

[1/4] Kiểm tra môi trường
------------------------------------------------------------
  [OK] Workspace hợp lệ
  [OK] Python đã sẵn sàng
  [OK] Port 8880 khả dụng
  [OK] Port 7860 khả dụng


[2/4] Khởi động Kokoro-FastAPI
------------------------------------------------------------
  [..] Đang khởi động...
  [..] PID: 12480
  [..] Đang chờ health check...

  [##########----------] 50%

  [OK] Kokoro-FastAPI đã sẵn sàng


[3/4] Khởi động UnfoldIQ Studio
------------------------------------------------------------
  [..] Đang khởi động...
  [OK] Studio đã sẵn sàng


[4/4] Kiểm tra cuối
------------------------------------------------------------
  [OK] Kokoro API
  [OK] Studio
  [OK] Health check


================================================================================
  HỆ THỐNG ĐÃ SẴN SÀNG
================================================================================

  Studio      : http://127.0.0.1:7860
  Kokoro API  : http://127.0.0.1:8880
  Studio PID  : 18044
  Kokoro PID  : 12480

================================================================================
```

Không bắt buộc giống chính xác ví dụ trên.

Ưu tiên:

- hierarchy rõ;
- ít chữ thừa;
- không spam terminal;
- dễ nhìn trạng thái;
- dễ đọc lỗi.

---

# 6. Status convention

Có thể dùng:

```text
[OK]       Thành công
[..]       Đang xử lý
[CANH BAO] Cảnh báo
[LOI]      Lỗi
```

Nếu Unicode hoạt động ổn định trên môi trường hiện tại thì có thể dùng icon.

Ví dụ:

```text
✓
!
×
```

Nhưng nếu có rủi ro encoding trên Windows PowerShell 5.1/CMD thì ưu tiên ASCII:

```text
[OK]
[LOI]
[CANH BAO]
[..]
```

**Tính ổn định quan trọng hơn icon đẹp.**

---

# 7. Màu sắc

Nếu dùng màu PowerShell native:

- Green: thành công.
- Red: lỗi.
- Yellow: cảnh báo.
- Cyan: đang xử lý / thông tin quan trọng.
- Gray/DarkGray: thông tin phụ.

Không thêm library UI.

Không phụ thuộc package ngoài.

---

# 8. Start flow mong muốn

Dựa trên logic thật của project, cải thiện start flow theo hướng:

```text
Kiểm tra environment
        ↓
Kiểm tra file cần thiết
        ↓
Kiểm tra Python
        ↓
Kiểm tra port
        ↓
Kiểm tra service có đang chạy không
        ↓
Khởi động Kokoro
        ↓
Health check Kokoro
        ↓
Khởi động Studio
        ↓
Health check Studio
        ↓
Final verification
        ↓
Mở browser
        ↓
READY
```

Điều chỉnh tên service theo source thật.

---

# 9. Không tạo duplicate process

Nếu Kokoro hoặc Studio đã chạy đúng instance của UnfoldIQ:

```text
Không start thêm process duplicate.
```

Thông báo ví dụ:

```text
[OK] Kokoro-FastAPI đang chạy sẵn (PID 12480)
```

Sau đó tiếp tục verify health.

---

# 10. Port conflict

Nếu port cần dùng đang bị một process khác chiếm:

**Không được tự kill process đó.**

Phải báo rõ:

```text
[LOI] Port 8880 đang được sử dụng bởi process khác.

Process : python.exe
PID     : 12345
Port    : 8880
```

Sau đó fail với exit code phù hợp.

---

# 11. Health check

Không được coi:

```powershell
Start-Process
```

thành công là service đã READY.

Nếu source hiện tại đã có health endpoint thì sử dụng endpoint đó.

Polling cho đến khi:

```text
healthy
```

hoặc timeout.

Trong khi chờ nên hiển thị dạng:

```text
[..] Đang chờ Kokoro-FastAPI... 12/90 giây
```

hoặc progress bar:

```text
[##########----------] 50%
```

Nếu process chết trong lúc đang chờ:

```text
Fail ngay.
```

Không chờ hết timeout.

---

# 12. Browser

Browser chỉ được mở sau khi các service cần thiết đã thật sự READY.

Không mở browser ngay sau `Start-Process`.

Nếu browser mở thất bại:

- không coi toàn bộ hệ thống fail nếu service vẫn healthy;
- chỉ báo warning phù hợp.

Ví dụ:

```text
[CANH BAO] Hệ thống đã sẵn sàng nhưng không thể tự mở trình duyệt.
```

---

# 13. Error handling

Khi lỗi phải ưu tiên hiển thị **nguyên nhân gốc**.

Ví dụ:

```text
================================================================================
  KHỞI ĐỘNG THẤT BẠI
================================================================================

  Bước   : Khởi động Kokoro-FastAPI
  Lỗi    : ModuleNotFoundError: ...
  PID    : 12480
  Log    : runtime\kokoro-error.log

================================================================================
```

Không chỉ in:

```text
Something went wrong.
```

Không để PowerShell stack trace dài chiếm toàn bộ màn hình nếu có thể trình bày lỗi ngắn gọn hơn.

Nếu cần debug sâu, dẫn tới log.

---

# 14. Log

Không spam log service lên màn hình trong trường hợp bình thường.

Giữ log riêng nếu architecture hiện tại đã hỗ trợ hoặc có thể thêm an toàn.

Ví dụ:

```text
runtime\
├── kokoro.log
├── kokoro-error.log
├── studio.log
└── studio-error.log
```

Nếu lỗi:

- hiển thị khoảng 20–40 dòng cuối có ích;
- hoặc chỉ hiển thị lỗi chính;
- sau đó show đường dẫn log.

Không cần dump hàng trăm dòng lên terminal.

---

# 15. Rollback khi startup thất bại

Nếu script vừa start một service trong **lần chạy hiện tại**, sau đó service tiếp theo fail:

có thể rollback service vừa tạo.

Nhưng:

**Chỉ được rollback process do chính lần chạy hiện tại tạo ra.**

Không kill:

- service đã chạy từ trước;
- process không thuộc UnfoldIQ;
- process chỉ tình cờ có cùng PID file cũ.

Rollback là best-effort.

Nếu rollback fail:

- vẫn phải giữ nguyên và hiển thị lỗi startup gốc;
- rollback error chỉ là thông tin bổ sung.

---

# 16. Stop flow mong muốn

Dựa trên source hiện tại, cải thiện stop flow theo hướng:

```text
Đọc PID/process state
        ↓
Verify process identity
        ↓
Dừng process
        ↓
Chờ process exit
        ↓
Verify port released
        ↓
Cleanup PID/runtime marker
        ↓
STOPPED
```

Giao diện ví dụ:

```text
================================================================================
  UNFOLDIQ TTS STUDIO
  Dừng môi trường TTS cục bộ
================================================================================

[1/3] Dừng Studio
------------------------------------------------------------
  [..] Đang dừng PID 18044...
  [OK] Studio đã dừng
  [OK] Port 7860 đã được giải phóng


[2/3] Dừng Kokoro-FastAPI
------------------------------------------------------------
  [..] Đang dừng PID 12480...
  [OK] Kokoro-FastAPI đã dừng
  [OK] Port 8880 đã được giải phóng


[3/3] Kiểm tra cuối
------------------------------------------------------------
  [OK] Không còn process UnfoldIQ
  [OK] Các port đã được giải phóng


================================================================================
  HỆ THỐNG ĐÃ DỪNG
================================================================================
```

---

# 17. Stop phải verify thật

Không làm kiểu:

```powershell
Stop-Process ...
exit 0
```

ngay lập tức.

Phải verify:

- process còn tồn tại hay không;
- port còn LISTEN hay không.

Nếu stop thất bại:

```text
exit code != 0
```

và phải báo rõ.

---

# 18. PID safety

PID có thể bị Windows tái sử dụng.

Nếu source đang dùng PID file, trước khi kill process cần xác minh identity bằng các thông tin phù hợp như:

```text
ProcessName
ExecutablePath
CommandLine
Port ownership
```

Không kill process chỉ vì:

```text
PID = PID trong file
```

Nếu PID file stale:

```text
[CANH BAO] PID cũ không còn tương ứng với process của UnfoldIQ.
```

Sau đó cleanup marker an toàn.

---

# 19. BAT files

`.bat` chỉ nên đóng vai trò launcher.

Ví dụ:

```text
start-unfoldiq-tts.bat
        ↓
scripts\start-unfoldiq-tts.ps1
```

BAT nên:

- dùng `%~dp0` để resolve đúng project path;
- chạy PowerShell với `-NoProfile`;
- truyền đúng exit code;
- giữ cửa sổ lại khi lỗi;
- khi thành công có thể tự đóng sau vài giây;
- có thể hỗ trợ `--stay` nếu hợp lý.

Không đưa business logic phức tạp vào BAT.

---

# 20. PowerShell compatibility

Target:

```text
Windows 10 / Windows 11
Windows PowerShell 5.1
```

Không được vô tình sử dụng syntax chỉ có PowerShell 7.

Kiểm tra đặc biệt các syntax/operator như:

```text
??
?:
&&
||
```

Không dùng nếu Windows PowerShell 5.1 không hỗ trợ.

Không thêm module mới chỉ để làm UI đẹp.

---

# 21. Encoding

Do giao diện có tiếng Việt:

PowerShell script phải được lưu với encoding phù hợp cho Windows PowerShell 5.1.

Ưu tiên:

```text
UTF-8 with BOM
CRLF
```

Nếu BAT chứa tiếng Việt làm phát sinh codepage issue:

- giữ BAT ở ASCII;
- để giao diện tiếng Việt trong PowerShell.

Ưu tiên ổn định.

---

# 22. Parse validation bắt buộc

Sau khi sửa `.ps1`, phải parse-check PowerShell bằng parser thật.

Ví dụ:

```powershell
$tokens = $null
$errors = $null

[System.Management.Automation.Language.Parser]::ParseFile(
    $path,
    [ref]$tokens,
    [ref]$errors
)

$errors
```

Yêu cầu cuối cùng:

```text
scripts/start-unfoldiq-tts.ps1 : 0 parser errors
scripts/stop-unfoldiq-tts.ps1  : 0 parser errors
```

Không dùng regex/balance braces để thay thế parser thật.

Nếu parser còn lỗi:

**Không kết thúc task.**

---

# 23. Static validation

Sau khi parser pass, kiểm tra:

- function có được khai báo hợp lệ;
- không duplicate function ngoài ý muốn;
- không gọi helper sai tên;
- không có variable typo rõ ràng;
- không unconditional `exit 0` khi thực tế fail;
- không kill process mà không verify;
- không làm mất exit code;
- không thay đổi startup command thực tế ngoài ý muốn;
- không thay đổi port ngoài ý muốn;
- không thay đổi Python environment ngoài ý muốn;
- không có cleanup nguy hiểm.

---

# 24. Runtime tests

Nếu môi trường local hiện tại cho phép chạy project, hãy test.

## Test 1 — Fresh Start

Điều kiện:

```text
Không có service đang chạy.
```

Expected:

```text
Start
→ Kokoro READY
→ Studio READY
→ Final health check PASS
→ Browser mở
```

---

## Test 2 — Start lần hai

Điều kiện:

```text
Service đang chạy.
```

Expected:

```text
Start lần nữa
→ detect instance cũ
→ không tạo duplicate process
→ health check PASS
```

---

## Test 3 — Stop

Expected:

```text
Dừng Studio
→ verify process exit
→ verify port release

Dừng Kokoro
→ verify process exit
→ verify port release
```

---

## Test 4 — Stop lần hai

Expected:

```text
Không crash.
```

Có thể báo:

```text
[OK] Các service đã dừng từ trước.
```

---

## Test 5 — Port conflict

Dùng process khác chiếm một port của hệ thống.

Expected:

```text
launcher báo conflict
→ không kill process lạ
→ exit code != 0
```

---

## Test 6 — Startup failure

Làm một service fail có kiểm soát nếu test được an toàn.

Expected:

```text
→ hiện lỗi gốc
→ cleanup/rollback đúng process vừa tạo
→ không kill process chạy từ trước
→ exit code != 0
```

---

# 25. Ưu tiên thiết kế

Ưu tiên theo thứ tự:

```text
1. Không phá logic đang hoạt động
2. Process safety
3. Error handling
4. Health verification
5. PowerShell 5.1 compatibility
6. UX terminal
7. Màu sắc / decoration
```

Không hy sinh reliability để lấy UI đẹp.

---

# 26. Những điều KHÔNG được làm

Không được:

1. Dựa vào launcher version cũ thay vì file hiện tại.
2. Tự đoán startup command.
3. Tự thay port.
4. Tự thay Python environment.
5. Tự thay health endpoint nếu chưa đọc source.
6. Kill process lạ khi port conflict.
7. Kill process chỉ dựa trên PID file.
8. Luôn trả `exit 0`.
9. Thêm dependency UI không cần thiết.
10. Rewrite toàn bộ architecture khi không cần.
11. Báo đã runtime test nếu thực tế chưa chạy.
12. Kết luận PowerShell hợp lệ chỉ vì braces cân bằng.
13. Kết thúc task khi parser vẫn còn error.

---

# 27. Quy trình thực hiện

Làm theo đúng thứ tự:

```text
1. Đọc đầy đủ 4 file hiện tại.
2. Tóm tắt logic hiện tại.
3. Liệt kê điểm cần cải thiện.
4. Sửa trực tiếp trên 4 file.
5. Parse-check 2 file PowerShell.
6. Static validation.
7. Runtime test nếu môi trường cho phép.
8. Review git diff.
9. Xác nhận không thay đổi startup logic ngoài ý muốn.
10. Trả report cuối.
```

Không cần hỏi lại tôi trước từng bước.

Nếu có thể xác định từ source thì tự kiểm tra.

---

# 28. Output cuối cùng

Sau khi hoàn thành, trả report ngắn theo format:

```markdown
## Files changed

- start-unfoldiq-tts.bat
- stop-unfoldiq-tts.bat
- scripts/start-unfoldiq-tts.ps1
- scripts/stop-unfoldiq-tts.ps1

## Logic giữ nguyên

- ...
- ...

## Improvements

- ...
- ...
- ...

## Validation

### PowerShell parser

- start-unfoldiq-tts.ps1: PASS — 0 errors
- stop-unfoldiq-tts.ps1: PASS — 0 errors

### Runtime

- Fresh start: PASS / FAIL / NOT TESTED
- Start twice: PASS / FAIL / NOT TESTED
- Stop: PASS / FAIL / NOT TESTED
- Stop twice: PASS / FAIL / NOT TESTED
- Port conflict: PASS / FAIL / NOT TESTED
- Startup failure: PASS / FAIL / NOT TESTED

## Notes

- ...
```

## Definition of Done

Task chỉ được coi là hoàn thành khi:

```text
[ ] Đã đọc đủ 4 file gốc hiện tại
[ ] Không tự thay đổi startup architecture
[ ] UI mặc định bằng tiếng Việt
[ ] Các thuật ngữ kỹ thuật cần thiết vẫn giữ tiếng Anh
[ ] Error message rõ ràng
[ ] Start không tạo duplicate process
[ ] Không kill process lạ
[ ] Stop verify process + port
[ ] Exit code đúng
[ ] start.ps1 parser errors = 0
[ ] stop.ps1 parser errors = 0
[ ] Windows PowerShell 5.1 compatible
[ ] Đã review diff cuối cùng
```
