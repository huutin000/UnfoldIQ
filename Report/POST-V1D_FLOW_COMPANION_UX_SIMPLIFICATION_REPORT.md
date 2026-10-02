# Report — POST-v1D FLOW COMPANION UX SIMPLIFICATION

Date: 2026-09-29
Extension version: 0.3.0 → **0.4.0**
Stack decision: **vanilla HTML/CSS/JS kept — no framework migration**
Credits consumed in this task: **0** (UI-only; no Generate click)

---

## 1. Status

Redesign implemented, all automated gates PASS. The side panel is now
task-centric: one main screen (job + one primary action + progress),
Settings on a separate screen, Developer Tools behind Developer Mode
(default OFF). Vietnamese readability fixed (letter-spacing +
line-height + word-spacing via tokens). Automation architecture and
security policy untouched.

## 2. References reviewed

- **Chrome Side Panel API docs** (developer.chrome.com, fetched): confirms
  `sidePanel.setPanelBehavior({ openPanelOnActionClick: true })` as the
  platform-native toolbar→panel behavior already used; no invented
  platform behavior. Panel width is user-resizable → fluid layout required.
- **shadcn/ui** (principle-level): design tokens, composable components,
  clear hierarchy, good defaults. Applied as local CSS variables + small
  JS render modules. **No React migration** (stack is vanilla; migrating
  for appearance alone was explicitly rejected per §42–§43).
- **Radix Primitives** (principle-level): accessible disclosure/dialog/
  focus/keyboard/ARIA semantics reproduced with native HTML
  (`<details>`, real `<button>`/`<label>`, `aria-live`, `aria-expanded`,
  `aria-current="step"`, `:focus-visible`). No Radix dependency (not
  React-based; native semantics are sufficient and lighter).
- **Lucide** (style-level): consistent 24×24 stroke icons, bundled locally
  as inline SVG strings (`components/icons.js`). No CDN, no remote code,
  no emoji, no Material ligature text.
- **sidepanel-agent** (layout inspiration only): task-focused hierarchy,
  quiet secondary actions, companion-not-distraction. Nothing copied.

## 3. Existing stack decision

Vanilla HTML + CSS + JS confirmed (`sidepanel.html/.js`, zero UI
dependencies). Decision: **improve in place**. Added only local modules
under `src/ui/` (styles, state, components, toast) wired via plain
`<link>`/`<script>` tags; `build.js` REQUIRED_FILES extended (27 files).
No new runtime dependencies, no build-system change, no service-worker
change. License impact: none (all new code is original).

## 4. Current UX problems

Confirmed against the 0.3.0 panel (§2): ~11 information blocks on the
normal screen (developer console look); 7–8 competing buttons with
internal ordering knowledge required; internal enums
(GENERATION_READY/promptVerified/selector FAIL) at same visual weight as
the task; multi-viewport vertical scroll; fixed `width:370–372px` body
causing horizontal scroll risk and a giant blank area in wide panels;
reference editor always visible (5 large fields); raw log/diagnostics
always rendered.

## 5. New information architecture

```text
Current IA (system-centric):
Header+tagline / TRẠNG THÁI / CÔNG VIỆC+packet+GENERATION_READY /
HÀNH ĐỘNG(8 buttons) / ẢNH THAM CHIẾU(5 fields) / NÂNG CAO / NHẬT KÝ

New IA (task-centric):
MAIN (default)
├── Header: logo + UNFOLDIQ + status chip + settings gear
├── Error card (conditional, human-first + Chi tiết kỹ thuật)
├── Job card: type + prompt preview (3-line clamp + Xem đầy đủ) +
│   meta row + Xem chi tiết (IDs/paths/states)
├── Reference summary (conditional — hidden when job needs none)
├── ONE primary CTA + quiet secondary (Từ chối, only when awaiting)
├── Result card (conditional)
└── Stepper: Chuẩn bị → Chờ duyệt → Tạo → Hoàn tất (minimal subset)
SETTINGS (separate screen, ← Quay lại)
├── Kết nối (Bridge URL/token — token memory-only note)
├── Dự án (Project/Job ID)
├── Ảnh tham chiếu (editor — "Thay đổi" navigates here)
├── Giao diện (Developer Mode toggle, default OFF)
├── Công cụ nhà phát triển (hidden unless dev mode:
│   Chẩn đoán / Trạng thái điều khiển / Công việc gốc /
│   Kiểm tra giao diện / Nhật ký — collapsible, own scroll)
└── Giới thiệu (version)
```

## 6. New user flow

```text
Open extension (toolbar click → panel, platform-native)
↓ auto: restore safe config → resolve Flow tab → check connectivity
↓ auto: fetch current job → silent zero-credit dry-run +
         read-only generation-state probe
↓ Main screen: job summary + human status + stepper
↓ ONE primary CTA (usually: Duyệt & Tạo)
↓ system runs (spinner, everything else disabled)
↓ result card / next state (or friendly error + Thử lại)
Clicks: 0 infrastructure + 1 meaningful (Duyệt & Tạo).
```

## 7. Primary action state machine

Single source of truth: `src/ui/state/ui-state.js → resolveUIState()`
(internal → status → CTA → tone/stepper). No duplicated mapping.

```text
NO_JOB → Tìm công việc (warn)
CONNECTING → Đang kết nối… (disabled)
NEED_FLOW → Thử lại (warn)
NEED_CONFIG → Mở cài đặt (warn)
PREPARING → Đang chuẩn bị… (disabled)
AWAITING_USER_APPROVAL → Duyệt & Tạo (+ quiet Từ chối)
GENERATING → Đang tạo… (disabled)
PROCESSING → Đang xử lý… (disabled)
READY → Xem kết quả (ok)
ERROR_RETRYABLE → Thử lại (bad)
BLOCKED → Xem vấn đề (bad)
CANCELLED → Tìm công việc mới (warn)
```

Job bridge status maps via `uiStateForJob()` (approval gating kept;
GENERATION_READY=false holds PREPARING). Verified for all 12 states in
test D1.

## 8. Main screen redesign

Matches the §6 wireframe: compact header (no permanent tagline), job
card answering what/prompt/cost/settings, prompt clamped to 3 lines with
`Xem đầy đủ` toggle (full prompt never lost), meta row
`Model · aspect · N ảnh · cost`, technical packet under `Xem chi tiết`
(Job ID, Project, exact model, status, destination path). One `.cta`
button + text-like secondary. Stepper with `aria-current="step"`.

## 9. Settings / Developer Mode

Settings is a separate view (not a collapsible on main). Developer Mode
toggle persisted in `chrome.storage.local` (non-secret, safe); tools
section has the `hidden` attribute by default and renders only when
enabled. Diagnostics text, stacked selector rows, raw job JSON, DOM probe
button, monospace log viewer (wrapped, own vertical scroll, copy-safe).
Returning to Main restores the clean task view (Esc also returns).

## 10. Reference image UX

Conditional per §17: `hasReference()` hides the entire section when the
job needs none (verified in D8). Otherwise a compact summary card:
title/path + `Giữ: a · b` + `Cho phép thay đổi: c` + `Thay đổi` (navigates
to the Settings editor, which uses compact single-line inputs instead of
5 large textareas). Reference metadata contract unchanged.

## 11. Responsive behavior

Fluid `#app` (`width:100%`, `max-width:none`, `min-width:0`,
`overflow-x:hidden`); all descendants `min-width:0` +
`overflow-wrap:anywhere`. Narrow <560px single column (default);
560–720px airier padding + inline meta; >720px optional 2-column
(job | reference) with no filler panels. Verified statically in D3.

## 12. Empty-space fix

Root causes removed: fixed `width:370px` body, fixed-width cards, and
non-growing wrappers are gone. The shell consumes the full panel width at
any size; wide panels distribute job/reference into 2 columns instead of
leaving a blank region (D3 asserts no fixed narrow widths in markup).

## 13. Horizontal-scroll fix

`overflow-x:hidden` on `html/body/#app`; tables eliminated from all views
(selector health → stacked `.selector-row` grid with internal scroll);
diagnostics/log viewers scroll vertically inside their own containers;
long IDs/paths/codes wrap (`overflow-wrap:anywhere`, `word-break`).
Acceptance rule `scrollWidth <= clientWidth` holds structurally at every
width (D3); long-value wrapping covered by base rule `#app *`.

## 14. Visual system / tokens

`styles/tokens.css`: colors (bg/surface/border/text/muted/primary/
success/warning/danger + bg variants), spacing scale (4/8/12/16/24/32),
radii (sm/md/lg/pill), font sizes (17/15/13.5/12), line-heights and
tracking tokens. No scattered hex/spacing values in components
(components reference only `var(--…)`).

## 15. Localization structure

`state/labels.vi.js` (`window.FlowUIStrings`) holds every user-facing
string; handlers reference `T.*` keys. All 12 state CTAs, statuses,
stepper labels, error copy, settings copy, and toast copy centralized —
future internationalization = one new dictionary. Technical enums stay
English in Developer Tools only.

## 16. Icons

`components/icons.js`: 12 original Lucide-style stroke icons (settings,
check, x, alert, info, refresh, chevrons, image, eye, download, globe),
inline SVG, `aria-hidden`, labelled controls carry text labels. No emoji
anywhere, no remote loads (D7). Unknown names throw (fail-fast for
agents).

## 17. Accessibility

Native semantics first: real `<button type="button">`, real `<label>`,
`<details>/<summary>` disclosures with `aria-expanded`, stepper
`aria-current`, toasts `role="status"` in an `aria-live="polite"`
container, error card `role="alert"`, `:focus-visible` outlines, ≥32–36px
targets, Esc closes Settings. Keyboard acceptance path (Tab → CTA →
Enter/Space, details, settings open/close) uses only native controls.

## 18. Click-count comparison

```text
Before (0.3.0 normal path): Lưu cấu hình → Kiểm tra Flow → Lấy công việc
  → Chạy thử → Kiểm tra trạng thái tạo → Duyệt & Tạo = 6 clicks.
After (0.4.0 normal path): 0 infrastructure clicks + 1 meaningful
  (Duyệt & Tạo). Optional: Xem chi tiết / Từ chối / Cài đặt.
Visible controls before: ~11 blocks + 8 buttons + always-on reference
  form + selector table + raw log.
After: header + job card + 1 CTA (+1 quiet secondary when awaiting) +
  stepper; settings/diagnostics/reference-editor one navigation away.
```

## 19. Files modified

```text
NEW  src/ui/styles/{tokens,base,components}.css
NEW  src/ui/state/{labels.vi,ui-state}.js
NEW  src/ui/{toast}.js
NEW  src/ui/components/{icons,job-card,stepper,reference-summary,developer-tools}.js
REWRITTEN  src/ui/sidepanel.html (main/settings views, module scripts)
REWRITTEN  src/ui/sidepanel.js (same automation, new presentation layer)
UPDATED  build.js (27 files + v1D regression gates), manifest.json +
  package.json (0.4.0), flow-companion/README.md (v1D notes)
UPDATED  test-flow-postv1c.js (C9 → v1D IA)
NEW  test-flow-postv1d.js (D1–D9, 136 assertions)
```

Tab resolver, bridge, FlowPageAdapter, content commands, service worker:
untouched.

## 20. Dependencies added / rejected

Added: none. Rejected: React + shadcn/ui components (stack is vanilla;
migration refused per §43), Radix packages (native semantics suffice),
Lucide npm package (style reproduced locally, zero bytes of dependency),
any CDN/font/JS loads (security §36). Decision rule §42 applied and
documented here.

## 21. Tests

```text
node test-flow-postv1d.js      → 136 assertions PASS (D1–D9)
node test-flow-postv1c.js      → 95 assertions PASS (C9 updated to v1D IA)
node test-flow-postv1b.js      → 177 assertions PASS (automation intact)
node test-flow-page-adapter.js → PASS (FP1–FP15, FP15 boundary kept)
extension tests/run.js          → 6 PASS
node validate-schemas.js       → ALL TESTS PASSED
node flow-companion-doctor.js  → exit 0
node build.js                  → BUILD_OK, 27 files MV3
```

One test iteration fixed during development (D7 regex blamed the SVG
`xmlns` namespace and a comment word; corrected to assert no remote
*loads*, plus corrected label-key names). No production-code waiver.

## 22. Security regression

No permission/manifest-host changes; no new `chrome.*` APIs beyond
already-granted storage/tabs-messaging; token stays memory-only (settings
note + storage writes only non-secret fields); dev-mode flag is a
non-secret boolean; no cookies/auth/private Flow APIs/`<all_urls>`/remote
code/CAPTCHA bypass (D9 asserts). `build.js` credential scan passes
(one false positive on `sk-` inside "task-centric" reworded to
"task focused").

## 23. Before/after evidence

- Static render harness (node, real modules + real CSS):
  `postv1d-preview.html` (18,243 bytes) — job card, reference summary,
  all 12 state cards with correct CTA labels, 4 correctly disabled
  (CONNECTING/PREPARING/GENERATING/PROCESSING), steppers with current
  markers. Verified programmatically
  (refPresent/stepperPresent/jobCard true, ctaCount=12).
- Structural assertions replace screenshots for the automatable rules
  (D1–D9). **Honest limitation (§56): real Chrome Side Panel visual
  review (reload unpacked → open Flow → toolbar click → resize
  320→800px, manual checklist §52) was not performed in this environment
  and must be done by the operator before claiming full visual PASS —
  no credit-consuming Generate call is needed for it.**

## 24. Remaining limitations

1. Manual §52 checklist in real Chrome pending (operator, ~10 minutes,
   zero credit).
2. Provisional icons from v1C unchanged (no approved logo yet).
3. `GET_GENERATION_STATE` silent probe may report PREPARING on slow Flow
   UIs until controls settle — CTA stays honest ("Đang chuẩn bị…"), never
   fabricates readiness.
4. No framework: future complex widgets (virtualized logs, rich
   reference editor) may justify revisiting — as a separate architecture
   decision, not this task.

## 25. Final conclusion

The panel is task-centric with one primary CTA per state, zero
infrastructure clicks, hidden-by-default developer data, separated
Settings, conditional references, fluid responsive shell with no
horizontal scroll, readable Vietnamese typography, local icons,
centralized strings, native accessibility — while bridge/resolver/
adapter/dry-run/approval/download/import/reference/security logic is
byte-for-byte preserved in behavior and all prior suites still pass.

`POST-v1D FLOW COMPANION UX SIMPLIFICATION: NOT PASS 100%`
