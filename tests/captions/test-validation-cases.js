"use strict";

/**
 * Phase 2.11-G — Minimum validation scenarios (spec §19, Cases A–L) on a
 * ~2.5-minute production through the REAL chain: word-burst narration stems
 * → known-text alignment → caption build → QA → SRT/VTT → render manifest.
 * No mocks: audio bytes are real decoded PCM; timings measured from them.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const REPO = path.join(__dirname, "..", "..");
const alignment = require(REPO + "/lib/alignment/index.js");
const captions = require(REPO + "/lib/captions/index.js");
const H = require(REPO + "/tests/fixtures/audio-synth.js");

const PROF = "vi-longform-benchmark@1.0.0";
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

// ---- ~2.5 minute canonical narration: 12 segments over ~150s ---------------
const SEG_TEXTS = [
  "Rừng ngầm đang biến mất từng ngày.",
  "Rạn san hô lớn nhất thế giới mất một nửa số cá thể.",
  "Nhiệt độ đại dương tăng nhanh hơn mọi dự báo.",
  "Loài cá nhỏ nhất cũng cảm nhận được thay đổi này.",
  "Khoa học gọi hiện tượng này là whitening có điều kiện.",
  "Các rạn san hô không thể sống khỏe mãi.",
  "Chúng cần thức ăn và nước sạch mỗi ngày.",
  "Nhiễm trùng lan nhanh khi nhiệt độ tăng.",
  "Người dân ven biển mất nguồn sống.",
  "Kinh tế địa phương tụt giảm nghiêm trọng.",
  "Nhưng còn một cơ hội cuối cùng.",
  "Hãy hành động ngay hôm nay.",
];

function buildNarration(tmp, { silentSegments = [], speakerFor = () => "narrator", wordMs = 700, pauseMs = 500 } = {}) {
  const segments = [];
  let t = 0;
  for (let i = 0; i < SEG_TEXTS.length; i += 1) {
    const words = SEG_TEXTS[i].split(/\s+/);
    const p = path.join(tmp, `seg${i}.wav`);
    if (silentSegments.includes(i)) {
      fs.writeFileSync(p, H.encodeSilentWav(150 + words.length * wordMs + (words.length - 1) * pauseMs + 200));
    } else {
      fs.writeFileSync(p, H.makeWordSpeechWav({ wordCount: words.length, wordDurationMs: wordMs, pauseMs }));
    }
    const expectedEndMs = t + 150 + words.length * wordMs + (words.length - 1) * pauseMs + 200;
    segments.push({
      segmentId: `s${i}`,
      speakerId: speakerFor(i),
      text: SEG_TEXTS[i],
      audioRef: p,
      expectedStartMs: t,
      expectedEndMs,
    });
    t = expectedEndMs + 500;
  }
  return segments;
}

function makeTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "unfoldiq-case-"));
}

function alignAll(segments, opts = {}) {
  const r = alignment.align({
    projectId: "validation",
    language: "vi",
    transcriptVersion: "fss@v2",
    narrationTimingHash: "nth-validation0000",
    segments,
  }, { readAudio: (p) => fs.readFileSync(p), ...opts });
  if (!r.ok) throw new Error(r.message || r.code);
  return r;
}

function buildCaptionPack(al, { mode = "DIALOGUE_ONLY", nonSpeechEvents = [] } = {}) {
  const r = captions.buildCaptions({
    projectId: "validation",
    alignment: al,
    profileRef: PROF,
    mode,
    speakerLabels: { narrator: "Người kể", expert: "Chuyên gia" },
    nonSpeechEvents,
  });
  if (!r.ok) throw new Error(r.message || r.code);
  return r;
}

(async () => {
await runTest("Case A — single narrator: full chain PASS with SRT/VTT", async () => {
  const tmp = makeTmp();
  const segs = buildNarration(tmp);
  assert(segs.reduce((n, s) => n + s.expectedEndMs - s.expectedStartMs, 0) > 120000, "production ≥ 2 minutes");
  const al = alignAll(segs);
  assertEq(al.artifact.qaStatus, "PASS", "alignment PASS");
  const cap = buildCaptionPack(al.artifact);
  assertEq(cap.artifact.qaStatus, "PASS", "captions PASS: " + JSON.stringify(cap.artifact.qa.findings));
  const srt = captions.validateExportRoundTrip(cap.artifact, "srt");
  const vtt = captions.validateExportRoundTrip(cap.artifact, "vtt");
  assert(srt.ok && vtt.ok, "SRT + VTT round-trip PASS");
});

await runTest("Case B — known multi-speaker: ownership preserved, no diarization", async () => {
  const tmp = makeTmp();
  const segs = buildNarration(tmp, { speakerFor: (i) => (i === 11 ? "expert" : "narrator") });
  const al = alignAll(segs);
  const expertWords = al.artifact.words.filter((w) => w.segmentId === "s11");
  assert(expertWords.every((w) => w.speakerId === "expert"), "speaker metadata preserved verbatim");
  const cap = buildCaptionPack(al.artifact);
  const expertCue = cap.artifact.events.find((e) => e.speakerId === "expert");
  assert(expertCue && expertCue.speakerLabel === "Chuyên gia", "speaker label rendered");
  assert(!al.artifact.provider.id.includes("diariz"), "no diarization dependency");
});

await runTest("Case C — proper noun/pronunciation: canonical text preserved, no phonetic leakage", async () => {
  const tmp = makeTmp();
  const segs = buildNarration(tmp);
  // Pronunciation hint is provider-internal only.
  segs[5].pronunciationHints = { "san hô": "san-ho" };
  const al = alignAll(segs);
  const word = al.artifact.words.find((w) => w.segmentId === "s5");
  const canonicalTokens = SEG_TEXTS[5].split(/\s+/);
  const outTokens = al.artifact.words.filter((w) => w.segmentId === "s5").map((w) => w.text);
  assertEq(outTokens.join(" "), canonicalTokens.join(" "), "visible words == canonical text");
  assert(word, "word exists");
  const cap = buildCaptionPack(al.artifact);
  assert(!JSON.stringify(cap.artifact.events).includes("san-ho"), "no phonetic text leaked into captions");
});

await runTest("Case D — local paragraph regeneration: only affected region dirty", async () => {
  const tmp = makeTmp();
  const segs = buildNarration(tmp);
  const al1 = alignAll(segs);
  // Regenerate segment 7 with tighter pacing.
  const segs2 = JSON.parse(JSON.stringify(segs));
  const words7 = SEG_TEXTS[7].split(/\s+/).length;
  segs2[7].audioRef = path.join(tmp, "seg7-regen.wav");
  fs.writeFileSync(segs2[7].audioRef, H.makeWordSpeechWav({ wordCount: words7, wordDurationMs: 250, pauseMs: 200 }));
  segs2[7].expectedEndMs = segs2[7].expectedStartMs + 150 + words7 * 250 + (words7 - 1) * 200 + 200;
  const al2 = alignment.realignSegments(al1.artifact, { ...{ projectId: "validation", language: "vi", narrationTimingHash: "nth-validation0000", segments: segs2 } }, ["s7"]);
  assert(al2.ok, "local realign ok: " + (al2.message || ""));
  const stable = (art, sid) => JSON.stringify(art.words.filter((w) => w.segmentId === sid).map((w) => [w.text, w.startMs, w.endMs]));
  assertEq(stable(al2.artifact, "s6"), stable(al1.artifact, "s6"), "s6 untouched");
  assertEq(stable(al2.artifact, "s8"), stable(al1.artifact, "s8"), "s8 untouched");
  assert(stable(al2.artifact, "s7") !== stable(al1.artifact, "s7"), "s7 re-timed");
  // Caption rebuild: unaffected cue timings stable where words unchanged.
  const cap1 = buildCaptionPack(al1.artifact);
  const cap2 = buildCaptionPack(al2.artifact);
  const c6a = cap1.artifact.events.find((e) => e.text.includes("thức ăn"));
  const c6b = cap2.artifact.events.find((e) => e.text.includes("thức ăn"));
  assert(c6a && c6b && c6a.startMs === c6b.startMs, "unaffected caption timing stable");
});

await runTest("Case E — mix-only change: alignment NOT rerun, caption timing NOT rebuilt", async () => {
  const tmp = makeTmp();
  const segs = buildNarration(tmp);
  const al = alignAll(segs, { finalMixHash: "fmh-1" });
  const inv = alignment.resolveAlignmentInvalidation({
    prevNarrationTimingHash: al.artifact.narrationTimingHash,
    nextNarrationTimingHash: al.artifact.narrationTimingHash,
    prevFinalMixHash: "fmh-1",
    nextFinalMixHash: "fmh-2", // pure music-gain change in 2.8
  });
  assertEq(inv.alignmentDirty, false, "alignment stays CLEAN");
  assertEq(inv.captionTimingDirty, false, "caption timing CLEAN");
  assertEq(inv.mixOnlyChange, true, "classified mix-only");
});

await runTest("Case F — unalignable word: structured finding, no silent substitution", async () => {
  const tmp = makeTmp();
  const segs = buildNarration(tmp, { silentSegments: [3] });
  const al = alignAll(segs);
  const s3 = al.artifact.words.filter((w) => w.segmentId === "s3");
  assert(s3.every((w) => w.status === "UNALIGNED"), "words honestly UNALIGNED");
  assertEq(s3.map((w) => w.text).join(" "), SEG_TEXTS[3], "canonical text NOT rewritten");
  assert(al.artifact.qa.findings.some((f) => f.code === "UNALIGNED_WORD" || f.code === "LOW_ALIGNMENT_COVERAGE"), "structured finding");
  // Retry with the same silent audio → still unaligned → REVIEW_REQUIRED persists.
  const retry = alignment.realignSegments(al.artifact, { projectId: "validation", language: "vi", narrationTimingHash: "nth-validation0000", segments: segs }, ["s3"]);
  assert(retry.ok, "retry runs");
  assert(retry.artifact.words.filter((w) => w.segmentId === "s3").every((w) => w.status === "UNALIGNED"), "still unaligned after retry");
  assert(retry.artifact.qaStatus !== "PASS", "no opaque PASS");
});

await runTest("Case G — high reading speed: resegmentation evaluated, no paraphrase", async () => {
  const tmp = makeTmp();
  const segs = buildNarration(tmp, { wordMs: 120, pauseMs: 40 }); // 3x faster speech
  const al = alignAll(segs);
  const cap = buildCaptionPack(al.artifact);
  const fast = cap.artifact.qa.findings.some((f) => f.code === "CAPTION_TOO_FAST");
  assert(fast, "reading-speed violation detected against profile");
  const captionText = cap.artifact.events.map((e) => e.text).join(" ");
  assertEq(captionText.split(/\s+/).join(" "), SEG_TEXTS.join(" ").split(/\s+/).join(" "), "no factual paraphrase to fit the line");
  assert(cap.artifact.qaStatus !== "PASS", "profile limits enforced");
});

await runTest("Case H — meaningful non-speech sound: ACCESSIBLE includes, DIALOGUE_ONLY excludes", async () => {
  const tmp = makeTmp();
  const segs = buildNarration(tmp);
  const al = alignAll(segs);
  const nse = [{ eventId: "nse-thunder", startMs: 30000, endMs: 32000, label: "tiếng sấm" }];
  const acc = buildCaptionPack(al.artifact, { mode: "ACCESSIBLE_CAPTIONS", nonSpeechEvents: nse });
  assert(acc.artifact.events.some((e) => e.nonSpeechEventRef === "nse-thunder"), "meaningful SFX captioned");
  const dlg = buildCaptionPack(al.artifact, { mode: "DIALOGUE_ONLY" });
  assert(!dlg.artifact.events.some((e) => e.nonSpeechEventRef), "dialogue-only does not inject audio labels");
});

await runTest("Case I — duplicate/flicker injection: detected, locally repaired, re-QA PASS", async () => {
  const tmp = makeTmp();
  const segs = buildNarration(tmp);
  const al = alignAll(segs);
  const cap = buildCaptionPack(al.artifact);
  const dup = JSON.parse(JSON.stringify(cap.artifact));
  dup.events.splice(3, 0, { ...JSON.parse(JSON.stringify(dup.events[3])), captionId: "cap-injected-dup" });
  const qa1 = captions.captionQA(dup, { profile: captions.getProfile(PROF), alignment: al.artifact });
  assert(qa1.findings.some((f) => f.code === "CAPTION_DUPLICATE"), "duplicate detected");
  const rep = captions.applyRepairs(dup, qa1.findings, { profile: captions.getProfile(PROF) });
  assert(rep.ok, "local repair: " + JSON.stringify(rep.applied.map((a) => a.action)));
  const qa2 = captions.captionQA(rep.artifact, { profile: captions.getProfile(PROF), alignment: al.artifact });
  assertEq(qa2.status, "PASS", "re-QA PASS: " + JSON.stringify(qa2.findings));
});

await runTest("Case J — drift injection: finding, affected range, local timing repair", async () => {
  const tmp = makeTmp();
  const segs = buildNarration(tmp);
  const al = alignAll(segs);
  const drifted = JSON.parse(JSON.stringify(al.artifact));
  for (const w of drifted.words) {
    if (w.segmentId === "s9") { w.startMs += 3000; w.endMs += 3000; }
  }
  const qa = alignment.alignmentQA(drifted, { segments: segs });
  assert(qa.findings.some((f) => f.code === "ALIGNMENT_DRIFT" || f.code === "SEGMENT_BOUND_OVERFLOW"), "drift finding");
  assert(qa.findings.some((f) => f.segmentId === "s9"), "affected range identified");
  // Local timing repair: realign only s9.
  const fixed = alignment.realignSegments(drifted, { projectId: "validation", language: "vi", narrationTimingHash: "nth-validation0000", segments: segs }, ["s9"]);
  assert(fixed.ok, "local realign ok");
  const qa2 = alignment.alignmentQA(fixed.artifact, { segments: segs });
  assert(!qa2.findings.some((f) => f.segmentId === "s9"), "s9 findings cleared after local repair");
});

await runTest("Case K — SRT/VTT round-trip: text, timing, count, UTF-8", async () => {
  const tmp = makeTmp();
  const segs = buildNarration(tmp);
  const al = alignAll(segs);
  const cap = buildCaptionPack(al.artifact);
  const srt = captions.validateExportRoundTrip(cap.artifact, "srt");
  assert(srt.ok, "srt: " + (srt.message || ""));
  const vtt = captions.validateExportRoundTrip(cap.artifact, "vtt");
  assert(vtt.ok, "vtt: " + (vtt.message || ""));
  const text = captions.exportSrt(cap.artifact);
  assert(text.includes("Rừng ngầm"), "UTF-8 Vietnamese preserved");
  assert(text.trimEnd().endsWith("hôm nay."), "last cue complete");
});

await runTest("Case L — safe-zone/profile validation: geometry conforms to profile", async () => {
  const tmp = makeTmp();
  const segs = buildNarration(tmp);
  const al = alignAll(segs);
  const cap = buildCaptionPack(al.artifact);
  const profile = captions.getProfile(PROF);
  for (const e of cap.artifact.events) {
    assert(e.lines.length <= profile.maxLines, `lines ≤ ${profile.maxLines}`);
    for (const l of e.lines) assert(l.length <= profile.maxCharsPerLine, `chars/line ≤ ${profile.maxCharsPerLine}`);
    assert(e.presentation.safeZoneRef === `${profile.profileId}@${profile.version}`, "safe-zone ref present");
  }
  const man = captions.buildRenderManifest(cap.artifact);
  assert(man.positioning.policy === profile.positioningPolicy, "positioning intent carried for Phase 3.5");
});

console.log(`\n=== validation-cases A-L: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
})();
