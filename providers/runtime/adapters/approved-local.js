"use strict";

/**
 * approved-local adapter (STEP 10A).
 * Serves pre-cleared local assets from assets/approved-local.json
 * (plus assets/approved-local.schema.json). Copies the file into the
 * project asset dir and records the fingerprint. Unknown/blocked rights
 * are never READY for final use.
 */

const fs = require("fs");
const path = require("path");
const store = require("../artifact-store");
const { fingerprintRequest } = require("../request-fingerprint");
const { permanent, policyBlocked } = require("../errors");

function loadLibrary(root) {
  const abs = path.join(store.projectRootPath(root), "assets", "approved-local.json");
  if (!fs.existsSync(abs)) throw permanent("APPROVED_LOCAL_LIBRARY_MISSING", "assets/approved-local.json not found");
  return JSON.parse(fs.readFileSync(abs, "utf8"));
}

function findEntry(library, request) {
  const wantId = request.input && request.input.approvedAssetId;
  const wantPath = request.input && request.input.approvedAssetPath;
  return (library.assets || []).find(
    (a) => (wantId && a.assetId === wantId) || (wantPath && a.path === wantPath)
  );
}

async function execute(request, ctx = {}) {
  const root = ctx.projectRoot;
  const projectId = request.projectId;
  const library = loadLibrary(root);
  const entry = findEntry(library, request);

  const base = {
    version: "1.0.0",
    requestId: request.requestId,
    projectId,
    sceneId: request.sceneId,
    capability: request.capability,
    providerId: "approved-local",
    sourceType: "local-library",
    provenanceNote: `Approved-local library asset${entry ? ` ${entry.assetId}` : ""}`,
    rightsStatus: (entry && entry.rightsStatus) || "UNKNOWN",
    costClass: "ZERO_LOCAL",
  };

  if (!entry) {
    throw permanent("APPROVED_ASSET_NOT_FOUND", "No matching approved-local library entry");
  }

  if (entry.rightsStatus === "UNKNOWN") {
    throw policyBlocked("APPROVED_RIGHTS_UNKNOWN", `Approved-local asset ${entry.assetId} has UNKNOWN rights: not READY for final use`);
  }
  if (entry.rightsStatus === "UNVERIFIED") {
    throw policyBlocked("APPROVED_RIGHTS_UNVERIFIED", `Approved-local asset ${entry.assetId} is UNVERIFIED`);
  }

  // Library paths are repo-relative (assets/...). Resolve under project root.
  const libAbs = path.resolve(store.projectRootPath(root), entry.path);
  const rootAbs = store.projectRootPath(root);
  if (!libAbs.startsWith(rootAbs + path.sep) && libAbs !== rootAbs) {
    throw permanent("PATH_TRAVERSAL_BLOCKED", `Library asset path escapes workspace: ${entry.path}`);
  }
  if (!fs.existsSync(libAbs) || !fs.statSync(libAbs).isFile()) {
    throw permanent("APPROVED_ASSET_MISSING", `Library file not found: ${entry.path}`);
  }

  const destDir = store.assetDir(root, projectId, request.capability, request.sceneId);
  store.ensureDir(destDir);
  // Destination is keyed by requestId: a changed fingerprint (upstream change)
  // produces a new file and never silently overwrites the old accepted artifact.
  const ext = path.extname(entry.path) || "";
  const destAbs = path.join(destDir, `${store.sanitizeFilename(request.requestId)}${ext}`);
  fs.copyFileSync(libAbs, destAbs);
  const projectBase = path.resolve(root, "projects", projectId);
  const relative = path.relative(projectBase, destAbs).split(path.sep).join("/");
  store.recordFingerprint(root, projectId, relative, fingerprintRequest(request));

  return {
    ...base,
    status: "READY",
    artifactPath: relative,
    rightsStatus: entry.rightsStatus,
  };
}

module.exports = { execute, providerId: "approved-local", loadLibrary };
