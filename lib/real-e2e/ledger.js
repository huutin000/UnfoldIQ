"use strict";

/**
 * Generation-cost ledger — single canonical owner for the 1G.12 ceremony
 * CLIs (hardening sweep A-1/A-2/A-3 + task §5.6).
 *
 * ONE format with lib/output-cost-compatible field names
 * (creditsObserved / status / entryId / observationId), entries keyed by
 * (attemptId, kind) so a reservation and its reconciliation are distinct
 * records and re-running a stage never double-counts.
 *
 * Evidence strength (task §5.6) is explicit per entry:
 *   LIVE_UI_OBSERVED | PROVIDER_BALANCE_OBSERVED |
 *   CANONICAL_COST_TABLE_RECONCILED | INFERRED_UPPER_BOUND | UNKNOWN
 * UNKNOWN never silently becomes zero: an UNRECONCILED entry contributes 0
 * observed credits and blocks further authorization through the
 * lib/output-cost unknown-spend gate.
 *
 * Reconciliation happens ONLY through reconcileEntry() — never by hand.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const artifactStore = require("../../providers/runtime/artifact-store.js");

const EVIDENCE_STRENGTH = {
  LIVE_UI_OBSERVED: "LIVE_UI_OBSERVED",
  PROVIDER_BALANCE_OBSERVED: "PROVIDER_BALANCE_OBSERVED",
  CANONICAL_COST_TABLE_RECONCILED: "CANONICAL_COST_TABLE_RECONCILED",
  INFERRED_UPPER_BOUND: "INFERRED_UPPER_BOUND",
  UNKNOWN: "UNKNOWN",
};

function ledgerRel() {
  return "budget/ledger.json";
}

/** v1 ceremony format → v2 (field renames + stale-header drop). */
function migrateV1(raw) {
  if (!raw || Array.isArray(raw) || raw.version === "2.0.0") return raw;
  const l = { version: "2.0.0", reconciliationState: "RECONCILED", entries: [], totals: { creditsObserved: 0, committed: 0, unknown: 0 } };
  for (const e of raw.entries || []) {
    l.entries.push({
      entryId: `le-${e.attemptId}-${e.kind || "generation"}`,
      attemptId: e.attemptId,
      kind: e.kind || "generation",
      unitId: e.unitId || null,
      reservedCredits: typeof e.reservedCredits === "number" ? e.reservedCredits : null,
      creditsObserved: typeof e.creditsObserved === "number" ? e.creditsObserved : (typeof e.observedCredits === "number" ? e.observedCredits : null),
      status: e.status || e.state || "UNRECONCILED",
      evidenceStrength: e.evidenceStrength || (typeof e.creditsObserved === "number" || typeof e.observedCredits === "number" ? EVIDENCE_STRENGTH.UNKNOWN : EVIDENCE_STRENGTH.UNKNOWN),
      reconciliationSource: e.reconciliationSource || e.note || null,
      reconciledAt: e.reconciledAt || null,
    });
  }
  return l;
}

function loadLedger(root, projectId) {
  const rel = ledgerRel();
  try {
    const raw = JSON.parse(artifactStore.readArtifact(root, projectId, rel));
    return migrateV1(raw);
  } catch {
    return { version: "2.0.0", reconciliationState: "RECONCILED", entries: [], totals: { creditsObserved: 0, committed: 0, unknown: 0 } };
  }
}

function recomputeTotals(l) {
  const entries = l.entries || [];
  const observed = entries.filter((e) => e.status === "RECONCILED" && typeof e.creditsObserved === "number");
  const unreservedUnknown = entries.filter((e) => e.status !== "RECONCILED" && (e.creditsObserved === null || e.creditsObserved === undefined) && !(e.reservedCredits > 0));
  l.totals = {
    creditsObserved: observed.reduce((s, e) => s + e.creditsObserved, 0),
    committed: entries.filter((e) => e.status !== "RECONCILED").reduce((s, e) => s + (e.reservedCredits || 0), 0),
    unknown: unreservedUnknown.length,
  };
  l.reconciliationState =
    l.totals.unknown > 0 || entries.some((e) => e.status !== "RECONCILED") ? "PARTIAL" : "RECONCILED";
  l.updatedAt = new Date().toISOString();
  return l;
}

function writeLedger(root, projectId, l) {
  recomputeTotals(l);
  artifactStore.writeArtifactAtomic(root, projectId, ledgerRel(), JSON.stringify(l, null, 2) + "\n");
  return l;
}

function appendLedger(root, projectId, entry) {
  const l = loadLedger(root, projectId);
  const kind = entry.kind || "generation";
  const full = {
    entryId: `le-${entry.attemptId}-${kind}`,
    observationId: null,
    attemptId: entry.attemptId,
    kind,
    unitId: entry.unitId || null,
    reservedCredits: typeof entry.reservedCredits === "number" ? entry.reservedCredits : null,
    creditsObserved: typeof entry.creditsObserved === "number" ? entry.creditsObserved : null,
    status: entry.status || "UNRECONCILED",
    evidenceStrength: entry.evidenceStrength || EVIDENCE_STRENGTH.UNKNOWN,
    reconciliationSource: entry.reconciliationSource || null,
    reconciledAt: entry.reconciledAt || null,
  };
  full.observationId = `obs-${crypto.createHash("sha256").update(full.entryId + JSON.stringify(full)).digest("hex").slice(0, 12)}`;
  const dup = (l.entries || []).find((e) => e.attemptId === full.attemptId && (e.kind || "generation") === kind);
  if (dup) {
    // Reconcile-in-place through code (never hand edits); a re-run of the
    // same stage never double-counts.
    if (full.status === "RECONCILED" && dup.status !== "RECONCILED") Object.assign(dup, full);
    else if (full.status !== "RECONCILED" && dup.status !== "RECONCILED") Object.assign(dup, full);
    return writeLedger(root, projectId, l);
  }
  l.entries.push(full);
  return writeLedger(root, projectId, l);
}

function reconcileEntry(root, projectId, attemptId, { credits, source, evidenceStrength }) {
  const l = loadLedger(root, projectId);
  const e = (l.entries || []).find((x) => x.attemptId === attemptId);
  if (!e) throw new Error(`LEDGER_ENTRY_NOT_FOUND: ${attemptId}`);
  e.status = "RECONCILED";
  e.creditsObserved = credits;
  e.reconciliationSource = source;
  e.evidenceStrength = evidenceStrength || EVIDENCE_STRENGTH.CANONICAL_COST_TABLE_RECONCILED;
  e.reconciledAt = new Date().toISOString();
  return writeLedger(root, projectId, l);
}

function ledgerTotals(root, projectId) {
  const l = loadLedger(root, projectId);
  recomputeTotals(l);
  return {
    creditsObserved: l.totals.creditsObserved,
    committed: l.totals.committed,
    unknown: l.totals.unknown,
    entries: l.entries,
    reconciliationState: l.reconciliationState,
  };
}

module.exports = { EVIDENCE_STRENGTH, loadLedger, appendLedger, reconcileEntry, ledgerTotals };
