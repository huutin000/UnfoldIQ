"use strict";

/**
 * Phase 6B — shared guards: zero paid cost, no secrets, no fabricated viewer data.
 * Every persisted 6B artifact passes assertSafeDoc() first.
 */

const crypto = require("crypto");
const { assertNoFabricatedRetention } = require("../creative-retention/contract.js");

const sha16 = (v) => crypto.createHash("sha256").update(JSON.stringify(v), "utf8").digest("hex").slice(0, 16);
const sha256 = (v) => crypto.createHash("sha256").update(typeof v === "string" ? v : JSON.stringify(v), "utf8").digest("hex");

const COST_KEYS = /^(estimatedCostVnd|costVnd|externalCostVnd|paidCostVnd)$/;
const PAID_FLAG_KEYS = /^(paidMediaCalls?|paidApiCalls?|paidProviderCalls?|upgradeToPaid|publish|upload)$/;
const SECRET_RE = /(AIza[0-9A-Za-z_-]{20,}|sk-[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._-]{16,}|(api[_-]?key|secret|token|password|passwd)\s*[=:]\s*["']?[A-Za-z0-9._\-/+]{8,})/i;
const VIEWER_METRIC_RE = /(viewers?\s+(prefer|chose|picked|liked)|\b\d+(\.\d+)?\s*%\s+(of\s+)?(viewers|audience)|watch[\s-]?time\s+(win|share|lift)|ctr\s+(win|lift)|guarantee[sd]?\s+(monetization|approval|copyright))/i;

function walk(value, fn, p = "$") {
  fn(value, p);
  if (Array.isArray(value)) value.forEach((v, i) => walk(v, fn, `${p}[${i}]`));
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) walk(v, fn, `${p}.${k}`);
}

function guardError(code, violations) {
  const e = new Error(`${code}: ${violations.map((v) => v.path).join(", ")}`);
  e.code = code;
  e.violations = violations;
  return e;
}

/** Throws PAID_COST_GUARD when any cost/paid flag is non-zero/true. Returns true otherwise. */
function assertZeroPaid(doc) {
  const bad = [];
  walk(doc, (v, p) => {
    const key = p.split(".").pop().replace(/\[\d+\]$/, "");
    if (COST_KEYS.test(key) && Number(v) > 0) bad.push({ path: p, value: v });
    if (PAID_FLAG_KEYS.test(key) && (v === true || (typeof v === "number" && v > 0))) bad.push({ path: p, value: v });
  });
  if (bad.length) throw guardError("PAID_COST_GUARD", bad);
  return true;
}

function findSecrets(doc) {
  const out = [];
  walk(doc, (v, p) => { if (typeof v === "string" && SECRET_RE.test(v)) out.push({ path: p }); });
  return out;
}

function assertNoSecrets(doc) {
  const s = findSecrets(doc);
  if (s.length) throw guardError("SECRET_IN_DOCUMENT", s);
  return true;
}

function assertNoViewerMetrics(doc) {
  const bad = [];
  walk(doc, (v, p) => { if (typeof v === "string" && VIEWER_METRIC_RE.test(v)) bad.push({ path: p }); });
  if (bad.length) throw guardError("FABRICATED_VIEWER_OR_CERTIFICATION_CLAIM", bad);
  return true;
}

function assertSafeDoc(doc) {
  assertZeroPaid(doc);
  assertNoSecrets(doc);
  assertNoViewerMetrics(doc);
  assertNoFabricatedRetention(doc);
  return true;
}

module.exports = { sha16, sha256, assertZeroPaid, assertNoSecrets, findSecrets, assertNoViewerMetrics, assertSafeDoc, walk };
