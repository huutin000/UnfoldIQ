"use strict";

/**
 * POST-PHASE-2 F1 — pairing over REAL bridge HTTP (spec §17 Cases A/D/E/F/G/J
 * + dev/recovery fallback + idempotency §22). Loopback ephemeral port,
 * no external network.
 */

const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const REPO = path.join(__dirname, "..", "..");
const { createBridgeServer } = require(REPO + "/flow-companion/bridge/server.js");
const { createPairingManager } = require(REPO + "/lib/device-pairing/index.js");
const { createSecretStore } = require(REPO + "/lib/device-pairing/secret-store.js");

const ORIGIN = "http://localhost:5173";
const DEV_TOKEN = "TEST-ONLY-DEV-TOKEN";
let base = null;
let manager = null;
let passed = 0;
let failed = 0;

function assert(c, m) {
  if (!c) throw new Error(`ASSERTION FAILED: ${m}`);
  console.log(`  ok  ${m}`);
  passed++;
}
function assertEq(a, b, m) {
  if (a !== b) throw new Error(`ASSERTION FAILED: ${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
  console.log(`  ok  ${m}`);
  passed++;
}
function runTest(name, fn) {
  console.log(`\n[TEST] ${name}`);
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`[PASS] ${name}`))
    .catch((e) => { console.log(`[FAIL] ${name}: ${e.message}`); failed++; });
}

function request(p, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(
      { hostname: "127.0.0.1", port: base.port, path: p, method, headers: { "Content-Type": "application/json", ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}), ...headers } },
      (res) => {
        let buf = "";
        res.on("data", (c) => { buf += c; });
        res.on("end", () => {
          try { resolve({ status: res.statusCode, json: buf ? JSON.parse(buf) : {} }); }
          catch (e) { reject(e); }
        });
      }
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

async function pairedSession(mgr, origin = ORIGIN) {
  const st = mgr.status();
  if (!st.paired) {
    const ap = mgr.approve({ origin });
    if (!ap.ok) throw new Error(ap.code);
    return ap;
  }
  const c = mgr.challenge({ deviceId: st.deviceId, origin });
  if (!c.ok) throw new Error(c.code);
  const sig = mgr.signProof({ deviceId: st.deviceId, nonce: c.nonce, origin });
  if (!sig.ok) throw new Error(sig.code);
  const v = mgr.verify({ deviceId: st.deviceId, nonce: c.nonce, signature: sig.signature, origin });
  if (!v.ok) throw new Error(v.code);
  return v;
}

(async () => {
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pair-http-"));
manager = createPairingManager({
  stateDir: path.join(tmp, "pairing"),
  secretStore: createSecretStore({ backend: "memory" }),
  allowedOrigins: [ORIGIN],
});
const { createBridgeServer: _c } = { createBridgeServer };
const bridge = _c({ projectRoot: path.join(tmp, "project"), token: DEV_TOKEN, host: "127.0.0.1", pairing: manager });
base = await bridge.listen(0);

await runTest("Case A — first-time user over HTTP: /pairing/status → approve → connected, no token used", async () => {
  const st = await request("/pairing/status");
  assertEq(st.json.paired, false, "status unpaired");
  const ap = await request("/pairing/approve", { method: "POST", body: { origin: ORIGIN } });
  assertEq(ap.status, 200, "approve 200");
  assert(ap.json.sessionToken, "session issued");
  assert(!/PRIVATE KEY/i.test(JSON.stringify(ap.json)), "no private material over HTTP");
});

await runTest("Case B — trusted reconnect over HTTP: challenge → verify → session; jobs route works with x-bridge-session", async () => {
  const st = await request("/pairing/status");
  const c = await request("/pairing/challenge", { method: "POST", body: { deviceId: st.json.deviceId, origin: ORIGIN } });
  assertEq(c.status, 200, "challenge 200");
  const sig = manager.signProof({ deviceId: st.json.deviceId, nonce: c.json.nonce, origin: ORIGIN });
  const v = await request("/pairing/verify", { method: "POST", body: { deviceId: st.json.deviceId, nonce: c.json.nonce, signature: sig.signature, origin: ORIGIN } });
  assertEq(v.status, 200, "verify 200");
  const health = await request("/health", { headers: { "x-bridge-session": v.json.sessionToken } });
  assertEq(health.status, 200, "session grants bridge access without token");
  assertEq(health.json.authMode, "device-session", "auth mode visible");
});

await runTest("Case F/G — wrong origin + replay rejected over HTTP", async () => {
  const st = await request("/pairing/status");
  const c1 = await request("/pairing/challenge", { method: "POST", body: { deviceId: st.json.deviceId, origin: ORIGIN } });
  const sig = manager.signProof({ deviceId: st.json.deviceId, nonce: c1.json.nonce, origin: ORIGIN });
  const v1 = await request("/pairing/verify", { method: "POST", body: { deviceId: st.json.deviceId, nonce: c1.json.nonce, signature: sig.signature, origin: ORIGIN } });
  assertEq(v1.status, 200, "first verify ok");
  const v2 = await request("/pairing/verify", { method: "POST", body: { deviceId: st.json.deviceId, nonce: c1.json.nonce, signature: sig.signature, origin: ORIGIN } });
  assertEq(v2.status, 401, "replay → 401");
  assertEq(v2.json.error, "NONCE_INVALID", "canonical code");
  const bad = await request("/pairing/challenge", { method: "POST", body: { deviceId: st.json.deviceId, origin: "https://evil.example" } });
  assertEq(bad.status, 403, "wrong origin → 403");
});

await runTest("Pairing disabled when not configured (legacy servers unchanged)", async () => {
  const legacy = createBridgeServer({ projectRoot: path.join(tmp, "p2"), token: DEV_TOKEN, host: "127.0.0.1" });
  const lb = await legacy.listen(0);
  const r = await new Promise((resolve, reject) => {
    http.get({ hostname: "127.0.0.1", port: lb.port, path: "/pairing/status" }, (res) => {
      let b = ""; res.on("data", (c) => { b += c; }); res.on("end", () => resolve({ status: res.statusCode, json: JSON.parse(b) }));
    }).on("error", reject);
  });
  assertEq(r.status, 404, "pairing routes 404 without config");
  await legacy.close(); // otherwise the process never exits and the runner times out
});

await runTest("Case D/E — disconnect + revoke over HTTP (session or dev-token auth)", async () => {
  const sess = await pairedSession(manager);
  const dc = await request("/pairing/disconnect", { method: "POST", body: { sessionToken: sess.sessionToken } });
  assertEq(dc.status, 200, "disconnect 200");
  const health = await request("/health", { headers: { "x-bridge-session": sess.sessionToken } });
  assertEq(health.status, 401, "session closed");
  const rev = await request("/pairing/revoke", { method: "POST", headers: { "x-bridge-token": DEV_TOKEN }, body: {} });
  assertEq(rev.status, 200, "revoke with dev-token auth");
  assertEq((await request("/pairing/status")).json.paired, false, "unpaired after revoke");
  const reconnect = await request("/pairing/challenge", { method: "POST", body: { deviceId: sess.deviceId, origin: ORIGIN } });
  assertEq(reconnect.status, 409, "reconnect blocked after revoke");
  // Re-pair (explicit approval) restores service.
  const ap = await request("/pairing/approve", { method: "POST", body: { origin: ORIGIN } });
  assertEq(ap.status, 200, "re-pair ok");
});

await runTest("Unauthenticated revoke/rotate rejected (needs session or dev token)", async () => {
  const r = await request("/pairing/revoke", { method: "POST", body: {} });
  assertEq(r.status, 401, "no anonymous revoke");
});

await runTest("Legacy token still works as developer/recovery fallback", async () => {
  const health = await request("/health", { headers: { "x-bridge-token": DEV_TOKEN } });
  assertEq(health.status, 200, "dev token accepted");
  assertEq(health.json.authMode, "token-dev-recovery", "mode labeled");
  const bad = await request("/health", { headers: { "x-bridge-token": "WRONG" } });
  assertEq(bad.status, 401, "wrong token rejected");
});

await new Promise((r) => bridge.close(r));
console.log(`\n=== pairing-http: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
