"use strict";

/**
 * Phase 7 production profiles. Speed comes from where it is free (preview
 * scale/format, cached/partial work), never from lowering final quality:
 * PRODUCTION_FINAL carries no render-option overrides at all, so it stays on
 * the approved export profile and the current runner defaults.
 */

const PROFILES = {
  DEVELOPMENT: {
    purpose: "Author specs and check coverage: validated specs + contact-sheet stills, no motion render, no provider calls",
    render: null,
    qa: "SPEC_VALIDATION_AND_CONTACT_SHEET",
    finalEligible: false,
  },
  PRODUCTION_FAST_PREVIEW: {
    purpose: "Motion preview of risky scenes only (opening, dense technical shot, Flow integration, transitions, ending)",
    // MEASURED 2026-10-10 on SkyDiagram S03: jpeg + scale 0.5 ran ~49 fps vs ~10 fps png full scale.
    render: { imageFormat: "jpeg", scale: 0.5, concurrency: 4 },
    qa: "PARTIAL_LOCAL_QA",
    finalEligible: false,
  },
  PRODUCTION_FINAL: {
    purpose: "The one authorized full render; standard quality, full QA on the final artifact",
    render: {},
    qa: "FULL_ARTIFACT_QA",
    finalEligible: true,
    // MEASURED 2026-10-10 (efficiency/jpeg-vs-png-quality.json): jpeg q95 matches PNG quality (SSIM within +-0.002 of PNG,
    // above the current runner default q80) at ~2x PNG speed on filter-heavy scenes. Applying it needs runner wiring
    // plus the render tests; until then the runner default stays (no override), see report.
    plannedFinalImage: { imageFormat: "jpeg", jpegQuality: 95, wired: false },
    exportProfile: "youtube-sdr-1080p@1.0.0",
  },
};

function renderOptionsFor(profileId) {
  const p = PROFILES[profileId];
  if (!p) throw new Error("UNKNOWN_PROFILE: " + profileId);
  if (p.finalEligible && p.render && Object.keys(p.render).length > 0) {
    throw new Error("FINAL_PROFILE_MUST_NOT_OVERRIDE_QUALITY");
  }
  return { profileId, finalEligible: p.finalEligible, options: p.render ? { ...p.render } : null };
}

module.exports = { PROFILES, renderOptionsFor };
