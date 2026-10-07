"use strict";

/**
 * Phase 3A-06/07 — Media Technical Metadata + MediaConformPolicy
 * (UNFOLDIQ CORE, GAP-005 partial owner).
 *
 * Represents enough technical metadata to decide whether an asset can be
 * used directly in the timeline. Phase 3A only DECIDES conform; transcoding
 * stays with later phases. VFR is never silently treated as CFR (RULE 8);
 * unknown metadata is explicit, never guessed (RULE 9).
 */

const ERRORS = {
  METADATA_REQUIRED: "media conform metadata object required",
  POLICY_REQUIRED: "media conform policy required",
  FRAME_RATE_REQUIRED: "target frame rate (rational) required for video conform",
};

const CONFORM_DECISIONS = ["DIRECT_USE", "CONFORM_REQUIRED", "REVIEW_REQUIRED", "REJECT"];
const METADATA_CONFIDENCE = ["DECLARED", "DETECTED", "ASSUMED", "UNKNOWN"];

/**
 * MediaConformMetadata — per-asset technical facts. Every color field and
 * the frame-rate/scan fields carry an explicit confidence.
 * shape: {
 *   mediaType: "video" | "image" | "audio" | "chart" | "map" | "diagram",
 *   durationMs?: number,
 *   width?: number, height?: number,
 *   frameRate?: {numerator, denominator}, frameRateConfidence?: CONF,
 *   scanType?: "CFR" | "VFR", scanTypeConfidence?: CONF,
 *   pixelAspectRatio?: number, rotation?: number,
 *   audioSampleRate?: number, audioChannels?: number,
 *   color?: { primaries?, transfer?, matrix?, range?, colorSpace?, confidence: CONF },
 * }
 */
function validateMetadata(meta) {
  const errors = [];
  if (!meta || typeof meta !== "object") return { ok: false, errors: ["metadata object required"] };
  if (!["video", "image", "audio", "chart", "map", "diagram"].includes(meta.mediaType)) {
    errors.push("mediaType must be video|image|audio|chart|map|diagram");
  }
  for (const f of ["frameRateConfidence", "scanTypeConfidence"]) {
    if (meta[f] !== undefined && !METADATA_CONFIDENCE.includes(meta[f])) errors.push(`${f} invalid`);
  }
  if (meta.color && !METADATA_CONFIDENCE.includes(meta.color.confidence)) {
    errors.push("color.confidence must be DECLARED|DETECTED|ASSUMED|UNKNOWN");
  }
  return { ok: errors.length === 0, errors };
}

// Versioned conform policy (§14). No transcoding happens here — decisions only.
const MEDIA_CONFORM_POLICIES = {
  "web-standard-conform@1.0.0": {
    policyId: "web-standard-conform",
    version: "1.0.0",
    targetAudioSampleRate: 48000,
    vfrPolicy: "CONFORM_REQUIRED", // never silent CFR (RULE 8)
    rotationPolicy: "CONFORM_REQUIRED", // any non-zero rotation must conform
    pixelAspectRatioPolicy: "CONFORM_REQUIRED", // PAR != 1 must conform
    frameRateMismatchPolicy: "CONFORM_REQUIRED",
    unknownMetadataPolicy: "REVIEW_REQUIRED", // RULE 9
    hdrPolicy: "REVIEW_REQUIRED",
  },
};

function getConformPolicy(ref) {
  const p = MEDIA_CONFORM_POLICIES[ref];
  if (!p) throw new Error(`${ERRORS.POLICY_REQUIRED}: ${ref}`);
  return p;
}

const SAME_FPS_EPSILON = 0.001;

function fpsValue(fr) {
  return fr ? fr.numerator / fr.denominator : null;
}

/**
 * Deterministic conform decision with machine-readable reasons.
 * Severity order: REJECT > REVIEW_REQUIRED > CONFORM_REQUIRED > DIRECT_USE.
 */
function evaluateConform(meta, policyRef, { targetFrameRate } = {}) {
  const policy = getConformPolicy(policyRef);
  const v = validateMetadata(meta);
  if (!v.ok) return { ok: false, code: "METADATA_INVALID", errors: v.errors };
  const reasons = [];
  let decision = "DIRECT_USE";
  const escalate = (d, reason) => {
    reasons.push({ decision: d, reason });
    const order = ["DIRECT_USE", "CONFORM_REQUIRED", "REVIEW_REQUIRED", "REJECT"];
    if (order.indexOf(d) > order.indexOf(decision)) decision = d;
  };

  if (meta.mediaType === "video") {
    if (!targetFrameRate) return { ok: false, code: ERRORS.FRAME_RATE_REQUIRED };
    if (!meta.frameRate || meta.frameRateConfidence === "UNKNOWN") {
      escalate(policy.unknownMetadataPolicy, "UNKNOWN_MEDIA_METADATA: video frame rate missing/unknown");
    } else {
      if (meta.scanType === "VFR") {
        escalate(policy.vfrPolicy, "VFR_REQUIRES_CONFORM: variable frame rate is never silently treated as CFR");
      }
      const a = fpsValue(meta.frameRate);
      const b = fpsValue(targetFrameRate);
      if (Math.abs(a - b) > SAME_FPS_EPSILON) {
        escalate(policy.frameRateMismatchPolicy, `FRAME_RATE_MISMATCH: source ${a} vs timeline ${b}`);
      }
    }
    if (meta.rotation && meta.rotation !== 0) {
      escalate(policy.rotationPolicy, `ROTATION_REQUIRES_CONFORM: rotation ${meta.rotation}`);
    }
    if (meta.pixelAspectRatio !== undefined && Math.abs(meta.pixelAspectRatio - 1) > 1e-6) {
      escalate(policy.pixelAspectRatioPolicy, `PIXEL_ASPECT_RATIO_REQUIRES_CONFORM: PAR ${meta.pixelAspectRatio}`);
    }
    if (meta.color && (meta.color.transfer === "PQ" || meta.color.transfer === "HLG")) {
      escalate(policy.hdrPolicy, "HDR_REQUIRES_REVIEW: HDR transfer under SDR policy");
    }
  }
  if ((meta.mediaType === "video" || meta.mediaType === "audio") && meta.audioSampleRate !== undefined) {
    if (meta.audioSampleRate !== policy.targetAudioSampleRate) {
      escalate("CONFORM_REQUIRED", `AUDIO_SAMPLE_RATE_MISMATCH: ${meta.audioSampleRate} vs target ${policy.targetAudioSampleRate}`);
    }
  }
  if (meta.color && meta.color.confidence === "UNKNOWN") {
    escalate(policy.unknownMetadataPolicy, "UNKNOWN_COLOR_METADATA: color metadata unknown — explicit review, no silent guess");
  }
  if (reasons.length === 0) reasons.push({ decision: "DIRECT_USE", reason: "metadata complete and within policy" });
  return { ok: true, decision, reasons, policyRef };
}

module.exports = {
  ERRORS,
  CONFORM_DECISIONS,
  METADATA_CONFIDENCE,
  MEDIA_CONFORM_POLICIES,
  getConformPolicy,
  validateMetadata,
  evaluateConform,
};
