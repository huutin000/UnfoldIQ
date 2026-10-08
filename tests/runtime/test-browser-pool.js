"use strict";
// tests/runtime/test-browser-pool.js — Phase 5C Cases A–G (pool mechanics).
// Fake browser factory: no Chromium launched. Real-launch reuse benchmark
// lives in test-browser-reuse.js.

const pool = require("../../lib/browser-pool/index.js");

let passed = 0;
let failed = 0;
function runTest(name, fn) {
  return Promise.resolve().then(fn).then(
    () => { passed++; console.log("[PASS] " + name); },
    (e) => { failed++; console.log("[FAIL] " + name + ": " + ((e && e.message) || e)); });
}
function assert(c, m) { if (!c) throw new Error("ASSERT: " + m); }

let livePids = new Set();
function fakeBrowser() {
  const pid = 100000 + Math.floor(Math.random() * 899999);
  livePids.add(pid);
  return {
    __pid: pid,
    process: () => ({ pid }),
    close: async () => { livePids.delete(pid); },
    kill: () => { livePids.delete(pid); },
  };
}
function deps(over = {}) {
  const opened = [];
  return {
    open: {
      openBrowser: async (opts) => { const b = fakeBrowser(); opened.push(b); return b; },
      now: over.now || (() => Date.now()),
      policy: Object.assign({ maxBrowsers: 2, idleTtlMs: 60000, maxJobsPerBrowser: 25, maxAgeMs: 3600000, maxRssBytes: 1e12 }, over.policy || {}),
      probeRss: over.probeRss || (async () => 100),
      pidAlive: over.pidAlive || ((pid) => livePids.has(pid)),
      opened,
    },
  };
}
const COMPAT = { remotionVersion: "4.0.529", chromeMode: "headless-shell", executablePath: "/x/chrome", envHash: "e1" };
const OTHER = { ...COMPAT, envHash: "e2" };

(async () => {
await runTest("compatKey stable + environment-scoped", () => {
  assert(pool.compatKey(COMPAT) === pool.compatKey({ ...COMPAT }), "stable");
  assert(pool.compatKey(COMPAT) !== pool.compatKey(OTHER), "env change => new key");
  assert(pool.compatKey(COMPAT) !== pool.compatKey({ ...COMPAT, remotionVersion: "4.0.530" }), "renderer version change => new key");
});

await runTest("B second compatible range reuses same healthy browser", async () => {
  const d = deps();
  const p = pool.createPool(d.open);
  const key = pool.compatKey(COMPAT);
  const l1 = await p.acquire(key, {});
  await l1.release(true);
  const l2 = await p.acquire(key, {});
  assert(l2.reused === true && l2.browserId === l1.browserId, "same browser reused");
  assert(p.snapshot().metrics.reused === 1 && p.snapshot().metrics.created === 1, "metrics");
  await l2.release(true);
  await p.shutdown();
});

await runTest("D environment incompatibility: no unsafe reuse", async () => {
  const d = deps();
  const p = pool.createPool(d.open);
  const l1 = await p.acquire(pool.compatKey(COMPAT), {});
  await l1.release(true);
  const l2 = await p.acquire(pool.compatKey(OTHER), {});
  assert(l2.reused === false && l2.browserId !== l1.browserId, "fresh browser for new env");
  assert(p.snapshot().metrics.incompatible === 1, "incompatibility counted");
  await l2.release(true);
  await p.shutdown();
});

await runTest("pool exhaustion blocks instead of oversubscribing", async () => {
  const d = deps({ policy: { maxBrowsers: 1 } });
  const p = pool.createPool(d.open);
  const key = pool.compatKey(COMPAT);
  const l1 = await p.acquire(key, {});
  let threw = null;
  try { await p.acquire(key, {}); } catch (e) { threw = e; }
  assert(threw && /BROWSER_POOL_EXHAUSTED/.test(threw.message), "bounded, got: " + (threw && threw.message));
  await l1.release(true);
  await p.shutdown();
});

await runTest("E crash retires + recreates (never reuses dead browser)", async () => {
  const d = deps();
  const p = pool.createPool(d.open);
  const key = pool.compatKey(COMPAT);
  const l1 = await p.acquire(key, {});
  const dead = d.open.opened[d.open.opened.length - 1];
  dead.kill(); // simulate crash: pid gone
  await l1.release(true); // post-job health check retires it
  const snap = p.snapshot();
  assert(snap.browsers.length === 0, "crashed browser retired");
  const l2 = await p.acquire(key, {});
  assert(l2.reused === false, "recreated after crash");
  await l2.release(true);
  await p.shutdown();
});

await runTest("F memory growth triggers retirement", async () => {
  let rss = 100;
  const d = deps({ policy: { maxRssBytes: 1000 }, probeRss: async () => rss });
  const p = pool.createPool(d.open);
  const key = pool.compatKey(COMPAT);
  const l1 = await p.acquire(key, {});
  await l1.release(true);
  assert(p.snapshot().browsers.length === 1, "healthy kept");
  rss = 10 ** 12; // leak simulation
  const l2 = await p.acquire(key, {});
  await l2.release(true);
  assert(p.snapshot().browsers.length === 0, "grown browser retired, count=" + p.snapshot().browsers.length);
  await p.shutdown();
});

await runTest("G max-jobs + idle-TTL retirement; no immortal browser", async () => {
  let t = 1000000;
  const d = deps({ now: () => t, policy: { maxJobsPerBrowser: 2, idleTtlMs: 5000 } });
  const p = pool.createPool(d.open);
  const key = pool.compatKey(COMPAT);
  const l1 = await p.acquire(key, {});
  await l1.release(true);
  const l2 = await p.acquire(key, {});
  await l2.release(true); // 2 jobs => retired
  assert(p.snapshot().browsers.length === 0, "max-jobs retired");
  const l3 = await p.acquire(key, {});
  await l3.release(true);
  t += 6000;
  await p.sweep();
  assert(p.snapshot().browsers.length === 0, "idle-TTL retired");
  await p.shutdown();
});

await runTest("release(false) retires on lease error", async () => {
  const d = deps();
  const p = pool.createPool(d.open);
  const key = pool.compatKey(COMPAT);
  const l1 = await p.acquire(key, {});
  await l1.release(false);
  assert(p.snapshot().browsers.length === 0, "error lease retired");
  await p.shutdown();
});

console.log("\n=== browser-pool: " + passed + " passed, " + failed + " failed ===");
process.exit(failed > 0 ? 1 : 0);
})();
