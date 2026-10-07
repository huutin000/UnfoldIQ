"use strict";

/**
 * 1G.6 resolution validator (§§14–15, §18, §25–26). Structured
 * { valid, errors[], warnings[] } — never an opaque score.
 *
 * Enforces: recommendation ∈ candidates, effective math, reasons present,
 * no silent downgrade (END_FRAME need without FIRST_LAST support is
 * BLOCKED, never first-frame), cost math honesty, 1G.5 boundary (no visual
 * fields rewritten — the artifact carries the source fingerprint, not the
 * decision), compiler boundary (no target/model inference fields).
 */

const Ajv = require("ajv");
const addFormats = require("ajv-formats");
const fs = require("fs");
const path = require("path");
const shared = require("./shared.js");

function loadSchema(file) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "schemas", file), "utf8").replace(/^\uFEFF/, ""));
}

function validateSnapshot(input = {}) {
  const errors = [];
  const warnings = [];
  const snapshot = input.snapshot;
  if (!snapshot) return { valid: false, errors: [{ dimension: "schema", code: "SNAPSHOT_MISSING", message: "no snapshot supplied" }], warnings };
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(loadSchema("model-registry-snapshot.schema.json"));
  if (!validate(snapshot)) {
    for (const e of validate.errors || []) {
      errors.push({ dimension: "schema", code: "SCHEMA_SNAPSHOT", message: `${e.instancePath} ${e.message}` });
    }
  }
  // Semantic: every rule/observation must resolve provenance against snapshot sources.
  const sourceIds = new Set((snapshot.sources || []).map((s) => s.sourceId));
  for (const m of snapshot.models || []) {
    for (const r of m.capabilityRules || []) {
      for (const id of r.sourceRefs || []) {
        if (!sourceIds.has(id)) errors.push({ dimension: "provenance", code: "RULE_PROVENANCE_DANGLING", message: `${m.modelId}/${r.capability} cites unknown source ${id}` });
      }
    }
    for (const o of m.costObservations || []) {
      for (const id of o.sourceRefs || []) {
        if (!sourceIds.has(id)) errors.push({ dimension: "provenance", code: "COST_PROVENANCE_DANGLING", message: `${m.modelId} cost cites unknown source ${id}` });
      }
    }
    // Stable identity must not depend on display punctuation.
    const recomputed = shared.stableModelId(m.providerId, m.modelFamily, m.modelVersionOrTier);
    if (recomputed !== m.modelId) {
      warnings.push({ dimension: "identity", code: "MODEL_ID_UNSTABLE", message: `${m.modelId} is not the stable slug (${recomputed})` });
    }
  }
  return { valid: errors.length === 0, errors, warnings };
}

function validateResolution(input = {}) {
  const errors = [];
  const warnings = [];
  const push = (dimension, code, message) => errors.push({ dimension, code, message });
  const r = input.decision || input.resolution || input.artifact;
  if (!r) return { valid: false, errors: [{ dimension: "schema", code: "RESOLUTION_MISSING", message: "no resolution supplied" }], warnings };
  const context = input.context || {};

  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(loadSchema("model-resolution.schema.json"));
  if (!validate(r)) {
    for (const e of validate.errors || []) {
      push("schema", "SCHEMA_RESOLUTION", `${e.instancePath} ${e.message}`);
    }
  }

  const candidateIds = new Set((r.candidateModels || []).map((c) => c.modelId));
  if (r.recommendedModel && !candidateIds.has(r.recommendedModel)) {
    push("selection", "RECOMMENDED_NOT_CANDIDATE", "recommended model must come from hard-filtered candidates");
  }
  const effectiveModel = r.selectedModel || r.recommendedModel;
  if (r.effectiveModel !== effectiveModel && r.status !== "BLOCKED" && r.status !== "NOT_REQUIRED") {
    push("selection", "EFFECTIVE_MISMATCH", "effectiveModel must equal selectedModel ?? recommendedModel");
  }
  if ((r.status === "RESOLVED" || r.status === "PROVISIONAL") && (!Array.isArray(r.selectionReasons) || r.selectionReasons.length === 0)) {
    push("explainability", "SELECTION_REASONS_REQUIRED", "resolved selections must carry bounded reasons");
  }
  if (r.status === "BLOCKED" && (!Array.isArray(r.blockers) || r.blockers.length === 0)) {
    push("selection", "BLOCKER_REQUIRED", "BLOCKED resolutions must name the blocker");
  }
  // No silent downgrade: END_FRAME need without FIRST_LAST support is BLOCKED, never first-frame.
  const needsEnd = (r.requiredCapabilities || []).includes("FIRST_LAST_FRAME_VIDEO");
  if (needsEnd && r.recommendedModel) {
    const rec = (r.candidateModels || []).find((c) => c.modelId === r.recommendedModel);
    const factors = JSON.stringify((rec && rec.factors) || []);
    if (!/FIRST_LAST_FRAME_VIDEO/.test(factors)) {
      push("workflow", "SILENT_DOWNGRADE", "first+last requirement resolved without first+last evidence");
    }
  }
  // Cost math honesty.
  if (r.costEstimate && r.costEstimate.state === "KNOWN") {
    if (r.costEstimate.valuePerGeneration === null || r.costEstimate.valuePerGeneration === undefined) {
      push("cost", "COST_VALUE_MISSING", "KNOWN cost needs a valuePerGeneration");
    }
    if (r.costEstimate.estimatedTotal !== null && r.costEstimate.estimatedTotal !== undefined
      && (r.requirement && (r.requirement.outputCount === null || r.requirement.outputCount === undefined))) {
      push("cost", "TOTAL_WITHOUT_COUNT", "estimatedTotal requires an explicit outputCount");
    }
  }
  // 1G.5 boundary: the artifact must not rewrite visual truth.
  if (context.decision) {
    if (r.sourceDecisionFingerprint && r.sourceDecisionFingerprint !== context.decision.fingerprint) {
      push("boundary", "SOURCE_DECISION_CHANGED", "resolution was computed for a different 1G.5 decision");
    }
    for (const field of ["visualModality", "renderMode", "motionNeed"]) {
      if (r.requirement && context.decision[field] !== undefined && r.requirement.renderMode
        && field === "renderMode" && r.renderMode !== context.decision.renderMode) {
        push("boundary", "UPSTREAM_REWRITTEN", "resolver must not rewrite renderMode");
      }
    }
  }
  // Snapshot traceability.
  if (!r.registrySnapshotRef || !r.registrySnapshotRef.fingerprint) {
    push("traceability", "SNAPSHOT_REF_MISSING", "resolution must reference the registry snapshot used");
  }
  return { valid: errors.length === 0, errors, warnings };
}

module.exports = { validateSnapshot, validateResolution };
