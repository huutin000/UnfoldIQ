# OWNER SCRIPT APPROVAL PACKAGE v4: GPS explainer

**Verdict: READY_FOR_OWNER_REVIEW.** `FINAL_SCRIPT_LOCKED = NO`. No approval recorded, no full TTS, no render, no Flow/Veo, no paid API, no push. Production TTS stays blocked (`SCRIPT_OWNER_APPROVAL_PENDING`). The v3 package (`OWNER_SCRIPT_APPROVAL_PACKAGE.md`) is superseded for text, hash and duration, and was not edited.

## 1. What you are approving
| Item | Value |
|---|---|
| Candidate | `Report/evidence/phase-7/script/gps-script-v4.md` (v2, v3 unchanged) |
| Canonical FSS | `fss-phase7-gps-explainer@v2`, project `phase7-gps-explainer` (`@v1` kept; any approval of v1 does not cover v4) |
| Text hash (QA decision, FSS, TTS plan) | `b3561db3d17d9331` (v3: `f814512dc6ca1986`, stale for v4) |
| Size | 37 scenes, 1,377 words (v3: 1,349), `am_michael` |
| Edits vs v3 | N03, N18, N19b, N29 only (verified: the other 33 narration and evidence cells are identical) |

## 2. Scene diff
See "Changes from v3" in `gps-script-v4.md`. **Deviation from your review candidate (please confirm):** the candidate's N19b and N29 failed 3 deterministic checks, so I re-worded them.
- N19b: "The receiver could absorb that shared error into its own clock bias, so its position estimate..." became "That shared error could be absorbed into the receiver's own clock bias, so the position estimate..." (avoids a third "The receiver" sentence opening).
- N29 now: "Accuracy comes in layers. The U.S. government commits to a daily global average signal-in-space ranging error of at most two meters, with ninety-five percent probability, across healthy satellites. On one day in 2021, that average was at most about sixty-four centimeters. But that does not describe your phone's accuracy. Your position also depends on ..." Changes vs the candidate:
  - "ninety-fifth percentile" became "ninety-five percent probability" (the number checker parsed 90; GPS.gov says "95% probability").
  - "official GPS standard ... ceiling" became "U.S. government commits ... at most" (SRC15 wording).
  - "was about sixty-four" became "at most about sixty-four" (the source is <= 0.643 m).
  - "not your phone's position error" became "does not describe your phone's accuracy" (C12 forbids "position error").

## 3. Evidence and QA (all re-run on v4; no old PASS reused)
| Gate | Result | Evidence |
|---|---|---|
| Claim verification (C11/C12/C13/C21/C23/C25) | PASS. Ledger v1.2.0 unchanged. N19b "circular" confirmed on the live SRC24 page (the ledger quote lacks the word) | `qa/claim-verification-v4.md` |
| Script QA | READY_FOR_LOCK: 37 scenes, 0 FAIL, 0 undisposed REVIEW | `qa/script-qa-v4.json` |
| Golden regression | 25/25 (13/13 negatives, 3 documented editorial-only limits, 0 false positives) | `qa/golden-results-v4.json` |
| Holdout replay | 21/24 as originally predicted, 0 false positives. The 3 differences are documented effects of round-1 promotion into the ledger (H-N1 and H-N7 now detected; H-N9 flagged under another code). This is a replay on a no-longer-blind set, not a new blind holdout | `qa/holdout-rerun-v4.json` |
| Repo checks | `npm run test:qa` 0 failed; `npm run check:repo-structure` OK | |
| FSS canonicalization | fidelity PASS, naturalness PASS, FSS text equals QA text (checked), manifest and DAG updated | `qa/fss-canonicalization-result-v4.json` |
| Gate | `loadCanonicalTtsInputs` for @v1 and @v2: `TTS_INPUT_NOT_READY ... UNRESOLVED`; plan `ttp-f581de2962bc` has `productionTtsBlocked = true`, `SCRIPT_OWNER_APPROVAL_PENDING` | |

## 4. FSS version / hash mapping
| Artifact | v3 chain | v4 chain |
|---|---|---|
| Source script | `script.json` | `script-v2.json` |
| Humanization | hum-8ab7d7a1fca2 | hum-49965f9304f0 |
| Evidence fidelity | fid-94c5c7450319 | fid-ed71c7b73d5c |
| Naturalness | nqa-0c3d0cab5b06 | nqa-65a5ea4288e4 |
| FSS | `fss-phase7-gps-explainer-v1.json` | `fss-phase7-gps-explainer-v2.json` |
| QA decision | `script-qa/...@v1.json` (hash f814512dc6ca1986) | `script-qa/...@v2.json` (hash b3561db3d17d9331) |
| Narration direction | nd-1be5f39e7bf3 | nd-813ce6990d3c |
| Pronunciation profile | pron-2243101e4d39 | same (entries unchanged) |
| Pronunciation pass | prp-576fd44703c0 | prp-c9eab301c6c0 (CLEAN / OVERRIDE_APPLIED) |
| TTS-ready plan | ttp-932f25f33326 | ttp-f581de2962bc |

Manifest and DAG now point to v2. All v1 files are untouched (`git status` shows only manifest, DAG and telemetry modified among tracked project files).

Tooling change (the CLI could not version-bump): `scripts/cli/fss-canonicalize.js` now (a) writes the source to `cfg.sourceScriptFile` (default `script.json`), (b) revises the narration direction when one exists, (c) reuses the existing pronunciation profile if its entries match the config, else stops. Config: `fss-config-v4.json`. Dry run first in a scratch git worktree, then run for real. This CLI change has no dedicated test.

## 5. Duration (same method as v3, re-measured; `qa/tts-calibration-v4.json`)
4 segments, 448 words = 32.5% of the script (v3: 26%). Edited segments A (N01-N03), B (N17-N19b) and new D (N29) were re-measured; unedited C (N24, N26) reproduced v3 exactly.

| Speed | w/s | Estimate for 1,377 words | Bounds | >= 8:00 |
|---|---|---|---|---|
| 1.0 | 2.402 | about 9:33 | 8:59 to 10:04 | yes |
| 1.1 | 2.564 | about 8:57 | 8:20 to 9:30 | yes |

v4 is about 30 s longer than v3 (more words; N29 reads slowly at 2.28 w/s). Narration only. Default for listening: 1.0, with 1.1 as comparison. Not an owner choice yet.

## 6. Pronunciation samples (PENDING_OWNER_EAR_REVIEW; I have not listened)
Folder `D:\Project\UNFOLDIQ\out\phase7-gps-v4-samples\` (gitignored, 28 wav). Index: `qa/pronunciation-samples-index-v4.json` (file, text synthesized, ASR proxy).

| Term | Candidate reading | Files |
|---|---|---|
| L2C | "L two C" | `L2C__before-original-text-speed1.0`, `L2C__after-profile-speed1.0/1.1` |
| L5, L1C | "L five", "L one C" | `L5-L1C-L2C-Galileo__*` |
| WAAS, FAA | "W A A S" (alt "wahs"), "F A A" | `WAAS-FAA__*` incl. `alt-wahs` |
| NIST | "nist" (alt "N I S T") | `NIST__*` incl. `alt-letters` |
| pseudorange, ionosphere, troposphere | no entry | `terms-pseudorange__*`, `terms-ionosphere-troposphere__*` |

Caveat: the ASR proxy (faster-whisper base) heard "W-A-A-S" for both the default and the `alt-wahs` file, so the "wahs" variant may not sound different; it heard "Missed" for unprofiled "NIST". It cannot decide anything.

## 7. Draft dispositions (agent-proposed, `ownerConfirmation: PENDING`; `qa/dispositions-v4.json`)
1. N14: ACCEPT as explanatory geometry (the quantitative claim is evidenced in N15, SRC17).
2. Acronym pronunciation: ACCEPT routing to the owner ear check; the six readings are not approved.
3. Thumbnail promise: DEFER to the packaging stage; N36 ("the list is in the description") needs sources in the description before publish.

## 8. Limitations and remaining risks
- Same-model reviewer; the external reviewer's model is unknown, so independence is not established.
- 3 documented editorial-only classes the QA cannot see; originality LOW (1 episode), channel level NOT_PROVEN; ASR is noisy.
- Duration is extrapolated from 32.5% of the script.
- N19b rests on Misra's idealized-orbit analysis; N29 on one daily GPS.gov value; government sources are one independence group.
- The ledger does not yet store the word "circular" for SRC24 (checked on the live page only).
- The holdout is a replay, not blind.

## 9. Decisions needed from you
1. Approve the v4 text (hash `b3561db3d17d9331`) **including my N19b/N29 rewording**, or request edits (any edit makes QA and approval stale by design).
2. Confirm or change the six pronunciation readings after listening.
3. Speed 1.0 (about 9:33) or 1.1 (about 8:57).
4. Confirm the three draft dispositions and the limitations in section 8.

Approval sentence to send me: "Approve fss-phase7-gps-explainer@v2, hash b3561db3d17d9331, speed 1.0 or 1.1, pronunciation as listed or with changes." I will then run `script-owner-approval.js --project phase7-gps-explainer --script fss-phase7-gps-explainer --version 2 ...`. That only opens the gate; it does not run TTS.

## 10. Commands run
- `node scripts/checks/script-qa.js` (v4 script and golden), holdout replay via `lib/script-qa/golden.js`.
- `node scripts/cli/fss-canonicalize.js --config Report/evidence/phase-7/script/fss-config-v4.json` (dry run in a scratch worktree, then real).
- `npm run test:qa`, `npm run check:repo-structure`.
- Local Kokoro 0.9.4 (CPU) and faster-whisper via scratch scripts outside the repo; WebFetch read of two public pages (GPS World, GPS.gov).
