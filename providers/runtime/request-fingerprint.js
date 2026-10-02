"use strict";

/**
 * UNFOLDIQ provider request fingerprint / idempotency (STEP 10A).
 *
 * Fingerprints MATERIAL inputs:
 * - normalized prompt/input
 * - output requirements
 * - Creative Direction version/hash
 * - Visual Bible version/hash
 * - continuity refs/version
 * - capability + provider-relevant settings
 *
 * Never included: timestamps unrelated to content, random metadata.
 *
 * same request + READY artifact → REUSE
 * upstream change (script/scene, Visual Bible, continuity ref, creative direction)
 * → fingerprint changes → old asset OUTDATED (never silently overwritten).
 */

const crypto = require("crypto");

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

function normalizeInput(input) {
  if (!input || typeof input !== "object") return {};
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    const lower = k.toLowerCase();
    if (lower.includes("timestamp") || lower.includes("random") || lower.includes("nonce")) continue;
    if (lower.includes("secret") || lower.includes("token") || lower.includes("apikey") || lower.includes("api_key")) continue;
    out[k] = v;
  }
  return out;
}

function fingerprintRequest(request) {
  const creative = request.creativeContext || {};
  const continuity = request.continuityContext || {};
  const material = {
    projectId: request.projectId,
    sceneId: request.sceneId,
    capability: request.capability,
    input: normalizeInput(request.input),
    outputRequirements: request.outputRequirements || {},
    creativeDirectionVersion: creative.creativeDirectionVersion || null,
    visualBibleVersion: creative.visualBibleVersion || null,
    visualBibleConstraints: creative.visualBibleConstraints || null,
    continuityRegistryVersion: continuity.registryVersion || null,
    requiredEntities: continuity.requiredEntities || null,
    requiredReferences: continuity.requiredReferences || null,
    continuityStrictness: continuity.continuityStrictness || null,
    providerPreference: request.providerPreference || null,
    rightsSourceType: (request.rightsContext && request.rightsContext.sourceType) || null,
  };
  return crypto.createHash("sha256").update(stableStringify(material)).digest("hex");
}

module.exports = { fingerprintRequest, stableStringify, normalizeInput };
