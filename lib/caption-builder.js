"use strict";
// lib/caption-builder.js — STEP-11 Branch B
// Builds canonical captions JSON + SRT/VTT from MEASURED timing only.
// No @remotion/captions dependency: package not installed; native grouping
// keeps zero-dep and avoids installs/network. Never fabricates word timing.

function pad2(n) { return (n < 10 ? "0" : "") + n; }
function pad3(n) { return (n < 10 ? "00" : n < 100 ? "0" : "") + n; }

function fmtSrtTime(ms) {
  ms = Math.max(0, Math.round(ms));
  var h = Math.floor(ms / 3600000); ms -= h * 3600000;
  var m = Math.floor(ms / 60000); ms -= m * 60000;
  var s = Math.floor(ms / 1000); ms -= s * 1000;
  return pad2(h) + ":" + pad2(m) + ":" + pad2(s) + "," + pad3(ms);
}

function fmtVttTime(ms) {
  ms = Math.max(0, Math.round(ms));
  var h = Math.floor(ms / 3600000); ms -= h * 3600000;
  var m = Math.floor(ms / 60000); ms -= m * 60000;
  var s = Math.floor(ms / 1000); ms -= s * 1000;
  return pad2(h) + ":" + pad2(m) + ":" + pad2(s) + "." + pad3(ms);
}

function parseSrtTime(s) {
  var m = String(s || "").trim().match(/(\d+):(\d+):(\d+)[,.](\d+)/);
  if (!m) throw new Error("Invalid SRT/VTT time: " + s);
  return ((+m[1]) * 3600 + (+m[2]) * 60 + (+m[3])) * 1000 + (+String(m[4]).slice(0, 3).padEnd(3, "0"));
}

function msToFrames(ms, fps) {
  if (fps === undefined || fps === null) fps = 30;
  if (typeof ms !== "number" || ms < 0 || !isFinite(ms)) throw new Error("msToFrames: ms must be >= 0");
  if (typeof fps !== "number" || !(fps > 0) || !isFinite(fps)) throw new Error("msToFrames: fps must be > 0");
  return Math.round(ms * fps / 1000);
}

function toSrt(items) {
  var lines = [];
  (Array.isArray(items) ? items : []).forEach(function (it, i) {
    lines.push(String(i + 1));
    lines.push(fmtSrtTime(it.startMs) + " --> " + fmtSrtTime(it.endMs));
    lines.push(String(it.text || ""));
    lines.push("");
  });
  return lines.join("\n");
}

function toVtt(items) {
  var lines = ["WEBVTT", ""];
  (Array.isArray(items) ? items : []).forEach(function (it) {
    lines.push(fmtVttTime(it.startMs) + " --> " + fmtVttTime(it.endMs));
    lines.push(String(it.text || ""));
    lines.push("");
  });
  return lines.join("\n");
}

function buildCaptions(opts) {
  opts = opts || {};
  var timing = opts.timing || {};
  var language = opts.language || "en";
  var timingSource = opts.timingSource || timing.timingSource || "measured";
  var sceneId = opts.sceneId;
  var captionIdPrefix = opts.captionIdPrefix || "cap";
  var profile = opts.profile || { mode: "SIDECAR" };
  var projectId = opts.projectId || "(set by caller via opts.projectId)";

  var mode = profile.mode || "SIDECAR";
  if (mode === "NONE") {
    return { captionsJson: null, srt: null, vtt: null, status: "SKIPPED_MODE_NONE" };
  }

  var level = timing.level || "SEGMENT_TIMING";
  var segments = Array.isArray(timing.segments) ? timing.segments : [];
  var styleGroup = profile.style && profile.style.group ? profile.style.group : null;
  var needsWordTiming = (styleGroup === "karaoke" || styleGroup === "word-emphasis");

  if (needsWordTiming) {
    var allHaveWords = segments.length > 0 && segments.every(function (s) {
      return s && Array.isArray(s.words) && s.words.length > 0;
    });
    if (level !== "WORD_TIMING" || !allHaveWords) {
      return {
        captionsJson: null, srt: null, vtt: null,
        status: "REVIEW_REQUIRED",
        issues: [{ kind: "WORD_TIMING_REQUIRED", detail: "Word-highlight style requires WORD_TIMING with words[] on every segment — no fake karaoke", blocksReady: false }]
      };
    }
  }

  // Group via caption-grouping (lazy require with fallback: one caption per segment)
  var grouped;
  try {
    var cg = require("./caption-grouping");
    grouped = cg.groupSegments(segments, {
      maxChars: profile.grouping && profile.grouping.maxChars,
      maxLines: profile.grouping && profile.grouping.maxLines,
      platform: profile.grouping && profile.grouping.platform,
      style: styleGroup
    });
    // Preserve words when WORD_TIMING and no split occurred (1:1 mapping)
    if (level === "WORD_TIMING" && grouped.length === segments.length) {
      grouped = grouped.map(function (g, i) {
        var seg = segments[i];
        var ng = { startMs: g.startMs, endMs: g.endMs, text: g.text };
        if (seg && Array.isArray(seg.words)) ng.words = seg.words;
        return ng;
      });
    }
  } catch (e) {
    grouped = segments.map(function (s) {
      var g = { startMs: s.startMs, endMs: s.endMs, text: String(s.text || "") };
      if (Array.isArray(s.words)) g.words = s.words;
      return g;
    });
  }

  var items = grouped.map(function (g, i) {
    var item = {
      captionId: captionIdPrefix + "-" + (i + 1),
      startMs: g.startMs,
      endMs: g.endMs,
      text: g.text,
      evidence: { source: timingSource, level: level }
    };
    if (sceneId !== undefined && sceneId !== null) item.sceneId = sceneId;
    if (level === "WORD_TIMING" && Array.isArray(g.words)) item.words = g.words;
    if (styleGroup) item.styleGroup = styleGroup;
    return item;
  });

  var captionsJson = {
    version: "1.0.0",
    projectId: projectId,
    language: language,
    timingSource: timingSource,
    mode: mode,
    timingLevel: level,
    items: items
  };

  var srt = toSrt(items);
  var vtt = profile.vtt ? toVtt(items) : null;

  return { captionsJson: captionsJson, srt: srt, vtt: vtt, status: "READY" };
}

module.exports = {
  buildCaptions: buildCaptions,
  toSrt: toSrt,
  toVtt: toVtt,
  parseSrtTime: parseSrtTime,
  fmtSrtTime: fmtSrtTime,
  fmtVttTime: fmtVttTime,
  msToFrames: msToFrames
};
