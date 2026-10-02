"use strict";

/**
 * Flow Companion bridge path policy (STEP 10B).
 * All outputs confined to the UNFOLDIQ project root.
 * No absolute escapes, no traversal, no arbitrary filesystem writes.
 */

const path = require("path");

function resolveProjectPath(projectRoot, projectId, relativePath) {
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

module.exports = { resolveProjectPath, sanitizeFilename };
