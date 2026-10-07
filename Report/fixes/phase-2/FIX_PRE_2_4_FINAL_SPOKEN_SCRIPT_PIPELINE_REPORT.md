# FIX PRE-2.4 — FINAL SPOKEN SCRIPT PIPELINE BACKFILL REPORT

**Project:** UNFOLDIQ · **Task:** `FIX_PRE_2_4_FINAL_SPOKEN_SCRIPT_PIPELINE` · **Date:** 2026-10-06
**Verdict: TASK_VALIDATION = PASS → FIX_PRE_2_4_FINAL_SPOKEN_SCRIPT_PIPELINE = COMPLETE · FINAL_SPOKEN_SCRIPT = CANONICAL · PRODUCTION_TTS_BLOCKED = false · NEXT = PHASE 2.4 + 2.5 + 2.6**

---

## 1. Why backfill was required

Phase 2.2+2.3 capability PASSed on a bounded validation fixture (`fss-phase223-validation@v1`, `productionScriptStatus = NOT_APPLICABLE`) and the TTS-ready plan was correctly `productionTtsBlocked = true`. The roadmap chain `Spoken Humanizer → Evidence Fidelity → Naturalness QA → Final Spoken Script` did not exist. This FIX closes exactly that debt; no Phase 2.4 work was started.

## 2. Entry gate

Verified live: PHASE_2_1/2_2/2_3 = COMPLETE; Voice Bible v3 `vb-19f4fd6a4596` (am_michael) LOCKED/productionReady, no rights trigger; FIX_POST_1H_01 COMPLETE; workspace governance ACTIVE; artifact resolver/registry PASS; current phase223 TTS-ready plan detail `PRODUCTION_TTS_BLOCKED(non-canonical script)`; `npm run check:workspace` ok; `npm run check:repo-structure` OK; schema validation PASS; P0 = P1 = 0.

## 3. Source-script candidate audit

| field | value |
|---|---|
| projectId | `pilot-sky-blue` |
| artifact | `projects/pilot-sky-blue/script.json` (8 beats, `scriptVersion 1.0.0`, real Stage-4 story script) |
| contentMode | `everyday-physics-explainer` |
| source provenance | `research/research-brief.json` v? `researchStatus = COMPLETE`, 7 claims C1–C7 each with `classification` (SUPPORTED_FACT) + publisher/URL/accessedAt sources + freshness |
| editorial strategy ref | `editorial-strategy.json` (beyondSearchValue, insightChain, smellChecks) |
| lock/status | no locks (pre-1H artifact); downstream pre-DAG consumers: scene-script.json, audio-manifest.json, captions/, timing/, render/ |
| suitableForBackfill | **YES** — real research-backed script; used only as chain INPUT, never relabelled |

Forbidden fallback (fabricated script) not used. The old phase223 fixture was NOT reused as a source (§36 preserved as historical validation).

## 4. Selected source + content mode

`pilot-sky-blue/script.json` · contentClass **FACTUAL** — explicit resolution recorded in the humanization artifact + this report: research-brief COMPLETE with SUPPORTED_FACT classifications, physics explainer, no fiction markers (`lib/content-class` has no mapping for the modeId, so the explicit resolution + rationale are persisted, never silently defaulted).

## 5. Spoken Humanizer contract

`schemas/spoken-humanization.schema.json` v1.0.0; owner `lib/spoken-script/index.js`. Fields per task §7 (`humanizationId hum-<12hex>`, version, contentMode/Class, sourceScriptRef, sourceTextHash, instructionVersion, segments[] with `sourceSegmentIds[]` split/merge lineage + verbatim sourceText + `candidateTextHash` + bounded `changeTypes[]`, changeSummary, provenance, fingerprint). Storage `voice/spoken-humanization/` lifecycle RETENTION_MANAGED; versions immutable; idempotent replay by semantic fingerprint (provenance/timestamps excluded).

## 6. Humanization execution / provider evidence

Executed by the running agent; recorded honestly in the artifact: `actorType = AGENT, provider = zcode, model = GLM-5.3-Flash` (known from the executing environment; token/cost = `UNKNOWN_NOT_AVAILABLE`, never fabricated — `evidence/fix-pre-2.4/performance-baseline.json`). `instructionVersion = spoken-humanizer-1.0.0`. attempt = 1 (no repair loop needed on the real source). Candidate persisted as `hum-f3ab56c75605`.

**Execution locality (correction pass):** the humanization inference ran on the HOSTED ZCode model runtime — locality = **REMOTE**, not local. (An earlier revision of this report said "executed locally"; that was wrong for model inference and is corrected here. Local execution is proven only for the Kokoro phonemization steps.)

## 7. Before/after structured diff (real source, 8 beats)

Representative (full diff in `hum-f3ab56c75605`):
- B1 hook → split into spoken breath groups: "Look up on a clear day. The sky is blue. But sunlight itself? White. So where does the blue actually come from?" (SENTENCE_SPLIT/CADENCE/CONVERSATIONAL_WORDING)
- B3 → "…several times more strongly than they scatter red." — protected comparison preserved verbatim (RHYTHM)
- B5 → split; both qualifiers ("even more", "less of it", "less sensitive") preserved
- B8 closing → **unchanged** (`changeTypes: []` — no unnecessary rewrite)
No fact/number/date/name/quote changed; no qualifier dropped; no certainty added.

## 8. Evidence Fidelity decision

`schemas/evidence-fidelity-decision.schema.json`; `fid-82860a8f7fd0` (for v2 chain): **PASS**. Per-segment deterministic checks: NUMBER, DATE, QUOTE, NAME, CAVEAT, UNCERTAINTY, COMPARISON, CLASSIFICATION + evidence tracing. 0 issues. Storage `voice/evidence-fidelity/` DURABLE; idempotent.

## 9. Protected semantic checks

- Deterministic extractors: numbers/percentages/units, years/month-dates, quoted strings, capitalized names (stoplist-guarded), hedge terms (§16 vocabulary), certainty boosters.
- Comparison rules: multisets equal → PRESERVED; mismatch → CHANGED_INVALID (FIDELITY_NUMBER/DATE/NAME/QUOTE_CHANGED); hedge **total** may never decrease (synonym swaps like "approximately"→"roughly" are legal; dropping is not) → FIDELITY_CAVEAT_DROPPED; added boosters → FIDELITY_CERTAINTY_INCREASED; comparative phrases ("several times more strongly than") must survive verbatim.
- Evidence tracing (§13): each spoken segment's claims traced through lineage to `research/research-brief.json#claims.<id>` — **9 traced FACT checks** on the canonical chain; unresolvable claim → REVIEW_REQUIRED (blocking; T18 proves canonicalization refuses).

## 10. Naturalness QA

`schemas/naturalness-qa.schema.json`; `nqa-…` for the canonical chain: **PASS**, 0 issues. Metrics measured: sentenceCount/Mean/Variance/Distribution, cadenceUniformity, repeatedTransitionPhrases/Openings/RhetoricalPatterns, abstractLanguageFlags, summaryPhraseFlags, awkwardSpokenPhrases. No AI-detector score anywhere (T20 asserts absence structurally).

## 11. Repair attempts

0 on the real source (first candidate passed both gates). The bounded repair mechanism is proven by tests (T24: FAIL → targeted v2 revision → PASS; limit `MAX_REPAIR_ATTEMPTS = 2`; T25: untouched segments byte-identical).

## 12. Canonical Final Spoken Script

`fss-pilot-sky-blue@v2` at `projects/pilot-sky-blue/input/final-spoken-script/fss-pilot-sky-blue-v2.json` — schema `final-spoken-script-1.1.0`, `productionScriptStatus = CANONICAL`, segments = spoken text ONLY (no SSML/Kokoro markup — asserted by test), lineage `sourceScriptRef → script.json@1.0.0`, `humanizationRef hum-f3ab56c75605`, `evidenceFidelityRef fid-…`, `naturalnessQaRef nqa-…`.

**v1 note (honest history):** the first canonicalization (`fss-pilot-sky-blue@v1`, still on disk, immutable) recorded evidence checks as NOT_APPLICABLE because the claims map was keyed by beat-id instead of spoken-segment-id. The defect was corrected and v2 materialized through the normal revision mechanism; v1 remains loadable history (§27), never deleted or relabelled.

**v1 supersession decision (consistency pass):** external immutable decision artifact `input/final-spoken-script/fss-pilot-sky-blue-v1.SUPERSEDED.json` (`sup-3335e037adbb`): `status = SUPERSEDED_INVALID`, `productionEligible = false`, `supersededBy = fss-pilot-sky-blue@v2`, `reason = evidence-mapping defect`. The v1 file itself is byte-identical to its canonicalized state. `resolveProductionScript()` fails closed with `FINAL_SPOKEN_SCRIPT_SUPERSEDED` for v1 — no production TTS resolver can select it — while v2 resolves as CANONICAL (proven by test).

## 13. Version/lineage/history

Source script → humanization attempt (v1 candidate id-space; content-class collision in the id seed found and fixed so FACTUAL/FICTION/HYBRID candidates never share an id) → fidelity decision → naturalness decision → FSS v1 (superseded) → FSS v2 (current). All versions immutable + loadable; changed bytes always create a new revision (T29/G20).

## 14. Manifest integration

Fresh 1.5.0 manifest created for `pilot-sky-blue` (honest slots; nothing claimed about pre-1H history). `finalSpokenScriptVersion = fss-pilot-sky-blue@v2, VERIFIED`, detail carries hum/fid/nqa refs. Manifest carries no script/diff/QA bodies. Older manifests unaffected.

## 15. DAG/invalidation

New DAG types `SPOKEN_HUMANIZATION, EVIDENCE_FIDELITY_DECISION, NATURALNESS_QA` (+ dagDoc enum). Chain edges: `SPOKEN_HUMANIZATION → EVIDENCE_FIDELITY_DECISION → NATURALNESS_QA → FINAL_SPOKEN_SCRIPT` (FSS node CLEAN @v2). §29 proof: on version change markDirty dirtied `NARRATION_DIRECTION, PRONUNCIATION_RUNTIME_PASS, TTS_READY_PLAN`; pre-DAG legacy consumers (SHOT_PLAN, VOICE, CAPTIONS, SCENE_TIMING, RENDER) explicitly wired `FINAL_SPOKEN_SCRIPT --SPOKEN_TEXT--> *` and left **DIRTY** with blockedReason (derived from superseded pre-humanized text) — they cannot silently reach final output. Idempotent replay does NOT re-dirty the graph. No FINAL_AUDIO node created.

## 16. Artifact governance

Resolver-approved paths; lifecycle: canonical FSS + fidelity + naturalness DURABLE, humanization candidates RETENTION_MANAGED, diagnostic evidence RETENTION_MANAGED (`evidence/fix-pre-2.4/`), analysis EPHEMERAL. Stable ids + content fingerprints everywhere; no path-only identity (T35).

## 17. Security/privacy

Secret scan PASS on all chain artifacts (T36). No credentials persisted; pilot names stay project-scoped. **Execution locality (honest):** humanization inference = REMOTE (hosted ZCode model runtime — script text was processed by the hosted model); Kokoro quiet phonemization = LOCAL (no network); no other external upload.

## 18. Observability

New event classes: `SPOKEN_HUMANIZATION_CREATED/REVISED, EVIDENCE_FIDELITY_EVALUATED, NATURALNESS_QA_EVALUATED, FINAL_SPOKEN_SCRIPT_CREATED/REVISED/CANONICALIZED, TTS_PRODUCTION_BLOCK_CLEARED` (+ durable subset). Correlation chain proven (T37 + E2E): project → script → hum → fid → nqa → FSS → ND → pass → plan.

## 19. Performance/cost baseline

`projects/pilot-sky-blue/evidence/fix-pre-2.4/performance-baseline.json`: humanizationLatencyMs, fidelityGateLatencyMs, naturalnessQaLatencyMs, canonicalizationLatencyMs, phase22RefreshLatencyMs, phase23RefreshLatencyMs (incl. real Kokoro batch); sourceWordCount 148 → finalWordCount 154 (delta +4.1%); protected checks 108; mismatches 0; **humanizationAttempts = 1, repairAttempts = 0** (the real source passed on its first attempt — corrected in the consistency pass); provider tokens/cost = UNKNOWN_NOT_AVAILABLE; provider locality = REMOTE (hosted model inference), phonemization LOCAL.

## 20. Golden regression

`gold-spoken-script` definition + baseline v1 (comparison PASS). G1–G20: **21/21 pass** (`tests/golden/test-spoken-script-golden.js`).

## 21. T1–T44

| Range | Suite | Result |
|---|---|---|
| T3, T7–T10 | `node tests/spoken-script/test-humanization.js` | 5 passed, 0 failed |
| T4–T6, T11–T18 | `node tests/spoken-script/test-fidelity.js` | 10 passed, 0 failed |
| T19–T25 | `node tests/spoken-script/test-naturalness.js` | 7 passed, 0 failed |
| T1, T2, T26–T38 | `node tests/spoken-script/test-canonicalization.js` | 10 passed, 0 failed |
| T39–T44 + §44 | `node tests/spoken-script/test-e2e-fss-backfill.js` | 9 passed, 0 failed |
| G1–G20 | `node tests/golden/test-spoken-script-golden.js` | 21 passed, 0 failed |

## 22. Real bounded E2E

`node scripts/cli/fss-backfill.js` (idempotent; exercised by test-e2e-fss-backfill): real source → content-mode resolution → humanization candidate → Evidence Fidelity PASS → Naturalness PASS → canonical FSS → 2.2 refresh → 2.3 real `KPipeline(model=False)` refresh → plan READY_FOR_TTS. Proof recorded: source bytes unchanged; only permitted change classes; protected items preserved; no blocking fidelity issue; am_michael authoritative; real phonemization hashes present; `productionTtsBlocked = false`; zero WAV/audio (T44 + E2E-8).

## 23. Phase 2.2 refresh

New Narration Direction `nd-ba9e14b889f3` bound to `fss-pilot-sky-blue@v2` (scriptRef version 2, per-segment sourceTextHashes match canonical text; Voice Bible `vb-19f4fd6a4596`; sparse 2/8 directed; speaker = narrator; no text mutation). Fixture-bound direction NOT reused.

## 24. Phase 2.3 refresh

Pronunciation profile (empty entries — no override-needing terms in the canonical text) + runtime pass `prp-ef2591fc81ec` with the REAL Kokoro quiet runtime (providerLanguageCode `a`, runtimeMode QUIET_PHONEMIZATION, all segments CLEAN, real phoneme hashes). Official native pronunciation markup path remains available (Phase 2.3 FIX regression still green). Source bytes unchanged; issues structured; localized invalidation mechanism unchanged.

## 25. TTS-ready plan

New plan bound to the canonical FSS: `provenance.productionScriptStatus = CANONICAL`, `productionTtsBlocked = false`, `overall = READY_FOR_TTS`, manifest VERIFIED. The phase223 fixture plan remains blocked (`PRODUCTION_TTS_BLOCKED`) — the block clears ONLY for CANONICAL scripts (T41/T43/E2E-5/6).

## 26. Targeted regression

Covered inside full `npm test` (below): story, research, project-manifest, dag, history, recovery, telemetry, golden, provenance, compliance, workspace, storage, voice-bible, narration, pronunciation, providers/Kokoro — 0 failed. Extension untouched → Extension change = NONE.

## 27. Full regression

```text
npm test                     → 29 domains, 0 failed suite(s) in 470.1s
npm run check:workspace      → {"ok":true,"violations":[],"warnings":[],"projects":20}
npm run check:repo-structure → REPOSITORY_STRUCTURE_OK
node scripts/checks/validate-schemas.js → RESULT: ALL TESTS PASSED
```

## 28. P0/P1

**P0 = 0, P1 = 0.** No stop condition fired (§57).

## 29. Humanizer gate — PASS

H1 real source selected · H2 source immutable (byte-proven) · H3 content mode explicit · H4 contract versioned · H5 bounded change classes · H6 prohibited mutation rejected (T11–T17) · H7 bounded repair (T24) · H8 no fabricated provider facts · H9 lineage complete.

## 30. Fidelity gate — PASS

F1–F12 all satisfied (see §8–§9; REVIEW_REQUIRED never coerced — T18).

## 31. Naturalness gate — PASS

N1–N9 all satisfied (see §10; no AI-detector gate — T20).

## 32. Final Spoken Script gate — PASS

S1 existing schema reused (1.1.0 extension, no duplicate) · S2 CANONICAL · S3–S6 refs resolve · S7 stable id/hash · S8 immutable revisions · S9 DAG state correct · S10 stale consumers DIRTY (E2E-7).

## 33. Pre-2.4 handoff gate — PASS

P1/P2 2.2+2.3 bound to canonical FSS · P3 Kokoro native/runtime regression PASS · P4–P5 Voice Bible LOCKED, no rights trigger · P6–P8 plan canonical/unblocked/READY_FOR_TTS · P9 no final audio · P10–P12 full regression PASS, P0 = P1 = 0.

## 34. Final verdict

```text
TASK_VALIDATION = PASS
FIX_PRE_2_4_FINAL_SPOKEN_SCRIPT_PIPELINE = COMPLETE
FINAL_SPOKEN_SCRIPT = CANONICAL (fss-pilot-sky-blue@v2)
PRODUCTION_TTS_BLOCKED = false
NEXT = PHASE 2.4 + 2.5 + 2.6
```

**Files added:** `schemas/{spoken-humanization,evidence-fidelity-decision,naturalness-qa,final-spoken-script-1.1.0}.schema.json`; `lib/spoken-script/index.js`; `scripts/cli/fss-backfill.js`; `tests/spoken-script/{test-humanization,test-fidelity,test-naturalness,test-canonicalization,test-e2e-fss-backfill}.js`; `tests/golden/test-spoken-script-golden.js`; `tests/fixtures/fss/helpers.js`; `projects/pilot-sky-blue/{voice/spoken-humanization,voice/evidence-fidelity,voice/naturalness-qa,input/final-spoken-script,manifest,dependency-dag.json,evidence/fix-pre-2.4}/**`; this report.
**Files edited:** `lib/dependency-dag/index.js`, `lib/telemetry/index.js`, `lib/narration/index.js` (node CLEAN convergence), `lib/pronunciation/index.js` (same), `lib/tts-ready-plan.js` (same), `schemas/recovery-state.schema.json` (+3 enum), `scripts/checks/validate-schemas.js`, `Report/INDEX.md`.
