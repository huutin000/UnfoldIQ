#!/usr/bin/env node
"use strict";

/**
 * Phase 6A evidence generator (read-only analysis + evidence writer).
 *
 * Produces Report/evidence/phase-6a/*.json from REAL artifacts:
 *   - pilot-sky-blue: FULL_WATCH over the actual final.mp4 (+ optional recorded agent review replay)
 *   - REAL-lib project (Master Timeline + MotionPlan): before -> repair -> after, DAG + incremental plan
 *   - golden creative regressions, creative-analysis performance baseline, suite results
 * Writes ONLY under the --out directory. Never calls providers, never renders, never spends credits.
 *
 *   node scripts/diagnostics/creative-retention-evidence.js [--out <dir>] [--agent-review <json>] [--regression-log <file>]
 */

const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const cr = require(path.join(ROOT, "lib", "creative-retention", "index.js"));
const fx = require(path.join(ROOT, "tests", "fixtures", "creative-fixture.js"));
const pf = require(path.join(ROOT, "tests", "fixtures", "creative-project-fixture.js"));
const trace = require(path.join(ROOT, "lib", "perf", "trace.js"));

const args = process.argv.slice(2);
const opt = (name, d) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : d; };
const OUT = path.resolve(ROOT, opt("--out", path.join("Report", "evidence", "phase-6a")));
const AGENT_REVIEW = opt("--agent-review", null);
const REGRESSION_LOG = opt("--regression-log", null);

const VIDEO = path.join(ROOT, "out", "final", "pilot-sky-blue", "final.mp4");
const PACKAGING = { titleText: "Why Is the Sky Blue?", thumbnailText: "WHY IS THE SKY BLUE?", expectedViewerPromise: ["why the sky is blue"], openingMustEstablish: ["sky blue", "why"], mustNotImply: ["ocean reflection"] };

function write(rel, doc) {
  cr.contract.assertNoFabricatedRetention(doc);
  const abs = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(doc, null, 2) + "\n");
  return rel;
}
function timed(fn, n = 30) {
  const ds = [];
  let out;
  for (let i = 0; i < n; i++) { const t = process.hrtime.bigint(); out = fn(); ds.push(Number(process.hrtime.bigint() - t) / 1e6); }
  ds.sort((a, b) => a - b);
  return { out, n, medianMs: Number(ds[Math.floor(n / 2)].toFixed(2)), p95Ms: Number(ds[Math.min(n - 1, Math.ceil(n * 0.95) - 1)].toFixed(2)), maxMs: Number(ds[n - 1].toFixed(2)) };
}
const counts = (findings) => cr.contract.countBySeverity(findings);
const codesOf = (findings) => findings.filter((f) => f.status === "OPEN" || f.status === "REVIEW_REQUIRED").map((f) => f.code);
function dims(analysis, watchReport) {
  const f = analysis.findings;
  const w = watchReport ? watchReport.findings.filter((x) => !f.some((y) => y.findingId === x.findingId)) : [];
  const c = (list) => { const k = counts(list); return { total: k.P0 + k.P1 + k.P2 + k.P3, P1: k.P1, P2: k.P2, P3: k.P3 }; };
  return {
    hook: c(analysis.hookReport.findings), beats: c(analysis.beatReport.findings), rhythm: c(analysis.rhythmReport.findings), multimodal: c(w),
    P0P1: counts(f).P0 + counts(f).P1, P1P2: counts(f).P1 + counts(f).P2 + counts(w.filter((x) => x.status === "OPEN")).P1 + counts(w.filter((x) => x.status === "OPEN")).P2,
    openCodes: codesOf([...f, ...w]),
  };
}

function suiteResults() {
  const dir = path.join(ROOT, "tests", "creative");
  const rows = [];
  const cases = {};
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".js")).sort()) {
    const t0 = Date.now();
    const r = childProcess.spawnSync(process.execPath, [path.join(dir, f)], { encoding: "utf8", cwd: ROOT, timeout: 300000 });
    const out = r.stdout || "";
    const m = out.match(/=== (\S+): (\d+) failed, (\d+) passed ===/);
    rows.push({ file: `tests/creative/${f}`, command: `node tests/creative/${f}`, exit: r.status, failed: m ? Number(m[2]) : null, passed: m ? Number(m[3]) : null, wallMs: Date.now() - t0, skipped: /\[SKIP\]/.test(out) });
    for (const line of out.split("\n")) {
      const lm = line.match(/^\[(PASS|FAIL)\] (.*?)( — .*)?$/);
      if (!lm) continue;
      for (const cm of lm[2].matchAll(/Case ([A-Z]{1,2})\b/g)) cases[cm[1]] = { status: lm[1], test: lm[2], file: `tests/creative/${f}` };
    }
  }
  return { rows, cases };
}

function agentReviewer(file) {
  const j = JSON.parse(fs.readFileSync(file, "utf8"));
  return {
    j,
    reviewer: {
      provider: j.provider, model: j.model, modelVersion: j.modelVersion || null, rubricVersion: j.rubricVersion, samplingStrategy: j.samplingStrategy,
      review({ segment }) {
        const mine = (j.findings || []).filter((f) => segment.kind === "BEAT" && segment.beatIds[0] === f.beatId);
        return { findings: mine, clears: (j.clears || []).filter((c) => segment.kind === "BEAT" && segment.beatIds[0] === c.beatId), costUsd: j.costUsdPerSegment || 0, latencyMs: j.latencyMsPerSegment || 0, tokens: 0 };
      },
    },
  };
}

(function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const written = [];
  const summary = { phase: "6A", generatedAt: new Date().toISOString(), policyVersion: cr.policy.POLICY_VERSION, host: { node: process.version, platform: process.platform } };

  // ---------------------------------------------------------------- 1. real pilot FULL_WATCH
  if (fs.existsSync(VIDEO)) {
    const inp = cr.adapter.fromLegacyProject(ROOT, "pilot-sky-blue", { videoPath: VIDEO, packaging: PACKAGING });
    if (!inp.ok) throw new Error("pilot adapter failed: " + JSON.stringify(inp.errors));
    const t = timed(() => cr.analyzeCreativeRetention(inp.input), 30);
    const a = t.out;
    let reviewer = null;
    let agent = null;
    if (AGENT_REVIEW && fs.existsSync(AGENT_REVIEW)) { const r = agentReviewer(AGENT_REVIEW); reviewer = r.reviewer; agent = r.j; }
    const w0 = process.hrtime.bigint();
    const w = cr.runWatch(a, { mode: "FULL_WATCH", probeVideo: cr.adapter.probeVideoDurationMs, ...(reviewer ? { reviewer } : {}) });
    const watchWall = Number(process.hrtime.bigint() - w0) / 1e6;
    const risk = w.riskReport;
    written.push(write("pilot/hook-quality-report.json", a.hookReport));
    written.push(write("pilot/narrative-beat-quality-report.json", a.beatReport));
    written.push(write("pilot/visual-rhythm-report.json", a.rhythmReport));
    written.push(write("pilot/creative-fingerprint.json", a.fingerprint));
    written.push(write("pilot/creative-retention-risk-report.json", risk));
    written.push(write("pilot/multimodal-watch-report.json", w.watchReport));
    const accepted = JSON.parse(fs.readFileSync(path.join(ROOT, "projects", "pilot-sky-blue", "render", "final-artifact.json"), "utf8"));
    summary.pilot = {
      project: "pilot-sky-blue", packagingInput: "DERIVED from the pilot's own title card (pilot predates Phase 4A; not a published package)",
      video: { path: path.relative(ROOT, VIDEO).split(path.sep).join("/"), sha256: w.watchReport.video.sha256, matchesAcceptedFinalArtifact: w.watchReport.video.sha256 === accepted.sha256, probedDurationMs: w.watchReport.video.probedDurationMs, timelineDurationMs: w.watchReport.video.timelineDurationMs },
      mode: w.watchReport.mode, verdict: w.watchReport.verdict, reviewerMode: w.watchReport.reviewer.mode, reviewerTrace: w.watchReport.reviewer.trace || null,
      hookCheckpointVerdicts: Object.fromEntries(a.hookReport.checkpoints.map((c) => [c.checkpoint, c.verdict])),
      openFindingCounts: counts(w.findings), findings: w.findings.map((f) => ({ code: f.code, severity: f.severity, scope: f.scope, reasonClass: f.reasonClass, repairClass: f.repairClass, status: f.status, source: f.source, reason: f.reason })),
      coverage: w.watchReport.coverage, segmentCount: w.watchReport.segments.length, riskLevel: risk.riskLevel, actualRetention: risk.actualRetention,
      analysisLatency: { medianMs: t.medianMs, p95Ms: t.p95Ms, runs: t.n }, watchWallMs: Number(watchWall.toFixed(2)),
      agentReviewRecorded: agent ? { provider: agent.provider, model: agent.model, framesReviewed: (agent.observations || []).length } : null,
    };
  } else {
    summary.pilot = { status: "NOT_RUN", reason: "pilot-sky-blue final.mp4 absent on this machine" };
  }

  // ---------------------------------------------------------------- 2. REAL-lib project: before -> repair -> after
  {
    const state = pf.buildProject();
    const before = pf.analyze(state);
    const beforeWatch = cr.runWatch(before, { mode: "FULL_WATCH", requireVideo: false });
    const plan = cr.repair.planCreativeRepair(before.findings, { inputFingerprint: before.input.inputFingerprint });
    const t0 = process.hrtime.bigint();
    const loop = cr.repair.runBoundedRepair({ state, analyze: (s) => pf.analyze(s), apply: pf.applyMotion, budgets: { maxAttempts: 3 } });
    const loopWall = Number(process.hrtime.bigint() - t0) / 1e6;
    const repaired = loop.state;
    const after = pf.analyze(repaired);
    // segment re-watch per patched shot, then final FULL_WATCH
    let merged = before.findings;
    const rewatches = [];
    for (const id of repaired.touched || []) {
      const it = repaired.manifest.items.find((i) => i.timelineItemId === id);
      const rw = cr.runWatch(after, { mode: "SEGMENT_REWATCH", affected: { startMs: it.timelineRange.startTime, endMs: it.timelineRange.endTime }, requireVideo: false }).watchReport;
      merged = cr.watch.mergeRewatch(merged, rw);
      rewatches.push({ affected: rw.affected, segments: rw.segments.length, beats: [...new Set(rw.segments.flatMap((s) => s.beatIds))] });
    }
    const afterWatch = cr.runWatch(after, { mode: "FULL_WATCH", requireVideo: false });
    // DAG + incremental plan for the motion-only repair
    const step = plan.steps.find((s) => s.repairClass === "MOTION_PATCH");
    const droot = pf.tmpRoot();
    pf.chain(droot, "p-6a");
    const inv = cr.repair.applyDagInvalidation(droot, "p-6a", step);
    const dagStates = pf.states(droot, "p-6a", pf.ALL);
    const sceneMap = pf.sceneMapOf(state.manifest);
    const prev = {}; const curr = {};
    for (const sc of sceneMap) { prev[sc.sceneId] = "h0"; curr[sc.sceneId] = "h0"; }
    for (const id of repaired.touched || []) { const it = state.manifest.items.find((i) => i.timelineItemId === id); curr[it.sceneId] = "h1"; }
    const total = state.manifest.canonicalDuration.frameCount;
    const lr = cr.repair.planLocalRerender({ sceneMap, totalFrames: total, sceneHashes: { prev, curr }, prevFp: { fingerprintId: "a", timeline: "t-a" }, currFp: { fingerprintId: "b", timeline: "t-b" }, cacheLookup: (k) => ({ status: "HIT_VALID", cachedArtifactRef: `cas:${k}` }) });
    // script-root-cause + music-only DAG decisions
    const redundant = fx.analyze(fx.GOLDEN.find((g) => g.name === "redundant-beats").build());
    const sStep = cr.repair.planCreativeRepair(redundant.findings).steps.find((s) => s.findingCodes.includes("NARRATIVE_REDUNDANCY"));
    const sroot = pf.tmpRoot(); pf.chain(sroot, "p-6a-s");
    const sInv = cr.repair.applyDagInvalidation(sroot, "p-6a-s", sStep);
    const mm = fx.analyze(fx.GOLDEN.find((g) => g.name === "music-energy-mismatch").build());
    const mStep = cr.repair.planCreativeRepair(mm.findings).steps.find((s) => s.repairClass === "MUSIC_MIX_PATCH");
    const mroot = pf.tmpRoot(); pf.chain(mroot, "p-6a-m");
    const mInv = cr.repair.applyDagInvalidation(mroot, "p-6a-m", mStep, { audioHashes: { prevNarrationTimingHash: "n1", nextNarrationTimingHash: "n1", prevFinalMixHash: "m1", nextFinalMixHash: "m2" } });
    written.push(write("repair/creative-repair-plan.json", plan));
    summary.repair = {
      fixture: "REAL Phase 3 Master Timeline + MotionPlan (8 beats / 8 shots / 60s); executor = real MotionPlan.patchMotion",
      before: { ...dims(before, beforeWatch.watchReport), analysisCost: before.cost }, after: { ...dims(after, afterWatch.watchReport), analysisCost: after.cost },
      change: { stepsApplied: loop.attempts.map((a) => a.steps), patchedShots: (repaired.touched || []).length, motionPlanRevision: `${state.motionPlan.revision} -> ${repaired.motionPlan.revision}`, timelineRevisionUnchanged: state.manifest.revision === repaired.manifest.revision },
      regression: { newFindingCodesAfter: codesOf(after.findings).filter((c) => !codesOf(before.findings).includes(c)), p0p1After: counts(after.findings).P0 + counts(after.findings).P1 },
      boundedLoop: { status: loop.status, stopReason: loop.stopReason, attempts: loop.attempts.length, budgetUse: loop.budgetUse, loopWallMs: Number(loopWall.toFixed(2)) },
      segmentRewatch: rewatches, finalFullWatch: { mode: afterWatch.watchReport.mode, verdict: afterWatch.watchReport.verdict, blockers: afterWatch.watchReport.blockers, note: "structural watch (requireVideo:false): no re-render performed for the fixture" },
      repairedFindingStatus: merged.filter((f) => f.code === "REPETITIVE_MOTION_RHYTHM").map((f) => f.status),
      motionOnlyDag: { origin: inv.origin, dirtied: inv.dirtied, states: dagStates },
      incrementalRerenderPlan: { totalFrames: total, dirtyFrames: lr.dirtyFrames, renderedFrameRatio: lr.renderedFrameRatio, fullRenderFallback: lr.fullRenderFallback, renderRegions: lr.incrementalRenderPlan.renderRegions.length, reusableRegions: lr.incrementalRenderPlan.reusableRegions.length, partialQALocalChecks: (lr.partialQAPlan.localChecks || []).length, note: "PLAN-LEVEL: cache lookup stubbed; render execution is the Phase 5B/5C proven capability and was NOT re-run" },
      scriptRootCauseDag: { repairClass: sStep.repairClass, chosenBecause: sStep.chosenBecause, origin: sInv.origin, dirtied: sInv.dirtied },
      musicOnlyDag: { repairClass: mStep.repairClass, speechTiming: mStep.speechTiming, dirtied: mInv.dirtied },
    };
    written.push(write("repair/before-after.json", summary.repair));
  }

  // ---------------------------------------------------------------- 3. golden regressions
  {
    const rows = fx.GOLDEN.map((g) => {
      const a = fx.analyze(g.build());
      const present = g.expect.present.map((p) => ({ ...p, found: a.findings.some((f) => f.code === p.code && f.scope === p.scope && f.reasonClass === p.reasonClass && f.repairClass === p.repairClass && f.status === "OPEN") }));
      const absent = g.expect.absent.map((c) => ({ code: c, clean: !a.findings.some((f) => f.code === c && f.status === "OPEN") }));
      return { fixture: g.name, pass: present.every((p) => p.found) && absent.every((x) => x.clean), present, absent, actualCodes: a.findings.map((f) => `${f.code}/${f.reasonClass}`) };
    });
    summary.golden = { count: rows.length, passed: rows.filter((r) => r.pass).length, assertion: "finding code + scope + reason class + corrective-action class (not model prose)" };
    written.push(write("golden-creative-results.json", { summary: summary.golden, fixtures: rows }));
  }

  // ---------------------------------------------------------------- 4. performance / cost baseline
  {
    const small = timed(() => fx.analyze(fx.baseRaw()), 40);
    const raw = fx.baseRaw();
    const beats = []; const shots = []; const caps = [];
    for (let k = 0; k < 20; k++) {
      for (const b of raw.beats) beats.push({ ...b, beatId: `${b.beatId}-${k}`, sceneId: `${b.sceneId}-${k}`, startMs: b.startMs + k * 90000, endMs: b.endMs + k * 90000, opensLoops: [], resolvesLoops: [] });
      for (const s of raw.shots) shots.push({ ...s, shotId: `${s.shotId}-${k}`, beatId: `${s.beatId}-${k}`, sceneId: `${s.sceneId}-${k}`, startMs: s.startMs + k * 90000, endMs: s.endMs + k * 90000 });
      for (const c of raw.captions) caps.push({ ...c, startMs: c.startMs + k * 90000, endMs: c.endMs + k * 90000 });
    }
    const long = { ...raw, durationMs: 90000 * 20, beats, shots, captions: caps, onScreen: [], music: [] };
    const big = timed(() => fx.analyze(long), 5);
    const a90 = fx.analyze(raw);
    const w = timed(() => cr.runWatch(a90, { mode: "FULL_WATCH", requireVideo: false }), 20);
    const rss = process.memoryUsage().rss / 1048576;
    const budgets = [
      trace.makeBudget("creative.analysis90s.wall", { direction: "lower", target: 25, warning: 100, hardLimit: 500, unit: "ms", rationale: "Deterministic Hook+Beat+Rhythm over a 90s/9-beat/17-shot video", source: "MEASURED_BASELINE", baselineRef: "Report/evidence/phase-6a/phase-6a-summary.json#performance" }),
      trace.makeBudget("creative.analysis30min.wall", { direction: "lower", target: 500, warning: 2000, hardLimit: 4000, unit: "ms", rationale: "180 beats / 340 shots (30-minute-class)", source: "MEASURED_BASELINE", baselineRef: "Report/evidence/phase-6a/phase-6a-summary.json#performance" }),
      trace.makeBudget("creative.fullWatch90s.wall", { direction: "lower", target: 25, warning: 100, hardLimit: 500, unit: "ms", rationale: "Deterministic watch pass incl. segmentation + channel checks", source: "MEASURED_BASELINE", baselineRef: "Report/evidence/phase-6a/phase-6a-summary.json#performance" }),
      trace.makeBudget("creative.modelCallsPerDeterministicAnalysis", { direction: "lower", target: 0, warning: 1, hardLimit: 60, unit: "count", rationale: "Deterministic layer never calls a model (structured state is measured, not estimated); reviewer calls are budgeted by maxModelCalls=60", source: "USER_REQUIREMENT" }),
      trace.makeBudget("creative.repair.maxAttempts", { direction: "lower", target: 1, warning: 2, hardLimit: 3, unit: "count", rationale: "Bounded repair loop (spec RULE 19); exhaustion => REVIEW_REQUIRED", source: "USER_REQUIREMENT" }),
    ];
    const measured = { "creative.analysis90s.wall": small.medianMs, "creative.analysis30min.wall": big.medianMs, "creative.fullWatch90s.wall": w.medianMs, "creative.modelCallsPerDeterministicAnalysis": a90.cost.modelCalls, "creative.repair.maxAttempts": summary.repair ? summary.repair.boundedLoop.attempts : null };
    const verdicts = budgets.map((b) => { const v = measured[b.metric]; return { metric: b.metric, measured: v, target: b.target, warning: b.warning, hardLimit: b.hardLimit, status: v === null ? "NOT_MEASURED" : v <= b.target ? "WITHIN_TARGET" : v <= b.warning ? "WITHIN_WARNING" : v <= b.hardLimit ? "OVER_WARNING" : "OVER_HARD_LIMIT" }; });
    summary.performance = {
      creativeAnalysis: { small90s: { medianMs: small.medianMs, p95Ms: small.p95Ms, runs: small.n }, longform30min: { beats: 180, shots: 340, medianMs: big.medianMs, maxMs: big.maxMs, runs: big.n }, fullWatch90s: { medianMs: w.medianMs, p95Ms: w.p95Ms, runs: w.n } },
      multimodalMinutesAnalyzed: Number((a90.input.durationMs / 60000).toFixed(2)), modelCalls: 0, tokens: 0, costUsd: 0, rssMB: Number(rss.toFixed(1)),
      phase5Regression: { touchedPhase5Modules: false, note: "6A adds lib/creative-retention + schema + tests only; lib/render, lib/incremental, pipeline, scheduler, browser-pool untouched (verified by git diff scope in the report)" },
      budgetVerdicts: verdicts,
    };
    written.push(write("performance-budget-profile-6a.json", { profileId: "perf-budget-6a", version: "1.0.0", extends: "perf-budget-5c (unchanged)", environmentClass: "win32-x64-node24-local", budgets, measured, verdicts }));
  }

  // ---------------------------------------------------------------- 5. suite results + case matrix
  {
    const { rows, cases } = suiteResults();
    let regression = null;
    if (REGRESSION_LOG && fs.existsSync(REGRESSION_LOG)) {
      const txt = fs.readFileSync(REGRESSION_LOG, "utf8");
      const pass = (txt.match(/^PASS /gm) || []).length;
      const fail = (txt.match(/^FAIL /gm) || []).length;
      const exit = (txt.match(/EXIT=(\d+)/) || [])[1];
      regression = { command: "npm test", suitesPassed: pass, suitesFailed: fail, exit: exit === undefined ? null : Number(exit), summaryLine: (txt.match(/=== .* failed suite\(s\) in .*===/) || [""])[0] };
      cases.AF = { status: regression.exit === 0 && fail === 0 ? "PASS" : "FAIL", test: "npm test (full Phase 0–5 + 6A regression)", file: "regression log" };
    }
    summary.suites = rows;
    summary.regression = regression;
    summary.cases = cases;
    written.push(write("suite-results.json", { suites: rows, regression, cases }));
  }

  written.push(write("phase-6a-summary.json", summary));
  console.log(JSON.stringify({ out: path.relative(ROOT, OUT), written, pilotVerdict: summary.pilot && summary.pilot.verdict, goldenPassed: `${summary.golden.passed}/${summary.golden.count}`, suiteFailures: summary.suites.filter((s) => s.exit !== 0).length }, null, 2));
})();
