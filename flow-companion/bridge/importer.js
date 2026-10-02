"use strict";

/**
 * Flow Companion download/import pipeline (STEP 10B).
 * Deterministic naming, no overwrite of approved files, structural QA,
 * provider-result with continuity REVIEW_REQUIRED for recurring subjects.
 */

const fs = require("fs");
const path = require("path");
const { resolveProjectPath, sanitizeFilename } = require("./path-policy");

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const VIDEO_EXTS = new Set([".mp4", ".webm"]);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** JPEG SOF markers carry the frame size; DHT/JPG/DAC share the range and don't. */
const JPEG_SOF = (m) => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;

function pngDimensions(head) {
  if (!head.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
}

function jpegDimensions(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    if (JPEG_SOF(marker)) return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}

/**
 * WebP carries its canvas size in the first chunk: VP8X (extended), VP8L
 * (lossless) or "VP8 " (lossy). Flow serves results as WebP, so reading only
 * PNG made every WebP result fail structural QA as unreadable.
 */
function webpDimensions(head) {
  if (head.subarray(0, 4).toString("ascii") !== "RIFF" || head.subarray(8, 12).toString("ascii") !== "WEBP") return null;
  const chunk = head.subarray(12, 16).toString("ascii");
  if (chunk === "VP8X" && head.length >= 30) {
    const rd24 = (o) => head[o] | (head[o + 1] << 8) | (head[o + 2] << 16);
    return { width: rd24(24) + 1, height: rd24(27) + 1 };
  }
  if (chunk === "VP8L" && head.length >= 25) {
    const bits = head.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8 " && head.length >= 27) {
    if (head[20] !== 0x9d || head[21] !== 0x01 || head[22] !== 0x2a) return null;
    return { width: head.readUInt16LE(23) & 0x3fff, height: head.readUInt16LE(25) & 0x3fff };
  }
  return null;
}

function imageDimensions(abs) {
  const fd = fs.openSync(abs, "r");
  try {
    // JPEG needs a marker walk; the header alone is not always enough.
    const head = Buffer.alloc(65536);
    const read = fs.readSync(fd, head, 0, 65536, 0);
    const buf = head.subarray(0, read);
    return pngDimensions(buf) || jpegDimensions(buf) || webpDimensions(buf);
  } finally {
    fs.closeSync(fd);
  }
}

function structuralQA(abs, capability) {
  const stat = fs.statSync(abs);
  if (stat.size === 0) throw new Error("ZERO_BYTE_FILE");
  const ext = path.extname(abs).toLowerCase();
  if (capability === "image") {
    if (!IMAGE_EXTS.has(ext)) throw new Error(`UNEXPECTED_EXTENSION: ${ext}`);
    const dims = imageDimensions(abs);
    if (!dims || dims.width === 0 || dims.height === 0) throw new Error("IMAGE_DIMENSIONS_UNREADABLE");
    return { width: dims.width, height: dims.height, bytes: stat.size };
  }
  if (capability === "video") {
    if (!VIDEO_EXTS.has(ext)) throw new Error(`UNEXPECTED_EXTENSION: ${ext}`);
    return { bytes: stat.size };
  }
  throw new Error(`UNSUPPORTED_CAPABILITY: ${capability}`);
}

/**
 * importResult({ projectRoot, job, sourceAbsPath, fingerprint? }) → { result, artifactPath }
 * - source must exist; job correlation enforced (jobId/requestId on caller side)
 * - dest: assets/<cap>/<scene>/<scene>_attempt-NN.ext (increments while taken)
 * - writes via tmp+rename; records fingerprint when provided
 */
function importResult({ projectRoot, job, sourceAbsPath, fingerprint = null }) {
  if (!job || !job.jobId || !job.requestId) throw new Error("JOB_IDENTITY_REQUIRED");
  if (!fs.existsSync(sourceAbsPath) || !fs.statSync(sourceAbsPath).isFile()) {
    throw new Error("SOURCE_FILE_MISSING");
  }
  const ext = path.extname(sourceAbsPath).toLowerCase();
  const allowed = job.capability === "video" ? VIDEO_EXTS : IMAGE_EXTS;
  if (!allowed.has(ext)) throw new Error(`UNEXPECTED_EXTENSION: ${ext}`);

  const dirRel = `assets/${job.capability}/${job.sceneId}`;
  const dir = resolveProjectPath(projectRoot, job.projectId, dirRel);
  fs.mkdirSync(dir.abs, { recursive: true });

  let attempt = job.attempt || 1;
  let destRel;
  for (;;) {
    const name = sanitizeFilename(`${job.sceneId}_attempt-${String(attempt).padStart(2, "0")}${ext}`);
    destRel = `${dirRel}/${name}`;
    try {
      resolveProjectPath(projectRoot, job.projectId, destRel);
    } catch (e) {
      throw new Error(`DEST_PATH_REJECTED: ${e.message}`);
    }
    if (!fs.existsSync(path.join(dir.abs, name))) break;
    attempt += 1;
    if (attempt > (job.attempt || 1) + 50) throw new Error("ATTEMPT_OVERFLOW");
  }
  const destAbs = path.join(dir.abs, path.basename(destRel));
  const tmp = `${destAbs}.${process.pid}.tmp`;
  fs.copyFileSync(sourceAbsPath, tmp);
  fs.renameSync(tmp, destAbs);

  const qa = structuralQA(destAbs, job.capability);

  if (fingerprint) {
    const store = require("../../providers/runtime/artifact-store");
    store.recordFingerprint(projectRoot, job.projectId, destRel, fingerprint);
  }

  const cc = job.continuityContext || {};
  const recurring = (cc.requiredEntities || []).length > 0;
  const result = {
    version: "1.0.0",
    requestId: job.requestId,
    projectId: job.projectId,
    sceneId: job.sceneId,
    capability: job.capability,
    providerId: "flow-web",
    status: "READY",
    artifactPath: destRel,
    metadata: { ...qa, jobId: job.jobId, attempt, flowMode: job.mode, model: job.modelPreference || null },
    generationDate: new Date().toISOString(),
    modelOrVersion: job.modelPreference || null,
    sourceType: "generated",
    provenanceNote: `Generated via Google Flow (job ${job.jobId}, attempt ${attempt})`,
    rightsStatus: "NOT_APPLICABLE",
    costClass: "INCLUDED_SUBSCRIPTION",
    continuity: {
      registryVersion: cc.registryVersion || null,
      entitiesUsed: cc.requiredEntities || [],
      referenceAssetIds: cc.referenceAssetIds || [],
      continuityStatus: recurring ? "REVIEW_REQUIRED" : "NOT_APPLICABLE",
    },
  };
  return { result, artifactPath: destRel };
}

module.exports = { importResult, structuralQA, IMAGE_EXTS, VIDEO_EXTS };
