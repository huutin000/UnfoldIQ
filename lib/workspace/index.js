"use strict";

/**
 * POST-1H workspace governance (UNFOLDIQ CORE).
 *
 * Registry: projects/registry.json — index of every managed project
 * (kind + status + path + manifestRef). Kinds: ACTIVE, VALIDATION, DEMO,
 * DEBUG, ARCHIVE, LEGACY_MANAGED. The registry is an INDEX ONLY; it never
 * replaces the per-project Project Manifest and never moves bytes by itself.
 *
 * Resolver: one canonical path computer for new work —
 * resolveProjectRoot / resolveRunRoot / resolveArtifactPath /
 * resolveTempPath / resolveCachePath. New modules must resolve instead of
 * concatenating ad-hoc root/project paths.
 *
 * Guard: validateWorkspacePath() rejects arbitrary root/project folders
 * (projects/test2, D:/.../tmp123, ...) unless policy explicitly permits.
 * Lifecycle-at-creation: every new artifact resolves with an explicit
 * lifecycle class (DURABLE / RETENTION_MANAGED / REGENERABLE / EPHEMERAL);
 * unknown data fails safe to RETENTION_MANAGED + REVIEW_REQUIRED, never to
 * disposable.
 */

const fs = require("fs");
const path = require("path");

const REGISTRY_REL = "projects/registry.json";
const REGISTRY_SCHEMA_VERSION = "1.0.0";

const PROJECT_KINDS = ["ACTIVE", "VALIDATION", "DEMO", "DEBUG", "ARCHIVE", "LEGACY_MANAGED"];
const PROJECT_STATUS = ["ACTIVE", "FROZEN", "RETIRED"];
const LIFECYCLE_CLASSES = ["DURABLE", "RETENTION_MANAGED", "REGENERABLE", "EPHEMERAL"];

// Canonical workspace layout for NEW work (§9). Registered legacy paths stay
// resolvable, but since FIX POST-1H 01 an existing incoming reference alone no
// longer blocks migration: refs are rewritten first, and only a proven
// technical blocker keeps a path LEGACY_MANAGED/KEEP_IN_PLACE.
const KIND_DIR = {
  ACTIVE: "projects/active",
  VALIDATION: "projects/validation",
  DEMO: "projects/demos",
  DEBUG: "projects/debug",
  ARCHIVE: "projects/archive",
  LEGACY_MANAGED: null, // legacy path kept as-is, registered explicitly
};

const ARTIFACT_DIRS = {
  MANIFEST: "manifest",
  INPUT: "input",
  ASSETS: "assets",
  AUDIO: "audio",
  VOICE: "voice",
  CAPTIONS: "captions",
  TIMELINE: "timeline",
  OUTPUT: "output",
  EVIDENCE: "evidence",
  RUNS: "runs",
  CACHE: "cache",
  TMP: "tmp",
};

const ERRORS = {
  WORKSPACE_PATH_NOT_ALLOWED: "path is outside approved workspace locations",
  PROJECT_NOT_REGISTERED: "projectId has no registry entry",
  ARTIFACT_CLASS_REQUIRED: "artifactType is required to resolve an artifact path",
  LIFECYCLE_CLASS_REQUIRED: "lifecycleClass is required for new artifacts",
  RUN_SCOPE_REQUIRED: "run-scoped paths need projectId + runId",
  WORKSPACE_REFERENCE_CONFLICT: "resolved path collides with a registered foreign path",
  REGISTRY_INVALID: "project registry fails validation",
};

function repoRoot(root) {
  return root || path.join(__dirname, "..", "..");
}

function registryPath(root) {
  return path.join(repoRoot(root), REGISTRY_REL);
}

function validateRegistry(registry) {
  const errors = [];
  if (!registry || typeof registry !== "object") return { ok: false, errors: ["registry must be an object"] };
  if (registry.schemaVersion !== REGISTRY_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${REGISTRY_SCHEMA_VERSION}`);
  }
  if (!Array.isArray(registry.projects)) {
    errors.push("projects must be an array");
  } else {
    const seenIds = new Set();
    const seenPaths = new Set();
    for (const p of registry.projects) {
      if (!p || typeof p.projectId !== "string" || !p.projectId) { errors.push("project entry needs projectId"); continue; }
      if (seenIds.has(p.projectId)) errors.push(`duplicate projectId ${p.projectId}`);
      seenIds.add(p.projectId);
      if (!PROJECT_KINDS.includes(p.kind)) errors.push(`project ${p.projectId}: kind must be ${PROJECT_KINDS.join("|")}`);
      if (p.status !== undefined && !PROJECT_STATUS.includes(p.status)) errors.push(`project ${p.projectId}: bad status`);
      if (typeof p.path !== "string" || !p.path) { errors.push(`project ${p.projectId}: path required`); continue; }
      if (seenPaths.has(p.path)) errors.push(`duplicate path ${p.path}`);
      seenPaths.add(p.path);
      if (p.manifestRef !== undefined && p.manifestRef !== null && typeof p.manifestRef !== "string") {
        errors.push(`project ${p.projectId}: manifestRef must be a string or null`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

function loadRegistry(root) {
  const p = registryPath(root);
  if (!fs.existsSync(p)) return { ok: false, code: "PROJECT_NOT_REGISTERED", message: "projects/registry.json absent" };
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    return { ok: false, code: "REGISTRY_INVALID", message: `unparseable registry: ${String((e && e.message) || e)}` };
  }
  const v = validateRegistry(raw);
  if (!v.ok) return { ok: false, code: "REGISTRY_INVALID", message: v.errors[0], errors: v.errors };
  return { ok: true, registry: raw };
}

function getProject(root, projectId) {
  const loaded = loadRegistry(root);
  if (!loaded.ok) return loaded;
  const entry = loaded.registry.projects.find((p) => p.projectId === projectId);
  if (!entry) return { ok: false, code: "PROJECT_NOT_REGISTERED", message: `${ERRORS.PROJECT_NOT_REGISTERED}: ${projectId}` };
  return { ok: true, entry };
}

/** Canonical project root (resolves the REGISTERED path, whatever its kind). */
function resolveProjectRoot(root, projectId) {
  const r = getProject(root, projectId);
  if (!r.ok) return r;
  return { ok: true, path: path.join(repoRoot(root), r.entry.path) };
}

function resolveRunRoot(root, projectId, runId) {
  if (!runId) return { ok: false, code: "RUN_SCOPE_REQUIRED", message: ERRORS.RUN_SCOPE_REQUIRED };
  const r = resolveProjectRoot(root, projectId);
  if (!r.ok) return r;
  return { ok: true, path: path.join(r.path, "runs", runId) };
}

/**
 * Canonical artifact path for NEW work. Requires artifactType (known dir)
 * and lifecycleClass (explicit durability contract). EPHEMERAL artifacts
 * resolve under runs/<runId>/tmp unless a runId-less cache path is asked
 * with an explicit cache scope.
 */
function resolveArtifactPath(root, projectId, artifactType, lifecycleClass, opts = {}) {
  if (!artifactType || !ARTIFACT_DIRS[artifactType]) {
    return { ok: false, code: "ARTIFACT_CLASS_REQUIRED", message: `artifactType must be ${Object.keys(ARTIFACT_DIRS).join("|")}` };
  }
  if (!LIFECYCLE_CLASSES.includes(lifecycleClass)) {
    return { ok: false, code: "LIFECYCLE_CLASS_REQUIRED", message: `lifecycleClass must be ${LIFECYCLE_CLASSES.join("|")} (unknown data fails safe to RETENTION_MANAGED, never disposable)` };
  }
  const r = resolveProjectRoot(root, projectId);
  if (!r.ok) return r;
  const dir = ARTIFACT_DIRS[artifactType];
  if ((dir === "tmp" || dir === "cache") && !opts.runId && artifactType !== "CACHE") {
    return { ok: false, code: "RUN_SCOPE_REQUIRED", message: "run-scoped tmp needs runId" };
  }
  const base = dir === "tmp" && opts.runId
    ? path.join(r.path, "runs", opts.runId, "tmp")
    : path.join(r.path, dir);
  return { ok: true, path: opts.fileName ? path.join(base, opts.fileName) : base };
}

function resolveTempPath(root, projectId, runId, fileName = null) {
  return resolveArtifactPath(root, projectId, "TMP", "EPHEMERAL", { runId, fileName });
}

function resolveCachePath(root, projectId, fileName = null) {
  return resolveArtifactPath(root, projectId, "CACHE", "REGENERABLE", { fileName });
}

/**
 * Guard: requested absolute (or repo-relative) path + classification →
 * allowed or structured refusal. Rules:
 * - inside a registered project's resolved root → allowed (kind-aware).
 * - repo-root tmp/debug/final* names → refused (WORKSPACE_PATH_NOT_ALLOWED).
 * - projects/<unknown> directly under projects/ → refused unless the
 *   project is registered (PROJECT_NOT_REGISTERED).
 * - absolute paths outside the repo → refused.
 */
function validateWorkspacePath(root, requestedPath, opts = {}) {
  const repo = repoRoot(root);
  const abs = path.isAbsolute(requestedPath) ? path.normalize(requestedPath) : path.normalize(path.join(repo, requestedPath));
  if (!abs.startsWith(repo + path.sep) && abs !== repo) {
    return { ok: false, code: "WORKSPACE_PATH_NOT_ALLOWED", message: `${ERRORS.WORKSPACE_PATH_NOT_ALLOWED}: outside repository` };
  }
  const rel = path.relative(repo, abs).split(path.sep).join("/");
  if (rel === "" || rel.startsWith("..")) {
    return { ok: false, code: "WORKSPACE_PATH_NOT_ALLOWED", message: "repository root writes need explicit policy" };
  }
  const top = rel.split("/")[0];
  // Portability hazards (§16): a canonical stored reference must survive
  // Windows/macOS/Linux checkout. Reserved device names, illegal characters
  // and trailing dots/spaces create collisions or undeletable paths.
  const WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
  for (const seg of rel.split("/")) {
    if (seg === "" || seg === "." || seg === "..") continue;
    if (WIN_RESERVED.test(seg)) {
      return { ok: false, code: "WORKSPACE_PATH_NOT_ALLOWED", message: `Windows reserved device name in path: ${seg}` };
    }
    // eslint-disable-next-line no-control-regex
    if (/[<>:"|?*\x00-\x1f]/.test(seg)) {
      return { ok: false, code: "WORKSPACE_PATH_NOT_ALLOWED", message: `illegal filename character in path segment: ${seg}` };
    }
    if (/[. ]$/.test(seg)) {
      return { ok: false, code: "WORKSPACE_PATH_NOT_ALLOWED", message: `trailing dot/space in path segment: ${seg}` };
    }
  }
  const ROOT_DENY = /^(tmp\d*|temp\d*|debug-new|final-final|test2?|scratch\d*)$/i;
  if (ROOT_DENY.test(top)) {
    return { ok: false, code: "WORKSPACE_PATH_NOT_ALLOWED", message: `ad-hoc root folder ${top} is forbidden (use runs/<run-id>/tmp)` };
  }
  if (top === "projects") {
    const seg = rel.split("/");
    if (seg.length >= 2 && !["active", "validation", "demos", "debug", "archive", "runs"].includes(seg[1])) {
      // Legacy direct-child project path: allowed ONLY when registered.
      const loaded = loadRegistry(root);
      const registered = loaded.ok && loaded.registry.projects.some((p) => rel === p.path || rel.startsWith(p.path + "/"));
      if (!registered) {
        return { ok: false, code: "PROJECT_NOT_REGISTERED", message: `projects/${seg[1]} is not a registered project path` };
      }
    }
    if (opts.projectId) {
      const r = getProject(root, opts.projectId);
      if (!r.ok) return r;
      if (!(rel === r.entry.path || rel.startsWith(r.entry.path + "/"))) {
        return { ok: false, code: "WORKSPACE_REFERENCE_CONFLICT", message: `path is outside project ${opts.projectId} (${r.entry.path})` };
      }
    }
    return { ok: true, rel };
  }
  // Non-project areas: allow known source/data trees, refuse the rest unless
  // the caller declares an explicit scope.
  const OPEN_TOPS = ["lib", "core", "scripts", "schemas", "tests", "providers", "pipeline", "qa", "platforms", "policy", "research", "remotion", "flow-companion", "golden", "Report", "docs", "context", "brand", "assets", "mcp", ".agents", ".opencode", "out", "playwright-report", "test-results", "node_modules"];
  if (OPEN_TOPS.includes(top)) return { ok: true, rel };
  return { ok: false, code: "WORKSPACE_PATH_NOT_ALLOWED", message: `${ERRORS.WORKSPACE_PATH_NOT_ALLOWED}: ${top}/ needs explicit policy` };
}

/** Lifecycle-at-creation: unknown data fails safe (never disposable). */
function classifyNewArtifact(input = {}) {
  if (!input.artifactType) {
    return { ok: false, code: "ARTIFACT_CLASS_REQUIRED", message: ERRORS.ARTIFACT_CLASS_REQUIRED };
  }
  if (!input.lifecycleClass) {
    return { ok: true, lifecycleClass: "RETENTION_MANAGED", reviewRequired: true, reason: "unclassified at creation → RETENTION_MANAGED + REVIEW_REQUIRED (never disposable by default)" };
  }
  if (!LIFECYCLE_CLASSES.includes(input.lifecycleClass)) {
    return { ok: false, code: "LIFECYCLE_CLASS_REQUIRED", message: `lifecycleClass must be ${LIFECYCLE_CLASSES.join("|")}` };
  }
  return { ok: true, lifecycleClass: input.lifecycleClass, reviewRequired: false };
}

module.exports = {
  REGISTRY_REL,
  REGISTRY_SCHEMA_VERSION,
  PROJECT_KINDS,
  PROJECT_STATUS,
  LIFECYCLE_CLASSES,
  ARTIFACT_DIRS,
  ERRORS,
  validateRegistry,
  loadRegistry,
  getProject,
  resolveProjectRoot,
  resolveRunRoot,
  resolveArtifactPath,
  resolveTempPath,
  resolveCachePath,
  validateWorkspacePath,
  classifyNewArtifact,
};
