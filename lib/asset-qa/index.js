"use strict";

/**
 * Phase 1G.11 — asset-qa facade (canonical QA owner).
 * asset → structural → semantic → factuality → continuity → aggregate QA →
 * READY_FOR_TIMELINE | REVIEW_REQUIRED | REJECTED. No generation, no network.
 */

const shared = require("./shared.js");
const structuralLib = require("./structural.js");
const semanticLib = require("./semantic.js");
const factualityLib = require("./factuality.js");
const continuityLib = require("./continuity.js");
const motionLib = require("./motion.js");
const aggregateLib = require("./aggregate.js");
const storeLib = require("./store.js");
const validatorLib = require("./validator.js");
const gateLib = require("./gate.js");

/**
 * evaluateAssetQa({ projectId, assetId, assetHash, shotId?, sceneId?,
 *   fingerprintDeps?, structural?, semantic?, factuality?, continuity?,
 *   sourceRefs[]?, evidenceRefs[]? }) → AssetQaResult (unpersisted).
 * Layer inputs are the per-layer function arguments; omitted layers that
 * carry expectations evaluate to critical UNKNOWN via the layer itself.
 */
function evaluateAssetQa(input = {}) {
  const layers = {
    structural: structuralLib.evaluateStructural(input.structural || {}),
    semantic: semanticLib.evaluateSemantic(
      (input.semantic && input.semantic.expectation) || {},
      input.semantic ? input.semantic.observation : null
    ),
    factuality: factualityLib.evaluateFactuality(input.factuality || {}),
    continuity: continuityLib.evaluateContinuity(input.continuity || {}),
  };
  const deps = { ...(input.fingerprintDeps || {}) };
  if (input.assetId) deps.assetId = deps.assetId || input.assetId;
  if (input.assetHash) deps.assetHash = deps.assetHash || input.assetHash;
  const fp = shared.buildExpectationFingerprint(deps);
  return storeLib.buildQaResult({
    projectId: input.projectId,
    assetId: input.assetId,
    assetHash: input.assetHash,
    shotId: input.shotId,
    sceneId: input.sceneId,
    expectationFingerprint: fp,
    layers,
    sourceRefs: input.sourceRefs,
    evidenceRefs: input.evidenceRefs,
  });
}

function evaluateAndPersist(root, input = {}) {
  const result = evaluateAssetQa(input);
  const v = validatorLib.validateQaResult(result);
  if (!v.valid) return { ok: false, code: "QA_RESULT_INVALID", errors: v.errors, result };
  const p = storeLib.persistQaResult(root, input.projectId, result);
  if (!p.ok) return { ok: false, code: p.code, message: p.message, result };
  return { ok: true, qaResultId: p.qaResultId, result };
}

module.exports = {
  QA_POLICY_VERSION: shared.QA_POLICY_VERSION,
  evaluateStructural: structuralLib.evaluateStructural,
  evaluateSemantic: semanticLib.evaluateSemantic,
  evaluateFactuality: factualityLib.evaluateFactuality,
  evaluateContinuity: continuityLib.evaluateContinuity,
  buildMotionObservation: motionLib.buildMotionObservation,
  evaluateMotionIntegrity: motionLib.evaluateMotionIntegrity,
  aggregateQa: aggregateLib.aggregateQa,
  buildQaResult: storeLib.buildQaResult,
  persistQaResult: storeLib.persistQaResult,
  loadQaResult: storeLib.loadQaResult,
  getCurrentQa: storeLib.getCurrentQa,
  listQaHistory: storeLib.listQaHistory,
  validateQaResult: validatorLib.validateQaResult,
  assertAssetReadyForTimeline: gateLib.assertAssetReadyForTimeline,
  buildExpectationFingerprint: shared.buildExpectationFingerprint,
  checkStaleness: shared.checkStaleness,
  evaluateAssetQa,
  evaluateAndPersist,
  shared,
};
