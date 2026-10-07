"use strict";

/**
 * Phase 2.8 — Audio Mix / Master (UNFOLDIQ CORE).
 *
 * Narration is the mix anchor: narration is normalized first (measured
 * BS.177-4 loudness), then Music/Ambience/SFX are staged around it with
 * measured per-asset loudness — never hard-coded percentages. Dynamic
 * ducking is importance-aware; QA is local, structured and actionable;
 * repair is bounded (attempts + hard stop) and never silent.
 */

const Ajv = require("ajv");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const wav = require("../audio-wav.js");
const loudness = require("../audio-loudness.js");
const engine = require("./engine.js");

const PLAN_VERSION = "2.0.0";

// Versioned loudness profiles (§4.9): never hard-code a broadcast value as
// universal target — profiles are selected per platform/content type.
const LOUDNESS_PROFILES = {
  "youtube-standard@1.0.0": {
    profileId: "youtube-standard",
    version: "1.0.0",
    platform: "youtube",
    contentType: "standard",
    targetIntegratedLoudness: -14,
    tolerance: 2,
    maxTruePeak: -1,
    minLoudnessRange: 3,
    maxLoudnessRange: 20,
    narrationTargetLufs: -16,
    minSpeechSeparationDb: 10,
  },
  "tiktok-short@1.0.0": {
    profileId: "tiktok-short",
    version: "1.0.0",
    platform: "tiktok",
    contentType: "short",
    targetIntegratedLoudness: -14,
    tolerance: 2,
    maxTruePeak: -1,
    narrationTargetLufs: -16,
    minSpeechSeparationDb: 10,
  },
};

// Role gain targets: offsets from the narration anchor (§4.3 measured staging).
const ROLE_TARGET_OFFSET_DB = {
  "music:BED": -16,
  "music:FEATURED": -4,
  "ambience:BACKGROUND": -26,
  "ambience:FOREGROUND": -12,
  "sfx:BACKGROUND": -22,
  "sfx:SUPPORTING": -14,
  "sfx:FEATURED": -6,
};

const DUCK_INTENSITY_BY_PURPOSE = {
  TENSION: "MEDIUM",
  EMOTION: "MEDIUM",
  PACING: "LIGHT",
  TRANSITION: "LIGHT",
  IDENTITY: "MEDIUM",
  ENERGY: "MEDIUM",
  CONTRAST: "MEDIUM",
};

const ERRORS = {
  MIX_PLAN_SCHEMA_INVALID: "audio mix plan fails schema validation",
  MIX_INPUT_INVALID: "audio mix inputs missing/invalid",
  SOURCE_DECODE_FAILED: "mix source audio is not decodable PCM16 WAV",
  QA_BUDGET_EXHAUSTED: "repair budget exhausted — REVIEW_REQUIRED",
  NON_LOCAL_REPAIR_REQUIRED: "repair requires upstream Phase 2.7 action",
};

let _validator = null;
function validator() {
  if (!_validator) {
    const ajv = new Ajv({ allErrors: true, strict: false });
    const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "schemas", "audio-mix-plan.schema.json"), "utf8"));
    _validator = ajv.compile(schema);
  }
  return _validator;
}

function sha256Hex(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function clampGain(db) {
  return Math.max(-24, Math.min(12, db));
}

function decodeNarration(bytes, mixFs) {
  const d = engine.decodeToMonoFloat(bytes, mixFs);
  if (!d.ok) return d;
  return d;
}

// ---------- narration normalization (§4.2) ----------

/**
 * Normalize narration first: track-level measured gain toward
 * profile.narrationTargetLufs, per-segment consistency correction capped
 * at ±3 dB so leveling never becomes pumping.
 */
function normalizeNarration(segmentsWithBytes, mixFs, narrationTargetLufs) {
  const decoded = segmentsWithBytes.map((s) => ({ seg: s, d: decodeNarration(s.bytes, mixFs) }));
  const failed = decoded.find((x) => !x.d.ok);
  if (failed) return failed;
  const concatLen = decoded.reduce((n, x) => n + x.d.samples.length, 0);
  const concat = new Float64Array(concatLen);
  let cursor = 0;
  for (const x of decoded) {
    concat.set(x.d.samples, cursor);
    cursor += x.d.samples.length;
  }
  const trackLoud = loudness.measureLoudness(
    concatToPcm(concat), mixFs
  );
  const measured = Number.isFinite(trackLoud.integratedLufs) ? trackLoud.integratedLufs : -70;
  const baseGainDb = Math.max(-12, Math.min(12, narrationTargetLufs - measured));
  const clips = decoded.map((x) => {
    const segLoud = loudness.measureLoudness(concatToPcm(x.d.samples), mixFs);
    const segMeasured = Number.isFinite(segLoud.integratedLufs) ? segLoud.integratedLufs : -70;
    const segCorrection = Math.max(-3, Math.min(3, narrationTargetLufs - segMeasured - baseGainDb));
    return {
      clipId: `voice-${x.seg.segmentId}`,
      segmentId: x.seg.segmentId,
      path: x.seg.path,
      startMs: x.seg.startMs,
      endMs: x.seg.endMs,
      durationMs: x.seg.endMs - x.seg.startMs,
      importance: x.seg.importance || "NORMAL",
      gainDb: Number((baseGainDb + segCorrection).toFixed(2)),
      timingStatus: "MEASURED",
    };
  });
  return {
    ok: true,
    clips,
    evidence: {
      measuredTrackLufs: Number(measured.toFixed(2)),
      baseGainDb: Number(baseGainDb.toFixed(2)),
    },
  };
}

function concatToPcm(float) {
  const pcm = new Int16Array(float.length);
  for (let i = 0; i < float.length; i += 1) pcm[i] = Math.max(-32768, Math.min(32767, Math.round(float[i] * 32768)));
  return pcm;
}

function measureBytesLufs(bytes, mixFs) {
  const d = engine.decodeToMonoFloat(bytes, mixFs);
  if (!d.ok) return null;
  const l = loudness.measureLoudness(concatToPcm(d.samples), mixFs);
  return Number.isFinite(l.integratedLufs) ? l.integratedLufs : null;
}

// ---------- mix plan builder (2.8-A) ----------

/**
 * inputs:
 *   projectId, narrationSegments [{segmentId, path, bytes?, startMs, endMs, importance?}],
 *   musicPlan (2.7 artifact, cues locked/QA-passed), repoRoot (library bytes),
 *   profileRef | profile (loudness profile), sfxAssets {assetId→path},
 *   ambienceAssets {assetId→path}, inputHashes {}
 */
function buildMixPlan(inputs = {}) {
  const t0 = Date.now();
  const { projectId, narrationSegments, musicPlan, repoRoot } = inputs;
  if (!projectId || !Array.isArray(narrationSegments) || !musicPlan) {
    return { ok: false, code: "MIX_INPUT_INVALID", message: ERRORS.MIX_INPUT_INVALID };
  }
  const profile = inputs.profile || LOUDNESS_PROFILES[inputs.profileRef || "youtube-standard@1.0.0"];
  if (!profile) return { ok: false, code: "MIX_INPUT_INVALID", message: "unknown loudness profile" };
  const mixFs = inputs.sampleRate || 24000;
  const narrationTarget = profile.narrationTargetLufs || -16;

  // 1. Narration anchor.
  const withBytes = narrationSegments.map((s) => ({
    ...s,
    bytes: s.bytes || fs.readFileSync(s.path),
  }));
  const norm = normalizeNarration(withBytes, mixFs, narrationTarget);
  if (!norm.ok) return norm;

  // 2. Music cues with measured gain staging + ducking rules.
  const musicClips = [];
  const duckingRules = [];
  const library = require("../music-library/index.js");
  for (const cue of musicPlan.cues) {
    if (!cue.assetId) continue;
    const rec = library.getAsset(repoRoot, cue.assetId);
    if (!rec) return { ok: false, code: "MIX_INPUT_INVALID", message: `asset ${cue.assetId} missing from library` };
    const bytes = library.readAssetBytes(repoRoot, cue.assetId);
    const lufs = measureBytesLufs(bytes, mixFs) || -30;
    const role = `music:${cue.role}`;
    const target = narrationTarget + (ROLE_TARGET_OFFSET_DB[role] !== undefined ? ROLE_TARGET_OFFSET_DB[role] : -14);
    const clipId = cue.cueId;
    const narrationOverlaps = narrationSegments.some((s) => s.startMs < cue.timelineEndMs && s.endMs > cue.timelineStartMs);
    const intensity = cue.role === "FEATURED" ? "LIGHT" : (DUCK_INTENSITY_BY_PURPOSE[cue.purpose] || "MEDIUM");
    musicClips.push({
      clipId,
      path: path.join(repoRoot, rec.audioRef),
      startMs: cue.timelineStartMs,
      durationMs: cue.timelineEndMs - cue.timelineStartMs,
      trimStartMs: cue.sourceStartMs,
      trimEndMs: cue.sourceEndMs,
      gainDb: clampGain(Number((target - lufs).toFixed(2))),
      fadeInMs: 300,
      fadeOutMs: 800,
      loop: !!(cue.loopPlan && cue.loopPlan.strategy === "LOOP"),
      loopPlan: cue.loopPlan,
      ducking: narrationOverlaps
        ? { enabled: true, targetAudioId: "NARRATION", intensity, recoveryIntent: "NATURAL" }
        : { enabled: false },
      purpose: cue.purpose || cue.role,
      rightsStatus: (cue.usageDecisionRef || "").split(":")[1] || "UNKNOWN",
      timingStatus: "PLANNED",
    });
    if (narrationOverlaps) {
      duckingRules.push({
        targetId: clipId,
        againstId: "NARRATION",
        intensity,
        attackMs: engine.ATTACK_MS,
        releaseMs: engine.RELEASE_MS.NATURAL,
        reason: `duck ${intensity} music under narration (purpose ${cue.purpose || cue.role})`,
      });
    }
  }

  // 3. Ambience + SFX with measured staging.
  const ambienceClips = [];
  for (const amb of musicPlan.ambience || []) {
    const p = (inputs.ambienceAssets || {})[amb.assetId];
    if (!p) continue;
    const lufs = measureBytesLufs(fs.readFileSync(p), mixFs) || -35;
    const role = `ambience:${amb.layer || "BACKGROUND"}`;
    const target = narrationTarget + (ROLE_TARGET_OFFSET_DB[role] !== undefined ? ROLE_TARGET_OFFSET_DB[role] : -26);
    ambienceClips.push({
      clipId: amb.cueId,
      path: p,
      startMs: amb.startMs,
      durationMs: amb.endMs - amb.startMs,
      gainDb: clampGain(Number((target - lufs).toFixed(2))),
      fadeInMs: amb.fadeInMs !== undefined ? amb.fadeInMs : 800,
      fadeOutMs: amb.fadeOutMs !== undefined ? amb.fadeOutMs : 800,
      purpose: amb.reason,
      rightsStatus: (amb.usageDecisionRef || "").split(":")[1] || "UNKNOWN",
      timingStatus: "PLANNED",
    });
  }
  const sfxClips = [];
  for (const s of musicPlan.sfx || []) {
    const p = (inputs.sfxAssets || {})[s.assetId];
    if (!p) continue;
    const lufs = measureBytesLufs(fs.readFileSync(p), mixFs) || -25;
    const role = `sfx:${s.priority}`;
    const target = narrationTarget + (ROLE_TARGET_OFFSET_DB[role] !== undefined ? ROLE_TARGET_OFFSET_DB[role] : -14);
    sfxClips.push({
      clipId: s.cueId,
      path: p,
      startMs: s.timelineStartMs,
      durationMs: s.durationMs,
      gainDb: clampGain(Number((target - lufs).toFixed(2))),
      purpose: s.purpose || s.reason,
      rightsStatus: (s.usageDecisionRef || "").split(":")[1] || "UNKNOWN",
      timingStatus: "PLANNED",
      duckMusic: s.duckMusic === true,
      priority: s.priority,
    });
  }

  const narrationTimingHash = sha256Hex(Buffer.from(JSON.stringify(
    narrationSegments.map((s) => ({ segmentId: s.segmentId, startMs: s.startMs, endMs: s.endMs }))
  )));

  const plan = {
    version: PLAN_VERSION,
    projectId,
    tracks: {
      voice: norm.clips.map((c) => {
        const { endMs, ...rest } = c;
        return rest;
      }),
      music: musicClips,
      ambience: ambienceClips,
      sfx: sfxClips,
    },
    status: "READY",
    generatedAt: new Date().toISOString(),
    generatedClipAudioPolicy: "MUTE_GENERATED_CLIP_AUDIO",
    loudness: {
      status: "MEASURED",
      integratedLufs: norm.evidence.measuredTrackLufs,
      tool: "lib/audio-loudness.js bs1770-4",
    },
    loudnessProfileRef: `${profile.profileId}@${profile.version}`,
    peakPolicyRef: `maxTruePeak ${profile.maxTruePeak} dBTP`,
    narrationTrack: "voice",
    duckingRules,
    inputHashes: { ...(inputs.inputHashes || {}), narrationTiming: narrationTimingHash },
  };
  const valid = validator()(plan);
  if (!valid) return { ok: false, code: "MIX_PLAN_SCHEMA_INVALID", message: ajvText(validator().errors) };
  return {
    ok: true,
    mixPlan: plan,
    profile,
    metrics: { buildMixPlanMs: Date.now() - t0, narrationMeasuredLufs: norm.evidence.measuredTrackLufs },
  };
}

// ---------- mix QA (2.8-E/F) ----------

function rmsDb(samples, fs, startMs, endMs) {
  const s = Math.max(0, Math.round((startMs / 1000) * fs));
  const e = Math.min(samples.length, Math.round((endMs / 1000) * fs));
  if (e <= s) return -120;
  let sum = 0;
  for (let i = s; i < e; i += 1) sum += samples[i] * samples[i];
  const rms = Math.sqrt(sum / (e - s));
  return rms > 0 ? 20 * Math.log10(rms) : -120;
}

/**
 * Technical + mix QA over a rendered mix. Findings are actionable per §4.14.
 */
function mixQA(mixResult, mixPlan, { profile, intentionalSilence = [], attempt = 0, expectedDurationMs } = {}) {
  const t0 = Date.now();
  const findings = [];
  const masterPcm = floatToPcm(mixResult.master);
  const measured = loudness.measureLoudness(masterPcm, mixResult.mixFs);
  const peakVal = measurePeak(masterPcm);
  const voiceStems = mixResult.stems.filter((s) => s.role === "voice");
  const voiceStem = voiceStems.length
    ? { samples: voiceStems.reduce((acc, s) => {
        for (let i = 0; i < acc.length; i += 1) acc[i] += s.samples[i];
        return acc;
      }, new Float64Array(mixResult.master.length)) }
    : null;
  const musicStems = mixResult.stems.filter((s) => s.role === "music");

  if (peakVal >= 32700) {
    findings.push(qa("FAIL", "CLIPPING", {
      reason: `master peak ${peakVal} at int16 ceiling`,
      correctiveAction: "GAIN_CORRECTION",
      deficitDb: Number((20 * Math.log10(Math.max(1, peakVal) / 32000)).toFixed(2)),
    }));
  }
  if (Number.isFinite(measured.truePeakDb) && measured.truePeakDb > profile.maxTruePeak) {
    findings.push(qa("FAIL", "TRUE_PEAK_POLICY_FAIL", {
      reason: `true peak ${measured.truePeakDb} dBTP > policy ${profile.maxTruePeak}`,
      correctiveAction: "LIMIT",
      deficitDb: Number((measured.truePeakDb - profile.maxTruePeak + 1).toFixed(2)),
    }));
  }
  if (Number.isFinite(measured.integratedLufs) &&
      Math.abs(measured.integratedLufs - profile.targetIntegratedLoudness) > profile.tolerance) {
    findings.push(qa("FAIL", "LOUDNESS_OUT_OF_POLICY", {
      reason: `integrated ${measured.integratedLufs} LUFS outside ${profile.targetIntegratedLoudness}±${profile.tolerance}`,
      correctiveAction: "REMASTER",
    }));
  }
  if (measured.loudnessRange !== null && profile.maxLoudnessRange !== undefined && measured.loudnessRange > profile.maxLoudnessRange) {
    findings.push(qa("REVIEW_REQUIRED", "LOUDNESS_RANGE_OUT_OF_POLICY", {
      reason: `LRA ${measured.loudnessRange} > ${profile.maxLoudnessRange}`,
      correctiveAction: null,
    }));
  }

  // Speech intelligibility: music under narration must respect separation.
  const minSep = profile.minSpeechSeparationDb !== undefined ? profile.minSpeechSeparationDb : 10;
  for (const range of mixPlan.tracks.voice) {
    const startMs = range.startMs;
    const endMs = range.startMs + (range.durationMs || 0);
    const voiceDb = voiceStem ? rmsDb(voiceStem.samples, mixResult.mixFs, startMs, endMs) : -120;
    if (voiceDb <= -100) continue;
    for (const m of musicStems) {
      const musicDb = rmsDb(m.samples, mixResult.mixFs, startMs, endMs);
      const separation = voiceDb - musicDb;
      if (separation < minSep) {
        const clip = mixPlan.tracks.music.find((c) => c.clipId === m.clipId);
        findings.push(qa("FAIL", "MUSIC_MASKS_SPEECH", {
          affectedStartMs: startMs,
          affectedEndMs: endMs,
          cueId: m.clipId,
          assetId: clip ? clip.clipId : undefined,
          reason: `music/voice separation ${separation.toFixed(1)} dB < ${minSep} dB in narration range`,
          correctiveAction: clip && clip.ducking && clip.ducking.enabled ? "ADJUST_DUCKING" : "ADJUST_MUSIC_GAIN",
          deficitDb: Number((minSep - separation).toFixed(2)),
        }));
      }
    }
  }

  // Ducking behavior: pumping + abnormal gain jumps on envelopes.
  for (const [clipId, env] of Object.entries(mixResult.duckEnvelopes)) {
    const pumpings = countPumping(env.env);
    if (pumpings > 2) {
      findings.push(qa("FAIL", "DUCK_PUMPING", { cueId: clipId, reason: `${pumpings} duck oscillations within speech region`, correctiveAction: "ADJUST_ATTACK_RELEASE" }));
    }
    const jump = maxEnvelopeJumpDb(env.env);
    if (jump > 6) {
      findings.push(qa("FAIL", "ABNORMAL_GAIN_JUMP", { cueId: clipId, reason: `envelope jump ${jump.toFixed(1)} dB in 10ms`, correctiveAction: "ADJUST_ATTACK_RELEASE" }));
    }
  }

  // Accidental silence vs intentional silence. Fade tails leak ~1s around
  // declared ranges, so comparison allows a 1000ms margin on both sides.
  const SILENCE_DECLARATION_MARGIN_MS = 1000;
  const silences = wav.measure(masterPcm, mixResult.mixFs, { minSilenceMs: 1500, silenceRmsThreshold: 40 }).silenceSpans;
  for (const s of silences) {
    const declared = intentionalSilence.some((i) =>
      i.startMs - SILENCE_DECLARATION_MARGIN_MS <= s.startMs && s.endMs <= i.endMs + SILENCE_DECLARATION_MARGIN_MS
    );
    if (!declared) {
      findings.push(qa("FAIL", "UNEXPECTED_SILENCE", {
        affectedStartMs: s.startMs,
        affectedEndMs: s.endMs,
        reason: `${s.durationMs}ms silent region not declared as intentional silence`,
        correctiveAction: "REPAIR_TIMING",
      }));
    }
  }

  // Narration level consistency.
  if (voiceStem && mixPlan.tracks.voice.length > 1) {
    const levels = mixPlan.tracks.voice.map((c) => rmsDb(voiceStem.samples, mixResult.mixFs, c.startMs, c.startMs + (c.durationMs || 0)));
    const spread = Math.max(...levels) - Math.min(...levels);
    if (spread > 6) {
      findings.push(qa("FAIL", "NARRATION_LEVEL_INCONSISTENT", { reason: `narration level spread ${spread.toFixed(1)} dB > 6 dB`, correctiveAction: "NORMALIZE_NARRATION" }));
    }
  }

  if (typeof expectedDurationMs === "number" && Math.abs(mixResult.durationMs - expectedDurationMs) > 250) {
    findings.push(qa("FAIL", "DURATION_MISMATCH", {
      reason: `mix duration ${mixResult.durationMs}ms vs expected ${expectedDurationMs}ms`,
      correctiveAction: "REPAIR_TIMING",
    }));
  }

  const fail = findings.some((f) => f.status === "FAIL");
  return {
    ok: !fail,
    status: fail ? "FAIL" : (findings.length ? "REVIEW_REQUIRED" : "PASS"),
    findings,
    metrics: {
      integratedLufs: measured.integratedLufs,
      loudnessRange: measured.loudnessRange,
      truePeakDb: measured.truePeakDb,
      peak: peakVal,
      mixQaMs: Date.now() - t0,
    },
  };
}

function qa(status, code, extra) {
  return { status, code, reason: extra.reason, correctiveAction: extra.correctiveAction || null, attempt: undefined,
    affectedStartMs: extra.affectedStartMs, affectedEndMs: extra.affectedEndMs, cueId: extra.cueId, assetId: extra.assetId,
    deficitDb: extra.deficitDb };
}

function measurePeak(pcm) {
  let peak = 0;
  for (let i = 0; i < pcm.length; i += 1) {
    const a = Math.abs(pcm[i]);
    if (a > peak) peak = a;
  }
  return peak;
}

function floatToPcm(float) {
  const pcm = new Int16Array(float.length);
  for (let i = 0; i < float.length; i += 1) pcm[i] = Math.max(-32768, Math.min(32767, Math.round(float[i] * 32768)));
  return pcm;
}

/** Pumping = local minima that recover within a short window. */
function countPumping(env) {
  let count = 0;
  let inDip = false;
  let dipMin = 1;
  for (let i = 1; i < env.length; i += 1) {
    if (!inDip && env[i] < 0.85 && env[i - 1] >= 0.85) { inDip = true; dipMin = env[i]; }
    else if (inDip) {
      if (env[i] < dipMin) dipMin = env[i];
      if (env[i] > 0.9) {
        count += 1;
        inDip = false;
      }
    }
  }
  return count;
}

function maxEnvelopeJumpDb(env) {
  let max = 0;
  for (let i = 1; i < env.length; i += 1) {
    if (env[i] <= 0.0001 || env[i - 1] <= 0.0001) continue;
    const delta = Math.abs(20 * Math.log10(env[i] / env[i - 1]));
    if (delta > max) max = delta;
  }
  return max;
}

// ---------- bounded structured repair (2.8-F, §4.14/§4.15) ----------

const REPAIR_BUDGET = { maxAttemptsPerCode: 3, maxTotalAttempts: 6 };

const NON_LOCAL_CODES = new Set(["RETURN_2_7", "REPLACE_TRACK", "REPLACE_ASSET"]);

/**
 * Apply corrective actions to a WORKING COPY of the mix plan (local repair).
 * Returns { ok, plan, applied[], requiresUpstream }.
 */
function applyRepairs(plan, findings) {
  const working = JSON.parse(JSON.stringify(plan));
  const applied = [];
  // Dedupe repeated findings on the same target (keep the max deficit) so a
  // single repair pass cuts a clip's gain once, not once per finding.
  const byKey = new Map();
  for (const f of findings) {
    if (f.status !== "FAIL" || !f.correctiveAction) continue;
    const key = `${f.code}:${f.cueId || f.correctiveAction}`;
    const prev = byKey.get(key);
    if (!prev || ((f.deficitDb || 0) > (prev.deficitDb || 0))) byKey.set(key, f);
  }
  for (const f of byKey.values()) {
    if (NON_LOCAL_CODES.has(f.correctiveAction)) {
      return { ok: false, plan: working, applied, requiresUpstream: f.correctiveAction };
    }
    const cueId = f.cueId;
    switch (f.correctiveAction) {
      case "ADJUST_MUSIC_GAIN": {
        const clip = working.tracks.music.find((c) => c.clipId === cueId) ||
          working.tracks.music[working.tracks.music.length - 1];
        if (clip) {
          const deficit = f.deficitDb || 3;
          clip.gainDb = Math.max(-24, clip.gainDb - (deficit + 1));
          applied.push({ code: f.code, action: "ADJUST_MUSIC_GAIN", targetId: clip.clipId, newGainDb: clip.gainDb });
        }
        break;
      }
      case "ADJUST_DUCKING": {
        const clip = working.tracks.music.find((c) => c.clipId === cueId);
        if (clip && clip.ducking) {
          const deficit = f.deficitDb || 3;
          if (!clip.ducking.enabled) {
            clip.ducking.enabled = true;
            clip.ducking.intensity = "MEDIUM";
          } else if (deficit > 4 || clip.ducking.intensity === "STRONG") {
            // Large deficit (or already at max depth): go to STRONG and cut
            // clip gain by the measured deficit in one bounded step.
            clip.ducking.intensity = "STRONG";
            clip.gainDb = Math.max(-24, clip.gainDb - (deficit + 1));
          } else {
            clip.ducking.intensity = "STRONG";
          }
          applied.push({ code: f.code, action: "ADJUST_DUCKING", targetId: clip.clipId, intensity: clip.ducking.intensity, newGainDb: clip.gainDb });
        }
        break;
      }
      case "ADJUST_ATTACK_RELEASE": {
        const clip = working.tracks.music.find((c) => c.clipId === cueId);
        if (clip && clip.ducking) {
          clip.ducking.recoveryIntent = clip.ducking.recoveryIntent === "NATURAL" ? "SLOW" : "SLOW";
          applied.push({ code: f.code, action: "ADJUST_ATTACK_RELEASE", targetId: clip.clipId, recoveryIntent: clip.ducking.recoveryIntent });
        }
        break;
      }
      case "REPAIR_FADE":
      case "REPAIR_CROSSFADE": {
        const clip = (working.tracks.music.find((c) => c.clipId === cueId)) || working.tracks.music[0];
        if (clip) {
          clip.fadeInMs = (clip.fadeInMs || 0) + 200;
          clip.fadeOutMs = (clip.fadeOutMs || 0) + 200;
          applied.push({ code: f.code, action: f.correctiveAction, targetId: clip.clipId, fadeInMs: clip.fadeInMs, fadeOutMs: clip.fadeOutMs });
        }
        break;
      }
      case "GAIN_CORRECTION": {
        // Headroom-aware: reduce secondary stems by the measured deficit.
        const amount = (f.deficitDb || 1.5) + 1;
        for (const t of ["music", "ambience", "sfx"]) {
          for (const c of working.tracks[t]) c.gainDb = Math.max(-24, c.gainDb - amount);
        }
        applied.push({ code: f.code, action: "GAIN_CORRECTION", targetId: "ALL_SECONDARY", amountDb: Number(amount.toFixed(2)) });
        break;
      }
      case "LIMIT": {
        working.limiter = { enabled: true, ceilingDb: -1.3 };
        applied.push({ code: f.code, action: "LIMIT", targetId: "MASTER" });
        break;
      }
      case "NORMALIZE_NARRATION": {
        const measured = (working.loudness && working.loudness.integratedLufs) || null;
        for (const c of working.tracks.voice) c.gainDb = Math.max(-12, Math.min(12, c.gainDb - 1));
        applied.push({ code: f.code, action: "NORMALIZE_NARRATION", targetId: "VOICE", referenceLufs: measured });
        break;
      }
      case "ADJUST_SFX_GAIN": {
        const clip = working.tracks.sfx.find((c) => c.clipId === cueId);
        if (clip) { clip.gainDb -= 3; applied.push({ code: f.code, action: "ADJUST_SFX_GAIN", targetId: clip.clipId }); }
        break;
      }
      case "ADJUST_AMBIENCE_GAIN": {
        const clip = working.tracks.ambience.find((c) => c.clipId === cueId);
        if (clip) { clip.gainDb -= 3; applied.push({ code: f.code, action: "ADJUST_AMBIENCE_GAIN", targetId: clip.clipId }); }
        break;
      }
      case "REPAIR_TIMING":
      case "TRY_ALTERNATE_LOOP":
      default:
        return { ok: false, plan: working, applied, requiresUpstream: f.correctiveAction };
    }
  }
  return { ok: true, plan: working, applied, requiresUpstream: null };
}

/**
 * Full bounded repair loop: execute → QA → repair → re-QA.
 * Stops on PASS, budget exhaustion (REVIEW_REQUIRED) or upstream needs.
 */
function mixWithRepair(inputs = {}) {
  const { mixPlan, profile, intentionalSilence = [] } = inputs;
  const resolveAudio = inputs.resolveAudio || ((p) => fs.readFileSync(p));
  const lineage = [];
  const codeAttempts = {};
  let working = JSON.parse(JSON.stringify(mixPlan));
  let attempt = 0;
  let lastQa = null;
  let lastResult = null;
  while (attempt <= REPAIR_BUDGET.maxTotalAttempts) {
    const execOpts = { sampleRate: inputs.sampleRate || 24000, resolveAudio };
    if (working.limiter && working.limiter.enabled) execOpts.limiter = working.limiter;
    if (working.remasterGainDb !== undefined) execOpts.masterGainDb = working.remasterGainDb;
    const result = engine.executeMix(working, execOpts);
    if (!result.ok) {
      return { ok: false, code: "SOURCE_DECODE_FAILED", message: result.message, lineage };
    }
    const qaResult = mixQA(result, working, {
      profile,
      intentionalSilence,
      attempt,
      expectedDurationMs: inputs.expectedDurationMs,
    });
    lineage.push({
      attempt,
      status: qaResult.status,
      findings: qaResult.findings.map((f) => ({ code: f.code, reason: f.reason, correctiveAction: f.correctiveAction })),
      metrics: qaResult.metrics,
      applied: [],
    });
    lastQa = qaResult;
    lastResult = result;
    if (qaResult.ok) break;

    const newCodes = qaResult.findings.filter((f) => f.status === "FAIL").filter((f) => {
      codeAttempts[f.code] = (codeAttempts[f.code] || 0) + 1;
      return codeAttempts[f.code] <= REPAIR_BUDGET.maxAttemptsPerCode;
    });
    if (newCodes.length === 0) {
      return { ok: false, status: "REVIEW_REQUIRED", code: "QA_BUDGET_EXHAUSTED", message: ERRORS.QA_BUDGET_EXHAUSTED, qa: qaResult, lineage };
    }
    // REMASTER is a master-level action handled here (needs the rendered
    // master); every other finding goes through the local repair table.
    const actionable = newCodes.filter((f) => f.correctiveAction !== "REMASTER");
    const remasterFinding = newCodes.find((f) => f.correctiveAction === "REMASTER");
    const repair = applyRepairs(working, actionable);
    lineage[attempt].applied = repair.applied;
    working = repair.plan;
    if (!repair.ok) {
      return {
        ok: false,
        status: "RETURN_2_7",
        code: "NON_LOCAL_REPAIR_REQUIRED",
        message: `${ERRORS.NON_LOCAL_REPAIR_REQUIRED}: ${repair.requiresUpstream}`,
        qa: qaResult,
        lineage,
      };
    }
    if (remasterFinding) {
      const pcm = floatToPcm(result.master);
      const m = loudness.measureLoudness(pcm, result.mixFs);
      if (Number.isFinite(m.integratedLufs)) {
        // Cumulative: the rendered master already includes the previous
        // remaster gain, so add the remaining delta toward the target.
        const currentGain = working.remasterGainDb || 0;
        working.remasterGainDb = Number((currentGain + (profile.targetIntegratedLoudness - m.integratedLufs)).toFixed(2));
        // A remaster that would clip is not a remaster (§4.10): loudness
        // gain always ships with a true-peak limiter (0.3 dB interpolation
        // margin under the policy ceiling).
        working.limiter = { enabled: true, ceilingDb: Number((profile.maxTruePeak - 0.3).toFixed(2)) };
        lineage[attempt].applied = [...lineage[attempt].applied, { code: remasterFinding.code, action: "REMASTER", masterGainDb: working.remasterGainDb, limiter: working.limiter }];
      }
    }
    attempt += 1;
  }
  if (!lastQa || !lastQa.ok) {
    return { ok: false, status: "REVIEW_REQUIRED", code: "QA_BUDGET_EXHAUSTED", message: ERRORS.QA_BUDGET_EXHAUSTED, qa: lastQa, lineage };
  }
  return { ok: true, status: "PASS", mixPlan: working, mixResult: lastResult, qa: lastQa, lineage, attempts: attempt };
}

// ---------- Final Audio artifact (2.8 finalize) ----------

/**
 * Write Final Audio WAV + build the versioned FinalAudioArtifact.
 * narrationSegments needed for narrationTimingHash (invalidation policy §5).
 */
function finalizeFinalAudio({ mixResult, mixPlan, qaResult, narrationSegments, outputDir, sourceDependencies = [] }) {
  const pcm = floatToPcm(mixResult.master);
  const wavBytes = wav.encodeWav(pcm, mixResult.mixFs, 1);
  fs.mkdirSync(outputDir, { recursive: true });
  const mixPlanVersion = mixPlan.version;
  const narrationTimingHash = sha256Hex(Buffer.from(JSON.stringify(
    (narrationSegments || []).map((s) => ({ segmentId: s.segmentId, startMs: s.startMs, endMs: s.endMs }))
  )));
  const finalMixHash = sha256Hex(wavBytes);
  const assetId = `final-audio-${finalMixHash.slice(0, 12)}`;
  const filePath = path.join(outputDir, `${assetId}.wav`);
  fs.writeFileSync(filePath, wavBytes);
  const measured = loudness.measureLoudness(pcm, mixResult.mixFs);
  const artifact = {
    assetId,
    mixPlanVersion,
    durationMs: mixResult.durationMs,
    integratedLoudness: measured.integratedLufs,
    loudnessRange: measured.loudnessRange,
    truePeak: measured.truePeakDb,
    qaStatus: "PASS",
    narrationTimingHash,
    finalMixHash,
    sourceDependencies,
    hash: sha256Hex(Buffer.from(JSON.stringify({
      mixPlanVersion, durationMs: mixResult.durationMs, narrationTimingHash, finalMixHash,
    }))),
    createdAt: new Date().toISOString(),
  };
  return { ok: true, artifact, wavBytes, filePath };
}

function ajvText(errors) {
  return (errors || []).map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ");
}

module.exports = {
  PLAN_VERSION,
  LOUDNESS_PROFILES,
  ROLE_TARGET_OFFSET_DB,
  ERRORS,
  REPAIR_BUDGET,
  buildMixPlan,
  normalizeNarration,
  mixQA,
  applyRepairs,
  mixWithRepair,
  finalizeFinalAudio,
  engine,
  validateMixPlan(plan) {
    const ok = validator()(plan);
    return { ok, errors: ok ? [] : ajvText(validator().errors) };
  },
};
