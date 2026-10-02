"use strict";

/**
 * Contradiction (C1-C5) + Unknown (U1-U3) tests (Prompt 03, 1G.1K).
 * Deterministic fixtures. No network.
 */

const reg = require("../../lib/research-evidence/source-registry.js");
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

function setupDispute() {
  const index = reg.emptyIndex("pd");
  const s1 = reg.registerSource(index, { acquiredDocument: fx.makeDoc("https://a.example/preserve", fx.BODY_PRESERVE, { metadata: { publisher: "Ref Alpha" } }) }).record;
  const s2 = reg.registerSource(index, { acquiredDocument: fx.makeDoc("https://b.example/rewrite", fx.BODY_REWRITE, { metadata: { publisher: "Ref Beta" } }) }).record;
  s1.independenceStatus = "INDEPENDENT";
  s2.independenceStatus = "INDEPENDENT";
  const led = ledger.emptyLedger();
  const c1 = ledger.upsertClaim(led, {
    claim: "HTTP 308 requires clients to preserve method and body.", claimClass: "SUPPORTED_FACT",
    evidenceStatus: "SUPPORTED", materiality: "critical", researchQuestionIds: ["q0"],
    evidence: [{ sourceId: s1.sourceId, contentHash: s1.contentHash, excerpt: "requires clients to preserve the original request method" }],
  }, index).record;
  const c2 = ledger.upsertClaim(led, {
    claim: "HTTP 308 allows clients to rewrite POST to GET.", claimClass: "CONTESTED",
    evidenceStatus: "MIXED", materiality: "critical", researchQuestionIds: ["q0"],
    evidence: [{ sourceId: s2.sourceId, contentHash: s2.contentHash, excerpt: "allows clients to rewrite the request method to GET" }],
  }, index).record;
  c1.contradictingEvidence.push({ sourceId: s2.sourceId, contentHash: s2.contentHash, locator: null, excerpt: "allows clients to rewrite the request method to GET" });
  return { index, led, c1, c2, s1, s2 };
}

const PLAN = {
  projectId: "pd", topic: "HTTP 308 semantics",
  criticalQuestions: ["Does 308 preserve method?", "Which RFC standardizes 308?"],
  sourcePriority: ["OFFICIAL", "reputable secondary"],
  researchBudget: "maxQueries:12; maxSources:20",
  freshnessRequirement: "EVERGREEN_OK",
};

async function main() {
  console.log("=== CONTRADICTION + UNKNOWN TESTS ===\n");

  await runTest("C1 material conflict creates a record", async () => {
    const { c1, c2, s1, s2 } = setupDispute();
    const store = { contradictions: [], unknowns: [] };
    const r = ctr.recordContradiction(store, {
      claimIds: [c1.claimId, c2.claimId], sourceIds: [s1.sourceId, s2.sourceId],
      description: "Preserve-method vs rewrite-to-GET on 308.", materiality: "critical",
    });
    assert(r.ok && r.created && /^ctr-[0-9a-f]{12}$/.test(r.record.contradictionId), "contradiction recorded");
    assert(r.record.status === "OPEN", "starts OPEN");
  });

  await runTest("C2 contradiction cannot silently disappear", async () => {
    const { c1, c2, s1, s2 } = setupDispute();
    const store = { contradictions: [], unknowns: [] };
    const r1 = ctr.recordContradiction(store, {
      claimIds: [c1.claimId, c2.claimId], sourceIds: [s1.sourceId, s2.sourceId],
      description: "Preserve vs rewrite.", materiality: "critical",
    });
    const r2 = ctr.recordContradiction(store, {
      claimIds: [c2.claimId, c1.claimId], sourceIds: [s2.sourceId, s1.sourceId],
      description: "Preserve vs rewrite.", materiality: "critical",
    });
    assert(r2.deduplicated && store.contradictions.length === 1, "re-report deduplicates, never drops");
  });

  await runTest("C3 dramatic claim is never auto-preferred", async () => {
    const { c1, c2, s1, s2 } = setupDispute();
    const store = { contradictions: [], unknowns: [] };
    const rec = ctr.recordContradiction(store, {
      claimIds: [c1.claimId, c2.claimId], sourceIds: [s1.sourceId, s2.sourceId],
      description: "Preserve vs rewrite.", materiality: "critical",
    }).record;
    const weak = ctr.resolveContradiction(store, rec.contradictionId, {
      prevailingClaimId: c2.claimId, reason: "More dramatic.", evidenceNote: "none",
    });
    assert(!weak.ok, "short/dramatic reason rejected");
    const noCite = ctr.resolveContradiction(store, rec.contradictionId, {
      prevailingClaimId: c2.claimId,
      reason: "This longer reason still cites no evidence at all anywhere.",
    });
    assert(!noCite.ok, "resolution without evidence citation rejected");
    const good = ctr.resolveContradiction(store, rec.contradictionId, {
      prevailingClaimId: c1.claimId,
      reason: "RFC 7538 Section 3 mandates method preservation; two independent references agree.",
      evidenceNote: "RFC text + IETF reference both state preservation",
    });
    assert(good.ok && good.record.status === "RESOLVED_WITH_REASON", "evidenced resolution accepted");
  });

  await runTest("C4 critical unresolved contradiction affects sufficiency", async () => {
    const { index, led, c1, c2, s1, s2 } = setupDispute();
    ver.verifyLedger(led, index.sources);
    const store = { contradictions: [], unknowns: [] };
    ctr.recordContradiction(store, {
      claimIds: [c1.claimId, c2.claimId], sourceIds: [s1.sourceId, s2.sourceId],
      description: "Preserve vs rewrite.", materiality: "critical",
    });
    const eval1 = suf.evaluateSufficiency({ plan: PLAN, ledger: led, records: index.sources, store });
    assert(eval1.decision !== "SUFFICIENT", `open critical contradiction blocks SUFFICIENT (${eval1.decision})`);
    assert((eval1.gaps.unresolvedContradictions || []).length === 1, "gap names the contradiction");
  });

  await runTest("C5 non-critical contradiction can remain framed", async () => {
    const { index, led, c1, c2, s1, s2 } = setupDispute();
    // answer both questions with adequate independent claims first
    const ledFull = ledger.emptyLedger();
    for (const [q, src] of [["q0", s1], ["q1", s2]]) {
      ledger.upsertClaim(ledFull, {
        claim: `Settled answer for ${q}.`, claimClass: "SUPPORTED_FACT",
        evidenceStatus: "SUPPORTED", materiality: "medium", researchQuestionIds: [q],
        evidence: [{ sourceId: src.sourceId, contentHash: src.contentHash, excerpt: "settled excerpt text" }],
      }, index);
    }
    ver.verifyLedger(ledFull, index.sources);
    const store = { contradictions: [], unknowns: [] };
    const rec = ctr.recordContradiction(store, {
      claimIds: [c1.claimId, c2.claimId], sourceIds: [s1.sourceId, s2.sourceId],
      description: "Minor wording difference in non-material detail.", materiality: "non-critical",
    }).record;
    ctr.frameAsDisputed(store, rec.contradictionId);
    const e = suf.evaluateSufficiency({
      plan: PLAN, ledger: ledFull, records: index.sources, store,
      budgetSpent: { sources: 2, queries: 2 },
    });
    assert(e.decision === "SUFFICIENT", `framed non-critical dispute does not block (${e.decision})`);
  });

  await runTest("U1 unanswered critical question -> material unknown", async () => {
    const store = { contradictions: [], unknowns: [] };
    const r = ctr.recordUnknown(store, {
      researchQuestionId: "q1", description: "No source found for the standardizing RFC.",
      materiality: "critical", whyUnknown: "no accessible source in budget",
      recommendedAction: "targeted search: official RFC index",
    });
    assert(r.ok && /^unk-[0-9a-f]{12}$/.test(r.record.unknownId), "unknown recorded");
    const e = suf.evaluateSufficiency({ plan: PLAN, ledger: ledger.emptyLedger(), records: [], store });
    assert(e.decision === "NEEDS_MORE_RESEARCH", "open critical unknown prevents SUFFICIENT");
  });

  await runTest("U2 answered question settles the unknown", async () => {
    const store = { contradictions: [], unknowns: [] };
    const rec = ctr.recordUnknown(store, {
      researchQuestionId: "q1", description: "RFC unknown.", materiality: "material",
    }).record;
    const s = ctr.settleUnknown(store, rec.unknownId, "ANSWERED");
    assert(s.ok && s.record.status === "ANSWERED", "unknown settled");
    const bad = ctr.settleUnknown(store, rec.unknownId, "FORGOTTEN");
    assert(!bad.ok, "invalid settle status rejected");
  });

  await runTest("U3 non-material optional unknown does not block", async () => {
    const index = reg.emptyIndex("pd");
    const s1 = reg.registerSource(index, { acquiredDocument: fx.makeDoc("https://a.example/preserve", fx.BODY_PRESERVE, { metadata: { publisher: "Ref Alpha" } }) }).record;
    const wb = "Independent engineering notes confirm that HTTP 308 keeps the verb and payload intact across the redirect. Operators test this with curl to observe the repeated POST. Documentation from a second vendor repeats the same guarantee in different words for administrators.";
    const s3 = reg.registerSource(index, { acquiredDocument: fx.makeDoc("https://c.example/notes", wb, { metadata: { publisher: "Ref Gamma" } }) }).record;
    s1.independenceStatus = "INDEPENDENT";
    s3.independenceStatus = "INDEPENDENT";
    const ledFull = ledger.emptyLedger();
    ledger.upsertClaim(ledFull, {
      claim: "HTTP 308 requires clients to preserve method and body.", claimClass: "SUPPORTED_FACT",
      evidenceStatus: "SUPPORTED", materiality: "critical", researchQuestionIds: ["q0"],
      evidence: [
        { sourceId: s1.sourceId, contentHash: s1.contentHash, excerpt: "requires clients to preserve the original request method" },
        { sourceId: s3.sourceId, contentHash: s3.contentHash, excerpt: "keeps the verb and payload intact across the redirect" },
      ],
    }, index);
    ledger.upsertClaim(ledFull, {
      claim: "RFC number detail.", claimClass: "SUPPORTED_FACT",
      evidenceStatus: "SUPPORTED", materiality: "low", researchQuestionIds: ["q1"],
      evidence: [{ sourceId: s1.sourceId, contentHash: s1.contentHash, excerpt: "standardizing detail excerpt" }],
    }, index);
    ver.verifyLedger(ledFull, index.sources);
    const store = { contradictions: [], unknowns: [] };
    ctr.recordUnknown(store, { description: "Trivia: original draft author nickname.", materiality: "non-material" });
    const e = suf.evaluateSufficiency({ plan: PLAN, ledger: ledFull, records: index.sources, store, budgetSpent: { sources: 2, queries: 2 } });
    assert(e.decision === "SUFFICIENT", `optional unknown does not block SUFFICIENT (${e.decision}: ${e.rationale})`);
  });

  console.log(`\n=== SUMMARY ===`);
  console.log(`Passed assertions: ${passed}, Failed tests: ${failed}`);
  if (failed > 0) { console.log("RESULT: SOME TESTS FAILED"); process.exit(1); }
  console.log("RESULT: ALL TESTS PASSED");
}

main().catch((e) => { console.log(`[FAIL] harness: ${e.message}`); process.exit(1); });
