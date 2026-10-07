# PHASE 1H.2 — TASK 01 REPORT
# GENERATION HISTORY / LOCKING

```text
TASK_VALIDATION = PASS
PHASE_1H2_QUALITY_GATE = PASS
PHASE_1H2 = COMPLETE
NEXT = PHASE_1H.3
```

**Project:** UNFOLDIQ · **Roadmap:** V6.1 · **Paid generations:** 0 · **Window:** 2026-10-05

---

## 1. Entry gate

From `Report/PHASE_1H1_01_VERSIONED_PROJECT_MANIFEST_REPORT.md` (read) +
live checks: 1H.1 PASS / COMPLETE, P0/P1 = 0, manifest schema versioned,
live manifest `pm-170a9f2f093c` validated ok (pv2/rev2 at entry),
conflict + atomicity proven by 1H.1 suites, full regression re-verified
green in §24. All true → not blocked.

## 2. Existing-state audit

- 1G.10 registry: per-record `{lock, selection, qualityStatus}` — no lock
  history, no generation linkage. Live case-a: 4 locked (3 canonical
  SELECTED/APPROVED + avatar REJECTED/REJECTED).
- Bridge job machine: execution state (PENDING→READY), not canonical
  history — referenced by jobId, never duplicated.
- QA summaries: statuses + timeline eligibility, no decision identity.
- No variant records, no scene/segment/voice locks anywhere (all new).
- Owner decision: `lib/generation-history/` (CORE), single atomic store
  `projects/<pid>/history/history.json`. No database (no blocker proven).

## 3. History schema

`schemas/generation-history.schema.json` (v1.0.0): generations / variants /
decisions / locks maps + revision + fingerprint, `additionalProperties:
false`. Target types: SCENE, SEGMENT, ASSET, VOICE_PARAGRAPH, SHOT.
Registered in `validate-schemas.js` (syntax + valid/invalid cases) → ALL
PASSED.

## 4. Generation history

`recordGeneration` (id `gen-<12hex>`, jobId + attemptId required) +
`completeGeneration` one-way SUBMITTED→terminal. Same id + same bytes →
no-op; same id + different bytes → HISTORY_CONFLICT (emission timestamps
excluded from replay comparison; first write wins). Terminal records never
change (B1 FAIL stays FAIL — L2).

## 5. Variant history

`recordVariant` (PROPOSED, must reference a recorded generation) +
`selectVariant` fail-closed: locked target, rejected variant, or another
SELECTED variant on the target → structured refusal. One current selection
per target (no multi-select in V1 — stated P3).

## 6. Approval/rejection decisions

`recordDecision` requires target + `dec-<12hex>` + reason + non-empty
`evidenceRefs` (no opaque approvals). Same id replay → no-op; same
verdict in force → ALREADY_APPROVED/REJECTED (no write); differing value
→ new event (revision path). APPROVED auto-selects + auto-locks by
default policy (§9.1); REJECTED marks the variant REJECTED.

## 7. Lock model

Per-target `{status, lockVersion, reason, sourceDecisionId, events[]}`.
`lockTarget` (ALREADY_LOCKED no-op on same protection),
`checkRerunAllowed` gate, `lockGateForAuthorizer` for the 1G.8 authorizers
(optional callback injection — zero coupling, backward compatible).

## 8. Scene lock

Narrowly scoped per scene id. L6: S1 locked → rerun refused with lock
evidence; S2 free. Migration created no scene locks (no scene-level
decisions in evidence — not fabricated).

## 9. Segment lock

L7: X locked → X refused, Y unaffected. Never a project-wide lock.

## 10. Asset lock integration

No second owner: 1G.10 stays the registry lock writer; history mirrors
via `lockTarget` and gates via `selectAssetWithHistory` (registry/history/
canonical-source checks, then delegates to `setSelection`).
`detectLockDivergence` checks BOTH directions and never auto-resolves.
Acceptance proven: history-LOCKED vs registry-UNLOCKED detected (L22);
the live avatar anomaly (registry freeze-lock, no history lock — rejected
content is excluded, never locked) is the standing triaged proof.

## 11. Voice paragraph lock

Contract only, no Phase 2: lock/unlock/check work on `paragraphId`
fixtures (L9); live project query → `NOT_CREATED_YET`, zero fabricated
records.

## 12. Unlock/revision semantics

Unlock requires reason + expected lock version (stale → LOCK_CONFLICT);
appends the event, preserves the trail, bumps versions. Re-approval path
enforced: new APPROVED on a LOCKED target without prior unlock →
TARGET_LOCKED (finding H2-F1, fixed + pinned in L11). Old approvals stay
intact; SUPERSEDED (never deleted); lock trail lock→unlock→re-lock.

## 13. Manifest integration

Explicit schema migration 1.0.0→1.1.0 adding optional `history:
{historySchemaVersion, ref}` (`additionalProperties` still enforced;
undeclared shapes refused — L21). Live manifest migrated pv2/rev2 →
pv3/rev3, history ref set → pv4/rev4, validates. 1.0.0 still loads
(backward compatible); migration refuses to run twice.

## 14. Conflict protection

Store-level `expectedRevision` (HISTORY_CONFLICT) + per-lock
`expectedLockVersion` (LOCK_CONFLICT), proven L8/L12/L10. No
last-write-wins anywhere.

## 15. Idempotency

L13/L14: replayed generation/variant/decision/lock/unlock events →
`changed:false`, revision frozen, file mtime untouched. Same lock event on
LOCKED → ALREADY_LOCKED; same unlock event → deduped no-op.

## 16. Migration/backward compatibility

`lib/generation-history/migrate.js` (read-only probes, deterministic ids,
store-level overwrite refusal). Live bootstrap rev 23: 6 generations
(B1 FAILED preserved), 6 variants, 7 decisions (6 + avatar REJECTED, no
generation fabricated), 8 locks (5 SHOT auto-locks + 3 registry mirrors).
Provenance MIGRATED throughout; unprovable → skipped/UNRESOLVED, never
invented. Full decisions log:
`phase1h2-validation/migration/phase1g12-case-a-history-bootstrap.json`.

## 17. Real rerun-protection proof

`evidence/rerun-protection/live-proofs.json` (deterministic, 0 paid):
locked `SHOT::B-SH01` rerun → TARGET_LOCKED with lock evidence;
unrelated shot → ok; `authorizeGenerationAttempt` on the locked shot →
BLOCKED_TARGET_LOCKED pre-submit; retry path likewise (L17); legacy
no-gate calls unchanged. The Core gate stops the expensive action before
any provider execution.

## 18. Rejected-content proof

Avatar `as-1186233d1af6`: history REJECTED decision + registry REJECTED →
`selectAssetWithHistory` → REJECTED_ASSET_NOT_SELECTABLE on both layers;
canonical-source gate as third layer. Historical evidence untouched
(proofs run on live reads; tests on fixture copies).

## 19. Structured errors

19 codes (§22 list + GENERATION_NOT_FOUND/VARIANT ordering needs),
all exercised: HISTORY_* (4), DECISION_* + ALREADY_* (4), lock family
(6), variant family (4), STATE_DIVERGENCE.

## 20. Security/privacy

Secret key-name scan (reused from 1H.1) + secret-value paste scan on
every validate/write: `bridgeToken: …` pastes refused, sha256 prose
allowed (L20). Live store + proofs + baseline scanned: zero secret
shapes. Only ids/refs/hashes persist.

## 21. Performance baseline

`evidence/performance/perf-baseline.json` (hrtime, local Windows):
append/load/validate/projection/lockCheck p50 all < 2ms (budgets ≤ 25ms),
store ~18KB (< 64KB), migration < 1s, ~4.3 events/generation,
unnecessaryRewriteCount = 0. PASS.

## 22. L1–L22 matrix

`evidence/regression/history-L1-L22.txt`: **109 passed, 0 failed** —
L1 append, L2 FAIL preservation, L3 variants, L4 approval (+H2-F1 pin in
L11), L5 rejection, L6 scene, L7 segment, L8 agreement, L9 voice, L10
unlock, L11 revision, L12 conflicts, L13/L14 idempotency, L15 (in L3),
L16 real migration + avatar-triaged divergence, L17 paid-path block,
L18 avatar double-layer refusal, L19 fresh-process restore, L20 secrets,
L21 manifest 1.1.0, L22 divergence detection, PERF.

## 23. Targeted regression

`history project-manifest cost real-e2e qa` → 0 failed;
`flow providers pipeline` → 0 failed (151s, covers budget/retry/Jobs);
`validate-schemas.js` → ALL PASSED (5 new cases).

## 24. Full regression

`evidence/regression/full-repo-regression.txt`: **16 domains (incl. new
history), 0 failed suites, 286.4s.** `check:repo-structure` → OK.
Boundary untouched → extension suite not re-required (§30); 1G evidence
stands. No weakened assertions, no skips.

## 25. Open P2/P3

P0: 0. P1: 0 (H2-F1 found + fixed in-gate). P2: none. P3: (1) avatar
divergence as standing proof (resolves only via explicit registry unlock
or corrective decision); (2) no multi-select targets in V1; (3) B/C model
fields null where per-shot model evidence absent (provenance-honest).

## 26. G1–G24 Quality Gate

All 24 PASS (`quality-gate/phase-1h2-quality-gate.json` with per-gate
notes): history/variants/decisions/locks canonical (G1–G3); scene/segment/
asset/voice (G4–G7); rerun + rejected protection live-proven (G8–G9);
explicit history-preserving unlock (G10); conflicts (G11); idempotency
(G12); faithful migration (G13); fresh restore (G14); manifest 1.1.0
valid (G15); errors (G16); secrets (G17); perf (G18); P0/P1 zero (G19–G20);
L-matrix (G21); targeted (G22); full (G23); no 1H.3 logic — only
targetKey addressing + event trails as hooks (G24).

## 27. Final verdict

```text
TASK_VALIDATION = PASS
PHASE_1H2_QUALITY_GATE = PASS
PHASE_1H2 = COMPLETE
NEXT = PHASE_1H.3
```

No stop condition triggered. Added (no root files):
`schemas/generation-history.schema.json`,
`schemas/project-manifest-1.1.0.schema.json`,
`lib/generation-history/{index,migrate}.js`, manifest 1.1.0 support +
secret-scan export, `scripts/cli/history.js`, `tests/history/`,
`Report/PHASE_1H2_01_…`, live store
`projects/phase1g12-case-a/history/history.json` (rev 23),
manifest 1.1.0 pv4/rev4, evidence under `projects/phase1h2-validation/`.
No secrets, no paid calls, history preserved.
