# UNFOLDIQ Production Contracts

## Overview

This document defines 5 structured JSON contracts that serve as the canonical data handoff between production stages and the Remotion renderer. Each contract has a corresponding JSON Schema for validation.

## The 5 Contracts

| Contract | Purpose | Schema | Primary Stage |
|----------|---------|--------|---------------|
| `scene-script.json` | Editorial scene plan with narration, visual intent, timing | `schemas/scene-script.schema.json` | Stage 8 (Scene Plan) |
| `asset-manifest.json` | Inventory of all assets with provenance and rights | `schemas/asset-manifest.schema.json` | Stage 9/10 (Asset Plan/Resolution) |
| `audio-manifest.json` | Audio tracks (voice, music, SFX) with timing | `schemas/audio-manifest.schema.json` | Stage 12 (Voice/Music/SFX/Captions) |
| `captions.json` | Caption items with evidence-based timing | `schemas/captions.schema.json` | Stage 12 (Voice/Music/SFX/Captions) |
| `video-spec.json` | Technical render specification for Remotion | `schemas/video-spec.schema.json` | Stage 13 (Video Spec) |

## Continuity → Provider Relationship (STEP 10A)

```text
Visual Bible
↓
continuity-registry.json (schemas/continuity-registry.schema.json)
↓
scene-script.json (with recurring entity IDs + continuityStrictness)
↓
provider requests (schemas/provider-request.schema.json, continuityContext by reference)
↓
asset-manifest.json (provider results; may reference continuity entity IDs, never duplicates full entity definitions)
```

Asset manifest entries may carry `continuityEntities[]` / reference asset IDs
linking back to the registry. Full entity definitions live only in
`continuity-registry.json`.

## Duration Chain (STEP 10A-FIX)

```text
Research Brief
↓
Content Mode
↓
Editorial Value
↓
Duration Contract
↓
Story / Script
↓
Scene Script
↓
Audio
↓
Measured Timeline
↓
Video Spec
↓
Remotion
```

Target, estimated, and actual durations stay distinct fields until the measured
timeline becomes the single source of truth at render-ready.

## General Rules
1. **JSON Serializability**: All contracts must be valid, serializable JSON. Agent/vendor neutral.
2. **No Secrets**: No API keys, tokens, credentials, or chain-of-thought in any contract.
3. **Project-Relative Paths**: File paths must be project-relative (e.g., `assets/generated/image_001.png`), not absolute machine paths.
4. **Stable IDs**: Cross-contract references use stable IDs:
   - `sceneId` — links scenes across contracts
   - `assetId` — links assets in manifest to scene/audio/video specs
   - `audioId` — links audio tracks to scenes/video spec
5. **Invalidation on Upstream Change**: If an upstream artifact changes, all downstream artifacts referencing it must be regenerated/revalidated.
6. **Versioning**: Every contract must have a `version` field (semantic versioning recommended).
7. **No Chain-of-Thought**: Contracts contain production data only.
8. **Facts/Evidence Notes**: Only essential evidence/rationale for verification.

## Canonical Timing Rule (MANDATORY)

**All canonical external timing uses milliseconds:**

- `startMs` — start time in milliseconds from composition start
- `endMs` — end time in milliseconds
- `durationMs` — `endMs - startMs`

**Remotion implementation converts milliseconds → frames using FPS.** Frame numbers are NOT the source of truth in production contracts.

**Do not:**
- Use frame numbers as canonical timing in contracts
- Guess exact timing from text length
- Fabricate timestamps from narration alone

### Timing Status Values

Every timing field must have a `status`:

| Status | Meaning |
|--------|---------|
| `PLANNED` | Estimated timing for editorial planning |
| `MEASURED` | Timing derived from actual media/transcription evidence |
| `UNKNOWN` | No reliable timing available yet |

**Final render spec may only use exact timing when required timing is `MEASURED` or has equivalent valid evidence.** `PLANNED` and `UNKNOWN` timings are not sufficient for final render without measurement.

---

## Contract Details

### 1. Scene Script (`scene-script.json`)

**Schema**: `schemas/scene-script.schema.json`

**Purpose**: Editorial scene plan output from Stage 8. Contains narration, visual intent, and timing status.

**Key Fields**:
- `version`, `projectId`, `platform`, `topic`
- `scenes[]` with `sceneId`, `order`, `purpose`, `narration`, `visualIntent`, `assetRequirement`, `emotionIntent`, `timing` (with status), optional `onScreenText`, `audioCue`, `transitionIntent`, `evidenceNotes`

**Timing Rules**:
- `timing.status` must be one of `PLANNED`, `MEASURED`, `UNKNOWN`
- `startMs`/`endMs`/`durationMs` only present when status supports them
- Negative timing forbidden
- Duplicate `sceneId` semantically forbidden (not enforced by JSON Schema)

### 2. Asset Manifest (`asset-manifest.json`)

**Schema**: `schemas/asset-manifest.schema.json`

**Purpose**: Complete inventory of all assets with provenance and rights tracking. Updated through Stages 9-10.

**Key Fields**:
- `version`, `projectId`
- `assets[]` with `assetId`, `type`, `status`, `sourceType`, optional `path`/`url`, `providerId`, `mimeType`, dimensions, `durationMs`, `sceneIds[]`, `provenance`, `rights`

**Allowed Values**:
- `type`: `image`, `video`, `voice`, `music`, `sfx`, `font`, `other`
- `status`: `MISSING`, `PLANNED`, `GENERATING`, `READY`, `REJECTED`, `FAILED`
- `sourceType`: `existing`, `generated`, `local-library`, `third-party`
- `rights.status`: `VERIFIED`, `UNVERIFIED`, `UNKNOWN`, `NOT_APPLICABLE`

**Semantic Rules**:
- `READY` assets MUST have usable `path` or documented externally-resolvable source
- Final render MUST NOT silently consume `MISSING`/`FAILED`/`REJECTED` assets

### 3. Audio Manifest (`audio-manifest.json`)

**Schema**: `schemas/audio-manifest.schema.json`

**Purpose**: Audio track inventory with timing and mix parameters. Output from Stage 12.

**Key Fields**:
- `version`, `projectId`
- `tracks[]` with `audioId`, `type` (`voice`|`music`|`sfx`), `assetId`, `status`, optional `sceneId`, timing (`startMs`/`endMs`/`durationMs`), mix params (`volume`, `fadeInMs`, `fadeOutMs`, `ducking`), `deliveryDirection`, `timingEvidence`

**Rules**:
- No raw audio/base64 in manifest
- `assetId` resolves via asset manifest
- Exact timing not fabricated
- No platform-specific loudness target hardcoded in schema

### 4. Captions (`captions.json`)

**Schema**: `schemas/captions.schema.json`

**Purpose**: Caption items with evidence-based timing. Output from Stage 12.

**Key Fields**:
- `version`, `projectId`, `language`, `timingSource`
- `items[]` with `captionId`, `startMs`, `endMs`, `text`, optional `confidence`, `speaker`, `type` (`speech`|`sound`|`music`|`other`)

**Rules**:
- `startMs >= 0`, `endMs > startMs`
- Timing from measured/evidence source for final use
- Do NOT evenly divide narration to create fake timestamps
- Non-speech cues allowed when relevant
- Visual caption style NOT in this file (in video spec/platform/creative direction)

### 5. Video Spec (`video-spec.json`)

**Schema**: `schemas/video-spec.schema.json`

**Purpose**: Technical handoff to Remotion renderer. Output from Stage 13.

**Key Fields**:
- `version`, `project`, `platform`, `composition`, `scenes[]`, `globalStyle`, `render`

**Composition**:
- `width`, `height`, `fps`, `aspectRatio`, `durationMode`, optional `durationMs`
- Values from explicit user override or resolved platform profile
- `width`/`height`/`fps` > 0

**Scenes**:
- `sceneId`, `order`, `timing` (with `startMs`, `endMs`, `status`), `assetIds[]`, optional `onScreenText`, `animationIntent`, `transitionIntent`, `audioIds[]`
- Final render: `startMs` >= 0, `endMs` > `startMs`

**Global Style** (technical references only):
- `safeArea`, `captionStyle`, `motionStyle`, `typography`, optional `background`
- Does NOT duplicate Visual Bible

**Render**:
- `compositionId`, `outputName`, optional `codec`, `container`
- No hardcoded codec if not yet selected

## Step 11 Chain (Media Preflight → Measured Timeline)

Runtime Stages 11+12 preparation follows a strict evidence chain. Each link
consumes only the measured/validated output of the previous link; nothing is
estimated forward:

```text
Provider Assets (asset-manifest.json, audio-manifest.json)
↓
Media Preflight (lib/media-preflight.js → media-preflight.json)
↓
Measured Voice Timing (lib/voice-check.js + lib/transcript-alignment.js → timing evidence)
↓
Captions (lib/caption-builder.js / lib/caption-grouping.js / lib/caption-check.js → captions.json)
↓
Audio Mix Plan (lib/audio-timeline.js → audio-mix-plan.json)
↓
Measured Timeline (lib/audio-timeline.js buildMeasuredTimeline → timeline-measured.json + duration-evidence.json)
↓
Video Spec (video-spec.json)
↓
Step 12 Remotion (render; Step 12 consumes frame ranges via lib/step11-handoff.js)
```

**New contracts in this chain** (all additive; the 5 canonical contracts above
are unchanged):

| Contract | Producer | Schema |
|----------|----------|--------|
| `media-preflight.json` | `lib/media-preflight.js` `runPreflight` (probe via `lib/media-probe.js`) | `schemas/media-preflight.schema.json` |
| `audio-mix-plan.json` | `lib/audio-timeline.js` mix assembly | `schemas/audio-mix-plan.schema.json` |
| `timeline-measured.json` | `lib/audio-timeline.js` `buildMeasuredTimeline` | evidence object (`actualTimelineEndMs`, `sources[]`; target never pads) |
| `duration-evidence.json` | audio/caption build step | evidence object (target copied as reference only; `duration-contract.json` never overwritten) |

**Timing-status rule (MANDATORY):** an asset/track/caption is render-ready
only when its timing is `MEASURED` (probe-measured duration, WAV/PNG header,
ffprobe, or STT segment evidence with recorded `sources[]`). `PLANNED` and
`UNKNOWN` timings must gate review or block; they are never silently promoted
(e.g. `SEGMENT_TIMING` is never promoted to karaoke `WORD_TIMING`).

**Embedded-audio policy:** video assets carrying an audio stream default to
`MUTE_GENERATED_CLIP_AUDIO` unless the owning scene records an explicit
`clipAudioUse` (`USE_AS_PLANNED`, `MIX`, `REPLACE`).

## Remotion Boundary
- Remotion components consume validated `video-spec.json` (or validated object via input props)
- Renderer passes structured data via input props
- `calculateMetadata()` or equivalent resolves width/height/fps/duration from validated props/data
- No dependency on experimental codemod APIs for business contract definition
- Contract remains source of truth regardless of Remotion implementation changes

## Validation

Each contract has a JSON Schema (Draft 2020-12) in `schemas/`. Validation mechanism:

1. Parse schema file as valid JSON
2. Validate schema syntax with JSON Schema validator
3. Validate sample valid instance passes
4. Validate sample invalid instance fails (negative values, missing required fields)
5. No production validation framework — lightweight validation only