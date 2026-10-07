"use strict";

/**
 * 1G.7 platform target loader (PHASE 1G.7, Prompt 01, §§5–6).
 * Reads platforms/TARGETS.yaml (canonical 1G.7 policy data) and references
 * base PROFILE.yaml files without duplicating them. Preferred / accepted /
 * required aspect semantics stay separate: required is null (UNKNOWN) unless
 * a real hard constraint with a source exists.
 */

const fs = require("fs");
const path = require("path");
const shared = require("./shared.js");

function repoRoot() {
  return path.join(__dirname, "..", "..");
}

function loadTargets(repoRootPath) {
  const root = repoRootPath || repoRoot();
  const yaml = require("js-yaml");
  const doc = yaml.load(fs.readFileSync(path.join(root, "platforms", "TARGETS.yaml"), "utf8"));
  return doc;
}

function baseProfileAspect(root, baseProfile) {
  try {
    const yaml = require("js-yaml");
    const profile = yaml.load(fs.readFileSync(path.join(root, baseProfile), "utf8"));
    return (profile && profile.projectDefaults && profile.projectDefaults.aspectRatio)
      || (profile && profile.platformFacts && (profile.platformFacts.standardAspectRatio || profile.platformFacts.preferredOrientation === "vertical" ? "9:16" : null))
      || null;
  } catch {
    return null; // canonical config unavailable — never invented
  }
}

/** Normalized target profile with preferred/accepted/required kept distinct. */
function getTargetProfile(platformId, opts = {}) {
  if (!shared.PLATFORM_IDS.includes(platformId)) {
    return { ok: false, code: "UNKNOWN_PLATFORM", message: `platform ${platformId} is not a canonical 1G.7 target` };
  }
  const root = opts.repoRoot || repoRoot();
  const doc = loadTargets(root);
  const raw = doc.targets[platformId];
  const sourceById = new Map((doc.sources || []).map((s) => [s.sourceId, s]));
  const profile = {
    version: doc.version,
    policyVersion: doc.policyVersion,
    verifiedAt: doc.verifiedAt,
    platformId,
    displayName: raw.displayName,
    baseProfile: raw.baseProfile,
    baseProfileAspect: baseProfileAspect(root, raw.baseProfile),
    preferredAspectRatio: raw.preferredAspectRatio,
    acceptedAspectRatios: Array.isArray(raw.acceptedAspectRatios) ? [...raw.acceptedAspectRatios] : null, // null = UNKNOWN / non-exhaustive, never a narrow exhaustive claim
    acceptanceNote: raw.acceptanceNote || null, // required documentation when accepted is UNKNOWN
    requiredAspectRatio: raw.requiredAspectRatio || null, // null = UNKNOWN, never a collapsed preferred
    orientation: raw.orientation,
    compositionPolicy: raw.compositionPolicy || {},
    safeZonePolicy: raw.safeZonePolicy || {},
    cropPolicy: raw.cropPolicy || {},
    textPolicy: raw.textPolicy || {},
    captionPolicy: raw.captionPolicy || {},
    graphicPolicy: raw.graphicPolicy || {},
    pacingPolicy: raw.pacingPolicy || {},
    shotDensityPolicy: raw.shotDensityPolicy || {},
    sources: doc.sources || [],
    sourceById,
  };
  profile.fingerprint = shared.hash16({
    platformId, preferred: profile.preferredAspectRatio, accepted: profile.acceptedAspectRatios,
    acceptanceNote: profile.acceptanceNote || null,
    required: profile.requiredAspectRatio, safeZones: profile.safeZonePolicy, policies: [
      profile.cropPolicy, profile.textPolicy, profile.captionPolicy,
      profile.graphicPolicy, profile.pacingPolicy, profile.shotDensityPolicy,
    ],
  });
  return { ok: true, profile };
}

module.exports = { loadTargets, getTargetProfile, baseProfileAspect };
