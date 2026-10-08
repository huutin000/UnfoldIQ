"use strict";
// lib/scheduler/index.js — Phase 5C (5.5): Bounded scheduler with
// backpressure, priority, DAG-awareness, credit/rate-limit control,
// cancellation, and restart recovery. Pure logic + injected executors.

const VERSION = "1.0.0";

const FINDINGS = [
  "QUEUE_CAPACITY_EXCEEDED",
  "MEMORY_BACKPRESSURE",
  "CREDIT_BACKPRESSURE",
  "RATE_LIMIT_BACKPRESSURE",
  "EXTENSION_CAPACITY_EXCEEDED",
  "DUPLICATE_EXPENSIVE_ACTION",
];

const PRIORITY = { INTERACTIVE: 0, NORMAL: 1, BACKGROUND: 2 };
const STATE = { QUEUED: "QUEUED", WAITING_CAPACITY: "WAITING_CAPACITY", RUNNING: "RUNNING", COMPLETED: "COMPLETED", FAILED: "FAILED", CANCELLED: "CANCELLED" };

function createScheduler(opts = {}) {
  const now = opts.now || (() => Date.now());
  const budget = opts.budget;
  const dag = opts.dag || { dependencies: new Map(), dependents: new Map() };
  const execute = opts.execute || (async () => { throw new Error("no executor"); });
  const onStateChange = opts.onStateChange || (() => {});
  const maxQueueSize = opts.maxQueueSize ?? 100;
  const idleWorkers = opts.idleWorkers ?? 1;

  const queue = []; // work items waiting for capacity
  const running = new Map(); // workId -> { item, abortController, startTime }
  const completed = new Map(); // idempotencyKey -> result (for dedupe)
  const completedWorkIds = new Set(); // workId of completed work
  const seq = 0;
  let paused = false;

  // Admission control: check deps + budget + queue capacity
  function canAdmit(item) {
    if (paused) return { ok: false, reason: "SCHEDULER_PAUSED" };
    // Dependency check
    const deps = dag.dependencies.get(item.workId) || [];
    for (const dep of deps) {
      if (completedWorkIds.has(dep)) continue;
      let depItem = queue.find((x) => x.workId === dep);
      if (!depItem) {
        const runningEntry = [...running.values()].find((e) => e.item.workId === dep);
        if (runningEntry) depItem = runningEntry.item;
      }
      if (depItem) {
        if (depItem.state !== STATE.COMPLETED) return { ok: false, reason: "DEPENDENCY_NOT_READY", dependency: dep };
      } else {
        // Dependency declared but not yet enqueued/running/completed -> not ready
        return { ok: false, reason: "DEPENDENCY_NOT_READY", dependency: dep };
      }
    }
    // Budget check
    const budgetCheck = budget.admit(item);
    if (!budgetCheck.ok) return { ok: false, reason: budgetCheck.reason };
    // Queue capacity
    if (queue.length >= maxQueueSize) return { ok: false, reason: "QUEUE_CAPACITY_EXCEEDED" };
    return { ok: true };
  }

  // Enqueue with priority ordering (lower number = higher priority)
  function enqueue(item) {
    item.workId = item.workId || `w-${++seq}-${now().toString(36)}`;
    item.state = STATE.QUEUED;
    item.enqueuedAt = now();
    // Insert by priority, then FIFO
    const idx = queue.findIndex((q) => PRIORITY[q.priority] > PRIORITY[item.priority]);
    if (idx >= 0) queue.splice(idx, 0, item); else queue.push(item);
    onStateChange(item.workId, STATE.QUEUED);
    dispatch();
    return item.workId;
  }

  // Try to start queued work
  async function dispatch() {
    if (paused) return;
    while (running.size < idleWorkers && queue.length > 0) {
      const item = queue[0];
      const check = canAdmit(item);
      if (!check.ok) {
        item.state = STATE.WAITING_CAPACITY;
        item.waitReason = check.reason;
        onStateChange(item.workId, STATE.WAITING_CAPACITY, check.reason);
        break; // Can't admit front item, stop trying (fairness)
      }
      queue.shift();
      budget.reserve(item);
      item.state = STATE.RUNNING;
      item.startedAt = now();
      const abortController = { aborted: false, abort: () => { abortController.aborted = true; } };
      running.set(item.workId, { item, abortController, startTime: now() });
      onStateChange(item.workId, STATE.RUNNING);
      // Execute in background
      (async () => {
        try {
          const result = await execute(item, abortController);
          finish(item.workId, { ok: true, result });
        } catch (e) {
          if (e && e.name === "AbortError") {
            finish(item.workId, { ok: false, cancelled: true });
          } else {
            finish(item.workId, { ok: false, error: e });
          }
        }
      })();
    }
  }

  function finish(workId, outcome) {
    const entry = running.get(workId);
    if (!entry) return;
    running.delete(workId);
    budget.release(entry.item);
    entry.item.state = outcome.ok ? STATE.COMPLETED : (outcome.cancelled ? STATE.CANCELLED : STATE.FAILED);
    entry.item.completedAt = now();
    entry.item.outcome = outcome;
    onStateChange(workId, entry.item.state, outcome.error);
    // Track completed work ID for dependency resolution
    if (outcome.ok) {
      completedWorkIds.add(workId);
    }
    // Dedupe cache for idempotent work
    if (entry.item.idempotencyKey && outcome.ok) {
      completed.set(entry.item.idempotencyKey, outcome.result);
    }
    dispatch();
  }

  // Cancel queued or running work
  function cancel(workId, reason = "USER_CANCELLED") {
    // Queued
    const qIdx = queue.findIndex((x) => x.workId === workId);
    if (qIdx >= 0) {
      const item = queue.splice(qIdx, 1)[0];
      item.state = STATE.CANCELLED;
      item.cancelReason = reason;
      budget.release(item);
      onStateChange(workId, STATE.CANCELLED, reason);
      return { ok: true, wasRunning: false };
    }
    // Running
    const runningEntry = running.get(workId);
    if (runningEntry) {
      runningEntry.abortController.abort();
      runningEntry.item.state = STATE.CANCELLED;
      runningEntry.item.cancelReason = reason;
      return { ok: true, wasRunning: true };
    }
    return { ok: false, reason: "NOT_FOUND" };
  }

  // Persist queue for restart
  function persist() {
    return {
      version: VERSION,
      queued: queue.map((x) => ({
        workId: x.workId,
        jobId: x.jobId,
        projectId: x.projectId,
        type: x.type,
        priority: x.priority,
        requiredResources: x.requiredResources,
        estimatedCost: x.estimatedCost,
        estimatedMemoryBytes: x.estimatedMemoryBytes,
        idempotencyKey: x.idempotencyKey,
        state: x.state,
        enqueuedAt: x.enqueuedAt,
      })),
      running: [...running.entries()].map(([id, e]) => ({
        workId: id,
        jobId: e.item.jobId,
        projectId: e.item.projectId,
        type: e.item.type,
        priority: e.item.priority,
        requiredResources: e.item.requiredResources,
        estimatedCost: e.item.estimatedCost,
        estimatedMemoryBytes: e.item.estimatedMemoryBytes,
        idempotencyKey: e.item.idempotencyKey,
        state: e.item.state,
        startedAt: e.item.startedAt,
      })),
      completedKeys: [...completed.keys()],
      completedWorkIds: [...completedWorkIds],
    };
  }

  // Restore from persisted state
  function restore(data) {
    if (!data || data.version !== VERSION) return;
    paused = false;
    queue.length = 0;
    running.clear();
    completed.clear();
    completedWorkIds.clear();
    for (const item of data.queued || []) {
      queue.push({ ...item });
    }
    for (const item of data.running || []) {
      // Running items become queued for re-execution (reconcile if needed)
      queue.push({ ...item, state: STATE.QUEUED, startedAt: undefined });
    }
    for (const key of data.completedKeys || []) {
      completed.set(key, true); // Mark as completed to prevent duplicate execution
    }
    for (const wid of data.completedWorkIds || []) {
      completedWorkIds.add(wid);
    }
    dispatch();
  }

  // Check for duplicate expensive action
  function checkDedupe(idempotencyKey) {
    if (!idempotencyKey) return { isDuplicate: false };
    if (completed.has(idempotencyKey)) return { isDuplicate: true, reason: "DUPLICATE_EXPENSIVE_ACTION" };
    // Check running
    for (const entry of running.values()) {
      if (entry.item.idempotencyKey === idempotencyKey) return { isDuplicate: true, reason: "DUPLICATE_EXPENSIVE_ACTION" };
    }
    return { isDuplicate: false };
  }

  function snapshot() {
    return {
      version: VERSION,
      paused,
      queueDepth: queue.length,
      runningCount: running.size,
      queue: queue.map((x) => ({ workId: x.workId, type: x.type, priority: x.priority, state: x.state, waitReason: x.waitReason })),
      running: [...running.entries()].map(([id, e]) => ({ workId: id, type: e.item.type, state: e.item.state, durationMs: now() - e.startTime })),
      backpressure: budget.backpressureState(),
    };
  }

  function pause() { paused = true; }
  function resume() { paused = false; dispatch(); }
  function shutdown() { paused = true; for (const e of running.values()) e.abortController.abort(); }

  return { VERSION, FINDINGS, PRIORITY, STATE, enqueue, dispatch, cancel, persist, restore, checkDedupe, snapshot, pause, resume, shutdown };
}

module.exports = { VERSION, FINDINGS, PRIORITY, STATE, createScheduler };