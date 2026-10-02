"use strict";

/**
 * UNFOLDIQ provider result semantic validation (STEP 10A): PR1–PR10.
 * Structural/epistemic checks over result objects. No network, no rendering.
 */

const path = require("path");
const store = require("../providers/runtime/artifact-store.js");

function err(code, message) {
  return { code, message };
}

const SECRET_KEY_PATTERN = /secret|token|api[_-]?key|password|credential|authorization|auth/i;
const SECRET_VALUE_PATTERN = /^(sk-|xox[bpas]-|ghp_|gsk_|Bearer\s+[A-Za-z0-9._-]+|AIza[0-9A-Za-z_-]{10,})/;

function findSecrets(value, trail = "$") {
  const hits = [];
  if (Array.isArray(value)) {
    value.forEach((v, i) => hits.push(...findSecrets(v, `${trail}[${i}]`)));
    return hits;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEY_PATTERN.test(k)) hits.push(`${trail}.${k}`);
      hits.push(...findSecrets(v, `${trail}.${k}`));
    }
    return hits;
  }
  if (typeof value === "string" && SECRET_VALUE_PATTERN.test(value)) hits.push(trail);
  return hits;
}

/**
 * validateProviderResult(result, { projectRoot, checkExists }) → { valid, errors[], warnings[] }
 * PR1 READY needs artifactPath; PR2 artifact must exist; PR3 inside project;
 * PR4 generated needs provenance; PR5 handoff needs handoffPath; PR6 approval
 * needs metadata; PR7 NOT_AVAILABLE has no artifact; PR8 no secrets.
 */
function validateProviderResult(result, opts = {}) {
  const errors = [];
  const warnings = [];
  if (!result || typeof result !== "object") {
    return { valid: false, errors: [err("INVALID_RESULT_SHAPE", "Result must be an object")], warnings };
  }

  // PR1 — READY requires artifact path.
  if (result.status === "READY" && !result.artifactPath) {
    errors.push(err("READY_WITHOUT_ARTIFACT", "READY result requires artifactPath"));
  }

  // PR2/PR3 — artifact must exist and stay inside project.
  if (result.artifactPath && opts.projectRoot && result.projectId) {
    try {
      store.resolveProjectPath(opts.projectRoot, result.projectId, result.artifactPath);
    } catch {
      errors.push(err("ARTIFACT_PATH_TRAVERSAL", `Artifact path escapes project: ${result.artifactPath}`));
    }
    if (opts.checkExists && result.status === "READY") {
      if (!store.artifactExists(opts.projectRoot, result.projectId, result.artifactPath)) {
        errors.push(err("READY_ARTIFACT_MISSING", `READY artifact does not exist: ${result.artifactPath}`));
      }
    }
  }

  // PR4 — generated results require provenance.
  if (result.sourceType === "generated" && !result.provenanceNote) {
    errors.push(err("GENERATED_WITHOUT_PROVENANCE", "Generated result requires provenanceNote"));
  }
  if (result.sourceType === "generated" && !result.generationDate) {
    warnings.push(err("GENERATED_WITHOUT_DATE", "Generated result should carry generationDate"));
  }

  // PR5 — HANDOFF_REQUIRED requires handoffPath.
  if (result.status === "HANDOFF_REQUIRED" && !result.handoffPath) {
    errors.push(err("HANDOFF_WITHOUT_PATH", "HANDOFF_REQUIRED result requires handoffPath"));
  }

  // PR6 — AWAITING_USER_APPROVAL requires approval metadata.
  if (result.status === "AWAITING_USER_APPROVAL" && !result.approval) {
    errors.push(err("APPROVAL_WITHOUT_METADATA", "AWAITING_USER_APPROVAL result requires approval metadata"));
  }

  // PR7 — NOT_AVAILABLE cannot pretend an artifact exists.
  if (result.status === "NOT_AVAILABLE" && result.artifactPath) {
    errors.push(err("UNAVAILABLE_WITH_ARTIFACT", "NOT_AVAILABLE result must not carry artifactPath"));
  }

  // PR8 — no secret-like fields/values serialized.
  const hits = findSecrets(result);
  if (hits.length > 0) {
    errors.push(err("SECRET_SERIALIZED", `Secret-like data serialized at: ${hits.join(",")}`));
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * checkContinuityReady(result, { preconditionSatisfied }) → { valid, errors[] }
 * PR9 — STRICT requests cannot become READY without a satisfied precondition.
 */
function checkContinuityReady(result, opts = {}) {
  const errors = [];
  const strictness = result?.continuityRequest?.continuityStrictness
    || (result?.metadata && result.metadata.continuityStrictness);
  if (result?.status === "READY" && strictness === "STRICT" && opts.preconditionSatisfied !== true) {
    errors.push(err("STRICT_READY_WITHOUT_PRECONDITION", "STRICT continuity request became READY without satisfied precondition"));
  }
  return { valid: errors.length === 0, errors };
}

/**
 * checkFingerprintReuse({ fingerprint, projectRoot, projectId }) → { reusable, artifactPath }
 * PR10 — an accepted existing READY artifact with matching fingerprint is reusable.
 */
function checkFingerprintReuse({ fingerprint, projectRoot, projectId }) {
  const hit = store.findByFingerprint(projectRoot, projectId, fingerprint);
  return hit ? { reusable: true, artifactPath: hit } : { reusable: false, artifactPath: null };
}

module.exports = { validateProviderResult, checkContinuityReady, checkFingerprintReuse, findSecrets };
