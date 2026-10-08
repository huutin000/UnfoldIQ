"use strict";

/**
 * Phase 4B §7 — Delivery conform (mezzanine → FinalExportProfile).
 *
 * The Remotion V1 encode path preserves full-range input tagging
 * (yuvj420p/pc from RGB-captured sources) instead of emitting broadcast
 * SDR. Rather than patching the renderer internals, 4B enforces the export
 * profile in a RECORDED conform stage: input/output hashes + exact ffmpeg
 * args persist in the RenderJob. Nothing silent: the mezzanine hash, the
 * filter graph and the delivery hash are all evidence.
 */

const childProcess = require("child_process");
const crypto = require("crypto");
const fs = require("fs");

const DELIVERY_VERSION = "1.0.0";

function sha256File(abs) {
  return crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
}

/**
 * Conform a rendered mezzanine file to the effective export profile.
 * Returns { ok, record } — record carries hashes + args for the job.
 */
function conformDelivery(mezzaninePath, deliveryPath, effectiveProfile, timeoutMs) {
  if (!fs.existsSync(mezzaninePath)) return { ok: false, code: "FILE_MISSING", message: mezzaninePath };
  const inHash = sha256File(mezzaninePath);
  const args = [
    "-y", "-v", "error", "-i", mezzaninePath,
    "-vf", "scale=in_range=full:out_range=mpeg,format=yuv420p",
    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
    "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-profile:v", "high",
    "-x264-params", "colorprim=bt709:transfer=bt709:colormatrix=bt709",
    "-c:a", "aac", "-ar", "48000", "-ac", "2",
    "-movflags", "+faststart",
    deliveryPath,
  ];
  const r = childProcess.spawnSync("ffmpeg", args, { encoding: "utf8", timeout: timeoutMs || 590000, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0 || !fs.existsSync(deliveryPath)) {
    return { ok: false, code: "CONFORM_FAILED", message: (r.stderr || "").slice(-500) };
  }
  return {
    ok: true,
    record: {
      version: DELIVERY_VERSION,
      stage: "delivery-conform",
      reason: "renderer V1 emits full-range tagging; profile enforced here, recorded",
      inputHash: inHash,
      outputHash: sha256File(deliveryPath),
      ffmpegArgs: args.filter((a) => a !== mezzaninePath && a !== deliveryPath),
      profileRef: `${effectiveProfile.profileId}@${effectiveProfile.version}`,
    },
  };
}

module.exports = { DELIVERY_VERSION, conformDelivery, sha256File };
