# PROMPT 04 — RESPONSIVE & ACCESSIBILITY AUDIT

> Hướng: Desktop-first, responsive everywhere, capability-adaptive.

## 63. Responsive & Adaptive Layout

Không chỉ shrink desktop.

Responsive phải giữ:
- information
- workflow state
- primary actions
- validation
- status
- accessibility
- data integrity

## 64. Responsive Workbench

### Wide
`Navigator + Workspace + Inspector`

### Medium
`Navigator + Workspace`
Inspector → drawer/slide-over

### Small
Workspace chính
Navigator/Inspector → sheet/drawer

Không cố giữ 3 cột khi không đủ chỗ.

## 65. Content-Driven Breakpoints

Breakpoint phải dựa vào content.

Starting points:
- >= ~1280px → full workbench
- ~900–1279px → 2-pane
- ~600–899px → adaptive 1/2 pane
- < ~600px → review/control-first

Không coi các mốc này là contract cứng.

## 66. Component-Level Responsive

Audit từng:
- Shot header
- toolbar
- editor
- form
- inspector
- preview
- action group

Không overlap/cut-off.

## 67. Table Responsive

Wide table có thể đổi thành list/card trên màn nhỏ.

Không giảm font vô hạn.

## 68. Toolbar Responsive

Primary action luôn visible.
Secondary → overflow khi cần.

## 69. Typography Responsive

Không giảm font tới mức khó đọc.
Co spacing/layout trước.

## 70. Media Responsive

Preview:
- responsive container
- aspect ratio
- object-fit
- không thay original/master

## 71. Asset Grid Responsive

Dùng auto-fill/min card width hoặc equivalent theo stack.

Không hard-code device model.

## 72. Touch Support

Không phụ thuộc:
- hover
- right click
- mouse wheel

Touch target phải usable.

## 73. Hover Fallback

Hover là accelerator.
Mọi action quan trọng phải có alternative.

## 74. Drag & Drop Fallback

Nếu drag không essential, phải có alternative:
- Move up
- Move down
- Move to
- single-pointer action

## 75. Mobile Scope

Mobile ưu tiên:
- overview
- progress
- status
- Next Best Action
- review Script
- review Shot
- approve/reject
- asset view
- quick correction

Không cần cố biến mobile thành full editing workstation cho:
- detailed waveform
- bulk Scene planning
- complex timeline
- heavy asset management

## 76. Responsive Quality Gate

Test ít nhất:
- 2560×1440
- 1920×1080
- 1440×900
- 1366×768
- 1280×720
- 1024×768
- 768×1024
- 390×844
- 360×800
- 320 CSS px equivalent reflow khi áp dụng
- browser zoom / enlarged text

Không được:
- clipped content
- overlap
- hidden primary action
- unreadable text
- broken navigation
- accidental horizontal scroll
- broken modal/drawer
- lost status
- lost validation
- data loss

Narrow viewport có thể đổi presentation, không được âm thầm đổi business behavior.

## Accessibility Checklist

- keyboard-only complete navigation
- visible focus
- focus không bị sticky UI che
- semantic labels
- sufficient contrast
- minimum target size theo WCAG khi áp dụng
- drag alternative
- non-hover action path
- reduced motion
- no color-only meaning
- reflow where applicable
- correct dialog/drawer focus management

## Responsive + Performance

Không:
`fetch 500 → render 500 → CSS display:none 480`

Phải:
`context/viewport → load needed → render needed`

Small viewport có thể dùng thumbnail nhẹ hơn nhưng master vẫn nguyên.

## Output

1. Responsive Behavior Matrix
2. Breakpoint/Content Threshold Proposal
3. Workbench Adaptation Rules
4. Component Findings
5. Touch/Keyboard Findings
6. WCAG Findings
7. Responsive Performance Findings
8. Quality Gate Results
9. Prioritized Fixes

**Không code trong audit phase.**
