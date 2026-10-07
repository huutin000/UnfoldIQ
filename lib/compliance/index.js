"use strict";

/**
 * Phase 1H.6 — Platform policy snapshots + compliance decisions (CORE).
 *
 * Snapshots are immutable and versioned (new check → new snapshot; prior
 * CURRENT flips to SUPERSEDED in the same explicit commit with the link —
 * never silently rewritten). Decisions are append-only: overrides,
 * staleness, and reevaluations are NEW decisions with supersedes links.
 *
 * The rule engine never hard-codes "AI used?" — it evaluates actual
 * content characteristics against the referenced snapshot's rules. No
 * rule matches (or unknown characteristics) → REVIEW_REQUIRED, never a
 * guess. Unknown/unverified platforms → REVIEW_REQUIRED (no fabricated
 * policy facts).
 *
 * Media locks do NOT block compliance reevaluation: decisions reference
 * locked assets freely; only media mutation is lock-gated (1H.2).
 *
 * Stores: projects/<pid>/governance/compliance.json
 * { snapshots: {}, decisions: {} }
 */

const Ajv = require("ajv");
const addFormats = require("ajv-formats");
const fs = require("fs");
const path = require("path");
const artifactStore = require("../../providers/runtime/artifact-store.js");
const costShared = require("../output-cost/shared.js");
const manifestLib = require("../project-manifest/index.js");
const historyLib = require("../generation-history/index.js");

const COMPLIANCE_SCHEMA_VERSION = "1.0.0";
const STORE_REL = "governance/compliance.json";

const DECISIONS = ["AI_DISCLOSURE_REQUIRED", "AI_DISCLOSURE_NOT_REQUIRED", "REVIEW_REQUIRED", "BLOCKED", "NOT_APPLICABLE"];
const FRESHNESS = ["FRESH", "STALE_POLICY", "POLICY_SOURCE_UNAVAILABLE", "REVIEW_REQUIRED"];

const ERRORS = {
  COMPLIANCE_SCHEMA_INVALID: "compliance record fails validation",
  POLICY_SNAPSHOT_NOT_FOUND: "no policy snapshot for this platform/type",
  POLICY_SNAPSHOT_STALE: "a newer canonical snapshot exists or review cadence lapsed",
  COMPLIANCE_REVIEW_REQUIRED: "human review required (unknown characteristics/policy)",
  COMPLIANCE_BLOCKED: "compliance blocks this publish path",
  COMPLIANCE_CONFLICT: "stale writer or duplicate identity",
};

let ajvValidator = null;
function validator() {
  if (!ajvValidator) {
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    const root = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "schemas", "governance.schema.json"), "utf8"));
    ajvValidator = ajv.compile({ ...root, $ref: "#/definitions/complianceDoc" });
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
    return { ok: false, errors: [{ code: "COMPLIANCE_SCHEMA_INVALID", message: "doc must be an object" }] };
  }
  const valid = validator()(doc);
  if (!valid) {
    for (const e of validator().errors || []) {
      errors.push({ code: "COMPLIANCE_SCHEMA_INVALID", message: `${e.instancePath || "/"} ${e.message}` });
    }
  }
  const secrets = [...manifestLib.findSecretKeys(doc), ...historyLib.findSecretPastes(doc)];
  if (secrets.length > 0) {
    errors.push({ code: "COMPLIANCE_SCHEMA_INVALID", message: `secret material must never persist: ${secrets.join(", ")}` });
  }
  if (errors.length === 0 && doc.fingerprint !== fingerprintOf(doc)) {
    errors.push({ code: "COMPLIANCE_SCHEMA_INVALID", message: "fingerprint mismatch: mutated outside the canonical path" });
  }
  return { ok: errors.length === 0, errors };
}

function exists(root, projectId) {
  return artifactStore.artifactExists(root, projectId, STORE_REL);
}

function loadCompliance(root, projectId) {
  if (!exists(root, projectId)) {
    return { ok: false, code: "POLICY_SNAPSHOT_NOT_FOUND", message: "compliance store absent" };
  }
  let raw;
  try {
    raw = JSON.parse(artifactStore.readArtifact(root, projectId, STORE_REL).toString("utf8"));
  } catch (e) {
    return { ok: false, code: "COMPLIANCE_SCHEMA_INVALID", message: `unparseable compliance store: ${String((e && e.message) || e)}` };
  }
  const v = validateDoc(raw);
  if (!v.ok) return { ok: false, code: "COMPLIANCE_SCHEMA_INVALID", message: v.errors[0].message, errors: v.errors };
  return { ok: true, doc: raw };
}

function ensureDoc(root, projectId, opts = {}) {
  const loaded = loadCompliance(root, projectId);
  if (loaded.ok) return loaded;
  if (!exists(root, projectId)) {
    const createdAt = nowIso(opts.now);
    const doc = { schemaVersion: COMPLIANCE_SCHEMA_VERSION, projectId, revision: 1, createdAt, updatedAt: createdAt, snapshots: {}, decisions: {}, fingerprint: null };
    doc.fingerprint = fingerprintOf(doc);
    const text = JSON.stringify(doc, null, 2) + "\n";
    try {
      artifactStore.writeArtifactAtomic(root, projectId, STORE_REL, text);
    } catch (e) {
      return { ok: false, code: "COMPLIANCE_SCHEMA_INVALID", message: `atomic persist failed: ${String((e && e.message) || e)}` };
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
  if (!v.ok) return { ok: false, code: "COMPLIANCE_SCHEMA_INVALID", message: v.errors[0].message, errors: v.errors };
  try {
    artifactStore.writeArtifactAtomic(root, projectId, STORE_REL, text);
  } catch (e) {
    return { ok: false, code: "COMPLIANCE_SCHEMA_INVALID", message: `atomic persist failed: ${String((e && e.message) || e)}` };
  }
  return { ok: true };
}

/**
 * Record one immutable policy snapshot. Same platform+type recording a
 * newer check explicitly supersedes prior CURRENT snapshots IN THE SAME
 * COMMIT (old bytes otherwise untouched; links both ways).
 */
function recordPolicySnapshot(root, projectId, input = {}, opts = {}) {
  for (const f of ["platform", "policyType", "sourceUrl", "checkedAt"]) {
    if (typeof input[f] !== "string" || !input[f]) {
      return { ok: false, code: "COMPLIANCE_SCHEMA_INVALID", message: `${f} is required (official source preferred, checkedAt mandatory)` };
    }
  }
  if (!Array.isArray(input.rules)) {
    return { ok: false, code: "COMPLIANCE_SCHEMA_INVALID", message: "rules[] is required (characteristic-based evaluation)" };
  }
  const ensured = ensureDoc(root, projectId, opts);
  if (!ensured.ok) return ensured;
  const doc = ensured.doc;
  if (opts.expectedRevision !== undefined && opts.expectedRevision !== null && doc.revision !== opts.expectedRevision) {
    return { ok: false, code: "COMPLIANCE_CONFLICT", message: `stale writer: expected revision ${opts.expectedRevision}, current is ${doc.revision}` };
  }
  const record = {
    snapshotId: input.snapshotId || costShared.id12("pol", { platform: input.platform, type: input.policyType, at: input.checkedAt }),
    platform: input.platform,
    policyType: input.policyType,
    sourceUrl: input.sourceUrl,
    sourceTitle: input.sourceTitle || null,
    checkedAt: input.checkedAt,
    effectiveDate: input.effectiveDate || null,
    contentHash: input.contentHash || null,
    reviewAfterDays: input.reviewAfterDays !== undefined ? input.reviewAfterDays : null,
    rules: input.rules,
    status: "CURRENT",
    supersededBy: null,
  };
  if (!/^pol-[0-9a-f]{12}$/.test(record.snapshotId)) {
    return { ok: false, code: "COMPLIANCE_SCHEMA_INVALID", message: "snapshotId pol-<12hex> is required" };
  }
  if (doc.snapshots[record.snapshotId]) {
    const same = costShared.stableStringify(doc.snapshots[record.snapshotId]) === costShared.stableStringify(record);
    if (same) return { ok: true, doc, changed: false, deduped: true, snapshot: record };
    return { ok: false, code: "COMPLIANCE_CONFLICT", message: `snapshot ${record.snapshotId} exists with different bytes (new check → new snapshot)` };
  }
  // Explicit supersede: prior CURRENT snapshots for the same platform+type
  // flip in this commit, linked both ways. Their other bytes never change.
  for (const s of Object.values(doc.snapshots)) {
    if (s.platform === record.platform && s.policyType === record.policyType && s.status === "CURRENT") {
      s.status = "SUPERSEDED";
      s.supersededBy = record.snapshotId;
    }
  }
  doc.snapshots[record.snapshotId] = record;
  const c = commitDoc(root, projectId, doc, opts);
  if (!c.ok) return c;
  return { ok: true, doc, changed: true, snapshot: record };
}

function currentSnapshot(doc, platform, policyType) {
  const cands = Object.values(doc.snapshots).filter((s) => s.platform === platform && s.policyType === policyType && s.status === "CURRENT");
  cands.sort((a, b) => (a.checkedAt < b.checkedAt ? 1 : -1));
  return cands[0] || null;
}

/** Freshness: STALE when a newer snapshot exists, cadence lapsed, or source gone. */
function evaluateFreshness(doc, snapshot, now = null) {
  if (!snapshot) return "POLICY_SOURCE_UNAVAILABLE";
  const newer = Object.values(doc.snapshots).some((s) => s.platform === snapshot.platform && s.policyType === snapshot.policyType && s.checkedAt > snapshot.checkedAt);
  if (newer) return "STALE_POLICY";
  if (snapshot.reviewAfterDays) {
    const ageMs = Date.parse(now || new Date().toISOString()) - Date.parse(snapshot.checkedAt);
    if (ageMs > snapshot.reviewAfterDays * 24 * 3600 * 1000) return "STALE_POLICY";
  }
  return "FRESH";
}

function ruleMatches(rule, characteristics) {
  const match = rule.match || {};
  for (const [k, v] of Object.entries(match)) {
    if (characteristics[k] !== v) return false;
  }
  for (const k of rule.requireKnown || []) {
    if (characteristics[k] === undefined || characteristics[k] === null) return false;
  }
  return true;
}

/** First matching rule wins; no match (or unknown fields) → REVIEW_REQUIRED. */
function evaluateRules(snapshot, characteristics) {
  for (const rule of snapshot.rules || []) {
    if (ruleMatches(rule, characteristics)) {
      return { decision: rule.decision, reason: rule.reason || `matched rule ${rule.ruleId}`, ruleId: rule.ruleId };
    }
  }
  return { decision: "REVIEW_REQUIRED", reason: "no policy rule matches these characteristics — human review, never a guess", ruleId: null };
}

/**
 * Decide compliance for an asset/publish unit. Locks never block this path
 * (decisions reference media; only media mutation is lock-gated).
 * Unknown platform (no snapshot) → persisted REVIEW_REQUIRED with
 * POLICY_SOURCE_UNAVAILABLE freshness (explicit, not guessed).
 */
function decideCompliance(root, projectId, input = {}, opts = {}) {
  if (typeof input.platform !== "string" || !input.platform) {
    return { ok: false, code: "COMPLIANCE_SCHEMA_INVALID", message: "platform is required" };
  }
  if (typeof input.policyType !== "string" || !input.policyType) {
    return { ok: false, code: "COMPLIANCE_SCHEMA_INVALID", message: "policyType is required" };
  }
  if (!input.characteristics || typeof input.characteristics !== "object") {
    return { ok: false, code: "COMPLIANCE_SCHEMA_INVALID", message: "contentCharacteristics object is required (unknown → REVIEW, never omitted)" };
  }
  const ensured = ensureDoc(root, projectId, opts);
  if (!ensured.ok) return ensured;
  const doc = ensured.doc;
  if (opts.expectedRevision !== undefined && opts.expectedRevision !== null && doc.revision !== opts.expectedRevision) {
    return { ok: false, code: "COMPLIANCE_CONFLICT", message: `stale writer: expected revision ${opts.expectedRevision}, current is ${doc.revision}` };
  }
  const snap = currentSnapshot(doc, input.platform, input.policyType);
  let verdict;
  let freshness;
  let snapshotId;
  if (!snap) {
    verdict = { decision: "REVIEW_REQUIRED", reason: `no verified ${input.platform}/${input.policyType} snapshot — unverified platform policy, never guessed`, ruleId: null };
    freshness = "POLICY_SOURCE_UNAVAILABLE";
    snapshotId = "UNRESOLVED";
  } else {
    verdict = evaluateRules(snap, input.characteristics);
    freshness = evaluateFreshness(doc, snap, opts.now);
    if (freshness !== "FRESH" && verdict.decision !== "REVIEW_REQUIRED") {
      verdict = { decision: "REVIEW_REQUIRED", reason: `policy snapshot stale (${freshness}) — reevaluate on fresh policy`, ruleId: verdict.ruleId };
    }
    snapshotId = snap.snapshotId;
  }
  // Explicit staleness markers (content/policy change) force the review
  // outcome BEFORE persistence so fingerprints stay correct; the real
  // reevaluation happens on the next decide call.
  if (input.forceDecisionReview === true) {
    verdict = { decision: "REVIEW_REQUIRED", reason: input.reasonOverride || "marked stale: reevaluation required", ruleId: (verdict && verdict.ruleId) || null };
  }
  // Manual overrides carry an explicit human decision (validated below with
  // the override record); rules do not get a vote here.
  if (input.forceDecision !== undefined && input.forceDecision !== null) {
    if (!["AI_DISCLOSURE_REQUIRED", "AI_DISCLOSURE_NOT_REQUIRED", "REVIEW_REQUIRED", "BLOCKED", "NOT_APPLICABLE"].includes(input.forceDecision)) {
      return { ok: false, code: "COMPLIANCE_SCHEMA_INVALID", message: `forceDecision must be a valid decision value` };
    }
    verdict = { decision: input.forceDecision, reason: input.reasonOverride || "manual override decision", ruleId: null };
  }
  if (!["AI_DISCLOSURE_REQUIRED", "AI_DISCLOSURE_NOT_REQUIRED", "REVIEW_REQUIRED", "BLOCKED", "NOT_APPLICABLE"].includes(verdict.decision)) {
    return { ok: false, code: "COMPLIANCE_SCHEMA_INVALID", message: `rule produced invalid decision ${verdict.decision}` };
  }
  if (input.manualOverride !== undefined && input.manualOverride !== null) {
    const mo = input.manualOverride;
    for (const f of ["previousDecision", "newDecision", "reason", "actor"]) {
      if (typeof mo[f] !== "string" || !mo[f]) {
        return { ok: false, code: "COMPLIANCE_SCHEMA_INVALID", message: `manualOverride needs ${f} (explicit override, never silent)` };
      }
    }
  }
  const record = {
    decisionId: input.decisionId || costShared.id12("ccd", { project: projectId, asset: input.assetId || input.publishUnitId || "", at: nowIso(opts.now) }),
    projectId,
    assetId: input.assetId || null,
    publishUnitId: input.publishUnitId || null,
    platform: input.platform,
    policyType: input.policyType,
    policySnapshotId: snapshotId,
    contentCharacteristics: JSON.parse(JSON.stringify(input.characteristics)),
    decision: verdict.decision,
    reason: input.reasonOverride || verdict.reason,
    manualOverride: input.manualOverride !== undefined ? input.manualOverride : null,
    evidenceRefs: Array.isArray(input.evidenceRefs) ? input.evidenceRefs.map(String) : [],
    decidedAt: nowIso(opts.now),
    freshness,
    supersedes: input.supersedes || null,
  };
  if (!/^ccd-[0-9a-f]{12}$/.test(record.decisionId)) {
    return { ok: false, code: "COMPLIANCE_SCHEMA_INVALID", message: "decisionId ccd-<12hex> is required" };
  }
  if (doc.decisions[record.decisionId]) {
    const same = costShared.stableStringify(doc.decisions[record.decisionId]) === costShared.stableStringify(record);
    if (same) return { ok: true, doc, changed: false, deduped: true, decision: record };
    return { ok: false, code: "COMPLIANCE_CONFLICT", message: `decision ${record.decisionId} exists differently (override/reevaluate instead)` };
  }
  doc.decisions[record.decisionId] = record;
  const c = commitDoc(root, projectId, doc, opts);
  if (!c.ok) return c;
  return { ok: true, doc, changed: true, decision: record };
}

/**
 * Manual override: explicit new decision (previous + new + reason + actor +
 * timestamp + snapshot). Never mutates the old decision.
 */
function overrideDecision(root, projectId, decisionId, input = {}, opts = {}) {
  const loaded = loadCompliance(root, projectId);
  if (!loaded.ok) return loaded;
  const prev = loaded.doc.decisions[decisionId];
  if (!prev) return { ok: false, code: "COMPLIANCE_SCHEMA_INVALID", message: `unknown decision ${decisionId}` };
  if (typeof input.newDecision !== "string" || !["AI_DISCLOSURE_REQUIRED", "AI_DISCLOSURE_NOT_REQUIRED", "REVIEW_REQUIRED", "BLOCKED", "NOT_APPLICABLE"].includes(input.newDecision)) {
    return { ok: false, code: "COMPLIANCE_SCHEMA_INVALID", message: "newDecision must be a valid decision value" };
  }
  if (typeof input.reason !== "string" || !input.reason) {
    return { ok: false, code: "COMPLIANCE_SCHEMA_INVALID", message: "override needs an explicit reason" };
  }
  if (typeof input.actor !== "string" || !input.actor) {
    return { ok: false, code: "COMPLIANCE_SCHEMA_INVALID", message: "override needs an actor/context" };
  }
  return decideCompliance(root, projectId, {
    platform: prev.platform,
    policyType: prev.policyType,
    assetId: prev.assetId,
    publishUnitId: prev.publishUnitId,
    characteristics: prev.contentCharacteristics,
    evidenceRefs: prev.evidenceRefs,
    reasonOverride: `OVERRIDE ${prev.decision} → ${input.newDecision} by ${input.actor}: ${input.reason}`,
    forceDecision: input.newDecision,
    manualOverride: { previousDecision: decisionId, newDecision: input.newDecision, reason: input.reason, actor: input.actor, at: nowIso(opts.now) },
    supersedes: decisionId,
  }, opts);
}

/**
 * Content/policy change invalidation (§20): appends a REVIEW_REQUIRED
 * decision superseding the stale one. Never edits, never auto-regenerates
 * media (asset locks are untouched by compliance staleness).
 */
function markComplianceStale(root, projectId, decisionId, reason, opts = {}) {
  const loaded = loadCompliance(root, projectId);
  if (!loaded.ok) return loaded;
  const prev = loaded.doc.decisions[decisionId];
  if (!prev) return { ok: false, code: "COMPLIANCE_SCHEMA_INVALID", message: `unknown decision ${decisionId}` };
  if (typeof reason !== "string" || !reason) {
    return { ok: false, code: "COMPLIANCE_SCHEMA_INVALID", message: "staleness needs an explicit reason" };
  }
  const r = decideCompliance(root, projectId, {
    platform: prev.platform,
    policyType: prev.policyType,
    assetId: prev.assetId,
    publishUnitId: prev.publishUnitId,
    characteristics: prev.contentCharacteristics,
    evidenceRefs: prev.evidenceRefs,
    reasonOverride: `STALE (${prev.freshness}): ${reason}`,
    supersedes: decisionId,
    forceDecisionReview: true,
  }, opts);
  return r;
}

/** Publish-time freshness recheck (recompute against current snapshots). */
function checkDecisionFreshness(root, projectId, decisionId, now = null) {
  const loaded = loadCompliance(root, projectId);
  if (!loaded.ok) return loaded;
  const dec = loaded.doc.decisions[decisionId];
  if (!dec) return { ok: false, code: "COMPLIANCE_SCHEMA_INVALID", message: `unknown decision ${decisionId}` };
  if (dec.policySnapshotId === "UNRESOLVED") return { ok: true, freshness: "POLICY_SOURCE_UNAVAILABLE", decision: dec };
  const snap = loaded.doc.snapshots[dec.policySnapshotId];
  if (!snap) return { ok: true, freshness: "POLICY_SOURCE_UNAVAILABLE", decision: dec };
  return { ok: true, freshness: evaluateFreshness(loaded.doc, snap, now), decision: dec };
}

/** DAG edge specs for callers that persist compliance nodes (no cross-write). */
function dagSpecsFor(policySnapshotId, decisionId, assetId = null) {
  const nodes = [
    { key: `POLICY:${policySnapshotId}`, type: "POLICY_SNAPSHOT" },
    { key: `COMPLIANCE:${decisionId}`, type: "COMPLIANCE_DECISION" },
  ];
  const edges = [{ from: `POLICY:${policySnapshotId}`, to: `COMPLIANCE:${decisionId}`, type: "governs" }];
  if (assetId) {
    nodes.push({ key: `PROVENANCE:${assetId}`, type: "PROVENANCE_REF" });
    edges.push({ from: `PROVENANCE:${assetId}`, to: `COMPLIANCE:${decisionId}`, type: "characterizes" });
  }
  return { nodes, edges };
}

module.exports = {
  COMPLIANCE_SCHEMA_VERSION,
  STORE_REL,
  DECISIONS,
  FRESHNESS,
  ERRORS,
  validateDoc,
  exists,
  loadCompliance,
  recordPolicySnapshot,
  currentSnapshot,
  evaluateFreshness,
  evaluateRules,
  decideCompliance,
  overrideDecision,
  markComplianceStale,
  checkDecisionFreshness,
  dagSpecsFor,
};
