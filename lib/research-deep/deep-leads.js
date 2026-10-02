"use strict";

/**
 * UNFOLDIQ deep-lead processing (PHASE 1G.1 Prompt 05, §22-29).
 *
 * Permanent rule: DEEP RESULT -> LEADS, NOT TRUTH. Provider learnings,
 * report text, and citation syntax are discovery provenance. Nothing here
 * creates SUPPORTED_FACT / PRIMARY_CONFIRMED / MULTI_SOURCE_CONFIRMED /
 * SCRIPT_READY. Candidate URLs must be reacquired via Prompt 02 and enter
 * the same Prompt-03 Source Registry / Independence as STANDARD sources.
 */

const { normalizeUrlForDedupe } = require("../research-acquisition/search-provider.js");

function normalizeCandidateUrl(url) {
  try {
    return normalizeUrlForDedupe(url);
  } catch {
    return null;
  }
}

/** Provider citations + source URLs -> deduplicated candidate list. */
function candidateSourcesFromResult(result = {}) {
  const seen = new Map();
  const push = (url, title, context) => {
    const canonical = normalizeCandidateUrl(url);
    if (!canonical || seen.has(canonical)) return;
    seen.set(canonical, { url: canonical, rawUrl: url, title: title || null, context: context || null });
  };
  for (const c of result.candidateSources || []) push(c.url, c.title, c.context);
  for (const u of result.visitedUrls || []) push(u, null, "provider visited URL");
  for (const c of result.providerCitations || []) push(c, null, "provider citation");
  for (const l of result.learnings || []) {
    for (const u of l.sourceUrls || []) push(u, null, String(l.text || "").slice(0, 300));
  }
  return [...seen.values()];
}

/**
 * Provider-only claims (learning with no retrievable source) stay
 * unverified leads — never supported evidence (EB1).
 */
function classifyLearning(learning) {
  const urls = Array.isArray(learning.sourceUrls) ? learning.sourceUrls : [];
  if (urls.length === 0) {
    return { type: "UNVERIFIED_LEAD", usableAsEvidence: false, reason: "provider assertion with no retrievable source" };
  }
  return { type: "CANDIDATE_LINKED_LEAD", usableAsEvidence: false, reason: "candidate URL requires canonical acquisition first" };
}

/** Guard: the provider report is a diagnostic artifact, never a Pack entry. */
function assertReportNotPack(reportText) {
  if (typeof reportText === "string" && reportText.length > 0) return { isCanonicalEvidence: false, isResearchPack: false };
  return { isCanonicalEvidence: false, isResearchPack: false };
}

/** Scope-drift guard (§47): drop branches leaving goal/scope/class. */
function scopeDriftCheck(branch = {}, scope = {}) {
  const text = `${branch.query || ""} ${branch.topic || ""}`.toLowerCase();
  const outOfScope = (scope.excludedTerms || []).some((t) => t && text.includes(String(t).toLowerCase()));
  if (outOfScope) return { ok: false, code: "DEEP_SCOPE_DRIFT", message: "branch outside research scope; ignored" };
  return { ok: true };
}

module.exports = {
  normalizeCandidateUrl,
  candidateSourcesFromResult,
  classifyLearning,
  assertReportNotPack,
  scopeDriftCheck,
};
