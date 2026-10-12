# OWNER HANDOFF v4, revision 2 (response to the owner review decision)

`FINAL_SCRIPT_LOCKED = NO`. Approval CLI, full TTS, render, Flow/Veo, paid API, push and merge: not run. Complements `OWNER_SCRIPT_APPROVAL_PACKAGE_V4.md`.

## 1. Exact final text of the four edited scenes (spoken text, as in FSS `@v2`)
- **N03:** And the clocks involved are strange: without correction, a GPS satellite clock would gain about thirty-eight microseconds a day compared with one on the ground. That is far beyond the timing accuracy GPS needs, and Einstein explains why.
- **N18:** General relativity says clocks tick faster where gravity is weaker. Up there, that adds about forty-five microseconds a day. Combined with the effect of motion, an uncorrected satellite clock would run about thirty-eight microseconds a day faster than one on the ground.
- **N19b:** Here is the twist. In a simplified model with identical circular satellite orbits, ignoring relativity would make every measured distance appear too short by the same amount, up to about eleven kilometers between daily clock updates. That shared error could be absorbed into the receiver's own clock bias, so the position estimate would survive in this idealized case. GPS time would not: it could drift by thirty-eight microseconds a day.
- **N29:** Accuracy comes in layers. The U.S. government commits to a daily global average signal-in-space ranging error of at most two meters, with ninety-five percent probability, across healthy satellites. On one day in 2021, that average was at most about sixty-four centimeters. But that does not describe your phone's accuracy. Your position also depends on satellite geometry, the atmosphere and nearby buildings, so phones typically land within about five meters under open sky.

Focused diff v3 to v4 (only these four rows differ; narration cell, Evidence and Visual of the other 33 rows are identical; checked by parsing both tables):
- N03: "the ones on the satellites gain about thirty-eight microseconds a day on yours. It is thousands of times more than navigation can tolerate" became "without correction, a GPS satellite clock would gain ... compared with one on the ground. That is far beyond the timing accuracy GPS needs".
- N18: "Together, satellite clocks run about thirty-eight microseconds a day faster than ground clocks." became "Combined with the effect of motion, an uncorrected satellite clock would run ... faster than one on the ground."
- N19b: assumption moved first, "would" became "could", "had engineers ignored relativity" became "ignoring relativity".
- N29: rewritten as shown above.

**Where I departed from the review candidate, and why (your call):** the candidate's N19b/N29 failed three checks (ordinal "ninety-fifth" parsed as 90; C12 pattern on "position error"; three "The receiver" openings). I re-worded and disclosed it in E-008 and the package; I did not hide a checker problem by changing the script silently, but I did change the script. If you prefer the candidate wording ("ninety-fifth percentile", "not your phone's position error"), the right fix is in the QA tool, then a new v5 with a new hash. Tell me which.

## 2. Hash and consistency proof (recomputed just now)
- Algorithm (`lib/script-qa/gate.js`): sha256 over `segmentId + "\n" + text` for every segment joined by `"\n\n"`, UTF-8, first 16 hex chars. Text is the trimmed narration cell, no other normalization.
- Computed from `gps-script-v4.md` (parsed): `b3561db3d17d9331`. From FSS v2 segments: `b3561db3d17d9331`. QA decision `@v2`: `b3561db3d17d9331`. TTS-ready plan `ttp-f581de2962bc` (`scriptQa.scriptTextHash`): `b3561db3d17d9331`. All four equal, so the hash is unchanged from the previous report.
- FSS v2 text equals the QA-verified script text for all 37 segments (ids and text); FSS status CANONICAL.
- Manifest references `fss-phase7-gps-explainer@v2`, `nd-813ce6990d3c`, `prp-c9eab301c6c0`, `ttp-f581de2962bc`. DAG: FINAL_SPOKEN_SCRIPT, SCRIPT_QA_DECISION (now `@v2`), NARRATION_DIRECTION, PRONUNCIATION_RUNTIME_PASS, TTS_READY_PLAN all CLEAN.
- **Defect found and fixed while preparing this:** after the first v2 run the DAG node SCRIPT_QA_DECISION still pointed at `@v1` and was DIRTY (the CLI only added the node when absent). The CLI now repoints it; I reran the v2 canonicalization (no owner approval exists, so this was allowed) and verified the DAG above.
- Gate: `loadCanonicalTtsInputs(@v2)` returns `TTS_INPUT_NOT_READY ... tts-ready plan UNRESOLVED`; plan `productionTtsBlocked = true`, `SCRIPT_OWNER_APPROVAL_PENDING`; decision `@v2` has no `ownerApproval`.
- v1/v3 files untouched: `git status` lists only the DAG, manifest, telemetry and `fss-canonicalize.js` as modified tracked files.

## 3. Focused tests for `scripts/cli/fss-canonicalize.js`
`node tests/pipeline/test-fss-canonicalize-versioning.js` ran in an isolated temp repo (shared `lib`/`schemas` linked, private `projects/`; local quiet phonemizer, no audio): **6 passed, 0 failed.**
1. First version canonicalizes, TTS stays blocked.
2. Version bump: all v1 files byte-identical, only DAG/manifest/telemetry change; FSS v2, manifest and DAG point to v2 (DAG chain nodes CLEAN); QA hash equals the hash of the FSS v2 text and differs from v1.
3. Rerun of the same version: no versioned artifact changes (only the unapproved decision's `decidedAt`).
4. A version that already has an owner approval is never overwritten (new guard; the rerun previously would have erased the approval record): exit 1, project unchanged.
5. Pronunciation entries that differ from the existing profile: exit 1 **before any write** (check moved to the start; before this it could leave a half-canonicalized project), project unchanged.
6. Missing script file: non-zero exit, project unchanged.
Also re-run: `npm run test:qa` 0 failed; `npm run check:repo-structure` OK. Full regression not run (no dependency requires it). Not covered: failure in the middle of the chain (for example the phonemizer failing after earlier writes), which is not atomic.

## 4. QA-tool limitations (debt, not fixed at this gate)
- The numeric checker reads the ordinal "ninety-fifth" as 90: a parser defect, not a script defect.
- The C12 `forbidden` pattern `position(al)? errors?` is overbroad: it fires on any scene that says "not your phone's position error", although the intended target is conflating the 11 km range bias with a position error. It should be scoped to the scenes/context of C12.
- The "The receiver" repetition rule is a stylistic heuristic that blocked a correct N19b sentence.
No focused tests added for these; track as debt.

## 5. What is and is not evidence
- Golden 25/25 is a replay regression. The holdout run (21/24) is a replay of cases already promoted into the ledger, **not** a new blind holdout. No new isolated set and no different-model review exists.
- Reviewer is the same model family; the external reviewer's model is unknown.

## 6. Playback checklist (28 local WAV, nothing committed; ASR cannot approve anything)
Folder: `D:\Project\UNFOLDIQ\out\phase7-gps-v4-samples\`. Index with the exact synthesized text: `Report/evidence/phase-7/script/qa/pronunciation-samples-index-v4.json`. Listen in this order, writing down for each term "natural / odd / wrong":

| Term | A: original text (1.0) | B: profile reading (1.0) | C: profile reading (1.1) | Alternate (1.0) |
|---|---|---|---|---|
| L2C | `L2C__before-original-text-speed1.0.wav` | `L2C__after-profile-speed1.0.wav` | `L2C__after-profile-speed1.1.wav` | |
| L5, L1C (and L2C) | `L5-L1C-L2C-Galileo__before-original-text-speed1.0.wav` | `..__after-profile-speed1.0.wav` | `..__after-profile-speed1.1.wav` | |
| WAAS, FAA | `WAAS-FAA__before-original-text-speed1.0.wav` | `WAAS-FAA__after-profile-speed1.0.wav` | `WAAS-FAA__after-profile-speed1.1.wav` | `WAAS-FAA__alt-wahs-speed1.0.wav` ("wahs" may sound the same as B; see index) |
| NIST | `NIST__before-original-text-speed1.0.wav` | `NIST__after-profile-speed1.0.wav` ("nist") | `NIST__after-profile-speed1.1.wav` | `NIST__alt-letters-speed1.0.wav` ("N I S T") |
| pseudorange | `terms-pseudorange__before-original-text-speed1.0.wav` | `terms-pseudorange__after-profile-speed1.0.wav` | `terms-pseudorange__after-profile-speed1.1.wav` | |
| ionosphere, troposphere | `terms-ionosphere-troposphere__before-original-text-speed1.0.wav` | `..__after-profile-speed1.0.wav` | `..__after-profile-speed1.1.wav` | |

Pace and prosody at the two speeds: the four calibration segments `A-hook`, `B-numbers`, `C-technical`, `D-accuracy`, each as `<name>-speed1.0.wav` and `<name>-speed1.1.wav` (D-accuracy is the new N29). Pronunciation status stays `PENDING_OWNER_EAR_REVIEW`; WAAS is unresolved.

## 7. Duration
9:33 (speed 1.0) and 8:57 (speed 1.1) are narration-only extrapolations from 448 words (32.5%), bounds 8:59 to 10:04 and 8:20 to 9:30. Chapter gaps, pauses between scenes and montage timing can make the real video longer; no full-track or rendered duration has been measured.

## 8. Unresolved approvals (all owner decisions)
1. Exact v4 text, hash `b3561db3d17d9331`, including my N19b/N29 wording or your preferred alternative (section 1).
2. Human ear check of the six readings (WAAS open) and speed 1.0 or 1.1.
3. The three dispositions (N14 explanatory geometry, acronyms routed to ear check, thumbnail/N36 deferred to packaging) remain draft with `ownerConfirmation: PENDING`.
4. Release/production gate: untouched; the approval CLI will be run only after your explicit approval message and would only open the TTS gate.
