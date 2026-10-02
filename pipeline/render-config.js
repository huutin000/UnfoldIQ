"use strict";
// pipeline/render-config.js — STEP-13 Branch A.
// Render configuration defaults, bounded overrides, and retry policy.
// Plain Node.js CommonJS. Deterministic.

var RENDER_RETRY_POLICY = { maxTotalAttempts: 3 };
var AUTO_FIX_POLICY = { maxAutoFixCycles: 2 };

// Error classes that indicate renderer resource pressure and benefit from
// halving concurrency on retry.
var PRESSURE_ERROR_CLASSES = ["TARGET_CLOSED", "CHROME_CRASH", "OUT_OF_MEMORY"];

function defaultConfig() {
  return {
    codec: "h264",
    concurrency: 2,
    pixelFormat: "yuv420p",
    overwrite: false,
    timeoutMs: 600000,
    logLevel: "verbose",
    crf: null,
    x264Preset: null
  };
}

function clampInt(v, lo, hi, fallback) {
  var n = typeof v === "number" ? Math.round(v) : parseInt(v, 10);
  if (isNaN(n)) return fallback;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

function resolveConfig(overrides) {
  var base = defaultConfig();
  overrides = overrides && typeof overrides === "object" ? overrides : {};
  var cfg = Object.assign({}, base, overrides);
  cfg.concurrency = clampInt(cfg.concurrency, 1, 8, base.concurrency);
  var t = Number(cfg.timeoutMs);
  if (isNaN(t)) cfg.timeoutMs = base.timeoutMs;
  else cfg.timeoutMs = Math.min(3600000, Math.max(60000, Math.round(t)));
  if (typeof cfg.codec !== "string" || cfg.codec.length === 0) cfg.codec = base.codec;
  if (typeof cfg.pixelFormat !== "string" || cfg.pixelFormat.length === 0) cfg.pixelFormat = base.pixelFormat;
  cfg.overwrite = cfg.overwrite === true;
  if (typeof cfg.logLevel !== "string" || cfg.logLevel.length === 0) cfg.logLevel = base.logLevel;
  if (cfg.crf !== null && cfg.crf !== undefined) {
    cfg.crf = clampInt(cfg.crf, 0, 51, null);
  } else {
    cfg.crf = null;
  }
  if (typeof cfg.x264Preset !== "string" || cfg.x264Preset.length === 0) cfg.x264Preset = null;
  return cfg;
}

function lowerConcurrencyForRetry(config, errorClass) {
  var base = config && typeof config === "object" ? Object.assign({}, config) : defaultConfig();
  if (PRESSURE_ERROR_CLASSES.indexOf(errorClass) !== -1) {
    var next = Math.max(1, Math.floor(base.concurrency / 2));
    base.concurrency = next;
    return { config: base, note: "concurrency lowered to " + next + " after " + errorClass };
  }
  return { config: base, note: "concurrency unchanged (" + base.concurrency + ") for " + String(errorClass) };
}

module.exports = {
  defaultConfig: defaultConfig,
  resolveConfig: resolveConfig,
  lowerConcurrencyForRetry: lowerConcurrencyForRetry,
  RENDER_RETRY_POLICY: RENDER_RETRY_POLICY,
  AUTO_FIX_POLICY: AUTO_FIX_POLICY,
  PRESSURE_ERROR_CLASSES: PRESSURE_ERROR_CLASSES
};
