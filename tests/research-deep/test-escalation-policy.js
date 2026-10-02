"use strict";

/**
 * Deep escalation policy tests EP1-EP8 (PHASE 1G.1 Prompt 05, §75).
 * Deterministic. No network, no provider, no paid calls.
 */

const policy = require("../../lib/research-deep/escalation-policy.js");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
  console.log(`  ✓ ${message}`);
  passed++;
}

function base(over = {}) {
  return {
    contentClass: "FACTUAL",
    researchRequired: "REQUIRED",
    sufficiencyDecision: "NEEDS_MORE_RESEARCH",
    standardAttempted: true,
    materialGap: true,
    gapSolvable: true,
    deepAllowed: true,
    budgetRemaining: true,
    escalationsUsed: 0,
    maxDeepEscalations: 1,
    providerAvailable: true,
    reasonCodes: ["CRITICAL_QUESTIONS_UNANSWERED"],
    ...over,
  };
}

async function main() {
  console.log("\n[TEST] EP1 STANDARD+SUFFICIENT stays standard");
  {
    const d = policy.decideEscalation(base({ sufficiencyDecision: "SUFFICIENT" }));
    assert(d.action === "STAY_STANDARD", `EP1 action is STAY_STANDARD (${d.action})`);
    assert(d.eligible === false, "EP1 not eligible");
  }

  console.log("\n[TEST] EP2 insufficient+allowed+solvable+budget escalates");
  {
    const d = policy.decideEscalation(base());
    assert(d.action === "ESCALATE_DEEP", `EP2 action is ESCALATE_DEEP (${d.action})`);
    assert(d.eligible === true, "EP2 eligible");
    assert(d.config.maxDeepEscalations === 1, "EP2 default maxDeepEscalations is 1");
  }

  console.log("\n[TEST] EP3 deepAllowed=false never escalates");
  {
    const d = policy.decideEscalation(base({ deepAllowed: false }));
    assert(d.action === "STAY_STANDARD", `EP3 stays standard (${d.action})`);
    assert(d.eligible === false, "EP3 not eligible");
  }

  console.log("\n[TEST] EP4 pure FICTION NOT_REQUIRED never escalates");
  {
    const d = policy.decideEscalation(base({
      contentClass: "FICTION", researchRequired: "NOT_REQUIRED",
      sufficiencyDecision: "NEEDS_MORE_RESEARCH",
    }));
    assert(d.action === "STAY_STANDARD", `EP4 stays standard (${d.action})`);
  }

  console.log("\n[TEST] EP5 BLOCKED by auth/access does not auto-DEEP");
  {
    const d = policy.decideEscalation(base({ sufficiencyDecision: "BLOCKED", blockedCode: "AUTH_REQUIRED" }));
    assert(d.action === "BLOCKED", `EP5 stays BLOCKED (${d.action})`);
    assert(d.eligible === false, "EP5 not eligible");
  }

  console.log("\n[TEST] EP6 budget exhausted never escalates");
  {
    const d = policy.decideEscalation(base({ budgetRemaining: false }));
    assert(d.action === "STAY_STANDARD", `EP6 stays standard (${d.action})`);
    assert(d.reasonCodes.includes("BUDGET_EXHAUSTED"), "EP6 names budget");
  }

  console.log("\n[TEST] EP7 provider unavailable preserves NEEDS_MORE_RESEARCH");
  {
    const d = policy.decideEscalation(base({ providerAvailable: false }));
    assert(d.action === "STAY_STANDARD", `EP7 stays standard (${d.action})`);
    assert(d.providerUnavailable === true, "EP7 flags provider unavailable");
  }

  console.log("\n[TEST] EP8 explicit DEEP still obeys safety/budget gates");
  {
    const denied = policy.decideEscalation(base({
      sufficiencyDecision: "SUFFICIENT", explicitDeepRequest: true, budgetRemaining: false,
    }));
    assert(denied.action !== "ESCALATE_DEEP", `EP8 budget denial holds even when explicit (${denied.action})`);
    const fiction = policy.decideEscalation({
      contentClass: "FICTION", researchRequired: "NOT_REQUIRED",
      sufficiencyDecision: "SUFFICIENT", explicitDeepRequest: true,
      deepAllowed: true, budgetRemaining: true, providerAvailable: true,
      standardAttempted: false, materialGap: false,
    });
    assert(fiction.action === "STAY_STANDARD", `EP8 fiction guard holds even when explicit (${fiction.action})`);
  }

  console.log("\n[TEST] max escalations respected + config clamped");
  {
    const d = policy.decideEscalation(base({ escalationsUsed: 1 }));
    assert(d.action === "STAY_STANDARD", `second escalation refused (${d.action})`);
    const c = policy.clampConfig({ maxBreadth: 99, maxDepth: 99, maxConcurrency: 99, maxQueries: 99, maxDurationMs: 999999999 });
    assert(c.maxBreadth <= 4 && c.maxDepth <= 2 && c.maxConcurrency <= 2, "bounds clamped to provider-safe maxima");
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Passed assertions: ${passed}, Failed tests: ${failed}`);
  if (failed > 0) { console.log("RESULT: SOME TESTS FAILED"); process.exit(1); }
  console.log("RESULT: ALL TESTS PASSED");
}

main().catch((e) => { console.log(`[FAIL] harness: ${e.message}`); process.exit(1); });
