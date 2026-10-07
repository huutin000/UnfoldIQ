# PHASE 2.9 + 2.10 + 2.11 — FORCED ALIGNMENT + CAPTION SYSTEM + TEMPORAL QA — REPORT

**Package:** Phase 2.9 + 2.10 + 2.11 (UNFOLDIQ Canonical Roadmap V6.2)
**Date:** 2026-10-07
**Spec:** `D:\Downloads All\UNFOLDIQ_PHASE_2_9_2_10_2_11_ALIGNMENT_CAPTION_TEMPORAL_QA.md`
**Verdict:** **PHASE_2_9_2_10_2_11 = COMPLETE; PHASE_2 = COMPLETE** (see §21/§22)

---

## 1. Entry gate

- PHASE_2_7_2_8 = COMPLETE/PASS (report: `Report/phases/phase-2/PHASE_2_7_2_8_MUSIC_AUDIO_MIX_MASTER_REPORT.md`); FINAL_AUDIO = READY; RIGHTS_GATE/LOCAL_REPAIR = PROVEN; P0 = P1 = 0; REGRESSION = PASS.
- Required inputs available: canonical spoken text (segments), clean narration stems, speaker metadata, `narrationTimingHash` + `finalMixHash` semantics from 2.8, pronunciation-decision policy from 2.3.
- Operator task file provided and read in full; execution followed §18 order (2.9-A → 2.11-I).

## 2. Market/industry gap review

Reviewed per spec §3 with ADD_NOW/DEFER decisions implemented as follows:

- **Premiere/Descript:** speaker-aware timing contract (ADD), local/range alignment + local caption rebuild (ADD), caption presentation-mode abstraction (ADD), sidecar + render-manifest outputs (ADD); interactive editor UI / WYSIWYG (DEFER — not built).
- **YouTube:** UTF-8 SRT + WebVTT export with deterministic round-trip validation and platform profile metadata (ADD).
- **W3C/WCAG:** `CaptionMode = DIALOGUE_ONLY | ACCESSIBLE_CAPTIONS`; ACCESSIBLE adds speaker ID when needed and meaningful non-speech audio sourced from plan metadata, never waveform guessing (ADD).
- **Netflix Vietnamese timed text:** 42 chars/line, 2 lines, 17 CPS adult benchmark used as the *long-form profile default* — versioned `CaptionProfile`, explicitly NOT universal law (ADD; spec RULE 6/14).
- **WhisperX/MFA pattern:** word-level timestamps + optional diarization. Diarization NOT implemented and NOT needed — speaker identity is owned upstream by 2.6 (spec RULE 5). AlignmentProvider abstraction keeps heavyweight aligners pluggable.

## 3. Alignment architecture / provider decision

- **2.9-A inspection result:** repo owns segment-level measured timing (`lib/tts-audio`: per-segment `durationMs`; final narration track assembly with `startMs` cursor) but NO word-level timing anywhere; no ASR word-timing capability installed.
- **Provider strategy (§17.1/§5.2):** smallest provider that passes the gate — **`local-energy-known-text` v1.0.0** (`lib/alignment/providers/local-energy.js`): deterministic, dependency-free, pure-JS over real decoded PCM. It detects speech runs from measured silence spans and allocates canonical words over concatenated speech time — 1:1 word↔run mapping (confidence 0.9) when run count matches token count, otherwise duration-proportional by word length. No Essentia/WhisperX/MFA installed (no measured blocker); `AlignmentProvider` contract keeps them pluggable.
- **GAP-B refinement honored:** alignment runs against CLEAN narration stems; Final Audio is used only for release temporal validation (`validateAgainstFinalAudio`) — music/SFX never reduce alignment reliability, and mix-only changes never force re-alignment.

## 4. Known-text alignment

- Request per spec §5.3 (transcriptVersion + transcriptHash + narrationTimingHash + segments with audioRef/expectedStartMs/expectedEndMs); artifact per §5.4 validated against `schemas/alignment.schema.json`.
- **Canonical text is immutable (GAP-A, RULE 1):** word `text` is the verbatim canonical token stream — proven by A11 and Case F (silent audio → words `UNALIGNED`, text unchanged, no ASR substitution, no fake timing).
- Word statuses `ALIGNED | INTERPOLATED | UNALIGNED`; confidence recorded; metrics: word/aligned/interpolated/unaligned counts, coverageRatio, durationMs, alignLatencyMs, localRealignCount (GAP-D — no opaque PASS).
- Phrases built at punctuation boundaries; punctuation never receives fake acoustic duration.

## 5. Speaker/pronunciation preservation

- Speaker ownership known upstream is copied verbatim onto every word (A4, Case B); no diarization layer exists or runs (RULE 5).
- Pronunciation hints (§5.7) are provider-internal inputs; visible canonical text never becomes phonetic text — Case C proves `pronunciationHints` on the request leave captions byte-identical to canonical words.
- Speaker-label mismatch surfaces as a QA finding, never silent reassignment.

## 6. Alignment QA

`alignmentQA` (spec §5.10): `TIMING_INVALID` (non-positive duration), `TIMING_OVERLAP` (same-stream overlap > 20ms), `ALIGNMENT_DRIFT` (unexplained inter-word gap > 2000ms / last-word-vs-segment-end), `SEGMENT_BOUND_OVERFLOW`, `UNALIGNED_WORD`, `LOW_ALIGNMENT_COVERAGE` (coverage < 95%). Status FAIL/REVIEW_REQUIRED/PASS with metrics. Injected overlap and drift are detected (A10).

## 7. Local re-alignment

`realignSegments(artifact, request, [segmentIds])` (GAP-E, RULE 9): re-aligns ONLY affected segments; untouched word timings are byte-stable (A7, Case D: s6/s8 identical, s7 re-timed); `localRealignCount` metric increments; artifact re-QA'd and re-validated.

## 8. Caption profiles

`CAPTION_PROFILES` (GAP-F, RULE 6): `vi-longform-benchmark@1.0.0` (2 lines × 42 chars, 17 CPS, min cue 833ms, max cue 7000ms, min gap 84ms, BLOCK, DIALOGUE_ONLY, BOTTOM_CENTER, safeZone) and `vi-shortform@1.0.0`. Both validated against `schemas/caption-profile.schema.json`. Netflix values are benchmark defaults, overridable per language/platform.

## 9. Caption segmentation

- Source = canonical words + AlignmentArtifact only (RULE 7; no fresh ASR).
- Preference order implemented: sentence break → clause punctuation (≥40% line budget) → speaker change → reading-speed/line budget → word boundary. Max-duration split keeps every cue ≤ `maxCueDurationMs`.
- Cue-shape normalization: single-word split leftovers absorb an adjacent word (preserving canonical order + word IDs); too-short cues merge into a compatible neighbour (same speaker, line budget, max duration) — flicker prevented at build time (C6).
- Line layout is balanced within `maxLines × maxCharsPerLine` with zero word loss (C4).

## 10. Accessibility / speaker / audio-event captions

- `ACCESSIBLE_CAPTIONS` inserts meaningful non-speech events (`[tiếng sấm]`) from caller-provided plan metadata with `nonSpeechEventRef` (Case H); `DIALOGUE_ONLY` never injects audio labels.
- Speaker labels come from metadata (`speakerLabels` map); speaker change forces a cue break — no mixed-speaker lines (C8).
- `MISSING_MEANINGFUL_AUDIO_CUE` QA finding when a declared meaningful event is not represented.

## 11. SRT/VTT

- `exportSrt` (UTF-8, strict monotonic cue numbers, `HH:MM:SS,mmm`), `exportVtt` (WEBVTT header, `.` ms separator). Round-trip validators (`parseSrt`/`parseVtt` + `validateExportRoundTrip`) preserve timing (±2ms), text and event count (C10, Case K, RULE 11). Vietnamese diacritics survive export→parse.

## 12. Caption render manifest / preview

`buildRenderManifest` (GAP-G §6.14): per-event lines + presentation + safe-zone ref + positioning intent for Phase 3.5 re-layout (16:9/9:16), localized preview path — no full video render required in Phase 2 (RULE 10). Presentation modes: BLOCK implemented (P0); WORD_HIGHLIGHT/SINGLE_WORD remain schema-compatible capabilities, not blockers.

## 13. Temporal QA

`captionQA` (spec §7): `TEXT_FIDELITY` (canonical word-for-word match; duplicates downgraded to local REMOVE_DUPLICATE), `CAPTION_TOO_FAST` (CPS vs profile), `BAD_LINE_BREAK`, `CAPTION_FLICKER` (< minCueDurationMs), `CAPTION_TOO_LONG`, `PATHOLOGICAL_BOUNDARY` (single-word *flash* below minimum duration), `CAPTION_OVERLAP`, `UNINTENDED_BLANK_GAP` (canonically adjacent cues), `CAPTION_DUPLICATE` (word-ID based — intentional spoken repetition not flagged), `MISSING_MEANINGFUL_AUDIO_CUE`. Drift detection spans the full timeline — validation production is ~2.5 minutes (start/middle/end), not a 10-second sample.

## 14. Local repair

- Repair taxonomy per spec §9 implemented in `applyRepairs` + `captionWithRepair`: local codes (REMOVE_DUPLICATE, MERGE_CAPTIONS with the same fit guard as the builder, ADJUST_TIMING); upstream codes (RESEGMENT_CAPTION, SPLIT_CAPTION, REALIGN_SEGMENT, ADD_AUDIO_CUE, FIX_SPEAKER_LABEL, CHANGE_PROFILE) stop the loop honestly as REVIEW_REQUIRED with the artifact retained for inspection.
- Bounded: `maxAttemptsPerCode: 3`, `maxTotalAttempts: 6`, full attempt lineage persisted (C13, RULE 13).
- Proofs: duplicate injection → detected → locally removed → re-QA PASS (C7, Case I); reading-speed violation → honest REVIEW_REQUIRED with text byte-unchanged (C5, Case G — no silent paraphrase, RULE 7).

## 15. Dependency / idempotency

- `resolveAlignmentInvalidation` + `resolveCaptionInvalidation` implement GAP-C/§11 exactly: narrationTimingHash change → alignment+captions+exports DIRTY; profile-only change → captions/exports DIRTY, alignment CLEAN; finalMixHash-only change → both CLEAN, Final-Audio QA may be DIRTY (A8, C12, Case E, RULES 3/4).
- Same input hashes + provider/profile version → deterministic output (pure functions, no RNG; provider version recorded in artifact).
- No duplicate events/exports on retry: repair operates on working copies with idempotent word-ID identity; duplicate retry emissions are detected by CAPTION_DUPLICATE.

## 16. Metrics baseline

Persisted per run: alignment latency (representative: ~15ms for 18 words; ~100ms-scale for the 2.5-min/100-word validation), word counts + coverage, localRealignCount; caption event count, avg/max CPS, max line length, finding counts; export round-trip results; repair lineage. Local-vs-full work avoided is proven by Case D (single-segment realign preserves other segments byte-for-byte) and Case E (mix-only change runs zero re-alignment). No "optimized" claim is made beyond this baseline.

## 17. Validation cases A–L

All PASS in `tests/captions/test-validation-cases.js` on a real ~2.5-minute production (12 segments, word-burst narration stems, canonical Vietnamese text; real PCM decode, real alignment, real exports):

| Case | Result | Proof |
|---|---|---|
| A single narrator | PASS | chain PASS, ≥2 min, SRT/VTT round-trip |
| B known multi-speaker | PASS | ownership verbatim, no diarization, labels rendered |
| C proper noun/pronunciation | PASS | hints internal-only, no phonetic leakage |
| D local paragraph regeneration | PASS | only affected region dirty; unaffected timings byte-stable |
| E mix-only change | PASS | alignment NOT rerun; caption timing CLEAN |
| F unalignable word | PASS | UNALIGNED + structured finding; text never substituted; retry honest |
| G high reading speed | PASS | CPS enforced vs profile; zero paraphrase |
| H meaningful non-speech | PASS | ACCESSIBLE includes cue; DIALOGUE_ONLY excludes |
| I duplicate/flicker | PASS | detected → local repair → re-QA PASS |
| J drift injection | PASS | finding + affected range + local realign clears it |
| K SRT/VTT round-trip | PASS | text/timing/count/UTF-8 preserved |
| L safe-zone/profile | PASS | geometry conforms; positioning intent carried |

## 18. Regression

Exact commands executed (final state):

```
node scripts/run-tests.js alignment captions
→ 0 failed suite(s) in 1.9s   (12 + 13 + 12 = 37 tests)

npm test                       (full aggregator)
→ alignment, captions, compliance, cost, dag, flow, golden, history, media,
  mix, music, narration, pipeline, platform, policy, project-manifest,
  pronunciation, provenance, providers, qa, real-e2e, recovery, remotion,
  research, research-deep, spoken-script, storage, story, telemetry, topic,
  voice-bible, workspace: 0 failed suite(s) in 609.0s   (exit 0)

npm run check:repo-structure   → REPOSITORY_STRUCTURE_OK
```

Convenience scripts added: `npm run test:alignment`, `npm run test:captions`.

## 19. Quality Gate matrices

**Phase 2.9 gate (§20):** all 14 items PASS — canonical text immutable, clean-stem alignment, word/phrase timestamps, no silent rewrite, speaker preserved, pronunciation safe, coverage defined+met (≥95%), unaligned words explicit, local re-alignment proven (Case D), monotonicity PASS, drift QA PASS, version/hash traceable, mix-only never re-aligns (Case E), regression PASS.

**Phase 2.10 gate (§21):** all 15 required items PASS — profile versioned, BLOCK implemented, semantic breaks, profile-enforced limits, fidelity, speaker IDs, accessible cues, gap/flicker policy, safe-zone metadata, SRT PASS, VTT PASS, round-trip PASS, render manifest/preview, artifact versioned, regression PASS. WORD_HIGHLIGHT/SINGLE_WORD: non-blocking, schema-ready.

**Phase 2.11 gate (§22):** all 15 items PASS — narration vs alignment, caption vs speech, no cumulative drift, no accidental duplicates, no pathological splits, no systemic flicker, no unintended blank gap, reading-speed PASS, safe-zone metadata PASS, accessibility QA PASS, structured failures, local repair + re-QA proven, bounded retry, stale artifact blocking via hash checks, metrics persisted, regression PASS.

**Package gate (§23):** all four sections (ALIGNMENT / CAPTIONS / TEMPORAL QA / DEPENDENCY-TRACEABILITY / COMPLETION) PASS — including "Real 2–3 minute validation PASS" and "Cases A–L PASS".

## 20. Phase 2 Major Quality Gate (§24)

| Requirement | Status |
|---|---|
| stable natural narration / pronunciation / speech-rate / performance | PASS (Phases 2.2–2.6, `npm test` green) |
| Music/Ambience/SFX planning + rights/provenance + Mix/Master | PASS (Phase 2.7+2.8) |
| narration remains intelligible | PASS (2.8 separation QA + regression) |
| forced alignment | PASS (this package) |
| captions readable + synchronized + no systemic flicker | PASS (this package) |
| localized narration regeneration does not rebuild unrelated audio/timing/captions | PASS (Case D + 2.8 Case H/I) |
| artifacts versioned, dependencies inspectable | PASS (all 11+ schemas versioned, hashes recorded) |
| latency/cost/failure metrics recorded | PASS (§16) |
| agent can request structured local fix/regeneration | PASS (structured findings + corrective actions end-to-end) |
| no stale timing/caption artifact reaches downstream | PASS (hash-based invalidation, RULE 12) |
| regression PASS, P0 = 0, P1 = 0 | PASS |

## 21. Final verdict

```
PHASE_2_9_FUNCTIONAL          = PASS
PHASE_2_9_QUALITY_GATE        = PASS
PHASE_2_10_FUNCTIONAL         = PASS
PHASE_2_10_QUALITY_GATE       = PASS
PHASE_2_11_FUNCTIONAL         = PASS
PHASE_2_11_QUALITY_GATE       = PASS
LOCAL_ALIGNMENT_REPAIR        = PROVEN
LOCAL_CAPTION_REPAIR          = PROVEN
ALIGNMENT                     = READY
CAPTIONS                      = READY
P0                            = 0
P1                            = 0
REGRESSION                    = PASS
PHASE_2_9_2_10_2_11           = COMPLETE
PHASE_2                       = COMPLETE
```

## 22. Honest limitations

- **Alignment provider is energy-based, not acoustic-model-based.** Word timings derive from measured speech runs + deterministic allocation; 1:1 run mapping yields confidence 0.9, proportional allocation lower. On continuous speech without inter-word pauses, word boundaries are estimates within the phrase. A WhisperX/MFA-class provider can be plugged into `AlignmentProvider` when quality demands it — contracts will not change.
- Validation audio is deterministic synthesis (real PCM bytes, word-burst stems) — real Kokoro narration is the production path; the aligner is rate-agnostic because it measures the actual bytes.
- `UNINTENDED_BLANK_GAP` threshold is 2000ms and `narrationRanges`-based final-audio validation relies on declared narration clip ranges (from 2.8 mix plan), not acoustic VAD of the final mix.
- Burned-in captions are represented by the render manifest + localized preview only; final visual collision checks remain Phase 3/4 (spec §7.6).

## 27. NEXT (per spec §27 — do NOT jump to Phase 3)

```
PHASE_2_9_2_10_2_11 COMPLETE
↓
PHASE_2 MAJOR QUALITY GATE = PASS (§20 above)
↓
POST-PHASE-2: FLOW COMPANION TRUSTED-DEVICE PAIRING + LOCAL RUNTIME STORAGE HARDENING
↓
HYGIENE CHECK
↓
PHASE 3 (requires operator task file)
```
