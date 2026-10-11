"use strict";

/**
 * Hybrid Visual Routing ROUTE-01..18 (policy 10/10/2026). Pure-function
 * tests: no provider, mock or live. Live Flow/Veo remains NOT_MEASURED.
 */

const REPO = require("path").join(__dirname, "..", "..");
const r = require(REPO + "/lib/visual-motion/routing.js");

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

const still = { shotId: "S01", contentMode: "ENVIRONMENT", targetRealism: "REALISTIC", motionRequirement: "CAMERA_ONLY", shotIntent: "phone in street" };
const quotaOk = { flowQuota: { available: 80, costPerGeneration: 4 } };

runTest("ROUTE-01 diagram -> procedural + Remotion 2D", () => {
  const d = r.routeShot({ shotId: "S06", contentMode: "DIAGRAM", targetRealism: "ABSTRACT", motionRequirement: "CAMERA_ONLY" });
  assert(d.visualSource === "PROCEDURAL_GRAPHICS" && d.motionEngine === "REMOTION_2D" && d.spendAllowed === false, "diagram stays local");
});

runTest("ROUTE-02 cinematic still -> Flow image + Remotion, no Veo", () => {
  const d = r.routeShot({ ...still, availability: quotaOk, creditApproval: "APPROVED" });
  assert(d.visualSource === "FLOW_GENERATED_IMAGE" && d.motionEngine === "REMOTION_2D", "still + 2D motion");
  assert(d.spendAllowed === true && d.state === "READY", "spend allowed only with approved credit and known cost");
  const reuse = r.routeShot({ ...still, availability: { approvedAssets: ["a1"], ...quotaOk } });
  assert(reuse.visualSource === "APPROVED_ASSET" && reuse.spendAllowed === false, "approved asset reused before generating");
});

runTest("ROUTE-03 semantic action -> footage, else Veo I2V", () => {
  const act = { ...still, motionRequirement: "SEMANTIC_ACTION" };
  const f = r.routeShot({ ...act, availability: { licensedFootage: ["f1"] } });
  assert(f.motionEngine === "EXISTING_FOOTAGE" && f.visualSource === "LICENSED_REAL_MEDIA", "footage first");
  const v = r.routeShot({ ...act, availability: quotaOk });
  assert(v.motionEngine === "VEO_IMAGE_TO_VIDEO" && v.alternativeRoutes.some((a) => a.engine === "EXISTING_FOOTAGE"), "Veo I2V with footage alternative");
});

runTest("ROUTE-04 flat still gets no fake parallax", () => {
  const d = r.routeShot({ ...still, requestedMotion: "REMOTION_PARALLAX", availability: quotaOk });
  assert(d.motionEngine === "REMOTION_2D" && d.reasonCodes.includes("FAKE_PARALLAX_REJECTED"), "downgraded");
  const ok = r.routeShot({ ...still, requestedMotion: "REMOTION_PARALLAX", availability: { ...quotaOk, depthLayers: true } });
  assert(ok.motionEngine === "REMOTION_PARALLAX", "allowed with depth layers");
});

runTest("ROUTE-05 no Flow quota -> wait, never paid", () => {
  const d = r.routeShot({ ...still, availability: { flowQuota: { available: 0, costPerGeneration: 4 } }, creditApproval: "APPROVED" });
  assert(d.state === "WAITING_ASSET" && d.spendAllowed === false && d.reasonCodes.includes("NO_FLOW_QUOTA"), "waits");
});

runTest("ROUTE-06 unknown credit cost blocks spend", () => {
  const d = r.routeShot({ ...still, availability: { flowQuota: { available: 80, costPerGeneration: null } }, creditApproval: "APPROVED" });
  assert(d.spendAllowed === false && d.creditEstimate === null && d.reasonCodes.includes("CREDIT_COST_UNKNOWN"), "null is unknown, not zero");
});

runTest("ROUTE-07 bounded retry with credit accounting", () => {
  const l = r.createCreditLedger({ cap: 80, maxRetriesPerShot: 1 });
  assert(l.reserve({ correlationId: "j1", shotId: "S01", cost: 10 }).ok, "first attempt");
  assert(l.reserve({ correlationId: "j2", shotId: "S01", cost: 10 }).ok, "one retry");
  assert(l.reserve({ correlationId: "j3", shotId: "S01", cost: 10 }).code === "RETRY_LIMIT", "retry limit");
  assert(l.spent() === 20, "spent tracked");
  const big = l.reserve({ correlationId: "j4", shotId: "S02", cost: 70 });
  assert(big.code === "OWNER_REVIEW_REQUIRED", "cap overrun stops");
});

runTest("ROUTE-08 recurring entity without reference blocks generation", () => {
  const d = r.routeShot({ ...still, availability: quotaOk, recurringEntities: [{ entityId: "hero", referenceIds: [] }] });
  assert(d.state === "BLOCKED" && d.status === "BLOCKED_MISSING_REFERENCE", "blocked");
});

runTest("ROUTE-09 unchanged decision reuses locked asset", () => {
  const d = r.routeShot({ ...still, availability: quotaOk });
  const hit = r.reuseLocked(d, { assetHash: "h1", fingerprint: d.fingerprint });
  assert(hit.reuse === true && hit.state === "LOCKED", "reuse");
  const changed = r.routeShot({ ...still, targetRealism: "ILLUSTRATIVE", availability: quotaOk });
  assert(r.reuseLocked(changed, { assetHash: "h1", fingerprint: d.fingerprint }).reuse === false, "changed decision does not reuse");
});

runTest("ROUTE-10 motion-only patch dirties only motion", () => {
  const a = r.routeShot({ ...still, availability: quotaOk });
  const b = { ...a, motionEngine: "STATIC_HOLD" };
  const scope = r.dirtyScope(a, b);
  assert(scope.length === 1 && scope[0] === "MOTION", "motion only, no image/Veo/TTS");
});

runTest("ROUTE-11 missing rights/disclosure blocks final approval", () => {
  const d = r.routeShot({ ...still, availability: quotaOk });
  assert(d.rightsReviewStatus === "REVIEW_REQUIRED" && d.finalApprovalBlocked === true, "blocked until reviewed");
  const local = r.routeShot({ shotId: "S06", contentMode: "DIAGRAM", targetRealism: "ABSTRACT" });
  assert(local.finalApprovalBlocked === false, "original local graphics not blocked");
});

runTest("ROUTE-12 Veo native audio is not silently mixed", () => {
  assert(r.audioConflict({ hasNativeAudio: true }).action === "MUTE_OR_ROUTE_THROUGH_AUDIO_QA", "conflict routed");
  assert(r.audioConflict({ hasNativeAudio: false }).conflict === false, "silent clip fine");
});

runTest("ROUTE-13 realism required + no adequate source -> blocked, no silent SVG", () => {
  const d = r.routeShot({ ...still, realismRequired: true, availability: { flowQuota: { available: 0, costPerGeneration: 4 } } });
  assert(d.state === "BLOCKED" && d.status === "BLOCKED_BY_VISUAL_INPUT_OR_QUOTA", "blocked");
});

runTest("ROUTE-14 override needs reason and valid enums", () => {
  assert(r.routeShot({ ...still, override: { source: "PROCEDURAL_GRAPHICS", engine: "REMOTION_2D" } }).status === "BLOCKED_INVALID_OVERRIDE", "reason required");
  assert(r.routeShot({ ...still, override: { source: "X", engine: "REMOTION_2D", reason: "r" } }).status === "BLOCKED_INVALID_OVERRIDE", "enum checked");
  const ok = r.routeShot({ ...still, override: { source: "PROCEDURAL_GRAPHICS", engine: "REMOTION_2D", reason: "owner" } });
  assert(ok.visualSource === "PROCEDURAL_GRAPHICS" && ok.reasonCodes.includes("OWNER_OVERRIDE"), "override applied");
});

runTest("ROUTE-15 repeated identical treatment is flagged", () => {
  const mk = (id, p) => ({ shotId: id, visualSource: "PROCEDURAL_GRAPHICS", motionEngine: "REMOTION_2D", primitive: p });
  const flags = r.treatmentRepetition([mk("a", "T"), mk("b", "T"), mk("c", "T"), mk("d", "T"), mk("e", "X")], 3);
  assert(flags.length === 1 && flags[0].run === 4, "run of 4 flagged");
});

runTest("ROUTE-16 reconnect does not double-spend", () => {
  const l = r.createCreditLedger({ cap: 80 });
  l.reserve({ correlationId: "job-x", shotId: "S01", cost: 10 });
  const again = l.reserve({ correlationId: "job-x", shotId: "S01", cost: 10 });
  assert(again.duplicate === true && l.spent() === 10, "idempotent");
});

runTest("ROUTE-17 generated asset needs hash and lineage", () => {
  assert(r.validateLineage({ assetHash: "h", producer: "p", promptVersion: "1", generationJobId: "j" }).ok, "complete");
  assert(r.validateLineage({ assetHash: "h" }).missing.length === 3, "incomplete rejected");
});

runTest("ROUTE-18 routing does not mutate inputs (6A pilot untouched)", () => {
  const input = Object.freeze({ ...still, availability: Object.freeze({ ...quotaOk }) });
  r.routeShot(input);
  assert(input.shotId === "S01", "frozen input accepted, no writes");
  assert(r.RENDER_MODE_TO_MOTION.REMOTION_MOTION === "REMOTION_2D", "existing render modes map onto the new axis");
});

console.log(`\n=== visual-routing: ${failed} failed, ${passed} passed ===`);
process.exit(failed > 0 ? 1 : 0);
