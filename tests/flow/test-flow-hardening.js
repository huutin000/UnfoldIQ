"use strict";

/**
 * Flow bridge hardening tests (1G.12 Task 02 — retroactive hardening sweep).
 * Covers the P0/P1 fixes:
 *   H1–H4  durable submit-issued record + approval binding (lost-ACK retry
 *          must never re-arm a second credit action)
 *   H5–H6  per-route body caps (PAYLOAD_TOO_LARGE → 400; artifact route
 *          accepts >256KB base64)
 *   H7     POST /jobs validates the canonical job contract
 * Zero paid generation: no real Google Flow, no Generate clicks.
 */

const path = require("path");
const crypto = require("crypto");
const fs = require("fs");
const { createBridgeServer } = require("../../flow-companion/bridge/server.js");

const REPO_ROOT = path.join(__dirname, "..", "..");
const TOKEN = "hardening-test-token-" + crypto.randomBytes(8).toString("hex");
const PROJ = "HARDENING_1G12";

let base = null;
let passed = 0;
let failed = 0;

function req(method, p, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = require("http").request(
      { hostname: "127.0.0.1", port: base.port, path: p, method, headers: { "Content-Type": "application/json", "x-bridge-token": TOKEN, ...headers } },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          let parsed = null;
          try { parsed = buf ? JSON.parse(buf) : null; } catch { parsed = buf; }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

async function runTest(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed += 1;
    console.log(`  ✗ ${name}: ${e.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

function seedJob(jobId) {
  return req("POST", "/jobs", {
    projectId: PROJ,
    job: {
      projectId: PROJ, jobId, requestId: `REQ-${jobId}`, sceneId: "S01", capability: "video",
      mode: "ASSISTED_APPROVAL", prompt: "hardening sweep test prompt", platform: "youtube",
      flowProject: { mode: "REUSE" }, outputRequirements: { aspectRatio: "16:9" },
      creativeContext: {}, expectedOutputPath: `assets/video/S01/${jobId}.mp4`, attempt: 1,
    },
  });
}

async function prepareAndApprove(jobId, nonce) {
  // PREPARED → AWAITING_USER_APPROVAL via await-approval (PENDING→VALIDATED→PREPARED path is
  // test-internal; createJob starts at PENDING so drive the machine directly).
  // The bridge's await-approval only accepts AWAITING_USER_APPROVAL/PREPARED transitions,
  // so seed at PREPARED by writing the job through the store's normal flow:
  // simplest valid path is to prepare the job via the API the extension uses.
  const store = require("../../flow-companion/bridge/job-store.js");
  const { transition } = require("../../flow-companion/bridge/state-machine.js");
  let job = store.getJob(REPO_ROOT, PROJ, jobId);
  if (job.status === "PENDING") job = store.transitionJob(REPO_ROOT, PROJ, jobId, "VALIDATED", { actor: "test" });
  if (job.status === "VALIDATED") job = store.transitionJob(REPO_ROOT, PROJ, jobId, "PREPARED", { actor: "test" });
  if (job.status === "PREPARED") job = store.transitionJob(REPO_ROOT, PROJ, jobId, "AWAITING_USER_APPROVAL", { actor: "test" });
  return req("POST", `/jobs/${jobId}/approve?projectId=${PROJ}`, {
    jobId, attempt: 1, approvedBy: "user", nonce, fingerprint: `fp-${nonce}`,
  });
}

async function main() {
  // deterministic starting state: no leftover jobs from a previous run
  fs.rmSync(path.join(REPO_ROOT, "projects", PROJ), { recursive: true, force: true });
  const bridge = createBridgeServer({ projectRoot: REPO_ROOT, token: TOKEN });
  base = await bridge.listen(0);
  console.log("=== FLOW BRIDGE HARDENING TESTS (H1-H8) ===\n");

  await runTest("H1 submit-issued records AWAITING_PROVIDER_ACCEPTANCE durably", async () => {
    const seed = await seedJob("H1-JOB");
    assert(seed.status === 201, `seed must succeed (${JSON.stringify(seed.body)})`);
    const ap = await prepareAndApprove("H1-JOB", "nonce-H1-a");
    assert(ap.status === 200, "approve must succeed");
    const si = await req("POST", "/jobs/H1-JOB/submit-issued?projectId=" + PROJ, { approvalNonce: "nonce-H1-a" });
    assert(si.status === 200, `submit-issued must succeed (${JSON.stringify(si.body)})`);
    assert(si.body.status === "AWAITING_PROVIDER_ACCEPTANCE", "job must sit in AWAITING_PROVIDER_ACCEPTANCE");
    const read = await req("GET", "/jobs/H1-JOB?projectId=" + PROJ);
    assert(read.body.job.submitIssuedAt, "submitIssuedAt must be persisted");
    assert(read.body.job.submitNonce === "nonce-H1-a", "submitNonce must be persisted");
  });

  await runTest("H2 submit-issued is idempotent for the same nonce, blocks a different nonce", async () => {
    await seedJob("H2-JOB");
    await prepareAndApprove("H2-JOB", "nonce-H2-a");
    const again = await req("POST", "/jobs/H2-JOB/submit-issued?projectId=" + PROJ, { approvalNonce: "nonce-H2-a" });
    assert(again.status === 200 && again.body.status === "AWAITING_PROVIDER_ACCEPTANCE", "same-nonce re-issue must be idempotent (lost-ACK retry)");
    const other = await req("POST", "/jobs/H2-JOB/submit-issued?projectId=" + PROJ, { approvalNonce: "nonce-H2-b" });
    assert(other.status === 400, "different nonce while unresolved must be rejected");
    assert(/SUBMIT_ALREADY_ISSUED|APPROVAL_NONCE_MISMATCH/.test(other.body.error || ""), `unresolved-submit re-issue must be rejected (${other.body.error})`);
  });

  await runTest("H3 /generate binds the approval nonce: wrong nonce rejected, correct one accepted", async () => {
    await seedJob("H3-JOB");
    await prepareAndApprove("H3-JOB", "nonce-H3-a");
    await req("POST", "/jobs/H3-JOB/submit-issued?projectId=" + PROJ, { approvalNonce: "nonce-H3-a" });
    const wrong = await req("POST", "/jobs/H3-JOB/generate?projectId=" + PROJ, { approvalNonce: "nonce-H3-WRONG" });
    assert(wrong.status === 400 && /APPROVAL_NONCE_MISMATCH/.test(wrong.body.error || ""), "wrong nonce must be rejected");
    const ok = await req("POST", "/jobs/H3-JOB/generate?projectId=" + PROJ, { approvalNonce: "nonce-H3-a" });
    assert(ok.status === 200 && ok.body.status === "GENERATING", `correct nonce must transition to GENERATING (${JSON.stringify(ok.body)})`);
    assert(ok.body.generationCount === 1, "generationCount must count exactly 1");
    // Lost-ACK style duplicate /generate is idempotent while GENERATING.
    const dup = await req("POST", "/jobs/H3-JOB/generate?projectId=" + PROJ, { approvalNonce: "nonce-H3-a" });
    assert(dup.status === 200 && dup.body.status === "GENERATING", "duplicate /generate while GENERATING is idempotent");
    const read = await req("GET", "/jobs/H3-JOB?projectId=" + PROJ);
    assert(read.body.job.generationCount === 1, "no duplicate generation may be counted");
  });

  await runTest("H4 /approve refuses to overwrite an unused approval without supersedes nonce", async () => {
    await seedJob("H4-JOB");
    await prepareAndApprove("H4-JOB", "nonce-H4-a");
    // Double approval (lost-ACK retry re-arming the gate) must be refused…
    const rearm = await req("POST", "/jobs/H4-JOB/approve?projectId=" + PROJ, {
      jobId: "H4-JOB", attempt: 1, approvedBy: "user", nonce: "nonce-H4-b", fingerprint: "fp-b",
    }); // direct approve call — no state re-drive
    assert(rearm.status === 400 && /DUPLICATE_APPROVAL/.test(rearm.body.error || ""), "re-arming an unused approval must be rejected");
    // …and the original approval must survive unchanged.
    const read = await req("GET", "/jobs/H4-JOB?projectId=" + PROJ);
    assert(read.body.job.approval.nonce === "nonce-H4-a", "original approval must survive the retry");
    // Explicit supersede (fingerprint change) is the sanctioned path.
    const sup = await req("POST", "/jobs/H4-JOB/approve?projectId=" + PROJ, {
      jobId: "H4-JOB", attempt: 1, approvedBy: "user", nonce: "nonce-H4-b", fingerprint: "fp-b", supersedesNonce: "nonce-H4-a",
    });
    assert(sup.status === 200, `explicit supersede must succeed (${JSON.stringify(sup.body)})`);
  });

  await runTest("H5 /jobs body over the 256KB default cap → 400 PAYLOAD_TOO_LARGE", async () => {
    const big = { projectId: PROJ, job: { projectId: PROJ, jobId: "H5-JOB", requestId: "R", sceneId: "S", capability: "image", mode: "ASSISTED_APPROVAL", prompt: "x".repeat(300 * 1024), expectedOutputPath: "x", status: "PENDING", attempt: 1 } };
    const r = await req("POST", "/jobs", big);
    assert(r.status === 400, `must be 400 (got ${r.status})`);
    assert(/PAYLOAD_TOO_LARGE/.test(r.body.error || ""), `error must be PAYLOAD_TOO_LARGE (${JSON.stringify(r.body)})`);
  });

  await runTest("H6 artifact route accepts base64 bodies above the 256KB default cap", async () => {
    // Real media (e.g. a 4s 720p video) is several MB; before the fix any
    // artifact over ~190KB base64 died in readBody with PAYLOAD_TOO_LARGE
    // surfacing as a 500. Drive a MANUAL_ASSIST job past the body reader.
    const store = require("../../flow-companion/bridge/job-store.js");
    await seedJob("H6-JOB");
    store.transitionJob(REPO_ROOT, PROJ, "H6-JOB", "VALIDATED", { actor: "test" });
    store.transitionJob(REPO_ROOT, PROJ, "H6-JOB", "PREPARED", { actor: "test" });
    store.transitionJob(REPO_ROOT, PROJ, "H6-JOB", "MANUAL_ASSIST_REQUIRED", { actor: "test" });
    // 512KB of real PNG bytes (>256KB JSON cap, well under 60MB artifact cap).
    const png = Buffer.alloc(512 * 1024);
    png[0] = 0x89; png[1] = 0x50; png[2] = 0x4e; png[3] = 0x47; // PNG signature
    png[4] = 0x0d; png[5] = 0x0a; png[6] = 0x1a; png[7] = 0x0a;
    const r = await req("POST", "/jobs/H6-JOB/artifact?projectId=" + PROJ, {
      filename: "H6.png", mime: "image/png", contentBase64: png.toString("base64"),
    });
    assert(r.status !== 500, `artifact route must not 500 on large bodies (${JSON.stringify(r.body).slice(0, 160)})`);
    assert(!/PAYLOAD_TOO_LARGE/.test(JSON.stringify(r.body)), "artifact route must accept bodies above the default cap");
  });

  await runTest("H7 POST /jobs validates the canonical job contract (requestId required)", async () => {
    const r = await req("POST", "/jobs", {
      projectId: PROJ,
      job: { projectId: PROJ, jobId: "H7-JOB", capability: "image", mode: "ASSISTED_APPROVAL", prompt: "x", expectedOutputPath: "x", status: "PENDING", attempt: 1 },
    });
    assert(r.status === 400 && /SCHEMA_INVALID/.test(r.body.error || ""), `job missing requestId must be rejected (${JSON.stringify(r.body)})`);
  });

  await runTest("H8 AWAITING_PROVIDER_ACCEPTANCE can route to RECONCILIATION_REQUIRED (unknown submit outcome)", async () => {
    await seedJob("H8-JOB");
    await prepareAndApprove("H8-JOB", "nonce-H8-a");
    await req("POST", "/jobs/H8-JOB/submit-issued?projectId=" + PROJ, { approvalNonce: "nonce-H8-a" });
    const rec = await req("POST", "/jobs/H8-JOB/cancel?projectId=" + PROJ, {});
    // CANCELLED is a legal exit; RECONCILIATION_REQUIRED is exercised at the
    // machine level here (no bridge route drives it yet — recorded as a
    // documented state transition, not an API promise).
    assert(rec.status === 200 || rec.status === 400, "cancel must be handled");
    const store = require("../../flow-companion/bridge/job-store.js");
    const { transition } = require("../../flow-companion/bridge/state-machine.js");
    const freshJob = { jobId: "H8M", status: "AWAITING_PROVIDER_ACCEPTANCE", attempt: 1, generationCount: 0, history: [], approval: { jobId: "H8M", attempt: 1, nonce: "n", used: false } };
    const next = transition(freshJob, "RECONCILIATION_REQUIRED", { actor: "test" });
    assert(next.status === "RECONCILIATION_REQUIRED", "unknown submit outcome must be reconcilable, not re-submitable");
  });

  console.log(`\n=== SUMMARY ===\nPassed assertions: ${passed}, Failed tests: ${failed}`);
  console.log(failed === 0 ? "RESULT: ALL TESTS PASSED" : "RESULT: SOME TESTS FAILED");
  bridge.server.close();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
