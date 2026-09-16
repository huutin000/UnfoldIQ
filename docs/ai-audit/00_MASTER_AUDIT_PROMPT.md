# MASTER PROMPT — AUDIT & REDESIGN VIDEO PRODUCTION MANAGEMENT WEBSITE

> **Mục đích:** Dùng prompt này để yêu cầu AI/agent audit toàn bộ website hiện tại trước khi sửa code.
>
> **Nguyên tắc bắt buộc:** `Research / Inspect → Audit → Target Proposal → Architecture Decision → Implementation Plan → Code`.
>
> **Không được implement trong giai đoạn audit. Không được tự ý thêm feature chỉ vì đối thủ có. Không được giả định Phase 1–15 nếu không có bằng chứng.**

---

## 0. Vai trò của Agent

Bạn đóng vai đồng thời:

- Senior Product Architect
- Senior UX/Product Designer cho productivity/workbench software
- Senior Frontend/Backend Architect
- Performance Engineer
- Accessibility Reviewer
- Local-AI / Media Pipeline Architect

Nhiệm vụ là **audit và tái thiết kế website production management hiện có** để nó đơn giản hơn, nhanh hơn, dễ dùng hơn, đẹp hơn, ít lỗi hơn, ít thao tác thủ công hơn và tiết kiệm tài nguyên/chi phí hơn.

Không được ưu tiên "architecture đẹp" hơn giá trị sử dụng thực tế.

---

# A. PRODUCT CONTEXT & HARD CONSTRAINTS

## 1. Đối tượng sử dụng

Website hiện tại là **solo-first**.

- Trước mắt chỉ một người sử dụng trong ít nhất 6–12 tháng.
- Không xây collaboration, team role, permission, assignment, reviewer workflow hay comment system ở phiên bản hiện tại.
- Kiến trúc không được cố tình khóa khả năng mở rộng multi-user sau này, nhưng **không được trả chi phí complexity của multi-user ngay bây giờ**.

## 2. Mục tiêu ưu tiên

Theo thứ tự:

1. Giảm thao tác thủ công.
2. Giảm lỗi và rework trong production pipeline.
3. Giảm chi phí AI API / GPU work không cần thiết.
4. Tăng chất lượng script và production consistency.
5. Tăng khả năng quản lý project.
6. Tăng tốc độ sản xuất video như hệ quả của các mục trên.

## 3. Vai trò của website

Website là:

> **AI-assisted Production Management Tool**

Không phải full autonomous AI Production Studio.

Website phải quản lý:

- workflow;
- dependency;
- state;
- version/history;
- asset;
- validation;
- project progress;
- handoff sang công cụ ngoài.

AI chỉ hỗ trợ ở nơi thực sự có giá trị.

## 4. Khu vực ưu tiên audit đầu tiên

Các khu vực sau là **initial hypotheses**, không phải kết luận:

1. Visual production: `Scene / Shot / Prompt / Reference Asset`.
2. Voice pronunciation / Voice QA / partial audio regeneration.
3. Handoff giữa website ↔ Flow / Veo / external tools.

Agent phải xác minh lại bằng actual workflow và actual implementation.

## 5. Nguồn sự thật khi audit Phase 1–15

Ưu tiên theo thứ tự:

1. **Current source code** → source of truth cho actual behavior.
2. **Git history / commit history** → dùng để hiểu evolution/intent nếu đáng tin cậy.
3. **Markdown / evidence / phase artifacts còn tồn tại** → dùng để hiểu requirement/intent.

Không được:

- suy đoán Phase dựa trên tên file/folder;
- fabricate Phase 1–15;
- coi commit message là requirement nếu source/current behavior mâu thuẫn;
- yêu cầu phải có file Phase nếu chúng đã bị xóa.

Nếu Phase artifacts không còn, audit hệ thống hiện tại như một finished product.

## 6. Thứ tự audit

Bắt buộc:

`Product/UX → Workflow → Functional Audit → Performance Audit → Dependency/Data → Architecture → Code`

Không bắt đầu bằng refactor code.

## 7. Feature chưa dùng

Không REMOVE capability nghiệp vụ quan trọng chỉ vì chưa có production usage.

Các module sau là **merge hypotheses** cần xác minh:

- Voice QA
- Timestamp
- Visual Prompt
- Veo Prompt

Capability có thể cần nhưng không nhất thiết cần page/module riêng.

## 8. Mức độ restructure

Cho phép:

> **Aggressive Product/UX/Workflow redesign, evidence-based Architecture refactor.**

Có thể:

- merge;
- remove;
- rename;
- restructure;
- thay data model;
- thay menu;
- thay interaction pattern.

Nhưng:

- không full rewrite chỉ vì code/architecture mới đẹp hơn;
- architecture/code chỉ refactor lớn khi target workflow thực sự cần hoặc architecture hiện tại là blocker.

## 9. Menu/module

Cho phép thay đổi mạnh.

Mục tiêu navigation cấp cao bên trong Project:

- Overview
- Story
- Voice
- Visual
- Export

Không để từng capability nhỏ thành một top-level tab.

## 10. Database/API/Data Model

Cho phép thay đổi nếu nó giải quyết:

- workflow;
- dependency;
- reliability;
- performance;
- data integrity;
- maintainability thực tế.

Không refactor BE/database chỉ vì clean code.

## 11. Compatibility / Migration

Hiện tại chưa có production project cần bảo toàn vô thời hạn.

Vì vậy:

- không xây migration framework phức tạp chỉ để đề phòng;
- không bắt buộc backward compatibility vô thời hạn;
- nếu audit phát hiện có persistent data thực tế cần giữ, phải lập `Data Migration Map`;
- nếu migrate, phải bảo toàn dữ liệu quan trọng: script, audio, asset, timestamp, Scene/Shot và relationship.

## 12. Automation

Hệ thống được phép tự động:

- validation;
- hash;
- dependency check;
- status propagation;
- cache lookup;
- deterministic local processing;
- metadata calculation.

Không được tự động chạy expensive/generative AI downstream chỉ vì upstream thay đổi.

Mọi tác vụ sau phải **user-triggered**:

- LLM generation;
- TTS regeneration;
- image generation;
- video generation;
- paid AI call;
- expensive local GPU generation.

## 13. Dependency Engine

Dependency là bắt buộc và phải ở **artifact-level**, không chỉ module-level.

Ví dụ:

`ScriptParagraph → AudioSegment → TimestampSegment → Shot → imagePrompt/motionPrompt`

Yêu cầu:

- stable artifact IDs;
- version/hash-aware dependency;
- chỉ invalidate branch bị ảnh hưởng;
- sửa một paragraph không được làm toàn project OUTDATED;
- dependency propagation phải incremental.

## 14. Status Model

UI chỉ dùng 5 trạng thái chính:

- `DRAFT`
- `NEEDS_REVIEW`
- `READY`
- `OUTDATED`
- `BLOCKED`

Nhưng domain model không nên ép tất cả vào một enum duy nhất.

Khuyến nghị:

- `reviewStatus`: DRAFT / NEEDS_REVIEW / READY
- `outdated`: boolean hoặc derived metadata
- `blockers`: list

UI có thể tính effective status với ưu tiên:

`BLOCKED → OUTDATED → NEEDS_REVIEW → DRAFT → READY`

`Health`, warning count, blocker count... chỉ là computed metadata.

## 15. Production Dashboard

Màn hình mặc định khi mở project.

Phải hiển thị:

- progress;
- current stage/context;
- blockers;
- outdated dependencies;
- warnings;
- Next Best Action;
- `Continue Production`.

## 16. Information Architecture cấp cao

Bên trong project chỉ nên còn:

`Overview / Story / Voice / Visual / Export`

Giảm top-level tab nhưng không gộp toàn bộ logic thành một bước lớn.

## 17. Versioning & Locking

Version/history phải granular:

- Script → section/paragraph
- Audio → segment
- Scene Plan → Scene/Shot
- Visual Bible → character/location/entity
- Prompt → shot/artifact
- Asset → generated/imported version

Không tạo version cho mỗi:

- keystroke;
- autosave;
- filter;
- scroll;
- UI toggle.

Tạo checkpoint/version khi:

- Generate
- Regenerate
- Approve
- Replace asset
- Import external asset
- Restore version
- Manual Create Version

Lock nghĩa là **không được overwrite artifact**.

Lock **không có nghĩa artifact luôn current**. Artifact locked vẫn có thể trở thành OUTDATED khi upstream thay đổi.

## 18. Regeneration Granularity

Ưu tiên local:

- sentence;
- paragraph;
- segment;
- scene;
- shot.

Không regenerate toàn bộ project khi chỉ sửa một vùng nhỏ.

## 19. Voice QA

MERGE vào **Voice Workbench**.

Một context phải có:

- script segment;
- audio;
- waveform;
- transcript;
- pronunciation warning;
- timestamp;
- approve;
- regenerate;
- history.

## 20. Timestamp

Không cần top-level module.

Timestamp là dependent data của Audio/Transcript.

- local tool có thể generate;
- editor chỉ xuất hiện khi cần;
- timestamp không được trở thành một workflow độc lập nếu không có lý do.

## 21. Visual Bible

Local AI có thể **đề xuất**:

- character;
- location;
- style;
- entity.

Nhưng user phải:

- review;
- chỉnh;
- approve;
- lock.

AI không bắt buộc.

## 22. Scene/Shot Workbench

Scene/Shot Workbench là trung tâm Visual production.

Mỗi Shot phải có khả năng quản lý:

- script segment;
- timestamp;
- characters;
- locations;
- reference assets;
- image prompt;
- motion prompt;
- generated/imported image;
- generated/imported video;
- status;
- dependency;
- history.

## 23. Veo Prompt

Bỏ module `Veo Prompt` độc lập.

Chuyển thành:

`shot.motionPrompt`

Veo chỉ phục vụ motion/video generation; prompt phải gắn trực tiếp với Shot.

## 24. Production Export

Export một **portable production package**, không khóa vào CapCut.

Tối thiểu:

- Master audio
- SRT
- VTT
- Script
- Scene/Shot JSON
- Scene/Shot CSV
- Visual Bible
- Image prompts
- Motion prompts
- Asset manifest
- Image/video/reference assets
- `manifest.json`

Default export chỉ dùng **current accepted versions**.

Version history là optional export.

Target đầu tiên thuận tiện cho CapCut Desktop nhưng format phải dùng được về sau với Premiere/DaVinci hoặc tool khác.

## 25. Next Best Action

Bắt buộc.

Không dùng LLM.

Dùng rule/dependency engine, ví dụ:

- `3 pronunciation warnings → Review Voice`
- `Shot 21–28 thiếu reference → Continue Visual`
- `2 audio segments outdated → Review Voice`

## 26. Collaboration

Không xây ở phiên bản hiện tại:

- comments;
- assignment;
- team role;
- reviewer workflow;
- multi-user approval.

## 27. Undo / History / Restore

Ưu tiên cho dữ liệu có khả năng generate/overwrite:

- Script
- Audio
- Scene/Shot
- Visual Bible
- Prompt
- Asset

Không cần lưu version cho mọi CRUD nhỏ.

## 28. AI Provider Architecture

Core business logic không được khóa vào model/tool cụ thể.

Dùng capability/provider abstraction:

- `TTSProvider`
- `STTProvider`
- `LLMProvider`
- `ImageGenerationProvider`
- `VideoGenerationProvider`

Adapter ví dụ:

- Kokoro → TTSProvider
- Whisper → STTProvider
- local LLM → LLMProvider

Flow/Veo phần lớn là external handoff, không phải dependency bắt buộc.

## 29. Cost & Cache

Cost/resource usage là design constraint cấp cao.

Ưu tiên:

1. Avoid unnecessary work
2. Reuse/cache
3. Incremental generation
4. Local/free
5. External free quota
6. Paid API optional

Cache key không được chỉ hash input text.

Phải xét ít nhất:

- input content;
- dependency versions/hashes;
- provider;
- model version;
- model settings;
- seed nếu có;
- workflow/prompt schema version.

Không reuse asset khi effective input đã thay đổi.

## 30. Benchmark / Reference Products

Research pattern từ:

- Runway → workflow orchestration
- ElevenLabs Studio → granular regeneration, lock, generation history
- Descript → transcript/media interaction
- LTX Studio → scene/shot/reference consistency
- ComfyUI → local graph execution, cache/incremental execution

Không copy UI/feature trực tiếp.

## 31. Benchmark Rule

Chỉ học **problem-solving pattern**.

Không thêm feature chỉ vì đối thủ có.

Mọi feature mới phải trả lời:

- giải quyết vấn đề gì?
- có cần không?
- có cách đơn giản hơn không?
- có thể contextual/automatic không?
- cost/complexity tăng bao nhiêu?

## 32. Feature Value Rule

Mỗi feature phải đóng góp ít nhất một trong:

- quality;
- speed;
- consistency;
- reliability;
- cost reduction;

hoặc là infrastructure bắt buộc.

Không đạt → `SIMPLIFY`, `MERGE` hoặc `REMOVE`.

## 33. Audit Deliverables

Audit bắt buộc phải có:

1. Current Workflow
2. Current Information Architecture
3. Feature Inventory
4. `KEEP / IMPROVE / MERGE / REMOVE`
5. Target Workflow
6. Target Information Architecture
7. Target Domain/Data Model
8. Dependency Map
9. AI/Cost Map
10. Performance Risk Map
11. UX Friction Map
12. Gap Analysis
13. Prioritized Backlog
14. Data Migration Map nếu cần
15. Migration Plan nếu cần
16. Non-Goals
17. Do Not Build
18. Architecture Decision Records / key decisions
19. Implementation Plan — chỉ sau audit/target proposal
20. Acceptance/Quality Gates

## 34. Không code ngay

Quy trình bắt buộc:

`Research/Inspect → Audit → Target Proposal → Architecture Decision → Implementation Plan → Code`

Ở audit phase:

- không sửa code;
- không tạo migration;
- không đổi schema;
- không tự implement feature.

## 35. Refactor Scope

Cho phép:

- large module refactor;
- workflow redesign;
- data model redesign;

nếu chứng minh được lợi ích về:

- UX;
- maintainability;
- reliability;
- performance;
- cost.

Không full rewrite trừ khi có bằng chứng kiến trúc hiện tại thực sự là blocker không cứu được.

## 36. Definition of Done cấp sản phẩm

Website hoàn thành khi từ `Topic hoặc Script` có thể đi xuyên suốt:

`Story → Voice → Visual → Export`

và:

1. Không cần Excel/Markdown làm công cụ quản lý production trung gian.
2. Gần như không phải copy dữ liệu nội bộ giữa các bước.
3. Hệ thống biết dependency, outdated state, version và Next Best Action.
4. Chỉ regenerate phần bị ảnh hưởng.
5. Giữ history/output cũ.
6. Không có paid AI API key vẫn dùng được toàn core workflow.
7. Edit một Script Paragraph không làm toàn project OUTDATED.
8. Input không đổi thì không regenerate artifact đã có.
9. Restart app/máy không làm mất project state/history.
10. Locked artifact không bị overwrite tự động.
11. Upstream changed → impacted downstream được xác định chính xác.
12. External Flow/Veo chỉ cần export prompt/reference và import result trở lại.
13. Production package có đủ asset + metadata để tiếp tục dựng ngoài website.
14. User luôn biết:
    - Tôi đang ở đâu?
    - Có vấn đề gì?
    - Bước tiếp theo là gì?

---

# B. FUNCTIONAL AUDIT

Mỗi function phải được đánh giá theo:

| Field | Ý nghĩa |
|---|---|
| Capability | Năng lực thật sự cần |
| Current UI Surface | Nó đang nằm ở đâu |
| User Goal | User dùng để làm gì |
| Frequency | Tần suất dự kiến |
| Value | Giá trị |
| Cost | Complexity / resource / maintenance |
| Dependencies | Phụ thuộc |
| Can Automate? | Có thể deterministic automation không |
| Can Contextualize? | Có thể chuyển thành contextual action không |
| Decision | KEEP / IMPROVE / MERGE / REMOVE |

Phải phân biệt:

> `Capability cần thiết` ≠ `Page/module riêng cần thiết`

Phân nhóm:

### Core
- Project
- Script
- Audio
- Scene
- Shot
- Asset
- Export

### Supporting
- Timestamp
- Pronunciation QA
- Prompt generation
- Dependency status
- Version history
- Validation

### Automation
- Hash
- Outdated detection
- Cache lookup
- Timestamp generation
- Next Best Action
- Dependency propagation

### Optional
- Local LLM suggestions
- TTS provider
- STT provider
- External Flow/Veo helpers

---

# C. PERFORMANCE & HARDWARE REQUIREMENTS

## 37. Performance Audit

Performance là first-class requirement.

Profile trước khi optimize.

Audit:

- initial load;
- route navigation;
- bundle size;
- project loading;
- Scene/Shot rendering;
- asset gallery;
- audio waveform;
- transcript;
- autosave;
- dependency propagation;
- history;
- local AI;
- export;
- search/filter;
- state rerender behavior.

Không thêm memo/cache/lazy loading một cách máy móc.

## 38. Large Project Scalability

Website phải giữ trải nghiệm tốt với project lớn.

Test tối thiểu bằng synthetic/representative data như:

- 80+ Scenes
- 250–500+ Shots
- 250+ visual assets
- nhiều version/history
- 100+ audio segments
- 1000+ transcript/timestamp segments

Không được:

- fetch ALL rồi render ALL;
- load original high-res asset trong grid;
- render hàng trăm heavy editor component cùng lúc.

Dùng khi phù hợp:

- lazy loading;
- pagination;
- virtualization/windowing;
- collapsible scenes;
- thumbnail;
- proxy/preview;
- incremental fetch;
- incremental dependency calculation.

## 39. Functional Simplification

Audit phải tìm cơ hội chuyển feature thành:

- contextual action;
- inline editor;
- side panel;
- computed metadata;
- automation;
- submodule;

trước khi giữ nó thành page/module độc lập.

## 40. Performance Regression

Mọi refactor lớn phải:

1. tạo baseline trước;
2. đo lại sau;
3. không được làm UX/performance tệ đi đáng kể.

Regression workflow:

`Open Project → Story → Voice → Visual → Scene/Shot Editing → Export`

## 41. Hardware-Aware Performance Without Quality Loss

Trước khi quyết định concurrency/model/resource strategy, agent phải inspect hoặc benchmark máy thực tế:

- OS
- CPU model
- physical/logical cores
- total/available RAM
- GPU
- VRAM
- GPU acceleration/CUDA nếu có
- storage/free space/I/O
- browser/runtime
- Python/runtime
- FFmpeg
- local AI dependencies

Không assume hardware.

**Không được giảm chất lượng master/final output để lấy tốc độ.**

Không được tự giảm:

- original asset quality;
- final image/video resolution;
- master audio quality;
- production data accuracy;
- dependency correctness;
- export quality;
- user-visible functionality;
- project reliability.

Ưu tiên:

- lazy loading;
- virtualization;
- thumbnail;
- proxy/preview;
- caching;
- incremental compute;
- background jobs;
- bounded concurrency;
- worker/process;
- selective loading;
- hardware acceleration.

Nếu máy không xử lý realtime được:

> Queue / background / slower processing

được ưu tiên hơn:

> Silent quality downgrade

## 42. Local Resource Scheduler

Heavy local jobs phải qua shared scheduler/resource manager.

Theo dõi:

- CPU utilization;
- RAM pressure;
- VRAM;
- GPU utilization;
- disk I/O;
- running jobs;
- foreground interaction.

Job states tối thiểu:

- QUEUED
- RUNNING
- PAUSED
- COMPLETED
- FAILED
- CANCELLED

Ưu tiên tài nguyên:

1. UI responsiveness
2. Data safety/autosave
3. Playback/editing
4. Dependency/validation
5. User-requested generation
6. Background analysis
7. Cache/precompute

Không chạy mù quáng nhiều job GPU/RAM-heavy cùng lúc.

### Master vs Preview

Bắt buộc tách:

`WORKING/PREVIEW` và `MASTER/FINAL`

Preview được phép:

- thumbnail resolution thấp hơn;
- proxy video;
- waveform density thấp hơn;
- ít DOM node;
- ít concurrent job.

Master/final phải giữ nguyên chất lượng.

---

# D. UI / UX REQUIREMENTS

## 43. Usability First

Mỗi screen phải trả lời ngay:

- Tôi đang ở đâu?
- Tôi đang làm gì?
- Status hiện tại?
- Có gì sai/outdated?
- Tôi nên làm gì tiếp?
- Primary action là gì?

Không bắt user nhớ trạng thái workflow xuyên màn hình.

Tránh:

- unnecessary page;
- duplicated action;
- deeply nested navigation;
- excessive modal;
- hidden critical action;
- decorative UI không truyền tải thông tin;
- nhiều primary button cạnh tranh.

## 44. Visual Design System

Chuẩn hóa:

- typography;
- spacing;
- color;
- surface/elevation;
- border;
- radius;
- icon;
- button;
- input;
- table;
- card;
- panel;
- status;
- dialog;
- tooltip;
- notification;
- loading;
- empty state;
- error state.

Dùng design tokens, tránh arbitrary values.

## 45. UI Density

Hướng:

> **Compact / comfortable productivity density**

Không SaaS marketing dashboard nhiều khoảng trắng.

Không nhồi tất cả vào một màn hình.

Phải tối ưu cho production data density.

## 46. Progressive Disclosure

Hiển thị cái quan trọng trước.

Chi tiết nâng cao chỉ mở khi cần:

- Prompt
- Reference
- Motion
- History
- Dependency
- Metadata

Không tạo page mới chỉ để giấu complexity.

## 47. Workbench Pattern

Story / Voice / Visual phải là workbench, không phải CRUD admin.

Pattern chung:

`Navigator | Workspace | Inspector`

Ví dụ:

- Story → Sections | Editor | Inspector
- Voice → Segments | Audio/Transcript | QA
- Visual → Scenes/Shots | Visual Workspace | Reference/History

## 48. Navigation

Project navigation:

- Overview
- Story
- Voice
- Visual
- Export

Timestamp/Voice QA/Prompt/History/Validation không được thành top-level menu nếu không có lý do mạnh.

## 49. Primary Action

Mỗi context chỉ có 1 primary action nổi bật.

Secondary action giảm visual priority hoặc đưa vào overflow/context menu.

## 50. Contextual Actions

Action phải gần dữ liệu mà nó tác động.

Ví dụ Shot thiếu image:

- Copy Prompt
- Import Image
- Review Reference

ngay trong Shot context.

Không ép user chuyển nhiều page để làm một action nhỏ.

## 51. Keyboard-First Accelerator

Hỗ trợ shortcut cho thao tác lặp lại.

Ví dụ:

- Ctrl/Cmd + S → Save
- Ctrl/Cmd + K → Command Palette
- J/K hoặc Arrow → Prev/Next
- các shortcut khác nếu an toàn và discoverable

Shortcut là accelerator, không phải cách duy nhất.

## 52. Command Palette

Có thể tìm:

- command;
- Scene;
- Shot;
- warning;
- project entity;
- navigation destination.

Không cần LLM.

## 53. Status Visibility

Status phải có:

- label;
- icon;
- color.

Không chỉ dùng màu.

## 54. Actionable Error/Warning

Không dùng thông báo chung chung.

Thông báo phải nói:

- artifact nào;
- lỗi gì;
- thiếu gì;
- action tiếp theo.

## 55. Loading UX

Phân biệt:

- data loading → skeleton;
- background processing → progress + non-blocking;
- small action → inline saving state;
- completion → notification.

Không khóa full UI nếu không cần.

## 56. Modal Rule

Modal chỉ ưu tiên cho:

- delete;
- destructive overwrite;
- critical confirmation.

Không dùng modal cho:

- edit Shot;
- edit prompt;
- history;
- metadata;

nếu side panel/drawer/inline editor tốt hơn.

## 57. Desktop-First

Primary target:

- 1920×1080
- 2560×1440
- 1440×900
- 1366×768

Desktop productivity quan trọng hơn mobile parity.

## 58. Accessibility

Target tối thiểu: **WCAG 2.2 AA khi áp dụng được**.

Audit:

- keyboard;
- focus visibility;
- contrast;
- labels;
- semantics/ARIA;
- target size;
- reduced motion;
- drag fallback;
- non-hover access.

## 59. Motion

Animation chỉ dùng để truyền đạt:

- state;
- hierarchy;
- causality;
- feedback.

Không animation trang trí nặng.

## 60. Avoid AI-SaaS Visual Noise

Tránh lạm dụng:

- gradient;
- glassmorphism;
- glow;
- shadow;
- huge card;
- huge rounded corners;
- decorative illustration.

## 61. Visual Direction

Hướng thẩm mỹ:

- Professional
- Calm
- Modern
- Dense but breathable
- Tool-oriented
- Content-first
- Neutral
- Consistent
- Minimal visual noise

Không hướng:

- flashy;
- futuristic AI;
- cinematic dashboard nếu không phục vụ workflow.

## 62. Performance-Aware UI

UI đẹp không được đổi lấy:

- nhiều blurred surfaces;
- high-res asset load hàng loạt;
- excessive shadow;
- background animation;
- heavy DOM.

Ưu tiên:

- virtualization;
- thumbnail;
- simple surface;
- lazy preview;
- CSS-native interaction;
- minimal layout thrash.

---

# E. RESPONSIVE & ADAPTIVE REQUIREMENTS

## 63. Responsive & Adaptive Layout

Website là:

> **Desktop-first, responsive everywhere, capability-adaptive.**

Không chỉ shrink desktop layout.

Responsive phải bảo toàn:

- information;
- workflow state;
- primary action;
- validation;
- status;
- accessibility;
- data integrity.

## 64. Responsive Workbench

Adaptive pattern:

### Wide
`Navigator + Workspace + Inspector`

### Medium
`Navigator + Workspace`
Inspector → drawer/slide-over

### Small
Workspace chính
Navigator/Inspector → sheet/drawer

Không cố giữ 3 cột trên màn hình nhỏ.

## 65. Content-Driven Breakpoints

Không phụ thuộc cứng vào tên device.

Breakpoint được quyết định khi content/layout không còn hoạt động tốt.

Các mức sau chỉ là starting point:

- `>= ~1280px` → full workbench
- `~900–1279px` → 2-pane
- `~600–899px` → single/dual adaptive pane
- `< ~600px` → review/control-first mode

## 66. Component-Level Responsive

Từng component phải thích nghi:

- header;
- Shot card;
- toolbar;
- form;
- inspector;
- preview;
- action group.

Không để text/button overlap hoặc bị cắt.

## 67. Table Responsive

Table lớn phải có adaptive representation.

Có thể chuyển:

`wide table → compact list/card`

Không thu nhỏ font vô hạn để nhét đủ column.

## 68. Toolbar Responsive

Primary action luôn visible.

Secondary actions có thể chuyển vào overflow menu khi hẹp.

## 69. Typography Responsive

Không giảm font tới mức khó đọc.

Spacing/layout co trước khi typography mất usability.

## 70. Media Responsive

Preview phải responsive:

- `max-width: 100%`
- giữ aspect ratio
- `object-fit` phù hợp
- không thay đổi master/original asset

## 71. Asset Browser Responsive

Dùng grid dựa trên min card width/available space.

Không hard-code chỉ theo vài device model.

## 72. Touch Support

Control phải usable bằng touch khi phù hợp.

Không phụ thuộc hoàn toàn vào:

- hover;
- right click;
- mouse wheel.

## 73. Hover Fallback

Hover chỉ là accelerator.

Mọi action quan trọng phải có cách truy cập trên touch/keyboard.

## 74. Drag & Drop Fallback

Mọi functionality dựa vào drag phải có fallback khi phù hợp:

- Move up
- Move down
- Move to...
- single-pointer alternative

## 75. Mobile Scope

Mobile ưu tiên:

- Project overview
- Progress
- Status
- Next Best Action
- Review script
- Review Shot
- Approve/reject
- View asset
- Quick correction

Không cần ép tối ưu mobile cho:

- complex waveform editing;
- bulk Scene editing;
- detailed timeline;
- heavy asset management.

## 76. Responsive Quality Gate

Test tối thiểu:

- 2560×1440
- 1920×1080
- 1440×900
- 1366×768
- 1280×720
- 1024×768
- 768×1024
- 390×844
- 360×800
- width 320 CSS px tương đương reflow requirement khi áp dụng
- browser zoom / enlarged text

Không được xuất hiện:

- clipped content;
- overlapping control;
- hidden primary action;
- unreadable text;
- inaccessible navigation;
- accidental horizontal scrolling;
- broken modal/drawer;
- lost status;
- lost validation;
- data loss.

Narrow viewport có thể đổi presentation, **không được đổi business behavior hoặc production data một cách âm thầm**.

---

# F. CORE ARCHITECTURE TARGET

```text
Projects
└── Project
    ├── Overview
    ├── Story
    ├── Voice
    ├── Visual
    └── Export
```

```text
Core
├── Artifact Graph
├── Dependency Engine
├── Version / History
├── Locking
├── Validation
├── Cache / Hash
├── Asset Registry
├── Next Best Action Engine
├── Performance Manager
│   ├── Resource Monitor
│   ├── Job Scheduler
│   ├── Concurrency Controller
│   └── Background Workers
└── Media Optimization
    ├── Thumbnail
    ├── Proxy / Preview
    └── Original / Master
```

```text
Providers
├── TTS
│   └── Kokoro Adapter
├── STT
│   └── Whisper Adapter
├── LLM
│   └── Local LLM Adapter
├── Image
│   ├── External Handoff
│   └── Optional Local Provider
└── Video
    └── External Handoff
```

## Core pipeline

```text
TOPIC / SCRIPT
    ↓
STORY
    ↓
Script Artifact Graph
    ↓
VOICE
    ↓
Audio Segments
    ↓
Transcript / Timestamp
    ↓
VISUAL
    ↓
Scenes
    ↓
Shots
    ├── entities
    ├── references
    ├── imagePrompt
    ├── imageAsset
    ├── motionPrompt
    └── videoAsset
    ↓
EXPORT
    ↓
Portable Production Package
    ↓
CapCut / Premiere / DaVinci / other editor
```

---

# G. NON-GOALS / DO NOT BUILD

Không xây nếu audit không chứng minh có nhu cầu thật:

- collaboration;
- team roles;
- comments;
- assignment;
- multi-user reviewer workflow;
- social media scheduler;
- analytics suite;
- built-in full final video editor;
- autonomous AI pipeline;
- paid AI dependency;
- custom CapCut-only project format;
- feature chỉ để "trông giống competitor";
- migration framework phức tạp khi chưa có production data;
- generic admin CRUD page cho capability có thể contextualize.

---

# H. NON-NEGOTIABLE PRINCIPLES

1. **Paid AI must be an optional enhancement, never a dependency for the core workflow.**
2. **Generation is optional; production state management is mandatory.**
3. **Never regenerate an artifact when its effective inputs have not changed.**
4. **Optimize resource usage before reducing computational quality.**
5. **UI responsiveness takes priority over background processing speed.**
6. **Working proxies may be lightweight; master artifacts remain full quality.**
7. **When hardware is constrained, wait/queue/process slower — do not silently produce worse output.**
8. **Beautiful through clarity, not decoration.**
9. **One interaction pattern across the product.**
10. **Frequent actions stay close to the content they affect.**
11. **Reveal complexity progressively instead of creating more pages.**
12. **Never sacrifice responsiveness for visual effects.**
13. **Desktop-first does not mean desktop-only.**
14. **Adapt the interaction model, not merely dimensions.**
15. **Do not sacrifice desktop productivity to force complex production tools into mobile.**

---

# I. AUDIT METHOD

## Step 1 — Inspect

Không sửa code.

Thu thập:

- repo structure;
- current routes/pages;
- current modules;
- APIs;
- database/schema;
- state management;
- asset storage;
- local AI integration;
- background jobs;
- current navigation;
- current UI component system;
- current project schema;
- Git history;
- surviving docs/evidence;
- hardware/runtime baseline.

## Step 2 — Reconstruct Current Product

Tạo:

- Current Workflow
- Current IA
- Feature Inventory
- Current Data Flow
- Dependency Map
- Screen Map
- Critical user journey
- Performance hotspots
- UX friction map

Không suy đoán nếu không có evidence.

## Step 3 — Benchmark Patterns

So sánh problem-solving pattern với:

- Runway
- ElevenLabs Studio
- Descript
- LTX Studio
- ComfyUI
- professional NLE proxy workflows
- WCAG 2.2
- modern web performance practices

Không copy UI/feature.

## Step 4 — Functional Decision

Cho mọi feature/capability:

`KEEP / IMPROVE / MERGE / REMOVE`

Mỗi decision phải có:

- evidence;
- reason;
- benefit;
- cost/trade-off;
- impacted modules;
- risk.

## Step 5 — Target Product

Thiết kế:

- Target Workflow
- Target IA
- Target Workbench UX
- Target Data Model
- Artifact Graph
- Dependency Engine
- Version/Lock semantics
- Asset model
- Export package
- Provider abstraction
- Resource scheduler
- Responsive behavior

## Step 6 — Gap Analysis

So sánh Current vs Target.

Không biến mọi khác biệt thành task.

Chỉ tạo task có giá trị thực.

## Step 7 — Prioritization

Ưu tiên theo:

1. workflow simplification
2. correctness/data integrity
3. high-friction UX
4. performance bottleneck
5. cost/resource waste
6. architecture blocker
7. visual polish

## Step 8 — Stop Before Coding

Kết thúc audit bằng:

- target proposal;
- decisions;
- prioritized backlog;
- implementation phases.

**Không implement.**

---

# J. REQUIRED OUTPUT FORMAT

## 1. Executive Summary

Ngắn gọn:

- vấn đề lớn nhất;
- target direction;
- thay đổi lớn nhất;
- risk lớn nhất.

## 2. Current Workflow

Diagram + mô tả.

## 3. Feature Inventory

Bảng đầy đủ.

## 4. KEEP / IMPROVE / MERGE / REMOVE

| Capability | Current | Decision | Reason | Target |
|---|---|---|---|---|

## 5. UX Friction Map

| Workflow | Friction | Severity | Evidence | Target Fix |
|---|---|---|---|---|

## 6. Performance Risk Map

| Area | Current Risk | Measurement | Target |
|---|---|---|---|

## 7. Hardware & Runtime Baseline

Không đoán.

## 8. Target Workflow

Diagram.

## 9. Target Information Architecture

Navigation + workbench structure.

## 10. Target Data Model

Artifact/relationship/version/hash/dependency.

## 11. Dependency Map

Artifact-level.

## 12. AI / Cost Map

| Operation | Provider | Local/External | Cost | Cacheable | User-triggered |
|---|---|---|---|---|---|

## 13. Responsive Matrix

| Context | Wide | Medium | Tablet | Mobile |
|---|---|---|---|---|

## 14. Accessibility Findings

WCAG-oriented.

## 15. Non-Goals / Do Not Build

Explicit.

## 16. Gap Analysis

Current → Target.

## 17. Prioritized Backlog

P0 / P1 / P2 hoặc equivalent.

## 18. Data Migration Map

Chỉ nếu cần.

## 19. Architecture Decisions

Chỉ những decision cần chốt.

## 20. Implementation Plan

Chỉ proposal, chưa code.

---

# K. QUALITY GATES TRƯỚC KHI IMPLEMENT

Audit chỉ được coi là hoàn tất khi trả lời được:

### Product
- Workflow có ngắn hơn không?
- Có bước duplicate không?
- Có page/module không cần thiết không?

### Function
- Capability nào phải giữ?
- Capability nào có thể contextualize?
- Automation nào deterministic?

### UX
- User luôn biết vị trí/status/next action?
- Primary action rõ?
- Có excessive modal/navigation không?

### Performance
- Có baseline?
- Project lớn có strategy?
- Heavy task có background/scheduler?
- Có unnecessary rerender/load?

### Hardware
- Có detect/benchmark?
- Có bounded concurrency?
- Có giữ final quality?

### Data
- Dependency granular?
- Version/lock semantics rõ?
- Cache key đủ?
- Asset lineage/history rõ?

### Responsive
- Wide/medium/tablet/mobile behavior rõ?
- Không chỉ shrink desktop?
- Touch/keyboard fallback?

### Accessibility
- Keyboard/focus?
- Contrast?
- target size?
- reflow?
- drag fallback?

### Cost
- Core workflow có chạy không cần paid AI?
- Có tránh generate khi input không đổi?

### Scope
- Non-goal rõ?
- Không feature creep?
- Không rewrite không cần thiết?

---

# L. BENCHMARK / SOURCE NOTES

Chỉ dùng các nguồn này để học pattern, không coi chúng là spec bắt buộc của website:

- Runway Workflows documentation
- ElevenLabs Studio / Generation History / Lock / Partial Regeneration documentation
- Descript documentation
- LTX Studio product/workflow references
- ComfyUI official documentation
- W3C WCAG 2.2
- Next.js official lazy-loading/image docs nếu stack hiện tại là Next.js
- web.dev long-list virtualization/performance references
- Adobe Premiere proxy workflow
- OpenAI Whisper README cho hardware/model VRAM reference

Nếu source code dùng stack khác, benchmark performance theo stack thật, không ép Next.js-specific recommendation.

---

# FINAL INSTRUCTION

Hãy **audit trước, không code**.

Nếu một chức năng đang tồn tại nhưng không chứng minh được giá trị, đề xuất `SIMPLIFY`, `MERGE` hoặc `REMOVE`.

Nếu một feature cần thiết nhưng không cần màn hình riêng, giữ capability và chuyển thành contextual/submodule/automation.

Nếu máy không đủ tài nguyên để chạy realtime ở chất lượng mong muốn, ưu tiên queue/background/proxy thay vì giảm final quality.

Mọi đề xuất phải tối ưu đồng thời cho:

`Product / Workflow + Functionality + UI/UX + Performance + Hardware/Cost + Responsive/Accessibility`

và giữ nguyên nguyên tắc:

> **Paid AI là optional enhancement, không phải dependency của core workflow.**
