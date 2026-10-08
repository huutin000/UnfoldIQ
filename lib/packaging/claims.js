"use strict";

/**
 * Phase 4A §21–§23 — Claim Fidelity Model + Gate (UNFOLDIQ CORE).
 *
 * Every material packaging claim maps to video content and/or research
 * evidence. UNSUPPORTED material claims BLOCK; PARTIAL/absolute-language/
 * synthetic-as-footage REVIEW. Repair never fabricates support.
 */

const ABSOLUTE_LANGUAGE = /\b(guaranteed|never fails|always|everyone knows|nobody|impossible|100%|scientifically proven|all scientists agree)\b/i;

function finding(code, extra = {}) {
  return { code, severity: extra.severity || "REVIEW", variantId: extra.variantId || null, field: extra.field || null, reason: extra.reason || code, correctiveAction: extra.correctiveAction || null };
}

/**
 * evidenceClaims: [{ claimId, text, supportType: "EVIDENCE"|"VIDEO_CONTENT"|"BOTH" }]
 * videoSupport: { claimIds: string[] } — claims literally covered by script/timeline.
 */
function resolveClaimStatus(claimRef, evidenceById, videoClaimIds) {
  const ev = evidenceById.get(claimRef);
  const inVideo = videoClaimIds.has(claimRef);
  if (ev && (ev.supportType === "BOTH" || (ev.supportType === "EVIDENCE" && inVideo) || (ev.supportType === "VIDEO_CONTENT" && inVideo))) {
    return { status: ev.supportType === "VIDEO_CONTENT" && !inVideo ? "PARTIAL" : "SUPPORTED", supportType: ev.supportType };
  }
  if (ev) return { status: "PARTIAL", supportType: ev.supportType };
  if (inVideo) return { status: "SUPPORTED", supportType: "VIDEO_CONTENT" };
  return { status: "UNSUPPORTED", supportType: null };
}

function buildClaimMap(variant, context = {}) {
  const evidenceById = new Map(((context.evidenceClaims || []).map((c) => [c.claimId, c])));
  const videoClaimIds = new Set((context.videoSupport && context.videoSupport.claimIds) || []);
  const claims = [];
  const push = (claimId, text, source) => {
    const r = resolveClaimStatus(claimId, evidenceById, videoClaimIds);
    claims.push({ claimId, text, source, supportRefs: r.status === "UNSUPPORTED" ? [] : [claimId], supportType: r.supportType, status: r.status });
  };
  if (variant.title.primaryClaim) push(variant.title.primaryClaim, variant.title.text, "TITLE");
  for (const cr of variant.title.claimRefs) {
    if (!claims.some((c) => c.claimId === cr)) push(cr, variant.title.text, "TITLE");
  }
  // A visual claim backed by claimRefs inherits their support; only a
  // ref-less visual claim stands alone (and then must find support).
  if (variant.thumbnail.visualClaim && !(variant.thumbnail.claimRefs || []).length) {
    push(`thumb:${variant.variantId}`, variant.thumbnail.visualClaim, "THUMBNAIL_VISUAL");
  }
  for (const cr of variant.thumbnail.claimRefs || []) {
    if (!claims.some((c) => c.claimId === cr)) push(cr, variant.thumbnail.visualClaim || "(visual)", "THUMBNAIL_VISUAL");
  }
  return claims;
}

/** Fidelity gate for one variant: BLOCK/REVIEW findings, machine-readable. */
function gateVariantClaims(variant, context = {}) {
  const findings = [];
  const claims = buildClaimMap(variant, context);
  for (const c of claims) {
    const field = c.source === "TITLE" ? "title" : c.source.startsWith("THUMBNAIL") ? "thumbnail" : "description";
    if (c.status === "UNSUPPORTED") {
      const code = c.source === "TITLE" ? "TITLE_UNSUPPORTED_CLAIM"
        : c.source.startsWith("THUMBNAIL") ? "THUMBNAIL_UNSUPPORTED_CLAIM" : "DESCRIPTION_UNSUPPORTED_CLAIM";
      findings.push(finding(code, { severity: "BLOCK", variantId: variant.variantId, field, reason: `material ${c.source} claim without support: "${c.text}"`, correctiveAction: "REDUCE_CLAIM" }));
      findings.push(finding("MISLEADING_PACKAGING", { severity: "BLOCK", variantId: variant.variantId, field, reason: `packaging promises what content does not deliver: "${c.text}"`, correctiveAction: "REDUCE_CLAIM" }));
    } else if (c.status === "PARTIAL") {
      findings.push(finding("MISLEADING_PACKAGING", { severity: "REVIEW", variantId: variant.variantId, field, reason: `partially supported claim: "${c.text}"`, correctiveAction: "ADD_CONTEXT" }));
    }
  }
  // Absolute language scan on title + thumbnail text.
  for (const [text, field] of [[variant.title.text, "title"], [variant.thumbnail.textOverlay || "", "thumbnail"]]) {
    if (text && ABSOLUTE_LANGUAGE.test(text)) {
      findings.push(finding("MISLEADING_PACKAGING", { severity: "REVIEW", variantId: variant.variantId, field, reason: `absolute language without calibrated support: "${text}"`, correctiveAction: "REDUCE_CLAIM" }));
    }
  }
  // Synthetic imagery that may read as factual footage.
  if ((variant.thumbnail.sourceType === "GENERATED" || variant.thumbnail.sourceType === "ILLUSTRATION")
    && /real|footage|photo|caught on camera|documentary/i.test(`${variant.thumbnail.visualClaim} ${variant.title.text}`)) {
    findings.push(finding("THUMBNAIL_POLICY_REVIEW", { severity: "REVIEW", variantId: variant.variantId, field: "thumbnail", reason: "synthetic imagery may be mistaken for factual footage", correctiveAction: "CHANGE_VISUAL_CLAIM" }));
  }
  // Title ↔ thumbnail consistency: shared claim refs or shared angle.
  const titleRefs = new Set(variant.title.claimRefs || []);
  const thumbRefs = new Set(variant.thumbnail.claimRefs || []);
  const shared = [...titleRefs].some((r) => thumbRefs.has(r));
  if (!shared && titleRefs.size > 0 && thumbRefs.size > 0) {
    findings.push(finding("TITLE_THUMBNAIL_MISMATCH", { severity: "REVIEW", variantId: variant.variantId, field: "pair", reason: "title and thumbnail argue disjoint claims", correctiveAction: "ALIGN_PAIR" }));
  }
  // Packaging ↔ video: every title claim must be in video support or evidence.
  const videoClaimIds = new Set((context.videoSupport && context.videoSupport.claimIds) || []);
  for (const cr of variant.title.claimRefs || []) {
    const ev = (context.evidenceClaims || []).some((c) => c.claimId === cr);
    if (!videoClaimIds.has(cr) && !ev) {
      findings.push(finding("PACKAGING_VIDEO_MISMATCH", { severity: "BLOCK", variantId: variant.variantId, field: "title", reason: `claim ${cr} covered by neither video nor evidence`, correctiveAction: "REDUCE_CLAIM" }));
    }
  }
  return { claims, findings };
}

module.exports = { buildClaimMap, gateVariantClaims, ABSOLUTE_LANGUAGE };
