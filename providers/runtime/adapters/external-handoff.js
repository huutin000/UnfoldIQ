"use strict";

/**
 * external-handoff adapter (STEP 10A).
 * Persists projects/<projectId>/handoff/<requestId>.json and returns
 * HANDOFF_REQUIRED. If the expected file later appears, the existing
 * adapter can resume. No secrets are ever serialized.
 */

const store = require("../artifact-store");

const SECRET_KEY_PATTERN = /secret|token|api[_-]?key|password|credential|auth/i;

function stripSecrets(value) {
  if (Array.isArray(value)) return value.map(stripSecrets);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEY_PATTERN.test(k)) continue;
      out[k] = stripSecrets(v);
    }
    return out;
  }
  if (typeof value === "string" && /^(sk-|xox|ghp_|Bearer\s)/.test(value)) return "[REDACTED]";
  return value;
}

async function execute(request, ctx = {}) {
  const root = ctx.projectRoot;
  const projectId = request.projectId;
  const creative = request.creativeContext || {};
  const continuity = request.continuityContext || {};
  const safety = request.safetyContext || null;

  const handoff = stripSecrets({
    version: "1.0.0",
    requestId: request.requestId,
    projectId,
    sceneId: request.sceneId,
    capability: request.capability,
    promptOrText: (request.input && (request.input.prompt || request.input.text)) || null,
    input: request.input || {},
    creativeSummary: {
      contentModeSummary: creative.contentModeSummary || null,
      creativeDirectionSummary: creative.creativeDirectionSummary || null,
      visualBibleConstraints: creative.visualBibleConstraints || null,
      platformConstraints: creative.platformConstraints || null,
    },
    continuityRequirements: {
      requiredEntities: continuity.requiredEntities || [],
      requiredReferences: continuity.requiredReferences || [],
      continuityStrictness: continuity.continuityStrictness || "NOT_APPLICABLE",
      startFrameRef: continuity.startFrameRef || null,
      endFrameRef: continuity.endFrameRef || null,
    },
    referenceAssetPaths: continuity.requiredReferences || [],
    outputRequirements: request.outputRequirements || {},
    policyClassification: (request.rightsContext && request.rightsContext.policyClassification) || null,
    rightsSourceType: (request.rightsContext && request.rightsContext.sourceType) || null,
    safetyContext: safety
      ? {
        refusalReason: safety.refusalReason || safety.message || null,
        refusalClass: safety.refusalClass || null,
        originalSceneIntent: safety.originalSceneIntent || null,
        preservedClaims: safety.preservedClaims || safety.researchClaimIds || [],
        preservedContinuity: safety.preservedContinuity || continuity.requiredEntities || [],
        step09Decision: safety.step09Decision || null,
      }
      : null,
    expectedOutputPath: `assets/${request.capability}/${request.sceneId}/${request.requestId}.bin`,
    returnInstructions: "Place the finished file at the expected project-relative path, then resume via the existing adapter.",
  });

  const handoffRel = `handoff/${request.requestId}.json`;
  const relative = store.writeArtifactAtomic(root, projectId, handoffRel, JSON.stringify(handoff, null, 2));

  return {
    version: "1.0.0",
    requestId: request.requestId,
    projectId,
    sceneId: request.sceneId,
    capability: request.capability,
    providerId: "external-handoff",
    status: "HANDOFF_REQUIRED",
    sourceType: "external-handoff",
    provenanceNote: `Manual/external provider handoff written to ${relative}`,
    rightsStatus: "NOT_APPLICABLE",
    costClass: "UNKNOWN",
    handoffPath: relative,
  };
}

module.exports = { execute, providerId: "external-handoff", stripSecrets };
