"use strict";

/**
 * Phase 3B §7–§8, §17–§29 — Versioned Motion Grammar Policy.
 *
 * Policy, not heuristics soup. Decides presence/purpose, guards repetition,
 * visual rest/coverage, caption restraint, chart semantics, flash safety and
 * motion-blur cost. All functions are pure + deterministic.
 */

const MOTION_GRAMMAR_POLICY_VERSION = "1.0.0";

const PRESENCE = ["STATIC", "SUBTLE", "ACTIVE", "FEATURED"];

const MOTION_PURPOSES = [
  "DIRECT_ATTENTION",
  "REVEAL_INFORMATION",
  "EMPHASIZE",
  "ESTABLISH_DEPTH",
  "FOLLOW_SUBJECT",
  "EXPLAIN_STRUCTURE",
  "SHOW_CHANGE",
  "TRANSITION_CONTEXT",
  "BUILD_ENERGY",
  "REDUCE_MONOTONY",
  "VISUAL_REST",
];

const CUT_MOTIVATIONS = [
  "NEW_INFORMATION",
  "CHANGE_OF_SUBJECT",
  "CHANGE_OF_LOCATION",
  "CHANGE_OF_TIME",
  "EMPHASIS",
  "REACTION",
  "REVEAL",
  "CHAPTER_BOUNDARY",
  "RHYTHM_PACING",
  "VISUAL_CLARITY",
];

const FLASH_SAFETY_POLICY = {
  policyId: "flash-safety",
  version: "1.0.0",
  maxFlashesPerSecond: 3,
  redFlashConservativeReview: true,
};

const MOTION_BLUR_POLICY = {
  policyId: "motion-blur",
  version: "1.0.0",
  defaultEnabled: false,
  defaultSamples: 8,
  defaultShutterAngle: 180,
};

// --- Presence gate (§7–§8) ---
/**
 * signals: {
 *   purpose?, hasMotionPurpose?, intentionalRest?,
 *   sourceDynamic?, captionDensity? ("LOW"|"HIGH"|number),
 *   isChapterBoundary?, isMajorReveal?, energy? ("LOW"|"HIGH"),
 *   visualModality?, narrationIntroducesNew?
 * }
 */
function decidePresence(signals = {}) {
  const captionHigh = signals.captionDensity === "HIGH"
    || (typeof signals.captionDensity === "number" && signals.captionDensity >= 0.7);
  if (signals.intentionalRest === true) {
    return { presence: "STATIC", purpose: "VISUAL_REST", reason: "explicit intentional visual rest" };
  }
  if (!signals.hasMotionPurpose && !signals.purpose) {
    return { presence: "STATIC", purpose: null, reason: "NO VALID MOTION PURPOSE → STATIC (RULE 1)" };
  }
  const purpose = signals.purpose || null;
  if (purpose && !MOTION_PURPOSES.includes(purpose)) {
    return { presence: "STATIC", purpose: null, reason: `unknown purpose ${purpose} → STATIC (no invented motion)` };
  }
  if (signals.sourceDynamic === true && purpose !== "FOLLOW_SUBJECT" && purpose !== "EXPLAIN_STRUCTURE") {
    return { presence: "STATIC", purpose: purpose || "VISUAL_REST", reason: "already-dynamic source: no synthetic motion without purpose" };
  }
  if (captionHigh && (purpose === "REDUCE_MONOTONY" || purpose === "BUILD_ENERGY" || !purpose)) {
    return { presence: "STATIC", purpose: purpose || null, reason: "caption-heavy moment: motion restraint" };
  }
  if (signals.isChapterBoundary === true || signals.isMajorReveal === true) {
    return { presence: "FEATURED", purpose: purpose || "REVEAL_INFORMATION", reason: "chapter/major-reveal beat" };
  }
  if (purpose === "REDUCE_MONOTONY") {
    return { presence: "SUBTLE", purpose, reason: "REDUCE_MONOTONY alone never justifies more than SUBTLE" };
  }
  if (purpose === "VISUAL_REST") {
    return { presence: "STATIC", purpose, reason: "planned visual rest" };
  }
  if (["EMPHASIZE", "EXPLAIN_STRUCTURE", "SHOW_CHANGE", "BUILD_ENERGY"].includes(purpose)) {
    return { presence: "ACTIVE", purpose, reason: `purpose ${purpose} warrants ACTIVE treatment` };
  }
  return { presence: "SUBTLE", purpose: purpose || "DIRECT_ATTENTION", reason: "default subtle treatment for purposed motion" };
}

// --- Repetition / anti-template (§20) ---
function repetitionKey(item) {
  return [item.primitiveRef || "-", item.paramsDirection || "-", item.timingPresetRef || "-"].join("|");
}

/**
 * Scan ordered motion items for repeated primitive+direction+timing runs.
 * Returns finding descriptors (pure data; QA codes attached by motion-plan).
 */
function detectRepetition(items, windowSize = 4) {
  const findings = [];
  const keys = items.map(repetitionKey);
  for (let i = 0; i < keys.length; i++) {
    const win = keys.slice(Math.max(0, i - windowSize + 1), i + 1);
    if (win.length >= 3 && win.every((k) => k === win[0]) && win[0].split("|")[0] !== "-") {
      findings.push({ index: i, key: win[0], runLength: win.length });
    }
  }
  return findings;
}

// --- Caption-aware restraint (§25) ---
function captionRestraint(presence, captionDensity, purpose) {
  const high = captionDensity === "HIGH" || (typeof captionDensity === "number" && captionDensity >= 0.7);
  if (!high) return { ok: true, risk: false };
  if ((presence === "ACTIVE" || presence === "FEATURED")
    && (purpose === "REDUCE_MONOTONY" || purpose === "BUILD_ENERGY" || purpose === null)) {
    return { ok: false, risk: true, reason: "CAPTION_DISTRACTION_RISK: decorative motion over dense captions" };
  }
  return { ok: true, risk: false };
}

// --- Visual coverage (§22–§23) ---
/**
 * ranges: [{ startFrame, endFrameExclusive, hasVisual, intentionalRest?, reason? }]
 * → { ranges: [{...status}], unresolvedCount }
 */
function buildCoveragePlan(ranges = []) {
  const out = [];
  for (const r of ranges) {
    let status = "COVERED";
    if (r.hasVisual) status = "COVERED";
    else if (r.intentionalRest === true) status = "INTENTIONAL_VISUAL_REST";
    else status = "UNRESOLVED_REQUIRED_GAP";
    out.push({ ...r, status });
  }
  return { ranges: out, unresolvedCount: out.filter((r) => r.status === "UNRESOLVED_REQUIRED_GAP").length };
}

// --- Chart / diagram semantics (§24) ---
function validateChartSemantics(input = {}) {
  const errors = [];
  if (input.labelsHidden === true) errors.push("MISLEADING_CHART_ANIMATION: labels hidden during required reading");
  if (input.scaleChangedToDramatize === true) errors.push("MISLEADING_CHART_ANIMATION: scale changed to dramatize movement");
  if (input.reorderedCategories === true) errors.push("MISLEADING_CHART_ANIMATION: categorical values reordered decoratively");
  if (Array.isArray(input.narrationOrder) && Array.isArray(input.animationOrder)) {
    const a = input.narrationOrder.join("|");
    const b = input.animationOrder.join("|");
    if (a !== b) errors.push("MISLEADING_CHART_ANIMATION: animation order does not follow explanation order");
  }
  return { ok: errors.length === 0, errors };
}

// --- Flash safety (§28) ---
/**
 * flashes: [{ frame }] integer frames where a full-contrast flash/red-flash
 * occurs; frameRate {numerator, denominator}. Any sliding 1s window with
 * count > maxFlashesPerSecond → BLOCK.
 */
function validateFlashSafety({ flashes = [], frameRate = { numerator: 30, denominator: 1 }, mayFlash = false } = {}) {
  const fps = frameRate.numerator / frameRate.denominator;
  const sorted = flashes.map((f) => f.frame).filter(Number.isInteger).sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i++) {
    const windowEnd = sorted[i] + fps;
    let count = 0;
    for (let j = i; j < sorted.length && sorted[j] < windowEnd; j++) count++;
    if (count > FLASH_SAFETY_POLICY.maxFlashesPerSecond) {
      return { ok: false, decision: "BLOCK", reason: `FLASH_SAFETY_FAIL: ${count} flashes within 1s (policy max ${FLASH_SAFETY_POLICY.maxFlashesPerSecond})` };
    }
  }
  if (mayFlash && sorted.length > 0) {
    return { ok: true, decision: "REVIEW", reason: "FLASH_SAFETY_REVIEW: flash-capable effect with declared flashes inside policy" };
  }
  return { ok: true, decision: "PASS", reason: "flash safety PASS" };
}

// --- Motion blur (§27) ---
function decideMotionBlur({ primitiveRef, enabled = false, samples, shutterAngle, reason } = {}) {
  const primNeeds = ["PAN", "ZOOM", "PUSH", "PULL", "HANDHELD"];
  if (!enabled) {
    return { ok: true, motionBlur: { enabled: false }, note: "motion blur OFF by default" };
  }
  if (!primNeeds.includes(primitiveRef)) {
    return { ok: false, code: "MOTION_COST_REVIEW", message: `${primitiveRef} gains no material quality from motion blur` };
  }
  return {
    ok: true,
    motionBlur: {
      enabled: true,
      samples: samples || MOTION_BLUR_POLICY.defaultSamples,
      shutterAngle: shutterAngle || MOTION_BLUR_POLICY.defaultShutterAngle,
    },
    reason: reason || "fast transform with material quality gain",
  };
}

// --- Shot duration / cut density stats (§19, measurable, no invented budget) ---
function summarizeMotionStats(items, transitions, frameRate = { numerator: 30, denominator: 1 }) {
  const fps = frameRate.numerator / frameRate.denominator;
  const durations = items.map((it) => it.frameRange.endFrameExclusive - it.frameRange.startFrame);
  const totalFrames = durations.reduce((a, b) => a + b, 0);
  const minutes = totalFrames / fps / 60 || 1;
  const sorted = [...durations].sort((a, b) => a - b);
  const byPresence = {};
  const byPrimitive = {};
  for (const it of items) {
    byPresence[it.presence] = (byPresence[it.presence] || 0) + 1;
    if (it.primitiveRef) byPrimitive[it.primitiveRef] = (byPrimitive[it.primitiveRef] || 0) + 1;
  }
  return {
    itemCount: items.length,
    minFrames: sorted[0] ?? 0,
    medianFrames: sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0,
    maxFrames: sorted[sorted.length - 1] ?? 0,
    cutsPerMinute: Number((items.length / minutes).toFixed(2)),
    transitionsPerMinute: Number(((transitions || []).length / minutes).toFixed(2)),
    presenceDistribution: byPresence,
    primitiveDistribution: byPrimitive,
  };
}

module.exports = {
  MOTION_GRAMMAR_POLICY_VERSION,
  PRESENCE,
  MOTION_PURPOSES,
  CUT_MOTIVATIONS,
  FLASH_SAFETY_POLICY,
  MOTION_BLUR_POLICY,
  decidePresence,
  repetitionKey,
  detectRepetition,
  captionRestraint,
  buildCoveragePlan,
  validateChartSemantics,
  validateFlashSafety,
  decideMotionBlur,
  summarizeMotionStats,
};
