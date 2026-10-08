"use strict";

/**
 * Phase 3B — Motion System facade (UNFOLDIQ CORE).
 *
 * Agent-ready contract (§34): buildMotionPlan / getMotionPlan /
 * validateMotionPlan / patchMotion / getMotionFindings. Structured results
 * only, no UI. No external MCP/public API freeze before V1 (RULE 18).
 */

const primitives = require("./primitives.js");
const timingLib = require("./timing.js");
const grammarLib = require("./grammar.js");
const planLib = require("./motion-plan.js");

module.exports = {
  ...planLib,
  primitives,
  timing: timingLib,
  grammar: grammarLib,
  PRIMITIVE_REGISTRY_VERSION: primitives.REGISTRY_VERSION,
  TIMING_VERSION: timingLib.TIMING_VERSION,
  GRAMMAR_POLICY_VERSION: grammarLib.MOTION_GRAMMAR_POLICY_VERSION,
};
