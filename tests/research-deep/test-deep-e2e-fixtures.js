"use strict";

/**
 * Fixture E2E for STANDARD / DEEP escalation (§79-84).
 * Deterministic. No network, no paid calls. Provider + acquisition are
 * injected fakes; Source Registry, Independence, Claim Ledger,
 * Verification, Sufficiency, and Pack readiness are the REAL Prompt-02/03/04
 * modules, proving canonical reintegration and an unchanged Pack contract.
 */

const deep = require("../../lib/research-deep/index.js");
const registry = require("../../lib/research-evidence/source-registry.js");
const independence = require("../../lib/research-evidence/independence.js");
const ledgerLib = require("../../lib/research-evidence/claim-ledger.js");
const verification = require("../../lib/research-evidence/verification.js");
const contradictionsLib = require("../../lib/research-evidence/contradictions.js");
const sufficiency = require("../../lib/research-evidence/sufficiency.js");
const pack = require("../../lib/research-story/research-pack.js");
const fx = require("../fixtures/evidence-fixtures.js");

let passed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
  console.log(`  ✓ ${message}`);
  passed++;
}

const PLAN = {
  projectId: "p-deep-e2e", topic: "HTTP 308 semantics",
  researchGoal: "Establish documented 308 method-preservation semantics for a general audience video.",
  contentClass: "FACTUAL",
  criticalQuestions: ["Does 308 preserve method?"],
  sourcePriority: ["OFFICIAL", "reputable secondary"],
  researchBudget: "maxQueries:12; maxSources:20; maxDeepResearchEscalations:1; maxTimeMin:120",
  freshnessRequirement: "EVERGREEN_OK",
};

function escInput(over = {}) {
  return {
    contentClass: "FACTUAL", researchRequired: "REQUIRED",
    sufficiencyDecision: "NEEDS_MORE_RESEARCH", standardAttempted: true,
    materialGap: true, gapSolvable: true, deepAllowed: true,
    budgetRemaining: true, escalationsUsed: 0, maxDeepEscalations: 1,
    providerAvailable: true, reasonCodes: ["HIGH_IMPACT_CLAIM_WEAK"],
    ...over,
  };
}

/** STANDARD world: register docs, judge independence, attach one claim. */
function standardWorld(bodies) {
  const index = registry.emptyIndex("p-deep-e2e");
  const recs = bodies.map((b, i) =>
    registry.registerSource(index, { acquiredDocument: fx.makeDoc(`https://std.example/s${i}`, b.body) }).record
  );
  independence.evaluateIndependence(recs, Object.fromEntries(recs.map((r, i) => [r.sourceId, bodies[i].body])));
  const led = ledgerLib.emptyLedger();
  return { index, recs, led };
}

function answerQ0(led, index, recs) {
  ledgerLib.upsertClaim(led, {
    claim: "HTTP 308 requires method preservation.", claimClass: "SUPPORTED_FACT",
    evidenceStatus: "SUPPORTED", materiality: "critical", researchQuestionIds: ["q0"],
    evidence: recs.map((r) => ({
      sourceId: r.sourceId, contentHash: r.contentHash,
      excerpt: "requires clients to preserve the original request method",
    })),
  }, index);
  verification.verifyLedger(led, index.sources);
}

function evalSuf(led, index, store) {
  return sufficiency.evaluateSufficiency({
    plan: PLAN, ledger: led, records: index.sources,
    store: store || { contradictions: [], unknowns: [] },
    budgetSpent: { sources: index.sources.length, queries: 3 },
  });
}

async function main() {
  console.log("\n[TEST] F1 STANDARD remains default: SUFFICIENT never triggers DEEP");
  {
    const { index, recs, led } = standardWorld([{ body: fx.BODY_PRESERVE }, { body: fx.BODY_D }]);
    answerQ0(led, index, recs);
    const suf = evalSuf(led, index);
    assert(suf.decision === "SUFFICIENT", `STANDARD fixture is SUFFICIENT (${suf.decision})`);
    let providerCalls = 0;
    const out = await deep.runDeepEscalation({
      escalationInput: escInput({ sufficiencyDecision: "SUFFICIENT" }),
      plan: PLAN, gaps: {}, sourceIndex: index, sufficiencyBefore: suf, requireLiveApproval: false,
    }, { runProvider: async () => { providerCalls++; return { ok: true, result: {} }; } });
    assert(providerCalls === 0 && out.deepRunStatus === "NOT_RUN", "deep provider run count = 0");
  }

  console.log("\n[TEST] F2 escalation success: new independent source -> SUFFICIENT -> same Pack contract");
  {
    const { index, recs, led } = standardWorld([{ body: fx.BODY_PRESERVE }]);
    answerQ0(led, index, recs);
    const before = evalSuf(led, index);
    assert(before.decision === "NEEDS_MORE_RESEARCH", `one group is insufficient (${before.decision})`);
    const newUrl = "https://deep.example/independent-308-note";
    const out = await deep.runDeepEscalation({
      escalationInput: escInput(), plan: PLAN,
      gaps: { missingQuestions: PLAN.criticalQuestions, recommendedQueries: PLAN.criticalQuestions },
      sourceIndex: index, sufficiencyBefore: before, requireLiveApproval: false,
    }, {
      runProvider: async () => ({
        ok: true,
        result: {
          providerVersion: "fixture", status: "COMPLETED",
          candidateSources: [{ url: newUrl, title: "Independent 308 note", context: "deep lead" }],
          queries: ["308 method preservation"], learnings: [], warnings: [], errors: [],
        },
      }),
      acquireUrl: async (url) => ({ ok: true, document: fx.makeDoc(url, fx.BODY_D), url }),
      registerSource: (idx, input) => registry.registerSource(idx, input),
      evaluateSufficiency: ({ reacquiredRecords }) => {
        // New evidence attaches to the same claim, then the REAL gate reruns.
        const claim = led.claims[0];
        for (const r of reacquiredRecords) {
          claim.supportingEvidence.push({ sourceId: r.sourceId, contentHash: r.contentHash, excerpt: "method stays PUT or POST exactly as sent" });
        }
        independence.evaluateIndependence(index.sources,
          { [recs[0].sourceId]: fx.BODY_PRESERVE, [reacquiredRecords[0].sourceId]: fx.BODY_D });
        verification.verifyLedger(led, index.sources);
        return evalSuf(led, index);
      },
    });
    assert(out.reacquiredCount === 1, "one DEEP candidate canonically reacquired");
    assert(out.sufficiencyAfter.decision === "SUFFICIENT", `sufficiency re-evaluated to SUFFICIENT (${out.sufficiencyAfter.decision})`);
    assert(index.sources.length === 2, "same Source Registry holds STANDARD + DEEP sources");
    const readiness = pack.checkReadiness({ sufficiency: out.sufficiencyAfter, contentClass: "FACTUAL", researchRequired: "REQUIRED" });
    assert(readiness.ok === true && readiness.status === "SCRIPT_READY",
      "Prompt-04 Pack readiness accepts the post-DEEP SUFFICIENT state (contract unchanged)");
    assert(out.attemptRecord && out.attemptRecord.candidateUrlCount === 1, "attempt provenance recorded");
  }

  console.log("\n[TEST] F3 duplicates only: still NEEDS_MORE_RESEARCH, no false pass");
  {
    const { index, recs, led } = standardWorld([{ body: fx.BODY_PRESERVE }]);
    answerQ0(led, index, recs);
    const before = evalSuf(led, index);
    const out = await deep.runDeepEscalation({
      escalationInput: escInput(), plan: PLAN,
      gaps: { missingQuestions: PLAN.criticalQuestions, recommendedQueries: ["q"] },
      sourceIndex: index, sufficiencyBefore: before, requireLiveApproval: false,
    }, {
      runProvider: async () => ({
        ok: true,
        result: {
          providerVersion: "fixture", status: "COMPLETED",
          candidateSources: [{ url: "https://copy.example/syndicated", title: "copy", context: "lead" }],
          queries: ["q"], learnings: [], warnings: [], errors: [],
        },
      }),
      // DEEP found only an exact copy of the STANDARD body.
      acquireUrl: async (url) => ({ ok: true, document: fx.makeDoc(url, fx.BODY_PRESERVE), url }),
      registerSource: (idx, input) => registry.registerSource(idx, input),
      evaluateSufficiency: () => {
        independence.evaluateIndependence(index.sources,
          Object.fromEntries(index.sources.map((r) => [r.sourceId, fx.BODY_PRESERVE])));
        verification.verifyLedger(led, index.sources);
        return evalSuf(led, index);
      },
    });
    assert(out.sufficiencyAfter.decision === "NEEDS_MORE_RESEARCH",
      `duplicate DEEP bodies do not inflate corroboration (${out.sufficiencyAfter.decision})`);
  }

  console.log("\n[TEST] F4 DEEP contradiction: CONFLICTED, sufficiency re-evaluated, never auto-SUFFICIENT");
  {
    const { index, recs, led } = standardWorld([{ body: fx.BODY_PRESERVE }]);
    answerQ0(led, index, recs);
    const before = evalSuf(led, index);
    const contraUrl = "https://deep.example/rewrite-claim";
    const store = { contradictions: [], unknowns: [] };
    const out = await deep.runDeepEscalation({
      escalationInput: escInput(), plan: PLAN,
      gaps: { missingQuestions: PLAN.criticalQuestions, recommendedQueries: ["q"] },
      sourceIndex: index, sufficiencyBefore: before, requireLiveApproval: false,
    }, {
      runProvider: async () => ({
        ok: true,
        result: {
          providerVersion: "fixture", status: "COMPLETED",
          candidateSources: [{ url: contraUrl, title: "rewrite claim", context: "lead" }],
          queries: ["q"], learnings: [], warnings: [], errors: [],
        },
      }),
      acquireUrl: async (url) => ({ ok: true, document: fx.makeDoc(url, fx.BODY_REWRITE), url }),
      registerSource: (idx, input) => registry.registerSource(idx, input),
      evaluateSufficiency: ({ reacquiredRecords }) => {
        contradictionsLib.recordContradiction(store, {
          claimIds: [led.claims[0].claimId, "clm-deep-rival"],
          description: "DEEP source allows method rewrite; STANDARD requires preservation",
          sourceIds: [recs[0].sourceId, reacquiredRecords[0].sourceId], materiality: "critical",
        });
        verification.verifyLedger(led, index.sources);
        return evalSuf(led, index, store);
      },
    });
    assert(out.sufficiencyAfter.decision !== "SUFFICIENT",
      `contradiction blocks false SUFFICIENT (${out.sufficiencyAfter.decision})`);
    assert(store.contradictions.length === 1 && store.contradictions[0].status === "OPEN", "contradiction preserved OPEN");
  }

  console.log("\n[TEST] F5 provider failure: STANDARD artifacts preserved, structured error");
  {
    const { index, recs, led } = standardWorld([{ body: fx.BODY_PRESERVE }]);
    answerQ0(led, index, recs);
    const before = evalSuf(led, index);
    const sourcesBefore = index.sources.length;
    const out = await deep.runDeepEscalation({
      escalationInput: escInput(), plan: PLAN, gaps: {},
      sourceIndex: index, sufficiencyBefore: before, requireLiveApproval: false,
    }, { runProvider: async () => ({ ok: false, code: "DEEP_PROVIDER_ERROR", error: "crash" }) });
    assert(out.sufficiencyAfter === before, "STANDARD sufficiency object preserved");
    assert(index.sources.length === sourcesBefore, "no evidence corrupted on provider crash");
  }

  console.log("\n[TEST] F6 FICTION + NOT_REQUIRED never invokes DEEP");
  {
    let providerCalls = 0;
    const out = await deep.runDeepEscalation({
      escalationInput: {
        contentClass: "FICTION", researchRequired: "NOT_REQUIRED",
        sufficiencyDecision: "NEEDS_MORE_RESEARCH", standardAttempted: false,
        materialGap: false, deepAllowed: true, budgetRemaining: true,
        escalationsUsed: 0, maxDeepEscalations: 1, providerAvailable: true,
      },
      plan: { projectId: "p-fic", topic: "invented tale", researchGoal: "n/a" },
      gaps: {}, sourceIndex: { version: "1.0.0", projectId: "p-fic", sources: [] },
      requireLiveApproval: false,
    }, { runProvider: async () => { providerCalls++; return { ok: true, result: {} }; } });
    assert(providerCalls === 0 && out.deepRunStatus === "NOT_RUN", "DEEP never invoked for pure fiction");
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Passed assertions: ${passed}, Failed tests: 0`);
  console.log("RESULT: ALL TESTS PASSED");
}

main().catch((e) => { console.log(`[FAIL] harness: ${e.message}`); process.exit(1); });
