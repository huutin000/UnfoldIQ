"use strict";

/**
 * Flow Companion bridge client helpers (POST-v1B live run).
 * Pure + fetch-agnostic: callers inject a fetch implementation so the same
 * code runs in the MV3 service worker (global fetch) and in node tests
 * (stub fetch). Loopback-only URLs enforced — never LAN/public.
 */

function normalizeBridgeUrl(raw) {
  if (typeof raw !== "string" || raw.length === 0) throw new Error("BRIDGE_URL_REQUIRED");
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`BRIDGE_URL_INVALID: ${raw}`);
  }
  if (u.protocol !== "http:") throw new Error("BRIDGE_URL_REJECTED: plain http loopback only");
  const host = u.hostname;
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "[::1]") {
    throw new Error(`BRIDGE_URL_REJECTED: loopback only, got ${host}`);
  }
  return `${u.protocol}//${u.host}`;
}

function joinPath(base, p) {
  const b = String(base).replace(/\/+$/, "");
  const q = String(p).startsWith("/") ? String(p) : `/${p}`;
  return `${b}${q}`;
}

async function bridgeCall(fetchImpl, cfg, method, path, body = null, { timeoutMs = 15000 } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("FETCH_UNAVAILABLE: fetch implementation required");
  const base = normalizeBridgeUrl(cfg && cfg.bridgeUrl);
  if (!cfg || !cfg.token) throw new Error("BRIDGE_TOKEN_REQUIRED");
  const url = joinPath(base, path);
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fetchImpl(url, {
      method,
      headers: { "Content-Type": "application/json", "x-bridge-token": cfg.token },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl ? ctrl.signal : undefined,
    });
    let parsed = null;
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }
    if (!res.ok) {
      const code = (parsed && parsed.error) || `BRIDGE_HTTP_${res.status}`;
      throw new Error(code);
    }
    return parsed;
  } catch (e) {
    if (e && e.name === "AbortError") throw new Error("BRIDGE_UNREACHABLE: request timeout");
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function buildApproval({ jobId, attempt, approvedBy }) {
  if (!jobId || attempt === undefined || !approvedBy) throw new Error("SCHEMA_INVALID: jobId+attempt+approvedBy required");
  return { jobId, attempt, approvedBy, approved: true, used: false, approvedAt: new Date().toISOString() };
}

/** Live-loop action map: what the operator/UI should do next for a job status. */
function actionForJobStatus(status) {
  switch (status) {
    case "PREPARED":
      return "AWAITING_APPROVAL_RECORD";
    case "AWAITING_USER_APPROVAL":
      return "OPERATOR_DECIDES";
    case "GENERATING":
      return "POLL_RESULT";
    case "RESULT_DETECTED":
    case "DOWNLOADING":
      return "FETCH_AND_IMPORT";
    case "IMPORTED":
    case "READY":
      return "DONE";
    case "FAILED":
    case "CANCELLED":
    case "REJECTED_BY_USER":
      return "STOP";
    default:
      return "INSPECT";
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { normalizeBridgeUrl, joinPath, bridgeCall, buildApproval, actionForJobStatus };
}
