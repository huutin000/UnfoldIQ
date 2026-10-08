"use strict";

/**
 * Deterministic media-equivalence digest for rendered MP4s (decoded frames + packet timing/size/flags +
 * stream params + duration + audio). Whole-file bytes are NOT part of the contract: Remotion/ffmpeg
 * occasionally differ in a 22-byte MP4 compressorname string ("Lavc61.19.100 libx264" vs zeros) while every
 * decoded frame, packet timestamp and size is identical (Report/evidence/perf-5c/concurrency-determinism.json).
 * Any decoded-frame, timing, stream or audio difference still changes the digest and fails.
 */

const childProcess = require("child_process");
const crypto = require("crypto");

const NL = String.fromCharCode(10);
function run(cmd, args) {
  return childProcess.spawnSync(cmd, args, { encoding: "utf8", timeout: 300000, maxBuffer: 256 * 1024 * 1024 });
}

function mediaDigest(file) {
  const probe = JSON.parse(run("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", file]).stdout);
  const frames = run("ffmpeg", ["-v", "error", "-i", file, "-map", "0:v:0", "-f", "framemd5", "-"]).stdout
    .split(NL).filter((l) => l && l[0] !== "#").map((l) => l.split(",").pop().trim());
  const pk = run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts,dts,size,flags", "-of", "csv=p=0", file]).stdout;
  const hasAudio = probe.streams.some((s) => s.codec_type === "audio");
  const audio = hasAudio ? run("ffmpeg", ["-v", "error", "-i", file, "-map", "0:a:0", "-f", "md5", "-"]).stdout.trim() : "NO_AUDIO_STREAM";
  const streams = probe.streams.map((s) => [s.codec_type, s.codec_name, s.profile, s.pix_fmt, s.width, s.height, s.r_frame_rate, s.nb_frames, s.start_time, s.duration].join("/"));
  const digest = crypto.createHash("sha256").update(JSON.stringify({ frames, pk, audio, streams, duration: probe.format.duration })).digest("hex");
  return { digest, frameCount: frames.length, audio };
}

module.exports = { mediaDigest };
