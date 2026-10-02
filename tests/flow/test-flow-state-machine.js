"use strict";

/**
 * Flow Companion state machine tests (STEP 10B): FS1–FS10.
 * Store-backed transitions in projects/__flow10b_sm__/ (removed after).
 */

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.join(__dirname, "..", "..");
const TEST_PROJECT = "__flow10b_sm__";

const store = require("../../flow-companion/bridge/job-store.js");

let passed = 0;
let failed = 0;

function assert(c, m) {
  if (!c) throw new Error(`ASSERTION FAILED: ${m}`);
  console.log(`  ✓ ${m}`);
  passed++;
}

function runTest(name, fn) {
  console.log(`\n[TEST] ${name}`);
  try {
    fn();
    console.log(`[PASS] ${name}`);
    return true;
  } catch (e) {
    console.log(`[FAIL] ${name}: ${e.message}`);
    failed++;
    return false;
  }
}

function logOut(label, obj) {
  console.log(`  output: ${label} = ${JSON.stringify(obj)}`);
}

let n = 0;
function newJob() {
  n++;
  return store.createJob(REPO_ROOT, {
    projectId: TEST_PROJECT, jobId: `FS-${n}`, requestId: `R-${n}`, sceneId: "S01",
    capability: "video", mode: "ASSISTED_APPROVAL", prompt: "TEST-ONLY", platform: "youtube",
    flowProject: { mode: "REUSE" }, outputRequirements: {}, creativeContext: {},
    expectedOutputPath: "assets/video/S01/S01_attempt-01.mp4", attempt: 1,
  });
}

function approve(id, attempt = 1) {
  store.recordApproval(REPO_ROOT, TEST_PROJECT, id, { jobId: id, attempt, approvedBy: "test-user" });
}

function go(id, to, actor = "test") {
  return store.transitionJob(REPO_ROOT, TEST_PROJECT, id, to, { actor });
}

console.log("=== FLOW STATE MACHINE TESTS (FS1-FS10) ===\n");

// FS1 — happy path.
runTest("FS1 Happy path to READY", () => {
  const j = newJob();
  go(j.jobId, "VALIDATED");
  go(j.jobId, "PREPARED");
  go(j.jobId, "AWAITING_USER_APPROVAL");
  approve(j.jobId);
  go(j.jobId, "GENERATING");
  go(j.jobId, "RESULT_DETECTED");
  go(j.jobId, "DOWNLOADING");
  go(j.jobId, "IMPORTED");
  const done = go(j.jobId, "READY");
  logOut("final", done.status);
  assert(done.status === "READY", "happy path must reach READY");
  assert(done.history.length >= 9, "transitions must be persisted in history");
});

// FS2 — invalid direct PENDING→READY rejected.
runTest("FS2 PENDING→READY rejected", () => {
  const j = newJob();
  let code = null;
  try {
    go(j.jobId, "READY");
  } catch (e) {
    code = e.message;
  }
  logOut("rejection", code);
  assert(code && /INVALID_TRANSITION/.test(code), "skipping the machine must be rejected");
});

// FS3 — cancelled job cannot generate.
runTest("FS3 Cancelled cannot generate", () => {
  const j = newJob();
  go(j.jobId, "CANCELLED");
  let code = null;
  try {
    go(j.jobId, "GENERATING");
  } catch (e) {
    code = e.message;
  }
  logOut("rejection", code);
  assert(code && /INVALID_TRANSITION|TERMINAL/.test(code), "cancelled job must never generate");
});

// FS4 — reload restores persisted state.
runTest("FS4 Reload restores state", () => {
  const j = newJob();
  go(j.jobId, "VALIDATED");
  go(j.jobId, "PREPARED");
  const reloaded = store.getJob(REPO_ROOT, TEST_PROJECT, j.jobId);
  logOut("reloaded", { status: reloaded.status, history: reloaded.history.length });
  assert(reloaded.status === "PREPARED", "reload must restore PREPARED");
  const resumed = go(j.jobId, "AWAITING_USER_APPROVAL");
  assert(resumed.status === "AWAITING_USER_APPROVAL", "queue must resume after reload");
});

// FS5 — unknown completion triggers RECONCILIATION_REQUIRED.
runTest("FS5 Uncertain completion reconciles", () => {
  const j = newJob();
  go(j.jobId, "VALIDATED");
  go(j.jobId, "PREPARED");
  go(j.jobId, "AWAITING_USER_APPROVAL");
  approve(j.jobId);
  go(j.jobId, "GENERATING");
  const rec = go(j.jobId, "RECONCILIATION_REQUIRED");
  logOut("status", rec.status);
  assert(rec.status === "RECONCILIATION_REQUIRED", "uncertain completion must reconcile, not auto-submit");
  let code = null;
  try {
    go(j.jobId, "GENERATING");
  } catch (e) {
    code = e.message;
  }
  assert(code && /INVALID_TRANSITION/.test(code), "reconciliation must not auto-resubmit generation");
  const manual = go(j.jobId, "MANUAL_ASSIST_REQUIRED");
  assert(manual.status === "MANUAL_ASSIST_REQUIRED", "human decides after reconciliation");
});

// FS6 — no infinite retry.
runTest("FS6 Generation attempts bounded", () => {
  const j = newJob();
  go(j.jobId, "VALIDATED");
  go(j.jobId, "PREPARED");
  const cycle = () => {
    go(j.jobId, "AWAITING_USER_APPROVAL");
    approve(j.jobId);
    go(j.jobId, "GENERATING");
    go(j.jobId, "RETRYABLE_ERROR");
    go(j.jobId, "PREPARED");
  };
  cycle();
  cycle();
  cycle();
  go(j.jobId, "AWAITING_USER_APPROVAL");
  approve(j.jobId);
  let code = null;
  try {
    go(j.jobId, "GENERATING");
  } catch (e) {
    code = e.message;
  }
  logOut("rejection", code);
  assert(code && /GENERATION_ATTEMPT_LIMIT/.test(code), "4th generation must be refused: no infinite retry");
});

// FS7 — rejected output preserved as old attempt.
runTest("FS7 Rejected attempt preserved", () => {
  const j = newJob();
  go(j.jobId, "VALIDATED");
  go(j.jobId, "PREPARED");
  go(j.jobId, "AWAITING_USER_APPROVAL");
  approve(j.jobId);
  go(j.jobId, "GENERATING");
  go(j.jobId, "RESULT_DETECTED");
  go(j.jobId, "DOWNLOADING");
  go(j.jobId, "IMPORTED");
  go(j.jobId, "REJECTED_BY_QA");
  const next = go(j.jobId, "PREPARED");
  logOut("newAttempt", { attempt: next.attempt, approval: next.approval || null });
  assert(next.attempt === 2, "rejection must open a new attempt, preserving the old one");
});

// FS8 — new attempt requires approval.
runTest("FS8 New attempt needs approval", () => {
  const j = newJob();
  go(j.jobId, "VALIDATED");
  go(j.jobId, "PREPARED");
  go(j.jobId, "AWAITING_USER_APPROVAL");
  approve(j.jobId);
  go(j.jobId, "GENERATING");
  go(j.jobId, "RESULT_DETECTED");
  go(j.jobId, "DOWNLOADING");
  go(j.jobId, "IMPORTED");
  go(j.jobId, "REJECTED_BY_QA");
  go(j.jobId, "PREPARED");
  go(j.jobId, "AWAITING_USER_APPROVAL");
  let code = null;
  try {
    go(j.jobId, "GENERATING");
  } catch (e) {
    code = e.message;
  }
  logOut("rejection", code);
  assert(code && /APPROVAL_REQUIRED/.test(code), "new attempt must require a new approval");
});

// FS9 — pause/resume queue works.
runTest("FS9 Pause/resume works", () => {
  const j = newJob();
  go(j.jobId, "VALIDATED");
  go(j.jobId, "PREPARED");
  go(j.jobId, "AWAITING_USER_APPROVAL");
  const paused = go(j.jobId, "PAUSED");
  assert(paused.status === "PAUSED", "queue must pause");
  const resumed = go(j.jobId, "AWAITING_USER_APPROVAL");
  logOut("resumed", resumed.status);
  assert(resumed.status === "AWAITING_USER_APPROVAL", "queue must resume without auto-generating");
});

// FS10 — concurrent jobs do not corrupt each other.
runTest("FS10 Concurrent jobs isolated", () => {
  const a = newJob();
  const b = newJob();
  go(a.jobId, "VALIDATED");
  go(b.jobId, "VALIDATED");
  go(a.jobId, "PREPARED");
  const ra = store.getJob(REPO_ROOT, TEST_PROJECT, a.jobId);
  const rb = store.getJob(REPO_ROOT, TEST_PROJECT, b.jobId);
  logOut("statuses", { a: ra.status, b: rb.status });
  assert(ra.status === "PREPARED" && rb.status === "VALIDATED", "jobs must evolve independently");
});

fs.rmSync(`${REPO_ROOT}/projects/${TEST_PROJECT}`, { recursive: true, force: true });

console.log(`\n=== SUMMARY ===`);
console.log(`Passed assertions: ${passed}, Failed tests: ${failed}`);
if (failed > 0) {
  console.log("RESULT: SOME TESTS FAILED");
  process.exit(1);
}
console.log("RESULT: ALL TESTS PASSED");
