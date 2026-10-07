"use strict";

/**
 * Phase 2.3 tests — Pronunciation Profile: schema, quality honesty, scope
 * precedence, acronym modes, candidate detection (T11–T14, T20–T22, T30 +
 * G7–G14). Isolated tmp roots only; the real runtime is covered by
 * test-pronunciation-runtime.js.
 */

const path = require("path");
const REPO = path.join(__dirname, "..", "..");
const pron = require(path.join(REPO, "lib", "pronunciation", "index.js"));
const kokoroPhonemize = require(path.join(REPO, "providers", "runtime", "kokoro-phonemize.js"));
const manifestLib = require(path.join(REPO, "lib", "project-manifest", "index.js"));
const H = require(path.join(REPO, "tests", "fixtures", "phase223", "helpers.js"));

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (!cond) throw new Error("ASSERTION FAILED: " + msg);
  console.log("  ok  " + msg);
}
function assertEq(a, b, msg) {
  if (a !== b) throw new Error(`ASSERTION FAILED: ${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
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
  await runTest("T11 pronunciation profile persists (versioned, immutable dir)", () => {
    const { root, projectId } = H.makeRoot();
    const r = pron.createPronunciationProfile(root, projectId, H.CANONICAL_PROFILE_INPUT);
    assert(r.ok, "create ok");
    assert(/^pron-[0-9a-f]{12}$/.test(r.profile.pronunciationProfileId), "id pattern");
    const loaded = pron.loadPronunciationProfile(root, projectId, r.profile.pronunciationProfileId);
    assert(loaded.ok && loaded.profile.fingerprint === r.profile.fingerprint, "round-trip load identical");
    const dup = pron.createPronunciationProfile(root, projectId, H.CANONICAL_PROFILE_INPUT);
    assert(!dup.ok && dup.code === "PRONUNCIATION_PROFILE_VERSION_CONFLICT", "duplicate create refused (use revise)");
  });

  await runTest("T12 six required pronunciation categories supported", () => {
    const { root, projectId } = H.makeRoot();
    const r = pron.createPronunciationProfile(root, projectId, H.CANONICAL_PROFILE_INPUT);
    assert(r.ok, "profile with NAME/FOREIGN_TERM/ACRONYM/PLACE_NAME/DOMAIN_TERM/CUSTOM created");
    const cats = new Set(r.profile.entries.map((e) => e.category));
    for (const c of pron.CATEGORIES) assert(cats.has(c), `category ${c} accepted`);
  });

  await runTest("T13 invalid reading rejected (no fabrication path)", () => {
    const { root, projectId } = H.makeRoot();
    const empty = pron.createPronunciationProfile(root, projectId, { language: "en-us", entries: [{ displayTerm: "X", language: "en-us", category: "NAME", reading: { notation: "IPA", value: "  " }, scope: { level: "GLOBAL_LANGUAGE" }, source: "OPERATOR_OVERRIDE", quality: "VERIFIED" }] });
    assert(!empty.ok, "empty reading value rejected");
    const badNotation = pron.createPronunciationProfile(root, projectId, { language: "en-us", entries: [{ displayTerm: "X", language: "en-us", category: "NAME", reading: { notation: "GUESS", value: "ks" }, scope: { level: "GLOBAL_LANGUAGE" }, source: "OPERATOR_OVERRIDE", quality: "AUTO" }] });
    assert(!badNotation.ok, "unknown notation rejected (schema or semantic gate)");
    const fabricated = pron.createPronunciationProfile(root, projectId, { language: "en-us", entries: [{ displayTerm: "Xylophone", language: "en-us", category: "NAME", reading: { notation: "IPA", value: "ˈzaɪləfoʊn" }, scope: { level: "GLOBAL_LANGUAGE" }, source: "RUNTIME_G2P", quality: "AUTO" }] });
    assert(!fabricated.ok && fabricated.errors[0].code === "PRONUNCIATION_READING_INVALID", "fabricated IPA from RUNTIME_G2P forbidden");
  });

  await runTest("T20 ambiguous pronunciation fails to REVIEW_REQUIRED, not VERIFIED", () => {
    const { root, projectId } = H.makeRoot();
    const v = pron.validateEntry({ entryId: "pe-0123456789ab", normalizedTerm: "jan", displayTerm: "Jan", language: "en-us", locale: null, category: "NAME", reading: { notation: "READ_AS", value: "yahn" }, acronymMode: null, scope: { level: "GLOBAL_LANGUAGE", projectId: null, scriptArtifactId: null, segmentId: null }, source: "RUNTIME_G2P", quality: "VERIFIED", notes: null, provenance: null });
    assert(!v.ok && v.errors.some((e) => e.code === "PRONUNCIATION_REVIEW_REQUIRED"), "spelling-inferred name reading cannot be VERIFIED");
    const reviewed = { ...H.CANONICAL_PROFILE_INPUT };
    const r = pron.createPronunciationProfile(root, projectId, { ...reviewed, entries: [{ displayTerm: "Jan", language: "en-us", category: "NAME", reading: { notation: "READ_AS", value: "yahn" }, scope: { level: "GLOBAL_LANGUAGE" }, source: "RUNTIME_G2P", quality: "AUTO" }] });
    assert(r.ok && r.profile.entries[0].quality === "AUTO", "runtime G2P reading stored as AUTO (never human-verified)");
  });

  await runTest("T14 conflicting same-specificity overrides fail closed", () => {
    const { root, projectId } = H.makeRoot();
    const r = pron.createPronunciationProfile(root, projectId, { language: "en-us", entries: [
      { displayTerm: "Jan", language: "en-us", category: "NAME", reading: { notation: "READ_AS", value: "yahn" }, scope: { level: "SEGMENT", segmentId: "S3", scriptArtifactId: H.SCRIPT.scriptArtifactId }, source: "OPERATOR_OVERRIDE", quality: "VERIFIED" },
      { displayTerm: "Jan", language: "en-us", category: "NAME", reading: { notation: "READ_AS", value: "jan" }, scope: { level: "SEGMENT", segmentId: "S3", scriptArtifactId: H.SCRIPT.scriptArtifactId }, source: "OPERATOR_OVERRIDE", quality: "VERIFIED" },
    ] });
    assert(r.ok, "profile stores both scoped entries (conflict is a resolution-time state)");
    const res = pron.resolveTermOverride(r.profile, "Jan", { projectId, scriptArtifactId: H.SCRIPT.scriptArtifactId, segmentId: "S3", language: "en-us" });
    assert(!res.ok && res.code === "PRONUNCIATION_ENTRY_CONFLICT", "equally specific conflict rejected, no silent winner");
  });

  await runTest("T22 scope precedence SEGMENT > SCRIPT > PROJECT > GLOBAL_LANGUAGE", () => {
    const { root, projectId } = H.makeRoot();
    const r = pron.createPronunciationProfile(root, projectId, { language: "en-us", entries: [
      { displayTerm: "Jan", language: "en-us", category: "NAME", reading: { notation: "READ_AS", value: "global-reading" }, scope: { level: "GLOBAL_LANGUAGE" }, source: "OPERATOR_OVERRIDE", quality: "VERIFIED" },
      { displayTerm: "Jan", language: "en-us", category: "NAME", reading: { notation: "READ_AS", value: "project-reading" }, scope: { level: "PROJECT", projectId }, source: "PROJECT_OVERRIDE", quality: "AUTO" },
      { displayTerm: "Jan", language: "en-us", category: "NAME", reading: { notation: "READ_AS", value: "script-reading" }, scope: { level: "SCRIPT", scriptArtifactId: H.SCRIPT.scriptArtifactId }, source: "PROJECT_OVERRIDE", quality: "AUTO" },
      { displayTerm: "Jan", language: "en-us", category: "NAME", reading: { notation: "READ_AS", value: "segment-reading" }, scope: { level: "SEGMENT", segmentId: "S3", scriptArtifactId: H.SCRIPT.scriptArtifactId }, source: "OPERATOR_OVERRIDE", quality: "VERIFIED" },
    ] });
    assert(r.ok, "4 scopes stored");
    const ctx = { projectId, scriptArtifactId: H.SCRIPT.scriptArtifactId, segmentId: "S3", language: "en-us" };
    const seg = pron.resolveTermOverride(r.profile, "Jan", ctx);
    assertEq(seg.entry.reading.value, "segment-reading", "SEGMENT wins");
    const other = pron.resolveTermOverride(r.profile, "Jan", { ...ctx, segmentId: "S9" });
    assertEq(other.entry.reading.value, "script-reading", "SCRIPT beats PROJECT/GLOBAL for other segments");
    const otherScript = pron.resolveTermOverride(r.profile, "Jan", { ...ctx, segmentId: "S9", scriptArtifactId: "fss-other" });
    assertEq(otherScript.entry.reading.value, "project-reading", "PROJECT beats GLOBAL");
    const otherProject = pron.resolveTermOverride(r.profile, "Jan", { ...ctx, segmentId: "S9", scriptArtifactId: "fss-other", projectId: "elsewhere" });
    assertEq(otherProject.entry.reading.value, "global-reading", "GLOBAL_LANGUAGE is the floor");
    // Identical readings at the same specificity are NOT a conflict.
    const dupRoot = H.makeRoot();
    const dup = pron.createPronunciationProfile(dupRoot.root, dupRoot.projectId, { language: "en-us", entries: [
      { displayTerm: "Dup", language: "en-us", category: "NAME", reading: { notation: "READ_AS", value: "same" }, scope: { level: "SEGMENT", segmentId: "S1", scriptArtifactId: H.SCRIPT.scriptArtifactId }, source: "OPERATOR_OVERRIDE", quality: "VERIFIED" },
      { displayTerm: "Dup", language: "en-us", category: "NAME", reading: { notation: "READ_AS", value: "same" }, scope: { level: "SEGMENT", segmentId: "S1", scriptArtifactId: H.SCRIPT.scriptArtifactId }, source: "VERIFIED_SOURCE", quality: "VERIFIED" },
    ] });
    const dupRes = pron.resolveTermOverride(dup.profile, "Dup", { projectId: dupRoot.projectId, scriptArtifactId: H.SCRIPT.scriptArtifactId, segmentId: "S1", language: "en-us" });
    assert(dupRes.ok, "identical readings at equal specificity are deduped, not conflicting");
  });

  await runTest("T21 acronym modes distinct (never one global rule)", () => {
    const c1 = kokoroPhonemize.compileInput({ text: "NASA and CIA met.", entries: H.profileEntries().filter((e) => e.displayTerm === "NASA" || e.displayTerm === "CIA") });
    assert(c1.ok, "compile ok");
    assert(c1.compiledText.includes("NASA") && !/N A S A/.test(c1.compiledText), "NASA (WORD) compiled text keeps the word unexpanded: " + c1.compiledText);
    assert(c1.compiledText.includes("C.I.A."), "CIA (LETTER_BY_LETTER) expanded to dotted letters");
    const custom = kokoroPhonemize.compileInput({ text: "CIA briefing", entries: [{ displayTerm: "CIA", normalizedTerm: "cia", category: "ACRONYM", acronymMode: "CUSTOM", quality: "VERIFIED", reading: { notation: "READ_AS", value: "see-eye-ay" } }] });
    assert(custom.compiledText.includes("see-eye-ay"), "CUSTOM acronym uses its READ_AS value");    const noMode = kokoroPhonemize.compileInput({ text: "CIA briefing", entries: [{ displayTerm: "CIA", normalizedTerm: "cia", category: "ACRONYM", acronymMode: null, quality: "AUTO", reading: { notation: "READ_AS", value: "x" } }] });
    assert(noMode.notApplied.length === 1 && noMode.notApplied[0].code === "PRONUNCIATION_OVERRIDE_NOT_APPLIED", "ACRONYM without resolvable mode is structured NOT APPLIED, never guessed");
  });

  await runTest("T30 secret scan PASS (profile-shaped documents)", () => {
    const dirty = { entries: [{ entryId: "pe-0123456789ab", notes: null, apiKey: "sk-should-never-persist" }] };
    const hits = manifestLib.findSecretKeys(dirty);
    assert(hits.length > 0, "secret-like key detected by canonical scanner");
    const { root, projectId } = H.makeRoot();
    const r = pron.createPronunciationProfile(root, projectId, H.CANONICAL_PROFILE_INPUT);
    const clean = manifestLib.findSecretKeys(r.profile);
    assertEq(clean.length, 0, "canonical profile has zero secret hits");
    const raw = JSON.stringify(r.profile);
    assert(!/password|token|cookie|bearer|api[_-]?key/i.test(raw.replace(/"normalizedTerm":"[^"]*"/g, "")), "no secret-like material in persisted profile");
  });

  await runTest("G7 person-name candidate detected; false-positive rate measured", () => {
    const candidates = pron.detectCandidates(H.SCRIPT.segments[2].text);
    assert(candidates.some((c) => c.term === "Reynolds"), "Reynolds detected as name candidate");
    assert(candidates.some((c) => c.term === "Reykjavik"), "Reykjavik detected as place candidate");
    const stats = pron.candidateStats(H.SCRIPT.segments, ["Reynolds", "Reykjavik", "NASA", "CIA", "Misaki", "UnfoldIQ", "Kokoro"]);
    console.log(`      candidate stats: ${JSON.stringify(stats)}`);
    assert(typeof stats.falsePositiveRate === "number", "false-positive rate measured on the validation set");
    // Sentence-initial capital is never a name by itself.
    const noFP = pron.detectCandidates("The weights were released quietly.");
    assertEq(noFP.length, 0, "sentence-initial 'The' is not a proper-name candidate");
  });

  await runTest("G8 foreign term resolves from profile", () => {
    const { root, projectId } = H.makeRoot();
    const r = pron.createPronunciationProfile(root, projectId, H.CANONICAL_PROFILE_INPUT);
    const res = pron.resolveSegmentEntries(r.profile, H.SCRIPT.segments[1].text, { projectId, scriptArtifactId: H.SCRIPT.scriptArtifactId, segmentId: "S2", language: "en-us" });
    assert(res.ok && res.resolved.some((e) => e.displayTerm === "Kokoro"), "Kokoro (FOREIGN_TERM) matched in S2");
  });

  await runTest("G11 place name + G12 domain term resolve", () => {
    const { root, projectId } = H.makeRoot();
    const r = pron.createPronunciationProfile(root, projectId, H.CANONICAL_PROFILE_INPUT);
    const s3 = pron.resolveSegmentEntries(r.profile, H.SCRIPT.segments[2].text, { projectId, scriptArtifactId: H.SCRIPT.scriptArtifactId, segmentId: "S3", language: "en-us" });
    assert(s3.ok && s3.resolved.some((e) => e.category === "PLACE_NAME"), "PLACE_NAME resolved");
    const s5 = pron.resolveSegmentEntries(r.profile, H.SCRIPT.segments[4].text, { projectId, scriptArtifactId: H.SCRIPT.scriptArtifactId, segmentId: "S5", language: "en-us" });
    assert(s5.ok && s5.resolved.some((e) => e.category === "DOMAIN_TERM"), "DOMAIN_TERM resolved");
    assert(s5.ok && s5.resolved.some((e) => e.category === "CUSTOM"), "CUSTOM resolved");
  });

  await runTest("G13 custom phonetic override compiles to provider input (derived, traceable)", () => {
    const compiled = kokoroPhonemize.compileInput({ text: H.SCRIPT.segments[4].text, entries: H.profileEntries().filter((e) => ["Misaki", "UnfoldIQ"].includes(e.displayTerm)) });
    assert(compiled.ok && compiled.changed, "compiled text derived");
    assert(compiled.compiledText.includes("mee-SAH-kee"), "Misaki -> mee-SAH-kee");
    assert(compiled.compiledText.includes("Unfold I Q"), "UnfoldIQ -> Unfold I Q");
    assert(!compiled.compiledText.includes("UnfoldIQ"), "original markup term replaced in compiled text only");
    assert(compiled.applications.length === 2, "override application traceable per entry");
    assertEq(compiled.compiledText.length !== H.SCRIPT.segments[4].text.length, true, "source bytes differ in compiled derivative only");
  });

  await runTest("G14 conflicting override rejected at runtime pass level", () => {
    const { root, projectId } = H.makeRoot();
    const r = pron.createPronunciationProfile(root, projectId, { language: "en-us", entries: [
      { displayTerm: "Kokoro", language: "en-us", category: "FOREIGN_TERM", reading: { notation: "READ_AS", value: "koh-koh-roh" }, scope: { level: "SEGMENT", segmentId: "S2", scriptArtifactId: H.SCRIPT.scriptArtifactId }, source: "OPERATOR_OVERRIDE", quality: "VERIFIED" },
      { displayTerm: "Kokoro", language: "en-us", category: "FOREIGN_TERM", reading: { notation: "READ_AS", value: "KOK-oh-roh" }, scope: { level: "SEGMENT", segmentId: "S2", scriptArtifactId: H.SCRIPT.scriptArtifactId }, source: "OPERATOR_OVERRIDE", quality: "VERIFIED" },
    ] });
    const pass = pron.runPronunciationPass(root, projectId, { scriptDoc: H.SCRIPT, voiceBibleRef: H.VOICE_BIBLE.voiceBibleId, profileId: r.profile.pronunciationProfileId }, { transport: H.identityTransport });
    assert(pass.ok, "pass still completes (fail-closed per segment, not per run)");
    const s2 = pass.pass.segments.find((s) => s.segmentId === "S2");
    assertEq(s2.status, "REVIEW_REQUIRED", "conflicting segment REVIEW_REQUIRED");
    assert(s2.issues.some((i) => i.code === "PRONUNCIATION_ENTRY_CONFLICT"), "conflict code on the segment");
    const s1 = pass.pass.segments.find((s) => s.segmentId === "S1");
    assertEq(s1.status, "CLEAN", "unrelated segment stays CLEAN");
  });

  await runTest("Profile revision is immutable + idempotent (§21/§22)", () => {
    const { root, projectId } = H.makeRoot();
    const v1 = pron.createPronunciationProfile(root, projectId, H.CANONICAL_PROFILE_INPUT);
    const same = pron.revisePronunciationProfile(root, projectId, { upsertEntries: H.profileEntries() });
    assert(same.ok && same.changed === false && same.code === "IDEMPOTENT_REPLAY", "identical revision replays");
    const v2 = pron.revisePronunciationProfile(root, projectId, { upsertEntries: [{ displayTerm: "Kokoro", language: "en-us", category: "FOREIGN_TERM", reading: { notation: "READ_AS", value: "KOH-koh-roh" }, scope: { level: "GLOBAL_LANGUAGE" }, source: "OPERATOR_OVERRIDE", quality: "VERIFIED" }] });
    assert(v2.ok && v2.changed === true && v2.profile.version === 2, "reading change creates v2");
    const old = pron.loadPronunciationProfile(root, projectId, v1.profile.pronunciationProfileId);
    assertEq(old.profile.entries.find((e) => e.displayTerm === "Kokoro").reading.value, "koh-koh-roh", "v1 immutable");
    const listed = pron.listPronunciationProfiles(root, projectId);
    assertEq(listed.profiles.length, 2, "exactly two versions");
  });

  await runTest("FIX-1 native phonetic override compiles to the OFFICIAL upstream markup (no READ_AS downgrade)", () => {
    const compiled = kokoroPhonemize.compileInput({
      text: "That threshold was Kokoro. And it changed everything.",
      entries: [{ displayTerm: "Kokoro", normalizedTerm: "kokoro", category: "FOREIGN_TERM", quality: "VERIFIED", reading: { notation: "IPA", value: "kˈOkəɹO" } }],
    });
    assert(compiled.ok && compiled.changed, "compile ok");
    assert(compiled.compiledText.includes("[Kokoro](/kˈOkəɹO/)"), `official hexgrad/kokoro markup emitted: ${compiled.compiledText}`);
    assert(!/threshold was Kokoro\./.test(compiled.compiledText), "default-G2P term replaced by markup in compiled text only");
    assertEq(compiled.applications.length, 1, "application traceable");
    assertEq(compiled.applications[0].replacement, "[Kokoro](/kˈOkəɹO/)", "exact official syntax preserved");
    // PROVIDER_NATIVE notation takes the same official path.
    const pn = kokoroPhonemize.compileInput({
      text: "Kokoro runs locally.",
      entries: [{ displayTerm: "Kokoro", normalizedTerm: "kokoro", category: "FOREIGN_TERM", quality: "AUTO", reading: { notation: "PROVIDER_NATIVE", value: "kˈOkəɹO" } }],
    });
    assert(pn.compiledText.includes("[Kokoro](/kˈOkəɹO/)"), "PROVIDER_NATIVE uses the official markup path");
    // READ_AS entries stay on the substitution path (no regression).
    const ra = kokoroPhonemize.compileInput({
      text: "Kokoro runs locally.",
      entries: [{ displayTerm: "Kokoro", normalizedTerm: "kokoro", category: "FOREIGN_TERM", quality: "VERIFIED", reading: { notation: "READ_AS", value: "koh-koh-roh" } }],
    });
    assert(ra.compiledText.includes("koh-koh-roh") && !ra.compiledText.includes("[Kokoro]"), "READ_AS substitution unchanged");
  });

  console.log(`\n=== DONE: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
