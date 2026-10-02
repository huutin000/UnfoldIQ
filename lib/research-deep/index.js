"use strict";

/**
 * UNFOLDIQ deep-escalation orchestrator (PHASE 1G.1 Prompt 05, 1G.1Q).
 *
 * STANDARD -> NEEDS_MORE_RESEARCH -> policy -> DEEP leads ->
 * Prompt-02 canonical acquisition -> Prompt-03 registry/independence ->
 * sufficiency re-evaluation -> Prompt 04 (unchanged contract).
 *
 * The orchestrator never writes claims, packs, or drafts. It counts
 * DEEP_RUN_STATUS separately from RESEARCH_SUFFICIENCY_STATUS (§31).
 */

const policy = require("./escalation-policy.js");
const leads = require("./deep-leads.js");
const attempts = require("./attempt-store.js");
const providerIface = require("./provider-interface.js");

/**
 * Run one bounded escalation. Deps are injected so fixtures run without
 * network: { runProvider(request) -> {ok, result|code,error},
 * acquireUrl(url) -> {ok, document|code,message},
 * registerSource(index, {acquiredDocument}) -> {ok, record} }.
 */
async function runDeepEscalation(ctx = {}, deps = {}) {
  const decision = policy.decideEscalation(ctx.escalationInput || {});
  if (decision.action !== "ESCALATE_DEEP") {
    return { decision, deepRunStatus: "NOT_RUN", sufficiencyAfter: ctx.sufficiencyBefore || null };
  }
  if (!providerIface.isLiveApproved((ctx.env || {}).UNFOLDIQ ? ctx.env : process.env) && ctx.requireLiveApproval !== false && !deps.runProvider) {
    return { decision, deepRunStatus: "DEEP_LIVE_NOT_APPROVED", sufficiencyAfter: ctx.sufficiencyBefore || null };
  }

  const request = policy.buildDeepRequest(ctx.plan || {}, ctx.gaps || {}, decision, { requestId: ctx.requestId });
  const startedAt = new Date().toISOString();
  let providerOut;
  try {
    providerOut = await deps.runProvider(request);
  } catch (e) {
    providerOut = { ok: false, code: "DEEP_PROVIDER_ERROR", error: String((e && e.message) || e) };
  }
  if (!providerOut || !providerOut.ok) {
    return {
      decision, request, deepRunStatus: (providerOut && providerOut.code) || "DEEP_PROVIDER_ERROR",
      error: providerOut && providerOut.error,
      sufficiencyAfter: ctx.sufficiencyBefore || null, // STANDARD artifacts intact (§55)
    };
  }

  const result = providerOut.result;
  const candidates = leads.candidateSourcesFromResult(result).slice(0, request.maxQueries * 2);
  const index = ctx.sourceIndex || { version: "1.0.0", projectId: (ctx.plan && ctx.plan.projectId) || null, sources: [] };
  let reacquired = 0;
  const acquisitionErrors = [];
  const reacquiredRecords = [];
  // Bounded reacquisition: cap + canonical Prompt-02 path only.
  for (const c of candidates.slice(0, request.maxQueries)) {
    if (typeof deps.acquireUrl !== "function" || typeof deps.registerSource !== "function") break;
    let acq;
    try {
      acq = await deps.acquireUrl(c.url);
    } catch (e) {
      acquisitionErrors.push(`${c.url}: ${String((e && e.message) || e).slice(0, 120)}`);
      continue;
    }
    if (!acq || !acq.ok) {
      acquisitionErrors.push(`${c.url}: ${(acq && acq.code) || "ACQUIRE_FAILED"}`);
      continue;
    }
    const reg = deps.registerSource(index, { acquiredDocument: acq.document });
    if (reg && reg.ok) {
      reacquired++;
      reacquiredRecords.push(reg.record);
    } else {
      acquisitionErrors.push(`${c.url}: ${(reg && reg.code) || "REGISTER_FAILED"}`);
    }
  }

  let sufficiencyAfter = ctx.sufficiencyBefore || null;
  if (typeof deps.evaluateSufficiency === "function") {
    try {
      sufficiencyAfter = deps.evaluateSufficiency({ reacquiredRecords, candidateCount: candidates.length });
    } catch { /* keep before-state; never corrupt evidence */ }
  }

  const record = attempts.buildAttemptRecord({
    providerId: request.providerId,
    providerVersion: result.providerVersion,
    request, plan: ctx.plan, gaps: ctx.gaps, config: decision.config,
    escalation: { action: decision.action, reasonCodes: decision.reasonCodes },
    startedAt, completedAt: new Date().toISOString(),
    status: reacquired > 0 ? "DEEP_PARTIAL_OR_SUCCESS" : "DEEP_NO_NEW_SOURCES",
    candidateUrlCount: candidates.length, reacquiredUrlCount: reacquired,
    sufficiencyBefore: (ctx.sufficiencyBefore && ctx.sufficiencyBefore.decision) || ctx.sufficiencyBefore || null,
    sufficiencyAfter: (sufficiencyAfter && sufficiencyAfter.decision) || sufficiencyAfter || null,
    warnings: [...(result.warnings || []), ...acquisitionErrors].slice(0, 20),
  });

  return { decision, request, result, candidates, reacquiredRecords, reacquiredCount: reacquired, deepRunStatus: record.status, sufficiencyAfter, attemptRecord: record };
}

module.exports = {
  decideEscalation: policy.decideEscalation,
  buildDeepRequest: policy.buildDeepRequest,
  runDeepEscalation,
  policy,
  leads,
  attempts,
  providerIface,
};
