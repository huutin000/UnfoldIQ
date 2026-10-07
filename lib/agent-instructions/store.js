"use strict";

/**
 * 1G.9 instruction store + sync-state helper (PHASE 1G.9, §§9, 15).
 * Layout (artifact-store conventions, atomic tmp+rename):
 *   projects/<projectId>/agent-instructions/<instructionVersion>.json
 *   projects/<projectId>/agent-instructions/index.json (append-only history)
 *   projects/<projectId>/instruction-sync/<syncId>.json
 * History is never silently overwritten. No secrets persistable: sync
 * evidence holds DOM/provider-state excerpts + fingerprints only.
 */

const fs = require("fs");
const path = require("path");
const artifactStore = require("../../providers/runtime/artifact-store.js");
const shared = require("./shared.js");

function setRel(version) {
  return `agent-instructions/${version}.json`;
}
function syncRel(syncId) {
  return `instruction-sync/${syncId}.json`;
}
function indexRel() {
  return `agent-instructions/index.json`;
}

function persistInstructionSet(root, projectId, set) {
  if (!set || !set.instructionVersion || !set.compiledFingerprint) {
    return { ok: false, code: "INSTRUCTION_SET_INVALID" };
  }
  try {
    artifactStore.writeArtifactAtomic(root, projectId, setRel(set.instructionVersion), JSON.stringify(set, null, 2));
    const idx = readIndex(root, projectId);
    if (!idx.some((e) => e.instructionVersion === set.instructionVersion)) {
      idx.push({ instructionVersion: set.instructionVersion, fingerprint: set.compiledFingerprint, createdAt: set.createdAt });
      artifactStore.writeArtifactAtomic(root, projectId, indexRel(), JSON.stringify(idx, null, 2));
    }
    return { ok: true, path: `projects/${projectId}/${setRel(set.instructionVersion)}` };
  } catch (e) {
    return { ok: false, code: "INSTRUCTION_PERSIST_FAILED", message: String((e && e.message) || e) };
  }
}

function readIndex(root, projectId) {
  try {
    if (!artifactStore.artifactExists(root, projectId, indexRel())) return [];
    return JSON.parse(artifactStore.readArtifact(root, projectId, indexRel()).toString("utf8"));
  } catch {
    return [];
  }
}

function loadInstructionSet(root, projectId, version) {
  try {
    const rel = setRel(version);
    if (!artifactStore.artifactExists(root, projectId, rel)) return { ok: true, set: null };
    return { ok: true, set: JSON.parse(artifactStore.readArtifact(root, projectId, rel).toString("utf8")) };
  } catch (e) {
    return { ok: false, code: "INSTRUCTION_LOAD_FAILED", message: String((e && e.message) || e) };
  }
}

/**
 * Start a provider sync attempt record (local side only; the browser adapter
 * performs apply/readback and reports evidence back through this contract).
 */
function startInstructionSync(root, projectId, set, provider, extra = {}) {
  if (!set || !set.instructionVersion) {
    return { ok: false, code: "SYNC_SOURCE_INVALID", message: "a compiled instruction set is required" };
  }
  // FIX 03-R1 (live incident 2026-10-04): the seeded id is deterministic, so a
  // second apply of the same set+ref used to OVERWRITE the prior sync record —
  // destroying VERIFIED history (§26/§33: historical lineage is immutable).
  // A sync attempt is one-at-a-time evidence: if the seeded id already exists
  // on disk, re-seed with a nonce until an unused id is found (bounded).
  const seed = { set: set.instructionVersion, provider: (provider && provider.projectRef) || "flow" };
  let syncId = shared.id12("sy", seed);
  for (let nonce = 1; nonce <= 64 && artifactStore.artifactExists(root, projectId, syncRel(syncId)); nonce++) {
    syncId = shared.id12("sy", { ...seed, nonce });
  }
  if (artifactStore.artifactExists(root, projectId, syncRel(syncId))) {
    return { ok: false, code: "SYNC_ID_EXHAUSTED", message: "no unique sync id after 64 re-seeds" };
  }
  const sync = {
    version: shared.INSTRUCTIONS_VERSION,
    syncId,
    projectId,
    instructionSetId: set.instructionSetId,
    instructionVersion: set.instructionVersion,
    desiredFingerprint: set.compiledFingerprint,
    provider: (provider && provider.name) || "GOOGLE_FLOW",
    providerProjectRef: (provider && provider.projectRef) || null,
    // FIX 03 §19: hands-free lineage metadata (non-secret). previousSyncRef
    // points at the superseded prior sync record when one exists.
    automationMode: extra.automationMode || null,
    writeTransport: null,
    operatorTextEntry: null,
    previousSyncRef: typeof extra.previousSyncRef === "string" && extra.previousSyncRef ? extra.previousSyncRef : null,
    applyAttemptId: null,
    applyStatus: "PENDING",
    appliedAt: null,
    readbackStatus: "PENDING",
    readbackFingerprint: null,
    readbackAt: null,
    semanticCompareStatus: "PENDING",
    differences: [],
    referenceBindings: set.referenceBindings || [],
    verifiedAt: null,
    syncStatus: "DRAFT",
    evidenceRefs: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  try {
    artifactStore.writeArtifactAtomic(root, projectId, syncRel(syncId), JSON.stringify(sync, null, 2));
    return { ok: true, sync };
  } catch (e) {
    return { ok: false, code: "SYNC_PERSIST_FAILED", message: String((e && e.message) || e) };
  }
}

function recordSyncEvidence(root, projectId, syncId, evidence = {}) {
  try {
    const rel = syncRel(syncId);
    if (!artifactStore.artifactExists(root, projectId, rel)) return { ok: false, code: "SYNC_NOT_FOUND" };
    const sync = JSON.parse(artifactStore.readArtifact(root, projectId, rel).toString("utf8"));
    for (const key of ["applyAttemptId", "applyStatus", "appliedAt", "readbackStatus", "readbackFingerprint", "readbackAt", "semanticCompareStatus", "differences", "verifiedAt", "syncStatus", "automationMode", "writeTransport", "operatorTextEntry"]) {
      if (evidence[key] !== undefined) sync[key] = evidence[key];
    }
    if (evidence.evidenceRef) sync.evidenceRefs.push(evidence.evidenceRef);
    if (sync.syncStatus === "VERIFIED" && !sync.verifiedAt) sync.verifiedAt = new Date().toISOString();
    sync.updatedAt = new Date().toISOString();
    artifactStore.writeArtifactAtomic(root, projectId, rel, JSON.stringify(sync, null, 2));
    return { ok: true, sync };
  } catch (e) {
    return { ok: false, code: "SYNC_UPDATE_FAILED", message: String((e && e.message) || e) };
  }
}

function loadSync(root, projectId, syncId) {
  try {
    const rel = syncRel(syncId);
    if (!artifactStore.artifactExists(root, projectId, rel)) return { ok: true, sync: null };
    return { ok: true, sync: JSON.parse(artifactStore.readArtifact(root, projectId, rel).toString("utf8")) };
  } catch (e) {
    return { ok: false, code: "SYNC_LOAD_FAILED", message: String((e && e.message) || e) };
  }
}

/**
 * FIX 02 §15 — load the newest indexed instruction set (append-only history
 * tail). Returns { ok, set } with set null when nothing was ever persisted.
 */
function loadLatestInstructionSet(root, projectId) {
  const idx = readIndex(root, projectId);
  if (idx.length === 0) return { ok: true, set: null };
  return loadInstructionSet(root, projectId, idx[idx.length - 1].instructionVersion);
}

/**
 * FIX 03 §19 — newest VERIFIED prior sync record for this project (by
 * verifiedAt), used as the superseded previousSyncRef lineage pointer for a
 * new sync. Never mutates anything; returns { ok, sync: null } when none.
 */
function latestVerifiedSync(root, projectId) {
  try {
    const dir = path.join(root, "projects", projectId, "instruction-sync");
    if (!fs.existsSync(dir)) return { ok: true, sync: null };
    let best = null;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".json")) continue;
      try {
        const s = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
        if (!s || s.syncId !== path.basename(f, ".json")) continue;
        if (s.syncStatus !== "VERIFIED") continue;
        if (!best || String(s.verifiedAt || "") > String(best.verifiedAt || "")) best = s;
      } catch {
        // unreadable records are skipped, never guessed
      }
    }
    return { ok: true, sync: best };
  } catch (e) {
    return { ok: false, code: "SYNC_SCAN_FAILED", message: String((e && e.message) || e) };
  }
}

module.exports = {
  persistInstructionSet,
  loadInstructionSet,
  loadLatestInstructionSet,
  startInstructionSync,
  recordSyncEvidence,
  loadSync,
  latestVerifiedSync,
};
