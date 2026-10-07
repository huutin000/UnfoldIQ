"use strict";

/**
 * Phase 2.8-B/C/D — deterministic mix engine (UNFOLDIQ CORE).
 *
 * Pure-JS PCM16 renderer over real decoded bytes. The planner decides intent;
 * THIS module manipulates waveform: trim, loop, gain, fades, crossfades,
 * dynamic duck envelopes, stem summing. Every number applied here is measured
 * or comes from the mix plan — never invented.
 */

const wav = require("../audio-wav.js");
const loudness = require("../audio-loudness.js");

const RESAMPLE_MODE = "linear"; // deterministic; only used when source fs ≠ mix fs

// Duck depth (dB) per intensity; recovery times per recovery intent (§4.4).
const DUCK_DEPTH_DB = { LIGHT: 6, MEDIUM: 12, STRONG: 15 };
const ATTACK_MS = 40;
const RELEASE_MS = { NATURAL: 800, FAST: 250, SLOW: 1500 };
const IMPORTANCE_DEPTH_MULTIPLIER = { NORMAL: 1.0, IMPORTANT: 1.15, CRITICAL: 1.3 };
const SFX_DUCK_DB = 6;

function dbToLinear(db) {
  return Math.pow(10, db / 20);
}

function decodeToMonoFloat(bytes, mixFs) {
  const d = wav.decodeWav(bytes);
  if (!d.ok) return { ok: false, code: "DECODE_FAILED", message: "source audio is not decodable PCM16 WAV" };
  let samples = d.samples;
  const ch = d.channels;
  if (ch > 1) {
    const n = Math.floor(samples.length / ch);
    const mono = new Float64Array(n);
    for (let i = 0; i < n; i += 1) {
      let acc = 0;
      for (let c = 0; c < ch; c += 1) acc += samples[i * ch + c];
      mono[i] = acc / ch / 32768;
    }
    samples = mono;
  } else {
    const mono = new Float64Array(samples.length);
    for (let i = 0; i < samples.length; i += 1) mono[i] = samples[i] / 32768;
    samples = mono;
  }
  if (d.sampleRate !== mixFs) samples = resampleLinear(samples, d.sampleRate, mixFs);
  return { ok: true, samples, fs: mixFs };
}

function resampleLinear(samples, fromFs, toFs) {
  const ratio = fromFs / toFs;
  const outLen = Math.max(1, Math.round(samples.length / ratio));
  const out = new Float64Array(outLen);
  for (let i = 0; i < outLen; i += 1) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const frac = pos - i0;
    const a = samples[Math.min(i0, samples.length - 1)];
    const b = samples[Math.min(i0 + 1, samples.length - 1)];
    out[i] = a + (b - a) * frac;
  }
  return out;
}

function trim(samples, fs, startMs, endMs) {
  const s = Math.max(0, Math.min(samples.length, Math.round((startMs / 1000) * fs)));
  const e = Math.max(s, Math.min(samples.length, Math.round((endMs / 1000) * fs)));
  return samples.slice(s, e);
}

/** Deterministic loop renderer: head + crossfaded loop repetitions (§4.8). */
function renderLooped(region, loopStartMs, loopEndMs, crossfadeMs, fs, targetLenSamples) {
  const loopStart = Math.round((loopStartMs / 1000) * fs);
  const loopEnd = Math.min(region.length, Math.round((loopEndMs / 1000) * fs));
  const head = region.slice(0, loopStart);
  const loop = region.slice(loopStart, loopEnd);
  const tailStart = loopEnd;
  if (loop.length === 0 || head.length >= targetLenSamples) return region.slice(0, Math.max(targetLenSamples, 0));
  const xLen = Math.min(Math.round((crossfadeMs / 1000) * fs), Math.floor(loop.length / 2));
  const out = new Float64Array(Math.max(targetLenSamples, head.length));
  out.set(head.slice(0, Math.min(head.length, out.length)), 0);
  let cursor = head.length;
  let prevTail = head.length > 0 ? head.slice(Math.max(0, head.length - xLen)) : new Float64Array(0);
  while (cursor < targetLenSamples) {
    const seg = new Float64Array(loop);
    if (xLen > 0 && prevTail.length === xLen) {
      for (let i = 0; i < xLen && i < seg.length; i += 1) {
        const t = i / xLen;
        seg[i] = seg[i] * Math.sin((t * Math.PI) / 2) + prevTail[i] * Math.cos((t * Math.PI) / 2);
      }
    }
    const n = Math.min(seg.length, out.length - cursor);
    if (n <= 0) break;
    out.set(seg.slice(0, n), cursor);
    prevTail = seg.slice(Math.max(0, n - xLen), n);
    cursor += n;
    if (loop.length === 0) break;
  }
  return out;
}

/**
 * Duck gain envelope (linear) over a clip's timeline span.
 * speechRanges: [{startMs, endMs, importance}] — narration-active ranges.
 * sfxDips: [{startMs, endMs}] — important-SFX duck ranges.
 */
function duckEnvelope(spanStartMs, spanEndMs, speechRanges, sfxDips, { intensity = "MEDIUM", recoveryIntent = "NATURAL" } = {}) {
  const stepMs = 10; // envelope resolution: 1 point per 10ms
  const n = Math.max(1, Math.ceil((spanEndMs - spanStartMs) / stepMs));
  const env = new Float64Array(n).fill(1);
  const depthDb = DUCK_DEPTH_DB[intensity] || DUCK_DEPTH_DB.MEDIUM;
  const releaseMs = RELEASE_MS[recoveryIntent] || RELEASE_MS.NATURAL;
  const ranges = [];
  for (const r of speechRanges) {
    const importance = IMPORTANCE_DEPTH_MULTIPLIER[r.importance] || 1.0;
    const depth = Math.min(DUCK_DEPTH_DB.STRONG, depthDb * importance);
    ranges.push({
      start: r.startMs,
      end: r.endMs,
      depth: dbToLinear(-depth),
      attackMs: ATTACK_MS,
      releaseMs,
    });
  }
  for (const d of sfxDips || []) {
    // 30ms attack keeps the dip under the 6dB/10ms gain-jump QA threshold.
    ranges.push({ start: d.startMs, end: d.endMs, depth: dbToLinear(-SFX_DUCK_DB), attackMs: 30, releaseMs: 300 });
  }
  for (const r of ranges) {
    const rs = Math.max(spanStartMs, r.start);
    const re = Math.min(spanEndMs, r.end);
    if (re <= rs) continue;
    for (let i = 0; i < n; i += 1) {
      const t = spanStartMs + i * stepMs;
      let target = 1;
      if (t >= rs && t < re) target = r.depth;
      else if (t < rs) {
        const dt = rs - t;
        if (dt <= r.attackMs) target = 1 + (r.depth - 1) * (1 - dt / r.attackMs);
      } else {
        const dt = t - re;
        if (dt <= r.releaseMs) target = r.depth + (1 - r.depth) * (dt / r.releaseMs);
      }
      if (target < env[i]) env[i] = target;
    }
  }
  return { env, stepMs };
}

function applyFades(samples, fs, fadeInMs, fadeOutMs) {
  const out = samples;
  const fi = Math.min(Math.round((fadeInMs / 1000) * fs), Math.floor(out.length / 2));
  const fo = Math.min(Math.round((fadeOutMs / 1000) * fs), Math.floor(out.length / 2));
  for (let i = 0; i < fi; i += 1) out[i] *= i / fi;
  for (let i = 0; i < fo; i += 1) out[out.length - 1 - i] *= i / fo;
  return out;
}

/** Soft limiter at ceilingDb (used only as an explicit repair action). */
function softLimit(samples, ceilingDb = -0.5) {
  const ceiling = dbToLinear(ceilingDb);
  for (let i = 0; i < samples.length; i += 1) {
    if (samples[i] > ceiling) samples[i] = ceiling;
    else if (samples[i] < -ceiling) samples[i] = -ceiling;
  }
  return samples;
}

/**
 * Render one mix: returns stems + master (Float64, mono at mixFs) + envelopes.
 * mixPlan: the AudioMixPlan artifact; resolveAudio(path) → Buffer.
 */
function executeMix(mixPlan, opts = {}) {
  const mixFs = opts.sampleRate || 24000;
  const resolveAudio = opts.resolveAudio || ((p) => require("fs").readFileSync(p));
  const stems = [];
  const duckEnvelopes = {};
  const planClips = [
    ...mixPlan.tracks.voice.map((c) => ({ ...c, role: "voice" })),
    ...mixPlan.tracks.music.map((c) => ({ ...c, role: "music" })),
    ...mixPlan.tracks.sfx.map((c) => ({ ...c, role: "sfx" })),
  ];
  const ambienceClips = (mixPlan.tracks.ambience || []).map((c) => ({ ...c, role: "ambience" }));

  const speechRanges = mixPlan.tracks.voice
    .map((c) => ({ startMs: c.startMs, endMs: c.startMs + (c.durationMs || 0), importance: c.importance || "NORMAL" }))
    .sort((a, b) => a.startMs - b.startMs);

  const masterLenSamples = Math.max(
    1,
    ...planClips.concat(ambienceClips).map((c) => Math.round(((c.startMs + (c.durationMs || 0)) / 1000) * mixFs))
  );
  const master = new Float64Array(masterLenSamples);

  for (const clip of planClips.concat(ambienceClips)) {
    const bytes = resolveAudio(clip.path);
    const decoded = decodeToMonoFloat(bytes, mixFs);
    if (!decoded.ok) return decoded;
    let region = decoded.samples;
    const srcLenMs = (region.length / mixFs) * 1000;
    const needMs = clip.durationMs || (clip.trimEndMs !== undefined ? clip.trimEndMs - (clip.trimStartMs || 0) : srcLenMs);
    if (clip.trimStartMs !== undefined || clip.trimEndMs !== undefined) {
      region = trim(region, mixFs, clip.trimStartMs || 0, clip.trimEndMs !== undefined ? clip.trimEndMs : srcLenMs);
    }
    // Loop execution (§4.8): 2.7 decides loop intent, engine executes.
    if (clip.loopPlan && clip.loopPlan.strategy === "LOOP" && clip.loopPlan.loopEndMs > clip.loopPlan.loopStartMs) {
      region = renderLooped(
        region,
        clip.loopPlan.loopStartMs - (clip.trimStartMs || 0),
        clip.loopPlan.loopEndMs - (clip.trimStartMs || 0),
        clip.loopPlan.crossfadeMs || 300,
        mixFs,
        Math.round((needMs / 1000) * mixFs)
      );
    }
    if (region.length > Math.round((needMs / 1000) * mixFs)) {
      region = region.slice(0, Math.round((needMs / 1000) * mixFs));
    }
    applyFades(region, mixFs, clip.fadeInMs || 0, clip.fadeOutMs || 0);

    const gain = dbToLinear(clip.gainDb || 0);
    let envelope = null;
    if (clip.role === "music") {
      // Important-SFX priority (§4.6): featured SFX dips music even when no
      // narration ducking applies.
      const sfxDips = (mixPlan.tracks.sfx || [])
        .filter((s) => s.duckMusic && s.priority === "FEATURED")
        .map((s) => ({ startMs: s.startMs, endMs: s.startMs + (s.durationMs || 0) }));
      const narrationDuck = clip.ducking && clip.ducking.enabled;
      if (narrationDuck || sfxDips.length) {
        envelope = duckEnvelope(clip.startMs, clip.startMs + needMs, narrationDuck ? speechRanges : [], sfxDips, {
          intensity: (clip.ducking && clip.ducking.intensity) || "MEDIUM",
          recoveryIntent: (clip.ducking && clip.ducking.recoveryIntent) || "NATURAL",
        });
        duckEnvelopes[clip.clipId] = envelope;
      }
    }

    const startSample = Math.round((clip.startMs / 1000) * mixFs);
    const stem = new Float64Array(masterLenSamples);
    for (let i = 0; i < region.length; i += 1) {
      const idx = startSample + i;
      if (idx >= masterLenSamples) break;
      let v = region[i] * gain;
      if (envelope) {
        const envIdx = Math.min(envelope.env.length - 1, Math.floor((i / mixFs) * 1000 / envelope.stepMs));
        v *= envelope.env[envIdx];
      }
      stem[idx] += v;
      master[idx] += v;
    }
    stems.push({ role: clip.role, clipId: clip.clipId, samples: stem });
  }

  // Order matters: master gain first, then the true-peak limiter.
  if (typeof opts.masterGainDb === "number" && opts.masterGainDb !== 0) {
    const g = dbToLinear(opts.masterGainDb);
    for (let i = 0; i < master.length; i += 1) master[i] *= g;
  }
  if (opts.limiter) softLimit(master, opts.limiter.ceilingDb !== undefined ? opts.limiter.ceilingDb : -1.3);

  return {
    ok: true,
    mixFs,
    master,
    stems,
    duckEnvelopes,
    durationMs: Math.round((masterLenSamples / mixFs) * 1000),
  };
}

module.exports = {
  RESAMPLE_MODE,
  DUCK_DEPTH_DB,
  ATTACK_MS,
  RELEASE_MS,
  SFX_DUCK_DB,
  dbToLinear,
  decodeToMonoFloat,
  resampleLinear,
  trim,
  renderLooped,
  duckEnvelope,
  applyFades,
  softLimit,
  executeMix,
};
