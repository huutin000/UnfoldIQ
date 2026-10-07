# FIX PHASE 2.1 — 02
# RIGHTS DECISION + CANONICAL REPORT SYNC

```text
RIGHTS_DECISION = ACCEPT_RESIDUAL_RIGHTS_RISK
TASK_VALIDATION = PASS
PHASE_2_1_QUALITY_GATE = PASS
PHASE_2_1_PRODUCTION_READINESS = PASS
PHASE_2_1 = COMPLETE
NEXT = FIX POST-1H PHYSICAL REPOSITORY REORGANIZATION V2
```

**Project:** UNFOLDIQ · **Phase:** 2.1 FIX 02 · **Window:** 2026-10-05
**Operator decision:** `ACCEPT_RESIDUAL_RIGHTS_RISK` (explicit, this run — risk acceptance is recorded, never inferred).
**Outcome:** narrator `am_michael` remains operator-approved and locked; Voice Bible v3 `vb-19f4fd6a4596` carries `RISK_ACCEPTED` rights under a bounded, versioned policy. Nothing was relabelled `VERIFIED`.

> Do not start 2.2 + 2.3 before the pending physical repository reorganization completes. No production narration was rendered by this FIX.

---

## 1. Kokoro runtime state

```text
runtime       kokoro 0.9.4 / torch 2.14.1+cpu (re-verified live this run)
repo bound    hexgrad/Kokoro-82M (read from KPipeline.repo_id, not hardcoded)
installed     under explicit operator authorization (SETUP_KOKORO.md forbids auto-install)
```

## 2. faster-whisper state

Local ASR used for QA only (`small`, int8, CPU, beam 5). No change since FIX 01; no synthesis or publishing path touched.

## 3. Real voice inventory

54 voices discovered from the configured runtime (`hexgrad/Kokoro-82M` via the runtime's own resolver), persisted as `runtimeVoiceInventory` in `providers/license-evidence/local-kokoro.json`. Adapter `DEFAULT_VOICES` is a per-language default, never reported as discovery.

## 4. Male shortlist

`am_fenrir`, `am_michael`, `am_puck` — all equal on official evidence (`B / H hours / C+` per raw `VOICES.md`). Female candidates withdrawn by the operator's male-mascot constraint (with decoupling escape hatch). Preserved from FIX 01, not re-decided.

## 5. Objective QA

10-dimension comparison (`narrator-qa-comparison.json`): **1 `am_michael` 88.3 · 2 `am_puck` 87.7 · 3 `am_fenrir` 81.5**. Robust gaps: rate 152 vs ~190 wpm, cross-clip drift 10.5 vs ~40 wpm, headroom 4.5 vs ~1.5 dB — all favour `am_michael`. First WER run invalidated (`INVALIDATED_BY_TEST_REFERENCE_ERROR`, British spellings under `en-us` ASR); this file is the canonical from-scratch rerun, now with an explicit `invalidatedRuns` record.

## 6. am_michael approval

```text
APPROVED_NARRATOR_VOICE = am_michael (operator, 2026-10-05, against heard previews)
```

Unchanged. Silent swap still returns `VOICE_BIBLE_LOCKED` (re-tested D13).

## 7. Voice Bible versions

```text
v1 vb-42744f223671  af_heart / PROVIDER_DEFAULT / UNRESOLVED — byte-unchanged, loadable
v2 vb-2997edea5ffa  am_michael / OPERATOR_APPROVED / REVIEW_REQUIRED — byte-unchanged, loadable
v3 vb-19f4fd6a4596  am_michael / OPERATOR_APPROVED / RISK_ACCEPTED — current
```

v3 is a rights-only revision (same voice, provider, model, language, persona). v1/v2 immutable.

## 8. Model/voice hash evidence (re-verified live this run)

```text
E1 source            https://huggingface.co/hexgrad/Kokoro-82M (hexgrad, repo bound by runtime)
E2 repo license      Apache-2.0 (model-card tag + full text at github.com/hexgrad/kokoro/blob/main/LICENSE)
E3 voices dir        https://huggingface.co/hexgrad/Kokoro-82M/tree/main/voices (+ VOICES.md per-voice hashes)
E4 am_michael        locally measured 9a443b79a4b22489a5b0ab7c651a0bcd1a30bef675c28333f06971abbd47bd37 = official VOICES.md
E5 kokoro-v1_0.pth   locally measured 496dba118d1a58f5f3db2efc88dbdc216e0483fc89fe6e47ee1f2c53f18ad1e4 = official model card
E6 Apache-2.0 text   https://github.com/hexgrad/kokoro/blob/main/LICENSE
E7 usage declaration built-in voice only; voiceId am_michael; no cloning; no impersonation; no biometric enrollment;
                     UNFOLDIQ-supplied English narration; assets not redistributed as a standalone voice product
```

## 9. Runtime bugs fixed (R1–R7, re-verified)

R1 CLI output-file contract (`-o` + temp file) · R2 BCP-47→single-letter map · R3 argparse failures surface as unavailable, never as false READY · R4 discovery from runtime/HF inventory · R5 `am_michael` resolves from persisted inventory · R6 bucketing by language prefix · R7 no fabricated/silent READY audio (silent bytes only internal, never returned READY).

One live defect found and fixed at root cause (P3-5, open since Phase 2.1 Task 01): the adapter substituted a hardcoded silent WAV for corrupt non-RIFF output and still returned `READY`. It now throws `KOKORO_EMPTY_OUTPUT` instead; the sentinel generator is deleted. Pinned by D16. No suite depended on the old branch (KO5 covers zero-byte via the mock path, unaffected).

## 10. Invalidated WER run + canonical rerun

First run contaminated by test material (British spellings), marked `INVALIDATED_BY_TEST_REFERENCE_ERROR` and re-rendered from scratch. Canonical rerun preserved with explicit `invalidatedRuns` record. No arithmetic patching.

## 11. Rights decision (FIX 02 §4–§6)

```text
MODEL_LICENSE       = VERIFIED (Apache-2.0, official card + licence text)
VOICE_ASSET_RIGHTS  = RISK_ACCEPTED (explicit operator decision, not VERIFIED)
OUTPUT_USAGE_STATUS = RISK_ACCEPTED (explicit operator decision, not VERIFIED)
```

Recorded in `providers/license-evidence/local-kokoro.json` → `rightsDecision`:

```text
scope          local-kokoro / kokoro-v1 / am_michael / UNFOLDIQ English narration
               noVoiceCloning=true, noImpersonation=true
residualRisks  4 listed (licence-scope reading, no output grant, timbre rights unaddressed, commercial use under acceptance)
reviewTriggers 10 listed (provider, model/version, voiceId, repo licence, voice hash, use, cloning,
               impersonation, commercial policy, conflicting upstream terms)
```

Any fired trigger fails closed to `productionReady=false` + `REVIEW_REQUIRED`.

## 12. productionReady state

```text
productionReady = true  (MODEL_LICENSE VERIFIED + pair RISK_ACCEPTED + valid in-scope decision + no trigger fired)
```

Policy versioned in `lib/voice-bible/license.js` (`evaluateProductionReadiness`); `VERIFIED` can never be produced from risk acceptance (asserted D6).

## 13. Manifest state

```text
voiceBibleVersion = vb-19f4fd6a4596, status VERIFIED, projectVersion 3→4
DAG VOICE_BIBLE   = versionRef vb-19f4fd6a4596, CLEAN, lockTarget updated; VOICE_BIBLE → VOICE edge intact
History           = dec-4a6c0a6533c2 APPROVED (rights-only), v3 LOCKED; v2 unlock event preserved
Telemetry         = VOICE_BIBLE_REVISED + VOICE_SELECTION_RESOLVED correlated on vb-19f4fd6a4596
Golden            = gold-voice-bible:b1 metric catalog still valid; live v3 satisfies the covered schema
```

## 14. Full regression

```text
node tests/voice-bible/test-rights-decision-phase21.js → 93 passed, 0 failed (D1–D24)
node tests/voice-bible/test-voice-bible.js → 187 passed, 0 failed
node tests/voice-bible/test-fix01-license-voice-selection.js → 145 passed, 0 failed
node scripts/checks/validate-schemas.js → RESULT: ALL TESTS PASSED
npm run check:repo-structure → REPOSITORY_STRUCTURE_OK
npm test → 25 domains, 0 failed suites, 387.5s
```

Secret scan PASS (D19: v3 + evidence + manifest, 0 findings). P0 = 0, P1 = 0.

## 15. Files

**Added**
- `tests/voice-bible/test-rights-decision-phase21.js` — D1–D24 matrix
- This report

**Edited**
- `schemas/voice-license-evidence.schema.json` — `RISK_ACCEPTED` status + `rightsDecision` contract
- `schemas/voice-bible.schema.json` — `RISK_ACCEPTED` rights status
- `lib/voice-bible/license.js` — `REVIEW_TRIGGERS`, `validateRightsDecision`, `isRiskAcceptanceValid`, `evaluateProductionReadiness`
- `lib/voice-bible/index.js` — `readinessOf`/`productionReadinessGate` risk path (fail-closed without proof), probe no-downgrade
- `providers/runtime/adapters/local-kokoro.js` — P3-5 root-cause fix (corrupt wav → `KOKORO_EMPTY_OUTPUT`, sentinel deleted)
- `providers/license-evidence/local-kokoro.json` — pair `RISK_ACCEPTED` + `rightsDecision`
- `projects/phase2-1-validation/` — Voice Bible v3, manifest VERIFIED, DAG, history, perf addendum, QA `invalidatedRuns`
- `Report/INDEX.md` — Phase 2.1 current pointer (this report)
- `Report/PHASE_2_1_01_VOICE_BIBLE_AND_NARRATOR_PERSONA_REPORT.md` — superseded banner only

**Not touched:** v1/v2 artefacts (immutable), Flow Companion, Remotion, any production render/narration path.
