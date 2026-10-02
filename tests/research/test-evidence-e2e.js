"use strict";

/**
 * Fixture end-to-end tests (Prompt 03 §59-§61): copy-chain invariant,
 * contradiction handling, and the targeted NEEDS_MORE_RESEARCH loop.
 * Full wiring: registry -> independence -> ledger -> verification ->
 * contradictions/unknowns -> sufficiency -> persist/reload. No network.
 */

const os = require("os");
const path = require("path");
const fs = require("fs");
const reg = require("../../lib/research-evidence/source-registry.js");
const ind = require("../../lib/research-evidence/independence.js");
const ax = require("../../lib/research-evidence/analysis-exchange.js");
const ledger = require("../../lib/research-evidence/claim-ledger.js");
const ver = require("../../lib/research-evidence/verification.js");
const ctr = require("../../lib/research-evidence/contradictions.js");
const suf = require("../../lib/research-evidence/sufficiency.js");
const evstore = require("../../lib/research-evidence/evidence-store.js");
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
  projectId: "pe2e", topic: "HTTP 308 semantics",
  criticalQuestions: ["Does 308 preserve method?", "Which RFC standardizes 308?"],
  sourcePriority: ["OFFICIAL", "reputable secondary"],
  researchBudget: "maxQueries:12; maxSources:20",
  freshnessRequirement: "EVERGREEN_OK",
};

function registerAll(index, entries) {
  const bodies = {};
  const recs = entries.map(([url, body, publisher]) => {
    const rec = reg.registerSource(index, {
      acquiredDocument: fx.makeDoc(url, body, { metadata: publisher ? { publisher } : {} }),
    }).record;
    bodies[rec.sourceId] = body;
    return rec;
  });
  return { recs, bodies };
}

async function main() {
  console.log("=== EVIDENCE E2E TESTS ===\n");

  await runTest("E2E-1 copy chain: 3 URLs -> 1 origin, NOT multi-source", async () => {
    const index = reg.emptyIndex("pe2e");
    const { recs, bodies } = registerAll(index, [
      ["https://a.example/orig", fx.BODY_A, "City Gazette"],
      ["https://b.example/copy", fx.BODY_B, "Metro Mirror"],
      ["https://c.example/rewrite", fx.BODY_C, "Metro Mirror"],
    ]);
    const decisions = ind.evaluateIndependence(recs, bodies);
    assert(decisions.length === 3, "3 pairwise judgements");
    assert(ind.countIndependentGroups(recs, recs.map((r) => r.sourceId)) <= 1, "at most 1 independent group");
    const led = ledger.emptyLedger();
    ledger.upsertClaim(led, {
      claim: "HTTP 308 requires method preservation.", claimClass: "SUPPORTED_FACT",
      evidenceStatus: "SUPPORTED", materiality: "critical", researchQuestionIds: ["q0", "q1"],
      evidence: recs.map((s) => ({ sourceId: s.sourceId, contentHash: s.contentHash, excerpt: "preserve the original request method" })),
    }, index);
    const results = ver.verifyLedger(led, index.sources);
    assert(results[0].corroborationStatus !== "MULTI_SOURCE_CONFIRMED", `chain cannot confirm (${results[0].corroborationStatus})`);
    const e = suf.evaluateSufficiency({ plan: PLAN, ledger: led, records: index.sources, store: { contradictions: [], unknowns: [] } });
    assert(e.decision === "NEEDS_MORE_RESEARCH", "critical claim on a chain alone is insufficient");
  });

  await runTest("E2E-2 contradiction: dispute recorded, never silently chosen", async () => {
    const index = reg.emptyIndex("pe2e");
    const { recs } = registerAll(index, [
      ["https://a.example/preserve", fx.BODY_PRESERVE, "Ref Alpha"],
      ["https://b.example/rewrite", fx.BODY_REWRITE, "Ref Beta"],
    ]);
    recs.forEach((r) => { r.independenceStatus = "INDEPENDENT"; });
    const led = ledger.emptyLedger();
    const c1 = ledger.upsertClaim(led, {
      claim: "HTTP 308 requires clients to preserve method and body.", claimClass: "SUPPORTED_FACT",
      evidenceStatus: "SUPPORTED", materiality: "critical", researchQuestionIds: ["q0"],
      evidence: [{ sourceId: recs[0].sourceId, contentHash: recs[0].contentHash, excerpt: "requires clients to preserve the original request method" }],
    }, index).record;
    const c2 = ledger.upsertClaim(led, {
      claim: "HTTP 308 allows clients to rewrite POST to GET.", claimClass: "CONTESTED",
      evidenceStatus: "MIXED", materiality: "critical", researchQuestionIds: ["q0"],
      evidence: [{ sourceId: recs[1].sourceId, contentHash: recs[1].contentHash, excerpt: "allows clients to rewrite the request method to GET" }],
    }, index).record;
    c1.contradictingEvidence.push({ sourceId: recs[1].sourceId, contentHash: recs[1].contentHash, locator: null, excerpt: "allows clients to rewrite the request method to GET" });
    ver.verifyLedger(led, index.sources);
    assert(c1.corroborationStatus === "CONFLICTED", `disputed claim marked CONFLICTED (${c1.corroborationStatus})`);
    const store = { contradictions: [], unknowns: [] };
    ctr.recordContradiction(store, {
      claimIds: [c1.claimId, c2.claimId], sourceIds: [recs[0].sourceId, recs[1].sourceId],
      description: "Preserve-method vs rewrite-to-GET.", materiality: "critical",
    });
    const e = suf.evaluateSufficiency({ plan: PLAN, ledger: led, records: index.sources, store });
    assert(e.decision !== "SUFFICIENT", "sufficiency does not silently pick a side");
    assert((e.gaps.unresolvedContradictions || []).length === 1, "contradiction surfaced as targeted gap");
  });

  await runTest("E2E-3 targeted loop: NEEDS_MORE_RESEARCH -> add source -> SUFFICIENT", async () => {
    const index = reg.emptyIndex("pe2e");
    const s1 = reg.registerSource(index, { acquiredDocument: fx.makeDoc("https://a.example/preserve", fx.BODY_PRESERVE, { metadata: { publisher: "Ref Alpha" } }) }).record;
    s1.independenceStatus = "INDEPENDENT";
    const led = ledger.emptyLedger();
    // Analysis exchange shapes the candidate (fixture analyst output).
    const areq = ax.createAnalysisRequest({ sourceId: s1.sourceId, contentHash: s1.contentHash, rawContent: fx.BODY_PRESERVE, fitContent: "", researchQuestionIds: ["q0"] });
    const norm = ax.normalizeAnalysisResponse(areq.request, [
      { claim: "HTTP 308 requires clients to preserve method and body.", claimClass: "SUPPORTED_FACT", evidenceStatus: "SUPPORTED", materiality: "critical", researchQuestionIds: ["q0"], excerpt: "requires clients to preserve the original request method" },
    ]);
    for (const cand of norm.candidates) ledger.upsertClaim(led, cand, index);
    ver.verifyLedger(led, index.sources);
    const store = { contradictions: [], unknowns: [] };
    const first = suf.evaluateSufficiency({ plan: PLAN, ledger: led, records: index.sources, store, budgetSpent: { sources: 1, queries: 1 } });
    assert(first.decision === "NEEDS_MORE_RESEARCH", `one question open (${first.decision})`);
    assert((first.gaps.missingQuestions || []).length === 1, "missingQuestions names q1");
    assert((first.gaps.recommendedQueries || []).length === 1 && (first.gaps.recommendedSourceTypes || []).length > 0, "targeted queries + source types emitted");
    // Targeted second pass: one independent source answering q1 only.
    const s2body = "Reference notes record that HTTP 308 was standardized in RFC 7538 published in 2015. The document obsoletes earlier experimental approaches and consolidates permanent redirect semantics. Operators cite this RFC in configuration guides and compliance checklists for web infrastructure deployments.";
    const s2 = reg.registerSource(index, { acquiredDocument: fx.makeDoc("https://c.example/rfc-note", s2body, { metadata: { publisher: "Ref Gamma" } }) }).record;
    s2.independenceStatus = "INDEPENDENT";
    // q0's critical claim is single-group so far: attach s2-independent second support is out of scope;
    // instead q0 also gains its second group from a targeted preserve-source:
    const s0bBody = "A second independent technical reference affirms that HTTP 308 keeps method and body unchanged across the redirect. Administrators verify this with test harnesses that replay POST requests through the new location.";
    const s0b = reg.registerSource(index, { acquiredDocument: fx.makeDoc("https://d.example/confirm", s0bBody, { metadata: { publisher: "Ref Delta" } }) }).record;
    s0b.independenceStatus = "INDEPENDENT";
    const claim0 = led.claims[0];
    claim0.supportingEvidence.push({ sourceId: s0b.sourceId, contentHash: s0b.contentHash, locator: null, excerpt: "keeps method and body unchanged across the redirect" });
    ledger.upsertClaim(led, {
      claim: "HTTP 308 was standardized in RFC 7538.", claimClass: "SUPPORTED_FACT",
      evidenceStatus: "SUPPORTED", materiality: "low", researchQuestionIds: ["q1"],
      evidence: [{ sourceId: s2.sourceId, contentHash: s2.contentHash, excerpt: "standardized in RFC 7538 published in 2015" }],
    }, index);
    ver.verifyLedger(led, index.sources);
    const second = suf.evaluateSufficiency({ plan: PLAN, ledger: led, records: index.sources, store, budgetSpent: { sources: 3, queries: 2 } });
    assert(second.decision === "SUFFICIENT", `targeted pass reaches SUFFICIENT without restart (${second.decision})`);
    // Unrelated claims/sources untouched: ledger still has exactly 2 claims.
    assert(led.claims.length === 2, "no unrelated restart/duplication");
  });

  await runTest("E2E-4 persist + reload + version change marks claims stale", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "unfoldiq-ev-"));
    try {
      const index = reg.emptyIndex("pe2e");
      const doc = fx.makeDoc("https://a.example/orig", fx.BODY_A);
      reg.registerSource(index, { acquiredDocument: doc });
      const led = ledger.emptyLedger();
      ledger.upsertClaim(led, {
        claim: "HTTP 308 requires method preservation.", claimClass: "SUPPORTED_FACT",
        evidenceStatus: "SUPPORTED", materiality: "medium", researchQuestionIds: ["q0"],
        evidence: [{ sourceId: index.sources[0].sourceId, contentHash: doc.contentHash, excerpt: "preserve the original request method" }],
      }, index);
      const saved = evstore.persistEvidenceState(root, "pe2e", {
        index, claimsLedger: led,
        contradictionStore: { contradictions: [] }, unknownStore: { unknowns: [] },
        sufficiency: { decision: "NEEDS_MORE_RESEARCH", rationale: "fixture", policyVersion: "evidence-policy-1.0.0", evaluatedAt: new Date().toISOString() },
      });
      assert(saved.ok && saved.written.length === 5, `five artifacts atomically written (${saved.written.length})`);
      for (const rel of ["research/source-index.json", "research/claims.json", "research/contradictions.json", "research/unknowns.json", "research/sufficiency.json"]) {
        const loaded = evstore.loadEvidenceFile(root, "pe2e", rel);
        assert(loaded.ok && loaded.doc, `${rel} reloads`);
      }
      assert(evstore.validateEvidenceFile("index", evstore.loadEvidenceFile(root, "pe2e", "research/source-index.json").doc) === true, "index schema-valid");
      assert(evstore.validateEvidenceFile("claims", evstore.loadEvidenceFile(root, "pe2e", "research/claims.json").doc) === true, "claims schema-valid");
      // Re-acquire changed content -> version appended, dependent claim flagged.
      const changed = fx.makeDoc("https://a.example/orig", `${fx.BODY_A} Later update paragraph.`, { retrievedAt: "2026-10-03T00:00:00.000Z" });
      const r = reg.registerSource(index, { acquiredDocument: changed });
      assert(r.versionAdded, "changed hash appends version, never overwrites");
      const marked = ledger.markStaleOnSourceChange(led, index.sources[0].sourceId, changed.contentHash);
      assert(marked.marked === 1 && led.claims[0].needsReevaluation, "dependent claim marked for re-evaluation");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  console.log(`\n=== SUMMARY ===`);
  console.log(`Passed assertions: ${passed}, Failed tests: ${failed}`);
  if (failed > 0) { console.log("RESULT: SOME TESTS FAILED"); process.exit(1); }
  console.log("RESULT: ALL TESTS PASSED");
}

main().catch((e) => { console.log(`[FAIL] harness: ${e.message}`); process.exit(1); });
