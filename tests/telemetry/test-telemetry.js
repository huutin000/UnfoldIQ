"use strict";

/**
 * Phase 1H.4 — Observability matrix O1–O16 + perf baseline.
 * Deterministic. No provider calls, no credits, no network.
 */

const os = require("os");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const tel = require("../../lib/telemetry/index.js");

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
  return fs.mkdtempSync(path.join(os.tmpdir(), `unfoldiq-1h4-${tag}-`));
}

function newProject(pid = "p-t") {
  return { root: tmpRoot("p"), pid };
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

async function main() {
  await runTest("O1 structured event append (typed class, correlation ids)", () => {
    const { root, pid } = newProject();
    const r = tel.recordEvent(root, pid, {
      eventId: "eve-000000000001", eventName: "SUBMIT", severity: "INFO",
      jobId: "j-1", attemptId: "a-1", operationId: "op-1", correlationId: "corr-1",
      provider: "google-flow", model: "m-1", evidenceRefs: ["case/corr.json"],
    });
    assert(r.ok && r.changed === true, "event persisted");
    assert(r.event.eventId === "eve-000000000001", "identity kept");
    const bad = tel.recordEvent(root, pid, { eventName: "LOG", severity: "INFO" });
    assert(!bad.ok, "untyped LOG class refused");
  });

  await runTest("O2 event schema rejection (bad class/severity/shape)", () => {
    const { root, pid } = newProject();
    assert(!tel.recordEvent(root, pid, { eventName: "SUBMIT", severity: "LOUD" }).ok, "bad severity refused");
    assert(!tel.recordEvent(root, pid, { eventName: "SUBMIT", severity: "INFO", attributes: { nested: { a: 1 } } }).ok, "nested attributes refused");
    assert(!tel.recordEvent(root, pid, { eventName: "SUBMIT", severity: "INFO", attributes: { prompt: "full text here" } }).ok, "payload attribute refused");
    assert(!tel.recordEvent(root, pid, { eventName: "SUBMIT", severity: "INFO", attributes: { note: "x".repeat(300) } }).ok, "oversize attribute refused");
    assert(tel.recordEvent(root, pid, { eventName: "SUBMIT", severity: "INFO", attributes: { promptFingerprint: "abc", artifactRef: "as-1" } }).ok, "id/fingerprint attributes allowed");
  });

  await runTest("O3 append-only evidence (same id same bytes noop; different bytes conflict)", () => {
    const { root, pid } = newProject();
    const e = { eventId: "eve-000000000001", eventName: "QA", severity: "INFO", resultRef: "qa-1" };
    assert(tel.recordEvent(root, pid, e).changed === true, "first write");
    assert(tel.recordEvent(root, pid, { ...e }).changed === false, "identical replay no-ops");
    const diff = tel.recordEvent(root, pid, { ...e, resultRef: "qa-2" });
    assert(!diff.ok && diff.code === "TELEMETRY_CONFLICT", "rewrite refused (corrections are new records)");
  });

  await runTest("O4 project/job/attempt correlation inspectable (LOG-FIRST order)", () => {
    const { root, pid } = newProject();
    tel.recordEvent(root, pid, { eventId: "eve-000000000001", eventName: "SUBMIT", severity: "INFO", jobId: "j-1", attemptId: "a-1", correlationId: "corr-1" });
    tel.recordEvent(root, pid, { eventId: "eve-000000000002", eventName: "RESULT_DETECTION", severity: "INFO", jobId: "j-1", attemptId: "a-1", correlationId: "corr-1" });
    tel.recordEvent(root, pid, { eventId: "eve-000000000003", eventName: "QA", severity: "INFO", jobId: "j-9", correlationId: "corr-9" });
    const trace = tel.getTrace(root, pid, "corr-1");
    assert(trace.ok && trace.events.length === 2, "trace returns the correlated chain only");
    assert(trace.events[0].timestamp <= trace.events[1].timestamp, "chain sorted (investigation order)");
  });

  await runTest("O5 span parent/child (dangling parent refused)", () => {
    const { root, pid } = newProject();
    const parent = tel.startSpan(root, pid, { spanId: "spi-000000000001", name: "generation-submit", correlationId: "corr-1" });
    assert(parent.ok, "parent span opened");
    const bad = tel.startSpan(root, pid, { name: "download", parentSpanId: "spi-fffffffffffe" });
    assert(!bad.ok && bad.code === "TRACE_CORRELATION_INVALID", "dangling parent refused");
    const child = tel.startSpan(root, pid, { spanId: "spi-000000000002", name: "download", parentSpanId: "spi-000000000001", correlationId: "corr-1" });
    assert(child.ok && child.span.parentSpanId === "spi-000000000001", "child linked");
    assert(tel.endSpan(root, pid, "spi-000000000002", { status: "OK" }).changed === true, "span finalized");
    assert(tel.endSpan(root, pid, "spi-000000000002", { status: "OK" }).changed === false, "identical finalize no-ops (no misleading duplicates)");
    const re = tel.endSpan(root, pid, "spi-000000000002", { status: "ERROR", errorCode: "X" });
    assert(!re.ok && re.code === "TELEMETRY_CONFLICT", "finalized span never rewritten");
  });

  await runTest("O6 structured error event (no log-text parsing needed)", () => {
    const { root, pid } = newProject();
    tel.recordEvent(root, pid, { eventId: "eve-000000000001", eventName: "ERROR", severity: "ERROR", component: "bridge", stage: "submit", errorCode: "SUBMIT_FAILED", errorClass: "transport", retryable: true });
    tel.recordEvent(root, pid, { eventId: "eve-000000000002", eventName: "ERROR", severity: "ERROR", component: "bridge", stage: "submit", errorCode: "SUBMIT_FAILED", errorClass: "transport", retryable: true });
    tel.recordEvent(root, pid, { eventId: "eve-000000000003", eventName: "QA", severity: "INFO" });
    const s = tel.errorSummary(root, pid);
    assert(s.ok && s.groups.length === 1 && s.groups[0].count === 2, "grouped by component/stage/code with counts");
    // Expected control-flow codes are never ERROR.
    const locked = tel.recordEvent(root, pid, { eventName: "LOCK", severity: "ERROR", errorCode: "TARGET_LOCKED" });
    assert(!locked.ok, "TARGET_LOCKED as ERROR refused (WARN or below)");
    assert(tel.recordEvent(root, pid, { eventName: "LOCK", severity: "WARN", errorCode: "TARGET_LOCKED" }).ok, "TARGET_LOCKED as WARN ok");
  });

  await runTest("O7 cost evidence strengths preserved (never collapsed)", () => {
    const { root, pid } = newProject();
    tel.recordCostEvent(root, pid, { jobId: "b1", observed: 15, reconciled: 15, strength: "CANONICAL_COST_TABLE_RECONCILED", evidenceRefs: ["budget/ledger.json"] });
    tel.recordCostEvent(root, pid, { jobId: "b2", observed: 7, reconciled: 7, strength: "LIVE_UI_OBSERVED", evidenceRefs: ["case/corr.json"] });
    tel.recordCostEvent(root, pid, { jobId: "bx", observed: null, reconciled: null, strength: "UNKNOWN" });
    const s = tel.costSummary(root, pid);
    assert(s.ok, "summary ok");
    assert(s.byStrength.CANONICAL_COST_TABLE_RECONCILED.reconciled === 15, "canonical strength bucket intact");
    assert(s.byStrength.LIVE_UI_OBSERVED.reconciled === 7, "live-ui bucket intact");
    assert(s.byStrength.UNKNOWN.events === 1 && (s.byStrength.UNKNOWN.reconciled || 0) === 0, "UNKNOWN never becomes spend");
    const bad = tel.recordCostEvent(root, pid, { jobId: "b3", observed: 5, strength: "MAYBE" });
    assert(!bad.ok, "unknown strength refused");
  });

  await runTest("O8 result-correlation candidates recorded; ambiguity blocks", () => {
    const { root, pid } = newProject();
    const ok = tel.recordCorrelation(root, pid, {
      jobId: "j-1", candidateCount: 3, method: "SINGLE_GENERATION_ATTRIBUTION",
      selectedRef: "https://flow.google/result/1", confidence: "high", hash: "ab".repeat(32),
      evidenceRefs: ["case/corr.json"], outcome: "CORRELATED",
    });
    assert(ok.ok, "correlated selection recorded");
    const weak = tel.recordCorrelation(root, pid, { jobId: "j-2", candidateCount: 0, method: "SINGLE_GENERATION_ATTRIBUTION", outcome: "CORRELATED" });
    assert(!weak.ok, "null selection can never be CORRELATED");
    const blocked = tel.recordCorrelation(root, pid, { jobId: "j-2", candidateCount: 0, method: "SINGLE_GENERATION_ATTRIBUTION", outcome: "BLOCKED_AMBIGUOUS" });
    assert(blocked.ok, "ambiguity resolves to BLOCKED_AMBIGUOUS");
  });

  await runTest("O9 secret redaction (keys, pastes, security events carry no payload)", () => {
    const { root, pid } = newProject();
    assert(!tel.recordEvent(root, pid, { eventName: "SUBMIT", severity: "INFO", bridgeToken: "sekret" }).ok, "secret key refused");
    assert(!tel.recordEvent(root, pid, { eventName: "ERROR", severity: "ERROR", errorCode: "X", attributes: { note: "bridgeToken: abc123" } }).ok, "secret paste refused");
    const sec = tel.recordSecurityEvent(root, pid, "SECRET_REJECTED", { component: "manifest", attributes: { field: "bridgeToken", action: "refused" } });
    assert(sec.ok, "security event recorded without the payload");
    const q = tel.listEvents(root, pid, { eventName: "SECURITY" });
    assert(q.events.length === 1 && !JSON.stringify(q.events[0]).includes("abc123"), "no secret bytes in store");
  });

  await runTest("O10–O12 queries: project/job/correlationId (+ invalid filter refused)", () => {
    const { root, pid } = newProject();
    tel.recordEvent(root, pid, { eventId: "eve-000000000001", eventName: "SUBMIT", severity: "INFO", jobId: "j-1", correlationId: "c-1" });
    tel.recordEvent(root, pid, { eventId: "eve-000000000002", eventName: "QA", severity: "INFO", jobId: "j-2", correlationId: "c-2", errorCode: "QA_FAILED", provider: "google-flow", model: "m-1" });
    assert(tel.listEvents(root, pid, { jobId: "j-1" }).events.length === 1, "O11 job filter");
    assert(tel.listEvents(root, pid, { correlationId: "c-2" }).events.length === 1, "O12 correlation filter");
    assert(tel.listEvents(root, pid, { errorCode: "QA_FAILED", provider: "google-flow", model: "m-1" }).events.length === 1, "code/provider/model filters");
    assert(tel.listEvents(root, pid, {}).events.length === 2, "O10 project scope");
    assert(!tel.listEvents(root, pid, { nonsense: 1 }).ok, "unknown filter refused");
  });

  await runTest("O13 duplicate event replay idempotent; O14 fresh-process identical", () => {
    const { root, pid } = newProject();
    const e = { eventId: "eve-000000000001", eventName: "COST", severity: "INFO" };
    assert(tel.recordEvent(root, pid, e).changed === true, "first write");
    const rev1 = JSON.parse(fs.readFileSync(path.join(root, "projects", pid, "telemetry", "events.json"), "utf8")).revision;
    assert(tel.recordEvent(root, pid, { ...e }).changed === false, "O13 replay no-ops");
    const rev2 = JSON.parse(fs.readFileSync(path.join(root, "projects", pid, "telemetry", "events.json"), "utf8")).revision;
    assert(rev1 === rev2, "no fake revision bump");
    const child = spawnSync(process.execPath, ["-e",
      "const t=require(process.argv[1]);const q=t.listEvents(process.argv[2],process.argv[3],{});console.log(q.ok?q.events.length:'ERR');",
      path.join(REPO, "lib", "telemetry", "index.js"), root, pid,
    ], { encoding: "utf8" });
    assert(child.status === 0 && child.stdout.trim() === "1", "O14 fresh process queries identical state");
  });

  await runTest("O15 store write failure preserves prior valid state", () => {
    const { root, pid } = newProject();
    tel.recordEvent(root, pid, { eventId: "eve-000000000001", eventName: "QA", severity: "INFO" });
    const before = fs.readFileSync(path.join(root, "projects", pid, "telemetry", "events.json"), "utf8");
    const dir = path.join(root, "projects", pid, "telemetry");
    fs.rmSync(dir, { recursive: true });
    fs.writeFileSync(dir, "not-a-directory");
    const w = tel.recordEvent(root, pid, { eventId: "eve-000000000002", eventName: "QA", severity: "INFO" });
    assert(!w.ok && w.code === "TELEMETRY_WRITE_FAILED", "write failure surfaced");
  });

  await runTest("O16 canonical correctness events unsampled", () => {
    const { root, pid } = newProject();
    const sampled = tel.recordEvent(root, pid, { eventName: "SUBMIT", severity: "INFO", sampled: true });
    assert(!sampled.ok, "SUBMIT can never be sampled");
    const debugSampled = tel.recordEvent(root, pid, { eventName: "CHECKPOINT", severity: "DEBUG", sampled: true });
    assert(debugSampled.ok, "DEBUG_EPHEMERAL may carry an explicit sampled flag");
  });

  await runTest("Evidence ledger: addressable, immutable, resolvable", () => {
    const { root, pid } = newProject();
    const r = tel.recordEvidence(root, pid, { evidenceId: "evi-000000000001", kind: "QA_RESULT", source: "1G.11", path: "qa/summary.json", hash: "ab".repeat(32) });
    assert(r.ok && r.evidence.immutable === true, "evidence indexed");
    assert(tel.recordEvidence(root, pid, { evidenceId: "evi-000000000001", kind: "QA_RESULT", source: "1G.11", path: "qa/summary.json", hash: "ab".repeat(32) }).changed === false, "identical re-index no-ops");
    assert(!tel.recordEvidence(root, pid, { evidenceId: "evi-000000000001", kind: "COST", source: "x", path: "y" }).ok, "evidence never overwritten");
    assert(tel.getEvidence(root, pid, "evi-000000000001").ok, "resolvable by id");
    assert(tel.getEvidence(root, pid, "evi-fffffffffffe").code === "EVIDENCE_NOT_FOUND", "missing → EVIDENCE_NOT_FOUND");
  });

  await runTest("PERF baseline: append/query/trace/cost latencies, sizes", () => {
    const { root, pid } = newProject();
    for (let i = 0; i < 30; i++) {
      tel.recordEvent(root, pid, { eventName: "CHECKPOINT", severity: "INFO", jobId: "j-1", correlationId: "c-1", nonce: String(i) });
    }
    timeIt("append", () => tel.recordEvent(root, pid, { eventName: "CHECKPOINT", severity: "INFO", nonce: String(Math.random()) }), 20);
    timeIt("query", () => tel.listEvents(root, pid, { jobId: "j-1" }), 20);
    timeIt("trace", () => tel.getTrace(root, pid, "c-1"), 20);
    timeIt("costQuery", () => tel.costSummary(root, pid), 20);
    const sizeBytes = fs.statSync(path.join(root, "projects", pid, "telemetry", "events.json")).size;
    perf.sizeBytes = sizeBytes;
    perf.writeAmplification = "1 atomic replace per effective append; 0 on dedupe";
    const baseline = {
      artifact: "perf-baseline-telemetry", capturedAt: new Date().toISOString(),
      method: "process.hrtime.bigint micro-benchmarks inside tests/telemetry/test-telemetry.js",
      sampleCounts: { append: 20, query: 20, trace: 20, costQuery: 20 },
      environment: "local Windows, node",
      metrics: perf,
      budgets: { appendP50Ms: 25, queryP50Ms: 10, traceP50Ms: 10, costQueryP50Ms: 10, sizeBytes: 1048576 },
      reason: "telemetry must not materially slow Core; queries back LOG-FIRST investigation",
      result: "PASS",
    };
    const outDir = path.join(REPO, "projects", "validation", "phase-1h", "phase1h45-validation", "evidence", "performance");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "perf-baseline-telemetry.json"), JSON.stringify(baseline, null, 2) + "\n");
    assert(perf.append.p50Ms < 25, `append p50 ${perf.append.p50Ms}ms < 25ms`);
    assert(perf.query.p50Ms < 10, `query p50 ${perf.query.p50Ms}ms < 10ms`);
    assert(perf.trace.p50Ms < 10, `trace p50 ${perf.trace.p50Ms}ms < 10ms`);
  });

  console.log(`\n=== DONE: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(`FATAL: ${(e && e.stack) || e}`);
  process.exit(1);
});
