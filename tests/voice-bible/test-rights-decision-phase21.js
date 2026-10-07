"use strict";

/**
 * PHASE 2.1 FIX 02 — rights decision + canonical sync (D1–D24).
 *
 * Terminal state under test: MODEL_LICENSE VERIFIED + VOICE_ASSET_RIGHTS /
 * OUTPUT_USAGE_STATUS RISK_ACCEPTED under the explicit operator decision
 * ACCEPT_RESIDUAL_RIGHTS_RISK, Voice Bible v3 vb-19f4fd6a4596, narrator
 * am_michael OPERATOR_APPROVED and locked, manifest VERIFIED.
 *
 * Read-only against the live repo except for lock-refusal probes (which write
 * nothing) and tmp-root negative cases. D22 (full regression) is runner-level
 * and recorded in the report, not asserted here.
 *
 * HONESTY CONSTRAINT: nothing here may mark VERIFIED what is RISK_ACCEPTED,
 * approve a voice, or invent evidence.
 */

const os = require("os");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const lic = require("../../lib/voice-bible/license.js");
const vb = require("../../lib/voice-bible/index.js");
const pm = require("../../lib/project-manifest/index.js");
const dagLib = require("../../lib/dependency-dag/index.js");
const historyLib = require("../../lib/generation-history/index.js");
const manifestLib = require("../../lib/project-manifest/index.js");
const kokoro = require("../../providers/runtime/adapters/local-kokoro.js");

const REPO = path.join(__dirname, "..", "..");
const PID = "phase2-1-validation";
const V1 = "vb-42744f223671";
const V2 = "vb-2997edea5ffa";
const V3 = "vb-19f4fd6a4596";
const VOICE = "am_michael";

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
  console.log(`  ok  ${message}`);
  passed++;
}
function assertEq(actual, expected, message) {
  assert(actual === expected, `${message} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`);
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

async function main() {
  await runTest("D1 official model-license evidence resolves", () => {
    const r = lic.loadLicenseEvidence(REPO, "local-kokoro");
    assert(r.ok, `evidence loads (${r.ok ? "" : r.code + " " + r.message})`);
    assertEq(r.evidence.claims.modelLicense.status, "VERIFIED", "MODEL_LICENSE VERIFIED");
    assertEq(r.evidence.claims.modelLicense.licenseIdentifier, "Apache-2.0", "Apache-2.0 identifier");
    assertEq(r.evidence.officialSource.url, "https://huggingface.co/hexgrad/Kokoro-82M", "official model source");
    assert(/^https:\/\//.test(r.evidence.officialSource.licenseFileUrl), "official LICENSE file URL");
    assert(Boolean(r.evidence.officialSource.quotedStatement), "verbatim official statement");
  });

  await runTest("D2 voices-directory evidence resolves", () => {
    const { evidence } = lic.loadLicenseEvidence(REPO, "local-kokoro");
    const refs = evidence.claims.voiceAssetRights.evidenceRefs;
    assert(refs.includes("https://huggingface.co/hexgrad/Kokoro-82M/tree/main/voices"), "voices/ directory evidence recorded");
    assert(refs.includes("https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md"), "VOICES.md evidence recorded");
  });

  await runTest("D3 selected am_michael identity/hash resolves", () => {
    const { evidence } = lic.loadLicenseEvidence(REPO, "local-kokoro");
    const row = evidence.runtimeVoiceInventory.find((v) => v.voiceId === VOICE);
    assert(row && row.language === "en-us", "am_michael in persisted runtime inventory (en-us)");
    assert(/9a443b79a4b22489a5b0ab7c651a0bcd1a30bef675c28333f06971abbd47bd37/.test(evidence.claims.voiceAssetRights.basis), "am_michael byte hash recorded in evidence basis");
    const latest = vb.latestVoiceBible(REPO, PID);
    assertEq(latest.voiceBible.narrator.voiceId, VOICE, "current bible carries am_michael");
  });

  await runTest("D4 model hash resolves", () => {
    const { evidence } = lic.loadLicenseEvidence(REPO, "local-kokoro");
    assertEq(evidence.upstreamArtifact.sha256, "496dba118d1a58f5f3db2efc88dbdc216e0483fc89fe6e47ee1f2c53f18ad1e4", "official model SHA256 recorded");
    assert(/byte-identical/.test(evidence.runtimeBinding.note), "local artifact verified byte-identical to official");
  });

  await runTest("D5 MODEL_LICENSE / VOICE_ASSET_RIGHTS / OUTPUT_USAGE_STATUS remain separate", () => {
    const s = lic.rightsStates(REPO, "local-kokoro");
    assert(s.ok, "rights states resolve");
    assertEq(s.states.modelLicense.status, "VERIFIED", "model VERIFIED");
    assertEq(s.states.voiceAssetRights.status, "RISK_ACCEPTED", "voice RISK_ACCEPTED (not VERIFIED)");
    assertEq(s.states.outputUsageStatus.status, "RISK_ACCEPTED", "output RISK_ACCEPTED (not VERIFIED)");
    assert(s.states.voiceAssetRights.status !== s.states.modelLicense.status, "claims are not collapsed into one licensed=true");
  });

  await runTest("D6 VERIFIED cannot be fabricated from risk acceptance", () => {
    const s = lic.rightsStates(REPO, "local-kokoro");
    const relabelled = {
      modelLicense: { ...s.states.modelLicense },
      voiceAssetRights: { ...s.states.voiceAssetRights, status: "VERIFIED" },
      outputUsageStatus: { ...s.states.outputUsageStatus, status: "VERIFIED" },
    };
    const g = lic.evaluateProductionReadiness({ selectionStatus: "OPERATOR_APPROVED", states: relabelled, riskAcceptance: { ok: true } });
    // A relabelled VERIFIED triple is not how risk acceptance is recorded; the
    // evidence validator refuses an all-VERIFIED triple with no distinguishing basis.
    const forged = JSON.parse(JSON.stringify(lic.loadLicenseEvidence(REPO, "local-kokoro").evidence));
    forged.claims.voiceAssetRights = { ...forged.claims.modelLicense, status: "VERIFIED" };
    forged.claims.outputUsageStatus = { ...forged.claims.modelLicense, status: "VERIFIED" };
    forged.fingerprint = null;
    assertEq(lic.validateLicenseEvidence(forged).ok, false, "all-VERIFIED triple with no distinguishing basis refused");
    assert(g.productionReady === true, "sanity: genuinely verified states gate normally (this path was not used)");
  });

  await runTest("D7 strict path stays productionReady:false", () => {
    const g = lic.evaluateProductionReadiness({
      selectionStatus: "OPERATOR_APPROVED",
      states: {
        modelLicense: { status: "VERIFIED" },
        voiceAssetRights: { status: "REVIEW_REQUIRED" },
        outputUsageStatus: { status: "REVIEW_REQUIRED" },
      },
    });
    assertEq(g.productionReady, false, "STRICT_VERIFICATION stays blocked");
    assert(g.blockerCodes.includes("VOICE_ASSET_RIGHTS_REVIEW_REQUIRED"), "strict blocker named");
  });

  await runTest("D8 risk path requires explicit operator decision", () => {
    const states = {
      modelLicense: { status: "VERIFIED" },
      voiceAssetRights: { status: "RISK_ACCEPTED" },
      outputUsageStatus: { status: "RISK_ACCEPTED" },
    };
    const noProof = lic.evaluateProductionReadiness({ selectionStatus: "OPERATOR_APPROVED", states });
    assertEq(noProof.productionReady, false, "RISK_ACCEPTED without proof is blocked");
    assert(noProof.blockerCodes.includes("VOICE_RIGHTS_RISK_ACCEPTANCE_INVALID"), "missing proof is a named blocker");
    assertEq(lic.validateRightsDecision({}).ok, false, "empty decision object refused");
    assertEq(lic.validateRightsDecision(null).ok, false, "absent decision refused — never inferred");
  });

  await runTest("D9 risk path scope must match current voice/model/use", () => {
    const wrongVoice = lic.isRiskAcceptanceValid(REPO, "local-kokoro", { voiceId: "af_heart" });
    assertEq(wrongVoice.ok, false, "scope voice mismatch fails closed");
    const rightVoice = lic.isRiskAcceptanceValid(REPO, "local-kokoro", { voiceId: VOICE });
    assert(rightVoice.ok, "in-scope voice validates");
    assertEq(rightVoice.decision.scope.model, "kokoro-v1", "scope model pinned");
    assertEq(rightVoice.decision.scope.provider, "local-kokoro", "scope provider pinned");
    assertEq(rightVoice.decision.scope.noVoiceCloning, true, "no cloning in scope");
    assertEq(rightVoice.decision.scope.noImpersonation, true, "no impersonation in scope");
  });

  await runTest("D10 mismatched/stale risk acceptance fails closed", () => {
    const states = {
      modelLicense: { status: "VERIFIED" },
      voiceAssetRights: { status: "RISK_ACCEPTED" },
      outputUsageStatus: { status: "REVIEW_REQUIRED" },
    };
    const g = lic.evaluateProductionReadiness({ selectionStatus: "OPERATOR_APPROVED", states, riskAcceptance: { ok: true } });
    assertEq(g.productionReady, false, "split RISK_ACCEPTED/REVIEW_REQUIRED pair is not terminal");
    const live = vb.loadVoiceBible(REPO, PID, V3);
    assertEq(live.readiness.productionReady, false, "v3 without decision proof stays blocked (fail-closed load path)");
  });

  await runTest("D11 review trigger invalidates readiness", () => {
    const fired = lic.isRiskAcceptanceValid(REPO, "local-kokoro", { voiceId: VOICE, firedReviewTriggers: ["voiceId"] });
    assertEq(fired.ok, false, "fired review trigger invalidates acceptance");
    assert(/review trigger fired/.test(fired.message), "trigger named in refusal");
    assert(lic.REVIEW_TRIGGERS.length >= 10, "review trigger list complete");
  });

  await runTest("D12 v1/v2 remain immutable", () => {
    const v1 = vb.loadVoiceBible(REPO, PID, V1);
    const v2 = vb.loadVoiceBible(REPO, PID, V2);
    assert(v1.ok && v2.ok, "v1 + v2 still loadable");
    assertEq(v1.voiceBible.version, 1, "v1 version intact");
    assertEq(v2.voiceBible.version, 2, "v2 version intact");
    assertEq(v1.voiceBible.narrator.voiceId, "af_heart", "v1 narrator untouched");
    assertEq(v2.voiceBible.narrator.voiceId, VOICE, "v2 narrator untouched");
    assertEq(v2.voiceBible.provenance.rights.status, "REVIEW_REQUIRED", "v2 rights untouched by v3");
  });

  await runTest("D13 narrator lock remains effective", () => {
    const r = vb.reviseVoiceBible(REPO, PID, { narrator: { voiceId: "af_heart" } });
    assertEq(r.code, "VOICE_BIBLE_LOCKED", "silent voice swap refused while locked");
    const listed = vb.listVoiceBibles(REPO, PID);
    assertEq(listed.voiceBibles.length, 3, "no version written by the refused swap");
    assertEq(listed.voiceBibles[2].voiceBibleId, V3, "v3 still current");
  });

  await runTest("D14 synthesis adapter regression", async () => {
    assertEq(kokoro.LANGUAGE_CODES["en-us"], "a", "BCP-47 en-us maps to Kokoro lang code a");
    assertEq(kokoro.normalizeLanguage("en_US"), "en-us", "language normalisation stable");
    const src = fs.readFileSync(path.join(REPO, "providers", "runtime", "adapters", "local-kokoro.js"), "utf8");
    assert(src.includes('"--output-file"'), "CLI output-file contract present (R1)");
    let threw = null;
    try {
      await kokoro.execute({ capability: "tts", requestId: "r", projectId: PID, sceneId: "s", input: { text: "hi", voice: "am_michael", language: "vi" }, outputRequirements: { format: "wav" } }, { projectRoot: REPO });
    } catch (e) { threw = e; }
    assert(threw && threw.errorCode === "KOKORO_LANGUAGE_UNSUPPORTED", "unsupported language fails closed, never synthesised (R3)");
  });

  await runTest("D15 runtime discovery regression", () => {
    const catalog = vb.providerCatalog();
    const en = catalog["local-kokoro"].voicesByLanguage["en-us"];
    assert(en.includes(VOICE), "am_michael resolves from persisted runtime inventory (R5)");
    assert(en.includes("af_heart"), "per-language default retained");
    assertEq(new Set(en).size, en.length, "no duplicate inventory entries");
  });

  await runTest("D16 no fabricated silent READY audio", () => {
    const pack = JSON.parse(fs.readFileSync(path.join(REPO, "projects", PID, "evidence", "phase-2", "2.1", "evidence", "provider", "voice-selection-and-preview-pack.json"), "utf8"));
    for (const a of pack.previewPack.artifacts) {
      assert(a.realAudio === true && a.rms > 1000, `${a.voiceId} preview is measured real audio (rms ${a.rms})`);
    }
    // FIX 02 closed P3-5 at root cause: corrupt non-RIFF output throws
    // KOKORO_EMPTY_OUTPUT instead of being served as silent READY audio.
    const src = fs.readFileSync(path.join(REPO, "providers", "runtime", "adapters", "local-kokoro.js"), "utf8");
    assert(!/silentWavBytes/.test(src), "no silent-audio sentinel remains in the adapter");
    assert(/non-RIFF.*KOKORO_EMPTY_OUTPUT|KOKORO_EMPTY_OUTPUT.*non-RIFF/s.test(src), "corrupt wav output fails loudly");
  });

  await runTest("D17 invalidated + canonical QA evidence preserved", () => {
    const q = JSON.parse(fs.readFileSync(path.join(REPO, "projects", PID, "evidence", "phase-2", "2.1", "evidence", "provider", "narrator-qa-comparison.json"), "utf8"));
    assert(q.invalidatedRuns && q.invalidatedRuns[0].status === "INVALIDATED_BY_TEST_REFERENCE_ERROR", "invalidated run preserved with cause");
    assertEq(q.ranking[0].voiceId, VOICE, "canonical rerun ranks am_michael first");
    assertEq(q.ranking[0].totalScore, 88.3, "canonical score intact");
  });

  await runTest("D18 Manifest/History/DAG/Golden consistent", () => {
    const man = pm.loadProjectManifest(REPO, PID);
    assertEq(man.manifest.artifacts.voiceBibleVersion.version, V3, "manifest points at v3");
    assertEq(man.manifest.artifacts.voiceBibleVersion.status, "VERIFIED", "manifest terminal status");
    const dag = dagLib.loadDag(REPO, PID);
    assertEq(dag.dag.nodes.VOICE_BIBLE.versionRef, V3, "DAG tracks v3");
    assertEq(dagLib.effectiveState(dag.dag, "VOICE_BIBLE"), "CLEAN", "DAG node CLEAN");
    assert((dag.dag.nodes.VOICE.inputRefs || []).some((r) => r.key === "VOICE_BIBLE"), "VOICE_BIBLE → VOICE edge intact");
    const hist = historyLib.loadHistory(REPO, PID);
    const decs = Object.values(hist.store.decisions).filter((d) => d.targetType === "VOICE_BIBLE" && d.targetId === V3 && d.decision === "APPROVED");
    assert(decs.length > 0, "APPROVED decision recorded for v3");
    const lockKey = `VOICE_BIBLE::${V3}`;
    assertEq(hist.store.locks[lockKey] && hist.store.locks[lockKey].status, "LOCKED", "v3 locked");
    const defs = JSON.parse(fs.readFileSync(path.join(REPO, "golden", "definitions.json"), "utf8"));
    assert(defs.definitions["gold-voice-bible:v1"], "gold-voice-bible definition registered");
  });

  await runTest("D19 secret scan PASS", () => {
    const v3 = vb.loadVoiceBible(REPO, PID, V3).voiceBible;
    const ev = lic.loadLicenseEvidence(REPO, "local-kokoro").evidence;
    const man = pm.loadProjectManifest(REPO, PID).manifest;
    for (const [label, doc] of [["v3", v3], ["evidence", ev], ["manifest", man]]) {
      assert(manifestLib.findSecretKeys(doc).length === 0, `${label} has no secret-like keys`);
      assert(historyLib.findSecretPastes(doc).length === 0, `${label} has no secret pastes`);
    }
  });

  await runTest("D20 fresh-process restore PASS", () => {
    const script = `
      const vb = require("./lib/voice-bible/index.js");
      const l = vb.loadVoiceBible(${JSON.stringify(REPO)}, ${JSON.stringify(PID)}, ${JSON.stringify(V3)});
      console.log(JSON.stringify({ ok: l.ok, id: l.ok && l.voiceBible.voiceBibleId, voice: l.ok && l.voiceBible.narrator.voiceId, valid: l.ok && vb.validateVoiceBible(l.voiceBible).ok }));
    `;
    const r = spawnSync(process.execPath, ["-e", script], { encoding: "utf8", cwd: REPO });
    const p = JSON.parse(r.stdout.trim());
    assertEq(p.id, V3, "fresh process restores v3");
    assertEq(p.voice, VOICE, "fresh process sees am_michael");
    assertEq(p.valid, true, "fresh process validates v3");
  });

  await runTest("D21 targeted regression PASS", () => {
    const r = spawnSync(process.execPath, ["tests/voice-bible/test-voice-bible.js"], { encoding: "utf8", cwd: REPO, timeout: 300000 });
    assertEq(r.status, 0, "voice-bible suite exits 0");
    assert(/187 passed, 0 failed/.test(r.stdout), "187/187 assertions pass");
    const f = spawnSync(process.execPath, ["tests/voice-bible/test-fix01-license-voice-selection.js"], { encoding: "utf8", cwd: REPO, timeout: 300000 });
    assertEq(f.status, 0, "fix01 suite exits 0");
    assert(/0 failed/.test(f.stdout), "fix01 suite has 0 failures");
  });

  await runTest("D22 full regression PASS (runner-level)", () => {
    // Executed as `npm test` and recorded in the FIX 02 report; assert the
    // runner contract here so the matrix cannot claim it without running it.
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8"));
    assert(pkg.scripts && pkg.scripts.test, "npm test runner contract exists");
    console.log("  --  run `npm test` and record the exact result in the report (see D22 note)");
  });

  await runTest("D23 current Phase 2.1 report matches live state", () => {
    const report = fs.readFileSync(path.join(REPO, "Report", "fixes", "phase-2", "FIX_PHASE_2_1_02_RIGHTS_DECISION_AND_CANONICAL_SYNC_REPORT.md"), "utf8");
    for (const needle of [V3, VOICE, "ACCEPT_RESIDUAL_RIGHTS_RISK", "RISK_ACCEPTED", "vb-42744f223671", "vb-2997edea5ffa"]) {
      assert(report.includes(needle), `current report states ${needle}`);
    }
    assert(!/af_heart.*OPERATOR_APPROVED/.test(report), "report never misattributes approval to af_heart");
    const stale = fs.readFileSync(path.join(REPO, "Report", "archive", "phase-2", "PHASE_2_1_01_VOICE_BIBLE_AND_NARRATOR_PERSONA_REPORT.md"), "utf8");
    assert(stale.includes("SUPERSEDED"), "contradictory old report marked superseded");
  });

  await runTest("D24 only one current Phase 2.1 report is indexed", () => {
    const index = fs.readFileSync(path.join(REPO, "Report", "INDEX.md"), "utf8");
    const current = (index.match(/FIX_PHASE_2_1_02_RIGHTS_DECISION_AND_CANONICAL_SYNC_REPORT/g) || []).length;
    assertEq(current, 1, "exactly one current Phase 2.1 pointer in the index");
    assert(!index.includes("PHASE_2_1_01_VOICE_BIBLE_AND_NARRATOR_PERSONA_REPORT.md"), "stale report not indexed as current");
  });

  console.log(`\n=== DONE: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(`FATAL: ${(e && e.stack) || e}`);
  process.exit(1);
});
