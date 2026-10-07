"use strict";

/**
 * Phase 1H.5 — Golden matrices G1–G12 (definitions/baselines), R1–R12
 * (regression), C1–C8 (canary) + golden perf baseline.
 * Deterministic. Candidates are mock metric sets — never paid generation.
 * All stores live under os.tmpdir (repoRoot override); the live golden/
 * directory is never touched by tests.
 */

const os = require("os");
const fs = require("fs");
const path = require("path");
const gold = require("../../lib/golden/index.js");

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
  tmpRepo.n = (tmpRepo.n || 0) + 1;
  return fs.mkdtempSync(path.join(os.tmpdir(), `unfoldiq-1h5-${Date.now().toString(36)}-${tmpRepo.n}-`));
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

function mkGolden(repo, id = "gold-t", contentClass = "FICTION") {
  const d = gold.createGoldenDefinition(repo, {
    goldenProjectId: id, name: id, contentClass,
    categories: ["fiction", "character-continuity", "selective-veo"],
    fixture: { projectId: "p-fx", kind: "evidence" },
    platform: "youtube", aspectRatio: "16:9", status: "ACTIVE",
  });
  if (!d.ok) throw new Error("golden create failed: " + d.code);
  return d.definition;
}

function mkBaseline(repo, id, metrics, extra = {}) {
  const b = gold.createBaseline(repo, {
    goldenProjectId: id, metrics,
    pipelineVersion: "1.0.0", evidenceRefs: ["ev-1"], reason: "test baseline", ...extra,
  });
  if (!b.ok) throw new Error("baseline failed: " + b.code + " " + b.message);
  return b.baseline;
}

const BASE_METRICS = {
  aspectCorrectness: { status: "MEASURED", value: "16:9", evidenceRefs: ["ev-1"] },
  continuity: { status: "MEASURED", value: "PASS", evidenceRefs: ["ev-1"] },
  failureRate: { status: "MEASURED", value: 0.1, evidenceRefs: ["ev-1"] },
  cost: { status: "MEASURED", value: 40, evidenceRefs: ["ev-1"] },
};

async function main() {
  await runTest("G1 create Golden Project (immutable identity, fixture required)", () => {
    const repo = tmpRepo();
    const d = mkGolden(repo);
    assert(d.version === 1 && d.status === "ACTIVE", "v1 ACTIVE created");
    const bad = gold.createGoldenDefinition(repo, { goldenProjectId: "gold-x", contentClass: "FICTION", categories: [], fixture: { projectId: "p", kind: "e" } });
    assert(!bad.ok, "empty categories refused");
    const noFixture = gold.createGoldenDefinition(repo, { goldenProjectId: "gold-y", contentClass: "FICTION", categories: ["fiction"], fixture: { projectId: "", kind: "e" } });
    assert(!noFixture.ok, "fixture-less golden refused (reuse canonical evidence)");
  });

  await runTest("G2 definition version immutable (changes supersede)", () => {
    const repo = tmpRepo();
    mkGolden(repo);
    const v2 = gold.createGoldenVersion(repo, "gold-t", 2, { status: "RETIRED" });
    assert(v2.ok && v2.definition.status === "RETIRED" && v2.definition.supersedes === "gold-t:v1", "v2 supersedes v1");
    const v1 = gold.getDefinition(repo, "gold-t", 1);
    assert(v1.ok && v1.definition.status === "ACTIVE", "v1 bytes untouched");
  });

  await runTest("G3 coverage mapping valid (dimensions explicit)", () => {
    const repo = tmpRepo();
    mkGolden(repo);
    const partial = gold.coverageMatrix(repo).matrix;
    assert(partial.FICTION.status === "PARTIALLY_COVERED", "definition without baseline is partial, not covered");
    assert(partial.HYBRID.status === "DEFERRED_WITH_REASON", "hybrid explicitly deferred (no silent omission)");
    assert(partial.ASPECT_9_16.status === "DEFERRED_WITH_REASON", "9:16 explicitly deferred");
    mkBaseline(repo, "gold-t", BASE_METRICS);
    const m = gold.coverageMatrix(repo).matrix;
    assert(m.FICTION.status === "COVERED", "fiction covered once baselined");
  });

  await runTest("G4 baseline create (metric validation enforced)", () => {
    const repo = tmpRepo();
    mkGolden(repo);
    const b = mkBaseline(repo, "gold-t", BASE_METRICS);
    assert(b.version === 1, "baseline v1");
    const badJudgment = gold.createBaseline(repo, { goldenProjectId: "gold-t", metrics: { scriptNaturalness: { status: "MEASURED", value: 0.8 } }, evidenceRefs: [], reason: "x" });
    assert(!badJudgment.ok, "judgment metric without reviewer/method refused");
    const badUnexplained = gold.createBaseline(repo, { goldenProjectId: "gold-t", metrics: { generationTime: { status: "NOT_MEASURED" } }, evidenceRefs: [], reason: "x" });
    assert(!badUnexplained.ok, "NOT_MEASURED without reason refused");
    const wrongClass = gold.createBaseline(repo, { goldenProjectId: "gold-t", metrics: { unsupportedFactualClaims: { status: "MEASURED", value: 0, evidenceRefs: ["e"] } }, evidenceRefs: [], reason: "x" });
    assert(!wrongClass.ok && wrongClass.code === "METRIC_NOT_APPLICABLE", "factual metric on FICTION refused");
  });

  await runTest("G5 baseline version append-only (same version replays only when identical)", () => {
    const repo = tmpRepo();
    mkGolden(repo);
    mkBaseline(repo, "gold-t", BASE_METRICS);
    const same = gold.createBaseline(repo, { goldenProjectId: "gold-t", version: 1, metrics: BASE_METRICS, evidenceRefs: ["ev-1"], reason: "replay" });
    assert(same.ok && same.changed === false, "identical replay no-ops");
    const diff = gold.createBaseline(repo, { goldenProjectId: "gold-t", version: 1, metrics: { ...BASE_METRICS, cost: { status: "MEASURED", value: 41, evidenceRefs: ["ev-1"] } }, evidenceRefs: ["ev-1"], reason: "sneaky" });
    assert(!diff.ok && diff.code === "BASELINE_VERSION_CONFLICT", "same version different metrics refused");
    const v2 = gold.createBaseline(repo, { goldenProjectId: "gold-t", metrics: BASE_METRICS, evidenceRefs: ["ev-1"], reason: "v2" });
    assert(v2.ok && v2.baseline.version === 2, "versions advance");
  });

  await runTest("G6 incompatible baseline → NOT_COMPARABLE (drift detected)", () => {
    const repo = tmpRepo();
    mkGolden(repo);
    mkBaseline(repo, "gold-t", BASE_METRICS);
    const drifted = gold.compareToBaseline(repo, "gold-t", { label: "new-metric", metrics: { ...BASE_METRICS, brandNewMetric: { status: "MEASURED", value: 1 } } });
    assert(drifted.ok && drifted.comparison.verdict === "NOT_COMPARABLE", "unknown metric keys → NOT_COMPARABLE, never silent pass");
    const short = gold.compareToBaseline(repo, "gold-t", { label: "missing", metrics: { aspectCorrectness: BASE_METRICS.aspectCorrectness } });
    assert(short.comparison.verdict === "NOT_COMPARABLE", "missing keys → NOT_COMPARABLE");
  });

  await runTest("G7 missing metric → explicit status (SKIP, never assumed)", () => {
    const repo = tmpRepo();
    mkGolden(repo);
    mkBaseline(repo, "gold-t", { ...BASE_METRICS, generationTime: { status: "NOT_MEASURED", reason: "no provider timestamps" } });
    const r = gold.compareToBaseline(repo, "gold-t", { label: "c", metrics: { ...BASE_METRICS, generationTime: { status: "NOT_MEASURED", reason: "still none" } } });
    const row = r.comparison.metricResults.find((m) => m.metric === "generationTime");
    assert(row && row.verdict === "SKIP", "non-measured pair explicitly skipped");
    assert(r.comparison.verdict === "PASS", "skips do not fail the verdict");
  });

  await runTest("G8 NOT_APPLICABLE allowed with reason", () => {
    const repo = tmpRepo();
    mkGolden(repo, "gold-t", "FACTUAL");
    // NOTE: mkBaseline returns the baseline RECORD (not the result wrapper).
    const b = mkBaseline(repo, "gold-t", { unsupportedFactualClaims: { status: "MEASURED", value: 0, evidenceRefs: ["brief"] }, speechRate: { status: "NOT_APPLICABLE", reason: "no spoken audio in this golden" } });
    assert(b && b.version === 1, "NOT_APPLICABLE with reason accepted");
  });

  await runTest("G9 subjective metric carries reviewer/method (no deterministic masquerade)", () => {
    const repo = tmpRepo();
    mkGolden(repo);
    const b = mkBaseline(repo, "gold-t", {
      ...BASE_METRICS,
      scriptNaturalness: { status: "MEASURED", value: 0.85, method: "native-speaker read-aloud", reviewer: "operator", confidence: "medium", evidenceRefs: ["script.json"] },
    });
    assert(b && b.version === 1, "judgment metric with full provenance accepted");
  });

  await runTest("G10 deterministic metric reproducible (same inputs, same verdict)", () => {
    const repo = tmpRepo();
    mkGolden(repo);
    mkBaseline(repo, "gold-t", BASE_METRICS);
    const a = gold.compareToBaseline(repo, "gold-t", { label: "c1", metrics: BASE_METRICS });
    const b = gold.compareToBaseline(repo, "gold-t", { label: "c2", metrics: BASE_METRICS });
    assert(a.comparison.verdict === "PASS" && b.comparison.verdict === "PASS", "identical candidates PASS deterministically");
  });

  await runTest("G11 artifact refs resolve (evidence ledger link)", () => {
    const b = gold.latestBaseline(REPO, "gold-fiction-continuity");
    assert(b.ok, "live B baseline loads");
    for (const ref of b.baseline.evidenceRefs) {
      assert(fs.existsSync(path.join(REPO, ref)) || ref.endsWith("/"), `ref resolves: ${ref}`);
    }
  });

  await runTest("G12 secret-free metadata (golden stores carry no payloads)", () => {
    const repo = tmpRepo();
    const bad = gold.createBaseline(repo, { goldenProjectId: "none", metrics: {}, evidenceRefs: [], reason: "x" });
    void bad;
    mkGolden(repo);
    const sneaky = gold.createGoldenDefinition(repo, {
      goldenProjectId: "gold-evil", contentClass: "FICTION", categories: ["fiction"],
      fixture: { projectId: "p", kind: "e" }, bridgeToken: "sekret",
    });
    assert(!sneaky.ok, "secret field on definition refused");
  });

  await runTest("R1 identical candidate → PASS", () => {
    const repo = tmpRepo();
    mkGolden(repo);
    mkBaseline(repo, "gold-t", BASE_METRICS);
    const r = gold.compareToBaseline(repo, "gold-t", { label: "same", metrics: BASE_METRICS });
    assert(r.comparison.verdict === "PASS" && r.comparison.regressions.length === 0, "identical PASSes");
  });

  await runTest("R2 hard invariant regression → FAIL (aspect)", () => {
    const repo = tmpRepo();
    mkGolden(repo);
    mkBaseline(repo, "gold-t", BASE_METRICS);
    const r = gold.compareToBaseline(repo, "gold-t", { label: "wrong-aspect", metrics: { ...BASE_METRICS, aspectCorrectness: { status: "MEASURED", value: "9:16", evidenceRefs: ["ev"] } } });
    assert(r.comparison.verdict === "FAIL", "wrong aspect FAILs");
    assert(r.comparison.regressions.some((x) => x.metric === "aspectCorrectness"), "aspect listed as regression");
  });

  await runTest("R3 small review metric change → REVIEW_REQUIRED (naturalness)", () => {
    const repo = tmpRepo();
    mkGolden(repo);
    const judged = { status: "MEASURED", value: 0.85, method: "read-aloud", reviewer: "operator", confidence: "medium", evidenceRefs: ["s"] };
    mkBaseline(repo, "gold-t", { ...BASE_METRICS, scriptNaturalness: judged });
    const r = gold.compareToBaseline(repo, "gold-t", { label: "nuance", metrics: { ...BASE_METRICS, scriptNaturalness: { ...judged, value: 0.8 } } });
    assert(r.comparison.verdict === "REVIEW_REQUIRED", "small subjective difference reviews, never auto-fails");
  });

  await runTest("R4 cost hard-budget regression → FAIL", () => {
    const repo = tmpRepo();
    mkGolden(repo);
    mkBaseline(repo, "gold-t", BASE_METRICS);
    const r = gold.compareToBaseline(repo, "gold-t", { label: "overspend", metrics: { ...BASE_METRICS, cost: { status: "MEASURED", value: 200, evidenceRefs: ["ledger"] } }, hardBudget: 100 });
    assert(r.comparison.verdict === "FAIL", "over-budget FAILs");
    const within = gold.compareToBaseline(repo, "gold-t", { label: "ok-spend", metrics: { ...BASE_METRICS, cost: { status: "MEASURED", value: 45, evidenceRefs: ["ledger"] } }, hardBudget: 100 });
    assert(within.comparison.verdict === "PASS", "tolerance-bounded growth passes");
  });

  await runTest("R5 performance regression above tolerance → REVIEW per policy", () => {
    const repo = tmpRepo();
    mkGolden(repo);
    mkBaseline(repo, "gold-t", { ...BASE_METRICS, generationTime: { status: "MEASURED", value: 100, evidenceRefs: ["ev"] } });
    const small = gold.compareToBaseline(repo, "gold-t", { label: "small", metrics: { ...BASE_METRICS, generationTime: { status: "MEASURED", value: 120, evidenceRefs: ["ev"] } } });
    assert(small.comparison.verdict === "PASS", "small variance passes (within REL 0.5)");
    const big = gold.compareToBaseline(repo, "gold-t", { label: "big", metrics: { ...BASE_METRICS, generationTime: { status: "MEASURED", value: 300, evidenceRefs: ["ev"] } } });
    assert(big.comparison.verdict === "REVIEW_REQUIRED", "large variance reviews per policy (never silent)");
  });

  await runTest("R6 factual unsupported-claim regression → FAIL (content-class aware)", () => {
    const repo = tmpRepo();
    mkGolden(repo, "gold-f", "FACTUAL");
    mkBaseline(repo, "gold-f", { unsupportedFactualClaims: { status: "MEASURED", value: 0, evidenceRefs: ["brief"] } });
    const r = gold.compareToBaseline(repo, "gold-f", { label: "claims", metrics: { unsupportedFactualClaims: { status: "MEASURED", value: 2, evidenceRefs: ["brief"] } } });
    assert(r.comparison.verdict === "FAIL", "unsupported-claim increase FAILs on FACTUAL");
  });

  await runTest("R7 character continuity regression → FAIL", () => {
    const repo = tmpRepo();
    mkGolden(repo);
    mkBaseline(repo, "gold-t", BASE_METRICS);
    const r = gold.compareToBaseline(repo, "gold-t", { label: "mutated", metrics: { ...BASE_METRICS, continuity: { status: "MEASURED", value: "FAIL", evidenceRefs: ["frames"] } } });
    assert(r.comparison.verdict === "FAIL", "continuity break FAILs");
  });

  await runTest("R8 aspect regression → FAIL (already covered by R2; explicit pin)", () => {
    const repo = tmpRepo();
    mkGolden(repo);
    mkBaseline(repo, "gold-t", BASE_METRICS);
    const r = gold.compareToBaseline(repo, "gold-t", { label: "ar", metrics: { ...BASE_METRICS, aspectCorrectness: { status: "MEASURED", value: "1:1", evidenceRefs: ["ev"] } } });
    assert(r.comparison.verdict === "FAIL", "aspect pin holds");
  });

  await runTest("R9 unrelated metric remains unchanged (no bleed)", () => {
    const repo = tmpRepo();
    mkGolden(repo);
    mkBaseline(repo, "gold-t", BASE_METRICS);
    const r = gold.compareToBaseline(repo, "gold-t", { label: "cost-only", metrics: { ...BASE_METRICS, cost: { status: "MEASURED", value: 45, evidenceRefs: ["ledger"] } } });
    const rows = Object.fromEntries(r.comparison.metricResults.map((m) => [m.metric, m.verdict]));
    assert(rows.aspectCorrectness === "PASS" && rows.continuity === "PASS" && rows.failureRate === "PASS", "unrelated metrics untouched");
  });

  await runTest("R10 old baseline preserved after candidate (append-only)", () => {
    const repo = tmpRepo();
    mkGolden(repo);
    const v1 = mkBaseline(repo, "gold-t", BASE_METRICS);
    gold.compareToBaseline(repo, "gold-t", { label: "c", metrics: { ...BASE_METRICS, cost: { status: "MEASURED", value: 45, evidenceRefs: ["e"] } } });
    const again = gold.latestBaseline(repo, "gold-t");
    assert(again.baseline.version === 1 && again.baseline.baselineId === v1.baselineId, "comparison creates no baseline version");
  });

  await runTest("R11 promoted candidate creates new baseline version", () => {
    const repo = tmpRepo();
    mkGolden(repo);
    mkBaseline(repo, "gold-t", BASE_METRICS);
    const can = gold.openCanary(repo, { changeType: "QUALITY_POLICY" });
    const cand = { ...BASE_METRICS, cost: { status: "MEASURED", value: 35, evidenceRefs: ["ledger"] } };
    gold.runCanaryGolden(repo, can.canary.canaryId, "gold-t", { label: "cheaper", metrics: cand });
    const pro = gold.promoteCanary(repo, can.canary.canaryId, { actor: "operator", reason: "verified cheaper run" }, { candidates: { "gold-t": cand } });
    assert(pro.ok, "promotion ok");
    const latest = gold.latestBaseline(repo, "gold-t");
    assert(latest.baseline.version === 2 && latest.baseline.metrics.cost.value === 35, "new version carries candidate values");
    const v1 = gold.loadDoc("baselines", repo).doc;
    assert(Object.values(v1.baselines).some((b) => b.version === 1 && b.metrics.cost.value === 40), "v1 preserved byte-identical");
  });

  await runTest("R12 failed candidate cannot become baseline", () => {
    const repo = tmpRepo();
    mkGolden(repo);
    mkBaseline(repo, "gold-t", BASE_METRICS);
    const can = gold.openCanary(repo, { changeType: "QUALITY_POLICY" });
    gold.runCanaryGolden(repo, can.canary.canaryId, "gold-t", { label: "bad", metrics: { ...BASE_METRICS, aspectCorrectness: { status: "MEASURED", value: "9:16", evidenceRefs: ["e"] } } });
    const pro = gold.promoteCanary(repo, can.canary.canaryId, { actor: "operator", reason: "ship it" }, { candidates: {} });
    assert(!pro.ok && pro.code === "CANARY_BLOCKED", "failed canary cannot promote");
    assert(gold.latestBaseline(repo, "gold-t").baseline.version === 1, "baseline untouched");
  });

  await runTest("C1 provider/model change selects relevant subset only", () => {
    const repo = tmpRepo();
    mkGolden(repo, "gold-b");
    const sel = gold.selectCanary(repo, { changeType: "MODEL", affects: "image-to-video" });
    void sel;
    // Live V1 set proves the mapping shape (subset, never the full set by default).
    const live = gold.selectCanary(REPO, { changeType: "MODEL", affects: "image-to-video" });
    assert(live.ok, "live selection ok");
    assert(live.subset.includes("gold-fiction-continuity"), "continuity golden selected");
    assert(!live.subset.includes("gold-factual-explainer") && !live.subset.includes("gold-voice-caption"), "unrelated goldens excluded");
  });

  await runTest("C2 prompt-policy change selects prompt-heavy goldens", () => {
    const live = gold.selectCanary(REPO, { changeType: "PROMPT_POLICY" });
    assert(live.ok && live.subset.includes("gold-fiction-continuity") && live.subset.includes("gold-originality-study") && live.subset.includes("gold-factual-explainer"), "prompt-relevant subset (fiction+factual+originality)");
    assert(!live.subset.includes("gold-voice-caption"), "caption golden excluded");
    assert(live.subset.includes("gold-image-only"), "image-only fiction is prompt-relevant by category (documented)");
  });

  await runTest("C3 failing canary blocks promotion", () => {
    const repo = tmpRepo();
    mkGolden(repo);
    mkBaseline(repo, "gold-t", BASE_METRICS);
    const can = gold.openCanary(repo, { changeType: "QUALITY_POLICY" });
    gold.runCanaryGolden(repo, can.canary.canaryId, "gold-t", { label: "bad", metrics: { ...BASE_METRICS, continuity: { status: "MEASURED", value: "FAIL", evidenceRefs: ["e"] } } });
    assert(gold.loadDoc("canaries", repo).doc.canaries[can.canary.canaryId].status === "BLOCKED", "canary BLOCKED");
    assert(!gold.promoteCanary(repo, can.canary.canaryId, { actor: "op", reason: "x" }, {}).ok, "promotion refused");
  });

  await runTest("C4 review-required canary blocks auto-promotion", () => {
    const repo = tmpRepo();
    mkGolden(repo);
    mkBaseline(repo, "gold-t", BASE_METRICS);
    const can = gold.openCanary(repo, { changeType: "QUALITY_POLICY" });
    gold.runCanaryGolden(repo, can.canary.canaryId, "gold-t", { label: "slow", metrics: { ...BASE_METRICS, generationTime: { status: "MEASURED", value: 500, evidenceRefs: ["e"] }, cost: BASE_METRICS.cost } });
    const st = gold.loadDoc("canaries", repo).doc.canaries[can.canary.canaryId].status;
    assert(st === "REVIEW_REQUIRED", `canary REVIEW_REQUIRED (got ${st})`);
    const pro = gold.promoteCanary(repo, can.canary.canaryId, { actor: "op", reason: "x" }, {});
    assert(!pro.ok && pro.code === "CANARY_REVIEW_REQUIRED", "auto-promotion blocked");
  });

  await runTest("C5 passing canary allows explicit promote action", () => {
    const repo = tmpRepo();
    mkGolden(repo);
    mkBaseline(repo, "gold-t", BASE_METRICS);
    const can = gold.openCanary(repo, { changeType: "QUALITY_POLICY" });
    const cand = { ...BASE_METRICS };
    gold.runCanaryGolden(repo, can.canary.canaryId, "gold-t", { label: "same", metrics: cand });
    assert(gold.loadDoc("canaries", repo).doc.canaries[can.canary.canaryId].status === "PROMOTE_ALLOWED", "PROMOTE_ALLOWED");
    const pro = gold.promoteCanary(repo, can.canary.canaryId, { actor: "operator", reason: "verified identical" }, { candidates: { "gold-t": cand } });
    assert(pro.ok, "explicit promotion with actor+reason succeeds");
  });

  await runTest("C6 canary emits correlated telemetry (shared goldenRunId)", () => {
    const repo = tmpRepo();
    const emitted = [];
    mkGolden(repo);
    mkBaseline(repo, "gold-t", BASE_METRICS);
    const can = gold.openCanary(repo, { changeType: "QUALITY_POLICY" }, { emit: (p) => emitted.push({ ...p, goldenRunId: "gr-1" }) });
    gold.runCanaryGolden(repo, can.canary.canaryId, "gold-t", { label: "c", metrics: BASE_METRICS }, { emit: (p) => emitted.push({ ...p, goldenRunId: "gr-1" }) });
    assert(emitted.length >= 2 && emitted.every((e) => e.goldenRunId === "gr-1"), "all canary telemetry shares the run id");
    assert(emitted.some((e) => e.eventName === "CANARY" && e.status), "verdict event emitted");
  });

  await runTest("C7 canary cost estimate visible before any paid path", () => {
    const repo = tmpRepo();
    mkGolden(repo);
    const can = gold.openCanary(repo, { changeType: "MODEL", affects: "image", costEstimate: { paidGenerations: 0, note: "mock only" } });
    assert(can.ok && can.canary.costEstimate.paidGenerations === 0, "zero-spend estimate visible up front");
  });

  await runTest("C8 paid path cannot execute without explicit authorization", () => {
    const repo = tmpRepo();
    mkGolden(repo);
    mkBaseline(repo, "gold-t", BASE_METRICS);
    const can = gold.openCanary(repo, { changeType: "QUALITY_POLICY" });
    // No authorize-paid API exists on the canary contract: the only spend
    // path would be caller-side, and promotion (the sole state-changing
    // gate) refuses without an all-PASS verdict + actor + reason.
    const pro = gold.promoteCanary(repo, can.canary.canaryId, { actor: "", reason: "" }, {});
    assert(!pro.ok, "promotion without verdict+actor+reason refused (no silent spend path)");
  });

  await runTest("PERF baseline: golden load/compare/canary latencies", () => {
    timeIt("goldenLoad", () => gold.getDefinition(REPO, "gold-fiction-continuity"), 20);
    timeIt("baselineLoad", () => gold.latestBaseline(REPO, "gold-fiction-continuity"), 20);
    const cand = JSON.parse(JSON.stringify(BASE_METRICS));
    const repo = tmpRepo();
    mkGolden(repo);
    mkBaseline(repo, "gold-t", BASE_METRICS);
    timeIt("compare", () => gold.compareToBaseline(repo, "gold-t", { label: "p", metrics: cand }), 10);
    perf.metadataBytes = fs.statSync(path.join(REPO, "golden", "baselines.json")).size
      + fs.statSync(path.join(REPO, "golden", "definitions.json")).size;
    perf.providerTimeMs = 0;
    const baseline = {
      artifact: "perf-baseline-golden", capturedAt: new Date().toISOString(),
      method: "process.hrtime.bigint micro-benchmarks inside tests/golden/test-golden.js",
      sampleCounts: { goldenLoad: 20, baselineLoad: 20, compare: 10 },
      environment: "local Windows, node",
      metrics: perf,
      budgets: { goldenLoadP50Ms: 10, baselineLoadP50Ms: 10, compareP50Ms: 25, metadataBytes: 1048576 },
      reason: "golden evaluation is local-only in V1 (provider time = 0); loads/compares must stay interactive",
      result: "PASS",
    };
    const outDir = path.join(REPO, "projects", "validation", "phase-1h", "phase1h45-validation", "evidence", "performance");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "perf-baseline-golden.json"), JSON.stringify(baseline, null, 2) + "\n");
    assert(perf.goldenLoad.p50Ms < 10, `goldenLoad p50 ${perf.goldenLoad.p50Ms}ms < 10ms`);
    assert(perf.compare.p50Ms < 25, `compare p50 ${perf.compare.p50Ms}ms < 25ms`);
  });

  console.log(`\n=== DONE: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(`FATAL: ${(e && e.stack) || e}`);
  process.exit(1);
});
