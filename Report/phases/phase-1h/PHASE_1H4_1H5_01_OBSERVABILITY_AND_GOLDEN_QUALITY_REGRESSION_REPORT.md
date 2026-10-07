# PHASE 1H.4 + 1H.5 — TASK 01 REPORT
# OBSERVABILITY — LOG FIRST + GOLDEN PROJECTS / QUALITY REGRESSION

```text
TASK_VALIDATION = PASS
PHASE_1H4_QUALITY_GATE = PASS
PHASE_1H5_QUALITY_GATE = PASS
PHASE_1H4 = COMPLETE
PHASE_1H5 = COMPLETE
NEXT = PHASE_1H.6 + 1H.7
```

**Project:** UNFOLDIQ · **Roadmap:** V6.1 · **Paid generations:** 0 · **Window:** 2026-10-05

---

## 1. Entry gate

From `Report/PHASE_1H3_01…md` (read) + live checks: 1H.3 PASS/COMPLETE,
P0/P1 = 0, fresh-process recovery re-verified (§20 proof fingerprints
match), duplicate expensive side effects = 0 (I-matrix + counters),
DAG/dirty green in §26–27, full regression re-run green in §32. All true.

## 2. Existing-state audit

Core had NO structured telemetry (only ceremony JSONL + bridge logs),
no evidence index, no metric catalog, no golden definitions, no canary
model. Reused, never duplicated: evidenceStrength taxonomy (§5.6),
`checkCorrelationForReady` semantics (§17 outcome mapping), secret
scanners (1H.1/1H.2), atomic/fingerprint/idempotency patterns,
`lockGateForAuthorizer` for lock-aware queries. Extension keeps
browser/DOM facts; Core owns canonical telemetry + golden history.

## 3. Telemetry schema

`schemas/telemetry.schema.json`: events / spans / evidence docs
(`schemaVersion 1.0.0`, revision, fingerprint, `additionalProperties:
false`). Events carry the full §5 field set (ids, stage, provider/model,
state transitions, duration, cost object, result/evidence refs,
errorCode/Class/retryable, scalar attributes, retention, provenance) —
refs/hashes/ids only, never bodies.

## 4. Event/span semantics

`lib/telemetry/index.js`: 25 typed classes (no untyped LOG); severity
bounded with fail-fast misuse rules (TARGET_LOCKED etc. can never be
ERROR); spans bounded with parent linkage (dangling parents refused);
finalize idempotent (no misleading duplicate success spans);
deterministic ids → replays dedupe, rewrites conflict. Retention
classified at record time (no 1H.7 deletion).

## 5. Correlation model

project→run→job→operation→asset→QA chain via shared ids; internal
correlationIds canonical when provider IDs are unavailable (no invented
provider IDs). `getTrace(correlationId)` returns the sorted chain —
LOG-FIRST investigation without grep-everything (proven live, §20
query proof).

## 6. Evidence ledger

`recordEvidence` → immutable `evi-<12hex>` addresses (kind/source/path/
hash/artifactRef); identical re-index no-ops; any rewrite refused.
Bootstrap indexed 7 real artifacts with true file mtimes + MIGRATED
provenance (no fabricated timestamps). `getEvidence` resolves or
EVIDENCE_NOT_FOUND.

## 7. Cost observability

`recordCostEvent` keeps planned/authorized/observed/reconciled SEPARATE
with strength buckets; `costSummary` breaks down by strength (UNKNOWN
never becomes spend — O7). Unknown strengths refused at record time.

## 8. Result/correlation observability

`recordCorrelation` persists candidate count/refs, rejections, selected
ref, confidence, method, hash, fingerprint; null selection + CORRELATED
outcome refused — ambiguity resolves only to BLOCKED_AMBIGUOUS /
REVIEW_REQUIRED (O8), mirroring the 1H.2 correlation gate.

## 9. Errors/security/privacy

`errorSummary` groups by component/stage/code (no log parsing);
`recordSecurityEvent` for SECRET/ORIGIN/PATH_TRAVERSAL/UNAUTHORIZED kinds
with structured detail and zero payloads. Triple-layer secret defense:
input key fail-fast + key-name scan + value-paste scan (O9); prompt
payloads, raw URLs, stack traces, long strings refused as attributes
(cardinality control, §13); hashes/versions/fingerprints stay legal.

## 10. Query/inspection interface

`listEvents` (12 filters + bounded limit), `getTrace`, `errorSummary`,
`costSummary`, `getEvidence` + `scripts/cli/telemetry.js`
(list/trace/errors/costs/evidence-get). Unknown filters refused. Live
query proof persisted (`observability/queries/live-query-proof.json`).

## 11. Observability performance baseline

`evidence/performance/perf-baseline-telemetry.json` (hrtime, local):
append/query/trace/cost p50 < 5ms (budgets ≤ 25/10/10/10ms); store
scales linearly (~30 events ≈ units of KB); write amplification = 1
atomic replace per append, 0 on dedupe. PASS.

## 12. Golden Project schema

`schemas/golden.schema.json`: definitions (immutable by version;
status travels by superseding version), append-only baselines, persisted
comparisons, canaries. Registered + cased in `validate-schemas.js` →
ALL PASSED.

## 13. Golden coverage matrix

13 roadmap dimensions → 9 COVERED + 3 PARTIALLY_COVERED (reviewer-gated
nuance, reasons) + 2 DEFERRED_WITH_REASON (HYBRID: no hybrid production
evidence; 9:16: no 9:16 renders) —
`golden/coverage/coverage-matrix.json`. Aspect reads the definition's
`aspectRatio` contract; categories map the rest. Nothing silently
omitted.

## 14. V1 Golden Set

5 ACTIVE definitions reusing shipped evidence (no new generations):
GOLDEN_A factual explainer (pilot brief/script/captions/spec),
GOLDEN_B fiction continuity selective-Veo (case-a B/C/D),
GOLDEN_C originality study (B2/C/D openers),
GOLDEN_D voice-caption fixture (16 cues + measured timing),
GOLDEN_E image-only zero-Veo (Case A). Statuses ACTIVE; changes
supersede by version.

## 15. Baseline schema/versioning

Baselines carry metrics + pipeline/provider/prompt/instruction/artifact
versions + perf/cost + evidenceRefs + reason + metricSchemaVersion.
Append-only (same version replays only when identical; drift →
NOT_COMPARABLE, never silent). Promotion creates new versions; v1 bytes
preserved (R10/R11 proven).

## 16. Metric definitions

19 metrics in `lib/golden/metrics.js`, each with direction + method
(DETERMINISTIC vs JUDGMENT) + onRegression + appliesTo +
toleranceSource. Judgment MEASURED requires method/reviewer/confidence/
evidenceRefs (no subjective-as-deterministic). Factual metrics refuse
FICTION (`METRIC_NOT_APPLICABLE` — §32 content-class awareness).

## 17. Threshold/tolerance policy

Hard invariants fail (aspect, continuity, unsupported-claims>0,
prompt mismatch, caption sync); rates use V1 relative budgets
(failure +50%, cost +25%, perf +50%→review) sourced as documented
product decisions on single baselines (tighten after N≥3); judgment
always reviews; hardBudget breach FAILs separately.

## 18. Regression comparison

`compareToBaseline` → per-metric rows + regressions[] + improvements[]
+ verdict PASS/REVIEW_REQUIRED/FAIL/NOT_COMPARABLE. Extra candidate
measurements → REVIEW (baseline extension is human); complex values →
human; drift (unknown/missing keys, schema) → NOT_COMPARABLE.

## 19. Factual regression

GOLDEN_A: sourceCoverage 7/7 = 1.0 MEASURED; unsupported claims 0
MEASURED (UNVERIFIED C7 honestly caveated and unreferenced by the
script — evidence-backed); claim↔beat traceability via claimRefs.
Factual rules never touch FICTION (enforced G4/R6).

## 20. Character continuity regression

GOLDEN_B: continuity PASS from the cross-shot record; R7 proves any
break FAILs. Reuses approved canonical frames/assets — zero new
generations.

## 21. Voice/caption regression

GOLDEN_D: captionSync PASS computed (16 cues, 0 overlaps, bounds within
65332ms); speechRate 141.4 wpm measured (in [120,180] band);
pronunciation/flicker NOT_MEASURED with reviewer/frame methods;
paragraph-lock compatibility NOT_APPLICABLE (no paragraphs — contract
exists in 1H.2). No VoiceStudio, no TTS redesign.

## 22. Performance/cost regression

Per-run perf/cost blocks on baselines; R4/R5 prove budget-FAIL and
variance-REVIEW; live B cost 50 reconciled with strength buckets; E cost
0 (zero-Veo path). Cost/quality visible together in every comparison.

## 23. Canary model

`openCanary` (change → smallest subset via category rules + visible
zero-spend estimate) → `runCanaryGolden` per golden (mock candidates,
never paid) → status BLOCKED / REVIEW_REQUIRED / PROMOTE_ALLOWED.
Unrelated goldens excluded by construction (C1/C2 live-proven); subset
violations refused.

## 24. Baseline promotion/update policy

`promoteCanary` requires PROMOTE_ALLOWED + explicit actor + reason +
re-supplied candidate values (never invented); FAIL → CANARY_BLOCKED,
REVIEW → CANARY_REVIEW_REQUIRED (C3/C4); paid execution has no API —
promotion is the sole gate (C8). Old baselines preserved.

## 25. Real Golden proof

§57 with 0 paid: 5/5 live identical candidates PASS; mock wrong-aspect
FAILs on GOLDEN_B; mock PROMPT_POLICY canary PROMOTE_ALLOWED on the
4-golden subset; 6/6 canary telemetry events share `gr-live-proof`
(`golden/comparisons/live-proof.json` + correlated store events).
Self-caught finding H45-E1 (emit names outside telemetry classes →
1/6 correlated) fixed + pinned before gate. Companion evidence: the
bootstrap's own definition/baseline emissions used pre-fix names and were
refused by validation (fail-safe — invalid telemetry never persisted);
only the corrected canary path wrote the 6 correlated store events.

## 26. Golden performance baseline

`evidence/performance/perf-baseline-golden.json`: load/compare p50 <
5ms (budgets ≤ 25ms); metadata ~tens of KB; provider time = 0 (local
evaluation only). PASS.

## 27. O1–O16

`evidence/regression/telemetry-O.txt`: **54/54 PASS** — append, schema
rejection, append-only, correlation trace, spans, error grouping +
severity discipline, cost strengths, correlation ambiguity, secret
redaction, filtered queries, replay idempotency, fresh-process parity,
write-failure safety, no-sampling discipline + evidence ledger + PERF.

## 28. G1–G12

`evidence/regression/golden-G-R-C.txt` (first section): **12/12 PASS** —
create, version immutability, coverage honesty, metric validation
(class-aware), append-only versions, drift → NOT_COMPARABLE, SKIP
semantics, NA with reason, judgment provenance, determinism, ref
resolution (live B refs resolve), secret-free metadata.

## 29. R1–R12

Same file: **12/12 PASS** — identical PASS, invariant FAILs (aspect,
claims, continuity), naturalness REVIEW, budget FAIL (+ tolerance PASS),
variance REVIEW, no-bleed, append-only baseline, promotion versioning,
failed-candidate exclusion.

## 30. C1–C8

Same file: **8/8 PASS** — subset selection (live), prompt-policy subset,
blocked/review gating, explicit promotion, correlated telemetry,
upfront cost estimate, no silent spend path. (Golden suite total: 63
asserts incl. PERF.)

## 31. Targeted regression

`telemetry golden history project-manifest recovery dag cost real-e2e
qa` → 0 failed; `flow providers pipeline` implied via full; manifest/
history CLIs live-exercised; `validate-schemas.js` → ALL PASSED (9 new
cases: 1.2.0 ×2, telemetry ×0 new? — telemetry/golden/history/recovery
schema files syntax-checked + golden/telemetry valid/invalid cases).

## 32. Full regression

`evidence/regression/full-repo-regression.txt`: **20 domains (incl. new
telemetry + golden), 0 failed suites, 317.6s.** `check:repo-structure`
→ OK. Boundary untouched → extension suite not re-required (§60). No
weakened assertions, no skips.

## 33. Open P2/P3

P0: 0. P1: 0 (H45-E1 fixed in-gate). P2: none. P3: reviewer-run backlog
(naturalness, visual nuance, pronunciation, flicker), tolerance
tightening after N≥3 baselines, HYBRID/9:16 execution deferred with
reasons, O(n) scans fine at V1 scale — all in
`evidence/findings-1h45.json`.

## 34. Q1–Q35 Quality Gate

All 35 PASS (`quality-gate/phase-1h45-quality-gate.json` with notes):
contract + correlation + append-only + cost/correlation provenance (Q1–
Q5); queryable errors + redaction + inspection + perf + no sampling
(Q6–Q10); golden/baseline/coverage/set contracts (Q11–Q14); metric
method/direction/thresholds + comparison + class-aware factual +
evidence-backed continuity + perf/cost tracking (Q15–Q20); append-only
baselines + bounded canary + promotion gating (Q21–Q23); real evidence
without fabrication + correlated runs + zero paid (Q24–Q26); O/G/R/C
matrices (Q27–Q30); P0/P1 zero (Q31–Q32); targeted + full green (Q33–
Q34); no 1H.6/1H.7 logic (Q35).

## 35. Final verdict

```text
TASK_VALIDATION = PASS
PHASE_1H4_QUALITY_GATE = PASS
PHASE_1H5_QUALITY_GATE = PASS
PHASE_1H4 = COMPLETE
PHASE_1H5 = COMPLETE
NEXT = PHASE_1H.6 + 1H.7
```

No stop condition triggered. Added (no root files except suggested
data dir): `schemas/telemetry.schema.json`, `schemas/golden.schema.json`,
`lib/telemetry/index.js`, `lib/golden/{index,metrics}.js`,
`scripts/cli/{telemetry,golden}.js`, `tests/{telemetry,golden}/`,
`golden/` definitions + v1 baselines + live comparisons/canaries,
`Report/PHASE_1H4_1H5_01_…`, evidence under
`projects/phase1h45-validation/`. No secrets, no paid calls.
