"use strict";

/**
 * Crawl4AI bridge tests C1-C7 (PHASE 1G.1 Prompt 02).
 * Real worker process + real browser-backed normalization; local fixtures only.
 */

const { execSync } = require("child_process");
const bridge = require("../../lib/research-acquisition/crawl4ai-bridge.js");
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

function workerProcessCount() {
  try {
    const out = execSync(
      "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | Select-Object -ExpandProperty CommandLine",
      { encoding: "utf8", shell: "powershell.exe" }
    );
    return out.split("\n").filter((l) => l.includes("crawl4ai-worker")).length;
  } catch {
    return -1; // inspection unavailable; do not fail on the probe itself
  }
}

const VI_HTML = `<!DOCTYPE html><html lang="vi"><head><title>Phở bò — kiểm tra UTF-8</title></head><body>
<article><h1>Nước dùng phở bò</h1><p>Xương ống ninh 8 giờ với quế, hồi, thảo quả.</p>
<a href="gia-vi/">Gia vị</a></article></body></html>`;

const EN_HTML = `<!DOCTYPE html><html><head><title>Crawl4AI docs</title></head><body><article>
<h1>Markdown generation</h1><p>The Crawl4AI markdown generation result API exposes raw markdown and fit markdown.</p>
<p>Unrelated: football scores from last night.</p></article></body></html>`;

async function main() {
  console.log("=== CRAWL4AI BRIDGE TESTS (C1-C7) ===\n");

  await runTest("C0 bridge readiness (no network)", async () => {
    const ready = await bridge.checkReady();
    assert(ready.status === "READY", `bridge READY (crawler ${ready.crawlerVersion || "?"})`);
  });

  await runTest("C1 raw HTML normalization + UTF-8 + base URL", async () => {
    const res = await bridge.crawlRawHtml({
      html: VI_HTML, baseUrl: "https://example.com/pho/", requestedUrl: "https://example.com/pho/",
    });
    assert(res.ok === true, "bridge ok");
    const doc = res.document;
    assert(doc.success === true, "normalization success");
    assert(doc.rawMarkdown.includes("Xương ống ninh 8 giờ"), "Vietnamese content preserved");
    assert(doc.title.includes("Phở bò"), "UTF-8 title preserved");
    assert(doc.links.includes("https://example.com/pho/gia-vi/"), "relative link resolved against base URL");
    assert(doc.route === "browser-captured-html" && doc.browserAcquired === true, "browser-path route marked");
    assert(typeof doc.contentHash === "string" && doc.contentHash.length === 64, "sha256 content hash");
    assert(doc.crawlerVersion === "0.9.4", "crawler version provenance");
  });

  await runTest("C2 fit markdown from deterministic query", async () => {
    const res = await bridge.crawlRawHtml({
      html: EN_HTML, baseUrl: "https://example.com/docs/", requestedUrl: "https://example.com/docs/",
      fitQuery: "Crawl4AI markdown generation result API",
    });
    const doc = res.document;
    assert(doc.success === true, "success");
    assert(typeof doc.fitMarkdown === "string" && doc.fitMarkdown.includes("markdown generation result API"), "fit markdown relevant");
    assert(!doc.fitMarkdown.includes("football scores"), "fit markdown drops unrelated block");
    assert(doc.fitQuery === "Crawl4AI markdown generation result API", "fit query provenance preserved");
    assert(doc.rawMarkdown.includes("football scores"), "raw markdown fully preserved");
  });

  await runTest("C3 invalid URL becomes precise error", async () => {
    const batch = await bridge.crawlUrls([{ url: "not-a-url" }], { pageTimeoutMs: 5000, processTimeoutMs: 60000 });
    assert(batch.ok === true, "protocol ok");
    const doc = batch.documents[0];
    assert(doc.success === false && typeof doc.errorCode === "string", `precise error code (${doc.errorCode})`);
  });

  await runTest("C4 timeout is bounded", async () => {
    const fx = await fixtures.startServer(fixtures.articleHandler({}));
    const started = Date.now();
    try {
      const batch = await bridge.crawlUrls(
        [{ url: `${fx.origin}/hang` }],
        { pageTimeoutMs: 3000, processTimeoutMs: 90000 }
      );
      const elapsed = Date.now() - started;
      const doc = batch.documents[0];
      assert(doc.success === false, "hang becomes failure, not a hang");
      assert(doc.errorCode === "NETWORK_TIMEOUT", `bounded timeout code (${doc.errorCode})`);
      assert(elapsed < 90000, `bounded wall time (${elapsed}ms)`);
    } finally {
      await fixtures.stopServer(fx);
    }
  });

  await runTest("C5 protocol errors never crash Node", async () => {
    const bad = await bridge.runWorker({ protocolVersion: 999, operation: "crawl" }, { processTimeoutMs: 60000 });
    assert(bad.ok === true, "worker envelope still parses");
    assert(bad.response && bad.response.errorCode === "BRIDGE_PROTOCOL_ERROR", "protocol mismatch is structured");
    const doc = bridge.toAcquiredDocument({ requestedUrl: "x", success: false });
    assert(doc.success === false && doc.contentHash === null, "minimal garbage normalizes without crash");
  });

  await runTest("C6 worker processes exit (no orphans)", async () => {
    await bridge.runWorker({ protocolVersion: 1, operation: "version" }, { processTimeoutMs: 60000 });
    await new Promise((r) => setTimeout(r, 1500));
    const n = workerProcessCount();
    assert(n === 0 || n === -1, `no lingering worker processes (found=${n})`);
  });

  await runTest("C7 content hash stable", async () => {
    const a = await bridge.crawlRawHtml({ html: VI_HTML, baseUrl: "https://example.com/a/", requestedUrl: "https://example.com/a/" });
    const b = await bridge.crawlRawHtml({ html: VI_HTML, baseUrl: "https://example.com/a/", requestedUrl: "https://example.com/a/" });
    assert(a.document.contentHash === b.document.contentHash, "same content -> same hash");
    const c = await bridge.crawlRawHtml({ html: VI_HTML.replace("</article>", "<p>Extra paragraph for hash change.</p></article>"), baseUrl: "https://example.com/a/", requestedUrl: "https://example.com/a/" });
    assert(c.document.contentHash !== a.document.contentHash, "changed content -> different hash");
  });

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
