"use strict";

/**
 * UNFOLDIQ STEP-11 Branch C — caption tests (CP1-CP15).
 * Covers lib/caption-builder.js buildCaptions/toSrt/toVtt,
 * lib/caption-grouping.js groupSegments/PLATFORM_DEFAULTS,
 * lib/caption-check.js checkCaptions.
 * Fixtures under projects/__11_captions__/ (removed in teardown).
 * No network, no installs, no MP4 render.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const PROJECT = "__11_captions__";
const PROJDIR = path.join(ROOT, "projects", PROJECT);

const { buildCaptions, toSrt, toVtt } = require("../../lib/caption-builder.js");
const { groupSegments, PLATFORM_DEFAULTS } = require("../../lib/caption-grouping.js");
const { checkCaptions } = require("../../lib/caption-check.js");

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

function evItems() {
  return [
    { startMs: 0, endMs: 500, text: "hello world", evidence: { source: "measured", level: "SEGMENT_TIMING" } },
    { startMs: 500, endMs: 1000, text: "second line", evidence: { source: "measured", level: "SEGMENT_TIMING" } }
  ];
}

function kinds(r) {
  return (r.issues || []).map((i) => i.kind).join(",");
}

async function main() {
  console.log("=== CAPTION TESTS (CP1-CP15) ===\n");
  fs.rmSync(PROJDIR, { recursive: true, force: true });
  fs.mkdirSync(PROJDIR, { recursive: true });

  await runTest("CP1 measured segments -> READY", async () => {
    const r = checkCaptions({ items: evItems(), audioEndMs: 2000, timingLevel: "SEGMENT_TIMING", mode: "SIDECAR" });
    console.log(`  output: status=${r.status} issues=[${kinds(r)}]`);
    assert(r.status === "READY", `measured captions must be READY, got ${r.status}`);
  });

  await runTest("CP2 negative start -> BLOCKED", async () => {
    const items = [{ startMs: -5, endMs: 500, text: "bad", evidence: { source: "measured" } }];
    const r = checkCaptions({ items, audioEndMs: 2000, timingLevel: "SEGMENT_TIMING" });
    console.log(`  output: status=${r.status} issues=[${kinds(r)}]`);
    assert(r.status === "BLOCKED", "negative start must BLOCK");
    assert(/NEGATIVE_TIME/.test(kinds(r)), "must record NEGATIVE_TIME");
  });

  await runTest("CP3 end<=start -> BLOCKED", async () => {
    const items = [{ startMs: 500, endMs: 500, text: "bad", evidence: { source: "measured" } }];
    const r = checkCaptions({ items, audioEndMs: 2000, timingLevel: "SEGMENT_TIMING" });
    console.log(`  output: status=${r.status} issues=[${kinds(r)}]`);
    assert(r.status === "BLOCKED", "end<=start must BLOCK");
    assert(/END_BEFORE_START/.test(kinds(r)), "must record END_BEFORE_START");
  });

  await runTest("CP4 out-of-order -> BLOCKED", async () => {
    const items = [
      { startMs: 500, endMs: 1000, text: "second", evidence: { source: "measured" } },
      { startMs: 0, endMs: 400, text: "first", evidence: { source: "measured" } }
    ];
    const r = checkCaptions({ items, audioEndMs: 2000, timingLevel: "SEGMENT_TIMING" });
    console.log(`  output: status=${r.status} issues=[${kinds(r)}]`);
    assert(r.status === "BLOCKED", "out-of-order must BLOCK");
    assert(/OUT_OF_ORDER/.test(kinds(r)), "must record OUT_OF_ORDER");
  });

  await runTest("CP5 duplicate -> BLOCKED", async () => {
    const dup = { startMs: 0, endMs: 500, text: "same", evidence: { source: "measured" } };
    const r = checkCaptions({ items: [dup, Object.assign({}, dup)], audioEndMs: 2000, timingLevel: "SEGMENT_TIMING" });
    console.log(`  output: status=${r.status} issues=[${kinds(r)}]`);
    assert(r.status === "BLOCKED", "duplicate must BLOCK");
    assert(/DUPLICATE_CAPTION/.test(kinds(r)), "must record DUPLICATE_CAPTION");
  });

  await runTest("CP6 empty text -> BLOCKED", async () => {
    const items = [{ startMs: 0, endMs: 500, text: "   ", evidence: { source: "measured" } }];
    const r = checkCaptions({ items, audioEndMs: 2000, timingLevel: "SEGMENT_TIMING" });
    console.log(`  output: status=${r.status} issues=[${kinds(r)}]`);
    assert(r.status === "BLOCKED", "empty text must BLOCK");
    assert(/EMPTY_CAPTION/.test(kinds(r)), "must record EMPTY_CAPTION");
  });

  await runTest("CP7 endMs beyond audioEndMs -> BLOCKED", async () => {
    const items = [{ startMs: 0, endMs: 5000, text: "too long", evidence: { source: "measured" } }];
    const r = checkCaptions({ items, audioEndMs: 2000, timingLevel: "SEGMENT_TIMING" });
    console.log(`  output: status=${r.status} issues=[${kinds(r)}]`);
    assert(r.status === "BLOCKED", "caption beyond audio end must BLOCK");
    assert(/BEYOND_AUDIO_TIMELINE/.test(kinds(r)), "must record BEYOND_AUDIO_TIMELINE");
  });

  await runTest("CP8 word-highlight without word timing is not READY", async () => {
    const items = [{ startMs: 0, endMs: 500, text: "karaoke line", styleGroup: "karaoke", evidence: { source: "measured" } }];
    const r = checkCaptions({ items, audioEndMs: 2000, timingLevel: "SEGMENT_TIMING", mode: "SIDECAR" });
    console.log(`  output: status=${r.status} issues=[${kinds(r)}]`);
    assert(r.status !== "READY", "karaoke style without WORD_TIMING must not be READY");
    assert(/WORD_TIMING_REQUIRED/.test(kinds(r)), "must record WORD_TIMING_REQUIRED");
  });

  await runTest("CP9 SRT derives from canonical JSON", async () => {
    const b = buildCaptions({
      timing: { level: "SEGMENT_TIMING", segments: evItems() },
      language: "en", timingSource: "measured", projectId: PROJECT, profile: { mode: "SIDECAR" }
    });
    assert(b.status === "READY" && b.captionsJson, "builder must be READY");
    const srt = toSrt(b.captionsJson.items);
    console.log(`  output: srtHead=${JSON.stringify(srt.slice(0, 60))}`);
    assert(srt.includes("hello world") && srt.includes("second line"), "SRT must carry canonical texts");
    assert(srt.includes("00:00:00,000 --> 00:00:00,500"), "SRT must carry canonical timestamps");
    const blocks = srt.split("\n").filter((l) => /^\d+$/.test(l.trim()));
    assert(blocks.length === b.captionsJson.items.length, "SRT cue count must round-trip item count");
  });

  await runTest("CP10 VTT carries WEBVTT header + canonical content", async () => {
    const b = buildCaptions({
      timing: { level: "SEGMENT_TIMING", segments: evItems() },
      language: "en", timingSource: "measured", projectId: PROJECT, profile: { mode: "SIDECAR" }
    });
    const vtt = toVtt(b.captionsJson.items);
    console.log(`  output: vttHead=${JSON.stringify(vtt.slice(0, 40))}`);
    assert(vtt.startsWith("WEBVTT"), "VTT must start with WEBVTT header");
    assert(vtt.includes("hello world") && vtt.includes("00:00:00.000 --> 00:00:00.500"), "VTT must carry canonical text+timestamps");
  });

  await runTest("CP11 TikTok grouping keeps measured boundaries", async () => {
    const segs = [
      { startMs: 0, endMs: 500, text: "short one" },
      { startMs: 500, endMs: 1200, text: "short two" }
    ];
    const out = groupSegments(segs, { platform: "tiktok" });
    console.log(`  output: grouped=${JSON.stringify(out)}`);
    assert(out.length === 2, "short segments must stay 1:1 under tiktok maxChars");
    assert(out[0].startMs === 0 && out[0].endMs === 500, "output start/end must equal input measured boundaries");
    assert(out[1].startMs === 500 && out[1].endMs === 1200, "output start/end must equal input measured boundaries");
  });

  await runTest("CP12 youtube sidecar mode preserved (sentence style)", async () => {
    const b = buildCaptions({
      timing: { level: "SEGMENT_TIMING", segments: evItems() },
      language: "en", timingSource: "measured", projectId: PROJECT,
      profile: { mode: "SIDECAR", style: { group: "sentence" } }
    });
    console.log(`  output: mode=${b.captionsJson && b.captionsJson.mode} style=${b.captionsJson && b.captionsJson.items[0].styleGroup}`);
    assert(b.captionsJson.mode === "SIDECAR", "youtube sidecar mode must be preserved, never forced to tiktok style");
    assert(b.captionsJson.items[0].styleGroup === "sentence", "sentence style group must be recorded");
  });

  await runTest("CP13 platform grouping defaults differ (tiktok < youtube)", async () => {
    console.log(`  output: tiktok=${JSON.stringify(PLATFORM_DEFAULTS.tiktok)} youtube=${JSON.stringify(PLATFORM_DEFAULTS.youtube)}`);
    assert(PLATFORM_DEFAULTS.tiktok.maxChars < PLATFORM_DEFAULTS.youtube.maxChars, "tiktok maxChars (42) must be < youtube (84)");
    const long = "this is a fairly long caption line over forty two characters yes";
    const tik = groupSegments([{ startMs: 0, endMs: 2000, text: long }], { platform: "tiktok" });
    const yt = groupSegments([{ startMs: 0, endMs: 2000, text: long }], { platform: "youtube" });
    assert(tik.length > 1 && yt.length === 1, "same long segment must split on tiktok but stay whole on youtube");
  });

  await runTest("CP14 transcriptMismatch -> BLOCKED", async () => {
    const r = checkCaptions({ items: evItems(), audioEndMs: 2000, timingLevel: "SEGMENT_TIMING", transcriptMismatch: true });
    console.log(`  output: status=${r.status} issues=[${kinds(r)}]`);
    assert(r.status === "BLOCKED", "transcriptMismatch must BLOCK");
    assert(/TRANSCRIPT_MISMATCH/.test(kinds(r)), "must record TRANSCRIPT_MISMATCH");
  });

  await runTest("CP15 stable IDs across rebuilds", async () => {
    const opts = {
      timing: { level: "SEGMENT_TIMING", segments: evItems() },
      language: "en", timingSource: "measured", projectId: PROJECT, profile: { mode: "SIDECAR" }
    };
    const a = buildCaptions(opts);
    const b = buildCaptions(opts);
    const idsA = a.captionsJson.items.map((i) => i.captionId).join(",");
    const idsB = b.captionsJson.items.map((i) => i.captionId).join(",");
    console.log(`  output: ids=${idsA}`);
    assert(idsA === idsB, "rebuild must yield identical captionIds");
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
