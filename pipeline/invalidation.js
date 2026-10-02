"use strict";
// pipeline/invalidation.js — STEP-13 Branch A.
// Change-kind -> checkpoint invalidation rules. invalidateOnChange is pure;
// applyInvalidation returns a mutated deep copy (input untouched).
// Plain Node.js CommonJS. Deterministic.

var CHECKPOINTS = [
  "INPUT_VALIDATION",
  "ASSET_STAGING",
  "RENDER_PLAN",
  "RENDER_OUTPUT",
  "TECHNICAL_QA",
  "VISUAL_EVIDENCE",
  "FINAL_ACCEPTANCE"
];

function nowIso() {
  return new Date().toISOString();
}

// Captions feed the plan caption track, so caption edits invalidate the plan
// and everything downstream of it. Voice timing shifts audio-track frames in
// the plan. Image assets invalidate staging + downstream. Platform dimension
// changes invalidate input validation and everything downstream.
// Report/history edits never invalidate pipeline work.
var RULES = {
  "captions": ["RENDER_PLAN", "RENDER_OUTPUT", "TECHNICAL_QA", "VISUAL_EVIDENCE", "FINAL_ACCEPTANCE"],
  "voice-timing": ["RENDER_PLAN", "RENDER_OUTPUT", "TECHNICAL_QA", "VISUAL_EVIDENCE", "FINAL_ACCEPTANCE"],
  "image-asset": ["ASSET_STAGING", "RENDER_PLAN", "RENDER_OUTPUT", "TECHNICAL_QA", "VISUAL_EVIDENCE", "FINAL_ACCEPTANCE"],
  "platform-dims": ["INPUT_VALIDATION", "ASSET_STAGING", "RENDER_PLAN", "RENDER_OUTPUT", "TECHNICAL_QA", "VISUAL_EVIDENCE", "FINAL_ACCEPTANCE"],
  "report-history": []
};

function invalidateOnChange(state, changeKind) {
  void state;
  if (!Object.prototype.hasOwnProperty.call(RULES, changeKind)) {
    return { invalidatedCheckpoints: [], reason: "unknown change kind: " + String(changeKind) };
  }
  var list = RULES[changeKind].slice();
  var reason = list.length === 0
    ? "change '" + changeKind + "' never invalidates pipeline checkpoints"
    : "change '" + changeKind + "' invalidates " + list.join(", ");
  return { invalidatedCheckpoints: list, reason: reason };
}

function applyInvalidation(state, changeKind) {
  var copy = JSON.parse(JSON.stringify(state));
  copy.checkpoints = copy.checkpoints && typeof copy.checkpoints === "object" ? copy.checkpoints : {};
  var res = invalidateOnChange(copy, changeKind);
  for (var name of res.invalidatedCheckpoints) {
    var prev = copy.checkpoints[name];
    if (prev && typeof prev === "object") {
      prev.status = "INVALIDATED";
      prev.metadata = Object.assign({}, prev.metadata || {}, {
        invalidatedAt: nowIso(),
        invalidatedBy: changeKind
      });
    } else {
      copy.checkpoints[name] = {
        stage: name,
        status: "INVALIDATED",
        inputHash: null,
        artifactPaths: [],
        completedAt: null,
        metadata: { invalidatedAt: nowIso(), invalidatedBy: changeKind }
      };
    }
  }
  copy.history = Array.isArray(copy.history) ? copy.history : [];
  copy.history.push({
    at: nowIso(),
    event: "CHECKPOINTS_INVALIDATED",
    detail: { changeKind: changeKind, invalidatedCheckpoints: res.invalidatedCheckpoints, reason: res.reason }
  });
  return copy;
}

module.exports = {
  CHECKPOINTS: CHECKPOINTS,
  RULES: RULES,
  invalidateOnChange: invalidateOnChange,
  applyInvalidation: applyInvalidation
};
