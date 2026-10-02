"use strict";

/**
 * UNFOLDIQ Deep Escalation Policy (PHASE 1G.1 Prompt 05, item 1G.1Q).
 *
 * STANDARD is the default. DEEP (GPT Researcher) runs only on explicit
 * eligibility: NEEDS_MORE_RESEARCH + allowed + material solvable gap +
 * budget + provider. Pure FICTION/NOT_REQUIRED and SUFFICIENT never
 * auto-escalate. BLOCKED stays BLOCKED unless the blocker is provably a
 * lack of discoverable public evidence.
 *
 * Deterministic, no network, no LLM. Bounds enforced here, not in callers.
 */

const ACTIONS = ["STAY_STANDARD", "ESCALATE_DEEP", "REVIEW_REQUIRED", "BLOCKED"];

const REASON_CODES = [
  "CRITICAL_QUESTIONS_UNANSWERED",
  "HIGH_IMPACT_CLAIM_WEAK",
  "CREDIBLE_CONTRADICTIONS_REMAIN",
  "MULTI_DOMAIN_TOPIC_UNDERCOVERED",
  "PRIMARY_SOURCE_DISCOVERY_INCOMPLETE",
  "STANDARD_SEARCH_EXHAUSTED",
  "COMPLEX_HISTORICAL_CHAIN",
  "COMPLEX_SCIENTIFIC_TOPIC",
  "STANDARD_SUFFICIENT",
  "DEEP_NOT_ALLOWED",
  "FICTION_NO_RESEARCH",
  "BLOCKED_ACCESS_POLICY",
  "BUDGET_EXHAUSTED",
  "PROVIDER_UNAVAILABLE",
  "MAX_ESCALATIONS_REACHED",
  "EXPLICIT_DEEP_REQUEST",
  "NO_MATERIAL_GAP",
  "GAP_NOT_RESEARCH_SOLVABLE",
  "STANDARD_NOT_YET_ATTEMPTED",
];

// Production defaults are deliberately conservative (§32-33).
const DEFAULT_DEEP_CONFIG = {
  maxDeepEscalations: 1,
  maxBreadth: 2,
  maxDepth: 2,
  maxConcurrency: 2,
  maxQueries: 10,
  maxDurationMs: 5 * 60 * 1000,
  maxCostClass: "SMALL",
  providerId: "gpt-researcher",
};

// Small live-smoke bounds (§34): never full-depth to prove integration.
const LIVE_SMOKE_CONFIG = {
  maxBreadth: 2,
  maxDepth: 1,
  maxConcurrency: 2,
  maxQueries: 4,
  maxDurationMs: 5 * 60 * 1000,
  maxCostClass: "SMALL",
  providerId: "gpt-researcher",
};

const BLOCKED_NO_DEEP = [
  "AUTH_REQUIRED",
  "HUMAN_ACTION_REQUIRED",
  "AUTH_STATE_IN_REPO",
  "POLICY_BLOCKED",
  "PRIVATE_SOURCE",
  "BUDGET_EXHAUSTED",
  "USER_PROHIBITED",
  "PAYWALL_NO_ACCESS",
];

function clampConfig(input = {}) {
  const d = { ...DEFAULT_DEEP_CONFIG, ...input };
  d.maxDeepEscalations = Math.max(0, Math.min(d.maxDeepEscalations | 0, 3));
  d.maxBreadth = Math.max(1, Math.min(d.maxBreadth | 0, 4));
  d.maxDepth = Math.max(1, Math.min(d.maxDepth | 0, 2));
  d.maxConcurrency = Math.max(1, Math.min(d.maxConcurrency | 0, 2));
  d.maxQueries = Math.max(1, Math.min(d.maxQueries | 0, 20));
  d.maxDurationMs = Math.max(30 * 1000, Math.min(d.maxDurationMs | 0, 15 * 60 * 1000));
  return d;
}

/**
 * Decide escalation. Input:
 * { contentClass, researchRequired, sufficiencyDecision, standardAttempted,
 *   materialGap, gapSolvable, deepAllowed, budgetRemaining, escalationsUsed,
 *   maxDeepEscalations, providerAvailable, blockedCode, blockerIsDiscoverableGap,
 *   explicitDeepRequest, targetedFactualSubset, reasonCodes[] }
 */
function decideEscalation(input = {}) {
  const o = input || {};
  const maxEsc = Number.isInteger(o.maxDeepEscalations) ? o.maxDeepEscalations : DEFAULT_DEEP_CONFIG.maxDeepEscalations;
  const used = o.escalationsUsed | 0;
  const reasons = Array.isArray(o.reasonCodes) ? o.reasonCodes.filter((r) => REASON_CODES.includes(r)) : [];
  const base = { eligible: false, config: clampConfig(o.deepConfig), escalationsUsed: used, maxDeepEscalations: maxEsc };

  // Pure FICTION with no research need never escalates (§51). Targeted
  // fiction factual subsets may escalate only for that subset.
  if (o.contentClass === "FICTION" && o.researchRequired === "NOT_REQUIRED" && !o.targetedFactualSubset) {
    return { ...base, action: "STAY_STANDARD", reasonCodes: ["FICTION_NO_RESEARCH"], gapRefs: [], note: "FICTION + NOT_REQUIRED never auto-DEEP." };
  }

  // SUFFICIENT never auto-DEEP (§52). Explicit requests still face gates.
  if (o.sufficiencyDecision === "SUFFICIENT" && !o.explicitDeepRequest) {
    return { ...base, action: "STAY_STANDARD", reasonCodes: ["STANDARD_SUFFICIENT"], gapRefs: [] };
  }

  // BLOCKED stays BLOCKED by default (§7).
  if (o.sufficiencyDecision === "BLOCKED" || o.blockedCode) {
    const discoverable = o.blockerIsDiscoverableGap === true;
    const codeBlocked = o.blockedCode ? BLOCKED_NO_DEEP.includes(o.blockedCode) : true;
    if (!discoverable || codeBlocked) {
      return { ...base, action: "BLOCKED", reasonCodes: ["BLOCKED_ACCESS_POLICY"], gapRefs: [], blocker: o.blockedCode || "BLOCKED" };
    }
    // Discoverable-gap BLOCKED continues through the normal gates below.
  }

  if (o.deepAllowed !== true) {
    return { ...base, action: "STAY_STANDARD", reasonCodes: ["DEEP_NOT_ALLOWED"], gapRefs: [] };
  }
  if (o.budgetRemaining === false) {
    return { ...base, action: "STAY_STANDARD", reasonCodes: ["BUDGET_EXHAUSTED"], gapRefs: [] };
  }
  if (used >= maxEsc) {
    return { ...base, action: "STAY_STANDARD", reasonCodes: ["MAX_ESCALATIONS_REACHED"], gapRefs: [] };
  }
  if (o.providerAvailable === false) {
    return { ...base, action: "STAY_STANDARD", reasonCodes: ["PROVIDER_UNAVAILABLE"], gapRefs: [], providerUnavailable: true };
  }
  if (!o.standardAttempted && !o.explicitDeepRequest) {
    return { ...base, action: "STAY_STANDARD", reasonCodes: ["STANDARD_NOT_YET_ATTEMPTED"], gapRefs: [] };
  }
  if (!o.materialGap && !o.explicitDeepRequest) {
    return { ...base, action: "STAY_STANDARD", reasonCodes: ["NO_MATERIAL_GAP"], gapRefs: [] };
  }
  if (o.gapSolvable === false) {
    return { ...base, action: "REVIEW_REQUIRED", reasonCodes: ["GAP_NOT_RESEARCH_SOLVABLE"], gapRefs: o.gapRefs || [] };
  }

  const outReasons = reasons.length > 0 ? reasons : ["STANDARD_SEARCH_EXHAUSTED"];
  if (o.explicitDeepRequest) outReasons.unshift("EXPLICIT_DEEP_REQUEST");
  return {
    ...base,
    eligible: true,
    action: "ESCALATE_DEEP",
    reasonCodes: outReasons,
    gapRefs: o.gapRefs || [],
    recommendedQuestions: Array.isArray(o.recommendedQuestions) ? o.recommendedQuestions.slice(0, 10) : [],
  };
}

/**
 * Build the bounded DEEP request from Prompt-03 targeted gaps (§45).
 * Sends goal + gaps + scope only — never full source bodies (§91).
 */
function buildDeepRequest(plan = {}, gaps = {}, decision = {}, opts = {}) {
  const cfg = clampConfig({ ...DEFAULT_DEEP_CONFIG, ...(decision.config || {}), ...(opts.deepConfig || {}) });
  return {
    protocolVersion: 1,
    requestId: opts.requestId || null,
    researchPlanId: plan.projectId || plan.researchPlanId || null,
    researchPlanHash: opts.researchPlanHash || null,
    topic: plan.topic || opts.topic || "",
    researchGoal: plan.researchGoal || "",
    criticalGaps: (gaps.missingQuestions || []).slice(0, 10),
    recommendedQuestions: (decision.recommendedQuestions || gaps.recommendedQueries || []).slice(0, 10),
    missingEvidence: gaps.missingEvidence || [],
    weakClaims: gaps.weakClaims || [],
    unresolvedContradictions: gaps.unresolvedContradictions || [],
    contentClass: plan.contentClass || null,
    contentMode: plan.contentMode || null,
    timeScope: plan.timeScope || null,
    geographicScope: plan.geographicScope || null,
    freshnessRequirement: plan.freshnessRequirement || null,
    maxBreadth: cfg.maxBreadth,
    maxDepth: cfg.maxDepth,
    maxConcurrency: cfg.maxConcurrency,
    maxDurationMs: cfg.maxDurationMs,
    maxQueries: cfg.maxQueries,
    maxCostClass: cfg.maxCostClass,
    providerId: cfg.providerId,
    sourcePriority: Array.isArray(plan.sourcePriority) ? plan.sourcePriority : [],
    excludedDomains: Array.isArray(opts.excludedDomains) ? opts.excludedDomains : [],
    requiredDomains: Array.isArray(opts.requiredDomains) ? opts.requiredDomains : [],
    progressEnabled: true,
  };
}

module.exports = {
  ACTIONS,
  REASON_CODES,
  DEFAULT_DEEP_CONFIG,
  LIVE_SMOKE_CONFIG,
  BLOCKED_NO_DEEP,
  clampConfig,
  decideEscalation,
  buildDeepRequest,
};
