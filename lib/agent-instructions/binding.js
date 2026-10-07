"use strict";

/**
 * FIX 02 §6 — canonical local→provider project binding (1G.9).
 * One non-secret mapping: local projectId → providerProjectRef.
 * Persisted only after the provider identity is actually observed
 * (never invented, never inferred from tab title).
 * Layout: projects/<projectId>/flow-project-binding.json
 */

const artifactStore = require("../../providers/runtime/artifact-store.js");

const BINDING_REL = "flow-project-binding.json";
const SECRET_KEY_RE = /token|cookie|session|apikey|api[_-]?key|password|secret|credential|auth|bearer/i;

function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Input: { projectId, provider, providerProjectRef, providerProjectName?,
 *   verifiedAt?, evidenceRef? }. providerProjectRef "UNKNOWN" is refused:
 *   a binding to an unknown ref is worse than no binding.
 */
function saveProjectBinding(root, binding) {
  if (!isObject(binding) || !binding.projectId || !binding.provider || !binding.providerProjectRef) {
    return { ok: false, code: "BINDING_SOURCE_INVALID", message: "projectId, provider and providerProjectRef are required" };
  }
  if (binding.providerProjectRef === "UNKNOWN") {
    return { ok: false, code: "BINDING_REF_UNKNOWN", message: "refusing to bind an UNKNOWN provider ref" };
  }
  for (const k of Object.keys(binding)) {
    if (SECRET_KEY_RE.test(k)) return { ok: false, code: "BINDING_SECRET_REJECTED", message: `secret-like key refused: ${k}` };
  }
  const record = {
    projectId: String(binding.projectId),
    provider: String(binding.provider),
    providerProjectRef: String(binding.providerProjectRef),
    providerProjectName: binding.providerProjectName != null ? String(binding.providerProjectName) : null,
    verifiedAt: binding.verifiedAt || null,
    evidenceRef: binding.evidenceRef || null,
  };
  try {
    artifactStore.writeArtifactAtomic(root, record.projectId, BINDING_REL, JSON.stringify(record, null, 2));
    return { ok: true, path: `projects/${record.projectId}/${BINDING_REL}` };
  } catch (e) {
    return { ok: false, code: "BINDING_PERSIST_FAILED", message: String((e && e.message) || e) };
  }
}

function loadProjectBinding(root, projectId) {
  try {
    if (!artifactStore.artifactExists(root, projectId, BINDING_REL)) return { ok: true, binding: null };
    return { ok: true, binding: JSON.parse(artifactStore.readArtifact(root, projectId, BINDING_REL).toString("utf8")) };
  } catch (e) {
    return { ok: false, code: "BINDING_LOAD_FAILED", message: String((e && e.message) || e) };
  }
}

module.exports = { BINDING_REL, saveProjectBinding, loadProjectBinding };
