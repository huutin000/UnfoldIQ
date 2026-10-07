"use strict";

/**
 * 1G.9 instruction compiler (PHASE 1G.9, Prompt 01, §§9–14).
 * Compiles project-level invariants from canonical sources into a
 * deterministic AgentInstructionSet. Source priority: explicit operator
 * overrides > character locks > world continuity > visual/style rules >
 * channel defaults > platform composition. Scene-scoped fields are REJECTED
 * (never silently dropped): project instructions ≠ scene prompts.
 * Deterministic: same canonical inputs → same version/fingerprint.
 */

const shared = require("./shared.js");

function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function asList(v) {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.length > 0) : [];
}

function checkSceneLeak(where, obj) {
  const leaked = [];
  if (!isObject(obj)) return leaked;
  for (const key of shared.SCENE_SCOPED_FIELDS) {
    if (obj[key] !== undefined && obj[key] !== null) leaked.push(`${where}.${key}`);
  }
  return leaked;
}

/**
 * Input: { projectId, characterLocks?, worldRules?, visualRules?,
 *   channelDefaults?, platformComposition?, operatorOverrides?,
 *   referenceBindings? [{ referenceId, role, reason }], now? }
 * Reference roles must be canonical; scene fields anywhere → rejection.
 */
function compileInstructionSet(input = {}) {
  const blockers = [];
  if (!input.projectId) {
    return { ok: false, code: "INSTRUCTION_PROJECT_REQUIRED", message: "projectId is required" };
  }
  const leaks = [
    ...checkSceneLeak("operatorOverrides", input.operatorOverrides),
    ...checkSceneLeak("characterLocks", input.characterLocks),
    ...checkSceneLeak("worldRules", input.worldRules),
    ...checkSceneLeak("visualRules", input.visualRules),
  ];
  if (leaks.length > 0) {
    return { ok: false, code: "INSTRUCTION_SCENE_LEAK", message: `scene-scoped fields do not belong in project invariants: ${leaks.join(", ")}`, leaks };
  }

  const bindings = [];
  for (const b of input.referenceBindings || []) {
    if (!isObject(b) || !b.referenceId) {
      return { ok: false, code: "REFERENCE_BINDING_INVALID", message: "reference binding needs referenceId" };
    }
    if (!shared.REFERENCE_ROLES.includes(b.role)) {
      return { ok: false, code: "REFERENCE_ROLE_INVALID", message: `role ${b.role} is not canonical` };
    }
    bindings.push({ referenceId: b.referenceId, role: b.role, reason: b.reason || null });
  }

  const op = isObject(input.operatorOverrides) ? input.operatorOverrides : {};
  const take = (key) => (op[key] !== undefined ? asList(op[key]) : null);
  const platRules = input.platformComposition
    ? (Array.isArray(input.platformComposition) ? input.platformComposition : input.platformComposition.rules)
    : null;
  const constraints = {
    characterIdentity: take("characterIdentity") || asList(input.characterLocks && (input.characterLocks.identities || input.characterLocks)),
    visualStyle: take("visualStyle") || asList(input.visualRules && (input.visualRules.style || input.visualRules)),
    worldContinuity: take("worldContinuity") || asList(input.worldRules && (input.worldRules.continuity || input.worldRules)),
    palette: take("palette") || asList((input.visualRules && input.visualRules.palette) || (input.channelDefaults && input.channelDefaults.palette)),
    recurringReferenceRules: take("recurringReferenceRules") || [],
    forbiddenMutations: take("forbiddenMutations") || defaultForbiddenMutations(),
    unwantedContent: take("unwantedContent") || ["text", "logo", "watermark unless explicitly requested"],
    platformCompositionRules: take("platformCompositionRules") || asList(platRules),
  };
  const sourceVersions = {
    channelBible: (input.channelDefaults && input.channelDefaults.version) || null,
    characterBible: (input.characterLocks && input.characterLocks.version) || null,
    worldBible: (input.worldRules && input.worldRules.version) || null,
    visualBible: (input.visualRules && input.visualRules.version) || null,
    platformPolicy: (input.platformComposition && input.platformComposition.version) || input.platformPolicyVersion || null,
  };
  const compiledText = renderInstructions(constraints);
  const fingerprint = shared.hash16({ constraints, bindings: bindings.map((b) => [b.referenceId, b.role]) });
  const now = input.now || new Date().toISOString();
  const set = {
    version: shared.INSTRUCTIONS_VERSION,
    schemaVersion: shared.INSTRUCTION_SCHEMA_VERSION,
    instructionSetId: shared.id12("is", { projectId: input.projectId, fingerprint }),
    projectId: input.projectId,
    instructionVersion: shared.id12("iv", { projectId: input.projectId, fingerprint }),
    sourceVersions,
    constraints,
    referenceIds: bindings.map((b) => b.referenceId),
    referenceBindings: bindings,
    compiledText,
    compiledFingerprint: fingerprint,
    providerTargets: ["GOOGLE_FLOW"],
    createdAt: now,
    updatedAt: now,
  };
  return { ok: true, instructionSet: set };
}

function defaultForbiddenMutations() {
  return [
    "no random new character",
    "no face mutation",
    "no spontaneous age change",
    "no spontaneous costume change",
    "no unexplained prop mutation",
    "no unexpected location replacement",
    "no reference substitution",
  ];
}

function renderInstructions(c) {
  const section = (title, lines) => (lines.length > 0 ? `${title}:\n${lines.map((l) => `- ${l}`).join("\n")}` : null);
  return [
    "PROJECT INVARIANTS (apply to every generation in this project):",
    section("Character identity", c.characterIdentity),
    section("Visual style", c.visualStyle),
    section("World continuity", c.worldContinuity),
    section("Palette", c.palette),
    section("Recurring references", c.recurringReferenceRules),
    section("Forbidden mutations", c.forbiddenMutations),
    section("Unwanted content", c.unwantedContent),
    section("Platform composition", c.platformCompositionRules),
  ].filter(Boolean).join("\n");
}

module.exports = { compileInstructionSet, defaultForbiddenMutations, renderInstructions };
