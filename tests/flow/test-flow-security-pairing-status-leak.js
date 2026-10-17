"use strict";

/**
 * Security regression (finding 2): unauthenticated GET /pairing/status must not
 * leak the trusted origin (or device id). SAFE behaviour asserted; RED = leak.
 */

const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createBridgeServer } = require("../../flow-companion/bridge/server.js");
const { createPairingManager } = require("../../lib/device-pairing/index.js");

const ORIGIN = "http://127.0.0.1:5173";
let failed = 0;

function assert(c, m) {
  if (!c) throw new Error(`ASSERTION FAILED: ${m}`);
  console.log(`  ok ${m}`);
}

function get(port, p) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: "127.0.0.1", port, path: p }, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => resolve({ status: res.statusCode, text: buf }));
    }).on("error", reject);
  });
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qa-auto-pair-status-"));
  const pairing = createPairingManager({ stateDir: path.join(tmp, "state"), allowedOrigins: [ORIGIN] });
  const bridge = createBridgeServer({ projectRoot: path.join(tmp, "root"), pairing, allowedOrigins: [ORIGIN] });
  const addr = await bridge.listen(0);
  try {
    console.log("\n[TEST] unauthenticated /pairing/status must not expose the trusted origin");
    const p = pairing.approve({ origin: ORIGIN });
    assert(p.ok, "setup: device paired");
    const r = await get(addr.port, "/pairing/status");
    console.log(`  output: status=${r.status} body=${r.text}`);
    assert(!r.text.includes(ORIGIN), "response body does not contain the trusted origin");
    assert(!/"origin"\s*:/.test(r.text), "response has no origin field");
    assert(!r.text.includes(p.deviceId), "response does not contain the device id");
    console.log("[PASS]");
  } catch (e) {
    console.log(`[FAIL] ${e.message}`);
    failed++;
  } finally {
    await bridge.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  process.exit(failed ? 1 : 0);
}

main();
