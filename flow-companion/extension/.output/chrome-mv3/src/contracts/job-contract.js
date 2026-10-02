"use strict";

/**
 * UNFOLDIQ Flow Companion job contract mirror (STEP 10B).
 * Canonical schema: schemas/flow-job.schema.json (repo root).
 * This file mirrors required fields + status enums for extension-side
 * runtime validation so the content/background code never drifts.
 */

const REQUIRED_JOB_FIELDS = ["jobId", "requestId", "projectId", "sceneId", "capability", "mode", "prompt", "expectedOutputPath", "status", "attempt"];
const JOB_STATUSES = ["PENDING", "VALIDATED", "PREPARED", "AWAITING_USER_APPROVAL", "GENERATING", "RESULT_DETECTED", "DOWNLOADING", "IMPORTED", "READY", "PAUSED", "RETRYABLE_ERROR", "FAILED", "CANCELLED", "MANUAL_ASSIST_REQUIRED", "REJECTED_BY_USER", "REJECTED_BY_QA", "RECONCILIATION_REQUIRED", "PROVIDER_SAFETY_REFUSED", "SAFETY_ADAPTATION_REQUIRED", "SAFETY_ADAPTATION_PREPARED", "SAFE_FALLBACK_REQUIRED"];

function checkJobShape(job) {
  const missing = REQUIRED_JOB_FIELDS.filter((f) => job[f] === undefined);
  if (missing.length > 0) throw new Error(`SCHEMA_INVALID: missing ${missing.join(",")}`);
  if (!JOB_STATUSES.includes(job.status)) throw new Error(`SCHEMA_INVALID: unknown status ${job.status}`);
  return true;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { REQUIRED_JOB_FIELDS, JOB_STATUSES, checkJobShape };
}
