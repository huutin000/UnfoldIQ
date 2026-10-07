"use strict";

/**
 * Phase 1H.6 — Asset provenance + rights (UNFOLDIQ CORE).
 *
 * One provenance record chain per assetId: versions append-only
 * (corrections are new versions; history is never rewritten). Rights are
 * structured by category — never an opaque boolean — and origin NEVER
 * implies rights (GENERATED != cleared). Unprovable rights stay
 * UNRESOLVED/REVIEW_REQUIRED with evidence refs, never fabricated.
 *
 * References (never copies): Asset Registry (identity/hash), Generation
 * History (attempts/decisions), DAG (derivation consumers), Telemetry
 * evidence, Golden baselines.
 *
 * Store: projects/<pid>/governance/provenance.json
 * { provenance: { assetId: { assetId, current, versions: { n: record } } } }
 */

const Ajv = require("ajv");
const addFormats = require("ajv-formats");
const fs = require("fs");
const path = require("path");
const artifactStore = require("../../providers/runtime/artifact-store.js");
const costShared = require("../output-cost/shared.js");
const manifestLib = require("../project-manifest/index.js");
const historyLib = require("../generation-history/index.js");

const PROVENANCE_SCHEMA_VERSION = "1.0.0";
const STORE_REL = "governance/provenance.json";

const ORIGIN_TYPES = ["GENERATED", "UPLOADED", "STOCK", "LICENSED", "DERIVED", "CAPTURED", "UNKNOWN"];
const PROV_STATUS = ["VERIFIED", "MIGRATED", "ASSERTED", "UNRESOLVED", "REVIEW_REQUIRED"];
const RIGHTS_STATUS = ["OWNED", "LICENSED", "PERMISSION_GRANTED", "PLATFORM_GENERATED", "PUBLIC_DOMAIN_ASSERTED", "UNRESOLVED", "REVIEW_REQUIRED", "NOT_APPLICABLE"];
const LICENSE_TYPES = ["ORIGINAL", "LICENSED", "ROYALTY_FREE_WITH_LICENSE", "PLATFORM_LIBRARY", "PUBLIC_DOMAIN_ASSERTED", "UNRESOLVED", "NOT_APPLICABLE"];

const ERRORS = {
  PROVENANCE_SCHEMA_INVALID: "provenance record fails validation",
  PROVENANCE_NOT_FOUND: "no provenance chain for this asset",
  PROVENANCE_CONFLICT: "stale writer or version collision",
  RIGHTS_EVIDENCE_MISSING: "claimed rights category needs evidence refs",
  RIGHTS_UNRESOLVED: "rights cannot be proven — fail safely, never fabricate",
};

let ajvValidator = null;
function validator() {
  if (!ajvValidator) {
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    const root = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "schemas", "governance.schema.json"), "utf8"));
    ajvValidator = ajv.compile({ ...root, $ref: "#/definitions/provenanceDoc" });
  }
  return ajvValidator;
}

function nowIso(now) {
  return now || new Date().toISOString();
}

function fingerprintOf(doc) {
  const { fingerprint, ...rest } = doc;
  void fingerprint;
  return costShared.hash16(JSON.parse(costShared.stableStringify(rest)));
}

function validateDoc(doc) {
  const errors = [];
  if (!doc || typeof doc !== "object") {
    return { ok: false, errors: [{ code: "PROVENANCE_SCHEMA_INVALID", message: "doc must be an object" }] };
  }
  const valid = validator()(doc);
  if (!valid) {
    for (const e of validator().errors || []) {
      errors.push({ code: "PROVENANCE_SCHEMA_INVALID", message: `${e.instancePath || "/"} ${e.message}` });
    }
  }
  const secrets = [...manifestLib.findSecretKeys(doc), ...historyLib.findSecretPastes(doc)];
  if (secrets.length > 0) {
    errors.push({ code: "PROVENANCE_SCHEMA_INVALID", message: `secret material must never persist: ${secrets.join(", ")}` });
  }
  if (errors.length === 0 && doc.fingerprint !== fingerprintOf(doc)) {
    errors.push({ code: "PROVENANCE_SCHEMA_INVALID", message: "fingerprint mismatch: mutated outside the canonical path" });
  }
  return { ok: errors.length === 0, errors };
}

function exists(root, projectId) {
  return artifactStore.artifactExists(root, projectId, STORE_REL);
}

function loadProvenance(root, projectId) {
  if (!exists(root, projectId)) {
    return { ok: false, code: "PROVENANCE_NOT_FOUND", message: ERRORS.PROVENANCE_NOT_FOUND };
  }
  let raw;
  try {
    raw = JSON.parse(artifactStore.readArtifact(root, projectId, STORE_REL).toString("utf8"));
  } catch (e) {
    return { ok: false, code: "PROVENANCE_SCHEMA_INVALID", message: `unparseable provenance store: ${String((e && e.message) || e)}` };
  }
  const v = validateDoc(raw);
  if (!v.ok) return { ok: false, code: "PROVENANCE_SCHEMA_INVALID", message: v.errors[0].message, errors: v.errors };
  return { ok: true, doc: raw };
}

function ensureDoc(root, projectId, opts = {}) {
  const loaded = loadProvenance(root, projectId);
  if (loaded.ok) return loaded;
  if (!exists(root, projectId)) {
    const createdAt = nowIso(opts.now);
    const doc = { schemaVersion: PROVENANCE_SCHEMA_VERSION, projectId, revision: 1, createdAt, updatedAt: createdAt, provenance: {}, fingerprint: null };
    doc.fingerprint = fingerprintOf(doc);
    const text = JSON.stringify(doc, null, 2) + "\n";
    try {
      artifactStore.writeArtifactAtomic(root, projectId, STORE_REL, text);
    } catch (e) {
      return { ok: false, code: "PROVENANCE_SCHEMA_INVALID", message: `atomic persist failed: ${String((e && e.message) || e)}` };
    }
    return { ok: true, doc };
  }
  return loaded;
}

function commitDoc(root, projectId, doc, opts = {}) {
  doc.revision += 1;
  doc.updatedAt = nowIso(opts.now);
  doc.fingerprint = fingerprintOf(doc);
  const text = JSON.stringify(doc, null, 2) + "\n";
  JSON.parse(text);
  const v = validateDoc(doc);
  if (!v.ok) return { ok: false, code: "PROVENANCE_SCHEMA_INVALID", message: v.errors[0].message, errors: v.errors };
  try {
    artifactStore.writeArtifactAtomic(root, projectId, STORE_REL, text);
  } catch (e) {
    return { ok: false, code: "PROVENANCE_SCHEMA_INVALID", message: `atomic persist failed: ${String((e && e.message) || e)}` };
  }
  return { ok: true };
}

function checkRights(input) {
  const rights = input.rights || {};
  if (!RIGHTS_STATUS.includes(rights.ownershipStatus)) {
    return { ok: false, code: "PROVENANCE_SCHEMA_INVALID", message: `ownershipStatus must be ${RIGHTS_STATUS.join("|")} (origin never implies rights)` };
  }
  if (!RIGHTS_STATUS.includes(rights.referenceRightsStatus)) {
    return { ok: false, code: "PROVENANCE_SCHEMA_INVALID", message: `referenceRightsStatus must be ${RIGHTS_STATUS.join("|")}` };
  }
  // A claimed license category needs LICENSE evidence specifically: a
  // registry/identity ref proves bytes, never ownership.
  const licensed = ["OWNED", "LICENSED", "PERMISSION_GRANTED", "PLATFORM_GENERATED", "PUBLIC_DOMAIN_ASSERTED"];
  const claimed = licensed.includes(rights.ownershipStatus) || licensed.includes(rights.referenceRightsStatus);
  const ev = Array.isArray(rights.licenseEvidenceRefs) ? rights.licenseEvidenceRefs : [];
  if (claimed && ev.length === 0) {
    return { ok: false, code: "RIGHTS_EVIDENCE_MISSING", message: `${ERRORS.RIGHTS_EVIDENCE_MISSING}: ${rights.ownershipStatus}/${rights.referenceRightsStatus} needs licenseEvidenceRefs (registry refs prove identity, not rights)` };
  }
  // A positive license TYPE (external grant) needs evidence refs too;
  // ORIGINAL (self-created, recorded in provenance) stands on the record.
  const externalLicense = ["LICENSED", "ROYALTY_FREE_WITH_LICENSE", "PLATFORM_LIBRARY", "PUBLIC_DOMAIN_ASSERTED"];
  if (externalLicense.includes(rights.licenseType) && ev.length === 0) {
    return { ok: false, code: "RIGHTS_EVIDENCE_MISSING", message: `${ERRORS.RIGHTS_EVIDENCE_MISSING}: licenseType ${rights.licenseType} needs licenseEvidenceRefs` };
  }
  for (const f of ["musicRightsStatus", "voiceRightsStatus", "likenessRightsStatus"]) {
    if (rights[f] !== undefined && rights[f] !== null && typeof rights[f] !== "string") {
      return { ok: false, code: "PROVENANCE_SCHEMA_INVALID", message: `${f} must be a string or null` };
    }
  }
  return { ok: true };
}

/**
 * Record (or correct via new version) one asset's provenance. Origin UNKNOWN
 * stays UNKNOWN/REVIEW_REQUIRED — never silently upgraded. Licensed claims
 * need evidence refs. Same-version replay with identical bytes is a no-op.
 */
function recordProvenance(root, projectId, input = {}, opts = {}) {
  if (typeof input.assetId !== "string" || !input.assetId) {
    return { ok: false, code: "PROVENANCE_SCHEMA_INVALID", message: "assetId is required" };
  }
  if (!ORIGIN_TYPES.includes(input.originType)) {
    return { ok: false, code: "PROVENANCE_SCHEMA_INVALID", message: `originType must be ${ORIGIN_TYPES.join("|")} (unknown source is UNKNOWN, never guessed GENERATED)` };
  }
  const rc = checkRights(input);
  if (!rc.ok) return rc;
  const ensured = ensureDoc(root, projectId, opts);
  if (!ensured.ok) return ensured;
  const doc = ensured.doc;
  if (opts.expectedRevision !== undefined && opts.expectedRevision !== null && doc.revision !== opts.expectedRevision) {
    return { ok: false, code: "PROVENANCE_CONFLICT", message: `stale writer: expected revision ${opts.expectedRevision}, current is ${doc.revision}` };
  }
  const chain = doc.provenance[input.assetId] || { assetId: input.assetId, current: 0, versions: {} };
  const version = input.provenanceVersion || chain.current + 1;
  if (doc.provenance[input.assetId] && chain.versions[version]) {
    const existing = chain.versions[version];
    const candidate = buildRecord(input, version, existing.provenanceId);
    if (costShared.stableStringify(existing) === costShared.stableStringify(candidate)) {
      return { ok: true, doc, changed: false, deduped: true, record: existing };
    }
    return { ok: false, code: "PROVENANCE_CONFLICT", message: `version ${version} exists with different bytes (corrections append new versions)` };
  }
  const record = buildRecord(input, version, input.provenanceId || costShared.id12("prov", { project: projectId, asset: input.assetId, v: version }));
  if (!/^prov-[0-9a-f]{12}$/.test(record.provenanceId)) {
    return { ok: false, code: "PROVENANCE_SCHEMA_INVALID", message: "provenanceId prov-<12hex> is required" };
  }
  if (input.originType === "UNKNOWN" && (input.provenanceStatus === "VERIFIED" || input.provenanceStatus === "ASSERTED")) {
    return { ok: false, code: "PROVENANCE_SCHEMA_INVALID", message: "UNKNOWN origin can only be UNRESOLVED/REVIEW_REQUIRED/MIGRATED, never VERIFIED/ASSERTED" };
  }
  chain.versions[version] = record;
  chain.current = Math.max(chain.current, version);
  doc.provenance[input.assetId] = chain;
  const c = commitDoc(root, projectId, doc, opts);
  if (!c.ok) return c;
  return { ok: true, doc, changed: true, record };
}

function buildRecord(input, version, provenanceId) {
  const rights = input.rights || {};
  return {
    provenanceId,
    assetId: input.assetId,
    provenanceVersion: version,
    assetHash: input.assetHash || null,
    originType: input.originType,
    provider: input.provider || null,
    model: input.model || null,
    sourceRef: input.sourceRef || null,
    parentAssetIds: Array.isArray(input.parentAssetIds) ? input.parentAssetIds.map(String) : [],
    referenceAssetIds: Array.isArray(input.referenceAssetIds) ? input.referenceAssetIds.map(String) : [],
    createdAt: input.createdAt || null,
    importedAt: input.importedAt || null,
    factualSourceRefs: Array.isArray(input.factualSourceRefs) ? input.factualSourceRefs.map(String) : [],
    rights: {
      ownershipStatus: rights.ownershipStatus || "UNRESOLVED",
      referenceRightsStatus: rights.referenceRightsStatus || "UNRESOLVED",
      licenseType: rights.licenseType || null,
      licenseRef: rights.licenseRef || null,
      licenseEvidenceRefs: Array.isArray(rights.licenseEvidenceRefs) ? rights.licenseEvidenceRefs.map(String) : [],
      musicRightsStatus: rights.musicRightsStatus || null,
      voiceRightsStatus: rights.voiceRightsStatus || null,
      likenessRightsStatus: rights.likenessRightsStatus || null,
      voiceDetail: rights.voiceDetail || null,
      musicDetail: rights.musicDetail || null,
    },
    evidenceRefs: Array.isArray(input.evidenceRefs) ? input.evidenceRefs.map(String) : [],
    provenanceStatus: input.provenanceStatus || (input.originType === "UNKNOWN" ? "REVIEW_REQUIRED" : "ASSERTED"),
    supersedes: version > 1 ? version - 1 : null,
    detail: input.detail || null,
  };
}

function getProvenance(root, projectId, assetId) {
  const loaded = loadProvenance(root, projectId);
  if (!loaded.ok) return loaded;
  const chain = loaded.doc.provenance[assetId];
  if (!chain) return { ok: false, code: "PROVENANCE_NOT_FOUND", message: ERRORS.PROVENANCE_NOT_FOUND };
  return { ok: true, chain, record: chain.versions[chain.current] };
}

/**
 * Walk derivation lineage backward (child → parents). Every hop must
 * resolve; unresolvable parent → PROVENANCE_NOT_FOUND (no orphan finals).
 */
function traceLineage(root, projectId, assetId, maxDepth = 25) {
  const loaded = loadProvenance(root, projectId);
  if (!loaded.ok) return loaded;
  const chain = [];
  const seen = new Set();
  let current = assetId;
  let depth = 0;
  while (current) {
    if (seen.has(current)) {
      return { ok: false, code: "PROVENANCE_SCHEMA_INVALID", message: `derivation cycle at ${current}` };
    }
    if (depth >= maxDepth) {
      return { ok: false, code: "PROVENANCE_SCHEMA_INVALID", message: "derivation chain exceeds max depth" };
    }
    seen.add(current);
    const c = loaded.doc.provenance[current];
    if (!c) {
      if (chain.length === 0) return { ok: false, code: "PROVENANCE_NOT_FOUND", message: ERRORS.PROVENANCE_NOT_FOUND };
      return { ok: false, code: "PROVENANCE_NOT_FOUND", message: `parent ${current} has no provenance record (orphan derivation)` };
    }
    const rec = c.versions[c.current];
    chain.push({ assetId: current, originType: rec.originType, status: rec.provenanceStatus, parents: rec.parentAssetIds });
    const parents = rec.parentAssetIds || [];
    current = parents.length > 0 ? parents[0] : null;
    // Multi-parent: verify the rest resolve (breadth), follow the first (depth).
    for (const p of parents.slice(1)) {
      if (!loaded.doc.provenance[p]) {
        return { ok: false, code: "PROVENANCE_NOT_FOUND", message: `parent ${p} has no provenance record (orphan derivation)` };
      }
    }
    depth += 1;
  }
  return { ok: true, chain };
}

module.exports = {
  PROVENANCE_SCHEMA_VERSION,
  STORE_REL,
  ORIGIN_TYPES,
  PROV_STATUS,
  RIGHTS_STATUS,
  LICENSE_TYPES,
  ERRORS,
  validateDoc,
  exists,
  loadProvenance,
  recordProvenance,
  getProvenance,
  traceLineage,
};
