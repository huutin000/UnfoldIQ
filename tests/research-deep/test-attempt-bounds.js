"use strict";

/**
 * Attempt-bound tests AB1-AB5 (PHASE 1G.1 Prompt 05, §78).
 * No network. Provider/acquisition are injected fakes.
 */

const deep = require("../../lib/research-deep/index.js");

let passed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
  console.log(`  ✓ ${message}`);
  passed++;
}

function ctx(over = {}) {
  return {
    escalationInput: {
      contentClass: "FACTUAL", researchRequired: "REQUIRED",
      sufficiencyDecision: "NEEDS_MORE_RESEARCH", standardAttempted: true,
      materialGap: true, gapSolvable: true, deepAllowed: true,
      budgetRemaining: true, escalationsUsed: 0, maxDeepEscalations: 1,
      providerAvailable: true, reasonCodes: ["STANDARD_SEARCH_EXHAUSTED"],
    },
    plan: { projectId: "p-bounds", topic: "bounded topic", researchGoal: "goal ".repeat(10), criticalQuestions: ["q1"] },
    gaps: { missingQuestions: ["q1"], recommendedQueries: ["q1"] },
    sourceIndex: { version: "1.0.0", projectId: "p-bounds", sources: [] },
    sufficiencyBefore: { decision: "NEEDS_MORE_RESEARCH" },
    requireLiveApproval: false,
    ...over,
  };
}

function fakeProvider(result) {
  let calls = 0;
  return {
    calls: () => calls,
    run: async () => { calls++; return { ok: true, result }; },
  };
}

async function main() {
  console.log("\n[TEST] AB1 maxDeepEscalations respected (no infinite loop)");
  {
    const prov = fakeProvider({ providerVersion: "t", status: "COMPLETED", candidateSources: [], warnings: [], errors: [] });
    const deps = {
      runProvider: prov.run,
      acquireUrl: async () => ({ ok: false, code: "SKIP" }),
      registerSource: () => ({ ok: false, code: "SKIP" }),
    };
    const first = await deep.runDeepEscalation(ctx(), deps);
    assert(first.decision.action === "ESCALATE_DEEP", "first escalation runs");
    const second = await deep.runDeepEscalation(ctx({ escalationInput: { ...ctx().escalationInput, escalationsUsed: 1 } }), deps);
    assert(second.decision.action === "STAY_STANDARD" && second.deepRunStatus === "NOT_RUN", "second escalation refused");
    assert(prov.calls() === 1, "provider ran exactly once across both attempts");
  }

  console.log("\n[TEST] AB2 query cap respected during reacquisition");
  {
    const many = Array.from({ length: 30 }, (_, i) => ({ url: `https://example.com/n${i}`, title: null, context: null }));
    let acquired = 0;
    const out = await deep.runDeepEscalation(ctx(), {
      runProvider: async () => ({ ok: true, result: { providerVersion: "t", status: "COMPLETED", candidateSources: many, warnings: [], errors: [] } }),
      acquireUrl: async () => { acquired++; return { ok: false, code: "SKIP" }; },
      registerSource: () => ({ ok: false, code: "SKIP" }),
    });
    assert(acquired <= 10, `reacquisition capped at maxQueries (saw ${acquired})`);
    assert(out.candidates.length <= 20, "candidate list itself bounded");
  }

  console.log("\n[TEST] AB3 timeout respected via config clamp");
  {
    const c = deep.policy.clampConfig({ maxDurationMs: 3600000 });
    assert(c.maxDurationMs <= 15 * 60 * 1000, "run timeout hard-capped at 15min");
    assert(deep.policy.LIVE_SMOKE_CONFIG.maxDurationMs <= 5 * 60 * 1000 + 60000, "smoke timeout stays small");
  }

  console.log("\n[TEST] AB4 concurrency respected via config clamp");
  {
    const c = deep.policy.clampConfig({ maxConcurrency: 64 });
    assert(c.maxConcurrency <= 2, `concurrency clamped (saw ${c.maxConcurrency})`);
  }

  console.log("\n[TEST] AB5 provider failure preserves STANDARD state, no corruption");
  {
    const before = { decision: "NEEDS_MORE_RESEARCH" };
    const out = await deep.runDeepEscalation(ctx({ sufficiencyBefore: before }), {
      runProvider: async () => ({ ok: false, code: "DEEP_PROVIDER_ERROR", error: "boom" }),
    });
    assert(out.sufficiencyAfter === before, "before-state preserved on provider failure");
    assert(out.deepRunStatus === "DEEP_PROVIDER_ERROR", "structured error status kept");
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Passed assertions: ${passed}, Failed tests: 0`);
  console.log("RESULT: ALL TESTS PASSED");
}

main().catch((e) => { console.log(`[FAIL] harness: ${e.message}`); process.exit(1); });
