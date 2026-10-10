# Phase 6B — Creative Differentiation / Originality / Explainable Quality (report)

**Verdict: PHASE_6B = COMPLETE · PHASE_6_MAJOR_GATE = PASS · PHASE_6 = COMPLETE · PHASE_7_READY = YES** (with the honest limitations in §20). Run 1 failed 4 env-only suites; after owner-approved `npx playwright install chromium`, run 2 = 199/199 PASS, 1033.3 s (`full-regression-6b-final-run2.log`). Gate JSON: `Report/evidence/phase-6b/phase6-major-gate.json`.

## 1. Entry gate + snapshot
HEAD `b40b84f` + uncommitted 6B files. Locked canonical `final.mp4` sha256 `7954a86a…dfcdf` re-hashed = unchanged; owner approval + variant `pkv-202fd90e1b72` unchanged. Baseline before 6B: `tests/creative` 66 tests PASS; 195 suites in 6A.

## 2. Phase 6A handoff (all carried)
CANONICAL_PILOT_LINEAGE=PARTIAL · FINAL_MULTIMODAL_WATCH=PASS_WITH_LIMITATIONS · AUDIO_VISUAL_QA=REVIEW_REQUIRED (owner-accepted) · PACKAGING_QA=ACCEPTED_NON_BLOCKING (not forged) · the 57s pilot does not prove Phase 4/7 long-form. Embedded in `quality-assessment.json#limitations`.

## 3. Market review
`Report/evidence/phase-6b/phase6-market-gap-review.md` — 3 YouTube Help pages fetched fresh; 3 other sources cited from the task file, not re-fetched.

## 4. Reuse audit
Reused: `lib/creative-retention` (input, fingerprint v1, findings, repair owners, DAG bridge), artifact store, DAG, text helpers, creative test harness. New: `lib/creative-differentiation/{policy,guard,bakeoff,originality,quality,controls,evidence,index}.js`.

## 5. 6.4 Style Bake-off
Default NO_BAKE_OFF; ≤2 candidates (hard 3, justified); distinctness check; shared-input hashes; rubric-only comparison; cached ≤35% segment preview, 1-render cap; locked-final overwrite refused. Real pilot: 3 decisions evaluated, all NO_BAKE_OFF (0 variants, 0 renders; only P3 findings). A SYNTHETIC metadata-only demo shows the SELECT/UNAPPROVED flow. Tests S01–S08 (8/8).

## 6. 6.5 Originality fingerprint + corpus limits
Fingerprint v2 (hashed shingles only, owner/channel scoped) over the 6A fingerprint. Real corpus = ONE episode → `CROSS_VIDEO_REAL_CORPUS=INSUFFICIENT`, `CHANNEL_LEVEL_ORIGINALITY=NOT_PROVEN`. Pilot single-video risk LOW.

## 7. False-positive tests
O01–O12 + internal repetition: 13/13. Golden 8/8 (identity, same subject, recap, serial, stock → LOW; near-duplicate / exact → HIGH). Synthetic only.

## 8–9. 6.6 Quality scoring, calibration, blockers
13 dimensions, anchored 0–4, N/A vs NOT_MEASURED, assessor/confidence/coverage; gate stored apart from score; P0/P1 factual/rights/security/technical/approval → FAIL even at score 4.0; a model cannot override deterministic QA. Golden 12/12 with persisted bands; Q01–Q10 10/10.

## 10. 6.7 Creator controls
IMPLEMENTED: Director Prompt (bounded, versioned, override clauses rejected), hash-chained override ledger (P2/P3 only, scoped to video hash + rubric version). MERGED: Representative Preview → bake-off preview cache. DEFERRED with reason: Performance Reference. PARTIAL: Channel Editorial Identity. C01–C07 8/8. Non-blocking.

## 11. Dependency/cache integrity
Cache keys = versions + corpus fingerprint + evidence hash (+ video hash for quality). Rubric/comparator/corpus change invalidates results, not media bytes. Control changes dirty downstream via the existing DAG (C05).

## 12. Canonical pilot
Real finding: the legacy adapter labelled scenes `TITLE`; modality was patched to `DIAGRAM` per the coverage matrix. The final scene text adds 0 content tokens vs the QA-approved script (upstream fidelity/naturalness QA applies, MEDIUM confidence). Quality: 12 applicable / 12 assessed, continuity N/A. **PASS only because the packaging REVIEW_REQUIRED is covered by the owner acceptance carried from the 6A handoff** (REVIEW_REQUIRED without it). No ordinal scores were invented, so `summary.score` = NOT_COMPUTED. Open 6A findings: FRAMING_REPETITION, MODALITY_MONOTONY (both P3).

## 13. Golden results
`originality-golden-corpus-report.json` 8/8; `quality-scoring-golden-report.json` 12/12.

## 14. Cost/time/storage
0 model calls, 0 Gemini re-upload, 0 renders, 0 VND; evidence generation ≈103 ms; full regression 1037.3 s (6A: 1008–1294 s) → ACCEPTABLE. `phase6b-runtime-cost-report.json`.

## 15. Market Gap Registry
GAP-048..051 added (no IDs invented/overwritten); GAP-045 marked consumed; GAP-046 stays DEFERRED.

## 16. Tests
Targeted: `npm run test:creative` → 12 suites, 0 failed (+39 tests: bakeoff 8, originality 13, quality 10, controls 8). Final full regression `node scripts/run-tests.js` (PLAYWRIGHT_BROWSERS_PATH unset): **191 PASS / 4 FAIL**, 1037.3 s, log `Report/evidence/phase-6b/full-regression-6b-final.log`. Failed: research/test-auth-extract, test-browser-extract, test-crawl4ai-bridge, test-robots-ratelimit. Re-running those 4 alone still fails.

## 17. Hygiene
`check:workspace` ok (21 projects vs 20 noted in 6A — not traced to 6B files, not investigated), `check:repo-structure` OK.

## 18–19. Gates
See `phase6-major-gate.json`: all PROVEN/READY/PASS except FULL_REGRESSION=FAIL → PHASE_6B NOT_COMPLETE, PHASE_6 NOT_COMPLETE, PHASE_7_READY NO.

## 20. Limitations / blockers
- Blocker: installed `playwright-core` 1.64.0-alpha needs a Chromium revision absent from `%LOCALAPPDATA%\ms-playwright` (only 1247/1248). Unrelated to 6B diffs. Needs owner OK for `npx playwright install chromium`, then one full re-run.
- Originality proven on a synthetic corpus only; channel level NOT_PROVEN.
- Lexical layer is English-tuned (GAP-047). No new model watch (GAP-046). No retention/monetization claims.

## 21. Final verdict
COMPLETE. Blocker resolved (Chromium installed); no source change between run 1 and run 2.

## 22. Phase 7 handoff
Ready to plan; do not auto-start. Phase 7 must prove 8–12+ min long-form E2E; channel-level originality needs ≥5 real episodes.

## Addendum — final regression
Run 2: `node scripts/run-tests.js` → 199 PASS / 0 FAIL, 1033.3 s. The run rewrote tracked baseline/telemetry files; diff saved to `regression-generated-tracked-changes.patch` (left uncommitted).
