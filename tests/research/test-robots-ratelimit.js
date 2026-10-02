"use strict";

/**
 * Robots / rate-limit / redirect / production-default tests.
 * Local fixtures + injected fetchers. No internet.
 */

const acquisition = require("../../lib/research-acquisition/acquisition.js");
const fixtures = require("../fixtures/research-servers.js");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
  console.log(`  ✓ ${message}`);
  passed++;
}

function runTest(name, fn) {
  console.log(`\n[TEST] ${name}`);
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`[PASS] ${name}`))
    .catch((e) => {
      console.log(`[FAIL] ${name}: ${e.message}`);
      failed++;
    });
}

const LOCAL = { allowLocalForTest: true };

async function main() {
  console.log("=== ROBOTS / RATE-LIMIT / REDIRECT TESTS ===\n");
  acquisition.clearRobotsCache();
  const counts = {};
  const fx = await fixtures.startServer((req, res) => {
    counts[req.url] = (counts[req.url] || 0) + 1;
    return fixtures.articleHandler({ counts })(req, res);
  });

  await runTest("robots allow vs disallow", async () => {
    const ok = await acquisition.checkRobots(`${fx.origin}/public/page`);
    assert(ok.allowed === true, "unlisted path allowed");
    const no = await acquisition.checkRobots(`${fx.origin}/private/page`);
    assert(no.allowed === false && no.code === "ROBOTS_DISALLOWED", "disallowed path blocked with code");
  });

  await runTest("robots-blocked acquisition stops before crawl", async () => {
    const before = counts["/private/page"] || 0;
    const res = await acquisition.acquireUrl(`${fx.origin}/private/page`, { safetyOpts: LOCAL });
    assert(res.ok === false && res.code === "ROBOTS_DISALLOWED", "acquisition stops with ROBOTS_DISALLOWED");
    assert((counts["/private/page"] || 0) === before, "target page never fetched");
  });

  await runTest("unreachable robots.txt fails open (logged)", async () => {
    const res = await acquisition.checkRobots("https://example.com/x", {
      fetcher: async () => { throw new Error("boom"); },
    });
    assert(res.allowed === true, "robots fetch failure does not block (fail-open, logged)");
  });

  await runTest("429 triggers bounded retry then success", async () => {
    const res = await acquisition.acquireUrl(`${fx.origin}/flaky`, {
      safetyOpts: LOCAL, cacheMode: "BYPASS", hostDelayMs: 0, maxRetries: 3,
    });
    assert(res.ok === true, "recovered after 429s");
    assert(res.document.rawMarkdown.includes("Recovered after retry"), "final content acquired");
    assert((res.summary.retryCount || 0) >= 2, `bounded retries used (${res.summary.retryCount})`);
  });

  await runTest("public redirect records requested vs final URL", async () => {
    const res = await acquisition.acquireUrl(`${fx.origin}/redir`, { safetyOpts: LOCAL, hostDelayMs: 0 });
    assert(res.ok === true, "redirect followed within limit");
    assert(res.document.finalUrl === `${fx.origin}/article`, `finalUrl recorded (${res.document.finalUrl})`);
    assert(res.url === `${fx.origin}/redir`, "requestedUrl preserved");
  });

  await runTest("production defaults block localhost at acquisition level", async () => {
    const res = await acquisition.acquireUrl(`${fx.origin}/public/page`);
    assert(res.ok === false && res.code === "PRIVATE_HOST", "no bypass in production path");
  });

  await runTest("binary extensions rejected without crawl", async () => {
    const res = await acquisition.acquireUrl("https://example.com/file.pdf", { safetyOpts: { dnsLookup: async () => [{ address: "93.184.215.14" }] } });
    assert(res.ok === false && res.code === "UNSUPPORTED_CONTENT_TYPE", "pdf rejected pre-crawl");
  });

  await runTest("freshness propagates to cache mode", async () => {
    assert(acquisition.cacheModeFor("EVERGREEN_OK; ...") === "ENABLED", "evergreen reuses cache");
    assert(acquisition.cacheModeFor("CURRENT_STATE required") === "BYPASS", "current-state bypasses stale cache");
  });

  await fixtures.stopServer(fx);

  console.log(`\n=== SUMMARY ===`);
  console.log(`Passed assertions: ${passed}, Failed tests: ${failed}`);
  if (failed > 0) {
    console.log("RESULT: SOME TESTS FAILED");
    process.exit(1);
  }
  console.log("RESULT: ALL TESTS PASSED");
}

main().catch((e) => {
  console.log(`[FAIL] harness: ${e.message}`);
  process.exit(1);
});
