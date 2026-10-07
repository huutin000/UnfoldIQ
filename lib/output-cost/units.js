"use strict";

/**
 * 1G.8 output planning — generation units (PHASE 1G.8, Prompt 01, §§8–17, §21–23).
 * Consumes 1G.5 decisions + 1G.6 resolutions + 1G.7 adaptations read-only and
 * plans the minimal generation-unit set: deduplicated prerequisites, no
 * platform double-count, no reference double-count, Remotion never counted
 * as Flow credit, outputCount default 1 with roadmap-approved exceptions.
 * Cost comes ONLY from 1G.6 observations (resolution estimate or snapshot
 * lookup); never invented, never hard-coded. No generation, no spend.
 */

const shared = require("./shared.js");

function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Validate outputCount policy (§8). Returns { ok, count, baseOutputs,
 * extraVariants } or { ok:false, code }.
 */
function validateOutputCount(item) {
  const raw = item.outputCount === undefined || item.outputCount === null
    ? shared.OUTPUT_COUNT_DEFAULT : item.outputCount;
  if (!Number.isInteger(raw) || raw < 1) {
    return { ok: false, code: "OUTPUT_COUNT_INVALID", message: `outputCount must be a positive integer (got ${raw})` };
  }
  if (raw > shared.OUTPUT_COUNT_MAX) {
    return { ok: false, code: "OUTPUT_COUNT_EXCEEDS_MAX", message: `outputCount ${raw} exceeds roadmap maximum ${shared.OUTPUT_COUNT_MAX}` };
  }
  if (raw > 1) {
    if (!shared.SPECIAL_OUTPUT_ROLES.includes(item.specialRole)) {
      return { ok: false, code: "MULTI_OUTPUT_ROLE_REQUIRED", message: `outputCount ${raw} needs a roadmap-approved special role, not importance alone` };
    }
    if (!item.specialReason) {
      return { ok: false, code: "MULTI_OUTPUT_REASON_REQUIRED", message: "multi-output needs an explicit reason" };
    }
  }
  return { ok: true, count: raw, baseOutputs: 1, extraVariants: raw - 1 };
}

function unitId(planId, parts) {
  return shared.id12("gu", { plan: planId, ...parts });
}

/** Verify a model's declared media kinds from the snapshot — never by label. */
function modelHasKind(snapshot, modelId, kind) {
  if (!snapshot || !modelId) return null; // unverifiable, not false
  const model = (snapshot.models || []).find((m) => m.modelId === modelId);
  if (!model) return null;
  return (model.mediaKinds || []).includes(kind);
}

/** Map 1G.6 estimate states onto 1G.8 unit cost states. */
function toUnitCostState(estimate, modelFreshness) {
  if (!estimate) return { state: "UNKNOWN", reason: "no cost evaluation available" };
  if (estimate.state === "KNOWN") return { state: "EXACT", reason: estimate.reason };
  if (estimate.state === "CONFLICT") return { state: "CONFLICT", reason: estimate.reason };
  if (modelFreshness === "STALE" || /only stale/i.test(estimate.reason || "")) {
    return { state: "STALE", reason: estimate.reason || "stale cost observations" };
  }
  return { state: "UNKNOWN", reason: estimate.reason || "no authoritative cost observation" };
}

/**
 * Look up unit cost from 1G.6 (resolution estimate first, snapshot second).
 * Requires the 1G.6 model-registry module injected (keeps this file free of
 * hard requires; facade wires it). Returns { state, valuePerGeneration,
 * unit, observationRef, reason }.
 */
function lookupUnitCost(mreg, snapshot, modelId, costCtx) {
  if (!mreg || !snapshot || !modelId) {
    return { state: "UNKNOWN", reason: "no model resolution for cost lookup", unit: null, valuePerGeneration: null };
  }
  const model = (snapshot.models || []).find((m) => m.modelId === modelId);
  if (!model) {
    return { state: "UNKNOWN", reason: `model ${modelId} not in registry snapshot`, unit: null, valuePerGeneration: null };
  }
  const requirement = {
    durationSeconds: costCtx.durationSeconds !== undefined ? costCtx.durationSeconds : null,
    resolution: costCtx.resolution || null,
    workflow: costCtx.workflow || null,
    accountContext: {
      subscriptionTier: costCtx.subscriptionTier || null,
      region: costCtx.region || null,
      surface: null,
    },
  };
  const estimate = mreg.estimateCost(model, requirement);
  const mapped = toUnitCostState(estimate, model.freshness && model.freshness.cost);
  return {
    state: mapped.state,
    reason: mapped.reason,
    unit: estimate.unit || null,
    valuePerGeneration: estimate.valuePerGeneration !== undefined ? estimate.valuePerGeneration : null,
    observationRef: estimate.observationRef ? {
      sourceRefs: estimate.observationRef.sourceRefs || [],
      observedAt: estimate.observationRef.observedAt || null,
    } : null,
  };
}

/**
 * Build one item's generation units. Pure + deterministic.
 * ctx: { mreg, snapshot, planId }
 */
function buildItemUnits(item, ctx) {
  const units = [];
  const warnings = [];
  const blockers = [];
  const decision = item.decision || {};
  const strategy = decision.effectiveOutputType || decision.recommendedOutputType || null;
  const roles = decision.requiredAssetRoles || [];
  const counted = validateOutputCount(item);
  if (!counted.ok) {
    blockers.push(`${counted.code}: ${counted.message}`);
    return { units, warnings, blockers, counted: null };
  }

  const costBase = {
    durationSeconds: item.durationSeconds !== undefined ? item.durationSeconds : null,
    resolution: item.resolution || null,
    workflow: item.workflow || null,
    subscriptionTier: item.subscriptionTier || null,
    region: item.region || null,
  };
  // Hardening sweep (A-7): an operator model override must change what is
  // priced - resolve the EFFECTIVE model, not the recommendation.
  const resolutionModel = item.resolution
    ? (item.resolution.effectiveModel || item.resolution.selectedModel || item.resolution.recommendedModel)
    : (item.modelId || null);
  const resolutionKnown = item.resolution && item.resolution.costEstimate && item.resolution.costEstimate.state === "KNOWN";

  const imageUnit = (role, assetKey, reason) => {
    // Image cost is used only from a resolution whose model is verified
    // image-capable via the snapshot — never by sniffing provider labels.
    let cost = { state: "UNKNOWN", reason: "image cost unpublished for this context", unit: null, valuePerGeneration: null };
    const resEst = item.resolution && item.resolution.costEstimate;
    const resModel = item.resolution && item.resolution.recommendedModel;
    if (resolutionModel && resEst && resEst.state === "KNOWN" && resModel === resolutionModel
      && modelHasKind(ctx.snapshot, resolutionModel, "image") === true) {
      cost = { state: "EXACT", reason: resEst.reason || "1G.6 exact observation", unit: resEst.unit || null, valuePerGeneration: resEst.valuePerGeneration, observationRef: null };
    } else if (resolutionModel && ctx.snapshot) {
      const looked = lookupUnitCost(ctx.mreg, ctx.snapshot, resolutionModel, costBase);
      cost = modelHasKind(ctx.snapshot, resolutionModel, "image") === true ? looked
        : { state: "UNKNOWN", reason: `model ${resolutionModel} not verified as image-capable`, unit: null, valuePerGeneration: null };
    }
    return {
      unitId: unitId(ctx.planId, { shot: item.shotId, kind: "image", role, asset: assetKey }),
      sourceShotId: item.shotId,
      sourceDecisionId: decision.decisionId || null,
      modelResolutionId: (item.resolution && item.resolution.resolutionId) || null,
      mediaKind: "image",
      workflow: "IMAGE_GENERATION",
      modelId: resolutionModel,
      providerId: item.providerId || null,
      durationSeconds: null,
      resolution: costBase.resolution,
      orientation: item.orientation || null,
      subscriptionTier: costBase.subscriptionTier,
      role: "IMAGE_ASSET",
      assetRole: role,
      assetKey,
      variantIndex: 0,
      outputCount: 1,
      baseOutputs: 1,
      extraVariants: 0,
      reusableAcrossPlatforms: true,
      dedupeKey: `img:${role}:${assetKey}`,
      costObservationRef: cost.observationRef || null,
      estimatedCreditState: cost.state,
      estimatedCredits: cost.valuePerGeneration,
      costUnit: cost.unit,
      costReason: cost.reason || reason,
      latencyEstimateState: "UNKNOWN",
      status: "PLANNED",
    };
  };

  if (strategy === "STATIC_IMAGE") {
    const satisfied = item.assetStatus && item.assetStatus.satisfied === true;
    if (!satisfied) {
      const missing = (item.assetStatus && Array.isArray(item.assetStatus.missingRoles) && item.assetStatus.missingRoles.length > 0)
        ? item.assetStatus.missingRoles.filter((r) => shared.IMAGE_ASSET_ROLES.includes(r))
        : ["PRIMARY_IMAGE"];
      for (const role of missing) {
        units.push(imageUnit(role, `${item.shotId}:${role}`, "missing source image asset"));
      }
    } else {
      warnings.push("ASSET_SATISFIED: existing approved image covers the primary need");
    }
    // Shared prerequisite references dedupe by asset id, independent of the
    // primary-image path above.
    for (const refId of item.missingReferences || []) {
      units.push(imageUnit("CHARACTER_REFERENCE", `ref:${refId}`, "missing prerequisite reference asset"));
    }
    return { units, warnings, blockers, counted };
  }

  if (strategy === "EDITOR_MOTION") {
    // Remotion execution is never a Flow generation credit (§13).
    if (item.missingInputImage === true || (item.assetStatus && item.assetStatus.satisfied === false)) {
      units.push(imageUnit("PRIMARY_IMAGE", `${item.shotId}:PRIMARY_IMAGE`, "missing Remotion base image — image generation only"));
    } else {
      warnings.push("REMOTION_ZERO_FLOW_CREDIT: motion renders deterministically; no Flow generation planned");
    }
    return { units, warnings, blockers, counted };
  }

  if (strategy === "GENERATED_MOTION_CANDIDATE" || strategy === "GENERATED_MOTION_RECOMMENDED") {
    // FIX 01 (1G.8): RECOMMENDATION ≠ PRODUCTION AUTHORIZATION. A candidate
    // without an explicit selected/effective paid strategy plans ZERO
    // spend-capable units — REVIEW/AWAIT_SELECTION with advisory potential
    // only. RECOMMENDED keeps canonical 1G.5 fallback (effective =
    // selected ?? recommended). 1G.5 semantics are never mutated here.
    const recommended = decision.recommendedOutputType || null;
    const selected = decision.selectedOutputType || null;
    const explicitlySelectedGenerated = !!selected && selected.startsWith("GENERATED_MOTION");
    const candidateUnselected = recommended === "GENERATED_MOTION_CANDIDATE" && !explicitlySelectedGenerated;
    // Platform reuse: one base generation + one per TARGETED platform (§11, §34).
    const adaptations = Array.isArray(item.adaptations) ? item.adaptations : [];
    const targeted = adaptations.filter((a) => a && a.regenerationDecision === "TARGETED_REGENERATION_REQUIRED");
    const platformVariants = adaptations.length > 0 ? 1 + targeted.length : 1;
    if (adaptations.length > 0) {
      reasons_note(warnings, adaptations, targeted);
    }
    const renderMode = decision.renderMode || null;
    const workflow = renderMode === "VEO_FIRST_LAST" ? "Frames to Video: First and Last"
      : renderMode === "VEO_REFERENCE" ? "Ingredients / References to Video"
      : "Frames to Video: First";
    const makeVideoUnit = (p, v) => {
      const kindOk = modelHasKind(ctx.snapshot, resolutionModel, "video");
      const cost = resolutionKnown && item.resolution.recommendedModel && kindOk !== false
        ? {
          state: "EXACT",
          reason: item.resolution.costEstimate.reason || "1G.6 exact observation",
          unit: item.resolution.costEstimate.unit || null,
          valuePerGeneration: item.resolution.costEstimate.valuePerGeneration,
          observationRef: null,
        }
        : (kindOk === false
          ? { state: "UNKNOWN", reason: `model ${resolutionModel} not verified as video-capable`, unit: null, valuePerGeneration: null }
          : lookupUnitCost(ctx.mreg, ctx.snapshot, resolutionModel, { ...costBase, workflow: item.workflow || null }));
      return {
        unitId: unitId(ctx.planId, { shot: item.shotId, kind: "video", platform: p, variant: v }),
        sourceShotId: item.shotId,
        sourceDecisionId: decision.decisionId || null,
        modelResolutionId: (item.resolution && item.resolution.resolutionId) || null,
        mediaKind: "video",
        workflow,
        modelId: resolutionModel,
        providerId: (item.resolution && item.resolution.recommendedProvider) || item.providerId || null,
        durationSeconds: costBase.durationSeconds,
        resolution: costBase.resolution,
        orientation: item.orientation || null,
        subscriptionTier: costBase.subscriptionTier,
        role: p === 0 ? "MASTER_OUTPUT" : "PLATFORM_TARGETED_VARIANT",
        assetRole: null,
        assetKey: null,
        variantIndex: v,
        outputCount: counted.count,
        baseOutputs: v === 0 ? 1 : 0,
        extraVariants: v === 0 ? 0 : 1,
        platformVariantIndex: p,
        targetedPlatformId: p === 0 ? null : (targeted[p - 1] && targeted[p - 1].platformId) || null,
        reusableAcrossPlatforms: p === 0,
        dedupeKey: `vid:${item.shotId}:p${p}:v${v}`,
        costObservationRef: cost.observationRef || null,
        estimatedCreditState: cost.state || "UNKNOWN",
        estimatedCredits: cost.valuePerGeneration !== undefined ? cost.valuePerGeneration : null,
        costUnit: cost.unit || null,
        costReason: cost.reason || "cost evaluated from 1G.6 evidence",
        latencyEstimateState: "UNKNOWN",
        status: "PLANNED",
      };
    };
    const made = [];
    for (let p = 0; p < platformVariants; p++) {
      for (let v = 0; v < counted.count; v++) {
        made.push(makeVideoUnit(p, v));
      }
    }
    if (candidateUnselected) {
      // Advisory potential only — never required/planned/committed spend.
      const exact = made.filter((u) => u.estimatedCreditState === "EXACT");
      let state = "EXACT";
      if (made.some((u) => u.estimatedCreditState === "CONFLICT")) state = "CONFLICT";
      else if (made.some((u) => u.estimatedCreditState === "UNKNOWN")) state = "UNKNOWN";
      else if (made.some((u) => u.estimatedCreditState === "STALE")) state = "STALE";
      else if (exact.length !== made.length) state = "PARTIAL";
      const potential = {
        shotId: item.shotId,
        potentialUnits: made.length,
        creditState: state,
        potentialKnownCredits: exact.reduce((s, u) => s + (u.estimatedCredits || 0), 0),
        potentialCredits: state === "EXACT" ? exact.reduce((s, u) => s + (u.estimatedCredits || 0), 0) : null,
        reason: "GENERATED_MOTION_CANDIDATE without explicit production selection — advisory potential, not required spend",
      };
      warnings.push(`AWAITING_SELECTION: candidate ${item.shotId} plans 0 required video units until explicitly selected`);
      return { units, potential, awaitingSelection: [item.shotId], warnings, blockers, counted };
    }
    if (strategy === "GENERATED_MOTION_CANDIDATE") {
      warnings.push("CANDIDATE_STRATEGY: explicitly selected candidate workflow — caller confirms the production selection");
    }
    units.push(...made);
    return { units, warnings, blockers, counted };
  }

  blockers.push(`STRATEGY_UNKNOWN: no plannable strategy on decision for shot ${item.shotId}`);
  return { units, warnings, blockers, counted: null };
}

function reasons_note(warnings, adaptations, targeted) {
  if (targeted.length === 0) {
    warnings.push(`PLATFORM_REUSE_DEDUP: one master asset usable across ${adaptations.length} platform(s) — 1 generation, not ${adaptations.length}`);
  } else {
    warnings.push(`PLATFORM_TARGETED_REGEN: ${targeted.length} platform(s) require targeted regeneration — base + targeted units only`);
  }
}

/**
 * Build the full output plan with cross-item deduplication.
 * Input: { projectId, scopeId?, items[], registrySnapshot?, mreg?,
 *   latencyEvidence?, policyVersion?, now? }
 */
function buildOutputPlan(input = {}) {
  const now = input.now || new Date().toISOString();
  const items = Array.isArray(input.items) ? input.items : [];
  if (items.length === 0) {
    return { ok: false, code: "OUTPUT_PLAN_EMPTY", message: "at least one production item is required" };
  }
  const planId = shared.id12("op", {
    projectId: input.projectId, scope: input.scopeId || null,
    shots: items.map((i) => [i.shotId, i.outputCount || 1, i.specialRole || null]),
  });
  const ctx = { mreg: input.mreg || null, snapshot: input.registrySnapshot || null, planId };
  const units = [];
  const warnings = [];
  const blockers = [];
  const potentials = [];
  const awaitingSelection = [];
  const seenDedupe = new Map();
  const deduped = [];
  for (const item of items) {
    const built = buildItemUnits(item, ctx);
    warnings.push(...built.warnings.map((w) => `${item.shotId}: ${w}`));
    blockers.push(...built.blockers.map((b) => `${item.shotId}: ${b}`));
    if (built.potential) potentials.push(built.potential);
    if (built.awaitingSelection) awaitingSelection.push(...built.awaitingSelection);
    for (const u of built.units) {
      if (u.dedupeKey && seenDedupe.has(u.dedupeKey)) {
        deduped.push({ unitId: u.unitId, dedupeKey: u.dedupeKey, keptUnitId: seenDedupe.get(u.dedupeKey) });
        continue;
      }
      if (u.dedupeKey) seenDedupe.set(u.dedupeKey, u.unitId);
      units.push(u);
    }
  }

  const imageUnits = units.filter((u) => u.mediaKind === "image");
  const videoUnits = units.filter((u) => u.mediaKind === "video");
  const veoShots = new Set(videoUnits.map((u) => u.sourceShotId)).size;
  const spendUnits = units.filter((u) => u.estimatedCreditState !== "NOT_APPLICABLE");
  const exactUnits = spendUnits.filter((u) => u.estimatedCreditState === "EXACT");
  const unknownUnits = spendUnits.filter((u) => u.estimatedCreditState === "UNKNOWN");
  const conflictUnits = spendUnits.filter((u) => u.estimatedCreditState === "CONFLICT");
  const staleUnits = spendUnits.filter((u) => u.estimatedCreditState === "STALE");
  const knownCredits = exactUnits.reduce((s, u) => s + (u.estimatedCredits || 0), 0);
  let creditState = "EXACT";
  if (conflictUnits.length > 0) creditState = "CONFLICT";
  else if (unknownUnits.length > 0) creditState = exactUnits.length > 0 ? "PARTIAL" : "UNKNOWN";
  else if (staleUnits.length > 0) creditState = "STALE";

  const latency = estimateGenerationTime(input.latencyEvidence);
  // Optional/potential candidate spend — strictly separated from required
  // spend (FIX 01 §6): never reserved, never committed, never blocking.
  const potentialVeoShots = potentials.length;
  const potentialKnown = potentials.reduce((s, p) => s + (p.potentialKnownCredits || 0), 0);
  const potentialStates = [...new Set(potentials.map((p) => p.creditState))];
  let potentialState = "EXACT";
  if (potentials.length === 0) potentialState = "NONE";
  else if (potentialStates.includes("CONFLICT")) potentialState = "CONFLICT";
  else if (potentialStates.includes("UNKNOWN")) potentialState = "UNKNOWN";
  else if (potentialStates.includes("STALE")) potentialState = "STALE";
  else if (potentialStates.includes("PARTIAL")) potentialState = "PARTIAL";
  const summary = {
    estimatedImages: imageUnits.length,
    estimatedVeoShots: veoShots,
    estimatedVariants: units.length,
    baseOutputs: units.filter((u) => (u.baseOutputs || 0) > 0).length,
    extraVariants: units.reduce((s, u) => s + (u.extraVariants || 0), 0),
    potentialVeoShots,
    potentialCredits: { state: potentialState, value: potentialState === "EXACT" ? potentials.reduce((s, p) => s + (p.potentialCredits || 0), 0) : null, knownPartial: potentialKnown },
    awaitingSelection: [...awaitingSelection],
    estimatedCredits: {
      state: creditState,
      knownCredits,
      exactTotalCredits: creditState === "EXACT" ? knownCredits : null,
      unknownUnitCount: unknownUnits.length,
      conflictingUnitCount: conflictUnits.length,
      staleUnitCount: staleUnits.length,
    },
    estimatedGenerationTime: latency,
    hardBudget: null, // attached by buildBudgetPlan, never invented here
  };
  const plan = {
    version: shared.OUTPUT_COST_VERSION,
    outputPlanId: planId,
    projectId: input.projectId || null,
    scopeId: input.scopeId || null,
    itemCount: items.length,
    units,
    deduped,
    potentials,
    awaitingSelection: [...awaitingSelection],
    summary,
    warnings,
    blockers,
    latencyEvidence: Array.isArray(input.latencyEvidence) ? input.latencyEvidence : [],
    policyVersion: input.policyVersion || shared.BUDGET_POLICY_VERSION,
    fingerprint: null,
    status: blockers.length > 0 ? "BLOCKED" : (awaitingSelection.length > 0 ? "AWAITING_SELECTION" : "DRAFT"),
    createdAt: now,
    updatedAt: now,
  };
  plan.fingerprint = shared.hash16({
    projectId: plan.projectId, scope: plan.scopeId, units: units.map((u) => [u.unitId, u.estimatedCreditState, u.estimatedCredits]),
    deduped, potentials, summary, policy: plan.policyVersion,
  });
  return { ok: true, plan };
}

/**
 * Generation-time estimate from measured evidence only (§24, §54).
 * Never derived from output duration, model names, or tier labels.
 */
function estimateGenerationTime(latencyEvidence) {
  if (!Array.isArray(latencyEvidence) || latencyEvidence.length === 0) {
    return { state: "UNKNOWN", reason: "no measured runtime evidence available" };
  }
  const latest = latencyEvidence[latencyEvidence.length - 1];
  if (!latest || typeof latest.estimateMs !== "number") {
    return { state: "UNKNOWN", reason: "latency evidence carries no numeric estimate" };
  }
  return {
    state: "KNOWN",
    estimateMs: latest.estimateMs,
    sampleCount: latest.sampleCount || null,
    percentile: latest.percentile || latest.bound || null,
    source: latest.source || null,
    observedAt: latest.observedAt || null,
    reason: "sourced from caller-supplied measured runtime evidence",
  };
}

module.exports = {
  validateOutputCount,
  buildItemUnits,
  buildOutputPlan,
  estimateGenerationTime,
  lookupUnitCost,
};
