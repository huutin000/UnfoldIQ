"use strict";

/**
 * Phase 3C §40 Cases A–J (+H/W/X override facets).
 * Manual Override Layer on real Master Timeline + MotionPlan manifests.
 */

const path = require("path");
const fx = require("../fixtures/timeline-control-fixture.js");
const override = require(fx.REPO + "/lib/override/index.js");

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

function ctxFor(manifest, extra = {}) {
  return { timelineManifest: manifest, assetResolver: fx.makeRegistry().resolver, baseRevision: manifest.revision || 0, ...extra };
}

(async () => {

await runTest("Case A — replace asset override wins over agent rerun", async () => {
  const { manifest, registry } = fx.buildFixture();
  const ids = fx.visualIds(manifest);
  const store = override.createOverrideStore("p");
  const ap = store.apply(
    { target: { type: "TIMELINE_ITEM", timelineItemId: ids[0] }, operation: "REPLACE_ASSET", payload: { assetId: "as-vid2" }, reason: "operator prefers clip 2" },
    ctxFor(manifest));
  assert(ap.ok, "apply ok");
  // Agent rebuilds from scratch (fresh manifest, replacement unknown to agent).
  const fresh = fx.buildFixture().manifest;
  assertEq(fresh.items.find((i) => i.timelineItemId === ids[0]).assetId, "as-vid1", "agent default untouched");
  const rebased = store.rebase({ manifest: fresh, motionPlan: null }, { assetResolver: registry.resolver });
  assertEq(rebased.applied.length, 1, "override replayed");
  assertEq(rebased.manifest.items.find((i) => i.timelineItemId === ids[0]).assetId, "as-vid2", "operator replacement wins");
  const othersClean = fresh.items.filter((i) => i.timelineItemId !== ids[0])
    .every((i) => JSON.stringify(i) === JSON.stringify(rebased.manifest.items.find((x) => x.timelineItemId === i.timelineItemId)));
  assert(othersClean, "unrelated items unchanged");
});

await runTest("Case B — lock scene survives unrelated rerun/regeneration", async () => {
  const { manifest } = fx.buildFixture();
  const store = override.createOverrideStore("p");
  const ap = store.apply(
    { target: { type: "SCENE", sceneId: "sc1" }, operation: "LOCK_SCENE", reason: "approved" },
    ctxFor(manifest));
  assert(ap.ok, "lock ok");
  const fresh = fx.buildFixture().manifest;
  const rebased = store.rebase({ manifest: fresh, motionPlan: null }, {});
  const locked = rebased.manifest.items.filter((i) => i.sceneId === "sc1");
  assert(locked.length > 0 && locked.every((i) => i.locked === true), "scene locked after rerun");
  assert(rebased.manifest.items.filter((i) => i.sceneId !== "sc1").every((i) => i.locked !== true), "other scenes untouched");
});

await runTest("Case C — force modality persists as operator intent", async () => {
  const { manifest } = fx.buildFixture();
  const ids = fx.visualIds(manifest);
  const store = override.createOverrideStore("p");
  const ap = store.apply(
    { target: { type: "SCENE", sceneId: "sc2" }, operation: "FORCE_VISUAL_MODALITY", payload: { visualModality: "ANNOTATION" }, reason: "evidence needs labeling" },
    ctxFor(manifest));
  assert(ap.ok, "force ok");
  const fresh = fx.buildFixture().manifest;
  const rebased = store.rebase({ manifest: fresh, motionPlan: null }, {});
  assertEq(rebased.manifest.operatorModality.sc2, "ANNOTATION", "operator modality persists");
  const bad = store.apply(
    { target: { type: "SCENE", sceneId: "sc2" }, operation: "FORCE_VISUAL_MODALITY", payload: { visualModality: "NOPE" } },
    ctxFor(manifest));
  assert(!bad.ok, "unknown modality refused");
});

await runTest("Case D — change transition persists; feasibility/safety enforced", async () => {
  const { manifest } = fx.buildFixture();
  const plan = fx.buildMotion(manifest);
  const ids = fx.visualIds(manifest);
  const store = override.createOverrideStore("p");
  const good = store.apply(
    { target: { type: "TRANSITION", transitionId: "tr-op-1" }, operation: "CHANGE_TRANSITION", payload: { primitiveRef: "FADE", durationFrames: 6 }, reason: "softer cut" },
    { ...ctxFor(manifest), motionPlan: plan });
  assert(good.ok, "valid transition change accepted");
  const badPrim = store.apply(
    { target: { type: "TRANSITION", transitionId: "tr-op-2" }, operation: "CHANGE_TRANSITION", payload: { primitiveRef: "NOPE" } },
    { ...ctxFor(manifest), motionPlan: plan });
  assert(!badPrim.ok && badPrim.code === "OVERRIDE_INVALID_TRANSITION", "unknown primitive refused");
  const unsafe = store.apply(
    { target: { type: "TRANSITION", transitionId: "tr-op-3" }, operation: "CHANGE_TRANSITION", payload: { primitiveRef: "WIPE", flashes: [0, 1, 2, 3, 4, 5].map((k) => ({ frame: k })) } },
    { ...ctxFor(manifest), motionPlan: plan });
  assert(!unsafe.ok && unsafe.code === "OVERRIDE_BREAKS_SAFETY", "flash-unsafe transition blocked");
});

await runTest("Case E — caption style persists; text/timing untouched", async () => {
  const { manifest } = fx.buildFixture();
  const store = override.createOverrideStore("p");
  const ap = store.apply(
    { target: { type: "CAPTION_STYLE" }, operation: "CHANGE_CAPTION_STYLE", payload: { fontScale: 1.1, anchor: "BOTTOM_CENTER" }, reason: "readability" },
    ctxFor(manifest));
  assert(ap.ok, "style override accepted");
  assertEq(ap.record.payload.fontScale, 1.1, "style persisted");
  const evil = store.apply(
    { target: { type: "CAPTION_STYLE" }, operation: "CHANGE_CAPTION_STYLE", payload: { text: "rewritten words" } },
    ctxFor(manifest));
  assert(!evil.ok, "caption text rewrite refused at record time");
});

await runTest("Case F — regenerate one scene dirties only its branch", async () => {
  const { manifest } = fx.buildFixture();
  const store = override.createOverrideStore("p");
  const ap = store.apply(
    { target: { type: "SCENE", sceneId: "sc2" }, operation: "REQUEST_REGENERATE_SCENE", reason: "better chart visual" },
    ctxFor(manifest));
  assert(ap.ok, "request accepted");
  const scope = store.regenerateScope(ap.record.overrideId);
  assert(scope.ok, "scope resolved");
  assertEq(scope.scope.sceneId, "sc2", "exact scene targeted");
  assert(scope.scope.sceneBranchDirty && scope.scope.unrelatedScenesClean, "only target branch dirty");
  assert(scope.scope.finalAudioClean && scope.scope.alignmentClean && scope.scope.captionsClean, "audio/alignment/captions clean");
});

await runTest("Case G — reset reactivates agent/default; history stays", async () => {
  const { manifest } = fx.buildFixture();
  const ids = fx.visualIds(manifest);
  const store = override.createOverrideStore("p");
  const ap = store.apply(
    { target: { type: "TIMELINE_ITEM", timelineItemId: ids[1] }, operation: "FORCE_STATIC", payload: {}, reason: "stillness" },
    ctxFor(manifest));
  assert(ap.ok, "apply ok");
  const rs = store.reset(ap.record.overrideId, "operator changed mind");
  assert(rs.ok && rs.record.status === "RESET", "reset ok");
  const fresh = fx.buildFixture().manifest;
  const plan = fx.buildMotion(fresh);
  const rebased = store.rebase({ manifest: fresh, motionPlan: plan }, {});
  assertEq(rebased.applied.length, 0, "reset override not replayed — agent/default active");
  const hist = store.history();
  assert(hist.history.some((c) => c.operation === "RESET_OVERRIDE"), "reset traceable in history");
});

await runTest("Case H — undo/redo deterministic + conflict-aware", async () => {
  const { manifest } = fx.buildFixture();
  const store = override.createOverrideStore("p");
  const a = store.apply({ target: { type: "SCENE", sceneId: "sc0" }, operation: "LOCK_SCENE" }, ctxFor(manifest));
  assert(a.ok, "first apply ok");
  const u = store.undo("oops");
  assert(u.ok, "undo ok");
  const rec = store.records().find((r) => r.overrideId === a.record.overrideId);
  assert(rec.status !== "ACTIVE", "undone record not ACTIVE");
  const r = store.redo("actually keep it");
  assert(r.ok, "redo ok");
  const rec2 = store.records().find((x) => x.overrideId === a.record.overrideId);
  assertEq(rec2.status, "ACTIVE", "redone record ACTIVE again");
  // Conflict path: touch same target after undo, then redo must refuse.
  const store2 = override.createOverrideStore("p2");
  const b = store2.apply({ target: { type: "SCENE", sceneId: "sc3" }, operation: "LOCK_SCENE" }, ctxFor(manifest));
  assert(b.ok, "apply ok");
  assert(store2.undo().ok, "undo ok");
  const c = store2.apply({ target: { type: "SCENE", sceneId: "sc3" }, operation: "UNLOCK_SCENE" }, ctxFor(manifest));
  assert(c.ok, "second op ok");
  // The undone commit's target was touched after → redo conflicts.
  const r2 = store2.redo();
  assert(!r2.ok && r2.code === "REDO_CONFLICT", "redo after target change conflicts");
});

await runTest("Case I — stale override conflicts, never silently replays", async () => {
  const { manifest } = fx.buildFixture();
  const ids = fx.visualIds(manifest);
  const store = override.createOverrideStore("p");
  const ap = store.apply(
    { target: { type: "TIMELINE_ITEM", timelineItemId: ids[0] }, operation: "REPLACE_ASSET", payload: { assetId: "as-vid2" } },
    ctxFor(manifest));
  assert(ap.ok, "apply ok");
  // Incompatible underlying change: different asset + range on the same item.
  const evolved = fx.buildFixture().manifest;
  const item = evolved.items.find((i) => i.timelineItemId === ids[0]);
  item.assetId = "as-vid1";
  item.dependencyHashes = { ...(item.dependencyHashes || {}), asset: "f".repeat(64) };
  item.timelineRange = { ...item.timelineRange, endTime: item.timelineRange.endTime + 1000 };
  evolved.revision = (evolved.revision || 0) + 1;
  const rebased = store.rebase({ manifest: evolved, motionPlan: null }, { assetResolver: fx.makeRegistry().resolver });
  assertEq(rebased.conflicts.length, 1, "conflict declared");
  assert(rebased.findings.some((f) => f.code === "OVERRIDE_CONFLICT"), "OVERRIDE_CONFLICT finding");
  assertEq(rebased.applied.length, 0, "nothing silently replayed");
});

await runTest("Case J — safety beats override (invalid asset + speech timing)", async () => {
  const { manifest } = fx.buildFixture();
  const ids = fx.visualIds(manifest);
  const store = override.createOverrideStore("p");
  const badAsset = store.apply(
    { target: { type: "TIMELINE_ITEM", timelineItemId: ids[0] }, operation: "REPLACE_ASSET", payload: { assetId: "as-ghost" } },
    ctxFor(manifest));
  assert(!badAsset.ok && badAsset.code === "OVERRIDE_INVALID_ASSET", "ghost asset blocked");
  const nar = manifest.items.find((i) => i.trackType === "NARRATION");
  const speech = store.apply(
    { target: { type: "TIMELINE_ITEM", timelineItemId: nar.timelineItemId }, operation: "ADJUST_VISUAL_TIMING", payload: { timelineRange: { startTime: 0, endTime: 5000 } } },
    ctxFor(manifest));
  assert(!speech.ok && speech.code === "OVERRIDE_BREAKS_TIMING", "speech retime routed upstream, not applied");
  const outside = store.apply(
    { target: { type: "TIMELINE_ITEM", timelineItemId: ids[0] }, operation: "ADJUST_VISUAL_TIMING", payload: { timelineRange: { startTime: 0, endTime: 99999999 } } },
    ctxFor(manifest));
  assert(!outside.ok, "retime beyond canonical duration blocked");
});

console.log(`\n=== override: ${failed} failed, ${passed} passed ===`);
process.exit(failed > 0 ? 1 : 0);
})();
