"use strict";

/**
 * Flow Companion bridge state machine (STEP 10B).
 * Persistent, restart-safe transitions with approval guards.
 * No silent transition from failure to a new credit-consuming attempt.
 */

const TERMINAL = new Set(["READY", "FAILED", "CANCELLED", "REJECTED_BY_USER"]);
const MAX_GENERATION_ATTEMPTS = 3;
const MAX_ADAPTED_GENERATION_ATTEMPTS = 2;

const TRANSITIONS = {
  PENDING: ["VALIDATED", "CANCELLED"],
  VALIDATED: ["PREPARED", "CANCELLED", "FAILED"],
  PREPARED: ["AWAITING_USER_APPROVAL", "MANUAL_ASSIST_REQUIRED", "CANCELLED"],
  AWAITING_USER_APPROVAL: ["AWAITING_PROVIDER_ACCEPTANCE", "GENERATING", "REJECTED_BY_USER", "CANCELLED", "PAUSED"],
  // Submit issued to the provider page, acceptance not yet proven. The only
  // exits are acceptance evidence (GENERATING), explicit reconciliation, or
  // cancellation — never a fresh submit with a different approval.
  AWAITING_PROVIDER_ACCEPTANCE: ["GENERATING", "RECONCILIATION_REQUIRED", "CANCELLED"],
  GENERATING: ["RESULT_DETECTED", "RETRYABLE_ERROR", "FAILED", "PAUSED", "CANCELLED", "RECONCILIATION_REQUIRED", "PROVIDER_SAFETY_REFUSED"],
  RESULT_DETECTED: ["DOWNLOADING", "RETRYABLE_ERROR", "FAILED"],
  DOWNLOADING: ["IMPORTED", "RETRYABLE_ERROR", "FAILED"],
  IMPORTED: ["READY", "REJECTED_BY_QA"],
  REJECTED_BY_QA: ["PREPARED", "CANCELLED"],
  RETRYABLE_ERROR: ["PREPARED", "CANCELLED"],
  PAUSED: ["PREPARED", "AWAITING_USER_APPROVAL", "CANCELLED"],
  MANUAL_ASSIST_REQUIRED: ["IMPORTED", "CANCELLED"],
  RECONCILIATION_REQUIRED: ["MANUAL_ASSIST_REQUIRED", "CANCELLED"],
  PROVIDER_SAFETY_REFUSED: ["SAFETY_ADAPTATION_REQUIRED", "SAFE_FALLBACK_REQUIRED", "CANCELLED", "MANUAL_ASSIST_REQUIRED"],
  SAFETY_ADAPTATION_REQUIRED: ["SAFETY_ADAPTATION_PREPARED", "SAFE_FALLBACK_REQUIRED", "CANCELLED"],
  SAFETY_ADAPTATION_PREPARED: ["AWAITING_USER_APPROVAL", "CANCELLED"],
  SAFE_FALLBACK_REQUIRED: ["MANUAL_ASSIST_REQUIRED", "CANCELLED"],
  FAILED: [],
  CANCELLED: [],
  READY: [],
  REJECTED_BY_USER: [],
};

function canTransition(from, to) {
  return (TRANSITIONS[from] || []).includes(to);
}

/**
 * Guarded transition. Mutates a copy and returns it.
 * - GENERATING requires a fresh, unused approval for this job+attempt.
 * - Generation entries are bounded (MAX_GENERATION_ATTEMPTS).
 * - REJECTED_BY_QA → PREPARED starts a new attempt (old preserved by caller).
 * - Safety path: entering SAFETY_ADAPTATION_REQUIRED past the adapted budget
 *   throws BUDGET_EXCEEDED (caller routes to SAFE_FALLBACK_REQUIRED instead).
 * - SAFETY_ADAPTATION_PREPARED opens a new attempt with cleared approval.
 */
function transition(job, to, opts = {}) {
  const from = job.status;
  if (!canTransition(from, to)) {
    throw new Error(`INVALID_TRANSITION: ${from} → ${to}`);
  }
  if (TERMINAL.has(from)) {
    throw new Error(`TERMINAL_STATE: ${from} cannot transition`);
  }
  const next = { ...job, history: [...(job.history || []), { from, to, at: new Date().toISOString(), actor: opts.actor || "system" }] };

  if (to === "GENERATING") {
    const ap = job.approval;
    if (!ap || ap.jobId !== job.jobId || ap.attempt !== job.attempt || ap.used) {
      throw new Error("APPROVAL_REQUIRED: GENERATING needs a fresh unused approval for this job+attempt");
    }
    const count = (job.generationCount || 0) + 1;
    if (count > MAX_GENERATION_ATTEMPTS) {
      throw new Error("GENERATION_ATTEMPT_LIMIT: no infinite retry; resolve manually");
    }
    next.generationCount = count;
    next.approval = { ...ap, used: true };
  }
  if (from === "REJECTED_BY_QA" && to === "PREPARED") {
    next.attempt = job.attempt + 1;
    next.approval = null;
  }
  if (from === "RETRYABLE_ERROR" && to === "PREPARED") {
    next.approval = null; // generation retry needs a NEW approval
  }
  if (to === "SAFETY_ADAPTATION_REQUIRED") {
    const used = job.adaptedCount || 0;
    if (used >= MAX_ADAPTED_GENERATION_ATTEMPTS) {
      throw new Error("BUDGET_EXCEEDED: adapted safety attempts exhausted; route to SAFE_FALLBACK_REQUIRED");
    }
  }
  if (to === "SAFETY_ADAPTATION_PREPARED") {
    next.attempt = job.attempt + 1;
    next.adaptedCount = (job.adaptedCount || 0) + 1;
    next.approval = null; // adapted retry needs a NEW approval at AWAITING_USER_APPROVAL
    if (opts.adaptation) next.adaptation = opts.adaptation;
  }
  if (to === "AWAITING_PROVIDER_ACCEPTANCE") {
    if (opts.submitNonce) {
      next.submitIssuedAt = new Date().toISOString();
      next.submitNonce = opts.submitNonce;
    }
  }
  if (to === "PAUSED") {
    next.pausedFrom = from;
  }
  next.status = to;
  if (opts.error) next.error = opts.error;
  return next;
}

module.exports = { TRANSITIONS, TERMINAL, MAX_GENERATION_ATTEMPTS, MAX_ADAPTED_GENERATION_ATTEMPTS, canTransition, transition };
