"use strict";

/**
 * UNFOLDIQ — ROADMAP V5 PRE-FLIGHT semantic contract checks.
 * Contract only (no runtime, no network, no Crawl4AI/GPT-Researcher).
 * Pure deterministic functions; tested by tests/pipeline/test-v5-preflight.js.
 */

function decideResearchRequired(contentClass, opts = {}) {
  if (contentClass === "FACTUAL") return "REQUIRED";
  if (contentClass === "HYBRID") return "REQUIRED";
  if (contentClass === "FICTION") {
    return opts.factualAccuracyRequested ? "OPTIONAL_TARGETED" : "NOT_REQUIRED";
  }
  return "REVIEW_REQUIRED";
}

// S1 — FACTUAL requires research readiness
function checkFactualScriptReady({ contentClass, claims = [], researchSufficiency = null }) {
  if (contentClass !== "FACTUAL") return { valid: true, code: "NOT_APPLICABLE" };
  const bad = claims.filter(
    (c) => (c.evidenceStatus === "UNSUPPORTED" || c.claimClass === "UNVERIFIED") &&
      (c.scriptUse === "CAN_STATE" || c.important === true)
  );
  if (bad.length > 0 || researchSufficiency === "NEEDS_MORE_RESEARCH" || researchSufficiency === "BLOCKED") {
    return { valid: false, code: "NOT_SCRIPT_READY", claimIds: bad.map((c) => c.claimId) };
  }
  return { valid: true, code: "SCRIPT_READY" };
}

// S2/S3 — fiction paths
function checkFictionNoForcedResearch({ contentClass, hasResearchPack = false, realFactualClaims = [] }) {
  if (contentClass !== "FICTION") return { valid: true, code: "NOT_APPLICABLE" };
  if (!hasResearchPack && realFactualClaims.length === 0) return { valid: true, code: "FICTION_VALID_NO_PACK" };
  if (realFactualClaims.length > 0) {
    const unverified = realFactualClaims.filter((c) => c.evidenceStatus === "UNSUPPORTED" || c.claimClass === "UNVERIFIED");
    if (unverified.length > 0) return { valid: false, code: "FICTION_FACTUAL_SUBSET_REQUIRES_EVIDENCE" };
    return { valid: true, code: "FICTION_TARGETED_SUBSET_OK" };
  }
  return { valid: true, code: "FICTION_VALID" };
}

// S4 — hybrid labeling
function checkHybridLabel({ fromLabel, toLabel }) {
  const promotions = [["FOLKLORE", "FACT"], ["TESTIMONY", "FACT"], ["SPECULATION", "FACT"]];
  if (promotions.some(([a, b]) => a === fromLabel && b === toLabel)) {
    return { valid: false, code: "HYBRID_LABEL_PROMOTION_REJECTED" };
  }
  return { valid: true, code: "HYBRID_LABEL_OK" };
}

// S5/S6 — source independence
function checkMultiSourceConfirmed(sources = []) {
  const groups = new Set(sources.map((s) => s.originGroup || s.url || s.sourceId));
  if (sources.length >= 2 && groups.size <= 1) {
    return { valid: false, code: "NOT_MULTI_SOURCE_CONFIRMED", reason: "single origin chain" };
  }
  const independent = sources.filter((s) => s.independenceStatus === "INDEPENDENT");
  const hasPrimary = sources.some((s) => s.authorityType === "PRIMARY" || s.sourceType === "primary_evidence");
  if (sources.length >= 2 && groups.size >= 2 && (hasPrimary || independent.length >= 2)) {
    return { valid: true, code: "MULTI_SOURCE_CONFIRMED_ELIGIBLE" };
  }
  if (sources.length >= 2 && groups.size >= 2) {
    return { valid: true, code: "MULTI_SOURCE_PLAUSIBLE" };
  }
  return { valid: false, code: "INSUFFICIENT_SOURCES" };
}

// S7 — contradiction vs certainty
function checkConflictCertainty({ corroborationStatus, scriptStatesCertainty }) {
  if (corroborationStatus === "CONFLICTED" && scriptStatesCertainty === true) {
    return { valid: false, code: "CONFLICTED_CANNOT_STATE_CERTAINTY" };
  }
  return { valid: true, code: "CONFLICT_CHECK_OK" };
}

// S8/S9/S10 — sufficiency
function checkSufficiency(evalObj = {}) {
  const {
    criticalQuestionsAnswered = false,
    importantClaimsSupported = false,
    criticalContradictionsResolvedOrFramed = true,
    remainingUnknownsMaterial = false,
    freshnessAdequate = true,
    stopCriteriaReached = false,
    furtherResearchLikely = false,
    budgetRemaining = true,
    criticalBlocker = null,
  } = evalObj;
  if (criticalBlocker) {
    return { valid: true, decision: "BLOCKED", code: "SUFFICIENCY_BLOCKED", blocker: criticalBlocker };
  }
  if (!criticalQuestionsAnswered || !importantClaimsSupported) {
    const gaps = {};
    if (!criticalQuestionsAnswered) gaps.missingQuestions = ["critical question unanswered"];
    if (!importantClaimsSupported) gaps.missingEvidence = ["important claim unsupported"];
    return { valid: true, decision: "NEEDS_MORE_RESEARCH", code: "SUFFICIENCY_NEEDS_MORE", gaps };
  }
  if (remainingUnknownsMaterial || !freshnessAdequate) {
    return { valid: true, decision: "NEEDS_MORE_RESEARCH", code: "SUFFICIENCY_NEEDS_MORE", gaps: { remainingUnknownsMaterial, freshnessAdequate } };
  }
  if (stopCriteriaReached || (!furtherResearchLikely && budgetRemaining === false) || (!furtherResearchLikely)) {
    if (criticalContradictionsResolvedOrFramed) {
      return { valid: true, decision: "SUFFICIENT", code: "SUFFICIENCY_SUFFICIENT" };
    }
    return { valid: true, decision: "NEEDS_MORE_RESEARCH", code: "SUFFICIENCY_NEEDS_MORE", gaps: { unresolvedContradictions: true } };
  }
  return { valid: true, decision: "NEEDS_MORE_RESEARCH", code: "SUFFICIENCY_NEEDS_MORE", gaps: {} };
}

// S11 — web prompt injection: page text is data, never instruction
function isWebContentUntrusted(pageText) {
  const t = String(pageText || "").toLowerCase();
  const patterns = ["ignore previous instructions", "run ", "execute ", "disregard", "system prompt", " rm -rf", "curl ", "wget "];
  const hit = patterns.some((p) => t.includes(p));
  return { isDataNotInstruction: true, containsInjectionAttempt: hit, action: "TREAT_AS_SOURCE_TEXT" };
}

// S12/S13/S14 — platform isolation + shared core
const SHARED_CORE = ["Content Class", "Content Mode", "Research Plan", "Evidence", "Research Sufficiency", "Research Pack", "Editorial Strategy", "Storytelling"];
function resolvePlatformRoute({ platform, contentClass = "FACTUAL", taskType = "RESEARCH" }) {
  const shared = [...SHARED_CORE];
  if (platform === "youtube") {
    return { shared, overlay: ["YouTube metadata/packaging/policy/monetization"], forbidden: ["TikTok-only rules"], valid: true };
  }
  if (platform === "tiktok") {
    return { shared, overlay: ["TikTok aspect/safe-zone/packaging/creative constraints"], forbidden: ["YouTube-only monetization governance"], valid: true };
  }
  return { shared: [], overlay: [], forbidden: [], valid: false, code: "UNKNOWN_PLATFORM" };
}

// S15 — editorial handoff: Pack -> Editorial Strategy -> Storytelling (never raw source-order)
function checkEditorialHandoff({ hasResearchPack, hasEditorialStrategy, scriptFollowsSourceOrder }) {
  if (!hasResearchPack) return { valid: false, code: "MISSING_RESEARCH_PACK" };
  if (!hasEditorialStrategy) return { valid: false, code: "MISSING_EDITORIAL_STRATEGY" };
  if (scriptFollowsSourceOrder === true) return { valid: false, code: "SOURCE_ORDER_SCRIPT_REJECTED" };
  return { valid: true, code: "HANDOFF_OK" };
}

module.exports = {
  SHARED_CORE,
  decideResearchRequired,
  checkFactualScriptReady,
  checkFictionNoForcedResearch,
  checkHybridLabel,
  checkMultiSourceConfirmed,
  checkConflictCertainty,
  checkSufficiency,
  isWebContentUntrusted,
  resolvePlatformRoute,
  checkEditorialHandoff,
};
