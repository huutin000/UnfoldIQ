"use strict";

/**
 * Phase 2.7-E — Music asset analysis at ingest (UNFOLDIQ CORE).
 *
 * One-time heavy analysis over real decoded PCM bytes. Produces energy curve,
 * sections, safe cut points, loop candidates, silence regions, loudness/peak
 * metadata and an optional BPM estimate (omitted when confidence is low).
 * Existing project tooling (lib/audio-wav + lib/audio-loudness) is sufficient;
 * no Essentia/librosa dependency is introduced without a measured blocker.
 */

const wav = require("../audio-wav.js");
const loudness = require("../audio-loudness.js");

const ANALYSIS_VERSION = "1.0.0";
const ENERGY_FRAME_MS = 200;
const BPM_MIN = 60;
const BPM_MAX = 190;
const BPM_MIN_CONFIDENCE = 0.5;
const LOOP_WINDOW_MS_MIN = 5000;
const LOOP_WINDOW_MS_MAX = 16000;

const ERRORS = {
  ANALYSIS_DECODE_FAILED: "music bytes are not a decodable PCM16 WAV",
};

function decodeMono(bytes) {
  const d = wav.decodeWav(bytes);
  if (!d.ok) return { ok: false, code: "ANALYSIS_DECODE_FAILED", message: ERRORS.ANALYSIS_DECODE_FAILED };
  let samples = d.samples;
  if (d.channels > 1) {
    const n = Math.floor(samples.length / d.channels);
    const mono = new Int16Array(n);
    for (let i = 0; i < n; i += 1) {
      let acc = 0;
      for (let c = 0; c < d.channels; c += 1) acc += samples[i * d.channels + c];
      mono[i] = Math.max(-32768, Math.min(32767, Math.round(acc / d.channels)));
    }
    samples = mono;
  }
  return { ok: true, samples, sampleRate: d.sampleRate };
}

function energyCurve(samples, sampleRate) {
  const frames = wav.frameRms(samples, sampleRate, ENERGY_FRAME_MS);
  let peakRms = 0;
  for (const f of frames) if (f.rms > peakRms) peakRms = f.rms;
  return frames.map((f) => ({
    timeMs: f.startMs,
    value: peakRms > 0 ? Number(Math.min(1, f.rms / peakRms).toFixed(4)) : 0,
  }));
}

/**
 * Section segmentation from the energy curve: split at largest sustained
 * energy changes, then classify each section by level and slope.
 */
function sections(curve, durationMs) {
  if (curve.length === 0) return [];
  const mean = curve.reduce((s, c) => s + c.value, 0) / curve.length;
  // Split points where |level - previous level| stays high for 2+ frames.
  const splits = [0];
  for (let i = 2; i < curve.length - 2; i += 1) {
    const before = (curve[i - 2].value + curve[i - 1].value) / 2;
    const after = (curve[i].value + curve[i + 1].value) / 2;
    if (Math.abs(after - before) > 0.25 && Math.abs(curve[i].value - mean) > 0.1) {
      const t = curve[i].timeMs;
      if (t - splits[splits.length - 1] > 3000) splits.push(t);
    }
  }
  splits.push(durationMs);
  const out = [];
  for (let i = 0; i < splits.length - 1; i += 1) {
    const seg = curve.filter((c) => c.timeMs >= splits[i] && c.timeMs < splits[i + 1]);
    if (seg.length === 0) continue;
    const energy = seg.reduce((s, c) => s + c.value, 0) / seg.length;
    const firstHalf = seg.slice(0, Math.max(1, Math.floor(seg.length / 2)));
    const secondHalf = seg.slice(Math.floor(seg.length / 2));
    const slope = secondHalf.reduce((s, c) => s + c.value, 0) / secondHalf.length -
      firstHalf.reduce((s, c) => s + c.value, 0) / firstHalf.length;
    out.push({ startMs: splits[i], endMs: splits[i + 1], energy: Number(energy.toFixed(4)), slope });
  }
  // Classify.
  const energies = out.map((s) => s.energy).sort((a, b) => a - b);
  const highCut = energies[Math.floor((energies.length - 1) * 0.7)] || 0;
  const lowCut = energies[Math.floor((energies.length - 1) * 0.3)] || 0;
  return out.map((s, idx) => {
    let type = "UNKNOWN";
    if (idx === 0 && s.slope >= 0) type = "INTRO";
    else if (idx === out.length - 1 && s.slope <= 0) type = "OUTRO";
    else if (s.energy >= highCut) type = "CLIMAX";
    else if (s.slope > 0.05) type = "BUILD";
    else if (s.energy <= lowCut) type = "LOW_ENERGY";
    return { startMs: s.startMs, endMs: s.endMs, type, energy: s.energy };
  });
}

/** Safe cut points: section boundaries + local energy minima (low-disruption). */
function safeCutPoints(curve, sectionList) {
  const points = new Set();
  for (const s of sectionList) {
    points.add(s.startMs);
    points.add(s.endMs);
  }
  for (let i = 1; i < curve.length - 1; i += 1) {
    if (curve[i].value <= curve[i - 1].value && curve[i].value <= curve[i + 1].value && curve[i].value < 0.6) {
      points.add(curve[i].timeMs);
    }
  }
  return [...points].sort((a, b) => a - b);
}

/**
 * Loop candidates: windows with near-equal boundary energy and low internal
 * variance. Confidence from boundary match + flatness.
 */
function loopCandidates(curve) {
  const out = [];
  if (curve.length < 5) return out;
  const step = Math.max(1, Math.round(1000 / ENERGY_FRAME_MS));
  const minLen = Math.round(LOOP_WINDOW_MS_MIN / ENERGY_FRAME_MS);
  const maxLen = Math.min(Math.round(LOOP_WINDOW_MS_MAX / ENERGY_FRAME_MS), curve.length - 1);
  for (let start = 0; start + minLen < curve.length; start += step) {
    for (let len = minLen; len <= maxLen && start + len < curve.length; len += Math.max(1, minLen - 1)) {
      const seg = curve.slice(start, start + len);
      const head = (seg[0].value + seg[1].value) / 2;
      const tail = (seg[seg.length - 1].value + seg[seg.length - 2].value) / 2;
      const boundaryMatch = 1 - Math.min(1, Math.abs(head - tail));
      if (boundaryMatch < 0.85) continue;
      const mean = seg.reduce((s, c) => s + c.value, 0) / seg.length;
      const variance = seg.reduce((s, c) => s + (c.value - mean) * (c.value - mean), 0) / seg.length;
      const flatness = 1 - Math.min(1, Math.sqrt(variance) * 3);
      const confidence = Number((boundaryMatch * 0.6 + flatness * 0.4).toFixed(3));
      if (confidence >= 0.6) {
        out.push({ startMs: curve[start].timeMs, endMs: curve[start + len].timeMs, confidence });
      }
    }
  }
  out.sort((a, b) => b.confidence - a.confidence);
  return out.slice(0, 8);
}

/**
 * BPM estimate via autocorrelation of the onset envelope (energy delta,
 * half-wave rectified). Omitted when confidence < BPM_MIN_CONFIDENCE.
 */
function estimateBpm(samples, sampleRate, durationMs) {
  if (durationMs < 8000) return { bpm: undefined, bpmConfidence: 0, beatsMs: [] };
  const frames = wav.frameRms(samples, sampleRate, 20);
  const rms = frames.map((f) => f.rms);
  let mean = rms.reduce((s, v) => s + v, 0) / rms.length;
  const onset = rms.map((v) => Math.max(0, v - mean));
  const fs = 1000 / 20; // 50 Hz envelope
  const lagMin = Math.round((60 / BPM_MAX) * fs);
  const lagMax = Math.round((60 / BPM_MIN) * fs);
  let bestLag = 0;
  let bestScore = 0;
  let total = 0;
  for (let lag = lagMin; lag <= lagMax && lag < onset.length; lag += 1) {
    let acc = 0;
    for (let i = 0; i + lag < onset.length; i += 1) acc += onset[i] * onset[i + lag];
    total += acc;
    if (acc > bestScore) { bestScore = acc; bestLag = lag; }
  }
  if (!bestLag || total === 0) return { bpm: undefined, bpmConfidence: 0, beatsMs: [] };
  const bpm = 60 / (bestLag / fs);
  const prominence = bestScore / (total / (lagMax - lagMin + 1));
  const confidence = Math.min(1, Number(((prominence - 1) / 2).toFixed(3)));
  if (confidence < BPM_MIN_CONFIDENCE) return { bpm: undefined, bpmConfidence: confidence, beatsMs: [] };
  const period = (60 / bpm) * 1000;
  const beats = [];
  for (let t = 0; t < durationMs; t += period) beats.push(Math.round(t));
  return { bpm: Number(bpm.toFixed(1)), bpmConfidence: confidence, beatsMs: beats };
}

/**
 * Analyze one asset. bytes must be PCM16 WAV (stereo is downmixed).
 */
function analyzeMusicAsset({ bytes, assetId }) {
  const d = decodeMono(bytes);
  if (!d.ok) return d;
  const { samples, sampleRate } = d;
  const durationMs = Math.round((samples.length / sampleRate) * 1000);
  const curve = energyCurve(samples, sampleRate);
  const sectionList = sections(curve, durationMs);
  const silence = wav.measure(samples, sampleRate, { minSilenceMs: 500 }).silenceSpans
    .map((s) => ({ startMs: s.startMs, endMs: s.endMs }));
  const bpmResult = estimateBpm(samples, sampleRate, durationMs);
  const loud = loudness.measureLoudness(samples, sampleRate);
  return {
    ok: true,
    analysis: {
      assetId,
      analysisVersion: ANALYSIS_VERSION,
      durationMs,
      bpm: bpmResult.bpm,
      bpmConfidence: bpmResult.bpmConfidence,
      beatsMs: bpmResult.beatsMs.length ? bpmResult.beatsMs : undefined,
      sections: sectionList,
      energyCurve: curve,
      safeCutPointsMs: safeCutPoints(curve, sectionList),
      loopCandidates: loopCandidates(curve),
      silenceRegions: silence,
      loudness: Number.isFinite(loud.integratedLufs)
        ? { status: "MEASURED", integratedLufs: loud.integratedLufs, peakDb: loud.truePeakDb, tool: "lib/audio-loudness.js bs1770-4" }
        : { status: "NOT_MEASURED" },
      analyzedAt: new Date().toISOString(),
    },
  };
}

module.exports = {
  ANALYSIS_VERSION,
  ERRORS,
  analyzeMusicAsset,
  energyCurve,
  sections,
  loopCandidates,
  estimateBpm,
};
