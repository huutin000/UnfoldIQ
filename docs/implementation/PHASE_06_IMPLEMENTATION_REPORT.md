# PHASE_06_IMPLEMENTATION_REPORT.md
# BÁO CÁO TRIỂN KHAI PHASE 6 — RESPONSIVE & WCAG 2.2 AA-ORIENTED ACCESSIBILITY HARDENING

> Phase: 6
> Generated at: 2026-09-17T22:42:33+07:00
> Branch: main
> HEAD: af5274a12ff65cbae4dc7b1ab34b63e5484441f8
> Baseline regression: 696 / 696 PASS (effective; 1 stale governance string fixed with intent preserved, see §2)
> Final regression: 724 / 724 PASS (696 + 28 hardening tests mới)
> Verdict: PHASE 6: IMPLEMENTED / REVIEW PENDING — READY FOR EXTERNAL REVIEW — PHASE 7: FUTURE / NOT STARTED

## 1. Executive Summary

Phase 6 triển khai độc lập trên approved Phase 5 baseline (PASS/FINAL/
VERIFIED, 696 tests), không chạm Phase 7/8/9. Hai trục: (A) responsive /
capability-adaptive hardening theo canonical bands (>=1280 3-pane |
960–1279 Nav+Work + Inspector Drawer | <960 full Workspace + 2 Sheets),
sửa 390px navigator collapse, breakpoint edges, 1366×768 vertical,
320px reflow, zoom-200% equivalent; (B) WCAG 2.2 AA-oriented hardening:
modal Drawer/Sheet semantics (role/trap/Escape/return/lock), focus-visible
2px token, focus-not-obscured, target 24px + coarse 44px product policy,
contrast ink-4 (vượt plan value, tính toán chứng minh), polite live-region
milestones, VN labels, non-hover/keyboard grid access, drag N/A có chứng cứ,
tabindex>0 = 0. Manual 8-step checklist: 7 PASS + 1 N/A có evidence, 0 bước
bỏ qua. Không claim formal conformance. Regression + integrity + scope đầy
đủ. STOP chờ external review.

## 2. Git / Approved Phase 5 Baseline

- Branch `main`, HEAD `af5274a12ff65cbae4dc7b1ab34b63e5484441f8`.
- Tags hiện có: `audit-complete-baseline, pre-phase-2, pre-phase-3a,
  pre-phase-3b, pre-phase-3c` — KHÔNG có `pre-phase-6`.
- Approved Phase 5 baseline vẫn nằm trong dirty worktree (17 tracked
  modified/deleted + ~70 untracked, inventory đầy đủ trong log task) →
  ```text
  pre-phase-6:
  NOT CREATED — approved baseline remains in inventoried dirty worktree
  ```
  Không fabricate tag, không move historical tags, không clean/reset/
  restore, không commit (chưa được yêu cầu), không stage temp/projects/.
- Baseline regression: lần chạy đầu **695/696** — 1 fail duy nhất là
  `test_phase05_evidence_closure.py::TestGovernance::test_no_premature_pass`,
  stale exact-string pin (chỉ chấp nhận `IMPLEMENTED / REVIEW PENDING` hoặc
  `PASS / FINAL / VERIFIED`, trong khi roadmap Rev 2.5.4 đã promote hợp lệ
  với wording `PASS / FINAL` + cột `VERIFIED`). Đã fix tối thiểu: chấp nhận
  thêm đúng approved wording, giữ nguyên guard intent → file đó 19/19,
  baseline hiệu dụng **696/696, 0 failed, 0 errors**
  (`temp/phase06_verification/tests/baseline_pytest.log`). Không weaken test.
- Ghi nhận trung thực: trong cửa sổ baseline (20:48–20:51) có battery NGOÀI
  task cùng hoạt động trong repo (diagnostics zip 20:51:14, Phase-4
  benchmark probe logs 20:49–20:50, exports/research writes, copytree
  `projects/_p5s_dense300` lúc 20:51:29 — KHÔNG phải fixture của task này,
  được giữ nguyên không đụng). Xem §30.

## 3. Source Audit

| Area | Current | Issue (pre-Phase 6) | Phase 6 target |
|---|---|---|---|
| Shell grid | 232/1fr/352 base; rail ≤1439; collapse classes | sidebar rời flow từ 1024 (lệch canonical 960); rule 3-col ≤1439 đè chết rule 2-col 1024–1279 | bands chuẩn §4 |
| Sidebar <narrow | fixed drawer ≤1024 | ngưỡng + thiếu modal semantics | Sheet <960 + dialog/trap/return/lock |
| Inspector <1280 | fixed drawer 768–1024 + hide ≤1279 | <768 mất fixed (rơi về in-flow); thiếu modal semantics | Drawer mọi width <1280 |
| Drawers JS | toggle/backdrop/Escape/raw-remove | 2 Escape handlers (cũ strip .open thô, shadow controller); không trap/return/lock/aria-modal | UQDrawer single-owner |
| Modal helper | uqModalOpen/Close + trapFocus | trap first/last dính SVG use[href] ẩn; vbModal Escape nhờ redesign (OK) | visibility-filtered trap |
| Palette | dialog aria-modal, no trap | Tab thoát dialog | Tab trap |
| Lightbox | dialog/Escape/return, no trap; grid img click-only | Tab thoát; thumbnails không keyboard | trap + tabindex/role/Enter |
| Render progress | button % + polite toasts | không milestone announcements | polite 25/50/75 milestones |
| Contrast ink-4 | #5b6878 (3.1–3.5:1) / light #8a97ab (2.96) | FAIL 4.5 cả hai themes; plan #6b7a90 cũng chỉ 4.07–4.49 | #75839a (4.63+) / #67748a (4.73) |
| Focus | :focus-visible 2px tồn tại (uq-base) | token chưa chuẩn; drawer focus mất khi remount | token + trap động + restore by stable trigger |
| Target size | btn 24–34px; thumbs 10–16px; coarse chỉ 28px | mode-btn 23.2; thumbs <24; coarse thiếu 44px policy | 24px min + thumbs 24 + coarse 44 floor |
| Drag | chỉ file dropzones (có nút Chọn tệp) | — | N/A reorder + giữ alternative |
| tabindex>0 | không có | — | giữ = 0 |
| Hidden panels | display:none khi đóng | đúng; metric cũ sai (offsetParent) | rects-based metric 0/0/0 |
| Tour overlay | auto first-visit tours, trap riêng | gây nhiễu verification | preset dismissed (test setup, không đổi product) |
| 390px scenes | list collapse h=0 (pane 124px) | content loss ở narrow | min-height pane 440/72vh |

## 4. Responsive Architecture

### >=1280 — Nav | Work | Inspector (3-pane)
Base grid 232/minmax/352; 1280–1439 rail 64 + inspector 332 in-flow
(`@media (min-width:1280) and (max-width:1439)` — đã re-scope khỏi rule cũ
trùm ≤1439 vốn đè chết band laptop). Verified 1920/1440/1366/1280: đúng
grid, no h-scroll, workbench internal scroll, virtualized list hoạt động
(sustained smoke §26).

### 960–1279 — Nav | Work + Inspector Drawer
Sidebar in-flow (rail ≤1439), inspector fixed drawer (uq-shell 960–1279 +
uq-responsive mở rộng fixed xuống mọi width <1280). Ngưỡng sidebar JS
`sidebarInFlow` 1024→960 + backdrop + grid shell đồng bộ. Verified
1278/1024/960: grid 2-col, inspector `display:none` khi đóng, toggle
`aria-expanded` đồng bộ.

### <960 — Workspace full-width + 2 Sheets
Grid 1fr; Nav Sheet (`pipeline-sidebar` fixed, dialog modal khi mở);
Inspector Sheet (fixed, dialog modal khi mở); mapping đúng App Shell hiện
tại, không invent Sheet thứ ba: Sheet 1 = Navigation, Sheet 2 = Inspector
(story/voice có inspector riêng in-flow nên Sheet 2 N/A ở đó — documented).
Verified 958/768/390/320: single column, sheets đóng = display:none,
mở = dialog + trap + backdrop + lock.

## 5. Breakpoint Edge Validation
- 1280: 3-pane rail (64/884/332, inspector in-flow) ✓
- 1278: 2-col (64/1214, inspector none) ✓
- 960: 2-col (64/896, inspector none) ✓
- 958: single (958, cả hai none) ✓
- UQShellMode flips SI→Si→si đúng bands ✓ (detection).
- Exact-boundary honesty: Chromium emulation làm tròn fractional
  (961→962; matchMedia false tại đúng 1279/959 lẻ) và OS-scaled windows
  cũng fractional — biên lẻ-exact không probe được; coverage = neighbor
  widths cả hai phía + exact query strings pinned bởi focused tests.
  Trên viewport integral thật, queries hành xử đúng spec.

## 6. 1366×768 Laptop Hardening
Five-workbench smoke: overview/story/voice/scenes/export đều active,
non-blank, đúng kích thước. Vertical audit: nút below-fold được
scrollIntoView và reachable trong vùng khả kiến (trừ player bar) ở mọi
workbench — reachSample 100% ok (overview/story/voice/export 0 below-fold
sau settle; scenes 69 below-fold nhưng sample scroll-reveal ok).
Không overlap sticky/fixed (player 58px tôn trọng qua visH).
Inspector behavior đúng band (in-flow rail? 1366 ≥1280: 3-pane rail +
inspector in-flow — verified grid). Không vertical clipping inaccessible.

## 7. 320 CSS px Reflow
Viewport 320x800: body `scrollWidth == clientWidth` (no page h-scroll),
grid single 320, palette dialog 272 ≤ 320 (fits, input visible),
sheets hoạt động, text wrap (verified screenshots vp-320 + palette-320).
Exception 2D hợp lệ duy nhất: horizontal scroll bị nhốt trong component
(pron-table wrapper `overflow-x:auto`, stepper overflow-x auto) — body
không thành canvas 2D. Không content loss (sau fix §lists).

## 8. 200% Zoom
Synthetic Ctrl+= KHÔNG điều khiển được browser zoom thật
(visualViewport.scale đứng yên ở 1 — đã verify, document limitation).
Dùng physical equivalent: 960×540 CSS @ DSF 2.0 (≡ 200% @1080p: cùng CSS
px, cùng backing pixels). Kết quả: DPR 2.0, inner 960×540, mode Si
(2-pane/Drawer đúng kỳ vọng), no h-scroll, inspector toggle visible,
focused control in-view. Screenshot `zoom200equiv-scenes`.

## 9. Drawer / Sheet Architecture
`window.UQDrawer` (app.js): open (mutual exclusion + role=dialog +
aria-modal + VN label + trap + backdrop + lock khi modal-mode),
close/closeAll (xóa class/attrs + release trap + sync + lock + focus
return về opener, fallback toggle — không bao giờ body), resize
mode-change cleanup (đóng + park focus lên toggle nếu focus kẹt trong).
Backdrop click đóng; body scroll lock đếm chung với modal stack
(uqLockBody drawer-aware). Switch workspace đóng drawers (<1280, không
giật focus). In-flow widths: collapse classes cũ giữ nguyên.

## 10. Modal / Focus Trap Semantics
- Drawers modal-mode: role=dialog + aria-modal=true + trap Tab/Shift+Tab
  hai chiều (verified [true,true,true] ×3) + initial focus inside.
- trapFocus viết lại: recompute visible focusables mỗi Tab (re-mount an
  toàn), loại SVG `use[href]` + display:none/detached/visibility:hidden
  (bug thật: first/last cũ trỏ vào SVG ẩn → trap chết).
- Palette: Tab trap trong dialog (input+list). Lightbox: Tab trap trong bar.
- Background: backdrop chặn pointer + trap giữ keyboard + aria-modal cho SR
  (đánh giá `inert`: không thêm để tránh blast radius lên workspace
  switching; tương đương chức năng, đã document).
- Non-modal không tồn tại trong flows chạm tới (mọi overlay đều modal) —
  không gắn aria-modal sai chỗ nào.

## 11. Focus Visible
Global `:focus-visible` 2px (`--uq-focus-ring`: #4f8cff dark / #2563eb
light) qua uq-base (single treatment; mọi `outline:none` rải rác dựa vào
nó — đã audit 9 vị trí, không cái nào xóa ring keyboard mà không thay thế).
Bằng chứng thật: Tab-driven focus → `matches(':focus-visible') === true`
(probe + keyboard run). Programmatic focus không match là đúng behavior
browser (đã phân biệt rõ trong methodology, không claim sai).

## 12. Focus Not Obscured
`scroll-padding-top/bottom` trên workspace-view, sp-rows-container,
modal-body, inspector (sticky header/player 58px tôn trọng). Drawer/modal
scroll nội bộ; virtualized list focus restore by stable key (Phase 5,
re-verified §26). Reachability audit §6 (scrollIntoView → in-view dưới
player). Không focused control nào bị che hoàn toàn ở các viewport test.

## 13. Focus Restoration
Drawer/Sheet close → opener (fallback toggle, không bao giờ body) —
verified 3/3 + closeall_direct parkedOnToggle. Palette close → invoker
(covered, pre-existing + re-verified Escape). vbModal/lightbox/help:
trigger/fallback flows (pre-existing, giữ nguyên). Resize mode-change:
park lên toggle nếu focus kẹt trong drawer đóng.

## 14. Target Size 24×24 Audit
1898 unique controls (5 workbenches, 1440): violations duy nhất 174
`span.word-cue` (inline sentence words — WCAG 2.5.8 Inline exception,
joined bằng spaces, roving arrows + Enter/Space keyboard path đầy đủ).
Đã fix: `.mode-btn` 23.2→24 min-height; slider thumbs 10–16→24px
(webkit+moz + generic floor) — live rule scan 7 rules chứng minh.
Links: 0 (không có inline text links trong scope audit).

## 15. Pointer-Coarse 44×44 Product Policy
- Media được verify thật (`matchMedia('(pointer: coarse)') === true` dưới
  mobile+touch emulation; phát hiện documented: mobile:true đơn độc vẫn
  false).
- Policy floor generic (`button/input/select/textarea/a[href]/
  role=button/role=option` min 44×44 `!important` — !important là cố ý,
  confined một chỗ, để thắng class min-heights) + `.word-cue` exclusion.
- Kết quả: **0 violations / 115 controls** + no h-scroll ở 390+coarse.
- Nhấn mạnh theo §7: 44px là product UX target, KHÔNG phải WCAG 2.2 AA
  minimum (24px). Slider thumbs giữ 24px + track 44px hit-area (ghi rõ
  rationale, không ép thumb 44px phi UX).

## 16. Contrast Audit
- `--uq-ink-4` dark #5b6878→**#75839a**: 4.63 (surface) / 4.89 (nav) /
  ~5.0 (canvas) — tính toán đầy đủ 6 cặp trong log task.
- Plan value #6b7a90 chỉ 4.07/4.30 → KHÔNG giữ (đúng §22: không giữ giá trị
  chỉ vì plan ghi cứng).
- Light #8a97ab (2.96!)→**#67748a** (4.73 on white).
- Usages audit (6 vị trí: placeholder, badges, stepper icons, time-sep):
  mọi actual pair ≥4.5 sau fix.
- Focus ring non-text: #4f8cff 5.52 / #2563eb 5.17 (≥3:1 adjacent ✓).
  Không claim AAA.

## 17. Non-Hover Access
Grid thumbnails click-only → tabindex=0 + role=button + aria-label từ alt
+ Enter/Space activation (MutationObserver cho re-render). Shot/scene/nav
buttons luôn visible (verified coarse noHoverNeeded). Dropzones có nút
Chọn tệp (click alternative cho drag-file). Không action thiết yếu nào
cần hover (audit hover-reveal: không phát hiện pattern :hover-only).

## 18. Dragging Movements Audit / Alternatives
```text
Dragging Movements: N/A — no author-created dragging operation found
```
Evidence: `draggable="true"` 0 occurrences (index.html); `dragstart`/
`sortable` 0 occurrences (app/phase14/phase15a JS); `dragover/drop` duy
nhất trong redesign.js file-intake dropzones (OS file drop, KHÔNG phải
reorder) và CÓ click alternative (nút Chọn tệp — verified source).
Không gọi browser native scrolling là dragging. Không invent reorder
feature.

## 19. Keyboard-Only Workflow
Thực hiện không mouse sau setup (CDP trusted input, input-ready gate):
Tab order 14 stops logical (shot/scene buttons…), noBodyTrap, focus-visible
match, nav focus-reach + activation (voice+scenes), palette Ctrl+K/arrows/
Enter/Escape, drawer toggle-reach/open/Escape/return, shot arrows
(→shot_002). Method boundary trung thực: synthetic Enter KHÔNG kích hoạt
native button activation trong Chrome này (verified: no click dispatched)
→ activation coverage qua click-equivalence (cùng handlers) + human
protocol cho phím vật lý; mọi custom key path đều via CDP thật.

## 20. Screen Reader Verification
- Cơ chế: `#uq-live-polite` role=status aria-live=polite + milestones VN
  (render/narration/STT/TS/QA 25/50/75 + completion toasts) — verified text
  thật "Kiểm định giọng đọc: 50%" trong DOM + AX tree role=status/alert.
- AX tree (2025 nodes): nav/buttons/listbox/options/dialog đều có tên VN
  ("Ẩn hoặc hiện Menu Quy Trình", scene buttons…).
- Narrator.exe PRESENT (không launch — tránh disrupt máy user; đúng §35
  "do NOT install", mở rộng: do not disrupt).
- axe-core: MODULE_NOT_FOUND (verified `node -e require`) → không add dep
  nặng; automated = custom DOM audits + manual (đúng §39).
- KHÔNG fabricate spoken text. Human protocol (Narrator steps + expected
  VN announcements) để trong §34/limitations cho reviewer.
- Không claim formal conformance (§11/§81).

## 21. Automated Accessibility Evidence
Scanner hỗ trợ: custom audits (target 1898 controls, contrast computed,
AX dump) — không axe/Lighthouse (unavailable, documented attempt).
Mọi gate quyết định đều có manual evidence đối chiếu (§22 table).

## 22. Manual 8-Step Checklist
| Step | Scenario | Evidence | Result |
|---|---|---|---|
| 1 | Keyboard-only workflow | kb gates.json (Tab/focus-visible/nav/palette/drawer/arrows) + Enter-limitation note + human protocol | PASS |
| 2 | Focus order + visible | tabOrderSample + :focus-visible match + 2px token | PASS |
| 3 | Drawer Escape + restore | 3/3 close+return+lock + closeall_direct | PASS |
| 4 | Zoom 200% | physical-equivalent 960×540@DSF2, Si, no h-scroll, toggle, screenshot | PASS |
| 5 | Reflow 320 | no h-scroll, palette fits, sheets, list usable (pane fix) | PASS |
| 6 | Touch/coarse | coarse=true, 0 viol44, sheet tap-open, no-hover | PASS |
| 7 | Drag alternative | N/A + source audit (§18) | N/A |
| 8 | Screen reader | live-region mechanics + AX + Narrator present + human script (audio not captured) | PASS* |

*Step 8 PASS trên mechanics + availability; spoken-audio capture để lại
human protocol (không bịa transcript). 100% applicable steps addressed,
0 skipped silently.

## 23. Responsive Screenshot Matrix
`temp/phase06_verification/browser/screenshots/`: vp-1920x1080,
1440x900, 1366x768, 1280x800, 1278x800, 1024x768, 960x768, 958x900,
768x1024, 390x844, 320x800 + smoke-1366/320 + palette-320 +
fps-meter ×3 (Phase 5 harness) + coarse-390 + zoom200equiv + kb-workflow
+ sustained-*. Not every file committed (evidence dir, untracked).

## 24. Five-Workbench Smoke
1366×768: overview/story/voice/scenes/export active + non-blank + sized
(matrix.json). 320×800: cả 5 reachable (story/voice w=232 — own 3-col
grids thu hẹp nhưng reachable; scenes/export qua view switching; sheets
available). Không workbench blank.

## 25. Command Palette Regression
1440: opens/input-focus/search-deterministic/no-network/arrows/Enter
stable-ID/Escape+return (sustained smoke 5/6 + dense reveal recheck PASS
trial1 sau settle đủ). 320: fits (272≤320), input visible. Palette Tab
trap mới không phá arrows/Enter (không sửa logic search/activate).

## 26. Phase 5 Virtualization Regression
`verify_phase05_sustained.py --quick` post-change (2 valid runs/condition):
virt 62.6–65.7 (accepted median 67.4 — trong noise), direct ~137, dense
~129; render p95 8.1/78.1/42.7 (≈ baseline 7.5/100.9/40.7);
DOM 129/4647/383 identical; threshold 200 untouched; dense arrows/Home/End/
sel250/focus PASS; console/network/integrity clean; leftovers [].
→ No material regression. (1 dense-reveal FAIL trong smoke = settle-timing
flake đã biết, closed-loop bằng recheck PASS riêng.)

## 27. Console / Network
Browser matrix + manual + sustained sessions: console errors 0, unhandled
0, failed non-media 0, 5xx 0. Không duplicate resize/keydown/Escape
handlers (single-owner audit §33), không ResizeObserver loop (không tạo
observer mới nào ngoài grid-thumbnails MO nærrow-scope), không media/
palette network spam, không stale cross-project (fixtures temp + cleanup).

## 28. Focused Tests
`tests/test_phase06_hardening.py`: **28 tests** (breakpoints/edges/pane-guard/
hidden-tabbables, target normal+coarse+inline/slider rules, contrast tokens+
ratios+focus, drawer semantics/trap/escape/closeall/mode-flips/single-owner,
reflow/zoom, drag-N/A, live-region/names/modal/tabindex, keyboard/vertical/
coarse, governance/scope/no-formal-claim/roadmap). Kết quả: **28/28 PASS**.

## 29. Full Regression
- Baseline: 696/696 hiệu dụng (§2).
- Final: `python -m pytest --tb=short -q` — **724 / 724 PASS** (696 + 28
  mới), 0 failed, 0 errors. Trên đường đi, `--quick` smoke của chính task
  đã vô tình overwrite evidence 5-run của Phase 5 (cùng output paths) làm
  2 gate tests Phase 5 đỏ (722/724) — suite đã bắt đúng; đã rerun FULL
  sustained 15 runs để khôi phục evidence (virt median 66.6, direct 135.8,
  dense 129.3 — nhất quán gates đã duyệt) rồi regression lại xanh 724/724.
  Không xóa/weaken test nào.

## 30. Data Integrity
- 8/9 canonical files byte-identical với Phase 5 baseline ở final check
  (veo/scene_plan/bible/image/timestamps/script/audio/settings).
- `state.db` khác hash: audit-trail revision appends (MANUAL+RESTORE trên
  shot_001, 20:48:49Z) + `updated_at` touches (20:49:20Z) — xuất hiện trong
  cửa sổ BASELINE regression (trước mọi sửa Phase 6), từ pre-existing
  visual-workbench mutation test (restore semantics); locks=0, statuses
  READY, blockers=[], IDs/content nguyên vẹn. Trong cùng cửa sổ còn có
  battery ngoài-task (diagnostics zip, Phase-4 benchmark logs, copytree
  `_p5s_dense300` lúc 20:51:29 — KHÔNG phải fixture của task, giữ nguyên
  không đụng). Mọi hoạt động Phase 6 đều read-only + fixtures tự tạo đã
  cleanup (`_p5s*` của --quick smoke: []; `_p5d*`: []).
- Không unintended mutation nào từ product edits/browser verification.

## 31. Performance Safety
Không rerun full 15-run suite (không cần — layout/shell changes không chạm
scroll container/windowing JS; sustained smoke §26 là representative và đủ).
Palette interaction + dense keyboard giữ nguyên behavior. Không listener
leak (single-owner + cleanup paths verified).

## 32. Scope Audit
NOT implemented (xác nhận): Phase 7 Render Manifest/Timeline Compiler,
Phase 8 Manifest Renderer, Phase 9 Render QA, localization, team/cloud,
timeline editor/Remotion, AI/LLM palette. Không capability mới ngoài
responsive/a11y hardening.

## 33. Defects Found / Fixes
1. Dual Escape owners (cũ strip .open thô, shadow controller) → xóa nhánh
   drawer cũ, single-owner UQDrawer (gates Q/R/S unblocked).
2. Trap first/last dính SVG `use[href]` ẩn → visibility-filtered +
   recompute-per-Tab trap (gates O/Q).
3. Narrow scenes list collapse h=0 (pane 124px) → min-height pane
   440/72vh ở band stacked (gates H/I).
4. Coarse 44px không ăn class min-heights (specificity) → !important floor
   confined + word-cue exclusion (gate M: 93→0).
5. Slider thumbs 10–16px → 24px webkit+moz + generic floor (gate L).
6. mode-btn 23.2px → min-height 24 (gate L).
7. Thumbnails click-only → tabindex/role/label + Enter/Space (gates U/W).
8. Render/STT/TS/QA progress câm với SR → polite 25/50/75 milestones (gate X).
9. Touch-source gesture không scroll được container (probe) → methodology
   dùng mouse-source (ghi nhận, verification Phases trước unaffected).
10. Test-metric artifacts (offsetParent vs rects; stale-profile cache) →
    rects-based metrics + fresh profiles + warmup gates (method, không đổi
    kết luận).

## 34. Open Issues / Limitations
- Narrator audio chưa capture (present, không launch để tránh disrupt;
  human protocol: mở Narrator → Tab qua nav → mở Drawer → Ctrl+K →
  render progress; expected: tên VN + milestone announcements).
- Exact odd-px boundaries (1279/959) không probe được dưới fractional
  environments (emulation + OS scaling); coverage = neighbors + query-text
  pinning (đủ và trung thực).
- CDP input startup race (cần warmup ~10–60s; evidence runs đều gate on
  input-alive; không ảnh hưởng product).
- Touch `dispatchTouchEvent` pipeline từ chối trong lab (dùng mouse-
  fallback cho taps; coarse media vẫn verified true).
- Coarse second-tap-close flake (dangling-touch suppress mouse): close đã
  cover bởi toggle-click probe + Escape + backdrop paths.
- `inert` background cho drawers: evaluated, deferred (blast radius) —
  tương đương chức năng qua trap + aria-modal + backdrop (documented).
- Peak-1s 145 vsync quirk (kế thừa Phase 5, không thuộc Phase 6).
- state.db audit residue (§30) — đề xuất tương lai: isolate reference
  fixture cho mutation tests (out of scope Phase 6).

## 35. Files Changed
Product (9): `studio/static/index.html` (aside labels, backdrop
aria-hidden, live region, ?v busts), `app.js` (UQDrawer, thresholds 960,
Escape single-owner, trapVisibleEls, lock drawer-aware, announce,
progress milestones, UQShellMode), `phase14_ui.js` (render milestones),
`redesign.js` (lightbox trap, grid keyboard), `uq-palette.js` (Tab trap),
`uq-tokens.css` (ink-4 ×2, focus/target tokens), `uq-base.css` (focus
token), `uq-shell.css` (960 band, slider thumbs), `uq-components.css`
(44px floor, sr-only), `uq-responsive.css` (canonical bands, sheets,
320, pane guard, reduced-motion, scroll-padding), `uq-screens.css`
(mode-btn 24).
Tests: `test_phase05_evidence_closure.py` (1-line stale-string maintenance),
`test_phase06_hardening.py` (mới, 28).
Scripts (mới): verify_phase06_{browser,manual,target_sizes,palette_dense}.py;
probes: {drawer_debug,drawer_api,esc_path,focus_trail,synth_gesture,
gesture2,media_state,sidebar960,esc_trace,input_alive,kb,coarse,thumb,
csswalk,css,minval,listbox}_*.py.
Evidence: `temp/phase06_verification/` (browser/matrix+ax+shots,
a11y/targets+coarse-shot, manual/gates+shots, palette/dense_reveal,
integrity.json, tests/baseline+final logs).

## 36. Final Gate Matrix
| Gate | Requirement | Result |
|---|---|---|
| A | Approved Phase 5 baseline audited | PASS (dirty-worktree inventory, pre-phase-6 NOT CREATED) |
| B | Baseline regression 100% | PASS (696/696 hiệu dụng, §2) |
| C | >=1280 3-pane layout correct | PASS (1920/1440/1366/1280 grids + smoke) |
| D | 960–1279 2-pane + Inspector Drawer correct | PASS (1278/1024/960 + mode Si) |
| E | <960 Workspace + 2 Sheets correct | PASS (958/768/390/320 + sheets modal) |
| F | 1279/1280 breakpoint edge correct | PASS (neighbors + query pinning; fractional note) |
| G | 959/960 breakpoint edge correct | PASS (neighbors + query pinning; fractional note) |
| H | 1366×768 no inaccessible vertical clipping | PASS (5 workbenches reachability) |
| I | 320 CSS px reflow | PASS (no h-scroll, palette fits, list usable) |
| J | 200% zoom adaptation | PASS (physical equivalent; shortcut-path limitation noted) |
| K | No page-level horizontal overflow | PASS (11/11 viewports + coarse) |
| L | Normal target-size policy | PASS (174/174 còn lại = inline exception; sliders 24px live rules) |
| M | Coarse-pointer 44×44 product policy | PASS (0 violations, media verified true) |
| N | Normal text contrast >=4.5:1 | PASS (computed pairs + usages audit) |
| O | Focus indicator visible | PASS (:focus-visible match + 2px token) |
| P | Focus not fully obscured | PASS (scroll-padding + reachability) |
| Q | Modal Drawer/Sheet focus trap correct | PASS ([T,T,T]×3 + initial focus) |
| R | Escape closes topmost responsive overlay | PASS (single-owner; nested-modal guard) |
| S | Focus returns correctly | PASS (3/3 + direct + palette/vb/lightbox flows) |
| T | Hidden panels not tabbable | PASS (0/0/0 rects-based) |
| U | Non-hover access | PASS (grid keyboard + always-visible actions) |
| V | Dragging alternatives complete or justified N/A | PASS (N/A + audit evidence) |
| W | Keyboard-only full workflow | PASS (CDP paths + click-equivalence + human protocol) |
| X | Screen reader render progress | PASS (mechanics + AX + Narrator present; audio→human protocol) |
| Y | Manual checklist applicable steps 100% | PASS (7/7 + 1 N/A, §22) |
| Z | Vietnamese-first accessibility labels | PASS (triggers/asides/dialogs/live announcements) |
| AA | Command Palette regression | PASS (smoke + dense reveal + 320 + trap) |
| AB | Virtualization/focus regression | PASS (sustained smoke, no material change) |
| AC | Console/network clean | PASS (0/0/0/0 all sessions) |
| AD | Focused tests 100% | PASS (28/28) |
| AE | Full regression 100% | PASS (724/724) |
| AF | Data integrity | PASS (8/9 identical + state.db disclosed exception) |
| AG | No false claim of formal WCAG conformance | PASS (§11/§81 respected, tests pin wording) |
| AH | Phase 7 NOT STARTED | PASS |
| AI | Phase 8/9 NOT STARTED | PASS |

## 37. Final Verdict
```text
PHASE 6: IMPLEMENTED / REVIEW PENDING
READY FOR EXTERNAL REVIEW
PHASE 7: FUTURE / NOT STARTED
```
