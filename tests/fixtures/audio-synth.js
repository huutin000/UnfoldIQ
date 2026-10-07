"use strict";

/**
 * Phase 2.7/2.8 test fixtures — deterministic PCM16 audio synthesis.
 * Real WAV bytes (decoded/measured by the runtime), generated in-process so
 * no binary fixtures are stored in the repo. All synthesis is deterministic.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const wav = require("../../lib/audio-wav.js");

const FS = 24000;

function env(t, segments) {
  // segments: [{untilMs, energy}]
  let acc = 0;
  for (const s of segments) {
    acc += s.untilMs;
    if (t < acc) return s.energy;
  }
  return segments[segments.length - 1].energy;
}

/** Structured music-like tone: energy sections, optional vibrato layer. */
function makeMusicWav({ durationMs, segments = [{ untilMs: durationMs, energy: 0.6 }], freq = 220 }) {
  const n = Math.round((durationMs / 1000) * FS);
  const s = new Int16Array(n);
  for (let i = 0; i < n; i += 1) {
    const t = i / FS;
    const e = env(t * 1000, segments);
    const v = 0.45 * e * Math.sin(2 * Math.PI * freq * t) * (0.7 + 0.3 * Math.sin(2 * Math.PI * 2 * t));
    s[i] = Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
  }
  return wav.encodeWav(s, FS, 1);
}

/** Speech-like: syllable-rate AM tone burst pattern with pauses. */
function makeSpeechWav({ durationMs, amplitude = 0.5 }) {
  const n = Math.round((durationMs / 1000) * FS);
  const s = new Int16Array(n);
  for (let i = 0; i < n; i += 1) {
    const t = i / FS;
    const syllable = Math.max(0, Math.sin(2 * Math.PI * 3 * t)); // 3 Hz syllables
    const v = amplitude * syllable * Math.sin(2 * Math.PI * 150 * t);
    s[i] = Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
  }
  return wav.encodeWav(s, FS, 1);
}

/** Ambience: low-level slowly evolving texture. */
function makeAmbienceWav({ durationMs, amplitude = 0.15 }) {
  const n = Math.round((durationMs / 1000) * FS);
  const s = new Int16Array(n);
  for (let i = 0; i < n; i += 1) {
    const t = i / FS;
    const v = amplitude *
      (0.5 * Math.sin(2 * Math.PI * 80 * t) + 0.3 * Math.sin(2 * Math.PI * 130 * t + 1) + 0.2 * Math.sin(2 * Math.PI * 7 * t));
    s[i] = Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
  }
  return wav.encodeWav(s, FS, 1);
}

/** One-shot SFX: sharp attack + exponential decay. */
function makeSfxWav({ durationMs = 800, amplitude = 0.9 } = {}) {
  const n = Math.round((durationMs / 1000) * FS);
  const s = new Int16Array(n);
  for (let i = 0; i < n; i += 1) {
    const t = i / FS;
    const decay = Math.exp(-t * 6);
    const v = amplitude * decay * Math.sin(2 * Math.PI * 400 * t);
    s[i] = Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
  }
  return wav.encodeWav(s, FS, 1);
}

/** Isolated temp repo-root for library state (never touches real assets/). */
function makeTempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "unfoldiq-audio-test-"));
}

const APPROVED_RIGHTS = {
  provider: "USER_IMPORTED_LICENSED_ASSET",
  licenseType: "ROYALTY_FREE",
  commercialUse: true,
  monetization: true,
  allowedPlatforms: ["youtube", "tiktok"],
  reuseScope: "MULTI_PROJECT",
  licenseEvidenceRef: "evidence/test-license.pdf",
  status: "APPROVED",
};

module.exports = { FS, makeMusicWav, makeSpeechWav, makeAmbienceWav, makeSfxWav, makeTempRepo, APPROVED_RIGHTS };
