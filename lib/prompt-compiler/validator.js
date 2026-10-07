"use strict";

/**
 * Prompt Package validator (1G.4 §18-§20, §28). Deterministic, structured
 * results — never a mystery quality score.
 */

const Ajv = require("ajv");
const addFormats = require("ajv-formats");
const fs = require("fs");
const path = require("path");

const INJECTION_PATTERN = /ignore (all |any )?(previous|prior) (instructions|rules|prompts)|disregard (all |your )?(instructions|rules)/i;
const CERTAINTY_PATTERN = /verified fact|documented fact|historically proven|proven to have happened/i;
const SECRET_PATTERN = /api[_-]?key\s*[=:]|bearer\s+[a-z0-9]|password\s*[=:]|-----begin [a-z ]*private key|eyJ[a-z0-9_-]{10,}\./i;

function loadSchema(file) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "schemas", file), "utf8").replace(/^\uFEFF/, ""));
}

function schemaErrors(ajv, doc) {
  const validate = ajv.compile(loadSchema("prompt-package.schema.json"));
  if (validate(doc)) return [];
  return (validate.errors || []).map((e) => ({ dimension: "schema", code: "SCHEMA_PROMPT_PACKAGE", message: `${e.instancePath} ${e.message}` }));
}

function stableStringifySafe(value) {
  try {
    return JSON.stringify(value || []);
  } catch {
    return "";
  }
}

/**
 * Input: {
 *   pkg,                        // the Prompt Package
 *   context? { shotPlan, beatMap, referenceAssets }  // for cross-checks
 * }
 */
function validatePromptPackage(input = {}) {
  const errors = [];
  const warnings = [];
  const push = (dimension, code, message) => errors.push({ dimension, code, message });
  const warn = (dimension, code, message) => warnings.push({ dimension, code, message });
  const pkg = input.pkg;
  if (!pkg || !pkg.promptSpec) return { valid: false, errors: [{ dimension: "schema", code: "PROMPT_PACKAGE_INVALID", message: "prompt package missing" }], warnings };
  const spec = pkg.promptSpec;
  const text = String(pkg.compiledPrompt || "");

  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  errors.push(...schemaErrors(ajv, pkg));

  // --- Required target fields / completeness (§19): enough for a coherent
  // frame or motion — cinematic fields may legitimately be null.
  if (!pkg.targetKind) push("targetFields", "TARGET_KIND_REQUIRED", "package has no targetKind");
  if (!spec.subject || !spec.subject.descriptor) push("targetFields", "SUBJECT_REQUIRED", "no subject information available");
  if (pkg.targetKind === "VIDEO" && !spec.action && !text.includes("ENVIRONMENT MOTION") && !text.includes("TEMPORAL PROGRESSION")) {
    push("targetFields", "MOTION_REQUIRED", "video package has no action, environment motion or progression to animate");
  }
  if (pkg.targetKind === "VIDEO" && (spec.narrativeIntent || "").includes("REVEAL") && !text.includes("TEMPORAL PROGRESSION")) {
    warn("targetFields", "PROGRESSION_ABSENT", "reveal shot has no explicit temporal progression section");
  }

  // --- Lineage completeness (§8): Shot -> Scene -> Beats -> Story.
  const sr = spec.sourceRefs || {};
  if (!sr.shotId || !sr.sceneId || !Array.isArray(sr.beatIds) || sr.beatIds.length === 0) {
    push("lineage", "LINEAGE_INCOMPLETE", "sourceRefs must trace shotId, sceneId and beats");
  }
  if (!sr.beatMapFingerprint || !sr.sourceShotFingerprint || !sr.sourceSceneFingerprint) {
    push("lineage", "LINEAGE_FINGERPRINTS_MISSING", "source fingerprints required for stale detection");
  }
  if (spec.unknownReferencesCount > 0) {
    push("referenceValidity", "REFERENCE_INVALID", `${spec.unknownReferencesCount} referenced asset(s) not found in the canonical reference set`);
  }

  // --- Claim / evidence safety (§9) + FICTION (§10) + HYBRID (§11).
  const beatClaims = new Set(input.context && input.context.beatMap
    ? input.context.beatMap.beats.flatMap((b) => b.claimRefs || [])
    : spec.claimRefs);
  for (const id of spec.claimRefs || []) {
    if (!beatClaims.has(id)) push("evidenceSafety", "CLAIM_INVENTED", `claim ${id} not present in canonical beats`);
  }
  if (spec.contentClass === "FICTION" && (spec.claimRefs || []).length > 0) {
    push("fictionSafety", "FICTION_FAKE_EVIDENCE", "fiction package carries claim refs");
  }
  const nonFact = (spec.classificationRefs || []).map((c) => c.classification)
    .filter((c) => c && c !== "FACT");
  if (nonFact.length > 0 && CERTAINTY_PATTERN.test(text)) {
    push("hybridSafety", "CLASSIFICATION_PROMOTED",
      `package text asserts certainty while carrying ${[...new Set(nonFact)].join("/")} labels`);
  }

  // --- Identity / duplicate descriptor checks (§12, §20, I6).
  const identityPhrase = spec.subject.referenceFirst ? spec.subject.descriptor : null;
  if (identityPhrase) {
    const occurrences = text.split(identityPhrase).length - 1;
    if (occurrences > 1) warn("identity", "IDENTITY_REPEATED", "identity reference repeated in compiled text");
  }
  const seenSections = new Set();
  for (const key of pkg.sections || []) {
    if (seenSections.has(key)) warn("duplicates", "DUPLICATE_SECTION", `section ${key} compiled twice`);
    seenSections.add(key);
  }

  // --- Length budget (adapter-specific, §21).
  if (pkg.generationMetadata && pkg.generationMetadata.budgetChars && text.length > pkg.generationMetadata.budgetChars) {
    push("budget", "BUDGET_EXCEEDED", `compiled prompt exceeds the adapter budget (${text.length} > ${pkg.generationMetadata.budgetChars})`);
  }

  // --- Prompt injection firewall (§28): instruction-flavored content must
  // never appear in the compiled prompt text at all.
  if (INJECTION_PATTERN.test(text)) {
    push("injectionSafety", "PROMPT_INJECTION_TEXT", "compiled prompt contains instruction-flavored content");
  }
  // --- Secrets never enter prompt packages (§58).
  if (SECRET_PATTERN.test(text) || SECRET_PATTERN.test(stableStringifySafe(spec.mustAvoid) + stableStringifySafe(spec.mustPreserve))) {
    push("injectionSafety", "SECRET_SUSPECTED", "package contains secret-like content");
  }

  const valid = errors.length === 0;
  return { valid, errors, warnings };
}

module.exports = { validatePromptPackage, INJECTION_PATTERN, CERTAINTY_PATTERN };
