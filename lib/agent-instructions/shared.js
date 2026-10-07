"use strict";

/**
 * 1G.9 agent-instructions shared vocabulary (PHASE 1G.9, Prompt 01).
 * Versions, enums, stable identity. Project invariants live here as DATA;
 * scene prompts never do. No browser, no generation, no credits.
 */

const crypto = require("crypto");
const { stableStringify } = require("../../providers/runtime/request-fingerprint.js");

const INSTRUCTIONS_VERSION = "1.0.0";
const INSTRUCTION_SCHEMA_VERSION = "1.0.0";

const REFERENCE_ROLES = [
  "CHARACTER_IDENTITY",
  "WORLD_LOCATION",
  "STYLE",
  "PALETTE",
  "PROJECT_GUIDE",
];

const SYNC_STATUSES = [
  "DRAFT",
  "READY_TO_SYNC",
  "APPLYING",
  "APPLIED",
  "READBACK_PENDING",
  "VERIFIED",
  "DRIFT",
  "BLOCKED",
  "FAILED",
];

const COMPARE_STATUSES = ["MATCH", "EQUIVALENT", "DRIFT", "UNVERIFIABLE"];

/** Fields that belong to scene prompts and must never enter project invariants. */
const SCENE_SCOPED_FIELDS = [
  "actionIntent",
  "cameraMotion",
  "cameraIntent",
  "shotTransition",
  "narration",
  "voiceLine",
  "currentShot",
  "temporaryRequest",
];

function hash16(value) {
  return crypto.createHash("sha256").update(stableStringify(value), "utf8").digest("hex").slice(0, 16);
}

function id12(prefix, value) {
  return `${prefix}-${crypto.createHash("sha256").update(stableStringify(value), "utf8").digest("hex").slice(0, 12)}`;
}

module.exports = {
  INSTRUCTIONS_VERSION,
  INSTRUCTION_SCHEMA_VERSION,
  REFERENCE_ROLES,
  SYNC_STATUSES,
  COMPARE_STATUSES,
  SCENE_SCOPED_FIELDS,
  hash16,
  id12,
  stableStringify,
};
