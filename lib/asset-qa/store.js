"use strict";

/**
 * Phase 1G.11 — QA result persistence.
 * One QA artifact per (asset hash + expected context). History preserved,
 * atomic writes, no destructive overwrite, never mutates asset bytes or the
 * 1G.10 registry (linkage lives in the QA index, so locked records stay
 * immutable). Layout: projects/<projectId>/qa/<assetId>/<qaResultId>.json
 * plus projects/<projectId>/qa/index.json.
 */

const artifactStore = require("../../providers/runtime/artifact-store.js");
const shared = require("./shared.js");
const aggregateLib = require("./aggregate.js");

const QA_INDEX_REL = "qa/index.json";
const QA_RESULT_VERSION = "1.0.0";

function qaRel(assetId, qaResultId) {
  return `qa/${assetId}/${qaResultId}.json`;
}

/**
 * buildQaResult({ projectId, assetId, assetHash, shotId?, sceneId?,
 *   expectationFingerprint: { fingerprint, snapshot }, layers:
 *   { structural, semantic, factuality, continuity }, sourceRefs[]?,
 *   evidenceRefs[]? }) → AssetQaResult (deterministic qaResultId from
 * content, so identical inputs reproduce the identical result).
 */
function buildQaResult(input = {}) {
  const layers = input.layers || {};
  const agg = aggregateLib.aggregateQa(layers);
  const fp = input.expectationFingerprint || { fingerprint: "fp-unknown", snapshot: {} };
  // qaResultId is content-deterministic: volatile evidenceIds/evaluatedAt are
  // excluded from the seed so identical inputs reproduce the identical id.
  const seedLayers = {};
  for (const n of ["structural", "semantic", "factuality", "continuity"]) {
    const l = layers[n];
    seedLayers[n] = l
      ? { ...l, evidence: (l.evidence || []).map((e) => ({ ...e, evidenceId: null })) }
      : null;
  }
  const seed = shared.canonicalJson({
    assetHash: input.assetHash,
    fp: fp.fingerprint,
    policy: shared.QA_POLICY_VERSION,
    layers: seedLayers,
  });
  const qaResultId = `qa-${shared.sha256Hex(seed).slice(0, 12)}`;
  const allEvidence = [];
  for (const n of ["structural", "semantic", "factuality", "continuity"]) {
    for (const e of ((layers[n] && layers[n].evidence) || [])) allEvidence.push(e);
  }
  return {
    version: QA_RESULT_VERSION,
    qaResultId,
    projectId: input.projectId || null,
    assetId: input.assetId || null,
    assetHash: input.assetHash || null,
    shotId: input.shotId || null,
    sceneId: input.sceneId || null,
    qaPolicyVersion: shared.QA_POLICY_VERSION,
    expectedContextFingerprint: fp.fingerprint,
    expectationSnapshot: fp.snapshot || {},
    structural: layers.structural || null,
    semantic: layers.semantic || null,
    factuality: layers.factuality || null,
    continuity: layers.continuity || null,
    aggregate: {
      status: agg.status,
      severity: agg.severity,
      timelineEligible: agg.timelineEligible,
      failedLayers: agg.failedLayers,
      warningLayers: agg.warningLayers,
      unknownLayers: agg.unknownLayers,
      reasons: agg.reasons,
      recommendation: agg.recommendation,
    },
    sourceRefs: Array.isArray(input.sourceRefs) ? input.sourceRefs.map(String) : [],
    evidenceRefs: Array.isArray(input.evidenceRefs) ? input.evidenceRefs.map(String) : [],
    evidence: allEvidence,
    evaluatedAt: shared.nowIso(),
  };
}

function readIndex(root, projectId) {
  try {
    if (!artifactStore.artifactExists(root, projectId, QA_INDEX_REL)) return { version: QA_RESULT_VERSION, assets: {} };
    const raw = JSON.parse(artifactStore.readArtifact(root, projectId, QA_INDEX_REL).toString("utf8"));
    if (!raw || typeof raw !== "object" || !raw.assets) return { version: QA_RESULT_VERSION, assets: {} };
    return raw;
  } catch {
    return { version: QA_RESULT_VERSION, assets: {} };
  }
}

function persistQaResult(root, projectId, result) {
  if (!result || !result.qaResultId || !result.assetId) {
    return { ok: false, code: "QA_RESULT_INVALID", message: "qaResultId + assetId required" };
  }
  try {
    artifactStore.writeArtifactAtomic(root, projectId, qaRel(result.assetId, result.qaResultId), JSON.stringify(result, null, 2));
    const index = readIndex(root, projectId);
    const entry = index.assets[result.assetId] || { currentQaResultId: null, history: [] };
    if (!entry.history.includes(result.qaResultId)) entry.history.push(result.qaResultId);
    entry.currentQaResultId = result.qaResultId;
    entry.updatedAt = shared.nowIso();
    index.assets[result.assetId] = entry;
    artifactStore.writeArtifactAtomic(root, projectId, QA_INDEX_REL, JSON.stringify(index, null, 2));
    return { ok: true, qaResultId: result.qaResultId };
  } catch (e) {
    return { ok: false, code: "QA_PERSIST_FAILED", message: String((e && e.message) || e) };
  }
}

function loadQaResult(root, projectId, assetId, qaResultId) {
  try {
    if (!artifactStore.artifactExists(root, projectId, qaRel(assetId, qaResultId))) {
      return { ok: false, code: "QA_RESULT_NOT_FOUND" };
    }
    const raw = JSON.parse(artifactStore.readArtifact(root, projectId, qaRel(assetId, qaResultId)).toString("utf8"));
    return { ok: true, result: raw };
  } catch (e) {
    return { ok: false, code: "QA_RESULT_UNREADABLE", message: String((e && e.message) || e) };
  }
}

function getCurrentQa(root, projectId, assetId) {
  const index = readIndex(root, projectId);
  const entry = index.assets[assetId];
  if (!entry || !entry.currentQaResultId) return { ok: false, code: "QA_RESULT_NOT_FOUND" };
  return loadQaResult(root, projectId, assetId, entry.currentQaResultId);
}

function listQaHistory(root, projectId, assetId) {
  const index = readIndex(root, projectId);
  const entry = index.assets[assetId];
  if (!entry) return { ok: true, history: [] };
  return { ok: true, history: [...(entry.history || [])], currentQaResultId: entry.currentQaResultId || null };
}

module.exports = {
  QA_INDEX_REL,
  QA_RESULT_VERSION,
  qaRel,
  buildQaResult,
  persistQaResult,
  loadQaResult,
  getCurrentQa,
  listQaHistory,
  readIndex,
};
