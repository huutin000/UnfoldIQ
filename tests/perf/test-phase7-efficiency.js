"use strict";

/** Phase 7 efficiency: time classes (measured vs estimated) and production profiles. */

const path = require("path");
const REPO = path.join(__dirname, "..", "..");
const tc = require(REPO + "/lib/perf/time-class.js");
const prof = require(REPO + "/lib/render/production-profiles.js");

let passed = 0;
let failed = 0;
function assert(c, m) {
  if (!c) throw new Error("ASSERTION FAILED: " + m);
  console.log("  ok  " + m);
}
function runTest(name, fn) {
  console.log("[TEST] " + name);
  try { fn(); passed += 1; console.log("[PASS] " + name); }
  catch (e) { failed += 1; console.log("[FAIL] " + name + " - " + e.message); }
}

runTest("classify maps stages onto the four time classes", () => {
  assert(tc.classify("RENDER") === "COMPUTE" && tc.classify("TECHNICAL_QC") === "COMPUTE", "render and QC are compute");
  assert(tc.classify("PROVIDER_WAIT") === "PROVIDER_WAIT" && tc.classify("QUEUE_WAIT") === "PROVIDER_WAIT", "provider waiting");
  assert(tc.classify("RESEARCH") === "AUTHORING" && tc.classify("HUMAN_REVIEW") === "HUMAN_REVIEW", "authoring and human review");
  let threw = false;
  try { tc.classify("NOPE"); } catch { threw = true; }
  assert(threw, "unknown stage rejected");
});

runTest("summarize keeps measured apart from estimated and demands a basis", () => {
  const s = tc.summarize([
    { category: "RENDER", durationMs: 1000, evidence: "MEASURED_REAL" },
    { category: "RENDER", durationMs: 5000, evidence: "ESTIMATED", basis: "5C scaling" },
    { category: "HUMAN_REVIEW", durationMs: 900, evidence: "ESTIMATED", basis: "owner" },
  ]);
  assert(s.COMPUTE.measuredMs === 1000 && s.COMPUTE.estimatedMs === 5000, "buckets separate");
  assert(s.HUMAN_REVIEW.estimatedMs === 900 && s.AUTHORING.count === 0, "other classes untouched");
  let threw = false;
  try { tc.summarize([{ category: "RENDER", durationMs: 1, evidence: "ESTIMATED" }]); } catch { threw = true; }
  assert(threw, "estimate without basis rejected");
});

runTest("profiles: preview is lighter and never final-eligible; final overrides nothing", () => {
  const p = prof.renderOptionsFor("PRODUCTION_FAST_PREVIEW");
  assert(p.finalEligible === false && p.options.scale === 0.5, "preview half scale, not final");
  const f = prof.renderOptionsFor("PRODUCTION_FINAL");
  assert(f.finalEligible === true && Object.keys(f.options).length === 0, "final carries no quality overrides");
  assert(prof.renderOptionsFor("DEVELOPMENT").options === null, "development renders no motion");
  let threw = false;
  try { prof.renderOptionsFor("TURBO"); } catch { threw = true; }
  assert(threw, "unknown profile rejected");
});

console.log(`\n=== phase7-efficiency: ${failed} failed, ${passed} passed ===`);
process.exit(failed > 0 ? 1 : 0);
