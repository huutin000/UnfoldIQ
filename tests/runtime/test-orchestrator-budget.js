"use strict";
// tests/runtime/test-orchestrator-budget.js — Phase 5C (5.5): render-budget
// gate in render-orchestrator. No real renders; temp projectRoot only.

const fs = require("fs");
const os = require("os");
const path = require("path");

const Orch = require("../../pipeline/render-orchestrator.js");

let passed = 0;
let failed = 0;
function runTest(name, fn) {
  return Promise.resolve().then(fn).then(
    () => { passed++; console.log("[PASS] " + name); },
    (e) => { failed++; console.log("[FAIL] " + name + ": " + ((e && e.message) || e)); });
}
function assert(c, m) { if (!c) throw new Error("ASSERT: " + m); }

function mkRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "5c-budget-"));
}
function writeState(root, pid, status) {
  const dir = path.join(root, "projects", pid, "pipeline");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify({
    version: "1.0.0", projectId: pid, status: status,
    currentStage: null, inputFingerprint: null, checkpoints: {},
    attempts: [], qa: null, issues: [], blockers: [], history: [],
  }));
}
function rmRoot(root) { try { fs.rmSync(root, { recursive: true, force: true }); } catch (e) {} }

(async () => {
await runTest("empty root admits (cap default 2)", () => {
  const root = mkRoot();
  try {
    delete process.env.UNFOLDIQ_MAX_CONCURRENT_RENDERS;
    const r = Orch.renderBudgetPrecheck(root, "new-proj");
    assert(r.ok === true, "admits, got " + JSON.stringify(r));
    assert(r.cap === 2, "default cap 2");
  } finally { rmRoot(root); }
});

await runTest("at-cap blocks with RENDER_CAPACITY_EXHAUSTED", () => {
  const root = mkRoot();
  try {
    delete process.env.UNFOLDIQ_MAX_CONCURRENT_RENDERS;
    writeState(root, "proj-a", "RENDERING");
    writeState(root, "proj-b", "RENDERING");
    const r = Orch.renderBudgetPrecheck(root, "proj-c");
    assert(r.ok === false, "blocked, got " + JSON.stringify(r));
    assert(r.code === "RENDER_CAPACITY_EXHAUSTED", "code, got " + r.code);
    assert(r.active.length === 2, "lists active renders");
  } finally { rmRoot(root); }
});

await runTest("own RENDERING slot never blocks self", () => {
  const root = mkRoot();
  try {
    delete process.env.UNFOLDIQ_MAX_CONCURRENT_RENDERS;
    writeState(root, "proj-a", "RENDERING");
    writeState(root, "proj-b", "RENDERING");
    const r = Orch.renderBudgetPrecheck(root, "proj-a");
    assert(r.ok === true, "self excluded, got " + JSON.stringify(r));
  } finally { rmRoot(root); }
});

await runTest("env override raises cap", () => {
  const root = mkRoot();
  try {
    process.env.UNFOLDIQ_MAX_CONCURRENT_RENDERS = "3";
    assert(Orch.maxConcurrentRenders() === 3, "cap 3");
    writeState(root, "proj-a", "RENDERING");
    writeState(root, "proj-b", "RENDERING");
    const r = Orch.renderBudgetPrecheck(root, "proj-c");
    assert(r.ok === true, "admits under raised cap");
  } finally { delete process.env.UNFOLDIQ_MAX_CONCURRENT_RENDERS; rmRoot(root); }
});

await runTest("non-rendering statuses do not consume budget", () => {
  const root = mkRoot();
  try {
    delete process.env.UNFOLDIQ_MAX_CONCURRENT_RENDERS;
    writeState(root, "proj-a", "RENDERED");
    writeState(root, "proj-b", "READY_TO_RENDER");
    const r = Orch.renderBudgetPrecheck(root, "proj-c");
    assert(r.ok === true, "admits");
    assert((r.active || []).length === 0, "no active renders");
  } finally { rmRoot(root); }
});

console.log("\n=== orchestrator-budget: " + passed + " passed, " + failed + " failed ===");
process.exit(failed > 0 ? 1 : 0);
})();
