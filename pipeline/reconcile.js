"use strict";
// pipeline/reconcile.js — STEP-13 Branch A.
// Crash/interrupt recovery decisions. Operates on a deep copy of the state
// and returns { state, decision, ... }. No rendering, no network.
// Plain Node.js CommonJS. Deterministic apart from ffprobe probing.

var childProcess = require("child_process");
var fs = require("fs");
var artifactStore = require("../providers/runtime/artifact-store.js");
var fingerprint = require("./input-fingerprint.js");

var FINAL_ARTIFACT_REL = "render/final-artifact.json";

function nowIso() {
  return new Date().toISOString();
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function latestAttempt(state) {
  if (!state || !Array.isArray(state.attempts) || state.attempts.length === 0) return null;
  return state.attempts[state.attempts.length - 1];
}

// Mark an attempt INTERRUPTED on the (copied) state. Returns the state.
function markInterrupted(state, attemptId) {
  var found = null;
  for (var a of (state.attempts || [])) {
    if (a && a.attemptId === attemptId) { found = a; break; }
  }
  if (found) {
    found.status = "INTERRUPTED";
    if (!found.endedAt) found.endedAt = nowIso();
  }
  if (state.status === "RENDERING") state.status = "RENDER_INTERRUPTED";
  state.history = Array.isArray(state.history) ? state.history : [];
  state.history.push({ at: nowIso(), event: "RENDER_MARKED_INTERRUPTED", detail: { attemptId: attemptId } });
  return state;
}

// Guarded ffprobe readability probe. Returns true (readable), false
// (unreadable), or null (ffprobe unavailable -> cannot verify).
function probeOutputReadable(absPath) {
  try {
    var st = fs.statSync(absPath);
    if (!st.isFile() || st.size <= 0) return false;
  } catch (e) {
    return false;
  }
  try {
    var r = childProcess.spawnSync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", absPath],
      { timeout: 15000, stdio: ["ignore", "pipe", "pipe"] }
    );
    if (r.error) return null;
    return r.status === 0;
  } catch (e) {
    return null;
  }
}

function readFinalArtifact(projectRoot, projectId) {
  try {
    var r = artifactStore.resolveProjectPath(projectRoot, projectId, FINAL_ARTIFACT_REL);
    return { doc: JSON.parse(fs.readFileSync(r.abs, "utf8")), rel: r };
  } catch (e) {
    return null;
  }
}

function finalMatchesCurrent(projectRoot, projectId, state) {
  var found = readFinalArtifact(projectRoot, projectId);
  if (!found || !found.doc || typeof found.doc !== "object") return false;
  var outRel = found.doc.outputPath;
  if (typeof outRel !== "string" || outRel.length === 0) return false;
  try {
    var out = artifactStore.resolveProjectPath(projectRoot, projectId, outRel);
    var st = fs.statSync(out.abs);
    if (!st.isFile() || st.size <= 0) return false;
  } catch (e) {
    return false;
  }
  var cur = state && state.inputFingerprint;
  var fin = found.doc.inputFingerprint;
  if (!cur || !fin) return false;
  if (typeof cur.fingerprintId === "string" && typeof fin.fingerprintId === "string") {
    return cur.fingerprintId === fin.fingerprintId;
  }
  try {
    return fingerprint.fingerprintIdOf(cur) === fingerprint.fingerprintIdOf(fin);
  } catch (e) {
    return false;
  }
}

function reconcileInterrupted(opts) {
  opts = opts && typeof opts === "object" ? opts : {};
  var projectRoot = opts.projectRoot;
  var projectId = opts.projectId;
  var state = clone(opts.state || {});
  state.history = Array.isArray(state.history) ? state.history : [];

  if (Array.isArray(state.blockers) && state.blockers.length > 0) {
    return { state: state, decision: "BLOCKED_REVIEW_REQUIRED", note: state.blockers.length + " blocker(s) present" };
  }

  if (state.status === "FINAL_RENDER_READY" || finalMatchesCurrent(projectRoot, projectId, state)) {
    return { state: state, decision: "FINAL_ALREADY_READY" };
  }

  if (state.status !== "RENDERING") {
    return { state: state, decision: "CONTINUE_FROM_CHECKPOINT" };
  }

  if (opts.activePidAlive) {
    return { state: state, decision: "CONTINUE_FROM_CHECKPOINT", note: "renderer active" };
  }

  var latest = latestAttempt(state);
  if (!latest) {
    return { state: state, decision: "NEW_RENDER_ATTEMPT", markAttempt: null, note: "no attempts on record" };
  }

  var readable = false;
  try {
    var out = artifactStore.resolveProjectPath(projectRoot, projectId, latest.outputPath);
    var probe = probeOutputReadable(out.abs);
    readable = probe === true;
    // probe === null (no ffprobe) -> cannot verify -> INTERRUPTED path.
  } catch (e) {
    readable = false;
  }

  if (readable) {
    return { state: state, decision: "RUN_QA", attemptId: latest.attemptId };
  }
  markInterrupted(state, latest.attemptId);
  return { state: state, decision: "NEW_RENDER_ATTEMPT", markAttempt: "INTERRUPTED", attemptId: latest.attemptId };
}

module.exports = {
  reconcileInterrupted: reconcileInterrupted,
  markInterrupted: markInterrupted
};
