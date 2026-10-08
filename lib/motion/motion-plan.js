"use strict";

/**
 * Phase 3B §13–§16, §31–§38 — MotionPlan build / validate / patch / repair.
 *
 * Canonical separation: editorial intent → motion intent → grammar →
 * MotionPlan → primitive registry → deterministic render execution. Never
 * LLM → arbitrary animation code → production.
 *
 * Motion execution MUST fit the existing Master Timeline: transitions are
 * overlaps, never additions. Canonical duration/speech/caption timing are
 * never shifted by motion (§16).
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const primitives = require("./primitives.js");
const timing = require("./timing.js");
const grammar = require("./grammar.js");

const MOTION_PLAN_VERSION = "1.0.0";
const PLAN_REVISION_START = 1;

const VISUAL_TRACKS = new Set(["VIDEO", "IMAGE", "CHART", "MAP", "DIAGRAM", "OVERLAY", "TITLE"]);
const TRANSITION_ALIGNMENTS = ["CENTER_AT_CUT", "START_AT_CUT", "END_AT_CUT", "CUSTOM"];
const TRANSITION_FALLBACKS = ["CUT", "FADE", "REVIEW_REQUIRED"];
const PATCH_OPS = ["LOCK_MOTION", "UNLOCK_MOTION", "REPLAN_MOTION", "REPLACE_PRIMITIVE", "RETIME_MOTION", "SET_STATIC", "CHANGE_TIMING_PRESET"];

const DEFAULT_PRIMITIVE_BY_TRACK = {
  IMAGE: "KEN_BURNS",
  CHART: "CHART_REVEAL",
  DIAGRAM: "DIAGRAM_STEP_REVEAL",
  MAP: "PAN",
  VIDEO: "PAN",
  OVERLAY: "REVEAL",
  TITLE: "REVEAL",
};

function sha16(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex").slice(0, 16);
}

function finding(code, extra = {}) {
  return {
    code,
    severity: extra.severity || "REVIEW",
    timelineItemId: extra.timelineItemId || null,
    transitionId: extra.transitionId || null,
    frameRange: extra.frameRange || null,
    reason: extra.reason || code,
    correctiveAction: extra.correctiveAction || null,
  };
}

// ---------- build (§13) ----------

/**
 * Build a MotionPlan from a Master Timeline manifest + per-item motion intents.
 * intentsByItem: { [timelineItemId]: { purpose?, hasMotionPurpose?, ...grammar
 *   signals, primitiveRef?, timingPresetRef?, params?, keyframes?,
 *   motionBlur?, captionDensity?, flashes?, assetType?, depthLayers?,
 *   chartSemantics?, layer? (PRIMARY|SUPPORTING|DECORATIVE), locked? } }
 * transitions: [{ fromTimelineItemId, toTimelineItemId, primitiveRef?,
 *   timingPresetRef?, alignment?, durationFrames?, fallback?, reason? }]
 */
function buildMotionPlan(input = {}) {
  const t0 = Date.now();
  const { projectId, timelineManifest, intentsByItem = {}, transitions = [], coverageRanges = [] } = input;
  if (!projectId || !timelineManifest || !Array.isArray(timelineManifest.items)) {
    return { ok: false, code: "INPUT_INVALID", message: "projectId + timelineManifest.items required" };
  }
  const timebasePolicyRef = timelineManifest.timebasePolicyRef || "web-30@1.0.0";
  const frameRate = timelineFrameRate(timelineManifest);
  const items = [];
  for (const ti of timelineManifest.items) {
    if (!VISUAL_TRACKS.has(ti.trackType)) continue;
    const intent = intentsByItem[ti.timelineItemId] || {};
    const decided = grammar.decidePresence(intent);
    const range = { startFrame: ti.timelineRange.startFrame, endFrameExclusive: ti.timelineRange.endFrameExclusive };
    const motionItemId = `mo-${sha16({ t: ti.timelineItemId, v: MOTION_PLAN_VERSION }).slice(0, 12)}`;
    const base = {
      motionItemId,
      timelineItemId: ti.timelineItemId,
      presence: decided.presence,
      purpose: decided.purpose,
      frameRange: range,
      locked: intent.locked === true,
      reason: intent.reason || decided.reason,
      confidence: intent.confidence,
      layer: intent.layer || "PRIMARY",
      dependencyHashes: {
        timelineRevision: String(timelineManifest.revision || 0),
        asset: (ti.dependencyHashes && ti.dependencyHashes.asset) || "unknown",
        primitiveRegistry: primitives.REGISTRY_VERSION,
        timing: timing.TIMING_VERSION,
      },
    };
    if (decided.presence === "STATIC") {
      items.push({ ...base, primitiveRef: null, timingPresetRef: null, params: null });
      continue;
    }
    const primitiveRef = intent.primitiveRef || DEFAULT_PRIMITIVE_BY_TRACK[ti.trackType] || "PAN";
    const timingPresetRef = intent.timingPresetRef || "ease-in-out@1.0.0";
    const params = { ...(intent.params || {}) };
    // Deterministic seed default for seeded primitives (persisted, not random).
    const prim = primitives.getPrimitive(primitiveRef);
    if (prim && prim.requiresSeed && (params.seed === undefined || params.seed === null)) {
      params.seed = sha16({ mo: motionItemId, prim: primitiveRef });
    }
    const motionBlur = intent.motionBlur
      ? intent.motionBlur
      : { enabled: false };
    items.push({
      ...base,
      primitiveRef,
      timingPresetRef,
      params,
      keyframes: intent.keyframes || null,
      motionBlur,
      safetyDecision: null,
      captionDensity: intent.captionDensity || null,
      flashes: intent.flashes || null,
      chartSemantics: intent.chartSemantics || null,
    });
  }

  // Transitions resolve cut frames from timeline adjacency.
  const byId = new Map(timelineManifest.items.map((i) => [i.timelineItemId, i]));
  const order = [...timelineManifest.items].sort((a, b) => a.timelineRange.startFrame - b.timelineRange.startFrame);
  const motionTransitions = [];
  for (let k = 0; k < transitions.length; k++) {
    const tr = transitions[k];
    const from = byId.get(tr.fromTimelineItemId);
    const to = byId.get(tr.toTimelineItemId);
    if (!from || !to) {
      return { ok: false, code: "TRANSITION_STRUCTURE_INVALID", message: `transition[${k}] references unknown timeline items` };
    }
    const cutFrame = from.timelineRange.endFrameExclusive;
    const primitiveRef = tr.primitiveRef || "CROSSFADE";
    const alignment = tr.alignment || "CENTER_AT_CUT";
    const durationFrames = tr.durationFrames !== undefined ? tr.durationFrames : 12;
    // Source-handle requirement derives from alignment (Premiere semantics §3.2).
    let handleReq;
    if (alignment === "CENTER_AT_CUT") {
      handleReq = { fromTailFrames: Math.ceil(durationFrames / 2), toHeadFrames: Math.floor(durationFrames / 2) };
    } else if (alignment === "START_AT_CUT") {
      handleReq = { fromTailFrames: 0, toHeadFrames: durationFrames };
    } else if (alignment === "END_AT_CUT") {
      handleReq = { fromTailFrames: durationFrames, toHeadFrames: 0 };
    } else {
      handleReq = tr.sourceHandleRequirement || { fromTailFrames: durationFrames, toHeadFrames: 0 };
    }
    motionTransitions.push({
      transitionId: `tr-${sha16({ f: tr.fromTimelineItemId, t: tr.toTimelineItemId, k }).slice(0, 12)}`,
      fromTimelineItemId: tr.fromTimelineItemId,
      toTimelineItemId: tr.toTimelineItemId,
      primitiveRef,
      timingPresetRef: tr.timingPresetRef || "linear@1.0.0",
      alignment,
      durationFrames,
      cutFrame,
      sourceHandleRequirement: handleReq,
      fallback: tr.fallback || "CUT",
      reason: tr.reason || tr.cutMotivation || "transition at editorial boundary",
      cutMotivation: tr.cutMotivation || null,
      locked: tr.locked === true,
      orderHint: order.findIndex((i) => i.timelineItemId === tr.fromTimelineItemId),
    });
  }

  const coverage = grammar.buildCoveragePlan(coverageRanges.length ? coverageRanges : defaultCoverage(timelineManifest, items));
  const plan = {
    version: MOTION_PLAN_VERSION,
    projectId,
    timelineId: timelineManifest.timelineId || timelineManifest.projectId || projectId,
    timelineRevision: timelineManifest.revision || 0,
    timebasePolicyRef,
    revision: PLAN_REVISION_START,
    items,
    transitions: motionTransitions,
    coverage,
    qaStatus: "REVIEW_REQUIRED",
    inputHashes: {
      timeline: sha16({ rev: timelineManifest.revision, dur: timelineManifest.canonicalDuration }),
      primitiveRegistry: primitives.REGISTRY_VERSION,
      grammarPolicy: grammar.MOTION_GRAMMAR_POLICY_VERSION,
      timing: timing.TIMING_VERSION,
    },
    appliedPatchIds: [],
    elapsedMs: Date.now() - t0,
  };
  const qa = validateMotionPlan(plan, { timelineManifest });
  plan.qaStatus = qa.status;
  plan.qa = { status: qa.status, findings: qa.findings };
  return { ok: true, plan, qa };
}

function defaultCoverage(timelineManifest, motionItems) {
  // Every visual motion item covers its range; timeline gaps with no visual
  // item and no explicit rest become UNRESOLVED only when the caller declares
  // them required — default here marks covered ranges honestly.
  return motionItems.map((m) => ({
    startFrame: m.frameRange.startFrame,
    endFrameExclusive: m.frameRange.endFrameExclusive,
    hasVisual: true,
    reason: `covered by ${m.timelineItemId}`,
  }));
}

function timelineFrameRate(timelineManifest) {
  const ref = timelineManifest.timebasePolicyRef || "web-30@1.0.0";
  try {
    const tb = require("../timeline/timebase.js").getTimebasePolicy(ref);
    return tb.frameRate;
  } catch {
    return { numerator: 30, denominator: 1 };
  }
}

// ---------- validate / QA (§15, §35–§36) ----------

function validateMotionPlan(plan, context = {}) {
  const findings = [];
  const timelineManifest = context.timelineManifest || null;
  const frameRate = timelineManifest ? timelineFrameRate(timelineManifest) : { numerator: 30, denominator: 1 };
  const availableHandles = context.availableHandles || {};
  const byTimelineId = new Map((timelineManifest ? timelineManifest.items : []).map((i) => [i.timelineItemId, i]));

  // Stale dependency (§36 STALE_TIMELINE_INPUT).
  if (timelineManifest && plan.timelineRevision !== (timelineManifest.revision || 0)) {
    findings.push(finding("STALE_TIMELINE_INPUT", {
      severity: "BLOCK",
      reason: `MotionPlan built for timeline revision ${plan.timelineRevision}, timeline is ${timelineManifest.revision}`,
      correctiveAction: "REBUILD_MOTION_PLAN",
    }));
  }

  for (const item of plan.items) {
    const ti = byTimelineId.get(item.timelineItemId);
    const range = item.frameRange;
    // Frame-range validity.
    if (!range || !Number.isInteger(range.startFrame) || !Number.isInteger(range.endFrameExclusive) || range.endFrameExclusive <= range.startFrame) {
      findings.push(finding("INVALID_MOTION_RANGE", { severity: "BLOCK", timelineItemId: item.timelineItemId, frameRange: range, reason: "frameRange must be integer [start, end)", correctiveAction: "RETIME_MOTION" }));
      continue;
    }
    if (ti && (range.startFrame !== ti.timelineRange.startFrame || range.endFrameExclusive !== ti.timelineRange.endFrameExclusive)) {
      findings.push(finding("TRANSITION_CHANGES_CANONICAL_DURATION", { severity: "BLOCK", timelineItemId: item.timelineItemId, frameRange: range, reason: "motion range drifted from Master Timeline range", correctiveAction: "REPLAN_MOTION" }));
    }
    // Duration vs primitive bounds.
    const prim = item.primitiveRef ? primitives.getPrimitive(item.primitiveRef) : null;
    if (item.presence !== "STATIC" && !prim) {
      findings.push(finding("UNKNOWN_PRIMITIVE", { severity: "BLOCK", timelineItemId: item.timelineItemId, frameRange: range, reason: `unknown primitive ${item.primitiveRef}`, correctiveAction: "REPLACE_PRIMITIVE" }));
      continue;
    }
    if (item.presence === "STATIC" && item.primitiveRef) {
      findings.push(finding("MOTION_WITHOUT_PURPOSE", { severity: "REVIEW", timelineItemId: item.timelineItemId, frameRange: range, reason: "STATIC item carries a primitive", correctiveAction: "SET_STATIC" }));
    }
    if (item.presence !== "STATIC" && !item.primitiveRef) {
      findings.push(finding("MOTION_WITHOUT_PURPOSE", { severity: "REVIEW", timelineItemId: item.timelineItemId, frameRange: range, reason: "non-STATIC item without primitive/purpose", correctiveAction: "SET_STATIC" }));
    }
    if (prim) {
      const dur = range.endFrameExclusive - range.startFrame;
      if (prim.minDurationFrames && dur < prim.minDurationFrames) {
        findings.push(finding("INVALID_MOTION_RANGE", { severity: "REVIEW", timelineItemId: item.timelineItemId, frameRange: range, reason: `${item.primitiveRef} needs ≥ ${prim.minDurationFrames} frames, has ${dur}`, correctiveAction: "RETIME_MOTION" }));
      }
      if (prim.maxDurationFrames && dur > prim.maxDurationFrames) {
        findings.push(finding("INVALID_MOTION_RANGE", { severity: "REVIEW", timelineItemId: item.timelineItemId, frameRange: range, reason: `${item.primitiveRef} allows ≤ ${prim.maxDurationFrames} frames, has ${dur}`, correctiveAction: "REPLACE_PRIMITIVE" }));
      }
      // Params + determinism.
      const assetType = ti ? ti.trackType : (context.assetTypeByItem && context.assetTypeByItem[item.timelineItemId]);
      const pv = primitives.validatePrimitiveParams(item.primitiveRef, item.params || {}, { assetType });
      for (const e of pv.errors) {
        const code = e.startsWith("NON_DETERMINISTIC") ? "NON_DETERMINISTIC_MOTION" : e.startsWith("UNSUPPORTED_ASSET") ? "UNKNOWN_PRIMITIVE" : "INVALID_MOTION_RANGE";
        findings.push(finding(code, { severity: code === "NON_DETERMINISTIC_MOTION" ? "BLOCK" : "REVIEW", timelineItemId: item.timelineItemId, frameRange: range, reason: e, correctiveAction: "REPLACE_PRIMITIVE" }));
      }
      // Parallax capability honesty (§10.2).
      if (item.primitiveRef === "PARALLAX" && context.depthAvailableByItem && context.depthAvailableByItem[item.timelineItemId] === false) {
        findings.push(finding("UNKNOWN_PRIMITIVE", { severity: "REVIEW", timelineItemId: item.timelineItemId, frameRange: range, reason: "PARALLAX on asset without layers/depth metadata", correctiveAction: "REPLACE_PRIMITIVE" }));
      }
      // Timing preset validity.
      if (item.timingPresetRef && !timing.getTimingPreset(item.timingPresetRef)) {
        findings.push(finding("INVALID_KEYFRAME", { severity: "REVIEW", timelineItemId: item.timelineItemId, frameRange: range, reason: `unknown timing preset ${item.timingPresetRef}`, correctiveAction: "CHANGE_TIMING_PRESET" }));
      } else if (item.timingPresetRef && prim && !prim.timingCapabilities.includes((timing.getTimingPreset(item.timingPresetRef) || {}).type)) {
        findings.push(finding("INVALID_KEYFRAME", { severity: "REVIEW", timelineItemId: item.timelineItemId, frameRange: range, reason: `${item.primitiveRef} does not support timing type ${(timing.getTimingPreset(item.timingPresetRef) || {}).type}`, correctiveAction: "CHANGE_TIMING_PRESET" }));
      }
      // Keyframes.
      if (item.keyframes) {
        const nk = timing.normalizeKeyframes(item.keyframes, range, item.timingPresetRef);
        if (!nk.ok) {
          for (const e of nk.errors) findings.push(finding("INVALID_KEYFRAME", { severity: "REVIEW", timelineItemId: item.timelineItemId, frameRange: range, reason: e, correctiveAction: "RETIME_MOTION" }));
        }
      }
      // Motion blur cost (§27, §36 MOTION_COST_REVIEW).
      if (item.motionBlur && item.motionBlur.enabled) {
        if (!prim.supportsMotionBlur) {
          findings.push(finding("MOTION_COST_REVIEW", { severity: "REVIEW", timelineItemId: item.timelineItemId, frameRange: range, reason: `${item.primitiveRef} declares no motion-blur benefit`, correctiveAction: "DISABLE_MOTION_BLUR" }));
        } else if (!item.motionBlur.reason && !(item.reason || "").length) {
          findings.push(finding("MOTION_COST_REVIEW", { severity: "REVIEW", timelineItemId: item.timelineItemId, frameRange: range, reason: "motion blur enabled without recorded reason", correctiveAction: "DISABLE_MOTION_BLUR" }));
        }
      }
      // Flash safety (§28).
      if (prim.safety.mayFlash || (item.flashes && item.flashes.length)) {
        const fs = grammar.validateFlashSafety({ flashes: item.flashes || [], frameRate, mayFlash: prim.safety.mayFlash });
        if (fs.decision === "BLOCK") {
          findings.push(finding("FLASH_SAFETY_FAIL", { severity: "BLOCK", timelineItemId: item.timelineItemId, frameRange: range, reason: fs.reason, correctiveAction: "REPLACE_TRANSITION" }));
        } else if (fs.decision === "REVIEW") {
          findings.push(finding("FLASH_SAFETY_REVIEW", { severity: "REVIEW", timelineItemId: item.timelineItemId, frameRange: range, reason: fs.reason, correctiveAction: "REVIEW_FLASH" }));
        }
      }
      // Chart semantics (§24).
      if (prim.category === "DATA" && item.chartSemantics) {
        const cs = grammar.validateChartSemantics(item.chartSemantics);
        for (const e of cs.errors) {
          findings.push(finding("MISLEADING_CHART_ANIMATION", { severity: "BLOCK", timelineItemId: item.timelineItemId, frameRange: range, reason: e, correctiveAction: "REPLAN_MOTION" }));
        }
      }
    }
    // Caption-aware restraint (§25).
    if (item.captionDensity) {
      const cr = grammar.captionRestraint(item.presence, item.captionDensity, item.purpose);
      if (cr.risk) {
        findings.push(finding("CAPTION_DISTRACTION_RISK", { severity: "REVIEW", timelineItemId: item.timelineItemId, frameRange: range, reason: cr.reason, correctiveAction: "REDUCE_MOTION" }));
      }
    }
  }

  // Repetition guards (motion + transition).
  const ordered = [...plan.items].sort((a, b) => a.frameRange.startFrame - b.frameRange.startFrame);
  const reps = grammar.detectRepetition(ordered.map((m) => ({
    primitiveRef: m.primitiveRef, paramsDirection: m.params && m.params.direction, timingPresetRef: m.timingPresetRef,
  })));
  for (const r of reps) {
    const item = ordered[r.index];
    findings.push(finding("REPETITIVE_MOTION_PATTERN", { severity: "REVIEW", timelineItemId: item.timelineItemId, frameRange: item.frameRange, reason: `same primitive/direction/timing repeated ${r.runLength}× (${r.key})`, correctiveAction: "REPLAN_MOTION" }));
  }
  const trKeys = plan.transitions.map((t) => t.primitiveRef);
  let run = 1;
  for (let i = 1; i <= trKeys.length; i++) {
    if (trKeys[i] === trKeys[i - 1]) run++;
    else {
      if (trKeys[i - 1] && run >= 3 && trKeys[i - 1] !== "CUT") {
        findings.push(finding("REPETITIVE_TRANSITION_PATTERN", { severity: "REVIEW", transitionId: plan.transitions[i - 1].transitionId, reason: `transition ${trKeys[i - 1]} repeated ${run}×`, correctiveAction: "REPLAN_MOTION" }));
      }
      run = 1;
    }
  }

  // Motion hierarchy (§21): ≥3 simultaneous non-STATIC layers in one range.
  const active = ordered.filter((m) => m.presence !== "STATIC");
  for (let i = 0; i < active.length; i++) {
    const overlap = active.filter((m, j) => j !== i
      && m.frameRange.startFrame < active[i].frameRange.endFrameExclusive
      && m.frameRange.endFrameExclusive > active[i].frameRange.startFrame);
    if (overlap.length >= 2 && active[i].layer === "DECORATIVE") {
      findings.push(finding("MOTION_HIERARCHY_CONFLICT", { severity: "REVIEW", timelineItemId: active[i].timelineItemId, frameRange: active[i].frameRange, reason: "decorative motion competes with multiple simultaneous moving layers", correctiveAction: "REDUCE_MOTION" }));
      break;
    }
  }

  // Transitions: feasibility + canonical preservation (§15–§16).
  const seenCuts = new Set();
  for (const tr of plan.transitions) {
    const from = byTimelineId.get(tr.fromTimelineItemId);
    const to = byTimelineId.get(tr.toTimelineItemId);
    if (!from || !to) {
      findings.push(finding("TRANSITION_STRUCTURE_INVALID", { severity: "BLOCK", transitionId: tr.transitionId, reason: "transition references unknown timeline items", correctiveAction: "REPLAN_MOTION" }));
      continue;
    }
    if (tr.durationFrames <= 0) {
      findings.push(finding("TRANSITION_TOO_LONG", { severity: "BLOCK", transitionId: tr.transitionId, reason: "transition duration must be > 0", correctiveAction: "REDUCE_TRANSITION_DURATION" }));
      continue;
    }
    const fromLen = from.timelineRange.endFrameExclusive - from.timelineRange.startFrame;
    const toLen = to.timelineRange.endFrameExclusive - to.timelineRange.startFrame;
    if (tr.cutFrame !== from.timelineRange.endFrameExclusive || tr.cutFrame !== to.timelineRange.startFrame) {
      findings.push(finding("TRANSITION_CHANGES_CANONICAL_DURATION", { severity: "BLOCK", transitionId: tr.transitionId, reason: `cutFrame ${tr.cutFrame} is not the from-end/to-start boundary`, correctiveAction: "REPLAN_MOTION" }));
    }
    const usable = Math.min(fromLen, toLen);
    if (tr.durationFrames > usable) {
      findings.push(finding("TRANSITION_TOO_LONG", { severity: "BLOCK", transitionId: tr.transitionId, reason: `duration ${tr.durationFrames} exceeds adjacent usable range ${usable}`, correctiveAction: "REDUCE_TRANSITION_DURATION" }));
    }
    // Handle availability (no silent freeze unless explicit policy — none exists in V1).
    const req = tr.sourceHandleRequirement || { fromTailFrames: 0, toHeadFrames: 0 };
    const haveFrom = (availableHandles[tr.fromTimelineItemId] && availableHandles[tr.fromTimelineItemId].tailFrames) || 0;
    const haveTo = (availableHandles[tr.toTimelineItemId] && availableHandles[tr.toTimelineItemId].headFrames) || 0;
    if (req.fromTailFrames > haveFrom || req.toHeadFrames > haveTo) {
      findings.push(finding("TRANSITION_HANDLE_MISSING", { severity: "REVIEW", transitionId: tr.transitionId, reason: `needs from-tail ${req.fromTailFrames}/to-head ${req.toHeadFrames}, have ${haveFrom}/${haveTo}`, correctiveAction: "FALLBACK_CUT_OR_FADE" }));
    }
    if (!TRANSITION_FALLBACKS.includes(tr.fallback)) {
      findings.push(finding("TRANSITION_STRUCTURE_INVALID", { severity: "REVIEW", transitionId: tr.transitionId, reason: `unknown fallback ${tr.fallback}`, correctiveAction: "REPLAN_MOTION" }));
    }
    const cutKey = `${tr.fromTimelineItemId}>${tr.toTimelineItemId}`;
    if (seenCuts.has(cutKey)) {
      findings.push(finding("TRANSITION_STRUCTURE_INVALID", { severity: "BLOCK", transitionId: tr.transitionId, reason: "duplicate transition on the same cut", correctiveAction: "REPLAN_MOTION" }));
    }
    seenCuts.add(cutKey);
    // Flash-capable transitions declare safety metadata.
    const tprim = primitives.getPrimitive(tr.primitiveRef);
    if (!tprim) {
      findings.push(finding("UNKNOWN_PRIMITIVE", { severity: "BLOCK", transitionId: tr.transitionId, reason: `unknown transition primitive ${tr.primitiveRef}`, correctiveAction: "REPLACE_TRANSITION" }));
    } else if (tprim.safety.mayFlash) {
      findings.push(finding("FLASH_SAFETY_REVIEW", { severity: "REVIEW", transitionId: tr.transitionId, reason: `${tr.primitiveRef} is flash-capable: declared safety metadata recorded`, correctiveAction: "REVIEW_FLASH" }));
    }
  }

  // Canonical duration preservation: motion never changes timeline duration.
  if (timelineManifest) {
    const span = motionSpan(plan);
    const canon = timelineManifest.canonicalDuration.frameCount;
    if (span !== null && span !== canon) {
      findings.push(finding("TRANSITION_CHANGES_CANONICAL_DURATION", { severity: "BLOCK", reason: `motion span ${span} ≠ canonical ${canon}`, correctiveAction: "REPLAN_MOTION" }));
    }
  }

  // Visual coverage: required gaps block honestly (§23).
  if (plan.coverage && Array.isArray(plan.coverage.ranges)) {
    for (const r of plan.coverage.ranges) {
      if (r.status === "UNRESOLVED_REQUIRED_GAP") {
        findings.push(finding("UNRESOLVED_REQUIRED_GAP", { severity: "BLOCK", frameRange: { startFrame: r.startFrame, endFrameExclusive: r.endFrameExclusive }, reason: r.reason || "required visual coverage missing", correctiveAction: "REQUEST_VISUAL_ASSET" }));
      }
    }
  }

  const blocks = findings.filter((f) => f.severity === "BLOCK");
  const reviews = findings.filter((f) => f.severity === "REVIEW");
  const status = blocks.length > 0 ? "FAIL" : reviews.length > 0 ? "REVIEW_REQUIRED" : "PASS";
  return { status, findings, blocks: blocks.length, reviews: reviews.length };
}

function motionSpan(plan) {
  if (!plan.items.length) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const m of plan.items) {
    min = Math.min(min, m.frameRange.startFrame);
    max = Math.max(max, m.frameRange.endFrameExclusive);
  }
  return max - (min === Infinity ? 0 : min);
}

// Transition placement (§14, §16): frame-exact deterministic overlap windows
// that never extend the canonical timeline.
function transitionWindow(tr) {
  const d = tr.durationFrames;
  if (tr.alignment === "CENTER_AT_CUT") {
    const before = Math.ceil(d / 2);
    return { startFrame: tr.cutFrame - before, endFrameExclusive: tr.cutFrame + (d - before) };
  }
  if (tr.alignment === "START_AT_CUT") return { startFrame: tr.cutFrame, endFrameExclusive: tr.cutFrame + d };
  if (tr.alignment === "END_AT_CUT") return { startFrame: tr.cutFrame - d, endFrameExclusive: tr.cutFrame };
  return { startFrame: tr.cutFrame - d, endFrameExclusive: tr.cutFrame }; // CUSTOM defaults to end-anchored
}

// ---------- repair (§37–§38, bounded) ----------

const REPAIR_BUDGET_DEFAULTS = { maxAttempts: 5, timeBudgetMs: 5000 };

function repairMotionPlan(plan, context = {}, budget = {}) {
  const maxAttempts = budget.maxAttempts || REPAIR_BUDGET_DEFAULTS.maxAttempts;
  const deadline = Date.now() + (budget.timeBudgetMs || REPAIR_BUDGET_DEFAULTS.timeBudgetMs);
  const applied = [];
  let working = structuredClonePlan(plan);
  let attempts = 0;
  for (; attempts < maxAttempts; attempts++) {
    if (Date.now() > deadline) break;
    const qa = validateMotionPlan(working, context);
    const fixable = qa.findings.find((f) => REPAIR_ACTION[f.code]);
    if (!fixable) return { ok: qa.status !== "FAIL", plan: working, qa, applied, attempts: attempts + 1, unresolved: qa.findings };
    const action = REPAIR_ACTION[fixable.code](working, fixable, context);
    if (!action || !action.applied) {
      return { ok: false, plan: working, qa, applied, attempts: attempts + 1, unresolved: qa.findings, stopped: fixable.code };
    }
    applied.push({ code: fixable.code, action: action.label, target: fixable.timelineItemId || fixable.transitionId });
    working.revision += 1;
  }
  const qa = validateMotionPlan(working, context);
  return { ok: qa.status !== "FAIL", plan: working, qa, applied, attempts, unresolved: qa.findings };
}

function setStatic(item) {
  item.presence = "STATIC";
  item.primitiveRef = null;
  item.timingPresetRef = null;
  item.params = null;
  item.keyframes = null;
  item.motionBlur = { enabled: false };
  item.purpose = item.purpose || "VISUAL_REST";
  item.reason = `${item.reason || ""} [repair: SET_STATIC]`.trim();
}

const REPAIR_ACTION = {
  MOTION_WITHOUT_PURPOSE: (working, f) => {
    const it = working.items.find((i) => i.timelineItemId === f.timelineItemId);
    if (!it || it.locked) return null;
    setStatic(it);
    return { applied: true, label: "SET_STATIC" };
  },
  TRANSITION_TOO_LONG: (working, f, ctx) => {
    const tr = working.transitions.find((t) => t.transitionId === f.transitionId);
    if (!tr || tr.locked) return null;
    const tl = (ctx.timelineManifest.items || []);
    const from = tl.find((i) => i.timelineItemId === tr.fromTimelineItemId);
    const to = tl.find((i) => i.timelineItemId === tr.toTimelineItemId);
    if (!from || !to) return null;
    const usable = Math.min(
      from.timelineRange.endFrameExclusive - from.timelineRange.startFrame,
      to.timelineRange.endFrameExclusive - to.timelineRange.startFrame);
    if (usable <= 0) return null;
    tr.durationFrames = Math.max(1, usable);
    if (tr.alignment === "CENTER_AT_CUT") {
      tr.sourceHandleRequirement = { fromTailFrames: Math.ceil(tr.durationFrames / 2), toHeadFrames: Math.floor(tr.durationFrames / 2) };
    }
    return { applied: true, label: "REDUCE_TRANSITION_DURATION" };
  },
  TRANSITION_HANDLE_MISSING: (working, f) => {
    const tr = working.transitions.find((t) => t.transitionId === f.transitionId);
    if (!tr || tr.locked) return null;
    tr.primitiveRef = tr.fallback === "FADE" ? "FADE" : "CUT";
    tr.durationFrames = tr.primitiveRef === "CUT" ? 1 : Math.min(tr.durationFrames, 6);
    tr.sourceHandleRequirement = { fromTailFrames: 0, toHeadFrames: 0 };
    tr.reason = `${tr.reason} [repair: FALLBACK_${tr.primitiveRef}]`;
    return { applied: true, label: "FALLBACK_CUT_OR_FADE" };
  },
  REPETITIVE_MOTION_PATTERN: (working, f) => {
    const it = working.items.find((i) => i.timelineItemId === f.timelineItemId);
    if (!it || it.locked) return null;
    const prim = primitives.getPrimitive(it.primitiveRef);
    if (prim && prim.fallbackPrimitiveId) {
      it.primitiveRef = prim.fallbackPrimitiveId;
      it.reason = `${it.reason} [repair: alternate primitive to break repetition]`;
    } else setStatic(it);
    return { applied: true, label: "REPLAN_MOTION" };
  },
  REPETITIVE_TRANSITION_PATTERN: (working, f) => {
    const tr = working.transitions.find((t) => t.transitionId === f.transitionId);
    if (!tr || tr.locked) return null;
    tr.primitiveRef = "CUT";
    tr.durationFrames = 1;
    return { applied: true, label: "REPLAN_MOTION" };
  },
  CAPTION_DISTRACTION_RISK: (working, f) => {
    const it = working.items.find((i) => i.timelineItemId === f.timelineItemId);
    if (!it || it.locked) return null;
    setStatic(it);
    return { applied: true, label: "REDUCE_MOTION" };
  },
  FLASH_SAFETY_FAIL: (working, f) => {
    const it = working.items.find((i) => i.timelineItemId === f.timelineItemId);
    const tr = working.transitions.find((t) => t.transitionId === f.transitionId);
    if (it && !it.locked) {
      it.primitiveRef = "FADE";
      it.flashes = [];
      it.reason = `${it.reason} [repair: flash removed]`;
      return { applied: true, label: "REPLACE_TRANSITION" };
    }
    if (tr && !tr.locked) {
      tr.primitiveRef = "FADE";
      return { applied: true, label: "REPLACE_TRANSITION" };
    }
    return null;
  },
  MOTION_COST_REVIEW: (working, f) => {
    const it = working.items.find((i) => i.timelineItemId === f.timelineItemId);
    if (!it || it.locked) return null;
    it.motionBlur = { enabled: false };
    return { applied: true, label: "DISABLE_MOTION_BLUR" };
  },
};

function structuredClonePlan(plan) {
  return JSON.parse(JSON.stringify(plan));
}

// ---------- patch (§32–§33, local + locked) ----------

function patchMotion(plan, patch = {}, context = {}) {
  if (!patch.patchId || !PATCH_OPS.includes(patch.op)) {
    return { ok: false, code: "PATCH_INVALID", message: `op must be ${PATCH_OPS.join("|")}` };
  }
  if ((plan.appliedPatchIds || []).includes(patch.patchId)) {
    return { ok: true, plan, idempotent: true, applied: { patchId: patch.patchId } };
  }
  if (patch.expectedRevision !== undefined && patch.expectedRevision !== plan.revision) {
    return { ok: false, code: "PATCH_CONFLICT", message: `expected revision ${patch.expectedRevision}, plan is ${plan.revision}` };
  }
  const working = structuredClonePlan(plan);
  const item = working.items.find((i) => i.motionItemId === patch.targetId || i.timelineItemId === patch.targetId);
  if (!item) return { ok: false, code: "PATCH_INVALID", message: "targetId not found" };
  if (item.locked && !["UNLOCK_MOTION", "LOCK_MOTION"].includes(patch.op)) {
    return { ok: false, code: "LOCK_VIOLATION", message: "target motion item is locked" };
  }
  switch (patch.op) {
    case "LOCK_MOTION": item.locked = true; break;
    case "UNLOCK_MOTION": item.locked = false; break;
    case "SET_STATIC": setStatic(item); break;
    case "REPLACE_PRIMITIVE": {
      if (!primitives.getPrimitive(patch.primitiveRef)) return { ok: false, code: "UNKNOWN_PRIMITIVE", message: patch.primitiveRef };
      item.primitiveRef = patch.primitiveRef;
      if (patch.params) item.params = patch.params;
      if (item.presence === "STATIC") item.presence = "SUBTLE";
      item.reason = patch.reason || item.reason;
      break;
    }
    case "CHANGE_TIMING_PRESET": {
      if (!timing.getTimingPreset(patch.timingPresetRef)) return { ok: false, code: "INVALID_KEYFRAME", message: patch.timingPresetRef };
      item.timingPresetRef = patch.timingPresetRef;
      break;
    }
    case "RETIME_MOTION": {
      if (!patch.frameRange || patch.frameRange.startFrame === undefined) return { ok: false, code: "PATCH_INVALID", message: "frameRange required" };
      item.frameRange = { ...patch.frameRange };
      break;
    }
    case "REPLAN_MOTION": {
      const intent = patch.intent || {};
      const decided = grammar.decidePresence(intent);
      item.presence = decided.presence;
      item.purpose = decided.purpose;
      item.primitiveRef = decided.presence === "STATIC" ? null : (intent.primitiveRef || item.primitiveRef);
      if (intent.timingPresetRef) item.timingPresetRef = intent.timingPresetRef;
      if (intent.params) item.params = intent.params;
      item.reason = intent.reason || decided.reason;
      break;
    }
    default:
      return { ok: false, code: "PATCH_INVALID", message: patch.op };
  }
  working.appliedPatchIds = [...(working.appliedPatchIds || []), patch.patchId];
  working.revision += 1;
  const qa = validateMotionPlan(working, context);
  working.qaStatus = qa.status;
  working.qa = { status: qa.status, findings: qa.findings };
  return { ok: true, plan: working, applied: { patchId: patch.patchId, op: patch.op }, qa };
}

/** Motion-only change dirties motion branches; audio/alignment/captions stay clean (§33). */
function resolveMotionInvalidation() {
  return {
    motionPlanBranchDirty: true,
    affectedSceneRenderBranchDirty: true,
    motionQABranchDirty: true,
    finalAudioClean: true,
    alignmentClean: true,
    captionsClean: true,
    sourceMediaClean: true,
  };
}

// ---------- persistence (§31, via workspace governance) ----------

function workspaceLib(root) {
  return require("../workspace/index.js");
}

function persistMotionPlan(root, projectId, plan, opts = {}) {
  const ws = workspaceLib(root);
  const resolved = ws.resolveArtifactPath(root, projectId, "TIMELINE", "DURABLE", { fileName: "motion-plan.json" });
  if (!resolved.ok) return resolved;
  const guard = ws.validateWorkspacePath(root, resolved.path, { projectId });
  if (!guard.ok) return guard;
  fs.mkdirSync(path.dirname(resolved.path), { recursive: true });
  if (opts.expectedRevision !== undefined && fs.existsSync(resolved.path)) {
    try {
      const prev = JSON.parse(fs.readFileSync(resolved.path, "utf8"));
      if (prev.revision !== opts.expectedRevision) {
        return { ok: false, code: "PATCH_CONFLICT", message: `stale persist: disk revision ${prev.revision} ≠ expected ${opts.expectedRevision}` };
      }
    } catch (e) {
      return { ok: false, code: "REGISTRY_INVALID", message: `unreadable existing motion plan: ${String((e && e.message) || e)}` };
    }
  }
  const tmp = `${resolved.path}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(plan, null, 2), "utf8");
  fs.renameSync(tmp, resolved.path);
  return { ok: true, path: resolved.path };
}

function loadMotionPlan(root, projectId) {
  const ws = workspaceLib(root);
  const resolved = ws.resolveArtifactPath(root, projectId, "TIMELINE", "DURABLE", { fileName: "motion-plan.json" });
  if (!resolved.ok) return resolved;
  if (!fs.existsSync(resolved.path)) return { ok: false, code: "NOT_FOUND", message: "no persisted motion plan" };
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(resolved.path, "utf8"));
  } catch (e) {
    return { ok: false, code: "REGISTRY_INVALID", message: `unparseable motion plan: ${String((e && e.message) || e)}` };
  }
  const v = validatePlanShape(raw);
  if (!v.ok) return { ok: false, code: "SCHEMA_INVALID", message: v.errors[0], errors: v.errors };
  return { ok: true, plan: raw, path: resolved.path };
}

function persistTimelineSnapshot(root, projectId, manifest) {
  const ws = workspaceLib(root);
  const resolved = ws.resolveArtifactPath(root, projectId, "TIMELINE", "DURABLE", { fileName: "master-timeline.json" });
  if (!resolved.ok) return resolved;
  fs.mkdirSync(path.dirname(resolved.path), { recursive: true });
  const tmp = `${resolved.path}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2), "utf8");
  fs.renameSync(tmp, resolved.path);
  return { ok: true, path: resolved.path };
}

function validatePlanShape(plan) {
  const errors = [];
  if (!plan || typeof plan !== "object") return { ok: false, errors: ["plan must be an object"] };
  for (const k of ["version", "projectId", "timelineRevision", "items", "transitions", "coverage"]) {
    if (plan[k] === undefined) errors.push(`missing ${k}`);
  }
  if (!Array.isArray(plan.items)) errors.push("items must be an array");
  if (!Array.isArray(plan.transitions)) errors.push("transitions must be an array");
  return { ok: errors.length === 0, errors };
}

// ---------- agent-ready store (§34) ----------

function createMotionStore() {
  const byProject = new Map();
  return {
    buildMotionPlan(projectId, inputs, context) {
      const prev = byProject.get(projectId);
      const lockedByItem = {};
      if (prev) {
        for (const m of prev.plan.items) {
          if (m.locked) lockedByItem[m.timelineItemId] = m;
        }
      }
      const r = buildMotionPlan({ ...inputs, projectId });
      if (!r.ok) return r;
      // Locked motion survives unrelated reruns (§32, Case T).
      if (prev && context && context.timelineManifest) {
        for (const m of r.plan.items) {
          const locked = lockedByItem[m.timelineItemId];
          if (locked && locked.dependencyHashes.timelineRevision === m.dependencyHashes.timelineRevision) {
            const idx = r.plan.items.findIndex((x) => x.timelineItemId === m.timelineItemId);
            r.plan.items[idx] = { ...locked, frameRange: m.frameRange };
          }
        }
        const qa = validateMotionPlan(r.plan, context);
        r.plan.qaStatus = qa.status;
        r.plan.qa = { status: qa.status, findings: qa.findings };
        r.qa = qa;
      }
      byProject.set(projectId, { plan: r.plan });
      return r;
    },
    getMotionPlan(projectId) {
      const e = byProject.get(projectId);
      return e ? { ok: true, plan: e.plan } : { ok: false, code: "NOT_FOUND" };
    },
    validateMotionPlan(projectId, context) {
      const e = byProject.get(projectId);
      if (!e) return { ok: false, code: "NOT_FOUND" };
      return validateMotionPlan(e.plan, context || {});
    },
    patchMotion(projectId, patch, context) {
      const e = byProject.get(projectId);
      if (!e) return { ok: false, code: "NOT_FOUND" };
      const r = patchMotion(e.plan, patch, context || {});
      if (r.ok && !r.idempotent) byProject.set(projectId, { plan: r.plan });
      return r;
    },
    getMotionFindings(projectId) {
      const e = byProject.get(projectId);
      if (!e) return { ok: false, code: "NOT_FOUND" };
      const qa = e.plan.qa || { status: e.plan.qaStatus, findings: [] };
      return { ok: true, status: qa.status, findings: qa.findings || [] };
    },
  };
}

module.exports = {
  MOTION_PLAN_VERSION,
  PATCH_OPS,
  TRANSITION_ALIGNMENTS,
  TRANSITION_FALLBACKS,
  DEFAULT_PRIMITIVE_BY_TRACK,
  buildMotionPlan,
  validateMotionPlan,
  transitionWindow,
  repairMotionPlan,
  patchMotion,
  resolveMotionInvalidation,
  persistMotionPlan,
  loadMotionPlan,
  persistTimelineSnapshot,
  validatePlanShape,
  createMotionStore,
  motionSpan,
};
