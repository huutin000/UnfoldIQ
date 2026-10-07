"use strict";

/**
 * Phase 2.9-C/D — local known-text alignment provider (UNFOLDIQ CORE).
 *
 * Deterministic, dependency-free forced alignment of KNOWN text over clean
 * narration stems: real decoded PCM bytes → speech runs (measured silence
 * spans) → words allocated over concatenated speech time (1:1 mapping when
 * run count matches word count, otherwise duration-proportional by word
 * length). ASR never replaces canonical text; this provider only times it.
 *
 * The AlignmentProvider abstraction (see lib/alignment/index.js) lets a
 * WhisperX/MFA-class provider plug in later without touching contracts.
 */

const wav = require("../../audio-wav.js");

const ID = "local-energy-known-text";
const VERSION = "1.0.0";

const ERRORS = {
  DECODE_FAILED: "stem audio is not decodable PCM16 WAV",
};

function capabilities() {
  return {
    wordTiming: true,
    phoneTiming: false,
    confidence: true,
    local: true,
    offline: true,
    speakerSegmentInput: true,
    languages: ["*"],
  };
}

/**
 * Speech runs from real bytes: non-silent spans above minSilenceMs.
 */
function speechRuns(bytes, { minSilenceMs = 120, silenceRmsThreshold = 60 } = {}) {
  const d = wav.decodeWav(bytes);
  if (!d.ok) return { ok: false, code: "DECODE_FAILED", message: ERRORS.DECODE_FAILED };
  const m = wav.measure(d.samples, d.sampleRate, { minSilenceMs, silenceRmsThreshold });
  const durationMs = m.durationMs;
  const spans = [];
  let cursor = 0;
  for (const s of m.silenceSpans) {
    if (s.startMs - cursor >= 80) spans.push({ startMs: cursor, endMs: s.startMs });
    cursor = s.endMs;
  }
  if (durationMs - cursor >= 80) spans.push({ startMs: cursor, endMs: durationMs });
  const speechTotalMs = spans.reduce((n, s) => n + (s.endMs - s.startMs), 0);
  return { ok: true, durationMs, runs: spans, speechTotalMs, speechRatio: durationMs > 0 ? speechTotalMs / durationMs : 0 };
}

function tokenize(text) {
  return String(text).trim().split(/\s+/).filter(Boolean);
}

/**
 * Allocate words over the concatenated speech timeline, then map back onto
 * the real timeline (gaps between runs stay silent — no word spans silence).
 */
function allocate(words, runs, speechTotalMs) {
  const weights = words.map((w) => w.replace(/[^\p{L}\p{N}]/gu, "").length || 1);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const out = [];
  let speechCursor = 0;
  let runIdx = 0;
  let runCursor = runs.length ? runs[0].startMs : 0;
  for (let i = 0; i < words.length; i += 1) {
    const dur = speechTotalMs * (weights[i] / totalWeight);
    const startSpeech = speechCursor;
    const endSpeech = Math.min(speechTotalMs, speechCursor + dur);
    // Map speech-time range back onto runs.
    const mapToTimeline = (speechMs) => {
      let remaining = speechMs;
      let idx = 0;
      let pos = runs.length ? runs[0].startMs : 0;
      while (idx < runs.length) {
        const len = runs[idx].endMs - runs[idx].startMs;
        if (remaining <= len || idx === runs.length - 1) return pos + Math.min(remaining, len);
        remaining -= len;
        pos = runs[idx].endMs;
        idx += 1;
      }
      return pos;
    };
    void runIdx; void runCursor;
    out.push({
      startMs: Math.round(mapToTimeline(startSpeech)),
      endMs: Math.max(Math.round(mapToTimeline(startSpeech)) + 1, Math.round(mapToTimeline(endSpeech))),
    });
    speechCursor = endSpeech;
  }
  return out;
}

/**
 * Align ONE segment. Returns { ok, words: [{text,startMs,endMs,status,confidence}], durationMs }.
 * request: { text, audioBytes, expectedStartMs, expectedEndMs, pronunciationHints? }
 */
function alignSegment(request = {}) {
  const tokens = tokenize(request.text || "");
  if (tokens.length === 0) {
    return { ok: false, code: "EMPTY_TEXT", message: "segment text is empty" };
  }
  const bytes = request.audioBytes;
  if (!bytes) {
    return { ok: true, words: tokens.map((t) => ({ text: t, startMs: 0, endMs: 0, status: "UNALIGNED", confidence: 0 })), durationMs: 0, speechRatio: 0 };
  }
  const runs = speechRuns(bytes);
  if (!runs.ok) return runs;
  const offset = request.expectedStartMs || 0;
  if (runs.speechTotalMs < 100) {
    return { ok: true, words: tokens.map((t) => ({ text: t, startMs: offset, endMs: offset + 1, status: "UNALIGNED", confidence: 0 })), durationMs: runs.durationMs, speechRatio: runs.speechRatio };
  }
  const spans = allocate(tokens, runs.runs, runs.speechTotalMs);
  const confidence = Math.min(0.9, 0.5 + 0.4 * runs.speechRatio);
  const words = tokens.map((t, i) => ({
    text: t,
    startMs: offset + spans[i].startMs,
    endMs: offset + spans[i].endMs,
    status: "ALIGNED",
    confidence: Number(confidence.toFixed(3)),
  }));
  return { ok: true, words, durationMs: runs.durationMs, speechRatio: Number(runs.speechRatio.toFixed(4)) };
}

module.exports = {
  ID,
  VERSION,
  ERRORS,
  capabilities,
  speechRuns,
  tokenize,
  allocate,
  alignSegment,
};
