"use strict";

/**
 * UNFOLDIQ bounded deep live smoke (PHASE 1G.1 Prompt 05, §34/62/86-87).
 * Requires explicit opt-in UNFOLDIQ_DEEP_LIVE_TEST_ALLOWED=1 AND credentials.
 * Without opt-in: REFUSE with explicit status, spend nothing.
 * With opt-in: one small benign query (breadth 2 / depth 1 / concurrency<=2),
 * canonical reacquisition of candidates, sufficiency re-evaluation.
 * Usage: npm run research:deep:live-smoke
 */

const bridge = require("../../lib/research-deep/gpt-researcher-bridge.js");
const { LIVE_SMOKE_CONFIG } = require("../../lib/research-deep/escalation-policy.js");
const { isLiveApproved, credentialState } = require("../../lib/research-deep/provider-interface.js");
const acquisition = require("../../lib/research-acquisition/acquisition.js");
const registry = require("../../lib/research-evidence/source-registry.js");
const { candidateSourcesFromResult } = require("../../lib/research-deep/deep-leads.js");

async function main() {
  console.log("=== UNFOLDIQ DEEP LIVE SMOKE (bounded, explicit opt-in only) ===");
  if (!isLiveApproved()) {
    console.log("REFUSED: DEEP_LIVE_NOT_APPROVED — set UNFOLDIQ_DEEP_LIVE_TEST_ALLOWED=1 explicitly to authorize spend. Nothing executed.");
    process.exit(2);
  }
  const cs = credentialState();
  if (!cs.llmConfigured || !cs.searchConfigured) {
    console.log("REFUSED: DEEP_PROVIDER_MISSING_CREDENTIALS — LLM + search keys required. Nothing executed.");
    process.exit(2);
  }
  if (!cs.embeddingConfigured) {
    const emb = cs.embedding || {};
    console.log(`REFUSED: DEEP_PROVIDER_MISSING_CREDENTIALS — EMBEDDING not ready (${emb.error || `keys checked: ${(emb.keyNames || []).join(", ") || "(none)"}`}). ` +
      "The installed gpt-researcher defaults EMBEDDING to openai:text-embedding-3-small; set EMBEDDING=google_genai:gemini-embedding-001 (or matching provider) for a Gemini-only run. Nothing executed.");
    process.exit(2);
  }
  const emb = cs.embedding || {};
  console.log(`embedding selected: ${emb.provider}:${emb.model}${emb.explicit ? " (explicit EMBEDDING)" : " (derived from selected LLM provider)"}`);
  const request = {
    protocolVersion: 1,
    requestId: `live-smoke-${Date.now().toString(36)}`,
    topic: "Python packaging: what is pyproject.toml (public software documentation fact)",
    researchGoal: "Establish what pyproject.toml is per public Python packaging documentation.",
    criticalGaps: ["Which official document defines pyproject.toml and its core purpose?"],
    recommendedQuestions: ["Which official document defines pyproject.toml and its core purpose?"],
    contentClass: "FACTUAL",
    maxBreadth: LIVE_SMOKE_CONFIG.maxBreadth,
    maxDepth: LIVE_SMOKE_CONFIG.maxDepth,
    maxConcurrency: LIVE_SMOKE_CONFIG.maxConcurrency,
    maxQueries: LIVE_SMOKE_CONFIG.maxQueries,
    maxDurationMs: LIVE_SMOKE_CONFIG.maxDurationMs,
    maxCostClass: "SMALL",
    providerId: "gpt-researcher",
  };
  console.log(`bounds: breadth=${request.maxBreadth} depth=${request.maxDepth} concurrency=${request.maxConcurrency} queries<=${request.maxQueries}`);
  const out = await bridge.runDeepResearch(request, { processTimeoutMs: request.maxDurationMs + 60000 });
  if (!out.ok) {
    console.log(`LIVE_SMOKE_PROVIDER_FAILED: ${out.code}: ${out.error}`);
    process.exit(1);
  }
  const candidates = candidateSourcesFromResult(out.result);
  console.log(`provider status=${out.result.status} providerVersion=${out.result.providerVersion || "unknown"}`);
  console.log(`queries observed: ${(out.result.queries || []).length}; candidate URLs: ${candidates.length}`);
  // Canonical reintegration proof: reacquire first candidate via Prompt 02.
  let reacquired = 0;
  const index = registry.emptyIndex("live-smoke");
  for (const c of candidates.slice(0, 2)) {
    const acq = await acquisition.acquireUrl(c.url, { maxRetries: 0 });
    if (acq.ok) {
      const reg = registry.registerSource(index, { acquiredDocument: acq.document, search: { query: request.topic, provider: "deep-live-smoke" } });
      if (reg.ok) reacquired++;
      console.log(`reacquired: ${c.url} -> ${reg.ok ? reg.record.sourceId : reg.code}`);
    } else {
      console.log(`acquire skipped/failed (expected for some hosts): ${c.url} -> ${acq.code}`);
    }
  }
  console.log(`LIVE_SMOKE_DONE: candidates=${candidates.length} reacquired=${reacquired} registrySources=${index.sources.length}`);
}

main().catch((e) => { console.error(`LIVE_SMOKE_ERROR: ${e.message}`); process.exit(1); });
