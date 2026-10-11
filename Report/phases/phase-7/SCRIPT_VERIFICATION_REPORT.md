# SCRIPT VERIFICATION REPORT: GPS explainer (v1, v2, v3)

Gate verdict: **READY_FOR_LOCK (recommendation). Not locked. Awaiting Owner Script Approval.** Candidate: `Report/evidence/phase-7/script/gps-script-v3.md`. QA result: `qa/script-qa-v3.json`. Deliverables in `Report/evidence/phase-7/script/qa/`: `claim-verification-matrix-v3.md/.json`, `golden-results.json`, `repair-history.json`, `tts-calibration.json`, `editorial-v3.json`, `dispositions-v3.json`.

## 1. Factual corrections the owner asked for
| Topic | Finding | Correction (evidence) |
|---|---|---|
| **10 km/day (N03, N19)** | v2 and v1 presented the 38 microseconds/day offset as an error that would grow by about ten kilometers in position. Misra, "Inside the box: GPS and relativity" (GPS World, 2023, SRC24, acquired and read): ignoring relativity would measure ranges to all satellites too short by a **common** amount (up to about 11 km between daily clock uploads); the receiver lumps it into its own clock bias; **the position estimate would be unaffected**; **timing** would suffer 38 microseconds a day. The older GPS World item (SRC21) repeated "10 km each day" as a position error; it is recorded as a conflict and not used | v3 N03 (offset is thousands of times above the ~10 ns budget, 10 ns = 3 m), N19, new N19b (the twist: position survives, GPS time would not). Ledger C12 revised; forbidden patterns added; C23 added (nanosecond budget) |
| Satellite clock offset vs pseudorange bias vs position error | These are now three separate statements in the script | N17-N19b, N14 (common bias is the clock error), N23 (pseudorange) |
| **N24 C/A code, 1 ms ambiguity, navigation message timing** | The C/A code repeats every 1 ms (about 300 km), so it alone fixes the delay within a millisecond. LNAV is 50 bps; each 6 s subframe starts with a telemetry word, then a time-of-week word (SRC14, SRC18) | v3 N24; ledger C24. Wording says "near its start", not "begins with" |
| **N29 and 0.643 m** | 0.643 m is the global average URE bound, 95% of the time, on 20 April 2021 (SRC15). URE is ranging accuracy; user accuracy is a position radius (SRC16). They must not be merged | v3 N29: signal error is "the error of one distance"; phone accuracy given separately (about 5 m, open sky); "stayed under one meter", not "averaged" |
| Receiver clock (C8) | SRC24 supports "receivers use inexpensive clocks that drift"; the earlier hedge is removed | N13 |
| Eccentricity correction | SRC24: up to 45 ns, about 15 m (e = 0.02); SRC5: 23 ns (e = 0.01) | N21 |
| The 3 open REVIEW findings (N30, N32, N33) | dates/names were not quantities; N33 "a billionth" | N33 now "within billionths"; the engine no longer flags dates and product names. Result: 0 open without disposition |

## 2. Verification by dimension (v3)
| Dimension | Result |
|---|---|
| Factual accuracy and evidence fidelity | All 37 scenes map to supported claims (C1-C25, ledger v1.2.0); 23 SOURCED, 12 SOURCED+DERIVED, 1 EXPLAIN, 1 sources line. Quotes were extracted from acquired page text. This is deterministic verification, not an independent human fact-check |
| Numerical and unit accuracy | Every spoken quantity matches ledger evidence or a recorded derivation (rounding policy in `numbers.js`); 0 MISMATCH, 0 COARSE open |
| Scientific/logical consistency | Ledger caveats and forbidden patterns pass; editorial list E-001 to E-005 resolved (same-model reviewer, not independent) |
| Spoken naturalness | Existing `evaluateNaturalness`: 0 findings (v1 had 6 FAIL: "so" x7, "and" x4, "that is" x4...) |
| Hook, narrative, payoff | Existing hook/beat gate: 0 findings (v1 failed "promised terms first delivered at 41.6 s"). Paradox in scene 1; Einstein previewed in scene 3; the twist (N19b) begins the Einstein explanation at about 3:41 and closes the Einstein loop (N19b) by about 4:47 of narration |
| Duration and pacing | Measured by TTS calibration (section 4): about 9:03 at speed 1.0 and 8:30 at 1.1, both above the 8:00 minimum |
| Originality | `assessOriginality` against the real 6A episode: risk LOW; `channelLevelOriginality = NOT_PROVEN` (1 real episode, needs 5) |
| Visual feasibility | Every scene has a route and routes without a block (reuses `routeShot`); Flow scenes remain the approved shortlist |
| Title promise | Title "How Does GPS Know Where You Are?" passes the retention promise check; **thumbnail NOT_EVALUATED** (none exists), deferred to packaging |

## 3. Runs of the QA engine on all drafts
| Draft | Scenes / words | Verdict | FAIL | REVIEW |
|---|---|---|---|---|
| v1 | 50 / 1,152 | FAIL | 14 (10 km/day twice, spheres, "only works because", recap phrases, naturalness x6, promise delayed) | 67 (50 are "no visual route": v1 had no visual column) |
| v2 | 36 / 1,227 | FAIL | 5 (10 km/day in N03 and N19, three unmapped derivations) | 8 |
| v3 | 37 / 1,349 | READY_FOR_LOCK | 0 | 0 open (3 accepted dispositions, agent-proposed, owner confirmation pending) |

## 4. TTS calibration (local Kokoro 0.9.4, voice `am_michael`, 3 segments, 355 words; no full narration)
| Segment | Words | Speed 1.0 | Speed 1.1 | ASR mismatch (1.0 / 1.1) |
|---|---|---|---|---|
| A hook (N01-N03) | 88 | 34.27 s, 2.567 w/s | 31.95 s, 2.754 w/s | 0.028 / 0.028 |
| B numbers (N17-N19b) | 164 | 67.28 s, 2.438 w/s | 63.55 s, 2.581 w/s | 0.060 / 0.057 |
| C technical (N24, N26) | 103 | 41.23 s, 2.498 w/s | 38.83 s, 2.653 w/s | 0.075 / 0.043 |
| **Total** | 355 | **2.486 w/s** | **2.643 w/s** | |
- **Pronunciation proxy** (faster-whisper base, a proxy, not a listening test): numbers, decimals, "pseudorange", "ionosphere", "troposphere" were heard correctly (the only diffs were digit-vs-word notation). **"L2C" was misread at both speeds** ("out to c", "altacy"). L5, L1C, WAAS, FAA, NIST are untested and need explicit readings in the pronunciation pass.
- **Prosody:** about 11 to 22 pauses over 250 ms per segment, about 19 to 21% of the time is pause, longest 1.0 to 1.2 s (sentence boundaries). I cannot judge naturalness by ear; **human listening is required** before locking the voice settings.
- **Duration estimate for the full script (1,349 words):** speed 1.0 about **9:03** (543 s); speed 1.1 about **8:30** (510 s); bounds 8:10 (fastest segment at 1.1) to 9:13 (slowest segment at 1.0). Basis: three segments covering 26% of the script, narration only (chapter gaps excluded). Duration requirement met; no filler needed.

## 5. Auto-repair history (max 3 rounds, local, v2 kept)
Round 1 factual (N03, N19, N19b, N21, N13, N24, N29); round 2 review findings (N02, N23, N26, N11, N15, N20, N33); round 3 naturalness/qualifiers/editorial precision (N03, N19, N27, N19b, N24, N29). 20 scene edits in `qa/repair-history.json`. No source or number was invented; no QA threshold was lowered.

## 6. Remaining risks
1. The reviewer is the same model family as the generator; an independent check is the owner (or a human fact-checker). Dispositions for N14, E-006 and E-007 were proposed by the agent and need your confirmation.
2. N19b rests on Misra's idealized identical-circular-orbit analysis; the script says "in this simplified picture".
3. N29 rests on one daily GPS.gov value and on an archived GPS.gov page citing ION for the 4.9 m figure.
4. Pronunciation of L2C/L5/L1C/WAAS/FAA/NIST must be fixed and re-checked before the full TTS; the 3-segment calibration may not represent every scene.
5. Government sources form one independence group; Misra and Navipedia are secondary/reference; pages are snapshots of 10-11 Oct 2026.
6. Creative score cannot offset a factual finding (the gate treats them separately). Retention and originality here are script-level only; visual rhythm and retention need the real timeline.
7. Script QA is not yet a pipeline stage (see the integration report).
