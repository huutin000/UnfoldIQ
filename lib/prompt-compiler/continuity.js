"use strict";

/**
 * Continuity locks (1G.4 §13, §16): deterministic identity/world-state locks
 * for recurring subjects. The compiler rejects conflicts between current shot
 * intent and locked canonical identity unless an upstream canonical change
 * explicitly allows it (caller passes the updated lock).
 */

const LOCKABLE_DIMENSIONS = [
  "identity",
  "wardrobe",
  "ageSpecies",
  "hairFace",
  "style",
  "environment",
  "timeOfDayWorldState",
];

/**
 * Build locks from canonical reference assets: assets may carry
 * `locks: {identity, wardrobe, ...}`.
 */
function locksFromAssets(referenceAssets) {
  const map = new Map();
  for (const asset of referenceAssets || []) {
    if (asset.locks) map.set(asset.assetId, { assetId: asset.assetId, kind: asset.kind, ...asset.locks });
  }
  return map;
}

/**
 * Detect conflicts between current compile-time intents (analyst/caller
 * overrides) and locked canonical identity.
 * conflicts(): overrides {identity|wardrobe|ageSpecies|...} vs locks.
 * Returns { ok, conflicts: [{assetId, dimension, locked, attempted}] }.
 */
function checkContinuityConflicts(locks, overrides = {}) {
  const conflicts = [];
  for (const [assetId, lock] of locks) {
    for (const dimension of LOCKABLE_DIMENSIONS) {
      if (overrides[dimension] !== undefined && lock[dimension] !== undefined && overrides[dimension] !== lock[dimension]) {
        conflicts.push({ assetId, dimension, locked: lock[dimension], attempted: overrides[dimension] });
      }
    }
  }
  return { ok: conflicts.length === 0, conflicts };
}

/**
 * mustPreserve list derived ONLY from what is actually locked (no generic
 * boilerplate). With a reference frame, appearance preservation is explicit.
 */
function buildPreserveList(locks, referenceRefs, extra = []) {
  const preserve = new Set();
  for (const [, lock] of locks) {
    for (const dimension of LOCKABLE_DIMENSIONS) {
      if (lock[dimension] !== undefined) preserve.add(dimension);
    }
  }
  if ((referenceRefs || []).some((r) => r.kind === "FRAME")) {
    preserve.add("referenceFrameAppearance");
  }
  if ((referenceRefs || []).some((r) => r.kind === "CHARACTER")) {
    preserve.add("characterIdentity");
  }
  for (const item of extra) preserve.add(item);
  return [...preserve];
}

module.exports = { LOCKABLE_DIMENSIONS, locksFromAssets, checkContinuityConflicts, buildPreserveList };
