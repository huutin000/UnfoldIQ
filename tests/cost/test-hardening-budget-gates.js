"use strict";

/**
 * Phase 1G.12 hardening (Task 02, A-1/A-2/A-3/A-4/A-10 + §5.6): budget-gate tests.
 * - UNKNOWN in-flight spend blocks new authorizations AND retries (lib).
 * - Ceremony ledger: single format, (attemptId, kind) dedupe, stale-header
 *   detection, UNKNOWN strength never accompanies numeric observed cost.
 * Deterministic, zero credits, zero provider calls.
 */

const os = require("os");
const fs = require("fs");
const path = require("path");
const oc = require("../../lib/output-cost/index.js");
const caseLedger = require("../../scripts/cli/case-ledger.js");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
  console.log(`  ✓ ${message}`);
  passed++;
}

async function runTest(name, fn) {
  console.log(`\n[TEST] ${name}`);
  try {
    await fn();
    console.log(`[PASS] ${name}`);
  } catch (e) {
    console.log(`[FAIL] ${name}: ${e.message}`);
    failed++;
  }
}

function plan(limit = 100) {
  return { hardBudget: { unit: "CREDITS", limit } };
}

async function main() {
  await runTest("A-10: unknown in-flight spend blocks a new authorization (never full budget)", () => {
    const ledger = {
      creditsObserved: 50, committed: 0,
      entries: [{ attemptId: "x-attempt-01", creditsObserved: null, status: "SUBMITTED" }],
    };
    const r = oc.authorizeGenerationAttempt({
      budgetPlan: plan(), ledger, unit: { unitId: "gu-x" }, cost: { state: "EXACT", valuePerGeneration: 7 },
    });
    assert(r.state === "REVIEW_REQUIRED_UNKNOWN_SPEND", `unknown in flight blocks (got ${r.state})`);
  });

  await runTest("A-10: unknown in-flight spend blocks a retry too", () => {
    const ledger = {
      creditsObserved: 50, committed: 0,
      entries: [{ attemptId: "x-attempt-01", creditsObserved: null, status: "SUBMITTED" }],
    };
    const r = oc.authorizeRetry({
      budgetPlan: { hardBudget: { unit: "CREDITS", limit: 100 }, retryPolicies: { "gu-x": { maxAdditionalAttempts: 2, reservedCredits: 7 } } },
      ledger, unitGroup: "gu-x", failureClass: "PROVIDER_MISMATCH", priorAttemptId: "x-attempt-01", attemptIndex: 1,
    });
    assert(r.state === "REVIEW_REQUIRED_UNKNOWN_SPEND", `retry blocked on unknown (got ${r.state})`);
  });

  await runTest("control: exact cost with no unknown in flight is APPROVED", () => {
    const ledger = {
      creditsObserved: 50, committed: 0,
      entries: [{ attemptId: "x-attempt-01", creditsObserved: 7, status: "RECONCILED" }],
    };
    const r = oc.authorizeGenerationAttempt({
      budgetPlan: plan(), ledger, unit: { unitId: "gu-x" }, cost: { state: "EXACT", valuePerGeneration: 7 },
    });
    assert(r.state === "APPROVED", `clean ledger approves (got ${r.state})`);
  });

  await runTest("A-3: reservation and reconciliation share an attemptId without collision", () => {
    const proj = fs.mkdtempSync(path.join(os.tmpdir(), "unfoldiq-ledger-"));
    fs.mkdirSync(path.join(proj, "budget"), { recursive: true });
    fs.writeFileSync(path.join(proj, "budget", "ledger.json"), JSON.stringify({ creditsObserved: 0, committed: 0, entries: [] }));
    const r1 = caseLedger.appendLedger(proj, {
      attemptId: "b1-attempt-01", kind: "reservation", unitId: "gu-b",
      reservedCredits: 7, creditsObserved: null, status: "UNRECONCILED",
    });
    assert(r1.ok && !r1.deduped, "reservation appended");
    const r2 = caseLedger.appendLedger(proj, {
      attemptId: "b1-attempt-01", kind: "reconciliation", unitId: "gu-b",
      reservedCredits: 0, creditsObserved: 15, status: "RECONCILED",
      evidenceStrength: "CANONICAL_COST_TABLE_RECONCILED", reconciliationSource: "TEST-ONLY cost table",
    });
    assert(r2.ok && !r2.deduped, "reconciliation coexists under the same attemptId");
    assert(r2.ledger.entries.length === 2, "both entries kept — no silent drop");
    const r3 = caseLedger.appendLedger(proj, {
      attemptId: "b1-attempt-01", kind: "reconciliation", unitId: "gu-b",
      reservedCredits: 0, creditsObserved: 15, status: "RECONCILED",
      evidenceStrength: "LIVE_UI_OBSERVED", reconciliationSource: "TEST-ONLY",
    });
    assert(r3.ok && r3.deduped, "same (attemptId, kind) is idempotent");
  });

  await runTest("A-1/A-2: legacy field names read, stale header detected", () => {
    const proj = fs.mkdtempSync(path.join(os.tmpdir(), "unfoldiq-ledger-"));
    fs.mkdirSync(path.join(proj, "budget"), { recursive: true });
    fs.writeFileSync(path.join(proj, "budget", "ledger.json"), JSON.stringify({
      creditsObserved: 43, committed: 0,
      entries: [{ attemptId: "a", observedCredits: 7, state: "RECONCILED", evidenceStrength: "LIVE_UI_OBSERVED" }],
    }));
    const v = caseLedger.validateLedger(caseLedger.readLedger(proj));
    assert(!v.ok && v.problems.some((p) => /^STALE_HEADER/.test(p)), "stale header detected");
    assert(v.computed.creditsObserved === 7, "legacy observedCredits counted");
  });

  await runTest("§5.6: numeric observed cost with UNKNOWN strength is refused", () => {
    const proj = fs.mkdtempSync(path.join(os.tmpdir(), "unfoldiq-ledger-"));
    fs.mkdirSync(path.join(proj, "budget"), { recursive: true });
    fs.writeFileSync(path.join(proj, "budget", "ledger.json"), JSON.stringify({ creditsObserved: 0, committed: 0, entries: [] }));
    const r = caseLedger.appendLedger(proj, {
      attemptId: "z", kind: "reconciliation", reservedCredits: 0, creditsObserved: 7, status: "RECONCILED",
    });
    assert(!r.ok && r.code === "LEDGER_STRENGTH_UNKNOWN", "UNKNOWN strength cannot carry numeric spend");
  });

  await runTest("§5.6: RECONCILED with null observed cost is refused (UNKNOWN never becomes zero)", () => {
    const proj = fs.mkdtempSync(path.join(os.tmpdir(), "unfoldiq-ledger-"));
    fs.mkdirSync(path.join(proj, "budget"), { recursive: true });
    fs.writeFileSync(path.join(proj, "budget", "ledger.json"), JSON.stringify({ creditsObserved: 0, committed: 0, entries: [] }));
    const r = caseLedger.appendLedger(proj, {
      attemptId: "z", kind: "reconciliation", reservedCredits: 0, creditsObserved: null,
      status: "RECONCILED", evidenceStrength: "LIVE_UI_OBSERVED",
    });
    assert(!r.ok && r.code === "LEDGER_UNKNOWN_AS_ZERO", "null observed can never RECONCILE");
  });

  console.log(`\n=== DONE: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(`FATAL: ${(e && e.stack) || e}`);
  process.exit(1);
});
