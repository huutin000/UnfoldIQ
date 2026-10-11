# SCRIPT QA INTEGRATION REPORT (Phase 7, Slice B)

Scope: make UNFOLDIQ detect, judge, repair and re-verify a script by itself, without a manual outside review. Reuse what exists; add only what is missing. No new phase, no restart, no paid API, no full TTS, no render, no Flow/Veo, no full regression.

## 1. Existing capability audit (read-only audit by a sub-agent, call sites spot-checked by grep)
| Capability | Where | Works? | Wired into production? | Blocks errors? |
|---|---|---|---|---|
| Research sufficiency / claim ledger | `lib/research-evidence/*` | yes (tests) | only via `lib/research-to-story.js`, which no production code calls | policy-driven but never invoked for this project |
| Script evidence gate (qualifiers, attribution) | `lib/research-story/script-evidence-gate.js` | yes | same as above | advisory |
| Evidence fidelity | `lib/spoken-script` `runEvidenceFidelity` | yes | `scripts/cli/fss-backfill.js` only | hard block on canonical FSS, but it compares humanized text with source text, **not claims with sources**; spelled-out numbers are invisible to it |
| Spoken humanizer, naturalness QA, FSS lock | `lib/spoken-script` | yes | `fss-backfill.js`; `lib/tts-audio` refuses a non-canonical script | the only enforced downstream gate |
| Hook, beats, title promise | `lib/creative-retention` | yes, 0 model calls | diagnostics scripts only | advisory report |
| Originality / quality scoring | `lib/creative-differentiation` | yes | diagnostics only | gate stored apart from score; needs a corpus (channel level `NOT_PROVEN`, 1 real episode) |
| Duration / pacing | `lib/duration-planner.js`, `duration-check.js` | partly | only a file-existence check in `step10-readiness.js` | no |
| Visual feasibility | `lib/visual-motion` (+ `routing.js` from this phase), `lib/story-structure` | yes | `story-structure` has no production caller | structural, not factual |
| Title/thumbnail promise | `lib/packaging/claims.js` | yes | tests only | needs claim IDs; no thumbnail exists yet |
| A "script QA" stage or FINAL_SCRIPT_LOCKED state | none | | | there is no such state; the only "lock" is a canonical FSS (immutable versions) |

Findings: no pipeline stage runs script QA; capabilities exist but are not connected; the only thing that blocks TTS is the canonical-FSS check. Nothing checked a spoken number or claim against source text.

## 2. Did `script-claim-qa.js` find semantic or factual errors?
**No.** It checked evidence IDs, a hand-written phrase-to-number table (GPS-specific), banned phrases and schema-like structure. It reported **PASS on GPS draft v2**, which contained the "ten kilometers a day of error" conflation the owner later flagged. It has been **deleted** and replaced by the generic engine below, so there is a single QA path.

## 3. What was integrated (one orchestrator, not a second pipeline)
`lib/script-qa/` (+ CLI `scripts/checks/script-qa.js`):
- **Reused as-is:** `spoken-script.evaluateNaturalness`; `creative-retention.analyzeCreativeRetention` (hook checkpoints, beats, open/dropped loops, title-promise coverage; rhythm findings are skipped because they need a real timeline); `visual-motion/routing.routeShot` (every scene must be routable, no spend); `script-evidence-gate.qualifierPresent`; `creative-differentiation.assessOriginality` (against the real pilot fingerprint).
- **Added (generic, no topic knowledge):**
  1. Spoken-number verifier (`numbers.js`): parses what a narrator says (words, decimals, fractions, units, qualifiers) and what evidence writes (digits, thousands separators, scientific notation, words), converts units and applies an explicit policy: MATCH after rounding to the spoken precision, qualified bounds (at least, at most, under), COARSE approximation (REVIEW), MISMATCH or NO_EVIDENCE (FAIL).
  2. Evidence mapping per scene, absolute and causal-overclaim detection, weak lexical overlap, repeated content, pacing/duration basis (MEASURED vs ESTIMATED).
  3. **Ledger-declared constraints**: topic knowledge lives in the claim ledger as data (`forbidden` regexes, `caveats` trigger/requires, `conflicts`), so the engine contains no GPS vocabulary (a test enforces this).
- **Role separation:** findings are labelled `DETERMINISTIC`, `EXISTING_CAPABILITY` or `EDITORIAL`. Editorial findings come from outside the code (human or model) and carry `assessor.independent`. The reviewing model here is the same family as the generating model, so it is recorded as **not independent**; an editorial "resolved" can never clear a deterministic FAIL (tested). The owner stays the independent check.
- **Verdict logic:** `READY_FOR_LOCK` only if there is no FAIL, every REVIEW is fixed or has an accepted disposition with a reason, duration is MEASURED, and the golden tests passed. It never locks anything.

## 4. Golden regression (real v1/v2 errors, positive guards)
`tests/fixtures/script-qa/golden-cases.json`, results in `Report/evidence/phase-7/script/qa/golden-results.json`:
- **Negatives 10/10 detected:** v1 S08 (flat-map caveat, absolute), S09 (spheres meet at your position), S22 ("a tenth of a second" vs 0.067 to 0.086 s), S25 (shift is the travel time), S34 ("exactly what time"), S40 ("only works because"); v2 N03 and N19 (10 km/day), N24 (unmapped derivation), N29 (URE vs phone accuracy).
- **Positives 9/9 clean (no false positives):** corrected v3 scenes, an Explain hypothetical ("exactly five kilometers"), calendar phrase "one day in 2021", exact-match wording.
- **Known false negatives (2, documented):** v1 S01 (implying the dot is purely GPS) and v1 S24 (precision of "pulses"): no deterministic rule can see them; they need the editorial reviewer.
- **Honest process note:** the first run found 9/10; S25 was missed because ledger caveats were scoped to cited claims only. I made ledger constraints project-wide and re-ran (10/10). The rules were therefore tuned on these same cases; the held-out evidence is the full v1, v2 and v3 runs (below) and the topic-agnostic test with a different topic. A matcher bug (value compared ignoring units) was caught by the new tests and fixed.

## 5. Limits (do not over-trust)
- The ledger-driven rules only catch errors someone has declared (forbidden/caveat) plus numbers, mapping and absolutes. New semantic errors still need an editorial reviewer; a same-family model is not independent.
- Evidence overlap is lexical and advisory; number matching can read incidental counts (handled: small unitless counts, "one day").
- Not wired as a DAG stage or into `materializeFinalSpokenScript` yet. Recommended next engineering step (LATER): call `runScriptQa` before FSS backfill and block on non-READY.
- Quality scoring (13 dimensions) was not run: it needs a project's FSS, fidelity decision and timeline evidence, which do not exist at script stage. Originality: risk LOW against the 1 real episode; `channelLevelOriginality = NOT_PROVEN`.

## 6. Tests and commands (targeted only)
`node tests/qa/test-script-qa.js` (6 groups, all pass); `node scripts/run-tests.js qa` (6 suites pass); `node scripts/checks/script-qa.js --golden ...` (21/21); `node scripts/checks/script-qa.js --script ... --ledger ...` on v1, v2, v3. No full regression.

## 7. Holdout evaluation (added in the final-approval pass)
`tests/fixtures/script-qa/holdout-cases.json`: 24 cases (15 negatives, 9 positives; 3 of them from a different topic) written after the engine and ledger were frozen (sha256 recorded in `qa/holdout-results-round1.json`) with a predicted outcome for each, written before the first run. Nothing was tuned on them before the run.
- **Result: 23/24 as predicted.** Negatives with the expected finding: 11/15. Predicted misses confirmed (3): a position-error conflation phrased without the ledger trigger words (H-N1), a direction error with a correct number ("slower" instead of "faster", H-N6), and a claim that contradicts the one-way broadcast when the ledger has no rule for it (H-N7). One surprise (H-N9): "fourteen thousand meters an hour" was flagged only as a coarse approximation (REVIEW), not as a mismatch, because an unrelated "10 kilometers" in the same quote lay within 50%. It is not silent: the verdict stays REVIEW_REQUIRED until dispositioned. **False positives: 0/9**; the other-topic cases behaved as expected.
- **After the run** the failure modes were promoted: ledger data (C12 and C1 forbidden patterns) and four new golden cases (golden is now 25/25: 13 negatives, 9 positives, 3 documented editorial-only false negatives). Those holdout cases are therefore no longer independent; the round-1 file is the record and is not re-run. The golden test and the v3 run still pass with the new patterns (no regression on the candidate).
- **Meaning:** the engine reliably catches number and unit slips, absolutes, dropped caveats and ledger-declared conflations; it cannot see semantic direction errors or contradictions nobody declared. That is the editorial reviewer's job, and a same-family model is not independent.

## 8. Script Quality Gate in the pipeline (added in the final-approval pass)
- `lib/script-qa/gate.js`: a decision binds the QA verdict to the exact script text hash. `lib/tts-ready-plan.js` now takes `requireScriptQa` and blocks production TTS (`productionTtsBlocked`) when the decision is missing, not `READY_FOR_LOCK`, stale (text or version changed) or lacks explicit owner approval. The existing manifest rule (an `UNRESOLVED` plan) then makes `lib/tts-audio` refuse with `TTS_INPUT_NOT_READY`; verified on the real project (see the approval package). Plan ids include the gate state, so a blocked plan is never replayed as open.
- DAG: new artifact type `SCRIPT_QA_DECISION` (`lib/dependency-dag`, `schemas/recovery-state.schema.json`), registered with `FINAL_SPOKEN_SCRIPT` as input and as an input of `TTS_READY_PLAN`. `schemas/tts-ready-plan.schema.json` gained an optional `provenance.scriptQa`.
- `scripts/cli/fss-canonicalize.js` (generic, config-driven; `fss-backfill.js` stays pilot-specific) runs QA, golden and measured duration first, then the existing humanization, fidelity, naturalness, canonical FSS, manifest, DAG, narration direction, pronunciation and TTS-ready plan steps. `scripts/cli/script-owner-approval.js` records the owner's approval (approver and source are mandatory) and rebuilds the plan; the agent must run it only after an explicit owner approval.
- **Scope:** the gate is opt-in per plan (`requireScriptQa`) and is on for every project created through the generic CLI; the 6A pilot and its tests are unchanged (narration, spoken-script, pronunciation and dag suites pass). Making it the default for all plans needs a backfill of the pilot and is a LATER decision.
