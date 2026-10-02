"use strict";

/**
 * UNFOLDIQ policy/rights semantic validation (STEP 09 V2).
 * Axes are NEVER collapsed into one boolean.
 * No network calls. No legal guarantees. No monetization guarantees.
 */

function err(code, message) {
  return { code, message };
}

// evaluateRightsGate({ sourceType, basisRecorded, materialUse })
// sourceType: ORIGINAL|AI_GENERATED|LICENSED|PERMISSION|CREATIVE_COMMONS|PUBLIC_DOMAIN|USER_PROVIDED|COPYRIGHT_EXCEPTION_CLAIM|UNKNOWN
function evaluateRightsGate(input) {
  const t = input && input.sourceType;
  const basis = !!(input && input.basisRecorded);
  switch (t) {
    case "ORIGINAL":
      return basis
        ? { decision: "VERIFIED", reasons: ["original asset with recorded evidence"] }
        : { decision: "REVIEW_REQUIRED", reasons: ["original claim without recorded basis"] };
    case "LICENSED":
    case "PERMISSION":
    case "CREATIVE_COMMONS":
    case "PUBLIC_DOMAIN":
    case "USER_PROVIDED":
      return basis
        ? { decision: "VERIFIED", reasons: [`${t} with recorded basis`] }
        : { decision: "REVIEW_REQUIRED", reasons: [`${t} without recorded basis`] };
    case "AI_GENERATED":
      return { decision: "REVIEW_REQUIRED", reasons: ["AI-generated: route through AI transparency review"] };
    case "COPYRIGHT_EXCEPTION_CLAIM":
      return { decision: "REVIEW_REQUIRED", reasons: ["legal exception claimed, not adjudicated"] };
    case "UNKNOWN":
      return { decision: "BLOCKED", reasons: ["unknown material rights cannot silently pass"] };
    default:
      return { decision: "REVIEW_REQUIRED", reasons: ["unrecognized source type"] };
  }
}

// evaluateAiDisclosure({ platform, realistic, depictsRealPerson, altersRealFootage, generatesRealisticScene, abstractNonRealistic, productionAssistanceOnly, syntheticEndorsement })
// Returns { decision: REQUIRED|NOT_REQUIRED|REVIEW_REQUIRED, reasons[] }.
function evaluateAiDisclosure(input) {
  const i = input || {};
  if (i.syntheticEndorsement && i.depictsRealPerson) {
    return { decision: "REQUIRED", reasons: ["synthetic real-person endorsement always needs disclosure review (and likeness gate)"] };
  }
  const realisticTrigger = !!(i.realistic && (i.depictsRealPerson || i.altersRealFootage || i.generatesRealisticScene));
  if (realisticTrigger) {
    return { decision: "REQUIRED", reasons: ["realistic AI depicting person/event/scene triggers disclosure baseline"] };
  }
  if (i.abstractNonRealistic && !i.depictsRealPerson && !i.altersRealFootage && !i.generatesRealisticScene) {
    return { decision: "NOT_REQUIRED", reasons: ["non-realistic abstract use is not auto-required solely because AI was used"] };
  }
  if (i.productionAssistanceOnly) {
    return { decision: "NOT_REQUIRED", reasons: ["minor production assistance is not auto-required"] };
  }
  return { decision: "REVIEW_REQUIRED", reasons: ["ambiguous AI use needs human review"] };
}

// evaluateLikeness({ depictsRealPerson, synthetic, consentOrBasis })
// Synthetic real-person endorsement without basis -> BLOCKED.
function evaluateLikeness(input) {
  const i = input || {};
  if (!i.depictsRealPerson) return { decision: "NOT_APPLICABLE", reasons: ["no real-person likeness"] };
  if (i.synthetic && !i.consentOrBasis) {
    return { decision: "BLOCKED", reasons: ["synthetic real-person depiction/endorsement without basis"] };
  }
  if (!i.consentOrBasis) return { decision: "REVIEW_REQUIRED", reasons: ["real-person depiction needs basis review"] };
  return { decision: "CLEAR", reasons: ["basis recorded"] };
}

// evaluateOriginality({ templatedRepetitive, substantiveEducationalValue, genericAiOutput })
// LOW_RISK | REVIEW_REQUIRED | HIGH_RISK — never a monetization guarantee.
function evaluateOriginality(input) {
  const i = input || {};
  if (i.templatedRepetitive || i.genericAiOutput) {
    return { risk: "HIGH_RISK", reasons: ["templated/repetitive low-value signals"] };
  }
  if (i.substantiveEducationalValue) {
    return { risk: "LOW_RISK", reasons: ["substantive original educational value"] };
  }
  return { risk: "REVIEW_REQUIRED", reasons: ["borderline originality"] };
}

// validatePolicyReviewSemantics(review) -> { valid, errors[], warnings[] }
function validatePolicyReviewSemantics(review) {
  const errors = [];
  const warnings = [];

  if (!review || typeof review !== "object") {
    return { valid: false, errors: [err("INVALID_REVIEW_SHAPE", "Review must be an object.")], warnings };
  }

  // Axes must exist and stay separate.
  const axes = review.axes || {};
  const axisKeys = ["PLATFORM_ALLOWEDNESS", "RIGHTS", "AI_TRANSPARENCY", "MONETIZATION_AD_SUITABILITY"];
  for (const k of axisKeys) {
    if (!axes[k]) errors.push(err("AXIS_MISSING", `Axis ${k} must be recorded separately.`));
  }

  // UNKNOWN rights can never be VERIFIED.
  if (review.rights && review.rights.sourceType === "UNKNOWN" && review.rights.decision === "VERIFIED") {
    errors.push(err("UNKNOWN_RIGHTS_CANNOT_BE_VERIFIED", "UNKNOWN sourceType cannot carry decision VERIFIED."));
  }

  // Reconstruction must never masquerade as evidence.
  const rec = review.reconstruction || {};
  if (rec.classification === "EVIDENCE_ASSET" && rec.hasEvidenceProvenance !== true) {
    errors.push(err("RECONSTRUCTION_AS_EVIDENCE_REJECTED", "Generated/staged visual classified as EVIDENCE_ASSET without evidence provenance."));
  }
  if (rec.classification === "RECONSTRUCTION" && rec.labeledAsReconstruction !== true) {
    errors.push(err("RECONSTRUCTION_MUST_BE_LABELED", "RECONSTRUCTION must be labeled as reconstruction."));
  }

  // Realistic AI depicting person/event without disclosure review.
  const ai = review.aiDisclosure || {};
  if (ai.realisticAiDepictsRealPersonOrEvent === true && ai.decision === "NOT_REQUIRED") {
    errors.push(err("REALISTIC_AI_REQUIRES_DISCLOSURE_REVIEW", "Realistic AI depicting a real person/event cannot be silently NOT_REQUIRED."));
  }

  // Disclosure REQUIRED must propagate a user action.
  if (ai.decision === "REQUIRED") {
    const actions = (review.handoff && review.handoff.requiredUserActions) || [];
    if (actions.length === 0) {
      errors.push(err("DISCLOSURE_ACTION_MISSING", "aiDisclosure REQUIRED but handoff.requiredUserActions is empty."));
    }
  }

  // Synthetic endorsement can never auto-PASS likeness.
  if (review.likeness && review.likeness.syntheticEndorsement === true && review.likeness.decision === "CLEAR") {
    errors.push(err("SYNTHETIC_ENDORSEMENT_CANNOT_AUTO_PASS", "Synthetic real-person endorsement cannot auto-pass likeness."));
  }

  // Stale/snapshot-only critical policy cannot claim live verification.
  if ((review.policyVerification === "STALE" || review.policyVerification === "SNAPSHOT_ONLY") &&
      review.policyVerificationClaimedCurrent === true) {
    errors.push(err("STALE_POLICY_CANNOT_CLAIM_CURRENT", "Stale/snapshot-only policy cannot claim current-policy verification."));
  }

  return { valid: errors.length === 0, errors, warnings };
}

// evaluatePolicyHandoff({ axes, rightsDecision, disclosureDecision, disclosureActionDone, policyVerification, criticalPolicyUnverified })
// Returns { status, renderable, requiredUserActions[], reasons[] }.
function evaluatePolicyHandoff(input) {
  const i = input || {};
  const axes = i.axes || {};
  const reasons = [];
  const actions = [];

  const blocked =
    axes.PLATFORM_ALLOWEDNESS === "BLOCKED" ||
    axes.RIGHTS === "BLOCKED" ||
    axes.AI_TRANSPARENCY === "BLOCKED" ||
    axes.MONETIZATION_AD_SUITABILITY === "BLOCKED" ||
    i.rightsDecision === "BLOCKED";
  if (blocked) {
    reasons.push("a gate is BLOCKED");
    return { status: "BLOCKED", renderable: false, requiredUserActions: actions, reasons };
  }

  if (i.disclosureDecision === "REQUIRED") {
    reasons.push("AI disclosure required: render allowed, publish gated on user action");
    actions.push("Complete platform AI disclosure/label action before upload");
    return { status: "PUBLISH_REVIEW_REQUIRED", renderable: true, requiredUserActions: actions, reasons };
  }

  if (i.policyVerification === "STALE" || (i.policyVerification === "SNAPSHOT_ONLY" && i.criticalPolicyUnverified)) {
    reasons.push("stale or snapshot-only critical policy: publish review required");
    actions.push("Re-verify relevant official policy sources before upload");
    return { status: "PUBLISH_REVIEW_REQUIRED", renderable: true, requiredUserActions: actions, reasons };
  }

  const reviewRequired =
    Object.values(axes).includes("REVIEW_REQUIRED") ||
    i.rightsDecision === "REVIEW_REQUIRED" ||
    i.disclosureDecision === "REVIEW_REQUIRED";
  if (reviewRequired) {
    reasons.push("a gate needs review");
    return { status: "PUBLISH_REVIEW_REQUIRED", renderable: true, requiredUserActions: actions, reasons };
  }

  reasons.push("all gates pass, no pending user actions");
  return { status: "PUBLISH_READY", renderable: true, requiredUserActions: actions, reasons };
}

module.exports = {
  evaluateRightsGate,
  evaluateAiDisclosure,
  evaluateLikeness,
  evaluateOriginality,
  validatePolicyReviewSemantics,
  evaluatePolicyHandoff,
};
