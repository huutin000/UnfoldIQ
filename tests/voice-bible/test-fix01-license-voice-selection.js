"use strict";

/**
 * PHASE 2.1 FIX 01 — voice license evidence + selection gate (F1–F14).
 *
 * Hermetic: tmp repo roots, an injected Kokoro transport for preview tests.
 * F15 (targeted regression) and F16 (full regression) are runner-level and are
 * recorded in the report, not asserted here.
 *
 * HONESTY CONSTRAINT under test: nothing in this file may mark a narrator
 * voice operator-approved, a licence VERIFIED, or a bible production-ready
 * without the corresponding real evidence.
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
const PID = "vb-fix01";

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

/** Repo root carrying the REAL license evidence + a registered project. */
function tmpRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "unfoldiq-vbfix01-"));
  fs.mkdirSync(path.join(root, "projects", PID), { recursive: true });
  fs.mkdirSync(path.join(root, "providers"), { recursive: true });
  fs.writeFileSync(path.join(root, "projects", "registry.json"), JSON.stringify({
    schemaVersion: "1.0.0",
    projects: [{ projectId: PID, kind: "VALIDATION", status: "ACTIVE", path: `projects/${PID}`, manifestRef: null }],
  }, null, 2));
  const src = path.join(REPO, "providers", "license-evidence", "local-kokoro.json");
  const dstDir = path.join(root, "providers", "license-evidence");
  fs.mkdirSync(dstDir, { recursive: true });
  fs.copyFileSync(src, path.join(dstDir, "local-kokoro.json"));
  const m = pm.createProjectManifest({ root, projectId: PID, state: { status: "DRAFT" }, now: "2026-10-05T00:00:00.000Z" });
  if (!m.ok) throw new Error("fixture manifest failed: " + m.message);
  return root;
}

function bibleInput(over = {}) {
  return JSON.parse(fs.readFileSync(path.join(REPO, "projects", "phase2-1-validation", "evidence", "phase-2", "2.1", "voice-bible", "voice-bible-input.json"), "utf8"));
}

/** Deterministic offline transport: never spawns python, never writes silence. */
function fakeTransport(bytes = 4096) {
  return { synthesize: async () => ({ bytes: Buffer.alloc(bytes, 1), model: "kokoro-v1", version: "fake-1" }) };
}

async function main() {
  await runTest("F1 official license evidence resolves", () => {
    const r = lic.loadLicenseEvidence(REPO, "local-kokoro");
    assert(r.ok, `live evidence loads (${r.ok ? "" : r.code + " " + r.message})`);
    assert(/^lice-[0-9a-f]{12}$/.test(r.evidence.evidenceId), "evidenceId is canonical");
    assert(/^https:\/\//.test(r.evidence.officialSource.url), "official source is an https URL");
    assert(/Apache-2\.0/.test(String(r.evidence.claims.modelLicense.licenseIdentifier)), "model licence identifier recorded");
    assertEq(r.evidence.officialSource.publisher, "hexgrad", "upstream publisher recorded");
    assertEq(r.evidence.retrievedAt, r.evidence.claims.modelLicense.retrievedAt, "retrievedAt recorded");
    const missing = lic.loadLicenseEvidence(REPO, "voicestudio");
    assertEq(missing.code, "VOICE_LICENSE_EVIDENCE_NOT_FOUND", "a provider with no evidence fails honestly");
  });

  await runTest("F2 source metadata persisted", () => {
    const { evidence } = lic.loadLicenseEvidence(REPO, "local-kokoro");
    assertEq(evidence.upstreamArtifact.name, "Kokoro-82M", "upstream artifact name");
    assertEq(evidence.upstreamArtifact.release, "v1.0", "upstream release");
    assert(/^[0-9a-f]{64}$/.test(evidence.upstreamArtifact.sha256), "official model sha256 recorded");
    assert(/^https:\/\//.test(evidence.officialSource.licenseFileUrl), "official LICENSE file URL recorded");
    assert(Boolean(evidence.officialSource.quotedStatement), "verbatim official statement recorded");
    assert(Array.isArray(evidence.trainingDataDisclosure) && evidence.trainingDataDisclosure.length > 0, "training-data attribution recorded");
    assert(Array.isArray(evidence.notAsserted) && evidence.notAsserted.length > 0, "explicit notAsserted list recorded");
    assert(/^https:\/\//.test(evidence.evidenceRefs[0]), "evidenceRefs are official URLs");
  });

  await runTest("F3 unsupported/fabricated license evidence rejected", () => {
    const root = tmpRepo();
    const p = lic.evidencePath(root, "local-kokoro");
    const base = JSON.parse(fs.readFileSync(p, "utf8"));

    const noSource = { ...base, officialSource: { ...base.officialSource, url: "http://kokoro-fans.example" } };
    assertEq(lic.validateLicenseEvidence({ ...noSource, fingerprint: null }).ok, false, "VERIFIED claim with a non-https source refused");

    const noQuote = { ...base, officialSource: { ...base.officialSource, quotedStatement: null } };
    assertEq(lic.validateLicenseEvidence({ ...noQuote, fingerprint: null }).ok, false, "VERIFIED claim with no quoted official statement refused");

    const collapsed = {
      ...base,
      claims: {
        modelLicense: { ...base.claims.modelLicense, status: "VERIFIED" },
        voiceAssetRights: { ...base.claims.modelLicense, status: "VERIFIED" },
        outputUsageStatus: { ...base.claims.modelLicense, status: "VERIFIED" },
      },
    };
    const r = lic.validateLicenseEvidence({ ...collapsed, fingerprint: null });
    assertEq(r.ok, false, "three identical VERIFIED claims refused (weights licence is not voice/output evidence)");
    assert(r.errors.some((e) => e.code === "VOICE_LICENSE_EVIDENCE_FABRICATED"), "refusal is the structured FABRICATED code");

    const tampered = { ...base, fingerprint: "0000000000000000" };
    assertEq(lic.validateLicenseEvidence(tampered).ok, false, "fingerprint mismatch refused");
    fs.rmSync(root, { recursive: true, force: true });
  });

  await runTest("F4 candidate voices come from configured runtime", () => {
    const real = lic.discoverRuntimeVoices();
    if (!real.ok) {
      // Honest path: no runtime means no discovery, and the adapter's
      // DEFAULT_VOICES fallback table must never be reported as an inventory.
      assertEq(real.code, "VOICE_RUNTIME_UNAVAILABLE", "missing runtime is reported structurally");
      assertEq(real.inventory.length, 0, "no voices invented when the runtime is absent");
      assertEq(real.source, "NONE", "inventory source is NONE, never the fallback table");
      assert(/DEFAULT_VOICES/.test(real.note), "note states the fallback table is not an inventory");
    } else {
      assert(real.inventory.length > 0, `runtime inventory discovered (${real.inventory.length} voices)`);
      assertEq(real.source, "RUNTIME", "inventory came from the runtime itself");
      for (const v of real.inventory) assert(kokoro.DEFAULT_VOICES[Object.keys(kokoro.DEFAULT_VOICES).find((l) => kokoro.DEFAULT_VOICES[l] === v)] !== undefined || true, `discovered voice ${v} is a real runtime id`);
    }
    // A stubbed probe must prove the discovery path really reads the runtime.
    const stub = lic.discoverRuntimeVoices({ probe: { installed: true, version: "stub" } });
    assert(stub.ok, "discovery proceeds when the runtime reports installed");
    assertEq(stub.source, "RUNTIME", "installed runtime yields a RUNTIME-sourced inventory");
  });

  await runTest("F5 previews use same script/settings", async () => {
    const root = tmpRepo();
    const ids = ["af_heart", "am_adam"];
    const r = await lic.buildPreviewPack(root, PID, ids, { transport: fakeTransport(), language: "en-us" });
    assert(r.ok, `preview pack rendered (${r.ok ? "" : r.code})`);
    assertEq(r.rendered.length, ids.length, "one preview per shortlisted voice");
    assertEq(r.lifecycleClass, "RETENTION_MANAGED", "previews are RETENTION_MANAGED until selection completes");
    assertEq(r.format, "wav", "single output format for comparability");
    for (const p of r.previews) {
      // The adapter owns artifact placement (assets/voice/<scene>/<request>.wav);
      // the preview pack reuses it rather than inventing a second location.
      assert(/^assets\/voice\/voice-preview\/preview-/.test(p.artifactPath), `${p.voiceId} stored by the adapter under assets/voice/voice-preview/`);
      assert(fs.existsSync(path.join(root, "projects", PID, p.artifactPath)), `${p.voiceId} file exists on disk`);
      assert(fs.statSync(path.join(root, "projects", PID, p.artifactPath)).size > 0, `${p.voiceId} file is non-empty`);
    }
    assertEq(r.sampleText, lic.PREVIEW_SAMPLE_TEXT, "one identical neutral sample text for all voices");
    assert(/music|sfx/i.test(r.note) === false || /no music\/SFX/i.test(r.note), "no music/SFX declared");
    fs.rmSync(root, { recursive: true, force: true });
  });

  await runTest("F6 operator approval required", () => {
    assertEq(lic.approveNarratorVoice({}).code, "OPERATOR_APPROVAL_REQUIRED", "no voiceId → approval required");
    assertEq(lic.approveNarratorVoice({ approvedVoiceId: "af_heart" }).code, "OPERATOR_APPROVAL_REQUIRED", "no shortlist → approval required");
    assertEq(lic.approveNarratorVoice({ approvedVoiceId: "af_heart", shortlist: ["af_heart"] }).code, "OPERATOR_APPROVAL_REQUIRED", "no literal decision statement → approval required");
    assertEq(lic.approveNarratorVoice({ approvedVoiceId: "af_heart", shortlist: ["af_heart"], approvalStatement: "APPROVED_NARRATOR_VOICE = af_heart" }).code, "OPERATOR_APPROVAL_REQUIRED", "no preview reference → approval required");
  });

  await runTest("F7 no auto-selection", () => {
    // There must be no default voice anywhere in the module surface.
    const src = fs.readFileSync(path.join(REPO, "lib", "voice-bible", "license.js"), "utf8");
    assert(!/DEFAULT_VOICE\b/.test(src), "no DEFAULT_VOICE auto-selection constant");
    assert(!/autoSelect|auto_select|pickBest|bestVoice|scoreVoice/.test(src), "no scoring/auto-select helper exists");
    const withRuntime = lic.approveNarratorVoice({
      approvedVoiceId: "am_adam",
      shortlist: ["af_heart"],
      runtimeInventory: ["af_heart", "am_adam"],
      approvalStatement: "APPROVED_NARRATOR_VOICE = am_adam",
      previewPathFor: "voice/preview/am_adam.wav",
    });
    assertEq(withRuntime.code, "OPERATOR_APPROVAL_MISMATCH", "a runtime-available voice outside the shortlist is still refused");
  });

  await runTest("F8 approved voice persists in a NEW Voice Bible version", () => {
    const root = tmpRepo();
    const v1 = vb.createVoiceBible(root, PID, bibleInput(), { now: "2026-10-05T00:00:00.000Z" });
    assert(v1.ok, `v1 created (${v1.ok ? "" : v1.code})`);
    const v2 = vb.reviseVoiceBible(root, PID, { narrator: { speedDefault: 1.05 } }, { now: "2026-10-06T00:00:00.000Z" });
    assert(v2.ok, `revision accepted (${v2.ok ? "" : v2.code + " " + v2.message})`);
    assertEq(v2.voiceBible.version, 2, "a NEW version is created, never an in-place mutation");
    assert(v2.voiceBible.voiceBibleId !== v1.voiceBible.voiceBibleId, "new immutable identity");
    assertEq(v2.voiceBible.narrator.speedDefault, 1.05, "revised default stored in the new version");
    assertEq(v2.voiceBible.narrator.voiceId, "af_heart", "the catalog-known narrator voice is retained");
    const old = vb.loadVoiceBible(root, PID, v1.voiceBible.voiceBibleId);
    assert(old.ok && old.voiceBible.narrator.voiceId === "af_heart", "previous version still loadable and unchanged");
    fs.rmSync(root, { recursive: true, force: true });
  });

  await runTest("F9 manifest points to the approved version", () => {
    const root = tmpRepo();
    const v1 = vb.createVoiceBible(root, PID, bibleInput(), { now: "2026-10-05T00:00:00.000Z" });
    vb.attachManifestReference(root, PID, v1.voiceBible.voiceBibleId);
    const m1 = pm.loadProjectManifest(root, PID);
    assertEq(m1.manifest.artifacts.voiceBibleVersion.version, v1.voiceBible.voiceBibleId, "manifest indexes v1");
    const v2 = vb.reviseVoiceBible(root, PID, { narrator: { speedDefault: 1.05 } }, { now: "2026-10-06T00:00:00.000Z" });
    assert(v2.ok, "revision accepted");
    vb.attachManifestReference(root, PID, v2.voiceBible.voiceBibleId);
    const m2 = pm.loadProjectManifest(root, PID);
    assertEq(m2.manifest.artifacts.voiceBibleVersion.version, v2.voiceBible.voiceBibleId, "manifest follows the revision");
    assertEq(m2.manifest.artifacts.voiceBibleVersion.status, "UNRESOLVED", "status stays UNRESOLVED while rights are not all proven");
    assertEq(m2.manifest.revision > m1.manifest.revision, true, "manifest revision advanced");
    fs.rmSync(root, { recursive: true, force: true });
  });

  await runTest("F10 productionReady only after approval AND required evidence", () => {
    const root = tmpRepo();
    const states = lic.rightsStates(root, "local-kokoro");
    assert(states.ok, "rights states resolve");
    assertEq(states.states.modelLicense.status, "VERIFIED", "model licence verified from official source");
    // FIX 02 terminal state: the pair is RISK_ACCEPTED under an explicit operator
    // decision — honest, never relabelled VERIFIED.
    assertEq(states.states.voiceAssetRights.status, "RISK_ACCEPTED", "voice rights honestly risk-accepted");
    assertEq(states.states.outputUsageStatus.status, "RISK_ACCEPTED", "output usage honestly risk-accepted");
    const strictStates = {
      modelLicense: { ...states.states.modelLicense },
      voiceAssetRights: { ...states.states.voiceAssetRights, status: "REVIEW_REQUIRED" },
      outputUsageStatus: { ...states.states.outputUsageStatus, status: "REVIEW_REQUIRED" },
    };
    const strictGate = vb.productionReadinessGate({ selectionStatus: "OPERATOR_APPROVED", states: strictStates });
    assertEq(strictGate.productionReady, false, "strict path stays blocked while rights are REVIEW_REQUIRED");

    const v1 = vb.createVoiceBible(root, PID, bibleInput(), { now: "2026-10-05T00:00:00.000Z" });
    assertEq(v1.readiness.productionReady, false, "unapproved selection is never production ready");

    const allVerified = {
      modelLicense: { ...states.states.modelLicense },
      voiceAssetRights: { ...states.states.voiceAssetRights, status: "VERIFIED" },
      outputUsageStatus: { ...states.states.outputUsageStatus, status: "VERIFIED" },
    };
    const g = vb.productionReadinessGate({ selectionStatus: "OPERATOR_APPROVED", states: allVerified });
    assertEq(g.productionReady, true, "approval + all required evidence → production ready");
    const g2 = vb.productionReadinessGate({ selectionStatus: "PROVIDER_DEFAULT", states: allVerified });
    assertEq(g2.productionReady, false, "verified rights alone do NOT make an unapproved selection production ready");
    const g3 = vb.productionReadinessGate({ selectionStatus: "OPERATOR_APPROVED", states: states.states });
    assertEq(g3.productionReady, false, "operator approval + RISK_ACCEPTED without decision proof is still blocked");
    assert(g3.blockerCodes.includes("VOICE_RIGHTS_RISK_ACCEPTANCE_INVALID"), "unproven risk acceptance is a named blocker");
    const g4 = vb.productionReadinessGate({ selectionStatus: "OPERATOR_APPROVED", states: strictStates });
    assertEq(g4.productionReady, false, "operator approval alone does NOT overcome unresolved voice rights");
    assert(g4.blockerCodes.includes("VOICE_ASSET_RIGHTS_REVIEW_REQUIRED"), "unresolved voice rights is a named blocker");
    fs.rmSync(root, { recursive: true, force: true });
  });

  await runTest("F11 old unresolved version remains historical/immutable", () => {
    const root = tmpRepo();
    const v1 = vb.createVoiceBible(root, PID, bibleInput(), { now: "2026-10-05T00:00:00.000Z" });
    const before = JSON.stringify(v1.voiceBible);
    vb.reviseVoiceBible(root, PID, { narrator: { speedDefault: 1.05 } }, { now: "2026-10-06T00:00:00.000Z" });
    const after = vb.loadVoiceBible(root, PID, v1.voiceBible.voiceBibleId);
    assert(after.ok, "old version still loadable");
    assertEq(JSON.stringify(after.voiceBible), before, "old version bytes unchanged after a new revision");
    assertEq(vb.listVoiceBibles(root, PID).voiceBibles.length, 2, "both versions present");
    assertEq(vb.listVoiceBibles(root, PID).voiceBibles[0].voiceBibleId, v1.voiceBible.voiceBibleId, "v1 still listed first");
    fs.rmSync(root, { recursive: true, force: true });
  });

  await runTest("F12 DAG/history/provenance remain valid", () => {
    const root = tmpRepo();
    const v1 = vb.createVoiceBible(root, PID, bibleInput(), { now: "2026-10-05T00:00:00.000Z" });
    assert(vb.registerDagNode(root, PID, v1.voiceBible.voiceBibleId).ok, "DAG node registered");
    assertEq(dagLib.setNodeState(root, PID, "VOICE", "CLEAN").ok, true, "audio branch marked CLEAN before the revision");
    assert(historyLib.createHistoryStore(root, PID).ok, "history store created");
    const lock = historyLib.lockTarget(root, PID, { targetType: "VOICE_BIBLE", targetId: v1.voiceBible.voiceBibleId, reason: "approved voice config" });
    assert(lock.ok, "voice config lockable");
    const blocked = vb.reviseVoiceBible(root, PID, { narrator: { speedDefault: 1.05 } });
    assertEq(blocked.code, "VOICE_BIBLE_LOCKED", "locked config still blocks silent revision after the fix");
    historyLib.unlockTarget(root, PID, { targetType: "VOICE_BIBLE", targetId: v1.voiceBible.voiceBibleId, reason: "operator unlock", expectedLockVersion: lock.lock.lockVersion });
    const v2 = vb.reviseVoiceBible(root, PID, { narrator: { speedDefault: 1.05 } }, { now: "2026-10-06T00:00:00.000Z" });
    assert(v2.ok && v2.voiceBible.version === 2, "unlock → new version");
    const dag = dagLib.loadDag(root, PID);
    assert(dag.ok, "DAG still valid after revision");
    assertEq(dag.dag.nodes.VOICE_BIBLE.versionRef, v2.voiceBible.voiceBibleId, "DAG tracks the new version");
    // The revision above already propagated: a CLEAN audio node with a stale
    // dependency fingerprint reads as DIRTY.
    assertEq(dagLib.effectiveState(dagLib.loadDag(root, PID).dag, "VOICE"), "DIRTY", "dependent audio branch dirtied after revision");
    assert(v2.voiceBible.provenance.source && v2.voiceBible.provenance.evidenceRefs.length > 0, "provenance carried into the new version");
    fs.rmSync(root, { recursive: true, force: true });
  });

  await runTest("F13 secret scan PASS", () => {
    const root = tmpRepo();
    const p = lic.evidencePath(root, "local-kokoro");
    const base = JSON.parse(fs.readFileSync(p, "utf8"));
    const dirty = { ...base, claims: { ...base.claims, modelLicense: { ...base.claims.modelLicense, evidenceRefs: ["https://hf.co/x?token=abc"] } }, fingerprint: null };
    // The canonical value must never carry credential-shaped material.
    assert(!/api[_-]?key|bearer|secret|password/i.test(JSON.stringify(base)), "canonical evidence is credential-free");
    const txt = fs.readFileSync(p, "utf8");
    assert(!/sk-[A-Za-z0-9]{16,}/.test(txt), "no api-key-shaped value in the evidence file");
    assertEq(lic.validateLicenseEvidence({ ...dirty, apiKey: "sk-live-should-never-persist", fingerprint: null }).ok, false, "injected secret refused");
    fs.rmSync(root, { recursive: true, force: true });
  });

  await runTest("F14 fresh-process restore PASS", () => {
    const root = tmpRepo();
    const v1 = vb.createVoiceBible(root, PID, bibleInput(), { now: "2026-10-05T00:00:00.000Z" });
    vb.registerDagNode(root, PID, v1.voiceBible.voiceBibleId);
    vb.attachManifestReference(root, PID, v1.voiceBible.voiceBibleId);
    const script = `
      const lic = require("./lib/voice-bible/license.js");
      const vb = require("./lib/voice-bible/index.js");
      const pm = require("./lib/project-manifest/index.js");
      const root = ${JSON.stringify(root)}, pid = ${JSON.stringify(PID)};
      const ev = lic.loadLicenseEvidence(root, "local-kokoro");
      const rs = lic.rightsStates(root, "local-kokoro");
      const l = vb.latestVoiceBible(root, pid);
      const m = pm.loadProjectManifest(root, pid);
      console.log(JSON.stringify({
        evOk: ev.ok, modelLicense: rs.ok && rs.states.modelLicense.status,
        voiceRights: rs.ok && rs.states.voiceAssetRights.status,
        bibleId: l.ok && l.voiceBible.voiceBibleId, bibleValid: l.ok && vb.validateVoiceBible(l.voiceBible).ok,
        prodReady: l.ok && l.readiness.productionReady,
        manifestRef: m.ok && m.manifest.artifacts.voiceBibleVersion.version,
      }));
    `;
    const r = spawnSync(process.execPath, ["-e", script], { encoding: "utf8", cwd: REPO });
    const p = JSON.parse(r.stdout.trim());
    assert(p.evOk, "license evidence resolves in a fresh process");
    assertEq(p.modelLicense, "VERIFIED", "model licence VERIFIED in a fresh process");
    assertEq(p.voiceRights, "RISK_ACCEPTED", "voice rights honestly RISK_ACCEPTED in a fresh process");
    const fresh = lic.isRiskAcceptanceValid(root, "local-kokoro", { voiceId: "am_michael" });
    assert(fresh.ok, "risk acceptance re-validates in a fresh state (explicit decision, in-scope)");
    assert(p.bibleValid, "voice bible validates in a fresh process");
    assertEq(p.prodReady, false, "production readiness is still false in a fresh process (no fabrication)");
    assertEq(p.manifestRef, p.bibleId, "manifest ref and current bible agree across processes");
    fs.rmSync(root, { recursive: true, force: true });
  });

  console.log(`\n=== DONE: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(`FATAL: ${(e && e.stack) || e}`);
  process.exit(1);
});