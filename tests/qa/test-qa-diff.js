"use strict";
// STEP-13 Branch C — qa-diff tests QD1-QD6 via qa/qa-diff.js. No fixtures.

const QD = require("../../qa/qa-diff.js");

let passed = 0;
let failed = 0;
function runTest(name, fn) {
  console.log("[TEST] " + name);
  try {
    fn();
    console.log("[PASS] " + name);
    passed++;
  } catch (e) {
    console.log("[FAIL] " + name + ": " + ((e && e.stack) || (e && e.message) || String(e)));
    failed++;
  }
}
function assert(c, m) { if (!c) throw new Error("ASSERT: " + m); }
function issue(o) {
  return Object.assign({ status: "OPEN", severity: "WARNING" }, o);
}

const A1 = issue({ attemptId: "attempt-001", category: "BLACK_FRAME", startMs: 2500, endMs: 4500, reason: "tail" });
const A2 = issue({ attemptId: "attempt-001", category: "CAPTION_READABILITY", sceneId: "S01", reason: "long" });
const B2 = issue({ attemptId: "attempt-002", category: "CAPTION_READABILITY", sceneId: "S01", reason: "long" });
const B3 = issue({ attemptId: "attempt-002", category: "SILENCE", startMs: 500, endMs: 4000, reason: "gap" });

runTest("QD1 resolved (in before, gone after)", () => {
  const d = QD.diffAttempts([A1, A2], [B2]);
  assert(d.resolved.length === 1, "one resolved, got " + d.resolved.length);
  assert(QD.fingerprintIssue(A1) === QD.fingerprintIssue(d.resolved[0]), "resolved is the black-frame issue");
});

runTest("QD2 persisting (same logical issue across attempts)", () => {
  const d = QD.diffAttempts([A1, A2], [B2]);
  assert(d.persisting.length === 1, "one persisting, got " + d.persisting.length);
});

runTest("QD3 new (only after)", () => {
  const d = QD.diffAttempts([A1, A2], [B2, B3]);
  assert(d.new.length === 1, "one new, got " + d.new.length);
  assert(QD.fingerprintIssue(B3) === QD.fingerprintIssue(d.new[0]), "new is the silence issue");
});

runTest("QD4 stable id (same inputs equal, field order irrelevant)", () => {
  const x = QD.fingerprintIssue({ category: "BLACK_FRAME", startMs: 2500, endMs: 4500, reason: "tail" });
  const y = QD.fingerprintIssue({ reason: "tail", endMs: 4500, startMs: 2500, category: "BLACK_FRAME" });
  assert(x === y, "stable: " + x);
  assert(/^[0-9a-f]{16}$/.test(x), "sha256-16 hex");
  const z = QD.fingerprintIssue({ category: "BLACK_FRAME", startMs: 2500, endMs: 4501, reason: "tail" });
  assert(z !== x, "different tuple -> different id");
});

runTest("QD5 same attemptId diff -> throws ATTEMPT_MISMATCH", () => {
  let threw = false;
  try {
    QD.diffAttempts([A1], [A2]);
  } catch (e) {
    threw = e && e.code === "ATTEMPT_MISMATCH";
  }
  assert(threw, "ATTEMPT_MISMATCH");
});

runTest("QD6 new BLOCKER -> guardrail BLOCKED_FINAL", () => {
  const open = QD.attemptGuardrail([
    issue({ category: "TEXT_CLIPPING", severity: "BLOCKER", status: "OPEN" })
  ]);
  assert(open === "BLOCKED_FINAL", "blocked, got " + open);
  const errOpen = QD.attemptGuardrail([
    issue({ category: "VISUAL_GAP", severity: "ERROR", status: "OPEN" })
  ]);
  assert(errOpen === "BLOCKED_FINAL", "error also blocks");
  const clear = QD.attemptGuardrail([
    issue({ category: "TEXT_CLIPPING", severity: "BLOCKER", status: "RESOLVED" }),
    issue({ category: "NOTE", severity: "INFO", status: "OPEN" })
  ]);
  assert(clear === "CLEAR", "resolved/waived do not block, got " + clear);
});

console.log("\n=== SUMMARY test-qa-diff QD1-QD6 ===");
console.log("passed=" + passed + " failed=" + failed);
console.log(failed === 0 ? "RESULT: PASS" : "RESULT: FAIL");
process.exit(failed === 0 ? 0 : 1);
