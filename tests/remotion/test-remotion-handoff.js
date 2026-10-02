"use strict";

/**
 * UNFOLDIQ STEP-11 Branch C — Remotion handoff tests (RH1-RH6).
 * Covers lib/step11-handoff.js msToFrames/captionFrameRanges/audioClipFrameRanges/
 * timelineDurationFrames/assertNoBlackTail. No render is ever executed.
 * Fixtures under projects/__11_handoff__/ (removed in teardown).
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const PROJECT = "__11_handoff__";
const PROJDIR = path.join(ROOT, "projects", PROJECT);

const handoff = require("../../lib/step11-handoff.js");
const { msToFrames, captionFrameRanges, audioClipFrameRanges, timelineDurationFrames, assertNoBlackTail } = handoff;

let passed = 0;
let failed = 0;

function assert(c, m) {
  if (!c) throw new Error(`ASSERTION FAILED: ${m}`);
  console.log(`  ok ${m}`);
  passed++;
}

function runTest(name, fn) {
  console.log(`\n[TEST] ${name}`);
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`[PASS] ${name}`))
    .catch((e) => {
      console.log(`[FAIL] ${name}: ${e.message}`);
      failed++;
    });
}

function teardown() {
  fs.rmSync(PROJDIR, { recursive: true, force: true });
}

async function main() {
  console.log("=== REMOTION HANDOFF TESTS (RH1-RH6) ===\n");
  fs.rmSync(PROJDIR, { recursive: true, force: true });
  fs.mkdirSync(PROJDIR, { recursive: true });

  await runTest("RH1 msToFrames deterministic (1000ms@30fps=30)", async () => {
    const a = msToFrames(1000, 30);
    const b = msToFrames(1000, 30);
    console.log(`  output: frames=${a} repeat=${b}`);
    assert(a === 30, `1000ms@30fps must be 30 frames, got ${a}`);
    assert(a === b, "msToFrames must be deterministic");
  });

  await runTest("RH2 caption frame ranges valid (end>start, integers)", async () => {
    const ranges = captionFrameRanges([
      { captionId: "cap-1", startMs: 0, endMs: 500 },
      { captionId: "cap-2", startMs: 500, endMs: 1000 }
    ], 30);
    console.log(`  output: ranges=${JSON.stringify(ranges)}`);
    assert(ranges.length === 2, "two captions in, two ranges out");
    for (const r of ranges) {
      assert(Number.isInteger(r.startFrame) && Number.isInteger(r.endFrame), "frames must be integers");
      assert(r.endFrame > r.startFrame, "endFrame must exceed startFrame");
      assert(r.durationFrames === r.endFrame - r.startFrame, "durationFrames must equal end-start");
    }
  });

  await runTest("RH3 audio clip ranges valid", async () => {
    const ranges = audioClipFrameRanges([{ clipId: "clip_v01", startMs: 0, durationMs: 1000 }], 30);
    console.log(`  output: ranges=${JSON.stringify(ranges)}`);
    assert(ranges.length === 1, "one clip in, one range out");
    assert(ranges[0].startFrame === 0 && ranges[0].endFrame === 30, "0-1000ms@30fps must be frames 0-30");
    assert(ranges[0].durationFrames === 30, "durationFrames must be 30");
  });

  await runTest("RH4 timeline duration frames from actualTimelineEndMs", async () => {
    const frames = timelineDurationFrames({ actualTimelineEndMs: 2000 }, 30);
    console.log(`  output: frames=${frames}`);
    assert(frames === 60, `2000ms@30fps must be 60 frames, got ${frames}`);
  });

  await runTest("RH5 assertNoBlackTail passes clean, throws on black-tail", async () => {
    const clean = { voiceEndMs: 1000, visualPlannedEndMs: 800, actualTimelineEndMs: 1000, sources: ["voice-measured"] };
    assert(assertNoBlackTail(clean) === true, "clean timeline must pass");
    let threw = null;
    try {
      assertNoBlackTail({ voiceEndMs: 1000, actualTimelineEndMs: 3000, sources: ["voice-measured", "black-tail-2000ms"] });
    } catch (e) {
      threw = e.message;
    }
    console.log(`  output: blackTailError=${threw}`);
    assert(threw && /BLACK_TAIL/.test(threw), "black-tail timeline must throw BLACK_TAIL_REJECTED");
  });

  await runTest("RH6 no render executed in Step 11 handoff path", async () => {
    const files = ["lib/step11-handoff.js", "lib/caption-builder.js", "lib/audio-timeline.js"];
    const hits = [];
    for (const f of files) {
      const src = fs.readFileSync(path.join(ROOT, f), "utf8");
      // Reject actual render invocations only; '.mp4' may appear in
      // comments/path strings and is explicitly allowed.
      if (/renderMedia\s*\(|npx\s+remotion\s+render/.test(src)) hits.push(f);
    }
    console.log(`  output: renderHits=${hits.join(",") || "none"}`);
    assert(hits.length === 0, `no renderMedia(/remotion render invocations allowed (hits: ${hits.join(",") || "none"})`);
    assert(!fs.existsSync(path.join(PROJDIR, "out.mp4")), "no mp4 produced by handoff tests");
  });

  teardown();
  console.log(`\n=== SUMMARY ===`);
  console.log(`Passed assertions: ${passed}, Failed tests: ${failed}`);
  if (failed > 0) {
    console.log("RESULT: SOME TESTS FAILED");
    process.exit(1);
  }
  console.log("RESULT: ALL TESTS PASSED");
}

main().catch((e) => {
  console.log(`FATAL: ${e.stack || e.message}`);
  try { teardown(); } catch {}
  process.exit(1);
});
