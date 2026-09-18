# UNFOLDIQ — PHASE 7 DESIGN SPEC
## Render Manifest & Timeline Compiler

> Status: DESIGN APPROVED IN CHAT — WRITTEN SPEC FOR USER REVIEW
> Date: 2026-09-18
> Intended repository path: `docs/superpowers/specs/2026-09-18-phase07-render-manifest-timeline-compiler-design.md`
> Current roadmap baseline:
> - Phase 1–6 = PASS / FINAL / VERIFIED
> - Phase 7 = FUTURE / NOT STARTED
> - Phase 8 = FUTURE / NOT STARTED
> - Phase 9 = FUTURE / NOT STARTED

---

# 1. Purpose

Phase 7 introduces a renderer-independent, immutable intermediate representation for final video composition.

It converts current approved production state into a frame-accurate `render-manifest.json` that can later be consumed by Phase 8 without making upstream modules aware of FFmpeg command syntax.

Phase 7 owns:

- Render Manifest data schema.
- Frame-accurate timeline compilation.
- Asset resolution into accepted/canonical asset references.
- Pre-render validation.
- Deterministic manifest hashing.
- Read-only manifest preview.
- Explicit immutable manifest snapshot creation.

Phase 7 does **not** render video.

---

# 2. Existing Architecture to Preserve

UnfoldIQ already has approved architecture that Phase 7 must reuse rather than replace:

- Stable Scene/Shot IDs.
- Scene Plan and Shot hierarchy.
- Master narration audio.
- Timestamps / word cues.
- Visual Bible and visual references.
- Asset Intake lifecycle.
- Asset Registry.
- Phase 4 accepted asset semantics.
- Dependency/versioning/lock infrastructure.
- Portable Package.
- Export Workbench and current production preflight.
- Phase 5 virtualization and UI primitives.
- Phase 6 responsive/accessibility behavior.

Phase 7 must not create competing state systems for any of these.

---

# 3. Architectural Boundary

Canonical flow:

```text
Scene Plan / Shots
Timestamps
Master Voice
Accepted Visual Assets
Optional Background Music
Optional Subtitles
Output Settings
        │
        ▼
┌────────────────────────────┐
│ TimelineCompiler           │
│                            │
│ resolve sources            │
│ convert timing to frames   │
│ validate timeline          │
│ validate accepted assets   │
│ produce manifest model     │
└──────────────┬─────────────┘
               │
      ┌────────┴────────┐
      ▼                 ▼
Read-only Preview   Immutable Snapshot
in memory           exports/<exportId>/
                          │
                          ▼
                 render-manifest.json
                          │
                          ▼
                       Phase 8
```

The manifest is an **Intermediate Representation**, not a renderer command file.

No FFmpeg CLI/filtergraph construction belongs in Phase 7.

---

# 4. Recommended API Model

Phase 7 separates preview from persistence.

## 4.1 Read-only preview

```http
GET /api/projects/{project_id}/render-manifest
```

Behavior:

- Compile from current canonical project state.
- Run validation.
- Return manifest preview + validation result.
- Do not create `exportId`.
- Do not persist a manifest.
- Do not mutate project state.
- Do not launch FFmpeg.
- Repeated GET requests are side-effect free.

## 4.2 Explicit immutable compilation

Manifest persistence is triggered only by an explicit export/snapshot action in the existing export lifecycle.

Canonical function:

```python
compile_render_manifest(project_dir, export_id)
```

Behavior:

1. Resolve canonical project inputs.
2. Compile manifest.
3. Run all validation gates.
4. Refuse persistence if blockers exist.
5. Persist atomically to:

```text
projects/<projectId>/exports/<exportId>/render-manifest.json
```

6. Never overwrite an already finalized historical manifest.

Phase 7 must reuse the current export lifecycle if it already owns `exportId`; it must not invent a parallel export lifecycle.

---

# 5. Manifest Identity & Immutability

Each persisted manifest is associated with one `exportId`.

Required identity fields:

```json
{
  "schemaVersion": "1.0.0",
  "renderManifestVersion": "1.0.0",
  "manifestId": "...",
  "projectId": "...",
  "exportId": "...",
  "createdAt": "...",
  "hashAlgorithm": "sha256",
  "sourceHashes": {},
  "manifestHash": "..."
}
```

Rules:

- Historical manifest snapshots are immutable.
- A new production state produces a new `exportId` / manifest snapshot.
- No shared mutable `render-manifest.json` exists at project root.
- Manifest IDs and export IDs must not depend on array index or DOM order.
- Writes are atomic.

---

# 6. Deterministic Hashing

`manifestHash` must not hash itself.

Canonical algorithm:

```text
hashAlgorithm = SHA-256

manifestHash =
SHA256(
    canonical_json(
        manifest excluding manifestHash
    )
)
```

Canonical serialization must be deterministic:

- UTF-8.
- Stable object property ordering.
- Stable JSON primitive representation.
- No nondeterministic whitespace.
- No transient runtime-only values in the hash payload.
- Same semantic manifest input must produce the same hash payload and the same hash.

The implementation may follow RFC 8785 JCS directly or implement an explicitly documented equivalent deterministic canonicalization appropriate for the current Python stack.

Tests must prove:

```text
same input → same hash
field-order variation → same canonical hash
meaningful content change → different hash
manifestHash field itself → excluded from hash input
```

---

# 7. Source Hashes

`sourceHashes` must identify the exact source state used for compilation.

At minimum:

```json
{
  "scenePlanHash": "...",
  "audioHash": "...",
  "timestampsHash": "...",
  "assetRegistryHash": "..."
}
```

Additional canonical sources may be included when materially used:

```text
visualBibleHash
outputSettingsHash
subtitleHash
musicHash
```

Do not retain the old name `intakeLedgerHash` merely because the early master-plan example used it if the actual canonical source used in current architecture is the Asset Registry/resolver.

Hash only actual source-of-truth data used by the compiler.

---

# 8. Frame Rate vs Time Base

These two concepts are separate.

Canonical 24 fps configuration:

```json
{
  "frameRate": {
    "numerator": 24,
    "denominator": 1
  },
  "timeBase": {
    "numerator": 1,
    "denominator": 24
  }
}
```

Interpretation:

```text
frameRate = 24/1 frames per second
timeBase  = 1/24 second per timestamp tick
```

For fixed-fps video, one frame increments the canonical frame coordinate by exactly 1.

The previous illustrative value:

```json
"timeBase": { "numerator": 24, "denominator": 1 }
```

is explicitly superseded by this Phase 7 design.

---

# 9. Canonical Frame Interval Semantics

All clip frame intervals use half-open ranges:

```text
[startFrame, endFrame)
```

Therefore:

```text
startFrame is inclusive
endFrame is exclusive

durationFrames = endFrame - startFrame
endFrame = startFrame + durationFrames
```

Example:

```text
startFrame = 0
durationFrames = 96
endFrame = 96
```

represents frames:

```text
0 ... 95
```

No renderer or downstream consumer may reinterpret `endFrame` as inclusive.

---

# 10. Seconds Fields Are Derived Metadata

Canonical timeline math uses integer frame coordinates.

Fields such as:

```text
timelineStartSeconds
durationSeconds
expectedDurationSeconds
```

are derived display/reporting values only.

They must not become the source of truth for:

- clip placement;
- gap detection;
- overlap detection;
- transition calculation;
- render duration.

Conversion:

```text
seconds = frames × timeBase
```

Use rational/integer arithmetic where practical; avoid cumulative float drift.

---

# 11. Video Track Contract

Canonical representation:

```json
{
  "videoTrack": {
    "clips": []
  }
}
```

Each clip requires stable identity:

```text
clipId
sceneId
shotId
sequenceIndex
```

Timing:

```text
startFrame
durationFrames
endFrame
```

Asset reference:

```text
assetId
acceptedAssetVersion
checksum
filePath
mediaType
sourceResolution
sourceFps
```

Composition:

```text
trim
fittingStrategy
backgroundColor
transition
```

Shot identity must always come from canonical stable Shot IDs.

Array index is never a business identity.

---

# 12. Shot Granularity

The compiler operates at Shot granularity.

The reference project currently provides:

```text
79 Scenes
141 Shots
```

Phase 7 must preserve all independent Shots.

It must not:

- flatten 141 Shots into 79 Scene-level clips;
- merge Shots merely because they reference the same image;
- derive canonical identity from Scene order;
- hardcode 141 into production logic.

Reference counts are acceptance fixtures, not product constants.

---

# 13. Transition Semantics

## 13.1 CUT

For a cut:

```text
transition.type = CUT
transition.durationFrames = 0
next.startFrame == previous.endFrame
```

No overlap.
No timeline gap.

## 13.2 CROSSFADE

For a crossfade of `N` frames:

```text
transition.type = CROSSFADE
transition.durationFrames = N
```

Required overlap:

```text
previous.endFrame - next.startFrame == N
```

or equivalently:

```text
next.startFrame = previous.endFrame - N
```

Only the declared transition overlap is legal.

Any additional overlap is a blocker.

## 13.3 Future transitions

Phase 7 schema may reserve enum/versioning space for future transition types, but only implemented and validated types may be accepted.

Do not add Phase 8 filter syntax.

---

# 14. Trim Semantics

Trim remains frame-oriented.

Example:

```json
{
  "trim": {
    "inFrame": 0,
    "outFrame": 96,
    "speedFactor": 1.0
  }
}
```

Rules:

- `inFrame >= 0`.
- `outFrame > inFrame`.
- `speedFactor > 0`.
- Source trim must be capable of satisfying target clip duration under the declared speed factor.
- The exact downstream FFmpeg implementation remains Phase 8.

Phase 7 validates the composition request; it does not render it.

---

# 15. Asset Acceptance — Single Canonical Resolver

Phase 7 must reuse Phase 4 semantics.

Canonical asset-role rules already established:

```text
LOCKED       → accepted
APPROVED     → accepted
canonical Visual Bible binding → canonicalReference

SELECTED     → unapproved
GENERATED    → unapproved
REJECTED     → rejected
```

Rules:

- `SELECTED` is not acceptance.
- `GENERATED` is not acceptance.
- `REJECTED` is never eligible.
- `canonicalReference` may be valid without fabricating an approval lifecycle.
- The compiler must not duplicate or fork `resolve_asset_role` semantics.

The compiler may call/refactor a reusable canonical resolver, but Portable Package and Render Manifest must resolve acceptance consistently.

---

# 16. Asset Integrity Contract

For every renderable clip, Phase 7 validates:

```text
assetId
acceptedAssetVersion
checksum
filePath
sourceRole
```

The resolved record must correspond to the current accepted/canonical source-of-truth entry.

If an asset is unapproved or rejected:

```text
render manifest persistence = BLOCKED
```

A read-only preview may still return validation issues, but must not silently promote the asset.

---

# 17. Safe Path Contract

Every manifest `filePath` must be:

- project-relative;
- normalized;
- non-absolute;
- traversal-safe;
- resolved inside the project root;
- physically present when required.

Reject:

```text
../
..\
absolute drive paths
UNC escape
symlink/path resolution escaping project root
```

Persisted manifests must not leak workstation-specific absolute paths.

---

# 18. Supported Media

Initial Phase 7 visual allowlist:

```text
PNG
JPG/JPEG
WebP
MP4
MOV
```

The actual implementation should derive support from current media architecture where possible rather than inventing a conflicting list.

Unsupported formats produce a blocker.

Audio/subtitle support is validated separately by their track contracts.

---

# 19. Audio Track Contract

Master narration is required.

Canonical source:

```text
audio.wav
PCM
24 kHz
mono
16-bit
```

Manifest example:

```json
{
  "audioTracks": {
    "voiceTrack": {
      "filePath": "audio.wav",
      "format": "wav_pcm_24k_mono",
      "startFrame": 0,
      "durationFrames": 15975,
      "volume": 1.0,
      "isMaster": true
    }
  }
}
```

Phase 7 validates master presence and expected specification.

Phase 7 does not perform AAC encoding.

AAC 192 kbps / 48 kHz stereo is an output/render concern consumed later by Phase 8.

---

# 20. Background Music

Background music is optional unless explicitly required by project/export configuration.

Manifest may describe:

```text
filePath
volume
loop
fadeInDurationFrames
fadeOutDurationFrames
ducking.enabled
ducking.duckedVolume
ducking.attackMs
ducking.releaseMs
```

If BGM is not configured:

```text
no blocker
```

If BGM is configured but required media is missing:

```text
validation warning or blocker according to explicit configuration
```

Do not silently substitute media.

---

# 21. Subtitles

Subtitle track is optional by default.

Supported current sources may include:

```text
SRT
VTT
```

Manifest fields may include:

```text
filePath
format
burnIn
style metadata
```

Phase 7 represents intent only.

Soft-subtitle muxing and burn-in filters belong to Phase 8.

---

# 22. Output Settings

Initial canonical target:

```text
1920 × 1080
16:9
24 fps
H.264 target
AAC target
192k audio bitrate target
48 kHz mux sample-rate target
yuv420p
```

Phase 7 stores normalized output intent.

Phase 7 does not choose runtime encoder fallback behavior.

NVENC/libx264 execution policy belongs to Phase 8.

---

# 23. Validation Result Model

Validation must be structured.

Example:

```json
{
  "valid": false,
  "blockers": [
    {
      "code": "TIMELINE_GAP",
      "shotId": "shot_027",
      "message": "Khoảng trống timeline giữa hai cảnh quay.",
      "expected": 2256,
      "actual": 2260
    }
  ],
  "warnings": []
}
```

Each issue should support, where relevant:

```text
code
severity
message
sceneId
shotId
assetId
expected
actual
path
```

User-facing messages are Vietnamese-first.
Codes/schema remain English.

---

# 24. Ten Canonical Validation Gates

## Gate 1 — PATH_SANDBOX_AND_PRESENCE

Block when:
- path is absolute;
- path escapes project root;
- traversal exists;
- required file is missing.

## Gate 2 — ACCEPTED_ASSET_INTEGRITY

Block when:
- asset cannot be resolved;
- accepted version mismatches;
- checksum mismatches;
- asset role is unapproved/rejected.

Reuse Phase 4 canonical acceptance semantics.

## Gate 3 — UNSUPPORTED_MEDIA_TYPE

Block unsupported visual media.

## Gate 4 — NON_POSITIVE_DURATION

Block:

```text
durationFrames <= 0
```

## Gate 5 — INVALID_TIMESTAMPS

Block inconsistent frame interval semantics:

```text
startFrame < 0
endFrame <= startFrame
endFrame != startFrame + durationFrames
```

## Gate 6 — TRANSITION_AWARE_OVERLAPS

Allow only the exact overlap declared by a supported transition.

Block undeclared/excess overlap.

## Gate 7 — TIMELINE_GAPS

For CUT-based adjacency:

```text
next.startFrame == previous.endFrame
```

For transition-aware adjacency:
- use declared overlap semantics;
- no unexplained holes.

A tolerance may be used only where conversion from non-frame source timing legitimately requires it; canonical compiled frame coordinates themselves should be exact.

## Gate 8 — REQUIRED_MASTER_AUDIO

Block missing or invalid narration master.

## Gate 9 — AUDIO_DURATION_ALIGNMENT

Compare visual timeline end frame with narration duration converted to the canonical frame timebase.

Default acceptance tolerance:

```text
<= 1 frame
```

Any larger discrepancy blocks unless an explicit documented project rule says otherwise.

## Gate 10 — OPTIONAL_TRACK_HANDLING

Optional BGM/subtitles do not block when not configured.

Configured optional media failures return appropriate warnings/blockers according to explicit requirement state.

Warnings may be overrideable only if current product policy explicitly supports it.

---

# 25. Compiler Stages

Recommended internal compiler pipeline:

```text
1. Load canonical project state
2. Resolve output settings
3. Resolve master audio
4. Resolve timestamps
5. Load Scene/Shot hierarchy
6. Resolve accepted visual asset for each Shot
7. Convert source timing → integer frame intervals
8. Apply transition semantics
9. Build manifest model
10. Compute sourceHashes
11. Run 10 validation gates
12. Compute deterministic manifestHash
13a. Preview → return in memory
13b. Explicit compile → atomic immutable persistence
```

Validation should be composable and independently unit-testable.

---

# 26. Preview Contract

`GET /render-manifest` returns a preview object.

Recommended response shape:

```json
{
  "manifest": {},
  "validation": {
    "valid": true,
    "blockers": [],
    "warnings": []
  },
  "persisted": false
}
```

Rules:

- No file creation.
- No revision creation solely from GET.
- No asset lifecycle mutation.
- No export creation.
- No expensive render.
- Repeated identical GET calls are idempotent and side-effect free.

---

# 27. Persistence Contract

Explicit compilation:

```text
compile_render_manifest(project_dir, export_id)
```

must:

- require a valid export identity from current export workflow;
- compile current canonical state;
- run validation;
- fail without persistence on blockers;
- write atomically;
- return persisted manifest metadata;
- never overwrite a finalized historical manifest.

If target manifest already exists:

Recommended default:

```text
same canonical hash → return existing immutable snapshot
different canonical hash → conflict; require new exportId
```

Do not overwrite in place.

---

# 28. Atomic Write

Use:

```text
write temporary file
fsync/close as appropriate
atomic replace only for creating the final path
```

However, immutable historical semantics mean an existing finalized path must not be replaced with different content.

Temporary files must be cleaned on failure.

---

# 29. Manifest Validation vs Production Preflight

Phase 7 manifest validation is not a second competing product readiness engine.

Current Production Export/preflight remains authoritative for broader production readiness.

Phase 7 contributes render-manifest-specific blockers/warnings.

Where practical:

```text
Production Preflight
   includes
Render Manifest Validation
```

or consumes the compiler validation result.

Do not duplicate existing readiness business rules in frontend code.

---

# 30. UI Scope

Phase 7 does not introduce a timeline editor.

Minimal existing Export Workbench integration is allowed if needed to expose:

```text
Manifest preview status
Validation blockers
Validation warnings
Manifest snapshot metadata
```

Do not redesign Phase 3D/4 Export Workbench.

No new timeline manipulation UI.

---

# 31. Phase 8 Boundary

Explicitly out of scope:

```text
FFmpeg subprocess
render_from_manifest()
-filter_complex
-filter_complex_script
concat demuxer construction
image looping
video normalization
xfade invocation
AAC encoding
subtitle mux/burn-in execution
NVENC runtime execution
libx264 fallback
-progress pipe:1
final.mp4 generation
```

Phase 7 may define data required by these operations, but may not implement them.

---

# 32. Phase 9 Boundary

Explicitly out of scope:

```text
final output ffprobe QA
black-frame detection
silence detection
duration QA against rendered MP4
hard-gate vs heuristic post-render QA
```

Phase 7 validates input composition, not rendered output.

---

# 33. Agent Integration Boundary

Agent Integration remains future work after core roadmap/final gate.

Phase 7 should expose clean deterministic APIs/data that future agents can consume, but must not implement:

```text
MCP
agent tools
agent workflow
research/script agents
Image QA agents
Video QA agents
```

---

# 34. Scale & Fixtures

Reference fixture:

```text
79 Scenes
141 Shots
```

Additional synthetic fixtures should cover:

```text
1 Shot
multiple Scenes
250 Shots
500 Shots
```

Goals:

- no hardcoded reference counts;
- deterministic ordering;
- acceptable compiler performance;
- no Windows command-line concerns because Phase 7 creates data only;
- stable IDs preserved.

No heavy media generation is required for synthetic timeline tests unless a gate specifically needs real media presence.

---

# 35. Required Test Categories

## Schema
- valid manifest parses;
- unknown policy documented;
- schemaVersion required;
- frameRate/timeBase validated.

## Frame math
- `[start,end)` invariant;
- duration formula;
- CUT adjacency;
- CROSSFADE overlap;
- frame/seconds conversion.

## Hashing
- deterministic hash;
- property-order independence;
- source change changes hash;
- manifestHash excluded from its own digest.

## Asset acceptance
- LOCKED accepted;
- APPROVED accepted;
- canonicalReference valid;
- SELECTED blocked;
- GENERATED blocked;
- REJECTED blocked;
- checksum mismatch blocked;
- accepted version mismatch blocked.

## Paths
- relative path pass;
- missing file fail;
- `../` fail;
- absolute path fail;
- project escape fail.

## Timing
- duration zero/negative fail;
- invalid end fail;
- unexplained overlap fail;
- timeline gap fail;
- valid crossfade pass.

## Audio
- master required;
- invalid master fail;
- aligned pass;
- >1-frame mismatch fail.

## Optional tracks
- no BGM pass;
- no subtitles pass;
- configured missing optional track follows declared warning/block policy.

## Preview
- GET creates no file;
- GET creates no export;
- repeated GET has no state mutation.

## Persistence
- explicit compile writes correct path;
- atomic persistence;
- historical snapshot not overwritten;
- same-hash existing snapshot handling deterministic.

## Scale
- reference 141 Shots preserved;
- synthetic 250/500 Shot compilation.

## Governance
- no Phase 8 renderer architecture;
- no Phase 9 output QA;
- no Agent Integration.

---

# 36. Error Handling

Compiler errors must not crash the server.

Expected behavior:

```text
invalid project data
→ structured blockers
→ appropriate 4xx response for explicit compile if persistence cannot proceed
```

Unexpected internal errors:

```text
→ logged
→ safe 5xx
→ no partial finalized manifest
```

Preview should return validation results where invalid state is an expected business condition.

---

# 37. Security

Manifest compiler must prevent:

- path traversal;
- absolute workstation path disclosure;
- arbitrary file inclusion;
- acceptance bypass;
- checksum bypass;
- stale/rejected asset fallback;
- overwrite of historical export artifact.

No secrets/tokens belong in the manifest.

---

# 38. Performance

Phase 7 must not launch rendering.

Compiler target is lightweight enough to support read-only preview.

Measure at minimum:

```text
reference 141-shot compile
250-shot compile
500-shot compile
```

No hard acceptance number is imposed in this design unless current repo performance policy already defines one, but results must be recorded and obvious pathological behavior investigated.

---

# 39. Data Integrity

Phase 7 must preserve existing project state.

Compilation must not unintentionally modify:

```text
script
story beats
audio
timestamps
word cues
voice QA
Scene Plan
Shot IDs
Visual Bible
image prompts
motion prompts
asset lifecycle
locks
revisions
state.db semantics
master media
```

Preview is strictly read-only.

Explicit manifest creation may only add its export snapshot and required metadata already owned by the existing export lifecycle.

---

# 40. Roadmap State

At Phase 7 start:

```text
Phase 6 = PASS / FINAL / VERIFIED
Phase 7 = IN PROGRESS
Phase 8 = FUTURE / NOT STARTED
Phase 9 = FUTURE / NOT STARTED
```

After implementation and internal verification, before external review:

```text
Phase 7 = IMPLEMENTED / REVIEW PENDING
Phase 8 = FUTURE / NOT STARTED
Phase 9 = FUTURE / NOT STARTED
```

Implementation agent must not self-promote Phase 7 to `PASS / FINAL / VERIFIED`.

---

# 41. Required Implementation Report

Implementation must later produce:

```text
D:\Project\UnfoldIQ\docs\implementation\PHASE_07_IMPLEMENTATION_REPORT.md
```

The report must include:

- Git/worktree baseline.
- Source audit.
- Schema.
- Frame-rate/time-base contract.
- Half-open interval contract.
- Asset resolver reuse.
- Validation gates.
- Preview side-effect proof.
- Immutable persistence proof.
- Hash methodology.
- Reference and scale fixtures.
- Focused tests.
- Full regression.
- Data integrity.
- Scope audit.
- Final gate matrix.
- `Phase 8 = FUTURE / NOT STARTED`.

---

# 42. Design Acceptance Criteria

This Phase 7 design is considered correctly implemented only if all are true:

1. Renderer-independent manifest exists.
2. Manifest persists only under an explicit export snapshot.
3. GET preview is side-effect free.
4. Historical manifest snapshots are immutable.
5. `frameRate = 24/1` and `timeBase = 1/24` for canonical 24 fps output.
6. Clip ranges use `[startFrame,endFrame)`.
7. Float seconds are derived metadata only.
8. Shot granularity is preserved.
9. Stable IDs are preserved.
10. Phase 4 accepted/canonical asset semantics are reused.
11. SELECTED/GENERATED are not silently accepted.
12. REJECTED assets cannot enter a persisted render manifest.
13. Paths are sandboxed/project-relative.
14. Ten validation gates are implemented.
15. Validation output is structured.
16. `manifestHash` is deterministic and non-self-referential.
17. `sourceHashes` represent actual canonical inputs.
18. Master narration is required and validated.
19. Optional BGM/subtitles do not incorrectly block.
20. Reference 141-Shot fixture compiles without flattening.
21. Large synthetic fixtures do not require product hardcoding.
22. No FFmpeg process is launched.
23. No Phase 8 renderer is implemented.
24. No Phase 9 rendered-output QA is implemented.
25. No Agent Integration is implemented.
26. Existing regression remains green.
27. Existing project data remains intact.

---

# 43. Resolved Design Decisions

The following are intentionally resolved and are not implementation-time open questions:

```text
Preview:
GET is read-only.

Persistence:
Explicit immutable export snapshot only.

Time model:
frameRate = 24/1.
timeBase = 1/24.
Integer frames are canonical.

Clip range:
[startFrame,endFrame).

Hash:
SHA-256 over deterministic canonical JSON excluding manifestHash.

Asset truth:
Reuse Phase 4 acceptance/canonicalReference semantics.

Reference counts:
141 Shots is a fixture, not a constant.

Renderer:
Phase 8 only.

Rendered-output QA:
Phase 9 only.

Agent Integration:
after core roadmap/final validation.
```

---

# 44. Sources / Rationale

Project source:
- Current master implementation plan Phase 7 defines Render Manifest + Timeline Compiler, immutable export path, Shot-centric granularity, 10 validation gates, and no FFmpeg in Phase 7.
- Phase 4 final closure establishes accepted asset semantics:
  - LOCKED / APPROVED = accepted.
  - Visual Bible binding = canonicalReference.
  - SELECTED / GENERATED = unapproved.
  - REJECTED = never accepted.

External technical rationale:
- FFmpeg documents fixed-frame-rate time base as the inverse of frame rate; therefore canonical 24 fps uses a `1/24` time base.
- RFC 8785 defines deterministic JSON canonicalization suitable for reproducible cryptographic hashing.

---

# 45. Self-Review Result

Placeholder scan:
- No TBD/TODO/open placeholder remains.

Consistency:
- Preview is read-only everywhere.
- Persistence is explicit and immutable everywhere.
- `frameRate` and `timeBase` are not conflated.
- Half-open interval semantics are consistent with duration formula.
- Phase 4 acceptance rules are reused rather than duplicated.
- Phase 8/9 boundaries are explicit.

Scope:
- One top-level phase only: Phase 7.
- No renderer implementation.
- No rendered-output QA.
- No Agent Integration.

Ambiguity:
- Export ownership, hashing, timebase, frame intervals, asset acceptance, preview semantics, and overwrite policy are explicitly resolved.
