"use strict";

/**
 * Phase 1G.11 — continuity QA layer.
 * Character / world / motion continuity against canonical Bibles, locked
 * 1G.10 references, agent instructions and previous approved shot state.
 * The newest generated asset never becomes identity truth by itself.
 * Approved changes (outfit / location transition / time jump / story-directed
 * motion change) PASS when matched; platform reframe alone is never failure.
 */

const shared = require("./shared.js");
const motionLib = require("./motion.js");

const DOMAINS = [
  "faceIdentity",
  "hair",
  "clothing",
  "location",
  "props",
  "timeOfDay",
  "paletteStyle",
  "startState",
  "endState",
  "motionContinuity",
];

/**
 * evaluateContinuity({ sources?, expectation?, observation?, prevState? })
 * sources: { characterBible?, worldBible?, visualBible?, lockedReferences?,
 *   instructionVersion?, continuityStrictness? }
 * expectation: { characterId?, hair?, clothing?, location?, requiredProps[]?,
 *   timeOfDay?, paletteStyle?, startState?, endState?,
 *   approvedOutfitChange?, sceneTransitionTo?, timeJumpDeclared?,
 *   expectedMotion?: motion-expected-shape }
 * observation: null | { source?, identity?, hair?, clothing?, location?,
 *   propsPresent[]?, timeOfDay?, paletteStyle?, startState?, endState?,
 *   reframedOnly?, motionObservation?, storyDirectedMotionChange? }
 */
function evaluateContinuity(input = {}) {
  const checks = [];
  const evidence = [];
  const reasons = [];
  let fail = 0;
  let unkCritical = 0;
  const exp = input.expectation || {};
  const ob = input.observation || null;
  const strictness = (input.sources && input.sources.continuityStrictness) || "NORMAL";

  function push(domain, status, severity, reason, blocking, evExtra) {
    checks.push(shared.checkEntry(domain, status, severity, reason, blocking));
    if (status === "FAIL") fail++;
    if (status === "UNKNOWN" && blocking) unkCritical++;
    if (reason && (status === "FAIL" || (status === "UNKNOWN" && blocking))) reasons.push(`${domain}: ${reason}`);
    if (evExtra) evidence.push(evExtra);
  }

  function ev(domain, expected, observed, comparison, confidence) {
    return shared.makeEvidence({
      layer: "continuity", check: domain, source: (ob && ob.source) || null,
      expected, observed, comparison, confidence,
    });
  }

  const relevant = (v) => v !== undefined && v !== null;
  // Identity-family UNKNOWN blocks when the domain is continuity-relevant.
  const blocksWhenUnknown = (domain) => {
    if (domain === "faceIdentity") return strictness === "STRICT" || strictness === "NORMAL" || relevant(exp.characterId);
    return relevant(exp[{ faceIdentity: "characterId", hair: "hair", clothing: "clothing", location: "location", timeOfDay: "timeOfDay", paletteStyle: "paletteStyle", startState: "startState", endState: "endState" }[domain]]);
  };

  if (!ob || !ob.source) {
    for (const d of ["faceIdentity", "location", "startState", "endState"]) {
      if (relevant(exp[{ faceIdentity: "characterId", location: "location", startState: "startState", endState: "endState" }[d]])) {
        push(d, "UNKNOWN", "ERROR", "continuity observation unavailable", true);
      } else {
        checks.push(shared.checkEntry(d, "NOT_APPLICABLE", "INFO", "no continuity expectation for this domain", false));
      }
    }
    for (const d of ["hair", "clothing", "props", "timeOfDay", "paletteStyle", "motionContinuity"]) {
      checks.push(shared.checkEntry(d, "UNKNOWN", "WARNING", "continuity observation unavailable", false));
    }
    return shared.layerResult({ status: unkCritical > 0 ? "UNKNOWN" : "UNKNOWN", severity: unkCritical > 0 ? "ERROR" : "WARNING", blocking: unkCritical > 0, checks, evidence, reasons });
  }

  // face/identity
  if (relevant(exp.characterId)) {
    if (!relevant(ob.identity)) push("faceIdentity", "UNKNOWN", "ERROR", `expected identity ${exp.characterId}; unobservable`, true);
    else if (String(ob.identity) !== String(exp.characterId)) {
      push("faceIdentity", "FAIL", "BLOCKER", `WRONG_CHARACTER: expected ${exp.characterId} but observed ${ob.identity}`, true,
        ev("faceIdentity", exp.characterId, ob.identity, "mismatch", ob.confidence));
    } else push("faceIdentity", "PASS", "INFO", null, false, ev("faceIdentity", exp.characterId, ob.identity, "match", ob.confidence));
  } else checks.push(shared.checkEntry("faceIdentity", "NOT_APPLICABLE", "INFO", "no identity expectation", false));

  // hair
  if (relevant(exp.hair)) {
    if (!relevant(ob.hair)) push("hair", "UNKNOWN", "WARNING", "hair unobservable", blocksWhenUnknown("hair"));
    else if (ob.reframedOnly && String(ob.hair) !== String(exp.hair)) push("hair", "PASS", "INFO", "platform reframe is not identity failure", false);
    else if (String(ob.hair) !== String(exp.hair)) {
      push("hair", "FAIL", "ERROR", `hair mutation: expected ${exp.hair} observed ${ob.hair}`, true, ev("hair", exp.hair, ob.hair, "mismatch", ob.confidence));
    } else push("hair", "PASS", "INFO", null, false);
  } else checks.push(shared.checkEntry("hair", "NOT_APPLICABLE", "INFO", "no hair expectation", false));

  // clothing (approved change passes when matched)
  if (relevant(exp.clothing)) {
    if (!relevant(ob.clothing)) push("clothing", "UNKNOWN", "WARNING", "clothing unobservable", blocksWhenUnknown("clothing"));
    else if (String(ob.clothing) !== String(exp.clothing)) {
      if (exp.approvedOutfitChange && String(ob.clothing) === String(exp.approvedOutfitChange)) {
        push("clothing", "PASS", "INFO", null, false, ev("clothing", exp.approvedOutfitChange, ob.clothing, "approved change matched", ob.confidence));
      } else {
        push("clothing", "FAIL", "ERROR", `unapproved outfit change: expected ${exp.clothing} observed ${ob.clothing}`, true,
          ev("clothing", exp.clothing, ob.clothing, "mismatch", ob.confidence));
      }
    } else push("clothing", "PASS", "INFO", null, false);
  } else checks.push(shared.checkEntry("clothing", "NOT_APPLICABLE", "INFO", "no clothing expectation", false));

  // location (explicit transition passes)
  if (relevant(exp.location)) {
    if (!relevant(ob.location)) push("location", "UNKNOWN", "ERROR", `expected location ${exp.location}; unobservable`, true);
    else if (String(ob.location) !== String(exp.location)) {
      if (exp.sceneTransitionTo && String(ob.location) === String(exp.sceneTransitionTo)) {
        push("location", "PASS", "INFO", null, false, ev("location", exp.sceneTransitionTo, ob.location, "declared transition matched", ob.confidence));
      } else {
        push("location", "FAIL", "ERROR", `WRONG_LOCATION: expected ${exp.location} observed ${ob.location}`, true,
          ev("location", exp.location, ob.location, "mismatch", ob.confidence));
      }
    } else push("location", "PASS", "INFO", null, false);
  } else checks.push(shared.checkEntry("location", "NOT_APPLICABLE", "INFO", "no location expectation", false));

  // props (only continuity-relevant props block)
  const reqProps = Array.isArray(exp.requiredProps) ? exp.requiredProps : [];
  if (reqProps.length > 0) {
    const present = Array.isArray(ob.propsPresent) ? ob.propsPresent.map(String) : null;
    if (!present) push("props", "UNKNOWN", "WARNING", "prop presence unobservable", false);
    else {
      const missing = reqProps.filter((p) => !present.includes(String(p)));
      if (missing.length > 0) push("props", "FAIL", "ERROR", `required prop(s) disappeared: ${missing.join(", ")}`, true);
      else push("props", "PASS", "INFO", null, false);
    }
  } else checks.push(shared.checkEntry("props", "NOT_APPLICABLE", "INFO", "no continuity-relevant props tracked", false));

  // time of day
  if (relevant(exp.timeOfDay)) {
    if (!relevant(ob.timeOfDay)) push("timeOfDay", "UNKNOWN", "WARNING", "time of day unobservable", false);
    else if (String(ob.timeOfDay) !== String(exp.timeOfDay)) {
      if (exp.timeJumpDeclared) push("timeOfDay", "PASS", "INFO", null, false);
      else push("timeOfDay", "FAIL", "ERROR", `unexpected time-of-day shift ${exp.timeOfDay} → ${ob.timeOfDay} without transition`, true);
    } else push("timeOfDay", "PASS", "INFO", null, false);
  } else checks.push(shared.checkEntry("timeOfDay", "NOT_APPLICABLE", "INFO", "no time-of-day expectation", false));

  // palette/style (reframe alone is not mutation)
  if (relevant(exp.paletteStyle)) {
    if (!relevant(ob.paletteStyle)) push("paletteStyle", "UNKNOWN", "WARNING", "palette/style unobservable", false);
    else if (ob.reframedOnly) push("paletteStyle", "PASS", "INFO", "platform crop/reframe is not style mutation", false);
    else if (String(ob.paletteStyle) !== String(exp.paletteStyle)) push("paletteStyle", "WARN", "WARNING", `style mutation: expected ${exp.paletteStyle} observed ${ob.paletteStyle}`, false);
    else push("paletteStyle", "PASS", "INFO", null, false);
  } else checks.push(shared.checkEntry("paletteStyle", "NOT_APPLICABLE", "INFO", "no palette/style expectation", false));

  // start/end state
  for (const d of ["startState", "endState"]) {
    const key = d === "startState" ? "startState" : "endState";
    if (!relevant(exp[key])) {
      checks.push(shared.checkEntry(d, "NOT_APPLICABLE", "INFO", `no locked ${d} expectation`, false));
      continue;
    }
    if (!relevant(ob[key])) push(d, "UNKNOWN", "ERROR", `locked ${d} ${exp[key]}; actual state unobservable`, true);
    else if (String(ob[key]) !== String(exp[key])) {
      push(d, "FAIL", "ERROR", `wrong ${d}: expected ${exp[key]} observed ${ob[key]}`, true, ev(d, exp[key], ob[key], "mismatch", ob.confidence));
    } else push(d, "PASS", "INFO", null, false);
  }

  // motion continuity (direction / gesture / trajectory / state coherence)
  if (exp.expectedMotion) {
    if (ob.storyDirectedMotionChange === true) {
      checks.push(shared.checkEntry("motionContinuity", "PASS", "INFO", "explicit story-directed motion change does not false-fail", false));
    } else {
      const m = motionLib.evaluateMotionIntegrity("continuity", exp.expectedMotion, ob.motionObservation || null, { blocking: true });
      const renamed = m.checks.map((c) => ({ ...c, check: `motion:${c.check}` }));
      for (const c of renamed) {
        checks.push(c);
        if (c.status === "FAIL") fail++;
        if (c.status === "UNKNOWN" && c.blocking) unkCritical++;
      }
      for (const e of m.evidence) evidence.push(e);
      for (const r of m.reasons) reasons.push(`motionContinuity: ${r}`);
    }
  } else {
    checks.push(shared.checkEntry("motionContinuity", "NOT_APPLICABLE", "INFO", "no motion continuity contract for this shot", false));
  }

  const hasWarn = checks.some((c) => c.status === "WARN");
  const hasUnknown = checks.some((c) => c.status === "UNKNOWN");
  const status = fail > 0 ? "FAIL" : unkCritical > 0 ? "UNKNOWN" : hasUnknown ? "UNKNOWN" : hasWarn ? "WARN" : "PASS";
  return shared.layerResult({
    status,
    severity: fail > 0 ? "BLOCKER" : unkCritical > 0 ? "ERROR" : hasUnknown || hasWarn ? "WARNING" : "INFO",
    blocking: fail > 0 || unkCritical > 0,
    checks,
    evidence,
    reasons,
  });
}

module.exports = { DOMAINS, evaluateContinuity };
