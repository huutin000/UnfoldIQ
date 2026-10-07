"use strict";

/**
 * Phase 2.3 tests — REAL RUNTIME matrix (R1–R12) + T15–T19.
 *
 * These tests execute the REAL configured local-kokoro runtime in quiet
 * phonemization mode (KPipeline model=False: graphemes + phonemes, NO audio,
 * NO model weights). They are the only proof that the runtime path is real;
 * they are never mocked. If the runtime is absent the tests FAIL CLOSED
 * (structured code), they never pass by substitution.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const REPO = path.join(__dirname, "..", "..");
const pron = require(path.join(REPO, "lib", "pronunciation", "index.js"));
const kokoroPhonemize = require(path.join(REPO, "providers", "runtime", "kokoro-phonemize.js"));
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

function tmpProject() {
  const { root, projectId } = H.makeRoot();
  return { root, projectId };
}

async function main() {
  // ---- R1: runtime resolves -------------------------------------------------
  let r1;
  await runTest("R1 Kokoro runtime resolves (real python, quiet mode)", () => {
    r1 = kokoroPhonemize.phonemize("Runtime check sentence.", "en-us");
    assert(r1.ok, `runtime responded: ${r1.ok ? "yes" : r1.code + " " + r1.message}`);
  });
  if (!r1 || !r1.ok) {
    console.log("\nRuntime unavailable — failing closed. Remaining runtime tests skipped by the fail-closed contract.");
    console.log(`=== DONE: ${passed} passed, ${failed + 1} failed ===`);
    process.exit(1);
  }

  // ---- R2: language mapping -------------------------------------------------
  await runTest("R2 en-us mapping resolves to the configured Kokoro language code", () => {
    assertEq(kokoroPhonemize.kokoroLangCode("en-us"), "a", "en-us -> a");
    assertEq(kokoroPhonemize.kokoroLangCode("EN-US"), "a", "case-insensitive");
    assertEq(kokoroPhonemize.kokoroLangCode("klingon"), null, "unsupported language unmapped");
  });

  // ---- R3 + T15: quiet phonemization returns graphemes + phonemes, no audio -
  await runTest("R3+T15 quiet/model=False phonemization returns real graphemes + phonemes (no audio, no fabrication)", () => {
    const batch = kokoroPhonemize.phonemizeBatch([
      { index: 0, text: "The quick brown fox jumps over the lazy dog.", language: "en-us" },
      { index: 1, text: "Kokoro runs locally on this machine.", language: "en-us" },
    ]);
    assert(batch.ok, "batch ok");
    for (const res of batch.results) {
      assert(res.ok, `item ${res.index} ok`);
      const graphemes = res.graphemes.join("");
      const phonemes = res.phonemes.join("");
      assert(graphemes.length > 10, "graphemes returned");
      assert(phonemes.length > 5, "phonemes returned");
      assert(/[a-z]/.test(graphemes), "graphemes are text");
      assert(/[ˈˌəɪæɔɹ]/.test(phonemes) || /[^a-z\s]/.test(phonemes), "phonemes are phonetic, not a copy of the text");
    }
  });

  // ---- R4: unknown runtime/provider fails closed ----------------------------
  await runTest("R4 unknown runtime/language fails closed with structured codes", () => {
    const bad = kokoroPhonemize.phonemize("X", "xx-zz");
    assert(!bad.ok && bad.code === "PRONUNCIATION_RUNTIME_LANGUAGE_UNSUPPORTED", "unsupported language structured");
    void os;
    const down = kokoroPhonemize.phonemizeBatch([{ index: 0, text: "x", language: "en-us" }], { transport: () => H.unavailableTransport() });
    assert(!down.ok && down.code === "PRONUNCIATION_RUNTIME_UNAVAILABLE", "unavailable transport surfaced, never degraded");
  });

  // ---- R5: normal English segment phonemizes --------------------------------
  await runTest("R5 normal English segment phonemizes", () => {
    const r = kokoroPhonemize.phonemize(H.SCRIPT.segments[0].text, "en-us");
    assert(r.ok && r.results[0].ok && r.results[0].phonemes.join("").length > 20, "S1 phonemized");
  });

  // ---- Real pass (shared by R6–R11, T16–T19) --------------------------------
  const { root, projectId } = tmpProject();
  const profile = pron.createPronunciationProfile(root, projectId, H.CANONICAL_PROFILE_INPUT);
  assert(profile.ok, "canonical profile created for runtime pass");
  const scriptBytesBefore = fs.readFileSync(path.join(__dirname, "..", "..", "projects", "phase223-narration-pronunciation", "input", "final-spoken-script.json"));
  let pass1 = null;
  await runTest("T17+R7 custom pronunciation compiles", () => {
    const compiled = kokoroPhonemize.compileInput({ text: H.SCRIPT.segments[1].text, entries: H.profileEntries().filter((e) => e.displayTerm === "Kokoro") });
    assert(compiled.changed && compiled.compiledText.includes("koh-koh-roh"), "compiled input derived from canonical entry");
  });

  await runTest("T15b+R6+R8+T18 real runPronunciationPass: override reaches the runtime and is proven consumed", () => {
    const t0 = Date.now();
    pass1 = pron.runPronunciationPass(root, projectId, { scriptDoc: H.SCRIPT, voiceBibleRef: H.VOICE_BIBLE.voiceBibleRef || "vb-0123456789ab", profileId: profile.profile.pronunciationProfileId, provider: "local-kokoro", providerModel: "kokoro-v1" });
    const ms = Date.now() - t0;
    assert(pass1.ok, `real pass ok (${ms}ms incl. cold python start)`);
    const byId = new Map(pass1.pass.segments.map((s) => [s.segmentId, s]));
    assertEq(byId.get("S1").status, "CLEAN", "neutral segment CLEAN");
    assertEq(byId.get("S2").status, "OVERRIDE_APPLIED", "Kokoro override applied and proven at runtime");
    assert(byId.get("S2").matchedEntries.every((m) => m.applied === true), "all S2 matched entries applied");
    assertEq(byId.get("S4").status, "OVERRIDE_APPLIED", "CIA (LETTER_BY_LETTER) applied + proven; NASA (WORD) needs no text change");
    assertEq(byId.get("S5").status, "OVERRIDE_APPLIED", "Misaki + UnfoldIQ overrides applied");
    assert(pass1.pass.providerLanguageCode === "a", "provider language code recorded");
    assert(pass1.pass.runtimeMode === "QUIET_PHONEMIZATION", "non-audio runtime mode recorded");
    console.log(`      cold phonemization latency: ${ms}ms for ${pass1.pass.segments.length} segments + expectations`);
  });

  await runTest("T16 runtime unavailable is structured (per-segment FAILED, no fabricated success)", () => {
    const r2 = pron.runPronunciationPass(root, projectId, { scriptDoc: H.SCRIPT, voiceBibleRef: "vb-0123456789ab", profileId: profile.profile.pronunciationProfileId }, { transport: () => H.unavailableTransport() });
    assert(!r2.ok && r2.code === "PRONUNCIATION_RUNTIME_UNAVAILABLE", "unavailable surfaced as structured error");
    // Per-item runtime error -> segment FAILED, other segments unaffected.
    // Fresh project: the canonical pass id would idempotently replay pass1.
    const fresh = tmpProject();
    const freshProfile = pron.createPronunciationProfile(fresh.root, fresh.projectId, H.CANONICAL_PROFILE_INPUT);
    const partial = pron.runPronunciationPass(fresh.root, fresh.projectId, { scriptDoc: H.SCRIPT, voiceBibleRef: "vb-0123456789ab", profileId: freshProfile.profile.pronunciationProfileId }, {
      transport: (items) => ({ ok: true, results: items.map((it) => (String(it.index).startsWith("exp:") || it.index !== 2 ? { index: it.index, ok: true, graphemes: [it.text], phonemes: [it.text] } : { index: it.index, ok: false, error: "simulated misaki failure" })) }),
    });
    assert(partial.ok, "partial transport pass completes");
    const byId = new Map(partial.pass.segments.map((s) => [s.segmentId, s]));
    assertEq(byId.get("S3").status, "FAILED", "failing segment FAILED");
    assertEq(byId.get("S1").status, "CLEAN", "unrelated segment unaffected");
  });

  await runTest("R9 runtime output changes appropriately when a verified override changes", () => {
    const revised = pron.revisePronunciationProfile(root, projectId, { upsertEntries: [{ displayTerm: "Kokoro", language: "en-us", category: "FOREIGN_TERM", reading: { notation: "READ_AS", value: "KOK-oh-roh" }, scope: { level: "GLOBAL_LANGUAGE" }, source: "OPERATOR_OVERRIDE", quality: "VERIFIED" }] });
    assert(revised.ok && revised.changed, "reading revised to v2");
    const pass2 = pron.runPronunciationPass(root, projectId, { scriptDoc: H.SCRIPT, voiceBibleRef: "vb-0123456789ab", profileId: revised.profile.pronunciationProfileId, provider: "local-kokoro", providerModel: "kokoro-v1" });
    assert(pass2.ok, "second real pass ok (warm)");
    const oldS2 = pass1.pass.segments.find((s) => s.segmentId === "S2");
    const newS2 = pass2.pass.segments.find((s) => s.segmentId === "S2");
    assert(newS2.status === "OVERRIDE_APPLIED", "override still applied with new reading");
    assert(newS2.runtimePhonemeHash !== oldS2.runtimePhonemeHash, "runtime phoneme output changed with the override");
    const untouched = pass2.pass.segments.find((s) => s.segmentId === "S6");
    assert(untouched.runtimePhonemeHash === pass1.pass.segments.find((s) => s.segmentId === "S6").runtimePhonemeHash, "unrelated segment output identical");
  });

  await runTest("R10 source script bytes remain unchanged", () => {
    const canonical = path.join(REPO, "projects", "phase223-narration-pronunciation", "input", "final-spoken-script.json");
    const before = fs.readFileSync(canonical);
    void scriptBytesBefore;
    const fixtureScript = JSON.parse(JSON.stringify(H.SCRIPT));
    const pass = pron.runPronunciationPass(root, projectId, { scriptDoc: fixtureScript, voiceBibleRef: "vb-0123456789ab", profileId: profile.profile.pronunciationProfileId }, { transport: H.identityTransport });
    assert(pass.ok, "pass ok (replay)");
    const after = fs.readFileSync(canonical);
    assertEq(JSON.stringify(before), JSON.stringify(after), "canonical fixture byte-identical");
    assertEq(JSON.stringify(H.SCRIPT), JSON.stringify(fixtureScript), "in-memory script object unmutated");
  });

  await runTest("T19+R11 no WAV/audio generated anywhere in the pass project", () => {
    const audioExt = [".wav", ".mp3", ".flac", ".ogg", ".m4a"];
    const hits = [];
    const walk = (dir) => {
      for (const f of fs.readdirSync(dir)) {
        const p = path.join(dir, f);
        if (fs.statSync(p).isDirectory()) walk(p);
        else if (audioExt.includes(path.extname(f).toLowerCase())) hits.push(p);
      }
    };
    walk(root);
    assertEq(hits.length, 0, "zero audio files");
    assert(!fs.existsSync(path.join(root, "projects", projectId, "assets")), "no assets dir fabricated");
  });

  await runTest("R12 no external credits spent (local runtime, zero-cost class)", () => {
    const doc = JSON.parse(fs.readFileSync(path.join(root, "projects", projectId, "voice", "pronunciation-pass", `${pass1.pass.pronunciationPassId}.json`), "utf8"));
    assertEq(doc.provider, "local-kokoro", "local provider only");
    assert(!JSON.stringify(doc).includes("credit"), "no credit artifacts");
    // No cost telemetry events for this project (local quiet run is free).
    const eventsPath = path.join(root, "projects", projectId, "telemetry", "events.json");
    if (fs.existsSync(eventsPath)) {
      const events = JSON.parse(fs.readFileSync(eventsPath, "utf8")).events || {};
      const costEvents = Object.values(events).filter((e) => e.eventName === "COST");
      assertEq(costEvents.length, 0, "no COST events (no paid provider touched)");
    }
  });

  await runTest("FIX-1 OFFICIAL upstream phonetic override proven at the real runtime ([term](/phonemes/) markup)", () => {
    // Official hexgrad/kokoro README example, verbatim syntax.
    const official = kokoroPhonemize.phonemize("[Kokoro](/kˈOkəɹO/)", "en-us");
    assert(official.ok && official.results[0].ok, "official markup phonemizes");
    assertEq(official.results[0].phonemes.join(" ").trim(), "kˈOkəɹO", "standalone markup yields EXACTLY the specified phonemes (default G2P overridden)");
    const inSentence = kokoroPhonemize.phonemize("[toast](/toʊst/) was ready.", "en-us");
    assert(inSentence.ok && inSentence.results[0].phonemes.join(" ").trim().startsWith("toʊst "), "in-sentence markup yields the specified phonemes verbatim");
    // Full pass: IPA profile entry compiles to the official markup and the
    // runtime output is proven consumed (OVERRIDE_APPLIED + inclusion).
    const { root: nroot, projectId: npid } = tmpProject();
    const ipaProfile = pron.createPronunciationProfile(nroot, npid, { language: "en-us", entries: [
      { displayTerm: "Kokoro", language: "en-us", category: "FOREIGN_TERM", reading: { notation: "IPA", value: "kˈOkəɹO" }, scope: { level: "GLOBAL_LANGUAGE" }, source: "VERIFIED_SOURCE", quality: "VERIFIED", provenance: { origin: "hexgrad/kokoro official README example" } },
    ] });
    assert(ipaProfile.ok, "IPA profile created (VERIFIED_SOURCE is eligible for verified IPA)");
    const ipaPass = pron.runPronunciationPass(nroot, npid, { scriptDoc: H.SCRIPT, voiceBibleRef: "vb-0123456789ab", profileId: ipaProfile.profile.pronunciationProfileId });
    assert(ipaPass.ok, `native pass ok: ${ipaPass.ok ? "" : ipaPass.code + " " + ipaPass.message}`);
    const s2 = ipaPass.pass.segments.find((s) => s.segmentId === "S2");
    assertEq(s2.status, "OVERRIDE_APPLIED", "native IPA override applied AND proven consumed by the real runtime");
    assert(s2.matchedEntries.every((m) => m.applied === true && !m.notAppliedReason), "no PRONUNCIATION_OVERRIDE_NOT_APPLIED downgrade for native markup");
  });

  console.log(`\n=== DONE: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
