"use strict";

/**
 * PHASE 2.1 — Voice Bible + Narrator Persona verification matrix V1–V28.
 * Deterministic and hermetic: tmp repo roots with a registered project, an
 * injected Kokoro transport, and NO synthesis. No network, no python, no
 * provider calls, no credits.
 */

const os = require("os");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const vb = require("../../lib/voice-bible/index.js");
const ws = require("../../lib/workspace/index.js");
const pm = require("../../lib/project-manifest/index.js");
const historyLib = require("../../lib/generation-history/index.js");
const dagLib = require("../../lib/dependency-dag/index.js");
const telLib = require("../../lib/telemetry/index.js");
const kokoro = require("../../providers/runtime/adapters/local-kokoro.js");

const REPO = path.join(__dirname, "..", "..");
const PID = "vb-test";

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

/** Hermetic repo root with a registered project and a 1.4.0 manifest. */
function tmpRepo(opts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "unfoldiq-vb-"));
  fs.mkdirSync(path.join(root, "projects", PID), { recursive: true });
  fs.writeFileSync(path.join(root, "projects", "registry.json"), JSON.stringify({
    schemaVersion: "1.0.0",
    projects: [{ projectId: PID, kind: "VALIDATION", status: "ACTIVE", path: `projects/${PID}`, manifestRef: `projects/${PID}/manifest/project-manifest.json` }],
  }, null, 2));
  if (!opts.noManifest) {
    const m = pm.createProjectManifest({ root, projectId: PID, state: { status: "DRAFT" }, now: "2026-10-05T00:00:00.000Z" });
    if (!m.ok) throw new Error(`fixture manifest failed: ${m.message}`);
  }
  return root;
}

function bibleInput(over = {}) {
  return {
    language: "en-us",
    locale: "en-US",
    pronunciationProfileRef: "pron-ancient-humans",
    narrator: {
      personaId: "per-explainer-guide",
      displayName: "Guide",
      provider: "local-kokoro",
      model: "kokoro-v1",
      voiceId: "af_heart",
      speakingStyle: "measured explanatory narration",
      prosodyDefaults: {
        paceIntent: "MODERATE", energy: "BALANCED", pauseStyle: "NATURAL",
        sentenceFlow: "MEASURED", emphasisStyle: "SELECTIVE", emotionalBaseline: "WARM",
      },
      speedDefault: 1,
      energyDefault: "BALANCED",
      emotionalRange: ["NEUTRAL", "CURIOSITY", "CONFIDENT"],
      prohibitedTraits: ["UNNATURALLY_SLOW_CINEMATIC", "OVERACTING"],
      persona: {
        personaId: "per-explainer-guide",
        role: "GUIDE",
        audience: "curious general viewers new to the topic",
        tone: "EXPLAINING",
        energy: "BALANCED",
        paceIntent: "MODERATE",
        warmth: "WARM",
        directness: "BALANCED",
        formality: "CONVERSATIONAL",
        storytellingStyle: "EXPLAINER",
        emotionalRange: ["NEUTRAL", "CURIOSITY", "CONFIDENT"],
        prohibitedDeliveryPatterns: ["UNNATURALLY_SLOW_CINEMATIC", "OVERACTING"],
        language: "en-us",
        notes: null,
      },
    },
    characterVoices: [],
    provenance: {
      source: "OPERATOR_APPROVED",
      rights: { status: "PLATFORM_GENERATED", licenseType: "NOT_APPLICABLE", detail: null },
      evidenceRefs: ["providers/local/SETUP_KOKORO.md"],
      approvalRef: "operator-note-1",
    },
    ...over,
  };
}

function created(root, over = {}) {
  return vb.createVoiceBible(root, PID, bibleInput(over), { now: "2026-10-05T00:00:00.000Z" });
}

/** Fresh child process: proves on-disk state, not in-memory module state. */
function freshProcess(script) {
  const r = spawnSync(process.execPath, ["-e", script], { encoding: "utf8", cwd: REPO });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

async function main() {
  await runTest("V1 valid Voice Bible persists", () => {
    const root = tmpRepo();
    const r = created(root);
    assert(r.ok, `created (${r.ok ? "" : r.code + " " + r.message})`);
    assertEq(r.voiceBible.version, 1, "first version is 1");
    assert(/^vb-[0-9a-f]{12}$/.test(r.voiceBible.voiceBibleId), "voiceBibleId has canonical prefix/format");
    assert(r.rel === `voice/voice-bible/${r.voiceBible.voiceBibleId}.json`, "persisted at the canonical resolver path");
    assert(fs.existsSync(path.join(root, "projects", PID, r.rel)), "file exists on disk");
    assert(vb.validateVoiceBible(r.voiceBible).ok, "persisted doc validates");
    fs.rmSync(root, { recursive: true, force: true });
  });

  await runTest("V2 fresh process restores the same version", () => {
    const root = tmpRepo();
    const r = created(root);
    const script = `
      const vb = require("./lib/voice-bible/index.js");
      const l = vb.latestVoiceBible(${JSON.stringify(root)}, ${JSON.stringify(PID)});
      console.log(JSON.stringify({ ok: l.ok, id: l.ok && l.voiceBible.voiceBibleId, version: l.ok && l.voiceBible.version, fingerprint: l.ok && l.voiceBible.fingerprint }));
    `;
    const out = freshProcess(script);
    const parsed = JSON.parse(out.stdout.trim());
    assert(parsed.ok, "fresh process loads the bible");
    assertEq(parsed.id, r.voiceBible.voiceBibleId, "same voiceBibleId in a fresh process");
    assertEq(parsed.version, 1, "same version in a fresh process");
    assertEq(parsed.fingerprint, r.voiceBible.fingerprint, "same fingerprint in a fresh process");
    fs.rmSync(root, { recursive: true, force: true });
  });

  await runTest("V3 invalid schema rejected (fail closed)", () => {
    const root = tmpRepo();
    const missingProvider = bibleInput();
    delete missingProvider.narrator.model;
    assertEq(created(root, { narrator: { ...missingProvider.narrator, model: undefined } }).code, "VOICE_BIBLE_SCHEMA_INVALID", "missing model refused");

    const root2 = tmpRepo();
    const bad = created(root2, { narrator: { ...bibleInput().narrator, speedDefault: 145 } });
    assertEq(bad.code, "VOICE_BIBLE_SCHEMA_INVALID", "measured-wpm speedDefault refused");

    const root3 = tmpRepo();
    const persisted = created(root3);
    // A doctored file on disk must fail: buildVoiceBible filters unknown
    // fields, so the no-unknown-keys rule is proven against a hand-built doc.
    const doctored = { ...JSON.parse(JSON.stringify(persisted.voiceBible)), measuredSpeechRateWpm: 145 };
    assertEq(vb.validateVoiceBible(doctored).errors[0].code, "VOICE_BIBLE_SCHEMA_INVALID", "unknown schema key refused");
    const dropped = { ...JSON.parse(JSON.stringify(persisted.voiceBible)) };
    delete dropped.narrator.model;
    assertEq(vb.validateVoiceBible(dropped).ok, false, "missing required identity field refused");
    assert(!fs.existsSync(path.join(root, "projects", PID, "voice")), "nothing written on refusal");
    for (const r of [root, root2, root3]) fs.rmSync(r, { recursive: true, force: true });
  });

  await runTest("V4 same version is immutable", () => {
    const root = tmpRepo();
    const first = created(root);
    const again = vb.createVoiceBible(root, PID, bibleInput());
    assertEq(again.code, "VOICE_BIBLE_VERSION_CONFLICT", "second create refused");
    const listed = vb.listVoiceBibles(root, PID);
    assertEq(listed.voiceBibles.length, 1, "still exactly one version");
    assertEq(listed.voiceBibles[0].voiceBibleId, first.voiceBible.voiceBibleId, "original version untouched");
    fs.rmSync(root, { recursive: true, force: true });
  });

  await runTest("V5 same-content replay is idempotent", () => {
    const root = tmpRepo();
    created(root);
    const replay = vb.reviseVoiceBible(root, PID, { language: "en-us" }, { now: "2026-10-06T00:00:00.000Z" });
    assert(replay.ok && replay.changed === false && replay.deduped === true, "identical content → no version bump");
    assertEq(vb.listVoiceBibles(root, PID).voiceBibles.length, 1, "still one version after replay");
    fs.rmSync(root, { recursive: true, force: true });
  });

  await runTest("V6 semantic change creates a new version", () => {
    const root = tmpRepo();
    const v1 = created(root);
    const v2 = vb.reviseVoiceBible(root, PID, { narrator: { speedDefault: 1.1 } }, { now: "2026-10-06T00:00:00.000Z" });
    assert(v2.ok && v2.changed === true, "speed default change → new version");
    assertEq(v2.voiceBible.version, 2, "version advanced to 2");
    assert(v2.voiceBible.voiceBibleId !== v1.voiceBible.voiceBibleId, "new immutable identity");
    const v1Again = vb.loadVoiceBible(root, PID, v1.voiceBible.voiceBibleId);
    assert(v1Again.ok && v1Again.voiceBible.version === 1, "old version remains loadable");
    assertEq(v1Again.voiceBible.narrator.speedDefault, 1, "old version content unchanged");
    fs.rmSync(root, { recursive: true, force: true });
  });

  await runTest("V7 Kokoro selection resolves a normalized config", () => {
    const r = vb.resolveVoiceSelection({ provider: "local-kokoro", model: "kokoro-v1", voiceId: "af_heart", language: "en-us", speedDefault: 1.05 });
    assert(r.ok, `resolved (${r.ok ? "" : r.code})`);
    const s = r.selection;
    assertEq(s.provider, "local-kokoro", "provider");
    assertEq(s.model, "kokoro-v1", "model");
    assertEq(s.voiceId, "af_heart", "voiceId");
    assertEq(s.language, "en-us", "language");
    assertEq(s.providerLanguageCode, "en-us", "provider language code explicit");
    assert(s.runtimeConfig && s.runtimeConfig.capability === "tts", "runtime config is a tts request");
    assertEq(s.runtimeConfig.input.voice, "af_heart", "voice translated into runtime config");
    assertEq(s.runtimeConfig.input.language, "en-us", "language translated into runtime config");
    assertEq(s.runtimeConfig.input.speed, 1.05, "speed intent translated");
    const catalog = vb.providerCatalog();
    assertEq(Object.keys(catalog).length, 1, "catalog holds exactly the V1 provider");
    assertEq(catalog["local-kokoro"].runtimeProbe.status, "NOT_PROBED", "2.1 does not probe synthesis runtime");
  });

  await runTest("V8 unsupported provider/model fails structured", () => {
    const p = vb.resolveVoiceSelection({ provider: "voicestudio", model: "vs-v1", voiceId: "af_heart", language: "en-us" });
    assertEq(p.code, "VOICE_PROVIDER_UNSUPPORTED", "VoiceStudio (POST-V1) refused as provider");
    assert(/POST-V1/.test(p.message), "refusal explains the V1 boundary");
    const m = vb.resolveVoiceSelection({ provider: "local-kokoro", model: "kokoro-v2", voiceId: "af_heart", language: "en-us" });
    assertEq(m.code, "VOICE_MODEL_UNSUPPORTED", "unknown model refused");
    assertEq(vb.resolveVoiceSelection({ provider: "local-kokoro", model: "kokoro-v1", voiceId: "af_heart" }).code, "VOICE_CONFIGURATION_INVALID", "missing language refused");
  });

  await runTest("V9 unknown voice fails structured", () => {
    const r = vb.resolveVoiceSelection({ provider: "local-kokoro", model: "kokoro-v1", voiceId: "am_mystery", language: "en-us" });
    assertEq(r.code, "VOICE_NOT_FOUND", "unknown voice refused");
    const wrongLang = vb.resolveVoiceSelection({ provider: "local-kokoro", model: "kokoro-v1", voiceId: "bf_emma", language: "en-us" });
    assertEq(wrongLang.code, "VOICE_NOT_FOUND", "a voice of another language is not a valid voice here");
  });

  await runTest("V10 language/locale mismatch fails closed", () => {
    const unsup = vb.resolveVoiceSelection({ provider: "local-kokoro", model: "kokoro-v1", voiceId: "af_heart", language: "vi" });
    assertEq(unsup.code, "VOICE_LANGUAGE_UNSUPPORTED", "unsupported language refused (never English fallback)");
    assert(/never fallback/.test(unsup.message), "refusal states no cross-language fallback");
    const locale = vb.resolveVoiceSelection({ provider: "local-kokoro", model: "kokoro-v1", voiceId: "af_heart", language: "en-us", locale: "vi-VN" });
    assertEq(locale.code, "VOICE_LOCALE_UNSUPPORTED", "incompatible locale refused");
    const okLocale = vb.resolveVoiceSelection({ provider: "local-kokoro", model: "kokoro-v1", voiceId: "af_heart", language: "en-us", locale: "en-GB" });
    assert(okLocale.ok, "compatible locale accepted");
    const hi = vb.resolveVoiceSelection({ provider: "local-kokoro", model: "kokoro-v1", voiceId: "hf_alpha", language: "hi", locale: "hi-IN" });
    assert(hi.ok, "provider language normalization works (hi)");
    const inBible = created(tmpRepo(), { language: "vi" });
    assertEq(inBible.code, "VOICE_LANGUAGE_UNSUPPORTED", "unsupported bible language refused at creation");
  });

  await runTest("V11 speed default is not measured WPM", () => {
    const root = tmpRepo();
    const r = created(root);
    assertEq(r.voiceBible.narrator.speedDefault, 1, "speedDefault stored as a rate factor");
    assert(!("measuredSpeechRateWpm" in r.voiceBible), "no measured wpm field in the voice bible");
    assert(!JSON.stringify(r.voiceBible).includes("wordsPerMinute"), "no wpm-shaped key anywhere");
    for (const bad of [145, 0, 2.5, -1]) {
      const rr = vb.createVoiceBible(tmpRepo(), PID, bibleInput({ narrator: { ...bibleInput().narrator, speedDefault: bad } }));
      assertEq(rr.code, "VOICE_BIBLE_SCHEMA_INVALID", `speedDefault ${bad} refused`);
    }
    const inRange = created(tmpRepo(), { narrator: { ...bibleInput().narrator, speedDefault: 2.0 } });
    assert(inRange.ok, "upper bound 2.0 accepted");
    fs.rmSync(root, { recursive: true, force: true });
  });

  await runTest("V12 narrator persona validation", () => {
    const root = tmpRepo();
    const mismatch = bibleInput();
    mismatch.narrator.persona.personaId = "per-someone-else";
    assertEq(created(root, mismatch).code, "NARRATOR_PERSONA_INVALID", "personaId mismatch refused");

    const langMismatch = bibleInput();
    langMismatch.narrator.persona.language = "fr";
    assertEq(created(tmpRepo(), langMismatch).code, "NARRATOR_PERSONA_INVALID", "persona language mismatch refused");

    const outOfRange = bibleInput();
    outOfRange.narrator.persona.emotionalRange = ["NEUTRAL", "HUMOR"];
    assertEq(created(tmpRepo(), outOfRange).code, "NARRATOR_PERSONA_INVALID", "persona emotion outside narrator range refused");

    const roleRequired = bibleInput();
    delete roleRequired.narrator.persona.role;
    assertEq(created(tmpRepo(), roleRequired).code, "VOICE_BIBLE_SCHEMA_INVALID", "missing persona role refused");

    const uncontrolled = bibleInput();
    uncontrolled.narrator.persona.warmth = "VERY_WARM";
    assertEq(created(tmpRepo(), uncontrolled).code, "VOICE_BIBLE_SCHEMA_INVALID", "uncontrolled persona value refused");
    fs.rmSync(root, { recursive: true, force: true });
  });

  await runTest("V13 duplicate character speaker mapping refused", () => {
    const root = tmpRepo();
    // Kokoro documents one default voice per language, so a distinct
    // character voice is only resolvable in another language (or via the
    // documented KOKORO_VOICES override). Never invent a second en-us voice.
    const dup = bibleInput({
      characterVoices: [
        { speakerId: "CHAR_1", provider: "local-kokoro", model: "kokoro-v1", voiceId: "ef_dora", language: "es" },
        { speakerId: "CHAR_1", provider: "local-kokoro", model: "kokoro-v1", voiceId: "ff_siwis", language: "fr" },
      ],
    });
    const r = vb.createVoiceBible(root, PID, dup);
    assertEq(r.code, "CHARACTER_VOICE_CONFLICT", "duplicate speakerId refused");

    const narratorEcho = bibleInput({
      characterVoices: [{ speakerId: "CHAR_1", provider: "local-kokoro", model: "kokoro-v1", voiceId: "af_heart", language: "en-us" }],
    });
    assertEq(vb.createVoiceBible(tmpRepo(), PID, narratorEcho).code, "CHARACTER_VOICE_CONFLICT", "character reusing the narrator voice refused");

    const unknownVoice = bibleInput({
      characterVoices: [{ speakerId: "CHAR_1", provider: "local-kokoro", model: "kokoro-v1", voiceId: "am_mystery", language: "es" }],
    });
    assertEq(vb.createVoiceBible(tmpRepo(), PID, unknownVoice).code, "VOICE_NOT_FOUND", "unknown character voice refused");
    fs.rmSync(root, { recursive: true, force: true });
  });

  await runTest("V14 empty character voices is valid", () => {
    const root = tmpRepo();
    const r = created(root);
    assert(Array.isArray(r.voiceBible.characterVoices), "characterVoices is an array");
    assertEq(r.voiceBible.characterVoices.length, 0, "empty character voice list is valid");
    const withOne = vb.createVoiceBible(tmpRepo(), PID, bibleInput({
      characterVoices: [{ speakerId: "CHAR_1", provider: "local-kokoro", model: "kokoro-v1", voiceId: "ef_dora", language: "es" }],
    }));
    assert(withOne.ok, `a single optional character voice is valid (${withOne.ok ? "" : withOne.code + " " + withOne.message})`);
    fs.rmSync(root, { recursive: true, force: true });
  });

  await runTest("V15 pronunciationProfileRef validation", () => {
    const root = tmpRepo();
    assertEq(created(root).voiceBible.pronunciationProfileRef, "pron-ancient-humans", "reference stored");
    assertEq(created(tmpRepo(), { pronunciationProfileRef: null }).voiceBible.pronunciationProfileRef, null, "null reference is valid (no profile yet)");
    assertEq(created(tmpRepo(), { pronunciationProfileRef: "en-us" }).code, "PRONUNCIATION_PROFILE_INVALID", "bare language code refused as a profile ref");
    assertEq(created(tmpRepo(), { pronunciationProfileRef: "profile-1" }).code, "PRONUNCIATION_PROFILE_INVALID", "well-shaped but non-canonical ref refused semantically");
    assertEq(created(tmpRepo(), { pronunciationProfileRef: "PRON_Anthropology" }).code, "VOICE_BIBLE_SCHEMA_INVALID", "malformed ref shape refused by the schema");
    assertEq(vb.validateVoiceBible({ ...created(tmpRepo(), { pronunciationProfileRef: "pron-ancient-humans" }).voiceBible, fingerprint: null }).ok, false, "tampered fingerprint still fails closed");
    fs.rmSync(root, { recursive: true, force: true });
  });

  await runTest("V16 Manifest reference is correct", () => {
    const root = tmpRepo();
    const r = created(root);
    const attached = vb.attachManifestReference(root, PID, r.voiceBible.voiceBibleId);
    assert(attached.ok, `manifest updated (${attached.ok ? "" : attached.code + " " + attached.message})`);
    const m = pm.loadProjectManifest(root, PID);
    const ref = m.manifest.artifacts.voiceBibleVersion;
    assertEq(ref.version, r.voiceBible.voiceBibleId, "manifest indexes the current voice bible");
    assertEq(ref.status, "VERIFIED", "status VERIFIED for an approved+resolved bible");
    assertEq(ref.ref, `voice/voice-bible/${r.voiceBible.voiceBibleId}.json`, "manifest ref points at the file");
    assert(!JSON.stringify(m.manifest).includes("personaId"), "manifest stays an index, never the bible body");

    // A perf/readiness probe must never upgrade an UNRESOLVED reference to a
    // false VERIFIED: the measured write must be byte-identical to current.
    const unresolvedRoot = tmpRepo();
    const unresolved = created(unresolvedRoot, {
      provenance: { source: "PROVIDER_DEFAULT", rights: { status: "UNRESOLVED", licenseType: "UNRESOLVED" }, evidenceRefs: [] },
    });
    assertEq(vb.attachManifestReference(unresolvedRoot, PID, unresolved.voiceBible.voiceBibleId).manifestStatus, "UNRESOLVED", "unresolved bible indexes as UNRESOLVED");
    const before = pm.loadProjectManifest(unresolvedRoot, PID).manifest;
    const perf = vb.measureBaseline(unresolvedRoot, PID, { iterations: 3 });
    const after = pm.loadProjectManifest(unresolvedRoot, PID).manifest;
    assert(perf.ok && String(perf.manifestMutation).startsWith("none"), "perf probe reports a non-mutating measurement");
    assert(perf.ops.voiceBibleWriteLatencyMs !== null, "write latency was measured");
    assert(perf.ops.manifestReferenceUpdateLatencyMs !== null, "manifest reference latency was measured");
    assertEq(after.artifacts.voiceBibleVersion.status, "UNRESOLVED", "perf probe cannot upgrade an UNRESOLVED status to VERIFIED");
    assertEq(after.revision, before.revision, "perf probe performs no manifest write at all");
    assertEq(after.artifacts.voiceBibleVersion.detail, before.artifacts.voiceBibleVersion.detail, "perf probe leaves the honest detail untouched");
    fs.rmSync(unresolvedRoot, { recursive: true, force: true });

    const revised = vb.reviseVoiceBible(root, PID, { narrator: { speedDefault: 1.05 } });
    vb.attachManifestReference(root, PID, revised.voiceBible.voiceBibleId);
    const m2 = pm.loadProjectManifest(root, PID);
    assertEq(m2.manifest.artifacts.voiceBibleVersion.version, revised.voiceBible.voiceBibleId, "manifest follows the revision");
    fs.rmSync(root, { recursive: true, force: true });
  });

  await runTest("V17 revision dirties only the dependent audio branch", () => {
    const root = tmpRepo();
    const r = created(root);
    assert(vb.registerDagNode(root, PID, r.voiceBible.voiceBibleId).ok, "VOICE_BIBLE node registered");
    const dag0 = dagLib.loadDag(root, PID).dag;
    assertEq(dag0.nodes.VOICE_BIBLE.state, "CLEAN", "node is CLEAN, never a bare future-class placeholder");
    assertEq(dag0.nodes.VOICE_BIBLE.producedBy, "phase-2.1:voice-bible", "producedBy recorded");
    assertEq(dag0.nodes.VOICE_BIBLE.provenance, "LIVE", "provenance recorded");
    assert(dag0.nodes.VOICE_BIBLE.lockTarget && dag0.nodes.VOICE_BIBLE.lockTarget.targetType === "VOICE_BIBLE", "lockTarget attached (else lock-aware invalidation silently opts out)");
    assertEq(dag0.nodes.VOICE_BIBLE.versionRef, r.voiceBible.voiceBibleId, "versionRef is the current bible id");
    assertEq(dag0.nodes.VOICE.inputRefs.some((x) => x.key === "VOICE_BIBLE"), true, "real edge VOICE_BIBLE → VOICE");

    // Bootstrap on a project that ALREADY has a voice bible must produce a real
    // node from disk evidence, not a NOT_CREATED_YET placeholder.
    const preBoot = tmpRepo();
    const pre = created(preBoot);
    fs.rmSync(path.join(preBoot, "projects", PID, "dependency-dag.json"), { force: true });
    const reBoot = dagLib.bootstrapDag(preBoot, PID);
    assert(reBoot.ok, "re-bootstrap after removing the graph succeeds");
    const probed = dagLib.loadDag(preBoot, PID).dag.nodes.VOICE_BIBLE;
    assertEq(probed.state, "CLEAN", "evidence probe marks the existing bible CLEAN");
    assertEq(probed.versionRef, pre.voiceBible.voiceBibleId, "evidence probe derives the current versionRef from disk");
    fs.rmSync(preBoot, { recursive: true, force: true });

    for (const k of ["RESEARCH_PACK", "CREATIVE_BRIEF"]) {
      assertEq(dagLib.setNodeState(root, PID, k, "CLEAN").ok, true, `${k} marked CLEAN`);
    }
    assertEq(dagLib.setNodeState(root, PID, "VOICE", "CLEAN").ok, true, "VOICE marked CLEAN");

    vb.reviseVoiceBible(root, PID, { narrator: { speedDefault: 1.1 } });
    const after = dagLib.loadDag(root, PID).dag;
    assertEq(dagLib.effectiveState(after, "VOICE"), "DIRTY", "dependent audio branch is DIRTY");
    assertEq(dagLib.effectiveState(after, "RESEARCH_PACK"), "CLEAN", "unrelated research branch stays CLEAN");
    assertEq(dagLib.effectiveState(after, "CREATIVE_BRIEF"), "CLEAN", "unrelated creative branch stays CLEAN");
    const plan = dagLib.planRebuild(root, PID);
    assertEq(plan.plan.rebuild.includes("VOICE"), true, "rebuild plan lists the audio branch");
    assertEq(plan.plan.reuse.includes("RESEARCH_PACK"), true, "rebuild plan reuses unaffected artifacts");
    fs.rmSync(root, { recursive: true, force: true });
  });

  await runTest("V18 lock integration prevents silent mutation", () => {
    const root = tmpRepo();
    const r = created(root);
    assert(historyLib.createHistoryStore(root, PID).ok, "history store created");
    const locked = historyLib.lockTarget(root, PID, {
      targetType: "VOICE_BIBLE",
      targetId: r.voiceBible.voiceBibleId,
      reason: "operator approved this voice config",
    });
    assert(locked.ok, `lock acquired (${locked.ok ? "" : locked.code})`);
    const blocked = vb.reviseVoiceBible(root, PID, { narrator: { speedDefault: 1.2 } });
    assertEq(blocked.code, "VOICE_BIBLE_LOCKED", "revision refused while locked");
    assertEq(vb.listVoiceBibles(root, PID).voiceBibles.length, 1, "no version written while locked");
    const reader = vb.voiceBibleLockReader(root, PID);
    assertEq(reader({ targetType: "VOICE_BIBLE", targetId: r.voiceBible.voiceBibleId }), "LOCKED", "lock reader reports LOCKED");
    assertEq(reader({ targetType: "VOICE_PARAGRAPH", targetId: "p1" }), null, "lock reader ignores other target types");
    assert(historyLib.unlockTarget(root, PID, {
      targetType: "VOICE_BIBLE",
      targetId: r.voiceBible.voiceBibleId,
      reason: "operator unlock",
      expectedLockVersion: locked.lock.lockVersion,
    }).ok, "explicit unlock");
    const after = vb.reviseVoiceBible(root, PID, { narrator: { speedDefault: 1.2 } });
    assert(after.ok && after.changed === true && after.voiceBible.version === 2, "unlock → revise creates a new version");
    fs.rmSync(root, { recursive: true, force: true });
  });

  await runTest("V19 provenance is traceable", () => {
    const root = tmpRepo();
    const r = created(root);
    const p = r.voiceBible.provenance;
    assertEq(p.source, "OPERATOR_APPROVED", "selection source recorded");
    assert(p.createdAt === "2026-10-05T00:00:00.000Z", "createdAt recorded");
    assertEq(p.evidenceRefs[0], "providers/local/SETUP_KOKORO.md", "evidence ref recorded");
    assertEq(p.approvalRef, "operator-note-1", "approval ref recorded");
    assertEq(p.rights.cloning, false, "voice cloning forbidden structurally");
    assertEq(r.voiceBible.narrator.provider, "local-kokoro", "provider recorded on the narrator");
    assertEq(r.voiceBible.narrator.model, "kokoro-v1", "model recorded on the narrator");
    assertEq(r.voiceBible.narrator.voiceId, "af_heart", "voiceId recorded on the narrator");
    fs.rmSync(root, { recursive: true, force: true });
  });

  await runTest("V20 unresolved rights / selection fail safely", () => {
    const root = tmpRepo();
    const unresolved = bibleInput({
      provenance: {
        source: "OPERATOR_APPROVED",
        rights: { status: "UNRESOLVED", licenseType: "UNRESOLVED", detail: "voice license not provable from evidence" },
        evidenceRefs: [],
      },
    });
    const r = vb.createVoiceBible(root, PID, unresolved);
    assert(r.ok, "an unresolved-rights bible is still a real, persisted artifact");
    assertEq(r.readiness.productionReady, false, "unresolved rights blocks production readiness");
    assertEq(r.readiness.code, "VOICE_RIGHTS_REVIEW_REQUIRED", "structured rights code");
    const attached = vb.attachManifestReference(root, PID, r.voiceBible.voiceBibleId);
    assertEq(attached.manifestStatus, "UNRESOLVED", "manifest records UNRESOLVED, never a false VERIFIED");

    const pending = bibleInput({ provenance: { source: "PENDING_OPERATOR", rights: { status: "UNRESOLVED", licenseType: "UNRESOLVED" }, evidenceRefs: [] } });
    const root2 = tmpRepo();
    const r2 = vb.createVoiceBible(root2, PID, pending);
    assertEq(r2.readiness.productionReady, false, "PENDING_OPERATOR blocks production readiness");
    assert(r2.readiness.blockers.some((b) => b.includes("PENDING_OPERATOR")), "blocker names the pending selection");
    assert(!vb.readinessOf({
      provenance: { source: "OPERATOR_APPROVED", rights: { status: "OWNED", licenseType: "ORIGINAL" } },
    }).productionReady === false, "a proven operator approval with owned rights is production ready");
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(root2, { recursive: true, force: true });
  });

  await runTest("V21 workspace placement is approved", () => {
    const root = tmpRepo();
    const r = created(root);
    const abs = path.join(root, "projects", PID, r.rel);
    assert(abs.includes(path.join("projects", PID, "voice", "voice-bible")), "artifact lives under the resolver's VOICE dir");
    const guard = ws.validateWorkspacePath(root, `projects/${PID}/${r.rel}`, { projectId: PID });
    assert(guard.ok, "workspace guard approves the resolved path");
    const live = ws.loadRegistry(REPO);
    assert(live.ok, "live registry still valid");
    assert(live.registry.projects.some((p) => p.projectId === "phase2-1-validation"), "2.1 validation project is registered");
    const liveDir = ws.resolveArtifactPath(REPO, "phase2-1-validation", "VOICE", "DURABLE");
    assert(liveDir.ok && liveDir.path.includes("phase2-1-validation"), "live 2.1 project resolves its voice dir");
    fs.rmSync(root, { recursive: true, force: true });
  });

  await runTest("V22 workspace guard rejects an ad-hoc write", () => {
    const root = tmpRepo();
    const approved = vb.approveVoiceBiblePath(root, PID, "vb-0123456789ab");
    assert(approved.ok, "canonical path approved");
    assertEq(approved.lifecycleClass, "DURABLE", "lifecycle-at-creation DURABLE");
    const ghostRoot = tmpRepo({ noManifest: true });
    const ghost = vb.approveVoiceBiblePath(ghostRoot, "not-registered", "vb-0123456789ab");
    assertEq(ghost.code, "VOICE_BIBLE_PATH_NOT_ALLOWED", "unregistered project refused before any write");
    assert(!fs.existsSync(path.join(ghostRoot, "projects", "not-registered")), "no directory created for the refused write");
    assertEq(ws.classifyNewArtifact({ artifactType: "VOICE" }).reviewRequired, true, "unclassified lifecycle still reviews (never disposable)");
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(ghostRoot, { recursive: true, force: true });
  });

  await runTest("V23 lifecycle classification is correct", () => {
    assertEq(vb.VOICE_BIBLE_LIFECYCLE, "DURABLE", "voice bible schema + approved version are DURABLE");
    const root = tmpRepo();
    const r = created(root);
    assertEq(ws.classifyNewArtifact({ artifactType: "VOICE", lifecycleClass: vb.VOICE_BIBLE_LIFECYCLE }).lifecycleClass, "DURABLE", "explicit DURABLE needs no review");
    assertEq(ws.LIFECYCLE_CLASSES.includes("EPHEMERAL"), true, "EPHEMERAL available for provider smoke audio");
    assertEq(ws.LIFECYCLE_CLASSES.includes("RETENTION_MANAGED"), true, "RETENTION_MANAGED available for test fixtures");
    assert(!r.rel.includes("tmp") && !r.rel.includes("cache"), "durable bible is not written to tmp/cache");
    fs.rmSync(root, { recursive: true, force: true });
  });

  await runTest("V24 secret rejection", () => {
    const root = tmpRepo();
    for (const [label, over] of [
      ["providerOptions api key", { providerOptions: { apiKey: "sk-live-should-never-persist" } }],
      ["provenance bearer token", { provenance: { ...bibleInput().provenance, evidenceRefs: ["Authorization: Bearer abc123"] } }],
    ]) {
      const r = vb.createVoiceBible(root, PID, bibleInput(over));
      assertEq(r.code, "VOICE_BIBLE_SCHEMA_INVALID", `${label} refused`);
    }
    assert(!fs.existsSync(path.join(root, "projects", PID, "voice")), "no secret ever reached disk");
    const pasted = bibleInput();
    pasted.provenance.evidenceRefs = ["bridge_token=abc123def456"];
    assertEq(vb.createVoiceBible(root, PID, pasted).code, "VOICE_BIBLE_SCHEMA_INVALID", "secret paste in evidence refused");
    const tampered = created(tmpRepo());
    const mutated = JSON.parse(JSON.stringify(tampered.voiceBible));
    mutated.narrator.providerOptions = { password: "x" };
    assertEq(vb.validateVoiceBible(mutated).ok, false, "post-hoc secret injection fails validation");
    fs.rmSync(root, { recursive: true, force: true });
  });

  await runTest("V25 observability event correlation", () => {
    const root = tmpRepo();
    const r = created(root);
    vb.attachManifestReference(root, PID, r.voiceBible.voiceBibleId);
    vb.reviseVoiceBible(root, PID, { narrator: { speedDefault: 1.1 } });
    vb.reviseVoiceBible(root, PID, { language: "en-us" });
    const events = telLib.listEvents(root, PID, {}).events;
    const names = events.map((e) => e.eventName);
    for (const n of ["VOICE_BIBLE_CREATED", "VOICE_BIBLE_REVISED", "VOICE_BIBLE_VALIDATED", "VOICE_SELECTION_RESOLVED"]) {
      assert(names.includes(n), `${n} emitted`);
    }
    const created1 = events.find((e) => e.eventName === "VOICE_BIBLE_CREATED");
    assertEq(created1.correlationId, r.voiceBible.voiceBibleId, "created event correlates on the voice bible id");
    assertEq(created1.stage, "phase-2.1", "stage recorded");
    assertEq(created1.retention, "CANONICAL_DURABLE", "voice decisions are canonically durable");
    const trace = telLib.getTrace(root, PID, r.voiceBible.voiceBibleId);
    assert(trace.ok && trace.events.length >= 2, `getTrace correlates ${trace.ok ? trace.events.length : 0} events on the bible id`);
    const serialized = JSON.stringify(events);
    assert(!/sk-|Bearer |password/i.test(serialized), "no credential-shaped material in telemetry");
    fs.rmSync(root, { recursive: true, force: true });
  });

  await runTest("V26 golden contract regression", () => {
    const golden = require("../../golden/definitions.json");
    const def = golden.definitions["gold-voice-bible:v1"];
    assert(Boolean(def), "gold-voice-bible definition is registered");
    assertEq(def.status, "ACTIVE", "definition is ACTIVE");
    assert(def.categories.includes("voice-bible"), "covers the voice-bible dimension");
    const baselines = require("../../golden/baselines.json");
    const b = baselines.baselines["gold-voice-bible:b1"];
    assert(Boolean(b), "deterministic baseline recorded");
    assertEq(b.metricSchemaVersion, "1.0.0", "metric schema tracked");
    for (const key of ["schemaStability", "versionImmutability", "voiceIdentity", "personaStability", "languageCompatibility", "credentialSafety", "dagInvalidation"]) {
      assert(b.metrics[key] && b.metrics[key].status === "MEASURED", `deterministic golden metric ${key} measured`);
    }
    const root = tmpRepo();
    const r = created(root);
    const metrics = require("../../lib/golden/metrics.js");
    for (const key of ["schemaStability", "voiceIdentity", "personaStability", "languageCompatibility", "credentialSafety", "dagInvalidation"]) {
      const v = metrics.validateMetricValue(key, b.metrics[key], "FACTUAL");
      assert(v.ok, `golden metric ${key} still valid against the metric catalog (${v.ok ? "" : v.message})`);
    }
    assert(vb.validateVoiceBible(r.voiceBible).ok, "live artifact still satisfies the golden-covered schema");
    fs.rmSync(root, { recursive: true, force: true });
  });

  await runTest("V27 fresh-process manifest/voice/DAG consistency", () => {
    const root = tmpRepo();
    const r = created(root);
    vb.registerDagNode(root, PID, r.voiceBible.voiceBibleId);
    vb.attachManifestReference(root, PID, r.voiceBible.voiceBibleId);
    const script = `
      const pm = require("./lib/project-manifest/index.js");
      const vb = require("./lib/voice-bible/index.js");
      const dag = require("./lib/dependency-dag/index.js");
      const root = ${JSON.stringify(root)}, pid = ${JSON.stringify(PID)};
      const m = pm.loadProjectManifest(root, pid);
      const l = vb.latestVoiceBible(root, pid);
      const d = dag.loadDag(root, pid);
      console.log(JSON.stringify({
        manifestRef: m.ok && m.manifest.artifacts.voiceBibleVersion.version,
        manifestStatus: m.ok && m.manifest.artifacts.voiceBibleVersion.status,
        bibleId: l.ok && l.voiceBible.voiceBibleId,
        bibleValid: l.ok && vb.validateVoiceBible(l.voiceBible).ok,
        dagVersionRef: d.ok && d.dag.nodes.VOICE_BIBLE.versionRef,
        edgeToVoice: d.ok && d.dag.nodes.VOICE.inputRefs.some((x) => x.key === "VOICE_BIBLE"),
      }));
    `;
    const out = freshProcess(script);
    const p = JSON.parse(out.stdout.trim());
    assertEq(p.manifestRef, r.voiceBible.voiceBibleId, "manifest ref consistent in a fresh process");
    assertEq(p.bibleId, p.manifestRef, "manifest ref and latest bible agree");
    assertEq(p.manifestStatus, "VERIFIED", "manifest status consistent");
    assertEq(p.bibleValid, true, "bible validates in a fresh process");
    assertEq(p.dagVersionRef, p.bibleId, "DAG node versionRef points at the current bible");
    assertEq(p.edgeToVoice, true, "DAG edge present in a fresh process");
    fs.rmSync(root, { recursive: true, force: true });
  });

  await runTest("V28 Extension impact gate honored", () => {
    // §21: Core-first, no user-facing voice selection in the Extension.
    // Asserted on the FEATURE (no voice-bible surface reached the Extension),
    // not on `git status` — this working tree already carried unrelated
    // pre-existing Extension modifications.
    const hits = spawnSync(process.execPath, ["-e", `
      const { spawnSync } = require("child_process");
      const r = spawnSync("git", ["grep", "-il", "-e", "voiceBible", "-e", "voice-bible", "-e", "VoiceBible", "--", "flow-companion"], { encoding: "utf8" });
      process.stdout.write(r.stdout || "");
    `], { cwd: REPO, encoding: "utf8" });
    assertEq((hits.stdout || "").trim(), "", "no Voice Bible surface exists anywhere in Flow Companion");
    assertEq(vb.V1_TTS_PROVIDER, "local-kokoro", "Kokoro remains the V1 provider");
    const kokoroSource = fs.readFileSync(path.join(REPO, "providers", "runtime", "adapters", "local-kokoro.js"), "utf8");
    assert(!/voicestudio/i.test(kokoroSource), "no VoiceStudio integration in the Kokoro adapter");
    const catalog = vb.providerCatalog();
    assert(!Object.keys(catalog).some((k) => /studio/i.test(k)), "no VoiceStudio entry in the provider catalog");
    const config = fs.readFileSync(path.join(REPO, "providers", "CONFIG.yaml"), "utf8");
    assert(/v1Provider: local-kokoro/.test(config), "CONFIG.yaml declares the V1 TTS provider");
  });

  console.log(`\n=== DONE: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(`FATAL: ${(e && e.stack) || e}`);
  process.exit(1);
});