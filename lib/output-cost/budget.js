"use strict";

/**
 * 1G.8 budget planning, authorization, retry budget, ledger accounting
 * (PHASE 1G.8, Prompt 01, §§7, §§22–32, §§38–41).
 * Every spend-capable job needs an explicit hard budget BEFORE authorization;
 * exact known over-budget is a hard stop; unknown cost can never claim
 * guaranteed safety (review or strict-block by policy); retries are bounded,
 * budgeted, lineage-tracked, and never variants; failed spend stays
 * unreconciled until authoritative evidence arrives. Planning only — the
 * provider call itself is never executed here. Deterministic.
 */

const shared = require("./shared.js");

function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Build a production budget plan over an output plan.
 * Input: { projectId, scopeId?, scope?, hardBudget { unit, limit, source },
 *   outputPlan, parentBudget? { limit, observed, committed },
 *   retryPolicies? { [dedupeScope]: { maxAdditionalAttempts, reservedCredits?, allowedFailureClasses?, requiresApprovalClasses? } },
 *   strictUnknownCost?: bool, policyVersion?, now? }
 */
function buildBudgetPlan(input = {}) {
  const now = input.now || new Date().toISOString();
  const warnings = [];
  const blockers = [];
  const plan = input.outputPlan;
  if (!plan || !Array.isArray(plan.units)) {
    return { ok: false, code: "BUDGET_PLAN_SOURCE_INVALID", message: "an output plan with units is required" };
  }
  const budget = input.hardBudget || {};
  if (budget.unit !== "CREDITS") {
    return { ok: false, code: "HARD_BUDGET_REQUIRED", message: "an explicit hard budget in CREDITS is required before spend-capable authorization" };
  }
  if (!Number.isFinite(budget.limit) || budget.limit < 0) {
    return { ok: false, code: "HARD_BUDGET_INVALID", message: "hard budget limit must be a non-negative number" };
  }
  if (budget.limit < 0) {
    blockers.push("NEGATIVE_BUDGET: hard budget cannot be negative");
  }

  const est = plan.summary.estimatedCredits;
  let estimateState = est.state;
  if (est.state === "UNKNOWN" || est.state === "PARTIAL") {
    warnings.push(`UNKNOWN_COST_ITEMS: ${est.unknownUnitCount} unit(s) without authoritative cost — exact total unknowable`);
  }
  if (est.state === "CONFLICT") warnings.push("COST_CONFLICT: conflicting observations preserved — no exact total");
  if (est.state === "STALE") warnings.push("COST_STALE: registry refresh required for exactness");

  const budgetPlanId = shared.id12("bp", {
    projectId: input.projectId, scope: input.scopeId || null, budget,
    plan: plan.fingerprint, retry: input.retryPolicies || null,
  });
  const budgetPlan = {
    version: shared.OUTPUT_COST_VERSION,
    budgetPlanId,
    projectId: input.projectId || plan.projectId || null,
    scopeId: input.scopeId || plan.scopeId || null,
    scope: shared.BUDGET_SCOPES.includes(input.scope) ? input.scope : "PROJECT",
    sourceRefs: ["1G.5-production-decision", "1G.6-model-resolution", "1G.7-platform-adaptation"],
    policyVersion: input.policyVersion || shared.BUDGET_POLICY_VERSION,
    registrySnapshotRef: input.registrySnapshotRef || null,
    platformPolicyRefs: input.platformPolicyRefs || [],
    hardBudget: { unit: "CREDITS", limit: budget.limit, scope: input.scope || "PROJECT", source: budget.source || "operator" },
    parentBudget: input.parentBudget ? { ...input.parentBudget } : null,
    plannedItems: plan.units.map((u) => u.unitId),
    unitCount: plan.units.length,
    retryPolicies: isObject(input.retryPolicies) ? input.retryPolicies : {},
    strictUnknownCost: input.strictUnknownCost === true,
    summary: {
      estimatedImages: plan.summary.estimatedImages,
      estimatedVeoShots: plan.summary.estimatedVeoShots,
      estimatedVariants: plan.summary.estimatedVariants,
      knownCredits: est.knownCredits,
      exactTotalCredits: est.exactTotalCredits,
    },
    estimateState,
    warnings,
    blockers,
    supersedes: input.supersedes || null,
    fingerprint: null,
    status: blockers.length > 0 ? "BLOCKED" : "DRAFT",
    createdAt: now,
    updatedAt: now,
  };
  budgetPlan.fingerprint = shared.hash16({
    project: budgetPlan.projectId, scope: budgetPlan.scopeId, budget: budgetPlan.hardBudget,
    units: plan.units.map((u) => u.unitId), estimate: est, retry: budgetPlan.retryPolicies,
    strict: budgetPlan.strictUnknownCost, policy: budgetPlan.policyVersion, supersedes: budgetPlan.supersedes,
  });
  return { ok: true, budgetPlan };
}

/** Remaining spendable credits under a hard budget given ledger totals. */
function remainingBudget(hardBudget, totals) {
  const observed = (totals && totals.creditsObserved) || 0;
  const committed = (totals && totals.committed) || 0;
  return hardBudget.limit - observed - committed;
}

/** Unknown-spend occupancy (hardening sweep A-4): ledger entries whose
 * observed cost is UNKNOWN (submitted, unreconciled) still occupy spend.
 * Accepts a ledger ({entries}) or totals ({unknown}); returns the count. */
function unknownSpendCount(ledgerOrTotals) {
  if (ledgerOrTotals && Array.isArray(ledgerOrTotals.entries)) {
    return ledgerOrTotals.entries.filter((e) => e && (e.creditsObserved === null || e.creditsObserved === undefined)).length;
  }
  return (ledgerOrTotals && ((ledgerOrTotals.totals && ledgerOrTotals.totals.unknown) || ledgerOrTotals.unknown)) || 0;
}

/**
 * Authorize one generation attempt (planning decision, no execution).
 * Input: { budgetPlan, ledger (totals), unit, attemptKind: "base"|"retry",
 *   cost: { state, valuePerGeneration }, parentTotals? }
 * Returns { state, reasons[] } with HARD_STOP_STATES.
 */
function authorizeGenerationAttempt(input = {}) {
  const reasons = [];
  const plan = input.budgetPlan;
  const unit = input.unit;
  if (!plan || !plan.hardBudget) {
    return { state: "BLOCKED", reasons: ["HARD_BUDGET_REQUIRED: no hard budget on this plan"] };
  }
  if (!unit) return { state: "BLOCKED", reasons: ["UNIT_REQUIRED: no generation unit supplied"] };
  // 1H.2 enforcement hook (§12): a wired lock gate stops the expensive action
  // before provider execution. Absent gate = current behavior (compatible).
  if (typeof input.lockGate === "function" && unit.targetType && unit.targetId) {
    const block = input.lockGate({ targetType: unit.targetType, targetId: unit.targetId });
    if (block) return block;
  }
  const totals = input.ledger || { creditsObserved: 0, committed: 0 };
  const remaining = remainingBudget(plan.hardBudget, totals);
  reasons.push(`remaining budget ${remaining} = limit ${plan.hardBudget.limit} - observed ${totals.creditsObserved || 0} - committed ${totals.committed || 0}`);
  if (input.parentTotals) {
    const parentRemaining = remainingBudget({ limit: input.parentTotals.limit }, input.parentTotals);
    reasons.push(`parent remaining budget ${parentRemaining} (effective = min(job, project))`);
    if (parentRemaining <= 0) {
      return { state: "HARD_BUDGET_STOP", reasons: [...reasons, "project-level budget exhausted"] };
    }
  }
  // Hardening sweep (A-4): an in-flight submit with UNKNOWN observed cost
  // must not free its planned spend — block new authorizations until it is
  // reconciled (UNKNOWN never silently becomes zero).
  const unknownInFlight = unknownSpendCount(input.ledger);
  if (unknownInFlight > 0) {
    reasons.push(`${unknownInFlight} ledger entry(s) with UNKNOWN observed cost in flight — reconcile before authorizing more spend`);
    return { state: "REVIEW_REQUIRED_UNKNOWN_SPEND", reasons };
  }
  const cost = input.cost || { state: "UNKNOWN" };
  if (cost.state === "EXACT" && typeof cost.valuePerGeneration === "number") {
    if (cost.valuePerGeneration <= remaining && (input.parentTotals ? cost.valuePerGeneration <= remainingBudget({ limit: input.parentTotals.limit }, input.parentTotals) : true)) {
      reasons.push(`exact known cost ${cost.valuePerGeneration} fits remaining ${remaining}`);
      return { state: "APPROVED", reasons };
    }
    reasons.push(`exact known cost ${cost.valuePerGeneration} exceeds remaining ${remaining}`);
    return { state: "BLOCKED_BUDGET_EXCEEDED", reasons };
  }
  if (cost.state === "CONFLICT") {
    reasons.push("cost evidence CONFLICT — no exact guaranteed total");
    return { state: "BLOCKED_COST_CONFLICT", reasons };
  }
  if (cost.state === "STALE") {
    reasons.push("cost evidence STALE — registry refresh required for exactness");
    return { state: "BLOCKED_REGISTRY_REFRESH_REQUIRED", reasons };
  }
  // UNKNOWN: never claim guaranteed safety.
  if (plan.strictUnknownCost === true) {
    reasons.push("unknown paid cost under strict policy — blocked until authoritative observation exists");
    return { state: "BLOCKED_COST_UNKNOWN", reasons };
  }
  reasons.push("unknown paid cost — pre-generation review required, safety not guaranteed");
  return { state: "PRE_GENERATION_REVIEW_REQUIRED", reasons };
}

/**
 * Authorize a retry: bounded, budgeted, lineage-tracked. Default (no policy):
 * no automatic retry. Returns { state, reasons[], attemptId? }.
 */
function authorizeRetry(input = {}) {
  const reasons = [];
  const { budgetPlan, ledger, unitGroup, failureClass, priorAttemptId, attemptIndex } = input;
  if (!budgetPlan) return { state: "BLOCKED", reasons: ["BUDGET_PLAN_REQUIRED"] };
  if (!unitGroup || !priorAttemptId) {
    return { state: "BLOCKED", reasons: ["RETRY_LINEAGE_REQUIRED: retry must reference the prior attempt"] };
  }
  const policy = (budgetPlan.retryPolicies && budgetPlan.retryPolicies[unitGroup]) || null;
  if (!policy) {
    reasons.push("no retry policy for this unit group — default is no automatic retry");
    return { state: "BLOCKED_RETRY_BUDGET_EXCEEDED", reasons };
  }
  const maxAdditional = Number.isInteger(policy.maxAdditionalAttempts) ? policy.maxAdditionalAttempts : 0;
  if ((attemptIndex || 1) > maxAdditional) {
    reasons.push(`retry ${attemptIndex} exceeds maxAdditionalAttempts ${maxAdditional}`);
    return { state: "BLOCKED_RETRY_BUDGET_EXCEEDED", reasons };
  }
  if (Array.isArray(policy.allowedFailureClasses) && policy.allowedFailureClasses.length > 0
    && failureClass && !policy.allowedFailureClasses.includes(failureClass)) {
    reasons.push(`failure class ${failureClass} not in allowedFailureClasses`);
    return { state: "BLOCKED_RETRY_BUDGET_EXCEEDED", reasons };
  }
  if (Array.isArray(policy.requiresApprovalClasses) && policy.requiresApprovalClasses.includes(failureClass)) {
    reasons.push(`failure class ${failureClass} requires explicit approval`);
    return { state: "REVIEW_REQUIRED", reasons };
  }
  // 1H.2 enforcement hook (§12): same contract as authorizeGenerationAttempt.
  if (typeof input.lockGate === "function" && input.lockTarget) {
    const block = input.lockGate(input.lockTarget);
    if (block) return block;
  }
  // Hardening sweep (A-4): unknown in-flight spend blocks retries too.
  const unknownInFlightRetry = unknownSpendCount(input.ledger);
  if (unknownInFlightRetry > 0) {
    reasons.push(`${unknownInFlightRetry} ledger entry(s) with UNKNOWN observed cost in flight — reconcile before retrying`);
    return { state: "REVIEW_REQUIRED_UNKNOWN_SPEND", reasons };
  }
  // Retry spend must fit: reserved retry credits (explicit) else re-check unit cost.
  const reserved = typeof policy.reservedCredits === "number" ? policy.reservedCredits : null;
  const totals = ledger || { creditsObserved: 0, committed: 0 };
  const remaining = remainingBudget(budgetPlan.hardBudget, totals);
  if (reserved !== null) {
    if (reserved > remaining) {
      reasons.push(`reserved retry credits ${reserved} exceed remaining ${remaining}`);
      return { state: "BLOCKED_RETRY_BUDGET_EXCEEDED", reasons };
    }
    reasons.push(`retry fits reserved retry budget (${reserved} <= ${remaining})`);
  } else if (input.cost && input.cost.state === "EXACT") {
    if (input.cost.valuePerGeneration > remaining) {
      reasons.push(`retry cost ${input.cost.valuePerGeneration} exceeds remaining ${remaining}`);
      return { state: "BLOCKED_RETRY_BUDGET_EXCEEDED", reasons };
    }
    reasons.push(`retry cost ${input.cost.valuePerGeneration} fits remaining ${remaining}`);
  } else {
    reasons.push("retry cost unknown and unreserved — review required, hard stop applies on exceed");
    return { state: "REVIEW_REQUIRED", reasons };
  }
  return {
    state: "APPROVED",
    reasons: [...reasons, `retry lineage ${priorAttemptId} -> new attempt (variant and attempt indexes stay separate)`],
    attemptId: `${unitGroup}:attempt-${attemptIndex}`,
  };
}

function emptyTotals() {
  return { planned: 0, committed: 0, observed: 0, unknown: 0, failed: 0, retried: 0, creditsObserved: 0 };
}

/**
 * Record one runtime observation into a ledger (idempotent).
 * observation: { observationId, attemptId, unitId?, jobId?, plannedCredits?,
 *   reservedCredits?, creditsObserved?, status: SUBMITTED|SUCCEEDED|FAILED,
 *   failureClass?, retryOfAttemptId?, providerResultRef?, modelResolutionRef?,
 *   costObservationRef?, observedAt?, source? }
 */
function recordGenerationObservation(ledgerInput, observation) {
  const ledger = ledgerInput ? JSON.parse(JSON.stringify(ledgerInput)) : null;
  if (!ledger) return { ok: false, code: "LEDGER_MISSING", message: "ledger is required" };
  if (!observation || !observation.attemptId || !observation.observationId) {
    return { ok: false, code: "OBSERVATION_IDENTITY_REQUIRED", message: "attemptId + observationId are required" };
  }
  ledger.entries = Array.isArray(ledger.entries) ? ledger.entries : [];
  const seen = ledger.entries.some((e) => e.attemptId === observation.attemptId && e.observationId === observation.observationId);
  if (seen) {
    return { ok: true, ledger, deduped: true };
  }
  const entry = {
    entryId: shared.id12("le", { attempt: observation.attemptId, obs: observation.observationId }),
    budgetPlanId: ledger.budgetPlanId || null,
    generationUnitId: observation.unitId || null,
    jobId: observation.jobId || null,
    attemptId: observation.attemptId,
    observationId: observation.observationId,
    plannedCredits: observation.plannedCredits !== undefined ? observation.plannedCredits : null,
    reservedCredits: observation.reservedCredits !== undefined ? observation.reservedCredits : null,
    creditsObserved: observation.creditsObserved !== undefined ? observation.creditsObserved : null,
    costReconciliation: observation.creditsObserved !== undefined && observation.creditsObserved !== null ? "OBSERVED" : "PENDING",
    status: observation.status || "SUBMITTED",
    failureClass: observation.failureClass || null,
    retryOfAttemptId: observation.retryOfAttemptId || null,
    providerResultRef: observation.providerResultRef || null,
    modelResolutionRef: observation.modelResolutionRef || null,
    costObservationRef: observation.costObservationRef || null,
    observedAt: observation.observedAt || new Date().toISOString(),
    source: observation.source || "runtime-fixture",
    fingerprint: shared.hash16({ attempt: observation.attemptId, obs: observation.observationId, status: observation.status || "SUBMITTED" }),
  };
  ledger.entries.push(entry);
  recomputeLedger(ledger);
  return { ok: true, ledger, deduped: false, entry };
}

function recomputeLedger(ledger) {
  const entries = ledger.entries || [];
  const totals = emptyTotals();
  totals.planned = new Set(entries.map((e) => e.generationUnitId).filter(Boolean)).size;
  totals.actual = entries.filter((e) => e.status !== "PLANNED").length;
  totals.failed = entries.filter((e) => e.status === "FAILED").length;
  totals.retried = entries.filter((e) => e.retryOfAttemptId).length;
  totals.committed = entries.reduce((s, e) => s + (e.reservedCredits || 0), 0);
  const observedEntries = entries.filter((e) => typeof e.creditsObserved === "number");
  totals.observed = observedEntries.length;
  totals.creditsObserved = observedEntries.reduce((s, e) => s + e.creditsObserved, 0);
  totals.unknown = entries.filter((e) => e.creditsObserved === null || e.creditsObserved === undefined).length;
  // Reconciliation: authoritative observed values only; conflicts preserved.
  const values = observedEntries.map((e) => e.creditsObserved);
  const distinct = [...new Set(values)];
  if (entries.length === 0) ledger.reconciliationState = "RECONCILED";
  else if (distinct.length > 1 && entries.some((e) => e.status === "FAILED")) ledger.reconciliationState = "PARTIAL";
  else if (totals.unknown > 0) ledger.reconciliationState = totals.observed > 0 ? "PARTIAL" : "UNRECONCILED";
  else ledger.reconciliationState = "RECONCILED";
  if (ledger.expectConflict === true && distinct.length > 1) ledger.reconciliationState = "CONFLICT";
  ledger.totals = totals;
  ledger.remainingBudget = ledger.hardBudgetLimit !== undefined && ledger.hardBudgetLimit !== null
    ? ledger.hardBudgetLimit - totals.creditsObserved - totals.committed : null;
  ledger.fingerprint = shared.hash16({ entries: entries.map((e) => e.fingerprint), totals });
  ledger.updatedAt = new Date().toISOString();
  return ledger;
}

function newLedger(input = {}) {
  const ledger = {
    version: shared.OUTPUT_COST_VERSION,
    ledgerId: shared.id12("cl", { project: input.projectId, plan: input.budgetPlanId }),
    projectId: input.projectId || null,
    budgetPlanId: input.budgetPlanId || null,
    hardBudgetLimit: input.hardBudgetLimit !== undefined ? input.hardBudgetLimit : null,
    entries: [],
    totals: emptyTotals(),
    remainingBudget: input.hardBudgetLimit !== undefined ? input.hardBudgetLimit : null,
    reconciliationState: "RECONCILED",
    expectConflict: false,
    warnings: [],
    blockers: [],
    fingerprint: shared.hash16({ project: input.projectId, plan: input.budgetPlanId, empty: true }),
    createdAt: input.now || new Date().toISOString(),
    updatedAt: input.now || new Date().toISOString(),
  };
  return ledger;
}

/**
 * Targeted staleness for budget plans. Cost-only changes stale the budget
 * plan alone — never upstream creative artifacts (proven by tests asserting
 * 1G.5/1G.7 objects stay byte-identical; this function only reads them).
 */
function checkBudgetStaleness(budgetPlan, context = {}) {
  const reasons = [];
  if (!budgetPlan) return { stale: false, reasons };
  if (context.outputPlan && budgetPlan.plannedItems) {
    const current = (context.outputPlan.units || []).map((u) => u.unitId).sort().join(",");
    const stored = [...(budgetPlan.plannedItems || [])].sort().join(",");
    if (current !== stored) reasons.push("planned generation units changed");
  }
  if (context.costSnapshotFingerprint && budgetPlan.registrySnapshotRef
    && budgetPlan.registrySnapshotRef.fingerprint !== context.costSnapshotFingerprint) {
    reasons.push("1G.6 cost evidence changed (budget plan stale; creative artifacts clean)");
  }
  if (context.hardBudget && JSON.stringify(context.hardBudget) !== JSON.stringify({ unit: budgetPlan.hardBudget.unit, limit: budgetPlan.hardBudget.limit, scope: budgetPlan.hardBudget.scope })) {
    const sameLimit = context.hardBudget.limit === budgetPlan.hardBudget.limit;
    if (!sameLimit) reasons.push("hard budget changed");
  }
  if (context.retryPolicies && shared.hash16(context.retryPolicies) !== shared.hash16(budgetPlan.retryPolicies || {})) {
    reasons.push("retry policy changed");
  }
  const policyVersion = context.policyVersion || shared.BUDGET_POLICY_VERSION;
  if (budgetPlan.policyVersion && budgetPlan.policyVersion !== policyVersion) {
    reasons.push("budget policy version changed");
  }
  return { stale: reasons.length > 0, reasons };
}

module.exports = {
  buildBudgetPlan,
  remainingBudget,
  authorizeGenerationAttempt,
  authorizeRetry,
  recordGenerationObservation,
  recomputeLedger,
  newLedger,
  emptyTotals,
  checkBudgetStaleness,
};
