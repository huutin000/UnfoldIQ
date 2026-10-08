"use strict";
// lib/render-cache/index.js — Phase 5B (5.2): Action Cache + content-addressed
// store (Bazel ActionCache/CAS pattern, local-only) + lifecycle/GC +
// single-flight + metrics + security guards. Synchronous, deterministic.
//
// Layout under a project-private cache root:
//   CAS/sha256/<hash>      immutable bytes (hash(bytes) identity)
//   actions/<actionKey>.json  COMPLETE records (never partial)
//   tmp/                     in-flight writes (never valid entries)
//   metrics.json, policy.json, revoked.json

var crypto = require("crypto");
var fs = require("fs");
var path = require("path");

var fingerprint = require("../../pipeline/input-fingerprint.js");

var VERSION = "1.0.0";

var NAMESPACES = [
  "research-extraction",
  "prompt",
  "provider-asset",
  "audio",
  "alignment",
  "caption",
  "scene-render",
  "transition-render",
  "qa-result",
  "thumbnail",
];

var MISS_REASONS = [
  "NOT_FOUND",
  "INPUT_HASH_CHANGED",
  "POLICY_VERSION_CHANGED",
  "TOOL_VERSION_CHANGED",
  "BLOB_MISSING",
  "HASH_MISMATCH",
  "SCHEMA_INCOMPATIBLE",
  "RIGHTS_STATE_CHANGED",
  "REVOKED",
  "CORRUPT",
  "EVICTED",
];

var SECRET_NAME_RE = /(api[_-]?key|cookie|token|secret|passwd|password|session|auth|credential|private[_-]?key|browser[_-]?profile|bridge[_-]?secret)/i;

function sha256hex(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

// ---- Action keys (spec §19-22) ----
function actionKey(spec) {
  spec = spec || {};
  if (!spec.actionType || typeof spec.actionType !== "string") throw new Error("actionKey: actionType required");
  if (!NAMESPACES.includes(spec.actionType) && !spec.allowCustomType) throw new Error("actionKey: unknown actionType " + spec.actionType);
  if (!spec.schemaVersion) throw new Error("actionKey: schemaVersion required");
  var inputs = (spec.inputs || []).map(function (i) {
    return { name: String(i.name), hash: String(i.hash) };
  }).sort(function (a, b) { return a.name < b.name ? -1 : 1; });
  return sha256hex(Buffer.from(fingerprint.stableStringify({
    actionType: spec.actionType,
    schemaVersion: String(spec.schemaVersion),
    inputs: inputs,
    toolVersions: spec.toolVersions || {},
    policyVersions: spec.policyVersions || {},
    config: spec.config === undefined ? null : spec.config,
    frameRange: spec.frameRange === undefined ? null : spec.frameRange,
  }), "utf8"));
}

// Scene render key (§21). Omitted optional fields simply do not participate;
// callers must pass every correctness-relevant input they use.
function sceneRenderKey(o) {
  o = o || {};
  var inputs = [];
  ["sourceAssetHashes", "timelineRange", "timebase", "responsiveProfile", "motionPlan",
   "activeOverrides", "captionsText", "seed"].forEach(function (n) {
    if (o[n] !== undefined) inputs.push({ name: n, hash: fingerprint.hashObject(o[n]) });
  });
  return actionKey({
    actionType: "scene-render",
    schemaVersion: o.schemaVersion || "1.0.0",
    inputs: inputs,
    toolVersions: Object.assign({ rendererMapping: o.rendererMappingVersion || null, remotion: o.remotionVersion || null }, o.extraToolVersions || {}),
    policyVersions: Object.assign({ color: o.colorPolicyVersion || null, exportProfile: o.exportProfileVersion || null }, o.extraPolicyVersions || {}),
    config: { fps: o.fps === undefined ? null : o.fps, width: o.width === undefined ? null : o.width, height: o.height === undefined ? null : o.height },
    frameRange: o.frameRange || null,
  });
}

// QA key (§22): artifact bytes + rule/tool/policy versions + range/context.
function qaKey(o) {
  o = o || {};
  if (!o.artifactContentHash) throw new Error("qaKey: artifactContentHash required");
  return actionKey({
    actionType: "qa-result",
    schemaVersion: o.schemaVersion || "1.0.0",
    inputs: [{ name: "artifact", hash: String(o.artifactContentHash) }],
    toolVersions: { analyzer: o.analyzerVersion || null },
    policyVersions: { qaRule: o.qaRuleVersion || null, policy: o.policyVersion || null },
    config: { ruleId: o.qaRuleId || null, range: o.range || null, contextBefore: o.contextBeforeFrames || 0, contextAfter: o.contextAfterFrames || 0 },
  });
}

// ---- Store ----
function assertSafeRel(rel) {
  if (typeof rel !== "string" || rel.length === 0) throw new Error("CACHE_PATH_REJECTED: empty");
  if (path.isAbsolute(rel)) throw new Error("CACHE_PATH_REJECTED: absolute " + rel);
  var norm = path.normalize(rel);
  if (norm === ".." || norm.startsWith(".." + path.sep) || norm.includes(".." + path.sep)) {
    throw new Error("CACHE_PATH_REJECTED: traversal " + rel);
  }
  if (/^[a-zA-Z]:/.test(norm)) throw new Error("CACHE_PATH_REJECTED: drive " + rel);
  return norm;
}

function realRoot(root) {
  return fs.realpathSync(root);
}

function guardNoEscape(root, abs) {
  var rr = realRoot(root);
  var real = fs.realpathSync(path.dirname(abs));
  var full = path.join(real, path.basename(abs));
  if (full !== rr && !full.startsWith(rr + path.sep)) {
    throw new Error("CACHE_PATH_REJECTED: symlink escape " + abs);
  }
  return full;
}

function ensureDirs(root) {
  ["CAS", "actions", "tmp"].forEach(function (d) {
    fs.mkdirSync(path.join(root, d), { recursive: true });
  });
  fs.mkdirSync(path.join(root, "CAS", "sha256"), { recursive: true });
}

function scanSecretsInRecord(rec) {
  var hits = [];
  function walk(v, trail) {
    if (typeof v === "string") {
      if (SECRET_NAME_RE.test(v) && v.length < 128) hits.push(trail);
    } else if (v && typeof v === "object") {
      Object.keys(v).forEach(function (k) {
        if (SECRET_NAME_RE.test(k)) hits.push(trail + "." + k);
        walk(v[k], trail + "." + k);
      });
    }
  }
  walk({ inputs: rec.inputs, config: rec.config }, "record");
  return hits;
}

function writeBlob(root, bytes) {
  ensureDirs(root);
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
  var t0 = Date.now();
  var hash = sha256hex(bytes);
  var dest = guardNoEscape(root, path.join(realRoot(root), "CAS", "sha256", assertSafeRel(hash)));
  if (!fs.existsSync(dest)) {
    var tmp = path.join(root, "tmp", "blob-" + process.pid + "-" + hash.slice(0, 12));
    fs.writeFileSync(tmp, bytes);
    try {
      var fd = fs.openSync(tmp, "r");
      try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    } catch (e) {}
    var verify = sha256hex(fs.readFileSync(tmp));
    if (verify !== hash) {
      try { fs.rmSync(tmp, { force: true }); } catch (e) {}
      throw new Error("CACHE_HASH_MISMATCH: temp write failed verification");
    }
    fs.renameSync(tmp, dest);
  }
  return { hash: hash, bytes: bytes.length, hashingMs: Date.now() - t0, ref: "CAS/sha256/" + hash };
}

function readBlob(root, hash) {
  var abs = guardNoEscape(root, path.join(realRoot(root), "CAS", "sha256", assertSafeRel(hash)));
  if (!fs.existsSync(abs)) return { ok: false, reason: "BLOB_MISSING" };
  var bytes;
  try { bytes = fs.readFileSync(abs); } catch (e) { return { ok: false, reason: "CORRUPT" }; }
  if (sha256hex(bytes) !== hash) return { ok: false, reason: "HASH_MISMATCH" };
  return { ok: true, bytes: bytes };
}

function actionPath(root, key) {
  return guardNoEscape(root, path.join(realRoot(root), "actions", assertSafeRel(key + ".json")));
}

function publishAction(root, record) {
  ensureDirs(root);
  if (!record || typeof record.actionKey !== "string") throw new Error("publishAction: actionKey required");
  assertSafeRel(record.actionKey + ".json");
  if (!Array.isArray(record.outputContentHashes) || record.outputContentHashes.length === 0) {
    throw new Error("publishAction: outputContentHashes required (no contentless entries)");
  }
  var secrets = scanSecretsInRecord(record);
  if (secrets.length > 0) throw new Error("CACHE_SECRET_REJECTED: " + secrets.slice(0, 3).join(","));
  var doc = Object.assign({}, record, {
    cacheVersion: VERSION,
    status: "COMPLETE",
    createdAt: record.createdAt || new Date().toISOString(),
    lastHitAt: null,
    canonicalDisposable: record.canonicalDisposable || "DISPOSABLE",
  });
  var dest = actionPath(root, record.actionKey);
  var tmp = path.join(root, "tmp", "action-" + process.pid + "-" + record.actionKey.slice(0, 12) + ".json");
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 1));
  fs.renameSync(tmp, dest);
  return doc;
}

function loadRecord(root, key) {
  var abs;
  try { abs = actionPath(root, key); } catch (e) { return null; }
  if (!fs.existsSync(abs)) return null;
  try {
    var doc = JSON.parse(fs.readFileSync(abs, "utf8"));
    if (!doc || doc.status !== "COMPLETE" || doc.actionKey !== key) return { corrupt: true };
    return doc;
  } catch (e) { return { corrupt: true }; }
}

function revokedSet(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, "revoked.json"), "utf8"));
  } catch (e) { return []; }
}

// Hit validation (§23). expected: {schemaVersion, toolVersions, policyVersions}
// rightsOk(ref)->bool injected; revoked checked from revoked.json.
function lookup(root, key, expected, opts) {
  expected = expected || {};
  opts = opts || {};
  var rec = loadRecord(root, key);
  if (!rec) return { status: "MISS", reason: "NOT_FOUND", cachedArtifactRef: null };
  if (rec.corrupt) return { status: "HIT_INVALID", reason: "CORRUPT", cachedArtifactRef: null };
  if (expected.schemaVersion && rec.schemaVersion !== expected.schemaVersion) {
    return { status: "HIT_INVALID", reason: "SCHEMA_INCOMPATIBLE", cachedArtifactRef: null };
  }
  function versionsMatch(a, b) {
    a = a || {}; b = b || {};
    return Object.keys(b).every(function (k) { return (a[k] === undefined ? null : a[k]) === (b[k] === undefined ? null : b[k]); });
  }
  if (expected.toolVersions && !versionsMatch(rec.toolVersions, expected.toolVersions)) {
    return { status: "HIT_INVALID", reason: "TOOL_VERSION_CHANGED", cachedArtifactRef: null };
  }
  if (expected.policyVersions && !versionsMatch(rec.policyVersions, expected.policyVersions)) {
    return { status: "HIT_INVALID", reason: "POLICY_VERSION_CHANGED", cachedArtifactRef: null };
  }
  if (revokedSet(root).includes(key)) return { status: "HIT_INVALID", reason: "REVOKED", cachedArtifactRef: null };
  if (opts.rightsOk && !opts.rightsOk(rec)) return { status: "HIT_INVALID", reason: "RIGHTS_STATE_CHANGED", cachedArtifactRef: null };
  var hash = rec.outputContentHashes[0];
  var blob = readBlob(root, hash);
  if (!blob.ok) return { status: "HIT_INVALID", reason: blob.reason, cachedArtifactRef: null };
  return { status: "HIT_VALID", reason: null, cachedArtifactRef: "CAS/sha256/" + hash, record: rec };
}

function touchHit(root, key) {
  try {
    var abs = actionPath(root, key);
    var doc = JSON.parse(fs.readFileSync(abs, "utf8"));
    doc.lastHitAt = new Date().toISOString();
    fs.writeFileSync(abs, JSON.stringify(doc, null, 1));
  } catch (e) {}
}

// ---- Single-flight (§25): same-key concurrent work computes once ----
var inflight = new Map();
async function withSingleFlight(key, fn, metrics) {
  if (inflight.has(key)) {
    if (metrics) metrics.singleFlightDedupes = (metrics.singleFlightDedupes || 0) + 1;
    return inflight.get(key);
  }
  var p = (async function () {
    try { return await fn(); }
    finally { inflight.delete(key); }
  })();
  inflight.set(key, p);
  return p;
}

// ---- Lifecycle / GC (§26-28) ----
function defaultPolicy() {
  return {
    version: "1.0.0",
    maxSizeBytes: 2 * 1024 * 1024 * 1024,
    maxAgeDays: 30,
    evictionPolicy: "HYBRID",
    pinnedClasses: ["active-job", "approved-artifact", "recovery-critical", "operator-pinned"],
  };
}

function loadPolicy(root) {
  try {
    var p = JSON.parse(fs.readFileSync(path.join(root, "policy.json"), "utf8"));
    if (p && p.version) return p;
  } catch (e) {}
  return defaultPolicy();
}

function scan(root) {
  ensureDirs(root);
  var policy = loadPolicy(root);
  var entries = [];
  var actionsDir = path.join(root, "actions");
  var files = [];
  try { files = fs.readdirSync(actionsDir).filter(function (f) { return f.endsWith(".json"); }); } catch (e) {}
  for (var f of files) {
    var key = f.slice(0, -5);
    var rec = loadRecord(root, key);
    if (!rec || rec.corrupt) {
      entries.push({ key: key, corrupt: true, bytes: 0, pinned: false });
      continue;
    }
    var bytes = 0;
    var blobBad = false;
    for (var h of rec.outputContentHashes || []) {
      // Integrity audit: existence + content identity (a tampered blob is a
      // corrupt entry even when its ActionRecord parses cleanly).
      var blob = readBlob(root, h);
      if (!blob.ok) { blobBad = true; break; }
      bytes += blob.bytes.length;
    }
    if (blobBad) {
      entries.push({ key: key, corrupt: true, bytes: 0, pinned: false });
      continue;
    }
    var pinned = (rec.pinned === true) ||
      ((rec.pinClasses || []).some(function (c) { return policy.pinnedClasses.includes(c); })) ||
      rec.canonicalDisposable === "CANONICAL_REF";
    entries.push({ key: key, corrupt: false, bytes: bytes, pinned: pinned, createdAt: rec.createdAt, lastHitAt: rec.lastHitAt, record: rec });
  }
  return { policy: policy, entries: entries };
}

function gc(root, opts) {
  opts = opts || {};
  var dryRun = opts.dryRun === true;
  var now = Date.now();
  var maxAgeMs = (opts.maxAgeDays !== undefined ? opts.maxAgeDays : loadPolicy(root).maxAgeDays) * 86400000;
  var maxBytes = opts.maxSizeBytes !== undefined ? opts.maxSizeBytes : loadPolicy(root).maxSizeBytes;
  var report = { dryRun: dryRun, scanned: 0, removed: 0, bytesReclaimed: 0, reasons: {}, pinnedSkipped: 0, corruptEntries: 0, removedKeys: [] };
  var s = scan(root);
  report.scanned = s.entries.length;
  // eligible: corrupt always; expired by age; then LRU overflow by size.
  var candidates = [];
  for (var e of s.entries) {
    if (e.corrupt) { report.corruptEntries++; candidates.push({ e: e, reason: "CORRUPT", rank: 0 }); continue; }
    if (e.pinned) { report.pinnedSkipped++; continue; }
    var age = now - Date.parse(e.lastHitAt || e.createdAt || new Date().toISOString());
    if (age > maxAgeMs) { candidates.push({ e: e, reason: "AGE", rank: age }); continue; }
    candidates.push({ e: e, reason: "LRU", rank: age });
  }
  var total = s.entries.reduce(function (a, e) { return a + (e.bytes || 0); }, 0);
  var protectedBytes = s.entries.filter(function (e) { return e.pinned; }).reduce(function (a, e) { return a + (e.bytes || 0); }, 0);
  var reclaimable = candidates.slice().sort(function (a, b) { return b.rank - a.rank; });
  var toRemove = reclaimable.filter(function (c) { return c.reason !== "LRU"; });
  var bytesAfterForced = total - toRemove.reduce(function (a, c) { return a + (c.e.bytes || 0); }, 0);
  if (bytesAfterForced > maxBytes) {
    var need = bytesAfterForced - maxBytes;
    for (var c of reclaimable.filter(function (x) { return x.reason === "LRU"; })) {
      if (need <= 0) break;
      toRemove.push(c);
      need -= (c.e.bytes || 0);
    }
  }
  for (var r of toRemove) {
    report.reasons[r.reason] = (report.reasons[r.reason] || 0) + 1;
    if (!dryRun) {
      try { fs.rmSync(actionPath(root, r.e.key), { force: true }); } catch (e) {}
      // CAS blobs are content-shared: only delete when unreferenced.
      var still = scan(root).entries;
      var refs = new Set();
      still.forEach(function (x) { (x.record && x.record.outputContentHashes || []).forEach(function (h) { refs.add(h); }); });
      for (var h of (r.e.record && r.e.record.outputContentHashes) || []) {
        if (!refs.has(h)) {
          try {
            var sz = fs.statSync(path.join(root, "CAS", "sha256", h)).size;
            fs.rmSync(path.join(root, "CAS", "sha256", h), { force: true });
            report.bytesReclaimed += sz;
          } catch (e) {}
        }
      }
      report.removed++;
      report.removedKeys.push(r.e.key);
    } else {
      report.bytesReclaimed += (r.e.bytes || 0);
      report.removed++;
      report.removedKeys.push(r.e.key);
    }
  }
  void protectedBytes;
  return report;
}

// ---- Metrics (§45 cache subset) ----
function newMetrics() {
  return {
    lookups: 0, validHits: 0, invalidHits: 0, misses: 0, missesByReason: {},
    bytesRead: 0, bytesWritten: 0, bytesReused: 0, timeAvoidedMs: 0,
    framesRendered: 0, framesReused: 0, hashingMs: 0, lookupMs: 0,
    gcReclaimedBytes: 0, corruptCount: 0, singleFlightDedupes: 0,
  };
}

function loadMetrics(root) {
  try {
    var m = JSON.parse(fs.readFileSync(path.join(root, "metrics.json"), "utf8"));
    return Object.assign(newMetrics(), m);
  } catch (e) { return newMetrics(); }
}

function saveMetrics(root, metrics) {
  fs.writeFileSync(path.join(root, "metrics.json"), JSON.stringify(metrics || newMetrics(), null, 1));
}

module.exports = {
  VERSION: VERSION,
  NAMESPACES: NAMESPACES,
  MISS_REASONS: MISS_REASONS,
  actionKey: actionKey,
  sceneRenderKey: sceneRenderKey,
  qaKey: qaKey,
  assertSafeRel: assertSafeRel,
  writeBlob: writeBlob,
  readBlob: readBlob,
  publishAction: publishAction,
  loadRecord: loadRecord,
  lookup: lookup,
  touchHit: touchHit,
  withSingleFlight: withSingleFlight,
  defaultPolicy: defaultPolicy,
  loadPolicy: loadPolicy,
  scan: scan,
  gc: gc,
  newMetrics: newMetrics,
  loadMetrics: loadMetrics,
  saveMetrics: saveMetrics,
};
