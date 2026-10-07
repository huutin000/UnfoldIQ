"use strict";

/**
 * 1G.8 persistence (PHASE 1G.8, Prompt 01, §§42, 61).
 * Layout (artifact-store conventions, atomic tmp+rename):
 *   projects/<projectId>/budget-plans/<scopeId>.json
 *   projects/<projectId>/cost-ledgers/<scopeId>.json
 * Round-trip stable; observation application idempotent (attemptId +
 * observationId dedupe); manual budget changes create new fingerprints via
 * supersedes links rather than mutating history.
 */

const fs = require("fs");
const path = require("path");
const artifactStore = require("../../providers/runtime/artifact-store.js");

function planRel(scopeId) {
  return `budget-plans/${scopeId}.json`;
}

function ledgerRel(scopeId) {
  return `cost-ledgers/${scopeId}.json`;
}

function persistBudgetPlan(root, projectId, plan, opts = {}) {
  if (!plan || !plan.budgetPlanId || !plan.scopeId) {
    return { ok: false, code: "BUDGET_PLAN_INVALID" };
  }
  try {
    const rel = planRel(plan.scopeId);
    const toSave = { ...plan, updatedAt: new Date().toISOString() };
    delete toSave._force;
    artifactStore.writeArtifactAtomic(root, projectId, rel, JSON.stringify(toSave, null, 2));
    return { ok: true, path: `projects/${projectId}/${rel}` };
  } catch (e) {
    return { ok: false, code: "BUDGET_PLAN_PERSIST_FAILED", message: String((e && e.message) || e) };
  }
}

function loadBudgetPlan(root, projectId, scopeId) {
  try {
    const rel = planRel(scopeId);
    if (!artifactStore.artifactExists(root, projectId, rel)) return { ok: true, plan: null };
    return { ok: true, plan: JSON.parse(artifactStore.readArtifact(root, projectId, rel).toString("utf8")) };
  } catch (e) {
    return { ok: false, code: "BUDGET_PLAN_LOAD_FAILED", message: String((e && e.message) || e) };
  }
}

function persistLedger(root, projectId, scopeId, ledger) {
  if (!ledger || !ledger.ledgerId) {
    return { ok: false, code: "LEDGER_INVALID" };
  }
  try {
    const rel = ledgerRel(scopeId);
    const toSave = { ...ledger, updatedAt: new Date().toISOString() };
    artifactStore.writeArtifactAtomic(root, projectId, rel, JSON.stringify(toSave, null, 2));
    return { ok: true, path: `projects/${projectId}/${rel}` };
  } catch (e) {
    return { ok: false, code: "LEDGER_PERSIST_FAILED", message: String((e && e.message) || e) };
  }
}

function loadLedger(root, projectId, scopeId) {
  try {
    const rel = ledgerRel(scopeId);
    if (!artifactStore.artifactExists(root, projectId, rel)) return { ok: true, ledger: null };
    return { ok: true, ledger: JSON.parse(artifactStore.readArtifact(root, projectId, rel).toString("utf8")) };
  } catch (e) {
    return { ok: false, code: "LEDGER_LOAD_FAILED", message: String((e && e.message) || e) };
  }
}

function listScopes(root, projectId, kind) {
  const base = path.join(root, "projects", projectId, kind === "ledger" ? "cost-ledgers" : "budget-plans");
  if (!fs.existsSync(base)) return { ok: true, scopes: [] };
  return { ok: true, scopes: fs.readdirSync(base).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)) };
}

module.exports = {
  persistBudgetPlan,
  loadBudgetPlan,
  persistLedger,
  loadLedger,
  listScopes,
};
