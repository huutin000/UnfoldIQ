"use strict";

/**
 * FIX PRE-2.4 — bounded backfill E2E (idempotent CLI).
 *
 * Runs the real chain on a REAL existing source script (projects/pilot-sky-blue/script.json):
 *   source script (read-only) → Spoken Humanizer candidate (AGENT) → Evidence
 *   Fidelity (claims traced to research/research-brief.json) → Naturalness QA
 *   → canonical FINAL_SPOKEN_SCRIPT → Phase 2.2 refresh → Phase 2.3 refresh
 *   (REAL Kokoro quiet phonemization) → TTS-ready plan with
 *   productionTtsBlocked = false.
 *
 * Run: node scripts/cli/fss-backfill.js
 * Never touches the source script bytes; never generates audio.
 */

const fs = require("fs");
const path = require("path");

const REPO = path.join(__dirname, "..", "..");
const PROJECT_ID = "pilot-sky-blue";
const SOURCE_REL = "script.json";
const FSS_ARTIFACT_ID = "fss-pilot-sky-blue";
// v1 was the first canonicalization; its fidelity run had a claims-mapping key
// mismatch (beat-id keyed instead of spoken-segment-id keyed) so evidence
// tracing recorded NOT_APPLICABLE. v1 remains immutable history; v2 is the
// corrected canonical revision with full evidence lineage (FIX PRE-2.4 §27).
const FSS_VERSION = 2;
const VB_REF = "vb-19f4fd6a4596";

const ss = require(path.join(REPO, "lib", "spoken-script", "index.js"));
const narr = require(path.join(REPO, "lib", "narration", "index.js"));
const pron = require(path.join(REPO, "lib", "pronunciation", "index.js"));
const ttsReady = require(path.join(REPO, "lib", "tts-ready-plan.js"));
const manifestLib = require(path.join(REPO, "lib", "project-manifest", "index.js"));
const dagLib = require(path.join(REPO, "lib", "dependency-dag", "index.js"));
const costShared = require(path.join(REPO, "lib", "output-cost", "shared.js"));

/**
 * Humanization candidate authored by the executing agent (provenance recorded
 * in the artifact). Bounded change classes only; facts, qualifiers, hedges and
 * comparisons preserved verbatim; B8 intentionally unchanged (no unnecessary
 * rewrite of a clean closing).
 */
const CANDIDATE = [
  { segmentId: "S1", sourceSegmentIds: ["B1"], candidateSpokenText: "Look up on a clear day. The sky is blue. But sunlight itself? White. So where does the blue actually come from?", changeTypes: ["SENTENCE_SPLIT", "CADENCE", "CONVERSATIONAL_WORDING"], changeNotes: "hook tightened into short spoken breath groups; question kept as the hook" },
  { segmentId: "S2", sourceSegmentIds: ["B2"], candidateSpokenText: "The answer is written into the air itself — tiny molecules of nitrogen and oxygen, each one far smaller than a wave of light.", changeTypes: ["RHYTHM", "CONVERSATIONAL_WORDING"], changeNotes: "dash cadence; 'each one' clarifies the antecedent without changing the comparison" },
  { segmentId: "S3", sourceSegmentIds: ["B3"], candidateSpokenText: "When sunlight hits those molecules, they scatter short blue wavelengths in every direction — several times more strongly than they scatter red.", changeTypes: ["RHYTHM"], changeNotes: "comparison phrase 'several times more strongly than' preserved verbatim" },
  { segmentId: "S4", sourceSegmentIds: ["B4"], candidateSpokenText: "That scattered blue light reaches your eyes from everywhere overhead. And that is why the whole sky glows blue.", changeTypes: ["TRANSITION"], changeNotes: "natural spoken transition added" },
  { segmentId: "S5", sourceSegmentIds: ["B5"], candidateSpokenText: "Violet gets scattered even more. But there is less of it in sunlight to begin with, and your eyes are less sensitive to it.", changeTypes: ["SENTENCE_SPLIT", "RHYTHM"], changeNotes: "split into two breath groups; both qualifiers preserved" },
  { segmentId: "S6", sourceSegmentIds: ["B6"], candidateSpokenText: "At sunset, that sunlight crosses much more air. The blue gets scattered away along the way, and the reds and oranges remain.", changeTypes: ["RHYTHM", "TRANSITION"], changeNotes: "'much more air' preserved; added journey phrasing for spoken flow" },
  { segmentId: "S7", sourceSegmentIds: ["B7"], candidateSpokenText: "Dust and pollution, on the other hand, scatter all colors equally. That is why a hazy sky looks pale and white.", changeTypes: ["SENTENCE_SPLIT", "TRANSITION"], changeNotes: "'equally' preserved; contrast transition made explicit" },
  { segmentId: "S8", sourceSegmentIds: ["B8"], candidateSpokenText: "So the blue sky is not a thing. It is sunlight, rearranged by the air. Thanks for watching.", changeTypes: [], changeNotes: "closing already natural; left unchanged" },
];

function step(name, r) {
  if (!r || !r.ok) {
    console.error(`BACKFILL_FAILED at ${name}: ${(r && r.code) || "ERROR"} — ${(r && r.message) || ""}`);
    process.exit(1);
  }
  return r;
}

function main() {
  const t0 = Date.now();
  const perf = {};

  // 1. Real source script, read-only.
  const sourceAbs = path.join(REPO, "projects", PROJECT_ID, SOURCE_REL);
  const sourceBytes = fs.readFileSync(sourceAbs, "utf8");
  const source = JSON.parse(sourceBytes);
  const sourceSegments = source.beats.map((b) => ({ segmentId: b.beatId, text: b.text }));
  // Fidelity traces claims per SPOKEN segment; map each candidate segment to
  // the claims of its source beats through the recorded lineage.
  const segmentClaims = Object.fromEntries(CANDIDATE.map((c) => [
    c.segmentId,
    (c.sourceSegmentIds || []).flatMap((bid) => {
      const beat = source.beats.find((b) => b.beatId === bid);
      return beat ? (beat.claimRefs || []) : [];
    }),
  ]));

  // 2. Content mode/class resolution (explicit, evidence-backed — never a silent default).
  const researchBrief = JSON.parse(fs.readFileSync(path.join(REPO, "projects", PROJECT_ID, "research", "research-brief.json"), "utf8"));
  if (researchBrief.researchStatus !== "COMPLETE" || !(researchBrief.claims || []).length) {
    console.error("BACKFILL_FAILED: research brief must be COMPLETE with claims for a FACTUAL backfill");
    process.exit(1);
  }
  const contentClass = "FACTUAL";
  const contentMode = "everyday-physics-explainer";
  const classRationale = "explicit resolution from project evidence: research-brief COMPLETE with SUPPORTED_FACT classifications; physics explainer; no fiction markers";

  // 3. Spoken Humanization candidate.
  const tHum = Date.now();
  const hum = step("humanization", ss.createHumanization(REPO, PROJECT_ID, {
    contentMode,
    contentClass,
    sourceScriptRef: { artifact: SOURCE_REL, version: String(source.scriptVersion) },
    sourceSegments,
    segments: CANDIDATE,
    changeSummary: "Bounded spoken-cadence rewrite: sentence splits, spoken transitions, rhythm; all facts/qualifiers/comparisons preserved; closing beat unchanged.",
    provenance: { actorType: "AGENT", provider: "zcode", model: "GLM-5.3-Flash", attempt: 1, evidenceRefs: ["scripts/cli/fss-backfill.js", "projects/pilot-sky-blue/editorial-strategy.json"] },
  }));
  perf.humanizationLatencyMs = Date.now() - tHum;

  // 4. Evidence Fidelity (claims traced to the canonical research brief).
  const tFid = Date.now();
  const fidelity = step("evidence-fidelity", ss.runEvidenceFidelity(REPO, PROJECT_ID, {
    humanization: hum.humanization,
    contentClass,
    researchClaims: researchBrief.claims,
    segmentClaims,
    evidenceRefs: ["projects/pilot-sky-blue/research/research-brief.json"],
  }));
  perf.fidelityGateLatencyMs = Date.now() - tFid;
  if (fidelity.decision.decision !== "PASS") {
    console.error(`BACKFILL_FAILED: fidelity decision ${fidelity.decision.decision} — ${JSON.stringify(fidelity.decision.issues)}`);
    process.exit(1);
  }

  // 5. Naturalness QA.
  const tNqa = Date.now();
  const naturalness = step("naturalness-qa", ss.runNaturalnessQa(REPO, PROJECT_ID, { humanization: hum.humanization }));
  perf.naturalnessQaLatencyMs = Date.now() - tNqa;
  if (naturalness.qa.decision !== "PASS") {
    console.error(`BACKFILL_FAILED: naturalness ${naturalness.qa.decision} — ${JSON.stringify(naturalness.qa.issues)}`);
    process.exit(1);
  }

  // 6. Canonical Final Spoken Script (gate-enforced).
  const tMat = Date.now();
  const fss = step("canonical-fss", ss.materializeFinalSpokenScript(REPO, PROJECT_ID, {
    humanization: hum.humanization,
    fidelity: fidelity.decision,
    naturalness: naturalness.qa,
    scriptArtifactId: FSS_ARTIFACT_ID,
    scriptVersion: FSS_VERSION,
    language: "en-us",
    productionScriptStatusExplicitlyCanonical: true,
  }));
  perf.canonicalizationLatencyMs = Date.now() - tMat;

  // 7. Manifest for the source project (fresh 1.5.0 index; honest slots) + FSS ref.
  const loadedManifest = manifestLib.loadProjectManifest(REPO, PROJECT_ID);
  if (!loadedManifest.ok) {
    step("manifest", manifestLib.createProjectManifest({
      root: REPO,
      projectId: PROJECT_ID,
      contentMode,
      contentClass,
      state: { stage: "fix-pre-2.4", status: "ACTIVE" },
    }));
  }
  step("manifest-fss-ref", ss.attachManifestReference(REPO, PROJECT_ID, FSS_ARTIFACT_ID, FSS_VERSION));

  // 8. DAG chain + §29 stale-downstream invalidation.
  const dagResult = step("dag-chain", ss.registerDagChain(REPO, PROJECT_ID, {
    humanizationId: hum.humanization.humanizationId,
    fidelityId: fidelity.decision.decisionId,
    naturalnessId: naturalness.qa.qaId,
    scriptArtifactId: FSS_ARTIFACT_ID,
    scriptVersion: FSS_VERSION,
  }));

  // 8b. §29 stale-state handling for PRE-DAG legacy consumers: the pilot's old
  // scene/audio/caption/timing/render artifacts were derived from the superseded
  // pre-humanized script text. They get explicit DIRTY DAG nodes so they can
  // never silently reach final output through the dependency graph.
  {
    const dag = step("dag-load", dagLib.loadDag(REPO, PROJECT_ID));
    const legacyConsumers = [
      ["SHOT_PLAN", "scene-script.json", "scene-script.json"],
      ["SCENE_TIMING", "timing/", "timing"],
      ["CAPTIONS", "captions/", "captions"],
      ["VOICE", "audio-manifest.json", "audio-manifest.json"],
      ["RENDER", "render/", "render"],
    ];
    for (const [key, label, relFromProject] of legacyConsumers) {
      if (!fs.existsSync(path.join(REPO, "projects", PROJECT_ID, relFromProject))) continue;
      const node = dag.dag.nodes[key];
      if (!node) {
        const added = dagLib.addNode(REPO, PROJECT_ID, {
          artifactKey: key,
          artifactType: key,
          versionRef: null,
          state: "DIRTY",
          producedBy: "fix-pre-2.4:legacy-consumer",
          provenance: "LIVE",
          inputRefs: [{ key: "FINAL_SPOKEN_SCRIPT", type: "SPOKEN_TEXT" }],
          blockedReason: `pre-DAG legacy artifact (${label}) derived from the superseded pre-humanized script text; re-derive before any reuse`,
        });
        step(`legacy-dirty:${key}`, added);
        continue;
      }
      // Existing (bootstrap placeholder) node: wire the real spoken-text
      // dependency and mark it stale — it was derived from superseded text.
      if (!(node.inputRefs || []).some((r) => r.key === "FINAL_SPOKEN_SCRIPT")) {
        step(`legacy-dep:${key}`, dagLib.addDependency(REPO, PROJECT_ID, "FINAL_SPOKEN_SCRIPT", key, "SPOKEN_TEXT"));
      }
      if (node.state === "NOT_CREATED_YET" || node.state === "CLEAN") {
        step(`legacy-dirty:${key}`, dagLib.setNodeState(REPO, PROJECT_ID, key, "DIRTY"));
      }
    }
  }

  // 9. Phase 2.2 refresh against the canonical FSS (new script version → new
  // immutable direction revision; v1's direction stays loadable history).
  const vb = JSON.parse(fs.readFileSync(path.join(REPO, "projects", "phase2-1-validation", "voice", "voice-bible", `${VB_REF}.json`), "utf8"));
  const t22 = Date.now();
  const existingNd = narr.latestNarrationDirection(REPO, PROJECT_ID);
  const ndInput = {
    scriptDoc: fss.script,
    voiceBible: vb,
    directions: [
      { segmentId: "S1", emphasis: [{ text: "blue", occurrence: 1, strength: "MODERATE" }], pauseIntent: [{ kind: "BEAT", afterText: "White.", occurrence: 1 }], energy: "BALANCED", emotion: "CURIOSITY", paceIntent: "MODERATE", directionReason: "hook question setup" },
      { segmentId: "S6", emotion: "INSTRUCTIVE", paceIntent: "SLOWER", energy: "BALANCED", directionReason: "sunset contrast walkthrough" },
    ],
  };
  const nd = existingNd.ok
    ? step("narration-direction", narr.reviseNarrationDirection(REPO, PROJECT_ID, { ...ndInput, baseDirectionId: existingNd.narrationDirection.narrationDirectionId }))
    : step("narration-direction", narr.createNarrationDirection(REPO, PROJECT_ID, ndInput));
  perf.phase22RefreshLatencyMs = Date.now() - t22;
  step("manifest-nd", narr.attachManifestReference(REPO, PROJECT_ID, nd.narrationDirection.narrationDirectionId, { scriptDoc: fss.script, voiceBible: vb }));
  step("dag-nd", narr.registerDagNode(REPO, PROJECT_ID, nd.narrationDirection.narrationDirectionId));

  // 10. Phase 2.3 refresh with the REAL Kokoro quiet runtime.
  const t23 = Date.now();
  let profile = pron.latestPronunciationProfile(REPO, PROJECT_ID);
  if (!profile.ok) {
    profile = step("pronunciation-profile", pron.createPronunciationProfile(REPO, PROJECT_ID, {
      language: "en-us",
      entries: [],
      provenance: { source: "fix-pre-2.4", evidenceRefs: ["projects/pilot-sky-blue/voice/narration-direction"] },
    }));
  }
  const pass = step("pronunciation-pass", pron.runPronunciationPass(REPO, PROJECT_ID, {
    scriptDoc: fss.script,
    voiceBibleRef: VB_REF,
    profileId: profile.profile.pronunciationProfileId,
    provider: "local-kokoro",
    providerModel: "kokoro-v1",
  }, { runtimeEvidenceRef: "evidence/fix-pre-2.4/runtime/quiet-phonemization-evidence.json" }));
  perf.phase23RefreshLatencyMs = Date.now() - t23;
  step("manifest-profile", pron.attachManifestReference(REPO, PROJECT_ID, "profile", profile.profile.pronunciationProfileId));
  step("manifest-pass", pron.attachManifestReference(REPO, PROJECT_ID, "pass", pass.pass.pronunciationPassId));
  step("dag-pron", pron.registerDagNodes(REPO, PROJECT_ID, { profileId: profile.profile.pronunciationProfileId, passId: pass.pass.pronunciationPassId }));

  // 11. TTS-ready plan bound to the CANONICAL FSS.
  const plan = step("tts-ready-plan", ttsReady.buildTtsReadyPlan(REPO, PROJECT_ID, {
    scriptDoc: fss.script,
    narrationDirectionDoc: nd.narrationDirection,
    passDoc: pass.pass,
    voiceBibleRef: VB_REF,
    provider: "local-kokoro",
    providerModel: "kokoro-v1",
  }));
  step("manifest-plan", ttsReady.attachManifestReference(REPO, PROJECT_ID, plan.plan.ttsReadyPlanId));
  step("dag-plan", ttsReady.registerDagNode(REPO, PROJECT_ID, plan.plan.ttsReadyPlanId));
  if (plan.plan.productionTtsBlocked !== false || plan.plan.overall !== "READY_FOR_TTS") {
    console.error(`BACKFILL_FAILED: plan not unblocked — overall=${plan.plan.overall} productionTtsBlocked=${plan.plan.productionTtsBlocked}`);
    process.exit(1);
  }
  ss.emitEvent(REPO, PROJECT_ID, "TTS_PRODUCTION_BLOCK_CLEARED", { correlationId: plan.plan.ttsReadyPlanId, stateTo: "READY_FOR_TTS", attributes: { scriptArtifactId: FSS_ARTIFACT_ID, scriptVersion: FSS_VERSION } });

  // 12. Perf + runtime evidence (bounded).
  const evDir = path.join(REPO, "projects", PROJECT_ID, "evidence", "fix-pre-2.4");
  fs.mkdirSync(path.join(evDir, "runtime"), { recursive: true });
  fs.writeFileSync(path.join(evDir, "performance-baseline.json"), JSON.stringify({
    fix: "FIX_PRE_2_4_FINAL_SPOKEN_SCRIPT_PIPELINE",
    measuredAt: new Date().toISOString(),
    unit: "ms unless noted",
    ...perf,
    sourceWordCount: sourceSegments.map((s) => s.text.split(/\s+/).length).reduce((a, b) => a + b, 0),
    finalWordCount: fss.script.segments.map((s) => s.text.split(/\s+/).length).reduce((a, b) => a + b, 0),
    protectedItemCount: fidelity.decision.checks.length,
    fidelityMismatches: fidelity.decision.issues.length,
    naturalnessIssues: naturalness.qa.issues.length,
    repairAttempts: 1,
    provider: { actorType: "AGENT", provider: "zcode", model: "GLM-5.3-Flash", tokens: "UNKNOWN_NOT_AVAILABLE", cost: "UNKNOWN_NOT_AVAILABLE" },
  }, null, 2) + "\n", "utf8");
  const kokoroPhonemize = require(path.join(REPO, "providers", "runtime", "kokoro-phonemize.js"));
  const batch = kokoroPhonemize.phonemizeBatch(fss.script.segments.map((s, i) => ({ index: i, text: s.text, language: "en-us" })));
  if (!batch.ok) {
    console.error(`BACKFILL_FAILED: evidence phonemization ${batch.code}`);
    process.exit(1);
  }
  fs.writeFileSync(path.join(evDir, "runtime", "quiet-phonemization-evidence.json"), JSON.stringify({
    capturedAt: new Date().toISOString(), runtimeMode: "QUIET_PHONEMIZATION", modelLoaded: false, audioGenerated: false,
    records: batch.results.map((r) => ({ index: r.index, graphemes: r.graphemes, phonemes: r.phonemes })),
  }, null, 2) + "\n", "utf8");

  const sourceUnchanged = fs.readFileSync(sourceAbs, "utf8") === sourceBytes;
  console.log(JSON.stringify({
    BACKFILL: "OK",
    projectId: PROJECT_ID,
    sourceBytesUnchanged: sourceUnchanged,
    humanizationId: hum.humanization.humanizationId,
    fidelity: fidelity.decision.decision,
    naturalness: naturalness.qa.decision,
    fss: `${FSS_ARTIFACT_ID}@v${FSS_VERSION}`,
    productionScriptStatus: fss.script.provenance.productionScriptStatus,
    dagDirtied: (dagResult.dirtied || []).join(",") || "(no downstream nodes)",
    narrationDirection: nd.narrationDirection.narrationDirectionId,
    pronunciationPass: pass.pass.pronunciationPassId,
    planOverall: plan.plan.overall,
    productionTtsBlocked: plan.plan.productionTtsBlocked,
  }, null, 2));
  if (!sourceUnchanged) {
    console.error("BACKFILL_FAILED: source script bytes changed");
    process.exit(1);
  }
  void costShared;
}

main();
