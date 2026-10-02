"use strict";

/**
 * UNFOLDIQ Cross-source Verification (1G.1J, Prompt 03).
 *
 * Verifies over claims, sources, origin groups, and authority types.
 * Repeated agreement from derived copies is NEVER independent corroboration:
 * only distinct INDEPENDENT origin groups count. Search rank and fit
 * inclusion are discovery/relevance provenance and are ignored as evidence.
 * Primary/official evidence is preferred when materially relevant, but
 * official != automatically true: the record states what the source
 * establishes, with its position or limits intact.
 */

const { countIndependentGroups } = require("./independence.js");
const { EVIDENCE_POLICY_V1 } = require("./claim-ledger.js");

const PRIMARY_TYPES = new Set(["PRIMARY", "OFFICIAL"]);

function supportingGroups(claim, records) {
  const ids = (claim.supportingEvidence || []).map((e) => e.sourceId);
  const groups = new Set();
  for (const id of ids) {
    const r = (records || []).find((x) => x.sourceId === id);
    if (r && r.independenceStatus === "INDEPENDENT" && r.originGroup) groups.add(r.originGroup);
    else if (r && !r.originGroup) groups.add(`solo:${r.sourceId}`);
  }
  return groups;
}

function hasPrimarySupport(claim, records) {
  return (claim.supportingEvidence || []).some((e) => {
    const r = (records || []).find((x) => x.sourceId === e.sourceId);
    return r && PRIMARY_TYPES.has(r.sourceType);
  });
}

function hasIndependentContradiction(claim, records) {
  const supportGroups = supportingGroups(claim, records);
  return (claim.contradictingEvidence || []).some((e) => {
    const r = (records || []).find((x) => x.sourceId === e.sourceId);
    if (!r) return false;
    const g = r.originGroup || `solo:${r.sourceId}`;
    return !supportGroups.has(g);
  });
}

/**
 * Compute corroborationStatus for one claim (pure; caller writes it back).
 * Policy-aware: interpretive classes are not asked to prove truth by count.
 */
function verifyClaim(claim, context = {}) {
  const records = context.records || [];
  const policy = context.policy || EVIDENCE_POLICY_V1;
  const support = claim.supportingEvidence || [];
  const rationale = [];

  if (claim.evidenceStatus === "UNSUPPORTED" || support.length === 0) {
    return { corroborationStatus: "UNSUPPORTED", independentGroups: 0, rationale: "no supporting evidence" };
  }

  const groups = supportingGroups(claim, records);
  const n = groups.size;
  if (hasIndependentContradiction(claim, records)) {
    return { corroborationStatus: "CONFLICTED", independentGroups: n, rationale: "independent contradicting evidence exists alongside support; dispute must be framed, not flattened" };
  }
  if (policy.primaryCountsAsConfirmed && hasPrimarySupport(claim, records)) {
    rationale.push("primary/official support present");
    return { corroborationStatus: "PRIMARY_CONFIRMED", independentGroups: n, rationale: rationale.join("; ") };
  }
  if (n >= 2) {
    return { corroborationStatus: "MULTI_SOURCE_CONFIRMED", independentGroups: n, rationale: `${n} independent origin groups agree` };
  }
  return { corroborationStatus: "SINGLE_SOURCE", independentGroups: n, rationale: "one origin group behind all support" };
}

/** Run verification across the ledger; writes corroborationStatus back. */
function verifyLedger(ledger, records, context = {}) {
  const results = [];
  for (const claim of ledger.claims || []) {
    const v = verifyClaim(claim, { records, policy: context.policy });
    claim.corroborationStatus = v.corroborationStatus;
    results.push({ claimId: claim.claimId, ...v });
  }
  return results;
}

module.exports = {
  verifyClaim,
  verifyLedger,
  supportingGroups,
  hasPrimarySupport,
  countIndependentGroups,
};
