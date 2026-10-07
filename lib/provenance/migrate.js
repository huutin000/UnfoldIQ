"use strict";

/**
 * Phase 1H.6 — evidence-based provenance bootstrap (§49).
 * Derives origin/rights records ONLY from registry fields + history +
 * case evidence. Origin mapping is conservative: recorded `generated`
 * stays GENERATED (with gaps flagged REVIEW_REQUIRED); `existing` /
 * `migration` (pre-existing files of unknown origin) become UNKNOWN +
 * REVIEW_REQUIRED — never silently GENERATED (the avatar lesson).
 * Rights are NEVER inferred: everything unproven stays UNRESOLVED with
 * evidence refs (generated != cleared). FICTION assets carry no factual
 * linkage (class-aware; factual linkage proven in tests, not forced).
 */

const prov = require("./index.js");

const SOURCE_TO_ORIGIN = {
  generated: "GENERATED",
  stock: "STOCK",
  "local-library": "UPLOADED",
  migration: "UNKNOWN",
  existing: "UNKNOWN",
};

function inspectProvenanceEvidence(root, projectId, assetLib) {
  const records = [];
  const decisions = [];
  let index = null;
  try {
    const listed = assetLib.listAssets(root, projectId);
    if (listed.ok) index = listed.assets || [];
  } catch { /* no registry → nothing provable */ }
  if (!index) {
    decisions.push({ asset: "(registry)", status: "UNRESOLVED", why: "asset registry unreadable" });
    return { records, decisions };
  }
  for (const rec of index) {
    if (!rec || !rec.assetId) continue;
    const origin = SOURCE_TO_ORIGIN[rec.source] || "UNKNOWN";
    const gaps = [];
    if (origin === "GENERATED" && !rec.provider) gaps.push("no provider");
    if (origin === "GENERATED" && !rec.jobId) gaps.push("no job linkage");
    if (origin === "GENERATED" && !rec.modelVersion) gaps.push("no model version");
    let status = "MIGRATED";
    if (origin === "UNKNOWN") status = "REVIEW_REQUIRED";
    else if (gaps.length > 0) status = "REVIEW_REQUIRED";
    else if (rec.qualityStatus !== "APPROVED") status = "REVIEW_REQUIRED";
    records.push({
      assetId: rec.assetId,
      assetHash: (rec.hash && rec.hash.value) || null,
      originType: origin,
      provider: rec.provider || null,
      model: rec.modelVersion || null,
      sourceRef: (rec.provenance && rec.provenance.detail) || rec.source || null,
      parentAssetIds: Array.isArray(rec.derivedFrom) ? rec.derivedFrom : [],
      referenceAssetIds: Array.isArray(rec.referenceIds) ? rec.referenceIds : [],
      createdAt: rec.createdAt || null,
      importedAt: rec.updatedAt || null,
      factualSourceRefs: [],
      rights: { ownershipStatus: "UNRESOLVED", referenceRightsStatus: "UNRESOLVED" },
      evidenceRefs: [`assets/library-index.json#${rec.assetId}`],
      provenanceStatus: status,
      detail: gaps.length > 0
        ? `lineage gaps: ${gaps.join(", ")}; generated != rights-cleared`
        : (origin === "UNKNOWN" ? "pre-existing bytes of unproven origin (avatar class: never call it GENERATED)" : "registry fields complete; rights still UNRESOLVED (generated != cleared)"),
    });
    decisions.push({ asset: rec.assetId, status, why: origin === "UNKNOWN" ? "unproven origin stays UNKNOWN" : (gaps.length > 0 ? gaps.join("; ") : "registry-complete, rights unproven") });
  }
  return { records, decisions };
}

function bootstrapProvenance(root, projectId, opts = {}) {
  const assetLib = opts.assetLib || null;
  if (!assetLib) return { ok: false, code: "PROVENANCE_SCHEMA_INVALID", message: "assetLib is required (read-only registry access)" };
  if (prov.exists(root, projectId)) {
    return { ok: false, code: "PROVENANCE_CONFLICT", message: "provenance store exists; correct by version, never re-bootstrap" };
  }
  let inspected;
  try {
    inspected = inspectProvenanceEvidence(root, projectId, assetLib);
  } catch (e) {
    return { ok: false, code: "PROVENANCE_SCHEMA_INVALID", message: String((e && e.message) || e) };
  }
  for (const r of inspected.records) {
    const res = prov.recordProvenance(root, projectId, r);
    if (!res.ok) return res;
  }
  const final = prov.loadProvenance(root, projectId);
  if (!final.ok) return final;
  return { ok: true, doc: final.doc, changed: true, decisions: inspected.decisions };
}

module.exports = { SOURCE_TO_ORIGIN, inspectProvenanceEvidence, bootstrapProvenance };
