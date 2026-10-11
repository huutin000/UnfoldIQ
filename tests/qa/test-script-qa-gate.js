"use strict";

/**
 * Script Quality Gate: a missing, non-READY or stale Script QA decision blocks
 * production TTS in the TTS-ready plan; legacy plans (no flag) are unchanged.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO = path.join(__dirname, "..", "..");
const tp = require(REPO + "/lib/tts-ready-plan.js");
const gate = require(REPO + "/lib/script-qa/gate.js");
const dag = require(REPO + "/lib/dependency-dag/index.js");

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

const script = { scriptArtifactId: "fss-gate-test", scriptVersion: 1, language: "en-us", segments: [{ segmentId: "S1", text: "Hello world." }], provenance: { productionScriptStatus: "CANONICAL" } };
const pass = { pronunciationPassId: "prp-gate", scriptRef: { scriptArtifactId: "fss-gate-test", scriptVersion: 1 }, provider: "local-kokoro", providerModel: "kokoro-v1", segments: [{ segmentId: "S1", status: "CLEAN", compiledInputHash: "abc" }] };
const qa = (verdict) => ({ verdict, requirements: [], open: [], scenes: 1, words: 2, durationBasis: "MEASURED" });
const decision = (verdict, segments = script.segments) => gate.buildDecision({ qaResult: qa(verdict), scriptArtifactId: "fss-gate-test", scriptVersion: 1, segments, ledgerVersion: "t" });
const approved = (d) => gate.withOwnerApproval(d, { approvedBy: "owner", source: "test fixture" });

function plan(input) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "script-qa-gate-"));
  const r = tp.buildTtsReadyPlan(root, "gate-project", { scriptDoc: script, passDoc: pass, voiceBibleRef: "vb", ...input });
  fs.rmSync(root, { recursive: true, force: true });
  return r;
}

runTest("legacy plans without the flag are unchanged", () => {
  const r = plan({});
  assert(r.ok && r.plan.productionTtsBlocked === false && !r.plan.provenance.scriptQa, "not blocked, no scriptQa block recorded");
});

runTest("required gate blocks when the decision is missing, not READY or stale", () => {
  let r = plan({ requireScriptQa: true });
  assert(r.plan.productionTtsBlocked === true && r.plan.provenance.scriptQa.code === "SCRIPT_QA_MISSING", "missing decision blocks");
  r = plan({ requireScriptQa: true, scriptQaDecision: decision("REVIEW_REQUIRED") });
  assert(r.plan.productionTtsBlocked === true && r.plan.provenance.scriptQa.code === "SCRIPT_QA_NOT_READY", "REVIEW_REQUIRED blocks");
  r = plan({ requireScriptQa: true, scriptQaDecision: decision("FAIL") });
  assert(r.plan.productionTtsBlocked === true, "FAIL blocks");
  r = plan({ requireScriptQa: true, scriptQaDecision: approved(decision("READY_FOR_LOCK", [{ segmentId: "S1", text: "Hello there." }])) });
  assert(r.plan.productionTtsBlocked === true && r.plan.provenance.scriptQa.code === "SCRIPT_QA_STALE", "a decision for different text is stale");
});

runTest("READY_FOR_LOCK alone does not open the gate: owner approval is required", () => {
  const r = plan({ requireScriptQa: true, scriptQaDecision: decision("READY_FOR_LOCK") });
  assert(r.plan.productionTtsBlocked === true && r.plan.provenance.scriptQa.code === "SCRIPT_OWNER_APPROVAL_PENDING", "blocked until the owner approves");
  let threw = false;
  try { gate.withOwnerApproval(decision("READY_FOR_LOCK"), {}); } catch { threw = true; }
  assert(threw, "an approval needs an approver and a source");
  const forged = { ...approved(decision("READY_FOR_LOCK")), scriptTextHash: "ffffffffffffffff" };
  assert(plan({ requireScriptQa: true, scriptQaDecision: forged }).plan.provenance.scriptQa.code === "SCRIPT_QA_STALE", "approval bound to other text is stale");
});

runTest("READY_FOR_LOCK plus owner approval for exactly this text opens the gate, and plan ids differ per gate state", () => {
  const ready = plan({ requireScriptQa: true, scriptQaDecision: approved(decision("READY_FOR_LOCK")) });
  assert(ready.plan.productionTtsBlocked === false && ready.plan.provenance.scriptQa.ok === true, "gate open");
  const missing = plan({ requireScriptQa: true });
  assert(ready.plan.ttsReadyPlanId !== missing.plan.ttsReadyPlanId, "gated plans are not replayed across gate states");
  const legacy = plan({});
  assert(legacy.plan.ttsReadyPlanId !== ready.plan.ttsReadyPlanId, "gated plan id differs from the legacy id");
});

runTest("a non-canonical script stays blocked even with a READY decision", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "script-qa-gate-"));
  const pending = { ...script, provenance: { productionScriptStatus: "PENDING" } };
  const r = tp.buildTtsReadyPlan(root, "gate-project", { scriptDoc: pending, passDoc: pass, voiceBibleRef: "vb", requireScriptQa: true, scriptQaDecision: approved(decision("READY_FOR_LOCK")) });
  fs.rmSync(root, { recursive: true, force: true });
  assert(r.plan.productionTtsBlocked === true, "canonical requirement still applies");
});

runTest("DAG knows the SCRIPT_QA_DECISION artifact type", () => {
  assert(dag.ARTIFACT_TYPES.includes("SCRIPT_QA_DECISION"), "artifact type registered");
});

console.log(`\n=== script-qa-gate: ${failed} failed, ${passed} passed ===`);
process.exit(failed > 0 ? 1 : 0);
