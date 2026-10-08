"use strict";

/**
 * Phase 4B §41–§43 — Final Content QA + watch pass (UNFOLDIQ CORE).
 *
 * Publishability check on the actual rendered pilot (not Phase 6 creative
 * optimization). Every check is evidence-backed; the watch pass covers
 * start/middle/end with extracted frame evidence.
 */

const CONTENT_VERSION = "1.0.0";

function finding(code, extra = {}) {
  return {
    code, severity: extra.severity || "BLOCK", sceneRef: extra.sceneRef || null,
    reason: extra.reason || code, correctiveAction: extra.correctiveAction || null,
    evidenceRefs: extra.evidenceRefs || [],
  };
}

/**
 * evidence: { hookText?, sceneIds[], scriptSections[], factualClaims[],
 *   fictionLabeled?, evidenceRefsComplete?, naturalnessNotes?, continuityOk?,
 *   visualFactualityOk?, captionAcceptable?, pacingBrokenRegions[],
 *   rightsComplete?, metadataComplete?, debugMarkersFound[],
 *   sampleFrames: {start,middle,end} }
 */
function checkFinalContent(evidence = {}) {
  const findings = [];
  if (!evidence.hookText) findings.push(finding("HOOK_MISSING", { reason: "no hook present in pilot" }));
  const sections = new Set(evidence.scriptSections || []);
  for (const s of ["hook", "body", "conclusion"]) {
    if (!sections.has(s)) findings.push(finding("NARRATIVE_INCOMPLETE", { reason: `missing section: ${s}` }));
  }
  for (const c of evidence.factualClaims || []) {
    if (!c.supported) findings.push(finding("FACTUAL_SUPPORT_GAP", { reason: `unsupported factual claim: ${c.text}` }));
  }
  if (evidence.hasFictionalContent && !evidence.fictionLabeled) {
    findings.push(finding("FICTION_LABEL_MISSING", { reason: "fictional/reconstructed content unlabeled" }));
  }
  if (evidence.evidenceRefsComplete === false) {
    findings.push(finding("FACTUAL_SUPPORT_GAP", { reason: "evidence references incomplete" }));
  }
  if (evidence.continuityOk === false) findings.push(finding("VISUAL_CONTINUITY_BREAK", { reason: "visual continuity break reported" }));
  if (evidence.visualFactualityOk === false) findings.push(finding("VISUAL_FACTUALITY_FAIL", { reason: "visual factuality failure reported" }));
  if (evidence.captionAcceptable === false) findings.push(finding("CAPTION_QUALITY_FAIL", { reason: "caption quality unacceptable" }));
  for (const r of evidence.pacingBrokenRegions || []) {
    findings.push(finding("PACING_BROKEN", { sceneRef: r.sceneId || null, reason: r.reason || "broken pacing region" }));
  }
  if (evidence.rightsComplete === false) findings.push(finding("RIGHTS_INCOMPLETE", { reason: "rights incomplete" }));
  if (evidence.metadataComplete === false) findings.push(finding("METADATA_INCOMPLETE", { reason: "metadata incomplete" }));
  if ((evidence.debugMarkersFound || []).length) {
    findings.push(finding("DEBUG_CONTENT_VISIBLE", { reason: `debug content: ${evidence.debugMarkersFound.join(",")}` }));
  }
  // Watch pass: start/middle/end sample frames must exist.
  const sf = evidence.sampleFrames || {};
  for (const k of ["start", "middle", "end"]) {
    if (!sf[k]) findings.push(finding("FINAL_CONTENT_FAIL", { reason: `watch pass missing ${k} sample` }));
  }
  const blocks = findings.filter((f) => f.severity === "BLOCK");
  return { status: blocks.length ? "FAIL" : findings.length ? "REVIEW_REQUIRED" : "PASS", findings };
}

module.exports = { CONTENT_VERSION, checkFinalContent };
