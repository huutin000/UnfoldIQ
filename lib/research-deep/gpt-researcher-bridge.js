"use strict";

/**
 * UNFOLDIQ GPT-Researcher Node<->Python bridge (PHASE 1G.1 Prompt 05).
 *
 * Mirrors the proven Prompt-02 Crawl4AI pattern: Node owns orchestration,
 * Python (research/deep-worker.py) owns the provider library, JSON owns the
 * process boundary (stdout = protocol, stderr = diagnostics, exit code =
 * status). Dedicated venv research/.venv-deep — never the Crawl4AI env.
 *
 * Ops: version (no-cost import check), config (names-only credential check),
 * run (bounded deep research; requires explicit live-test opt-in).
 */

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { PROVIDER_PROTOCOL_VERSION, normalizeDeepResult, validateDeepRequest } = require("./provider-interface.js");

const PROJECT_ROOT = path.join(__dirname, "..", "..");
const DEEP_VENV_PYTHON = path.join(PROJECT_ROOT, "research", ".venv-deep", "Scripts", "python.exe");
const DEEP_WORKER_PATH = path.join(PROJECT_ROOT, "research", "deep-worker.py");

const DEFAULTS = {
  processTimeoutMs: 5 * 60 * 1000,
  startupTimeoutMs: 120 * 1000,
};

function venvPythonPath() {
  if (process.env.UNFOLDIQ_DEEP_PYTHON && fs.existsSync(process.env.UNFOLDIQ_DEEP_PYTHON)) {
    return process.env.UNFOLDIQ_DEEP_PYTHON;
  }
  return DEEP_VENV_PYTHON;
}

function runWorker(request, opts = {}) {
  const timeoutMs = opts.processTimeoutMs || DEFAULTS.processTimeoutMs;
  const signal = opts.signal;
  const python = venvPythonPath();
  return new Promise((resolve) => {
    let child;
    try {
      // Env merge lets tests inject names-only fixtures hermetically (E5):
      // empty-string overrides neutralize inherited provider keys.
      const env = opts.env ? { ...process.env, ...opts.env } : process.env;
      child = spawn(python, [DEEP_WORKER_PATH], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, env });
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
      finish({ ok: false, code: "WORKER_TIMEOUT", error: `deep worker exceeded ${timeoutMs}ms; owned child terminated; stderr tail: ${stderr.slice(-500)}` });
    }, timeoutMs);
    if (signal) {
      if (signal.aborted) {
        try { child.kill(); } catch { /* owned child only */ }
        finish({ ok: false, code: "WORKER_CANCELLED", error: "deep run cancelled; owned child terminated" });
        return;
      }
      signal.addEventListener("abort", () => {
        try { child.kill(); } catch { /* owned child only */ }
        finish({ ok: false, code: "WORKER_CANCELLED", error: "deep run cancelled; owned child terminated" });
      }, { once: true });
    }
    child.stdout.on("data", (d) => { stdout += d.toString("utf8"); });
    child.stderr.on("data", (d) => { stderr += d.toString("utf8"); });
    child.on("error", (e) => {
      finish({ ok: false, code: "WORKER_SPAWN_FAILED", error: String((e && e.message) || e) });
    });
    child.on("close", (code) => {
      if (code !== 0 && !stdout.trim()) {
        finish({ ok: false, code: "WORKER_FAILED", error: `deep worker exit=${code}: ${stderr.slice(-1000)}` });
        return;
      }
      try {
        finish({ ok: true, response: JSON.parse(stdout) });
      } catch (e) {
        finish({ ok: false, code: "BRIDGE_PROTOCOL_ERROR", error: `unparseable deep worker stdout: ${e.message}; stderr tail: ${stderr.slice(-500)}` });
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
 * Runtime readiness without spending: READY | READY_NO_LIVE_APPROVAL |
 * MISSING_CREDENTIALS | NOT_INSTALLED | BROKEN (§18).
 */
async function checkReady(opts = {}) {
  const python = venvPythonPath();
  if (!fs.existsSync(python)) {
    return { status: "NOT_INSTALLED", python, diagnostic: "deep venv python not found; run npm run research:deep:setup" };
  }
  if (!fs.existsSync(DEEP_WORKER_PATH)) {
    return { status: "BROKEN", python, diagnostic: "deep worker script missing" };
  }
  const ver = await runWorker(
    { protocolVersion: PROVIDER_PROTOCOL_VERSION, operation: "version" },
    { processTimeoutMs: opts.processTimeoutMs || DEFAULTS.startupTimeoutMs, env: opts.env }
  );
  if (!ver.ok) return { status: "BROKEN", python, diagnostic: ver.error };
  if (!ver.response || ver.response.ok !== true) {
    return { status: "BROKEN", python, diagnostic: (ver.response && ver.response.errorMessage) || "bad version response" };
  }
  const cfg = await runWorker(
    { protocolVersion: PROVIDER_PROTOCOL_VERSION, operation: "config" },
    { processTimeoutMs: opts.processTimeoutMs || DEFAULTS.startupTimeoutMs, env: opts.env }
  );
  const configState = cfg.ok && cfg.response ? cfg.response : null;
  const llmOk = !!(configState && configState.llmConfigured);
  const searchOk = !!(configState && configState.searchConfigured);
  const embeddingOk = !!(configState && configState.embeddingConfigured);
  const llmSup = !(configState && configState.llm) || configState.llm.supported !== false;
  const searchSup = !(configState && configState.search) || configState.search.supported !== false;
  const embeddingSup = !(configState && configState.embedding) || configState.embedding.supported !== false;
  const base = {
    python,
    worker: DEEP_WORKER_PATH,
    providerVersion: (ver.response && ver.response.providerVersion) || null,
    llmConfigured: llmOk,
    searchConfigured: searchOk,
    embeddingConfigured: embeddingOk,
    liveApproved: !!(configState && configState.liveApproved),
    llm: (configState && configState.llm) || null,
    search: (configState && configState.search) || null,
    embedding: (configState && configState.embedding) || null,
  };
  if (!llmSup || !searchSup || !embeddingSup) {
    return {
      ...base,
      status: "NOT_SUPPORTED",
      diagnostic: "selected provider/retriever/embedding not supported by installed gpt-researcher version",
    };
  }
  if (!configState || !configState.liveApproved) {
    const missing = [
      !llmOk && "LLM",
      !searchOk && "search",
      !embeddingOk && (configState && configState.embedding && configState.embedding.error
        ? `EMBEDDING (${configState.embedding.error})`
        : !embeddingOk && "EMBEDDING"),
    ].filter(Boolean);
    return {
      ...base,
      status: "READY_NO_LIVE_APPROVAL",
      ...(missing.length > 0 ? { diagnostic: `would still be missing after approval: ${missing.join("; ")}` } : {}),
    };
  }
  if (!llmOk || !searchOk || !embeddingOk) {
    const missing = [
      !llmOk && "LLM",
      !searchOk && "search",
      !embeddingOk && (configState && configState.embedding && configState.embedding.error
        ? `EMBEDDING (${configState.embedding.error})`
        : "EMBEDDING"),
    ].filter(Boolean);
    return { ...base, status: "MISSING_CREDENTIALS", diagnostic: `missing: ${missing.join("; ")}` };
  }
  return { ...base, status: "READY" };
}

/**
 * GPTResearcherProvider adapter: DeepResearchProvider.run(request).
 * Never called without escalation eligibility + live approval (checked here
 * defensively as well as in the orchestrator).
 */
async function runDeepResearch(request, opts = {}) {
  const errors = validateDeepRequest(request);
  if (errors.length > 0) {
    return { ok: false, code: "DEEP_PROVIDER_ERROR", error: errors.join("; ") };
  }
  const res = await runWorker(
    { protocolVersion: PROVIDER_PROTOCOL_VERSION, operation: "run", request },
    { processTimeoutMs: opts.processTimeoutMs || request.maxDurationMs || DEFAULTS.processTimeoutMs, signal: opts.signal }
  );
  if (!res.ok) {
    const code = ["WORKER_TIMEOUT", "WORKER_CANCELLED", "BRIDGE_PROTOCOL_ERROR", "WORKER_SPAWN_FAILED", "WORKER_FAILED"].includes(res.code)
      ? res.code : "DEEP_PROVIDER_ERROR";
    return { ok: false, code, error: res.error };
  }
  const body = res.response || {};
  if (body.ok !== true) {
    return { ok: false, code: body.errorCode || "DEEP_PROVIDER_ERROR", error: body.errorMessage || "provider run failed", warnings: body.warnings || [] };
  }
  return { ok: true, result: normalizeDeepResult(body.result || {}, request), warnings: body.warnings || [] };
}

module.exports = {
  PROVIDER_PROTOCOL_VERSION,
  DEFAULTS,
  DEEP_VENV_PYTHON,
  DEEP_WORKER_PATH,
  venvPythonPath,
  runWorker,
  checkReady,
  runDeepResearch,
};
