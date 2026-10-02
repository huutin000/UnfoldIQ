"use strict";

/**
 * Evidence-bypass prevention tests EB1-EB6 (PHASE 1G.1 Prompt 05, §77).
 * Proves DEEP output is leads-only: nothing becomes evidence without
 * Prompt-02 acquisition + Prompt-03 registry/independence.
 */

const leads = require("../../lib/research-deep/deep-leads.js");
const registry = require("../../lib/research-evidence/source-registry.js");
const independence = require("../../lib/research-evidence/independence.js");
const { normalizeDeepResult } = require("../../lib/research-deep/provider-interface.js");

let passed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
  console.log(`  ✓ ${message}`);
  passed++;
}

function makeDoc(url, body) {
  const crypto = require("crypto");
  const hash = crypto.createHash("sha256").update(body, "utf8").digest("hex");
  return {
    requestedUrl: url, finalUrl: url, retrievedAt: new Date().toISOString(),
    success: true, statusCode: 200, route: "crawl4ai-direct",
    rawMarkdown: body, fitMarkdown: body, title: url,
    metadata: {}, links: [], contentHash: hash,
  };
}

async function main() {
  console.log("\n[TEST] EB1 provider learning with no URL is NOT supported evidence");
  {
    const c = leads.classifyLearning({ text: "asserts X", sourceUrls: [] });
    assert(c.type === "UNVERIFIED_LEAD" && c.usableAsEvidence === false, "sourceless learning stays an unverified lead");
  }

  console.log("\n[TEST] EB2 provider report statement is NOT a Research Pack entry");
  {
    const g = leads.assertReportNotPack("DEEP final report prose...");
    assert(g.isCanonicalEvidence === false && g.isResearchPack === false, "report never canonical");
    const r = normalizeDeepResult({ status: "COMPLETED", learnings: [{ text: "X", sourceUrls: [] }] }, {});
    assert(!("packEntry" in r) && !("claimId" in (r.learnings[0] || {})), "normalized result carries no pack/claim ids");
  }

  console.log("\n[TEST] EB3 provider citation URL is a candidate requiring acquisition");
  {
    const cands = leads.candidateSourcesFromResult(normalizeDeepResult({
      status: "COMPLETED",
      providerCitations: ["https://example.com/deep-find"],
      candidateSources: [],
    }, {}));
    assert(cands.length === 1 && cands[0].url.includes("example.com"), "citation becomes a candidate");
    const c = leads.classifyLearning({ text: "x", sourceUrls: ["https://example.com/deep-find"] });
    assert(c.usableAsEvidence === false, "linked lead still needs acquisition first");
  }

  console.log("\n[TEST] EB4 acquired DEEP source enters the SAME Source Registry");
  {
    const index = registry.emptyIndex("p-deep");
    const reg = registry.registerSource(index, { acquiredDocument: makeDoc("https://example.com/deep-find", "independent body alpha ".repeat(40)) });
    assert(reg.ok === true && index.sources.length === 1, "DEEP URL registered in the canonical index (no deep-source-index.json)");
  }

  console.log("\n[TEST] EB5 copied DEEP URLs stay one origin group");
  {
    const index = registry.emptyIndex("p-copy");
    const body = "syndicated wire text about the event ".repeat(40);
    const a = registry.registerSource(index, { acquiredDocument: makeDoc("https://a.example/wire", body) }).record;
    const b = registry.registerSource(index, { acquiredDocument: makeDoc("https://b.example/wire-copy", body) }).record;
    const res = independence.evaluateIndependence([a, b], { [a.sourceId]: body, [b.sourceId]: body });
    const statuses = res.map((r) => r.independenceStatus);
    assert(statuses.includes("COPY_CHAIN") || new Set(res.map((r) => r.originGroup)).size === 1,
      `duplicate DEEP bodies share one origin (${statuses.join(",")})`);
  }

  console.log("\n[TEST] EB6 DEEP contradiction is preserved, never auto-resolved");
  {
    const ctr = require("../../lib/research-evidence/contradictions.js");
    const store = { contradictions: [], unknowns: [] };
    const add = ctr.recordContradiction(store, {
      claimIds: ["clm-x", "clm-y"], description: "DEEP source contradicts STANDARD source on date",
      sourceIds: ["src-a", "src-b"], materiality: "critical",
    });
    assert(add.ok === true && store.contradictions[0].status === "OPEN", "contradiction recorded OPEN, not resolved by provider prestige");
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Passed assertions: ${passed}, Failed tests: 0`);
  console.log("RESULT: ALL TESTS PASSED");
}

main().catch((e) => { console.log(`[FAIL] harness: ${e.message}`); process.exit(1); });
