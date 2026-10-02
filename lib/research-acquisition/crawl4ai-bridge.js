"use strict";

/**
 * UNFOLDIQ Crawl4AI Node<->Python bridge (PHASE 1G.1 Prompt 02, work item 1G.1E).
 *
 * Node owns orchestration, Python (research/crawl4ai-worker.py) owns Crawl4AI
 * invocation, JSON owns the process boundary: stdout = machine-readable
 * protocol, stderr = diagnostics, exit code = success/failure.
 *
 * One worker process per acquisition batch reuses a single AsyncWebCrawler
 * lifecycle for N bounded URLs. Bounded process/page timeouts; the owned
 * child is terminated on timeout or abort — never unrelated processes.
 */

const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.join(__dirname, "..", "..");
const VENV_PYTHON = path.join(PROJECT_ROOT, "research", ".venv", "Scripts", "python.exe");
const WORKER_PATH = path.join(PROJECT_ROOT, "research", "crawl4ai-worker.py");
const PROTOCOL_VERSION = 1;

const DEFAULTS = {
  pageTimeoutMs: 45000,
  processTimeoutMs: 180000,
  maxMarkdownChars: 200000,
  maxPagesPerBatch: 8,
  maxLinksPerDocument: 200,
  waitUntil: "domcontentloaded",
  cacheMode: "BYPASS",
};

function sha256Hex(text) {
  return crypto.createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

function venvPythonPath() {
  return VENV_PYTHON;
}

/** Runtime readiness without network: READY | NOT_INSTALLED | BROKEN. */
async function checkReady(opts = {}) {
  if (!fs.existsSync(VENV_PYTHON)) {
    return { status: "NOT_INSTALLED", python: VENV_PYTHON, diagnostic: "research venv python not found; run setup" };
  }
  if (!fs.existsSync(WORKER_PATH)) {
    return { status: "BROKEN", python: VENV_PYTHON, diagnostic: "worker script missing" };
  }
  const res = await runWorker({ protocolVersion: PROTOCOL_VERSION, operation: "version" }, {
    processTimeoutMs: opts.processTimeoutMs || 60000,
  });
  if (!res.ok) {
    return { status: "BROKEN", python: VENV_PYTHON, diagnostic: res.error };
  }
  const body = res.response;
  if (!body || body.ok !== true) {
    return { status: "BROKEN", python: VENV_PYTHON, diagnostic: (body && body.errorMessage) || "bad version response" };
  }
  return { status: "READY", python: VENV_PYTHON, worker: WORKER_PATH, crawlerVersion: body.crawlerVersion };
}

function runWorker(request, opts = {}) {
  const timeoutMs = opts.processTimeoutMs || DEFAULTS.processTimeoutMs;
  const signal = opts.signal;
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(VENV_PYTHON, [WORKER_PATH], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    } catch (e) {
      resolve({ ok: false, code: "WORKER_SPAWN_FAILED", error: String((e && e.message) || e) });
      return;
    }
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* owned child only */ }
      finish({ ok: false, code: "WORKER_TIMEOUT", error: `worker exceeded process timeout ${timeoutMs}ms; owned child terminated` });
    }, timeoutMs);
    if (signal) {
      if (signal.aborted) {
        try { child.kill(); } catch { /* owned child only */ }
        finish({ ok: false, code: "WORKER_CANCELLED", error: "acquisition cancelled; owned child terminated" });
        return;
      }
      signal.addEventListener("abort", () => {
        try { child.kill(); } catch { /* owned child only */ }
        finish({ ok: false, code: "WORKER_CANCELLED", error: "acquisition cancelled; owned child terminated" });
      }, { once: true });
    }
    child.stdout.on("data", (d) => { stdout += d.toString("utf8"); });
    child.stderr.on("data", (d) => { stderr += d.toString("utf8"); });
    child.on("error", (e) => {
      finish({ ok: false, code: "WORKER_SPAWN_FAILED", error: String((e && e.message) || e) });
    });
    child.on("close", (code) => {
      if (code !== 0 && !stdout.trim()) {
        finish({ ok: false, code: "WORKER_FAILED", error: `worker exit=${code}: ${stderr.slice(-1000)}` });
        return;
      }
      try {
        finish({ ok: true, response: JSON.parse(stdout) });
      } catch (e) {
        finish({ ok: false, code: "BRIDGE_PROTOCOL_ERROR", error: `unparseable worker stdout: ${e.message}; stderr tail: ${stderr.slice(-500)}` });
      }
    });
    try {
      child.stdin.write(JSON.stringify(request), "utf8");
      child.stdin.end();
    } catch (e) {
      finish({ ok: false, code: "WORKER_SPAWN_FAILED", error: String((e && e.message) || e) });
    }
  });
}

/**
 * Canonical AcquiredDocument. PAGE ACQUIRED, never CLAIM TRUE: no verified /
 * trusted / confirmed statuses exist in this layer.
 */
function toAcquiredDocument(workerResult, ctx = {}) {
  const doc = {
    requestedUrl: workerResult.requestedUrl || null,
    finalUrl: workerResult.finalUrl || workerResult.requestedUrl || null,
    retrievedAt: workerResult.retrievedAt || new Date().toISOString(),
    success: workerResult.success === true,
    statusCode: workerResult.statusCode ?? null,
    route: ctx.route || "crawl4ai-direct",
    extractionMethod: workerResult.extractionMethod || "crawl4ai-direct",
    crawlerVersion: workerResult.crawlerVersion || null,
    browserAcquired: ctx.browserAcquired === true,
    rawMarkdown: workerResult.rawMarkdown ?? null,
    rawTruncated: workerResult.rawTruncated === true,
    fitMarkdown: workerResult.fitMarkdown ?? null,
    fitTruncated: workerResult.fitTruncated === true,
    fitQuery: workerResult.fitQuery ?? null,
    title: typeof workerResult.title === "string" ? workerResult.title : "",
    metadata: workerResult.metadata && typeof workerResult.metadata === "object" ? workerResult.metadata : {},
    links: Array.isArray(workerResult.links) ? workerResult.links.slice(0, DEFAULTS.maxLinksPerDocument) : [],
    linkCount: workerResult.linkCount ?? 0,
    contentHash: workerResult.contentHash || (workerResult.rawMarkdown ? sha256Hex(workerResult.rawMarkdown) : null),
    errorCode: workerResult.errorCode || null,
    errorMessage: workerResult.errorMessage || null,
  };
  return doc;
}

/** Direct URL batch through one worker lifecycle (bounded by maxPagesPerBatch). */
async function crawlUrls(items, opts = {}) {
  const list = (items || []).slice(0, opts.maxPagesPerBatch || DEFAULTS.maxPagesPerBatch);
  const request = {
    protocolVersion: PROTOCOL_VERSION,
    operation: "crawl",
    defaults: {
      waitUntil: opts.waitUntil || DEFAULTS.waitUntil,
      pageTimeoutMs: opts.pageTimeoutMs || DEFAULTS.pageTimeoutMs,
      cacheMode: opts.cacheMode || DEFAULTS.cacheMode,
      fitQuery: opts.fitQuery || null,
    },
    limits: { maxMarkdownChars: opts.maxMarkdownChars || DEFAULTS.maxMarkdownChars },
    items: list.map((it, i) => ({
      id: it.id || `u${i}`,
      kind: "url",
      url: it.url,
      waitFor: it.waitFor || opts.waitFor || null,
      cacheMode: it.cacheMode || null,
      fitQuery: it.fitQuery || null,
    })),
  };
  const res = await runWorker(request, opts);
  if (!res.ok) {
    return { ok: false, code: res.code, error: res.error };
  }
  if (!res.response || !Array.isArray(res.response.results)) {
    return { ok: false, code: "BRIDGE_PROTOCOL_ERROR", error: "worker response carries no results array" };
  }
  return {
    ok: true,
    crawlerVersion: res.response.crawlerVersion || null,
    documents: res.response.results.map((r) => toAcquiredDocument(r, { route: opts.route || "crawl4ai-direct" })),
  };
}

/** Raw rendered HTML (browser path) through the shared Crawl4AI normalization. */
async function crawlRawHtml({ html, baseUrl, requestedUrl, fitQuery }, opts = {}) {
  const request = {
    protocolVersion: PROTOCOL_VERSION,
    operation: "crawl",
    defaults: {
      waitUntil: opts.waitUntil || DEFAULTS.waitUntil,
      pageTimeoutMs: opts.pageTimeoutMs || DEFAULTS.pageTimeoutMs,
      cacheMode: opts.cacheMode || DEFAULTS.cacheMode,
    },
    limits: { maxMarkdownChars: opts.maxMarkdownChars || DEFAULTS.maxMarkdownChars },
    items: [{
      id: "raw-html",
      kind: "rawHtml",
      url: requestedUrl,
      html,
      baseUrl,
      fitQuery: fitQuery || null,
    }],
  };
  const res = await runWorker(request, opts);
  if (!res.ok) {
    return { ok: false, code: res.code, error: res.error };
  }
  const first = res.response && Array.isArray(res.response.results) ? res.response.results[0] : null;
  if (!first) {
    return { ok: false, code: "BRIDGE_PROTOCOL_ERROR", error: "worker response carries no results array" };
  }
  return {
    ok: true,
    crawlerVersion: res.response.crawlerVersion || null,
    document: toAcquiredDocument(first, { route: "browser-captured-html", browserAcquired: true }),
  };
}

module.exports = {
  PROTOCOL_VERSION,
  DEFAULTS,
  VENV_PYTHON,
  WORKER_PATH,
  venvPythonPath,
  checkReady,
  runWorker,
  crawlUrls,
  crawlRawHtml,
  toAcquiredDocument,
  sha256Hex,
};
