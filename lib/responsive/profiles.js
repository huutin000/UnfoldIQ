"use strict";

/**
 * Phase 3C §15 — Versioned Responsive Profiles (UNFOLDIQ CORE).
 *
 * Safe zones are profile-driven (fractions of canvas), never one universal
 * margin. Snapshot values trace to platform profiles (sources recorded);
 * caption line budgets consumed from lib/caption-grouping PLATFORM_DEFAULTS.
 */

const PROFILE_VERSION = "1.0.0";

// Insets as fractions {top, right, bottom, left} of canvas dimension.
const RESPONSIVE_PROFILES = {
  "landscape-16x9@1.0.0": {
    profileId: "landscape-16x9",
    version: "1.0.0",
    width: 1920,
    height: 1080,
    aspectRatio: { numerator: 16, denominator: 9 },
    orientation: "LANDSCAPE",
    source: "platforms/youtube/PROFILE.yaml (16:9, 1920x1080)",
    safeZones: {
      action: { top: 0.05, right: 0.05, bottom: 0.05, left: 0.05 },
      title: { top: 0.10, right: 0.10, bottom: 0.10, left: 0.10 },
      caption: { top: 0.80, right: 0.08, bottom: 0.06, left: 0.08 },
      criticalSubject: { top: 0.05, right: 0.05, bottom: 0.10, left: 0.05 },
    },
    defaultFitPolicy: "CONTAIN",
    captionLayoutPolicyRef: "caption-layout@1.0.0",
    titleLayoutPolicyRef: "title-layout@1.0.0",
    chartLayoutPolicyRef: "chart-layout@1.0.0",
  },
  "portrait-9x16@1.0.0": {
    profileId: "portrait-9x16",
    version: "1.0.0",
    width: 1080,
    height: 1920,
    aspectRatio: { numerator: 9, denominator: 16 },
    orientation: "PORTRAIT",
    source: "platforms/tiktok/PROFILE.yaml (9:16, 1080x1920, uiSafeZoneRequired)",
    safeZones: {
      action: { top: 0.06, right: 0.06, bottom: 0.22, left: 0.06 },
      title: { top: 0.12, right: 0.10, bottom: 0.28, left: 0.10 },
      caption: { top: 0.68, right: 0.08, bottom: 0.22, left: 0.08 },
      criticalSubject: { top: 0.12, right: 0.06, bottom: 0.28, left: 0.06 },
    },
    defaultFitPolicy: "SMART_CROP",
    captionLayoutPolicyRef: "caption-layout@1.0.0",
    titleLayoutPolicyRef: "title-layout@1.0.0",
    chartLayoutPolicyRef: "chart-layout@1.0.0",
  },
};

function captionBudgets() {
  try {
    return require("../caption-grouping.js").PLATFORM_DEFAULTS;
  } catch {
    return { youtube: { maxChars: 84, maxLines: 2 }, tiktok: { maxChars: 42, maxLines: 2 } };
  }
}

function getResponsiveProfile(profileRef) {
  return RESPONSIVE_PROFILES[profileRef] || null;
}

function listResponsiveProfiles() {
  return Object.keys(RESPONSIVE_PROFILES);
}

/** Shrink an inset rect; returns absolute pixel bounds. */
function safeRect(profile, zone) {
  const z = profile.safeZones[zone];
  if (!z) return null;
  return {
    x: Math.round(z.left * profile.width),
    y: Math.round(z.top * profile.height),
    width: Math.round(profile.width * (1 - z.left - z.right)),
    height: Math.round(profile.height * (1 - z.top - z.bottom)),
  };
}

function pointInRect(px, py, rect) {
  return px >= rect.x && px <= rect.x + rect.width && py >= rect.y && py <= rect.y + rect.height;
}

module.exports = {
  PROFILE_VERSION,
  RESPONSIVE_PROFILES,
  getResponsiveProfile,
  listResponsiveProfiles,
  captionBudgets,
  safeRect,
  pointInRect,
};
