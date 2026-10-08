"use strict";

/**
 * Phase 4B §20, §23 — Encoded output inspection (UNFOLDIQ CORE).
 *
 * ffprobe structural evidence + full-decode corruption check.
 * Evidence is persisted raw/normalized; nothing is assumed from config.
 */

const childProcess = require("child_process");
const fs = require("fs");

function runCapture(cmd, args, timeoutMs) {
  const r = childProcess.spawnSync(cmd, args, { encoding: "utf8", timeout: timeoutMs || 120000, maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "", error: r.error || null };
}

/** Structural streams/format evidence for a file. */
function probeFile(absPath) {
  if (!fs.existsSync(absPath)) return { ok: false, code: "FILE_MISSING", message: absPath };
  const r = runCapture("ffprobe", ["-v", "error", "-show_format", "-show_streams", "-of", "json", absPath]);
  if (r.status !== 0) return { ok: false, code: "PROBE_FAILED", message: (r.stderr || "").slice(-500) };
  let j;
  try { j = JSON.parse(r.stdout); } catch (e) { return { ok: false, code: "PROBE_FAILED", message: "unparseable ffprobe json" }; }
  const videos = (j.streams || []).filter((s) => s.codec_type === "video");
  const audios = (j.streams || []).filter((s) => s.codec_type === "audio");
  const v = videos[0] || null;
  const a = audios[0] || null;
  return {
    ok: true,
    evidence: {
      path: absPath,
      fileSizeBytes: fs.statSync(absPath).size,
      format: j.format ? { formatName: j.format.format_name, duration: Number(j.format.duration), size: Number(j.format.size) } : null,
      video: v ? {
        codec: v.codec_name, profile: v.profile, width: v.width, height: v.height,
        sar: v.sample_aspect_ratio, dar: v.display_aspect_ratio,
        fps: v.avg_frame_rate, pixFmt: v.pix_fmt,
        colorPrimaries: v.color_primaries, colorTransfer: v.color_transfer,
        colorSpace: v.color_space, colorRange: v.color_range,
        duration: Number(v.duration), nbFrames: v.nb_frames ? Number(v.nb_frames) : null,
      } : null,
      audio: a ? {
        codec: a.codec_name, sampleRate: Number(a.sample_rate), channels: a.channels,
        channelLayout: a.channel_layout, duration: Number(a.duration),
      } : null,
      streamCount: (j.streams || []).length,
      raw: j,
    },
  };
}

/** Full decode; any decoder error/truncation → corrupt evidence. */
function decodeCheck(absPath, timeoutMs) {
  const r = runCapture("ffmpeg", ["-v", "error", "-i", absPath, "-f", "null", "-"], timeoutMs || 600000);
  const errLines = (r.stderr || "").split("\n").filter((l) => /error|invalid|truncat|corrupt|eof/i.test(l));
  return {
    ok: r.status === 0 && errLines.length === 0,
    decodeErrors: errLines.slice(0, 10),
    exitStatus: r.status,
  };
}

/** blackdetect candidates: [{start, end}] in seconds. */
function detectBlack(absPath, minDuration = 0.5) {
  const r = runCapture("ffmpeg", ["-i", absPath, "-vf", `blackdetect=d=${minDuration}:pic_th=0.98:pix_th=0.10`, "-an", "-f", "null", "-"], 600000);
  const out = `${r.stdout}\n${r.stderr}`;
  const ranges = [];
  const re = /black_start:([\d.]+)\s+black_end:([\d.]+)/g;
  let m;
  while ((m = re.exec(out)) !== null) ranges.push({ start: Number(m[1]), end: Number(m[2]) });
  return { ok: r.status === 0, ranges };
}

/** freezedetect candidates: [{start, end}] in seconds. */
function detectFreeze(absPath, noise = "0.001", minDuration = 2) {
  const r = runCapture("ffmpeg", ["-i", absPath, "-vf", `freezedetect=n=${noise}:d=${minDuration}`, "-an", "-f", "null", "-"], 600000);
  const out = `${r.stdout}\n${r.stderr}`;
  const ranges = [];
  const re = /freeze_start:([\d.]+)\s+freeze_end:([\d.]+)/g;
  let m;
  while ((m = re.exec(out)) !== null) ranges.push({ start: Number(m[1]), end: Number(m[2]) });
  return { ok: r.status === 0, ranges };
}

/** silencedetect candidates on the audio stream. */
function detectSilence(absPath, noiseDb = -50, minDuration = 2) {
  const r = runCapture("ffmpeg", ["-i", absPath, "-af", `silencedetect=noise=${noiseDb}dB:d=${minDuration}`, "-vn", "-f", "null", "-"], 600000);
  const out = `${r.stdout}\n${r.stderr}`;
  const ranges = [];
  const re = /silence_start:\s*([\d.]+)[\s\S]*?silence_end:\s*([\d.]+)/g;
  let m;
  while ((m = re.exec(out)) !== null) ranges.push({ start: Number(m[1]), end: Number(m[2]) });
  return { ok: r.status === 0, ranges };
}

/** Max volume (clipping evidence) via volumedetect. */
function detectVolume(absPath) {
  const r = runCapture("ffmpeg", ["-i", absPath, "-af", "volumedetect", "-vn", "-f", "null", "-"], 600000);
  const out = `${r.stdout}\n${r.stderr}`;
  const maxM = /max_volume:\s*([-\d.]+)\s*dB/.exec(out);
  const meanM = /mean_volume:\s*([-\d.]+)\s*dB/.exec(out);
  return {
    ok: r.status === 0,
    maxVolumeDb: maxM ? Number(maxM[1]) : null,
    meanVolumeDb: meanM ? Number(meanM[1]) : null,
    noAudio: /n:0/.test(out) && maxM === null,
  };
}

/**
 * Frame-domain luminance deltas: extract N small grayscale frames across the
 * file, return mean-abs consecutive deltas + per-second flash-like counts.
 * Conservative flash screen: any sliding 1s window with >3 large deltas.
 */
function analyzeLuminance(absPath, sampleFps = 2, deltaThreshold = 0.35) {
  const tmp = `${absPath}.lum-${process.pid}.raw`;
  const w = 64;
  const h = 36;
  const dur = probeFile(absPath);
  const duration = dur.ok && dur.evidence.format ? dur.evidence.format.duration : 0;
  const r = runCapture("ffmpeg", ["-v", "error", "-i", absPath, "-vf", `fps=${sampleFps},scale=${w}:${h},format=gray`, "-f", "rawvideo", "-pix_fmt", "gray", tmp]);
  if (r.status !== 0) { try { fs.rmSync(tmp, { force: true }); } catch (e) {} return { ok: false, code: "LUMA_EXTRACT_FAILED" }; }
  let buf;
  try { buf = fs.readFileSync(tmp); } finally { try { fs.rmSync(tmp, { force: true }); } catch (e) {} }
  const frameBytes = w * h;
  const n = Math.floor(buf.length / frameBytes);
  const means = [];
  for (let i = 0; i < n; i++) {
    let s = 0;
    const off = i * frameBytes;
    for (let k = 0; k < frameBytes; k += 4) s += buf[off + k];
    means.push(s / (frameBytes / 4) / 255);
  }
  const deltas = [];
  for (let i = 1; i < means.length; i++) deltas.push(Math.abs(means[i] - means[i - 1]));
  const bigIdx = deltas.map((d, i) => (d >= deltaThreshold ? i : -1)).filter((i) => i >= 0);
  // Sliding 1s window over sample indices (sampleFps samples/sec).
  let maxInWindow = 0;
  for (let i = 0; i < bigIdx.length; i++) {
    let c = 0;
    for (let j = i; j < bigIdx.length && bigIdx[j] - bigIdx[i] < sampleFps; j++) c++;
    maxInWindow = Math.max(maxInWindow, c);
  }
  return { ok: true, frames: n, duration, meanDelta: deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : 0, maxDelta: deltas.length ? Math.max(...deltas) : 0, bigCount: bigIdx.length, maxInWindow };
}

/** Extract small JPEG samples (start/middle/end + extras) for watch evidence. */
function extractFrames(absPath, outDir, atSeconds = []) {
  fs.mkdirSync(outDir, { recursive: true });
  const files = [];
  for (const t of atSeconds) {
    const out = require("path").join(outDir, `sample-${String(t).replace(".", "p")}.jpg`);
    const r = runCapture("ffmpeg", ["-v", "error", "-ss", String(t), "-i", absPath, "-frames:v", "1", "-q:v", "4", out]);
    if (r.status === 0 && fs.existsSync(out)) files.push(out);
  }
  return { ok: files.length === atSeconds.length, files };
}

module.exports = { probeFile, decodeCheck, detectBlack, detectFreeze, detectSilence, detectVolume, analyzeLuminance, extractFrames };
