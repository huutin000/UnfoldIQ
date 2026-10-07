"use strict";

/**
 * 1G.8 output-cost shared vocabulary (PHASE 1G.8, Prompt 01).
 * Versions, enums, stable identity, output-count policy constants.
 * No provider prices live here — only the special-role allowlist (roadmap
 * policy) and unit/state vocabularies. No generation, no credits spent.
 */

const crypto = require("crypto");
const { stableStringify } = require("../../providers/runtime/request-fingerprint.js");

const OUTPUT_COST_VERSION = "1.0.0";
const BUDGET_POLICY_VERSION = "output-cost-policy-1.0.0";

const OUTPUT_COUNT_DEFAULT = 1;
const OUTPUT_COUNT_MAX = 4;

/** Roadmap-approved special roles for multi-output generation (only these). */
const SPECIAL_OUTPUT_ROLES = [
  "CHARACTER_MASTER",
  "THUMBNAIL",
  "HERO_SHOT",
  "STYLE_BAKE_OFF",
  "CRITICAL_VISUAL",
];

const IMAGE_ASSET_ROLES = ["PRIMARY_IMAGE", "START_FRAME", "END_FRAME"];
const REFERENCE_ASSET_ROLES = ["CHARACTER_REFERENCE", "ENVIRONMENT_REFERENCE", "OBJECT_REFERENCE"];

const UNIT_STATUSES = ["PLANNED", "COMMITTED", "OBSERVED", "FAILED", "RETIRED"];

const CREDIT_ESTIMATE_STATES = ["EXACT", "UNKNOWN", "CONFLICT", "STALE", "NOT_APPLICABLE"];

const HARD_STOP_STATES = [
  "APPROVED",
  "APPROVED_WITH_WARNING",
  "REVIEW_REQUIRED",
  "BLOCKED_COST_UNKNOWN",
  "BLOCKED_COST_CONFLICT",
  "BLOCKED_BUDGET_EXCEEDED",
  "BLOCKED_RETRY_BUDGET_EXCEEDED",
  "BLOCKED_REGISTRY_REFRESH_REQUIRED",
  "PRE_GENERATION_REVIEW_REQUIRED",
  "HARD_BUDGET_STOP",
];

const RECONCILIATION_STATES = ["RECONCILED", "PARTIAL", "UNRECONCILED", "CONFLICT"];

const BUDGET_SCOPES = ["PROJECT", "SEQUENCE", "SCENE", "SHOT", "GENERATION_JOB"];

function hash16(value) {
  return crypto.createHash("sha256").update(stableStringify(value), "utf8").digest("hex").slice(0, 16);
}

function id12(prefix, value) {
  return `${prefix}-${crypto.createHash("sha256").update(stableStringify(value), "utf8").digest("hex").slice(0, 12)}`;
}

module.exports = {
  OUTPUT_COST_VERSION,
  BUDGET_POLICY_VERSION,
  OUTPUT_COUNT_DEFAULT,
  OUTPUT_COUNT_MAX,
  SPECIAL_OUTPUT_ROLES,
  IMAGE_ASSET_ROLES,
  REFERENCE_ASSET_ROLES,
  UNIT_STATUSES,
  CREDIT_ESTIMATE_STATES,
  HARD_STOP_STATES,
  RECONCILIATION_STATES,
  BUDGET_SCOPES,
  hash16,
  id12,
  stableStringify,
};
