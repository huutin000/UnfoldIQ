"use strict";
// STEP-13 Branch C — auto-fix tests AF1-AF12 via the real pipeline/auto-fix.js
// (+ render-config bounds). Fixture project projects/__13_af__/, cleaned up.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const PID = "__13_af__";
const AF = require("../../pipeline/auto-fix.js");
const Cfg = require("../../pipeline/render-config.js");
const Store = require("../../pipeline/state-store.js");
const Stager = require("../../lib/asset-stager.js");

const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

let passed = 0;
let failed = 0;
function runTest(name, fn) {
  console.log("[TEST] " + name);
  try {
    fn();
    console.log("[PASS] " + name);
    passed++;
  } catch (e) {
    console.log("[FAIL] " + name + ": " + ((e && e.stack) || (e && e.message) || String(e)));
    failed++;
  }
}
function assert(c, m) { if (!c) throw new Error("ASSERT: " + m); }
function projDir() { return path.join(ROOT, "projects", PID); }
function wjson(rel, obj) {
  const abs = path.join(projDir(), rel.split("/").join(path.sep));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(obj, null, 2));
}
function typesOf(plan) { return (plan.actions || []).map((a) => a.type); }
function cleanup() {
  try { fs.rmSync(projDir(), { recursive: true, force: true }); } catch (e) {}
  try { Stager.cleanStale({ projectRoot: ROOT, projectId: PID }); } catch (e) {}
  try { fs.rmSync(path.join(ROOT, "out", PID), { recursive: true, force: true }); } catch (e) {}
}
function setupBase(opts) {
  opts = opts || {};
  cleanup();
  fs.mkdirSync(path.join(projDir(), "assets"), { recursive: true });
  fs.writeFileSync(path.join(projDir(), "assets", "img.png"), Buffer.from(PNG_B64, "base64"));
  wjson("asset-manifest.json", { assets: [
    { assetId: "IMG01", type: "image", path: "assets/img.png", status: "READY", sceneIds: ["S01"] }
  ]});
  wjson("captions/captions.json", { mode: "BOTH", items: [
    { captionId: "cap_001", startMs: 100, endMs: 900, text: "Fix line", sceneId: "S01" }
  ]});
  if (opts.badCaptions) {
    fs.writeFileSync(path.join(projDir(), "captions", "captions.json"), "{not valid json");
  }
  // fresh pipeline state so the fix-cycle budget starts at 0
  const s = Store.loadState(ROOT, PID);
  Store.saveState(ROOT, PID, s);
}
function stagedImgAbs() {
  const man = JSON.parse(fs.readFileSync(
    path.join(projDir(), "render", "staging-manifest.json"), "utf8"));
  const e = man.entries.filter((x) => x.assetId === "IMG01")[0];
  return path.join(ROOT, "remotion", "public", e.stagedPath.split("/").join(path.sep));
}

setupBase();

runTest("AF1 restage derived asset (deleted staged copy rebuilt)", () => {
  const plan = AF.planFix({ projectRoot: ROOT, projectId: PID,
    attempt: { attemptId: "attempt-001", projectId: PID,
      error: { errorClass: "ASSET_MISSING", detail: "source missing for IMG01" } },
    issues: [{ code: "ASSET_MISSING", assetId: "IMG01" }] });
  assert(typesOf(plan).indexOf("RESTAGE_ASSET") !== -1, "RESTAGE_ASSET planned");
  assert(plan.riskClass === "SAFE_AUTOMATIC", "safe automatic, got " + plan.riskClass);
  const applied = AF.applyFix({ projectRoot: ROOT, projectId: PID, plan: plan });
  assert(applied.ok, "applied");
  const staged = stagedImgAbs();
  assert(fs.existsSync(staged), "staged copy exists");
  fs.rmSync(staged, { force: true });
  assert(!fs.existsSync(staged), "deleted for rebuild probe");
  // mark the consumed cycle so the next plan starts clean, then rebuild again
  const s = Store.loadState(ROOT, PID);
  Store.addAttempt(s, { attemptId: "attempt-001", projectId: PID, number: 1,
    inputFingerprint: {}, renderPlanHash: "x", startedAt: new Date().toISOString(),
    status: "FAILED", outputPath: "render/attempts/attempt-001/output.mp4",
    renderConfig: {}, progress: { fraction: 0 }, artifacts: [], fixPlan: plan });
  Store.saveState(ROOT, PID, s);
  const entries = Stager.stageAssets({ projectRoot: ROOT, projectId: PID,
    assets: [{ assetId: "IMG01", sourcePath: "assets/img.png", type: "image" }] });
  assert(entries.length === 1, "restaged");
  assert(fs.existsSync(stagedImgAbs()), "staged copy rebuilt");
});

runTest("AF2 missing source -> UPSTREAM_REQUIRED", () => {
  setupBase();
  wjson("asset-manifest.json", { assets: [
    { assetId: "GHOST01", type: "image", path: "assets/gone.png", status: "READY", sceneIds: ["S01"] }
  ]});
  const plan = AF.planFix({ projectRoot: ROOT, projectId: PID,
    attempt: { attemptId: "attempt-001", projectId: PID,
      error: { errorClass: "ASSET_MISSING", detail: "source missing for GHOST01" } },
    issues: [{ code: "ASSET_MISSING", assetId: "GHOST01" }] });
  assert(plan.riskClass === "UPSTREAM_REQUIRED", "upstream, got " + plan.riskClass);
});

runTest("AF3 lower concurrency action for resource pressure", () => {
  setupBase();
  const plan = AF.planFix({ projectRoot: ROOT, projectId: PID,
    attempt: { attemptId: "attempt-001", projectId: PID,
      error: { errorClass: "TARGET_CLOSED", detail: "target closed" } },
    issues: [{ code: "TARGET_CLOSED" }] });
  assert(typesOf(plan).indexOf("LOWER_CONCURRENCY") !== -1, "LOWER_CONCURRENCY planned");
});

runTest("AF4 timeout raise bounded (clamp refuses over-bound)", () => {
  const within = Cfg.resolveConfig({ timeoutMs: 1200000 });
  assert(within.timeoutMs === 1200000, "within bound kept");
  const over = Cfg.resolveConfig({ timeoutMs: 99999999 });
  assert(over.timeoutMs === 3600000, "over-bound clamped to 3600000, got " + over.timeoutMs);
  const under = Cfg.resolveConfig({ timeoutMs: 1000 });
  assert(under.timeoutMs === 60000, "under-bound clamped to 60000, got " + under.timeoutMs);
});

runTest("AF5 regenerate SRT from canonical captions.json", () => {
  setupBase();
  const plan = AF.planFix({ projectRoot: ROOT, projectId: PID,
    attempt: { attemptId: "attempt-001", projectId: PID,
      error: { errorClass: "TIMEOUT", detail: "timed out" } },
    issues: [{ code: "TIMEOUT" }],
    qaResults: { captionsStale: true } });
  assert(typesOf(plan).indexOf("REGENERATE_SRT_VTT") !== -1, "regeneration planned");
  assert(plan.riskClass === "SAFE_AUTOMATIC", "safe, got " + plan.riskClass);
  const applied = AF.applyFix({ projectRoot: ROOT, projectId: PID, plan: plan });
  assert(applied.ok, "applied");
  const srt = fs.readFileSync(path.join(projDir(), "captions", "captions.srt"), "utf8");
  const vtt = fs.readFileSync(path.join(projDir(), "captions", "captions.vtt"), "utf8");
  assert(srt.indexOf("Fix line") !== -1, "srt carries canonical text");
  assert(vtt.indexOf("WEBVTT") === 0, "vtt header");
});

runTest("AF6 invalid canonical captions -> no fix, error", () => {
  setupBase({ badCaptions: true });
  const plan = AF.planFix({ projectRoot: ROOT, projectId: PID,
    attempt: { attemptId: "attempt-001", projectId: PID,
      error: { errorClass: "TIMEOUT", detail: "timed out" } },
    issues: [{ code: "TIMEOUT" }],
    qaResults: { captionsStale: true } });
  assert(typesOf(plan).indexOf("REGENERATE_SRT_VTT") !== -1, "planned before validation");
  let threw = false;
  try {
    AF.applyFix({ projectRoot: ROOT, projectId: PID, plan: plan });
  } catch (e) {
    threw = true;
    console.log("  refused as expected: " + String(e.message).slice(0, 120));
  }
  assert(threw, "applyFix must throw on invalid canonical captions");
});

runTest("AF7 SCRIPT_REWRITE -> FORBIDDEN_FIX", () => {
  let threw = false;
  try {
    AF.applyFix({ projectRoot: ROOT, projectId: PID,
      plan: { planId: "x", riskClass: "SAFE_AUTOMATIC",
        actions: [{ type: "SCRIPT_REWRITE", params: {} }] } });
  } catch (e) {
    threw = /FORBIDDEN_FIX/.test(e.message);
  }
  assert(threw, "FORBIDDEN_FIX");
  assert(AF.FORBIDDEN_ACTIONS.indexOf("SCRIPT_REWRITE") !== -1, "listed forbidden");
});

runTest("AF8 AI_REGENERATE -> forbidden", () => {
  let threw = false;
  try {
    AF.applyFix({ projectRoot: ROOT, projectId: PID,
      plan: { planId: "x", riskClass: "SAFE_AUTOMATIC",
        actions: [{ type: "AI_REGENERATE", params: {} }] } });
  } catch (e) {
    threw = /FORBIDDEN_FIX/.test(e.message);
  }
  assert(threw, "FORBIDDEN_FIX");
});

runTest("AF9 PROVIDER_CALL -> forbidden", () => {
  let threw = false;
  try {
    AF.applyFix({ projectRoot: ROOT, projectId: PID,
      plan: { planId: "x", riskClass: "SAFE_AUTOMATIC",
        actions: [{ type: "PROVIDER_CALL", params: {} }] } });
  } catch (e) {
    threw = /FORBIDDEN_FIX/.test(e.message);
  }
  assert(threw, "FORBIDDEN_FIX");
  assert(AF.ALLOWED_ACTIONS.indexOf("PROVIDER_CALL") === -1, "not in allowed set");
});

runTest("AF10 black-tail timing fix only with evidence (else review-required)", () => {
  // Adapted: auto-fix exposes no tail-trimming action (content/timing edits
  // are never automatic). A black-tail report without an approved evidence
  // ref must stay REVIEW_REQUIRED, never SAFE_AUTOMATIC.
  setupBase();
  const plan = AF.planFix({ projectRoot: ROOT, projectId: PID,
    attempt: { attemptId: "attempt-001", projectId: PID,
      error: { errorClass: "UNKNOWN", detail: "black tail 2500ms, no evidence ref" } },
    issues: [{ code: "BLACK_TAIL", note: "black tail without evidence" }] });
  assert(plan.riskClass !== "SAFE_AUTOMATIC",
    "no evidence -> not automatic, got " + plan.riskClass);
  let threw = false;
  try {
    AF.applyFix({ projectRoot: ROOT, projectId: PID, plan: plan });
  } catch (e) {
    threw = e && e.code === "APPROVAL_REQUIRED";
  }
  assert(threw, "applyFix refuses without approval");
});

runTest("AF11 content gap not hidden (no drop/shorten/pad actions)", () => {
  const joined = AF.ALLOWED_ACTIONS.join(" ").toUpperCase();
  ["DROP", "SHORTEN", "PAD", "MUTE", "SKIP"].forEach((tok) => {
    assert(joined.indexOf(tok) === -1, "allowed set contains no " + tok);
  });
  assert(AF.FORBIDDEN_ACTIONS.join(" ").indexOf("DROP_CAPTION") !== -1, "DROP_CAPTION forbidden");
});

runTest("AF12 max cycles enforced (applyFix refuses when exhausted)", () => {
  setupBase();
  const s = Store.loadState(ROOT, PID);
  const mkPlan = { riskClass: "SAFE_AUTOMATIC", actions: [] };
  Store.addAttempt(s, { attemptId: "attempt-001", projectId: PID, number: 1,
    inputFingerprint: {}, renderPlanHash: "x", startedAt: new Date().toISOString(),
    status: "FAILED", outputPath: "a", renderConfig: {}, progress: { fraction: 0 },
    artifacts: [], fixPlan: mkPlan });
  Store.addAttempt(s, { attemptId: "attempt-002", projectId: PID, number: 2,
    inputFingerprint: {}, renderPlanHash: "x", startedAt: new Date().toISOString(),
    status: "FAILED", outputPath: "b", renderConfig: {}, progress: { fraction: 0 },
    artifacts: [], fixPlan: mkPlan });
  Store.saveState(ROOT, PID, s);
  let threw = false;
  try {
    AF.applyFix({ projectRoot: ROOT, projectId: PID,
      plan: { planId: "x", riskClass: "SAFE_AUTOMATIC", actions: [{ type: "CLEAN_TEMP" }] } });
  } catch (e) {
    threw = /MAX_FIX_CYCLES/.test(e.message);
  }
  assert(threw, "MAX_FIX_CYCLES refused");
});

cleanup();

console.log("\n=== SUMMARY test-auto-fix AF1-AF12 ===");
console.log("passed=" + passed + " failed=" + failed);
console.log(failed === 0 ? "RESULT: PASS" : "RESULT: FAIL");
process.exit(failed === 0 ? 0 : 1);
