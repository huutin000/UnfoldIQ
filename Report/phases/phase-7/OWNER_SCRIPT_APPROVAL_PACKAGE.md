# OWNER SCRIPT APPROVAL PACKAGE: GPS explainer

**Verdict: READY_FOR_OWNER_APPROVAL.** `FINAL_SCRIPT_LOCKED = NO`. No full TTS, no render, no Flow/Veo, no paid API, no full regression. Production TTS is blocked in the pipeline until you approve (section 4).

Note: the prompt "UNFOLDIQ - PHASE 7 FINAL SCRIPT APPROVAL PREPARATION" was not in my session or in `D:\Downloads All`. I followed the seven priorities in your override. If that prompt contains extra requirements, send it and I will check them against this package.

## 1. What you are approving
| Item | Value |
|---|---|
| Candidate | `Report/evidence/phase-7/script/gps-script-v3.md` (v2 kept unchanged) |
| Canonical FSS | `fss-phase7-gps-explainer@v1`, project `phase7-gps-explainer`; the spoken text is identical to the QA-verified text (checked inside the CLI), so no claim re-verification was needed |
| Text hash bound to QA and approval | `f814512dc6ca1986` |
| Size | 37 scenes, 1,349 words, English, voice `am_michael` (vb-19f4fd6a4596) |
| Evidence | ledger v1.2.0 (25 claims, 24 sources); verification matrix `qa/claim-verification-matrix-v3.md` |
| Narration length | about 9:03 at speed 1.0, about 8:30 at 1.1 (3-segment calibration; bounds 8:10 to 9:13) |

## 2. Gate status (each with recorded evidence)
| Gate | Result |
|---|---|
| Factual, evidence and numerical QA | PASS: 0 FAIL, 0 REVIEW without disposition (`qa/script-qa-v3.json`) |
| Golden regression | 25/25 (13 negatives detected, 9 positives clean, 3 documented editorial-only limits) |
| **Holdout (new)** | 23/24 as predicted; 0 false positives; 3 predicted misses and 1 surprise were promoted to ledger and golden (`qa/holdout-results-round1.json`) |
| Naturalness, hook, narrative, promise | PASS with the existing capabilities |
| Originality | LOW against the 1 real episode; channel level NOT_PROVEN |
| FSS canonicalization | humanization (no change), evidence fidelity PASS, naturalness PASS, canonical FSS, manifest and DAG |
| Pronunciation | profile with 6 proposed readings; quiet Kokoro pass: all segments CLEAN or OVERRIDE_APPLIED; **readings not yet approved by ear** |
| Duration | measured on 3 segments; above 8:00 |
| Script Quality Gate | integrated; plan `ttp-932f25f33326` is READY_FOR_TTS technically but `productionTtsBlocked = true` (`SCRIPT_OWNER_APPROVAL_PENDING`) |
| Full TTS blocked | `loadCanonicalTtsInputs` on the real project returns `TTS_INPUT_NOT_READY: tts-ready plan UNRESOLVED`; a dry run on a temp copy shows that approval flips the gate (the real project was not touched) |

## 3. Pronunciation samples to listen to (I have not listened and make no quality claim)
Folder `D:\Project\UNFOLDIQ\out\phase7-gps-pronunciation-samples\` (gitignored, not committed). Index: `qa/pronunciation-samples-index.json`.
- `L2C__...` and `L5-L1C-L2C-Galileo__...`: readings "L two C", "L five", "L one C" (before = raw text, after = profile, at speeds 1.0 and 1.1).
- `WAAS-FAA__...` and `WAAS__alt-wahs`: letter-by-letter "W.A.A.S." versus "wahs"; FAA as letters.
- `NIST__...` and `NIST__alt-letters`: "nist" as a word versus letters.
Listen for: acronyms, number words, pace at 1.0 versus 1.1, pauses between sentences, whether "pseudorange", "ionosphere", "troposphere" sound natural.
The ASR proxy (faster-whisper) is noisy: NIST was misheard in one run and heard correctly in the next, so it cannot decide anything; your ear can.

## 4. Decisions needed from you
1. Approve or edit the script text (hash above). Any edit makes the QA decision and the approval stale by design.
2. Pronunciation: confirm or change the six readings (L2C, L5, L1C, WAAS, FAA, NIST).
3. Speed: 1.0 (about 9:03, clearer) or 1.1 (about 8:30, brisker).
4. Confirm the three agent-proposed dispositions: N14 (explanatory geometry), acronym pronunciation (handled by the pronunciation step), thumbnail promise (packaging stage).
5. Accept the known limits: the reviewer is the same model family; the QA cannot see direction errors or undeclared contradictions (3 documented cases).

When you approve, say so in a message. I will then run `scripts/cli/script-owner-approval.js --project phase7-gps-explainer --script fss-phase7-gps-explainer --version 1 --approved-by "<you>" --source "<your message>"`, which records the approval for this exact text and opens the gate. Even then it only permits the full TTS step; it does not run it.

## 5. Remaining risks
Same-model reviewer; N19b rests on Misra's idealized-orbit analysis; N29 on one daily GPS.gov value; government sources are one independence group; pronunciation of every acronym is unverified by ear; the 8:00 duration rests on 26% of the script; the gate is opt-in per plan (on for this project).
