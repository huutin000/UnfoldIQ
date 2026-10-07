"use strict";

/**
 * Phase 1G.12 — targeted repair tests R1–R8 (deterministic, zero credits).
 * Proves: one failed shot retries ONLY its own unit through the 1G.8 budget
 * gate; history preserved; failed bytes never mutated; QA reruns scoped.
 */

const e2e = require("../../lib/real-e2e/index.js");
const outputCost = require("../../lib/output-cost/index.js");
const qa = require("../../lib/asset-qa/index.js");
const { makePng } = require("../fixtures/make-png.js");

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

function pngInput() {
  return { bytes: makePng(16, 16), fileName: "f.png", expected: { mediaType: "image" } };
}

function goodSem(shot) {
  return {
    expectation: { sceneId: "S", expectedSubject: ["host"], expectedAction: ["waves"], expectedMediaType: "image" },
    observation: { source: "MANUAL_REVIEW", sceneId: "S", subjects: ["host"], actions: ["waves"], mediaType: "image", hasText: false, compositionUsable: true },
  };
}

function goodCont(identity) {
  return {
    sources: { continuityStrictness: "NORMAL" },
    expectation: { characterId: "HOST_A", clothing: "mustard overshirt" },
    observation: { source: "MANUAL_REVIEW", identity: identity || "HOST_A", clothing: "mustard overshirt" },
  };
}

function qaResultFor(over = {}) {
  return qa.evaluateAssetQa({
    projectId: "p1",
    assetId: over.assetId || "as-b-01",
    assetHash: "a".repeat(64),
    shotId: over.shotId || "SHOT-B",
    fingerprintDeps: { assetId: over.assetId || "as-b-01", assetHash: "a".repeat(64) },
    structural: pngInput(),
    semantic: goodSem(),
    factuality: { contentClass: "FICTION", expectation: {}, observations: {} },
    continuity: over.continuity || goodCont(),
  });
}

function units() {
  return [
    { unitId: "unit-B", shotId: "SHOT-B", assetIds: ["as-b-01"] },
    { unitId: "unit-C", shotId: "SHOT-C", assetIds: ["as-c-01"] },
    { unitId: "unit-D1", shotId: "SHOT-D1", assetIds: ["as-d1"] },
    { unitId: "unit-D2", shotId: "SHOT-D2", assetIds: ["as-d2"] },
    { unitId: "unit-D3", shotId: "SHOT-D3", assetIds: ["as-d3"] },
  ];
}

function budgetPlan() {
  const plan = {
    units: units().map((u) => ({ unitId: u.unitId })),
    summary: {
      estimatedImages: 0, estimatedVeoShots: 5, estimatedVariants: 0,
      estimatedCredits: { state: "EXACT", knownCredits: 50, exactTotalCredits: 50, unknownUnitCount: 0 },
    },
    fingerprint: "fp-test",
    projectId: "p1",
  };
  const r = outputCost.buildBudgetPlan({
    projectId: "p1",
    scopeId: "1g12",
    hardBudget: { unit: "CREDITS", limit: 100, source: "operator" },
    outputPlan: plan,
    retryPolicies: {
      "unit-B": { maxAdditionalAttempts: 1, reservedCredits: 10 },
      "unit-C": { maxAdditionalAttempts: 1, reservedCredits: 10 },
      "unit-D2": { maxAdditionalAttempts: 1, reservedCredits: 10 },
    },
  });
  if (!r.ok) throw new Error("budget fixture invalid: " + JSON.stringify(r));
  return r.budgetPlan;
}

async function main() {
  await runTest("R1 Case-B wrong motion → only B unit retry requested", () => {
    const bad = goodSem();
    bad.observation = { ...bad.observation, actions: ["sits still"] };
    const qr = qa.evaluateAssetQa({
      projectId: "p1", assetId: "as-b-01", assetHash: "a".repeat(64), shotId: "SHOT-B",
      fingerprintDeps: { assetId: "as-b-01", assetHash: "a".repeat(64) },
      structural: pngInput(), semantic: bad,
      factuality: { contentClass: "FICTION", expectation: {}, observations: {} },
      continuity: goodCont(),
    });
    const s = e2e.scopeRetry({ caseId: "B", qaResult: qr, generationUnits: units() });
    assert(s.ok === true, "scope resolves");
    assert(JSON.stringify(s.affectedUnitIds) === JSON.stringify(["unit-B"]), "only unit-B affected");
    assert(s.unaffectedUnitIds.length === 4, "C/D units untouched");
    assert(s.newAssetRequired === true, "replacement mints a new asset");
  });

  await runTest("R2 Case-C wrong end state → only C asset retry requested", () => {
    const qr = qaResultFor({ assetId: "as-c-01", shotId: "SHOT-C" });
    // Force an end-state FAIL through continuity expectation.
    const qr2 = qa.evaluateAssetQa({
      projectId: "p1", assetId: "as-c-01", assetHash: "a".repeat(64), shotId: "SHOT-C",
      fingerprintDeps: { assetId: "as-c-01", assetHash: "a".repeat(64) },
      structural: pngInput(), semantic: goodSem(),
      factuality: { contentClass: "FICTION", expectation: {}, observations: {} },
      continuity: {
        sources: { continuityStrictness: "NORMAL" },
        expectation: { characterId: "HOST_A", endState: "door-open" },
        observation: { source: "MANUAL_REVIEW", identity: "HOST_A", endState: "door-closed" },
      },
    });
    assert(qr2.aggregate.status === "REJECTED", "end-state FAIL rejects (precondition)");
    void qr;
    const s = e2e.scopeRetry({ caseId: "C", qaResult: qr2, generationUnits: units() });
    assert(s.ok === true && JSON.stringify(s.affectedUnitIds) === JSON.stringify(["unit-C"]), "only unit-C affected");
    assert(s.failureClass === "QA_START_END_STATE", "failure class identifies start/end state");
  });

  await runTest("R3 D2 wrong outfit → D1/D3 stay valid, D2 retry only", () => {
    const bad = goodCont("HOST_A");
    bad.observation = { ...bad.observation, clothing: "red jacket" };
    const qr = qaResultFor({ assetId: "as-d2", shotId: "SHOT-D2", continuity: bad });
    assert(qr.aggregate.status === "REJECTED", "outfit FAIL rejects (precondition)");
    const s = e2e.scopeRetry({ caseId: "D", qaResult: qr, generationUnits: units() });
    assert(s.ok === true && JSON.stringify(s.affectedUnitIds) === JSON.stringify(["unit-D2"]), "only unit-D2 affected");
    assert(s.unaffectedUnitIds.includes("unit-D1") && s.unaffectedUnitIds.includes("unit-D3"), "D1/D3 stay valid");
    assert(s.failureClass === "QA_CONTINUITY_OUTFIT", "outfit failure class");
  });

  await runTest("R4 hard budget exhausted → retry blocked", () => {
    const qr = qaResultFor({ assetId: "as-b-01", shotId: "SHOT-B" });
    // Make it fail: wrong subject.
    const bad = goodSem();
    bad.observation = { ...bad.observation, subjects: ["stranger"] };
    const qrFail = qa.evaluateAssetQa({
      projectId: "p1", assetId: "as-b-01", assetHash: "a".repeat(64), shotId: "SHOT-B",
      fingerprintDeps: { assetId: "as-b-01", assetHash: "a".repeat(64) },
      structural: pngInput(), semantic: bad,
      factuality: { contentClass: "FICTION", expectation: {}, observations: {} },
      continuity: goodCont(),
    });
    const s = e2e.scopeRetry({ caseId: "B", qaResult: qrFail, generationUnits: units() });
    assert(s.ok === true, "scope resolves (precondition)");
    void qr;
    const verdict = e2e.authorizeScopedRetry({
      budgetPlan: budgetPlan(),
      ledger: { creditsObserved: 100, committed: 0 },
      scope: s,
      priorAttemptId: "att-b-1",
      attemptIndex: 1,
    });
    assert(verdict.state === "BLOCKED_RETRY_BUDGET_EXCEEDED", "exhausted budget blocks retry, got " + verdict.state);
  });

  await runTest("R4b funded retry passes the gate for the affected unit only", () => {
    const bad = goodSem();
    bad.observation = { ...bad.observation, subjects: ["stranger"] };
    const qrFail = qa.evaluateAssetQa({
      projectId: "p1", assetId: "as-b-01", assetHash: "a".repeat(64), shotId: "SHOT-B",
      fingerprintDeps: { assetId: "as-b-01", assetHash: "a".repeat(64) },
      structural: pngInput(), semantic: bad,
      factuality: { contentClass: "FICTION", expectation: {}, observations: {} },
      continuity: goodCont(),
    });
    const s = e2e.scopeRetry({ caseId: "B", qaResult: qrFail, generationUnits: units() });
    const verdict = e2e.authorizeScopedRetry({
      budgetPlan: budgetPlan(),
      ledger: { creditsObserved: 10, committed: 0 },
      scope: s,
      priorAttemptId: "att-b-1",
      attemptIndex: 1,
    });
    assert(["APPROVED", "AUTHORIZED", "ALLOWED"].includes(verdict.state) || /APPROV|AUTHOR/.test(verdict.state), "funded retry authorized, got " + verdict.state);
  });

  await runTest("R5 failed retry history preserved (lineage required)", () => {
    const verdict = outputCost.authorizeRetry({
      budgetPlan: budgetPlan(), ledger: { creditsObserved: 0, committed: 0 },
      unitGroup: "unit-B", failureClass: "QA_SEMANTIC", priorAttemptId: null, attemptIndex: 1,
    });
    assert(verdict.state === "BLOCKED", "retry without prior-attempt lineage is refused");
    assert(verdict.reasons.some((x) => /LINEAGE/.test(x)), "lineage reason recorded");
  });

  await runTest("R6/R7 replacement lineage + failed asset immutability", () => {
    const bad = goodCont("HOST_A");
    bad.observation = { ...bad.observation, clothing: "red jacket" };
    const qr = qaResultFor({ assetId: "as-d2", shotId: "SHOT-D2", continuity: bad });
    const frozenUnits = Object.freeze(units().map((u) => Object.freeze({ ...u, assetIds: Object.freeze([...u.assetIds]) })));
    const frozenQr = JSON.parse(JSON.stringify(qr));
    Object.freeze(frozenQr);
    const s = e2e.scopeRetry({ caseId: "D", qaResult: frozenQr, generationUnits: frozenUnits });
    assert(s.ok === true, "scope resolves over frozen inputs (no mutation)");
    assert(s.priorRefs.qaResultId === qr.qaResultId, "prior QA ref carried for lineage");
    assert(s.newAssetRequired === true, "replacement = new asset, old failed bytes stay historical");
  });

  await runTest("R8 QA reruns only affected asset/context", () => {
    const bad = goodCont("HOST_A");
    bad.observation = { ...bad.observation, clothing: "red jacket" };
    const qr = qaResultFor({ assetId: "as-d2", shotId: "SHOT-D2", continuity: bad });
    const s = e2e.scopeRetry({ caseId: "D", qaResult: qr, generationUnits: units() });
    assert(JSON.stringify(s.failedAssetIds) === JSON.stringify(["as-d2"]), "rerun scoped to the failed asset");
    assert(JSON.stringify(s.failedShotIds) === JSON.stringify(["SHOT-D2"]), "rerun scoped to the failed shot");
  });

  console.log(`\n=== DONE: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(`FATAL: ${(e && e.stack) || e}`);
  process.exit(1);
});
