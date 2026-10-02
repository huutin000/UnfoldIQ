"use strict";
// STEP-13 Branch C — media QA tests MQ1-MQ8 via qa/black-frame-check.js +
// qa/silence-check.js (ffmpeg present). Fixtures under projects/__13_mq__/.

const fs = require("fs");
const path = require("path");
const child_process = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const PID = "__13_mq__";
const Black = require("../../qa/black-frame-check.js");
const Silence = require("../../qa/silence-check.js");

let passed = 0;
let failed = 0;
function runTest(name, fn) {
  console.log("[TEST] " + name);
  try {
    fn();
    console.log("[PASS] " + name);
    passed++;
  } catch (e) {
    console.log("[FAIL] " + name + ": " + ((e && e.stack) || (e && e.message) || String(e)));
    failed++;
  }
}
function assert(c, m) { if (!c) throw new Error("ASSERT: " + m); }
function mediaDir() { return path.join(ROOT, "projects", PID, "media"); }
function media(name) { return path.join(mediaDir(), name); }
function ff(args) {
  const r = child_process.spawnSync("ffmpeg", args, { encoding: "utf8", timeout: 120000 });
  assert(r.status === 0, "ffmpeg exit 0, stderr=" + (r.stderr || "").slice(-300));
}
function wavWithGap() {
  // 5s mono 16kHz: 0.5s sine, 3.5s digital silence, 1s sine.
  const sr = 16000;
  const segs = [{ ms: 500, tone: true }, { ms: 3500, tone: false }, { ms: 1000, tone: true }];
  const parts = [];
  segs.forEach((sg) => {
    const n = Math.floor((sr * sg.ms) / 1000);
    const data = Buffer.alloc(n * 2);
    for (let i = 0; i < n; i++) {
      const v = sg.tone ? Math.round(16000 * Math.sin((2 * Math.PI * 440 * i) / sr)) : 0;
      data.writeInt16LE(v, i * 2);
    }
    parts.push(data);
  });
  const data = Buffer.concat(parts);
  const head = Buffer.alloc(44);
  head.write("RIFF", 0); head.writeUInt32LE(36 + data.length, 4); head.write("WAVE", 8);
  head.write("fmt ", 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22); head.writeUInt32LE(sr, 24); head.writeUInt32LE(sr * 2, 28);
  head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write("data", 36);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}
function wavIntroSilence() {
  // 3s: 1s silence then 2s sine.
  const sr = 16000;
  const mk = (ms, tone) => {
    const n = Math.floor((sr * ms) / 1000);
    const data = Buffer.alloc(n * 2);
    for (let i = 0; i < n; i++) {
      const v = tone ? Math.round(16000 * Math.sin((2 * Math.PI * 440 * i) / sr)) : 0;
      data.writeInt16LE(v, i * 2);
    }
    return data;
  };
  const data = Buffer.concat([mk(1000, false), mk(2000, true)]);
  const head = Buffer.alloc(44);
  head.write("RIFF", 0); head.writeUInt32LE(36 + data.length, 4); head.write("WAVE", 8);
  head.write("fmt ", 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22); head.writeUInt32LE(sr, 24); head.writeUInt32LE(sr * 2, 28);
  head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write("data", 36);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}
function withEmptyPath(fn) {
  const emptyBin = path.join(ROOT, "projects", PID, "empty-bin");
  fs.mkdirSync(emptyBin, { recursive: true });
  const saved = process.env.PATH;
  process.env.PATH = emptyBin;
  try {
    return fn();
  } finally {
    process.env.PATH = saved;
  }
}
function cleanup() {
  try { fs.rmSync(path.join(ROOT, "projects", PID), { recursive: true, force: true }); } catch (e) {}
  try { fs.rmSync(path.join(ROOT, "out", PID), { recursive: true, force: true }); } catch (e) {}
}

cleanup();
fs.mkdirSync(mediaDir(), { recursive: true });
ff(["-y", "-f", "lavfi", "-i", "color=c=black:s=320x240:r=30:d=2",
  "-pix_fmt", "yuv420p", media("black2s.mp4")]);
ff(["-y", "-f", "lavfi", "-i", "color=c=black:s=320x240:r=30:d=3",
  "-pix_fmt", "yuv420p", media("black3s.mp4")]);
// Adapted: spec example 0x111111 has luma 17 < pix_th 0.10*255=25.5, so
// blackdetect correctly flags it as black. 0x333333 (luma 51) exercises the
// dark-but-not-black path the test intends.
ff(["-y", "-f", "lavfi", "-i", "color=c=0x333333:s=320x240:r=30:d=2",
  "-pix_fmt", "yuv420p", media("dark.mp4")]);
fs.writeFileSync(media("gap.wav"), wavWithGap());
fs.writeFileSync(media("intro.wav"), wavIntroSilence());

runTest("MQ1 intentional black range (covered) -> PASS", () => {
  const r = Black.checkBlackFrames({ videoPath: media("black2s.mp4"),
    intentionalRanges: [{ startMs: 0, endMs: 2000, label: "fade-to-black" }] });
  assert(r.status === "PASS", "PASS, got " + r.status + " " + r.detail);
  assert(r.regions.length > 0 && r.regions.every((x) => x.intentional),
    "regions marked intentional");
});

runTest("MQ2 unexpected black tail (3s pure black) -> FAIL", () => {
  const r = Black.checkBlackFrames({ videoPath: media("black3s.mp4") });
  assert(r.status === "FAIL", "FAIL, got " + r.status + " " + r.detail);
  assert(r.regions.length > 0, "regions detected");
});

runTest("MQ3 dark scene (0x333333, not pure black) -> never FAIL", () => {
  const r = Black.checkBlackFrames({ videoPath: media("dark.mp4") });
  assert(r.status === "PASS" || r.status === "REVIEW",
    "PASS or REVIEW, got " + r.status + " " + r.detail);
  assert(r.status !== "FAIL", "dark gray must not blindly FAIL");
});

runTest("MQ4 intentional silence (planned coverage) -> accepted", () => {
  const r = Silence.checkSilence({ audioPath: media("gap.wav"),
    voiceRanges: [{ startMs: 0, endMs: 5000 }],
    plannedSilence: [{ startMs: 400, endMs: 4100, label: "dramatic pause" }] });
  assert(r.status === "PASS", "PASS, got " + r.status + " " + r.detail);
});

runTest("MQ5 unexpected narration silence (3.5s gap in voice) -> detected", () => {
  const r = Silence.checkSilence({ audioPath: media("gap.wav"),
    voiceRanges: [{ startMs: 0, endMs: 5000 }] });
  assert(r.status === "FAIL" || r.status === "REVIEW",
    "detected, got " + r.status + " " + r.detail);
  assert(r.silentRegions.length > 0, "silent regions reported");
});

runTest("MQ6 silence outside voice ranges (intro gap) -> PASS", () => {
  const r = Silence.checkSilence({ audioPath: media("intro.wav"),
    voiceRanges: [{ startMs: 1000, endMs: 3000 }] });
  assert(r.status === "PASS", "PASS, got " + r.status + " " + r.detail);
});

runTest("MQ7 time ranges recorded (startMs/endMs on regions)", () => {
  const b = Black.checkBlackFrames({ videoPath: media("black3s.mp4") });
  assert(b.regions.length > 0, "black regions present");
  b.regions.forEach((x) => {
    assert(typeof x.startMs === "number" && typeof x.endMs === "number", "black range times");
    assert(x.endMs > x.startMs, "positive duration");
  });
  const s = Silence.checkSilence({ audioPath: media("gap.wav"),
    voiceRanges: [{ startMs: 0, endMs: 5000 }] });
  assert(s.silentRegions.length > 0, "silence regions present");
  s.silentRegions.forEach((x) => {
    assert(typeof x.startMs === "number" && typeof x.endMs === "number", "silence range times");
  });
});

runTest("MQ8 analyzer missing -> UNKNOWN, never PASS", () => {
  const b = withEmptyPath(() => Black.checkBlackFrames({ videoPath: media("black3s.mp4") }));
  assert(b.status === "UNKNOWN", "black UNKNOWN, got " + b.status);
  assert(/ANALYZER_UNAVAILABLE/.test(b.detail), "detail names cause");
  const s = withEmptyPath(() => Silence.checkSilence({ audioPath: media("gap.wav"),
    voiceRanges: [{ startMs: 0, endMs: 5000 }] }));
  assert(s.status === "UNKNOWN", "silence UNKNOWN, got " + s.status);
});

cleanup();

console.log("\n=== SUMMARY test-render-media-qa MQ1-MQ8 ===");
console.log("passed=" + passed + " failed=" + failed);
console.log(failed === 0 ? "RESULT: PASS" : "RESULT: FAIL");
process.exit(failed === 0 ? 0 : 1);
