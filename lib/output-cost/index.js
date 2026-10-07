"use strict";

/**
 * 1G.8 output/cost/credit planner facade (PHASE 1G.8, Prompt 01, §5).
 * Exposes: buildOutputPlan / buildBudgetPlan / estimateGenerationUnits /
 * estimateCredits / estimateGenerationTime / validateBudgetPlan /
 * authorizeGenerationAttempt / recordGenerationObservation / checkHardStop /
 * checkBudgetStaleness. Planning + accounting only — never executes
 * generation, never spends credits, never touches Flow UI.
 */

const shared = require("./shared.js");
const unitsLib = require("./units.js");
const budgetLib = require("./budget.js");
const validatorLib = require("./validator.js");
const storeLib = require("./store.js");

function estimateGenerationUnits(outputPlan) {
  if (!outputPlan || !Array.isArray(outputPlan.units)) {
    return { ok: false, code: "OUTPUT_PLAN_INVALID", message: "an output plan is required" };
  }
  return {
    ok: true,
    units: outputPlan.units,
    deduped: outputPlan.deduped || [],
    summary: {
      estimatedImages: outputPlan.summary.estimatedImages,
      estimatedVeoShots: outputPlan.summary.estimatedVeoShots,
      estimatedVariants: outputPlan.summary.estimatedVariants,
    },
  };
}

function estimateCredits(outputPlan) {
  if (!outputPlan || !outputPlan.summary || !outputPlan.summary.estimatedCredits) {
    return { ok: false, code: "OUTPUT_PLAN_INVALID", message: "an output plan with a credit summary is required" };
  }
  return { ok: true, estimate: outputPlan.summary.estimatedCredits };
}

function estimateGenerationTime(latencyEvidence) {
  return { ok: true, estimate: unitsLib.estimateGenerationTime(latencyEvidence) };
}

/** Hard-stop evaluation over ledger totals (planning decision, no execution). */
function checkHardStop(budgetPlan, ledger) {
  if (!budgetPlan || !budgetPlan.hardBudget) {
    return { state: "BLOCKED", reasons: ["HARD_BUDGET_REQUIRED"] };
  }
  const totals = (ledger && ledger.totals) || budgetLib.emptyTotals();
  const remaining = budgetLib.remainingBudget(budgetPlan.hardBudget, totals);
  if (remaining < 0) {
    return { state: "HARD_BUDGET_STOP", remaining, reasons: [`overspend: remaining ${remaining} < 0`] };
  }
  if (remaining === 0) {
    return { state: "HARD_BUDGET_STOP", remaining, reasons: ["budget exhausted: remaining 0"] };
  }
  return { state: "APPROVED", remaining, reasons: [`remaining budget ${remaining}`] };
}

module.exports = {
  OUTPUT_COST_VERSION: shared.OUTPUT_COST_VERSION,
  BUDGET_POLICY_VERSION: shared.BUDGET_POLICY_VERSION,
  SPECIAL_OUTPUT_ROLES: shared.SPECIAL_OUTPUT_ROLES,
  buildOutputPlan: unitsLib.buildOutputPlan,
  buildItemUnits: unitsLib.buildItemUnits,
  validateOutputCount: unitsLib.validateOutputCount,
  estimateGenerationUnits,
  estimateCredits,
  estimateGenerationTime: estimateGenerationTime,
  buildBudgetPlan: budgetLib.buildBudgetPlan,
  authorizeGenerationAttempt: budgetLib.authorizeGenerationAttempt,
  authorizeRetry: budgetLib.authorizeRetry,
  recordGenerationObservation: budgetLib.recordGenerationObservation,
  newLedger: budgetLib.newLedger,
  checkHardStop,
  checkBudgetStaleness: budgetLib.checkBudgetStaleness,
  validateBudgetPlan: validatorLib.validateBudgetPlan,
  validateLedger: validatorLib.validateLedger,
  persistBudgetPlan: storeLib.persistBudgetPlan,
  loadBudgetPlan: storeLib.loadBudgetPlan,
  persistLedger: storeLib.persistLedger,
  loadLedger: storeLib.loadLedger,
  shared,
};
