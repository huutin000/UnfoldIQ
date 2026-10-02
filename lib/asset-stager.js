"use strict";
// lib/asset-stager.js — STEP-12 Branch A (Node side).
// Copies project assets into remotion/public/unfoldiq/<pid>/<hash8>/<file>
// for rendering. Never modifies or deletes source files. Deterministic:
// identical content + filename reuses the existing staged file (no rewrite).

var fs = require("fs");
var path = require("path");
var crypto = require("crypto");
var RenderErrors = require("./render-errors");

var STAGING_ROOT = "remotion/public/unfoldiq";
var ALLOWED_TYPES = { image: true, video: true, audio: true };

function hashBytes(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function sanitizeName(name) {
  var base = path.basename(String(name || ""));
  var clean = base.replace(/[^a-zA-Z0-9._-]/g, "_");
  if (!clean || clean === "." || clean === "..") {
    throw RenderErrors.make("ASSET_STAGE_FAILED", "unsafe asset filename: " + String(name));
  }
  return clean;
}

function assertProjectId(projectId) {
  if (typeof projectId !== "string" || projectId.length === 0 ||
      projectId.indexOf("/") !== -1 || projectId.indexOf("\\") !== -1 ||
      projectId === "." || projectId === "..") {
    throw RenderErrors.make("ASSET_STAGE_FAILED", "invalid projectId: " + String(projectId), { projectId: projectId });
  }
}

// Resolve a project-relative source path to an absolute path.
// Any traversal outside projects/<pid>/ is rejected with ASSET_STAGE_FAILED.
function resolveProjectPath(projectRoot, projectId, sourcePath) {
  assertProjectId(projectId);
  if (typeof sourcePath !== "string" || sourcePath.length === 0) {
    throw RenderErrors.make("ASSET_STAGE_FAILED", "empty sourcePath", { projectId: projectId });
  }
  var rel = String(sourcePath).split(path.sep).join("/");
  if (path.isAbsolute(sourcePath) || rel.indexOf("file://") === 0 || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(rel)) {
    throw RenderErrors.make("ASSET_STAGE_FAILED", "absolute/URI sourcePath rejected: " + sourcePath, { projectId: projectId });
  }
  var projectDir = path.resolve(projectRoot, "projects", projectId);
  var abs = path.resolve(projectDir, rel);
  var prefix = projectDir + path.sep;
  if (abs !== projectDir && abs.indexOf(prefix) !== 0) {
    throw RenderErrors.make("ASSET_STAGE_FAILED", "path traversal rejected: " + sourcePath, { projectId: projectId });
  }
  return abs;
}

function toForward(p) {
  return String(p).split(path.sep).join("/");
}

function stageAssets(opts) {
  opts = opts || {};
  var projectRoot = opts.projectRoot;
  var projectId = opts.projectId;
  var assets = Array.isArray(opts.assets) ? opts.assets : [];
  if (!projectRoot || typeof projectRoot !== "string") {
    throw RenderErrors.make("ASSET_STAGE_FAILED", "projectRoot required");
  }
  assertProjectId(projectId);
  var entries = [];
  assets.forEach(function (a) {
    a = a || {};
    var assetId = a.assetId;
    var sourcePath = a.sourcePath;
    var type = a.type;
    if (typeof assetId !== "string" || assetId.length === 0) {
      throw RenderErrors.make("ASSET_STAGE_FAILED", "asset entry missing assetId", { projectId: projectId });
    }
    if (!Object.prototype.hasOwnProperty.call(ALLOWED_TYPES, type)) {
      throw RenderErrors.make("ASSET_STAGE_FAILED", "unsupported asset type: " + String(type), { projectId: projectId, assetId: assetId });
    }
    var abs;
    try {
      abs = resolveProjectPath(projectRoot, projectId, sourcePath);
    } catch (e) {
      if (RenderErrors.isRenderError(e)) throw e;
      throw RenderErrors.make("ASSET_STAGE_FAILED", "resolve failed for " + assetId + ": " + e.message, { projectId: projectId, assetId: assetId });
    }
    var stat = null;
    try {
      stat = fs.statSync(abs);
    } catch (e) {
      throw RenderErrors.make("ASSET_STAGE_FAILED", "source missing for " + assetId + ": " + sourcePath, { projectId: projectId, assetId: assetId });
    }
    if (!stat.isFile() || stat.size <= 0) {
      throw RenderErrors.make("ASSET_STAGE_FAILED", "source empty/not-a-file for " + assetId + ": " + sourcePath, { projectId: projectId, assetId: assetId });
    }
    var bytes = fs.readFileSync(abs);
    if (bytes.length === 0) {
      throw RenderErrors.make("ASSET_STAGE_FAILED", "source empty for " + assetId + ": " + sourcePath, { projectId: projectId, assetId: assetId });
    }
    var full = hashBytes(bytes);
    var hash8 = full.slice(0, 8);
    var file = sanitizeName(path.basename(toForward(sourcePath)));
    var stagedRel = STAGING_ROOT + "/" + projectId + "/" + hash8 + "/" + file;
    var destAbs = path.resolve(projectRoot, stagedRel.split("/").join(path.sep));
    // Reuse when identical bytes already staged (no rewrite).
    var reuse = false;
    try {
      var existing = fs.readFileSync(destAbs);
      reuse = existing.length === bytes.length && hashBytes(existing) === full;
    } catch (e) {
      reuse = false;
    }
    if (!reuse) {
      fs.mkdirSync(path.dirname(destAbs), { recursive: true });
      fs.writeFileSync(destAbs, bytes);
    }
    entries.push({
      assetId: assetId,
      sourcePath: toForward(sourcePath),
      stagedPath: "unfoldiq/" + projectId + "/" + hash8 + "/" + file,
      staticFilePath: "unfoldiq/" + projectId + "/" + hash8 + "/" + file,
      contentHash: full,
      size: bytes.length,
      type: type
    });
  });
  // Deterministic order: sort by assetId.
  entries.sort(function (x, y) {
    return x.assetId < y.assetId ? -1 : (x.assetId > y.assetId ? 1 : 0);
  });
  return entries;
}

// Remove staged files for a project. Refuses to touch anything outside
// remotion/public/unfoldiq/<pid>/.
function cleanStale(opts) {
  opts = opts || {};
  var projectRoot = opts.projectRoot;
  var projectId = opts.projectId;
  if (!projectRoot || typeof projectRoot !== "string") {
    throw RenderErrors.make("ASSET_STAGE_FAILED", "projectRoot required");
  }
  assertProjectId(projectId);
  var stagingBase = path.resolve(projectRoot, STAGING_ROOT.split("/").join(path.sep));
  var target = path.resolve(stagingBase, projectId);
  var basePrefix = stagingBase + path.sep;
  if (target !== stagingBase && target.indexOf(basePrefix) !== 0) {
    throw RenderErrors.make("ASSET_STAGE_FAILED", "refusing to clean outside staging root", { projectId: projectId });
  }
  if (target === stagingBase) {
    throw RenderErrors.make("ASSET_STAGE_FAILED", "refusing to clean staging root itself", { projectId: projectId });
  }
  var removed = 0;
  try {
    var st = fs.statSync(target);
    if (!st.isDirectory()) return { removed: 0 };
  } catch (e) {
    return { removed: 0 };
  }
  fs.rmSync(target, { recursive: true, force: true });
  removed = 1;
  return { removed: removed };
}

module.exports = {
  STAGING_ROOT: STAGING_ROOT,
  hashBytes: hashBytes,
  resolveProjectPath: resolveProjectPath,
  stageAssets: stageAssets,
  cleanStale: cleanStale
};
