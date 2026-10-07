"use strict";

/**
 * 1G.7 platform-policy shared helpers (PHASE 1G.7, Prompt 01).
 * Versions, enums, stable identity, and pure 0..1-space geometry math.
 * No rendering, no timestamps, no provider/model names, no credits.
 */

const crypto = require("crypto");
const { stableStringify } = require("../../providers/runtime/request-fingerprint.js");

const PLATFORM_POLICY_VERSION = "1.0.0";
const POLICY_VERSION = "platform-policy-1.0.0";

const PLATFORM_IDS = ["YOUTUBE_LONG", "YOUTUBE_SHORTS", "TIKTOK"];

const ADAPTATION_ACTIONS = [
  "PRESERVE",
  "REFRAME",
  "RELAYOUT",
  "REFRAME_AND_RELAYOUT",
  "RECOMPOSE",
  "REVIEW_REQUIRED",
  "REGENERATE_REQUIRED",
];

const REGENERATION_DECISIONS = ["NOT_REQUIRED", "TARGETED_REGENERATION_REQUIRED", "REVIEW_REQUIRED"];

const ADAPTATION_STATUSES = ["ADAPTED", "REVIEW_REQUIRED", "STALE"];

const SAFE_ZONE_STATUSES = ["VERIFIED", "PARTIAL", "UNKNOWN", "CONFLICT"];

const DENSITY_TIERS = ["LOW", "MEDIUM", "HIGH"];

/** Deterministic relayout-capable modalities (relayout wins over regenerate). */
const RELAYOUT_MODALITIES = [
  "MAP",
  "TIMELINE",
  "CHART",
  "DIAGRAM",
  "TYPOGRAPHY",
  "COMPARISON",
  "ANNOTATION",
  "SPLIT_SCREEN",
  "MOTION_GRAPHIC",
];

function hash16(value) {
  return crypto.createHash("sha256").update(stableStringify(value), "utf8").digest("hex").slice(0, 16);
}

function id12(prefix, value) {
  return `${prefix}-${crypto.createHash("sha256").update(stableStringify(value), "utf8").digest("hex").slice(0, 12)}`;
}

function aspectValue(aspect) {
  const m = /^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/.exec(String(aspect || "").trim());
  if (!m) return null;
  return Number(m[1]) / Number(m[2]);
}

/** Crop window (0..1) of target aspect inside a master of source aspect, anchored at cx (0..1). */
function cropWindow(sourceAspect, targetAspect, cx = 0.5) {
  const s = aspectValue(sourceAspect);
  const t = aspectValue(targetAspect);
  if (!s || !t) return null;
  if (Math.abs(s - t) < 1e-9) return { x: 0, y: 0, w: 1, h: 1 };
  if (t < s) {
    const w = t / s;
    const x = Math.min(Math.max(cx - w / 2, 0), 1 - w);
    return { x, y: 0, w, h: 1 };
  }
  const h = s / t;
  const y = 0; // top-anchored vertical fit; portraits of landscape masters always fit height
  return { x: 0, y, w: 1, h };
}

function rectContains(win, r) {
  return r.x >= win.x - 1e-9 && r.y >= win.y - 1e-9
    && r.x + r.w <= win.x + win.w + 1e-9 && r.y + r.h <= win.y + win.h + 1e-9;
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function clamp01(v) {
  return Math.min(Math.max(Number(v) || 0, 0), 1);
}

module.exports = {
  PLATFORM_POLICY_VERSION,
  POLICY_VERSION,
  PLATFORM_IDS,
  ADAPTATION_ACTIONS,
  REGENERATION_DECISIONS,
  ADAPTATION_STATUSES,
  SAFE_ZONE_STATUSES,
  DENSITY_TIERS,
  RELAYOUT_MODALITIES,
  hash16,
  id12,
  aspectValue,
  cropWindow,
  rectContains,
  rectsOverlap,
  clamp01,
  stableStringify,
};
