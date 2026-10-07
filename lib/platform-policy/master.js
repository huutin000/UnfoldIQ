"use strict";

/**
 * 1G.7 master composition builder (PHASE 1G.7, Prompt 01, §8).
 * Treats the source visual composition as reusable master intent.
 * Reads story/shot state (read-only); owns no semantics — 1G.5 stays the
 * owner of modality, render mode, capabilities, reference strategy.
 * Regions are caller-declared (analyst/layout input); undeclared regions are
 * honestly absent (never invented), which downstream adaptation must handle.
 */

const shared = require("./shared.js");

function normRegion(r) {
  if (!r || typeof r !== "object") return null;
  const out = {
    regionId: r.regionId || null,
    kind: r.kind || "generic",
    x: shared.clamp01(r.x), y: shared.clamp01(r.y),
    w: shared.clamp01(r.w), h: shared.clamp01(r.h),
    label: r.label || null,
    content: r.content !== undefined ? r.content : null, // factual text/value carried verbatim
  };
  if (!out.regionId || !(out.w > 0) || !(out.h > 0)) return null;
  return out;
}

/**
 * Input: { projectId, shot, scene?, decision? (1G.5, read-only),
 *   sourceAspectRatio, regions?: { subjectAnchors?, protectedRegions?,
 *   textRegions?, graphicRegions?, dataPoints?, focalPoints?,
 *   essentialContextRegions? }, captionIntent?, sceneIntent?, now? }
 */
function buildMasterComposition(input = {}) {
  const { shot } = input;
  if (!shot || !shot.shotId) {
    return { ok: false, code: "MASTER_SOURCE_INVALID", message: "a shot is required" };
  }
  const sourceAspectRatio = input.sourceAspectRatio || "16:9";
  if (!shared.aspectValue(sourceAspectRatio)) {
    return { ok: false, code: "MASTER_ASPECT_INVALID", message: `sourceAspectRatio ${sourceAspectRatio} is not a valid aspect` };
  }
  const regions = input.regions || {};
  const pick = (list) => (Array.isArray(list) ? list : []).map(normRegion).filter(Boolean);
  const master = {
    version: shared.PLATFORM_POLICY_VERSION,
    compositionId: shared.id12("mc", { shotId: shot.shotId, aspect: sourceAspectRatio, regions }),
    sourceShotId: shot.shotId,
    projectId: input.projectId || (shot && shot.projectId) || null,
    visualModality: (input.decision && input.decision.visualModality) || input.visualModality || null,
    renderMode: (input.decision && input.decision.renderMode) || null,
    sourceAspectRatio,
    primarySubjectAnchors: pick(regions.subjectAnchors),
    protectedRegions: pick(regions.protectedRegions),
    textRegions: pick(regions.textRegions),
    captionIntent: input.captionIntent || null,
    graphicRegions: pick(regions.graphicRegions),
    focalPoints: pick(regions.focalPoints),
    essentialContextRegions: pick(regions.essentialContextRegions),
    dataPoints: pick(regions.dataPoints), // chart values / map endpoints / timeline nodes, content verbatim
    sceneIntent: input.sceneIntent || (input.scene && input.scene.narrativePurpose) || null,
    factualMeaningRefs: [...(shot.claimRefs || []), ...((input.decision && input.decision.claimRefs) || [])].filter((v, i, a) => a.indexOf(v) === i),
    continuityRefs: [...(shot.continuityRefs || [])],
    sourceDecisionRef: input.decision ? { decisionId: input.decision.decisionId || null, fingerprint: input.decision.fingerprint || null } : null,
    sourceFingerprint: null,
    policyVersion: shared.POLICY_VERSION,
    declaredRegionCount: 0,
    createdAt: input.now || new Date().toISOString(),
  };
  master.declaredRegionCount = master.primarySubjectAnchors.length + master.protectedRegions.length
    + master.textRegions.length + master.graphicRegions.length + master.dataPoints.length
    + master.focalPoints.length + master.essentialContextRegions.length;
  master.sourceFingerprint = shared.hash16({
    shot: shared.hash16(shot), aspect: sourceAspectRatio, regions,
    modality: master.visualModality, decision: master.sourceDecisionRef,
  });
  return { ok: true, master };
}

module.exports = { buildMasterComposition, normRegion };
