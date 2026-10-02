"use strict";
// qa/frame-sampler.js — STEP-13 Branch C.
// Deterministic frame extraction (ffmpeg, guarded) + timestamp planning.
// sampleFrames never throws per-frame: failures are recorded in {failures}.
// Hard bound: more than MAX_SAMPLES (40) timestamps throws TOO_MANY_SAMPLES.
// planTimestamps covers first(0) + last + scene midpoints + transition
// boundaries + caption midpoints (up to 6) + caller issue timestamps,
// deduped, sorted, stride-capped to maxSamples (default 24).

var childProcess = require("child_process");
var fs = require("fs");
var path = require("path");

var MAX_SAMPLES = 40;
var DEFAULT_PLAN_SAMPLES = 24;
var MAX_CAPTION_MOMENTS = 6;
var METHOD = "ffmpeg-seek";

function toMs(v, fallback) {
  var n = typeof v === "number" ? v : parseFloat(v);
  return isFinite(n) && n >= 0 ? Math.round(n) : fallback;
}

function sampleFrames(args) {
  args = args || {};
  var videoPath = args.videoPath;
  var timestampsMs = args.timestampsMs;
  var outDir = args.outDir;
  var prefix = typeof args.prefix === "string" && args.prefix.length > 0 ? args.prefix : "frame";
  if (!videoPath || typeof videoPath !== "string") throw new Error("sampleFrames: videoPath required");
  if (!Array.isArray(timestampsMs)) throw new Error("sampleFrames: timestampsMs[] required");
  if (!outDir || typeof outDir !== "string") throw new Error("sampleFrames: outDir required");
  if (timestampsMs.length > MAX_SAMPLES) {
    var err = new Error("TOO_MANY_SAMPLES: " + timestampsMs.length + " > " + MAX_SAMPLES);
    err.code = "TOO_MANY_SAMPLES";
    throw err;
  }
  fs.mkdirSync(outDir, { recursive: true });
  var samples = [];
  var failures = [];
  timestampsMs.forEach(function (raw) {
    var ts = toMs(raw, null);
    if (ts === null) {
      failures.push({ timestampMs: raw, error: "INVALID_TIMESTAMP" });
      return;
    }
    var secs = (ts / 1000).toFixed(3);
    var framePath = path.join(outDir, prefix + "-" + ts + "ms.png");
    var r;
    try {
      r = childProcess.spawnSync(
        "ffmpeg",
        ["-hide_banner", "-y", "-ss", String(secs), "-i", videoPath, "-frames:v", "1", framePath],
        { timeout: 60000, encoding: "utf8", maxBuffer: 8 * 1024 * 1024, windowsHide: true }
      );
    } catch (e) {
      failures.push({ timestampMs: ts, error: "SPAWN_FAILED: " + String((e && e.message) || e) });
      return;
    }
    if (r.error) {
      failures.push({ timestampMs: ts, error: "SPAWN_FAILED: " + String(r.error.message || r.error.code) });
      return;
    }
    var ok = r.status === 0;
    try {
      ok = ok && fs.statSync(framePath).isFile() && fs.statSync(framePath).size > 0;
    } catch (e) {
      ok = false;
    }
    if (!ok) {
      failures.push({ timestampMs: ts, error: "EXTRACT_FAILED status=" + r.status });
      return;
    }
    samples.push({ timestampMs: ts, framePath: framePath, method: METHOD });
  });
  samples.sort(function (a, b) { return a.timestampMs - b.timestampMs; });
  return { samples: samples, failures: failures };
}

function planTimestamps(args) {
  args = args || {};
  var durationMs = toMs(args.durationMs, null);
  if (durationMs === null) throw new Error("planTimestamps: durationMs required");
  var maxSamples = args.maxSamples !== undefined && args.maxSamples !== null
    ? Math.max(2, Math.min(MAX_SAMPLES, Math.floor(Number(args.maxSamples)) || DEFAULT_PLAN_SAMPLES))
    : DEFAULT_PLAN_SAMPLES;
  var out = [];
  function add(v) {
    var n = toMs(v, null);
    if (n === null) return;
    if (n < 0) n = 0;
    if (n > durationMs) n = durationMs;
    out.push(n);
  }
  add(0);
  // Last analyzed frame is inset 100ms so the seek stays in decodable range.
  add(Math.max(0, durationMs - 100));
  (Array.isArray(args.scenes) ? args.scenes : []).forEach(function (s) {
    s = s || {};
    if (s.startMs !== undefined && s.endMs !== undefined) {
      add((toMs(s.startMs, 0) + toMs(s.endMs, 0)) / 2);
    }
  });
  (Array.isArray(args.transitions) ? args.transitions : []).forEach(function (t) {
    t = t || {};
    if (t.atMs !== undefined) add(t.atMs);
  });
  (Array.isArray(args.captions) ? args.captions : []).slice(0, MAX_CAPTION_MOMENTS).forEach(function (c) {
    c = c || {};
    if (c.startMs !== undefined && c.endMs !== undefined) {
      add((toMs(c.startMs, 0) + toMs(c.endMs, 0)) / 2);
    }
  });
  (Array.isArray(args.issueTimestamps) ? args.issueTimestamps : []).forEach(add);

  out.sort(function (a, b) { return a - b; });
  var deduped = [];
  out.forEach(function (n) {
    if (deduped.length === 0 || deduped[deduped.length - 1] !== n) deduped.push(n);
  });
  if (deduped.length <= maxSamples) return deduped;
  // Long video: stride to fit, always keeping first and last.
  var picked = [];
  var step = (deduped.length - 1) / (maxSamples - 1);
  for (var i = 0; i < maxSamples; i++) {
    picked.push(deduped[Math.round(i * step)]);
  }
  picked.sort(function (a, b) { return a - b; });
  var final = [];
  picked.forEach(function (n) {
    if (final.length === 0 || final[final.length - 1] !== n) final.push(n);
  });
  return final;
}

module.exports = {
  sampleFrames: sampleFrames,
  planTimestamps: planTimestamps,
  MAX_SAMPLES: MAX_SAMPLES,
  DEFAULT_PLAN_SAMPLES: DEFAULT_PLAN_SAMPLES
};
