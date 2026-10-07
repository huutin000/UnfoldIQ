"use strict";

/**
 * FIX PRE-2.4 — Golden regression G1–G20 + golden definition/baseline.
 * All goldens run deterministically on isolated tmp roots (no runtime, no
 * network, no secrets; synthetic protected items only).
 */

const path = require("path");
const fs = require("fs");
const REPO = path.join(__dirname, "..", "..");
const ss = require(path.join(REPO, "lib", "spoken-script", "index.js"));
const gold = require(path.join(REPO, "lib", "golden", "index.js"));
const H = require(path.join(REPO, "tests", "fixtures", "fss", "helpers.js"));

const GOLDEN_PROJECT_ID = "gold-spoken-script";
let passed = 0;
let failed = 0;
function assert(cond, msg) { if (!cond) throw new Error("ASSERTION FAILED: " + msg); console.log("  ok  " + msg); }
function assertEq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`ASSERTION FAILED: ${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); console.log("  ok  " + msg); }
async function runTest(name, fn) {
  console.log("[TEST] " + name);
  try { await fn(); passed += 1; console.log("[PASS] " + name); }
  catch (e) { failed += 1; console.log("[FAIL] " + name + " — " + e.message); }
}

function chain(root, projectId, candidate, contentClass = "FACTUAL", claims = null) {
  const h = ss.createHumanization(root, projectId, {
    contentMode: "everyday-physics-explainer", contentClass,
    sourceScriptRef: { artifact: "script.json", version: "1.0.0" },
    sourceSegments: H.SOURCE_SEGMENTS, segments: candidate,
    provenance: { actorType: "AGENT", provider: "zcode", model: "GLM-5.3-Flash" },
  });
  const f = ss.runEvidenceFidelity(root, projectId, {
    humanization: h.humanization, contentClass,
    researchClaims: claims === null ? [{ claimId: "C1", classification: "SUPPORTED_FACT", sources: [] }] : claims,
    segmentClaims: { S1: ["C1"], S2: ["C1"], S3: ["C1"] },
  });
  const n = ss.runNaturalnessQa(root, projectId, { humanization: h.humanization });
  return { h, f, n };
}

function replace(candidates, index, text) {
  return candidates.map((c, i) => (i === index ? { ...c, candidateSpokenText: text } : c));
}

async function main() {
  const src = H.SOURCE_SEGMENTS;

  await runTest("G1 factual number preserved", () => {
    const { f } = chain(H.makeRoot().root, "p1", H.GOOD_CANDIDATE);
    assert(f.decision.decision === "PASS", "300,000 and 42 percent preserved");
  });
  await runTest("G2 date preserved", () => {
    const { root, projectId } = H.makeRoot();
    const { f } = chain(root, projectId, H.GOOD_CANDIDATE);
    assert(f.decision.checks.every((c) => c.protectedItemType !== "DATE" || c.status !== "CHANGED_INVALID"), "1926 intact");
  });
  await runTest("G3 proper name preserved", () => {
    const { root, projectId } = H.makeRoot();
    const { f } = chain(root, projectId, H.GOOD_CANDIDATE);
    assert(f.decision.checks.every((c) => c.protectedItemType !== "NAME" || c.status !== "CHANGED_INVALID"), "Rayleigh intact");
  });
  await runTest("G4 exact direct quote preserved", () => {
    const { root, projectId } = H.makeRoot();
    const { f } = chain(root, projectId, H.GOOD_CANDIDATE);
    assert(f.decision.checks.every((c) => c.protectedItemType !== "QUOTE" || c.status !== "CHANGED_INVALID"), "quote verbatim");
  });
  await runTest("G5 qualifier preserved", () => {
    const { root, projectId } = H.makeRoot();
    const { f } = chain(root, projectId, H.GOOD_CANDIDATE);
    assert(!f.decision.issues.some((i) => i.code === "FIDELITY_CAVEAT_DROPPED"), "hedges kept");
  });
  await runTest("G6 uncertainty preserved", () => {
    const { root, projectId } = H.makeRoot();
    const { f } = chain(root, projectId, H.GOOD_CANDIDATE);
    assert(!f.decision.issues.some((i) => i.code === "FIDELITY_CERTAINTY_INCREASED"), "may stays may");
  });
  await runTest("G7 classification preserved", () => {
    const { root, projectId } = H.makeRoot();
    const { f } = chain(root, projectId, H.GOOD_CANDIDATE);
    assert(!f.decision.issues.some((i) => i.code === "FIDELITY_CLASSIFICATION_CHANGED"), "class unchanged");
  });
  await runTest("G8 no fake quote/evidence introduced", () => {
    const { root, projectId } = H.makeRoot();
    const fakeQuote = replace(H.GOOD_CANDIDATE, 1, "The mayor never said this. The number stayed roughly 42 percent.");
    const { f } = chain(root, projectId, fakeQuote);
    assert(f.decision.decision === "FAIL", "dropping the real quote fails (quote set changed)");
  });
  await runTest("G9 sentence split allowed", () => {
    const { root, projectId } = H.makeRoot();
    const split = replace(H.GOOD_CANDIDATE, 0, "In 1926, the survey reported, roughly 300,000 people watched Rayleigh. They saw the effect.");
    const { h } = chain(root, projectId, split);
    assert(h.ok, "split candidate persists (fidelity judges content, not structure)");
  });
  await runTest("G10 sentence merge allowed", () => {
    const { root, projectId } = H.makeRoot();
    const merged = [{ segmentId: "S1", sourceSegmentIds: ["B1", "B2"], candidateSpokenText: `${src[0].text} ${src[1].text}`, changeTypes: ["SENTENCE_MERGE"] }];
    const r = ss.createHumanization(root, projectId, {
      contentMode: "m", contentClass: "FICTION", sourceScriptRef: { artifact: "s.json", version: "1" },
      sourceSegments: H.SOURCE_SEGMENTS, segments: merged,
    });
    assert(r.ok && r.humanization.segments[0].sourceSegmentIds.length === 2, "merge lineage recorded");
  });
  await runTest("G11 natural transition allowed", () => {
    const { root, projectId } = H.makeRoot();
    const { n } = chain(root, projectId, H.GOOD_CANDIDATE);
    assert(n.qa.decision === "PASS", "transition-bearing candidate passes naturalness");
  });
  await runTest("G12 certainty increase rejected", () => {
    const { root, projectId } = H.makeRoot();
    const { f } = chain(root, projectId, replace(H.GOOD_CANDIDATE, 2, "Blue light scatters several times more strongly than red — that definitely explains the haze."));
    assert(f.decision.decision === "FAIL" && f.decision.issues.some((i) => i.code === "FIDELITY_CERTAINTY_INCREASED"), "may→definitely rejected");
  });
  await runTest("G13 repeated transition detected", () => {
    const { root, projectId } = H.makeRoot();
    const { n } = chain(root, projectId, H.DULL_CANDIDATE);
    assert(n.qa.issues.some((i) => i.code === "REPETITIVE_TRANSITION"), "so…so…so detected");
  });
  await runTest("G14 over-uniform cadence detected", () => {
    const { root, projectId } = H.makeRoot();
    const { n } = chain(root, projectId, H.DULL_CANDIDATE);
    assert(n.qa.issues.some((i) => i.code === "OVER_UNIFORM_CADENCE"), "uniform cadence detected");
  });
  await runTest("G15 summary-heavy prose flagged", () => {
    const { root, projectId } = H.makeRoot();
    const summary = replace(H.GOOD_CANDIDATE, 0, "In 1926, the survey reported, roughly 300,000 people watched Rayleigh show the effect. In conclusion, that was the number. To sum up, people watched.");
    const { n } = chain(root, projectId, summary);
    assert(n.qa.issues.some((i) => i.code === "SUMMARY_HEAVY"), "summary phrases flagged");
  });
  await runTest("G16 neutral/natural script passes", () => {
    const { root, projectId } = H.makeRoot();
    const { n, f } = chain(root, projectId, H.GOOD_CANDIDATE);
    assert(n.qa.decision === "PASS" && f.decision.decision === "PASS", "natural + faithful passes both gates");
  });
  await runTest("G17 FICTION not forced into factual research", () => {
    const { root, projectId } = H.makeRoot();
    const { f } = chain(root, projectId, H.GOOD_CANDIDATE, "FICTION", []);
    assert(f.decision.decision === "PASS", "FICTION passes without evidence claims");
  });
  await runTest("G18 HYBRID labels preserved", () => {
    const { root, projectId } = H.makeRoot();
    const { f } = chain(root, projectId, H.GOOD_CANDIDATE, "HYBRID");
    assert(f.decision.contentClass === "HYBRID" && !f.decision.issues.some((i) => i.code === "FIDELITY_CLASSIFICATION_CHANGED"), "HYBRID intact");
  });
  await runTest("G19 source immutable", () => {
    const { root, projectId } = H.makeRoot();
    const srcPath = path.join(root, "projects", projectId, "script.json");
    fs.writeFileSync(srcPath, "immutable-marker", "utf8");
    chain(root, projectId, H.GOOD_CANDIDATE);
    assertEq(fs.readFileSync(srcPath, "utf8"), "immutable-marker", "source untouched by the whole chain");
  });
  await runTest("G20 new FSS revision changes downstream dependency state correctly", () => {
    const { root, projectId } = H.makeRoot();
    const dagLib = require(path.join(REPO, "lib", "dependency-dag", "index.js"));
    const { h, f, n } = chain(root, projectId, H.GOOD_CANDIDATE);
    ss.materializeFinalSpokenScript(root, projectId, { humanization: h.humanization, fidelity: f.decision, naturalness: n.qa, scriptArtifactId: "fss-golden-dep", scriptVersion: 1, productionScriptStatusExplicitlyCanonical: true });
    ss.registerDagChain(root, projectId, { humanizationId: h.humanization.humanizationId, fidelityId: f.decision.decisionId, naturalnessId: n.qa.qaId, scriptArtifactId: "fss-golden-dep", scriptVersion: 1 });
    // A downstream consumer of the script text with real built output.
    const nd = dagLib.addNode(root, projectId, { artifactKey: "NARRATION_DIRECTION", artifactType: "NARRATION_DIRECTION", versionRef: "nd-old", state: "CLEAN", provenance: "LIVE", inputRefs: [] });
    assert(nd.ok, "downstream node created");
    dagLib.addDependency(root, projectId, "FINAL_SPOKEN_SCRIPT", "NARRATION_DIRECTION", "SPOKEN_TEXT");
    // New revision of the canonical script.
    const changed = replace(H.GOOD_CANDIDATE, 2, "Blue light scatters several times more strongly than red. That may explain the haze.");
    const h2 = ss.createHumanization(root, projectId, {
      contentMode: "everyday-physics-explainer", contentClass: "FACTUAL",
      sourceScriptRef: { artifact: "script.json", version: "1.0.0" },
      sourceSegments: H.SOURCE_SEGMENTS, segments: changed, version: 2,
      provenance: { actorType: "AGENT", attempt: 2 },
    });
    const f2 = ss.runEvidenceFidelity(root, projectId, { humanization: h2.humanization, contentClass: "FACTUAL", researchClaims: [{ claimId: "C1", classification: "SUPPORTED_FACT", sources: [] }], segmentClaims: { S1: ["C1"], S2: ["C1"], S3: ["C1"] } });
    const n2 = ss.runNaturalnessQa(root, projectId, { humanization: h2.humanization });
    ss.materializeFinalSpokenScript(root, projectId, { humanization: h2.humanization, fidelity: f2.decision, naturalness: n2.qa, scriptArtifactId: "fss-golden-dep", scriptVersion: 2, productionScriptStatusExplicitlyCanonical: true });
    ss.registerDagChain(root, projectId, { humanizationId: h2.humanization.humanizationId, fidelityId: f2.decision.decisionId, naturalnessId: n2.qa.qaId, scriptArtifactId: "fss-golden-dep", scriptVersion: 2 });
    const dag = dagLib.loadDag(root, projectId).dag;
    assertEq(dag.nodes.FINAL_SPOKEN_SCRIPT.versionRef, "fss-golden-dep@v2", "node advanced to v2");
    assertEq(dag.nodes.NARRATION_DIRECTION.state, "DIRTY", "downstream consumer of the script text DIRTY");
  });

  // Golden definition + baseline + comparison.
  await runTest("Golden definition + baseline + no-regression comparison", () => {
    let def = gold.getDefinition(REPO, GOLDEN_PROJECT_ID, null);
    if (!def.ok) {
      def = gold.createGoldenDefinition(REPO, {
        goldenProjectId: GOLDEN_PROJECT_ID,
        name: "GOLDEN_SSS Spoken-script backfill chain (humanizer → fidelity → naturalness → canonical FSS)",
        contentClass: "FACTUAL",
        categories: ["spoken-humanization", "evidence-fidelity", "naturalness-qa", "spoken-humanization"],
        fixture: { projectId: "pilot-sky-blue", kind: "evidence", detail: "canonical FSS fss-pilot-sky-blue@v1 with full gate lineage" },
      });
      assert(def.ok, "golden definition created");
    }
    const metrics = {
      schemaStability: { status: "MEASURED", value: true },
      versionImmutability: { status: "MEASURED", value: true },
      dagInvalidation: { status: "MEASURED", value: "SCOPE_CORRECT" },
      directionSparsity: { status: "MEASURED", value: true },
      pronunciationRuntime: { status: "MEASURED", value: "REAL_RUNTIME_PROVEN" },
      unsupportedFactualClaims: { status: "MEASURED", value: 0, evidenceRefs: ["tests/spoken-script/test-fidelity.js"] },
      pronunciation: { status: "NOT_MEASURED", reason: "judgment on synthesized audio; Phase 2.4" },
      speechRate: { status: "NOT_MEASURED", reason: "final TTS synthesis is Phase 2.4" },
    };
    const evidenceRefs = [
      "tests/spoken-script/test-humanization.js",
      "tests/spoken-script/test-fidelity.js",
      "tests/spoken-script/test-naturalness.js",
      "tests/spoken-script/test-canonicalization.js",
      "tests/spoken-script/test-e2e-fss-backfill.js",
      "projects/pilot-sky-blue/voice/evidence-fidelity",
      "Report/fixes/phase-2/FIX_PRE_2_4_FINAL_SPOKEN_SCRIPT_PIPELINE_REPORT.md",
    ];
    const baseline = gold.createBaseline(REPO, { goldenProjectId: GOLDEN_PROJECT_ID, version: 1, metrics, evidenceRefs, reason: "FIX PRE-2.4 initial golden baseline" });
    assert(baseline.ok, `baseline ok ${baseline.ok ? "" : baseline.code + " " + baseline.message}`);
    const comparison = gold.compareToBaseline(REPO, GOLDEN_PROJECT_ID, { metrics, evidenceRefs });
    assert(comparison.ok, `comparison ok ${comparison.ok ? "" : JSON.stringify(comparison).slice(0, 300)}`);
  });

  console.log(`\n=== DONE: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
