"use strict";
// lib/caption-check.js — STEP-11 Branch B
// Validates caption items against measured audio timeline. No fabrication.

function checkCaptions(opts) {
  opts = opts || {};
  var items = Array.isArray(opts.items) ? opts.items : null;
  var audioEndMs = (typeof opts.audioEndMs === "number" && isFinite(opts.audioEndMs)) ? opts.audioEndMs : null;
  var timingLevel = opts.timingLevel || null;
  var mode = opts.mode || (opts.profile && opts.profile.mode) || "SIDECAR";
  var profile = opts.profile || {};
  var issues = [];

  function block(kind, detail) { issues.push({ kind: kind, detail: detail, blocksReady: true, status: "BLOCKED" }); }
  function warn(kind, detail) { issues.push({ kind: kind, detail: detail, blocksReady: false, status: "REVIEW" }); }

  // Empty items with mode != NONE → BLOCKED NO_CAPTIONS
  if (!Array.isArray(items) || items.length === 0) {
    if (mode !== "NONE") {
      block("NO_CAPTIONS", "No caption items with mode " + mode);
    }
    var emptyStatus = issues.length ? "BLOCKED" : "READY";
    return { status: emptyStatus, issues: issues };
  }

  // transcriptMismatch flag from caller → BLOCKED TRANSCRIPT_MISMATCH
  if (opts.transcriptMismatch === true) {
    block("TRANSCRIPT_MISMATCH", "Caller reports MATERIAL transcript mismatch");
  }

  var seen = {};
  for (var i = 0; i < items.length; i++) {
    var it = items[i] || {};
    var startMs = it.startMs;
    var endMs = it.endMs;
    var text = it.text;

    if (typeof startMs !== "number" || !isFinite(startMs) || startMs < 0) {
      block("NEGATIVE_TIME", "Caption " + i + " startMs invalid: " + startMs);
    }
    if (typeof endMs !== "number" || !isFinite(endMs) || (typeof startMs === "number" && endMs <= startMs)) {
      block("END_BEFORE_START", "Caption " + i + " endMs must be > startMs");
    }
    if (i > 0) {
      var prev = items[i - 1] || {};
      if (typeof startMs === "number" && typeof prev.startMs === "number" && startMs < prev.startMs) {
        block("OUT_OF_ORDER", "Caption " + i + " startMs decreases (out of order)");
      }
      // Overlap
      if (typeof startMs === "number" && typeof prev.endMs === "number" && startMs < prev.endMs) {
        var karaokeAllowed = (mode === "BURNED_IN" &&
          ((it.styleGroup === "karaoke" || (prev.styleGroup === "karaoke")) || (profile.style && profile.style.group === "karaoke")) &&
          timingLevel === "WORD_TIMING");
        if (!karaokeAllowed) {
          block("CAPTION_OVERLAP", "Caption " + (i - 1) + " overlaps caption " + i);
        }
      }
    }
    // Exact duplicate
    var key = String(startMs) + "|" + String(endMs) + "|" + String(text);
    if (seen[key]) {
      block("DUPLICATE_CAPTION", "Caption " + i + " exact duplicate");
    }
    seen[key] = true;

    if (audioEndMs !== null && typeof endMs === "number" && endMs > audioEndMs) {
      block("BEYOND_AUDIO_TIMELINE", "Caption " + i + " endMs " + endMs + " > audioEndMs " + audioEndMs);
    }
    if (typeof text !== "string" || text.trim() === "") {
      block("EMPTY_CAPTION", "Caption " + i + " empty text");
    }
    if (typeof startMs === "number" && typeof endMs === "number") {
      var dur = endMs - startMs;
      if (dur > 8000) warn("EXCESSIVE_DURATION", "Caption " + i + " duration " + dur + "ms > 8000ms");
      if (dur < 400 && dur >= 0) warn("FLASH_CAPTION", "Caption " + i + " duration " + dur + "ms < 400ms");
    }
    // Missing evidence/timingSource
    var ev = it.evidence;
    var hasEvidence = (ev && (ev.source || ev.level)) || it.timingSource;
    if (!hasEvidence && !timingLevel) {
      block("MISSING_TIMING_EVIDENCE", "Caption " + i + " missing evidence/timingSource");
    }
    // Word-level style claim without WORD_TIMING
    var styleClaim = it.styleGroup === "karaoke" || it.styleGroup === "word-emphasis" || profile.wordHighlight;
    if (styleClaim && timingLevel !== "WORD_TIMING") {
      if (profile.strict !== false) {
        block("WORD_TIMING_REQUIRED", "Caption " + i + " word-level style without WORD_TIMING");
      } else {
        warn("WORD_TIMING_REQUIRED", "Caption " + i + " word-level style without WORD_TIMING");
      }
    }
  }

  var hasBlock = issues.some(function (s) { return s.status === "BLOCKED"; });
  var status = hasBlock ? "BLOCKED" : (issues.length ? "REVIEW_REQUIRED" : "READY");
  return { status: status, issues: issues };
}

module.exports = { checkCaptions: checkCaptions };
