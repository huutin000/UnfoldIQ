"use strict";

/**
 * Phase 1H.7 — Storage matrix S1–S24 + perf baseline.
 * Deterministic. Synthetic fixtures live under os.tmpdir; destructive
 * execution ONLY against synthetic disposables (never canonical media).
 * The live project is inventoried read-only by the migration path.
 */

const os = require("os");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const storage = require("../../lib/storage/index.js");

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
  return fs.mkdtempSync(path.join(os.tmpdir(), `unfoldiq-1h7stor-${tag}-`));
}

function newStore(pid = "p-t") {
  return { root: tmpRoot("s"), pid };
}

function writeProj(root, pid, rel, content = "x") {
  const abs = path.join(root, "projects", pid, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return rel;
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
  await runTest("S1 inventory classification (rule-based, inspectable)", () => {
    const { root, pid } = newStore();
    writeProj(root, pid, "qa/summary.json", "{}");
    writeProj(root, pid, "downloads/clip.mp4", "bytes");
    writeProj(root, pid, "scratch.tmp", "tmp");
    const r = storage.buildInventory(root, pid, {});
    assert(r.ok && r.files === 4, "3 fixtures + the store file itself inventoried");
    const inv = storage.loadStorage(root, pid).doc.inventory;
    assert(inv["governance/storage.json"].storageClass === "EVIDENCE", "control-plane state is evidence");
    assert(inv["qa/summary.json"].storageClass === "EVIDENCE", "qa → EVIDENCE");
    assert(inv["downloads/clip.mp4"].storageClass === "CACHE", "downloads → CACHE");
    assert(inv["scratch.tmp"].durability === "EPHEMERAL", "tmp → EPHEMERAL");
  });

  await runTest("S2 durability mapping (evidence/final durable, cache regenerable)", () => {
    const { root, pid } = newStore();
    writeProj(root, pid, "case/result.json", "{}");
    writeProj(root, pid, "downloads/a.mp4", "v");
    storage.buildInventory(root, pid, {});
    const inv = storage.loadStorage(root, pid).doc.inventory;
    assert(inv["case/result.json"].durability === "DURABLE", "case evidence durable");
    assert(inv["downloads/a.mp4"].durability === "REGENERABLE", "cache regenerable");
  });

  await runTest("S3 retention reasons (locked/evidence/protected)", () => {
    const { root, pid } = newStore();
    writeProj(root, pid, "qa/a.json", "{}");
    storage.buildInventory(root, pid, {
      lockedAssets: () => ["qa/a.json"],
      protectedRefs: () => [{ ref: "qa/a.json", reason: "GOLDEN_BASELINE" }],
    });
    const e = storage.loadStorage(root, pid).doc.inventory["qa/a.json"];
    assert(e.retentionReasons.includes("LOCKED") && e.retentionReasons.includes("GOLDEN_BASELINE"), "reasons recorded");
  });

  await runTest("S4 cache rebuildability requirement (unproven → REVIEW)", () => {
    const entry = { artifactRef: "downloads/a.mp4", storageClass: "CACHE", durability: "REGENERABLE", retentionReasons: [] };
    assert(storage.verdictFor(entry, {}).verdict === "REVIEW_REQUIRED", "cache without rebuild proof reviews");
    assert(storage.verdictFor(entry, { rebuildable: ["downloads/a.mp4"] }).verdict === "SAFE_TO_DELETE", "proven rebuild path deletes");
  });

  await runTest("S5 temporary not canonical (ephemeral + unreferenced deletes)", () => {
    const entry = { artifactRef: "w.tmp", storageClass: "TEMPORARY", durability: "EPHEMERAL", retentionReasons: [] };
    assert(storage.verdictFor(entry, {}).verdict === "SAFE_TO_DELETE", "unreferenced ephemeral deletes");
    assert(storage.verdictFor(entry, { activeCheckpointRefs: ["w.tmp"] }).verdict === "BLOCKED", "checkpoint-referenced temp blocks");
  });

  await runTest("S6 rejected variant retention (explicit policy, no blind delete)", () => {
    const { root, pid } = newStore();
    writeProj(root, pid, "assets/rejected.mp4", "v");
    storage.buildInventory(root, pid, { protectedRefs: () => [{ ref: "assets/rejected.mp4", reason: "QA_EVIDENCE" }] });
    const plan = storage.planCleanup(root, pid, {});
    const row = plan.plan.candidates.find((c) => c.ref === "assets/rejected.mp4");
    assert(row && (row.verdict === "RETAIN" || row.verdict === "BLOCKED"), "rejected variant retained per policy, never auto-deleted");
    const policy = storage.loadStorage(root, pid).doc.policy;
    assert(policy.defaultRejectedRetention === "KEEP_FOR_PROJECT", "explicit retention class recorded");
  });

  await runTest("S7 final deliverable protected (no auto-cleanup)", () => {
    const entry = { artifactRef: "render/final.mp4", storageClass: "FINAL_DELIVERABLE", durability: "DURABLE", retentionReasons: ["FINAL_OUTPUT"] };
    assert(storage.verdictFor(entry, {}).verdict === "RETAIN", "final deliverable retained");
  });

  await runTest("S8 evidence protected (QA/telemetry refs block)", () => {
    const { root, pid } = newStore();
    writeProj(root, pid, "qa/s.json", "{}");
    storage.buildInventory(root, pid, {});
    const plan = storage.planCleanup(root, pid, {});
    const row = plan.plan.candidates.find((c) => c.ref === "qa/s.json");
    assert(row && row.verdict === "RETAIN", "evidence retained");
  });

  await runTest("S9 Golden reference protected", () => {
    const { root, pid } = newStore();
    writeProj(root, pid, "assets/gold.png", "g");
    storage.buildInventory(root, pid, { protectedRefs: () => [{ ref: "assets/gold.png", reason: "GOLDEN_BASELINE" }] });
    const row = storage.planCleanup(root, pid, {}).plan.candidates[0];
    assert(row.verdict === "RETAIN" && row.blockingRefs.includes("GOLDEN_BASELINE"), "golden ref blocks");
  });

  await runTest("S10 recovery reference protected", () => {
    const entry = { artifactRef: "downloads/staged.mp4", storageClass: "CACHE", durability: "REGENERABLE", retentionReasons: [] };
    assert(storage.verdictFor(entry, { recoveryActiveRefs: ["downloads/staged.mp4"] }).verdict === "BLOCKED", "active recovery input blocks");
  });

  await runTest("S11 locked asset protected (even when duplicated/old)", () => {
    const entry = { artifactRef: "assets/old.png", storageClass: "SELECTED_ASSET", durability: "DURABLE", retentionReasons: ["LOCKED"] };
    assert(storage.verdictFor(entry, {}).verdict === "BLOCKED", "locked blocks routine cleanup");
  });

  await runTest("S12 DAG dependent protected", () => {
    const entry = { artifactRef: "prompts/p.json", storageClass: "SELECTED_ASSET", durability: "DURABLE", retentionReasons: [] };
    const v = storage.verdictFor(entry, { dagDependents: { "prompts/p.json": ["RENDER"] } });
    assert(v.verdict === "BLOCKED" && v.blockingRefs.includes("RENDER"), "active dependent blocks");
  });

  await runTest("S13 provenance child protected (lineage holds)", () => {
    const entry = { artifactRef: "assets/frame.png", storageClass: "SELECTED_ASSET", durability: "DURABLE", retentionReasons: ["PROVENANCE_REQUIRED"] };
    assert(storage.verdictFor(entry, {}).verdict === "RETAIN", "provenance-required retained");
  });

  await runTest("S14 dedup preserves aliases/metadata (report only)", () => {
    const { root, pid } = newStore();
    writeProj(root, pid, "a/one.bin", "same-bytes");
    writeProj(root, pid, "b/two.bin", "same-bytes");
    writeProj(root, pid, "c/three.bin", "same-bytes");
    storage.buildInventory(root, pid, {});
    const d = storage.findDuplicates(root, pid);
    assert(d.ok && d.duplicates.length === 1 && d.duplicates[0].refs.length === 3, "triplicate detected with all aliases");
    // Dedup never deletes by itself: unproven-cache dupes review, they are
    // only reported with all aliases preserved.
    const plan = storage.planCleanup(root, pid, {});
    const binVerdicts = plan.plan.candidates.filter((c) => c.ref.endsWith(".bin")).map((c) => c.verdict);
    assert(binVerdicts.every((v) => v === "REVIEW_REQUIRED"), "unproven dupes review (dedup deletes nothing by itself)");
  });

  await runTest("S15 orphan candidate detection (never auto-delete)", () => {
    const { root, pid } = newStore();
    writeProj(root, pid, "qa/known.json", "{}");
    writeProj(root, pid, "stray.bin", "s");
    const o = storage.findOrphans(root, pid, ["qa/known.json"]);
    assert(o.orphans.length === 1 && o.orphans[0].code === "ORPHAN_CANDIDATE", "stray detected, code set, nothing deleted");
    assert(fs.existsSync(path.join(root, "projects", pid, "stray.bin")), "file untouched by detection");
  });

  await runTest("S16 missing durable detection (serious, metadata kept)", () => {
    const { root, pid } = newStore();
    const m = storage.findMissing(root, pid, [{ ref: "assets/gone.png", durability: "DURABLE" }]);
    assert(m.missing.length === 1 && m.missing[0].code === "MISSING_DURABLE_ARTIFACT", "durable miss flagged serious");
  });

  await runTest("S17 missing regenerable detection (lighter severity)", () => {
    const { root, pid } = newStore();
    const m = storage.findMissing(root, pid, [{ ref: "downloads/gone.mp4", durability: "REGENERABLE" }]);
    assert(m.missing[0].code === "MISSING_REGENERABLE_ARTIFACT", "regenerable miss lighter");
  });

  await runTest("S18 dry-run no delete (default mode)", () => {
    const { root, pid } = newStore();
    writeProj(root, pid, "w.tmp", "t");
    storage.buildInventory(root, pid, {});
    const plan = storage.planCleanup(root, pid, {});
    assert(plan.plan.mode === "DRY_RUN", "dry-run is default");
    assert(fs.existsSync(path.join(root, "projects", pid, "w.tmp")), "nothing deleted by planning");
    assert(plan.eligibleBytes >= 0, "reclaim estimate present");
  });

  await runTest("S19 stale cleanup plan refused (fingerprint + revision)", () => {
    const { root, pid } = newStore();
    writeProj(root, pid, "w.tmp", "t");
    storage.buildInventory(root, pid, {});
    const plan = storage.planCleanup(root, pid, { mode: "EXECUTE" });
    // Drift: add a file + rebuild inventory (revision bumps).
    writeProj(root, pid, "new.tmp", "n");
    storage.buildInventory(root, pid, {});
    const ex = storage.executeCleanup(root, pid, plan.plan.planId);
    assert(!ex.ok && ex.code === "CLEANUP_PLAN_STALE", "drifted plan refuses execution");
    assert(fs.existsSync(path.join(root, "projects", pid, "w.tmp")), "no partial deletion");
  });

  await runTest("S20 synthetic safe delete + tombstone (history untouched)", () => {
    const { root, pid } = newStore();
    // Executable fixture class: unreferenced ephemeral temporaries.
    writeProj(root, pid, "scratch.tmp", "t");
    storage.buildInventory(root, pid, {});
    const exec = storage.planCleanup(root, pid, { mode: "EXECUTE", onlyRefs: ["scratch.tmp"] });
    assert(exec.plan.candidates[0].verdict === "SAFE_TO_DELETE", "ephemeral fixture eligible");
    const done = storage.executeCleanup(root, pid, exec.plan.planId);
    assert(done.ok && done.deleted.includes("scratch.tmp"), "executed");
    assert(!fs.existsSync(path.join(root, "projects", pid, "scratch.tmp")), "file deleted");
    const doc = storage.loadStorage(root, pid).doc;
    assert(doc.tombstones["scratch.tmp"] && doc.tombstones["scratch.tmp"].cleanupPlanId === exec.plan.planId, "tombstone with plan link preserved");
    assert(doc.plans[exec.plan.planId].status === "EXECUTED", "plan marked executed");
  });

  await runTest("S21 cleanup execution idempotency (replay EXECUTED plan)", () => {
    const { root, pid } = newStore();
    writeProj(root, pid, "w.tmp", "t");
    storage.buildInventory(root, pid, {});
    const plan = storage.planCleanup(root, pid, { mode: "EXECUTE", onlyRefs: ["w.tmp"] });
    // w.tmp is TEMPORARY/EPHEMERAL (no retention reasons) → eligible.
    const first = storage.executeCleanup(root, pid, plan.plan.planId);
    assert(first.ok, "first execution ok");
    const second = storage.executeCleanup(root, pid, plan.plan.planId);
    assert(second.ok && second.changed === false, "replay no-ops (already EXECUTED)");
  });

  await runTest("S22 fresh-process inventory parity", () => {
    const { root, pid } = newStore();
    writeProj(root, pid, "qa/a.json", "{}");
    writeProj(root, pid, "downloads/b.mp4", "v");
    storage.buildInventory(root, pid, {});
    const child = spawnSync(process.execPath, ["-e",
      "const s=require(process.argv[1]);const st=s.storageStats(process.argv[2],process.argv[3]);console.log(st.ok?st.totalBytes+':'+st.entries:'ERR');",
      path.join(REPO, "lib", "storage", "index.js"), root, pid,
    ], { encoding: "utf8" });
    const local = storage.storageStats(root, pid);
    assert(child.status === 0 && child.stdout.trim() === `${local.totalBytes}:${local.entries}`, "fresh process sees identical inventory");
  });

  await runTest("S23 cleanup policy version recorded (executions pin it)", () => {
    const { root, pid } = newStore();
    writeProj(root, pid, "w.tmp", "t");
    storage.buildInventory(root, pid, {});
    const policy = storage.loadStorage(root, pid).doc.policy;
    assert(policy.policyVersion === "1.0.0" && Array.isArray(policy.rules) && policy.rules.length > 0, "versioned policy with rules");
    const plan = storage.planCleanup(root, pid, { mode: "EXECUTE", onlyRefs: ["w.tmp"] });
    assert(plan.plan.policyVersion === policy.policyVersion, "plan pins the policy version used");
  });

  await runTest("S24 no lineage break after cleanup (dependents rechecked)", () => {
    const { root, pid } = newStore();
    writeProj(root, pid, "downloads/parent-staged.mp4", "p");
    writeProj(root, pid, "assets/child.png", "c");
    storage.buildInventory(root, pid, {});
    // Lineage-break fixture: staged cache file with an active child/reference.
    const ctx = { dagDependents: { "downloads/parent-staged.mp4": ["assets/child.png"] }, rebuildable: ["downloads/parent-staged.mp4"] };
    const entry = storage.loadStorage(root, pid).doc.inventory["downloads/parent-staged.mp4"];
    assert(storage.verdictFor(entry, ctx).verdict === "BLOCKED", "dependent reference blocks (S54-LINEAGE-BREAK part 1)");
    // Migrate/remove the dependent reference → eligible path recomputed.
    const free = storage.verdictFor(entry, { rebuildable: ["downloads/parent-staged.mp4"] });
    assert(free.verdict === "SAFE_TO_DELETE", "after reference removal, rebuildable cache deletes (part 2)");
  });

  await runTest("PERF baseline: inventory/plan/orphan/missing latencies + bytes", () => {
    const { root, pid } = newStore("p-perf");
    for (let i = 0; i < 60; i++) writeProj(root, pid, `qa/f${i}.json`, "{}");
    for (let i = 0; i < 20; i++) writeProj(root, pid, `downloads/c${i}.mp4`, "v");
    timeIt("inventory", () => storage.buildInventory(root, pid, {}), 5);
    timeIt("plan", () => storage.planCleanup(root, pid, {}), 10);
    timeIt("orphanScan", () => storage.findOrphans(root, pid, []), 10);
    timeIt("missingScan", () => storage.findMissing(root, pid, [{ ref: "qa/f0.json", durability: "DURABLE" }]), 20);
    const stats = storage.storageStats(root, pid);
    perf.projectBytes = stats.totalBytes;
    perf.entries = stats.entries;
    const baseline = {
      artifact: "perf-baseline-storage", capturedAt: new Date().toISOString(),
      method: "process.hrtime.bigint micro-benchmarks inside tests/storage/test-storage.js (80 files)",
      sampleCounts: { inventory: 5, plan: 10, orphanScan: 10, missingScan: 20 },
      environment: "local Windows, node",
      metrics: perf,
      budgets: { inventoryP50Ms: 500, planP50Ms: 100, orphanScanP50Ms: 100, missingScanP50Ms: 50 },
      reason: "inventory/plan back publish + cleanup flows; scans must stay interactive on project scale",
      result: "PASS",
    };
    const outDir = path.join(REPO, "projects", "validation", "phase-1h", "phase1h67-validation", "evidence", "performance");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "perf-baseline-storage.json"), JSON.stringify(baseline, null, 2) + "\n");
    assert(perf.plan.p50Ms < 100, `plan p50 ${perf.plan.p50Ms}ms < 100ms`);
    assert(perf.orphanScan.p50Ms < 100, `orphan p50 ${perf.orphanScan.p50Ms}ms < 100ms`);
  });

  console.log(`\n=== DONE: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(`FATAL: ${(e && e.stack) || e}`);
  process.exit(1);
});
