"use strict";

/**
 * UNFOLDIQ STEP-11 Branch C — measured timeline tests (TL1-TL12).
 * Covers lib/audio-timeline.js buildMeasuredTimeline/buildAudioTimeline/
 * reconcileSceneVoice/proposePlaybackRate + lib/timeline-gap-check.js checkGaps.
 * Fixtures under projects/__11_timeline__/ (removed in teardown).
 * No network, no installs, no MP4 render (TL12 scans sources for render calls).
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const PROJECT = "__11_timeline__";
const PROJDIR = path.join(ROOT, "projects", PROJECT);

const { buildAudioTimeline, reconcileSceneVoice, proposePlaybackRate, buildMeasuredTimeline } = require("../../lib/audio-timeline.js");
const { checkGaps } = require("../../lib/timeline-gap-check.js");

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
  console.log("=== MEASURED TIMELINE TESTS (TL1-TL12) ===\n");
  fs.rmSync(PROJDIR, { recursive: true, force: true });
  fs.mkdirSync(PROJDIR, { recursive: true });

  await runTest("TL1 actualEnd = max(valid ends)", async () => {
    const t = buildMeasuredTimeline({ projectId: PROJECT, voiceEndMs: 1000, visualPlannedEndMs: 800, captionEndMs: 600, musicEndMs: 400, sources: ["voice-measured"] });
    console.log(`  output: actualTimelineEndMs=${t.actualTimelineEndMs}`);
    assert(t.actualTimelineEndMs === 1000, "actualEnd must be max of valid ends");
  });

  await runTest("TL2 targetMs never changes actualEnd", async () => {
    const a = buildMeasuredTimeline({ projectId: PROJECT, voiceEndMs: 1000, visualPlannedEndMs: 800, sources: ["voice-measured"] });
    const b = buildMeasuredTimeline({ projectId: PROJECT, voiceEndMs: 1000, visualPlannedEndMs: 800, durationTargetMs: 5000, sources: ["voice-measured"] });
    console.log(`  output: noTarget=${a.actualTimelineEndMs} withTarget=${b.actualTimelineEndMs} note=${b.note}`);
    assert(b.actualTimelineEndMs === a.actualTimelineEndMs, "target must not pad the timeline");
  });

  await runTest("TL3 black-tail source rejected (never silent PASS)", async () => {
    const t = buildMeasuredTimeline({ projectId: PROJECT, voiceEndMs: 1000, sources: ["voice-measured", "black-tail-2000ms"] });
    console.log(`  output: status=${t.status} issues=${JSON.stringify(t.issues || [])}`);
    assert(t.status === "REVIEW_REQUIRED", `black-tail must REVIEW, got ${t.status}`);
    assert((t.issues || []).some((i) => i.kind === "BLACK_TAIL_REJECTED" && i.blocksReady), "BLACK_TAIL_REJECTED must block readiness");
  });

  await runTest("TL4 intentional outro accepted into actualEnd", async () => {
    const t = buildAudioTimeline({
      voice: [{ clipId: "v1", startMs: 0, durationMs: 1000 }],
      intentionalTails: [{ kind: "outro", startMs: 1000, endMs: 1500, purpose: "end card" }]
    });
    console.log(`  output: actualEndMs=${t.actualEndMs} status=${t.status} tails=${JSON.stringify(t.tails)}`);
    assert(t.actualEndMs === 1500, "actualEnd must include intentional outro");
    assert(t.tails[0].status === "ACCEPTED", "outro with purpose must be ACCEPTED");
  });

  await runTest("TL5 intentional music tail accepted", async () => {
    const t = buildAudioTimeline({
      voice: [{ clipId: "v1", startMs: 0, durationMs: 1000 }],
      music: [{ clipId: "m1", startMs: 0, durationMs: 1200 }],
      intentionalTails: [{ kind: "music-tail", startMs: 1200, endMs: 1800, purpose: "fade out under end card" }]
    });
    console.log(`  output: actualEndMs=${t.actualEndMs} status=${t.status}`);
    assert(t.actualEndMs === 1800, "actualEnd must include intentional music tail");
    assert(t.status === "READY", `must be READY, got ${t.status}`);
  });

  await runTest("TL6 unexplained visual gap -> REVIEW/BLOCKED", async () => {
    const r = checkGaps({
      scenes: [
        { sceneId: "S01", startMs: 0, endMs: 1000 },
        { sceneId: "S02", startMs: 4000, endMs: 5000 }
      ]
    });
    console.log(`  output: status=${r.status} issues=${JSON.stringify(r.issues.map((i) => i.kind))}`);
    assert(r.status !== "CLEAN", "unexplained 3000ms gap must not be CLEAN");
    assert(r.issues.some((i) => i.kind === "UNEXPLAINED_GAP"), "must record UNEXPLAINED_GAP");
  });

  await runTest("TL7 explicit pause accepted (CLEAN)", async () => {
    const r = checkGaps({
      scenes: [
        { sceneId: "S01", startMs: 0, endMs: 1000, pause: { type: "pause", purpose: "dramatic beat", durationMs: 3000 } },
        { sceneId: "S02", startMs: 4000, endMs: 5000 }
      ]
    });
    console.log(`  output: status=${r.status} gaps=${JSON.stringify(r.gaps)}`);
    assert(r.status === "CLEAN", `explicit pause must be CLEAN, got ${r.status}`);
    assert(r.gaps.some((g) => g.intentional === true), "gap must be recorded intentional");
  });

  await runTest("TL8 voice longer than scene -> RECONCILE_REQUIRED + extend-visual-dwell", async () => {
    const r = reconcileSceneVoice({ sceneId: "S01", scenePlannedEndMs: 1000, voiceEndMs: 1500 });
    console.log(`  output: decision=${r.decision} options=${JSON.stringify(r.options)}`);
    assert(r.decision === "RECONCILE_REQUIRED", "overrun must require reconcile");
    assert((r.options || []).includes("extend-visual-dwell"), "options must include extend-visual-dwell");
  });

  await runTest("TL9 voice shorter + visual hold tail accepted", async () => {
    const rec = reconcileSceneVoice({ sceneId: "S01", scenePlannedEndMs: 1500, voiceEndMs: 1000 });
    const t = buildAudioTimeline({
      voice: [{ clipId: "v1", startMs: 0, durationMs: 1000 }],
      intentionalTails: [{ kind: "visual-hold", startMs: 1000, endMs: 1500, purpose: "hold closing frame" }]
    });
    console.log(`  output: decision=${rec.decision} actualEndMs=${t.actualEndMs} status=${t.status}`);
    assert(rec.decision === "VISUAL_HOLD_ACCEPTED", `short voice must hold visual, got ${rec.decision}`);
    assert(t.actualEndMs === 1500 && t.status === "READY", "visual-hold tail must be accepted");
  });

  await runTest("TL10 playbackRate never auto-applied; out-of-bounds rejected", async () => {
    const a = proposePlaybackRate({ explicit: false, rate: 1.0 });
    const b = proposePlaybackRate({ explicit: true, rate: 1.5 });
    const c = proposePlaybackRate({ explicit: true, rate: 1.05 });
    console.log(`  output: implicit=${JSON.stringify(a)} oob=${JSON.stringify(b)} ok=${JSON.stringify(c)}`);
    assert(a.accepted === false, "implicit playbackRate must be rejected");
    assert(b.accepted === false, "out-of-bounds 1.5 must be rejected");
    assert(c.accepted === true && c.rate === 1.05, "explicit in-bounds rate must be accepted");
  });

  await runTest("TL11 sources[] recorded in timeline evidence", async () => {
    const t = buildMeasuredTimeline({ projectId: PROJECT, voiceEndMs: 1000, sources: ["voice-measured:wav-header", "visual-planned:scene-script"] });
    console.log(`  output: sources=${JSON.stringify(t.sources)}`);
    assert(Array.isArray(t.sources) && t.sources.length === 2, "sources[] must be recorded");
    assert(t.sources[0] === "voice-measured:wav-header", "source entries preserved verbatim");
  });

  await runTest("TL12 video-spec references timeline; no render executed", async () => {
    const t = buildMeasuredTimeline({ projectId: PROJECT, voiceEndMs: 1000, visualPlannedEndMs: 800, sources: ["voice-measured"] });
    const videoSpecLike = { version: "1.0.0", projectId: PROJECT, durationMs: t.actualTimelineEndMs, durationSource: "MEASURED_TIMELINE" };
    console.log(`  output: videoSpec.durationMs=${videoSpecLike.durationMs}`);
    assert(videoSpecLike.durationMs === t.actualTimelineEndMs, "video-spec duration must reference measured timeline end");
    const files = ["lib/media-preflight.js", "lib/media-probe.js", "lib/voice-check.js", "lib/transcript-alignment.js", "lib/audio-timeline.js", "lib/caption-builder.js", "lib/caption-grouping.js", "lib/caption-check.js", "lib/step11-contract-check.js", "lib/step11-handoff.js"];
    const hits = [];
    for (const f of files) {
      const src = fs.readFileSync(path.join(ROOT, f), "utf8");
      if (/renderMedia\s*\(|npx\s+remotion\s+render/.test(src)) hits.push(f);
    }
    assert(hits.length === 0, `Step 11 files must invoke no render (hits: ${hits.join(",") || "none"})`);
    assert(!fs.existsSync(path.join(PROJDIR, "out.mp4")), "no mp4 produced");
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
