"use strict";
// lib/caption-grouping.js — STEP-11 Branch B
// Platform-tuned caption grouping on measured segment boundaries.
// Never splits inside measured boundaries unless segment exceeds maxChars.
// No single fixed global word count.

var PLATFORM_DEFAULTS = {
  youtube: { maxChars: 84, maxLines: 2 },
  tiktok: { maxChars: 42, maxLines: 2 }
};

// Keep number+unit tokens together: e.g. "44.1 kHz", "10px", "50 %"
var NUMBER_UNIT_RE = /[\d.,]+\s?(ms|s|sec|secs|second|seconds|min|mins|minute|minutes|h|hours|kg|g|km|m|cm|mm|%|percent|hz|khz|db|lufs|fps|px|gb|mb)\b/i;

function splitLongText(text, maxChars) {
  // Split at punctuation first, else spaces; keep number+unit together (best-effort).
  var parts = [];
  var remaining = String(text || "").trim();
  while (remaining.length > maxChars) {
    var window = remaining.slice(0, maxChars + 1);
    // Prefer punctuation boundary
    var cut = -1;
    var punctIdx = Math.max(
      window.lastIndexOf(". "), window.lastIndexOf(", "),
      window.lastIndexOf("; "), window.lastIndexOf(": "),
      window.lastIndexOf("? "), window.lastIndexOf("! ")
    );
    if (punctIdx > 0) {
      cut = punctIdx + 1;
    } else {
      cut = window.lastIndexOf(" ");
    }
    if (cut <= 0) cut = maxChars;
    // Guard: don't cut between number and unit
    var candidate = remaining.slice(0, cut);
    var rest = remaining.slice(cut).trim();
    var nextTok = (rest.split(/\s+/)[0] || "");
    var tailTok = (candidate.split(/\s+/).pop() || "");
    if (/^[\d.,]+$/.test(tailTok) && /^(ms|s|sec|secs|second|seconds|min|mins|minute|minutes|h|hours|kg|g|km|m|cm|mm|%|percent|hz|khz|db|lufs|fps|px|gb|mb)$/i.test(nextTok)) {
      // extend cut to include the unit token
      var ext = candidate + " " + nextTok;
      if (ext.length <= maxChars + nextTok.length + 1) {
        candidate = ext;
        rest = rest.slice(nextTok.length).trim();
      }
    }
    // Guard: avoid splitting capitalized bigrams when avoidable (best-effort)
    // If candidate ends with a capitalized word and rest starts with capitalized word,
    // try to move cut back one word if space allows.
    var cwords = candidate.trim().split(/\s+/);
    var lastW = cwords[cwords.length - 1] || "";
    var firstRest = (rest.split(/\s+/)[0] || "");
    if (/^[A-Z][a-z]/.test(lastW) && /^[A-Z][a-z]/.test(firstRest) && cwords.length > 1) {
      var alt = candidate.slice(0, candidate.lastIndexOf(" ", candidate.length - lastW.length - 2)).trim();
      if (alt.length > maxChars * 0.5) {
        rest = remaining.slice(alt.length).trim();
        candidate = alt;
      }
    }
    parts.push(candidate.trim());
    remaining = rest;
  }
  if (remaining) parts.push(remaining);
  return parts;
}

function groupSegments(segments, opts) {
  opts = opts || {};
  var platform = opts.platform === "tiktok" ? "tiktok" : "youtube";
  var defaults = PLATFORM_DEFAULTS[platform] || PLATFORM_DEFAULTS.youtube;
  var maxChars = typeof opts.maxChars === "number" && opts.maxChars > 0 ? opts.maxChars : defaults.maxChars;
  var maxLines = typeof opts.maxLines === "number" && opts.maxLines > 0 ? opts.maxLines : defaults.maxLines;
  void maxLines;
  var out = [];
  (Array.isArray(segments) ? segments : []).forEach(function (seg) {
    if (!seg) return;
    var text = String(seg.text || "").trim();
    if (!text) return;
    var startMs = seg.startMs;
    var endMs = seg.endMs;
    if (text.length <= maxChars) {
      out.push({ startMs: startMs, endMs: endMs, text: text });
      return;
    }
    // Segment exceeds maxChars → split at punctuation first, else spaces
    var chunks = splitLongText(text, maxChars);
    if (chunks.length <= 1) {
      out.push({ startMs: startMs, endMs: endMs, text: text });
      return;
    }
    // Distribute time proportionally by character length across measured boundaries
    var totalChars = chunks.reduce(function (a, c) { return a + c.length; }, 0) || 1;
    var dur = (typeof endMs === "number" && typeof startMs === "number") ? (endMs - startMs) : 0;
    var cursor = startMs;
    chunks.forEach(function (ch, i) {
      var frac = ch.length / totalChars;
      var cDur = Math.round(dur * frac);
      var cStart = cursor;
      var cEnd = (i === chunks.length - 1) ? endMs : (cursor + cDur);
      out.push({ startMs: cStart, endMs: cEnd, text: ch });
      cursor = cEnd;
    });
  });
  return out;
}

module.exports = { groupSegments: groupSegments, PLATFORM_DEFAULTS: PLATFORM_DEFAULTS };
