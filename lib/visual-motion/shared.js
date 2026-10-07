"use strict";

/**
 * UNFOLDIQ Visual/Motion Decision shared vocabulary (1G.5, Prompt 01).
 *
 * Canonical recommendation enum is provider-neutral on purpose: the engine
 * never assumes generated motion comes from any specific vendor. Legacy
 * VEO_* labels (absent from this repo — verified by audit) are accepted on
 * INPUT via LEGACY_ALIAS and always normalized to canonical on output.
 *
 * No model names, no credit prices, no variant counts anywhere in this file.
 */

const crypto = require("crypto");
const { stableStringify } = require("../../providers/runtime/request-fingerprint.js");

const DECISION_VERSION = "1.0.0";
const DECISION_POLICY_VERSION = "visual-motion-policy-1.0.0";

const RECOMMENDATIONS = [
  "STATIC_IMAGE",
  "EDITOR_MOTION",
  "GENERATED_MOTION_CANDIDATE",
  "GENERATED_MOTION_RECOMMENDED",
];

/** Forward-compat only: legacy artifacts may carry VEO_* labels. */
const LEGACY_ALIAS = {
  VEO_CANDIDATE: "GENERATED_MOTION_CANDIDATE",
  VEO_RECOMMENDED: "GENERATED_MOTION_RECOMMENDED",
};

const VISUAL_TYPES = [
  "CHARACTER_SCENE",
  "ENVIRONMENT",
  "EVIDENCE",
  "DIAGRAM",
  "MAP",
  "OBJECT",
  "COMPARISON",
  "TIMELINE",
];

/**
 * Canonical Visual Story Grammar modalities (FIX 1, Stage A). visualType is
 * the broad content/asset category; visualModality is the storytelling form
 * chosen to communicate the beat. Never conflated (see grammar.js).
 */
const VISUAL_MODALITIES = [
  "MAP",
  "TIMELINE",
  "CHART",
  "DIAGRAM",
  "TYPOGRAPHY",
  "COMPARISON",
  "RECONSTRUCTION",
  "CHARACTER_MOMENT",
  "ATMOSPHERE",
  "METAPHOR",
  "ANNOTATION",
  "SPLIT_SCREEN",
  "MOTION_GRAPHIC",
];

/**
 * Canonical render modes (FIX 1, Stage B). VEO_* names describe the
 * generation/render WORKFLOW FAMILY (start frame / first+last / reference) —
 * never a model selection (1G.6 owns models). REMOTION_MOTION is the
 * deterministic editor-motion workflow; STATIC_IMAGE needs no motion render.
 */
const RENDER_MODES = [
  "STATIC_IMAGE",
  "REMOTION_MOTION",
  "VEO_FIRST_FRAME",
  "VEO_FIRST_LAST",
  "VEO_REFERENCE",
];

/** Modalities whose honest expression caps the production strategy. */
const MODALITY_STRATEGY_CAP = {
  CHART: "EDITOR_MOTION", // numbers/trends: still or deterministic animation
  TYPOGRAPHY: "EDITOR_MOTION", // text-as-visual: still or kinetic type
  SPLIT_SCREEN: "EDITOR_MOTION", // side-by-side: deterministic composition
};

const MOTION_NEEDS = ["NONE", "LOW", "MEDIUM", "HIGH"];

const CAPABILITY_ALLOWLIST = [
  "IMAGE_GENERATION",
  "IMAGE_REFERENCE",
  "IMAGE_EDITING",
  "VIDEO_GENERATION",
  "IMAGE_TO_VIDEO",
  "FIRST_LAST_FRAME_VIDEO",
  "REFERENCE_GUIDED_VIDEO",
  "PORTRAIT_OUTPUT",
  "LANDSCAPE_OUTPUT",
];

const ASSET_ROLES = [
  "PRIMARY_IMAGE",
  "START_FRAME",
  "END_FRAME",
  "CHARACTER_REFERENCE",
  "ENVIRONMENT_REFERENCE",
  "OBJECT_REFERENCE",
  "BACKGROUND_LAYER",
  "FOREGROUND_LAYER",
  "MAP_BASE",
  "DIAGRAM_BASE",
  "TEXTURE_LAYER",
];

const REFERENCE_STRATEGIES = [
  "NONE",
  "START_FRAME_REQUIRED",
  "END_FRAME_INCLUDED",
  "REFERENCE_GUIDED",
  "TEXT_BASED",
];

const STATUSES = [
  "DECISION_READY",
  "DECISION_REVIEW_REQUIRED",
  "BLOCKED_MISSING_REFERENCE",
  "BLOCKED_STALE_INPUT",
  "BLOCKED_INVALID_OVERRIDE",
  "STALE",
];

/** Cheapest-adequate order: index 0 is cheapest. */
const COST_ORDER = {
  STATIC_IMAGE: 0,
  EDITOR_MOTION: 1,
  GENERATED_MOTION_CANDIDATE: 2,
  GENERATED_MOTION_RECOMMENDED: 3,
};

const COST_CLASS = {
  STATIC_IMAGE: "LOW",
  EDITOR_MOTION: "LOW",
  GENERATED_MOTION_CANDIDATE: "MEDIUM",
  GENERATED_MOTION_RECOMMENDED: "HIGH",
};

function hash16(value) {
  return crypto.createHash("sha256").update(stableStringify(value), "utf8").digest("hex").slice(0, 16);
}

function id12(prefix, value) {
  return `${prefix}-${crypto.createHash("sha256").update(stableStringify(value), "utf8").digest("hex").slice(0, 12)}`;
}

/** Normalize a caller/legacy label to the canonical enum (null when absent). */
function normalizeRecommendation(value) {
  if (value === null || value === undefined) return null;
  if (LEGACY_ALIAS[value]) return LEGACY_ALIAS[value];
  if (RECOMMENDATIONS.includes(value)) return value;
  return value; // unknown: returned as-is so the validator can reject it
}

/** Normalize a caller modality label (null when absent; as-is when unknown). */
function normalizeModality(value) {
  if (value === null || value === undefined) return null;
  if (VISUAL_MODALITIES.includes(value)) return value;
  return value;
}

/**
 * Canonical platform composition is CONSUMED from the platform profile owner
 * (platforms/<platform>/PROFILE.yaml) — never duplicated here.
 */
function readPlatformComposition(platform) {
  const fs = require("fs");
  const path = require("path");
  if (!platform || !["youtube", "tiktok"].includes(platform)) return null;
  try {
    const yaml = require("js-yaml");
    const profile = yaml.load(fs.readFileSync(
      path.join(__dirname, "..", "..", "platforms", platform, "PROFILE.yaml"), "utf8"));
    const orientation = (profile && profile.projectDefaults && profile.projectDefaults.orientation)
      || (profile && profile.platformFacts && profile.platformFacts.preferredOrientation) || null;
    const aspectRatio = (profile && profile.platformFacts && profile.platformFacts.standardAspectRatio)
      || (profile && profile.projectDefaults && profile.projectDefaults.aspectRatio) || null;
    return {
      platform,
      orientation,
      aspectRatio,
      orientationCapability: orientation === "portrait" ? "PORTRAIT_OUTPUT"
        : orientation === "landscape" ? "LANDSCAPE_OUTPUT" : null,
      source: `platforms/${platform}/PROFILE.yaml`,
    };
  } catch {
    return null;
  }
}

module.exports = {
  DECISION_VERSION,
  DECISION_POLICY_VERSION,
  RECOMMENDATIONS,
  LEGACY_ALIAS,
  VISUAL_TYPES,
  VISUAL_MODALITIES,
  RENDER_MODES,
  MODALITY_STRATEGY_CAP,
  MOTION_NEEDS,
  CAPABILITY_ALLOWLIST,
  ASSET_ROLES,
  REFERENCE_STRATEGIES,
  STATUSES,
  COST_ORDER,
  COST_CLASS,
  hash16,
  id12,
  normalizeRecommendation,
  normalizeModality,
  readPlatformComposition,
};
