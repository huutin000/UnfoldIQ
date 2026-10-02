# UNFOLDIQ Roadmap Realignment (POST-v1C)

> Nguồn thật duy nhất cho thứ tự các mốc sau POST-v1B.
> Không vẽ lại lịch sử: các báo cáo PASS trước đây giữ nguyên giá trị.

## Thứ tự sau POST-v1B

```text
CURRENT
POST-v1B — complete live generation automation
│
├── generation settings
├── user approval
├── Generate
├── result detection
├── download
├── import
└── PASS
        ↓
QUALITY 01 — Voice + Caption (ƯU TIÊN NGAY SAU POST-v1B)
        ↓
POST-V2 — 2–3 min Publishable Video Validation
        ├── Thumbnail
        ├── Metadata
        ├── Music Rights
        └── Real manual upload validation
        ↓
Render Performance Optimization
        ↓
Creative Quality Workstream
        ↓
8–12+ min Full Production Validation
```

Essential extension UX (POST-v1C Task B) được làm NGAY trong task này.
Mọi đợt đánh bóng hình ảnh lớn hơn (optional) KHÔNG được chặn QUALITY 01.

## QUALITY 01 — Voice + Caption (vì sao lên trước)

Pilot đã lộ:

```text
narration slightly slow
narration sounds like written text being read
subtitle flicker/linger near end
```

Các lỗi này ảnh hưởng mọi video sau này → QUALITY 01 làm ngay sau POST-v1B.
Không render lại pilot đã duyệt chỉ để sửa lỗi này; mục tiêu là hành vi
sản xuất trong tương lai (`QUALITY_01_VOICE_CAPTION_GUARDRAILS.md`).

## Stage mới — THUMBNAIL

```text
THUMBNAIL PLAN → THUMBNAIL GENERATION / SELECTION → THUMBNAIL QA
```

YouTube long-form: 16:9, JPG/PNG chất lượng cao, đọc được ở cỡ nhỏ,
đúng nội dung, an toàn chính sách, không clickbait gây hiểu lầm, nhất quán
với title / hook / content mode / brand / mascot.
Contract: `schemas/thumbnail-package.schema.json`.
Artifacts: `publish/thumbnail.png`, `publish/thumbnail-metadata.json`,
`publish/thumbnail-qa.json`.

## Stage mới — PUBLISH METADATA

Chuẩn bị gói publish (chưa tự động publish):

```text
publish/
├── title.txt
├── description.txt
├── metadata.json
├── thumbnail.png
├── music-attribution.txt
└── UPLOAD_CHECKLIST.md
```

Gồm: title candidates → selected title, description, attribution text,
AI disclosure recommendation, chapters, hashtags/tags (khi hữu ích),
thumbnail, upload checklist.

## Stage mới — MUSIC SOURCE / LICENSE RESOLUTION

Gate `MUSIC_SOURCE_RESOLUTION` trước khi video đạt publish-ready.
Contract: `schemas/music-source.schema.json` — statuses
`APPROVED | REVIEW_REQUIRED | BLOCKED | UNKNOWN`.
`UNKNOWN` chặn publish-ready. Nguồn ưu tiên cho YouTube: YouTube Audio
Library, nhạc gốc, thư viện bên thứ ba có giấy phép hợp lệ. Nếu cần
attribution, tự động đưa vào description/publish package.

## POST-V2 — Short Publishable Video Validation (2–3 phút)

Một video giáo dục thật, hoàn chỉnh, publishable (2–3 phút) bằng pipeline
đã cải thiện: topic + research + script thật, narration + caption đã sửa,
mascot/visual continuity, nhạc có quyền đã duyệt, thumbnail, title,
description, checklist quyền/provenance, quyết định AI disclosure, MP4 cuối.

Chính sách: hệ thống chuẩn bị gói publish → user phê duyệt rõ ràng →
user tự upload / ủy quyền thủ công → kiểm tra kết quả platform.
Visibility do user chọn rõ ràng: PUBLIC hoặc UNLISTED. Không tự publish ngầm.

Điều kiện PASS (12 điều): video 2–3 phút render thật; Voice QA, Caption QA,
Technical QA, Visual QA pass; music APPROVED; thumbnail + title/description
+ attribution sẵn; checklist policy/upload xong; user upload/phê duyệt thật;
kết quả upload được review.

## Sau POST-V2

Render Performance Optimization (Render Impact Analyzer, Dirty Scene
Detection, Partial QA Render, Transition Buffer, Concurrency Benchmark,
Bundle/Browser Cache, Media Metadata Cache, một full render cuối) →
Creative Quality Workstream (Beat Map, Visual Story Grammar, Motion
Primitives, Mascot Placement, Diagram Interaction, Visual Rhythm, Sound
Design, Transition Grammar, Style Bake-off, hook/payoff, educational
clarity) → Full 8–12+ min Production Validation.
