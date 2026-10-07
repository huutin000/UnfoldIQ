"use strict";

/**
 * Phase 1G.12 — case/matrix result tests (deterministic, zero credits).
 * Matrix sizes: A=9, B=15, C=14, D=18, R=8. Case results reference
 * canonical artifacts; embedding them is refused.
 */

const e2e = require("../../lib/real-e2e/index.js");

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

function items(prefix, n, state) {
  const out = [];
  for (let i = 1; i <= n; i++) out.push({ id: `${prefix}${i}`, state });
  return out;
}

async function main() {
  for (const [m, n] of [["A", 9], ["B", 15], ["C", 14], ["D", 18], ["R", 8]]) {
    await runTest(`matrix ${m} all-PASS → PASS`, () => {
      const r = e2e.evaluateMatrix(m, items(m, n, "PASS"));
      assert(r.status === "PASS", `${m} all-pass is PASS`);
    });
  }

  await runTest("single FAIL fails the matrix (no masking)", () => {
    const list = items("B", 15, "PASS");
    list[5] = { id: "B6", state: "FAIL" };
    const r = e2e.evaluateMatrix("B", list);
    assert(r.status === "FAIL" && r.failed.includes("B6"), "B6 FAIL fails matrix B");
  });

  await runTest("BLOCKED dominates FAIL; PENDING blocks PASS", () => {
    const list = items("D", 18, "PASS");
    list[0] = { id: "D1", state: "BLOCKED" };
    assert(e2e.evaluateMatrix("D", list).status === "BLOCKED", "blocked dominates");
    const list2 = items("A", 9, "PASS");
    list2[8] = { id: "A9", state: "PENDING" };
    assert(e2e.evaluateMatrix("A", list2).status === "PENDING", "pending blocks PASS");
  });

  await runTest("wrong matrix shape refused", () => {
    const r = e2e.evaluateMatrix("C", items("C", 5, "PASS"));
    assert(r.status === "BLOCKED", "short matrix refused");
    assert(e2e.evaluateMatrix("Z", []).status === "BLOCKED", "unknown matrix refused");
  });

  await runTest("case result carries refs, never embedded artifacts", () => {
    const good = e2e.buildCaseResult({
      caseId: "A", status: "PASS", projectId: "p1", providerProjectRef: "flow-proj-1",
      shotIds: ["A-SH01"], generationUnitIds: [], attemptIds: ["render-a-1"],
      productionDecisionRefs: ["dec-a-1"], modelResolutionRefs: [],
      budgetPlanRef: "bp-1", providerResultRefs: [], assetIds: ["as-a-1"],
      qaResultIds: ["qa-aaa"], timelineEligibility: ["READY_FOR_TIMELINE"],
      repairHistory: [], credits: { estimated: 0, reserved: 0, reconciled: 0, state: "RECONCILED_ZERO_SPEND" },
      evidenceRefs: ["ev-a-1"],
    });
    assert(good.ok === true && good.result.caseResultId.startsWith("case-a-"), "ref-only case result builds");
    const bad = e2e.buildCaseResult({
      caseId: "B", status: "PASS", projectId: "p1", budgetPlanRef: "bp-1",
      shotIds: ["B-SH01"], generationUnitIds: ["unit-B"], attemptIds: ["att-b-1"],
      assetIds: ["as-b-1"], qaResultIds: ["qa-bbb"],
      qaLayers: { structural: "EMBEDDED" },
      credits: { state: "PENDING" }, evidenceRefs: [],
    });
    assert(bad.ok === false && bad.errors.some((x) => /ARTIFACT_DUPLICATION/.test(x)), "embedded QA layers refused");
    const secret = e2e.buildCaseResult({
      caseId: "B", status: "PENDING", projectId: "p1", budgetPlanRef: "bp-1",
      bridgeToken: "sekret", credits: { state: "PENDING" }, evidenceRefs: [],
    });
    assert(secret.ok === false, "secret-bearing case result refused");
  });

  console.log(`\n=== DONE: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(`FATAL: ${(e && e.stack) || e}`);
  process.exit(1);
});
