"use strict";

/**
 * STANDARD/DEEP mode routing tests M1-M3 + no-GPT scope assertion.
 * Fixture-only.
 */

const fs = require("fs");
const path = require("path");
const sp = require("../../lib/research-acquisition/search-provider.js");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
  console.log(`  ✓ ${message}`);
  passed++;
}

function runTest(name, fn) {
  console.log(`\n[TEST] ${name}`);
  try {
    fn();
    console.log(`[PASS] ${name}`);
  } catch (e) {
    console.log(`[FAIL] ${name}: ${e.message}`);
    failed++;
  }
}

console.log("=== RESEARCH MODE TESTS (M1-M3) ===\n");

runTest("M1 STANDARD routes to SearchProvider path", () => {
  const r = sp.resolveResearchMode("STANDARD");
  assert(r.ok === true && r.route === "SEARCH_PROVIDER", "STANDARD -> SearchProvider + acquisition layer");
});

runTest("M2 DEEP is explicitly deferred, not faked", () => {
  const r = sp.resolveResearchMode("DEEP");
  assert(r.ok === false && r.code === "DEEP_PROVIDER_NOT_IMPLEMENTED_YET", "DEEP returns explicit deferred state");
});

runTest("M3 Prompt 02 never invokes GPT Researcher", () => {
  const dir = path.join(__dirname, "..", "..", "lib", "research-acquisition");
  const hits = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".js"))) {
    const body = fs.readFileSync(path.join(dir, f), "utf8");
    // Real integration would require/import/call a GPT module; a deferral
    // message naming Prompt 05 ownership is required scope documentation.
    if (/require\(['"][^'"]*gpt|gptResearcher\s*\(|gpt-researcher['"]|GPT_RESEARCHER_[A-Z_]*\s*=/i.test(body)) {
      hits.push(f);
    }
  }
  assert(hits.length === 0, `no GPT Researcher integration in acquisition modules (${hits.join(",") || "clean"})`);
  const bad = sp.resolveResearchMode("ULTRA");
  assert(bad.ok === false && bad.code === "INVALID_RESEARCH_MODE", "unknown mode rejected");
});

console.log(`\n=== SUMMARY ===`);
console.log(`Passed assertions: ${passed}, Failed tests: ${failed}`);
if (failed > 0) {
  console.log("RESULT: SOME TESTS FAILED");
  process.exit(1);
}
console.log("RESULT: ALL TESTS PASSED");
