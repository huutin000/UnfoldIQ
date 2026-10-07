"use strict";

/**
 * Reference resolver (1G.4 §12): canonical reference assets win over re-described
 * identity. Assets are {assetId, kind: CHARACTER|ENVIRONMENT|STYLE|OBJECT|FRAME,
 * version/hash, ...locks}. Matching is by explicit subjectRefs/environmentRefs —
 * nothing is matched by prose guessing.
 */

const REFERENCE_KINDS = ["CHARACTER", "ENVIRONMENT", "STYLE", "OBJECT", "FRAME"];

function assetById(referenceAssets) {
  return new Map((referenceAssets || []).map((a) => [a.assetId, a]));
}

/**
 * Resolve canonical reference refs for a shot/scene. Returns
 * { ok, referenceRefs } where referenceRefs carry assetId/kind/version only.
 * Unknown explicit refs are reported (validator turns them into errors).
 */
function resolveReferenceRefs(referenceAssets, shot, scene) {
  const byId = assetById(referenceAssets);
  const referenceRefs = [];
  const unknown = [];
  const consider = (refId, role) => {
    if (!refId) return;
    const asset = byId.get(refId);
    if (!asset) {
      unknown.push({ refId, role });
      return;
    }
    if (!REFERENCE_KINDS.includes(asset.kind)) {
      unknown.push({ refId, role, reason: "unknown kind" });
      return;
    }
    if (!referenceRefs.some((r) => r.assetId === refId)) {
      referenceRefs.push({ assetId: asset.assetId, kind: asset.kind, version: asset.version || asset.hash || null });
    }
  };
  for (const refId of (shot && shot.subjectRefs) || []) consider(refId, "subject");
  for (const refId of (scene && scene.subjectRefs) || []) consider(refId, "subject");
  for (const refId of (shot && shot.environmentRefs) || []) consider(refId, "environment");
  for (const refId of (scene && scene.environmentRefs) || []) consider(refId, "environment");
  // NOTE: shot.continuityRefs carry continuity GROUP ids (e.g. cg-1), not
  // canonical asset ids — they are not reference candidates.
  return { ok: true, referenceRefs, unknown };
}

/** A reference frame exists when a FRAME-kind reference is attached (§16). */
function hasReferenceFrame(referenceRefs) {
  return (referenceRefs || []).some((r) => r.kind === "FRAME");
}

module.exports = { REFERENCE_KINDS, resolveReferenceRefs, hasReferenceFrame, assetById };
