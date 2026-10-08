"use strict";
// lib/incremental/index.js — Phase 5B (5.1): DependencyDiff + DirtySet +
// range expansion + IncrementalRenderPlan. Pure logic, no I/O.
//
// Reuses pipeline/input-fingerprint.js (stable hash/compare) and
// lib/dependency-dag node states where applicable. Frame ranges are
// canonical integers; ms↔frame conversion stays in lib/timeline/timebase.js.

var fingerprint = require("../../pipeline/input-fingerprint.js");

var VERSION = "1.0.0";

// Fingerprint keys whose change forces GLOBAL invalidation (spec §11).
// Anything else invalidates locally via the dirty set.
var GLOBAL_INVALIDATION_KEYS = [
  "fps", "timebase", "canvasDims",
  "rendererVersion", "remotion", "globalCssTheme", "globalFont",
  "colorPolicy", "motionPrimitiveImpl",
];

var FINDINGS = [
  "DIRTY_RANGE_UNRESOLVED",
  "UNSAFE_INCREMENTAL_BOUNDARY",
  "TRANSITION_DEPENDENCY_MISSING",
  "TEMPORAL_HANDLE_MISSING",
  "FULL_RENDER_REQUIRED",
];

var FEATURE_FLAGS = {
  incrementalRenderEnabled: process.env.UNFOLDIQ_INCREMENTAL_RENDER === "1",
  partialQAEnabled: process.env.UNFOLDIQ_PARTIAL_QA === "1",
  semanticCacheEnabled: process.env.UNFOLDIQ_SEMANTIC_CACHE === "1",
};

// Fingerprint key -> affected artifact ids (Phase 1H.3 vocabulary).
var KEY_ARTIFACTS = {
  renderInput: ["RENDER"],
  renderPlan: ["RENDER"],
  stagingManifest: ["RENDER"],
  timeline: ["MASTER_TIMELINE", "SCENE_TIMING", "RENDER"],
  captions: ["CAPTIONS", "RENDER"],
  audioMix: ["FINAL_AUDIO", "RENDER"],
  visualBible: ["GENERATED_ASSET", "RENDER"],
  continuity: ["GENERATED_ASSET", "RENDER"],
  platformProfile: ["RENDER"],
  remotion: ["RENDER"],
};

function isRange(r) {
  return r && Number.isInteger(r.startFrame) && Number.isInteger(r.endFrameExclusive) &&
    r.startFrame >= 0 && r.endFrameExclusive > r.startFrame;
}

function clampRange(r, totalFrames) {
  return {
    startFrame: Math.max(0, r.startFrame),
    endFrameExclusive: Math.min(totalFrames, r.endFrameExclusive),
  };
}

function mergeRanges(ranges) {
  var list = ranges.filter(isRange).map(function (r) {
    return { startFrame: r.startFrame, endFrameExclusive: r.endFrameExclusive };
  }).sort(function (a, b) { return a.startFrame - b.startFrame; });
  var out = [];
  for (var r of list) {
    var last = out[out.length - 1];
    if (last && r.startFrame <= last.endFrameExclusive) {
      last.endFrameExclusive = Math.max(last.endFrameExclusive, r.endFrameExclusive);
    } else {
      out.push(r);
    }
  }
  return out;
}

// Complement of merged dirty ranges over [0, totalFrames).
function complementRanges(merged, totalFrames) {
  var out = [];
  var cursor = 0;
  for (var r of merged) {
    if (r.startFrame > cursor) out.push({ startFrame: cursor, endFrameExclusive: r.startFrame });
    cursor = Math.max(cursor, r.endFrameExclusive);
  }
  if (cursor < totalFrames) out.push({ startFrame: cursor, endFrameExclusive: totalFrames });
  return out;
}

// Exact-once coverage validation (Cases AB/AC).
function validateCoverage(chunks, totalFrames) {
  var gaps = [];
  var overlaps = [];
  var seen = [];
  var sorted = chunks.slice().sort(function (a, b) { return a.range.startFrame - b.range.startFrame; });
  var cursor = 0;
  for (var i = 0; i < sorted.length; i++) {
    var r = sorted[i].range;
    if (!isRange(r)) return { ok: false, gaps: [], overlaps: [], reason: "CHUNK_MISSING" };
    if (r.startFrame < cursor) overlaps.push({ chunk: i, range: r });
    if (r.startFrame > cursor) gaps.push({ startFrame: cursor, endFrameExclusive: r.startFrame });
    cursor = Math.max(cursor, r.endFrameExclusive);
    seen.push(r);
  }
  if (cursor < totalFrames) gaps.push({ startFrame: cursor, endFrameExclusive: totalFrames });
  // Duplicate detection: identical ranges twice.
  var keys = seen.map(function (r) { return r.startFrame + "-" + r.endFrameExclusive; });
  var dup = keys.length !== new Set(keys).size;
  if (gaps.length > 0) return { ok: false, gaps: gaps, overlaps: overlaps, reason: "ASSEMBLY_GAP" };
  if (overlaps.length > 0 || dup) return { ok: false, gaps: gaps, overlaps: overlaps, reason: dup ? "CHUNK_DUPLICATE" : "ASSEMBLY_OVERLAP" };
  return { ok: true, gaps: [], overlaps: [], reason: null };
}

// ---- DependencyDiff (spec §7) ----
function diffDependencies(prevFp, currFp, opts) {
  opts = opts || {};
  prevFp = prevFp && typeof prevFp === "object" ? prevFp : {};
  currFp = currFp && typeof currFp === "object" ? currFp : {};
  var cmp = fingerprint.compareFingerprints(prevFp, currFp);
  var changes = cmp.changedKeys.map(function (key) {
    return {
      dependencyId: key,
      kind: key,
      oldHash: prevFp[key] === undefined ? null : String(prevFp[key]),
      newHash: currFp[key] === undefined ? null : String(currFp[key]),
      affectedArtifactIds: KEY_ARTIFACTS[key] || ["RENDER"],
      affectedFrameRanges: null, // resolved to scenes in buildDirtySet
      reason: "fingerprint key '" + key + "' changed",
    };
  });
  return {
    version: VERSION,
    previousRevision: prevFp.fingerprintId || null,
    currentRevision: currFp.fingerprintId || null,
    changes: changes,
  };
}

// ---- DirtySet (spec §8/§9/§10/§11) ----
// sceneMap: [{sceneId, startFrame, endFrameExclusive}]
// sceneHashes: optional {prev:{sceneId:hash}, curr:{sceneId:hash}} for scene precision
// transitions: [{boundaryFrame, overlapFrames}]
// captionEvents/motionItems: ranges needing handles
function buildDirtySet(diff, ctx) {
  ctx = ctx || {};
  var totalFrames = ctx.totalFrames;
  if (!Number.isInteger(totalFrames) || totalFrames <= 0) {
    throw new Error("buildDirtySet: totalFrames required");
  }
  var changes = (diff && diff.changes) || [];
  var globalHit = changes.find(function (c) { return GLOBAL_INVALIDATION_KEYS.includes(c.dependencyId); });
  if (globalHit) {
    return {
      version: VERSION, global: true,
      reason: "global key '" + globalHit.dependencyId + "' changed",
      dirtyArtifacts: [], dirtyTimelineItems: [], dirtyMotionItems: [],
      dirtyCaptionEvents: [], dirtyAudioRegions: [],
      dirtyFrameRanges: [{ startFrame: 0, endFrameExclusive: totalFrames }],
      ranges: [{ raw: { startFrame: 0, endFrameExclusive: totalFrames }, expanded: { startFrame: 0, endFrameExclusive: totalFrames }, reasons: [{ rule: "GLOBAL_INVALIDATION", detail: globalHit.dependencyId }] }],
      findings: [],
    };
  }
  if (changes.length === 0) {
    return {
      version: VERSION, global: false, dirtyArtifacts: [], dirtyTimelineItems: [],
      dirtyMotionItems: [], dirtyCaptionEvents: [], dirtyAudioRegions: [],
      dirtyFrameRanges: [], ranges: [], findings: [],
    };
  }
  var sceneMap = ctx.sceneMap || [];
  var rawRanges = [];
  var dirtyArtifacts = [];
  var dirtyTimelineItems = [];
  var dirtyMotionItems = [];
  var dirtyCaptionEvents = [];
  var dirtyAudioRegions = [];
  var findings = [];

  function pushRaw(range, reason) {
    if (!isRange(range)) {
      findings.push({ code: "DIRTY_RANGE_UNRESOLVED", detail: reason });
      return;
    }
    rawRanges.push({ raw: clampRange(range, totalFrames), reasons: [reason] });
  }

  // Scene-precision when per-scene hashes are available (Case B path).
  var sh = ctx.sceneHashes;
  var sceneChanged = {};
  if (sh && sh.prev && sh.curr && changes.some(function (c) { return c.dependencyId === "timeline" || c.dependencyId === "renderInput"; })) {
    var ids = new Set([].concat(Object.keys(sh.prev), Object.keys(sh.curr)));
    ids.forEach(function (id) {
      if (sh.prev[id] !== sh.curr[id]) {
        sceneChanged[id] = true;
        var sc = sceneMap.find(function (s) { return s.sceneId === id; });
        if (sc) {
          pushRaw({ startFrame: sc.startFrame, endFrameExclusive: sc.endFrameExclusive },
            { rule: "SCENE_CONTENT_CHANGED", detail: id });
          dirtyTimelineItems.push(id);
        } else {
          findings.push({ code: "DIRTY_RANGE_UNRESOLVED", detail: "changed scene '" + id + "' not in sceneMap" });
        }
      }
    });
  }
  var sceneLevelResolved = Object.keys(sceneChanged).length > 0;

  for (var c of changes) {
    (c.affectedArtifactIds || []).forEach(function (a) {
      if (!dirtyArtifacts.includes(a)) dirtyArtifacts.push(a);
    });
    if (c.dependencyId === "captions") {
      // Caption edits dirty caption-visible frames (Case E); without event
      // detail, dirty the caption span union from ctx or the full timeline.
      var evs = ctx.captionEvents || [];
      if (evs.length > 0 && !sceneLevelResolved) {
        evs.forEach(function (e, i) {
          pushRaw({ startFrame: e.startFrame, endFrameExclusive: e.endFrameExclusive },
            { rule: "CAPTION_EVENT_DIRTY", detail: "caption event " + i });
          dirtyCaptionEvents.push(i);
        });
      } else if (!sceneLevelResolved) {
        pushRaw({ startFrame: 0, endFrameExclusive: totalFrames }, { rule: "CAPTION_DOC_CHANGED", detail: "no event detail" });
      }
    } else if (c.dependencyId === "audioMix") {
      dirtyAudioRegions.push({ startMs: 0, endMs: null, reason: "audio mix changed (visual usually clean)" });
      // Visual ranges stay clean on audio-only change unless timing moved.
      if (ctx.audioTimingChanged) {
        pushRaw({ startFrame: 0, endFrameExclusive: totalFrames }, { rule: "AUDIO_TIMING_CHANGED", detail: "narrationTimingHash moved" });
      }
    } else if ((c.dependencyId === "timeline" || c.dependencyId === "renderInput" ||
        c.dependencyId === "renderPlan" || c.dependencyId === "stagingManifest" ||
        c.dependencyId === "visualBible" || c.dependencyId === "continuity" ||
        c.dependencyId === "platformProfile") && !sceneLevelResolved) {
      pushRaw({ startFrame: 0, endFrameExclusive: totalFrames },
        { rule: "DOC_CHANGED_NO_SCENE_DETAIL", detail: c.dependencyId });
    }
  }

  // Expansion (§9/§10): transitions, motion handles, caption pads.
  var transitions = ctx.transitions || [];
  var motionItems = ctx.motionItems || [];
  var captionPad = Number.isInteger(ctx.captionPadFrames) ? ctx.captionPadFrames : 0;
  var expanded = rawRanges.map(function (entry) {
    var r = { startFrame: entry.raw.startFrame, endFrameExclusive: entry.raw.endFrameExclusive };
    var reasons = entry.reasons.slice();
    for (var t of transitions) {
      if (typeof t.boundaryFrame !== "number") {
        findings.push({ code: "TRANSITION_DEPENDENCY_MISSING", detail: "transition without boundaryFrame" });
        continue;
      }
      var ov = Number.isInteger(t.overlapFrames) ? t.overlapFrames : 0;
      if (r.startFrame <= t.boundaryFrame && t.boundaryFrame <= r.endFrameExclusive) {
        var before = clampRange({ startFrame: t.boundaryFrame - ov, endFrameExclusive: r.endFrameExclusive }, totalFrames);
        var after = clampRange({ startFrame: r.startFrame, endFrameExclusive: t.boundaryFrame + ov }, totalFrames);
        r.startFrame = Math.min(before.startFrame, after.startFrame);
        r.endFrameExclusive = Math.max(before.endFrameExclusive, after.endFrameExclusive);
        reasons.push({ rule: "TRANSITION_OVERLAP", detail: "boundary @" + t.boundaryFrame + " ±" + ov });
      }
    }
    for (var m of motionItems) {
      if (!isRange(m)) {
        findings.push({ code: "TEMPORAL_HANDLE_MISSING", detail: "motion item without frame range" });
        continue;
      }
      var hs = Number.isInteger(m.temporalSamples) ? m.temporalSamples : 0;
      if (m.startFrame < r.endFrameExclusive && r.startFrame < m.endFrameExclusive) {
        r.startFrame = Math.max(0, Math.min(r.startFrame, m.startFrame - hs));
        r.endFrameExclusive = Math.min(totalFrames, Math.max(r.endFrameExclusive, m.endFrameExclusive + hs));
        reasons.push({ rule: "MOTION_TEMPORAL_HANDLE", detail: (m.id || "motion") + " ±" + hs });
        if (m.id && !dirtyMotionItems.includes(m.id)) dirtyMotionItems.push(m.id);
      }
    }
    if (captionPad > 0) {
      r.startFrame = Math.max(0, r.startFrame - captionPad);
      r.endFrameExclusive = Math.min(totalFrames, r.endFrameExclusive + captionPad);
      reasons.push({ rule: "CAPTION_PAD", detail: "±" + captionPad });
    }
    return { raw: entry.raw, expanded: clampRange(r, totalFrames), reasons: reasons };
  });

  var merged = mergeRanges(expanded.map(function (e) { return e.expanded; }));
  return {
    version: VERSION, global: false, dirtyArtifacts: dirtyArtifacts,
    dirtyTimelineItems: dirtyTimelineItems, dirtyMotionItems: dirtyMotionItems,
    dirtyCaptionEvents: dirtyCaptionEvents, dirtyAudioRegions: dirtyAudioRegions,
    dirtyFrameRanges: merged, ranges: expanded, findings: findings,
  };
}

// Tile a clean range with cached sub-ranges (§13 granularity: cache units
// need not equal clean ranges). Returns reusable pieces or null when the
// range cannot be covered exactly by valid cache hits.
function tileWithCache(cleanRange, knownKeys, lookup) {
  var cands = (knownKeys || []).filter(function (k) {
    return isRange(k.range) && k.range.startFrame >= cleanRange.startFrame &&
      k.range.endFrameExclusive <= cleanRange.endFrameExclusive;
  }).sort(function (a, b) { return a.range.startFrame - b.range.startFrame; });
  var pieces = [];
  for (var c of cands) {
    var hit = null;
    try { hit = lookup(c.actionKey); } catch (e) { hit = null; }
    if (hit && hit.status === "HIT_VALID" && hit.cachedArtifactRef) {
      pieces.push({ range: c.range, actionKey: c.actionKey, cachedArtifactRef: hit.cachedArtifactRef });
    }
  }
  var cov = validateCoverage(pieces.map(function (p) { return { range: p.range }; }),
    cleanRange.endFrameExclusive - cleanRange.startFrame);
  // validateCoverage works on [0,total); shift into range-local coordinates.
  if (!cov.ok && pieces.length > 0) {
    var shifted = pieces.map(function (p) {
      return { range: { startFrame: p.range.startFrame - cleanRange.startFrame, endFrameExclusive: p.range.endFrameExclusive - cleanRange.startFrame } };
    });
    cov = validateCoverage(shifted, cleanRange.endFrameExclusive - cleanRange.startFrame);
  }
  if (!cov.ok || pieces.length === 0) return null;
  return pieces;
}

// ---- IncrementalRenderPlan (spec §12) ----
function planRender(args) {
  args = args || {};
  var dirtySet = args.dirtySet;
  var totalFrames = args.totalFrames;
  if (!dirtySet || !Number.isInteger(totalFrames) || totalFrames <= 0) {
    throw new Error("planRender: dirtySet + totalFrames required");
  }
  var lookup = args.cacheLookup || function () { return null; };
  var keyFor = args.keyForRange || function (r) { return "range:" + r.startFrame + "-" + r.endFrameExclusive; };
  var planId = args.planId || ("irp-" + Date.now().toString(36));
  if (args.uncertain) {
    return {
      planId: planId, version: VERSION,
      sourceRevision: args.sourceRevision || null, targetRevision: args.targetRevision || null,
      dirtyRanges: dirtySet.ranges || [], reusableRegions: [], renderRegions: [],
      fallback: "FULL_RENDER_REQUIRED", fallbackReason: "uncertain correctness flag set (RULE 20)",
    };
  }
  if (dirtySet.global) {
    return {
      planId: planId, version: VERSION,
      sourceRevision: args.sourceRevision || null, targetRevision: args.targetRevision || null,
      dirtyRanges: dirtySet.ranges || [], reusableRegions: [], renderRegions: [],
      fallback: "FULL_RENDER_REQUIRED", fallbackReason: dirtySet.reason,
    };
  }
  var merged = mergeRanges((dirtySet.dirtyFrameRanges || []).filter(isRange));
  var renderRegions = merged.map(function (r) {
    return { range: r, actionKey: keyFor(r), reason: "dirty-expanded" };
  });
  var reusableRegions = [];
  var blocked = [];
  var knownKeys = args.knownKeys || [];
  for (var clean of complementRanges(merged, totalFrames)) {
    var key = keyFor(clean);
    var hit = null;
    try { hit = lookup(key); } catch (e) { hit = null; }
    if (hit && hit.status === "HIT_VALID" && hit.cachedArtifactRef) {
      reusableRegions.push({ range: clean, actionKey: key, cachedArtifactRef: hit.cachedArtifactRef });
      continue;
    }
    // Whole-range miss: tile with cached sub-ranges (cache granularity).
    var pieces = tileWithCache(clean, knownKeys, lookup);
    if (pieces) {
      pieces.forEach(function (p) { reusableRegions.push(p); });
    } else {
      blocked.push({ range: clean, actionKey: key, hitStatus: hit ? hit.status : "MISS" });
    }
  }
  if (blocked.length > 0) {
    return {
      planId: planId, version: VERSION,
      sourceRevision: args.sourceRevision || null, targetRevision: args.targetRevision || null,
      dirtyRanges: dirtySet.ranges || [], reusableRegions: [], renderRegions: [],
      fallback: "FULL_RENDER_REQUIRED",
      fallbackReason: blocked.length + " clean range(s) without valid cache (first: " +
        blocked[0].range.startFrame + "-" + blocked[0].range.endFrameExclusive + " " + blocked[0].hitStatus + ")",
    };
  }
  return {
    planId: planId, version: VERSION,
    sourceRevision: args.sourceRevision || null, targetRevision: args.targetRevision || null,
    dirtyRanges: dirtySet.ranges || [], reusableRegions: reusableRegions, renderRegions: renderRegions,
    fallback: "NONE",
  };
}

module.exports = {
  VERSION: VERSION,
  GLOBAL_INVALIDATION_KEYS: GLOBAL_INVALIDATION_KEYS,
  FINDINGS: FINDINGS,
  FEATURE_FLAGS: FEATURE_FLAGS,
  KEY_ARTIFACTS: KEY_ARTIFACTS,
  isRange: isRange,
  clampRange: clampRange,
  mergeRanges: mergeRanges,
  complementRanges: complementRanges,
  validateCoverage: validateCoverage,
  tileWithCache: tileWithCache,
  diffDependencies: diffDependencies,
  buildDirtySet: buildDirtySet,
  planRender: planRender,
};
