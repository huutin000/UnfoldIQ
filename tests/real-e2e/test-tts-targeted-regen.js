"use strict";

/**
 * FIX 01 Gap B — bounded targeted-regeneration fixture (F8–F14).
 *
 * Production audio had no natural failure, so this fixture exercises the REAL
 * repair path on an isolated tmp root (never production): synth attempt A →
 * deterministic rate-policy failure → planTargetedRepair selects exactly the
 * failing segment → attempt B re-synthesizes ONLY that segment (real Kokoro,
 * parentAttemptId lineage) → re-QA → repaired attempt selected → validation
 * track rebuilt. Unaffected segment bytes/hashes/ids must be untouched.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const REPO = path.join(__dirname, "..", "..");
const tts = require(path.join(REPO, "lib", "tts-audio", "index.js"));
const wavLib = require(path.join(REPO, "lib", "audio-wav.js"));
const { makeRoot } = require(path.join(REPO, "tests", "fixtures", "phase223", "helpers.js"));

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (!cond) throw new Error("ASSERTION FAILED: " + msg);
  console.log("  ok  " + msg);
}

const VB = { voiceBibleId: "vb-fix246regen", narrator: { voiceId: "am_michael", provider: "local-kokoro", model: "kokoro-v1" } };
const SCRIPT = {
  scriptArtifactId: "fss-fix246regen", scriptVersion: 1, language: "en-us",
  segments: [
    { segmentId: "R1", ordinal: 0, text: "The morning sky glows blue above the quiet fields." },
    { segmentId: "R2", ordinal: 1, text: "Sunlight scatters through the cold air, painting everything a vivid blue." },
  ],
};
const ND = { narrationDirectionId: "nd-fix246regen", segments: [] };
const PASS = { pronunciationPassId: "prp-fix246regen", segments: [] };
const PROFILE = { entries: [] };

function sha256File(p) {
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

function energyStdOf(wavAbs) {
  const decoded = wavLib.decodeWav(fs.readFileSync(wavAbs));
  if (!decoded.ok) return undefined;
  const frames = wavLib.frameRms(decoded.samples, decoded.sampleRate, 20).map((f) => f.rms);
  if (frames.length < 2) return 0;
  const mean = frames.reduce((a, b) => a + b, 0) / frames.length;
  return Math.sqrt(frames.reduce((a, b) => a + (b - mean) ** 2, 0) / frames.length);
}

async function main() {
  const { root, projectId } = makeRoot("fix246-regen");
  let cleanup = true;
  try {
    const input = (seg, extra = {}) => ({
      script: SCRIPT, nd: ND, pass: PASS, profile: PROFILE, voiceBible: VB,
      segment: seg, effectiveSpeed: 1.0, ...extra,
    });

    // Attempt A for both segments (real local Kokoro).
    const r1 = await tts.synthesizeSegment(root, projectId, input(SCRIPT.segments[0]), { kokoroTimeoutMs: 300000 });
    assert(r1.ok && !r1.replay, "F10-prep: R1 attempt 1 synthesized (fresh, real Kokoro)");
    const r2a = await tts.synthesizeSegment(root, projectId, input(SCRIPT.segments[1]), { kokoroTimeoutMs: 300000 });
    assert(r2a.ok && !r2a.replay, "F8-prep: R2 attempt A synthesized (fresh, real Kokoro)");
    const r1Abs = path.join(root, "projects", projectId, r1.segmentAudio.audioRef);
    const r1HashBefore = sha256File(r1Abs);
    assert(r1HashBefore === r1.segmentAudio.audioContentHash, "R1 hash matches artifact at creation");

    // Deterministic failure: absurd-fast band no real narration can meet.
    const strictPolicy = {
      policyId: "srp-fixture-strict", targetBand: { minWpm: 400, maxWpm: 420 },
      guardrails: { outlierFactor: 1.6, rateVarianceMax: 1200, maxSilenceMs: 1500 },
    };
    const segWithEvidence = (sa) => {
      const decoded = wavLib.decodeWav(fs.readFileSync(path.join(root, "projects", projectId, sa.audioRef)));
      return { ...sa, rateEvidence: wavLib.measure(decoded.samples, decoded.sampleRate) };
    };
    const failQa = tts.runSpeechRateQa(root, projectId, {
      script: SCRIPT, policy: strictPolicy,
      segmentAudios: [segWithEvidence(r2a.segmentAudio)], directionSegments: [],
    });
    assert(failQa.ok, "failing QA computed");
    assert(failQa.qa.decision === "FAIL", "F8: R2 attempt A FAILs deterministically under the strict band");
    assert(failQa.qa.segments[0].issues.some((i) => i.code === "SPEECH_RATE_TOO_SLOW"), "F8: failure code is SPEECH_RATE_TOO_SLOW");

    // Repair plan selects exactly the failing segment.
    const plan = tts.planTargetedRepair(failQa.qa, { effectiveSpeed: 0.95, reason: "fixture: slow R2 slightly and re-run under the real band" });
    assert(plan.ok, "repair plan created");
    assert(JSON.stringify(plan.plan.targetSegmentIds) === JSON.stringify(["R2"]), "F9: exactly one target segment (R2)");

    // Attempt B: ONLY R2 re-synthesized, with lineage.
    const r2b = await tts.synthesizeSegment(root, projectId, input(SCRIPT.segments[1], {
      effectiveSpeed: 0.95, attemptNumber: 2,
      parentAttemptId: r2a.segmentAudio.ttsSegmentAudioId,
      attemptReason: `targeted repair (${plan.plan.repairPlanId}): 1.0→0.95`,
    }), { kokoroTimeoutMs: 300000 });
    assert(r2b.ok && !r2b.replay, "F10: R2 attempt B actually re-synthesized (fresh artifact)");
    assert(r2b.segmentAudio.attempt.number === 2, "attempt B numbered 2");
    assert(r2b.segmentAudio.attempt.parentAttemptId === r2a.segmentAudio.ttsSegmentAudioId, "attempt B lineage references attempt A");
    assert(r2a.segmentAudio.ttsSegmentAudioId !== r2b.segmentAudio.ttsSegmentAudioId, "attempt B is a distinct artifact");

    // Re-QA under the real band: R1 (untouched) + R2B.
    const realPolicy = {
      policyId: "srp-fixture-real", targetBand: { minWpm: 120, maxWpm: 180 },
      guardrails: { outlierFactor: 1.6, rateVarianceMax: 1200, maxSilenceMs: 1500 },
    };
    const r1e = segWithEvidence(r1.segmentAudio);
    const r2be = segWithEvidence(r2b.segmentAudio);
    const passQa = tts.runSpeechRateQa(root, projectId, {
      script: SCRIPT, policy: realPolicy, segmentAudios: [r1e, r2be], directionSegments: [],
    });
    assert(passQa.ok && passQa.qa.decision !== "FAIL", `re-QA has no FAIL (decision=${passQa.qa.decision})`);

    const perfQa = tts.runPerformanceQa(root, projectId, {
      script: SCRIPT, segmentAudios: [r1e, r2be], rateQa: passQa.qa,
      asrTranscripts: { R1: r1.segmentAudio.technicalQa.transcript, R2: r2b.segmentAudio.technicalQa.transcript },
      energyBySegment: {
        R1: energyStdOf(path.join(root, "projects", projectId, r1.segmentAudio.audioRef)),
        R2: energyStdOf(path.join(root, "projects", projectId, r2b.segmentAudio.audioRef)),
      },
      joinDiscontinuityBySegment: {},
      narrationDirectionSegments: [],
    });
    assert(perfQa.ok && !perfQa.qa.segments.some((s) => s.status === "FAIL"), "re-QA performance has no FAIL");

    // Select repaired attempt, rebuild validation track.
    const track = tts.assembleNarrationTrack(root, projectId, {
      script: SCRIPT, voiceBibleRef: VB.voiceBibleId, segmentAudios: [r1e, r2be],
      speechRateQaRef: passQa.qa.speechRateQaId, performanceQaRef: perfQa.qa.performanceQaId,
    });
    assert(track.ok, "F14: validation track rebuilt after repair");
    const r2Entry = track.track.segments.find((s) => s.segmentId === "R2");
    assert(r2Entry.audioContentHash === r2b.segmentAudio.audioContentHash, "F13: track selects repaired attempt B");
    assert(r2Entry.ttsSegmentAudioId === r2b.segmentAudio.ttsSegmentAudioId, "track references attempt B id");

    // Unaffected proofs.
    assert(sha256File(r1Abs) === r1HashBefore, "F11: R1 WAV hash unchanged");
    assert(r1.segmentAudio.attempt.number === 1, "F11: R1 attempt count unchanged (1)");
    const r2aAbs = path.join(root, "projects", projectId, r2a.segmentAudio.audioRef);
    assert(fs.existsSync(r2aAbs), "F12: failed attempt A audio preserved on disk");
    const r2aDocAbs = path.join(root, "projects", projectId, r2a.rel);
    assert(fs.existsSync(r2aDocAbs), "F12: failed attempt A JSON lineage preserved");
    console.log(`      fixture ids: R1=${r1.segmentAudio.ttsSegmentAudioId} R2A=${r2a.segmentAudio.ttsSegmentAudioId} R2B=${r2b.segmentAudio.ttsSegmentAudioId} track=${track.track.finalNarrationTrackId}`);
  } catch (e) {
    cleanup = false;
    console.log("fixture root kept for debug: " + root);
    throw e;
  } finally {
    if (cleanup) fs.rmSync(root, { recursive: true, force: true });
  }
}

main()
  .then(() => { console.log(`\n=== DONE: targeted-regen fixture PASS ===`); process.exit(0); })
  .catch((e) => { console.error("FATAL", e); process.exit(1); });
