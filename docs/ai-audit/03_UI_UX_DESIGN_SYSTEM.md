# PROMPT 03 — UI/UX & DESIGN SYSTEM AUDIT

> Mục tiêu: giao diện dễ dùng, đẹp, gọn, chuyên nghiệp, nhanh và nhất quán.
> Không thiết kế như SaaS marketing dashboard.

## 43. Usability First

Mỗi màn hình phải cho user biết ngay:

- Tôi đang ở đâu?
- Tôi đang xử lý cái gì?
- Status?
- Có vấn đề/outdated?
- Bước tiếp theo?
- Primary action?

Không bắt user nhớ workflow state xuyên màn hình.

## 44. Design System

Audit và chuẩn hóa:

- typography
- spacing
- color
- surfaces
- borders
- radius
- iconography
- buttons
- inputs
- table/list
- card
- panel
- status
- dialog
- tooltip
- notification
- loading
- empty/error state

Dùng design token.
Không arbitrary spacing/color/radius tràn lan.

## 45. Density

Target:

> Compact / comfortable productivity density

Không huge whitespace/card/heading.
Không nhồi mọi field cùng lúc.

## 46. Progressive Disclosure

Hiển thị thông tin quan trọng trước.
Advanced detail mở theo context.

Không tạo thêm page chỉ để xử lý complexity.

## 47. Workbench Interaction Model

Dùng nhất quán:

`Navigator | Workspace | Inspector`

Story:
`Sections | Editor | Inspector`

Voice:
`Segments | Audio/Transcript | QA`

Visual:
`Scenes/Shots | Workspace | Reference/History`

## 48. Navigation

Top-level project nav:

- Overview
- Story
- Voice
- Visual
- Export

Không tạo top-level tab cho Timestamp/Voice QA/Visual Prompt/Veo Prompt/History nếu có thể contextualize.

## 49. Primary Action

Một context chỉ có một CTA chính nổi bật.

Secondary action giảm emphasis hoặc vào overflow.

## 50. Contextual Actions

Action phải gần artifact.

Ví dụ Shot thiếu image:
- Copy Prompt
- Import Image
- Review Reference

ngay trong Shot.

## 51. Keyboard Accelerators

Hỗ trợ shortcut cho frequent action.
Shortcut không được là cách duy nhất.

## 52. Command Palette

Cho:
- command
- navigation
- Scene/Shot
- warning
- entity search

Không cần LLM.

## 53. Status Language

Dùng:
- icon
- text label
- color

Không color-only.

## 54. Actionable Errors

Thông báo phải nêu:
- artifact
- vấn đề
- nguyên nhân/thiếu gì
- next action

## 55. Loading UX

- skeleton cho content load
- progress cho background task
- inline saving cho small action
- completion notification
- không full-screen spinner nếu không cần

## 56. Modal Rule

Modal ưu tiên cho:
- delete
- destructive overwrite
- critical confirmation

Dùng inline/drawer/side panel cho edit/history/metadata khi hợp lý.

## 57. Desktop-First

Primary desktop resolutions:
- 2560×1440
- 1920×1080
- 1440×900
- 1366×768

Không hy sinh productivity desktop để ép mobile parity.

## 58. Accessibility

Target WCAG 2.2 AA khi áp dụng.

Audit:
- keyboard
- focus
- labels
- contrast
- target size
- ARIA/semantics
- reduced motion
- drag fallback
- non-hover access

## 59. Motion

Animation chỉ phục vụ:
- state
- hierarchy
- causality
- feedback

Không decorative animation nặng.

## 60. Avoid AI-SaaS Visual Noise

Tránh:
- excessive gradient
- glassmorphism
- glow
- shadow
- huge rounded card
- decorative illustration

## 61. Visual Direction

- Professional
- Calm
- Modern
- Dense but breathable
- Tool-oriented
- Content-first
- Neutral
- Consistent
- Minimal visual noise

## 62. Performance-Aware UI

Không đổi performance lấy vẻ đẹp.

Tránh:
- nhiều blur
- high-res grid load
- heavy shadow
- background animation
- unnecessary DOM

Ưu tiên:
- thumbnail
- virtualization
- lazy preview
- simple surface
- CSS-native interaction

## UI Quality Gate

Mọi screen phải pass:

| Question | Pass Condition |
|---|---|
| Tôi đang ở đâu? | Rõ |
| Tôi đang làm gì? | Rõ |
| Status? | Rõ |
| Có vấn đề gì? | Thấy được |
| Next action? | Rõ |
| Primary action? | Một action chính |
| Có action/page dư? | Không |
| Có unnecessary context switch? | Không |
| Keyboard dùng được? | Có |
| Project lớn còn responsive? | Có |
| UI nhất quán? | Có |
| Accessibility? | Pass mức target |

## Output

1. Current Screen Map
2. UX Friction Map
3. Navigation Audit
4. Design System Audit
5. Workbench Proposal
6. Component Consolidation Map
7. UI KEEP/IMPROVE/MERGE/REMOVE
8. Accessibility Findings
9. Visual Direction
10. UI Quality Gate checklist

**Không code trong audit phase.**
