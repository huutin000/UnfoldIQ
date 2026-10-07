"use strict";

/**
 * Phase 1G.12 — targeted repair scoping (pure logic, no generation).
 * Maps one 1G.11 QA result onto exactly the affected generation unit:
 * one bad shot retries ONLY that unit, never the whole sequence.
 * Budget enforcement stays in 1G.8 (authorizeRetry); this module only scopes.
 */

const outputCost = require("../output-cost/index.js");

function failureClassFor(layerName, reasons) {
  const text = `${layerName}: ${(reasons || []).join(" ")}`.toLowerCase();
  if (/motion-direction|direction/.test(text)) return "QA_MOTION_DIRECTION";
  if (/motion-occurs|zero-motion|absent/.test(text)) return "QA_MOTION_ABSENT";
  if (/outfit|clothing/.test(text)) return "QA_CONTINUITY_OUTFIT";
  if (/wrong_character|identity/.test(text)) return "QA_CONTINUITY_IDENTITY";
  if (/location/.test(text)) return "QA_LOCATION";
  if (/start[\s_-]?state|end[\s_-]?state|opening|ending/.test(text)) return "QA_START_END_STATE";
  if (/chart|species|factual|numbers|timeline order/.test(text)) return "QA_FACTUAL_VISUAL";
  if (/corrupt|decode|duration|aspect|dimensions|file-type|media-type|freeze|truncat/.test(text)) return "QA_STRUCTURAL";
  if (/scene|subject|action|composition|text/.test(text)) return "QA_SEMANTIC";
  return "QA_UNKNOWN";
}

/**
 * scopeRetry({ caseId, qaResult, generationUnits[] })
 * qaResult: AssetQaResult (1G.11). generationUnits: [{ unitId, shotId,
 *   assetIds[] }]. Returns the minimal retry scope. Never mutates inputs.
 */
function scopeRetry(input = {}) {
  const units = Array.isArray(input.generationUnits) ? input.generationUnits : [];
  const qr = input.qaResult || {};
  const agg = qr.aggregate || {};
  const failedLayers = Array.isArray(agg.failedLayers) ? agg.failedLayers : [];
  const reasons = Array.isArray(agg.reasons) ? agg.reasons : [];
  if (agg.status !== "REJECTED" && failedLayers.length === 0) {
    return { ok: false, code: "NO_FAILED_UNIT", message: "QA result carries no blocker FAIL; nothing to retry" };
  }
  // The affected unit is the one owning this shot/asset — exactly one.
  const matches = units.filter((u) => {
    if (!u || typeof u !== "object") return false;
    const shotHit = qr.shotId && u.shotId && String(u.shotId) === String(qr.shotId);
    const assetHit = qr.assetId && Array.isArray(u.assetIds) && u.assetIds.map(String).includes(String(qr.assetId));
    return shotHit || assetHit;
  });
  if (matches.length === 0) {
    return { ok: false, code: "UNIT_NOT_IDENTIFIED", message: "no generation unit owns this shot/asset; refusing blind retry" };
  }
  const affected = matches[0];
  const affectedId = affected.unitId;
  const failureClass = failureClassFor(failedLayers[0] || "unknown", reasons);
  return {
    ok: true,
    caseId: input.caseId || null,
    affectedUnitIds: [affectedId],
    unaffectedUnitIds: units.map((u) => u.unitId).filter((id) => id !== affectedId),
    failedShotIds: qr.shotId ? [qr.shotId] : [],
    failedAssetIds: qr.assetId ? [qr.assetId] : [],
    failureClass,
    recommendation: agg.recommendation || "REGENERATE_SHOT",
    // Repair preserves history: retry references the prior attempt and must
    // mint a NEW asset; the failed bytes stay historical.
    priorRefs: { qaResultId: qr.qaResultId || null },
    newAssetRequired: true,
  };
}

/**
 * authorizeScopedRetry({ budgetPlan, ledger, scope, unitGroup, priorAttemptId,
 *   attemptIndex, cost }) → 1G.8 verdict for the single affected unit.
 */
function authorizeScopedRetry(input = {}) {
  const scope = input.scope;
  if (!scope || !scope.ok || scope.affectedUnitIds.length !== 1) {
    return { state: "BLOCKED", reasons: ["RETRY_SCOPE_INVALID: exactly one affected unit required"] };
  }
  return outputCost.authorizeRetry({
    budgetPlan: input.budgetPlan,
    ledger: input.ledger,
    unitGroup: input.unitGroup || scope.affectedUnitIds[0],
    failureClass: scope.failureClass,
    priorAttemptId: input.priorAttemptId,
    attemptIndex: input.attemptIndex,
    cost: input.cost,
  });
}

module.exports = { scopeRetry, authorizeScopedRetry, failureClassFor };
