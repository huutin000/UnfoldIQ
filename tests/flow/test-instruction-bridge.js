"use strict";

/**
 * Phase 1G.9 FIX 02 — instruction bridge routes (§§15–19).
 * Real HTTP against a loopback-only ephemeral port. No external network,
 * no browser, no generation, 0 credits.
 * Uses the real canonical pilot-sky-blue set from disk; created sync
 * records + test bindings are deleted after the run (finally block).
 */

const http = require("http");
const path = require("path");
const fs = require("fs");

const REPO_ROOT = path.join(__dirname, "..", "..");
const PROJECT = "pilot-sky-blue";
const TOKEN = "TEST-ONLY-BRIDGE-TOKEN";

const { createBridgeServer } = require("../../flow-companion/bridge/server.js");
const agentInstructions = require("../../lib/agent-instructions/index.js");

let passed = 0;
let failed = 0;

function assert(c, m) {
  if (!c) throw new Error(`ASSERTION FAILED: ${m}`);
  console.log(`  ✓ ${m}`);
  passed++;
}

function runTest(name, fn) {
  console.log(`\n[TEST] ${name}`);
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`[PASS] ${name}`))
    .catch((e) => {
      console.log(`[FAIL] ${name}: ${e.message}`);
      failed++;
    });
}

let base = null;
function req(method, p, body = null, token = TOKEN) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(
      { hostname: "127.0.0.1", port: base.port, path: p, method, headers: { "Content-Type": "application/json", "x-bridge-token": token } },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          let parsed = null;
          try {
            parsed = buf ? JSON.parse(buf) : null;
          } catch {
            parsed = buf;
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

const createdSyncIds = [];
let bindingCreated = false;
function trackSync(id) {
  if (id) createdSyncIds.push(id);
}
function cleanup() {
  for (const id of createdSyncIds) {
    try {
      fs.rmSync(path.join(REPO_ROOT, "projects", PROJECT, "instruction-sync", `${id}.json`), { force: true });
    } catch { /* best-effort */ }
  }
  if (bindingCreated) {
    try {
      fs.rmSync(path.join(REPO_ROOT, "projects", PROJECT, "flow-project-binding.json"), { force: true });
    } catch { /* best-effort */ }
  }
}

async function main() {
  const bridge = createBridgeServer({ projectRoot: REPO_ROOT, token: TOKEN });
  base = await bridge.listen(0);
  console.log("=== FIX 02 INSTRUCTION BRIDGE TESTS ===\n");

  try {
    await runTest("IR1 apply requires projectId", async () => {
      const r = await req("POST", "/instruction/apply", { providerProjectRef: "x" });
      assert(r.status === 400, "missing projectId query rejected");
    });

    await runTest("IR2 forbidden payload rejected", async () => {
      const r = await req("POST", `/instruction/apply?projectId=${PROJECT}`, { providerProjectRef: "x", defaultModel: "evil" });
      assert(r.status === 400 && /FORBIDDEN_INSTRUCTION_PAYLOAD/.test(r.body.error), "settings payload refused");
    });

    await runTest("IR3 unknown instruction version → 404", async () => {
      const r = await req("POST", `/instruction/apply?projectId=${PROJECT}`, { providerProjectRef: "x", instructionVersion: "iv-does-not-exist" });
      assert(r.status === 404 && r.body.error === "INSTRUCTION_SET_NOT_FOUND", "missing set reported");
    });

    let canonicalText = null;
    let syncId = null;
    await runTest("IR4 valid intent registers sync record", async () => {
      const r = await req("POST", `/instruction/apply?projectId=${PROJECT}`, { providerProjectRef: "proj-live-1" });
      assert(r.status === 201, `intent accepted (got ${r.status})`);
      assert(r.body.applyAttemptId && r.body.syncStatus === "DRAFT", "attempt id + DRAFT status");
      assert(typeof r.body.compiledText === "string" && r.body.compiledText.includes("PROJECT INVARIANTS"), "canonical text served from disk");
      assert(r.body.bindingState === "UNBOUND_FIRST_RUN", "first run without binding flagged honestly");
      assert(Array.isArray(r.body.referenceBindings), "bindings echoed");
      trackSync(r.body.syncId);
      canonicalText = r.body.compiledText;
      syncId = r.body.syncId;
    });

    await runTest("IR5 binding mismatch blocked, match allowed", async () => {
      const s = agentInstructions.saveProjectBinding(REPO_ROOT, { projectId: PROJECT, provider: "GOOGLE_FLOW", providerProjectRef: "proj-bound", verifiedAt: "t" });
      assert(s.ok === true, "binding saved");
      bindingCreated = true;
      const bad = await req("POST", `/instruction/apply?projectId=${PROJECT}`, { providerProjectRef: "proj-other" });
      assert(bad.status === 400 && /BLOCKED_PROJECT_MISMATCH/.test(bad.body.error), "mismatched ref refused");
      const good = await req("POST", `/instruction/apply?projectId=${PROJECT}`, { providerProjectRef: "proj-bound" });
      assert(good.status === 201 && good.body.bindingState === "BOUND", "bound ref proceeds");
      trackSync(good.body.syncId);
    });

    await runTest("IR6 evidence on unknown sync → 404", async () => {
      const r = await req("POST", `/instruction/evidence?projectId=${PROJECT}`, { syncId: "sy-nope" });
      assert(r.status === 404 && r.body.error === "SYNC_NOT_FOUND", "unknown sync reported");
    });

    await runTest("IR7 apply-only evidence → READBACK_PENDING", async () => {
      const r = await req("POST", `/instruction/evidence?projectId=${PROJECT}`, {
        syncId,
        applyResult: { applyAttemptId: syncId, status: "APPLIED", appliedAt: "2026-10-03T00:00:00.000Z" },
      });
      assert(r.status === 200 && r.body.syncStatus === "READBACK_PENDING", `apply alone never verifies (got ${r.body.syncStatus})`);
    });

    await runTest("IR8 exact readback → VERIFIED", async () => {
      const r = await req("POST", `/instruction/evidence?projectId=${PROJECT}`, {
        syncId,
        readback: { visibleGuidelines: canonicalText, providerReferences: [], readbackAt: "2026-10-03T00:00:01.000Z" },
      });
      assert(r.status === 200 && r.body.syncStatus === "VERIFIED", `match verifies (got ${r.body.syncStatus})`);
      assert(r.body.semanticCompareStatus === "MATCH", "compare status MATCH");
      assert(typeof r.body.verifiedAt === "string", "verifiedAt stamped server-side");
    });

    await runTest("IR9 drifted readback → DRIFT, never VERIFIED", async () => {
      const reg = await req("POST", `/instruction/apply?projectId=${PROJECT}`, { providerProjectRef: "proj-bound" });
      trackSync(reg.body.syncId);
      await req("POST", `/instruction/evidence?projectId=${PROJECT}`, {
        syncId: reg.body.syncId,
        applyResult: { applyAttemptId: reg.body.syncId, status: "APPLIED", appliedAt: "2026-10-03T00:00:02.000Z" },
      });
      const drifted = canonicalText.split("\n").slice(1).join("\n");
      const r = await req("POST", `/instruction/evidence?projectId=${PROJECT}`, {
        syncId: reg.body.syncId,
        readback: { visibleGuidelines: drifted, providerReferences: [], readbackAt: "2026-10-03T00:00:03.000Z" },
      });
      assert(r.body.syncStatus === "DRIFT", `drift recorded (got ${r.body.syncStatus})`);
      assert((r.body.differences || []).length > 0, "differences persisted, not swallowed");
    });

    await runTest("IR10 wrong bridge token → 401", async () => {
      const r = await req("POST", `/instruction/apply?projectId=${PROJECT}`, { providerProjectRef: "x" }, "WRONG");
      assert(r.status === 401, "token gate holds on new routes");
    });
  } finally {
    cleanup();
  }

  console.log(`\n=== FIX 02 instruction-bridge: ${passed} passed, ${failed} failed ===`);
  try {
    await bridge.close();
  } catch { /* best-effort */ }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  cleanup();
  console.log(`FATAL: ${e.stack || e.message}`);
  process.exit(1);
});
