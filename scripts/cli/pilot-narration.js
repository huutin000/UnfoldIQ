"use strict";

/**
 * Phase 2.4 + 2.5 + 2.6 — REAL production narration E2E (idempotent CLI).
 *
 * fss-pilot-sky-blue@v2 (CANONICAL) + Voice Bible vb-19f4fd6a4596 (am_michael)
 * + Narration Direction + Pronunciation Runtime Pass + TTS-ready plan
 *   → segment-level synthesis via the provider runtime (REAL local Kokoro)
 *   → byte-level WAV validation + local faster-whisper transcript integrity
 *   → speech-rate policy + QA measured from real audio
 *   → performance QA (measurable proxies, honest evidence limits)
 *   → FINAL_NARRATION_TRACK (deterministic join, recorded boundaries)
 *
 * Run: node scripts/cli/pilot-narration.js
 * LOCAL synthesis only; external credits = 0. Never touches Phase 2.7/2.8/2.9.
 */

const fs = require("fs");
const path = require("path");

const REPO = path.join(__dirname, "..", "..");
const PROJECT_ID = "pilot-sky-blue";
const SCRIPT_ARTIFACT_ID = "fss-pilot-sky-blue";
const SCRIPT_VERSION = 2;
const VB_REF = "vb-19f4fd6a4596";

const tts = require(path.join(REPO, "lib", "tts-audio", "index.js"));
const wavLib = require(path.join(REPO, "lib", "audio-wav.js"));
const dialogue = require(path.join(REPO, "lib", "dialogue-routing", "index.js"));
const spokenLib = require(path.join(REPO, "lib", "spoken-script", "index.js"));
const manifestLib = require(path.join(REPO, "lib", "project-manifest", "index.js"));
const costShared = require(path.join(REPO, "lib", "output-cost", "shared.js"));

function step(name, r) {
  if (!r || !r.ok) {
    console.error(`NARRATION_FAILED at ${name}: ${(r && r.code) || "ERROR"} — ${(r && r.message) || ""}`);
    process.exit(1);
  }
  return r;
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
  const t0 = Date.now();
  const perf = { externalCreditsSpent: 0 };

  // 1. Canonical inputs (freshness-checked).
  const inputs = step("canonical-inputs", tts.loadCanonicalTtsInputs(REPO, PROJECT_ID, {
    scriptArtifactId: SCRIPT_ARTIFACT_ID,
    scriptVersion: SCRIPT_VERSION,
    voiceBibleRef: VB_REF,
  }));
  const { script, nd, pass, profile, voiceBible } = inputs;

  // 2. Segment-level synthesis (§5): one addressable artifact per segment.
  perf.ttsTotalStartMs = Date.now();
  const segAudios = [];
  const rateEvidence = {};
  const replayFlags = {};
  for (const seg of script.segments) {
    const t = Date.now();
    const r = step(`synthesize:${seg.segmentId}`, await tts.synthesizeSegment(REPO, PROJECT_ID, {
      script, nd, pass, profile, voiceBible,
      segment: seg,
      effectiveSpeed: tts.resolveEffectiveSpeed((nd.segments || []).find((d) => d.segmentId === seg.segmentId)),
    }, { evidenceRefs: ["scripts/cli/pilot-narration.js"] }));
    replayFlags[`synthesize:${seg.segmentId}`] = r.replay === true;
    perf[`ttsSegmentLatencyMs_${seg.segmentId}`] = Date.now() - t;
    // Real-audio measurements for rate/pause/energy QA.
    const audioAbs = path.join(REPO, "projects", PROJECT_ID, r.segmentAudio.audioRef);
    const decoded = wavLib.decodeWav(fs.readFileSync(audioAbs));
    const measured = wavLib.measure(decoded.samples, decoded.sampleRate);
    rateEvidence[seg.segmentId] = measured;
    segAudios.push({ ...r.segmentAudio, rateEvidence: measured });
  }

  // 3. Speech-rate policy (§14) versioned with its baseline + reasons.
  const totalWords = script.segments.reduce((n, s) => n + tts.normalizeWords(s.text).length, 0);
  const totalDuration = segAudios.reduce((n, s) => n + s.durationMs, 0);
  const firstPassWpm = Number(((totalWords / totalDuration) * 60000).toFixed(2));
  const policy = step("speech-rate-policy", tts.createSpeechRatePolicy(REPO, PROJECT_ID, {
    narrator: "am_michael",
    voiceBibleRef: VB_REF,
    contentClass: "FACTUAL",
    targetBand: { minWpm: 120, maxWpm: 180 },
    guardrails: { outlierFactor: 1.6, rateVarianceMax: 1200, maxSilenceMs: 1500 },
    reasons: [
      "V6.2 golden catalog carries a [120,180] wpm TARGET_RANGE for narration (factual explainer) — adopted as the narrator band prior",
      "am_michael Voice Bible speedDefault=1.0 + measured first-pass audio baseline; band re-derivable from N>=3 baselines later",
      "outlierFactor 1.6 / rateVarianceMax 1200 detect uncontrolled swings without punishing natural emphasis pauses",
      "maxSilenceMs 1500 catches unintended internal silence while allowing natural sentence gaps; directed BEAT/SECTION pauses are exempt (§15)",
    ],
    baseline: { measuredFrom: "first-pass FINAL_NARRATION synthesis of fss-pilot-sky-blue@v2 (this run)", overallWpm: firstPassWpm },
    reviewPolicy: "outside band = FAIL (targeted regeneration); outliers/silence = REVIEW_REQUIRED; directed long pauses exempt",
    evidenceRefs: ["golden/definitions.json", "projects/phase2-1-validation/voice/voice-bible/vb-19f4fd6a4596.json"],
  }));

  // 4. Speech-rate QA (measured from real audio).
  const rateQa = step("speech-rate-qa", tts.runSpeechRateQa(REPO, PROJECT_ID, {
    script, policy: policy.policy, segmentAudios: segAudios, directionSegments: nd.segments || [],
  }));

  // 5. Performance QA (§16–§20): proxies + honest limits.
  const energyBySegment = {};
  for (const seg of script.segments) energyBySegment[seg.segmentId] = energyStdOf(path.join(REPO, "projects", PROJECT_ID, segAudios.find((s) => s.segmentId === seg.segmentId).audioRef));
  // Join discontinuity proxies from adjacent decoded tails/heads.
  const joinDiscontinuityBySegment = {};
  for (let i = 1; i < segAudios.length; i += 1) {
    const prevTail = wavLib.decodeWav(fs.readFileSync(path.join(REPO, "projects", PROJECT_ID, segAudios[i - 1].audioRef))).samples.slice(-1)[0];
    const nextHead = wavLib.decodeWav(fs.readFileSync(path.join(REPO, "projects", PROJECT_ID, segAudios[i].audioRef))).samples[0];
    joinDiscontinuityBySegment[segAudios[i].segmentId] = Math.abs(prevTail - nextHead);
  }
  const asrWerBySegment = {};
  for (const sa of segAudios) asrWerBySegment[sa.segmentId] = sa.technicalQa.wer;
  const perfQa = step("performance-qa", tts.runPerformanceQa(REPO, PROJECT_ID, {
    script, segmentAudios: segAudios, rateQa: rateQa.qa,
    asrTranscripts: { ...Object.fromEntries(segAudios.map((s) => [s.segmentId, s.technicalQa.transcript])), ...asrWerBySegment },
    energyBySegment,
    joinDiscontinuityBySegment,
    narrationDirectionSegments: nd.segments || [],
  }));

  // 6. Final narration track from PASS segments (deterministic join).
  const passSegments = segAudios.filter((sa) => {
    const st = perfQa.qa.segments.find((s) => s.segmentId === sa.segmentId);
    return st && st.status !== "FAIL";
  });
  if (passSegments.length !== segAudios.length) {
    console.error(`NARRATION_FAILED: ${segAudios.length - passSegments.length} segment(s) FAILED performance QA — targeted regeneration required before assembly`);
    process.exit(1);
  }
  const track = step("narration-track", tts.assembleNarrationTrack(REPO, PROJECT_ID, {
    script, voiceBibleRef: VB_REF, segmentAudios: passSegments,
    speechRateQaRef: rateQa.qa.speechRateQaId, performanceQaRef: perfQa.qa.performanceQaId,
  }));

  // 7. Phase 2.6 dialogue routing (FACTUAL pilot → narrator-only, contract validated).
  const routingChecks = [];
  const narratorRoute = dialogue.resolveSpeakerRoute(voiceBible, "narrator", { language: "en-us" });
  routingChecks.push({ checkId: "narrator-route", fixture: "Voice Bible narrator resolution", expected: "voiceId=am_michael", status: narratorRoute.ok && narratorRoute.route.voiceId === "am_michael" ? "VERIFIED" : "FAILED" });
  const unknown = dialogue.resolveSpeakerRoute(voiceBible, "detective-voice", { language: "en-us" });
  routingChecks.push({ checkId: "unknown-speaker-fail-closed", fixture: "synthetic unknown speakerId", expected: "DIALOGUE_SPEAKER_NOT_FOUND", status: !unknown.ok && unknown.code === "DIALOGUE_SPEAKER_NOT_FOUND" ? "VERIFIED" : "FAILED" });
  const noVoice = dialogue.resolveSpeakerRoute({ ...voiceBible, characterVoices: [{ speakerId: "guide", language: "en-us" }] }, "guide", { language: "en-us" });
  routingChecks.push({ checkId: "missing-voice-fail-closed", fixture: "synthetic character without voiceId", expected: "DIALOGUE_VOICE_NOT_ASSIGNED", status: !noVoice.ok && noVoice.code === "DIALOGUE_VOICE_NOT_ASSIGNED" ? "VERIFIED" : "FAILED" });
  const langMismatch = dialogue.resolveSpeakerRoute({ ...voiceBible, characterVoices: [{ speakerId: "guide", voiceId: "af_heart", language: "ja" }] }, "guide", { language: "en-us" });
  routingChecks.push({ checkId: "language-mismatch-fail-closed", fixture: "synthetic character with ja voice on en script", expected: "DIALOGUE_VOICE_LANGUAGE_MISMATCH", status: !langMismatch.ok && langMismatch.code === "DIALOGUE_VOICE_LANGUAGE_MISMATCH" ? "VERIFIED" : "FAILED" });
  if (routingChecks.some((c) => c.status !== "VERIFIED")) {
    console.error("NARRATION_FAILED: dialogue routing contract check failed", routingChecks);
    process.exit(1);
  }
  const decision = step("dialogue-decision", dialogue.createRoutingDecision(REPO, PROJECT_ID, {
    contentClass: "FACTUAL", voiceBibleRef: VB_REF, voiceBible, routingChecks,
  }));
  step("dag-dialogue", dialogue.registerDagNode(REPO, PROJECT_ID, decision.decision.dialogueRoutingDecisionId));

  // 8. DAG + Manifest integration.
  step("dag", tts.registerDagNodes(REPO, PROJECT_ID, {
    segmentAudioRef: `tsa-batch@${SCRIPT_ARTIFACT_ID}@v${SCRIPT_VERSION}`,
    speechRateQaRef: rateQa.qa.speechRateQaId,
    performanceQaRef: perfQa.qa.performanceQaId,
    trackRef: track.track.finalNarrationTrackId,
  }));
  step("manifest-track", tts.attachManifestReference(REPO, PROJECT_ID, "narrationAudio", track.track.finalNarrationTrackId));
  step("manifest-rate", tts.attachManifestReference(REPO, PROJECT_ID, "speechRateQa", rateQa.qa.speechRateQaId));
  step("manifest-perf", tts.attachManifestReference(REPO, PROJECT_ID, "performanceQa", perfQa.qa.performanceQaId));
  step("manifest-dialogue", tts.attachManifestReference(REPO, PROJECT_ID, "dialogueRouting", decision.decision.dialogueRoutingDecisionId));

  // 9. Perf/cost baseline evidence (fresh runs only — a full reconcile is a pure NO_OP).
  const reconciledRun = Object.values(replayFlags).length > 0 && Object.values(replayFlags).every(Boolean)
    && policy.replay === true && rateQa.replay === true && perfQa.replay === true
    && track.replay === true && decision.replay === true;
  const evDir = path.join(REPO, "projects", PROJECT_ID, "evidence", "phase-2.4-2.6");
  if (!reconciledRun) {
    fs.mkdirSync(evDir, { recursive: true });
  perf.ttsTotalSynthesisLatencyMs = Date.now() - perf.ttsTotalStartMs;
  perf.audioSecondsGenerated = Number((totalDuration / 1000).toFixed(2));
  perf.realTimeFactor = Number((totalDuration / (Date.now() - perf.ttsTotalStartMs)).toFixed(3));
  perf.segmentCount = script.segments.length;
  perf.attemptCount = segAudios.length;
  perf.regenerationCount = 0;
  fs.writeFileSync(path.join(evDir, "narration-performance-baseline.json"), JSON.stringify({
    phase: "2.4-2.6", measuredAt: new Date().toISOString(), ...perf,
    provider: { provider: "local-kokoro", modelRepo: "hexgrad/Kokoro-82M", modelHash: "UNKNOWN_NOT_AVAILABLE", voiceId: "am_michael", credits: 0 },
    notes: "local synthesis only; no external upload; whisper QA local; tokens/cost UNKNOWN_NOT_AVAILABLE for the hosted humanization already recorded in FIX PRE-2.4",
  }, null, 2) + "\n", "utf8");

  // 10. Rate/perf raw evidence (bounded, RETENTION_MANAGED).
  fs.writeFileSync(path.join(evDir, "rate-evidence.json"), JSON.stringify({
    capturedAt: new Date().toISOString(), perSegment: rateEvidence,
    werBySegment: Object.fromEntries(segAudios.map((s) => [s.segmentId, s.technicalQa.wer])),
  }, null, 2) + "\n", "utf8");
  } // end fresh-run evidence

  console.log(JSON.stringify({
    NARRATION: reconciledRun ? "RECONCILED" : "OK",
    projectId: PROJECT_ID,
    script: `${SCRIPT_ARTIFACT_ID}@v${SCRIPT_VERSION}`,
    voice: "am_michael",
    segments: segAudios.length,
    track: track.track.finalNarrationTrackId,
    trackDurationMs: track.track.durationMs,
    joinQa: track.track.joinQa.status,
    rateQa: { decision: rateQa.qa.decision, overallWpm: rateQa.qa.overall.overallWpm, slowest: rateQa.qa.overall.slowestSegment, fastest: rateQa.qa.overall.fastestSegment, rateVariance: rateQa.qa.overall.rateVariance },
    perfQa: { decision: perfQa.qa.decision, statuses: perfQa.qa.segments.map((s) => `${s.segmentId}:${s.status}`).join(",") },
    werMax: Math.max(...segAudios.map((s) => s.technicalQa.wer || 0)),
    dialogue: decision.decision.decision,
    externalCreditsSpent: 0,
  }, null, 2));
  void costShared;
  void spokenLib;
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
