"use strict";

/**
 * Phase 3A-04 — Canonical Timeline Timebase (UNFOLDIQ CORE, GAP-004).
 *
 * Canonical editorial time is INTEGER MILLISECONDS (the proven Phase 2
 * contract) + an explicit RATIONAL frame rate. Every time↔frame conversion
 * on the canonical path goes through this module's deterministic integer
 * functions — never scattered `Math.round(seconds * fps)`.
 *
 * Frame semantics: frame f covers timeline ms
 *   [frameStartMs(f), frameEndExclusiveMs(f))
 * where frameStartMs(f) = ceil(f * 1000 * den / num) and
 * frameEndExclusiveMs(f) = ceil((f+1) * 1000 * den / num).
 * Item coverage default: start → floor, end → ceil (§7).
 */

const ERRORS = {
  INVALID_FRAME_RATE: "frame rate must be a positive rational {numerator, denominator}",
  INVALID_TIME: "timeline time must be a finite non-negative integer (ms)",
  UNKNOWN_POLICY: "unknown timebase policy ref",
};

/** Rational frame rate. */
function makeFrameRate(numerator, denominator) {
  const n = Number(numerator);
  const d = Number(denominator);
  if (!Number.isInteger(n) || !Number.isInteger(d) || n <= 0 || d <= 0) {
    throw new Error(ERRORS.INVALID_FRAME_RATE);
  }
  const g = gcd(n, d);
  return { numerator: n / g, denominator: d / g };
}

function gcd(a, b) {
  return b === 0 ? a : gcd(b, a % b);
}

/** Parse decimal fps into canonical rational (23.976 → 24000/1001). */
function parseFrameRate(fps) {
  const SNAPS = [
    { v: 23.976, num: 24000, den: 1001 },
    { v: 29.97, num: 30000, den: 1001 },
    { v: 59.94, num: 60000, den: 1001 },
    { v: 47.952, num: 48000, den: 1001 },
    { v: 119.88, num: 120000, den: 1001 },
  ];
  for (const s of SNAPS) {
    if (Math.abs(fps - s.v) < 0.001) return makeFrameRate(s.num, s.den);
  }
  if (Number.isInteger(fps)) return makeFrameRate(fps, 1);
  // Other decimals: scale to at most 1/1000 precision.
  return makeFrameRate(Math.round(fps * 1000), 1000);
}

// Versioned timebase policies (§6). canonicalTimeUnit keeps the proven
// Phase 2 integer-millisecond contract; frames are derived deterministically.
const TIMELINE_TIMEBASE_POLICIES = {
  "web-30@1.0.0": {
    policyId: "web-30",
    version: "1.0.0",
    frameRate: { numerator: 30, denominator: 1 },
    audioSampleRate: 48000,
    canonicalTimeUnit: "MILLISECOND_INTEGER",
    startFrameRounding: "FLOOR",
    endFrameRounding: "EXCLUSIVE_CEIL",
    durationPolicy: "FINAL_AUDIO_DURATION",
    dropFrameTimecode: false,
  },
  "web-2997@1.0.0": {
    policyId: "web-2997",
    version: "1.0.0",
    frameRate: { numerator: 30000, denominator: 1001 },
    audioSampleRate: 48000,
    canonicalTimeUnit: "MILLISECOND_INTEGER",
    startFrameRounding: "FLOOR",
    endFrameRounding: "EXCLUSIVE_CEIL",
    durationPolicy: "FINAL_AUDIO_DURATION",
    dropFrameTimecode: true,
  },
  "film-24@1.0.0": {
    policyId: "film-24",
    version: "1.0.0",
    frameRate: { numerator: 24, denominator: 1 },
    audioSampleRate: 48000,
    canonicalTimeUnit: "MILLISECOND_INTEGER",
    startFrameRounding: "FLOOR",
    endFrameRounding: "EXCLUSIVE_CEIL",
    durationPolicy: "FINAL_AUDIO_DURATION",
    dropFrameTimecode: false,
  },
  "pal-25@1.0.0": {
    policyId: "pal-25",
    version: "1.0.0",
    frameRate: { numerator: 25, denominator: 1 },
    audioSampleRate: 48000,
    canonicalTimeUnit: "MILLISECOND_INTEGER",
    startFrameRounding: "FLOOR",
    endFrameRounding: "EXCLUSIVE_CEIL",
    durationPolicy: "FINAL_AUDIO_DURATION",
    dropFrameTimecode: false,
  },
  "ntsc-23976@1.0.0": {
    policyId: "ntsc-23976",
    version: "1.0.0",
    frameRate: { numerator: 24000, denominator: 1001 },
    audioSampleRate: 48000,
    canonicalTimeUnit: "MILLISECOND_INTEGER",
    startFrameRounding: "FLOOR",
    endFrameRounding: "EXCLUSIVE_CEIL",
    durationPolicy: "FINAL_AUDIO_DURATION",
    dropFrameTimecode: false,
  },
};

function getTimebasePolicy(ref) {
  const p = TIMELINE_TIMEBASE_POLICIES[ref];
  if (!p) throw new Error(`${ERRORS.UNKNOWN_POLICY}: ${ref}`);
  return p;
}

// ---------- deterministic conversions (integer math, no float fps) ----------

function assertMs(t) {
  if (!Number.isInteger(t) || t < 0) throw new Error(`${ERRORS.INVALID_TIME}: ${t}`);
}

/** Frame containing timeline ms t (start-frame floor semantics). */
function timeToFrameStart(t, frameRate) {
  assertMs(t);
  return Math.floor((t * frameRate.numerator) / (1000 * frameRate.denominator));
}

/** First frame whose coverage ends at-or-after t (end-exclusive ceil). */
function timeToFrameEndExclusive(t, frameRate) {
  assertMs(t);
  return Math.ceil((t * frameRate.numerator) / (1000 * frameRate.denominator));
}

/** Earliest ms inside frame f. */
function frameToTimeStart(f, frameRate) {
  return Math.ceil((f * 1000 * frameRate.denominator) / frameRate.numerator);
}

/** One-past-the-end ms of frame f. */
function frameToTimeEndExclusive(f, frameRate) {
  return Math.ceil(((f + 1) * 1000 * frameRate.denominator) / frameRate.numerator);
}

/** Frame count covering [startMs, endMs). */
function frameCount(startMs, endMs, frameRate) {
  assertMs(startMs);
  if (!Number.isInteger(endMs) || endMs < startMs) throw new Error(`${ERRORS.INVALID_TIME}: ${endMs}`);
  return timeToFrameEndExclusive(endMs, frameRate) - timeToFrameStart(startMs, frameRate);
}

/** Audio/caption timestamp → frame (same deterministic path, explicit alias). */
function timestampToFrame(t, frameRate) {
  return timeToFrameStart(t, frameRate);
}

/**
 * Round-trip invariant helpers: mapping a frame's own start ms back must
 * yield the same frame; mapping must be monotonic; converting the canonical
 * duration to frames and back to ms must never exceed ±1 frame of drift.
 */
function roundTripCheck(startMs, endMs, frameRate) {
  const sf = timeToFrameStart(startMs, frameRate);
  const ef = timeToFrameEndExclusive(endMs, frameRate);
  const rtStart = frameToTimeStart(sf, frameRate);
  const rtEnd = frameToTimeEndExclusive(ef - 1, frameRate);
  return {
    startFrame: sf,
    endFrameExclusive: ef,
    frameCount: ef - sf,
    roundTripStartMs: rtStart,
    roundTripEndMs: rtEnd,
    startFrameStable: timeToFrameStart(rtStart, frameRate) === sf,
    endFrameStable: timeToFrameEndExclusive(rtEnd, frameRate) === ef,
    monotonic: sf <= ef,
  };
}

module.exports = {
  ERRORS,
  TIMELINE_TIMEBASE_POLICIES,
  getTimebasePolicy,
  makeFrameRate,
  parseFrameRate,
  timeToFrameStart,
  timeToFrameEndExclusive,
  frameToTimeStart,
  frameToTimeEndExclusive,
  frameCount,
  timestampToFrame,
  roundTripCheck,
};
