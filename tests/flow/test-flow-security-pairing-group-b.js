"use strict";

/**
 * Bridge hardening group B (decisions D2 + B2), real HTTP, in-process bridge on
 * 127.0.0.1 ephemeral port, pairing state in a temp dir, in-memory secret store.
 *
 * D2: POST /pairing/approve for an ALREADY-PAIRED device with no dev token and no
 *     valid session -> 409 {error:"ALREADY_PAIRED"}, pairing.approve NOT called.
 *     Authenticated callers keep the old behaviour; first-time approve unchanged.
 * B2: unauthenticated GET /pairing/status exposes only
 *     {paired, corrupted?, actionable?, authModes, contractVersion, exactOriginRequired};
 *     deviceId/origin/trustedSince/rotatedAt only when authorized (token or session).
 *
 * Expected today: positive/authenticated tests green; unauthenticated-already-paired
 * approve and unauthenticated status tests red until group B is implemented.
 */

const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createBridgeServer } = require("../../flow-companion/bridge/server.js");
const { createPairingManager } = require("../../lib/device-pairing/index.js");
const { createSecretStore } = require("../../lib/device-pairing/secret-store.js");

const ORIGIN = "http://127.0.0.1:5173";
const DEV_TOKEN = "TEST-ONLY-DEV-TOKEN";
const PUBLIC_STATUS_KEYS = new Set(["paired", "corrupted", "actionable", "authModes", "contractVersion", "exactOriginRequired"]);
const PRIVATE_STATUS_KEYS = ["deviceId", "origin", "trustedSince", "rotatedAt"];

let failed = 0;
let passed = 0;

function assert(c, m) {
  if (!c) throw new Error(`ASSERTION FAILED: ${m}`);
  console.log(`  ok ${m}`);
}
async function runTest(name, fn) {
  console.log(`\n[TEST] ${name}`);
  try { await fn(); console.log("[PASS]"); passed++; } catch (e) { console.log(`[FAIL] ${e.message}`); failed++; }
}

function call(port, method, p, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ hostname: "127.0.0.1", port, path: p, method, headers: { "Content-Type": "application/json", ...headers } }, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => {
        let json = {};
        try { json = buf ? JSON.parse(buf) : {}; } catch { /* keep {} */ }
        resolve({ status: res.statusCode, json, text: buf });
      });
    });
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

// Fresh bridge + pairing manager per test so tests are independent.
async function withBridge(fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qa-auto-pair-b-"));
  const pairing = createPairingManager({
    stateDir: path.join(tmp, "state"),
    secretStore: createSecretStore({ backend: "memory" }),
    allowedOrigins: [ORIGIN],
  });
  const calls = { approve: 0 };
  const realApprove = pairing.approve.bind(pairing);
  pairing.approve = (...a) => { calls.approve++; return realApprove(...a); };
  const bridge = createBridgeServer({ projectRoot: path.join(tmp, "root"), token: DEV_TOKEN, pairing, allowedOrigins: [ORIGIN] });
  const addr = await bridge.listen(0);
  try {
    await fn({ port: addr.port, pairing, calls, realApprove });
  } finally {
    await bridge.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function main() {
  // ---------------- D2: approve ----------------
  await runTest("first approve while unpaired works as before (200 + sessionToken, no credentials)", () => withBridge(async ({ port, pairing, calls }) => {
    const r = await call(port, "POST", "/pairing/approve", { origin: ORIGIN });
    console.log(`  output: status=${r.status} keys=${Object.keys(r.json).join(",")}`);
    assert(r.status === 200, `200 (got ${r.status})`);
    assert(typeof r.json.sessionToken === "string" && r.json.sessionToken.length > 0, "sessionToken issued");
    assert(typeof r.json.deviceId === "string", "deviceId returned to the approving caller");
    assert(calls.approve === 1, "pairing.approve called once");
    assert(pairing.status().paired === true, "device is now paired");
  }));

  await runTest("approve without credentials when ALREADY paired -> 409 ALREADY_PAIRED, approve not called", () => withBridge(async ({ port, pairing, calls, realApprove }) => {
    const first = realApprove({ origin: ORIGIN });
    assert(first.ok, "setup: paired in-process");
    pairing.disconnect({ sessionToken: first.sessionToken });
    const r = await call(port, "POST", "/pairing/approve", { origin: ORIGIN });
    console.log(`  output: status=${r.status} body=${r.text.slice(0, 120)}`);
    assert(r.status === 409, `409 (got ${r.status})`);
    assert(r.json.error === "ALREADY_PAIRED", `error ALREADY_PAIRED (got ${JSON.stringify(r.json.error)})`);
    assert(!r.json.sessionToken && !/sessionToken/.test(r.text), "no session token in the response");
    assert(calls.approve === 0, "pairing.approve was not called");
  }));

  await runTest("approve with wrong dev token and bogus session header when already paired -> still 409 ALREADY_PAIRED", () => withBridge(async ({ port, calls, realApprove }) => {
    assert(realApprove({ origin: ORIGIN }).ok, "setup: paired in-process");
    const r = await call(port, "POST", "/pairing/approve", { origin: ORIGIN }, { "x-bridge-token": "WRONG", "x-bridge-session": "not-a-real-session" });
    console.log(`  output: status=${r.status} body=${r.text.slice(0, 120)}`);
    assert(r.status === 409 && r.json.error === "ALREADY_PAIRED", `409 ALREADY_PAIRED (got ${r.status} ${JSON.stringify(r.json.error)})`);
    assert(calls.approve === 0, "pairing.approve was not called");
  }));

  await runTest("approve with a disconnected (invalid) session header when already paired -> 409 ALREADY_PAIRED", () => withBridge(async ({ port, pairing, calls, realApprove }) => {
    const first = realApprove({ origin: ORIGIN });
    pairing.disconnect({ sessionToken: first.sessionToken });
    const r = await call(port, "POST", "/pairing/approve", { origin: ORIGIN }, { "x-bridge-session": first.sessionToken });
    console.log(`  output: status=${r.status} body=${r.text.slice(0, 120)}`);
    assert(r.status === 409 && r.json.error === "ALREADY_PAIRED", `409 ALREADY_PAIRED (got ${r.status} ${JSON.stringify(r.json.error)})`);
    assert(calls.approve === 0, "pairing.approve was not called");
  }));

  await runTest("approve with the dev token when already paired keeps old behaviour (session returned)", () => withBridge(async ({ port, calls, realApprove }) => {
    assert(realApprove({ origin: ORIGIN }).ok, "setup: paired in-process");
    const r = await call(port, "POST", "/pairing/approve", { origin: ORIGIN }, { "x-bridge-token": DEV_TOKEN });
    console.log(`  output: status=${r.status} keys=${Object.keys(r.json).join(",")}`);
    assert(r.status === 200, `200 (got ${r.status})`);
    assert(typeof r.json.sessionToken === "string" && r.json.sessionToken.length > 0, "sessionToken returned");
    assert(calls.approve === 1, "pairing.approve called once");
  }));

  await runTest("approve with a valid device session when already paired keeps old behaviour (session returned)", () => withBridge(async ({ port, calls, realApprove }) => {
    const first = realApprove({ origin: ORIGIN });
    assert(first.ok && first.sessionToken, "setup: paired in-process, session live");
    const before = calls.approve;
    const r = await call(port, "POST", "/pairing/approve", { origin: ORIGIN }, { "x-bridge-session": first.sessionToken });
    console.log(`  output: status=${r.status} keys=${Object.keys(r.json).join(",")}`);
    assert(r.status === 200, `200 (got ${r.status})`);
    assert(typeof r.json.sessionToken === "string" && r.json.sessionToken.length > 0, "sessionToken returned");
    assert(calls.approve === before + 1, "pairing.approve called once");
  }));

  await runTest("approve with a rejected body origin while unpaired is still 403 ORIGIN_REJECTED", () => withBridge(async ({ port }) => {
    const r = await call(port, "POST", "/pairing/approve", { origin: "https://evil.example" });
    console.log(`  output: status=${r.status} body=${r.text.slice(0, 120)}`);
    assert(r.status === 403 && r.json.error === "ORIGIN_REJECTED", `403 ORIGIN_REJECTED (got ${r.status} ${JSON.stringify(r.json.error)})`);
  }));

  // ---------------- B2: status ----------------
  await runTest("status without credentials while paired exposes only the public fields", () => withBridge(async ({ port, realApprove }) => {
    const p = realApprove({ origin: ORIGIN });
    assert(p.ok, "setup: paired");
    const r = await call(port, "GET", "/pairing/status");
    console.log(`  output: status=${r.status} body=${r.text}`);
    assert(r.status === 200, "200");
    assert(r.json.paired === true, "paired true");
    assert(Array.isArray(r.json.authModes) && r.json.authModes.length > 0, "authModes present");
    assert(typeof r.json.contractVersion !== "undefined" && r.json.contractVersion !== null, "contractVersion present");
    assert(r.json.exactOriginRequired === true, "exactOriginRequired true");
    for (const k of PRIVATE_STATUS_KEYS) assert(!(k in r.json), `no ${k} field`);
    const extra = Object.keys(r.json).filter((k) => !PUBLIC_STATUS_KEYS.has(k));
    assert(extra.length === 0, `no unexpected fields (got ${JSON.stringify(extra)})`);
    assert(!r.text.includes(p.deviceId) && !r.text.includes(ORIGIN), "body contains neither deviceId nor origin value");
  }));

  await runTest("status without credentials while unpaired reports paired:false with public fields only", () => withBridge(async ({ port }) => {
    const r = await call(port, "GET", "/pairing/status");
    console.log(`  output: status=${r.status} body=${r.text}`);
    assert(r.status === 200 && r.json.paired === false, "200 and paired false");
    assert(Array.isArray(r.json.authModes) && r.json.contractVersion !== undefined && r.json.exactOriginRequired === true, "authModes, contractVersion, exactOriginRequired present");
    const extra = Object.keys(r.json).filter((k) => !PUBLIC_STATUS_KEYS.has(k));
    assert(extra.length === 0, `no unexpected fields (got ${JSON.stringify(extra)})`);
  }));

  await runTest("status with the dev token while paired includes deviceId, origin and trustedSince", () => withBridge(async ({ port, realApprove }) => {
    const p = realApprove({ origin: ORIGIN });
    const r = await call(port, "GET", "/pairing/status", null, { "x-bridge-token": DEV_TOKEN });
    console.log(`  output: status=${r.status} keys=${Object.keys(r.json).join(",")}`);
    assert(r.status === 200 && r.json.paired === true, "200 and paired true");
    assert(r.json.deviceId === p.deviceId, "deviceId matches the paired device");
    assert(r.json.origin === ORIGIN, "origin present");
    assert(typeof r.json.trustedSince !== "undefined", "trustedSince present");
    assert(Array.isArray(r.json.authModes) && r.json.contractVersion !== undefined && r.json.exactOriginRequired === true, "public fields still present");
  }));

  await runTest("status with a valid device session while paired includes deviceId", () => withBridge(async ({ port, realApprove }) => {
    const p = realApprove({ origin: ORIGIN });
    const r = await call(port, "GET", "/pairing/status", null, { "x-bridge-session": p.sessionToken });
    assert(r.status === 200 && r.json.deviceId === p.deviceId, "deviceId visible to an authorized session");
  }));

  await runTest("status with a wrong token is treated as unauthenticated (no private fields)", () => withBridge(async ({ port, realApprove }) => {
    realApprove({ origin: ORIGIN });
    const r = await call(port, "GET", "/pairing/status", null, { "x-bridge-token": "WRONG", "x-bridge-session": "bogus" });
    console.log(`  output: status=${r.status} body=${r.text}`);
    assert(r.status === 200, "still 200 (status stays public)");
    for (const k of PRIVATE_STATUS_KEYS) assert(!(k in r.json), `no ${k} field`);
  }));

  console.log(`\n=== pairing-group-b: ${passed} passed, ${failed} failed ===`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
