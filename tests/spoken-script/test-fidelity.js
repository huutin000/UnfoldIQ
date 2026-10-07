"use strict";

/**
 * FIX PRE-2.4 tests — Evidence Fidelity Gate (T4–T6, T11–T18 + F-gates).
 */

const path = require("path");
const REPO = path.join(__dirname, "..", "..");
const ss = require(path.join(REPO, "lib", "spoken-script", "index.js"));
const H = require(path.join(REPO, "tests", "fixtures", "fss", "helpers.js"));

let passed = 0;
let failed = 0;
function assert(cond, msg) { if (!cond) throw new Error("ASSERTION FAILED: " + msg); console.log("  ok  " + msg); }
function assertEq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`ASSERTION FAILED: ${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); console.log("  ok  " + msg); }
async function runTest(name, fn) {
  console.log("[TEST] " + name);
  try { await fn(); passed += 1; console.log("[PASS] " + name); }
  catch (e) { failed += 1; console.log("[FAIL] " + name + " — " + e.message); }
}

function hum(root, projectId, segments, extra = {}) {
  return ss.createHumanization(root, projectId, {
    contentMode: extra.contentMode || "everyday-physics-explainer",
    contentClass: extra.contentClass || "FACTUAL",
    sourceScriptRef: { artifact: "script.json", version: "1.0.0" },
    sourceSegments: H.SOURCE_SEGMENTS,
    segments,
    provenance: { actorType: "AGENT", provider: "zcode", model: "GLM-5.3-Flash" },
  });
}

const RESEARCH_CLAIMS = [{ claimId: "C1", classification: "SUPPORTED_FACT", sources: [{ publisher: "NOAA", url: "https://example/noaa" }] }];
const CLAIMS_BY_SEGMENT = { S1: ["C1"], S2: ["C1"], S3: ["C1"] };

async function main() {
  await runTest("T4 factual evidence dependency enforced (faithful candidate + traceable claims → PASS)", () => {
    const { root, projectId } = H.makeRoot();
    const h = hum(root, projectId, H.GOOD_CANDIDATE);
    const f = ss.runEvidenceFidelity(root, projectId, { humanization: h.humanization, contentClass: "FACTUAL", researchClaims: RESEARCH_CLAIMS, segmentClaims: CLAIMS_BY_SEGMENT });
    assert(f.ok && f.decision.decision === "PASS", "PASS with all protected items preserved");
    const evChecks = f.decision.checks.filter((c) => c.checkId.includes(":EVIDENCE:"));
    assert(evChecks.every((c) => c.status === "PRESERVED" && c.evidenceRef), "evidence refs recorded per claim");
  });

  await runTest("T11 protected number mismatch caught", () => {
    const { root, projectId } = H.makeRoot();
    const bad = H.GOOD_CANDIDATE.map((c, i) => i === 0 ? { ...c, candidateSpokenText: "In 1926, the survey reported, roughly 310,000 people watched Rayleigh show the effect." } : c);
    const f = ss.runEvidenceFidelity(root, projectId, { humanization: hum(root, projectId, bad).humanization, contentClass: "FACTUAL", researchClaims: RESEARCH_CLAIMS, segmentClaims: CLAIMS_BY_SEGMENT });
    assert(f.decision.decision === "FAIL", "FAIL");
    assert(f.decision.issues.some((i) => i.code === "FIDELITY_NUMBER_CHANGED"), "FIDELITY_NUMBER_CHANGED");
  });

  await runTest("T12 date mismatch caught", () => {
    const { root, projectId } = H.makeRoot();
    const bad = H.GOOD_CANDIDATE.map((c, i) => i === 0 ? { ...c, candidateSpokenText: "In 1962, the survey reported, roughly 300,000 people watched Rayleigh show the effect." } : c);
    const f = ss.runEvidenceFidelity(root, projectId, { humanization: hum(root, projectId, bad).humanization, contentClass: "FACTUAL", researchClaims: RESEARCH_CLAIMS, segmentClaims: CLAIMS_BY_SEGMENT });
    assert(f.decision.decision === "FAIL" && f.decision.issues.some((i) => i.code === "FIDELITY_DATE_CHANGED"), "FIDELITY_DATE_CHANGED");
  });

  await runTest("T13 name mismatch caught", () => {
    const { root, projectId } = H.makeRoot();
    const bad = H.GOOD_CANDIDATE.map((c, i) => i === 0 ? { ...c, candidateSpokenText: "In 1926, the survey reported, roughly 300,000 people watched Maxwell show the effect." } : c);
    const f = ss.runEvidenceFidelity(root, projectId, { humanization: hum(root, projectId, bad).humanization, contentClass: "FACTUAL", researchClaims: RESEARCH_CLAIMS, segmentClaims: CLAIMS_BY_SEGMENT });
    assert(f.decision.decision === "FAIL" && f.decision.issues.some((i) => i.code === "FIDELITY_NAME_CHANGED"), "FIDELITY_NAME_CHANGED");
  });

  await runTest("T14 quote mismatch caught (exact wording must stay exact)", () => {
    const { root, projectId } = H.makeRoot();
    const bad = H.GOOD_CANDIDATE.map((c, i) => i === 1 ? { ...c, candidateSpokenText: "The mayor said, \"we measured it all twice,\" and the number stayed roughly 42 percent." } : c);
    const f = ss.runEvidenceFidelity(root, projectId, { humanization: hum(root, projectId, bad).humanization, contentClass: "FACTUAL", researchClaims: RESEARCH_CLAIMS, segmentClaims: CLAIMS_BY_SEGMENT });
    assert(f.decision.decision === "FAIL" && f.decision.issues.some((i) => i.code === "FIDELITY_QUOTE_CHANGED"), "FIDELITY_QUOTE_CHANGED");
  });

  await runTest("T15 qualifier drop caught", () => {
    const { root, projectId } = H.makeRoot();
    const bad = H.GOOD_CANDIDATE.map((c, i) => i === 0 ? { ...c, candidateSpokenText: "In 1926, the survey reported, 300,000 people watched Rayleigh show the effect." } : c);
    const f = ss.runEvidenceFidelity(root, projectId, { humanization: hum(root, projectId, bad).humanization, contentClass: "FACTUAL", researchClaims: RESEARCH_CLAIMS, segmentClaims: CLAIMS_BY_SEGMENT });
    assert(f.decision.decision === "FAIL" && f.decision.issues.some((i) => i.code === "FIDELITY_CAVEAT_DROPPED"), "FIDELITY_CAVEAT_DROPPED (approximately→roughly is fine, dropping it is not)");
  });

  await runTest("T16 certainty increase caught", () => {
    const { root, projectId } = H.makeRoot();
    const bad = H.GOOD_CANDIDATE.map((c, i) => i === 2 ? { ...c, candidateSpokenText: "Blue light scatters several times more strongly than red — that definitely explains the haze." } : c);
    const f = ss.runEvidenceFidelity(root, projectId, { humanization: hum(root, projectId, bad).humanization, contentClass: "FACTUAL", researchClaims: RESEARCH_CLAIMS, segmentClaims: CLAIMS_BY_SEGMENT });
    assert(f.decision.decision === "FAIL" && f.decision.issues.some((i) => i.code === "FIDELITY_CERTAINTY_INCREASED"), "FIDELITY_CERTAINTY_INCREASED (may → definitely)");
  });

  await runTest("T17 classification change caught", () => {
    const { root, projectId } = H.makeRoot();
    const f = ss.runEvidenceFidelity(root, projectId, { humanization: hum(root, projectId, H.GOOD_CANDIDATE).humanization, contentClass: "HYBRID", researchClaims: RESEARCH_CLAIMS, segmentClaims: CLAIMS_BY_SEGMENT });
    assert(f.decision.issues.some((i) => i.code === "FIDELITY_CLASSIFICATION_CHANGED"), "classification mismatch surfaced");
  });

  await runTest("T18 unresolved evidence → REVIEW_REQUIRED (never coerced to PASS)", () => {
    const { root, projectId } = H.makeRoot();
    const f = ss.runEvidenceFidelity(root, projectId, { humanization: hum(root, projectId, H.GOOD_CANDIDATE).humanization, contentClass: "FACTUAL", researchClaims: RESEARCH_CLAIMS, segmentClaims: { S1: ["C1"], S2: ["C1"], S3: ["C9"] } });
    assert(f.decision.decision === "REVIEW_REQUIRED", "REVIEW_REQUIRED");
    assert(f.decision.issues.some((i) => i.code === "FIDELITY_EVIDENCE_UNRESOLVED"), "structured code");
    // Fidelity is blocking: canonicalization must refuse.
    const n = ss.runNaturalnessQa(root, projectId, { humanization: hum(root, projectId, H.GOOD_CANDIDATE).humanization });
    const m = ss.materializeFinalSpokenScript(root, projectId, { humanization: hum(root, projectId, H.GOOD_CANDIDATE).humanization, fidelity: f.decision, naturalness: n.qa, scriptArtifactId: "fss-test-blocked", scriptVersion: 1, productionScriptStatusExplicitlyCanonical: true });
    assert(!m.ok && m.code === "FINAL_SPOKEN_SCRIPT_GATE_INCOMPLETE", "REVIEW_REQUIRED blocks canonicalization");
  });

  await runTest("T5 FICTION not forced into factual research; T6 HYBRID classification preserved", () => {
    const { root, projectId } = H.makeRoot();
    const fiction = ss.createHumanization(root, projectId, {
      contentMode: "m", contentClass: "FICTION",
      sourceScriptRef: { artifact: "story.json", version: "1" },
      sourceSegments: H.SOURCE_SEGMENTS, segments: H.GOOD_CANDIDATE,
    });
    const fFiction = ss.runEvidenceFidelity(root, projectId, { humanization: fiction.humanization, contentClass: "FICTION", researchClaims: [], segmentClaims: {} });
    assert(fFiction.decision.decision === "PASS", "FICTION: no research dependency");
    assert(fFiction.decision.checks.every((c) => c.checkId.includes(":EVIDENCE:") === false || c.status === "NOT_APPLICABLE"), "no evidence checks fabricated for FICTION");
    const hybrid = ss.createHumanization(root, projectId, {
      contentMode: "m", contentClass: "HYBRID",
      sourceScriptRef: { artifact: "script.json", version: "1.0.0" },
      sourceSegments: H.SOURCE_SEGMENTS, segments: H.GOOD_CANDIDATE,
    });
    const fHybrid = ss.runEvidenceFidelity(root, projectId, { humanization: hybrid.humanization, contentClass: "HYBRID", researchClaims: RESEARCH_CLAIMS, segmentClaims: CLAIMS_BY_SEGMENT });
    assert(fHybrid.decision.decision === "PASS", "HYBRID with traceable claims passes");
    assert(fHybrid.decision.contentClass === "HYBRID", "HYBRID label travels unchanged");
    // A FACTUAL humanization graded as HYBRID is a classification change (fail-closed).
    const mismatch = ss.runEvidenceFidelity(root, projectId, { humanization: hum(root, projectId, H.GOOD_CANDIDATE).humanization, contentClass: "HYBRID", researchClaims: RESEARCH_CLAIMS, segmentClaims: CLAIMS_BY_SEGMENT });
    assert(mismatch.decision.issues.some((i) => i.code === "FIDELITY_CLASSIFICATION_CHANGED"), "class mismatch surfaced");
  });

  console.log(`\n=== DONE: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
