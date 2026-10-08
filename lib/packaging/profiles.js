"use strict";

/**
 * Phase 4A §7 — Versioned Platform Publish Profiles (UNFOLDIQ CORE).
 *
 * Limits are profile-driven snapshots of official platform guidance
 * (sources recorded per value), never generic global hard-codes.
 * YouTube values: title ≤100 chars, description ≤5000 chars
 * (https://support.google.com/youtube/answer/57407); thumbnails 16:9,
 * min width 640, JPG/PNG (https://support.google.com/youtube/answer/72431).
 */

const PROFILE_VERSION = "1.0.0";

const PUBLISH_PROFILES = {
  "youtube-long-form@1.0.0": {
    profileId: "youtube-long-form",
    version: "1.0.0",
    platform: "youtube",
    contentType: "long-form",
    source: "platforms/youtube/PROFILE.yaml + YouTube upload/thumbnail help (checked 2026-09-25/26)",
    title: {
      maxCharacters: 100,
      invalidCharacterPolicy: "no control characters; no leading/trailing whitespace",
    },
    description: { maxCharacters: 5000 },
    thumbnail: {
      aspectRatio: { numerator: 16, denominator: 9 },
      recommendedWidth: 3840,
      recommendedHeight: 2160,
      minimumWidth: 640,
      minimumHeight: 360,
      allowedFormats: ["JPG", "PNG"],
      maxFileSizeBytes: 2 * 1024 * 1024,
    },
    requiredFields: ["title", "description", "thumbnail", "language", "audience", "rightsProvenance"],
    optionalFields: ["tags", "category", "playlistIntent", "visibilityIntent", "sources"],
    audiencePolicyRef: "audience-decision@1.0.0",
    rightsPolicyRef: "rights-provenance@1.0.0",
    metadataPolicyRef: "metadata-priority@1.0.0",
  },
};

// Metadata priority reflects platform reality: title/thumbnail/description
// dominate; tags are minimal (misspellings only).
const METADATA_PRIORITY = ["title", "thumbnail", "description", "captions/language", "audience/compliance", "rights/attribution", "tags"];

function getPublishProfile(profileRef) {
  return PUBLISH_PROFILES[profileRef] || null;
}

function listPublishProfiles() {
  return Object.keys(PUBLISH_PROFILES);
}

/** Hard-limit + character validation for a title under a profile. */
function validateTitleText(text, profile) {
  const errors = [];
  if (typeof text !== "string" || text.length === 0) {
    return { ok: false, errors: ["TITLE_EMPTY"] };
  }
  if (text.length > profile.title.maxCharacters) errors.push(`TITLE_TOO_LONG: ${text.length} > ${profile.title.maxCharacters}`);
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(text)) errors.push("INVALID_TITLE_CHARACTER: control character");
  if (/^\s|\s$/.test(text)) errors.push("INVALID_TITLE_CHARACTER: leading/trailing whitespace");
  return { ok: errors.length === 0, errors };
}

function validateDescriptionText(text, profile) {
  if (typeof text !== "string" || text.length === 0) return { ok: false, errors: ["DESCRIPTION_EMPTY"] };
  if (text.length > profile.description.maxCharacters) {
    return { ok: false, errors: [`DESCRIPTION_TOO_LONG: ${text.length} > ${profile.description.maxCharacters}`] };
  }
  return { ok: true, errors: [] };
}

/** Thumbnail geometry/format/size validation under a profile. */
function validateThumbnailAsset(thumb, profile) {
  const errors = [];
  const want = profile.thumbnail.aspectRatio.numerator / profile.thumbnail.aspectRatio.denominator;
  const got = thumb.height > 0 ? thumb.width / thumb.height : 0;
  if (Math.abs(got - want) / want > 0.02) {
    errors.push(`THUMBNAIL_WRONG_ASPECT: ${thumb.width}x${thumb.height} is not 16:9`);
  }
  if (thumb.width < profile.thumbnail.minimumWidth || thumb.height < (profile.thumbnail.minimumHeight || 0)) {
    errors.push(`THUMBNAIL_RESOLUTION_TOO_LOW: minimum ${profile.thumbnail.minimumWidth}px wide`);
  }
  if (!profile.thumbnail.allowedFormats.includes(String(thumb.format || "").toUpperCase())) {
    errors.push(`THUMBNAIL_FORMAT_INVALID: allowed ${profile.thumbnail.allowedFormats.join("/")}`);
  }
  if (profile.thumbnail.maxFileSizeBytes && thumb.fileSizeBytes > profile.thumbnail.maxFileSizeBytes) {
    errors.push(`THUMBNAIL_FILE_TOO_LARGE: ${(thumb.fileSizeBytes / 1048576).toFixed(2)}MB > 2MB`);
  }
  return { ok: errors.length === 0, errors };
}

module.exports = {
  PROFILE_VERSION,
  PUBLISH_PROFILES,
  METADATA_PRIORITY,
  getPublishProfile,
  listPublishProfiles,
  validateTitleText,
  validateDescriptionText,
  validateThumbnailAsset,
};
