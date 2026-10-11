"use strict";

/**
 * Diagram engine: spec validation, keyframe math (shared with the Remotion
 * renderer via remotion/src/diagram/track.ts) and chart helper.
 */

const fs = require("fs");
const path = require("path");

const REPO = path.join(__dirname, "..", "..");
const { validateSpec, barChart } = require(REPO + "/lib/diagram/index.js");
const { valueAt, isVisible } = require(REPO + "/remotion/src/diagram/track.ts");
const FIX = path.join(REPO, "tests", "fixtures", "diagram");

let passed = 0;
let failed = 0;
function assert(c, m) {
  if (!c) throw new Error("ASSERTION FAILED: " + m);
  console.log("  ok  " + m);
}
function runTest(name, fn) {
  console.log("[TEST] " + name);
  try { fn(); passed += 1; console.log("[PASS] " + name); }
  catch (e) { failed += 1; console.log("[FAIL] " + name + " - " + e.message); }
}

runTest("keyframe track: constant, clamp, midpoint, eased", () => {
  assert(valueAt(5, 3) === 5, "constant");
  const k = [[1, 0], [3, 100]];
  assert(valueAt(k, 0) === 0 && valueAt(k, 9) === 100, "clamped outside range");
  assert(valueAt(k, 2) === 50, "smoothstep midpoint is exact 50%");
  assert(valueAt(k, 1.5) < 25, "ease-in start is slower than linear");
});

runTest("visibility windows", () => {
  assert(isVisible(undefined, 0) && isVisible([2], 5) && !isVisible([2], 1), "open-ended window");
  assert(isVisible([1, 3], 2) && !isVisible([1, 3], 3), "end exclusive");
});

runTest("validateSpec accepts fixtures", () => {
  for (const f of fs.readdirSync(FIX).filter((x) => x.endsWith(".json"))) {
    const r = validateSpec(JSON.parse(fs.readFileSync(path.join(FIX, f), "utf8")));
    assert(r.ok, `${f} valid (${r.errors.join("; ")})`);
  }
});

runTest("validateSpec rejects bad specs at the boundary", () => {
  const base = { version: 1, durationSec: 5, elements: [] };
  assert(!validateSpec({ ...base, version: 2 }).ok, "wrong version");
  assert(!validateSpec({ ...base, durationSec: 0 }).ok, "zero duration");
  const dup = { ...base, elements: [{ id: "a", type: "line", x1: 0, y1: 0, x2: 1, y2: 1 }, { id: "a", type: "line", x1: 0, y1: 0, x2: 1, y2: 1 }] };
  assert(validateSpec(dup).errors.some((e) => e.includes("duplicate")), "duplicate id");
  assert(!validateSpec({ ...base, elements: [{ id: "x", type: "star" }] }).ok, "unknown type");
  assert(!validateSpec({ ...base, elements: [{ id: "c", type: "circle", cx: 1, cy: 1, r: [[2, 1], [1, 2]] }] }).ok, "unordered keyframes");
  assert(!validateSpec({ ...base, elements: [{ id: "c", type: "circle", cx: NaN, cy: 1, r: 2 }] }).ok, "NaN value");
});

runTest("barChart builds proportional bars and keeps labels verbatim", () => {
  const els = barChart({ bars: [{ label: "A", value: 10, valueLabel: "10 u" }, { label: "B", value: 5 }], h: 400, max: 10 });
  const hs = els.filter((e) => e.id.includes("-bar")).map((e) => valueAt(e.h, 99));
  assert(hs[0] === 400 && hs[1] === 200, "heights scale to max");
  assert(els.some((e) => e.text === "10 u") && els.some((e) => e.text === "5"), "value labels verbatim/default");
  assert(validateSpec({ version: 1, durationSec: 5, elements: els }).ok, "output validates");
});

console.log(`\n=== diagram: ${failed} failed, ${passed} passed ===`);
process.exit(failed > 0 ? 1 : 0);
