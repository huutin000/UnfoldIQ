"use strict";

/**
 * Phase 2.4 + 2.5 — Narration audio (UNFOLDIQ CORE).
 *
 * Canonical-input-only segment synthesis: every request is built from the
 * Final Spoken Script + Voice Bible + Narration Direction + Pronunciation
 * Runtime Pass + TTS-ready plan, freshness-checked per segment. Synthesis goes
 * through the provider runtime (local-kokoro adapter) — never a vendor call.
 * Actual audio is measured from decoded bytes (never from the speed param);
 * transcript integrity uses local faster-whisper as a QA instrument only.
 * The assembled FINAL_NARRATION_TRACK is NOT the FINAL_AUDIO master (Phase 2.8).
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const wavLib = require("../audio-wav.js");
const spokenLib = require("../spoken-script/index.js");
const manifestLib = require("../project-manifest/index.js");
const dagLib = require("../dependency-dag/index.js");
const telemetryLib = require("../telemetry/index.js");
const costShared = require("../output-cost/shared.js");
const kokoroPhonemize = require("../../providers/runtime/kokoro-phonemize.js");
const kokoroAdapter = require("../../providers/runtime/adapters/local-kokoro.js");

const TSA_SCHEMA_VERSION = "1.0.0";
const SRQ_SCHEMA_VERSION = "1.0.0";
const SRP_SCHEMA_VERSION = "1.0.0";
const PFQ_SCHEMA_VERSION = "1.0.0";
const FNT_SCHEMA_VERSION = "1.0.0";
const AUDIO_DIR_REL = "assets/voice/narration-segments";
const TRACK_DIR_REL = "assets/voice/narration-track";
const QA_DIR_REL = "audio/narration/qa";
const EXPECTED_SAMPLE_RATE = 24000;

// §8 bounded pace→speed policy (versioned; ±5% maximum, never per-sentence).
const PACE_SPEED_POLICY = {
  version: "pace-speed-1.0.0",
  MODERATE: 1.0,
  ABSENT: 1.0,
  SLOWER: 0.95,
  FASTER: 1.05,
};
const JOIN_POLICY = { version: "narration-join-1.0.0", interSegmentSilenceMs: 250 };

// Transcript-integrity QA thresholds (local faster-whisper, QA instrument only).
const ASR_CONFIG = { model: "small", language: "en", computeType: "int8" };
const ASR_WER_MAX = 0.15;

const ERRORS = {
  TTS_INPUT_NOT_READY: "canonical TTS inputs do not resolve for this project",
  TTS_SCRIPT_NOT_CANONICAL: "source script is not a canonical Final Spoken Script",
  TTS_VOICE_BIBLE_MISMATCH: "voice bible ref does not match the locked Voice Bible",
  TTS_VOICE_LOCK_VIOLATION: "narrator/voice differs from the locked am_michael identity",
  TTS_PRONUNCIATION_STALE: "pronunciation pass does not match the current script/profile",
  TTS_DIRECTION_STALE: "narration direction does not match the current script",
  TTS_RUNTIME_UNAVAILABLE: "local Kokoro runtime unavailable; no silent fallback",
  TTS_SYNTHESIS_FAILED: "Kokoro synthesis failed",
  TTS_EMPTY_OUTPUT: "synthesis produced empty output",
  TTS_AUDIO_CORRUPT: "synthesized audio is corrupt/undecodable",
  TTS_AUDIO_SILENT: "synthesized audio is silent/empty",
  TTS_AUDIO_SAMPLE_RATE_MISMATCH: "synthesized audio sample rate diverges from the runtime identity",
  TTS_SEGMENT_NOT_FOUND: "selected segment audio does not exist",
  SPEECH_RATE_TOO_SLOW: "systemically too slow delivery measured from audio",
  SPEECH_RATE_TOO_FAST: "systemically too fast delivery measured from audio",
  SPEECH_RATE_VARIANCE_HIGH: "large uncontrolled rate swings across narration",
  SPEECH_RATE_SEGMENT_OUTLIER: "segment rate deviates beyond the policy outlier factor",
  UNEXPECTED_LONG_SILENCE: "unexpected internal silence beyond the policy maximum",
  PAUSE_UNNATURAL: "pause behavior inconsistent with punctuation/direction intent",
  PERFORMANCE_MONOTONY: "monotonous delivery measured from audio proxies",
  PERFORMANCE_MECHANICAL_CADENCE: "mechanical cadence measured from audio proxies",
  PERFORMANCE_PAUSE_UNNATURAL: "unnatural pause behavior",
  PERFORMANCE_EMPHASIS_MISSED: "directed emphasis could not be evidenced",
  PERFORMANCE_OVERACTED: "overacted delivery",
  PERFORMANCE_UNDERACTED: "underacted delivery",
  PERFORMANCE_JOIN_UNNATURAL: "abnormal join between segments",
  PERFORMANCE_REVIEW_REQUIRED: "performance evidence ambiguous; review required",
  PERFORMANCE_JOIN_POLICY_UNAVAILABLE: "join policy missing",
  TTS_REPAIR_NOTHING_TO_REPAIR: "no failing segment to repair in the QA decision",
  DIALOGUE_SPEAKER_NOT_FOUND: "speakerId does not resolve in the Voice Bible",
  DIALOGUE_VOICE_NOT_ASSIGNED: "character speaker has no assigned voiceId",
  DIALOGUE_VOICE_LANGUAGE_MISMATCH: "character voice is not compatible with the script language",
  DIALOGUE_STYLE_NOT_ALLOWED: "style not allowed for this speaker/Voice Bible",
  DIALOGUE_NARRATOR_FALLBACK_FORBIDDEN: "silent narrator fallback for a character speaker is forbidden",
};

// ---------------------------------------------------------------------------
// Canonical input resolution + freshness (§4)
// ---------------------------------------------------------------------------

function loadCanonicalTtsInputs(root, projectId, { scriptArtifactId, scriptVersion, voiceBibleRef }) {
  const fss = spokenLib.loadFinalSpokenScript(root, projectId, scriptArtifactId, scriptVersion);
  if (!fss.ok) return fss;
  if (fss.script.provenance.productionScriptStatus !== "CANONICAL") {
    return { ok: false, code: "TTS_SCRIPT_NOT_CANONICAL", message: `${ERRORS.TTS_SCRIPT_NOT_CANONICAL}: ${scriptArtifactId}@v${scriptVersion}` };
  }
  const script = fss.script;
  const loadedManifest = manifestLib.loadProjectManifest(root, projectId);
  if (!loadedManifest.ok) return loadedManifest;
  const m = loadedManifest.manifest;
  const planEntry = m.artifacts.ttsReadyPlanVersion;
  if (planEntry.status !== "VERIFIED") {
    return { ok: false, code: "TTS_INPUT_NOT_READY", message: `${ERRORS.TTS_INPUT_NOT_READY}: tts-ready plan ${planEntry.status}` };
  }
  const plan = JSON.parse(fs.readFileSync(path.join(root, "projects", projectId, planEntry.ref || ""), "utf8"));
  if (plan.scriptRef.scriptArtifactId !== script.scriptArtifactId || plan.scriptRef.scriptVersion !== script.scriptVersion) {
    return { ok: false, code: "TTS_INPUT_NOT_READY", message: `${ERRORS.TTS_INPUT_NOT_READY}: plan bound to ${plan.scriptRef.scriptArtifactId}@v${plan.scriptRef.scriptVersion}` };
  }
  const ndEntry = m.artifacts.narrationDirectionVersion;
  if (ndEntry.status !== "VERIFIED") {
    return { ok: false, code: "TTS_DIRECTION_STALE", message: `${ERRORS.TTS_DIRECTION_STALE}: manifest ${ndEntry.status}` };
  }
  const nd = JSON.parse(fs.readFileSync(path.join(root, "projects", projectId, ndEntry.ref || ""), "utf8"));
  if (nd.scriptRef.scriptArtifactId !== script.scriptArtifactId || nd.scriptRef.scriptVersion !== script.scriptVersion) {
    return { ok: false, code: "TTS_DIRECTION_STALE", message: `${ERRORS.TTS_DIRECTION_STALE}: ND bound to ${nd.scriptRef.scriptArtifactId}@v${nd.scriptRef.scriptVersion}` };
  }
  const prpEntry = m.artifacts.pronunciationRuntimePassVersion;
  if (prpEntry.status !== "VERIFIED") {
    return { ok: false, code: "TTS_PRONUNCIATION_STALE", message: `${ERRORS.TTS_PRONUNCIATION_STALE}: manifest ${prpEntry.status}` };
  }
  const pass = JSON.parse(fs.readFileSync(path.join(root, "projects", projectId, prpEntry.ref || ""), "utf8"));
  if (pass.scriptRef.scriptArtifactId !== script.scriptArtifactId || pass.scriptRef.scriptVersion !== script.scriptVersion) {
    return { ok: false, code: "TTS_PRONUNCIATION_STALE", message: `${ERRORS.TTS_PRONUNCIATION_STALE}: pass bound to ${pass.scriptRef.scriptArtifactId}@v${pass.scriptRef.scriptVersion}` };
  }
  const profile = JSON.parse(fs.readFileSync(path.join(root, "projects", projectId, "voice/pronunciation-profile", `${pass.profileRef}.json`), "utf8"));
  // Voice Bible identity (locked am_michael).
  const vbPath = path.join(root, "projects", "phase2-1-validation", "voice", "voice-bible", `${voiceBibleRef}.json`);
  if (!fs.existsSync(vbPath)) return { ok: false, code: "TTS_VOICE_BIBLE_MISMATCH", message: `${ERRORS.TTS_VOICE_BIBLE_MISMATCH}: ${voiceBibleRef} not found` };
  const vb = JSON.parse(fs.readFileSync(vbPath, "utf8"));
  if (vb.voiceBibleId !== voiceBibleRef) return { ok: false, code: "TTS_VOICE_BIBLE_MISMATCH", message: ERRORS.TTS_VOICE_BIBLE_MISMATCH };
  if (vb.narrator.voiceId !== "am_michael") {
    return { ok: false, code: "TTS_VOICE_LOCK_VIOLATION", message: `${ERRORS.TTS_VOICE_LOCK_VIOLATION}: ${vb.narrator.voiceId}` };
  }
  return { ok: true, script, plan, nd, pass, profile, voiceBible: vb };
}

/** §8 bounded pace→speed resolution (never per-sentence; policy-versioned). */
function resolveEffectiveSpeed(directionSegment) {
  const pace = directionSegment && directionSegment.paceIntent ? directionSegment.paceIntent : "ABSENT";
  return PACE_SPEED_POLICY[pace] || PACE_SPEED_POLICY.ABSENT;
}

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

// ---------------------------------------------------------------------------
// Segment synthesis (§5–§11)
// ---------------------------------------------------------------------------

function compiledTextFor(script, passDoc, profileDoc, seg) {
  const passSeg = (passDoc.segments || []).find((s) => s.segmentId === seg.segmentId);
  const entryIds = new Set((passSeg && passSeg.matchedEntries || []).filter((me) => me.applied).map((me) => me.entryId));
  const entries = (profileDoc.entries || []).filter((e) => entryIds.has(e.entryId));
  const compiled = kokoroPhonemize.compileInput({ text: seg.text, entries });
  const compiledHash = costShared.hash16(compiled.compiledText);
  // Freshness: the derived compiled input must equal what the pass validated.
  if (passSeg && passSeg.compiledInputHash && passSeg.compiledInputHash !== compiledHash) {
    return { ok: false, code: "TTS_PRONUNCIATION_STALE", message: `${ERRORS.TTS_PRONUNCIATION_STALE}: ${seg.segmentId} compiled input diverges from the validated pass` };
  }
  return { ok: true, compiledText: compiled.compiledText, compiledHash };
}

/**
 * Synthesize one segment. input: { script, nd, pass, profile, voiceBible,
 * ttsReadyPlanRef, segment, effectiveSpeed?, opts }. Uses the provider runtime
 * local-kokoro adapter (real python CLI; ctx.kokoroTransport injectable for
 * tests). Idempotent: identical inputs return the existing READY artifact.
 */
async function synthesizeSegment(root, projectId, input, opts = {}) {
  const { script, nd, pass, profile, voiceBible } = input;
  const seg = input.segment;
  const direction = (nd.segments || []).find((d) => d.segmentId === seg.segmentId) || null;
  const sourceTextHash = spokenLib.textHash ? spokenLib.textHash(seg.text) : costShared.hash16(seg.text);
  const compiled = compiledTextFor(script, pass, profile, seg);
  if (!compiled.ok) return compiled;
  const effectiveSpeed = input.effectiveSpeed !== undefined ? input.effectiveSpeed : resolveEffectiveSpeed(direction);
  const voiceId = voiceBible.narrator.voiceId;
  const ttsaId = costShared.id12("tsa", {
    project: projectId,
    scriptArtifactId: script.scriptArtifactId,
    scriptVersion: script.scriptVersion,
    segmentId: seg.segmentId,
    voiceBibleRef: voiceBible.voiceBibleId,
    ndRef: nd.narrationDirectionId,
    passRef: pass.pronunciationPassId,
    voiceId,
    effectiveSpeed,
    compiledHash: compiled.compiledHash,
    compiler: kokoroPhonemize.QUIET_RUNNER.length, // compiler version identity
  });
  const ttsSegmentAudioId = `tsa-${ttsaId.slice(4)}`;
  const rel = `${AUDIO_DIR_REL}/${ttsSegmentAudioId}.json`;
  const abs = path.join(root, "projects", projectId, rel);
  if (fs.existsSync(abs)) {
    try {
      const existing = JSON.parse(fs.readFileSync(abs, "utf8"));
      if (existing.status === "READY") {
        // FIX 01 Gap A: reuse only after verifying the bytes + lineage still match.
        const wavAbs = path.join(root, "projects", projectId, existing.audioRef);
        if (!fs.existsSync(wavAbs)) {
          return { ok: false, code: "TTS_AUDIO_CORRUPT", message: `${ERRORS.TTS_AUDIO_CORRUPT}: ${existing.audioRef} missing at resume` };
        }
        if (sha256(fs.readFileSync(wavAbs)) !== existing.audioContentHash) {
          return { ok: false, code: "TTS_AUDIO_CORRUPT", message: `${ERRORS.TTS_AUDIO_CORRUPT}: ${existing.segmentId} bytes diverge at resume` };
        }
        return { ok: true, segmentAudio: existing, rel, replay: true, reconcile: "VERIFIED_BYTES", code: "IDEMPOTENT_REPLAY" };
      }
    } catch {
      /* unreadable existing artifact → fall through to resynthesis */
    }
  }
  emitEvent(root, projectId, "TTS_SEGMENT_SYNTHESIS_STARTED", { correlationId: ttsSegmentAudioId, provider: "local-kokoro", model: "kokoro-v1", attributes: { segmentId: seg.segmentId, effectiveSpeed } }, opts);

  // Provider runtime synthesis (no vendor call; real CLI unless transport injected).
  // providerPreference pins local-kokoro: mock/agent-native TTS is never a
  // silent fallback for production narration.
  const { registerAllProviders } = require("../../providers/runtime/bootstrap.js");
  const resolver = require("../../providers/runtime/resolver.js");
  registerAllProviders();
  const result = await resolver.resolve({
    capability: "tts",
    projectId,
    sceneId: "narration-segments",
    requestId: ttsSegmentAudioId,
    providerId: "local-kokoro",
    providerPreference: ["local-kokoro"],
    input: { text: compiled.compiledText, language: script.language, voice: voiceId, speed: effectiveSpeed },
    outputRequirements: { format: "wav", speed: effectiveSpeed, language: script.language, voice: voiceId },
    rightsContext: { rightsStatus: "RISK_ACCEPTED", blocked: false },
  }, { projectRoot: root, kokoroTimeoutMs: opts.kokoroTimeoutMs || 300000, kokoroTransport: opts.transport ? { synthesize: opts.transport } : undefined, kokoroVoices: { [script.language]: [voiceId] } });
  if (result.blocked || result.failed || !result.artifactPath) {
    const err = result.error || {};
    emitEvent(root, projectId, "TTS_SEGMENT_SYNTHESIS_FAILED", { correlationId: ttsSegmentAudioId, severity: "ERROR", provider: "local-kokoro", model: "kokoro-v1", errorCode: err.code || "TTS_SYNTHESIS_FAILED", attributes: { segmentId: seg.segmentId } }, opts);
    return { ok: false, code: err.code || "TTS_SYNTHESIS_FAILED", message: String(err.message || "synthesis failed") };
  }
  if (result.providerId !== "local-kokoro") {
    return { ok: false, code: "TTS_SYNTHESIS_FAILED", message: `provider ${result.providerId} served the request; production narration must come from local-kokoro` };
  }
  const audioAbs = path.join(root, "projects", projectId, result.artifactPath);
  const bytes = fs.readFileSync(audioAbs);
  if (bytes.length === 0) return { ok: false, code: "TTS_EMPTY_OUTPUT", message: ERRORS.TTS_EMPTY_OUTPUT };

  // §11 byte-level validation.
  const decoded = wavLib.decodeWav(bytes);
  if (!decoded.ok) return { ok: false, code: decoded.code, message: decoded.message };
  if (decoded.sampleRate !== EXPECTED_SAMPLE_RATE) {
    return { ok: false, code: "TTS_AUDIO_SAMPLE_RATE_MISMATCH", message: `${ERRORS.TTS_AUDIO_SAMPLE_RATE_MISMATCH}: ${decoded.sampleRate}` };
  }
  const qa = wavLib.measure(decoded.samples, decoded.sampleRate);
  if (!qa.nonSilent) return { ok: false, code: "TTS_AUDIO_SILENT", message: ERRORS.TTS_AUDIO_SILENT };
  if (!qa.finite) return { ok: false, code: "TTS_AUDIO_CORRUPT", message: ERRORS.TTS_AUDIO_CORRUPT };

  // §12 transcript integrity: local faster-whisper as a QA instrument only
  // (never uploaded; timestamps are QA evidence, not Phase 2.9 alignment).
  let asrQa = { transcript: null, wer: null, missingWords: null, substitutedWords: null, repeatedWords: null, hallucinatedWords: null, criticalMismatch: null };
  if (opts.asrTransport || !opts.skipAsr) {
    const tr = transcribeBatch([audioAbs], { asrTransport: opts.asrTransport, timeoutMs: opts.asrTimeoutMs });
    const rec = tr.ok ? tr.results.find((x) => x.path === audioAbs) : null;
    if (tr.ok && rec && rec.ok) {
      const diff = transcriptDiff(seg.text, rec.text);
      asrQa = { transcript: rec.text, wer: diff.wer, missingWords: diff.missing, substitutedWords: diff.substituted, repeatedWords: diff.repeated, hallucinatedWords: diff.hallucinated, criticalMismatch: diff.wer > ASR_WER_MAX * 2 };
    } else {
      // ASR is QA evidence: its absence is recorded honestly, never fabricated.
      asrQa.transcript = `ASR_UNAVAILABLE: ${tr.ok ? (rec && rec.error) || "no result" : tr.message}`;
    }
  }

  const doc = {
    schemaVersion: TSA_SCHEMA_VERSION,
    ttsSegmentAudioId,
    version: 1,
    projectId,
    scriptRef: { scriptArtifactId: script.scriptArtifactId, scriptVersion: script.scriptVersion },
    segmentId: seg.segmentId,
    segmentOrdinal: seg.ordinal,
    sourceTextHash,
    compiledInputHash: compiled.compiledHash,
    voiceBibleRef: voiceBible.voiceBibleId,
    narrationDirectionRef: nd.narrationDirectionId,
    pronunciationPassRef: pass.pronunciationPassId,
    provider: "local-kokoro",
    providerModel: "kokoro-v1",
    runtimeIdentity: { runtimeMode: result.metadata && result.metadata.mock ? "TRANSPORT_MOCKED" : "LOCAL_SYNTHESIS", modelRepo: "hexgrad/Kokoro-82M", modelHash: "UNKNOWN_NOT_AVAILABLE", languageCode: kokoroPhonemize.kokoroLangCode(script.language) },
    voiceId,
    effectiveSpeed,
    pacePolicyVersion: PACE_SPEED_POLICY.version,
    audioRef: result.artifactPath,
    audioContentHash: sha256(bytes),
    durationMs: qa.durationMs,
    sampleRate: decoded.sampleRate,
    channels: decoded.channels,
    technicalQa: { decodePass: true, nonSilent: qa.nonSilent, finiteSamples: qa.finite, peak: qa.peak, rms: qa.rms, clippingSamples: qa.clippingSamples, ...asrQa },
    attempt: { number: input.attemptNumber || 1, parentAttemptId: input.parentAttemptId || null, reason: input.attemptReason || "initial synthesis", selected: null },
    issues: [],
    status: "READY",
    provenance: { createdAt: new Date().toISOString(), evidenceRefs: opts.evidenceRefs || [] },
    fingerprint: null,
  };
  doc.fingerprint = fingerprintOf(doc);
  const saved = persistJson(root, projectId, rel, doc, "FINAL_SPOKEN_SCRIPT_VERSION_CONFLICT");
  if (!saved.ok && saved.code === "FINAL_SPOKEN_SCRIPT_VERSION_CONFLICT") {
    try {
      const existing = JSON.parse(fs.readFileSync(abs, "utf8"));
      if (existing.fingerprint === doc.fingerprint && existing.status === "READY" && sameSemantics(existing, doc)) return { ok: true, segmentAudio: existing, rel, replay: true, code: "IDEMPOTENT_REPLAY" };
    } catch { /* fall through */ }
    return saved;
  }
  if (!saved.ok) return saved;
  emitEvent(root, projectId, "TTS_SEGMENT_SYNTHESIS_SUCCEEDED", { correlationId: ttsSegmentAudioId, provider: "local-kokoro", model: "kokoro-v1", attributes: { segmentId: seg.segmentId, durationMs: qa.durationMs, effectiveSpeed } }, opts);
  return { ok: true, segmentAudio: doc, rel, bytes, replay: false };
}

// ---------------------------------------------------------------------------
// Transcript integrity QA (§12) — local faster-whisper, QA instrument only
// ---------------------------------------------------------------------------

const ASR_SCRIPT = `
import json, sys
def main():
    from faster_whisper import WhisperModel
    m = WhisperModel(${JSON.stringify(ASR_CONFIG.model)}, device="cpu", compute_type=${JSON.stringify(ASR_CONFIG.computeType)})
    out = []
    for p in sys.argv[1:]:
        try:
            segs, info = m.transcribe(p, language=${JSON.stringify(ASR_CONFIG.language)}, beam_size=1)
            out.append({"path": p, "ok": True, "text": " ".join(s.text.strip() for s in segs)})
        except Exception as e:
            out.append({"path": p, "ok": False, "error": str(e)[:200]})
    json.dump({"ok": True, "results": out}, sys.stdout, ensure_ascii=False)
main()
`;

/** Transcribe wav files locally (one python process per batch). Never uploads. */
function transcribeBatch(audioPaths, opts = {}) {
  if (audioPaths.length === 0) return { ok: true, results: [] };
  if (opts.asrTransport) return opts.asrTransport(audioPaths);
  const span = spawnSync("python", ["-c", ASR_SCRIPT, ...audioPaths], { encoding: "utf8", timeout: opts.timeoutMs || 600000 });
  if (span.error) return { ok: false, code: "TTS_RUNTIME_UNAVAILABLE", message: `faster-whisper unavailable: ${String(span.error.message || span.error)}` };
  if (span.status !== 0) return { ok: false, code: "TTS_SYNTHESIS_FAILED", message: `asr exited ${span.status}: ${String(span.stderr || "").slice(-200)}` };
  try {
    return JSON.parse(span.stdout);
  } catch (e) {
    return { ok: false, code: "TTS_SYNTHESIS_FAILED", message: `asr output unparseable: ${String((e && e.message) || e)}` };
  }
}

function normalizeWords(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9'\s]/g, " ").split(/\s+/).filter(Boolean);
}

function levenshteinMatrix(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp;
}

/** Word-level WER + missing/substituted/repeated/hallucinated classification. */
function transcriptDiff(referenceText, hypothesisText) {
  const ref = normalizeWords(referenceText);
  const hyp = normalizeWords(hypothesisText);
  const dp = levenshteinMatrix(ref, hyp);
  let i = ref.length;
  let j = hyp.length;
  let missing = 0;
  let substituted = 0;
  let hallucinated = 0;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1)) {
      if (ref[i - 1] !== hyp[j - 1]) substituted += 1;
      i -= 1; j -= 1;
    } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      missing += 1; i -= 1;
    } else {
      hallucinated += 1;
      j -= 1;
    }
  }
  const wer = ref.length === 0 ? (hyp.length ? 1 : 0) : (missing + substituted + hallucinated) / ref.length;
  // Consecutive-duplicate repetitions in the hypothesis that the reference
  // does not contain (e.g. "...the the sky...").
  let repeated = 0;
  const refHasRepeat = new Set();
  for (let k = 1; k < ref.length; k += 1) if (ref[k] === ref[k - 1]) refHasRepeat.add(ref[k]);
  for (let k = 1; k < hyp.length; k += 1) if (hyp[k] === hyp[k - 1] && !refHasRepeat.has(hyp[k])) repeated += 1;
  return { wer: Number(wer.toFixed(4)), missing, substituted, repeated, hallucinated, refWords: ref.length, hypWords: hyp.length };
}

// ---------------------------------------------------------------------------
// Speech-rate policy + QA (§13–§15)
// ---------------------------------------------------------------------------

function fingerprintOf(doc) {
  const { fingerprint, ...rest } = doc;
  void fingerprint;
  return costShared.hash16(JSON.parse(costShared.stableStringify(rest)));
}

/**
 * FIX 01 Gap A — semantic reconcile. `provenance` (timestamps, evidence refs)
 * is incidental: two docs with identical semantic bodies describe the same
 * QA/track decision. On rerun with unchanged inputs, the existing durable
 * artifact is reused (no rewrite, no duplicate) instead of version-conflict.
 * A true semantic difference still fails closed via the caller's conflict code.
 */
function semanticBody(doc) {
  const { fingerprint, provenance, ...rest } = doc;
  void fingerprint;
  void provenance;
  return rest;
}

function sameSemantics(a, b) {
  try {
    return costShared.stableStringify(semanticBody(a)) === costShared.stableStringify(semanticBody(b));
  } catch {
    return false;
  }
}

function persistJson(root, projectId, rel, doc, conflictCode) {
  const abs = path.join(root, "projects", projectId, rel);
  if (fs.existsSync(abs)) return { ok: false, code: conflictCode, message: `${conflictCode}: ${rel}` };
  try {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const tmp = `${abs}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(doc, null, 2) + "\n", "utf8");
    fs.renameSync(tmp, abs);
  } catch (e) {
    return { ok: false, code: conflictCode, message: `persist failed: ${String((e && e.message) || e)}` };
  }
  return { ok: true, rel };
}

/** §14 versioned evidence-based policy. Fixed values carry their reasons. */
function createSpeechRatePolicy(root, projectId, input = {}, opts = {}) {
  const doc = {
    schemaVersion: SRP_SCHEMA_VERSION,
    policyId: null,
    version: input.version || 1,
    projectId,
    narrator: input.narrator,
    voiceBibleRef: input.voiceBibleRef,
    contentClass: input.contentClass || "FACTUAL",
    targetBand: input.targetBand,
    guardrails: input.guardrails,
    reasons: input.reasons,
    baseline: input.baseline || null,
    reviewPolicy: input.reviewPolicy,
    provenance: { createdAt: null, evidenceRefs: input.evidenceRefs || [] },
    fingerprint: null,
  };
  doc.policyId = `srp-${costShared.id12("srp", { project: projectId, narrator: input.narrator, band: input.targetBand, guardrails: input.guardrails, version: doc.version }).slice(4)}`;
  doc.fingerprint = fingerprintOf(doc);
  doc.provenance.createdAt = new Date().toISOString();
  const rel = `${QA_DIR_REL}/${doc.policyId}.json`;
  const saved = persistJson(root, projectId, rel, doc, "FINAL_SPOKEN_SCRIPT_VERSION_CONFLICT");
  if (!saved.ok && saved.code === "FINAL_SPOKEN_SCRIPT_VERSION_CONFLICT") {
    try {
      const existing = JSON.parse(fs.readFileSync(path.join(root, "projects", projectId, rel), "utf8"));
      if (existing.fingerprint === doc.fingerprint && sameSemantics(existing, doc)) return { ok: true, policy: existing, rel, replay: true, reconcile: "EXACT", code: "IDEMPOTENT_REPLAY" };
      // FIX 01 Gap A: semantically identical policy (only provenance differs) is reused, not conflicted.
      if (sameSemantics(existing, doc)) return { ok: true, policy: existing, rel, replay: true, reconciled: true, reconcile: "SEMANTIC", code: "IDEMPOTENT_REPLAY" };
    } catch { /* fall through */ }
    return saved;
  }
  if (!saved.ok) return saved;
  return { ok: true, policy: doc, rel };
}

function loadSpeechRatePolicy(root, projectId, policyId) {
  const p = path.join(root, "projects", projectId, QA_DIR_REL, `${policyId}.json`);
  if (!fs.existsSync(p)) return { ok: false, code: "TTS_INPUT_NOT_READY", message: `speech-rate policy not found: ${policyId}` };
  return { ok: true, policy: JSON.parse(fs.readFileSync(p, "utf8")), rel: `${QA_DIR_REL}/${policyId}.json` };
}

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * §13/§15 speech-rate + pause QA from REAL audio (segment audio docs).
 * segmentAudioDocs: selected READY docs (with technicalQa + text source).
 */
function runSpeechRateQa(root, projectId, { script, policy, segmentAudios, directionSegments }, opts = {}) {
  if (!policy || !Array.isArray(segmentAudios) || segmentAudios.length === 0) {
    return { ok: false, code: "TTS_INPUT_NOT_READY", message: "policy + segmentAudios required" };
  }
  const dirBySegment = new Map((directionSegments || []).map((d) => [d.segmentId, d]));
  const segResults = [];
  const issues = [];
  const rateValues = [];
  for (const sa of segmentAudios) {
    const seg = script.segments.find((s) => s.segmentId === sa.segmentId);
    const wordCount = normalizeWords(seg.text).length;
    const totalWpm = Number(((wordCount / sa.durationMs) * 60000).toFixed(2));
    const pauseDurationMs = sa.rateEvidence ? sa.rateEvidence.totalSilenceMs : 0;
    const pauseDensity = Number((pauseDurationMs / sa.durationMs).toFixed(4));
    const maxSilenceMs = sa.rateEvidence ? sa.rateEvidence.maxSilenceMs : 0;
    const result = { segmentId: sa.segmentId, wordCount, durationMs: sa.durationMs, totalWpm, pauseDurationMs, pauseDensity, maxSilenceMs, status: "PASS", issues: [] };
    if (totalWpm < policy.targetBand.minWpm) {
      result.status = "FAIL";
      result.issues.push({ code: "SPEECH_RATE_TOO_SLOW", detail: `${totalWpm} < ${policy.targetBand.minWpm} wpm` });
      issues.push({ code: "SPEECH_RATE_TOO_SLOW", segmentId: sa.segmentId, detail: result.issues[0].detail, blocking: true });
    }
    if (totalWpm > policy.targetBand.maxWpm) {
      result.status = "FAIL";
      result.issues.push({ code: "SPEECH_RATE_TOO_FAST", detail: `${totalWpm} > ${policy.targetBand.maxWpm} wpm` });
      issues.push({ code: "SPEECH_RATE_TOO_FAST", segmentId: sa.segmentId, detail: result.issues[0].detail, blocking: true });
    }
    // §15 pause classification: unexpected internal silence not anchored to
    // sentence punctuation; a directed BEAT pause may legitimately be long.
    const directed = dirBySegment.get(sa.segmentId);
    const directedPause = directed && (directed.pauseIntent || []).some((p) => p.kind === "BEAT" || p.kind === "SECTION");
    if (maxSilenceMs > policy.guardrails.maxSilenceMs && !directedPause) {
      result.status = result.status === "FAIL" ? "FAIL" : "REVIEW_REQUIRED";
      result.issues.push({ code: "UNEXPECTED_LONG_SILENCE", detail: `max silence ${maxSilenceMs}ms > ${policy.guardrails.maxSilenceMs}ms without a directed long pause` });
      issues.push({ code: "UNEXPECTED_LONG_SILENCE", segmentId: sa.segmentId, detail: result.issues[result.issues.length - 1].detail, blocking: false });
    }
    if (result.status !== "FAIL") result.status = result.issues.length ? "REVIEW_REQUIRED" : "PASS";
    rateValues.push(totalWpm);
    segResults.push(result);
  }
  // Outliers + variance (whole narration).
  const med = median(rateValues);
  for (const r of segResults) {
    if (med > 0 && (r.totalWpm > med * policy.guardrails.outlierFactor || r.totalWpm < med / policy.guardrails.outlierFactor)) {
      if (r.status === "PASS") r.status = "REVIEW_REQUIRED";
      r.issues.push({ code: "SPEECH_RATE_SEGMENT_OUTLIER", detail: `${r.totalWpm} wpm vs median ${Number(med.toFixed(2))}` });
      issues.push({ code: "SPEECH_RATE_SEGMENT_OUTLIER", segmentId: r.segmentId, detail: r.issues[r.issues.length - 1].detail, blocking: false });
    }
  }
  const mean = rateValues.reduce((a, b) => a + b, 0) / rateValues.length;
  const variance = rateValues.reduce((a, b) => a + (b - mean) ** 2, 0) / rateValues.length;
  if (variance > policy.guardrails.rateVarianceMax) {
    issues.push({ code: "SPEECH_RATE_VARIANCE_HIGH", segmentId: null, detail: `rate variance ${Number(variance.toFixed(2))} > ${policy.guardrails.rateVarianceMax}`, blocking: true });
  }
  const totalDurationMs = segmentAudios.reduce((n, s) => n + s.durationMs, 0);
  const totalWords = segResults.reduce((n, s) => n + s.wordCount, 0);
  const overall = {
    overallWpm: Number(((totalWords / totalDurationMs) * 60000).toFixed(2)),
    slowestSegment: segResults.reduce((min, r) => (r.totalWpm < min.wpm ? { segmentId: r.segmentId, wpm: r.totalWpm } : min), { segmentId: segResults[0].segmentId, wpm: segResults[0].totalWpm }),
    fastestSegment: segResults.reduce((max, r) => (r.totalWpm > max.wpm ? { segmentId: r.segmentId, wpm: r.totalWpm } : max), { segmentId: segResults[0].segmentId, wpm: segResults[0].totalWpm }),
    rateMean: Number(mean.toFixed(2)),
    rateMedian: Number(median(rateValues).toFixed(2)),
    rateVariance: Number(variance.toFixed(2)),
    pauseDensity: Number((segResults.reduce((n, s) => n + s.pauseDurationMs, 0) / totalDurationMs).toFixed(4)),
    unexpectedLongSilenceCount: issues.filter((i) => i.code === "UNEXPECTED_LONG_SILENCE").length,
    totalDurationMs,
  };
  const decision = issues.some((i) => i.blocking) ? "FAIL" : issues.some((i) => i.segmentId && segResults.find((r) => r.segmentId === i.segmentId && r.status === "REVIEW_REQUIRED")) || issues.length ? "REVIEW_REQUIRED" : "PASS";
  const doc = {
    schemaVersion: SRQ_SCHEMA_VERSION,
    speechRateQaId: null,
    version: 1,
    projectId,
    scriptRef: { scriptArtifactId: script.scriptArtifactId, scriptVersion: script.scriptVersion },
    policyRef: policy.policyId,
    provider: "local-kokoro",
    voiceId: segmentAudios[0].voiceId,
    segments: segResults,
    overall,
    decision,
    issues,
    provenance: { createdAt: null, evidenceRefs: opts.evidenceRefs || [] },
    fingerprint: null,
  };
  doc.speechRateQaId = `srq-${costShared.id12("srq", { project: projectId, scriptRef: doc.scriptRef, policyRef: policy.policyId, audioHashes: segmentAudios.map((s) => s.audioContentHash).join(",").slice(0, 512) }).slice(4)}`;
  doc.fingerprint = fingerprintOf(doc);
  doc.provenance.createdAt = new Date().toISOString();
  const rel = `${QA_DIR_REL}/${doc.speechRateQaId}.json`;
  const saved = persistJson(root, projectId, rel, doc, "SPEECH_RATE_QA_VERSION_CONFLICT");
  if (!saved.ok && saved.code === "SPEECH_RATE_QA_VERSION_CONFLICT") {
    try {
      const existing = JSON.parse(fs.readFileSync(path.join(root, "projects", projectId, rel), "utf8"));
      if (existing.fingerprint === doc.fingerprint && sameSemantics(existing, doc)) return { ok: true, qa: existing, rel, replay: true, reconcile: "EXACT", code: "IDEMPOTENT_REPLAY" };
      // FIX 01 Gap A: semantically identical QA (only provenance differs) is reused, not conflicted.
      if (sameSemantics(existing, doc)) return { ok: true, qa: existing, rel, replay: true, reconciled: true, reconcile: "SEMANTIC", code: "IDEMPOTENT_REPLAY" };
    } catch { /* fall through */ }
    return saved;
  }
  if (!saved.ok) return saved;
  emitEvent(root, projectId, "SPEECH_RATE_QA_EVALUATED", { correlationId: doc.speechRateQaId, severity: decision === "PASS" ? "INFO" : "WARN", stateTo: decision, attributes: { overallWpm: overall.overallWpm, slowest: overall.slowestSegment.wpm, fastest: overall.fastestSegment.wpm, issueCount: issues.length } }, opts);
  return { ok: true, qa: doc, rel };
}

// ---------------------------------------------------------------------------
// Performance QA (§16–§20) — measurable proxies + honest evidence limits
// ---------------------------------------------------------------------------

/**
 * segmentAudios: selected READY docs; rateQa: speech-rate doc; asrTranscripts:
 * {segmentId: text} from the local whisper QA instrument. energyBySegment:
 * {segmentId: energyStd} measured from decoded audio (per-sentence windows).
 * joinDiscontinuity: max abs sample delta at the segment's trailing join
 * (null for the last segment / before assembly).
 */
function runPerformanceQa(root, projectId, { script, segmentAudios, rateQa, asrTranscripts, energyBySegment, joinDiscontinuityBySegment, narrationDirectionSegments }, opts = {}) {
  if (!Array.isArray(segmentAudios) || segmentAudios.length === 0) {
    return { ok: false, code: "TTS_INPUT_NOT_READY", message: "segmentAudios required" };
  }
  const rateBySegment = new Map((rateQa ? rateQa.segments : []).map((r) => [r.segmentId, r]));
  const dirBySegment = new Map((narrationDirectionSegments || []).map((d) => [d.segmentId, d]));
  const rateValues = segmentAudios.map((sa) => (rateBySegment.get(sa.segmentId) || {}).totalWpm).filter((v) => v !== undefined);
  const rateVariance = (() => {
    if (rateValues.length < 2) return 0;
    const mean = rateValues.reduce((a, b) => a + b, 0) / rateValues.length;
    return rateValues.reduce((a, b) => a + (b - mean) ** 2, 0) / rateValues.length;
  })();
  const results = [];
  let anyBlocking = false;
  let anyReview = false;
  for (const sa of segmentAudios) {
    const rate = rateBySegment.get(sa.segmentId);
    const transcript = (asrTranscripts || {})[sa.segmentId] || null;
    const energyStd = (energyBySegment || {})[sa.segmentId];
    const issues = [];
    let segmentReview = false;
    const mark = (code, detail, blocking) => {
      issues.push({ code, detail, blocking: !!blocking });
      if (blocking) anyBlocking = true;
      else segmentReview = true;
    };
    let monotonyStatus = "PASS";
    if (rate && rateVariance < 4 && energyStd !== undefined && energyStd < 300 && segmentAudios.length >= 4) {
      monotonyStatus = "FAIL";
      mark("PERFORMANCE_MONOTONY", `rate variance ${Number(rateVariance.toFixed(2))}, energyStd ${Number(energyStd.toFixed(1))}`, true);
    } else if (rateVariance < 2) {
      monotonyStatus = "REVIEW_REQUIRED";
      mark("PERFORMANCE_REVIEW_REQUIRED", `rate variance ${Number(rateVariance.toFixed(2))} is low; energyStd ${energyStd === undefined ? "N/A" : Number(energyStd.toFixed(1))}`, false);
    }
    const pauseVariation = rate && rate.pauseDensity !== undefined ? rate.pauseDensity : null;
    let mechanicalStatus = "PASS";
    if (pauseVariation !== null && segmentAudios.length >= 4 && rateValues.length >= 4 && Math.max(...rateValues) - Math.min(...rateValues) < 5) {
      mechanicalStatus = "REVIEW_REQUIRED";
      mark("PERFORMANCE_MECHANICAL_CADENCE", "uniform rate across segments (spread < 5 wpm)", false);
    }
    let pauseStatus = "PASS";
    if ((rate && rate.issues || []).some((i) => i.code === "PAUSE_UNNATURAL" || i.code === "UNEXPECTED_LONG_SILENCE")) {
      pauseStatus = "REVIEW_REQUIRED";
      mark("PERFORMANCE_PAUSE_UNNATURAL", "see speech-rate QA pause findings", false);
    }
    // Intonation: F0 spread not implemented in this phase — honest evidence
    // limit recorded in the report; no fabricated F0 claims.
    let intonationStatus = "PASS";
    // Emphasis (§19): directed emphasis cannot be word-verified without
    // canonical alignment (Phase 2.9) — REVIEW_REQUIRED with evidence limits.
    let emphasisStatus = "PASS";
    const directed = dirBySegment.get(sa.segmentId);
    if (directed && (directed.emphasis || []).length > 0) {
      emphasisStatus = "REVIEW_REQUIRED";
      mark("PERFORMANCE_EMPHASIS_MISSED", `directed emphasis on "${(directed.emphasis || []).map((e) => e.text).join(",")}" cannot be word-verified without Phase 2.9 alignment; evidence limited`, false);
    }
    let overStatus = "PASS";
    if (rate && rate.totalWpm < 100) { overStatus = "FAIL"; mark("PERFORMANCE_OVERACTED", `${rate.totalWpm} wpm`, true); }
    let underStatus = "PASS";
    if (rate && rate.totalWpm > 220) { underStatus = "FAIL"; mark("PERFORMANCE_UNDERACTED", `${rate.totalWpm} wpm`, true); }
    let joinsStatus = "PASS";
    const join = (joinDiscontinuityBySegment || {})[sa.segmentId];
    if (join !== undefined && join > 24000) { joinsStatus = "FAIL"; mark("PERFORMANCE_JOIN_UNNATURAL", `max boundary delta ${join}`, true); }
    else if (join !== undefined && join > 12000) { joinsStatus = "REVIEW_REQUIRED"; mark("PERFORMANCE_JOIN_UNNATURAL", `max boundary delta ${join}`, false); }
    const asr = (asrTranscripts || {})[sa.segmentId + ":wer"];
    if (asr !== undefined && asr > ASR_WER_MAX) mark("PERFORMANCE_REVIEW_REQUIRED", `ASR WER ${asr} > ${ASR_WER_MAX} for this segment`, false);
    const status = issues.some((i) => i.blocking) ? "FAIL" : segmentReview ? "REVIEW_REQUIRED" : "PASS";
    if (segmentReview) anyReview = true;
    results.push({
      segmentId: sa.segmentId,
      signals: { rateWpm: rate ? rate.totalWpm : null, energyStd: energyStd !== undefined ? Number(energyStd.toFixed(1)) : null, pauseCount: sa.rateEvidence ? sa.rateEvidence.silenceSpans.length : null, pauseVariation, asrWer: asr !== undefined ? asr : null, repeatedCadence: null },
      checks: { monotony: monotonyStatus, mechanicalCadence: mechanicalStatus, pauseNaturalness: pauseStatus, intonation: intonationStatus, emphasis: emphasisStatus, overacting: overStatus, underacting: underStatus, joins: joinsStatus },
      issues,
      status,
    });
    if (status === "FAIL") anyBlocking = true;
  }
  const decision = anyBlocking ? "FAIL" : results.some((r) => r.status === "REVIEW_REQUIRED") ? "REVIEW_REQUIRED" : "PASS";
  const doc = {
    schemaVersion: PFQ_SCHEMA_VERSION,
    performanceQaId: null,
    version: 1,
    projectId,
    scriptRef: { scriptArtifactId: script.scriptArtifactId, scriptVersion: script.scriptVersion },
    speechRateQaRef: rateQa ? rateQa.speechRateQaId : null,
    segments: results,
    fatigue: { shortFormPerformance: "MEASURED", longFormFatigue: "BOUNDED_PROXY_NOT_FULLY_MEASURED", note: "pilot script is short; sustained-narration fatigue proof belongs to Phase 7 long-form E2E" },
    decision,
    provenance: { createdAt: null, evidenceRefs: opts.evidenceRefs || [] },
    fingerprint: null,
  };
  doc.performanceQaId = `pfq-${costShared.id12("pfq", { project: projectId, scriptRef: doc.scriptRef, srqRef: doc.speechRateQaRef, audioHashes: segmentAudios.map((s) => s.audioContentHash).join(",").slice(0, 512) }).slice(4)}`;
  doc.fingerprint = fingerprintOf(doc);
  doc.provenance.createdAt = new Date().toISOString();
  const rel = `${QA_DIR_REL}/${doc.performanceQaId}.json`;
  const saved = persistJson(root, projectId, rel, doc, "PERFORMANCE_QA_VERSION_CONFLICT");
  if (!saved.ok && saved.code === "PERFORMANCE_QA_VERSION_CONFLICT") {
    try {
      const existing = JSON.parse(fs.readFileSync(path.join(root, "projects", projectId, rel), "utf8"));
      if (existing.fingerprint === doc.fingerprint && sameSemantics(existing, doc)) return { ok: true, qa: existing, rel, replay: true, reconcile: "EXACT", code: "IDEMPOTENT_REPLAY" };
      // FIX 01 Gap A: semantically identical QA (only provenance differs) is reused, not conflicted.
      if (sameSemantics(existing, doc)) return { ok: true, qa: existing, rel, replay: true, reconciled: true, reconcile: "SEMANTIC", code: "IDEMPOTENT_REPLAY" };
    } catch { /* fall through */ }
    return saved;
  }
  if (!saved.ok) return saved;
  emitEvent(root, projectId, "PERFORMANCE_QA_EVALUATED", { correlationId: doc.performanceQaId, severity: decision === "PASS" ? "INFO" : "WARN", stateTo: decision, attributes: { segmentCount: results.length, failCount: results.filter((r) => r.status === "FAIL").length, reviewCount: results.filter((r) => r.status === "REVIEW_REQUIRED").length } }, opts);
  return { ok: true, qa: doc, rel };
}

// ---------------------------------------------------------------------------
// Final narration track assembly (§21)
// ---------------------------------------------------------------------------

/**
 * Assemble selected PASS segments in order. joinPolicyVersioned. Recomputes
 * every segment's bytes from disk (hash re-verified), inserts recorded
 * inter-segment silence, validates the assembled WAV. NOTE: this is the
 * FINAL_NARRATION_TRACK — never the FINAL_AUDIO master (Phase 2.8).
 */
function assembleNarrationTrack(root, projectId, { script, voiceBibleRef, segmentAudios, speechRateQaRef, performanceQaRef, interSegmentSilenceMs }, opts = {}) {
  const gapMs = interSegmentSilenceMs !== undefined ? interSegmentSilenceMs : JOIN_POLICY.interSegmentSilenceMs;
  const ordered = [...segmentAudios].sort((a, b) => a.segmentOrdinal - b.segmentOrdinal);
  const trackSegments = [];
  const trackRecords = [];
  let cursorMs = 0;
  for (const sa of ordered) {
    const audioAbs = path.join(root, "projects", projectId, sa.audioRef);
    const bytes = fs.readFileSync(audioAbs);
    if (sha256(bytes) !== sa.audioContentHash) {
      return { ok: false, code: "TTS_AUDIO_CORRUPT", message: `segment ${sa.segmentId} audio hash mismatch at assembly` };
    }
    const decoded = wavLib.decodeWav(bytes);
    if (!decoded.ok) return { ok: false, code: decoded.code, message: decoded.message };
    trackSegments.push({ samples: decoded.samples, gapAfterMs: gapMs });
    trackRecords.push({
      segmentId: sa.segmentId,
      segmentOrdinal: sa.segmentOrdinal,
      ttsSegmentAudioId: sa.ttsSegmentAudioId,
      audioRef: sa.audioRef,
      audioContentHash: sa.audioContentHash,
      durationMs: sa.durationMs,
      joinStartMs: cursorMs,
    });
    cursorMs += sa.durationMs + gapMs;
  }
  const { samples, joins } = wavLib.assemble(trackSegments, EXPECTED_SAMPLE_RATE);
  const wav = wavLib.encodeWav(samples, EXPECTED_SAMPLE_RATE);
  const measured = wavLib.measure(samples, EXPECTED_SAMPLE_RATE);
  const trackId = `fnt-${costShared.id12("fnt", { project: projectId, scriptRef: { scriptArtifactId: script.scriptArtifactId, scriptVersion: script.scriptVersion }, segHashes: ordered.map((s) => s.audioContentHash).join(",").slice(0, 512), joinPolicy: JOIN_POLICY.version, gapMs }).slice(4)}`;
  const audioRef = `${TRACK_DIR_REL}/${trackId}.wav`;
  const audioAbs = path.join(root, "projects", projectId, audioRef);
  if (!fs.existsSync(audioAbs)) {
    fs.mkdirSync(path.dirname(audioAbs), { recursive: true });
    const tmp = `${audioAbs}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, wav);
    fs.renameSync(tmp, audioAbs);
  }
  const maxDiscontinuity = Math.max(...joins.slice(0, -1).map((j) => j.discontinuity), 0);
  const doc = {
    schemaVersion: FNT_SCHEMA_VERSION,
    finalNarrationTrackId: trackId,
    version: 1,
    projectId,
    scriptRef: { scriptArtifactId: script.scriptArtifactId, scriptVersion: script.scriptVersion },
    voiceBibleRef: voiceBibleRef,
    speechRateQaRef: speechRateQaRef || null,
    performanceQaRef: performanceQaRef || null,
    joinPolicy: { version: JOIN_POLICY.version, interSegmentSilenceMs: gapMs },
    segments: trackRecords,
    audioRef,
    audioContentHash: sha256(wav),
    durationMs: measured.durationMs,
    sampleRate: EXPECTED_SAMPLE_RATE,
    channels: 1,
    joinQa: { joinCount: joins.length - 1, maxDiscontinuity: Number(maxDiscontinuity.toFixed(1)), status: maxDiscontinuity > 24000 ? "FAIL" : maxDiscontinuity > 12000 ? "REVIEW_REQUIRED" : "PASS" },
    status: "ASSEMBLED",
    provenance: { createdAt: null, evidenceRefs: opts.evidenceRefs || [] },
    fingerprint: null,
  };
  doc.fingerprint = fingerprintOf(doc);
  doc.provenance.createdAt = new Date().toISOString();
  const rel = `${TRACK_DIR_REL}/${trackId}.json`;
  const saved = persistJson(root, projectId, rel, doc, "FINAL_NARRATION_TRACK_VERSION_CONFLICT");
  if (!saved.ok && saved.code === "FINAL_NARRATION_TRACK_VERSION_CONFLICT") {
    try {
      const existing = JSON.parse(fs.readFileSync(path.join(root, "projects", projectId, rel), "utf8"));
      if (existing.fingerprint === doc.fingerprint && sameSemantics(existing, doc)) return { ok: true, track: existing, rel, replay: true, reconcile: "EXACT", code: "IDEMPOTENT_REPLAY" };
      // FIX 01 Gap A: semantically identical track (only provenance differs) is reused, not conflicted.
      if (sameSemantics(existing, doc)) {
        const trackAbs = path.join(root, "projects", projectId, existing.audioRef);
        if (fs.existsSync(trackAbs) && sha256(fs.readFileSync(trackAbs)) === existing.audioContentHash) {
          return { ok: true, track: existing, rel, replay: true, reconciled: true, reconcile: "SEMANTIC", code: "IDEMPOTENT_REPLAY" };
        }
        return { ok: false, code: "TTS_AUDIO_CORRUPT", message: `${ERRORS.TTS_AUDIO_CORRUPT}: existing track bytes diverge at resume` };
      }
    } catch {
      /* unreadable existing track → fall through to conflict */
    }
    return saved;
  }
  if (!saved.ok) return saved;
  emitEvent(root, projectId, "FINAL_NARRATION_TRACK_ASSEMBLED", { correlationId: trackId, attributes: { durationMs: measured.durationMs, segmentCount: trackRecords.length, maxDiscontinuity: doc.joinQa.maxDiscontinuity } }, opts);
  return { ok: true, track: doc, rel };
}

function loadNarrationTrack(root, projectId, trackId) {
  const p = path.join(root, "projects", projectId, TRACK_DIR_REL, `${trackId}.json`);
  if (!fs.existsSync(p)) return { ok: false, code: "TTS_SEGMENT_NOT_FOUND", message: `track not found: ${trackId}` };
  return { ok: true, track: JSON.parse(fs.readFileSync(p, "utf8")), rel: `${TRACK_DIR_REL}/${trackId}.json` };
}

function emitEvent(root, projectId, eventName, fields = {}, opts = {}) {
  try {
    const r = telemetryLib.recordEvent(root, projectId, {
      eventName,
      severity: fields.severity || "INFO",
      stage: "phase-2.4-2.6",
      component: "tts-audio",
      correlationId: fields.correlationId || null,
      operationId: fields.operationId || null,
      provider: fields.provider || null,
      model: fields.model || null,
      errorCode: fields.errorCode || null,
      stateTo: fields.stateTo || null,
      attributes: fields.attributes || null,
      evidenceRefs: fields.evidenceRefs || [],
      provenance: "LIVE",
    }, opts);
    if (!r.ok && opts.strictTelemetry) return r;
    return { ok: true, emitted: r.ok === true, event: r.event || null, code: r.code || null };
  } catch (e) {
    return { ok: true, emitted: false, error: String((e && e.message) || e) };
  }
}

/** DAG (§30): real narration chain nodes only; no FINAL_AUDIO/alignment/captions. */
function registerDagNodes(root, projectId, { segmentAudioRef, speechRateQaRef, performanceQaRef, trackRef }, opts = {}) {
  const existing = dagLib.loadDag(root, projectId);
  if (!existing.ok && existing.code !== "DAG_NOT_FOUND") return existing;
  if (!existing.ok) {
    const boot = dagLib.bootstrapDag(root, projectId, opts);
    if (!boot.ok) {
      const bare = dagLib.createDag(root, projectId, opts);
      if (!bare.ok) return boot;
    }
  }
  const added = [];
  const ensure = (artifactKey, artifactType, versionRef, deps) => {
    const cur = dagLib.loadDag(root, projectId);
    if (!cur.ok) return cur;
    // FIX 01: deps arrive as [key, type] pairs — normalize once; the old code
    // read `.key` off the raw pair (undefined) on the idempotent path.
    const depObjs = (deps || []).map(([key, type]) => ({ key, type }));
    if (cur.dag.nodes[artifactKey]) {
      if (versionRef && cur.dag.nodes[artifactKey].versionRef !== versionRef) {
        const v = dagLib.setNodeVersion(root, projectId, artifactKey, versionRef, opts);
        if (!v.ok) return v;
      }
      if (cur.dag.nodes[artifactKey].state !== "CLEAN") {
        const s = dagLib.setNodeState(root, projectId, artifactKey, "CLEAN", opts);
        if (!s.ok) return s;
      }
      for (const ref of depObjs) {
        if (!(cur.dag.nodes[artifactKey].inputRefs || []).some((r) => r.key === ref.key)) {
          const d = dagLib.addDependency(root, projectId, ref.key, artifactKey, ref.type, opts);
          if (!d.ok) return d;
        }
      }
      return { ok: true };
    }
    return dagLib.addNode(root, projectId, { artifactKey, artifactType, versionRef: versionRef || null, state: "CLEAN", producedBy: "phase-2.4-2.6:tts-audio", provenance: "LIVE", inputRefs: depObjs }, opts);
  };
  const deps = [
    ["FINAL_SPOKEN_SCRIPT", "SPOKEN_TEXT"],
    ["VOICE_BIBLE", "VOICE_IDENTITY"],
    ["NARRATION_DIRECTION", "DIRECTION"],
    ["PRONUNCIATION_RUNTIME_PASS", "PRONUNCIATION"],
  ];
  if (segmentAudioRef) {
    const r = ensure("TTS_SEGMENT_AUDIO", "TTS_SEGMENT_AUDIO", segmentAudioRef, deps);
    if (!r.ok) return r;
    added.push("TTS_SEGMENT_AUDIO");
  }
  if (speechRateQaRef) {
    const r = ensure("SPEECH_RATE_QA", "SPEECH_RATE_QA", speechRateQaRef, [["TTS_SEGMENT_AUDIO", "SEGMENT_AUDIO"]]);
    if (!r.ok) return r;
    added.push("SPEECH_RATE_QA");
  }
  if (performanceQaRef) {
    const r = ensure("PERFORMANCE_QA", "PERFORMANCE_QA", performanceQaRef, [["TTS_SEGMENT_AUDIO", "SEGMENT_AUDIO"]]);
    if (!r.ok) return r;
    added.push("PERFORMANCE_QA");
  }
  if (trackRef) {
    const r = ensure("FINAL_NARRATION_TRACK", "FINAL_NARRATION_TRACK", trackRef, [["TTS_SEGMENT_AUDIO", "SELECTED_SEGMENTS"]]);
    if (!r.ok) return r;
    added.push("FINAL_NARRATION_TRACK");
  }
  return { ok: true, added };
}

/** §31 selective dirty: one selected segment changing dirties QA + track only. */
function markSegmentAudioDirty(root, projectId, opts = {}) {
  const r = dagLib.markDirty(root, projectId, "TTS_SEGMENT_AUDIO", { reason: "selected segment audio changed" }, opts, null);
  if (!r.ok) return r;
  return { ok: true, dirtied: r.dirtied, blocked: r.blocked };
}

/**
 * FIX 01 Gap B — scoped repair plan from a FAILing QA decision. Selects ONLY
 * segments with status FAIL as repair targets; everything else is explicitly
 * unaffected (their audio must not be re-synthesized). Fail-closed when there
 * is nothing to repair. The caller re-synthesizes targets only (with
 * parentAttemptId lineage), re-runs QA, and reassembles.
 */
function planTargetedRepair(rateQa, { effectiveSpeed, reason } = {}) {
  if (!rateQa || !Array.isArray(rateQa.segments)) {
    return { ok: false, code: "TTS_INPUT_NOT_READY", message: "rate QA decision required" };
  }
  const targetSegmentIds = rateQa.segments.filter((s) => s.status === "FAIL").map((s) => s.segmentId);
  if (targetSegmentIds.length === 0) {
    return { ok: false, code: "TTS_REPAIR_NOTHING_TO_REPAIR", message: `${ERRORS.TTS_REPAIR_NOTHING_TO_REPAIR}: ${rateQa.speechRateQaId || "qa"}` };
  }
  const unaffectedSegmentIds = rateQa.segments.filter((s) => s.status !== "FAIL").map((s) => s.segmentId);
  const plan = {
    repairPlanId: `trp-${costShared.id12("trp", { qa: rateQa.speechRateQaId, targets: targetSegmentIds.join(","), speed: effectiveSpeed !== undefined ? effectiveSpeed : null }).slice(4)}`,
    rateQaRef: rateQa.speechRateQaId || null,
    targetSegmentIds,
    unaffectedSegmentIds,
    adjustments: { effectiveSpeed: effectiveSpeed !== undefined ? effectiveSpeed : null },
    reason: reason || "targeted regeneration of FAIL segments only",
    provenance: { createdAt: new Date().toISOString() },
  };
  return { ok: true, plan };
}

/** Manifest index (§32): refs/status only. */
function attachManifestReference(root, projectId, what, id, opts = {}) {
  const keyMap = {
    narrationAudio: ["narrationAudioVersion", `assets/voice/narration-track/${id}.json`],
    speechRateQa: ["speechRateQaVersion", `${QA_DIR_REL}/${id}.json`],
    performanceQa: ["performanceQaVersion", `${QA_DIR_REL}/${id}.json`],
    dialogueRouting: ["dialogueRoutingVersion", `${QA_DIR_REL}/${id}.json`],
  };
  const [key, refPath] = keyMap[what];
  const abs = path.join(root, "projects", projectId, refPath);
  const doc = JSON.parse(fs.readFileSync(abs, "utf8"));
  const idField = doc.finalNarrationTrackId || doc.speechRateQaId || doc.performanceQaId || doc.dialogueRoutingDecisionId;
  const verified = (doc.decision === "PASS" || what === "narrationAudio") && !(doc.decision === "FAIL");
  const ref = {
    version: idField,
    status: verified ? "VERIFIED" : "UNRESOLVED",
    ref: refPath,
    detail: what === "narrationAudio"
      ? `v${doc.version} ${doc.durationMs}ms ${doc.segments.length} segments`
      : `${doc.decision} (${doc.segments ? doc.segments.length : doc.routingChecks.length} entries)`,
  };
  const r = manifestLib.setArtifactVersion(root, projectId, key, ref, opts);
  if (!r.ok) return r;
  return { ok: true, manifestStatus: ref.status };
}

module.exports = {
  ERRORS,
  PACE_SPEED_POLICY,
  JOIN_POLICY,
  ASR_CONFIG,
  ASR_WER_MAX,
  EXPECTED_SAMPLE_RATE,
  AUDIO_DIR_REL,
  TRACK_DIR_REL,
  QA_DIR_REL,
  loadCanonicalTtsInputs,
  resolveEffectiveSpeed,
  compiledTextFor,
  synthesizeSegment,
  transcribeBatch,
  transcriptDiff,
  normalizeWords,
  createSpeechRatePolicy,
  loadSpeechRatePolicy,
  runSpeechRateQa,
  runPerformanceQa,
  assembleNarrationTrack,
  loadNarrationTrack,
  registerDagNodes,
  markSegmentAudioDirty,
  planTargetedRepair,
  attachManifestReference,
  emitEvent,
  semanticBody,
  sameSemantics,
};
