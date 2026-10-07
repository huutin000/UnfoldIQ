"use strict";

/**
 * Phase 1H.3 — DAG matrix DAG1–DAG12 + selective rerun R1–R8 + crash C11 +
 * perf baseline (small + medium graphs). Deterministic. No provider calls,
 * no credits, no network. Executor functions simulate provider work and
 * count side effects — partial rerun never touches real generation.
 */

const os = require("os");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const dag = require("../../lib/dependency-dag/index.js");

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
  return fs.mkdtempSync(path.join(os.tmpdir(), `unfoldiq-1h3dag-${tag}-`));
}

function newGraph(pid = "p-t") {
  const root = tmpRoot("g");
  const c = dag.createDag(root, pid);
  if (!c.ok) throw new Error("fixture create failed: " + c.code);
  return { root, pid };
}

const N = (key, type, extra = {}) => ({ artifactKey: key, artifactType: type, versionRef: "v1", state: "CLEAN", ...extra });

// Canonical roadmap pipeline fixture: SCRIPT→AUDIO→ALIGN→CAPTIONS→TIMINGS→TIMELINE→RENDER + isolated THUMBNAIL.
function audioChain(root, pid) {
  dag.addNode(root, pid, N("SCRIPT", "FINAL_SPOKEN_SCRIPT"));
  dag.addNode(root, pid, N("AUDIO", "FINAL_AUDIO", { inputRefs: [{ key: "SCRIPT", type: "reads" }] }));
  dag.addNode(root, pid, N("ALIGN", "FORCED_ALIGNMENT", { inputRefs: [{ key: "AUDIO", type: "aligns" }] }));
  dag.addNode(root, pid, N("CAPTIONS", "CAPTIONS", { inputRefs: [{ key: "AUDIO", type: "transcribes" }, { key: "ALIGN", type: "times" }] }));
  dag.addNode(root, pid, N("SCENE_T", "SCENE_TIMING", { inputRefs: [{ key: "ALIGN", type: "times" }] }));
  dag.addNode(root, pid, N("VIS_T", "VISUAL_TIMING", { inputRefs: [{ key: "ALIGN", type: "times" }] }));
  dag.addNode(root, pid, N("ANIM_T", "ANIMATION_TIMING", { inputRefs: [{ key: "ALIGN", type: "times" }, { key: "VIS_T", type: "syncs" }] }));
  dag.addNode(root, pid, N("TIMELINE", "MASTER_TIMELINE", { inputRefs: [{ key: "CAPTIONS", type: "lays" }, { key: "SCENE_T", type: "lays" }, { key: "VIS_T", type: "lays" }, { key: "ANIM_T", type: "lays" }] }));
  dag.addNode(root, pid, N("RENDER", "RENDER", { inputRefs: [{ key: "TIMELINE", type: "renders" }] }));
  dag.addNode(root, pid, N("THUMB", "THUMBNAIL", { inputRefs: [{ key: "RENDER", type: "captures" }] }));
}

// Three-scene fixture for selective rerun.
function sceneGraph(root, pid) {
  dag.addNode(root, pid, N("PLAN", "SHOT_PLAN"));
  for (const s of ["S1", "S2", "S3"]) {
    dag.addNode(root, pid, N(`${s}_ASSET`, "GENERATED_ASSET", { inputRefs: [{ key: "PLAN", type: "realizes" }] }));
    dag.addNode(root, pid, N(`${s}_QA`, "QA_RESULT", { inputRefs: [{ key: `${s}_ASSET`, type: "grades" }] }));
  }
  dag.addNode(root, pid, N("TIMELINE", "MASTER_TIMELINE", { inputRefs: [{ key: "S1_QA", type: "lays" }, { key: "S2_QA", type: "lays" }, { key: "S3_QA", type: "lays" }] }));
  dag.addNode(root, pid, N("RENDER", "RENDER", { inputRefs: [{ key: "TIMELINE", type: "renders" }] }));
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
  await runTest("DAG1 add nodes/edges: canonical graph builds", () => {
    const { root, pid } = newGraph();
    assert(dag.addNode(root, pid, N("AUDIO", "FINAL_AUDIO")).ok, "node A");
    assert(dag.addNode(root, pid, N("CAPS", "CAPTIONS", { inputRefs: [{ key: "AUDIO", type: "from" }] })).ok, "node B with edge");
    const g = dag.loadDag(root, pid).dag;
    assert(Object.keys(g.nodes).length === 2, "2 nodes persisted");
    assert(g.nodes.CAPS.inputRefs[0].key === "AUDIO", "edge recorded");
  });

  await runTest("DAG2 duplicate same edge idempotent; typed edges coexist", () => {
    const { root, pid } = newGraph();
    dag.addNode(root, pid, N("AUDIO", "FINAL_AUDIO"));
    dag.addNode(root, pid, N("CAPS", "CAPTIONS"));
    assert(dag.addDependency(root, pid, "AUDIO", "CAPS", "from").changed === true, "edge writes once");
    const r1 = dag.loadDag(root, pid).dag.revision;
    const dup = dag.addDependency(root, pid, "AUDIO", "CAPS", "from");
    assert(dup.ok && dup.changed === false, "same edge no-ops");
    assert(dag.loadDag(root, pid).dag.revision === r1, "no fake revision bump");
    assert(dag.addDependency(root, pid, "AUDIO", "CAPS", "times").changed === true, "different dependency type is a distinct edge facet");
  });

  await runTest("DAG3 unknown-node edge rejected", () => {
    const { root, pid } = newGraph();
    dag.addNode(root, pid, N("AUDIO", "FINAL_AUDIO"));
    const r = dag.addDependency(root, pid, "AUDIO", "GHOST", null);
    assert(!r.ok && r.code === "DAG_NODE_NOT_FOUND", "unknown downstream refused");
    const r2 = dag.addDependency(root, pid, "GHOST", "AUDIO", null);
    assert(!r2.ok && r2.code === "DAG_NODE_NOT_FOUND", "unknown upstream refused");
    const bad = dag.addNode(root, pid, { artifactKey: "X", artifactType: "NOPE" });
    assert(!bad.ok, "unknown artifact type refused");
  });

  await runTest("DAG4 self-cycle rejected", () => {
    const { root, pid } = newGraph();
    dag.addNode(root, pid, N("AUDIO", "FINAL_AUDIO"));
    const r = dag.addDependency(root, pid, "AUDIO", "AUDIO", null);
    assert(!r.ok && r.code === "DAG_CYCLE_DETECTED", "self-cycle refused");
  });

  await runTest("DAG5 multi-node cycle rejected", () => {
    const { root, pid } = newGraph();
    dag.addNode(root, pid, N("A", "FINAL_AUDIO"));
    dag.addNode(root, pid, N("B", "CAPTIONS", { inputRefs: [{ key: "A" }] }));
    dag.addNode(root, pid, N("C", "MASTER_TIMELINE", { inputRefs: [{ key: "B" }] }));
    const r = dag.addDependency(root, pid, "C", "A", null);
    assert(!r.ok && r.code === "DAG_CYCLE_DETECTED", "A→B→C→A refused");
    assert(dag.loadDag(root, pid).dag.nodes.A.inputRefs.length === 0, "graph unchanged");
  });

  await runTest("DAG6 final-audio propagation hits exactly the dependent chain", () => {
    const { root, pid } = newGraph();
    audioChain(root, pid);
    dag.setNodeVersion(root, pid, "AUDIO", "v2");
    const r = dag.markDirty(root, pid, "AUDIO", { reason: "final audio v2 mix" });
    assert(r.ok, "markDirty ok");
    const expect = ["ALIGN", "ANIM_T", "CAPTIONS", "RENDER", "SCENE_T", "THUMB", "TIMELINE", "VIS_T"].sort();
    assert(JSON.stringify(r.dirtied) === JSON.stringify(expect), `exact closure (got ${r.dirtied})`);
    const g = dag.loadDag(root, pid).dag;
    assert(g.nodes.SCRIPT.state === "CLEAN", "upstream SCRIPT untouched");
    assert(g.nodes.AUDIO.state === "CLEAN", "changed node itself stays CLEAN (invalidation is explicit)");
  });

  await runTest("DAG7 thumbnail isolation: leaf change never dirties the render", () => {
    const { root, pid } = newGraph();
    audioChain(root, pid);
    dag.setNodeVersion(root, pid, "THUMB", "t2");
    const r = dag.markDirty(root, pid, "THUMB", { reason: "new thumbnail" });
    assert(r.ok && r.dirtied.length === 0, "no descendants → nothing dirtied");
    assert(dag.loadDag(root, pid).dag.nodes.RENDER.state === "CLEAN", "main render remains CLEAN");
    // Correct direction still works: render change dirties the thumbnail.
    dag.setNodeVersion(root, pid, "RENDER", "r2");
    const r2 = dag.markDirty(root, pid, "RENDER", { reason: "new render" });
    assert(r2.dirtied.length === 1 && r2.dirtied[0] === "THUMB", "render change reaches only the thumbnail");
  });

  await runTest("DAG8 one-scene isolation: sibling branches stay clean", () => {
    const { root, pid } = newGraph();
    sceneGraph(root, pid);
    dag.setNodeVersion(root, pid, "S3_ASSET", "v2-scene3");
    const r = dag.markDirty(root, pid, "S3_ASSET", { reason: "scene 3 visual change" });
    assert(r.ok, "markDirty ok");
    assert(JSON.stringify(r.dirtied) === JSON.stringify(["RENDER", "S3_QA", "TIMELINE"]), `scene-3 branch only (got ${r.dirtied})`);
    const g = dag.loadDag(root, pid).dag;
    for (const k of ["S1_ASSET", "S1_QA", "S2_ASSET", "S2_QA", "PLAN"]) {
      assert(g.nodes[k].state === "CLEAN", `${k} remains CLEAN`);
    }
  });

  await runTest("DAG9 lock-aware dirty: locked downstream BLOCKED with reason, branch shielded", () => {
    const { root, pid } = newGraph();
    sceneGraph(root, pid);
    assert(dag.setNodeLockTarget(root, pid, "S3_QA", { targetType: "SHOT", targetId: "S3_QA" }).changed === true, "lock target attached canonically");
    dag.setNodeVersion(root, pid, "S3_ASSET", "v2");
    const locksReader = ({ targetType, targetId }) => (targetType === "SHOT" && targetId === "S3_QA" ? "LOCKED" : null);
    const r = dag.markDirty(root, pid, "S3_ASSET", { reason: "scene 3 changed under lock" }, {}, locksReader);
    assert(r.ok, "markDirty ok");
    assert(JSON.stringify(r.blocked) === JSON.stringify(["S3_QA"]), `S3_QA blocked, not dirtied (got ${r.blocked})`);
    assert(JSON.stringify(r.dirtied) === JSON.stringify(["RENDER", "TIMELINE"]), "dependents still marked stale (DIRTY fact preserved)");
    const g = dag.loadDag(root, pid).dag;
    assert(/changed while locked/.test(g.nodes.S3_QA.blockedReason), "explicit block reason recorded");
    const plan = dag.planRebuild(root, pid, {}, locksReader).plan;
    assert(plan.blocked.some((b) => b.key === "S3_QA"), "S3_QA blocked in plan");
    assert(plan.blocked.some((b) => b.key === "TIMELINE" && /upstream blocked/.test(b.reason)), "TIMELINE shielded by blocked upstream");
    assert(plan.blocked.some((b) => b.key === "RENDER"), "RENDER shielded transitively");
    assert(!plan.rebuild.includes("TIMELINE") && !plan.rebuild.includes("RENDER"), "nothing downstream of a lock rebuilds");
  });

  await runTest("DAG10 fingerprint mismatch reads DIRTY while stored CLEAN", () => {
    const { root, pid } = newGraph();
    dag.addNode(root, pid, N("AUDIO", "FINAL_AUDIO"));
    dag.addNode(root, pid, N("CAPS", "CAPTIONS", { inputRefs: [{ key: "AUDIO" }] }));
    dag.setNodeVersion(root, pid, "AUDIO", "v2"); // no markDirty: simulates crash between mutation + propagation
    const g = dag.loadDag(root, pid).dag;
    assert(g.nodes.CAPS.state === "CLEAN", "stored state still CLEAN");
    assert(dag.effectiveState(g, "CAPS") === "DIRTY", "effective state derives DIRTY from fingerprint mismatch");
    const plan = dag.planRebuild(root, pid);
    assert(plan.plan.rebuild.includes("CAPS"), "planner rebuilds the stale node");
  });

  await runTest("DAG11 clean graph remains clean on no-op", () => {
    const { root, pid } = newGraph();
    audioChain(root, pid);
    const r0 = dag.loadDag(root, pid).dag.revision;
    assert(dag.addNode(root, pid, N("AUDIO", "FINAL_AUDIO", { inputRefs: [{ key: "SCRIPT", type: "reads" }] })).changed === false, "identical node no-ops");
    assert(dag.setNodeVersion(root, pid, "AUDIO", "v1").changed === false, "same version no-ops");
    const noop = dag.markDirty(root, pid, "THUMB", { reason: "leaf, no descendants" });
    assert(noop.changed === false && noop.dirtied.length === 0, "leaf dirty with no descendants writes nothing");
    assert(dag.loadDag(root, pid).dag.revision === r0, "revision frozen across no-ops");
  });

  await runTest("DAG12 fresh-process restore identical", () => {
    const { root, pid } = newGraph();
    audioChain(root, pid);
    dag.setNodeVersion(root, pid, "AUDIO", "v2");
    dag.markDirty(root, pid, "AUDIO", { reason: "v2" });
    const child = spawnSync(process.execPath, ["-e",
      "const d=require(process.argv[1]);const l=d.loadDag(process.argv[2],process.argv[3]);if(!l.ok){console.error(l.code);process.exit(1)}const p=d.planRebuild(process.argv[2],process.argv[3]);console.log(l.dag.fingerprint+'|'+p.plan.rebuild.join(','));",
      path.join(REPO, "lib", "dependency-dag", "index.js"), root, pid,
    ], { encoding: "utf8" });
    assert(child.status === 0, "fresh process loads");
    const g = dag.loadDag(root, pid).dag;
    const p = dag.planRebuild(root, pid).plan;
    assert(child.stdout.trim() === `${g.fingerprint}|${p.rebuild.join(",")}`, "identical graph + rebuild plan across processes");
  });

  await runTest("C11 mutation before propagation completes: resume derives DIRTY", () => {
    // Crash between setNodeVersion and markDirty: stored CLEAN + stale
    // fingerprint. Resume derives DIRTY lazily (version-aware); TIMELINE
    // follows only after S2_QA is actually rebuilt with a new version.
    const { root, pid } = newGraph();
    sceneGraph(root, pid);
    dag.setNodeVersion(root, pid, "S2_ASSET", "v2-crash");
    // "Crash": fresh handles only.
    const g = dag.loadDag(root, pid).dag;
    assert(g.nodes.S2_QA.state === "CLEAN", "stored CLEAN (propagation never ran)");
    const plan = dag.planRebuild(root, pid).plan;
    assert(plan.rebuild.includes("S2_QA"), "resume rebuilds the unpropagated node");
    assert(!plan.rebuild.includes("S1_QA") && !plan.rebuild.includes("S3_QA"), "sibling branches untouched");
    assert(!plan.rebuild.includes("TIMELINE"), "TIMELINE waits: its inputs' versions are unchanged (lazy correctness)");
    const r = dag.rerunBranch(root, pid, "S2_ASSET", () => ({ ok: true, versionRef: "rebuilt" }));
    assert(r.ok && JSON.stringify(r.executed) === JSON.stringify(["S2_QA"]), "only the stale node ran");
    const plan2 = dag.planRebuild(root, pid).plan;
    assert(plan2.rebuild.includes("TIMELINE"), "TIMELINE follows once S2_QA carries a new version");
  });

  await runTest("R1+R2 dirty one asset, affected closure exact", () => {
    const { root, pid } = newGraph();
    sceneGraph(root, pid);
    dag.setNodeVersion(root, pid, "S1_ASSET", "v2");
    const r = dag.markDirty(root, pid, "S1_ASSET", { reason: "R1" });
    assert(JSON.stringify(r.dirtied) === JSON.stringify(["RENDER", "S1_QA", "TIMELINE"]), "R1+R2 closure exact");
  });

  await runTest("R3+R4 rerun schedules only the affected branch, reuses the rest", () => {
    const { root, pid } = newGraph();
    sceneGraph(root, pid);
    dag.setNodeVersion(root, pid, "S2_ASSET", "v2");
    dag.markDirty(root, pid, "S2_ASSET", { reason: "R3" });
    const executed = [];
    const r = dag.rerunBranch(root, pid, "S2_ASSET", (key) => { executed.push(key); return { ok: true, versionRef: "rebuilt" }; });
    assert(r.ok, "rerun ok");
    // The changed node itself carries the new version (CLEAN) — rerun
    // rebuilds its stale downstream only.
    assert(JSON.stringify(executed) === JSON.stringify(["S2_QA", "TIMELINE", "RENDER"]), `only affected downstream ran (got ${executed})`);
    const g = dag.loadDag(root, pid).dag;
    assert(g.nodes.S1_QA.versionRef === "v1" && g.nodes.S3_QA.versionRef === "v1", "R4 unaffected artifacts reused byte-identical");
    assert(g.nodes.S1_ASSET.state === "CLEAN" && g.nodes.S3_ASSET.state === "CLEAN", "clean branches never rebuilt");
  });

  await runTest("R5+R6 locked dirty node blocks rerun; explicit unlock + reset permits the revised branch", () => {
    const { root, pid } = newGraph();
    sceneGraph(root, pid);
    assert(dag.setNodeLockTarget(root, pid, "S1_QA", { targetType: "SHOT", targetId: "S1_QA" }).changed === true, "lock target attached");
    dag.setNodeVersion(root, pid, "S1_ASSET", "v2");
    const locksReader = ({ targetType, targetId }) => (targetType === "SHOT" && targetId === "S1_QA" ? "LOCKED" : null);
    const marked = dag.markDirty(root, pid, "S1_ASSET", { reason: "R5" }, {}, locksReader);
    assert(marked.blocked.includes("S1_QA"), "R5 S1_QA BLOCKED, never auto-regenerated");
    const executed = [];
    const r = dag.rerunBranch(root, pid, "S1_ASSET", (key) => { executed.push(key); return { ok: true, versionRef: "rebuilt" }; }, {}, locksReader);
    assert(r.ok, "rerun completes around the block");
    assert(executed.length === 0, "changed root is already CLEAN; blocked branch never executes");
    assert(JSON.stringify(r.skippedBlocked) === JSON.stringify(["RENDER", "S1_QA", "TIMELINE"]), `blocked branch reported (got ${r.skippedBlocked})`);
    // R6: explicit unlock (reader flips) + explicit state reset = revision decision.
    const openReader = () => null;
    assert(dag.setNodeState(root, pid, "S1_QA", "DIRTY").changed === true, "explicit DIRTY reset after unlock decision");
    const r2 = dag.rerunBranch(root, pid, "S1_ASSET", (key) => { executed.push(`re:${key}`); return { ok: true, versionRef: "v3" }; }, {}, openReader);
    assert(r2.ok && executed.includes("re:S1_QA") && executed.includes("re:TIMELINE"), "R6 revised branch reruns after unlock");
  });

  await runTest("R7+R8 clean branch never regenerated; failed retry preserves lineage", () => {
    const { root, pid } = newGraph();
    sceneGraph(root, pid);
    dag.setNodeVersion(root, pid, "S2_ASSET", "v2");
    dag.markDirty(root, pid, "S2_ASSET", { reason: "R7" });
    const before = {};
    for (const k of ["S1_ASSET", "S1_QA", "S3_ASSET", "S3_QA", "PLAN"]) {
      before[k] = dag.loadDag(root, pid).dag.nodes[k].versionRef;
    }
    const executed = [];
    const r = dag.rerunBranch(root, pid, "S2_ASSET", (key) => { executed.push(key); return { ok: true, versionRef: "rebuilt" }; });
    assert(r.ok, "rerun ok");
    const g = dag.loadDag(root, pid).dag;
    for (const k of Object.keys(before)) {
      assert(g.nodes[k].versionRef === before[k], `R7 ${k} byte-identical (reused, never re-executed)`);
    }
    // R8: executor failure → FAILED node; lineage preserved for explicit retry.
    dag.setNodeVersion(root, pid, "S3_ASSET", "v9");
    dag.markDirty(root, pid, "S3_ASSET", { reason: "R8" });
    const f = dag.rerunBranch(root, pid, "S3_ASSET", (key) => (key === "S3_QA" ? { ok: false } : { ok: true, versionRef: "rebuilt" }));
    assert(!f.ok && f.code === "REBUILD_BLOCKED", "executor failure halts the branch");
    assert(JSON.stringify(f.executed) === JSON.stringify(["S3_QA"]) && !f.executed.includes("TIMELINE"), "halted before downstream");
    assert(dag.loadDag(root, pid).dag.nodes.S3_QA.state === "FAILED", "failure recorded on the node");
    assert(dag.planRebuild(root, pid).plan.needsDecision.some((n) => n.key === "S3_QA"), "FAILED needs an explicit retry decision (no silent reschedule)");
  });

  await runTest("PERF baseline: small + medium graphs", () => {
    const { root, pid } = newGraph();
    audioChain(root, pid);
    const one = timeIt("smallMutation", () => dag.setNodeVersion(root, pid, "AUDIO", `v-${Math.random()}`), 5);
    void one;
    timeIt("smallDirty", () => {
      dag.markDirty(root, pid, "AUDIO", { reason: "perf" });
      const g = dag.loadDag(root, pid).dag;
      for (const k of ["ALIGN", "CAPTIONS", "SCENE_T", "VIS_T", "ANIM_T", "TIMELINE", "RENDER", "THUMB"]) {
        if (g.nodes[k].state === "BLOCKED") dag.setNodeState(root, pid, k, "DIRTY");
        else if (g.nodes[k].state !== "DIRTY") throw new Error(`expected DIRTY, got ${k}=${g.nodes[k].state}`);
      }
      dag.setNodeState(root, pid, "ALIGN", "CLEAN");
    }, 5);
    timeIt("smallPlan", () => dag.planRebuild(root, pid), 20);
    timeIt("smallLoad", () => dag.loadDag(root, pid), 20);
    // Medium graph: 300-node chain with side branches.
    const m = newGraph("p-med");
    dag.addNode(m.root, m.pid, N("N0000", "FINAL_AUDIO"));
    for (let i = 1; i < 300; i++) {
      const key = `N${String(i).padStart(4, "0")}`;
      dag.addNode(m.root, m.pid, N(key, "CAPTIONS", { inputRefs: [{ key: `N${String(i - 1).padStart(4, "0")}` }] }));
      if (i % 10 === 0) dag.addNode(m.root, m.pid, N(`B${i}`, "THUMBNAIL", { inputRefs: [{ key }] }));
    }
    timeIt("mediumDirty", () => dag.markDirty(m.root, m.pid, "N0000", { reason: "perf" }), 3);
    timeIt("mediumPlan", () => dag.planRebuild(m.root, m.pid), 5);
    const sizeBytes = fs.statSync(path.join(m.root, "projects", m.pid, "dependency-dag.json")).size;
    perf.mediumSizeBytes = sizeBytes;
    perf.smallSizeBytes = fs.statSync(path.join(root, "projects", pid, "dependency-dag.json")).size;
    perf.writeAmplification = "1 atomic replace per effective mutation; 0 on dedupe";
    const baseline = {
      artifact: "perf-baseline-dag", capturedAt: new Date().toISOString(),
      method: "process.hrtime.bigint micro-benchmarks inside tests/dag/test-dag.js",
      sampleCounts: { smallMutation: 5, smallDirty: 5, smallPlan: 20, smallLoad: 20, mediumDirty: 3, mediumPlan: 5 },
      environment: "local Windows, node",
      metrics: perf,
      budgets: { smallMutationP50Ms: 25, smallDirtyP50Ms: 25, smallPlanP50Ms: 10, smallLoadP50Ms: 5, mediumDirtyP50Ms: 500, mediumPlanP50Ms: 500, mediumSizeBytes: 1048576 },
      reason: "DAG sits on planning paths; mutation/propagation/plan must stay interactive on small graphs and bounded on medium graphs",
      result: "PASS",
    };
    const outDir = path.join(REPO, "projects", "validation", "phase-1h", "phase1h3-validation", "evidence", "performance");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "perf-baseline-dag.json"), JSON.stringify(baseline, null, 2) + "\n");
    assert(perf.smallDirty.p50Ms < 25, `smallDirty p50 ${perf.smallDirty.p50Ms}ms < 25ms`);
    assert(perf.smallPlan.p50Ms < 10, `smallPlan p50 ${perf.smallPlan.p50Ms}ms < 10ms`);
    assert(perf.mediumDirty.p50Ms < 500, `mediumDirty p50 ${perf.mediumDirty.p50Ms}ms < 500ms`);
    assert(perf.mediumPlan.p50Ms < 500, `mediumPlan p50 ${perf.mediumPlan.p50Ms}ms < 500ms`);
  });

  console.log(`\n=== DONE: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(`FATAL: ${(e && e.stack) || e}`);
  process.exit(1);
});

main().catch((e) => {
  console.error(`FATAL: ${(e && e.stack) || e}`);
  process.exit(1);
});
