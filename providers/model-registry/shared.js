"use strict";

/**
 * 1G.6 model-registry shared vocabulary (PHASE 1G.6, Prompt 01).
 *
 * Canonical capability values are the 1G.5 vocabulary, verbatim — never
 * renamed. Provider workflow names (Text to Video, Frames to Video, ...)
 * map to these canonical values explicitly inside registry data, not by
 * renaming upstream fields.
 *
 * No model facts live here: only enums, normalization, hashing, and the
 * 1G.5→registry requirement bridge. No generation, no credits spent.
 */

const crypto = require("crypto");
const { stableStringify } = require("../runtime/request-fingerprint.js");

const REGISTRY_VERSION = "1.0.0";
const RESOLVER_VERSION = "1.0.0";
const RESOLVER_POLICY_VERSION = "model-resolution-policy-1.0.0";

const CANONICAL_CAPABILITIES = [
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

const SUPPORT_STATES = ["SUPPORTED", "UNSUPPORTED", "UNKNOWN", "CONFLICT"];
const AVAILABILITY_STATES = ["AVAILABLE", "UNAVAILABLE", "UNKNOWN"];
const FRESHNESS_STATES = ["FRESH", "STALE", "UNKNOWN"];
const SURFACE_STATUS = ["AVAILABLE", "UNAVAILABLE", "UNKNOWN"];

const SOURCE_TYPES = [
  "OFFICIAL_PROVIDER_DOC",
  "OFFICIAL_PROVIDER_UI_OBSERVATION",
  "OFFICIAL_PROVIDER_API_METADATA",
  "REPOSITORY_CONFIG",
  "OPERATOR_INPUT",
];

const COST_UNITS = [
  "credits_per_generation",
  "currency_per_generation",
  "credits_per_upscale",
];

/** Render mode → the canonical workflow capabilities it implies. */
const RENDER_MODE_WORKFLOWS = {
  STATIC_IMAGE: ["IMAGE_GENERATION"],
  REMOTION_MOTION: ["IMAGE_GENERATION"],
  VEO_FIRST_FRAME: ["VIDEO_GENERATION", "IMAGE_TO_VIDEO"],
  VEO_FIRST_LAST: ["VIDEO_GENERATION", "IMAGE_TO_VIDEO", "FIRST_LAST_FRAME_VIDEO"],
  VEO_REFERENCE: ["VIDEO_GENERATION", "IMAGE_TO_VIDEO", "REFERENCE_GUIDED_VIDEO"],
};

function hash16(value) {
  return crypto.createHash("sha256").update(stableStringify(value), "utf8").digest("hex").slice(0, 16);
}

function id12(prefix, value) {
  return `${prefix}-${crypto.createHash("sha256").update(stableStringify(value), "utf8").digest("hex").slice(0, 12)}`;
}

/**
 * Stable internal model ID from family + version labels. Display
 * punctuation/casing never leaks into identity: normalized lowercase,
 * non-alphanumerics collapse to single dashes.
 */
function stableModelId(providerId, family, versionOrTier) {
  const slug = (s) => String(s || "unknown")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
  return `${providerId}--${slug(family)}--${slug(versionOrTier)}`;
}

function normalizeOrientation(value) {
  if (value === null || value === undefined) return null;
  const v = String(value).trim();
  if (v === "16:9" || v.toLowerCase() === "landscape") return "LANDSCAPE_OUTPUT";
  if (v === "9:16" || v.toLowerCase() === "portrait") return "PORTRAIT_OUTPUT";
  return v; // unknown aspect: preserved verbatim for the validator to reject
}

module.exports = {
  REGISTRY_VERSION,
  RESOLVER_VERSION,
  RESOLVER_POLICY_VERSION,
  CANONICAL_CAPABILITIES,
  SUPPORT_STATES,
  AVAILABILITY_STATES,
  FRESHNESS_STATES,
  SURFACE_STATUS,
  SOURCE_TYPES,
  COST_UNITS,
  RENDER_MODE_WORKFLOWS,
  hash16,
  id12,
  stableModelId,
  normalizeOrientation,
  stableStringify,
};
