"use strict";

/**
 * Golden regression runner for script QA. A case is a few scenes plus either
 * the finding codes the engine MUST raise (NEGATIVE), codes it must NOT raise
 * (POSITIVE, false-positive guard) or a documented limitation
 * (KNOWN_FALSE_NEGATIVE: an error no deterministic rule can see; it must stay
 * unflagged and is reported as an editorial-only class).
 */

const { deterministic } = require("./index.js");

function runGolden(cases, ledger, options = {}) {
  const results = cases.map((c) => {
    const found = [...new Set(deterministic(c.scenes, ledger, options).map((f) => f.code))];
    let pass;
    let missing = [];
    let unexpected = [];
    if (c.kind === "NEGATIVE") {
      missing = (c.expect || []).filter((code) => !found.includes(code));
      pass = missing.length === 0;
    } else if (c.kind === "POSITIVE") {
      unexpected = (c.absent || []).filter((code) => found.includes(code));
      pass = unexpected.length === 0;
    } else {
      // KNOWN_FALSE_NEGATIVE: documents that the deterministic layer is blind here
      pass = !found.some((code) => /^(FORBIDDEN|CAUSAL|MISSING_CAVEAT|NUMBER_NOT)/.test(code));
    }
    return { id: c.id, origin: c.origin, kind: c.kind, pass, found, missing, unexpected, basis: c.basis };
  });
  const neg = results.filter((r) => r.kind === "NEGATIVE");
  const pos = results.filter((r) => r.kind === "POSITIVE");
  return {
    results,
    summary: {
      cases: results.length,
      passed: results.filter((r) => r.pass).length,
      negativeDetected: neg.filter((r) => r.pass).length + "/" + neg.length,
      falseNegatives: neg.filter((r) => !r.pass).map((r) => r.id),
      falsePositives: pos.filter((r) => !r.pass).map((r) => r.id),
      knownFalseNegatives: results.filter((r) => r.kind === "KNOWN_FALSE_NEGATIVE").map((r) => r.id),
      allPassed: results.every((r) => r.pass),
    },
  };
}

module.exports = { runGolden };
