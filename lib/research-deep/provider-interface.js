"use strict";

/**
 * UNFOLDIQ DeepResearchProvider interface (PHASE 1G.1 Prompt 05).
 *
 * Canonical ownership: orchestration -> DeepResearchProvider interface ->
 * GPTResearcherProvider adapter. Core never imports gpt_researcher directly.
 * Provider output is UNTRUSTED lead discovery, never truth (§22).
 *
 * DeepResearchProvider.run(request) -> DeepResearchResult (normalized below).
 */

const crypto = require("crypto");

const PROVIDER_PROTOCOL_VERSION = 1;
const PROVIDER_ID = "gpt-researcher";

// §96 — reuse style, deep-scoped names.
const DEEP_ERROR_CODES = [
  "DEEP_NOT_ELIGIBLE",
  "DEEP_PROVIDER_NOT_INSTALLED",
  "DEEP_PROVIDER_UNAVAILABLE",
  "DEEP_PROVIDER_MISSING_CREDENTIALS",
  "DEEP_LIVE_NOT_APPROVED",
  "DEEP_PROVIDER_ERROR",
  "DEEP_TIMEOUT",
  "DEEP_CANCELLED",
  "DEEP_RATE_LIMITED",
  "DEEP_BUDGET_EXHAUSTED",
  "DEEP_PARTIAL",
  "DEEP_NO_NEW_SOURCES",
  "DEEP_SCOPE_DRIFT",
  "BRIDGE_PROTOCOL_ERROR",
  "WORKER_SPAWN_FAILED",
  "WORKER_TIMEOUT",
  "WORKER_CANCELLED",
  "WORKER_FAILED",
];

const LIVE_TEST_ENV = "UNFOLDIQ_DEEP_LIVE_TEST_ALLOWED";
// Legacy fallback key names (used only when no explicit provider selected).
const LLM_KEY_NAMES = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "OPENAI_BASE_URL"];
const SEARCH_KEY_NAMES = ["TAVILY_API_KEY", "SERPER_API_KEY", "SEARCHAPI_API_KEY"];
const SECRET_KEY_RE = /api[_-]?key|secret|token|cookie|auth|password|bearer|session/i;

// §6A — provider-aware readiness: detect from the ACTUAL selected LLM /
// retriever, not from a fixed credential list. Official gpt-researcher config:
// FAST_LLM/SMART_LLM/STRATEGIC_LLM = "<provider>:<model>", RETRIEVER = "<name>".
// google_genai runtime uses GOOGLE_API_KEY (GEMINI_API_KEY accepted as compat).
const LLM_KEY_MAP = {
  openai: ["OPENAI_API_KEY"],
  azure_openai: ["AZURE_OPENAI_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY"],
  google_genai: ["GOOGLE_API_KEY", "GEMINI_API_KEY"],
  google_vertexai: ["GOOGLE_API_KEY"],
  groq: ["GROQ_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  deepseek: ["DEEPSEEK_API_KEY"],
  mistralai: ["MISTRAL_API_KEY"],
  together: ["TOGETHER_API_KEY"],
  fireworks: ["FIREWORKS_API_KEY"],
  cohere: ["COHERE_API_KEY"],
  xai: ["XAI_API_KEY"],
  dashscope: ["DASHSCOPE_API_KEY"],
  ollama: [], // local runtime, no key
  vllm_openai: [], // endpoint-based, no key
};
const RETRIEVER_KEY_MAP = {
  tavily: ["TAVILY_API_KEY"],
  serper: ["SERPER_API_KEY"],
  searchapi: ["SEARCHAPI_API_KEY"],
  serpapi: ["SERPAPI_API_KEY"],
  exa: ["EXA_API_KEY"],
  bing: ["BING_API_KEY"],
  google: ["GOOGLE_API_KEY", "GOOGLE_CSE_ID"],
  brave: ["BRAVE_API_KEY"],
  bocha: ["BOCHA_API_KEY"],
  searx: ["SEARX_URL"],
};
// No-key retrievers in pinned gpt-researcher 0.15.1 (no API key by design).
const NO_KEY_RETRIEVERS = new Set(["duckduckgo", "arxiv", "semantic_scholar", "pubmed_central"]);

// Fix 2 — embedding readiness, mirroring research/deep-worker.py. The installed
// library defaults EMBEDDING to "openai:text-embedding-3-small", which silently
// demands OpenAI credentials on a Gemini-only run. Explicit EMBEDDING wins;
// otherwise the selected LLM provider is reused (never an implicit OpenAI swap).
const EMBEDDING_DEFAULT_MODELS = {
  google_genai: "gemini-embedding-001",
  openai: "text-embedding-3-small",
};
const EMBEDDING_KEY_MAP = {
  ...LLM_KEY_MAP,
  voyageai: ["VOYAGE_API_KEY"],
  aimlapi: ["AIMLAPI_API_KEY"],
  minimax: ["MINIMAX_API_KEY"],
  custom: ["OPENAI_API_KEY"],
  netmind: ["NETMIND_API_KEY"],
  gigachat: ["GIGACHAT_CREDENTIALS"],
  bedrock: [], // AWS credential chain, no single key env
  huggingface: [], // local model, no key
  nomic: [], // local model, no key
};
const EMBEDDING_NO_KEY_PROVIDERS = new Set(["huggingface", "nomic"]);

function selectedEmbedding(env = process.env) {
  const raw = env.EMBEDDING;
  if (typeof raw === "string" && raw.trim()) {
    if (!raw.includes(":")) {
      return { provider: null, model: null, explicit: true, error: "EMBEDDING must be '<provider>:<model>' (e.g. google_genai:gemini-embedding-001)" };
    }
    const [p, ...rest] = raw.split(":");
    return {
      provider: p.trim().toLowerCase().replace(/-/g, "_"),
      model: rest.join(":").trim(),
      explicit: true,
      error: null,
    };
  }
  const llm = selectedLLMProvider(env);
  const provider = llm.name && EMBEDDING_DEFAULT_MODELS[llm.name] ? llm.name : "openai";
  if (!EMBEDDING_DEFAULT_MODELS[provider]) {
    return { provider, model: null, explicit: false, error: `no default embedding model known for provider ${provider}; set EMBEDDING explicitly` };
  }
  return { provider, model: EMBEDDING_DEFAULT_MODELS[provider], explicit: false, error: null };
}

function selectedLLMProvider(env = process.env) {
  for (const n of ["FAST_LLM", "SMART_LLM", "STRATEGIC_LLM"]) {
    const v = env[n];
    if (typeof v === "string" && v.trim()) {
      const name = v.split(":")[0].trim().toLowerCase().replace(/-/g, "_");
      if (name) return { name, via: n };
    }
  }
  return { name: null, via: null };
}

function selectedRetriever(env = process.env) {
  const v = env.RETRIEVER;
  if (typeof v === "string" && v.trim()) {
    return v.trim().toLowerCase().replace(/-/g, "_");
  }
  return null;
}

function hasValue(env, name, minLen) {
  return typeof env[name] === "string" && env[name].length >= minLen;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256Hex(text) {
  return crypto.createHash("sha256").update(String(text), "utf8").digest("hex");
}

/** Strip secret values; keep only presence booleans. Never log raw keys. */
function redactSecrets(obj) {
  if (Array.isArray(obj)) return obj.map(redactSecrets);
  if (obj && typeof obj === "object") {
    const out = {};
    for (const k of Object.keys(obj)) {
      if (SECRET_KEY_RE.test(k)) {
        out[k] = obj[k] ? "<REDACTED_PRESENT>" : "<ABSENT>";
      } else {
        out[k] = redactSecrets(obj[k]);
      }
    }
    return out;
  }
  return obj;
}

function isLiveApproved(env = process.env) {
  return String(env[LIVE_TEST_ENV] || "") === "1";
}

/** Names-only credential check. Presence of a key is NOT spend consent. */
function credentialState(env = process.env) {
  const llm = selectedLLMProvider(env);
  const retriever = selectedRetriever(env);
  let llmKeyNames;
  let llmConfigured;
  if (!llm.name) {
    llmKeyNames = LLM_KEY_NAMES;
    llmConfigured = LLM_KEY_NAMES.some((n) => hasValue(env, n, n === "OPENAI_BASE_URL" ? 4 : 8));
  } else if (LLM_KEY_MAP[llm.name] && LLM_KEY_MAP[llm.name].length === 0) {
    llmKeyNames = []; // local/endpoint provider: no key required by design
    llmConfigured = true;
  } else {
    llmKeyNames = LLM_KEY_MAP[llm.name] || LLM_KEY_NAMES;
    llmConfigured = llmKeyNames.some((n) => hasValue(env, n, 8));
  }
  let searchKeyNames;
  let searchConfigured;
  if (!retriever) {
    searchKeyNames = SEARCH_KEY_NAMES;
    searchConfigured = SEARCH_KEY_NAMES.some((n) => hasValue(env, n, 4));
  } else if (NO_KEY_RETRIEVERS.has(retriever)) {
    searchKeyNames = []; // no-key retriever: no key required by design
    searchConfigured = true;
  } else {
    searchKeyNames = RETRIEVER_KEY_MAP[retriever] || SEARCH_KEY_NAMES;
    searchConfigured = searchKeyNames.some((n) => hasValue(env, n, 4));
  }
  const emb = selectedEmbedding(env);
  let embeddingKeyNames = [];
  let embeddingConfigured = false;
  if (emb.provider && !emb.error) {
    embeddingKeyNames = EMBEDDING_KEY_MAP[emb.provider] || [];
    embeddingConfigured =
      EMBEDDING_NO_KEY_PROVIDERS.has(emb.provider) || embeddingKeyNames.length === 0
        ? true // local / credential-chain provider: no single key env
        : embeddingKeyNames.some((n) => hasValue(env, n, 8));
  }
  return {
    llmConfigured,
    searchConfigured,
    embeddingConfigured,
    liveApproved: isLiveApproved(env),
    llmKeyNames,
    searchKeyNames,
    llmSelected: llm.name,
    llmSelectedVia: llm.via,
    retriever,
    embedding: {
      provider: emb.provider,
      model: emb.model,
      explicit: emb.explicit,
      configured: embeddingConfigured,
      keyNames: embeddingKeyNames,
      error: emb.error,
    },
  };
}

/**
 * Schema-validate a live probe result (E7). Embedding probes must carry a
 * numeric non-zero dimension and a non-OpenAI adapter class; llm probes a
 * bounded response; retriever probes real URLs. Never accepts a vector body.
 */
function validateProbeResult(probe = {}) {
  const errors = [];
  if (!probe || typeof probe !== "object") return ["probe result must be an object"];
  if (probe.kind === "embedding") {
    if (!probe.provider) errors.push("provider required");
    if (!probe.model) errors.push("model required");
    if (!Number.isInteger(probe.dimension) || probe.dimension <= 0) errors.push("dimension must be a positive int");
    if (probe.numeric !== true) errors.push("vector sample must be numeric");
    if (typeof probe.className === "string" && /openai/i.test(probe.className)) {
      errors.push(`unexpected OpenAI embedding adapter: ${probe.className}`);
    }
  } else if (probe.kind === "llm") {
    if (!probe.provider) errors.push("provider required");
    if (!probe.model) errors.push("model required");
    if (typeof probe.responseHead !== "string" || !probe.responseHead.trim()) errors.push("responseHead required");
    if (probe.responseHead && probe.responseHead.length > 200) errors.push("responseHead must stay bounded (<=200 chars)");
  } else if (probe.kind === "retriever") {
    if (!probe.provider) errors.push("provider required");
    if (!Number.isInteger(probe.resultCount) || probe.resultCount <= 0) errors.push("resultCount must be a positive int");
    if (!Array.isArray(probe.urls) || !probe.urls.some((u) => /^https?:\/\//i.test(u || ""))) {
      errors.push("at least one http(s) result URL required");
    }
  } else {
    errors.push(`unknown probe kind: ${probe.kind}`);
  }
  return errors;
}

function validateDeepRequest(req) {  const errors = [];
  if (!req || typeof req !== "object") return ["request must be an object"];
  if (req.protocolVersion !== PROVIDER_PROTOCOL_VERSION) errors.push("bad protocolVersion (expected 1)");
  if (typeof req.topic !== "string" || !req.topic.trim()) errors.push("topic required");
  if (typeof req.researchGoal !== "string" || !req.researchGoal.trim()) errors.push("researchGoal required");
  if (!Array.isArray(req.recommendedQuestions) && !Array.isArray(req.criticalGaps)) {
    errors.push("recommendedQuestions or criticalGaps required (gap-mapped request, §45)");
  }
  for (const k of ["maxBreadth", "maxDepth", "maxConcurrency", "maxQueries", "maxDurationMs"]) {
    if (req[k] !== undefined && (!Number.isInteger(req[k]) || req[k] <= 0)) errors.push(`${k} must be a positive int`);
  }
  return errors;
}

function asUrlList(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((u) => typeof u === "string" && /^https?:\/\//i.test(u)).slice(0, 200);
}

/**
 * Normalize raw adapter output. Learnings/report stay leads: this function
 * never assigns claim classes, evidence statuses, or corroboration.
 */
function normalizeDeepResult(raw = {}, request = {}) {
  const now = new Date().toISOString();
  return {
    requestId: raw.requestId || request.requestId || null,
    providerId: PROVIDER_ID,
    providerVersion: typeof raw.providerVersion === "string" ? raw.providerVersion : null,
    startedAt: raw.startedAt || null,
    completedAt: raw.completedAt || now,
    status: typeof raw.status === "string" ? raw.status : "UNKNOWN",
    visitedUrls: asUrlList(raw.visitedUrls || raw.sourceUrls),
    candidateSources: Array.isArray(raw.candidateSources)
      ? raw.candidateSources
          .filter((c) => c && typeof c.url === "string" && /^https?:\/\//i.test(c.url))
          .slice(0, 100)
          .map((c) => ({
            url: c.url,
            title: typeof c.title === "string" ? c.title.slice(0, 500) : null,
            context: typeof c.context === "string" ? c.context.slice(0, 1000) : null,
          }))
      : [],
    queries: Array.isArray(raw.queries) ? raw.queries.filter((q) => typeof q === "string").slice(0, 50) : [],
    followUpQuestions: Array.isArray(raw.followUpQuestions)
      ? raw.followUpQuestions.filter((q) => typeof q === "string").slice(0, 20)
      : [],
    learnings: Array.isArray(raw.learnings)
      ? raw.learnings.slice(0, 50).map((l) => ({
          text: String(l.text || l || "").slice(0, 2000),
          sourceUrls: asUrlList(l.sourceUrls || l.urls),
        }))
      : [],
    providerCitations: Array.isArray(raw.providerCitations)
      ? raw.providerCitations.filter((c) => typeof c === "string").slice(0, 100)
      : [],
    progressSummary: raw.progressSummary && typeof raw.progressSummary === "object" ? raw.progressSummary : null,
    warnings: Array.isArray(raw.warnings) ? raw.warnings.map(String).slice(0, 20) : [],
    errors: Array.isArray(raw.errors) ? raw.errors.map(String).slice(0, 20) : [],
    cost: raw.cost && typeof raw.cost === "object" ? { known: raw.cost.known ?? null, limit: raw.cost.limit ?? null } : { known: null, limit: null },
    providerReportRef: typeof raw.providerReportRef === "string" ? raw.providerReportRef : null,
  };
}

module.exports = {
  PROVIDER_PROTOCOL_VERSION,
  PROVIDER_ID,
  DEEP_ERROR_CODES,
  LIVE_TEST_ENV,
  LLM_KEY_MAP,
  RETRIEVER_KEY_MAP,
  NO_KEY_RETRIEVERS,
  EMBEDDING_DEFAULT_MODELS,
  EMBEDDING_KEY_MAP,
  EMBEDDING_NO_KEY_PROVIDERS,
  selectedLLMProvider,
  selectedRetriever,
  selectedEmbedding,
  stableStringify,
  sha256Hex,
  redactSecrets,
  isLiveApproved,
  credentialState,
  validateDeepRequest,
  validateProbeResult,
  normalizeDeepResult,
};
