"use strict";

/**
 * Plan-level production decisions (1G.5 §18, §23-§25, §45-§50).
 *
 * Shot decision = executable unit. Scene recommendation = derived aggregate
 * (never silently overrides Shot decisions). Budget allocation downgrades the
 * lowest-value generated-motion Shots to EDITOR_MOTION with reasons — never
 * random drops. No fixed share, no invented credit limit.
 */

const shared = require("./shared.js");
const decisionLib = require("./decision.js");
const editorMotionLib = require("./editor-motion.js");

/** Explainable priority for retaining generated motion under a budget. */
function motionValueScore(decision, signals = {}) {
  let score = 0;
  if (decision.recommendedOutputType === "GENERATED_MOTION_RECOMMENDED") score += 4;
  else if (decision.recommendedOutputType === "GENERATED_MOTION_CANDIDATE") score += 1;
  if (decision.motionNeed === "HIGH") score += 3;
  else if (decision.motionNeed === "MEDIUM") score += 1;
  if (signals.essentialToUnderstanding || signals.physicalInteraction
    || signals.temporalTransformation || signals.causeEffectOverTime) score += 3;
  if (signals.turningPoint) score += 2;
  if (signals.emotionalPayoff) score += 1;
  if (signals.importance === "HIGH") score += 2;
  else if (signals.importance === "MEDIUM") score += 1;
  if (decision.editorMotionViability && decision.editorMotionViability.editorAlternativeQuality === "POOR") score += 2;
  return score;
}

function applyBudget(decisions, signalsByShot, budget) {
  const warnings = [];
  if (!budget) return { decisions, warnings };
  const hasCap = budget.maxGeneratedMotionShots !== undefined
    || budget.maxGeneratedMotionShare !== undefined
    || budget.maxGeneratedMotionSeconds !== undefined;
  if (budget.costSensitivity === "HIGH" && !hasCap) {
    warnings.push("COST_SENSITIVITY_HIGH: operator prefers economy; candidates remain but are flagged for review (no invented cap applied)");
  }
  if (!hasCap) return { decisions, warnings };

  const isGenerated = (d) => d.recommendedOutputType === "GENERATED_MOTION_CANDIDATE"
    || d.recommendedOutputType === "GENERATED_MOTION_RECOMMENDED";
  let generated = decisions.filter((d) => d.status === "DECISION_READY" && isGenerated(d));
  let limit = generated.length;
  if (budget.maxGeneratedMotionShots !== undefined) limit = Math.min(limit, budget.maxGeneratedMotionShots);
  if (budget.maxGeneratedMotionShare !== undefined) {
    limit = Math.min(limit, Math.floor(decisions.length * budget.maxGeneratedMotionShare));
  }
  if (budget.maxGeneratedMotionSeconds !== undefined) {
    // No canonical per-shot seconds exist in 1G.5: honor the cap only via
    // shot counts when the caller also supplies per-shot seconds; otherwise
    // record that the seconds cap cannot be evaluated honestly.
    if (budget.perShotSeconds !== undefined) {
      const sorted = [...generated].sort((a, b) =>
        motionValueScore(b, signalsByShot[b.shotId]) - motionValueScore(a, signalsByShot[a.shotId]));
      let used = 0;
      const keep = new Set();
      for (const d of sorted) {
        if (used + budget.perShotSeconds <= budget.maxGeneratedMotionSeconds) {
          keep.add(d.shotId);
          used += budget.perShotSeconds;
        }
      }
      generated = generated.filter((d) => !keep.has(d.shotId));
      limit = generated.length === 0 ? decisions.length : 0; // remaining handled below
      if (generated.length === 0) return { decisions, warnings };
    } else {
      warnings.push("BUDGET_SECONDS_UNEVALUABLE: maxGeneratedMotionSeconds supplied without perShotSeconds; shot-count caps (if any) still apply");
    }
  }
  if (generated.length <= limit) return { decisions, warnings };

  const ranked = [...generated].sort((a, b) =>
    motionValueScore(b, signalsByShot[b.shotId]) - motionValueScore(a, signalsByShot[a.shotId]));
  const dropIds = new Set(ranked.slice(limit).map((d) => d.shotId));
  const out = decisions.map((d) => {
    if (!dropIds.has(d.shotId)) return d;
    const planBuilt = editorMotionLib.buildEditorMotionPlan({ shotId: d.shotId, visualType: d.visualType });
    const downgraded = {
      ...d,
      recommendedOutputType: "EDITOR_MOTION",
      effectiveOutputType: d.selectedOutputType || "EDITOR_MOTION",
      renderMode: "REMOTION_MOTION",
      renderModeReasons: ["renderMode = REMOTION_MOTION: budget-downgraded candidate honestly renders as deterministic editor motion"],
      editorMotionPlan: planBuilt.ok ? planBuilt.plan : d.editorMotionPlan,
      requiredCapabilities: ["IMAGE_GENERATION"],
      requiredAssetRoles: ["PRIMARY_IMAGE"],
      referenceStrategy: "NONE",
      costClass: "LOW",
      decisionReasons: [...d.decisionReasons, `budget downgrade: generated-motion cap reached; retained higher narrative-value motion first (value score ${motionValueScore(d, signalsByShot[d.shotId])}); editor motion is adequate here`],
      warnings: [...d.warnings, "BUDGET_DOWNGRADED_TO_EDITOR"],
      updatedAt: new Date().toISOString(),
    };
    downgraded.fingerprint = shared.hash16({ policy: shared.DECISION_POLICY_VERSION, budgetDowngrade: true, base: d.fingerprint });
    return downgraded;
  });
  warnings.push(`BUDGET_APPLIED: ${dropIds.size} lower-value generated-motion shot(s) downgraded to EDITOR_MOTION; highest narrative-value motion retained`);
  return { decisions: out, warnings };
}

function sceneSummaries(decisions, sceneGraph) {
  const byScene = new Map();
  for (const d of decisions) {
    if (!byScene.has(d.sceneId)) byScene.set(d.sceneId, []);
    byScene.get(d.sceneId).push(d);
  }
  const summaries = [];
  for (const [sceneId, list] of byScene) {
    const eff = list.map((d) => d.effectiveOutputType);
    const generated = eff.filter((e) => e === "GENERATED_MOTION_CANDIDATE" || e === "GENERATED_MOTION_RECOMMENDED").length;
    const editor = eff.filter((e) => e === "EDITOR_MOTION").length;
    const stat = eff.filter((e) => e === "STATIC_IMAGE").length;
    let summary = "mixed";
    if (generated > 0) summary = "generated-motion-present";
    else if (editor > 0 && stat === 0) summary = "editor-motion-heavy";
    else if (stat === list.length) summary = "all-static";
    else if (editor > 0) summary = "mixed";
    summaries.push({ sceneId, shotCount: list.length, staticCount: stat, editorCount: editor, generatedCount: generated, summary });
  }
  if (sceneGraph && Array.isArray(sceneGraph.scenes)) {
    for (const s of sceneGraph.scenes) {
      if (!byScene.has(s.sceneId)) {
        summaries.push({ sceneId: s.sceneId, shotCount: 0, staticCount: 0, editorCount: 0, generatedCount: 0, summary: "no-decisions" });
      }
    }
  }
  return summaries.sort((a, b) => (a.sceneId < b.sceneId ? -1 : 1));
}

/** Advisory anti-monotony warnings (never force expensive variation). */
function monotonyWarnings(decisions) {
  const warnings = [];
  const eff = decisions.map((d) => d.effectiveOutputType);
  let run = 1;
  for (let i = 1; i <= eff.length; i++) {
    if (eff[i] === eff[i - 1]) run++;
    else {
      if (eff[i - 1] === "STATIC_IMAGE" && run >= 4) {
        warnings.push(`ANTI_MONOTONY: ${run} consecutive STATIC_IMAGE shots — consider editor-motion variety where honest (advisory)`);
      }
      if ((eff[i - 1] === "GENERATED_MOTION_CANDIDATE" || eff[i - 1] === "GENERATED_MOTION_RECOMMENDED") && run >= 3) {
        warnings.push(`ANTI_MONOTONY: ${run} consecutive generated-motion shots — verify each carries unique narrative value (advisory)`);
      }
      run = 1;
    }
  }
  const techRuns = decisions.map((d) => (d.editorMotionPlan && d.editorMotionPlan.techniques[0]) || null);
  let tRun = 1;
  for (let i = 1; i <= techRuns.length; i++) {
    if (techRuns[i] && techRuns[i] === techRuns[i - 1]) tRun++;
    else {
      if (techRuns[i - 1] && tRun >= 3) {
        warnings.push(`ANTI_MONOTONY: editor technique ${techRuns[i - 1]} repeated ${tRun}× consecutively (advisory)`);
      }
      tRun = 1;
    }
  }
  // Anti-template grammar check (FIX 1 §23): repeated modality / renderer runs.
  const modalityRuns = decisions.map((d) => d.visualModality || null);
  let mRun = 1;
  for (let i = 1; i <= modalityRuns.length; i++) {
    if (modalityRuns[i] && modalityRuns[i] === modalityRuns[i - 1]) mRun++;
    else {
      if (modalityRuns[i - 1] && mRun >= 4) {
        warnings.push(`ANTI_TEMPLATE: modality ${modalityRuns[i - 1]} repeated ${mRun}× consecutively — verify each beat genuinely needs it (advisory)`);
      }
      mRun = 1;
    }
  }
  const modeRuns = decisions.map((d) => d.renderMode || null);
  let rRun = 1;
  for (let i = 1; i <= modeRuns.length; i++) {
    if (modeRuns[i] && modeRuns[i] === modeRuns[i - 1]) rRun++;
    else {
      if (modeRuns[i - 1] && rRun >= 4) {
        warnings.push(`ANTI_TEMPLATE: render mode ${modeRuns[i - 1]} repeated ${rRun}× consecutively — verify the choice is narrative, not mechanical (advisory)`);
      }
      rRun = 1;
    }
  }
  return warnings;
}

function projectSummary(decisions) {
  const count = (t) => decisions.filter((d) => d.effectiveOutputType === t).length;
  const generated = count("GENERATED_MOTION_CANDIDATE") + count("GENERATED_MOTION_RECOMMENDED");
  const techniqueDistribution = {};
  let startFrames = 0;
  let endFrames = 0;
  let imageAssets = 0;
  for (const d of decisions) {
    if (d.requiredAssetRoles.includes("PRIMARY_IMAGE") || d.requiredAssetRoles.includes("START_FRAME")) imageAssets++;
    if (d.requiredAssetRoles.includes("START_FRAME")) startFrames++;
    if (d.requiredAssetRoles.includes("END_FRAME")) endFrames++;
    if (d.editorMotionPlan) {
      for (const t of d.editorMotionPlan.techniques) techniqueDistribution[t] = (techniqueDistribution[t] || 0) + 1;
    }
  }
  return {
    totalShots: decisions.length,
    staticImageCount: count("STATIC_IMAGE"),
    editorMotionCount: count("EDITOR_MOTION"),
    generatedCandidateCount: count("GENERATED_MOTION_CANDIDATE"),
    generatedRecommendedCount: count("GENERATED_MOTION_RECOMMENDED"),
    reviewRequiredCount: decisions.filter((d) => d.status === "DECISION_REVIEW_REQUIRED").length,
    blockedCount: decisions.filter((d) => d.status.startsWith("BLOCKED")).length,
    generatedShare: decisions.length > 0 ? Number((generated / decisions.length).toFixed(4)) : 0,
    estimatedImageAssets: imageAssets,
    estimatedStartFrames: startFrames,
    estimatedEndFrames: endFrames,
    editorTechniqueDistribution: techniqueDistribution,
    externalCostEstimate: "UNKNOWN", // no runtime pricing source in 1G.5
  };
}

/**
 * Decide production strategy for a whole Shot Plan.
 * Input: { projectId, shotPlan, sceneGraph?, contentClass, platform?,
 *          signalProvider?(shot, scene) -> signals, signalsByShot?,
 *          budget?, creativeMemoryContext?, policyVersion?, now? }
 */
function decidePlanProduction(input = {}) {
  const t0 = Date.now();
  const warnings = [];
  const { shotPlan } = input;
  if (!shotPlan || !Array.isArray(shotPlan.shots) || shotPlan.shots.length === 0) {
    return { ok: false, code: "DECISION_PLAN_INVALID", message: "shotPlan with shots is required" };
  }
  const sceneById = new Map(((input.sceneGraph && input.sceneGraph.scenes) || []).map((s) => [s.sceneId, s]));
  const signalsByShot = input.signalsByShot || {};
  let decisions = [];
  for (const shot of shotPlan.shots) {
    const scene = sceneById.get(shot.parentSceneId) || { sceneId: shot.parentSceneId };
    const signals = typeof input.signalProvider === "function"
      ? (input.signalProvider(shot, scene) || {})
      : (signalsByShot[shot.shotId] || {});
    signalsByShot[shot.shotId] = signals;
    const r = decisionLib.decideShotProduction({
      projectId: input.projectId,
      shot,
      scene,
      beatMap: input.beatMap,
      contentClass: input.contentClass || shotPlan.contentClass,
      platform: input.platform !== undefined ? input.platform : (shotPlan.platform || null),
      signals,
      policyVersion: input.policyVersion,
      now: input.now,
    });
    if (!r.ok) return r;
    decisions.push(r.decision);
  }

  const budgeted = applyBudget(decisions, signalsByShot, input.budget);
  decisions = budgeted.decisions;
  warnings.push(...budgeted.warnings);

  // Creative Memory is advisory only: pattern warnings, never overrides.
  if (input.creativeMemoryContext && Array.isArray(input.creativeMemoryContext.avoidPatterns)) {
    warnings.push(...input.creativeMemoryContext.avoidPatterns.slice(0, 5).map((p) => `MEMORY_ADVISORY: ${p}`));
  }

  warnings.push(...monotonyWarnings(decisions));
  const summary = projectSummary(decisions);
  if (summary.generatedShare === 1 && summary.totalShots > 0) {
    warnings.push("OVERUSE_GUARD: 100% of shots route to generated motion — plausible only if every shot carries essential motion evidence; flagged for explicit review");
  }
  const scenes = sceneSummaries(decisions, input.sceneGraph);
  return {
    ok: true,
    projectId: input.projectId,
    decisions,
    scenes,
    summary,
    warnings,
    elapsedMs: Date.now() - t0,
  };
}

module.exports = { decidePlanProduction, motionValueScore, applyBudget, sceneSummaries, monotonyWarnings, projectSummary };
