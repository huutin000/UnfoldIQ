"use strict";

/**
 * Phase 3A-09/10/11/12/13 — Master Timeline Manifest (UNFOLDIQ CORE).
 *
 * Canonical assembly state derived from the canonical editorial clock:
 * FINAL AUDIO (speech timing) → timebase → tracks → items. Asset identity is
 * assetId + hash, NEVER a filesystem path (RULES 4/5). Patches are
 * structured, local, conflict-aware (RULE 6); mix-only audio changes do not
 * dirty speech timing (RULE 7); locked items survive unrelated reruns.
 */

const Ajv = require("ajv");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const timebase = require("./timebase.js");
const conform = require("./media-conform.js");
const colorPolicy = require("./color-policy.js");

const SCHEMA_VERSION = "1.0.0";
const TRACK_TYPES = ["NARRATION", "MUSIC", "SFX", "AMBIENCE", "VIDEO", "IMAGE", "CHART", "MAP", "DIAGRAM", "OVERLAY", "CAPTION", "TITLE"];
const VISUAL_TRACKS = new Set(["VIDEO", "IMAGE", "CHART", "MAP", "DIAGRAM", "OVERLAY", "TITLE"]);
const SPEECH_BOUND_TRACKS = new Set(["NARRATION"]);
const PATCH_TYPES = ["INSERT_ITEM", "REMOVE_ITEM", "REPLACE_ASSET", "RETIME_ITEM", "UPDATE_SOURCE_RANGE", "MOVE_ITEM"];

const ERRORS = {
  SCHEMA_INVALID: "master timeline manifest fails schema validation",
  INPUT_INVALID: "timeline build inputs missing/invalid",
  UNKNOWN_POLICY: "unknown policy ref",
  ASSET_RESOLVER_REQUIRED: "assetResolver(assetId) → {assetId, hash, type, ...} | null is required",
  PATCH_CONFLICT: "patch expects a different timeline revision/state",
  PATCH_INVALID: "patch payload invalid",
  LOCK_VIOLATION: "target item is locked",
  SPEECH_TIMING_PROTECTED: "narration/speech-bound timing is owned by Final Audio — retime rejected",
  DUPLICATE_PATCH: "patch already applied",
};

let _validator = null;
function validator() {
  if (!_validator) {
    const ajv = new Ajv({ allErrors: true, strict: false });
    const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "schemas", "master-timeline.schema.json"), "utf8"));
    _validator = ajv.compile(schema);
  }
  return _validator;
}

function sha256Hex(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function finding(code, extra) {
  return { code, ...extra, reason: extra.reason, correctiveAction: extra.correctiveAction || null };
}

// ---------- build (3A-11, §17) ----------

/**
 * inputs: {
 *   projectId,
 *   finalAudio: { artifactId, durationMs, narrationTimingHash, finalMixHash },
 *   alignment?: { artifactId, transcriptHash },
 *   captions?: { artifactId },
 *   visualItems: [{ trackType, assetId, sourceRange?, startTime, endTime,
 *                   sceneId?, shotId?, beatId?, segmentId?, zIndex?,
 *                   sourceTimingRef?, mediaMetadata?, sourceColor?,
 *                   speechBound? }],
 *   narrationSegments?: [{ segmentId, startTime, endTime, assetId }],
 *   assetResolver,                     // (assetId) → {assetId, hash, type, durationMs?, conform?} | null
 *   timebasePolicyRef, conformPolicyRef, colorPolicyRef,
 *   previousManifest?,                 // for locked-item preservation
 * }
 */
function buildTimeline(inputs = {}) {
  const t0 = Date.now();
  const {
    projectId, finalAudio, assetResolver,
    timebasePolicyRef = "web-30@1.0.0",
    conformPolicyRef = "web-standard-conform@1.0.0",
    colorPolicyRef = "sdr-web-standard@1.0.0",
  } = inputs;
  const mediaConformPolicyRef = conformPolicyRef;
  const colorManagementPolicyRef = colorPolicyRef;
  if (!projectId || !finalAudio || !Number.isInteger(finalAudio.durationMs) || !finalAudio.narrationTimingHash || typeof assetResolver !== "function") {
    return { ok: false, code: "INPUT_INVALID", message: ERRORS.INPUT_INVALID };
  }
  let tb;
  try { tb = timebase.getTimebasePolicy(timebasePolicyRef); } catch { return { ok: false, code: "UNKNOWN_POLICY", message: timebasePolicyRef }; }
  const frameRate = tb.frameRate;
  const canonicalDuration = {
    time: finalAudio.durationMs,
    frameCount: timebase.timeToFrameEndExclusive(finalAudio.durationMs, frameRate),
  };

  const findings = [];
  const items = [];
  const tracksById = new Map();
  const ensureTrack = (trackType) => {
    if (!TRACK_TYPES.includes(trackType)) {
      findings.push(finding("INVALID_TRACK_TYPE", { reason: `unknown track type ${trackType}`, correctiveAction: "USE_CANONICAL_TRACK_KIND" }));
      return null;
    }
    const trackId = `trk-${trackType.toLowerCase()}`;
    if (!tracksById.has(trackId)) tracksById.set(trackId, { trackId, trackType, itemIds: [] });
    return tracksById.get(trackId);
  };

  const narrationItems = [];
  for (const seg of inputs.narrationSegments || []) {
    narrationItems.push({
      trackType: "NARRATION",
      assetId: seg.assetId,
      startTime: seg.startTime,
      endTime: seg.endTime,
      segmentId: seg.segmentId,
      speechBound: true,
      sourceTimingRef: `final-audio:${finalAudio.artifactId}`,
    });
  }
  const allInputs = narrationItems.concat(inputs.visualItems || []);

  for (const raw of allInputs) {
    const track = ensureTrack(raw.trackType);
    if (!track) continue;
    // Canonical asset resolution — no anonymous path-only items (RULE 4/5).
    const asset = assetResolver(raw.assetId);
    if (!asset || !asset.assetId || !asset.hash) {
      findings.push(finding("UNKNOWN_ASSET", { assetId: raw.assetId, reason: `asset ${raw.assetId} not resolvable through the canonical registry (path-only or unknown)`, correctiveAction: "REGISTER_ASSET_IN_CANONICAL_LIBRARY" }));
      continue;
    }
    const startMs = raw.startTime;
    const endMs = raw.endTime;
    if (!Number.isInteger(startMs) || !Number.isInteger(endMs) || endMs <= startMs || startMs < 0) {
      findings.push(finding("INVALID_RANGE", { assetId: raw.assetId, reason: `invalid timeline range [${startMs}, ${endMs})`, correctiveAction: "FIX_ITEM_RANGE" }));
      continue;
    }
    if (endMs > canonicalDuration.time) {
      findings.push(finding("TIMELINE_RANGE_OVERFLOW", { assetId: raw.assetId, endMs, reason: `item end ${endMs}ms beyond canonical duration ${canonicalDuration.time}ms`, correctiveAction: "RETIME_OR_TRIM_ITEM" }));
    }
    if (raw.sourceRange && asset.durationMs && raw.sourceRange.endTime > asset.durationMs) {
      findings.push(finding("SOURCE_RANGE_OVERFLOW", { assetId: raw.assetId, reason: `source range end ${raw.sourceRange.endTime}ms beyond asset duration ${asset.durationMs}ms`, correctiveAction: "TRIM_SOURCE_RANGE" }));
    }
    // Frame mapping (GAP-004) — centralized deterministic conversion.
    const sf = timebase.timeToFrameStart(startMs, frameRate);
    const ef = timebase.timeToFrameEndExclusive(endMs, frameRate);
    const rt = timebase.roundTripCheck(startMs, endMs, frameRate);
    if (!rt.startFrameStable || !rt.endFrameStable) {
      findings.push(finding("FRAME_MAPPING_MISMATCH", { assetId: raw.assetId, reason: "round-trip frame mapping unstable", correctiveAction: "REPORT_TIMEBASE_BUG" }));
    }
    // Media conform (GAP-005).
    let conformDecision = null;
    let conformRef = conformPolicyRef;
    const meta = raw.mediaMetadata || asset.conform || null;
    if (meta) {
      const c = conform.evaluateConform(meta, conformPolicyRef, { targetFrameRate: frameRate });
      if (!c.ok) {
        findings.push(finding("UNKNOWN_MEDIA_METADATA", { assetId: raw.assetId, reason: c.code, correctiveAction: "PROBE_OR_DECLARE_MEDIA_METADATA" }));
      } else {
        conformDecision = c.decision;
        for (const r of c.reasons) {
          if (r.decision !== "DIRECT_USE") {
            findings.push(finding(r.reason.split(":")[0], { assetId: raw.assetId, reason: r.reason, correctiveAction: r.decision === "REVIEW_REQUIRED" ? "REVIEW_MEDIA" : "CONFORM_MEDIA" }));
          }
        }
      }
    } else {
      findings.push(finding("UNKNOWN_MEDIA_METADATA", { assetId: raw.assetId, reason: "no media conform metadata available", correctiveAction: "PROBE_OR_DECLARE_MEDIA_METADATA" }));
    }
    // Color metadata (GAP-005) — visual tracks only; audio tracks carry no
    // color semantics, so no color finding is raised for them.
    let color = { colorRef: conformPolicyRef2colorRef(colorPolicyRef), findings: [] };
    if (VISUAL_TRACKS.has(raw.trackType)) {
      color = colorPolicy.attachColor(raw.sourceColor || (meta && meta.color) || null, colorPolicyRef);
    }
    findings.push(...color.findings.map((f) => finding(f.code, { assetId: raw.assetId, reason: f.reason, correctiveAction: f.correctiveAction })));

    const item = {
      timelineItemId: `tl-${sha256Hex(Buffer.from(JSON.stringify([raw.trackType, raw.assetId, startMs, endMs, raw.segmentId || raw.sceneId || ""]))).slice(0, 12)}`,
      trackId: track.trackId,
      trackType: raw.trackType,
      assetId: raw.assetId,
      ...(raw.sourceRange ? { sourceRange: raw.sourceRange } : {}),
      timelineRange: { startTime: startMs, endTime: endMs, startFrame: sf, endFrameExclusive: ef },
      ...(raw.sourceTimingRef ? { sourceTimingRef: raw.sourceTimingRef } : {}),
      ...(raw.sceneId ? { sceneId: raw.sceneId } : {}),
      ...(raw.shotId ? { shotId: raw.shotId } : {}),
      ...(raw.beatId ? { beatId: raw.beatId } : {}),
      ...(raw.segmentId ? { segmentId: raw.segmentId } : {}),
      ...(raw.zIndex !== undefined ? { zIndex: raw.zIndex } : {}),
      conformRef,
      ...(conformDecision ? { conformDecision } : {}),
      colorRef: color.colorRef,
      ...(raw.speechBound ? { speechBound: true } : {}),
      locked: false,
      dependencyHashes: {
        asset: String(asset.hash),
        timebasePolicy: timebasePolicyRef,
        conformPolicy: conformPolicyRef,
        colorPolicy: colorPolicyRef,
      },
    };
    track.itemIds.push(item.timelineItemId);
    items.push(item);
  }

  // Locked-item preservation (§19): previously locked items survive rebuild
  // when their identity (id + asset + range) is unchanged.
  let preservedLocked = 0;
  if (inputs.previousManifest) {
    const prevLocked = new Map((inputs.previousManifest.items || []).filter((i) => i.locked).map((i) => [identityKey(i), i]));
    for (const item of items) {
      const prev = prevLocked.get(identityKey(item));
      if (prev) { item.locked = true; preservedLocked += 1; }
    }
  }

  const manifest = {
    version: SCHEMA_VERSION,
    projectId,
    timelineId: `mtl-${sha256Hex(Buffer.from(JSON.stringify({ projectId, narrationTimingHash: finalAudio.narrationTimingHash, durationMs: finalAudio.durationMs }))).slice(0, 12)}`,
    revision: 1,
    timebasePolicyRef,
    mediaConformPolicyRef,
    colorManagementPolicyRef,
    canonicalDuration,
    sourceTiming: {
      finalAudioArtifactId: finalAudio.artifactId,
      ...(finalAudio.finalMixHash ? { finalMixHash: finalAudio.finalMixHash } : {}),
      narrationTimingHash: finalAudio.narrationTimingHash,
      ...(inputs.alignment ? { alignmentArtifactId: inputs.alignment.artifactId, ...(inputs.alignment.transcriptHash ? { alignmentTranscriptHash: inputs.alignment.transcriptHash } : {}) } : {}),
      ...(inputs.captions ? { captionArtifactId: inputs.captions.artifactId } : {}),
    },
    tracks: [...tracksById.values()],
    items,
    appliedPatchIds: [],
    dependencyHashes: {
      finalAudio: finalAudio.artifactId,
      narrationTimingHash: finalAudio.narrationTimingHash,
      ...(finalAudio.finalMixHash ? { finalMixHash: finalAudio.finalMixHash } : {}),
      ...(inputs.alignment ? { alignment: inputs.alignment.artifactId } : {}),
      ...(inputs.captions ? { captions: inputs.captions.artifactId } : {}),
      timebasePolicy: timebasePolicyRef,
      conformPolicy: conformPolicyRef,
      colorPolicy: colorPolicyRef,
    },
    qa: { status: "PASS", findings: [] },
    qaStatus: "PASS",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  // Stale input detection (§20): alignment/caption hashes must be current.
  if (inputs.alignment && inputs.alignment.narrationTimingHash && inputs.alignment.narrationTimingHash !== finalAudio.narrationTimingHash) {
    findings.push(finding("STALE_INPUT_HASH", { reason: "alignment was built against a different narrationTimingHash", correctiveAction: "REALIGN_BEFORE_TIMELINE" }));
  }
  const qa = timelineQA(manifest, { extraFindings: findings, preservedLocked });
  manifest.qa = { status: qa.status, findings: qa.findings, metrics: qa.metrics };
  manifest.qaStatus = qa.status;
  const valid = validator()(manifest);
  if (!valid) return { ok: false, code: "SCHEMA_INVALID", message: ajvText(validator().errors) };
  return { ok: true, manifest, qa, metrics: { buildLatencyMs: Date.now() - t0, itemCount: items.length, preservedLocked } };
}

function identityKey(item) {
  return JSON.stringify([item.timelineItemId, item.assetId, item.timelineRange.startTime, item.timelineRange.endTime]);
}

function conformPolicyRef2colorRef(colorPolicyRef) {
  return colorPolicyRef; // colorRef carries the color policy ref; audio items keep the ref without findings
}

// ---------- QA (3A-12, §23) ----------

function timelineQA(manifest, { extraFindings = [], expectedNarrationTimingHash } = {}) {
  const findings = [...extraFindings];
  const frameRate = timebase.getTimebasePolicy(manifest.timebasePolicyRef).frameRate;
  // Frame-mapping re-verification on every item (FRAME_MAPPING_MISMATCH).
  for (const item of manifest.items) {
    const r = item.timelineRange;
    if (r.startFrame !== timebase.timeToFrameStart(r.startTime, frameRate) ||
        r.endFrameExclusive !== timebase.timeToFrameEndExclusive(r.endTime, frameRate)) {
      findings.push(finding("FRAME_MAPPING_MISMATCH", { timelineItemId: item.timelineItemId, reason: "stored frames do not match deterministic conversion", correctiveAction: "REBUILD_TIMELINE" }));
    }
    if (r.endFrameExclusive <= r.startFrame) {
      findings.push(finding("INVALID_RANGE", { timelineItemId: item.timelineItemId, reason: "non-positive frame span", correctiveAction: "FIX_ITEM_RANGE" }));
    }
    if (r.endTime > manifest.canonicalDuration.time) {
      findings.push(finding("TIMELINE_RANGE_OVERFLOW", { timelineItemId: item.timelineItemId, reason: `end ${r.endTime}ms beyond canonical duration`, correctiveAction: "RETIME_OR_TRIM_ITEM" }));
    }
  }
  // Overlap check within each track (except narration — assembly guarantees order).
  const byTrack = new Map();
  for (const item of manifest.items) {
    if (!byTrack.has(item.trackId)) byTrack.set(item.trackId, []);
    byTrack.get(item.trackId).push(item);
  }
  for (const [trackId, list] of byTrack) {
    const sorted = list.slice().sort((a, b) => a.timelineRange.startTime - b.timelineRange.startTime);
    for (let i = 1; i < sorted.length; i += 1) {
      if (sorted[i].timelineRange.startTime < sorted[i - 1].timelineRange.endTime) {
        findings.push(finding("INVALID_RANGE", { trackId, timelineItemId: sorted[i].timelineItemId, reason: `overlaps previous item on ${trackId}`, correctiveAction: "RETIME_OR_REMOVE_OVERLAP" }));
      }
    }
  }
  // Speech timing consistency: narration items must exist when final audio has narration.
  const narration = manifest.items.filter((i) => i.trackType === "NARRATION");
  if (manifest.dependencyHashes && expectedNarrationTimingHash && manifest.sourceTiming.narrationTimingHash !== expectedNarrationTimingHash) {
    findings.push(finding("STALE_INPUT_HASH", { reason: "manifest narrationTimingHash != current input", correctiveAction: "REBUILD_TIMELINE" }));
  }
  const fail = findings.some((f) => ["UNKNOWN_ASSET", "INVALID_RANGE", "TIMELINE_RANGE_OVERFLOW", "SOURCE_RANGE_OVERFLOW", "FRAME_MAPPING_MISMATCH", "STALE_INPUT_HASH", "INVALID_TRACK_TYPE"].includes(f.code));
  const review = findings.length > 0 && !fail;
  return {
    status: fail ? "FAIL" : (review ? "REVIEW_REQUIRED" : "PASS"),
    findings,
    metrics: {
      itemCount: manifest.items.length,
      trackCount: manifest.tracks.length,
      narrationItemCount: narration.length,
      findingCount: findings.length,
      qaLatencyMs: 0,
    },
  };
}

// ---------- local patch (3A-13, §18) ----------

/**
 * patch: { patchId, type, expectedRevision, targetId?, item?, assetId?,
 *          timelineRange?, sourceRange?, zIndex?, trackType? }
 */
function patchTimeline(manifest, patch, { assetResolver } = {}) {
  if (!patch || !PATCH_TYPES.includes(patch.type) || !patch.patchId) {
    return { ok: false, code: "PATCH_INVALID", message: ERRORS.PATCH_INVALID };
  }
  if (manifest.appliedPatchIds.includes(patch.patchId)) {
    return { ok: true, manifest, idempotent: true }; // §21: no duplicate mutation
  }
  if (patch.expectedRevision !== undefined && patch.expectedRevision !== manifest.revision) {
    return { ok: false, code: "PATCH_CONFLICT", message: `${ERRORS.PATCH_CONFLICT}: expected revision ${patch.expectedRevision}, current ${manifest.revision}` };
  }
  const working = JSON.parse(JSON.stringify(manifest));
  const frameRate = timebase.getTimebasePolicy(manifest.timebasePolicyRef).frameRate;
  const findItem = (id) => working.items.find((i) => i.timelineItemId === id);

  const retimeChecks = (item, range) => {
    if (item.locked) return "LOCK_VIOLATION";
    if (item.speechBound || SPEECH_BOUND_TRACKS.has(item.trackType)) return "SPEECH_TIMING_PROTECTED";
    if (!Number.isInteger(range.startTime) || !Number.isInteger(range.endTime) || range.endTime <= range.startTime || range.startTime < 0) return "INVALID_RANGE";
    if (range.endTime > working.canonicalDuration.time) return "TIMELINE_RANGE_OVERFLOW";
    return null;
  };
  const applyRange = (item, range) => {
    item.timelineRange = {
      startTime: range.startTime,
      endTime: range.endTime,
      startFrame: timebase.timeToFrameStart(range.startTime, frameRate),
      endFrameExclusive: timebase.timeToFrameEndExclusive(range.endTime, frameRate),
    };
  };

  let applied;
  switch (patch.type) {
    case "INSERT_ITEM": {
      const built = buildTimeline({
        projectId: manifest.projectId,
        finalAudio: {
          artifactId: manifest.sourceTiming.finalAudioArtifactId,
          durationMs: manifest.canonicalDuration.time,
          narrationTimingHash: manifest.sourceTiming.narrationTimingHash,
          finalMixHash: manifest.sourceTiming.finalMixHash,
        },
        assetResolver,
        timebasePolicyRef: manifest.timebasePolicyRef,
        conformPolicyRef: manifest.mediaConformPolicyRef,
        colorPolicyRef: manifest.colorManagementPolicyRef,
        visualItems: [patch.item],
      });
      if (!built.ok) return { ok: false, code: built.code, message: built.message };
      if (built.manifest.qa.findings.length) return { ok: false, code: "PATCH_ITEM_REJECTED", findings: built.manifest.qa.findings };
      const item = built.manifest.items[0];
      working.items.push(item);
      const track = working.tracks.find((t) => t.trackId === item.trackId);
      if (track) track.itemIds.push(item.timelineItemId);
      applied = { timelineItemId: item.timelineItemId };
      break;
    }
    case "REMOVE_ITEM": {
      const item = findItem(patch.targetId);
      if (!item) return { ok: false, code: "PATCH_INVALID", message: "targetId not found" };
      if (item.locked) return { ok: false, code: "LOCK_VIOLATION", message: ERRORS.LOCK_VIOLATION };
      working.items = working.items.filter((i) => i.timelineItemId !== patch.targetId);
      for (const t of working.tracks) t.itemIds = t.itemIds.filter((id) => id !== patch.targetId);
      applied = { timelineItemId: patch.targetId };
      break;
    }
    case "REPLACE_ASSET": {
      const item = findItem(patch.targetId);
      if (!item) return { ok: false, code: "PATCH_INVALID", message: "targetId not found" };
      if (item.locked) return { ok: false, code: "LOCK_VIOLATION", message: ERRORS.LOCK_VIOLATION };
      if (!assetResolver) return { ok: false, code: "INPUT_INVALID", message: "assetResolver required for REPLACE_ASSET" };
      const asset = assetResolver(patch.assetId);
      if (!asset || !asset.hash) return { ok: false, code: "UNKNOWN_ASSET", message: `asset ${patch.assetId} unresolvable` };
      item.assetId = patch.assetId;
      item.dependencyHashes.asset = String(asset.hash);
      applied = { timelineItemId: item.timelineItemId, assetId: patch.assetId };
      break;
    }
    case "RETIME_ITEM": {
      const item = findItem(patch.targetId);
      if (!item) return { ok: false, code: "PATCH_INVALID", message: "targetId not found" };
      const err = retimeChecks(item, patch.timelineRange);
      if (err) return { ok: false, code: err, message: ERRORS[err] || err };
      applyRange(item, patch.timelineRange);
      applied = { timelineItemId: item.timelineItemId, timelineRange: item.timelineRange };
      break;
    }
    case "UPDATE_SOURCE_RANGE": {
      const item = findItem(patch.targetId);
      if (!item) return { ok: false, code: "PATCH_INVALID", message: "targetId not found" };
      if (item.locked) return { ok: false, code: "LOCK_VIOLATION", message: ERRORS.LOCK_VIOLATION };
      item.sourceRange = patch.sourceRange;
      applied = { timelineItemId: item.timelineItemId };
      break;
    }
    case "MOVE_ITEM": {
      const item = findItem(patch.targetId);
      if (!item) return { ok: false, code: "PATCH_INVALID", message: "targetId not found" };
      if (item.locked) return { ok: false, code: "LOCK_VIOLATION", message: ERRORS.LOCK_VIOLATION };
      if (patch.zIndex !== undefined) item.zIndex = patch.zIndex;
      if (patch.trackType !== undefined) {
        if (!TRACK_TYPES.includes(patch.trackType)) return { ok: false, code: "INVALID_TRACK_TYPE", message: "unknown track type" };
        if (SPEECH_BOUND_TRACKS.has(patch.trackType) !== SPEECH_BOUND_TRACKS.has(item.trackType)) {
          return { ok: false, code: "SPEECH_TIMING_PROTECTED", message: ERRORS.SPEECH_TIMING_PROTECTED };
        }
        const oldTrack = working.tracks.find((t) => t.trackId === item.trackId);
        if (oldTrack) oldTrack.itemIds = oldTrack.itemIds.filter((id) => id !== item.timelineItemId);
        item.trackType = patch.trackType;
        item.trackId = `trk-${patch.trackType.toLowerCase()}`;
        let track = working.tracks.find((t) => t.trackId === item.trackId);
        if (!track) { track = { trackId: item.trackId, trackType: patch.trackType, itemIds: [] }; working.tracks.push(track); }
        track.itemIds.push(item.timelineItemId);
      }
      applied = { timelineItemId: item.timelineItemId };
      break;
    }
    default:
      return { ok: false, code: "PATCH_INVALID", message: ERRORS.PATCH_INVALID };
  }

  working.appliedPatchIds.push(patch.patchId);
  working.revision += 1;
  working.updatedAt = new Date().toISOString();
  const qa = timelineQA(working, {});
  working.qa = { status: qa.status, findings: qa.findings, metrics: qa.metrics };
  working.qaStatus = qa.status;
  const valid = validator()(working);
  if (!valid) return { ok: false, code: "SCHEMA_INVALID", message: ajvText(validator().errors) };
  return { ok: true, manifest: working, applied, qa };
}

// ---------- dependency / invalidation (§20, RULE 7) ----------

/**
 * Speech timing vs mix-only distinction, extended to the timeline:
 * mix-only (finalMixHash) change → timeline assembly stays CLEAN except the
 * mix reference; speech timing change → timing consumers DIRTY.
 */
function resolveTimelineInvalidation({ prevNarrationTimingHash, nextNarrationTimingHash, prevFinalMixHash, nextFinalMixHash }) {
  const timingChanged = prevNarrationTimingHash !== nextNarrationTimingHash;
  const mixChanged = prevFinalMixHash !== nextFinalMixHash;
  return {
    speechTimingDirty: timingChanged,
    timelineTimingDirty: timingChanged,
    timelineMixRefDirty: mixChanged,
    mixOnlyChange: mixChanged && !timingChanged,
    visualBranchDirty: false, // visual replacement handled per-item by REPLACE_ASSET
  };
}

// ---------- agent-ready internal contract (§22) ----------

function createTimelineStore() {
  const byProject = new Map();
  return {
    buildTimeline(projectId, inputs) {
      const prev = byProject.get(projectId);
      const r = buildTimeline({ ...inputs, projectId, previousManifest: inputs.previousManifest || (prev && prev.manifest) });
      if (r.ok) byProject.set(projectId, { manifest: r.manifest });
      return r;
    },
    getTimeline(projectId) {
      const e = byProject.get(projectId);
      return e ? { ok: true, manifest: e.manifest } : { ok: false, code: "NOT_FOUND" };
    },
    patchTimeline(projectId, patch, opts) {
      const e = byProject.get(projectId);
      if (!e) return { ok: false, code: "NOT_FOUND" };
      const r = patchTimeline(e.manifest, patch, opts);
      if (r.ok && !r.idempotent) byProject.set(projectId, { manifest: r.manifest });
      return r;
    },
    validateTimeline(projectId) {
      const e = byProject.get(projectId);
      if (!e) return { ok: false, code: "NOT_FOUND" };
      return timelineQA(e.manifest, { expectedNarrationTimingHash: e.manifest.sourceTiming.narrationTimingHash });
    },
    getTimelineFindings(projectId) {
      const e = byProject.get(projectId);
      if (!e) return { ok: false, code: "NOT_FOUND" };
      return { ok: true, status: e.manifest.qaStatus, findings: e.manifest.qa.findings };
    },
  };
}

function ajvText(errors) {
  return (errors || []).map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ");
}

module.exports = {
  SCHEMA_VERSION,
  TRACK_TYPES,
  PATCH_TYPES,
  SPEECH_BOUND_TRACKS,
  ERRORS,
  buildTimeline,
  timelineQA,
  patchTimeline,
  resolveTimelineInvalidation,
  createTimelineStore,
  validateManifest(manifest) {
    const ok = validator()(manifest);
    return { ok, errors: ok ? [] : ajvText(validator().errors) };
  },
};
