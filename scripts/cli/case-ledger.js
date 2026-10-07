#!/usr/bin/env node
"use strict";

/**
 * Phase 1G.12 hardening (Task 02: A-1, A-2, A-3, §5.6) — ONE canonical owner
 * for the ceremony cost ledger (projects/<pid>/budget/ledger.json).
 *
 * A-1: single field format. Writers use canonical names
 *      { creditsObserved, reservedCredits, status }; readers still accept the
 *      legacy Task-01 names { observedCredits, state } (never silently).
 * A-2: the header is always recomputed from entries on write; hand edits are
 *      detected by `validate` (stale-header problem) and fixed only through
 *      the explicit `reconcile` subcommand, which preserves the previous
 *      header as previousHeader (auditable migration, never silent).
 * A-3: entries are keyed by (attemptId, kind) so a retry reservation and its
 *      later reconciliation coexist — a retry can no longer silently drop the
 *      reservation on attemptId collision.
 * §5.6: every reconciliation carries evidenceStrength in
 *      LIVE_UI_OBSERVED | PROVIDER_BALANCE_OBSERVED |
 *      CANONICAL_COST_TABLE_RECONCILED | INFERRED_UPPER_BOUND | UNKNOWN.
 *      UNKNOWN strength must never accompany a numeric observed cost, and a
 *      RECONCILED entry must never carry a null observed cost (UNKNOWN never
 *      silently becomes zero).
 *
 * Zero paid generation. No provider calls. Planning/accounting only.
 */

const fs = require("fs");
const path = require("path");

const LEDGER_REL = "budget/ledger.json";

const EVIDENCE_STRENGTH = [
  "LIVE_UI_OBSERVED",
  "PROVIDER_BALANCE_OBSERVED",
  "CANONICAL_COST_TABLE_RECONCILED",
  "INFERRED_UPPER_BOUND",
  "UNKNOWN",
];

function ledgerPath(PROJ) {
  return path.join(PROJ, LEDGER_REL);
}

function readLedger(PROJ) {
  const p = ledgerPath(PROJ);
  if (!fs.existsSync(p)) return { creditsObserved: 0, committed: 0, entries: [] };
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

// Canonical view of one entry; accepts legacy Task-01 field names.
function normalizeEntry(e = {}) {
  const observed = e.creditsObserved !== undefined ? e.creditsObserved : e.observedCredits;
  const status = e.status || e.state || "UNKNOWN";
  return {
    attemptId: e.attemptId || null,
    kind: e.kind || (status === "RECONCILED" ? "reconciliation" : "reservation"),
    unitId: e.unitId || null,
    reservedCredits: typeof e.reservedCredits === "number" ? e.reservedCredits : 0,
    creditsObserved: typeof observed === "number" ? observed : null,
    status,
    evidenceStrength: e.evidenceStrength || "UNKNOWN",
    reconciliationSource: e.reconciliationSource || e.note || null,
  };
}

// Legacy header semantics, preserved exactly: observed sums RECONCILED
// entries; committed sums reserved credits of non-RECONCILED entries.
function computeTotals(entries) {
  const norm = (entries || []).map(normalizeEntry);
  return {
    creditsObserved: norm.filter((e) => e.status === "RECONCILED" && typeof e.creditsObserved === "number")
      .reduce((s, e) => s + e.creditsObserved, 0),
    committed: norm.filter((e) => e.status !== "RECONCILED")
      .reduce((s, e) => s + (e.reservedCredits || 0), 0),
  };
}

function entryKey(e) {
  const n = normalizeEntry(e);
  return `${n.attemptId}::${n.kind}`;
}

function validateEntry(entry) {
  const n = normalizeEntry(entry);
  if (!n.attemptId) return { ok: false, code: "LEDGER_ENTRY_IDENTITY_REQUIRED", message: "attemptId is required" };
  if (n.kind === "reconciliation" && typeof n.creditsObserved !== "number") {
    return { ok: false, code: "LEDGER_UNKNOWN_AS_ZERO", message: `reconciliation for ${n.attemptId} carries no numeric observed cost — UNKNOWN must never silently become zero` };
  }
  if (typeof n.creditsObserved === "number" && n.evidenceStrength === "UNKNOWN") {
    return { ok: false, code: "LEDGER_STRENGTH_UNKNOWN", message: `numeric observed cost for ${n.attemptId} needs a non-UNKNOWN evidenceStrength (§5.6)` };
  }
  if (!EVIDENCE_STRENGTH.includes(entry.evidenceStrength || "UNKNOWN")) {
    return { ok: false, code: "LEDGER_STRENGTH_INVALID", message: `evidenceStrength must be ${EVIDENCE_STRENGTH.join("|")}` };
  }
  return { ok: true, normalized: n };
}

function writeAtomic(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + "\n");
  fs.renameSync(tmp, p);
}

// Append one entry; idempotent per (attemptId, kind).
function appendLedger(PROJ, entry) {
  const v = validateEntry(entry);
  if (!v.ok) return v;
  const ledger = readLedger(PROJ);
  ledger.entries = Array.isArray(ledger.entries) ? ledger.entries : [];
  if (ledger.entries.some((e) => entryKey(e) === entryKey(entry))) {
    return { ok: true, deduped: true, ledger };
  }
  ledger.entries.push({
    attemptId: entry.attemptId,
    kind: v.normalized.kind,
    unitId: entry.unitId || null,
    reservedCredits: v.normalized.reservedCredits,
    creditsObserved: v.normalized.creditsObserved,
    // Canonical names first; legacy mirrors kept for Task-01 readers.
    observedCredits: v.normalized.creditsObserved,
    status: v.normalized.status,
    state: v.normalized.status,
    evidenceStrength: entry.evidenceStrength || "UNKNOWN",
    reconciledAt: entry.reconciledAt || null,
    reconciliationSource: v.normalized.reconciliationSource,
    note: entry.note || null,
  });
  const t = computeTotals(ledger.entries);
  ledger.creditsObserved = t.creditsObserved;
  ledger.committed = t.committed;
  writeAtomic(ledgerPath(PROJ), ledger);
  return { ok: true, deduped: false, ledger };
}

function validateLedger(ledger) {
  const problems = [];
  const entries = (ledger && ledger.entries) || [];
  const t = computeTotals(entries);
  if (ledger.creditsObserved !== t.creditsObserved || ledger.committed !== t.committed) {
    problems.push(`STALE_HEADER: header {${ledger.creditsObserved},${ledger.committed}} != recomputed {${t.creditsObserved},${t.committed}}`);
  }
  for (const e of entries) {
    const v = validateEntry(e);
    if (!v.ok) problems.push(`${v.code}: ${v.message}`);
  }
  return { ok: problems.length === 0, problems, computed: t };
}

// Explicit migration for A-2: recompute the header, preserve the old one.
// annotations: { "<attemptId>::<kind>" or attemptId: evidenceStrength }.
function reconcileHeader(PROJ, opts = {}) {
  const p = ledgerPath(PROJ);
  const ledger = readLedger(PROJ);
  const before = { creditsObserved: ledger.creditsObserved, committed: ledger.committed };
  const annotations = opts.annotations || {};
  for (const e of ledger.entries || []) {
    const k = entryKey(e);
    const strength = annotations[k] || annotations[normalizeEntry(e).attemptId];
    if (strength) {
      if (!EVIDENCE_STRENGTH.includes(strength) || strength === "UNKNOWN") {
        return { ok: false, code: "LEDGER_STRENGTH_INVALID", message: `annotation for ${k} must be non-UNKNOWN` };
      }
      e.evidenceStrength = strength;
      if (e.kind === undefined) e.kind = normalizeEntry(e).kind;
      if (e.creditsObserved === undefined && typeof e.observedCredits === "number") e.creditsObserved = e.observedCredits;
      if (e.status === undefined && e.state) e.status = e.state;
    }
  }
  const t = computeTotals(ledger.entries);
  const changed = ledger.creditsObserved !== t.creditsObserved || ledger.committed !== t.committed;
  if (changed) {
    ledger.previousHeader = { ...before, supersededAt: new Date().toISOString(), reason: opts.reason || "Task-02 hardening reconcile: header recomputed from entries (A-2)" };
  }
  ledger.creditsObserved = t.creditsObserved;
  ledger.committed = t.committed;
  const v = validateLedger(ledger);
  if (!v.ok) return { ok: false, code: "LEDGER_STILL_INVALID", problems: v.problems, before };
  writeAtomic(p, ledger);
  return { ok: true, before, after: { creditsObserved: t.creditsObserved, committed: t.committed }, headerChanged: changed, ledger };
}

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
}

if (require.main === module) {
  const ROOT = path.join(__dirname, "..", "..");
  const cmd = process.argv[2];
  const pid = arg("--project", "phase1g12-case-a");
  const PROJ = path.join(ROOT, "projects", pid);
  if (cmd === "validate") {
    const v = validateLedger(readLedger(PROJ));
    console.log(JSON.stringify(v, null, 2));
    process.exit(v.ok ? 0 : 1);
  } else if (cmd === "reconcile") {
    const annPath = arg("--annotate", null);
    const annotations = annPath ? JSON.parse(fs.readFileSync(annPath, "utf8")) : {};
    const r = reconcileHeader(PROJ, { annotations, reason: arg("--reason", undefined) });
    console.log(JSON.stringify(r.before !== undefined ? { ok: r.ok, before: r.before, after: r.after, headerChanged: r.headerChanged, problems: r.problems } : r, null, 2));
    process.exit(r.ok ? 0 : 2);
  } else {
    console.error("usage: case-ledger.js validate|reconcile --project <pid> [--annotate <json>]");
    process.exit(2);
  }
}

module.exports = {
  LEDGER_REL, EVIDENCE_STRENGTH,
  readLedger, normalizeEntry, computeTotals, entryKey,
  validateEntry, appendLedger, validateLedger, reconcileHeader,
};
