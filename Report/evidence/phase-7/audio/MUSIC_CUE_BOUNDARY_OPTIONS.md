# Phase 7 — Music Cue Boundary Options (~215 s and ~465 s)

**Status: options only. The approved Music Cue Plan (`music-cue-plan.json`, `plan` block) is unchanged and remains the baseline.**
Evidence: `music-boundary-options-evidence.json` (numeric simulation). Nothing was mixed or rendered.

## Method and limits
- Numeric "bed envelope": each cue's 2 s RMS (dB relative to that track's own median = nominal level) with the cue's linear fades, power-summed on a 1 s grid. Regions: 195-245 s and 450-480 s.
- "Thin seconds" = seconds where the bed is below -6 dB re nominal; "dropout" = below -20 dB.
- Approximation only: no EQ, no ducking, no gain staging, no perception model. **It cannot replace listening** (owner listening review is still required).
- Baseline timeline values are the current measured narration (590.125 s) and are recomputable from segment anchors, as stated in the plan.

## What the baseline does (evidence)
- ~215 s: Vastness is at full level when cue 01 is trimmed at source 216.25 s (its own fade starts at ~225 s), and Sonor #2 starts at -35 dBFS and needs ~14 s to reach its normal level. Result: **13 thin seconds**, minimum -12.3 dB re nominal.
- ~465 s: Sonor's own fade (source 247-252 s) is already running when cue 03 fades in. Result: **3 thin seconds**, minimum -15.2 dB (a mild "fade-through"; milder than the 215 s dip).
- Both windows are 88% speech (as already recorded in the plan).

## Options

| # | Option | 215 s region (thin s / min dB / dropout s) | 465 s region (thin s / min dB / dropout s) | Cue 03 replays cue 01 | Boundary-in-speech |
|---|---|---|---|---|---|
| C0 | **Current plan** | 13 / -12.3 / 0 | 3 / -15.2 / 0 | 112 s (89%) | 2 s windows centred on gaps, 88% speech |
| C5 | **Fix 215 only**: cue 01 not trimmed (Vastness plays its own natural fade, 225-229 s); Sonor enters at 214.25 s with its own swell, no added fade-in | **1 / -6.4 / 0** | 3 / -15.2 / 0 | 126 s (100%) | 215 s becomes a 15.6 s gradual morph (214.25-229.82 s), 98% under speech (N15/N16) |
| C4 | **Fix 465 only**: cue 03 enters 3 s earlier (461.25 s) with a 5 s fade-in over Sonor's natural fade | 13 / -12.3 / 0 | **1 / -6.6 / 0** | 115 s (89%) | 465 s window 461.25-466.25 s, 95% speech (mostly N28, no longer centred on the N28/N29 gap) |
| **C3** | **C5 + C4** (no hard cuts; both boundaries overlap the pieces' natural fades) | **1 / -6.4 / 0** | **1 / -6.6 / 0** | 129 s (100%) | as C5 + C4 |
| C2 | Hand-over at Vastness's natural end: Sonor from source 11 s at 229.8 s, 465 s gap-aligned | 7 / -25.9 / **2** | 0 / -3.8 / 0 | 126 s (100%) | boundary 229.8 s (under N16, 4 s before its end) |
| C1 | Skip Sonor's intro, both boundaries at gap centres (233.8 s / 465.35 s) | 9 / -80 / **5** | 0 / -3.8 / 0 | 126 s (100%) | gap-aligned, but Vastness ends at 229 s so there are ~3.6 s of **no music** before Sonor enters |

### Concrete parameters (current measured timings; recompute from anchors if timing changes)
- **C3 / C5 cue 01:** timeline 0 -> 229.82 s, source 0 -> 229.82 s (no trim, no added fade-out). **Cue 02:** timeline 214.25 -> 466.25 s, source 0 -> 252 s, no added fade-in. **Cue 03 (C3 / C4):** timeline 461.25 -> 590.125 s, source 100.945 -> 229.82 s, fade-in 5 s.
- C1 and C2: see `music-boundary-options-evidence.json`.

## Trade-offs
- **C3/C5 (215 s):** removes the 13 s thin patch with no change to the 465 s gap alignment, but cue 01 no longer ends at a gap. The change is a long, gradual morph entirely under continuous narration (no audible "cut"), which satisfies the intent of avoiding a switch mid-line but does not satisfy a literal "only at gaps" rule. Cost: cue 03 now replays 100% of cue 01's material (it was 89%).
- **C4 (465 s):** a smaller gain (3 -> 1 thin seconds) for moving the boundary off the N28/N29 gap. The baseline's 465 s dip is already mild, so C4 is optional.
- **C1/C2:** gap-aligned or natural-end hand-overs look tidy on paper but introduce real dropouts (2-5 s below -20 dB), so they are worse than the baseline at 215 s.
- **Repeat risk** is not solved by any option (all keep Vastness for cue 03, as decided); every variant replays 89-100% of cue 01. Mitigation remains Vastness's uniformity (LRA 2.1 LU, 1.6 dB range), to be confirmed by ear.

## Recommendation
1. **Adopt C5 at ~215 s** after listening confirms it (largest, cleanest improvement: 13 -> 1 thin seconds, no dropout).
2. Treat **C4 at ~465 s as optional** (baseline dip is only 3 s); take **C3** only if listening finds the 465 s dip noticeable.
3. Do **not** use C1/C2.
4. Any adoption is a new owner-approved Cue Plan revision; nothing here was applied.

## Still requires human listening (not auto-PASS)
No vocals; music does not mask the Kokoro narration; transitions sound natural (baseline and the options above); cue 03 does not feel like an annoying repeat; the outro ends appropriately under N36 (Vastness's own fade is ~4.8 s and ends ~0.8 s before the narration).

## Commands executed
`python -I boundary_sim.py` (scratchpad one-off: ffmpeg decode in memory + numpy; no audio written); result copied to `music-boundary-options-evidence.json`.

## Owner decision (2026-10-12)
Apply **C5** at ~215 s; keep the ~465 s boundary unchanged (baseline 2 s window); keep Vastness for cue 03.
- `music-cue-plan.json` revised to plan version 1.1.0 (cue 01 timeline/source 0 -> 229.82 s, no trim, no added fade-out; cue 02 unchanged 214.25 -> 466.25 s, source 0 -> 252 s, no added fade-in; cue 03 unchanged). The previous baseline is kept in `revisionHistory`. Revised plan validates against `schemas/music-plan.schema.json`.
- Cue 03 now replays 100% of cue 01's Vastness material (accepted by the owner's decision; to be judged by ear).
- `ownerMusicApproval` stays PENDING (no explicit approval after human listening recorded yet); `finalMixApproval` PENDING; `contentIdStatus` NOT_TESTED; `rightsStatus` VERIFIED.
- No audio was mixed, converted or rendered; nothing outside the audio evidence folder changed.
