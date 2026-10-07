"use strict";

/**
 * UNFOLDIQ Flow Companion — Agent Instructions sync contract (1G.9).
 * Pure message/state contract between the local instruction owner
 * (lib/agent-instructions) and the browser adapter. No DOM, no network,
 * no generation here: this module builds apply plans, validates project
 * binding + evidence shape, and computes sync-state transitions from
 * reported evidence. The extension content script performs the actual
 * page interaction; the bridge transports messages.
 *
 * Forbidden payloads (rejected at validation): model selection changes,
 * output-count changes, confirm-before-generating changes, generation
 * triggers, credentials/session tokens.
 */

const FORBIDDEN_EVIDENCE_KEYS = [
  "selectedModel",
  "defaultModel",
  "outputCount",
  "confirmBeforeGenerating",
  "generateTriggered",
  "cookie",
  "authToken",
  "sessionToken",
  "apiKey",
];

const APPLY_STEPS = [
  "VERIFY_PROJECT",
  "ENSURE_AGENT_ON",
  "OPEN_INSTRUCTIONS",
  "APPLY_TEXT",
  "ATTACH_REFERENCES",
  "SAVE_DONE",
  "RECORD_EVIDENCE",
];

/**
 * FIX 02 §11/§15 — validate an instruction-apply intent payload (server side).
 * Required: projectId, providerProjectRef, instructionVersion.
 * Rejects model/output/settings/generation/credential material anywhere in
 * the payload. Mirrors the adapter-side forbidden list (provider-side owner
 * is the adapter; this is the second net at the bridge boundary).
 */
const INSTRUCTION_FORBIDDEN_PAYLOAD_KEYS = [
  "model",
  "outputcount",
  "confirmbefore",
  "generate",
  "cookie",
  "authtoken",
  "sessiontoken",
  "apikey",
  "password",
  "credential",
  "authorization",
];

function validateApplyPayload(body = {}) {
  const blockers = [];
  for (const f of ["projectId", "providerProjectRef"]) {
    if (typeof body[f] !== "string" || !body[f]) blockers.push(`APPLY_SOURCE_INVALID: ${f} required`);
  }
  const walk = (v, trail) => {
    if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${trail}[${i}]`));
      return;
    }
    if (v && typeof v === "object") {
      for (const [k, val] of Object.entries(v)) {
        const kl = String(k).toLowerCase().replace(/[_-]/g, "");
        if (INSTRUCTION_FORBIDDEN_PAYLOAD_KEYS.some((fk) => kl.includes(fk))) {
          blockers.push(`FORBIDDEN_INSTRUCTION_PAYLOAD: ${trail}.${k}`);
        }
        walk(val, `${trail}.${k}`);
      }
    }
  };
  walk(body, "$");
  for (const key of FORBIDDEN_EVIDENCE_KEYS) {
    if (body[key] !== undefined) blockers.push(`FORBIDDEN_EVIDENCE: ${key} must never appear in sync payloads`);
  }
  return blockers.length > 0 ? { ok: false, blockers } : { ok: true };
}

/**
 * Build an apply plan for one desired instruction set.
 * Input: { instructionSet, projectBinding: { expectedOrigin?, expectedProjectRef?, contentScriptConnected, bridgeReachable },
 *   agentState: { detected, enabled } | null }
 */
function buildApplyPlan(input = {}) {
  const blockers = [];
  const set = input.instructionSet;
  if (!set || !set.instructionVersion || !set.compiledText) {
    return { ok: false, code: "APPLY_SOURCE_INVALID", message: "compiled instruction set required", blockers: ["APPLY_SOURCE_INVALID"] };
  }
  const binding = input.binding || {};
  if (!binding.contentScriptConnected) blockers.push("BLOCKED_CONTENT_SCRIPT_DISCONNECTED");
  if (!binding.bridgeReachable) blockers.push("BLOCKED_BRIDGE_UNREACHABLE");
  if (!binding.expectedProjectRef) blockers.push("BLOCKED_PROJECT_IDENTITY_UNKNOWN");
  else if (binding.observedProjectRef && binding.observedProjectRef !== binding.expectedProjectRef) {
    blockers.push("BLOCKED_PROJECT_MISMATCH: refusing cross-project mutation");
  }
  const agent = input.agentState || null;
  if (!agent || agent.detected !== true) blockers.push("BLOCKED_AGENT_STATE_UNKNOWN");
  if (blockers.length > 0) return { ok: false, code: blockers[0].split(":")[0], message: blockers.join("; "), blockers };
  return {
    ok: true,
    plan: {
      instructionVersion: set.instructionVersion,
      desiredFingerprint: set.compiledFingerprint,
      projectRef: binding.expectedProjectRef,
      ensureAgentOn: agent.enabled !== true,
      steps: APPLY_STEPS,
      attachReferences: (set.referenceBindings || []).map((b) => b.referenceId),
      forbidden: ["GENERATE", "MODEL_CHANGE", "OUTPUT_COUNT_CHANGE", "CONFIRM_SETTING_CHANGE"],
    },
  };
}

/** Validate reported apply/readback evidence shape (never trusts payloads blindly). */
function validateSyncEvidence(evidence = {}) {
  const blockers = [];
  for (const key of FORBIDDEN_EVIDENCE_KEYS) {
    if (evidence[key] !== undefined) blockers.push(`FORBIDDEN_EVIDENCE: ${key} must never appear in sync evidence`);
  }
  if (evidence.applyStatus && !["APPLIED", "FAILED", "BLOCKED"].includes(evidence.applyStatus)) {
    blockers.push(`APPLY_STATUS_INVALID: ${evidence.applyStatus}`);
  }
  // FIX 03 §16/WP9: a HANDS_FREE sync can never carry operator text entry.
  // The flag pair must be coherent — claiming hands-free while admitting
  // operator typing is a contradiction, not evidence.
  if (evidence.automationMode === "HANDS_FREE" && evidence.operatorTextEntry === true) {
    blockers.push("OPERATOR_TEXT_ENTRY_CONTRADICTS_HANDS_FREE");
  }
  return blockers.length > 0 ? { ok: false, blockers } : { ok: true };
}

/**
 * Compute the next sync status from reported evidence (pure transition).
 * APPLIED is terminal-for-apply only; VERIFIED needs compare + references.
 */
function transitionSync(current, evidence = {}) {
  const check = validateSyncEvidence(evidence);
  if (!check.ok) return { syncStatus: "BLOCKED", blockers: check.blockers };
  if (evidence.applyStatus === "FAILED" || evidence.applyStatus === "BLOCKED") {
    return { syncStatus: "FAILED", blockers: [evidence.applyError || "apply failed"] };
  }
  if (evidence.applyStatus === "APPLIED" && !evidence.readback) {
    return { syncStatus: "READBACK_PENDING", blockers: [] };
  }
  if (evidence.readback && !evidence.readback.available) {
    return { syncStatus: "READBACK_PENDING", blockers: [`readback unavailable: ${evidence.readback.reason || "unknown"}`] };
  }
  if (evidence.compare) {
    if (evidence.compare.status === "MATCH" || evidence.compare.status === "EQUIVALENT") {
      const needRefs = (current && current.referenceBindings ? current.referenceBindings.length : 0) > 0;
      const refsOk = !needRefs || ((evidence.readback && evidence.readback.referenceIds ? evidence.readback.referenceIds.length : 0) > 0);
      if (!refsOk) return { syncStatus: "DRIFT", blockers: ["bindings require reference readback"] };
      return { syncStatus: "VERIFIED", blockers: [] };
    }
    if (evidence.compare.status === "DRIFT") {
      return { syncStatus: "DRIFT", blockers: (evidence.compare.differences || []).map((d) => `${d.class}: ${(d.detail || "").slice(0, 120)}`) };
    }
    return { syncStatus: "READBACK_PENDING", blockers: ["compare UNVERIFIABLE — readback needed"] };
  }
  return { syncStatus: "APPLIED", blockers: [] };
}

module.exports = {
  FORBIDDEN_EVIDENCE_KEYS,
  INSTRUCTION_FORBIDDEN_PAYLOAD_KEYS,
  APPLY_STEPS,
  buildApplyPlan,
  validateApplyPayload,
  validateSyncEvidence,
  transitionSync,
};
