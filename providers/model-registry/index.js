"use strict";

/**
 * 1G.6 provider/model capability registry facade (PHASE 1G.6, Prompt 01).
 *
 * resolveFromDecision(decision, options, snapshot, policy):
 *   1G.5 production decision (read-only) → requirement → hard filter →
 *   deterministic ranking → resolution artifact (persist optionally).
 *
 * Terminal statuses: RESOLVED | PROVISIONAL | REVIEW_REQUIRED | BLOCKED |
 * NOT_REQUIRED. Override states: ACCEPTED | ACCEPTED_WITH_WARNING | BLOCKED.
 *
 * Zero generation, zero credits, zero Flow UI, zero secrets. The 1G.5
 * decision object passed in is never mutated.
 */

const path = require("path");
const shared = require("./shared.js");
const registryLib = require("./registry.js");
const resolverLib = require("./resolver.js");
const validatorLib = require("./validator.js");
const storeLib = require("./store.js");

function seedSnapshotPath() {
  return path.join(__dirname, "snapshots", "flow-baseline-2026-10-03.json");
}

function loadSeedSnapshot() {
  return registryLib.loadSeedFile(seedSnapshotPath());
}

/**
 * Resolve provider/model for one 1G.5 production decision.
 * Input: decision (read-only), options (see buildRequirement),
 *   snapshot (normalized) or { seed: true } to load the dated baseline,
 *   policy (see DEFAULT_POLICY), store options { root, projectId, persist? }.
 */
function resolveFromDecision(decision, options = {}, snapshotInput = null, policyInput = {}, storeOpts = {}) {
  const built = resolverLib.buildRequirement(decision, options);
  if (!built.ok) return built;
  let snapshot = snapshotInput;
  if (snapshotInput && snapshotInput.seed === true) {
    const loaded = loadSeedSnapshot();
    if (!loaded.ok) return { ok: false, code: "SEED_SNAPSHOT_INVALID", message: loaded.blockers.join("; ") };
    snapshot = loaded.snapshot;
  }
  const resolved = resolverLib.resolveRequirement(snapshot, built.requirement, policyInput);
  if (!resolved.ok) return resolved;
  const artifact = resolved.artifact;
  if (storeOpts.root && storeOpts.persist !== false) {
    const saved = storeLib.persistResolution(storeOpts.root, storeOpts.projectId || built.requirement.projectId, artifact, { force: storeOpts.force });
    if (!saved.ok) return { ok: false, code: saved.code, message: saved.message };
    artifact.persistedPath = saved.path;
  }
  return { ok: true, status: artifact.status, artifact, requirement: built.requirement };
}

module.exports = {
  REGISTRY_VERSION: shared.REGISTRY_VERSION,
  RESOLVER_VERSION: shared.RESOLVER_VERSION,
  RESOLVER_POLICY_VERSION: shared.RESOLVER_POLICY_VERSION,
  CANONICAL_CAPABILITIES: shared.CANONICAL_CAPABILITIES,
  RENDER_MODE_WORKFLOWS: shared.RENDER_MODE_WORKFLOWS,
  DEFAULT_POLICY: resolverLib.DEFAULT_POLICY,
  buildSnapshot: registryLib.buildSnapshot,
  loadSeedFile: registryLib.loadSeedFile,
  loadSeedSnapshot,
  seedSnapshotPath,
  buildRequirement: resolverLib.buildRequirement,
  checkModelCompatibility: resolverLib.checkModelCompatibility,
  estimateCost: resolverLib.estimateCost,
  rankCandidates: resolverLib.rankCandidates,
  resolveRequirement: resolverLib.resolveRequirement,
  resolveFromDecision,
  applyModelOverride: resolverLib.applyModelOverride,
  validateSnapshot: validatorLib.validateSnapshot,
  validateResolution: validatorLib.validateResolution,
  persistResolution: storeLib.persistResolution,
  loadResolution: storeLib.loadResolution,
  listResolutions: storeLib.listResolutions,
  checkResolutionStaleness: storeLib.checkResolutionStaleness,
  shared,
};
