"use strict";

/**
 * UNFOLDIQ Research Sufficiency Gate (1G.1L, Prompt 03).
 *
 * Canonical states: SUFFICIENT | NEEDS_MORE_RESEARCH | BLOCKED. The gate is
 * deterministic and inspectable: evidence factors are computed from the
 * ledger/registry/contradictions/unknowns, then mapped through the PRE-FLIGHT
 * boolean core (lib/v5-contract-check.js checkSufficiency — reused, not
 * redefined), then enriched with targeted gaps. No opaque LLM opinion:
 * provider reasoning may supply rationale text, but the decision is policy.
 */

const { checkSufficiency } = require("../v5-contract-check.js");
const { questionCoverage, EVIDENCE_POLICY_V1 } = require("./claim-ledger.js");

const SUFFICIENCY_VERSION = "1.0.0";
const EVIDENCE_POLICY_VERSION = EVIDENCE_POLICY_V1.version;
const CURRENT_STATE_FRESHNESS_DAYS = 90;

function parseBudget(budgetString) {
  const out = {};
  const m = String(budgetString || "").match(/maxQueries\s*:\s*(\d+).*?maxSources\s*:\s*(\d+)/i);
  if (m) {
    out.maxQueries = parseInt(m[1], 10);
    out.maxSources = parseInt(m[2], 10);
  }
  return out;
}

function isCurrentStateQuestion(question, explicitIds, questionId) {
  if (Array.isArray(explicitIds) && questionId && explicitIds.includes(questionId)) return true;
  return /current|latest|today|breaking|202[5-9]|this (week|month|year)/i.test(String(question || ""));
}

function evidenceAgeDays(retrievedAt, now) {
  const t = Date.parse(retrievedAt);
  if (Number.isNaN(t)) return null;
  return (now - t) / (1000 * 60 * 60 * 24);
}

/** Minimum corroboration per materiality (risk-aware; no universal 2-source rule). */
function claimMeetsPolicy(claim, policy) {
  const min = (policy.minGroups || {})[claim.materiality] ?? 1;
  const groupsByStatus = {
    PRIMARY_CONFIRMED: Infinity,
    MULTI_SOURCE_CONFIRMED: 2,
    SINGLE_SOURCE: 1,
    CONFLICTED: 0,
    UNSUPPORTED: 0,
  };
  return (groupsByStatus[claim.corroborationStatus] ?? 0) >= min;
}

function importantClaims(ledger) {
  return (ledger.claims || []).filter((c) => c.materiality === "critical" || c.materiality === "high");
}

function openCriticalContradictions(store) {
  return (store.contradictions || []).filter((c) =>
    c.materiality === "critical" && (c.status === "OPEN" || c.status === "BLOCKING")
  );
}

function materialOpenUnknowns(store) {
  return (store.unknowns || []).filter((u) =>
    u.status === "OPEN" && (u.materiality === "critical" || u.materiality === "material")
  );
}

/**
 * Evaluate sufficiency. Input:
 * { plan, ledger, records, contradictionsStore, unknownsStore merged as
 *   { contradictions, unknowns }, budgetSpent {sources, queries},
 *   currentStateQuestionIds?, failures? [{questionId?, blocker}],
 *   policyBlocker?, now? }
 */
function evaluateSufficiency(input = {}) {
  const plan = input.plan || {};
  const ledger = input.ledger || { claims: [] };
  const records = input.records || [];
  const store = input.store || { contradictions: [], unknowns: [] };
  const policy = input.policy || EVIDENCE_POLICY_V1;
  const now = input.now || Date.now();
  const warnings = [];

  const criticalQuestions = Array.isArray(plan.criticalQuestions) ? plan.criticalQuestions : [];
  // Claims link to questions via researchQuestionIds "q0".."qN" (index into
  // plan.criticalQuestions) or the question text itself.
  const unanswered = [];
  for (let i = 0; i < criticalQuestions.length; i++) {
    const cov = questionCoverage(ledger, `q${i}`);
    const covByText = (ledger.claims || []).filter((c) =>
      !c.needsReevaluation &&
      (c.evidenceStatus === "SUPPORTED" || c.evidenceStatus === "MIXED") &&
      (c.supportingEvidence || []).length > 0 &&
      (c.researchQuestionIds || []).includes(criticalQuestions[i])
    ).length;
    if (cov.adequate === 0 && covByText === 0) {
      unanswered.push({ index: i, question: criticalQuestions[i], questionId: `q${i}` });
    }
  }

  const important = importantClaims(ledger);
  const unsupportedImportant = important.filter((c) => c.needsReevaluation || !claimMeetsPolicy(c, policy));

  const blocking = openCriticalContradictions(store);
  const unknowns = materialOpenUnknowns(store);

  // Freshness: current-state questions need recent evidence; evergreen does not.
  const staleSources = [];
  let freshnessAdequate = true;
  const bySource = new Map(records.map((r) => [r.sourceId, r]));
  for (const claim of ledger.claims || []) {
    const qText = (claim.researchQuestionIds || []).join(" ");
    const isCurrent = isCurrentStateQuestion(claim.claim, input.currentStateQuestionIds, null) ||
      isCurrentStateQuestion(qText, input.currentStateQuestionIds, null) ||
      (claim.researchQuestionIds || []).some((id) => (input.currentStateQuestionIds || []).includes(id));
    if (!isCurrent) continue;
    for (const ev of claim.supportingEvidence || []) {
      const rec = bySource.get(ev.sourceId);
      const age = evidenceAgeDays(rec ? rec.retrievedAt : null, now);
      if (age === null || age > (input.freshnessDays || CURRENT_STATE_FRESHNESS_DAYS)) {
        freshnessAdequate = false;
        staleSources.push({ claimId: claim.claimId, sourceId: ev.sourceId, ageDays: age === null ? null : Math.round(age) });
      }
    }
  }

  // Budget: parse plan string; unparseable => assume remaining + warning.
  const budget = parseBudget(plan.researchBudget);
  const spent = input.budgetSpent || { sources: 0, queries: 0 };
  let budgetRemaining = true;
  if (budget.maxSources !== undefined && spent.sources >= budget.maxSources) budgetRemaining = false;
  if (budget.maxQueries !== undefined && spent.queries >= budget.maxQueries) budgetRemaining = false;
  if (budget.maxSources === undefined) warnings.push("researchBudget unparseable; budget treated as remaining");

  const criticalBlocker = input.policyBlocker ||
    (Array.isArray(input.failures) && input.failures.length > 0
      ? input.failures.map((f) => f.blocker || `acquisition failed for ${f.questionId || "critical scope"}`).join("; ")
      : null);

  const materialGapRemains = unanswered.length > 0 || unsupportedImportant.length > 0 || blocking.length > 0;

  const core = checkSufficiency({
    criticalQuestionsAnswered: unanswered.length === 0,
    importantClaimsSupported: unsupportedImportant.length === 0,
    criticalContradictionsResolvedOrFramed: blocking.length === 0,
    remainingUnknownsMaterial: unknowns.length > 0,
    freshnessAdequate,
    stopCriteriaReached: !materialGapRemains,
    furtherResearchLikely: materialGapRemains && budgetRemaining && !criticalBlocker,
    budgetRemaining,
    criticalBlocker,
  });

  let decision = core.decision;
  let blocker = core.blocker || null;
  // Budget exhausted with a material gap is BLOCKED, never a silent SUFFICIENT.
  if (!budgetRemaining && materialGapRemains && decision !== "BLOCKED") {
    decision = "BLOCKED";
    blocker = `research budget exhausted with material gap: ${unanswered.length} open question(s), ${unsupportedImportant.length} unsupported important claim(s)`;
  }

  const gaps = {};
  if (decision === "NEEDS_MORE_RESEARCH" || decision === "BLOCKED") {
    if (unanswered.length > 0) {
      gaps.missingQuestions = unanswered.map((u) => u.question);
      gaps.recommendedQueries = unanswered.map((u) => u.question);
      gaps.recommendedSourceTypes = Array.isArray(plan.sourcePriority) && plan.sourcePriority.length > 0
        ? plan.sourcePriority
        : ["PRIMARY", "OFFICIAL", "reputable secondary"];
    }
    if (unsupportedImportant.length > 0) {
      gaps.missingEvidence = unsupportedImportant.map((c) => ({ claimId: c.claimId, needs: `corroboration for ${c.materiality} claim (status ${c.corroborationStatus})` }));
    }
    const weakHigh = (ledger.claims || []).filter((c) =>
      (c.materiality === "critical" || c.materiality === "high") && c.evidenceStatus === "WEAK"
    );
    if (weakHigh.length > 0) {
      gaps.weakClaims = weakHigh.map((c) => c.claimId);
    }
    if (blocking.length > 0) {
      gaps.unresolvedContradictions = blocking.map((c) => c.contradictionId);
    }
    if (staleSources.length > 0) {
      gaps.staleSources = staleSources;
    }
  }

  const rationaleParts = [
    `critical questions answered: ${unanswered.length === 0} (${criticalQuestions.length - unanswered.length}/${criticalQuestions.length})`,
    `important claims supported: ${unsupportedImportant.length === 0} (${important.length - unsupportedImportant.length}/${important.length})`,
    `blocking contradictions: ${blocking.length}`,
    `material open unknowns: ${unknowns.length}`,
    `freshness adequate: ${freshnessAdequate}`,
    `budget remaining: ${budgetRemaining}`,
  ];
  if (blocker) rationaleParts.push(`blocker: ${blocker}`);

  return {
    decision,
    rationale: rationaleParts.join("; "),
    factors: {
      criticalQuestionsAnswered: unanswered.length === 0,
      importantClaimsSupported: unsupportedImportant.length === 0,
      criticalContradictionsResolvedOrFramed: blocking.length === 0,
      remainingUnknownsMaterial: unknowns.length > 0,
      freshnessAdequate,
      budgetRemaining,
      stopCriteriaReached: !materialGapRemains,
    },
    gaps,
    blocker,
    warnings,
    policyVersion: policy.version || EVIDENCE_POLICY_VERSION,
    planRef: { topic: plan.topic || null, projectId: plan.projectId || null },
    evaluatedAt: new Date(now).toISOString(),
  };
}

module.exports = {
  SUFFICIENCY_VERSION,
  EVIDENCE_POLICY_VERSION,
  CURRENT_STATE_FRESHNESS_DAYS,
  parseBudget,
  claimMeetsPolicy,
  evaluateSufficiency,
};
