"use strict";

/**
 * existing adapter (STEP 10A).
 * Reuses a project-relative artifact. READY only if valid:
 * exists, inside project, type-compatible when detectable,
 * fingerprint-compatible when an expected fingerprint is given.
 */

const path = require("path");
const store = require("../artifact-store");
const { permanent } = require("../errors");

const EXTENSION_CAPABILITY = {
  ".png": ["image"],
  ".jpg": ["image"],
  ".jpeg": ["image"],
  ".webp": ["image"],
  ".mp4": ["video"],
  ".webm": ["video"],
  ".mp3": ["voice", "music", "sfx", "tts"],
  ".wav": ["voice", "music", "sfx", "tts"],
  ".ogg": ["voice", "music", "sfx", "tts"],
  ".json": ["stt"],
};

function capabilityCompatible(capability, artifactRelativePath) {
  const ext = path.extname(artifactRelativePath).toLowerCase();
  const allowed = EXTENSION_CAPABILITY[ext];
  if (!allowed) return true; // not detectable → do not block
  const want = capability === "tts" ? "tts" : capability;
  return allowed.includes(want) || allowed.includes(capability);
}

async function execute(request, ctx = {}) {
  const root = ctx.projectRoot;
  const projectId = request.projectId;
  const rel = request.input && request.input.existingArtifactPath;

  const base = {
    version: "1.0.0",
    requestId: request.requestId,
    projectId,
    sceneId: request.sceneId,
    capability: request.capability,
    providerId: "existing",
    sourceType: "existing",
    provenanceNote: `Reused existing project artifact${rel ? ` ${rel}` : ""}`,
    rightsStatus: (request.rightsContext && request.rightsContext.rightsStatus) || "NOT_APPLICABLE",
    costClass: "ZERO_LOCAL",
  };

  if (!rel) {
    throw permanent("EXISTING_PATH_MISSING", "existing adapter requires input.existingArtifactPath");
  }

  let resolved;
  try {
    resolved = store.resolveProjectPath(root, projectId, rel);
  } catch (e) {
    throw permanent("PATH_TRAVERSAL_BLOCKED", `Existing artifact path escapes project: ${rel}`);
  }
  void resolved;

  if (!store.artifactExists(root, projectId, rel)) {
    throw permanent("EXISTING_ASSET_MISSING", `Existing artifact not found: ${rel}`);
  }

  if (!capabilityCompatible(request.capability, rel)) {
    throw permanent("EXISTING_TYPE_MISMATCH", `Existing artifact type incompatible with capability ${request.capability}: ${rel}`);
  }

  if (request.input.expectedFingerprint) {
    const index = store.readFingerprintIndex(root, projectId);
    const recorded = index[rel];
    if (recorded !== request.input.expectedFingerprint) {
      const err = permanent(
        "OUTDATED_FINGERPRINT",
        `Existing artifact fingerprint changed (upstream visual/continuity change): ${rel}`
      );
      err.outdated = true;
      throw err;
    }
  }

  return { ...base, status: "READY", artifactPath: rel };
}

module.exports = { execute, providerId: "existing" };
