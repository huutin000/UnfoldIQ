# Phase 7 — Final Mix Report (candidates for owner listening review)

**Status: `READY_FOR_OWNER_FINAL_MIX_LISTENING_REVIEW`.** Two mix candidates rendered; neither is approved. `finalMixApproval = PENDING`. No render, Full TTS, Flow/Veo, paid API or push. FSS@v2, Script v4, pronunciation profile, ownerApproval and Script Approval Gate untouched.

Owner permission: "duyệt nhạc, cho phép mix" (2026-10-12). `ownerMusicApproval = APPROVED` (revision C5), `rightsStatus = VERIFIED`, `contentIdStatus = NOT_TESTED`.

## Inputs
- Narration: 37 measured segment stems of track `fnt-e2ceed888682` (mix timeline = narration timeline, 590.125 s).
- Music: approved Music Cue Plan v1.1.0 (revision C5): Vastness 0-229.82 s / Sonor #2 214.25-466.25 s / Vastness 464.25-590.125 s. Cue fades: cue 01 in 0.3 s / out 0 (natural fade); cue 02 in 0.1 s / out 2 s; cue 03 in 2 s / out 0 (natural end).
- MP3 -> PCM16 mono 24 kHz WAV with ffmpeg, ingested into the Approved Local Library (`assets/music/library-index.json`; `mus-1e79e277b220` Vastness, `mus-4b4e55ee279f` Sonor #2); usage decision `APPROVED_FOR_PROJECT` (YouTube, COMMERCIAL). WAV derivatives are git-ignored.
- Engine: `lib/audio-mix` (bed -16 dB under narration, LIGHT ducking, loudness profile, bounded repair loop).

## Candidates (play these)
| | A — policy mix (**in manifest**) | B — gentle mix (alternative) |
|---|---|---|
| File | `projects/phase7-gps-explainer/assets/audio/final-audio/final-audio-0ad36041aa41.wav` | `.../final-audio-fb4f2949ed92.wav` |
| Profile | `youtube-standard@1.0.0` (-14 +/-2 LUFS, -1 dBTP) | `youtube-voiceover-gentle@1.0.0` (project-local: -18.5 +/-2 LUFS, -1 dBTP) |
| Lib QA | PASS (attempt 0) | PASS (attempt 0) |
| Loudness, independent (ffmpeg ebur128) | -15.6 LUFS, LRA 2.5 LU | -18.8 LUFS, LRA 2.9 LU |
| True peak, independent | -1.4 dBTP | -1.3 dBTP |
| Limiter (look-ahead) | ceiling -4.0 dBFS; max gain reduction **16.6 dB**; **40.7%** of active samples reduced >1 dB, **27.6%** >3 dB | ceiling -2.3 dBFS; max 7.8 dB; 3.3% >1 dB, **1.2%** >3 dB |
| Voice vs music during speech | min 17.3 dB, median 18.6 dB (policy >= 10 dB; identical in A and B) | same |
| Alignment vs final audio | PASS, `narrationTimingHash` identical | PASS, identical |

Why two: the Kokoro narration is quiet and peaky (-27.3 LUFS, peak -3.6 dBFS, crest ~23.7 dB). Reaching the YouTube profile's ~-14 LUFS needs ~+16 dB of gain, which the limiter must then take back on most speech peaks (A). B is cleaner but about 3 dB quieter than the policy range allows (-18.8 vs -16 minimum), so it is a deliberate policy deviation that needs the owner's decision. YouTube does not boost quiet uploads, so B plays ~4-5 dB quieter than typical -14 LUFS content.

**Recommendation:** listen to A first for distortion/pumping on the narration (the main risk); if it sounds processed, take B (or a variant between them). Neither is auto-approved.

## C5 transitions as rendered (music bed, dB re the bed's median, 1 s windows)
- ~215-231 s: bed ducks with speech (+/-3 dB), then dips to about -5 to -8 dB for ~6 s while Vastness fades out and Sonor swells in (simulation predicted a minimum of -6.4 dB; 1 s below -6 dB before ducking, a few more with ducking). No dropout.
- ~463-466 s: Sonor's natural fade then Vastness fade-in: ~2 s at -12 to -13 dB re median (the "fade-through" described earlier, unchanged by the owner's decision).
- End: Vastness natural fade, -13/-20/-38 dB over the last 3 s. Whole mix: 26 s of bed more than 6 dB under its median (mostly ducking), 1 s below -20 dB.

## Library fixes made for this mix (shared code, tests added; each new test fails without its fix)
1. `lib/audio-mix/index.js` `buildMixPlan`: per-cue `fadeInMs`/`fadeOutMs` override the hard-coded 300/800 ms (needed to express C5; same pattern as ambience). Test M1b.
2. `normalizeNarration`: voice clip gain clamped at the schema ceiling +12 dB (base gain +12 plus per-segment +3 correction made the plan schema-invalid for quiet Kokoro narration). Test M1c.
3. `lib/audio-mix/engine.js` `softLimit`: replaced a hard clip (it clipped ~0.17% of samples by up to ~8 dB on this narration) with a deterministic look-ahead limiter (15 ms, smooth gain, never exceeds the ceiling). Test M1d.
4. `applyRepairs` `LIMIT`: a repeated LIMIT now lowers the ceiling by the measured deficit; before, it repeated -1.3 dB forever and the repair loop could not converge. Test M1e.

Tests run: `node tests/mix/test-audio-mix.js` (13 passed), `node scripts/run-tests.js` for domains mix, music, alignment, captions, creative, incremental, render, pipeline: 0 failed suites. `npm run check:repo-structure`: OK.

## Limitations / honesty
- **No human listening yet.** All checks are measurements; distortion, pumping, transition naturalness, "music does not mask Kokoro" and the Cue 03 repeat are open until the owner listens.
- The lib's true-peak meter reads ~1.1 dB lower than ffmpeg's (A: lib -2.49 vs ffmpeg -1.4). Limiter ceilings were therefore seeded from the independent measurement (seeds taken from measured runs, recorded in `mix-verification-evidence.json`). An earlier run at ceiling -3.5 measured -0.9 dBTP independently and was discarded.
- Format is the pipeline default: mono 24 kHz PCM16 (music is down-mixed to mono, bandwidth 12 kHz). A 48 kHz stereo master would need an engine change.
- Edge sample steps near cue boundaries were measured (up to ~0.9 full-scale steps, dominated by speech); click-free transitions are not proven by that number.
- Manifest `finalAudioVersion` = A with status `UNRESOLVED` ("mix QA PASS; PENDING finalMixApproval") so nothing downstream treats it as approved. DAG node and `timeline-measured.json` / caption-timeline / video-spec handoff are not produced yet.
- Untracked, not ignored: `projects/phase7-gps-explainer/assets/` (narration segments, track, two ~28 MB final WAVs) and new `assets/music/library-index.json`; the music WAVs in `assets/music/audio/` are ignored. Decide before committing.

## Commands executed
`ffmpeg` MP3->WAV; one-off scratchpad scripts (`mix_run.js`, `mix_verify.js`, `mix_exp*.js`) calling `lib/music-library` (ingest, decideUsage, recordUsageDecision), `lib/audio-mix` (buildMixPlan, mixWithRepair, finalizeFinalAudio), `lib/alignment` (validateAgainstFinalAudio), `lib/project-manifest`; `ffmpeg -af ebur128=peak=true` for independent loudness/true peak; tests listed above.

## Owner selection (2026-10-12)
Owner chose candidate **A** (`final-audio-0ad36041aa41`, policy mix). Candidate B (`final-audio-fb4f2949ed92`) is not selected and is kept only as an alternative until the owner says otherwise. `finalMixApproval` remains PENDING until an explicit approval is recorded.

## Cleanup (2026-10-12, owner request)
Candidate B files (`final-audio-fb4f2949ed92.*`) were deleted by the owner's decision; its measurements remain in `mix-verification-evidence.json` for the record (the WAV no longer exists). 30 tracked files modified only by test-suite side effects (timestamps and benchmark numbers) were reverted with `git checkout`; the pre-existing deletions in the working tree were not touched.

## Final mix approval (2026-10-12)
Owner approved candidate **A** (`final-audio-0ad36041aa41`, finalMixHash in `mix-verification-evidence.json`): `finalMixApproval = APPROVED`. Manifest `finalAudioVersion` = VERIFIED. Approval covers this exact file (QA PASS, -15.6 LUFS, -1.4 dBTP); any change to the narration timing, music cue plan or mix parameters makes it stale and requires a new mix and approval.
