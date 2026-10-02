"use strict";
// STEP-13 Branch C — visual QA evidence tests VE1-VE10 via qa/frame-sampler.js
// + qa/contact-sheet.js + qa/visual-qa.js on a 4s fixture mp4.

const fs = require("fs");
const path = require("path");
const child_process = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const PID = "__13_ve__";
const Sampler = require("../../qa/frame-sampler.js");
const Sheet = require("../../qa/contact-sheet.js");
const Visual = require("../../qa/visual-qa.js");

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
function projDir() { return path.join(ROOT, "projects", PID); }
function media(name) { return path.join(projDir(), "media", name); }
function out(name) { return path.join(projDir(), "out", name); }
function cleanup() {
  try { fs.rmSync(projDir(), { recursive: true, force: true }); } catch (e) {}
  try { fs.rmSync(path.join(ROOT, "out", PID), { recursive: true, force: true }); } catch (e) {}
}

cleanup();
fs.mkdirSync(path.join(projDir(), "media"), { recursive: true });
{
  const r = child_process.spawnSync("ffmpeg", ["-y", "-f", "lavfi", "-i",
    "color=c=0x1a2b3c:s=640x360:r=30:d=4",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=4",
    "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", media("clip.mp4")],
    { encoding: "utf8", timeout: 120000 });
  assert(r.status === 0, "fixture mp4 built");
}

const scenes = [
  { startMs: 0, endMs: 2000, sceneId: "S01" },
  { startMs: 2000, endMs: 4000, sceneId: "S02" }
];
const captions = [
  { startMs: 100, endMs: 900, text: "one" },
  { startMs: 1000, endMs: 1900, text: "two" },
  { startMs: 2100, endMs: 3900, text: "three" }
];
const transitions = [{ atMs: 2000 }];
const planned = Sampler.planTimestamps({ durationMs: 4000, scenes: scenes,
  captions: captions, transitions: transitions });
const got = Sampler.sampleFrames({ videoPath: media("clip.mp4"),
  timestampsMs: planned, outDir: out("frames"), prefix: "ve" });
const samples = got.samples.map((s, i) => Object.assign({}, s, { label: "ve-" + (i + 1) }));
const sheet = Sheet.buildContactSheet({ samples: samples, outPath: out("contact"), columns: 4 });

runTest("VE1 first-frame sample exists (t=0)", () => {
  assert(planned.indexOf(0) !== -1, "plan includes 0");
  const f = samples.filter((s) => s.timestampMs === 0)[0];
  assert(f && fs.existsSync(f.framePath), "t=0 frame extracted");
});

runTest("VE2 last-frame sample exists", () => {
  const last = planned[planned.length - 1];
  assert(last >= 3900, "plan reaches the tail, got " + last);
  const f = samples.filter((s) => s.timestampMs === last)[0];
  assert(f && fs.existsSync(f.framePath), "last frame extracted");
});

runTest("VE3 scene midpoints sampled", () => {
  [1000, 3000].forEach((mid) => {
    const f = samples.filter((s) => s.timestampMs === mid)[0];
    assert(f && fs.existsSync(f.framePath), "midpoint " + mid + "ms extracted");
  });
});

runTest("VE4 transition boundary sampled", () => {
  assert(planned.indexOf(2000) !== -1, "plan includes transition atMs=2000");
  const f = samples.filter((s) => s.timestampMs === 2000)[0];
  assert(f && fs.existsSync(f.framePath), "transition frame extracted");
});

runTest("VE5 contact sheet html exists with count", () => {
  assert(fs.existsSync(sheet.sheetPath), "sheet html written: " + sheet.sheetPath);
  assert(sheet.count === samples.length && sheet.count > 0, "count=" + sheet.count);
  const html = fs.readFileSync(sheet.sheetPath, "utf8");
  assert(html.indexOf("<img") !== -1, "thumbnails embedded");
});

runTest("VE6 scene/timestamp mapping in packet", () => {
  const sceneMap = scenes.map((s) => ({ sceneId: s.sceneId, startMs: s.startMs, endMs: s.endMs }));
  const built = Visual.buildReviewPacket({ projectRoot: ROOT, projectId: PID,
    attempt: { attemptId: "attempt-001" },
    technicalQa: { status: "PASS", checks: [] },
    samples: samples, contactSheet: sheet, sceneMap: sceneMap });
  assert(fs.existsSync(built.packetPath), "packet persisted");
  assert(JSON.stringify(built.packet.sceneTimeMapping) === JSON.stringify(sceneMap), "mapping echoed");
  assert(built.packet.sampledFrames.length === samples.length, "frames listed");
});

runTest("VE7 long-video plan bounded (12min -> <=MAX_SAMPLES)", () => {
  const manyScenes = [];
  for (let i = 0; i < 48; i++) {
    manyScenes.push({ startMs: i * 15000, endMs: (i + 1) * 15000, sceneId: "S" + (i + 1) });
  }
  const plan = Sampler.planTimestamps({ durationMs: 720000, scenes: manyScenes });
  assert(plan.length <= Sampler.MAX_SAMPLES,
    "bounded: " + plan.length + " <= " + Sampler.MAX_SAMPLES);
  assert(plan[0] === 0, "first kept");
});

runTest("VE8 packet reviewState MACHINE_CHECKED, no semantic PASS claim", () => {
  const built = Visual.buildReviewPacket({ projectRoot: ROOT, projectId: PID,
    attempt: { attemptId: "attempt-001" }, technicalQa: { status: "PASS", checks: [] },
    samples: samples, contactSheet: sheet });
  assert(built.packet.reviewState === "MACHINE_CHECKED", "machine state");
  const raw = JSON.stringify(built.packet);
  assert(raw.indexOf("AGENT_REVIEWED") === -1, "never agent-reviewed by builder");
  assert(raw.indexOf("aesthetic") === -1, "no aesthetic claims");
  built.packet.reviewChecklist.forEach((c) => {
    assert(c.status === "PENDING", "checklist pending: " + c.item);
  });
  assert(built.packet.reviewChecklist.length === 5, "5 checklist items");
});

runTest("VE9 packet key fields present (attemptId, frames, checklist, issues)", () => {
  const built = Visual.buildReviewPacket({ projectRoot: ROOT, projectId: PID,
    attempt: { attemptId: "attempt-001" },
    technicalQa: { status: "FAIL", checks: [{ check: "dims-match", result: "FAIL", detail: "x" }] },
    samples: samples, contactSheet: sheet, sceneMap: [] });
  assert(typeof built.packet.attemptId === "string", "attemptId");
  assert(Array.isArray(built.packet.sampledFrames), "sampledFrames");
  assert(Array.isArray(built.packet.reviewChecklist), "reviewChecklist");
  assert(built.packet.technicalIssues.length === 1, "technical issue carried");
  assert(Visual.REVIEW_STATES.indexOf(built.packet.reviewState) !== -1, "known review state");
});

runTest("VE10 no external upload (source scan sampler/contact-sheet)", () => {
  const re = /https?:|fetch\s*\(|upload\s*\(|XMLHttpRequest/i;
  ["qa/frame-sampler.js", "qa/contact-sheet.js", "qa/visual-qa.js"].forEach((rel) => {
    const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n")
      .filter((ln) => !/^\s*\/\//.test(ln)).join("\n");
    assert(!re.test(code), "no network/upload calls in " + rel);
  });
});

cleanup();

console.log("\n=== SUMMARY test-visual-qa-evidence VE1-VE10 ===");
console.log("passed=" + passed + " failed=" + failed);
console.log(failed === 0 ? "RESULT: PASS" : "RESULT: FAIL");
process.exit(failed === 0 ? 0 : 1);
