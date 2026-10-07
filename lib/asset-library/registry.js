"use strict";

/**
 * Phase 1G.10 — reference/asset library registry (Stage B).
 * One owner for AssetRecord lifecycle: content-hash dedup, lineage,
 * reference locks, approved-asset immutability, selection/quality,
 * rights/provenance, instruction-version linkage.
 *
 * Persistence: projects/<projectId>/assets/library-index.json
 * (atomic tmp+rename via providers/runtime/artifact-store). No secrets:
 * records hold hashes/paths/metadata only, never credentials or tokens.
 * Approved assets are immutable by default: every mutator except
 * unlockAsset refuses a locked record with ASSET_LOCKED.
 */

const crypto = require("crypto");
const artifactStore = require("../../providers/runtime/artifact-store.js");

const INDEX_REL = "assets/library-index.json";
const INDEX_VERSION = "1.0.0";
const ASSET_TYPES = ["image", "video", "audio", "other"];
const ASSET_ROLES = ["CHARACTER_IDENTITY", "WORLD_LOCATION", "STYLE", "PALETTE", "PROJECT_GUIDE", "BROLL", "MUSIC", "SFX", "VOICE", "CAPTION", "OTHER"];
const ASSET_SOURCES = ["generated", "stock", "local-library", "migration", "existing"];
// Managed byte-persistence extensions per asset type (hardening sweep A-8).
const EXTENSION_FOR = { image: "png", video: "mp4", audio: "wav", other: "bin" };
const QUALITY_STATUSES = ["UNREVIEWED", "APPROVED", "REJECTED"];
const SELECTION_STATUSES = ["SELECTED", "REJECTED", "UNSET"];
const RIGHTS_STATUSES = ["VERIFIED", "UNVERIFIED", "UNKNOWN"];
// Core identity fields: never mutable after registration (dedup key).
const IMMUTABLE_FIELDS = ["assetId", "projectId", "hash", "bytes"];

function sha256Hex(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function assetIdFor(hashHex) {
  return `as-${String(hashHex).slice(0, 12)}`;
}

function nowIso() {
  try {
    return new Date().toISOString();
  } catch {
    return "unknown";
  }
}

/**
 * Validate + build a record (no persistence). Returns { ok, record|errors }.
 */
function buildAssetRecord(input = {}) {
  const errors = [];
  if (!ASSET_TYPES.includes(input.type)) errors.push("type must be image|video|audio|other");
  if (!ASSET_ROLES.includes(input.role)) errors.push("role must be a canonical asset role");
  if (!ASSET_SOURCES.includes(input.source)) errors.push("source must be generated|stock|local-library|migration|existing");
  if (!input.hash || input.hash.algo !== "sha256" || !/^[0-9a-f]{64}$/.test(input.hash.value || "")) {
    errors.push("hash must be { algo: sha256, value: 64-hex }");
  }
  if (!Number.isInteger(input.bytes) || input.bytes < 0) errors.push("bytes must be a non-negative integer");
  if (errors.length > 0) return { ok: false, errors };
  const at = input.createdAt || nowIso();
  return {
    ok: true,
    record: {
      version: "1.0.0",
      assetId: input.assetId || assetIdFor(input.hash.value),
      projectId: input.projectId || null,
      type: input.type,
      role: input.role,
      source: input.source,
      provider: input.provider || null,
      jobId: input.jobId || null,
      shotId: input.shotId || null,
      characterIds: Array.isArray(input.characterIds) ? input.characterIds.map(String) : [],
      locationIds: Array.isArray(input.locationIds) ? input.locationIds.map(String) : [],
      promptVersion: input.promptVersion || null,
      modelVersion: input.modelVersion || null,
      referenceIds: Array.isArray(input.referenceIds) ? input.referenceIds.map(String) : [],
      instructionVersion: input.instructionVersion || null,
      derivedFrom: Array.isArray(input.derivedFrom) ? input.derivedFrom.map(String) : [],
      hash: { algo: "sha256", value: input.hash.value },
      bytes: input.bytes,
      relativePath: input.relativePath || null,
      dimensions: input.dimensions || null,
      durationMs: Number.isInteger(input.durationMs) ? input.durationMs : null,
      rights: { status: (input.rights && input.rights.status) || "UNKNOWN", note: (input.rights && input.rights.note) || null },
      provenance: { source: (input.provenance && input.provenance.source) || input.source, detail: (input.provenance && input.provenance.detail) || null },
      qualityStatus: input.qualityStatus || "UNREVIEWED",
      selection: { status: (input.selection && input.selection.status) || "UNSET", decidedAt: (input.selection && input.selection.decidedAt) || null, reason: (input.selection && input.selection.reason) || null },
      lock: { locked: false, reason: null, lockedAt: null, actor: null, unlockedAt: null, unlockReason: null },
      createdAt: at,
      updatedAt: input.updatedAt || at,
    },
  };
}

function emptyIndex() {
  return { version: INDEX_VERSION, assets: {} };
}

function readIndex(root, projectId) {
  try {
    if (!artifactStore.artifactExists(root, projectId, INDEX_REL)) return emptyIndex();
    const raw = JSON.parse(artifactStore.readArtifact(root, projectId, INDEX_REL).toString("utf8"));
    if (!raw || typeof raw !== "object" || !raw.assets || typeof raw.assets !== "object") return emptyIndex();
    return raw;
  } catch {
    return emptyIndex();
  }
}

function writeIndex(root, projectId, index) {
  artifactStore.writeArtifactAtomic(root, projectId, INDEX_REL, JSON.stringify(index, null, 2));
}

function findByHash(index, hashHex) {
  for (const rec of Object.values(index.assets)) {
    if (rec && rec.hash && rec.hash.value === hashHex) return rec;
  }
  return null;
}

/**
 * Register bytes (or reuse on duplicate hash). Dedup gate: identical content
 * returns the existing assetId with deduplicated:true — never a second record.
 */
function registerAsset(root, projectId, input = {}) {
  if (!input.bytes && input.bytes !== 0 && !input.content) {
    return { ok: false, code: "ASSET_CONTENT_REQUIRED", message: "bytes (Buffer) or content required" };
  }
  const buf = Buffer.isBuffer(input.bytes) ? input.bytes : Buffer.from(input.content || []);
  const hashHex = sha256Hex(buf);
  const index = readIndex(root, projectId);
  const existing = findByHash(index, hashHex);
  if (existing) return { ok: true, assetId: existing.assetId, deduplicated: true, record: existing };
  const built = buildAssetRecord({ ...input, projectId, hash: { algo: "sha256", value: hashHex }, bytes: buf.length });
  if (!built.ok) return { ok: false, code: "ASSET_RECORD_INVALID", errors: built.errors };
  // Hardening sweep (A-8): core OWNS canonical media state. When the caller
  // passes bytes without a managed relativePath, persist them under
  // assets/<type>/<assetId>.<ext> through the atomic artifact store so every
  // assetId lineage resolves to core-managed bytes (not a loose downloads file).
  let relativePath = built.record.relativePath;
  if (!relativePath && Buffer.isBuffer(input.bytes)) {
    try {
      const ext = EXTENSION_FOR[input.type] || (input.type === "video" ? "mp4" : input.type === "audio" ? "wav" : "bin");
      relativePath = artifactStore.writeArtifactAtomic(root, projectId, `assets/${input.type}/${built.record.assetId}.${ext}`, buf);
      built.record.relativePath = relativePath;
    } catch (e) {
      return { ok: false, code: "ASSET_PERSIST_FAILED", message: String((e && e.message) || e) };
    }
  }
  index.assets[built.record.assetId] = built.record;
  try {
    writeIndex(root, projectId, index);
  } catch (e) {
    return { ok: false, code: "ASSET_PERSIST_FAILED", message: String((e && e.message) || e) };
  }
  return { ok: true, assetId: built.record.assetId, deduplicated: false, record: built.record };
}

function getAsset(root, projectId, assetId) {
  const index = readIndex(root, projectId);
  const rec = index.assets[assetId];
  if (!rec) return { ok: false, code: "ASSET_NOT_FOUND" };
  return { ok: true, record: rec };
}

function listAssets(root, projectId, filter) {
  const index = readIndex(root, projectId);
  const all = Object.values(index.assets);
  if (typeof filter !== "function") return { ok: true, assets: all };
  return { ok: true, assets: all.filter(filter) };
}

function mutateAsset(root, projectId, assetId, patch, actor) {
  const index = readIndex(root, projectId);
  const rec = index.assets[assetId];
  if (!rec) return { ok: false, code: "ASSET_NOT_FOUND" };
  if (rec.lock && rec.lock.locked) return { ok: false, code: "ASSET_LOCKED", message: "approved asset is immutable; unlock with reason first" };
  for (const f of IMMUTABLE_FIELDS) {
    if (patch[f] !== undefined && JSON.stringify(patch[f]) !== JSON.stringify(rec[f])) {
      return { ok: false, code: "ASSET_IMMUTABLE_FIELD", message: `field ${f} is part of the dedup identity and cannot change` };
    }
  }
  const next = { ...rec, ...patch, assetId: rec.assetId, projectId: rec.projectId, hash: rec.hash, bytes: rec.bytes, updatedAt: nowIso() };
  index.assets[assetId] = next;
  try {
    writeIndex(root, projectId, index);
  } catch (e) {
    return { ok: false, code: "ASSET_PERSIST_FAILED", message: String((e && e.message) || e) };
  }
  void actor;
  return { ok: true, record: next };
}

function lockAsset(root, projectId, assetId, reason, actor) {
  if (!reason) return { ok: false, code: "ASSET_LOCK_REASON_REQUIRED", message: "locking needs a reason" };
  const index = readIndex(root, projectId);
  const rec = index.assets[assetId];
  if (!rec) return { ok: false, code: "ASSET_NOT_FOUND" };
  if (rec.lock && rec.lock.locked) return { ok: true, record: rec, alreadyLocked: true };
  rec.lock = { locked: true, reason: String(reason), lockedAt: nowIso(), actor: actor || null, unlockedAt: rec.lock.unlockedAt || null, unlockReason: rec.lock.unlockReason || null };
  rec.updatedAt = nowIso();
  try {
    writeIndex(root, projectId, index);
  } catch (e) {
    return { ok: false, code: "ASSET_PERSIST_FAILED", message: String((e && e.message) || e) };
  }
  return { ok: true, record: rec };
}

function unlockAsset(root, projectId, assetId, reason, actor) {
  if (!reason) return { ok: false, code: "ASSET_UNLOCK_REASON_REQUIRED", message: "unlocking needs a reason" };
  const index = readIndex(root, projectId);
  const rec = index.assets[assetId];
  if (!rec) return { ok: false, code: "ASSET_NOT_FOUND" };
  rec.lock = { locked: false, reason: rec.lock.reason || null, lockedAt: rec.lock.lockedAt || null, actor: rec.lock.actor || null, unlockedAt: nowIso(), unlockReason: String(reason) };
  void actor;
  rec.updatedAt = nowIso();
  try {
    writeIndex(root, projectId, index);
  } catch (e) {
    return { ok: false, code: "ASSET_PERSIST_FAILED", message: String((e && e.message) || e) };
  }
  return { ok: true, record: rec };
}

function checkEnum(value, allowed, code) {
  if (!allowed.includes(value)) return { ok: false, code, message: `${value} must be ${allowed.join("|")}` };
  return { ok: true };
}

function setSelection(root, projectId, assetId, status, reason) {
  const c = checkEnum(status, SELECTION_STATUSES, "ASSET_SELECTION_INVALID");
  if (!c.ok) return c;
  return mutateAsset(root, projectId, assetId, { selection: { status, decidedAt: nowIso(), reason: reason || null } });
}

function setQualityStatus(root, projectId, assetId, status) {
  const c = checkEnum(status, QUALITY_STATUSES, "ASSET_QUALITY_INVALID");
  if (!c.ok) return c;
  return mutateAsset(root, projectId, assetId, { qualityStatus: status });
}

function setRights(root, projectId, assetId, status, note) {
  const c = checkEnum(status, RIGHTS_STATUSES, "ASSET_RIGHTS_INVALID");
  if (!c.ok) return c;
  return mutateAsset(root, projectId, assetId, { rights: { status, note: note || null } });
}

function linkInstruction(root, projectId, assetId, instructionVersion) {
  if (typeof instructionVersion !== "string" || !instructionVersion) {
    return { ok: false, code: "ASSET_INSTRUCTION_VERSION_INVALID", message: "instructionVersion required" };
  }
  return mutateAsset(root, projectId, assetId, { instructionVersion });
}

function addLineage(root, projectId, assetId, parentIds) {
  const parents = Array.isArray(parentIds) ? parentIds.map(String) : [];
  const index = readIndex(root, projectId);
  for (const p of parents) {
    if (!index.assets[p]) return { ok: false, code: "LINEAGE_PARENT_UNKNOWN", message: `parent ${p} is not registered` };
    if (p === assetId) return { ok: false, code: "LINEAGE_SELF_PARENT", message: "an asset cannot derive from itself" };
  }
  const rec = index.assets[assetId];
  if (!rec) return { ok: false, code: "ASSET_NOT_FOUND" };
  if (rec.lock && rec.lock.locked) return { ok: false, code: "ASSET_LOCKED", message: "approved asset is immutable; unlock with reason first" };
  const merged = [...new Set([...(rec.derivedFrom || []), ...parents])];
  return mutateAsset(root, projectId, assetId, { derivedFrom: merged });
}

/**
 * Hardening sweep (Task 02, §5.1 + A-21): canonical-source gate.
 * A false asset (e.g. an operator account avatar registered as "existing"
 * with no provider/job lineage and no QA approval) must never silently pass
 * reference/source selection. SELECTED+LOCKED alone is not proof.
 * Requires: media type matches, qualityStatus APPROVED, and generation
 * provenance (source "generated", or a provider linkage). Returns
 * { ok, code?, message? } — never throws.
 */
function validateCanonicalSource(record, opts = {}) {
  const mediaType = opts.mediaType || "image";
  if (!record || typeof record !== "object") {
    return { ok: false, code: "ASSET_NOT_FOUND", message: "no asset record" };
  }
  if (record.type !== mediaType) {
    return { ok: false, code: "SOURCE_TYPE_MISMATCH", message: `type ${record.type} is not a ${mediaType} source` };
  }
  if (record.qualityStatus !== "APPROVED") {
    return { ok: false, code: "SOURCE_QA_NOT_APPROVED", message: `qualityStatus ${record.qualityStatus} cannot seed a canonical source` };
  }
  const prov = record.provenance || {};
  const hasGenerationLineage = record.source === "generated" || record.provider != null;
  const untrustedExisting = (prov.source || record.source) === "existing" && record.provider == null && record.jobId == null;
  if (!hasGenerationLineage || untrustedExisting) {
    return { ok: false, code: "SOURCE_PROVENANCE_UNTRUSTED", message: `provenance ${prov.source || record.source} carries no generation lineage (provider/job)` };
  }
  return { ok: true };
}

/**
 * Transitive ancestor chain (nearest first). Cycles fail safe, never loop.
 */function lineageChain(root, projectId, assetId) {
  const index = readIndex(root, projectId);
  if (!index.assets[assetId]) return { ok: false, code: "ASSET_NOT_FOUND" };
  const chain = [];
  const seen = new Set([assetId]);
  const queue = [...(index.assets[assetId].derivedFrom || [])];
  while (queue.length > 0) {
    const id = queue.shift();
    if (seen.has(id)) return { ok: false, code: "LINEAGE_CYCLE", message: `cycle at ${id}` };
    seen.add(id);
    const rec = index.assets[id];
    if (!rec) return { ok: false, code: "LINEAGE_PARENT_UNKNOWN", message: `parent ${id} is not registered` };
    chain.push(id);
    for (const p of rec.derivedFrom || []) queue.push(p);
  }
  return { ok: true, chain };
}

module.exports = {
  INDEX_REL,
  ASSET_TYPES,
  ASSET_ROLES,
  ASSET_SOURCES,
  QUALITY_STATUSES,
  SELECTION_STATUSES,
  RIGHTS_STATUSES,
  sha256Hex,
  assetIdFor,
  buildAssetRecord,
  readIndex,
  registerAsset,
  getAsset,
  listAssets,
  lockAsset,
  unlockAsset,
  setSelection,
  setQualityStatus,
  setRights,
  linkInstruction,
  addLineage,
  lineageChain,
  validateCanonicalSource,
};
