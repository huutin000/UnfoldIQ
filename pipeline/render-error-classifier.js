"use strict";
// pipeline/render-error-classifier.js — STEP-13 Branch B (orchestration side).
// classify(err) -> { class, retryable, detail }. Pure message matching,
// case-insensitive. No network, no AI, no provider calls, no secrets in output.

var CLASSES = [
  "CANCELLED",
  "TIMEOUT",
  "TARGET_CLOSED",
  "CHROME_CRASH",
  "OUT_OF_MEMORY",
  "ASSET_MISSING",
  "ASSET_DECODE_ERROR",
  "RENDER_PROP_ERROR",
  "FFMPEG_ERROR",
  "DISK_FULL",
  "PERMISSION_ERROR",
  "UNKNOWN"
];

function rawMessage(err) {
  if (err === null || err === undefined) return "";
  if (typeof err === "string") return err;
  if (err instanceof Error) {
    var parts = [];
    if (err.code !== undefined && err.code !== null) parts.push("code=" + String(err.code));
    if (err.name) parts.push(err.name);
    parts.push(err.message || String(err));
    return parts.join(": ");
  }
  if (typeof err === "object") {
    if (typeof err.message === "string") return err.message;
    if (typeof err.reason === "string") return err.reason;
    try {
      return JSON.stringify(err);
    } catch (e) {
      return String(err);
    }
  }
  return String(err);
}

// Strip secret-like tokens so classifier output is safe to persist/log.
function stripSecrets(text) {
  var s = String(text || "");
  var patterns = [
    /sk-[A-Za-z0-9-_]{8,}/g,
    /sk_(?:live|test)_[A-Za-z0-9-_]{4,}/g,
    /xox[baprs]-[A-Za-z0-9-]{6,}/g,
    /gh[pousr]_[A-Za-z0-9]{8,}/g,
    /AIza[A-Za-z0-9-_]{8,}/g,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    /eyJ[A-Za-z0-9-_]{8,}\.[A-Za-z0-9-_]{8,}\.[A-Za-z0-9-_]{8,}/g,
    /(api[_-]?key|apikey|secret|token|password|passwd|auth|bearer)\s*[:=]\s*['"]?[^\s'"]+['"]?/gi
  ];
  patterns.forEach(function (re) {
    s = s.replace(re, "[REDACTED]");
  });
  return s;
}

function truncate(text, max) {
  var s = String(text || "");
  if (s.length > max) return s.slice(0, max) + "…[truncated]";
  return s;
}

function test(re, msg) {
  return re.test(msg);
}

function classify(err) {
  var msg = rawMessage(err);
  var lower = msg.toLowerCase();
  var cls = "UNKNOWN";
  var retryable = false;

  if (test(/cancel|cancelsignal|sigint|sigterm/, lower)) {
    // Remotion aborts failed asset loads as CancelledError: an explicit
    // asset-failure signature (404 / error loading image / undecodable
    // source / ENOENT media path) is an asset problem, never a user cancel.
    // A missing-asset abort misclassified CANCELLED would be terminal with
    // no fix path, so asset signatures win over the error name here.
    if (test(/404|error loading (image|video|audio)|failed to load resource|could not load (image|video|audio)|cannot be decoded/, lower) ||
        (test(/enoent/, lower) && test(/\.(png|jpg|jpeg|mp4|wav|mp3|webm|mov|gif)/, lower))) {
      // NOT blind-retryable: retrying without restaging repeats the failure.
      cls = "ASSET_MISSING";
      retryable = false;
    } else {
      // CANCELLED is terminal by policy: a user/system cancel is never retried.
      cls = "CANCELLED";
      retryable = false;
    }
  } else if (test(/render_prop_invalid|invalid props|inputprops/, lower)) {
    cls = "RENDER_PROP_ERROR";
    retryable = false;
  } else if (test(/asset_stage_failed|asset.*missing|no such file/, lower) ||
      test(/enoent/, lower) && test(/\.(png|jpg|jpeg|mp4|wav|mp3|webm|mov|gif)/, lower)) {
    // NOT blind-retryable: retrying without restaging/fixing the asset repeats the failure.
    cls = "ASSET_MISSING";
    retryable = false;
  } else if (test(/out of memory|\boom\b|heap|allocation failed|js heap/, lower)) {
    cls = "OUT_OF_MEMORY";
    retryable = true;
  } else if (test(/target closed|target crashed/, lower)) {
    cls = "TARGET_CLOSED";
    retryable = true;
  } else if (test(/chrome.*crash|crash.*chrome|browser.*disconnect|browser.*closed|protocol error.*browser/, lower)) {
    cls = "CHROME_CRASH";
    retryable = true;
  } else if (test(/decode|invalid.*data|corrupt|ebml|moov atom|avc:/, lower)) {
    cls = "ASSET_DECODE_ERROR";
    retryable = false;
  } else if (test(/ffmpeg|ffprobe|exited with code|ebadf.*pipe|broken pipe/, lower)) {
    cls = "FFMPEG_ERROR";
    retryable = false;
  } else if (test(/enospc|disk.*full|no space left/, lower)) {
    cls = "DISK_FULL";
    retryable = false;
  } else if (test(/eacces|eperm|permission denied/, lower)) {
    cls = "PERMISSION_ERROR";
    retryable = false;
  } else if (test(/timeout|timed out|timeoutinmilliseconds/, lower)) {
    cls = "TIMEOUT";
    retryable = true;
  } else {
    cls = "UNKNOWN";
    retryable = false;
  }

  return {
    class: cls,
    retryable: retryable,
    detail: truncate(stripSecrets(msg), 500)
  };
}

module.exports = {
  classify: classify,
  CLASSES: CLASSES,
  stripSecrets: stripSecrets
};
