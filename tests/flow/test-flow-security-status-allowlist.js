"use strict";

/**
 * Regression guards for two code-review findings on the bridge hardening.
 *
 * F3: unauthenticated GET /pairing/status is an ALLOW-list. A field that
 *     pairing.status() gains later must stay private until it is listed in
 *     server.js. A deny-list that only strips deviceId/origin/trustedSince/
 *     rotatedAt would leak it. The test wraps pairing.status() so it returns
 *     extra fields, which makes the check independent of today's status().
 * F1: an explicit origin allowlist whose entries are ALL unusable (typos,
 *     opaque schemes, garbage) must reject every origin. It must never fall
 *     back to the default loopback policy.
 *
 * Real HTTP for the bridge cases: in-process bridge on 127.0.0.1, ephemeral
 * port, in-memory secret store, temp directory. No fixed port, no real token.
 */

const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createBridgeServer } = require("../../flow-companion/bridge/server.js");
const { validateOrigin } = require("../../flow-companion/bridge/security.js");
const { createPairingManager } = require("../../lib/device-pairing/index.js");
const { createSecretStore } = require("../../lib/device-pairing/secret-store.js");

const ORIGIN = "http://127.0.0.1:5173";
const DEV_TOKEN = "TEST-ONLY-DEV-TOKEN";
const LEAK = "SHOULD-STAY-PRIVATE-7f3a";
const PUBLIC_STATUS_KEYS = new Set(["paired", "corrupted", "actionable", "authModes", "contractVersion", "exactOriginRequired"]);

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

function call(port, method, p, headers = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ hostname: "127.0.0.1", port, path: p, method, headers }, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => {
        let json = {};
        try { json = buf ? JSON.parse(buf) : {}; } catch { /* keep {} */ }
        resolve({ status: res.statusCode, json, text: buf });
      });
    });
    r.on("error", reject);
    r.end();
  });
}

async function withBridge({ allowedOrigins = [ORIGIN], wrapStatus = false } = {}, fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qa-auto-status-allow-"));
  const pairing = createPairingManager({
    stateDir: path.join(tmp, "state"),
    secretStore: createSecretStore({ backend: "memory" }),
    allowedOrigins: [ORIGIN],
  });
  if (wrapStatus) {
    const realStatus = pairing.status.bind(pairing);
    pairing.status = () => ({ ...realStatus(), futureSecret: LEAK, internalNote: { detail: LEAK } });
  }
  const bridge = createBridgeServer({ projectRoot: path.join(tmp, "root"), token: DEV_TOKEN, pairing, allowedOrigins });
  const addr = await bridge.listen(0);
  try {
    await fn({ port: addr.port, pairing });
  } finally {
    await bridge.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function main() {
  // ---------------- F1: all-unusable allowlist fails closed ----------------
  await runTest("F1: an allowlist whose entries are all unusable rejects everything (no fallback to the default policy)", async () => {
    const loopback = "http://127.0.0.1:3000";
    assert(validateOrigin(loopback) === true, "control: with no allowlist the default policy accepts a loopback origin");
    assert(validateOrigin(loopback, ["localhost:5173"]) === false, "scheme-less typo entry only: loopback origin rejected");
    assert(validateOrigin("http://localhost:5173", ["localhost:5173"]) === false, "typo entry does not become http://localhost:5173");
    assert(validateOrigin(loopback, ["not a url", "", null, undefined, 42, {}]) === false, "garbage entries only: rejected");
    assert(validateOrigin(loopback, ["null"]) === false, "literal 'null' entry only: rejected");
    assert(validateOrigin("chrome-extension://abc", ["moz-extension://x"]) === false, "opaque-scheme entry only: extension origin rejected");
  });

  await runTest("F1 over HTTP: an all-typo allowlist answers 403 ORIGIN_REJECTED; a valid entry still answers 200", async () => {
    await withBridge({ allowedOrigins: ["localhost:5173"] }, async ({ port }) => {
      const r = await call(port, "GET", "/pairing/status", { Origin: ORIGIN });
      console.log(`  output: status=${r.status} body=${r.text.slice(0, 100)}`);
      assert(r.status === 403 && r.json.error === "ORIGIN_REJECTED", `403 ORIGIN_REJECTED (got ${r.status} ${JSON.stringify(r.json.error)})`);
    });
    await withBridge({ allowedOrigins: [ORIGIN] }, async ({ port }) => {
      const r = await call(port, "GET", "/pairing/status", { Origin: ORIGIN });
      assert(r.status === 200, `control: a valid allowlist entry is accepted (got ${r.status})`);
    });
  });

  // ---------------- F3: status is an allow-list ----------------
  await runTest("F3: a field added to pairing.status() later stays private for an unauthenticated caller (paired)", async () => {
    await withBridge({ wrapStatus: true }, async ({ port, pairing }) => {
      assert(pairing.status().futureSecret === LEAK, "precondition: the wrapped status() really returns the extra field");
      assert(pairing.approve({ origin: ORIGIN }).ok, "setup: device paired");
      const r = await call(port, "GET", "/pairing/status");
      console.log(`  output: status=${r.status} keys=${Object.keys(r.json).join(",")}`);
      assert(r.status === 200, "200");
      const extra = Object.keys(r.json).filter((k) => !PUBLIC_STATUS_KEYS.has(k));
      assert(extra.length === 0, `only public keys (got extra ${JSON.stringify(extra)})`);
      assert(!r.text.includes(LEAK), "the extra field value is not in the body");
    });
  });

  await runTest("F3: the same holds while unpaired", async () => {
    await withBridge({ wrapStatus: true }, async ({ port, pairing }) => {
      assert(pairing.status().futureSecret === LEAK, "precondition: the wrapped status() really returns the extra field");
      const r = await call(port, "GET", "/pairing/status");
      const extra = Object.keys(r.json).filter((k) => !PUBLIC_STATUS_KEYS.has(k));
      assert(r.status === 200 && extra.length === 0, `only public keys (got extra ${JSON.stringify(extra)})`);
      assert(!r.text.includes(LEAK), "the extra field value is not in the body");
    });
  });

  await runTest("F3: an authorized caller (dev token) still receives the full status object", async () => {
    await withBridge({ wrapStatus: true }, async ({ port, pairing }) => {
      const p = pairing.approve({ origin: ORIGIN });
      assert(p.ok, "setup: device paired");
      const r = await call(port, "GET", "/pairing/status", { "x-bridge-token": DEV_TOKEN });
      assert(r.status === 200 && r.json.deviceId === p.deviceId, "deviceId visible with the dev token");
      assert(r.json.futureSecret === LEAK, "the extra field is visible to an authorized caller");
    });
  });

  console.log(`\n=== status-allowlist: ${passed} passed, ${failed} failed ===`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
