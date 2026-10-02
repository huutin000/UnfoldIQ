"use strict";
// STEP-13 Branch C — pipeline-state tests PS1-PS12 via the real state-store
// (+Ajv schema, input-fingerprint, invalidation). No production data.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const PID = "__13_ps__";
const Store = require("../../pipeline/state-store.js");
const Fp = require("../../pipeline/input-fingerprint.js");
const Inv = require("../../pipeline/invalidation.js");

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
function stateAbs() { return path.join(projDir(), "pipeline", "state.json"); }
function cleanup() {
  try { fs.rmSync(projDir(), { recursive: true, force: true }); } catch (e) {}
  try {
    const Stager = require("../../lib/asset-stager.js");
    Stager.cleanStale({ projectRoot: ROOT, projectId: PID });
  } catch (e) {}
}

cleanup();

runTest("PS1 transitions NEW->PREPARING->READY_TO_RENDER", () => {
  let s = Store.loadState(ROOT, PID);
  assert(s.status === "NEW", "fresh skeleton NEW");
  Store.saveState(ROOT, PID, s);
  s = Store.transition(ROOT, PID, "PREPARING", "T_PREP");
  assert(s.status === "PREPARING", "now PREPARING");
  s = Store.transition(ROOT, PID, "READY_TO_RENDER", "T_READY");
  assert(s.status === "READY_TO_RENDER", "now READY_TO_RENDER");
});

runTest("PS2 atomic persist/reload (state.json valid JSON round-trip)", () => {
  const s = Store.loadState(ROOT, PID);
  assert(s.status === "READY_TO_RENDER", "reloaded status kept, got " + s.status);
  const raw = fs.readFileSync(stateAbs(), "utf8");
  const back = JSON.parse(raw);
  assert(back.projectId === PID, "projectId round-trips");
  assert(Array.isArray(back.history) && back.history.length >= 3, "history persisted");
});

runTest("PS3 invalid jump NEW->RENDERING throws", () => {
  const PID2 = "__13_ps_bad__";
  try {
    let s = Store.loadState(ROOT, PID2);
    Store.saveState(ROOT, PID2, s);
    let threw = false;
    try {
      Store.transition(ROOT, PID2, "RENDERING", "T_BAD");
    } catch (e) {
      threw = /INVALID_PIPELINE_TRANSITION/.test(e.message);
    }
    assert(threw, "expected INVALID_PIPELINE_TRANSITION");
  } finally {
    try { fs.rmSync(path.join(ROOT, "projects", PID2), { recursive: true, force: true }); } catch (e) {}
  }
});

runTest("PS4 history appended on transition", () => {
  const before = Store.loadState(ROOT, PID).history.length;
  Store.transition(ROOT, PID, "RENDERING", "T_RENDER");
  const after = Store.loadState(ROOT, PID);
  assert(after.history.length === before + 1, "history grew by 1");
  assert(after.history[after.history.length - 1].event === "T_RENDER", "event recorded");
  // leave state in a reusable spot for later tests
  Store.transition(ROOT, PID, "RENDERED", "T_RENDERED");
});

runTest("PS5 fingerprint stable (same inputs equal)", () => {
  const docs = { renderInput: { a: 1 }, renderPlan: { b: 2 }, stagingManifest: { c: 3 } };
  const f1 = Fp.computeFingerprint(ROOT, PID, docs);
  const f2 = Fp.computeFingerprint(ROOT, PID, docs);
  assert(f1.fingerprintId === f2.fingerprintId, "stable id " + f1.fingerprintId);
});

runTest("PS6 caption change invalidates downstream (RENDER_PLAN+OUTPUT+QA)", () => {
  const s = Store.loadState(ROOT, PID);
  const r = Inv.invalidateOnChange(s, "captions");
  assert(r.invalidatedCheckpoints.indexOf("RENDER_PLAN") !== -1, "RENDER_PLAN invalidated");
  assert(r.invalidatedCheckpoints.indexOf("RENDER_OUTPUT") !== -1, "RENDER_OUTPUT invalidated");
  assert(r.invalidatedCheckpoints.indexOf("TECHNICAL_QA") !== -1, "TECHNICAL_QA invalidated");
});

runTest("PS7 image change invalidates staging+render+QA", () => {
  const s = Store.loadState(ROOT, PID);
  const r = Inv.invalidateOnChange(s, "image-asset");
  ["ASSET_STAGING", "RENDER_PLAN", "RENDER_OUTPUT", "TECHNICAL_QA"].forEach((k) => {
    assert(r.invalidatedCheckpoints.indexOf(k) !== -1, k + " invalidated");
  });
});

runTest("PS8 report change invalidates nothing", () => {
  const s = Store.loadState(ROOT, PID);
  const r = Inv.invalidateOnChange(s, "report-history");
  assert(r.invalidatedCheckpoints.length === 0, "empty, got " + JSON.stringify(r.invalidatedCheckpoints));
});

runTest("PS9 final stale after input change (fingerprint compare)", () => {
  const docs = { renderInput: { cap: "v1" }, renderPlan: { p: 1 }, stagingManifest: null };
  const before = Fp.computeFingerprint(ROOT, PID, docs);
  const after = Fp.computeFingerprint(ROOT, PID, { renderInput: { cap: "v2" }, renderPlan: { p: 1 }, stagingManifest: null });
  const cmp = Fp.compareFingerprints(before, after);
  assert(cmp.same === false, "fingerprints differ after caption change");
  assert(cmp.changedKeys.indexOf("captions") !== -1 || cmp.changedKeys.length > 0,
    "changedKeys flag the edit: " + cmp.changedKeys.join(","));
});

runTest("PS10 no secrets persisted (apiKey stripped from history detail)", () => {
  const s = Store.loadState(ROOT, PID);
  Store.appendHistory(s, "PS10_PROBE", { apiKey: "sk-test-should-be-stripped-123", note: "x" });
  Store.saveState(ROOT, PID, s);
  const raw = fs.readFileSync(stateAbs(), "utf8");
  assert(raw.indexOf("sk-test-should-be-stripped-123") === -1, "secret value absent from state file");
  assert(raw.indexOf("apiKey") === -1, "apiKey key absent from state file");
});

runTest("PS11 attempt history immutable (sealed field update throws)", () => {
  const s = Store.loadState(ROOT, PID);
  Store.addAttempt(s, {
    attemptId: "attempt-001", projectId: PID, number: 1,
    inputFingerprint: { fingerprintId: "ab12" }, renderPlanHash: "cd34",
    startedAt: new Date().toISOString(), status: "PENDING",
    outputPath: "render/attempts/attempt-001/output.mp4",
    renderConfig: { codec: "h264", concurrency: 2 },
    progress: { fraction: 0 }, artifacts: []
  });
  Store.saveState(ROOT, PID, s);
  let threw = false;
  try {
    Store.updateAttempt(s, "attempt-001", { outputPath: "render/attempts/attempt-001/other.mp4" });
  } catch (e) {
    threw = /IMMUTABLE_ATTEMPT_FIELD/.test(e.message);
  }
  assert(threw, "expected IMMUTABLE_ATTEMPT_FIELD for sealed outputPath");
  // mutable key still works
  Store.updateAttempt(s, "attempt-001", { status: "RUNNING" });
  assert(s.attempts[s.attempts.length - 1].status === "RUNNING", "mutable status updated");
  Store.saveState(ROOT, PID, s);
});

runTest("PS12 schema enforced (status NOPE rejected)", () => {
  const s = Store.loadState(ROOT, PID);
  s.status = "NOPE";
  let threw = false;
  try {
    Store.saveState(ROOT, PID, s);
  } catch (e) {
    threw = /RENDER_PROP_INVALID|schema|validation/i.test(e.message);
  }
  assert(threw, "expected schema rejection, got none");
});

cleanup();

console.log("\n=== SUMMARY test-pipeline-state PS1-PS12 ===");
console.log("passed=" + passed + " failed=" + failed);
console.log(failed === 0 ? "RESULT: PASS" : "RESULT: FAIL");
process.exit(failed === 0 ? 0 : 1);
