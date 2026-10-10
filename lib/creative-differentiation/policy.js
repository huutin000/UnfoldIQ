"use strict";

/**
 * Phase 6B — versioned policy (UNFOLDIQ CORE).
 *
 * Every constant here is POLICY, not platform law. The bake-off caps are a V1
 * default (not a YouTube limit); originality thresholds feed review signals, never
 * a monetization verdict; the rubric never uses a magic aggregate cutoff.
 */

const POLICY_VERSION = "1.0.0";
const FINGERPRINT_VERSION = "2.0.0";
const COMPARATOR_VERSION = "1.0.0";
const RUBRIC_VERSION = "1.0.0";

const ZERO_COST = Object.freeze({
  PHASE_6B_EXTERNAL_PAID_BUDGET_VND: 0,
  PAID_API_ALLOWED: false,
  AUTO_UPGRADE_TO_PAID: false,
  PAID_MEDIA_GENERATION_ALLOWED: false,
  PUBLISH_UPLOAD_ALLOWED: false,
});

const BAKEOFF_POLICY = Object.freeze({
  maxCandidateVariantsPerDecision: 2,
  maxCandidateVariantsHard: 3,
  maxActiveDecisionsPerPilot: 1,
  maxSegmentPreviewRenders: 1,
  maxPreviewShareOfVideo: 0.35,
  paidMediaCalls: 0,
  distinctnessJaccardMax: 0.8,
  materialKinds: ["HOOK_VISUAL_SEQUENCE", "DENSE_DIAGRAM", "PAYOFF_DELIVERY", "OPENING_STRUCTURE", "REVEAL_TREATMENT"],
});

const BAKEOFF_CRITERIA = Object.freeze([
  "factualFidelity", "clarity", "storyPurpose", "visualReadability", "pacing",
  "styleConsistency", "originalityContribution", "costLatency", "accessibility",
]);

const ORIGINALITY_POLICY = Object.freeze({
  // substance
  scriptShingleSize: 4,
  nearDuplicateShingleJaccard: 0.6,
  nearDuplicateSemanticJaccard: 0.7,
  sameClaimsJaccard: 0.6,
  sameThesisJaccard: 0.6,
  // structure (sequence similarity 0..1)
  structuralSimilarityHigh: 0.85,
  structuralFamiliesForTemplateRisk: 3,
  thinNewSubstanceShare: 0.3,
  // single-video internal repetition
  transitionOveruseShare: 0.4,
  transitionOveruseMinBeats: 4,
  internalBeatDuplicateJaccard: 0.6,
  slideshowStaticShare: 0.9,
  slideshowMinShots: 6,
  // channel-level evidence needs representative REAL episodes
  minRealEpisodesForChannelLevel: 5,
  durationBucketMs: 1000,
});

module.exports = {
  POLICY_VERSION, FINGERPRINT_VERSION, COMPARATOR_VERSION, RUBRIC_VERSION,
  ZERO_COST, BAKEOFF_POLICY, BAKEOFF_CRITERIA, ORIGINALITY_POLICY,
};
