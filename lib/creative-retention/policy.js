"use strict";

/**
 * Phase 6A — versioned creative-analysis policy (UNFOLDIQ CORE).
 *
 * Thresholds are POLICY, not law: they are content-class aware (RULE 5/10),
 * versioned, and recorded in every report. No universal shot-duration quota,
 * no shock-hook requirement. Calm documentary hooks are valid.
 */

const POLICY_VERSION = "1.0.0";

const HOOK_CHECKPOINTS_MS = Object.freeze({ HOOK_5S: 5000, HOOK_15S: 15000, HOOK_30S: 30000 });

// Per hook class. setupMax15Ms: max setup-only time inside the 0–15s window.
// minNewInfo: distinct new content tokens expected by each checkpoint.
const HOOK_CLASS_POLICY = Object.freeze({
  DOCUMENTARY: { expects: ["SITUATION", "STAKES", "QUESTION"], setupMax5Ms: 4000, setupMax15Ms: 10000, minNewInfo: { 5: 2, 15: 6, 30: 12 }, forwardQuestionExpected: true, maxWps5: 3.6 },
  EXPLAINER: { expects: ["PROBLEM", "PREMISE", "PROMISED_UNDERSTANDING"], setupMax5Ms: 3500, setupMax15Ms: 8000, minNewInfo: { 5: 3, 15: 8, 30: 14 }, forwardQuestionExpected: true, maxWps5: 4.2 },
  TUTORIAL: { expects: ["OUTCOME", "PROBLEM", "RELEVANCE"], setupMax5Ms: 3500, setupMax15Ms: 7000, minNewInfo: { 5: 3, 15: 8, 30: 14 }, forwardQuestionExpected: false, maxWps5: 4.2 },
  STORY: { expects: ["CONFLICT", "UNUSUAL_STATE", "UNANSWERED_QUESTION"], setupMax5Ms: 4000, setupMax15Ms: 11000, minNewInfo: { 5: 2, 15: 6, 30: 11 }, forwardQuestionExpected: true, maxWps5: 3.8 },
  FICTION: { expects: ["CONFLICT", "UNUSUAL_STATE", "UNANSWERED_QUESTION"], setupMax5Ms: 4500, setupMax15Ms: 12000, minNewInfo: { 5: 1, 15: 5, 30: 10 }, forwardQuestionExpected: true, maxWps5: 3.8 },
  COMPARISON: { expects: ["SUBJECTS", "CRITERION", "OUTCOME"], setupMax5Ms: 3500, setupMax15Ms: 8000, minNewInfo: { 5: 3, 15: 8, 30: 14 }, forwardQuestionExpected: false, maxWps5: 4.2 },
  HYBRID: { expects: ["SITUATION", "QUESTION", "STAKES"], setupMax5Ms: 4000, setupMax15Ms: 10000, minNewInfo: { 5: 2, 15: 6, 30: 12 }, forwardQuestionExpected: true, maxWps5: 3.8 },
});

const HOOK_COMMON = Object.freeze({
  maxOpenLoops30: 3,
  maxOnScreenSimultaneous5: 3,
  maxNewInfo5: 16,
  titleEchoJaccard: 0.75,
  earlyPayoffVideoMinMs: 60000,
  earlyPayoffWindowMs: 15000,
  promiseCoverage: 0.6,
  mismatchCoverage: 0.6,
});

const BEAT_POLICY = Object.freeze({
  maxBeatMsByRole: { HOOK: 20000, DEFAULT: 40000, EXPLANATION: 45000, EVIDENCE: 45000, REFLECTION: 30000, CTA: 12000, OUTRO: 20000 },
  lowDensityPer10s: 3,
  excessMultiplier: 1.5,
  tooShortMs: 1500,
  tooShortMinWords: 8,
  redundancyJaccard: 0.6,
  redundancyMinTokens: 4,
  redundancyLookahead: 6,
  deadTimeMinMs: 4000,
  deadGapMinMs: 3000,
  loopResolveCoverage: 0.4,
  emotionRepeatRun: 3,
  energyRise: 0.1,
});

const RHYTHM_POLICY = Object.freeze({
  identicalDurationToleranceMs: 120,
  identicalDurationStreak: 4,
  rapidCutMs: 1200,
  rapidCutBurst: 4,
  longHoldMedianMultiple: 3,
  longHoldMinMs: 12000,
  sameMotionStreak: 4,
  sameDirectionStreak: 4,
  sameTimingStreak: 5,
  constantZoomMinShots: 6,
  constantZoomShare: 0.8,
  framingStreak: 4,
  mechanicalAlternationRun: 6,
  modalityMonotonyMinShots: 6,
  modalityMonotonyMinRoles: 3,
  veoConsecutive: 3,
  unjustifiedMotionShare: 0.25,
  captionCpsOverload: 17,
  captionMotionIntensity: 0.6,
  captionCutRatePerSec: 0.65,
  energyMismatchGap: 0.45,
  overScoredMusic: 0.7,
  overScoredNarrative: 0.3,
  underScoredPayoff: 0.2,
  sfxPerSecond: 0.5,
});

const WATCH_POLICY = Object.freeze({
  supplementWindowMs: 10000,
  contextBeats: 1,
  cognitiveChannelsHigh: 4,
  narrationWpsHigh: 3.2,
  captionCpsHigh: 17,
  motionHigh: 0.7,
  chartComplexityHigh: 0.7,
  redundancyChannels: 4,
  redundancyChannelsDense: 3,
  redundancyOverlap: 0.6,
  payoffMinMs: 2500,
  payoffEmphasisChannelsMin: 1,
  avEnergyGap: 0.5,
  outroMaxFlatMs: 12000,
  outroTailShare: 0.15,
  outroMinTailMs: 20000,
  coverageMinShare: 0.98,
});

module.exports = {
  POLICY_VERSION, HOOK_CHECKPOINTS_MS, HOOK_CLASS_POLICY, HOOK_COMMON, BEAT_POLICY, RHYTHM_POLICY, WATCH_POLICY,
};
