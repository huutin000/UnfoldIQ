"use strict";

/**
 * Phase 3B §11–§12 — Versioned Motion Timing Presets + keyframe contract.
 *
 * One place for easing/spring math. Components never invent their own spring
 * parameters. All evaluation is a pure function of (preset, progress) or
 * (preset, frame, range) — normalized keyframes resolve deterministically
 * against timeline frames. No float-time drift: callers pass integer frames.
 */

const TIMING_VERSION = "1.0.0";

const MOTION_TIMING_PRESETS = {
  "linear@1.0.0": {
    timingId: "linear", version: "1.0.0", type: "LINEAR",
    durationPolicy: "FIT_RANGE",
  },
  "ease-in-out@1.0.0": {
    timingId: "ease-in-out", version: "1.0.0", type: "EASING",
    durationPolicy: "FIT_RANGE",
    easing: { family: "cubic-in-out", params: {} },
  },
  "ease-out@1.0.0": {
    timingId: "ease-out", version: "1.0.0", type: "EASING",
    durationPolicy: "FIT_RANGE",
    easing: { family: "cubic-out", params: {} },
  },
  "gentle-spring@1.0.0": {
    timingId: "gentle-spring", version: "1.0.0", type: "SPRING",
    durationPolicy: "FIT_RANGE",
    spring: { damping: 20, stiffness: 120, mass: 1, overshootClamping: true },
  },
};

function getTimingPreset(timingPresetRef) {
  return MOTION_TIMING_PRESETS[timingPresetRef] || null;
}

function listTimingPresets() {
  return Object.keys(MOTION_TIMING_PRESETS);
}

// --- easing (pure, deterministic) ---
function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function applyEasingFamily(family, t) {
  const x = clamp01(t);
  switch (family) {
    case "cubic-in-out":
      return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
    case "cubic-out":
      return 1 - Math.pow(1 - x, 3);
    case "cubic-in":
      return x * x * x;
    default:
      return x;
  }
}

/** Deterministic underdamped-spring step response sampled at progress t. */
function springResponse(t, spring) {
  const x = clamp01(t);
  const damping = spring.damping ?? 20;
  const stiffness = spring.stiffness ?? 120;
  const mass = spring.mass ?? 1;
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  if (zeta >= 1 || spring.overshootClamping) {
    // Critically damped / clamped: smooth approach, no overshoot.
    return 1 - Math.exp(-6 * x) * (1 + 6 * x * Math.min(zeta, 1));
  }
  const w = Math.sqrt(Math.max(stiffness / mass, 1)) * Math.sqrt(1 - zeta * zeta);
  const v = 1 - Math.exp(-zeta * 6 * x) * (Math.cos(w * x) + (zeta * 6 / w) * Math.sin(w * x));
  return clamp01(v);
}

/** Evaluate a preset at normalized progress [0,1] → eased progress [0,1]. */
function evaluateTiming(timingPresetRef, progress) {
  const preset = getTimingPreset(timingPresetRef);
  if (!preset) return { ok: false, code: "UNKNOWN_TIMING_PRESET", message: timingPresetRef };
  const t = clamp01(progress);
  let value = t;
  if (preset.type === "EASING") value = applyEasingFamily(preset.easing.family, t);
  else if (preset.type === "SPRING") value = springResponse(t, preset.spring);
  return { ok: true, value };
}

/**
 * Validate + normalize keyframes. Each keyframe: { at: {frame}|{progress},
 * value, easingRef? }. Frame keyframes must sit inside [startFrame,
 * endFrameExclusive); progress in [0,1]. Returns sorted normalized list with
 * resolved frame + eased interpolation between stops.
 */
function normalizeKeyframes(keyframes, frameRange, timingPresetRef) {
  const errors = [];
  if (!Array.isArray(keyframes) || keyframes.length === 0) {
    return { ok: false, errors: ["INVALID_KEYFRAME: at least one keyframe is required"] };
  }
  const { startFrame, endFrameExclusive } = frameRange || {};
  if (!Number.isInteger(startFrame) || !Number.isInteger(endFrameExclusive) || endFrameExclusive <= startFrame) {
    return { ok: false, errors: ["INVALID_MOTION_RANGE: frameRange must be integer [startFrame, endFrameExclusive)"] };
  }
  const span = endFrameExclusive - startFrame;
  const norm = [];
  for (let i = 0; i < keyframes.length; i++) {
    const k = keyframes[i] || {};
    let frame = null;
    if (k.at && Number.isInteger(k.at.frame)) frame = k.at.frame;
    else if (k.at && typeof k.at.progress === "number") {
      if (!(k.at.progress >= 0 && k.at.progress <= 1)) { errors.push(`INVALID_KEYFRAME: keyframe[${i}].at.progress must be in [0,1]`); continue; }
      frame = startFrame + Math.round(k.at.progress * (span - (span > 1 ? 1 : 0)));
    } else { errors.push(`INVALID_KEYFRAME: keyframe[${i}].at must be {frame} or {progress}`); continue; }
    if (!(frame >= startFrame && frame < endFrameExclusive)) {
      errors.push(`INVALID_KEYFRAME: keyframe[${i}].frame ${frame} outside [${startFrame}, ${endFrameExclusive})`);
      continue;
    }
    if (k.easingRef !== undefined && k.easingRef !== null && !getTimingPreset(k.easingRef)) {
      errors.push(`INVALID_KEYFRAME: keyframe[${i}].easingRef unknown: ${k.easingRef}`);
      continue;
    }
    norm.push({ index: i, frame, value: k.value, easingRef: k.easingRef || timingPresetRef || "linear@1.0.0" });
  }
  if (errors.length) return { ok: false, errors };
  norm.sort((a, b) => a.frame - b.frame || a.index - b.index);
  return { ok: true, keyframes: norm };
}

/** Interpolate a numeric keyframe track at an integer frame. */
function sampleKeyframes(normalized, frame) {
  if (!normalized.length) return null;
  if (frame <= normalized[0].frame) return normalized[0].value;
  const last = normalized[normalized.length - 1];
  if (frame >= last.frame) return last.value;
  for (let i = 0; i < normalized.length - 1; i++) {
    const a = normalized[i];
    const b = normalized[i + 1];
    if (frame >= a.frame && frame <= b.frame) {
      const span = Math.max(b.frame - a.frame, 1);
      const t = (frame - a.frame) / span;
      const e = evaluateTiming(b.easingRef, t);
      const p = e.ok ? e.value : t;
      if (typeof a.value === "number" && typeof b.value === "number") return a.value + (b.value - a.value) * p;
      return p < 0.5 ? a.value : b.value;
    }
  }
  return last.value;
}

/** mulberry32 — deterministic seeded PRNG for HANDHELD/PARTICLES. */
function seededRandom(seed) {
  let h = 0;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) h = (Math.imul(h ^ s.charCodeAt(i), 2654435761) >>> 0);
  let a = h >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

module.exports = {
  TIMING_VERSION,
  MOTION_TIMING_PRESETS,
  getTimingPreset,
  listTimingPresets,
  evaluateTiming,
  normalizeKeyframes,
  sampleKeyframes,
  seededRandom,
};
