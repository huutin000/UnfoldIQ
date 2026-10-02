"use strict";

/**
 * UNFOLDIQ SearchProvider abstraction (PHASE 1G.1 Prompt 02, work item 1G.1D).
 *
 * V1 execution model = agent-tool search exchange (dependency-injected):
 *   UNFOLDIQ creates a normalized SearchRequest
 *     -> the current agent (OpenCode / Antigravity / compatible) satisfies it
 *        with its available web-search capability
 *     -> raw results come back over the exchange boundary
 *     -> UNFOLDIQ validates + normalizes into NormalizedSearchResult[]
 *
 * No OpenCode/Antigravity private CLI output parser is hard-coded: the code
 * never shells out to agent internals. If no executor is configured,
 * search() returns SEARCH_PROVIDER_UNAVAILABLE (never a fake empty list).
 *
 * Normalized results carry discovery provenance only (query, provider,
 * retrievedAt, rank). No truth/authority/independence scoring here.
 */

const crypto = require("crypto");

const EXECUTOR_AGENT_EXCHANGE = "agent-exchange";

function makeRequestId() {
  return `srq-${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`;
}

function isValidHttpUrl(value) {
  if (typeof value !== "string" || !value) return false;
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function createSearchRequest(input = {}) {
  const query = typeof input.query === "string" ? input.query.trim() : "";
  if (!query) {
    return { ok: false, code: "INVALID_SEARCH_REQUEST", message: "search query must be non-empty" };
  }
  const maxResults = Number.isInteger(input.maxResults) && input.maxResults > 0
    ? Math.min(input.maxResults, 20)
    : 10;
  return {
    ok: true,
    request: {
      requestId: input.requestId || makeRequestId(),
      query,
      executor: input.executor || EXECUTOR_AGENT_EXCHANGE,
      maxResults,
      planRef: input.planRef || null, // { projectId, topic } — provenance, not content
      createdAt: new Date().toISOString(),
    },
  };
}

/** Build a SearchRequest query from a Prompt-01 Research Plan + question. */
function searchRequestFromPlan(plan, question, opts = {}) {
  const q = typeof question === "string" && question.trim()
    ? question.trim()
    : (plan && plan.criticalQuestions && plan.criticalQuestions[0]) || "";
  return createSearchRequest({
    query: q,
    executor: opts.executor,
    maxResults: opts.maxResults,
    planRef: plan ? { projectId: plan.projectId, topic: plan.topic } : null,
  });
}

function unavailable(reason) {
  return {
    ok: false,
    code: "SEARCH_PROVIDER_UNAVAILABLE",
    message: reason || "no search executor configured for this run",
  };
}

/**
 * Validate + normalize agent-supplied raw results. Invalid items are rejected
 * individually (reported, not silently dropped en masse). Result text is
 * preserved verbatim as UNTRUSTED DATA — never executed, never filtered as
 * "injection" (filtering evidence would destroy provenance).
 */
function normalizeSearchResults(request, rawResults) {
  if (!request || typeof request.query !== "string" || !request.query.trim()) {
    return { ok: false, code: "INVALID_SEARCH_REQUEST", message: "request carries no query" };
  }
  if (!Array.isArray(rawResults)) {
    return { ok: false, code: "INVALID_SEARCH_RESULTS", message: "raw results must be an array" };
  }
  const results = [];
  const rejected = [];
  rawResults.forEach((raw, index) => {
    const item = raw && typeof raw === "object" ? raw : {};
    if (!isValidHttpUrl(item.url)) {
      rejected.push({ index, code: "UNSAFE_URL", message: "unsupported or missing result URL" });
      return;
    }
    if (typeof item.provider !== "string" || !item.provider.trim()) {
      rejected.push({ index, code: "MISSING_PROVIDER", message: "result provider identity is required" });
      return;
    }
    let retrievedAt = item.retrievedAt;
    if (retrievedAt === undefined || retrievedAt === null) {
      retrievedAt = new Date().toISOString();
    } else if (Number.isNaN(Date.parse(retrievedAt))) {
      rejected.push({ index, code: "INVALID_RETRIEVED_AT", message: "unparseable retrievedAt" });
      return;
    } else {
      retrievedAt = new Date(retrievedAt).toISOString();
    }
    const normalized = {
      query: request.query,
      url: item.url,
      title: typeof item.title === "string" ? item.title : "",
      snippet: typeof item.snippet === "string" ? item.snippet : "",
      provider: item.provider.trim(),
      retrievedAt,
    };
    if (typeof item.rank === "number" && Number.isFinite(item.rank)) {
      normalized.searchRank = item.rank; // discovery order only, never evidence rank
    }
    results.push(normalized);
  });
  return { ok: true, results, rejected };
}

/** Safe acquisition-level dedupe: exact + normalized URL only (no copy-chain logic). */
function normalizeUrlForDedupe(urlString) {
  const u = new URL(urlString);
  u.protocol = u.protocol.toLowerCase();
  u.hostname = u.hostname.toLowerCase();
  u.hash = "";
  if ((u.protocol === "http:" && u.port === "80") || (u.protocol === "https:" && u.port === "443")) {
    u.port = "";
  }
  const params = new URLSearchParams(u.search);
  for (const key of [...params.keys()]) {
    if (/^(utm_|fbclid|gclid|mc_|_hs)/i.test(key)) params.delete(key);
  }
  u.search = params.toString();
  let s = u.toString();
  if (s.endsWith("/") && (u.pathname.length > 1 || !u.search)) s = s.slice(0, -1);
  return s;
}

function dedupeSearchResults(results) {
  const seen = new Map();
  for (const r of results || []) {
    let key;
    try {
      key = normalizeUrlForDedupe(r.url);
    } catch {
      continue;
    }
    if (!seen.has(key)) {
      seen.set(key, r);
    } else {
      const prev = seen.get(key);
      const prevRank = typeof prev.searchRank === "number" ? prev.searchRank : Infinity;
      const curRank = typeof r.searchRank === "number" ? r.searchRank : Infinity;
      if (curRank < prevRank) seen.set(key, r);
    }
  }
  return [...seen.values()];
}

/** STANDARD/DEEP mode routing: DEEP execution is explicitly deferred (Prompt 05). */
function resolveResearchMode(mode) {
  if (mode === "STANDARD") return { ok: true, route: "SEARCH_PROVIDER" };
  if (mode === "DEEP") {
    return { ok: false, code: "DEEP_PROVIDER_NOT_IMPLEMENTED_YET", message: "DEEP escalation belongs to Prompt 05 (GPT Researcher); STANDARD acquisition only" };
  }
  return { ok: false, code: "INVALID_RESEARCH_MODE", message: `unknown research mode: ${String(mode)}` };
}

module.exports = {
  EXECUTOR_AGENT_EXCHANGE,
  createSearchRequest,
  searchRequestFromPlan,
  normalizeSearchResults,
  dedupeSearchResults,
  normalizeUrlForDedupe,
  resolveResearchMode,
  unavailable,
  isValidHttpUrl,
};
