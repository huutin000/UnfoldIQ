# PROMPT 05 — AUDIT DELIVERABLES, QUALITY GATES & IMPLEMENTATION HANDOFF

> File này dùng để kiểm tra audit có đủ hay chưa và để ngăn agent nhảy thẳng vào code.

# 1. Bắt buộc có trước khi implement

- Current Workflow
- Current IA
- Current Screen Map
- Feature Inventory
- Functional KEEP/IMPROVE/MERGE/REMOVE
- UX Friction Map
- Performance Baseline
- Hardware & Runtime Baseline
- Dependency Map
- Target Workflow
- Target IA
- Target Workbench UX
- Target Domain/Data Model
- Artifact Graph
- Version/Lock semantics
- Cache Strategy
- AI/Cost Map
- Resource Scheduler Strategy
- Responsive Matrix
- Accessibility Findings
- Gap Analysis
- Non-Goals
- Do Not Build
- Prioritized Backlog
- Migration Map nếu cần
- Key Architecture Decisions
- Acceptance Criteria
- Regression Plan

# 2. Không được làm trong Audit

- sửa code
- rename/refactor file
- đổi schema
- tạo migration
- thêm dependency
- implement UI
- cleanup code ngoài scope
- "tiện tay" fix bug
- tạo feature dựa trên assumption

# 3. KEEP / IMPROVE / MERGE / REMOVE Contract

Mỗi decision phải có:

| Field | Required |
|---|---|
| Capability | Yes |
| Current behavior | Yes |
| Evidence | Yes |
| Decision | Yes |
| Reason | Yes |
| User impact | Yes |
| Complexity impact | Yes |
| Performance impact | Yes |
| Data/dependency impact | Yes |
| Target behavior | Yes |
| Risk | Yes |

# 4. Prioritization

Ưu tiên:

1. Workflow simplification
2. Correctness / data integrity
3. High-friction UX
4. Performance bottleneck
5. Cost/resource waste
6. Architecture blocker
7. Visual polish

Không ưu tiên cosmetic refactor trước blocker.

# 5. Definition of Done

Core journey:

`Topic/Script → Story → Voice → Visual → Export`

Pass nếu:

- không cần spreadsheet/markdown quản lý production;
- gần như không copy dữ liệu nội bộ;
- dependency đúng;
- outdated đúng scope;
- version/history restore được;
- lock không bị overwrite;
- paid AI không cần cho core;
- effective input không đổi → không regenerate;
- restart không mất state;
- external Flow/Veo handoff rõ;
- export portable;
- user luôn biết current state + next action.

# 6. Performance Gate

- baseline trước/sau
- large project strategy
- UI không bị background job làm freeze
- no global rerender không cần thiết
- no load-all project nếu không cần
- thumbnails/proxies đúng
- resource scheduler tránh contention/OOM
- cache correctness

# 7. UI Gate

- vị trí rõ
- context rõ
- status rõ
- warning actionable
- next action rõ
- 1 primary action
- ít context switch
- design system nhất quán
- không AI-SaaS visual noise
- keyboard usable
- accessibility target đạt

# 8. Responsive Gate

- wide
- desktop
- compact laptop
- tablet
- mobile
- zoom/enlarged text

Không clipped/overlap/hidden critical action/data loss.

# 9. Hardware/Quality Gate

Không silent quality downgrade.

Khi resource thiếu:
- queue
- wait
- background
- reduce concurrency
- proxy preview

Không giảm master/final quality nếu user không chủ động chọn.

# 10. Cost Gate

Core workflow phải hoạt động không có paid AI key.

Paid AI:
- optional
- explicit
- user-triggered
- không chạy do dependency change tự động

# 11. Implementation Handoff

Chỉ sau khi audit được duyệt, tạo Implementation Plan theo phase.

Mỗi phase phải có:

- Objective
- Scope
- Out of Scope
- Affected modules
- Data changes
- API changes
- UI changes
- Migration nếu có
- Performance considerations
- Accessibility considerations
- Tests
- Regression
- Rollback strategy
- Acceptance Criteria

Không gom quá nhiều kiến trúc khác loại vào một phase nếu khó verify.

# 12. Do Not Build

Default:
- collaboration
- team permissions
- comments
- assignment
- social scheduler
- analytics suite
- full final video editor
- autonomous AI pipeline
- paid AI dependency
- competitor feature cloning
- unnecessary migration framework
- generic CRUD page khi contextual UI tốt hơn

# 13. Coverage Checklist 1–76

## Product / Workflow: 1–36
- [ ] 1 Solo-first
- [ ] 2 Priorities
- [ ] 3 Product role
- [ ] 4 Audit hypotheses
- [ ] 5 Source/Git/docs truth order
- [ ] 6 Audit order
- [ ] 7 Merge hypotheses
- [ ] 8 Restructure policy
- [ ] 9 Menu/module
- [ ] 10 Data/API/schema
- [ ] 11 Compatibility/migration
- [ ] 12 Automation boundary
- [ ] 13 Dependency engine
- [ ] 14 Status model
- [ ] 15 Dashboard
- [ ] 16 Top-level IA
- [ ] 17 Version/locking
- [ ] 18 Local regeneration
- [ ] 19 Voice QA
- [ ] 20 Timestamp
- [ ] 21 Visual Bible
- [ ] 22 Scene/Shot Workbench
- [ ] 23 Veo Prompt
- [ ] 24 Export
- [ ] 25 Next Best Action
- [ ] 26 No collaboration
- [ ] 27 History/restore
- [ ] 28 Provider abstraction
- [ ] 29 Cost/cache
- [ ] 30 Benchmarks
- [ ] 31 Pattern-not-copy
- [ ] 32 Feature value
- [ ] 33 Deliverables
- [ ] 34 No code
- [ ] 35 Refactor scope
- [ ] 36 Product DoD

## Performance / Hardware: 37–42
- [ ] 37 Performance audit
- [ ] 38 Large project scalability
- [ ] 39 Functional simplification
- [ ] 40 Performance regression
- [ ] 41 Hardware-aware no quality loss
- [ ] 42 Resource scheduler

## UI/UX: 43–62
- [ ] 43 Usability first
- [ ] 44 Design system
- [ ] 45 Density
- [ ] 46 Progressive disclosure
- [ ] 47 Workbench pattern
- [ ] 48 Navigation
- [ ] 49 Primary action
- [ ] 50 Contextual actions
- [ ] 51 Keyboard accelerator
- [ ] 52 Command palette
- [ ] 53 Status visibility
- [ ] 54 Actionable errors
- [ ] 55 Loading UX
- [ ] 56 Modal rule
- [ ] 57 Desktop-first
- [ ] 58 Accessibility
- [ ] 59 Motion
- [ ] 60 Avoid visual noise
- [ ] 61 Visual direction
- [ ] 62 Performance-aware UI

## Responsive / Accessibility: 63–76
- [ ] 63 Adaptive layout
- [ ] 64 Responsive workbench
- [ ] 65 Content breakpoints
- [ ] 66 Component responsive
- [ ] 67 Table responsive
- [ ] 68 Toolbar responsive
- [ ] 69 Typography responsive
- [ ] 70 Media responsive
- [ ] 71 Asset grid responsive
- [ ] 72 Touch
- [ ] 73 Hover fallback
- [ ] 74 Drag fallback
- [ ] 75 Mobile scope
- [ ] 76 Responsive quality gate

**Nếu một mục chưa được audit hoặc chưa có lý do rõ ràng, audit chưa hoàn thành.**
