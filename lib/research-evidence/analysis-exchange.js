"use strict";

/**
 * UNFOLDIQ Research Analysis exchange (1G.1I boundary, Prompt 03).
 *
 * If candidate-claim extraction needs reasoning, it crosses this boundary:
 *   ResearchAnalysisRequest (bounded excerpts + questions)
 *     -> Analysis Provider / agent exchange (OpenCode / Antigravity / model)
 *     -> structured candidate claims
 *     -> deterministic validation (this module)
 *
 * Changing the agent/model never changes the ledger schema. Free-form prose
 * alone never passes: every candidate is schema- + semantic-validated.
 * Token discipline: fit excerpt when adequate, raw fallback when fit is
 * weak/empty (never a false UNSUPPORTED from an empty fit), bounded sections,
 * always traceable to the raw source version.
 */

const crypto = require("crypto");

const CLAIM_CLASSES = ["DIRECT_EVIDENCE", "SUPPORTED_FACT", "SCHOLARLY_INTERPRETATION", "HYPOTHESIS", "CONTESTED", "UNVERIFIED"];
const EVIDENCE_STATUSES = ["SUPPORTED", "MIXED", "WEAK", "UNSUPPORTED"];
const MATERIALITIES = ["critical", "high", "medium", "low"];
const MAX_EXCERPT_CHARS = 4000;
const MAX_EVIDENCE_EXCERPT = 280;

function err(code, message, path) {
  return { code, path: path || "", message, severity: "ERROR" };
}

/**
 * Build a bounded analysis request from a source version. fitContent is the
 * relevance aid; rawContent is the canonical fallback. Returns the excerpt
 * actually sent plus its provenance.
 */
function createAnalysisRequest(input = {}) {
  const sourceId = input.sourceId;
  const contentHash = input.contentHash;
  if (typeof sourceId !== "string" || !sourceId) {
    return { ok: false, code: "INVALID_ANALYSIS_REQUEST", message: "sourceId is required" };
  }
  if (typeof contentHash !== "string" || !contentHash) {
    return { ok: false, code: "INVALID_ANALYSIS_REQUEST", message: "contentHash is required" };
  }
  const raw = typeof input.rawContent === "string" ? input.rawContent : "";
  const fit = typeof input.fitContent === "string" ? input.fitContent : "";
  const fitAdequate = fit.trim().length >= 200;
  const chosen = fitAdequate ? fit : raw;
  const excerpt = chosen.slice(0, MAX_EXCERPT_CHARS);
  return {
    ok: true,
    request: {
      requestId: `anr-${crypto.randomBytes(4).toString("hex")}`,
      sourceId,
      contentHash,
      researchQuestionIds: Array.isArray(input.researchQuestionIds) ? input.researchQuestionIds : [],
      excerpt,
      excerptScope: fitAdequate ? "fitMarkdown" : "rawMarkdown",
      excerptTruncated: chosen.length > MAX_EXCERPT_CHARS,
      fitWeakFallback: !fitAdequate,
      createdAt: new Date().toISOString(),
    },
  };
}

/**
 * Validate agent/model-supplied candidate claims. Each candidate:
 * { claim, claimClass, evidenceStatus, materiality, researchQuestionIds?,
 *   locator?, excerpt?, confidenceReason? }. Excerpts are bounded; the source
 * reference comes from the request (not from model prose).
 */
function normalizeAnalysisResponse(request, rawCandidates) {
  if (!request || typeof request.sourceId !== "string") {
    return { ok: false, code: "INVALID_ANALYSIS_REQUEST", message: "request carries no sourceId" };
  }
  if (!Array.isArray(rawCandidates)) {
    return { ok: false, code: "ANALYSIS_PROVIDER_UNAVAILABLE", message: "analysis response must be an array of candidate claims" };
  }
  const candidates = [];
  const rejected = [];
  rawCandidates.forEach((raw, index) => {
    const c = raw && typeof raw === "object" ? raw : {};
    const errors = [];
    if (typeof c.claim !== "string" || !c.claim.trim()) errors.push(err("CLAIM_INVALID", "candidate claim text required", `[${index}].claim`));
    if (!CLAIM_CLASSES.includes(c.claimClass)) errors.push(err("CLAIM_INVALID", `claimClass must be one of ${CLAIM_CLASSES.join("|")}`, `[${index}].claimClass`));
    if (!EVIDENCE_STATUSES.includes(c.evidenceStatus)) errors.push(err("CLAIM_INVALID", `evidenceStatus must be one of ${EVIDENCE_STATUSES.join("|")}`, `[${index}].evidenceStatus`));
    if (!MATERIALITIES.includes(c.materiality)) errors.push(err("CLAIM_INVALID", `materiality must be one of ${MATERIALITIES.join("|")}`, `[${index}].materiality`));
    if (errors.length > 0) {
      rejected.push({ index, errors });
      return;
    }
    candidates.push({
      claim: c.claim.trim(),
      claimClass: c.claimClass,
      evidenceStatus: c.evidenceStatus,
      materiality: c.materiality,
      researchQuestionIds: Array.isArray(c.researchQuestionIds) ? c.researchQuestionIds.filter((q) => typeof q === "string") : [...request.researchQuestionIds],
      evidence: [{
        sourceId: request.sourceId,
        contentHash: request.contentHash,
        locator: typeof c.locator === "string" && c.locator ? c.locator.slice(0, 200) : null,
        excerpt: typeof c.excerpt === "string" && c.excerpt.trim()
          ? c.excerpt.trim().slice(0, MAX_EVIDENCE_EXCERPT)
          : request.excerpt.slice(0, MAX_EVIDENCE_EXCERPT),
      }],
      confidenceReason: typeof c.confidenceReason === "string" ? c.confidenceReason.slice(0, 500) : "",
    });
  });
  return { ok: true, candidates, rejected };
}

module.exports = {
  CLAIM_CLASSES,
  EVIDENCE_STATUSES,
  MATERIALITIES,
  MAX_EXCERPT_CHARS,
  MAX_EVIDENCE_EXCERPT,
  createAnalysisRequest,
  normalizeAnalysisResponse,
};
