"use strict";

/**
 * UNFOLDIQ media preflight engine (STEP-11 Branch A).
 * Read-only readiness gate over asset-manifest + scene-script (+ continuity-registry).
 * Never generates media, never rewrites manifests, never installs anything.
 */

const fs = require("fs");
const path = require("path");
const { resolveProjectPath, readFingerprintIndex } = require("../providers/runtime/artifact-store.js");
const mediaProbe = require("./media-probe");

const STATUS = {
  READY: "READY",
  REVIEW_REQUIRED: "REVIEW_REQUIRED",
  BLOCKED: "BLOCKED"
};

const PREFLIGHT_TYPES = ["image", "video", "voice", "music", "sfx", "caption", "timing"];

const TYPE_CATEGORY = {
  image: "image",
  video: "video",
  voice: "audio",
  music: "audio",
  sfx: "audio",
  caption: "caption",
  timing: "timing"
};

const EXT_CATEGORY = {
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
  ".flac": "audio",
  ".srt": "caption",
  ".vtt": "caption",
  ".json": "timing"
};

const KNOWN_RIGHTS = ["VERIFIED", "UNVERIFIED", "UNKNOWN", "NOT_APPLICABLE", "BLOCKED"];
const KNOWN_PROVENANCE = ["VERIFIED", "UNVERIFIED", "UNKNOWN", "NOT_APPLICABLE"];
const CLIP_AUDIO_POLICIES = ["MUTE_GENERATED_CLIP_AUDIO", "USE_AS_PLANNED", "MIX", "REPLACE"];
const DEFAULT_CLIP_AUDIO_POLICY = "MUTE_GENERATED_CLIP_AUDIO";

function extOf(p) {
  return path.extname(String(p || "")).toLowerCase();
}

function round4(n) {
  return Math.round(n * 10000) / 10000;
}

function normRights(value) {
  const up = String(value === null || value === undefined ? "" : value).toUpperCase();
  return KNOWN_RIGHTS.includes(up) ? up : "UNKNOWN";
}

function hasProvenance(asset) {
  if (!asset || typeof asset !== "object") return false;
  if (typeof asset.providerId === "string" && asset.providerId.length > 0) return true;
  const p = asset.provenance;
  if (!p || typeof p !== "object") return false;
  return ["providerId", "requestId", "sourceUrl", "promptFile", "modelOrVersion"].some(
    (k) => typeof p[k] === "string" && p[k].length > 0
  );
}

function loadPlatformCanvas(projectRoot, platform) {
  try {
    const file = path.join(projectRoot, "platforms", String(platform), "PROFILE.yaml");
    const text = fs.readFileSync(file, "utf8");
    let width = null;
    let height = null;
    try {
      const yaml = require("js-yaml");
      const doc = yaml.load(text);
      const candidates = [doc && doc.projectDefaults, doc];
      for (const c of candidates) {
        if (c && typeof c === "object") {
          if (width === null && Number.isFinite(Number(c.width))) width = Number(c.width);
          if (height === null && Number.isFinite(Number(c.height))) height = Number(c.height);
        }
      }
    } catch {
      const wm = text.match(/^\s*width:\s*(\d+)/m);
      const hm = text.match(/^\s*height:\s*(\d+)/m);
      if (wm) width = Number(wm[1]);
      if (hm) height = Number(hm[1]);
    }
    if (width && width > 0 && height && height > 0) return { width, height };
    return null;
  } catch {
    return null;
  }
}

function suggestNormalization(relPath) {
  const original = String(relPath);
  let norm = original.replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/(^|\/)\.\//g, "$1");
  norm = norm.replace(/\/\.\//g, "/");
  if (norm !== original) return { from: original, to: norm };
  return null;
}

function sceneEntities(scene) {
  if (!scene || typeof scene !== "object") return [];
  const pools = [
    scene.continuityEntities,
    scene.requiredEntities,
    scene.continuityContext && scene.continuityContext.requiredEntities
  ];
  for (const pool of pools) {
    if (Array.isArray(pool) && pool.length > 0) return pool.filter((e) => typeof e === "string" && e.length > 0);
  }
  return [];
}

function sceneStrictness(asset, scene) {
  const pools = [
    asset && asset.continuityStrictness,
    scene && scene.continuityStrictness,
    scene && scene.continuityContext && scene.continuityContext.strictness
  ];
  for (const v of pools) {
    if (typeof v === "string" && v.length > 0) return v.toUpperCase();
  }
  return "LENIENT";
}

function scenePlannedDurationMs(scene) {
  if (!scene || typeof scene !== "object") return null;
  const t = scene.timing;
  if (t && typeof t === "object") {
    if (Number.isFinite(t.durationMs) && t.durationMs >= 0) return t.durationMs;
    if (Number.isFinite(t.startMs) && Number.isFinite(t.endMs) && t.endMs >= t.startMs) return t.endMs - t.startMs;
  }
  return null;
}

function probeConflict(measured, candidate) {
  if (!measured || !candidate || typeof candidate !== "object") return false;
  const rel = (a, b) => {
    if (!Number.isFinite(a) || !Number.isFinite(b) || Math.max(Math.abs(a), Math.abs(b)) === 0) return 0;
    return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b));
  };
  if (Number.isFinite(candidate.width) && Number.isFinite(measured.width) && rel(candidate.width, measured.width) > 0.05) return true;
  if (Number.isFinite(candidate.height) && Number.isFinite(measured.height) && rel(candidate.height, measured.height) > 0.05) return true;
  if (Number.isFinite(candidate.durationMs) && Number.isFinite(measured.durationMs) && rel(candidate.durationMs, measured.durationMs) > 0.05) return true;
  if (typeof candidate.codec === "string" && typeof measured.codec === "string" && candidate.codec && measured.codec) {
    if (candidate.codec.toLowerCase() !== measured.codec.toLowerCase()) return true;
  }
  return false;
}

function checkAsset(asset, ctx) {
  const a = asset && typeof asset === "object" ? asset : {};
  const assetId = typeof a.assetId === "string" && a.assetId ? a.assetId : "UNKNOWN_ASSET";
  const sceneIds = Array.isArray(a.sceneIds) ? a.sceneIds.filter((s) => typeof s === "string") : [];
  const sceneId = sceneIds.length > 0 ? sceneIds[0] : "";
  const scene = sceneId && ctx.sceneById ? ctx.sceneById.get(sceneId) || null : null;
  const required = (ctx.requiredSet && ctx.requiredSet.has(assetId)) || a.required === true;
  const relPath = typeof a.path === "string" ? a.path : "";

  const actualCat = EXT_CATEGORY[extOf(relPath)] || null;
  let recordType = PREFLIGHT_TYPES.includes(a.type) ? a.type : null;
  if (!recordType) {
    if (actualCat === "image") recordType = "image";
    else if (actualCat === "video") recordType = "video";
    else if (actualCat === "audio") recordType = "sfx";
    else if (actualCat === "caption") recordType = "caption";
    else recordType = "timing";
  }

  const record = {
    assetId,
    sceneId,
    type: recordType,
    path: relPath,
    exists: false,
    required,
    sourceProvider:
      (typeof a.providerId === "string" && a.providerId) ||
      (a.provenance && typeof a.provenance.providerId === "string" && a.provenance.providerId) ||
      (typeof a.sourceType === "string" && a.sourceType) ||
      "UNKNOWN",
    provenanceStatus: "UNKNOWN",
    rightsStatus: normRights(a.rights && a.rights.status),
    continuityStatus: "NOT_APPLICABLE",
    structuralStatus: "UNKNOWN",
    metadataStatus: "UNKNOWN",
    issues: []
  };

  const blockingIssues = [];
  const warnings = [];
  const block = (code, message) => {
    blockingIssues.push({ code, message, assetId });
    record.issues.push({ code, message, severity: "BLOCK" });
  };
  const warn = (code, message) => {
    warnings.push({ code, message, assetId });
    record.issues.push({ code, message, severity: "WARN" });
  };
  const info = (code, message) => {
    record.issues.push({ code, message, severity: "INFO" });
  };

  const norm = relPath ? suggestNormalization(relPath) : null;
  if (norm) record.normalizationPlan = { suggestedPath: norm.to, reason: "PATH_NORMALIZATION_SUGGESTED" };

  // (a) path must resolve inside the project
  let abs = null;
  let normalizedRel = null;
  if (!relPath) {
    block("PATH_TRAVERSAL", `asset ${assetId} has no path; cannot resolve inside project`);
  } else {
    try {
      const r = resolveProjectPath(ctx.projectRoot, ctx.projectId, relPath);
      abs = r.abs;
      normalizedRel = r.relative;
    } catch (e) {
      block("PATH_TRAVERSAL", `asset ${assetId} path escapes project root: ${String((e && e.message) || e)}`);
    }
  }

  let fileOk = false;
  let fileSize = null;
  if (abs) {
    // (b) existence
    try {
      const st = fs.statSync(abs);
      if (st.isFile()) {
        record.exists = true;
        fileOk = true;
        fileSize = st.size;
      }
    } catch {
      fileOk = false;
    }
    if (!fileOk) {
      record.structuralStatus = "MISSING";
      if (required) block("MISSING_FILE", `required asset ${assetId} missing at ${relPath}`);
      else warn("OPTIONAL_MISSING", `optional asset ${assetId} missing at ${relPath}`);
    } else if (fileSize === 0) {
      // (c) zero byte
      record.structuralStatus = "CORRUPT";
      block("ZERO_BYTE", `asset ${assetId} is zero bytes at ${relPath}`);
      fileOk = false;
    } else {
      record.structuralStatus = "VALID";
    }
  } else {
    record.exists = false;
  }

  // (d) extension/type compatibility
  if (fileOk) {
    const expected = TYPE_CATEGORY[a.type] || null;
    if (expected && !actualCat) {
      block("TYPE_MISMATCH", `asset ${assetId} type ${a.type} has unrecognized extension at ${relPath}`);
    } else if (expected && actualCat && actualCat !== expected) {
      const jsonCaptionOk = actualCat === "timing" && expected === "caption";
      if (!jsonCaptionOk) {
        block("TYPE_MISMATCH", `asset ${assetId} type ${a.type} mismatches extension category ${actualCat} at ${relPath}`);
      }
    }
  }

  // (e) probe
  let measured = null;
  if (fileOk && abs) {
    try {
      const r = mediaProbe.probe(abs);
      record.timingEvidence = r.evidence;
      if (r && r.status === "MEASURED" && r.metadata) {
        record.metadataStatus = "MEASURED";
        record.metadata = r.metadata;
        measured = r.metadata;
      } else {
        record.metadataStatus = "UNKNOWN";
      }
    } catch {
      record.metadataStatus = "UNKNOWN";
    }
  }

  // (f) rights
  if (record.rightsStatus === "BLOCKED") {
    block("RIGHTS_BLOCKED", `asset ${assetId} rights status is BLOCKED`);
  } else if ((recordType === "music" || recordType === "sfx") && required && (record.rightsStatus === "UNKNOWN" || record.rightsStatus === "UNVERIFIED")) {
    block("MUSIC_RIGHTS_UNKNOWN", `required ${recordType} asset ${assetId} has rights ${record.rightsStatus}`);
  }

  // (g) provenance
  if (hasProvenance(a)) {
    record.provenanceStatus = "VERIFIED";
  } else if (a.sourceType === "generated") {
    record.provenanceStatus = "UNVERIFIED";
    warn("PROVENANCE_UNVERIFIED", `generated asset ${assetId} has no providerId or provenance record`);
  } else if (a.sourceType === "existing" || a.sourceType === "local-library") {
    record.provenanceStatus = "NOT_APPLICABLE";
  } else {
    record.provenanceStatus = "UNKNOWN";
  }

  // (h) fingerprint freshness
  if (a.expectedFingerprint !== null && a.expectedFingerprint !== undefined && normalizedRel) {
    const indexed = ctx.fingerprintIndex && typeof ctx.fingerprintIndex === "object" ? ctx.fingerprintIndex[normalizedRel] : undefined;
    if (indexed !== a.expectedFingerprint) {
      block("OUTDATED_FINGERPRINT", `asset ${assetId} expectedFingerprint does not match fingerprint index for ${normalizedRel}`);
    }
  }

  // (i) continuity strictness
  const entities = sceneEntities(a).length > 0 ? sceneEntities(a) : sceneEntities(scene);
  const strictness = sceneStrictness(a, scene);
  if (entities.length > 0 && strictness === "STRICT") {
    const reg = ctx.continuityRegistry;
    const locked = (id) => {
      try {
        const list = reg && Array.isArray(reg.entities) ? reg.entities : [];
        const e = list.find((x) => x && x.entityId === id);
        return !!e && e.lockStatus === "LOCKED";
      } catch {
        return false;
      }
    };
    if (entities.every(locked)) {
      record.continuityStatus = "LOCKED";
    } else {
      record.continuityStatus = "UNRESOLVED";
      block("CONTINUITY_UNRESOLVED", `asset ${assetId} requires STRICT entities not all LOCKED: ${entities.join(",")}`);
    }
  } else if (entities.length > 0) {
    record.continuityStatus = "REVIEW_REQUIRED";
  }

  // (j) orphan scene assets
  const unknownScenes = sceneIds.filter((id) => !(ctx.sceneById && ctx.sceneById.has(id)));
  if (sceneIds.length === 0 || unknownScenes.length > 0) {
    const detail = sceneIds.length === 0 ? "no sceneIds" : `unknown scenes: ${unknownScenes.join(",")}`;
    if (required) block("ORPHAN_SCENE_ASSET", `required asset ${assetId} references ${detail}`);
    else warn("ORPHAN_SCENE_ASSET", `optional asset ${assetId} references ${detail}`);
  }

  // (k) aspect treatment
  if (measured && Number.isFinite(measured.width) && Number.isFinite(measured.height) && measured.width > 0 && measured.height > 0 && ctx.platformCanvas) {
    const sourceAspect = round4(measured.width / measured.height);
    const targetAspect = round4(ctx.platformCanvas.width / ctx.platformCanvas.height);
    const treatment = Math.abs(sourceAspect - targetAspect) <= 0.02 ? "exact" : "contain";
    record.aspectTreatment = { sourceAspect, targetAspect, treatment };
    if (treatment === "contain") record.aspectTreatment.note = "default contain treatment; verify framing before render";
    if (a.treatmentHint === "letterbox" && a.letterboxDesigned !== true) {
      warn("ACCIDENTAL_BLACK_BAR", `asset ${assetId} hints letterbox without letterboxDesigned; may render accidental black bars`);
    }
  } else if (a.treatmentHint === "letterbox" && a.letterboxDesigned !== true) {
    warn("ACCIDENTAL_BLACK_BAR", `asset ${assetId} hints letterbox without letterboxDesigned; may render accidental black bars`);
  }

  // (l) short generated clip coverage (allowed, MP10)
  if (recordType === "video" && measured && Number.isFinite(measured.durationMs)) {
    const planned = scenePlannedDurationMs(scene);
    if (planned !== null && measured.durationMs < planned) {
      info("SHORT_CLIP_PLANNED_COVERAGE", `video asset ${assetId} measured ${measured.durationMs}ms shorter than scene planned ${planned}ms; planned coverage applies`);
    }
  }

  // (m) embedded audio
  if (recordType === "video") {
    if (measured && measured.hasAudioStream === true) record.embeddedAudio = "PRESENT";
    else if (measured && measured.hasAudioStream === false) record.embeddedAudio = "ABSENT";
    else record.embeddedAudio = "UNKNOWN";
    const use = scene && typeof scene.clipAudioUse === "string" ? scene.clipAudioUse : DEFAULT_CLIP_AUDIO_POLICY;
    record.clipAudioPolicy = CLIP_AUDIO_POLICIES.includes(use) ? use : DEFAULT_CLIP_AUDIO_POLICY;
  }

  // (n) probe candidate conflicts
  if (Array.isArray(a.probeCandidates) && a.probeCandidates.length > 0 && measured) {
    const conflict = a.probeCandidates.some((c) => probeConflict(measured, c));
    if (conflict) {
      warn("PROBE_CONFLICT", `asset ${assetId} probeCandidates materially conflict with measured metadata`);
    }
  }

  return { record, blockingIssues, warnings };
}

function runPreflight(args) {
  const o = args && typeof args === "object" ? args : {};
  const projectRoot = o.projectRoot;
  const projectId = o.projectId;
  const platform = o.platform;
  if (!projectRoot || !projectId || !platform) throw new Error("MISSING_INPUT: projectRoot, projectId, and platform are required");
  const manifest = o.assetManifest;
  const script = o.sceneScript;
  if (!manifest || !Array.isArray(manifest.assets)) throw new Error("MISSING_INPUT: assetManifest.assets must be an array");
  if (!script || !Array.isArray(script.scenes)) throw new Error("MISSING_INPUT: sceneScript.scenes must be an array");

  const sceneById = new Map();
  for (const s of script.scenes) {
    if (s && typeof s.sceneId === "string") sceneById.set(s.sceneId, s);
  }
  let fingerprintIndex = {};
  try {
    fingerprintIndex = readFingerprintIndex(projectRoot, projectId) || {};
  } catch {
    fingerprintIndex = {};
  }
  const requiredSet = new Set(Array.isArray(o.requiredAssetIds) ? o.requiredAssetIds.filter((x) => typeof x === "string") : []);
  const platformCanvas = loadPlatformCanvas(projectRoot, platform);

  const ctx = {
    projectRoot,
    projectId,
    sceneById,
    continuityRegistry: o.continuityRegistry || null,
    fingerprintIndex,
    requiredSet,
    platformCanvas
  };

  const assets = [];
  const blockingIssues = [];
  const warnings = [];
  const perAssetBlocking = new Map();
  let missingRequired = 0;
  let requiredCount = 0;
  let voiceMeasured = false;

  for (const asset of manifest.assets) {
    const r = checkAsset(asset, ctx);
    assets.push(r.record);
    perAssetBlocking.set(r.record.assetId, r.blockingIssues.length);
    for (const b of r.blockingIssues) {
      blockingIssues.push(b);
      if (b.code === "MISSING_FILE" && r.record.required) missingRequired += 1;
    }
    for (const w of r.warnings) warnings.push(w);
    if (r.record.required) requiredCount += 1;
    if (r.record.type === "voice" && r.record.metadataStatus === "MEASURED" && r.record.metadata && Number.isFinite(r.record.metadata.durationMs)) {
      voiceMeasured = true;
    }
  }

  let readyCount = 0;
  for (const rec of assets) {
    if ((perAssetBlocking.get(rec.assetId) || 0) === 0 && rec.exists) readyCount += 1;
  }

  let policy = DEFAULT_CLIP_AUDIO_POLICY;
  for (const s of script.scenes) {
    if (s && typeof s.clipAudioUse === "string" && CLIP_AUDIO_POLICIES.includes(s.clipAudioUse)) {
      policy = s.clipAudioUse;
      break;
    }
  }

  const notes = [`${assets.length} assets checked`, `generatedClipAudioPolicy=${policy}`];
  if (o.fps !== null && o.fps !== undefined) notes.push(`fps=${o.fps}`);

  const status = blockingIssues.length > 0 ? STATUS.BLOCKED : warnings.length > 0 ? STATUS.REVIEW_REQUIRED : STATUS.READY;

  return {
    version: "1.0.0",
    projectId,
    platform,
    generatedAt: new Date().toISOString(),
    status,
    generatedClipAudioPolicy: policy,
    assets,
    timelineSummary: {
      assetCount: assets.length,
      readyCount,
      requiredCount,
      missingRequired,
      voiceMeasured,
      notes
    },
    blockingIssues,
    warnings
  };
}

module.exports = {
  runPreflight,
  checkAsset,
  STATUS
};
