"use strict";

/**
 * UNFOLDIQ — Semantic Research Validation (STEP 08 FIX 2)
 *
 * Layer 2 validation (epistemic consistency).
 * Layer 1 = JSON Schema (shape/type/required fields).
 * Layer 2 = Semantic Validation (this file).
 *
 * Rules:
 *  R1: UNVERIFIED + CAN_STATE        -> INVALID (UNVERIFIED_CANNOT_BE_CAN_STATE)
 *  R2: UNSUPPORTED + CAN_STATE       -> INVALID (UNSUPPORTED_CANNOT_BE_CAN_STATE)
 *  R3: HYPOTHESIS + CAN_STATE        -> INVALID (HYPOTHESIS_CANNOT_BE_CAN_STATE)
 *  R4: CONTESTED + CAN_STATE         -> INVALID (CONTESTED_CANNOT_BE_CAN_STATE)
 *  R5: readyForStorytelling=true + any semantic ERROR -> brief invalid for handoff
 *
 * Deliberately NOT enforced (no over-constraining):
 *  - no "every claim must have 2 sources"
 *  - no "every claim must be DIRECT_EVIDENCE"
 *  - HYPOTHESIS / CONTESTED may still be used with caveat / non-factual use
 */

function validateClaimSemantics(claim) {
  const errors = [];
  const warnings = [];

  if (!claim || typeof claim !== "object") {
    return { valid: false, errors: [{ code: "INVALID_CLAIM_SHAPE", message: "Claim must be an object." }], warnings };
  }

  const claimId = claim.claimId || "(missing claimId)";
  const claimClass = claim.claimClass;
  const evidenceStatus = claim.evidenceStatus;
  const scriptUse = claim.scriptUse;

  // R1 — UNVERIFIED cannot be stated as fact
  if (claimClass === "UNVERIFIED" && scriptUse === "CAN_STATE") {
    errors.push({
      code: "UNVERIFIED_CANNOT_BE_CAN_STATE",
      claimId,
      message: `Claim ${claimId}: UNVERIFIED cannot use scriptUse=CAN_STATE. Use DO_NOT_STATE_AS_FACT or DO_NOT_USE.`,
    });
  }

  // R2 — UNSUPPORTED cannot be stated as fact
  if (evidenceStatus === "UNSUPPORTED" && scriptUse === "CAN_STATE") {
    errors.push({
      code: "UNSUPPORTED_CANNOT_BE_CAN_STATE",
      claimId,
      message: `Claim ${claimId}: evidenceStatus=UNSUPPORTED cannot use scriptUse=CAN_STATE.`,
    });
  }

  // R3 — HYPOTHESIS cannot be flattened into established fact
  if (claimClass === "HYPOTHESIS" && scriptUse === "CAN_STATE") {
    errors.push({
      code: "HYPOTHESIS_CANNOT_BE_CAN_STATE",
      claimId,
      message: `Claim ${claimId}: HYPOTHESIS cannot use scriptUse=CAN_STATE. Allowed: STATE_WITH_CAVEAT, DO_NOT_STATE_AS_FACT, DO_NOT_USE.`,
    });
  }

  // R4 — CONTESTED cannot silently become fact
  if (claimClass === "CONTESTED" && scriptUse === "CAN_STATE") {
    errors.push({
      code: "CONTESTED_CANNOT_BE_CAN_STATE",
      claimId,
      message: `Claim ${claimId}: CONTESTED cannot use scriptUse=CAN_STATE. Allowed: STATE_WITH_CAVEAT, DO_NOT_STATE_AS_FACT, DO_NOT_USE.`,
    });
  }

  return { valid: errors.length === 0, errors, warnings };
}

function validateResearchBriefSemantics(researchBrief) {
  const errors = [];
  const warnings = [];

  if (!researchBrief || typeof researchBrief !== "object") {
    return { valid: false, errors: [{ code: "INVALID_BRIEF_SHAPE", message: "Research brief must be an object." }], warnings };
  }

  const claims = Array.isArray(researchBrief.claims) ? researchBrief.claims : [];

  for (const claim of claims) {
    const r = validateClaimSemantics(claim);
    for (const e of r.errors) errors.push(e);
    for (const w of r.warnings) warnings.push(w);
  }

  // R5 — READY handoff with material semantic errors is invalid
  const ready = researchBrief.handoff && researchBrief.handoff.readyForStorytelling === true;
  if (ready && errors.length > 0) {
    errors.push({
      code: "READY_HANDOFF_WITH_SEMANTIC_ERRORS",
      message: `handoff.readyForStorytelling=true but ${errors.length} semantic error(s) present. Brief is invalid for storytelling handoff.`,
    });
  }

  return { valid: errors.length === 0, errors, warnings };
}

module.exports = {
  validateResearchBriefSemantics,
  validateClaimSemantics,
};
