"use strict";

/**
 * Phase 1G.12 — RealE2eCaseResult assembler + matrix evaluator (pure logic).
 * References canonical artifacts only (GenerationJob, AssetRecord, QA
 * result, budget/ledger); never duplicates them. No generation, no network.
 */

const shared = require("../output-cost/shared.js");

const CASE_IDS = ["A", "B", "C", "D"];
const MATRIX_IDS = ["A", "B", "C", "D", "R"];
const MATRIX_SIZES = { A: 9, B: 15, C: 14, D: 18, R: 8 };
const ITEM_STATES = ["PASS", "FAIL", "BLOCKED", "PENDING"];

function isRefArray(v) {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

// Canonical artifacts must stay referenced, never embedded.
const EMBEDDED_ARTIFACT_KEYS = [
  "assetRecord", "qaLayers", "budgetPlan", "ledger", "generationJob",
  "assetBytes", "qaResult", "flowCookies", "bridgeToken", "authHeader",
];

function buildCaseResult(input = {}) {
  const errors = [];
  if (!CASE_IDS.includes(input.caseId)) errors.push("CASE_ID_INVALID: A|B|C|D required");
  for (const f of ["projectId", "budgetPlanRef"]) {
    if (typeof input[f] !== "string" || !input[f]) errors.push(`FIELD_REQUIRED: ${f}`);
  }
  for (const f of ["shotIds", "generationUnitIds", "attemptIds", "assetIds", "qaResultIds", "evidenceRefs"]) {
    if (!isRefArray(input[f] || [])) errors.push(`REF_ARRAY_INVALID: ${f} must be string[]`);
    else if ((input[f] || []).length === 0 && ["assetIds", "qaResultIds"].includes(f) && input.status === "PASS") {
      errors.push(`REF_MISSING_FOR_PASS: ${f}`);
    }
  }
  for (const k of EMBEDDED_ARTIFACT_KEYS) {
    if (input[k] !== undefined && input[k] !== null) errors.push(`ARTIFACT_DUPLICATION: ${k} must be a ref, not embedded`);
  }
  const credits = input.credits || {};
  if (typeof credits.state !== "string" || !credits.state) errors.push("FIELD_REQUIRED: credits.state");
  if (errors.length > 0) return { ok: false, errors };
  const now = new Date().toISOString();
  return {
    ok: true,
    result: {
      version: "1.0.0",
      caseId: input.caseId,
      status: input.status || "PENDING",
      projectId: input.projectId,
      providerProjectRef: input.providerProjectRef || null,
      shotIds: input.shotIds || [],
      generationUnitIds: input.generationUnitIds || [],
      attemptIds: input.attemptIds || [],
      productionDecisionRefs: input.productionDecisionRefs || [],
      modelResolutionRefs: input.modelResolutionRefs || [],
      budgetPlanRef: input.budgetPlanRef,
      providerResultRefs: input.providerResultRefs || [],
      assetIds: input.assetIds || [],
      qaResultIds: input.qaResultIds || [],
      timelineEligibility: input.timelineEligibility || [],
      repairHistory: input.repairHistory || [],
      credits: {
        estimated: credits.estimated ?? null,
        reserved: credits.reserved ?? null,
        reconciled: credits.reconciled ?? null,
        state: credits.state,
      },
      evidenceRefs: input.evidenceRefs || [],
      caseResultId: shared.id12(`case-${String(input.caseId).toLowerCase()}`, {
        project: input.projectId, shots: input.shotIds || [], assets: input.assetIds || [],
      }),
      completedAt: input.completedAt || (input.status === "PASS" ? now : null),
    },
  };
}

/**
 * evaluateMatrix(matrixId, items: [{ id, state }]) →
 * { status: PASS|FAIL|BLOCKED|PENDING, failed[], blocked[], pending[] }.
 */
function evaluateMatrix(matrixId, items = []) {
  const expected = MATRIX_SIZES[matrixId];
  if (!expected) return { status: "BLOCKED", reasons: [`MATRIX_UNKNOWN: ${matrixId}`] };
  if (!Array.isArray(items) || items.length !== expected) {
    return { status: "BLOCKED", reasons: [`MATRIX_SHAPE: ${matrixId} needs ${expected} items, got ${(items || []).length}`] };
  }
  for (const it of items) {
    if (!it || !ITEM_STATES.includes(it.state)) {
      return { status: "BLOCKED", reasons: [`MATRIX_ITEM_STATE_INVALID: ${it && it.id}`] };
    }
  }
  const failed = items.filter((i) => i.state === "FAIL").map((i) => i.id);
  const blocked = items.filter((i) => i.state === "BLOCKED").map((i) => i.id);
  const pending = items.filter((i) => i.state === "PENDING").map((i) => i.id);
  if (blocked.length > 0) return { status: "BLOCKED", failed, blocked, pending };
  if (failed.length > 0) return { status: "FAIL", failed, blocked, pending };
  if (pending.length > 0) return { status: "PENDING", failed, blocked, pending };
  return { status: "PASS", failed, blocked, pending };
}

module.exports = { CASE_IDS, MATRIX_IDS, MATRIX_SIZES, buildCaseResult, evaluateMatrix };
