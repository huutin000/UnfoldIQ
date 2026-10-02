"use strict";

/**
 * UNFOLDIQ dynamic policy freshness tests (STEP 09 V2): R1-R6.
 * No network calls. Tests metadata/freshness logic only.
 */

const { evaluatePolicyFreshness, evaluatePolicyHandoff } = require("../../lib/policy-state-check.js");

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
    return true;
  } catch (e) {
    console.log(`[FAIL] ${name}: ${e.message}`);
    failed++;
    return false;
  }
}

function logOut(label, obj) {
  console.log(`  output: ${label} = ${JSON.stringify(obj)}`);
}

console.log("=== POLICY REFRESH TESTS (R1-R6) ===\n");

const NOW = "2026-09-25T00:00:00Z";

// R1 Fresh LIVE_VERIFIED source -> fresh
runTest("R1 Fresh live-verified source", () => {
  const f = evaluatePolicyFreshness({ verificationStatus: "LIVE_VERIFIED", lastVerifiedAt: "2026-09-20T00:00:00Z", criticality: "CRITICAL" }, NOW, 30);
  logOut("freshness", f);
  assert(f.status === "FRESH", "live-verified within max age must be FRESH");
});

// R2 Old source beyond configured max age -> STALE
runTest("R2 Old source stale", () => {
  const f = evaluatePolicyFreshness({ verificationStatus: "LIVE_VERIFIED", lastVerifiedAt: "2026-01-01T00:00:00Z", criticality: "HIGH" }, NOW, 30);
  logOut("freshness", f);
  assert(f.status === "STALE", "source beyond policyMaxAgeDays must be STALE");
});

// R3 SNAPSHOT_ONLY -> not current-live-verified
runTest("R3 Snapshot-only never live-verified", () => {
  const f = evaluatePolicyFreshness({ verificationStatus: "SNAPSHOT_ONLY", lastVerifiedAt: "2026-09-20T00:00:00Z", criticality: "HIGH" }, NOW, 30);
  logOut("freshness", f);
  assert(f.status !== "FRESH", "SNAPSHOT_ONLY must never be FRESH");
  const h = evaluatePolicyHandoff({ freshnessStatus: f.status, verificationStatus: "SNAPSHOT_ONLY", criticality: "NORMAL", hasLiveCapability: false });
  logOut("handoff", h);
  assert(h.handoff !== "CURRENT_LIVE_VERIFIED", "snapshot-only must not claim current-live verification");
});

// R4 Known newer observed update date than verifiedAt -> STALE
runTest("R4 Newer observed update forces stale", () => {
  const f = evaluatePolicyFreshness({ verificationStatus: "LIVE_VERIFIED", lastVerifiedAt: "2026-09-01T00:00:00Z", lastObservedUpdate: "2026-09-20T00:00:00Z", criticality: "HIGH" }, NOW, 30);
  logOut("freshness", f);
  assert(f.status === "STALE", "known newer observed update must force STALE");
});

// R5 High/critical stale source + no live capability -> publish review required
runTest("R5 Stale critical no-web gates publish", () => {
  const h = evaluatePolicyHandoff({ freshnessStatus: "STALE", verificationStatus: "SNAPSHOT_ONLY", criticality: "CRITICAL", hasLiveCapability: false });
  logOut("handoff", h);
  assert(h.handoff === "PUBLISH_REVIEW_REQUIRED", "stale critical with no live capability must be PUBLISH_REVIEW_REQUIRED");
});

// R6 Normal irrelevant policy category is not loaded for unrelated topic
runTest("R6 Unrelated categories not routed", () => {
  const { resolveRoute } = require("../../scripts/cli/context-resolver.js");
  const r = resolveRoute("3B", "youtube");
  const all = r.required.concat(r.conditional.map((c) => c.path));
  assert(!all.some((p) => p.toLowerCase().includes("violence")), "violence policy must not load by default for unrelated topic");
  assert(r.conditional.some((c) => c.path === "policy/ROUTER.md"), "policy router stays conditional, triggered only when relevant");
});

console.log(`\n=== SUMMARY ===`);
console.log(`Passed assertions: ${passed}, Failed tests: ${failed}`);
if (failed > 0) {
  console.log("RESULT: SOME TESTS FAILED");
  process.exit(1);
}
console.log("RESULT: ALL TESTS PASSED");
