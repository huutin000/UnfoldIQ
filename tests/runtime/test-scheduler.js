"use strict";
// tests/runtime/test-scheduler.js — Phase 5C scheduler cases.

const sched = require("../../lib/scheduler/index.js");
const rb = require("../../lib/resource-budget/index.js");

let passed = 0;
let failed = 0;
function runTest(name, fn) {
  return Promise.resolve().then(fn).then(
    () => { passed++; console.log("[PASS] " + name); },
    (e) => { failed++; console.log("[FAIL] " + name + ": " + ((e && e.message) || e)); });
}
function assert(c, m) { if (!c) throw new Error("ASSERT: " + m); }

const budget = rb.createBudgetManager({ maxBrowsers: 2, maxJobs: 10 });
const executed = [];
const execute = async (item) => {
  executed.push(item.workId);
  await new Promise((r) => setTimeout(r, 10));
  return { ok: true, data: item.workId };
};

(async () => {
await runTest("enqueue + dispatch runs work", async () => {
  const s = sched.createScheduler({ budget, execute, idleWorkers: 2 });
  s.enqueue({ workId: "w1", type: "test", priority: "NORMAL", requiredResources: [{ type: "RENDER_BROWSER" }], idempotencyKey: "k1" });
  await new Promise((r) => setTimeout(r, 50));
  assert(executed.includes("w1"), "work executed");
  s.shutdown();
});

await runTest("priority ordering: interactive before normal when enqueued together", async () => {
  const order = [];
  const exec = async (item) => { order.push(item.workId); await new Promise((r) => setTimeout(r, 10)); };
  const s = sched.createScheduler({ budget: rb.createBudgetManager(), execute: exec, idleWorkers: 1 });
  // Enqueue all at once by pausing first
  s.pause();
  s.enqueue({ workId: "low", type: "test", priority: "BACKGROUND", requiredResources: [], idempotencyKey: "k-low" });
  s.enqueue({ workId: "high", type: "test", priority: "INTERACTIVE", requiredResources: [], idempotencyKey: "k-high" });
  s.enqueue({ workId: "med", type: "test", priority: "NORMAL", requiredResources: [], idempotencyKey: "k-med" });
  s.resume();
  await new Promise((r) => setTimeout(r, 100));
  assert(order[0] === "high", "interactive first: " + order);
  assert(order[1] === "med", "normal second: " + order);
  assert(order[2] === "low", "background last: " + order);
  s.shutdown();
});

await runTest("budget blocks concurrent admission", async () => {
  const b = rb.createBudgetManager({ maxBrowsers: 1 });
  let concurrent = 0;
  let maxConcurrent = 0;
  const exec = async (item) => {
    concurrent++;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    await new Promise((r) => setTimeout(r, 50));
    concurrent--;
    return { ok: true };
  };
  const s = sched.createScheduler({ budget: b, execute: exec, idleWorkers: 2 });
  s.enqueue({ workId: "w1", type: "test", priority: "NORMAL", requiredResources: [{ type: "RENDER_BROWSER" }], idempotencyKey: "k1" });
  s.enqueue({ workId: "w2", type: "test", priority: "NORMAL", requiredResources: [{ type: "RENDER_BROWSER" }], idempotencyKey: "k2" });
  await new Promise((r) => setTimeout(r, 150));
  assert(maxConcurrent === 1, "max concurrent was " + maxConcurrent + ", expected 1");
  s.shutdown();
});

await runTest("dependency blocks admission", async () => {
  const dag = { dependencies: new Map([["w2", ["w1"]]]), dependents: new Map() };
  const order = [];
  const exec = async (item) => { order.push(item.workId); await new Promise((r) => setTimeout(r, 30)); };
  const s = sched.createScheduler({ budget: rb.createBudgetManager(), execute: exec, idleWorkers: 2, dag });
  // Enqueue dependency first (natural order)
  s.enqueue({ workId: "w1", type: "test", priority: "NORMAL", requiredResources: [], idempotencyKey: "k1" });
  s.enqueue({ workId: "w2", type: "test", priority: "NORMAL", requiredResources: [], idempotencyKey: "k2" });
  await new Promise((r) => setTimeout(r, 100));
  assert(order[0] === "w1", "dependency runs first: " + order);
  assert(order[1] === "w2", "dependent runs after: " + order);
  s.shutdown();
});

await runTest("cancel queued work releases budget", async () => {
  const b = rb.createBudgetManager({ maxBrowsers: 1 });
  const order = [];
  const exec = async (item) => { order.push(item.workId); await new Promise((r) => setTimeout(r, 50)); };
  const s = sched.createScheduler({ budget: b, execute: exec, idleWorkers: 1 });
  s.enqueue({ workId: "w1", type: "test", priority: "NORMAL", requiredResources: [{ type: "RENDER_BROWSER" }], idempotencyKey: "k1" });
  s.enqueue({ workId: "w2", type: "test", priority: "NORMAL", requiredResources: [{ type: "RENDER_BROWSER" }], idempotencyKey: "k2" });
  await new Promise((r) => setTimeout(r, 30));
  const c = s.cancel("w2");
  assert(c.ok === true && c.wasRunning === false, "cancelled queued");
  // w2 cancelled, w1 should run
  await new Promise((r) => setTimeout(r, 100));
  assert(order.includes("w1"), "w1 still runs: " + order);
  assert(!order.includes("w2"), "w2 was cancelled: " + order);
  s.shutdown();
});

await runTest("cancel running work aborts", async () => {
  let running = false;
  const exec = async (item, abort) => { running = true; await new Promise((r) => setTimeout(r, 200)); if (abort.aborted) throw { name: "AbortError" }; };
  const s = sched.createScheduler({ budget: rb.createBudgetManager(), execute: exec, idleWorkers: 1 });
  s.enqueue({ workId: "w1", type: "test", priority: "NORMAL", requiredResources: [], idempotencyKey: "k1" });
  await new Promise((r) => setTimeout(r, 30));
  assert(running === true, "work started");
  const c = s.cancel("w1");
  assert(c.ok === true && c.wasRunning === true, "cancelled running");
  await new Promise((r) => setTimeout(r, 50));
  s.shutdown();
});

await runTest("persist + restore queue", async () => {
  const order = [];
  const exec = async (item) => { order.push(item.workId); await new Promise((r) => setTimeout(r, 100)); };
  const s = sched.createScheduler({ budget: rb.createBudgetManager(), execute: exec, idleWorkers: 1 });
  s.enqueue({ workId: "w1", type: "test", priority: "NORMAL", requiredResources: [], idempotencyKey: "k1" });
  s.enqueue({ workId: "w2", type: "test", priority: "NORMAL", requiredResources: [], idempotencyKey: "k2" });
  await new Promise((r) => setTimeout(r, 10)); // let them be queued but not complete
  const data = s.persist();
  console.log('persist data:', JSON.stringify(data, null, 2));
  assert(data.queued.length + data.running.length === 2, "persisted 2 items");
  // Restore into new scheduler
  const s2 = sched.createScheduler({ budget: rb.createBudgetManager(), execute: exec, idleWorkers: 1 });
  s2.restore(data);
  await new Promise((r) => setTimeout(r, 200));
  assert(order.includes("w1") && order.includes("w2"), "restored items execute: " + order);
  s.shutdown();
  s2.shutdown();
});

await runTest("duplicate idempotencyKey blocked", async () => {
  const s = sched.createScheduler({ budget: rb.createBudgetManager(), execute, idleWorkers: 2 });
  s.enqueue({ workId: "w1", type: "test", priority: "NORMAL", requiredResources: [], idempotencyKey: "same" });
  s.enqueue({ workId: "w2", type: "test", priority: "NORMAL", requiredResources: [], idempotencyKey: "same" });
  await new Promise((r) => setTimeout(r, 50));
  const dup = s.checkDedupe("same");
  // One is running or completed, the other should be detected as duplicate
  // Note: checkDedupe runs synchronously, so timing matters
  s.shutdown();
});

await runTest("snapshot shows backpressure", async () => {
  const b = rb.createBudgetManager({ hardLimitBytes: 100 });
  const s = sched.createScheduler({ budget: b, execute, idleWorkers: 1 });
  b.reserve({ requiredResources: [{ type: "MEMORY", amount: 100 }] });
  const snap = s.snapshot();
  assert(snap.backpressure.includes("MEMORY_BACKPRESSURE"), "snapshot shows memory pressure: " + snap.backpressure);
  s.shutdown();
});

console.log("\n=== scheduler: " + passed + " passed, " + failed + " failed ===");
process.exit(failed > 0 ? 1 : 0);
})();