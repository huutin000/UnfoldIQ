"use strict";

/**
 * Phase 4B §6–§7 — Versioned FinalExportProfile (UNFOLDIQ CORE).
 *
 * YouTube long-form SDR pilot target: MP4 / H.264 progressive / yuv420p /
 * AAC 48kHz / BT.709, canonical timeline frame rate, selected aspect.
 * Renderer never silently changes fps/duration/aspect/color intent —
 * mismatch BLOCKS or REVIEWS instead of falling back silently.
 * (Benchmark: https://support.google.com/youtube/answer/1722171)
 */

const PROFILE_VERSION = "1.0.0";

const EXPORT_PROFILES = {
  "youtube-sdr-1080p@1.0.0": {
    profileId: "youtube-sdr-1080p",
    version: "1.0.0",
    platform: "youtube",
    contentType: "long-form",
    source: "YouTube recommended upload settings (MP4/H.264/AAC/48kHz/BT.709 SDR)",
    container: "mp4",
    video: {
      codec: "h264",
      profile: "high",
      width: 1920,
      height: 1080,
      frameRate: null, // resolved per-job from canonical Master Timeline rate
      progressive: true,
      pixelFormat: "yuv420p",
      bitratePolicy: "renderer-default",
    },
    audio: {
      codec: "aac",
      sampleRate: 48000,
      channels: 2,
      bitrate: "renderer-default",
    },
    color: {
      primaries: "bt709",
      transfer: "bt709",
      matrix: "bt709",
      range: "tv",
    },
    fastStart: true,
    validationPolicyRef: "final-export-qc@1.0.0",
  },
};

function getExportProfile(profileRef) {
  const p = EXPORT_PROFILES[profileRef];
  return p ? JSON.parse(JSON.stringify(p)) : null;
}

function listExportProfiles() {
  return Object.keys(EXPORT_PROFILES);
}

/** Resolve timeline-derived fields (frame rate) into an effective profile. */
function resolveExportProfile(profileRef, timelineFrameRate) {
  const p = getExportProfile(profileRef);
  if (!p) return { ok: false, code: "UNKNOWN_EXPORT_PROFILE", message: profileRef };
  if (!timelineFrameRate || !timelineFrameRate.numerator || !timelineFrameRate.denominator) {
    return { ok: false, code: "INPUT_INVALID", message: "canonical timeline frameRate required" };
  }
  p.video.frameRate = { numerator: timelineFrameRate.numerator, denominator: timelineFrameRate.denominator };
  return { ok: true, profile: p };
}

module.exports = { PROFILE_VERSION, EXPORT_PROFILES, getExportProfile, listExportProfiles, resolveExportProfile };
