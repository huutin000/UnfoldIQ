"use strict";

/**
 * 1G.6 deterministic model resolver (PHASE 1G.6, Prompt 01, §§13–18, §21–22).
 *
 * Dependency direction (never reversed): 1G.5 render requirement (read-only)
 * → hard compatibility filter → deterministic ranking → override validation
 * → separate resolution artifact. The resolver NEVER rewrites visual
 * modality, render mode, motion need, framing, or claim lineage; it NEVER
 * executes generation, NEVER spends credits, NEVER touches Flow UI.
 *
 * Deterministic: same requirement + same snapshot + same policy → same
 * recommendation, reasons, fingerprint. All reasons bounded and explicit.
 */

const shared = require("./shared.js");

const DEFAULT_POLICY = {
  unknownHardField: "PROVISIONAL", // or "REVIEW"
  costAmbiguity: "TIEBREAK", // or "REVIEW"
  allowProvisionalSelection: true,
  allowedSurfaces: null, // null = any registered surface
  policyVersion: shared.RESOLVER_POLICY_VERSION,
};

function withPolicy(policy = {}) {
  return { ...DEFAULT_POLICY, ...policy };
}

/**
 * Read-only bridge: 1G.5 production decision → resolver requirement.
 * Only reads; the decision object is never mutated (proven by tests).
 * options: { durationSeconds?, resolution?, qualityPreference?,
 *   costSensitivity?, providerPreference?, modelPreference?, accountContext?,
 *   outputCount?, existingAssetSatisfied?, missingInputImage?,
 *   orientation?, policyVersion? }
 */
function buildRequirement(decision, options = {}) {
  if (!decision || !decision.shotId) {
    return { ok: false, code: "REQUIREMENT_SOURCE_INVALID", message: "a 1G.5 production decision is required" };
  }
  const renderMode = decision.renderMode || null;
  const implied = (renderMode && shared.RENDER_MODE_WORKFLOWS[renderMode]) || [];
  const requiredCapabilities = [...new Set([...(decision.requiredCapabilities || []), ...implied])];
  let orientation = options.orientation || null;
  if (!orientation) {
    if (requiredCapabilities.includes("PORTRAIT_OUTPUT")) orientation = "PORTRAIT_OUTPUT";
    else if (requiredCapabilities.includes("LANDSCAPE_OUTPUT")) orientation = "LANDSCAPE_OUTPUT";
  }
  const mediaTargetKind = renderMode === "STATIC_IMAGE" || renderMode === "REMOTION_MOTION" ? "IMAGE"
    : renderMode && renderMode.startsWith("VEO_") ? "VIDEO" : null;
  const requirement = {
    projectId: decision.projectId || options.projectId || null,
    sceneId: decision.sceneId || null,
    shotId: decision.shotId,
    renderMode,
    requiredCapabilities,
    referenceStrategy: decision.referenceStrategy || null,
    requiredAssetRoles: [...(decision.requiredAssetRoles || [])],
    platform: decision.platform || options.platform || null,
    orientation,
    mediaTargetKind,
    durationSeconds: options.durationSeconds !== undefined ? options.durationSeconds : null,
    resolution: options.resolution || null,
    workflow: options.workflow || null, // provider workflow label when the caller names one; otherwise null (never assumed)
    qualityPreference: options.qualityPreference || null,
    costSensitivity: ["LOW", "BALANCED", "HIGH"].includes(options.costSensitivity) ? options.costSensitivity : "BALANCED",
    providerPreference: options.providerPreference || null,
    modelPreference: options.modelPreference || null,
    accountContext: {
      subscriptionTier: (options.accountContext && options.accountContext.subscriptionTier) || null,
      region: (options.accountContext && options.accountContext.region) || null,
      surface: (options.accountContext && options.accountContext.surface) || null,
    },
    outputCount: options.outputCount !== undefined ? options.outputCount : null,
    existingAssetSatisfied: options.existingAssetSatisfied === true,
    missingInputImage: options.missingInputImage === true,
    policyVersion: options.policyVersion || shared.RESOLVER_POLICY_VERSION,
    sourceDecision: {
      decisionId: decision.decisionId || null,
      fingerprint: decision.fingerprint || null,
    },
  };
  requirement.fingerprint = shared.hash16({
    shotId: requirement.shotId, renderMode, requiredCapabilities,
    referenceStrategy: requirement.referenceStrategy, requiredAssetRoles: requirement.requiredAssetRoles,
    orientation, mediaTargetKind: requirement.mediaTargetKind, durationSeconds: requirement.durationSeconds,
    resolution: requirement.resolution, workflow: requirement.workflow || null,
    costSensitivity: requirement.costSensitivity,
    accountContext: requirement.accountContext, outputCount: requirement.outputCount,
    existingAsset: requirement.existingAssetSatisfied, missingImage: requirement.missingInputImage,
    sourceFingerprint: requirement.sourceDecision.fingerprint,
  });
  return { ok: true, requirement };
}

function ruleFor(model, capability) {
  return (model.capabilityRules || []).find((r) => r.capability === capability) || null;
}

function orientationAspect(orientation) {
  if (orientation === "PORTRAIT_OUTPUT") return "9:16";
  if (orientation === "LANDSCAPE_OUTPUT") return "16:9";
  return null;
}

/**
 * Hard compatibility check for ONE model. Returns
 * { compatible, provisional, reasons[], rejections[] }.
 * UNSUPPORTED/UNAVAILABLE/RETIRED reject; UNKNOWN follows policy; CONFLICT
 * is preserved as provisional (never silently merged).
 */
function checkModelCompatibility(model, requirement, policy, snapshot) {
  const reasons = [];
  const rejections = [];
  const provisionalNotes = [];
  const reviewNotes = [];
  let availabilityNote = null;
  const reject = (message) => rejections.push(message);

  if (model.status === "RETIRED") reject(`model status RETIRED`);
  if (policy.allowedSurfaces && !policy.allowedSurfaces.includes(model.surfaceId)) {
    reject(`surface ${model.surfaceId} not in allowedSurfaces`);
  }
  const surface = (snapshot.surfaces || []).find((s) => s.surfaceId === model.surfaceId);
  if (surface && surface.status === "UNAVAILABLE") reject(`surface ${model.surfaceId} UNAVAILABLE`);
  if (model.availability === "UNAVAILABLE") reject(`model availability UNAVAILABLE`);
  if (rejections.length > 0) return { compatible: false, provisional: false, reasons, rejections, provisionalNotes, reviewNotes };

  // Media-kind gate per resolution path is applied by the caller via
  // requiredCapabilities; here enforce the media target kind.
  if (requirement.mediaTargetKind === "VIDEO" && !(model.mediaKinds || []).includes("video")) {
    reject(`model has no video mediaKind`);
  }
  if (requirement.mediaTargetKind === "IMAGE" && !(model.mediaKinds || []).includes("image")) {
    reject(`model has no image mediaKind`);
  }
  if (rejections.length > 0) return { compatible: false, provisional: false, reasons, rejections, provisionalNotes, reviewNotes };

  const unknownHard = (message) => {
    if (policy.unknownHardField === "REVIEW") reviewNotes.push(`REVIEW_REQUIRED: ${message}`);
    else provisionalNotes.push(`UNKNOWN hard field (provisional): ${message}`);
  };
  const conflicted = (message) => {
    if (policy.unknownHardField === "REVIEW") reviewNotes.push(`REVIEW_REQUIRED (conflicting evidence): ${message}`);
    else provisionalNotes.push(message);
  };

  for (const cap of requirement.requiredCapabilities || []) {
    const rule = ruleFor(model, cap);
    if (!rule) { unknownHard(`no rule for required capability ${cap}`); continue; }
    if (rule.support === "UNSUPPORTED") { reject(`capability ${cap} UNSUPPORTED (${(rule.constraints && rule.constraints.notes) || "documented"})`); continue; }
    if (rule.support === "CONFLICT") {
      conflicted(`capability ${cap} has conflicting official observations — preserved, not merged`);
      continue;
    }
    if (rule.support === "UNKNOWN") { unknownHard(`capability ${cap} support UNKNOWN`); continue; }
    // Output-shape caps (PORTRAIT/LANDSCAPE_OUTPUT) assert the frame shape;
    // the aspect itself is proven by workflow rules below/above — the shape
    // cap only needs to agree with the required orientation, not re-prove
    // durations per shape.
    if ((cap === "PORTRAIT_OUTPUT" || cap === "LANDSCAPE_OUTPUT") && requirement.orientation) {
      if (cap !== requirement.orientation) {
        reject(`output shape ${cap} mismatches required orientation ${requirement.orientation}`);
        continue;
      }
      reasons.push(`output shape ${cap} agrees with required orientation`);
      continue;
    }
    // SUPPORTED — verify constraints.
    const c = rule.constraints || {};
    reasons.push(`satisfies ${cap}${c.workflow ? ` (${c.workflow})` : ""}`);
    if (requirement.orientation) {
      const aspect = orientationAspect(requirement.orientation);
      if (Array.isArray(c.orientations) && c.orientations.length > 0) {
        const hit = c.orientations.includes(aspect) || c.orientations.includes(requirement.orientation);
        if (!hit) reject(`orientation ${aspect || requirement.orientation} not in [${c.orientations.join(", ")}] for ${cap}`);
        else reasons.push(`supports orientation ${aspect || requirement.orientation} for ${cap}`);
      } else {
        unknownHard(`orientation support for ${cap} undeclared`);
      }
    }
    if (requirement.durationSeconds !== null && requirement.durationSeconds !== undefined) {
      if (Array.isArray(c.durations) && c.durations.length > 0) {
        if (!c.durations.includes(requirement.durationSeconds)) {
          reject(`duration ${requirement.durationSeconds}s not in [${c.durations.join(", ")}] for ${cap}`);
        } else reasons.push(`supports requested ${requirement.durationSeconds}s duration for ${cap}`);
      } else {
        unknownHard(`duration support for ${cap} undeclared`);
      }
    }
    if (requirement.resolution) {
      if (Array.isArray(c.resolutions) && c.resolutions.length > 0) {
        if (!c.resolutions.includes(requirement.resolution)) reject(`resolution ${requirement.resolution} not in [${c.resolutions.join(", ")}] for ${cap}`);
        else reasons.push(`supports resolution ${requirement.resolution} for ${cap}`);
      } else {
        unknownHard(`resolution support for ${cap} undeclared`);
      }
    }
    if (c.region && requirement.accountContext.region && c.region !== requirement.accountContext.region) {
      reject(`region constraint ${c.region} mismatches account region`);
    }
    if (c.subscription && requirement.accountContext.subscriptionTier && c.subscription !== requirement.accountContext.subscriptionTier) {
      reject(`subscription constraint mismatches account tier`);
    }
  }
  if (rejections.length > 0) return { compatible: false, provisional: false, reasons, rejections, provisionalNotes, reviewNotes };

  // Required input roles: START/END frames bind to the workflow rules that own them.
  const roles = requirement.requiredAssetRoles || [];
  const needStart = roles.includes("START_FRAME");
  const needEnd = roles.includes("END_FRAME");
  const refRoles = roles.filter((r) => ["CHARACTER_REFERENCE", "OBJECT_REFERENCE", "ENVIRONMENT_REFERENCE"].includes(r));
  if (needStart && (requirement.requiredCapabilities || []).includes("IMAGE_TO_VIDEO")) {
    const r = ruleFor(model, "IMAGE_TO_VIDEO");
    if (r && r.support === "SUPPORTED" && Array.isArray(r.constraints.inputRoles) && r.constraints.inputRoles.length > 0
      && !r.constraints.inputRoles.includes("START_FRAME")) {
      reject(`IMAGE_TO_VIDEO rule does not accept START_FRAME input role`);
    }
  }
  if (needEnd) {
    const r = ruleFor(model, "FIRST_LAST_FRAME_VIDEO");
    if (!r) {
      unknownHard(`no rule for required FIRST_LAST_FRAME_VIDEO (END_FRAME need unproven)`);
    } else if (r.support === "UNSUPPORTED") {
      // No silent downgrade to first-frame-only (§22.2, §33).
      reject(`END_FRAME required but FIRST_LAST_FRAME_VIDEO UNSUPPORTED (no hidden downgrade)`);
    } else if (r.support === "CONFLICT") {
      conflicted(`END_FRAME need meets conflicting FIRST_LAST_FRAME_VIDEO evidence — preserved, not merged`);
    } else if (r.support === "UNKNOWN") {
      unknownHard(`FIRST_LAST_FRAME_VIDEO support UNKNOWN for END_FRAME need`);
    } else if (Array.isArray(r.constraints.inputRoles) && r.constraints.inputRoles.length > 0
      && (!r.constraints.inputRoles.includes("START_FRAME") || !r.constraints.inputRoles.includes("END_FRAME"))) {
      reject(`first+last rule lacks START/END input roles`);
    } else {
      reasons.push(`first+last workflow accepts START_FRAME + END_FRAME`);
    }
  }
  if (refRoles.length > 0 && (requirement.requiredCapabilities || []).includes("REFERENCE_GUIDED_VIDEO")) {
    const r = ruleFor(model, "REFERENCE_GUIDED_VIDEO");
    // A first-frame-only model is NOT compatible with strict reference need.
    if (!r) {
      unknownHard(`no rule for required REFERENCE_GUIDED_VIDEO (reference roles unproven)`);
    } else if (r.support === "UNSUPPORTED") {
      reject(`reference roles [${refRoles.join(", ")}] require REFERENCE_GUIDED_VIDEO, which is UNSUPPORTED`);
    } else if (r.support === "CONFLICT") {
      conflicted(`reference need meets conflicting REFERENCE_GUIDED_VIDEO evidence — preserved, not merged`);
    } else if (r.support === "UNKNOWN") {
      unknownHard(`REFERENCE_GUIDED_VIDEO support UNKNOWN for reference roles`);
    } else if (Array.isArray(r.constraints.inputRoles) && r.constraints.inputRoles.length > 0) {
      const missing = refRoles.filter((x) => !r.constraints.inputRoles.includes(x));
      if (missing.length > 0) reject(`reference rule does not accept roles [${missing.join(", ")}]`);
      else reasons.push(`reference-guided workflow accepts [${refRoles.join(", ")}]`);
    } else {
      reasons.push(`reference-guided workflow supported (no role restriction declared)`);
    }
  }
  if (rejections.length > 0) return { compatible: false, provisional: false, reasons, rejections, provisionalNotes, reviewNotes };

  if (model.availability === "UNKNOWN") {
    availabilityNote = `RUNTIME_AVAILABILITY_NOT_VERIFIED: documented-compatible but account access unobserved`;
  }
  const evidenceWeak = provisionalNotes.length > 0;
  return { compatible: true, provisional: evidenceWeak || availabilityNote !== null, evidenceWeak, availabilityNote, review: reviewNotes.length > 0, reasons, rejections, provisionalNotes, reviewNotes };
}

/** Cost observations applicable to this requirement (fresh + context match). */
function applicableCosts(model, requirement) {
  const out = [];
  for (const obs of model.costObservations || []) {
    if (obs.freshness !== "FRESH") continue;
    const ctx = obs.context || {};
    if (ctx.workflow && ctx.workflow !== requirement.workflow) continue; // cost tied to a provider workflow the requirement does not name
    if (ctx.durationSeconds !== null && ctx.durationSeconds !== undefined
      && ctx.durationSeconds !== requirement.durationSeconds) continue;
    if (ctx.subscriptionTier && ctx.subscriptionTier !== requirement.accountContext.subscriptionTier
      && requirement.accountContext.subscriptionTier) continue;
    if (ctx.subscriptionTier && !requirement.accountContext.subscriptionTier) continue; // cannot assume tier
    if (ctx.resolution && ctx.resolution !== requirement.resolution) continue;
    out.push(obs);
  }
  return out;
}

function estimateCost(model, requirement) {
  const fresh = applicableCosts(model, requirement);
  const staleExists = (model.costObservations || []).some((o) => o.freshness === "STALE");
  const conflictValues = [...new Set(fresh.map((o) => `${o.unit}:${o.value}`))];
  if (fresh.length === 0) {
    return { state: "UNKNOWN", reason: staleExists ? "only stale cost observations exist" : "no cost observations", unit: null, valuePerGeneration: null, estimatedTotal: null };
  }
  if (conflictValues.length > 1) {
    return { state: "CONFLICT", reason: `conflicting official observations preserved (${conflictValues.join(" vs ")}) — exact cost UNKNOWN`, unit: null, valuePerGeneration: null, estimatedTotal: null };
  }
  const obs = fresh[0];
  if (obs.value === null || obs.value === undefined) {
    return { state: "UNKNOWN", reason: "observation carries no value", unit: obs.unit, valuePerGeneration: null, estimatedTotal: null };
  }
  let estimatedTotal = null;
  let totalNote = "outputCount unknown — total cost UNKNOWN";
  if (requirement.outputCount !== null && requirement.outputCount !== undefined && obs.unit === "credits_per_generation") {
    estimatedTotal = obs.value * requirement.outputCount;
    totalNote = `total = ${obs.value} × ${requirement.outputCount} generations`;
  }
  return { state: "KNOWN", reason: totalNote, unit: obs.unit, valuePerGeneration: obs.value, estimatedTotal, observationRef: obs };
}

/** Deterministic ranking over compatible candidates. Factors exposed. */
function rankCandidates(candidates, requirement, policy) {
  const scored = candidates.map((c) => {
    const factors = [...c.factors];
    let rank = 0;
    // 1. explicit model preference (compatible only — incompatibles never reach here).
    if (requirement.modelPreference && c.model.modelId === requirement.modelPreference) {
      rank -= 1000;
      factors.push({ factor: "explicit_model_preference", detail: `operator prefers ${c.model.modelId}` });
    }
    // 2. explicit provider preference.
    if (requirement.providerPreference
      && (c.model.providerId === requirement.providerPreference || c.model.surfaceId === requirement.providerPreference)) {
      rank -= 500;
      factors.push({ factor: "explicit_provider_preference", detail: `operator prefers ${requirement.providerPreference}` });
    }
    // 3. verified runtime availability first.
    if (c.model.availability === "AVAILABLE") {
      rank -= 100;
      factors.push({ factor: "verified_availability", detail: "runtime availability verified" });
    } else {
      factors.push({ factor: "availability_unknown", detail: "RUNTIME_AVAILABILITY_NOT_VERIFIED" });
    }
    // 4. fresh capability evidence first.
    const capFresh = c.model.freshness && c.model.freshness.capability === "FRESH";
    if (capFresh) {
      rank -= 50;
      factors.push({ factor: "fresh_capability_evidence", detail: "all required rules FRESH" });
    } else {
      factors.push({ factor: "capability_freshness_partial", detail: `capability freshness ${c.model.freshness && c.model.freshness.capability}` });
    }
    // Provisional/review evidence ranks below clean support — conflict or
    // unknown capability fields never outrank documented support.
    // (Unverified account availability is orthogonal: warned, not ranked.)
    if (c.review) {
      rank += 400;
      factors.push({ factor: "review_evidence_penalty", detail: "review-flagged evidence sorts last" });
    } else if (c.evidenceWeak) {
      rank += 200;
      factors.push({ factor: "provisional_evidence_penalty", detail: "conflict/unknown evidence sorts below clean support" });
    }
    // 5. cost only after compatibility, only on fresh comparable exacts.
    if ((requirement.costSensitivity === "HIGH" || policy.compareCosts === true) && c.cost && c.cost.state === "KNOWN") {
      factors.push({ factor: "verified_cost", detail: `${c.cost.valuePerGeneration} ${c.cost.unit}` });
    }
    return { ...c, factors, rank };
  });
  // Cost ordering applies only when comparable fresh exacts exist for 2+ candidates.
  const costed = scored.filter((s) => s.cost && s.cost.state === "KNOWN"
    && (requirement.costSensitivity === "HIGH" || policy.compareCosts === true));
  const costOrder = new Map();
  if (costed.length >= 2 && costed.every((s) => s.cost.unit === costed[0].cost.unit)) {
    const sorted = [...costed].sort((a, b) => a.cost.valuePerGeneration - b.cost.valuePerGeneration || (a.model.modelId < b.model.modelId ? -1 : 1));
    sorted.forEach((s, i) => costOrder.set(s.model.modelId, i));
    for (const s of scored) {
      if (costOrder.has(s.model.modelId)) {
        s.rank -= (costed.length - costOrder.get(s.model.modelId)) * 10;
        s.factors.push({ factor: "lower_verified_cost", detail: `ranked #${costOrder.get(s.model.modelId) + 1} by fresh exact cost under ${requirement.costSensitivity} sensitivity` });
      }
    }
  } else if (requirement.costSensitivity === "HIGH") {
    for (const s of scored) {
      if (!s.cost || s.cost.state !== "KNOWN") {
        s.factors.push({ factor: "cost_comparison_not_possible", detail: `cost ${s.cost ? s.cost.state : "UNKNOWN"} — selection must NOT claim cheaper` });
      }
    }
  }
  scored.sort((a, b) => a.rank - b.rank || (a.model.modelId < b.model.modelId ? -1 : 1));
  // Record the deterministic tie-break on the winner.
  if (scored.length > 1 && scored[0].rank === scored[1].rank) {
    scored[0].factors.push({ factor: "deterministic_tiebreak", detail: "equal rank — modelId ascending wins" });
  }
  return scored;
}

/**
 * Resolve one requirement against a snapshot. No persistence here (store.js
 * owns it), no mutation of inputs, no generation.
 */
function resolveRequirement(snapshot, requirementInput, policyInput = {}) {
  const policy = withPolicy(policyInput);
  const requirement = { ...requirementInput };
  const warnings = [];
  const blockers = [];

  if (!snapshot || !Array.isArray(snapshot.models)) {
    return { ok: false, code: "SNAPSHOT_INVALID", message: "a normalized registry snapshot is required" };
  }
  if (!requirement.renderMode) {
    return { ok: false, code: "REQUIREMENT_INVALID", message: "renderMode is required (downstream of 1G.5)" };
  }

  // §21 — renderer vs asset-generation distinction, no forced model selection.
  if (requirement.renderMode === "STATIC_IMAGE" && requirement.existingAssetSatisfied) {
    return {
      ok: true,
      artifact: baseArtifact(snapshot, requirement, policy, {
        resolutionKind: "ASSET_SATISFIED", status: "NOT_REQUIRED",
        selectionReasons: ["approved/existing asset satisfies the shot — external model resolution NOT_REQUIRED"],
      }),
    };
  }
  if (requirement.renderMode === "REMOTION_MOTION" && !requirement.missingInputImage) {
    return {
      ok: true,
      artifact: baseArtifact(snapshot, requirement, policy, {
        resolutionKind: "RENDERER_NOT_REQUIRED", status: "NOT_REQUIRED",
        selectionReasons: ["Remotion remains renderer-owned; no video-generation model selected merely because motion exists"],
      }),
    };
  }
  const mediaTargetKind = requirement.renderMode === "REMOTION_MOTION" ? "IMAGE" : requirement.mediaTargetKind;
  if (!mediaTargetKind) {
    return { ok: false, code: "REQUIREMENT_INVALID", message: "media target kind undeterminable from renderMode" };
  }
  requirement.mediaTargetKind = mediaTargetKind;
  const resolutionKind = mediaTargetKind === "IMAGE" ? "ASSET_MODEL" : "VIDEO_MODEL";

  const candidates = [];
  const rejected = [];
  for (const model of snapshot.models) {
    const check = checkModelCompatibility(model, requirement, policy, snapshot);
    if (!check.compatible) {
      rejected.push({ modelId: model.modelId, providerLabel: model.providerLabel, reasons: check.rejections });
      continue;
    }
    const cost = estimateCost(model, requirement);
    candidates.push({
      model,
      modelId: model.modelId,
      providerLabel: model.providerLabel,
      surfaceId: model.surfaceId,
      provisional: check.provisional,
      evidenceWeak: !!check.evidenceWeak,
      review: !!check.review,
      provisionalReasons: check.provisionalNotes,
      reviewReasons: check.reviewNotes || [],
      availabilityNote: check.availabilityNote || null,
      availability: model.availability,
      cost,
      factors: check.reasons.map((r) => ({ factor: "hard_requirement_fit", detail: r })),
    });
  }
  rejected.sort((a, b) => (a.modelId < b.modelId ? -1 : 1));

  if (candidates.length === 0) {
    blockers.push("NO_COMPATIBLE_MODEL: no registered model satisfies all known hard requirements");
    return {
      ok: true,
      artifact: baseArtifact(snapshot, requirement, policy, {
        resolutionKind, status: "BLOCKED",
        candidateModels: [], rejectedModels: rejected,
        warnings, blockers,
        replanSuggestion: "explicit higher-level review required — no hidden downgrade to a weaker workflow",
      }),
    };
  }

  const ranked = rankCandidates(candidates, requirement, policy);
  const winner = ranked[0];
  if (requirement.modelPreference && !ranked.some((c) => c.modelId === requirement.modelPreference)) {
    warnings.push(`PREFERENCE_INCOMPATIBLE: preferred model ${requirement.modelPreference} failed hard filtering (see rejectedModels)`);
  }
  for (const note of winner.provisionalReasons) warnings.push(note);
  for (const note of (winner.reviewReasons || [])) warnings.push(note);
  if (winner.availabilityNote) warnings.push(winner.availabilityNote);
  if (winner.availability === "UNKNOWN" && !winner.availabilityNote) {
    warnings.push("RUNTIME_AVAILABILITY_NOT_VERIFIED: documented-compatible; account access unobserved — never claimed AVAILABLE");
  }

  let status = "RESOLVED";
  if (winner.review) status = "REVIEW_REQUIRED";
  else if (policy.unknownHardField === "REVIEW" && winner.provisional) status = "REVIEW_REQUIRED";
  else if (winner.provisional) status = "PROVISIONAL";
  if (policy.costAmbiguity === "REVIEW" && requirement.costSensitivity === "HIGH"
    && (!winner.cost || winner.cost.state !== "KNOWN")) {
    status = "REVIEW_REQUIRED";
    warnings.push("COST_REVIEW_REQUIRED: HIGH sensitivity but no fresh exact cost — selection must NOT claim cheaper");
  }

  const candidateModels = ranked.map((c) => ({
    modelId: c.modelId, providerLabel: c.providerLabel, surfaceId: c.surfaceId,
    availability: c.availability, provisional: c.provisional, review: !!c.review,
    costEstimate: stripObservation(c.cost), factors: c.factors,
  }));
  return {
    ok: true,
    artifact: baseArtifact(snapshot, requirement, policy, {
      resolutionKind, status,
      candidateModels, rejectedModels: rejected,
      recommendedProvider: winner.model.providerId,
      recommendedModel: winner.modelId,
      selectionState: status === "RESOLVED" ? "RECOMMENDED" : status,
      selectionReasons: winner.factors.map((f) => `${f.factor}: ${f.detail}`),
      availabilityState: winner.availability,
      costEstimate: stripObservation(winner.cost),
      warnings, blockers,
    }),
  };
}

function stripObservation(cost) {
  if (!cost) return { state: "UNKNOWN", reason: "no cost evaluation", unit: null, valuePerGeneration: null, estimatedTotal: null };
  const { observationRef, ...rest } = cost;
  void observationRef;
  return rest;
}

function baseArtifact(snapshot, requirement, policy, partial = {}) {
  const resolutionId = shared.id12("mr", {
    shotId: requirement.shotId, renderMode: requirement.renderMode,
    requirement: requirement.fingerprint, snapshot: snapshot.fingerprint, policy: policy.policyVersion,
  });
  const artifact = {
    version: shared.REGISTRY_VERSION,
    resolutionId,
    schemaVersion: shared.REGISTRY_VERSION,
    resolverVersion: shared.RESOLVER_VERSION,
    policyVersion: policy.policyVersion,
    projectId: requirement.projectId,
    sceneId: requirement.sceneId,
    shotId: requirement.shotId,
    sourceDecisionId: (requirement.sourceDecision && requirement.sourceDecision.decisionId) || null,
    sourceDecisionFingerprint: (requirement.sourceDecision && requirement.sourceDecision.fingerprint) || null,
    requirementFingerprint: requirement.fingerprint || null,
    requirement: { ...requirement },
    renderMode: requirement.renderMode,
    requiredCapabilities: [...(requirement.requiredCapabilities || [])],
    registrySnapshotRef: { snapshotId: snapshot.snapshotId, fingerprint: snapshot.fingerprint },
    candidateModels: partial.candidateModels || [],
    rejectedModels: partial.rejectedModels || [],
    recommendedProvider: partial.recommendedProvider || null,
    recommendedModel: partial.recommendedModel || null,
    selectedProvider: null,
    selectedModel: null,
    effectiveProvider: partial.recommendedProvider || null,
    effectiveModel: partial.recommendedModel || null,
    selectionState: partial.selectionState || (partial.status === "NOT_REQUIRED" || partial.status === "BLOCKED" ? partial.status : "RECOMMENDED"),
    selectionReasons: partial.selectionReasons || [],
    warnings: partial.warnings || [],
    blockers: partial.blockers || [],
    availabilityState: partial.availabilityState || "UNKNOWN",
    capabilityFreshness: "UNKNOWN",
    availabilityFreshness: "UNKNOWN",
    costFreshness: "UNKNOWN",
    costEstimate: partial.costEstimate || { state: "UNKNOWN", reason: "no model evaluated", unit: null, valuePerGeneration: null, estimatedTotal: null },
    resolutionKind: partial.resolutionKind || "VIDEO_MODEL",
    replanSuggestion: partial.replanSuggestion || null,
    sourceRefs: collectSourceRefs(snapshot),
    fingerprint: null,
    status: partial.status || "RESOLVED",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const rec = artifact.candidateModels.find((c) => c.modelId === artifact.recommendedModel);
  if (rec) {
    const model = (snapshot.models || []).find((m) => m.modelId === rec.modelId);
    if (model && model.freshness) {
      artifact.capabilityFreshness = model.freshness.capability;
      artifact.availabilityFreshness = model.freshness.availability;
      artifact.costFreshness = model.freshness.cost;
    }
  }
  artifact.fingerprint = shared.hash16({
    requirement: requirement.fingerprint, snapshot: snapshot.fingerprint,
    policy: policy.policyVersion, recommended: artifact.recommendedModel,
    status: artifact.status, kinds: artifact.resolutionKind,
  });
  return artifact;
}

function collectSourceRefs(snapshot) {
  return (snapshot.sources || []).map((s) => s.sourceId);
}

/**
 * Manual model override validation. Never mutates the 1G.5 decision;
 * re-validates the named model against the STORED requirement.
 * Returns { ok, state: ACCEPTED|ACCEPTED_WITH_WARNING|BLOCKED, artifact?, warnings[], blockers[] }.
 */
function applyModelOverride(artifactInput, selection, snapshot, policyInput = {}) {
  const warnings = [];
  const blockers = [];
  const policy = withPolicy(policyInput);
  const artifact = artifactInput ? JSON.parse(JSON.stringify(artifactInput)) : null;
  if (!artifact) return { ok: false, state: "BLOCKED", warnings, blockers: ["RESOLUTION_MISSING: no resolution to override"] };
  const modelId = selection && (selection.modelId || selection.model);
  const model = (snapshot.models || []).find((m) => m.modelId === modelId);
  if (!model) {
    return { ok: false, state: "BLOCKED", warnings, blockers: [`UNKNOWN_MODEL: ${modelId} is not a registered model ID`] };
  }
  if (artifact.sourceDecisionFingerprint && selection.sourceDecisionFingerprint
    && selection.sourceDecisionFingerprint !== artifact.sourceDecisionFingerprint) {
    blockers.push("STALE_SOURCE_DECISION: upstream 1G.5 decision changed — re-resolve before overriding");
    return { ok: false, state: "BLOCKED", warnings, blockers };
  }
  const check = checkModelCompatibility(model, artifact.requirement, policy, snapshot);
  if (!check.compatible) {
    return { ok: false, state: "BLOCKED", warnings, blockers: check.rejections.map((r) => `INCOMPATIBLE_OVERRIDE: ${r}`) };
  }
  artifact.selectedProvider = model.providerId;
  artifact.selectedModel = model.modelId;
  artifact.effectiveProvider = model.providerId;
  artifact.effectiveModel = model.modelId;
  artifact.overrideReason = (selection && selection.reason) || null;
  artifact.updatedAt = new Date().toISOString();
  if (model.availability === "UNKNOWN" && policy.allowProvisionalSelection) {
    warnings.push("RUNTIME_AVAILABILITY_NOT_VERIFIED: selected model account access unobserved");
    artifact.selectionState = "ACCEPTED_WITH_WARNING";
    return { ok: true, state: "ACCEPTED_WITH_WARNING", artifact, warnings, blockers };
  }
  artifact.selectionState = "ACCEPTED";
  return { ok: true, state: "ACCEPTED", artifact, warnings, blockers };
}

module.exports = {
  DEFAULT_POLICY,
  withPolicy,
  buildRequirement,
  checkModelCompatibility,
  applicableCosts,
  estimateCost,
  rankCandidates,
  resolveRequirement,
  applyModelOverride,
};
