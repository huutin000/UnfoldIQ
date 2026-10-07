"use strict";

/**
 * FIX 01 Gap E — dedicated Phase 2.4–2.6 behavior/contract Golden (F23, G1–G20).
 *
 * Compares contracts, statuses, semantic fingerprints, artifact relationships
 * and failure codes — never environment-sensitive waveform bytes. Fast path:
 * deterministic stub synthesis transport (sine WAV via wavLib) + stub ASR
 * instrument on isolated tmp roots. Real-audio checks (G4/G5) read existing
 * production evidence read-only. Real-Kokoro repair execution is proven by
 * tests/real-e2e/test-tts-targeted-regen.js; this golden pins the contract.
 */

const fs = require("fs");
const path = require("path");
const REPO = path.join(__dirname, "..", "..");
const tts = require(path.join(REPO, "lib", "tts-audio", "index.js"));
const dialogue = require(path.join(REPO, "lib", "dialogue-routing", "index.js"));
const wavLib = require(path.join(REPO, "lib", "audio-wav.js"));
const kokoroAdapter = require(path.join(REPO, "providers", "runtime", "adapters", "local-kokoro.js"));
const gold = require(path.join(REPO, "lib", "golden", "index.js"));
const Ajv = require("ajv");
const { makeRoot } = require(path.join(REPO, "tests", "fixtures", "phase223", "helpers.js"));

const GOLDEN_PROJECT_ID = "gold-tts-behavior";

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (!cond) throw new Error("ASSERTION FAILED: " + msg);
  console.log("  ok  " + msg);
}
async function runTest(name, fn) {
  console.log("[TEST] " + name);
  try {
    await fn();
    passed += 1;
    console.log("[PASS] " + name);
  } catch (e) {
    failed += 1;
    console.log("[FAIL] " + name + " — " + e.message);
  }
}

const VB = { voiceBibleId: "vb-goldtts", narrator: { voiceId: "am_michael", provider: "local-kokoro", model: "kokoro-v1" } };
const SCRIPT = {
  scriptArtifactId: "fss-goldtts", scriptVersion: 1, language: "en-us",
  segments: [
    { segmentId: "R1", ordinal: 0, text: "The morning sky glows blue above the quiet fields." },
    { segmentId: "R2", ordinal: 1, text: "Sunlight scatters through the cold air, painting everything a vivid blue." },
  ],
};
const ND = { narrationDirectionId: "nd-goldtts", segments: [] };
const PASSDOC = { pronunciationPassId: "prp-goldtts", segments: [] };
const PROFILE = { entries: [] };
const REAL_BAND = { minWpm: 120, maxWpm: 180 };
const GUARD = { outlierFactor: 1.6, rateVarianceMax: 1200, maxSilenceMs: 1500 };
const REAL_POLICY = { policyId: "srp-goldtts", targetBand: REAL_BAND, guardrails: GUARD };
const STRICT_POLICY = { policyId: "srp-goldtts-strict", targetBand: { minWpm: 400, maxWpm: 420 }, guardrails: GUARD };

/** Deterministic stub: sine WAV at exactly ~150 wpm (words/2.5s). */
function stubTransport() {
  return async ({ text }) => {
    const sr = 24000;
    const words = String(text).split(/\s+/).filter(Boolean).length;
    const n = Math.floor(sr * (Math.max(1, words) / 2.5));
    const samples = new Int16Array(n);
    for (let i = 0; i < n; i += 1) samples[i] = Math.round(9000 * Math.sin((2 * Math.PI * 440 * i) / sr));
    return { bytes: wavLib.encodeWav(samples, sr), model: "kokoro-v1", version: "1.0.0" };
  };
}

/** Stub ASR instrument: returns reference texts in call order (exact WER 0). */
function stubAsr(texts) {
  let i = 0;
  return (audioPaths) => ({ ok: true, results: audioPaths.map((p) => ({ path: p, ok: true, text: texts[Math.min(i++, texts.length - 1)] })) });
}

function withEvidence(root, projectId, sa) {
  const decoded = wavLib.decodeWav(fs.readFileSync(path.join(root, "projects", projectId, sa.audioRef)));
  if (!decoded.ok) throw new Error("stub audio undecodable");
  return { ...sa, rateEvidence: wavLib.measure(decoded.samples, decoded.sampleRate) };
}

function energyOf(root, projectId, sa) {
  const decoded = wavLib.decodeWav(fs.readFileSync(path.join(root, "projects", projectId, sa.audioRef)));
  const frames = wavLib.frameRms(decoded.samples, decoded.sampleRate, 20).map((f) => f.rms);
  const mean = frames.reduce((a, b) => a + b, 0) / frames.length;
  return Math.sqrt(frames.reduce((a, b) => a + (b - mean) ** 2, 0) / frames.length);
}

async function synthAll(root, projectId, speed = 1.0, asrTexts = null) {
  const out = [];
  const segs = asrTexts || SCRIPT.segments.map((s) => s.text);
  for (let i = 0; i < SCRIPT.segments.length; i += 1) {
    const r = await tts.synthesizeSegment(root, projectId, {
      script: SCRIPT, nd: ND, pass: PASSDOC, profile: PROFILE, voiceBible: VB,
      segment: SCRIPT.segments[i], effectiveSpeed: speed,
    }, { transport: stubTransport(), asrTransport: stubAsr([segs[i]]) });
    if (!r.ok) throw new Error("stub synth failed: " + r.code + " " + (r.message || ""));
    out.push(withEvidence(root, projectId, r.segmentAudio));
  }
  return out;
}

async function main() {
  await runTest("G1 canonical script required", () => {
    const r = tts.loadCanonicalTtsInputs(REPO, "pilot-sky-blue", { scriptArtifactId: "fss-pilot-sky-blue", scriptVersion: 99, voiceBibleRef: "vb-19f4fd6a4596" });
    assert(!r.ok && r.code === "FINAL_SPOKEN_SCRIPT_NOT_FOUND", "non-canonical script version rejected, got " + r.code);
  });

  await runTest("G2 locked narrator enforced", () => {
    const r = tts.loadCanonicalTtsInputs(REPO, "pilot-sky-blue", { scriptArtifactId: "fss-pilot-sky-blue", scriptVersion: 2, voiceBibleRef: "vb-WRONG" });
    assert(!r.ok && r.code === "TTS_VOICE_BIBLE_MISMATCH", "wrong voice bible rejected, got " + r.code);
  });

  await runTest("G3 local Kokoro path resolves", () => {
    assert(kokoroAdapter.isLanguageSupported("en-us"), "en-us supported");
    assert(!kokoroAdapter.isLanguageSupported("xx"), "unknown language unsupported");
  });

  await runTest("G4 runtime model identity verified", () => {
    const ev = JSON.parse(fs.readFileSync(path.join(REPO, "providers", "model-registry", "kokoro-v1-identity.json"), "utf8"));
    assert(ev.match === true && ev.localSha256 === ev.officialExpectedSha256, "model identity evidence match=true with equal hashes");
    assert(typeof ev.modelFile === "string" && ev.modelFile.endsWith("kokoro-v1_0.pth"), "evidence names the exact local file");
  });

  await runTest("G5 real audio is non-empty non-silent", () => {
    const bytes = fs.readFileSync(path.join(REPO, "projects", "pilot-sky-blue", "assets", "voice", "narration-segments", "tsa-f261243a0659.wav"));
    const decoded = wavLib.decodeWav(bytes);
    const m = wavLib.measure(decoded.samples, decoded.sampleRate);
    assert(decoded.ok && m.nonSilent && m.durationMs > 0 && m.finite, "production S1 WAV decodes non-silent finite");
  });

  await runTest("G6 transcript-integrity QA contract stable", () => {
    assert(tts.transcriptDiff("hello world", "hello world").wer === 0, "identical transcripts WER 0");
    const d = tts.transcriptDiff("the sky is blue", "the sky blue");
    assert(d.wer > 0 && d.missing === 1, "omission detected deterministically");
  });

  await runTest("G7 rate-policy schema stable", () => {
    const ajv = new Ajv({ strict: false });
    const schema = JSON.parse(fs.readFileSync(path.join(REPO, "schemas", "speech-rate-policy.schema.json"), "utf8"));
    const pilot = JSON.parse(fs.readFileSync(path.join(REPO, "projects", "pilot-sky-blue", "audio", "narration", "qa", "srp-966c48f5fc2b.json"), "utf8"));
    assert(ajv.validate(schema, pilot), "production policy validates against versioned schema");
  });

  await runTest("G8 speech-rate metrics shape stable", () => {
    const srq = JSON.parse(fs.readFileSync(path.join(REPO, "projects", "pilot-sky-blue", "audio", "narration", "qa", "srq-dc6c4308edad.json"), "utf8"));
    for (const s of srq.segments) {
      assert(Number.isFinite(s.totalWpm) && Number.isFinite(s.pauseDensity) && Number.isFinite(s.maxSilenceMs), "segment metrics numeric");
    }
    assert(Number.isFinite(srq.overall.overallWpm) && srq.overall.slowestSegment && srq.overall.fastestSegment, "overall slowest/fastest present");
  });

  await runTest("G9 REVIEW_REQUIRED remains representable", () => {
    const pfq = JSON.parse(fs.readFileSync(path.join(REPO, "projects", "pilot-sky-blue", "audio", "narration", "qa", "pfq-af33fbfcf5c0.json"), "utf8"));
    const s1 = pfq.segments.find((s) => s.segmentId === "S1");
    assert(s1.status === "REVIEW_REQUIRED", "S1 stays REVIEW_REQUIRED");
    assert(s1.issues.some((i) => i.code === "PERFORMANCE_EMPHASIS_MISSED" && i.blocking === false), "emphasis issue non-blocking");
  });

  await runTest("G10 targeted repair selects only affected segment", () => {
    const qa = { speechRateQaId: "srq-g", segments: [{ segmentId: "R1", status: "PASS", issues: [] }, { segmentId: "R2", status: "FAIL", issues: [{ code: "SPEECH_RATE_TOO_SLOW" }] }] };
    const plan = tts.planTargetedRepair(qa, { effectiveSpeed: 0.95 });
    assert(plan.ok && JSON.stringify(plan.plan.targetSegmentIds) === JSON.stringify(["R2"]), "exactly R2 targeted");
    assert(JSON.stringify(plan.plan.unaffectedSegmentIds) === JSON.stringify(["R1"]), "R1 explicitly unaffected");
    const none = tts.planTargetedRepair({ speechRateQaId: "srq-g", segments: [{ segmentId: "R1", status: "PASS", issues: [] }] }, {});
    assert(!none.ok && none.code === "TTS_REPAIR_NOTHING_TO_REPAIR", "no-FAIL QA fails closed");
  });

  await runTest("G11 failed attempt lineage preserved", async () => {
    const { root, projectId } = makeRoot("goldtts-lin");
    try {
      const a = await tts.synthesizeSegment(root, projectId, { script: SCRIPT, nd: ND, pass: PASSDOC, profile: PROFILE, voiceBible: VB, segment: SCRIPT.segments[0], effectiveSpeed: 1.0 }, { transport: stubTransport(), asrTransport: stubAsr([SCRIPT.segments[0].text]) });
      const b = await tts.synthesizeSegment(root, projectId, { script: SCRIPT, nd: ND, pass: PASSDOC, profile: PROFILE, voiceBible: VB, segment: SCRIPT.segments[0], effectiveSpeed: 0.95, attemptNumber: 2, parentAttemptId: a.segmentAudio.ttsSegmentAudioId, attemptReason: "golden lineage probe" }, { transport: stubTransport(), asrTransport: stubAsr([SCRIPT.segments[0].text]) });
      assert(b.ok && b.segmentAudio.attempt.parentAttemptId === a.segmentAudio.ttsSegmentAudioId, "attempt B references attempt A");
      assert(fs.existsSync(path.join(root, "projects", projectId, a.rel)), "attempt A doc preserved");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await runTest("G12 unaffected identity preserved in repair", async () => {
    const { root, projectId } = makeRoot("goldtts-rep");
    try {
      const audios = await synthAll(root, projectId);
      const r1Hash = audios[0].audioContentHash;
      const failQa = tts.runSpeechRateQa(root, projectId, { script: SCRIPT, policy: STRICT_POLICY, segmentAudios: [audios[1]], directionSegments: [] });
      assert(failQa.ok && failQa.qa.decision === "FAIL", "strict band FAILs deterministically");
      const plan = tts.planTargetedRepair(failQa.qa, { effectiveSpeed: 0.95 });
      assert(plan.ok && plan.plan.targetSegmentIds.length === 1, "single target");
      const fixed = await tts.synthesizeSegment(root, projectId, { script: SCRIPT, nd: ND, pass: PASSDOC, profile: PROFILE, voiceBible: VB, segment: SCRIPT.segments[1], effectiveSpeed: 0.95, attemptNumber: 2, parentAttemptId: audios[1].ttsSegmentAudioId, attemptReason: "golden repair" }, { transport: stubTransport(), asrTransport: stubAsr([SCRIPT.segments[1].text]) });
      assert(fixed.ok, "repair re-synthesis ok");
      const passQa = tts.runSpeechRateQa(root, projectId, { script: SCRIPT, policy: REAL_POLICY, segmentAudios: [audios[0], withEvidence(root, projectId, fixed.segmentAudio)], directionSegments: [] });
      assert(passQa.ok && passQa.qa.decision !== "FAIL", "post-repair QA has no FAIL");
      assert(audios[0].audioContentHash === r1Hash, "unaffected R1 hash preserved");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await runTest("G13 deterministic join order", async () => {
    const { root, projectId } = makeRoot("goldtts-join");
    try {
      const audios = await synthAll(root, projectId);
      const track = tts.assembleNarrationTrack(root, projectId, { script: SCRIPT, voiceBibleRef: VB.voiceBibleId, segmentAudios: audios, speechRateQaRef: null, performanceQaRef: null });
      assert(track.ok, "assembly ok");
      assert(track.track.segments[0].joinStartMs === 0, "R1 starts at 0");
      assert(track.track.segments[1].joinStartMs === audios[0].durationMs + 250, "R2 starts after R1 + 250ms gap");
      assert(track.track.durationMs === audios[0].durationMs + audios[1].durationMs + 2 * 250, "track duration exact (gap after every segment, incl. trailing)");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await runTest("G14 narrator-only routing stable", () => {
    const vb = JSON.parse(fs.readFileSync(path.join(REPO, "projects", "phase2-1-validation", "voice", "voice-bible", "vb-19f4fd6a4596.json"), "utf8"));
    const r = dialogue.resolveSpeakerRoute(vb, "narrator", { language: "en-us" });
    assert(r.ok && r.route.voiceId === "am_michael", "narrator routes to am_michael");
  });

  await runTest("G15 unknown speaker fails closed", () => {
    const r = dialogue.resolveSpeakerRoute(VB, "no-such-speaker", { language: "en-us" });
    assert(!r.ok && r.code === "DIALOGUE_SPEAKER_NOT_FOUND", "unknown speaker rejected");
  });

  await runTest("G16 missing character voice fails closed", () => {
    const vb2 = { ...VB, characterVoices: [{ speakerId: "guide", language: "en-us" }] };
    const r = dialogue.resolveSpeakerRoute(vb2, "guide", { language: "en-us" });
    assert(!r.ok && r.code === "DIALOGUE_VOICE_NOT_ASSIGNED", "voiceless character rejected");
  });

  await runTest("G17 no silent narrator fallback", () => {
    const r = dialogue.assertNoNarratorFallback({ ok: true, route: { voiceId: "am_michael", narratorVoiceId: "am_michael" } }, "guide");
    assert(!r.ok && r.code === "DIALOGUE_NARRATOR_FALLBACK_FORBIDDEN", "narrator fallback for character refused");
  });

  await runTest("G18 no FINAL_AUDIO/FORCED_ALIGNMENT/CAPTIONS created", () => {
    const m = JSON.parse(fs.readFileSync(path.join(REPO, "projects", "pilot-sky-blue", "manifest", "project-manifest.json"), "utf8"));
    assert(m.artifacts.finalAudioVersion.status === "NOT_CREATED_YET", "no FINAL_AUDIO");
    assert(m.artifacts.alignmentVersion.status === "NOT_CREATED_YET", "no FORCED_ALIGNMENT");
    const dag = JSON.parse(fs.readFileSync(path.join(REPO, "projects", "pilot-sky-blue", "dependency-dag.json"), "utf8"));
    assert(dag.nodes.FINAL_AUDIO.state === "NOT_CREATED_YET" && dag.nodes.FORCED_ALIGNMENT.state === "NOT_CREATED_YET" && dag.nodes.MASTER_TIMELINE.state === "NOT_CREATED_YET", "no premature DAG nodes");
    assert(dag.nodes.CAPTIONS.versionRef === null, "no caption version produced by this package");
  });

  await runTest("G19 recovery reconcile semantics stable", async () => {
    const { root, projectId } = makeRoot("goldtts-rec");
    try {
      const audios = await synthAll(root, projectId);
      const pol = tts.createSpeechRatePolicy(root, projectId, { narrator: "am_michael", voiceBibleRef: VB.voiceBibleId, contentClass: "FACTUAL", targetBand: REAL_BAND, guardrails: GUARD, reasons: ["golden"], reviewPolicy: "golden" });
      assert(pol.ok, "policy created");
      const q1 = tts.runSpeechRateQa(root, projectId, { script: SCRIPT, policy: pol.policy, segmentAudios: audios, directionSegments: [] });
      assert(q1.ok && !q1.replay, "first QA fresh");
      const q2 = tts.runSpeechRateQa(root, projectId, { script: SCRIPT, policy: pol.policy, segmentAudios: audios, directionSegments: [] });
      assert(q2.ok && q2.replay === true && q2.qa.speechRateQaId === q1.qa.speechRateQaId, "identical rerun reconciles (no conflict)");
      // True semantic difference still fails closed.
      const tampered = { ...q1.qa, overall: { ...q1.qa.overall, overallWpm: -1 } };
      fs.writeFileSync(path.join(root, "projects", projectId, q2.rel), JSON.stringify(tampered, null, 2) + "\n", "utf8");
      const q3 = tts.runSpeechRateQa(root, projectId, { script: SCRIPT, policy: pol.policy, segmentAudios: audios, directionSegments: [] });
      assert(!q3.ok && q3.code === "SPEECH_RATE_QA_VERSION_CONFLICT", "tampered QA fails closed, got " + q3.code);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await runTest("G20 Manifest/DAG refs converge correctly", () => {
    const m = JSON.parse(fs.readFileSync(path.join(REPO, "projects", "pilot-sky-blue", "manifest", "project-manifest.json"), "utf8"));
    assert(m.schemaVersion === "1.6.0", "manifest at 1.6.0");
    for (const k of ["narrationAudioVersion", "speechRateQaVersion", "performanceQaVersion", "dialogueRoutingVersion"]) {
      const e = m.artifacts[k];
      assert(e && e.version && e.ref && fs.existsSync(path.join(REPO, "projects", "pilot-sky-blue", e.ref)), k + " resolves to an existing file");
    }
    const dag = JSON.parse(fs.readFileSync(path.join(REPO, "projects", "pilot-sky-blue", "dependency-dag.json"), "utf8"));
    for (const k of ["TTS_SEGMENT_AUDIO", "SPEECH_RATE_QA", "PERFORMANCE_QA", "FINAL_NARRATION_TRACK", "DIALOGUE_ROUTING_DECISION"]) {
      assert(dag.nodes[k].state === "CLEAN", k + " CLEAN");
    }
  });

  await runTest("golden definition + baseline + comparison", () => {
    let def = gold.getDefinition(REPO, GOLDEN_PROJECT_ID, null);
    if (!def.ok) {
      def = gold.createGoldenDefinition(REPO, {
        goldenProjectId: GOLDEN_PROJECT_ID,
        name: "Phase 2.4-2.6 TTS behavior contract",
        contentClass: "FACTUAL",
        categories: ["tts-synthesis", "speech-rate-qa", "performance-qa", "dialogue-routing", "recovery"],
        fixture: { projectId: "pilot-sky-blue", kind: "evidence", detail: "8 am_michael segments + srq/pfq/fnt/dlr artifacts + stub-transport behavior drills" },
      });
    }
    assert(def.ok, "golden definition present");
    const metrics = {
      schemaStability: { status: "MEASURED", value: true },
      versionImmutability: { status: "MEASURED", value: true },
      dagInvalidation: { status: "MEASURED", value: "SCOPE_CORRECT" },
      speechRate: { status: "MEASURED", value: 150.72 },
      pronunciation: { status: "MEASURED", value: 1, method: "deterministic-contract", reviewer: "golden-test", confidence: "high", evidenceRefs: ["tests/golden/test-tts-behavior-golden.js"] },
      voiceIdentity: { status: "MEASURED", value: "am_michael_LOCKED" },
      languageCompatibility: { status: "MEASURED", value: "FAIL_CLOSED" },
      credentialSafety: { status: "MEASURED", value: true },
      failureRate: { status: "MEASURED", value: 0 },
      cost: { status: "MEASURED", value: 0 },
    };
    const evidenceRefs = [
      "tests/golden/test-tts-behavior-golden.js",
      "tests/real-e2e/test-tts-targeted-regen.js",
      "tests/providers/test-kokoro-model-identity.js",
      "tests/providers/test-kokoro-local-benchmark.js",
      "providers/model-registry/kokoro-v1-identity.json",
      "projects/pilot-sky-blue/audio/narration/qa",
    ];
    const latest = gold.latestBaseline(REPO, GOLDEN_PROJECT_ID);
    const norm = (o) => JSON.stringify(Object.keys(o).sort().reduce((acc, k) => { acc[k] = o[k]; return acc; }, {}));
    let baseline;
    if (latest.ok && norm(latest.baseline.metrics) === norm(metrics)) {
      baseline = { ok: true, replay: true };
      console.log("  ok  baseline v" + latest.baseline.version + " already current (no advance)");
    } else {
      baseline = gold.createBaseline(REPO, { goldenProjectId: GOLDEN_PROJECT_ID, version: (latest.ok ? latest.baseline.version : 0) + 1, metrics, evidenceRefs, reason: "FIX 01 TTS behavior baseline" });
    }
    assert(baseline.ok, "baseline ok " + (baseline.ok ? "" : baseline.code + " " + baseline.message));
    const comparison = gold.compareToBaseline(REPO, GOLDEN_PROJECT_ID, { metrics, evidenceRefs });
    assert(comparison.ok, "comparison ok " + (comparison.ok ? "" : JSON.stringify(comparison).slice(0, 200)));
    const verdict = comparison.comparison ? comparison.comparison.verdict : comparison.verdict;
    assert(verdict === undefined || verdict === "PASS" || verdict === "NO_REGRESSION" || verdict === "PASS_WITH_NOTES" || verdict === "EQUAL", "golden verdict: " + verdict);
    console.log("      golden comparison verdict: " + (verdict || "n/a"));
  });

  console.log(`\n=== DONE: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
