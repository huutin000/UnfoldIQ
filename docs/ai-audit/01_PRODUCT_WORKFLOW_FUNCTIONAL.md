# PROMPT 01 — PRODUCT, WORKFLOW & FUNCTIONAL AUDIT

> Dùng file này khi muốn agent tập trung vào Product/Workflow/Feature trước khi xem code sâu.
> Không implement trong bước này.

## Mục tiêu

Audit website production management theo hướng:

- solo-first;
- AI-assisted, không autonomous;
- local/free-first;
- ít thao tác;
- ít rework;
- ít paid API;
- artifact/dependency-aware;
- Scene/Shot-centric cho Visual;
- Voice Workbench tích hợp QA;
- portable export.

## Product Requirements 1–36

1. Solo-first 6–12 tháng; không collaboration/team role/comment/reviewer hiện tại.
2. Ưu tiên giảm manual work, rework/error, paid AI cost; sau đó quality/consistency/project management/throughput.
3. Website là AI-assisted Production Management Tool.
4. Ưu tiên audit Visual production, Voice pronunciation/QA, external tool handoff; đây chỉ là hypotheses.
5. Source of truth: current source → Git history → surviving docs/evidence. Không fabricate Phase 1–15.
6. Audit theo: Product/UX → Workflow → Functional → Performance → Dependency/Data → Architecture → Code.
7. Voice QA/Timestamp/Visual Prompt/Veo Prompt là merge hypotheses, không phải kết luận.
8. Aggressive Product/UX/Workflow redesign; architecture refactor phải có evidence.
9. Cho phép đổi menu/module; top-level project nav mục tiêu: Overview/Story/Voice/Visual/Export.
10. Cho phép đổi data/API/schema khi giải quyết vấn đề thật.
11. Không cần backward compatibility vô thời hạn; chỉ migration nếu có persistent data cần bảo toàn.
12. Deterministic automation được tự chạy; generative/expensive AI phải user-triggered.
13. Dependency phải artifact-level + stable ID + version/hash + incremental invalidation.
14. UI dùng DRAFT/NEEDS_REVIEW/READY/OUTDATED/BLOCKED; domain tách review state, outdated, blockers.
15. Overview/Production Dashboard là màn mặc định, có progress, blockers, outdated, Next Best Action, Continue Production.
16. Giảm top-level tab nhưng không gộp logic nội bộ thành một bước lớn.
17. Version granular, checkpoint-based; lock ngăn overwrite nhưng vẫn có thể OUTDATED.
18. Regenerate càng local càng tốt.
19. Voice QA merge vào Voice Workbench.
20. Timestamp không là module riêng.
21. Visual Bible: AI có thể đề xuất; user review/approve/lock.
22. Scene/Shot Workbench là trung tâm Visual.
23. Veo Prompt thành `shot.motionPrompt`.
24. Export portable package; default current accepted versions; history optional.
25. Next Best Action bằng rule/dependency engine, không LLM.
26. Không collaboration.
27. Undo/history/restore ưu tiên cho generated/overwritable artifacts.
28. Provider abstraction: TTS/STT/LLM/Image/Video.
29. Cache/cost-aware; cache key gồm effective input + dependency + provider/model/settings/schema.
30. Benchmark Runway/ElevenLabs/Descript/LTX/ComfyUI.
31. Học pattern, không copy feature.
32. Feature phải tạo quality/speed/consistency/reliability/cost reduction hoặc là infrastructure bắt buộc.
33. Audit output phải có Current Workflow, Feature Inventory, K/I/M/R, Target Workflow/IA/Data Model, Dependency Map, AI/Cost Map, Gap, Backlog, Non-Goals, Do Not Build, Migration khi cần.
34. Không code khi audit.
35. Cho phép large module refactor/workflow redesign nếu có bằng chứng; không full rewrite vì technical elegance.
36. DoD: Topic/Script → Story → Voice → Visual → Export không cần spreadsheet/markdown quản lý trung gian, biết dependency/version/outdated/NBA, no paid AI required.

## Functional Audit Matrix

Cho từng capability:

| Capability | User Goal | Current Surface | Frequency | Value | Cost | Dependencies | Automatable? | Contextualizable? | Decision |
|---|---|---|---|---|---|---|---|---|---|

Decision:

- KEEP
- IMPROVE
- MERGE
- REMOVE

### Câu hỏi bắt buộc cho từng feature

1. Capability này có cần không?
2. Nếu cần, có cần page/module riêng không?
3. Có thể chuyển thành contextual action không?
4. Có thể thành inline editor/side panel không?
5. Có thể deterministic automation không?
6. Có duplicate với feature khác không?
7. Có làm user chuyển context không cần thiết không?
8. Có tạo maintenance/resource cost không đáng không?

## Target IA

```text
Projects
└── Project
    ├── Overview
    ├── Story
    ├── Voice
    ├── Visual
    └── Export
```

### Story
- script structure
- edit
- review
- version/lock

### Voice
- segments
- audio
- waveform
- transcript
- pronunciation
- timestamp
- regenerate
- history

### Visual
- Visual Bible
- Scene/Shot
- reference assets
- image prompt
- image asset
- motion prompt
- video asset
- history/dependency

### Export
- validation
- portable package
- manifest

## Non-Goals

Không xây khi chưa có nhu cầu thật:

- collaboration
- team role
- comments
- assignment
- social scheduler
- analytics suite
- full NLE/video editor
- autonomous AI pipeline
- paid AI dependency

## Output

1. Current Workflow
2. Feature Inventory
3. KEEP/IMPROVE/MERGE/REMOVE
4. UX Friction Map
5. Target Workflow
6. Target IA
7. Target Data Model
8. Dependency Map
9. Gap Analysis
10. Prioritized Backlog
11. Non-Goals / Do Not Build
12. Architecture decisions cần chốt

**Dừng trước khi code.**
