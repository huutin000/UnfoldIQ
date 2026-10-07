# PHASE 1H.3 — TASK 01 REPORT
# IDEMPOTENCY / RESUME / RECOVERY + ARTIFACT DEPENDENCY DAG

```text
TASK_VALIDATION = PASS
PHASE_1H3_QUALITY_GATE = PASS
PHASE_1H3 = COMPLETE
NEXT = PHASE_1H.4 + 1H.5
```

**Project:** UNFOLDIQ · **Roadmap:** V6.1 · **Paid generations:** 0 · **Window:** 2026-10-05

---

## 1. Entry gate

From `Report/PHASE_1H2_01…md` (read) + live checks: 1H.2 PASS/COMPLETE,
P0/P1 = 0, history rev 23 valid, manifest pv4 valid, rerun/rejected/
stale-writer protections re-verified live in §20. All true → not blocked.

## 2. Existing-state audit

Core had NO checkpoint/resume/idempotency-key/DAG infrastructure (grep:
only comments + story-store input fingerprints). Existing retry owners
reused, never duplicated: 1G.8 `authorizeRetry` (bounded/budgeted),
bridge submit-issued (lost-ACK), ceremony repair scoping, 1H.2 locks +
`lockGateForAuthorizer` (extended with an optional backward-compatible
`lockGate` hook in both authorizers). Retry layering rule: Core recovery
alone repeats mutating actions; bridge/extension/provider retries stay
transport-only.

## 3. Operation identity

`idempotencyKey` (caller) + `inputFingerprint` (hash16 of canonical input
— never timestamps alone) + `operationId op-<12hex>` + run/job/attempt/
artifact + type + parentOperationId + generationId (1H.2 link, no copy).
Same key + same input → original outcome replayed; same key + changed
input → IDEMPOTENCY_CONFLICT (fail closed).

## 4. Idempotency model

`lib/recovery/index.js`, stores `projects/<pid>/recovery/operations.json`
+ `checkpoints.json` (atomic JSON, no DB). Statuses: PENDING,
IN_PROGRESS, WAITING_EXTERNAL, SUCCEEDED, FAILED_RETRYABLE,
FAILED_TERMINAL, UNKNOWN_OUTCOME, CANCEL_REQUESTED, CANCELLED, BLOCKED.
SUCCEEDED requires a persisted `resultRef` (the replay outcome).
I1–I10 all PASS (§25), duplicate expensive side effects = 0 (§28, G28).

## 5. Retry taxonomy/policy

12 classes (§9 list); auto-retry ONLY transport/timeout/busy/download/
import. QA/PROVIDER_REJECTED/conflict/locked/cancelled need new attempts;
UNKNOWN_SUBMIT_OUTCOME needs reconcile (proven absence is the single
spend-safe exception). Bounded attempts + elapsed + deterministic
hash-jitter backoff (no `Math.random` — reproducible plans); one
canonical retry owner (§43 documented).

## 6. Checkpoints

Fixed ordered milestones PLANNED→…→READY; forward-only (IMPORTED →
SUBMIT_ISSUED refused → new attempt). Custom stages recordable without
moving the ordered pointer. Same stage + same ref replays as no-op.
Atomic, versioned (`expectedRevision`), durable, fingerprint-verified.

## 7. Resume planner

Pure `planResume`: proven checkpoints + op status (+ optional lock
context) → machine-readable next action (START/AUTHORIZE/SUBMIT/
AWAIT_*/DOWNLOAD/IMPORT/QA/FINALIZE/RECONCILE/RETRY/NEW_OPERATION…).
Never "restart from zero" when proven state exists; cancelled never
auto-resumes; terminal reports finished.

## 8. Same-result recovery

UNKNOWN_OUTCOME → `reconcileUnknownOutcome`: found → SUCCEEDED reusing
the SAME resultRef (I4: executor ran once); absent → FAILED_RETRYABLE +
`reconciledAbsence` (only spend-safe retry). Same-hash imports dedup
(I5); QA finalization replays stored outcomes (I6).

## 9. Attempt lineage

`parentOperationId` + `generationId` (1H.2, referenced) + failure class +
retry refs. B1 FAILED_RETRYABLE → child b1-02 op carries the parent link;
failed attempts never overwritten (L-tested in 1H.2, R8 re-proves).

## 10. Terminal states / cancellation

SUCCEEDED / FAILED_TERMINAL / CANCELLED / BLOCKED terminal (never
reopen); rest non-terminal with explicit meaning. Cancel: request (reason
required) → confirm; post-submit confirm without result →
UNKNOWN_OUTCOME (never pretends work vanished); cancel deletes no
history/evidence; resume after cancel requires a new operation.

## 11. Artifact DAG schema

`schemas/recovery-state.schema.json` (+ dagDoc): 18 roadmap artifact
classes, node `{key, type, versionRef, state, inputRefs[{key,type}],
dependencyFingerprint, producedBy, lockTarget, blockedReason,
provenance}`, 6 states (DIRTY vs STALE deliberately single-concept).
Registered + cased in `validate-schemas.js` → ALL PASSED.

## 12. Dependency fingerprints

`dependencyFingerprint = hash16(sorted upstream keys + their versionRefs
+ edge types)`. `setNodeVersion` reports stale dependents without
invalidating (invalidation stays explicit via `markDirty` with a reason).

## 13. Dirty propagation

Eager BFS through dependency edges only: CLEAN/FAILED/BUILDING → DIRTY;
NOT_CREATED_YET untouched; upstream never dirtied; siblings untouched
(DAG6/DAG8 exact-set asserts). Fingerprint mismatch additionally derives
DIRTY on read (C11: crash-before-propagation can never leave stale
CLEAN).

## 14. Lock-aware invalidation

Locked affected node → BLOCKED + explicit reason (never regenerated);
propagation continues past it; planner transitively shields the whole
downstream branch (TIMELINE/RENDER blocked by upstream S3_QA — DAG9).
Unlock + explicit DIRTY reset = the revision decision (R6).

## 15. Selective rebuild planner

`planRebuild` → `{rebuild, reuse, blocked, unaffected, needsDecision}`
(FAILED/BUILDING need explicit decisions, never silent reschedules).
Example (§25): scene-3 change → rebuild S3 branch only; S1/S2/audio/
research reused byte-identical.

## 16. Partial rerun

`rerunBranch` executes only the affected closure topologically with an
injected executor (simulated; side-effect counted), skips blocked as
`skippedBlocked`, marks successes CLEAN with fresh fingerprints,
halts-with-FAILED on executor failure. No paid generation in this task.

## 17. Manifest integration

Explicit migration 1.1.0→1.2.0 adding optional `recovery:
{recoverySchemaVersion, dagSchemaVersion, ref}` (undeclared shapes
refused). Live manifest pv4 → pv5 (migrate) → pv6 (recovery ref),
validates. 1.0.0/1.1.0 still load. Manifest stays an index, never an
event store.

## 18. History/locking integration

1H.2 owns generations/decisions/locks; 1H.3 references (`generationId`,
`lockTarget`, injected `locksReader`) and enforces (TARGET_LOCKED,
BLOCKED_TARGET_LOCKED, REJECTED_*). No lock history duplicated; H2-F1
rule (unlock-first revision) holds end-to-end (R6).

## 19. Migration/bootstrap

Recovery: 6 operations from history generations (B1 FAILED_RETRYABLE +
child link; 5 SUCCEEDED with 5–9 evidence checkpoints each) —
`migration/phase1g12-case-a-recovery-bootstrap.json`. DAG: 15 nodes
(SHOT_PLAN + RENDER_INPUT content-hash MIGRATED; 13 futures
NOT_CREATED_YET; zero invented edges) — `dag.js bootstrap`. Nothing
fabricated; one-shot scripts deleted after use.

## 20. Real current-project validation

§36: 6 ops + chains + 15-node DAG from proven refs; no historical
rerun; fresh process loads manifest+history+ops+checkpoints+dag with
identical fingerprints, same 9-target projection, rebuild 0, resume
finished (`evidence/regression/fresh-process-proof.json`). Live proofs:
locked SHOT rerun → TARGET_LOCKED; authorizer → BLOCKED_TARGET_LOCKED;
avatar → REJECTED_ASSET_NOT_SELECTABLE (both layers); voice (N/A here);
divergence = avatar standing proof only.

## 21. Structured errors

Recovery (11) + DAG (8) codes, every one hit by tests (C/I/DAG/R +
explicit error tests). No string-matching orchestration needed.

## 22. Security/privacy

Key-name + value-paste scans on all three stores (L20-style tests for
recovery/DAG; secret pastes refused, hashes allowed). Live stores
scanned: zero secret shapes. Payloads carry ids/refs/hashes only.

## 23. Performance baseline

Recovery: lookup/checkpoint/resume p50 < 2ms; DAG small graph
mutation p50 ~10ms / propagation ~17ms / plan < 1ms (budgets ≤ 25/25/10ms);
medium graph (300 nodes + branches, 129KB): propagation p50 ~24ms, plan
~17ms (budgets ≤ 500ms); write amplification = 1 atomic replace per
effective mutation, 0 on dedupe
(`evidence/performance/perf-baseline-{recovery,dag}.json`). All budgets
PASS.

## 24. C1–C12 matrix

`evidence/regression/recovery-C-I.txt` (C1–C10, C12) + dag suite (C11):
every crash point asserts resume point + zero duplicate side effects +
preserved state + exact next action (C4 counters, C9 fresh-process QA,
C12 failed write intact). C11 derives DIRTY via fingerprints.

## 25. I1–I10 matrix

Same file: I1 one effect; I2 conflict; I3 executor-once + result reuse;
I4 must-reconcile + same-result reuse; I4b absence-only retry; I5/I6
replay stored refs; I7/I8 cross-module dedupe (history/manifest); I9
fresh-process same op+result; I10 single winner, loser told duplicate.

## 26. DAG1–DAG12 matrix

`evidence/regression/dag-R.txt`: DAG1 build; DAG2 idempotent +
typed-facet coexistence; DAG3 unknown refused; DAG4/5 cycles refused;
DAG6 exact audio closure (8 nodes, upstream clean); DAG7 thumbnail
isolation both directions; DAG8 sibling cleanliness; DAG9 BLOCKED +
branch shielding; DAG10 lazy DIRTY; DAG11 revision frozen on no-ops;
DAG12 cross-process identical plan.

## 27. R1–R8 matrix

Same file: R1/R2 exact closure; R3 only downstream runs; R4 clean
branches byte-identical; R5 blocked + skipped, zero execution; R6 unlock
→ revised branch runs; R7 reuse proven; R8 executor failure → FAILED +
explicit-decision requirement with lineage intact.

## 28. Targeted regression

`recovery dag history project-manifest cost real-e2e qa` → 0 failed;
`flow providers pipeline` → 0 failed; `validate-schemas.js` → ALL
PASSED (7 new cases); manifest/history CLIs live-exercised.

## 29. Full regression

`evidence/regression/full-repo-regression.txt`: **18 domains (incl. new
recovery + dag), 0 failed suites, 292.0s.** `check:repo-structure` → OK.
Boundary untouched → extension suite not re-required (§45). No weakened
assertions, no skips.

## 30. Open P2/P3

P0: 0. P1: 0. P2: none. P3: O(n) key scan (fine at V1 scale), no
multi-select, custom-stage pointer semantics, B/C model nulls
(evidence-honest), executor-throw prefix semantics, B/C resolutions as
refs — all documented in `evidence/findings-1h3.json`.

## 31. G1–G37 Quality Gate

All 37 PASS (`quality-gate/phase-1h3-quality-gate.json` with notes):
records persisted + replay-safe (G1–G3); unknown-outcome + taxonomy +
bounded single-owner retries (G4–G6); proven checkpoints, no regression,
deterministic planner (G7–G9); fresh-process resume (G10); same-result
reuse (G11); lineage (G12); explicit cancellation (G13); canonical DAG +
cycles + fingerprints (G14–G16); exact dirty closure + isolations (G17–
G19); locked-BLOCKED + selective planner + partial rerun (G20–G22);
faithful bootstrap (G23); cross-process survival (G24); errors (G25);
secrets (G26); perf (G27); zero duplicated spend (G28); P0/P1 zero
(G29–G30); C/I/DAG/R matrices (G31–G34); targeted + full green (G35–
G36); no 1H.4+ logic (G37).

## 32. Final verdict

```text
TASK_VALIDATION = PASS
PHASE_1H3_QUALITY_GATE = PASS
PHASE_1H3 = COMPLETE
NEXT = PHASE_1H.4 + 1H.5
```

No stop condition triggered. Added (no root files):
`schemas/recovery-state.schema.json`,
`schemas/project-manifest-1.2.0.schema.json`,
`lib/recovery/index.js`, `lib/dependency-dag/index.js`,
manifest 1.2.0 support, `scripts/cli/{recovery,dag}.js`,
`tests/{recovery,dag}/`, live stores
(`recovery/operations.json`, `recovery/checkpoints.json`,
`dependency-dag.json`, manifest 1.2.0 pv6), evidence under
`projects/phase1h3-validation/`. No secrets, no paid calls.
