"use strict";

/**
 * Production Decision persistence + staleness (1G.5 §43-§45).
 *
 * Layout: projects/<projectId>/production-decisions/<shotId>.json (atomic).
 * Selected (operator) output types are never silently overwritten: a fresh
 * engine recommendation preserves an existing selection unless the caller
 * explicitly sets a new selection or forces.
 *
 * Targeted invalidation only: a changed shot/scene/reference/platform/policy
 * marks exactly the affected decisions STALE — never the upstream research,
 * story, beat, or prompt artifacts.
 */

const fs = require("fs");
const path = require("path");
const artifactStore = require("../../providers/runtime/artifact-store.js");
const shared = require("./shared.js");

function decisionRel(shotId) {
  return `production-decisions/${shotId}.json`;
}

function persistDecision(root, projectId, decision, opts = {}) {
  if (!decision || !decision.decisionId || !decision.shotId) {
    return { ok: false, code: "DECISION_INVALID" };
  }
  try {
    const existing = loadDecision(root, projectId, decision.shotId);
    let toSave = { ...decision };
    delete toSave._selectedSet;
    if (existing.ok && existing.decision && !opts.force) {
      const prev = existing.decision;
      // Never silently overwrite an operator selection.
      if (prev.selectedOutputType && !decision._selectedSet) {
        // Hardening sweep (A-6): restoring an operator selection over a NEW
        // engine decision must not pair the old strategy with render
        // metadata computed for the new recommendation — that artifact is
        // not renderer-reproducible from its structured fields. Refuse the
        // merge instead; the caller re-runs the decision + override path.
        const compatible = !prev.effectiveOutputType || prev.effectiveOutputType === decision.recommendedOutputType;
        if (!compatible) {
          return { ok: false, code: "DECISION_SELECTION_CONFLICT", message: `persisted selection ${prev.effectiveOutputType} is incompatible with the recomputed recommendation ${decision.recommendedOutputType}; re-run decideShotProduction + applyManualOverride` };
        }
        toSave.selectedOutputType = prev.selectedOutputType;
        toSave.selectedReason = prev.selectedReason || null;
        toSave.overrideState = prev.overrideState || "ACCEPTED";
        toSave.effectiveOutputType = prev.selectedOutputType;
      }
    }
    toSave.updatedAt = new Date().toISOString();
    artifactStore.writeArtifactAtomic(root, projectId, decisionRel(decision.shotId), JSON.stringify(toSave, null, 2));
    return { ok: true, path: `projects/${projectId}/${decisionRel(decision.shotId)}` };
  } catch (e) {
    return { ok: false, code: "DECISION_PERSIST_FAILED", message: String((e && e.message) || e) };
  }
}

function loadDecision(root, projectId, shotId) {
  try {
    const rel = decisionRel(shotId);
    if (!artifactStore.artifactExists(root, projectId, rel)) return { ok: true, decision: null };
    return { ok: true, decision: JSON.parse(artifactStore.readArtifact(root, projectId, rel).toString("utf8")) };
  } catch (e) {
    return { ok: false, code: "DECISION_LOAD_FAILED", message: String((e && e.message) || e) };
  }
}

function listDecisions(root, projectId) {
  const base = path.join(root, "projects", projectId, "production-decisions");
  const out = [];
  if (!fs.existsSync(base)) return { ok: true, decisions: out };
  for (const file of fs.readdirSync(base)) {
    if (!file.endsWith(".json")) continue;
    try {
      out.push(JSON.parse(fs.readFileSync(path.join(base, file), "utf8")));
    } catch { /* corrupt files are skipped, never crash */ }
  }
  return { ok: true, decisions: out };
}

/**
 * Targeted staleness: a decision becomes STALE only when a dependency it
 * actually references changed — its shot, its beats (modality lineage), its
 * parent scene, a referenced asset version (renderer only), the platform
 * context, or the decision policy version.
 *
 * FIX 1 §27 boundaries: provider/model availability changes NEVER stale the
 * modality (1G.6 reevaluates models later); reference changes stale the
 * renderer decision while the modality itself is unaffected.
 */
function checkDecisionStaleness(decision, context = {}) {
  const reasons = [];
  const rendererOnly = [];
  if (!decision) return { stale: false, reasons, rendererOnly };
  const fp = decision.sourceFingerprints || {};
  if (context.shot && shared.hash16(context.shot) !== fp.shot) {
    reasons.push("shot changed");
  }
  if (context.scene && shared.hash16(context.scene) !== fp.scene) {
    reasons.push("parent scene changed");
  }
  if (context.beatMap && Array.isArray(context.beatMap.beats)) {
    const byId = new Map(context.beatMap.beats.map((b) => [b.beatId, b]));
    for (const [beatId, stored] of Object.entries(decision.beatFingerprints || {})) {
      const current = byId.get(beatId);
      if (!current || shared.hash16(current) !== stored) {
        reasons.push(`beat ${beatId} meaning changed (modality stale)`);
        break;
      }
    }
  }
  if (context.referenceAssets) {
    const byId = new Map(context.referenceAssets.map((a) => [a.assetId, a]));
    for (const id of decision.referenceAssetIds || []) {
      const current = byId.get(id);
      if (!current || (current.version || current.hash || null) !== (decision.referenceVersions || {})[id]) {
        rendererOnly.push(`reference asset ${id} changed (renderer decision may stale; modality unaffected)`);
      }
    }
  }
  if (context.platform !== undefined && context.platform !== null && decision.platform !== context.platform) {
    reasons.push("platform output context changed");
  }
  const policyVersion = context.policyVersion || shared.DECISION_POLICY_VERSION;
  if (decision.policyRef && decision.policyRef !== policyVersion) {
    reasons.push("decision policy version changed (re-evaluation required)");
  }
  // NOTE: context.modelAvailability / supportedCapabilities are deliberately
  // ignored here — model changes never stale the modality (§27).
  const all = [...reasons, ...rendererOnly];
  return { stale: all.length > 0, reasons: all, rendererOnly };
}

/** Mark one shot's decision STALE (explicit invalidation). */
function markShotStale(root, projectId, shotId) {
  const loaded = loadDecision(root, projectId, shotId);
  if (!loaded.ok || !loaded.decision) return loaded;
  loaded.decision.status = "STALE";
  loaded.decision.updatedAt = new Date().toISOString();
  artifactStore.writeArtifactAtomic(root, projectId, decisionRel(shotId), JSON.stringify(loaded.decision, null, 2));
  return { ok: true };
}

/** Targeted scene invalidation: only decisions of that scene. */
function invalidateByScene(root, projectId, sceneId) {
  const listed = listDecisions(root, projectId);
  let invalidated = 0;
  for (const d of listed.decisions) {
    if (d.sceneId === sceneId && d.status !== "STALE") {
      d.status = "STALE";
      d.updatedAt = new Date().toISOString();
      artifactStore.writeArtifactAtomic(root, projectId, decisionRel(d.shotId), JSON.stringify(d, null, 2));
      invalidated++;
    }
  }
  return { ok: true, invalidated };
}

/** Targeted reference invalidation: only decisions referencing that asset. */
function invalidateByReference(root, projectId, assetId) {
  const listed = listDecisions(root, projectId);
  let invalidated = 0;
  for (const d of listed.decisions) {
    if ((d.referenceAssetIds || []).includes(assetId) && d.status !== "STALE") {
      d.status = "STALE";
      d.updatedAt = new Date().toISOString();
      artifactStore.writeArtifactAtomic(root, projectId, decisionRel(d.shotId), JSON.stringify(d, null, 2));
      invalidated++;
    }
  }
  return { ok: true, invalidated };
}

module.exports = {
  persistDecision,
  loadDecision,
  listDecisions,
  checkDecisionStaleness,
  markShotStale,
  invalidateByScene,
  invalidateByReference,
};
