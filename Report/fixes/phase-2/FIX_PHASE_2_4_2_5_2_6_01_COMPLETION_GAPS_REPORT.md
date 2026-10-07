# FIX PHASE 2.4 + 2.5 + 2.6 — 01 COMPLETION GAPS REPORT

**Project:** UNFOLDIQ · **Parent:** `PHASE_2_4_2_5_2_6_01` (reported COMPLETE)
**Fix:** `FIX_PHASE_2_4_2_5_2_6_01` — recovery idempotency + targeted regen proof + runtime hash + baseline + TTS golden
**Date:** 2026-10-06 · **Verdict: TASK_VALIDATION = PASS → FIX_PHASE_2_4_2_5_2_6_01 = COMPLETE**

> Bounded correction pass only. Production narration untouched: 8 selected WAVs, QA artifacts, track, routing
> decision are byte-identical before/after (hashes + mtimes verified). No Phase 2.7+ work started.

---

## 1. Recovery/idempotency fix

Root cause of the QA version conflict: `provenance.createdAt` was computed **into** the fingerprint of
speech-rate / performance / track / dialogue docs, so an unchanged rerun could never replay — it always
terminated `SPEECH_RATE_QA_VERSION_CONFLICT` (non-zero exit). Fixes in `lib/tts-audio/index.js` +
`lib/dialogue-routing/index.js`:

```text
- provenance.createdAt assigned AFTER fingerprint computation (future fingerprints are stable;
  matches the pre-existing createSpeechRatePolicy pattern)
- new sameSemantics(a, b): stableStringify comparison excluding provenance + fingerprint
- all 5 persist-conflict branches (policy, SRQ, PFQ, track, dialogue): fingerprint match is now
  verified by semantics too (EXACT), else semantic match reuses the artifact (SEMANTIC), else
  the original conflict code still fails closed
- segment/track replay additionally verifies WAV bytes exist and match audioContentHash
  (TTS_AUDIO_CORRUPT fail-closed on divergence)
- pilot-narration.js: aggregates replay flags; a full reconcile prints RECONCILED and skips
  evidence rewrite (pure NO_OP); manifest attach is already no-write-no-bump on identical state
```

Two latent bugs found by the rerun itself and fixed: `registerDagNodes.ensure` read `.key` off raw
`[key,type]` pairs on the idempotent path (`DAG_NODE_NOT_FOUND: undefined`), and the EXACT-replay branch
trusted the stored fingerprint without semantic verification (a tampered file keeping its old fingerprint
replayed — now fails closed, proven by G19).

## 2. Successful unchanged rerun proof

```text
node scripts/cli/pilot-narration.js  →  {"NARRATION": "RECONCILED", ...}  exit code 0
```

Before/after comparison (snapshots `fix01-before.json` vs live state):

```text
8/8 selected WAV hashes identical · 8/8 mtimes unchanged (no rewrite)
4/4 QA/policy JSON hashes identical · track WAV hash identical
QA/track/decision ids + versions unchanged · Manifest revision unchanged (rev 15)
telemetry success-event count unchanged (18; replay emits nothing)
TTS_SEGMENT_AUDIO / SPEECH_RATE_QA / PERFORMANCE_QA / FINAL_NARRATION_TRACK / DIALOGUE_ROUTING_DECISION = CLEAN
FINAL_AUDIO / FORCED_ALIGNMENT / MASTER_TIMELINE remain NOT_CREATED_YET
```

F1–F7: PASS. (Pre-existing DIRTY nodes SHOT_PLAN/VOICE/CAPTIONS/SCENE_TIMING/RENDER come from the
Stage-12 pipeline and predate this package; untouched.)

## 3. Targeted regeneration fixture

`tests/real-e2e/test-tts-targeted-regen.js` — isolated tmp root, REAL local Kokoro (no mocks), production
audio never touched:

```text
R1 + R2 attempt A synthesized (speed 1.0)
→ rate QA on R2A under strict band [400,420] → FAIL SPEECH_RATE_TOO_SLOW (deterministic)
→ planTargetedRepair → targets exactly [R2], R1 explicitly unaffected
→ R2 attempt B re-synthesized ONLY (speed 0.95, attemptNumber 2, parentAttemptId = attempt A id)
→ re-QA R1+R2B under real band [120,180] → PASS, performance QA no FAIL
→ validation track rebuilt selecting attempt B
```

Result: `=== DONE: targeted-regen fixture PASS ===` (ids R1=tsa-cb53519fd609 R2A=tsa-1de08d88d97b
R2B=tsa-919b2d65e7f7 track=fnt-4ce675c54c14). Tmp root cleaned on success.

## 4. Repair attempt lineage

Attempt B stores `{ number: 2, parentAttemptId: <attempt A tsa id>, reason: "targeted repair ..." }`;
track segment entry references attempt B id + hash. Failed attempt A audio + JSON preserved on disk
(asserted). No lineage field is nullable-forged: all asserted from files written by the lib itself.

## 5. Unaffected hash proof

R1 WAV sha256 before == after; R1 attempt count stays 1; R1 artifact id unchanged. Only the target
segment's QA was recomputed and only the target was re-synthesized. F8–F14: PASS.

## 6. Kokoro local model SHA256

`providers/runtime/adapters/local-kokoro.js` gains `resolveLocalModelFile()` (newest HF snapshot,
no download) + `sha256File()` + `verifyLocalModel(expected)` (MODEL_HASH_MISMATCH fail-closed):

```text
modelFile = C:\Users\huuti\.cache\huggingface\hub\models--hexgrad--Kokoro-82M\snapshots\f3ff3571...\kokoro-v1_0.pth
sizeBytes = 327212226 (== upstream) · localSha256 computed from local bytes in 287ms
```

## 7. Official hash comparison

Official upstream LFS oid for `hexgrad/Kokoro-82M kokoro-v1_0.pth` (HF `paths-info/main`, retrieved
2026-10-06): `496dba118d1a58f5f3db2efc88dbdc216e0483fc89fe6e47ee1f2c53f18ad1e4` — **match = true**.
Persisted as the separate immutable artifact `providers/model-registry/kokoro-v1-identity.json`
(modelFile, localSha256, officialExpectedSha256, match, verifiedAt, sourceRef). Production segment JSONs
were NOT rewritten; per-synthesis modelHash wiring is deferred and stated (see parent §3 note).
F15–F17: PASS (`tests/providers/test-kokoro-model-identity.js`).

## 8. Bounded latency baseline

`tests/providers/test-kokoro-local-benchmark.js` — same runtime/voice/language, representative segments,
zero external credits, isolated tmp root (production full-run total stays historical UNKNOWN):

```text
ttsColdStartLatencyMs = 10304 (first CLI spawn, model load from disk)
ttsWarmSegmentLatencyMs = 10235 (second spawn; per-call python CLI dominates — reported honestly)
asrQaLatencyMs = 3490 (real faster-whisper on production S8 WAV, cached weights)
speechRateQaLatencyMs = 5 · performanceQaLatencyMs = 7
externalCreditsSpent = 0
```

F18–F22: PASS. No historical timings reconstructed.

## 9. TTS behavior Golden G1–G20

`tests/golden/test-tts-behavior-golden.js` — **21/21 PASS, stable across reruns, comparison verdict PASS**
(definition `gold-tts-behavior`, baseline v1→v2 advanced once when metric values were corrected; the
framework refused a same-version overwrite, per governance). Contracts/statuses/semantic fingerprints/
relationships/failure codes compared; no waveform bytes frozen. Stub-transport drills (deterministic sine
at exactly 150 wpm) for repair/join/recovery paths; production evidence read-only. G1–G20 + F23: PASS.

## 10. F1–F25

| Range | Evidence | Result |
|---|---|---|
| F1 rerun exits 0 | RECONCILED, exit code 0 (two runs post-fix) | PASS |
| F2 no WAV rewrite | hashes + mtimes identical | PASS |
| F3 QA reuse by semantic fingerprint | SEMANTIC reconcile paths, QA hashes identical | PASS |
| F4 incompatible version fails closed | G19 tamper → SPEECH_RATE_QA_VERSION_CONFLICT | PASS |
| F5 track reused | track SEMANTIC replay + byte verification | PASS |
| F6 manifest stable | rev 15 before == after | PASS |
| F7 DAG CLEAN | 5 nodes CLEAN, no premature nodes | PASS |
| F8–F14 regen fixture | §3–§5, real Kokoro | PASS |
| F15–F17 model hash | §6–§7 | PASS |
| F18–F22 latencies | §8 | PASS |
| F23 golden G1–G20 | §9, verdict PASS | PASS |
| F24–F25 no 2.7+ leakage | G18 + manifest/DAG states | PASS |

## 11. Manifest/DAG consistency

```text
narrationAudioVersion  VERIFIED · speechRateQaVersion  VERIFIED
performanceQaVersion   UNRESOLVED (REVIEW_REQUIRED — allowed, honest)
dialogueRoutingVersion UNRESOLVED (NOT_APPLICABLE terminal semantics — allowed)
manifest 1.6.0 rev 15 · DAG selectively invalidatable (drill-proven in parent task)
```

## 12. S1 REVIEW_REQUIRED preservation

Unchanged: `pfq-af33fbfcf5c0` S1 stays REVIEW_REQUIRED (`PERFORMANCE_EMPHASIS_MISSED`, non-blocking).
No word-timing fabrication; Phase 2.9 will resolve it. Non-blocking for 2.7 + 2.8. G9 pins this in golden
(a silent PASS would now fail the golden).

## 13. Targeted regression

```text
node scripts/run-tests.js providers golden real-e2e compliance workspace storage
→ 0 failed suite(s) in 93.9s (incl. 3 new suites)
```

## 14. Full regression

```text
npm test (node scripts/run-tests.js) → 28 domains, 0 failed suite(s) in 530.7s
npm run check:workspace → {"ok":true,...,"projects":20}
npm run check:repo-structure → REPOSITORY_STRUCTURE_OK
node scripts/checks/validate-schemas.js → RESULT: ALL TESTS PASSED
```

Required: 0 failed suites, P0 = 0, P1 = 0. **PASS.**

## 15. P0/P1

P0 = 0, P1 = 0. No stop condition fired.

## 16. Final verdict

```text
TASK_VALIDATION = PASS
FIX_PHASE_2_4_2_5_2_6_01 = COMPLETE

PHASE_2_4 = COMPLETE
PHASE_2_5 = COMPLETE
PHASE_2_6 = COMPLETE
PHASE_2_4_2_5_2_6 = COMPLETE

NEXT = PHASE 2.7 + 2.8
```

Q1–Q15 all true: unchanged rerun completes (Q1), no duplicates (Q2), regen path executed for real (Q3),
unaffected hashes proven (Q4), post-repair rebuild proven (Q5), model hash matches upstream (Q6), bounded
latency baseline exists (Q7), behavior golden PASS (Q8), S1 REVIEW preserved (Q9), production WAVs untouched
(Q10), Manifest/DAG consistent (Q11), no 2.7+ leakage (Q12), full regression PASS (Q13), P0 = 0 (Q14),
P1 = 0 (Q15).

Files added: `tests/real-e2e/test-tts-targeted-regen.js`,
`tests/providers/test-kokoro-model-identity.js`, `tests/providers/test-kokoro-local-benchmark.js`,
`tests/golden/test-tts-behavior-golden.js`, `providers/model-registry/kokoro-v1-identity.json`,
`golden/` definition+baselines for `gold-tts-behavior`.
Files fixed: `lib/tts-audio/index.js` (semantic reconcile + repair planner + DAG dep normalization),
`lib/dialogue-routing/index.js` (semantic reconcile), `scripts/cli/pilot-narration.js` (RECONCILED terminal).
