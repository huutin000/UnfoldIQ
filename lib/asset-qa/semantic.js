"use strict";

/**
 * Phase 1G.11 — semantic QA layer.
 * correct scene / subject / action / motion intent / accidental text /
 * usable composition / expected media type. Expected intent comes ONLY from
 * canonical upstream artifacts (never inferred from the asset). No visual
 * understanding is claimed without an actual observation: missing
 * observation fields are UNKNOWN, never PASS.
 */

const shared = require("./shared.js");
const motionLib = require("./motion.js");

/**
 * evaluateSemantic(expectation, observation)
 * expectation: { sceneId?, shotId?, expectedSubject[]?, expectedAction[]?,
 *   expectedEnvironment[]?, expectedMediaType?, expectedComposition?,
 *   textPolicy?: { allowText?: bool, modality?: string },
 *   expectedMotion?: motion-expected-shape }
 * observation: null | { source?, sceneId?, subjects[]?, actions[]?,
 *   environment?, mediaType?, hasText?, textRegions[]?, compositionUsable?,
 *   reframedOnly?, motionObservation? }
 */
function evaluateSemantic(expectation = {}, observation = null) {
  const checks = [];
  const evidence = [];
  const reasons = [];
  let fail = 0;
  let unkCritical = 0;

  function push(check, status, severity, reason, blocking, evExtra) {
    checks.push(shared.checkEntry(check, status, severity, reason, blocking));
    if (status === "FAIL") fail++;
    if (status === "UNKNOWN" && blocking) unkCritical++;
    if (reason && (status === "FAIL" || (status === "UNKNOWN" && blocking))) reasons.push(`${check}: ${reason}`);
    if (evExtra) evidence.push(evExtra);
  }

  function ev(check, source, expected, observed, comparison, confidence) {
    return shared.makeEvidence({ layer: "semantic", check, source, expected, observed, comparison, confidence });
  }

  const src = (observation && observation.source) || null;
  if (!observation || !src) {
    for (const c of ["scene", "subject", "action", "media-type"]) {
      push(c, "UNKNOWN", "ERROR", "no visual/manual/structured observation available", true);
    }
    push("text", "UNKNOWN", "WARNING", "text presence unobservable", false);
    push("composition", "UNKNOWN", "WARNING", "composition unobservable", false);
    if (expectation.expectedMotion) {
      const m = motionLib.evaluateMotionIntegrity("semantic", expectation.expectedMotion, null, { blocking: true });
      for (const c of m.checks) checks.push(c);
      for (const e of m.evidence) evidence.push(e);
      unkCritical++;
      reasons.push("motion: unobservable with available evidence (MANUAL_REVIEW_REQUIRED)");
    }
    return shared.layerResult({ status: "UNKNOWN", severity: "ERROR", blocking: true, checks, evidence, reasons });
  }

  // scene
  if (expectation.sceneId) {
    if (!observation.sceneId) push("scene", "UNKNOWN", "ERROR", "observed scene unrecorded", true);
    else if (observation.sceneId === expectation.sceneId) {
      push("scene", "PASS", "INFO", null, false, ev("scene", src, expectation.sceneId, observation.sceneId, "match", observation.confidence));
    } else {
      push("scene", "FAIL", "ERROR", `expected scene ${expectation.sceneId} but observed ${observation.sceneId}`, true,
        ev("scene", src, expectation.sceneId, observation.sceneId, "mismatch", observation.confidence));
    }
  } else {
    checks.push(shared.checkEntry("scene", "NOT_APPLICABLE", "INFO", "no upstream scene expectation", false));
  }

  // subject
  const expSub = Array.isArray(expectation.expectedSubject) ? expectation.expectedSubject : [];
  if (expSub.length > 0) {
    const obsSub = Array.isArray(observation.subjects) ? observation.subjects : null;
    if (!obsSub) {
      push("subject", "UNKNOWN", "ERROR", "observed subject unrecorded", true);
    } else {
      const missing = expSub.filter((s) => !obsSub.map(String).includes(String(s)));
      if (missing.length === 0) {
        push("subject", "PASS", "INFO", null, false, ev("subject", src, expSub, obsSub, "match", observation.confidence));
      } else {
        push("subject", "FAIL", "ERROR", `wrong/missing subject: expected [${expSub}] observed [${obsSub}]`, true,
          ev("subject", src, expSub, obsSub, "mismatch", observation.confidence));
      }
    }
  } else {
    checks.push(shared.checkEntry("subject", "NOT_APPLICABLE", "INFO", "no upstream subject expectation", false));
  }

  // action
  const expAct = Array.isArray(expectation.expectedAction) ? expectation.expectedAction : [];
  if (expAct.length > 0) {
    const obsAct = Array.isArray(observation.actions) ? observation.actions : null;
    if (!obsAct) {
      push("action", "UNKNOWN", "ERROR", "observed action unrecorded", true);
    } else {
      const missing = expAct.filter((a) => !obsAct.map(String).includes(String(a)));
      if (missing.length === 0) {
        push("action", "PASS", "INFO", null, false, ev("action", src, expAct, obsAct, "match", observation.confidence));
      } else {
        push("action", "FAIL", "ERROR", `wrong/incomplete action: expected [${expAct}] observed [${obsAct}]`, true,
          ev("action", src, expAct, obsAct, "mismatch", observation.confidence));
      }
    }
  } else {
    checks.push(shared.checkEntry("action", "NOT_APPLICABLE", "INFO", "no upstream action expectation", false));
  }

  // motion intent (asset-level temporal integrity inside semantic layer)
  if (expectation.expectedMotion) {
    const m = motionLib.evaluateMotionIntegrity("semantic", expectation.expectedMotion, observation.motionObservation || null, { blocking: true });
    for (const c of m.checks) {
      checks.push(c);
      if (c.status === "FAIL") fail++;
      if (c.status === "UNKNOWN" && c.blocking) unkCritical++;
    }
    for (const e of m.evidence) evidence.push(e);
    for (const r of m.reasons) reasons.push(r);
  }

  // accidental text (typography modality exempts intentional text)
  const allowText = !!(expectation.textPolicy && expectation.textPolicy.allowText);
  const modality = expectation.textPolicy && expectation.textPolicy.modality;
  if (observation.hasText === undefined || observation.hasText === null) {
    push("text", "UNKNOWN", "WARNING", "text presence unobservable", false);
  } else if (observation.hasText === true && !(allowText || modality === "TYPOGRAPHY")) {
    push("text", "FAIL", "ERROR", `accidental text/logo/watermark: ${JSON.stringify(observation.textRegions || ["unlabelled"])}`, true,
      ev("text", src, "no accidental text", observation.textRegions || "text present", "mismatch", observation.confidence));
  } else {
    push("text", "PASS", "INFO", null, false, ev("text", src, allowText ? "text allowed" : "no text", observation.hasText ? "text present (expected)" : "no text", "match", observation.confidence));
  }

  // composition usability (task-specific only; platform reframe is not failure)
  if (observation.compositionUsable === undefined || observation.compositionUsable === null) {
    push("composition", "UNKNOWN", "WARNING", "composition usability unrecorded", false);
  } else if (observation.compositionUsable === false && !observation.reframedOnly) {
    push("composition", "FAIL", "ERROR", "key subject/action cropped or required safe area missing", true);
  } else {
    push("composition", "PASS", "INFO", null, false);
  }

  // expected media type
  if (expectation.expectedMediaType) {
    if (!observation.mediaType) {
      push("media-type", "UNKNOWN", "ERROR", "observed media type unrecorded", true);
    } else if (observation.mediaType === expectation.expectedMediaType) {
      push("media-type", "PASS", "INFO", null, false);
    } else {
      push("media-type", "FAIL", "ERROR", `expected media ${expectation.expectedMediaType} but observed ${observation.mediaType}`, true);
    }
  } else {
    checks.push(shared.checkEntry("media-type", "NOT_APPLICABLE", "INFO", "no upstream media-type expectation", false));
  }

  const status = fail > 0 ? "FAIL" : unkCritical > 0 ? "UNKNOWN" : checks.some((c) => c.status === "UNKNOWN") ? "UNKNOWN" : "PASS";
  return shared.layerResult({
    status,
    severity: fail > 0 ? "BLOCKER" : unkCritical > 0 ? "ERROR" : status === "UNKNOWN" ? "WARNING" : "INFO",
    blocking: fail > 0 || unkCritical > 0,
    checks,
    evidence,
    reasons,
  });
}

module.exports = { evaluateSemantic };
