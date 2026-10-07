"use strict";

/**
 * Phase 2.4 — minimal pure-JS PCM16 WAV toolkit for narration QA.
 * Decode/measure/detect-silence/assemble — no external audio dependencies.
 * All measurements come from real decoded bytes, never from parameters.
 */

const ERRORS = {
  WAV_DECODE_FAILED: "wav bytes are not a decodable PCM16 RIFF file",
  WAV_CORRUPT: "wav bytes are corrupt/truncated",
  WAV_SAMPLE_RATE_MISMATCH: "wav sample rate does not match the narration runtime identity",
};

function decodeWav(buf) {
  if (!buf || buf.length < 44 || buf.slice(0, 4).toString("ascii") !== "RIFF" || buf.slice(8, 12).toString("ascii") !== "WAVE") {
    return { ok: false, code: "WAV_DECODE_FAILED", message: ERRORS.WAV_DECODE_FAILED };
  }
  // Walk chunks to find fmt + data (robust to extra chunks like LIST).
  let offset = 12;
  let fmt = null;
  let dataOffset = -1;
  let dataLength = 0;
  while (offset + 8 <= buf.length) {
    const id = buf.slice(offset, offset + 4).toString("ascii");
    const size = buf.readUInt32LE(offset + 4);
    if (id === "fmt ") {
      fmt = {
        audioFormat: buf.readUInt16LE(offset + 8),
        channels: buf.readUInt16LE(offset + 10),
        sampleRate: buf.readUInt32LE(offset + 12),
        bitsPerSample: buf.readUInt16LE(offset + 22),
      };
    } else if (id === "data") {
      dataOffset = offset + 8;
      dataLength = Math.min(size, buf.length - dataOffset);
    }
    offset += 8 + size + (size % 2);
  }
  if (!fmt || dataOffset < 0 || dataLength <= 0) {
    return { ok: false, code: "WAV_CORRUPT", message: ERRORS.WAV_CORRUPT };
  }
  if (fmt.audioFormat !== 1 || fmt.bitsPerSample !== 16) {
    return { ok: false, code: "WAV_DECODE_FAILED", message: `${ERRORS.WAV_DECODE_FAILED}: only PCM16 supported (format ${fmt.audioFormat}, ${fmt.bitsPerSample} bits)` };
  }
  const bytes = buf.slice(dataOffset, dataOffset + dataLength);
  if (bytes.length % 2 !== 0) {
    return { ok: false, code: "WAV_CORRUPT", message: ERRORS.WAV_CORRUPT };
  }
  const sampleCount = bytes.length / 2;
  const samples = new Int16Array(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) samples[i] = bytes.readInt16LE(i * 2);
  return { ok: true, fmt, samples, sampleRate: fmt.sampleRate, channels: fmt.channels };
}

/** Frame-level RMS measurement over the decoded samples. */
function frameRms(samples, sampleRate, frameMs = 20) {
  const frameLen = Math.max(1, Math.round((sampleRate * frameMs) / 1000));
  const out = [];
  for (let start = 0; start < samples.length; start += frameLen) {
    let sumSq = 0;
    let n = 0;
    for (let i = start; i < Math.min(start + frameLen, samples.length); i += 1) {
      sumSq += samples[i] * samples[i];
      n += 1;
    }
    out.push({ startMs: Math.round((start / sampleRate) * 1000), rms: Math.sqrt(sumSq / n) });
  }
  return out;
}

/** Technical QA + silence spans from real decoded bytes. */
function measure(samples, sampleRate, opts = {}) {
  const silenceRmsThreshold = opts.silenceRmsThreshold !== undefined ? opts.silenceRmsThreshold : 60;
  const minSilenceMs = opts.minSilenceMs || 120;
  let peak = 0;
  let sumSq = 0;
  let clipping = 0;
  let finite = true;
  for (let i = 0; i < samples.length; i += 1) {
    const v = samples[i];
    if (!Number.isFinite(v)) finite = false;
    const a = Math.abs(v);
    if (a > peak) peak = a;
    if (a >= 32700) clipping += 1;
    sumSq += v * v;
  }
  const rms = samples.length ? Math.sqrt(sumSq / samples.length) : 0;
  const durationMs = Math.round((samples.length / sampleRate) * 1000);
  // Silence spans: consecutive frames under the RMS threshold.
  const frames = frameRms(samples, sampleRate, 20);
  const spans = [];
  let spanStart = null;
  for (const f of frames) {
    if (f.rms < silenceRmsThreshold) {
      if (spanStart === null) spanStart = f.startMs;
    } else if (spanStart !== null) {
      const endMs = f.startMs;
      if (endMs - spanStart >= minSilenceMs) spans.push({ startMs: spanStart, endMs, durationMs: endMs - spanStart });
      spanStart = null;
    }
  }
  if (spanStart !== null) {
    const endMs = durationMs;
    if (endMs - spanStart >= minSilenceMs) spans.push({ startMs: spanStart, endMs, durationMs: endMs - spanStart });
  }
  return {
    durationMs,
    peak,
    rms: Number(rms.toFixed(2)),
    clippingSamples: clipping,
    finite,
    nonSilent: peak > 500 && durationMs > 50,
    silenceSpans: spans,
    maxSilenceMs: spans.reduce((m, s) => Math.max(m, s.durationMs), 0),
    totalSilenceMs: spans.reduce((n, s) => n + s.durationMs, 0),
  };
}

function encodeWav(samples, sampleRate, channels = 1) {
  const dataLen = samples.length * 2;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * channels * 2, 28);
  buf.writeUInt16LE(channels * 2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataLen, 40);
  for (let i = 0; i < samples.length; i += 1) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i]))), 44 + i * 2);
  return buf;
}

/** Deterministic ordered assembly with recorded inter-segment silence. */
function assemble(trackSegments, sampleRate) {
  // trackSegments: [{samples: Int16Array, gapAfterMs}]
  const totalLen = trackSegments.reduce((n, s) => n + s.samples.length + Math.round((sampleRate * (s.gapAfterMs || 0)) / 1000), 0);
  const out = new Int16Array(totalLen);
  const joins = [];
  let cursor = 0;
  for (const seg of trackSegments) {
    const joinStartMs = Math.round((cursor / sampleRate) * 1000);
    // Discontinuity evidence: abs delta across the boundary (previous sample vs first).
    const discontinuity = cursor > 0 && seg.samples.length > 0 ? Math.abs(out[cursor - 1] - seg.samples[0]) : 0;
    out.set(seg.samples, cursor);
    cursor += seg.samples.length;
    const gapSamples = Math.round((sampleRate * (seg.gapAfterMs || 0)) / 1000);
    joins.push({ joinStartMs, discontinuity, gapMs: seg.gapAfterMs || 0 });
    cursor += gapSamples;
  }
  return { samples: out, joins };
}

module.exports = { ERRORS, decodeWav, measure, frameRms, encodeWav, assemble };
