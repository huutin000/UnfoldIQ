# STEP 11 REPORT

## 1. Status

`PASS`

Step 11 (Media Preflight + Audio/Voice/Music/SFX/Captions + Measured Timeline) is implemented. All 126 acceptance criteria PASS. No Step 12 renderer, no production render.

## 2. Work Completed

### Media Preflight
- `schemas/media-preflight.schema.json` (READY/REVIEW_REQUIRED/BLOCKED; 7 asset types; rights/provenance/continuity/structural enums).
- `media-preflight.js` (`runPreflight`/`checkAsset`/STATUS): existence, confinement, non-zero, type/extension compat, probe, rights/provenance, fingerprint, continuity, scene association, required/optional, aspect treatment, short-clip coverage, embedded-audio policy, probe conflicts.
- `timeline-gap-check.js` (`checkGaps`): unexplained visual/narration/caption gaps, overlaps, early/late assets; intentional pause/hold/silence only with explicit type+purpose+bounded duration.
- `media-preflight-cli.js` (`--project/--json/--fix-safe`; exits 0/2/3/1; fix-safe only writes `preflight/` derivatives, never rewrites manifests).
- Live CLI proof on TEST-ONLY demo: 1×1 PNG → READY, FFPROBE-measured, `aspectTreatment: contain (1 → 1.7778)`, default policy `MUTE_GENERATED_CLIP_AUDIO` (demo removed afterwards).

### Media Metadata
- `media-probe.js`: ffprobe → WAV-header → PNG-header → UNKNOWN fallback; evidence `{source, measuredAt, toolVersion}` on every measured block; null (never estimated) fps/duration when unknown.
- `media-tool-doctor.js` (inspection-only, exit 0): ffmpeg/ffprobe AVAILABLE (8.1.1), remotion core+captions+media-utils AVAILABLE (4.0.529, transitive — not direct deps), whisper binary/model NOT_CONFIGURED, local-whisper timing REGISTERED, elevenlabs-stt policy-disabled.

### Voice / Timing
- `transcript-alignment.js`: MATCH/MINOR_DIFFERENCE/MATERIAL_DIFFERENCE/UNKNOWN; numbers/negation/units/dates/content changes material; truncation flagged; normalization limited to whitespace/Unicode/punctuation/quotes/case.
- `voice-check.js`: exists/non-zero/measurable-duration/language/alignment/truncation/silence checks; render-ready ⇔ `timingStatus: MEASURED`; pronunciation always `NOT_REVIEWED`.
- Timing priority implemented: provider timing → existing artifact → local-whisper → configured STT → external handoff (VT1–VT3); no timing → never READY (VT4); segments never promoted to words (VT5); `vi` via Kokoro → handoff, no fake audio (VT12: `external-handoff/HANDOFF_REQUIRED`).

### Captions
- `caption-builder.js` (canonical JSON + SRT + optional VTT from one items array; karaoke/word-emphasis requires WORD_TIMING with words[]), `caption-grouping.js` (platform-tuned: tiktok 42 chars vs youtube 84; measured boundaries; number/unit kept together), `caption-check.js` (12 validation rules incl. timing evidence + transcript-mismatch block).
- Modes NONE/SIDECAR/BURNED_IN/BOTH; timing separated from visual style; no fake karaoke.
- Live CLI proof: 2 measured segments → `captions.json` + `captions.srt` (READY, 2 items), SRT timestamps verbatim from canonical JSON.

### Music / SFX
- Music finalizes a plan (no generation required): path/provider, start/end, loop/trim, gain, fades, ducking, rights/provenance, QA. Rights-unknown music → BLOCKED (`MUSIC_RIGHTS_UNKNOWN`), never render-ready.
- SFX entries carry purpose; `filler`/missing purpose → `FILLER_SFX` review warning; nothing invented to fill silence.
- `@remotion/captions` NOT added as a dependency (present only transitively at matching 4.0.529; native grouping keeps zero-dep per §23/§57).

### Audio Mix
- `schemas/audio-mix-plan.schema.json` (voice/music/sfx tracks; gainDb −60..12; trims; loop; ducking with ranges; loudness `{MEASURED|NOT_MEASURED}`; clip-audio policy).
- `audio-timeline.js`: merged ends, intentional tails (purpose-required), anonymous-silence rejection, voice-overlap conflicts, `reconcileSceneVoice` (6 options, never auto-rate), `proposePlaybackRate` (explicit + 0.9–1.1 only), `buildMeasuredTimeline` (actual = max valid ends; target recorded-only).
- Ducking uses measured voice ranges; script-guessed ranges rejected (AM3). Loudness defaults `NOT_MEASURED`; measured values keep tool source (AM6/AM7). No universal LUFS target.

### Measured Timeline
- Target 60000 ms vs measured tracks → `actualTimelineEndMs: 6000`, status MEASURED (verbatim probe §13): target never pads, no black tail.
- `timeline-measured.json` shape: version/projectId/voiceEndMs/visualPlannedEndMs/captionEndMs/musicEndMs/sfxEndMs/intentionalOutroEndMs/actualTimelineEndMs/sources[]/status.
- Duration target never overwritten: `--build-mix-plan` writes `timing/duration-evidence.json`, never touches `duration-contract.json` (SC7/SC8).

### Remotion Handoff
- `step11-handoff.js` (pure): `msToFrames` deterministic (1000 ms@30 fps = 30), caption/audio frame ranges with no negative boundaries, duration frames from measured end, `assertNoBlackTail`.
- RH6: Step 11 modules contain no `renderMedia(` / `remotion render` invocations. No renderer built, no MP4 produced.

## 3. Files Created

- `schemas/media-preflight.schema.json`
- `schemas/audio-mix-plan.schema.json`
- `media-probe.js`
- `media-preflight.js`
- `timeline-gap-check.js`
- `media-preflight-cli.js`
- `media-tool-doctor.js`
- `transcript-alignment.js`
- `voice-check.js`
- `audio-timeline.js`
- `caption-builder.js`
- `caption-grouping.js`
- `caption-check.js`
- `step11-contract-check.js`
- `step11-handoff.js`
- `audio-caption-cli.js`
- `test-media-preflight.js`
- `test-voice-timing.js`
- `test-captions.js`
- `test-audio-mix.js`
- `test-measured-timeline.js`
- `test-step11-contracts.js`
- `test-remotion-handoff.js`
- `Report/STEP-11_REPORT.md` (this file)

## 4. Files Modified

- `schemas/captions.schema.json` — additive only (optional sceneId, evidence, words[], styleGroup, mode, timingLevel, profile/safeZone); required fields unchanged.
- `schemas/audio-manifest.schema.json` — additive only (optional language, voiceId, providerId, timingStatus, timingSource, transcriptSource, word/segmentTimingPath, qaStatus, purpose, gainDb, loop, trims, rights); required fields unchanged.
- `validate-schemas.js` — registered 2 new schemas + valid/invalid instance tests; existing tests intact.
- `core/PRODUCTION_CONTRACTS.md` — added Step 11 chain section + 4 new contracts + MEASURED-only rule; existing content kept.
- `core/WORKFLOW.md` — expanded Stage 11/12 text + implementation-step vs runtime-stage note; no renumbering (19 stages intact).
- `context/DOC_CATALOG.yaml`, `context/ROUTES.yaml` — stage-11 required media-preflight docs, conditional audio/caption docs, Flow/ComfyUI exclusion note.
- `platforms/youtube/PROFILE.yaml` — versioned `captionProfile` (SIDECAR/sentence/84 chars/2 lines/srt).
- `platforms/tiktok/PROFILE.yaml` — versioned `captionProfile` (BOTH/tiktok-style/42 chars/2 lines/srt, safeZone bottomPct 20).

## 5. Dependencies Changed

`None`. No packages added, removed, or upgraded. `@remotion/captions` and `@remotion/media-utils` resolve on disk (4.0.529, transitive via installed Remotion packages) but are NOT direct dependencies and are NOT imported by Step 11 code; caption grouping/SRT/VTT are implemented natively to avoid dependency churn per §57.

## 6. Commands Executed

| Command | Result |
|---|---|
| `node media-tool-doctor.js --json` | EXIT 0 — ffmpeg/ffprobe 8.1.1 AVAILABLE; remotion 4.0.529 AVAILABLE; whisper NOT_CONFIGURED |
| `node test-media-preflight.js` | EXIT 0 — MP1–MP15 PASS (30 assertions) |
| `node test-voice-timing.js` | EXIT 0 — VT1–VT12 PASS (20 assertions) |
| `node test-captions.js` | EXIT 0 — CP1–CP15 PASS (31 assertions) |
| `node test-audio-mix.js` | EXIT 0 — AM1–AM12 PASS (22 assertions) |
| `node test-measured-timeline.js` | EXIT 0 — TL1–TL12 PASS (24 assertions) |
| `node test-step11-contracts.js` | EXIT 0 — SC1–SC10 PASS (21 assertions) |
| `node test-remotion-handoff.js` | EXIT 0 — RH1–RH6 PASS (17 assertions) |
| `node test-provider-core.js` | EXIT 0 — 43 assertions PASS |
| `node test-continuity.js` | EXIT 0 — 20 assertions PASS |
| `node test-duration-planning.js` | EXIT 0 — 37 assertions PASS |
| `node test-flow-safety-retry.js` | EXIT 0 — SR1–SR20 PASS (34 assertions) |
| `node test-safety-provider-integration.js` | EXIT 0 — SAFE-E2E1–8 PASS |
| `node test-provider-resolution-e2e.js` | EXIT 0 — PR-E2E1–10 PASS |
| `node test-media-mcp.js` | EXIT 0 — MCP1–MCP15 PASS |
| `node test-context-routing.js` | EXIT 0 — PASS |
| `node test-policy-refresh.js` | EXIT 0 — PASS |
| `node test-policy-rights.js` | EXIT 0 — PASS |
| `node test-topic-registry.js` | EXIT 0 — PASS |
| `node test-editorial-quality.js` | EXIT 0 — PASS |
| `node validate-schemas.js` | EXIT 0 — ALL SCHEMAS PASS (23 files incl. 2 new) |
| `node mcp/unfoldiq-media/tests/run.js` | EXIT 0 — 5/5 PASS |
| `npx remotion compositions` (in `remotion/`) | EXIT 0 — `blank 30 1920x1080 60 (2.00 sec)` |
| `node media-preflight-cli.js --project __11_demo__` | EXIT 0 — READY, 1/1 assets (TEST-ONLY demo, removed after) |
| `node audio-caption-cli.js --validate __11_demo__` | EXIT 2 — BLOCKED `TIMING_NOT_MEASURED` (honest, no fabrication) |
| `node audio-caption-cli.js --build-captions __11_demo__` | EXIT 0 — READY, 2 items → captions.json + .srt |

## 7. Acceptance Criteria Validation

Media Preflight: 1 PASS (schema created) · 2 PASS (engine) · 3 PASS (MP1/exists) · 4 PASS (MP3) · 5 PASS (MP4) · 6 PASS (confinement via artifact-store) · 7 PASS (MP5 + AM2) · 8 PASS (provenance check) · 9 PASS (MP6) · 10 PASS (MP7 + SC10) · 11 PASS (SC1) · 12 PASS (MP14 required/optional) · 13 PASS (PNG/FFPROBE image) · 14 PASS (video fields; ffprobe when available) · 15 PASS (WAV duration/sample-rate/channels) · 16 PASS (evidence `{source, measuredAt, toolVersion}`) · 17 PASS (MP12 UNKNOWN stays UNKNOWN) · 18 PASS (MP13 PROBE_CONFLICT → REVIEW) · 19 PASS (MP8 aspectTreatment recorded) · 20 PASS (MP9 ACCIDENTAL_BLACK_BAR warning) · 21 PASS (MP10 short clip allowed + coverage note) · 22 PASS (MP11 embeddedAudio + MUTE default).

Voice/Timing: 23 PASS (manifest extension + voice-check fields) · 24 PASS (MEASURED gate; VT4) · 25 PASS (VT1 priority) · 26 PASS (VT2 existing-first) · 27 PASS (VT3 whisper segments) · 28 PASS (external handoff terminal state; VT12) · 29 PASS (VT6 probe duration) · 30 PASS (SEGMENT_TIMING level modeled) · 31 PASS (WORD_TIMING with words[]) · 32 PASS (VT5 no promotion) · 33 PASS (transcript-alignment.js) · 34 PASS (VT9 NUMBER) · 35 PASS (VT10 NEGATION) · 36 PASS (VT11 truncated + duration-ratio check) · 37 PASS (VT12 vi → handoff, transport never called for unsupported).

Captions: 38 PASS (canonical JSON via builder) · 39 PASS (toSrt; CP9) · 40 PASS (toVtt when profile.vtt; CP10) · 41 PASS (NONE → SKIPPED) · 42 PASS (SIDECAR; CP12) · 43 PASS (BURNED_IN mode) · 44 PASS (BOTH; tiktok profile) · 45 PASS (styleGroup separate from times) · 46 PASS (CP11 measured boundaries) · 47 PASS (CP8 no fake karaoke) · 48 PASS (platform captionProfile defaults) · 49 PASS (explicit profile.mode override path in builder/CLI) · 50 PASS (safeZone in profiles + CP13) · 51 PASS (caption-check.js; CP2–CP7) · 52 PASS (CP14 TRANSCRIPT_MISMATCH blocks) · 53 PASS (CP9/CP10 single-source derivation) · 54 PASS (CP15 deterministic IDs).

Audio: 55 PASS (audio-mix-plan schema) · 56 PASS (voice clips; AM1) · 57 PASS (music entries) · 58 PASS (sfx entries) · 59 PASS (AM2 + preflight music rights) · 60 PASS (gainDb; AM11) · 61 PASS (fadeIn/OutMs; AM11) · 62 PASS (trimStart/EndMs) · 63 PASS (loop; AM10 deterministic) · 64 PASS (ducking modeled) · 65 PASS (AM3 measured ranges) · 66 PASS (AM6 default NOT_MEASURED) · 67 PASS (AM7 tool-recorded) · 68 PASS (generatedClipAudioPolicy in schema + preflight) · 69 PASS (AM8 default MUTE) · 70 PASS (AM4/AM5 purpose rule, no filler requirement).

Timeline: 71 PASS (audio-timeline.js) · 72 PASS (buildMeasuredTimeline shape) · 73 PASS (TL1 max ends) · 74 PASS (TL2 target inert) · 75 PASS (TL3 black-tail rejected) · 76 PASS (TL4 outro) · 77 PASS (TL5 music tail) · 78 PASS (TL3/AM12 anonymous silence rejected) · 79 PASS (TL7 explicit pause) · 80 PASS (TL8 RECONCILE_REQUIRED + 6 options) · 81 PASS (TL10 rate guards) · 82 PASS (duration-evidence.json; SC7/SC8) · 83 PASS (no render code; RH6 + no MP4 produced anywhere).

Contracts/Context: 84 PASS (PRODUCTION_CONTRACTS.md chain section) · 85 PASS (WORKFLOW.md stages, 19 numbering intact) · 86 PASS (step-vs-stage note) · 87 PASS (DOC_CATALOG.yaml) · 88 PASS (ROUTES.yaml) · 89 PASS (captionProfile blocks, versioned, existing content kept) · 90 PASS (SC1–SC6 relationship checks) · 91 PASS (SC1–SC3 no orphans) · 92 PASS (RH1–RH5 ms→frames proof).

Tests: 93 PASS (MP1–MP15) · 94 PASS (VT1–VT12) · 95 PASS (CP1–CP15) · 96 PASS (AM1–AM12) · 97 PASS (TL1–TL12) · 98 PASS (SC1–SC10) · 99 PASS (RH1–RH6) · 100 PASS (doctor: no install/spawn beyond `--version`/resolve probes; exit 0) · 101 PASS (provider-core 43) · 102 PASS (continuity 20) · 103 PASS (duration 37) · 104 PASS (SR1–SR20 34) · 105 PASS (SAFE-E2E1–8) · 106 PASS (PR-E2E1–10) · 107 PASS (MCP1–MCP15 + self-test 5/5) · 108 PASS (context-routing) · 109 PASS (policy-refresh + policy-rights) · 110 PASS (topic-registry) · 111 PASS (editorial 37) · 112 PASS (validate-schemas incl. 2 new) · 113 PASS (remotion compositions listed).

Scope Guard: 114 PASS (no renderer code; RH6 scan) · 115 PASS (no MP4 produced) · 116 PASS (no publishing) · 117 PASS (no analytics) · 118 PASS (no ffmpeg install; detected 8.1.1 pre-existing) · 119 PASS (no whisper/model install) · 120 PASS (no paid calls; cloud tests mock-only, Step 11 calls none) · 121 PASS (no Flow generation/credits) · 122 PASS (MP12/AM6 probes stay UNKNOWN) · 123 PASS (VT4/CLI exit-2 blockers) · 124 PASS (AM6) · 125 PASS (no global mutation; demo cleaned, no config edits) · 126 PASS (this report; NOT_VERIFIED states explicit in §16).

## 8. Media Tool Doctor Evidence

`node media-tool-doctor.js --json` (verbatim excerpts, 2026-09-26, exit 0, no installs):

- `ffmpeg`: AVAILABLE — `ffmpeg version 8.1.1-essentials_build-www.gyan.dev`
- `ffprobe`: AVAILABLE — `ffprobe version 8.1.1-essentials_build-www.gyan.dev`
- `remotion.core`: AVAILABLE — `remotion ^4.0.529 (from remotion/package.json)`
- `remotion.captions`: AVAILABLE — `@remotion/captions 4.0.529` (transitive on-disk; NOT a direct dependency; NOT imported by Step 11)
- `remotion.media-utils`: AVAILABLE — `@remotion/media-utils 4.0.529` (same note as above)
- `whisper.binary`: NOT_CONFIGURED — `WHISPER_CPP_BIN unset; whisper-cli not on PATH`
- `whisper.model`: NOT_CONFIGURED — `WHISPER_CPP_MODEL unset`
- Timing providers: `local-whisper` REGISTERED (Step 10 adapter); `elevenlabs-stt` disabled by cost policy.
- Caption tooling summary: native builder (SRT/VTT) + safe-zone profiles; no render path.

## 9. Media Preflight Evidence

MP1 READY (valid PNG, FFPROBE-measured) · MP2 BLOCKED MISSING_FILE · MP3 BLOCKED ZERO_BYTE · MP4 BLOCKED PATH_TRAVERSAL · MP5 BLOCKED RIGHTS_BLOCKED · MP6 BLOCKED OUTDATED_FINGERPRINT · MP7 BLOCKED CONTINUITY_UNRESOLVED · MP8 READY + `aspectTreatment: contain` (1:1 → 16:9) · MP9 warning ACCIDENTAL_BLACK_BAR (letterbox hint, not designed) · MP10 short clip allowed + SHORT_CLIP_PLANNED_COVERAGE note · MP11 embeddedAudio recorded + MUTE_GENERATED_CLIP_AUDIO default · MP12 metadataStatus UNKNOWN (never MEASURED) · MP13 REVIEW_REQUIRED + PROBE_CONFLICT · MP14 OPTIONAL_MISSING warning-only · MP15 READY.

TEST-ONLY live CLI example (`__11_demo__`, removed after): missing-file case → BLOCKED; bad-rights case → BLOCKED; aspect case → `sourceAspect 1, targetAspect 1.7778, treatment contain`; short-AI-video case → allowed with coverage note (all mirrored in MP2/MP5/MP8/MP10).

## 10. Voice / Timing Evidence

VT1 provider timing accepted (alignment PASS) · VT2 existing-timing duration preserved verbatim · VT3 whisper segments → timing honored · VT4 no file → BLOCKED, never READY · VT5 SEGMENT+kar
...[truncated 4371 chars]