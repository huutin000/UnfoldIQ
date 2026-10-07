"use strict";

/**
 * 1G.6 resolution persistence + targeted staleness (§§19–20).
 *
 * Layout: projects/<projectId>/model-resolutions/<shotId>.json (atomic via
 * the canonical artifact-store). Operator selections are never silently
 * overwritten — same safe pattern as 1G.5.
 *
 * Staleness touches ONLY provider-resolution artifacts: registry snapshot
 * changes, requirement changes, source-decision fingerprint changes, policy
 * changes, and cost-observation changes that affect ranking. Research, story,
 * modality, prompt, and 1G.5 decision artifacts are never invalidated here.
 */

const fs = require("fs");
const path = require("path");
const artifactStore = require("../runtime/artifact-store.js");
const shared = require("./shared.js");

function resolutionRel(shotId) {
  return `model-resolutions/${shotId}.json`;
}

function persistResolution(root, projectId, artifact, opts = {}) {
  if (!artifact || !artifact.resolutionId || !artifact.shotId) {
    return { ok: false, code: "RESOLUTION_INVALID" };
  }
  try {
    const existing = loadResolution(root, projectId, artifact.shotId);
    const toSave = { ...artifact };
    delete toSave._selectedSet;
    if (existing.ok && existing.artifact && !opts.force) {
      const prev = existing.artifact;
      if (prev.selectedModel && !artifact._selectedSet) {
        toSave.selectedProvider = prev.selectedProvider;
        toSave.selectedModel = prev.selectedModel;
        toSave.effectiveProvider = prev.selectedProvider;
        toSave.effectiveModel = prev.selectedModel;
        toSave.selectionState = prev.selectionState || "ACCEPTED";
        toSave.overrideReason = prev.overrideReason || null;
      }
    }
    toSave.updatedAt = new Date().toISOString();
    artifactStore.writeArtifactAtomic(root, projectId, resolutionRel(artifact.shotId), JSON.stringify(toSave, null, 2));
    return { ok: true, path: `projects/${projectId}/${resolutionRel(artifact.shotId)}` };
  } catch (e) {
    return { ok: false, code: "RESOLUTION_PERSIST_FAILED", message: String((e && e.message) || e) };
  }
}

function loadResolution(root, projectId, shotId) {
  try {
    const rel = resolutionRel(shotId);
    if (!artifactStore.artifactExists(root, projectId, rel)) return { ok: true, artifact: null };
    return { ok: true, artifact: JSON.parse(artifactStore.readArtifact(root, projectId, rel).toString("utf8")) };
  } catch (e) {
    return { ok: false, code: "RESOLUTION_LOAD_FAILED", message: String((e && e.message) || e) };
  }
}

function listResolutions(root, projectId) {
  const base = path.join(root, "projects", projectId, "model-resolutions");
  const out = [];
  if (!fs.existsSync(base)) return { ok: true, resolutions: out };
  for (const file of fs.readdirSync(base)) {
    if (!file.endsWith(".json")) continue;
    try {
      out.push(JSON.parse(fs.readFileSync(path.join(base, file), "utf8")));
    } catch { /* corrupt files are skipped, never crash */ }
  }
  return { ok: true, resolutions: out };
}

/**
 * Targeted resolution staleness. Only the resolution layer is affected —
 * never upstream story/modality/prompt artifacts.
 */
function checkResolutionStaleness(artifact, context = {}) {
  const reasons = [];
  if (!artifact) return { stale: false, reasons };
  if (context.requirement) {
    const current = shared.hash16(stripVolatile(context.requirement));
    const stored = artifact.requirement
      ? shared.hash16(stripVolatile(artifact.requirement)) : null;
    if (stored && current !== stored) reasons.push("source requirement changed");
    if (artifact.requirementFingerprint && context.requirement.fingerprint
      && artifact.requirementFingerprint !== context.requirement.fingerprint) {
      if (!reasons.includes("source requirement changed")) reasons.push("source requirement changed");
    }
  }
  if (context.snapshot) {
    const snapFp = context.snapshot.fingerprint || null;
    if (snapFp && artifact.registrySnapshotRef && artifact.registrySnapshotRef.fingerprint !== snapFp) {
      reasons.push("registry snapshot changed materially");
    }
  }
  if (context.sourceDecisionFingerprint && artifact.sourceDecisionFingerprint
    && context.sourceDecisionFingerprint !== artifact.sourceDecisionFingerprint) {
    reasons.push("source production-decision fingerprint changed");
  }
  const policyVersion = context.policyVersion || shared.RESOLVER_POLICY_VERSION;
  if (artifact.policyVersion && artifact.policyVersion !== policyVersion) {
    reasons.push("resolver policy changed");
  }
  if (context.costObservationChanged === true) {
    const sensitive = artifact.requirement && artifact.requirement.costSensitivity === "HIGH";
    const ranked = (artifact.candidateModels || []).length > 0;
    if (sensitive && ranked) reasons.push("cost observation changed under cost-sensitive ranking policy");
  }
  return { stale: reasons.length > 0, reasons };
}

function stripVolatile(requirement) {
  const copy = { ...(requirement || {}) };
  delete copy.fingerprint;
  return copy;
}

module.exports = {
  persistResolution,
  loadResolution,
  listResolutions,
  checkResolutionStaleness,
};
