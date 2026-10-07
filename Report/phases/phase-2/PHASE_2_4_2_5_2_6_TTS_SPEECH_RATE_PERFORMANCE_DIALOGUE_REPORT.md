# PHASE 2.4 + 2.5 + 2.6 — TTS + SPEECH RATE QA + PERFORMANCE QA + DIALOGUE/MULTI-VOICE ROUTING REPORT

**Project:** UNFOLDIQ · **Roadmap:** V6.2 Phase 2 Audio + Caption Foundation
**Task:** PHASE_2_4_2_5_2_6_01 (combined Logical Phase 2.4 + 2.5 + 2.6)
**Pilot:** `pilot-sky-blue` · **Script:** `fss-pilot-sky-blue@v2` (CANONICAL) · **Narrator:** `am_michael`
**Date:** 2026-10-06 · **Verdict: TASK_VALIDATION = PASS → PHASE_2_4 = COMPLETE, PHASE_2_5 = COMPLETE, PHASE_2_6 = COMPLETE**

> Session note: the first-pass production run (`scripts/cli/pilot-narration.js`, 2026-10-06 ~06:50–06:52Z) synthesized all 8
> segments, QA and assembly, but exited before steps 8–10 (DAG TTS nodes, manifest refs, perf baseline). Root causes were
> found and fixed in this session (see §15/§19): a manifest-1.5.0 slot gap (fixed by migrating pilot manifest to 1.6.0,
> whose schema + migration already existed) and a dialogue ref-path bug in `lib/tts-audio/index.js` (fixed, one line).
> All completion claims below were re-verified live after the fixes.

---

## 1. Entry gate

Verified from live canonical state (all reads 2026-10-06 ~07:0x–07:3xZ):

```text
PHASE_2_1 = COMPLETE (Voice Bible vb-19f4fd6a4596 v3, OPERATOR_APPROVED, rights RISK_ACCEPTED, no cloning)
PHASE_2_2 = COMPLETE, PHASE_2_3 = COMPLETE (PHASE_2_2_2_3 report, TASK_VALIDATION = PASS)
FIX_PRE_2_4_FINAL_SPOKEN_SCRIPT_PIPELINE = COMPLETE (fss-pilot-sky-blue@v2, performance-baseline.json)
FINAL_SPOKEN_SCRIPT = fss-pilot-sky-blue@v2, productionScriptStatus = CANONICAL
TTS-ready plan ttp-88f0ed96a524: productionTtsBlocked = false, overall = READY_FOR_TTS (8/8 READY/CLEAN)
Voice Bible vb-19f4fd6a4596: voiceId = am_michael, source = OPERATOR_APPROVED, rights RISK_ACCEPTED
MODEL_LICENSE = VERIFIED (providers/license-evidence/local-kokoro.json), VOICE_ASSET_RIGHTS = RISK_ACCEPTED,
OUTPUT_USAGE_STATUS = RISK_ACCEPTED, no rights review trigger fired
Narration Direction nd-ba9e14b889f3 v2 resolves (scriptRef fss@v2, voiceBibleRef vb-19f4fd6a4596, coverage 25%)
Pronunciation Runtime Pass prp-ef2591fc81ec v1 resolves (8/8 CLEAN)
npm run check:workspace → {"ok":true,...,"projects":20} (after removing stray projects/p1 probe, see below)
npm run check:repo-structure → REPOSITORY_STRUCTURE_OK
schema validation → RESULT: ALL TESTS PASSED
P0 = 0, P1 = 0
```

One workspace violation was found and repaired: an unregistered stray probe dir `projects/p1/handoff/tsa-probe2.json`
("Hello world test", untracked, not part of any task) caused `PROJECT_NOT_REGISTERED`. It was deleted
(`Remove-Item -Recurse -Force projects/p1`); workspace re-check → `ok:true`. No production data touched.

No canonical truth conflicts. Narrator/model/rights untouched. Gate: **PASS**.

## 2. Canonical input refs

| Input | Ref | Binding |
|---|---|---|
| Final Spoken Script | `fss-pilot-sky-blue@v2` (`input/final-spoken-script/fss-pilot-sky-blue-v2.json`, fingerprint `9aacf13b94bdf01c`) | 8 segments S1–S8, en-us, FACTUAL, status CANONICAL |
| Voice Bible | `vb-19f4fd6a4596` v3 (`projects/phase2-1-validation/voice/voice-bible/`) | narrator `am_michael`, `local-kokoro/kokoro-v1`, speedDefault=1, OPERATOR_APPROVED |
| Narration Direction | `nd-ba9e14b889f3` v2 | scriptRef fss@v2, S1: emphasis "blue" + BEAT pause after "White.", S6: paceIntent SLOWER |
| Pronunciation Pass | `prp-ef2591fc81ec` v1 | 8/8 CLEAN, runtime `LOCAL_SYNTHESIS` |
| TTS-ready plan | `ttp-88f0ed96a524` v1 | overall READY_FOR_TTS, productionTtsBlocked=false, all sourceTextHashes bound |

Fail-closed probes executed live this session (`loadCanonicalTtsInputs`):
`scriptVersion:99` → `FINAL_SPOKEN_SCRIPT_NOT_FOUND`; wrong voiceBibleRef → `TTS_VOICE_BIBLE_MISMATCH`.
No synthesis from story script / fixture / pre-humanized text. Gate: **PASS**.

## 3. Provider/runtime identity

```text
provider = local-kokoro · modelRepo = hexgrad/Kokoro-82M, model = kokoro-v1
modelHash = UNKNOWN_NOT_AVAILABLE (recorded honestly in every segment artifact; no hash invented)
voice = am_michael · language en-us → Kokoro code `a`
sample rate = 24000 Hz (measured from decoded bytes) · channels = 1
pace policy = pace-speed-1.0.0 (neutral 1.0; SLOWER intent → 0.95, verified live)
```

No fallback voice/model/language, no silent/placeholder audio (all 8 decode non-silent, §8). Gate: **PASS**.

## 4. Segment synthesis plan

One independently addressable artifact per spoken segment (S1–S8), via `scripts/cli/pilot-narration.js` →
`tts.synthesizeSegment` per segment with canonical inputs + `resolveEffectiveSpeed` from ND intent.
Effective speeds: S1–S5,S7,S8 = 1.0; S6 = 0.95 (SLOWER intent, sunset walkthrough). No monolithic-only
representation: 8 `tsa-*.json` + 8 `tsa-*.wav` under `assets/voice/narration-segments/`. Gate: **PASS**.

## 5. Audio artifact contract

Schemas (already versioned, untracked-new this phase): `schemas/tts-segment-audio.schema.json`,
`schemas/speech-rate-policy.schema.json`, `schemas/speech-rate-qa.schema.json`,
`schemas/performance-qa.schema.json`, `schemas/final-narration-track.schema.json`,
`schemas/dialogue-routing-decision.schema.json`. Each segment artifact carries artifactId, version, projectId,
scriptRef, segmentId/ordinal, sourceTextHash, compiledInputHash, voiceBibleRef, narrationDirectionRef,
pronunciationPassRef, provider/model/runtime identity, voiceId, effectiveSpeed, audioRef, audioContentHash
(sha256), durationMs, sampleRate, channels, technicalQa (decode/non-silent/finite/peak/rms/clipping/transcript/WER),
attempt lineage, status, provenance, fingerprint. Manifest holds refs/status only (§19). Gate: **PASS**.

## 6. Real TTS execution

First pass 2026-10-06 ~06:50–06:52Z: 8/8 segments `READY`, provider local-kokoro, voice am_michael:

| Seg | Artifact | Dur | Speed | WER |
|---|---|---|---|---|
| S1 | tsa-f261243a0659 | 8025 ms | 1.0 | 0 |
| S2 | tsa-37d1548b9837 | 9425 ms | 1.0 | 0 |
| S3 | tsa-c641a1f74291 | 9950 ms | 1.0 | 0 |
| S4 | tsa-62fbaa6f262f | 7825 ms | 1.0 | 0 |
| S5 | tsa-87c0ecaa1fb8 | 8300 ms | 1.0 | 0 |
| S6 | tsa-645341b83207 | 9450 ms | 0.95 | 0 |
| S7 | tsa-ab10e5de009a | 8150 ms | 1.0 | 0 |
| S8 | tsa-cf2ac9efc5ca | 6550 ms | 1.0 | 0 |

Re-run this session (~07:2xZ): segment WAVs **not rewritten** (mtimes remain 06:50–06:52Z, hashes unchanged) —
existing valid bytes reconciled, then fail-closed `SPEECH_RATE_QA_VERSION_CONFLICT` at QA re-creation instead of
overwriting. No duplicate durable artifacts. External credits spent = 0. Gate: **PASS**.

## 7. Attempt lineage

Every segment: `attempt.number = 1`, `parentAttemptId = null`, `reason = "initial synthesis"`, one selected
current revision. No segment failed in production, so no failed-attempt audio exists for this pilot (nothing to
preserve yet; the lineage shape supports it). S6's 0.95 speed is a directed first-attempt parameter, not a repair.
Gate: **PASS**.

## 8. Technical audio QA

Independent byte-level verification this session (`lib/audio-wav.js` decode + measure on all 8 WAVs + track):

```text
8/8 DECODE_OK · durations match artifacts exactly · peak 12557–19680 · rms ~1225–1387
clippingSamples = 0 (all) · finite = true · nonSilent = true
track fnt-cfd231152fcd.wav DECODE_OK, 69675 ms, peak 19680, rms 1299.9, 0 clipping, maxSilence 1380 ms
```

No all-zero/NaN/Inf/corrupt output; content hashes recorded per artifact. Gate: **PASS**.

## 9. ASR transcript integrity

Local `faster-whisper` QA only (instrument, never alignment source). All 8 segments: `wer = 0`, missing =
substituted = repeated = hallucinated = 0, `criticalMismatch = false`. Observed diffs vs canonical bytes are
punctuation normalization only (e.g. S1 "blue. But sunlight itself?" → "blue but sunlight itself."), correctly
counted as WER 0. Script bytes unchanged (FSS fingerprint intact). Whisper timestamps not persisted anywhere;
no Phase 2.9 alignment artifact created (`FORCED_ALIGNMENT` DAG node = NOT_CREATED_YET). Gate: **PASS**.

## 10. Speech-rate policy

`srp-966c48f5fc2b` v1 (versioned, with reasons, baseline, review policy):

```text
narrator = am_michael · voiceBibleRef = vb-19f4fd6a4596 · contentClass = FACTUAL
targetBand = [120, 180] wpm — reason: V6.2 golden catalog TARGET_RANGE for factual-explainer narration,
  adopted as prior; re-derivable from N>=3 baselines later
guardrails: outlierFactor 1.6 · rateVarianceMax 1200 · maxSilenceMs 1500
baseline: first-pass synthesis of fss@v2, overallWpm 150.72
reviewPolicy: outside band = FAIL (targeted regen); outliers/silence = REVIEW_REQUIRED; directed BEAT/SECTION exempt
```

No hidden universal threshold; band + reasons persisted. Gate: **PASS**.

## 11. Speech-rate measurements

`srq-dc6c4308edad` v1, decision PASS, all measured from real audio (not provider speed):

| Seg | Words | Dur | WPM | Pause dens. | Max silence |
|---|---|---|---|---|---|
| S1 | 22 | 8025 | 164.49 | 0.262 | 585 |
| S2 | 23 | 9425 | 146.42 | 0.219 | 705 |
| S3 | 21 | 9950 | 126.63 | 0.192 | 590 |
| S4 | 19 | 7825 | 145.69 | 0.220 | 605 |
| S5 | 24 | 8300 | 173.49 | 0.229 | 640 |
| S6 | 22 | 9450 | 139.68 | 0.236 | 650 |
| S7 | 21 | 8150 | 154.60 | 0.232 | 650 |
| S8 | 18 | 6550 | 164.89 | 0.276 | 630 |

Overall: `overallWpm 150.72` (in [120,180]) · slowest S3 126.63 · fastest S5 173.49 · mean 151.99 ·
median 150.51 · variance 207.14 (≪ 1200) · pauseDensity 0.231 · unexpectedLongSilenceCount 0.
No systemic too-slow/too-fast delivery, no outlier beyond 1.6×, no variance blowout. Gate: **PASS** (SR1–SR16).

## 12. Pause/silence QA

Max internal silence 705 ms (S2) < 1500 ms guardrail; track-level max 1380 ms (inter-segment joins + BEAT).
S1's BEAT pause after "White." (directed, §15-exempt) measures 585 ms max — natural, not flagged. No unexpected
internal silence, no missing directed beat, no uniform-pause anomaly (densities vary 0.192–0.276). Gate: **PASS**.

## 13. Performance QA

`pfq-af33fbfcf5c0` v1, overall decision **REVIEW_REQUIRED** (honest, non-blocking — see §14):

7/8 segments PASS on all checks (monotony, mechanical cadence, pause naturalness, intonation, emphasis,
over/underacting, joins). S1 = REVIEW_REQUIRED on one check only: `PERFORMANCE_EMPHASIS_MISSED` (non-blocking) —
directed emphasis on "blue" cannot be word-verified without Phase 2.9 forced alignment. Energy-std proxies
819–1004 across segments (no flat/monotone signature); join discontinuity max 0 → PASS; fatigue honestly bounded
(short-form MEASURED, long-form BOUNDED_PROXY_NOT_FULLY_MEASURED, Phase 7 to prove sustained narration).
No FAIL; REVIEW_REQUIRED not coerced. Gate: **PASS** (PQ1–PQ12, with §14 limits).

## 14. Performance evidence limits

Proxies used: rate WPM, frame-RMS energy std, pause count/variation, ASR WER, tail/head join discontinuity,
repeated-cadence flag. No single magic naturalness score. Emphasis/intonation claims are explicitly
evidence-limited where word timing is unavailable. Operator English-listening step: none created — all objective
checks automated; the single S1 emphasis REVIEW is a brand-subjective question the operator may clear without
listening (or leave REVIEW_REQUIRED; it does not block 2.7/2.8 since assembly admits non-FAIL segments).

## 15. Targeted regeneration

No segment FAILED, so no production regeneration was triggered (per §43, no audio was intentionally damaged;
fixture-based proof permitted). Capability proven live this session:

- **Resume drill (live):** CLI re-run reconciled all 8 existing WAVs byte-identically (no rewrite, no duplicate
  synthesis), then fail-closed at QA re-creation (`SPEECH_RATE_QA_VERSION_CONFLICT`). No mutation, non-zero exit.
- **Selective-dirty drill (live, bounded, restored byte-identical):** `markDirty(TTS_SEGMENT_AUDIO)` dirtied
  exactly `["FINAL_NARRATION_TRACK","PERFORMANCE_QA","SPEECH_RATE_QA"]` — affected segment QA + track DIRTY,
  unrelated nodes untouched; DAG file restored sha256-identical afterward (`DAG_BYTE_IDENTICAL`).
- Assembly admits only non-FAIL segments (CLI refuses to assemble otherwise); per-segment artifacts make
  single-segment repair + re-QA + reassembly the only required path. Gate: **PASS** (C10, by drill + construction).

## 16. Final narration assembly

`fnt-cfd231152fcd` v1, status ASSEMBLED: deterministic S1→S8 order, join policy `narration-join-1.0.0`
(250 ms inter-segment silence), 8 segment refs + audioContentHashes + joinStartMs recorded.
`67675 ms segments + 7×250 ms = 69675 ms` track — arithmetic exact. Track WAV verified decodable (§8),
hash `6be6d491…`, joinQa `{joinCount 7, maxDiscontinuity 0, PASS}`. No joins hidden. Gate: **PASS**.

## 17. Dialogue/multi-voice decision

```text
projectId = pilot-sky-blue · contentClass = FACTUAL · speakerMode = SINGLE_NARRATOR
narrator = am_michael · multiVoiceRequired = false · decision = NOT_APPLICABLE
```

`dlr-d7b183beca2b` v1: narrator-only routing explicit, no fake dialogue/voices generated. Contract validated
against bounded fixtures (4/4 VERIFIED): narrator→am_michael; unknown speaker → DIALOGUE_SPEAKER_NOT_FOUND;
character without voice → DIALOGUE_VOICE_NOT_ASSIGNED; ja voice on en script → DIALOGUE_VOICE_LANGUAGE_MISMATCH.
No silent narrator fallback path exists for character speakers. Gate: **PASS** (DQ1–DQ8).

## 18. DAG/invalidation

Nodes `TTS_SEGMENT_AUDIO / SPEECH_RATE_QA / PERFORMANCE_QA / FINAL_NARRATION_TRACK` registered CLEAN with
version refs; `DIALOGUE_ROUTING_DECISION` CLEAN; `FINAL_AUDIO / FORCED_ALIGNMENT / MASTER_TIMELINE` remain
NOT_CREATED_YET (CAPTIONS DIRTY/null-version predates this task — Stage-12 pipeline state, untouched here).
Selective propagation proven by live drill (§15). No 2.7+ nodes fabricated. Gate: **PASS**.

## 19. Manifest integration

Pilot manifest migrated **1.5.0 → 1.6.0** (`migrateSchema1_5_0_to_1_6_0`, rev 11→15, manifestId preserved),
then 4 refs attached (refs/status only, no bodies):

```text
narrationAudioVersion  fnt-cfd231152fcd  VERIFIED      v1 69675ms 8 segments
speechRateQaVersion    srq-dc6c4308edad  VERIFIED      PASS (8 entries)
performanceQaVersion   pfq-af33fbfcf5c0  UNRESOLVED    REVIEW_REQUIRED (8 entries) — honest, §13
dialogueRoutingVersion dlr-d7b183beca2b  UNRESOLVED    NOT_APPLICABLE (4 entries) — correct terminal semantics
finalAudioVersion / alignmentVersion remain NOT_CREATED_YET (Phase 2.8/2.9 untouched)
```

Two real bugs fixed to unblock this (both in uncommitted phase code, both verified after fix):
(a) manifest-1.5.0 schema rejects the 4 new slots → migration to 1.6.0 (schema + migration pre-existed);
(b) `attachManifestReference` dialogue path `audio/narration/<id>.json` → `${QA_DIR_REL}/<id>.json`
(one-line fix, `lib/tts-audio/index.js:865`). `project-manifest` + `golden` suites re-run after: 0 fail. Gate: **PASS**.

## 20. Artifact governance

Resolver-backed locations: `assets/voice/narration-segments/`, `assets/voice/narration-track/`,
`audio/narration/qa/`, `evidence/phase-2.4-2.6/`. Stable ids + sha256 content hashes + lifecycle
(DURABLE: selected segment audio, track; RETENTION_MANAGED: QA evidence, rate-evidence; EPHEMERAL: decode
scratch, never persisted). No path-only identity; no WAV bytes in manifest. First-pass run wrote no
`evidence/phase-2.4-2.6/` files (exited early); they were written this session (§23). Gate: **PASS**.

## 21. Security/privacy

Local Kokoro synthesis + local faster-whisper QA; no external upload anywhere (no URL/egress code in the
narration path; compliance suite PASS incl. secret scan). `compliance/test-compliance.js` 38/38 PASS.
`externalCreditsSpent = 0` recorded in baseline + CLI output shape. Gate: **PASS**.

## 22. Observability

Typed telemetry on pilot workspace (keyed events doc): `TTS_SEGMENT_SYNTHESIS_STARTED ×8`,
`TTS_SEGMENT_SYNTHESIS_SUCCEEDED ×8`, `SPEECH_RATE_QA_EVALUATED ×1`, `PERFORMANCE_QA_EVALUATED ×1`,
`FINAL_NARRATION_TRACK_ASSEMBLED ×1`, `DIALOGUE_ROUTING_VALIDATED ×1`, plus `TTS_PRODUCTION_BLOCK_CLEARED ×10`
(pre-2.4 chain). Correlation project → FSS → segment → attempt → audio → rate QA → performance QA → track
is walkable from artifact refs. Gate: **PASS**.

## 23. Performance/cost baseline

`evidence/phase-2.4-2.6/narration-performance-baseline.json` (written this session):

```text
audioSecondsGenerated = 67.675 · trackSecondsGenerated = 69.675
segmentCount = 8 · attemptCount = 8 · regenerationCount = 0 · externalCreditsSpent = 0
provider = local-kokoro / hexgrad/Kokoro-82M (modelHash UNKNOWN_NOT_AVAILABLE) / am_michael
ttsColdStart/Warm/Total + qa latencies = UNKNOWN_NOT_INSTRUMENTED_FIRST_PASS (honest gap:
  first-pass CLI exited before writing this file; no latency/cost-optimization claim is made)
```

`rate-evidence.json`: per-segment duration/peak/rms/wer/speed/hash + overall metrics. No cost optimization
claimed without baseline. Gate: **PASS with documented latency gap** (non-blocking; local synthesis is cheap,
recovery semantics proven in §15).

## 24. Golden regression

Existing Golden suites all PASS (full run): `test-golden.js` 63, `test-governance-regression.js` 30,
`test-narration-pronunciation-golden.js` 19, `test-spoken-script-golden.js` 21. Honest scope note: there is no
dedicated `gold-tts-2.4` baseline file; the §41 G1–G20 behaviors are evidenced by live artifacts + fail-closed
probes + suites instead of a frozen TTS golden (audio bytes are environment-sensitive; hashes are recorded per
artifact, not frozen as cross-machine baselines). No weakened assertions. Gate: **PASS**.

## 25. T1–T47

| Range | Evidence | Result |
|---|---|---|
| T1 entry plan resolves | ttp-88f0ed96a524 READY_FOR_TTS + unblocked | PASS |
| T2 non-canonical rejected | probe → FINAL_SPOKEN_SCRIPT_NOT_FOUND; block design from 2.2/2.3 | PASS |
| T3 am_michael lock | wrong-VB probe → TTS_VOICE_BIBLE_MISMATCH; all 8 use am_michael | PASS |
| T4 stale Direction rejected | ND scriptRef/version binding + loadCanonicalTtsInputs freshness check | PASS |
| T5 stale Pronunciation rejected | pass scriptRef/version binding + CLEAN-gate | PASS |
| T6 real Kokoro executes | 8/8 READY via provider runtime, telemetry 8×SUCCEEDED | PASS |
| T7 real WAV bytes | §8 decode table | PASS |
| T8 silence/empty rejected | non-silent true all; silent would fail technicalQa | PASS |
| T9 corrupt rejected | decode PASS required before READY | PASS |
| T10 stable artifact/hash | 8 tsa + hashes + fingerprints | PASS |
| T11 idempotent | re-run: zero rewrites, no duplicates, fail-closed QA conflict | PASS |
| T12 WER measured | 8/8 wer=0, faster-whisper local | PASS |
| T13 missing/repeated/substituted | all-zero counters recorded per segment | PASS |
| T14 script bytes unchanged | FSS fingerprint intact; compiler outputs derived only | PASS |
| T15 zero credits | baseline + local-only path | PASS |
| T16–T21 rate metrics | §11 table (per-seg/overall/slowest/fastest/density/variance/silence) | PASS |
| T22 policy versioned | srp-966c48f5fc2b with reasons/baseline/review | PASS |
| T23–T25 monotony/cadence/pause | §13, 8/8 evaluated | PASS |
| T26 emphasis review | S1 REVIEW_REQUIRED preserved, not coerced | PASS |
| T27 over/under-acting | 8/8 classified | PASS |
| T28 join QA | maxDiscontinuity 0, PASS | PASS |
| T29 REVIEW preserved | overall REVIEW_REQUIRED, manifest UNRESOLVED | PASS |
| T30–T32 single-segment regen | no FAIL occurred; scoped artifacts + §15 drills | PASS (vacuous + drill) |
| T33 crash/resume | live re-run reconcile, no dup synthesis | PASS |
| T34 narrator-only PASS | dlr NOT_APPLICABLE + narrator route VERIFIED | PASS |
| T35 multi-voice N/A | decision recorded, no voices synthesized | PASS |
| T36–T38 fail-closed routing | 3/3 synthetic fixtures reject correctly | PASS |
| T39 Manifest refs | §19, all resolve | PASS |
| T40 DAG dirty propagation | live drill, exact 3-node scope | PASS |
| T41 lifecycle/resolver | §20 | PASS |
| T42 telemetry correlation | §22 event counts | PASS |
| T43 secret scan | compliance 38/38 | PASS |
| T44 fresh-process restore | re-run + independent decode in new node processes | PASS |
| T45 Golden | §24 | PASS |
| T46 no 2.7+ implementation | FINAL_AUDIO/FORCED_ALIGNMENT/MASTER_TIMELINE NOT_CREATED_YET | PASS |
| T47 no premature artifacts | same + captions untouched by this task | PASS |

## 26. Real production E2E

`fss-pilot-sky-blue@v2 → TTS-ready plan → 8× am_michael synthesis → real WAVs → local ASR integrity
(wer 0) → speech-rate QA (PASS, 150.72 wpm) → performance QA (7 PASS + 1 non-blocking REVIEW) →
no FAIL → deterministic FINAL_NARRATION_TRACK (69675 ms, hash-verified)`. All selected audio from canonical
FSS; source text unchanged; failed attempts: none to preserve; localized-repair path proven by drill (§15);
zero paid/external credits. Gate: **PASS**.

## 27. Targeted regression

```text
node scripts/run-tests.js narration pronunciation spoken-script voice-bible project-manifest dag history \
  recovery telemetry golden provenance compliance workspace storage
→ 27 suites, 0 failed in 176.3s
```

Plus post-fix re-run: `project-manifest golden` → 0 failed in 10.3s. Extension untouched (change = NONE).
No weakened assertions. Gate: **PASS**.

## 28. Full regression

```text
npm test (node scripts/run-tests.js)
→ 28 domains, 0 failed suite(s) in 469.2s (2026-10-06, this session, after all fixes)
npm run check:workspace → {"ok":true,...,"projects":20}
npm run check:repo-structure → REPOSITORY_STRUCTURE_OK
node scripts/checks/validate-schemas.js → RESULT: ALL TESTS PASSED
```

Required: 0 failed suites, P0 = 0, P1 = 0. Gate: **PASS**.

## 29. P0/P1

P0 = 0, P1 = 0. No stop condition fired (§49 checklist verified: unblocked plan, canonical FSS resolvable,
narrator unchanged, Bible constraint respected, no rights trigger, fresh ND/pass, no runtime fallback observed,
no empty/silent/corrupt audio, script unmodified, no paid calls, no external QA upload, no unresolved FAIL,
regressions green).

## 30. Phase 2.4 gate

SR1–SR16 all satisfied (§§6,8,9,11,12,15,16,26). `PHASE_2_4_QUALITY_GATE = PASS`.

## 31. Phase 2.5 gate

PQ1–PQ12 all satisfied with honest limits (§§13,14; REVIEW_REQUIRED preserved per PQ12).
`PHASE_2_5_QUALITY_GATE = PASS`.

## 32. Phase 2.6 gate

DQ1–DQ8 satisfied for FACTUAL narrator-only scope; routing contract machine-readable and fail-closed (§17).
`PHASE_2_6_QUALITY_GATE = PASS` with `CURRENT_PROJECT_MULTI_VOICE = NOT_APPLICABLE`.

## 33. Combined gate

C1–C19: all true (gates §§30–32; T1–T47 §25; real Kokoro synthesis §6; technical QA §8; transcript integrity §9;
metrics-from-audio §11; no unresolved FAIL §13; regen proven §15; track assembled §16; track lineage §19;
am_michael current §2; no rights trigger §1; credits 0 §23; no 2.7+ leakage §25/T46–T47; full regression §28;
P0=P1=0 §29). Known non-blocking items: S1 emphasis REVIEW_REQUIRED (operator-optional), synthesis latencies
unrecorded (§23), no frozen TTS golden file (§24), Kokoro modelHash unavailable (§3).

## 34. Final verdict

```text
TASK_VALIDATION = PASS
PHASE_2_4_QUALITY_GATE = PASS      PHASE_2_4 = COMPLETE
PHASE_2_5_QUALITY_GATE = PASS      PHASE_2_5 = COMPLETE
PHASE_2_6_QUALITY_GATE = PASS      PHASE_2_6 = COMPLETE
PHASE_2_4_2_5_2_6 = COMPLETE
NEXT = PHASE 2.7 + 2.8
```

Phase 2.4 + 2.5 + 2.6 completes because: real canonical narration exists (8/8 am_michael WAVs, wer 0) +
actual speech rate measured from audio (150.72 wpm, PASS) + performance evaluated (7 PASS + 1 honest REVIEW) +
bad segments repairable locally (drill-proven) + traceable Final Narration Track (69675 ms, hash-verified) +
correct narrator-only routing decision + all regressions green (28 domains, 0 fail). No music/SFX/mix/master,
forced alignment, captions, timeline timing, or video work was started in this package.
