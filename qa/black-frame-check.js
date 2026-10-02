"use strict";
// qa/black-frame-check.js — STEP-13 Branch C.
// Unexpected-black-frame detector via ffmpeg blackdetect (guarded spawnSync).
// blackdetect params: d = minimum duration (seconds), pic_th = picture black
// ratio threshold, pix_th = per-pixel luma threshold. Regions overlapping
// caller-declared intentionalRanges are marked intentional and never fail.
// Long dark content is reported with max-region stats but is NOT auto-passed
// as intentional unless it overlaps an intentional range.

var childProcess = require("child_process");

var DEFAULTS = {
  picThreshold: 0.98,
  pixThreshold: 0.10,
  minDurationMs: 500
};
var FAIL_AT_MS = 2000;
var ANALYZER = "ffmpeg-blackdetect";

function toNum(v, fallback) {
  var n = typeof v === "number" ? v : parseFloat(v);
  return isFinite(n) ? n : fallback;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function checkBlackFrames(args) {
  args = args || {};
  var videoPath = args.videoPath;
  if (!videoPath || typeof videoPath !== "string") throw new Error("checkBlackFrames: videoPath required");
  var picTh = args.threshold !== undefined && args.threshold !== null
    ? toNum(args.threshold, DEFAULTS.picThreshold) : DEFAULTS.picThreshold;
  var pixTh = args.pixThreshold !== undefined && args.pixThreshold !== null
    ? toNum(args.pixThreshold, DEFAULTS.pixThreshold) : DEFAULTS.pixThreshold;
  var minDurMs = args.minDurationMs !== undefined && args.minDurationMs !== null
    ? Math.max(100, Math.round(toNum(args.minDurationMs, DEFAULTS.minDurationMs)))
    : DEFAULTS.minDurationMs;
  var intentionalRanges = Array.isArray(args.intentionalRanges) ? args.intentionalRanges : [];
  void args.fps; // accepted for API symmetry; blackdetect needs no fps.

  var dSec = Math.max(0.1, minDurMs / 1000);
  var filter = "blackdetect=d=" + dSec + ":pic_th=" + picTh + ":pix_th=" + pixTh;
  var r;
  try {
    r = childProcess.spawnSync(
      "ffmpeg",
      ["-hide_banner", "-i", videoPath, "-vf", filter, "-an", "-f", "null", "-"],
      { timeout: 120000, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, windowsHide: true }
    );
  } catch (e) {
    return { status: "UNKNOWN", regions: [], analyzer: ANALYZER, detail: "ANALYZER_UNAVAILABLE: ffmpeg spawn failed" };
  }
  if (r.error) {
    if (r.error.code === "ENOENT") {
      return { status: "UNKNOWN", regions: [], analyzer: ANALYZER, detail: "ANALYZER_UNAVAILABLE: ffmpeg not on PATH" };
    }
    return { status: "UNKNOWN", regions: [], analyzer: ANALYZER, detail: "ANALYZER_UNAVAILABLE: " + String(r.error.message || r.error.code) };
  }
  var stderr = String((r && r.stderr) || "");
  var regions = [];
  var re = /black_start:([\d.]+)\s+black_end:([\d.]+)/g;
  var m;
  while ((m = re.exec(stderr)) !== null) {
    var startMs = Math.round(parseFloat(m[1]) * 1000);
    var endMs = Math.round(parseFloat(m[2]) * 1000);
    if (!isFinite(startMs) || !isFinite(endMs) || endMs <= startMs) continue;
    var intentional = false;
    var label = null;
    for (var i = 0; i < intentionalRanges.length; i++) {
      var ir = intentionalRanges[i] || {};
      var is = Math.round(toNum(ir.startMs, 0));
      var ie = Math.round(toNum(ir.endMs, 0));
      if (overlaps(startMs, endMs, is, ie)) {
        intentional = true;
        label = typeof ir.label === "string" ? ir.label : null;
        break;
      }
    }
    regions.push({ startMs: startMs, endMs: endMs, durationMs: endMs - startMs, intentional: intentional, label: label });
  }

  var unexpected = regions.filter(function (x) { return !x.intentional; });
  var maxRegion = regions.reduce(function (a, b) { return (!a || b.durationMs > a.durationMs) ? b : a; }, null);
  var maxUnexpected = unexpected.reduce(function (a, b) { return (!a || b.durationMs > a.durationMs) ? b : a; }, null);

  if (unexpected.length === 0) {
    return {
      status: "PASS",
      regions: regions,
      analyzer: ANALYZER,
      detail: regions.length === 0
        ? "no black regions detected (minDurationMs=" + minDurMs + ")"
        : "all " + regions.length + " black region(s) overlap declared intentional ranges"
    };
  }
  var worst = maxUnexpected.durationMs;
  var note = "max unexpected black=" + worst + "ms; long dark content is not auto-passed " +
    "as intentional unless inside intentionalRanges";
  if (worst >= FAIL_AT_MS) {
    return { status: "FAIL", regions: regions, analyzer: ANALYZER, detail: note };
  }
  return { status: "REVIEW", regions: regions, analyzer: ANALYZER, detail: note };
}

module.exports = {
  checkBlackFrames: checkBlackFrames,
  DEFAULTS: DEFAULTS
};
