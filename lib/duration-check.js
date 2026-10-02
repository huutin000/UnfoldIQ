"use strict";

/**
 * UNFOLDIQ duration semantic validation (STEP 10A-FIX). Executable rules.
 * Pure/deterministic; no web, no LLM, no randomness.
 */

function err(code, message) {
  return { code, message };
}

function isNonNegInt(v) {
  return Number.isInteger(v) && v >= 0;
}

/**
 * validateDurationContract(contract) → { valid, errors[], warnings[] }
 * - target ordering / negatives
 * - UNCERTAIN cannot claim FIT
 * - FIT while target exceeds capacity → TOO_LONG_UNRESOLVED
 * - TOO_SHORT without prioritization resolution → TOO_SHORT_UNRESOLVED
 * - script estimate outside working range → SCRIPT_ESTIMATE_CONFLICT
 */
function validateDurationContract(contract) {
  const errors = [];
  const warnings = [];
  if (!contract || typeof contract !== "object") {
    return { valid: false, errors: [err("INVALID_CONTRACT_SHAPE", "Contract must be an object")], warnings };
  }

  const t = contract.userTarget;
  if (t) {
    for (const k of ["minMs", "preferredMs", "maxMs"]) {
      if (t[k] !== undefined && !isNonNegInt(t[k])) {
        errors.push(err("NEGATIVE_DURATION", `userTarget.${k} must be a non-negative integer`));
      }
    }
    if (t.minMs !== undefined && t.maxMs !== undefined && t.minMs > t.maxMs) {
      errors.push(err("TARGET_ORDER_INVALID", "userTarget.minMs must be <= userTarget.maxMs"));
    }
    if (t.minMs !== undefined && t.preferredMs !== undefined && t.minMs > t.preferredMs) {
      errors.push(err("TARGET_ORDER_INVALID", "userTarget.minMs must be <= userTarget.preferredMs"));
    }
    if (t.preferredMs !== undefined && t.maxMs !== undefined && t.preferredMs > t.maxMs) {
      errors.push(err("TARGET_ORDER_INVALID", "userTarget.preferredMs must be <= userTarget.maxMs"));
    }
  }

  const cap = contract.contentCapacity;
  if (!cap) {
    errors.push(err("CAPACITY_MISSING", "contentCapacity is required"));
    return { valid: false, errors, warnings };
  }
  if (!cap.basis) errors.push(err("CAPACITY_BASIS_MISSING", "capacity must cite meaningful editorial units, never raw search volume"));

  if (cap.status === "UNCERTAIN" && contract.status === "FIT") {
    errors.push(err("UNCERTAIN_FIT", "UNCERTAIN content capacity cannot claim FIT"));
  }

  // FIT while target range sits entirely above capacity → unresolved too-long.
  if (contract.status === "FIT" && t && t.minMs !== undefined && cap.recommendedMaxMs !== undefined && t.minMs > cap.recommendedMaxMs) {
    errors.push(err("TOO_LONG_UNRESOLVED", "FIT claimed while target exceeds capacity with no valid expansion: filler forbidden"));
  }

  // TOO_SHORT requires a prioritization/compression resolution.
  if (contract.status === "TARGET_TOO_SHORT_FOR_CONTENT") {
    const r = contract.resolution || {};
    const hasOmissions = (cap.omissionCandidates || []).length > 0;
    if (!r.prioritization && !r.recommendedSplit && !hasOmissions) {
      errors.push(err("TOO_SHORT_UNRESOLVED", "TARGET_TOO_SHORT_FOR_CONTENT requires prioritization/split/omission resolution"));
    }
  }

  // Script estimate outside working range → review/conflict.
  const sb = contract.scriptBudget;
  const wd = contract.workingDuration;
  if (sb && wd && typeof sb.estimatedNarrationMs === "number") {
    if (sb.estimatedNarrationMs < wd.minMs || sb.estimatedNarrationMs > wd.maxMs) {
      errors.push(err("SCRIPT_ESTIMATE_CONFLICT", `script estimate ${sb.estimatedNarrationMs}ms outside working range ${wd.minMs}-${wd.maxMs}ms: review required`));
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

const EXPLICIT_TAIL_KINDS = ["outro", "musicTail"];
const PADDING_KINDS = ["padding", "black", "silence", "gap", "filler"];
const MAX_EXPLICIT_TAIL_MS = 30000;

/**
 * validateTimeline({ items: [{ id, endMs, kind, purpose?, durationMs? }] })
 * → { valid, errors[], warnings[], actualTimelineEndMs }
 * actualTimelineEndMs = max end of non-padding items. Anonymous padding
 * rejected; explicit outro/musicTail with purpose + bounded duration allowed.
 */
function validateTimeline(timeline) {
  const errors = [];
  const warnings = [];
  if (!timeline || !Array.isArray(timeline.items)) {
    return { valid: false, errors: [err("INVALID_TIMELINE_SHAPE", "Timeline must carry items[]")], warnings, actualTimelineEndMs: 0 };
  }
  let actual = 0;
  for (const item of timeline.items) {
    const kind = item.kind || "unknown";
    if (PADDING_KINDS.includes(kind)) {
      errors.push(err("ANONYMOUS_PADDING", `Anonymous padding item rejected: ${item.id || kind}`));
      continue;
    }
    if (EXPLICIT_TAIL_KINDS.includes(kind)) {
      if (!item.purpose) {
        errors.push(err("ANONYMOUS_PADDING", `Tail item without content purpose rejected: ${item.id || kind}`));
        continue;
      }
      const dur = item.durationMs !== undefined ? item.durationMs : item.endMs;
      if (typeof dur === "number" && dur > MAX_EXPLICIT_TAIL_MS) {
        errors.push(err("UNBOUNDED_TAIL", `Explicit tail exceeds bounded duration: ${item.id || kind}`));
        continue;
      }
    }
    if (typeof item.endMs === "number") actual = Math.max(actual, item.endMs);
  }
  return { valid: errors.length === 0, errors, warnings, actualTimelineEndMs: actual };
}

/**
 * validateFinalDuration({ finalDurationMs, actualTimelineEndMs, target?, durationMode?, resolution? })
 * Final must not exceed the actual timeline end to satisfy a target.
 * Flexible deviation outside target is allowed only with documented resolution.
 */
function validateFinalDuration(input) {
  const errors = [];
  const warnings = [];
  const { finalDurationMs, actualTimelineEndMs } = input;
  if (typeof finalDurationMs !== "number" || finalDurationMs < 0) {
    errors.push(err("NEGATIVE_DURATION", "finalDurationMs must be >= 0"));
    return { valid: false, errors, warnings };
  }
  if (typeof actualTimelineEndMs === "number" && finalDurationMs > actualTimelineEndMs) {
    errors.push(err("FINAL_EXCEEDS_TIMELINE", `final ${finalDurationMs}ms exceeds actual timeline end ${actualTimelineEndMs}ms: black-tail padding forbidden`));
  }
  const t = input.target;
  const flexible = !input.durationMode || input.durationMode === "FLEXIBLE_TARGET" || input.durationMode === "APPROXIMATE_TARGET";
  if (t && flexible && (finalDurationMs < (t.minMs !== undefined ? t.minMs : 0) || (t.maxMs !== undefined && finalDurationMs > t.maxMs))) {
    const r = input.resolution || {};
    if (!r.decision && !r.note) {
      errors.push(err("FLEXIBLE_DEVIATION_UNDOCUMENTED", "final outside flexible target requires documented no-filler resolution"));
    } else {
      warnings.push(err("FLEXIBLE_DEVIATION_OK", "final outside flexible target accepted with documented resolution"));
    }
  }
  return { valid: errors.length === 0, errors, warnings };
}

/**
 * validateVideoSpecDuration({ targetDurationMs?, estimatedDurationMs?, durationMs?, durationSource?, renderReady? })
 * Render-ready final spec requires MEASURED_TIMELINE; target/estimated/actual stay distinct.
 */
function validateVideoSpecDuration(spec) {
  const errors = [];
  const warnings = [];
  if (!spec || typeof spec !== "object") {
    return { valid: false, errors: [err("INVALID_SPEC_SHAPE", "Video spec duration block must be an object")], warnings };
  }
  if (spec.renderReady === true) {
    if (spec.durationSource !== "MEASURED_TIMELINE") {
      errors.push(err("RENDER_SOURCE_NOT_MEASURED", "render-ready final spec requires durationSource MEASURED_TIMELINE"));
    }
    if (typeof spec.durationMs !== "number" || spec.durationMs <= 0) {
      errors.push(err("RENDER_DURATION_MISSING", "render-ready final spec requires durationMs"));
    }
  } else if (spec.durationSource && !["MEASURED_TIMELINE", "PLANNED"].includes(spec.durationSource)) {
    errors.push(err("INVALID_DURATION_SOURCE", "durationSource must be MEASURED_TIMELINE or PLANNED"));
  }
  return { valid: errors.length === 0, errors, warnings };
}

/**
 * checkAiVideoBoundary({ sceneDurationMs, aiVideoMs }) → { valid, errors[] }
 * AI-video duration must not be inferred as the total scene/video duration.
 */
function checkAiVideoBoundary(input) {
  const errors = [];
  if (typeof input.sceneDurationMs !== "number" || typeof input.aiVideoMs !== "number") {
    return { valid: false, errors: [err("INVALID_AI_BOUNDARY_INPUT", "sceneDurationMs and aiVideoMs required")] };
  }
  if (input.aiVideoMs >= input.sceneDurationMs && input.treatsAiAsTotal === true) {
    errors.push(err("AI_DURATION_EQUALS_TOTAL", "AI-video duration must not be inferred as total scene/video duration"));
  }
  return { valid: errors.length === 0, errors };
}

module.exports = {
  validateDurationContract,
  validateTimeline,
  validateFinalDuration,
  validateVideoSpecDuration,
  checkAiVideoBoundary,
};
