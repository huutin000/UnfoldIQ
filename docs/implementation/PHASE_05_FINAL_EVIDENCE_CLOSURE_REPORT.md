# PHASE_05_FINAL_EVIDENCE_CLOSURE_REPORT.md
# BÁO CÁO ĐÓNG EVIDENCE CUỐI PHASE 5 — CORRECTIVE FINAL EVIDENCE CLOSURE

> Phase: 5
> Generated at: 2026-09-17T20:05:45+07:00
> Branch: main
> HEAD: af5274a12ff65cbae4dc7b1ab34b63e5484441f8
> Product source changed: NO
> Baseline regression: 661 / 661 PASS
> Final regression: 680 / 680 PASS (661 + 19 evidence-closure tests mới)
> Verdict: PHASE 5: CONDITIONAL PASS — FRAME-PRESENTATION FPS GATE NOT VERIFIED AT 55 / Phase 5 stays IMPLEMENTED / REVIEW PENDING — PHASE 6: NOT STARTED

## 1. Executive Summary

Corrective closure theo external review: (1) rollback governance premature
(`ROADMAP_STATUS.md` Phase 5 `PASS/FINAL/VERIFIED` → `IMPLEMENTED/REVIEW
PENDING` trước mọi evidence mới); (2) thay primary FPS metric từ
`requestAnimationFrame()` sang Chrome DevTools compositor
frame-presentation evidence thật (`Display::FrameDisplayed` làm canonical
presented signal, phân loại dropped/skipped/partial từ `cc`/`viz` trace —
Preferred C, validated parser, không suy diễn từ generic Swap/rAF);
(3) dense 300-shot fixture có **FPS runs riêng** (5 runs, không suy từ
fixture lớn); (4) audit timestamp (report cũ date 2026-09-18 là future-date
so với review 2026-09-17 — ghi rõ, report này dùng 2026-09-17+07:00);
(5) report cũ `PHASE_05_FINAL_CLOSURE_REPORT.md` giữ nguyên làm historical
evidence, không overwrite.

Kết quả trung thực trên 15/15 headed runs hợp lệ: compositor present theo
nhu cầu (on-demand) — **~13–14 presented frames / ~4s fast-scroll run
(median FPS 3.2–3.5 window+active, peak-1s 8–10), 0 partial, scheduler-level
non-production chiếm đa số là skip đúng (kNoDamage ~70/run), 0 dropped wheel
input**. Ngưỡng presented-FPS >= 55 **không đạt được theo thiết kế**
(compositor bỏ qua đúng các vsync không có damage) → gates J/K = FAIL →
verdict CONDITIONAL PASS, roadmap **giữ REVIEW PENDING, KHÔNG promote**.
Mọi gate khác PASS: render p95 virtualized 8.9ms / dense 41.7ms (<=50),
DOM 4647→129 nodes, dense keyboard/selection/focus đầy đủ (incl. Home/End),
palette 9/9 hiệu dụng, console/network 0, regression/integrity sạch,
Phase 6/7/8/9 NOT STARTED.

## 2. Governance Correction

- Premature state trước task: `ROADMAP_STATUS.md` Rev 2.5.2 ghi Phase 5
  `PASS / FINAL / VERIFIED` trong khi final evidence gate (rAF-primary,
  dense thiếu FPS riêng, report date 2026-09-18 sau ngày review 2026-09-17)
  chưa hoàn tất.
- Reason for temporary rollback:
  External review found final evidence gate incomplete.
- Hành động: trước mọi evidence mới, roadmap đã rollback về
  `Phase 5 = IMPLEMENTED / REVIEW PENDING`, `Phase 4 = PASS / FINAL /
  VERIFIED` (giữ), `Phase 6 = NOT STARTED` (Rev 2.5.2-rollback).
- Final sync rule (§24 prompt): chỉ promote Phase 5 về PASS/FINAL/VERIFIED
  sau khi toàn bộ final gates PASS. Vì gates J/K FAIL (xem §8/§11),
  roadmap **kết thúc task ở IMPLEMENTED / REVIEW PENDING** (Rev 2.5.3,
  conditional) — không promotion sớm.

## 3. Git / Worktree Audit

- Branch `main`, HEAD `af5274a12ff65cbae4dc7b1ab34b63e5484441f8`
  (`af5274a docs(3C): add implementation report, ...`).
- Pre-existing dirty worktree được bảo toàn toàn bộ (deletions docs-cleanup,
  Phase 3/3D/4/5 product changes, untracked reports/evidence/scripts —
  danh sách đầy đủ: 17 deleted/modified tracked + ~60 untracked, xem log
  task; KHÔNG `git clean -fd/reset`, không restore, không fabricate/move
  tags, không commit khi chưa yêu cầu).
- Task này tạo/sửa: `scripts/verify_phase05_frame_evidence.py` (mới, harness
  chính), `scripts/verify_phase05_followup.py` (mới, Home + palette-Enter
  hiệu chỉnh), `scripts/probe_frame_{events,steps,raw}.py` (mới, công cụ
  discovery taxonomy — precedent như probe_* của closure trước),
  `tests/test_phase05_evidence_closure.py` (mới, 19 tests),
  evidence `temp/phase05_evidence_closure/`, `ROADMAP_STATUS.md`
  (2.5.2 → 2.5.2-rollback → 2.5.3 conditional), report này (mới).
- Report cũ `PHASE_05_FINAL_CLOSURE_REPORT.md`: **giữ nguyên** (historical).

## 4. Timestamp / Timezone Audit

- System: `2026-09-17T20:05:45+07:00`, timezone `SE Asia Standard Time`
  (UTC+07:00, `tzutil /g`), epoch tương ứng.
- External review date 2026-09-17: khớp system date. Old report
  `Date: 2026-09-18`: **future-date (~+1 ngày)** — ghi nhận là typo/không
  hợp lệ, không dùng cho bất kỳ verdict nào; mọi evidence mới stamp
  `2026-09-17T...+07:00` (frame evidence `generated_at`
  `2026-09-17T19:59:39.781069+07:00`, report này `2026-09-17T20:05:45+07:00`).
- Focused tests pin định dạng ISO-8601 + timezone cho evidence + report.

## 5. Previous FPS Evidence Limitation

- Report cũ dùng rAF là primary: median 144.0 FPS cả hai modes. rAF chỉ là
  callback trước repaint, đi theo refresh rate — **không phân biệt**
  successfully rendered / partially presented / dropped frames.
- Report cũ đếm generic `Swap` (75–338/run, đa-surface) rồi suy presentation
  — không chấp nhận cho final gate.
- rAF được giữ làm **supporting/historical metric** (số liệu cũ giữ nguyên
  trong report cũ); task này **không re-measure rAF, không dùng rAF cho bất
  kỳ verdict nào**.
- Phát hiện thêm khi probe: CDP `Performance.getMetrics` field `Frames`
  đếm iframe nodes (sample = 4), KHÔNG phải presented frames — đã loại khỏi
  methodology (tránh misuse).

## 6. Chrome / GPU Environment

- Headed Chrome visible: YES (`--window-size=1440,900`, NO `--headless`,
  NO `--disable-gpu`), `Chrome/153.0.8010.48`
  (`Mozilla/5.0 (Windows NT 10.0; Win64; x64) ... Chrome/153.0.0.0`).
- OS: Microsoft Windows 11 Home Single Language, 10.0.26200.
- GPU: Intel UHD Graphics + NVIDIA RTX 3050 Laptop; `gpu_compositing:
  enabled`, `rasterization: enabled` (CDP `SystemInfo.getInfo`).
- Viewport 1440x900, devicePixelRatio **1.25** (khác DPR 1 của closure trước
  — ghi rõ; không ảnh hưởng kết luận vì gates là tương đối + threshold).
- Vsync cadence từ trace (`Scheduler::BeginFrame interval_us` mode = 6944µs
  mọi run): **144.0 Hz** — environment context, không phải verdict.
- Evidence: `temp/phase05_evidence_closure/performance/environment.json`.

## 7. Primary Frame Evidence Methodology

Preferred C — validated CDP tracing parser (`parse_frame_evidence`,
unit-tested với synthetic traces), categories
`devtools.timeline,cc,viz,benchmark,gpu,disabled-by-default-devtools.timeline.frame`
(đã probe 3 vòng để xác lập taxonomy thật, không đoán):

- **presented (canonical)**: `Display::FrameDisplayed` timestamps
  (compositor-confirmed display). Fallback đã định nghĩa
  (`Graphics.Pipeline STEP_SWAP_BUFFERS_ACK|FINISH_BUFFER_SWAP`) — **không
  run nào phải dùng fallback** (15/15 có FrameDisplayed).
- **dropped (scheduler-level)**: `Scheduler::BeginFrameDropped` +
  `DidNotProduceFrame[kRecoverLatency]`. Báo cáo đúng bản chất: đây là
  tín hiệu flow-control/skip của cc scheduler, KHÔNG đồng nhất với
  "user thấy khung hình đứng" — không có bằng chứng present trễ/thiếu
  nào đi kèm (partial = 0, wheel inputs đủ 100%).
- **skipped đúng (không phải drops)**: `DidNotProduceFrame[kNoDamage]` +
  `EarlyOut_NoUpdates` (compositor bỏ qua đúng vsync không có damage).
- **partial**: `PipelineReporter frame_reporter` có `has_high_latency` hoặc
  `has_missing_content` (proxy trung thực; quan sát = 0/15 runs, trong khi
  100+ frame_reporter events có mặt — nguồn có phát tín hiệu nhưng không
  có frame nào bị flag).
- **cross-check only (đa-surface)**: generic `Swap` — chỉ đối chiếu.
- **FPS primary**: `presented_count / wall_s` (window) + active fast-scroll
  window (trace-clock `[first_wheel, last_wheel+400ms]`, pre-registered) +
  `peak-1s` (tương đương DevTools FPS-meter). Gate J/K đánh trên median
  **active** (FPS trong lúc fast-scroll thật), window + peak báo cáo kèm.
- **Real input**: 16 wheel flings/run (10 down −700 + 6 up +700, 250ms
  spacing) qua `Input.dispatchMouseEvent mouseWheel + pointerType=mouse`;
  `dropped_wheel_inputs` đếm resilient (timeout → đếm, không treo run);
  `InputLatency::MouseWheel` trace events (64/run) chứng minh input tới
  compositor. In-page EventTiming `event` entries trả về `[]` → wheel
  EventTiming ghi **NOT AVAILABLE** (không bịa); trace MouseWheel X-events
  không mang `dur` → wheel trace latency cũng **NOT AVAILABLE**.
- Cùng browser/machine/viewport/build/input cho 15 runs; 5 runs/condition;
  không cherry-pick (mọi run hợp lệ đều báo cáo).

## 8. Large Virtualized Results (579 scenes / 1641 shots, threshold 200)

| run | presented | fps_win | fps_act | peak-1s | bfdrop | recover | nodamage | gapmax_ms | long>50 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 14 | 3.5 | 3.3 | 10 | 31 | 12 | 78 | 250.1 | 6 |
| 2 | 13 | 3.2 | 3.1 | 10 | 28 | 13 | 72 | 243.2 | 5 |
| 3 | 14 | 3.5 | 3.3 | 10 | 28 | 11 | 74 | 243.1 | 5 |
| 4 | 14 | 3.5 | 3.3 | 9 | 31 | 12 | 78 | 875.2 | 6 |
| 5 | 13 | 3.2 | 3.1 | 9 | 26 | 11 | 67 | 243.1 | 5 |

- Median: fps_win **3.5** (min 3.2), fps_act **3.3** (min 3.1), peak-1s **10**.
- Partial: 0/5 runs. Wheel inputs dropped: 0/5. `wheel_trace_events` 64/5.
- Render p50/p95: **5.7 / 8.9ms** (<=50 PASS). DOM: 14 groups / 129 nodes /
  17 buttons (bounded — xem §10).
- Raw: `frame_runs.json` (+`.csv`), `render.json`.

## 9. Large Direct Results (same fixture, threshold 1000000)

| run | presented | fps_win | fps_act | peak-1s | bfdrop | recover | nodamage | gapmax_ms | long>50 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 13 | 3.2 | 3.1 | 9 | 30 | 12 | 77 | 243.5 | 5 |
| 2 | 14 | 3.5 | 3.3 | 10 | 32 | 14 | 78 | 250.1 | 5 |
| 3 | 13 | 3.2 | 3.1 | 8 | 29 | 11 | 74 | 1569.7 | 6 |
| 4 | 14 | 3.5 | 3.3 | 10 | 30 | 12 | 76 | 243.3 | 5 |
| 5 | 14 | 3.5 | 3.3 | 10 | 27 | 11 | 68 | 243.4 | 5 |

- Median: fps_win **3.5** (min 3.2), fps_act **3.3** (min 3.1), peak-1s **10**.
- Partial: 0/5. Wheel dropped: 0/5.
- Render p50/p95: **59.3 / 73.6ms** (>50 — direct vượt ngưỡng, đúng lý do cần
  virtualization). DOM: 579 groups / 4647 nodes / 582 buttons.

## 10. Direct vs Virtualized Comparison (same fixture/environment)

| metric | virtualized | direct |
|---|---|---|
| presented FPS median (win/act/peak-1s) | 3.5 / 3.3 / 10 | 3.5 / 3.3 / 10 |
| partial frames (5 runs) | 0 | 0 |
| scheduler non-production/run (drop/skip) | ~41 / ~74+33 | ~42 / ~75+33 |
| render p95 | **8.9ms** | 73.6ms |
| DOM nodes (navigator) | **129** | 4647 |
| wheel inputs dropped | 0 | 0 |

Virtualization: parity presentation tuyệt đối (không regress scrolling khả
kiến, không tạo jank mới — partial 0 cả hai), giữ lợi ích DOM (36x) và
render-time (8x). Trình bày sparse (~1 present/wheel-fling, gap ~243–250ms
khớp spacing 250ms) là hành vi on-demand đúng của compositor, giống hệt ở
cả hai modes.

## 11. Dense 300-Shot Frame Results (scene_900 × 300, OWN runs)

| run | presented | fps_win | fps_act | peak-1s | bfdrop | recover | nodamage | gapmax_ms | long>50 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 12 | 3.0 | 2.9 | 8 | 30 | 12 | 77 | 250.1 | 5 |
| 2 | 14 | 3.5 | 3.3 | 9 | 28 | 12 | 69 | 243.3 | 5 |
| 3 | 14 | 3.5 | 3.3 | 10 | 28 | 11 | 72 | 249.7 | 5 |
| 4 | 14 | 3.5 | 3.3 | 10 | 31 | 12 | 78 | 243.3 | 5 |
| 5 | 14 | 3.5 | 3.3 | 10 | 27 | 11 | 68 | 243.3 | 5 |

- Median: fps_win **3.5** (min 3.0), fps_act **3.3** (min 2.9), peak-1s **10**.
- Đây là FPS đo riêng trên dense fixture (5 runs headed, real wheel) —
  KHÔNG suy từ fixture lớn. Đóng gap §9 prompt.
- Partial 0/5, wheel dropped 0/5, vsync 144Hz.
- Render với 300 shot buttons mounted: p50/p95 **35.4 / 41.7ms** (<=50
  PASS). DOM: 80 groups / 2155 nodes / 383 buttons (direct render vì 80 <
  threshold 200 — đúng thiết kế lazy-mount, không cần windowing cấp shot).

## 12. Dense Scene Functional Verification

Từ `dense_functional.json` (main harness) + `dense_home.json` (follow-up):

- ArrowDown ×6 từ shot_d001: `d002→d003→d004→d005→d006→d007` (stable IDs).
- End → `shot_d300`; ArrowUp từ End → `shot_d299`.
- Home → focus đúng **first button** (scene_001 header — khớp source
  `app.js:9162-9169` + `home_matches_first_button: true`); ArrowDown tiếp →
  `shot_001` (focus đi vào list hợp lệ).
- Enter trên shot_d001: card đúng shot_d001.
- shot_d250: select → `aria-pressed=true`; scroll away → card giữ;
  reselect → remount `aria-pressed=true`; focus hợp lệ.
- Ghi chú lineage trung thực: `dense_functional.json.home_id = "?"` là
  artifact của probe cũ (chỉ đọc `dataset.shotId` trong khi Home focus scene
  header vốn không có shotId) — đã hiệu chỉnh bằng `dense_home.json`
  (identity đầy đủ + đối chiếu first_button). Không che giấu, không sửa
  file cũ.
- Kết luận: keyboard/selection/focus/remount đúng → không cần sửa source.

## 13. Command Palette Re-check

Main headed session (reference + dense) + follow-up hiệu chỉnh:

- 8/9 PASS trực tiếp: opens, input focus, shot search deterministic,
  no-network-per-keystroke (31→31), arrows đổi active (opt-0→opt-1), dense
  search thấy `shot_d250`, dense Enter reveal off-window shot đúng card
  `shot_d250`, Escape + focus return (`scene_001→scene_001`).
- 1 check ban đầu FAIL là **lỗi assertion của harness, không phải bug sản
  phẩm**: sau ArrowDown (active opt-1) Enter kích hoạt đúng highlighted item
  (`shot_002` — hành vi đúng), nhưng check lại so với `shot_001`.
  Hiệu chỉnh trong follow-up (`palette_enter_corrected.json`): Down→Up về
  opt-0 rồi Enter → card `shot_001`, **PASS**. Tổng hiệu dụng 9/9 + 1
  corrected PASS.
- Không network/keystroke, không LLM, 0 console errors phiên follow-up.

## 14. Console / Network

Aggregate toàn bộ headed sessions (main + follow-up connections):
`console_errors = 0`, `unhandled = 0`, `failed_non_media = 0`,
`server_5xx = 0` (`console_network.json`). Không duplicate scroll listener
(verified từ closure trước, source không đổi), không request/detail storm
(fixtures temp, audio pause, index rebuild mỗi lần mở palette).

## 15. Focused Tests

`tests/test_phase05_evidence_closure.py`: **19 tests** —
7 parser contracts (presented/fallback/không suy từ generic Swap/
dropped-vs-skipped/partial flags/empty-không-bịa/vsync/fps-window),
3 dense-own-FPS + render/DOM, 2 timestamp ISO-8601+tz (evidence + report,
khóa ngày 2026-09-17 chống future-date), 2 governance (giữ report cũ +
không premature PASS + rollback reason + Phase 6 NOT STARTED),
5 functional pinning (dense arrows/End/Up/selection, Home-first-button,
palette + corrected Enter, console/network, integrity 9 files + cleanup).
Kết quả: **19/19 PASS** (1 failed ở lần chạy đầu là proviso đúng: raw
palette 8/9 với FAIL đã document là harness-assertion bug — test đã khóa
đúng outcome này + corrected Enter PASS).

## 16. Full Regression

- Baseline (trước evidence): **661 / 661 PASS** (§4 prompt) — quan sát
  trực tiếp trong task (169.90s). Ghi nhận thêm: trong evidence dir tồn tại
  `tests/baseline_pytest.log` (661 PASS, 167.43s, mtime 19:18) do một phiên
  ngoài tạo — KHÔNG claim là output của task này; nội dung nhất quán với
  baseline task tự chạy nên chỉ dùng đối chiếu, gate B verdict dựa trên run
  trực tiếp của task.
- Final: `python -m pytest --tb=short -q` sau khi report + tests tồn tại —
  **680 / 680 PASS** (661 + 19 mới), 0 failed, 0 errors. Không xóa/weaken
  test nào.

## 17. Data Integrity

- `integrity.json`: 9 canonical files
  (veo_prompts/scene_plan/visual_bible/image_prompts/timestamps/script.txt/
  audio.wav/settings.json/state.db) hash trước = sau (`unchanged: true`;
  mẫu `veo_prompts f2a14895b2554c4d ...` — trùng hashes closure trước).
- Reference read-only; fixtures `_p5e_*` temp-only, cleanup verified
  (`cleanup.json: leftover []`, follow-up `leftover: []`).
- `projects/` git-ignored → không tracked modification.

## 18. Scope Audit

NOT implemented (xác nhận, không capability mới trong task):
Phase 6 responsive/WCAG hardening, Phase 7 Render Manifest, Phase 8
Manifest-driven Renderer, Phase 9 Render QA, AI/LLM palette, localization,
team/cloud, timeline editor, Remotion. Product source: NO CHANGE
(`app.js`, virtualizer, CSS, palette, backend byte-identical ở mức task —
không sửa file sản phẩm nào).

## 19. Limitations

- Presented-FPS thấp (3–4 window, 8–10 peak-1s) là hành vi on-demand đúng
  (mỗi wheel-fling rời rạc ~1 present; gap ~250ms khớp input spacing), không
  phải jank — nhưng đồng nghĩa ngưỡng >= 55 presented-FPS không thể đạt cho
  pattern scroll này; gate J/K được báo FAIL trung thực thay vì "chỉnh"
  metric cho đạt.
- Scheduler-level BeginFrameDropped/kRecoverLatency (~40/run) là tín hiệu
  flow-control, không đồng nhất dropped-frame người dùng thấy; không có
  present trễ/thiếu nào đi kèm (partial 0, inputs đủ).
- Trace Swap đa-surface chỉ đối chiếu (giữ kết luận closure trước).
- Wheel CDP đôi khi treo (resilient bằng timeout + dropped-input counting;
  các runs hợp lệ dropped = 0). Headed session cần desktop hiển thị thật.
- DPR 1.25 khác closure trước (DPR 1) — môi trường hiển thị, không đổi gates.
- EventTiming `event` entries rỗng trong app này → input-latency in-page
  NOT AVAILABLE (đã ghi, không bịa).

## 20. Final Gate Matrix

| Gate | Requirement | Result |
|---|---|---|
| A | Premature roadmap PASS rolled back before closure | PASS (2.5.2-rollback trước evidence) |
| B | Baseline regression 100% | PASS (661/661) |
| C | Timestamp/timezone valid | PASS (2026-09-17+07:00, future-date cũ đã audit) |
| D | Headed Chrome visible | PASS (Chrome 153, no headless/disable-gpu) |
| E | GPU/compositor evidenced | PASS (compositing enabled, RTX 3050) |
| F | Primary metric uses DevTools/frame-presentation evidence | PASS (Display::FrameDisplayed canonical, parser validated; rAF loại khỏi verdict) |
| G | Large virtualized >=5 runs | PASS (5/5, real wheel, cùng env) |
| H | Large direct >=5 runs | PASS (5/5) |
| I | Dense 300-shot >=5 runs | PASS (5/5 own runs) |
| J | Large virtualized median FPS >=55 | **FAIL** (active median 3.3, peak-1s median 10) |
| K | Dense-scene median FPS >=55 | **FAIL** (active median 3.3, peak-1s median 10) |
| L | Presented/partial/dropped frame evidence reported | PASS (presented 12–14/run, partial 0, dropped scheduler-level classified, skipped kNoDamage) |
| M | Direct vs virtualized same environment | PASS (parity tuyệt đối, không jank mới) |
| N | Virtualized render p95 <=50ms | PASS (8.9ms) |
| O | Dense render p95 <=50ms | PASS (41.7ms) |
| P | Dense Shot 1→100+ keyboard navigation | PASS (d001→d007, Home-first, End d300, Up d299, Enter) |
| Q | Dense selection/focus persistence | PASS (sel250 nav/survives/remount, focus) |
| R | Command Palette stable-ID navigation | PASS (9/9 hiệu dụng incl. corrected Enter + dense off-window) |
| S | Console/network clean | PASS (0/0/0/0) |
| T | Focused tests 100% | PASS (19/19) |
| U | Full regression 100% | PASS (680/680) |
| V | Data integrity | PASS (hashes unchanged, cleanup []) |
| W | Phase 6 NOT STARTED | PASS |
| X | Phase 7/8/9 NOT STARTED | PASS |
| Y | Roadmap promoted to PASS only after gates PASS | PASS (giữ REVIEW PENDING vì J/K FAIL — không promotion) |

## 21. Final Verdict

```text
PHASE 5: CONDITIONAL PASS
FRAME-PRESENTATION FPS GATE NOT VERIFIED AT 55 (J/K FAIL on honest numbers)
DENSE-SCENE FPS: measured (own runs) but below 55 for the same on-demand reason
GOVERNANCE: rollback honored — Phase 5 stays IMPLEMENTED / REVIEW PENDING
PHASE 6: NOT STARTED
```
