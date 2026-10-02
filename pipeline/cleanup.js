"use strict";
// pipeline/cleanup.js — STEP-13 Branch A.
// Managed cleanup only. Deletes files SOLELY under:
//   1. projects/<id>/render/tmp/ (+ *.tmp files under projects/<id>/render/)
//   2. remotion/public/unfoldiq/<id>/ entries NOT referenced by the current
//      projects/<id>/render/staging-manifest.json
// Anything else is refused. Never touches source assets, accepted finals,
// attempt manifests, QA evidence, or pipeline history/state.
// Plain Node.js CommonJS. Deterministic.

var fs = require("fs");
var path = require("path");
var artifactStore = require("../providers/runtime/artifact-store.js");

var DEFAULT_KINDS = ["temp", "stale-staging", "superseded-bundles"];
var STAGING_MANIFEST_CANDIDATES = ["render/staging-manifest.json"];
var STATE_GUARD_SEGMENTS = ["pipeline", "assets", "handoff", "continuity", "timing"];

function repoRoot(projectRoot) {
  return path.resolve(projectRoot);
}

function listFilesRecursive(absDir) {
  var out = [];
  var entries;
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch (e) {
    return out;
  }
  for (var ent of entries) {
    var abs = path.join(absDir, ent.name);
    if (ent.isDirectory()) out = out.concat(listFilesRecursive(abs));
    else if (ent.isFile()) out.push(abs);
  }
  return out;
}

function projectAbs(projectRoot, projectId, rel) {
  return artifactStore.resolveProjectPath(projectRoot, projectId, rel).abs;
}

function loadManifestRefs(projectRoot, projectId) {
  // Returns a Set of referenced staged/static paths, or null when no
  // manifest exists (then everything is kept — never delete blind).
  for (var cand of STAGING_MANIFEST_CANDIDATES) {
    var abs;
    try {
      abs = projectAbs(projectRoot, projectId, cand);
    } catch (e) {
      continue;
    }
    var doc;
    try {
      doc = JSON.parse(fs.readFileSync(abs, "utf8"));
    } catch (e) {
      continue;
    }
    if (!doc || !Array.isArray(doc.entries)) continue;
    var refs = new Set();
    for (var en of doc.entries) {
      if (!en || typeof en !== "object") continue;
      if (typeof en.stagedPath === "string") refs.add(en.stagedPath.replace(/\\/g, "/"));
      if (typeof en.staticFilePath === "string") refs.add(en.staticFilePath.replace(/\\/g, "/"));
    }
    return refs;
  }
  return null;
}

function guardedUnlink(abs, removed) {
  fs.unlinkSync(abs);
  removed.push(abs);
}

function cleanManaged(opts) {
  opts = opts && typeof opts === "object" ? opts : {};
  var projectRoot = opts.projectRoot;
  var projectId = opts.projectId;
  if (!projectRoot || !projectId) throw new Error("CLEANUP_REQUIRES_ROOT_AND_PROJECT");
  var kinds = Array.isArray(opts.kinds) ? opts.kinds : DEFAULT_KINDS.slice();

  // Traversal probe: throws PATH_TRAVERSAL_BLOCKED for hostile projectIds.
  artifactStore.resolveProjectPath(projectRoot, projectId, "render/tmp");

  var removed = [];
  var kept = [];
  var root = repoRoot(projectRoot);

  var wantTemp = kinds.indexOf("temp") !== -1;
  var wantStaging = kinds.indexOf("stale-staging") !== -1 || kinds.indexOf("superseded-bundles") !== -1;

  if (wantTemp) {
    var tmpAbs = projectAbs(projectRoot, projectId, "render/tmp");
    for (var f of listFilesRecursive(tmpAbs)) {
      guardedUnlink(f, removed);
    }
    // *.tmp files elsewhere under render/ (attempt scratch files).
    var renderAbs = projectAbs(projectRoot, projectId, "render");
    for (var g of listFilesRecursive(renderAbs)) {
      if (/\.tmp$/i.test(g) && removed.indexOf(g) === -1) guardedUnlink(g, removed);
    }
  }

  if (wantStaging) {
    var stagingAbs = path.join(root, "remotion", "public", "unfoldiq", String(projectId));
    // Containment: staging dir must stay inside the repo checkout.
    var rel = path.relative(root, stagingAbs);
    if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error("CLEANUP_REFUSED_OUTSIDE_ROOT: " + stagingAbs);
    }
    var refs = loadManifestRefs(projectRoot, projectId);
    var stagingRootPrefix = "unfoldiq/" + String(projectId) + "/";
    for (var h of listFilesRecursive(stagingAbs)) {
      var repoRel = path.relative(root, h).split(path.sep).join("/");
      // Map remotion/public/<x> -> static path <x> for manifest comparison.
      var staticRel = repoRel.replace(/^remotion\/public\//, "");
      var referenced = false;
      if (refs) {
        referenced = refs.has(staticRel) ||
          refs.has(repoRel) ||
          refs.has(staticRel.replace(new RegExp("^" + "unfoldiq/"), ""));
      } else {
        // No manifest: keep everything.
        kept.push(repoRel);
        continue;
      }
      // Only unreferenced files directly under this project's staging prefix
      // may be removed; anything else is kept.
      if (!referenced && staticRel.indexOf(stagingRootPrefix) === 0) {
        guardedUnlink(h, removed);
      } else {
        kept.push(repoRel);
      }
    }
  }

  void STATE_GUARD_SEGMENTS;
  return { removed: removed, kept: kept };
}

module.exports = {
  cleanManaged: cleanManaged,
  DEFAULT_KINDS: DEFAULT_KINDS
};
