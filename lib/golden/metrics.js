"use strict";

/**
 * Phase 1H.5 — metric catalog: direction + method + regression policy.
 * Every metric declares HOW it is judged so inverted logic is impossible.
 * Tolerances are V1 product decisions on a single baseline (documented per
 * metric as `toleranceSource`); tighten after N>=3 baselines. Never invent
 * silent 95%: hard invariants fail, judgment goes to human review.
 */

const DIRECTIONS = ["HIGHER_IS_BETTER", "LOWER_IS_BETTER", "TARGET_RANGE", "BOOLEAN_PASS", "CATEGORICAL"];
const METHODS = ["DETERMINISTIC", "JUDGMENT"];
const ON_REGRESSION = ["FAIL", "REVIEW_REQUIRED"];

// appliesTo: content classes where the metric is meaningful. Empty = all.
const METRICS = {
  aspectCorrectness: { direction: "CATEGORICAL", method: "DETERMINISTIC", onRegression: "FAIL", appliesTo: [], hardInvariant: true, toleranceSource: "roadmap contract: wrong aspect is never acceptable" },
  continuity: { direction: "CATEGORICAL", method: "DETERMINISTIC", onRegression: "FAIL", appliesTo: [], hardInvariant: true, toleranceSource: "roadmap contract: continuity contract failure fails" },
  unsupportedFactualClaims: { direction: "LOWER_IS_BETTER", method: "DETERMINISTIC", onRegression: "FAIL", appliesTo: ["FACTUAL", "HYBRID"], hardInvariant: true, tolerance: { type: "ABS", value: 0 }, toleranceSource: "roadmap: increase beyond 0 fails (tolerance 0 = hard invariant)" },
  sourceCoverage: { direction: "HIGHER_IS_BETTER", method: "DETERMINISTIC", onRegression: "REVIEW_REQUIRED", appliesTo: ["FACTUAL", "HYBRID"], tolerance: { type: "ABS", value: 0.1 }, toleranceSource: "V1 product decision on a single baseline; tighten after N>=3 baselines" },
  evidenceFidelity: { direction: "HIGHER_IS_BETTER", method: "JUDGMENT", onRegression: "REVIEW_REQUIRED", appliesTo: ["FACTUAL", "HYBRID"], toleranceSource: "judgment: reviewer decides per evidence refs" },
  scriptNaturalness: { direction: "HIGHER_IS_BETTER", method: "JUDGMENT", onRegression: "REVIEW_REQUIRED", appliesTo: [], toleranceSource: "judgment: small differences review, never auto-fail (§30)" },
  promptAdherence: { direction: "CATEGORICAL", method: "DETERMINISTIC", onRegression: "FAIL", appliesTo: [], hardInvariant: true, toleranceSource: "tuple-conformance evidence: mismatch fails" },
  failureRate: { direction: "LOWER_IS_BETTER", method: "DETERMINISTIC", onRegression: "FAIL", appliesTo: [], tolerance: { type: "REL", value: 0.5 }, toleranceSource: "V1 relative regression budget (+50%); hard-fail protects the invariant" },
  generationTime: { direction: "LOWER_IS_BETTER", method: "DETERMINISTIC", onRegression: "REVIEW_REQUIRED", appliesTo: [], tolerance: { type: "REL", value: 0.5 }, toleranceSource: "V1 product decision: small variance reviews (§30)" },
  renderTime: { direction: "LOWER_IS_BETTER", method: "DETERMINISTIC", onRegression: "REVIEW_REQUIRED", appliesTo: [], tolerance: { type: "REL", value: 0.5 }, toleranceSource: "V1 product decision: small variance reviews (§30)" },
  cost: { direction: "LOWER_IS_BETTER", method: "DETERMINISTIC", onRegression: "REVIEW_REQUIRED", appliesTo: [], tolerance: { type: "REL", value: 0.25 }, toleranceSource: "V1 relative budget (+25%); exceeding a declared hardBudget FAILs separately" },
  speechRate: { direction: "TARGET_RANGE", method: "DETERMINISTIC", onRegression: "REVIEW_REQUIRED", appliesTo: [], range: [120, 180], toleranceSource: "V1 product decision: common narration band wpm; reviewable" },
  pronunciation: { direction: "HIGHER_IS_BETTER", method: "JUDGMENT", onRegression: "REVIEW_REQUIRED", appliesTo: [], toleranceSource: "judgment: reviewer + samples" },
  captionSync: { direction: "CATEGORICAL", method: "DETERMINISTIC", onRegression: "FAIL", appliesTo: [], hardInvariant: true, toleranceSource: "cue overlap/out-of-bounds is never acceptable" },
  captionFlicker: { direction: "LOWER_IS_BETTER", method: "JUDGMENT", onRegression: "REVIEW_REQUIRED", appliesTo: [], toleranceSource: "judgment: needs rendered frames + reviewer" },
  visualFactuality: { direction: "HIGHER_IS_BETTER", method: "JUDGMENT", onRegression: "REVIEW_REQUIRED", appliesTo: ["FACTUAL", "HYBRID"], toleranceSource: "judgment: visual nuance needs reviewer" },
  avSemanticAlignment: { direction: "HIGHER_IS_BETTER", method: "JUDGMENT", onRegression: "REVIEW_REQUIRED", appliesTo: [], toleranceSource: "judgment: A/V semantic quality needs reviewer" },
  originality: { direction: "LOWER_IS_BETTER", method: "DETERMINISTIC", onRegression: "REVIEW_REQUIRED", appliesTo: [], tolerance: { type: "ABS", value: 0.1 }, toleranceSource: "V1 product decision: repetition-rate proxy; consistency never punished, threshold reviews only" },
  // Phase 2.1 Voice Bible contract. These are hard invariants on voice
  // IDENTITY + governance, not judged audio quality (speechRate/pronunciation
  // stay NOT_MEASURED until 2.4 measures real synthesis).
  schemaStability: { direction: "BOOLEAN_PASS", method: "DETERMINISTIC", onRegression: "FAIL", appliesTo: [], hardInvariant: true, toleranceSource: "roadmap contract: a Voice Bible that does not validate is never usable" },
  versionImmutability: { direction: "BOOLEAN_PASS", method: "DETERMINISTIC", onRegression: "FAIL", appliesTo: [], hardInvariant: true, toleranceSource: "roadmap contract: voice bible versions are immutable; a rewrite in place is corruption" },
  voiceIdentity: { direction: "CATEGORICAL", method: "DETERMINISTIC", onRegression: "FAIL", appliesTo: [], hardInvariant: true, toleranceSource: "provider/model/voiceId tuple conformance: mismatch fails, never substitutes a voice" },
  personaStability: { direction: "BOOLEAN_PASS", method: "DETERMINISTIC", onRegression: "FAIL", appliesTo: [], hardInvariant: true, toleranceSource: "roadmap contract: the narrator persona must stay semantically stable across revisions" },
  languageCompatibility: { direction: "CATEGORICAL", method: "DETERMINISTIC", onRegression: "FAIL", appliesTo: [], hardInvariant: true, toleranceSource: "roadmap contract: a voice is never synthesized in an unsupported language" },
  // Named credentialSafety (not secretSafety): the golden doc secret scanner
  // rejects any key matching /secret/i, and a metric key must not be an
  // exception to a security control.
  credentialSafety: { direction: "BOOLEAN_PASS", method: "DETERMINISTIC", onRegression: "FAIL", appliesTo: [], hardInvariant: true, toleranceSource: "roadmap contract: provider credentials must never reach a persisted artifact" },
  dagInvalidation: { direction: "CATEGORICAL", method: "DETERMINISTIC", onRegression: "FAIL", appliesTo: [], hardInvariant: true, toleranceSource: "roadmap contract: a voice revision dirties exactly the dependent audio branch" },
  // Phase 2.2 + 2.3 pre-TTS contract. Hard invariants on direction sparsity
  // and runtime honesty, not judged audio quality (pronunciation stays a
  // judgment metric for Phase 2.4 synthesis).
  directionSparsity: { direction: "BOOLEAN_PASS", method: "DETERMINISTIC", onRegression: "FAIL", appliesTo: [], hardInvariant: true, toleranceSource: "roadmap contract: neutral segments inherit Voice Bible defaults; over-direction is measured, never rewarded" },
  pronunciationRuntime: { direction: "CATEGORICAL", method: "DETERMINISTIC", onRegression: "FAIL", appliesTo: [], hardInvariant: true, toleranceSource: "roadmap contract: pronunciation override application must be proven at the real configured runtime, never fabricated" },
};

function metricDef(key) {
  return METRICS[key] || null;
}

function validateMetricValue(key, mv, contentClass) {
  const def = metricDef(key);
  if (!def) return { ok: false, code: "METRIC_NOT_DEFINED", message: `unknown metric ${key}` };
  if (!mv || typeof mv !== "object") return { ok: false, code: "METRIC_NOT_DEFINED", message: `metric ${key} needs an object value` };
  if (!["MEASURED", "NOT_APPLICABLE", "NOT_MEASURED"].includes(mv.status)) {
    return { ok: false, code: "METRIC_NOT_DEFINED", message: `metric ${key} status must be MEASURED|NOT_APPLICABLE|NOT_MEASURED` };
  }
  if (mv.status !== "MEASURED") {
    if (typeof mv.reason !== "string" || !mv.reason) {
      return { ok: false, code: "METRIC_NOT_DEFINED", message: `metric ${key} ${mv.status} needs a reason` };
    }
    return { ok: true };
  }
  if (mv.value === undefined || mv.value === null) {
    return { ok: false, code: "METRIC_NOT_DEFINED", message: `metric ${key} MEASURED needs a value` };
  }
  if (def.appliesTo.length > 0 && contentClass && !def.appliesTo.includes(contentClass)) {
    return { ok: false, code: "METRIC_NOT_APPLICABLE", message: `metric ${key} does not apply to ${contentClass} (factual rules never govern pure FICTION)` };
  }
  if (def.method === "JUDGMENT") {
    for (const f of ["method", "reviewer", "confidence"]) {
      if (typeof mv[f] !== "string" || !mv[f]) {
        return { ok: false, code: "METRIC_NOT_DEFINED", message: `judgment metric ${key} needs ${f} (no subjective review as deterministic truth)` };
      }
    }
    if (!Array.isArray(mv.evidenceRefs) || mv.evidenceRefs.length === 0) {
      return { ok: false, code: "METRIC_NOT_DEFINED", message: `judgment metric ${key} needs evidenceRefs` };
    }
  }
  return { ok: true };
}

function numDelta(direction, base, cand) {
  if (typeof base !== "number" || typeof cand !== "number") return null;
  return cand - base;
}

/**
 * Compare one MEASURED-vs-MEASURED metric. Returns
 * { verdict: PASS|FAIL|REVIEW_REQUIRED, delta?, reason }.
 */
function compareMetric(key, base, cand) {
  const def = metricDef(key);
  if (def.direction === "CATEGORICAL" || def.direction === "BOOLEAN_PASS") {
    if (JSON.stringify(base) === JSON.stringify(cand)) return { verdict: "PASS", reason: "unchanged" };
    return { verdict: def.onRegression, reason: `changed ${JSON.stringify(base)} → ${JSON.stringify(cand)}` };
  }
  if (def.direction === "TARGET_RANGE") {
    const [lo, hi] = def.range;
    const inRange = typeof cand === "number" && cand >= lo && cand <= hi;
    if (inRange) return { verdict: "PASS", delta: numDelta(def.direction, base, cand), reason: `in range [${lo},${hi}]` };
    return { verdict: def.onRegression, delta: numDelta(def.direction, base, cand), reason: `outside range [${lo},${hi}]` };
  }
  const delta = numDelta(def.direction, base, cand);
  if (delta === null) {
    return { verdict: "REVIEW_REQUIRED", reason: "non-numeric values need human comparison" };
  }
  const better = def.direction === "HIGHER_IS_BETTER" ? delta > 0 : delta < 0;
  const worse = def.direction === "HIGHER_IS_BETTER" ? delta < 0 : delta > 0;
  if (delta === 0) return { verdict: "PASS", delta, reason: "identical" };
  if (better) {
    return { verdict: "PASS", delta, reason: "improvement" };
  }
  if (worse) {
    const tol = def.tolerance || { type: "ABS", value: 0 };
    const within = tol.type === "ABS" ? Math.abs(delta) <= tol.value : (base !== 0 && Math.abs(delta / base) <= tol.value);
    if (within && !def.hardInvariant) {
      return { verdict: "PASS", delta, reason: `within tolerance ${tol.type} ${tol.value}` };
    }
    return { verdict: def.onRegression, delta, reason: `regression beyond tolerance ${tol.type} ${tol.value}` };
  }
  return { verdict: "PASS", delta, reason: "no change" };
}

module.exports = { DIRECTIONS, METHODS, ON_REGRESSION, METRICS, metricDef, validateMetricValue, compareMetric };
