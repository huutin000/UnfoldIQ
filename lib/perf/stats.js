"use strict";
// lib/perf/stats.js — Phase 5A benchmark summaries (no new dependencies).
// Raw samples are always persisted; summaries never replace them.
// p95 reported when n>=5; p99 only when n>=100 (else null, never invented).

function sorted(s) {
  return s.slice().sort((a, b) => a - b);
}

function percentile(srt, p) {
  if (srt.length === 0) return null;
  const i = Math.min(srt.length - 1, Math.ceil((p / 100) * srt.length) - 1);
  return srt[Math.max(0, i)];
}

function summarize(samples) {
  const vals = (Array.isArray(samples) ? samples : []).filter((v) => typeof v === "number" && isFinite(v));
  if (vals.length === 0) return { count: 0 };
  const srt = sorted(vals);
  const n = srt.length;
  const mean = vals.reduce((a, b) => a + b, 0) / n;
  const variance = vals.reduce((a, b) => a + (b - mean) * (b - mean), 0) / n;
  return {
    count: n,
    min: srt[0],
    max: srt[n - 1],
    mean: round(mean),
    median: round(percentile(srt, 50)),
    p50: round(percentile(srt, 50)),
    p75: n >= 4 ? round(percentile(srt, 75)) : null,
    p95: n >= 5 ? round(percentile(srt, 95)) : null,
    p99: n >= 100 ? round(percentile(srt, 99)) : null,
    stddev: n >= 2 ? round(Math.sqrt(variance)) : 0,
  };
}

function round(v) {
  return Math.round(v * 1000) / 1000;
}

module.exports = { summarize };
