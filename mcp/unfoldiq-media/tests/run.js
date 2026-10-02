"use strict";

/**
 * UNFOLDIQ media MCP self-test (STEP-10C Branch C).
 * Spawns server.js over stdio and checks:
 *   1. initialize returns protocolVersion 2024-11-05
 *   2. tools/list count == 8
 *   3. media_capabilities returns READY matrix
 *   4. resolve_media_request dry-run carries no-generation marker
 * Runnable via `node tests/run.js`. Exit 0 pass / 1 fail. No network, no secrets.
 */

const path = require("path");
const { spawn } = require("child_process");

const SERVER = path.join(__dirname, "..", "server.js");

let passed = 0;
let failed = 0;

function assert(cond, message) {
  if (!cond) {
    console.log(`  ASSERT FAIL: ${message}`);
    failed++;
  } else {
    console.log(`  ok: ${message}`);
    passed++;
  }
}

function run() {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [SERVER], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (c) => {
      out += c;
    });
    child.stderr.on("data", () => {});
    child.on("error", (e) => {
      console.log(`SPAWN_ERROR: ${e.message}`);
      resolvePromise(1);
    });

    const send = (obj) => child.stdin.write(`${JSON.stringify(obj)}\n`);
    let id = 0;
    const nextId = () => {
      id += 1;
      return id;
    };

    send({ jsonrpc: "2.0", id: nextId(), method: "initialize", params: {} });
    send({ jsonrpc: "2.0", id: nextId(), method: "tools/list", params: {} });
    send({
      jsonrpc: "2.0",
      id: nextId(),
      method: "tools/call",
      params: { name: "media_capabilities", arguments: {} },
    });
    send({
      jsonrpc: "2.0",
      id: nextId(),
      method: "tools/call",
      params: {
        name: "resolve_media_request",
        arguments: {
          request: {
            version: "1.0.0",
            requestId: "MCP-SELFTEST-1",
            projectId: "selftest",
            sceneId: "S01",
            capability: "image",
            input: { prompt: "self-test prompt" },
            outputRequirements: { format: "png" },
          },
        },
      },
    });

    setTimeout(() => {
      try {
        child.stdin.end();
      } catch {
        // already closed
      }
    }, 1500);

    child.on("close", () => {
      try {
        const lines = out.split("\n").map((l) => l.trim()).filter(Boolean);
        const msgs = lines.map((l) => JSON.parse(l));
        const byId = {};
        for (const m of msgs) {
          if (m.id !== undefined && m.id !== null) byId[m.id] = m;
        }
        assert(byId[1] && byId[1].result && byId[1].result.protocolVersion === "2024-11-05", "initialize protocolVersion 2024-11-05");
        assert(byId[1] && byId[1].result && byId[1].result.serverInfo && byId[1].result.serverInfo.name === "unfoldiq-media", "initialize serverInfo unfoldiq-media");
        const tools = byId[2] && byId[2].result && byId[2].result.tools;
        assert(Array.isArray(tools) && tools.length === 8, `tools/list count==8 (got ${Array.isArray(tools) ? tools.length : "?"})`);
        const caps = byId[3] && byId[3].result && byId[3].result.structuredContent;
        assert(caps && caps.status === "READY" && Array.isArray(caps.providers), "media_capabilities READY matrix");
        const dry = byId[4] && byId[4].result && byId[4].result.structuredContent;
        assert(
          dry && (dry.dryRun === true || dry.generated === false) && !dry.artifactPath,
          "resolve dry-run no-generation marker (dryRun/generated flags, no artifactPath)"
        );
      } catch (e) {
        console.log(`PARSE_ERROR: ${e.message}`);
        failed++;
      }
      console.log(`\nself-test: ${passed} passed, ${failed} failed`);
      resolvePromise(failed === 0 ? 0 : 1);
    });
  });
}

run().then((code) => process.exit(code));
