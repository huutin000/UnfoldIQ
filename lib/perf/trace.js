"use strict";
// lib/perf/trace.js — Phase 5A trace model + bottleneck ranking + budget profile.
// Reuses lib/telemetry span/event correlation (projectId/runId/jobId/
// correlationId); adds traceId/spanId/parentSpanId semantics only as a thin
// view layer — no second trace store (spec §7).

const stats = require("./stats");

// Canonical stage taxonomy floor (spec §8). Versioned; extend, never rename.
const STAGE_TAXONOMY_VERSION = "1.0.0";
const STAGES = [
  "CORE_PLAN", "RESEARCH", "MODEL_CALL", "TOOL_CALL", "QUEUE_WAIT",
  "PROVIDER_SUBMIT", "PROVIDER_WAIT", "PROVIDER_RESULT",
  "CORE_TO_BRIDGE", "BRIDGE_TO_EXTENSION", "EXTENSION_WAKE", "EXTENSION_ACTION",
  "EXTENSION_DOM_SCAN", "RESULT_DETECTION",
  "DOWNLOAD", "IMPORT", "STORAGE_READ", "STORAGE_WRITE",
  "QA", "TIMELINE_BUILD", "MOTION_PLAN", "RESPONSIVE_DERIVE",
  "RENDER_PREFLIGHT", "RENDER", "DELIVERY_CONFORM", "TECHNICAL_QC",
  "SEMANTIC_QA", "CONTENT_QA", "PACKAGING",
];

function makeSpan(o) {
  if (!o || typeof o.name !== "string" || !o.name) throw new Error("SCHEMA_INVALID: span name required");
  if (!STAGES.includes(o.category)) throw new Error("SCHEMA_INVALID: unknown stage category " + o.category);
  const start = Number(o.startTime);
  const end = Number(o.endTime);
  if (!isFinite(start) || !isFinite(end) || end < start) throw new Error("SCHEMA_INVALID: span end < start");
  return {
    spanId: String(o.spanId),
    parentSpanId: o.parentSpanId !== undefined ? String(o.parentSpanId) : null,
    category: o.category,
    name: o.name,
    startTime: start,
    endTime: end,
    durationMs: end - start,
    waitMs: o.waitMs !== undefined ? Number(o.waitMs) : null,
    activeMs: o.activeMs !== undefined ? Number(o.activeMs) : null,
    payloadBytesIn: o.payloadBytesIn !== undefined ? Number(o.payloadBytesIn) : null,
    payloadBytesOut: o.payloadBytesOut !== undefined ? Number(o.payloadBytesOut) : null,
    retryCount: o.retryCount !== undefined ? Number(o.retryCount) : 0,
    toolCallCount: o.toolCallCount !== undefined ? Number(o.toolCallCount) : 0,
    cost: o.cost !== undefined ? o.cost : null,
    evidence: o.evidence || "MEASURED_REAL",
  };
}

// Critical path: longest parent→child chain by endTime (parallel spans are
// never summed as wall-clock — spec RULE 7).
function criticalPath(spans) {
  const list = Array.isArray(spans) ? spans : [];
  if (list.length === 0) return { durationMs: 0, path: [] };
  const byId = {};
  for (const s of list) byId[s.spanId] = s;
  // Roots = spans with no known parent; path length via memoized DFS on children.
  const children = {};
  for (const s of list) {
    const p = s.parentSpanId && byId[s.parentSpanId] ? s.parentSpanId : null;
    if (!children[p]) children[p] = [];
    children[p].push(s);
  }
  const memo = {};
  function longest(id) {
    if (memo[id]) return memo[id];
    const kids = children[id] || [];
    if (kids.length === 0) {
      const leaf = id === null ? { durationMs: 0, path: [] } : { durationMs: 0, path: [id] };
      memo[id] = leaf;
      return leaf;
    }
    let best = { durationMs: -1, path: [] };
    for (const k of kids) {
      const sub = longest(k.spanId);
      // Sequential contribution of k on this path = own duration beyond parent
      // overlap; conservative: k.durationMs when parent is null/sequential.
      const cand = sub.durationMs + k.durationMs;
      if (cand > best.durationMs) best = { durationMs: cand, path: [k.spanId].concat(sub.path) };
    }
    memo[id] = best;
    return best;
  }
  const wallStart = Math.min.apply(null, list.map((s) => s.startTime));
  const wallEnd = Math.max.apply(null, list.map((s) => s.endTime));
  const chain = longest(null);
  return { durationMs: wallEnd - wallStart, criticalChainMs: chain.durationMs, path: chain.path };
}

// Transparent ranking: impact × frequency × cost × fixability (spec §10).
// No opaque AI score; factors + formula version persisted per entry.
const RANK_FORMULA_VERSION = "impact* frequency* cost* fixability v1";
const FIX_W = { LOW: 1, MEDIUM: 2, HIGH: 3 };
const CONF_SET = ["LOW", "MEDIUM", "HIGH"];
const OWNER_SET = ["5A", "5B", "5C", "POST_V1"];

function rankBottlenecks(entries) {
  const out = (Array.isArray(entries) ? entries : []).map((e) => {
    if (!FIX_W[e.fixability]) throw new Error("SCHEMA_INVALID: fixability " + e.fixability);
    if (!CONF_SET.includes(e.confidence)) throw new Error("SCHEMA_INVALID: confidence " + e.confidence);
    if (!OWNER_SET.includes(e.recommendedOwner)) throw new Error("SCHEMA_INVALID: owner " + e.recommendedOwner);
    const score = Number(e.measuredImpactMs) * Number(e.frequency) * Number(e.costImpact || 1) * FIX_W[e.fixability];
    return Object.assign({}, e, { rankScore: score, rankFormula: RANK_FORMULA_VERSION });
  });
  out.sort((a, b) => b.rankScore - a.rankScore);
  return out;
}

const BUDGET_PROFILE_VERSION = "1.0.0";
const BUDGET_SOURCES = ["MEASURED_BASELINE", "USER_REQUIREMENT", "PLATFORM_CONSTRAINT", "MARKET_REFERENCE"];

function makeBudget(metric, o) {
  if (!BUDGET_SOURCES.includes(o.source)) throw new Error("SCHEMA_INVALID: budget source " + o.source);
  if (o.source === "MEASURED_BASELINE" && (o.baselineRef === undefined || !o.baselineRef)) {
    throw new Error("SCHEMA_INVALID: MEASURED_BASELINE budget requires baselineRef");
  }
  if (o.direction !== "higher" && !(o.target < o.warning)) throw new Error("SCHEMA_INVALID: budget requires target < warning");
  if (o.direction === "higher" && !(o.target > o.warning)) throw new Error("SCHEMA_INVALID: higher-is-better budget requires target > warning");
  return {
    metric: metric,
    direction: o.direction || "lower",
    percentile: o.percentile || null,
    target: o.target,
    warning: o.warning,
    hardLimit: o.hardLimit !== undefined ? o.hardLimit : null,
    unit: o.unit,
    rationale: o.rationale || "",
    source: o.source,
    baselineRef: o.baselineRef || null,
  };
}

module.exports = {
  STAGE_TAXONOMY_VERSION, STAGES, makeSpan, criticalPath,
  rankBottlenecks, RANK_FORMULA_VERSION, makeBudget, BUDGET_PROFILE_VERSION, BUDGET_SOURCES,
  summarize: stats.summarize,
};
