"use strict";

/**
 * UNFOLDIQ acquisition router + orchestration (PHASE 1G.1 Prompt 02).
 *
 *   safety gate -> binary-type gate -> robots.txt -> route
 *     ├─ direct ......... Crawl4AI (default; JS-heavy alone is NOT a fallback trigger)
 *     └─ browser ........ Playwright interaction/auth -> rendered HTML -> Crawl4AI raw-HTML normalization
 *
 * Acquisition ends at normalized AcquiredDocuments. No truth, independence,
 * authority, or sufficiency decisions are made here (Prompt 03 owns those).
 * Web content stays UNTRUSTED DATA: acquired text is never executed.
 */

const fs = require("fs");
const http = require("http");
const https = require("https");
const os = require("os");
const path = require("path");
const safety = require("./url-safety.js");
const bridge = require("./crawl4ai-bridge.js");
const searchProvider = require("./search-provider.js");

const PROJECT_ROOT = path.join(__dirname, "..", "..");

const BINARY_EXTENSIONS = new Set([
  ".pdf", ".zip", ".rar", ".7z", ".tar", ".gz",
  ".mp4", ".webm", ".mov", ".avi", ".mkv",
  ".mp3", ".wav", ".ogg", ".flac",
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".bmp",
  ".exe", ".msi", ".dmg", ".apk", ".bin", ".iso",
  ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
]);

const ROBOTS_TTL_MS = 60 * 60 * 1000;
const robotsCache = new Map(); // host -> { at, rules }

const RETRYABLE = new Set(["NETWORK_TIMEOUT", "HTTP_ERROR", "RATE_LIMITED", "WORKER_TIMEOUT"]);
const MAX_RETRIES = 2;
const MAX_RETRY_AFTER_MS = 30000;

const CAPTCHA_MARKERS = ["g-recaptcha", "cf-challenge", "challenge-platform", "data-sitekey", "captcha"];

function hasBinaryExtension(urlString) {
  try {
    const ext = path.extname(new URL(urlString).pathname).toLowerCase();
    return BINARY_EXTENSIONS.has(ext);
  } catch {
    return false;
  }
}

function defaultFetcher(urlString, timeoutMs) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(urlString);
    } catch (e) {
      reject(e);
      return;
    }
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.get(urlString, { timeout: timeoutMs || 10000 }, (res) => {
      let body = "";
      res.on("data", (d) => {
        body += d.toString("utf8");
        if (body.length > 256 * 1024) req.destroy(new Error("robots.txt too large"));
      });
      res.on("end", () => resolve({ statusCode: res.statusCode, headers: res.headers, body }));
    });
    req.on("timeout", () => req.destroy(new Error("robots fetch timeout")));
    req.on("error", reject);
  });
}

/** Minimal robots.txt: User-agent * (+unfoldiq) groups, Allow/Disallow longest-match. */
function parseRobots(text) {
  const rules = []; // { agents:[], allow:[], disallow:[] }
  let current = null;
  for (const rawLine of String(text || "").split("\n")) {
    const line = rawLine.split("#")[0].trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();
    if (field === "user-agent") {
      if (!current || current.seenRule) {
        current = { agents: [], allow: [], disallow: [], seenRule: false };
        rules.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if (field === "allow" && current) {
      current.seenRule = true;
      if (value) current.allow.push(value);
    } else if (field === "disallow" && current) {
      current.seenRule = true;
      if (value) current.disallow.push(value);
    }
  }
  return rules;
}

function robotsDecision(rules, urlPath) {
  const applicable = rules.filter((g) => g.agents.some((a) => a === "*" || a.includes("unfoldiq")));
  let bestAllow = -1;
  let bestDisallow = -1;
  for (const g of applicable) {
    for (const a of g.allow) {
      if (a && urlPath.startsWith(a) && a.length > bestAllow) bestAllow = a.length;
    }
    for (const d of g.disallow) {
      if (d && urlPath.startsWith(d) && d.length > bestDisallow) bestDisallow = d.length;
    }
  }
  if (bestDisallow >= 0 && bestDisallow >= bestAllow) return false;
  return true;
}

async function checkRobots(targetUrl, opts = {}) {
  const u = new URL(targetUrl);
  const host = u.hostname.toLowerCase();
  const cached = robotsCache.get(host);
  if (cached && Date.now() - cached.at < ROBOTS_TTL_MS) {
    return robotsDecision(cached.rules, u.pathname || "/")
      ? { allowed: true }
      : { allowed: false, code: "ROBOTS_DISALLOWED", message: `robots.txt disallows ${u.pathname || "/"}` };
  }
  const fetch = opts.fetcher || defaultFetcher;
  let text = "";
  try {
    const res = await fetch(`${u.protocol}//${u.host}/robots.txt`, opts.fetchTimeoutMs);
    if (res && res.statusCode === 200 && typeof res.body === "string") text = res.body;
  } catch {
    return { allowed: true, reason: "robots.txt unreachable; fail-open for fetch, logged" };
  }
  const rules = parseRobots(text);
  robotsCache.set(host, { at: Date.now(), rules });
  return robotsDecision(rules, u.pathname || "/")
    ? { allowed: true }
    : { allowed: false, code: "ROBOTS_DISALLOWED", message: `robots.txt disallows ${u.pathname || "/"}` };
}

function clearRobotsCache() {
  robotsCache.clear();
}

/** CURRENT_STATE bypasses stale cache; EVERGREEN_OK reuses cache. */
function cacheModeFor(freshnessRequirement) {
  if (typeof freshnessRequirement === "string" && /current_state/i.test(freshnessRequirement)) return "BYPASS";
  return "ENABLED";
}

function retryAfterMs(headers) {
  if (!headers || typeof headers !== "object") return null;
  const raw = headers["retry-after"] ?? headers["Retry-After"];
  if (raw === undefined) return null;
  const secs = parseInt(String(raw).split(",")[0].trim(), 10);
  if (Number.isNaN(secs) || secs < 0) return null;
  return Math.min(secs * 1000, MAX_RETRY_AFTER_MS);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function summarize(document, extra = {}) {
  return {
    requestId: extra.requestId || null,
    host: (() => { try { return new URL(document.finalUrl || document.requestedUrl).hostname; } catch { return null; } })(),
    route: document.route || null,
    status: document.success ? "ACQUIRED" : "FAILED",
    statusCode: document.statusCode,
    errorCode: document.errorCode,
    retryCount: extra.retryCount || 0,
    contentLength: document.rawMarkdown ? document.rawMarkdown.length : 0,
    contentHash: document.contentHash,
    elapsedMs: extra.elapsedMs ?? null,
  };
}

async function crawlWithRetry(url, opts = {}) {
  const maxRetries = Number.isInteger(opts.maxRetries) ? opts.maxRetries : MAX_RETRIES;
  let attempt = 0;
  let lastDoc = null;
  for (;;) {
    const started = Date.now();
    const batch = await bridge.crawlUrls([{ url }], opts);
    const elapsedMs = Date.now() - started;
    if (!batch.ok) {
      lastDoc = bridge.toAcquiredDocument({
        requestedUrl: url, success: false, errorCode: batch.code, errorMessage: batch.error,
      }, { route: "crawl4ai-direct" });
      if (!RETRYABLE.has(batch.code) || attempt >= maxRetries) {
        return { document: lastDoc, attempts: attempt + 1, elapsedMs };
      }
      attempt++;
      await sleep(500 * 2 ** (attempt - 1));
      continue;
    }
    const doc = batch.documents[0];
    // Defense in depth: re-validate the final landing URL after redirects.
    const chain = await safety.validateRedirectChain(url, doc.finalUrl ? [doc.finalUrl] : [], opts.safetyOpts);
    if (!chain.ok) {
      return {
        document: { ...doc, success: false, errorCode: chain.code, errorMessage: chain.message },
        attempts: attempt + 1,
        elapsedMs,
      };
    }
    if (!doc.success && doc.statusCode === 429 && attempt < maxRetries) {
      const wait = retryAfterMs(doc.responseHeaders) ?? 500 * 2 ** attempt;
      attempt++;
      await sleep(wait);
      continue;
    }
    if (!doc.success && RETRYABLE.has(doc.errorCode) && attempt < maxRetries) {
      attempt++;
      await sleep(500 * 2 ** (attempt - 1));
      continue;
    }
    return { document: doc, attempts: attempt + 1, elapsedMs };
  }
}

/**
 * Full acquisition for one URL: safety -> binary gate -> robots -> routed crawl.
 * opts: { route:'direct'|'browser', browser:{...}, safetyOpts, cacheMode,
 *         fitQuery, maxRetries, requestId, signal }
 */
async function acquireUrl(url, opts = {}) {
  const started = Date.now();
  const safe = await safety.checkUrlSafety(url, opts.safetyOpts);
  if (!safe.ok) {
    return { ok: false, code: safe.code, message: safe.message, url };
  }
  if (hasBinaryExtension(safe.normalizedUrl)) {
    return { ok: false, code: "UNSUPPORTED_CONTENT_TYPE", message: "binary/unsupported content type by extension", url: safe.normalizedUrl };
  }
  if (opts.route !== "browser") {
    const robots = await checkRobots(safe.normalizedUrl, opts);
    if (!robots.allowed) {
      return { ok: false, code: robots.code, message: robots.message, url: safe.normalizedUrl };
    }
  }
  // Browser-authenticated user-authorized workflows have different robots
  // semantics, but the browser path must never be used to bypass a robots
  // restriction for public crawling: the robots check above still applies
  // unless the caller passes an explicit authorized-session reason. Default:
  // enforced for both routes.
  if (opts.route === "browser" && !opts.authorizedSession) {
    const robots = await checkRobots(safe.normalizedUrl, opts);
    if (!robots.allowed) {
      return { ok: false, code: robots.code, message: robots.message, url: safe.normalizedUrl };
    }
  }
  if (opts.route === "browser") {
    return acquireViaBrowser(safe.normalizedUrl, { ...opts, started });
  }
  const { document, attempts, elapsedMs } = await crawlWithRetry(safe.normalizedUrl, opts);
  if (!document.success) {
    return { ok: false, code: document.errorCode, message: document.errorMessage, url: safe.normalizedUrl, document, summary: summarize(document, { requestId: opts.requestId, retryCount: attempts - 1, elapsedMs }) };
  }
  return { ok: true, document, url: safe.normalizedUrl, summary: summarize(document, { requestId: opts.requestId, retryCount: attempts - 1, elapsedMs: Date.now() - started }) };
}

/** Bounded batch with max concurrency + per-host politeness delay. */
async function acquireBatch(urls, opts = {}) {
  const list = [...(urls || [])];
  const concurrency = Math.max(1, Math.min(opts.concurrency || 2, 5));
  const hostDelayMs = opts.hostDelayMs ?? 1000;
  const lastHostAt = new Map();
  const results = new Array(list.length);
  let cursor = 0;
  async function worker() {
    for (;;) {
      const i = cursor++;
      if (i >= list.length) return;
      const entry = list[i];
      const url = typeof entry === "string" ? entry : entry.url;
      const entryOpts = typeof entry === "string" ? {} : { route: entry.route, browser: entry.browser };
      let host = "";
      try { host = new URL(url).hostname; } catch { /* safety gate reports it */ }
      if (host) {
        const wait = hostDelayMs - (Date.now() - (lastHostAt.get(host) || 0));
        if (wait > 0) await sleep(wait);
      }
      const res = await acquireUrl(url, { ...opts, ...(entryOpts.route ? { route: entryOpts.route, browser: entryOpts.browser } : {}) });
      if (host) lastHostAt.set(host, Date.now());
      results[i] = res;
    }
  }
  await Promise.all(new Array(concurrency).fill(0).map(worker));
  return results;
}

// ---------------------------------------------------------------------------
// Browser extraction path (existing @playwright/test stack — no new framework).
// ---------------------------------------------------------------------------

function defaultAuthStateDir() {
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, "UNFOLDIQ", "auth-state");
  }
  return path.join(os.homedir(), ".unfoldiq", "auth-state");
}

function authStatePathFor(name) {
  const safe = String(name || "default").replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 64) || "default";
  return path.join(defaultAuthStateDir(), `${safe}.json`);
}

/** Refuse to keep credential material inside the repository. */
function ensureOutsideRepo(filePath) {
  const abs = path.resolve(filePath);
  const root = path.resolve(PROJECT_ROOT);
  if (abs === root || abs.startsWith(root + path.sep)) {
    return { ok: false, code: "AUTH_STATE_IN_REPO", message: "auth state must live outside the repository" };
  }
  return { ok: true, path: abs };
}

function looksLikeLoginPage(url, bodyText) {
  return /\/login(\?|#|$)/i.test(url) || /type=["']password["']/i.test(bodyText || "");
}

function looksLikeChallenge(bodyText) {
  const low = String(bodyText || "").toLowerCase();
  return CAPTCHA_MARKERS.some((m) => low.includes(m));
}

async function acquireViaBrowser(url, opts = {}) {
  const started = opts.started || Date.now();
  const browserOpts = opts.browser || {};
  let chromium;
  try {
    ({ chromium } = require("@playwright/test"));
  } catch (e) {
    return { ok: false, code: "BROWSER_UNAVAILABLE", message: `Playwright stack not loadable: ${e.message}`, url };
  }
  const authPath = browserOpts.authStatePath || null;
  if (authPath) {
    const guard = ensureOutsideRepo(authPath);
    if (!guard.ok) return { ok: false, code: guard.code, message: guard.message, url };
  }
  let browser = null;
  try {
    browser = await chromium.launch({ headless: true });
    const contextOpts = {};
    if (authPath && fs.existsSync(authPath)) contextOpts.storageState = authPath;
    const context = await browser.newContext(contextOpts);
    const page = await context.newPage();
    const navTimeout = browserOpts.navigationTimeoutMs || 45000;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: navTimeout });
    const afterNavUrl = page.url();
    let body = "";
    try { body = await page.content(); } catch { body = ""; }
    if (browserOpts.requireAuth && looksLikeLoginPage(afterNavUrl, body) && !(authPath && fs.existsSync(authPath))) {
      return { ok: false, code: "AUTH_REQUIRED", message: "protected page requires an authorized session", url };
    }
    if (looksLikeChallenge(body) && /denied|challenge|attention required/i.test(body)) {
      return { ok: false, code: "HUMAN_ACTION_REQUIRED", message: "access challenge presented; not bypassed", url };
    }
    for (const action of browserOpts.actions || []) {
      if (action.type === "click" && action.selector) {
        await page.click(action.selector, { timeout: browserOpts.actionTimeoutMs || 10000 });
      } else if (action.type === "waitForSelector" && action.selector) {
        await page.waitForSelector(action.selector, { timeout: browserOpts.actionTimeoutMs || 10000 });
      } else if (action.type === "waitForText" && action.text) {
        await page.getByText(action.text).first().waitFor({ timeout: browserOpts.actionTimeoutMs || 10000 });
      } else {
        return { ok: false, code: "INVALID_BROWSER_ACTION", message: `unsupported browser action: ${JSON.stringify(action).slice(0, 120)}`, url };
      }
    }
    const finalUrl = page.url();
    const finalSafe = await safety.checkUrlSafety(finalUrl, opts.safetyOpts);
    if (!finalSafe.ok) {
      return { ok: false, code: finalSafe.code, message: `browser final URL blocked: ${finalSafe.message}`, url };
    }
    const html = await page.content();
    const normalized = await bridge.crawlRawHtml(
      { html, baseUrl: finalUrl, requestedUrl: url, fitQuery: opts.fitQuery || null },
      { cacheMode: "BYPASS", pageTimeoutMs: opts.pageTimeoutMs, processTimeoutMs: opts.processTimeoutMs, signal: opts.signal }
    );
    if (!normalized.ok) {
      return { ok: false, code: normalized.code, message: normalized.error, url };
    }
    const document = { ...normalized.document, route: "browser-captured-html", browserAcquired: true };
    return { ok: true, document, url: finalSafe.normalizedUrl, summary: summarize(document, { requestId: opts.requestId, elapsedMs: Date.now() - started }) };
  } catch (e) {
    const msg = String((e && e.message) || e);
    if (/timeout/i.test(msg)) {
      return { ok: false, code: "NETWORK_TIMEOUT", message: msg.slice(0, 300), url };
    }
    return { ok: false, code: "EXTRACTION_FAILED", message: msg.slice(0, 300), url };
  } finally {
    if (browser) {
      try { await browser.close(); } catch { /* already closed */ }
    }
  }
}

module.exports = {
  BINARY_EXTENSIONS,
  MAX_RETRIES,
  acquireUrl,
  acquireBatch,
  acquireViaBrowser,
  checkRobots,
  clearRobotsCache,
  parseRobots,
  cacheModeFor,
  defaultAuthStateDir,
  authStatePathFor,
  ensureOutsideRepo,
  hasBinaryExtension,
  summarize,
  searchProvider,
};
