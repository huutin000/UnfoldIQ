"use strict";

/**
 * Phase 2.8-E — ITU-R BS.1770-4 loudness measurement in pure JS.
 *
 * Implements K-weighting (bilinear-designed shelf + high-pass), 400ms
 * gated block mean-square, absolute/relative gating (integrated loudness),
 * short-term (3s) loudness-range (LRA) and a 4x-interpolated true-peak
 * ESTIMATE. Deterministic, no external audio dependencies. The true-peak
 * value is an interpolation-based estimate, not a certified oversampler.
 */

const DB_OFFSET = -0.691;

function highShelfCoeffs(fs, f0 = 1681.974450955533, gainDb = 3.999843853973347, q = 0.7071752369554196) {
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * f0) / fs;
  const alpha = Math.sin(w0) / (2 * q);
  const cw = Math.cos(w0);
  const twoSqrtAAlpha = 2 * Math.sqrt(A) * alpha;
  // RBJ high-shelf: denominators use MINUS (A-1)cos(w0).
  const a0 = (A + 1) - (A - 1) * cw + twoSqrtAAlpha;
  return {
    b: [
      (A * ((A + 1) + (A - 1) * cw + twoSqrtAAlpha)) / a0,
      (-2 * A * ((A - 1) + (A + 1) * cw)) / a0,
      (A * ((A + 1) + (A - 1) * cw - twoSqrtAAlpha)) / a0,
    ],
    a: [
      1,
      (2 * ((A - 1) - (A + 1) * cw)) / a0,
      ((A + 1) - (A - 1) * cw - twoSqrtAAlpha) / a0,
    ],
  };
}

function highPassCoeffs(fs, f0 = 38.13547087602444, q = 0.5003270373238773) {
  const w0 = (2 * Math.PI * f0) / fs;
  const alpha = Math.sin(w0) / (2 * q);
  const cw = Math.cos(w0);
  const a0 = 1 + alpha;
  return {
    b: [(1 + cw) / 2 / a0, (-(1 + cw)) / a0, (1 + cw) / 2 / a0],
    a: [1, (-2 * cw) / a0, (1 - alpha) / a0],
  };
}

function biquad(x, coeffs) {
  const { b, a } = coeffs;
  const y = new Float64Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i += 1) {
    const xn = x[i];
    const yn = b[0] * xn + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
    x2 = x1; x1 = xn; y2 = y1; y1 = yn;
    y[i] = yn;
  }
  return y;
}

/** K-weight a mono Float64 signal at sample rate fs. */
function kWeight(samples, fs) {
  return biquad(biquad(samples, highShelfCoeffs(fs)), highPassCoeffs(fs));
}

function loudnessFromMeanSquare(ms) {
  if (ms <= 0) return -Infinity;
  return DB_OFFSET + 10 * Math.log10(ms);
}

/** Block mean-squares: 400ms blocks, 100ms step. */
function blockMeanSquares(k, fs) {
  const blockLen = Math.round(0.4 * fs);
  const step = Math.round(0.1 * fs);
  const out = [];
  for (let start = 0; start + blockLen <= k.length; start += step) {
    let sum = 0;
    for (let i = start; i < start + blockLen; i += 1) sum += k[i] * k[i];
    out.push({ start, meanSquare: sum / blockLen });
  }
  return out;
}

/** Gated integrated loudness (BS.1770-4). Returns -Infinity for silence. */
function integratedLoudness(k, fs) {
  const blocks = blockMeanSquares(k, fs);
  if (blocks.length === 0) return -Infinity;
  const abs = blocks.filter((b) => loudnessFromMeanSquare(b.meanSquare) > -70);
  if (abs.length === 0) return -Infinity;
  const absMs = abs.reduce((s, b) => s + b.meanSquare, 0) / abs.length;
  const relThreshold = loudnessFromMeanSquare(absMs) - 10;
  const gated = abs.filter((b) => loudnessFromMeanSquare(b.meanSquare) > relThreshold);
  if (gated.length === 0) return -Infinity;
  const gatedMs = gated.reduce((s, b) => s + b.meanSquare, 0) / gated.length;
  return loudnessFromMeanSquare(gatedMs);
}

/** Short-term (3s, 1s step) loudness series for LRA. */
function shortTermLoudness(k, fs) {
  const blockLen = Math.round(3 * fs);
  const step = Math.round(1 * fs);
  const out = [];
  for (let start = 0; start + blockLen <= k.length; start += step) {
    let sum = 0;
    for (let i = start; i < start + blockLen; i += 1) sum += k[i] * k[i];
    const l = loudnessFromMeanSquare(sum / blockLen);
    if (Number.isFinite(l)) out.push({ startMs: Math.round((start / fs) * 1000), loudness: l });
  }
  return out;
}

function percentile(sorted, p) {
  if (!sorted.length) return NaN;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[idx];
}

/** Loudness Range per EBU Tech 3342 (absolute -70, relative -20 gates). */
function loudnessRange(k, fs) {
  const st = shortTermLoudness(k, fs).map((s) => s.loudness);
  if (st.length === 0) return null;
  const abs = st.filter((l) => l > -70);
  if (abs.length === 0) return null;
  const absMs = abs.map((l) => Math.pow(10, (l - DB_OFFSET) / 10)).reduce((s, v) => s + v, 0) / abs.length;
  const rel = abs.filter((l) => l > loudnessFromMeanSquare(absMs) - 20);
  if (rel.length < 2) return null;
  const sorted = rel.slice().sort((a, b) => a - b);
  return Number((percentile(sorted, 95) - percentile(sorted, 10)).toFixed(2));
}

/** 4x Catmull-Rom interpolated true-peak estimate in dBTP. */
function truePeakDb(samples) {
  let peak = 0;
  for (let i = 0; i < samples.length - 1; i += 1) {
    const p0 = i > 0 ? samples[i - 1] : samples[i];
    const p1 = samples[i];
    const p2 = samples[i + 1];
    const p3 = i + 2 < samples.length ? samples[i + 2] : samples[i + 1];
    for (let f = 1; f <= 4; f += 1) {
      const t = f / 4;
      const t2 = t * t;
      const t3 = t2 * t;
      const v = 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
      const a = Math.abs(v);
      if (a > peak) peak = a;
    }
  }
  return 20 * Math.log10(Math.max(peak, 1e-9));
}

/**
 * Full measurement over Int16Array PCM (any channel count treated as given —
 * pass mono for canonical results). Returns { integratedLufs, loudnessRange,
 * truePeakDb, shortTerm? } — null/−Infinity honest when signal is silent.
 */
function measureLoudness(samples, fs, { withShortTerm = false } = {}) {
  if (!samples || samples.length === 0) {
    return { integratedLufs: -Infinity, loudnessRange: null, truePeakDb: -Infinity };
  }
  const float = new Float64Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) float[i] = samples[i] / 32768;
  const k = kWeight(float, fs);
  const integrated = integratedLoudness(k, fs);
  const out = {
    integratedLufs: Number.isFinite(integrated) ? Number(integrated.toFixed(2)) : -Infinity,
    loudnessRange: loudnessRange(k, fs),
    truePeakDb: Number(truePeakDb(float).toFixed(2)),
  };
  if (withShortTerm) out.shortTerm = shortTermLoudness(k, fs);
  return out;
}

module.exports = {
  DB_OFFSET,
  kWeight,
  integratedLoudness,
  loudnessRange,
  truePeakDb,
  measureLoudness,
  shortTermLoudness,
};
