"use strict";

/**
 * Phase 1G.11 — asset-qa shared core.
 * Statuses, severities, evidence builder, expectation fingerprint + staleness.
 * Pure logic, no generation, no network, no secrets.
 */

const crypto = require("crypto");

const QA_POLICY_VERSION = "1g11-1.0.0";

const LAYER_STATUS = ["PASS", "FAIL", "WARN", "UNKNOWN", "NOT_APPLICABLE"];
const SEVERITY = ["INFO", "WARNING", "ERROR", "BLOCKER"];
const GATE_STATUS = ["READY_FOR_TIMELINE", "REVIEW_REQUIRED", "REJECTED"];
const RECOMMENDATION = [
  "REPLACE_ASSET",
  "REGENERATE_SHOT",
  "RECOMPOSE",
  "RELABEL",
  "MANUAL_REVIEW",
  "NONE",
];

function nowIso() {
  try {
    return new Date().toISOString();
  } catch {
    return "unknown";
  }
}

function sha256Hex(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), "utf8");
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function canonicalJson(value) {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function makeEvidence(input = {}) {
  return {
    evidenceId: input.evidenceId || `ev-${sha256Hex(`${input.layer || ""}|${input.check || ""}|${nowIso()}|${Math.random()}`).slice(0, 12)}`,
    layer: input.layer || null,
    check: input.check || null,
    source: input.source || null,
    expected: input.expected === undefined ? null : input.expected,
    observed: input.observed === undefined ? null : input.observed,
    comparison: input.comparison || null,
    confidence: input.confidence || null,
    artifactRefs: Array.isArray(input.artifactRefs) ? input.artifactRefs.map(String) : [],
  };
}

function layerResult(input = {}) {
  const status = LAYER_STATUS.includes(input.status) ? input.status : "UNKNOWN";
  const severity = SEVERITY.includes(input.severity) ? input.severity : "INFO";
  return {
    status,
    severity,
    blocking: input.blocking === true,
    checks: Array.isArray(input.checks) ? input.checks : [],
    evidence: Array.isArray(input.evidence) ? input.evidence : [],
    reasons: Array.isArray(input.reasons) ? input.reasons.map(String) : [],
  };
}

function checkEntry(name, status, severity, reason, blocking) {
  return {
    check: name,
    status: LAYER_STATUS.includes(status) ? status : "UNKNOWN",
    severity: SEVERITY.includes(severity) ? severity : "INFO",
    reason: reason ? String(reason) : null,
    blocking: blocking === true,
  };
}

// Fingerprint dependencies per §42. Missing keys are omitted (never invented).
const FINGERPRINT_KEYS = [
  "assetId",
  "assetHash",
  "shotExpectationVersion",
  "sceneExpectationVersion",
  "scriptVersion",
  "narrationVersion",
  "claimEvidenceVersion",
  "characterBibleVersion",
  "worldBibleVersion",
  "visualBibleVersion",
  "instructionVersion",
  "platformAdaptationVersion",
  "qaPolicyVersion",
];

function buildExpectationFingerprint(deps = {}) {
  const snap = {};
  for (const k of FINGERPRINT_KEYS) {
    if (deps[k] !== undefined && deps[k] !== null) snap[k] = String(deps[k]);
  }
  if (!snap.qaPolicyVersion) snap.qaPolicyVersion = QA_POLICY_VERSION;
  const canonical = canonicalJson(snap);
  return { fingerprint: `fp-${sha256Hex(canonical).slice(0, 16)}`, snapshot: snap, canonical };
}

// Targeted staleness: which layers a dep change invalidates.
function checkStaleness(storedSnap = {}, currentDeps = {}) {
  const cur = {};
  for (const k of FINGERPRINT_KEYS) {
    if (currentDeps[k] !== undefined && currentDeps[k] !== null) cur[k] = String(currentDeps[k]);
  }
  if (!cur.qaPolicyVersion) cur.qaPolicyVersion = QA_POLICY_VERSION;
  const staleLayers = new Set();
  const reasons = [];
  const changed = (k) => (storedSnap[k] || null) !== (cur[k] || null);

  if (changed("assetHash") || changed("qaPolicyVersion")) {
    for (const l of ["structural", "semantic", "factuality", "continuity"]) staleLayers.add(l);
    if (changed("assetHash")) reasons.push("STALE_ASSET_HASH: asset bytes changed; all layers stale");
    if (changed("qaPolicyVersion")) reasons.push("STALE_QA_POLICY: QA policy changed; all layers stale");
  }
  if (changed("claimEvidenceVersion")) {
    staleLayers.add("factuality");
    reasons.push("STALE_EVIDENCE: claim/evidence changed; factuality stale");
  }
  if (changed("characterBibleVersion") || changed("worldBibleVersion") || changed("visualBibleVersion") || changed("instructionVersion")) {
    staleLayers.add("continuity");
    reasons.push("STALE_WORLD: character/world/visual/instruction truth changed; continuity stale");
  }
  if (changed("platformAdaptationVersion")) {
    staleLayers.add("structural");
    staleLayers.add("semantic");
    reasons.push("STALE_ADAPTATION: platform aspect changed; structural/composition stale");
  }
  if (changed("shotExpectationVersion") || changed("sceneExpectationVersion") || changed("scriptVersion") || changed("narrationVersion")) {
    staleLayers.add("semantic");
    staleLayers.add("factuality");
    reasons.push("STALE_EXPECTATION: shot/scene/script changed; semantic/factuality stale");
  }
  return { stale: staleLayers.size > 0, staleLayers: [...staleLayers].sort(), reasons };
}

module.exports = {
  QA_POLICY_VERSION,
  LAYER_STATUS,
  SEVERITY,
  GATE_STATUS,
  RECOMMENDATION,
  FINGERPRINT_KEYS,
  nowIso,
  sha256Hex,
  canonicalJson,
  makeEvidence,
  layerResult,
  checkEntry,
  buildExpectationFingerprint,
  checkStaleness,
};
