"use strict";

/**
 * 1G.7 platform adaptation engine (PHASE 1G.7, Prompt 01, §§9–15, §22).
 * Cheapest / least destructive first:
 * PRESERVE → REFRAME → RELAYOUT → REFRAME+RELAYOUT → RECOMPOSE → REGENERATE.
 * Never jumps to regeneration for platform/aspect reasons alone; aesthetic
 * preference is not an input at all. Factual meaning is verified from
 * caller-declared regions/elements — unverifiable meaning yields REVIEW with
 * ADAPTATION_SEMANTIC_RISK, never silent loss. Deterministic, no rendering.
 */

const shared = require("./shared.js");
const densityLib = require("./density.js");

const RELEVANT_RELAYOUT = {
  MAP: "portrait-crop-with-label-relocation",
  TIMELINE: "vertical-segmented-timeline",
  CHART: "portrait-chart-reflow-values-verbatim",
  DIAGRAM: "portrait-diagram-reflow",
  TYPOGRAPHY: "portrait-type-reflow",
  COMPARISON: "stacked-comparison",
  ANNOTATION: "relocated-callouts",
  SPLIT_SCREEN: "stacked-split",
  MOTION_GRAPHIC: "portrait-motion-composition",
};

function sourcedZones(targetProfile) {
  const policy = targetProfile.safeZonePolicy || {};
  return ((policy.zones || []).filter((z) => z && z.region && (z.status === "VERIFIED" || z.status === "PARTIAL")));
}

function unknownZones(targetProfile) {
  const policy = targetProfile.safeZonePolicy || {};
  return ((policy.zones || []).filter((z) => z && !z.region));
}

function anchorCx(master, forceAnchor) {
  if (forceAnchor && typeof forceAnchor.cx === "number") return shared.clamp01(forceAnchor.cx);
  const anchors = [...(master.primarySubjectAnchors || []), ...(master.focalPoints || [])];
  if (anchors.length === 0) return 0.5;
  return shared.clamp01(anchors.reduce((s, r) => s + r.x + r.w / 2, 0) / anchors.length);
}

function essentialRegions(master) {
  // Protected/subject/data regions always carry meaning. Text regions carry
  // factual meaning verbatim (labels, values, quotes) and must survive the
  // crop. Graphic panels carry meaning only when spatial arrangement IS the
  // message (comparison layouts).
  const graphicEssential = ["COMPARISON", "SPLIT_SCREEN"].includes(master.visualModality);
  return [
    ...(master.protectedRegions || []),
    ...(master.primarySubjectAnchors || []),
    ...(master.dataPoints || []),
    ...(master.textRegions || []),
    ...(graphicEssential ? (master.graphicRegions || []) : []),
  ];
}

/**
 * Adapt one master composition to one platform target.
 * Input: { master, targetProfile, options?: { forceCropAnchor?, keepMasterAspect?,
 *   recomposeFromAssets?, acknowledgeRisk?, now? } }
 */
function adaptToTarget(input = {}) {
  const { master, targetProfile } = input;
  const options = input.options || {};
  const now = options.now || new Date().toISOString();
  const reasons = [];
  const warnings = [];
  const risks = [];
  const blockers = [];

  if (!master || !master.compositionId) {
    return { ok: false, code: "ADAPTATION_SOURCE_INVALID", message: "master composition is required" };
  }
  if (!targetProfile || !targetProfile.platformId) {
    return { ok: false, code: "ADAPTATION_TARGET_INVALID", message: "target platform profile is required" };
  }

  const targetAspect = options.keepMasterAspect ? master.sourceAspectRatio : targetProfile.preferredAspectRatio;
  const accepted = targetProfile.acceptedAspectRatios || [];
  if (targetAspect !== targetProfile.preferredAspectRatio && !accepted.includes(targetAspect)) {
    return { ok: false, code: "INVALID_ASPECT_POLICY", message: `aspect ${targetAspect} is neither preferred nor accepted for ${targetProfile.platformId}` };
  }
  reasons.push(`target ${targetAspect} for ${targetProfile.platformId} (preferred ${targetProfile.preferredAspectRatio}${options.keepMasterAspect ? ", operator-kept master aspect" : ""})`);

  const sameAspect = Math.abs(shared.aspectValue(master.sourceAspectRatio) - shared.aspectValue(targetAspect)) < 1e-9;
  const cx = anchorCx(master, options.forceCropAnchor);
  const crop = shared.cropWindow(master.sourceAspectRatio, targetAspect, cx);
  const essential = essentialRegions(master);
  const uncovered = essential.filter((r) => !shared.rectContains(crop, r));
  const cropAdequate = uncovered.length === 0;
  if (essential.length === 0) {
    warnings.push("NO_DECLARED_REGIONS: no protected/subject/data regions declared; center-anchored crop assumed — verify intent");
  } else if (cropAdequate) {
    reasons.push(`reframe crop [${crop.x.toFixed(3)},${crop.y.toFixed(3)},${crop.w.toFixed(3)},${crop.h.toFixed(3)}] preserves ${essential.length} essential region(s)`);
  } else {
    reasons.push(`reframe crop excludes ${uncovered.length} essential region(s): ${(uncovered.map((r) => r.regionId || r.kind).join(", "))}`);
  }

  // --- Text plan: relocate declared text out of SOURCED zones only.
  // UNKNOWN zones constrain nothing (no invented geometry); they are noted.
  const zones = sourcedZones(targetProfile);
  const unknowns = unknownZones(targetProfile);
  if (unknowns.length > 0) {
    warnings.push(`SAFE_ZONE_UNKNOWN: ${unknowns.map((z) => z.zoneId).join(", ")} unconstrained (no verified geometry)`);
  }
  const textPlan = { placements: [], reflowed: [], unplaceable: [] };
  for (const t of master.textRegions || []) {
    const hit = zones.find((z) => shared.rectsOverlap(t, z.region));
    if (!hit) {
      textPlan.placements.push({ regionId: t.regionId, placement: "as-is", content: t.content !== undefined ? t.content : null, reason: "clear of sourced overlays" });
      continue;
    }
    // Relocate: try above the zone, then below, then horizontal shift.
    const relocated = { ...t };
    const aboveH = hit.region.y - 0.01;
    let placed = null;
    if (aboveH >= t.h) placed = { ...relocated, y: Math.max(0, aboveH - t.h) };
    else if (1 - (hit.region.y + hit.region.h) - 0.01 >= t.h) {
      placed = { ...relocated, y: hit.region.y + hit.region.h + 0.01 };
    }
    if (placed && placed.content !== undefined) placed.content = t.content; // verbatim, never rewritten
    if (placed) {
      textPlan.placements.push({ regionId: t.regionId, placement: "relocated", content: t.content !== undefined ? t.content : null, from: { x: t.x, y: t.y }, to: { x: placed.x, y: placed.y }, reason: `clear of ${hit.zoneId}` });
      textPlan.reflowed.push(t.regionId);
    } else {
      textPlan.unplaceable.push(t.regionId);
    }
  }

  // --- Caption plan: composition policy only (no timings, ever).
  const captionPlan = {
    regionPreference: (targetProfile.captionPolicy && targetProfile.captionPolicy.regionPreference) || null,
    maxOccupancy: (targetProfile.captionPolicy && targetProfile.captionPolicy.maxOccupancy) || null,
    placementIntent: (targetProfile.captionPolicy && targetProfile.captionPolicy.placement) || null,
    captionIntent: master.captionIntent || null,
    note: "caption composition policy only — timings belong later",
  };

  // --- Graphic/relayout plan for deterministic modalities.
  const modality = master.visualModality || null;
  const relayoutCapable = modality && shared.RELAYOUT_MODALITIES.includes(modality);
  const relayoutPlan = relayoutCapable ? {
    strategy: RELEVANT_RELAYOUT[modality],
    modality,
    carriedElements: [...(master.dataPoints || []), ...(master.textRegions || []), ...(master.graphicRegions || [])]
      .map((r) => ({ regionId: r.regionId, kind: r.kind, content: r.content !== undefined ? r.content : null })),
  } : null;

  // --- Decide action along the cheapest-first ladder.
  let action = "PRESERVE";
  let status = "ADAPTED";
  let regenerationDecision = "NOT_REQUIRED";
  const regenerationReasons = [];
  const preservedIntent = [];

  if (master.visualModality) preservedIntent.push(`visual modality ${master.visualModality} unchanged (platform never re-grammars)`);
  if (master.renderMode) preservedIntent.push(`render mode ${master.renderMode} unchanged (no silent promote/demote)`);
  if (master.sceneIntent) preservedIntent.push(`scene intent preserved`);
  if ((master.continuityRefs || []).length > 0) preservedIntent.push(`continuity refs carried`);

  if (sameAspect) {
    action = "PRESERVE";
    reasons.push("same aspect: master composition preserved");
  } else if (!cropAdequate && !relayoutCapable) {
    // Essential loss with no deterministic relayout path → targeted regeneration.
    action = "REGENERATE_REQUIRED";
    regenerationDecision = "TARGETED_REGENERATION_REQUIRED";
    for (const r of uncovered) {
      regenerationReasons.push(`essential ${(r.kind || "region")} ${(r.regionId || "")} irrecoverable outside ${targetAspect} crop and modality ${modality || "unknown"} has no deterministic relayout`.trim());
    }
    risks.push("ADAPTATION_SEMANTIC_RISK: crop would remove essential intent; regeneration scoped to this shot only");
  } else if (!cropAdequate && relayoutCapable && options.recomposeFromAssets && options.recomposeFromAssets.length > 0) {
    action = "RECOMPOSE";
    reasons.push(`recompose from existing assets [${options.recomposeFromAssets.join(", ")}] — no new media generated by this phase`);
    if (relayoutPlan && (master.dataPoints || []).length > 0) {
      preservedIntent.push(`factual elements carried verbatim (${master.dataPoints.length} data point(s))`);
    }
  } else if (!cropAdequate && relayoutCapable) {
    action = "RELAYOUT";
    reasons.push(`relayout ${relayoutPlan.strategy}: deterministic portrait adaptation, not media regeneration`);
    const verifiable = [...(master.dataPoints || []), ...(master.textRegions || []), ...(master.graphicRegions || [])]
      .some((r) => (r.content !== undefined && r.content !== null) || r.kind === "value" || r.kind === "route");
    if ((master.dataPoints || []).length > 0 || (master.textRegions || []).length > 0 || verifiable) {
      preservedIntent.push(`factual elements carried verbatim (${(master.dataPoints || []).length} data, ${(master.textRegions || []).length} text)`);
    } else {
      risks.push("ADAPTATION_SEMANTIC_RISK: relayout has no declared verifiable elements — meaning assumed, review advised");
      status = "REVIEW_REQUIRED";
    }
  } else if (textPlan.reflowed.length > 0 || (relayoutCapable && (master.graphicRegions || []).length > 0)) {
    action = "REFRAME_AND_RELAYOUT";
    reasons.push(`crop adequate; ${textPlan.reflowed.length} text region(s) relocated and/or graphics reflowed for ${targetAspect}`);
    if ((master.dataPoints || []).length > 0) preservedIntent.push(`factual data points inside crop, carried verbatim`);
  } else {
    action = "REFRAME";
    reasons.push(`crop adequate for ${targetAspect}; no text/graphic conflicts`);
    if ((master.dataPoints || []).length > 0) preservedIntent.push(`factual data points inside crop, carried verbatim`);
  }

  if (textPlan.unplaceable.length > 0 && status === "ADAPTED" && regenerationDecision === "NOT_REQUIRED") {
    status = "REVIEW_REQUIRED";
    risks.push(`TEXT_UNPLACEABLE: ${textPlan.unplaceable.join(", ")} cannot clear sourced overlays — operator judgment required (reflow/relocate/split exhausted)`);
  }

  const density = densityLib.densityTier({ platformId: targetProfile.platformId, narrativeRole: options.narrativeRole, visualModality: modality, importance: options.importance });
  const pacing = densityLib.pacingGuidance({ platformId: targetProfile.platformId, targetDurationBand: options.targetDurationBand });

  const adaptationId = shared.id12("pa", { master: master.compositionId, platform: targetProfile.platformId, aspect: targetAspect, action });
  const artifact = {
    version: shared.PLATFORM_POLICY_VERSION,
    adaptationId,
    projectId: master.projectId,
    sceneId: options.sceneId || null,
    shotId: master.sourceShotId,
    platformId: targetProfile.platformId,
    platformProfileVersion: targetProfile.version,
    platformProfileFingerprint: targetProfile.fingerprint,
    safeZoneEvidenceVersion: safeZoneEvidenceVersion(targetProfile),
    sourceCompositionId: master.compositionId,
    sourceFingerprint: master.sourceFingerprint,
    sourceModality: modality,
    sourceRenderMode: master.renderMode,
    targetAspectRatio: targetAspect,
    action,
    cropPlan: sameAspect ? null : { window: crop, anchorCx: cx, adequate: cropAdequate, uncovered: uncovered.map((r) => r.regionId || r.kind) },
    reframePlan: (action === "REFRAME" || action === "REFRAME_AND_RELAYOUT") ? { window: crop, anchorCx: cx } : null,
    relayoutPlan: (action === "RELAYOUT" || action === "REFRAME_AND_RELAYOUT" || action === "RECOMPOSE") ? relayoutPlan : null,
    recomposeAssets: action === "RECOMPOSE" ? [...options.recomposeFromAssets] : [],
    textPlan,
    captionPlan,
    graphicPlan: { preferVectorRelayout: true, relocated: (action === "RELAYOUT" || action === "REFRAME_AND_RELAYOUT") },
    densityGuidance: density,
    pacingGuidance: pacing,
    preservedIntent,
    risks,
    warnings,
    blockers,
    regenerationDecision,
    regenerationReasons,
    sourceRefs: collectSourceRefs(targetProfile),
    policyVersion: shared.POLICY_VERSION,
    fingerprint: null,
    status,
    createdAt: now,
    updatedAt: now,
  };
  artifact.fingerprint = shared.hash16({
    master: master.sourceFingerprint, platform: targetProfile.platformId,
    profile: targetProfile.fingerprint, aspect: targetAspect, action,
    crop: artifact.cropPlan, text: textPlan, relayout: artifact.relayoutPlan,
    regen: regenerationDecision, policy: shared.POLICY_VERSION,
  });
  return { ok: true, status, artifact, reasons };
}

function safeZoneEvidenceVersion(targetProfile) {
  const policy = targetProfile.safeZonePolicy || {};
  return shared.hash16({ zones: policy.zones || [], verifiedAt: policy.verifiedAt || null });
}

function collectSourceRefs(targetProfile) {
  const ids = new Set();
  for (const s of targetProfile.sources || []) ids.add(s.sourceId);
  for (const z of ((targetProfile.safeZonePolicy || {}).zones || [])) {
    for (const id of z.sourceRefs || []) ids.add(id);
  }
  return [...ids];
}

module.exports = { adaptToTarget, RELEVANT_RELAYOUT, sourcedZones };
