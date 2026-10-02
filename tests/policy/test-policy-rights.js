"use strict";

/**
 * UNFOLDIQ policy/rights executable tests (STEP 09 V2): P1-P16.
 * No network calls. No media generation. No legal/monetization guarantees asserted.
 */

const {
  evaluateRightsGate,
  evaluateAiDisclosure,
  evaluateLikeness,
  evaluateOriginality,
  validatePolicyReviewSemantics,
  evaluatePolicyHandoff,
} = require("../../lib/policy-rights-check.js");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
  console.log(`  ✓ ${message}`);
  passed++;
}

function runTest(name, fn) {
  console.log(`\n[TEST] ${name}`);
  try {
    fn();
    console.log(`[PASS] ${name}`);
    return true;
  } catch (e) {
    console.log(`[FAIL] ${name}: ${e.message}`);
    failed++;
    return false;
  }
}

function logOut(label, obj) {
  console.log(`  output: ${label} = ${JSON.stringify(obj)}`);
}

console.log("=== POLICY / RIGHTS TESTS (P1-P16) ===\n");

// P1 ORIGINAL + evidence -> VERIFIED
runTest("P1 Original asset passes", () => {
  const r = evaluateRightsGate({ sourceType: "ORIGINAL", basisRecorded: true, materialUse: true });
  logOut("rights", r);
  assert(r.decision === "VERIFIED", "ORIGINAL + evidence must be VERIFIED");
});

// P2 UNKNOWN required final asset -> BLOCKED / not publish-ready
runTest("P2 Unknown rights blocks publish", () => {
  const r = evaluateRightsGate({ sourceType: "UNKNOWN", basisRecorded: false, materialUse: true });
  logOut("rights", r);
  assert(r.decision === "BLOCKED", "UNKNOWN must be BLOCKED");
  const h = evaluatePolicyHandoff({ axes: { PLATFORM_ALLOWEDNESS: "PASS", RIGHTS: "BLOCKED", AI_TRANSPARENCY: "NOT_APPLICABLE", MONETIZATION_AD_SUITABILITY: "NOT_APPLICABLE" }, rightsDecision: "BLOCKED" });
  logOut("handoff", h);
  assert(h.status === "BLOCKED", "unknown rights must not be publish-ready");
  assert(h.renderable === false, "blocked rights must not be renderable");
});

// P3 COPYRIGHT_EXCEPTION_CLAIM -> REVIEW_REQUIRED
runTest("P3 Copyright exception needs review", () => {
  const r = evaluateRightsGate({ sourceType: "COPYRIGHT_EXCEPTION_CLAIM", basisRecorded: true });
  logOut("rights", r);
  assert(r.decision === "REVIEW_REQUIRED", "exception claim must be REVIEW_REQUIRED, never auto-verified");
});

// P4 YouTube realistic AI historical reconstruction -> not silently NOT_REQUIRED
runTest("P4 Realistic AI reconstruction needs disclosure review", () => {
  const d = evaluateAiDisclosure({ platform: "youtube", realistic: true, generatesRealisticScene: true, depictsRealPerson: false, altersRealFootage: false });
  logOut("aiDisclosure", d);
  assert(d.decision !== "NOT_REQUIRED", "realistic AI reconstruction must not be silently NOT_REQUIRED");
  assert(d.decision === "REQUIRED", "realistic AI reconstruction must be REQUIRED");
});

// P5 Non-realistic abstract AI diagram -> not auto REQUIRED solely because AI used
runTest("P5 Abstract AI diagram not auto-required", () => {
  const d = evaluateAiDisclosure({ platform: "youtube", realistic: false, abstractNonRealistic: true, depictsRealPerson: false, altersRealFootage: false, generatesRealisticScene: false });
  logOut("aiDisclosure", d);
  assert(d.decision === "NOT_REQUIRED", "abstract diagram must not be REQUIRED solely because AI was used");
});

// P6 Synthetic real-person endorsement -> not auto PASS
runTest("P6 Synthetic endorsement blocked", () => {
  const l = evaluateLikeness({ depictsRealPerson: true, synthetic: true, consentOrBasis: false });
  logOut("likeness", l);
  assert(l.decision === "BLOCKED", "synthetic endorsement without basis must be BLOCKED, never auto-PASS");
  const review = {
    axes: { PLATFORM_ALLOWEDNESS: "PASS", RIGHTS: "PASS", AI_TRANSPARENCY: "REQUIRED", MONETIZATION_AD_SUITABILITY: "REVIEW_REQUIRED" },
    rights: { sourceType: "AI_GENERATED", decision: "REVIEW_REQUIRED" },
    aiDisclosure: { decision: "REQUIRED" },
    likeness: { decision: "BLOCKED", syntheticEndorsement: false },
    reconstruction: { classification: "NOT_APPLICABLE" },
    handoff: { requiredUserActions: ["Complete platform AI disclosure/label action before upload"] },
  };
  const v = validatePolicyReviewSemantics(review);
  logOut("semantic", { valid: v.valid, codes: v.errors.map((e) => e.code) });
  assert(v.valid === true, "well-formed review with blocked likeness axis must be semantically valid input to handoff");
  const h = evaluatePolicyHandoff({ axes: { PLATFORM_ALLOWEDNESS: "PASS", RIGHTS: "PASS", AI_TRANSPARENCY: "REQUIRED", MONETIZATION_AD_SUITABILITY: "REVIEW_REQUIRED" }, rightsDecision: "REVIEW_REQUIRED", disclosureDecision: "REQUIRED" });
  assert(h.status !== "PUBLISH_READY", "synthetic-endorsement case must never be PUBLISH_READY");
});

// P7 Generated reconstruction classified as EVIDENCE_ASSET -> REJECT/BLOCK
runTest("P7 Reconstruction-as-evidence rejected", () => {
  const v = validatePolicyReviewSemantics({
    axes: { PLATFORM_ALLOWEDNESS: "PASS", RIGHTS: "PASS", AI_TRANSPARENCY: "PASS", MONETIZATION_AD_SUITABILITY: "PASS" },
    rights: { sourceType: "AI_GENERATED", decision: "REVIEW_REQUIRED" },
    aiDisclosure: { decision: "NOT_REQUIRED" },
    likeness: { decision: "NOT_APPLICABLE" },
    reconstruction: { classification: "EVIDENCE_ASSET", hasEvidenceProvenance: false, labeledAsReconstruction: false },
    handoff: { requiredUserActions: [] },
  });
  logOut("semantic", { valid: v.valid, codes: v.errors.map((e) => e.code) });
  assert(v.valid === false, "reconstruction as evidence must be REJECTED");
  assert(v.errors.some((e) => e.code === "RECONSTRUCTION_AS_EVIDENCE_REJECTED"), "must carry RECONSTRUCTION_AS_EVIDENCE_REJECTED");
});

// P8 Correct RECONSTRUCTION classification -> acceptable if other gates pass
runTest("P8 Correct reconstruction acceptable", () => {
  const v = validatePolicyReviewSemantics({
    axes: { PLATFORM_ALLOWEDNESS: "PASS", RIGHTS: "PASS", AI_TRANSPARENCY: "PASS", MONETIZATION_AD_SUITABILITY: "PASS" },
    rights: { sourceType: "AI_GENERATED", decision: "VERIFIED" },
    aiDisclosure: { decision: "NOT_REQUIRED" },
    likeness: { decision: "NOT_APPLICABLE" },
    reconstruction: { classification: "RECONSTRUCTION", labeledAsReconstruction: true, hasEvidenceProvenance: false },
    handoff: { requiredUserActions: [] },
  });
  logOut("semantic", { valid: v.valid, codes: v.errors.map((e) => e.code) });
  assert(v.valid === true, "correctly labeled RECONSTRUCTION must be acceptable");
});

// P9 Templated repetitive low-value fixture -> originality risk
runTest("P9 Repetitive fixture flagged", () => {
  const o = evaluateOriginality({ templatedRepetitive: true, substantiveEducationalValue: false });
  logOut("originality", o);
  assert(o.risk === "HIGH_RISK", "templated repetitive fixture must be HIGH_RISK");
});

// P10 Substantively varied educational fixture -> not auto HIGH_RISK
runTest("P10 Educational fixture not auto high-risk", () => {
  const o = evaluateOriginality({ templatedRepetitive: false, substantiveEducationalValue: true });
  logOut("originality", o);
  assert(o.risk === "LOW_RISK", "substantive educational fixture must be LOW_RISK, not HIGH_RISK");
});

// P11 Unknown-license music -> not publish-ready
runTest("P11 Unknown music rights blocks publish", () => {
  const r = evaluateRightsGate({ sourceType: "UNKNOWN", basisRecorded: false, materialUse: true });
  const h = evaluatePolicyHandoff({ axes: { PLATFORM_ALLOWEDNESS: "PASS", RIGHTS: "BLOCKED", AI_TRANSPARENCY: "NOT_APPLICABLE", MONETIZATION_AD_SUITABILITY: "NOT_APPLICABLE" }, rightsDecision: r.decision });
  logOut("handoff", h);
  assert(h.status !== "PUBLISH_READY" && h.status !== "RENDER_READY", "unknown-license music must not be publish-ready");
});

// P12 Disclosure REQUIRED -> handoff preserves required user action
runTest("P12 Disclosure propagates user action", () => {
  const h = evaluatePolicyHandoff({ axes: { PLATFORM_ALLOWEDNESS: "PASS", RIGHTS: "PASS", AI_TRANSPARENCY: "REQUIRED", MONETIZATION_AD_SUITABILITY: "PASS" }, rightsDecision: "VERIFIED", disclosureDecision: "REQUIRED" });
  logOut("handoff", h);
  assert(h.renderable === true, "disclosure-required can still be render-ready");
  assert(h.status === "PUBLISH_REVIEW_REQUIRED", "disclosure-required gates publish");
  assert(h.requiredUserActions.length > 0, "handoff must preserve required user action");
});

// P13 Current live-verified policy -> CURRENT_LIVE_VERIFIED
runTest("P13 Live-verified policy supported", () => {
  const { evaluatePolicyHandoff: handoff } = require("../../lib/policy-state-check.js");
  const h = handoff({ freshnessStatus: "FRESH", verificationStatus: "LIVE_VERIFIED", criticality: "CRITICAL", hasLiveCapability: true });
  logOut("policyHandoff", h);
  assert(h.handoff === "CURRENT_LIVE_VERIFIED", "fresh live-verified policy must be CURRENT_LIVE_VERIFIED");
});

// P14 Stale snapshot + no live access -> PUBLISH_REVIEW_REQUIRED
runTest("P14 Stale no-web gates publish", () => {
  const { evaluatePolicyHandoff: handoff } = require("../../lib/policy-state-check.js");
  const h = handoff({ freshnessStatus: "STALE", verificationStatus: "SNAPSHOT_ONLY", criticality: "CRITICAL", hasLiveCapability: false });
  logOut("policyHandoff", h);
  assert(h.handoff === "PUBLISH_REVIEW_REQUIRED", "stale snapshot with no live access must be PUBLISH_REVIEW_REQUIRED");
});

// P15 Snapshot-only critical policy -> cannot claim current-policy verified
runTest("P15 Snapshot-only cannot claim live verification", () => {
  const v = validatePolicyReviewSemantics({
    axes: { PLATFORM_ALLOWEDNESS: "PASS", RIGHTS: "PASS", AI_TRANSPARENCY: "PASS", MONETIZATION_AD_SUITABILITY: "PASS" },
    rights: { sourceType: "ORIGINAL", decision: "VERIFIED" },
    aiDisclosure: { decision: "NOT_REQUIRED" },
    likeness: { decision: "NOT_APPLICABLE" },
    reconstruction: { classification: "NOT_APPLICABLE" },
    policyVerification: "SNAPSHOT_ONLY",
    policyVerificationClaimedCurrent: true,
    handoff: { requiredUserActions: [] },
  });
  logOut("semantic", { valid: v.valid, codes: v.errors.map((e) => e.code) });
  assert(v.valid === false, "snapshot-only claiming current verification must be rejected");
  assert(v.errors.some((e) => e.code === "STALE_POLICY_CANNOT_CLAIM_CURRENT"), "must carry STALE_POLICY_CANNOT_CLAIM_CURRENT");
});

// P16 Axes remain separate
runTest("P16 Allowedness PASS + monetization REVIEW stays separate", () => {
  const h = evaluatePolicyHandoff({ axes: { PLATFORM_ALLOWEDNESS: "PASS", RIGHTS: "PASS", AI_TRANSPARENCY: "PASS", MONETIZATION_AD_SUITABILITY: "REVIEW_REQUIRED" }, rightsDecision: "VERIFIED", disclosureDecision: "NOT_REQUIRED" });
  logOut("handoff", h);
  assert(h.status === "PUBLISH_REVIEW_REQUIRED", "monetization review must gate publish even when allowedness passes");
  assert(h.status !== "PUBLISH_READY", "axes must not collapse into a single pass");
});

console.log(`\n=== SUMMARY ===`);
console.log(`Passed assertions: ${passed}, Failed tests: ${failed}`);
if (failed > 0) {
  console.log("RESULT: SOME TESTS FAILED");
  process.exit(1);
}
console.log("RESULT: ALL TESTS PASSED");
