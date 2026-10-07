"use strict";

/**
 * Phase 1G.12 — Cases B/C/D credit proposal (planning only, zero spend).
 * Closed loop per unit: 1G.5 decision → explicit production selection →
 * 1G.6 resolution (seed snapshot) → 1G.8 output plan → 1G.8 budget plan
 * (DRAFT). Prints the operator-facing authorization request. Nothing here
 * generates media, spends credits, or touches Flow UI.
 *
 * Usage: node scripts/cli/propose-case-bcd-budget.js
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const PID = "phase1g12-case-a";

const vm = require("../../lib/visual-motion/index.js");
const mreg = require("../../providers/model-registry/index.js");
const outputCost = require("../../lib/output-cost/index.js");

const HARD_BUDGET_LIMIT = 100;

function scene(id) {
  return {
    sceneId: id, order: 0, beatIds: [], storySectionRefs: [],
    narrativePurpose: "1G.12 validation: recurring-mascot synthetic scenario (FICTION)",
    visualObjective: "SHOW", subjectRefs: ["CH-VALID-MASCOT"], environmentRefs: [],
    continuityGroup: "cg-1g12", stateBefore: null, stateAfter: null,
  };
}

function shot(id, sceneId, extra) {
  return Object.assign({
    shotId: id, parentSceneId: sceneId, orderWithinScene: 0, beatIds: [],
    claimRefs: [], shotPurpose: "SHOW", visualObjective: "SHOW",
    subjectRefs: ["CH-VALID-MASCOT"], actionIntent: "waves", framingIntent: null,
    cameraIntent: null, continuityRefs: ["cg-1g12"], startState: null,
    endState: null, relativeWeight: 1,
  }, extra || {});
}

const REF_ASSETS = [{ assetId: "as-1186233d1af6", status: "APPROVED" }];
const RECURRING = [{ entityId: "CH-VALID-MASCOT", lockStrength: "STRICT", hasApprovedReference: true }];

function decideFor(unit) {
  const sc = scene(unit.sceneId);
  const sh = shot(unit.shotId, unit.sceneId, unit.shotExtra);
  const r = vm.decideShotProduction({
    projectId: PID, shot: sh, scene: sc, contentClass: "FICTION",
    platform: "youtube", signals: unit.signals, now: new Date().toISOString(),
    referenceAssets: REF_ASSETS,
  });
  if (!r.ok) throw new Error(`decision failed for ${unit.shotId}: ${r.code}`);
  const d = r.decision;
  // Explicit production selection (proposal-grade; live run re-confirms).
  const sel = vm.applyManualOverride({
    decision: d, selectedOutputType: "GENERATED_MOTION_RECOMMENDED",
    reason: `1G.12 proposal: explicit paid selection for ${unit.caseId}`,
    context: { referenceAssets: REF_ASSETS },
  });
  if (!sel.ok || sel.state === "BLOCKED") {
    throw new Error(`explicit selection blocked for ${unit.shotId}: ${(sel.blockers || []).join("; ")}`);
  }
  return sel.decision;
}

// Minimum-cost validation design (§13): fewest justified generations,
// shortest supported durations, landscape 16:9, outputCount 1.
const UNITS = [
  {
    caseId: "B", shotId: "B-SH01", sceneId: "B-SC01", durationSeconds: 4,
    signals: { visualType: "CHARACTER_SCENE", subjectMovement: true },
    shotExtra: { actionIntent: "waves at camera" },
  },
  {
    caseId: "C", shotId: "C-SH01", sceneId: "C-SC01", durationSeconds: 4,
    signals: { visualType: "CHARACTER_SCENE", subjectMovement: true },
    shotExtra: { actionIntent: "opens door", startState: "door-closed", endState: "door-open" },
  },
  {
    caseId: "D1", shotId: "D-SH01", sceneId: "D-SC01", durationSeconds: 8,
    signals: { visualType: "CHARACTER_SCENE", subjectMovement: true, recurringEntities: RECURRING },
    shotExtra: { actionIntent: "neutral presenter wave", framingIntent: "medium shot" },
  },
  {
    caseId: "D2", shotId: "D-SH02", sceneId: "D-SC01", durationSeconds: 8,
    signals: { visualType: "CHARACTER_SCENE", subjectMovement: true, recurringEntities: RECURRING },
    shotExtra: { actionIntent: "points to side diagram", framingIntent: "medium shot" },
  },
  {
    caseId: "D3", shotId: "D-SH03", sceneId: "D-SC01", durationSeconds: 8,
    signals: { visualType: "CHARACTER_SCENE", subjectMovement: true, recurringEntities: RECURRING },
    shotExtra: { actionIntent: "neutral presenter wave", framingIntent: "close-up" },
  },
];

function main() {
  const seed = mreg.loadSeedSnapshot();
  if (!seed.ok) throw new Error("seed snapshot invalid: " + seed.blockers.join("; "));
  const snapshot = seed.snapshot;

  const items = [];
  const resolutions = [];
  for (const u of UNITS) {
    const decision = decideFor(u);
    const res = mreg.resolveFromDecision(decision, {
      projectId: PID, durationSeconds: u.durationSeconds,
      orientation: "LANDSCAPE_OUTPUT", outputCount: 1, costSensitivity: "HIGH",
    }, { seed: true }, {}, {});
    if (!res.ok) throw new Error(`resolution failed for ${u.shotId}: ${res.code} ${res.message || ""}`);
    resolutions.push({
      shotId: u.shotId, caseId: u.caseId, status: res.status,
      resolutionId: res.artifact.resolutionId, renderMode: res.artifact.renderMode,
      recommendedModel: res.artifact.recommendedModel,
      costEstimate: res.artifact.costEstimate,
      selectionReasons: res.artifact.selectionReasons,
    });
    items.push({
      shotId: u.shotId, decision, outputCount: 1, durationSeconds: u.durationSeconds,
      orientation: "LANDSCAPE_OUTPUT", providerId: res.artifact.recommendedProvider || "google",
      resolution: {
        resolutionId: res.artifact.resolutionId,
        recommendedModel: res.artifact.recommendedModel,
        costEstimate: res.artifact.costEstimate,
      },
    });
    console.log(`[PROPOSE] ${u.caseId}/${u.shotId} decision=${decision.effectiveOutputType} renderMode=${res.artifact.renderMode} model=${res.artifact.recommendedModel} cost=${JSON.stringify(res.artifact.costEstimate)} status=${res.status}`);
  }

  const plan = outputCost.buildOutputPlan({
    projectId: PID, scopeId: "1g12-bcd", items, mreg, registrySnapshot: snapshot,
  });
  if (!plan.ok) throw new Error("output plan failed: " + plan.code);
  const p = plan.plan;
  console.log(`[PROPOSE] output plan ${p.outputPlanId}: units=${p.units.length} estimatedCredits=${JSON.stringify(p.summary.estimatedCredits)}`);
  for (const u of p.units) {
    console.log(`[PROPOSE]   unit ${u.unitId} shot=${u.sourceShotId} workflow=${u.workflow} model=${u.modelId} cost=${u.estimatedCreditState}:${u.estimatedCredits}`);
  }

  // Retry reserve = estimate-locked per unit (live re-resolution re-checks):
  // B 7 + C 7 + D 12×3 = 50 reserve; base exact 50; hard 100 covers all.
  const reserveByShot = { "B-SH01": 7, "C-SH01": 7, "D-SH01": 12, "D-SH02": 12, "D-SH03": 12 };
  const retryPolicies = {};
  for (const u of p.units) {
    retryPolicies[u.unitId] = {
      maxAdditionalAttempts: 1,
      reservedCredits: reserveByShot[u.sourceShotId] !== undefined ? reserveByShot[u.sourceShotId] : 12,
      allowedFailureClasses: ["QA_MOTION_DIRECTION", "QA_MOTION_ABSENT", "QA_CONTINUITY_OUTFIT", "QA_CONTINUITY_IDENTITY", "QA_LOCATION", "QA_START_END_STATE", "QA_FACTUAL_VISUAL", "QA_STRUCTURAL", "QA_SEMANTIC"],
    };
  }
  const bp = outputCost.buildBudgetPlan({
    projectId: PID, scopeId: "1g12-bcd",
    hardBudget: { unit: "CREDITS", limit: HARD_BUDGET_LIMIT, source: "operator-proposal (pending approval)" },
    outputPlan: p, retryPolicies, registrySnapshotRef: { snapshotId: snapshot.snapshotId },
  });
  if (!bp.ok) throw new Error("budget plan failed: " + bp.code);
  const saved = outputCost.persistBudgetPlan(ROOT, PID, bp.budgetPlan);
  if (!saved.ok) throw new Error("budget persist failed: " + saved.code);
  const out = {
    proposalId: bp.budgetPlan.budgetPlanId,
    hardBudget: bp.budgetPlan.hardBudget,
    estimateState: p.summary.estimatedCredits,
    units: p.units.map((u) => ({ unitId: u.unitId, shotId: u.sourceShotId, workflow: u.workflow, modelId: u.modelId, costState: u.estimatedCreditState, cost: u.estimatedCredits })),
    retryPolicies,
    resolutions,
    budgetPlanPath: saved.path,
    authorizationRequired: "OPERATOR_CREDIT_AUTHORIZATION = APPROVED before the first paid generation",
  };
  const abs = path.join(ROOT, "projects", PID, "budget", "case-bcd-proposal.json");
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(out, null, 2));
  console.log(`[PROPOSE] budget plan ${bp.budgetPlan.budgetPlanId} hardBudget=${HARD_BUDGET_LIMIT} state=${bp.budgetPlan.status} persisted: ${saved.path}`);
  console.log(`[PROPOSE] proposal: ${abs}`);
  console.log(`[PROPOSE] AUTHORIZATION REQUIRED: OPERATOR_CREDIT_AUTHORIZATION = APPROVED (hard budget ${HARD_BUDGET_LIMIT} CREDITS) before any paid generation.`);
}

main();
