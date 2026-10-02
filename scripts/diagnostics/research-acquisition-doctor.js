"use strict";

/**
 * UNFOLDIQ research-acquisition doctor (PHASE 1G.1 Prompt 02).
 * Checks: Node/npm, venv Python, Crawl4AI import/version, bridge protocol,
 * Playwright availability, auth storage path config.
 * Prints no secrets. Exit 0 always (doctor reports, never fails builds).
 * --smoke additionally runs a local raw-HTML normalization (no internet).
 */

const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.join(__dirname, "..", "..");
const bridge = require("../../lib/research-acquisition/crawl4ai-bridge.js");
const acquisition = require("../../lib/research-acquisition/acquisition.js");

function section(title) {
  console.log(`\n## ${title}`);
}

function line(s) {
  console.log(s);
}

async function main() {
  const smoke = process.argv.includes("--smoke");
  console.log("=== UNFOLDIQ RESEARCH-ACQUISITION DOCTOR ===");

  section("Runtime");
  line(`node: ${process.version} (need >=18)`);
  line(`platform: ${process.platform}`);

  section("Python / venv");
  line(`venv python: ${bridge.VENV_PYTHON} ${fs.existsSync(bridge.VENV_PYTHON) ? "PRESENT" : "MISSING"}`);
  line(`worker: ${bridge.WORKER_PATH} ${fs.existsSync(bridge.WORKER_PATH) ? "PRESENT" : "MISSING"}`);
  try {
    const req = fs.readFileSync(path.join(PROJECT_ROOT, "research", "requirements.txt"), "utf8").trim();
    line(`pinned requirements: ${req.split("\n").join(", ")}`);
  } catch {
    line("pinned requirements: MISSING research/requirements.txt");
  }

  section("Crawl4AI bridge");
  const ready = await bridge.checkReady();
  line(`status: ${ready.status}${ready.crawlerVersion ? ` crawlerVersion=${ready.crawlerVersion}` : ""}`);
  if (ready.diagnostic) line(`diagnostic: ${ready.diagnostic}`);

  if (smoke) {
    section("Local smoke (raw HTML, no internet)");
    try {
      const res = await bridge.crawlRawHtml({
        html: "<html><head><title>Doctor smoke — kiểm tra UTF-8</title></head><body><p>Nước dùng phở cần xương ống.</p></body></html>",
        baseUrl: "https://example.com/doctor/",
        requestedUrl: "https://example.com/doctor/",
      }, { processTimeoutMs: 120000 });
      if (res.ok && res.document.success) {
        line(`raw markdown: OK (${(res.document.rawMarkdown || "").length} chars, hash=${res.document.contentHash})`);
        line(`utf8 title: ${res.document.title}`);
      } else {
        line(`smoke FAILED: ${(res.document && res.document.errorMessage) || res.error || res.code}`);
      }
    } catch (e) {
      line(`smoke ERROR: ${e.message}`);
    }
  } else {
    line("smoke: skipped (run with --smoke for a local browser normalization check)");
  }

  section("Playwright stack");
  try {
    require.resolve("@playwright/test");
    const pw = require("@playwright/test");
    line(`@playwright/test: PRESENT (chromium.launch=${typeof pw.chromium.launch})`);
    line("no Playwright MCP / agent-browser / extra framework added (by design)");
  } catch {
    line("@playwright/test: MISSING");
  }

  section("Auth storage");
  const dir = acquisition.defaultAuthStateDir();
  line(`default dir: ${dir}`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    line("dir: ensured outside repository (credential material never committed)");
  } catch (e) {
    line(`dir: CANNOT_CREATE (${e.message})`);
  }
  const guard = acquisition.ensureOutsideRepo(path.join(dir, "probe.json"));
  line(`outside-repo guard: ${guard.ok ? "OK" : "FAIL"}`);

  line("\nsecrets: none printed (by design)");
}

main().then(() => process.exit(0), (e) => {
  console.error(`doctor error: ${e.message}`);
  process.exit(0);
});
