"use strict";

/**
 * Phase 1G.11 — structural QA tests ST1–ST10 (+ MO13 freeze, zero-motion,
 * duration-unknown). Deterministic, hermetic, zero generation, zero credits.
 * Real PNG bytes via tests/fixtures/make-png.js; video via probeOverride
 * (pre-measured pipeline metadata) + minimal ftyp magic for signature.
 */

const path = require("path");
const qa = require("../../lib/asset-qa/index.js");
const { makePng } = require("../fixtures/make-png.js");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
  console.log(`  ✓ ${message}`);
  passed++;
}

async function runTest(name, fn) {
  console.log(`\n[TEST] ${name}`);
  try {
    await fn();
    console.log(`[PASS] ${name}`);
  } catch (e) {
    console.log(`[FAIL] ${name}: ${e.message}`);
    failed++;
  }
}

function pngBytes(w, h) {
  return makePng(w, h);
}

// Minimal 12-byte MP4-style head: [size][ftyp][isom].
function mp4Head() {
  const b = Buffer.alloc(12);
  b.writeUInt32BE(12, 0);
  b.write("ftyp", 4, "ascii");
  b.write("isom", 8, "ascii");
  return b;
}

function videoProbe(durationMs) {
  return {
    metadata: { width: 1920, height: 1080, durationMs, fps: 30, codec: "h264", container: "mp4", fileSize: 12345 },
    status: "MEASURED",
    evidence: { source: "FFPROBE", measuredAt: new Date().toISOString() },
  };
}

async function main() {
  await runTest("ST1 valid image decode PASS", () => {
    const r = qa.evaluateStructural({ bytes: pngBytes(32, 32), fileName: "frame.png", expected: { mediaType: "image" } });
    assert(r.status === "PASS", "valid PNG decodes to structural PASS");
    assert(r.checks.find((c) => c.check === "decode").status === "PASS", "decode check PASS");
  });

  await runTest("ST2 valid video decode PASS", () => {
    const r = qa.evaluateStructural({ bytes: mp4Head(), fileName: "clip.mp4", probeOverride: videoProbe(4000), expected: { mediaType: "video", durationMs: 4000, durationToleranceMs: 500 } });
    assert(r.status === "PASS", "valid video probe to structural PASS");
  });

  await runTest("ST3 corrupt file FAIL", () => {
    const r = qa.evaluateStructural({ bytes: Buffer.from("this is not media at all, just text"), fileName: "clip.mp4", expected: { mediaType: "video" } });
    assert(r.status === "FAIL", "corrupt bytes FAIL");
    assert(r.reasons.some((x) => /CORRUPT_MEDIA|unrecognized file signature/.test(x)), "corruption reason recorded");
  });

  await runTest("ST4 wrong media type FAIL", () => {
    const r = qa.evaluateStructural({ bytes: pngBytes(16, 16), fileName: "frame.png", expected: { mediaType: "video", durationMs: 2000 } });
    assert(r.status === "FAIL", "PNG for VIDEO expectation FAILs");
    assert(r.reasons.some((x) => /WRONG_MEDIA_TYPE/.test(x)), "WRONG_MEDIA_TYPE reason recorded");
  });

  await runTest("ST5 invalid/zero duration FAIL", () => {
    const r = qa.evaluateStructural({ bytes: mp4Head(), fileName: "clip.mp4", probeOverride: videoProbe(0), expected: { mediaType: "video" } });
    assert(r.status === "FAIL", "zero duration FAILs");
    assert(r.checks.find((c) => c.check === "duration").status === "FAIL", "duration check FAIL");
  });

  await runTest("ST6 dimensions extracted", () => {
    const r = qa.evaluateStructural({ bytes: pngBytes(64, 48), fileName: "frame.png", expected: { mediaType: "image" } });
    const ev = r.evidence.find((e) => e.check === "dimensions");
    assert(ev && String(ev.observed) === "64x48", "measured 64x48 retained as evidence");
  });

  await runTest("ST7 aspect match PASS", () => {
    const r = qa.evaluateStructural({ bytes: mp4Head(), fileName: "clip.mp4", probeOverride: videoProbe(4000), expected: { mediaType: "video", durationMs: 4000, aspect: "16:9" } });
    assert(r.checks.find((c) => c.check === "aspect").status === "PASS", "16:9 aspect PASS (expectation-driven, never hard-coded)");
  });

  await runTest("ST8 aspect mismatch FAIL", () => {
    const r = qa.evaluateStructural({ bytes: mp4Head(), fileName: "clip.mp4", probeOverride: videoProbe(4000), expected: { mediaType: "video", durationMs: 4000, aspect: "9:16" } });
    assert(r.checks.find((c) => c.check === "aspect").status === "FAIL", "9:16 expectation against 16:9 source FAILs");
    assert(r.status === "FAIL", "layer FAILs on aspect mismatch");
  });

  await runTest("ST9 extension/signature mismatch detected", () => {
    const r = qa.evaluateStructural({ bytes: pngBytes(8, 8), fileName: "photo.jpg", expected: { mediaType: "image" } });
    assert(r.checks.find((c) => c.check === "file-type").status === "FAIL", ".jpg extension over PNG bytes FAILs");
  });

  await runTest("ST10 same bytes same result", () => {
    const input = { bytes: pngBytes(32, 32), fileName: "frame.png", expected: { mediaType: "image" } };
    const a = qa.evaluateStructural(input);
    const b = qa.evaluateStructural({ bytes: pngBytes(32, 32), fileName: "frame.png", expected: { mediaType: "image" } });
    assert(JSON.stringify(a.checks) === JSON.stringify(b.checks), "identical bytes → identical checks (idempotent)");
  });

  await runTest("MO13 deterministic unintended source freeze FAIL", () => {
    const r = qa.evaluateStructural({
      bytes: mp4Head(), fileName: "clip.mp4", probeOverride: videoProbe(4000),
      expected: { mediaType: "video", durationMs: 4000 },
      streamMeta: { truncated: false, timestampValid: true, freezeSegments: [{ fromMs: 1000, toMs: 2500 }] },
    });
    assert(r.checks.find((c) => c.check === "freeze").status === "FAIL", "frozen source segment FAILs");
  });

  await runTest("zero-motion when structurally required FAIL", () => {
    const r = qa.evaluateStructural({
      bytes: mp4Head(), fileName: "clip.mp4", probeOverride: videoProbe(4000),
      expected: { mediaType: "video", durationMs: 4000, motionRequired: true },
      streamMeta: { truncated: false, timestampValid: true, freezeSegments: [], zeroMotion: true },
    });
    assert(r.checks.find((c) => c.check === "zero-motion").status === "FAIL", "zero-motion output FAILs when motion required");
  });

  await runTest("video duration unobservable → critical UNKNOWN (never PASS)", () => {
    const r = qa.evaluateStructural({ bytes: mp4Head(), fileName: "clip.mp4", probeOverride: { metadata: { width: 640, height: 360 }, status: "MEASURED", evidence: { source: "FFPROBE" } }, expected: { mediaType: "video" } });
    assert(r.checks.find((c) => c.check === "duration").status === "UNKNOWN", "missing duration is UNKNOWN");
    assert(r.blocking === true, "critical UNKNOWN blocks");
    assert(r.status !== "PASS", "UNKNOWN never collapses into PASS");
  });

  console.log(`\n=== DONE: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(`FATAL: ${(e && e.stack) || e}`);
  process.exit(1);
});
