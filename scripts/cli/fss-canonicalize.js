#!/usr/bin/env node
"use strict";

/**
 * Generic FSS canonicalization for a NEW video (config-driven generalization of
 * scripts/cli/fss-backfill.js, which stays pilot-specific). Reuses the existing
 * chain: humanization -> evidence fidelity -> naturalness -> canonical FSS ->
 * manifest + DAG -> narration direction -> pronunciation profile + pass (quiet
 * Kokoro phonemization, no audio) -> TTS-ready plan.
 *
 * New in front of that chain: the Script Quality Gate. Script QA must reach
 * READY_FOR_LOCK first (golden regression and measured duration are computed
 * here, not asserted). The TTS-ready plan is built with requireScriptQa, so
 * production TTS stays blocked until the owner explicitly approves the exact text.
 * The script text is NOT changed by canonicalization (candidate == source), so
 * claim verification does not need to be repeated; if the text ever changes, the
 * QA decision goes stale and the gate blocks again.
 *
 * Usage: node scripts/cli/fss-canonicalize.js --config <config.json>
 * No audio, no render, no provider call beyond the local quiet phonemizer.
 */

const fs = require("fs");
const path = require("path");

const REPO = path.join(__dirname, "..", "..");
const lib = (p) => require(path.join(REPO, "lib", p));
const ss = lib("spoken-script/index.js");
const narr = lib("narration/index.js");
const pron = lib("pronunciation/index.js");
const ttsReady = lib("tts-ready-plan.js");
const manifestLib = lib("project-manifest/index.js");
const dagLib = lib("dependency-dag/index.js");
const { runScriptQa, parseScriptTable } = lib("script-qa/index.js");
const { runGolden } = lib("script-qa/golden.js");
const gate = lib("script-qa/gate.js");

function step(name, r) {
  if (!r || r.ok === false) {
    console.error(`FSS_CANONICALIZE_FAILED at ${name}: ${(r && r.code) || "ERROR"} ${(r && r.message) || ""}`);
    process.exit(1);
  }
  return r;
}
const readJson = (p) => JSON.parse(fs.readFileSync(path.isAbsolute(p) ? p : path.join(REPO, p), "utf8"));

function main() {
  const ci = process.argv.indexOf("--config");
  if (ci < 0 || !process.argv[ci + 1]) {
    console.error("usage: fss-canonicalize.js --config <config.json>");
    process.exit(2);
  }
  const cfg = readJson(process.argv[ci + 1]);
  const P = cfg.projectId;
  const scenes = parseScriptTable(fs.readFileSync(path.join(REPO, cfg.scriptMd), "utf8"));
  const ledger = readJson(cfg.ledger);
  const out = { projectId: P, fssArtifactId: cfg.fssArtifactId, scriptVersion: cfg.fssVersion, steps: {} };

  // 1. Script QA gate (golden + measured duration computed here).
  const golden = runGolden(readJson(cfg.goldenCases).cases, readJson(cfg.goldenLedger));
  const calib = readJson(cfg.ttsCalibration);
  const rows = calib.rows.filter((r) => r.speed === cfg.ttsSpeed);
  const wps = rows.reduce((a, r) => a + r.words, 0) / rows.reduce((a, r) => a + r.durationSec, 0);
  const qa = runScriptQa({
    scenes, ledger, meta: readJson(cfg.meta), editorial: readJson(cfg.editorial), dispositions: readJson(cfg.dispositions),
    options: { wordsPerSecond: wps, durationBasis: "MEASURED", goldenPassed: golden.summary.allPassed, originalityCorpus: cfg.originalityCorpus ? readJson(cfg.originalityCorpus) : undefined },
  });
  out.steps.scriptQa = { verdict: qa.verdict, wordsPerSecond: Number(wps.toFixed(3)), goldenAllPassed: golden.summary.allPassed, open: qa.open };
  const segments = scenes.map((s) => ({ segmentId: s.id, text: s.text }));
  const decision = gate.buildDecision({ qaResult: qa, scriptArtifactId: cfg.fssArtifactId, scriptVersion: cfg.fssVersion, segments, ledgerVersion: ledger.version });
  if (qa.verdict !== "READY_FOR_LOCK") {
    gate.persistDecision(REPO, P, decision);
    console.error(`FSS_CANONICALIZE_STOPPED: Script QA verdict ${qa.verdict}; open findings: ${qa.open.join(", ")}`);
    process.exit(1);
  }

  // 2. Source script (immutable) in the project.
  const projDir = path.join(REPO, "projects", P);
  fs.mkdirSync(projDir, { recursive: true });
  const claimRefsOf = (s) => [...s.evidence.matchAll(/\bC(\d+)\b/g)].map((m) => "C" + m[1]);
  const source = { scriptVersion: cfg.fssVersion, title: cfg.title, beats: scenes.map((s) => ({ beatId: s.id, text: s.text, claimRefs: claimRefsOf(s) })) };
  const srcPath = path.join(projDir, "script.json");
  const srcText = JSON.stringify(source, null, 2) + "\n";
  if (fs.existsSync(srcPath) && fs.readFileSync(srcPath, "utf8") !== srcText) {
    console.error("FSS_CANONICALIZE_FAILED: source script already exists with different content (immutable); bump fssVersion");
    process.exit(1);
  }
  fs.writeFileSync(srcPath, srcText);

  // 3. Humanization candidate == source (no content change), fidelity, naturalness, canonical FSS.
  const hum = step("humanization", ss.createHumanization(REPO, P, {
    contentMode: cfg.contentMode, contentClass: "FACTUAL",
    sourceScriptRef: { artifact: "script.json", version: String(cfg.fssVersion) },
    sourceSegments: scenes.map((s) => ({ segmentId: s.id, text: s.text })),
    segments: scenes.map((s) => ({ segmentId: s.id, sourceSegmentIds: [s.id], candidateSpokenText: s.text, changeTypes: [], changeNotes: "script already written for speech; no change" })),
    changeSummary: "No spoken-text change: Script QA verified the exact text; pronunciation is handled by the pronunciation profile.",
    provenance: { actorType: "AGENT", provider: "claude-code", model: "claude-sonnet-5-5", attempt: 1, evidenceRefs: [cfg.scriptMd, cfg.ledger] },
  }));
  const researchClaims = Object.entries(ledger.claims).map(([id, c]) => ({ claimId: id, classification: "SUPPORTED_FACT", sources: [...new Set((c.evidence || []).map((e) => e.src))] }));
  const segmentClaims = Object.fromEntries(scenes.map((s) => [s.id, claimRefsOf(s)]));
  const fidelity = step("fidelity", ss.runEvidenceFidelity(REPO, P, { humanization: hum.humanization, contentClass: "FACTUAL", researchClaims, segmentClaims, evidenceRefs: [cfg.ledger] }));
  if (fidelity.decision.decision !== "PASS") { console.error(`fidelity ${fidelity.decision.decision}: ${JSON.stringify(fidelity.decision.issues)}`); process.exit(1); }
  const naturalness = step("naturalness", ss.runNaturalnessQa(REPO, P, { humanization: hum.humanization }));
  if (naturalness.qa.decision !== "PASS") { console.error(`naturalness ${naturalness.qa.decision}: ${JSON.stringify(naturalness.qa.issues)}`); process.exit(1); }
  const fss = step("canonical-fss", ss.materializeFinalSpokenScript(REPO, P, {
    humanization: hum.humanization, fidelity: fidelity.decision, naturalness: naturalness.qa,
    scriptArtifactId: cfg.fssArtifactId, scriptVersion: cfg.fssVersion, language: cfg.language, productionScriptStatusExplicitlyCanonical: true,
  }));
  out.steps.fss = { fidelity: fidelity.decision.decision, naturalness: naturalness.qa.decision, textUnchanged: fss.script.segments.every((s, i) => s.text === scenes[i].text) };
  if (!out.steps.fss.textUnchanged) { console.error("FSS_CANONICALIZE_FAILED: FSS text differs from the QA-verified script"); process.exit(1); }

  // 4. Manifest + DAG.
  if (!manifestLib.loadProjectManifest(REPO, P).ok) {
    step("manifest", manifestLib.createProjectManifest({ root: REPO, projectId: P, contentMode: cfg.contentMode, contentClass: "FACTUAL", state: { stage: "phase-7-script", status: "ACTIVE" } }));
  }
  step("manifest-fss", ss.attachManifestReference(REPO, P, cfg.fssArtifactId, cfg.fssVersion));
  step("dag-chain", ss.registerDagChain(REPO, P, { humanizationId: hum.humanization.humanizationId, fidelityId: fidelity.decision.decisionId, naturalnessId: naturalness.qa.qaId, scriptArtifactId: cfg.fssArtifactId, scriptVersion: cfg.fssVersion }));
  const persisted = gate.persistDecision(REPO, P, decision);
  const dagNow = dagLib.loadDag(REPO, P);
  if (!dagNow.dag.nodes.SCRIPT_QA_DECISION) {
    step("dag-qa", dagLib.addNode(REPO, P, { artifactKey: "SCRIPT_QA_DECISION", artifactType: "SCRIPT_QA_DECISION", versionRef: `${cfg.fssArtifactId}@v${cfg.fssVersion}`, state: "CLEAN", producedBy: "script-qa", provenance: "LIVE", inputRefs: [{ key: "FINAL_SPOKEN_SCRIPT", type: "SPOKEN_TEXT" }] }));
  }

  // 5. Narration direction + pronunciation (quiet runtime) + TTS-ready plan.
  const vb = readJson(`projects/phase2-1-validation/voice/voice-bible/${cfg.voiceBibleRef}.json`);
  const nd = step("narration-direction", narr.createNarrationDirection(REPO, P, { scriptDoc: fss.script, voiceBible: vb, directions: [] }));
  step("manifest-nd", narr.attachManifestReference(REPO, P, nd.narrationDirection.narrationDirectionId, { scriptDoc: fss.script, voiceBible: vb }));
  step("dag-nd", narr.registerDagNode(REPO, P, nd.narrationDirection.narrationDirectionId));
  const profile = step("pron-profile", pron.createPronunciationProfile(REPO, P, {
    language: cfg.language,
    entries: (cfg.pronunciation || []).map((e) => ({ ...e, language: cfg.language, scope: { level: "PROJECT", projectId: P }, source: "PROJECT_OVERRIDE", quality: "AUTO" })),
    provenance: { source: "phase-7-script", evidenceRefs: [cfg.scriptMd] },
  }));
  const pass = step("pron-pass", pron.runPronunciationPass(REPO, P, { scriptDoc: fss.script, voiceBibleRef: cfg.voiceBibleRef, profileId: profile.profile.pronunciationProfileId, provider: "local-kokoro", providerModel: "kokoro-v1" }, { runtimeEvidenceRef: `evidence/phase-7/runtime/quiet-phonemization-${cfg.fssArtifactId}.json` }));
  step("manifest-profile", pron.attachManifestReference(REPO, P, "profile", profile.profile.pronunciationProfileId));
  step("manifest-pass", pron.attachManifestReference(REPO, P, "pass", pass.pass.pronunciationPassId));
  step("dag-pron", pron.registerDagNodes(REPO, P, { profileId: profile.profile.pronunciationProfileId, passId: pass.pass.pronunciationPassId }));
  const plan = step("tts-ready-plan", ttsReady.buildTtsReadyPlan(REPO, P, { scriptDoc: fss.script, narrationDirectionDoc: nd.narrationDirection, passDoc: pass.pass, voiceBibleRef: cfg.voiceBibleRef, provider: "local-kokoro", providerModel: "kokoro-v1", requireScriptQa: true, scriptQaDecision: decision }));
  step("manifest-plan", ttsReady.attachManifestReference(REPO, P, plan.plan.ttsReadyPlanId));
  step("dag-plan", ttsReady.registerDagNode(REPO, P, plan.plan.ttsReadyPlanId));
  if (!(dagLib.loadDag(REPO, P).dag.nodes.TTS_READY_PLAN.inputRefs || []).some((r) => r.key === "SCRIPT_QA_DECISION")) {
    step("dag-qa-dep", dagLib.addDependency(REPO, P, "SCRIPT_QA_DECISION", "TTS_READY_PLAN", "SCRIPT_QA"));
  }
  out.steps.pronunciation = { profile: profile.profile.pronunciationProfileId, pass: pass.pass.pronunciationPassId, segmentStatuses: [...new Set(pass.pass.segments.map((s) => s.status))] };
  out.steps.ttsReadyPlan = { id: plan.plan.ttsReadyPlanId, overall: plan.plan.overall, productionTtsBlocked: plan.plan.productionTtsBlocked, scriptQa: plan.plan.provenance.scriptQa };
  out.decisionRef = persisted.rel;
  out.verdict = plan.plan.productionTtsBlocked ? "FSS_CANONICAL_TTS_BLOCKED_UNTIL_OWNER_APPROVAL" : "UNEXPECTED_TTS_OPEN";
  console.log(JSON.stringify(out, null, 2));
  if (cfg.resultOut) fs.writeFileSync(path.join(REPO, cfg.resultOut), JSON.stringify(out, null, 2) + "\n");
}

main();
