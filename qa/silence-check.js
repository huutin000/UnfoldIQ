"use strict";
// qa/silence-check.js — STEP-13 Branch C.
// Unexpected-silence detector via ffmpeg silencedetect (guarded spawnSync).
// Silence overlapping voiceRanges (>=1500ms continuous overlap) is
// unexpected: REVIEW below 3000ms, FAIL at/above. Overlap with plannedSilence
// is intentional (PASS note). Silence fully outside voiceRanges (intro/outro
// gaps) is a PASS note and never fails.

var childProcess = require("child_process");

var DEFAULTS = {
  thresholdDb: -35,
  minDurationMs: 500
};
var OVERLAP_FAIL_MS = 3000;
var OVERLAP_MIN_MS = 1500;
var ANALYZER = "ffmpeg-silencedetect";

function toNum(v, fallback) {
  var n = typeof v === "number" ? v : parseFloat(v);
  return isFinite(n) ? n : fallback;
}

function overlapMs(aStart, aEnd, bStart, bEnd) {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

function checkSilence(args) {
  args = args || {};
  var mediaPath = args.audioPath || args.videoPath;
  if (!mediaPath || typeof mediaPath !== "string") throw new Error("checkSilence: audioPath or videoPath required");
  var thresholdDb = args.thresholdDb !== undefined && args.thresholdDb !== null
    ? toNum(args.thresholdDb, DEFAULTS.thresholdDb) : DEFAULTS.thresholdDb;
  var minDurMs = args.minDurationMs !== undefined && args.minDurationMs !== null
    ? Math.max(100, Math.round(toNum(args.minDurationMs, DEFAULTS.minDurationMs)))
    : DEFAULTS.minDurationMs;
  var voiceRanges = Array.isArray(args.voiceRanges) ? args.voiceRanges : [];
  var planned = Array.isArray(args.plannedSilence) ? args.plannedSilence : [];
  var expectedNarration = args.expectedNarration !== false;

  var dSec = Math.max(0.1, minDurMs / 1000);
  var filter = "silencedetect=noise=" + thresholdDb + "dB:d=" + dSec;
  var r;
  try {
    r = childProcess.spawnSync(
      "ffmpeg",
      ["-hide_banner", "-i", mediaPath, "-af", filter, "-vn", "-f", "null", "-"],
      { timeout: 120000, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, windowsHide: true }
    );
  } catch (e) {
    return { status: "UNKNOWN", silentRegions: [], analyzer: ANALYZER, detail: "ANALYZER_UNAVAILABLE: ffmpeg spawn failed" };
  }
  if (r.error) {
    if (r.error.code === "ENOENT") {
      return { status: "UNKNOWN", silentRegions: [], analyzer: ANALYZER, detail: "ANALYZER_UNAVAILABLE: ffmpeg not on PATH" };
    }
    return { status: "UNKNOWN", silentRegions: [], analyzer: ANALYZER, detail: "ANALYZER_UNAVAILABLE: " + String(r.error.message || r.error.code) };
  }
  var stderr = String((r && r.stderr) || "");
  if (/does not contain any stream|No audio|Stream map.*matches no streams/i.test(stderr)) {
    return { status: "UNKNOWN", silentRegions: [], analyzer: ANALYZER, detail: "NO_AUDIO_STREAM: no decodable audio to analyze" };
  }

  var starts = [];
  var ends = [];
  var reS = /silence_start:\s*([\d.-]+)/g;
  var reE = /silence_end:\s*([\d.-]+)/g;
  var m;
  while ((m = reS.exec(stderr)) !== null) starts.push(parseFloat(m[1]));
  while ((m = reE.exec(stderr)) !== null) ends.push(parseFloat(m[1]));
  var regions = [];
  for (var i = 0; i < starts.length; i++) {
    var sMs = Math.round(starts[i] * 1000);
    var eMs = i < ends.length && isFinite(ends[i]) ? Math.round(ends[i] * 1000) : null;
    if (!isFinite(sMs) || sMs < 0) continue;
    if (eMs === null || !isFinite(eMs) || eMs <= sMs) continue; // ignore trailing open-ended silence
    var maxVoiceOverlap = 0;
    for (var v = 0; v < voiceRanges.length; v++) {
      var vr = voiceRanges[v] || {};
      maxVoiceOverlap = Math.max(maxVoiceOverlap, overlapMs(sMs, eMs,
        Math.round(toNum(vr.startMs, 0)), Math.round(toNum(vr.endMs, 0))));
    }
    var plannedHit = null;
    for (var p = 0; p < planned.length; p++) {
      var pr = planned[p] || {};
      if (overlapMs(sMs, eMs, Math.round(toNum(pr.startMs, 0)), Math.round(toNum(pr.endMs, 0))) > 0) {
        plannedHit = typeof pr.label === "string" ? pr.label : "planned";
        break;
      }
    }
    regions.push({
      startMs: sMs,
      endMs: eMs,
      durationMs: eMs - sMs,
      voiceOverlapMs: maxVoiceOverlap,
      intentional: plannedHit !== null,
      label: plannedHit
    });
  }

  var unexpected = regions.filter(function (x) {
    return !x.intentional && x.voiceOverlapMs >= OVERLAP_MIN_MS;
  });
  var outside = regions.filter(function (x) {
    return !x.intentional && x.voiceOverlapMs < OVERLAP_MIN_MS;
  });
  void expectedNarration;

  if (unexpected.length === 0) {
    return {
      status: "PASS",
      silentRegions: regions,
      analyzer: ANALYZER,
      detail: regions.length === 0
        ? "no silence regions detected (minDurationMs=" + minDurMs + ")"
        : (outside.length + " silence region(s) outside voice ranges (intro/outro gaps never fail)" +
          (regions.some(function (x) { return x.intentional; }) ? "; planned-silence overlap accepted" : ""))
    };
  }
  var worst = unexpected.reduce(function (a, b) { return b.durationMs > a.durationMs ? b : a; }, unexpected[0]);
  if (worst.durationMs >= OVERLAP_FAIL_MS) {
    return {
      status: "FAIL",
      silentRegions: regions,
      analyzer: ANALYZER,
      detail: "unexpected narration silence " + worst.durationMs + "ms at " + worst.startMs + "ms overlapping voiceRanges"
    };
  }
  return {
    status: "REVIEW",
    silentRegions: regions,
    analyzer: ANALYZER,
    detail: "unexpected narration silence " + worst.durationMs + "ms (<" + OVERLAP_FAIL_MS + "ms) overlapping voiceRanges"
  };
}

module.exports = {
  checkSilence: checkSilence,
  DEFAULTS: DEFAULTS
};
