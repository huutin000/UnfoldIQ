"use strict";

/**
 * agent-native session-scoped capability store (STEP-10C Branch B).
 * Declarations are per-session (in-memory Map with expiresAt) — NOT eternal.
 * Optional session file persistence is out of scope for the minimal build;
 * callers may persist the contract doc themselves if needed.
 */

const { unavailable } = require("../errors");

const VALID_CAPABILITIES = ["image", "video", "tts", "stt"];

const sessions = new Map();

function validateDeclaration(decl) {
  if (!decl || typeof decl !== "object") throw new Error("INVALID_DECLARATION");
  for (const k of ["sessionId", "agentName", "capabilities", "declaredAt"]) {
    if (decl[k] === undefined) throw new Error(`DECLARATION_MISSING_${k}`);
  }
  if (typeof decl.sessionId !== "string" || !decl.sessionId) throw new Error("DECLARATION_MISSING_sessionId");
  if (typeof decl.agentName !== "string" || !decl.agentName) throw new Error("DECLARATION_MISSING_agentName");
  if (!Array.isArray(decl.capabilities) || decl.capabilities.length === 0) throw new Error("DECLARATION_MISSING_capabilities");
  for (const c of decl.capabilities) {
    if (!VALID_CAPABILITIES.includes(c)) throw new Error(`DECLARATION_INVALID_CAPABILITY_${c}`);
  }
  return true;
}

function declareCapabilities({ sessionId, agentName, toolName, capabilities, ttlMs, declaredAt, expiresAt, notes }) {
  const decl = {
    sessionId,
    agentName,
    toolName: toolName || null,
    capabilities: [...capabilities],
    declaredAt: declaredAt || new Date().toISOString(),
    expiresAt: expiresAt || new Date(Date.now() + (typeof ttlMs === "number" ? ttlMs : 30 * 60 * 1000)).toISOString(),
    ...(notes !== undefined ? { notes } : {}),
  };
  validateDeclaration(decl);
  sessions.set(sessionId, decl);
  return decl;
}

function pruneExpired() {
  const now = Date.now();
  for (const [id, decl] of sessions) {
    if (decl.expiresAt && Date.parse(decl.expiresAt) <= now) sessions.delete(id);
  }
}

function getCapabilities(sessionId) {
  pruneExpired();
  const decl = sessions.get(sessionId);
  return decl ? { ...decl, capabilities: [...decl.capabilities] } : null;
}

function isCapable(sessionId, capability) {
  const decl = getCapabilities(sessionId);
  return !!decl && decl.capabilities.includes(capability);
}

function clearSession(sessionId) {
  sessions.delete(sessionId);
}

function buildHandoffPacket(request, { sessionId, agentName, toolName }) {
  const decl = getCapabilities(sessionId);
  if (!decl || !decl.capabilities.includes(request.capability)) {
    throw unavailable("AGENT_NATIVE_NOT_AVAILABLE", `No declared agent-native capability ${request.capability} for session ${sessionId}`);
  }
  const promptOrText = (request.input && (request.input.prompt || request.input.text)) || null;
  const continuity = request.continuityContext || {};
  return {
    version: "1.0.0",
    requestId: request.requestId,
    projectId: request.projectId,
    sceneId: request.sceneId,
    capability: request.capability,
    providerId: "agent-native",
    status: "HANDOFF_REQUIRED",
    sourceType: "external-handoff",
    provenanceNote: `Agent-native handoff for session ${sessionId} (${agentName}/${toolName || "native-tool"})`,
    rightsStatus: "NOT_APPLICABLE",
    costClass: "ZERO_LOCAL",
    agentAction: {
      action: "AGENT_NATIVE_GENERATE",
      sessionId,
      agentName: agentName || decl.agentName,
      toolName: toolName || decl.toolName,
      capability: request.capability,
      promptOrText,
      expectedSubmitCommand: "node scripts/cli/provider-cli.js --submit-agent-result <result.json>",
      continuity: {
        requiredEntities: continuity.requiredEntities || [],
        requiredReferences: continuity.requiredReferences || [],
        continuityStrictness: continuity.continuityStrictness || "NOT_APPLICABLE",
      },
    },
  };
}

module.exports = {
  declareCapabilities,
  getCapabilities,
  isCapable,
  clearSession,
  buildHandoffPacket,
  VALID_CAPABILITIES,
};
