"use strict";

/** Phase 6B / 6.6 — Explainable Quality Scoring (Q01-Q10) + golden calibration bands. */

const fx = require("../fixtures/creative-fixture.js");
const D = require("../fixtures/differentiation-fixture.js");
const { assert, assertEq, runTest, done } = fx.harness("creative/quality-scoring");
const q = D.dif.quality;
const { S, bag, allDet, KEYS } = D.quality;
const GOLD = D.goldenQuality();

runTest("Q01: all 13 rubric dimensions are mapped to evidence, reason, confidence, assessor and action", () => {
  assertEq(q.DIMENSION_KEYS, ["narration", "scriptNaturalness", "evidenceFidelity", "imagery", "visualFactuality", "continuity", "motion", "sound", "captions", "pacing", "semanticAlignment", "originality", "packaging"], "exact thirteen dimensions");
  const r = q.rubric();
  assertEq(Object.keys(r.dimensions).length, 13, "rubric lists 13 dimensions");
  for (const d of Object.values(r.dimensions)) assert(d.anchors[0] && d.anchors[2] && d.anchors[4] && d.owner && d.requiredFields.includes("evidenceRefs"), "anchors + owner + required fields per dimension");
  const a = q.assessQuality(GOLD[0].ev);
  for (const d of a.dimensions) assert(d.rubricVersion && d.rationale && Array.isArray(d.evidenceRefs) && d.confidence && d.assessor && Array.isArray(d.findings) && d.actionableImprovement && d.owner, `${d.key}: full schema`);
  assertEq(a.rubricVersion, D.dif.policy.RUBRIC_VERSION, "rubric version stamped");
});

runTest("Q02: stable schema; missing info never becomes PASS", () => {
  const a = q.assessQuality(GOLD.find((g) => g.name === "missing-evidence").ev);
  for (const k of ["imagery", "continuity"]) {
    const d = a.dimensions.find((x) => x.key === k);
    assertEq([d.status, d.ordinalScore, d.confidence], ["NOT_MEASURED", undefined, "LOW"], `${k}: NOT_MEASURED, no score, LOW confidence`);
  }
  assertEq(a.finalDecision, "REVIEW_REQUIRED", "missing evidence blocks PASS");
  assert(a.recommendedRepairs.some((r) => r.dimension === "imagery" && r.owner === "ASSET_GENERATION"), "missing evidence routed to its owner");
  let code = null;
  try { q.assessQuality({ projectId: "x" }); } catch (e) { code = e.code; }
  assertEq(code, "QUALITY_INPUT_INVALID", "input contract enforced");
});

runTest("Q03: NOT_APPLICABLE and NOT_MEASURED are distinct; neither is 0 nor a perfect score", () => {
  const a = q.assessQuality(GOLD.find((g) => g.name === "intentional-silence-and-static").ev);
  const sound = a.dimensions.find((d) => d.key === "sound");
  assertEq([sound.applicability, sound.ordinalScore], ["NOT_APPLICABLE", undefined], "sound NOT_APPLICABLE, no ordinal");
  assertEq(a.coverage.notApplicable, ["sound"], "listed separately");
  assertEq(a.coverage.applicable, 12, "denominator excludes N/A");
  assertEq(a.finalDecision, "PASS", "intentional absence is not a defect");
  const m = q.assessQuality(GOLD.find((g) => g.name === "missing-evidence").ev);
  assertEq(m.coverage.missingDimensions, ["imagery", "continuity"], "NOT_MEASURED counted as missing");
  assert(m.summary.score === 3 && m.summary.partial === true, "score is over assessed dims only and flagged partial (not treated as 0)");
});

runTest("Q04: a strong aggregate score never bypasses a P0/P1 factual / rights / safety / technical / approval block", () => {
  for (const g of GOLD.filter((x) => x.expect.blocked)) {
    const a = q.assessQuality(g.ev);
    assertEq([a.finalDecision, a.summary.score], ["FAIL", 4], `${g.name}: FAIL with score 4.0`);
    assert(a.blockingFindings.length > 0, `${g.name}: blocking finding recorded`);
  }
  const p2 = q.assessQuality(bag("q-p2", allDet(4), { hardBlockers: [{ id: "X", category: "FACTUAL", severity: "P2", reason: "minor", evidenceRef: "e" }] }));
  assertEq(p2.finalDecision, "PASS", "only P0/P1 are hard blockers");
});

runTest("Q05: model judgment cannot override deterministic failures; a model failure alone needs confirmation", () => {
  const a = q.assessQuality(GOLD.find((g) => g.name === "model-disagrees-with-deterministic-fail").ev);
  const c = a.dimensions.find((d) => d.key === "captions");
  assertEq([c.status, c.assessor], ["FAIL", "DETERMINISTIC"], "deterministic FAIL stands over a model PASS");
  assert(c.findings.includes("MODEL_DISAGREEMENT_WITH_DETERMINISTIC_QA"), "disagreement recorded");
  const mf = q.assessQuality(bag("q-mf", allDet(3, { imagery: [S("imagery", "DETERMINISTIC", "PASS", 3), S("imagery", "MODEL", "FAIL", 0)] })));
  const im = mf.dimensions.find((d) => d.key === "imagery");
  assertEq(im.status, "REVIEW_REQUIRED", "model FAIL vs deterministic PASS -> review, not an automatic FAIL");
  assert(im.findings.includes("MODEL_DISAGREEMENT_WITH_DETERMINISTIC_QA"), "disagreement recorded");
  const mo = q.assessQuality(GOLD.find((g) => g.name === "model-only-on-deterministic-dimension").ev);
  assertEq(mo.dimensions.find((d) => d.key === "captions").status, "REVIEW_REQUIRED", "model-only evidence cannot PASS a measurable dimension");
});

runTest("Q06: a rubric/policy/evidence change invalidates the cached assessment — video bytes are not part of the key", () => {
  const ev = GOLD[0].ev;
  const a = q.assessQuality(ev);
  assertEq(q.isQualityStale(a, ev).stale, false, "fresh");
  const old = JSON.parse(JSON.stringify(a));
  old.cache.parts.rubricVersion = "0.9.0";
  const s = q.isQualityStale(old, ev);
  assert(s.stale && s.reasons.length === 1 && s.reasons[0] === "rubricVersion", `rubric version bump -> stale (${s.reasons})`);
  const changed = q.isQualityStale(a, { ...ev, signals: [...ev.signals, S("pacing", "HUMAN", "FAIL", 0)] });
  assert(changed.stale && changed.reasons.includes("evidenceHash"), "new evidence -> stale");
  assertEq(a.videoSha256, ev.videoSha256, "same video bytes before and after the rubric change (only the assessment is invalidated)");
});

runTest("Q07: golden good/bad/borderline outcomes are consistent with persisted expected bands (no magic threshold)", () => {
  assertEq(GOLD.length, 12, "12 golden quality fixtures");
  for (const g of GOLD) {
    const a = q.assessQuality(g.ev);
    const b = q.assessQuality(JSON.parse(JSON.stringify(g.ev)));
    assertEq(a.finalDecision, g.expect.decision, `${g.name}: decision`);
    assertEq(a.dimensions.map((d) => d.status), b.dimensions.map((d) => d.status), `${g.name}: deterministic`);
    if (g.expect.scoreBand) assert(a.summary.score >= g.expect.scoreBand[0] && a.summary.score <= g.expect.scoreBand[1], `${g.name}: score ${a.summary.score} within band ${g.expect.scoreBand}`);
    for (const [k, st] of Object.entries(g.expect.dims || {})) assertEq(a.dimensions.find((d) => d.key === k).status, st, `${g.name}: ${k}`);
    if (g.expect.missing !== undefined) assertEq(a.coverage.missing, g.expect.missing, `${g.name}: missing`);
  }
  assert(GOLD.some((g) => g.expect.decision === "PASS") && GOLD.some((g) => g.expect.decision === "FAIL") && GOLD.some((g) => g.expect.decision === "REVIEW_REQUIRED"), "all three decisions covered");
  const good = q.assessQuality(GOLD[0].ev).summary.score, bad = q.assessQuality(GOLD[1].ev).summary.score;
  assert(good > bad, "good scores above bad (preference ordering consistent)");
  assert(!/90|100/.test(JSON.stringify(q.rubric().scale)), "no invented 90/100 cutoff in the scale");
});

runTest("Q08: confidence and evidence coverage are displayed", () => {
  const a = q.assessQuality(GOLD.find((g) => g.name === "missing-evidence").ev);
  assertEq(Object.keys(a.coverage).sort(), ["applicable", "assessed", "missing", "missingDimensions", "notApplicable"], "coverage fields");
  assert(a.dimensions.every((d) => ["LOW", "MEDIUM", "HIGH"].includes(d.confidence)), "per-dimension confidence");
  const model = q.assessQuality(bag("q-mod", allDet(3, { imagery: [S("imagery", "MODEL", "PASS", 3)] }))).dimensions.find((d) => d.key === "imagery");
  assertEq(model.confidence, "MEDIUM", "model-only evidence is capped at MEDIUM confidence");
  assert(/aesthetic decision aid only/.test(a.summary.scoreMeaning), "score meaning states it is a decision aid");
  assert(/never reads the score/.test(a.gateVsPreference), "gate and preference stored separately");
});

runTest("Q09: no actual retention / watch-time / monetization certification can be invented", () => {
  const a = q.assessQuality(GOLD[0].ev);
  let c1 = null, c2 = null;
  try { q.assessQuality(bag("q-fake", allDet(3), { limitations: ["predicted audience retention 62%"] })); } catch (e) { c1 = e.code; }
  assertEq(c1, "ACTUAL_RETENTION_FABRICATED", "retention number refused");
  try { q.assessQuality(bag("q-fake2", allDet(3), { limitations: ["guaranteed monetization approval"] })); } catch (e) { c2 = e.code; }
  assertEq(c2, "FABRICATED_VIEWER_OR_CERTIFICATION_CLAIM", "certification claim refused");
  assert(D.dif.guard.assertSafeDoc(a), "a clean report passes the retention/viewer/secret/paid guards");
});

runTest("Q10: actionable findings are routed to the original owning subsystem", () => {
  const a = q.assessQuality(GOLD.find((g) => g.name === "clear-bad").ev);
  const routes = q.routeFindings(a, []);
  assert(routes.some((r) => r.source === "dimension:captions" && r.owner === "CAPTIONS") && routes.some((r) => r.source === "dimension:sound" && r.owner === "AUDIO_MIX"), "captions -> CAPTIONS, sound -> AUDIO_MIX");
  const cf = D.fx.analyze(D.fx.GOLDEN.find((g) => g.name === "redundant-beats").build()).findings;
  const routed = q.routeFindings(a, cf);
  assert(routed.some((r) => r.source.startsWith("finding:NARRATIVE_REDUNDANCY") && r.owner === "STORY_SCRIPT"), "Phase 6A finding routed via the existing repair owner map");
});

done();
