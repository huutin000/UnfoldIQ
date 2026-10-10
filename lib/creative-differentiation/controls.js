"use strict";

/**
 * Phase 6B / 6.7 — optional Creator Controls (UNFOLDIQ CORE, headless, non-blocking V1).
 *
 * Implemented (cheap, safe, reuse existing contracts):
 *   - Director Prompt: versioned, bounded, owner-attributed creative intent. It can
 *     never override evidence, rights, safety, platform policy or technical QA.
 *   - Override ledger: append-only, hash-chained record of owner acceptances of
 *     P2/P3 SUBJECTIVE warnings, scoped to one video hash + rubric version (any
 *     content edit or rubric change silently retires the acceptance).
 * Deferred with reason (see index.CREATOR_CONTROL_STATUS): Performance Reference,
 * standalone Representative Preview, richer Channel Editorial Identity controls.
 */

const crypto = require("crypto");
const repair = require("../creative-retention/repair.js");
const { RUBRIC_VERSION } = require("./policy.js");
const { assertNoSecrets, assertSafeDoc } = require("./guard.js");

const DIRECTOR_PROMPT_MAX_CHARS = 2000;
const PRECEDENCE = Object.freeze(["EVIDENCE_FIDELITY", "RIGHTS_PROVENANCE", "SAFETY_SECURITY", "PLATFORM_POLICY", "TECHNICAL_QA", "OWNER_APPROVAL"]);
const NON_OVERRIDABLE = Object.freeze(["FACTUAL", "RIGHTS", "SECURITY", "SAFETY", "PLATFORM", "TECHNICAL_QA", "MISSING_ARTIFACT", "OWNER_APPROVAL"]);
const OVERRIDE_DIRECTIVE_RE = /\b(ignore|skip|bypass|disable|override|waive|turn off|don'?t (run|check))\b[^.!?\n]{0,40}\b(facts?|evidence|sources?|rights?|licen[cs]e|copyright|safety|qa|checks?|blockers?|polic(y|ies)|approval|fidelity)\b|\b(invent|fabricate|make up|fake)\b[^.!?\n]{0,30}\b(stat(istic)?s?|quotes?|sources?|citations?|evidence|facts?)\b/i;

const err = (code, msg) => Object.assign(new Error(`${code}: ${msg}`), { code });
const h = (v) => crypto.createHash("sha256").update(typeof v === "string" ? v : JSON.stringify(v), "utf8").digest("hex").slice(0, 16);

/**
 * Splits the prompt into sentences; sentences that try to override a blocker/evidence/rights/safety rule are
 * recorded as rejectedDirectives and never become effective.
 */
function createDirectorPrompt({ projectId, ownerId, scope, text, previous = null, now = () => new Date().toISOString() }) {
  if (!projectId || !ownerId) throw err("DIRECTOR_PROMPT_INVALID", "projectId and ownerId required");
  const body = String(text || "").trim();
  if (!body) throw err("DIRECTOR_PROMPT_INVALID", "text required");
  if (body.length > DIRECTOR_PROMPT_MAX_CHARS) throw err("DIRECTOR_PROMPT_TOO_LONG", `max ${DIRECTOR_PROMPT_MAX_CHARS} chars`);
  assertNoSecrets({ text: body });
  const sc = scope || { kind: "PROJECT" };
  if (!["PROJECT", "SEGMENT"].includes(sc.kind) || (sc.kind === "SEGMENT" && !(sc.beatIds || sc.sceneIds || []).length)) throw err("DIRECTOR_PROMPT_INVALID", "scope must be PROJECT or SEGMENT with beatIds/sceneIds");
  const sentences = body.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  const rejectedDirectives = sentences.filter((s) => OVERRIDE_DIRECTIVE_RE.test(s)).map((s) => ({ directive: s.slice(0, 160), reason: "CANNOT_OVERRIDE_EVIDENCE_RIGHTS_SAFETY_POLICY_OR_QA" }));
  const effectiveDirectives = sentences.filter((s) => !OVERRIDE_DIRECTIVE_RE.test(s));
  const doc = {
    kind: "DIRECTOR_PROMPT",
    promptId: `dp-${h({ projectId, ownerId, body })}`,
    version: previous ? previous.version + 1 : 1,
    supersedes: previous ? previous.promptId : null,
    projectId, ownerId, scope: sc, createdAt: now(),
    text: body, effectiveDirectives, rejectedDirectives,
    precedence: PRECEDENCE,
    precedenceNote: "Prompt intent ranks BELOW every precedence entry; it steers style/story choices only.",
  };
  assertSafeDoc(doc);
  return doc;
}

/** Undo: a new version carrying the older text (history is never rewritten). */
function rollbackDirectorPrompt(history, toVersion, ownerId, opts = {}) {
  const target = history.find((p) => p.version === toVersion);
  const last = history[history.length - 1];
  if (!target || !last) throw err("DIRECTOR_PROMPT_ROLLBACK_INVALID", `unknown version ${toVersion}`);
  return { ...createDirectorPrompt({ projectId: target.projectId, ownerId, scope: target.scope, text: target.text, previous: last, ...opts }), rolledBackTo: toVersion };
}

/** A prompt can never waive a blocker, whatever its category (precedence is not negotiable). */
const canPromptOverride = () => false;

/** DAG invalidation for an approved content-affecting control change (reuses the Phase 6A DAG bridge). */
function invalidateDownstream(root, projectId, controlId, fromType = "FINAL_SPOKEN_SCRIPT") {
  return repair.applyDagInvalidation(root, projectId, { stepId: `ctl-${controlId}`, repairClass: "CREATOR_CONTROL", findingCodes: ["CREATOR_CONTROL_CHANGE"], dag: { mode: "FORWARD", fromType } });
}

// ------------------------------------------------------------------ override ledger
const emptyLedger = (projectId) => ({ kind: "CREATOR_CONTROL_OVERRIDE_LEDGER", version: "1.0.0", projectId, entries: [] });

function append(ledger, entry) {
  const prev = ledger.entries[ledger.entries.length - 1];
  const full = { ...entry, seq: ledger.entries.length + 1, prevHash: prev ? prev.entryHash : null };
  full.entryHash = h(full);
  full.entryId = `ovr-${full.entryHash}`;
  const next = { ...ledger, entries: [...ledger.entries, full] };
  assertSafeDoc(next);
  return next;
}

/**
 * entry: { findingRef, dimension, severity: P2|P3, category, ownerId, reason, videoSha256, rubricVersion?, evidenceRefs? }
 * P0/P1 and factual/rights/security/safety/platform/technical/approval categories are refused.
 */
function recordOverride(ledger, entry, now = () => new Date().toISOString()) {
  if (!entry.ownerId) throw err("OVERRIDE_INVALID", "ownerId required (traceability)");
  if (!entry.reason || String(entry.reason).trim().length < 15) throw err("OVERRIDE_INVALID", "explicit owner reason (>=15 chars) required");
  if (!entry.videoSha256 || !entry.findingRef || !entry.dimension) throw err("OVERRIDE_INVALID", "findingRef, dimension, videoSha256 required");
  if (!["P2", "P3"].includes(entry.severity)) throw err("OVERRIDE_REFUSED_SEVERITY", `${entry.severity} cannot be auto-overridden (P0/P1 blockers need repair)`);
  if (NON_OVERRIDABLE.includes(String(entry.category).toUpperCase())) throw err("OVERRIDE_REFUSED_CATEGORY", `${entry.category} is a hard-blocker category`);
  return append(ledger, {
    op: "ACCEPT", findingRef: entry.findingRef, dimension: entry.dimension, severity: entry.severity, category: entry.category,
    ownerId: entry.ownerId, reason: String(entry.reason).trim(), evidenceRefs: entry.evidenceRefs || [],
    scope: { videoSha256: entry.videoSha256, rubricVersion: entry.rubricVersion || RUBRIC_VERSION }, at: now(),
  });
}

function revokeOverride(ledger, entryId, ownerId, reason, now = () => new Date().toISOString()) {
  if (!ledger.entries.some((e) => e.entryId === entryId && e.op === "ACCEPT")) throw err("OVERRIDE_REVOKE_INVALID", "unknown acceptance");
  if (!ownerId || !reason) throw err("OVERRIDE_INVALID", "ownerId and reason required");
  return append(ledger, { op: "REVOKE", revokes: entryId, ownerId, reason, at: now() });
}

/** Acceptances still in force for exactly this video bytes + rubric version (edit/rubric change retires them). */
function activeAcceptances(ledger, { videoSha256, rubricVersion = RUBRIC_VERSION }) {
  const revoked = new Set(ledger.entries.filter((e) => e.op === "REVOKE").map((e) => e.revokes));
  return ledger.entries
    .filter((e) => e.op === "ACCEPT" && !revoked.has(e.entryId) && e.scope.videoSha256 === videoSha256 && e.scope.rubricVersion === rubricVersion)
    .map((e) => ({ dimension: e.dimension, ownerRef: e.ownerId, reason: e.reason, ledgerEntryId: e.entryId }));
}

function verifyLedger(ledger) {
  let prev = null;
  for (const e of ledger.entries) {
    const { entryHash, entryId, ...rest } = e;
    if (e.prevHash !== prev || h(rest) !== entryHash) return { ok: false, brokenAt: e.seq };
    prev = entryHash;
  }
  return { ok: true };
}

module.exports = {
  DIRECTOR_PROMPT_MAX_CHARS, PRECEDENCE, NON_OVERRIDABLE, createDirectorPrompt, rollbackDirectorPrompt, canPromptOverride, invalidateDownstream,
  emptyLedger, recordOverride, revokeOverride, activeAcceptances, verifyLedger,
};
