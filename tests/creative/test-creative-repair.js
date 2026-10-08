"use strict";

/**
 * Phase 6A §38–§44 Creative Repair — Cases V, W(rewatch after repair), X, Y, Z, AA, AC.
 * Uses the REAL Phase 3 libs (Master Timeline, MotionPlan.patchMotion), the REAL
 * Dependency DAG and the REAL Phase 5B incremental/Partial-QA planners. No mocks of
 * those contracts; only the render cache lookup is a stub (render execution is a
 * Phase 5B/5C proven capability and is not re-run here).
 */

const fs = require("fs");
const path = require("path");
const fx = require("../fixtures/creative-fixture.js");
const tlfx = require("../fixtures/timeline-control-fixture.js");
const dag = require("../../lib/dependency-dag/index.js");
const { assert, assertEq, runTest, done } = fx.harness("creative/repair");
const cr = fx.cr;
const R = cr.repair;

const pf = require("../fixtures/creative-project-fixture.js");
const { buildProject, adapt, analyze, chain, tmpRoot, eff, states, ALL, applyMotion, sceneMapOf } = pf;

runTest("Case V — local creative repair, end to end on real Phase 3 libs: finding -> plan -> real patchMotion -> re-analysis", () => {
  const state = buildProject();
  const before = analyze(state);
  const f = before.findings.find((x) => x.code === "REPETITIVE_MOTION_RHYTHM");
  assert(f && f.reasonClass === "CONSTANT_ZOOM", "real MotionPlan with 8 consecutive zooms => CONSTANT_ZOOM: " + JSON.stringify(before.findings.map((x) => x.code)));
  assert(!before.findings.some((x) => ["P0", "P1"].includes(x.severity)), "no unrelated P1 in the fixture");
  const plan = R.planCreativeRepair(before.findings, { inputFingerprint: before.input.inputFingerprint });
  const step = plan.steps.find((s) => s.findingCodes.includes("REPETITIVE_MOTION_RHYTHM"));
  assert(step && step.repairClass === "MOTION_PATCH" && step.owner === "MOTION_PLAN" && step.op === "patchMotion" && step.local, "routed to the Phase 3B owner as a local patch");
  const res = applyMotion(plan, state);
  assertEq(res.state.motionPlan.revision, state.motionPlan.revision + 2, "two real SET_STATIC patches applied (revision +2)");
  assert(res.state.manifest === state.manifest && res.state.manifest.revision === state.manifest.revision, "Master Timeline untouched (motion-only)");
  const after = analyze(res.state);
  assert(!after.findings.some((x) => x.code === "REPETITIVE_MOTION_RHYTHM"), "constant-zoom finding gone after repair");
  assertEq(cr.contract.countBySeverity(after.findings).P2 < cr.contract.countBySeverity(before.findings).P2, true, "P2 count dropped");
  assertEq(res.state.touched.length, 2, "exactly the minimal 2 shots changed");
});

runTest("Case Z — motion-only repair stays local: DAG branch, audio/captions clean, incremental render + partial QA cover only dirty scenes", () => {
  const state = buildProject();
  const plan = R.planCreativeRepair(analyze(state).findings);
  const step = plan.steps.find((s) => s.repairClass === "MOTION_PATCH");
  const root = tmpRoot();
  chain(root, "p-z");
  const inv = R.applyDagInvalidation(root, "p-z", step);
  assert(inv.ok && inv.origin === "ANIM_T", "invalidation originates at the animation-timing node");
  assertEq(inv.dirtied, ["RENDER", "TIMELINE"], "only the motion branch + render dirty");
  const s = states(root, "p-z", ALL);
  for (const k of ["SCRIPT", "AUDIO", "ALIGN", "CAPTIONS", "SCENE_T", "VIS_T"]) assertEq(s[k], "CLEAN", `${k} stays CLEAN`);
  assert(tlfx.motion.resolveMotionInvalidation().finalAudioClean && tlfx.motion.resolveMotionInvalidation().captionsClean, "Phase 3B motion invalidation contract agrees");
  const rp = dag.planRebuild(root, "p-z").plan;
  assert(rp.rebuild.includes("TIMELINE") && rp.rebuild.includes("RENDER") && !rp.rebuild.includes("AUDIO") && rp.reuse.includes("CAPTIONS"), "selective rebuild plan: motion branch only, audio/captions reused");
  // incremental render + partial QA over the two patched scenes only
  const repaired = applyMotion(plan, state).state;
  const sceneMap = sceneMapOf(state.manifest);
  const prevScene = {}; const currScene = {};
  for (const sc of sceneMap) { prevScene[sc.sceneId] = "h0"; currScene[sc.sceneId] = "h0"; }
  for (const id of repaired.touched) { const it = state.manifest.items.find((i) => i.timelineItemId === id); currScene[it.sceneId] = "h1"; }
  const total = state.manifest.canonicalDuration.frameCount;
  const lr = R.planLocalRerender({
    sceneMap, totalFrames: total, sceneHashes: { prev: prevScene, curr: currScene },
    prevFp: { fingerprintId: "fp-a", timeline: "t-a" }, currFp: { fingerprintId: "fp-b", timeline: "t-b" },
    cacheLookup: (key) => ({ status: "HIT_VALID", cachedArtifactRef: `cas:${key}` }),
  });
  assertEq(lr.fullRenderFallback, false, "no full-render fallback");
  assert(lr.renderedFrameRatio > 0 && lr.renderedFrameRatio < 0.4, `only ${(lr.renderedFrameRatio * 100).toFixed(1)}% of frames re-rendered`);
  assert(lr.incrementalRenderPlan.renderRegions.length === 2 && lr.incrementalRenderPlan.reusableRegions.length >= 1, "2 render regions + reused clean regions");
  assert(lr.partialQAPlan && !lr.partialQAPlan.error && JSON.stringify(lr.partialQAPlan).includes("black"), "Partial QA plan produced (localized checks + global mandatory)");
});

runTest("Case X + W — segment re-watch after repair, then FINAL FULL re-watch on the repaired project", () => {
  const state = buildProject();
  const before = analyze(state);
  const plan = R.planCreativeRepair(before.findings);
  const repaired = applyMotion(plan, state).state;
  const after = analyze(repaired);
  const tmp = tmpRoot();
  const video = path.join(tmp, "final.mp4");
  fs.writeFileSync(video, Buffer.from("rendered-bytes-after-local-repair"));
  // segment re-watch of each patched shot (affected + 1 context beat each side)
  let findings = before.findings;
  for (const id of repaired.touched) {
    const it = repaired.manifest.items.find((i) => i.timelineItemId === id);
    const rw = cr.runWatch(after, { mode: "SEGMENT_REWATCH", affected: { startMs: it.timelineRange.startTime, endMs: it.timelineRange.endTime }, requireVideo: false }).watchReport;
    const idsInWindow = new Set(rw.segments.flatMap((s) => s.beatIds));
    assert(idsInWindow.size <= 3, `rewatch covers ≤3 beats (got ${[...idsInWindow]} for ${it.timelineRange.startTime}-${it.timelineRange.endTime})`);
    findings = cr.watch.mergeRewatch(findings, rw);
  }
  const zoom = findings.find((f) => f.code === "REPETITIVE_MOTION_RHYTHM");
  assertEq(zoom.status, "REPAIRED", "segment re-watch confirmed the repair");
  // final FULL watch on the repaired state with the (stand-in) re-rendered video
  const finalInput = adapt(repaired, { video: { path: video, durationMs: 60000 } });
  const finalAnalysis = cr.analyzeCreativeRetention(finalInput);
  const full = cr.runWatch(finalAnalysis, { mode: "FULL_WATCH" });
  assertEq(full.watchReport.mode, "FULL_WATCH", "final FULL_WATCH");
  const open = cr.contract.countBySeverity(full.watchReport.findings);
  assert(open.P0 === 0 && open.P1 === 0, "no P0/P1 after repairs");
  assert(full.watchReport.verdict !== "FAIL" && full.riskReport.actualRetention === null, `final verdict ${full.watchReport.verdict}; no retention claim`);
  assert(full.watchReport.video.consumed, "final watch consumed the video");
});

runTest("Case Y — script is the root cause: script-class repair + correct downstream DAG invalidation (no stale shortcut)", () => {
  const redundant = fx.analyze(fx.GOLDEN.find((g) => g.name === "redundant-beats").build());
  const plan = R.planCreativeRepair(redundant.findings);
  const step = plan.steps.find((s) => s.findingCodes.includes("NARRATIVE_REDUNDANCY"));
  assert(step.repairClass === "SCRIPT_TRIM" && step.owner === "STORY_SCRIPT" && step.chosenBecause === "SCRIPT_IS_ROOT_CAUSE" && !step.local, "SEMANTIC_REPEAT is fixed at the script, not papered over locally");
  assertEq(step.speechTiming, "CHANGES", "script change changes speech timing");
  const root = tmpRoot();
  chain(root, "p-y");
  const inv = R.applyDagInvalidation(root, "p-y", step);
  assert(inv.ok && inv.origin === "SCRIPT", "origin = FINAL_SPOKEN_SCRIPT");
  assertEq(inv.dirtied, ["ALIGN", "ANIM_T", "AUDIO", "CAPTIONS", "RENDER", "SCENE_T", "TIMELINE", "VIS_T"], "script -> TTS/Audio -> Alignment -> Captions -> timing consumers -> Timeline -> Render all DIRTY");
  assertEq(eff(root, "p-y", "SCRIPT"), "CLEAN", "the edited node itself is the new baseline");
  const rp = dag.planRebuild(root, "p-y").plan;
  assert(rp.rebuild.length === 8 && !rp.reuse.includes("RENDER"), "stale RENDER cannot be reused");
  // locked downstream is never auto-regenerated
  const root2 = tmpRoot();
  chain(root2, "p-y2");
  dag.setNodeLockTarget(root2, "p-y2", "TIMELINE", { targetType: "SCENE", targetId: "t" });
  const inv2 = R.applyDagInvalidation(root2, "p-y2", step, { locksReader: (t) => (t.targetId === "t" ? "LOCKED" : null) });
  assert(inv2.ok && inv2.blocked.includes("TIMELINE"), "locked TIMELINE becomes BLOCKED instead of being regenerated");
  // local alternative is chosen when the script is NOT the root cause
  const long = R.planCreativeRepair([cr.contract.makeFinding("BEAT_TOO_LONG", { reason: "x", evidenceRefs: ["beat:b2"], beatId: "b2", startMs: 7000, endMs: 60000 })]);
  assertEq([long.steps[0].repairClass, long.steps[0].chosenBecause], ["BEAT_RETIME_OR_SPLIT", "LOWEST_COST_QUALITY_EQUIVALENT"], "BEAT_TOO_LONG prefers local timing over script regeneration");
  assertEq(long.steps[0].alternatives, ["BEAT_RETIME_OR_SPLIT", "SCRIPT_TRIM"], "script trim retained as a recorded alternative");
  const rootL = tmpRoot();
  chain(rootL, "p-yl");
  const invL = R.applyDagInvalidation(rootL, "p-yl", long.steps[0]);
  for (const k of ["SCRIPT", "AUDIO", "ALIGN", "CAPTIONS"]) assertEq(eff(rootL, "p-yl", k), "CLEAN", `${k} untouched by a timing-only repair`);
  assertEq(invL.dirtied.includes("RENDER"), true, "render branch dirty");
});

runTest("Case AA — music-only repair preserves speech timing: only the render branch is dirty (and a timing change cascades)", () => {
  const mm = fx.analyze(fx.GOLDEN.find((g) => g.name === "music-energy-mismatch").build());
  const plan = R.planCreativeRepair(mm.findings);
  const step = plan.steps.find((s) => s.repairClass === "MUSIC_MIX_PATCH");
  assert(step && step.owner === "AUDIO_MIX" && step.speechTiming === "PRESERVED" && step.local, "routed to the Phase 2 audio-mix owner, speech timing preserved");
  const hashes = { prevNarrationTimingHash: "nth-1", nextNarrationTimingHash: "nth-1", prevFinalMixHash: "fmh-1", nextFinalMixHash: "fmh-2" };
  const inv0 = R.resolveAudioRepairInvalidation(hashes);
  assert(inv0.mixOnlyChange && inv0.dagMode === "NODES_ONLY" && !inv0.speechTimingDirty, "Phase 3A contract: mix-only change");
  const root = tmpRoot();
  chain(root, "p-aa");
  const inv = R.applyDagInvalidation(root, "p-aa", step, { audioHashes: hashes });
  assertEq(inv.dirtied, ["RENDER"], "only RENDER dirty");
  const s = states(root, "p-aa", ALL);
  for (const k of ["SCRIPT", "AUDIO", "ALIGN", "CAPTIONS", "SCENE_T", "VIS_T", "ANIM_T", "TIMELINE"]) assertEq(s[k], "CLEAN", `${k} CLEAN (speech timing, alignment, captions, timeline preserved)`);
  // speech timing changed => cascade from FINAL_AUDIO
  const root2 = tmpRoot();
  chain(root2, "p-aa2");
  const inv2 = R.applyDagInvalidation(root2, "p-aa2", step, { audioHashes: { ...hashes, nextNarrationTimingHash: "nth-2" } });
  assertEq(inv2.origin, "AUDIO", "timing change cascades from FINAL_AUDIO");
  assert(["ALIGN", "CAPTIONS", "TIMELINE", "RENDER"].every((k) => inv2.dirtied.includes(k)), "alignment/captions/timeline/render dirty");
});

runTest("Repair routing table (§39) — every catalog code maps to an owning subsystem; related findings share one step", () => {
  for (const [code, c] of Object.entries(cr.contract.FINDING_CATALOG)) assert(R.REPAIR_CLASSES[c.repairClass], `${code} -> ${c.repairClass} has an owner`);
  const mk = (code, extra = {}) => cr.contract.makeFinding(code, { reason: "r", evidenceRefs: ["e:1"], startMs: 0, endMs: 1000, ...extra });
  const pick = (f, ctx) => R.planCreativeRepair([f], ctx).steps[0];
  assertEq(pick(mk("HOOK_SETUP_TOO_LONG")).repairClass, "BEAT_RETIME_OR_SPLIT", "setup too long -> timeline/shot-order first");
  assertEq(pick(mk("PACKAGING_PROMISE_DELAYED")).repairClass, "PACKAGING_REVISION", "promise delayed -> packaging revision (cheapest equivalent)");
  assertEq(pick(mk("PACKAGING_PROMISE_DELAYED"), { packagingLocked: true }).repairClass, "OPENING_EDIT", "…or opening edit when packaging is locked");
  assertEq(pick(mk("NARRATIVE_REDUNDANCY")).repairClass, "SCRIPT_TRIM", "redundancy -> local script/beat trim");
  assertEq(pick(mk("REPETITIVE_MOTION_RHYTHM")).repairClass, "MOTION_PATCH", "repetitive motion -> MotionPlan patch");
  assertEq(pick(mk("FRAMING_REPETITION")).repairClass, "FRAMING_LAYOUT_PATCH", "framing -> layout/framing patch");
  assertEq(pick(mk("UNNECESSARY_GENERATIVE_MOTION")).repairClass, "ASSET_MODALITY_REPLACE", "unneeded Veo -> Image/Remotion");
  assertEq(pick(mk("MUSIC_ENERGY_MISMATCH")).repairClass, "MUSIC_MIX_PATCH", "music mismatch -> Phase 2 mix patch");
  assertEq(pick(mk("CAPTION_MOTION_OVERLOAD")).owner, "MOTION_PLAN", "caption overload -> motion/layout reduction (never caption rewrite)");
  const ver = R.planCreativeRepair([mk("MULTIMODAL_CONTRADICTION", { evidenceRefs: ["phase4:TREND_MISMATCH"] })]);
  assertEq([ver.steps.length, ver.routedTechnical[0].phase4Code], [0, "TREND_MISMATCH"], "technical defects route to the Phase 4 taxonomy, not a creative patch");
  const hookF = mk("HOOK_SETUP_TOO_LONG");
  const composite = mk("OPENING_TOO_SLOW", { relatedFindingIds: [hookF.findingId] });
  const grouped = R.planCreativeRepair([hookF, composite]);
  assertEq(grouped.steps.length, 1, "composite + hook finding repaired by ONE step (no duplicate repair)");
  assertEq(R.planCreativeRepair([mk("MODEL_DISAGREEMENT", { status: "REVIEW_REQUIRED" })]).steps.length, 0, "REVIEW_REQUIRED findings are not auto-repaired");
  assertEq(R.planCreativeRepair([mk("MODEL_DISAGREEMENT")]).manualReview.length, 1, "REVIEW_ONLY class goes to manual review");
});

runTest("Case AC — bounded repair hard stop: no progress, attempts, render budget, credit gate, time budget => REVIEW_REQUIRED", () => {
  const stuck = cr.contract.makeFinding("REPETITIVE_MOTION_RHYTHM", { reason: "r", evidenceRefs: ["shot:a"], startMs: 0, endMs: 1000, shotId: "a" });
  const run = (budgets, apply = (p, s) => ({ state: s, renders: 1 }), analyze = () => ({ findings: [stuck], input: { inputFingerprint: "x" } })) => R.runBoundedRepair({ state: {}, analyze, apply, budgets });
  const a = run({ maxAttempts: 5 });
  assertEq([a.status, a.stopReason], ["REVIEW_REQUIRED", "NO_PROGRESS"], "an unchanged finding stops after the second identical attempt");
  assert(a.attempts.length === 2 && a.findings.some((f) => f.code === "CREATIVE_REPAIR_BUDGET_EXHAUSTED" && f.status === "REVIEW_REQUIRED"), "budget-exhausted finding handed to REVIEW_REQUIRED");
  const b = run({ maxAttempts: 1 });
  assertEq([b.status, b.stopReason, b.attempts.length], ["REVIEW_REQUIRED", "ATTEMPTS_EXHAUSTED", 1], "maxAttempts honoured");
  const c = run({ maxAttempts: 5, maxLocalRenders: 0, maxFullRenders: 0 });
  assertEq(c.stopReason, "RENDER_BUDGET", "render budget stops before any render");
  assertEq(c.attempts.length, 0, "no attempt consumed a render over budget");
  let clock = 0;
  const d = R.runBoundedRepair({ state: {}, analyze: () => ({ findings: [stuck], input: {} }), apply: (p, s) => { clock += 100000; return { state: s, renders: 0 }; }, budgets: { maxAttempts: 9, timeBudgetMs: 150000 }, now: () => clock });
  assertEq(d.stopReason === "TIME_BUDGET" || d.stopReason === "NO_PROGRESS", true, "time budget enforced (or no-progress earlier)");
  const credit = cr.contract.makeFinding("UNNECESSARY_GENERATIVE_MOTION", { severity: "P2", reason: "r", evidenceRefs: ["shot:a"], shotId: "a", startMs: 0, endMs: 1000 });
  const e = R.runBoundedRepair({ state: {}, analyze: () => ({ findings: [credit], input: {} }), apply: () => { throw new Error("must not run: would spend provider credits"); }, budgets: { providerCredits: 0 } });
  assertEq([e.status, e.stopReason], ["REVIEW_REQUIRED", "CREDIT_BUDGET"], "no blind paid retries without a credit budget");
  // converging loop with the REAL motion repair
  const state = buildProject();
  const real = R.runBoundedRepair({
    state, analyze: (s) => analyze(s), apply: applyMotion, budgets: { maxAttempts: 3 },
  });
  assertEq(real.status, "CONVERGED", "real loop converges");
  assert(real.attempts.length === 1 && real.before.counts.P2 > real.after.counts.P2, `before ${JSON.stringify(real.before.counts)} -> after ${JSON.stringify(real.after.counts)}`);
  assert(real.budgetUse.renders === 1 && real.budgetUse.modelCalls === 0 && real.budgetUse.providerCredits === 0, "render/model/credit use recorded: " + JSON.stringify(real.budgetUse));
});

runTest("§44 no variant explosion: only small local alternatives; full-video variants belong to 6B", () => {
  assertEq(R.requestVariants({ scope: "LOCAL_SCENE", count: 2 }).ok, true, "2 local alternatives allowed");
  for (const req of [{ scope: "FULL_VIDEO" }, { fullVideo: true }, { scope: "LOCAL_SCENE", count: 5 }]) {
    let code = null;
    try { R.requestVariants(req); } catch (e) { code = e.code; }
    assertEq(code, "VARIANT_EXPLOSION_BLOCKED", `blocked: ${JSON.stringify(req)}`);
  }
  assertEq(R.planCreativeRepair([]).variantPolicy.fullVideoVariants, 0, "plans never request full-video variants");
});

done();
