# PHASE 2.7 + 2.8 — MUSIC / AMBIENCE / SFX + AUDIO MIX / MASTER — REPORT

**Package:** Phase 2.7 + 2.8 (UNFOLDIQ Canonical Roadmap V6.2)
**Date:** 2026-10-07
**Spec:** `D:\Downloads All\UNFOLDIQ_PHASE_2_7_2_8_MUSIC_AUDIO_MIX_MASTER.md`
**Verdict:** **PHASE_2_7_2_8 = COMPLETE** (see §20 Final Verdict)

---

## 1. Entry gate

- Previous package Phase 2.4 + 2.5 + 2.6: COMPLETE/PASS (per session memory; `npm test` was green before this package started).
- Operator task file provided and read in full before implementation.
- Execution order followed spec §13 (2.7-A → 2.8-J), no parallelization of dependent contracts.
- Minimum video input rule not applicable (this is a pipeline-capability package, not a video production run).

## 2. Scope / non-goals

Implemented: Music Necessity Gate, Music Intent, Vocal Policy, Acquisition Brief, Local Approved Library + Rights/Provenance, Audio Analysis, MusicPlan/cues/segment strategy, Ambience/Foley/SFX/Stinger, Semantic Audio QA, AudioMixPlan, narration normalization, measured gain staging, dynamic importance-aware ducking, trim/loop/fade/crossfade, loudness/peak/clipping/silence QA, structured bounded repair, lock/dependency/idempotency, Final Audio artifact, metrics baseline.

Non-goals respected (not built): Forced Alignment (2.9), Captions (2.10), Caption temporal QA (2.11), Master Timeline (Phase 3), full render QA (Phase 4), publishing, legal-advice engine. No scraping of licensed-music websites.

## 3. Music Necessity Gate

`lib/music-intent/index.js` — `gateSegment`:

- Presence values `NONE | BED | FEATURED`; purpose enum `EMOTION | TENSION | PACING | TRANSITION | IDENTITY | ENERGY | CONTRAST`.
- NONE drivers checked first: explicit upstream NONE, dramatic pause, quote/testimony focus, ambience-sufficient.
- Mandatory invariant enforced: **no valid narrative purpose → `MusicPresence = NONE`** (narration alone is NOT treated as a purpose — the "videos have background music" anti-pattern is rejected by rule; tests T1/T6).
- FEATURED only for actually narration-free foreground contexts (montage/intro/outro/musicMoment). Narration-active segments can never be FEATURED (found and fixed during validation: `lib/music-intent/index.js:presence` rule).
- Music cues are grouped by narrative boundaries (`groupCues`): new cue on presence change, purpose change, or intentional-silence split — never a 1:1 scene mapping (test P1, Case C).

## 4. Vocal Policy

- Decided **before** track selection, per segment, in the same gate pass.
- `INSTRUMENTAL_ONLY` whenever narration/dialogue active or information density HIGH or quote — default canonical rule.
- `VOCAL_FEATURED` only for music-as-foreground moments without narration.
- `VOCAL_ALLOWED` only when no speech competition.
- Library search enforces the policy: `INSTRUMENTAL_ONLY` excludes `LYRICAL_VOCAL` assets (test L11); semantic QA re-verifies (`VOCAL_COMPETES_WITH_SPEECH`, test P8).

## 5. Music Acquisition / Local Library

- `lib/music-library/index.js`: repo-level Approved Local Library at `assets/music/library-index.json` + content-hash-addressed WAV bytes in `assets/music/audio/`; atomic writes (tmp+rename).
- Provider policy (§3.5 of spec) encoded as `PROVIDER_POLICY`: `RANDOM_WEB`, `YOUTUBE_UPLOAD`, `UNKNOWN_REPO` are rejected at ingest (test L3).
- Bootstrap acquisition is human-in-the-loop: `buildAcquisitionBrief` emits a schema-valid brief (narrative role, mood, energy, BPM range, vocal policy, target cue duration, provider candidates) with operator instructions and disallowed sources (test L12). When no approved asset fits a cue, `buildMusicPlan` records structured `acquisitionNeeds` (test P6) instead of faking an assignment.
- Ingest measures `durationMs` from real decoded PCM bytes (never trusts metadata), sha256 dedup (test L1/L2), non-WAV rejected (test L4).
- Reuse metrics: `reuseCount`/`lastUsedAt` per asset (test L13).

## 6. Rights / Provenance

- Every record carries embedded fail-closed rights (`normalizeRights`): missing license evidence, `licenseType UNKNOWN`, or `reuseScope UNKNOWN` escalates `APPROVED → REVIEW_REQUIRED` (test L5).
- Per-project usage decision `decideUsage(rights, {projectId, targetPlatforms, commercialContext})` evaluates platform scope, commercial/paid-ads context, and `validForNewProjectsUntil` expiry (tests L6–L8). Fail-closed: missing rights / REVIEW_REQUIRED / REJECTED / UNKNOWN scope can never yield `APPROVED_FOR_PROJECT` (test L9).
- `REVIEW_REQUIRED` and `REJECTED` cannot enter Final Audio: planner only assigns assets with `APPROVED_FOR_PROJECT` (ref recorded per cue as `usageDecisionRef`); semantic QA and the lock gate re-verify (tests P7, Case G).
- `LOCAL ≠ PERMANENTLY LICENSED` holds: rights live on the record and are re-evaluated per project/decision, not implied by file presence.

## 7. Audio Analysis

- `lib/music-analysis/index.js` — one-time analysis per asset at ingest: energy curve (200ms RMS frames, peak-normalized), section segmentation + classification (`INTRO/LOW_ENERGY/BUILD/CLIMAX/OUTRO`), `safeCutPointsMs` (section boundaries + local energy minima), `loopCandidates` (boundary-similarity + flatness, confidence ≥ 0.6), silence regions, and measured loudness/peak metadata (tests A1–A8).
- BPM via onset-envelope autocorrelation; **omitted** when confidence < 0.5 (no over-claiming on non-rhythmic material, test A7).
- `lib/audio-loudness.js` — pure-JS ITU-R BS.1770-4: K-weighting (RBJ bilinear shelf + high-pass), 400ms gated integrated loudness with absolute/relative gating, LRA per EBU Tech 3342, and a 4x Catmull-Rom **true-peak estimate** (documented as an estimate, not a certified oversampler). Validated: −20 dBFS 1 kHz sine ≈ −23.3 LUFS (reference −23.7, engineering tolerance ±0.7 dB of the general-fs RBJ design; a +2 dB shelf-sign bug was found by test B1 and fixed). No Essentia/librosa dependency was added (no measured blocker; existing tooling sufficient per spec §10).

## 8. MusicPlan / Ambience / SFX

- `lib/music-plan/index.js` `buildMusicPlan`: versioned artifact (`music-plan.schema.json`) with intents, cues, ambience, sfx, intentionalSilence, inputHashes.
- Segment selection (§3.10): long track → `bestSourceRegion` scores windows anchored at section boundaries/safe cuts by **mean absolute deviation** from the intent energy (fixed during validation: mean-only scoring allowed a window that averaged a quiet intro with a loud body; the MAD rule plus INTRO/OUTRO penalty prevents that) — never blindly 00:00 (test P2, Case E). Short track → `decideLoopStrategy` decision order: safe LOOP (beat/structure candidate + crossfade) → SILENCE_FALLBACK (≥50% coverage) → NEEDS_NEW_SEGMENT; never copy-N, never time-stretch (test P4, Case D).
- Ambience is an independent role with association, continuity, layer (FOREGROUND/BACKGROUND), fade/crossfade intent (§3.12). SFX roles FOLEY/ONE_SHOT_SFX/STINGER with priority BACKGROUND/SUPPORTING/FEATURED and `duckMusic` for featured events (§3.13). Purposeless SFX flagged `SFX_EVENT_MISMATCH` (test P12).
- Cue state: `locked` + `lockGate` (semantic QA + rights) persisted on the artifact.

## 9. Semantic QA

- `semanticQA(plan)` runs pre-lock with canonical codes: `MUSIC_NOT_NEEDED`, `MUSIC_NEEDED_BUT_MISSING`, `VOCAL_COMPETES_WITH_SPEECH`, `RIGHTS_NOT_APPROVED`, `BAD_CUE_TRANSITION` (adjacent identical source regions), `AMBIENCE_CONTEXT_MISMATCH`, `SFX_EVENT_MISMATCH` (tests P7/P8/P10/P12).
- Repair routing is machine-readable: every finding carries a corrective action from the contract enum (`REPLACE_TRACK`, `REPLACE_ASSET`, `RETURN_2_7`, …).
- Lock policy (§6): `LOCK_CUE` requires semantic QA PASS + `APPROVED_FOR_PROJECT` + assigned asset; locked cues survive unrelated re-plans via `mergeLockedCues` keyed on identity inputs (asset, source region, timeline range, role) — tests P9/P11.

## 10. AudioMixPlan

- `lib/audio-mix/index.js` `buildMixPlan` → validated against the **extended** `schemas/audio-mix-plan.schema.json` (backward-compatible: `fromMs` preserved alongside new `startMs`; new optional `duckingRules`, `gainAutomation`, `loudnessProfileRef`, `peakPolicyRef`, `inputHashes`, `tracks.ambience`, clip `loopPlan`/`segmentId`/`importance`).
- Versioned loudness profiles (`LOUDNESS_PROFILES`): `youtube-standard@1.0.0` (−14 LUFS ±2, maxTruePeak −1 dBTP, narration anchor −16 LUFS, minSpeechSeparation 10 dB), `tiktok-short@1.0.0`. No broadcast value hard-coded as universal.
- `inputHashes.narrationTiming` + Final-Audio-level `narrationTimingHash` implement the §5 invalidation distinction (see §14).

## 11. Ducking / Gain / Fade / Crossfade

- **Narration is the mix anchor** (§4.2): `normalizeNarration` measures the track (BS.1770-4) and applies base gain toward `narrationTargetLufs` with per-segment consistency correction capped ±3 dB so leveling never becomes pumping (test M6).
- **Measured gain staging** (§4.3): no hard-coded percentages. Every clip's `gainDb = roleTarget − measuredSourceLufs` with role targets relative to the narration anchor (music BED −16 / FEATURED −4; ambience −26/−12; sfx −22/−14/−6), clamped [−24, +12].
- **Dynamic ducking** (§4.4/4.5): deterministic engine envelopes at 10ms resolution; depth LIGHT 6 / MEDIUM 12 / STRONG 15 dB; attack 40ms; recovery NATURAL 800 / FAST 250 / SLOW 1500 ms; importance-aware depth multipliers NORMAL/IMPORTANT/CRITICAL = 1.0/1.15/1.3 (capped at STRONG). Narration activity comes from measured narration clip ranges, not guesses.
- **Important SFX priority** (§4.6): FEATURED SFX dips music (−6 dB, 30ms attack) even where no narration duck applies — verified by stem measurement in Case F.
- **Trim/loop/fade/crossfade** (§4.8): engine executes 2.7's decisions — trim to source region, equal-power loop with crossfaded junctions (`renderLooped`), fade-in/out, boundary fades between adjacent cues. 2.8 never rescues a wrong track with volume/EQ; `TRY_ALTERNATE_LOOP`/`REPLACE_TRACK` route back to 2.7.

## 12. Loudness / Peak / Clipping / Silence

- `mixQA` measures the rendered master with BS.1770-4: `LOUDNESS_OUT_OF_POLICY` (integrated vs profile ±tolerance), LRA review threshold, `TRUE_PEAK_POLICY_FAIL` (estimated dBTP vs `maxTruePeak`), `CLIPPING` (int16 ceiling) — clipping is a blocking failure (`FINAL_AUDIO_READY = FALSE` until repaired).
- `UNEXPECTED_SILENCE`: regions ≥1500ms with no declared intentional-silence coverage (comparison allows a 1000ms margin for fade tails — declared dramatic pauses are never flagged, test M5/Case A).
- `NARRATION_LEVEL_INCONSISTENT` (>6 dB spread), `ABNORMAL_GAIN_JUMP` (>6 dB / 10ms on duck envelopes), `DUCK_PUMPING` (oscillation count), `DURATION_MISMATCH` (±250ms).
- Remaster is peak-safe by construction: loudness gain always ships with a true-peak limiter (ceiling = `maxTruePeak` − 0.3 dB interpolation margin), and the engine applies master gain **before** limiting. (Found via validation: an unclipped remaster previously pushed an already-hot master into clipping.)

## 13. Local QA / Auto-repair

- `mixWithRepair`: execute → QA → apply corrective actions → re-execute → re-QA, fully bounded (`maxAttemptsPerCode: 3`, `maxTotalAttempts: 6`), with a per-attempt **lineage** (findings, actions, metrics) persisted in the result — no silent repair (§7 observability).
- Repair taxonomy implemented per §4.14: `ADJUST_MUSIC_GAIN`, `ADJUST_DUCKING` (depth escalation, then deficit-scaled local gain cut), `ADJUST_ATTACK_RELEASE`, `REPAIR_FADE`/`REPAIR_CROSSFADE`, `ADJUST_SFX_GAIN`, `ADJUST_AMBIENCE_GAIN`, `GAIN_CORRECTION` (headroom-aware via `deficitDb`), `LIMIT`, `REMASTER` (cumulative measured master gain + limiter), `NORMALIZE_NARRATION`. Repeated findings on the same target are deduped per pass (max deficit wins) so one pass cuts a clip once.
- Non-local codes (`RETURN_2_7`, `REPLACE_TRACK`, `REPLACE_ASSET`, `REPAIR_TIMING`, `TRY_ALTERNATE_LOOP`) stop the local loop with an honest terminal status (`RETURN_2_7` / `REVIEW_REQUIRED`), never an uncontrolled retry (test M9).
- Proofs: mask injection repaired locally then PASS (M3, Case H); clipping/peak repaired via GAIN_CORRECTION + LIMIT then PASS (M4); budget exhaustion terminates honestly (M9).

## 14. Dependency / Idempotency

- Mix-only change (music gain/fade) → `narrationTimingHash` **unchanged**, `finalMixHash` **changed**, narration source bytes untouched, library index untouched (no TTS regeneration, no re-download, no Image/Veo regeneration) — Case I. Narration timing change → `narrationTimingHash` changes → Phase 2.9 will key alignment invalidation on this distinction (hashes prepared per spec §5).
- Locked cues survive re-planning when identity inputs are unchanged (`mergeLockedCues`, test P11); failing a cue does not regenerate unrelated assets (Case H).
- Stale inputs cannot become Final Audio: FinalAudioArtifact records `mixPlanVersion`, both hashes, and `sourceDependencies`; QA status must be `PASS` (only PASS finalizes, test M8).

## 15. Before/After evidence

Local repair (Case H, representative run):

| | Before (injected mask) | After (repair lineage) |
|---|---|---|
| Finding | `MUSIC_MASKS_SPEECH`, deficit ≈ 19.5 dB under narration ranges | none |
| Action | — | `ADJUST_DUCKING` (STRONG + deficit-scaled gain cut) → re-render → re-QA |
| Status | FAIL | PASS |

Clipping path (test M4): injected +12 dB voice / +6 dB music → findings `CLIPPING`, `TRUE_PEAK_POLICY_FAIL`, `LOUDNESS_OUT_OF_POLICY` → `GAIN_CORRECTION` + `LIMIT` (+ cumulative `REMASTER` where loudness is out of policy) → PASS with true peak ≤ policy.

Clean production (representative): integrated −15.9 LUFS, LRA ≈ 2–5, truePeak ≤ −1 dBTP, duration 150000ms (2.5 min), all stems per-role targets. Attempt lineage and metrics recorded in `mixWithRepair().lineage`.

## 16. Metrics baseline

Captured per run (in-module, returned in results):

- `buildMixPlanMs` (mix-plan build incl. loudness measurement of every source) — representative: tens of ms.
- `mixQaMs` (BS.1770 + QA over 2.5 min audio) — representative: < 100 ms.
- `mixWithRepair().attempts` + full lineage (repair count per code; repair success = PASS after repair).
- Library: `reuseCount`/`lastUsedAt` (track reuse rate), library hit vs `acquisitionNeeds` (local-library hit rate / replacement count).
- Latency/optimization claims beyond this baseline are NOT made (spec §8: no "optimized" claim without baseline + evidence).

## 17. Validation cases

Spec §12 Cases A–I — all PASS in `tests/mix/test-validation-cases.js` on a ~2.5-minute synthetic production (real bytes, real decode, real mix, real QA; no mocks):

- **A No Music** PASS — zero cues, ambience + intentional silence valid, no accidental-music assumption.
- **B Narration + Instrumental Bed** PASS — gate, instrumental policy, ducking rules, intelligibility, loudness.
- **C Multi-cue** PASS — distinct narrative purposes per cue, declared silence between, no bad transitions.
- **D Short Music Asset** PASS — 25s asset for 30s cue → LOOP strategy with crossfade, QA PASS.
- **E Long Music Asset** PASS — 180s asset → best mid-track region (29800ms+), never blindly 00:00.
- **F Featured SFX** PASS — measured music-stem dip under the featured SFX with recovery.
- **G Rights Failure** PASS — REVIEW_REQUIRED asset unassigned, lock blocked, replacement required.
- **H Local Repair** PASS — injected mask repaired locally; narration/sfx plans unchanged.
- **I Mix-only Change** PASS — `narrationTimingHash` stable, `finalMixHash` changed, no upstream regeneration.

## 18. Regression

Exact commands executed (final state of this package):

```
node scripts/run-tests.js music mix
→ music, mix: 0 failed suite(s) in 35.5s   (7 suites: 11+13+8+12+6+9+9 = 68 tests)

npm test                                    (full aggregator, all 30 domains)
→ compliance, cost, dag, flow, golden, history, media, mix, music, narration,
  pipeline, platform, policy, project-manifest, pronunciation, provenance,
  providers, qa, real-e2e, recovery, remotion, research, research-deep,
  spoken-script, storage, story, telemetry, topic, voice-bible, workspace:
  0 failed suite(s) in 739.6s               (exit code 0)

npm run check:repo-structure
→ REPOSITORY_STRUCTURE_OK: root clean, no temporary artifacts in source trees.
```

No pre-existing suite regressed. New domains `music`/`mix` registered with the existing runner (`node scripts/run-tests.js`, auto-discovery) plus convenience scripts `npm run test:music` / `npm run test:mix`.

## 19. Quality Gate matrix (spec §11)

| § | Gate | Status | Evidence |
|---|---|---|---|
| 11.1 | Planning / audio intent | **PASS** | §3–4; tests T1–T11, P1 |
| 11.2 | Rights / provenance | **PASS** | §6; tests L3–L10, P7, Case G |
| 11.3 | Semantic audio QA | **PASS** | §9; tests P7/P8/P10/P12 |
| 11.4 | Mix / technical QA | **PASS** | §11–12; tests M1–M6, B1–B6 |
| 11.5 | Local QA / auto-repair | **PASS** | §13; tests M3/M4/M9, Cases H |
| 11.6 | Dependency / idempotency | **PASS** | §14; test P11, Case I |
| 11.7 | Artifact / traceability | **PASS** | versioned schemas; hashes (narrationTiming/finalMix/artifact); lineage persisted |
| 11.8 | Completion | **PASS** | §18 regression 0 failed; P0 = 0, P1 = 0 |

## 20. Final verdict

```
PHASE_2_7_FUNCTIONAL        = PASS   (runtime modules 2.7-A..2.7-H + suites)
PHASE_2_7_QUALITY_GATE      = PASS   (§19 rows 11.1–11.3)
PHASE_2_8_FUNCTIONAL        = PASS   (runtime modules 2.8-A..2.8-F + suites)
PHASE_2_8_QUALITY_GATE      = PASS   (§19 rows 11.4–11.7)
LOCAL_REPAIR                = PROVEN (M3, M4, M9, Case H)
RIGHTS_GATE                 = PROVEN (L5–L9, P7, Case G — fail-closed end to end)
FINAL_AUDIO                 = READY  (FinalAudioArtifact generated from current approved dependencies; QA PASS; hashes recorded)
P0                          = 0
P1                          = 0
REGRESSION                  = PASS   (npm test: 30 domains, 0 failed)
```

**PHASE_2_7_2_8 = COMPLETE**

**NEXT = PHASE 2.9 + 2.10 + 2.11 (Forced Alignment / Captions / Caption temporal QA)** — requires the operator's task file; do not start without it.

---

### Notes and honest limitations

- True-peak is a 4x-interpolation **estimate**; loudness validation tolerance ±0.7 dB for the pure-JS BS.1770-4 implementation (no Essentia/FFmpeg dependency; `ffmpeg.exe` is env-blocked on this machine — same rationale as Phase 2.4).
- Validation productions use deterministic synthesized audio (real PCM bytes generated in `tests/fixtures/audio-synth.js`); no binary fixtures are stored in the repo, and tests never touch the real `assets/music/` library (temp repos only).
- Implementation tooling policy (spec §10) followed: deterministic processing in pure JS over PCM16; Remotion not needed for audio-only validation at this stage.
