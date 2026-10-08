"use strict";

/**
 * Phase 6A §38–§44 — Creative Repair Router (UNFOLDIQ CORE).
 *
 * Maps structured CreativeFindings to the OWNING subsystem, obeys the
 * existing Dependency DAG (no stale shortcut — RULE 16/17), prefers local
 * repair when quality-equivalent (RULE 18) but fixes the script when the
 * script is the root cause, reuses the Phase 5B incremental / Partial-QA
 * planners, and runs inside hard attempt/time/render/model/credit budgets
 * (RULE 19). It never generates whole-video variants (§44) and never spends
 * provider credits without an explicit budget.
 */

const { makeFinding, sha16, countBySeverity } = require("./contract.js");
const dagLib = require("../dependency-dag/index.js");
const incr = require("../incremental/index.js");
const partialQa = require("../render/partial-qa.js");
const timelineLib = require("../timeline/master-timeline.js");

const REPAIR_VERSION = "1.0.0";

// owner subsystem, relative cost rank (lower = cheaper/more local), DAG effect.
//   dag.mode FORWARD   : bump node of fromType then markDirty descendants
//   dag.mode NODES_ONLY: dirty only the listed node types (mix-only change)
const REPAIR_CLASSES = Object.freeze({
  OPENING_EDIT: { rank: 4, owner: "STORY_SCRIPT", op: "EDIT_OPENING", dag: { mode: "FORWARD", fromType: "FINAL_SPOKEN_SCRIPT" }, speechTiming: "CHANGES", local: false },
  SCRIPT_TRIM: { rank: 4, owner: "STORY_SCRIPT", op: "TRIM_SCRIPT_BEATS", dag: { mode: "FORWARD", fromType: "FINAL_SPOKEN_SCRIPT" }, speechTiming: "CHANGES", local: false },
  SCRIPT_REWRITE: { rank: 4, owner: "STORY_SCRIPT", op: "REWRITE_SCRIPT_BEATS", dag: { mode: "FORWARD", fromType: "FINAL_SPOKEN_SCRIPT" }, speechTiming: "CHANGES", local: false },
  BEAT_RETIME_OR_SPLIT: { rank: 2, owner: "MASTER_TIMELINE", op: "RETIME_ITEM", dag: { mode: "FORWARD", fromType: "VISUAL_TIMING" }, speechTiming: "PRESERVED", local: true },
  VISUAL_TIMING_PATCH: { rank: 1, owner: "MASTER_TIMELINE", op: "RETIME_ITEM", dag: { mode: "FORWARD", fromType: "VISUAL_TIMING" }, speechTiming: "PRESERVED", local: true },
  PACKAGING_REVISION: { rank: 2, owner: "PUBLISH_PACKAGE", op: "REVISE_PACKAGE", dag: { mode: "FORWARD", fromType: "PUBLISH_PACKAGE", optional: true }, speechTiming: "PRESERVED", local: true, noRender: true },
  MOTION_PATCH: { rank: 1, owner: "MOTION_PLAN", op: "patchMotion", dag: { mode: "FORWARD", fromType: "ANIMATION_TIMING" }, speechTiming: "PRESERVED", local: true },
  FRAMING_LAYOUT_PATCH: { rank: 1, owner: "LAYOUT_RESPONSIVE", op: "PATCH_LAYOUT", dag: { mode: "FORWARD", fromType: "VISUAL_TIMING" }, speechTiming: "PRESERVED", local: true },
  ASSET_MODALITY_REPLACE: { rank: 2, owner: "MASTER_TIMELINE", op: "REPLACE_ASSET", dag: { mode: "FORWARD", fromType: "GENERATED_ASSET", fallbackType: "VISUAL_TIMING" }, speechTiming: "PRESERVED", local: true, mayConsumeCredits: true },
  MUSIC_MIX_PATCH: { rank: 2, owner: "AUDIO_MIX", op: "PATCH_MIX_PLAN", dag: { mode: "NODES_ONLY", nodeTypes: ["RENDER"], fallbackFrom: "FINAL_AUDIO" }, speechTiming: "PRESERVED", local: true },
  CAPTION_MOTION_REDUCTION: { rank: 1, owner: "MOTION_PLAN", op: "patchMotion", dag: { mode: "FORWARD", fromType: "ANIMATION_TIMING" }, speechTiming: "PRESERVED", local: true },
  CHANNEL_DEDUP: { rank: 1, owner: "MASTER_TIMELINE", op: "PATCH_OVERLAY", dag: { mode: "FORWARD", fromType: "VISUAL_TIMING" }, speechTiming: "PRESERVED", local: true },
  COGNITIVE_LOAD_REDUCTION: { rank: 1, owner: "MOTION_PLAN", op: "patchMotion", dag: { mode: "FORWARD", fromType: "ANIMATION_TIMING" }, speechTiming: "PRESERVED", local: true },
  PAYOFF_EMPHASIS_PATCH: { rank: 1, owner: "MOTION_PLAN", op: "patchMotion", dag: { mode: "FORWARD", fromType: "ANIMATION_TIMING" }, speechTiming: "PRESERVED", local: true },
  TRANSITION_PATCH: { rank: 1, owner: "MOTION_PLAN", op: "patchMotion", dag: { mode: "FORWARD", fromType: "ANIMATION_TIMING" }, speechTiming: "PRESERVED", local: true },
  TECHNICAL_QC_ROUTE: { rank: 0, owner: "PHASE_4_QC", op: "ROUTE_TECHNICAL", dag: { mode: "NONE" }, speechTiming: "PRESERVED", local: true, routeOnly: true },
  REVIEW_ONLY: { rank: 99, owner: "HUMAN_OR_AGENT", op: "REVIEW", dag: { mode: "NONE" }, speechTiming: "PRESERVED", local: true, manual: true },
});

// Ordered alternatives per code (cheapest quality-equivalent first). Absent => [catalog repairClass].
const ALTERNATIVES = Object.freeze({
  BEAT_TOO_LONG: ["BEAT_RETIME_OR_SPLIT", "SCRIPT_TRIM"],
  DEAD_TIME_RISK: ["BEAT_RETIME_OR_SPLIT", "SCRIPT_TRIM"],
  HOOK_SETUP_TOO_LONG: ["BEAT_RETIME_OR_SPLIT", "OPENING_EDIT"],
  OPENING_TOO_SLOW: ["BEAT_RETIME_OR_SPLIT", "OPENING_EDIT"],
  PACKAGING_PROMISE_DELAYED: ["PACKAGING_REVISION", "OPENING_EDIT"],
  OPENING_PROMISE_WEAK: ["FRAMING_LAYOUT_PATCH", "OPENING_EDIT"],
  HOOK_PROMISE_DELAYED: ["PACKAGING_REVISION", "OPENING_EDIT"],
  VISUAL_TOO_REPETITIVE: ["VISUAL_TIMING_PATCH", "BEAT_RETIME_OR_SPLIT"],
  MODALITY_MONOTONY: ["ASSET_MODALITY_REPLACE"],
  AUDIO_VISUAL_ENERGY_MISMATCH: ["MOTION_PATCH", "MUSIC_MIX_PATCH"],
});

// reasonClass values where the SCRIPT is the root cause: never "fix" these locally.
const SCRIPT_ROOT_REASONS = new Set(["SEMANTIC_REPEAT", "NO_PROGRESS", "LOOP_NEVER_RESOLVED", "OPENING_DENSITY", "BRAND_PREAMBLE", "PACKAGING_ECHO", "VALUE_ABSENT", "NO_PROGRESS_BY_15S", "OUTRO_ENERGY_LOSS", "NO_ANTICIPATION", "EARLY_PAYOFF", "OPEN_LOOP_OVERLOAD", "SUBJECT_UNCLEAR"]);

const DEFAULT_BUDGETS = Object.freeze({ maxAttempts: 3, timeBudgetMs: 120000, maxLocalRenders: 4, maxFullRenders: 1, maxModelCalls: 60, providerCredits: 0, maxVariantsPerFinding: 2 });

function phase4Route(finding) {
  const ref = (finding.evidenceRefs || []).find((r) => r.startsWith("phase4:"));
  return ref ? ref.slice("phase4:".length) : null;
}

function candidatesFor(finding) {
  const alts = ALTERNATIVES[finding.code] || [finding.repairClass];
  let list = [...new Set([finding.repairClass, ...alts])].filter((c) => REPAIR_CLASSES[c]);
  if (ALTERNATIVES[finding.code]) list = alts.filter((c) => REPAIR_CLASSES[c]);
  if (SCRIPT_ROOT_REASONS.has(finding.reasonClass)) {
    const scriptOnly = list.filter((c) => REPAIR_CLASSES[c].owner === "STORY_SCRIPT");
    list = scriptOnly.length ? scriptOnly : ["SCRIPT_TRIM"];
  }
  return list.sort((a, b) => REPAIR_CLASSES[a].rank - REPAIR_CLASSES[b].rank);
}

function cluster(findings) {
  // union findings that share relatedFindingIds or the same chosen class + overlapping range
  const parent = new Map(findings.map((f) => [f.findingId, f.findingId]));
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (a, b) => { const ra = find(a); const rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  for (const f of findings) for (const r of f.relatedFindingIds || []) if (parent.has(r)) union(f.findingId, r);
  const groups = new Map();
  for (const f of findings) {
    const k = find(f.findingId);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(f);
  }
  return [...groups.values()];
}

/**
 * planCreativeRepair(findings, ctx?) -> CreativeRepairPlan
 * ctx: { inputFingerprint?, budgets?, packagingLocked?, allowProviderCredits? }
 */
function planCreativeRepair(findings, ctx = {}) {
  const budgets = { ...DEFAULT_BUDGETS, ...(ctx.budgets || {}) };
  const actionable = findings.filter((f) => f.status === "OPEN");
  const steps = [];
  const manual = [];
  const routedTechnical = [];
  const blocked = [];

  const work = [];
  for (const f of actionable) {
    if (f.repairClass === "TECHNICAL_QC_ROUTE") { routedTechnical.push({ findingId: f.findingId, phase4Code: phase4Route(f), reason: f.reason }); continue; }
    if (f.repairClass === "REVIEW_ONLY") { manual.push(f.findingId); continue; }
    work.push(f);
  }
  for (const grp of cluster(work)) {
    // choose the class that fixes the whole cluster at the lowest rank
    const per = grp.map((f) => candidatesFor(f));
    const pool = per.reduce((a, b) => a.filter((x) => b.includes(x)), per[0]);
    let chosen = (pool.length ? pool : per[0])[0];
    if (chosen === "PACKAGING_REVISION" && ctx.packagingLocked) chosen = per[0].find((c) => c !== "PACKAGING_REVISION") || chosen;
    const cls = REPAIR_CLASSES[chosen];
    const start = Math.min(...grp.map((f) => (f.startMs === undefined ? 0 : f.startMs)));
    const end = Math.max(...grp.map((f) => (f.endMs === undefined ? start : f.endMs)));
    const scriptRoot = grp.some((f) => SCRIPT_ROOT_REASONS.has(f.reasonClass));
    const step = {
      stepId: `rs-${sha16({ ids: grp.map((f) => f.findingId).sort(), chosen })}`,
      findingIds: grp.map((f) => f.findingId),
      findingCodes: [...new Set(grp.map((f) => f.code))],
      repairClass: chosen,
      owner: cls.owner,
      op: cls.op,
      alternatives: [...new Set(per.flat())].sort((a, b) => REPAIR_CLASSES[a].rank - REPAIR_CLASSES[b].rank),
      chosenBecause: scriptRoot ? "SCRIPT_IS_ROOT_CAUSE" : (pool.length > 1 || per[0].length > 1 ? "LOWEST_COST_QUALITY_EQUIVALENT" : "ONLY_CANDIDATE"),
      target: { startMs: start, endMs: end, beatIds: [...new Set(grp.map((f) => f.beatId).filter(Boolean))], sceneIds: [...new Set(grp.map((f) => f.sceneId).filter(Boolean))], shotIds: [...new Set(grp.map((f) => f.shotId).filter(Boolean))] },
      local: cls.local,
      speechTiming: cls.speechTiming,
      dag: cls.dag,
      needsRender: !cls.noRender,
      mayConsumeCredits: !!cls.mayConsumeCredits,
      expectedResolvedCodes: [...new Set(grp.map((f) => f.code))],
      correctiveActions: [...new Set(grp.map((f) => f.correctiveAction))],
    };
    if (step.mayConsumeCredits && !ctx.allowProviderCredits && budgets.providerCredits <= 0) {
      step.creditGate = "NO_CREDIT_BUDGET: only already-available assets may be used (Image/Remotion/chart)";
    }
    steps.push(step);
  }
  steps.sort((a, b) => REPAIR_CLASSES[a.repairClass].rank - REPAIR_CLASSES[b.repairClass].rank || a.target.startMs - b.target.startMs);

  const localRenders = steps.filter((s) => s.needsRender && s.local).length;
  const fullRenders = steps.filter((s) => s.needsRender && !s.local).length ? 1 : 0;
  const cost = { localRenders, fullRenders, modelCalls: 0, providerCredits: 0 };
  if (cost.localRenders > budgets.maxLocalRenders || cost.fullRenders > budgets.maxFullRenders) blocked.push("RENDER_BUDGET");
  const plan = {
    kind: "CREATIVE_REPAIR_PLAN",
    version: REPAIR_VERSION,
    planId: `crp-${sha16({ s: steps.map((s) => s.stepId), fp: ctx.inputFingerprint || null })}`,
    forInputFingerprint: ctx.inputFingerprint || null,
    budgets,
    steps,
    routedTechnical,
    manualReview: manual,
    blocked,
    costEstimate: cost,
    variantPolicy: { fullVideoVariants: 0, maxVariantsPerFinding: budgets.maxVariantsPerFinding },
    summary: { stepCount: steps.length, localSteps: steps.filter((s) => s.local).length, scriptSteps: steps.filter((s) => REPAIR_CLASSES[s.repairClass].owner === "STORY_SCRIPT").length },
  };
  return plan;
}

/** §44: small, local alternatives only. Throws on whole-video variant requests. */
function requestVariants(request = {}, budgets = DEFAULT_BUDGETS) {
  if (request.scope === "FULL_VIDEO" || request.fullVideo === true) {
    const e = new Error("VARIANT_EXPLOSION_BLOCKED: full-video variants belong to Phase 6B Style Bake-off");
    e.code = "VARIANT_EXPLOSION_BLOCKED";
    throw e;
  }
  const n = Number(request.count) || 1;
  if (n > (budgets.maxVariantsPerFinding || DEFAULT_BUDGETS.maxVariantsPerFinding)) {
    const e = new Error(`VARIANT_EXPLOSION_BLOCKED: ${n} variants exceed cap ${budgets.maxVariantsPerFinding}`);
    e.code = "VARIANT_EXPLOSION_BLOCKED";
    throw e;
  }
  return { ok: true, count: n, scope: request.scope || "LOCAL_SCENE" };
}

// ---- Dependency DAG invalidation -------------------------------------------------------------
function nodeKeyByType(dag, type) {
  const hit = Object.values(dag.nodes).find((n) => n.artifactType === type);
  return hit ? hit.artifactKey : null;
}

/**
 * Apply a step's invalidation to the persisted Dependency DAG.
 *  FORWARD    : version-bump the origin node, then markDirty its descendants.
 *  NODES_ONLY : dirty only the listed node types (mix-only change keeps speech
 *               timing, alignment, captions, timeline assembly CLEAN).
 */
function applyDagInvalidation(root, projectId, step, opts = {}) {
  const loaded = dagLib.loadDag(root, projectId);
  if (!loaded.ok) return loaded;
  const spec = step.dag;
  if (!spec || spec.mode === "NONE") return { ok: true, dirtied: [], blocked: [], origin: null, mode: "NONE" };
  const version = `creative-repair:${step.stepId}`;
  let mode = spec.mode;
  let fromType = spec.fromType;
  if (mode === "NODES_ONLY" && opts.audioHashes) {
    // Mix-only keeps speech timing valid; a timing change must cascade from FINAL_AUDIO.
    const inv = resolveAudioRepairInvalidation(opts.audioHashes);
    if (inv.dagMode === "FORWARD") { mode = "FORWARD"; fromType = spec.fallbackFrom; }
  }
  if (mode === "NODES_ONLY") {
    const dirtied = [];
    for (const type of spec.nodeTypes) {
      const key = nodeKeyByType(loaded.dag, type);
      if (!key) continue;
      const r = dagLib.setNodeState(root, projectId, key, "DIRTY", opts);
      if (!r.ok) return r;
      dirtied.push(key);
    }
    return { ok: true, mode: "NODES_ONLY", origin: null, dirtied: dirtied.sort(), blocked: [] };
  }
  let originKey = nodeKeyByType(loaded.dag, fromType);
  if (!originKey && spec.fallbackType) originKey = nodeKeyByType(loaded.dag, spec.fallbackType);
  if (!originKey) {
    if (spec.optional) return { ok: true, mode: "FORWARD", origin: null, dirtied: [], blocked: [], skipped: `no ${fromType} node` };
    return { ok: false, code: "DAG_NODE_NOT_FOUND", message: `no DAG node of type ${fromType}` };
  }
  const v = dagLib.setNodeVersion(root, projectId, originKey, version, opts);
  if (!v.ok) return v;
  const m = dagLib.markDirty(root, projectId, originKey, { reason: `creative repair ${step.repairClass} (${step.findingCodes.join(",")})` }, opts, opts.locksReader || null);
  if (!m.ok) return m;
  return { ok: true, mode: "FORWARD", origin: originKey, dirtied: m.dirtied || [], blocked: m.blocked || [] };
}

/** Mix-only vs speech-timing decision (reuses Phase 3A resolveTimelineInvalidation). */
function resolveAudioRepairInvalidation({ prevNarrationTimingHash, nextNarrationTimingHash, prevFinalMixHash, nextFinalMixHash }) {
  const inv = timelineLib.resolveTimelineInvalidation({ prevNarrationTimingHash, nextNarrationTimingHash, prevFinalMixHash, nextFinalMixHash });
  return { ...inv, dagMode: inv.mixOnlyChange ? "NODES_ONLY" : (inv.speechTimingDirty ? "FORWARD" : "NONE") };
}

// ---- incremental render / partial QA planning (Phase 5B) -------------------------------------
/**
 * planLocalRerender({ affectedSceneIds, sceneMap, sceneHashesPrev, sceneHashesCurr, totalFrames, prevFp, currFp, cacheLookup, keyForRange })
 * Returns the IncrementalRenderPlan + PartialQAPlan and the rendered-frame ratio.
 */
function planLocalRerender(args) {
  const { sceneMap, totalFrames, prevFp, currFp, sceneHashes, cacheLookup, keyForRange, knownKeys } = args;
  const diff = incr.diffDependencies(prevFp, currFp);
  const dirtySet = incr.buildDirtySet(diff, { totalFrames, sceneMap, sceneHashes });
  const plan = incr.planRender({ dirtySet, totalFrames, cacheLookup, keyForRange, knownKeys, planId: args.planId });
  const dirtyRanges = dirtySet.dirtyFrameRanges || [];
  const changedKeys = diff.changes.map((c) => c.dependencyId);
  let qaPlan = null;
  try { qaPlan = partialQa.planPartialQA({ dirtyRanges, changedKeys, totalFrames }); } catch (e) { qaPlan = { error: String(e.message || e) }; }
  const dirtyFrames = incr.mergeRanges(dirtyRanges).reduce((s, r) => s + (r.endFrameExclusive - r.startFrame), 0);
  return {
    diff, dirtySet, incrementalRenderPlan: plan, partialQAPlan: qaPlan,
    dirtyFrames, totalFrames, renderedFrameRatio: Number((dirtyFrames / totalFrames).toFixed(4)),
    fullRenderFallback: plan.fallback !== "NONE",
  };
}

// ---- bounded repair loop ---------------------------------------------------------------------
/**
 * runBoundedRepair({ state, analyze, apply, budgets, now? })
 *   analyze(state) -> { findings, input? }          (deterministic + reviewer as configured)
 *   apply(plan, state) -> { state, renders?, modelCalls?, credits? }   (owning-subsystem patch)
 * Stops on: no actionable P1/P2 left (CONVERGED) | budget exhausted or no
 * progress (REVIEW_REQUIRED). Never loops on "make it more engaging".
 */
function runBoundedRepair({ state, analyze, apply, budgets: b = {}, now = Date.now }) {
  const budgets = { ...DEFAULT_BUDGETS, ...b };
  const started = now();
  const attempts = [];
  let current = state;
  let renders = 0;
  let modelCalls = 0;
  let credits = 0;
  let lastSignature = null;
  let stalled = 0;
  let a = analyze(current);
  const before = { counts: countBySeverity(a.findings), findingIds: a.findings.filter((f) => f.status === "OPEN").map((f) => f.findingId) };
  let stopReason = null;
  for (let n = 1; n <= budgets.maxAttempts; n++) {
    const actionable = a.findings.filter((f) => f.status === "OPEN" && ["P0", "P1", "P2"].includes(f.severity) && !REPAIR_CLASSES[f.repairClass].manual && !REPAIR_CLASSES[f.repairClass].routeOnly);
    if (actionable.length === 0) { stopReason = "CONVERGED"; break; }
    if (now() - started > budgets.timeBudgetMs) { stopReason = "TIME_BUDGET"; break; }
    const plan = planCreativeRepair(a.findings, { budgets, inputFingerprint: a.input && a.input.inputFingerprint });
    if (plan.steps.length === 0 || plan.blocked.length > 0) { stopReason = plan.blocked[0] || "NO_REPAIR_STEPS"; break; }
    if (renders + plan.costEstimate.localRenders + plan.costEstimate.fullRenders > budgets.maxLocalRenders + budgets.maxFullRenders) { stopReason = "RENDER_BUDGET"; break; }
    if (plan.steps.some((s) => s.creditGate) && budgets.providerCredits <= 0 && plan.steps.every((s) => s.creditGate)) { stopReason = "CREDIT_BUDGET"; break; }
    const runnable = { ...plan, steps: plan.steps.filter((s) => !s.creditGate) };
    const res = apply(runnable, current) || {};
    current = res.state === undefined ? current : res.state;
    renders += Number(res.renders) || 0;
    modelCalls += Number(res.modelCalls) || 0;
    credits += Number(res.credits) || 0;
    if (modelCalls > budgets.maxModelCalls) { stopReason = "MODEL_BUDGET"; attempts.push({ attempt: n, planId: plan.planId, steps: plan.steps.map((s) => s.repairClass) }); break; }
    a = analyze(current);
    const counts = countBySeverity(a.findings);
    attempts.push({
      attempt: n, planId: plan.planId, steps: runnable.steps.map((s) => ({ stepId: s.stepId, repairClass: s.repairClass, local: s.local, codes: s.findingCodes })),
      after: { counts, openFindingIds: a.findings.filter((f) => f.status === "OPEN").map((f) => f.findingId) }, renders: Number(res.renders) || 0,
    });
    const sig = a.findings.filter((f) => f.status === "OPEN").map((f) => f.findingId).sort().join(",");
    stalled = sig === lastSignature ? stalled + 1 : 0;
    lastSignature = sig;
    if (stalled >= 1) { stopReason = "NO_PROGRESS"; break; }
    if (n === budgets.maxAttempts) stopReason = "ATTEMPTS_EXHAUSTED";
  }
  const remaining = a.findings.filter((f) => f.status === "OPEN" && ["P0", "P1", "P2"].includes(f.severity) && !REPAIR_CLASSES[f.repairClass].manual && !REPAIR_CLASSES[f.repairClass].routeOnly);
  const converged = stopReason === "CONVERGED" || remaining.length === 0;
  const findings = [...a.findings];
  if (!converged) {
    findings.push(makeFinding("CREATIVE_REPAIR_BUDGET_EXHAUSTED", {
      key: stopReason, status: "REVIEW_REQUIRED", relatedFindingIds: remaining.map((f) => f.findingId),
      reason: `automated creative repair stopped (${stopReason}) with ${remaining.length} actionable finding(s) still open — handed to REVIEW_REQUIRED, not retried indefinitely`,
      evidenceRefs: [`attempts:${attempts.length}`, `stop:${stopReason}`], correctiveAction: "REVIEW_ONLY:human/agent decides next step", confidence: "HIGH",
    }));
  }
  return {
    status: converged ? "CONVERGED" : "REVIEW_REQUIRED",
    stopReason: stopReason || (converged ? "CONVERGED" : "UNKNOWN"),
    attempts, before, after: { counts: countBySeverity(findings), openFindingIds: findings.filter((f) => f.status === "OPEN").map((f) => f.findingId) },
    budgetUse: { attempts: attempts.length, maxAttempts: budgets.maxAttempts, elapsedMs: now() - started, renders, modelCalls, providerCredits: credits },
    state: current, findings,
  };
}

module.exports = {
  REPAIR_VERSION, REPAIR_CLASSES, ALTERNATIVES, SCRIPT_ROOT_REASONS, DEFAULT_BUDGETS,
  candidatesFor, planCreativeRepair, requestVariants, applyDagInvalidation, resolveAudioRepairInvalidation,
  planLocalRerender, runBoundedRepair, phase4Route, nodeKeyByType,
};
