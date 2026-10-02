"use strict";
// lib/step11-handoff.js — STEP-11 Branch B
// Pure frame-math helpers for Step 12. No rendering code.
// Step 12 consumes these to convert measured ms timelines to frame ranges.

function msToFrames(ms, fps) {
  if (fps === undefined || fps === null) fps = 30;
  if (typeof ms !== "number" || !isFinite(ms) || ms < 0) throw new Error("msToFrames: ms must be >= 0");
  if (typeof fps !== "number" || !isFinite(fps) || fps <= 0) throw new Error("msToFrames: fps must be > 0");
  return Math.round(ms * fps / 1000);
}

function captionFrameRanges(items, fps) {
  if (fps === undefined || fps === null) fps = 30;
  return (Array.isArray(items) ? items : []).map(function (it) {
    var startFrame = msToFrames(it.startMs, fps);
    var endFrame = msToFrames(it.endMs, fps);
    if (!(endFrame > startFrame)) throw new Error("captionFrameRanges: endFrame must exceed startFrame");
    return {
      id: it.captionId || it.id,
      startFrame: startFrame,
      endFrame: endFrame,
      durationFrames: endFrame - startFrame
    };
  });
}

function audioClipFrameRanges(clips, fps) {
  if (fps === undefined || fps === null) fps = 30;
  return (Array.isArray(clips) ? clips : []).map(function (c) {
    var startFrame = msToFrames(c.startMs, fps);
    var durFrames = msToFrames(c.durationMs, fps);
    var endFrame = typeof c.endMs === "number" ? msToFrames(c.endMs, fps) : (startFrame + durFrames);
    if (!(endFrame > startFrame)) throw new Error("audioClipFrameRanges: endFrame must exceed startFrame");
    return {
      id: c.clipId || c.audioId || c.id,
      startFrame: startFrame,
      endFrame: endFrame,
      durationFrames: endFrame - startFrame
    };
  });
}

function timelineDurationFrames(timelineMeasured, fps) {
  if (fps === undefined || fps === null) fps = 30;
  var t = timelineMeasured || {};
  var endMs = t.actualTimelineEndMs;
  if (typeof endMs !== "number" || !isFinite(endMs) || endMs < 0) {
    throw new Error("timelineDurationFrames: actualTimelineEndMs missing/invalid");
  }
  return msToFrames(endMs, fps);
}

function assertNoBlackTail(timelineMeasured) {
  var t = timelineMeasured || {};
  var tails = t.intentionalTails || t.tails || [];
  if (t.intentionalOutroEndMs !== undefined && /black-tail|pad/i.test(String(t.intentionalOutroKind || "") + " " + String((t.sources || []).join(" ")))) {
    throw new Error("BLACK_TAIL_REJECTED");
  }
  (Array.isArray(tails) ? tails : []).forEach(function (tail) {
    var k = String((tail && tail.kind) || "");
    if (k === "black-tail" || k === "pad-to-target" || k === "pad" || /black/i.test(k)) {
      throw new Error("BLACK_TAIL_REJECTED — tail kind " + k);
    }
  });
  var sources = t.sources || [];
  (Array.isArray(sources) ? sources : []).forEach(function (s) {
    if (typeof s === "string" && (s.indexOf("black-tail") !== -1 || s.indexOf("pad-to-target") !== -1)) {
      throw new Error("BLACK_TAIL_REJECTED — source " + s);
    }
  });
  // actualEndMs must not exceed max(track ends, intentional non-black tails)
  var cands = [];
  ["voiceEndMs", "visualPlannedEndMs", "captionEndMs", "musicEndMs", "sfxEndMs"].forEach(function (k) {
    if (typeof t[k] === "number" && isFinite(t[k])) cands.push(t[k]);
  });
  if (typeof t.intentionalOutroEndMs === "number" && isFinite(t.intentionalOutroEndMs)) {
    // only count non-black outro
    var outroKind = String(t.intentionalOutroKind || t.outroKind || "outro");
    if (outroKind !== "black-tail" && outroKind !== "pad-to-target") cands.push(t.intentionalOutroEndMs);
  }
  (Array.isArray(tails) ? tails : []).forEach(function (tail) {
    var k = String((tail && tail.kind) || "");
    if (k !== "black-tail" && k !== "pad-to-target" && typeof tail.endMs === "number") cands.push(tail.endMs);
  });
  if (cands.length && typeof t.actualTimelineEndMs === "number") {
    var m = Math.max.apply(null, cands);
    if (t.actualTimelineEndMs > m) throw new Error("BLACK_TAIL_REJECTED — actualEndMs exceeds measured ends");
  }
  return true;
}

module.exports = {
  msToFrames: msToFrames,
  captionFrameRanges: captionFrameRanges,
  audioClipFrameRanges: audioClipFrameRanges,
  timelineDurationFrames: timelineDurationFrames,
  assertNoBlackTail: assertNoBlackTail
};
