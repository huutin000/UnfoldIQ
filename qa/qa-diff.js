"use strict";
// qa/qa-diff.js — STEP-13 Branch C.
// Stable issue fingerprints + cross-attempt diff + finalize guardrail.
// fingerprintIssue is sha256-16 over a normalized tuple so the same logical
// issue keeps the same id across attempts. diffAttempts rejects same-attempt
// comparison (ATTEMPT_MISMATCH). attemptGuardrail blocks finalize promotion
// while any OPEN BLOCKER/ERROR severity issue remains.

var crypto = require("crypto");

function norm(v) {
  return v === undefined || v === null ? null : v;
}

function fingerprintIssue(args) {
  args = args || {};
  if (!args.category || typeof args.category !== "string") {
    throw new Error("fingerprintIssue: category required");
  }
  var tuple = [
    String(args.category),
    norm(args.sceneId) === null ? null : String(args.sceneId),
    norm(args.startMs) === null ? null : Number(args.startMs),
    norm(args.endMs) === null ? null : Number(args.endMs),
    norm(args.assetId) === null ? null : String(args.assetId),
    norm(args.layerId) === null ? null : String(args.layerId),
    norm(args.reason) === null ? null : String(args.reason)
  ];
  return crypto.createHash("sha256").update(JSON.stringify(tuple), "utf8").digest("hex").slice(0, 16);
}

function issueIdOf(issue) {
  if (!issue || typeof issue !== "object") return null;
  if (typeof issue.fingerprint === "string" && issue.fingerprint.length > 0) return issue.fingerprint;
  try {
    return fingerprintIssue({
      category: issue.category,
      sceneId: issue.sceneId,
      startMs: issue.startMs,
      endMs: issue.endMs,
      assetId: issue.assetId,
      layerId: issue.layerId,
      reason: issue.reason || issue.note
    });
  } catch (e) {
    return null;
  }
}

function attemptIdsOf(list) {
  var ids = [];
  (Array.isArray(list) ? list : []).forEach(function (i) {
    if (i && typeof i.attemptId === "string" && ids.indexOf(i.attemptId) === -1) ids.push(i.attemptId);
  });
  return ids;
}

function diffAttempts(beforeIssues, afterIssues) {
  beforeIssues = Array.isArray(beforeIssues) ? beforeIssues : [];
  afterIssues = Array.isArray(afterIssues) ? afterIssues : [];
  if (beforeIssues.length > 0 && afterIssues.length > 0) {
    var union = attemptIdsOf(beforeIssues.concat(afterIssues));
    if (union.length === 1) {
      var err = new Error("ATTEMPT_MISMATCH: cross-attempt compare requires distinct attemptIds (both=" + union[0] + ")");
      err.code = "ATTEMPT_MISMATCH";
      throw err;
    }
  }
  var beforeById = {};
  beforeIssues.forEach(function (i) {
    var id = issueIdOf(i);
    if (id) beforeById[id] = i;
  });
  var afterById = {};
  afterIssues.forEach(function (i) {
    var id = issueIdOf(i);
    if (id) afterById[id] = i;
  });
  var resolved = [];
  var persisting = [];
  var fresh = [];
  Object.keys(beforeById).forEach(function (id) {
    if (Object.prototype.hasOwnProperty.call(afterById, id)) persisting.push(beforeById[id]);
    else resolved.push(beforeById[id]);
  });
  Object.keys(afterById).forEach(function (id) {
    if (!Object.prototype.hasOwnProperty.call(beforeById, id)) fresh.push(afterById[id]);
  });
  return { resolved: resolved, persisting: persisting, new: fresh };
}

function attemptGuardrail(latestQaIssues) {
  var list = Array.isArray(latestQaIssues) ? latestQaIssues : [];
  for (var i = 0; i < list.length; i++) {
    var it = list[i] || {};
    var sev = String(it.severity || "");
    var status = String(it.status || "");
    if ((sev === "BLOCKER" || sev === "ERROR") && status === "OPEN") {
      return "BLOCKED_FINAL";
    }
  }
  return "CLEAR";
}

module.exports = {
  fingerprintIssue: fingerprintIssue,
  diffAttempts: diffAttempts,
  attemptGuardrail: attemptGuardrail
};
