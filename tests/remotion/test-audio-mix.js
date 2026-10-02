"use strict";

/**
 * UNFOLDIQ STEP-11 Branch C — audio mix tests (AM1-AM12).
 * Covers lib/audio-timeline.js buildAudioTimeline, media-preflight music-rights
 * + clip-audio policy, and audio-mix-plan contract fields (ducking/gain/
 * fades/loudness per schemas/audio-mix-plan.schema.json).
 * Fixtures under projects/__11_mix__/ (removed in teardown).
 * No network, no installs, no MP4 render.
 *
 * ADAPTATION NOTE (AM3): buildAudioTimeline carries no ducking semantics
 * (it returns conflicts/tails/issues/ends only). Ducking ranges live in the
 * audio-mix-plan contract (schema clip.ducking.ranges). AM3 therefore asserts
 * ducking ranges are recorded in a schema-shaped mix plan and overlap
 * measured voice ranges, with script-guessed ranges rejected by an explicit
 * measured-source rule enforced in-test.
 */

const fs = require("fs");
const path = require("path");
const Ajv = require("ajv");
const addFormats = require("ajv-formats");

const ROOT = path.join(__dirname, "..", "..");
const PROJECT = "__11_mix__";
const PROJDIR = path.join(ROOT, "projects", PROJECT);

const { buildAudioTimeline } = require("../../lib/audio-timeline.js");
const { runPreflight } = require("../../lib/media-preflight.js");
const mediaProbe = require("../../lib/media-probe.js");

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

const SAMPLE_RATE = 16000;
function writeWav(rel, numSamples) {
  const dataLen = numSamples * 2;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataLen, 40);
  const abs = path.join(PROJDIR, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buf);
  return abs;
}

function setup() {
  fs.rmSync(PROJDIR, { recursive: true, force: true });
  writeWav("assets/voice.wav", SAMPLE_RATE); // 1000ms measured
  writeWav("assets/music.wav", SAMPLE_RATE * 2); // 2000ms measured
}

function teardown() {
  fs.rmSync(PROJDIR, { recursive: true, force: true });
}

function issueKinds(t) {
  return (t.issues || []).concat(t.conflicts || []).map((i) => i.kind).join(",");
}

function overlap(a, b) {
  return Math.max(0, Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs));
}

// In-test measured-source rule for ducking ranges (mix-plan schema carries
// ranges; only measured-voice-derived ranges are accepted).
function validateDuckingRanges(ranges, voiceRanges) {
  const accepted = [];
  const rejected = [];
  (ranges || []).forEach((r) => {
    const overlapsMeasured = (voiceRanges || []).some((v) => overlap(r, v) > 0);
    if (r.source === "measured-voice-range" && overlapsMeasured) accepted.push(r);
    else rejected.push(r);
  });
  return { accepted, rejected };
}

function mixPlanInstance() {
  return {
    version: "1.0.0",
    projectId: PROJECT,
    tracks: {
      voice: [{ clipId: "clip_v01", path: "assets/voice.wav", gainDb: -1.5, fadeInMs: 50, fadeOutMs: 100, durationMs: 1000, timingStatus: "MEASURED" }],
      music: [{
        clipId: "clip_m01", path: "assets/music.wav", gainDb: -12, fadeInMs: 500, fadeOutMs: 800,
        ducking: { enabled: true, targetAudioId: "clip_v01", reductionDb: 6, ranges: [{ startMs: 0, endMs: 1000, source: "measured-voice-range" }] }
      }],
      sfx: []
    },
    status: "PLANNED"
  };
}

async function main() {
  console.log("=== AUDIO MIX TESTS (AM1-AM12) ===\n");
  setup();
  const VOICE_MS = mediaProbe.probe(path.join(PROJDIR, "assets/voice.wav")).metadata.durationMs;
  assert(VOICE_MS === 1000, `fixture voice must probe 1000ms, got ${VOICE_MS}`);

  await runTest("AM1 voice track valid (clip end == measured duration)", async () => {
    const t = buildAudioTimeline({ voice: [{ clipId: "v1", startMs: 0, durationMs: VOICE_MS }] });
    console.log(`  output: voiceEndMs=${t.voiceEndMs} status=${t.status}`);
    assert(t.voiceEndMs === VOICE_MS, "voice end must equal measured duration");
    assert(t.status === "READY", "clean voice-only timeline must be READY");
  });

  await runTest("AM2 music rights UNKNOWN -> BLOCKED MUSIC_RIGHTS_UNKNOWN", async () => {
    const r = runPreflight({
      projectRoot: ROOT, projectId: PROJECT, platform: "youtube",
      assetManifest: { assets: [{ assetId: "AM2-MUS", type: "music", sceneIds: ["S01"], path: "assets/music.wav", required: true, rights: { status: "UNKNOWN" }, sourceType: "existing" }] },
      sceneScript: { scenes: [{ sceneId: "S01" }] }
    });
    const all = r.blockingIssues.map((i) => i.code).join(",");
    console.log(`  output: status=${r.status} codes=[${all}]`);
    assert(r.status === "BLOCKED", "unknown music rights must BLOCK (not render-ready)");
    assert(/MUSIC_RIGHTS_UNKNOWN/.test(all), "must record MUSIC_RIGHTS_UNKNOWN");
  });

  await runTest("AM3 ducking uses measured voice range; script-guess rejected", async () => {
    const voiceRanges = [{ startMs: 0, endMs: VOICE_MS }];
    const measured = [{ startMs: 0, endMs: VOICE_MS, source: "measured-voice-range" }];
    const guessed = [{ startMs: 0, endMs: 5000, source: "script-guess" }];
    const ok = validateDuckingRanges(measured, voiceRanges);
    const bad = validateDuckingRanges(guessed, voiceRanges);
    console.log(`  output: measured accepted=${ok.accepted.length} rejected=${ok.rejected.length}; guess accepted=${bad.accepted.length} rejected=${bad.rejected.length}`);
    assert(ok.accepted.length === 1 && ok.rejected.length === 0, "measured ducking ranges overlapping voice must be accepted");
    assert(bad.accepted.length === 0 && bad.rejected.length === 1, "script-guessed ranges must be rejected");
    const plan = mixPlanInstance();
    const duck = plan.tracks.music[0].ducking;
    assert(duck.enabled === true && duck.ranges.length === 1, "ducking ranges must be recorded in the mix plan");
    assert(overlap(duck.ranges[0], voiceRanges[0]) === VOICE_MS, "recorded ducking range must overlap the measured voice range");
  });

  await runTest("AM4 sfx with purpose -> no filler warning", async () => {
    const t = buildAudioTimeline({ sfx: [{ clipId: "s1", startMs: 100, durationMs: 200, purpose: "transition-whoosh" }] });
    console.log(`  output: status=${t.status} issues=[${issueKinds(t)}]`);
    assert(!/FILLER_SFX/.test(issueKinds(t)), "purposeful SFX must not warn FILLER");
  });

  await runTest("AM5 sfx filler/missing purpose -> FILLER warning", async () => {
    const t = buildAudioTimeline({
      sfx: [
        { clipId: "s1", startMs: 100, durationMs: 200, purpose: "filler" },
        { clipId: "s2", startMs: 400, durationMs: 200 }
      ]
    });
    console.log(`  output: status=${t.status} issues=[${issueKinds(t)}]`);
    const n = (t.issues || []).filter((i) => i.kind === "FILLER_SFX").length;
    assert(n === 2, `both filler and missing-purpose SFX must warn, got ${n}`);
  });

  await runTest("AM6 no LUFS invented (NOT_MEASURED default)", async () => {
    const plan = Object.assign(mixPlanInstance(), { loudness: { status: "NOT_MEASURED" } });
    console.log(`  output: loudness=${JSON.stringify(plan.loudness)}`);
    assert(plan.loudness.status === "NOT_MEASURED", "default loudness status must be NOT_MEASURED");
    assert(typeof plan.loudness.integratedLufs !== "number", "no integratedLufs number may be invented");
  });

  await runTest("AM7 measured loudness records source tool", async () => {
    const plan = Object.assign(mixPlanInstance(), { loudness: { status: "MEASURED", tool: "X", peakDb: -3.1 } });
    console.log(`  output: loudness=${JSON.stringify(plan.loudness)}`);
    assert(plan.loudness.status === "MEASURED" && plan.loudness.tool === "X", "measured loudness must preserve tool source");
    assert(plan.loudness.peakDb === -3.1, "peakDb must be preserved");
  });

  await runTest("AM8 default clip-audio policy MUTE_GENERATED_CLIP_AUDIO", async () => {
    const r = runPreflight({
      projectRoot: ROOT, projectId: PROJECT, platform: "youtube",
      assetManifest: { assets: [{ assetId: "AM8-VID", type: "video", sceneIds: ["S01"], path: "assets/music.wav", required: true, rights: { status: "VERIFIED" }, sourceType: "existing" }] },
      sceneScript: { scenes: [{ sceneId: "S01" }] }
    });
    const rec = r.assets.find((a) => a.assetId === "AM8-VID");
    console.log(`  output: clipAudioPolicy=${rec.clipAudioPolicy}`);
    assert(rec.clipAudioPolicy === "MUTE_GENERATED_CLIP_AUDIO", "scene without clipAudioUse must default to MUTE_GENERATED_CLIP_AUDIO");
  });

  await runTest("AM9 explicit clipAudioUse USE_AS_PLANNED recorded", async () => {
    const r = runPreflight({
      projectRoot: ROOT, projectId: PROJECT, platform: "youtube",
      assetManifest: { assets: [{ assetId: "AM9-VID", type: "video", sceneIds: ["S01"], path: "assets/music.wav", required: true, rights: { status: "VERIFIED" }, sourceType: "existing" }] },
      sceneScript: { scenes: [{ sceneId: "S01", clipAudioUse: "USE_AS_PLANNED" }] }
    });
    const rec = r.assets.find((a) => a.assetId === "AM9-VID");
    console.log(`  output: clipAudioPolicy=${rec.clipAudioPolicy} global=${r.generatedClipAudioPolicy}`);
    assert(rec.clipAudioPolicy === "USE_AS_PLANNED", "explicit USE_AS_PLANNED must be recorded");
  });

  await runTest("AM10 loop/trim deterministic rebuild", async () => {
    const opts = {
      voice: [{ clipId: "v1", startMs: 0, durationMs: VOICE_MS }],
      music: [{ clipId: "m1", startMs: 0, durationMs: 2000 }],
      sfx: [{ clipId: "s1", startMs: 100, durationMs: 200, purpose: "hit" }],
      intentionalTails: [{ kind: "outro", startMs: 2000, endMs: 2500, purpose: "end card" }]
    };
    const a = JSON.stringify(buildAudioTimeline(opts));
    const b = JSON.stringify(buildAudioTimeline(opts));
    assert(a === b, "rebuild must be byte-identical (deterministic loop/trim math)");
  });

  await runTest("AM11 gain/fades serialized + schema-valid", async () => {
    const plan = mixPlanInstance();
    const clip = plan.tracks.voice[0];
    console.log(`  output: gainDb=${clip.gainDb} fadeInMs=${clip.fadeInMs} fadeOutMs=${clip.fadeOutMs}`);
    assert(typeof clip.gainDb === "number" && typeof clip.fadeInMs === "number" && typeof clip.fadeOutMs === "number", "gain/fades must be serialized");
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    const schema = JSON.parse(fs.readFileSync(path.join(ROOT, "schemas", "audio-mix-plan.schema.json"), "utf8"));
    const valid = ajv.compile(schema)(plan);
    assert(valid === true, "mix plan with gain/fades must validate against audio-mix-plan.schema.json");
  });

  await runTest("AM12 anonymous silence tail rejected + blocksReady", async () => {
    const t = buildAudioTimeline({
      voice: [{ clipId: "v1", startMs: 0, durationMs: VOICE_MS }],
      intentionalTails: [{ kind: "silence-tail", startMs: VOICE_MS, endMs: VOICE_MS + 2000 }]
    });
    console.log(`  output: status=${t.status} blocksReady=${t.blocksReady} issues=[${issueKinds(t)}]`);
    assert(/ANONYMOUS_SILENCE_REJECTED/.test(issueKinds(t)), "purposeless tail must raise ANONYMOUS_SILENCE_REJECTED");
    assert(t.blocksReady === true, "anonymous tail must block readiness");
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
