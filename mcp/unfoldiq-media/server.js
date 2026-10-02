"use strict";

/**
 * UNFOLDIQ media MCP stdio server (STEP-10C Branch C).
 * JSON-RPC 2.0 over stdin/stdout (line-delimited); stderr for logs only.
 * Handles initialize, tools/list, tools/call, notifications/cancelled ack.
 * Tools delegate to ./tools (provider runtime). Clean shutdown on stdin close.
 * No secrets are ever written to stdout; responses pass through stripSecrets.
 */

const path = require("path");
const { TOOL_DEFS, dispatch, stripSecrets } = require("./tools");

const PROJECT_ROOT = path.join(__dirname, "..", "..");
const SERVER_VERSION = "0.1.0";

function log(...parts) {
  process.stderr.write(`[unfoldiq-media] ${parts.join(" ")}\n`);
}

function send(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

function isNotification(msg) {
  return msg && (msg.id === undefined || msg.id === null) && typeof msg.method === "string" && msg.method.startsWith("notifications/");
}

async function handle(msg) {
  if (!msg || typeof msg !== "object") {
    send({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } });
    return;
  }
  if (isNotification(msg)) return; // ack by silence (incl. notifications/cancelled)
  const id = msg.id === undefined ? null : msg.id;

  if (msg.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        serverInfo: { name: "unfoldiq-media", version: SERVER_VERSION },
        capabilities: { tools: {} },
      },
    });
    return;
  }
  if (msg.method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools: TOOL_DEFS } });
    return;
  }
  if (msg.method === "tools/call") {
    const params = msg.params || {};
    const name = params.name;
    const toolArgs = params.arguments || {};
    const def = TOOL_DEFS.find((t) => t.name === name);
    if (!def) {
      send({ jsonrpc: "2.0", id, error: { code: -32602, message: `Unknown tool: ${name}` } });
      return;
    }
    try {
      const out = await dispatch(name, toolArgs, { projectRoot: PROJECT_ROOT });
      const clean = stripSecrets(out);
      const text = JSON.stringify(clean).slice(0, 32000);
      send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }], structuredContent: clean } });
    } catch (e) {
      send({ jsonrpc: "2.0", id, error: { code: -32603, message: String((e && e.message) || e).slice(0, 500) } });
    }
    return;
  }
  send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${msg.method}` } });
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      continue;
    }
    handle(msg).catch((e) => {
      log(`handle error: ${(e && e.message) || e}`);
      if (msg && msg.id !== undefined && msg.id !== null) {
        send({ jsonrpc: "2.0", id: msg.id, error: { code: -32603, message: "Internal error" } });
      }
    });
  }
});
process.stdin.on("end", () => process.exit(0));
process.stdin.on("close", () => process.exit(0));

log(`unfoldiq-media MCP server v${SERVER_VERSION} listening on stdio`);
