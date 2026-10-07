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

/** Word-burst speech: one tone burst per word, separated by real silence —
 *  lets the energy aligner map speech runs 1:1 to words deterministically. */
function makeWordSpeechWav({ wordDurationMs = 400, wordCount = 6, pauseMs = 300, amplitude = 0.5, leadMs = 150, tailMs = 200 } = {}) {
  const totalMs = leadMs + wordCount * wordDurationMs + (wordCount - 1) * pauseMs + tailMs;
  const n = Math.round((totalMs / 1000) * FS);
  const s = new Int16Array(n);
  let cursor = Math.round((leadMs / 1000) * FS);
  for (let w = 0; w < wordCount; w += 1) {
    const len = Math.round((wordDurationMs / 1000) * FS);
    for (let i = 0; i < len; i += 1) {
      const t = i / FS;
      s[cursor + i] = Math.max(-32768, Math.min(32767,
        Math.round(amplitude * Math.sin(2 * Math.PI * (140 + w * 20) * t) * 32767)));
    }
    cursor += len + Math.round((pauseMs / 1000) * FS);
  }
  return wav.encodeWav(s, FS, 1);
}

/** Digital-silence WAV of given duration (unalignable-word injection). */
function encodeSilentWav(durationMs) {
  const n = Math.round((durationMs / 1000) * FS);
  return wav.encodeWav(new Int16Array(n), FS, 1);
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

module.exports = { FS, makeMusicWav, makeSpeechWav, makeWordSpeechWav, makeAmbienceWav, makeSfxWav, encodeSilentWav, makeTempRepo, APPROVED_RIGHTS };
