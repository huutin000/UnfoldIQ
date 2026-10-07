"use strict";

/**
 * Phase 3A-05 — timebase / frame mapping tests (GAP-004 evidence).
 * Exact rational conversion for 24/1, 25/1, 30/1, 24000/1001, 30000/1001,
 * with round-trip and no-accumulating-drift proofs (spec §7).
 */

const path = require("path");
const REPO = path.join(__dirname, "..", "..");
const tb = require(REPO + "/lib/timeline/timebase.js");

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

(async () => {
await runTest("Case B1 — exact rational parsing (23.976 → 24000/1001 etc.)", async () => {
  for (const [dec, num, den] of [[23.976, 24000, 1001], [29.97, 30000, 1001], [59.94, 60000, 1001], [24, 24, 1], [25, 25, 1], [30, 30, 1]]) {
    const fr = tb.parseFrameRate(dec);
    assertEq(fr.numerator, num, `${dec} → ${num}/${den}`);
    assertEq(fr.denominator, den, `${dec} denominator`);
  }
});

await runTest("Case B2 — exact frame boundaries at 30/1", async () => {
  const fr = { numerator: 30, denominator: 1 };
  assertEq(tb.timeToFrameStart(0, fr), 0, "0ms → frame 0");
  assertEq(tb.timeToFrameStart(33, fr), 0, "33ms still frame 0");
  assertEq(tb.timeToFrameStart(34, fr), 1, "34ms → frame 1");
  assertEq(tb.timeToFrameEndExclusive(33, fr), 1, "end-exclusive 33ms → frame 1");
  assertEq(tb.frameToTimeStart(1, fr), 34, "frame 1 starts 34ms");
  assertEq(tb.frameToTimeEndExclusive(0, fr), 34, "frame 0 ends at 34ms");
  assertEq(tb.frameCount(0, 150000, fr), 4500, "150000ms = 4500 frames @30");
});

await runTest("Case B3 — 24000/1001 (23.976): exact non-integer boundaries", async () => {
  const fr = { numerator: 24000, denominator: 1001 };
  // 1001ms × 24000/1001 = exactly 24000 frames per 1001s? per 1001ms = 24 frames.
  assertEq(tb.timeToFrameStart(1001, fr), 24, "1001ms = exactly frame 24");
  assertEq(tb.timeToFrameStart(1000, fr), 23, "1000ms still frame 23");
  assertEq(tb.frameToTimeStart(24, fr), 1001, "frame 24 starts at 1001ms");
  assertEq(tb.frameCount(0, 1001, fr), 24, "24 frames per 1001ms");
  const rt = tb.roundTripCheck(0, 1001, fr);
  assert(rt.startFrameStable && rt.endFrameStable, "round-trip stable at NTSC rate");
});

await runTest("Case B4 — 30000/1001 (29.97) drop-frame flag", async () => {
  const p = tb.getTimebasePolicy("web-2997@1.0.0");
  assertEq(p.dropFrameTimecode, true, "29.97 marks drop-frame timecode");
  const fr = p.frameRate;
  assertEq(tb.timeToFrameStart(2002, fr), 60, "2002ms = exactly frame 60");
  const rt = tb.roundTripCheck(0, 2002, fr);
  assert(rt.startFrameStable && rt.endFrameStable, "round-trip stable");
});

await runTest("Case B5 — round-trip + no accumulating drift over 10k conversions", async () => {
  for (const ref of ["web-30@1.0.0", "web-2997@1.0.0", "film-24@1.0.0", "pal-25@1.0.0", "ntsc-23976@1.0.0"]) {
    const fr = tb.getTimebasePolicy(ref).frameRate;
    let maxDrift = 0;
    let t = 0;
    for (let i = 0; i < 10000; i += 1) {
      const f = tb.timeToFrameStart(t, fr);
      const back = tb.frameToTimeStart(f, fr);
      // Going frame → ms → frame must be the identity (no accumulation).
      const f2 = tb.timeToFrameStart(back, fr);
      if (f2 !== f) throw new Error(`round-trip identity broken at ${ref} t=${t}`);
      const drift = Math.abs(back - t);
      if (drift > maxDrift) maxDrift = drift;
      t += 33; // simulate arbitrary item boundaries
    }
    // Frame-quantization drift is bounded by one frame duration, never accumulates.
    const frameMs = 1000 * fr.denominator / fr.numerator;
    assert(maxDrift <= Math.ceil(frameMs), `${ref}: max round-trip offset ${maxDrift}ms ≤ 1 frame (${frameMs.toFixed(2)}ms)`);
  }
});

await runTest("Case B6 — monotonicity + policy catalog + negative times rejected", async () => {
  const fr = { numerator: 24000, denominator: 1001 };
  let prev = -1;
  for (let t = 0; t <= 20000; t += 7) {
    const f = tb.timeToFrameStart(t, fr);
    if (f < prev) throw new Error("non-monotonic");
    prev = f;
  }
  assert(true, "monotonic across 20s at 23.976");
  let threw = false;
  try { tb.timeToFrameStart(-1, fr); } catch { threw = true; }
  assert(threw, "negative time rejected");
  let unknown = false;
  try { tb.getTimebasePolicy("ghost@9.9.9"); } catch { unknown = true; }
  assert(unknown, "unknown policy rejected");
  assert(tb.getTimebasePolicy("ntsc-23976@1.0.0").frameRate.numerator === 24000, "catalog complete");
});

console.log(`\n=== timeline-timebase: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
})();
