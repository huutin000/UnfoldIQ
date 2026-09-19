# UNFOLDIQ — PHASE 9 DESIGN SPEC
## Automated Render QA & Verification

> **Status:** DESIGN APPROVED IN CHAT / WRITTEN SPEC PENDING USER REVIEW
> **Date:** 2026-09-18
> **Phase:** 9 of 9
> **Prerequisites:** Phase 7 PASS / FINAL / VERIFIED; Phase 8 PASS / FINAL / VERIFIED
> **Intended repository path:** `docs/superpowers/specs/2026-09-18-phase09-automated-render-qa-verification-design.md`
> **Next gate after Phase 9:** Final System Integration & Production Validation Gate
> **Scope owner:** Technical Render QA only

---

# 1. Purpose

Phase 9 adds deterministic, automated, export-scoped technical QA for the immutable Final artifact produced by Phase 8.

Canonical lifecycle:

```text
Phase 7: Render Manifest
→ Phase 8: Final Render
→ Artifact = NEEDS_REVIEW / PENDING_RENDER_QA
→ Phase 9: Automated Technical Render QA
→ PASS → READY
→ PASS_WITH_WARNINGS → READY + warnings
→ FAIL → BLOCKED
```

Phase 9 is not editorial/content-quality review. It does not judge factual correctness, beauty, cinematic quality, semantic visual-vs-script alignment, or creative effectiveness.

---

# 2. Existing Contracts to Preserve

Phase 9 preserves all approved Phase 7/8 contracts:

- immutable export-scoped `render-manifest.json`;
- immutable export-scoped `final.mp4`;
- export-scoped `render-metadata.json`;
- canonical 24/1 output frame rate;
- canonical 1/24 frame timebase for manifest decisions;
- half-open frame ranges `[startFrame,endFrame)`;
- 1920x1080 H.264 `yuv420p`, SAR 1:1;
- AAC 48 kHz stereo;
- soft subtitle mode via `mov_text`;
- hard subtitle mode with no duplicate soft stream;
- persistent `JobsManager`;
- existing generic `JobState`;
- existing `LocalResourceScheduler`;
- existing `/api/activity/jobs` polling;
- existing Export Workbench;
- Vietnamese-first UI policy;
- canonical Final path `projects/<projectId>/exports/<exportId>/final.mp4`;
- Phase 8 post-render boundary `NEEDS_REVIEW / PENDING_RENDER_QA`.

Phase 9 must not create competing authorities.

---

# 3. Architectural Decision

Chosen architecture:

```text
Dedicated QA Orchestrator
```

Canonical flow:

```text
FINAL_RENDER COMPLETED
→ NEEDS_REVIEW / PENDING_RENDER_QA
→ auto enqueue RENDER_QA
→ RenderQaService
   1. Validate lineage
   2. Hash Final
   3. ffprobe inspection
   4. Full decode + detectors
   5. Manifest context mapping
   6. Policy evaluation
   7. Immutable QA report
   8. Apply artifact verdict
→ PASS / PASS_WITH_WARNINGS / FAIL
```

Rejected:
- multiple detector jobs, because of repeated decoding and unnecessary state coordination;
- QA embedded into Final Render, because it collapses Phase 8/9 boundaries and weakens independent rerun/provenance semantics.

---

# 4. Scope Boundary

## In Scope

- exact Final binary identity;
- export/manifest/render-metadata lineage;
- container readability;
- stream topology;
- codec/resolution/pixel format/SAR/fps;
- exact frame count;
- audio codec/rate/channel checks;
- audio/video duration alignment;
- subtitle contract;
- full-file decode;
- black/freeze/silence detection;
- manifest-aware event interpretation;
- deterministic warning/hard-failure policy;
- immutable QA history;
- automatic QA after Final Render;
- manual rerun;
- crash recovery;
- cancellation;
- UI progress/result presentation;
- READY/BLOCKED transitions.

## Out of Scope

- AI vision/semantic review;
- factual/historical review;
- beauty/cinematic scoring;
- auto-repair;
- auto-trim/remux/re-encode;
- subtitle/audio repair;
- renderer changes;
- manifest compiler changes;
- timeline editor;
- YouTube publishing;
- Agent Integration;
- multilingual expansion;
- content profiles.

Phase 9 never mutates `final.mp4` to make it pass.

---

# 5. Canonical Input Authority

Read only:

```text
projects/<projectId>/exports/<exportId>/
├── render-manifest.json
├── render-metadata.json
└── final.mp4
```

Allowed supporting state:
- persistent job records;
- artifact status/reason;
- QA policy;
- tool/version information.

Do not reopen live authoring state such as `scene_plan.json`, `visual_bible.json`, `veo_prompts.json`, raw asset registry state, or `timestamps.json`.

---

# 6. QA Identity

Every QA run binds to:

```text
projectId
exportId
manifestHash
finalSha256
qaPolicyVersion
```

Initial policy:

```text
RENDER_QA_POLICY_V1
```

A QA report is valid only for the exact binary and policy version recorded.

---

# 7. Final Binary Stability

At start:

```text
sha256Start = SHA256(final.mp4)
```

Before result commit:

```text
sha256Commit = SHA256(final.mp4)
```

Required:

```text
sha256Start == sha256Commit
```

Mismatch:

```text
QA_FINAL_CHANGED_DURING_RUN
→ qaVerdict = FAIL
→ Artifact = BLOCKED
```

No repair or replacement is attempted.

---

# 8. Persistent Job Model

Reuse existing generic persistent job system.

```text
jobType = RENDER_QA
```

Public statuses:

```text
QUEUED
RUNNING
COMPLETED
FAILED
CANCELLED
INTERRUPTED
```

Internal phases:

```text
PREPARING
WAITING_RESOURCE
HASHING_FINAL
PROBING
FULL_DECODING
DETECTING
EVALUATING
WRITING_REPORT
REPORT_COMMITTED
APPLYING_VERDICT
```

Keep distinct:

```text
Job status
QA verdict
Artifact status
```

Example:

```text
Job = COMPLETED
qaVerdict = FAIL
Artifact = BLOCKED
```

QA infrastructure failure:

```text
Job = FAILED
Artifact = NEEDS_REVIEW
reasonCode = PENDING_RENDER_QA
```

A failed validator is not proof the media itself is invalid.

---

# 9. Resource Scheduling and Concurrency

Reuse `LocalResourceScheduler`.

```text
RENDER_QA → CPU_BOUND
global RENDER_QA concurrency = 1
maximum one active QA job per export
```

QA must obtain resource permits before full decode. Permits and logical slots must release on all terminal/error/cancel/interruption paths.

---

# 10. Automatic Trigger

After successful Phase 8 Final Render:

```text
RenderJob.status = COMPLETED
Artifact.status  = NEEDS_REVIEW
reasonCode       = PENDING_RENDER_QA
```

backend auto-enqueues exactly one `RENDER_QA` job via direct service call, not HTTP self-call.

Duplicate automatic triggers reuse active or already-valid completed identity.

---

# 11. Manual Rerun

Export Workbench exposes:

```text
Chạy kiểm định lại
```

Manual rerun may create a new immutable `qaRunId` even when the identity is unchanged, preserving audit history.

If an active QA job exists for the export, reuse it instead of starting a concurrent duplicate.

---

# 12. Verdict Model

```text
no HARD_FAIL and no WARNING → PASS
no HARD_FAIL and >=1 WARNING → PASS_WITH_WARNINGS
>=1 HARD_FAIL → FAIL
```

Artifact transition:

```text
PASS → READY
PASS_WITH_WARNINGS → READY
FAIL → BLOCKED
```

`EXPECTED` and `OBSERVED` do not affect verdict directly.

Hard failure has no manual override in `RENDER_QA_POLICY_V1`.

---

# 13. Structural Preflight

Verify:

```text
render-manifest.json exists
render-metadata.json exists
final.mp4 exists
final.mp4 size > 0
exportId lineage matches
manifestHash lineage matches
```

Minimum codes:

```text
QA_INPUT_MISSING
QA_FINAL_EMPTY
QA_MANIFEST_INVALID
QA_METADATA_INVALID
QA_LINEAGE_MISMATCH
```

Unknown structural failures fail closed.

---

# 14. ffprobe Inspection

Use machine-readable ffprobe output.

Inspect:
- container;
- streams;
- video codec;
- resolution;
- pixel format;
- SAR;
- frame-rate fields;
- explicitly counted video frames;
- audio codec;
- audio sample rate;
- audio channels/layout;
- stream durations;
- subtitle topology;
- tool version.

JSON is preferred.

Frame count must be explicitly counted, not derived only from rounded duration.

---

# 15. Stream Topology

Expected:

```text
exactly one video stream
exactly one audio stream
```

Subtitle:

```text
NONE → zero subtitle streams
HARD → zero subtitle streams
SOFT → exactly one subtitle stream, codec mov_text
```

Unexpected source stream leakage is a hard failure.

Minimum codes:

```text
QA_PROBE_FAILED
QA_CONTAINER_UNREADABLE
QA_VIDEO_STREAM_MISSING
QA_AUDIO_STREAM_MISSING
QA_UNEXPECTED_STREAM_LAYOUT
QA_SUBTITLE_CONTRACT_MISMATCH
```

---

# 16. Video Hard Gates

Required:

```text
codec        = H.264
resolution   = 1920x1080
pixel format = yuv420p
SAR          = 1:1
frame rate   = CFR 24/1
frame count  = expectedFinalFrames exactly
```

Duration tolerance:

```text
<= 1/24 second
```

Minimum codes:

```text
QA_VIDEO_CODEC_MISMATCH
QA_VIDEO_RESOLUTION_MISMATCH
QA_VIDEO_PIXEL_FORMAT_MISMATCH
QA_VIDEO_SAR_MISMATCH
QA_VIDEO_FPS_MISMATCH
QA_FRAME_COUNT_MISMATCH
QA_VIDEO_DURATION_MISMATCH
```

Frame count is authoritative over rounded duration when they disagree.

---

# 17. Audio Hard Gates

Required:

```text
codec       = AAC
sample rate = 48000 Hz
channels    = 2 / stereo
```

Duration alignment:

```text
<= 1/24 second
```

Minimum codes:

```text
QA_AUDIO_CODEC_MISMATCH
QA_AUDIO_RATE_MISMATCH
QA_AUDIO_CHANNELS_MISMATCH
QA_AUDIO_DURATION_MISMATCH
```

192 kbps remains a target, not an exact observed-bitrate hard gate. Record observed bitrate in the report.

---

# 18. Full Decode Requirement

Every QA run decodes the entire Final.

No sampling.

Decoded output is discarded to a null sink.

Purpose:
- detect beginning/middle/end corruption;
- prove complete audio/video decode;
- drive complete-file detectors.

Decode failure:

```text
QA_FULL_DECODE_FAILED
→ HARD_FAIL
```

Full decode is verification only, not repair.

---

# 19. Single-Pass Detector Architecture

Use one full-decode FFmpeg process:

```text
final.mp4
→ one full decode
   ├── video → blackdetect
   ├── video → freezedetect
   └── audio → silencedetect
→ RawQaEvent[]
```

Normalized event:

```text
detector
startTime
endTime
duration
rawThresholds
rawEvidence
```

Raw events are not final verdicts.

---

# 20. Canonical Event Frame Mapping

Normalize detector time ranges to canonical frames:

```text
startFrame        = floor(startTime * 24)
endFrameExclusive = ceil(endTime * 24)
```

Then intersect with:

```text
Shot [startFrame,endFrame)
mediaType
transition ranges
```

After normalization, policy decisions use canonical frame intersections.

---

# 21. `RENDER_QA_POLICY_V1`

All thresholds are versioned under:

```text
RENDER_QA_POLICY_V1
```

Applied policy configuration is persisted in each QA report.

No silent threshold changes.

---

# 22. Black Policy

Raw configuration:

```text
minimum detection duration = 0.25s
picture black ratio        = 0.98
pixel threshold            = 0.10
```

Evaluation:

```text
0.25s <= black < 2.0s → WARNING
black >= 2.0s         → HARD_FAIL
```

Context labels:

```text
BLACK_NEAR_SHOT_BOUNDARY
BLACK_NEAR_TRANSITION
BLACK_INSIDE_SHOT
```

Transition proximity does not automatically convert black to EXPECTED because the manifest does not encode explicit full-black intent.

Minimum hard-failure code:

```text
QA_BLACK_EXCESSIVE
```

---

# 23. Freeze Policy

Raw configuration:

```text
noise threshold = 0.001
minimum duration = 1.0s
```

IMAGE Shot:

```text
freeze fully inside IMAGE → EXPECTED
```

VIDEO Shot:

```text
1.0s <= freeze < 3.0s → WARNING
freeze >= 3.0s        → HARD_FAIL
```

Cross-IMAGE/VIDEO freeze is split by canonical Shot intersection before evaluation.

Minimum hard-failure code:

```text
QA_VIDEO_FREEZE_EXCESSIVE
```

---

# 24. Silence Policy

Raw configuration:

```text
noise threshold = -50 dB
minimum duration = 2.0s
```

Evaluation:

```text
2.0s <= silence < 5.0s → OBSERVED
5.0s <= silence < 8.0s → WARNING
silence >= 8.0s        → HARD_FAIL
```

Minimum code:

```text
QA_AUDIO_SILENCE_EXCESSIVE
```

V1 evaluates Final mixed-audio dropout, not narrator-only activity.

Speech-aware QA is out of scope because the approved Phase 9 input boundary does not include live word/speech timing state.

---

# 25. Immutable QA Storage

```text
exports/<exportId>/
└── qa/
    ├── <qaRunId>/
    │   ├── report.json
    │   └── diagnostics/
    │       ├── ffprobe.json
    │       ├── detector-events.json
    │       └── ffmpeg-stderr.log
    └── latest.json
```

`report.json` is immutable/create-only.

`latest.json` is a safely written mutable pointer.

---

# 26. QA Report Schema

Minimum fields:

```text
schemaVersion
qaRunId
qaJobId
projectId
exportId
trigger
manifestHash

final:
  relativePath
  sha256Start
  sha256Commit
  sizeBytes

qaPolicyVersion

tools:
  ffmpegVersion
  ffprobeVersion

startedAt
completedAt

probe:
  container
  videoStream
  audioStream
  subtitleStreams
  observedFrameCount
  observedDuration

fullDecode:
  completed
  exitCode
  decodeErrorCount

detectorSettings:
  black
  freeze
  silence

rawEvents[]
contextEvaluations[]
warnings[]
hardFailures[]
verdict
```

Prefer export-relative paths over machine-specific absolute paths.

---

# 27. Report Commit Semantics

```text
evaluation complete
→ cancellation re-check
→ re-hash final.mp4
→ verify stable SHA-256
→ create immutable report.json
→ executionPhase = REPORT_COMMITTED
→ safe-update latest.json
→ executionPhase = APPLYING_VERDICT
→ apply artifact status
→ persist job COMPLETED / progress=100
```

`REPORT_COMMITTED` is the Phase 9 result commit point.

After it, late cancellation cannot discard the QA result.

---

# 28. `latest.json`

Minimum:

```text
qaRunId
reportPath
manifestHash
finalSha256
qaPolicyVersion
verdict
completedAt
```

It may reference only a committed immutable report.

Never point to RUNNING/FAILED/CANCELLED/INTERRUPTED/partial runs.

If missing and valid reports exist, reconstruct deterministically.

---

# 29. Automatic Idempotency

Automatic identity:

```text
projectId
exportId
manifestHash
finalSha256
qaPolicyVersion
```

Rules:

1. active QA exists → reuse;
2. valid completed report for exact identity exists → do not full-decode again;
3. valid report exists but pointer/artifact apply incomplete → repair/apply;
4. otherwise create fresh QA run.

Server restart must not duplicate automatic reports.

---

# 30. Manual Rerun Semantics

Manual rerun may create a new `qaRunId` for the same exact identity to preserve audit history.

It never overwrites previous reports.

---

# 31. Artifact State During Rerun

Do not demote current state while rerun is still active.

```text
READY + rerun RUNNING   → remain READY
BLOCKED + rerun RUNNING → remain BLOCKED
```

Apply only after new report commit:

```text
READY + new FAIL    → BLOCKED
BLOCKED + new PASS  → READY
BLOCKED + new PASS_WITH_WARNINGS → READY
```

---

# 32. Cancellation

QUEUED:

```text
persist CANCELLED
do not launch tools
artifact unchanged
```

RUNNING before report commit:

```text
persist cancel request
→ graceful child interruption
→ bounded wait
→ force terminate if needed
→ reap/cleanup
→ CANCELLED
→ artifact unchanged
```

After `REPORT_COMMITTED`, late cancel cannot delete report or rollback READY/BLOCKED.

---

# 33. Crash Recovery

QUEUED remains schedulable.

Crash before report commit during PREPARING/WAITING_RESOURCE/HASHING_FINAL/PROBING/FULL_DECODING/DETECTING/EVALUATING/WRITING_REPORT:

```text
→ INTERRUPTED
→ artifact unchanged
→ retry starts fresh QA
```

No mid-decode resume in V1.

If `REPORT_COMMITTED` exists and identity/hash still match:

```text
repair latest if needed
apply artifact verdict
mark job COMPLETED
```

If COMPLETED claims report but report is missing:

```text
integrity inconsistency
```

Do not fabricate evidence.

---

# 34. Progress Semantics

Reuse `/api/activity/jobs`.

Recommended bands:

```text
PREPARING          0–2%
WAITING_RESOURCE   2%
HASHING_FINAL      2–7%
PROBING            7–12%
FULL_DECODING      12–88%
DETECTING          part of full-decode execution
EVALUATING         88–94%
WRITING_REPORT     94–97%
REPORT_COMMITTED   97%
APPLYING_VERDICT   97–99%
COMPLETED          100%
```

During decode, derive progress from FFmpeg machine-readable out-time relative to expected duration.

100% only after report, latest pointer, artifact verdict, and job state are safely persisted.

---

# 35. API Contract

Manual QA/rerun:

```text
POST /api/projects/{projectId}/exports/{exportId}/qa
```

Logical body:

```json
{"mode":"MANUAL_RERUN"}
```

Latest summary:

```text
GET /api/projects/{projectId}/exports/{exportId}/qa/latest
```

History:

```text
GET /api/projects/{projectId}/exports/{exportId}/qa/runs
```

Exact run:

```text
GET /api/projects/{projectId}/exports/{exportId}/qa/runs/{qaRunId}
```

No arbitrary filesystem path is accepted from requests.

No unrestricted diagnostic file-serving route.

---

# 36. Export Workbench Integration

No new workspace/page.

Post-render:

```text
Video cuối: Hoàn tất
Kiểm định: Chờ kiểm định
```

Automatic QA begins without user action.

During QA:

```text
Kiểm định kỹ thuật
42%
Đang kiểm tra toàn bộ video
```

Allow preview/download of immutable Final during QA.

---

# 37. Vietnamese-First UI

Mappings:

```text
PENDING_RENDER_QA → Chờ kiểm định
QUEUED → Đang chờ kiểm định
WAITING_RESOURCE → Đang chờ tài nguyên
HASHING_FINAL → Đang xác minh tệp video
PROBING → Đang kiểm tra thông số
FULL_DECODING → Đang kiểm tra toàn bộ video
EVALUATING → Đang đánh giá kết quả
WRITING_REPORT → Đang lưu báo cáo
PASS → Đạt
PASS_WITH_WARNINGS → Đạt, có cảnh báo
FAIL → Không đạt
QA engine FAILED → Kiểm định chưa hoàn tất
CANCELLED → Đã hủy kiểm định
```

Keep API/schema/error identifiers in English.

---

# 38. PASS UI

```text
Kiểm định kỹ thuật
✓ Đạt
Artifact = READY
```

Show policy version, completed time, report action, rerun action.

---

# 39. PASS_WITH_WARNINGS UI

```text
Kiểm định kỹ thuật
⚠ Đạt, có cảnh báo
Artifact = READY
```

Show persistent warning count/category summary.

Warnings are not repeated modal interruptions.

---

# 40. FAIL UI

```text
Kiểm định kỹ thuật
✕ Không đạt
Artifact = BLOCKED
```

Show human-readable explanation first, technical code second.

Example:

```text
Video bị đứng hình quá lâu
00:05:12.000 – 00:05:16.100
Shot: shot_042
Thời lượng: 4.1s
Ngưỡng: 3.0s

QA_VIDEO_FREEZE_EXCESSIVE
```

---

# 41. Evidence Navigation

Time-based events expose:

```text
Xem tại <timestamp>
```

Seek the existing video player.

This is review navigation, not timeline editing.

---

# 42. QA Engine Failure UX

If validator fails:

```text
Kiểm định chưa hoàn tất
```

Artifact stays:

```text
NEEDS_REVIEW / PENDING_RENDER_QA
```

Show last attempt, concise error, technical details, rerun action.

Never label the video "Không đạt" without a committed FAIL verdict.

---

# 43. Accessibility

Use polite status semantics for normal async progress/result updates.

Use alert semantics only for important operational failure when appropriate.

Warnings remain persistent normal content.

Do not steal keyboard focus on progress changes.

Preserve Phase 6 accessibility behavior.

---

# 44. Security

Reject:

```text
unknown projectId
unknown exportId
path traversal
qaRunId traversal
absolute drive paths
UNC paths
cross-export report references
encoded/mixed-slash traversal
```

Server resolves canonical paths from IDs.

No unrestricted file-serving surface.

---

# 45. Data Safety

Allowed Phase 9 mutations:

```text
exports/<exportId>/qa/<qaRunId>/*
exports/<exportId>/qa/latest.json
persistent RENDER_QA job state
artifact status/reason/QA summary fields
```

Forbidden mutation:

```text
render-manifest.json
render-metadata.json
final.mp4
script
audio
timestamps
Scene Plan
Visual Bible
Veo prompts
asset registry/accepted media
historical export snapshots
```

Protected files require before/after integrity hash verification.

Synthetic/corrupt media is temp-only.

---

# 46. Upstream Integrity

Phase 9 must not modify Kokoro upstream.

Record:

```text
git rev-parse HEAD
git describe --tags --exact-match
git status --short
git diff --stat
```

Unexpected tracked upstream mutation fails integrity verification.

---

# 47. Real Media Acceptance

Mock-only acceptance is prohibited.

Minimum clean fixture:

```text
H.264
1920x1080
24/1 CFR
yuv420p
SAR 1:1
AAC 48 kHz stereo
known exact frame count
```

Manifest context includes at least IMAGE, VIDEO, CUT, CROSSFADE, and subtitle-mode coverage as applicable.

The production QA service must inspect the real artifact.

---

# 48. Corruption Matrix

Required controlled fixtures:

```text
truncated MP4
mid-stream corruption
wrong resolution
wrong fps
wrong frame count
missing audio
wrong sample rate
wrong channel count
soft subtitle missing
unexpected subtitle stream
```

Mid-stream corruption must prove full decode catches errors not guaranteed by structural probing alone.

---

# 49. Black Fixture Matrix

```text
0.5s  → WARNING
1.99s → WARNING
2.0s  → HARD_FAIL
4.0s  → HARD_FAIL
```

Test inside Shot, near CUT, near CROSSFADE.

Report timing, canonical frame mapping, context, severity.

---

# 50. Freeze Fixture Matrix

```text
IMAGE static 5s → EXPECTED
VIDEO freeze 2s → WARNING
VIDEO freeze 4s → HARD_FAIL
```

Critical proof:

```text
same raw freeze class
+ IMAGE context → EXPECTED
+ VIDEO context → WARNING/HARD_FAIL
```

---

# 51. Silence Fixture Matrix

```text
3s → OBSERVED
6s → WARNING
9s → HARD_FAIL
```

Exercise both BGM absent and BGM present.

Report Final mixed-audio behavior, not narrator-only assumptions.

---

# 52. Lineage/Tamper Tests

Required:

```text
manifestHash mismatch
render-metadata exportId mismatch
render-metadata manifestHash mismatch
Final changed during QA
```

Final-changed test uses only a temporary test copy.

---

# 53. Persistence Tests

Required:

```text
report create-only
duplicate qaRunId cannot overwrite
partial report not valid
latest safe-write
latest never references incomplete run
missing latest reconstructs
committed report immutable
```

Destructive/error cases use temporary directories.

---

# 54. Crash Recovery Matrix

| Crash Point | Expected |
|---|---|
| QUEUED | remains schedulable |
| HASHING_FINAL | INTERRUPTED |
| PROBING | INTERRUPTED |
| FULL_DECODING | INTERRUPTED |
| DETECTING | INTERRUPTED |
| EVALUATING | INTERRUPTED |
| report temp only | INTERRUPTED, partial ignored |
| REPORT_COMMITTED before artifact apply | recover report, apply verdict, COMPLETED |
| report committed, latest missing | repair latest |
| COMPLETED but report missing | integrity inconsistency |

No mid-decode resume.

---

# 55. Cancellation Matrix

Required:

```text
cancel QUEUED → no process
cancel PROBING → child gone, CANCELLED
cancel FULL_DECODING → FFmpeg gone, CANCELLED
cancel before report commit → no committed report
cancel after REPORT_COMMITTED → result preserved and applied
```

---

# 56. Concurrency/Resource Tests

Required:

```text
QA A + QA B → full decode never overlaps
CPU-bound Final Render active → QA waits
permits/slots release after PASS/PASS_WITH_WARNINGS/FAIL/exception/cancel/interruption
```

No leaks.

---

# 57. Automatic Handoff Tests

```text
FINAL_RENDER completes
→ NEEDS_REVIEW/PENDING_RENDER_QA
→ exactly one RENDER_QA queued
```

Clean fixture:

```text
QA COMPLETED + PASS → READY
```

Hard-fail fixture:

```text
QA COMPLETED + FAIL → BLOCKED
```

Injected QA-engine failure:

```text
QA job FAILED → NEEDS_REVIEW/PENDING_RENDER_QA
```

---

# 58. Performance

Define:

```text
QA_RTF = qaWallClockSeconds / finalDurationSeconds
```

Long-form fixture:

```text
Final duration >= 20 minutes
QA_RTF <= 1.0
```

Record hash, probe, decode, evaluate, report-write, total wall time, average decode fps.

Peak RSS may be recorded but is not a hard V1 gate until measured baseline exists.

---

# 59. Evaluator Scale

Synthetic context:

```text
250 Shots
500 Shots
```

Target:

```text
500-Shot mapping/evaluation < 2 seconds
```

Do not hardcode these counts as production limits.

---

# 60. Browser Acceptance

Export Workbench real-browser flow:

1. completed export shows `Chờ kiểm định`;
2. automatic QA appears;
3. progress changes;
4. clean PASS → `Đạt` + READY;
5. rerun;
6. history increases;
7. warning fixture → `Đạt, có cảnh báo`;
8. warning list works;
9. event timestamp seeks video;
10. fail fixture → `Không đạt` + BLOCKED;
11. technical details expand;
12. cancel works;
13. rerun after cancel works;
14. keyboard operation works;
15. console/network clean.

Viewports:

```text
1920x1080
1440x900
1366x768
```

---

# 61. Test Layers

Required:

```text
1. pure unit tests
2. service/job integration tests
3. real FFmpeg media tests
4. browser/full-system regression
```

Unit: policy, thresholds, frame mapping, context intersection, verdict reducer, identity, idempotency.

Integration: jobs, scheduler, persistence, API, handoff, cancel, recovery, artifact transitions.

Real media: actual contracts/corruption/detectors.

---

# 62. Boundary Tests

Mandatory examples:

```text
black 1.99s vs 2.00s
VIDEO freeze 2.99s vs 3.00s
silence 4.99s vs 5.00s
silence 7.99s vs 8.00s
```

Also test values around canonical frame edges so floating-point noise cannot change severity silently.

---

# 63. Full Regression

Approved pre-Phase-9 baseline:

```text
974 / 974 PASS
```

Completion requires:

```text
focused Phase 9 suite = 100% PASS
nearby Phase 7/8/jobs/Export Workbench = 100% PASS
full repository = 0 failed / 0 errors
```

Do not remove/weaken prior tests just to pass.

Stale governance assertions may be updated only to the new approved phase boundary while preserving protective intent.

---

# 64. Acceptance Gates A–AZ

| Gate | Requirement |
|---|---|
| A | Phase 7/8 approved baseline verified |
| B | pre-Phase-9 full regression green |
| C | protected project data unchanged |
| D | RENDER_QA reuses persistent JobsManager |
| E | CPU_BOUND scheduler integration |
| F | global QA concurrency = 1 |
| G | automatic enqueue after successful Final Render |
| H | duplicate automatic QA prevented |
| I | export-scoped input authority |
| J | manifest/render-metadata lineage |
| K | initial Final SHA-256 |
| L | commit-time Final SHA-256 recheck |
| M | changed Final during QA blocks |
| N | ffprobe structural inspection |
| O | stream topology |
| P | H.264 contract |
| Q | 1920x1080 contract |
| R | yuv420p contract |
| S | SAR 1:1 |
| T | CFR 24/1 |
| U | exact frame count |
| V | duration tolerance |
| W | AAC contract |
| X | 48k stereo contract |
| Y | subtitle contract |
| Z | full-file decode |
| AA | mid-stream corruption detected |
| AB | black detection |
| AC | IMAGE freeze classified EXPECTED |
| AD | VIDEO freeze warning/hard-fail |
| AE | silence observed/warning/hard-fail |
| AF | event→canonical-frame mapping |
| AG | deterministic RENDER_QA_POLICY_V1 |
| AH | PASS verdict |
| AI | PASS_WITH_WARNINGS verdict |
| AJ | FAIL verdict |
| AK | PASS/PASS_WITH_WARNINGS → READY |
| AL | FAIL → BLOCKED |
| AM | QA engine failure does not falsely block |
| AN | immutable report |
| AO | safe latest pointer |
| AP | automatic idempotency |
| AQ | manual rerun history |
| AR | crash recovery |
| AS | cancellation |
| AT | late-cancel safety |
| AU | API sandbox/security |
| AV | Vietnamese-first UI |
| AW | accessible async status/result handling |
| AX | browser acceptance |
| AY | >=20-minute QA_RTF <= 1.0 |
| AZ | full regression 100% |

Implementation report must map evidence to every gate.

---

# 65. Required Implementation Report

Future implementation must create:

```text
docs/implementation/PHASE_09_IMPLEMENTATION_REPORT.md
```

Include baseline, source audit, modules/files, QA policy, failure taxonomy, report schema, jobs/resources, handoff, idempotency/rerun, crash/cancel, real-media evidence, corruption evidence, detector evidence, browser acceptance, performance, integrity, upstream integrity, scope audit, tests, regression, Gate A–AZ.

Implementation-agent terminal verdict when green:

```text
PHASE 9: IMPLEMENTED / REVIEW PENDING
READY FOR EXTERNAL REVIEW
FINAL SYSTEM GATE: NOT STARTED
```

Implementation agent must not self-promote to `PASS / FINAL / VERIFIED`.

---

# 66. Roadmap Boundary

Phase 9 is the final top-level phase.

Next:

```text
Final System Integration & Production Validation Gate
```

This is not Phase 10.

Phase 9 must not start the Final System Gate automatically.

After external Phase 9 PASS:

```text
Phase 1–9 = PASS / FINAL / VERIFIED
Final System Gate = READY TO START / NOT STARTED
```

---

# 67. Design Acceptance Criteria

Implementation is correct only if:

1. QA remains deterministic technical review, not semantic AI review.
2. Exact immutable export is authority.
3. SHA-256 binds result to exact Final.
4. Start/commit hash stability is proven.
5. Generic job system is reused.
6. CPU scheduler is reused.
7. Global QA concurrency is one.
8. Phase 8 auto-enqueues Phase 9.
9. Automatic duplicates are idempotent.
10. Manual reruns preserve immutable history.
11. ffprobe validates media structure.
12. Exact frame count is checked.
13. Full Final is decoded.
14. Decode errors hard-fail.
15. One full-decode pass drives detectors.
16. Black policy is deterministic/versioned.
17. IMAGE freeze is EXPECTED.
18. VIDEO freeze policy is deterministic.
19. Silence is explicitly Final mixed-audio QA.
20. Detector events map to canonical frames.
21. PASS/PASS_WITH_WARNINGS/FAIL are distinct.
22. PASS and PASS_WITH_WARNINGS produce READY.
23. FAIL produces BLOCKED.
24. QA infrastructure failure does not falsely block.
25. Phase 9 never mutates Final.
26. Reports are immutable.
27. latest is a repairable pointer.
28. Pre-commit crash becomes INTERRUPTED.
29. Post-report crash can recover without re-decode.
30. Late cancel cannot erase result.
31. Export Workbench is reused.
32. UI is Vietnamese-first.
33. Status/result UX remains accessible.
34. Evidence timestamps can seek existing player.
35. Security blocks path/cross-export escape.
36. Protected data remains intact.
37. Real corruption fixtures are used.
38. Mid-stream corruption proves full-decode value.
39. Browser acceptance passes.
40. >=20-minute QA meets RTF <=1.0.
41. Nearby Phase 7/8 regressions remain green.
42. Full repo has zero failed/errors.
43. No Agent Integration.
44. No semantic AI QA.
45. Final System Gate remains separate/not started.

---

# 68. Resolved Design Decisions

Locked:

```text
QA type: Technical Render QA only
Context: Manifest-aware
Trigger: Automatic after Final Render + manual rerun
Promotion: PASS/PASS_WITH_WARNINGS → READY; FAIL → BLOCKED
QA engine failure: keep NEEDS_REVIEW/PENDING_RENDER_QA
Mutation: read-only against final.mp4
History: immutable QA runs + mutable latest pointer
Identity: projectId + exportId + manifestHash + finalSha256 + qaPolicyVersion
Decode: full-file
Detectors: single full-decode pass
Concurrency: CPU_BOUND, global QA = 1
Job model: generic JobState
Policy: RENDER_QA_POLICY_V1
Semantic AI review: out of scope
Final System Gate: separate step
```

---

# 69. Tooling Rationale

The design relies on supported FFmpeg/ffprobe behavior:

- machine-readable/JSON ffprobe output;
- stream inspection;
- frame inspection and explicit frame counting;
- full decode without replacement output;
- machine-readable FFmpeg progress;
- black detection;
- freeze detection;
- silence detection.

Raw tool output is normalized into UnfoldIQ-owned models before policy evaluation.

---

# 70. Spec Self-Review

## Placeholder scan

No unresolved `TBD`, `TODO`, unnamed threshold, or undecided policy remains.

## Internal consistency

The spec consistently separates job status, QA verdict, and artifact status, and consistently preserves the immutable Phase 8 Final.

## Scope check

The spec defines one subsystem only: Automated Technical Render QA & Verification.

It excludes Final System Gate, Agent Integration, semantic AI QA, publishing, and auto-repair.

## Ambiguity check

Explicit decisions exist for:
- full decode vs sampling;
- manifest-aware vs output-only;
- automatic vs manual-only trigger;
- read-only vs auto-repair;
- immutable history;
- Final hash;
- job vs verdict state;
- infrastructure failure;
- detector process model;
- scheduler resource class;
- thresholds;
- rerun state;
- report commit point;
- crash recovery;
- late cancellation;
- performance metric.

---

# 71. Design Verdict

```text
PHASE 9 DESIGN: APPROVED IN CHAT
WRITTEN SPEC: READY FOR USER FILE REVIEW
IMPLEMENTATION PLAN: NOT YET WRITTEN
IMPLEMENTATION: NOT STARTED
FINAL SYSTEM GATE: NOT STARTED
```

Do not implement Phase 9 until this written spec is reviewed and approved by the user.
