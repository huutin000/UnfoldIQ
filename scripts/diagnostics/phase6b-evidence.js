#!/usr/bin/env node
"use strict";

/**
 * Phase 6B evidence generator (read-only analysis + evidence writer).
 *
 * Evaluates the owner-approved canonical pilot (pilot-sky-blue-canonical) and the SYNTHETIC golden
 * corpora, then writes Report/evidence/phase-6b/*.json. It never calls a provider/model, never renders,
 * never touches the locked final.mp4 / approval, and never publishes. Writes only under --out.
 *
 *   node scripts/diagnostics/phase6b-evidence.js [--out <dir>]
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..", "..");
const cr = require(path.join(ROOT, "lib", "creative-retention", "index.js"));
const dif = require(path.join(ROOT, "lib", "creative-differentiation", "index.js"));
const D = require(path.join(ROOT, "tests", "fixtures", "differentiation-fixture.js"));

const args = process.argv.slice(2);
const OUT = path.resolve(ROOT, args.includes("--out") ? args[args.indexOf("--out") + 1] : path.join("Report", "evidence", "phase-6b"));
const PROJECT = "pilot-sky-blue-canonical";
const PDIR = path.join(ROOT, "projects", PROJECT);
const VIDEO = path.join(ROOT, "out", PROJECT, "final.mp4");
const EV6A = "Report/evidence/phase-6a/canonical-pilot";
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const ms = (t0) => Number((Number(process.hrtime.bigint() - t0) / 1e6).toFixed(2));

function write(rel, doc) {
  dif.guard.assertSafeDoc(doc);
  const abs = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(doc, null, 2) + "\n");
  return rel;
}

const cost = { steps: [], modelCalls: 0, paidCalls: 0, variantsRendered: 0, previewsRendered: 0, renderedFrames: 0, externalPaidCostVnd: 0 };
const timed = (name, fn) => { const t = process.hrtime.bigint(); const out = fn(); cost.steps.push({ step: name, wallMs: ms(t) }); return out; };

(function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const written = [];
  const lockedSha = readJson(path.join(PDIR, "render", "final-artifact.json")).sha256;
  const videoHashNow = fs.existsSync(VIDEO) ? crypto.createHash("sha256").update(fs.readFileSync(VIDEO)).digest("hex") : null;
  const approval = readJson(path.join(PDIR, "approval", "owner-approval.json"));
  const exp = readJson(path.join(PDIR, "packaging", "experiment-set.json"));
  const variant = exp.variants.find((v) => v.variantId === approval.selectedVariantId);
  const brief = readJson(path.join(PDIR, "research", "research-brief.json"));
  const gate = {
    lockedFinalSha256: lockedSha, finalMp4BytesNow: videoHashNow, unchanged: videoHashNow === lockedSha,
    ownerApprovalSha256: approval.outputSha256, approvalMatchesFinal: approval.outputSha256 === lockedSha, selectedVariantId: approval.selectedVariantId,
  };
  if (!gate.unchanged || !gate.approvalMatchesFinal) throw new Error("LOCKED_CANONICAL_ARTIFACT_MISMATCH " + JSON.stringify(gate));

  // ------------------------------------------------------------ canonical CreativeInput (Phase 6A adapter + grounded patches)
  const scenes = readJson(path.join(PDIR, "scene-script.json")).scenes;
  const shotPatches = Object.fromEntries(scenes.map((s) => [s.sceneId, { modality: "DIAGRAM", framing: "DIAGRAM_FULL", isStatic: false, motionIntensity: 0.25, visualMeaning: `per-scene Remotion SVG diagram ${s.sceneId} (scene-media-coverage-matrix.md)` }]));
  const packaging = { titleText: variant.title.text, thumbnailText: "", titleClaimRefs: variant.title.claimRefs, expectedViewerPromise: ["why the sky is blue", "why sunsets turn red"], openingMustEstablish: ["sky blue", "sunlight white"], mustNotImply: [] };
  const inp = cr.adapter.fromLegacyProject(ROOT, PROJECT, { videoPath: VIDEO, packaging, shotPatches });
  if (!inp.ok) throw new Error("adapter failed: " + JSON.stringify(inp.errors));
  const analysis = timed("phase6a-analysis", () => cr.analyzeCreativeRetention(inp.input));
  const watch = timed("phase6a-structural-watch", () => cr.runWatch(analysis, { mode: "FULL_WATCH", probeVideo: cr.adapter.probeVideoDurationMs }));

  // ------------------------------------------------------------ 6.4 Style Bake-off (real pilot: default NO_BAKE_OFF)
  const pilotDecisions = [
    { decision: "hook visual sequence (S01 sun/white-ray diagram)", kind: "HOOK_VISUAL_SEQUENCE", impact: "HIGH", currentVerdict: "PASS", knownIssue: false, alternatives: [{ creativeDecision: "sun with white rays and question label" }, { creativeDecision: "animated sky-colour gradient wipe" }] },
    { decision: "S04 violet-vs-blue bar diagram density", kind: "DENSE_DIAGRAM", impact: "MEDIUM", currentVerdict: "PASS", knownIssue: false, alternatives: [{ creativeDecision: "three qualitative bars" }, { creativeDecision: "two bars with sequential reveal" }] },
    { decision: "caption font micro-adjustment", kind: "FONT_MICRO_ADJUSTMENT", impact: "LOW", alternatives: [{ creativeDecision: "bigger font" }, { creativeDecision: "bolder font" }] },
  ].map((d) => ({ ...d, result: dif.bakeoff.shouldBakeOff(d) }));
  const pilotBakeoff = { projectId: PROJECT, evaluatedDecisions: pilotDecisions.map((d) => ({ decision: d.decision, kind: d.kind, impact: d.impact, outcome: d.result.outcome, variants: d.result.variants, reason: d.result.reason })), activeBakeoffs: 0, variantsCreated: 0, previewsRendered: 0, paidMediaCalls: 0, note: "The owner-approved pilot has only P3 polish findings and no known high-impact issue, so the default NO_BAKE_OFF applies (zero variants, zero renders). The locked final.mp4 is untouched." };

  // synthetic demonstration (metadata/stills only; labelled SYNTHETIC; no render)
  const demo = timed("bakeoff-demo", () => {
    const sel = dif.bakeoff.shouldBakeOff({ kind: "PAYOFF_DELIVERY", impact: "HIGH", knownIssue: true, alternatives: [{ creativeDecision: "still image with slow reveal of the sunset path" }, { creativeDecision: "animated sequence tracing the light path through the atmosphere" }] });
    let bo = dif.bakeoff.createBakeoff({
      projectId: "synthetic-bakeoff-demo", decisionScope: { beatId: "S05" }, reasonToRun: "Sunset payoff can be delivered as still+reveal or animated path (synthetic demonstration)",
      sharedInputs: { narrativeClaim: "C4", evidence: "research-brief@C4", audioTiming: "timing-S05", outputProfile: "1920x1080@30" },
      candidates: [{ creativeDecision: "still image with slow reveal of the sunset path" }, { creativeDecision: "animated sequence tracing the light path through the atmosphere", renderWallMs: 0 }],
      lockedArtifact: { path: VIDEO, sha256: lockedSha },
    });
    const [a, b] = bo.candidates;
    const r = (o) => ({ factualFidelity: 4, clarity: 3, storyPurpose: 3, visualReadability: 3, pacing: 3, styleConsistency: 3, originalityContribution: 3, costLatency: 3, accessibility: 3, ...o });
    bo = dif.bakeoff.evaluateBakeoff(bo, [
      { candidateId: a.candidateId, ratings: r({ costLatency: 4 }), rationale: "Cheaper to produce; reveal timing matches narration", evidenceRefs: ["storyboard:S05"] },
      { candidateId: b.candidateId, ratings: r({ clarity: 4, storyPurpose: 4, costLatency: 2 }), rationale: "Animated path shows why blue is removed over distance", evidenceRefs: ["storyboard:S05"] },
    ]);
    return { selection: sel, bakeoff: bo, previewStats: { hits: 0, renders: 0 } };
  });
  written.push(write("style-bakeoff-decisions.json", { phase: "6B", slice: "A", policy: dif.policy.BAKEOFF_POLICY, pilot: pilotBakeoff, syntheticDemonstration: { label: "SYNTHETIC (metadata only; no render, no provider call)", ...demo } }));
  written.push(write("style-preview-comparison.json", { phase: "6B", slice: "A", comparisonBasis: demo.bakeoff.comparisonBasis, criteria: demo.bakeoff.criteria, sharedInputHashes: demo.bakeoff.sharedInputHashes, evaluation: demo.bakeoff.evaluation, decision: demo.bakeoff.decision, selectedCandidateId: demo.bakeoff.selectedCandidateId || null, approvalStatus: demo.bakeoff.approvalStatus, previewCache: { cacheHits: 0, segmentPreviewsRendered: 0, fullSecondRenders: 0 }, lockedFinalUnchanged: gate.unchanged }));

  // ------------------------------------------------------------ 6.5 Originality
  const extras = {
    episodeId: PROJECT, origin: "REAL_EPISODE", scope: { ownerId: "owner-unfoldiq", channelId: "unfoldiq-main" }, editorialBibleVersion: "visual-bible bcdfe87f4c29c995",
    identity: { palette: "sky-blue system", voiceId: "kokoro am_michael" }, thesis: "why the sky is blue and sunsets are red: scattering rearranges sunlight",
    claimRefs: (brief.claims || []).map((c) => c.claimId), videoSha256: lockedSha,
    assets: scenes.map((s) => ({ assetId: `VISUAL_${s.sceneId}`, source: "ORIGINAL" })), thumbnail: { layout: "ILLUSTRATION_ONLY" },
  };
  const fp = timed("fingerprint-v2", () => dif.originality.buildFingerprintV2(analysis.input, analysis.fingerprint, extras));
  const oneVideo = timed("originality-one-video", () => dif.originality.assessOriginality(fp, [], { corpusScope: "ONE_VIDEO", rhythmFindings: analysis.rhythmReport.findings }));
  const realAttempt = timed("originality-real-corpus-attempt", () => dif.originality.assessOriginality(fp, [], { corpusScope: "REAL_CHANNEL_CORPUS", rhythmFindings: analysis.rhythmReport.findings }));
  written.push(write("originality-fingerprint-v2.json", fp));
  written.push(write("originality-comparison-evidence.json", { phase: "6B", slice: "B", pilot: { projectId: PROJECT, singleVideoAssessment: oneVideo, realChannelCorpusAttempt: { corpusScope: realAttempt.corpusScope, realEpisodeCount: realAttempt.realEpisodeCount, coverage: realAttempt.coverage, risk: realAttempt.risk, channelLevelOriginality: realAttempt.channelLevelOriginality } }, gates: { SINGLE_VIDEO_ORIGINALITY: oneVideo.risk === "LOW" ? "PASS" : oneVideo.risk === "NOT_ASSESSED" ? "REVIEW_REQUIRED" : oneVideo.risk === "HIGH" ? "FAIL" : "REVIEW_REQUIRED", CROSS_VIDEO_REAL_CORPUS: "INSUFFICIENT", CHANNEL_LEVEL_ORIGINALITY: "NOT_PROVEN" }, note: "ONE real episode exists; channel-level originality is NOT proven and is not renamed PROVEN." }));

  const goldenRows = timed("originality-golden", () => D.goldenOriginality().map((g) => {
    const a = dif.originality.assessOriginality(g.subject, g.corpus, { corpusScope: "GOLDEN_FIXTURES" });
    const present = (g.expect.present || []).map((c) => ({ code: c, found: a.findings.includes(c) }));
    const absent = (g.expect.absent || []).map((c) => ({ code: c, clean: !a.findings.includes(c) }));
    return { fixture: g.name, expectedRisk: g.expect.risk, actualRisk: a.risk, pass: a.risk === g.expect.risk && present.every((p) => p.found) && absent.every((x) => x.clean), present, absent, findings: a.findings, metrics: a.comparisons[0] && a.comparisons[0].metrics };
  }));
  written.push(write("originality-golden-corpus-report.json", { phase: "6B", slice: "B", corpus: "SYNTHETIC golden fixtures (origin GOLDEN_FIXTURE; never counted as real episodes)", fingerprintVersion: dif.policy.FINGERPRINT_VERSION, comparatorVersion: dif.policy.COMPARATOR_VERSION, total: goldenRows.length, passed: goldenRows.filter((r) => r.pass).length, falsePositiveGuard: goldenRows.filter((r) => r.expectedRisk === "LOW").every((r) => r.actualRisk === "LOW") ? "PROVEN" : "NOT_PROVEN", templatedDetected: goldenRows.filter((r) => r.expectedRisk === "HIGH").every((r) => r.actualRisk === "HIGH"), rows: goldenRows }));

  // ------------------------------------------------------------ 6.6 Quality scoring
  const gem = readJson(path.join(ROOT, EV6A, "gemini-watch.json"));
  const gemScenes = readJson(path.join(ROOT, EV6A, "gemini-watch-per-scene.json"));
  const qc = readJson(path.join(ROOT, EV6A, "phase4b-final-qc.json"));
  const base = dif.evidence.collectProjectEvidence(ROOT, PROJECT, {
    analysis, watch, originality: oneVideo, geminiWhole: gem, geminiPerScene: gemScenes, qc,
    refs: { qc: `${EV6A}/phase4b-final-qc.json`, gemini: `${EV6A}/gemini-watch.json`, perScene: `${EV6A}/gemini-watch-per-scene.json`, originality: "Report/evidence/phase-6b/originality-comparison-evidence.json", beat: "Report/evidence/phase-6b/(recomputed) NarrativeBeatQualityReport", hook: "(recomputed) HookQualityReport", rhythm: "(recomputed) VisualRhythmReport", watch: "(recomputed) MultimodalWatchReport (structural)" },
  });
  const limitations = [
    "CANONICAL_PILOT_LINEAGE = PARTIAL (Gemini watch artifacts lack exact video sha256)",
    "FINAL_MULTIMODAL_WATCH = PASS_WITH_LIMITATIONS (model judgment, not a human-signed full watch)",
    "AUDIO_VISUAL_QA = REVIEW_REQUIRED (accepted by owner; model-only quality judgment)",
    "PACKAGING_QA = ACCEPTED_NON_BLOCKING (persisted schema remains REVIEW_REQUIRED; not forged to PASS)",
    "57s representative pilot does NOT prove the Phase 4 2-3 min goal or Phase 7 8-12+ min long-form readiness",
    "Quality scores are decision aids: no retention, watch-time, copyright or monetization certification",
  ];
  const qualityNoAcc = dif.quality.assessQuality({ ...base, limitations });

  // owner acceptance carried from the 6A handoff: ONLY items the owner explicitly accepted, ONLY dimensions that are REVIEW_REQUIRED
  let ledger = dif.controls.emptyLedger(PROJECT);
  const carried = [
    { dimension: "packaging", findingRef: "packaging-qa:MISSING_AUDIENCE_DECISION", severity: "P2", category: "PACKAGING_REVIEW_RECORD", reason: "Owner-accepted non-blocking in the Phase 6A handoff (PACKAGING_QA = ACCEPTED_NON_BLOCKING); audience decision exists in owner-approval.json; persisted packaging-qa.json stays REVIEW_REQUIRED and is not forged to PASS", evidenceRefs: [`projects/${PROJECT}/approval/owner-decisions-6a-reconciliation.json#decision-5`, `projects/${PROJECT}/approval/owner-approval.json`, `projects/${PROJECT}/packaging/packaging-qa.json`] },
  ];
  const pending = qualityNoAcc.dimensions.filter((d) => d.status === "REVIEW_REQUIRED").map((d) => d.key);
  for (const c of carried) if (pending.includes(c.dimension)) ledger = dif.controls.recordOverride(ledger, { ...c, ownerId: "owner (carried from UNFOLDIQ_PHASE_6B handoff section 1)", videoSha256: lockedSha });
  const acceptances = dif.controls.activeAcceptances(ledger, { videoSha256: lockedSha });
  const quality = timed("quality-assessment", () => dif.quality.assessQuality({ ...base, limitations, acceptances }));
  const stale = dif.quality.isQualityStale(quality, { ...base, limitations, acceptances });
  written.push(write("quality-rubric-v1.json", dif.quality.rubric()));
  written.push(write("quality-assessment.json", { phase: "6B", slice: "C", assessment: quality, unresolvedWithoutOwnerAcceptance: qualityNoAcc.dimensions.filter((d) => d.status !== "PASS" && d.applicability === "APPLICABLE").map((d) => ({ key: d.key, status: d.status, rationale: d.rationale })), cacheFresh: !stale.stale, routedRepairs: dif.quality.routeFindings(quality, analysis.findings) }));
  const goldQ = D.goldenQuality().map((g) => {
    const a = dif.quality.assessQuality(g.ev);
    const dimsOk = Object.entries(g.expect.dims || {}).every(([k, st]) => a.dimensions.find((d) => d.key === k).status === st);
    const bandOk = !g.expect.scoreBand || (a.summary.score >= g.expect.scoreBand[0] && a.summary.score <= g.expect.scoreBand[1]);
    return { fixture: g.name, expectedDecision: g.expect.decision, actualDecision: a.finalDecision, score: a.summary.score === undefined ? null : a.summary.score, expectedBand: g.expect.scoreBand || null, coverage: a.coverage, pass: a.finalDecision === g.expect.decision && dimsOk && bandOk, blocking: a.blockingFindings };
  });
  written.push(write("quality-scoring-golden-report.json", { phase: "6B", slice: "C", rubricVersion: dif.policy.RUBRIC_VERSION, total: goldQ.length, passed: goldQ.filter((r) => r.pass).length, hardBlockerFixturesAllFail: goldQ.filter((r) => /^high-score-but/.test(r.fixture)).every((r) => r.actualDecision === "FAIL"), rows: goldQ }));
  written.push(write("creator-control-override-ledger.json", { ...ledger, creatorControls: dif.CREATOR_CONTROL_STATUS, ledgerIntegrity: dif.controls.verifyLedger(ledger), activeForLockedFinal: acceptances.length, note: "Only owner-accepted P2/P3 subjective items can appear here; P0/P1 factual/rights/security/technical blockers are refused by construction." }));

  // ------------------------------------------------------------ summary for the gate/report
  const dimSummary = quality.dimensions.map((d) => ({ key: d.key, applicability: d.applicability, status: d.status, ordinal: d.ordinalScore === undefined ? null : d.ordinalScore, assessor: d.assessor, confidence: d.confidence, acceptedByOwner: !!d.acceptedByOwner }));
  const summary = {
    phase: "6B", generatedAt: new Date().toISOString(), policyVersion: dif.policy.POLICY_VERSION, host: { node: process.version, platform: process.platform },
    lockedCanonical: gate,
    pilot: { project: PROJECT, durationMs: analysis.input.durationMs, openCreativeFindings: analysis.findings.filter((f) => f.status === "OPEN").map((f) => `${f.code}/${f.severity}`), watchVerdict: watch.watchReport.verdict, originalityRisk: oneVideo.risk, qualityDecision: quality.finalDecision, qualityCoverage: quality.coverage, qualityScore: quality.summary, dimensions: dimSummary, blockingFindings: quality.blockingFindings },
    golden: { originality: `${goldenRows.filter((r) => r.pass).length}/${goldenRows.length}`, quality: `${goldQ.filter((r) => r.pass).length}/${goldQ.length}` },
    gates: { SINGLE_VIDEO_ORIGINALITY: oneVideo.risk === "LOW" ? "PASS" : "REVIEW_REQUIRED", CROSS_VIDEO_REAL_CORPUS: "INSUFFICIENT", CHANNEL_LEVEL_ORIGINALITY: "NOT_PROVEN", CANONICAL_PILOT_QA_FOR_EVIDENCED_SCOPE: quality.finalDecision },
  };
  cost.totalWallMs = Number(cost.steps.reduce((a, s) => a + s.wallMs, 0).toFixed(2));
  written.push(write("phase6b-runtime-cost-report.json", {
    phase: "6B", generatedAt: summary.generatedAt, steps: cost.steps, totalWallMs: cost.totalWallMs, modelCalls: 0, geminiCalls: 0, tokens: 0, paidProviderCalls: 0, externalPaidCostVnd: 0, publishOrUpload: false,
    variantsRendered: 0, segmentPreviewsRendered: 0, renderedFrames: 0, fullVideoRenders: 0, cacheHits: 0, cacheMisses: 0,
    qaRules: { executed: "13 rubric dimensions + 3 originality levels + Phase 6A analysis recomputed (deterministic)", reusedEvidence: ["phase4b-final-qc.json", "gemini-watch.json", "gemini-watch-per-scene.json", "naturalness/fidelity QA artifacts", "packaging-qa.json"], geminiReuploaded: false },
    newBytesOnDisk: "see evidence files (JSON only); no media written", manualDecisions: ["carried owner acceptance PACKAGING_QA=ACCEPTED_NON_BLOCKING (handoff §1)"],
    phase5Regression: { touchedPhase5Modules: false, note: "6B adds lib/creative-differentiation + tests + one diagnostics script; lib/render, lib/incremental, pipeline, scheduler are untouched" },
    fullRegressionWallMs: null,
  }));
  written.push(write("phase6b-summary.json", summary));
  console.log(JSON.stringify({ out: path.relative(ROOT, OUT), written, pilot: summary.pilot, golden: summary.golden, gates: summary.gates }, null, 2));
})();
