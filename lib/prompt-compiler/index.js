"use strict";

/**
 * UNFOLDIQ Prompt Compiler facade (1G.4, Prompt 01, §48-ish).
 *
 * compilePromptPackage(input, options):
 *   Shot(+Scene+BeatMap+StoryDraft) -> Prompt Spec -> compiled prompt
 *   -> validate -> persist -> normalized result.
 *
 * targetKind is REQUIRED from the caller (IMAGE | VIDEO). The compiler never
 * infers the target, never selects a model, never generates media, never
 * touches Flow/Veo/Remotion decisions.
 *
 * Terminal statuses: PROMPT_PACKAGE_VALID | PROMPT_PACKAGE_BLOCKED |
 * PROMPT_LOCKED | PROMPT_TARGET_REQUIRED | FAILED.
 */

const shared = require("./shared.js");
const specLib = require("./prompt-spec.js");
const compiler = require("./compiler.js");
const validator = require("./validator.js");
const store = require("./store.js");
const { stableStringify } = require("../../providers/runtime/request-fingerprint.js");

const STATUS = {
  PROMPT_PACKAGE_VALID: "PROMPT_PACKAGE_VALID",
  PROMPT_PACKAGE_BLOCKED: "PROMPT_PACKAGE_BLOCKED",
  PROMPT_LOCKED: "PROMPT_LOCKED",
  PROMPT_TARGET_REQUIRED: "PROMPT_TARGET_REQUIRED",
  FAILED: "FAILED",
};

/**
 * Input: { projectId, shot, scene, beatMap, storyDraft?, platform,
 *          contentClass, targetKind, overrides?, referenceAssets?, now? }
 * Options: { root?, persist?, budgetChars?, force?, creativeMemoryContext? }
 */
async function compilePromptPackage(input = {}, options = {}) {
  const result = {
    ok: false,
    status: STATUS.FAILED,
    projectId: input.projectId || null,
    shotId: input.shot && input.shot.shotId,
    targetKind: input.targetKind || null,
    warnings: [],
    blockers: [],
  };
  try {
    if (!input.targetKind) {
      result.status = STATUS.PROMPT_TARGET_REQUIRED;
      result.blockers.push("PROMPT_TARGET_REQUIRED: caller must supply targetKind (IMAGE | VIDEO)");
      return result;
    }

    // Creative Memory is advisory only (§26): its text never enters the
    // compiled prompt; only explainable warnings are attached to the result.
    if (options.creativeMemoryContext) {
      result.memoryAdvisory = { advisoryOnly: true, ...options.creativeMemoryContext };
    }

    const built = specLib.buildPromptSpec(input);
    if (!built.ok) {
      result.status = built.code === "CONTINUITY_CONFLICT" ? STATUS.PROMPT_PACKAGE_BLOCKED : STATUS.FAILED;
      result.blockers.push(`${built.code}: ${built.message || ""}`.trim());
      if (built.conflicts) result.conflicts = built.conflicts;
      return result;
    }
    const spec = built.spec;

    const compiled = compiler.compilePrompt(spec, input.targetKind, { budgetChars: options.budgetChars });
    if (!compiled.ok) {
      result.status = compiled.code === "PROMPT_TARGET_REQUIRED" || compiled.code === "UNKNOWN_TARGET_KIND"
        ? STATUS.PROMPT_TARGET_REQUIRED
        : STATUS.PROMPT_PACKAGE_BLOCKED;
      result.blockers.push(`${compiled.code}: ${compiled.message || ""}`.trim());
      return result;
    }

    const platformComposition = shared.readPlatformComposition(input.platform);
    const pkg = {
      version: shared.COMPILER_VERSION,
      promptPackageId: shared.id12("pp", { specId: spec.promptSpecId, targetKind: input.targetKind, adapter: compiled.adapterVersion }),
      projectId: input.projectId,
      sceneId: spec.sceneId,
      shotId: spec.shotId,
      targetKind: input.targetKind,
      sourceRefs: spec.sourceRefs,
      referenceRefs: spec.referenceRefs,
      continuityLockRef: spec.mustPreserve,
      promptSpec: spec,
      compiledPrompt: compiled.compiledPrompt,
      generationMetadata: {
        ...compiled.generationMetadata,
        platformComposition,
        budgetChars: compiled.budgetChars,
      },
      requiredCapabilities: compiled.requiredCapabilities,
      adapterId: compiled.adapterId,
      adapterVersion: compiled.adapterVersion,
      sections: compiled.sections,
      droppedForBudget: compiled.droppedForBudget,
      validation: null,
      fingerprint: shared.hash16({ spec: spec.fingerprint, targetKind: input.targetKind, prompt: compiled.compiledPrompt, adapter: compiled.adapterVersion }),
      status: "DRAFT",
      createdAt: input.now || new Date().toISOString(),
      updatedAt: input.now || new Date().toISOString(),
    };

    const validation = validator.validatePromptPackage({
      pkg,
      context: { beatMap: input.beatMap, referenceAssets: input.referenceAssets },
    });
    pkg.validation = validation;
    pkg.status = validation.valid ? "VALID" : "BLOCKED";

    result.validation = validation;
    result.promptPackageId = pkg.promptPackageId;
    result.promptSpecId = spec.promptSpecId;
    result.promptSpec = spec;
    result.referenceRefs = spec.referenceRefs;
    result.mustPreserve = spec.mustPreserve;
    result.fingerprint = pkg.fingerprint;
    result.compiledPrompt = pkg.compiledPrompt;
    result.requiredCapabilities = pkg.requiredCapabilities;
    result.generationMetadata = pkg.generationMetadata;
    result.sections = pkg.sections;
    result.droppedForBudget = pkg.droppedForBudget;

    if (!validation.valid) {
      result.status = STATUS.PROMPT_PACKAGE_BLOCKED;
      result.blockers.push(...validation.errors.map((e) => `${e.code}: ${e.message}`));
      if (options.persist !== false && options.root) {
        store.persistPromptPackage(options.root, input.projectId, { ...pkg, _force: options.force === true });
      }
      return result;
    }

    result.status = STATUS.PROMPT_PACKAGE_VALID;
    result.ok = true;

    if (options.root && options.persist !== false) {
      const saved = store.persistPromptPackage(options.root, input.projectId, { ...pkg, _force: options.force === true });
      if (!saved.ok) {
        result.status = saved.code === "PROMPT_LOCKED" ? STATUS.PROMPT_LOCKED : STATUS.FAILED;
        result.blockers.push(`${saved.code}: ${saved.message || ""}`.trim());
        result.ok = false;
        return result;
      }
    }
    return result;
  } catch (e) {
    result.status = STATUS.FAILED;
    result.blockers.push(`UNEXPECTED: ${String((e && e.message) || e)}`);
    return result;
  }
}

/**
 * Compile packages for many shots of a plan (long-form scaling, §48).
 * targetKind is still caller-supplied for every package.
 */
async function compilePlanPackages(input = {}, options = {}) {
  const out = { ok: true, packages: [], blocked: [], compiled: 0, elapsedMs: 0 };
  const t0 = Date.now();
  const { shotPlan, sceneGraph, beatMap } = input;
  const sceneById = new Map(sceneGraph.scenes.map((s) => [s.sceneId, s]));
  for (const shot of shotPlan.shots) {
    const r = await compilePromptPackage({
      ...input,
      shot,
      scene: sceneById.get(shot.parentSceneId),
      beatMap,
    }, options);
    if (r.ok) { out.packages.push(r); out.compiled++; }
    else out.blocked.push({ shotId: shot.shotId, status: r.status, blockers: r.blockers });
  }
  out.elapsedMs = Date.now() - t0;
  return out;
}

module.exports = {
  STATUS,
  compilePromptPackage,
  compilePlanPackages,
  buildPromptSpec: specLib.buildPromptSpec,
  compilePrompt: compiler.compilePrompt,
  validatePromptPackage: validator.validatePromptPackage,
  checkPackageStaleness: store.checkPackageStaleness,
  invalidateByReference: store.invalidateByReference,
  loadPromptPackage: store.loadPromptPackage,
  listPromptPackages: store.listPromptPackages,
  persistPromptPackage: store.persistPromptPackage,
  shared,
  stableStringify,
};
