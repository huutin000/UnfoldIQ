"use strict";
// lib/browser-pool/index.js — Phase 5C (5.4): RendererBrowserPool.
// Leased, health-checked, policy-retired Remotion browser reuse across
// compatible renders (openBrowser). No immortal browsers, no cross-
// environment reuse, crash-safe retirement. Remotion API injected so the
// pool core is unit-testable without launching Chromium.

const crypto = require("crypto");

const VERSION = "1.0.0";

const FINDINGS = [
  "BROWSER_POOL_EXHAUSTED",
  "BROWSER_UNHEALTHY",
  "BROWSER_MEMORY_GROWTH",
  "BROWSER_REUSE_INCOMPATIBLE",
];

// Compatibility key: only identical runtime environments share a browser.
function compatKey(spec) {
  spec = spec || {};
  const parts = [
    spec.remotionVersion || null,
    spec.chromeMode || null,
    spec.executablePath || null,
    spec.envHash || null,
  ];
  return crypto.createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 16);
}

function defaultPolicy(over = {}) {
  return {
    version: "1.0.0",
    maxBrowsers: over.maxBrowsers ?? 2,
    idleTtlMs: over.idleTtlMs ?? 5 * 60 * 1000,
    maxJobsPerBrowser: over.maxJobsPerBrowser ?? 25,
    maxAgeMs: over.maxAgeMs ?? 30 * 60 * 1000,
    maxRssBytes: over.maxRssBytes ?? 2 * 1024 * 1024 * 1024,
  };
}

function pidAlive(pid) {
  if (!Number.isInteger(pid)) return false;
  try { process.kill(pid, 0); return true; }
  catch { return false; }
}

function createPool(deps = {}) {
  const openBrowser = deps.openBrowser;
  if (typeof openBrowser !== "function") throw new Error("BROWSER_POOL: openBrowser required");
  const now = deps.now || (() => Date.now());
  const policy = defaultPolicy(deps.policy || {});
  const probeRss = deps.probeRss || (async () => null);
  const checkPid = deps.pidAlive || pidAlive;
  // Optional liveness override for engines that hide the child pid
  // (Remotion's HeadlessBrowser exposes no process handle) — e.g. a CDP ping.
  const isAlive = deps.isAlive || null;

  const browsers = new Map(); // browserId -> record
  let seq = 0;
  const metrics = {
    created: 0, reused: 0, retired: 0, crashed: 0,
    leaseWaitMs: [], startupAvoidedMs: [],
    poolExhausted: 0, incompatible: 0,
  };

  async function healthCheck(rec) {
    if (rec.state === "CLOSING" || rec.state === "UNHEALTHY") return false;
    try {
      if (isAlive) {
        if (!(await isAlive(rec))) { rec.state = "UNHEALTHY"; return false; }
      } else if (!checkPid(rec.pid)) { rec.state = "UNHEALTHY"; return false; }
      const rss = await probeRss(rec);
      rec.rssEstimate = rss;
      if (typeof rss === "number" && rss > policy.maxRssBytes) {
        rec.state = "UNHEALTHY";
        return false;
      }
      if (now() - rec.createdAt > policy.maxAgeMs) return false;
      if (rec.jobsCompleted >= policy.maxJobsPerBrowser) return false;
      return true;
    } catch {
      rec.state = "UNHEALTHY";
      return false;
    }
  }

  async function openFresh(compat, openOpts) {
    const t0 = now();
    const browser = await openBrowser(openOpts);
    const startupMs = now() - t0;
    // pid extraction: puppeteer-style .process() or Remotion HeadlessBrowser
    // runner.browserProcess (no .process() method — pid must come from runner).
    const pid = (() => {
      try {
        if (browser && typeof browser.process === "function") {
          const p = browser.process();
          return p && p.pid;
        }
        if (browser && browser.runner && browser.runner.browserProcess) {
          return browser.runner.browserProcess.pid;
        }
      } catch { /* fall through */ }
      return null;
    })();
    const rec = {
      browserId: `rb-${++seq}`,
      compatKey: compat, // store the key, not the object
      compat: openOpts.compatSpec || {}, // keep spec for debugging if needed
      browser, pid,
      createdAt: now(), lastUsedAt: now(),
      jobsCompleted: 0, rssEstimate: null,
      state: "IDLE", startupMs,
    };
    browsers.set(rec.browserId, rec);
    metrics.created++;
    return rec;
  }

  // Acquire a lease. Returns {browserId, browser, release, reused, startupMs}.
  // Throws BROWSER_POOL_EXHAUSTED when at cap with no compatible idle browser.
  async function acquire(compat, openOpts = {}) {
    for (const rec of browsers.values()) {
      if (rec.state !== "IDLE" || rec.compatKey !== compat) continue;
      if (await healthCheck(rec)) {
        rec.state = "LEASED";
        rec.lastUsedAt = now();
        metrics.reused++;
        metrics.startupAvoidedMs.push(rec.startupMs);
        return { browserId: rec.browserId, browser: rec.browser, reused: true, startupMs: 0, release: (ok = true) => release(rec.browserId, ok) };
      }
      await retire(rec.browserId, "unhealthy-idle");
    }
    const active = [...browsers.values()].filter((r) => r.state !== "CLOSING").length;
    if (active >= policy.maxBrowsers) {
      metrics.poolExhausted++;
      throw new Error("BROWSER_POOL_EXHAUSTED: no compatible idle browser and pool at cap");
    }
    // No compatible browser: if pool holds only incompatible ones, that is an
    // explicit incompatibility signal, not silent sharing.
    const foreign = [...browsers.values()].some((r) => r.state !== "CLOSING" && r.compatKey !== compat);
    if (foreign) metrics.incompatible++;
    const rec = await openFresh(compat, openOpts);
    rec.state = "LEASED";
    return { browserId: rec.browserId, browser: rec.browser, reused: false, startupMs: rec.startupMs, release: (ok = true) => release(rec.browserId, ok) };
  }

  async function release(browserId, ok = true) {
    const rec = browsers.get(browserId);
    if (!rec || rec.state === "CLOSING") return;
    if (!ok) { await retire(browserId, "lease-error"); metrics.crashed++; return; }
    rec.jobsCompleted++;
    rec.lastUsedAt = now();
    rec.state = "IDLE";
    if (!(await healthCheck(rec))) await retire(browserId, "post-job-retire");
  }

  async function retire(browserId, reason) {
    const rec = browsers.get(browserId);
    if (!rec) return;
    rec.state = "CLOSING";
    try { await rec.browser.close(); } catch { /* already dead */ }
    browsers.delete(browserId);
    metrics.retired++;
    void reason;
  }

  async function sweep() {
    const t = now();
    for (const rec of [...browsers.values()]) {
      if (rec.state !== "IDLE") continue;
      if (t - rec.lastUsedAt > policy.idleTtlMs) await retire(rec.browserId, "idle-ttl");
      else if (!(await healthCheck(rec))) await retire(rec.browserId, "sweep-unhealthy");
    }
  }

  async function shutdown() {
    for (const id of [...browsers.keys()]) await retire(id, "shutdown");
  }

  function snapshot() {
    return {
      version: VERSION, policy,
      browsers: [...browsers.values()].map((r) => ({
        browserId: r.browserId, state: r.state, compat: r.compat,
        jobsCompleted: r.jobsCompleted, rssEstimate: r.rssEstimate,
        ageMs: now() - r.createdAt, idleMs: now() - r.lastUsedAt, startupMs: r.startupMs,
      })),
      metrics,
    };
  }

  return { VERSION, policy, acquire, release, retire, sweep, shutdown, snapshot, healthCheck, compatKey, FINDINGS };
}

module.exports = { VERSION, FINDINGS, compatKey, defaultPolicy, createPool };
