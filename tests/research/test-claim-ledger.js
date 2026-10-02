"use strict";

/**
 * Claim/Evidence ledger tests CE1-CE8 + analysis exchange + VI raw fallback (Prompt 03, 1G.1I).
 * Deterministic fixtures. No network.
 */

const reg = require("../../lib/research-evidence/source-registry.js");
const ind = require("../../lib/research-evidence/independence.js");
const ax = require("../../lib/research-evidence/analysis-exchange.js");
const ledger = require("../../lib/research-evidence/claim-ledger.js");
const ver = require("../../lib/research-evidence/verification.js");
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

function setupAB() {
  const index = reg.emptyIndex("pc");
  const a = reg.registerSource(index, { acquiredDocument: fx.makeDoc("https://a.example/orig", fx.BODY_A, { metadata: { publisher: "City Gazette" } }) }).record;
  const b = reg.registerSource(index, { acquiredDocument: fx.makeDoc("https://b.example/other", fx.BODY_D, { metadata: { publisher: "Net Journal" } }) }).record;
  ind.evaluateIndependence([a, b], { [a.sourceId]: fx.BODY_A, [b.sourceId]: fx.BODY_D });
  return { index, a, b };
}

async function main() {
  console.log("=== CLAIM/EVIDENCE TESTS (CE1-CE8) ===\n");

  await runTest("CE1 claim links to source/version; broken links rejected", async () => {
    const { index, a } = setupAB();
    const led = ledger.emptyLedger();
    const good = ledger.upsertClaim(led, {
      claim: "HTTP 308 requires method preservation.", claimClass: "SUPPORTED_FACT",
      evidenceStatus: "SUPPORTED", materiality: "high", researchQuestionIds: ["q0"],
      evidence: [{ sourceId: a.sourceId, contentHash: a.contentHash, locator: "para 2", excerpt: "requires the client to preserve the original request method" }],
    }, index);
    assert(good.ok && /^clm-[0-9a-f]{12}$/.test(good.record.claimId), "claim recorded with stable id");
    const bad = ledger.upsertClaim(ledger.emptyLedger(), {
      claim: "X.", claimClass: "SUPPORTED_FACT", evidenceStatus: "SUPPORTED", materiality: "low",
      evidence: [{ sourceId: "src-deadbeefcafe", contentHash: "abc", excerpt: "x" }],
    }, index);
    assert(!bad.ok && bad.code === "EVIDENCE_LINK_BROKEN", "dangling source rejected");
    const badVer = ledger.upsertClaim(ledger.emptyLedger(), {
      claim: "X.", claimClass: "SUPPORTED_FACT", evidenceStatus: "SUPPORTED", materiality: "low",
      evidence: [{ sourceId: a.sourceId, contentHash: "deadbeef", excerpt: "x" }],
    }, index);
    assert(!badVer.ok && badVer.code === "EVIDENCE_LINK_BROKEN", "unknown version rejected");
  });

  await runTest("CE2/CE3/CE4 three axes stay separate", async () => {
    const { index, a } = setupAB();
    const led = ledger.emptyLedger();
    const r = ledger.upsertClaim(led, {
      claim: "Scholars interpret 308 adoption as slow.", claimClass: "SCHOLARLY_INTERPRETATION",
      evidenceStatus: "MIXED", materiality: "medium", researchQuestionIds: ["q1"],
      evidence: [{ sourceId: a.sourceId, contentHash: a.contentHash, excerpt: "transfer ranking signals over time" }],
    }, index);
    assert(r.record.claimClass === "SCHOLARLY_INTERPRETATION", "class preserved");
    assert(r.record.evidenceStatus === "MIXED", "strength preserved independently");
    assert(r.record.corroborationStatus === "UNSUPPORTED", "corroboration starts empty, never hand-set");
    ver.verifyLedger(led, index.sources);
    assert(["SINGLE_SOURCE", "MULTI_SOURCE_CONFIRMED", "PRIMARY_CONFIRMED"].includes(r.record.corroborationStatus), `verification writes corroboration (${r.record.corroborationStatus})`);
    assert(r.record.claimClass === "SCHOLARLY_INTERPRETATION" && r.record.evidenceStatus === "MIXED", "other axes untouched by verification");
  });

  await runTest("CE5 derived duplicate does not increment independent support", async () => {
    const index = reg.emptyIndex("pc");
    const recs = ["https://a.example/orig", "https://b.example/copy", "https://c.example/rw"].map((u, i) =>
      reg.registerSource(index, { acquiredDocument: fx.makeDoc(u, [fx.BODY_A, fx.BODY_B, fx.BODY_C][i]) }).record
    );
    const bodies = { [recs[0].sourceId]: fx.BODY_A, [recs[1].sourceId]: fx.BODY_B, [recs[2].sourceId]: fx.BODY_C };
    ind.evaluateIndependence(recs, bodies);
    const led = ledger.emptyLedger();
    const r = ledger.upsertClaim(led, {
      claim: "HTTP 308 requires method preservation.", claimClass: "SUPPORTED_FACT",
      evidenceStatus: "SUPPORTED", materiality: "high", researchQuestionIds: ["q0"],
      evidence: recs.map((s) => ({ sourceId: s.sourceId, contentHash: s.contentHash, excerpt: "preserve the original request method" })),
    }, index);
    const v = ver.verifyClaim(r.record, { records: index.sources });
    assert(v.independentGroups <= 1, `3 chained URLs count <= 1 group (${v.independentGroups})`);
    assert(v.corroborationStatus !== "MULTI_SOURCE_CONFIRMED", "no fake multi-source confirmation");
  });

  await runTest("CE6 primary source supports without fake duplicate rule", async () => {
    const index = reg.emptyIndex("pc");
    const p = reg.registerSource(index, {
      acquiredDocument: fx.makeDoc("https://www.ietf.org/rfc.html", fx.BODY_A),
      officialDomains: ["ietf.org"],
    }).record;
    p.independenceStatus = "INDEPENDENT";
    const led = ledger.emptyLedger();
    const r = ledger.upsertClaim(led, {
      claim: "Minor date detail from official primary.", claimClass: "SUPPORTED_FACT",
      evidenceStatus: "SUPPORTED", materiality: "low", researchQuestionIds: ["q0"],
      evidence: [{ sourceId: p.sourceId, contentHash: p.contentHash, excerpt: "standardized to remove ambiguity" }],
    }, index);
    const v = ver.verifyClaim(r.record, { records: index.sources });
    assert(v.corroborationStatus === "PRIMARY_CONFIRMED", `official primary confirms without redundant copy (${v.corroborationStatus})`);
  });

  await runTest("CE7 unsupported claim remains UNSUPPORTED", async () => {
    const { index } = setupAB();
    const led = ledger.emptyLedger();
    const r = ledger.upsertClaim(led, {
      claim: "Unverified rumor about redirects.", claimClass: "UNVERIFIED",
      evidenceStatus: "UNSUPPORTED", materiality: "high", researchQuestionIds: ["q0"], evidence: [],
    }, index);
    const v = ver.verifyClaim(r.record, { records: index.sources });
    assert(v.corroborationStatus === "UNSUPPORTED", "no support invented");
  });

  await runTest("CE8 bounded evidence locator, long excerpt rejected", async () => {
    const { index, a } = setupAB();
    const bad = ledger.upsertClaim(ledger.emptyLedger(), {
      claim: "X.", claimClass: "SUPPORTED_FACT", evidenceStatus: "SUPPORTED", materiality: "low",
      evidence: [{ sourceId: a.sourceId, contentHash: a.contentHash, locator: "p1", excerpt: "x".repeat(500) }],
    }, index);
    assert(!bad.ok && bad.code === "CLAIM_INVALID", "500-char excerpt rejected (280 max)");
  });

  await runTest("CE9 analysis exchange validates structure, not prose", async () => {
    const req = ax.createAnalysisRequest({ sourceId: "src-abc", contentHash: "hash1", rawContent: fx.BODY_A, fitContent: "", researchQuestionIds: ["q0"] });
    assert(req.ok && req.request.excerptScope === "rawMarkdown" && req.request.fitWeakFallback, "empty fit falls back to raw (VI-safe)");
    const norm = ax.normalizeAnalysisResponse(req.request, [
      { claim: "308 preserves method.", claimClass: "SUPPORTED_FACT", evidenceStatus: "SUPPORTED", materiality: "high", excerpt: "preserve the original request method", locator: "para 2" },
      { claim: "", claimClass: "NOPE", evidenceStatus: "SUPPORTED", materiality: "high" },
    ]);
    assert(norm.candidates.length === 1 && norm.rejected.length === 1, "valid kept, invalid rejected with codes");
    assert(norm.candidates[0].evidence[0].sourceId === "src-abc", "evidence traced to request source, not prose");
    const freeform = ax.normalizeAnalysisResponse(req.request, "just some text");
    assert(!freeform.ok && freeform.code === "ANALYSIS_PROVIDER_UNAVAILABLE", "free-form-only never passes");
  });

  await runTest("CE10 Vietnamese raw fallback carries evidence", async () => {
    const req = ax.createAnalysisRequest({ sourceId: "src-vi", contentHash: "hvi", rawContent: fx.BODY_VI, fitContent: "   ", researchQuestionIds: ["q0"] });
    assert(req.ok && req.request.excerpt.includes("Mã trạng thái HTTP 308"), "Vietnamese raw excerpt used");
    const norm = ax.normalizeAnalysisResponse(req.request, [
      { claim: "HTTP 308 yêu cầu giữ nguyên phương thức.", claimClass: "SUPPORTED_FACT", evidenceStatus: "SUPPORTED", materiality: "medium" },
    ]);
    assert(norm.candidates.length === 1, "claim extractable without fit");
    assert(norm.candidates[0].evidence[0].excerpt.length > 0, "evidence excerpt defaults to raw, no false UNSUPPORTED");
  });

  console.log(`\n=== SUMMARY ===`);
  console.log(`Passed assertions: ${passed}, Failed tests: ${failed}`);
  if (failed > 0) { console.log("RESULT: SOME TESTS FAILED"); process.exit(1); }
  console.log("RESULT: ALL TESTS PASSED");
}

main().catch((e) => { console.log(`[FAIL] harness: ${e.message}`); process.exit(1); });
