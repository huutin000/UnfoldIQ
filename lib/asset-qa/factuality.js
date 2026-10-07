"use strict";

/**
 * Phase 1G.11 — visual factuality QA layer.
 * Applies only when appropriate (FACTUAL required / HYBRID claims-only /
 * FICTION N/A / UNKNOWN review). Expectations come ONLY from canonical
 * claim/evidence artifacts. Every Roadmap factual domain is representable.
 * Unobservable values are UNKNOWN, never PASS; factual PASS requires
 * claim/evidence provenance.
 */

const shared = require("./shared.js");

const DOMAINS = [
  "period",
  "location",
  "speciesPersonObject",
  "clothing",
  "architecture",
  "toolsEquipment",
  "mapGeography",
  "chartDirection",
  "numbersLabels",
  "timelineOrder",
  "onScreenFactualText",
];

/**
 * evaluateFactuality({ contentClass, expectation?, observations? })
 * expectation: { expectationId?, shotId?, claimIds[]?, evidenceIds[]?,
 *   period?, location?, speciesPersonObject[]?, clothing[]?, architecture[]?,
 *   toolsEquipment[]?, mapGeography?, chartDirection?, numbersLabels[]?,
 *   timelineOrder[]?, onScreenFactualText[]?, hasFactualElements? }
 * observations: { <domain>: { observed?, match?: bool|null, confidence?,
 *   source? } }
 */
function evaluateFactuality(input = {}) {
  const checks = [];
  const evidence = [];
  const reasons = [];
  let fail = 0;
  let unkCritical = 0;
  const cls = input.contentClass || "UNKNOWN";
  const exp = input.expectation || {};
  const obs = input.observations || {};
  const hasProvenance = Array.isArray(exp.claimIds) && exp.claimIds.length > 0
    && Array.isArray(exp.evidenceIds) && exp.evidenceIds.length > 0;

  function push(domain, status, severity, reason, blocking, evExtra) {
    checks.push(shared.checkEntry(domain, status, severity, reason, blocking));
    if (status === "FAIL") fail++;
    if (status === "UNKNOWN" && blocking) unkCritical++;
    if (reason && (status === "FAIL" || (status === "UNKNOWN" && blocking))) reasons.push(`${domain}: ${reason}`);
    if (evExtra) evidence.push(evExtra);
  }

  function ev(domain, expected, observed, comparison, confidence, source) {
    return shared.makeEvidence({ layer: "factuality", check: domain, source: source || "STRUCTURED_OBSERVATION", expected, observed, comparison, confidence });
  }

  // Applicability gate.
  if (cls === "FICTION" && !exp.hasFactualElements) {
    for (const d of DOMAINS) checks.push(shared.checkEntry(d, "NOT_APPLICABLE", "INFO", "FICTION without factual elements", false));
    return shared.layerResult({ status: "NOT_APPLICABLE", severity: "INFO", blocking: false, checks, evidence, reasons });
  }
  if (cls === "UNKNOWN") {
    for (const d of DOMAINS) checks.push(shared.checkEntry(d, "UNKNOWN", "ERROR", "content class UNKNOWN; factual applicability undecidable (REVIEW_REQUIRED)", true));
    return shared.layerResult({ status: "UNKNOWN", severity: "ERROR", blocking: true, checks, evidence, reasons: ["factuality: content class UNKNOWN → REVIEW_REQUIRED"] });
  }
  if (cls === "HYBRID" && (!Array.isArray(exp.claimIds) || exp.claimIds.length === 0)) {
    for (const d of DOMAINS) checks.push(shared.checkEntry(d, "NOT_APPLICABLE", "INFO", "HYBRID shot carries no factual assertions", false));
    return shared.layerResult({ status: "NOT_APPLICABLE", severity: "INFO", blocking: false, checks, evidence, reasons });
  }

  const applicable = DOMAINS.filter((d) => exp[d] !== undefined && exp[d] !== null);
  if (applicable.length === 0) {
    for (const d of DOMAINS) checks.push(shared.checkEntry(d, "NOT_APPLICABLE", "INFO", "no factual expectation for this domain", false));
    return shared.layerResult({ status: "NOT_APPLICABLE", severity: "INFO", blocking: false, checks, evidence, reasons });
  }

  for (const d of DOMAINS) {
    const expected = exp[d];
    if (expected === undefined || expected === null) {
      checks.push(shared.checkEntry(d, "NOT_APPLICABLE", "INFO", "no factual expectation for this domain", false));
      continue;
    }
    const o = obs[d] || null;
    if (!o || o.match === undefined || o.match === null) {
      push(d, "UNKNOWN", "ERROR", `expected ${JSON.stringify(expected)}; observation unavailable (REVIEW_REQUIRED)`, true,
        ev(d, expected, o ? o.observed : null, "unobservable", o ? o.confidence : null, o && o.source));
      continue;
    }
    if (o.match === true) {
      if (!hasProvenance) {
        // Factual PASS without claim/evidence provenance is rejected.
        push(d, "UNKNOWN", "ERROR", "apparent match but no claim/evidence provenance; cannot certify", true,
          ev(d, expected, o.observed, "unprovenanced", o.confidence, o.source));
      } else {
        push(d, "PASS", "INFO", null, false, ev(d, expected, o.observed, "match", o.confidence, o.source));
      }
    } else {
      push(d, "FAIL", "BLOCKER", `expected ${JSON.stringify(expected)} but observed ${JSON.stringify(o.observed)}`, true,
        ev(d, expected, o.observed, "mismatch", o.confidence, o.source));
    }
  }

  const status = fail > 0 ? "FAIL" : unkCritical > 0 ? "UNKNOWN" : "PASS";
  return shared.layerResult({
    status,
    severity: fail > 0 ? "BLOCKER" : unkCritical > 0 ? "ERROR" : "INFO",
    blocking: fail > 0 || unkCritical > 0,
    checks,
    evidence,
    reasons,
  });
}

module.exports = { DOMAINS, evaluateFactuality };
