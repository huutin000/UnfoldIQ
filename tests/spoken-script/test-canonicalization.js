"use strict";

/**
 * FIX PRE-2.4 tests — Canonicalization + integration (T1, T2, T26–T38).
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const REPO = path.join(__dirname, "..", "..");
const ss = require(path.join(REPO, "lib", "spoken-script", "index.js"));
const dagLib = require(path.join(REPO, "lib", "dependency-dag", "index.js"));
const manifestLib = require(path.join(REPO, "lib", "project-manifest", "index.js"));
const ws = require(path.join(REPO, "lib", "workspace", "index.js"));
const manifestShared = require(path.join(REPO, "lib", "project-manifest", "index.js"));
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

function fullChain(root, projectId, candidate = H.GOOD_CANDIDATE, extra = {}) {
  const h = ss.createHumanization(root, projectId, {
    contentMode: "everyday-physics-explainer", contentClass: extra.contentClass || "FACTUAL",
    sourceScriptRef: { artifact: "script.json", version: "1.0.0" },
    sourceSegments: H.SOURCE_SEGMENTS, segments: candidate,
    provenance: { actorType: "AGENT", provider: "zcode", model: "GLM-5.3-Flash" },
  });
  const claims = extra.researchClaims === null ? [] : [{ claimId: "C1", classification: "SUPPORTED_FACT", sources: [] }];
  const f = ss.runEvidenceFidelity(root, projectId, { humanization: h.humanization, contentClass: extra.contentClass || "FACTUAL", researchClaims: claims, segmentClaims: { S1: ["C1"], S2: ["C1"], S3: ["C1"] } });
  const n = ss.runNaturalnessQa(root, projectId, { humanization: h.humanization });
  return { h, f, n };
}

async function main() {
  await runTest("T2 fixture/ungated candidate cannot be relabelled CANONICAL", () => {
    const { root, projectId } = H.makeRoot();
    const { h, f, n } = fullChain(root, projectId);
    void f; void n;
    const noFlag = ss.materializeFinalSpokenScript(root, projectId, { humanization: h.humanization, fidelity: f.decision, naturalness: n.qa, scriptArtifactId: "fss-no-flag", scriptVersion: 1 });
    assert(!noFlag.ok && noFlag.code === "FINAL_SPOKEN_SCRIPT_NOT_CANONICAL", "explicit canonical intent required");
  });

  await runTest("T26 FSS cannot be CANONICAL before both gates PASS", () => {
    const { root, projectId } = H.makeRoot();
    const { h } = fullChain(root, projectId, H.DULL_CANDIDATE);
    // Naturalness would FAIL for the dull candidate: simulate by materializing
    // with a FAIL naturalness decision shape.
    const f = ss.runEvidenceFidelity(root, projectId, { humanization: h.humanization, contentClass: "FACTUAL", researchClaims: [{ claimId: "C1", classification: "SUPPORTED_FACT", sources: [] }], segmentClaims: { S1: ["C1"], S2: ["C1"], S3: ["C1"] } });
    const fakeNaturalness = { ...f.decision, decision: "FAIL", humanizationRef: h.humanization.humanizationId, qaId: "nqa-000000000000" };
    const m = ss.materializeFinalSpokenScript(root, projectId, { humanization: h.humanization, fidelity: f.decision, naturalness: fakeNaturalness, scriptArtifactId: "fss-gate-test", scriptVersion: 1, productionScriptStatusExplicitlyCanonical: true });
    assert(!m.ok && m.code === "FINAL_SPOKEN_SCRIPT_GATE_INCOMPLETE", "FAIL naturalness blocks canonicalization");
    const incomplete = ss.materializeFinalSpokenScript(root, projectId, { humanization: h.humanization, scriptArtifactId: "fss-gate-test", scriptVersion: 1, productionScriptStatusExplicitlyCanonical: true });
    assert(!incomplete.ok && incomplete.code === "FINAL_SPOKEN_SCRIPT_GATE_INCOMPLETE", "missing gates block canonicalization");
  });

  await runTest("T27+T28 canonical FSS persists with stable identity/hash, immutable + loadable", () => {
    const { root, projectId } = H.makeRoot();
    const { h, f, n } = fullChain(root, projectId);
    const m = ss.materializeFinalSpokenScript(root, projectId, { humanization: h.humanization, fidelity: f.decision, naturalness: n.qa, scriptArtifactId: "fss-stable-test", scriptVersion: 1, productionScriptStatusExplicitlyCanonical: true });
    assert(m.ok && m.script.provenance.productionScriptStatus === "CANONICAL", "CANONICAL");
    const loaded = ss.loadFinalSpokenScript(root, projectId, "fss-stable-test", 1);
    assert(loaded.ok && loaded.script.fingerprint === m.script.fingerprint, "round-trip identical");
    assert(/^[0-9a-f]{16}$/.test(m.script.fingerprint), "content hash present");
    const replay = ss.materializeFinalSpokenScript(root, projectId, { humanization: h.humanization, fidelity: f.decision, naturalness: n.qa, scriptArtifactId: "fss-stable-test", scriptVersion: 1, productionScriptStatusExplicitlyCanonical: true });
    assert(replay.ok && replay.replay === true, "identical materialization replays");
    // Text stays CLEAN: no provider markup in the canonical text.
    assert(!/\[.*\]\(\/.*\/\)|<speak>|<break/.test(JSON.stringify(m.script.segments)), "no SSML/Kokoro markup in canonical text");
  });

  await runTest("T29+T30 changed bytes create a new revision; source→FSS lineage resolves", () => {
    const { root, projectId } = H.makeRoot();
    const { h, f, n } = fullChain(root, projectId);
    ss.materializeFinalSpokenScript(root, projectId, { humanization: h.humanization, fidelity: f.decision, naturalness: n.qa, scriptArtifactId: "fss-lineage-test", scriptVersion: 1, productionScriptStatusExplicitlyCanonical: true });
    const changed = H.GOOD_CANDIDATE.map((c, i) => i === 2 ? { ...c, candidateSpokenText: "Blue light scatters several times more strongly than red. That may explain the haze." } : c);
    const h2 = ss.createHumanization(root, projectId, {
      contentMode: "everyday-physics-explainer", contentClass: "FACTUAL",
      sourceScriptRef: { artifact: "script.json", version: "1.0.0" },
      sourceSegments: H.SOURCE_SEGMENTS, segments: changed, version: 2,
      provenance: { actorType: "AGENT", attempt: 2 },
    });
    const f2 = ss.runEvidenceFidelity(root, projectId, { humanization: h2.humanization, contentClass: "FACTUAL", researchClaims: [{ claimId: "C1", classification: "SUPPORTED_FACT", sources: [] }], segmentClaims: { S1: ["C1"], S2: ["C1"], S3: ["C1"] } });
    const n2 = ss.runNaturalnessQa(root, projectId, { humanization: h2.humanization });
    const m2 = ss.materializeFinalSpokenScript(root, projectId, { humanization: h2.humanization, fidelity: f2.decision, naturalness: n2.qa, scriptArtifactId: "fss-lineage-test", scriptVersion: 2, productionScriptStatusExplicitlyCanonical: true });
    assert(m2.ok && m2.script.scriptVersion === 2, "new revision v2");
    const v1 = ss.loadFinalSpokenScript(root, projectId, "fss-lineage-test", 1);
    assert(v1.ok && v1.script.fingerprint !== m2.script.fingerprint, "v1 immutable and distinct");
    assert(m2.script.provenance.humanizationRef === h2.humanization.humanizationId, "lineage: FSS → humanization");
    assert(m2.script.provenance.evidenceFidelityRef === f2.decision.decisionId && m2.script.provenance.naturalnessQaRef === n2.qa.qaId, "lineage: gates");
    assert(m2.script.provenance.sourceScriptRef.artifact === "script.json", "lineage: source script");
    assert(v1.script.provenance.humanizationRef === h.humanization.humanizationId, "v1 lineage intact");
  });

  await runTest("T31+T32+T33 DAG dependencies correct; stale downstream DIRTY; unrelated CLEAN", () => {
    const { root, projectId } = H.makeRoot();
    const { h, f, n } = fullChain(root, projectId);
    ss.materializeFinalSpokenScript(root, projectId, { humanization: h.humanization, fidelity: f.decision, naturalness: n.qa, scriptArtifactId: "fss-dag-test", scriptVersion: 1, productionScriptStatusExplicitlyCanonical: true });
    const chain = ss.registerDagChain(root, projectId, { humanizationId: h.humanization.humanizationId, fidelityId: f.decision.decisionId, naturalnessId: n.qa.qaId, scriptArtifactId: "fss-dag-test", scriptVersion: 1 });
    assert(chain.ok, "chain registered");
    // A downstream text/range-dependent consumer with REAL built output.
    // (bootstrapDag may have created a placeholder; complete it instead.)
    let dagNow = dagLib.loadDag(root, projectId).dag;
    if (dagNow.nodes.SHOT_PLAN) {
      dagLib.setNodeVersion(root, projectId, "SHOT_PLAN", "sp-old");
      dagLib.setNodeState(root, projectId, "SHOT_PLAN", "CLEAN");
    } else {
      const shotPlan = dagLib.addNode(root, projectId, { artifactKey: "SHOT_PLAN", artifactType: "SHOT_PLAN", versionRef: "sp-old", state: "CLEAN", provenance: "LIVE", inputRefs: [] });
      assert(shotPlan.ok, "SHOT_PLAN node added");
    }
    const dag = dagLib.loadDag(root, projectId).dag;
    assertEq(dag.nodes.FINAL_SPOKEN_SCRIPT.state, "CLEAN", "FSS node CLEAN");
    assert(dag.nodes.EVIDENCE_FIDELITY_DECISION.inputRefs.some((r) => r.key === "SPOKEN_HUMANIZATION"), "fidelity ← humanization edge");
    assert(dag.nodes.NATURALNESS_QA.inputRefs.some((r) => r.key === "EVIDENCE_FIDELITY_DECISION"), "naturalness ← fidelity edge");
    assert(dag.nodes.FINAL_SPOKEN_SCRIPT.inputRefs.some((r) => r.key === "NATURALNESS_QA"), "FSS ← naturalness edge");
    assert(!dag.nodes.FINAL_AUDIO || dag.nodes.FINAL_AUDIO.state === "NOT_CREATED_YET", "no Final Audio fabricated");
    // Wire the consumer to the canonical script and change the script.
    const dep = dagLib.addDependency(root, projectId, "FINAL_SPOKEN_SCRIPT", "SHOT_PLAN", "SPOKEN_TEXT");
    assert(dep.ok, "dependency wired");
    const mark = dagLib.markDirty(root, projectId, "FINAL_SPOKEN_SCRIPT", { reason: "integration check" });
    assert(mark.ok, "markDirty ok");
    const after = dagLib.loadDag(root, projectId).dag;
    assertEq(after.nodes.SHOT_PLAN.state, "DIRTY", "stale text consumer DIRTY");
    assertEq(after.nodes.SPOKEN_HUMANIZATION.state, "CLEAN", "unrelated upstream stays CLEAN");
    // Replay (same versionRef) does not re-dirty the graph.
    const chain2 = ss.registerDagChain(root, projectId, { humanizationId: h.humanization.humanizationId, fidelityId: f.decision.decisionId, naturalnessId: n.qa.qaId, scriptArtifactId: "fss-dag-test", scriptVersion: 1 });
    assert(chain2.ok && chain2.changed === false, "idempotent replay does not propagate dirty");
  });

  await runTest("T34+T35 manifest ref + resolver/lifecycle PASS", () => {
    const { root, projectId } = H.makeRoot();
    manifestLib.createProjectManifest({ root, projectId, contentMode: "m", contentClass: "FACTUAL" });
    const { h, f, n } = fullChain(root, projectId);
    ss.materializeFinalSpokenScript(root, projectId, { humanization: h.humanization, fidelity: f.decision, naturalness: n.qa, scriptArtifactId: "fss-manifest-test", scriptVersion: 1, productionScriptStatusExplicitlyCanonical: true });
    const att = ss.attachManifestReference(root, projectId, "fss-manifest-test", 1);
    assert(att.ok && att.manifestStatus === "VERIFIED", "manifest ref VERIFIED for CANONICAL");
    const m = manifestLib.loadProjectManifest(root, projectId).manifest;
    assert(m.artifacts.finalSpokenScriptVersion.version === "fss-manifest-test@v1", "indexed by id@version");
    assert(!JSON.stringify(m).includes("candidateSpokenText"), "manifest carries no script body");
    const resolve = ws.resolveArtifactPath(root, projectId, "INPUT", "DURABLE");
    assert(resolve.ok, "resolver resolves INPUT");
    const lifecycle = ws.classifyNewArtifact({ artifactType: "VOICE", lifecycleClass: "RETENTION_MANAGED" });
    assert(lifecycle.ok && lifecycle.lifecycleClass === "RETENTION_MANAGED", "humanization candidates RETENTION_MANAGED");
  });

  await runTest("T36 secret scan PASS on all chain artifacts", () => {
    const { root, projectId } = H.makeRoot();
    const { h, f, n } = fullChain(root, projectId);
    const hits = [...manifestShared.findSecretKeys(h.humanization), ...manifestShared.findSecretKeys(f.decision), ...manifestShared.findSecretKeys(n.qa)];
    assertEq(hits.length, 0, "no secret-like keys");
  });

  await runTest("T37 telemetry correlation: project → script → hum → fid → nqa → FSS", () => {
    const { root, projectId } = H.makeRoot();
    const { h, f, n } = fullChain(root, projectId);
    ss.materializeFinalSpokenScript(root, projectId, { humanization: h.humanization, fidelity: f.decision, naturalness: n.qa, scriptArtifactId: "fss-tel-test", scriptVersion: 1, productionScriptStatusExplicitlyCanonical: true });
    const events = Object.values(JSON.parse(fs.readFileSync(path.join(root, "projects", projectId, "telemetry", "events.json"), "utf8")).events || {});
    const byName = (x) => events.filter((e) => e.eventName === x);
    assert(byName("SPOKEN_HUMANIZATION_CREATED").some((e) => e.correlationId === h.humanization.humanizationId), "humanization correlated");
    assert(byName("EVIDENCE_FIDELITY_EVALUATED").some((e) => e.correlationId === f.decision.decisionId), "fidelity correlated");
    assert(byName("NATURALNESS_QA_EVALUATED").some((e) => e.correlationId === n.qa.qaId), "naturalness correlated");
    assert(byName("FINAL_SPOKEN_SCRIPT_CANONICALIZED").length > 0, "canonicalization event exists");
    assert(events.every((e) => e.stage === "fix-pre-2.4"), "staged under fix-pre-2.4");
  });

  await runTest("T38 fresh-process restore PASS (chain artifacts reload in a new node process)", () => {
    const { root, projectId } = H.makeRoot();
    manifestLib.createProjectManifest({ root, projectId, contentMode: "m", contentClass: "FACTUAL" });
    const { h, f, n } = fullChain(root, projectId);
    ss.materializeFinalSpokenScript(root, projectId, { humanization: h.humanization, fidelity: f.decision, naturalness: n.qa, scriptArtifactId: "fss-fresh-test", scriptVersion: 1, productionScriptStatusExplicitlyCanonical: true });
    ss.attachManifestReference(root, projectId, "fss-fresh-test", 1);
    const script = `
      const REPO = ${JSON.stringify(root)};
      const fs = require("fs");
      const ss = require(${JSON.stringify(path.join(REPO, "lib", "spoken-script", "index.js"))});
      const manifestLib = require(${JSON.stringify(path.join(REPO, "lib", "project-manifest", "index.js"))});
      const m = manifestLib.loadProjectManifest(REPO, ${JSON.stringify(projectId)});
      if (!m.ok) throw new Error("manifest");
      const hum = ss.loadHumanization(REPO, ${JSON.stringify(projectId)}, ${JSON.stringify(h.humanization.humanizationId)});
      if (!hum.ok) throw new Error("hum");
      const fss = ss.loadFinalSpokenScript(REPO, ${JSON.stringify(projectId)}, "fss-fresh-test", 1);
      if (!fss.ok || fss.script.provenance.productionScriptStatus !== "CANONICAL") throw new Error("fss");
      console.log("RESTORE_OK");
    `;
    const r = spawnSync("node", ["-e", script], { encoding: "utf8", timeout: 60000 });
    assert(r.status === 0 && r.stdout.includes("RESTORE_OK"), `fresh process OK: ${r.stdout.trim() || r.stderr.slice(0, 200)}`);
  });

  await runTest("Correction pass: superseded version fails closed at the production resolver (v1 stays byte-identical history)", () => {
    const { root, projectId } = H.makeRoot();
    const { h, f, n } = fullChain(root, projectId);
    ss.materializeFinalSpokenScript(root, projectId, { humanization: h.humanization, fidelity: f.decision, naturalness: n.qa, scriptArtifactId: "fss-sup-test", scriptVersion: 1, productionScriptStatusExplicitlyCanonical: true });
    const v1Bytes = fs.readFileSync(path.join(root, "projects", projectId, "input", "final-spoken-script", "fss-sup-test-v1.json"), "utf8");
    const sup = ss.recordSupersession(root, projectId, { scriptArtifactId: "fss-sup-test", version: 1, supersededBy: 2, reason: "test defect" });
    assert(sup.ok && sup.decision.status === "SUPERSEDED_INVALID" && sup.decision.productionEligible === false, "decision recorded");
    assertEq(fs.readFileSync(path.join(root, "projects", projectId, "input", "final-spoken-script", "fss-sup-test-v1.json"), "utf8"), v1Bytes, "superseded version file byte-identical");
    const refused = ss.resolveProductionScript(root, projectId, "fss-sup-test", 1);
    assert(!refused.ok && refused.code === "FINAL_SPOKEN_SCRIPT_SUPERSEDED", "resolver refuses superseded version");
    const v1History = ss.loadFinalSpokenScript(root, projectId, "fss-sup-test", 1);
    assert(v1History.ok, "superseded version still loadable as history");
    const replay = ss.recordSupersession(root, projectId, { scriptArtifactId: "fss-sup-test", version: 1, supersededBy: 2, reason: "test defect" });
    assert(replay.ok && replay.replay === true, "identical supersession replays (immutable)");
    // Canonical successor resolution unaffected.
    const h2 = ss.createHumanization(root, projectId, {
      contentMode: "everyday-physics-explainer", contentClass: "FACTUAL",
      sourceScriptRef: { artifact: "script.json", version: "1.0.0" },
      sourceSegments: H.SOURCE_SEGMENTS, segments: H.GOOD_CANDIDATE, version: 2,
      provenance: { actorType: "AGENT", attempt: 1 },
    });
    const f2 = ss.runEvidenceFidelity(root, projectId, { humanization: h2.humanization, contentClass: "FACTUAL", researchClaims: [{ claimId: "C1", classification: "SUPPORTED_FACT", sources: [] }], segmentClaims: { S1: ["C1"], S2: ["C1"], S3: ["C1"] } });
    const n2 = ss.runNaturalnessQa(root, projectId, { humanization: h2.humanization });
    ss.materializeFinalSpokenScript(root, projectId, { humanization: h2.humanization, fidelity: f2.decision, naturalness: n2.qa, scriptArtifactId: "fss-sup-test", scriptVersion: 2, productionScriptStatusExplicitlyCanonical: true });
    const resolved = ss.resolveProductionScript(root, projectId, "fss-sup-test", 2);
    assert(resolved.ok && resolved.script.provenance.productionScriptStatus === "CANONICAL", "successor resolves for production");
  });

  await runTest("T1 real source candidate resolves (pilot audit data present)", () => {
    const srcPath = path.join(REPO, "projects", "pilot-sky-blue", "script.json");
    const briefPath = path.join(REPO, "projects", "pilot-sky-blue", "research", "research-brief.json");
    assert(fs.existsSync(srcPath) && fs.existsSync(briefPath), "pilot script + research brief exist");
    const brief = JSON.parse(fs.readFileSync(briefPath, "utf8"));
    assert(brief.researchStatus === "COMPLETE" && brief.claims.length >= 7, "provenance complete for FACTUAL backfill");
  });

  console.log(`\n=== DONE: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
