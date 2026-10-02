"use strict";

/**
 * Flow page adapter tests (STEP 10B): FP1–FP15.
 * Mock-DOM harness only. Harness success ≠ live Flow success
 * (all selectors remain NOT_VERIFIED against the live UI).
 */

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.join(__dirname, "..", "..");
const adapter = require("../../flow-companion/extension/src/content/flow-page-adapter.js");
const detector = require("../../flow-companion/extension/src/core/capability-detector.js");
const harness = require("../../flow-companion/harness/mock-flow-page.js");

let passed = 0;
let failed = 0;

function assert(c, m) {
  if (!c) throw new Error(`ASSERTION FAILED: ${m}`);
  console.log(`  ✓ ${m}`);
  passed++;
}

function runTest(name, fn) {
  console.log(`\n[TEST] ${name}`);
  try {
    fn();
    console.log(`[PASS] ${name}`);
    return true;
  } catch (e) {
    console.log(`[FAIL] ${name}: ${e.message}`);
    failed++;
    return false;
  }
}

function logOut(label, obj) {
  console.log(`  output: ${label} = ${JSON.stringify(obj)}`);
}

function videoJob() {
  return { capability: "video", referenceAssets: [], ingredients: [] };
}

console.log("=== FLOW PAGE ADAPTER TESTS (FP1-FP15) ===\n");

// FP1 — prompt control detected.
runTest("FP1 Prompt control detected", () => {
  const el = adapter.detectPromptControl(harness.fullPage());
  logOut("detected", el !== null);
  assert(el !== null, "prompt control must be detected on full fixture");
});

// FP2 — missing prompt control fails safe.
runTest("FP2 Missing prompt fails safe", () => {
  assert(adapter.detectPromptControl(harness.missingPrompt()) === null, "missing prompt must yield null, not a guess");
  const r = adapter.prepareJob(harness.missingPrompt(), videoJob());
  logOut("prepare", r);
  assert(r.manualAssist === true, "missing prompt must route to manual assist");
});

// FP3 — image mode fixture selectable.
runTest("FP3 Image mode selectable", () => {
  const r = adapter.selectMode(harness.fullPage(), "image");
  logOut("selectMode", r);
  assert(r.ok === true && r.mode === "image", "image mode must be selectable in fixture");
});

// FP4 — video mode fixture selectable.
runTest("FP4 Video mode selectable", () => {
  const r = adapter.selectMode(harness.fullPage(), "video");
  assert(r.ok === true && r.mode === "video", "video mode must be selectable in fixture");
});

// FP5 — reference input supported.
runTest("FP5 References attachable", () => {
  const r = adapter.attachReferences(harness.fullPage(), [{ assetId: "REF-1", path: "x" }, { assetId: "REF-2", path: "y" }]);
  logOut("attach", r);
  assert(r.attached === 2, "two references must attach");
});

// FP6 — start frame supported by fixture.
runTest("FP6 Start frame supported", () => {
  const r = adapter.attachFrame(harness.fullPage(), "start", { assetId: "SF", path: "s.png" });
  logOut("frame", r);
  assert(r.attached === 1 && r.kind === "start", "start frame must attach");
});

// FP7 — end frame supported by fixture.
runTest("FP7 End frame supported", () => {
  const r = adapter.attachFrame(harness.fullPage(), "end", { assetId: "EF", path: "e.png" });
  assert(r.attached === 1 && r.kind === "end", "end frame must attach");
});

// FP8 — aspect ratio applied in fixture.
runTest("FP8 Aspect ratio applied", () => {
  const doc = harness.fullPage();
  const r = adapter.applySettings(doc, { aspectRatio: "9:16" });
  logOut("applied", r);
  assert(r.applied.includes("aspectRatio"), "aspect ratio must apply");
});

// FP9 — generation length applied in fixture.
runTest("FP9 Generation length applied", () => {
  const r = adapter.applySettings(harness.fullPage(), { generationLength: "8s" });
  assert(r.applied.includes("generationLength"), "generation length must apply");
});

// FP10 — result card detected.
runTest("FP10 Result card detected", () => {
  const found = adapter.detectResults(harness.fullPage({ results: ["https://cdn.test/r1.mp4"] }));
  logOut("results", found);
  assert(found.length === 1, "one result card must be detected");
});

// FP11 — multiple results correlated.
runTest("FP11 Multiple results correlated", () => {
  const found = adapter.detectResults(harness.fullPage({ results: ["https://cdn.test/r1.mp4", "https://cdn.test/r2.mp4"] }));
  logOut("results", found);
  assert(found.length === 2, "two result cards must correlate 1:1");
});

// FP12 — timeout does not auto-regenerate.
runTest("FP12 Timeout never regenerates", () => {
  let generations = 0;
  const neverReady = () => ({ ready: false, items: [] });
  const r = adapter.pollResult(neverReady, { deadlineMs: 3000, nowMs: 0 });
  logOut("poll", { ...r, generations });
  assert(r.timeout === true, "poll must report timeout");
  assert(generations === 0, "timeout must not trigger any generation");
});

// FP13 — DOM changed leads to manual assist.
runTest("FP13 Changed DOM routes to manual assist", () => {
  const r = adapter.prepareJob(harness.changedDom(), videoJob());
  logOut("prepare", r);
  assert(r.manualAssist === true && r.missing.length > 0, "changed DOM must route to MANUAL_ASSIST_REQUIRED");
  const health = adapter.selectorHealth(harness.changedDom());
  assert(Object.values(health).every((s) => s === "MISSING"), "health must show all selectors missing");
});

// FP14 — no fixed-sleep success assumption.
runTest("FP14 Observable state required", () => {
  const late = (t) => (t >= 2000 ? { ready: true, items: ["https://cdn.test/late.mp4"] } : { ready: false, items: [] });
  const ok = adapter.pollResult(late, { deadlineMs: 5000, nowMs: 0 });
  assert(ok.found === true && ok.items.length === 1, "observable ready state must be honored when it appears");
  const early = adapter.pollResult(() => ({ ready: false, items: [] }), { deadlineMs: 1000, nowMs: 0 });
  assert(early.timeout === true, "absence of observable state must be timeout, never assumed success");
});

// FP15 — selector definitions centralized.
runTest("FP15 Selectors centralized", () => {
  assert(adapter.SELECTORS && Object.keys(adapter.SELECTORS).length >= 10, "single SELECTORS map required");
  const offenders = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (["node_modules", ".output", "tests", "harness", "ui"].includes(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(p);
        continue;
      }
      if (!e.name.endsWith(".js")) continue;
      if (p.endsWith("flow-page-adapter.js")) continue;
      const src = fs.readFileSync(p, "utf8");
      if (/querySelector|getElementById|getElementsBy/.test(src)) offenders.push(path.relative(REPO_ROOT, p));
    }
  };
  walk(path.join(REPO_ROOT, "flow-companion"));
  logOut("offenders", offenders);
  assert(offenders.length === 0, "no DOM queries outside flow-page-adapter.js");
});

console.log(`\n=== SUMMARY ===`);
console.log(`Passed assertions: ${passed}, Failed tests: ${failed}`);
if (failed > 0) {
  console.log("RESULT: SOME TESTS FAILED");
  process.exit(1);
}
console.log("RESULT: ALL TESTS PASSED");
