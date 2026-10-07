"use strict";

/**
 * FIX 01 Gap D — bounded local latency benchmark (F18–F22).
 *
 * Measures a REAL bounded run on an isolated tmp root (same local Kokoro
 * runtime, same voice/language, representative segments, zero external
 * credits): cold synthesis (first model load from disk), warm synthesis
 * (second call, OS page-cache warm), real faster-whisper ASR on an existing
 * production WAV, speech-rate QA compute, performance QA compute.
 * Production full-run total stays historical UNKNOWN — never reconstructed.
 */

const fs = require("fs");
const path = require("path");
const REPO = path.join(__dirname, "..", "..");
const tts = require(path.join(REPO, "lib", "tts-audio", "index.js"));
const wavLib = require(path.join(REPO, "lib", "audio-wav.js"));
const { makeRoot } = require(path.join(REPO, "tests", "fixtures", "phase223", "helpers.js"));

let failed = 0;
function assert(cond, msg) {
  if (!cond) { failed += 1; console.log("[FAIL] " + msg); }
  else console.log("  ok  " + msg);
}

const VB = { voiceBibleId: "vb-fix246bench", narrator: { voiceId: "am_michael", provider: "local-kokoro", model: "kokoro-v1" } };
const SCRIPT = {
  scriptArtifactId: "fss-fix246bench", scriptVersion: 1, language: "en-us",
  segments: [
    { segmentId: "B1", ordinal: 0, text: "The river bends around the silent hill." },
    { segmentId: "B2", ordinal: 1, text: "A lantern flickers in the evening fog." },
  ],
};
const ND = { narrationDirectionId: "nd-fix246bench", segments: [] };
const PASSDOC = { pronunciationPassId: "prp-fix246bench", segments: [] };
const PROFILE = { entries: [] };
const POLICY = {
  policyId: "srp-fixture-bench", targetBand: { minWpm: 120, maxWpm: 180 },
  guardrails: { outlierFactor: 1.6, rateVarianceMax: 1200, maxSilenceMs: 1500 },
};

function withEvidence(root, projectId, sa) {
  const decoded = wavLib.decodeWav(fs.readFileSync(path.join(root, "projects", projectId, sa.audioRef)));
  return { ...sa, rateEvidence: wavLib.measure(decoded.samples, decoded.sampleRate) };
}

async function main() {
  const { root, projectId } = makeRoot("fix246-bench");
  const lat = { scope: "bounded-current-runtime", externalCreditsSpent: 0 };
  try {
    const input = (seg) => ({ script: SCRIPT, nd: ND, pass: PASSDOC, profile: PROFILE, voiceBible: VB, segment: seg, effectiveSpeed: 1.0 });

    let t0 = Date.now();
    const cold = await tts.synthesizeSegment(root, projectId, input(SCRIPT.segments[0]), { skipAsr: true, kokoroTimeoutMs: 300000 });
    lat.ttsColdStartLatencyMs = Date.now() - t0;
    assert(cold.ok && !cold.replay, `F18: cold synthesis ok in ${lat.ttsColdStartLatencyMs}ms`);

    t0 = Date.now();
    const warm = await tts.synthesizeSegment(root, projectId, input(SCRIPT.segments[1]), { skipAsr: true, kokoroTimeoutMs: 300000 });
    lat.ttsWarmSegmentLatencyMs = Date.now() - t0;
    assert(warm.ok && !warm.replay, `F19: warm synthesis ok in ${lat.ttsWarmSegmentLatencyMs}ms`);

    // Real local ASR on an existing production WAV (weights already cached).
    const pilotWav = path.join(REPO, "projects", "pilot-sky-blue", "assets", "voice", "narration-segments", "tsa-cf2ac9efc5ca.wav");
    t0 = Date.now();
    const asr = tts.transcribeBatch([pilotWav], {});
    lat.asrQaLatencyMs = Date.now() - t0;
    const rec = asr.ok ? asr.results.find((x) => x.path === pilotWav) : null;
    assert(asr.ok && rec && rec.ok && typeof rec.text === "string" && rec.text.length > 0, `F20: real local ASR ok in ${lat.asrQaLatencyMs}ms`);
    void rec;

    const audios = [withEvidence(root, projectId, cold.segmentAudio), withEvidence(root, projectId, warm.segmentAudio)];
    t0 = Date.now();
    const rateQa = tts.runSpeechRateQa(root, projectId, { script: SCRIPT, policy: POLICY, segmentAudios: audios, directionSegments: [] });
    lat.speechRateQaLatencyMs = Date.now() - t0;
    assert(rateQa.ok, `F21: speech-rate QA computed in ${lat.speechRateQaLatencyMs}ms (decision=${rateQa.qa.decision})`);

    const energyBySegment = {};
    for (const sa of audios) {
      const decoded = wavLib.decodeWav(fs.readFileSync(path.join(root, "projects", projectId, sa.audioRef)));
      const frames = wavLib.frameRms(decoded.samples, decoded.sampleRate, 20).map((f) => f.rms);
      const mean = frames.reduce((a, b) => a + b, 0) / frames.length;
      energyBySegment[sa.segmentId] = Math.sqrt(frames.reduce((a, b) => a + (b - mean) ** 2, 0) / frames.length);
    }
    t0 = Date.now();
    const perfQa = tts.runPerformanceQa(root, projectId, {
      script: SCRIPT, segmentAudios: audios, rateQa: rateQa.qa, asrTranscripts: {},
      energyBySegment, joinDiscontinuityBySegment: {}, narrationDirectionSegments: [],
    });
    lat.performanceQaLatencyMs = Date.now() - t0;
    assert(perfQa.ok, `F22: performance QA computed in ${lat.performanceQaLatencyMs}ms (decision=${perfQa.qa.decision})`);

    for (const [k, v] of Object.entries(lat)) {
      if (k === "scope" || k === "externalCreditsSpent") continue;
      assert(Number.isFinite(v) && v > 0, `latency ${k} is a positive measurement`);
    }
    assert(lat.externalCreditsSpent === 0, "zero external credits (local runtime only)");
    console.log("      benchmark: " + JSON.stringify(lat));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log(`\n=== DONE: ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
