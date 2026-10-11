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
