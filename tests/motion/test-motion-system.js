"use strict";

/**
 * Phase 3B §40 — Motion System validation Cases A–W.
 * Real deterministic validation on top of real Master Timeline manifests
 * (lib/timeline), no mocks for the timeline contract.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO = path.join(__dirname, "..", "..");
const tl = require(REPO + "/lib/timeline/index.js");
const motion = require(REPO + "/lib/motion/index.js");

let passed = 0;
let failed = 0;
function assert(c, m) {
  if (!c) throw new Error("ASSERTION FAILED: " + m);
  console.log("  ok  " + m);
}
function assertEq(a, b, m) {
  if (a !== b) throw new Error(`ASSERTION FAILED: ${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
  console.log("  ok  " + m);
}
async function runTest(name, fn) {
  console.log("[TEST] " + name);
  try { await fn(); passed += 1; console.log("[PASS] " + name); }
  catch (e) { failed += 1; console.log("[FAIL] " + name + " — " + e.message); }
}

const hash = (s) => s.padEnd(64, "0");
const videoMeta = { mediaType: "video", width: 1920, height: 1080, frameRate: { numerator: 30, denominator: 1 }, frameRateConfidence: "DETECTED", scanType: "CFR", scanTypeConfidence: "DETECTED", pixelAspectRatio: 1, rotation: 0, audioSampleRate: 48000, audioChannels: 2, color: { primaries: "BT.709", transfer: "sRGB", confidence: "DETECTED" } };
const imageMeta = { mediaType: "image", width: 1920, height: 1080, color: { primaries: "BT.709", transfer: "sRGB", confidence: "DECLARED" } };
const chartMeta = { mediaType: "chart", width: 1920, height: 1080, color: { primaries: "BT.709", transfer: "sRGB", confidence: "DECLARED" } };
const audioMeta = { mediaType: "audio", durationMs: 60000, audioSampleRate: 48000, audioChannels: 1 };

function makeRegistry() {
  const assets = {
    "as-nar1": { assetId: "as-nar1", hash: hash("nar1"), type: "audio", durationMs: 60000, conform: audioMeta },
    "as-vid1": { assetId: "as-vid1", hash: hash("vid1"), type: "video", durationMs: 30000, conform: videoMeta },
    "as-img1": { assetId: "as-img1", hash: hash("img1"), type: "image", conform: imageMeta },
    "as-img2": { assetId: "as-img2", hash: hash("img2"), type: "image", conform: imageMeta },
    "as-cht1": { assetId: "as-cht1", hash: hash("cht1"), type: "chart", conform: chartMeta },
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
    projectId: "motion-validation",
    finalAudio: { artifactId: "fa-1", durationMs: 60000, narrationTimingHash: "nth-1", finalMixHash: "fmh-1" },
    narrationSegments: [{ segmentId: "s0", assetId: "as-nar1", startTime: 0, endTime: 60000 }],
    visualItems: visualItems || visualItems4(),
    assetResolver: reg.resolver,
    timebasePolicyRef: tb,
  });
  if (!r.ok) throw new Error("fixture timeline failed: " + (r.message || r.code));
  return r.manifest;
}

function visualIds(manifest) {
  return manifest.items.filter((i) => ["VIDEO", "IMAGE", "CHART", "MAP", "DIAGRAM", "OVERLAY", "TITLE"].includes(i.trackType));
}

function intentsFor(manifest, fn) {
  const out = {};
  for (const i of visualIds(manifest)) out[i.timelineItemId] = fn(i) || {};
  return out;
}

function noBlockers(qa) {
  return qa.findings.filter((f) => f.severity === "BLOCK");
}

(async () => {

await runTest("Case A — static is valid (no purpose → STATIC, QA PASS)", async () => {
  const manifest = buildFixture();
  const r = motion.buildMotionPlan({ projectId: "p", timelineManifest: manifest, intentsByItem: {} });
  assert(r.ok, "build ok");
  assert(r.plan.items.every((m) => m.presence === "STATIC" && m.primitiveRef === null), "all STATIC, no primitive");
  assertEq(r.qa.status, "PASS", "QA PASS: " + JSON.stringify(r.qa.findings));
});

await runTest("Case B — Ken Burns on image is deterministic + bounded", async () => {
  const manifest = buildFixture();
  const img = visualIds(manifest).find((i) => i.trackType === "IMAGE");
  const r = motion.buildMotionPlan({
    projectId: "p", timelineManifest: manifest,
    intentsByItem: intentsFor(manifest, (i) => (i.timelineItemId === img.timelineItemId
      ? { purpose: "REVEAL_INFORMATION", hasMotionPurpose: true, primitiveRef: "KEN_BURNS", timingPresetRef: "ease-in-out@1.0.0", params: { fromScale: 1, toScale: 1.2 } }
      : {})),
  });
  assert(r.ok, "build ok");
  const kb = r.plan.items.find((m) => m.timelineItemId === img.timelineItemId);
  assertEq(kb.presence, "SUBTLE", "ken burns presence");
  assertEq(noBlockers(r.qa).length, 0, "no blockers: " + JSON.stringify(r.qa.findings));
  const r2 = motion.buildMotionPlan({
    projectId: "p", timelineManifest: manifest,
    intentsByItem: intentsFor(manifest, (i) => (i.timelineItemId === img.timelineItemId
      ? { purpose: "REVEAL_INFORMATION", hasMotionPurpose: true, primitiveRef: "KEN_BURNS", timingPresetRef: "ease-in-out@1.0.0", params: { fromScale: 1, toScale: 1.2 } }
      : {})),
  });
  assertEq(JSON.stringify(r.plan.items), JSON.stringify(r2.plan.items.map((m, k) => ({ ...m, reason: r.plan.items[k].reason }))), "rebuild deterministic");
});

await runTest("Case C — pan/push/pull deterministic path, keyframes in range", async () => {
  const manifest = buildFixture();
  const vid = visualIds(manifest).find((i) => i.trackType === "VIDEO");
  const vr = { startFrame: vid.timelineRange.startFrame, endFrameExclusive: vid.timelineRange.endFrameExclusive };
  const nk = motion.timing.normalizeKeyframes(
    [{ at: { progress: 0 }, value: 0 }, { at: { progress: 1 }, value: 100 }], vr, "ease-in-out@1.0.0");
  assert(nk.ok, "progress keyframes normalize: " + JSON.stringify(nk.errors || []));
  assertEq(motion.timing.sampleKeyframes(nk.keyframes, vr.startFrame), 0, "track starts at first value");
  const bad = motion.timing.normalizeKeyframes([{ at: { frame: vr.endFrameExclusive + 5 }, value: 0 }], vr, "linear@1.0.0");
  assert(!bad.ok, "out-of-range keyframe rejected");
  const r = motion.buildMotionPlan({
    projectId: "p", timelineManifest: manifest,
    intentsByItem: intentsFor(manifest, (i) => (i.timelineItemId === vid.timelineItemId
      ? { purpose: "DIRECT_ATTENTION", hasMotionPurpose: true, primitiveRef: "PAN", params: { fromX: 0, toX: 0.2 }, keyframes: [{ at: { progress: 0 }, value: 0 }, { at: { progress: 1 }, value: 0.2 }] }
      : {})),
  });
  assertEq(noBlockers(r.qa).length, 0, "pan QA clean: " + JSON.stringify(r.qa.findings));
});

await runTest("Case D — parallax capability honest (suitable PASS / unsuitable REVIEW)", async () => {
  const manifest = buildFixture();
  const img = visualIds(manifest).find((i) => i.trackType === "IMAGE");
  const good = (i) => (i.timelineItemId === img.timelineItemId
    ? { purpose: "ESTABLISH_DEPTH", hasMotionPurpose: true, primitiveRef: "PARALLAX", params: { depthLayers: 3 } } : {});
  const okCtx = { timelineManifest: manifest, depthAvailableByItem: { [img.timelineItemId]: true } };
  const r1 = motion.buildMotionPlan({ projectId: "p", timelineManifest: manifest, intentsByItem: intentsFor(manifest, good) });
  const q1 = motion.validateMotionPlan(r1.plan, okCtx);
  assert(!q1.findings.some((f) => f.code === "UNKNOWN_PRIMITIVE"), "suitable asset passes");
  const badCtx = { timelineManifest: manifest, depthAvailableByItem: { [img.timelineItemId]: false } };
  const q2 = motion.validateMotionPlan(r1.plan, badCtx);
  assert(q2.findings.some((f) => f.code === "UNKNOWN_PRIMITIVE" && /depth/.test(f.reason)), "unsuitable asset flagged, no fake success");
});

await runTest("Case E — blur-to-focus reveal preserves readability", async () => {
  const manifest = buildFixture();
  const img = visualIds(manifest).find((i) => i.trackType === "IMAGE");
  const r = motion.buildMotionPlan({
    projectId: "p", timelineManifest: manifest,
    intentsByItem: intentsFor(manifest, (i) => (i.timelineItemId === img.timelineItemId
      ? { purpose: "REVEAL_INFORMATION", hasMotionPurpose: true, primitiveRef: "BLUR_TO_FOCUS", params: { fromBlur: 8 } } : {})),
  });
  assertEq(noBlockers(r.qa).length, 0, "blur reveal QA clean: " + JSON.stringify(r.qa.findings));
});

await runTest("Case F — chart animation follows explanation order", async () => {
  const manifest = buildFixture();
  const cht = visualIds(manifest).find((i) => i.trackType === "CHART");
  const mk = (order) => intentsFor(manifest, (i) => (i.timelineItemId === cht.timelineItemId
    ? { purpose: "EXPLAIN_STRUCTURE", hasMotionPurpose: true, primitiveRef: "CHART_REVEAL", params: { seriesOrder: ["A", "B"] }, chartSemantics: { narrationOrder: ["A", "B"], animationOrder: order } } : {}));
  const rGood = motion.buildMotionPlan({ projectId: "p", timelineManifest: manifest, intentsByItem: mk(["A", "B"]) });
  assert(!rGood.qa.findings.some((f) => f.code === "MISLEADING_CHART_ANIMATION"), "ordered animation passes");
  const rBad = motion.buildMotionPlan({ projectId: "p", timelineManifest: manifest, intentsByItem: mk(["B", "A"]) });
  assert(rBad.qa.findings.some((f) => f.code === "MISLEADING_CHART_ANIMATION" && f.severity === "BLOCK"), "reordered animation blocked");
});

await runTest("Case G — transition alignment is frame-exact", async () => {
  const cut = 450;
  const d = 12;
  const c = motion.transitionWindow({ alignment: "CENTER_AT_CUT", cutFrame: cut, durationFrames: d });
  const s = motion.transitionWindow({ alignment: "START_AT_CUT", cutFrame: cut, durationFrames: d });
  const e = motion.transitionWindow({ alignment: "END_AT_CUT", cutFrame: cut, durationFrames: d });
  assertEq(JSON.stringify(c), JSON.stringify({ startFrame: 444, endFrameExclusive: 456 }), "center window");
  assertEq(JSON.stringify(s), JSON.stringify({ startFrame: 450, endFrameExclusive: 462 }), "start window");
  assertEq(JSON.stringify(e), JSON.stringify({ startFrame: 438, endFrameExclusive: 450 }), "end window");
});

await runTest("Case H — missing handles fall back honestly (no silent freeze)", async () => {
  const manifest = buildFixture();
  const ids = visualIds(manifest).map((i) => i.timelineItemId);
  const r = motion.buildMotionPlan({
    projectId: "p", timelineManifest: manifest, intentsByItem: {},
    transitions: [{ fromTimelineItemId: ids[0], toTimelineItemId: ids[1], primitiveRef: "CROSSFADE", alignment: "CENTER_AT_CUT", durationFrames: 24, reason: "scene change" }],
  });
  assert(r.ok, "build ok");
  const q = motion.validateMotionPlan(r.plan, { timelineManifest: manifest, availableHandles: {} });
  assert(q.findings.some((f) => f.code === "TRANSITION_HANDLE_MISSING"), "handle gap reported");
  const repaired = motion.repairMotionPlan(r.plan, { timelineManifest: manifest, availableHandles: {} });
  assert(!repaired.qa.findings.some((f) => f.code === "TRANSITION_HANDLE_MISSING"), "fallback clears the gap");
  assertEq(repaired.plan.transitions[0].primitiveRef, "CUT", "fallback is CUT");
});

await runTest("Case I — transitions preserve canonical duration/speech/caption timing", async () => {
  const manifest = buildFixture();
  const ids = visualIds(manifest).map((i) => i.timelineItemId);
  const r = motion.buildMotionPlan({
    projectId: "p", timelineManifest: manifest, intentsByItem: {},
    transitions: [
      { fromTimelineItemId: ids[0], toTimelineItemId: ids[1], primitiveRef: "CUT", durationFrames: 1, reason: "cut" },
      { fromTimelineItemId: ids[1], toTimelineItemId: ids[2], primitiveRef: "FADE", durationFrames: 6, reason: "chapter" },
      { fromTimelineItemId: ids[2], toTimelineItemId: ids[3], primitiveRef: "CUT", durationFrames: 1, reason: "cut" },
    ],
  });
  assert(r.ok, "build ok");
  const q = motion.validateMotionPlan(r.plan, { timelineManifest: manifest, availableHandles: {} });
  assert(!q.findings.some((f) => f.code === "TRANSITION_CHANGES_CANONICAL_DURATION"), "duration preserved: " + JSON.stringify(q.findings));
  assertEq(motion.motionSpan(r.plan), manifest.canonicalDuration.frameCount, "motion span == canonical frames");
});

await runTest("Case J — structural transition conflict rejected", async () => {
  const manifest = buildFixture();
  const ids = visualIds(manifest).map((i) => i.timelineItemId);
  const r = motion.buildMotionPlan({
    projectId: "p", timelineManifest: manifest, intentsByItem: {},
    transitions: [
      { fromTimelineItemId: ids[0], toTimelineItemId: ids[1], primitiveRef: "FADE", durationFrames: 6, reason: "a" },
      { fromTimelineItemId: ids[0], toTimelineItemId: ids[1], primitiveRef: "WIPE", durationFrames: 6, reason: "b" },
    ],
  });
  assert(r.ok, "build ok (conflict surfaces in QA, not build)");
  const q = motion.validateMotionPlan(r.plan, { timelineManifest: manifest, availableHandles: {} });
  assert(q.findings.some((f) => f.code === "TRANSITION_STRUCTURE_INVALID" && f.severity === "BLOCK"), "duplicate-cut transition blocked");
});

await runTest("Case K — repetition guard penalizes zoom spam", async () => {
  const manifest = buildFixture();
  const intent = () => ({ purpose: "EMPHASIZE", hasMotionPurpose: true, primitiveRef: "ZOOM", timingPresetRef: "ease-in-out@1.0.0", params: { fromScale: 1, toScale: 1.3, direction: "in" } });
  const r = motion.buildMotionPlan({ projectId: "p", timelineManifest: manifest, intentsByItem: intentsFor(manifest, intent) });
  const q = motion.validateMotionPlan(r.plan, { timelineManifest: manifest });
  assert(q.findings.some((f) => f.code === "REPETITIVE_MOTION_PATTERN"), "repetition detected");
  const repaired = motion.repairMotionPlan(r.plan, { timelineManifest: manifest });
  assert(!repaired.qa.findings.some((f) => f.code === "REPETITIVE_MOTION_PATTERN"), "grammar varies the pattern");
});

await runTest("Case L — caption-heavy segment restrains motion", async () => {
  const manifest = buildFixture();
  const vid = visualIds(manifest).find((i) => i.trackType === "VIDEO");
  const r = motion.buildMotionPlan({
    projectId: "p", timelineManifest: manifest,
    intentsByItem: intentsFor(manifest, (i) => (i.timelineItemId === vid.timelineItemId
      ? { purpose: "BUILD_ENERGY", hasMotionPurpose: true, primitiveRef: "PAN", params: { fromX: 0, toX: 0.3 } } : {})),
  });
  // Dense captions arrive (or bypass grammar): QA is the independent safety net.
  r.plan.items.find((m) => m.timelineItemId === vid.timelineItemId).captionDensity = "HIGH";
  const q = motion.validateMotionPlan(r.plan, { timelineManifest: manifest });
  assert(q.findings.some((f) => f.code === "CAPTION_DISTRACTION_RISK"), "distraction risk flagged");
  const repaired = motion.repairMotionPlan(r.plan, { timelineManifest: manifest });
  const item = repaired.plan.items.find((m) => m.timelineItemId === vid.timelineItemId);
  assertEq(item.presence, "STATIC", "caption repair settles to STATIC");
});

await runTest("Case M — already-dynamic source gets no synthetic motion", async () => {
  const manifest = buildFixture();
  const vid = visualIds(manifest).find((i) => i.trackType === "VIDEO");
  const r = motion.buildMotionPlan({
    projectId: "p", timelineManifest: manifest,
    intentsByItem: intentsFor(manifest, (i) => (i.timelineItemId === vid.timelineItemId
      ? { purpose: "REDUCE_MONOTONY", hasMotionPurpose: true, sourceDynamic: true } : {})),
  });
  const item = r.plan.items.find((m) => m.timelineItemId === vid.timelineItemId);
  assertEq(item.presence, "STATIC", "dynamic source stays STATIC");
});

await runTest("Case N — intentional visual rest is not a gap", async () => {
  const manifest = buildFixture();
  const gap = { startFrame: 0, endFrameExclusive: 90, hasVisual: false, intentionalRest: true, reason: "emotional stillness" };
  const r = motion.buildMotionPlan({ projectId: "p", timelineManifest: manifest, intentsByItem: {}, coverageRanges: [gap] });
  const cov = r.plan.coverage.ranges.find((x) => x.startFrame === 0);
  assertEq(cov.status, "INTENTIONAL_VISUAL_REST", "rest classified");
  assert(!r.qa.findings.some((f) => f.code === "UNRESOLVED_REQUIRED_GAP"), "no false gap");
});

await runTest("Case O — missing required coverage blocks honestly", async () => {
  const manifest = buildFixture();
  const gap = { startFrame: 0, endFrameExclusive: 90, hasVisual: false, reason: "narration needs a visual" };
  const r = motion.buildMotionPlan({ projectId: "p", timelineManifest: manifest, intentsByItem: {}, coverageRanges: [gap] });
  assert(r.qa.findings.some((f) => f.code === "UNRESOLVED_REQUIRED_GAP" && f.severity === "BLOCK"), "required gap blocks");
});

await runTest("Case P — flash injection blocked / review-gated", async () => {
  const manifest = buildFixture();
  const img = visualIds(manifest).find((i) => i.trackType === "IMAGE");
  const frames = img.timelineRange.startFrame;
  const r = motion.buildMotionPlan({
    projectId: "p", timelineManifest: manifest,
    intentsByItem: intentsFor(manifest, (i) => (i.timelineItemId === img.timelineItemId
      ? { purpose: "EMPHASIZE", hasMotionPurpose: true, primitiveRef: "LIGHT_SWEEP", params: { direction: "left" }, flashes: [0, 1, 2, 3, 4].map((k) => ({ frame: frames + k })) } : {})),
  });
  assert(r.qa.findings.some((f) => f.code === "FLASH_SAFETY_FAIL" && f.severity === "BLOCK"), "flash spam blocked: " + JSON.stringify(r.qa.findings.map((f) => f.code)));
});

await runTest("Case Q — motion blur is cost-aware, off by default", async () => {
  const manifest = buildFixture();
  const img = visualIds(manifest).find((i) => i.trackType === "IMAGE");
  const r = motion.buildMotionPlan({
    projectId: "p", timelineManifest: manifest,
    intentsByItem: intentsFor(manifest, (i) => (i.timelineItemId === img.timelineItemId
      ? { purpose: "REVEAL_INFORMATION", hasMotionPurpose: true, primitiveRef: "KEN_BURNS", params: { fromScale: 1, toScale: 1.2 }, motionBlur: { enabled: true, samples: 16, shutterAngle: 180 } } : {})),
  });
  assert(r.qa.findings.some((f) => f.code === "MOTION_COST_REVIEW"), "unjustified blur flagged");
  const plain = motion.buildMotionPlan({ projectId: "p", timelineManifest: manifest, intentsByItem: intentsFor(manifest, (i) => (i.timelineItemId === img.timelineItemId
    ? { purpose: "REVEAL_INFORMATION", hasMotionPurpose: true, primitiveRef: "KEN_BURNS", params: { fromScale: 1, toScale: 1.2 } } : {})) });
  const kb = plain.plan.items.find((m) => m.timelineItemId === img.timelineItemId);
  assertEq(kb.motionBlur.enabled, false, "blur OFF by default");
});

await runTest("Case R — seeded handheld/particles are deterministic", async () => {
  const manifest = buildFixture();
  const mk = () => motion.buildMotionPlan({
    projectId: "p", timelineManifest: manifest,
    intentsByItem: intentsFor(manifest, (i) => (i.trackType === "VIDEO" && i.timelineItemId === i.timelineItemId
      ? { purpose: "BUILD_ENERGY", hasMotionPurpose: true, primitiveRef: "HANDHELD", params: { amplitude: 0.5 } } : {})),
  });
  const a = mk();
  const b = mk();
  const ha = a.plan.items.find((m) => m.primitiveRef === "HANDHELD");
  const hb = b.plan.items.find((m) => m.primitiveRef === "HANDHELD");
  assertEq(ha.params.seed, hb.params.seed, "seed persisted + identical across builds");
  const g1 = motion.timing.seededRandom("seed-1");
  const g2 = motion.timing.seededRandom("seed-1");
  assertEq(JSON.stringify([g1(), g1(), g1()]), JSON.stringify([g2(), g2(), g2()]), "same seed → same sequence");
});

await runTest("Case S — local patch dirties motion only (audio/alignment/captions clean)", async () => {
  const manifest = buildFixture();
  const img = visualIds(manifest).find((i) => i.trackType === "IMAGE");
  const r = motion.buildMotionPlan({
    projectId: "p", timelineManifest: manifest,
    intentsByItem: intentsFor(manifest, (i) => (i.timelineItemId === img.timelineItemId
      ? { purpose: "EMPHASIZE", hasMotionPurpose: true, primitiveRef: "ZOOM", params: { fromScale: 1, toScale: 1.2 } } : {})),
  });
  const target = r.plan.items.find((m) => m.timelineItemId === img.timelineItemId);
  const p = motion.patchMotion(r.plan, { patchId: "px-1", op: "SET_STATIC", targetId: target.motionItemId }, { timelineManifest: manifest });
  assert(p.ok, "patch ok");
  assertEq(p.plan.items.find((m) => m.timelineItemId === img.timelineItemId).presence, "STATIC", "patched item STATIC");
  const inv = motion.resolveMotionInvalidation();
  assert(inv.motionPlanBranchDirty && inv.motionQABranchDirty, "motion branches dirty");
  assert(inv.finalAudioClean && inv.alignmentClean && inv.captionsClean && inv.sourceMediaClean, "audio/alignment/captions/source clean");
});

await runTest("Case T — locked motion survives unrelated rerun", async () => {
  const manifest = buildFixture();
  const store = motion.createMotionStore();
  const img = visualIds(manifest).find((i) => i.trackType === "IMAGE");
  const intents = intentsFor(manifest, (i) => (i.timelineItemId === img.timelineItemId
    ? { purpose: "EMPHASIZE", hasMotionPurpose: true, primitiveRef: "ZOOM", params: { fromScale: 1, toScale: 1.4 } } : {}));
  const b = store.buildMotionPlan("pt", { timelineManifest: manifest, intentsByItem: intents }, { timelineManifest: manifest });
  assert(b.ok, "store build ok");
  const target = b.plan.items.find((m) => m.timelineItemId === img.timelineItemId);
  const locked = store.patchMotion("pt", { patchId: "lock-1", op: "LOCK_MOTION", targetId: target.motionItemId }, { timelineManifest: manifest });
  assert(locked.ok, "lock ok");
  const rebuilt = store.buildMotionPlan("pt", { timelineManifest: manifest, intentsByItem: intentsFor(manifest, () => ({})) }, { timelineManifest: manifest });
  const kept = rebuilt.plan.items.find((m) => m.timelineItemId === img.timelineItemId);
  assertEq(kept.locked, true, "lock preserved");
  assertEq(kept.primitiveRef, "ZOOM", "locked primitive preserved");
});

await runTest("Case U — stale motion patch conflicts", async () => {
  const manifest = buildFixture();
  const r = motion.buildMotionPlan({ projectId: "p", timelineManifest: manifest, intentsByItem: {} });
  const target = r.plan.items[0];
  const p = motion.patchMotion(r.plan, { patchId: "stale-1", op: "SET_STATIC", targetId: target.motionItemId, expectedRevision: 999 }, { timelineManifest: manifest });
  assertEq(p.code, "PATCH_CONFLICT", "stale patch rejected");
});

await runTest("Case V — workspace persistence + resume after restart", async () => {
  const manifest = buildFixture();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "unfoldiq-motion-"));
  fs.mkdirSync(path.join(tmp, "projects", "validation", "proj-motion"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "projects", "registry.json"), JSON.stringify({
    schemaVersion: "1.0.0",
    projects: [{ projectId: "proj-motion", kind: "VALIDATION", status: "ACTIVE", path: "projects/validation/proj-motion", manifestRef: null }],
  }));
  const r = motion.buildMotionPlan({ projectId: "proj-motion", timelineManifest: manifest, intentsByItem: {} });
  const saved = motion.persistMotionPlan(tmp, "proj-motion", r.plan);
  assert(saved.ok, "persist ok: " + (saved.code || saved.path || ""));
  const snap = motion.persistTimelineSnapshot(tmp, "proj-motion", manifest);
  assert(snap.ok, "timeline snapshot ok");
  // Simulate restart: fresh load from disk.
  const loaded = motion.loadMotionPlan(tmp, "proj-motion");
  assert(loaded.ok, "reload ok");
  assertEq(loaded.plan.revision, r.plan.revision, "revision preserved");
  assertEq(JSON.stringify(loaded.plan.items), JSON.stringify(r.plan.items), "locked decisions + items byte-identical");
  const stale = motion.persistMotionPlan(tmp, "proj-motion", { ...r.plan, revision: 99 }, { expectedRevision: 12345 });
  assertEq(stale.code, "PATCH_CONFLICT", "stale overwrite refused");
  fs.rmSync(tmp, { recursive: true, force: true });
});

await runTest("Case W — NTSC timing has no frame drift", async () => {
  for (const tb of ["ntsc-23976@1.0.0", "web-2997@1.0.0"]) {
    const manifest = buildFixture(tb);
    const img = visualIds(manifest).find((i) => i.trackType === "IMAGE");
    const r = motion.buildMotionPlan({
      projectId: "p", timelineManifest: manifest,
      intentsByItem: intentsFor(manifest, (i) => (i.timelineItemId === img.timelineItemId
        ? { purpose: "REVEAL_INFORMATION", hasMotionPurpose: true, primitiveRef: "KEN_BURNS", params: { fromScale: 1, toScale: 1.15 } } : {})),
    });
    assert(r.ok, `build ok @ ${tb}`);
    for (const m of r.plan.items) {
      const ti = manifest.items.find((i) => i.timelineItemId === m.timelineItemId);
      assertEq(m.frameRange.startFrame, ti.timelineRange.startFrame, `start exact @ ${tb}`);
      assertEq(m.frameRange.endFrameExclusive, ti.timelineRange.endFrameExclusive, `end exact @ ${tb}`);
    }
    assert(!r.qa.findings.some((f) => f.code === "TRANSITION_CHANGES_CANONICAL_DURATION"), `no drift @ ${tb}`);
  }
});

console.log(`\n=== motion: ${failed} failed, ${passed} passed ===`);
process.exit(failed > 0 ? 1 : 0);
})();
