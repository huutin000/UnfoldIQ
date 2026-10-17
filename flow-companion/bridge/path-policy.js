"use strict";

/**
 * Flow Companion bridge path policy (STEP 10B).
 * All outputs confined to the UNFOLDIQ project root.
 * No absolute escapes, no traversal, no arbitrary filesystem writes.
 */

const path = require("path");

const SAFE_ID_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,127}$/;

// projectId / jobId become path segments: allow only a conservative charset.
function assertSafeId(kind, id) {
  if (typeof id !== "string" || !SAFE_ID_PATTERN.test(id)) {
    throw new Error(`INVALID_ID: ${kind}`);
  }
  return id;
}

function resolveProjectPath(projectRoot, projectId, relativePath) {
  assertSafeId("projectId", projectId);
  if (typeof relativePath !== "string" || relativePath.length === 0) {
    throw new Error("EMPTY_PATH");
  }
  if (path.isAbsolute(relativePath)) {
    throw new Error(`ABSOLUTE_PATH_REJECTED: ${relativePath}`);
  }
  const base = path.resolve(projectRoot, "projects", projectId);
  const abs = path.resolve(base, relativePath);
  const rel = path.relative(base, abs);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`PATH_TRAVERSAL_BLOCKED: ${relativePath}`);
  }
  return { abs, relative: rel.split(path.sep).join("/") };
}

function sanitizeFilename(name) {
  const base = path.basename(String(name));
  const clean = base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 128);
  if (!clean || clean === "." || clean === "..") throw new Error("INVALID_FILENAME");
  return clean;
}

module.exports = { resolveProjectPath, sanitizeFilename, assertSafeId };
