# PHASE 1G.12 — TASK 02 REPORT
# RETROACTIVE HARDENING SWEEP + 1G QUALITY GATE (ROADMAP V6.1)

```text
TASK_VALIDATION = PASS
PHASE_1G_QUALITY_GATE = PASS
PHASE_1G = COMPLETE
NEXT = PHASE_1H.1
```

**Project:** UNFOLDIQ · **Roadmap:** V6.1 only · **Paid Flow generations this task:** 0
**Window:** 2026-10-05 · **Task file:** `PHASE_1G12_02_RETROACTIVE_HARDENING_SWEEP_AND_QUALITY_GATE.md`

---

## 1. Entry gate

Verified from existing evidence (read, not assumed):

```text
Report/PHASE_1G12_01_VEO_REAL_E2E_REPORT.md → TASK_VALIDATION = PASS
Case A — Image + Remotion            PASS
Case B — First Frame → Video         PASS (attempt-2)
Case C — First + Last → Video        PASS
Case D — Reference continuity >=3    PASS
```

```text
FUNCTIONAL_1G12 = PASS
QUALITY_1G12 = (this report)
PHASE_1G = NOT_COMPLETE (until §18)
```

## 2. V6.1 status correction

`projects/phase1g12-hardening/v61-status-correction.json` (pre-existing, verified):

```text
Task 01 = FUNCTIONAL PASS (A/B/C/D real E2E)
Roadmap V6.1 Quality Gate = NOT YET PROVEN (at that time)
Task 01 history preserved unchanged; the PHASE_1G=COMPLETE claim is
superseded by this Task-02 gate result.
```

## 3–5. Track audits (A / B / C)

Point-in-time audits (read-only sweeps, pre-existing) were re-verified
finding-by-finding against the working tree instead of trusted blindly:

- `audit/track-a-core-audit.json` — 9 P1 + 6 P2 + 5 P3. All 9 P1s are now
  FIXED (§8). One further P1 found during re-evaluation: **A-21**
  (no provenance gate on canonical source selection, §5.1) — FIXED.
- `audit/track-b-extension-audit.json` — 0 P1. Reported-OPEN P2s B-2/B-3/B-4
  and P3s B-5/B-12 were verified FIXED in the working tree (code + tests);
  the rest are genuine backlog (§17).
- `audit/track-c-integration-audit.json` — 2 P1s (C-1, C-2) verified FIXED
  (diff + H-tests); C-3/C-5/C-6/C-8/C-13 verified FIXED; C-4 verified
  NOT-A-BUG (synchronous-mutator atomicity note); C-7 = B-2 FIXED.

Seed-issue re-evaluation (§5): 5.1 provenance → A-21 (gate +
`as-1186233d1af6` migration, §8); 5.2 B1 divergence → tuple-freeze is the
1G.8 proposal + ceremony SUBMIT_EVIDENCE + bridge fingerprint binding
(C-5); 5.3 VEO_REFERENCE downgrade → A-5 + H-OV1 pin; 5.4 probe order →
A-20 backlog (documented) + structural suite PASS; 5.5 correlation →
`checkCorrelationForReady` + computed matrix rows (ambiguity can never
become READY); 5.6 credit strength → `evidenceStrength` taxonomy enforced
by case-ledger (UNKNOWN never accompanies numeric spend).

## 6. Baseline table

Pre-existing baselines (methods + sample counts recorded in the JSONs):

| Track | Metric | Baseline | Target | Result |
|---|---|---|---|---|
| Core | full repo regression | 14 domains, 0 failed (300.5s at capture) | 0 failed | PASS (309.8s at gate) |
| Core | extension suite | 525→533 assertions, 0 failed | 0 failed | PASS |
| Core | asset lookup / motion decision / QA latency | 0.25 / 0.56 / 0.48 ms mean | <10/<50/<100ms | PASS |
| Ext | sidePanel open→usable (5 loads) | med 57ms | <1000ms | PASS |
| Ext | job card render / bundle 483KB→441027B / e2e 4.7s→3.2s | within budget | <5s/<2MB/pass | PASS |
| Int | bridge health p95 0.85ms / auth p50 0.25ms / payload 356B | p95<50ms | PASS | PASS |

NOT_MEASURED with explicit reasons: full-pipeline stage latency, live
CPU/RAM/observer rates, bridge→extension live latency, reconnect latency
(all require the operator real-Chrome session or paid generation; covered
by deterministic suites instead).

## 7–8. Findings by severity / P0/P1 fixes

Full ledger: `projects/phase1g12-hardening/findings/findings.json`;
closure: `findings/p0-p1-closure.json` (**open P0 = 0, open P1 = 0**).

P0: none found. P1 (12 closed): A-1 single ledger owner
(`scripts/cli/case-ledger.js`); A-2 explicit reconcile 43→50 with
`previousHeader` preserved; A-3 `(attemptId, kind)` key + C/D reservation
symmetry; A-4 unknown-spend blocks auth + retry; A-5 override
re-derivation (VEO_REFERENCE preserved); A-6 selection-conflict refusal;
A-7 effective-model pricing; A-8 core-owned byte persistence; A-9 computed
matrix rows + correlation gate; A-21 canonical-source gate + avatar
migration; C-1 per-route body cap; C-2 durable submit-issued record.

## 9. Before/after evidence

`projects/phase1g12-hardening/evidence/before-after/`:

```text
BEFORE-ledger.json.bak / BEFORE-ledger-validate.json (STALE_HEADER + 6×STRENGTH_UNKNOWN)
AFTER-ledger.json / AFTER-ledger-reconcile.json (header {50,0}, previousHeader kept, validate ok:true)
BEFORE-run-case-{b,c,d}.js.bak → AFTER-run-case-{b,c,d}.js (ledger delegation + computed rows)
AFTER-case-ledger.js (new canonical owner)
BEFORE-avatar-record.json (SELECTED+locked+REJECTED) → AFTER-avatar-record.json (REJECTED+locked, reason trail)
AFTER-sidepanel.html (aria-live on #status-text)
```

Note: lib/C fixes landed in a prior session, so their BEFORE is the
audit-cited pre-fix code + the failing-shape reproduction
(`case-ledger validate` exit 1 above); AFTER is current code + regression.

## 10. Accessibility evidence

`evidence/accessibility/playwright-a11y-gate.txt`: new durable spec
`tests/e2e/flow-companion-a11y.spec.js` — real Chromium + built extension:
aria-live on `#status-text` present; `:focus-visible` rule ships; all
visible controls named; Tab reaches `open-settings`, no stuck focus, ≥3
distinct controls per cycle; error slot exists for `role=alert`. **1
passed.** Scope honesty: full screen-reader live run needs the operator
environment; the relevant gate (§7.3) passes.

## 11. Resource/runtime evidence

`evidence/resource/resource-summary.json`: bundle 30 files / 441027 B
(<2MB); full suite 309.8s / 0 failed; extension 533 assertions / 0 failed;
e2e 3.2s + a11y 1.7s. MV3 notes from audit hold: no indefinite keepalive,
bounded polls, storage.session for non-secret state.

## 12. Retry/reconnect/idempotency evidence

`evidence/idempotency/flow-hardening-H1-H8.txt` (8 assertions PASS:
H1–H4 lost-ACK/duplicate/reconnect, H5/H6 large payload, H7 job-shape,
H8 reconciliation exit); `flow-safety-retry.txt` (34 PASS);
`evidence/reconnect/state-machine-reconnect.txt` (15 PASS).
Zero paid generations; `DUPLICATE_PAID_SUBMIT_COUNT = 0`;
`DUPLICATE_GENERATION = 0` under all deterministic retry/reconnect paths.

## 13. Credit-spend safety evidence

New `tests/cost/test-hardening-budget-gates.js` (11 PASS): unknown
in-flight blocks attempt-auth AND retry (`REVIEW_REQUIRED_UNKNOWN_SPEND`);
clean-ledger control APPROVED; reservation/reconciliation coexistence;
legacy-field tolerance; stale-header detection; UNKNOWN-strength and
null-observed refusals. Live ledger entries now carry non-UNKNOWN
`evidenceStrength` (5× `LIVE_UI_OBSERVED`, 1×
`CANONICAL_COST_TABLE_RECONCILED`, grounded in Task-01 ceremony evidence).

## 14. Security/privacy regression

`evidence/security/security-privacy-checks.json`: 9/9 PASS — no password
handling, no cookie scraping (no `cookies` permission), no tokens in
reports/logs (e2e asserts log redaction; no 32+ hex secrets in hardening
artifacts), loopback-only bridge (BR3), sender pinning (C-6),
no `<all_urls>`, untrusted-download gating, traversal guards, secret
stripping. Reconnect/resume changes weaken nothing (fail-safe direction:
block, never duplicate).

## 15–16. Targeted + full regression

Targeted (each PASS): `cost` (161+11), `real-e2e` (13+6+21),
`flow` (all suites incl. bridge/token/jobs/safety/state-machine/hardening),
`story` (150 visual-motion incl. H-OV1..OV4; 158 grammar),
`providers` (152), `platform` (171), `qa`, `pipeline`, `remotion`,
`media`, `policy`, `topic`, `research*`. New suites:
`test-correlation-gate` (6), `test-canonical-source-gate` (5),
`test-hardening-budget-gates` (11).
Full: `evidence/regression/full-repo-regression.txt` — **14 domains, 0
failed suites, 309.8s**. Extension suite **533/533**. Repo-structure
**OK**. Playwright e2e **1 passed (3.2s)** + a11y **1 passed (1.7s)**.
No weakened assertions, no skips. Exact commands:

```text
node tests/real-e2e/test-correlation-gate.js
node tests/flow/test-canonical-source-gate.js
node tests/cost/test-hardening-budget-gates.js
node scripts/run-tests.js cost real-e2e
npm run --prefix flow-companion/extension test
npm run --prefix flow-companion/extension build
npm test                         (full, 309.8s, exit 0)
npm run check:repo-structure     (OK)
npx playwright test tests/e2e/flow-companion.spec.js
npx playwright test tests/e2e/flow-companion-a11y.spec.js
node scripts/cli/case-ledger.js validate|reconcile --project phase1g12-case-a
```

## 17. Open P2/P3 backlog

`findings/p2-p3-backlog.json`: 6 P2 + 12 P3 with evidence + actions
(A-11..A-13, A-15..A-20, B-1, B-6..B-11, B-13, C-9..C-12). Each deferred
with a stated reason (non-blocking, fail-safe direction, or needs
operator-session measurement first). Fixed-this-task P2/P3s are listed
separately (A-10, A-14, B-2..B-5, B-12, C-3, C-5..C-8, C-13).

## 18. Q1–Q20 matrix

`quality-gate/phase-1g-quality-gate.json`: **Q1–Q20 all PASS**
(Q6–Q8 recorded with explicit NOT_MEASURED reasons; Q15/Q16 test-proven
at 0 paid; Q18 relevant-gate scope noted; Q11 prior-session BEFORE via
audit citations — all documented in the JSON notes).

## 19. Final verdict

```text
TASK_VALIDATION = PASS
PHASE_1G_QUALITY_GATE = PASS
PHASE_1G = COMPLETE
NEXT = PHASE_1H.1 — VERSIONED PROJECT MANIFEST
```

Stop conditions: none triggered (no open P0/P1, no duplicate-paid path,
no ownership ambiguity, no security regression, full regression green).
One-off scripts used (`migrate-avatar.js`, strength annotations) live
outside the repo temp dir; no `fix-*`/`temp-*` files added to the repo.
Paids: 0. Task-01 history preserved; corrections are explicit,
reason-trailed migrations, never silent rewrites.
