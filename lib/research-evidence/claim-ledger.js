"use strict";

/**
 * UNFOLDIQ Claim / Evidence Ledger (1G.1I, Prompt 03).
 *
 * Structured evidence state, not prose. Three axes stay separate (canonical
 * brief enums): claimClass (what kind of statement), evidenceStatus (how
 * strong), corroborationStatus (how independently corroborated — written by
 * verification, never hand-set on insert).
 *
 * Risk-aware strictness lives in the evidence policy (versioned): high-impact
 * claims need stronger support; minor official-primary facts do not need a
 * redundant second copy. No universal two-source rule.
 */

const crypto = require("crypto");
const { CLAIM_CLASSES, EVIDENCE_STATUSES } = require("./analysis-exchange.js");

const CORROBORATION = ["PRIMARY_CONFIRMED", "MULTI_SOURCE_CONFIRMED", "SINGLE_SOURCE", "CONFLICTED", "UNSUPPORTED"];
const MATERIALITIES = ["critical", "high", "medium", "low"];

// Evidence policy v1: minimum corroboration per materiality for factual
// claim classes. Interpretive classes (HYPOTHESIS etc.) are handled with
// caveats downstream and never demand multi-source proof of truth.
const EVIDENCE_POLICY_V1 = {
  version: "evidence-policy-1.0.0",
  minGroups: { critical: 2, high: 2, medium: 1, low: 1 },
  primaryCountsAsConfirmed: true,
};

function claimIdFor(claimText, questionIds) {
  const seed = `${claimText.trim().toLowerCase()}|${[...(questionIds || [])].sort().join(",")}`;
  return `clm-${crypto.createHash("sha256").update(seed, "utf8").digest("hex").slice(0, 12)}`;
}

function emptyLedger() {
  return { version: "1.0.0", claims: [] };
}

function validateCandidate(candidate) {
  const errors = [];
  if (!candidate || typeof candidate !== "object") return ["candidate must be an object"];
  if (typeof candidate.claim !== "string" || !candidate.claim.trim()) errors.push("claim text required");
  if (!CLAIM_CLASSES.includes(candidate.claimClass)) errors.push(`bad claimClass ${candidate.claimClass}`);
  if (!EVIDENCE_STATUSES.includes(candidate.evidenceStatus)) errors.push(`bad evidenceStatus ${candidate.evidenceStatus}`);
  if (!MATERIALITIES.includes(candidate.materiality)) errors.push(`bad materiality ${candidate.materiality}`);
  for (const ev of candidate.evidence || []) {
    if (!ev.sourceId || !ev.contentHash) errors.push("evidence link needs sourceId + contentHash");
    if (typeof ev.excerpt !== "string" || !ev.excerpt) errors.push("evidence link needs a short excerpt");
    if (ev.excerpt && ev.excerpt.length > 280) errors.push("evidence excerpt exceeds 280 chars");
  }
  return errors;
}

/**
 * Insert (idempotent by stable claimId) or attach further evidence to an
 * existing claim. Evidence must reference known sourceId + contentHash
 * versions; broken links are rejected, never stored dangling.
 */
function upsertClaim(ledger, candidate, sourceIndex) {
  const errors = validateCandidate(candidate);
  if (errors.length > 0) {
    return { ok: false, code: "CLAIM_INVALID", message: errors.join("; ") };
  }
  const knownSources = new Map((sourceIndex.sources || []).map((s) => [s.sourceId, s]));
  for (const ev of candidate.evidence || []) {
    const rec = knownSources.get(ev.sourceId);
    if (!rec) {
      return { ok: false, code: "EVIDENCE_LINK_BROKEN", message: `unknown sourceId ${ev.sourceId}` };
    }
    const versionKnown = (rec.versions || []).some((v) => v.contentHash === ev.contentHash);
    if (!versionKnown) {
      return { ok: false, code: "EVIDENCE_LINK_BROKEN", message: `source ${ev.sourceId} has no version ${ev.contentHash}` };
    }
  }
  const id = claimIdFor(candidate.claim, candidate.researchQuestionIds);
  let record = (ledger.claims || []).find((c) => c.claimId === id);
  if (!record) {
    record = {
      claimId: id,
      researchQuestionIds: [...(candidate.researchQuestionIds || [])],
      claim: candidate.claim.trim(),
      claimClass: candidate.claimClass,
      evidenceStatus: candidate.evidenceStatus,
      corroborationStatus: "UNSUPPORTED",
      supportingEvidence: [],
      contradictingEvidence: [],
      confidenceReason: candidate.confidenceReason || "",
      materiality: candidate.materiality,
      needsReevaluation: false,
      createdAt: new Date().toISOString(),
    };
    ledger.claims.push(record);
  }
  for (const ev of candidate.evidence || []) {
    const dup = record.supportingEvidence.some((e) => e.sourceId === ev.sourceId && e.contentHash === ev.contentHash);
    if (!dup) {
      record.supportingEvidence.push({
        sourceId: ev.sourceId,
        contentHash: ev.contentHash,
        locator: ev.locator || null,
        excerpt: ev.excerpt,
      });
    }
  }
  return { ok: true, record, created: record.supportingEvidence.length === candidate.evidence.length };
}

/** Mark dependent claims for re-evaluation when a source version changes. */
function markStaleOnSourceChange(ledger, sourceId, newHash) {
  let marked = 0;
  for (const claim of ledger.claims || []) {
    const linked = [...(claim.supportingEvidence || []), ...(claim.contradictingEvidence || [])];
    const affected = linked.some((e) => e.sourceId === sourceId && e.contentHash !== newHash);
    if (affected && !claim.needsReevaluation) {
      claim.needsReevaluation = true;
      marked++;
    }
  }
  return { marked };
}

/** Claims whose linked question is answered by adequate evidence (for sufficiency). */
function questionCoverage(ledger, questionId) {
  const linked = (ledger.claims || []).filter((c) => (c.researchQuestionIds || []).includes(questionId));
  const adequate = linked.filter((c) =>
    !c.needsReevaluation &&
    (c.evidenceStatus === "SUPPORTED" || c.evidenceStatus === "MIXED") &&
    (c.supportingEvidence || []).length > 0
  );
  return { linked: linked.length, adequate: adequate.length, claims: adequate.map((c) => c.claimId) };
}

module.exports = {
  CORROBORATION,
  MATERIALITIES,
  EVIDENCE_POLICY_V1,
  claimIdFor,
  emptyLedger,
  upsertClaim,
  markStaleOnSourceChange,
  questionCoverage,
};
