"use strict";

/**
 * Security regression (finding 4): DNS-rebinding protection. A request whose
 * Host header is neither 127.0.0.1 nor localhost must be rejected, including on
 * the unauthenticated bootstrap routes. SAFE behaviour asserted.
 */

const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createBridgeServer } = require("../../flow-companion/bridge/server.js");
const { createPairingManager } = require("../../lib/device-pairing/index.js");

const TOKEN = "TEST-ONLY-BRIDGE-TOKEN";
let failed = 0;

function assert(c, m) {
  if (!c) throw new Error(`ASSERTION FAILED: ${m}`);
  console.log(`  ok ${m}`);
}

async function runTest(name, fn) {
  console.log(`\n[TEST] ${name}`);
  try { await fn(); console.log("[PASS]"); } catch (e) { console.log(`[FAIL] ${e.message}`); failed++; }
}

function get(port, p, headers) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: "127.0.0.1", port, path: p, headers }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode));
    }).on("error", reject);
  });
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qa-auto-host-"));
  const pairing = createPairingManager({ stateDir: path.join(tmp, "state"), allowedOrigins: ["http://127.0.0.1:5173"] });
  const bridge = createBridgeServer({ projectRoot: path.join(tmp, "root"), token: TOKEN, pairing });
  const addr = await bridge.listen(0);
  const evilHost = `rebind.evil.example:${addr.port}`;
  try {
    await runTest("control: Host 127.0.0.1 and localhost are served", async () => {
      assert((await get(addr.port, "/pairing/status", { Host: `127.0.0.1:${addr.port}` })) === 200, "127.0.0.1 host ok");
      assert((await get(addr.port, "/pairing/status", { Host: `localhost:${addr.port}` })) === 200, "localhost host ok");
    });
    await runTest("foreign Host is rejected on unauthenticated /pairing/status", async () => {
      const s = await get(addr.port, "/pairing/status", { Host: evilHost });
      console.log(`  output: status=${s}`);
      assert(s === 400 || s === 403 || s === 421, `foreign Host must be rejected (got ${s})`);
    });
    await runTest("foreign Host is rejected on token-gated /health", async () => {
      const s = await get(addr.port, "/health", { Host: evilHost, "x-bridge-token": TOKEN });
      console.log(`  output: status=${s}`);
      assert(s === 400 || s === 403 || s === 421, `foreign Host must be rejected (got ${s})`);
    });
  } finally {
    await bridge.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  process.exit(failed ? 1 : 0);
}

main();
