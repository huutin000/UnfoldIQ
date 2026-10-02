"use strict";
// pipeline/input-fingerprint.js — STEP-13 Branch A.
// Deterministic input fingerprints: sha256-16 hashes of canonical JSON for
// content docs, version strings for config docs, plus a fingerprintId over all.
// Plain Node.js CommonJS, no network. Deterministic.

var crypto = require("crypto");
var fs = require("fs");
var path = require("path");
var artifactStore = require("../providers/runtime/artifact-store.js");

var FINGERPRINT_KEYS = [
  "renderInput",
  "renderPlan",
  "stagingManifest",
  "timeline",
  "captions",
  "audioMix",
  "visualBible",
  "continuity",
  "platformProfile",
  "remotion"
];

var HASH_DOC_KEYS = [
  "renderInput",
  "renderPlan",
  "stagingManifest",
  "timeline",
  "captions",
  "audioMix"
];

// Canonical JSON: sorted keys, recursive, undefined dropped like JSON.stringify.
function stableStringify(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]";
  }
  var keys = Object.keys(value).filter(function (k) { return value[k] !== undefined; }).sort();
  return "{" + keys.map(function (k) {
    return JSON.stringify(k) + ":" + stableStringify(value[k]);
  }).join(",") + "}";
}

function sha16(str) {
  return crypto.createHash("sha256").update(str, "utf8").digest("hex").slice(0, 16);
}

function hashObject(obj) {
  return sha16(stableStringify(obj === undefined ? null : obj));
}

function fingerprintIdOf(fp) {
  var core = {};
  for (var k of FINGERPRINT_KEYS) core[k] = fp[k] === undefined ? null : fp[k];
  return hashObject(core);
}

function tryReadJson(abs) {
  try {
    return JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch (e) {
    return null;
  }
}

function projectFile(projectRoot, projectId, rel) {
  try {
    var r = artifactStore.resolveProjectPath(projectRoot, projectId, rel);
    if (!fs.existsSync(r.abs) || !fs.statSync(r.abs).isFile()) return null;
    return r.abs;
  } catch (e) {
    return null;
  }
}

function docVersionOrHash(parsed, rawAbs) {
  if (parsed && typeof parsed.version !== "undefined" && parsed.version !== null) {
    return String(parsed.version);
  }
  try {
    return sha16(fs.readFileSync(rawAbs, "utf8"));
  } catch (e) {
    return null;
  }
}

function readVisualBible(projectRoot, projectId, provided) {
  if (provided !== undefined && provided !== null) {
    if (typeof provided === "string") return provided;
    if (typeof provided.version !== "undefined" && provided.version !== null) return String(provided.version);
    return hashObject(provided);
  }
  var candidates = ["visual-bible.json", "continuity/visual-bible.json", "handoff/visual-bible.json"];
  for (var c of candidates) {
    var abs = projectFile(projectRoot, projectId, c);
    if (abs) return docVersionOrHash(tryReadJson(abs), abs);
  }
  return null;
}

function readContinuity(projectRoot, projectId, provided) {
  if (provided !== undefined && provided !== null) {
    if (typeof provided === "string") return provided;
    if (typeof provided.version !== "undefined" && provided.version !== null) return String(provided.version);
    return hashObject(provided);
  }
  var candidates = ["continuity-registry.json", "continuity/continuity-registry.json", "handoff/continuity-registry.json"];
  for (var c of candidates) {
    var abs = projectFile(projectRoot, projectId, c);
    if (abs) return docVersionOrHash(tryReadJson(abs), abs);
  }
  return null;
}

function readPlatformProfile(projectRoot, projectId, provided, docs) {
  if (typeof provided === "string" && provided.length > 0) return provided;
  if (provided && typeof provided === "object") {
    if (typeof provided.profileVersion !== "undefined" && provided.profileVersion !== null) {
      return String(provided.profileVersion);
    }
    return hashObject(provided);
  }
  var platform = null;
  if (docs) {
    if (docs.renderInput && typeof docs.renderInput.platform === "string") platform = docs.renderInput.platform;
    else if (docs.renderPlan && typeof docs.renderPlan.platform === "string") platform = docs.renderPlan.platform;
    else if (typeof docs.platform === "string") platform = docs.platform;
  }
  if (!platform) return null;
  if (/[^a-zA-Z0-9_-]/.test(platform) || platform.indexOf("..") !== -1) return null;
  var abs = path.join(path.resolve(projectRoot), "platforms", platform, "PROFILE.yaml");
  var raw;
  try {
    raw = fs.readFileSync(abs, "utf8");
  } catch (e) {
    return null;
  }
  // Prefer the versioned caption-profile marker; fall back to file hash.
  var m = raw.match(/profileVersion\s*:\s*["']?([^"'\r\n]+)["']?/);
  if (m) return m[1].trim();
  return sha16(raw);
}

function readRemotion(projectRoot, provided) {
  if (typeof provided === "string" && provided.length > 0) return provided;
  if (provided && typeof provided === "object") return hashObject(provided);
  var abs = path.join(path.resolve(projectRoot), "remotion", "package.json");
  var parsed = tryReadJson(abs);
  if (!parsed) return null;
  if (parsed.dependencies && typeof parsed.dependencies === "object") {
    return hashObject(parsed.dependencies);
  }
  if (typeof parsed.version === "string") return parsed.version;
  return null;
}

function computeFingerprint(projectRoot, projectId, docs) {
  docs = docs && typeof docs === "object" ? docs : {};
  var fp = {};
  for (var k of HASH_DOC_KEYS) {
    if (docs[k] === undefined || docs[k] === null) fp[k] = null;
    else fp[k] = hashObject(docs[k]);
  }
  fp.visualBible = readVisualBible(projectRoot, projectId, docs.visualBible);
  fp.continuity = readContinuity(projectRoot, projectId, docs.continuity);
  fp.platformProfile = readPlatformProfile(projectRoot, projectId, docs.platformProfile, docs);
  fp.remotion = readRemotion(projectRoot, docs.remotion);
  fp.fingerprintId = fingerprintIdOf(fp);
  return fp;
}

function compareFingerprints(a, b) {
  a = a && typeof a === "object" ? a : {};
  b = b && typeof b === "object" ? b : {};
  var changedKeys = [];
  for (var k of FINGERPRINT_KEYS) {
    var av = a[k] === undefined ? null : a[k];
    var bv = b[k] === undefined ? null : b[k];
    if (av !== bv) changedKeys.push(k);
  }
  return { same: changedKeys.length === 0, changedKeys: changedKeys };
}

module.exports = {
  FINGERPRINT_KEYS: FINGERPRINT_KEYS,
  computeFingerprint: computeFingerprint,
  compareFingerprints: compareFingerprints,
  compareFingerprint: compareFingerprints,
  fingerprintIdOf: fingerprintIdOf,
  hashObject: hashObject,
  stableStringify: stableStringify
};
