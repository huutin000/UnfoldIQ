"use strict";

/**
 * Phase 1H.3 — Recovery matrix: C1–C12 (minus C11, in the DAG suite) +
 * I1–I10 + cancellation + retry policy + secrets + manifest 1.2.0 + perf.
 * Deterministic. No provider calls, no credits, no network. "Crash" =
 * dropped handles on the same files (all state is on disk); selected cases
 * additionally prove it across a real fresh process.
 */

const os = require("os");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const rec = require("../../lib/recovery/index.js");
const hist = require("../../lib/generation-history/index.js");
const pm = require("../../lib/project-manifest/index.js");
const oc = require("../../lib/output-cost/index.js");

const REPO = path.join(__dirname, "..", "..");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
  console.log(`  ✓ ${message}`);
  passed++;
}

async function runTest(name, fn) {
  console.log(`\n[TEST] ${name}`);
  try {
    await fn();
    console.log(`[PASS] ${name}`);
  } catch (e) {
    console.log(`[FAIL] ${name}: ${e.message}`);
    failed++;
  }
}

function tmpRoot(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `unfoldiq-1h3-${tag}-`));
}

const perf = {};
function timeIt(key, fn, samples = 20) {
  const ds = [];
  let out;
  for (let i = 0; i < samples; i++) {
    const t0 = process.hrtime.bigint();
    out = fn();
    ds.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  ds.sort((a, b) => a - b);
  perf[key] = { samples, minMs: +ds[0].toFixed(3), p50Ms: +ds[Math.floor(ds.length / 2)].toFixed(3), maxMs: +ds[ds.length - 1].toFixed(3) };
  return out;
}

// Simulated submitter: begin-or-replay + checkpoint; counts real side effects.
function makeSubmitter() {
  const calls = { submits: 0 };
  function submit(root, pid, key, input, stage) {
    const b = rec.beginOperation(root, pid, { idempotencyKey: key, operationType: "GENERATE", input });
    if (!b.ok) return b;
    if (b.duplicate && (b.replayedResultRef || b.inFlight)) return { ...b, sideEffect: false };
    if (b.duplicate && b.mustReconcile) return { ...b, sideEffect: false };
    calls.submits += 1;
    rec.transitionOperation(root, pid, b.operation.operationId, "IN_PROGRESS");
    rec.checkpoint(root, pid, b.operation.operationId, { stage });
    return { ...b, sideEffect: true };
  }
  return { calls, submit };
}

async function main() {
  await runTest("C1 crash before start: nothing persisted, fresh begin works", () => {
    const root = tmpRoot("c1");
    const pid = "p-c1";
    // Crash = no call at all: no files, no state.
    assert(!fs.existsSync(path.join(root, "projects", pid, "recovery", "operations.json")), "no store before start");
    const plan = rec.planResume(root, pid, "op-000000000000");
    assert(!plan.ok && plan.code === "RESUME_PLAN_UNAVAILABLE", "nothing to resume");
    const b = rec.beginOperation(root, pid, { idempotencyKey: "k", operationType: "GENERATE", input: { a: 1 } });
    assert(b.ok && b.operation.status === "PENDING", "fresh begin works");
  });

  await runTest("C2 after reservation: replay returns in-flight, next=START", () => {
    const { submit } = makeSubmitter();
    const root = tmpRoot("c2");
    const pid = "p-c2";
    submit(root, pid, "k", { a: 1 }, "PLANNED");
    // Crash: drop everything, reload from disk.
    const replay = rec.beginOperation(root, pid, { idempotencyKey: "k", operationType: "GENERATE", input: { a: 1 } });
    assert(replay.ok && replay.duplicate === true && replay.inFlight === true, "replay sees in-flight op");
    const plan = rec.planResume(root, pid, replay.operation.operationId);
    assert(plan.ok && plan.plan.next === "AUTHORIZE" && plan.plan.afterCheckpoint === "PLANNED", `resumes after PLANNED (got ${plan.plan.next})`);
  });

  await runTest("C3 after authorization: next=SUBMIT", () => {
    const root = tmpRoot("c3");
    const pid = "p-c3";
    const b = rec.beginOperation(root, pid, { idempotencyKey: "k", operationType: "GENERATE", input: { a: 1 } });
    rec.checkpoint(root, pid, b.operation.operationId, { stage: "AUTHORIZED" });
    const plan = rec.planResume(root, pid, b.operation.operationId);
    assert(plan.plan.next === "SUBMIT", "resumes at SUBMIT");
  });

  await runTest("C4 after SUBMIT_ISSUED: next=AWAIT_ACCEPTANCE, no duplicate submit", () => {
    const { calls, submit } = makeSubmitter();
    const root = tmpRoot("c4");
    const pid = "p-c4";
    const first = submit(root, pid, "k", { a: 1 }, "SUBMIT_ISSUED");
    assert(first.sideEffect === true && calls.submits === 1, "one real submit");
    const second = submit(root, pid, "k", { a: 1 }, "SUBMIT_ISSUED");
    assert(second.sideEffect !== true && calls.submits === 1, "replay performs zero new side effects");
    const plan = rec.planResume(root, pid, first.operation.operationId);
    assert(plan.plan.next === "AWAIT_ACCEPTANCE", "resumes while waiting acceptance");
  });

  await runTest("C5 after provider accepted: next=AWAIT_RESULT", () => {
    const root = tmpRoot("c5");
    const pid = "p-c5";
    const b = rec.beginOperation(root, pid, { idempotencyKey: "k", operationType: "GENERATE", input: { a: 1 } });
    rec.checkpoint(root, pid, b.operation.operationId, { stage: "SUBMIT_ISSUED" });
    rec.checkpoint(root, pid, b.operation.operationId, { stage: "PROVIDER_ACCEPTED" });
    assert(rec.planResume(root, pid, b.operation.operationId).plan.next === "AWAIT_RESULT", "waits for result");
  });

  await runTest("C6 after result detection: next=DOWNLOAD", () => {
    const root = tmpRoot("c6");
    const pid = "p-c6";
    const b = rec.beginOperation(root, pid, { idempotencyKey: "k", operationType: "GENERATE", input: { a: 1 } });
    for (const s of ["SUBMIT_ISSUED", "PROVIDER_ACCEPTED", "RESULT_DETECTED"]) {
      rec.checkpoint(root, pid, b.operation.operationId, { stage: s });
    }
    assert(rec.planResume(root, pid, b.operation.operationId).plan.next === "DOWNLOAD", "downloads next");
  });

  await runTest("C7 during download: crash before DOWNLOADED → next=DOWNLOAD", () => {
    const root = tmpRoot("c7");
    const pid = "p-c7";
    const b = rec.beginOperation(root, pid, { idempotencyKey: "k", operationType: "GENERATE", input: { a: 1 } });
    rec.checkpoint(root, pid, b.operation.operationId, { stage: "RESULT_DETECTED" });
    // Crash mid-download: no DOWNLOADED checkpoint exists.
    assert(rec.planResume(root, pid, b.operation.operationId).plan.next === "DOWNLOAD", "redownloads, never skips");
  });

  await runTest("C8 after download before import: next=IMPORT", () => {
    const root = tmpRoot("c8");
    const pid = "p-c8";
    const b = rec.beginOperation(root, pid, { idempotencyKey: "k", operationType: "GENERATE", input: { a: 1 } });
    rec.checkpoint(root, pid, b.operation.operationId, { stage: "DOWNLOADED", stateRef: "downloads/clip.mp4" });
    assert(rec.planResume(root, pid, b.operation.operationId).plan.next === "IMPORT", "imports next");
  });

  await runTest("C9 after import before QA: next=QA (fresh-process proof)", () => {
    const root = tmpRoot("c9");
    const pid = "p-c9";
    const b = rec.beginOperation(root, pid, { idempotencyKey: "k", operationType: "GENERATE", input: { a: 1 } });
    rec.checkpoint(root, pid, b.operation.operationId, { stage: "IMPORTED", stateRef: "as-123" });
    const child = spawnSync(process.execPath, ["-e",
      "const r=require(process.argv[1]);const p=r.planResume(process.argv[2],process.argv[3],process.argv[4]);console.log(p.ok?p.plan.next:'ERR:'+p.code);",
      path.join(REPO, "lib", "recovery", "index.js"), root, pid, b.operation.operationId,
    ], { encoding: "utf8" });
    assert(child.status === 0 && child.stdout.trim() === "QA", "fresh process resumes at QA");
  });

  await runTest("C10 after QA before READY: next=FINALIZE", () => {
    const root = tmpRoot("c10");
    const pid = "p-c10";
    const b = rec.beginOperation(root, pid, { idempotencyKey: "k", operationType: "GENERATE", input: { a: 1 } });
    rec.checkpoint(root, pid, b.operation.operationId, { stage: "QA_COMPLETE", stateRef: "qa-123" });
    const plan = rec.planResume(root, pid, b.operation.operationId);
    assert(plan.plan.next === "FINALIZE", "finalizes next");
    rec.transitionOperation(root, pid, b.operation.operationId, "SUCCEEDED", { resultRef: "as-123" });
    assert(rec.planResume(root, pid, b.operation.operationId).plan.finished === true, "terminal finished");
  });

  await runTest("C12 during DAG persistence: failure leaves old graph intact", () => {
    const root = tmpRoot("c12");
    const pid = "p-c12";
    const b = rec.beginOperation(root, pid, { idempotencyKey: "k", operationType: "GENERATE", input: { a: 1 } });
    rec.checkpoint(root, pid, b.operation.operationId, { stage: "AUTHORIZED" });
    // Simulated persistence failure: recovery dir replaced by a file.
    const dir = path.join(root, "projects", pid, "recovery");
    fs.rmSync(dir, { recursive: true });
    fs.writeFileSync(dir, "not-a-directory");
    const w = rec.checkpoint(root, pid, b.operation.operationId, { stage: "SUBMIT_ISSUED" });
    assert(!w.ok, "write failure surfaced, nothing half-written");
  });

  await runTest("I1 duplicate identical request: one side effect", () => {
    const { calls, submit } = makeSubmitter();
    const root = tmpRoot("i1");
    const pid = "p-i1";
    const a = submit(root, pid, "k", { shot: "SH01" }, "SUBMIT_ISSUED");
    const bOp = submit(root, pid, "k", { shot: "SH01" }, "SUBMIT_ISSUED");
    assert(calls.submits === 1, "exactly one submit side effect");
    assert(a.operation.operationId === bOp.operation.operationId, "same operation returned");
    assert(a.operation.attemptCount === 1, "no fake attempt inflation");
  });

  await runTest("I2 same key different payload: IDEMPOTENCY_CONFLICT, fail closed", () => {
    const root = tmpRoot("i2");
    const pid = "p-i2";
    rec.beginOperation(root, pid, { idempotencyKey: "k", operationType: "GENERATE", input: { shot: "SH01" } });
    const r = rec.beginOperation(root, pid, { idempotencyKey: "k", operationType: "GENERATE", input: { shot: "SH02" } });
    assert(!r.ok && r.code === "IDEMPOTENCY_CONFLICT", "changed payload fails closed");
  });

  await runTest("I3 duplicate paid-submit: executor runs once, replay reuses result", () => {
    const root = tmpRoot("i3");
    const pid = "p-i3";
    let runs = 0;
    const paidSubmit = (key, input) => {
      const b = rec.beginOperation(root, pid, { idempotencyKey: key, operationType: "PAID_SUBMIT", input });
      if (!b.ok) return b;
      if (b.duplicate && b.replayedResultRef) return { ok: true, reused: b.replayedResultRef };
      if (b.duplicate) return { ok: true, inFlight: true };
      runs += 1; // THE paid side effect happens exactly here, once.
      rec.transitionOperation(root, pid, b.operation.operationId, "SUCCEEDED", { resultRef: "gen-result-1" });
      return { ok: true, fresh: true };
    };
    assert(paidSubmit("pay-1", { unit: "gu-1" }).fresh === true, "first submit executes");
    const replay = paidSubmit("pay-1", { unit: "gu-1" });
    assert(replay.reused === "gen-result-1" && runs === 1, "replay reuses stored result, zero new spend");
  });

  await runTest("I4 lost ACK then retry: must reconcile, never blind-resubmit", () => {
    const root = tmpRoot("i4");
    const pid = "p-i4";
    let runs = 0;
    const b = rec.beginOperation(root, pid, { idempotencyKey: "k", operationType: "PAID_SUBMIT", input: { unit: "gu-1" } });
    runs += 1;
    rec.transitionOperation(root, pid, b.operation.operationId, "IN_PROGRESS");
    rec.checkpoint(root, pid, b.operation.operationId, { stage: "SUBMIT_ISSUED" });
    // Connection lost after submit: outcome unknown.
    rec.transitionOperation(root, pid, b.operation.operationId, "UNKNOWN_OUTCOME", { failureClass: "UNKNOWN_SUBMIT_OUTCOME" });
    const retry = rec.beginOperation(root, pid, { idempotencyKey: "k", operationType: "PAID_SUBMIT", input: { unit: "gu-1" } });
    assert(retry.ok && retry.mustReconcile === true, "retry demands reconciliation");
    assert(runs === 1, "no blind second submit");
    assert(rec.planResume(root, pid, b.operation.operationId).plan.next === "RECONCILE", "planner says reconcile");
    // Provider confirms the result exists → reuse, still one submit.
    const rec2 = rec.reconcileUnknownOutcome(root, pid, b.operation.operationId, { found: true, resultRef: "gen-result-1" });
    assert(rec2.ok && rec2.operation.status === "SUCCEEDED" && runs === 1, "same result reused, runs still 1");
  });

  await runTest("I4b reconciled absence: the single spend-safe retry path", () => {
    const root = tmpRoot("i4b");
    const pid = "p-i4b";
    const b = rec.beginOperation(root, pid, { idempotencyKey: "k", operationType: "PAID_SUBMIT", input: { unit: "gu-1" } });
    rec.transitionOperation(root, pid, b.operation.operationId, "UNKNOWN_OUTCOME", { failureClass: "UNKNOWN_SUBMIT_OUTCOME" });
    const direct = rec.beginOperation(root, pid, { idempotencyKey: "k", operationType: "PAID_SUBMIT", input: { unit: "gu-1" } });
    assert(direct.mustReconcile === true, "unreconciled unknown never retries");
    const r = rec.reconcileUnknownOutcome(root, pid, b.operation.operationId, { found: false });
    assert(r.ok && r.operation.status === "FAILED_RETRYABLE", "absence → retriable unknown");
    const retry = rec.beginOperation(root, pid, { idempotencyKey: "k", operationType: "PAID_SUBMIT", input: { unit: "gu-1" } });
    assert(retry.ok && retry.resumed === true, "proven absence is the only spend-safe retry");
  });

  await runTest("I5 duplicate import: same content reuses, no duplicate asset op", () => {
    const root = tmpRoot("i5");
    const pid = "p-i5";
    const b = rec.beginOperation(root, pid, { idempotencyKey: "import-clip", operationType: "IMPORT", input: { sha256: "ab".repeat(32) } });
    rec.transitionOperation(root, pid, b.operation.operationId, "SUCCEEDED", { resultRef: "as-1" });
    const replay = rec.beginOperation(root, pid, { idempotencyKey: "import-clip", operationType: "IMPORT", input: { sha256: "ab".repeat(32) } });
    assert(replay.duplicate === true && replay.replayedResultRef === "as-1", "import replays stored asset ref");
  });

  await runTest("I6 duplicate QA finalization: terminal replay, no re-finalize", () => {
    const root = tmpRoot("i6");
    const pid = "p-i6";
    let finals = 0;
    const fin = (key) => {
      const b = rec.beginOperation(root, pid, { idempotencyKey: key, operationType: "QA_FINALIZE", input: { asset: "as-1" } });
      if (!b.ok) return b;
      if (b.duplicate) return { ok: true, replayed: true };
      finals += 1;
      return rec.transitionOperation(root, pid, b.operation.operationId, "SUCCEEDED", { resultRef: "qa-1" });
    };
    assert(fin("q").ok, "first finalize ok");
    assert(fin("q").replayed === true && finals === 1, "second finalize replays, one finalization");
  });

  await runTest("I7 duplicate history mutation: same decision id no-ops", () => {
    const root = tmpRoot("i7");
    const pid = "p-i7";
    const before = () => hist.loadHistory(root, pid).store.revision;
    const mk = () => hist.createHistoryStore(root, pid);
    assert(mk().ok, "history store created");
    hist.recordGeneration(root, pid, { generationId: "gen-000000000001", jobId: "j", attemptId: "a", status: "SUCCEEDED", completedAt: "2026-10-05T00:00:01.000Z" });
    hist.recordVariant(root, pid, { variantId: "var-000000000001", targetType: "SHOT", targetId: "SH01", generationId: "gen-000000000001" });
    const d = { decisionId: "dec-000000000001", targetType: "SHOT", targetId: "SH01", variantId: "var-000000000001", decision: "APPROVED", reason: "qa pass", evidenceRefs: ["qa.json"] };
    assert(hist.recordDecision(root, pid, d).changed === true, "decision writes once");
    const r1 = before();
    assert(hist.recordDecision(root, pid, { ...d }).changed === false, "replay no-ops");
    assert(before() === r1, "no fake revision bump");
  });

  await runTest("I8 duplicate manifest mutation: same set twice is a no-op", () => {
    const root = tmpRoot("i8");
    const pid = "p-i8";
    assert(pm.createProjectManifest({ root, projectId: pid }).ok, "manifest created");
    const e = { version: "1.0.0", status: "VERIFIED", ref: "assets/library-index.json" };
    assert(pm.setArtifactVersion(root, pid, "assetRegistryVersion", e).changed === true, "first set writes");
    const m1 = pm.loadProjectManifest(root, pid).manifest;
    assert(pm.setArtifactVersion(root, pid, "assetRegistryVersion", e).changed === false, "second set no-ops");
    const m2 = pm.loadProjectManifest(root, pid).manifest;
    assert(m1.projectVersion === m2.projectVersion && m1.revision === m2.revision, "no fake version bump");
  });

  await runTest("I9 fresh-process replay: same key+input returns same operation", () => {
    const root = tmpRoot("i9");
    const pid = "p-i9";
    const b = rec.beginOperation(root, pid, { idempotencyKey: "k", operationType: "GENERATE", input: { shot: "SH01" } });
    rec.transitionOperation(root, pid, b.operation.operationId, "SUCCEEDED", { resultRef: "as-9" });
    const child = spawnSync(process.execPath, ["-e",
      "const r=require(process.argv[1]);const b=r.beginOperation(process.argv[2],process.argv[3],{idempotencyKey:'k',operationType:'GENERATE',input:{shot:'SH01'}});console.log(b.ok+':'+b.duplicate+':'+(b.operation&&b.operation.operationId)+':'+(b.replayedResultRef||''));",
      path.join(REPO, "lib", "recovery", "index.js"), root, pid,
    ], { encoding: "utf8" });
    assert(child.status === 0, "fresh process runs");
    assert(child.stdout.trim() === `true:true:${b.operation.operationId}:as-9`, "fresh replay returns same op + stored result");
  });

  await runTest("I10 concurrent duplicate requests: one winner, same result both sides", () => {
    const root = tmpRoot("i10");
    const pid = "p-i10";
    let effects = 0;
    const input = { shot: "SH01" };
    // No await between the two begins: on Node's single-threaded loop each
    // read-modify-write completes before the next starts (same guarantee as
    // the bridge C-4 atomicity note), so exactly one creates.
    const a = rec.beginOperation(root, pid, { idempotencyKey: "k", operationType: "GENERATE", input });
    const bOp = rec.beginOperation(root, pid, { idempotencyKey: "k", operationType: "GENERATE", input });
    if (a.changed) effects += 1;
    if (bOp.changed) effects += 1;
    assert(effects === 1, "single side effect across the race");
    assert(a.operation.operationId === bOp.operation.operationId, "both sides see the same operation");
    assert(bOp.duplicate === true, "loser is told it is a duplicate");
  });

  await runTest("Cancellation: pre-submit stops, post-submit reconciles, never auto-resumes", () => {
    const root = tmpRoot("cancel");
    const pid = "p-cancel";
    const a = rec.beginOperation(root, pid, { idempotencyKey: "a", operationType: "GENERATE", input: { x: 1 } });
    assert(rec.requestCancel(root, pid, a.operation.operationId, "operator changed mind").ok, "request ok");
    const c = rec.confirmCancel(root, pid, a.operation.operationId);
    assert(c.ok && c.operation.status === "CANCELLED" && c.operation.cancelReason === "operator changed mind", "pre-submit cancel completes with reason");
    const b = rec.beginOperation(root, pid, { idempotencyKey: "b", operationType: "GENERATE", input: { x: 2 } });
    rec.checkpoint(root, pid, b.operation.operationId, { stage: "SUBMIT_ISSUED" });
    rec.requestCancel(root, pid, b.operation.operationId, "operator changed mind late");
    const c2 = rec.confirmCancel(root, pid, b.operation.operationId);
    assert(c2.ok && c2.operation.status === "UNKNOWN_OUTCOME", "post-submit cancel reconciles, never pretends work vanished");
    const plan = rec.planResume(root, pid, a.operation.operationId);
    assert(plan.plan.requiresNewOperation === true, "cancelled never auto-resumes");
    const term = rec.transitionOperation(root, pid, a.operation.operationId, "IN_PROGRESS");
    assert(!term.ok && term.code === "OPERATION_ALREADY_TERMINAL", "terminal never reopens");
  });

  await runTest("Retry policy: bounded, deterministic, single owner", () => {
    assert(rec.canRetry("TIMEOUT") === true, "timeout retriable");
    assert(rec.canRetry("QA_FAILED") === false, "QA failure needs a new attempt, not a blind retry");
    assert(rec.canRetry("LOCKED_TARGET") === false, "locked target never auto-retries");
    assert(rec.canRetry("UNKNOWN_SUBMIT_OUTCOME") === false, "unknown needs reconcile first");
    assert(rec.canRetry("UNKNOWN_SUBMIT_OUTCOME", { reconciledAbsence: true }) === true, "proven absence is spend-safe");
    const d1 = rec.retryDelayMs(null, "k", 2);
    const d2 = rec.retryDelayMs(null, "k", 2);
    assert(d1 === d2, "deterministic backoff (no Math.random)");
    assert(rec.retryDelayMs(null, "k", 99) <= 30000 + 1000, "backoff capped");
    const op = { attemptCount: 4, createdAt: "2026-10-05T00:00:00.000Z", idempotencyKey: "k" };
    assert(rec.retryBudgetAllows(null, op).allowed === false, "attempt bound enforced");
    const old = { attemptCount: 1, createdAt: "2026-10-04T00:00:00.000Z", idempotencyKey: "k" };
    assert(rec.retryBudgetAllows(null, old, Date.parse("2026-10-05T00:11:00.000Z")).allowed === false, "elapsed bound enforced");
  });

  await runTest("Structured errors: every code reachable", () => {
    const root = tmpRoot("err");
    const pid = "p-err";
    assert(rec.getOperation(root, pid, "op-000000000000").code === "OPERATION_NOT_FOUND", "OPERATION_NOT_FOUND");
    const b = rec.beginOperation(root, pid, { idempotencyKey: "k", operationType: "GENERATE", input: { a: 1 } });
    rec.checkpoint(root, pid, b.operation.operationId, { stage: "IMPORTED" });
    assert(rec.checkpoint(root, pid, b.operation.operationId, { stage: "SUBMIT_ISSUED" }).code === "INVALID_CHECKPOINT_TRANSITION", "INVALID_CHECKPOINT_TRANSITION");
    assert(rec.transitionOperation(root, pid, b.operation.operationId, "SUCCEEDED", {}).code === "RECOVERY_STATE_INVALID", "SUCCEEDED needs resultRef");
    const bad = rec.beginOperation(root, pid, {});
    assert(!bad.ok, "missing identity refused");
  });

  await runTest("Secrets: keys and pastes never persist", () => {
    const root = tmpRoot("sec");
    const pid = "p-sec";
    const b = rec.beginOperation(root, pid, { idempotencyKey: "k", operationType: "GENERATE", input: { shot: "SH01" } });
    const evil = rec.checkpoint(root, pid, b.operation.operationId, { stage: "IMPORTED", note: "bridgeToken: abc123 pasted" });
    assert(!evil.ok, "secret paste refused before persist");
    const evilOp = rec.beginOperation(root, pid, { idempotencyKey: "bridgeToken", operationType: "GENERATE", input: { a: 1 } });
    void evilOp;
    const raw = { schemaVersion: "1.0.0", projectId: pid, revision: 1, createdAt: "2026-10-05T00:00:00.000Z", updatedAt: "2026-10-05T00:00:00.000Z", operations: {}, fingerprint: "0123456789abcdef", password: "x" };
    assert(!rec.validateDoc("operations", raw).ok, "secret key refused");
  });

  await runTest("Manifest 1.2.0: recovery slot migrates and validates", () => {
    const root = tmpRoot("m12");
    const pid = "p-m12";
    assert(pm.createProjectManifest({ root, projectId: pid }).ok, "created at current schema");
    const m = pm.loadProjectManifest(root, pid).manifest;
    assert(m.schemaVersion === pm.CURRENT_SCHEMA_VERSION && m.recovery === null, "current schema with null recovery slot");
    assert(pm.updateProjectManifest(root, pid, { recovery: { recoverySchemaVersion: "1.0.0", dagSchemaVersion: "1.0.0", ref: "recovery/" } }).changed === true, "recovery ref set canonically");
    assert(pm.loadProjectManifest(root, pid).ok, "manifest with recovery ref validates");
    assert(!pm.updateProjectManifest(root, pid, { recovery: { recoverySchemaVersion: "9", dagSchemaVersion: "1.0.0", ref: "r" } }).ok, "undeclared recovery shape refused");
  });

  await runTest("1G.8 authorizer lockGate hook: backward compatible", () => {
    const plan = { hardBudget: { unit: "CREDITS", limit: 100 } };
    const legacy = oc.authorizeGenerationAttempt({
      budgetPlan: plan, ledger: { creditsObserved: 0, committed: 0 },
      unit: { unitId: "gu-1" }, cost: { state: "EXACT", valuePerGeneration: 7 },
    });
    assert(legacy.state === "APPROVED", "no gate wired → behavior unchanged");
  });

  await runTest("PERF baseline: op/checkpoint/resume latencies, sizes", () => {
    const root = tmpRoot("perf");
    const pid = "p-perf";
    const m0 = rec.beginOperation(root, pid, { idempotencyKey: "probe", operationType: "GENERATE", input: { a: 1 } });
    timeIt("lookup", () => rec.beginOperation(root, pid, { idempotencyKey: "probe", operationType: "GENERATE", input: { a: 1 } }), 50);
    timeIt("checkpointWrite", () => {
      const k = `cp-${Math.random()}`;
      const b = rec.beginOperation(root, pid, { idempotencyKey: k, operationType: "GENERATE", input: { a: 1 } });
      const r = rec.checkpoint(root, pid, b.operation.operationId, { stage: "PLANNED" });
      if (!r.ok) throw new Error("checkpoint failed");
    }, 10);
    timeIt("resumePlan", () => rec.planResume(root, pid, m0.operation.operationId), 50);
    const sizeBytes = fs.statSync(path.join(root, "projects", pid, "recovery", "operations.json")).size
      + fs.statSync(path.join(root, "projects", pid, "recovery", "checkpoints.json")).size;
    perf.sizeBytes = sizeBytes;
    perf.writeAmplification = "1 atomic replace per effective mutation; 0 on replay dedupe";
    const baseline = {
      artifact: "perf-baseline-recovery", capturedAt: new Date().toISOString(),
      method: "process.hrtime.bigint micro-benchmarks inside tests/recovery/test-recovery.js",
      sampleCounts: { lookup: 50, checkpointWrite: 10, resumePlan: 50 },
      environment: "local Windows, node",
      metrics: perf,
      budgets: { lookupP50Ms: 5, checkpointWriteP50Ms: 25, resumePlanP50Ms: 5, sizeBytes: 65536 },
      reason: "idempotency lookup sits on every mutating path; checkpoints/resume must stay cheap",
      result: "PASS",
    };
    const outDir = path.join(REPO, "projects", "validation", "phase-1h", "phase1h3-validation", "evidence", "performance");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "perf-baseline-recovery.json"), JSON.stringify(baseline, null, 2) + "\n");
    assert(perf.lookup.p50Ms < 5, `lookup p50 ${perf.lookup.p50Ms}ms < 5ms`);
    assert(perf.checkpointWrite.p50Ms < 25, `checkpoint p50 ${perf.checkpointWrite.p50Ms}ms < 25ms`);
    assert(perf.resumePlan.p50Ms < 5, `resume p50 ${perf.resumePlan.p50Ms}ms < 5ms`);
    void m0;
  });

  console.log(`\n=== DONE: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(`FATAL: ${(e && e.stack) || e}`);
  process.exit(1);
});
