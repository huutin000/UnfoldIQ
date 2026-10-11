"use strict";

/**
 * Script Quality Gate: binds a Script QA verdict to one exact script text and
 * lets downstream stages (TTS-ready plan) block when the verdict is missing,
 * not READY_FOR_LOCK, or stale (the text changed after the QA ran).
 * The decision records the verdict; it never locks a script by itself.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DECISION_DIR_REL = "script-qa";

function scriptTextHash(segments) {
  const text = (segments || []).map((s) => `${s.segmentId}\n${s.text}`).join("\n\n");
  return crypto.createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);
}

function buildDecision({ qaResult, scriptArtifactId, scriptVersion, segments, ledgerVersion, now }) {
  return {
    kind: "SCRIPT_QA_DECISION",
    version: "1.0.0",
    scriptRef: { scriptArtifactId, scriptVersion },
    scriptTextHash: scriptTextHash(segments),
    verdict: qaResult.verdict,
    requirements: qaResult.requirements,
    openFindings: (qaResult.open || []).length,
    scenes: qaResult.scenes,
    words: qaResult.words,
    durationBasis: qaResult.durationBasis,
    ledgerVersion: ledgerVersion || null,
    decidedAt: (now ? new Date(now) : new Date()).toISOString(),
    note: "READY_FOR_LOCK is a recommendation; locking is an owner decision",
  };
}

function relPath(scriptArtifactId, scriptVersion) {
  return path.join(DECISION_DIR_REL, `${scriptArtifactId}@v${scriptVersion}.json`);
}

function persistDecision(root, projectId, decision) {
  const rel = relPath(decision.scriptRef.scriptArtifactId, decision.scriptRef.scriptVersion);
  const abs = path.join(root, "projects", projectId, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(decision, null, 2) + "\n");
  return { ok: true, rel: rel.split(path.sep).join("/") };
}

function loadDecision(root, projectId, scriptArtifactId, scriptVersion) {
  const abs = path.join(root, "projects", projectId, relPath(scriptArtifactId, scriptVersion));
  if (!fs.existsSync(abs)) return { ok: false, code: "SCRIPT_QA_MISSING", message: "no Script QA decision for this script version" };
  return { ok: true, decision: JSON.parse(fs.readFileSync(abs, "utf8")) };
}

/**
 * Owner approval is a separate, explicit act: it is recorded only from the owner's
 * own statement and binds to the exact script text. READY_FOR_LOCK alone never opens TTS.
 */
function withOwnerApproval(decision, { approvedBy, source, note, now }) {
  if (!approvedBy || !source) throw new Error("OWNER_APPROVAL_REQUIRES_APPROVER_AND_SOURCE");
  return { ...decision, ownerApproval: { status: "APPROVED", approvedBy, source, note: note || null, approvedAt: (now ? new Date(now) : new Date()).toISOString(), scriptTextHash: decision.scriptTextHash } };
}

/** Pure check used by the TTS-ready plan: READY_FOR_LOCK for exactly this text, then explicit owner approval. */
function checkDecision(decision, scriptDoc) {
  if (!decision) return { ok: false, code: "SCRIPT_QA_MISSING" };
  if (decision.scriptRef.scriptArtifactId !== scriptDoc.scriptArtifactId || decision.scriptRef.scriptVersion !== scriptDoc.scriptVersion) return { ok: false, code: "SCRIPT_QA_STALE", detail: "decision bound to a different script version" };
  if (decision.scriptTextHash !== scriptTextHash(scriptDoc.segments)) return { ok: false, code: "SCRIPT_QA_STALE", detail: "script text changed after the QA decision" };
  if (decision.verdict !== "READY_FOR_LOCK") return { ok: false, code: "SCRIPT_QA_NOT_READY", detail: decision.verdict };
  const ap = decision.ownerApproval;
  if (!ap || ap.status !== "APPROVED") return { ok: false, code: "SCRIPT_OWNER_APPROVAL_PENDING", detail: "READY_FOR_LOCK is a recommendation; the owner has not approved" };
  if (ap.scriptTextHash !== decision.scriptTextHash) return { ok: false, code: "SCRIPT_QA_STALE", detail: "owner approval was given for different text" };
  return { ok: true, code: "SCRIPT_QA_READY" };
}

module.exports = { scriptTextHash, buildDecision, withOwnerApproval, persistDecision, loadDecision, checkDecision, DECISION_DIR_REL };
