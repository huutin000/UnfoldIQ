"use strict";

/**
 * UNFOLDIQ Visual/Motion Decision Engine facade (1G.5, Prompt 01).
 *
 * decideShotProduction / decidePlanProduction:
 *   Shot(+Scene) -> visualType -> motion need -> cheapest-adequate strategy
 *   -> reference/assets/capabilities -> versioned, explainable decision.
 *
 * applyManualOverride: operator selection is persisted and validated, never
 * silently overwritten, and cannot bypass hard blockers.
 *
 * compileForDecision: LAZY Prompt Compiler handoff — only the prompt packages
 * required by the effective strategy are compiled (1G.4 ownership unchanged:
 * the compiler stays targetKind-driven and never selects media strategy).
 *
 * Terminal statuses: DECISION_READY | DECISION_REVIEW_REQUIRED |
 * BLOCKED_MISSING_REFERENCE | BLOCKED_STALE_INPUT | BLOCKED_INVALID_OVERRIDE |
 * STALE.
 */

const shared = require("./shared.js");
const decisionLib = require("./decision.js");
const planLib = require("./plan.js");
const validatorLib = require("./validator.js");
const storeLib = require("./store.js");
const editorMotionLib = require("./editor-motion.js");

const STATUS = {
  DECISION_READY: "DECISION_READY",
  DECISION_REVIEW_REQUIRED: "DECISION_REVIEW_REQUIRED",
  BLOCKED_MISSING_REFERENCE: "BLOCKED_MISSING_REFERENCE",
  BLOCKED_STALE_INPUT: "BLOCKED_STALE_INPUT",
  BLOCKED_INVALID_OVERRIDE: "BLOCKED_INVALID_OVERRIDE",
  STALE: "STALE",
};

function decideShotProduction(input = {}) {
  return decisionLib.decideShotProduction(input);
}

function decidePlanProduction(input = {}) {
  return planLib.decidePlanProduction(input);
}

/**
 * Apply an operator manual selection to a decision.
 * Input: { decision, selectedOutputType, reason?, context? { shot, scene,
 *   referenceAssets?, supportedCapabilities?, stale? } }
 * Returns: { ok, state: ACCEPTED | ACCEPTED_WITH_WARNING | BLOCKED,
 *   decision?, warnings[], blockers[] }
 */
function applyManualOverride(input = {}) {
  const warnings = [];
  const blockers = [];
  const decision = input.decision ? { ...input.decision } : null;
  if (!decision) {
    return { ok: false, state: "BLOCKED", warnings, blockers: ["DECISION_MISSING: no decision to override"] };
  }
  const selected = shared.normalizeRecommendation(input.selectedOutputType);
  if (!shared.RECOMMENDATIONS.includes(selected)) {
    return { ok: false, state: "BLOCKED", warnings, blockers: [`INVALID_OVERRIDE: ${input.selectedOutputType} is not a valid production strategy`] };
  }
  const ctx = input.context || {};
  if (ctx.stale === true || decision.status === "STALE") {
    blockers.push("STALE_INPUT: upstream plan changed; re-run the decision before overriding");
    return { ok: false, state: "BLOCKED", warnings, blockers };
  }
  // Hard blocker: continuity-critical generated motion without a reference.
  if (selected.startsWith("GENERATED_MOTION") && ctx.referenceAssets) {
    const entities = (ctx.signals && ctx.signals.recurringEntities) || [];
    const strictMissing = entities.filter((e) => (e.lockStrength || "NORMAL") === "STRICT" && !e.hasApprovedReference);
    if (strictMissing.length > 0) {
      blockers.push(`BLOCKED_MISSING_REFERENCE: STRICT entity ${strictMissing.map((e) => e.entityId).join(", ")} has no approved reference`);
      return { ok: false, state: "BLOCKED", warnings, blockers };
    }
  }
  // Hard blocker: unsupported production capability downstream.
  if (ctx.supportedCapabilities && decision.requiredCapabilities) {
    const missing = decision.requiredCapabilities.filter((c) => !ctx.supportedCapabilities.includes(c));
    if (selected.startsWith("GENERATED_MOTION") && missing.length > 0) {
      blockers.push(`UNSUPPORTED_CAPABILITY: downstream cannot provide ${missing.join(", ")}`);
      return { ok: false, state: "BLOCKED", warnings, blockers };
    }
  }
  // Hard blocker: factual-integrity violation (evidence reframed as generated).
  if (decision.framing === "EVIDENCE_VISUAL" && selected.startsWith("GENERATED_MOTION")) {
    blockers.push("FACTUAL_INTEGRITY: evidence-framed visual cannot be overridden into generated motion");
    return { ok: false, state: "BLOCKED", warnings, blockers };
  }

  decision.selectedOutputType = selected;
  decision.selectedReason = input.reason || null;
  decision.effectiveOutputType = selected;
  decision._selectedSet = true;
  decision.updatedAt = new Date().toISOString();
  // Hardening sweep (A-5): the derived capability/role/strategy fields must be
  // re-derived from the SELECTED strategy, not carried over from the
  // recommendation — a downgrade that keeps VIDEO capabilities is rejected by
  // the validator, and an upgrade that keeps referenceStrategy NONE loses the
  // identity/reference workflow silently.
  // Identity-critical proxy: the decision's own reference requirements. An
  // existing video decision carries them in requiredCapabilities/referenceStrategy;
  // an upgrade override carries them in referenceAssetIds (from signals).
  const ctxEntities = (ctx.signals && ctx.signals.recurringEntities) || [];
  const hasApprovedRefs = (decision.requiredCapabilities || []).includes("REFERENCE_GUIDED_VIDEO")
    || decision.referenceStrategy === "START_FRAME_REQUIRED"
    || (Array.isArray(decision.referenceAssetIds) && decision.referenceAssetIds.length > 0)
    || ctxEntities.some((e) => e && e.hasApprovedReference);
  const orientationCaps = (decision.requiredCapabilities || []).filter((c) => c === "PORTRAIT_OUTPUT" || c === "LANDSCAPE_OUTPUT");
  if (selected === "STATIC_IMAGE" || selected === "EDITOR_MOTION") {
    decision.referenceStrategy = hasApprovedRefs ? decision.referenceStrategy : "NONE";
    decision.requiredCapabilities = ["IMAGE_GENERATION", ...orientationCaps];
    decision.requiredAssetRoles = ["PRIMARY_IMAGE"];
  } else {
    decision.referenceStrategy = hasApprovedRefs ? "START_FRAME_REQUIRED" : (decision.referenceStrategy === "NONE" ? "TEXT_BASED" : decision.referenceStrategy);
    decision.requiredCapabilities = ["IMAGE_GENERATION", "IMAGE_TO_VIDEO", ...(hasApprovedRefs ? ["REFERENCE_GUIDED_VIDEO"] : []), ...orientationCaps];
    decision.requiredAssetRoles = ["START_FRAME"];
  }
  // The render mode follows the effective production strategy (FIX 1 §11:
  // productionRecommendation and renderMode stay separate but consistent).
  const reRendered = decisionLib.resolveRenderMode({
    recommendation: selected,
    referenceStrategy: decision.referenceStrategy,
    requiredCapabilities: decision.requiredCapabilities,
    // Identity-criticality is a property of the shot (recurring subject with an
    // approved reference), not of the override: keep the decision's own
    // REFERENCE_GUIDED_VIDEO requirement instead of demoting VEO_REFERENCE.
    identityCritical: hasApprovedRefs,
  });
  decision.renderMode = reRendered.renderMode;
  decision.renderModeReasons = [...(decision.renderModeReasons || []), ...reRendered.reasons.map((r) => `override: ${r}`)];
  if (selected === decision.recommendedOutputType) {
    decision.overrideState = "ACCEPTED";
  } else {
    const down = shared.COST_ORDER[selected] < shared.COST_ORDER[decision.recommendedOutputType];
    if (down && decision.generatedMotionValue === "HIGH") {
      warnings.push("OVERRIDE_ACCEPTED_WITH_WARNING: operator downgraded HIGH-value generated motion; narrative impact should be reviewed");
      decision.overrideState = "ACCEPTED_WITH_WARNING";
    } else {
      decision.overrideState = "ACCEPTED";
    }
  }
  return { ok: true, state: decision.overrideState, decision, warnings, blockers };
}

/**
 * Lazy Prompt Compiler handoff for one decision (FIX 1 §18).
 * Compiles ONLY the packages the effective RENDER MODE needs:
 *   STATIC_IMAGE     -> IMAGE when the still must be generated
 *   REMOTION_MOTION  -> IMAGE when a source image is required (+ motion
 *                       metadata, NO VIDEO by default)
 *   VEO_FIRST_FRAME  -> IMAGE for the start frame when needed + VIDEO
 *   VEO_FIRST_LAST   -> IMAGE package(s) for start/end frames when needed + VIDEO
 *   VEO_REFERENCE    -> required reference asset refs + VIDEO; IMAGE only when
 *                       a start/reference asset must first be created
 * Input: { decision, compilerInput: { projectId, shot, scene, beatMap,
 *   storyDraft?, platform, contentClass, overrides?, referenceAssets? },
 *   options?: { root?, persist?, budgetChars? } }
 */
async function compileForDecision(input = {}, options = {}) {
  const decision = input.decision;
  const ci = input.compilerInput || {};
  if (!decision || !decision.effectiveOutputType) {
    return { ok: false, code: "DECISION_NOT_READY", message: "a READY decision with an effective strategy is required" };
  }
  if (decision.status !== "DECISION_READY" && decision.status !== undefined) {
    return { ok: false, code: "DECISION_NOT_READY", message: `decision status ${decision.status} cannot drive compilation` };
  }
  // The compiler is lazy and targetKind-driven (1G.4): this layer supplies
  // the target from the canonical render mode, the compiler never infers it.
  const pc = require("../prompt-compiler/index.js");
  const renderMode = decision.renderMode;
  if (!renderMode) {
    return { ok: false, code: "DECISION_TARGET_EMPTY", message: "no render mode resolved for the effective strategy" };
  }
  const needsStartImage = (decision.requiredAssetRoles || []).includes("START_FRAME")
    || decision.referenceStrategy === "START_FRAME_REQUIRED"
    || decision.referenceStrategy === "REFERENCE_GUIDED";
  const targets = [];
  if (renderMode === "STATIC_IMAGE" || renderMode === "REMOTION_MOTION") targets.push("IMAGE");
  else if (renderMode === "VEO_FIRST_FRAME") { if (needsStartImage) targets.push("IMAGE"); targets.push("VIDEO"); }
  else if (renderMode === "VEO_FIRST_LAST") { targets.push("IMAGE"); targets.push("VIDEO"); }
  else if (renderMode === "VEO_REFERENCE") { if (needsStartImage) targets.push("IMAGE"); targets.push("VIDEO"); }
  if (targets.length === 0) {
    return { ok: false, code: "DECISION_TARGET_EMPTY", message: "effective strategy maps to no prompt package" };
  }
  const packages = [];
  for (const targetKind of targets) {
    const r = await pc.compilePromptPackage({ ...ci, targetKind }, { persist: false, ...(options.compilerOptions || {}) });
    packages.push({ targetKind, ok: r.ok, status: r.status, promptPackageId: r.promptPackageId || null, result: r });
    if (!r.ok) {
      return { ok: false, code: "PROMPT_COMPILATION_BLOCKED", message: `${targetKind} package blocked: ${(r.blockers || []).join("; ")}`, packages };
    }
  }
  if (options.root && options.persist !== false) {
    // Hardening sweep (A-14): persist the VALIDATED compile result instead of
    // recompiling a second time (the recompiled artifact was never the
    // validated one and doubled the work).
    const pcStore = require("../prompt-compiler/store.js");
    for (const p of packages) {
      const saved = pcStore.persistPromptPackage(options.root, ci.projectId, { ...p.result, _force: (options.compilerOptions && options.compilerOptions.force) === true });
      p.persisted = saved.ok;
    }
  }
  const out = {
    ok: true,
    shotId: decision.shotId,
    effectiveOutputType: decision.effectiveOutputType,
    renderMode,
    packages: packages.map((p) => ({ targetKind: p.targetKind, status: p.status, promptPackageId: p.promptPackageId })),
    editorMotionPlan: renderMode === "REMOTION_MOTION" ? (decision.editorMotionPlan || null) : null,
    videoCompiled: targets.includes("VIDEO"),
  };
  return out;
}

module.exports = {
  STATUS,
  DECISION_VERSION: shared.DECISION_VERSION,
  DECISION_POLICY_VERSION: shared.DECISION_POLICY_VERSION,
  RECOMMENDATIONS: shared.RECOMMENDATIONS,
  LEGACY_ALIAS: shared.LEGACY_ALIAS,
  VISUAL_MODALITIES: shared.VISUAL_MODALITIES,
  RENDER_MODES: shared.RENDER_MODES,
  decideShotProduction,
  decidePlanProduction,
  applyManualOverride,
  compileForDecision,
  resolveRenderMode: decisionLib.resolveRenderMode,
  classifyVisualModality: require("./grammar.js").classifyVisualModality,
  validateDecision: validatorLib.validateDecision,
  checkDecisionStaleness: storeLib.checkDecisionStaleness,
  persistDecision: storeLib.persistDecision,
  loadDecision: storeLib.loadDecision,
  listDecisions: storeLib.listDecisions,
  markShotStale: storeLib.markShotStale,
  invalidateByScene: storeLib.invalidateByScene,
  invalidateByReference: storeLib.invalidateByReference,
  buildEditorMotionPlan: editorMotionLib.buildEditorMotionPlan,
  projectSummary: planLib.projectSummary,
  motionValueScore: planLib.motionValueScore,
  shared,
};
