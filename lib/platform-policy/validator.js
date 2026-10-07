"use strict";

/**
 * 1G.7 adaptation validator (PHASE 1G.7, Prompt 01, §36). Structured
 * { valid, errors[], warnings[] }. Detects: unknown platform, invalid
 * aspect policy, preferred/accepted conflation, missing sources for hard
 * external facts, invalid action, semantic-loss-without-review,
 * regeneration-without-reason, modality mutation, provider/model leakage,
 * broken fingerprint linkage.
 */

const Ajv = require("ajv");
const addFormats = require("ajv-formats");
const fs = require("fs");
const path = require("path");
const shared = require("./shared.js");

function loadSchema(file) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "schemas", file), "utf8").replace(/^\uFEFF/, ""));
}

/**
 * Input: { artifact, context? { master?, targetProfile? } }
 */
function validateAdaptation(input = {}) {
  const errors = [];
  const warnings = [];
  const push = (dimension, code, message) => errors.push({ dimension, code, message });
  const a = input.artifact;
  if (!a) return { valid: false, errors: [{ dimension: "schema", code: "ADAPTATION_MISSING", message: "no artifact supplied" }], warnings };
  const ctx = input.context || {};

  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(loadSchema("platform-adaptation.schema.json"));
  if (!validate(a)) {
    for (const e of validate.errors || []) {
      push("schema", "SCHEMA_ADAPTATION", `${e.instancePath} ${e.message}`);
    }
  }

  if (a.platformId && !shared.PLATFORM_IDS.includes(a.platformId)) {
    push("platform", "UNKNOWN_PLATFORM", `platform ${a.platformId} is not canonical`);
  }
  if (a.action && !shared.ADAPTATION_ACTIONS.includes(a.action)) {
    push("action", "INVALID_ACTION", `action ${a.action} is not canonical`);
  }
  // Preferred/accepted conflation + hard-fact provenance.
  if (ctx.targetProfile) {
    const p = ctx.targetProfile;
    if (a.targetAspectRatio !== p.preferredAspectRatio && !(p.acceptedAspectRatios || []).includes(a.targetAspectRatio)) {
      push("aspect", "INVALID_ASPECT_POLICY", `aspect ${a.targetAspectRatio} is neither preferred nor accepted`);
    }
    // Preferred/accepted/required semantics (FIX 01): accepted may be null
    // (UNKNOWN / non-exhaustive) — that is valid only with a documenting note.
    // A narrow array is a source-backed exhaustive claim only with sources.
    if (p.acceptedAspectRatios === null || p.acceptedAspectRatios === undefined) {
      if (!p.acceptanceNote) {
        push("aspect", "ACCEPTANCE_UNDOCUMENTED", "UNKNOWN acceptance requires an acceptanceNote documenting scope");
      }
    } else {
      if (!p.acceptedAspectRatios.includes(p.preferredAspectRatio)) {
        push("aspect", "PREFERRED_ACCEPTED_CONFLATION", "preferred aspect must be listed in accepted aspects");
      }
      if (!p.acceptanceNote) {
        push("aspect", "ACCEPTANCE_UNDOCUMENTED", "listed acceptance requires an acceptanceNote documenting source scope");
      }
    }
    if (p.requiredAspectRatio !== null && p.requiredAspectRatio !== undefined) {
      const hasSource = ((p.safeZonePolicy || {}).sourceRefs || []).length > 0 || (p.sources || []).length > 0;
      if (!hasSource) push("aspect", "REQUIRED_WITHOUT_SOURCE", "required aspect needs an external source");
    }
    for (const z of ((p.safeZonePolicy || {}).zones || [])) {
      if ((z.status === "VERIFIED" || (z.region && p.safeZonePolicy.status === "VERIFIED")) && (!z.sourceRefs || z.sourceRefs.length === 0)) {
        push("safeZone", "HARD_FACT_WITHOUT_SOURCE", `zone ${z.zoneId} asserts verified geometry without source`);
      }
      // FIX 01: exact geometry presented as VERIFIED needs explicit geometric
      // provenance; INTERNAL_POLICY geometry may only ever be PARTIAL or below.
      if (z.region && z.status === "VERIFIED"
        && !["VERIFIED_REPOSITORY_OBSERVATION", "OFFICIAL_MEASUREMENT"].includes(z.geometryOrigin)) {
        push("safeZone", "UNVERIFIED_GEOMETRY_AS_VERIFIED", `zone ${z.zoneId} claims VERIFIED geometry without geometric provenance`);
      }
      if (z.region && z.geometryOrigin === "INTERNAL_POLICY" && z.status === "VERIFIED") {
        push("safeZone", "INTERNAL_GEOMETRY_AS_VERIFIED", `zone ${z.zoneId}: internal heuristics cannot be VERIFIED`);
      }
    }
    // Fingerprint linkage.
    if (ctx.master && a.sourceFingerprint !== ctx.master.sourceFingerprint) {
      push("lineage", "MASTER_LINK_BROKEN", "adaptation does not match the supplied master composition");
    }
  }
  // Semantic loss without review.
  if (a.regenerationDecision === "TARGETED_REGENERATION_REQUIRED" && (!a.regenerationReasons || a.regenerationReasons.length === 0)) {
    push("regeneration", "REGENERATION_WITHOUT_REASON", "regeneration requires explicit reasons");
  }
  if (a.status === "REVIEW_REQUIRED" && (a.risks || []).length === 0 && (a.warnings || []).length === 0) {
    push("review", "REVIEW_WITHOUT_CAUSE", "REVIEW_REQUIRED needs risks or warnings");
  }
  // Modality mutation forbidden (platform never re-grammars).
  if (ctx.master && a.sourceModality && ctx.master.visualModality && a.sourceModality !== ctx.master.visualModality) {
    push("boundary", "MODALITY_MUTATION", "platform adaptation must not change visual modality");
  }
  // Provider/model selection leakage forbidden.
  const leaked = ["recommendedModel", "selectedModel", "effectiveModel", "modelId", "providerLabel"];
  for (const key of leaked) {
    if (a[key] !== undefined && a[key] !== null) {
      push("boundary", "MODEL_SELECTION_LEAKAGE", `adaptation artifact must not carry ${key}`);
    }
  }
  const text = [...(a.preservedIntent || []), ...(a.regenerationReasons || [])].join("\n");
  if (/\bveo[\s-]\d|veo\s*3|gemini|nano[\s-]?banana|imagen|omni[\s-]?flash/i.test(text.replace(/VEO_[A-Z_]+/g, ""))) {
    push("boundary", "MODEL_SELECTED", "adaptation text names a provider model");
  }
  return { valid: errors.length === 0, errors, warnings };
}

module.exports = { validateAdaptation };
