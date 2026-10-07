"use strict";

/**
 * Phase 1G.11 — structural QA layer.
 * decode / dimensions / duration / aspect / corruption / file type /
 * temporal stream integrity. Deterministic; reuses lib/media-probe for real
 * measurement. No estimation: unobservable checks are UNKNOWN, never PASS.
 */

const mediaProbe = require("../media-probe.js");
const shared = require("./shared.js");

// Magic/file-signature table (offset 0 unless noted).
const SIGNATURES = [
  { kind: "png", mediaType: "image", magic: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  { kind: "jpeg", mediaType: "image", magic: Buffer.from([0xff, 0xd8, 0xff]) },
  { kind: "gif87a", mediaType: "image", magic: Buffer.from("GIF87a", "ascii") },
  { kind: "gif89a", mediaType: "image", magic: Buffer.from("GIF89a", "ascii") },
  { kind: "webp", mediaType: "image", magic: Buffer.from("RIFF", "ascii"), riffKind: "WEBP" },
  { kind: "wav", mediaType: "audio", magic: Buffer.from("RIFF", "ascii"), riffKind: "WAVE" },
  { kind: "mp4", mediaType: "video", magic: Buffer.from("ftyp", "ascii"), offset: 4 },
  { kind: "webm", mediaType: "video", magic: Buffer.from([0x1a, 0x45, 0xdf, 0xa3]) },
];

const EXT_TO_KIND = {
  ".png": "png",
  ".jpg": "jpeg",
  ".jpeg": "jpeg",
  ".gif": "gif",
  ".webp": "webp",
  ".wav": "wav",
  ".mp4": "mp4",
  ".webm": "webm",
  ".mov": "mp4",
  ".mkv": "webm",
};

function detectSignature(head) {
  if (!Buffer.isBuffer(head) || head.length < 12) return { kind: null, mediaType: null };
  for (const s of SIGNATURES) {
    const off = s.offset || 0;
    if (head.length < off + s.magic.length) continue;
    if (!head.slice(off, off + s.magic.length).equals(s.magic)) continue;
    if (s.riffKind) {
      if (head.length < 12 || head.slice(8, 12).toString("ascii") !== s.riffKind) continue;
      return { kind: s.kind, mediaType: s.mediaType };
    }
    if (s.kind === "gif87a" || s.kind === "gif89a") return { kind: "gif", mediaType: s.mediaType };
    return { kind: s.kind, mediaType: s.mediaType };
  }
  return { kind: null, mediaType: null };
}

function headOf(input) {
  if (input.bytes && Buffer.isBuffer(input.bytes)) return input.bytes.slice(0, 16);
  if (input.filePath) {
    try {
      const fs = require("fs");
      const fd = fs.openSync(input.filePath, "r");
      try {
        const buf = Buffer.alloc(16);
        const n = fs.readSync(fd, buf, 0, 16, 0);
        return buf.slice(0, n);
      } finally {
        try {
          fs.closeSync(fd);
        } catch {
          /* ignore */
        }
      }
    } catch {
      return null;
    }
  }
  return null;
}

function probeMeasured(input) {
  // probeOverride wins (deterministic tests / pre-measured pipeline metadata).
  if (input.probeOverride && typeof input.probeOverride === "object") return input.probeOverride;
  // File-backed probe first: ffprobe measures real containers (mp4/webm/mov).
  if (input.filePath) {
    try {
      const r = mediaProbe.probe(input.filePath);
      if (r && r.status === "MEASURED" && r.metadata) return r;
    } catch {
      /* fall through to in-memory decoders */
    }
  }
  if (input.bytes && Buffer.isBuffer(input.bytes)) {
    // In-memory PNG decodes deterministically without ffprobe.
    const png = mediaProbe.parsePngHeader(input.bytes);
    if (png) {
      return {
        metadata: { width: png.width, height: png.height, format: "png" },
        status: "MEASURED",
        evidence: { source: "PNG_HEADER", measuredAt: shared.nowIso() },
      };
    }
    if (input.bytes.length === 0) return { metadata: null, status: "UNKNOWN", evidence: { source: "EMPTY_BYTES" } };
    return { metadata: null, status: "UNKNOWN", evidence: { source: "UNPROBED_BYTES" } };
  }
  // (filePath already attempted above; reaching here means it missed.)
  return { metadata: null, status: "UNKNOWN", evidence: { source: "NO_INPUT" } };
}

/**
 * evaluateStructural({ bytes?, filePath?, fileName?, probeOverride?,
 *   expected?: { mediaType?, width?, height?, aspect?, durationMs?,
 *     durationToleranceMs?, motionRequired? },
 *   streamMeta?: { truncated?, freezeSegments[]?, timestampValid?, zeroMotion? } })
 * → layer result. Never throws on corrupt input (corruption is a FAIL, not a crash).
 */
function evaluateStructural(input = {}) {
  const checks = [];
  const evidence = [];
  const reasons = [];
  const expected = input.expected || {};
  let failCount = 0;
  let unknownCritical = 0;

  function push(check, status, severity, reason, blocking, evExtra) {
    checks.push(shared.checkEntry(check, status, severity, reason, blocking));
    if (status === "FAIL") failCount++;
    if (status === "UNKNOWN" && blocking) unknownCritical++;
    if (reason && (status === "FAIL" || (status === "UNKNOWN" && blocking))) reasons.push(`${check}: ${reason}`);
    if (evExtra) evidence.push(evExtra);
  }

  // 1. file type: extension vs magic vs decoder.
  const head = headOf(input);
  const sig = head ? detectSignature(head) : { kind: null, mediaType: null };
  const ext = typeof input.fileName === "string" ? input.fileName.slice(input.fileName.lastIndexOf(".")).toLowerCase() : null;
  const extKind = ext && EXT_TO_KIND[ext] ? EXT_TO_KIND[ext] : null;
  if (!head) {
    push("file-type", "UNKNOWN", "BLOCKER", "no bytes available; type cannot be verified", true,
      shared.makeEvidence({ layer: "structural", check: "file-type", source: "ABSENT_INPUT", expected: ext || null, observed: null, comparison: "unobservable", confidence: "high" }));
  } else if (!sig.kind) {
    push("file-type", "FAIL", "BLOCKER", "unrecognized file signature; possible corruption", true,
      shared.makeEvidence({ layer: "structural", check: "file-type", source: "MAGIC_BYTES", expected: extKind || "known container", observed: "unknown signature", comparison: "mismatch", confidence: "high" }));
  } else if (extKind && ((extKind === "gif" && sig.kind !== "gif") || (extKind !== "gif" && extKind !== "jpeg" && sig.kind !== extKind && !(ext === ".mov" && sig.kind === "mp4") && !(ext === ".mkv" && sig.kind === "webm") && !(ext === ".jpg")) || ((ext === ".jpg" || ext === ".jpeg") && sig.kind !== "jpeg"))) {
    push("file-type", "FAIL", "BLOCKER", `extension ${ext} claims ${extKind} but signature decodes as ${sig.kind}`, true,
      shared.makeEvidence({ layer: "structural", check: "file-type", source: "MAGIC_BYTES", expected: extKind, observed: sig.kind, comparison: "extension/signature mismatch", confidence: "high" }));
  } else {
    push("file-type", "PASS", "INFO", null, false,
      shared.makeEvidence({ layer: "structural", check: "file-type", source: "MAGIC_BYTES", expected: extKind || sig.kind, observed: sig.kind, comparison: "match", confidence: "high" }));
  }

  // 2. decode (real measurement via media-probe).
  const probed = probeMeasured(input);
  const meta = probed.metadata || {};
  const decoded = probed.status === "MEASURED";
  if (!decoded) {
    const empty = input.bytes && input.bytes.length === 0;
    push("decode", "FAIL", "BLOCKER", empty ? "zero-byte input; nothing to decode" : "bytes do not decode as declared media (CORRUPT_MEDIA)", true,
      shared.makeEvidence({ layer: "structural", check: "decode", source: (probed.evidence && probed.evidence.source) || "PROBE", expected: "decodable media", observed: "decode failure", comparison: "mismatch", confidence: "high" }));
  } else {
    push("decode", "PASS", "INFO", null, false,
      shared.makeEvidence({ layer: "structural", check: "decode", source: (probed.evidence && probed.evidence.source) || "PROBE", expected: "decodable media", observed: meta.format || meta.codec || meta.container || "decoded", comparison: "match", confidence: "high" }));
  }

  // 3. expected media type cross-check.
  if (expected.mediaType) {
    const actualType = sig.mediaType || (meta.durationMs !== undefined && meta.durationMs !== null ? "video-or-audio" : (meta.width ? "image" : null));
    if (actualType && actualType !== "video-or-audio" && actualType !== expected.mediaType) {
      push("media-type", "FAIL", "BLOCKER", `expected ${expected.mediaType} but observed ${actualType} (WRONG_MEDIA_TYPE)`, true,
        shared.makeEvidence({ layer: "structural", check: "media-type", source: "MAGIC_BYTES", expected: expected.mediaType, observed: actualType, comparison: "mismatch", confidence: "high" }));
    } else if (!actualType && !decoded) {
      push("media-type", "FAIL", "BLOCKER", `expected ${expected.mediaType}; unobservable due to decode failure`, true);
    } else if (!actualType) {
      push("media-type", "UNKNOWN", "BLOCKER", `expected ${expected.mediaType}; actual type unobservable`, true);
    } else {
      push("media-type", "PASS", "INFO", null, false,
        shared.makeEvidence({ layer: "structural", check: "media-type", source: "MAGIC_BYTES", expected: expected.mediaType, observed: expected.mediaType, comparison: "match", confidence: "medium" }));
    }
  } else {
    checks.push(shared.checkEntry("media-type", "NOT_APPLICABLE", "INFO", "no upstream media-type expectation", false));
  }

  // 4. dimensions (extracted = informative PASS; mismatch vs expectation = FAIL).
  if (meta.width && meta.height) {
    evidence.push(shared.makeEvidence({ layer: "structural", check: "dimensions", source: (probed.evidence && probed.evidence.source) || "PROBE", expected: expected.width ? `${expected.width}x${expected.height}` : "extracted", observed: `${meta.width}x${meta.height}`, comparison: "measured", confidence: "high" }));
    if (expected.width && expected.height && (meta.width !== expected.width || meta.height !== expected.height)) {
      push("dimensions", "FAIL", "ERROR", `expected ${expected.width}x${expected.height} but measured ${meta.width}x${meta.height}`, true);
    } else {
      push("dimensions", "PASS", "INFO", null, false);
    }
  } else if (expected.mediaType === "image" || (!expected.mediaType && sig.mediaType === "image")) {
    push("dimensions", "UNKNOWN", "BLOCKER", "image dimensions unobservable", true);
  } else if (expected.width && expected.height) {
    // Hardening sweep (A-13): a DECLARED dimension expectation on a video
    // whose dimensions are unobservable is UNKNOWN-blocking, never silently
    // NOT_APPLICABLE (a mismatch could slip through unmeasured).
    push("dimensions", "UNKNOWN", "BLOCKER", `dimensions expected ${expected.width}x${expected.height} but unobservable`, true);
  } else {
    checks.push(shared.checkEntry("dimensions", "NOT_APPLICABLE", "INFO", "no dimensions expected for this media", false));
  }

  // 5. aspect vs upstream expectation (never hard-coded; 1G.7 owns the value).
  if (expected.aspect) {
    const actualAspect = meta.width && meta.height ? `${meta.width}:${meta.height}` : null;
    const norm = (a) => String(a).replace(/\s+/g, "");
    if (!actualAspect) {
      push("aspect", "UNKNOWN", "BLOCKER", `expected aspect ${expected.aspect}; actual unobservable`, true);
    } else {
      const [ew, eh] = norm(expected.aspect).split(":").map(Number);
      const okRatio = Number.isFinite(ew) && Number.isFinite(eh) && eh !== 0
        ? Math.abs(meta.width / meta.height - ew / eh) < 0.02
        : norm(actualAspect) === norm(expected.aspect);
      if (!okRatio) {
        push("aspect", "FAIL", "ERROR", `expected aspect ${expected.aspect} but measured ${meta.width}x${meta.height}`, true);
      } else {
        push("aspect", "PASS", "INFO", null, false);
      }
    }
  } else {
    checks.push(shared.checkEntry("aspect", "NOT_APPLICABLE", "INFO", "no upstream aspect expectation", false));
  }

  // 6. duration (video only; >0 and within tolerance when declared).
  if (expected.mediaType === "video" || expected.durationMs !== undefined) {
    const d = typeof meta.durationMs === "number" ? meta.durationMs : null;
    if (d === null || d === undefined) {
      push("duration", "UNKNOWN", "BLOCKER", "video duration unobservable", true);
    } else if (!(d > 0)) {
      push("duration", "FAIL", "BLOCKER", `invalid/zero duration (${d}ms)`, true,
        shared.makeEvidence({ layer: "structural", check: "duration", source: (probed.evidence && probed.evidence.source) || "PROBE", expected: ">0ms", observed: `${d}ms`, comparison: "mismatch", confidence: "high" }));
    } else if (expected.durationMs !== undefined) {
      const tol = typeof expected.durationToleranceMs === "number" ? expected.durationToleranceMs : 500;
      if (Math.abs(d - expected.durationMs) > tol) {
        push("duration", "FAIL", "ERROR", `expected ${expected.durationMs}ms ±${tol}ms but measured ${d}ms`, true);
      } else {
        push("duration", "PASS", "INFO", null, false);
      }
    } else {
      push("duration", "PASS", "INFO", null, false);
    }
  } else {
    checks.push(shared.checkEntry("duration", "NOT_APPLICABLE", "INFO", "duration applies to video expectations only", false));
  }

  // 7. temporal stream integrity (deterministic only, via supplied streamMeta).
  const sm = input.streamMeta || null;
  const isVideo = expected.mediaType === "video" || sig.kind === "mp4" || sig.kind === "webm";
  if (!isVideo) {
    checks.push(shared.checkEntry("temporal-stream", "NOT_APPLICABLE", "INFO", "temporal stream applies to video only", false));
    checks.push(shared.checkEntry("freeze", "NOT_APPLICABLE", "INFO", "freeze applies to video only", false));
  } else if (!sm) {
    push("temporal-stream", "UNKNOWN", "WARNING", "no stream metadata; truncation unobservable", false);
    push("freeze", "UNKNOWN", "WARNING", "no frame data; unintended freeze unobservable", false);
  } else {
    if (sm.truncated === true || sm.timestampValid === false) {
      push("temporal-stream", "FAIL", "BLOCKER", sm.truncated === true ? "truncated/broken frame stream" : "impossible timestamp/frame-order metadata", true);
    } else {
      push("temporal-stream", "PASS", "INFO", null, false);
    }
    const freezes = Array.isArray(sm.freezeSegments) ? sm.freezeSegments : [];
    if (freezes.length > 0) {
      push("freeze", "FAIL", "ERROR", `unintended frozen segment(s): ${JSON.stringify(freezes)}`, true);
    } else {
      push("freeze", "PASS", "INFO", null, false);
    }
    if (expected.motionRequired === true && sm.zeroMotion === true) {
      push("zero-motion", "FAIL", "ERROR", "zero-motion output when motion is structurally required", true);
    } else if (expected.motionRequired === true && sm.zeroMotion !== false) {
      push("zero-motion", "UNKNOWN", "WARNING", "motion presence unobservable", false);
    }
  }

  const status = failCount > 0 ? "FAIL" : unknownCritical > 0 ? "UNKNOWN" : "PASS";
  const severity = failCount > 0 ? "BLOCKER" : unknownCritical > 0 ? "ERROR" : "INFO";
  return shared.layerResult({
    status,
    severity,
    blocking: failCount > 0 || unknownCritical > 0,
    checks,
    evidence,
    reasons,
  });
}

module.exports = { evaluateStructural, detectSignature, SIGNATURES };
