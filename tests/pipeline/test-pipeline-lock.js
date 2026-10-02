"use strict";
// STEP-13 Branch C — pipeline-lock tests LK1-LK8 via the real pipeline-lock.
// No production data.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const PID = "__13_lk__";
const Lock = require("../../pipeline/pipeline-lock.js");

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
function projDir() { return path.join(ROOT, "projects", PID); }
function lockAbs(pid) {
  return path.join(ROOT, "projects", pid || PID, "pipeline", "lock.json");
}
function cleanup() {
  [PID, "__13_lk_b__"].forEach((p) => {
    try { fs.rmSync(path.join(ROOT, "projects", p), { recursive: true, force: true }); } catch (e) {}
  });
  try { fs.rmSync(path.join(ROOT, "..", "evil"), { recursive: true, force: true }); } catch (e) {}
}

cleanup();

runTest("LK1 acquire ok", () => {
  const r = Lock.acquire(ROOT, PID, "lk1");
  assert(r.stale === false, "fresh acquire");
  assert(r.lock.pid === process.pid, "owner pid recorded");
  assert(fs.existsSync(lockAbs()), "lock file written");
});

runTest("LK2 second acquire same project -> LOCK_HELD", () => {
  let threw = false;
  try {
    Lock.acquire(ROOT, PID, "lk2-second");
  } catch (e) {
    threw = /LOCK_HELD/.test(e.message);
  }
  assert(threw, "expected LOCK_HELD");
});

runTest("LK3 release -> re-acquire ok", () => {
  assert(Lock.release(ROOT, PID) === true, "released");
  assert(!fs.existsSync(lockAbs()), "lock file gone");
  const r = Lock.acquire(ROOT, PID, "lk3");
  assert(r.stale === false, "re-acquired fresh");
});

runTest("LK4 stale lock (dead pid + old heartbeat) -> acquire returns stale:true", () => {
  Lock.release(ROOT, PID);
  const stale = {
    projectId: PID, pid: 999999, hostname: "dead-host",
    acquiredAt: new Date(Date.now() - 600000).toISOString(),
    heartbeatAt: new Date(Date.now() - 600000).toISOString(),
    operation: "dead-op"
  };
  fs.mkdirSync(path.dirname(lockAbs()), { recursive: true });
  fs.writeFileSync(lockAbs(), JSON.stringify(stale, null, 2));
  const r = Lock.acquire(ROOT, PID, "lk4");
  assert(r.stale === true, "stale flagged, got " + JSON.stringify(r.stale));
  assert(r.lock.pid === 999999, "stale lock surfaced, not deleted");
  assert(fs.existsSync(lockAbs()), "stale lock file left for reconcile");
});

runTest("LK5 fresh lock never stolen (pid unchanged)", () => {
  Lock.clearStale(ROOT, PID, { confirmedStale: true });
  const r = Lock.acquire(ROOT, PID, "lk5-owner");
  assert(r.stale === false, "fresh");
  let threw = false;
  try {
    Lock.acquire(ROOT, PID, "lk5-thief");
  } catch (e) {
    threw = /LOCK_HELD/.test(e.message);
  }
  assert(threw, "fresh lock held");
  const cur = JSON.parse(fs.readFileSync(lockAbs(), "utf8"));
  assert(cur.pid === process.pid && cur.operation === "lk5-owner", "lock file pid/owner unchanged");
  Lock.release(ROOT, PID);
});

runTest("LK6 confirmed-stale reconcile via clearStale removes", () => {
  Lock.acquire(ROOT, PID, "lk6");
  Lock.release(ROOT, PID);
  const stale = {
    projectId: PID, pid: 999999, hostname: "dead",
    acquiredAt: new Date(Date.now() - 600000).toISOString(),
    heartbeatAt: new Date(Date.now() - 600000).toISOString(),
    operation: "dead"
  };
  fs.mkdirSync(path.dirname(lockAbs()), { recursive: true });
  fs.writeFileSync(lockAbs(), JSON.stringify(stale, null, 2));
  let noConfirm = false;
  try {
    Lock.clearStale(ROOT, PID, {});
  } catch (e) {
    noConfirm = /STALE_NOT_CONFIRMED/.test(e.message);
  }
  assert(noConfirm, "clearStale requires confirmedStale");
  assert(Lock.clearStale(ROOT, PID, { confirmedStale: true }) === true, "cleared");
  assert(!fs.existsSync(lockAbs()), "lock file removed");
});

runTest("LK7 different projects independent", () => {
  const a = Lock.acquire(ROOT, PID, "lk7a");
  const b = Lock.acquire(ROOT, "__13_lk_b__", "lk7b");
  assert(a.stale === false && b.stale === false, "both acquired");
  Lock.release(ROOT, PID);
  Lock.release(ROOT, "__13_lk_b__");
});

runTest("LK8 traversal projectId rejected", () => {
  let threw = false;
  try {
    Lock.acquire(ROOT, "../../evil", "lk8");
  } catch (e) {
    threw = /PATH_TRAVERSAL_BLOCKED/.test(e.message);
  }
  assert(threw, "expected PATH_TRAVERSAL_BLOCKED");
  assert(!fs.existsSync(path.join(ROOT, "..", "evil", "pipeline", "lock.json")), "no lock escaped the repo");
});

cleanup();

console.log("\n=== SUMMARY test-pipeline-lock LK1-LK8 ===");
console.log("passed=" + passed + " failed=" + failed);
console.log(failed === 0 ? "RESULT: PASS" : "RESULT: FAIL");
process.exit(failed === 0 ? 0 : 1);
