"use strict";

/**
 * UNFOLDIQ media probe (STEP-11 Branch A).
 * Read-only metadata inspection. Never installs software, never estimates:
 * fps/duration are null when unknown, UNKNOWN results are never labelled measured.
 */

const fs = require("fs");
const path = require("path");
const child_process = require("child_process");

const SUPPORTED = {
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".webp": "image",
  ".mp4": "video",
  ".webm": "video",
  ".mov": "video",
  ".mkv": "video",
  ".wav": "audio",
  ".mp3": "audio",
  ".ogg": "audio",
  ".m4a": "audio",
  ".flac": "audio"
};

const FFPROBE_TIMEOUT_MS = 15000;

let ffprobeCache = { checked: false, available: false, toolVersion: null };

function ffprobeInfo() {
  if (ffprobeCache.checked) return ffprobeCache;
  ffprobeCache.checked = true;
  try {
    const out = child_process.spawnSync("ffprobe", ["-version"], {
      timeout: 5000,
      encoding: "utf8",
      windowsHide: true
    });
    if (out && out.status === 0 && out.stdout) {
      const first = String(out.stdout).split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] || null;
      ffprobeCache.available = true;
      ffprobeCache.toolVersion = first;
    }
  } catch {
    ffprobeCache.available = false;
  }
  return ffprobeCache;
}

function gcd(a, b) {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  if (x <= 0 || y <= 0) return 0;
  while (y !== 0) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x || 0;
}

function aspectRatio(width, height) {
  if (typeof width !== "number" || typeof height !== "number" || width <= 0 || height <= 0) return null;
  const d = gcd(width, height);
  if (!d) return null;
  return `${Math.round(width / d)}:${Math.round(height / d)}`;
}

function parseFps(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : null;
  const s = String(value).trim();
  if (!s || s === "0/0") return null;
  const m = s.match(/^(\d+(?:\.\d+)?)(?:\/(\d+(?:\.\d+)?))?$/);
  if (!m) return null;
  const num = parseFloat(m[1]);
  const den = m[2] === undefined ? 1 : parseFloat(m[2]);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0 || num <= 0) return null;
  return num / den;
}

function parseDurationMs(value) {
  if (value === null || value === undefined) return null;
  const sec = typeof value === "number" ? value : parseFloat(String(value));
  if (!Number.isFinite(sec) || sec < 0) return null;
  return Math.round(sec * 1000);
}

function parseIntOrNull(value) {
  if (value === null || value === undefined) return null;
  const n = parseInt(String(value), 10);
  return Number.isFinite(n) ? n : null;
}

function parseWavHeader(buffer) {
  try {
    if (!Buffer.isBuffer(buffer) || buffer.length < 44) return null;
    if (buffer.toString("ascii", 0, 4) !== "RIFF") return null;
    if (buffer.toString("ascii", 8, 12) !== "WAVE") return null;
    let offset = 12;
    let channels = null;
    let sampleRate = null;
    let byteRate = null;
    let dataLen = null;
    while (offset + 8 <= buffer.length) {
      const id = buffer.toString("ascii", offset, offset + 4);
      const size = buffer.readUInt32LE(offset + 4);
      if (id === "fmt " && size >= 16 && offset + 8 + 16 <= buffer.length) {
        channels = buffer.readUInt16LE(offset + 10);
        sampleRate = buffer.readUInt32LE(offset + 12);
        byteRate = buffer.readUInt32LE(offset + 16);
      } else if (id === "data") {
        dataLen = size;
        break;
      }
      offset += 8 + size;
      if (offset > buffer.length) break;
      if (size < 0 || offset < 0) break;
    }
    if (channels === null || sampleRate === null || byteRate === null || dataLen === null) return null;
    const durationMs = byteRate > 0 ? Math.round((dataLen / byteRate) * 1000) : null;
    return { channels, sampleRate, byteRate, dataLen, durationMs };
  } catch {
    return null;
  }
}

function parsePngHeader(buffer) {
  try {
    if (!Buffer.isBuffer(buffer) || buffer.length < 24) return null;
    const sig = [137, 80, 78, 71, 13, 10, 26, 10];
    for (let i = 0; i < sig.length; i += 1) {
      if (buffer[i] !== sig[i]) return null;
    }
    if (buffer.toString("ascii", 12, 16) !== "IHDR") return null;
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    if (!width || !height) return null;
    return { width, height };
  } catch {
    return null;
  }
}

function unknownResult() {
  return { metadata: null, status: "UNKNOWN", evidence: { source: "UNKNOWN", measuredAt: new Date().toISOString() } };
}

function mapFfprobe(data, fileSize, toolVersion) {
  const evidence = { source: "FFPROBE", measuredAt: new Date().toISOString() };
  if (toolVersion) evidence.toolVersion = toolVersion;
  try {
    const streams = Array.isArray(data.streams) ? data.streams : [];
    const format = data.format && typeof data.format === "object" ? data.format : {};
    const video = streams.find((s) => s && s.codec_type === "video") || null;
    const audio = streams.find((s) => s && s.codec_type === "audio") || null;
    const containerRaw = typeof format.format_name === "string" ? format.format_name.split(",")[0].trim() : "";
    const container = containerRaw || null;
    const durationMs =
      parseDurationMs(format.duration) !== null
        ? parseDurationMs(format.duration)
        : parseDurationMs(video && video.duration) !== null
          ? parseDurationMs(video.duration)
          : parseDurationMs(audio && audio.duration);
    if (video) {
      const width = parseIntOrNull(video.width);
      const height = parseIntOrNull(video.height);
      if (durationMs !== null) {
        const sampleRate = audio ? parseIntOrNull(audio.sample_rate) : null;
        const channels = audio ? parseIntOrNull(audio.channels) : null;
        const meta = {
          width, height,
          aspectRatio: width && height ? aspectRatio(width, height) : null,
          durationMs,
          fps: parseFps(video.avg_frame_rate !== undefined ? video.avg_frame_rate : video.r_frame_rate),
          codec: video.codec_name || null,
          container,
          fileSize,
          hasAudioStream: streams.length > 0 ? audio !== null : "UNKNOWN",
          sampleRate,
          channels,
          loudnessStatus: "NOT_MEASURED"
        };
        return { metadata: meta, status: "MEASURED", evidence };
      }
      const meta = {
        width, height,
        aspectRatio: width && height ? aspectRatio(width, height) : null,
        format: video.codec_name || null
      };
      return { metadata: meta, status: "MEASURED", evidence };
    }
    if (audio) {
      const meta = {
        durationMs,
        codec: audio.codec_name || null,
        container,
        sampleRate: parseIntOrNull(audio.sample_rate),
        channels: parseIntOrNull(audio.channels),
        fileSize,
        loudnessStatus: "NOT_MEASURED"
      };
      return { metadata: meta, status: "MEASURED", evidence };
    }
    return unknownResult();
  } catch {
    return unknownResult();
  }
}

function probeFFprobe(absPath, timeoutMs) {
  const timeout = typeof timeoutMs === "number" && timeoutMs > 0 ? timeoutMs : FFPROBE_TIMEOUT_MS;
  try {
    const info = ffprobeInfo();
    if (!info.available) return unknownResult();
    const out = child_process.spawnSync(
      "ffprobe",
      ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", absPath],
      { timeout, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, windowsHide: true }
    );
    if (!out || out.status !== 0 || !out.stdout) return unknownResult();
    const data = JSON.parse(String(out.stdout));
    let fileSize = null;
    try {
      fileSize = fs.statSync(absPath).size;
    } catch {
      fileSize = null;
    }
    return mapFfprobe(data, fileSize, info.toolVersion);
  } catch {
    return unknownResult();
  }
}

function readHead(absPath, bytes) {
  const fd = fs.openSync(absPath, "r");
  try {
    const buf = Buffer.alloc(bytes);
    const n = fs.readSync(fd, buf, 0, bytes, 0);
    return buf.slice(0, n);
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      /* ignore */
    }
  }
}

function probe(absPath, opts) {
  void (opts || {});
  let fileSize = null;
  try {
    const st = fs.statSync(absPath);
    if (!st.isFile()) return unknownResult();
    fileSize = st.size;
  } catch {
    return unknownResult();
  }
  const ext = path.extname(String(absPath)).toLowerCase();
  const kind = SUPPORTED[ext] || null;
  if (kind) {
    try {
      const info = ffprobeInfo();
      if (info.available) {
        const r = probeFFprobe(absPath, FFPROBE_TIMEOUT_MS);
        if (r && r.status === "MEASURED" && r.metadata) return r;
      }
    } catch {
      /* fall through to header parsers */
    }
  }
  if (ext === ".wav") {
    try {
      const head = readHead(absPath, 65536);
      const wav = parseWavHeader(head);
      if (wav) {
        return {
          metadata: {
            durationMs: wav.durationMs,
            codec: "pcm",
            container: "wav",
            sampleRate: wav.sampleRate,
            channels: wav.channels,
            fileSize,
            loudnessStatus: "NOT_MEASURED"
          },
          status: "MEASURED",
          evidence: { source: "WAV_HEADER", measuredAt: new Date().toISOString() }
        };
      }
    } catch {
      /* fall through */
    }
    return unknownResult();
  }
  if (ext === ".png") {
    try {
      const head = readHead(absPath, 32);
      const png = parsePngHeader(head);
      if (png) {
        return {
          metadata: {
            width: png.width,
            height: png.height,
            aspectRatio: aspectRatio(png.width, png.height),
            format: "png"
          },
          status: "MEASURED",
          evidence: { source: "PNG_HEADER", measuredAt: new Date().toISOString() }
        };
      }
    } catch {
      /* fall through */
    }
    return unknownResult();
  }
  return unknownResult();
}

module.exports = {
  probe,
  parseWavHeader,
  parsePngHeader,
  probeFFprobe,
  SUPPORTED
};
