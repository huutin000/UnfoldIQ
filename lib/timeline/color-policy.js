"use strict";

/**
 * Phase 3A-08 — Color Management Policy (UNFOLDIQ CORE, GAP-005 partial).
 *
 * Establishes the three distinct concepts (RULE 10): per-asset INPUT color
 * metadata (with confidence), TIMELINE working-color intent, and OUTPUT
 * color intent reference. Phase 3A owns metadata/policy; Phase 4B owns
 * final encoded-output verification (RULE 11). No grading suite here.
 */

const COLOR_MANAGEMENT_POLICIES = {
  "sdr-web-standard@1.0.0": {
    policyId: "sdr-web-standard",
    version: "1.0.0",
    workingColorSpace: "sRGB",
    outputColorIntent: {
      intentId: "rec709-srgb@1.0.0",
      primaries: "BT.709",
      transfer: "sRGB",
      matrix: "BT.709",
      range: "FULL",
    },
    unknownInputPolicy: "REVIEW_REQUIRED", // RULE 9: explicit, never silent
    hdrPolicy: "REVIEW_REQUIRED",
  },
};

function getColorPolicy(ref) {
  const p = COLOR_MANAGEMENT_POLICIES[ref];
  if (!p) throw new Error(`UNKNOWN_COLOR_POLICY: ${ref}`);
  return p;
}

/**
 * Attach color context to a timeline item.
 * sourceColor: { primaries?, transfer?, matrix?, range?, colorSpace?, confidence }
 * confidence: DECLARED (by provider/asset record) | DETECTED (probed) |
 *             ASSUMED (explicitly versioned assumption) | UNKNOWN.
 * ASSUMED must carry assumedPolicyRef so the guess is traceable and
 * reversible — a silent guess is forbidden.
 */
function attachColor(sourceColor, colorPolicyRef) {
  const policy = getColorPolicy(colorPolicyRef);
  const confidence = (sourceColor && sourceColor.confidence) || "UNKNOWN";
  const finding = [];
  if (confidence === "UNKNOWN") {
    finding.push({ code: "UNKNOWN_COLOR_METADATA", reason: "source color metadata unknown", correctiveAction: "DECLARE_COLOR_METADATA_OR_ASSUME_WITH_POLICY_REF" });
  }
  if (confidence === "ASSUMED" && !(sourceColor && sourceColor.assumedPolicyRef)) {
    finding.push({ code: "COLOR_POLICY_REVIEW_REQUIRED", reason: "ASSUMED color without an explicit versioned assumption ref", correctiveAction: "PROVIDE_ASSUMED_POLICY_REF" });
  }
  if (sourceColor && (sourceColor.transfer === "PQ" || sourceColor.transfer === "HLG")) {
    if (policy.hdrPolicy === "REVIEW_REQUIRED") {
      finding.push({ code: "COLOR_POLICY_REVIEW_REQUIRED", reason: `HDR transfer ${sourceColor.transfer} under SDR working policy`, correctiveAction: "REVIEW_COLOR_PIPELINE" });
    }
  }
  return {
    colorRef: `${colorPolicyRef}`,
    workingColorSpace: policy.workingColorSpace,
    outputColorIntentRef: policy.outputColorIntent.intentId,
    sourceColor: {
      ...(sourceColor || {}),
      confidence,
    },
    findings: finding,
  };
}

module.exports = { COLOR_MANAGEMENT_POLICIES, getColorPolicy, attachColor };
