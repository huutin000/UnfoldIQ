# PHASE 9 IMPLEMENTATION REPORT — Automated Render QA & Verification

> **Terminal implementation-agent verdict (when green):**
> `PHASE 9: IMPLEMENTED / REVIEW PENDING` / `READY FOR EXTERNAL REVIEW` /
> `FINAL SYSTEM GATE: NOT STARTED`
> The implementation agent does **not** self-promote to `PASS / FINAL / VERIFIED`.

---

## 1. Executive Summary

Phase 9 adds deterministic, manifest-aware, full-file **technical** QA for each
immutable Phase 8 Final (`exports/<exportId>/final.mp4`). A dedicated
`RENDER_QA` orchestrator binds every run to
`projectId + exportId + manifestHash + finalSha256 + RENDER_QA_POLICY_V1`,
inspects structure with ffprobe, decodes the **entire** file once while
extracting black/freeze/silence evidence, evaluates events against canonical
24 fps frame intersections of the persisted render manifest, commits an
immutable report, and applies `PASS/PASS_WITH_WARNINGS → READY`,
`FAIL → BLOCKED`. QA engine failure preserves `NEEDS_REVIEW / PENDING_RENDER_QA`
(never false-blocks). Post-closure evidence (external review FINAL):
focused suite **88/88**, nearby **337/337**,
full repo **1062/1062**, browser **22/22**, 20-minute `QA_RTF = 0.0263`,
data integrity GREEN, upstream untouched.

## 2. Git / Baseline / Worktree

- Branch `main`, worktree clean at start (`git status --short` empty).
- Baseline full regression before Task 1: **974 passed, 0 failed, 0 errors**
  (`python -m pytest --tb=short -q`, ~206 s).
- HEAD at start: `8f8aefd feat: add UnfoldIQ studio implementation, tests,
  scripts, and documentation`.
- Approved spec copied into repo (was missing):
  `docs/superpowers/specs/2026-09-18-phase09-automated-render-qa-verification-design.md`.
- No commits made during execution (no user authorization in session);
  all changes are working-tree additions/modifications listed in §5.

## 3. Phase 7/8 Approval Provenance

- Phase 7 and Phase 8 are `PASS / FINAL / VERIFIED` (ROADMAP_STATUS Rev 2.8.1).
- Phase 8 post-render boundary preserved: `NEEDS_REVIEW / PENDING_RENDER_QA`
  (`studio/manifest_render_service.py:_publish_success`).
- Phase 8 nearby suites re-run after handoff edit (§20): render service,
  recovery, publisher — **28/28 PASS**; full Phase 7+8+9 + scheduler + 3D
  nearby: **329/329 PASS**.

## 4. Source Audit

Reused (not reinvented): `JobsManager` persistent job system
(+ `find_active_project_job`, `patch_project_job`), `LocalResourceScheduler`
(`CPU_BOUND`), `FFmpegProgressParser`/`run_process_with_cancel` conventions
(`CREATE_NEW_PROCESS_GROUP`/`CTRL_BREAK_EVENT`, grace-then-force),
`compute_manifest_hash`, `verify_render_snapshot` patterns,
`production_export.validate_export_id`, Phase 8 export resolver/sandbox
patterns, `/api/activity/jobs` polling, Export Workbench workspace, Phase 6
`uqAnnounce`/live-region accessibility behavior. No new state machines, job
stores, workspaces, or dependencies (no Node/React/Docker/Redis/cloud).

## 5. Files Created / Modified

New production: `studio/render_qa_types.py`, `studio/render_qa_policy.py`,
`studio/render_qa_probe.py`, `studio/render_qa_detector.py`,
`studio/render_qa_evaluator.py`, `studio/render_qa_report_store.py`,
`studio/render_qa_service.py`.
Modified: `studio/manifest_render_service.py` (auto-handoff hook +
`qa_service_factory` injection, failure-isolated), `studio/phase14_router.py`
(4 QA endpoints + `_qa_service_singleton`), `studio/static/index.html`
(QA panel in Final Render card), `studio/static/phase14_ui.js` (QA controller,
top-level scope).
New tests (11 files, 80 tests): `test_phase09_types_policy`,
`test_phase09_probe`, `test_phase09_detector`, `test_phase09_evaluator`,
`test_phase09_report_store`, `test_phase09_service` (+ Task 8 handoff),
`test_phase09_recovery`, `test_phase09_api_ui_contract` (+ Task 10 UI),
`test_phase09_security`, `test_phase09_real_ffmpeg`, `test_phase09_performance`,
plus helper `tests/phase09_qa_media.py`.
New scripts: `verify_phase09_render_qa.py`, `verify_phase09_runtime_safety.py`,
`verify_phase09_data_integrity.py`, `run_phase09_performance_benchmark.py`,
`verify_phase09_browser.py`.
Docs: this report; `ROADMAP_STATUS.md` → Rev 2.9.0 (Phase 9
IMPLEMENTED / REVIEW PENDING, Final Gate NOT STARTED).

## 6. QA Types / Policy V1

`studio/render_qa_types.py`: `QaVerdict` (PASS/PASS_WITH_WARNINGS/FAIL),
`QaSeverity` (EXPECTED/OBSERVED/WARNING/HARD_FAIL), `QaDetectorKind`
(BLACK/FREEZE/SILENCE), `RenderQaExecutionPhase` (10 phases incl.
`REPORT_COMMITTED`), `QaFailureCode` (27 codes), `QaTrigger`,
`QaIdentity`, `RawQaEvent`, `QaContextSlice`, `QaFinding`, frozen
`BlackPolicy/FreezePolicy/SilencePolicy/RenderQaPolicy`.
`studio/render_qa_policy.py`: `RENDER_QA_POLICY_V1` with exact thresholds
(black d=0.25/pic_th=0.98/pix_th=0.10, <2 s WARNING, ≥2 s HARD_FAIL; freeze
n=0.001/d=1.0, IMAGE EXPECTED, VIDEO <3 s WARNING, ≥3 s HARD_FAIL; silence
−50 dB/d=2.0, 2–<5 OBSERVED, 5–<8 WARNING, ≥8 HARD_FAIL),
`seconds_to_frame_range` (floor/ceil half-open @24 fps), severity helpers,
`reduce_qa_verdict`. Boundary unit tests: black 1.99/2.00, freeze 2.99/3.00,
silence 4.99/5.00 and 7.99/8.00.

## 7. Input Authority / Lineage

`load_qa_input_snapshot` resolves **only**
`<project>/exports/<exportId>/{render-manifest.json,render-metadata.json,final.mp4}`.
Checks: existence, non-empty Final, manifest parse, metadata parse,
manifest `exportId`, recomputed `manifestHash`, metadata `exportId` +
`manifestHash`. No live authoring state consulted. Fail-closed codes:
`QA_INPUT_MISSING`, `QA_FINAL_EMPTY`, `QA_MANIFEST_INVALID`,
`QA_METADATA_INVALID`, `QA_LINEAGE_MISMATCH` (all HARD_FAIL). Export IDs
validated against `export_NNN`; traversal/absolute/UNC rejected.

## 8. SHA-256 Binary Identity

`compute_sha256` at start (`finalSha256Start`) and re-hash before commit
(`sha256Commit`); mismatch → `QA_FINAL_CHANGED_DURING_RUN` → FAIL/BLOCKED,
proven by unit (mocked timing) and real test (temp copy mutated mid-run).
`QaIdentity = projectId + exportId + manifestHash + finalSha256 +
qaPolicyVersion`; report valid only for the exact recorded binary + policy.

## 9. ffprobe Inspector

`ffprobe -v error -of json -show_format -show_streams -count_frames`
(stdout JSON only). `parse_ffprobe_json` + `validate_probe_contract`
enforce: one video + one audio stream, no leakage; H.264; 1920×1080;
yuv420p; SAR 1:1; CFR 24/1 (avg + r rate); exact `expectedFinalFrames`
(counted, never duration-derived); AAC; 48000 Hz; stereo; video/audio
duration within 1/24 s of `expectedFinalFrames/24`; subtitle topology
(NONE/HARD → 0 streams; SOFT → exactly one `mov_text`). 192 kbps recorded,
not gated. Exact codes per mismatch (§15–17 of design).

## 10. Full Decode / Detector Architecture

One FFmpeg process (`-hide_banner -nostdin -progress pipe:1
-stats_period 0.5`, single `final.mp4` input):
`-vf blackdetect=d=0.25:pic_th=0.98:pix_th=0.10,freezedetect=n=0.001:d=1.0`
`-af silencedetect=n=-50dB:d=2.0` → `-f null -`. Output discarded.
Progress callback maps `out_time` into the 12–88% band (never 100).
Cancellation reuses Phase 8 graceful (`CTRL_BREAK_EVENT`/`terminate`) →
5 s grace → force kill + reap (`CANCEL_GRACE_SECONDS = 5.0`).
Nonzero exit **or** fatal log evidence → `QA_FULL_DECODE_FAILED` (HARD_FAIL).
Fatal patterns (`error while decoding`, `corrupt decoded frame`, cabac
failure, `concealing … errors`, `invalid data`, slice-header errors,
`truncat…`, missing moov, packet read errors) catch concealed corruption
despite exit 0 — proven by the mid-stream fixture (probe clean 96/96 frames,
decode 4 fatal lines → FAIL). Clean decodes record 0 errors (no false
positives asserted on the clean fixture).

## 11. Manifest Context Evaluator

`build_manifest_qa_context` indexes clips to `QaContextSlice`
(shot/scene/media/frames/transition) + CROSSFADE ranges; total frames =
max endFrame. `evaluate_events` normalizes each raw event with
`seconds_to_frame_range`, splits across intersected Shots, and decides
severity from **frame-derived** durations: BLACK threshold-driven with
`BLACK_NEAR_SHOT_BOUNDARY / BLACK_NEAR_TRANSITION / BLACK_INSIDE_SHOT`
labels (V1 proximity never auto-passes); FREEZE IMAGE slice → EXPECTED,
VIDEO slice → policy; SILENCE global mixed-audio policy (no narration
lookup). Same raw freeze class proves context dependence (IMAGE EXPECTED vs
VIDEO WARNING/HARD_FAIL, incl. cross-boundary split test).

## 12. Black Policy Evidence

Real segments (6–8 s files, gap at 2.0 s): 0.5 s → WARNING;
**46-frame (1.917 s) just-below-boundary → WARNING**; 48-frame (2.0 s) →
HARD_FAIL; 4.0 s → HARD_FAIL. Measured finding: a literal 1.99 s wall-clock
gap quantizes to the (48,96) frame boundary and detects as exactly 2.0 s, so
the just-below case is constructed frame-exact at 46 frames (documented
intent-preserving deviation; policy boundary itself is unit-tested at exactly
1.99/2.00). Near-transition case (gap straddling CUT→CROSSFADE boundary)
reports `BLACK_NEAR_TRANSITION` with threshold-driven WARNING.

## 13. Freeze Policy Evidence

Real files (2 s motion + N s looped-still + 2 s motion; motion must resume or
ffmpeg emits `freeze_start` only — measured behavior): IMAGE static 5 s →
EXPECTED, verdict PASS; VIDEO freeze 2 s → WARNING; VIDEO freeze 4 s →
HARD_FAIL + BLOCKED. Detection slop ≈ +2 frames (4 s → 4.083 s), far from the
3.0 s boundary.

## 14. Silence Policy Evidence

Real files (digital-silence gap in sine, 13 s total): 3 s → OBSERVED
(verdict PASS); 6 s → WARNING; 9 s → HARD_FAIL + BLOCKED. Identical results
with `musicTrack.configured` false and true (Final mixed-audio behavior, both
asserted). Detection sample-exact (9.0 s → 9.0 s).

## 15. Verdict Reduction

`reduce_qa_verdict`: any HARD_FAIL → FAIL; else any WARNING →
PASS_WITH_WARNINGS; else PASS (EXPECTED/OBSERVED inert). QA job COMPLETED
carries media FAIL (job FAILED reserved for validator failure).

## 16. Immutable Report Storage

`RenderQaReportStore`: `qa/<qaRunId>/report.json` exclusive-create
(`FileExistsError` on duplicate, bytes never mutated);
`diagnostics/{ffprobe.json,detector-events.json,ffmpeg-stderr.log}`
(stderr bounded 200 KB); full §26 schema (identity, hashes, policy, tools,
probe, fullDecode, detectorSettings, rawEvents, contextEvaluations,
warnings, hardFailures, observed, verdict); export-relative paths only.

## 17. latest.json Semantics

Temp-write + fsync + atomic replace; minimum fields
(qaRunId/reportPath/manifestHash/finalSha256/qaPolicyVersion/verdict/completedAt);
references only committed reports (missing target → treated absent);
deterministic reconstruct by (completedAt, qaRunId); post-commit recovery
repairs it without re-decode.

## 18. JobsManager Integration

`RENDER_QA` jobs via canonical `create_job`/`patch_project_job`/persistence;
no second store; public statuses reused; internal progress via
`metadata.executionPhase`; artifact fields (`artifactStatus`,
`artifactReasonCode`, `qaVerdict`, `qaRunId`) patched on the QA job **and**
matching `FINAL_RENDER` jobs. Engine exception → FAILED, artifact stays
`NEEDS_REVIEW/PENDING_RENDER_QA`.

## 19. Resource Scheduling / Global QA Gate

`CPU_BOUND` permit via `LocalResourceScheduler.submit_job` when a scheduler
is wired; one process-global `threading.Semaphore(1)` waited on in bounded
50 ms slices with a permit-free cancellation checkpoint (never loop-bound;
exact release on all terminal paths — see §45.2). Proven: two QA jobs on
distinct threads/loops → decode overlap max 1; `CPU_BOUND` active count
returns to 0 on all paths.

## 20. Automatic Phase 8→9 Handoff

`ManifestRenderService._publish_success` calls `_enqueue_post_render_qa`
**after** COMPLETED + `NEEDS_REVIEW/PENDING_RENDER_QA` + scratch cleanup, via
direct service call (injectable `qa_service_factory`, default real service).
Failure-isolated: factory/request exceptions only log; Final + pending state
untouched (tested). Duplicate hooks reuse the active/valid identity (tested:
3 hook calls → 1 QA job). Phase 8 suites green after the edit (§3).

## 21. Idempotency

AUTOMATIC with active same-export job → reuse. AUTOMATIC with valid completed
report for exact identity (latest, repaired if pointer missing) → reuse, no
re-decode, artifact re-applied. Otherwise fresh `qaRunId`. Restart-safe
(no duplicate automatic reports).

## 22. Manual Rerun

`MANUAL_RERUN` always creates a new `qaRunId` for the same identity (history
preserved; 2 reports asserted); active same-export job reused instead of
duplicating. Rerun needs no destructive confirmation; rerun disabled while
active (UI); history inspectable without overwriting current state (UI).

## 23. Progress Semantics

Bands: PREPARING 0–2, WAITING_RESOURCE 2, HASHING_FINAL 2–7, PROBING 7–12,
FULL_DECODING 12–88 (FFmpeg out-time driven), EVALUATING 88–94,
WRITING_REPORT 94–97, REPORT_COMMITTED 97, APPLYING_VERDICT 97–99,
COMPLETED 100 (only after report + latest + verdict + job persisted).
Monotonic. Served via existing `/api/activity/jobs`.

## 24. Cancellation

QUEUED → CANCELLED, no process, no report (asserted). RUNNING pre-commit →
graceful child signal → bounded wait → force → reap → CANCELLED, artifact
unchanged, no immutable report (asserted with blocking fake detector).
Post-`REPORT_COMMITTED` late cancel still applies the committed result
(result preserved by design; `recover_incomplete_jobs` converges it).

## 25. Crash Recovery

`recover_incomplete_jobs`: QUEUED stays schedulable; pre-commit RUNNING →
INTERRUPTED (fresh retry, no mid-decode resume; temp-only partials ignored);
post-commit (`reportCommitted` + valid report + Final hash match) → repair
latest, apply verdict, COMPLETED without re-decode; COMPLETED-but-missing
report → integrity inconsistency (INTERRUPTED, never fabricated). Matrix
tested + `verify_phase09_runtime_safety.py` (cancel race, concurrency race,
crash-repair race, 5× recovery repetitions) ALL GREEN.

## 26. API Contract

`POST /api/projects/{id}/exports/{exp}/qa` (`{"mode":"MANUAL_RERUN"}` →
`{jobId,qaRunId,exportId,reused,status}`); `GET …/qa/latest` (summary/404);
`GET …/qa/runs` (summaries); `GET …/qa/runs/{qaRunId}` (full report).
Server-side ID resolution only; `qaRunId` regex-scoped to the URL export
(cross-export → 404); no diagnostic file-serving route. Contract + security
suites green (12 tests).

## 27. Export Workbench UI

QA panel inside the existing Final Render card (no new workspace):
`#render-qa-box` (badge `#render-qa-badge`, polite `#render-qa-status`,
progress, `#render-qa-findings`, `#render-qa-tech` details,
`#btn-qa-rerun` “Chạy kiểm định lại”, `#btn-qa-history`,
`#btn-qa-cancel`, `#render-qa-history`). States: pending (“Video cuối:
Hoàn tất · Kiểm định: Chờ kiểm định”), live progress (“Kiểm định kỹ thuật
N% · Đang kiểm tra toàn bộ video”), PASS “✓ Đạt”, PASS_WITH_WARNINGS
“⚠ Đạt, có cảnh báo” + persistent warning list, FAIL “✕ Không đạt” +
human-first/code-second rows, engine failure “Kiểm định chưa hoàn tất”
(video never mislabeled), cancelled “Đã hủy kiểm định”. Final preview/
download remains available during QA. `Xem tại HH:MM:SS` seeks the existing
`#final-video-player` (scroll, no focus steal, no timeline editor).

## 28. Accessibility

Routine progress/results: `role=status` + `aria-live=polite` (+ milestone
`uqAnnounce` 25/50/75, reusing Phase 6 behavior); hard FAIL box:
`role=alert`; warnings: persistent normal content; no focus theft on
poll/progress; keyboard: rerun focusable + Enter-activatable (browser
verified).

## 29. Security

Unknown project/export → 404; `export_NNN` enforced → 400 otherwise;
`..`, `%2e%2e`, `C:\…`, UNC, mixed-slash traversal → 400/404/422;
foreign `qaRunId` → 404; store-level run-ID whitelist. No arbitrary paths,
no cross-export references, no unrestricted file serving.

## 30. Real FFmpeg Clean Fixture

H.264 1920×1080 24/1 CFR yuv420p SAR 1:1 + AAC 48 kHz stereo 192k, exact
96 frames; manifest with IMAGE + VIDEO clips, CUT + 12-frame CROSSFADE.
Production service end-to-end: probe PASS, full decode 0 errors, verdict
PASS, artifact READY.

## 31. Corruption Fixtures

Truncated (60% bytes, faststart moov): probe-or-decode fails → FAIL/BLOCKED.
Mid-stream (8 KB zeroed at 50%): probe reads clean 96/96 (proving
probe-insufficiency), full decode logs 4 fatal lines with exit 0 →
`QA_FULL_DECODE_FAILED` → FAIL/BLOCKED. Structural: 1280×720, 30 fps,
72-vs-96 frames, missing audio, 44100 Hz, mono, soft-missing, extra
subtitle stream — each hits its exact code + BLOCKED.

## 32. Final-Changed-During-QA Evidence

Real run with temp-copy mutation between start/commit hashes:
`QA_FINAL_CHANGED_DURING_RUN`, FAIL, BLOCKED (plus mocked-timing unit test).

## 33. 250/500-shot Evaluator Scale

500-shot mixed IMAGE/VIDEO/CUT/CROSSFADE mapping+evaluation « 2 s
(measured ≈ ms); counts never treated as production limits.

## 34. ≥20 min Performance / QA_RTF

20.0 min / 28800-frame Final: fixture gen 40.3 s, hash 0.02 s, probe
16.56 s (frame-counting decode), QA wall 31.6 s → **QA_RTF 0.0263 ≤ 1.0**,
decode ≈ 911 fps, verdict PASS → READY. pytest + standalone benchmark agree.

## 35. Browser Acceptance

Real Edge CDP + uvicorn(7871) + temp project, 3 viewports
(1920×1080/1440×900/1366×768): 16/16 GREEN at initial implementation —
pending `Chờ kiểm định`; progress appears/updates; clean PASS→`Đạt`+READY;
rerun grows history; warning→`Đạt, có cảnh báo` + list; seek moves player;
fail→`Không đạt`+BLOCKED; tech details expand; cancel; rerun-after-cancel;
keyboard Enter activation; console/network clean (only allowlisted benign
404s: missing script/plan docs + pending `qa/latest`). 8 screenshots +
`temp/phase09_browser/browser_results.json`. (Automatic trigger path itself
was proven by Task 8 integration tests; the follow-up corrective closure
added the true automatic browser handoff in §45.3, bringing browser
evidence to 22/22. Full-scope fix during this task: QA controller moved
to IIFE top-level scope after the first browser run exposed
`loadRenderQa is not defined`.)

## 36. Focused Phase 9 Tests

11 files, **80/80 PASS** at initial implementation (~174 s incl. real media):
types_policy 7, probe 6, detector 5, evaluator 8, report_store 4,
service 9, recovery 5, api_ui_contract 6, security 5, real_ffmpeg 23,
performance 2.

Corrective closure added 8 tests (detector EOF ×2, real EOF-freeze ×2,
cross-thread gate, gate-release matrix, CPU_BOUND routing, factory wiring):
**88/88 PASS** (§45).

## 37. Nearby Regression

Phase 7 (9 files) + Phase 8 (12) + Phase 9 (11) + scheduler + 3D export
workbench: **329/329 PASS** at initial implementation; **337/337 PASS**
after corrective closure. Prior UI suites (3D/05/06) re-verified after
the frontend change (72 tests PASS).

## 38. Full Regression

`python -m pytest --tb=short -q`: **1054 passed, 0 failed, 0 errors**
at initial implementation (baseline 974 + 80 new); **1062/1062** after
corrective closure. No prior test removed or weakened.

## 39. Data Integrity

`scripts/verify_phase09_data_integrity.py`: 2852-file SHA-256 snapshot
before → check after: **GREEN for all Phase 9 activity** — zero unexpected
mutations; only allowed residue (new `runtime/jobs/*.json` RENDER_QA records
from API tests); temp browser project + its job mirrors fully removed.
Protected hints `asset_registry / render-manifest / render-metadata` recorded
ABSENT (no such paths in `projects/`); all present protected files
byte-identical.

Isolation proof: fresh snapshot → full Phase 9 focused suite (80 tests,
incl. API + real FFmpeg + 20-min performance) → check: **GREEN, zero
changed/added/removed under `projects/`** (2 allowed runtime job mirrors).

Known pre-existing churn (not Phase 9): a full-repo run also executes legacy
Phase 1–5 suites that deliberately read/write the real demo project
(`2026-09-12_210003_youtube-narration-01`: `review_issues.json`,
`research/source_set.json`, `exports/metadata.json`, `state.db`) and a
`projects/--help/state.db` whose revision IDs span days before this session.
No Phase 9 file references these paths (verified by grep); the Phase 9-only
cycle above proves they are untouched by Phase 9. This matches the
pre-existing baseline behavior (the 974 baseline run mutates them likewise).

## 40. Upstream Integrity

`upstream/kokoro-fastapi`: HEAD `f7375e6…` unchanged, `status --short`
empty, `diff --stat` empty (identical to pre-execution baseline;
`describe --tags --exact-match` reports “no tag exactly matches”, as at
baseline). No file under `upstream/` touched by Phase 9 code, tests, or
scripts (verified via `git status` file list).

## 41. Scope Audit

In scope only: technical QA pipeline above. Explicitly absent: semantic
AI/vision review, factual/beauty scoring, auto-repair/remux/re-encode,
renderer/manifest-compiler/timeline changes, publishing, Agent Integration,
multilingual expansion, content profiles, Final System Gate work.
`final.mp4` never written by QA (read-only; only re-hashed).

## 42. Known Limitations (post external-review-final cleanup)

> **Documentation-consistency note (external review FINAL):** items 2 and 5
> below previously described EOF freeze as start-only/unresolved behavior and
> automatic browser handoff as service-level-only evidence. Both statements
> are superseded by corrective closure §§45.1 and 45.3 and are retained here
> only as historical context with explicit closure pointers. No implementation
> change in this cleanup.

1. Wall-clock detector durations quantize to frame boundaries (1.99 s
   constructs as 2.0 s) — policy boundary covered by exact unit tests;
   fixtures use frame-exact straddles.
2. [SUPERSEDED by §45.1 — EOF freeze closed] `freezedetect` emits
   duration/end only when motion resumes, so the pre-closure text described
   a freeze running to EOF as start-only evidence. Post-closure behavior:
   production `parse_detector_stderr` bounds a `freeze_start` with no
   duration/end before EOF to `endFrameExclusive == expectedFinalFrames`
   (never silently discarded). Real fixtures: VIDEO 2 s tail →
   WARNING/PASS_WITH_WARNINGS; VIDEO 4 s tail → HARD_FAIL/BLOCKED; IMAGE
   held through EOF → EXPECTED/PASS. See §45.1.
3. Concealed decode errors exit 0 — caught via fatal log patterns (allowlist
   tuned; clean fixture asserts zero).
4. Peak RSS recorded informally only (no V1 gate, per design).
5. [SUPERSEDED by §45.3 — automatic browser handoff closed] The pre-closure
   text stated browser "automatic trigger" was verified at service level
   only. Post-closure evidence: real browser/CDP acceptance starts from the
   actual Final Render button (Final Render completion → NEEDS_REVIEW /
   PENDING_RENDER_QA → exactly one automatic RENDER_QA → committed PASS →
   READY), 22/22 GREEN. No manual QA POST starts the initial QA run.
   See §45.3.
6. No commits made in-session (awaiting user authorization).

## 43. Gate A–AZ Matrix

| Gate | Requirement | Evidence | Status |
|---|---|---|---|
| A | Phase 7/8 baseline verified | §2, §3 (974/974) | PASS |
| B | Pre-Phase-9 regression green | §2 | PASS |
| C | Protected data unchanged | §39 (integrity GREEN) | PASS |
| D | RENDER_QA reuses JobsManager | §18, service tests | PASS |
| E | CPU_BOUND integration | §19, concurrency test | PASS |
| F | Global QA concurrency = 1 | §19 + §45.2 (threading semaphore, cross-thread overlap max 1) | PASS |
| G | Auto enqueue after Final Render | §20, 3 handoff tests | PASS |
| H | Duplicate auto QA prevented | §20 (3 hooks → 1 job) + idempotency tests | PASS |
| I | Export-scoped input authority | §7, lineage tests | PASS |
| J | Manifest/metadata lineage | §7 | PASS |
| K | Initial Final SHA-256 | §8 | PASS |
| L | Commit-time recheck | §8, §32 | PASS |
| M | Changed Final blocks | §8, §32 (real) | PASS |
| N | ffprobe inspection | §9 | PASS |
| O | Stream topology | §9 + mismatch tests | PASS |
| P | H.264 contract | §9, §30 | PASS |
| Q | 1920×1080 contract | §9, §31 (1280×720 fails) | PASS |
| R | yuv420p contract | §9 | PASS |
| S | SAR 1:1 | §9 | PASS |
| T | CFR 24/1 | §9, §31 (30 fps fails) | PASS |
| U | Exact frame count | §9, §31 (72-vs-96 fails) | PASS |
| V | Duration tolerance | §9 (1/24 s) | PASS |
| W | AAC contract | §9 | PASS |
| X | 48k stereo contract | §9, §31 (44100/mono fail) | PASS |
| Y | Subtitle contract | §9, §31 (missing/extra fail) | PASS |
| Z | Full-file decode | §10 (null sink, no sampling) | PASS |
| AA | Mid-stream corruption detected | §10, §31 (probe-clean → decode FAIL) | PASS |
| AB | Black detection | §12 (4-level matrix) | PASS |
| AC | IMAGE freeze EXPECTED | §13 (5 s → PASS) | PASS |
| AD | VIDEO freeze warn/fail | §13 (2 s/4 s) + §45.1 (EOF tails) | PASS |
| AE | Silence observed/warn/fail | §14 (3/6/9 s × BGM ±) | PASS |
| AF | Frame mapping | §6, §11, boundary tests | PASS |
| AG | Deterministic POLICY_V1 | §6 (exact thresholds, persisted per report) | PASS |
| AH | PASS verdict | §30 (clean → PASS) | PASS |
| AI | PASS_WITH_WARNINGS verdict | §12/13/14 | PASS |
| AJ | FAIL verdict | §31/32 | PASS |
| AK | PASS/PW → READY | §30 + service tests | PASS |
| AL | FAIL → BLOCKED | §31/32 + service tests | PASS |
| AM | Engine failure ≠ block | §18 (FAILED + NEEDS_REVIEW) | PASS |
| AN | Immutable report | §16 (create-only, re-commit conflict) | PASS |
| AO | Safe latest pointer | §17 (atomic, reconstruct) | PASS |
| AP | Automatic idempotency | §21 (no re-decode) | PASS |
| AQ | Manual rerun history | §22 (2 reports) | PASS |
| AR | Crash recovery | §25 (matrix + safety script) | PASS |
| AS | Cancellation | §24 (QUEUED/RUNNING, no report) | PASS |
| AT | Late-cancel safety | §24/25 (commit point) | PASS |
| AU | API sandbox/security | §26, §29 (12 tests) | PASS |
| AV | Vietnamese-first UI | §27 + UI contract tests | PASS |
| AW | Accessible async handling | §28 + browser kbd/polite/alert | PASS |
| AX | Browser acceptance | §35 (16/16, 3 viewports) + §45.3 (22/22 incl. auto handoff C1–C6) | PASS |
| AY | ≥20-min RTF ≤ 1.0 | §34 (RTF 0.0263) | PASS |
| AZ | Full regression 100% | §38 (1062/1062 post-closure; 1054/1054 at initial implementation) | PASS |

## 44. Final Verdict

```text
PHASE 9: IMPLEMENTED / REVIEW PENDING
READY FOR EXTERNAL REVIEW
FINAL SYSTEM GATE: NOT STARTED
```

STOP. Final System Integration & Production Validation Gate is a separate
step and was not started.

---

## 45. Corrective Closure (External Review A–C + Branch Remediation)

Branch remediation: the dirty `main` tree was moved intact onto feature
branch `phase09-render-qa` (`git switch -c phase09-render-qa`, no
reset/clean); all work below is on that branch.

### 45.1 Blocker A — EOF freeze closure

`parse_detector_stderr` accepts `total_frames`/`fps`; a `freeze_start`
with no duration/end before EOF is bounded to
`endFrameExclusive = expectedFinalFrames` (never silently discarded;
out-of-range starts dropped). `run_full_decode_detectors` always supplies
`expected_frames`. Downstream manifest-aware policy is unchanged (IMAGE →
EXPECTED; VIDEO <3 s WARNING, ≥3 s HARD_FAIL). Real fixtures
(prefix motion + static tail held through EOF): VIDEO 2 s tail →
WARNING/PASS_WITH_WARNINGS with `end_frame_exclusive == expectedFinalFrames`;
VIDEO 4 s tail → `QA_VIDEO_FREEZE_EXCESSIVE` HARD_FAIL/BLOCKED; IMAGE held
through EOF (5 s) → EXPECTED/PASS. Unit: start-only log + total_frames →
exact bounded event with `eof_truncated: True`.

### 45.2 Blocker B — truly process-wide gate

The per-event-loop `asyncio.Semaphore` was replaced by one process-global
`threading.Semaphore(1)` (`_QA_GLOBAL_SEMAPHORE`) waited on in bounded
50 ms slices with a permit-free cancellation checkpoint — exact release on
PASS, PASS_WITH_WARNINGS, media FAIL, validator exception, CANCELLED,
INTERRUPTED, and loop teardown (an executor-shield design was prototyped
first and rejected after it deadlocked teardown-cancel races). Regression:
two QA executions on distinct threads/event loops in one process →
max concurrent full decode = 1 (failed with overlap 2 before the fix).
Release matrix test drives PASS → WARNING → FAIL → exception(FAILED) →
CANCELLED → INTERRUPTED → fresh run, each acquiring cleanly. Default
production factory (`phase14_router._qa_service_singleton`) verified to
wire a real `LocalResourceScheduler`, and QA execution verified to submit
`CPU_BOUND`.

### 45.3 Blocker C — automatic browser handoff

`scripts/verify_phase09_browser.py` gained Phase C: a renderable
mini-project (real PNG/WAV + full authoring state, persisted manifest) is
rendered by clicking the real **Kết xuất video chính thức** button —
no QA POST for the initial run. Browser evidence (22/22 checks GREEN):
render COMPLETED with `NEEDS_REVIEW/PENDING_RENDER_QA` latched 3.4 s after
trigger; exactly one auto-queued `RENDER_QA` (`trigger: AUTOMATIC`) exposed
via `/api/activity/jobs`; in-page 2 Hz badge timeline
`Chờ kiểm định → Đang kiểm tra thông số → Đang áp dụng kết quả → Đạt`;
committed `PASS` result + Workbench result rendering + 3 new screenshots.
Notable product finding during closure: auto-QA progress only appears when
`loadRenderQa` observes an active job (render-button path drives this via
`pollRenderJob`); raw `fetch`-triggered renders bypass it — scenario uses
the faithful button path.

### 45.4 Re-verification after closure

Focused **88/88**, nearby **337/337**, full **1062/1062, 0 failed/errors**;
runtime safety ALL GREEN (5/5 recovery repetitions); browser **22/22**;
data integrity GREEN for Phase 9 scope (fresh snapshot→focused→check, zero
mutations; legacy-suite churn documented in §39); upstream HEAD/status
unchanged. No tests removed or weakened.

---

## 46. External Review FINAL — Promotion (documentation record only)

External review verdict `PASS / FINAL / VERIFIED` for Phase 9. This section
records the promotion; it makes no product change and starts no new work.

```text
PHASE 9: PASS / FINAL / VERIFIED

PHASES 1–9: PASS / FINAL / VERIFIED

FINAL SYSTEM INTEGRATION & PRODUCTION VALIDATION GATE:
READY TO START / NOT STARTED
```

Notes:
- The implementation-agent verdict in §44 (`IMPLEMENTED / REVIEW PENDING`)
  is externally promoted by this review to `PASS / FINAL / VERIFIED`.
- The Final System Integration & Production Validation Gate is a separate
  gate. It is `READY TO START / NOT STARTED`. Do not call it "Phase 10".
- Post-closure regression count `1062/1062` is canonical for final
  summaries and Gate AZ evidence (§§1, 38, 43-AZ, 45.4).
