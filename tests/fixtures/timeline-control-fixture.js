"use strict";

/** Shared Phase 3C fixtures: real Master Timeline + MotionPlan (no mocks). */

const path = require("path");
const REPO = path.join(__dirname, "..", "..");
const tl = require(REPO + "/lib/timeline/index.js");
const motion = require(REPO + "/lib/motion/index.js");

const hash = (s) => s.padEnd(64, "0");
const videoMeta = { mediaType: "video", width: 1920, height: 1080, frameRate: { numerator: 30, denominator: 1 }, frameRateConfidence: "DETECTED", scanType: "CFR", scanTypeConfidence: "DETECTED", pixelAspectRatio: 1, rotation: 0, audioSampleRate: 48000, audioChannels: 2, color: { primaries: "BT.709", transfer: "sRGB", confidence: "DETECTED" } };
const imageMeta = { mediaType: "image", width: 1920, height: 1080, color: { primaries: "BT.709", transfer: "sRGB", confidence: "DECLARED" } };
const chartMeta = { mediaType: "chart", width: 1920, height: 1080, color: { primaries: "BT.709", transfer: "sRGB", confidence: "DECLARED" } };
const audioMeta = { mediaType: "audio", durationMs: 60000, audioSampleRate: 48000, audioChannels: 1 };

function makeRegistry(extra = {}) {
  const assets = {
    "as-nar1": { assetId: "as-nar1", hash: hash("nar1"), type: "audio", durationMs: 60000, conform: audioMeta },
    "as-vid1": { assetId: "as-vid1", hash: hash("vid1"), type: "video", durationMs: 30000, conform: videoMeta },
    "as-vid2": { assetId: "as-vid2", hash: hash("vid2"), type: "video", durationMs: 30000, conform: videoMeta },
    "as-img1": { assetId: "as-img1", hash: hash("img1"), type: "image", conform: imageMeta },
    "as-img2": { assetId: "as-img2", hash: hash("img2"), type: "image", conform: imageMeta },
    "as-cht1": { assetId: "as-cht1", hash: hash("cht1"), type: "chart", conform: chartMeta },
    "as-map1": { assetId: "as-map1", hash: hash("map1"), type: "map", conform: chartMeta },
    "as-dia1": { assetId: "as-dia1", hash: hash("dia1"), type: "diagram", conform: chartMeta },
    ...extra,
  };
  return { assets, resolver: (id) => assets[id] || null };
}

function visualItems4() {
  return [
    { trackType: "VIDEO", assetId: "as-vid1", sourceRange: { startTime: 0, endTime: 15000 }, startTime: 0, endTime: 15000, sceneId: "sc0" },
    { trackType: "IMAGE", assetId: "as-img1", startTime: 15000, endTime: 30000, sceneId: "sc1" },
    { trackType: "CHART", assetId: "as-cht1", startTime: 30000, endTime: 45000, sceneId: "sc2" },
    { trackType: "IMAGE", assetId: "as-img2", startTime: 45000, endTime: 60000, sceneId: "sc3" },
  ];
}

function buildFixture(tb = "web-30@1.0.0", visualItems = null) {
  const reg = makeRegistry();
  const r = tl.buildTimeline({
    projectId: "control-validation",
    finalAudio: { artifactId: "fa-1", durationMs: 60000, narrationTimingHash: "nth-1", finalMixHash: "fmh-1" },
    narrationSegments: [{ segmentId: "s0", assetId: "as-nar1", startTime: 0, endTime: 60000 }],
    visualItems: visualItems || visualItems4(),
    assetResolver: reg.resolver,
    timebasePolicyRef: tb,
  });
  if (!r.ok) throw new Error("fixture timeline failed: " + (r.message || r.code));
  return { manifest: r.manifest, registry: reg };
}

function visualIds(manifest) {
  return manifest.items
    .filter((i) => ["VIDEO", "IMAGE", "CHART", "MAP", "DIAGRAM", "OVERLAY", "TITLE"].includes(i.trackType))
    .map((i) => i.timelineItemId);
}

/** MotionPlan with one ACTIVE motion per visual item (deterministic). */
function buildMotion(manifest, projectId = "control-validation") {
  const intents = {};
  for (const i of manifest.items) {
    if (!["VIDEO", "IMAGE", "CHART"].includes(i.trackType)) continue;
    intents[i.timelineItemId] = i.trackType === "IMAGE"
      ? { purpose: "EMPHASIZE", hasMotionPurpose: true, primitiveRef: "KEN_BURNS", params: { fromScale: 1, toScale: 1.15 } }
      : i.trackType === "CHART"
        ? { purpose: "EXPLAIN_STRUCTURE", hasMotionPurpose: true, primitiveRef: "CHART_REVEAL", params: { seriesOrder: ["A"] } }
        : { purpose: "DIRECT_ATTENTION", hasMotionPurpose: true, primitiveRef: "PAN", params: { fromX: 0, toX: 0.15 } };
  }
  const r = motion.buildMotionPlan({ projectId, timelineManifest: manifest, intentsByItem: intents });
  if (!r.ok) throw new Error("fixture motion failed: " + (r.message || r.code));
  return r.plan;
}

module.exports = { REPO, tl, motion, hash, makeRegistry, buildFixture, visualIds, buildMotion };
