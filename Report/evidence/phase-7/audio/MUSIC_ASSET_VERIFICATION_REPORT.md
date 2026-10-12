# UNFOLDIQ Phase 7 — Music Asset Verification Report

**Status: `READY_FOR_OWNER_MUSIC_REVIEW`** (no blocker).
Scope: read-only asset verification and local analysis of the original MP3s. No WAV conversion, final mix, render, paid API, push, or change to FSS / Script Approval Gate / pronunciation profile / ownerApproval. The approved Music Cue Plan (`music-cue-plan.json`) is unchanged and remains the baseline.

Evidence files (same folder): `music-license-evidence.json` (updated), `music-analysis-evidence.json` (raw numbers), `music-cue-plan.json` (unchanged).

## 1. License evidence (A)

| Item | Status |
|---|---|
| License terms (Mixkit Stock Music Free License) | VERIFIED_FROM_OFFICIAL_SOURCE (owner/reviewer check, 2026-10-12; the agent could not render the terms text itself) |
| Track listings | VERIFIED_FROM_OFFICIAL_SOURCE |
| Content ID | NOT_TESTED |
| `rightsStatus` | **UNVERIFIED** (not raised; owner decision) |

Official URLs recorded: license `https://mixkit.co/license/modal/musicFree/`, FAQ `https://mixkit.co/free-stock-music/`, Vastness `https://mixkit.co/free-stock-music/instrument/synth/`, Sonor #2 `https://mixkit.co/free-stock-music/tag/technology/`. No per-track permalink exists; the category listing + track name + author is recorded as allowed. The listings' machine-readable metadata (JSON-LD) confirm: Vastness — Andrew Ev, 3:50; Sonor #2 — Eugenio Mininni, 4:22; license `https://mixkit.co/license/#musicFree`.

## 2. Asset provenance (B)

Both selected files were re-downloaded by the agent from the official Mixkit asset URLs into a scratch directory outside the repo, then hashed and compared:

| Track | Official asset URL | Downloaded (UTC) | SHA-256 (download = repo) | Result |
|---|---|---|---|---|
| Vastness (184) | `https://assets.mixkit.co/music/184/184.mp3` | 2026-10-12T07:59:54Z | `3ffae7ccd5ea6f612f75efdf9a8318ccce79a5e4f355b26e233631330a57660f` | byte-identical, 7,356,125 B |
| Sonor #2 (570) | `https://assets.mixkit.co/music/570/570.mp3` | 2026-10-12T07:59:55Z | `e98aaa4574f3e83ac9aefe2aa32ae8bedd1da4e9f5517858f2ccc3cb4c5f3221` | byte-identical, 8,383,724 B |

HTTP 200, `audio/mpeg`, lengths and listing durations agree (229.8 s / 261.9 s). **Asset provenance: VERIFIED_FROM_OFFICIAL_DOWNLOAD** for these two files. Windows file times were *not* used as evidence (stored only as `localFileTimeNotEvidence`). The two non-selected tracks (Feedback Dreams, What It Takes) were not re-downloaded and remain PENDING_VERIFICATION.

## 3. Listening review (C) — method and limits

The agent cannot hear audio. "Listening" here is signal analysis (ffmpeg decode in memory, numpy) plus a local faster-whisper pass as speech/lyrics detector. **It supports, but does not replace, the owner's human listening.** Raw numbers: `music-analysis-evidence.json`.

### Per-file results

| | Vastness (cue 01 + 03) | Sonor #2 (cue 02) | Feedback Dreams (candidate) |
|---|---|---|---|
| Vocals / speech | none detected (0 ASR segments) | none detected (15 segments, all the tag "Music") | none detected (25 segments, all "...") |
| Loudness (median 3 s RMS) | -10.7 dBFS | -16.3 dBFS | -21.5 dBFS |
| Dynamics | very even: LRA 2.1 LU, 10 s windows span only 1.6 dB, no window >3 dB over median | moderate: LRA 8.2 LU; louder passages source 155-179 s, 213-217 s, 234-238 s (+3 dB or more) | most dynamic: LRA 12.7 LU; 10 s-scale swings of ~10-20 dB (e.g. -31 dB at 23 s, -12 dB at 60 s) |
| Spectrum (share <300 Hz / 300-3400 Hz / >3.4 kHz) | 95% / 5% / 0% (low drone/pad) | 34% / 66% / 0.5% | 0% / 99.6% / 0% |
| Strong onsets / min | 47 | 100 | 40 |
| Masking risk vs narration | low in the intelligibility band (little energy at 300-3400 Hz); energy sits on the male voice fundamental (<300 Hz), so a mild low-end "mud" risk | **higher**: two thirds of its energy is in the speech band | **highest**: virtually all energy is in the speech band |
| Natural ending | fade from ~225 s to digital silence at ~229 s (≈4.8 s fade) | fade from ~247 s, silent tail ≈6.9 s | fade from ~133 s, silent from ~144 s (≈5.3 s silent tail) |
| Opening | full level from 0 s | very quiet start (-35 dBFS), reaches normal level only after ~14 s | very quiet start (-52 dBFS) |

Interpretation limits: whisper only reports tags/blank on music, so "no vocals" means *no intelligible words or lyrics detected*; wordless or heavily processed vocal textures cannot be excluded by this method. The 300-3400 Hz share is an energy proxy, not a measured masking model.

### The two transitions (approved plan, source positions)

- **~215 s (cue 01 -> 02, plan window 214.25-216.25 s).** Vastness is still at full level at its source 214-216 s (-11.4 dBFS; its own fade starts only at ~225 s), so the crossfade is a forced 2 s fade-out of a steady passage. Sonor #2 enters at source 0-2 s at -35 to -29 dBFS and needs ~14 s to reach its normal level. Net effect: no abrupt jump, but the music bed **thins to near-silence for roughly 10-15 s after 215 s** instead of a continuous blend. Harmonic similarity of the two edges is moderate (chroma cosine 0.55; weakly informative because Vastness is bass-dominated). The window holds ~1.75 s of speech (N15/N16).
- **~465 s (cue 02 -> 03, plan window 464.25-466.25 s).** Sonor #2's own fade starts at source ~247 s (timeline ~461 s); at the plan's cue end (source 252 s) it is already at about -36 to -50 dBFS. Vastness then fades in at source 103.9 s at full level (-9.9 dBFS). Net effect: Sonor dies away for ~3-4 s before the window, then Vastness fades in: a **fade-through, not a true crossfade**; no clash, but also no overlap. Chroma cosine 0.36 (low) is irrelevant because Sonor is already inaudible. The window holds ~1.75 s of speech (N28/N29).
- Both transitions are under narration (88% of each window is speech), as already stated in the plan.

### Repeat risk, Cue 03

Cue 03 replays 112.3 s (89%) of cue 01's Vastness material, about 360 s (6 min) later; only 13.6 s of Vastness is unused by cue 01. Mitigating factors from the analysis: Vastness is extremely uniform (10 s windows within 1.6 dB, LRA 2.1 LU, no climax; its "loudest" window at ~105 s is only ~1.4 dB above the quietest), so the repeated span contains no distinctive peak. The risk is therefore judged **moderate-low by signal evidence, to be confirmed by ear**.

### Feedback Dreams as Cue 03 replacement

It removes the repeat but is a worse fit by the measurements: 99.6% of its energy is in the speech band (highest masking risk), median level is ~11 dB below Vastness with ±10-20 dB swings over 10 s windows (it would pull attention or need heavy ducking), provenance is not verified, and its natural fade finishes at ~144 s so the cue would need a span ending at source ~144 s (start ~18 s) to finish with the narration. **Not recommended** unless the owner hears an objectionable repeat.

## 4. Recommendation for Cue 03

**Keep Vastness for Cue 03 (current plan)**, conditional on the owner's listening check of: (a) the 6-minute replay not reading as a loop, (b) the ~4.8 s natural fade landing under the last sentence (N36, ends 5 s before the narration does). Fallback order if (a) fails: shorten cue 03 / start it later (accepting a bare tail) -> start cue 03 from Vastness's opening as a deliberate bookend -> another approved track (new decision; Feedback Dreams is the weakest option on the data).

Observations for the owner (plan **not** modified; adjustments would be a new decision):
1. Cue 02 end: Sonor's natural fade begins ~247 s, so the last ~5 s of cue 02 is already fading; ending cue 02 at source ~247 s would not change what is heard.
2. Cue 02 start: the first ~14 s of Sonor are very quiet; the bed will sound thin after 215 s unless the owner prefers that dip.
3. Mix stage (later): Sonor #2 and any mid-band music need stronger ducking than Vastness; Vastness may benefit from a high-pass near 120-150 Hz to avoid sitting on the narrator's fundamental. Louder Sonor passages land under N24 (~369-393 s), N26 and N27.

## 5. Limitations
- Human listening not performed by the agent; vocal/lyric absence is "not detected", not proven.
- Content ID not tested; `rightsStatus` stays UNVERIFIED.
- License text itself was confirmed by the reviewer, not independently rendered by the agent.
- The four MP3s in `assets/approved-local/music/` are untracked by git. Mixkit's license forbids redistributing the music as a standalone product; decide whether they should be git-ignored before any commit.

## 6. Commands executed
- `curl` of the two official listing pages and the two official asset URLs (read-only, scratch directory outside the repo); `sha256sum` of downloads vs repo files.
- `python -I analyze_music.py` and `extra.py` (ffmpeg + numpy + faster-whisper `small`, local) in the scratchpad; results stored in `music-analysis-evidence.json`.
- `node mk3.js` (one-off, scratchpad) to update `music-license-evidence.json` and write `music-analysis-evidence.json`.
- `npm run check:repo-structure`.
