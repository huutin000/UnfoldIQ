"use strict";

/**
 * POST-v1F: canonical generated-media quality policy.
 *
 * ONE definition of "this is a real generated asset, not UI thumbnail/chrome",
 * shared by candidate intake, artifact validation and structural QA, so the
 * threshold can never drift between the places that enforce it.
 *
 * A 32x32 header avatar decodes fine and is technically a valid PNG; that is
 * exactly why decodability alone was not a sufficient structural QA invariant.
 */

/** Minimum short edge, in pixels, for an accepted generated image. */
const GENERATED_IMAGE_MIN_SHORT_EDGE_PX = 256;

/** A tiny logo/icon ring cannot be mistaken for an output at this short edge. */
const MIN_DECODABLE_SHORT_EDGE_PX = 1;

/**
 * Validate measured image dimensions against the policy.
 * @param {{width?:number|null, height?:number|null}} dims
 * @param {{expectedAspectRatio?:number|null, tolerance?:number}} [opts]
 * @returns {{ok:boolean, reason:(string|null)}}
 */
function checkGeneratedImage(dims, opts = {}) {
  const w = Number(dims && dims.width);
  const h = Number(dims && dims.height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return { ok: false, reason: "ARTIFACT_DIMENSIONS_UNKNOWN: image dimensions could not be measured" };
  }
  if (Math.min(w, h) < MIN_DECODABLE_SHORT_EDGE_PX) {
    return { ok: false, reason: `ARTIFACT_NOT_DECODABLE: ${w}x${h} has no measurable area` };
  }
  if (Math.min(w, h) < GENERATED_IMAGE_MIN_SHORT_EDGE_PX) {
    return {
      ok: false,
      reason: `ARTIFACT_BELOW_MIN_RESOLUTION: ${w}x${h} short edge < ${GENERATED_IMAGE_MIN_SHORT_EDGE_PX}px, treated as UI thumbnail rather than a generated asset`,
    };
  }
  const expected = Number(opts.expectedAspectRatio);
  if (Number.isFinite(expected) && expected > 0) {
    const actual = w / h;
    const tolerance = Number.isFinite(Number(opts.tolerance)) ? Number(opts.tolerance) : 0.02;
    if (Math.abs(actual - expected) / expected > tolerance) {
      return {
        ok: false,
        reason: `ARTIFACT_ASPECT_MISMATCH: ${w}x${h} (${actual.toFixed(3)}) does not match requested aspect ${expected.toFixed(3)}`,
      };
    }
  }
  return { ok: true, reason: null };
}

/**
 * POST-v1F: correlation proof for a candidate that was persisted at
 * RESULT_DETECTED. A candidate is only adoptable if it was recorded as new
 * relative to the pre-submit baseline and carries at least one strong identity
 * signal. Mere visibility on the page is never enough.
 *
 * @param {object|null} candidate persisted candidate record
 * @returns {{ok:boolean, resultBelongsToCurrentAttempt:boolean, signals:object, reason:(string|null)}}
 */
function checkCorrelation(candidate) {
  const signals = {
    persistedAtDetection: !!candidate,
    newVsBaseline: !!(candidate && candidate.isNew === true),
    stableAssetId: !!(candidate && candidate.assetId),
    sameAgentTurn: !!(candidate && candidate.sameAgentTurn === true),
    hasUrl: !!(candidate && candidate.url),
    mediaTypeImage: !!(candidate && candidate.mediaType === "IMAGE"),
  };
  if (!candidate) {
    return { ok: false, resultBelongsToCurrentAttempt: false, signals, reason: "RESULT_CORRELATION_REQUIRED: no persisted candidate at RESULT_DETECTED" };
  }
  if (!signals.newVsBaseline) {
    return { ok: false, resultBelongsToCurrentAttempt: false, signals, reason: "RESULT_CORRELATION_REQUIRED: candidate was already present in the pre-submit baseline" };
  }
  if (!signals.hasUrl) {
    return { ok: false, resultBelongsToCurrentAttempt: false, signals, reason: "RESULT_CORRELATION_REQUIRED: candidate has no exact URL" };
  }
  const strongIdentity = signals.stableAssetId || signals.sameAgentTurn;
  if (!strongIdentity) {
    return {
      ok: false,
      resultBelongsToCurrentAttempt: false,
      signals,
      reason: "RESULT_CORRELATION_REQUIRED: candidate has no stable asset id or same-agent-turn evidence (visibility alone is not correlation)",
    };
  }
  return { ok: true, resultBelongsToCurrentAttempt: true, signals, reason: null };
}

module.exports = {
  GENERATED_IMAGE_MIN_SHORT_EDGE_PX,
  MIN_DECODABLE_SHORT_EDGE_PX,
  checkGeneratedImage,
  checkCorrelation,
};
