"use strict";
// pipeline/pipeline-lock.js — STEP-13 Branch A.
// Exclusive pipeline lock at projects/<id>/pipeline/lock.json.
//
// Freshness requires BOTH heartbeat recency (< STALE_AFTER_MS) AND a live
// holder pid (best-effort process.kill(pid, 0), Windows-compatible try/catch).
// NOTE on PID reuse: a recycled pid alone never keeps a lock fresh — a stale
// heartbeat always marks the lock stale even if the pid happens to be alive.
// Plain Node.js CommonJS, no network. Deterministic.

var fs = require("fs");
var os = require("os");
var path = require("path");
var artifactStore = require("../providers/runtime/artifact-store.js");

var STALE_AFTER_MS = 30000;
var LOCK_REL = "pipeline/lock.json";

function nowIso() {
  return new Date().toISOString();
}

function assertProjectId(projectId) {
  if (typeof projectId !== "string" || projectId.length === 0 ||
      projectId.indexOf("/") !== -1 || projectId.indexOf("\\") !== -1 ||
      projectId === "." || projectId === ".." || projectId.indexOf("..") !== -1) {
    throw new Error("PATH_TRAVERSAL_BLOCKED: invalid projectId: " + String(projectId));
  }
}

function lockAbs(projectRoot, projectId) {
  // Throws PATH_TRAVERSAL_BLOCKED on traversal/escape.
  assertProjectId(projectId);
  return artifactStore.resolveProjectPath(projectRoot, projectId, LOCK_REL).abs;
}

function pidAlive(pid) {
  if (typeof pid !== "number" || !(pid > 0)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // ESRCH: no such process. EPERM/others: process exists (or unknown) —
    // treat as alive; heartbeat recency is still required for freshness.
    if (e && e.code === "ESRCH") return false;
    return true;
  }
}

function heartbeatAgeMs(lock) {
  if (!lock || typeof lock.heartbeatAt !== "string") return Infinity;
  var t = Date.parse(lock.heartbeatAt);
  if (isNaN(t)) return Infinity;
  return Date.now() - t;
}

function isFresh(lock) {
  if (!lock || typeof lock !== "object") return false;
  if (heartbeatAgeMs(lock) >= STALE_AFTER_MS) return false;
  return pidAlive(lock.pid);
}

function readLock(projectRoot, projectId) {
  var abs = lockAbs(projectRoot, projectId);
  var raw;
  try {
    raw = fs.readFileSync(abs, "utf8");
  } catch (e) {
    if (e && e.code === "ENOENT") return null;
    throw e;
  }
  return JSON.parse(raw);
}

function writeLock(projectRoot, projectId, lock) {
  var abs = lockAbs(projectRoot, projectId);
  artifactStore.ensureDir(path.dirname(abs));
  artifactStore.writeArtifactAtomic(projectRoot, projectId, LOCK_REL, JSON.stringify(lock, null, 2));
  return lock;
}

// Second acquire while fresh -> throw LOCK_HELD. Stale lock is returned as
// { stale: true, lock } WITHOUT deleting it; reconcile decides what to do.
function acquire(projectRoot, projectId, operation) {
  var existing = readLock(projectRoot, projectId);
  if (existing && isFresh(existing)) {
    throw new Error("LOCK_HELD: " + projectId + " held by pid " + existing.pid);
  }
  if (existing) {
    return { stale: true, lock: existing };
  }
  var now = nowIso();
  var lock = {
    projectId: projectId,
    pid: process.pid,
    hostname: os.hostname(),
    acquiredAt: now,
    heartbeatAt: now,
    operation: String(operation || "unknown")
  };
  writeLock(projectRoot, projectId, lock);
  return { stale: false, lock: lock };
}

function heartbeat(projectRoot, projectId) {
  var existing = readLock(projectRoot, projectId);
  if (!existing) throw new Error("LOCK_NOT_FOUND: " + projectId);
  if (existing.pid !== process.pid) {
    throw new Error("LOCK_NOT_OWNER: " + projectId + " held by pid " + existing.pid);
  }
  existing.heartbeatAt = nowIso();
  writeLock(projectRoot, projectId, existing);
  return existing;
}

// Only the owning pid may release, unless opts.forceStale is set and the
// current lock is confirmed stale.
function release(projectRoot, projectId, opts) {
  var existing = readLock(projectRoot, projectId);
  if (!existing) return false;
  if (existing.pid !== process.pid) {
    var forced = !!(opts && opts.forceStale);
    if (!forced || isFresh(existing)) {
      throw new Error("LOCK_NOT_OWNER: " + projectId + " held by pid " + existing.pid);
    }
  }
  var abs = lockAbs(projectRoot, projectId);
  fs.unlinkSync(abs);
  return true;
}

// Explicit stale-lock removal. Requires { confirmedStale: true } so callers
// prove reconcile (not the lock module) decided the holder is gone.
function clearStale(projectRoot, projectId, opts) {
  if (!opts || opts.confirmedStale !== true) {
    throw new Error("STALE_NOT_CONFIRMED: pass { confirmedStale: true }");
  }
  var existing = readLock(projectRoot, projectId);
  if (!existing) return false;
  var abs = lockAbs(projectRoot, projectId);
  fs.unlinkSync(abs);
  return true;
}

module.exports = {
  STALE_AFTER_MS: STALE_AFTER_MS,
  acquire: acquire,
  heartbeat: heartbeat,
  release: release,
  readLock: readLock,
  isFresh: isFresh,
  clearStale: clearStale
};
