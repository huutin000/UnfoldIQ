"use strict";

/**
 * 1G.9 instruction-set validator (PHASE 1G.9). Structured
 * { valid, errors[], warnings[] }. Enforces schema shape, project/scene
 * separation, reference-role validity, version/fingerprint integrity, and
 * the sync-state machine (APPLIED ≠ VERIFIED; VERIFIED requires MATCH/
 * EQUIVALENT compare + reference evidence where required).
 */

const Ajv = require("ajv");
const addFormats = require("ajv-formats");
const fs = require("fs");
const path = require("path");
const shared = require("./shared.js");

function loadSchema(file) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "schemas", file), "utf8").replace(/^\uFEFF/, ""));
}

function validateInstructionSet(input = {}) {
  const errors = [];
  const warnings = [];
  const push = (dimension, code, message) => errors.push({ dimension, code, message });
  const set = input.set;
  if (!set) return { valid: false, errors: [{ dimension: "schema", code: "INSTRUCTION_SET_MISSING", message: "no set supplied" }], warnings };

  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(loadSchema("agent-instruction-set.schema.json"));
  if (!validate(set)) {
    for (const e of validate.errors || []) push("schema", "SCHEMA_INSTRUCTION_SET", `${e.instancePath} ${e.message}`);
  }
  // Scene-prompt separation: compiled text must not carry shot-scoped directives.
  const text = String(set.compiledText || "");
  if (/\bshot\s+\d+\b|camera\s+(pan|dolly|zoom)\s+left|narration:\s*["']/i.test(text)) {
    push("boundary", "SCENE_PROMPT_LEAK", "project instructions carry shot-scoped directives");
  }
  // Fingerprint integrity.
  const recomputed = shared.hash16({
    constraints: set.constraints,
    bindings: (set.referenceBindings || []).map((b) => [b.referenceId, b.role]),
  });
  if (set.compiledFingerprint && set.compiledFingerprint !== recomputed) {
    push("integrity", "FINGERPRINT_MISMATCH", "compiledFingerprint does not match constraints + bindings");
  }
  for (const b of set.referenceBindings || []) {
    if (!shared.REFERENCE_ROLES.includes(b.role)) {
      push("reference", "REFERENCE_ROLE_INVALID", `role ${b.role} is not canonical`);
    }
  }
  return { valid: errors.length === 0, errors, warnings };
}

function validateSync(input = {}) {
  const errors = [];
  const warnings = [];
  const push = (dimension, code, message) => errors.push({ dimension, code, message });
  const sync = input.sync;
  if (!sync) return { valid: false, errors: [{ dimension: "schema", code: "SYNC_MISSING", message: "no sync supplied" }], warnings };

  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(loadSchema("instruction-sync.schema.json"));
  if (!validate(sync)) {
    for (const e of validate.errors || []) push("schema", "SCHEMA_SYNC", `${e.instancePath} ${e.message}`);
  }
  if (!shared.SYNC_STATUSES.includes(sync.syncStatus)) {
    push("state", "SYNC_STATUS_INVALID", `syncStatus ${sync.syncStatus} is not canonical`);
  }
  // APPLIED ≠ VERIFIED: verification requires compare evidence.
  if (sync.syncStatus === "VERIFIED") {
    if (sync.semanticCompareStatus !== "MATCH" && sync.semanticCompareStatus !== "EQUIVALENT") {
      push("verification", "VERIFIED_WITHOUT_COMPARE", "VERIFIED requires MATCH/EQUIVALENT semantic compare");
    }
    if (!sync.verifiedAt) push("verification", "VERIFIED_WITHOUT_TIMESTAMP", "VERIFIED requires verifiedAt");
    const requiredRefs = (sync.referenceBindings || []).length;
    if (requiredRefs > 0 && sync.readbackStatus !== "READBACK_OK") {
      push("verification", "VERIFIED_WITHOUT_REFERENCE_READBACK", "bindings require provider reference readback");
    }
  }
  if (sync.syncStatus === "DRIFT" && (!sync.differences || sync.differences.length === 0)) {
    push("verification", "DRIFT_WITHOUT_DIFFERENCES", "DRIFT must record expected/observed classes");
  }
  return { valid: errors.length === 0, errors, warnings };
}

module.exports = { validateInstructionSet, validateSync };
