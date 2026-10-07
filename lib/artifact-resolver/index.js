"use strict";

/**
 * POST-1H FIX 01 — stable Artifact Identity + Artifact Resolver (UNFOLDIQ CORE).
 *
 * A durable generated artifact is identified by an immutable `artifactId`
 * (`artifact://<id>`), never by its filesystem path alone. The registry
 * (`projects/artifact-registry.json`) is a semantic index: it maps the id to
 * the CURRENT physicalPath plus the contentHash and lifecycle state that let
 * a consumer verify the bytes it actually read.
 *
 * Folder hierarchy is navigation aid, not identity: renaming a folder must
 * never change an artifactId, and no new canonical durable reference may rely
 * exclusively on a physical path after this FIX.
 *
 * Failure is explicit: unknown id, missing bytes, hash mismatch, duplicate
 * id, or an invalid lifecycle state never falls back to a stale path.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const REGISTRY_REL = "projects/artifact-registry.json";
const REGISTRY_SCHEMA_VERSION = "1.0.0";

const VALID_LIFECYCLE = ["DRAFT", "GENERATED", "REVIEW", "APPROVED", "LOCKED", "GOLDEN", "SUPERSEDED", "ARCHIVED", "QUARANTINED", "PURGED"];

const ERRORS = {
  ARTIFACT_NOT_FOUND: "no artifact record for this artifactId",
  ARTIFACT_BYTES_MISSING: "registry record exists but physical bytes are absent",
  ARTIFACT_HASH_MISMATCH: "physical bytes do not match the registered contentHash",
  ARTIFACT_ID_AMBIGUOUS: "duplicate artifactId in registry",
  ARTIFACT_LIFECYCLE_INVALID: "artifact lifecycle state forbids this use",
  ARTIFACT_REGISTRY_INVALID: "artifact registry fails validation",
};

function registryPath(root) {
  return path.join(root || path.join(__dirname, "..", ".."), REGISTRY_REL);
}

function sha256File(abs) {
  const h = crypto.createHash("sha256");
  h.update(fs.readFileSync(abs));
  return "sha256:" + h.digest("hex");
}

/** Tree fingerprint for directory records: sha256 over sorted relpath:filehash lines. */
function sha256Tree(absDir) {
  const rows = [];
  const walk = (d) => {
    const entries = fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) rows.push(path.relative(absDir, p).split(path.sep).join("/") + ":" + sha256File(p));
    }
  };
  walk(absDir);
  return "tree-sha256:" + crypto.createHash("sha256").update(rows.join("\n")).digest("hex");
}

function validateRegistry(doc) {
  const errors = [];
  if (!doc || typeof doc !== "object") return { ok: false, errors: ["registry must be an object"] };
  if (doc.schemaVersion !== REGISTRY_SCHEMA_VERSION) errors.push(`schemaVersion must be ${REGISTRY_SCHEMA_VERSION}`);
  if (!Array.isArray(doc.artifacts)) errors.push("artifacts must be an array");
  else {
    const seen = new Set();
    for (const a of doc.artifacts) {
      if (!a || typeof a.artifactId !== "string" || !a.artifactId) { errors.push("artifact entry needs artifactId"); continue; }
      if (seen.has(a.artifactId)) errors.push(`duplicate artifactId ${a.artifactId}`);
      seen.add(a.artifactId);
      for (const k of ["artifactType", "physicalPath", "contentHash", "lifecycleStatus"]) {
        if (typeof a[k] !== "string" || !a[k]) errors.push(`artifact ${a.artifactId}: ${k} required`);
      }
      if (a.lifecycleStatus && !VALID_LIFECYCLE.includes(a.lifecycleStatus)) errors.push(`artifact ${a.artifactId}: bad lifecycleStatus`);
    }
  }
  return { ok: errors.length === 0, errors };
}

function loadRegistry(root) {
  const p = registryPath(root);
  if (!fs.existsSync(p)) return { ok: false, code: "ARTIFACT_NOT_FOUND", message: `${ERRORS.ARTIFACT_NOT_FOUND}: registry absent (${REGISTRY_REL})` };
  let doc;
  try { doc = JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) {
    return { ok: false, code: "ARTIFACT_REGISTRY_INVALID", message: `${ERRORS.ARTIFACT_REGISTRY_INVALID}: ${String((e && e.message) || e)}` };
  }
  const v = validateRegistry(doc);
  if (!v.ok) return { ok: false, code: "ARTIFACT_REGISTRY_INVALID", message: v.errors[0], errors: v.errors };
  return { ok: true, registry: doc, path: p };
}

/**
 * Resolve an artifactId to verified current bytes. Options:
 *   verifyHash (default true), allowLifecycle[] (default: anything but PURGED).
 */
function resolveArtifact(root, artifactId, opts = {}) {
  const loaded = loadRegistry(root);
  if (!loaded.ok) return loaded;
  const matches = loaded.registry.artifacts.filter((a) => a.artifactId === artifactId);
  if (matches.length === 0) {
    return { ok: false, code: "ARTIFACT_NOT_FOUND", message: `${ERRORS.ARTIFACT_NOT_FOUND}: ${artifactId}` };
  }
  if (matches.length > 1) {
    return { ok: false, code: "ARTIFACT_ID_AMBIGUOUS", message: `${ERRORS.ARTIFACT_ID_AMBIGUOUS}: ${artifactId}` };
  }
  const rec = matches[0];
  const allowed = opts.allowLifecycle || VALID_LIFECYCLE.filter((s) => s !== "PURGED");
  if (!allowed.includes(rec.lifecycleStatus)) {
    return { ok: false, code: "ARTIFACT_LIFECYCLE_INVALID", message: `${ERRORS.ARTIFACT_LIFECYCLE_INVALID}: ${artifactId} is ${rec.lifecycleStatus}` };
  }
  const repo = root || path.join(__dirname, "..", "..");
  const abs = path.resolve(repo, rec.physicalPath);
  if (!fs.existsSync(abs)) {
    return { ok: false, code: "ARTIFACT_BYTES_MISSING", message: `${ERRORS.ARTIFACT_BYTES_MISSING}: ${artifactId} → ${rec.physicalPath}` };
  }
  if (opts.verifyHash !== false) {
    const st = fs.statSync(abs);
    const actual = st.isFile() ? sha256File(abs) : sha256Tree(abs);
    if (actual !== rec.contentHash) {
      return { ok: false, code: "ARTIFACT_HASH_MISMATCH", message: `${ERRORS.ARTIFACT_HASH_MISMATCH}: ${artifactId} (registry ${rec.contentHash.slice(0, 19)}… vs disk ${actual.slice(0, 19)}…)` };
    }
  }
  return { ok: true, record: rec, physicalPath: rec.physicalPath, abs };
}

module.exports = {
  REGISTRY_REL,
  REGISTRY_SCHEMA_VERSION,
  VALID_LIFECYCLE,
  ERRORS,
  registryPath,
  sha256File,
  sha256Tree,
  validateRegistry,
  loadRegistry,
  resolveArtifact,
};
