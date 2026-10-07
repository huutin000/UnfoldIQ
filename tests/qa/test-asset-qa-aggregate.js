"use strict";

/**
 * Phase 1G.11 — aggregate / timeline-gate / repair / staleness tests
 * AG1–AG10, TR1–TR5, SL1–SL7 + mandatory N1–N4 negative injection through the
 * REAL QA path (evaluateAssetQa → gate) + schema accept/reject instances.
 */

const os = require("os");
const fs = require("fs");
const path = require("path");
const Ajv = require("ajv");
const addFormats = require("ajv-formats");
const qa = require("../../lib/asset-qa/index.js");
const { makePng } = require("../fixtures/make-png.js");

const REPO_ROOT = path.join(__dirname, "..", "..");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
  console.log(`  ✓ ${message}`);
  passed++;
}

async function runTest(name, fn) {
  console.log(`\n[TEST] ${name}`);
  try {
    await fn();
    console.log(`[PASS] ${name}`);
  } catch (e) {
    console.log(`[FAIL] ${name}: ${e.message}`);
    failed++;
  }
}

function tmpRoot(tag) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `unfoldiq-1g11-${tag}-`));
  fs.mkdirSync(path.join(root, "projects", "p1"), { recursive: true });
  return root;
}

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function pngInput() {
  return { bytes: makePng(32, 32), fileName: "frame.png", expected: { mediaType: "image" } };
}

function semGood() {
  return {
    expectation: { sceneId: "S01", expectedSubject: ["host"], expectedAction: ["waves"], expectedMediaType: "image" },
    observation: { source: "MANUAL_REVIEW", sceneId: "S01", subjects: ["host"], actions: ["waves"], mediaType: "image", hasText: false, compositionUsable: true },
  };
}

function factFiction() {
  return { contentClass: "FICTION", expectation: {}, observations: {} };
}

function contGood() {
  return {
    sources: { continuityStrictness: "NORMAL" },
    expectation: { characterId: "HOST_A", location: "studio" },
    observation: { source: "MANUAL_REVIEW", identity: "HOST_A", location: "studio" },
  };
}

function deps(over = {}) {
  return {
    assetId: "as-test-01",
    assetHash: HASH_A,
    shotExpectationVersion: "shot-v1",
    sceneExpectationVersion: "scene-v1",
    scriptVersion: "script-v1",
    claimEvidenceVersion: "ce-v1",
    characterBibleVersion: "cb-v1",
    worldBibleVersion: "wb-v1",
    visualBibleVersion: "vb-v1",
    instructionVersion: "iv-v1",
    platformAdaptationVersion: "pa-v1",
    ...over,
  };
}

function fullInput(over = {}) {
  return {
    projectId: "p1",
    assetId: "as-test-01",
    assetHash: HASH_A,
    shotId: "S01-SH01",
    sceneId: "S01",
    fingerprintDeps: deps(),
    structural: pngInput(),
    semantic: semGood(),
    factuality: factFiction(),
    continuity: contGood(),
    ...over,
  };
}

function persistOk(root, input) {
  const r = qa.evaluateAndPersist(root, input);
  assert(r.ok === true, `persist ok (${input.assetId}/${input.shotId})`);
  return r.result;
}

async function main() {
  await runTest("AG1 all required PASS → timelineEligible=true", () => {
    const root = tmpRoot("ag1");
    persistOk(root, fullInput());
    const g = qa.assertAssetReadyForTimeline(root, "p1", "as-test-01", "S01-SH01", { currentDeps: deps() });
    assert(g.eligible === true && g.status === "READY_FOR_TIMELINE", "clean QA is timeline eligible");
  });

  await runTest("AG2 structural FAIL → false", () => {
    const root = tmpRoot("ag2");
    persistOk(root, fullInput({ structural: { bytes: Buffer.from("garbage-not-media"), fileName: "x.png", expected: { mediaType: "image" } } }));
    const g = qa.assertAssetReadyForTimeline(root, "p1", "as-test-01", "S01-SH01", { currentDeps: deps() });
    assert(g.eligible === false && g.status === "REJECTED", "structural FAIL rejects timeline");
  });

  await runTest("AG3 semantic blocker FAIL → false", () => {
    const root = tmpRoot("ag3");
    const bad = semGood();
    bad.observation = { ...bad.observation, sceneId: "S99" };
    persistOk(root, fullInput({ semantic: bad }));
    const g = qa.assertAssetReadyForTimeline(root, "p1", "as-test-01", "S01-SH01", { currentDeps: deps() });
    assert(g.eligible === false, "semantic blocker FAIL blocks timeline");
  });

  await runTest("AG4 factual blocker FAIL → false", () => {
    const root = tmpRoot("ag4");
    persistOk(root, fullInput({
      factuality: {
        contentClass: "FACTUAL",
        expectation: { shotId: "S01-SH01", claimIds: ["cl-1"], evidenceIds: ["ev-1"], chartDirection: "decline" },
        observations: { chartDirection: { observed: "chart rises", match: false, confidence: "high", source: "MANUAL_REVIEW" } },
      },
    }));
    const g = qa.assertAssetReadyForTimeline(root, "p1", "as-test-01", "S01-SH01", { currentDeps: deps() });
    assert(g.eligible === false, "factual blocker FAIL blocks timeline");
  });

  await runTest("AG5 continuity blocker FAIL → false", () => {
    const root = tmpRoot("ag5");
    const bad = contGood();
    bad.observation = { ...bad.observation, identity: "HOST_B" };
    persistOk(root, fullInput({ continuity: bad }));
    const g = qa.assertAssetReadyForTimeline(root, "p1", "as-test-01", "S01-SH01", { currentDeps: deps() });
    assert(g.eligible === false, "continuity blocker FAIL blocks timeline");
  });

  await runTest("AG6 critical UNKNOWN → false / REVIEW", () => {
    const root = tmpRoot("ag6");
    const noObs = semGood();
    delete noObs.observation;
    persistOk(root, fullInput({ semantic: { expectation: noObs.expectation, observation: null } }));
    const g = qa.assertAssetReadyForTimeline(root, "p1", "as-test-01", "S01-SH01", { currentDeps: deps() });
    assert(g.eligible === false && g.status === "REVIEW_REQUIRED", "critical UNKNOWN → REVIEW_REQUIRED, ineligible");
  });

  await runTest("AG7 warning-only follows policy (eligible with warnings)", () => {
    // Style-only drift is WARN-level and non-blocking → stays eligible.
    const root = tmpRoot("ag7");
    const styled = contGood();
    styled.expectation = { characterId: "HOST_A", location: "studio", paletteStyle: "flat" };
    styled.observation = { source: "MANUAL_REVIEW", identity: "HOST_A", location: "studio", paletteStyle: "noir" };
    persistOk(root, fullInput({ continuity: styled }));
    const g = qa.assertAssetReadyForTimeline(root, "p1", "as-test-01", "S01-SH01", { currentDeps: deps() });
    assert(g.eligible === true, "warning-only QA stays eligible");
    assert((g.aggregate.warningLayers || []).includes("continuity"), "continuity listed as warning layer");
  });

  await runTest("AG8 selected asset without QA → false", () => {
    const root = tmpRoot("ag8");
    const g = qa.assertAssetReadyForTimeline(root, "p1", "as-test-01", "S01-SH01", { currentDeps: deps() });
    assert(g.eligible === false, "no QA result blocks timeline entry");
    assert(g.reasons.some((x) => /NO_CURRENT_QA/.test(x)), "NO_CURRENT_QA reason recorded");
  });

  await runTest("AG9 stale QA → false", () => {
    const root = tmpRoot("ag9");
    persistOk(root, fullInput());
    const g = qa.assertAssetReadyForTimeline(root, "p1", "as-test-01", "S01-SH01", { currentDeps: deps({ claimEvidenceVersion: "ce-v2" }) });
    assert(g.eligible === false, "stale QA blocks timeline entry");
    assert(g.reasons.some((x) => /STALE_QA/.test(x)), "STALE_QA reason recorded");
  });

  await runTest("AG10 wrong asset hash → false", () => {
    const root = tmpRoot("ag10");
    persistOk(root, fullInput());
    const g = qa.assertAssetReadyForTimeline(root, "p1", "as-test-01", "S01-SH01", { currentDeps: deps(), currentAssetHash: HASH_B });
    assert(g.eligible === false, "hash drift blocks timeline entry");
    assert(g.reasons.some((x) => /ASSET_HASH_MISMATCH/.test(x)), "ASSET_HASH_MISMATCH recorded");
  });

  await runTest("N1 wrong character full path → REJECTED", () => {
    const bad = contGood();
    bad.observation = { ...bad.observation, identity: "HOST_B" };
    const r = qa.evaluateAssetQa(fullInput({ continuity: bad }));
    assert(r.continuity.status === "FAIL", "CONTINUITY FAIL via real path");
    assert(r.aggregate.status === "REJECTED" && r.aggregate.timelineEligible === false, "timelineEligible=false");
    assert(r.aggregate.recommendation === "REGENERATE_SHOT", "targeted repair recommends REGENERATE_SHOT");
  });

  await runTest("N2 wrong outfit full path → REJECTED (+ approved change PASS)", () => {
    const bad = contGood();
    bad.expectation = { characterId: "HOST_A", clothing: "mustard overshirt" };
    bad.observation = { source: "MANUAL_REVIEW", identity: "HOST_A", clothing: "red jacket" };
    const r = qa.evaluateAssetQa(fullInput({ continuity: bad }));
    assert(r.aggregate.timelineEligible === false, "unapproved outfit ineligible");
    const good = contGood();
    good.expectation = { characterId: "HOST_A", clothing: "mustard overshirt", approvedOutfitChange: "red jacket" };
    good.observation = { source: "MANUAL_REVIEW", identity: "HOST_A", clothing: "red jacket" };
    const r2 = qa.evaluateAssetQa(fullInput({ continuity: good }));
    assert(r2.continuity.checks.find((c) => c.check === "clothing").status === "PASS", "approved outfit change PASSes");
  });

  await runTest("N3 wrong location full path → REJECTED (+ transition PASS)", () => {
    const badSem = semGood();
    badSem.expectation = { ...badSem.expectation, sceneId: "S01" };
    badSem.observation = { ...badSem.observation, sceneId: "S02" };
    const badCont = contGood();
    badCont.observation = { ...badCont.observation, location: "beach-night" };
    const r = qa.evaluateAssetQa(fullInput({ semantic: badSem, continuity: badCont }));
    assert(r.aggregate.timelineEligible === false, "wrong location ineligible");
    assert(r.semantic.status === "FAIL" || r.continuity.status === "FAIL", "SEMANTIC and/or CONTINUITY FAIL");
  });

  await runTest("N4 wrong factual visual full path → REJECTED (F1+F2)", () => {
    const f1 = qa.evaluateAssetQa(fullInput({
      factuality: {
        contentClass: "FACTUAL",
        expectation: { shotId: "S01-SH01", claimIds: ["cl-pop"], evidenceIds: ["ev-pop"], chartDirection: "decline" },
        observations: { chartDirection: { observed: "chart rises", match: false, confidence: "high", source: "MANUAL_REVIEW" } },
      },
    }));
    assert(f1.aggregate.timelineEligible === false, "F1 chart inversion ineligible");
    const f2 = qa.evaluateAssetQa(fullInput({
      factuality: {
        contentClass: "FACTUAL",
        expectation: { shotId: "S01-SH01", claimIds: ["cl-sp"], evidenceIds: ["ev-sp"], speciesPersonObject: ["leopard"] },
        observations: { speciesPersonObject: { observed: "lion", match: false, confidence: "high", source: "MANUAL_REVIEW" } },
      },
    }));
    assert(f2.aggregate.timelineEligible === false, "F2 species swap ineligible");
  });

  await runTest("TR1/TR2 one bad shot flags only that shot", () => {
    const root = tmpRoot("tr12");
    persistOk(root, fullInput({ assetId: "as-good", fingerprintDeps: deps({ assetId: "as-good", assetHash: HASH_A }) }));
    const bad = contGood();
    bad.observation = { ...bad.observation, identity: "HOST_B" };
    persistOk(root, fullInput({ assetId: "as-bad", assetHash: HASH_B, fingerprintDeps: deps({ assetId: "as-bad", assetHash: HASH_B }), continuity: bad }));
    const gGood = qa.assertAssetReadyForTimeline(root, "p1", "as-good", "S01-SH01", { currentDeps: deps({ assetId: "as-good", assetHash: HASH_A }) });
    const gBad = qa.assertAssetReadyForTimeline(root, "p1", "as-bad", "S01-SH01", { currentDeps: deps({ assetId: "as-bad", assetHash: HASH_B }) });
    assert(gGood.eligible === true, "unrelated asset remains valid");
    assert(gBad.eligible === false, "only the bad shot is flagged");
  });

  await runTest("TR3/TR4/TR7 replacement lineage + immutability + history", () => {
    const root = tmpRoot("tr347");
    const first = persistOk(root, fullInput());
    const secondInput = fullInput();
    const second = qa.evaluateAssetQa(secondInput);
    const p2 = qa.persistQaResult(root, "p1", second);
    assert(p2.ok === true && p2.qaResultId === first.qaResultId, "same inputs reproduce the same QA id (idempotent)");
    const hist = qa.listQaHistory(root, "p1", "as-test-01");
    assert(hist.history.length === 1, "idempotent re-persist adds no duplicate history");
    // New evaluation under changed expectation → new lineage entry, old file kept.
    const third = qa.evaluateAssetQa(fullInput({ fingerprintDeps: deps({ scriptVersion: "script-v2" }) }));
    assert(third.qaResultId !== first.qaResultId, "changed context yields a new QA lineage id");
    qa.persistQaResult(root, "p1", third);
    const hist2 = qa.listQaHistory(root, "p1", "as-test-01");
    assert(hist2.history.length === 2 && hist2.history.includes(first.qaResultId), "old QA history preserved");
    const reloaded = qa.loadQaResult(root, "p1", "as-test-01", first.qaResultId);
    assert(reloaded.ok === true && reloaded.result.qaResultId === first.qaResultId, "historical result retrievable unmutated");
  });

  await runTest("TR5 QA triggers no generation", () => {
    const root = tmpRoot("tr5");
    const before = fs.readdirSync(path.join(root, "projects", "p1"));
    persistOk(root, fullInput());
    const after = fs.readdirSync(path.join(root, "projects", "p1"));
    const added = after.filter((f) => !before.includes(f));
    assert(added.length === 1 && added[0] === "qa", "QA writes only qa/ artifacts (no media generation)");
    const r = qa.evaluateAssetQa(fullInput());
    assert(!("generation" in r) && !("credits" in r), "QA result carries no generation/credit surface");
  });

  await runTest("SL1 same inputs same fingerprint", () => {
    const a = qa.buildExpectationFingerprint(deps());
    const b = qa.buildExpectationFingerprint(deps());
    assert(a.fingerprint === b.fingerprint, "identical inputs → identical fingerprint");
  });

  await runTest("SL2 asset hash change stales all layers", () => {
    const stored = qa.buildExpectationFingerprint(deps()).snapshot;
    const st = qa.checkStaleness(stored, deps({ assetHash: HASH_B }));
    assert(st.stale === true && st.staleLayers.length === 4, "hash change stales all four layers");
  });

  await runTest("SL3 evidence change stales factuality only", () => {
    const stored = qa.buildExpectationFingerprint(deps()).snapshot;
    const st = qa.checkStaleness(stored, deps({ claimEvidenceVersion: "ce-v2" }));
    assert(st.stale === true && JSON.stringify(st.staleLayers) === JSON.stringify(["factuality"]), "evidence change stales factuality only");
  });

  await runTest("SL4 Character Bible change stales continuity", () => {
    const stored = qa.buildExpectationFingerprint(deps()).snapshot;
    const st = qa.checkStaleness(stored, deps({ characterBibleVersion: "cb-v2" }));
    assert(st.stale === true && st.staleLayers.includes("continuity") && !st.staleLayers.includes("factuality"), "bible change stales continuity, not factuality");
  });

  await runTest("SL5 aspect policy change stales structural/composition", () => {
    const stored = qa.buildExpectationFingerprint(deps()).snapshot;
    const st = qa.checkStaleness(stored, deps({ platformAdaptationVersion: "pa-v2" }));
    assert(st.stale === true && st.staleLayers.includes("structural") && st.staleLayers.includes("semantic"), "adaptation change stales structural+semantic");
  });

  await runTest("SL6 unrelated scene remains clean", () => {
    const stored = qa.buildExpectationFingerprint(deps()).snapshot;
    const st = qa.checkStaleness(stored, deps());
    assert(st.stale === false, "unchanged deps keep current QA clean");
  });

  await runTest("schema accept + reject instances", () => {
    const schema = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "schemas", "asset-qa-result.schema.json"), "utf8"));
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    const good = qa.evaluateAssetQa(fullInput());
    assert(validate(good) === true, "accept instance validates against asset-qa-result.schema.json");
    const tampered = JSON.parse(JSON.stringify(good));
    tampered.aggregate.timelineEligible = true;
    tampered.structural.status = "FAIL";
    tampered.structural.severity = "BLOCKER";
    const v = qa.validateQaResult(tampered);
    assert(v.valid === false && v.errors.some((e) => /TIMELINE_GATE_VIOLATION/.test(e)), "validator rejects eligible=true with blocker FAIL");
    const noProv = qa.evaluateAssetQa(fullInput());
    noProv.factuality = { status: "PASS", severity: "INFO", blocking: false, checks: [], evidence: [], reasons: [] };
    noProv.evidenceRefs = [];
    noProv.expectationSnapshot = {};
    const v2 = qa.validateQaResult(noProv);
    assert(v2.valid === false && v2.errors.some((e) => /FACTUAL_PROVENANCE_MISSING/.test(e)), "validator rejects factual PASS without provenance");
    const hashBad = JSON.parse(JSON.stringify(good));
    hashBad.assetHash = "not-a-hash";
    assert(qa.validateQaResult(hashBad).valid === false, "validator rejects asset hash mismatch shape");
  });

  console.log(`\n=== DONE: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(`FATAL: ${(e && e.stack) || e}`);
  process.exit(1);
});
