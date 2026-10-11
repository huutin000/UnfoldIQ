"use strict";

/**
 * Hybrid Visual Routing (Phase 7 policy, GAP-052/053): an independent
 * VisualSource x MotionEngine decision per shot, layered on top of the 1G.5
 * decision engine (decision.js stays the cost ladder; this adds the source
 * axis, credit accounting and block rules). Pure and deterministic: no
 * provider calls, no prices, no generation. Flow/Veo are capabilities, not
 * hard-coded models; costs come from provider readback via input only.
 */

const shared = require("./shared.js");

const VISUAL_SOURCES = ["APPROVED_ASSET", "LICENSED_REAL_MEDIA", "PROCEDURAL_GRAPHICS", "FLOW_GENERATED_IMAGE", "VEO_GENERATED_VIDEO"];
const MOTION_ENGINES = ["STATIC_HOLD", "REMOTION_2D", "REMOTION_PARALLAX", "REMOTION_3D", "EXISTING_FOOTAGE", "VEO_IMAGE_TO_VIDEO", "VEO_TEXT_TO_VIDEO"];

/** Content that must stay deterministic: exact text, numbers, diagrams, maps. */
const EXACT_CONTENT = new Set(["DIAGRAM", "CHART", "TYPOGRAPHY", "TEXT_EVIDENCE", "MAP", "TIMELINE", "FORMULA"]);

/** Existing 1G.5 render modes mapped onto the new motion axis (no duplicate rule). */
const RENDER_MODE_TO_MOTION = {
  STATIC_IMAGE: "STATIC_HOLD",
  REMOTION_MOTION: "REMOTION_2D",
  VEO_FIRST_FRAME: "VEO_IMAGE_TO_VIDEO",
  VEO_FIRST_LAST: "VEO_IMAGE_TO_VIDEO",
  VEO_REFERENCE: "VEO_IMAGE_TO_VIDEO",
};

/**
 * Route one shot. Input fields (see policy section 8): projectId, beatId,
 * sceneId, shotId, shotIntent, contentMode, visualStyleTarget, targetRealism
 * (ABSTRACT|ILLUSTRATIVE|REALISTIC), realismRequired, motionRequirement
 * (NONE|CAMERA_ONLY|SEMANTIC_ACTION), requestedMotion?, availability
 * { approvedAssets[], licensedImages[], licensedFootage[], flowQuota:
 * { available:number|null, costPerGeneration:number|null }, depthLayers },
 * recurringEntities[{entityId, referenceIds[]}], rightsReviewStatus,
 * aiDisclosureReview, creditApproval, override { source, engine, reason }.
 */
function routeShot(input = {}) {
  const av = input.availability || {};
  const quota = av.flowQuota || {};
  const reasonCodes = [];
  const qualityRisks = [];
  const alternativeRoutes = [];
  const intent = input.motionRequirement || "CAMERA_ONLY";
  const realism = input.targetRealism || "ABSTRACT";
  let source;
  let engine;
  let state = "PLANNED";
  let needsGeneration = false;

  const approved = (av.approvedAssets || []).length > 0;
  const licensedImg = (av.licensedImages || []).length > 0;
  const footage = (av.licensedFootage || []).length > 0;

  if (input.override) {
    if (!input.override.reason) return blocked(input, "BLOCKED_INVALID_OVERRIDE", ["OVERRIDE_REASON_REQUIRED"]);
    if (!VISUAL_SOURCES.includes(input.override.source) || !MOTION_ENGINES.includes(input.override.engine)) {
      return blocked(input, "BLOCKED_INVALID_OVERRIDE", ["OVERRIDE_UNKNOWN_SOURCE_OR_ENGINE"]);
    }
    source = input.override.source;
    engine = input.override.engine;
    reasonCodes.push("OWNER_OVERRIDE");
  } else if (EXACT_CONTENT.has(input.contentMode)) {
    source = "PROCEDURAL_GRAPHICS";
    engine = intent === "NONE" ? "STATIC_HOLD" : "REMOTION_2D";
    reasonCodes.push("EXACT_TECHNICAL_EXPOSITION");
  } else if (intent === "SEMANTIC_ACTION") {
    reasonCodes.push("SEMANTIC_MOTION_REQUIRED");
    if (footage) {
      source = "LICENSED_REAL_MEDIA";
      engine = "EXISTING_FOOTAGE";
    } else {
      source = "FLOW_GENERATED_IMAGE";
      engine = "VEO_IMAGE_TO_VIDEO";
      needsGeneration = true;
      alternativeRoutes.push({ source: "LICENSED_REAL_MEDIA", engine: "EXISTING_FOOTAGE" });
    }
  } else if (realism === "ABSTRACT") {
    source = "PROCEDURAL_GRAPHICS";
    engine = intent === "NONE" ? "STATIC_HOLD" : "REMOTION_2D";
  } else {
    // Cinematic still: reuse before generate; never Veo for camera-only motion.
    if (approved) source = "APPROVED_ASSET";
    else if (licensedImg) source = "LICENSED_REAL_MEDIA";
    else {
      source = "FLOW_GENERATED_IMAGE";
      needsGeneration = true;
    }
    engine = intent === "NONE" ? "STATIC_HOLD" : "REMOTION_2D";
    reasonCodes.push("CINEMATIC_STILL");
    alternativeRoutes.push({ source: "PROCEDURAL_GRAPHICS", engine: "REMOTION_2D" });
  }

  // A flat still must not be sold as parallax/3D without real depth layers.
  if (input.requestedMotion === "REMOTION_PARALLAX" && engine === "REMOTION_2D") {
    if (av.depthLayers) {
      engine = "REMOTION_PARALLAX";
      reasonCodes.push("PARALLAX_WITH_DEPTH_LAYERS");
    } else {
      reasonCodes.push("FAKE_PARALLAX_REJECTED");
      qualityRisks.push("FLAT_STILL_NO_DEPTH");
    }
  }

  // Hard rule: realism required but only local vector possible and no Flow route.
  const generationBlocked = needsGeneration && (quota.available === null || quota.available === undefined || quota.available <= 0);
  if (input.realismRequired && (source === "PROCEDURAL_GRAPHICS" || generationBlocked) && realism !== "ABSTRACT") {
    return blocked(input, "BLOCKED_BY_VISUAL_INPUT_OR_QUOTA", ["REALISM_REQUIRED_NO_ADEQUATE_SOURCE"], { source, engine });
  }

  // Missing character/entity reference blocks generated visuals (ROUTE-08).
  const missingRef = (input.recurringEntities || []).filter((e) => !(e.referenceIds || []).length);
  if (needsGeneration && missingRef.length) {
    return blocked(input, "BLOCKED_MISSING_REFERENCE", missingRef.map((e) => `NO_REFERENCE:${e.entityId}`), { source, engine });
  }

  // Spend gate: unknown cost or no quota never starts a generation (ROUTE-05/06).
  let spendAllowed = false;
  let creditEstimate = needsGeneration ? (quota.costPerGeneration === undefined ? null : quota.costPerGeneration) : 0;
  if (needsGeneration) {
    if (creditEstimate === null) {
      reasonCodes.push("CREDIT_COST_UNKNOWN");
      state = "WAITING_ASSET";
    } else if (generationBlocked) {
      reasonCodes.push("NO_FLOW_QUOTA");
      state = "WAITING_ASSET";
    } else if (input.creditApproval !== "APPROVED") {
      reasonCodes.push("CREDIT_APPROVAL_PENDING");
      state = "WAITING_ASSET";
    } else {
      spendAllowed = true;
      state = "READY";
    }
  } else {
    state = "READY";
  }

  const rights = input.rightsReviewStatus || (source === "PROCEDURAL_GRAPHICS" ? "APPROVED" : "REVIEW_REQUIRED");
  const disclosure = input.aiDisclosureReview || (source === "PROCEDURAL_GRAPHICS" ? "NOT_REQUIRED" : "REVIEW_REQUIRED");

  const decision = {
    projectId: input.projectId || null,
    beatId: input.beatId || null,
    sceneId: input.sceneId || null,
    shotId: input.shotId || null,
    shotIntent: input.shotIntent || null,
    contentMode: input.contentMode || null,
    visualStyleTarget: input.visualStyleTarget || null,
    targetRealism: realism,
    motionRequirement: intent,
    visualSource: source,
    motionEngine: engine,
    assetRefs: [...(av.approvedAssets || [])],
    alternativeRoutes,
    reasonCodes,
    qualityRisks,
    rightsReviewStatus: rights,
    aiDisclosureReview: disclosure,
    creditEstimate,
    creditApproval: needsGeneration ? (input.creditApproval || "PENDING_OWNER") : "NOT_REQUIRED",
    spendAllowed,
    finalApprovalBlocked: rights !== "APPROVED" && source !== "PROCEDURAL_GRAPHICS" ? true : disclosure === "REVIEW_REQUIRED" && source !== "PROCEDURAL_GRAPHICS",
    state,
  };
  decision.fingerprint = shared.hash16({ source, engine, intent, realism, mode: input.contentMode, refs: decision.assetRefs });
  return decision;
}

function blocked(input, status, reasons, route = {}) {
  return {
    projectId: input.projectId || null,
    sceneId: input.sceneId || null,
    shotId: input.shotId || null,
    visualSource: route.source || null,
    motionEngine: route.engine || null,
    state: "BLOCKED",
    status,
    reasonCodes: reasons,
    spendAllowed: false,
  };
}

/** A decision may reuse its locked asset only when the fingerprint is unchanged (ROUTE-09). */
function reuseLocked(decision, locked) {
  if (locked && locked.assetHash && locked.fingerprint === decision.fingerprint) {
    return { ...decision, state: "LOCKED", assetRefs: [locked.assetHash], reuse: true };
  }
  return { ...decision, reuse: false };
}

/** Which dependency branches a decision change dirties (ROUTE-10). */
function dirtyScope(prev, next) {
  const dirty = new Set();
  if (prev.visualSource !== next.visualSource || prev.targetRealism !== next.targetRealism) dirty.add("VISUAL_ASSET");
  if (prev.motionEngine !== next.motionEngine) dirty.add(next.motionEngine.startsWith("VEO") ? "VEO_CLIP" : "MOTION");
  if (prev.shotIntent !== next.shotIntent) {
    dirty.add("VISUAL_ASSET");
    dirty.add("MOTION");
  }
  return [...dirty].sort();
}

/**
 * Flow credit ledger (GAP-053). Idempotent per correlation id, so a provider
 * timeout/reconnect cannot spend twice (ROUTE-16); bounded retries (ROUTE-07);
 * unknown cost or cap overrun is refused, never guessed.
 */
function createCreditLedger({ cap, maxRetriesPerShot = 1 } = {}) {
  if (!Number.isFinite(cap) || cap < 0) throw new Error("LEDGER_CAP_REQUIRED");
  const jobs = new Map();
  const attempts = new Map();
  const spent = () => [...jobs.values()].reduce((s, j) => s + j.cost, 0);
  return {
    reserve({ correlationId, shotId, cost, balanceBefore = null }) {
      if (!correlationId) return { ok: false, code: "CORRELATION_ID_REQUIRED" };
      if (jobs.has(correlationId)) return { ok: true, duplicate: true, spent: spent() };
      if (!Number.isFinite(cost) || cost < 0) return { ok: false, code: "CREDIT_COST_UNKNOWN" };
      const n = (attempts.get(shotId) || 0) + 1;
      if (n > 1 + maxRetriesPerShot) return { ok: false, code: "RETRY_LIMIT" };
      if (spent() + cost > cap) return { ok: false, code: "OWNER_REVIEW_REQUIRED", projected: spent() + cost, cap };
      attempts.set(shotId, n);
      jobs.set(correlationId, { shotId, cost, balanceBefore, balanceAfter: null });
      return { ok: true, duplicate: false, spent: spent() };
    },
    settle(correlationId, balanceAfter) {
      const j = jobs.get(correlationId);
      if (!j) return false;
      j.balanceAfter = balanceAfter;
      return true;
    },
    spent,
    jobs: () => [...jobs.entries()].map(([id, j]) => ({ correlationId: id, ...j })),
  };
}

/** Generated assets need a hash + lineage before they can be QA_PASS/LOCKED (ROUTE-17). */
function validateLineage(asset = {}) {
  const missing = ["assetHash", "producer", "promptVersion", "generationJobId"].filter((k) => !asset[k]);
  return { ok: missing.length === 0, missing };
}

/** Veo native audio must not silently enter the mix (ROUTE-12). */
function audioConflict(clip = {}) {
  if (!clip.hasNativeAudio) return { conflict: false, action: "NONE" };
  return { conflict: true, action: "MUTE_OR_ROUTE_THROUGH_AUDIO_QA" };
}

/** Flag runs of identical treatment longer than maxRun (ROUTE-15). */
function treatmentRepetition(decisions, maxRun = 3) {
  const flags = [];
  let run = 1;
  for (let i = 1; i <= decisions.length; i += 1) {
    const a = decisions[i - 1];
    const b = decisions[i];
    const same = b && a.visualSource === b.visualSource && a.motionEngine === b.motionEngine && a.primitive === b.primitive;
    if (same) run += 1;
    else {
      if (run > maxRun) flags.push({ from: decisions[i - run].shotId, to: a.shotId, run });
      run = 1;
    }
  }
  return flags;
}

module.exports = { VISUAL_SOURCES, MOTION_ENGINES, RENDER_MODE_TO_MOTION, routeShot, reuseLocked, dirtyScope, createCreditLedger, validateLineage, audioConflict, treatmentRepetition };
