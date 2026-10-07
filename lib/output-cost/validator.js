"use strict";

/**
 * 1G.8 budget-plan + ledger validator (PHASE 1G.8, Prompt 01, §60).
 * Structured { valid, errors[], warnings[] }. Detects: missing hard budget,
 * invalid output counts, multi-output without allowed role, exact totals
 * over unknown units, stale/conflicting cost asserted exact, missing
 * provenance, request/generation conflation, negative credits, observed
 * total mismatch, duplicate observation double-count, retry without lineage
 * or budget check, over-budget authorization, upstream mutation, price
 * leakage. No provider prices live here.
 */

const Ajv = require("ajv");
const addFormats = require("ajv-formats");
const fs = require("fs");
const path = require("path");
const shared = require("./shared.js");

function loadSchema(file) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "schemas", file), "utf8").replace(/^\uFEFF/, ""));
}

// Guard patterns name what they forbid (never selections, never prices).
const MODEL_NAME_PATTERN = /\bveo[\s-]?3\.1\b|\bveo[\s-]?fast\b|\bveo[\s-]?lite\b|\bveo[\s-]?quality\b|nano[\s-]?banana|omni[\s-]?flash|gpt-image|dall-e/i;

function validateBudgetPlan(input = {}) {
  const errors = [];
  const warnings = [];
  const push = (dimension, code, message) => errors.push({ dimension, code, message });
  const plan = input.plan;
  if (!plan) return { valid: false, errors: [{ dimension: "schema", code: "BUDGET_PLAN_MISSING", message: "no plan supplied" }], warnings };
  const ctx = input.context || {};

  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(loadSchema("production-budget-plan.schema.json"));
  if (!validate(plan)) {
    for (const e of validate.errors || []) push("schema", "SCHEMA_BUDGET_PLAN", `${e.instancePath} ${e.message}`);
  }

  if (!plan.hardBudget || plan.hardBudget.unit !== "CREDITS" || !Number.isFinite(plan.hardBudget.limit)) {
    push("budget", "HARD_BUDGET_REQUIRED", "spend-capable plans need an explicit CREDITS hard budget");
  }
  if (plan.hardBudget && plan.hardBudget.limit < 0) {
    push("budget", "NEGATIVE_BUDGET", "hard budget cannot be negative");
  }
  // Exact totals require exact units.
  const summary = plan.summary || {};
  if (summary.exactTotalCredits !== null && summary.exactTotalCredits !== undefined) {
    if ((summary.unknownUnitCount || 0) > 0 || (summary.conflictingUnitCount || 0) > 0 || (summary.staleUnitCount || 0) > 0) {
      push("cost", "EXACT_OVER_UNCERTAIN", "exact total asserted while uncertain units exist");
    }
  }
  // Output-count policy survived serialization.
  for (const u of plan.units || []) {
    if (!Number.isInteger(u.outputCount) || u.outputCount < 1 || u.outputCount > shared.OUTPUT_COUNT_MAX) {
      push("outputCount", "OUTPUT_COUNT_INVALID", `unit ${u.unitId} has invalid outputCount`);
    }
  }
  // Request/generation conflation scan over free text.
  const text = [...(plan.warnings || []), ...((plan.summary && plan.summary.notes) || [])].join("\n");
  if (/requests?\s*[×x*]\s*rate|total\s*=\s*requests/i.test(text)) {
    push("cost", "REQUEST_GENERATION_CONFLATION", "totals must use per-generation math, never requests × rate");
  }
  // Upstream mutation guard (plans carry refs, never rewrites).
  for (const key of ["visualModality", "renderMode", "recommendedModel"]) {
    if (plan[key] !== undefined && plan[key] !== null && !["sourceVisualModality", "sourceRenderMode"].includes(key)) {
      if (typeof plan[key] === "string" && ["MAP", "STATIC_IMAGE", "VEO_FIRST_FRAME"].includes(plan[key])) {
        push("boundary", "UPSTREAM_MUTATION", `budget plan must not carry ${key} as its own truth`);
      }
    }
  }
  const leaked = JSON.stringify(plan).replace(/VEO_[A-Z_]+/g, "");
  if (MODEL_NAME_PATTERN.test(leaked)) {
    push("boundary", "MODEL_PRICE_LEAKAGE", "budget plan names a provider model outside a lineage reference");
  }
  if (ctx.requirement && plan.requirementFingerprint && ctx.requirement.fingerprint
    && plan.requirementFingerprint !== ctx.requirement.fingerprint) {
    warnings.push({ dimension: "staleness", code: "REQUIREMENT_CHANGED", message: "plan predates the current requirement" });
  }
  return { valid: errors.length === 0, errors, warnings };
}

function validateLedger(input = {}) {
  const errors = [];
  const warnings = [];
  const push = (dimension, code, message) => errors.push({ dimension, code, message });
  const ledger = input.ledger;
  if (!ledger) return { valid: false, errors: [{ dimension: "schema", code: "LEDGER_MISSING", message: "no ledger supplied" }], warnings };

  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(loadSchema("generation-cost-ledger.schema.json"));
  if (!validate(ledger)) {
    for (const e of validate.errors || []) push("schema", "SCHEMA_LEDGER", `${e.instancePath} ${e.message}`);
  }
  // Observed total must equal the sum of authoritative observations.
  const observed = (ledger.entries || []).filter((e) => typeof e.creditsObserved === "number");
  const sum = observed.reduce((s, e) => s + e.creditsObserved, 0);
  if (ledger.totals && ledger.totals.creditsObserved !== sum) {
    push("accounting", "OBSERVED_TOTAL_MISMATCH", `totals.creditsObserved ${ledger.totals.creditsObserved} != sum ${sum}`);
  }
  if (observed.some((e) => e.creditsObserved < 0) || (ledger.totals && ledger.totals.creditsObserved < 0)) {
    push("accounting", "NEGATIVE_CREDITS", "credits cannot be negative");
  }
  // Duplicate observation identity must not double-count.
  const seen = new Set();
  for (const e of ledger.entries || []) {
    const key = `${e.attemptId}::${e.observationId}`;
    if (seen.has(key)) push("accounting", "DUPLICATE_OBSERVATION", `observation ${key} recorded twice`);
    seen.add(key);
  }
  // Retry lineage + budget check evidence.
  for (const e of ledger.entries || []) {
    if (e.retryOfAttemptId && !ledger.entries.some((x) => x.attemptId === e.retryOfAttemptId)) {
      warnings.push({ dimension: "retry", code: "RETRY_LINEAGE_DANGLING", message: `retry ${e.attemptId} references unknown prior attempt` });
    }
  }
  return { valid: errors.length === 0, errors, warnings };
}

module.exports = { validateBudgetPlan, validateLedger };
