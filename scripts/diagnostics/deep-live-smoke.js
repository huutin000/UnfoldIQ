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
const independence = require("../../lib/research-evidence/independence.js");
const ledgerLib = require("../../lib/research-evidence/claim-ledger.js");
const verification = require("../../lib/research-evidence/verification.js");
const sufficiency = require("../../lib/research-evidence/sufficiency.js");
const { candidateSourcesFromResult } = require("../../lib/research-deep/deep-leads.js");
const { loadRootEnv } = require("../../lib/env-bootstrap.js");

async function main() {
  console.log("=== UNFOLDIQ DEEP LIVE SMOKE (bounded, explicit opt-in only) ===");
  loadRootEnv();
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
    // Acceptance only (Fix 6 §9): report prose is not needed for candidate
    // discovery + canonical reintegration; production DEEP still writes it.
    skipReport: true,
  };
  console.log(`bounds: breadth=${request.maxBreadth} depth=${request.maxDepth} concurrency=${request.maxConcurrency} queries<=${request.maxQueries}`);
  // Wall clock only: retries on a saturated provider (e.g. Gemini 503 with
  // built-in 10-attempt backoff) are waited out; spend bounds are unchanged.
  const out = await bridge.runDeepResearch(request, { processTimeoutMs: request.maxDurationMs + 5 * 60 * 1000 });
  if (!out.ok) {
    console.log(`LIVE_SMOKE_PROVIDER_FAILED: ${out.code}: ${out.error}`);
    process.exit(1);
  }
  const candidates = candidateSourcesFromResult(out.result);
  console.log(`provider status=${out.result.status} providerVersion=${out.result.providerVersion || "unknown"}`);
  console.log(`queries observed: ${(out.result.queries || []).length}; candidate URLs: ${candidates.length}`);
  // Canonical reintegration proof (full chain): reacquire candidates via
  // Prompt-02 (URL safety -> acquisition -> AcquiredDocument), register into
  // Prompt-03 Source Registry, evaluate Independence, anchor ONE canonical
  // claim (verbatim excerpt from the ACQUIRED document — never provider text),
  // verify the ledger, then re-run Sufficiency honestly.
  let reacquired = 0;
  const index = registry.emptyIndex("live-smoke");
  const bodies = {};
  const reacquiredRecords = [];
  for (const c of candidates.slice(0, 2)) {
    const acq = await acquisition.acquireUrl(c.url, { maxRetries: 0 });
    if (acq.ok) {
      const reg = registry.registerSource(index, { acquiredDocument: acq.document, search: { query: request.topic, provider: "deep-live-smoke" } });
      if (reg.ok) {
        reacquired++;
        reacquiredRecords.push(reg.record);
        const body = String(acq.document.fitMarkdown || acq.document.rawMarkdown || "");
        if (body.trim()) bodies[reg.record.sourceId] = body;
      }
      console.log(`reacquired: ${c.url} -> ${reg.ok ? reg.record.sourceId : reg.code}`);
    } else {
      console.log(`acquire skipped/failed (expected for some hosts): ${c.url} -> ${acq.code}`);
    }
  }

  let claimStatus = "NOT_EVALUATED";
  let independentGroups = null;
  let sufficiencyAfter = null;
  if (reacquiredRecords.length > 0) {
    independence.evaluateIndependence(index.sources, bodies);
    independentGroups = independence.countIndependentGroups(index.sources, index.sources.map((r) => r.sourceId));
    const led = ledOf(index, reacquiredRecords, bodies);
    const claim = (led.claims || [])[0];
    claimStatus = claim ? claim.evidenceStatus : "NO_CANONICAL_ANCHOR";
    if (claim) console.log(`canonical claim anchored: sourceId=${claim.supportingEvidence[0].sourceId} evidenceStatus=${claimStatus}`);
    sufficiencyAfter = sufficiency.evaluateSufficiency({
      plan: {
        projectId: "live-smoke",
        topic: request.topic,
        researchGoal: request.researchGoal,
        contentClass: "FACTUAL",
        criticalQuestions: [request.criticalGaps[0]],
        researchBudget: "maxQueries:4; maxSources:10; maxDeepResearchEscalations:1; maxTimeMin:15",
        freshnessRequirement: "EVERGREEN_OK",
      },
      ledger: led,
      records: index.sources,
      store: { contradictions: [], unknowns: [] },
      budgetSpent: { sources: index.sources.length, queries: (out.result.queries || []).length },
    });
    console.log(`sufficiency re-evaluated: ${sufficiencyAfter.decision} (reasons: ${(sufficiencyAfter.reasonCodes || []).join(", ") || "(none)"})`);
    if (sufficiencyAfter.decision === "SUFFICIENT") {
      console.log("NOTE: SUFFICIENT live state — Prompt-04 must consume the unchanged canonical Research Pack contract (no DeepResearchPack exists).");
    }
  }
  console.log(`LIVE_SMOKE_DONE: candidates=${candidates.length} reacquired=${reacquired} registrySources=${index.sources.length} independentGroups=${independentGroups} claimStatus=${claimStatus} sufficiency=${sufficiencyAfter ? sufficiencyAfter.decision : "NOT_EVALUATED"}`);
}

// Rebuild the canonical ledger for sufficiency from the reacquired records
// (one verbatim-anchored claim per usable body; provider learnings excluded).
function ledOf(index, records, bodies) {
  const led = ledgerLib.emptyLedger();
  let q = 0;
  for (const r of records) {
    const body = bodies[r.sourceId];
    if (!body || String(body).trim().length < 80) continue;
    const excerpt = body.replace(/\s+/g, " ").trim().slice(0, 220);
    ledgerLib.upsertClaim(led, {
      claim: excerpt,
      claimClass: "SUPPORTED_FACT",
      evidenceStatus: "SUPPORTED",
      materiality: "important",
      researchQuestionIds: [`q${Math.min(q, 0)}`],
      evidence: [{ sourceId: r.sourceId, contentHash: r.currentVersionHash, excerpt }],
    }, index);
    q++;
  }
  verification.verifyLedger(led, index.sources);
  return led;
}

main().catch((e) => { console.error(`LIVE_SMOKE_ERROR: ${e.message}`); process.exit(1); });
