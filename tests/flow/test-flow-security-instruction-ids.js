"use strict";

/**
 * m2: POST /instruction/apply and /instruction/evidence take ids from the JSON
 * BODY (instructionVersion, syncId) that become artifact path segments
 * (agent-instructions/<version>.json, instruction-sync/<syncId>.json).
 * Required: syncId matches /^sy-[0-9a-f]{12}$/, instructionVersion passes
 * assertSafeId (or a stricter version pattern), both checked BEFORE the store
 * is called. A spy on the agent-instructions store proves "before".
 * RED until server.js validates them. Well-formed ids must still reach the store.
 */

const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createBridgeServer } = require("../../flow-companion/bridge/server.js");
const { TEST_TOKEN } = require("../../flow-companion/bridge/tests/fixtures.js");
const agentInstructions = require("../../lib/agent-instructions/index.js");

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

function post(port, p, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const r = http.request({ hostname: "127.0.0.1", port, path: p, method: "POST", headers: { "Content-Type": "application/json", "x-bridge-token": TEST_TOKEN } }, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => resolve({ status: res.statusCode, text: buf }));
    });
    r.on("error", reject);
    r.write(data);
    r.end();
  });
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qa-auto-instr-ids-"));
  const root = path.join(tmp, "root");
  fs.mkdirSync(path.join(root, "projects", "legit"), { recursive: true });
  const bridge = createBridgeServer({ projectRoot: root, token: TEST_TOKEN });
  const addr = await bridge.listen(0);
  const port = addr.port;

  const calls = { loadInstructionSet: [], loadSync: [], loadLatest: [] };
  const orig = { loadInstructionSet: agentInstructions.loadInstructionSet, loadSync: agentInstructions.loadSync, loadLatest: agentInstructions.loadLatestInstructionSet };
  agentInstructions.loadLatestInstructionSet = (...a) => { calls.loadLatest.push(a[2]); return orig.loadLatest(...a); };
  agentInstructions.loadInstructionSet = (...a) => { calls.loadInstructionSet.push(a[2]); return orig.loadInstructionSet(...a); };
  agentInstructions.loadSync = (...a) => { calls.loadSync.push(a[2]); return orig.loadSync(...a); };
  const reset = () => { calls.loadInstructionSet.length = 0; calls.loadSync.length = 0; calls.loadLatest.length = 0; };

  const expectRejectedBeforeStore = (r, kind, label) => {
    console.log(`  output: ${label} -> ${r.status} ${r.text.slice(0, 100)} storeCalls=${JSON.stringify(calls[kind])}`);
    assert(r.status === 400, `${label}: 400 (got ${r.status})`);
    assert(/INVALID/.test(r.text), `${label}: error mentions INVALID`);
    assert(calls[kind].length === 0, `${label}: store.${kind} not called`);
  };

  try {
    await runTest("apply rejects unsafe instructionVersion with 400 before touching the store", async () => {
      const bad = ["../../x", "..", "a/b", "a\\b", "iv-abc\n", "a".repeat(129), "-lead", "a b", 123, {}, ["iv-0123456789ab"], true];
      for (const v of bad) {
        reset();
        const r = await post(port, "/instruction/apply?projectId=legit", { providerProjectRef: "ref", instructionVersion: v });
        expectRejectedBeforeStore(r, "loadInstructionSet", `instructionVersion=${JSON.stringify(v)}`);
      }
    });

    await runTest("apply still reaches the store for a well-formed instructionVersion (404 not found)", async () => {
      reset();
      const r = await post(port, "/instruction/apply?projectId=legit", { providerProjectRef: "ref", instructionVersion: "iv-0123456789ab" });
      console.log(`  output: ${r.status} ${r.text.slice(0, 100)}`);
      assert(r.status === 404 && /INSTRUCTION_SET_NOT_FOUND/.test(r.text), `well-formed version: 404 INSTRUCTION_SET_NOT_FOUND (got ${r.status})`);
      assert(calls.loadInstructionSet.length === 1, "store called once for a well-formed version");
      const r128 = await post(port, "/instruction/apply?projectId=legit", { providerProjectRef: "ref", instructionVersion: "v".repeat(128) });
      assert(r128.status === 404, `128-char version passes the id check (got ${r128.status})`);
    });

    await runTest("apply rejects falsy-but-present instructionVersion ('' and 0) with 400 before the store", async () => {
      for (const v of ["", 0]) {
        reset();
        const r = await post(port, "/instruction/apply?projectId=legit", { providerProjectRef: "ref", instructionVersion: v });
        expectRejectedBeforeStore(r, "loadInstructionSet", `instructionVersion=${JSON.stringify(v)}`);
        assert(calls.loadLatest.length === 0, `instructionVersion=${JSON.stringify(v)}: latest-set loader not called either`);
      }
    });

    await runTest("apply loads the latest set when instructionVersion is null or absent", async () => {
      const cases = [["null", { providerProjectRef: "ref", instructionVersion: null }], ["absent", { providerProjectRef: "ref" }]];
      for (const [label, body] of cases) {
        reset();
        const r = await post(port, "/instruction/apply?projectId=legit", body);
        console.log(`  output: ${label} -> ${r.status} ${r.text.slice(0, 100)}`);
        assert(calls.loadLatest.length === 1, `${label}: loadLatestInstructionSet called once`);
        assert(calls.loadInstructionSet.length === 0, `${label}: versioned loader not called`);
        assert(r.status !== 400 || !/INVALID/.test(r.text), `${label}: not rejected as INVALID (got ${r.status})`);
      }
    });

    await runTest("evidence rejects malformed syncId with 400 before touching the store", async () => {
      const bad = ["../x", "../../etc/passwd", "sy-xyz", "sy-0123456789a", "sy-0123456789abc", "SY-0123456789AB", "sy-0123456789AB", "sy-0123456789ab\n", "sy-0123456789ab/..", "x", 123, {}, ["sy-0123456789ab"], true];
      for (const v of bad) {
        reset();
        const r = await post(port, "/instruction/evidence?projectId=legit", { syncId: v });
        expectRejectedBeforeStore(r, "loadSync", `syncId=${JSON.stringify(v)}`);
      }
    });

    await runTest("evidence still reaches the store for a well-formed syncId (404 SYNC_NOT_FOUND)", async () => {
      reset();
      const r = await post(port, "/instruction/evidence?projectId=legit", { syncId: "sy-0123456789ab" });
      console.log(`  output: ${r.status} ${r.text.slice(0, 100)}`);
      assert(r.status === 404 && /SYNC_NOT_FOUND/.test(r.text), `well-formed syncId: 404 SYNC_NOT_FOUND (got ${r.status})`);
      assert(calls.loadSync.length === 1, "store called once for a well-formed syncId");
    });

    await runTest("evidence with missing syncId is 400 SCHEMA_INVALID and never reaches the store", async () => {
      reset();
      const r = await post(port, "/instruction/evidence?projectId=legit", {});
      console.log(`  output: ${r.status} ${r.text.slice(0, 100)}`);
      assert(r.status === 400 && /SCHEMA_INVALID/.test(r.text), `missing syncId: 400 SCHEMA_INVALID (got ${r.status})`);
      assert(calls.loadSync.length === 0, "store not called");
    });
  } finally {
    agentInstructions.loadInstructionSet = orig.loadInstructionSet;
    agentInstructions.loadSync = orig.loadSync;
    agentInstructions.loadLatestInstructionSet = orig.loadLatest;
    await bridge.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`\n=== instruction-ids: ${passed} passed, ${failed} failed ===`);
  process.exit(failed ? 1 : 0);
}

main();
