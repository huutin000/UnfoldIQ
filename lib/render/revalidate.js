"use strict";

/**
 * Phase 4B §44–§47 — Packaging claim revalidation + publish finalize.
 *
 * Phase 4A validated claims against script/evidence/timeline. 4B revalidates
 * the SELECTED title/thumbnail/description against the actual final.mp4:
 * claim video segments must exist in the rendered timeline, the thumbnail
 * subject must relate to final visuals, description chapters must fit the
 * encoded duration. Staleness → FINAL_PACKAGING_VIDEO_MISMATCH.
 */

const REVALIDATE_VERSION = "1.0.0";

function finding(code, extra = {}) {
  return {
    code, severity: extra.severity || "BLOCK", variantId: extra.variantId || null,
    reason: extra.reason || code, correctiveAction: extra.correctiveAction || null,
    evidenceRefs: extra.evidenceRefs || [],
  };
}

/**
 * selected: PackagingVariant; renderFacts: { claimSegments: {claimId: {present, startSec, endSec}},
 *   visualAssetIds: string[], durationSec, thumbnailSubjectInVideo: bool }
 */
function revalidatePackaging(selected, renderFacts = {}) {
  const findings = [];
  const segs = renderFacts.claimSegments || {};
  for (const cr of selected.title.claimRefs || []) {
    const s = segs[cr];
    if (!s || !s.present) {
      findings.push(finding("FINAL_PACKAGING_VIDEO_MISMATCH", { variantId: selected.variantId, reason: `title claim ${cr} absent from final render`, correctiveAction: "PATCH_PACKAGING" }));
    }
  }
  for (const cr of selected.thumbnail.claimRefs || []) {
    const s = segs[cr];
    if (!s || !s.present) {
      findings.push(finding("FINAL_PACKAGING_VIDEO_MISMATCH", { variantId: selected.variantId, reason: `thumbnail claim ${cr} absent from final render`, correctiveAction: "PATCH_PACKAGING" }));
    }
  }
  if (renderFacts.thumbnailSubjectInVideo === false) {
    findings.push(finding("FINAL_PACKAGING_VIDEO_MISMATCH", { variantId: selected.variantId, reason: "thumbnail subject unrelated to final video", correctiveAction: "PATCH_PACKAGING" }));
  }
  if (renderFacts.descriptionChapters) {
    for (const ch of renderFacts.descriptionChapters) {
      if (ch.seconds > (renderFacts.durationSec || 0) + 1) {
        findings.push(finding("FINAL_PACKAGING_VIDEO_MISMATCH", { variantId: selected.variantId, reason: `chapter ${ch.label} beyond encoded duration`, correctiveAction: "PATCH_PACKAGING" }));
      }
    }
  }
  const blocks = findings.filter((f) => f.severity === "BLOCK");
  return { status: blocks.length ? "FAIL" : findings.length ? "REVIEW_REQUIRED" : "PASS", findings };
}

/** Finalize: resolve pending fields, hash the final video, close compliance. */
function finalizePublishPackage(packageManifest, finalVideo, compliance) {
  const manifest = JSON.parse(JSON.stringify(packageManifest));
  manifest.finalVideoRef = finalVideo.pathRef;
  manifest.finalVideoHash = finalVideo.hash;
  manifest.finalVideoArtifactId = finalVideo.assetId;
  manifest.qaStatus = "PASS";
  manifest.updatedAt = new Date().toISOString();
  const comp = JSON.parse(JSON.stringify(compliance));
  for (const c of comp.compliance ? comp.compliance.checks : comp.checks || []) {
    if (String(c.detail || "").startsWith("PENDING")) {
      c.ok = true;
      c.detail = "RESOLVED_PHASE_4B";
    }
  }
  manifest.uploadChecklist = (manifest.uploadChecklist || "")
    .replace("- [ ] final.mp4 exists and Phase 4B PASS (currently: PENDING_PHASE_4B)", `- [x] final.mp4 exists and Phase 4B PASS (${finalVideo.pathRef})`);
  return { ok: true, manifest, compliance: comp };
}

module.exports = { REVALIDATE_VERSION, revalidatePackaging, finalizePublishPackage };
