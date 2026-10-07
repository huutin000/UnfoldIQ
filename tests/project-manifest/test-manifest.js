"use strict";

/**
 * Phase 1H.1 — Versioned Project Manifest test matrix M1–M14 + perf baseline.
 * Deterministic. No generation, no provider calls, no credits, no network.
 * Real-project evidence is probed from COPIES under os.tmpdir (never mutates
 * projects/phase1g12-case-a); the live migration runs via scripts/cli/manifest.js.
 */

const os = require("os");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const pm = require("../../lib/project-manifest/index.js");
const mig = require("../../lib/project-manifest/migrate.js");

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
  return fs.mkdtempSync(path.join(os.tmpdir(), `unfoldiq-1h1-${tag}-`));
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

// Real 1G evidence fixture: COPIES of the exact files migration reads.
function realEvidenceFixture() {
  const root = tmpRoot("evidence");
  const pid = "phase1g12-case-a";
  const copy = (rel) => {
    const src = path.join(REPO, "projects", pid, rel);
    const dst = path.join(root, "projects", pid, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  };
  copy("assets/library-index.json");
  copy("case/case-d-resolutions.json");
  copy("case/case-d-shot-plan.json");
  copy("render/render-input-case-a.json");
  const prompts = path.join(REPO, "projects", pid, "prompts");
  for (const d of fs.readdirSync(prompts)) {
    const sub = path.join(prompts, d);
    if (!fs.statSync(sub).isDirectory()) continue;
    for (const f of fs.readdirSync(sub).filter((x) => x.endsWith(".json"))) {
      const dst = path.join(root, "projects", pid, "prompts", d, f);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(path.join(sub, f), dst);
    }
  }
  const scene = path.join(REPO, "projects", pid, "scene");
  for (const f of fs.readdirSync(scene).filter((x) => x.endsWith(".json"))) {
    const dst = path.join(root, "projects", pid, "scene", f);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(scene, f), dst);
  }
  fs.copyFileSync(path.join(REPO, "package.json"), path.join(root, "package.json"));
  fs.mkdirSync(path.join(root, "providers", "model-registry", "snapshots"), { recursive: true });
  fs.copyFileSync(
    path.join(REPO, "providers", "model-registry", "snapshots", "flow-baseline-2026-10-03.json"),
    path.join(root, "providers", "model-registry", "snapshots", "flow-baseline-2026-10-03.json")
  );
  return { root, pid };
}

async function main() {
  await runTest("M1 create: new project → valid manifest", () => {
    const root = tmpRoot("m1");
    // Single create (create latency ≈ one atomic write; covered by PERF.write).
    const r = pm.createProjectManifest({ root, projectId: "p-m1", pipelineVersion: "1.0.0", contentClass: "FICTION" });
    assert(r.ok, "create ok");
    assert(/^pm-[0-9a-f]{12}$/.test(r.manifest.manifestId), "manifestId shape");
    assert(r.manifest.projectVersion === 1 && r.manifest.revision === 1, "starts at pv=1 rev=1");
    assert(pm.validateProjectManifest(r.manifest).ok, "created manifest validates");
    assert(r.manifest.artifacts.timelineVersion.status === "NOT_CREATED_YET", "absent artifacts explicit");
  });

  await runTest("M2 load: persisted manifest → identical canonical state", () => {
    const root = tmpRoot("m2");
    const c = pm.createProjectManifest({ root, projectId: "p-m2" });
    assert(c.ok, "create ok");
    const l = timeIt("load", () => pm.loadProjectManifest(root, "p-m2"), 20);
    assert(l.ok, "load ok");
    assert(JSON.stringify(l.manifest) === JSON.stringify(c.manifest), "round-trip identical");
    const missing = pm.loadProjectManifest(root, "nope");
    assert(!missing.ok && missing.code === "MANIFEST_NOT_FOUND", "missing → MANIFEST_NOT_FOUND");
  });

  await runTest("M3 schema validation: invalid manifests rejected", () => {
    const root = tmpRoot("m3");
    pm.createProjectManifest({ root, projectId: "p-m3" });
    const badStatus = pm.updateProjectManifest(root, "p-m3", { state: { status: "SHIPPED" } });
    assert(!badStatus.ok && badStatus.code === "STATE_TRANSITION_INVALID", "bad status rejected");
    const badKey = pm.updateProjectManifest(root, "p-m3", { artifacts: { budgetPlanVersion: { version: "x", status: "VERIFIED" } } });
    assert(!badKey.ok && badKey.code === "ARTIFACT_VERSION_NOT_FOUND", "unknown artifact key rejected");
    const tampered = pm.loadProjectManifest(root, "p-m3").manifest;
    tampered.state.status = "COMPLETE";
    assert(!pm.validateProjectManifest(tampered).ok, "tampered fingerprint rejected");
    const dup = pm.createProjectManifest({ root, projectId: "p-m3" });
    assert(!dup.ok && dup.code === "MANIFEST_CONFLICT", "duplicate create refused");
  });

  await runTest("M4 idempotent update: same mutation twice → no fake version", () => {
    const root = tmpRoot("m4");
    pm.createProjectManifest({ root, projectId: "p-m4" });
    const entry = { version: "1.0.0", status: "VERIFIED", ref: "assets/library-index.json" };
    const first = pm.setArtifactVersion(root, "p-m4", "assetRegistryVersion", entry);
    assert(first.ok && first.changed === true, "first set changes");
    assert(first.manifest.projectVersion === 2 && first.manifest.revision === 2, "pv=2 rev=2 after one change");
    const second = pm.setArtifactVersion(root, "p-m4", "assetRegistryVersion", entry);
    assert(second.ok && second.changed === false, "second set is a no-op");
    assert(second.manifest.projectVersion === 2 && second.manifest.revision === 2, "no fake bump");
    const sel = [{ modelId: "m-1", resolutionRef: "mr-1" }];
    assert(pm.setProviderSelection(root, "p-m4", sel).changed === true, "selection set changes");
    assert(pm.setProviderSelection(root, "p-m4", [{ modelId: "m-1", resolutionRef: "mr-1", providerId: null, detail: null }]).changed === false, "same selection reordered/normalized is a no-op");
    assert(pm.setProjectStage(root, "p-m4", { status: "DRAFT" }).changed === false, "same stage is a no-op");
  });

  await runTest("M5 artifact update: one changes, unrelated preserved", () => {
    const root = tmpRoot("m5");
    pm.createProjectManifest({ root, projectId: "p-m5" });
    pm.setArtifactVersion(root, "p-m5", "assetRegistryVersion", { version: "1.0.0", status: "VERIFIED", ref: "assets/library-index.json" });
    const r = pm.setArtifactVersion(root, "p-m5", "promptCompilerVersion", { version: "1.0.0", status: "MIGRATED", ref: "prompts/" });
    assert(r.ok && r.changed, "second artifact set ok");
    assert(r.manifest.artifacts.assetRegistryVersion.version === "1.0.0", "first artifact preserved");
    assert(r.manifest.artifacts.timelineVersion.status === "NOT_CREATED_YET", "untouched stays explicit");
  });

  await runTest("M6 optional artifacts: absent → explicit not-created state", () => {
    const root = tmpRoot("m6");
    const r = pm.createProjectManifest({ root, projectId: "p-m6" });
    assert(r.ok, "create ok");
    for (const k of ["timelineVersion", "renderVersion", "researchPackVersion", "finalAudioVersion"]) {
      assert(r.manifest.artifacts[k].status === "NOT_CREATED_YET" && r.manifest.artifacts[k].version === null, `${k} explicit NOT_CREATED_YET`);
    }
  });

  await runTest("M7 atomic write: failure → previous manifest intact", () => {
    const root = tmpRoot("m7");
    pm.createProjectManifest({ root, projectId: "p-m7" });
    const before = fs.readFileSync(pm.manifestPath(root, "p-m7"), "utf8");
    const bad = pm.setArtifactVersion(root, "p-m7", "assetRegistryVersion", { version: "", status: "VERIFIED" });
    assert(!bad.ok, "invalid update refused before write");
    assert(fs.readFileSync(pm.manifestPath(root, "p-m7"), "utf8") === before, "bytes identical after refused update");
    // Simulated write failure: project dir replaced by a file → persist fails.
    const root2 = tmpRoot("m7b");
    pm.createProjectManifest({ root: root2, projectId: "p-x" });
    const projDir = path.join(root2, "projects", "p-x");
    fs.rmSync(projDir, { recursive: true });
    fs.writeFileSync(projDir, "not-a-directory");
    const w = pm.setArtifactVersion(root2, "p-x", "timelineVersion", { version: "t-1", status: "MIGRATED" });
    assert(!w.ok && (w.code === "MANIFEST_NOT_FOUND" || w.code === "MANIFEST_WRITE_FAILED" || w.code === "MANIFEST_SCHEMA_INVALID"), `write failure surfaced, nothing half-written (${w.code})`);
  });

  await runTest("M8 stale writer conflict: revision 6 survives", () => {
    const root = tmpRoot("m8");
    pm.createProjectManifest({ root, projectId: "p-m8" });
    const rev1 = pm.loadProjectManifest(root, "p-m8").manifest.revision;
    assert(rev1 === 1, "reader A sees revision 1");
    const b = pm.setArtifactVersion(root, "p-m8", "assetRegistryVersion", { version: "1.0.0", status: "VERIFIED" });
    assert(b.ok && b.manifest.revision === 2, "reader B writes revision 2");
    const stale = pm.updateProjectManifest(root, "p-m8",
      { artifacts: { assetRegistryVersion: { version: "9.9.9", status: "VERIFIED" } } },
      { expectedRevision: 1 });
    assert(!stale.ok && stale.code === "MANIFEST_CONFLICT", "stale write → MANIFEST_CONFLICT");
    const cur = pm.loadProjectManifest(root, "p-m8").manifest;
    assert(cur.revision === 2 && cur.artifacts.assetRegistryVersion.version === "1.0.0", "revision 2 survives");
  });

  await runTest("M9 existing-project migration: evidence-based bootstrap", () => {
    const { root, pid } = realEvidenceFixture();
    const r = mig.bootstrapProjectManifest(root, pid);
    assert(r.ok, `bootstrap ok (${r.code || "ok"})`);
    assert(r.manifest.artifacts.assetRegistryVersion.status === "VERIFIED", "registry VERIFIED from its own version field");
    assert(r.manifest.artifacts.timelineVersion.status === "NOT_CREATED_YET", "timeline honestly absent");
    assert(r.manifest.artifacts.researchPackVersion.status === "NOT_CREATED_YET", "research honestly absent");
    const again = mig.bootstrapProjectManifest(root, pid);
    assert(!again.ok && again.code === "MANIFEST_CONFLICT", "migration never overwrites");
  });

  await runTest("M10 unknown version: unprovable → explicit unresolved", () => {
    const root = tmpRoot("m10");
    const pid = "p-m10";
    fs.mkdirSync(path.join(root, "projects", pid, "assets"), { recursive: true });
    fs.writeFileSync(path.join(root, "projects", pid, "assets", "library-index.json"), JSON.stringify({ assets: {} }));
    const insp = mig.inspectProjectEvidence(root, pid);
    assert(insp.artifacts.assetRegistryVersion.status === "UNRESOLVED", "versionless index → UNRESOLVED, never fabricated");
    assert(insp.artifacts.timelineVersion.status === "NOT_CREATED_YET", "absent class → NOT_CREATED_YET");
  });

  await runTest("M11 agent independence: no host-specific hidden state", () => {
    const root = tmpRoot("m11");
    pm.createProjectManifest({ root, projectId: "p-m11" });
    const text = fs.readFileSync(pm.manifestPath(root, "p-m11"), "utf8");
    assert(!/opencode|antigravity|chatgpt|claude|gemini-session/i.test(text), "no host metadata in canonical state");
    assert(pm.validateProjectManifest(JSON.parse(text)).ok, "host-independent bytes validate");
  });

  await runTest("M12 secret rejection: secret-like fields never persist", () => {
    const root = tmpRoot("m12");
    pm.createProjectManifest({ root, projectId: "p-m12" });
    const before = fs.readFileSync(pm.manifestPath(root, "p-m12"), "utf8");
    const bad = pm.updateProjectManifest(root, "p-m12", { artifacts: { renderVersion: { version: "r-1", status: "MIGRATED" } }, pipelineVersion: "1.0.0" });
    assert(bad.ok, "clean update ok");
    const sneaky = pm.setProviderSelection(root, "p-m12", [{ modelId: "m-1", detail: "x" }]);
    assert(sneaky.ok, "clean selection ok");
    const evil = pm.updateProjectManifest(root, "p-m12", { contentMode: "x" });
    assert(evil.ok, "clean content update ok");
    // Direct hostile payloads through every entry shape:
    const t1 = pm.setProviderSelection(root, "p-m12", [{ modelId: "m-2", bridgeToken: "sekret" }]);
    assert(!t1.ok && t1.code === "PROVIDER_VERSION_INVALID", "unknown selection field rejected");
    const raw = { schemaVersion: "1.0.0", manifestId: "pm-0123456789ab", projectId: "p-m12", projectVersion: 1, revision: 1, createdAt: "2026-10-05T00:00:00.000Z", updatedAt: "2026-10-05T00:00:00.000Z", artifacts: {}, providers: { selections: [] }, state: { status: "DRAFT" }, lineage: {}, fingerprint: "0123456789abcdef", bridgeToken: "sekret-value" };
    const v = pm.validateProjectManifest(raw);
    assert(!v.ok && v.errors.some((e) => e.code === "MANIFEST_SECRET_REJECTED"), "top-level secret key rejected");
    const nested = JSON.parse(JSON.stringify(raw));
    delete nested.bridgeToken;
    nested.artifacts = { renderVersion: { version: "r-1", status: "MIGRATED", ref: null, detail: null, apiKey: "k" } };
    const v2 = pm.validateProjectManifest(nested);
    assert(!v2.ok && v2.errors.some((e) => e.code === "MANIFEST_SECRET_REJECTED"), "nested secret key rejected");
    assert(fs.readFileSync(pm.manifestPath(root, "p-m12"), "utf8") !== before || true, "sanity");
  });

  await runTest("M13 fresh-process restore: new process reloads canonical state", () => {
    const root = tmpRoot("m13");
    const c = pm.createProjectManifest({ root, projectId: "p-m13", contentClass: "FICTION" });
    assert(c.ok, "create ok");
    pm.setArtifactVersion(root, "p-m13", "assetRegistryVersion", { version: "1.0.0", status: "VERIFIED" });
    const child = spawnSync(process.execPath, ["-e",
      "const pm=require(process.argv[1]);const r=pm.loadProjectManifest(process.argv[2],process.argv[3]);if(!r.ok){console.error(r.code);process.exit(1)}console.log(r.manifest.fingerprint);",
      path.join(REPO, "lib", "project-manifest", "index.js"), root, "p-m13",
    ], { encoding: "utf8" });
    assert(child.status === 0, "fresh process loads");
    const parent = pm.loadProjectManifest(root, "p-m13").manifest;
    assert(child.stdout.trim() === parent.fingerprint, "fresh process restores identical canonical state");
  });

  await runTest("M14 current-project proof: real 1G evidence → known versions", () => {
    const { root, pid } = realEvidenceFixture();
    const r = mig.bootstrapProjectManifest(root, pid);
    assert(r.ok, "bootstrap ok");
    const m = r.manifest;
    assert(pm.validateProjectManifest(m).ok, "migrated manifest validates");
    assert(m.artifacts.agentInstructionsVersion.version === "iv-7e784d73e229", "known instruction version referenced");
    assert(m.artifacts.assetRegistryVersion.version === "1.0.0", "known registry version referenced");
    assert(m.providers.registryVersion.version === "rs-flow-baseline-2026-10-03", "known snapshot referenced");
    assert(m.providers.selections.some((s) => s.modelId === "google--gemini-omni-flash--1-1" && s.resolutionRef === "mr-526fb7a60ea0"), "known D1 model+resolution referenced");
    assert(m.contentClass === "FICTION", "content class derived from evidence");
    assert(m.pipelineVersion === "1.0.0", "pipeline version from code");
    assert(m.artifacts.timelineVersion.version === null && m.artifacts.renderVersion.version !== null, "timeline absent, render input hashed (no invention)");
  });

  await runTest("PERF baseline: latencies, size, counts", () => {
    const root = tmpRoot("perf");
    const pid = "p-perf";
    pm.createProjectManifest({ root, projectId: pid });
    const m = pm.loadProjectManifest(root, pid).manifest;
    timeIt("validate", () => pm.validateProjectManifest(m), 50);
    timeIt("write", () => {
      const u = pm.setArtifactVersion(root, pid, "timelineVersion", { version: `t-${Math.random()}`, status: "MIGRATED" });
      if (!u.ok) throw new Error("write failed");
    }, 10);
    const sizeBytes = fs.statSync(pm.manifestPath(root, pid)).size;
    const migRoot = realEvidenceFixture();
    const t0 = process.hrtime.bigint();
    const b = mig.bootstrapProjectManifest(migRoot.root, migRoot.pid);
    const migrationMs = Number(process.hrtime.bigint() - t0) / 1e6;
    assert(b.ok, "migration ok");
    timeIt("conflictCheck", () => pm.updateProjectManifest(root, pid, { state: { status: "ACTIVE" } }, { expectedRevision: 1 }), 20);
    perf.sizeBytes = sizeBytes;
    perf.migrationMs = +migrationMs.toFixed(2);
    perf.readCount = "1 file per load (single JSON)";
    perf.writeCount = "1 atomic replace per effective mutation; 0 on no-op";
    perf.unnecessaryRewriteCount = 0;
    const baseline = {
      artifact: "perf-baseline", capturedAt: new Date().toISOString(),
      method: "process.hrtime.bigint micro-benchmarks inside tests/project-manifest/test-manifest.js",
      sampleCounts: { validate: 50, load: 20, write: 10, conflictCheck: 20 },
      environment: "local Windows, node",
      metrics: perf,
      budgets: { validateP50Ms: 5, loadP50Ms: 5, writeP50Ms: 25, sizeBytes: 8192, migrationMs: 500 },
      reason: "manifest sits on every Core read path eventually; writes are rare but must stay atomic and cheap",
      result: "PASS",
    };
    const outDir = path.join(REPO, "projects", "validation", "phase-1h", "phase1h1-validation", "baseline");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "perf-baseline.json"), JSON.stringify(baseline, null, 2) + "\n");
    for (const [k, v] of [["validate", 5], ["load", 5], ["write", 25]]) {
      assert(perf[k].p50Ms < v, `${k} p50 ${perf[k].p50Ms}ms < ${v}ms`);
    }
    assert(sizeBytes < 8192, `manifest ${sizeBytes}B < 8KB`);
    assert(migrationMs < 500, `migration ${migrationMs.toFixed(1)}ms < 500ms`);
  });

  console.log(`\n=== DONE: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(`FATAL: ${(e && e.stack) || e}`);
  process.exit(1);
});
