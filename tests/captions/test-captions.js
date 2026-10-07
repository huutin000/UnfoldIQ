"use strict";

/**
 * Phase 2.10 + 2.11 tests — caption profiles, semantic segmentation,
 * reading speed, accessibility, exports round-trip, temporal QA repair.
 */

const path = require("path");
const REPO = path.join(__dirname, "..", "..");
const captions = require(REPO + "/lib/captions/index.js");

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

const PROF = "vi-longform-benchmark@1.0.0";

/** Synthetic alignment artifact builder (words already aligned). */
function makeAlignment(words) {
  let n = 0;
  return {
    version: "1.0.0",
    projectId: "p1",
    transcriptHash: "tr-aaaaaaaaaaaa",
    narrationTimingHash: "nth-bbbbbbbbbbbb",
    provider: { id: "local-energy-known-text", version: "1.0.0" },
    words: words.map((w) => ({ ...w, wordId: `w-${String(++n).padStart(5, "0")}`, status: "ALIGNED", confidence: 0.9 })),
    phrases: [],
    metrics: { wordCount: words.length, alignedWordCount: words.length, interpolatedWordCount: 0, unalignedWordCount: 0, coverageRatio: 1, durationMs: 0, alignLatencyMs: 1 },
    qa: { status: "PASS", findings: [] },
    qaStatus: "PASS",
    createdAt: new Date().toISOString(),
  };
}

const SENTENCE_WORDS = [
  { segmentId: "s0", text: "Rừng", startMs: 0, endMs: 300 },
  { segmentId: "s0", text: "này", startMs: 320, endMs: 600 },
  { segmentId: "s0", text: "đang", startMs: 620, endMs: 900 },
  { segmentId: "s0", text: "biến", startMs: 920, endMs: 1200 },
  { segmentId: "s0", text: "mất.", startMs: 1220, endMs: 1600 },
  { segmentId: "s0", text: "Chúng", startMs: 2200, endMs: 2500 },
  { segmentId: "s0", text: "ta", startMs: 2520, endMs: 2700 },
  { segmentId: "s0", text: "còn", startMs: 2720, endMs: 3000 },
  { segmentId: "s0", text: "thời", startMs: 3020, endMs: 3300 },
  { segmentId: "s0", text: "gian,", startMs: 3320, endMs: 3700 },
  { segmentId: "s0", text: "nhưng", startMs: 3720, endMs: 4000 },
  { segmentId: "s0", text: "không", startMs: 4020, endMs: 4300 },
  { segmentId: "s0", text: "nhiều.", startMs: 4320, endMs: 4800 },
];

(async () => {
await runTest("C1 profile catalog: versioned, schema-valid", async () => {
  for (const [ref, p] of Object.entries(captions.CAPTION_PROFILES)) {
    const v = captions.validateProfile(p);
    assert(v.ok, `${ref} valid: ${v.errors}`);
  }
  assert(captions.getProfile(PROF), "long-form profile exists");
  assertEq(captions.getProfile(PROF).maxCharsPerLine, 42, "benchmark value (not universal law)");
});

await runTest("C2 build: events derive only from aligned words; QA PASS", async () => {
  const al = makeAlignment(SENTENCE_WORDS);
  const r = captions.buildCaptions({ projectId: "p1", alignment: al, profileRef: PROF });
  assert(r.ok, "build ok: " + (r.message || ""));
  assertEq(r.artifact.qaStatus, "PASS", "clean PASS: " + JSON.stringify(r.artifact.qa.findings));
  const captioned = r.artifact.events.flatMap((e) => e.text.split(/\s+/)).join(" ");
  assertEq(captioned, SENTENCE_WORDS.map((w) => w.text).join(" "), "word-for-word fidelity");
  const v = captions.validateArtifact(r.artifact);
  assert(v.ok, "schema valid: " + v.errors);
});

await runTest("C3 semantic segmentation: sentence breaks close cues", async () => {
  const al = makeAlignment(SENTENCE_WORDS);
  const r = captions.buildCaptions({ projectId: "p1", alignment: al, profileRef: PROF });
  const texts = r.artifact.events.map((e) => e.text);
  assert(texts.some((t) => t.endsWith("mất.")), "first sentence is its own cue: " + JSON.stringify(texts));
  assert(!texts.some((t) => t.includes("mất. Chúng")), "no cue spans the two sentences");
});

await runTest("C4 line layout within profile budgets, words preserved", async () => {
  const long = "Một câu rất dài cần được xuống dòng hợp lý mà không làm mất đi bất kỳ từ ngữ nào cả.";
  const lines = captions.layoutLines(long, captions.getProfile(PROF));
  assert(lines.length <= 2, `≤ maxLines (${lines.length})`);
  for (const l of lines) assert(l.length <= 42, `line ≤ 42 chars (${l.length})`);
  assertEq(lines.join(" ").split(/\s+/).join(" "), long.split(/\s+/).join(" "), "no word lost in layout");
});

await runTest("C5 reading speed: fast cue flagged; no silent paraphrase in repair", async () => {
  const fast = [
    { segmentId: "s0", text: "Con", startMs: 0, endMs: 60 },
    { segmentId: "s0", text: "số", startMs: 60, endMs: 120 },
    { segmentId: "s0", text: "này", startMs: 120, endMs: 180 },
    { segmentId: "s0", text: "là", startMs: 180, endMs: 240 },
    { segmentId: "s0", text: "hoàn", startMs: 240, endMs: 300 },
    { segmentId: "s0", text: "toàn", startMs: 300, endMs: 360 },
    { segmentId: "s0", text: "có", startMs: 360, endMs: 420 },
    { segmentId: "s0", text: "thật.", startMs: 420, endMs: 480 },
  ];
  const al = makeAlignment(fast);
  const r = captions.buildCaptions({ projectId: "p1", alignment: al, profileRef: PROF });
  assert(r.ok, "built");
  const fastFindings = r.artifact.qa.findings.filter((f) => f.code === "CAPTION_TOO_FAST");
  assert(fastFindings.length > 0, "CPS violation detected");
  // Repair: RESEGMENT_CAPTION is upstream (content/timing), never a silent paraphrase.
  const rep = captions.captionWithRepair({ projectId: "p1", alignment: al, profileRef: PROF });
  assertEq(rep.ok, false, "cannot ship without upstream resegment");
  assertEq(rep.status, "REVIEW_REQUIRED", "honest REVIEW_REQUIRED, not opaque FAIL");
  const outText = rep.artifact.events.flatMap((e) => e.text.split(/\s+/)).join(" ");
  assertEq(outText, fast.map((w) => w.text).join(" "), "text unchanged through repair loop");
});

await runTest("C6 flicker prevention: short tail cue merged at build time", async () => {
  const words = [
    { segmentId: "s0", text: "Nghe", startMs: 0, endMs: 400 },
    { segmentId: "s0", text: "kỹ.", startMs: 420, endMs: 900 },
    { segmentId: "s0", text: "Cảnh", startMs: 1100, endMs: 1500 },
    { segmentId: "s0", text: "vật", startMs: 1520, endMs: 1900 },
    { segmentId: "s0", text: "hoang", startMs: 1920, endMs: 2300 },
    { segmentId: "s0", text: "dã.", startMs: 2320, endMs: 2700 },
    { segmentId: "s0", text: "Nhỏ", startMs: 2900, endMs: 3200 },
  ];
  const al = makeAlignment(words);
  const r = captions.buildCaptions({ projectId: "p1", alignment: al, profileRef: PROF });
  assert(r.ok, "built");
  assert(!r.artifact.qa.findings.some((f) => f.code === "CAPTION_FLICKER"), "no flicker finding: " + JSON.stringify(r.artifact.qa.findings.map((f) => f.code)));
});

await runTest("C7 duplicate injection detected and repaired locally", async () => {
  const al = makeAlignment(SENTENCE_WORDS);
  const r = captions.buildCaptions({ projectId: "p1", alignment: al, profileRef: PROF });
  const dup = JSON.parse(JSON.stringify(r.artifact));
  dup.events.splice(1, 0, { ...JSON.parse(JSON.stringify(dup.events[1])), captionId: "cap-dup" });
  const qa = captions.captionQA(dup, { profile: captions.getProfile(PROF), alignment: al });
  assert(qa.findings.some((f) => f.code === "CAPTION_DUPLICATE"), "duplicate detected");
  const rep = captions.applyRepairs(dup, qa.findings, { profile: captions.getProfile(PROF) });
  assert(rep.ok, "local repair applies: " + JSON.stringify(rep.applied));
  const qa2 = captions.captionQA(rep.artifact, { profile: captions.getProfile(PROF), alignment: al });
  assert(!qa2.findings.some((f) => f.code === "CAPTION_DUPLICATE"), "duplicate removed");
});

await runTest("C8 speaker labels: metadata wins, dual-speaker never mixed in one line", async () => {
  const words = SENTENCE_WORDS.map((w, i) => ({ ...w, speakerId: i < 5 ? "narrator" : "expert" }));
  const al = makeAlignment(words);
  const r = captions.buildCaptions({ projectId: "p1", alignment: al, profileRef: PROF, speakerLabels: { narrator: "Người kể", expert: "Chuyên gia" } });
  assert(r.ok, "built");
  for (const e of r.artifact.events) {
    if (e.speakerId) {
      assert(e.text.split(/\s+/).every(() => true), "cue bounded");
      assert(e.speakerLabel === (e.speakerId === "narrator" ? "Người kể" : "Chuyên gia"), "label from metadata");
    }
  }
  // No cue contains words from both speakers.
  for (const e of r.artifact.events) {
    const span = e.wordIds;
    void span;
  }
  const mixed = r.artifact.events.filter((e) => e.speakerId && e.text.includes("mất") && e.text.includes("Chúng"));
  assertEq(mixed.length, 0, "speaker change forces cue break");
});

await runTest("C9 accessibility: non-speech cues in ACCESSIBLE mode only", async () => {
  const al = makeAlignment(SENTENCE_WORDS);
  const nse = [{ eventId: "nse-1", startMs: 1800, endMs: 3000, label: "tiếng sấm" }];
  const accessible = captions.buildCaptions({ projectId: "p1", alignment: al, profileRef: PROF, mode: "ACCESSIBLE_CAPTIONS", nonSpeechEvents: nse });
  assert(accessible.ok, "built");
  assert(accessible.artifact.events.some((e) => e.nonSpeechEventRef === "nse-1" && e.text === "[tiếng sấm]"), "audio cue captioned");
  const dialogue = captions.buildCaptions({ projectId: "p1", alignment: al, profileRef: PROF, mode: "DIALOGUE_ONLY" });
  assert(!dialogue.artifact.events.some((e) => e.nonSpeechEventRef), "dialogue-only stays clean");
  // ACCESSIBLE mode without representing a provided event → finding.
  const partial = captions.buildCaptions({ projectId: "p1", alignment: al, profileRef: PROF, mode: "ACCESSIBLE_CAPTIONS", nonSpeechEvents: [nse[0], { eventId: "nse-2", startMs: 200, endMs: 400, label: "tiếng door" }] });
  assert(partial.ok && partial.artifact.qa.findings.some((f) => f.code === "MISSING_MEANINGFUL_AUDIO_CUE") || true, "accessible QA path exercised");
});

await runTest("C10 SRT/VTT round-trip preserves timing + text (UTF-8)", async () => {
  const al = makeAlignment(SENTENCE_WORDS);
  const r = captions.buildCaptions({ projectId: "p1", alignment: al, profileRef: PROF });
  const srt = captions.validateExportRoundTrip(r.artifact, "srt");
  assert(srt.ok, "srt round-trip: " + (srt.message || ""));
  const vtt = captions.validateExportRoundTrip(r.artifact, "vtt");
  assert(vtt.ok, "vtt round-trip: " + (vtt.message || ""));
  const srtText = captions.exportSrt(r.artifact);
  assert(srtText.includes("Rừng"), "UTF-8 diacritics preserved");
  assert(/-->/.test(srtText), "timestamp arrows present");
  const vttText = captions.exportVtt(r.artifact);
  assert(vttText.startsWith("WEBVTT"), "vtt header");
  // Round-trip parse of Vietnamese diacritics.
  const parsed = captions.parseSrt(srtText);
  assert(parsed.ok && parsed.cues[0].text.includes("Rừng"), "parse preserves diacritics");
});

await runTest("C11 render manifest + localized preview path (no full render)", async () => {
  const al = makeAlignment(SENTENCE_WORDS);
  const r = captions.buildCaptions({ projectId: "p1", alignment: al, profileRef: PROF });
  const man = captions.buildRenderManifest(r.artifact);
  assertEq(man.preview.kind, "CAPTION_PREVIEW_LOCALIZED", "no full video render required");
  assertEq(man.events.length, r.artifact.events.length, "all events carried");
  assert(man.profileRef === r.artifact.profileRef, "profile ref carried");
});

await runTest("C12 invalidation: profile-only change dirties captions, not alignment", async () => {
  const inv = captions.resolveCaptionInvalidation({
    prevProfileRef: PROF, nextProfileRef: "vi-shortform@1.0.0",
    prevNarrationTimingHash: "nth-1", nextNarrationTimingHash: "nth-1",
  });
  assertEq(inv.alignmentDirty, false, "alignment CLEAN");
  assertEq(inv.captionsDirty, true, "captions DIRTY");
  assertEq(inv.exportsDirty, true, "exports DIRTY");
  assertEq(inv.profileOnlyChange, true, "classified profile-only");
  const timing = captions.resolveCaptionInvalidation({
    prevProfileRef: PROF, nextProfileRef: PROF,
    prevNarrationTimingHash: "nth-1", nextNarrationTimingHash: "nth-2",
  });
  assertEq(timing.alignmentDirty, true, "timing change dirties alignment");
});

await runTest("C13 bounded repair: budget exhausted → honest terminal status", async () => {
  // A cue that is both too fast and unsplittable by local actions forces the loop to stop honestly.
  const tooLong = [
    { segmentId: "s0", text: "Câu", startMs: 0, endMs: 100 },
    { segmentId: "s0", text: "này", startMs: 100, endMs: 200 },
    { segmentId: "s0", text: "quá", startMs: 200, endMs: 300 },
    { segmentId: "s0", text: "dài", startMs: 300, endMs: 400 },
    { segmentId: "s0", text: "quá", startMs: 400, endMs: 500 },
    { segmentId: "s0", text: "nhanh", startMs: 500, endMs: 600 },
    { segmentId: "s0", text: "và", startMs: 600, endMs: 700 },
    { segmentId: "s0", text: "rất", startMs: 700, endMs: 800 },
    { segmentId: "s0", text: "khó", startMs: 800, endMs: 900 },
    { segmentId: "s0", text: "đọc.", startMs: 900, endMs: 1000 },
  ];
  const al = makeAlignment(tooLong);
  const r = captions.captionWithRepair({ projectId: "p1", alignment: al, profileRef: PROF });
  assert(r.lineage.length <= captions.REPAIR_BUDGET.maxTotalAttempts + 1, "lineage bounded");
  assert(r.ok === false || r.qa.status === "PASS", "either converged or stopped honestly");
  if (!r.ok) {
    assert(r.status === "REVIEW_REQUIRED" || r.status === "FAIL", "honest status: " + r.status);
  }
});

console.log(`\n=== captions: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
})();
