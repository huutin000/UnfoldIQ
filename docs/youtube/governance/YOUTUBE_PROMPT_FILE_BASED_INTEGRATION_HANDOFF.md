# HANDOFF — PHƯƠNG ÁN TÍCH HỢP 9 YOUTUBE PROMPT VÀO WEBSITE

## 1. Mục tiêu

Tôi đang có:

- 9 prompt YouTube production-ready
- 1 file `youtube-policy.md`

Tôi muốn tích hợp chúng vào website để AI có thể sử dụng tự động khi người dùng bấm các chức năng tương ứng.

Phương án đang muốn thảo luận và ưu tiên triển khai:

> **Lưu prompt thành các file `.md` trong source code, backend đọc đúng prompt khi có task, ghép với project context + user input + policy cần thiết, sau đó gửi cho AI.**

Không muốn:

- copy/paste prompt thủ công vào chat mỗi lần sử dụng;
- hard-code toàn bộ prompt dài trực tiếp trong React component, page, hook hoặc UI;
- xây Agent phức tạp ngay từ đầu.

---

# 2. Kiến trúc đề xuất

```text
Website UI
   ↓
Backend / API
   ↓
Prompt Loader
   ↓
Prompt Registry
   ↓
Project Context + User Input
   ↓
Relevant YouTube Policy
   ↓
LLM API
   ↓
Validate Output
   ↓
Database / Project State
   ↓
Website UI
```

---

# 3. Cấu trúc thư mục đề xuất

```text
/prompts
│
├── shared
│   ├── youtube-policy.md
│   ├── evidence-rules.md
│   └── output-rules.md
│
└── youtube
    ├── 01-seo.md
    ├── 02-script.md
    ├── 03-competitor.md
    ├── 04-idea-validation.md
    ├── 05-channel-strategy.md
    ├── 06-title-thumbnail.md
    ├── 07-strategy-review.md
    ├── 08-content-qa.md
    └── 09-v2-optimizer.md
```

`youtube-policy.md` là shared rule.

Nó KHÔNG phải Prompt #10.

---

# 4. Cách hoạt động

Ví dụ người dùng bấm:

```text
Generate Title & Thumbnail
```

Backend sẽ:

```text
1. Xác định task = title-thumbnail
2. Load /prompts/youtube/06-title-thumbnail.md
3. Load project context
4. Load user input
5. Load các phần YouTube Policy có liên quan
6. Ghép thành final instruction
7. Gửi cho LLM
8. Validate output
9. Lưu kết quả
10. Trả kết quả về website
```

Flow:

```text
User
 ↓
Generate Title
 ↓
Backend
 ↓
06-title-thumbnail.md
 +
Project Context
 +
User Input
 +
Relevant Policy
 ↓
LLM
 ↓
Structured Output
 ↓
Website
```

---

# 5. AI không tự đọc file trong source

Điểm cần thống nhất:

AI KHÔNG tự vào folder `/prompts` để đọc file.

Backend phải đọc file trước.

Ví dụ:

```ts
const prompt = loadPrompt("youtube/06-title-thumbnail");
```

sau đó backend gửi nội dung prompt vào request AI.

Ví dụ conceptual:

```ts
const finalPrompt = `
${prompt}

PROJECT CONTEXT:
${projectContext}

USER INPUT:
${userInput}

POLICY:
${relevantPolicy}
`;
```

Sau đó:

```ts
const result = await callLLM(finalPrompt);
```

---

# 6. Không hard-code prompt dài trong frontend

Không nên:

```ts
const prompt = `
Bạn là YouTube Strategist...

... hàng trăm dòng instruction ...
`;
```

đặt trong:

```text
/components
/pages
/app
/hooks
```

Lý do:

- khó update;
- khó version;
- khó review;
- khó test;
- dễ duplicate;
- khó biết output đang dùng prompt version nào;
- sửa policy phải sửa nhiều nơi.

Frontend chỉ nên:

- thu input;
- gọi API;
- hiển thị output.

Prompt logic nên nằm ở backend/service layer.

---

# 7. PromptLoader

Nên có một service riêng.

Ví dụ:

```text
PromptLoader
```

Trách nhiệm:

```text
loadPrompt(promptId)
loadSharedRule(ruleId)
resolvePromptVersion(promptId)
```

Ví dụ:

```ts
const prompt = await promptLoader.load("youtube.title-thumbnail");
```

PromptLoader chịu trách nhiệm map:

```text
youtube.title-thumbnail
→ /prompts/youtube/06-title-thumbnail.md
```

---

# 8. Prompt Registry

Nên có registry để quản lý task → prompt.

Ví dụ conceptual:

```ts
{
  "youtube.seo": {
    "file": "youtube/01-seo.md",
    "version": "1.0.0"
  },

  "youtube.script": {
    "file": "youtube/02-script.md",
    "version": "1.0.0"
  },

  "youtube.titleThumbnail": {
    "file": "youtube/06-title-thumbnail.md",
    "version": "1.0.0"
  }
}
```

Mục tiêu:

- không hard-code path khắp project;
- dễ đổi prompt;
- dễ version;
- dễ rollback.

---

# 9. Version prompt

Mỗi prompt nên có metadata.

Ví dụ đầu file:

```yaml
---
id: youtube-title-thumbnail
version: 1.0.0
---
```

Khi sửa prompt:

```text
1.0.0
↓
1.1.0
↓
2.0.0
```

Nên log prompt version đã dùng cho mỗi AI generation.

Ví dụ:

```json
{
  "promptId": "youtube-title-thumbnail",
  "promptVersion": "1.1.0"
}
```

---

# 10. YouTube Policy

`youtube-policy.md` là shared rule.

Không phải task nào cũng cần gửi toàn bộ policy.

Ví dụ:

## SEO / Title

Chỉ cần:

```text
Metadata Integrity
Advertiser Suitability
```

## Script

Có thể cần:

```text
Community Guidelines
Advertiser Suitability
AI Disclosure
Copyright
```

## Final QA

Có thể cần gần như toàn bộ:

```text
Originality
Reused Content
Copyright
AI Disclosure
Likeness
Community Guidelines
Advertiser Suitability
Metadata Integrity
```

Do đó nên thảo luận cách implement:

### Option A

Load toàn bộ `youtube-policy.md`.

### Option B

Tách policy thành section rồi chỉ inject section cần thiết.

Hiện tại ưu tiên Option B nếu implementation không quá phức tạp.

---

# 11. Input

Website không gửi prompt từ frontend.

Website chỉ gửi dữ liệu.

Ví dụ:

```json
{
  "projectId": "abc123",
  "task": "youtube.titleThumbnail",
  "topic": "How Did Ancient Humans Protect Babies From Predators?",
  "targetAudience": "US, 25-44",
  "language": "en",
  "videoDuration": 600
}
```

Backend tự biết:

```text
task = youtube.titleThumbnail
↓
Prompt Registry
↓
06-title-thumbnail.md
```

---

# 12. Output

Prompt nên yêu cầu structured output.

Ví dụ:

```json
{
  "titles": [],
  "thumbnailConcepts": [],
  "recommendation": {},
  "risks": [],
  "policyReview": {}
}
```

Frontend render từ output này.

Không nên phụ thuộc vào text tự do nếu module cần automation.

---

# 13. Validate Output

Sau khi AI trả kết quả:

```text
LLM
 ↓
Output Validator
 ↓
PASS
```

hoặc:

```text
LLM
 ↓
Output Validator
 ↓
FAIL
 ↓
Retry / Repair
```

Validator nên kiểm tra:

- đúng schema;
- thiếu field hay không;
- JSON parse được hay không;
- enum hợp lệ;
- output quá ngắn;
- output bị hallucinate format.

---

# 14. Luồng đơn giản ban đầu

Phase đầu KHÔNG cần Agent.

Chỉ cần:

```text
Button
 ↓
API
 ↓
Prompt Registry
 ↓
PromptLoader
 ↓
LLM
 ↓
Validator
 ↓
Result
```

Ví dụ:

```text
Generate Scene Plan
 ↓
scene-plan.md
 ↓
LLM
 ↓
Scene Plan JSON
 ↓
Website
```

---

# 15. Khi nào mới cần Agent?

Chỉ nâng lên Agent khi cần AI tự quyết định nhiều bước.

Ví dụ:

```text
Research Topic
 ↓
Search Web
 ↓
Read Competitors
 ↓
Choose Relevant Policy
 ↓
Generate Script
 ↓
Review Script
 ↓
Rewrite Script
```

Lúc đó Agent mới thực sự có giá trị.

Hiện tại chưa cần dùng Agent chỉ để:

```text
load prompt
+
call LLM
```

---

# 16. Quyết định hiện tại muốn ưu tiên

Phương án muốn triển khai trước:

```text
1. Hoàn chỉnh 9 Prompt
2. Hoàn chỉnh YouTube Policy
3. Test prompt thủ công
4. Tạo /prompts trong source
5. Lưu 9 prompt thành 9 file .md
6. Lưu policy thành shared file
7. Tạo Prompt Registry
8. Tạo PromptLoader
9. Backend gọi đúng prompt theo task
10. Ghép project context + user input + relevant policy
11. Gửi cho LLM
12. Validate output
13. Lưu result
14. Trả cho website
```

---

# 17. Không muốn triển khai theo các cách sau

Không muốn:

```text
User
 ↓
Copy prompt
 ↓
Paste vào ChatGPT
```

đây chỉ dùng để test trong giai đoạn development.

Không muốn:

```text
React Component
 ↓
hard-coded 1000 dòng prompt
```

Không muốn ngay lập tức:

```text
Website
 ↓
Complex autonomous Agent
```

nếu workflow hiện tại chỉ cần deterministic task → prompt → LLM.

---

# 18. Vấn đề cần thảo luận trong chat làm web

Hãy review source website hiện tại và trả lời:

1. Folder `/prompts` nên đặt ở đâu?
2. Prompt nên nằm backend hay package riêng?
3. Với framework hiện tại, đọc `.md` runtime như thế nào tốt nhất?
4. Có vấn đề gì khi deploy nếu dùng file `.md`?
5. Prompt Registry nên implement ở đâu?
6. Có cần cache nội dung prompt không?
7. Có cần hot reload prompt ở development không?
8. Có nên parse YAML frontmatter trong `.md` không?
9. Có nên lưu prompt version trong database?
10. Policy nên:
    - inject toàn bộ;
    - hay inject theo section?
11. Task → Policy mapping nên đặt ở đâu?
12. LLM call hiện tại nên refactor thế nào?
13. Output schema nên định nghĩa bằng gì?
14. Validator nên đặt ở service nào?
15. Retry/repair JSON nên làm thế nào?
16. Log AI generation cần lưu những field nào?
17. Có cần lưu:
    - promptId;
    - promptVersion;
    - model;
    - policyVersion;
    - input;
    - output;
    - timestamp;
    - validationResult?
18. Kiến trúc này có điểm nào overengineer so với source hiện tại?
19. Phase đầu có cần Agent hay không?
20. Hãy đề xuất implementation plan nhỏ nhất nhưng production-ready.

---

# 19. Yêu cầu cho cuộc thảo luận tiếp theo

Không code ngay trước khi review source hiện tại.

Trước tiên hãy:

```text
1. Đọc source / cấu trúc project
2. Xác định AI integration hiện tại
3. Xác định nơi phù hợp cho Prompt Registry
4. Xác định nơi phù hợp cho PromptLoader
5. Review phương án trong file này
6. Chỉ ra phần cần giữ / bỏ / đơn giản hóa
7. Chốt architecture
8. Sau đó mới tạo implementation plan
```

Mục tiêu cuối:

> Có một hệ thống prompt dễ quản lý, dễ version, dễ test và website tự động dùng đúng prompt khi gọi AI, nhưng chưa overengineer thành Agent architecture nếu chưa cần thiết.
