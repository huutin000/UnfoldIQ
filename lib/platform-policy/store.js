"use strict";

/**
 * 1G.7 adaptation persistence + targeted staleness (PHASE 1G.7, §§26–27).
 * Layout: projects/<projectId>/platform-adaptations/<platformId>/<shotId>.json
 * (atomic via canonical artifact-store). Manual operator choices survive
 * refresh (same safe pattern as 1G.5/1G.6). Policy changes stale ONLY the
 * affected platform's adaptations — never other platforms, never upstream
 * research/story/modality/registry artifacts.
 */

const fs = require("fs");
const path = require("path");
const artifactStore = require("../../providers/runtime/artifact-store.js");
const shared = require("./shared.js");

function adaptationRel(platformId, shotId) {
  return `platform-adaptations/${platformId}/${shotId}.json`;
}

function persistAdaptation(root, projectId, artifact, opts = {}) {
  if (!artifact || !artifact.adaptationId || !artifact.shotId || !artifact.platformId) {
    return { ok: false, code: "ADAPTATION_INVALID" };
  }
  try {
    const existing = loadAdaptation(root, projectId, artifact.platformId, artifact.shotId);
    const toSave = { ...artifact };
    delete toSave._overrideSet;
    if (existing.ok && existing.artifact && !opts.force) {
      const prev = existing.artifact;
      if (prev._manual || prev.overrideState) {
        for (const key of ["action", "cropPlan", "textPlan", "targetAspectRatio", "regenerationDecision", "status"]) {
          if (prev[`manual_${key}`] !== undefined) toSave[key] = prev[`manual_${key}`];
        }
        toSave.overrideState = prev.overrideState || "ACCEPTED";
        toSave.overrideReason = prev.overrideReason || null;
      }
    }
    toSave.updatedAt = new Date().toISOString();
    artifactStore.writeArtifactAtomic(root, projectId, adaptationRel(artifact.platformId, artifact.shotId), JSON.stringify(toSave, null, 2));
    return { ok: true, path: `projects/${projectId}/${adaptationRel(artifact.platformId, artifact.shotId)}` };
  } catch (e) {
    return { ok: false, code: "ADAPTATION_PERSIST_FAILED", message: String((e && e.message) || e) };
  }
}

function loadAdaptation(root, projectId, platformId, shotId) {
  try {
    const rel = adaptationRel(platformId, shotId);
    if (!artifactStore.artifactExists(root, projectId, rel)) return { ok: true, artifact: null };
    return { ok: true, artifact: JSON.parse(artifactStore.readArtifact(root, projectId, rel).toString("utf8")) };
  } catch (e) {
    return { ok: false, code: "ADAPTATION_LOAD_FAILED", message: String((e && e.message) || e) };
  }
}

function listAdaptations(root, projectId, platformId = null) {
  const base = path.join(root, "projects", projectId, "platform-adaptations");
  const out = [];
  if (!fs.existsSync(base)) return { ok: true, adaptations: out };
  const platforms = platformId ? [platformId] : fs.readdirSync(base);
  for (const plat of platforms) {
    const dir = path.join(base, plat);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".json")) continue;
      try {
        out.push(JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")));
      } catch { /* corrupt files skipped, never crash */ }
    }
  }
  return { ok: true, adaptations: out };
}

/**
 * Targeted staleness: master change, target profile change, safe-zone
 * evidence change, or policy version change stale exactly the dependent
 * adaptation(s). Callers scope by platformId for platform-targeted checks.
 */
function checkAdaptationStaleness(artifact, context = {}) {
  const reasons = [];
  if (!artifact) return { stale: false, reasons };
  if (context.master && artifact.sourceFingerprint !== context.master.sourceFingerprint) {
    reasons.push("source composition changed");
  }
  if (context.targetProfile) {
    if (artifact.platformProfileFingerprint !== context.targetProfile.fingerprint) {
      reasons.push(`${artifact.platformId} profile changed`);
    }
    const currentEvidence = shared.hash16({
      zones: ((context.targetProfile.safeZonePolicy || {}).zones || []),
      verifiedAt: (context.targetProfile.safeZonePolicy || {}).verifiedAt || null,
    });
    if (context.safeZoneEvidenceVersion && artifact.safeZoneEvidenceVersion !== context.safeZoneEvidenceVersion) {
      reasons.push("safe-zone evidence changed");
    } else if (!context.safeZoneEvidenceVersion && artifact.safeZoneEvidenceVersion !== currentEvidence) {
      reasons.push("safe-zone evidence changed");
    }
  }
  const policyVersion = context.policyVersion || shared.POLICY_VERSION;
  if (artifact.policyVersion && artifact.policyVersion !== policyVersion) {
    reasons.push("platform policy version changed");
  }
  return { stale: reasons.length > 0, reasons };
}

module.exports = {
  persistAdaptation,
  loadAdaptation,
  listAdaptations,
  checkAdaptationStaleness,
};
