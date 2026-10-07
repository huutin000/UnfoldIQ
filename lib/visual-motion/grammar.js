"use strict";

/**
 * UNFOLDIQ Visual Story Grammar owner — Stage A of Roadmap V6 1G.5
 * (FIX 1). Answers ONE question per shot:
 *
 *   Which visual modality best communicates this beat?
 *
 * Modality is meaning-first: it derives from narrative communication need
 * (structured intent flags, motion-informed evidence, beat lineage) — never
 * from renderer availability, provider preference, model names, or credit
 * pressure. The renderer decision (Stage B) runs AFTER, and separately.
 *
 * visualType (broad content/asset category) and visualModality (storytelling
 * form) are deliberately distinct fields. Example: visualType =
 * CHARACTER_SCENE may become CHARACTER_MOMENT, RECONSTRUCTION, or ATMOSPHERE
 * depending on actual intent — never by blanket mapping.
 *
 * No provider calls, no models, no prices, no rendering. Deterministic.
 */

const shared = require("./shared.js");

/**
 * Structured communication-need flags (caller/analyst supplied booleans).
 * Each maps to exactly one modality; priority order below is the documented
 * precedence when several are true (reconstruction/emotional intent first,
 * then informational forms).
 */
const INTENT_MODALITY = [
  { flag: "reconstructionIntent", modality: "RECONSTRUCTION", label: "factual or plausible reconstruction" },
  { flag: "emotionalCharacterBeat", modality: "CHARACTER_MOMENT", label: "emotional or character-centered beat" },
  { flag: "numericTrend", modality: "CHART", label: "number / trend" },
  { flag: "historicalSequence", modality: "TIMELINE", label: "historical sequence" },
  { flag: "spatialMovement", modality: "MAP", label: "location / movement through space" },
  { flag: "mechanismProcess", modality: "DIAGRAM", label: "process / mechanism" },
  { flag: "evidenceLabeling", modality: "ANNOTATION", label: "evidence needing focus / labeling" },
  { flag: "conceptualAnalogy", modality: "METAPHOR", label: "conceptual abstraction" },
  { flag: "textualEmphasis", modality: "TYPOGRAPHY", label: "title / quotation / key phrase as the visual itself" },
  { flag: "kineticGraphic", modality: "MOTION_GRAPHIC", label: "complex explanatory animated graphic" },
  { flag: "moodWorld", modality: "ATMOSPHERE", label: "mood / world / tension" },
];

/** visualType → modality default used ONLY when no intent/motion evidence exists. */
const TYPE_DEFAULT_MODALITY = {
  MAP: "MAP",
  TIMELINE: "TIMELINE",
  DIAGRAM: "DIAGRAM",
  COMPARISON: "COMPARISON",
  EVIDENCE: "ANNOTATION",
  OBJECT: "ANNOTATION",
  ENVIRONMENT: "ATMOSPHERE",
};

/** Honest alternatives recorded alongside the primary choice. */
const TYPE_ALTERNATIVES = {
  MAP: ["ATMOSPHERE"],
  TIMELINE: ["CHART", "TYPOGRAPHY"],
  DIAGRAM: ["MOTION_GRAPHIC", "ANNOTATION"],
  COMPARISON: ["SPLIT_SCREEN", "CHART"],
  EVIDENCE: ["TYPOGRAPHY", "CHART", "COMPARISON"],
  OBJECT: ["TYPOGRAPHY"],
  ENVIRONMENT: ["MAP", "RECONSTRUCTION", "METAPHOR"],
  CHARACTER_SCENE: ["RECONSTRUCTION", "ATMOSPHERE"],
};

/**
 * Classify the visual modality for one shot.
 * Input: { shot, scene, beats?, visualType, signals? }
 * signals may carry: visualModality (explicit), requireModalityReview,
 *   the INTENT_MODALITY flags, sideBySideDifference (+simultaneousPresentation),
 *   and motion flags (subjectMovement, physicalInteraction,
 *   environmentalDynamics, temporalTransformation) as motion-informed evidence.
 */
function classifyVisualModality(input = {}) {
  const { shot, scene, visualType } = input;
  const signals = input.signals || {};
  const beats = Array.isArray(input.beats) ? input.beats : [];
  const reasons = [];
  const beatLineage = {
    beatIds: (shot && shot.beatIds ? shot.beatIds.slice() : []),
    narrativeRoles: [...new Set(beats.map((b) => b.narrativeRole).filter(Boolean))],
    narrativePurpose: (scene && scene.narrativePurpose) || null,
    visualObjective: (scene && scene.visualObjective) || (shot && shot.visualObjective) || null,
    shotPurpose: (shot && shot.shotPurpose) || null,
  };

  const finish = (modality, source, confidence, alternatives) => ({
    modality,
    source,
    confidence,
    reasons,
    alternatives: alternatives || [],
    beatLineage,
    reviewRequired: modality === null,
  });

  // 1. Explicit caller modality wins (validated, never blind).
  if (signals.visualModality !== undefined && signals.visualModality !== null) {
    const normalized = shared.normalizeModality(signals.visualModality);
    if (!shared.VISUAL_MODALITIES.includes(normalized)) {
      reasons.push(`unknown visualModality "${signals.visualModality}": refusing to guess`);
      return finish(null, "invalid", null, []);
    }
    reasons.push(`visualModality = ${normalized} (explicit caller signal over ${visualType || "unknown type"})`);
    return finish(normalized, "explicit", "HIGH", TYPE_ALTERNATIVES[visualType] || []);
  }

  // 2. Caller-declared insufficient semantics → REVIEW, no guess.
  if (signals.requireModalityReview === true) {
    reasons.push("caller reports insufficient semantic detail: modality REVIEW required, no guessing");
    return finish(null, "insufficient", null, []);
  }

  // 3. Meaning-first intent flags (priority order = documented precedence).
  const matched = INTENT_MODALITY.filter((rule) => signals[rule.flag] === true);
  // side-by-side difference is special: simultaneous presentation → SPLIT_SCREEN.
  if (signals.sideBySideDifference === true) {
    const m = signals.simultaneousPresentation === true ? "SPLIT_SCREEN" : "COMPARISON";
    reasons.push(`visualModality = ${m} (side-by-side difference${signals.simultaneousPresentation === true ? " with simultaneous presentation" : ""})`);
    const others = matched.map((r) => r.modality).filter((x) => x !== m);
    return finish(m, "intent", "HIGH", [...new Set([...others, ...(TYPE_ALTERNATIVES[visualType] || [])])].slice(0, 3));
  }
  if (matched.length > 0) {
    const primary = matched[0];
    reasons.push(`visualModality = ${primary.modality} (${primary.label})`);
    if (matched.length > 1) {
      reasons.push(`additional true intents noted as alternatives: ${matched.slice(1).map((r) => r.modality).join(", ")}`);
    }
    const alternatives = [...new Set([...matched.slice(1).map((r) => r.modality), ...(TYPE_ALTERNATIVES[visualType] || [])])].slice(0, 3);
    return finish(primary.modality, "intent", "HIGH", alternatives);
  }

  // 4. Motion-informed evidence (real movement shapes the form, still no guessing).
  if (visualType === "CHARACTER_SCENE" && (signals.subjectMovement === true || signals.physicalInteraction === true)) {
    reasons.push("visualModality = CHARACTER_MOMENT (character-centered movement evident, no finer intent supplied)");
    return finish("CHARACTER_MOMENT", "motion-informed", "MEDIUM", TYPE_ALTERNATIVES.CHARACTER_SCENE.slice(0, 2));
  }
  if (visualType === "ENVIRONMENT" && signals.environmentalDynamics === true) {
    reasons.push("visualModality = ATMOSPHERE (environmental dynamics carry the mood)");
    return finish("ATMOSPHERE", "motion-informed", "MEDIUM", ["MAP", "RECONSTRUCTION"]);
  }
  if (signals.temporalTransformation === true && visualType === "CHARACTER_SCENE") {
    reasons.push("visualModality = CHARACTER_MOMENT (character transformation over time)");
    return finish("CHARACTER_MOMENT", "motion-informed", "MEDIUM", TYPE_ALTERNATIVES.CHARACTER_SCENE.slice(0, 2));
  }

  // 5. visualType-compat default (honest baseline, LOW confidence, alternatives listed).
  const def = TYPE_DEFAULT_MODALITY[visualType];
  if (def) {
    reasons.push(`visualModality = ${def} (compat default for visualType ${visualType}; refine with intent flags when known)`);
    return finish(def, "type-default", "LOW", (TYPE_ALTERNATIVES[visualType] || []).slice(0, 2));
  }

  // 6. Nothing to stand on → REVIEW.
  reasons.push(`no intent, motion, or compat evidence for visualType ${visualType || "unknown"}: modality REVIEW required`);
  return finish(null, "insufficient", null, []);
}

/**
 * Cap a production recommendation by modality honesty (Stage A constrains
 * Stage B: a chart never needs generated video). Returns { capped,
 * recommendation, reason }.
 */
function applyModalityCap(modality, recommendation) {
  const cap = shared.MODALITY_STRATEGY_CAP[modality];
  if (!cap || !recommendation) return { capped: false, recommendation };
  if (shared.COST_ORDER[recommendation] > shared.COST_ORDER[cap]) {
    return {
      capped: true,
      recommendation: cap,
      reason: `capped at ${cap}: modality ${modality} is honestly expressed as still or deterministic motion, never generated video`,
    };
  }
  return { capped: false, recommendation };
}

module.exports = {
  INTENT_MODALITY,
  TYPE_DEFAULT_MODALITY,
  TYPE_ALTERNATIVES,
  classifyVisualModality,
  applyModalityCap,
};
