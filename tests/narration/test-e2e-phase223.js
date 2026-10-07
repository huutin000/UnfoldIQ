"use strict";

/**
 * Phase 2.2+2.3 — Combined bounded non-audio E2E (T35, T33 evidence, §26 perf).
 *
 * canonical Final Spoken Script (bounded validation fixture,
 * productionScriptStatus=NOT_APPLICABLE)
 *   → segment resolution → Narration Direction → pronunciation candidate
 *   resolution → provider compilation → REAL Kokoro quiet phonemization
 *   → runtime validation evidence → TTS-ready input plan.
 *
 * Proof obligations (§29): source text preserved; am_michael identity
 * inherited from the LOCKED Voice Bible v3; direction only where intended;
 * overrides only where scoped; real G2P ran; NO audio; NO Phase 2.4+ artifact.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const REPO = path.join(__dirname, "..", "..");
const ws = require(path.join(REPO, "lib", "workspace", "index.js"));
const narr = require(path.join(REPO, "lib", "narration", "index.js"));
const pron = require(path.join(REPO, "lib", "pronunciation", "index.js"));
const ttsReady = require(path.join(REPO, "lib", "tts-ready-plan.js"));
const manifestLib = require(path.join(REPO, "lib", "project-manifest", "index.js"));
const costShared = require(path.join(REPO, "lib", "output-cost", "shared.js"));

const PROJECT_ID = "phase223-narration-pronunciation";
const WS_REL = "projects/phase223-narration-pronunciation";
const VB_REF = "vb-19f4fd6a4596";
const EVIDENCE_DIR = path.join(REPO, WS_REL, "evidence", "phase-2", "2.2-2.3");

// Hoisted canonical inputs (assigned at the top of main()).
let script = null;
let vbDoc = null;
let scriptBytesBefore = null;
let profile = null;
let nd = null;
let pass = null;
let plan = null;

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
  const perf = {};

  await runTest("E2E-0 validation workspace registered + resolvable", () => {
    const p = ws.getProject(REPO, PROJECT_ID);
    assert(p.ok && p.entry.kind === "VALIDATION", "registered as VALIDATION");
    const root = ws.resolveProjectRoot(REPO, PROJECT_ID);
    assert(root.ok && fs.existsSync(root.path), "project root resolvable through the Workspace Resolver");
    assert(fs.existsSync(path.join(REPO, WS_REL, "input", "final-spoken-script.json")), "canonical fixture present");
  });

  // Canonical inputs (hoisted for the module-level latency helpers).
  script = JSON.parse(fs.readFileSync(path.join(REPO, WS_REL, "input", "final-spoken-script.json"), "utf8"));
  vbDoc = JSON.parse(fs.readFileSync(path.join(REPO, "projects", "phase2-1-validation", "voice", "voice-bible", `${VB_REF}.json`), "utf8"));
  scriptBytesBefore = fs.readFileSync(path.join(REPO, WS_REL, "input", "final-spoken-script.json")).toString("utf8");

  await runTest("E2E-1 Narration Direction created on canonical script (sparse, Voice Bible authoritative)", () => {
    const t0 = Date.now();
    const r = narr.createNarrationDirection(REPO, PROJECT_ID, { scriptDoc: script, voiceBible: vbDoc, directions: [
      { segmentId: "S2", emphasis: [{ text: "Kokoro", occurrence: 1, strength: "MODERATE" }], pauseIntent: [{ kind: "BEAT", afterText: "Kokoro.", occurrence: 1 }], energy: "BALANCED", emotion: "CURIOSITY", paceIntent: "MODERATE", directionReason: "key term introduction" },
      { segmentId: "S3", emotion: "INSTRUCTIVE", paceIntent: "SLOWER", energy: "BALANCED", directionReason: "names/places walkthrough" },
    ] });
    perf.narrationDirectionResolveLatencyMs = Date.now() - t0;
    assert(r.ok, `ND ready${r.replay ? " (replayed)" : ""}: ${r.ok ? "" : r.code + " " + r.message}`);
    const ndDoc = r.narrationDirection;
    assert(ndDoc.voiceBibleRef === VB_REF, "am_michael identity inherited from LOCKED Voice Bible v3 (ref, not duplication)");
    assert(ndDoc.scriptRef.scriptVersion === script.scriptVersion, "bound to canonical script version");
    assertEq(ndDoc.stats.directedSegments, 2, "direction sparse (2 of 6)");
    // Validation latency against the real Voice Bible context.
    const t1 = Date.now();
    const v = narr.validateNarrationDirection(ndDoc, { scriptDoc: script, voiceBible: vbDoc });
    perf.narrationDirectionValidateLatencyMs = Date.now() - t1;
    assert(v.ok && v.allValid, "direction validates against the real locked Voice Bible (emotional range + prohibited traits)");
  });

  await runTest("E2E-2 pronunciation profile resolved (provider-agnostic canonical state)", () => {
    const t0 = Date.now();
    const existing = pron.latestPronunciationProfile(REPO, PROJECT_ID);
    let p;
    if (existing.ok) {
      p = { ok: true, profile: existing.profile };
    } else {
      p = pron.createPronunciationProfile(REPO, PROJECT_ID, {
        language: "en-us",
        entries: [
          { displayTerm: "Reynolds", language: "en-us", category: "NAME", reading: { notation: "READ_AS", value: "RAYN-ulz" }, scope: { level: "GLOBAL_LANGUAGE" }, source: "OPERATOR_OVERRIDE", quality: "VERIFIED" },
          { displayTerm: "Kokoro", language: "en-us", category: "FOREIGN_TERM", reading: { notation: "READ_AS", value: "koh-koh-roh" }, scope: { level: "GLOBAL_LANGUAGE" }, source: "OPERATOR_OVERRIDE", quality: "VERIFIED" },
          { displayTerm: "NASA", language: "en-us", category: "ACRONYM", acronymMode: "WORD", reading: { notation: "READ_AS", value: "NASA" }, scope: { level: "GLOBAL_LANGUAGE" }, source: "CANONICAL_LEXICON", quality: "AUTO" },
          { displayTerm: "CIA", language: "en-us", category: "ACRONYM", acronymMode: "LETTER_BY_LETTER", reading: { notation: "READ_AS", value: "C.I.A." }, scope: { level: "GLOBAL_LANGUAGE" }, source: "CANONICAL_LEXICON", quality: "AUTO" },
          { displayTerm: "Reykjavik", language: "en-us", category: "PLACE_NAME", reading: { notation: "READ_AS", value: "RAYK-yah-veek" }, scope: { level: "GLOBAL_LANGUAGE" }, source: "VERIFIED_SOURCE", quality: "VERIFIED" },
          { displayTerm: "Misaki", language: "en-us", category: "DOMAIN_TERM", reading: { notation: "READ_AS", value: "mee-SAH-kee" }, scope: { level: "GLOBAL_LANGUAGE" }, source: "OPERATOR_OVERRIDE", quality: "VERIFIED" },
          { displayTerm: "UnfoldIQ", language: "en-us", category: "CUSTOM", reading: { notation: "READ_AS", value: "Unfold I Q" }, scope: { level: "GLOBAL_LANGUAGE" }, source: "OPERATOR_OVERRIDE", quality: "VERIFIED" },
        ],
        provenance: { source: "phase-2.2-2.3 validation", evidenceRefs: ["Report/phases/phase-2/PHASE_2_2_2_3_NARRATION_DIRECTION_AND_PRONUNCIATION_RUNTIME_REPORT.md"] },
      });
    }
    perf.pronunciationProfileResolveLatencyMs = Date.now() - t0;
    assert(p.ok, `profile ready: ${p.ok ? "" : p.code + " " + p.message}`);
    assert(p.profile.pronunciationProfileId.startsWith("pron-"), "canonical id (no provider markup as identity)");
    // FIX_PHASE_2_2_2_3_01 §1: native phonetic override via the OFFICIAL
    // upstream markup — Kokoro reading is the README-documented IPA
    // ([Kokoro](/kˈOkəɹO/)), source VERIFIED (official upstream docs).
    if (!p.profile.entries.some((e) => e.normalizedTerm === "kokoro" && e.reading.notation === "IPA")) {
      const rev = pron.revisePronunciationProfile(REPO, PROJECT_ID, {
        upsertEntries: [{
          displayTerm: "Kokoro", language: "en-us", category: "FOREIGN_TERM",
          reading: { notation: "IPA", value: "kˈOkəɹO" },
          scope: { level: "GLOBAL_LANGUAGE" },
          source: "VERIFIED_SOURCE", quality: "VERIFIED",
          provenance: { origin: "hexgrad/kokoro official README example [Kokoro](/kˈOkəɹO/)" },
        }],
      });
      assert(rev.ok, `native IPA override revised: ${rev.ok ? "" : rev.code + " " + rev.message}`);
      p = { ok: true, profile: rev.profile };
    }
  });

  profile = pron.latestPronunciationProfile(REPO, PROJECT_ID).profile;
  nd = narr.latestNarrationDirection(REPO, PROJECT_ID).narrationDirection;

  await runTest("E2E-3 REAL Kokoro quiet phonemization runtime pass", () => {
    const t0 = Date.now();
    const r = pron.runPronunciationPass(REPO, PROJECT_ID, {
      scriptDoc: script,
      voiceBibleRef: VB_REF,
      profileId: profile.pronunciationProfileId,
      provider: "local-kokoro",
      providerModel: "kokoro-v1",
    }, { runtimeEvidenceRef: "evidence/phase-2/2.2-2.3/runtime/quiet-phonemization-evidence.json" });
    perf.pronunciationRuntimePhonemizeLatencyMs = Date.now() - t0;
    assert(r.ok, `runtime pass ok: ${r.ok ? "" : r.code + " " + r.message}`);
    pass = r.pass;
    assert(r.code === "IDEMPOTENT_REPLAY" || pass.segments.every((s) => s.runtimePhonemeHash), "runtime phoneme hashes present (real G2P ran)");
    assertEq(pass.providerLanguageCode, "a", "en-us → Kokoro language code mapping recorded");
    for (const s of pass.segments) {
      assert(["CLEAN", "OVERRIDE_APPLIED", "REVIEW_REQUIRED"].includes(s.status), `${s.segmentId}: ${s.status}`);
      assert(s.sourceTextHash === narr.segmentHash(script.segments.find((x) => x.segmentId === s.segmentId).text), `${s.segmentId} hash bound to exact spoken text`);
    }
  });

  await runTest("E2E-4 TTS-ready input plan produced (no audio, no Phase 2.4 artifacts)", () => {
    const t0 = Date.now();
    const r = ttsReady.buildTtsReadyPlan(REPO, PROJECT_ID, { scriptDoc: script, narrationDirectionDoc: nd, passDoc: pass, voiceBibleRef: VB_REF, provider: "local-kokoro", providerModel: "kokoro-v1" });
    perf.ttsReadyPlanLatencyMs = Date.now() - t0;
    assert(r.ok, `plan ok: ${r.ok ? "" : r.code + " " + r.message}`);
    plan = r.plan;
    assert(plan.overall === "READY_FOR_TTS", `overall READY_FOR_TTS (got ${plan.overall})`);
    // FIX_PHASE_2_2_2_3_01 §2: production TTS machine-readably blocked — the
    // source is a bounded validation fixture, NOT a canonical Final Spoken Script.
    assertEq(plan.productionTtsBlocked, true, "productionTtsBlocked=true (fixture, not canonical FSS)");
    assertEq(plan.provenance.productionScriptStatus, "NOT_APPLICABLE", "productionScriptStatus copied from source script");
    for (const s of plan.segments) {
      assert(s.speakerId === "narrator", `${s.segmentId} speaker narrator`);
      assert(s.readyForTts === true, `${s.segmentId} ready`);
      assert(s.directionRef === null || s.directionRef.startsWith(nd.narrationDirectionId), `${s.segmentId} direction ref only where directed`);
      assert(!("audioPath" in s), "no audio path stored");
    }
  });

  await runTest("E2E-5 Manifest + DAG integration (index refs only, real nodes only)", () => {
    const a1 = narr.attachManifestReference(REPO, PROJECT_ID, nd.narrationDirectionId, { scriptDoc: script, voiceBible: vbDoc });
    assert(a1.ok && a1.manifestStatus === "VERIFIED", "ND manifest ref VERIFIED");
    const a2 = pron.attachManifestReference(REPO, PROJECT_ID, "profile", profile.pronunciationProfileId);
    assert(a2.ok, "profile manifest ref attached");
    const a3 = pron.attachManifestReference(REPO, PROJECT_ID, "pass", pass.pronunciationPassId);
    assert(a3.ok && a3.manifestStatus === "VERIFIED", "pass manifest ref VERIFIED");
    const a4 = ttsReady.attachManifestReference(REPO, PROJECT_ID, plan.ttsReadyPlanId);
    assert(a4.ok && a4.manifestStatus === "UNRESOLVED", "tts-ready plan manifest UNRESOLVED (production TTS blocked for non-canonical script)");
    const m = manifestLib.loadProjectManifest(REPO, PROJECT_ID).manifest;
    assert(m.schemaVersion === "1.5.0", "manifest schema 1.5.0");
    assert(m.artifacts.narrationDirectionVersion.version === nd.narrationDirectionId, "manifest indexes ND by id");
    assert(m.artifacts.pronunciationRuntimePassVersion.version === pass.pronunciationPassId, "manifest indexes pass by id");
    assert(m.artifacts.pronunciationProfileVersion.version === profile.pronunciationProfileId, "manifest indexes the current profile version");
    assert(m.artifacts.ttsReadyPlanVersion.detail.includes("PRODUCTION_TTS_BLOCKED"), "manifest detail records the production block");
    assert(!JSON.stringify(m).includes("phonemes"), "manifest carries no phoneme streams");
    // DAG nodes (real dependencies only); versionRef advances with new versions.
    const d1 = narr.registerDagNode(REPO, PROJECT_ID, nd.narrationDirectionId);
    assert(d1.ok, "ND DAG node");
    const d2 = pron.registerDagNodes(REPO, PROJECT_ID, { profileId: profile.pronunciationProfileId, passId: pass.pronunciationPassId });
    assert(d2.ok, "pronunciation DAG nodes");
    const dagNow = require(path.join(REPO, "lib", "dependency-dag", "index.js")).loadDag(REPO, PROJECT_ID).dag;
    assertEq(dagNow.nodes.PRONUNCIATION_PROFILE.versionRef, profile.pronunciationProfileId, "profile node versionRef current");
    assertEq(dagNow.nodes.PRONUNCIATION_RUNTIME_PASS.versionRef, pass.pronunciationPassId, "pass node versionRef current");
    const d3 = ttsReady.registerDagNode(REPO, PROJECT_ID, plan.ttsReadyPlanId);
    assert(d3.ok, "plan DAG node");
    const dagAfterPlan = require(path.join(REPO, "lib", "dependency-dag", "index.js")).loadDag(REPO, PROJECT_ID).dag;
    assertEq(dagAfterPlan.nodes.TTS_READY_PLAN.versionRef, plan.ttsReadyPlanId, "plan node versionRef current");
  });

  await runTest("E2E-6 §29 proof obligations: text preserved, no audio, no Phase 2.4+", () => {
    const after = fs.readFileSync(path.join(REPO, WS_REL, "input", "final-spoken-script.json")).toString("utf8");
    assertEq(after, scriptBytesBefore, "source script bytes unchanged through the whole E2E");
    // No audio files anywhere in the workspace.
    const hits = [];
    const walk = (dir) => {
      for (const f of fs.readdirSync(dir)) {
        const p = path.join(dir, f);
        if (fs.statSync(p).isDirectory()) walk(p);
        else if ([".wav", ".mp3", ".flac", ".ogg", ".m4a"].includes(path.extname(f).toLowerCase())) hits.push(p);
      }
    };
    walk(path.join(REPO, WS_REL));
    assertEq(hits.length, 0, "zero audio files");
    const m = manifestLib.loadProjectManifest(REPO, PROJECT_ID).manifest;
    assert(m.artifacts.finalAudioVersion.status === "NOT_CREATED_YET", "final audio NOT_CREATED_YET (no Phase 2.4 fabrication)");
    assert(m.artifacts.alignmentVersion.status === "NOT_CREATED_YET", "forced alignment NOT_CREATED_YET");
    assert(m.artifacts.timelineVersion.status === "NOT_CREATED_YET", "timeline NOT_CREATED_YET");
  });

  await runTest("E2E-7 performance baseline + runtime evidence persisted", () => {
    perf.pronunciationCompileLatencyMs = measureCompileLatency();
    perf.localizedInvalidationPlanLatencyMs = measureInvalidationLatency();
    perf.segmentCount = script.segments.length;
    perf.candidateTermCount = pron.detectCandidates(script.segments.map((s) => s.text).join(" ")).length;
    perf.overrideCount = profile.entries.length;
    perf.phonemeOutputCount = pass.segments.filter((s) => s.runtimePhonemeHash).length;
    perf.coldWarm = "cold batch included one real python cold start; R9 second pass in tests/pronunciation/test-pronunciation-runtime.js provides the warm comparison";
    const dir = path.join(EVIDENCE_DIR, "performance");
    fs.mkdirSync(dir, { recursive: true });
    const doc = { phase: "2.2-2.3", measuredAt: new Date().toISOString(), unit: "ms unless noted", ...perf, note: "local runtime only; no final TTS synthesis benchmarked" };
    fs.writeFileSync(path.join(dir, "performance-baseline.json"), JSON.stringify(doc, null, 2) + "\n", "utf8");
    // Bounded raw phonemization evidence (RETENTION_MANAGED).
    const evDir = path.join(EVIDENCE_DIR, "runtime");
    fs.mkdirSync(evDir, { recursive: true });
    const batch = require(path.join(REPO, "providers", "runtime", "kokoro-phonemize.js")).phonemizeBatch(
      script.segments.map((s, i) => ({ index: i, text: s.text, language: "en-us" }))
    );
    const evidence = { capturedAt: new Date().toISOString(), runtimeMode: "QUIET_PHONEMIZATION", modelLoaded: false, audioGenerated: false, records: batch.results.map((r) => ({ index: r.index, graphemes: r.graphemes, phonemes: r.phonemes })) };
    fs.writeFileSync(path.join(evDir, "quiet-phonemization-evidence.json"), JSON.stringify(evidence, null, 2) + "\n", "utf8");
    assert(fs.existsSync(path.join(dir, "performance-baseline.json")), "perf baseline written");
    assert(fs.existsSync(path.join(evDir, "quiet-phonemization-evidence.json")), "runtime evidence written");
  });

  console.log(`\n=== DONE: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
  console.log("PHASE_2_2_2_3_E2E: PASS");
  process.exit(0);
}

function measureCompileLatency() {
  const t0 = Date.now();
  const kokoroPhonemize = require(path.join(REPO, "providers", "runtime", "kokoro-phonemize.js"));
  kokoroPhonemize.compileInput({ text: script.segments[4].text, entries: profile.entries.filter((e) => ["Misaki", "UnfoldIQ"].includes(e.displayTerm)) });
  return Date.now() - t0;
}

function measureInvalidationLatency() {
  const entry = profile.entries.find((e) => e.displayTerm === "Kokoro");
  const t0 = Date.now();
  pron.planInvalidation(REPO, PROJECT_ID, { passId: pass.pronunciationPassId, changedEntryId: entry.entryId, reason: "e2e latency measurement" });
  return Date.now() - t0;
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
