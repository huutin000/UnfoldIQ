"use strict";

/**
 * Phase 1G.11 — visual factuality tests FA1–FA17 (+ F1/F2 canonical gates).
 * Deterministic structured observations with claim/evidence provenance.
 */

const qa = require("../../lib/asset-qa/index.js");

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

const PROV = { claimIds: ["cl-1"], evidenceIds: ["ev-1"] };

function obsMatch(observed, confidence) {
  return { observed, match: true, confidence: confidence || "high", source: "MANUAL_REVIEW" };
}

function obsMismatch(observed) {
  return { observed, match: false, confidence: "high", source: "MANUAL_REVIEW" };
}

async function main() {
  await runTest("FA1 FICTION without factual elements → N/A", () => {
    const r = qa.evaluateFactuality({ contentClass: "FICTION", expectation: { shotId: "SH1" }, observations: {} });
    assert(r.status === "NOT_APPLICABLE", "FICTION is NOT_APPLICABLE");
  });

  await runTest("FA2 FACTUAL match with provenance → PASS", () => {
    const r = qa.evaluateFactuality({
      contentClass: "FACTUAL",
      expectation: { shotId: "SH1", ...PROV, period: "1920s" },
      observations: { period: obsMatch("1920s attire and vehicles") },
    });
    assert(r.status === "PASS", "provenanced factual match PASSes");
  });

  await runTest("FA3 HYBRID factual assertions only", () => {
    const withClaims = qa.evaluateFactuality({
      contentClass: "HYBRID",
      expectation: { shotId: "SH1", ...PROV, location: "Grand Canyon" },
      observations: { location: obsMatch("Grand Canyon South Rim") },
    });
    assert(withClaims.status === "PASS", "HYBRID with factual claims evaluates them");
    const withoutClaims = qa.evaluateFactuality({ contentClass: "HYBRID", expectation: { shotId: "SH1" }, observations: {} });
    assert(withoutClaims.status === "NOT_APPLICABLE", "HYBRID without factual assertions is N/A");
  });

  await runTest("FA4 UNKNOWN class → REVIEW", () => {
    const r = qa.evaluateFactuality({ contentClass: "UNKNOWN", expectation: {}, observations: {} });
    assert(r.status === "UNKNOWN" && r.blocking === true, "UNKNOWN class blocks with REVIEW");
  });

  const domains = [
    ["FA5 period", "period", "Victorian London", "modern streetwear"],
    ["FA6 location", "location", "Eiffel Tower Paris", "Tokyo tower"],
    ["FA7 species/object", "speciesPersonObject", ["leopard"], ["lion"]],
    ["FA8 clothing", "clothing", ["Roman toga"], ["medieval armor"]],
    ["FA9 architecture", "architecture", ["Gothic cathedral"], ["glass skyscraper"]],
    ["FA10 tools/equipment", "toolsEquipment", ["astrolabe"], ["smartphone"]],
    ["FA11 map geography", "mapGeography", "Nile flows north", "Nile flows south"],
    ["FA13 numbers", "numbersLabels", [{ value: 42, unit: "km" }], [{ value: 24, unit: "km" }]],
    ["FA14 unit/label", "numbersLabels", [{ label: "Mars", value: 100 }], [{ label: "Venus", value: 100 }]],
    ["FA15 timeline order", "timelineOrder", ["A→B→C"], ["C→B→A"]],
    ["FA16 on-screen factual text", "onScreenFactualText", ["population: 1.2M"], ["population: 9.9M"]],
  ];
  for (const [name, domain, expected, observed] of domains) {
    await runTest(`${name} mismatch FAIL`, () => {
      const r = qa.evaluateFactuality({
        contentClass: "FACTUAL",
        expectation: { shotId: "SH1", ...PROV, [domain]: expected },
        observations: { [domain]: obsMismatch(observed) },
      });
      assert(r.status === "FAIL", `${name} mismatch FAILs`);
      assert(r.checks.find((c) => c.check === domain).status === "FAIL", `${domain} check FAIL`);
    });
  }

  await runTest("F1/FA12 claim decline + visual rise → FAIL", () => {
    const r = qa.evaluateFactuality({
      contentClass: "FACTUAL",
      expectation: { shotId: "SH1", ...PROV, chartDirection: "decline" },
      observations: { chartDirection: obsMismatch("chart rises") },
    });
    assert(r.status === "FAIL", "chart inversion FAILs");
    assert(r.checks.find((c) => c.check === "chartDirection").status === "FAIL", "chartDirection check FAIL");
  });

  await runTest("F2 claim leopard + visual lion → FAIL", () => {
    const r = qa.evaluateFactuality({
      contentClass: "FACTUAL",
      expectation: { shotId: "SH1", ...PROV, speciesPersonObject: ["leopard"] },
      observations: { speciesPersonObject: obsMismatch(["lion"]) },
    });
    assert(r.status === "FAIL", "species swap FAILs");
  });

  await runTest("FA17 unavailable observation → UNKNOWN", () => {
    const r = qa.evaluateFactuality({
      contentClass: "FACTUAL",
      expectation: { shotId: "SH1", ...PROV, numbersLabels: [{ value: 7 }] },
      observations: {},
    });
    assert(r.checks.find((c) => c.check === "numbersLabels").status === "UNKNOWN", "unobservable value is UNKNOWN");
    assert(r.status !== "PASS", "UNKNOWN never PASSes");
  });

  await runTest("factual PASS without provenance → UNKNOWN (validator rejects)", () => {
    const r = qa.evaluateFactuality({
      contentClass: "FACTUAL",
      expectation: { shotId: "SH1", period: "1920s" },
      observations: { period: obsMatch("1920s") },
    });
    assert(r.status === "UNKNOWN", "unprovenanced match cannot PASS");
  });

  console.log(`\n=== DONE: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(`FATAL: ${(e && e.stack) || e}`);
  process.exit(1);
});
