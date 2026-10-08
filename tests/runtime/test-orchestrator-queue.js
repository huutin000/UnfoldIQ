"use strict";
// tests/runtime/test-orchestrator-queue.js — Phase 5C Tasks B/C/D: scheduler
// on the real orchestration path. No real renders: runnerOverride drives the
// queue path. Temp projectRoot only.

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
function mkRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), "5c-queue-")); }
function rmRoot(r) { try { fs.rmSync(r, { recursive: true, force: true }); } catch (e) {} }
function mkAttempt(id) { return { attemptId: id, projectId: "p", progress: {} }; }
function mkArgs(root) {
  return { projectRoot: root, projectId: "p", opts: {}, state: { attempts: [] } };
}
const tick = () => new Promise((r) => setImmediate(r));

(async () => {
await runTest("wait-state vocabulary maps §6 reasons", () => {
  assert(Orch.queueWaitState("") === "QUEUED", "empty");
  assert(Orch.queueWaitState("MEMORY_BACKPRESSURE") === "WAITING_MEMORY", "memory");
  assert(Orch.queueWaitState("EXTENSION_CAPACITY_EXCEEDED") === "WAITING_EXTENSION", "extension");
  assert(Orch.queueWaitState("PROVIDER_SLOT_EXHAUSTED") === "WAITING_PROVIDER", "provider");
  assert(Orch.queueWaitState("CREDIT_BACKPRESSURE:x") === "WAITING_CREDIT", "credit");
  assert(Orch.queueWaitState("RATE_LIMIT_BACKPRESSURE:x") === "RATE_LIMITED", "rate");
  assert(Orch.queueWaitState("QUEUE_CAPACITY_EXCEEDED") === "QUEUED", "queue");
  assert(Orch.queueWaitState("RENDER_CONCURRENT_EXHAUSTED") === "WAITING_CAPACITY", "render");
});

await runTest("B happy path: enqueue→admit→run→complete→persist", async () => {
  const root = mkRoot();
  try {
    const q = Orch.openRenderQueue(root, "p");
    assert(q && q.reconciled === 0, "fresh queue");
    const r = await Orch.runAttemptViaQueue(q, mkArgs(root), mkAttempt("attempt-001"),
      path.join(root, "a"), {}, {}, "render:p:attempt-001:fp1",
      async () => ({ outputPath: path.join(root, "out.mp4"), frameCount: 10 }));
    assert(r.ok === true && r.queued === true, "completed via queue");
    assert(r.result && r.result.frameCount === 10, "result flows back");
    const snap = Orch.queueSnapshot(root, "p");
    assert(snap.persisted && snap.persisted.completedKeys === 1, "dedupe key persisted");
    assert(snap.persisted.running === 0 && snap.persisted.queued === 0, "slot released");
  } finally { rmRoot(root); }
});

await runTest("D failure path preserves error for retry loop", async () => {
  const root = mkRoot();
  try {
    const q = Orch.openRenderQueue(root, "p");
    const boom = new Error("render exploded");
    boom.renderErrorClass = "CHROME_CRASH";
    const r = await Orch.runAttemptViaQueue(q, mkArgs(root), mkAttempt("attempt-001"),
      path.join(root, "a"), {}, {}, "render:p:attempt-001:fp1",
      async () => { throw boom; });
    assert(r.ok === false && r.error === boom, "same error object back");
    const snap = Orch.queueSnapshot(root, "p");
    assert(snap.persisted.running === 0, "slot released on failure");
  } finally { rmRoot(root); }
});

await runTest("D running cancellation aborts + releases", async () => {
  const root = mkRoot();
  try {
    const q = Orch.openRenderQueue(root, "p");
    let release = null;
    const started = new Promise((res) => { release = res; });
    const p1 = Orch.runAttemptViaQueue(q, mkArgs(root), mkAttempt("attempt-001"),
      path.join(root, "a"), {}, {}, "render:p:attempt-001:fp1",
      (item, ac) => { release(); return new Promise((res, rej) => {
        const t = setInterval(() => {
          if (ac.aborted) { clearInterval(t); const e = new Error("aborted"); e.name = "AbortError"; rej(e); }
        }, 10);
      }); }); // abort-aware stand-in for a real render
    await started;
    await tick(); await tick();
    q.sched.cancel("attempt-001", "TEST_CANCEL");
    const r = await p1;
    assert(r.ok === false && r.error && r.error.renderErrorClass === "CANCELLED", "cancelled, got " + ((r.error && r.error.renderErrorClass) || "?"));
    const snap = Orch.queueSnapshot(root, "p");
    assert(snap.persisted.running === 0, "slot released on cancel");
  } finally { rmRoot(root); }
});

await runTest("D duplicate concurrent submission = one execution", async () => {
  const root = mkRoot();
  try {
    const q = Orch.openRenderQueue(root, "p");
    let runs = 0;
    let release = null;
    const started = new Promise((res) => { release = res; });
    const slow = async () => { runs++; release(); await new Promise((res) => setTimeout(res, 300)); return { frameCount: 1 }; };
    const p1 = Orch.runAttemptViaQueue(q, mkArgs(root), mkAttempt("attempt-001"),
      path.join(root, "a"), {}, {}, "render:p:attempt-001:fp1", slow);
    await started;
    const r2 = await Orch.runAttemptViaQueue(q, mkArgs(root), mkAttempt("attempt-001"),
      path.join(root, "a"), {}, {}, "render:p:attempt-001:fp1", slow);
    const r1 = await p1;
    assert(r1.ok === true, "first completes");
    assert(r2.duplicate === true && r2.reason === "DUPLICATE_EXPENSIVE_ACTION", "second blocked");
    assert(runs === 1, "exactly one execution, got " + runs);
  } finally { rmRoot(root); }
});

await runTest("D restart: stale items reconciled, never resubmitted; keys kept", async () => {
  const root = mkRoot();
  try {
    const dir = path.join(root, "projects", "p", "render");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "scheduler-queue.json"), JSON.stringify({
      version: "1.0.0",
      queued: [{ workId: "attempt-001", jobId: "a", projectId: "p", type: "RENDER_ATTEMPT", priority: "NORMAL", requiredResources: [{ type: "RENDER_CONCURRENT" }], idempotencyKey: "k-stale", state: "QUEUED", enqueuedAt: 1 }],
      running: [{ workId: "attempt-000", jobId: "a", projectId: "p", type: "RENDER_ATTEMPT", priority: "NORMAL", requiredResources: [{ type: "RENDER_CONCURRENT" }], idempotencyKey: "k-dead", state: "RUNNING", startedAt: 1 }],
      completedKeys: ["k-done"],
      completedWorkIds: [],
    }));
    const q = Orch.openRenderQueue(root, "p");
    assert(q.reconciled === 2, "both stale items reconciled, got " + q.reconciled);
    // Revived background dispatches settle on microtasks (abort, no runner).
    for (let i = 0; i < 10; i++) await tick();
    const snap = Orch.queueSnapshot(root, "p");
    assert(snap.persisted.queued === 0 && snap.persisted.running === 0, "nothing resubmitted");
    assert(snap.persisted.completedKeys === 1, "dedupe memory survives restart");
  } finally { rmRoot(root); }
});

console.log("\n=== orchestrator-queue: " + passed + " passed, " + failed + " failed ===");
process.exit(failed > 0 ? 1 : 0);
})();
