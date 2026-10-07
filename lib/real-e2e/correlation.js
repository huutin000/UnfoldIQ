"use strict";

/**
 * Phase 1G.12 hardening (Task 02, §5.5 + A-9): correlation gate.
 * A provider-result correlation record may only support a READY verdict when
 * it carries enough machine-checkable identity that ambiguity can never
 * silently become READY. Operator attribution alone is not sufficient.
 *
 * Required: attemptId, sha256 (64-hex, must match the downloaded bytes),
 * correlationMethod (known method), providerProjectRef, non-empty evidence[].
 * Optional: expectedSha256 — when supplied, the record sha must equal it
 * (download-byte match); mismatch is CORRELATION_SHA_MISMATCH, not READY.
 */

const KNOWN_METHODS = [
  "SINGLE_GENERATION_ATTRIBUTION",
  "FILENAME_FINGERPRINT_PLUS_TIMING",
  "PROVIDER_RESULT_ID",
];

function checkCorrelationForReady(record, opts = {}) {
  const reasons = [];
  if (!record || typeof record !== "object") {
    return { ok: false, code: "CORRELATION_MISSING", reasons: ["no correlation record"] };
  }
  if (typeof record.attemptId !== "string" || !record.attemptId) {
    reasons.push("CORRELATION_AMBIGUOUS_ATTEMPT: attemptId missing");
  }
  if (typeof record.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(record.sha256)) {
    reasons.push("CORRELATION_AMBIGUOUS_HASH: sha256 missing or not 64-hex");
  }
  if (!KNOWN_METHODS.includes(record.correlationMethod)) {
    reasons.push(`CORRELATION_AMBIGUOUS_METHOD: ${record.correlationMethod || "missing"} is not a known method`);
  }
  if (typeof record.providerProjectRef !== "string" || !record.providerProjectRef) {
    reasons.push("CORRELATION_AMBIGUOUS_PROJECT: providerProjectRef missing");
  }
  if (!Array.isArray(record.evidence) || record.evidence.length === 0) {
    reasons.push("CORRELATION_AMBIGUOUS_EVIDENCE: evidence[] empty");
  }
  if (opts.expectedSha256 && record.sha256 !== opts.expectedSha256) {
    return { ok: false, code: "CORRELATION_SHA_MISMATCH", reasons: [`record sha ${record.sha256} != downloaded bytes sha ${opts.expectedSha256}`] };
  }
  if (reasons.length > 0) return { ok: false, code: "CORRELATION_AMBIGUOUS", reasons };
  return { ok: true, reasons: [`correlated ${record.attemptId} via ${record.correlationMethod}`] };
}

module.exports = { KNOWN_METHODS, checkCorrelationForReady };
