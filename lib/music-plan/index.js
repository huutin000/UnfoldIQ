"use strict";

/**
 * Phase 2.7-F/G/H — MusicPlan / cue selection / segment strategy /
 * ambience / SFX / semantic QA / lock (UNFOLDIQ CORE).
 *
 * Cue boundaries follow narrative intent, NOT 1:1 scene mapping. Agent
 * chooses intent + segment; the deterministic engine (Phase 2.8) executes
 * trim/loop/fade/duck. Rights are fail-closed: a cue referencing an asset
 * without APPROVED_FOR_PROJECT can never lock or reach Final Audio.
 */

const Ajv = require("ajv");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const SCHEMA_VERSION = "1.0.0";

const ERRORS = {
  PLAN_SCHEMA_INVALID: "music plan fails schema validation",
  PLAN_INPUT_INVALID: "music plan inputs missing/invalid",
  CUE_NOT_FOUND: "cueId does not exist in the plan",
  CUE_LOCK_BLOCKED: "cue cannot lock: unresolved QA failures or rights not APPROVED_FOR_PROJECT",
  CUE_ALREADY_LOCKED: "cue is locked; unlock first",
  ASSET_NOT_FOUND: "assetId does not exist in the library",
};

let _validator = null;
function validator() {
  if (!_validator) {
    const ajv = new Ajv({ allErrors: true, strict: false });
    const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "schemas", "music-plan.schema.json"), "utf8"));
    _validator = ajv.compile(schema);
  }
  return _validator;
}

function newId(prefix) {
  return `${prefix}-${crypto.randomBytes(4).toString("hex")}`;
}

// ---------- cue grouping (§3.9: narrative boundaries, not scene boundaries) ----------

/**
 * Group ordered intents into cues. A new cue starts when presence changes
 * (NONE→BED/FEATURED), when purpose changes across a segment boundary, or
 * when an intentional-silence gap splits the run.
 */
function groupCues(intents) {
  const groups = [];
  let current = null;
  for (const it of intents) {
    const startsNew =
      !current ||
      it.presence === "NONE" ||
      current.presence !== it.presence ||
      (it.purpose && current.purpose && it.purpose !== current.purpose);
    if (startsNew) {
      if (current && current.segments.length) groups.push(current);
      current = { presence: it.presence, purpose: it.purpose, segments: [] };
    }
    if (it.presence !== "NONE") current.segments.push(it);
  }
  if (current && current.segments.length) groups.push(current);
  return groups;
}

// ---------- source region selection (§3.10) ----------

/**
 * Best source region for a required duration from the analysis.
 * Scores candidate windows anchored at section boundaries + safe cut points:
 * mean |energy - targetEnergy| distance, preferring section-boundary anchors.
 */
function bestSourceRegion(analysis, durationMs, targetEnergy) {
  const duration = analysis.durationMs;
  if (duration <= 0) return { ok: false, reason: "empty analysis" };
  if (duration <= durationMs) {
    return { ok: false, reason: "TRACK_TOO_SHORT", duration };
  }
  const anchors = new Set([0]);
  for (const s of analysis.sections || []) anchors.add(s.startMs);
  for (const p of analysis.safeCutPointsMs || []) {
    if (p + durationMs <= duration) anchors.add(p);
  }
  const curve = analysis.energyCurve || [];
  const target = typeof targetEnergy === "number" ? targetEnergy : 0.5;
  let best = null;
  for (const start of [...anchors].sort((a, b) => a - b)) {
    if (start + durationMs > duration) continue;
    const inWindow = curve.filter((c) => c.timeMs >= start && c.timeMs < start + durationMs);
    if (!inWindow.length) continue;
    // Mean absolute deviation from the intent energy — a window mixing a
    // quiet intro with a loud body must not win by averaging out.
    const energyFit = 1 - (inWindow.reduce((s, c) => s + Math.abs(c.value - target), 0) / inWindow.length);
    const anchorBonus = (analysis.sections || []).some((s) => s.startMs === start) ? 0.15 : 0;
    const avoidIntroOutro = (analysis.sections || []).find((s) => s.startMs <= start && start < s.endMs);
    const penalty = avoidIntroOutro && (avoidIntroOutro.type === "INTRO" || avoidIntroOutro.type === "OUTRO") ? 0.2 : 0;
    const score = energyFit + anchorBonus - penalty;
    if (!best || score > best.score) {
      best = { score: Number(score.toFixed(4)), start, end: start + durationMs };
    }
  }
  if (!best) return { ok: false, reason: "NO_FITTING_REGION", duration };
  return { ok: true, sourceStartMs: best.start, sourceEndMs: best.end, score: best.score };
}

// ---------- loop strategy (§3.11) ----------

/**
 * Decision order: safe loop → alternate cue (caller-level) → silence/ambience
 * fallback → needs new segment. Never default copy-N-times; never time-stretch.
 */
function decideLoopStrategy(analysis, cueDurationMs) {
  if (analysis.durationMs >= cueDurationMs) {
    return { strategy: "SINGLE_PASS", repetitions: 0 };
  }
  const usable = (analysis.loopCandidates || []).find(
    (l) => l.confidence >= 0.6 && l.endMs - l.startMs >= 1000 && l.endMs - l.startMs <= analysis.durationMs
  );
  if (usable) {
    const loopLen = usable.endMs - usable.startMs;
    const repetitions = Math.ceil((cueDurationMs - analysis.durationMs) / loopLen);
    return {
      strategy: "LOOP",
      loopStartMs: usable.startMs,
      loopEndMs: usable.endMs,
      crossfadeMs: Math.min(400, Math.round(loopLen / 4)),
      repetitions,
      confidence: usable.confidence,
    };
  }
  // Coverable by silence/ambience → engine lets the remainder stay silent.
  if (analysis.durationMs >= cueDurationMs * 0.5) {
    return { strategy: "SILENCE_FALLBACK", repetitions: 0, confidence: 0.6 };
  }
  return { strategy: "NEEDS_NEW_SEGMENT", repetitions: 0 };
}

// ---------- plan building ----------

/**
 * Build the MusicPlan artifact.
 * inputs:
 *   intents       — ordered MusicIntent list (from lib/music-intent)
 *   segments      — [{segmentId, startMs, endMs}] measured segment timeline
 *   repoRoot      — library root (search + rights)
 *   analyses      — { [assetId]: analysis } (from lib/music-analysis)
 *   ambienceInputs— [{assetId, startMs, endMs, association?, layer?, fadeInMs?, fadeOutMs?, crossfadeTo?, continuity?}]
 *   sfxInputs     — [{kind, priority, assetId, timelineStartMs, durationMs, purpose?, duckMusic?}]
 *   targetPlatforms, commercialContext — usage-decision context
 */
function buildMusicPlan(inputs = {}) {
  const { projectId, intents, segments } = inputs;
  if (!projectId || !Array.isArray(intents) || !Array.isArray(segments)) {
    return { ok: false, code: "PLAN_INPUT_INVALID", message: ERRORS.PLAN_INPUT_INVALID };
  }
  const segById = new Map(segments.map((s) => [s.segmentId, s]));
  const cues = [];
  const acquisitionNeeds = [];

  for (const group of groupCues(intents)) {
    const segs = group.segments.map((it) => segById.get(it.segmentId)).filter(Boolean);
    if (!segs.length) continue;
    const timelineStartMs = Math.min(...segs.map((s) => s.startMs));
    const timelineEndMs = Math.max(...segs.map((s) => s.endMs));
    const cueDurationMs = timelineEndMs - timelineStartMs;
    const primary = group.segments[0];
    const cue = {
      cueId: newId("cue"),
      segmentIds: group.segments.map((it) => it.segmentId),
      role: group.presence,
      purpose: group.purpose || undefined,
      timelineStartMs,
      timelineEndMs,
      vocalPolicy: primary.vocalPolicy,
      mood: primary.mood,
      energy: primary.energy,
      tension: primary.tension,
      loopAllowed: true,
      locked: false,
      confidence: primary.confidence,
      reason: primary.reason,
    };
    // Track search + ranking over the approved library.
    const candidates = searchCandidates(inputs.repoRoot, {
      mood: primary.mood,
      energy: primary.energy,
      bpmRange: primary.bpmPreference,
      vocalPolicy: primary.vocalPolicy,
      durationMs: cueDurationMs,
    });
    const usageContext = {
      projectId,
      targetPlatforms: inputs.targetPlatforms || [],
      commercialContext: inputs.commercialContext || "STANDARD",
    };
    let assigned = false;
    for (const cand of candidates) {
      const analysis = (inputs.analyses || {})[cand.asset.assetId];
      if (!analysis) continue;
      const decision = decideUsageFor(inputs.repoRoot, cand.asset, usageContext);
      if (decision.decision !== "APPROVED_FOR_PROJECT") {
        cue.usageDecisionRef = `${cand.asset.assetId}:${decision.decision}`;
        continue;
      }
      const region = bestSourceRegion(analysis, cueDurationMs, primary.energy);
      if (!region.ok && region.reason === "TRACK_TOO_SHORT") {
        const loopPlan = decideLoopStrategy(analysis, cueDurationMs);
        if (loopPlan.strategy === "NEEDS_NEW_SEGMENT") continue;
        cue.assetId = cand.asset.assetId;
        cue.sourceStartMs = 0;
        cue.sourceEndMs = analysis.durationMs;
        cue.loopPlan = loopPlan;
      } else if (!region.ok) {
        continue;
      } else {
        cue.assetId = cand.asset.assetId;
        cue.sourceStartMs = region.sourceStartMs;
        cue.sourceEndMs = region.sourceEndMs;
        cue.loopPlan = { strategy: "SINGLE_PASS", repetitions: 0 };
      }
      cue.usageDecisionRef = `${cand.asset.assetId}:APPROVED_FOR_PROJECT`;
      assigned = true;
      break;
    }
    if (!assigned) {
      acquisitionNeeds.push({
        segmentIds: cue.segmentIds,
        narrativeRole: cue.purpose || cue.role,
        mood: primary.mood || [],
        energy: primary.energy,
        bpmRange: primary.bpmPreference,
        vocalPolicy: primary.vocalPolicy,
        targetCueDurationMs: cueDurationMs,
        reason: "no approved library asset fits this cue",
      });
      cue.reason = `${cue.reason}; no approved library asset fits — acquisition or replan required`;
    }
    cues.push(cue);
  }

  const intentionalSilence = intents
    .filter((it) => it.presence === "NONE" && it.intentionalSilence === true)
    .map((it) => {
      const s = segById.get(it.segmentId);
      return s ? { startMs: s.startMs, endMs: s.endMs, reason: it.reason } : null;
    })
    .filter(Boolean);

  const plan = {
    version: SCHEMA_VERSION,
    projectId,
    status: "PLANNED",
    intents: JSON.parse(JSON.stringify(intents)),
    cues,
    ambience: planAmbience(inputs, intentionalSilence),
    sfx: planSfx(inputs, cues),
    intentionalSilence,
    inputHashes: inputs.inputHashes || {},
    createdAt: new Date().toISOString(),
  };

  const valid = validator()(plan);
  return {
    ok: valid,
    code: valid ? "OK" : "PLAN_SCHEMA_INVALID",
    message: valid ? undefined : ajvText(validator().errors),
    plan,
    acquisitionNeeds,
  };
}

function searchCandidates(repoRoot, criteria) {
  if (!repoRoot) return [];
  const library = require("../music-library/index.js");
  return library.searchLibrary(repoRoot, criteria).map((c) => ({ asset: c.asset, score: c.score }));
}

function decideUsageFor(repoRoot, asset, ctx) {
  const library = require("../music-library/index.js");
  return library.decideUsage(asset.rights, {
    assetId: asset.assetId,
    projectId: ctx.projectId,
    targetPlatforms: ctx.targetPlatforms,
    commercialContext: ctx.commercialContext,
  });
}

// ---------- ambience / SFX planning (2.7-G) ----------

function planAmbience(inputs, intentionalSilence) {
  const out = [];
  for (const a of inputs.ambienceInputs || []) {
    out.push({
      cueId: newId("amb"),
      assetId: a.assetId,
      startMs: a.startMs,
      endMs: a.endMs,
      association: a.association,
      continuity: a.continuity || "CONTINUOUS",
      layer: a.layer || "BACKGROUND",
      fadeInMs: a.fadeInMs !== undefined ? a.fadeInMs : 800,
      fadeOutMs: a.fadeOutMs !== undefined ? a.fadeOutMs : 800,
      crossfadeTo: a.crossfadeTo,
      usageDecisionRef: a.usageDecisionRef,
      locked: false,
      reason: a.reason || `ambience for ${a.association || "scene"}`,
    });
  }
  return out;
}

function planSfx(inputs) {
  const out = [];
  for (const s of inputs.sfxInputs || []) {
    out.push({
      cueId: newId("sfx"),
      kind: s.kind,
      priority: s.priority || "SUPPORTING",
      assetId: s.assetId,
      timelineStartMs: s.timelineStartMs,
      durationMs: s.durationMs,
      duckMusic: s.duckMusic !== undefined ? s.duckMusic : s.priority === "FEATURED",
      purpose: s.purpose,
      usageDecisionRef: s.usageDecisionRef,
      locked: false,
      reason: s.reason || s.purpose || `${s.kind} event`,
    });
  }
  return out;
}

// ---------- semantic QA (2.7-H) ----------

/**
 * Pre-lock semantic QA. Returns findings with canonical failure codes and
 * corrective actions; a cue may lock only with zero FAIL findings.
 */
function semanticQA(plan, { repoRoot } = {}) {
  const findings = [];
  const library = repoRoot ? require("../music-library/index.js") : null;

  for (const cue of plan.cues) {
    if (cue.role !== "NONE" && !cue.purpose) {
      findings.push({ code: "MUSIC_NOT_NEEDED", cueId: cue.cueId, status: "FAIL", correctiveAction: "RETURN_2_7", reason: "cue without narrative purpose" });
    }
    if (!cue.assetId) {
      findings.push({ code: "MUSIC_NEEDED_BUT_MISSING", cueId: cue.cueId, status: "FAIL", correctiveAction: "REPLACE_TRACK", reason: "no approved asset assigned" });
      continue;
    }
    if (cue.vocalPolicy === "INSTRUMENTAL_ONLY" && library) {
      const rec = library.getAsset(repoRoot, cue.assetId);
      if (!rec) {
        findings.push({ code: "RIGHTS_NOT_APPROVED", cueId: cue.cueId, assetId: cue.assetId, status: "FAIL", correctiveAction: "REPLACE_ASSET", reason: "asset missing from library" });
      } else if (rec.vocalType === "LYRICAL_VOCAL") {
        findings.push({ code: "VOCAL_COMPETES_WITH_SPEECH", cueId: cue.cueId, assetId: cue.assetId, status: "FAIL", correctiveAction: "REPLACE_TRACK", reason: "lyrical vocal under instrumental-only policy" });
      }
    }
    const decisionRef = cue.usageDecisionRef || "";
    if (!decisionRef.endsWith(":APPROVED_FOR_PROJECT")) {
      findings.push({ code: "RIGHTS_NOT_APPROVED", cueId: cue.cueId, assetId: cue.assetId, status: "FAIL", correctiveAction: "REPLACE_ASSET", reason: `usage decision is ${decisionRef || "missing"}` });
    }
  }

  for (let i = 1; i < plan.cues.length; i += 1) {
    const prev = plan.cues[i - 1];
    const cur = plan.cues[i];
    if (prev.assetId && prev.assetId === cur.assetId &&
        prev.sourceStartMs === cur.sourceStartMs && prev.sourceEndMs === cur.sourceEndMs) {
      findings.push({ code: "BAD_CUE_TRANSITION", cueId: cur.cueId, status: "FAIL", correctiveAction: "REPLACE_TRACK", reason: "adjacent cues reuse identical source region — no narrative transition" });
    }
  }

  for (const amb of plan.ambience) {
    if (!amb.reason && !amb.association) {
      findings.push({ code: "AMBIENCE_CONTEXT_MISMATCH", cueId: amb.cueId, status: "FAIL", correctiveAction: "RETURN_2_7", reason: "ambience without environment association" });
    }
  }
  for (const s of plan.sfx) {
    if (!s.purpose) {
      findings.push({ code: "SFX_EVENT_MISMATCH", cueId: s.cueId, status: "FAIL", correctiveAction: "RETURN_2_7", reason: "purposeless SFX is filler" });
    }
  }

  const fail = findings.some((f) => f.status === "FAIL");
  return {
    ok: !fail,
    status: fail ? "QA_FAIL" : "QA_PASS",
    findings,
  };
}

// ---------- lock policy (§6) ----------

/** LOCK_CUE gate: semantic QA PASS + rights APPROVED_FOR_PROJECT. */
function lockCue(plan, cueId, { semanticResult } = {}) {
  const cue = plan.cues.find((c) => c.cueId === cueId);
  if (!cue) return { ok: false, code: "CUE_NOT_FOUND", message: ERRORS.CUE_NOT_FOUND };
  if (cue.locked) return { ok: false, code: "CUE_ALREADY_LOCKED", message: ERRORS.CUE_ALREADY_LOCKED };
  const qa = semanticResult || semanticQA(plan);
  const cueFails = qa.findings.filter((f) => f.cueId === cueId && f.status === "FAIL");
  if (cueFails.length || !cue.assetId || !(cue.usageDecisionRef || "").endsWith(":APPROVED_FOR_PROJECT")) {
    return { ok: false, code: "CUE_LOCK_BLOCKED", message: ERRORS.CUE_LOCK_BLOCKED, findings: cueFails };
  }
  cue.locked = true;
  cue.lockGate = { semanticQA: qa.status, rights: "APPROVED_FOR_PROJECT", lockedAt: new Date().toISOString() };
  return { ok: true, cue };
}

function unlockCue(plan, cueId) {
  const cue = plan.cues.find((c) => c.cueId === cueId);
  if (!cue) return { ok: false, code: "CUE_NOT_FOUND", message: ERRORS.CUE_NOT_FOUND };
  cue.locked = false;
  delete cue.lockGate;
  return { ok: true, cue };
}

/**
 * Idempotency (2.8-G): when re-planning, locked cues from the previous plan
 * survive if their identity inputs are unchanged (asset, source region,
 * timeline range, intent). Everything else is replanned fresh.
 */
function mergeLockedCues(newPlan, previousPlan) {
  if (!previousPlan) return { plan: newPlan, preserved: 0 };
  const key = (c) => JSON.stringify([c.segmentIds, c.assetId, c.sourceStartMs, c.sourceEndMs, c.timelineStartMs, c.timelineEndMs, c.role]);
  const prevLocked = new Map((previousPlan.cues || []).filter((c) => c.locked).map((c) => [key(c), c]));
  let preserved = 0;
  for (const cue of newPlan.cues) {
    const prev = prevLocked.get(key(cue));
    if (prev) {
      cue.locked = true;
      cue.lockGate = prev.lockGate;
      preserved += 1;
    }
  }
  return { plan: newPlan, preserved };
}

function ajvText(errors) {
  return (errors || []).map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ");
}

module.exports = {
  SCHEMA_VERSION,
  ERRORS,
  groupCues,
  bestSourceRegion,
  decideLoopStrategy,
  buildMusicPlan,
  semanticQA,
  lockCue,
  unlockCue,
  mergeLockedCues,
  validatePlan(plan) {
    const ok = validator()(plan);
    return { ok, errors: ok ? [] : ajvText(validator().errors) };
  },
};
