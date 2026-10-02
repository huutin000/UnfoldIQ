"use strict";
// lib/render-time.js — STEP-12 Branch A (Node side).
// CANONICAL ms/frame helper. Mirrored by remotion/src/runtime/time.ts —
// any semantic change here MUST be ported there (and vice versa).
//
// ROUNDING SEMANTICS (end-exclusive frame ranges):
//   - msToFrameStart(ms, fps) uses Math.floor: a moment belongs to the frame
//     that contains it. Frame 0 covers [0, 1000/fps).
//   - msToFrameEnd(ms, fps) uses Math.ceil: the end boundary is exclusive, so
//     a scene ending exactly on a frame boundary ends at that frame, while any
//     fractional overhang claims one more frame (no content is ever clipped).
//   - durationMsToFrames(durationMs, fps) uses Math.ceil for the same reason:
//     the composition must be long enough to contain every millisecond.
//   - frameToMs(frame, fps) is exact: frame * 1000 / fps (may be fractional).
//   - Range rule: a non-zero-duration item whose start/end quantize to equal
//     frames is widened to end = start + 1 (see msRangeToFrames). Zero-duration
//     items stay empty (end === start).
//   - All ms inputs must be finite and >= 0; fps must be finite and > 0,
//     otherwise an INVALID_TIME error is thrown.

var ROUNDING_SEMANTICS = "start=floor,end-exclusive=ceil,duration=ceil,nonzero-equal-widens-by-1";

function assertTime(ms, name) {
  if (typeof ms !== "number" || !isFinite(ms) || ms < 0) {
    throw new Error("INVALID_TIME: " + (name || "ms") + " must be a finite number >= 0 (got " + String(ms) + ")");
  }
}

function assertFps(fps) {
  if (typeof fps !== "number" || !isFinite(fps) || fps <= 0) {
    throw new Error("INVALID_TIME: fps must be a finite number > 0 (got " + String(fps) + ")");
  }
}

function assertFrame(frame, name) {
  if (typeof frame !== "number" || !isFinite(frame) || frame < 0 || Math.floor(frame) !== frame) {
    throw new Error("INVALID_TIME: " + (name || "frame") + " must be a non-negative integer (got " + String(frame) + ")");
  }
}

function msToFrameStart(ms, fps) {
  assertTime(ms, "ms");
  assertFps(fps);
  return Math.floor(ms * fps / 1000);
}

function msToFrameEnd(ms, fps) {
  assertTime(ms, "ms");
  assertFps(fps);
  return Math.ceil(ms * fps / 1000);
}

function durationMsToFrames(durationMs, fps) {
  assertTime(durationMs, "durationMs");
  assertFps(fps);
  return Math.ceil(durationMs * fps / 1000);
}

function frameToMs(frame, fps) {
  assertFrame(frame, "frame");
  assertFps(fps);
  return frame * 1000 / fps;
}

// Range helper enforcing the nonzero-equal-widens-by-1 rule.
function msRangeToFrames(startMs, endMs, fps) {
  assertTime(startMs, "startMs");
  assertTime(endMs, "endMs");
  assertFps(fps);
  if (endMs < startMs) {
    throw new Error("INVALID_TIME: endMs (" + endMs + ") must be >= startMs (" + startMs + ")");
  }
  var startFrame = msToFrameStart(startMs, fps);
  var endFrame = msToFrameEnd(endMs, fps);
  if (endMs > startMs && endFrame <= startFrame) {
    endFrame = startFrame + 1;
  }
  return { startFrame: startFrame, endFrame: endFrame };
}

module.exports = {
  ROUNDING_SEMANTICS: ROUNDING_SEMANTICS,
  msToFrameStart: msToFrameStart,
  msToFrameEnd: msToFrameEnd,
  durationMsToFrames: durationMsToFrames,
  frameToMs: frameToMs,
  msRangeToFrames: msRangeToFrames
};
