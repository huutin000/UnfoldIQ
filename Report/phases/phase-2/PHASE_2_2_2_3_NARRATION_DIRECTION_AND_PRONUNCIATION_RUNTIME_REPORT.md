# PHASE 2.2 + 2.3 — NARRATION DIRECTION + PRONUNCIATION RUNTIME REPORT

**Project:** UNFOLDIQ · **Roadmap:** V6.2 Phase 2 Audio + Caption Foundation
**Task:** PHASE_2_2_2_3_01 (combined Logical Phase 2.2 + 2.3)
**Date:** 2026-10-06 · **Verdict: TASK_VALIDATION = PASS → PHASE_2_2 = COMPLETE, PHASE_2_3 = COMPLETE**

---

## 1. Entry gate

Verified from live canonical state before any product code:

```text
PHASE_2_1 = COMPLETE (FIX_PHASE_2_1_02 report; manifest voiceBibleVersion VERIFIED)
APPROVED_NARRATOR_VOICE = am_michael (vb-19f4fd6a4596, LOCKED, productionReady=true)
MODEL_LICENSE = VERIFIED, VOICE_ASSET_RIGHTS = RISK_ACCEPTED, OUTPUT_USAGE_STATUS = RISK_ACCEPTED
FIX_POST_1H_01 = COMPLETE; WORKSPACE_GOVERNANCE = ACTIVE
npm run check:workspace → ok (projects now 20)   npm run check:repo-structure → REPOSITORY_STRUCTURE_OK
P0 = 0, P1 = 0
```

No canonical truth conflicts. Narrator/model/rights untouched.

## 2. Canonical input audit

- No Final Spoken Script artifact exists yet (DAG slot `FINAL_SPOKEN_SCRIPT` was `NOT_CREATED_YET`; manifest key existed with `version:null`). The Stage-4 pipeline does not produce a spoken-script artifact in this repository yet.
- Priority-3 path taken per task §3: a **bounded Phase-2 validation fixture** was created (`projects/phase223-narration-pronunciation/input/final-spoken-script.json`, `fss-phase223-validation@v1`, 6 segments, en-us, `productionScriptStatus = NOT_APPLICABLE` — stated clearly here per §3).
- New identity contract: `schemas/final-spoken-script.schema.json` (segmentId/ordinal/text; `sourceTextHash` computed downstream, never stored in the script).

## 3. Segment identity

`segmentId` + `segmentOrdinal` + `sourceTextHash` (= `hash16(text)`) bind every direction/pronunciation result to the exact spoken bytes of one `scriptVersion`. Array position is never identity (T-tests prove ordinal+hash binding; G18 proves version/text mismatch → fail-closed stale).

## 4. Narration Direction schema/owner

- Schema: `schemas/narration-direction.schema.json` (v1.0.0). Owner: `lib/narration/index.js`.
- Doc: `narrationDirectionId (nd-<12hex>), version, projectId, scriptRef, voiceBibleRef, language, segments[] (sparse), stats, provenance, fingerprint`.
- Storage: `projects/<id>/voice/narration-direction/nd-<id>.json` via workspace resolver + `DURABLE` lifecycle; versions immutable.

## 5. Direction semantics

speaker (null → narrator via Voice Bible; character voices only from Voice Bible `characterVoices`), emphasis (text span + occurrence, ambiguity rejected), pauseIntent (`MICRO|CLAUSE|BEAT|SECTION` semantic enum, never provider ms), energy (`LOW|BALANCED|ELEVATED`), emotion (validated ⊆ Voice Bible `emotionalRange` = NEUTRAL/FRIENDLY/CURIOSITY/CONFIDENT/INSTRUCTIVE), paceIntent (`SLOWER|MODERATE|FASTER`, intent only — no WPM). Text is never rewritten (schema has no text field; `additionalProperties:false`).

## 6. Sparse/over-direction analysis

Only directed segments are persisted. Stats: `totalSegments/directedSegments/directionCoveragePercent/emphasisCount/explicitPauseCount` + `overDirectionReview` flag at ≥80 % coverage (measured, never auto-failed; full-coverage doc is legal, neutral 0 % doc is valid). Canonical ND: 2/6 directed = 33.33 %.

## 7. Pronunciation profile schema/owner

Schema `schemas/pronunciation-profile.schema.json`; owner `lib/pronunciation/index.js`. Entries: `entryId (pe-), normalizedTerm, displayTerm, language, locale, category, reading{notation, value}, acronymMode, scope, source, quality, provenance`. Reading notation explicitly `IPA | PROVIDER_NATIVE | READ_AS`. Storage `voice/pronunciation-profile/pron-<id>.json`, immutable versions, semantic revision dedupe (provenance excluded from semantic identity).

## 8. Candidate detection

`detectCandidates`: all-caps acronyms, mid-sentence capitalized tokens (sentence-initial excluded, connector stoplist), mixed-case technical terms, plus explicit profile entries. False-positive rate measured on the validation set via `candidateStats` (G7).

## 9. Pronunciation categories

All six supported and proven (T12): NAME, FOREIGN_TERM, ACRONYM, PLACE_NAME, DOMAIN_TERM, CUSTOM.

## 10. Override scope/precedence

`SEGMENT > SCRIPT > PROJECT > GLOBAL_LANGUAGE` (deterministic, T22). Two equally specific conflicting active readings → `PRONUNCIATION_ENTRY_CONFLICT`, fail-closed, no silent winner (T14, G14). Identical readings at equal specificity dedupe.

## 11. Kokoro real runtime verification

`providers/runtime/kokoro-phonemize.js` runs the REAL installed Kokoro via `KPipeline(lang_code='a', model=False)` — graphemes + phonemes, **no acoustic model, no audio**. Verified live: en-us → `a` mapping; batch runner (one python process per pass, stdout-pure JSON); no silent fallback (`PRONUNCIATION_RUNTIME_UNAVAILABLE` / `_FAILED` / `_LANGUAGE_UNSUPPORTED` structured); narrator/language never substituted.

## 12. Provider compilation

Canonical entry → Kokoro input, derived and traceable per occurrence: READ_AS substitution; ACRONYM `LETTER_BY_LETTER` → dotted letters (`C.I.A.`, empirically context-stable), `WORD` → unchanged, `CUSTOM` → READ_AS or native markup. **IPA/PROVIDER_NATIVE entries compile to the OFFICIAL upstream phoneme markup `[term](/phonemes/)` (hexgrad/kokoro README syntax) — proven live on the installed kokoro 0.9.4: standalone `[Kokoro](/kˈOkəɹO/)` phonemizes to exactly `kˈOkəɹO` and the same phonemes appear verbatim in sentence context.** (The initial release of this report claimed no injection path — that verdict came from testing non-official syntaxes; FIX_PHASE_2_2_2_3_01 §1 reproduced the exact official syntax and fixed the compiler. No READ_AS downgrade remains.) Override consumption is proven by phoneme-inclusion of the compiled replacement's standalone phonemization inside the compiled segment phonemes.

## 13. Localized invalidation proof

`planInvalidation(passId, changedEntryId)` → machine-readable plan `{invalidationPlanId, affectedSegmentIds, unaffectedSegmentIds, futureDownstreamTarget: "VOICE"}` from the last pass's consumer map. Proven: one-term fix affects only its consumer segment (T23/G16); multi-consumer term affects exactly S3+S7 (T24/G17); no TTS/audio nodes fabricated.

## 14. Manifest/DAG/history integration

- Manifest **1.5.0** (`schemas/project-manifest-1.5.0.schema.json`, explicit migration `migrateSchema1_4_0_to_1_5_0`): new index slots `narrationDirectionVersion`, `pronunciationProfileVersion`, `pronunciationRuntimePassVersion`, `ttsReadyPlanVersion` — refs/status only, no bodies (T25). Old versions stay loadable (1.0.0–1.4.0 supported).
- DAG: new types `NARRATION_DIRECTION, PRONUNCIATION_PROFILE, PRONUNCIATION_RUNTIME_PASS, TTS_READY_PLAN`; real edges only: `FINAL_SPOKEN_SCRIPT→NARRATION_DIRECTION←VOICE_BIBLE`, `FINAL_SPOKEN_SCRIPT+PRONUNCIATION_PROFILE→PRONUNCIATION_RUNTIME_PASS`, `NARRATION_DIRECTION+PRONUNCIATION_RUNTIME_PASS→TTS_READY_PLAN`. markDirty propagation scoped to dependents; no FINAL_AUDIO/FORCED_ALIGNMENT/CAPTIONS nodes fabricated (T26).

## 15. Artifact governance/lifecycle

All artifacts resolve through the Workspace Resolver (registry entry `phase223-narration-pronunciation`, kind VALIDATION; idempotent setup via `scripts/cli/phase223-setup.js`). Lifecycles: schemas/canonical artifacts DURABLE, golden GOLDEN/DURABLE (baseline in `golden/baselines.json`), runtime diagnostic evidence RETENTION_MANAGED (`evidence/phase-2/2.2-2.3/`), G2P scratch EPHEMERAL. Stable ids + content fingerprints everywhere (T27/T28/T29).

## 16. Security/privacy

No secrets/tokens/cookies persisted (T30 via canonical `findSecretKeys`); project/script-scoped entries stay scoped; no external upload — phonemization is local python only. Canonical manifest + artifacts re-verified secret-clean by full regression.

## 17. Observability

New typed telemetry classes: `NARRATION_DIRECTION_CREATED/VALIDATED/REVISED`, `PRONUNCIATION_PROFILE_RESOLVED`, `PRONUNCIATION_RUNTIME_VALIDATED`, `PRONUNCIATION_REVIEW_REQUIRED`, `PRONUNCIATION_OVERRIDE_REVISED`, `PRONUNCIATION_INVALIDATION_PLANNED` (+ durable subset). Correlation chain project → script → ND → pass → segment proven on the canonical workspace (T31).

## 18. Performance baseline

`projects/phase223-narration-pronunciation/evidence/phase-2/2.2-2.3/performance/performance-baseline.json`: cold real-runtime batch (6 segments + expectations) ≈ 8.9 s incl. python cold start; warm second pass faster (R9 run); compile/resolve/invalidation latencies sub-millisecond warm; counts: 6 segments, 7 override entries, 6 phoneme outputs. No TTS synthesis benchmarked.

## 19. Golden regression

`gold-narration-pronunciation` definition + baseline v1 (metrics: schemaStability, versionImmutability, dagInvalidation, directionSparsity, pronunciationRuntime = MEASURED; pronunciation/speechRate honestly NOT_MEASURED until 2.4) — `compareToBaseline` → **PASS**. G1–G18 matrix: 19/19 tests pass (`tests/golden/test-narration-pronunciation-golden.js`).

## 20. T1–T36 — ALL PASS

| Range | Suite | Result |
|---|---|---|
| T1–T10, G1–G6, over-direction | `node tests/narration/test-narration-direction.js` | 17 passed, 0 failed |
| T11–T14, T20–T22, T30, G7–G14, FIX-1 compile | `node tests/pronunciation/test-pronunciation-profile.js` | 15 passed, 0 failed |
| T15–T19, R1–R12, FIX-1 native runtime | `node tests/pronunciation/test-pronunciation-runtime.js` | 13 passed, 0 failed |
| T23, T24, G16, G17, DAG scoping | `node tests/pronunciation/test-pronunciation-invalidation.js` | 4 passed, 0 failed |
| T25–T29, T31, T32, T36 | `node tests/narration/test-narration-integration.js` | 8 passed, 0 failed |
| T33 golden | `node tests/golden/test-narration-pronunciation-golden.js` | 19 passed, 0 failed |
| T34 R1–R12 + T35 E2E | runtime suite + `node tests/narration/test-e2e-phase223.js` | 13 + 8 passed, 0 failed |

## 21. R1–R12 — ALL PASS (real runtime, never mocked)

R1 runtime resolves ✓ · R2 en-us→`a` ✓ · R3 quiet graphemes+phonemes, audio=None ✓ · R4 unknown language/runtime structured fail-closed ✓ · R5 normal segment phonemizes ✓ · R6 OOD terms explicit runtime results ✓ · R7 override compiles ✓ · R8 override proven consumed at runtime ✓ · R9 output changes with override change, unrelated segments identical ✓ · R10 source bytes byte-identical ✓ · R11 zero audio files ✓ · R12 zero credits/COST events ✓.

## 22. Combined E2E — PASS

`test-e2e-phase223.js` (8/8): canonical fixture → segment resolution → ND (Voice Bible v3 authoritative, `am_michael` via ref) → profile resolution (Kokoro entry = official native IPA `kˈOkəɹO`, VERIFIED_SOURCE = hexgrad README) → compilation → REAL Kokoro quiet phonemization → runtime evidence → TTS-ready plan `overall = READY_FOR_TTS` with **`productionTtsBlocked = true`**. Proof: script bytes unchanged, direction sparse (2/6), overrides scoped, real G2P hashes present, zero audio, zero Phase 2.4+ artifacts.

## 22b. Canonical Final Spoken Script audit + production-TTS block (FIX_PHASE_2_2_2_3_01 §2)

Roadmap chain `Spoken Humanizer → Evidence Fidelity → Naturalness QA → Final Spoken Script` — audit result:

- **No Spoken Humanizer exists** in the repository (1G stage reports explicitly record "no humanizer" was built: e.g. `PHASE_1G1_06_FULL_E2E_VALIDATION_REPORT.md`, `PHASE_1G7_01_PLATFORM_POLICY_REPORT.md`).
- The only real Stage-4 script artifact is `projects/pilot-sky-blue/script.json` (8 beats, story script, `scriptVersion 1.0.0`) — it predates and never passed a humanization chain. Materializing it as a canonical FINAL_SPOKEN_SCRIPT would misrepresent un-humanized story text as spoken-final and bypass three roadmap stages.
- **Decision: explicit production-TTS block (machine-readable), no materialization.** `buildTtsReadyPlan` copies the source script's `productionScriptStatus` into the plan (`provenance.productionScriptStatus`) and sets `productionTtsBlocked = true` for anything ≠ `CANONICAL` (schema-enforced, required field). The manifest indexes the plan as `UNRESOLVED` with detail `PRODUCTION_TTS_BLOCKED(non-canonical script)`. `Phase223` fixture script carries `productionScriptStatus = NOT_APPLICABLE`. A canonical FSS produced by the future humanizer chain (new `scriptVersion`) unblocks production TTS automatically.

## 23. Targeted regression — PASS

Covered inside full `npm test`: voice-bible (3 suites, 425 asserts), project-manifest, dag, history, recovery, telemetry, golden, provenance, compliance, workspace, artifact-resolver/lifecycle (workspace), providers, storage — 0 failed. Extension untouched → Extension change = NONE (§31).

## 24. Full regression — PASS

```text
npm test                     → 27 domains, 0 failed suite(s) in 544.1s (post-FIX run)
npm run check:workspace      → {"ok":true,"violations":[],"warnings":[],"projects":20}
npm run check:repo-structure → REPOSITORY_STRUCTURE_OK
node scripts/checks/validate-schemas.js → RESULT: ALL TESTS PASSED
```

## 25. P0/P1

**P0 = 0, P1 = 0.** No stop condition fired (§39).

## 26. Phase 2.2 gate — PASS

Q2_2_01…Q2_2_12 all satisfied (identity explicit; versioned machine-readable ND; segment-scoped; six semantics; Voice Bible authoritative; no text mutation; sparse/default works; over-direction measured not rewarded; fail-closed invalid; staleness dirties correct artifact; Manifest/DAG/history consistent; Golden PASS).

## 27. Phase 2.3 gate — PASS

Q2_3_01…Q2_3_16 all satisfied (six categories; real configured runtime executed; executable pass not a passive dictionary; provider-agnostic canonical state; Kokoro compile/runtime path proven; ambiguity → REVIEW_REQUIRED not fabrication; localized invalidation proven; unrelated segments unaffected; bytes unchanged; no audio; Golden + runtime regression PASS).

## 28. Combined package gate — PASS

C1–C14 all true (gates above; T1–T36 ✓; R1–R12 ✓; E2E ✓; TTS-ready plan produced; vb-19f4fd6a4596 remains LOCKED/production-ready; no rights trigger; resolver PASS; targeted+full regression PASS; P0=P1=0; no premature 2.4+ behavior).

## 29. Final verdict

```text
TASK_VALIDATION = PASS
PHASE_2_2_QUALITY_GATE = PASS      PHASE_2_2 = COMPLETE
PHASE_2_3_QUALITY_GATE = PASS      PHASE_2_3 = COMPLETE
PHASE_2_2_2_3 = COMPLETE
FIX_PHASE_2_2_2_3_01 = COMPLETE (official native phonetic override + production-TTS block)
NEXT = PHASE 2.4 + 2.5 + 2.6
```

---

## ADDENDUM — FIX_PHASE_2_2_2_3_01 (2026-10-06, bounded fix; Phase 2.4 NOT started)

### Fix 1 — native phonetic override: compiler was wrong, not the runtime

- Operator challenge accepted: the official hexgrad/kokoro README syntax `[Kokoro](/kˈOkəɹO/)` was reproduced **verbatim** on the installed kokoro 0.9.4 via `KPipeline(lang_code='a', model=False)`:
  - standalone `[Kokoro](/kˈOkəɹO/)` → phonemes exactly `kˈOkəɹO`;
  - in-sentence `[toast](/toʊst/) was ready.` → `toʊst wʌz ɹˈɛdi.` (specified phonemes verbatim, rest G2P normal).
- Root cause of the original "not supported" verdict: **incorrect test syntax** — the investigation tested `[x]`, `{x}`, `/x/` instead of the official markdown-link markup `[x](/phon/)`. Not an escaping, preprocessing, markdown-stripping, wrapper/CLI or runtime limitation.
- Compiler fix (`providers/runtime/kokoro-phonemize.js`): notation `IPA`/`PROVIDER_NATIVE` → `[term](/phonemes/)` official markup (nativeMarkup); `CUSTOM` acronyms accept it too. Expectation/consumption proof unchanged (standalone phonemization of the compiled replacement must appear in the segment phonemes). Honest quality rules unchanged: IPA from RUNTIME_G2P is still forbidden; VERIFIED IPA requires OPERATOR_OVERRIDE or VERIFIED_SOURCE.
- Canonical profile revised to v2: `Kokoro` reading `IPA kˈOkəɹO`, source `VERIFIED_SOURCE`, origin "hexgrad/kokoro official README example"; new runtime pass + plan; manifest + DAG versionRefs advanced.
- Regression: `test-pronunciation-profile.js` +1 test (15 total), `test-pronunciation-runtime.js` +1 real-runtime test (13 total) proving the official markup end-to-end; no READ_AS downgrade of native support remains.

### Fix 2 — canonical Final Spoken Script audit → explicit production-TTS block

See §22b. Summary: no humanizer chain exists (1G reports are the evidence); the only Stage-4 candidate (`projects/pilot-sky-blue/script.json`) never passed humanization; materializing it would fabricate the chain. Instead, production TTS is now **machine-readably blocked** for non-canonical scripts: `tts-ready-plan.schema.json` gains required `productionTtsBlocked` + `provenance.productionScriptStatus`; `lib/tts-ready-plan.js` enforces the block; manifest records `UNRESOLVED` + `PRODUCTION_TTS_BLOCKED(non-canonical script)`. A real canonical FSS (new scriptVersion from the future humanizer chain) unblocks automatically. **No production TTS was generated or authorized.**

### Post-FIX regression (exact commands + results)

```text
node tests/pronunciation/test-pronunciation-profile.js    → 15 passed, 0 failed
node tests/pronunciation/test-pronunciation-runtime.js    → 13 passed, 0 failed (REAL runtime)
node tests/narration/test-e2e-phase223.js                 → 8 passed, 0 failed
node tests/narration/test-narration-integration.js        → 8 passed, 0 failed
node tests/golden/test-narration-pronunciation-golden.js  → 19 passed, 0 failed
node tests/narration/test-narration-direction.js          → 17 passed, 0 failed
node tests/pronunciation/test-pronunciation-invalidation.js → 4 passed, 0 failed
npm test                                                  → 27 domains, 0 failed suite(s) in 544.1s
npm run check:workspace / check:repo-structure / validate-schemas → all PASS
```

P0 = 0, P1 = 0. Gates §36/§37/§38 remain PASS with the FIX applied.

**Files added:** `schemas/{final-spoken-script,narration-direction,pronunciation-profile,pronunciation-runtime-pass,tts-ready-plan,project-manifest-1.5.0}.schema.json`; `lib/narration/index.js`; `lib/pronunciation/index.js`; `lib/tts-ready-plan.js`; `providers/runtime/kokoro-phonemize.js`; `scripts/cli/phase223-setup.js`; `tests/narration/{test-narration-direction,test-narration-integration,test-e2e-phase223}.js`; `tests/pronunciation/{test-pronunciation-profile,test-pronunciation-runtime,test-pronunciation-invalidation}.js`; `tests/golden/test-narration-pronunciation-golden.js`; `tests/fixtures/phase223/helpers.js`; `projects/phase223-narration-pronunciation/**` (validation workspace + evidence).
**Files edited:** `lib/project-manifest/{index.js}` (1.5.0 + 4 slots + migration); `lib/dependency-dag/index.js` (+4 types); `lib/telemetry/index.js` (+8 classes); `lib/golden/metrics.js` (+2 metrics); `schemas/recovery-state.schema.json` (dagDoc enum +4, additive); `scripts/checks/validate-schemas.js` (+6 schemas + cases); `projects/registry.json` (+1 project); `Report/INDEX.md` (pointer).
