"use strict";

/**
 * Phase 3C §40 Cases K–Y. Responsive Timeline Variants derived from the
 * canonical Master Timeline — never independent duplicated state.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const Ajv = require("ajv");
const fx = require("../fixtures/timeline-control-fixture.js");
const responsive = require(fx.REPO + "/lib/responsive/index.js");

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

const P916 = "portrait-9x16@1.0.0";
const P169 = "landscape-16x9@1.0.0";

function subjectFor(manifest, source = "EXISTING_METADATA", confidence = 0.9) {
  const meta = {};
  for (const i of manifest.items) {
    if (i.trackType === "VIDEO" || i.trackType === "IMAGE") {
      meta[i.timelineItemId] = { source, sourceBounds: { x: 0.15, y: 0.3, width: 0.3, height: 0.35 }, confidence };
    }
  }
  return meta;
}

function chartLabels(manifest, labels = ["Series A", "Series B"]) {
  const meta = {};
  for (const i of manifest.items) {
    if (["CHART", "MAP", "DIAGRAM"].includes(i.trackType)) meta[i.timelineItemId] = { labels };
  }
  return meta;
}

(async () => {

await runTest("Case K — 16:9 → 9:16 derivation, base untouched, lineage explicit", async () => {
  const { manifest } = fx.buildFixture();
  const plan = fx.buildMotion(manifest);
  const before = JSON.stringify(manifest);
  const r = responsive.deriveResponsiveVariant({ projectId: "p", timelineManifest: manifest, motionPlan: plan, profileRef: P916, subjectMetadataByItem: subjectFor(manifest), chartMetaByItem: chartLabels(manifest) });
  assert(r.ok, "derive ok");
  assertEq(JSON.stringify(manifest), before, "base timeline not mutated");
  assertEq(r.variant.sourceTimelineRevision, manifest.revision || 0, "lineage: source revision");
  assertEq(r.variant.sourceMotionPlanRevision, plan.revision || 0, "lineage: motion revision");
  assertEq(r.variant.responsiveProfileRef, P916, "lineage: profile ref");
  assert(r.variant.dependencyHashes.timeline && r.variant.dependencyHashes.profile, "lineage hashes");
  const ajv = new Ajv({ strict: false });
  const schema = JSON.parse(fs.readFileSync(path.join(fx.REPO, "schemas", "responsive-variant.schema.json"), "utf8"));
  assert(ajv.compile(schema)(r.variant), "variant ajv-valid");
});

await runTest("Case L — subject-aware crop keeps subject in critical safe zone", async () => {
  const { manifest } = fx.buildFixture();
  const r = responsive.deriveResponsiveVariant({ projectId: "p", timelineManifest: manifest, profileRef: P916, subjectMetadataByItem: subjectFor(manifest) });
  assert(r.ok, "derive ok");
  const blocks = r.qa.findings.filter((f) => f.severity === "BLOCK");
  assertEq(blocks.length, 0, "no blocking findings: " + JSON.stringify(blocks));
  assert(!r.qa.findings.some((f) => f.code === "SUBJECT_OUT_OF_FRAME" || f.code === "CRITICAL_CONTENT_CROPPED"), "subject framed");
  assert((r.variant.reframePlans || []).length > 0, "reframe plans exist");
  assert((r.variant.reframePlans || []).every((p) => p.source === "EXISTING_METADATA"), "real metadata source recorded");
});

await runTest("Case M — no subject metadata: fallback + review, no fake tracking", async () => {
  const { manifest } = fx.buildFixture();
  const r = responsive.deriveResponsiveVariant({ projectId: "p", timelineManifest: manifest, profileRef: P916 });
  assert(r.ok, "derive ok");
  assert(r.qa.findings.some((f) => f.code === "REFRAME_LOW_CONFIDENCE"), "low confidence flagged");
  assert((r.variant.reframePlans || []).every((p) => p.trackingPath === null), "no fabricated tracking path");
  assert((r.variant.reframePlans || []).every((p) => p.source === "FALLBACK"), "fallback source honest");
});

await runTest("Case N — moving subject: smoothed bounded path, no jitter", async () => {
  const { manifest } = fx.buildFixture();
  const vid = manifest.items.find((i) => i.trackType === "VIDEO");
  const raw = [];
  for (let k = 0; k < 20; k++) {
    raw.push({ frame: vid.timelineRange.startFrame + k * 10, centerX: 0.5 + (k % 2 === 0 ? 0.05 : -0.05), centerY: 0.45, confidence: 0.8 });
  }
  const meta = { [vid.timelineItemId]: { source: "DETECTED", sourceBounds: { x: 0.4, y: 0.3, width: 0.2, height: 0.3 }, trackingPath: raw, confidence: 0.8 } };
  const r = responsive.deriveResponsiveVariant({ projectId: "p", timelineManifest: manifest, profileRef: P916, subjectMetadataByItem: meta });
  assert(r.ok, "derive ok");
  const rf = r.variant.reframePlans.find((p) => p.timelineItemId === vid.timelineItemId);
  assert(rf && rf.trackingPath && rf.trackingPath.length === raw.length, "frame-aware path preserved");
  assert(rf.maxStep <= 0.015 + 1e-9, `bounded movement (maxStep=${rf.maxStep})`);
  assert(rf.jitter < rf.rawJitter, `smoothing reduces oscillation (${rf.jitter.toFixed(5)} < ${rf.rawJitter.toFixed(5)})`);
  assert(!r.qa.findings.some((f) => f.code === "REFRAME_JITTER" && f.target === vid.timelineItemId), "no jitter finding after smoothing");
});

await runTest("Case O — operator reframe override wins + survives rerun", async () => {
  const { manifest } = fx.buildFixture();
  const ids = fx.visualIds(manifest);
  const anchors = { [ids[0]]: { anchor: "RIGHT", bounds: { x: 0.6, y: 0.3, width: 0.3, height: 0.35 } } };
  const a = responsive.deriveResponsiveVariant({ projectId: "p", timelineManifest: manifest, profileRef: P916, subjectMetadataByItem: subjectFor(manifest), operatorAnchorsByItem: anchors });
  const b = responsive.deriveResponsiveVariant({ projectId: "p", timelineManifest: manifest, profileRef: P916, subjectMetadataByItem: subjectFor(manifest), operatorAnchorsByItem: anchors });
  const ra = a.variant.reframePlans.find((p) => p.timelineItemId === ids[0]);
  assertEq(ra.source, "OPERATOR", "manual path overrides generated path");
  assertEq(JSON.stringify(a.variant.layoutItems), JSON.stringify(b.variant.layoutItems), "operator framing deterministic across reruns");
});

await runTest("Case P — caption reflow adapts lines, text identity preserved", async () => {
  const { manifest } = fx.buildFixture();
  const ids = fx.visualIds(manifest);
  const text = "This is a deliberately long caption sentence that must wrap across several portrait lines";
  const r = responsive.deriveResponsiveVariant({
    projectId: "p", timelineManifest: manifest, profileRef: P916,
    captionCuesByItem: { [ids[0]]: { text } },
  });
  assert(r.ok, "derive ok");
  const cap = r.variant.captionLayouts.find((c) => c.timelineItemId === ids[0]);
  assert(cap, "caption layout exists");
  assert(cap.lines.every((l) => l.length <= 42), "9:16 line budget respected: " + JSON.stringify(cap.lines));
  assertEq(cap.wordIdentity, text.split(/\s+/).join(" "), "no paraphrase — word identity preserved");
});

await runTest("Case Q — title repositions in safe zone, never unreadably small", async () => {
  const { manifest } = fx.buildFixture();
  const ids = fx.visualIds(manifest);
  const r = responsive.deriveResponsiveVariant({
    projectId: "p", timelineManifest: manifest, profileRef: P916,
    titleCuesByItem: { [ids[1]]: { text: "Chapter Two: The Turning Point", preferredAnchor: "TOP_CENTER" } },
  });
  assert(r.ok, "derive ok");
  const t = r.variant.titleLayouts.find((x) => x.timelineItemId === ids[1]);
  assert(t, "title layout exists");
  const zone = responsive.profiles.safeRect(responsive.profiles.getResponsiveProfile(P916), "title");
  assert(t.position.y >= zone.y && t.position.width <= zone.width, "title inside title safe zone");
  assert(t.fontScale >= t.fontScaleRange.min, "no unreadable shrink");
});

await runTest("Case R — chart re-laid out, labels never destructively cropped", async () => {
  const { manifest } = fx.buildFixture();
  const cht = manifest.items.find((i) => i.trackType === "CHART");
  const good = responsive.deriveResponsiveVariant({ projectId: "p", timelineManifest: manifest, profileRef: P916, chartMetaByItem: chartLabels(manifest) });
  const d = good.variant.dataLayouts.find((x) => x.timelineItemId === cht.timelineItemId);
  assert(d && d.readable && d.legendPreserved, "readable chart re-laid out");
  const longLabels = [`${"Very long category name ".repeat(8)}A`, `${"Another extremely long series label ".repeat(8)}B`];
  const bad = responsive.deriveResponsiveVariant({ projectId: "p", timelineManifest: manifest, profileRef: P916, chartMetaByItem: { [cht.timelineItemId]: { labels: longLabels } } });
  assert(bad.qa.findings.some((f) => f.code === "CHART_UNREADABLE"), "unfittable chart reviews honestly");
  const repaired = responsive.repairResponsiveVariant(bad.variant, { timelineManifest: manifest, chartMetaByItem: { [cht.timelineItemId]: { labels: longLabels } } });
  const d2 = repaired.variant.dataLayouts.find((x) => x.timelineItemId === cht.timelineItemId);
  assertEq(d2.strategy, "SWITCH_RESPONSIVE", "repair switches layout instead of cropping");
  assert(d2.labelPlacement === "BELOW_STACKED", "labels re-placed, not cropped");
});

await runTest("Case S — map/diagram labels preserved", async () => {
  const { manifest } = fx.buildFixture(undefined, [
    { trackType: "MAP", assetId: "as-map1", startTime: 0, endTime: 30000, sceneId: "sc0" },
    { trackType: "DIAGRAM", assetId: "as-dia1", startTime: 30000, endTime: 60000, sceneId: "sc1" },
  ]);
  const labels = ["North Gate", "River Crossing"];
  const r = responsive.deriveResponsiveVariant({ projectId: "p", timelineManifest: manifest, profileRef: P916, chartMetaByItem: chartLabels(manifest, labels) });
  assert(r.ok, "derive ok");
  assertEq(r.variant.dataLayouts.length, 2, "map + diagram layouts");
  assert(r.variant.dataLayouts.every((d) => d.readable && d.legendPreserved), "labels preserved");
});

await runTest("Case T — variant-only override leaves base + 16:9 clean", async () => {
  const { manifest } = fx.buildFixture();
  const before = JSON.stringify(manifest);
  const v16 = responsive.deriveResponsiveVariant({ projectId: "p", timelineManifest: manifest, profileRef: P169 });
  const v9 = responsive.deriveResponsiveVariant({ projectId: "p", timelineManifest: manifest, profileRef: P916, subjectMetadataByItem: subjectFor(manifest) });
  const target = v9.variant.layoutItems[0].timelineItemId;
  const p = responsive.patchResponsiveVariant(v9.variant, { patchId: "vp-1", op: "SET_CROP", targetId: target, crop: { x: 0.1 }, expectedRevision: v9.variant.revision });
  assert(p.ok, "variant patch ok");
  assertEq(JSON.stringify(manifest), before, "base unchanged");
  assertEq(JSON.stringify(v16.variant.layoutItems), JSON.stringify(responsive.deriveResponsiveVariant({ projectId: "p", timelineManifest: manifest, profileRef: P169 }).variant.layoutItems), "16:9 unaffected");
});

await runTest("Case U — base change rebases only affected branches", async () => {
  const { manifest } = fx.buildFixture();
  const plan = fx.buildMotion(manifest);
  const v = responsive.deriveResponsiveVariant({ projectId: "p", timelineManifest: manifest, motionPlan: plan, profileRef: P916, subjectMetadataByItem: subjectFor(manifest) });
  const ids = fx.visualIds(manifest);
  const beforeLayouts = JSON.stringify(v.variant.layoutItems);
  // Base change: drop last item + bump revision (new asset on first item).
  const evolved = JSON.parse(JSON.stringify(manifest));
  evolved.items = evolved.items.filter((i) => i.timelineItemId !== ids[3]);
  evolved.items.find((i) => i.timelineItemId === ids[0]).assetId = "as-vid2";
  evolved.revision = (evolved.revision || 0) + 1;
  const recs = [
    { overrideId: "ovr-keep", target: { type: "RESPONSIVE_VARIANT", timelineItemId: ids[0] } },
    { overrideId: "ovr-gone", target: { type: "RESPONSIVE_VARIANT", timelineItemId: ids[3] } },
  ];
  const rb = responsive.rebaseVariant(v.variant, evolved, plan, recs);
  assert(rb.ok, "rebase ok");
  assertEq(JSON.stringify(rb.preserved), JSON.stringify(["ovr-keep"]), "compatible override preserved");
  assertEq(JSON.stringify(rb.conflicts), JSON.stringify(["ovr-gone"]), "dropped-branch override explicit");
  assert(!rb.variant.layoutItems.some((l) => l.timelineItemId === ids[3]), "gone branch removed");
  const keptBefore = JSON.parse(beforeLayouts).filter((l) => l.timelineItemId !== ids[3]);
  assertEq(JSON.stringify(rb.variant.layoutItems), JSON.stringify(keptBefore), "unaffected branches byte-identical");
});

await runTest("Case V — variant stale patch conflicts, no lost update", async () => {
  const { manifest } = fx.buildFixture();
  const v = responsive.deriveResponsiveVariant({ projectId: "p", timelineManifest: manifest, profileRef: P916 });
  const target = v.variant.layoutItems[0].timelineItemId;
  const stale = responsive.patchResponsiveVariant(v.variant, { patchId: "vp-stale", op: "SET_CROP", targetId: target, crop: { x: 0.2 }, expectedRevision: 999 });
  assert(!stale.ok && stale.code === "VARIANT_STALE", "stale patch refused");
  assertEq(v.variant.revision, 1, "no lost update");
});

await runTest("Case W — restart/persistence reloads same semantic state", async () => {
  const { manifest } = fx.buildFixture();
  const v = responsive.deriveResponsiveVariant({ projectId: "p", timelineManifest: manifest, profileRef: P916, subjectMetadataByItem: subjectFor(manifest) });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "unfoldiq-variant-"));
  fs.mkdirSync(path.join(tmp, "projects", "validation", "proj-var"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "projects", "registry.json"), JSON.stringify({
    schemaVersion: "1.0.0",
    projects: [{ projectId: "proj-var", kind: "VALIDATION", status: "ACTIVE", path: "projects/validation/proj-var", manifestRef: null }],
  }));
  const saved = responsive.persistVariant(tmp, "proj-var", v.variant);
  assert(saved.ok, "persist ok");
  const loaded = responsive.loadVariant(tmp, "proj-var", v.variant.variantId);
  assert(loaded.ok, "reload ok");
  assertEq(JSON.stringify(loaded.variant.layoutItems), JSON.stringify(v.variant.layoutItems), "layout state identical");
  assertEq(loaded.variant.sourceTimelineRevision, v.variant.sourceTimelineRevision, "lineage preserved");
  fs.rmSync(tmp, { recursive: true, force: true });
});

await runTest("Case X — layout change leaves audio/alignment/captions timing clean", async () => {
  const inv = responsive.resolveVariantInvalidation({ scope: "VARIANT_ONLY", variantId: "var-x" });
  assert(inv.variantLayoutBranchDirty && inv.variantRenderQADirty, "variant branches dirty");
  assert(inv.baseTimelineClean && inv.siblingVariantsClean, "base + siblings clean");
  assert(inv.finalAudioClean && inv.alignmentClean && inv.captionsTimingClean && inv.sourceMediaClean, "timing branches clean");
});

await runTest("Case Y — NTSC timing preserved across responsive ops", async () => {
  for (const tb of ["ntsc-23976@1.0.0", "web-2997@1.0.0"]) {
    const { manifest } = fx.buildFixture(tb);
    const v = responsive.deriveResponsiveVariant({ projectId: "p", timelineManifest: manifest, profileRef: P916, subjectMetadataByItem: subjectFor(manifest) });
    assert(v.ok, `derive ok @ ${tb}`);
    for (const l of v.variant.layoutItems) {
      const ti = manifest.items.find((i) => i.timelineItemId === l.timelineItemId);
      assertEq(l.frameRange.startFrame, ti.timelineRange.startFrame, `start exact @ ${tb}`);
      assertEq(l.frameRange.endFrameExclusive, ti.timelineRange.endFrameExclusive, `end exact @ ${tb}`);
    }
  }
});

console.log(`\n=== responsive: ${failed} failed, ${passed} passed ===`);
process.exit(failed > 0 ? 1 : 0);
})();
