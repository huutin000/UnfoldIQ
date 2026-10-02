"use strict";

/**
 * UNFOLDIQ policy freshness / handoff evaluation (STEP 09 V2).
 * No network fetch in this module. Pure metadata logic.
 *
 * A cached file merely existing NEVER proves currentness.
 * policyMaxAgeDays is a configurable PROJECT DEFAULT, not a platform fact.
 */

const DEFAULT_MAX_AGE_DAYS = 30;

function toMs(value) {
  if (!value) return NaN;
  const t = new Date(value).getTime();
  return t;
}

/**
 * evaluatePolicyFreshness(source, now)
 * source: { verificationStatus, lastVerifiedAt|verifiedAt, observedUpdateDate|lastObservedUpdate, criticality }
 * Returns { status: FRESH|STALE|SNAPSHOT_ONLY|NOT_VERIFIED, reasons[] }.
 */
function evaluatePolicyFreshness(source, now, maxAgeDays) {
  const reasons = [];
  const maxAge = maxAgeDays == null ? DEFAULT_MAX_AGE_DAYS : maxAgeDays;
  const nowMs = now ? new Date(now).getTime() : Date.now();
  const status0 = source && source.verificationStatus;
  const verifiedAt = (source && (source.verifiedAt || source.lastVerifiedAt)) || null;
  const observedUpdate = (source && (source.observedUpdateDate || source.lastObservedUpdate)) || null;

  if (!source || status0 === "NOT_VERIFIED" || !verifiedAt || Number.isNaN(toMs(verifiedAt))) {
    reasons.push("no verified timestamp available");
    return { status: "NOT_VERIFIED", reasons };
  }

  if (status0 === "SNAPSHOT_ONLY") {
    reasons.push("snapshot-only source is never current-live-verified");
    const ageDays = (nowMs - toMs(verifiedAt)) / 86400000;
    if (ageDays > maxAge) reasons.push(`snapshot age ${Math.floor(ageDays)}d exceeds policyMaxAgeDays=${maxAge}`);
    const state = { status: "SNAPSHOT_ONLY", reasons };
    if (observedUpdate && toMs(observedUpdate) > toMs(verifiedAt)) {
      reasons.push("known newer observed update than verifiedAt");
      state.status = "STALE";
    } else if (ageDays > maxAge) {
      state.status = "STALE";
    }
    return state;
  }

  // LIVE_VERIFIED path
  const ageDays = (nowMs - toMs(verifiedAt)) / 86400000;
  if (observedUpdate && toMs(observedUpdate) > toMs(verifiedAt)) {
    reasons.push("known newer observed update than verifiedAt");
    return { status: "STALE", reasons };
  }
  if (ageDays > maxAge) {
    reasons.push(`age ${Math.floor(ageDays)}d exceeds policyMaxAgeDays=${maxAge}`);
    return { status: "STALE", reasons };
  }
  reasons.push("live-verified within freshness window");
  return { status: "FRESH", reasons };
}

/**
 * evaluatePolicyHandoff(input)
 * input: { freshnessStatus, verificationStatus, criticality, categoryRelevant, hasLiveCapability }
 * Returns { handoff: CURRENT_LIVE_VERIFIED|SNAPSHOT_ONLY|PUBLISH_REVIEW_REQUIRED|STALE|NOT_VERIFIED, reasons[] }.
 */
function evaluatePolicyHandoff(input) {
  const reasons = [];
  const freshness = input.freshnessStatus;
  const critical = input.criticality === "CRITICAL" || input.criticality === "HIGH";
  const live = !!input.hasLiveCapability;

  if (freshness === "FRESH" && input.verificationStatus === "LIVE_VERIFIED") {
    reasons.push("fresh live-verified source");
    return { handoff: "CURRENT_LIVE_VERIFIED", reasons };
  }
  if (freshness === "STALE") {
    if (!live && critical) {
      reasons.push("stale critical/high source with no live capability");
      return { handoff: "PUBLISH_REVIEW_REQUIRED", reasons };
    }
    reasons.push("stale snapshot requires refresh when live capability exists");
    return { handoff: "STALE", reasons };
  }
  if (freshness === "SNAPSHOT_ONLY" || input.verificationStatus === "SNAPSHOT_ONLY") {
    reasons.push("snapshot-only: must not claim CURRENT_POLICY_VERIFIED");
    if (critical && !live) {
      reasons.push("critical snapshot-only with no live capability");
      return { handoff: "PUBLISH_REVIEW_REQUIRED", reasons };
    }
    return { handoff: "SNAPSHOT_ONLY", reasons };
  }
  reasons.push("policy state not verified");
  return { handoff: "NOT_VERIFIED", reasons };
}

module.exports = { evaluatePolicyFreshness, evaluatePolicyHandoff, DEFAULT_MAX_AGE_DAYS };
