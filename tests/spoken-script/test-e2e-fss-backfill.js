"use strict";

/**
 * FIX PRE-2.4 — real bounded E2E (T39–T44 + §44 proofs).
 * The canonical chain was executed by scripts/cli/fss-backfill.js against the
 * REAL pilot-sky-blue source script (real Kokoro quiet runtime). This test
 * re-runs the idempotent CLI and verifies every proof obligation.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const REPO = path.join(__dirname, "..", "..");
const PILOT = "pilot-sky-blue";
const manifestLib = require(path.join(REPO, "lib", "project-manifest", "index.js"));
const ss = require(path.join(REPO, "lib", "spoken-script", "index.js"));
const narr = require(path.join(REPO, "lib", "narration", "index.js"));
const pron = require(path.join(REPO, "lib", "pronunciation", "index.js"));
const ttsReady = require(path.join(REPO, "lib", "tts-ready-plan.js"));
const dagLib = require(path.join(REPO, "lib", "dependency-dag", "index.js"));

let passed = 0;
let failed = 0;
function assert(cond, msg) { if (!cond) throw new Error("ASSERTION FAILED: " + msg); console.log("  ok  " + msg); }
function assertEq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`ASSERTION FAILED: ${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); console.log("  ok  " + msg); }
async function runTest(name, fn) {
  console.log("[TEST] " + name);
  try { await fn(); passed += 1; console.log("[PASS] " + name); }
  catch (e) { failed += 1; console.log("[FAIL] " + name + " — " + e.message); }
}

async function main() {
  const sourceBefore = fs.readFileSync(path.join(REPO, "projects", PILOT, "script.json"), "utf8");

  await runTest("E2E-0 idempotent CLI re-run succeeds (real chain, real Kokoro on first run)", () => {
    const r = spawnSync("node", ["scripts/cli/fss-backfill.js"], { encoding: "utf8", cwd: REPO, timeout: 600000 });
    assert(r.status === 0, `CLI ok: ${r.status === 0 ? "" : (r.stdout + r.stderr).slice(-400)}`);
    const out = JSON.parse(r.stdout.slice(r.stdout.indexOf("{")));
    assertEq(out.sourceBytesUnchanged, true, "CLI reports source unchanged");
    assertEq(out.productionScriptStatus, "CANONICAL", "FSS canonical");
    assertEq(out.productionTtsBlocked, false, "plan unblocked");
  });

  const sourceAfter = fs.readFileSync(path.join(REPO, "projects", PILOT, "script.json"), "utf8");
  const m = manifestLib.loadProjectManifest(REPO, PILOT).manifest;
  const ndDoc = narr.loadNarrationDirection(REPO, PILOT, m.artifacts.narrationDirectionVersion.version).narrationDirection;
  const passDoc = pron.loadPronunciationPass(REPO, PILOT, m.artifacts.pronunciationRuntimePassVersion.version).pass;
  const fss = ss.loadFinalSpokenScript(REPO, PILOT, "fss-pilot-sky-blue", 2).script;

  await runTest("E2E-1 §44 proof: source bytes unchanged; candidate differs only via permitted humanization", () => {
    assertEq(sourceAfter, sourceBefore, "source script byte-identical");
    const humDoc = ss.loadHumanization(REPO, PILOT, fss.provenance.humanizationRef).humanization;
    assert(humDoc.segments.length === fss.segments.length, "1:1 segment mapping (no cross-segment splits in this backfill)");
    for (const seg of humDoc.segments) {
      assertEq(seg.sourceTextHash, ss.textHash(seg.sourceText), `${seg.segmentId} source hash bound`);
      assert(seg.changeTypes.every((t) => ss.CHANGE_TYPES.includes(t)), `${seg.segmentId} changeTypes bounded`);
    }
  });

  await runTest("E2E-2 §44 proof: protected items preserved; gates PASS; lineage resolves", () => {
    const fid = JSON.parse(fs.readFileSync(path.join(REPO, "projects", PILOT, "voice", "evidence-fidelity", `${fss.provenance.evidenceFidelityRef}.json`), "utf8"));
    const nqa = JSON.parse(fs.readFileSync(path.join(REPO, "projects", PILOT, "voice", "naturalness-qa", `${fss.provenance.naturalnessQaRef}.json`), "utf8"));
    assertEq(fid.decision, "PASS", "fidelity PASS");
    assertEq(nqa.decision, "PASS", "naturalness PASS");
    assert(fid.checks.every((c) => c.status !== "CHANGED_INVALID"), "no protected-item mismatch");
    assertEq(fid.humanizationRef, fss.provenance.humanizationRef, "fidelity ↔ humanization");
    assertEq(nqa.humanizationRef, fss.provenance.humanizationRef, "naturalness ↔ humanization");
    assert(fid.checks.filter((c) => c.protectedItemType === "FACT" && c.evidenceRef).length >= 6, "claims traced to canonical research evidence");
  });

  await runTest("E2E-3 T39 Phase 2.2 rerun binds to the canonical FSS", () => {
    assertEq(ndDoc.scriptRef.scriptArtifactId, "fss-pilot-sky-blue", "ND bound to canonical FSS");
    assertEq(ndDoc.scriptRef.scriptVersion, 2, "FSS v2");
    for (const d of ndDoc.segments) {
      const seg = fss.segments.find((s) => s.segmentId === d.segmentId);
      assertEq(d.sourceTextHash, narr.segmentHash(seg.text), `${d.segmentId} hash matches canonical text`);
    }
    assertEq(ndDoc.voiceBibleRef, "vb-19f4fd6a4596", "am_michael via locked Voice Bible");
  });

  await runTest("E2E-4 T40 Phase 2.3 real Kokoro quiet runtime binds to the new FSS", () => {
    assertEq(passDoc.scriptRef.scriptArtifactId, "fss-pilot-sky-blue", "pass bound to canonical FSS");
    assert(passDoc.segments.every((s) => s.runtimePhonemeHash), "real phonemization hashes present");
    assertEq(passDoc.providerLanguageCode, "a", "en-us → Kokoro code");
    assert(passDoc.segments.every((s) => s.status === "CLEAN"), "all segments CLEAN");
  });

  await runTest("E2E-5 T41 Phase223 fixture remains NOT_APPLICABLE (no in-place relabel)", () => {
    const fixtureScript = JSON.parse(fs.readFileSync(path.join(REPO, "projects", "phase223-narration-pronunciation", "input", "final-spoken-script.json"), "utf8"));
    assertEq(fixtureScript.provenance.productionScriptStatus, "NOT_APPLICABLE", "fixture untouched");
    const p223 = manifestLib.loadProjectManifest(REPO, "phase223-narration-pronunciation").manifest;
    assert(p223.artifacts.ttsReadyPlanVersion.detail.includes("PRODUCTION_TTS_BLOCKED"), "phase223 plan still blocked");
  });

  await runTest("E2E-6 T42+T43 new plan references canonical FSS; blocked=false ONLY because CANONICAL", () => {
    const plan = ttsReady.loadTtsReadyPlan(REPO, PILOT, m.artifacts.ttsReadyPlanVersion.version).plan;
    assertEq(plan.scriptRef.scriptArtifactId, "fss-pilot-sky-blue", "plan bound to canonical FSS");
    assertEq(plan.provenance.productionScriptStatus, "CANONICAL", "canonical status copied");
    assertEq(plan.productionTtsBlocked, false, "unblocked");
    assertEq(plan.overall, "READY_FOR_TTS", "READY_FOR_TTS");
    // The contrast: a non-canonical script stays blocked (verified in E2E-5).
    assert(m.artifacts.ttsReadyPlanVersion.status === "VERIFIED", "manifest VERIFIED for canonical plan");
  });

  await runTest("E2E-7 T32 proof: stale downstream consumers cannot silently reach final output", () => {
    const dag = dagLib.loadDag(REPO, PILOT).dag;
    for (const key of ["SHOT_PLAN", "VOICE", "CAPTIONS", "SCENE_TIMING", "RENDER"]) {
      if (!dag.nodes[key]) continue;
      assert(["DIRTY", "BLOCKED"].includes(dag.nodes[key].state), `${key} stale/DIRTY (was derived from superseded text)`);
    }
    assertEq(dag.nodes.FINAL_SPOKEN_SCRIPT.state, "CLEAN", "canonical FSS CLEAN");
  });

  await runTest("E2E-8 T44 no final audio exists anywhere in the pilot project", () => {
    const hits = [];
    const walk = (dir) => {
      for (const f of fs.readdirSync(dir)) {
        const p = path.join(dir, f);
        if (fs.statSync(p).isDirectory()) walk(p);
        else if ([".wav", ".mp3", ".flac", ".ogg", ".m4a"].includes(path.extname(f).toLowerCase())) hits.push(p);
      }
    };
    walk(path.join(REPO, "projects", PILOT, "voice"));
    walk(path.join(REPO, "projects", PILOT, "input"));
    walk(path.join(REPO, "projects", PILOT, "evidence"));
    assertEq(hits.length, 0, "zero WAV/audio artifacts from this FIX");
    assertEq(m.artifacts.finalAudioVersion.status, "NOT_CREATED_YET", "final audio NOT_CREATED_YET");
  });

  console.log(`\n=== DONE: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
  console.log("FIX_PRE_2_4_E2E: PASS");
  process.exit(0);
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
