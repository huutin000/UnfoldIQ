"use strict";

/**
 * Security regression (finding 1): unauthenticated POST /pairing/approve must
 * not hand out a session token for an ALREADY-PAIRED device just because the
 * body names an allowlisted origin. SAFE behaviour asserted; RED = vuln real.
 *
 * Real HTTP, in-process bridge on 127.0.0.1 ephemeral port, state in a temp dir.
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

function call(port, method, p, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ hostname: "127.0.0.1", port, path: p, method, headers: { "Content-Type": "application/json", ...headers } }, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => {
        let parsed = buf;
        try { parsed = JSON.parse(buf); } catch { /* keep raw */ }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qa-auto-pair-approve-"));
  const pairing = createPairingManager({ stateDir: path.join(tmp, "state"), allowedOrigins: [ORIGIN] });
  const bridge = createBridgeServer({ projectRoot: path.join(tmp, "root"), pairing, allowedOrigins: [ORIGIN] });
  const addr = await bridge.listen(0);
  try {
    console.log("\n[TEST] unauthenticated approve with body origin must not issue a session for an already-paired device");
    // Legitimate one-time pairing (in-process, as the user's explicit approval).
    const first = pairing.approve({ origin: ORIGIN });
    assert(first.ok && first.sessionToken, "setup: device paired legitimately");
    pairing.disconnect({ sessionToken: first.sessionToken });

    // Attacker: local process, no token, no session header, no Origin header, origin only in body.
    const r = await call(addr.port, "POST", "/pairing/approve", { origin: ORIGIN });
    console.log(`  output: status=${r.status} hasSessionToken=${!!(r.body && r.body.sessionToken)}`);
    assert(!(r.body && r.body.sessionToken), "no sessionToken returned to an unauthenticated caller");
    assert(r.status === 401 || r.status === 403 || r.status === 409, `rejected status (got ${r.status})`);

    // The minted session must also not grant access to the gated API.
    if (r.body && r.body.sessionToken) {
      const h = await call(addr.port, "GET", "/health", null, { "x-bridge-session": r.body.sessionToken });
      console.log(`  output: minted session on /health -> ${h.status}`);
    }
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
