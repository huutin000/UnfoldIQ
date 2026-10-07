"use strict";

/**
 * Phase 3A-15 — Master Timeline validation cases (spec §24, Cases A–P)
 * on a ~2.5-minute canonical timeline built from Phase 2-style artifacts.
 */

const crypto = require("crypto");
const path = require("path");
const REPO = path.join(__dirname, "..", "..");
const tl = require(REPO + "/lib/timeline/index.js");

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

const TB = "web-30@1.0.0";
const hash = (s) => s.padEnd(64, "0");
const videoMeta = { mediaType: "video", width: 1920, height: 1080, frameRate: { numerator: 30, denominator: 1 }, frameRateConfidence: "DETECTED", scanType: "CFR", scanTypeConfidence: "DETECTED", pixelAspectRatio: 1, rotation: 0, audioSampleRate: 48000, audioChannels: 2, color: { primaries: "BT.709", transfer: "sRGB", confidence: "DETECTED" } };
const imageMeta = { mediaType: "image", width: 1920, height: 1080, color: { primaries: "BT.709", transfer: "sRGB", confidence: "DECLARED" } };
const audioMeta = { mediaType: "audio", audioSampleRate: 48000, audioChannels: 1 };

/** Canonical asset registry for the validation production. */
function makeRegistry(extra = {}) {
  const assets = {
    "as-nar0001": { assetId: "as-nar0001", hash: hash("nar"), type: "audio", durationMs: 150000, conform: audioMeta },
    "as-vid0001": { assetId: "as-vid0001", hash: hash("vid1"), type: "video", durationMs: 90000, conform: videoMeta },
    "as-vid0002": { assetId: "as-vid0002", hash: hash("vid2"), type: "video", durationMs: 90000, conform: videoMeta },
    "as-img0001": { assetId: "as-img0001", hash: hash("img1"), type: "image", conform: imageMeta },
    "as-img0002": { assetId: "as-img0002", hash: hash("img2"), type: "image", conform: imageMeta },
    "as-cht0001": { assetId: "as-cht0001", hash: hash("cht"), type: "chart", conform: { mediaType: "chart", width: 1920, height: 1080, color: { primaries: "BT.709", transfer: "sRGB", confidence: "DECLARED" } } },
    "as-mus0001": { assetId: "as-mus0001", hash: hash("mus"), type: "audio", durationMs: 200000, conform: audioMeta },
    "as-sfx0001": { assetId: "as-sfx0001", hash: hash("sfx"), type: "audio", durationMs: 1500, conform: audioMeta },
    ...extra,
  };
  return { assets, resolver: (id) => assets[id] || null };
}

/** Canonical Phase 2 artifacts (final audio 150s + alignment + captions). */
function canonicalInputs(registry, over = {}) {
  return {
    projectId: "phase3a-validation",
    finalAudio: { artifactId: "final-audio-abc123", durationMs: 150000, narrationTimingHash: "nth-canonical0000", finalMixHash: "fmh-canonical000", ...(over.finalAudio || {}) },
    alignment: { artifactId: "al-align000001", transcriptHash: "tr-hash000000000", narrationTimingHash: "nth-canonical0000", ...(over.alignment || {}) },
    captions: { artifactId: "cap-artifact00001" },
    narrationSegments: [
      { segmentId: "s0", assetId: "as-nar0001", startTime: 0, endTime: 30000 },
      { segmentId: "s1", assetId: "as-nar0001", startTime: 30000, endTime: 60000 },
      { segmentId: "s2", assetId: "as-nar0001", startTime: 60000, endTime: 90000 },
      { segmentId: "s3", assetId: "as-nar0001", startTime: 90000, endTime: 120000 },
      { segmentId: "s4", assetId: "as-nar0001", startTime: 120000, endTime: 150000 },
    ],
    visualItems: [
      { trackType: "VIDEO", assetId: "as-vid0001", sourceRange: { startTime: 0, endTime: 40000 }, startTime: 0, endTime: 40000, sceneId: "sc0" },
      { trackType: "IMAGE", assetId: "as-img0001", startTime: 40000, endTime: 70000, sceneId: "sc1", zIndex: 0 },
      { trackType: "CHART", assetId: "as-cht0001", startTime: 70000, endTime: 90000, sceneId: "sc2" },
      { trackType: "VIDEO", assetId: "as-vid0002", sourceRange: { startTime: 10000, endTime: 50000 }, startTime: 90000, endTime: 130000, sceneId: "sc3" },
      { trackType: "IMAGE", assetId: "as-img0002", startTime: 130000, endTime: 150000, sceneId: "sc4" },
      { trackType: "MUSIC", assetId: "as-mus0001", sourceRange: { startTime: 0, endTime: 150000 }, startTime: 0, endTime: 150000 },
      { trackType: "SFX", assetId: "as-sfx0001", startTime: 70500, endTime: 71700 },
    ],
    assetResolver: registry.resolver,
    timebasePolicyRef: TB,
  };
}

(async () => {
await runTest("Case A — 2.5-minute canonical timeline builds with all required tracks", async () => {
  const reg = makeRegistry();
  const r = tl.buildTimeline(canonicalInputs(reg));
  assert(r.ok, "build ok: " + (r.message || ""));
  assertEq(r.manifest.qaStatus, "PASS", "QA PASS: " + JSON.stringify(r.manifest.qa.findings.map((f) => f.code)));
  assertEq(JSON.stringify(r.manifest.canonicalDuration), JSON.stringify({ time: 150000, frameCount: 4500 }), "canonical duration from Final Audio");
  const types = r.manifest.tracks.map((t) => t.trackType);
  for (const t of ["NARRATION", "MUSIC", "SFX", "VIDEO", "IMAGE", "CHART"]) assert(types.includes(t), `track ${t} present`);
  assertEq(r.manifest.items.length, 12, "all items placed");
  assert(r.manifest.items.every((i) => /^as-/.test(i.assetId)), "every item references canonical assetId");
  const v = tl.validateManifest(r.manifest);
  assert(v.ok, "schema valid: " + v.errors);
});

await runTest("Case B — same timeline under 24000/1001 maps frames exactly", async () => {
  const reg = makeRegistry();
  const r = tl.buildTimeline({ ...canonicalInputs(reg), timebasePolicyRef: "ntsc-23976@1.0.0" });
  assert(r.ok, "build ok");
  assertEq(r.manifest.canonicalDuration.frameCount, Math.ceil((150000 * 24000) / (1001 * 1000)), "exact NTSC frame count (ms→s factored)");
  const item = r.manifest.items.find((i) => i.trackType === "VIDEO");
  assertEq(item.timelineRange.startFrame, Math.floor((0 * 24000) / 1001), "start frame exact");
});

await runTest("Case C — audio-derived duration change updates timeline deterministically", async () => {
  const reg = makeRegistry();
  const a = tl.buildTimeline(canonicalInputs(reg));
  const b = tl.buildTimeline(canonicalInputs(reg, { finalAudio: { artifactId: "final-audio-abc123", durationMs: 158000, narrationTimingHash: "nth-canonical0000", finalMixHash: "fmh-canonical000" } }));
  assert(b.ok, "rebuild ok");
  assertEq(b.manifest.canonicalDuration.time, 158000, "duration follows Final Audio");
  assertEq(b.manifest.canonicalDuration.frameCount, 4740, "frames follow deterministically");
  assert(b.manifest.timelineId !== a.manifest.timelineId, "timeline identity reflects duration");
  // Items beyond the new duration would overflow — the last image ends at 150000 ≤ 158000, still fine.
  assertEq(b.manifest.qaStatus, "PASS", "no overflow");
});

await runTest("Case D — long visual source trim keeps source and timeline ranges distinct", async () => {
  const reg = makeRegistry();
  const r = tl.buildTimeline(canonicalInputs(reg));
  const vid = r.manifest.items.find((i) => i.assetId === "as-vid0002");
  assertEq(vid.sourceRange.startTime, 10000, "source range preserved");
  assertEq(vid.timelineRange.startTime, 90000, "timeline range independent");
  assertEq(vid.timelineRange.endTime - vid.timelineRange.startTime, vid.sourceRange.endTime - vid.sourceRange.startTime, "duration preserved by trim");
});

await runTest("Case E — unknown/path-only asset rejected (UNKNOWN_ASSET)", async () => {
  const reg = makeRegistry();
  const inputs = canonicalInputs(reg);
  inputs.visualItems.push({ trackType: "IMAGE", assetId: "D:/rawfootage/anonymous.png", startTime: 1000, endTime: 2000 });
  const r = tl.buildTimeline(inputs);
  assert(r.ok, "build completes");
  assert(r.manifest.qa.findings.some((f) => f.code === "UNKNOWN_ASSET" && f.assetId.includes("anonymous")), "anonymous path rejected");
  assert(!r.manifest.items.some((i) => i.assetId.includes("anonymous")), "path-only item NOT in approved state");
  assertEq(r.manifest.qaStatus, "FAIL", "blocking failure");
});

await runTest("Case F — local REPLACE_ASSET: only affected branch dirty", async () => {
  const reg = makeRegistry();
  reg.assets["as-vid0003"] = { assetId: "as-vid0003", hash: hash("vid3"), type: "video", durationMs: 90000, conform: videoMeta };
  const r = tl.buildTimeline(canonicalInputs(reg));
  const target = r.manifest.items.find((i) => i.assetId === "as-vid0001");
  const others = r.manifest.items.filter((i) => i.timelineItemId !== target.timelineItemId).map((i) => i.dependencyHashes.asset).join("|");
  const p = tl.patchTimeline(r.manifest, { patchId: "patch-replace-1", type: "REPLACE_ASSET", expectedRevision: 1, targetId: target.timelineItemId, assetId: "as-vid0003" }, { assetResolver: reg.resolver });
  assert(p.ok, "patch ok: " + (p.message || ""));
  assertEq(p.manifest.revision, 2, "revision bumped");
  const targetAfter = p.manifest.items.find((i) => i.timelineItemId === target.timelineItemId);
  assertEq(targetAfter.assetId, "as-vid0003", "asset replaced");
  assertEq(targetAfter.dependencyHashes.asset, hash("vid3"), "dependency hash updated");
  assertEq(p.manifest.items.filter((i) => i.timelineItemId !== target.timelineItemId).map((i) => i.dependencyHashes.asset).join("|"), others, "unrelated items untouched");
  // Invalidation semantics (§20): visual replace never dirties speech timing.
  const inv = tl.resolveTimelineInvalidation({ prevNarrationTimingHash: "nth-1", nextNarrationTimingHash: "nth-1", prevFinalMixHash: "m1", nextFinalMixHash: "m1" });
  assertEq(inv.speechTimingDirty, false, "speech timing CLEAN");
});

await runTest("Case G — local RETIME of a valid non-speech item", async () => {
  const reg = makeRegistry();
  const r = tl.buildTimeline(canonicalInputs(reg));
  const img = r.manifest.items.find((i) => i.trackType === "IMAGE" && i.assetId === "as-img0001");
  const p = tl.patchTimeline(r.manifest, { patchId: "patch-retime-1", type: "RETIME_ITEM", expectedRevision: 1, targetId: img.timelineItemId, timelineRange: { startTime: 42000, endTime: 78000 } });
  assert(p.ok, "retime ok: " + (p.message || ""));
  const after = p.manifest.items.find((i) => i.timelineItemId === img.timelineItemId);
  assertEq(after.timelineRange.startFrame, 1260, "frames recomputed deterministically");
  const qa = tl.timelineQA(p.manifest, {});
  assert(!qa.findings.some((f) => f.code === "FRAME_MAPPING_MISMATCH"), "no frame mismatch after patch");
});

await runTest("Case H — stale patch returns PATCH_CONFLICT (no lost update)", async () => {
  const reg = makeRegistry();
  const r = tl.buildTimeline(canonicalInputs(reg));
  const img = r.manifest.items.find((i) => i.assetId === "as-img0001");
  const p1 = tl.patchTimeline(r.manifest, { patchId: "h1", type: "RETIME_ITEM", expectedRevision: 1, targetId: img.timelineItemId, timelineRange: { startTime: 42000, endTime: 78000 } });
  assert(p1.ok, "first patch ok");
  const stale = tl.patchTimeline(p1.manifest, { patchId: "h2", type: "RETIME_ITEM", expectedRevision: 1, targetId: img.timelineItemId, timelineRange: { startTime: 50000, endTime: 80000 } });
  assertEq(stale.code, "PATCH_CONFLICT", "stale patch conflicts (patch based on revision 1 vs current 2)");
});

await runTest("Case I — locked item survives unrelated rebuild", async () => {
  const reg = makeRegistry();
  const r = tl.buildTimeline(canonicalInputs(reg));
  const img = r.manifest.items.find((i) => i.assetId === "as-img0001");
  img.locked = true;
  const r2 = tl.buildTimeline({ ...canonicalInputs(reg), previousManifest: r.manifest });
  const img2 = r2.manifest.items.find((i) => i.timelineItemId === img.timelineItemId);
  assert(img2 && img2.locked === true, "locked item preserved through rebuild");
  assertEq(r2.metrics.preservedLocked, 1, "preservation counted");
});

await runTest("Case J — VFR media gets an explicit conform decision (never silent CFR)", async () => {
  const reg = makeRegistry({
    "as-vfr0001": { assetId: "as-vfr0001", hash: hash("vfr"), type: "video", durationMs: 30000, conform: { ...videoMeta, scanType: "VFR", scanTypeConfidence: "DETECTED" } },
  });
  const r = tl.buildTimeline({ ...canonicalInputs(reg), visualItems: [{ trackType: "VIDEO", assetId: "as-vfr0001", startTime: 0, endTime: 30000 }] });
  const item = r.manifest.items.find((i) => i.assetId === "as-vfr0001");
  assertEq(item.conformDecision, "CONFORM_REQUIRED", "explicit conform decision");
  assert(r.manifest.qa.findings.some((f) => f.code === "VFR_REQUIRES_CONFORM"), "canonical VFR finding");
  assertEq(r.manifest.qaStatus, "REVIEW_REQUIRED", "not silently approved");
});

await runTest("Case K — present color metadata preserved with policy refs", async () => {
  const reg = makeRegistry();
  const r = tl.buildTimeline(canonicalInputs(reg));
  const vid = r.manifest.items.find((i) => i.assetId === "as-vid0001");
  assertEq(vid.colorRef, "sdr-web-standard@1.0.0", "color policy ref attached");
  assertEq(r.manifest.colorManagementPolicyRef, "sdr-web-standard@1.0.0", "manifest-level policy ref");
  assert(!r.manifest.qa.findings.some((f) => f.code === "UNKNOWN_COLOR_METADATA"), "no color finding when metadata present");
});

await runTest("Case L — unknown color metadata → REVIEW_REQUIRED, no silent guess", async () => {
  const reg = makeRegistry({
    "as-unk0001": { assetId: "as-unk0001", hash: hash("unk"), type: "image", conform: { mediaType: "image", width: 1920, height: 1080, color: { confidence: "UNKNOWN" } } },
  });
  const r = tl.buildTimeline({ ...canonicalInputs(reg), visualItems: [{ trackType: "IMAGE", assetId: "as-unk0001", startTime: 0, endTime: 5000 }] });
  assert(r.manifest.qa.findings.some((f) => f.code === "UNKNOWN_COLOR_METADATA"), "unknown color explicit");
  assertEq(r.manifest.qaStatus, "REVIEW_REQUIRED", "review required");
  // ASSUMED without an assumption ref is also flagged.
  const reg2 = makeRegistry({
    "as-ass0001": { assetId: "as-ass0001", hash: hash("ass"), type: "image", conform: { mediaType: "image", width: 1920, height: 1080, color: { primaries: "BT.709", transfer: "sRGB", confidence: "ASSUMED" } } },
  });
  const r2 = tl.buildTimeline({ ...canonicalInputs(reg2), visualItems: [{ trackType: "IMAGE", assetId: "as-ass0001", startTime: 0, endTime: 5000 }] });
  assert(r2.manifest.qa.findings.some((f) => f.code === "COLOR_POLICY_REVIEW_REQUIRED"), "ASSUMED without ref flagged");
});

await runTest("Case M — mixed image/video/chart sources all resolve by assetId", async () => {
  const reg = makeRegistry();
  const r = tl.buildTimeline(canonicalInputs(reg));
  const kinds = new Set(r.manifest.items.map((i) => i.trackType));
  for (const k of ["VIDEO", "IMAGE", "CHART"]) assert(kinds.has(k), `${k} resolved`);
  assert(r.manifest.items.every((i) => /^as-/.test(i.assetId) && i.dependencyHashes.asset), "all canonical, all hashed");
});

await runTest("Case N — caption timing imported from Phase 2 (no alignment regeneration)", async () => {
  const reg = makeRegistry();
  const r = tl.buildTimeline(canonicalInputs(reg));
  assertEq(r.manifest.sourceTiming.alignmentArtifactId, "al-align000001", "alignment artifact referenced");
  assertEq(r.manifest.sourceTiming.captionArtifactId, "cap-artifact00001", "caption artifact referenced");
  assertEq(r.manifest.sourceTiming.narrationTimingHash, "nth-canonical0000", "narration timing hash carried");
  // Stale alignment detection.
  const stale = tl.buildTimeline(canonicalInputs(reg, { alignment: { artifactId: "al-old", transcriptHash: "t", narrationTimingHash: "nth-OLD" } }));
  assert(stale.manifest.qa.findings.some((f) => f.code === "STALE_INPUT_HASH"), "stale alignment flagged");
});

await runTest("Case O — mix-only audio change keeps speech timeline CLEAN", async () => {
  const reg = makeRegistry();
  const inv = tl.resolveTimelineInvalidation({
    prevNarrationTimingHash: "nth-canonical0000", nextNarrationTimingHash: "nth-canonical0000",
    prevFinalMixHash: "fmh-canonical000", nextFinalMixHash: "fmh-mixonly0000",
  });
  assertEq(inv.mixOnlyChange, true, "classified mix-only");
  assertEq(inv.speechTimingDirty, false, "speech timeline CLEAN");
  assertEq(inv.timelineMixRefDirty, true, "only the mix reference updates");
  const timing = tl.resolveTimelineInvalidation({
    prevNarrationTimingHash: "nth-canonical0000", nextNarrationTimingHash: "nth-NEW000000000",
    prevFinalMixHash: "fmh-canonical000", nextFinalMixHash: "fmh-canonical000",
  });
  assertEq(timing.speechTimingDirty, true, "speech timing change dirties timeline timing");
});

await runTest("Case P — idempotent rebuild + idempotent patch", async () => {
  const reg = makeRegistry();
  const r1 = tl.buildTimeline(canonicalInputs(reg));
  const r2 = tl.buildTimeline(canonicalInputs(reg));
  // Semantic stability: same items (ids are content-derived), same qa, no duplicates.
  assertEq(r2.manifest.items.length, r1.manifest.items.length, "no duplicate items on rebuild");
  assertEq(JSON.stringify(r1.manifest.items.map((i) => [i.timelineItemId, i.timelineRange])), JSON.stringify(r2.manifest.items.map((i) => [i.timelineItemId, i.timelineRange])), "stable semantic manifest");
  // Patch idempotency: same patchId → no duplicate mutation.
  const img = r1.manifest.items.find((i) => i.assetId === "as-img0001");
  const p1 = tl.patchTimeline(r1.manifest, { patchId: "same-key", type: "RETIME_ITEM", expectedRevision: 1, targetId: img.timelineItemId, timelineRange: { startTime: 42000, endTime: 78000 } });
  const p2 = tl.patchTimeline(p1.manifest, { patchId: "same-key", type: "RETIME_ITEM", expectedRevision: 2, targetId: img.timelineItemId, timelineRange: { startTime: 42000, endTime: 78000 } });
  assertEq(p2.idempotent, true, "same patchId is a no-op");
  assertEq(p2.manifest.revision, p1.manifest.revision, "no revision bump on idempotent replay");
  assertEq(p1.manifest.appliedPatchIds.length, 1, "no duplicate mutation");
});

await runTest("Extra — locked item blocks destructive patches; speech-bound retime protected", async () => {
  const reg = makeRegistry();
  const r = tl.buildTimeline(canonicalInputs(reg));
  const nar = r.manifest.items.find((i) => i.trackType === "NARRATION");
  const p = tl.patchTimeline(r.manifest, { patchId: "x1", type: "RETIME_ITEM", expectedRevision: 1, targetId: nar.timelineItemId, timelineRange: { startTime: 0, endTime: 35000 } });
  assertEq(p.code, "SPEECH_TIMING_PROTECTED", "narration timing owned by Final Audio");
  const img = r.manifest.items.find((i) => i.assetId === "as-img0001");
  img.locked = true;
  const p2 = tl.patchTimeline(r.manifest, { patchId: "x2", type: "REMOVE_ITEM", expectedRevision: 1, targetId: img.timelineItemId });
  assertEq(p2.code, "LOCK_VIOLATION", "locked item protected");
});

await runTest("Extra — agent store contract: build/get/patch/validate/findings", async () => {
  const reg = makeRegistry();
  const store = tl.createTimelineStore();
  const b = store.buildTimeline("agent-p1", canonicalInputs(reg));
  assert(b.ok, "build via store");
  const g = store.getTimeline("agent-p1");
  assertEq(g.manifest.projectId, "agent-p1", "get returns manifest");
  const img = g.manifest.items.find((i) => i.assetId === "as-img0001");
  const p = store.patchTimeline("agent-p1", { patchId: "a1", type: "RETIME_ITEM", expectedRevision: 1, targetId: img.timelineItemId, timelineRange: { startTime: 45000, endTime: 75000 } });
  assert(p.ok, "patch via store");
  const v = store.validateTimeline("agent-p1");
  assertEq(v.status, "PASS", "validate via store");
  const f = store.getTimelineFindings("agent-p1");
  assertEq(f.status, "PASS", "findings via store");
});

console.log(`\n=== master-timeline cases A-P: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
})();
