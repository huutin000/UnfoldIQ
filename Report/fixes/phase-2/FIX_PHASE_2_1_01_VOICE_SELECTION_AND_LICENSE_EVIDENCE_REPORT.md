# FIX PHASE 2.1 — 01
# VOICE SELECTION + KOKORO LICENSE EVIDENCE

```text
PHASE_2_1_PRODUCTION_READINESS = NOT_COMPLETE
NEXT = FIX_PHASE_2_1_02
```

**Project:** UNFOLDIQ · **Phase:** 2.1 FIX 01 · **Window:** 2026-10-05
**Outcome:** narrator voice is now operator-approved and persisted as an immutable Voice Bible v2. Kokoro licensing is canonical and the runtime is pinned. Production readiness stays blocked on **rights only** — a deliberate operator policy choice, recorded as such.

> A previous run of this FIX reported `NOT_COMPLETE` because no Kokoro runtime existed. That blocker is gone. The remaining blocker is a decision, not an environment problem.

---

## 1. License evidence

Canonical, schema-validated, traceable — not prose.

```text
providers/license-evidence/local-kokoro.json
  evidenceId    = lice-a1a589eb2773
  fingerprint   = 836ecfcbda3fdc2d
  schema        = schemas/voice-license-evidence.schema.json (draft-07, additionalProperties:false)
```

| Field | Value | Source |
|---|---|---|
| provider / model | `local-kokoro` / `kokoro-v1` | repo runtime label |
| upstream artifact | Kokoro-82M, release v1.0, 2025-01-27, 8 langs × 54 voices | official model card |
| official source | `https://huggingface.co/hexgrad/Kokoro-82M` | hexgrad |
| license file | `https://github.com/hexgrad/kokoro/blob/main/LICENSE` (full Apache-2.0 text) | hexgrad |
| model SHA256 | `496dba118d1a58f5f3db2efc88dbdc216e0483fc89fe6e47ee1f2c53f18ad1e4` | official model card |
| retrievedAt | 2026-10-05 | — |

**Both official sources were re-fetched live this run and every recorded field verified** — the `apache-2.0` tag, the SHA256, the release row, the voice/language counts, the training-data attribution (Koniwa CC BY 3.0, SIWIS CC BY 4.0) and both quoted statements.

### Runtime now pinned (was `upstreamReleasePinned: false`)

```text
runtime                 kokoro 0.9.4 / torch 2.14.1+cpu
repo bound by runtime   hexgrad/Kokoro-82M   (read from KPipeline.repo_id, not hardcoded)
artifact actually loaded kokoro-v1_0.pth
local SHA256            496dba118d1a58f5f3db2efc88dbdc216e0483fc89fe6e47ee1f2c53f18ad1e4
official SHA256         496dba118d1a58f5f3db2efc88dbdc216e0483fc89fe6e47ee1f2c53f18ad1e4   ← byte-identical
```

The pin rests on the artifact hash matching the official publication, **not** on the repo-internal label `kokoro-v1` (which is not an upstream version string). The evidence says so explicitly.

### Three separate rights states (§7 — never collapsed)

| State | Status | Basis |
|---|---|---|
| `MODEL_LICENSE` | **VERIFIED** — Apache-2.0 | Official card declares `License: apache-2.0`; official GitHub carries the full licence text |
| `VOICE_ASSET_RIGHTS` | **REVIEW_REQUIRED** | *Operator policy — see below* |
| `OUTPUT_USAGE_STATUS` | **REVIEW_REQUIRED** | No separate output-usage grant is published; the model-level grant is not read as a silent output licence |

### Correction to the previous run's rights basis

The prior evidence claimed voice rights were `REVIEW_REQUIRED` because *"the runtime package is not installed … and no official statement specific to voice-asset redistribution was located."* **That second clause was false and has been corrected.** `voices/` is a subdirectory of the same Hugging Face repository that carries the repository-level `License: apache-2.0` tag, and Apache-2.0 §4 grants reproduction and distribution of the Work. Byte-level evidence now also exists: the runtime-loaded `am_michael.pt` hashes to `9a443b79a4b22489a5b0ab7c651a0bcd1a30bef675c28333f06971abbd47bd37`, matching the per-voice SHA256 published in official `VOICES.md`.

**The status nonetheless stays `REVIEW_REQUIRED`, by explicit operator decision** (2026-10-05). The reasoning recorded in the file is now honest: repository-level licensing plus matching hashes is strong evidence, but it is an agent-side reading of licence *scope*, not an official statement that voice assets are separately cleared for redistribution and commercial narration output. Nobody later can mistake silence for permission.

`VOICE_LICENSE_EVIDENCE_FABRICATED` remains the guard: a `VERIFIED` claim without an official https source, without a verbatim quote, or without evidenceRefs is refused — and a document where all three claims are identically `VERIFIED` is refused outright.

## 2. Three real defects found and fixed

These were live bugs, not test failures. Each would have silently broken production narration.

**1. The Kokoro adapter could never synthesize.** `providers/runtime/adapters/local-kokoro.js:107` invoked `python -m kokoro` with **no `-o/--output-file`** (required in 0.9.4 — it writes a WAV file, never WAV bytes on stdout) and passed **`--lang en-us`** while the CLI accepts only `choices=["a","b","h","e","f","i","p","j","z"]`. Argparse exited 2, which the adapter read as `KOKORO_NOT_AVAILABLE`. Every TTS call in the repo was failing. Fixed with a `LANGUAGE_CODES` map mirroring the existing `LANGUAGE_NAMES` 1:1, a temp-file write, and a configurable timeout (the first call downloads the model). One fix, all callers.

**2. Voice discovery could never succeed.** `lib/voice-bible/license.js` globbed `*.pt` inside the package directory. **Kokoro ships no `.pt` files at all** — `KPipeline.load_single_voice()` resolves any voice at synthesis time via `hf_hub_download(repo_id, "voices/<id>.pt")`. The glob therefore returned `[]` even with Kokoro installed. Rewritten to read the repo the runtime itself binds to, plus per-voice load verification so a voice is only called available if the runtime actually loaded it.

**3. The voice catalogue rejected every approved narrator.** `providerCatalog()` derived `voicesByLanguage` solely from the adapter's `DEFAULT_VOICES` — one voice per language (`af_heart` for en-us). With 54 real voices, any operator-approved narrator outside that single default failed as `VOICE_NOT_FOUND`. The catalogue now unions the discovered runtime inventory, persisted as `runtimeVoiceInventory` in the evidence document so validation is stable in a fresh process with no python probe and no `KOKORO_VOICES` env override. Fabricated ids are still refused.

> A fourth defect was mine: I first bucketed discovered voices by `v.slice(0,2)[1]`, which reads the **gender** letter (`f`/`m`), not the language letter, and filed all 20 American voices under French. Kokoro's convention is `v[0]` = language, `v[1]` = gender. Caught and corrected; the persisted per-language counts (20/8/3/1/4/2/5/3/8 = 54) now match official `VOICES.md` exactly.

## 3. Candidate narrator voices

**Discovered from the configured runtime only** — 54 voices from `hexgrad/Kokoro-82M`, the repo `KPipeline` itself binds to. The adapter's `DEFAULT_VOICES` table is a per-language resolution default, not an inventory, and is never reported as discovery.

**Operator constraint applied:** the UNFOLDIQ mascot is male, so narrator identity must remain male unless narrator and mascot are explicitly decoupled. This withdrew `af_heart` — which has the best official data grade of any en-us voice — despite that. No gender field was added to the schema: it sets `additionalProperties:false`, and the Kokoro voiceId prefix (`am_`/`af_`) already encodes gender deterministically, so a parallel field would be redundant state that could disagree with the voiceId. The constraint is recorded as a decision input with its escape hatch.

### Official grade correction (operator-caught)

An earlier pass read the **HTML-rendered** model page, whose table columns silently misaligned. The raw `resolve/main/VOICES.md` is authoritative and corrected four wrong grades:

| voice | recorded earlier | **official (B / H hours / grade)** |
|---|---|---|
| am_fenrir | C+ | C+ ✓ |
| am_michael | C / MM minutes / C | **B / H hours / C+** |
| am_puck | C / MM minutes / D | **B / H hours / C+** |
| am_onyx | B / MM minutes / C | **C / MM minutes / D** |

The rationale that ranked `am_fenrir` "best-supported on data" was unfounded and was withdrawn. **All three shortlisted voices are equal on official evidence.**

## 4. Preview pack

```text
lifecycleClass = RETENTION_MANAGED      (selection scratch, not evidence, not production narration)
shared         = one script / speed=1.0 / en-us / kokoro-v1 / WAV 24kHz 16-bit / no music / no SFX / 0 paid credits
```

Short preview: `assets/voice/voice-preview/preview-<voice>.wav`
Long-form QA: `assets/voice/voice-qa-{A,B}/qa{A,B}-<voice>.wav`

Every clip was verified as **real audio** by measured RMS (1400–2645, peak 10469–28043, zero clipped samples), so none fell through the adapter's silent-audio fallback.

## 5. Objective QA comparison (10 dimensions)

`scripts/diagnostics/narrator-qa-compare.js` → `evidence/provider/narrator-qa-comparison.json`

Two ~150-word explanatory scripts × three voices, one render batch, identical settings. ASR = faster-whisper `small` (int8, CPU, beam 5). Rate measured over **active speech**, excluding head/tail silence.

| # | Dimension | am_michael | am_puck | am_fenrir |
|---|---|---|---|---|
| 1 | WER (A / B) | 0.68% / 0% | **0% / 0%** | 0.68% / 0% |
| 2 | missing/substituted/repeated/hallucinated | 0/0/0, rep 0 | **0/0/0, rep 0** | 0/0/0, rep 0 |
| 3 | words per minute | **157.1 / 146.6** | 214.7 / 173.1 | 205.9 / 167.8 |
| 4 | longest pause | 1.02s / 1.10s | 1.00s / 1.22s | **0.80s** / 1.02s |
| 5 | alignment anomalies | **0** | 1 longGap ×2 | **0** |
| 6 | F0 range / long-term energy CV | 79.8–85.5 Hz / 0.23–0.26 | 62.5–126 Hz / 0.26–0.33 | 91.3–132.7 Hz / 0.22–0.23 |
| 7 | cross-clip rate drift | **10.5 wpm** | 41.6 wpm | 38.1 wpm |
| 8 | headroom / SNR / clipping | **4.48–4.58 dB** / 58 dB / 0 | 3.49–1.52 dB / 44 dB / 0 | 2.25–1.52 dB / 63 dB / 0 |
| 9 | long-form fatigue risk | **0 — LOW, no flags** | 15 — LOW (fast) | 15 — LOW (fast) |
| 10 | **total /100** | **88.3** | 87.7 | 81.5 |

**Ranking: 1 `am_michael` (88.3) · 2 `am_puck` (87.7) · 3 `am_fenrir` (81.5).**

The #1/#2 gap is 0.6 points and should be read as a tie. The genuinely robust, rubric-independent findings are: rate (152 vs 194 vs 187 wpm), cross-clip rate stability (10.5 vs ~40 wpm drift), and headroom (4.5 vs ~1.5 dB). All three favour `am_michael`.

### Disclosed limitations

- **The first WER run was contaminated by my own test material.** Script A used British spellings (`behaviour`, `catalogue`) in an `en-us` test, so the ASR's spelling normalisation was scored as a pronunciation error. The script was corrected to American spellings and the whole comparison **re-rendered and re-run from scratch** — not corrected arithmetically after the fact. Correcting the reference instead had flipped the ranking, which is precisely why the test material was fixed rather than patched.
- **`pauseCount` is not a usable metric.** Frame-level VAD at 20 ms counts inter-word gaps, reporting 90–119 "pauses" in ~60 s. Only `pauseMax` is meaningful. This is a tool limitation, disclosed rather than presented as a finding.
- The residual `weighting → waiting` error appears identically in two of three voices, which points to an ASR/model artifact rather than a voice defect.
- Single speaker, two scripts, one render each; no significance testing. The 135–165 wpm band is a rubric choice, not a law — but the 152-vs-194-wpm gap is measured fact.

## 6. Operator approval

Recorded verbatim through `approveNarratorVoice()`, which has **no** default and **no** scoring path. It refuses without an explicit voiceId, the presented shortlist, a runtime inventory check and a preview reference.

```text
APPROVED_NARRATOR_VOICE = am_michael
```

The operator reviewed and **declined twice** before approving — first to apply the male-mascot constraint, then to demand the objective 10-dimension comparison because their English listening proficiency is limited. Both refusals are recorded. The tool approved nothing at any point.

## 7. Persisted canonical selection

```text
Voice Bible v2  vb-2997edea5ffa
  narrator.voiceId            am_michael
  provenance.source           OPERATOR_APPROVED
  provenance.rights.status    REVIEW_REQUIRED
  provenance.rights.licenseType LICENSED
  provenance.approvalRef      evidence/provider/operator-approval.json
  provenance.evidenceRefs     4 refs
  productionReady             false   ← VOICE_RIGHTS_REVIEW_REQUIRED
Voice Bible v1  vb-42744f223671   af_heart / PROVIDER_DEFAULT / UNRESOLVED — byte-unchanged, still loadable
```

| Artefact | State |
|---|---|
| Manifest `voiceBibleVersion` | `vb-2997edea5ffa`, status `UNRESOLVED`, `projectVersion` 2→3 |
| DAG `VOICE_BIBLE` | `versionRef=vb-2997edea5ffa`, `CLEAN`, `lockTarget` updated |
| DAG `VOICE` | `NOT_CREATED_YET`, depends on `VOICE_BIBLE (VOICE_IDENTITY)` — no invented 2.2+ nodes |
| History | `dec-c1c82ea385e1` = `APPROVED`, target auto-`LOCKED` |
| Golden baseline | re-measured against v2; the one regression documented below |

The approved voice is now **protected**: an attempt to silently swap it returns `VOICE_BIBLE_LOCKED`, and the DAG lock reader reports `LOCKED`.

### Documented performance regression

`voiceSelectionResolveLatencyMs` went **0.0097 ms → 0.4182 ms** (~43×) because `providerCatalog()` now reads the evidence file on every resolve. It remains sub-millisecond and is called ~2× per validation, so a memoisation cache was rejected — it would trade a stale-read failure mode for 0.4 ms. Recorded in the baseline with a `revisitIf` trigger rather than hidden.

## 8. F1–F16

| # | Check | Result |
|---|---|---|
| F1 | official license evidence resolves | PASS |
| F2 | source metadata persisted | PASS |
| F3 | unsupported/fabricated evidence rejected | PASS |
| F4 | candidate voices come from configured runtime | PASS — **real branch now**: 54 voices discovered and asserted, up from the absent-runtime path |
| F5 | previews use same script/settings | PASS |
| F6 | operator approval required | PASS |
| F7 | no auto-selection | PASS |
| F8 | approved voice persists in new version | PASS |
| F9 | manifest points to approved version | PASS |
| F10 | productionReady only after approval **and** evidence | PASS — neither alone suffices |
| F11 | old unresolved version immutable | PASS |
| F12 | DAG/history/provenance valid | PASS |
| F13 | secret scan | PASS |
| F14 | fresh-process restore | PASS |
| F15 | targeted regression | PASS — voice-bible 141 + 187 |
| F16 | full regression | PASS — `npm test` 25 domains, 0 failed suites, 358.6s |

Also: `npm run check:repo-structure` → `REPOSITORY_STRUCTURE_OK`; `validate-schemas` → ALL TESTS PASSED; secret scan 0 findings across 7 artefacts and 11 files.

F4's improvement from 89 → 141 assertions is the honest coverage upgrade: with a runtime present, discovery is asserted against the real 54-voice inventory instead of the not-installed branch.

## 9. Q1–Q11

| # | Requirement | Status | Evidence |
|---|---|---|---|
| Q1 | narrator voice explicitly operator-approved | **PASS** | `APPROVED_NARRATOR_VOICE = am_michael`; `OPERATOR_APPROVED`; `dec-c1c82ea385e1` |
| Q2 | approved voice exists in configured runtime | **PASS** | loaded via `KPipeline.load_voice`; in persisted inventory; fabricated ids still refused |
| Q3 | model licence evidence from official source | **PASS** | `lice-a1a589eb2773`; Apache-2.0; live re-verified; runtime hash matches official |
| Q4 | voice rights honest, non-fabricated | **PASS** | 3 separate claims; false basis corrected; `REVIEW_REQUIRED` attributed to operator policy; FABRICATED guard |
| Q5 | current version `productionReady:true` | **FAIL** | `false` — `VOICE_RIGHTS_REVIEW_REQUIRED`. Correct under the operator's rights decision; the gate was **not** weakened to force a pass |
| Q6 | manifest status no longer `UNRESOLVED` | **FAIL** | `UNRESOLVED` — points at v2 correctly, cannot advance while Q5 fails |
| Q7 | previous version historical/immutable | **PASS** | v1 byte-unchanged, loadable, conflict-guarded |
| Q8 | no secret/privacy regression | **PASS** | 0 findings, 0 pattern hits |
| Q9 | F1–F16 PASS | **PASS** | 141 + 187 + full regression |
| Q10 | open P0 = 0 | **PASS** | none |
| Q11 | open P1 = 0 | **PASS** | none — 3 latent defects found and fixed, not logged |

**9 PASS / 2 FAIL.** Machine-readable gate: `evidence/phase-2/2.1/quality-gate/phase-2-1-fix01-quality-gate.json`.

## 10. Final verdict

```text
PHASE_2_1_PRODUCTION_READINESS = NOT_COMPLETE
NEXT = FIX_PHASE_2_1_02
```

Everything this FIX was scoped to do is done: licence evidence is canonical and pinned, narrator discovery is real, previews are uniform, the operator approved explicitly, and the selection is persisted as an immutable v2 with manifest, DAG, history and golden metadata all consistent.

**The one remaining gap is rights, and it is a decision rather than a defect.** Q5/Q6 require all three rights claims `VERIFIED`; the operator elected to keep `VOICE_ASSET_RIGHTS` and `OUTPUT_USAGE_STATUS` at `REVIEW_REQUIRED`. That state is recorded as policy, not as missing evidence — and the gate was left strict rather than relaxed to manufacture a green result.

**To close 2.1, FIX_PHASE_2_1_02 needs one of:**
1. **Rights evidence** — an official statement explicitly covering voice-asset redistribution and/or synthesized-output use, which would let both claims move to `VERIFIED` honestly; or
2. **An explicit operator risk acceptance** recorded against the two claims, with the repository-level Apache-2.0 basis and the matching byte-level hashes cited, so the conservative status becomes a documented business decision rather than an open question.

**Do not start production narration.** Nothing was narrated, published or uploaded; no external credits were spent. Kokoro and faster-whisper were installed locally under explicit operator authorization (`providers/local/SETUP_KOKORO.md`, `SETUP_WHISPER.md` forbid UNFOLDIQ auto-install), and one upstream packaging defect was worked around by pinning `av==15.0.0` (faster-whisper declares `av>=11` with no upper bound, but 1.2.1 does not work against PyAV 19).

## 11. Files

**Added**
- `schemas/voice-license-evidence.schema.json` — evidence contract (+ `runtimeVoiceInventory`)
- `providers/license-evidence/local-kokoro.json` — canonical evidence
- `lib/voice-bible/license.js` — evidence validation, runtime discovery, preview pack, approval
- `scripts/diagnostics/narrator-qa-compare.js` — 10-dimension objective QA
- `tests/voice-bible/test-fix01-license-voice-selection.js` — F1–F16
- `projects/phase2-1-validation/evidence/phase-2/2.1/evidence/provider/` — selection, preview pack, QA comparison, operator approval
- `projects/phase2-1-validation/evidence/phase-2/2.1/quality-gate/phase-2-1-fix01-quality-gate.json`

**Edited**
- `lib/voice-bible/index.js` — `productionReadinessGate`; catalogue honours the runtime inventory
- `providers/runtime/adapters/local-kokoro.js` — CLI contract fix (`-o`, `LANGUAGE_CODES`, timeout)
- `scripts/checks/validate-schemas.js` — schema + instance cases
- `projects/phase2-1-validation/` — Voice Bible v2, manifest, DAG, history, performance baseline, previews

**Not touched:** the v1 Voice Bible artefact (immutable), Flow Companion, Remotion, and any production render path.