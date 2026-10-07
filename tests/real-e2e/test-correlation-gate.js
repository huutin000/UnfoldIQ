"use strict";

/**
 * Phase 1G.12 hardening (Task 02, §5.5 + A-9/A-10): correlation gate tests.
 * Correlation ambiguity must never silently become READY.
 * Deterministic, zero credits, zero provider calls.
 */

const e2e = require("../../lib/real-e2e/index.js");

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

const SHA = "fe697fd1fef86e607d743694c223ab8a93347754ba353f1f7eb0cccfbfab9ab7";

function goodRecord() {
  return {
    version: "1.0.0",
    attemptId: "b1-attempt-02",
    providerProjectRef: "8221824c-a1a6-4aa9-8d6b-fac24860d49e",
    correlationMethod: "SINGLE_GENERATION_ATTRIBUTION",
    evidence: ["operator affirmed exactly ONE generation", `download bytes sha256=${SHA}`],
    file: "downloads/clip.mp4",
    sha256: SHA,
  };
}

async function main() {
  await runTest("complete correlation record passes the READY gate", () => {
    const r = e2e.checkCorrelationForReady(goodRecord(), { expectedSha256: SHA });
    assert(r.ok === true, "good record is READY-capable");
  });

  await runTest("missing/short hash is ambiguous, never READY", () => {
    const rec = goodRecord();
    delete rec.sha256;
    const r = e2e.checkCorrelationForReady(rec, { expectedSha256: SHA });
    assert(r.ok === false, "missing sha refused (never READY)");
  });

  await runTest("empty evidence is ambiguous, never READY", () => {
    const rec = { ...goodRecord(), evidence: [] };
    const r = e2e.checkCorrelationForReady(rec, { expectedSha256: SHA });
    assert(r.ok === false, "empty evidence refused");
  });

  await runTest("unknown method is ambiguous, never READY", () => {
    const rec = { ...goodRecord(), correlationMethod: "OPERATOR_SAID_SO" };
    const r = e2e.checkCorrelationForReady(rec, { expectedSha256: SHA });
    assert(r.ok === false, "unknown method refused");
  });

  await runTest("sha mismatch against downloaded bytes is refused", () => {
    const r = e2e.checkCorrelationForReady(goodRecord(), { expectedSha256: "0".repeat(64) });
    assert(r.ok === false && r.code === "CORRELATION_SHA_MISMATCH", "sha mismatch refused, not READY");
  });

  await runTest("missing record is refused", () => {
    const r = e2e.checkCorrelationForReady(null, {});
    assert(r.ok === false && r.code === "CORRELATION_MISSING", "null record refused");
  });

  console.log(`\n=== DONE: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(`FATAL: ${(e && e.stack) || e}`);
  process.exit(1);
});
