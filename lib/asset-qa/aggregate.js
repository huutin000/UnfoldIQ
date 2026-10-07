"use strict";

/**
 * Phase 1G.11 — aggregate QA policy + timeline eligibility + targeted repair.
 * STRUCTURAL FAIL → REJECT; critical SEMANTIC/FACTUALITY/CONTINUITY FAIL →
 * REJECT; critical UNKNOWN → REVIEW_REQUIRED (timeline blocked); warning-only
 * follows policy. Repair recommends ONE affected shot/asset only.
 */

const shared = require("./shared.js");

function layerSeverityScore(layer) {
  if (!layer) return 0;
  if (layer.status === "FAIL") return layer.severity === "WARNING" ? 2 : 3;
  if (layer.status === "UNKNOWN") return layer.blocking ? 2 : 1;
  if (layer.status === "WARN") return 1;
  return 0;
}

function recommendationFor(failedLayers, unknownBlocking) {
  if (failedLayers.includes("structural")) return "REPLACE_ASSET";
  if (failedLayers.includes("continuity")) return "REGENERATE_SHOT";
  if (failedLayers.includes("factuality")) return "RELABEL";
  if (failedLayers.includes("semantic")) return "RECOMPOSE";
  if (unknownBlocking.length > 0) return "MANUAL_REVIEW";
  if (failedLayers.length > 0) return "REGENERATE_SHOT";
  return "NONE";
}

/**
 * aggregateQa({ structural, semantic, factuality, continuity }) →
 * { status, timelineEligible, severity, failedLayers[], warningLayers[],
 *   unknownLayers[], reasons[], recommendation }
 */
function aggregateQa(layers = {}) {
  const names = ["structural", "semantic", "factuality", "continuity"];
  const failedLayers = [];
  const warningLayers = [];
  const unknownLayers = [];
  const reasons = [];
  let worst = 0;

  for (const n of names) {
    const l = layers[n];
    if (!l || !l.status) {
      unknownLayers.push(n);
      reasons.push(`${n}: missing layer result treated as critical UNKNOWN`);
      worst = Math.max(worst, 2);
      continue;
    }
    if (l.status === "FAIL") {
      if (l.severity === "WARNING") {
        warningLayers.push(n);
        reasons.push(`${n}: FAIL at WARNING severity → review, not reject`);
        worst = Math.max(worst, 2);
      } else {
        failedLayers.push(n);
        for (const r of l.reasons || []) reasons.push(`${n}: ${r}`);
        if ((l.reasons || []).length === 0) reasons.push(`${n}: FAIL (${l.severity})`);
        worst = Math.max(worst, 3);
      }
    } else if (l.status === "UNKNOWN") {
      unknownLayers.push(n);
      if (l.blocking) {
        for (const r of l.reasons || []) reasons.push(`${n}: ${r}`);
        worst = Math.max(worst, 2);
      } else {
        warningLayers.push(n);
      }
    } else if (l.status === "WARN") {
      warningLayers.push(n);
    }
  }

  // NOT_APPLICABLE layers never block.
  let status = "READY_FOR_TIMELINE";
  let severity = "INFO";
  if (worst >= 3) {
    status = "REJECTED";
    severity = "BLOCKER";
  } else if (worst >= 2) {
    status = "REVIEW_REQUIRED";
    severity = "ERROR";
  } else if (warningLayers.length > 0 || unknownLayers.length > 0) {
    status = "READY_FOR_TIMELINE";
    severity = warningLayers.length > 0 || unknownLayers.length > 0 ? "WARNING" : "INFO";
  }

  const unknownBlocking = names.filter((n) => layers[n] && layers[n].status === "UNKNOWN" && layers[n].blocking);
  return {
    status,
    timelineEligible: status === "READY_FOR_TIMELINE",
    severity,
    failedLayers,
    warningLayers,
    unknownLayers,
    reasons,
    recommendation: recommendationFor(failedLayers, unknownBlocking),
  };
}

module.exports = { aggregateQa, layerSeverityScore };
