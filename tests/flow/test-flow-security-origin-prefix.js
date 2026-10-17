"use strict";

/**
 * Security regression (finding 3): validateOrigin must not accept look-alike
 * origins such as http://localhost.evil.com (prefix match). SAFE asserted.
 * Unit level + HTTP level (Origin header against a real in-process bridge).
 */

const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createBridgeServer } = require("../../flow-companion/bridge/server.js");
const { validateOrigin } = require("../../flow-companion/bridge/security.js");

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

function call(port, headers) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: "127.0.0.1", port, path: "/health", headers: { "x-bridge-token": TOKEN, ...headers } }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode));
    }).on("error", reject);
  });
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qa-auto-origin-"));
  const bridge = createBridgeServer({ projectRoot: path.join(tmp, "root"), token: TOKEN });
  const addr = await bridge.listen(0);
  try {
    await runTest("validateOrigin rejects look-alike hosts (default allowlist)", () => {
      for (const o of ["http://localhost.evil.com", "http://127.0.0.1.evil.com", "http://localhostevil.com", "http://localhost@evil.com", "chrome-extension://"]) {
        console.log(`  validateOrigin(${o}) = ${validateOrigin(o)}`);
      }
      assert(validateOrigin("http://localhost.evil.com") === false, "http://localhost.evil.com rejected");
      assert(validateOrigin("http://127.0.0.1.evil.com") === false, "http://127.0.0.1.evil.com rejected");
      assert(validateOrigin("http://localhost:3000") === true, "control: http://localhost:3000 still accepted");
    });

    await runTest("bridge answers 403 to Origin http://localhost.evil.com", async () => {
      const s = await call(addr.port, { Origin: "http://localhost.evil.com" });
      console.log(`  output: status=${s}`);
      assert(s === 403, `look-alike origin must be 403 (got ${s})`);
      const ok = await call(addr.port, { Origin: "http://localhost:3000" });
      assert(ok === 200, "control: genuine localhost origin is accepted");
    });
  } finally {
    await bridge.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  process.exit(failed ? 1 : 0);
}

main();
