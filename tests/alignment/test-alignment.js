"use strict";

/**
 * Phase 2.9 tests — forced alignment: known-text word timing, invariants,
 * speaker/pronunciation preservation, local re-alignment, invalidation,
 * final-audio temporal validation.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const REPO = path.join(__dirname, "..", "..");
const alignment = require(REPO + "/lib/alignment/index.js");
const wav = require(REPO + "/lib/audio-wav.js");
const H = require(REPO + "/tests/fixtures/audio-synth.js");

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

/** 3 segments × word-burst audio on a shared timeline. */
function makeRequest({ tmp, speakers = false, secondSegmentSilent = false } = {}) {
  const groups = [
    ["Cá", "thể", "hoang", "dã", "không", "thể", "sống", "khỏe."],
    ["Chúng", "cần", "thức", "ăn", "và", "nước", "sạch", "mỗi", "ngày."],
    ["Hãy", "giúp", "đàn", "cá", "hồi", "phục", "ngay", "hôm", "nay."],
  ];
  const segments = [];
  let t = 0;
  for (let i = 0; i < groups.length; i += 1) {
    const p = path.join(tmp, `seg${i}.wav`);
    if (secondSegmentSilent && i === 1) {
      fs.writeFileSync(p, wav.encodeWav(new Int16Array(Math.round(2.5 * H.FS)), H.FS, 1));
    } else {
      fs.writeFileSync(p, H.makeWordSpeechWav({ wordCount: groups[i].length, wordDurationMs: 400, pauseMs: 300 }));
    }
    const expectedEndMs = t + 150 + groups[i].length * 400 + (groups[i].length - 1) * 300 + 200;
    segments.push({
      segmentId: `s${i}`,
      ...(speakers ? { speakerId: i === 2 ? "expert" : "narrator" } : {}),
      text: groups[i].join(" "),
      audioRef: p,
      expectedStartMs: t,
      expectedEndMs,
    });
    t = expectedEndMs + 500;
  }
  return {
    projectId: "p1",
    language: "vi",
    transcriptVersion: "fss@v1",
    narrationTimingHash: "nth-0123456789abcdef",
    segments,
  };
}

function makeTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "unfoldiq-align-"));
}

(async () => {
await runTest("A1 happy path: coverage 1.0, QA PASS, schema-valid", async () => {
  const tmp = makeTmp();
  const r = alignment.align(makeRequest({ tmp }), { readAudio: (p) => fs.readFileSync(p) });
  assert(r.ok, "align ok: " + (r.message || ""));
  assertEq(r.artifact.metrics.coverageRatio, 1, "full coverage");
  assertEq(r.artifact.qaStatus, "PASS", "QA PASS");
  const v = alignment.validateArtifact(r.artifact);
  assert(v.ok, "schema valid: " + v.errors);
  assert(r.artifact.metrics.alignLatencyMs >= 0, "latency recorded");
});

await runTest("A2 word timing monotonic, positive, inside segment bounds", async () => {
  const tmp = makeTmp();
  const req = makeRequest({ tmp });
  const r = alignment.align(req, { readAudio: (p) => fs.readFileSync(p) });
  const { words } = r.artifact;
  for (let i = 0; i < words.length; i += 1) {
    assert(words[i].endMs > words[i].startMs, `positive duration ${words[i].text}`);
    if (i > 0 && words[i].segmentId === words[i - 1].segmentId) {
      assert(words[i].startMs >= words[i - 1].endMs - 20, `monotonic at ${words[i].text}`);
    }
  }
  for (const seg of req.segments) {
    const segWords = words.filter((w) => w.segmentId === seg.segmentId);
    assert(segWords[0].startMs >= seg.expectedStartMs - 250, `starts within bound ${seg.segmentId}`);
    assert(segWords[segWords.length - 1].endMs <= seg.expectedEndMs + 250, `ends within bound ${seg.segmentId}`);
  }
});

await runTest("A3 1:1 run mapping → high confidence; phrases split at punctuation", async () => {
  const tmp = makeTmp();
  const r = alignment.align(makeRequest({ tmp }), { readAudio: (p) => fs.readFileSync(p) });
  const confidences = r.artifact.words.map((w) => w.confidence);
  assert(Math.max(...confidences) >= 0.85, `run-matched confidence high (${Math.max(...confidences)})`);
  const phraseEnds = r.artifact.phrases.filter((p) => p.segmentId === "s0");
  const lastWords = r.artifact.words.filter((w) => w.segmentId === "s0").slice(-1);
  assertEq(phraseEnds[phraseEnds.length - 1].wordIds[phraseEnds[phraseEnds.length - 1].wordIds.length - 1], lastWords[0].wordId, "phrase ends at sentence word");
  assert(r.artifact.phrases.length >= 3, `phrases built (${r.artifact.phrases.length})`);
});

await runTest("A4 speaker ownership preserved verbatim (no diarization)", async () => {
  const tmp = makeTmp();
  const r = alignment.align(makeRequest({ tmp, speakers: true }), { readAudio: (p) => fs.readFileSync(p) });
  const expert = r.artifact.words.filter((w) => w.segmentId === "s2");
  assert(expert.every((w) => w.speakerId === "expert"), "expert words keep speaker");
  const narrator = r.artifact.words.filter((w) => w.segmentId === "s0");
  assert(narrator.every((w) => w.speakerId === "narrator"), "narrator words keep speaker");
});

await runTest("A5 missing audio → UNALIGNED + REVIEW_REQUIRED, never fabricated timing", async () => {
  const tmp = makeTmp();
  const req = makeRequest({ tmp });
  req.segments[1].audioRef = path.join(tmp, "missing.wav");
  const r = alignment.align(req, { readAudio: (p) => fs.existsSync(p) ? fs.readFileSync(p) : null });
  assert(r.ok, "align completes honestly");
  const segWords = r.artifact.words.filter((w) => w.segmentId === "s1");
  assert(segWords.every((w) => w.status === "UNALIGNED"), "all words unaligned");
  assert(r.artifact.qaStatus !== "PASS", "not a silent PASS: " + r.artifact.qaStatus);
  assert(r.artifact.qa.findings.some((f) => f.code === "UNALIGNED_WORD"), "structured finding");
});

await runTest("A6 silent audio → UNALIGNED (no ASR substitution)", async () => {
  const tmp = makeTmp();
  const r = alignment.align(makeRequest({ tmp, secondSegmentSilent: true }), { readAudio: (p) => fs.readFileSync(p) });
  const segWords = r.artifact.words.filter((w) => w.segmentId === "s1");
  assert(segWords.every((w) => w.status === "UNALIGNED"), "silent segment words unaligned");
  assertEq(segWords[0].text, "Chúng", "canonical text preserved verbatim");
  assert(r.artifact.metrics.coverageRatio < 1, "coverage reflects reality");
});

await runTest("A7 local re-alignment: only affected segment changes, others byte-stable", async () => {
  const tmp = makeTmp();
  const req = makeRequest({ tmp, speakers: true });
  const first = alignment.align(req, { readAudio: (p) => fs.readFileSync(p) });
  assert(first.ok, "baseline");
  // Regenerate segment 1 with different pacing → new audio file.
  const regenPath = path.join(tmp, "seg1-regen.wav");
  fs.writeFileSync(regenPath, H.makeWordSpeechWav({ wordCount: 9, wordDurationMs: 250, pauseMs: 200 }));
  const req2 = JSON.parse(JSON.stringify(req));
  req2.segments[1].audioRef = regenPath;
  req2.segments[1].expectedEndMs = req2.segments[1].expectedStartMs + 150 + 9 * 250 + 8 * 200 + 200;
  const r2 = alignment.realignSegments(first.artifact, req2, ["s1"], { readAudio: (p) => fs.readFileSync(p) });
  assert(r2.ok, "realign ok: " + (r2.message || ""));
  assertEq(r2.artifact.metrics.localRealignCount, 1, "local realign counted");
  const before0 = first.artifact.words.filter((w) => w.segmentId === "s0").map((w) => `${w.text}@${w.startMs}-${w.endMs}`).join("|");
  const after0 = r2.artifact.words.filter((w) => w.segmentId === "s0").map((w) => `${w.text}@${w.startMs}-${w.endMs}`).join("|");
  assertEq(after0, before0, "s0 timing untouched");
  const before2 = first.artifact.words.filter((w) => w.segmentId === "s2").map((w) => `${w.text}@${w.startMs}-${w.endMs}`).join("|");
  const after2 = r2.artifact.words.filter((w) => w.segmentId === "s2").map((w) => `${w.text}@${w.startMs}-${w.endMs}`).join("|");
  assertEq(after2, before2, "s2 timing untouched");
  const newS1 = r2.artifact.words.filter((w) => w.segmentId === "s1");
  assert(newS1[newS1.length - 1].endMs < first.artifact.words.filter((w) => w.segmentId === "s1").slice(-1)[0].endMs, "s1 re-timed to regenerated audio");
});

await runTest("A8 invalidation: mix-only change keeps alignment clean; timing change dirties", async () => {
  const mixOnly = alignment.resolveAlignmentInvalidation({
    prevNarrationTimingHash: "nth-1", nextNarrationTimingHash: "nth-1",
    prevFinalMixHash: "fmh-1", nextFinalMixHash: "fmh-2",
  });
  assertEq(mixOnly.alignmentDirty, false, "mix-only → alignment CLEAN");
  assertEq(mixOnly.mixOnlyChange, true, "classified as mix-only");
  const timing = alignment.resolveAlignmentInvalidation({
    prevNarrationTimingHash: "nth-1", nextNarrationTimingHash: "nth-2",
    prevFinalMixHash: "fmh-1", nextFinalMixHash: "fmh-2",
  });
  assertEq(timing.alignmentDirty, true, "timing change → alignment DIRTY");
});

await runTest("A9 final-audio temporal validation: overflow + narration-range checks", async () => {
  const tmp = makeTmp();
  const r = alignment.align(makeRequest({ tmp }), { readAudio: (p) => fs.readFileSync(p) });
  const lastEnd = Math.max(...r.artifact.words.map((w) => w.endMs));
  const ok = alignment.validateAgainstFinalAudio(r.artifact, { finalAudioDurationMs: lastEnd + 5000 });
  assertEq(ok.status, "PASS", "inside final audio");
  const over = alignment.validateAgainstFinalAudio(r.artifact, { finalAudioDurationMs: Math.round(lastEnd / 2) });
  assert(over.findings.some((f) => f.code === "FINAL_AUDIO_OVERFLOW"), "overflow detected");
  const ranges = reqRanges(r.artifact);
  const inRange = alignment.validateAgainstFinalAudio(r.artifact, { finalAudioDurationMs: lastEnd + 5000, narrationRanges: ranges });
  assertEq(inRange.status, "PASS", "words inside narration ranges");
  const shifted = ranges.map((x) => ({ startMs: x.startMs + 100000, endMs: x.endMs + 100000 }));
  const outRange = alignment.validateAgainstFinalAudio(r.artifact, { finalAudioDurationMs: lastEnd + 5000, narrationRanges: shifted });
  assert(outRange.findings.some((f) => f.code === "WORD_OUTSIDE_NARRATION_RANGE"), "outside-range detected");
});

function reqRanges(artifact) {
  const bySeg = new Map();
  for (const w of artifact.words) {
    const cur = bySeg.get(w.segmentId) || { startMs: w.startMs, endMs: w.endMs };
    cur.startMs = Math.min(cur.startMs, w.startMs);
    cur.endMs = Math.max(cur.endMs, w.endMs);
    bySeg.set(w.segmentId, cur);
  }
  return [...bySeg.values()];
}

await runTest("A10 injected overlap/drift flagged by QA", async () => {
  const tmp = makeTmp();
  const r = alignment.align(makeRequest({ tmp }), { readAudio: (p) => fs.readFileSync(p) });
  const bad = JSON.parse(JSON.stringify(r.artifact));
  bad.words[1].startMs = bad.words[0].startMs; // force overlap
  bad.words[1].endMs = bad.words[0].endMs + 10;
  const qa = alignment.alignmentQA(bad, {});
  assert(qa.findings.some((f) => f.code === "TIMING_OVERLAP"), "overlap detected");
  const drift = JSON.parse(JSON.stringify(r.artifact));
  for (let i = 5; i < drift.words.length; i += 1) { drift.words[i].startMs += 3000; drift.words[i].endMs += 3000; }
  const qa2 = alignment.alignmentQA(drift, {});
  assert(qa2.findings.some((f) => f.code === "ALIGNMENT_DRIFT"), "drift/gap detected");
});

await runTest("A11 canonical text is never rewritten by alignment", async () => {
  const tmp = makeTmp();
  const req = makeRequest({ tmp, secondSegmentSilent: true });
  const r = alignment.align(req, { readAudio: (p) => fs.readFileSync(p) });
  const inputWords = req.segments.flatMap((s) => s.text.split(/\s+/));
  const outWords = r.artifact.words.map((w) => w.text);
  assertEq(outWords.join(" "), inputWords.join(" "), "word text identical to canonical input");
});

await runTest("A12 unknown provider rejected with canonical error", async () => {
  const tmp = makeTmp();
  const r = alignment.align(makeRequest({ tmp }), { providerId: "whisperx-ghost", readAudio: (p) => fs.readFileSync(p) });
  assertEq(r.ok, false, "rejected");
  assertEq(r.code, "UNKNOWN_PROVIDER", "canonical code");
});

console.log(`\n=== alignment: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
})();
