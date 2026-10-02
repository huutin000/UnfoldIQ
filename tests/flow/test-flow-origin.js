"use strict";

/**
 * Flow origin-compatibility regression (STEP 10C §28A + POST-v1B live fix).
 * Fixtures: labs.google/fx legacy origin, flow.google entrypoint alias,
 * LIVE-OBSERVED flow.google.com final origin, unknown origin. No network.
 * Never broadens to <all_urls>.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");

let passed = 0;
let failed = 0;

function assert(c, m) {
  if (!c) throw new Error(`ASSERTION FAILED: ${m}`);
  console.log(`  ok ${m}`);
  passed++;
}

function runTest(name, fn) {
  console.log(`\n[TEST] ${name}`);
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`[PASS] ${name}`))
    .catch((e) => {
      console.log(`[FAIL] ${name}: ${e.message}`);
      failed++;
    });
}

async function main() {
  console.log("=== FLOW ORIGIN REGRESSION (§28A) ===\n");
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "flow-companion", "extension", "manifest.json"), "utf8"));
  const fw = require("../../providers/runtime/adapters/flow-web.js");

  await runTest("ORIGIN-1 Current labs.google/fx final origin covered", async () => {
    const r = fw.checkFlowOriginCoverage(manifest, "https://labs.google/fx");
    assert(r.status === "ORIGIN_COVERED", `labs.google/fx must be covered, got ${r.status}`);
    assert(r.canonical === "https://flow.google.com/", "canonical entrypoint must be flow.google.com/");
  });

  await runTest("ORIGIN-2 Future flow.google origin handled with exact-permission policy", async () => {
    const r = fw.checkFlowOriginCoverage(manifest, "https://flow.google");
    assert(["ORIGIN_COVERED", "ORIGIN_NOT_COVERED"].includes(r.status), `must report covered or fail-safe, got ${r.status}`);
    const perms = JSON.stringify(manifest.host_permissions || []);
    assert(!/<all_urls>/.test(perms), "must never broaden to <all_urls>");
  });

  await runTest("ORIGIN-3 Unknown origin rejected / fails safe", async () => {
    const r = fw.checkFlowOriginCoverage(manifest, "https://evil.example/");
    assert(r.status === "ORIGIN_NOT_COVERED" && r.covered === false, `unknown origin must fail safe, got ${r.status}`);
  });

  await runTest("ORIGIN-4 No observed origin without manifest info → NOT_VERIFIED", async () => {
    const r = fw.checkFlowOriginCoverage({}, null);
    assert(r.status === "ORIGIN_NOT_VERIFIED", `must be NOT_VERIFIED, got ${r.status}`);
  });

  await runTest("ORIGIN-5 Live-observed flow.google.com origin covered", async () => {
    const r = fw.checkFlowOriginCoverage(manifest, "https://flow.google.com");
    assert(r.status === "ORIGIN_COVERED", `flow.google.com must be covered, got ${r.status}: ${r.detail}`);
    const perms = JSON.stringify(manifest.host_permissions || []);
    assert(!/<all_urls>/.test(perms), "must never broaden to <all_urls>");
  });

  console.log(`\n=== SUMMARY: passed assertions ${passed}, failed tests ${failed} ===`);
  console.log(failed > 0 ? "RESULT: SOME TESTS FAILED" : "RESULT: ALL TESTS PASSED");
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.log(`FATAL: ${e.stack || e.message}`);
  process.exit(1);
});
