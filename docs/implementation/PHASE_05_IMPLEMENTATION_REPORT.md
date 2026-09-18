# PHASE_05_IMPLEMENTATION_REPORT.md
# BÁO CÁO TRIỂN KHAI PHASE 5 — UI POLISH, COMPONENT CONSOLIDATION & VIRTUALIZATION

> Phase: 5
> Date: 2026-09-17
> Branch: main
> HEAD: af5274a (không commit trong task — worktree dirty được inventory, không tag giả)
> Baseline: 634 / 634 PASS
> Final regression: 652 / 652 PASS (634 + 18 contract tests mới, 0 failed, 0 errors)
> Verdict: PHASE 5: IMPLEMENTED / REVIEW PENDING — READY FOR EXTERNAL REVIEW — PHASE 6: NOT STARTED

## 1. Executive Summary

Phase 5 hoàn thành cả 3 mục tiêu bằng evidence: (A) 7 primitives có contract rõ ràng — module JS dùng chung mới (`uq-primitives.js`: empty/error/badge/checkRow) với consumers thật (export preflight, phase14 states, palette), CSS primitive mới (check-row, virtual spacers, palette), các primitive còn lại được định nghĩa contract + giữ implementation hiện hữu có lý do ghi rõ (không fake consolidation); (B) virtualization evidence-based cho Scene Navigator — lazy-mount luôn bật + windowing từ 200 groups, render p95 41.1ms→6.0ms trên fixture 579 scenes/1641 shots, DOM rows 2220→27, FPS headless ngang direct (63 vs 62), keyboard/focus/selection bảo toàn qua 14 scenario checks; (C) Command Palette Ctrl+K — fuzzy search local (Scene/Shot/Character), không network/keystroke, không LLM, keyboard contract đầy đủ, navigate đúng stable ID (kể cả visual-bible modal), 13/13 scenario checks. Full regression 652/652, browser 3 viewports PASS, reference data nguyên vẹn.

## 2. Git / Baseline Audit
- main @ af5274a; tags tới pre-phase-3c. `pre-phase-5`: NOT CREATED — approved baseline nằm trong dirty worktree đã inventory (3C/3D/4C source + reports, docs-cleanup deletions, evidence dirs); không commit (chưa được yêu cầu), không tag giả, Phase 5 files tách biệt rõ.
- Baseline: 634/634 PASS (log `temp/phase05_verification/tests/baseline_pytest.log`).

## 3. Source / UI Duplication Audit
- CSS đã consolidate tốt từ trước (`uq-components.css`: .btn/.empty-state/.overview-empty/.alert/.stage-card/status classes/tokens, 121 rules) — Phase 5 không claim lại công này.
- Duplication thật còn lại: (1) empty/error HTML builders (phase14 helpers vs ~40 inline app.js sites), (2) status-badge mapping ternaries rải rác, (3) preflight rows (export vs production/validation cards), (4) escapeHtml copy, (5) collapsed shot trees mount 2000+ hidden buttons, (6) không có palette/search tập trung.
- IDs/classes/handlers/state deps được giữ nguyên (không đổi contract hiện hữu); migration risk cao nhất (app.js 9000 dòng) được xử lý bằng delegate-một-chỗ thay vì rewrite.

## 4. Shared Component Architecture
- Vanilla JS, không framework/build system/dependency mới. 3 file mới với lý do ghi rõ (không nhồi app.js thêm): `uq-virtual-list.js` (windowing engine thuần, testable), `uq-primitives.js` (render helpers dùng chung), `uq-palette.js` (feature palette khép kín). Load order: virtual-list → primitives → palette → app (contract test).
- Không React/Vue/Web Components framework, không over-engineer.

## 5. UQ-Workbench-Shell
- Contract = hiện hữu: `.workspace-view.active` + `switchWorkspace`/`Phase14.handleWorkspaceSwitch` + readiness `aria-live` pattern. Phase 5 không tạo shell mới; palette activation reuse `switchWorkspace` (consumer). Không hardcode layout Phase 6.

## 6. UQ-Shot-Card
- Contract = hiện hữu: `.visual-shot-tree-btn[data-shot-id]` + `visualSceneGroupHtml` (shot_id/scene_id, aria-pressed, status/freshness/lock badges, route badge, keyboard). Phase 5 bảo toàn identity (stable IDs; index chỉ tính range nội bộ) + lazy-mount + windowing; không mutate Shot khi render; không merge Scene/Shot semantics.

## 7. UQ-Inspector-Entity
- Contract = hiện hữu: `.vw-binding-item` + VB entity cards + `selectVisualBibleEntity(tab, entityId)` (stable IDs, không bind display name). Phase 5 không viết lại VB; palette reveal entity qua modal/tab API có sẵn, không mutate.

## 8. UQ-Unified-Transport
- Contract được định nghĩa, KHÔNG consolidate code (exception có lý do): audio player, native video previews, voice chunk buttons có behaviors khác nhau; playback rate ≠ TTS generation speed (không merge hai concept); Voice 3B frozen; không network trong playback tick. Không phá behavior nào (browser smoke).

## 9. UQ-Media-Grid
- Contract = hiện hữu: `.vb-ref-card` + referenceAssets + thumbnail-first (Phase 4) + master fallback. Phase 5 giữ nguyên (không request storm — lazy img; không auto-generate on render; fallback intact, browser-verified).

## 10. UQ-Transcript-Cues
- Contract được định nghĩa (chunk_id, word timestamps, playhead/selection, QA behavior preserved). KHÔNG windowing (đúng §48: chưa có bottleneck evidence; không virtualize vì checklist).

## 11. UQ-Preflight-Checklist
- Presentation primitive MỚI dùng thật: `UQ.checkRow` + `.uq-check-row` (label/state/message/action/severity) — consumer: export readiness rows (migrated, bỏ inline styles). Business rules ở yên backend (không rule thứ hai trong frontend).

## 12. Consolidation Matrix
| Primitive | Consumers | Removed Duplication | Exceptions |
|---|---|---|---|
| Workbench-Shell | palette activation, all workbenches | — (đã chuẩn) | Không tạo shell mới |
| Shot-Card | navigator (lazy+windowed) | 2138 hidden buttons trên fixture lớn; 220→82 rows trên reference | Markup giữ nguyên |
| Inspector-Entity | palette character reveal | — | Không rewrite VB |
| Unified-Transport | audio/video/voice players | — (không consolidate) | Behaviors khác nhau; 3B frozen |
| Media-Grid | vb ref cards | — | Giữ Phase 4 behavior |
| Transcript-Cues | voice cues | — (không windowing) | Chưa có bottleneck evidence |
| Preflight-Checklist | export rows | inline styles → shared class | Production/validation cards giữ (blast radius) |
| Cross-cutting | UQ.empty/error/badge/esc | phase14 delegates + palette esc | app.js inline sites giữ (blast radius, ghi rõ) |

## 13. Performance Baseline
- Reference 79/141: render p50 4.2 / p95 6.4ms; DOM 10659 nodes / 220 rows; select p50 ~23ms; key ~1-4ms (harness round-trip).
- Synthetic 179/441: p50 10.8 / p95 16.0ms; DOM 16k / 620 rows.
- Synthetic 579/1641 (direct): p50 33.1 / p95 41.1ms; DOM 37k / 2220 rows (trong đó collapsed-hidden).
- Methodology + artifacts môi trường: `temp/phase05_verification/performance/{methodology.md,baseline.json,big300.json,big1500_virtualized.json}`.

## 14. Large Dataset Fixture
- Generator `scripts/make_large_fixture.py`: clone reference + nhân scenes/shots template (stable IDs mới, referential integrity qua 4 JSON). 100 scenes→179/441; 500→579/1641. Temp-only, đã cleanup (verified 0 `_p5*` sót). Không media nặng, không mutate reference.

## 15. Virtualization Design
- Lazy-mount (luôn bật): collapsed trees không mount shot buttons (display:none cũ) — cùng visible UI.
- Windowing (groups > 200): exact offset layout (header đo thật + shot rows đo thật, không avgH drift), spacers pixel-chính-xác, overscan 300px, scroll listener single/passive/rAF (chỉ render khi window đổi), pin một lần cho ensure, focus restore theo stable key.
- Identity: scene_id/shot_id khắp selection/mutation/navigation/palette; index chỉ tính range.
- Không clone dataset vào hidden DOM (unmounted = không tồn tại).

## 16. Threshold Analysis
- Candidate 30 chỉ là điểm xuất phát. Đo: 441 rows→16ms, 1641 rows→41ms (knee tiệm cận 50ms quanh ~2000 rows).
- Final: `VIRTUALIZATION_THRESHOLD_GROUPS = 200` (conservative, trước knee xa; production 79 scenes giữ behavior byte-identical ở nhánh direct).
- Evidence: `temp/phase05_verification/performance/threshold_analysis.json`. Nếu evidence không đủ đã giữ disabled — nay đủ.

## 17. Virtualization Performance Results
- 579/1641: render p50 5.3 / p95 6.0ms (từ 33.1/41.1 — thắng ~7×); DOM rows 2220→27; nodes toàn trang 37k→24k.
- Scroll FPS headless: virtualized 63 vs forced-direct 62 (parity — không regression scroll; software raster, không vsync-anchored, đã document).
- Per-frame JS ~5ms « budget 16.7ms@60fps (phần còn lại là raster môi trường).

## 18. Keyboard / Focus Preservation
- Roving tabindex KHÔNG áp dụng (pattern hiện tại là button-focus trong disclosure groups, không phải listbox-active-descendant — không fake role).
- ArrowUp/Down/Home/End + qua window boundary (scroll + focus target ổn định) + Enter/Space native; Shot 1→100+ verified; focus restore sau re-render; selection nằm ngoài DOM (module vars + detail panel), scroll-away/remount giữ nguyên.

## 19. Command Palette Architecture
- Index từ lightweight slices đã load (scenes + shot_ids + bible characters) — rebuild mỗi lần mở (không stale cross-project); không endpoint mới; không fetch/keystroke (verified 96→96 requests khi gõ).
- Fuzzy deterministic: exact > substring > token-prefix > subsequence; ranking ổn định (verified 2 runs giống nhau); case/whitespace-insensitive.

## 20. Command Palette Keyboard Contract
- Ctrl+K (và Meta+K) mở/toggle; gõ để lọc; ArrowUp/Down di chuyển active (verified opt-0→opt-1); Enter kích hoạt; Escape đóng + focus trả về invoker (verified scene_001→scene_001); tôn trọng `defaultPrevented` và IME composition; không hijack text-editing keys.

## 21. Scene Search
- Query tên/index/category → kết quả type Cảnh, label "Cảnh N (scene_id)" + context; Enter: mở Visual Workbench + chọn shot đầu (đúng behavior click scene header hiện hữu).

## 22. Shot Search
- Query ID → "Cảnh quay {id}" + parent context; Enter: `selectVisualShot(shot_id, scene_id)` (verified shot_001 card); target virtualized được scroll+mount qua `ensureVisualShotVisible` (verified shot_1600).

## 23. Character Search
- Query tên/species/ID → "Nhân vật" + entity context (verified 'habilis' → Nhân vật, kể cả V2 characters); Enter: mở Visual Bible modal + `selectVisualBibleEntity('subjects', entityId)` (verified modal mở), không bind/mutate.

## 24. Project Switching / Async Safety
- Palette rebuild index mỗi lần mở (theo project hiện tại) — không stale cross-project (test logic + scenario). Scroll listener single; không duplicate poll; không leak observer (không dùng observer mới).

## 25. Vietnamese-first / Accessibility Basics
- Palette: Tìm nhanh / Cảnh / Cảnh quay / Nhân vật / Không tìm thấy kết quả; IDs kỹ thuật chỉ secondary text; dialog+combobox/listbox semantics đúng (`aria-expanded/controls/activedescendant`, role=option); không ARIA thừa; không raw enum; focus visible (native outline kế thừa). Không claim WCAG AA.

## 26. Focused Tests
- `tests/test_phase05_consolidation.py`: 18/18 PASS (module contracts, threshold evidence, CSS, load order, consumers, Vietnamese, no-regression guards, Phase 7/8/9 absence).

## 27. Browser Validation
- Reference (below threshold — direct path + lazy mount): 1920/1440/1366 usable, 79 groups, 0 spacers (không windowing giả), 5-workbench smoke non-blank, select/keyboard/dirty intact, palette open/search/close, console/network sạch, reference untouched.
- Fixture 579/1641: 14/14 scenario checks (select far/preserve/remount/boundary/Home/End/filter/no-mutation/no-preload/no-errors) + FPS parity.
- Screenshots: `temp/phase05_verification/browser/screenshots/` (3 viewports + palette open).
- Evidence: `temp/phase05_verification/{performance,virtualization,palette,browser}/`.

## 28. Console / Network
- 0 console errors, 0 unhandled rejections, 0 failed XHR phi-media, 0 5xx trên mọi run. Không palette network spam (request count bất biến khi gõ), không detail preload storm (≤4 URLs), không thumbnail storm (không auto-gen), không stale cross-project.

## 29. Full Regression
- `python -m pytest --tb=short -q`: **652 / 652 PASS, 0 failed, 0 errors** (~3min). Baseline 634 + 18 mới. Không xóa/sửa test cũ.

## 30. Data Integrity
- Reference: veo/audio hash trước/sau browser khớp; không save/mutation nào (palette + navigation chỉ đọc). Fixtures + profiles tạm dọn sạch. Không hardcode counts vào production (threshold là hằng số UI đã document, không phải business rule).

## 31. Performance Evidence
- Không bịa SLA: số liệu quan sát + methodology + limitations (first-request penalty, headless raster, machine variance) đều ghi rõ. Không claim 15KB/60fps/instant.

## 32. Scope Audit
- NOT implemented: Phase 6 (responsive rewrite/drawer/sheets/320px/zoom/target-size/contrast/NVDA/full WCAG — chỉ giữ CSS hiện hữu + fix tối thiểu 0), Phase 7 (manifest/compiler/IR), Phase 8 (manifest renderer/NVENC architecture — renderer giữ libx264), Phase 9 (QA framework), AI/LLM palette, localization, team/cloud, timeline editor. `render_from_manifest` absent (contract test).

## 33. Defects Found / Fixes
1. Helpers kẹt scope trong render → ReferenceError (bắt bởi CDP) → hoist ra workbench scope.
2. Scroll re-render làm mất focus → skip-render khi window không đổi + focus restore theo stable key.
3. Scroll-drift unmount selection (avgH đơn) → exact offset layout + loại bỏ selected-union (vốn phình window tới 574 groups và kéo FPS 63→31).
4. Stale profile cache app.js → bump `?v=5.0` (+ README cho reviewer: đổi query khi sửa static).
5. Harness: audio-startup pollution, first-request penalty, warmup/settle (documented, không đổ lỗi product).

## 34. Open Issues / Limitations
- Select end-to-end variance cao theo tải máy (API-level 69ms vs browser 80–1100ms) — ngoài scope Phase 5 (backend selective-loading), ghi nhận trung thực.
- Headless FPS không vsync-anchored — parity + JS budget là evidence chính.
- Transcript-Cues/Transport/Media-Grid/Inpector là contract-doc, chưa consolidate code (lý do §12).
- Không tag `pre-phase-5` (worktree dirty, policy no-commit).

## 35. Files Changed
- Mới: `studio/static/uq-virtual-list.js`, `uq-primitives.js`, `uq-palette.js`, `tests/test_phase05_consolidation.py` (18), `scripts/{verify_phase05_performance,verify_phase05_virtualization,verify_phase05_palette,verify_phase05_browser,make_large_fixture}.py`, evidence dirs, report này.
- Sửa: `studio/static/app.js` (navigator lazy+windowed, keyboard mở rộng, palette hooks — 3C behavior giữ), `phase14_ui.js` (delegate UQ + checkRow), `index.html` (3 script tags + cache-bust v5.0), `uq-components.css` (check-row/palette/spacer classes), `ROADMAP_STATUS.md` (2.5.1).
- Không chạm: domain/backend/schema, renderer, Phase 7/8/9, responsive architecture.

## 36. Final Gate Matrix
| Gate | Requirement | Result |
|---|---|---|
| A | Approved Phase 4 baseline audited | PASS (HEAD + inventory, no fake tag) |
| B | Baseline regression 100% | PASS (634/634 + log) |
| C | 7 primitive contracts exist | PASS (module/CSS/API contracts) |
| D | Real consumers / documented exceptions | PASS (§12 matrix) |
| E | UI duplication materially reduced | PASS (hidden-DOM + shared helpers/CSS) |
| F | No domain/API behavior regression | PASS (652 + browser) |
| G | Performance baseline measured | PASS (3 sizes, p50/p95) |
| H | 250+ shot fixture valid | PASS (579/1641, integrity, cleaned) |
| I | Candidate threshold evaluated with evidence | PASS (30→measured curve) |
| J | Final threshold evidence-based | PASS (=200, rationale) |
| K | Mounted DOM bounded under virtualization | PASS (2220→27 rows) |
| L | Selection preserved across unmount/remount | PASS (scenarios) |
| M | Scroll position preserved appropriately | PASS (save/restore + tests) |
| N | Arrow keyboard crosses window boundaries | PASS (scenario) |
| O | Focus remains valid/visible | PASS (restore-by-key + scenarios) |
| P | Render p95 <= 50ms | PASS (6.0ms virtualized; 41.1 direct documented) |
| Q | Fast-scroll FPS >= 55 | PASS* (63 virtual vs 62 direct headless; *limitation documented §17/§31) |
| R | Ctrl+K palette opens | PASS |
| S | Scene fuzzy search works | PASS |
| T | Shot fuzzy search works | PASS |
| U | Character fuzzy search works | PASS |
| V | Enter navigates by stable ID | PASS (shot+scene+character/modal) |
| W | Escape/focus return correct | PASS |
| X | No LLM/network search in palette | PASS (96→96 requests, local fuzzy) |
| Y | Vietnamese-first UI | PASS |
| Z | Browser 3 viewports usable | PASS (screenshots) |
| AA | Console/network clean | PASS (0/0/0/0) |
| AB | Full regression 100% | PASS (652/652) |
| AC | Data integrity | PASS (hashes + cleanup) |
| AD | Phase 6 NOT implemented | PASS (no responsive rewrite) |
| AE | Phase 7/8/9 NOT implemented | PASS (contract tests) |

## 37. Final Verdict
```text
PHASE 5: IMPLEMENTED / REVIEW PENDING
READY FOR EXTERNAL REVIEW
PHASE 6: NOT STARTED
```
(KHÔNG tự PASS/FINAL — chờ external review. Lưu ý reviewer: gate Q PASS trên parity headless + JS budget; hardware-vsynced FPS cần browser thật để re-confirm nếu muốn.)
