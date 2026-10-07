"use strict";

/**
 * Prompt Compiler core (1G.4). LAZY compilation: targetKind is ALWAYS
 * supplied by the caller — the compiler never infers IMAGE vs VIDEO and
 * never selects a model (§2, §22, §40).
 */

const imageAdapter = require("./adapters/image-generic.js");
const videoAdapter = require("./adapters/video-generic.js");

const ADAPTERS = {
  IMAGE: imageAdapter,
  VIDEO: videoAdapter,
};

/**
 * compilePrompt(spec, targetKind, opts) -> {ok, ...adapter result}
 * opts: { budgetChars?, adapterVersion? }
 */
function compilePrompt(spec, targetKind, opts = {}) {
  if (!spec || !spec.promptSpecId) {
    return { ok: false, code: "PROMPT_SPEC_INVALID", message: "a canonical Prompt Spec is required" };
  }
  if (!targetKind) {
    return { ok: false, code: "PROMPT_TARGET_REQUIRED", message: "targetKind must be supplied by the caller; the compiler never infers it" };
  }
  const adapter = ADAPTERS[targetKind];
  if (!adapter) {
    return { ok: false, code: "UNKNOWN_TARGET_KIND", message: `targetKind must be IMAGE | VIDEO (got ${targetKind})` };
  }
  const result = adapter.compile(spec, opts);
  if (!result.ok) return result;
  return { ok: true, targetKind, ...result };
}

module.exports = { compilePrompt, ADAPTERS };
