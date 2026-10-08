"use strict";
// tests/runtime/test-resource-budget.js — Phase 5C resource budget cases.

const rb = require("../../lib/resource-budget/index.js");

let passed = 0;
let failed = 0;
function runTest(name, fn) {
  return Promise.resolve().then(fn).then(
    () => { passed++; console.log("[PASS] " + name); },
    (e) => { failed++; console.log("[FAIL] " + name + ": " + ((e && e.message) || e)); });
}
function assert(c, m) { if (!c) throw new Error("ASSERT: " + m); }

(async () => {
await runTest("default profile has sensible values", () => {
  const profile = rb.defaultBudgetProfile();
  assert(profile.cpu.maxActiveWeight > 0, "cpu limit");
  assert(profile.memory.softLimitBytes < profile.memory.hardLimitBytes, "soft < hard");
  assert(profile.render.maxBrowsers > 0, "maxBrowsers");
  assert(profile.queue.maxJobs > 0, "maxJobs");
});

await runTest("admit respects render browser limit", () => {
  const mgr = rb.createBudgetManager({ maxBrowsers: 1 });
  const item = { requiredResources: [{ type: "RENDER_BROWSER", amount: 1 }] };
  assert(mgr.admit(item).ok === true, "first admits");
  mgr.reserve(item);
  assert(mgr.admit(item).ok === false, "second blocked");
  assert(mgr.admit(item).reason === "RENDER_BROWSER_EXHAUSTED", "correct reason");
  mgr.release(item);
  assert(mgr.admit(item).ok === true, "released allows new");
});

await runTest("admit respects provider slot limit", () => {
  const mgr = rb.createBudgetManager({ providers: { "prov-1": { maxConcurrent: 1, creditBudget: 100 } } });
  const item = { requiredResources: [{ type: "PROVIDER_SLOT", providerId: "prov-1", amount: 1 }] };
  assert(mgr.admit(item).ok === true, "first admits");
  mgr.reserve(item);
  assert(mgr.admit(item).ok === false, "second blocked");
  assert(mgr.admit(item).reason === "PROVIDER_SLOT_EXHAUSTED", "correct reason");
});

await runTest("admit respects memory hard limit", () => {
  const mgr = rb.createBudgetManager({ hardLimitBytes: 1000, softLimitBytes: 800, reserveBytes: 100 });
  const item = { requiredResources: [{ type: "MEMORY", amount: 600 }] };
  assert(mgr.admit(item).ok === true, "first admits");
  mgr.reserve(item);
  const item2 = { requiredResources: [{ type: "MEMORY", amount: 500 }] };
  assert(mgr.admit(item2).ok === false, "second exceeds hard limit");
  assert(mgr.admit(item2).reason === "MEMORY_BACKPRESSURE", "correct reason");
});

await runTest("admit respects credit budget", () => {
  const mgr = rb.createBudgetManager({ providers: { "prov-1": { maxConcurrent: 2, creditBudget: 10 } } });
  const item = { requiredResources: [{ type: "CREDIT", providerId: "prov-1", amount: 6 }] };
  assert(mgr.admit(item).ok === true, "first admits");
  mgr.reserve(item);
  const item2 = { requiredResources: [{ type: "CREDIT", providerId: "prov-1", amount: 6 }] };
  assert(mgr.admit(item2).ok === false, "second exceeds credit budget");
  assert(mgr.admit(item2).reason === "CREDIT_BACKPRESSURE", "correct reason");
});

await runTest("admit respects queue capacity", () => {
  const mgr = rb.createBudgetManager({ maxJobs: 2 });
  const item = { requiredResources: [{ type: "QUEUE_CAPACITY", amount: 1 }] };
  mgr.reserve(item);
  mgr.reserve(item);
  const item2 = { requiredResources: [{ type: "QUEUE_CAPACITY", amount: 1 }] };
  assert(mgr.admit(item2).ok === false, "queue full");
  assert(mgr.admit(item2).reason === "QUEUE_CAPACITY_EXCEEDED", "correct reason");
});

await runTest("backpressureState reports pressure correctly", () => {
  const mgr = rb.createBudgetManager({ hardLimitBytes: 1000 });
  assert(mgr.backpressureState().includes("CAPACITY_AVAILABLE"), "initially available");
  mgr.reserve({ requiredResources: [{ type: "MEMORY", amount: 1000 }] });
  assert(mgr.backpressureState().includes("MEMORY_BACKPRESSURE"), "hard limit => backpressure");
});

await runTest("snapshot includes all budgets", () => {
  const mgr = rb.createBudgetManager();
  const snap = mgr.snapshot();
  assert(snap.profile && snap.budgets && snap.backpressure, "snapshot structure");
});

console.log("\n=== resource-budget: " + passed + " passed, " + failed + " failed ===");
process.exit(failed > 0 ? 1 : 0);
})();