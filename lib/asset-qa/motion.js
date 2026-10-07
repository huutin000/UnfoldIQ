"use strict";

/**
 * Phase 1G.11 — asset-level Temporal / Motion Integrity helper.
 * NOT a fifth top-level QA layer: structural / semantic / continuity layers
 * call into this provider-neutral observation contract. No fake observations:
 * anything unobservable is UNKNOWN, never PASS.
 */

const shared = require("./shared.js");

const MOTION_SOURCES = ["FRAME_SAMPLE", "PROVIDER_METADATA", "STATE_COMPARISON", "MANUAL_REVIEW"];

/**
 * buildMotionObservation({ assetId?, assetHash?, shotId?, expectedMotion?,
 *   observedMotion?: { source?, movementDirection?, actionCompleted?,
 *     gestureState?, objectTrajectory?, openingState?, endingState?,
 *     freezeSegments[]?, temporalArtifacts[]?, confidence? },
 *   evidenceRefs[]? }) → MotionObservation (pure container, no inference).
 */
function buildMotionObservation(input = {}) {
  const om = input.observedMotion || null;
  return {
    assetId: input.assetId || null,
    assetHash: input.assetHash || null,
    shotId: input.shotId || null,
    expectedMotion: input.expectedMotion === undefined ? null : input.expectedMotion,
    observedMotion: om,
    confidence: (om && om.confidence) || null,
    evidenceRefs: Array.isArray(input.evidenceRefs) ? input.evidenceRefs.map(String) : [],
  };
}

function availability(observation) {
  const om = observation && observation.observedMotion;
  if (!om || !MOTION_SOURCES.includes(om.source)) return "UNAVAILABLE";
  return "AVAILABLE";
}

function ev(layer, check, source, expected, observed, comparison, confidence) {
  return shared.makeEvidence({ layer, check, source, expected, observed, comparison, confidence });
}

// expected: { actionOccurs?: bool, direction?: string, gestureCompletes?: bool,
//   trajectory?: string, openingState?: string, endingState?: string }
// Returns { status, severity, blocking, checks[], evidence[], reasons[] }.
function evaluateMotionIntegrity(layer, expected = {}, observation = null, opts = {}) {
  const checks = [];
  const evidence = [];
  const reasons = [];
  let fail = 0;
  let unkCritical = 0;
  const avail = availability(observation);
  const om = (observation && observation.observedMotion) || {};
  const blocking = opts.blocking === true;

  function push(check, status, severity, reason, isBlocking) {
    checks.push(shared.checkEntry(check, status, severity, reason, isBlocking === true));
    if (status === "FAIL") fail++;
    if (status === "UNKNOWN" && isBlocking) unkCritical++;
    if (reason && (status === "FAIL" || (status === "UNKNOWN" && isBlocking))) reasons.push(`${check}: ${reason}`);
  }

  const required = expected.actionOccurs === true || expected.direction || expected.gestureCompletes === true
    || expected.trajectory || expected.openingState || expected.endingState;

  if (!required) {
    checks.push(shared.checkEntry("motion-required", "NOT_APPLICABLE", "INFO", "shot declares no motion contract", false));
    return { status: "NOT_APPLICABLE", checks, evidence, reasons, severity: "INFO", blocking: false };
  }

  if (avail === "UNAVAILABLE") {
    // MO14: unavailable observation → UNKNOWN, never PASS.
    for (const c of ["motion-occurs", "motion-direction", "motion-completion", "motion-trajectory", "motion-start-end"]) {
      push(c, "UNKNOWN", "WARNING", "motion unobservable with available evidence (MANUAL_REVIEW_REQUIRED)", blocking);
    }
    return {
      status: "UNKNOWN",
      severity: blocking ? "ERROR" : "WARNING",
      blocking,
      checks,
      evidence,
      reasons,
    };
  }

  const src = om.source;
  // action occurs
  if (expected.actionOccurs === true) {
    if (om.actionCompleted === true) {
      push("motion-occurs", "PASS", "INFO", null, false);
      evidence.push(ev(layer, "motion-occurs", src, "action occurs", "action observed", "match", om.confidence));
    } else if (om.actionCompleted === false) {
      push("motion-occurs", "FAIL", "ERROR", "expected temporal action absent", blocking);
      evidence.push(ev(layer, "motion-occurs", src, "action occurs", "static / no action", "mismatch", om.confidence));
    } else {
      push("motion-occurs", "UNKNOWN", "WARNING", "action occurrence unobservable", blocking);
    }
  }
  // direction
  if (expected.direction) {
    if (!om.movementDirection) {
      push("motion-direction", "UNKNOWN", "WARNING", "movement direction unobservable", blocking);
    } else if (String(om.movementDirection).toLowerCase() === String(expected.direction).toLowerCase()) {
      push("motion-direction", "PASS", "INFO", null, false);
      evidence.push(ev(layer, "motion-direction", src, expected.direction, om.movementDirection, "match", om.confidence));
    } else {
      push("motion-direction", "FAIL", "ERROR", `required direction ${expected.direction} but observed ${om.movementDirection}`, blocking);
      evidence.push(ev(layer, "motion-direction", src, expected.direction, om.movementDirection, "mismatch", om.confidence));
    }
  }
  // completion
  if (expected.gestureCompletes === true) {
    if (om.gestureState === "complete") {
      push("motion-completion", "PASS", "INFO", null, false);
    } else if (om.gestureState === "incomplete" || om.gestureState === "contradictory") {
      push("motion-completion", "FAIL", "ERROR", `gesture/action ${om.gestureState}`, blocking);
    } else {
      push("motion-completion", "UNKNOWN", "WARNING", "gesture completion unobservable", blocking);
    }
  }
  // trajectory
  if (expected.trajectory) {
    if (!om.objectTrajectory) {
      push("motion-trajectory", "UNKNOWN", "WARNING", "object trajectory unobservable", blocking);
    } else if (String(om.objectTrajectory).toLowerCase() === String(expected.trajectory).toLowerCase()) {
      push("motion-trajectory", "PASS", "INFO", null, false);
    } else {
      push("motion-trajectory", "FAIL", "ERROR", `required trajectory ${expected.trajectory} but observed ${om.objectTrajectory}`, blocking);
    }
  }
  // start/end state
  if (expected.openingState || expected.endingState) {
    const oOk = !expected.openingState || (om.openingState && String(om.openingState) === String(expected.openingState));
    const eOk = !expected.endingState || (om.endingState && String(om.endingState) === String(expected.endingState));
    if ((!expected.openingState || om.openingState) && (!expected.endingState || om.endingState)) {
      if (oOk && eOk) {
        push("motion-start-end", "PASS", "INFO", null, false);
      } else {
        const parts = [];
        if (!oOk) parts.push(`opening ${om.openingState} != locked ${expected.openingState}`);
        if (!eOk) parts.push(`ending ${om.endingState} != locked ${expected.endingState}`);
        push("motion-start-end", "FAIL", "ERROR", parts.join("; "), blocking);
      }
    } else {
      push("motion-start-end", "UNKNOWN", "WARNING", "start/end state unobservable", blocking);
    }
  }

  const status = fail > 0 ? "FAIL" : unkCritical > 0 ? "UNKNOWN" : checks.some((c) => c.status === "UNKNOWN") ? "UNKNOWN" : "PASS";
  return {
    status,
    severity: fail > 0 ? "ERROR" : status === "UNKNOWN" && blocking ? "ERROR" : status === "UNKNOWN" ? "WARNING" : "INFO",
    blocking: fail > 0 || unkCritical > 0,
    checks,
    evidence,
    reasons,
  };
}

module.exports = { MOTION_SOURCES, buildMotionObservation, availability, evaluateMotionIntegrity };
