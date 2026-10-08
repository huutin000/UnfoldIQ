"use strict";
// tests/incremental/test-partial-qa.js — Phase 5B partial-QA cases:
// U (local) · V (boundary) · W (global mandatory) · Y (coverage) ·
// QC consolidation (no merge without proof) · AL (QA metrics) · registry.
// Fast: one tiny lavfi clip, no browser renders.

const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const partialQA = require("../../lib/render/partial-qa.js");
const renderCache = require("../../lib/render-cache/index.js");
const render = require("../../lib/render/index.js");

let passed = 0;
let failed = 0;
function runTest(name, fn) {
  return Promise.resolve().then(fn).then(
    () => { passed++; console.log("[PASS] " + name); },
    (e) => { failed++; console.log("[FAIL] " + name + ": " + ((e && e.message) || e)); });
}
function assert(c, m) { if (!c) throw new Error("ASSERT: " + m); }
function sh(cmd, args, timeout) {
  return childProcess.spawnSync(cmd, args, { encoding: "utf8", timeout: timeout || 120000, maxBuffer: 32 * 1024 * 1024, cwd: ROOT });
}

(async () => {
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "5b-pqa-"));
const clip = path.join(scratch, "black2s.mp4");
assert(sh("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=black:s=640x360:r=30:d=2", "-pix_fmt", "yuv420p", clip]).status === 0, "setup clip");

await runTest("registry: every rule declares scope + deps + invalidation", () => {
  const rules = partialQA.QA_RULES;
  assert(Object.keys(rules).length >= 14, "14 rules registered");
  for (const [id, r] of Object.entries(rules)) {
    assert(["LOCALIZABLE", "BOUNDARY_SENSITIVE", "GLOBAL_MANDATORY", "NON_CACHEABLE"].includes(r.scope), id + " scope");
    assert(Array.isArray(r.dependsOn) && Array.isArray(r.invalidatedBy) && typeof r.cacheable === "boolean", id + " contract");
    assert(Number.isInteger(r.contextBeforeFrames) && Number.isInteger(r.contextAfterFrames), id + " context");
  }
  assert(partialQA.GLOBAL_MANDATORY.includes("decode") && partialQA.GLOBAL_MANDATORY.includes("duration") &&
    partialQA.GLOBAL_MANDATORY.includes("profile") && partialQA.GLOBAL_MANDATORY.includes("audioStream"), "global invariants listed");
});

await runTest("U local QA: only affected checks + context run", async () => {
  const plan = partialQA.planPartialQA({
    dirtyRanges: [{ startFrame: 60, endFrameExclusive: 120 }],
    changedKeys: ["timeline"], totalFrames: 120, artifactHashes: {},
  });
  const ids = plan.localChecks.map((c) => c.qaRuleId);
  assert(ids.includes("black") && ids.includes("freeze") && ids.includes("safeZone"), "local rules planned: " + ids.join(","));
  assert(!ids.includes("decode") && !ids.includes("duration"), "global rules NOT in local checks");
  // Execute black locally on the clip: candidates found, intent-covered PASS.
  const det = render.probe.detectBlack(clip);
  assert(det.ranges.length > 0, "local detector runs on range file");
  const findings = render.qc.checkBlack(det.ranges, { expectedBlackRanges: [{ start: 0, end: 2 }] });
  assert(findings.length === 0, "local PASS with intent");
});

await runTest("V boundary QA: neighbors + rule context checked", () => {
  const plan = partialQA.planPartialQA({
    dirtyRanges: [{ startFrame: 60, endFrameExclusive: 120 }],
    boundaryRanges: [{ startFrame: 30, endFrameExclusive: 120 }],
    changedKeys: ["timeline"], totalFrames: 120, artifactHashes: {},
  });
  const av = plan.boundaryChecks.find((c) => c.qaRuleId === "avSync");
  const flash = plan.boundaryChecks.find((c) => c.qaRuleId === "flash");
  const dup = plan.boundaryChecks.find((c) => c.qaRuleId === "duplicates");
  assert(av && flash && dup, "boundary-sensitive rules planned");
  assert(av.ranges[0].startFrame === 15, "avSync context -15 frames: " + JSON.stringify(av.ranges));
  assert(flash.ranges[0].startFrame === 0, "flash context -30 frames (clamped)");
});

await runTest("W mandatory global QC still runs on final", () => {
  const plan = partialQA.planPartialQA({ dirtyRanges: [], changedKeys: [], totalFrames: 120, artifactHashes: {} });
  assert(plan.localChecks.length === 0 && plan.boundaryChecks.length === 0, "no dirty, no scoped checks");
  assert(plan.globalChecks.length === 4, "4 global invariants still required: " + plan.globalChecks.join(","));
  // Execute globals on the clip (decode + duration + profile-shape).
  const pr = render.probe.probeFile(clip);
  assert(pr.ok, "decode global executes");
  const dur = render.qc.validateDuration({ duration: pr.evidence.format.duration }, 2000, 0.6);
  assert(dur.ok !== false, "duration global executes: " + JSON.stringify(dur).slice(0, 120));
});

await runTest("stale PASS never survives invalidation (L-policy + rights)", () => {
  const stored = { result: "PASS", qaKey: "k1" };
  assert(!partialQA.isPassReusable(stored, { qaKey: "k2" }).reusable, "changed key invalidates");
  assert(!partialQA.isPassReusable(stored, { qaKey: "k1" }, { rightsOk: () => false }).reusable, "rights change invalidates");
  assert(partialQA.isPassReusable(stored, { qaKey: "k1" }, { rightsOk: () => true }).reusable, "valid reuse allowed");
  const plan = partialQA.planPartialQA({
    dirtyRanges: [{ startFrame: 0, endFrameExclusive: 60 }],
    changedKeys: ["platformProfile"], totalFrames: 120, artifactHashes: {},
    qaLookup: () => ({ status: "HIT_VALID", cachedArtifactRef: "CAS/sha256/x" }),
  });
  assert(plan.invalidatedQAResults.length > 0, "policy-affected results invalidated: " + plan.invalidatedQAResults.length);
  assert(plan.reusedQAResults.length === 0 || plan.changedDependencies.length > 0, "no silent reuse");
});

await runTest("Y final coverage = valid reuse + fresh local + boundary + global", () => {
  const plan = partialQA.planPartialQA({
    dirtyRanges: [{ startFrame: 60, endFrameExclusive: 120 }],
    boundaryRanges: [{ startFrame: 30, endFrameExclusive: 120 }],
    changedKeys: ["timeline"], totalFrames: 120, artifactHashes: {},
  });
  const fresh = plan.localChecks.map((c) => ({ qaRuleId: c.qaRuleId, scope: "local", result: "PASS" }))
    .concat(plan.boundaryChecks.map((c) => ({ qaRuleId: c.qaRuleId, scope: "boundary", result: "PASS" })))
    .concat(plan.globalChecks.map((g) => ({ qaRuleId: g, scope: "global", result: "PASS" })));
  const cov = partialQA.coverageComplete(plan, fresh);
  assert(cov.complete, "coverage complete: " + JSON.stringify(cov.missing));
  const partial = partialQA.coverageComplete(plan, []);
  assert(!partial.complete && partial.missing.length > 0, "empty results honestly incomplete");
});

await runTest("QC consolidation: no detector merge without equivalence proof", () => {
  const plan = partialQA.planPartialQA({
    dirtyRanges: [{ startFrame: 0, endFrameExclusive: 120 }],
    changedKeys: ["timeline"], totalFrames: 120, artifactHashes: {},
  });
  const ids = plan.localChecks.map((c) => c.qaRuleId);
  assert(ids.includes("black") && ids.includes("freeze") && ids.includes("silence"), "detectors stay independent");
  assert(new Set(ids).size === ids.length, "no merged checks: " + ids.join(","));
});

await runTest("AL QA metrics: reused/rerun/invalidated visible", () => {
  const m = renderCache.newMetrics();
  m.qaReused = 0; m.qaRerun = 0; m.qaInvalidated = 0;
  const plan = partialQA.planPartialQA({
    dirtyRanges: [{ startFrame: 60, endFrameExclusive: 120 }],
    changedKeys: ["timeline"], totalFrames: 120, artifactHashes: {},
  });
  m.qaRerun = plan.localChecks.length + plan.boundaryChecks.length;
  m.qaInvalidated = plan.invalidatedQAResults.length;
  m.qaReused = plan.reusedQAResults.length;
  assert(m.qaRerun > 0 && m.qaInvalidated >= 0, `rerun=${m.qaRerun} invalidated=${m.qaInvalidated} reused=${m.qaReused}`);
});

try { fs.rmSync(scratch, { recursive: true, force: true }); } catch (e) {}
console.log("\n=== partial-qa: " + passed + " passed, " + failed + " failed ===");
process.exit(failed > 0 ? 1 : 0);
})();
