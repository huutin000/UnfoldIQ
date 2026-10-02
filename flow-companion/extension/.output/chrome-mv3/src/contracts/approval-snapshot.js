"use strict";

/**
 * UNFOLDIQ Flow Companion approval snapshot contract (POST-v1E §22–§24).
 * Immediately before approval the extension freezes an approval snapshot:
 * jobId + attempt + prompt + type + model + aspect + outputCount +
 * visibleCost + reference summary + timestamp + nonce. The fingerprint is
 * the canonical JSON of the material fields — any material change
 * (model/cost/aspect/prompt/outputs/reference) invalidates the approval
 * and requires a fresh one. No DOM here; DOM revalidation lives in
 * content-commands (SUBMIT_GENERATE) via the centralized adapter.
 */

const MATERIAL_FIELDS = ["jobId", "attempt", "prompt", "type", "model", "aspect", "outputCount", "visibleCost", "referenceSummary"];

function canonicalize(value) {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function fingerprintOf(material) {
  const picked = {};
  for (const f of MATERIAL_FIELDS) picked[f] = material[f] === undefined ? null : material[f];
  return canonicalize(picked);
}

function buildApprovalSnapshot({ job = {}, generationState = {}, reference = null, nonce = null } = {}) {
  const d = (generationState && generationState.details) || {};
  const material = {
    jobId: job.jobId || "UNKNOWN",
    attempt: job.attempt ?? null,
    prompt: job.prompt || "",
    type: String(job.capability || "image").toUpperCase(),
    model: d.modelLabel || "UNKNOWN",
    aspect: d.aspect || "UNKNOWN",
    outputCount: d.outputCount === undefined || d.outputCount === null ? "UNKNOWN" : d.outputCount,
    visibleCost: d.visibleCreditCost || "UNKNOWN",
    referenceSummary: reference ? canonicalize(reference) : "none",
  };
  let timestamp = null;
  try {
    timestamp = new Date().toISOString();
  } catch {
    timestamp = "unknown";
  }
  return { ...material, timestamp, nonce: nonce || null, fingerprint: fingerprintOf(material) };
}

function verifyApprovalFreshness(snapshot, current = {}) {
  if (!snapshot || typeof snapshot.fingerprint !== "string") {
    return { fresh: false, changed: ["SNAPSHOT_MISSING"] };
  }
  const changed = [];
  const curMaterial = {};
  for (const f of MATERIAL_FIELDS) curMaterial[f] = current[f] === undefined ? null : current[f];
  if (fingerprintOf(curMaterial) === snapshot.fingerprint) return { fresh: true, changed };
  for (const f of MATERIAL_FIELDS) {
    const a = snapshot[f] === undefined ? null : snapshot[f];
    const b = curMaterial[f];
    if (canonicalize(a) !== canonicalize(b)) changed.push(f);
  }
  return { fresh: false, changed };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { MATERIAL_FIELDS, canonicalize, fingerprintOf, buildApprovalSnapshot, verifyApprovalFreshness };
}

try {
  if (typeof window !== "undefined" && !window.FlowApprovalSnapshot) {
    window.FlowApprovalSnapshot = { MATERIAL_FIELDS, canonicalize, fingerprintOf, buildApprovalSnapshot, verifyApprovalFreshness };
  }
} catch (e) {
  void e;
}
