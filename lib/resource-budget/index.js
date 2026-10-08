"use strict";
// lib/resource-budget/index.js — Phase 5C (5.5): ResourceBudgetProfile +
// per-resource budget + admission control. Pure logic, no I/O.

const VERSION = "1.0.0";

const FINDINGS = [
  "QUEUE_CAPACITY_EXCEEDED",
  "MEMORY_BACKPRESSURE",
  "CREDIT_BACKPRESSURE",
  "RATE_LIMIT_BACKPRESSURE",
  "EXTENSION_CAPACITY_EXCEEDED",
];

function defaultBudgetProfile(over = {}) {
  return {
    profileId: over.profileId || "local-default",
    version: over.version || "1.0.0",
    environmentClass: over.environmentClass || "local",
    cpu: { maxActiveWeight: over.maxActiveWeight ?? 100 },
    memory: {
      softLimitBytes: over.softLimitBytes ?? 4 * 1024 * 1024 * 1024,
      hardLimitBytes: over.hardLimitBytes ?? 6 * 1024 * 1024 * 1024,
      reserveBytes: over.reserveBytes ?? 512 * 1024 * 1024,
    },
    render: {
      maxBrowsers: over.maxBrowsers ?? 2,
      maxConcurrentRenders: over.maxConcurrentRenders ?? 2,
      offthreadVideoThreads: over.offthreadVideoThreads ?? 2,
    },
    extension: {
      maxConcurrentActions: over.maxConcurrentActions ?? 2,
    },
    providers: over.providers || {
      "flow-web": { maxConcurrent: 1, requestsPerWindow: 10, creditBudget: 1000 },
    },
    queue: {
      maxJobs: over.maxJobs ?? 50,
      maxQueuedCost: over.maxQueuedCost ?? 5000,
      maxQueuedBytes: over.maxQueuedBytes ?? 10 * 1024 * 1024 * 1024,
    },
  };
}

function createBudgetManager(opts = {}) {
  const profile = defaultBudgetProfile(opts);
  const budgets = {
    cpu: { used: 0, limit: profile.cpu.maxActiveWeight },
    memory: { used: 0, softLimit: profile.memory.softLimitBytes, hardLimit: profile.memory.hardLimitBytes, reserve: profile.memory.reserveBytes },
    render: { browsers: 0, concurrentRenders: 0, offthreadThreads: 0, ...profile.render },
    extension: { concurrentActions: 0, ...profile.extension },
    providers: { ...profile.providers },
    queue: { jobs: 0, estimatedCost: 0, estimatedBytes: 0, ...profile.queue },
  };

  function admit(item) {
    const required = item.requiredResources || [];
    for (const req of required) {
      switch (req.type) {
        case "RENDER_BROWSER":
          if (budgets.render.browsers >= budgets.render.maxBrowsers) return { ok: false, reason: "RENDER_BROWSER_EXHAUSTED" };
          break;
        case "RENDER_CONCURRENT":
          if (budgets.render.concurrentRenders >= budgets.render.maxConcurrentRenders) return { ok: false, reason: "RENDER_CONCURRENT_EXHAUSTED" };
          break;
        case "OFFTHREAD_THREAD":
          if (budgets.render.offthreadThreads >= budgets.render.offthreadVideoThreads) return { ok: false, reason: "OFFTHREAD_EXHAUSTED" };
          break;
        case "EXTENSION_ACTION":
          if (budgets.extension.concurrentActions >= budgets.extension.maxConcurrentActions) return { ok: false, reason: "EXTENSION_CAPACITY_EXCEEDED" };
          break;
        case "PROVIDER_SLOT":
          const pbudget = budgets.providers[req.providerId];
          if (pbudget && (pbudget.active || 0) >= pbudget.maxConcurrent) return { ok: false, reason: "PROVIDER_SLOT_EXHAUSTED" };
          break;
        case "MEMORY":
          if (budgets.memory.used + req.amount > budgets.memory.hardLimit) return { ok: false, reason: "MEMORY_BACKPRESSURE" };
          break;
        case "CPU":
          if (budgets.cpu.used + req.amount > budgets.cpu.limit) return { ok: false, reason: "CPU_BACKPRESSURE" };
          break;
        case "CREDIT":
          if (req.providerId) {
            const pbudget = budgets.providers[req.providerId];
            if (pbudget && pbudget.creditBudget && (pbudget.creditUsed || 0) + req.amount > pbudget.creditBudget) return { ok: false, reason: "CREDIT_BACKPRESSURE" };
          }
          break;
        case "QUEUE_CAPACITY":
          if (budgets.queue.jobs >= budgets.queue.maxJobs) return { ok: false, reason: "QUEUE_CAPACITY_EXCEEDED" };
          if (budgets.queue.estimatedCost + req.amount > budgets.queue.maxQueuedCost) return { ok: false, reason: "QUEUE_COST_EXCEEDED" };
          break;
      }
    }
    return { ok: true };
  }

  function reserve(item) {
    const required = item.requiredResources || [];
    for (const req of required) {
      switch (req.type) {
        case "RENDER_BROWSER": budgets.render.browsers++; break;
        case "RENDER_CONCURRENT": budgets.render.concurrentRenders++; break;
        case "OFFTHREAD_THREAD": budgets.render.offthreadThreads++; break;
        case "EXTENSION_ACTION": budgets.extension.concurrentActions++; break;
        case "PROVIDER_SLOT":
          if (budgets.providers[req.providerId]) budgets.providers[req.providerId].active = (budgets.providers[req.providerId].active || 0) + 1;
          break;
        case "MEMORY": budgets.memory.used += req.amount; break;
        case "CPU": budgets.cpu.used += req.amount; break;
        case "CREDIT":
          if (req.providerId && budgets.providers[req.providerId]) budgets.providers[req.providerId].creditUsed = (budgets.providers[req.providerId].creditUsed || 0) + req.amount;
          break;
        case "QUEUE_CAPACITY":
          budgets.queue.jobs++;
          budgets.queue.estimatedCost += req.amount;
          break;
      }
    }
  }

  function release(item) {
    const required = item.requiredResources || [];
    for (const req of required) {
      switch (req.type) {
        case "RENDER_BROWSER": budgets.render.browsers = Math.max(0, budgets.render.browsers - 1); break;
        case "RENDER_CONCURRENT": budgets.render.concurrentRenders = Math.max(0, budgets.render.concurrentRenders - 1); break;
        case "OFFTHREAD_THREAD": budgets.render.offthreadThreads = Math.max(0, budgets.render.offthreadThreads - 1); break;
        case "EXTENSION_ACTION": budgets.extension.concurrentActions = Math.max(0, budgets.extension.concurrentActions - 1); break;
        case "PROVIDER_SLOT":
          if (budgets.providers[req.providerId]) budgets.providers[req.providerId].active = Math.max(0, (budgets.providers[req.providerId].active || 0) - 1);
          break;
        case "MEMORY": budgets.memory.used = Math.max(0, budgets.memory.used - req.amount); break;
        case "CPU": budgets.cpu.used = Math.max(0, budgets.cpu.used - req.amount); break;
        case "CREDIT":
          if (req.providerId && budgets.providers[req.providerId]) budgets.providers[req.providerId].creditUsed = Math.max(0, (budgets.providers[req.providerId].creditUsed || 0) - req.amount);
          break;
        case "QUEUE_CAPACITY":
          budgets.queue.jobs = Math.max(0, budgets.queue.jobs - 1);
          budgets.queue.estimatedCost = Math.max(0, budgets.queue.estimatedCost - req.amount);
          break;
      }
    }
  }

  function backpressureState() {
    const state = [];
    if (budgets.memory.used >= budgets.memory.hardLimit) state.push("MEMORY_BACKPRESSURE");
    else if (budgets.memory.used >= budgets.memory.softLimit) state.push("MEMORY_SOFT_PRESSURE");
    if (budgets.queue.jobs >= budgets.queue.maxJobs) state.push("QUEUE_CAPACITY_EXCEEDED");
    if (budgets.cpu.used >= budgets.cpu.limit) state.push("CPU_BACKPRESSURE");
    for (const [pid, pbudget] of Object.entries(budgets.providers)) {
      if (pbudget.creditBudget && (pbudget.creditUsed || 0) >= pbudget.creditBudget) state.push("CREDIT_BACKPRESSURE:" + pid);
      if ((pbudget.active || 0) >= pbudget.maxConcurrent) state.push("RATE_LIMIT_BACKPRESSURE:" + pid);
    }
    if (budgets.extension.concurrentActions >= budgets.extension.maxConcurrentActions) state.push("EXTENSION_CAPACITY_EXCEEDED");
    return state.length ? state : ["CAPACITY_AVAILABLE"];
  }

  function snapshot() {
    return { profile, budgets, backpressure: backpressureState() };
  }

  return { VERSION, FINDINGS, admit, reserve, release, backpressureState, snapshot, defaultBudgetProfile };
}

module.exports = { VERSION, FINDINGS, defaultBudgetProfile, createBudgetManager };