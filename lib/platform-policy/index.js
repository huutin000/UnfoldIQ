"use strict";

/**
 * 1G.7 platform-policy facade (PHASE 1G.7, Prompt 01).
 * MASTER COMPOSITION → per-target PLATFORM ADAPTATION (PRESERVE → REFRAME →
 * RELAYOUT → REFRAME+RELAYOUT → RECOMPOSE → REGENERATE_REQUIRED), density +
 * pacing guidance, validated manual override, persistence, staleness.
 *
 * Boundaries (proven by tests): never mutates story/modality/render-mode/
 * registry inputs; never selects provider/model; never generates media;
 * never spends credits; never touches Flow UI.
 */

const shared = require("./shared.js");
const profilesLib = require("./profiles.js");
const masterLib = require("./master.js");
const adaptLib = require("./adapt.js");
const densityLib = require("./density.js");
const validatorLib = require("./validator.js");
const storeLib = require("./store.js");

/**
 * Adapt one shot to one platform target.
 * Input: { projectId?, shot, scene?, decision? (1G.5 read-only),
 *   sourceAspectRatio?, regions?, captionIntent?, sceneIntent?,
 *   platformId, density?: { narrativeRole?, importance?, targetDurationBand? },
 *   options?: { forceCropAnchor?, keepMasterAspect?, recomposeFromAssets?,
 *   acknowledgeRisk?, now? }, repoRoot?, persist?: { root, projectId, force? } }
 */
function adaptShot(input = {}) {
  const built = masterLib.buildMasterComposition(input);
  if (!built.ok) return built;
  const prof = profilesLib.getTargetProfile(input.platformId, { repoRoot: input.repoRoot });
  if (!prof.ok) return { ok: false, code: prof.code, message: prof.message, status: "REVIEW_REQUIRED" };
  const adapted = adaptLib.adaptToTarget({
    master: built.master,
    targetProfile: prof.profile,
    options: {
      ...(input.options || {}),
      sceneId: input.scene ? input.scene.sceneId : (input.shot.parentSceneId || null),
      narrativeRole: (input.density && input.density.narrativeRole) || null,
      importance: (input.density && input.density.importance) || null,
      targetDurationBand: (input.density && input.density.targetDurationBand) || null,
    },
  });
  if (!adapted.ok) return adapted;
  const artifact = { ...adapted.artifact, projectId: input.projectId || adapted.artifact.projectId };
  if (input.persist && input.persist.root) {
    const saved = storeLib.persistAdaptation(input.persist.root, input.persist.projectId || artifact.projectId, artifact, { force: input.persist.force });
    if (!saved.ok) return { ok: false, code: saved.code, message: saved.message };
    artifact.persistedPath = saved.path;
  }
  return { ok: true, status: artifact.status, artifact, reasons: adapted.reasons, master: built.master };
}

/**
 * Adapt a whole sequence (array of shot inputs) to one platform target.
 * One failed shot never cascades: every other adaptation stays reusable.
 */
function adaptSequence(inputs = [], platformId, common = {}) {
  const adaptations = [];
  const failed = [];
  for (const input of inputs) {
    const r = adaptShot({ ...common, ...input, platformId });
    if (!r.ok) {
      failed.push({ shotId: (input.shot && input.shot.shotId) || null, code: r.code, message: r.message });
      continue;
    }
    adaptations.push(r.artifact);
  }
  return { ok: failed.length === 0, adaptations, failed };
}

const OVERRIDE_BLOCKED_FIELDS = ["visualModality", "renderMode", "recommendedModel", "selectedModel", "modelId", "claimRefs", "storyText"];

/**
 * Bounded operator override. Allowed: forceCropAnchor, forceTextRegions
 * (relocated placements), keepMasterAspect, approveReview, requestRegeneration,
 * acknowledgeRisk. Forbidden: essential-info crop without acknowledged risk,
 * modality/provider/story rewrites.
 */
function applyAdaptationOverride(artifactInput, override = {}, context = {}) {
  const warnings = [];
  const blockers = [];
  const artifact = artifactInput ? JSON.parse(JSON.stringify(artifactInput)) : null;
  if (!artifact) return { ok: false, state: "BLOCKED", warnings, blockers: ["ADAPTATION_MISSING"] };
  for (const field of OVERRIDE_BLOCKED_FIELDS) {
    if (override[field] !== undefined) {
      blockers.push(`OVERRIDE_FORBIDDEN: ${field} is owned upstream and cannot be set here`);
    }
  }
  if (!context.master || !context.targetProfile) {
    blockers.push("OVERRIDE_CONTEXT_REQUIRED: master composition + target profile required to re-evaluate");
    return { ok: false, state: "BLOCKED", warnings, blockers };
  }
  if (blockers.length > 0) return { ok: false, state: "BLOCKED", warnings, blockers };

  const options = {
    forceCropAnchor: override.forceCropAnchor,
    keepMasterAspect: override.keepMasterAspect === true,
    recomposeFromAssets: override.recomposeFromAssets,
    acknowledgeRisk: override.acknowledgeRisk === true,
    sceneId: artifact.sceneId,
  };
  const master = context.master;
  const targetProfile = context.targetProfile;
  const cx = options.forceCropAnchor && typeof options.forceCropAnchor.cx === "number"
    ? shared.clamp01(options.forceCropAnchor.cx) : null;
  if (cx !== null && !options.keepMasterAspect) {
    // Forced anchor excluding protected regions needs acknowledged risk.
    const crop = shared.cropWindow(master.sourceAspectRatio, targetProfile.preferredAspectRatio, cx);
    const essential = [...(master.protectedRegions || []), ...(master.primarySubjectAnchors || []), ...(master.dataPoints || [])];
    const lost = essential.filter((r) => !shared.rectContains(crop, r));
    if (lost.length > 0 && !options.acknowledgeRisk) {
      blockers.push(`ESSENTIAL_CROP_BLOCKED: forced anchor excludes ${(lost.map((r) => r.regionId || r.kind).join(", "))} — acknowledge risk explicitly or choose another anchor`);
      return { ok: false, state: "BLOCKED", warnings, blockers };
    }
    if (lost.length > 0) {
      warnings.push(`RISK_ACKNOWLEDGED: forced anchor excludes ${(lost.map((r) => r.regionId || r.kind).join(", "))} by explicit operator choice`);
    }
  }
  const re = adaptLib.adaptToTarget({ master, targetProfile, options });
  if (!re.ok) return { ok: false, state: "BLOCKED", warnings, blockers: [re.message] };
  const next = { ...re.artifact };
  if (override.approveReview === true && next.status === "REVIEW_REQUIRED") {
    next.status = "ADAPTED";
    next.warnings = [...next.warnings, "OPERATOR_APPROVED_REVIEW: accountability accepted by explicit approval"];
    next.overrideState = "ACCEPTED_WITH_WARNING";
  } else {
    next.overrideState = warnings.length > 0 ? "ACCEPTED_WITH_WARNING" : "ACCEPTED";
  }
  if (override.requestRegeneration === true) {
    next.regenerationDecision = "TARGETED_REGENERATION_REQUIRED";
    next.regenerationReasons = [...next.regenerationReasons, `operator-requested targeted regeneration: ${override.regenerationReason || "operator judgment"}`];
    next.overrideState = "ACCEPTED";
  }
  // Persist manual choices so refresh preserves them.
  for (const key of ["action", "cropPlan", "textPlan", "targetAspectRatio", "regenerationDecision", "status"]) {
    next[`manual_${key}`] = next[key];
  }
  next._manual = true;
  next._overrideSet = true;
  next.overrideReason = override.reason || null;
  next.updatedAt = new Date().toISOString();
  return { ok: true, state: next.overrideState, artifact: next, warnings, blockers };
}

module.exports = {
  PLATFORM_IDS: shared.PLATFORM_IDS,
  POLICY_VERSION: shared.POLICY_VERSION,
  adaptShot,
  adaptSequence,
  applyAdaptationOverride,
  buildMasterComposition: masterLib.buildMasterComposition,
  getTargetProfile: profilesLib.getTargetProfile,
  loadTargets: profilesLib.loadTargets,
  densityTier: densityLib.densityTier,
  pacingGuidance: densityLib.pacingGuidance,
  validateAdaptation: validatorLib.validateAdaptation,
  persistAdaptation: storeLib.persistAdaptation,
  loadAdaptation: storeLib.loadAdaptation,
  listAdaptations: storeLib.listAdaptations,
  checkAdaptationStaleness: storeLib.checkAdaptationStaleness,
  shared,
};
