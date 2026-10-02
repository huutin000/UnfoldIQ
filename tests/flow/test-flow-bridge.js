"use strict";

/**
 * Flow Companion bridge security tests (STEP 10B): BR1–BR10.
 * Real HTTP against a loopback-only ephemeral port. No external network.
 */

const http = require("http");
const path = require("path");
const fs = require("fs");

const REPO_ROOT = path.join(__dirname, "..", "..");
const TEST_PROJECT = "__flow10b_br__";
const TOKEN = "TEST-ONLY-BRIDGE-TOKEN";

const { createBridgeServer } = require("../../flow-companion/bridge/server.js");
const { assertLoopbackBind } = require("../../flow-companion/bridge/security.js");

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

function logOut(label, obj) {
  console.log(`  output: ${label} = ${JSON.stringify(obj)}`);
}

let base = null;
function req(method, p, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(
      { hostname: "127.0.0.1", port: base.port, path: p, method, headers: { "Content-Type": "application/json", "x-bridge-token": TOKEN, ...headers } },
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

async function main() {
  const bridge = createBridgeServer({ projectRoot: REPO_ROOT, token: TOKEN });
  base = await bridge.listen(0);
  console.log("=== FLOW BRIDGE TESTS (BR1-BR10) ===\n");

  // BR1 — health works.
  await runTest("BR1 Health endpoint works", async () => {
    const r = await req("GET", "/health");
    logOut("health", r.body);
    assert(r.status === 200 && r.body.ok === true, "health must return ok");
  });

  // BR2 — valid localhost request accepted.
  await runTest("BR2 Valid localhost request accepted", async () => {
    const r = await req("GET", "/capabilities");
    logOut("capabilities", r.body);
    assert(r.status === 200 && (r.body.capabilities || []).includes("video"), "capabilities must list video");
  });

  // BR3 — non-loopback/public binding disabled by default.
  await runTest("BR3 Public binding disabled", async () => {
    let code = null;
    try {
      assertLoopbackBind("0.0.0.0");
    } catch (e) {
      code = e.message;
    }
    logOut("rejection", code);
    assert(code && /BIND_REJECTED/.test(code), "0.0.0.0 binding must be rejected");
    assert(bridge.host === "127.0.0.1", "server must bind loopback");
  });

  // BR4 — unknown origin rejected when applicable.
  await runTest("BR4 Unknown origin rejected", async () => {
    const r = await req("GET", "/health", null, { origin: "https://evil.example/" });
    logOut("status", r.status);
    assert(r.status === 403, "foreign origin must be rejected");
  });

  // BR5 — schema-invalid payload rejected.
  await runTest("BR5 Invalid payload rejected", async () => {
    const r = await req("POST", "/jobs", { nonsense: 1 });
    logOut("response", { status: r.status, body: r.body });
    assert(r.status === 400, "payload missing projectId/job must be rejected");
  });

  // BR6 — traversal output path rejected.
  await runTest("BR6 Traversal path rejected", async () => {
    const created = await req("POST", "/jobs", {
      projectId: TEST_PROJECT,
      job: { projectId: TEST_PROJECT, jobId: "BR6-JOB", requestId: "R", sceneId: "S", capability: "image", mode: "ASSISTED_APPROVAL", prompt: "x", platform: "youtube", flowProject: { mode: "REUSE" }, outputRequirements: {}, creativeContext: {}, expectedOutputPath: "x", attempt: 1 },
    });
    assert(created.status === 201, "job setup must succeed");
    const r = await req("POST", "/jobs/BR6-JOB/result?projectId=" + TEST_PROJECT, { artifactRelativePath: "../../evil.png" });
    logOut("response", { status: r.status, body: r.body });
    assert(r.status === 400, "traversal artifact path must be rejected");
  });

  // BR7 — arbitrary filesystem path rejected.
  await runTest("BR7 Arbitrary filesystem path rejected", async () => {
    const r = await req("POST", "/jobs/BR6-JOB/result?projectId=" + TEST_PROJECT, { artifactRelativePath: "D:/Windows/Temp/evil.png" });
    // On Windows this resolves outside the project → must not be accepted blindly.
    logOut("response", { status: r.status, body: r.body });
    assert(r.status !== 200 || r.body.status !== "READY", "absolute/arbitrary path must never become READY");
  });

  // BR8 — arbitrary command execution impossible.
  await runTest("BR8 No command execution surface", async () => {
    for (const p of ["/exec", "/shell", "/write-anywhere"]) {
      const r = await req("POST", p, { cmd: "whoami" });
      assert(r.status === 404, `${p} must not exist`);
    }
    logOut("routes", "no exec/shell/write-anywhere routes");
  });

  // BR9 — credential-like payload rejected/stripped.
  await runTest("BR9 Credential payload rejected", async () => {
    const r = await req("POST", "/jobs", {
      projectId: TEST_PROJECT,
      job: { projectId: TEST_PROJECT, jobId: "BR9-JOB", requestId: "R", sceneId: "S", capability: "image", mode: "ASSISTED_APPROVAL", prompt: "x", platform: "youtube", flowProject: { mode: "REUSE" }, outputRequirements: {}, creativeContext: {}, expectedOutputPath: "x", attempt: 1, apiKey: "sk-should-never-persist" },
    });
    logOut("response", { status: r.status, body: r.body });
    assert(r.status === 400, "credential-bearing job payload must be rejected");
  });

  // BR10 — result imports only into matching project/job.
  await runTest("BR10 Result confined to matching job", async () => {
    const rel = "assets/image/S01/delivered.png";
    const abs = `${REPO_ROOT}/projects/${TEST_PROJECT}/${rel}`;
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, Buffer.from("TEST-ONLY"));
    const okJob = await req("POST", "/jobs/BR6-JOB/result?projectId=" + TEST_PROJECT, { artifactRelativePath: rel });
    logOut("matching", { status: okJob.status, body: okJob.body });
    assert(okJob.status === 200, "matching project/job result must be accepted");
    const mismatch = await req("POST", "/jobs/BR6-JOB/result?projectId=OTHER_PROJECT", { artifactRelativePath: rel });
    logOut("mismatch", { status: mismatch.status, body: mismatch.body });
    assert(mismatch.status !== 200, "cross-project result must be rejected");
  });

  // BR11 — POST-v1F false-GENERATING guard: an approval is NOT a generation.
  await runTest("BR11 Approval alone never starts a generation", async () => {
    const created = await req("POST", "/jobs", {
      projectId: TEST_PROJECT,
      job: { projectId: TEST_PROJECT, jobId: "BR11-JOB", requestId: "R", sceneId: "S", capability: "image", mode: "ASSISTED_APPROVAL", prompt: "x", platform: "youtube", flowProject: { mode: "REUSE" }, outputRequirements: {}, creativeContext: {}, expectedOutputPath: "x", attempt: 1 },
    });
    assert(created.status === 201, "job setup must succeed");
    // PENDING → VALIDATED → PREPARED → AWAITING_USER_APPROVAL (preparation is
    // the extension's job, not a bridge route)
    const store = require("../../flow-companion/bridge/job-store");
    store.transitionJob(REPO_ROOT, TEST_PROJECT, "BR11-JOB", "VALIDATED", {});
    store.transitionJob(REPO_ROOT, TEST_PROJECT, "BR11-JOB", "PREPARED", {});
    await req("POST", "/jobs/BR11-JOB/await-approval?projectId=" + TEST_PROJECT, {});
    const ap = await req("POST", "/jobs/BR11-JOB/approve?projectId=" + TEST_PROJECT, { jobId: "BR11-JOB", attempt: 1, approvedBy: "user" });
    logOut("approve", ap.body);
    assert(ap.status === 200 && ap.body.status === "AWAITING_USER_APPROVAL", "approve must not enter GENERATING");
    assert(ap.body.approvalRecorded === true, "approval is recorded");
    const job = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "projects", TEST_PROJECT, "flow-jobs", "BR11-JOB.json"), "utf8"));
    assert(job.status === "AWAITING_USER_APPROVAL", `persisted status: ${job.status}`);
    assert(job.generationCount === 0, `generationCount must stay 0: ${job.generationCount}`);
    assert(job.approval && job.approval.used === false, "approval recorded and still unused");
    // /generate without an approval must be refused by the state machine
    const noAp = await req("POST", "/jobs/BR11-JOB/generate?projectId=" + TEST_PROJECT, {});
    assert(noAp.status === 200, "generate allowed once an approval exists");
    const again = await req("POST", "/jobs/BR11-JOB/generate?projectId=" + TEST_PROJECT, {});
    logOut("idempotent", again.body);
    assert(again.status === 200 && again.body.status === "GENERATING", "generate is idempotent while GENERATING");
    const after = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "projects", TEST_PROJECT, "flow-jobs", "BR11-JOB.json"), "utf8"));
    assert(after.generationCount === 1, `exactly one generation counted: ${after.generationCount}`);
    assert(after.approval.used === true, "approval consumed by the real generation");
  });

  // BR12 — approve is refused from a state that cannot be approved.
  await runTest("BR12 Approve refused outside AWAITING_USER_APPROVAL", async () => {
    const created = await req("POST", "/jobs", {
      projectId: TEST_PROJECT,
      job: { projectId: TEST_PROJECT, jobId: "BR12-JOB", requestId: "R", sceneId: "S", capability: "image", mode: "ASSISTED_APPROVAL", prompt: "x", platform: "youtube", flowProject: { mode: "REUSE" }, outputRequirements: {}, creativeContext: {}, expectedOutputPath: "x", attempt: 1 },
    });
    assert(created.status === 201, "job setup must succeed");
    const r = await req("POST", "/jobs/BR12-JOB/approve?projectId=" + TEST_PROJECT, { jobId: "BR12-JOB", attempt: 1, approvedBy: "user" });
    logOut("response", { status: r.status, body: r.body });
    assert(r.status === 400, "approving a PENDING job must be refused");
    const g = await req("POST", "/jobs/BR12-JOB/generate?projectId=" + TEST_PROJECT, {});
    logOut("generate", { status: g.status, body: g.body });
    assert(g.status >= 400, "generating without an approval must be refused");
  });

  await bridge.close();
  fs.rmSync(path.join(REPO_ROOT, "projects", TEST_PROJECT), { recursive: true, force: true });
  console.log(`\n=== SUMMARY ===`);
  console.log(`Passed assertions: ${passed}, Failed tests: ${failed}`);
  if (failed > 0) {
    console.log("RESULT: SOME TESTS FAILED");
    process.exit(1);
  }
  console.log("RESULT: ALL TESTS PASSED");
}

main().catch((e) => {
  console.log(`FATAL: ${e.stack || e.message}`);
  process.exit(1);
});
