"use strict";

/**
 * Sufficiency gate tests S1-S10 (Prompt 03, 1G.1L).
 * Deterministic fixtures. No network.
 */

const reg = require("../../lib/research-evidence/source-registry.js");
const ind = require("../../lib/research-evidence/independence.js");
const ledger = require("../../lib/research-evidence/claim-ledger.js");
const ver = require("../../lib/research-evidence/verification.js");
const ctr = require("../../lib/research-evidence/contradictions.js");
const suf = require("../../lib/research-evidence/sufficiency.js");
const fx = require("../fixtures/evidence-fixtures.js");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
  console.log(`  ✓ ${message}`);
  passed++;
}

function runTest(name, fn) {
  console.log(`\n[TEST] ${name}`);
  return Promise.resolve().then(fn)
    .then(() => console.log(`[PASS] ${name}`))
    .catch((e) => { console.log(`[FAIL] ${name}: ${e.message}`); failed++; });
}

const PLAN = {
  projectId: "ps", topic: "HTTP 308 semantics",
  criticalQuestions: ["Does 308 preserve method?", "Which RFC standardizes 308?"],
  sourcePriority: ["OFFICIAL", "reputable secondary"],
  researchBudget: "maxQueries:12; maxSources:20",
  freshnessRequirement: "EVERGREEN_OK",
};

function twoIndependent() {
  const index = reg.emptyIndex("ps");
  const a = reg.registerSource(index, { acquiredDocument: fx.makeDoc("https://a.example/preserve", fx.BODY_PRESERVE, { metadata: { publisher: "Ref Alpha" } }) }).record;
  const d = reg.registerSource(index, { acquiredDocument: fx.makeDoc("https://d.example/other", fx.BODY_D, { metadata: { publisher: "Net Journal" } }) }).record;
  ind.evaluateIndependence([a, d], { [a.sourceId]: fx.BODY_PRESERVE, [d.sourceId]: fx.BODY_D });
  return { index, a, d };
}

function answerBoth(led, index, a, d) {
  ledger.upsertClaim(led, {
    claim: "HTTP 308 requires method preservation.", claimClass: "SUPPORTED_FACT",
    evidenceStatus: "SUPPORTED", materiality: "critical", researchQuestionIds: ["q0"],
    evidence: [
      { sourceId: a.sourceId, contentHash: a.contentHash, excerpt: "requires clients to preserve the original request method" },
      { sourceId: d.sourceId, contentHash: d.contentHash, excerpt: "method stays PUT or POST exactly as sent" },
    ],
  }, index);
  ledger.upsertClaim(led, {
    claim: "Minor RFC detail.", claimClass: "SUPPORTED_FACT",
    evidenceStatus: "SUPPORTED", materiality: "low", researchQuestionIds: ["q1"],
    evidence: [{ sourceId: a.sourceId, contentHash: a.contentHash, excerpt: "standardizing detail excerpt" }],
  }, index);
  ver.verifyLedger(led, index.sources);
}

async function main() {
  console.log("=== SUFFICIENCY TESTS (S1-S10) ===\n");

  await runTest("S1 all critical + adequate evidence -> SUFFICIENT", async () => {
    const { index, a, d } = twoIndependent();
    const led = ledger.emptyLedger();
    answerBoth(led, index, a, d);
    const e = suf.evaluateSufficiency({ plan: PLAN, ledger: led, records: index.sources, store: { contradictions: [], unknowns: [] }, budgetSpent: { sources: 2, queries: 2 } });
    assert(e.decision === "SUFFICIENT", `SUFFICIENT (${e.rationale})`);
    assert(typeof e.rationale === "string" && e.rationale.length > 0, "rationale present");
    assert(e.policyVersion === "evidence-policy-1.0.0", "policy version recorded");
  });

  await runTest("S2 missing critical answer -> NEEDS_MORE_RESEARCH", async () => {
    const { index, a } = twoIndependent();
    const led = ledger.emptyLedger();
    ledger.upsertClaim(led, {
      claim: "Only q0 answered.", claimClass: "SUPPORTED_FACT", evidenceStatus: "SUPPORTED",
      materiality: "medium", researchQuestionIds: ["q0"],
      evidence: [{ sourceId: a.sourceId, contentHash: a.contentHash, excerpt: "requires clients to preserve" }],
    }, index);
    ver.verifyLedger(led, index.sources);
    const e = suf.evaluateSufficiency({ plan: PLAN, ledger: led, records: index.sources, store: { contradictions: [], unknowns: [] } });
    assert(e.decision === "NEEDS_MORE_RESEARCH", `open question gates (${e.decision})`);
    assert((e.gaps.missingQuestions || []).length === 1, "missingQuestions names q1");
    assert((e.gaps.recommendedQueries || []).length === 1, "recommendedQueries targeted");
    assert(Array.isArray(e.gaps.recommendedSourceTypes) && e.gaps.recommendedSourceTypes.length > 0, "recommendedSourceTypes from plan");
  });

  await runTest("S3 weak high-impact claim -> NEEDS_MORE_RESEARCH", async () => {
    const { index, a, d } = twoIndependent();
    const led = ledger.emptyLedger();
    answerBoth(led, index, a, d);
    ledger.upsertClaim(led, {
      claim: "Weak but high-impact assertion.", claimClass: "SUPPORTED_FACT", evidenceStatus: "WEAK",
      materiality: "high", researchQuestionIds: ["q0"],
      evidence: [{ sourceId: a.sourceId, contentHash: a.contentHash, excerpt: "weak excerpt text here" }],
    }, index);
    ver.verifyLedger(led, index.sources);
    const e = suf.evaluateSufficiency({ plan: PLAN, ledger: led, records: index.sources, store: { contradictions: [], unknowns: [] } });
    assert(e.decision === "NEEDS_MORE_RESEARCH", "weak high-impact blocks");
    assert((e.gaps.weakClaims || []).length === 1, "weakClaims named");
  });

  await runTest("S4 copy-chain-only corroboration is NOT sufficient", async () => {
    const index = reg.emptyIndex("ps");
    const recs = ["https://a.example/1", "https://b.example/2"].map((u) =>
      reg.registerSource(index, { acquiredDocument: fx.makeDoc(u, fx.BODY_A) }).record
    );
    const bodies = { [recs[0].sourceId]: fx.BODY_A, [recs[1].sourceId]: fx.BODY_B };
    ind.evaluateIndependence(recs, bodies);
    const led = ledger.emptyLedger();
    ledger.upsertClaim(led, {
      claim: "Critical fact from chain.", claimClass: "SUPPORTED_FACT", evidenceStatus: "SUPPORTED",
      materiality: "critical", researchQuestionIds: ["q0", "q1"],
      evidence: recs.map((s) => ({ sourceId: s.sourceId, contentHash: s.contentHash, excerpt: "preserve the original request method" })),
    }, index);
    ver.verifyLedger(led, index.sources);
    const e = suf.evaluateSufficiency({ plan: PLAN, ledger: led, records: index.sources, store: { contradictions: [], unknowns: [] } });
    assert(e.decision === "NEEDS_MORE_RESEARCH", `chain of 2 URLs != corroborated (${e.decision})`);
  });

  await runTest("S5 blocking contradiction -> NEEDS_MORE_RESEARCH/BLOCKED", async () => {
    const { index, a, d } = twoIndependent();
    const led = ledger.emptyLedger();
    answerBoth(led, index, a, d);
    const c1 = ledger.upsertClaim(led, {
      claim: "Claim one.", claimClass: "SUPPORTED_FACT", evidenceStatus: "SUPPORTED",
      materiality: "critical", researchQuestionIds: ["q0"],
      evidence: [{ sourceId: a.sourceId, contentHash: a.contentHash, excerpt: "requires clients to preserve" }],
    }, index).record;
    const c2 = ledger.upsertClaim(led, {
      claim: "Claim two opposite.", claimClass: "CONTESTED", evidenceStatus: "MIXED",
      materiality: "critical", researchQuestionIds: ["q0"],
      evidence: [{ sourceId: d.sourceId, contentHash: d.contentHash, excerpt: "method stays PUT or POST" }],
    }, index).record;
    const store = { contradictions: [], unknowns: [] };
    ctr.recordContradiction(store, {
      claimIds: [c1.claimId, c2.claimId], sourceIds: [a.sourceId, d.sourceId],
      description: "Direct opposition on method rule.", materiality: "critical", status: "BLOCKING",
    });
    const e = suf.evaluateSufficiency({ plan: PLAN, ledger: led, records: index.sources, store });
    assert(["NEEDS_MORE_RESEARCH", "BLOCKED"].includes(e.decision), `blocking dispute gates (${e.decision})`);
  });

  await runTest("S6 critical source inaccessible + budget exhausted -> BLOCKED", async () => {
    const e = suf.evaluateSufficiency({
      plan: PLAN, ledger: ledger.emptyLedger(), records: [],
      store: { contradictions: [], unknowns: [] },
      budgetSpent: { sources: 20, queries: 12 },
      failures: [{ questionId: "q0", blocker: "critical official source AUTH_REQUIRED without authorized access" }],
    });
    assert(e.decision === "BLOCKED", `exact blocker preserved (${e.decision})`);
    assert(typeof e.blocker === "string" && e.blocker.includes("AUTH_REQUIRED"), "blocker text exact");
  });

  await runTest("S7 stale current-state source is not sufficient", async () => {
    const index = reg.emptyIndex("ps");
    const old = fx.makeDoc("https://a.example/old", fx.BODY_PRESERVE, { retrievedAt: "2024-01-01T00:00:00.000Z" });
    const a = reg.registerSource(index, { acquiredDocument: old }).record;
    a.independenceStatus = "INDEPENDENT";
    const fresh = fx.makeDoc("https://d.example/new", fx.BODY_D, { retrievedAt: "2026-10-01T00:00:00.000Z" });
    const d = reg.registerSource(index, { acquiredDocument: fresh }).record;
    d.independenceStatus = "INDEPENDENT";
    const led = ledger.emptyLedger();
    ledger.upsertClaim(led, {
      claim: "Current-state claim on old evidence.", claimClass: "SUPPORTED_FACT", evidenceStatus: "SUPPORTED",
      materiality: "high", researchQuestionIds: ["q0"],
      evidence: [
        { sourceId: a.sourceId, contentHash: a.contentHash, excerpt: "requires clients to preserve" },
        { sourceId: d.sourceId, contentHash: d.contentHash, excerpt: "method stays PUT or POST" },
      ],
    }, index);
    ledger.upsertClaim(led, {
      claim: "Minor detail.", claimClass: "SUPPORTED_FACT", evidenceStatus: "SUPPORTED",
      materiality: "low", researchQuestionIds: ["q1"],
      evidence: [{ sourceId: d.sourceId, contentHash: d.contentHash, excerpt: "minor excerpt" }],
    }, index);
    ver.verifyLedger(led, index.sources);
    const e = suf.evaluateSufficiency({
      plan: { ...PLAN, criticalQuestions: ["What is the current method rule?", "Which RFC standardizes 308?"] },
      ledger: led, records: index.sources, store: { contradictions: [], unknowns: [] },
      now: Date.parse("2026-10-02T00:00:00.000Z"),
    });
    assert(e.decision === "NEEDS_MORE_RESEARCH", `stale current-state evidence gates (${e.decision})`);
    assert((e.gaps.staleSources || []).length > 0, "staleSources named");
  });

  await runTest("S8 evergreen primary historical source may be sufficient", async () => {
    const index = reg.emptyIndex("ps");
    const old = fx.makeDoc("https://www.ietf.org/old-rfc", fx.BODY_PRESERVE, { retrievedAt: "2015-04-01T00:00:00.000Z" });
    const p = reg.registerSource(index, { acquiredDocument: old, officialDomains: ["ietf.org"] }).record;
    p.independenceStatus = "INDEPENDENT";
    const led = ledger.emptyLedger();
    ledger.upsertClaim(led, {
      claim: "Historical standard fact.", claimClass: "SUPPORTED_FACT", evidenceStatus: "SUPPORTED",
      materiality: "critical", researchQuestionIds: ["q0", "q1"],
      evidence: [{ sourceId: p.sourceId, contentHash: p.contentHash, excerpt: "requires clients to preserve" }],
    }, index);
    ver.verifyLedger(led, index.sources);
    const e = suf.evaluateSufficiency({
      plan: PLAN, ledger: led, records: index.sources, store: { contradictions: [], unknowns: [] },
      now: Date.parse("2026-10-02T00:00:00.000Z"),
    });
    assert(e.decision === "SUFFICIENT", `old primary evergreen source suffices (${e.decision})`);
  });

  await runTest("S9 optional unknown remains -> can still be SUFFICIENT", async () => {
    const { index, a, d } = twoIndependent();
    const led = ledger.emptyLedger();
    answerBoth(led, index, a, d);
    const store = { contradictions: [], unknowns: [] };
    ctr.recordUnknown(store, { description: "Trivia.", materiality: "non-material" });
    const e = suf.evaluateSufficiency({ plan: PLAN, ledger: led, records: index.sources, store, budgetSpent: { sources: 2, queries: 2 } });
    assert(e.decision === "SUFFICIENT", "non-material unknown tolerated");
  });

  await runTest("S10 budget exhausted with material gap -> BLOCKED", async () => {
    const { index, a } = twoIndependent();
    const led = ledger.emptyLedger();
    ledger.upsertClaim(led, {
      claim: "Partial answer.", claimClass: "SUPPORTED_FACT", evidenceStatus: "SUPPORTED",
      materiality: "medium", researchQuestionIds: ["q0"],
      evidence: [{ sourceId: a.sourceId, contentHash: a.contentHash, excerpt: "requires clients to preserve" }],
    }, index);
    ver.verifyLedger(led, index.sources);
    const e = suf.evaluateSufficiency({
      plan: PLAN, ledger: led, records: index.sources, store: { contradictions: [], unknowns: [] },
      budgetSpent: { sources: 20, queries: 12 },
    });
    assert(e.decision === "BLOCKED", `exhausted budget + gap = BLOCKED, never silent SUFFICIENT (${e.decision})`);
    assert(typeof e.blocker === "string" && e.blocker.includes("budget exhausted"), "blocker names budget");
  });

  console.log(`\n=== SUMMARY ===`);
  console.log(`Passed assertions: ${passed}, Failed tests: ${failed}`);
  if (failed > 0) { console.log("RESULT: SOME TESTS FAILED"); process.exit(1); }
  console.log("RESULT: ALL TESTS PASSED");
}

main().catch((e) => { console.log(`[FAIL] harness: ${e.message}`); process.exit(1); });
