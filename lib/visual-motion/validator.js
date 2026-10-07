"use strict";

/**
 * Production Decision validator (1G.5 §61). Structured { valid, errors[],
 * warnings[] } — never an opaque score. Also enforces the provider boundary:
 * no model names and no credit prices may appear in canonical decision text.
 */

const Ajv = require("ajv");
const addFormats = require("ajv-formats");
const fs = require("fs");
const path = require("path");
const shared = require("./shared.js");

const MODEL_NAME_PATTERN = /\bveo\b|gemini|nano[\s-]?banana|imagen|omniflash|omni\s*flash|ultra\s*subscriber|ai\s*ultra/i;
const CREDIT_PRICE_PATTERN = /\$\s*\d|£\s*\d|€\s*\d|\b\d+\s*(credits?|usd|eur|vnd)\b|\bcredit\s*(cost|price|costs|prices)\b/i;

const STRATEGY_CAPABILITY_NEEDS = {
  STATIC_IMAGE: ["IMAGE_GENERATION"],
  EDITOR_MOTION: ["IMAGE_GENERATION"],
  GENERATED_MOTION_CANDIDATE: ["VIDEO_GENERATION", "IMAGE_TO_VIDEO"],
  GENERATED_MOTION_RECOMMENDED: ["VIDEO_GENERATION", "IMAGE_TO_VIDEO"],
};

const STRATEGY_ASSET_NEEDS = {
  STATIC_IMAGE: ["PRIMARY_IMAGE"],
  EDITOR_MOTION: ["PRIMARY_IMAGE"],
  GENERATED_MOTION_CANDIDATE: [],
  GENERATED_MOTION_RECOMMENDED: [],
};

function loadSchema() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "schemas", "production-decision.schema.json"), "utf8").replace(/^\uFEFF/, ""));
}

function decisionText(decision) {
  return [...(decision.decisionReasons || []), ...(decision.modalityReasons || []),
    ...(decision.renderModeReasons || []), ...(decision.warnings || []),
    ...(decision.blockers || [])].join("\n");
}

/**
 * Input: { decision, context? { shot, scene, referenceAssets?, supportedCapabilities? } }
 */
function validateDecision(input = {}) {
  const errors = [];
  const warnings = [];
  const push = (dimension, code, message) => errors.push({ dimension, code, message });
  const warn = (dimension, code, message) => warnings.push({ dimension, code, message });
  const d = input.decision;
  if (!d) return { valid: false, errors: [{ dimension: "schema", code: "DECISION_MISSING", message: "no decision supplied" }], warnings };
  const ctx = input.context || {};

  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(loadSchema());
  if (!validate(d)) {
    for (const e of validate.errors || []) {
      push("schema", "SCHEMA_PRODUCTION_DECISION", `${e.instancePath} ${e.message}`);
    }
  }

  // --- Lineage (§8, §44): shot/scene identity + fingerprints.
  if (d.shotId && ctx.shot && shared.hash16(ctx.shot) !== (d.sourceFingerprints && d.sourceFingerprints.shot)) {
    warn("staleness", "SHOT_CHANGED", "persisted decision no longer matches the current shot (STALE)");
  }
  if (d.sceneId && ctx.scene && shared.hash16(ctx.scene) !== (d.sourceFingerprints && d.sourceFingerprints.scene)) {
    warn("staleness", "SCENE_CHANGED", "persisted decision no longer matches the current scene (STALE)");
  }
  if (!d.sourceRefs || d.sourceRefs.shotId !== d.shotId || d.sourceRefs.sceneId !== d.sceneId
    || !Array.isArray(d.sourceRefs.beatIds) || d.sourceRefs.beatIds.length === 0) {
    push("lineage", "LINEAGE_INCOMPLETE", "sourceRefs must trace shotId, sceneId and beats");
  }

  // --- Explainability (§9): reasons are mandatory for READY decisions.
  if (d.status === "DECISION_READY" && (!Array.isArray(d.decisionReasons) || d.decisionReasons.length === 0)) {
    push("explainability", "REASONS_REQUIRED", "READY decisions must carry structured reasons");
  }

  // --- Visual Story Grammar (FIX 1, Stage A): modality before renderer.
  if (d.status === "DECISION_READY") {
    if (!d.visualModality || !shared.VISUAL_MODALITIES.includes(d.visualModality)) {
      push("grammar", "MODALITY_REQUIRED", "READY decisions must carry a canonical visualModality");
    }
    if (!Array.isArray(d.modalityReasons) || d.modalityReasons.length === 0) {
      push("grammar", "MODALITY_REASONS_REQUIRED", "READY decisions must explain the modality choice");
    }
    if (d.modalityConfidence !== null && d.modalityConfidence !== undefined
      && !["HIGH", "MEDIUM", "LOW"].includes(d.modalityConfidence)) {
      push("grammar", "CONFIDENCE_UNEXPLAINED", "modality confidence must be an explainable HIGH/MEDIUM/LOW tier");
    }
  }
  if (d.beatLineage) {
    const lb = [...(d.beatLineage.beatIds || [])].sort().join(",");
    const sb = [...((d.sourceRefs && d.sourceRefs.beatIds) || [])].sort().join(",");
    if (lb !== sb) {
      push("lineage", "MODALITY_LINEAGE_MISMATCH", "beatLineage must trace the same beats as sourceRefs (Beat→Scene→Shot)");
    }
  }

  // --- Render mode (FIX 1, Stage B): workflow family, never a model.
  if (d.renderMode !== null && d.renderMode !== undefined && !shared.RENDER_MODES.includes(d.renderMode)) {
    push("renderMode", "RENDER_MODE_UNKNOWN", `renderMode ${d.renderMode} is not canonical`);
  }
  if (d.status === "DECISION_READY" && d.recommendedOutputType && d.renderMode) {
    // Hardening sweep (A-5): when an operator override is present, the
    // render mode must be compatible with the EFFECTIVE strategy — the
    // recommended one is historical record at that point.
    const effective = d.effectiveOutputType || d.recommendedOutputType;
    const compat = {
      STATIC_IMAGE: ["STATIC_IMAGE"],
      EDITOR_MOTION: ["REMOTION_MOTION"],
      GENERATED_MOTION_CANDIDATE: ["REMOTION_MOTION", "VEO_FIRST_FRAME", "VEO_FIRST_LAST", "VEO_REFERENCE"],
      GENERATED_MOTION_RECOMMENDED: ["VEO_FIRST_FRAME", "VEO_FIRST_LAST", "VEO_REFERENCE"],
    };
    const allowed = compat[effective] || [];
    // A budget-downgraded candidate honestly renders as REMOTION_MOTION.
    if (!allowed.includes(d.renderMode)) {
      push("renderMode", "RENDER_MODE_MISMATCH", `renderMode ${d.renderMode} is incompatible with ${d.recommendedOutputType}`);
    }
    if (!Array.isArray(d.renderModeReasons) || d.renderModeReasons.length === 0) {
      push("renderMode", "RENDER_MODE_REASONS_REQUIRED", "READY decisions must explain the render-mode choice");
    }
  }

  // --- Strategy/capability/asset compatibility (judged against the EFFECTIVE
  // strategy when an override is present — hardening sweep A-5).
  if (d.effectiveOutputType || d.recommendedOutputType) {
    const effective = d.effectiveOutputType || d.recommendedOutputType;
    const needs = STRATEGY_CAPABILITY_NEEDS[effective] || [];
    const hasVideoNeed = needs.some((c) => c === "VIDEO_GENERATION" || c === "IMAGE_TO_VIDEO");
    const hasVideoCap = (d.requiredCapabilities || []).some((c) => c === "VIDEO_GENERATION" || c === "IMAGE_TO_VIDEO");
    if (effective.startsWith("GENERATED_MOTION") && !hasVideoCap) {
      push("strategy", "CAPABILITY_MISMATCH", "generated strategy requires a VIDEO generation capability");
    }
    if ((effective === "STATIC_IMAGE" || effective === "EDITOR_MOTION") && hasVideoCap) {
      push("strategy", "CAPABILITY_MISMATCH", "static/editor strategy must not carry VIDEO capabilities");
    }
    void hasVideoNeed;
    const assetNeeds = STRATEGY_ASSET_NEEDS[effective] || [];
    for (const role of assetNeeds) {
      if (!(d.requiredAssetRoles || []).includes(role)) {
        push("strategy", "ASSET_ROLE_MISSING", `strategy ${d.effectiveOutputType || d.recommendedOutputType} requires asset role ${role}`);
      }
    }
    for (const cap of d.requiredCapabilities || []) {
      if (!shared.CAPABILITY_ALLOWLIST.includes(cap)) {
        push("strategy", "CAPABILITY_UNKNOWN", `capability ${cap} is not in the canonical allowlist`);
      }
    }
    for (const role of d.requiredAssetRoles || []) {
      if (!shared.ASSET_ROLES.includes(role)) {
        push("strategy", "ASSET_ROLE_UNKNOWN", `asset role ${role} is not in the canonical vocabulary`);
      }
    }
    if (ctx.supportedCapabilities) {
      const missing = (d.requiredCapabilities || []).filter((c) => !ctx.supportedCapabilities.includes(c));
      if (missing.length > 0) {
        push("strategy", "CAPABILITY_UNSUPPORTED", `required capabilities not supported downstream: ${missing.join(", ")}`);
      }
    }
  }

  // --- Recommendation vs selection (§26).
  if (d.selectedOutputType && !shared.RECOMMENDATIONS.includes(d.selectedOutputType)) {
    push("selection", "SELECTION_INVALID", `selectedOutputType ${d.selectedOutputType} is not a valid strategy`);
  }
  const effective = d.selectedOutputType || d.recommendedOutputType;
  if (d.effectiveOutputType !== effective && d.recommendedOutputType) {
    push("selection", "EFFECTIVE_MISMATCH", "effectiveOutputType must equal selectedOutputType ?? recommendedOutputType");
  }

  // --- Content integrity (§33-§36): decisions add zero claims, never promote labels.
  if (ctx.shot) {
    const upstream = new Set([...(ctx.shot.claimRefs || [])]);
    for (const id of d.claimRefs || []) {
      if (!upstream.has(id)) push("evidenceSafety", "CLAIM_INVENTED", `claim ${id} not present in the canonical shot`);
    }
  }
  if (d.contentClass === "FICTION" && (d.claimRefs || []).length > 0) {
    push("fictionSafety", "FICTION_FAKE_EVIDENCE", "FICTION decision carries claim refs");
  }
  const nonFact = (d.classificationRefs || []).map((c) => c.classification).filter((c) => c && c !== "FACT");
  if (nonFact.length > 0 && (d.framing === "EVIDENCE_VISUAL" || (d.framing === null && d.status === "DECISION_READY"))) {
    push("hybridSafety", "CLASSIFICATION_PROMOTED", `non-factual labels (${[...new Set(nonFact)].join("/")}) presented without illustrative/reconstruction framing`);
  }

  // --- Provider/model boundary (§40) + credit boundary (§24, §54-B6).
  const text = decisionText(d);
  if (MODEL_NAME_PATTERN.test(text)) {
    push("providerBoundary", "MODEL_SELECTED", "canonical decision text names a provider model (forbidden)");
  }
  if (CREDIT_PRICE_PATTERN.test(text)) {
    push("costBoundary", "CREDIT_PRICE_HARDCODED", "canonical decision text carries a credit price (forbidden)");
  }
  if (d.externalCostEstimate !== "UNKNOWN" && d.externalCostEstimate !== null) {
    push("costBoundary", "COST_ESTIMATED_WITHOUT_SOURCE", "externalCostEstimate must stay UNKNOWN without a runtime pricing source");
  }

  return { valid: errors.length === 0, errors, warnings };
}

module.exports = { validateDecision, MODEL_NAME_PATTERN, CREDIT_PRICE_PATTERN };
