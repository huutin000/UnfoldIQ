# AGENT HANDOFF: Phase 7 GPS explainer, script v4

Written 2026-10-11. Location is `Report/phases/phase-7/` (not the repo root) because AGENTS.md says reports go under `Report/` and the root holds only configs/docs. Nothing is committed; HEAD is `7eca0a0`.

## 1. Task and objective
UNFOLDIQ Phase 7, GPS explainer (`projects/phase7-gps-explainer`). Re-QA script v4 (edits to N03, N18, N19b, N29 only), canonicalize it as `fss-phase7-gps-explainer@v2`, get owner ear review and owner approval. Hard limits still in force: no full TTS, no render, no Flow/Veo, no paid API, no push or merge unless the owner says so.

## 2. Completed
- v4 script re-verified against sources; Script QA READY_FOR_LOCK (0 FAIL, 0 undisposed REVIEW); golden 25/25; holdout replay 21/24 (a replay, not a blind holdout).
- FSS `@v2` canonicalized, text hash `b3561db3d17d9331` (v3 `@v1` was `f814512dc6ca1986`, untouched).
- Duration re-measured on 4 segments (448 words): about 9:33 at speed 1.0, 8:57 at 1.1.
- Samples generated and packaged; owner listened to 7 files, all NATURAL. Owner chose WAAS "W A A S", NIST "nist", speed 1.0, profile unchanged (`pron-2243101e4d39`).
- **Owner approval recorded** (owner message, this session): `script-owner-approval.js` ran for `@v2`, hash `b3561db3d17d9331`. Plan `ttp-77f300b60896` has `productionTtsBlocked = false`, `READY_FOR_TTS`. The 3 dispositions are `ownerConfirmation: CONFIRMED`.

## 3. In progress / exact stopping point
Stopped after approval, while checking the full-TTS input loader. `loadCanonicalTtsInputs(@v2)` returns `TTS_DIRECTION_STALE` (not an approval problem): the manifest entry `narrationDirectionVersion` is `UNRESOLVED` ("v2 coverage=0% INVALID_SEGMENTS"). Cause: `fss-canonicalize.js` creates the narration direction with `directions: []`, and `validateNarrationDirection` (`lib/narration/index.js`) gives `allValid = false` when there are no segment results. v1 had the same problem (`nd-1be5f39e7bf3` UNRESOLVED in HEAD's manifest). The pilot works because it has real directions (`fss-backfill.js`, coverage 25%). Nothing was changed for this yet; the owner has not chosen a fix.

## 4. Files modified
Tracked:
- `scripts/cli/fss-canonicalize.js`: `cfg.sourceScriptFile` (default `script.json`); revise narration direction when one exists; reuse the existing pronunciation profile when entries match (else stop, checked before any write); refuse to rerun a version that already has an owner approval; repoint DAG `SCRIPT_QA_DECISION` to the new version and set CLEAN.
- `projects/phase7-gps-explainer/{dependency-dag,manifest/project-manifest,telemetry/events}.json`: now point at v2 / `ttp-77f300b60896`.

New (untracked), all under these paths:
- `Report/evidence/phase-7/script/`: `gps-script-v4.md`, `fss-config-v4.json`, and in `qa/`: `script-qa-v4.json`, `golden-results-v4.json`, `holdout-rerun-v4.json`, `claim-verification-v4.md`, `editorial-v4.json`, `dispositions-v4.json` (confirmed), `tts-calibration-v4.json`, `pronunciation-samples-index-v4.json`, `pronunciation-sample-addendum-v4-wahs.json`, `fss-canonicalization-result-v4.json`.
- `Report/phases/phase-7/`: `OWNER_SCRIPT_APPROVAL_PACKAGE_V4.md`, `OWNER_HANDOFF_V4_REV2.md`, this file.
- `projects/phase7-gps-explainer/`: `script-v2.json`, FSS `-v2.json`, `script-qa/...@v2.json` (now with `ownerApproval`), voice artifacts for v2 (`hum-49965f9304f0`, `fid-ed71c7b73d5c`, `nqa-65a5ea4288e4`, `nd-813ce6990d3c`, `prp-c9eab301c6c0`, `ttp-f581de2962bc`, `ttp-77f300b60896`).
- `tests/pipeline/test-fss-canonicalize-versioning.js`: 6 isolated tests.
- Gitignored, not committed: `out/phase7-gps-v4-samples/` (28 wav + 1 extra WAAS wav), `out/phase7-gps-v4-listening-package.zip`, `out/phase7-gps-v4-wahs-sample.zip`.

## 5. Decisions and assumptions
- N19b and N29 were re-worded versus the review candidate to pass QA (disclosed to the owner, who accepted the final text). QA-tool debt (not fixed): ordinal "ninety-fifth" parsed as 90; C12 `position error` pattern overbroad; "The receiver" repetition heuristic.
- Scratch scripts for Kokoro/ASR live outside the repo (scratchpad); none are committed.
- WAAS stays letters (a word-like reading would need an IPA entry, operator-sourced, as a versioned profile revision).

## 6. Checks run and results
- `npm run test:qa`: 0 failed. `npm run check:repo-structure`: OK. `node tests/pipeline/test-fss-canonicalize-versioning.js`: 6 passed (run before the approval; not rerun after).
- Hash recomputed from the script table, FSS v2, QA decision and plan: all `b3561db3d17d9331`.
- Full regression was not run.

## 7. Errors and blockers
- **`TTS_DIRECTION_STALE`** as in section 3. Blocks full TTS even though the approval gate is open.
- `fss-canonicalize.js` is not atomic if a step fails mid-chain.
- `script-owner-approval.js` picks the narration direction file with `readdirSync(...)[0]` and the latest pass by file name; the resulting plan bound the correct v2 nd/pass this time, but this is fragile when a project has several versions.

## 8. Remaining TODO
1. Owner picks a narration-direction fix: (a) add a few real directions via `reviseNarrationDirection` (creative content, owner approval), or (b) make an empty direction valid in `lib/narration` with tests. Either creates a new narration direction and a new plan id; script text and hash are unaffected, but approval must be checked on the rebuilt plan.
2. Re-verify `loadCanonicalTtsInputs(@v2)` returns ok.
3. Only then, on the owner's explicit instruction, full Kokoro TTS (a separate step; the gate being open does not start it).
4. Later: packaging (thumbnail promise, N36 sources in the description), QA-tool debt, commit (owner has not asked for a commit).

## 9. Exact next action on resume
Ask the owner which fix to take (section 8, item 1). Do not run TTS, render, Flow/Veo or paid APIs and do not push.

## 10. Commands to rerun
```
node scripts/checks/script-qa.js --script Report/evidence/phase-7/script/gps-script-v4.md --ledger Report/evidence/phase-7/research/claim-ledger.json --meta Report/evidence/phase-7/script/script-meta.json --editorial Report/evidence/phase-7/script/qa/editorial-v4.json --dispositions Report/evidence/phase-7/script/qa/dispositions-v4.json --wps 2.402 --basis MEASURED --golden-passed
node tests/pipeline/test-fss-canonicalize-versioning.js
npm run test:qa
npm run check:repo-structure
node -e "const r=require('./lib/tts-audio/index.js').loadCanonicalTtsInputs(process.cwd(),'phase7-gps-explainer',{scriptArtifactId:'fss-phase7-gps-explainer',scriptVersion:2,voiceBibleRef:'vb-19f4fd6a4596'});console.log(r.ok,r.code)"
```
Do not rerun `fss-canonicalize.js` for `@v2`: the version now has an owner approval and the CLI refuses.

## 11. Task statuses to preserve
No ManageTask/task IDs exist in this session. States to keep: `FINAL_SCRIPT_LOCKED` was never set by me (the owner approval is recorded in the decision `@v2`); pronunciation for the six terms is as heard and chosen by the owner (7 samples NATURAL); full TTS, render, Flow/Veo and paid APIs: not run.
