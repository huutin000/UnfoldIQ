"use strict";

/**
 * Dynamic browser extraction tests B1-B5 (PHASE 1G.1 Prompt 02).
 * Real Chromium via the existing @playwright/test stack + local fixtures.
 * Rendered HTML is normalized through the shared Crawl4AI raw-HTML path.
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
  console.log("=== BROWSER EXTRACTION TESTS (B1-B5) ===\n");
  const fx = await fixtures.startServer(fixtures.articleHandler({}));

  await runTest("B1 JS click-to-reveal is acquired", async () => {
    const res = await acquisition.acquireUrl(`${fx.origin}/article`, {
      safetyOpts: LOCAL,
      route: "browser",
      browser: {
        actions: [
          { type: "click", selector: "#reveal" },
          { type: "waitForText", text: "REVEALED_SECRET_TEXT" },
        ],
      },
    });
    assert(res.ok === true, `browser acquisition ok (${res.code || "no error"})`);
    assert(res.document.rawMarkdown.includes("REVEALED_SECRET_TEXT"), "interaction-revealed content present");
    assert(res.document.rawMarkdown.includes("Intro paragraph"), "static content present too");
  });

  await runTest("B2 final URL preserved", async () => {
    const res = await acquisition.acquireUrl(`${fx.origin}/article`, { safetyOpts: LOCAL, route: "browser", browser: {} });
    assert(res.ok === true, "ok");
    assert(res.document.finalUrl === `${fx.origin}/article`, `finalUrl exact (${res.document.finalUrl})`);
  });

  await runTest("B3 relative link base preserved", async () => {
    const res = await acquisition.acquireUrl(`${fx.origin}/article`, { safetyOpts: LOCAL, route: "browser", browser: {} });
    assert(res.ok === true, "ok");
    assert(res.document.links.includes(`${fx.origin}/related/`), `relative href resolved (${res.document.links.join(",")})`);
  });

  await runTest("B4 shared normalization format", async () => {
    const res = await acquisition.acquireUrl(`${fx.origin}/article`, { safetyOpts: LOCAL, route: "browser", browser: {} });
    const doc = res.document;
    assert(doc.route === "browser-captured-html" && doc.browserAcquired === true, "browser route marked");
    assert(typeof doc.contentHash === "string" && doc.contentHash.length === 64, "same hash contract");
    assert(typeof doc.crawlerVersion === "string", "crawler version provenance");
    assert(doc.title.includes("Fixture Article"), "UTF-8 title preserved");
  });

  await runTest("B5 browser errors are structured", async () => {
    const badAction = await acquisition.acquireUrl(`${fx.origin}/article`, {
      safetyOpts: LOCAL, route: "browser", browser: { actions: [{ type: "solve-captcha" }] },
    });
    assert(badAction.ok === false && badAction.code === "INVALID_BROWSER_ACTION", "unsupported action is structured");
    const refused = await acquisition.acquireUrl("http://127.0.0.1:1/unreachable", {
      safetyOpts: LOCAL, route: "browser", browser: { navigationTimeoutMs: 8000 },
    });
    assert(refused.ok === false && refused.code === "EXTRACTION_FAILED", `navigation failure structured (${refused.code})`);
  });

  await runTest("B6 injection page stays data (no execution)", async () => {
    const res = await acquisition.acquireUrl(`${fx.origin}/article`, { safetyOpts: LOCAL, route: "browser", browser: {} });
    assert(res.ok === true, "page acquired");
    assert(res.document.rawMarkdown.includes("Ignore previous instructions"), "injection text acquired as data");
    assert(process.env.UNFOLDIQ_B6_CANARY === undefined, "no command executed from page text");
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
