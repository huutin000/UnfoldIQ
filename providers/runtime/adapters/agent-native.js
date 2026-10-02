"use strict";

/**
 * agent-native adapter (STEP 10A) — bridge contract only.
 *
 * Step 10A must NOT assume Antigravity always has video, ZCode always has
 * image, or ChatGPT tooling inside the repo process. Without an injected
 * bridge the adapter returns NOT_AVAILABLE (AGENT_NATIVE_BRIDGE_NOT_CONFIGURED).
 * Step 10C may connect MCP/native capabilities through ctx.bridge.
 *
 * Bridge shape: { capabilities: string[], execute: async (request, ctx) => result }
 */

const { unavailable } = require("../errors");
const sessionRegistry = require("./agent-native-registry");

async function execute(request, ctx = {}) {
  const bridge = ctx.bridge;
  if (bridge && typeof bridge.execute === "function") {
    if (Array.isArray(bridge.capabilities) && !bridge.capabilities.includes(request.capability)) {
      throw unavailable("AGENT_NATIVE_CAPABILITY_UNSUPPORTED", `Bridge does not expose capability ${request.capability}`);
    }
    return bridge.execute(request, ctx);
  }
  const sessionId = ctx.agentSessionId;
  if (sessionId) {
    const agentName = ctx.agentName;
    const toolName = ctx.agentToolName || ctx.toolName;
    if (sessionRegistry.isCapable(sessionId, request.capability)) {
      return sessionRegistry.buildHandoffPacket(request, { sessionId, agentName, toolName });
    }
    throw unavailable("AGENT_NATIVE_NOT_AVAILABLE", `No declared agent-native capability ${request.capability} for session ${sessionId}`);
  }
  throw unavailable("AGENT_NATIVE_BRIDGE_NOT_CONFIGURED", "No agent-native bridge injected for this runtime");
}

module.exports = {
  execute,
  providerId: "agent-native",
  declareCapabilities: sessionRegistry.declareCapabilities,
  getCapabilities: sessionRegistry.getCapabilities,
  isCapable: sessionRegistry.isCapable,
  clearSession: sessionRegistry.clearSession,
  buildHandoffPacket: sessionRegistry.buildHandoffPacket,
};
