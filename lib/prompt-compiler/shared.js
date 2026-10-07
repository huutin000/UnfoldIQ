"use strict";

/**
 * UNFOLDIQ Prompt Compiler shared helpers (1G.4, Prompt 01).
 * Deterministic identity + bounded text utilities. No provider names, no
 * model selection, no generation.
 */

const crypto = require("crypto");
const { stableStringify } = require("../../providers/runtime/request-fingerprint.js");

const COMPILER_VERSION = "1.0.0";

function hash16(value) {
  return crypto.createHash("sha256").update(stableStringify(value), "utf8").digest("hex").slice(0, 16);
}

function id12(prefix, value) {
  return `${prefix}-${crypto.createHash("sha256").update(stableStringify(value), "utf8").digest("hex").slice(0, 12)}`;
}

const TARGET_KINDS = ["IMAGE", "VIDEO"];

/**
 * Canonical platform composition is CONSUMED from the platform profile owner
 * (platforms/<platform>/PROFILE.yaml) — never duplicated here (§23).
 */
function readPlatformComposition(platform, opts = {}) {
  const fs = require("fs");
  const path = require("path");
  if (!platform || !["youtube", "tiktok"].includes(platform)) return null;
  if (readPlatformComposition._cache && readPlatformComposition._cache[platform]) {
    return readPlatformComposition._cache[platform];
  }
  try {
    const yaml = require("js-yaml");
    const profilePath = opts.repoRoot
      ? path.join(opts.repoRoot, "platforms", platform, "PROFILE.yaml")
      : path.join(__dirname, "..", "..", "platforms", platform, "PROFILE.yaml");
    const profile = yaml.load(fs.readFileSync(profilePath, "utf8"));
    const composition = {
      platform,
      aspectRatio: (profile && (profile.platformFacts && profile.platformFacts.standardAspectRatio)
        || (profile && profile.projectDefaults && profile.projectDefaults.aspectRatio)) || null,
      orientation: (profile && (profile.projectDefaults && profile.projectDefaults.orientation)
        || (profile && profile.platformFacts && profile.platformFacts.preferredOrientation)) || null,
      source: `platforms/${platform}/PROFILE.yaml`,
    };
    readPlatformComposition._cache = readPlatformComposition._cache || {};
    readPlatformComposition._cache[platform] = composition;
    return composition;
  } catch {
    return null; // canonical config unavailable -> no invention
  }
}

module.exports = {
  COMPILER_VERSION,
  hash16,
  id12,
  TARGET_KINDS,
  readPlatformComposition,
};
