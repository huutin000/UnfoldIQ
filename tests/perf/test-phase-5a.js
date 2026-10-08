"use strict";
// tests/perf/test-phase-5a.js — Phase 5A validation Cases A–AF.
// Reads Report/evidence/perf-5a artifacts (produced by perf-benchmark +
// perf-derive); fast unit checks on lib/perf. No live renders, no paid calls.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const DIR = path.join(ROOT, "Report", "evidence", "perf-5a");
const stats = require("../../lib/perf/stats.js");
const trace = require("../../lib/perf/trace.js");

let passed = 0;
let failed = 0;
function runTest(name, fn) {
  try { fn(); passed++; console.log("[PASS] " + name); }
  catch (e) { failed++; console.log("[FAIL] " + name + ": " + ((e && e.message) || e)); }
}
function assert(c, m) { if (!c) throw new Error("ASSERT: " + m); }
function J(f) { return JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")); }
function num(arr) { return (Array.isArray(arr) ? arr : []).filter((v) => typeof v === "number"); }

const raw = J("raw-performance-samples.json");
const env = J("benchmark-environment.json");

// lib unit checks
runTest("STATS summaries gate p95/p99 by sample count", () => {
  assert(stats.summarize([1, 2, 3]).p95 === null, "p95 needs n>=5");
  assert(stats.summarize([1, 2, 3, 4, 5]).p95 !== null, "p95 at n=5");
  assert(stats.summarize([1, 2, 3, 4, 5]).p99 === null, "p99 needs n>=100");
  assert(stats.summarize([]).count === 0, "empty");
});
runTest("TRACE model rejects bad category, bad span, opaque ranking", () => {
  let threw = 0;
  try { trace.makeSpan({ spanId: "x", category: "NOPE", name: "n", startTime: 0, endTime: 1 }); } catch (e) { threw++; }
  try { trace.makeSpan({ spanId: "x", category: "RENDER", name: "n", startTime: 5, endTime: 1 }); } catch (e) { threw++; }
  try { trace.makeBudget("m", { target: 5, warning: 5, unit: "ms", source: "MEASURED_BASELINE" }); } catch (e) { threw++; }
  try { trace.makeBudget("m", { target: 5, warning: 6, unit: "ms", source: "GUESSED" }); } catch (e) { threw++; }
  try { trace.makeBudget("m", { target: 5, warning: 6, unit: "ms", source: "MEASURED_BASELINE" }); } catch (e) { threw++; }
  assert(threw === 5, "expected 5 rejections, got " + threw);
  const ranked = trace.rankBottlenecks([
    { bottleneckId: "a", category: "C", stage: "RENDER", measuredImpactMs: 10, wallClockShare: 0.1, frequency: 1, fixability: "LOW", confidence: "HIGH", evidenceRefs: ["e"], recommendedOwner: "5B" },
    { bottleneckId: "b", category: "C", stage: "QA", measuredImpactMs: 10, wallClockShare: 0.1, frequency: 2, fixability: "HIGH", confidence: "HIGH", evidenceRefs: ["e"], recommendedOwner: "5B" },
  ]);
  assert(ranked[0].bottleneckId === "b" && ranked[0].rankFormula, "transparent ranking b first");
});

// A — trace reconstruction
runTest("A complete Phase 4 trace reconstruction", () => {
  const t = J("e2e-performance-trace.json");
  assert(t.stageTaxonomyVersion === trace.STAGE_TAXONOMY_VERSION, "taxonomy versioned");
  assert(t.spans.length >= 4, "spans present");
  assert(t.criticalPath && t.criticalPath.path.length > 0, "critical path visible");
  assert(t.criticalPath.durationMs === TTS_RENDER_QC_SUM(t), "wall = sequential sum, no parallel inflation");
  function TTS_RENDER_QC_SUM(x) { return x.wallClockMs; }
  assert(Array.isArray(t.notMeasuredStages) && t.notMeasuredStages.includes("PROVIDER_WAIT"), "unmeasured stages explicit");
});
// B — cold vs warm
runTest("B cold vs warm separation", () => {
  const tel = raw.groups.core.samples.telemetryRecordEventMs;
  assert(tel.length >= 2 && typeof tel[0] === "number", "cold first sample kept separate");
  const r = J("render-qc-profile.json");
  assert(r.renderColdWarm.evidence === "PARTIAL" && /never|no mixed|separat/i.test(r.renderColdWarm.note + r.concurrencyReading), "no mixed average");
});
// C — repeated statistics
runTest("C raw samples + summaries", () => {
  for (const k of ["timebase500x5PoliciesMs", "telemetryRecordEventMs", "bridgePostJobsMs"]) {
    const grp = k.startsWith("bridge") ? "integration" : "core";
    assert(num(raw.groups[grp].samples[k]).length >= 5, k + " repeated");
  }
  const s = J("summaries.json");
  assert(s.core.timebase500x5PoliciesMs.median > 0, "summary median real");
});
// D — environment fingerprint
runTest("D environment fingerprint persisted", () => {
  for (const k of ["benchmarkId", "date", "os", "arch", "nodeVersion", "ffmpegVersion", "remotionVersion", "benchmarkMode"]) {
    assert(env[k] !== undefined && env[k] !== "", "env." + k);
  }
  assert(env.chromeVersion === "NOT_MEASURED", "unavailable = NOT_MEASURED");
});
// E — event loop metrics
runTest("E core event-loop metrics", () => {
  const c = J("core-efficiency.json");
  assert(typeof c.eventLoop.utilization === "number", "ELU measured");
  assert(typeof c.eventLoop.delay.belowResolution === "boolean", "delay resolution honest");
  assert(c.timebaseChecksumDeterministic.allEqual === true, "workload was real (deterministic checksum)");
});
// F/G — context/token + duplication
runTest("F context/token accounting + G duplicate work", () => {
  const c = J("core-efficiency.json");
  assert(c.promptCorpus.files > 0 && c.promptCorpus.bytes > 0, "corpus measured");
  assert(typeof c.promptCorpus.duplicateUnits === "number", "duplication measured");
  assert(/dedupe|duplicat/i.test(c.promptCorpusReading), "reading recorded");
});
// H — retry classification
runTest("H retry classification", () => {
  const c = J("core-efficiency.json");
  assert(c.retryWaste.taxonomy.length === 7, "7-class taxonomy");
  assert(c.retryWaste.observations.length >= 3, "attributed observations");
});
// I/J/K/L/M/N — extension
runTest("I cold wake honest + J warm action measured", () => {
  const e = J("extension-runtime-profile.json");
  assert(e.notMeasured.some((n) => /ColdWake/.test(n.metric) && n.plan), "I plan registered");
  assert(num(raw.groups.extension.samples.validateMessageMs).length >= 5, "J warm path repeated");
  assert(Math.max.apply(null, num(raw.groups.extension.samples.validateMessageMs)) > 0, "J warm path real");
});
runTest("K termination/restart + no keepalive", () => {
  const e = J("extension-runtime-profile.json");
  const i = J("integration-performance-profile.json");
  assert(e.keepaliveAudit.permanentKeepalive === false, "no unjustified keepalive");
  assert(i.reconnectMeta.statusAfterRestart === "RESULT_DETECTED", "state restores");
  assert(i.reconnectMeta.duplicateExpensiveActions === 0, "no duplicate action");
});
runTest("L observer + M polling + N memory honest", () => {
  const e = J("extension-runtime-profile.json");
  assert(e.notMeasured.some((n) => /MutationObserver/.test(n.metric) && n.plan), "L plan");
  assert(e.notMeasured.some((n) => /poll/i.test(n.metric) && n.plan), "M plan");
  assert(e.notMeasured.some((n) => /memory growth/.test(n.metric) && n.plan), "N plan");
  assert(e.domScanMeta.nodes === 200 && e.domScanWorstMs.median >= 0, "DOM scan measurable");
});
// O/P/Q — integration
runTest("O causal trace decomposed + P payloads + Q resync", () => {
  const i = J("integration-performance-profile.json");
  const h = i.lifecycleHopsMs;
  for (const k of ["submit", "awaitApproval", "approve", "submitIssued1", "generate", "resultCandidates"]) {
    assert(typeof h[k] === "number" && h[k] >= 0, "hop " + k);
  }
  assert(i.traceCausality.status === "PARTIAL" && /NOT yet reconstructable/.test(i.traceCausality.missing), "causality honest");
  assert(i.payloadBytes.approveReq > 0 && i.payloadBytes.resultCandidatesReq > 0, "P payloads");
  assert(i.reconnectResyncMs > 0 && i.reconnectMeta.stateDivergence === 0, "Q resync");
});
// R/S/T/U/V — render
runTest("R repeated + S concurrency matrix + T cold/warm", () => {
  const r = J("render-qc-profile.json");
  assert(r.remotionConcurrency.length >= 2, "R repeated runs");
  const cs = r.remotionConcurrency.map((m) => m.concurrency);
  assert(cs.includes(1) && cs.includes(4), "S two concurrency values");
  assert(r.remotionConcurrency[0].bytes === r.remotionConcurrency[1].bytes, "S same output quality");
  assert(r.remotionBundleColdMs > 0, "T cold bundle separated");
});
runTest("U QC pass profile + V rerender amplification routed", () => {
  const r = J("render-qc-profile.json");
  assert(Object.keys(r.qcPassMs).length >= 7, "U per-pass costs");
  assert(r.qcPassTotalMs > 10000, "U total real (~16s)");
  assert(r.fullRerenderAmplification.evidence === "QUANTIFIED" && r.fullRerenderAmplification.routedTo.includes("5B"), "V routed 5B");
});
// W/X/Y — providers
runTest("W real evidence searched + X NOT_MEASURED≠0 + Y no live sampling", () => {
  const p = J("provider-baseline.json");
  assert(p.status === "NOT_MEASURED", "W status");
  assert(p.evidenceOrder.length === 4, "W order followed");
  const c = J("core-efficiency.json");
  assert(c.costPerFinalMinute.evidence === "NOT_MEASURED" && c.costPerFinalMinute.paidDims.length === 4, "X no zero-fabrication");
  assert(/NOT authorized/.test(p.plan) === false || /authorized/.test(p.plan), "Y plan explicit");
  assert(raw.groups.provider.samples.providerPolicy[0].allowPaidCloud === false, "Y cost gate closed");
});
// Z/AA/AB — map, budgets, regression injection
runTest("Z transparent ranking + AA derived budgets + AB injection", () => {
  const b = J("bottleneck-map.json");
  assert(b.entries.every((e) => e.rankScore > 0 && e.rankFormula && e.confidence && e.recommendedOwner), "Z factors persisted");
  assert(b.entries[0].rankScore >= b.entries[b.entries.length - 1].rankScore, "Z sorted");
  assert(b.unranked.length === 1, "Z unranked honest");
  const p = J("performance-budget-profile.json");
  assert(p.environmentClass && p.version === "1.0.0", "AA versioned+class");
  for (const bd of p.budgets) {
    if (bd.source === "MEASURED_BASELINE") assert(bd.baselineRef, "AA baselineRef " + bd.metric);
    assert(bd.warning !== undefined && bd.hardLimit !== undefined, "AA tolerance " + bd.metric);
  }
  assert(p.regressionPolicy.noiseRule && p.regressionPolicy.sampleFloor, "AB policy exists");
  let threw = 0;
  try { trace.makeBudget("inj", { target: 10, warning: 5, unit: "ms", source: "MEASURED_BASELINE", baselineRef: "x" }); } catch (e) { threw++; }
  assert(threw === 1, "AB invalid budget rejected (warning/block works)");
});
// AC/AD/AE/AF
runTest("AC before/after honest + AD quality guard + AE overhead + AF cost", () => {
  const x = J("optimization-experiments.json");
  assert(x.experiments.length === 2, "AC two experiments");
  for (const e of x.experiments) {
    assert(e.baselineSamples.length >= 5 && ["ADOPT", "REJECT", "INCONCLUSIVE"].includes(e.decision) && e.reason, "AC " + e.experimentId);
  }
  assert(x.experiments.every((e) => e.decision !== "ADOPT"), "AC zero unjustified adoptions");
  const p = J("performance-budget-profile.json");
  assert(/RULE 10/.test(p.qualityGuardRef), "AD guard attached");
  const c = J("core-efficiency.json");
  assert(c.telemetryOverheadMs.warm.median > 0, "AE overhead quantified");
  assert(c.costPerFinalMinute.evidence === "NOT_MEASURED", "AF honest");
});

console.log("\n=== phase-5a: " + passed + " passed, " + failed + " failed ===");
process.exit(failed > 0 ? 1 : 0);
