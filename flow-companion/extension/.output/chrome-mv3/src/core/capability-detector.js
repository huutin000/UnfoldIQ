"use strict";

/**
 * UNFOLDIQ Flow Companion capability detector (STEP 10B).
 * Represents what the Flow page actually exposes — never assumes
 * models/features forever. Uncertain → MANUAL_ASSIST, not blind clicks.
 */

const KNOWN_CAPABILITIES = ["image", "video", "ingredients", "frames", "startFrame", "endFrame", "aspectRatios", "lengths", "models"];

function detectCapabilities(probe = {}) {
  const out = {};
  for (const key of KNOWN_CAPABILITIES) {
    const v = probe[key];
    if (v === true) out[key] = "AVAILABLE";
    else if (v === false) out[key] = "UNAVAILABLE";
    else if (v === "unknown") out[key] = "UNKNOWN";
    else out[key] = "NOT_VERIFIED";
  }
  return out;
}

function recommendMode(capabilities) {
  const uncertain = Object.values(capabilities).some((s) => s === "UNKNOWN" || s === "NOT_VERIFIED");
  if (uncertain) return "MANUAL_ASSIST";
  if (capabilities.image === "UNAVAILABLE" && capabilities.video === "UNAVAILABLE") return "MANUAL_ASSIST";
  return "ASSISTED_APPROVAL";
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { KNOWN_CAPABILITIES, detectCapabilities, recommendMode };
}
