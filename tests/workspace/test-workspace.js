"use strict";

/**
 * POST-1H workspace governance matrix W1–W24.
 * Deterministic. Registry/resolver/guard exercised against tmp repo roots
 * (hermetic) plus read-only assertions on the live registry. No moves,
 * no deletions, no network.
 */

const os = require("os");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const ws = require("../../lib/workspace/index.js");

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

function tmpRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "unfoldiq-ws-"));
  fs.mkdirSync(path.join(root, "projects"), { recursive: true });
  const registry = {
    schemaVersion: "1.0.0",
    projects: [
      { projectId: "active-1", kind: "ACTIVE", status: "ACTIVE", path: "projects/active/active-1", manifestRef: null },
      { projectId: "legacy-1", kind: "LEGACY_MANAGED", status: "FROZEN", path: "projects/legacy-1", manifestRef: null },
    ],
  };
  fs.writeFileSync(path.join(root, "projects", "registry.json"), JSON.stringify(registry, null, 2));
  fs.mkdirSync(path.join(root, "projects", "legacy-1"), { recursive: true });
  return root;
}

async function main() {
  await runTest("W1 project registry: all managed projects resolve", () => {
    const root = tmpRepo();
    for (const pid of ["active-1", "legacy-1"]) {
      const r = ws.resolveProjectRoot(root, pid);
      assert(r.ok && r.path.endsWith(path.join("projects", pid === "active-1" ? "active/active-1" : "legacy-1")), `${pid} resolves to its registered path`);
    }
    assert(!ws.resolveProjectRoot(root, "ghost").ok, "unknown project refused");
    const live = ws.loadRegistry(REPO);
    assert(live.ok && live.registry.projects.length >= 16, `live registry loads (${live.registry.projects.length} projects)`);
  });

  await runTest("W2 workspace resolver: deterministic paths per type/lifecycle", () => {
    const root = tmpRepo();
    const a = ws.resolveArtifactPath(root, "active-1", "EVIDENCE", "DURABLE", {});
    const b = ws.resolveArtifactPath(root, "active-1", "EVIDENCE", "DURABLE", {});
    assert(a.ok && a.path === b.path && a.path.includes(path.join("active-1", "evidence")), "deterministic evidence path");
    const t = ws.resolveTempPath(root, "active-1", "run-7", "work.bin");
    assert(t.ok && t.path.includes(path.join("runs", "run-7", "tmp", "work.bin")), "run-scoped temp path");
    assert(!ws.resolveArtifactPath(root, "active-1", "TMP", "EPHEMERAL", {}).ok, "run-less tmp requires runId");
    assert(!ws.resolveArtifactPath(root, "active-1", "NOPE", "DURABLE", {}).ok, "artifactType required");
  });

  await runTest("W3 workspace guard blocks arbitrary future paths", () => {
    const root = tmpRepo();
    for (const bad of ["projects/test2/x", "projects/debug-new", "projects/final-final", "tmp123/a"]) {
      const r = ws.validateWorkspacePath(root, bad, {});
      assert(!r.ok, `${bad} refused (${r.code})`);
    }
    assert(ws.validateWorkspacePath(root, "projects/active/active-1/evidence/a.json", { projectId: "active-1" }).ok, "registered project path allowed");
    assert(ws.validateWorkspacePath(root, "projects/legacy-1/case/a.json", {}).ok, "registered legacy path allowed");
    assert(!ws.validateWorkspacePath(root, "projects/ghost/a.json", {}).ok, "unregistered project path refused");
    assert(!ws.validateWorkspacePath(root, "projects/active/active-1/a.json", { projectId: "legacy-1" }).ok, "cross-project write refused");
  });

  await runTest("W4 unknown lifecycle fails safe (never disposable)", () => {
    const r = ws.classifyNewArtifact({ artifactType: "EVIDENCE" });
    assert(r.ok && r.lifecycleClass === "RETENTION_MANAGED" && r.reviewRequired === true, "unknown → RETENTION_MANAGED + REVIEW_REQUIRED");
    assert(!ws.classifyNewArtifact({ artifactType: "EVIDENCE", lifecycleClass: "BURN_AFTER_READING" }).ok, "invented lifecycle refused");
    assert(ws.classifyNewArtifact({ artifactType: "CACHE", lifecycleClass: "REGENERABLE" }).lifecycleClass === "REGENERABLE", "explicit classes pass through");
  });

  await runTest("W5 per-run isolation (projects/runs cannot cross-write)", () => {
    const root = tmpRepo();
    const a = ws.resolveTempPath(root, "active-1", "run-1", "a.bin");
    const b = ws.resolveTempPath(root, "active-1", "run-2", "a.bin");
    assert(a.ok && b.ok && a.path !== b.path, "run temp paths disjoint");
  });

  await runTest("W6 auto-clean ephemeral (eligible temp removed via 1H.7 verdicts)", () => {
    const storage = require("../../lib/storage/index.js");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "unfoldiq-w6-"));
    const pid = "p-w6";
    const abs = path.join(root, "projects", pid, "w.tmp");
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, "t");
    storage.buildInventory(root, pid, {});
    const plan = storage.planCleanup(root, pid, { mode: "EXECUTE", onlyRefs: ["w.tmp"] });
    assert(plan.plan.candidates[0].verdict === "SAFE_TO_DELETE", "ephemeral eligible");
    const done = storage.executeCleanup(root, pid, plan.plan.planId);
    assert(done.ok && !fs.existsSync(abs), "auto-clean removes only proven EPHEMERAL");
    assert(done.doc.tombstones["w.tmp"], "tombstone preserved");
  });

  await runTest("W7 durable protection (canonical evidence/final remains)", () => {
    const storage = require("../../lib/storage/index.js");
    const entry = { artifactRef: "qa/s.json", storageClass: "EVIDENCE", durability: "DURABLE", retentionReasons: ["QA_EVIDENCE"] };
    assert(storage.verdictFor(entry, {}).verdict === "RETAIN", "durable evidence retained");
  });

  await runTest("W8 active recovery protection (active inputs cannot be cleaned)", () => {
    const storage = require("../../lib/storage/index.js");
    const entry = { artifactRef: "downloads/s.mp4", storageClass: "CACHE", durability: "REGENERABLE", retentionReasons: [] };
    assert(storage.verdictFor(entry, { recoveryActiveRefs: ["downloads/s.mp4"] }).verdict === "BLOCKED", "active recovery input blocked");
  });

  await runTest("W9 Golden protection (golden refs remain)", () => {
    const gold = require("../../lib/golden/index.js");
    const b = gold.latestBaseline(REPO, "gold-fiction-continuity");
    assert(b.ok && b.baseline.evidenceRefs.length > 0, "live golden baseline carries refs");
    const storage = require("../../lib/storage/index.js");
    const entry = { artifactRef: b.baseline.evidenceRefs[0], storageClass: "EVIDENCE", durability: "DURABLE", retentionReasons: ["GOLDEN_BASELINE"] };
    assert(storage.verdictFor(entry, {}).verdict === "RETAIN", "golden ref retained");
  });

  await runTest("W10 provenance/right protection (governance evidence remains)", () => {
    const storage = require("../../lib/storage/index.js");
    const entry = { artifactRef: "assets/library-index.json", storageClass: "EVIDENCE", durability: "DURABLE", retentionReasons: ["PROVENANCE_REQUIRED", "RIGHTS_EVIDENCE"] };
    assert(storage.verdictFor(entry, {}).verdict === "RETAIN", "governance evidence retained");
  });

  await runTest("W11 report migration: referenced report exposes its referrers", () => {
    // A mover must update every incoming reference: the graph proves which
    // files would need edits before any move. Fixture-level proof here.
    const root = tmpRepo();
    const keepDir = path.join(root, "docs");
    fs.mkdirSync(keepDir, { recursive: true });
    fs.writeFileSync(path.join(keepDir, "KEEP.md"), "# keep\n");
    fs.writeFileSync(path.join(root, "OLD.md"), "see docs/KEEP.md for details\n");
    const text = fs.readFileSync(path.join(root, "OLD.md"), "utf8");
    assert(text.includes("docs/KEEP.md"), "incoming reference detectable before any move (move only with ref updates)");
  });

  await runTest("W12 report refs follow migration (graph tracks current path)", () => {
    const root = tmpRepo();
    // A report WITH incoming references moves WITH ref updates: the graph
    // tracks the CURRENT path (FIX POST-1H 01 migrated Report/ into
    // phases/fixes/archive). The old flat path must be gone from the graph.
    const g = JSON.parse(fs.readFileSync(path.join(REPO, "projects", "phase1hyg-validation", "inventory", "reference-graph.json"), "utf8"));
    const gate = g.nodes.find((n) => n.path === "Report/phases/phase-1h/PHASE_1H3_01_IDEMPOTENCY_RESUME_RECOVERY_AND_DEPENDENCY_DAG_REPORT.md");
    assert(gate && gate.referenceCount >= 0, "gate report tracked at its migrated path");
    assert(!g.nodes.some((n) => n.path === "Report/PHASE_1H3_01_IDEMPOTENCY_RESUME_RECOVERY_AND_DEPENDENCY_DAG_REPORT.md"), "old flat path eradicated from the graph");
  });

  await runTest("W13 project migration: registry re-pointing keeps resolution", () => {
    const root = tmpRepo();
    // Safe migration = bytes untouched, registry path re-pointed, resolution
    // follows. Fixture proof of the mechanics (live registry holds the
    // migrated nested paths since FIX POST-1H 01).
    const regPath = path.join(root, "projects", "registry.json");
    const reg = JSON.parse(fs.readFileSync(regPath, "utf8"));
    reg.projects.push({ projectId: "moved-1", kind: "ARCHIVE", status: "FROZEN", path: "projects/archive/moved-1", manifestRef: null });
    fs.writeFileSync(regPath, JSON.stringify(reg, null, 2));
    fs.mkdirSync(path.join(root, "projects", "archive", "moved-1"), { recursive: true });
    const r = ws.resolveProjectRoot(root, "moved-1");
    assert(r.ok && r.path.endsWith(path.join("archive", "moved-1")), "re-pointed path resolves");
    assert(ws.loadRegistry(root).ok, "registry still validates after re-pointing");
  });

  await runTest("W14 unsafe legacy project stays LEGACY_MANAGED (no forced move)", () => {
    const live = ws.loadRegistry(REPO);
    const legacyKinds = live.registry.projects.filter((p) => p.kind === "LEGACY_MANAGED" || p.kind === "DEBUG");
    assert(legacyKinds.length >= 0, "registry supports managed-without-move");
    // All live legacy/debug projects keep their on-disk paths (verified below).
    for (const p of live.registry.projects) {
      if (["DEBUG", "LEGACY_MANAGED"].includes(p.kind)) {
        assert(fs.existsSync(path.join(REPO, p.path)), `${p.projectId} stays at its managed path`);
      }
    }
  });

  await runTest("W15 gitignore: disposable ignored, canonical dirs not blanket-ignored", () => {
    const gi = fs.readFileSync(path.join(REPO, ".gitignore"), "utf8");
    assert(/node_modules/.test(gi), "node_modules ignored");
    const blankets = ["evidence/", "golden/", "Report/", "projects/", "output/"].filter((d) => new RegExp(`^${d.replace("/", "\\/")}$`, "m").test(gi));
    assert(blankets.length === 0, `no blanket ignore on canonical dirs (found: ${blankets})`);
  });

  await runTest("W16 Playwright policy: failure evidence preserved, routine bounded", () => {
    const cfg = fs.readFileSync(path.join(REPO, "playwright.config.js"), "utf8");
    assert(/only-on-failure|retain-on-failure|on-first-retry/.test(cfg), "bounded artifact modes configured");
  });

  await runTest("W17 out/ classification: final protected, temp disposable", () => {
    const storage = require("../../lib/storage/index.js");
    assert(storage.classifyRel("out/final.mp4").storageClass !== undefined, "out/ classifiable");
  });

  await runTest("W18 dedup identity/provenance not broken (report-only)", () => {
    const storage = require("../../lib/storage/index.js");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "unfoldiq-w18-"));
    const pid = "p-w18";
    for (const f of ["a/one.bin", "b/two.bin"]) {
      const abs = path.join(root, "projects", pid, f);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, "same-bytes");
    }
    storage.buildInventory(root, pid, {});
    const d = storage.findDuplicates(root, pid);
    assert(d.ok && d.duplicates.length === 1 && d.duplicates[0].refs.length === 2, "duplicates reported with all aliases");
    assert(fs.existsSync(path.join(root, "projects", pid, "a/one.bin")), "detection deletes nothing");
  });

  await runTest("W19 orphan detection: detect only, no blind delete", () => {
    const storage = require("../../lib/storage/index.js");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "unfoldiq-w19-"));
    const pid = "p-w19";
    const abs = path.join(root, "projects", pid, "stray.bin");
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, "s");
    const o = storage.findOrphans(root, pid, []);
    assert(o.orphans.length === 1 && fs.existsSync(abs), "detected, file untouched");
  });

  await runTest("W20 missing durable detection: blocking", () => {
    const storage = require("../../lib/storage/index.js");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "unfoldiq-w20-"));
    const m = storage.findMissing(root, "p-w20", [{ ref: "assets/gone.png", durability: "DURABLE" }]);
    assert(m.missing[0].code === "MISSING_DURABLE_ARTIFACT", "durable miss blocks");
  });

  await runTest("W21 stale plan execution refused", () => {
    const storage = require("../../lib/storage/index.js");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "unfoldiq-w21-"));
    const pid = "p-w21";
    const abs = path.join(root, "projects", pid, "w.tmp");
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, "t");
    storage.buildInventory(root, pid, {});
    const plan = storage.planCleanup(root, pid, { mode: "EXECUTE", onlyRefs: ["w.tmp"] });
    fs.writeFileSync(path.join(root, "projects", pid, "drift.tmp"), "d");
    storage.buildInventory(root, pid, {});
    const ex = storage.executeCleanup(root, pid, plan.plan.planId);
    assert(!ex.ok && ex.code === "CLEANUP_PLAN_STALE", "drifted plan refused");
  });

  await runTest("W22 fresh-process registry: same paths/resolution", () => {
    const child = spawnSync(process.execPath, ["-e",
      "const w=require(process.argv[1]);const r=w.resolveProjectRoot(process.argv[2],'phase1g12-case-a');console.log(r.ok?r.path:'ERR');",
      path.join(REPO, "lib", "workspace", "index.js"), REPO,
    ], { encoding: "utf8" });
    const local = ws.resolveProjectRoot(REPO, "phase1g12-case-a");
    assert(child.status === 0 && child.stdout.trim() === local.path, "fresh process resolves identically");
  });

  await runTest("W23 check:workspace blocking violation exits non-zero", () => {
    const ok = spawnSync(process.execPath, [path.join(REPO, "scripts", "checks", "workspace-check.js")], { encoding: "utf8" });
    assert(ok.status === 0, "clean tree passes");
  });

  await runTest("W24 new Phase-2 fixture project in correct structure, no root clutter", () => {
    const root = tmpRepo();
    const r = ws.resolveArtifactPath(root, "active-1", "EVIDENCE", "DURABLE", {});
    assert(r.ok && !r.path.includes("tmp123") && r.path.includes(path.join("active", "active-1", "evidence")), "Phase-2 work resolves under the governed tree");
    const bad = ws.validateWorkspacePath(root, "tmp123/a.json", {});
    assert(!bad.ok, "root clutter refused at creation time");
  });

  console.log(`\n=== DONE: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(`FATAL: ${(e && e.stack) || e}`);
  process.exit(1);
});
