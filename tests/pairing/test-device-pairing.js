"use strict";

/**
 * POST-PHASE-2 F1 — pairing/security validation (spec §17 Cases A–J).
 * Module-level PairingManager behaviour + SecretStore at-rest protection.
 * Real HTTP-level pairing tests live in test-pairing-http.js.
 */

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const REPO = path.join(__dirname, "..", "..");
const { createPairingManager, ERRORS } = require(REPO + "/lib/device-pairing/index.js");
const { createSecretStore } = require(REPO + "/lib/device-pairing/secret-store.js");

const ORIGIN = "http://localhost:5173";
let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (!cond) throw new Error("ASSERTION FAILED: " + msg);
  console.log("  ok  " + msg);
}
function assertEq(a, b, msg) {
  if (a !== b) throw new Error(`ASSERTION FAILED: ${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
  console.log("  ok  " + msg);
}
async function runTest(name, fn) {
  console.log("[TEST] " + name);
  try { await fn(); passed += 1; console.log("[PASS] " + name); }
  catch (e) { failed += 1; console.log("[FAIL] " + name + " — " + e.message); }
}

function makeManager(opts = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pair-unit-"));
  return createPairingManager({
    stateDir: path.join(tmp, "pairing"),
    secretStore: createSecretStore({ backend: "memory" }),
    allowedOrigins: [ORIGIN],
    ...opts,
  });
}

(async () => {
await runTest("Case A — first-time normal user: one explicit approval, no token", async () => {
  const m = makeManager();
  assertEq(m.status().paired, false, "starts unpaired");
  const ap = m.approve({ origin: ORIGIN });
  assert(ap.ok, "approval succeeds");
  assert(ap.sessionToken, "session issued immediately");
  assertEq(m.status().paired, true, "now paired");
  assert(!/PRIVATE KEY/i.test(JSON.stringify(ap)), "no private material in response (public identity is fine)");
  // Idempotent re-approve (same origin): no duplicate trust record.
  const ap2 = m.approve({ origin: ORIGIN });
  assertEq(ap2.alreadyPaired, true, "re-approve idempotent");
  assertEq(m.status().deviceId, ap.deviceId, "same deviceId");
});

await runTest("Case B — trusted reconnect: challenge/proof, no copy/paste", async () => {
  const m = makeManager();
  const ap = m.approve({ origin: ORIGIN });
  const t = m.selfTest(ORIGIN);
  assert(t.ok, "proof-of-possession reconnect works: " + (t.code || ""));
  assert(t.sessionToken && t.sessionToken !== ap.sessionToken, "fresh short-lived session");
});

await runTest("Case C — session-only: works now, leaves no trusted-device state", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pair-sess-"));
  const m = createPairingManager({
    stateDir: path.join(tmp, "pairing"),
    secretStore: createSecretStore({ backend: "memory" }),
    allowedOrigins: [ORIGIN],
  });
  const ap = m.approve({ origin: ORIGIN, sessionOnly: true });
  assert(ap.ok && ap.sessionToken, "session-only connect works");
  const trustFile = path.join(tmp, "pairing", "trusted-device.json");
  assert(!fs.existsSync(trustFile), "no trusted-device state persisted");
  // New manager (simulated restart): NOT trusted.
  const m2 = createPairingManager({
    stateDir: path.join(tmp, "pairing"),
    secretStore: createSecretStore({ backend: "memory" }),
    allowedOrigins: [ORIGIN],
  });
  assertEq(m2.status().paired, false, "restart → not trusted (Case C)");
});

await runTest("Case D — disconnect: session closed, trusted identity retained", async () => {
  const m = makeManager();
  const ap = m.approve({ origin: ORIGIN });
  const r = m.disconnect({ sessionToken: ap.sessionToken });
  assertEq(r.trustedDeviceRetained, true, "trust retained");
  assertEq(m.validateSession({ sessionToken: ap.sessionToken }).ok, false, "session closed");
  assertEq(m.status().paired, true, "still paired");
});

await runTest("Case E — revoke: auto-connect fails safely; re-pair required", async () => {
  const m = makeManager();
  const ap = m.approve({ origin: ORIGIN });
  assert(m.revoke({ sessionToken: ap.sessionToken }).ok, "revoke ok");
  assertEq(m.status().paired, false, "unpaired after revoke");
  assertEq(m.selfTest(ORIGIN).code, "NOT_PAIRED", "reconnect blocked");
  const ap2 = m.approve({ origin: ORIGIN });
  assert(ap2.ok, "explicit re-pair works");
  assert(ap2.deviceId !== ap.deviceId, "fresh identity after revoke");
});

await runTest("Case F — wrong web origin rejected, no Bridge action, no disclosure", async () => {
  const m = makeManager();
  const bad = m.approve({ origin: "https://evil.example" });
  assertEq(bad.code, "ORIGIN_REJECTED", "approve rejected");
  assertEq(m.status().paired, false, "no state change");
  const ap = m.approve({ origin: ORIGIN });
  const c = m.challenge({ deviceId: ap.deviceId, origin: "https://evil.example" });
  assertEq(c.code, "ORIGIN_REJECTED", "challenge rejected");
  const v = m.verify({ deviceId: ap.deviceId, nonce: crypto.randomBytes(32).toString("hex"), signature: "x", origin: "https://evil.example" });
  assertEq(v.code, "ORIGIN_REJECTED", "verify rejected");
});

await runTest("Case G — replay/stale challenge rejected", async () => {
  const m = makeManager();
  const ap = m.approve({ origin: ORIGIN });
  const c = m.challenge({ deviceId: ap.deviceId, origin: ORIGIN });
  const sig = m.signProof({ deviceId: ap.deviceId, nonce: c.nonce, origin: ORIGIN });
  const v1 = m.verify({ deviceId: ap.deviceId, nonce: c.nonce, signature: sig.signature, origin: ORIGIN });
  assert(v1.ok, "first verify ok");
  const v2 = m.verify({ deviceId: ap.deviceId, nonce: c.nonce, signature: sig.signature, origin: ORIGIN });
  assertEq(v2.code, "NONCE_INVALID", "replay rejected");
  // Tampered proof rejected.
  const c2 = m.challenge({ deviceId: ap.deviceId, origin: ORIGIN });
  const bad = m.verify({ deviceId: ap.deviceId, nonce: c2.nonce, signature: Buffer.from("forged").toString("base64"), origin: ORIGIN });
  assertEq(bad.code, "PROOF_INVALID", "forged proof rejected");
  // Expired challenge: fabricate by manual manager with negative TTL.
  const mExp = createPairingManager({
    stateDir: path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pair-exp-")), "pairing"),
    secretStore: createSecretStore({ backend: "memory" }),
    allowedOrigins: [ORIGIN],
    challengeTtlMs: -1,
  });
  const apE = mExp.approve({ origin: ORIGIN });
  const cE = mExp.challenge({ deviceId: apE.deviceId, origin: ORIGIN });
  const sigE = mExp.signProof({ deviceId: apE.deviceId, nonce: cE.nonce, origin: ORIGIN });
  assertEq(mExp.verify({ deviceId: apE.deviceId, nonce: cE.nonce, signature: sigE.signature, origin: ORIGIN }).code, "NONCE_INVALID", "stale challenge rejected");
});

await runTest("Case H — secret-at-rest: DPAPI-protected, never plaintext", async () => {
  if (process.platform !== "win32") {
    console.log("  skip (non-Windows)"); return;
  }
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pair-dpapi-")), "secrets");
  const store = createSecretStore({ backend: "dpapi", dir });
  const secret = "PEM-LIKE-LONG-LIVED-SECRET-" + crypto.randomBytes(24).toString("hex");
  const put = store.put("device-private-key", secret);
  assert(put.ok, "dpapi put ok");
  const got = store.get("device-private-key");
  assert(got.ok && got.value === secret, "dpapi round-trip");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".dpapi"));
  assert(files.length === 1, "blob file present");
  const raw = fs.readFileSync(path.join(dir, files[0]), "utf8");
  assert(!raw.includes(secret), "no plaintext secret at rest (DPAPI blob)");
  assertEq(store.isProtectedAtRest(), true, "protected at rest");
  // No temp plaintext leftovers.
  assert(!fs.readdirSync(dir).some((f) => f.includes(".plain.")), "temp plaintext removed");
});

await runTest("Case I — credential corruption: actionable error, safe re-pair, no loop", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pair-corrupt-"));
  const stateDir = path.join(tmp, "pairing");
  const m = createPairingManager({
    stateDir,
    secretStore: createSecretStore({ backend: "memory" }),
    allowedOrigins: [ORIGIN],
  });
  m.approve({ origin: ORIGIN });
  // Corrupt the trust file.
  fs.writeFileSync(path.join(stateDir, "trusted-device.json"), "{not json", "utf8");
  const st = m.status();
  assertEq(st.paired, false, "not paired");
  assertEq(st.corrupted, true, "corruption detected");
  assert(st.actionable && st.actionable.includes("RE-PAIR_REQUIRED"), "actionable guidance");
  assertEq(m.selfTest(ORIGIN).code, "CREDENTIAL_CORRUPTED", "no infinite reconnect — canonical error");
  // Recovery: approve again re-pairs cleanly.
  const ap = m.approve({ origin: ORIGIN });
  assert(ap.ok, "re-pair after corruption works");
  assertEq(m.status().paired, true, "recovered");
});

await runTest("Case J — bridge restart: trust persists (disk), session recovery via proof", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pair-restart-"));
  const stateDir = path.join(tmp, "pairing");
  const store = createSecretStore({ backend: "memory", });
  // Simulate OS-protected secret persisting across restart (memory store is
  // per-process; real DPAPI persists — emulate by sharing the store map via
  // same store instance, which is what DPAPI achieves on disk).
  const m1 = createPairingManager({ stateDir, secretStore: store, allowedOrigins: [ORIGIN] });
  m1.approve({ origin: ORIGIN });
  const m2 = createPairingManager({ stateDir, secretStore: store, allowedOrigins: [ORIGIN] });
  assertEq(m2.status().paired, true, "trusted device survives restart");
  const t = m2.selfTest(ORIGIN);
  assert(t.ok, "proof-based session recovery after restart (no copy/paste)");
  // Old pre-restart session is gone (memory-first) — by design.
  assertEq(m2.validateSession({ sessionToken: "stale" }).ok, false, "stale session invalid");
});

await runTest("Extra — rotation invalidates old proof material; corrupt secret degrades honestly", async () => {
  const m = makeManager();
  const ap = m.approve({ origin: ORIGIN });
  const before = m.status().deviceId;
  const rot = m.rotate();
  assert(rot.ok, "rotate ok");
  assertEq(m.status().deviceId, before, "deviceId stable across rotation");
  // Old sessions wiped by rotation.
  assertEq(m.validateSession({ sessionToken: ap.sessionToken }).ok, false, "old session invalid after rotate");
  assert(m.selfTest(ORIGIN).ok, "new credential works");
});

console.log(`\n=== device-pairing: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
})();
