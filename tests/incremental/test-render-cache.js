"use strict";
// tests/incremental/test-render-cache.js — Phase 5B cache cases:
// H (identity) · M (corrupt) · N (crash write) · O (single-flight) ·
// P/Q (GC dry-run/real) · R (rights) · S (immutable hit) · T (freshness) ·
// security guards · AK (metrics). No renders.

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const cache = require("../../lib/render-cache/index.js");

let passed = 0;
let failed = 0;
function runTest(name, fn) {
  return Promise.resolve().then(fn).then(
    () => { passed++; console.log("[PASS] " + name); },
    (e) => { failed++; console.log("[FAIL] " + name + ": " + ((e && e.message) || e)); });
}
function assert(c, m) { if (!c) throw new Error("ASSERT: " + m); }
function mkroot() { return fs.mkdtempSync(path.join(os.tmpdir(), "5b-cache-")); }
function rmroot(r) { fs.rmSync(r, { recursive: true, force: true }); }
function keyFor(tag) {
  return cache.actionKey({ actionType: "scene-render", schemaVersion: "1.0.0", inputs: [{ name: "scene", hash: tag }] });
}
function publish(root, key, bytes, extra) {
  const blob = cache.writeBlob(root, Buffer.from(bytes));
  return cache.publishAction(root, Object.assign({
    actionKey: key, actionType: "scene-render", schemaVersion: "1.0.0",
    inputs: [{ name: "scene", hash: key.slice(0, 8) }],
    toolVersions: {}, policyVersions: {}, outputContentHashes: [blob.hash],
  }, extra || {}));
}

(async () => {
await runTest("H same ActionKey twice + CAS dedupe identical bytes", () => {
  const root = mkroot();
  try {
    const k = keyFor("s1");
    assert(k === keyFor("s1"), "deterministic key");
    const b1 = cache.writeBlob(root, Buffer.from("same-bytes"));
    const b2 = cache.writeBlob(root, Buffer.from("same-bytes"));
    assert(b1.hash === b2.hash, "content identity, no duplicate bytes");
    publish(root, k, "chunk-bytes");
    const hit = cache.lookup(root, k, {});
    assert(hit.status === "HIT_VALID", "valid hit");
    assert(fs.readFileSync(path.join(root, hit.cachedArtifactRef)).toString() === "chunk-bytes", "bytes addressable");
  } finally { rmroot(root); }
});

await runTest("S immutable research extraction: safe hit", () => {
  const root = mkroot();
  try {
    const src = "source-content-hash-abc";
    const k = cache.actionKey({ actionType: "research-extraction", schemaVersion: "1.0.0", inputs: [{ name: "source", hash: src }], toolVersions: { extractor: "v3" }, policyVersions: {} });
    const blob = cache.writeBlob(root, Buffer.from("extracted-claims"));
    cache.publishAction(root, { actionKey: k, actionType: "research-extraction", schemaVersion: "1.0.0", inputs: [{ name: "source", hash: src }], toolVersions: { extractor: "v3" }, policyVersions: {}, outputContentHashes: [blob.hash] });
    const hit = cache.lookup(root, k, { toolVersions: { extractor: "v3" } });
    assert(hit.status === "HIT_VALID", "immutable extraction reuses");
  } finally { rmroot(root); }
});

await runTest("T current/latest research: freshness prevents indefinite reuse", () => {
  const root = mkroot();
  try {
    const k = keyFor("news");
    publish(root, k, "fresh-today");
    assert(cache.lookup(root, k, {}).status === "HIT_VALID", "fresh hit");
    const rep = cache.gc(root, { dryRun: true, maxAgeDays: 0 });
    assert(rep.removed >= 1, "expired under freshness policy: " + JSON.stringify(rep.reasons));
  } finally { rmroot(root); }
});

await runTest("M corrupt blob: detect, quarantine via GC, recompute", () => {
  const root = mkroot();
  try {
    const k = keyFor("m1");
    const rec = publish(root, k, "good-bytes");
    const blobAbs = path.join(root, "CAS", "sha256", rec.outputContentHashes[0]);
    fs.writeFileSync(blobAbs, Buffer.from("tampered!!"));
    const hit = cache.lookup(root, k, {});
    assert(hit.status === "HIT_INVALID" && hit.reason === "HASH_MISMATCH", "tamper detected: " + hit.reason);
    const rep = cache.gc(root, { dryRun: false });
    assert(rep.corruptEntries === 1 && rep.removed === 1, "corrupt evicted: " + JSON.stringify(rep));
    assert(cache.lookup(root, k, {}).status === "MISS", "recompute path open (MISS, never stale bytes)");
  } finally { rmroot(root); }
});

await runTest("N crash during cache write: no valid ActionRecord", () => {
  const root = mkroot();
  try {
    fs.mkdirSync(path.join(root, "actions"), { recursive: true });
    fs.mkdirSync(path.join(root, "tmp"), { recursive: true });
    // Simulate crash: partial temp write never renamed/published.
    fs.writeFileSync(path.join(root, "tmp", "action-123-incomplete.json"), '{"actionKey":"dead');
    assert(cache.lookup(root, "dead", {}).status === "MISS", "partial write invisible");
    let threw = 0;
    try { cache.publishAction(root, { actionKey: "empty", actionType: "scene-render", schemaVersion: "1.0.0", inputs: [], toolVersions: {}, policyVersions: {}, outputContentHashes: [] }); }
    catch (e) { threw++; }
    assert(threw === 1, "contentless publish refused");
  } finally { rmroot(root); }
});

await runTest("O concurrent same-key request: one useful compute", async () => {
  let calls = 0;
  const m = cache.newMetrics();
  const work = () => cache.withSingleFlight("k9", async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 50));
    return "result";
  }, m);
  const outs = await Promise.all([work(), work(), work(), work(), work()]);
  assert(calls === 1, "computed once, got " + calls);
  assert(outs.every((o) => o === "result"), "all callers share result");
  assert(m.singleFlightDedupes === 4, "dedupe counted");
});

await runTest("P GC dry-run deletes nothing", () => {
  const root = mkroot();
  try {
    const k = keyFor("p1");
    publish(root, k, "keepable");
    assert(cache.lookup(root, k, {}).status === "HIT_VALID", "present before");
    const rep = cache.gc(root, { dryRun: true, maxAgeDays: 0 });
    assert(rep.dryRun === true && rep.removed >= 1, "would remove " + rep.removed);
    assert(cache.lookup(root, k, {}).status === "HIT_VALID", "dry-run removed nothing");
  } finally { rmroot(root); }
});

await runTest("Q GC real run: only eligible removed, pinned skipped", () => {
  const root = mkroot();
  try {
    const kOld = keyFor("old");
    const kPin = keyFor("pin");
    publish(root, kOld, "stale-bytes");
    publish(root, kPin, "pinned-bytes", { pinned: true, pinClasses: ["operator-pinned"] });
    const rep = cache.gc(root, { dryRun: false, maxAgeDays: 0 });
    assert(rep.removed === 1 && rep.pinnedSkipped === 1, "selective GC: " + JSON.stringify({ removed: rep.removed, pinned: rep.pinnedSkipped }));
    assert(cache.lookup(root, kOld, {}).status === "MISS", "stale gone");
    assert(cache.lookup(root, kPin, {}).status === "HIT_VALID", "pinned survives");
  } finally { rmroot(root); }
});

await runTest("R rights state change blocks reuse; revoked blocks reuse", () => {
  const root = mkroot();
  try {
    const k = keyFor("r1");
    publish(root, k, "rights-bytes");
    const blocked = cache.lookup(root, k, {}, { rightsOk: () => false });
    assert(blocked.status === "HIT_INVALID" && blocked.reason === "RIGHTS_STATE_CHANGED", "rights recheck: " + blocked.reason);
    fs.writeFileSync(path.join(root, "revoked.json"), JSON.stringify([k]));
    const rev = cache.lookup(root, k, {}, { rightsOk: () => true });
    assert(rev.status === "HIT_INVALID" && rev.reason === "REVOKED", "revocation honored");
  } finally { rmroot(root); }
});

await runTest("security: traversal, symlink escape, secret store rejection", () => {
  const root = mkroot();
  try {
    let threw = 0;
    try { cache.assertSafeRel("../evil.json"); } catch (e) { threw++; }
    try { cache.assertSafeRel("C:\\Windows\\x"); } catch (e) { threw++; }
    try { cache.assertSafeRel("/abs/x"); } catch (e) { threw++; }
    assert(threw === 3, "traversal rejected");
    // Symlink escape: CAS/sha256 -> outside.
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "5b-outside-"));
    try {
      fs.mkdirSync(path.join(root, "CAS"), { recursive: true });
      fs.symlinkSync(outside, path.join(root, "CAS", "sha256"), "junction");
      let escaped = 0;
      try { cache.writeBlob(root, Buffer.from("x")); } catch (e) { escaped++; }
      assert(escaped === 1, "symlink escape blocked: ");
    } finally { rmroot(outside); }
    // Secrets check on a clean root (never mixed with the symlink fixture).
    const root2 = mkroot();
    try {
      let sec = 0;
      try {
        cache.publishAction(root2, { actionKey: "s", actionType: "prompt", schemaVersion: "1.0.0", inputs: [{ name: "api_key", hash: "h" }], toolVersions: {}, policyVersions: {}, outputContentHashes: ["0".repeat(64)] });
      } catch (e) { sec += /SECRET/.test(e.message) ? 1 : 0; }
      assert(sec === 1, "secret material never cached");
    } finally { rmroot(root2); }
  } finally { rmroot(root); }
});

await runTest("AK cache metrics visible + persisted", () => {
  const root = mkroot();
  try {
    const m = cache.newMetrics();
    m.lookups = 3; m.validHits = 2; m.misses = 1;
    m.missesByReason = { NOT_FOUND: 1 };
    m.bytesReused = 1024; m.framesReused = 90;
    cache.saveMetrics(root, m);
    const back = cache.loadMetrics(root);
    assert(back.lookups === 3 && back.validHits === 2 && back.bytesReused === 1024 && back.framesReused === 90, "metrics round-trip");
    assert(back.missesByReason.NOT_FOUND === 1, "miss reasons visible");
  } finally { rmroot(root); }
});

await runTest("qaKey binds artifact + rule + range; policy change invalidates", () => {
  const a = cache.qaKey({ artifactContentHash: "aa", qaRuleId: "black", qaRuleVersion: "1.0.0", analyzerVersion: "ff8", policyVersion: "p1", range: { startFrame: 0, endFrameExclusive: 90 } });
  const b = cache.qaKey({ artifactContentHash: "aa", qaRuleId: "black", qaRuleVersion: "1.0.0", analyzerVersion: "ff8", policyVersion: "p2", range: { startFrame: 0, endFrameExclusive: 90 } });
  const c = cache.qaKey({ artifactContentHash: "aa", qaRuleId: "black", qaRuleVersion: "1.0.0", analyzerVersion: "ff8", policyVersion: "p1", range: { startFrame: 0, endFrameExclusive: 90 } });
  assert(a !== b && a === c, "policy version participates; same inputs stable");
});

console.log("\n=== render-cache: " + passed + " passed, " + failed + " failed ===");
process.exit(failed > 0 ? 1 : 0);
})();
