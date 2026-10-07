"use strict";

/**
 * POST-PHASE-2 F2 — storage validation (spec §17 Cases L/N/P + safety rules).
 * Runs against synthetic fixture roots (never the real AppData root).
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const REPO = path.join(__dirname, "..", "..");
const store = require(REPO + "/lib/runtime-storage/index.js");

let passed = 0;
let failed = 0;
function assert(c, m) {
  if (!c) throw new Error("ASSERTION FAILED: " + m);
  console.log("  ok  " + m);
}
function assertEq(a, b, m) {
  if (a !== b) throw new Error(`ASSERTION FAILED: ${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
  console.log("  ok  " + m);
}
async function runTest(name, fn) {
  console.log("[TEST] " + name);
  try { await fn(); passed += 1; console.log("[PASS] " + name); }
  catch (e) { failed += 1; console.log("[FAIL] " + name + " — " + e.message); }
}

function fakeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rt-store-"));
  const mk = (rel, files, content = "x".repeat(100)) => {
    const dir = path.join(root, rel);
    fs.mkdirSync(dir, { recursive: true });
    for (const f of files) fs.writeFileSync(path.join(dir, f), content);
  };
  mk("pw-flow-profile/OptGuideOnDeviceModel", ["model.bin", "model2.bin"]);
  mk("pw-flow-profile/Default", ["Cookies", "Preferences"], "AUTH-DATA");
  mk("pw-flow-profile/GPUCache", ["cache.bin"]);
  mk("secrets", ["device-private-key.dpapi"], "PROTECTED-BLOB");
  mk("tmp", ["junk.tmp"]);
  fs.writeFileSync(path.join(root, "flow-bridge-token"), "secret-token-hex");
  return root;
}

(async () => {
await runTest("Case L — scan inventories every root with lifecycle classification", async () => {
  const root = fakeRoot();
  const s = store.scan({ root });
  assertEq(s.ok, true, "scan ok");
  const byPath = Object.fromEntries(s.inventory.map((i) => [i.path, i]));
  assertEq(byPath["pw-flow-profile/OptGuideOnDeviceModel"].lifecycle, "CACHE", "model cache classified");
  assertEq(byPath["pw-flow-profile/Default"].lifecycle, "DURABLE", "profile auth DURABLE");
  assertEq(byPath["pw-flow-profile/Default"].sensitivity, "SENSITIVE_AUTH", "auth sensitivity");
  assertEq(byPath["secrets"].lifecycle, "SECURE_DURABLE", "secrets SECURE_DURABLE");
  assertEq(byPath["pw-flow-profile/OptGuideOnDeviceModel"].cleanupEligible, true, "cache cleanable");
  assertEq(byPath["pw-flow-profile/Default"].cleanupEligible, false, "auth never cleaned");
  assert(byPath["secrets"].sizeBytes > 0, "sizes measured");
  const unknown = s.inventory.find((i) => i.owner === "unknown");
  if (unknown) assertEq(unknown.cleanupEligible, false, "unclassified entries default to keep (no unclassified large deletes)");
  // Dominant owner identified.
  assert(s.inventory[0].sizeBytes >= s.inventory[1].sizeBytes, "inventory sorted by size");
});

await runTest("Case N — dry-run: candidates + reclaimable bytes, ZERO deletion", async () => {
  const root = fakeRoot();
  const before = fs.readdirSync(path.join(root, "pw-flow-profile", "OptGuideOnDeviceModel"));
  const r = store.cleanup({ root, dryRun: true });
  assertEq(r.mode, "DRY_RUN", "dry-run mode");
  assertEq(r.removed.length, 0, "nothing removed");
  assert(r.reclaimableBytes > 0, "reclaimable bytes reported");
  assert(r.candidates.some((c) => c.path.includes("OptGuideOnDeviceModel")), "model cache is a candidate");
  assert(!r.candidates.some((c) => c.path === "pw-flow-profile/Default"), "auth never a candidate");
  const after = fs.readdirSync(path.join(root, "pw-flow-profile", "OptGuideOnDeviceModel"));
  assertEq(after.length, before.length, "files untouched");
});

await runTest("Real clean: only CACHE/EPHEMERAL removed; auth/secrets/token intact; idempotent", async () => {
  const root = fakeRoot();
  const r1 = store.cleanup({ root, dryRun: false });
  assertEq(r1.ok, true, "clean ok");
  assert(r1.reclaimedBytes > 0, "bytes reclaimed");
  assert(!fs.existsSync(path.join(root, "pw-flow-profile", "OptGuideOnDeviceModel")), "cache dir removed");
  assert(fs.existsSync(path.join(root, "pw-flow-profile", "Default", "Cookies")), "auth intact");
  assert(fs.readFileSync(path.join(root, "flow-bridge-token"), "utf8") === "secret-token-hex", "token intact");
  assert(fs.existsSync(path.join(root, "secrets", "device-private-key.dpapi")), "secrets intact");
  // Idempotent: second run removes nothing.
  const r2 = store.cleanup({ root, dryRun: false });
  assertEq(r2.removed.length, 0, "second clean is a no-op");
});

await runTest("Safety: symlink escape rejected; active session lock skips cleanup", async () => {
  const root = fakeRoot();
  // Windows junction pointing OUTSIDE the root.
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "rt-outside-"));
  fs.writeFileSync(path.join(outside, "precious.txt"), "keep");
  const cacheDir = path.join(root, "pw-flow-profile", "OptGuideOnDeviceModel");
  fs.rmSync(cacheDir, { recursive: true });
  let made = false;
  try {
    fs.symlinkSync(outside, cacheDir, "junction");
    made = true;
  } catch {
    console.log("  skip junction creation (privilege)"); 
  }
  if (made) {
    const r = store.cleanup({ root, dryRun: false });
    assert(r.skipped.some((s) => s.reason === "SYMLINK_ESCAPE_REJECTED"), "symlink escape rejected");
    assert(fs.existsSync(path.join(outside, "precious.txt")), "outside target untouched");
  }
  // Active session lock.
  const root2 = fakeRoot();
  fs.writeFileSync(path.join(root2, ".session-active"), "live");
  const r2 = store.cleanup({ root: root2, dryRun: false });
  assertEq(r2.skippedActiveSession, true, "cleanup skipped during active session");
  assertEq(r2.removed.length, 0, "nothing removed under lock");
});

await runTest("Growth trend helper: scan→clean→scan shows disposable classes bounded", async () => {
  const root = fakeRoot();
  const s1 = store.scan({ root });
  store.cleanup({ root, dryRun: false });
  // Simulate one "generation cycle" regenerating a small cache.
  fs.mkdirSync(path.join(root, "pw-flow-profile", "GPUCache"), { recursive: true });
  fs.writeFileSync(path.join(root, "pw-flow-profile", "GPUCache", "c.bin"), "x".repeat(50));
  const s2 = store.scan({ root });
  const d1 = s1.inventory.find((i) => i.path === "pw-flow-profile/GPUCache");
  const d2 = s2.inventory.find((i) => i.path === "pw-flow-profile/GPUCache");
  assert(d2.sizeBytes < d1.sizeBytes, "disposable class does not grow unbounded across cycles");
});

console.log(`\n=== runtime-storage: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
})();
