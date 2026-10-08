"use strict";

/**
 * UNFOLDIQ cross-boundary trace contract (Phase 5C §22, GAP-030).
 * Pure span builders/validators shared by the MV3 service worker (browser),
 * the side panel forwarder, and the bridge ingestor (node). No OTel rewrite:
 * spans carry traceId/spanId/parentSpanId + causal timestamps so one
 * operation reconstructs Core → Bridge → Extension → provider action →
 * result → import → ACK → Core convergence.
 *
 * Privacy: spans carry jobId/attempt/kind/timing only — never prompt text,
 * tokens, cookies, or page content.
 */

const TRACE_VERSION = "1.0.0";

const SPAN_KINDS = [
  "EXTENSION_WAKE",
  "TAB_RELAY",
  "APPROVAL_RECORDED",
  "SUBMIT_RELAYED",
  "RESULT_DETECTED",
  "DOWNLOAD_CORRELATED",
  "ARTIFACT_POSTED",
  "STATE_RESTORE",
  "BRIDGE_INGEST",
];

const SPAN_SOURCES = ["extension", "bridge", "core"];

function rid(prefix) {
  const bytes = new Uint8Array(6);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i = i] = Math.floor(Math.random() * 256);
  }
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return `${prefix}-${hex}`;
}

function buildTraceSpan(input = {}, clock = null) {
  if (!input || typeof input !== "object") throw new Error("SCHEMA_INVALID: span object required");
  if (!SPAN_KINDS.includes(input.kind)) throw new Error(`SCHEMA_INVALID: unknown span kind ${input.kind}`);
  if (!SPAN_SOURCES.includes(input.source)) throw new Error(`SCHEMA_INVALID: unknown span source ${input.source}`);
  if (!input.jobId) throw new Error("SCHEMA_INVALID: jobId required");
  const t = typeof clock === "function" ? clock() : Date.now();
  const span = {
    v: TRACE_VERSION,
    traceId: input.traceId || rid("tr"),
    spanId: input.spanId || rid("sp"),
    parentSpanId: input.parentSpanId || null,
    source: input.source,
    kind: input.kind,
    jobId: input.jobId,
    attempt: input.attempt === undefined ? null : input.attempt,
    tStart: input.tStart === undefined ? t : input.tStart,
    tEnd: input.tEnd === undefined ? null : input.tEnd,
    detail: input.detail === undefined ? null : String(input.detail).slice(0, 256),
  };
  const bad = validateTraceSpan(span);
  if (bad) throw new Error(bad);
  return span;
}

function endSpan(span, clock = null) {
  if (!span || typeof span !== "object") throw new Error("SCHEMA_INVALID: span required");
  const t = typeof clock === "function" ? clock() : Date.now();
  const next = { ...span, tEnd: t };
  const bad = validateTraceSpan(next);
  if (bad) throw new Error(bad);
  return next;
}

function validateTraceSpan(s) {
  if (!s || typeof s !== "object") return "SCHEMA_INVALID: span object required";
  if (!SPAN_KINDS.includes(s.kind)) return `SCHEMA_INVALID: unknown span kind ${s.kind}`;
  if (!SPAN_SOURCES.includes(s.source)) return `SCHEMA_INVALID: unknown span source ${s.source}`;
  if (!s.jobId) return "SCHEMA_INVALID: jobId required";
  if (!s.traceId || !s.spanId) return "SCHEMA_INVALID: traceId+spanId required";
  if (typeof s.tStart !== "number") return "SCHEMA_INVALID: tStart must be a number";
  if (s.tEnd !== null && s.tEnd !== undefined && (typeof s.tEnd !== "number" || s.tEnd < s.tStart)) {
    return "SCHEMA_INVALID: tEnd must be null or >= tStart";
  }
  return null;
}

// Causal reconstruction: order spans by time, verify parent linkage forms
// one chain per traceId. Returns {ok, gaps[]} — gaps name missing links,
// never fabricated.
function reconstructTrace(spans) {
  const list = (Array.isArray(spans) ? spans : []).filter((s) => !validateTraceSpan(s));
  const byTrace = new Map();
  for (const s of list) {
    if (!byTrace.has(s.traceId)) byTrace.set(s.traceId, []);
    byTrace.get(s.traceId).push(s);
  }
  const chains = [];
  for (const [traceId, items] of byTrace) {
    const ordered = items.slice().sort((a, b) => a.tStart - b.tStart);
    const ids = new Set(ordered.map((s) => s.spanId));
    const gaps = [];
    for (const s of ordered) {
      if (s.parentSpanId && !ids.has(s.parentSpanId)) gaps.push(`missing parent ${s.parentSpanId} of ${s.spanId}`);
    }
    chains.push({ traceId, spans: ordered, complete: gaps.length === 0, gaps });
  }
  return { chains };
}

const TraceContractApi = { TRACE_VERSION, SPAN_KINDS, SPAN_SOURCES, buildTraceSpan, endSpan, validateTraceSpan, reconstructTrace };

if (typeof module !== "undefined" && module.exports) {
  module.exports = TraceContractApi;
}
// Browser (importScripts) surface: SW + side panel use the global.
try {
  if (typeof globalThis !== "undefined") globalThis.TraceContract = TraceContractApi;
} catch (e) { void e; }
