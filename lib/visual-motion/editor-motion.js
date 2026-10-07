"use strict";

/**
 * Editor-motion capability vocabulary + structured plan builder (1G.5 §11, §29).
 *
 * These are production CONCEPTS (what movement to synthesize from still
 * assets), not renderer instructions. This module never emits Remotion code,
 * frame timestamps, or timing — a later render layer maps techniques to an
 * editor implementation.
 */

const shared = require("./shared.js");

const TECHNIQUES = [
  "PAN",
  "ZOOM",
  "KEN_BURNS",
  "CROP_REFRAME",
  "PARALLAX_2_5D",
  "LAYER_REVEAL",
  "HIGHLIGHT",
  "POINTER",
  "MAP_ROUTE",
  "DIAGRAM_STEP",
  "TIMELINE_PROGRESS",
  "COMPARISON_SLIDE",
  "OBJECT_FOCUS",
  "TEXT_CALLOUT",
  "CROSSFADE",
  "MATCH_CUT",
];

/** Baseline technique set per visual type (caller motion signals refine it). */
const BASELINE_TECHNIQUES = {
  MAP: ["MAP_ROUTE", "PAN", "ZOOM"],
  TIMELINE: ["TIMELINE_PROGRESS", "PAN", "ZOOM"],
  DIAGRAM: ["DIAGRAM_STEP", "HIGHLIGHT", "TEXT_CALLOUT"],
  COMPARISON: ["COMPARISON_SLIDE", "CROP_REFRAME"],
  EVIDENCE: ["ZOOM", "OBJECT_FOCUS", "HIGHLIGHT", "CROSSFADE"],
  OBJECT: ["OBJECT_FOCUS", "ZOOM", "PARALLAX_2_5D", "CROP_REFRAME"],
  ENVIRONMENT: ["PAN", "ZOOM", "KEN_BURNS", "PARALLAX_2_5D"],
  CHARACTER_SCENE: ["PAN", "ZOOM", "PARALLAX_2_5D", "LAYER_REVEAL"],
};

/** Extra asset roles some techniques genuinely need (beyond PRIMARY_IMAGE). */
const TECHNIQUE_ASSET_ROLES = {
  PARALLAX_2_5D: ["BACKGROUND_LAYER", "FOREGROUND_LAYER"],
  LAYER_REVEAL: ["BACKGROUND_LAYER", "FOREGROUND_LAYER"],
  MAP_ROUTE: ["MAP_BASE"],
  DIAGRAM_STEP: ["DIAGRAM_BASE"],
  TIMELINE_PROGRESS: ["DIAGRAM_BASE"],
  POINTER: ["TEXTURE_LAYER"],
};

/**
 * Build a structured editor-motion plan. No timestamps, no renderer code.
 * Input: { shotId, visualType, techniques?, focusTarget?, direction?, intensity? }
 */
function buildEditorMotionPlan(input = {}) {
  if (!input.shotId) {
    return { ok: false, code: "EDITOR_PLAN_SOURCE_INVALID", message: "shotId is required" };
  }
  const baseline = BASELINE_TECHNIQUES[input.visualType] || ["PAN", "ZOOM"];
  const requested = Array.isArray(input.techniques) ? input.techniques : baseline;
  const techniques = [...new Set(requested)].filter((t) => TECHNIQUES.includes(t));
  if (techniques.length === 0) {
    return { ok: false, code: "EDITOR_TECHNIQUE_INVALID", message: "no valid editor-motion technique supplied" };
  }
  const layers = [...new Set(techniques.flatMap((t) => TECHNIQUE_ASSET_ROLES[t] || []))];
  const plan = {
    motionPlanId: shared.id12("mp", { shotId: input.shotId, techniques }),
    shotId: input.shotId,
    techniques,
    focusTarget: input.focusTarget || null,
    direction: input.direction || null,
    intensity: ["SUBTLE", "MODERATE", "STRONG"].includes(input.intensity) ? input.intensity : "MODERATE",
    relativeTiming: input.relativeTiming || null, // ordering hints only, never ms/frames
    layers,
    constraints: Array.isArray(input.constraints) ? input.constraints.slice(0, 8) : [],
    sourceImageRole: "PRIMARY_IMAGE",
  };
  return { ok: true, plan };
}

module.exports = { TECHNIQUES, BASELINE_TECHNIQUES, TECHNIQUE_ASSET_ROLES, buildEditorMotionPlan };
