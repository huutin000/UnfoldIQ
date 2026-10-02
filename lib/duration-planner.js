"use strict";

/**
 * UNFOLDIQ duration planner (STEP 10A-FIX). Pure and deterministic:
 * no web calls, no LLM calls, no random values.
 *
 * resolveDurationContract(input) → contract (throws on invalid input)
 * estimateScriptBudget(contract, contentMode) → scriptBudget
 * validateDurationContract(contract) → structural check (delegates to lib/duration-check.js)
 */

const SPEAKING_RATE_DEFAULTS = {
  "documentary": { wpmMin: 140, wpmMax: 160, label: "documentary/explainer 140-160 wpm" },
  "explainer": { wpmMin: 140, wpmMax: 160, label: "documentary/explainer 140-160 wpm" },
  "tutorial": { wpmMin: 130, wpmMax: 150, label: "tutorial 130-150 wpm" },
  "meditation": { wpmMin: 90, wpmMax: 110, label: "meditation 90-110 wpm" },
  "short-form": { wpmMin: 160, wpmMax: 180, label: "energetic short-form 160-180 wpm" },
  "default": { wpmMin: 140, wpmMax: 160, label: "default 140-160 wpm" },
};

function assertTargetOrdering(t) {
  if (!t) return;
  for (const k of ["minMs", "preferredMs", "maxMs"]) {
    if (t[k] !== undefined && (typeof t[k] !== "number" || t[k] < 0)) {
      throw new Error(`NEGATIVE_DURATION: userTarget.${k} must be >= 0`);
    }
  }
  if (t.minMs !== undefined && t.maxMs !== undefined && t.minMs > t.maxMs) {
    throw new Error("TARGET_ORDER_INVALID: userTarget.minMs must be <= userTarget.maxMs");
  }
  if (t.minMs !== undefined && t.preferredMs !== undefined && t.minMs > t.preferredMs) {
    throw new Error("TARGET_ORDER_INVALID: userTarget.minMs must be <= userTarget.preferredMs");
  }
  if (t.preferredMs !== undefined && t.maxMs !== undefined && t.preferredMs > t.maxMs) {
    throw new Error("TARGET_ORDER_INVALID: userTarget.preferredMs must be <= userTarget.maxMs");
  }
}

function midpoint(a, b) {
  return Math.round((a + b) / 2);
}

/**
 * resolveDurationContract({ projectId, platform, durationMode, userTarget?,
 *   contentCapacity, allowScopeExpansion?, expandedCapacity? }) → duration contract.
 * Capacity is consumed via recommendedMin/MaxMs + basis only — never source
 * counts, token counts, or search-result volume.
 */
function resolveDurationContract(input) {
  const { projectId, platform, durationMode } = input;
  if (!projectId || !platform || !durationMode) throw new Error("INVALID_INPUT: projectId/platform/durationMode required");
  if (!["AUTO", "FLEXIBLE_TARGET", "APPROXIMATE_TARGET", "HARD_LIMIT"].includes(durationMode)) {
    throw new Error(`INVALID_MODE: ${durationMode}`);
  }
  const capacity = input.contentCapacity;
  if (!capacity || !capacity.status) throw new Error("INVALID_INPUT: contentCapacity.status required");
  if (capacity.recommendedMinMs < 0 || capacity.recommendedMaxMs < 0) throw new Error("NEGATIVE_DURATION: capacity bounds must be >= 0");
  if (!capacity.basis) throw new Error("CAPACITY_BASIS_MISSING: capacity must cite meaningful editorial units");

  // Effective capacity: evidence-backed expansion may extend it (same question, real value).
  let effMin = capacity.recommendedMinMs;
  let effMax = capacity.recommendedMaxMs;
  let expanded = false;
  if (input.allowScopeExpansion && input.expandedCapacity && (capacity.expansionOpportunities || []).length > 0) {
    effMin = Math.max(effMin, input.expandedCapacity.recommendedMinMs || 0);
    effMax = Math.max(effMax, input.expandedCapacity.recommendedMaxMs || 0);
    expanded = true;
  }

  // Normalize user target per mode.
  let target = null;
  if (durationMode === "AUTO") {
    target = null;
  } else if (durationMode === "APPROXIMATE_TARGET") {
    const pref = input.userTarget && input.userTarget.preferredMs;
    if (pref === undefined) throw new Error("INVALID_INPUT: APPROXIMATE_TARGET requires userTarget.preferredMs");
    const tol = (input.userTarget && input.userTarget.tolerancePercent !== undefined)
      ? input.userTarget.tolerancePercent : 10;
    assertTargetOrdering({ minMs: 0, preferredMs: pref, maxMs: pref });
    if (pref < 0) throw new Error("NEGATIVE_DURATION: preferredMs must be >= 0");
    target = { minMs: Math.round(pref * (1 - tol / 100)), preferredMs: pref, maxMs: Math.round(pref * (1 + tol / 100)), tolerancePercent: tol };
  } else {
    target = { ...(input.userTarget || {}) };
    assertTargetOrdering(target);
  }

  const policy = {
    allowScopeExpansion: input.allowScopeExpansion === true,
    fillerForbidden: true,
  };

  if (capacity.status === "UNCERTAIN") {
    return {
      version: "1.0.0", projectId, platform, durationMode,
      ...(target ? { userTarget: input.userTarget } : {}),
      contentCapacity: capacity,
      workingDuration: { minMs: effMin, preferredMs: midpoint(effMin, effMax), maxMs: effMax, derivedFrom: "content-capacity (uncertain)", confidence: "LOW" },
      scriptBudget: estimateScriptBudget({ workingDuration: { minMs: effMin, preferredMs: midpoint(effMin, effMax), maxMs: effMax } }, input.contentMode),
      policy,
      status: "RESEARCH_INCOMPLETE",
    };
  }

  if (durationMode === "AUTO") {
    return {
      version: "1.0.0", projectId, platform, durationMode,
      contentCapacity: capacity,
      workingDuration: { minMs: effMin, preferredMs: midpoint(effMin, effMax), maxMs: effMax, derivedFrom: "content-capacity", confidence: "MEDIUM" },
      scriptBudget: estimateScriptBudget({ workingDuration: { minMs: effMin, preferredMs: midpoint(effMin, effMax), maxMs: effMax } }, input.contentMode),
      policy,
      status: "FIT",
    };
  }

  if (durationMode === "HARD_LIMIT") {
    const max = target.maxMs;
    if (max === undefined) throw new Error("INVALID_INPUT: HARD_LIMIT requires userTarget.maxMs");
    if (effMin > max) {
      return {
        version: "1.0.0", projectId, platform, durationMode, userTarget: input.userTarget,
        contentCapacity: capacity,
        workingDuration: { minMs: Math.min(effMin, max), preferredMs: max, maxMs: max, derivedFrom: "hard-limit", confidence: "MEDIUM" },
        scriptBudget: estimateScriptBudget({ workingDuration: { minMs: Math.min(effMin, max), preferredMs: max, maxMs: max } }, input.contentMode),
        policy,
        status: "HARD_LIMIT_REQUIRES_COMPRESSION",
        resolution: { decision: "prioritize-and-cut", note: "Prioritize core promise; cut tangents; never fabricate or speed unnaturally.", prioritization: true },
      };
    }
    const pref = Math.min(target.preferredMs !== undefined ? target.preferredMs : max, max);
    return {
      version: "1.0.0", projectId, platform, durationMode, userTarget: input.userTarget,
      contentCapacity: capacity,
      workingDuration: { minMs: Math.min(effMin, max), preferredMs: pref, maxMs: max, derivedFrom: "hard-limit", confidence: "HIGH" },
      scriptBudget: estimateScriptBudget({ workingDuration: { minMs: Math.min(effMin, max), preferredMs: pref, maxMs: max } }, input.contentMode),
      policy,
      status: "FIT",
    };
  }

  // FLEXIBLE_TARGET / APPROXIMATE_TARGET fit analysis.
  const tMin = target.minMs !== undefined ? target.minMs : target.preferredMs;
  const tMax = target.maxMs !== undefined ? target.maxMs : target.preferredMs;
  const tPref = target.preferredMs !== undefined ? target.preferredMs : midpoint(tMin, tMax);

  if (tMin > effMax) {
    return {
      version: "1.0.0", projectId, platform, durationMode, userTarget: input.userTarget,
      contentCapacity: capacity,
      workingDuration: { minMs: effMin, preferredMs: midpoint(effMin, effMax), maxMs: effMax, derivedFrom: expanded ? "content-capacity (evidence-backed expansion)" : "content-capacity", confidence: "MEDIUM" },
      scriptBudget: estimateScriptBudget({ workingDuration: { minMs: effMin, preferredMs: midpoint(effMin, effMax), maxMs: effMax } }, input.contentMode),
      policy,
      status: "TARGET_TOO_LONG_FOR_CONTENT",
      resolution: { decision: expanded ? "evidence-backed-expansion" : "shorter-final", note: expanded ? "Valid adjacent sub-questions extend capacity." : "Ship shorter; no filler, no unsupported expansion." },
    };
  }
  if (tMax < effMin) {
    return {
      version: "1.0.0", projectId, platform, durationMode, userTarget: input.userTarget,
      contentCapacity: capacity,
      workingDuration: { minMs: tMin, preferredMs: tPref, maxMs: tMax, derivedFrom: "user-target (prioritized)", confidence: "MEDIUM" },
      scriptBudget: estimateScriptBudget({ workingDuration: { minMs: tMin, preferredMs: tPref, maxMs: tMax } }, input.contentMode),
      policy,
      status: "TARGET_TOO_SHORT_FOR_CONTENT",
      resolution: { decision: "prioritize-or-split", note: "Prioritize core promise; defer secondary examples; optionally recommend Part 2.", prioritization: true, recommendedSplit: true },
    };
  }
  const wMin = Math.max(tMin, effMin);
  const wMax = Math.min(tMax, effMax);
  const wPref = Math.min(Math.max(tPref, wMin), wMax);
  return {
    version: "1.0.0", projectId, platform, durationMode, userTarget: input.userTarget,
    contentCapacity: capacity,
    workingDuration: { minMs: wMin, preferredMs: wPref, maxMs: wMax, derivedFrom: "target-capacity-overlap", confidence: "HIGH" },
    scriptBudget: estimateScriptBudget({ workingDuration: { minMs: wMin, preferredMs: wPref, maxMs: wMax } }, input.contentMode),
    policy,
    status: "FIT",
  };
}

/**
 * estimateScriptBudget({ workingDuration }, contentMode?) → scriptBudget.
 * Words derived from mode-appropriate speaking rates (planning only).
 */
function estimateScriptBudget(contractLike, contentMode) {
  const wd = contractLike.workingDuration;
  const key = (contentMode || "default").toLowerCase();
  const rate = SPEAKING_RATE_DEFAULTS[key] || SPEAKING_RATE_DEFAULTS.default;
  const wpmMid = (rate.wpmMin + rate.wpmMax) / 2;
  const wordsFor = (ms) => Math.round(ms / 60000 * wpmMid);
  return {
    estimatedWordsMin: wordsFor(wd.minMs),
    estimatedWordsMax: wordsFor(wd.maxMs),
    estimatedNarrationMs: Math.round(wordsFor(wd.preferredMs) / wpmMid * 60000),
    speakingRateAssumption: `${rate.wpmMin}-${rate.wpmMax} wpm`,
    rateSource: `content-mode default: ${rate.label}`,
    timingStatus: "PLANNED",
  };
}

function validateDurationContract(contract) {
  return require("./duration-check").validateDurationContract(contract);
}

module.exports = { resolveDurationContract, estimateScriptBudget, validateDurationContract, SPEAKING_RATE_DEFAULTS };
