"use strict";

/**
 * Phase 1G.11 — QA result validator (structural invariants, §44 rejects).
 * Pure logic. Complements schemas/asset-qa-result.schema.json.
 */

const shared = require("./shared.js");

const HEX64 = /^[0-9a-f]{64}$/;

function validateQaResult(result = {}) {
  const errors = [];
  const warnings = [];

  for (const f of ["qaResultId", "projectId", "assetId", "assetHash", "qaPolicyVersion", "expectedContextFingerprint"]) {
    if (typeof result[f] !== "string" || !result[f]) errors.push(`FIELD_REQUIRED: ${f}`);
  }
  if (result.assetHash && !HEX64.test(String(result.assetHash))) errors.push("ASSET_HASH_INVALID: sha256 hex required");
  if (result.qaPolicyVersion && result.qaPolicyVersion !== shared.QA_POLICY_VERSION) {
    warnings.push(`QA_POLICY_SUPERSEDED: result policy ${result.qaPolicyVersion} != current ${shared.QA_POLICY_VERSION}`);
  }

  for (const n of ["structural", "semantic", "factuality", "continuity"]) {
    const l = result[n];
    if (!l || typeof l !== "object") {
      errors.push(`LAYER_MISSING: ${n}`);
      continue;
    }
    if (!shared.LAYER_STATUS.includes(l.status)) errors.push(`LAYER_STATUS_INVALID: ${n}.${l.status}`);
    if (!shared.SEVERITY.includes(l.severity)) errors.push(`LAYER_SEVERITY_INVALID: ${n}.${l.severity}`);
  }

  const agg = result.aggregate || {};
  if (!shared.GATE_STATUS.includes(agg.status)) errors.push(`AGGREGATE_STATUS_INVALID: ${agg.status}`);
  if (typeof agg.timelineEligible !== "boolean") errors.push("FIELD_REQUIRED: aggregate.timelineEligible must be boolean");

  // §44 rejects.
  const failedBlockers = ["structural", "semantic", "factuality", "continuity"].filter((n) => {
    const l = result[n];
    return l && l.status === "FAIL" && l.severity !== "WARNING";
  });
  if (agg.timelineEligible === true && failedBlockers.length > 0) {
    errors.push(`TIMELINE_GATE_VIOLATION: timelineEligible=true with blocker FAIL in ${failedBlockers.join(",")}`);
  }
  const criticalUnknown = ["structural", "semantic", "factuality", "continuity"].filter((n) => {
    const l = result[n];
    return l && l.status === "UNKNOWN" && l.blocking === true;
  });
  if (agg.timelineEligible === true && criticalUnknown.length > 0) {
    errors.push(`TIMELINE_GATE_VIOLATION: timelineEligible=true with critical UNKNOWN in ${criticalUnknown.join(",")}`);
  }
  if (result.factuality && result.factuality.status === "PASS") {
    const hasProv = Array.isArray(result.evidenceRefs) && result.evidenceRefs.length > 0;
    const hasClaim = result.expectationSnapshot && result.expectationSnapshot.claimEvidenceVersion;
    if (!hasProv && !hasClaim) errors.push("FACTUAL_PROVENANCE_MISSING: factual PASS without claim/evidence provenance");
  }
  const evIds = new Set();
  for (const e of result.evidence || []) {
    if (!e || !e.evidenceId) {
      errors.push("EVIDENCE_ID_MISSING");
      break;
    }
    if (evIds.has(e.evidenceId)) {
      errors.push(`EVIDENCE_ID_DUPLICATE: ${e.evidenceId}`);
      break;
    }
    evIds.add(e.evidenceId);
  }

  return { valid: errors.length === 0, errors, warnings };
}

module.exports = { validateQaResult };
