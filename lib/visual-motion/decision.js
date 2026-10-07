"use strict";

/**
 * UNFOLDIQ Visual/Motion Decision Engine core (1G.5, Prompt 01).
 *
 * Cheapest-adequate rule: STATIC_IMAGE -> EDITOR_MOTION ->
 * GENERATED_MOTION_CANDIDATE -> GENERATED_MOTION_RECOMMENDED. A Shot moves up
 * ONLY on positive, explainable evidence of additional narrative value.
 *
 * Pure + deterministic: same canonical inputs + same policy version -> same
 * recommendation, same reasons, same fingerprint. No provider calls, no
 * models, no prices, no generation, no Remotion.
 */

const shared = require("./shared.js");
const editorMotion = require("./editor-motion.js");
const grammar = require("./grammar.js");

const {
  DECISION_VERSION,
  DECISION_POLICY_VERSION,
  COST_ORDER,
  COST_CLASS,
} = shared;

/** Motion signals with narrative weight (essential signals carry weight 2). */
const MOTION_SIGNALS = [
  { key: "subjectMovement", weight: 1, label: "meaningful subject movement" },
  { key: "physicalInteraction", weight: 2, label: "physical interaction", essential: true },
  { key: "essentialToUnderstanding", weight: 2, label: "movement essential to understanding", essential: true },
  { key: "temporalTransformation", weight: 2, label: "temporal transformation", essential: true },
  { key: "environmentalDynamics", weight: 1, label: "environmental dynamics" },
  { key: "revealProgression", weight: 1, label: "reveal requiring progression" },
  { key: "causeEffectOverTime", weight: 2, label: "cause/effect best shown over time", essential: true },
  { key: "cameraMovementNeeded", weight: 1, label: "camera movement necessary for information" },
  { key: "turningPoint", weight: 1, label: "narrative turning point" },
  { key: "emotionalPayoff", weight: 1, label: "emotional/action payoff" },
];

/** Explainable visual-type baseline per type (actual Shot signals override). */
const VISUAL_BASELINE = {
  EVIDENCE: "STATIC_IMAGE",
  OBJECT: "STATIC_IMAGE",
  COMPARISON: "STATIC_IMAGE",
  DIAGRAM: "EDITOR_MOTION",
  MAP: "EDITOR_MOTION",
  TIMELINE: "EDITOR_MOTION",
  ENVIRONMENT: "STATIC_IMAGE",
  CHARACTER_SCENE: "STATIC_IMAGE",
};

/** Only these purposes map to a visual type without an explicit caller hint. */
const PURPOSE_VISUAL = {
  EVIDENCE_VISUAL: "EVIDENCE",
  ESTABLISH: "ENVIRONMENT",
};

/** Phrases that make downstream provider safety filtering likely. Advisory only. */
const GENERATION_RISK_PATTERN = /(child|children|minor|toddler|infant|baby).{0,60}(violen|kill|attack|blood|abus|naked|weapon)|graphic (violen|gore|blood)|self[- ]?harm|suicid/i;

/**
 * Stage B render-mode resolution (FIX 1 §11-§12). The VEO_* names describe
 * the generation/render WORKFLOW FAMILY — never a model (1G.6 owns models).
 * Priority with overlaps: precise A→B transition first (strictest workflow),
 * then identity-critical reference, else single established frame.
 */
function resolveRenderMode(input = {}) {
  const { recommendation, referenceStrategy, requiredCapabilities, identityCritical } = input;
  const reasons = [];
  if (!recommendation) return { renderMode: null, reasons };
  if (recommendation === "STATIC_IMAGE") {
    reasons.push("renderMode = STATIC_IMAGE: the modality is expressed by a still, no motion render");
    return { renderMode: "STATIC_IMAGE", reasons };
  }
  if (recommendation === "EDITOR_MOTION") {
    reasons.push("renderMode = REMOTION_MOTION: deterministic editor motion expresses the modality");
    return { renderMode: "REMOTION_MOTION", reasons };
  }
  const caps = requiredCapabilities || [];
  if (caps.includes("FIRST_LAST_FRAME_VIDEO")) {
    reasons.push("renderMode = VEO_FIRST_LAST: precise A→B transition workflow (start + end frame)");
    return { renderMode: "VEO_FIRST_LAST", reasons };
  }
  if (identityCritical) {
    reasons.push("renderMode = VEO_REFERENCE: identity/reference-critical motion workflow");
    return { renderMode: "VEO_REFERENCE", reasons };
  }
  reasons.push(`renderMode = VEO_FIRST_FRAME: animate one established frame (${referenceStrategy || "no reference strategy"})`);
  return { renderMode: "VEO_FIRST_FRAME", reasons };
}

function isKnown(v) {
  return v === true;
}

function classifyVisualType(shot, signals) {
  const reasons = [];
  if (signals.visualType) {
    if (!shared.VISUAL_TYPES.includes(signals.visualType)) {
      return { visualType: null, source: "invalid", reasons: [`unknown visualType hint "${signals.visualType}"`] };
    }
    reasons.push(`visualType = ${signals.visualType} (explicit caller signal)`);
    return { visualType: signals.visualType, source: "explicit", reasons };
  }
  const mapped = PURPOSE_VISUAL[shot.shotPurpose];
  if (mapped) {
    reasons.push(`visualType = ${mapped} (derived from shotPurpose ${shot.shotPurpose})`);
    return { visualType: mapped, source: "purpose-baseline", reasons };
  }
  return {
    visualType: null,
    source: "unknown",
    reasons: [`shotPurpose ${shot.shotPurpose} carries no safe visual-type default; explicit visualType signal required (no guessing)`],
  };
}

function classifyMotionNeed(signals) {
  const contributing = [];
  let score = 0;
  let knownCount = 0;
  for (const sig of MOTION_SIGNALS) {
    const v = signals[sig.key];
    if (v === true) {
      knownCount++;
      score += sig.weight;
      contributing.push(`${sig.label} (+${sig.weight})`);
    } else if (v === false) {
      knownCount++;
    }
  }
  if (knownCount === 0) {
    return { level: null, score: 0, contributing, insufficient: true };
  }
  const essentialCount = MOTION_SIGNALS.filter((s) => s.essential && signals[s.key] === true).length;
  let level = "NONE";
  if (score >= 4 || essentialCount >= 2) level = "HIGH";
  else if (score >= 2) level = "MEDIUM";
  else if (score >= 1) level = "LOW";
  return { level, score, contributing, essentialCount, insufficient: false };
}

/** Editor viability + technique selection for a visual type / motion need. */
function assessEditorViability(visualType, motion, signals) {
  const baseline = editorMotion.BASELINE_TECHNIQUES[visualType] || ["PAN", "ZOOM"];
  const techniques = baseline.slice(0, 4);
  // LOW motion never needs generated video; MEDIUM is usually synthesizable;
  // HIGH with essential physical/temporal change is poorly served by stills.
  const essentialPhysical = motion.essentialCount > 0 && motion.level === "HIGH";
  const quality = motion.level === "NONE" || motion.level === "LOW" ? "GOOD"
    : essentialPhysical ? "POOR" : "ADEQUATE";
  return {
    viable: quality !== "POOR",
    techniques,
    editorAlternativeQuality: quality,
    reasons: quality === "POOR"
      ? [`editor alternative is POOR: HIGH motion need with essential physical/temporal change cannot be synthesized from stills`]
      : [`editor motion viable (${quality}): ${techniques.join(", ")} synthesize the required movement from still assets`],
  };
}

function continuityAssessment(signals) {
  const entities = Array.isArray(signals.recurringEntities) ? signals.recurringEntities : [];
  const explicit = signals.continuityRisk;
  const missingRef = entities.filter((e) => !e.hasApprovedReference);
  const strictMissing = missingRef.filter((e) => (e.lockStrength || "NORMAL") === "STRICT");
  let risk = "LOW";
  const reasons = [];
  if (explicit && ["LOW", "MEDIUM", "HIGH"].includes(explicit)) {
    risk = explicit;
    reasons.push(`continuity risk = ${risk} (explicit signal)`);
  } else if (entities.length > 0) {
    risk = strictMissing.length > 0 ? "HIGH" : missingRef.length > 0 ? "MEDIUM" : "LOW";
    reasons.push(`continuity risk = ${risk} (${entities.length} recurring entit${entities.length === 1 ? "y" : "ies"}, ${missingRef.length} without approved reference)`);
  }
  return {
    risk,
    reasons,
    recurringCount: entities.length,
    missingRefCount: missingRef.length,
    criticalMissing: strictMissing.length > 0,
    hasApprovedRef: entities.length > 0 && missingRef.length === 0,
  };
}

function framingFor(contentClass, signals, visualType) {
  if (signals.framing) return { framing: signals.framing, reason: `framing = ${signals.framing} (explicit signal)` };
  if (contentClass === "FICTION") {
    return { framing: "FICTIONAL_STAGING", reason: "FICTION content staged as illustration, never evidence" };
  }
  if (contentClass === "FACTUAL" && ["CHARACTER_SCENE", "ENVIRONMENT"].includes(visualType)) {
    return { framing: "RECONSTRUCTION", reason: "FACTUAL scene with non-evidence visual requires reconstruction framing" };
  }
  if (contentClass === "FACTUAL" && visualType === "EVIDENCE") {
    return { framing: "EVIDENCE_VISUAL", reason: "FACTUAL evidence visual stays evidence-framed" };
  }
  return { framing: "ILLUSTRATIVE", reason: "default illustrative framing (no evidence claim)" };
}

/**
 * Decide production strategy for ONE shot.
 * Input: { projectId, shot, scene, beatMap?, contentClass, platform?,
 *          signals?, policyVersion?, now? }
 * signals: visualType?, motion flags (booleans), importance?,
 *   stateTransition?, recurringEntities?, referenceAvailability?,
 *   framing?, classificationRefs?, claimRefs?, continuityRisk?,
 *   focusTarget?, direction?, intensity?, referenceAssetIds? }
 */
function decideShotProduction(input = {}) {
  const { shot, scene } = input;
  const now = input.now || new Date().toISOString();
  const signals = input.signals || {};
  const contentClass = input.contentClass || (shot && shot.contentClass) || null;
  const platform = input.platform || (shot && shot.platform) || null;
  const reasons = [];
  const warnings = [];
  const blockers = [];

  if (!shot || !shot.shotId || !scene || !scene.sceneId) {
    return {
      ok: false, code: "DECISION_SOURCE_INVALID",
      message: "shot and parent scene are required",
      status: "DECISION_REVIEW_REQUIRED",
    };
  }

  const vt = classifyVisualType(shot, signals);
  reasons.push(...vt.reasons);
  if (!vt.visualType) {
    return reviewDecision({ input, signals, now, contentClass, platform, reasons, warnings, blockers, motionNeed: null, visualType: null });
  }

  const motion = classifyMotionNeed(signals);
  if (motion.insufficient) {
    reasons.push("motion signals absent: refusing to guess cinematic intent");
    return reviewDecision({ input, signals, now, contentClass, platform, reasons, warnings, blockers, motionNeed: null, visualType: vt.visualType });
  }
  reasons.push(`motion need = ${motion.level} (score ${motion.score}: ${motion.contributing.join("; ") || "no positive signals"})`);

  const editor = assessEditorViability(vt.visualType, motion, signals);
  reasons.push(...editor.reasons);
  const continuity = continuityAssessment(signals);
  reasons.push(...continuity.reasons);

  // --- Stage A: Visual Story Grammar FIRST (modality before renderer).
  const beats = input.beatMap && Array.isArray(input.beatMap.beats)
    ? input.beatMap.beats.filter((b) => (shot.beatIds || []).includes(b.beatId))
    : [];
  const gram = grammar.classifyVisualModality({ shot, scene, beats, visualType: vt.visualType, signals });
  reasons.push(...gram.reasons.map((r) => `grammar: ${r}`));
  if (gram.reviewRequired) {
    reasons.push("modality REVIEW required: renderer cannot be chosen before the visual form is known");
    return reviewDecision({ input, signals, now, contentClass, platform, reasons, warnings, blockers, motionNeed: motion.level, visualType: vt.visualType, grammar: gram });
  }

  // --- Baseline, then cheapest-adequate upgrades on positive evidence only.
  let recommended = VISUAL_BASELINE[vt.visualType];
  reasons.push(`baseline ${recommended} for visualType ${vt.visualType} (explainable matrix, not a fixed ratio)`);

  if (motion.level === "NONE" && recommended === "EDITOR_MOTION") {
    recommended = "STATIC_IMAGE";
    reasons.push("downgraded to STATIC_IMAGE: no motion required, a single state communicates the point");
  } else if (motion.level === "LOW") {
    if (vt.visualType === "CHARACTER_SCENE") {
      recommended = "GENERATED_MOTION_CANDIDATE";
      reasons.push("candidate generated motion: LOW character motion may add value but is not proven essential (a subtle gesture is cheaper than a re-shoot, dearer than a still)");
    } else if (COST_ORDER[recommended] < COST_ORDER.EDITOR_MOTION && ["ENVIRONMENT", "COMPARISON", "OBJECT"].includes(vt.visualType)) {
      recommended = "EDITOR_MOTION";
      reasons.push("upgraded to EDITOR_MOTION: LOW motion is synthesizable from stills (pan/zoom/reveal)");
    }
  } else if (motion.level === "MEDIUM") {
    if (vt.visualType === "CHARACTER_SCENE") {
      recommended = "GENERATED_MOTION_CANDIDATE";
      reasons.push("candidate generated motion: MEDIUM character motion may add value but is not proven essential");
    } else if (COST_ORDER[recommended] < COST_ORDER.EDITOR_MOTION) {
      recommended = "EDITOR_MOTION";
      reasons.push("upgraded to EDITOR_MOTION: MEDIUM informational motion is synthesizable from stills");
    }
  } else if (motion.level === "HIGH") {
    // HIGH score alone is not enough: generated motion needs essential
    // evidence (real interaction, comprehension-critical movement, true
    // cause/effect). Informational progression on explanatory visuals
    // (route traced, steps revealed, camera swept) is editor-synthesizable.
    const hasEssential = signals.essentialToUnderstanding === true
      || signals.physicalInteraction === true
      || signals.causeEffectOverTime === true;
    const hasRealMovement = signals.subjectMovement === true
      || signals.physicalInteraction === true
      || signals.environmentalDynamics === true
      || signals.temporalTransformation === true;
    if (hasEssential) {
      recommended = "GENERATED_MOTION_RECOMMENDED";
      reasons.push(`generated motion RECOMMENDED: HIGH motion need with essential evidence (${motion.contributing.filter((c) => MOTION_SIGNALS.some((s) => s.essential && c.startsWith(s.label))).join("; ")})`);
    } else if (vt.visualType === "CHARACTER_SCENE") {
      recommended = "GENERATED_MOTION_CANDIDATE";
      reasons.push("HIGH score without essential physical/temporal evidence: candidate at most (importance/cinematic weight alone never forces generated video)");
    } else if (vt.visualType === "ENVIRONMENT" && hasRealMovement) {
      recommended = "GENERATED_MOTION_CANDIDATE";
      reasons.push("candidate generated motion: real environmental dynamics without proven essential value");
    } else {
      recommended = COST_ORDER[VISUAL_BASELINE[vt.visualType]] >= COST_ORDER.EDITOR_MOTION
        ? VISUAL_BASELINE[vt.visualType] : "EDITOR_MOTION";
      reasons.push("HIGH score without essential evidence on an explanatory visual: informational progression stays editor-synthesizable");
    }
  }

  // --- Stage A constrains Stage B: the modality caps the renderer honestly
  // (a chart never needs generated video, no matter the motion score).
  const cap = grammar.applyModalityCap(gram.modality, recommended);
  if (cap.capped) {
    recommended = cap.recommendation;
    reasons.push(cap.reason);
  }

  // --- Split-screen presentation inherently needs deterministic assembly:
  // even with no motion, two visuals must be composed, so STATIC is dishonest.
  if (gram.modality === "SPLIT_SCREEN" && recommended === "STATIC_IMAGE") {
    recommended = "EDITOR_MOTION";
    reasons.push("upgraded to EDITOR_MOTION: SPLIT_SCREEN presentation requires deterministic side-by-side composition");
  }

  // --- Continuity risk: marginal value + high drift risk -> prefer editor.
  if (continuity.risk === "HIGH" && ["GENERATED_MOTION_CANDIDATE"].includes(recommended) && motion.essentialCount === 0) {
    recommended = "EDITOR_MOTION";
    reasons.push("downgraded to EDITOR_MOTION: HIGH continuity risk outweighs marginal generated-motion value");
  }

  // --- Evidence framing constrains generated motion (downgrade, never silent).
  const framing = framingFor(contentClass, signals, vt.visualType);
  reasons.push(framing.reason);
  if (framing.framing === "EVIDENCE_VISUAL" && recommended === "GENERATED_MOTION_RECOMMENDED") {
    recommended = "GENERATED_MOTION_CANDIDATE";
    reasons.push("capped at CANDIDATE: evidence-framed visuals must not be silently reenacted as generated footage");
    warnings.push("EVIDENCE_FRAMING_CONSTRAINS_MOTION: generated reenactment of evidence requires explicit review");
  }

  // --- Reference-first strategy for recurring subjects.
  let referenceStrategy = "NONE";
  if (recommended.startsWith("GENERATED_MOTION")) {
    if (continuity.recurringCount > 0 && continuity.hasApprovedRef) {
      referenceStrategy = "START_FRAME_REQUIRED";
      reasons.push("reference-first: recurring subject with approved reference -> generated motion from the established visual, never text-only identity regeneration");
    } else if (continuity.recurringCount > 0) {
      referenceStrategy = "REFERENCE_GUIDED";
      reasons.push("reference-guided preferred for recurring subject, but no approved reference is available");
    } else {
      referenceStrategy = "TEXT_BASED";
      reasons.push("text-based motion allowed: generic/non-recurring visual with no identity to preserve");
    }
  }

  // --- Hard blocker: continuity-critical generated motion without a reference.
  const generatedMotionValue = recommended === "GENERATED_MOTION_RECOMMENDED" ? "HIGH"
    : recommended === "GENERATED_MOTION_CANDIDATE" ? (motion.level === "HIGH" ? "MEDIUM" : "LOW")
    : motion.level === "HIGH" ? "MEDIUM" : "NONE";
  if (recommended.startsWith("GENERATED_MOTION") && continuity.criticalMissing && motion.essentialCount > 0) {
    blockers.push("BLOCKED_MISSING_REFERENCE: STRICT continuity entity has no approved reference; generated motion cannot proceed until the reference exists");
  }

  // --- State A -> state B transition requests first/last-frame capability.
  const shotStart = signals.startState !== undefined ? signals.startState : shot.startState;
  const shotEnd = signals.endState !== undefined ? signals.endState : shot.endState;
  const isTransition = signals.stateTransition === true
    || (shotStart && shotEnd && String(shotStart) !== String(shotEnd));
  if (isTransition) reasons.push(`state transition ${shotStart || "?"} -> ${shotEnd || "?"} noted for capability planning`);

  // --- Capabilities (concepts only) + asset roles.
  const composition = shared.readPlatformComposition(platform);
  const orientationCap = composition && composition.orientationCapability ? [composition.orientationCapability] : [];
  let requiredCapabilities = [];
  let requiredAssetRoles = [];
  if (recommended === "STATIC_IMAGE") {
    requiredCapabilities = ["IMAGE_GENERATION", ...orientationCap];
    requiredAssetRoles = ["PRIMARY_IMAGE"];
  } else if (recommended === "EDITOR_MOTION") {
    requiredCapabilities = ["IMAGE_GENERATION", ...orientationCap];
    requiredAssetRoles = ["PRIMARY_IMAGE"];
  } else if (referenceStrategy === "TEXT_BASED") {
    requiredCapabilities = ["VIDEO_GENERATION", ...orientationCap];
    requiredAssetRoles = [];
    if (isTransition) {
      // Even text-based A→B transitions need the first+last-frame workflow;
      // both frames are created as canonical assets first (see §18).
      requiredCapabilities.push("FIRST_LAST_FRAME_VIDEO");
      requiredAssetRoles.push("START_FRAME", "END_FRAME");
    }
  } else {
    requiredCapabilities = ["IMAGE_GENERATION", "IMAGE_TO_VIDEO", "REFERENCE_GUIDED_VIDEO", ...orientationCap];
    requiredAssetRoles = ["START_FRAME"];
    if (continuity.recurringCount > 0) {
      const kinds = new Set((signals.recurringEntities || []).map((e) => e.kind).filter(Boolean));
      if (kinds.has("ENVIRONMENT") || kinds.size === 0) requiredAssetRoles.push("ENVIRONMENT_REFERENCE");
      if (kinds.has("CHARACTER") || kinds.size === 0) requiredAssetRoles.push("CHARACTER_REFERENCE");
      if (kinds.has("OBJECT")) requiredAssetRoles.push("OBJECT_REFERENCE");
    }
    if (isTransition) {
      requiredCapabilities.push("FIRST_LAST_FRAME_VIDEO");
      requiredAssetRoles.push("END_FRAME");
    }
  }

  // --- Generation-risk advisory (never rewrites story).
  let generationRisk = "NONE";
  const scanText = [shot.actionIntent, shot.cameraIntent, signals.actionNote].filter(Boolean).join(" ");
  if (GENERATION_RISK_PATTERN.test(scanText)) {
    generationRisk = "GENERATION_RISK";
    warnings.push("GENERATION_RISK: content may trigger downstream provider safety filters; production should plan a fallback");
  }

  // --- Stage B: canonical render mode from recommendation + reference strategy.
  const rendered = resolveRenderMode({
    recommendation: recommended,
    referenceStrategy,
    requiredCapabilities,
    identityCritical: continuity.recurringCount > 0 && continuity.hasApprovedRef,
  });
  reasons.push(...rendered.reasons);

  // --- Editor motion plan for EDITOR_MOTION.
  let editorMotionPlan = null;
  if (recommended === "EDITOR_MOTION") {
    const built = editorMotion.buildEditorMotionPlan({
      shotId: shot.shotId,
      visualType: vt.visualType,
      focusTarget: signals.focusTarget,
      direction: signals.direction,
      intensity: signals.intensity,
    });
    if (built.ok) editorMotionPlan = built.plan;
    else warnings.push(`EDITOR_PLAN_SKIPPED: ${built.message}`);
  }

  const claimRefs = [...new Set([...(shot.claimRefs || []), ...(signals.claimRefs || [])])];
  const classificationRefs = signals.classificationRefs || [];
  const referenceAssetIds = Array.isArray(signals.referenceAssetIds) ? [...new Set(signals.referenceAssetIds)] : [];
  const referenceVersions = {};
  for (const a of (input.referenceAssets || [])) {
    if (a && a.assetId) referenceVersions[a.assetId] = a.version || a.hash || null;
  }
  const beatFingerprints = {};
  for (const b of beats) beatFingerprints[b.beatId] = shared.hash16(b);

  const status = blockers.length > 0 ? "BLOCKED_MISSING_REFERENCE" : "DECISION_READY";
  const decisionId = shared.id12("pd", { shotId: shot.shotId, policy: DECISION_POLICY_VERSION, vt: vt.visualType, rec: recommended });
  const sourceFingerprints = {
    shot: shared.hash16(shot),
    scene: shared.hash16(scene),
    policyVersion: input.policyVersion || DECISION_POLICY_VERSION,
  };
  const decision = {
    version: DECISION_VERSION,
    decisionId,
    projectId: input.projectId,
    sceneId: scene.sceneId,
    shotId: shot.shotId,
    visualType: vt.visualType,
    visualModality: gram.modality,
    modalityReasons: gram.reasons.slice(),
    modalityConfidence: gram.confidence,
    alternativeModalities: gram.alternatives.slice(),
    beatLineage: gram.beatLineage,
    beatFingerprints,
    referenceAssetIds,
    referenceVersions,
    recommendedOutputType: recommended,
    selectedOutputType: null,
    effectiveOutputType: recommended,
    renderMode: rendered.renderMode,
    renderModeReasons: rendered.reasons.slice(),
    motionNeed: motion.level,
    motionScore: motion.score,
    editorMotionViability: { viable: editor.viable, techniques: editor.techniques, editorAlternativeQuality: editor.editorAlternativeQuality },
    generatedMotionValue,
    referenceStrategy,
    requiredCapabilities,
    requiredAssetRoles,
    editorMotionPlan,
    decisionReasons: reasons,
    warnings,
    blockers,
    framing: framing.framing,
    generationRisk,
    costClass: COST_CLASS[recommended],
    externalCostEstimate: "UNKNOWN",
    claimRefs,
    classificationRefs,
    sourceRefs: { shotId: shot.shotId, sceneId: scene.sceneId, beatIds: (shot.beatIds || []).slice() },
    sourceFingerprints,
    platform,
    contentClass,
    policyRef: input.policyVersion || DECISION_POLICY_VERSION,
    selectedReason: null,
    overrideState: "NONE",
    fingerprint: null,
    status,
    createdAt: now,
    updatedAt: now,
  };
  decision.fingerprint = shared.hash16({
    policy: DECISION_POLICY_VERSION,
    visualType: decision.visualType,
    visualModality: decision.visualModality,
    recommended: decision.recommendedOutputType,
    renderMode: decision.renderMode,
    motionNeed: decision.motionNeed,
    motionScore: decision.motionScore,
    referenceStrategy: decision.referenceStrategy,
    requiredCapabilities: decision.requiredCapabilities,
    requiredAssetRoles: decision.requiredAssetRoles,
    editorTechniques: editorMotionPlan ? editorMotionPlan.techniques : null,
    framing: decision.framing,
    claimRefs: decision.claimRefs,
    classificationRefs: decision.classificationRefs,
    sourceFingerprints,
    platform,
    contentClass,
  });
  return { ok: true, status, decision, warnings };
}

function reviewDecision({ input, signals, now, contentClass, platform, reasons, warnings, blockers, motionNeed, visualType, grammar }) {
  const { shot, scene } = input;
  const gram = grammar || { modality: null, reasons: [], confidence: null, alternatives: [], beatLineage: null };
  const decision = {
    version: DECISION_VERSION,
    decisionId: shared.id12("pd", { shotId: shot.shotId, policy: DECISION_POLICY_VERSION, review: true }),
    projectId: input.projectId,
    sceneId: scene.sceneId,
    shotId: shot.shotId,
    visualType,
    visualModality: gram.modality,
    modalityReasons: (gram.reasons || []).slice(),
    modalityConfidence: gram.confidence || null,
    alternativeModalities: (gram.alternatives || []).slice(),
    beatLineage: gram.beatLineage || {
      beatIds: (shot.beatIds || []).slice(),
      narrativeRoles: [],
      narrativePurpose: (scene && scene.narrativePurpose) || null,
      visualObjective: (scene && scene.visualObjective) || (shot && shot.visualObjective) || null,
      shotPurpose: (shot && shot.shotPurpose) || null,
    },
    beatFingerprints: {},
    referenceAssetIds: Array.isArray(signals.referenceAssetIds) ? [...new Set(signals.referenceAssetIds)] : [],
    recommendedOutputType: null,
    selectedOutputType: null,
    effectiveOutputType: null,
    renderMode: null,
    renderModeReasons: ["no render mode: visual modality under review, renderer undecided by design"],
    motionNeed,
    motionScore: null,
    editorMotionViability: null,
    generatedMotionValue: null,
    referenceStrategy: null,
    requiredCapabilities: [],
    requiredAssetRoles: [],
    editorMotionPlan: null,
    decisionReasons: reasons,
    warnings,
    blockers,
    framing: null,
    generationRisk: "NONE",
    costClass: null,
    externalCostEstimate: "UNKNOWN",
    claimRefs: [...new Set([...(shot.claimRefs || []), ...(signals.claimRefs || [])])],
    classificationRefs: signals.classificationRefs || [],
    sourceRefs: { shotId: shot.shotId, sceneId: scene.sceneId, beatIds: (shot.beatIds || []).slice() },
    sourceFingerprints: {
      shot: shared.hash16(shot),
      scene: shared.hash16(scene),
      policyVersion: input.policyVersion || DECISION_POLICY_VERSION,
    },
    platform,
    contentClass,
    policyRef: input.policyVersion || DECISION_POLICY_VERSION,
    selectedReason: null,
    overrideState: "NONE",
    fingerprint: shared.hash16({ policy: DECISION_POLICY_VERSION, review: true, shot: shared.hash16(shot) }),
    status: "DECISION_REVIEW_REQUIRED",
    createdAt: now,
    updatedAt: now,
  };
  return { ok: true, status: "DECISION_REVIEW_REQUIRED", decision, warnings };
}

module.exports = {
  MOTION_SIGNALS,
  VISUAL_BASELINE,
  decideShotProduction,
  resolveRenderMode,
  classifyVisualType,
  classifyMotionNeed,
  assessEditorViability,
};
