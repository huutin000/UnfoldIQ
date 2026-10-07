"use strict";

/**
 * Phase 2.8-E tests — BS.1770-4 loudness measurement sanity.
 * Reference: 1 kHz sine at −20 dBFS (peak) measures ≈ −23.7 LUFS
 * (sine mean-square −3.01 dB + K offset −0.691 at 1 kHz ≈ 0 dB).
 */

const path = require("path");
const REPO = path.join(__dirname, "..", "..");
const loudness = require(REPO + "/lib/audio-loudness.js");

const FS = 48000;
let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (!cond) throw new Error("ASSERTION FAILED: " + msg);
  console.log("  ok  " + msg);
}
function assertEq(a, b, msg) {
  if (a !== b) throw new Error(`ASSERTION FAILED: ${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
  console.log("  ok  " + msg);
}
async function runTest(name, fn) {
  console.log("[TEST] " + name);
  try { await fn(); passed += 1; console.log("[PASS] " + name); }
  catch (e) { failed += 1; console.log("[FAIL] " + name + " — " + e.message); }
}

function sine(dbfs, durationSec = 5, freq = 1000) {
  const n = durationSec * FS;
  const amp = Math.pow(10, dbfs / 20);
  const s = new Int16Array(n);
  for (let i = 0; i < n; i += 1) s[i] = Math.round(amp * Math.sin((2 * Math.PI * freq * i) / FS) * 32767);
  return s;
}

(async () => {
await runTest("B1 −20 dBFS 1 kHz sine ≈ −23.7 LUFS (±0.7)", async () => {
  const m = loudness.measureLoudness(sine(-20), FS);
  assert(Math.abs(m.integratedLufs - (-23.7)) < 0.7, `got ${m.integratedLufs} LUFS`);
});

await runTest("B2 +6 dB louder signal measures ~6 LU louder", async () => {
  const a = loudness.measureLoudness(sine(-20), FS);
  const b = loudness.measureLoudness(sine(-14), FS);
  const delta = b.integratedLufs - a.integratedLufs;
  assert(Math.abs(delta - 6) < 0.3, `delta ${delta.toFixed(2)} LU`);
});

await runTest("B3 digital silence → −Infinity, honest", async () => {
  const m = loudness.measureLoudness(new Int16Array(FS * 2), FS);
  assertEq(m.integratedLufs, -Infinity, "no fabricated value");
  assertEq(m.loudnessRange, null, "no LRA on silence");
});

await runTest("B4 true-peak estimate tracks actual peak (sine)", async () => {
  const m = loudness.measureLoudness(sine(-6, 3), FS);
  assert(Math.abs(m.truePeakDb - (-6)) < 0.5, `truePeak ${m.truePeakDb} ≈ −6 dBFS (interpolated estimate)`);
});

await runTest("B5 LRA ≈ 0 for steady sine, >6 dB for alternating loud/quiet", async () => {
  const steady = loudness.measureLoudness(sine(-20), FS);
  if (steady.loudnessRange !== null) assert(steady.loudnessRange < 3, `steady LRA ${steady.loudnessRange}`);
  const FS2 = 48000;
  const n = FS2 * 10;
  const s = new Int16Array(n);
  for (let i = 0; i < n; i += 1) {
    const t = i / FS2;
    const loud = Math.floor(t / 2.5) % 2 === 0;
    const amp = loud ? Math.pow(10, -10 / 20) : Math.pow(10, -30 / 20);
    s[i] = Math.round(amp * Math.sin((2 * Math.PI * 1000 * i) / FS2) * 32767);
  }
  const varied = loudness.measureLoudness(s, FS2);
  assert(varied.loudnessRange !== null && varied.loudnessRange > 6, `varied LRA ${varied.loudnessRange}`);
});

await runTest("B6 K-weighting is deterministic (same input → same output)", async () => {
  const x = sine(-18, 4);
  const a = loudness.measureLoudness(x, FS);
  const b = loudness.measureLoudness(x, FS);
  assertEq(a.integratedLufs, b.integratedLufs, "identical result");
});

console.log(`\n=== audio-loudness: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
})();
