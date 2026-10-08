"use strict";

/**
 * Phase 6A contracts: terminology guard (Case AD), CreativeFinding contract,
 * persisted artifacts, stale-report protection, analytics anchors (Phase 10 handoff),
 * performance/cost guard (§49).
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const Ajv = require("ajv");
const fx = require("../fixtures/creative-fixture.js");
const { assert, assertEq, runTest, done } = fx.harness("creative/contract");
const cr = fx.cr;
const C = cr.contract;
const schema = JSON.parse(fs.readFileSync(path.join(fx.REPO, "schemas", "creative-retention.schema.json"), "utf8"));
const validator = (def) => new Ajv({ strict: false }).compile({ ...schema, $ref: `#/definitions/${def}` });

runTest("CreativeFinding contract: reason + evidence + repair class are mandatory (no score-only findings)", () => {
  const ok = C.makeFinding("BEAT_NO_PROGRESS", { reason: "r", evidenceRefs: ["beat:b1"], beatId: "b1", startMs: 0, endMs: 1000 });
  assert(C.validateFinding(ok).ok && /^cf-[0-9a-f]{16}$/.test(ok.findingId), "valid finding with stable id");
  assertEq(C.makeFinding("BEAT_NO_PROGRESS", { reason: "r", evidenceRefs: ["beat:b1"], beatId: "b1", startMs: 0, endMs: 1000 }).findingId, ok.findingId, "id is deterministic");
  for (const [label, extra, re] of [["no reason", { evidenceRefs: ["e"] }, /FINDING_WITHOUT_REASON/], ["no evidence", { reason: "r" }, /FINDING_WITHOUT_EVIDENCE/], ["empty evidence", { reason: "r", evidenceRefs: [] }, /FINDING_WITHOUT_EVIDENCE/], ["bad severity", { reason: "r", evidenceRefs: ["e"], severity: "P9" }, /INVALID_SEVERITY/], ["bad status", { reason: "r", evidenceRefs: ["e"], status: "DONE" }, /INVALID_STATUS/]]) {
    let msg = "";
    try { C.makeFinding("BEAT_NO_PROGRESS", extra); } catch (e) { msg = e.message; }
    assert(re.test(msg), `${label} rejected (${msg})`);
  }
  let unknown = "";
  try { C.makeFinding("SCORE_72", { reason: "r", evidenceRefs: ["e"] }); } catch (e) { unknown = e.message; }
  assert(/UNKNOWN_FINDING_CODE/.test(unknown), "unknown codes rejected");
  const v = validator("creativeFinding");
  for (const g of fx.GOLDEN) for (const f of fx.analyze(g.build()).findings) assert(v(f), `${f.code} is schema-valid ${JSON.stringify(v.errors)}`);
  const required = ["HOOK_NO_CLEAR_VALUE", "HOOK_SETUP_TOO_LONG", "HOOK_REPEATS_PACKAGING", "HOOK_PROMISE_DELAYED", "HOOK_PROMISE_MISMATCH", "HOOK_OVERLOADED", "HOOK_CONFUSING", "HOOK_NO_FORWARD_QUESTION", "HOOK_TOO_MANY_OPEN_LOOPS", "HOOK_PAYOFF_GIVEN_TOO_EARLY",
    "OPENING_PROMISE_WEAK", "OPENING_TOO_SLOW", "OPENING_OVERLOADED", "BEAT_NO_PROGRESS", "BEAT_TOO_LONG", "BEAT_TOO_SHORT", "DROPPED_PAYOFF", "NARRATIVE_REDUNDANCY", "DEAD_TIME_RISK",
    "VISUAL_TOO_REPETITIVE", "MOTION_TOO_REPETITIVE", "MOTION_WITHOUT_EDITORIAL_VALUE", "FRAMING_REPETITION", "MODALITY_MONOTONY", "MUSIC_ENERGY_MISMATCH", "AUDIO_VISUAL_ENERGY_MISMATCH", "CAPTION_MOTION_OVERLOAD",
    "MULTIMODAL_REDUNDANCY", "MULTIMODAL_CONTRADICTION", "MULTIMODAL_COGNITIVE_OVERLOAD", "PAYOFF_UNDER_EMPHASIZED", "TRANSITION_CREATIVE_BREAK", "OUTRO_LOSES_MOMENTUM", "PACKAGING_PROMISE_DELAYED",
    "REPETITIVE_MOTION_RHYTHM", "UNNECESSARY_GENERATIVE_MOTION", "OVER_SCORED_SECTION", "UNDER_SCORED_PAYOFF", "SFX_DISTRACTION"];
  for (const code of required) assert(C.FINDING_CATALOG[code], `spec code in catalog: ${code}`);
});

runTest("Case AD — no actual analytics => no fabricated retention (reports, risk report, persistence)", () => {
  const a = fx.analyze(fx.baseRaw());
  const w = cr.runWatch(a, { mode: "FULL_WATCH", requireVideo: false });
  const risk = w.riskReport;
  assertEq([risk.actualRetention, risk.actualRetentionStatus, risk.assessmentKind], [null, "NOT_AVAILABLE_PRE_PUBLISH", "PRE_PUBLISH_CREATIVE_RETENTION_RISK"], "risk report is explicitly pre-publish; actual retention null");
  assert(["LOW", "MEDIUM", "HIGH", "REVIEW_REQUIRED"].includes(risk.riskLevel), "risk is a categorical level, not a percentage");
  for (const [name, doc] of Object.entries({ hook: a.hookReport, beats: a.beatReport, rhythm: a.rhythmReport, fingerprint: a.fingerprint, risk, watch: w.watchReport, findings: a.findings })) {
    assertEq(C.findFabricatedRetention(doc), [], `${name}: no retention/watch-time figure`);
  }
  assert(risk.futureAnalyticsVocabulary.join() === "INTRO,TOP_MOMENTS,SPIKES,DIPS", "YouTube analytics vocabulary kept as FUTURE vocabulary only");
  // injected violations are caught
  for (const bad of [{ predictedRetention: 0.72 }, { x: { avgViewDuration: 41 } }, { summary: "predicted YouTube retention = 72%" }, { summary: "estimated audience retention of 64%" }, { note: "retention: 55%" }]) {
    let code = null;
    try { C.assertNoFabricatedRetention(bad); } catch (e) { code = e.code; }
    assertEq(code, "ACTUAL_RETENTION_FABRICATED", `rejected ${JSON.stringify(bad)}`);
  }
  assert(C.findFabricatedRetention({ actualRetention: null, note: "no retention data exists before publish", creativeRetentionRisk: "LOW" }).length === 0, "honest wording is allowed");
  // persistence refuses a fabricated claim
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "unfoldiq-6a-persist-"));
  let blocked = null;
  try { cr.persistCreativeArtifacts(root, "p6a", { risk: { ...risk, predictedRetention: 0.7 } }); } catch (e) { blocked = e.code; }
  assertEq(blocked, "ACTUAL_RETENTION_FABRICATED", "persist refuses fabricated retention");
  const v = validator("creativeRetentionRiskReport");
  assert(v(risk), "risk report schema-valid " + JSON.stringify(v.errors));
  assert(!v({ ...risk, actualRetention: 0.7 }), "schema rejects a numeric actualRetention");
});

runTest("Required artifacts persist + reload (Hook / Beat / Rhythm / Risk / Watch / Fingerprint / RepairPlan)", () => {
  const a = fx.analyze(fx.GOLDEN.find((g) => g.name === "repetitive-zoom").build());
  const w = cr.runWatch(a, { mode: "FULL_WATCH", requireVideo: false });
  const plan = cr.repair.planCreativeRepair(w.findings, { inputFingerprint: a.input.inputFingerprint });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "unfoldiq-6a-art-"));
  const res = cr.persistCreativeArtifacts(root, "p6a", { hook: a.hookReport, beats: a.beatReport, rhythm: a.rhythmReport, risk: w.riskReport, watch: w.watchReport, fingerprint: a.fingerprint, repairPlan: plan });
  assertEq(res.written.length, 7, "7 artifacts written");
  assertEq(cr.loadCreativeArtifact(root, "p6a", "hook").kind, "HOOK_QUALITY", "HookQualityReport");
  assertEq(cr.loadCreativeArtifact(root, "p6a", "beats").kind, "NARRATIVE_BEAT_QUALITY", "NarrativeBeatQualityReport");
  assertEq(cr.loadCreativeArtifact(root, "p6a", "rhythm").kind, "VISUAL_RHYTHM", "VisualRhythmReport");
  assertEq(cr.loadCreativeArtifact(root, "p6a", "risk").kind, "CREATIVE_RETENTION_RISK", "CreativeRetentionRiskReport");
  assertEq(cr.loadCreativeArtifact(root, "p6a", "watch").kind, "MULTIMODAL_WATCH", "MultimodalWatchReport");
  assertEq(cr.loadCreativeArtifact(root, "p6a", "fingerprint").kind, "CREATIVE_FINGERPRINT", "CreativeFingerprint");
  assertEq(cr.loadCreativeArtifact(root, "p6a", "repairPlan").kind, "CREATIVE_REPAIR_PLAN", "CreativeRepairPlan");
  assertEq(cr.loadCreativeArtifact(root, "p6a", "nope"), null, "unknown artifact key => null");
  // path safety: the store rejects traversal
  let threw = false;
  try { require("../../providers/runtime/artifact-store.js").writeArtifactAtomic(root, "p6a", "../escape.json", "{}"); } catch { threw = true; }
  assert(threw, "artifact store rejects path traversal");
});

runTest("Stale-report protection: a changed script/timeline invalidates a stored PASS (no stale shortcut)", () => {
  const raw = fx.baseRaw();
  const a = fx.analyze(raw);
  assertEq(cr.checkReportStale(a.riskReport, a.input).stale, false, "same input => fresh");
  const changed = fx.baseRaw();
  fx.setText(changed, "b2", "A completely different script now explains something else about nomads and rivers.");
  const b = fx.analyze(changed);
  const s = cr.checkReportStale(a.riskReport, b.input);
  assert(s.stale && s.reason === "INPUT_FINGERPRINT_CHANGED", "script change => stale");
  const motion = fx.baseRaw();
  fx.shot(motion, "s3").motionPrimitive = "ZOOM";
  assert(cr.checkReportStale(a.riskReport, fx.analyze(motion).input).stale, "motion change => stale");
  assert(cr.checkReportStale(null, a.input).stale, "missing report => stale");
});

runTest("Analytics anchors (Phase 10 handoff): a future time maps to hook checkpoint + beat + shot; nothing ingested", () => {
  const a = fx.analyze(fx.baseRaw());
  const at = cr.anchorsAt(a, 3000);
  assertEq(at.hookCheckpoints, ["creative-validation:HOOK_5S", "creative-validation:HOOK_15S", "creative-validation:HOOK_30S"], "0–30s windows all contain t=3s");
  assertEq([at.beatIds, at.shotIds], [["b1"], ["s1"]], "beat + shot anchors");
  assertEq(cr.anchorsAt(a, 75000).hookCheckpoints, [], "after the intro region: no hook checkpoint");
  assert(a.riskReport.analyticsAnchors.fingerprintHash === a.fingerprint.fingerprintHash, "risk report anchors the fingerprint");
});

runTest("Performance / cost guard (§49): deterministic analysis is fast, model-free and within Phase 5 budgets", () => {
  const raw = fx.baseRaw();
  const t0 = Date.now();
  let a;
  for (let i = 0; i < 20; i++) a = fx.analyze(raw);
  const per = (Date.now() - t0) / 20;
  assert(per < 150, `analysis ${per.toFixed(1)}ms per run (budget 150ms for a 90s/9-beat/17-shot video)`);
  assertEq(a.cost, { modelCalls: 0, tokens: 0, costUsd: 0 }, "deterministic layer makes zero model calls");
  const big = fx.baseRaw();
  const base = big.beats.length;
  const beats = []; const shots = []; const caps = [];
  for (let k = 0; k < 20; k++) {
    for (const b of big.beats) beats.push({ ...b, beatId: `${b.beatId}-${k}`, sceneId: `${b.sceneId}-${k}`, startMs: b.startMs + k * 90000, endMs: b.endMs + k * 90000, opensLoops: [], resolvesLoops: [] });
    for (const s of big.shots) shots.push({ ...s, shotId: `${s.shotId}-${k}`, beatId: `${s.beatId}-${k}`, sceneId: `${s.sceneId}-${k}`, startMs: s.startMs + k * 90000, endMs: s.endMs + k * 90000 });
    for (const c of big.captions) caps.push({ ...c, startMs: c.startMs + k * 90000, endMs: c.endMs + k * 90000 });
  }
  const long = { ...big, durationMs: 90000 * 20, beats, shots, captions: caps, onScreen: [], music: [] };
  const t1 = Date.now();
  const L = fx.analyze(long);
  const wall = Date.now() - t1;
  assert(L.input.beats.length === base * 20 && wall < 4000, `30-minute-class input (${L.input.beats.length} beats, ${L.input.shots.length} shots) analysed in ${wall}ms (< 4s)`);
});

done();
