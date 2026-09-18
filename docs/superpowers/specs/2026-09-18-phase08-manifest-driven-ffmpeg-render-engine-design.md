# Phase 8 Design Spec — Manifest-Driven FFmpeg Render Engine

**Project:** UnfoldIQ  
**Date:** 2026-09-18  
**Status:** Design approved in chat; written-spec review pending  
**Implementation state:** NOT STARTED  
**Phase boundary:** Phase 8 only. Phase 9 QA remains separate.

---

## 1. Objective

Phase 8 replaces only the **Final Render** execution path with a manifest-driven FFmpeg engine whose canonical composition input is the immutable Phase 7 `render-manifest.json`.

The engine must:

- consume one persisted export snapshot;
- validate manifest/file integrity before execution;
- compose mixed image/video Shots frame-accurately;
- mix narration + optional BGM deterministically;
- mux optional subtitles;
- encode production H.264/AAC MP4;
- run as a persistent background job through the existing job/scheduler stack;
- publish one immutable `final.mp4` per `exportId`;
- stop at **render complete / awaiting technical QA**.

Phase 8 does **not** decide production readiness. Phase 9 owns media QA and the transition to `READY`.

---

## 2. Current-System Constraints Reused by Phase 8

Phase 8 must extend existing architecture instead of creating parallel systems.

### 2.1 Phase 7 manifest contract

Canonical render snapshot:

```text
projects/<projectId>/exports/<exportId>/render-manifest.json
```

Canonical fixed-FPS timing:

```text
frameRate = 24/1
timeBase  = 1/24 second per frame tick
frame ranges = [startFrame, endFrame)
durationFrames = endFrame - startFrame
```

The old illustrative `timeBase = 24/1` is superseded and must not reappear.

### 2.2 Existing job infrastructure

Project jobs already have persistent storage and recovery. For project-scoped jobs, canonical storage remains:

```text
projects/<projectId>/jobs/<jobId>.json
```

`runtime/jobs/<jobId>.json` remains the working index/cache according to the existing job manager.

Phase 8 must not introduce a second mutable render-job store.

### 2.3 Existing scheduler/resource model

Reuse:

```text
CUDA_HEAVY
GPU_ENCODER
CPU_BOUND
IO_BOUND
ResourceGuard
LocalResourceScheduler
```

Existing permit release/finally behavior remains authoritative.

### 2.4 Existing Export Workbench

Reuse the current Final Render trigger, activity-job polling, Vietnamese UI status mapping, preview/download flow, and guards where compatible.

Draft/Preview rendering stays on the existing renderer in Phase 8.

---

## 3. Architectural Decisions

The following decisions are locked.

### 3.1 Encoder policy

```text
FINAL_QUALITY  -> libx264     [production default]
ACCELERATED    -> h264_nvenc  [explicit accelerated profile]
```

NVENC may fallback to libx264 **exactly once** only for classified hardware/encoder failures.

No fallback for manifest, input, filtergraph, subtitle, audio, mux, cancellation, or unknown errors.

### 3.2 Composition architecture

Use a **hybrid manifest-driven** planner:

```text
CUT/simple composition        -> concat-compatible path when safe
CROSSFADE/mixed/complex path  -> filter_complex_script
staged normalized clips       -> fallback only when required
```

Do not default to rendering every Shot into an intermediate MP4.

### 3.3 Migration scope

```text
Draft/Preview -> existing renderer unchanged
Final Render  -> new manifest-driven engine
```

No broad renderer unification in Phase 8.

### 3.4 Persistent jobs

Reuse the existing persistent `jobs_manager`.

Phase 8 adds Final Render-specific fields/metadata but does not create a parallel job database/file authority.

### 3.5 Publish model

Render to scratch, then publish:

```text
renders/.scratch_<jobId>/candidate.mp4
        -> successful completion
        -> strict no-overwrite atomic publish
        -> exports/<exportId>/final.mp4
```

The canonical Final is immutable.

### 3.6 Audio ducking

Use narration-driven FFmpeg `sidechaincompress`; do not drive BGM ducking from timestamp regions.

### 3.7 Subtitle default

When subtitles are configured:

```text
burnIn = false -> soft subtitle, mov_text in MP4
burnIn = true  -> hard burn-in via subtitles/libass
```

No subtitle track is added when `subtitlesTrack` is absent.

### 3.8 Resource scheduling

Add a logical global Final Render slot:

```text
FINAL_RENDER concurrency = 1
```

Per-attempt resource class:

```text
FINAL_QUALITY -> CPU_BOUND
ACCELERATED   -> GPU_ENCODER
```

On hardware-only NVENC failure:

```text
release GPU_ENCODER
keep FINAL_RENDER slot
acquire CPU_BOUND
retry once with libx264
```

### 3.9 Canonical output ownership

```text
exports/<exportId>/final.mp4
```

is the source of truth.

Legacy `renders/final/final.mp4` must not remain a second canonical copy. Existing preview routes may become compatibility projections/resolvers.

### 3.10 Progress transport

```text
FFmpeg -progress pipe:1
    -> backend progress parser
    -> existing persistent job state
    -> existing /api/activity/jobs polling
    -> UI
```

No new Final Render SSE channel in Phase 8.

### 3.11 Render input isolation

The Final renderer may read only:

- the persisted `render-manifest.json`;
- media/files explicitly referenced by that manifest.

It must not read live Scene Plan, Visual Bible, Veo prompts, timestamps, Asset Registry, or other editorial state to recompute composition.

### 3.12 Rerender semantics

If canonical `final.mp4` already exists for an `exportId`:

```text
ALREADY_RENDERED
```

Do not overwrite it.

A different Final requires a new `exportId`.

Failed/cancelled/interrupted attempts may retry the same export only while canonical Final is absent.

---

## 4. Core Components

Phase 8 should keep responsibilities isolated.

### 4.1 `ManifestRenderService`

Responsibilities:

- accept Final Render requests;
- resolve the requested persisted export snapshot;
- enforce idempotency and `ALREADY_RENDERED`;
- create/reuse the persistent Final Render job;
- acquire global/resource permits;
- orchestrate attempts, fallback, cancellation, recovery, publish, and metadata.

It must not implement low-level FFmpeg filter syntax directly.

### 4.2 `ManifestIntegrityVerifier`

Checks before FFmpeg launch:

- schema/version compatibility;
- recomputed `manifestHash`;
- referenced-path sandboxing;
- referenced-file presence/readability;
- referenced checksums/integrity;
- supported media formats;
- output/export identity consistency.

It must not consult live editorial sources.

### 4.3 `RenderPlanner`

Converts the manifest into a deterministic derived `RenderExecutionPlan` containing:

```text
manifestHash
expectedFinalFrames
compositionStrategy
normalized clip plans
transition plans
audio plan
subtitle plan
encoder profile
scratch artifact paths
```

`RenderExecutionPlan` is derived execution data, never a new source of truth.

It may be persisted in scratch for diagnostics.

### 4.4 `FFmpegGraphBuilder`

Builds:

- per-input visual normalization;
- concat/filter-complex scripts;
- crossfades;
- narration/BGM graph;
- subtitle path;
- output stream mapping;
- encoder/mux options.

Long/complex graphs should be written to script/list files rather than huge Windows command lines.

### 4.5 `FFmpegProcessRunner`

Responsibilities:

- launch FFmpeg with `-nostdin`;
- parse `-progress pipe:1`;
- drain stdout/stderr concurrently;
- stream bounded diagnostics;
- support graceful cancellation then forced termination;
- return a structured attempt result.

### 4.6 `RenderFailureClassifier`

Maps execution failures to typed error codes and decides fallback eligibility.

### 4.7 `FinalArtifactPublisher`

Responsibilities:

- validate scratch candidate basic sanity;
- enforce cancellation boundary;
- enforce per-export publish guard;
- perform same-filesystem no-replace publish;
- write immutable render provenance metadata;
- never overwrite an existing canonical Final.

---

## 5. Visual Composition Contract

### 5.1 Canonical timing

All planning uses integer frames.

```text
startFrame
endFrame
durationFrames
transitionFrames
```

Seconds are derived only at FFmpeg option/filter boundaries.

Do not reconstruct frame placement from rounded seconds.

### 5.2 Normalized visual stream

Every Shot must be normalized before composition to:

```text
1920x1080
24/1 CFR
1/24 canonical frame timebase semantics
SAR 1:1
yuv420p
PTS reset to zero for clip-local processing
exact target durationFrames
```

### 5.3 IMAGE input

Supported image input includes PNG/JPG/JPEG/WebP.

An image becomes a held video stream for exactly `durationFrames` at 24 fps.

### 5.4 VIDEO trim

`trim.inFrame` / `trim.outFrame` are source-media frame coordinates.

Order:

```text
source-native trim
-> reset PTS
-> apply speedFactor
-> conform to 24fps CFR
-> fit/crop
-> canonicalize
-> enforce exact target frames
```

Do not convert to 24 fps before interpreting source trim frame indices.

### 5.5 Speed factor

```text
1.0 -> normal
2.0 -> 2x faster
0.5 -> 2x slower
```

If the selected source interval cannot satisfy target duration under the declared speed factor:

```text
INSUFFICIENT_SOURCE_DURATION
```

Do not silently hold the last frame, change speed, or alter editorial timing.

### 5.6 Fitting

`FIT_PAD` default:

- preserve aspect ratio;
- fit entire source inside 1920x1080;
- center;
- pad with manifest background color, default `#0b0f19`.

`FILL_CROP`:

- preserve aspect ratio;
- cover 1920x1080;
- center crop excess.

No stretch and no AI smart crop in Phase 8.

### 5.7 CUT

```text
transition.type = CUT
transition.durationFrames = 0
next.startFrame = previous.endFrame
```

No gap and no overlap.

### 5.8 CROSSFADE

For `N` transition frames:

```text
previous.endFrame - next.startFrame = N
```

The renderer uses exactly the declared overlap; it must not introduce a default transition duration.

Final visual duration is:

```text
max(clips[].endFrame)
```

not the sum of clip durations.

### 5.9 Final visual clamp

After composition:

```text
actual visual frames == expectedFinalFrames
```

Extra boundary frames may be trimmed to the exact manifest count.

A frame underrun fails with:

```text
RENDER_FRAME_UNDERRUN
```

No silent padding.

---

## 6. Audio Composition Contract

### 6.1 Narration master

Canonical narration input remains the approved WAV master:

```text
PCM 16-bit
24 kHz
mono
```

Phase 8 does not perform narration loudness normalization, denoise, EQ, speech enhancement, silence removal, or time-stretching.

### 6.2 Final audio format

```text
AAC
192 kbps target
48 kHz
stereo
```

At 24 fps and 48 kHz:

```text
2000 audio samples per video frame
```

Therefore:

```text
targetAudioSamples = expectedFinalFrames * 2000
```

### 6.3 Audio/video duration alignment

After resampling narration to 48 kHz:

- exact match -> use as-is;
- narration short by <= 1 frame (<= 2000 samples) -> pad silence only at tail;
- narration long by <= 1 frame -> trim tail to target;
- mismatch > 1 frame -> `AUDIO_DURATION_MISMATCH` and fail.

No automatic speed correction.

### 6.4 Optional BGM

If `musicTrack` is absent, narration-only output is valid.

If `musicTrack` is present, the renderer must honor it. Missing/corrupt configured music is a failure; do not silently drop it.

`loop=true` -> loop then trim to canonical timeline.

`loop=false` -> play once; remaining timeline contains narration only.

### 6.5 Fade

Fade applies to BGM as declared. Internally, after planning, use sample-accurate coordinates where practical.

### 6.6 Narration-driven ducking

Pipeline:

```text
Narration -> direct voice mix
         -> sidechain control

BGM -> volume -> fade -> sidechaincompress -> final mix
```

Narration itself must not be passed through the sidechain compressor.

Use a versioned deterministic renderer preset such as:

```text
NARRATION_DUCK_V1
```

The implementation must pin resolved threshold/ratio/attack/release/knee values in the profile configuration and record the resolved preset/version in render provenance.

### 6.7 Mixing

Use explicit gains and explicit mix behavior; do not rely on FFmpeg implicit normalization.

Conceptual contract:

```text
voice gain = manifest voice volume
music gain = manifest music volume
amix normalize = 0
mix duration authority = canonical voice/video duration
```

The renderer must not let a longer BGM extend the Final.

### 6.8 Final audio clamp

After mixing:

```text
finalAudioSamples == expectedFinalFrames * 2000
```

Underrun outside allowed alignment tolerance fails.

---

## 7. Subtitle Contract

### 7.1 Optionality

No `subtitlesTrack` -> no subtitle stream, valid render.

Configured subtitle -> file must be present, valid, and readable.

### 7.2 Soft subtitle

`burnIn=false`:

```text
SRT/VTT input as supported by manifest
-> explicit subtitle mapping
-> mov_text in MP4
```

Guarantees:

- cue text;
- cue timing;
- subtitle stream presence.

Does not guarantee pixel-identical font/position across players.

### 7.3 Hard subtitle

`burnIn=true`:

```text
subtitle file
-> subtitles/libass video filter
-> encoded into video pixels
```

Hard-burn styling may use manifest font/style fields.

Requested font unavailability is a failure; no silent font substitution.

### 7.4 No double subtitle by default

```text
burnIn=false -> soft stream
burnIn=true  -> burn-in only
```

Do not automatically include both.

---

## 8. Explicit Stream Mapping

Never rely on FFmpeg automatic stream selection for the Final.

### 8.1 Without subtitle

Map only:

- composed canonical video;
- canonical final mixed audio.

### 8.2 With soft subtitle

Map only:

- composed canonical video;
- canonical final mixed audio;
- configured subtitle stream.

### 8.3 With hard subtitle

Map only:

- subtitle-burned canonical video;
- canonical final mixed audio.

Audio/subtitle tracks embedded in provider/Veo source clips must never leak into Final output.

---

## 9. Encoding Profiles

### 9.1 Output invariant for both profiles

```text
container  = MP4
video      = H.264
resolution = 1920x1080
fps        = 24 CFR
pixel      = yuv420p
SAR        = 1:1
audio      = AAC 192k target / 48kHz / stereo
faststart  = enabled
```

### 9.2 `FINAL_QUALITY`

Default encoder:

```text
libx264
```

The old Phase 4 benchmark point (`veryfast CRF 28`) is evidence, not automatically the production profile.

Implementation requirement: define and version `FINAL_QUALITY_V1` before E2E acceptance, using the existing production renderer baseline plus focused representative benchmark evidence. The chosen numeric encoder parameters must be committed as configuration and reported in Phase 8 evidence; they must not be hidden ad-hoc CLI literals.

### 9.3 `ACCELERATED`

Encoder:

```text
h264_nvenc
```

Similarly define/version an `ACCELERATED_V1` profile in configuration.

The chosen values must be evidence-backed and separate from the x264 profile because CRF/CQ scales are not directly equivalent.

### 9.4 Fallback eligibility

Fallback once to libx264 only for:

```text
ENCODER_HARDWARE_UNAVAILABLE
ENCODER_OUT_OF_MEMORY
ENCODER_INITIALIZATION_FAILED
ENCODER_BUSY
```

No fallback for any other class.

---

## 10. Render Failure Classification

Minimum error taxonomy:

### 10.1 Manifest/input/integrity

```text
INVALID_MANIFEST
MANIFEST_HASH_MISMATCH
INPUT_MISSING
INPUT_CORRUPT
INPUT_INTEGRITY_MISMATCH
SOURCE_VIDEO_UNREADABLE
SOURCE_IMAGE_UNREADABLE
```

### 10.2 Visual planning/composition

```text
INVALID_SOURCE_TRIM
INSUFFICIENT_SOURCE_DURATION
INVALID_SPEED_FACTOR
UNSUPPORTED_FITTING_STRATEGY
INVALID_TRANSITION
TRANSITION_FRAME_MISMATCH
NORMALIZATION_FAILED
FILTERGRAPH_ERROR
RENDER_FRAME_UNDERRUN
```

### 10.3 Audio

```text
MASTER_AUDIO_MISSING
MASTER_AUDIO_CORRUPT
MASTER_AUDIO_CHECKSUM_MISMATCH
AUDIO_DURATION_MISMATCH
AUDIO_RENDER_UNDERRUN
AUDIO_RESAMPLE_FAILED
MUSIC_INPUT_MISSING
MUSIC_INPUT_CORRUPT
MUSIC_CHECKSUM_MISMATCH
INVALID_MUSIC_VOLUME
INVALID_FADE_CONFIG
INVALID_DUCKING_CONFIG
AUDIO_FILTERGRAPH_ERROR
AUDIO_ENCODE_ERROR
```

### 10.4 Subtitle

```text
SUBTITLE_INPUT_MISSING
SUBTITLE_INPUT_CORRUPT
UNSUPPORTED_SUBTITLE_FORMAT
SUBTITLE_ENCODING_ERROR
SUBTITLE_FONT_UNAVAILABLE
SUBTITLE_BURNIN_ERROR
```

### 10.5 Encoder/mux/publish

```text
ENCODER_HARDWARE_UNAVAILABLE
ENCODER_OUT_OF_MEMORY
ENCODER_INITIALIZATION_FAILED
ENCODER_BUSY
VIDEO_ENCODE_ERROR
MUX_ERROR
OUTPUT_CANDIDATE_MISSING
OUTPUT_CANDIDATE_EMPTY
ATOMIC_PUBLISH_FAILED
ALREADY_RENDERED
UNKNOWN_RENDER_ERROR
```

### 10.6 Cancellation

```text
CANCELLED
JOB_ALREADY_COMPLETED
```

Unknown failures must fail; they are never treated as GPU fallback candidates by default.

---

## 11. Job Lifecycle and Persistent State

### 11.1 Reuse existing `JobState`

The current system already uses a general persistent job state model. Phase 8 must **not** add a parallel `RENDERING` state just for Final Render.

Use:

```text
QUEUED
RUNNING
COMPLETED
FAILED
CANCELLED
INTERRUPTED
```

Existing global job infrastructure may also support `PAUSED` / `RESUMABLE`, but Final Render Phase 8 does not use them for mid-render resume.

UI may display `RUNNING` Final Render as **“Đang kết xuất”** based on job type.

### 11.2 Internal execution phase

Add/use a Final Render-specific internal phase field:

```text
PREPARING
WAITING_RESOURCE
ENCODING
CANDIDATE_READY
PUBLISHING
PUBLISHED
```

This is diagnostic/recovery state, not a separate public job status machine.

### 11.3 Job identity, idempotency, and exclusivity

An identical Final Render request is identified by:

```text
projectId
exportId
manifestHash
encoderProfile
```

But canonical-output exclusivity is stricter:

```text
only one active FINAL_RENDER job may exist per projectId + exportId
```

Therefore a second request for the same export while any Final Render is active returns/reuses the existing job even if the requested encoder profile differs. A different profile may be requested only after the prior job reaches a terminal non-success state and canonical Final is still absent.

Before creating work:

1. canonical Final exists -> `ALREADY_RENDERED`;
2. active Final Render job for same export exists -> return/reuse that job;
3. manifest invalid/missing -> reject;
4. otherwise create `QUEUED` job.

### 11.4 Job metadata

Persist at minimum:

```text
jobId
type=FINAL_RENDER
projectId
exportId
manifestHash
encoderProfileRequested
encoderActuallyUsed
fallbackAttempted
attempts[]
status
executionPhase
progress
frame
fps
outTime
eta
startedAt
updatedAt
completedAt
cancelRequestedAt
errorCode
errorMessage
stderrTail
```

### 11.5 Final Render recovery rule

The generic job system may support resumable checkpoints, but Phase 8 Final Render deliberately does not create a safe mid-render checkpoint.

Therefore a crashed Final Render normally recovers as:

```text
INTERRUPTED
```

not `RESUMABLE`.

Retry starts a fresh encode attempt unless the immutable Final was already committed at the publish boundary.

---

## 12. Progress Semantics

Run FFmpeg with program-friendly progress output and background-safe stdin behavior.

Backend parses fields such as:

```text
frame
fps
out_time / out_time_ms
progress
```

Persistent job progress should be throttled reasonably; the existing UI continues polling `/api/activity/jobs` on its current cadence.

FFmpeg encoding progress maps to at most **99%**.

Only after:

- Final is published;
- render metadata is safely committed;
- persistent job state is committed;

may the job become:

```text
progress = 100
status   = COMPLETED
```

---

## 13. Cancellation

### 13.1 While `QUEUED`

Persist cancellation and skip execution.

No FFmpeg process and no canonical Final.

### 13.2 While FFmpeg is running

Use a process group suitable for Windows background execution.

Cancellation sequence:

```text
persist cancel request
-> request graceful interruption
-> wait bounded grace interval
-> force terminate if still alive
-> cleanup
-> CANCELLED
```

The exact grace duration is a configurable runner setting, not an inline magic constant.

### 13.3 Pre-publish cancellation gate

Even if FFmpeg exits successfully, if cancellation was persisted before publish commit:

```text
DO NOT publish
-> CANCELLED
```

### 13.4 Late cancel

Once the immutable Final has been published, cancellation must not delete or invalidate it.

Late cancel returns `JOB_ALREADY_COMPLETED`; job stays `COMPLETED`.

---

## 14. Scratch and Publish Contract

### 14.1 Scratch location

```text
projects/<projectId>/renders/.scratch_<jobId>/
```

Typical contents:

```text
execution-plan.json
filter-complex.txt
concat-list.txt
ffmpeg.log
candidate.mp4
```

Scratch and export destination must be on the same filesystem/volume to preserve no-copy publish semantics.

### 14.2 Publish commit point

Canonical commit point:

```text
candidate.mp4 -> exports/<exportId>/final.mp4
```

The publish helper must have **no-replace semantics**.

Destination already exists -> `ALREADY_RENDERED`; never overwrite.

### 14.3 Publish sequence

```text
FFmpeg exit 0
-> candidate exists
-> candidate size > 0
-> cancellation re-check
-> executionPhase=CANDIDATE_READY
-> acquire per-export publish guard
-> destination non-existence re-check
-> executionPhase=PUBLISHING
-> same-filesystem no-replace publish
-> executionPhase=PUBLISHED
-> safe-write/repair render-metadata.json from persisted provenance
-> status=COMPLETED, progress=100
```

Do not render directly to the canonical Final path.

### 14.4 Crash reconciliation

If startup sees Final Render previously `RUNNING`:

- pre-publish phase + no Final -> `INTERRUPTED`;
- `CANDIDATE_READY` + no Final -> `INTERRUPTED`, do not auto-promote candidate;
- publish boundary + Final exists + export/manifest lineage matches -> reconcile to `COMPLETED`;
- published Final absent where `COMPLETED` claims it exists -> integrity inconsistency, never fabricate success.

### 14.5 Scratch cleanup

On success/failure/cancel/interruption:

- cleanup scratch media/intermediates according to existing retention policy;
- keep bounded persistent diagnostics/attempt history;
- never auto-delete canonical Final or source-of-truth project artifacts.

---

## 15. Render Provenance

After successful publish, create:

```text
exports/<exportId>/render-metadata.json
```

Minimum immutable provenance:

```text
exportId
manifestHash
renderJobId
renderEngine=ffmpeg
ffmpegVersion
encoderProfileRequested
encoderActuallyUsed
encoderProfileVersion
fallbackAttempted
attempt history summary
expectedFinalFrames
fps=24/1
resolution=1920x1080
pixelFormat=yuv420p
audio codec/rate/channels/bitrate target
subtitle mode/codec
completedAt
```

This file is provenance only. It is not mutable job state and not a replacement for `render-manifest.json`.

If the Final was committed but the sidecar write was interrupted, startup reconciliation repairs the sidecar from persistent job state/manifest data; it must not roll back or overwrite the immutable Final.

Phase 8 does not require hashing the entire Final output as a new contract; Phase 9 may add additional output-integrity reporting if needed.

---

## 16. Artifact State Boundary With Phase 9

### 16.1 Existing artifact status model

The current artifact status contract already uses:

```text
DRAFT
NEEDS_REVIEW
READY
OUTDATED
BLOCKED
```

To preserve backward compatibility, Phase 8 does **not** add a new persisted `PENDING_QA` artifact enum.

### 16.2 Post-render representation

After a successful Final Render:

```text
RenderJob.status = COMPLETED
Artifact.status  = NEEDS_REVIEW
reasonCode       = PENDING_RENDER_QA
```

UI may display this as:

```text
Chờ kiểm định
```

This preserves the previously approved semantic requirement: **render success must not mean READY**.

### 16.3 Phase 9 transition

Phase 9 validates the exact per-export canonical artifact:

```text
exports/<exportId>/final.mp4
```

Then:

```text
QA PASS -> READY
QA FAIL -> BLOCKED or NEEDS_REVIEW with diagnostic reason
```

Phase 8 does not run Phase 9's full ffprobe/decode/black-frame/freeze/silence QA suite.

---

## 17. API / Integration Contract

### 17.1 Final Render trigger

Preserve the existing Final Render capability/route surface where practical, but the request must identify a persisted export snapshot.

Required logical input:

```text
exportId
encoderProfile = FINAL_QUALITY | ACCELERATED
```

`FINAL_QUALITY` is the default when no explicit accelerated profile is requested.

The existing Final Render card adds only a compact render-mode control:

```text
Chất lượng cuối (mặc định) -> FINAL_QUALITY
Tăng tốc GPU              -> ACCELERATED
```

No new workspace is introduced. Draft UI is unchanged.

The server must not compile a new manifest implicitly during Final Render.

### 17.2 Draft Render

Unchanged in Phase 8.

### 17.3 Activity jobs

Existing `/api/activity/jobs` remains the UI status source.

### 17.4 Final preview/download compatibility

Phase 8 adds/uses an export-explicit safe Final file resolver, conceptually:

```text
GET /api/projects/{projectId}/exports/{exportId}/final/file
```

The Export Workbench passes the same `exportId` used for Final Render. This avoids any ambiguous "latest Final" selection rule.

The pre-existing project-level Final route may remain only for backward compatibility with legacy pre-Phase-8 output; it must not create or maintain a duplicate canonical `renders/final/final.mp4` for new Phase 8 renders. Draft preview continues using the existing Draft route.

---

## 18. Security and Data-Safety Rules

- Resolve only manifest-referenced paths inside the project/export sandbox.
- Recheck paths after normalization; reject traversal, absolute-drive escapes, UNC escapes, and missing files.
- Verify referenced checksums before execution.
- Never infer missing accepted assets from live registry state.
- Never silently substitute media, fonts, transitions, encoder profiles, or BGM.
- Never overwrite historical manifests or Finals.
- Never use a generic FFmpeg failure as permission to CPU-retry.
- Never use `-shortest` to hide audio/video duration mismatch.
- Never expose unrestricted filesystem serving routes.

---

## 19. Phase 8 Acceptance Test Matrix

### 19.1 Manifest/integrity

- valid persisted manifest;
- manifest hash mismatch;
- path traversal;
- missing media;
- checksum mismatch;
- Final already exists.

### 19.2 Visual

- image / video;
- landscape / portrait / square;
- FIT_PAD / FILL_CROP;
- source 24 / 30 / 60 fps;
- VFR source;
- non-zero source trim;
- speed 0.5 / 1 / 2;
- CUT;
- single CROSSFADE;
- chained CROSSFADE;
- mixed CUT/CROSSFADE;
- 1-frame and odd-frame transition;
- exact final frame count;
- 250- and 500-Shot planning/composition fixtures.

### 19.3 Audio

- narration only;
- narration + BGM;
- loop true / false;
- fade in/out;
- sidechain active;
- speech pauses;
- narration short by <=1 frame;
- narration long by <=1 frame;
- mismatch >1 frame;
- BGM shorter/longer than Final;
- exact final audio/video duration alignment.

### 19.4 Subtitle

- no subtitle;
- soft subtitle;
- hard burn-in;
- missing configured subtitle;
- unavailable requested burn-in font;
- no duplicate soft stream when burn-in is enabled.

### 19.5 Encoder/fallback

- libx264 success;
- NVENC success;
- hardware-only NVENC failure -> exactly one CPU fallback;
- filter/input/subtitle/mux error -> zero fallback;
- fallback attempt history persisted.

### 19.6 Runtime/cancellation/recovery

- cancel while queued;
- cancel during FFmpeg;
- cancel after FFmpeg exit before publish;
- late cancel after publish;
- double-click/idempotent Final Render;
- crash during encoding;
- crash at candidate-ready;
- crash at publish boundary;
- startup reconciliation;
- no stale RUNNING job;
- no permit leak;
- progress never reaches 100 before publish.

### 19.7 Publish

- scratch candidate never appears at canonical path before completion;
- no-replace publish;
- publish race cannot overwrite existing Final;
- canonical Final immutable after commit;
- render metadata matches manifest/job lineage.

### 19.8 Regression

Run focused Phase 8 tests plus the complete existing regression suite. No existing test may be disabled/weakened solely to make Phase 8 pass.

---

## 20. Evidence Required for External Review

Phase 8 implementation must produce evidence sufficient to review:

- actual manifest used;
- execution-plan snapshot/digest;
- FFmpeg version/build capabilities;
- chosen/versioned encoder profiles;
- exact fallback scenario evidence;
- frame-count evidence;
- audio alignment evidence;
- subtitle mode evidence;
- cancellation evidence;
- crash/recovery evidence;
- no-overwrite/atomic publish evidence;
- resource permit release evidence;
- full regression result;
- data-integrity result;
- files changed;
- explicit scope audit proving Phase 9 was not implemented.

The final implementation report should be:

```text
PHASE_08_IMPLEMENTATION_REPORT.md
```

with verdict:

```text
PHASE 8: IMPLEMENTED / REVIEW PENDING
READY FOR EXTERNAL REVIEW
PHASE 9: NOT STARTED
```

The implementing agent must not self-promote Phase 8 to PASS / FINAL / VERIFIED.

---

## 21. Explicit Out of Scope

Phase 8 does not implement:

- Phase 9 technical QA/gatekeeping;
- full ffprobe QA report;
- black-frame/freeze/silence anomaly detection;
- mid-render checkpoint/resume;
- browser timeline editor;
- Remotion;
- Flow/Veo automation;
- YouTube upload/publishing;
- AI smart crop;
- automatic visual substitution/regeneration;
- global loudness mastering/LUFS workflow;
- renderer unification for Draft/Preview;
- multiple Final revisions under one exportId.

---

## 22. Self-Review Resolutions

The written-spec review resolved the following inconsistencies from earlier planning material without changing the approved product intent.

### 22.1 `timeBase`

Canonical value is `1/24`, not the older illustrative `24/1`.

### 22.2 Job status name

The current persistent job system uses `RUNNING`; Phase 8 reuses it rather than inventing a parallel `RENDERING` enum. The UI can still display “Đang kết xuất” for Final Render jobs.

### 22.3 Artifact pending-QA state

The existing artifact enum does not contain `PENDING_QA`. To preserve compatibility while honoring the approved boundary, Phase 8 uses:

```text
NEEDS_REVIEW + reasonCode=PENDING_RENDER_QA
```

and never marks a freshly rendered Final as `READY`.

### 22.4 Existing job persistence

Current UnfoldIQ already has project-scoped persistent job storage and recovery. Phase 8 reuses it and does not build the older proposed lightweight parallel job file.

### 22.5 Final path

Per-export Final is canonical. Legacy render paths are compatibility projections only.

### 22.6 Encoder profile numbers

Old Phase 4 CRF/CQ points were benchmark configurations, not equivalent production-quality definitions. Phase 8 therefore requires versioned, evidence-backed profile configuration before acceptance rather than silently treating the old nominal values as production truth.

---

## 23. Final Design Invariants

Phase 8 is correct only if all of the following remain true:

```text
render-manifest.json is the sole composition authority
live editorial state never changes an existing export render
integer frame math remains canonical
Final audio duration equals Final video duration
one immutable Final per exportId
no canonical partial/corrupt Final on cancellation/crash
no overwrite of historical Final
no duplicate active Final job for one export
no blind NVENC fallback
no stale RUNNING job after recovery
no resource permit leaks
render success != READY
Phase 9 remains separate
```

---

## 24. Implementation Handoff Rule

This document is the approved Phase 8 architectural design once the user approves this written spec.

Only after written-spec approval should the implementation plan be created.

The implementation plan should preserve the user's preferred execution model:

```text
one implementation agent
-> execute Phase 8 tasks sequentially
-> no subagent task split
-> run focused + full regression
-> create PHASE_08_IMPLEMENTATION_REPORT.md
-> stop before Phase 9
-> return report for external review
```
