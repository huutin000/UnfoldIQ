# Phase 7 — WAAS word-like reading: pronunciation profile revision

**Trigger:** Owner listened to `WAAS-FAA__alt-wahs-phoneme-speed1.0.wav` (sha256 `4621e4bc…`, matches the independent technical check) and graded it **NATURAL** (2026-10-12).

## Change
- Pronunciation profile `pron-2243101e4d39` (v1) -> `pron-53d1f23a8102` (v2). v1 is untouched.
- Only entry changed: `WAAS` -> `{ notation: IPA, value: "wɑs" }`, `acronymMode: CUSTOM`, `source: OPERATOR_OVERRIDE`, `quality: VERIFIED`.
- Compiles through the existing `providers/runtime/kokoro-phonemize.js` to `[WAAS](/wɑs/)` (same markup as the heard sample). No lib/provider code changed.
- Pronunciation pass `prp-f6b2f490d97d` (segment statuses CLEAN / OVERRIDE_APPLIED; WAAS override applied in runtime phonemes).
- TTS-ready plan `ttp-906217112efc`; manifest + DAG repointed to the new profile/pass/plan.

## Unchanged
FSS `fss-phase7-gps-explainer@v2`, script text hash `b3561db3d17d9331`, script QA decision, `Report/evidence/phase-7/script/fss-config-v4.json` (historical input of v2).

## Gate state (corrects the technical-check note)
`script-qa/fss-phase7-gps-explainer@v2.json` already carries an owner approval (2026-10-11) bound to hash `b3561db3d17d9331`, stated as "pronunciation as the current profile" (WAAS letters). With that approval the new plan is `productionTtsBlocked: false` (`SCRIPT_QA_READY`). No audio was generated. **Owner confirmation (2026-10-12):** "Áp dụng cho v2" — the 2026-10-11 approval of FSS@v2 (hash `b3561db3d17d9331`) applies to pronunciation profile v2 (WAAS = /wɑs/). The approval record file itself was not edited. Production TTS itself still requires a separate explicit request.

## Commands run
- `node <scratchpad>/revise-waas.js` (one-off: revise profile -> pass -> manifest -> DAG -> TTS plan; deleted after use)
- `node tests/pronunciation/test-pronunciation-profile.js` (16 passed, includes new WAAS guard)
- `node tests/pronunciation/test-pronunciation-runtime.js` (13 passed), `test-pronunciation-invalidation.js` (4 passed)
- `node tests/golden/test-narration-pronunciation-golden.js` (19 passed)
- `node tests/pipeline/test-fss-canonicalize-versioning.js` (6 passed), `tests/qa/test-script-qa*.js` (6+6 passed), `tests/spoken-script/test-e2e-fss-backfill.js` (9 passed)
- `npm run check:repo-structure` (OK)

## Production TTS (owner request 2026-10-12)
- Gate was blocked by `TTS_DIRECTION_STALE`: narration direction `nd-813ce6990d3c` had no directions (coverage 0%, manifest UNRESOLVED; pre-existing). Owner chose option A (neutral baseline).
- New narration direction `nd-7bd74d759a3c` (v3): one neutral `paceIntent: MODERATE` direction on the first segment (a single direction keeps coverage 2.7%, below the over-direction review threshold; every other segment resolves to ABSENT = speed 1.0, so audio is identical to directing all 37). Manifest VERIFIED. TTS-ready plan rebuilt: `ttp-bb7733972a7e` (supersedes `ttp-906217112efc`).
- Synthesis: local Kokoro (`am_michael`, speed 1.0), 37/37 segments READY, 580.9 s total, ASR QA ran for all (max WER 0.1875 on N08, 0 critical mismatches). Artifacts under `projects/phase7-gps-explainer/assets/voice/narration-segments/` (wav + json).
- Not done: speech-rate QA, performance QA, narration track assembly (later steps).
- Full `node scripts/run-tests.js`: 0 failed suites (1277 s). The earlier 2 failures came from a temporary edit of `fss-config-v4.json`, since reverted.
- Commands: `<scratchpad>/nd-fix.js`, `<scratchpad>/synth.js` (one-off, outside repo).

## Narration QA + track (owner request 2026-10-12)
- Ran an adapted copy of `scripts/cli/pilot-narration.js` (scratchpad, one-off): speech-rate policy -> speech-rate QA -> performance QA -> `FINAL_NARRATION_TRACK` -> manifest/DAG. Segment synthesis replayed the 37 existing READY artifacts (no new audio).
- First run: speech-rate QA **FAIL** (policy v1, band 120-180 wpm adopted from the pilot): only N31 below band (100.93 wpm; 18 words, word-read WAAS + spelled FAA, 2.5 s pauses). Next slowest N32 126.12 wpm.
- Owner chose option B (accept N31 as is). The QA has no per-segment exemption, so speech-rate policy v2 lowers `minWpm` 120 -> 100 with the reason recorded; only N31 is affected. The first-run FAIL QA (`srq-50eaf65dfc61`) and policy v1 remain as history.
- The first track (`fnt-e2ceed888682`, bound to the FAIL QA, uncommitted) was deleted and re-assembled bound to the PASS QA (same id, identical audio).
- Result: speech-rate QA PASS (overall 144.2 wpm), performance QA PASS 37/37, join QA PASS, track 590.125 s, dialogue routing NOT_APPLICABLE (factual). Manifest: narrationAudio/speechRateQa/performanceQa VERIFIED. External credits 0.
- Not covered: human listening to the assembled track; Phase 2.7+ (mix/alignment) untouched.

## Alignment (Stage 12, owner "có" 2026-10-12)
- Known-text alignment of FSS@v2 over the 37 clean segment stems (expected start/end from track `fnt-e2ceed888682` join positions) with `lib/alignment` provider `local-energy-known-text` 1.0.0 (local, deterministic, no ASR substitution).
- Result: QA PASS, 1377/1377 words ALIGNED, coverage 1.0, 0 findings, 165 phrases; last word ends 588.875 s (track 590.125 s). `narrationTimingHash` = sha256 of `[{segmentId,startMs,endMs}]` from the track (same formula as `lib/audio-mix`).
- Saved to `projects/phase7-gps-explainer/audio/alignment.json`; manifest `alignmentVersion` = `alignment@e5e58ee03408` VERIFIED.
- Limit: this provider times words heuristically from measured speech runs (energy), it is not a phoneme-level forced aligner; word starts/ends are approximate (confidence ~0.8). Fine for caption cues, not for frame-exact lip/word animation. `finalMixHash` absent (no final mix yet): re-validate with `validateAgainstFinalAudio` after Phase 2.7/2.8.
- Commands: scratchpad `align.js` (one-off), `node tests/alignment/test-alignment.js` (12 passed), `npm run check:repo-structure` (OK).

## Captions (Stage 12, owner option B1, 2026-10-12)
- Built from `audio/alignment.json` with `lib/captions` (`captionWithRepair`, DIALOGUE_ONLY) using an inline English long-form profile `en-longform-youtube@1.0.0` (2 lines x 42 chars, 20 CPS, 833-7000 ms cues, min gap 84 ms). **Assumption:** target platform YouTube (not recorded in the project; matches `platforms/youtube` sidecar SRT 84 chars/2 lines). The lib's built-in profiles are Vietnamese-only and 17 CPS is the Vietnamese benchmark; 20 CPS is the usual English value.
- Result: QA PASS, 145 cues, all 1377 words covered, caption text identical to the canonical alignment text, max 19.17 CPS (avg 15.21), max line 42 chars, SRT round-trip 145/145.
- Outputs: `projects/phase7-gps-explainer/assets/captions/captions.json`, `captions.srt`, `captions.vtt`.
- Library fix (`lib/captions/index.js`): cue splitting and merging only checked total length <= 2x42, so 83-char cues that cannot be split into two lines <= 42 produced BAD_LINE_BREAK (15 cues on this script). Added `fitsLayout` (layout feasibility) for cue splitting, short-cue merging and MERGE_CAPTIONS repair; `layoutLines` now splits a 2-line overflow by characters instead of word count. Regression test: `tests/captions/test-validation-cases.js` Case M (fails without the fix, passes with it).
- Commands: scratchpad `captions.js` (one-off); `node tests/captions/test-captions.js` (13 passed), `node tests/captions/test-validation-cases.js` (13 passed), `node tests/alignment/test-alignment.js` (12 passed), `npm run check:repo-structure` (OK).
- Not done: audio mix plan, measured timeline (need the music/SFX decision), burn-in/Remotion caption rendering. Caption timings inherit the alignment's approximation (energy-based).
