"use strict";

/**
 * Phase 2.2+2.3 — Integration tests on the REAL canonical validation
 * workspace: Manifest index (T25), DAG dirty scoping (T26), stable ids +
 * resolver (T27), lifecycle (T28), no path-only identity (T29), telemetry
 * correlation (T31), fresh-process restore (T32), no Phase 2.4+ artifacts
 * (T36). Runs AFTER test-e2e-phase223.js created the canonical artifacts
 * (alphabetical file order within the narration domain).
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const REPO = path.join(__dirname, "..", "..");
const WS_REL = "projects/phase223-narration-pronunciation";
const PROJECT_ID = "phase223-narration-pronunciation";
const manifestLib = require(path.join(REPO, "lib", "project-manifest", "index.js"));
const dagLib = require(path.join(REPO, "lib", "dependency-dag", "index.js"));
const ws = require(path.join(REPO, "lib", "workspace", "index.js"));
const narr = require(path.join(REPO, "lib", "narration", "index.js"));
const pron = require(path.join(REPO, "lib", "pronunciation", "index.js"));
const ttsReady = require(path.join(REPO, "lib", "tts-ready-plan.js"));

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (!cond) throw new Error("ASSERTION FAILED: " + msg);
  console.log("  ok  " + msg);
}
function assertEq(a, b, msg) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`ASSERTION FAILED: ${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
  console.log("  ok  " + msg);
}
async function runTest(name, fn) {
  console.log("[TEST] " + name);
  try {
    await fn();
    passed += 1;
    console.log("[PASS] " + name);
  } catch (e) {
    failed += 1;
    console.log("[FAIL] " + name + " — " + e.message);
  }
}

async function main() {
  const m = manifestLib.loadProjectManifest(REPO, PROJECT_ID).manifest;
  const ndDoc = narr.loadNarrationDirection(REPO, PROJECT_ID, m.artifacts.narrationDirectionVersion.version).narrationDirection;
  const passDoc = pron.loadPronunciationPass(REPO, PROJECT_ID, m.artifacts.pronunciationRuntimePassVersion.version).pass;

  await runTest("T25 Manifest references correct (index only, ids + status)", () => {
    assertEq(m.schemaVersion, "1.5.0", "schema 1.5.0");
    assert(m.artifacts.finalSpokenScriptVersion.status === "VERIFIED", "script ref VERIFIED");
    assertEq(m.artifacts.narrationDirectionVersion.version, ndDoc.narrationDirectionId, "ND indexed by id");
    assert(m.artifacts.narrationDirectionVersion.status === "VERIFIED", "ND VERIFIED");
    assert(m.artifacts.pronunciationProfileVersion.version === passDoc.profileRef, "profile indexed by id");
    assertEq(m.artifacts.pronunciationRuntimePassVersion.version, passDoc.pronunciationPassId, "pass indexed by id");
    // FIX_PHASE_2_2_2_3_01 §2: production TTS is blocked for the non-canonical
    // fixture script, so the plan index entry is honestly UNRESOLVED.
    assert(m.artifacts.ttsReadyPlanVersion.status === "UNRESOLVED", "plan UNRESOLVED (production TTS blocked: fixture script)");
    assert(m.artifacts.ttsReadyPlanVersion.detail.includes("PRODUCTION_TTS_BLOCKED"), "block recorded in manifest detail");
    assert(!JSON.stringify(m.artifacts).includes("emphasis"), "manifest carries no direction bodies");
    assert(!JSON.stringify(m.artifacts).includes("normalizedTerm"), "manifest carries no pronunciation dictionary");
  });

  await runTest("T26 DAG dirty propagation scoped to dependents (then restored)", () => {
    const dag = dagLib.loadDag(REPO, PROJECT_ID).dag;
    for (const n of ["NARRATION_DIRECTION", "PRONUNCIATION_RUNTIME_PASS", "TTS_READY_PLAN"]) {
      assert(dag.nodes[n], `${n} node exists (real artifact)`);
    }
    const mark = dagLib.markDirty(REPO, PROJECT_ID, "FINAL_SPOKEN_SCRIPT", { reason: "integration test: script change simulation" });
    assert(mark.ok, "markDirty ok");
    const after = dagLib.loadDag(REPO, PROJECT_ID).dag;
    assertEq(after.nodes.NARRATION_DIRECTION.state, "DIRTY", "ND descendant DIRTY");
    assertEq(after.nodes.PRONUNCIATION_RUNTIME_PASS.state, "DIRTY", "pass descendant DIRTY");
    assertEq(after.nodes.TTS_READY_PLAN.state, "DIRTY", "plan descendant DIRTY");
    assertEq(after.nodes.VOICE_BIBLE.state, "CLEAN", "unrelated VOICE_BIBLE CLEAN");
    assertEq(after.nodes.PRONUNCIATION_PROFILE.state, "CLEAN", "unrelated profile CLEAN");
    // Nothing actually changed in this test — restore canonical CLEAN state.
    for (const n of ["NARRATION_DIRECTION", "PRONUNCIATION_RUNTIME_PASS", "TTS_READY_PLAN"]) {
      const s = dagLib.setNodeState(REPO, PROJECT_ID, n, "CLEAN");
      assert(s.ok, `${n} restored CLEAN`);
    }
    // Input refs are the real §18 dependency edges.
    const dag2 = dagLib.loadDag(REPO, PROJECT_ID).dag;
    const ndRefs = dag2.nodes.NARRATION_DIRECTION.inputRefs.map((r) => r.key).sort();
    assertEq(ndRefs, ["FINAL_SPOKEN_SCRIPT", "VOICE_BIBLE"], "ND deps: script + voice bible");
    const passRefs = dag2.nodes.PRONUNCIATION_RUNTIME_PASS.inputRefs.map((r) => r.key).sort();
    assertEq(passRefs, ["FINAL_SPOKEN_SCRIPT", "PRONUNCIATION_PROFILE"], "pass deps: script + profile");
    const planRefs = dag2.nodes.TTS_READY_PLAN.inputRefs.map((r) => r.key).sort();
    assertEq(planRefs, ["NARRATION_DIRECTION", "PRONUNCIATION_RUNTIME_PASS"], "plan deps: ND + pass");
    assert(!dag2.nodes.FINAL_AUDIO, "no fabricated FINAL_AUDIO node");
    assert(!dag2.nodes.FORCED_ALIGNMENT, "no fabricated alignment node");
  });

  await runTest("T27 stable artifact ids resolve through the workspace resolver", () => {
    const patterns = [
      [ndDoc.narrationDirectionId, /^nd-[0-9a-f]{12}$/],
      [passDoc.pronunciationPassId, /^prp-[0-9a-f]{12}$/],
      [passDoc.profileRef, /^pron-[0-9a-f]{12}$/],
      [m.artifacts.ttsReadyPlanVersion.version, /^ttp-[0-9a-f]{12}$/],
    ];
    for (const [id, re] of patterns) assert(re.test(id), `stable id shape: ${id}`);
    for (const [type, dir] of [["VOICE", "voice"], ["EVIDENCE", "evidence"], ["INPUT", "input"]]) {
      const r = ws.resolveArtifactPath(REPO, PROJECT_ID, type, "DURABLE");
      assert(r.ok, `resolver resolves ${type}`);
    }
    const guard = ws.validateWorkspacePath(REPO, path.posix.join(WS_REL, "voice", "narration-direction"), { projectId: PROJECT_ID });
    assert(guard.ok, "canonical refs pass the workspace guard");
  });

  await runTest("T28 lifecycle correct (DURABLE core, RETENTION_MANAGED evidence, EPHEMERAL tmp)", () => {
    const durable = ws.classifyNewArtifact({ artifactType: "VOICE", lifecycleClass: "DURABLE" });
    assert(durable.ok && durable.lifecycleClass === "DURABLE", "voice artifacts DURABLE");
    const evidence = ws.classifyNewArtifact({ artifactType: "EVIDENCE", lifecycleClass: "RETENTION_MANAGED" });
    assert(evidence.ok && evidence.lifecycleClass === "RETENTION_MANAGED", "runtime diagnostic evidence RETENTION_MANAGED");
    const tmp = ws.classifyNewArtifact({ artifactType: "TMP", lifecycleClass: "EPHEMERAL" });
    assert(tmp.ok && tmp.lifecycleClass === "EPHEMERAL", "temporary G2P scratch EPHEMERAL");
    // Unspecified lifecycle fails safe, never disposable.
    const unsafe = ws.classifyNewArtifact({ artifactType: "VOICE" });
    assert(unsafe.ok && unsafe.lifecycleClass === "RETENTION_MANAGED" && unsafe.reviewRequired === true, "unknown data fails safe to RETENTION_MANAGED + REVIEW_REQUIRED");
  });

  await runTest("T29 no path-only durable identity (fingerprint + version id on every durable artifact)", () => {
    const docs = {
      narrationDirection: ndDoc,
      pronunciationPass: passDoc,
      profile: pron.loadPronunciationProfile(REPO, PROJECT_ID, passDoc.profileRef).profile,
      ttsReadyPlan: ttsReady.loadTtsReadyPlan(REPO, PROJECT_ID, m.artifacts.ttsReadyPlanVersion.version).plan,
    };
    for (const [name, doc] of Object.entries(docs)) {
      assert(/^[0-9a-f]{16}$/.test(doc.fingerprint), `${name} has a content fingerprint`);
      const id = doc.narrationDirectionId || doc.pronunciationPassId || doc.pronunciationProfileId || doc.ttsReadyPlanId;
      assert(typeof id === "string" && id.length > 0, `${name} has a stable artifact id (identity is not its path)`);
    }
    // Fingerprint actually binds content: mutate a copy → fingerprint would differ.
    const clone = JSON.parse(JSON.stringify(ndDoc));
    clone.segments = [];
    assert(require(REPO + "/lib/output-cost/shared.js").hash16(JSON.parse(JSON.stringify({ ...clone, fingerprint: null }))) !== ndDoc.fingerprint, "fingerprint is content-derived, not path-derived");
  });

  await runTest("T31 telemetry correlation: project → script → direction → pass → segment", () => {
    const eventsDoc = JSON.parse(fs.readFileSync(path.join(REPO, WS_REL, "telemetry", "events.json"), "utf8"));
    const events = Object.values(eventsDoc.events || {});
    const byName = (n) => events.filter((e) => e.eventName === n);
    const created = byName("NARRATION_DIRECTION_CREATED");
    assert(created.length > 0 && created[0].correlationId === ndDoc.narrationDirectionId, "NARRATION_DIRECTION_CREATED correlated on the ND id");
    const validated = byName("PRONUNCIATION_RUNTIME_VALIDATED");
    assert(validated.some((e) => e.correlationId === passDoc.pronunciationPassId), "PRONUNCIATION_RUNTIME_VALIDATED correlated on the pass id");
    assert(byName("PRONUNCIATION_PROFILE_RESOLVED").length > 0, "profile resolved event exists");
    assert(
      byName("PRONUNCIATION_OVERRIDE_REVISED").some((e) => e.correlationId === passDoc.profileRef) ||
      byName("PRONUNCIATION_PROFILE_RESOLVED").some((e) => e.correlationId === passDoc.profileRef),
      "current profile version correlated (created or revised)"
    );
    assert(byName("PRONUNCIATION_INVALIDATION_PLANNED").length > 0, "invalidation planned event exists");
    assert(events.every((e) => e.stage === "phase-2.2" || e.stage === "phase-2.3" || e.stage === "phase-2.2-2.3" || e.stage === null), "events staged under phase 2");
    assert(events.every((e) => !e.errorCode || ["REVIEW_REQUIRED", "NOT_CREATED_YET"].includes(e.errorCode)), "no unexpected error codes persisted");
  });

  await runTest("T32 fresh-process restore PASS (all canonical artifacts reload + validate in a new node process)", () => {
    const script = `
      const REPO = ${JSON.stringify(REPO)};
      const PROJECT_ID = ${JSON.stringify(PROJECT_ID)};
      const fs = require("fs"); const path = require("path");
      const manifestLib = require(REPO + "/lib/project-manifest/index.js");
      const narr = require(REPO + "/lib/narration/index.js");
      const pron = require(REPO + "/lib/pronunciation/index.js");
      const m = manifestLib.loadProjectManifest(REPO, PROJECT_ID);
      if (!m.ok || m.manifest.schemaVersion !== "1.5.0") throw new Error("manifest");
      const nd = narr.latestNarrationDirection(REPO, PROJECT_ID);
      if (!nd.ok) throw new Error("nd");
      const prof = pron.latestPronunciationProfile(REPO, PROJECT_ID);
      if (!prof.ok) throw new Error("profile");
      const pass = pron.loadPronunciationPass(REPO, PROJECT_ID, m.manifest.artifacts.pronunciationRuntimePassVersion.version);
      if (!pass.ok) throw new Error("pass");
      const planDir = path.join(REPO, "projects", PROJECT_ID, "voice", "tts-ready-plan");
      const planFile = fs.readdirSync(planDir).filter(f => f.endsWith(".json")).sort().pop();
      const plan = JSON.parse(fs.readFileSync(path.join(planDir, planFile), "utf8"));
      if (!plan.ttsReadyPlanId || !plan.fingerprint) throw new Error("plan");
      console.log("RESTORE_OK");
    `;
    const r = spawnSync("node", ["-e", script], { encoding: "utf8", cwd: REPO, timeout: 60000 });
    assert(r.status === 0 && r.stdout.includes("RESTORE_OK"), `fresh process reloads everything: ${r.stdout.trim() || r.stderr.slice(0, 200)}`);
  });

  await runTest("T36 no Phase 2.4+ artifact created anywhere in the workspace", () => {
    assert(m.artifacts.finalAudioVersion.status === "NOT_CREATED_YET", "final audio NOT_CREATED_YET");
    assert(m.artifacts.alignmentVersion.status === "NOT_CREATED_YET", "alignment NOT_CREATED_YET");
    assert(m.artifacts.timelineVersion.status === "NOT_CREATED_YET", "timeline NOT_CREATED_YET");
    const audioExt = [".wav", ".mp3", ".flac", ".ogg", ".m4a"];
    const hits = [];
    const walk = (dir) => {
      if (!fs.existsSync(dir)) return;
      for (const f of fs.readdirSync(dir)) {
        const p = path.join(dir, f);
        if (fs.statSync(p).isDirectory()) walk(p);
        else if (audioExt.includes(path.extname(f).toLowerCase())) hits.push(p);
      }
    };
    walk(path.join(REPO, WS_REL));
    assertEq(hits.length, 0, "zero audio files");
    for (const forbidden of ["audio", "captions", "timeline"]) {
      assert(!fs.existsSync(path.join(REPO, WS_REL, forbidden)), `no ${forbidden}/ directory fabricated`);
    }
  });

  console.log(`\n=== DONE: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
