"use strict";

/**
 * UNFOLDIQ provider artifact store (STEP 10A).
 *
 * Layout per project:
 *   projects/<projectId>/assets/image/<sceneId>/
 *   projects/<projectId>/assets/video/<sceneId>/
 *   projects/<projectId>/assets/voice/<sceneId>/
 *   projects/<projectId>/assets/music/<sceneId>/
 *   projects/<projectId>/assets/sfx/<sceneId>/
 *   projects/<projectId>/timing/<sceneId>/
 *   projects/<projectId>/handoff/
 *   projects/<projectId>/continuity/
 *
 * Rules: project-relative paths in artifacts/results, filename sanitizing,
 * ../ prevention, reject paths outside project root, atomic writes, no secrets.
 */

const fs = require("fs");
const path = require("path");

const CAPABILITY_DIRS = {
  image: ["assets", "image"],
  video: ["assets", "video"],
  voice: ["assets", "voice"],
  tts: ["assets", "voice"],
  music: ["assets", "music"],
  sfx: ["assets", "sfx"],
};

function projectRootPath(root) {
  return path.resolve(root);
}

/** Project base directory: registry-aware (nested new-hierarchy paths), with
 * legacy projects/<projectId> fallback when the registry is absent. */
function projectBase(root, projectId) {
  try {
    const ws = require("../../lib/workspace/index.js");
    const r = ws.resolveProjectRoot(root, projectId);
    if (r.ok) return path.resolve(r.path);
  } catch { /* fall through to legacy layout */ }
  return path.resolve(root, "projects", projectId);
}

/** Resolve a project-relative path safely. Throws on traversal/escape. */
function resolveProjectPath(root, projectId, relativePath) {
  if (typeof relativePath !== "string" || relativePath.length === 0) {
    throw new Error("EMPTY_PATH");
  }
  const base = projectBase(root, projectId);
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

function assetDir(root, projectId, capability, sceneId) {
  const sub = CAPABILITY_DIRS[capability] || ["assets", capability];
  return path.join(projectBase(root, projectId), ...sub, sanitizeFilename(sceneId));
}

function ensureDir(absDir) {
  fs.mkdirSync(absDir, { recursive: true });
  return absDir;
}

/** Atomic write: tmp file + rename. Returns project-relative path. */
function writeArtifactAtomic(root, projectId, relativePath, data) {
  const { abs, relative } = resolveProjectPath(root, projectId, relativePath);
  ensureDir(path.dirname(abs));
  const tmp = `${abs}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, abs);
  return relative;
}

function artifactExists(root, projectId, relativePath) {
  try {
    const { abs } = resolveProjectPath(root, projectId, relativePath);
    return fs.existsSync(abs) && fs.statSync(abs).isFile();
  } catch {
    return false;
  }
}

function readArtifact(root, projectId, relativePath) {
  const { abs } = resolveProjectPath(root, projectId, relativePath);
  return fs.readFileSync(abs);
}

/** Fingerprint sidecar index: projects/<projectId>/assets/_fingerprints.json */
function fingerprintIndexPath(root, projectId) {
  return path.join(projectBase(root, projectId), "assets", "_fingerprints.json");
}

function readFingerprintIndex(root, projectId) {
  try {
    return JSON.parse(fs.readFileSync(fingerprintIndexPath(root, projectId), "utf8"));
  } catch {
    return {};
  }
}

function recordFingerprint(root, projectId, artifactRelativePath, fingerprint) {
  const index = readFingerprintIndex(root, projectId);
  index[artifactRelativePath] = fingerprint;
  const abs = fingerprintIndexPath(root, projectId);
  ensureDir(path.dirname(abs));
  const tmp = `${abs}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(index, null, 2));
  fs.renameSync(tmp, abs);
}

function findByFingerprint(root, projectId, fingerprint) {
  const index = readFingerprintIndex(root, projectId);
  for (const [artifactPath, fp] of Object.entries(index)) {
    if (fp === fingerprint && artifactExists(root, projectId, artifactPath)) {
      return artifactPath;
    }
  }
  return null;
}

module.exports = {
  CAPABILITY_DIRS,
  projectRootPath,
  resolveProjectPath,
  sanitizeFilename,
  assetDir,
  ensureDir,
  writeArtifactAtomic,
  artifactExists,
  readArtifact,
  readFingerprintIndex,
  recordFingerprint,
  findByFingerprint,
};
