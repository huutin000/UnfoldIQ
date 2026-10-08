"use strict";

/**
 * Phase 3B §9–§10 — Versioned Motion Primitive Registry (UNFOLDIQ CORE).
 *
 * No unversioned primitive on the canonical production path. Every entry is
 * deterministic under (timeline, primitive version, params, seed, timebase);
 * random-looking primitives (HANDHELD, PARTICLES) REQUIRE a persisted seed —
 * no Math.random() on the production render path.
 *
 * Presentation (this registry) and timing (timing.js) are separate contracts
 * per market review (Remotion TransitionSeries presentation/from/timing).
 */

const REGISTRY_VERSION = "1.0.0";

function def(o) {
  return {
    primitiveId: o.primitiveId,
    version: o.version || "1.0.0",
    category: o.category,
    supportedAssetTypes: o.supportedAssetTypes || [],
    parameterSchemaRef: o.parameterSchemaRef,
    requiredParams: o.requiredParams || [],
    timingCapabilities: o.timingCapabilities || ["LINEAR", "EASING"],
    minDurationFrames: o.minDurationFrames,
    maxDurationFrames: o.maxDurationFrames,
    deterministic: true,
    requiresSeed: !!o.requiresSeed,
    supportsMotionBlur: !!o.supportsMotionBlur,
    renderCostClass: o.renderCostClass || "LOW",
    safety: o.safety || { mayFlash: false, mayCauseRapidMotion: false },
    fallbackPrimitiveId: o.fallbackPrimitiveId || null,
  };
}

// supportedAssetTypes use Master Timeline TRACK_TYPES vocabulary.
const PRIMITIVES = [
  // ---- CAMERA (§10.1) ----
  def({ primitiveId: "PAN", category: "CAMERA", supportedAssetTypes: ["VIDEO", "IMAGE", "MAP"], parameterSchemaRef: "motion/params/pan@1.0.0", requiredParams: ["fromX", "toX"], timingCapabilities: ["LINEAR", "EASING"], minDurationFrames: 12, supportsMotionBlur: true, renderCostClass: "LOW", safety: { mayFlash: false, mayCauseRapidMotion: false }, fallbackPrimitiveId: "CUT" }),
  def({ primitiveId: "ZOOM", category: "CAMERA", supportedAssetTypes: ["VIDEO", "IMAGE", "MAP", "CHART"], parameterSchemaRef: "motion/params/zoom@1.0.0", requiredParams: ["fromScale", "toScale"], timingCapabilities: ["LINEAR", "EASING"], minDurationFrames: 12, supportsMotionBlur: true, renderCostClass: "LOW", safety: { mayFlash: false, mayCauseRapidMotion: false }, fallbackPrimitiveId: "CUT" }),
  def({ primitiveId: "KEN_BURNS", category: "CAMERA", supportedAssetTypes: ["IMAGE"], parameterSchemaRef: "motion/params/ken-burns@1.0.0", requiredParams: ["fromScale", "toScale"], timingCapabilities: ["LINEAR", "EASING"], minDurationFrames: 24, supportsMotionBlur: false, renderCostClass: "LOW", safety: { mayFlash: false, mayCauseRapidMotion: false }, fallbackPrimitiveId: "ZOOM" }),
  def({ primitiveId: "PUSH", category: "CAMERA", supportedAssetTypes: ["VIDEO", "IMAGE"], parameterSchemaRef: "motion/params/push@1.0.0", requiredParams: ["fromScale", "toScale"], timingCapabilities: ["LINEAR", "EASING"], minDurationFrames: 12, supportsMotionBlur: true, renderCostClass: "LOW", safety: { mayFlash: false, mayCauseRapidMotion: false }, fallbackPrimitiveId: "ZOOM" }),
  def({ primitiveId: "PULL", category: "CAMERA", supportedAssetTypes: ["VIDEO", "IMAGE"], parameterSchemaRef: "motion/params/pull@1.0.0", requiredParams: ["fromScale", "toScale"], timingCapabilities: ["LINEAR", "EASING"], minDurationFrames: 12, supportsMotionBlur: true, renderCostClass: "LOW", safety: { mayFlash: false, mayCauseRapidMotion: false }, fallbackPrimitiveId: "ZOOM" }),
  def({ primitiveId: "HANDHELD", category: "CAMERA", supportedAssetTypes: ["VIDEO", "IMAGE"], parameterSchemaRef: "motion/params/handheld@1.0.0", requiredParams: ["seed", "amplitude"], requiresSeed: true, timingCapabilities: ["LINEAR"], minDurationFrames: 24, supportsMotionBlur: true, renderCostClass: "MEDIUM", safety: { mayFlash: false, mayCauseRapidMotion: true }, fallbackPrimitiveId: "PAN" }),
  // ---- DEPTH (§10.2) ----
  def({ primitiveId: "PARALLAX", category: "DEPTH", supportedAssetTypes: ["IMAGE", "VIDEO"], parameterSchemaRef: "motion/params/parallax@1.0.0", requiredParams: ["depthLayers"], timingCapabilities: ["LINEAR", "EASING"], minDurationFrames: 24, supportsMotionBlur: false, renderCostClass: "MEDIUM", safety: { mayFlash: false, mayCauseRapidMotion: false }, fallbackPrimitiveId: "PAN" }),
  // ---- REVEAL / FOCUS (§10.3) ----
  def({ primitiveId: "REVEAL", category: "REVEAL", supportedAssetTypes: ["IMAGE", "VIDEO", "OVERLAY", "TITLE", "CHART", "DIAGRAM"], parameterSchemaRef: "motion/params/reveal@1.0.0", requiredParams: ["direction"], timingCapabilities: ["LINEAR", "EASING"], minDurationFrames: 6, supportsMotionBlur: false, renderCostClass: "LOW", safety: { mayFlash: false, mayCauseRapidMotion: false }, fallbackPrimitiveId: "CUT" }),
  def({ primitiveId: "MASK_REVEAL", category: "REVEAL", supportedAssetTypes: ["IMAGE", "VIDEO", "OVERLAY", "TITLE"], parameterSchemaRef: "motion/params/mask-reveal@1.0.0", requiredParams: ["direction"], timingCapabilities: ["LINEAR", "EASING"], minDurationFrames: 6, supportsMotionBlur: false, renderCostClass: "LOW", safety: { mayFlash: false, mayCauseRapidMotion: false }, fallbackPrimitiveId: "REVEAL" }),
  def({ primitiveId: "BLUR_TO_FOCUS", category: "FOCUS", supportedAssetTypes: ["IMAGE", "VIDEO"], parameterSchemaRef: "motion/params/blur-to-focus@1.0.0", requiredParams: ["fromBlur"], timingCapabilities: ["LINEAR", "EASING"], minDurationFrames: 12, supportsMotionBlur: false, renderCostClass: "MEDIUM", safety: { mayFlash: false, mayCauseRapidMotion: false }, fallbackPrimitiveId: "REVEAL" }),
  def({ primitiveId: "FOCUS_TO_BLUR", category: "FOCUS", supportedAssetTypes: ["IMAGE", "VIDEO"], parameterSchemaRef: "motion/params/focus-to-blur@1.0.0", requiredParams: ["toBlur"], timingCapabilities: ["LINEAR", "EASING"], minDurationFrames: 12, supportsMotionBlur: false, renderCostClass: "MEDIUM", safety: { mayFlash: false, mayCauseRapidMotion: false }, fallbackPrimitiveId: "REVEAL" }),
  def({ primitiveId: "LIGHT_SWEEP", category: "EFFECT", supportedAssetTypes: ["IMAGE", "OVERLAY", "TITLE"], parameterSchemaRef: "motion/params/light-sweep@1.0.0", requiredParams: ["direction"], timingCapabilities: ["LINEAR", "EASING"], minDurationFrames: 12, maxDurationFrames: 90, supportsMotionBlur: false, renderCostClass: "MEDIUM", safety: { mayFlash: true, mayCauseRapidMotion: false }, fallbackPrimitiveId: "REVEAL" }),
  // ---- PARTICLES (§10.4) ----
  def({ primitiveId: "PARTICLES", category: "EFFECT", supportedAssetTypes: ["VIDEO", "IMAGE", "OVERLAY"], parameterSchemaRef: "motion/params/particles@1.0.0", requiredParams: ["seed", "density"], requiresSeed: true, timingCapabilities: ["LINEAR"], minDurationFrames: 24, supportsMotionBlur: false, renderCostClass: "HIGH", safety: { mayFlash: false, mayCauseRapidMotion: true }, fallbackPrimitiveId: "REVEAL" }),
  // ---- DATA / DIAGRAM (§10.5) ----
  def({ primitiveId: "CHART_REVEAL", category: "DATA", supportedAssetTypes: ["CHART"], parameterSchemaRef: "motion/params/chart-reveal@1.0.0", requiredParams: ["seriesOrder"], timingCapabilities: ["LINEAR", "EASING"], minDurationFrames: 12, supportsMotionBlur: false, renderCostClass: "LOW", safety: { mayFlash: false, mayCauseRapidMotion: false }, fallbackPrimitiveId: "REVEAL" }),
  def({ primitiveId: "CHART_HIGHLIGHT", category: "DATA", supportedAssetTypes: ["CHART"], parameterSchemaRef: "motion/params/chart-highlight@1.0.0", requiredParams: ["seriesId"], timingCapabilities: ["LINEAR", "EASING"], minDurationFrames: 6, supportsMotionBlur: false, renderCostClass: "LOW", safety: { mayFlash: false, mayCauseRapidMotion: false }, fallbackPrimitiveId: "REVEAL" }),
  def({ primitiveId: "DIAGRAM_STEP_REVEAL", category: "DATA", supportedAssetTypes: ["DIAGRAM", "MAP"], parameterSchemaRef: "motion/params/diagram-step@1.0.0", requiredParams: ["stepOrder"], timingCapabilities: ["LINEAR", "EASING"], minDurationFrames: 12, supportsMotionBlur: false, renderCostClass: "LOW", safety: { mayFlash: false, mayCauseRapidMotion: false }, fallbackPrimitiveId: "REVEAL" }),
  def({ primitiveId: "PATH_DRAW", category: "DATA", supportedAssetTypes: ["DIAGRAM", "MAP"], parameterSchemaRef: "motion/params/path-draw@1.0.0", requiredParams: ["pathId"], timingCapabilities: ["LINEAR", "EASING"], minDurationFrames: 12, supportsMotionBlur: false, renderCostClass: "LOW", safety: { mayFlash: false, mayCauseRapidMotion: false }, fallbackPrimitiveId: "DIAGRAM_STEP_REVEAL" }),
  // ---- TRANSITIONS (§10.6) ----
  def({ primitiveId: "CUT", category: "TRANSITION", supportedAssetTypes: ["VIDEO", "IMAGE", "CHART", "MAP", "DIAGRAM", "OVERLAY", "TITLE"], parameterSchemaRef: "motion/params/cut@1.0.0", requiredParams: [], timingCapabilities: ["LINEAR"], minDurationFrames: 1, supportsMotionBlur: false, renderCostClass: "LOW", safety: { mayFlash: false, mayCauseRapidMotion: false } }),
  def({ primitiveId: "FADE", category: "TRANSITION", supportedAssetTypes: ["VIDEO", "IMAGE", "OVERLAY", "TITLE"], parameterSchemaRef: "motion/params/fade@1.0.0", requiredParams: [], timingCapabilities: ["LINEAR", "EASING"], minDurationFrames: 6, supportsMotionBlur: false, renderCostClass: "LOW", safety: { mayFlash: false, mayCauseRapidMotion: false }, fallbackPrimitiveId: "CUT" }),
  def({ primitiveId: "CROSSFADE", category: "TRANSITION", supportedAssetTypes: ["VIDEO", "IMAGE"], parameterSchemaRef: "motion/params/crossfade@1.0.0", requiredParams: [], timingCapabilities: ["LINEAR", "EASING"], minDurationFrames: 6, supportsMotionBlur: false, renderCostClass: "LOW", safety: { mayFlash: false, mayCauseRapidMotion: false }, fallbackPrimitiveId: "CUT" }),
  def({ primitiveId: "SLIDE_PUSH", category: "TRANSITION", supportedAssetTypes: ["VIDEO", "IMAGE"], parameterSchemaRef: "motion/params/slide-push@1.0.0", requiredParams: ["direction"], timingCapabilities: ["LINEAR", "EASING"], minDurationFrames: 6, supportsMotionBlur: false, renderCostClass: "MEDIUM", safety: { mayFlash: false, mayCauseRapidMotion: true }, fallbackPrimitiveId: "CUT" }),
  def({ primitiveId: "WIPE", category: "TRANSITION", supportedAssetTypes: ["VIDEO", "IMAGE"], parameterSchemaRef: "motion/params/wipe@1.0.0", requiredParams: ["direction"], timingCapabilities: ["LINEAR", "EASING"], minDurationFrames: 6, supportsMotionBlur: false, renderCostClass: "MEDIUM", safety: { mayFlash: true, mayCauseRapidMotion: false }, fallbackPrimitiveId: "FADE" }),
];

const BY_ID = new Map(PRIMITIVES.map((p) => [p.primitiveId, p]));

function getPrimitive(primitiveId) {
  return BY_ID.get(primitiveId) || null;
}

function listPrimitives() {
  return PRIMITIVES.map((p) => ({ ...p }));
}

/**
 * Validate primitive params (contract-level, no renderer math).
 * Returns { ok, errors[] }. Checks: known primitive, required keys present,
 * seed present when required, density bounded for PARTICLES, asset-type support.
 */
function validatePrimitiveParams(primitiveId, params = {}, assetInfo = {}) {
  const errors = [];
  const prim = getPrimitive(primitiveId);
  if (!prim) return { ok: false, errors: [`UNKNOWN_PRIMITIVE: ${primitiveId}`] };
  for (const k of prim.requiredParams) {
    if (params[k] === undefined || params[k] === null) errors.push(`MISSING_PARAM: ${primitiveId} requires "${k}"`);
  }
  if (prim.requiresSeed && (params.seed === undefined || params.seed === null || params.seed === "")) {
    errors.push(`NON_DETERMINISTIC_MOTION: ${primitiveId} requires a persisted "seed" param`);
  }
  if (primitiveId === "PARTICLES" && params.density !== undefined) {
    if (!Number.isInteger(params.density) || params.density < 1 || params.density > 500) {
      errors.push("PARTICLE_DENSITY_UNBOUNDED: density must be an integer in [1, 500]");
    }
  }
  if (assetInfo.assetType && prim.supportedAssetTypes.length > 0
    && !prim.supportedAssetTypes.includes(assetInfo.assetType)) {
    errors.push(`UNSUPPORTED_ASSET: ${primitiveId} does not support asset type ${assetInfo.assetType}`);
  }
  // Bounded camera transforms (RULE: bounded transform, frame-safe).
  for (const k of ["fromScale", "toScale"]) {
    if (params[k] !== undefined && (typeof params[k] !== "number" || !(params[k] >= 0.5 && params[k] <= 4))) {
      errors.push(`OUT_OF_BOUNDS: ${k} must be a number in [0.5, 4]`);
    }
  }
  for (const k of ["fromX", "toX", "fromY", "toY"]) {
    if (params[k] !== undefined && (typeof params[k] !== "number" || !(params[k] >= -1 && params[k] <= 2))) {
      errors.push(`OUT_OF_BOUNDS: ${k} must be a number in [-1, 2]`);
    }
  }
  return { ok: errors.length === 0, errors };
}

module.exports = {
  REGISTRY_VERSION,
  PRIMITIVES,
  getPrimitive,
  listPrimitives,
  validatePrimitiveParams,
};
