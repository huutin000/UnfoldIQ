"use strict";

/**
 * UNFOLDIQ PHASE 1G.1 Prompt 01 — Content Class Router tests (cases A1-A7,
 * ambiguity, platform independence, backward compatibility).
 * Deterministic, no network, no paid calls.
 */

var fs = require("fs");
var path = require("path");
var Ajv = require("ajv");
var addFormats = require("ajv-formats");
var router = require("../../lib/content-class.js");

var passed = 0;
var failed = 0;

function assert(condition, message) {
  if (!condition) throw new Error("ASSERTION FAILED: " + message);
  console.log("  ✓ " + message);
  passed++;
}

function runTest(name, fn) {
  console.log("\n[TEST] " + name);
  try {
    fn();
    console.log("[PASS] " + name);
  } catch (e) {
    console.log("[FAIL] " + name + ": " + e.message);
    failed++;
  }
}

function loadSchema(file) {
  var content = fs.readFileSync(path.join(__dirname, "..", "..", "schemas", file), "utf8");
  return JSON.parse(content.replace(/^\uFEFF/, ""));
}

console.log("=== CONTENT CLASS ROUTER TESTS (A1-A7 + ambiguity) ===\n");

runTest("A1 explicit FACTUAL -> FACTUAL", function () {
  var r = router.resolveContentClass({ contentClass: "FACTUAL" });
  assert(r.ok === true && r.contentClass === "FACTUAL", "explicit FACTUAL preserved");
  assert(r.source === "EXPLICIT", "source is EXPLICIT");
});

runTest("A2 explicit FICTION -> FICTION", function () {
  var r = router.resolveContentClass({ contentClass: "FICTION", topic: "The woman in room 304" });
  assert(r.ok === true && r.contentClass === "FICTION", "explicit FICTION preserved even with realist title");
});

runTest("A3 explicit HYBRID -> HYBRID", function () {
  var r = router.resolveContentClass({ contentClass: "HYBRID" });
  assert(r.ok === true && r.contentClass === "HYBRID", "explicit HYBRID preserved");
});

runTest("A4 existing factual modes map safely", function () {
  ["historical-documentary", "technical-explainer", "tutorial", "news-explainer", "meditation-guided"].forEach(function (m) {
    var r = router.resolveContentClass({ contentMode: m });
    assert(r.ok === true && r.contentClass === "FACTUAL" && r.source === "MODE_MAP", "mode " + m + " -> FACTUAL via MODE_MAP");
  });
});

runTest("A4b fiction/hybrid modes map safely", function () {
  assert(router.resolveContentClass({ contentMode: "horror-fiction" }).contentClass === "FICTION", "horror-fiction -> FICTION");
  assert(router.resolveContentClass({ contentMode: "cinematic-fiction" }).contentClass === "FICTION", "cinematic-fiction -> FICTION");
  assert(router.resolveContentClass({ contentMode: "original-story" }).contentClass === "FICTION", "original-story -> FICTION");
  assert(router.resolveContentClass({ contentMode: "urban-legend-documentary" }).contentClass === "HYBRID", "urban-legend-documentary -> HYBRID");
  assert(router.resolveContentClass({ contentMode: "paranormal-documentary" }).contentClass === "HYBRID", "paranormal-documentary -> HYBRID");
});

runTest("A5 custom ambiguous mode -> unresolved/review", function () {
  var r = router.resolveContentClass({ contentMode: "custom-xyz" });
  assert(r.ok === false && r.code === "AMBIGUOUS_CONTENT_CLASS", "custom-xyz without class is unresolved, not guessed");
  var r2 = router.resolveContentClass({ contentMode: "some-unknown-mode" });
  assert(r2.ok === false && r2.code === "AMBIGUOUS_CONTENT_CLASS", "unknown mode without class is unresolved");
});

runTest("A5b genre-ambiguous known modes stay unresolved", function () {
  assert(router.resolveContentClass({ contentMode: "comedy" }).ok === false, "comedy needs explicit class");
  assert(router.resolveContentClass({ contentMode: "storytelling" }).ok === false, "storytelling needs explicit class");
});

runTest("A6 explicit choice wins over weak signal", function () {
  var r = router.resolveContentClass({ contentClass: "FICTION", contentMode: "custom-hanoi-tale" });
  assert(r.ok === true && r.contentClass === "FICTION", "explicit FICTION preserved alongside unmapped custom mode");
  var r2 = router.resolveContentClass({ contentClass: "HYBRID", persistedContentClass: "FACTUAL" });
  assert(r2.ok === true && r2.contentClass === "HYBRID", "explicit beats differing persisted value");
});

runTest("A7 conflicting explicit mode/class -> review failure", function () {
  var r = router.resolveContentClass({ contentClass: "FICTION", contentMode: "historical-documentary" });
  assert(r.ok === false && r.code === "CONTENT_MODE_CLASS_CONFLICT", "FICTION + historical-documentary surfaces conflict");
  var r2 = router.resolveContentClass({ persistedContentClass: "FACTUAL", contentMode: "horror-fiction" });
  assert(r2.ok === false && r2.code === "CONTENT_MODE_CLASS_CONFLICT", "persisted FACTUAL + horror-fiction surfaces conflict");
});

runTest("Ambiguity: titles alone never decide a class", function () {
  ["The woman in room 304", "The Room 304 Mystery", "The Ghost of the Old Hospital", "The Vanishing Village", "The creature in the forest"].forEach(function (t) {
    var r = router.resolveContentClass({ topic: t });
    assert(r.ok === false && r.code === "AMBIGUOUS_CONTENT_CLASS", "title-only '" + t + "' is unresolved");
  });
});

runTest("Invalid explicit class rejected", function () {
  var r = router.resolveContentClass({ contentClass: "DOCU-DRAMA" });
  assert(r.ok === false && r.code === "INVALID_CONTENT_CLASS", "invalid class rejected, never coerced");
});

runTest("Persisted class reused; custom-mode metadata honored", function () {
  var r = router.resolveContentClass({ persistedContentClass: "HYBRID" });
  assert(r.ok === true && r.contentClass === "HYBRID" && r.source === "PERSISTED", "persisted HYBRID reused");
  var r2 = router.resolveContentClass({ contentMode: "custom-xyz", customModeClass: "FICTION" });
  assert(r2.ok === true && r2.contentClass === "FICTION" && r2.source === "CUSTOM_MODE_METADATA", "canonical custom-mode metadata declares class");
});

runTest("Platform independence: platform never decides truth class", function () {
  var yt = router.resolveContentClass({ contentMode: "historical-documentary", platform: "youtube" });
  var tt = router.resolveContentClass({ contentMode: "historical-documentary", platform: "tiktok" });
  assert(yt.ok && tt.ok && yt.contentClass === tt.contentClass, "same mode resolves identically on both platforms");
  var bad = router.resolveContentClass({ contentMode: "custom-xyz", platform: "youtube" });
  assert(bad.ok === false, "YouTube platform does not force FACTUAL on ambiguous content");
});

runTest("Backward compatibility: pre-V5 content-mode instance still loads", function () {
  var ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  var validate = ajv.compile(loadSchema("content-mode.schema.json"));
  var oldInstance = {
    version: "1.0.0", projectId: "t", platform: "youtube", topic: "Ancient Human Fire Use",
    modeId: "historical-documentary", modeLabel: "Historical Documentary", rationale: "r",
    storyApproach: "s", hookApproach: "h", visualLanguage: "v",
    cameraAndMotionDirection: "c", voiceDirection: "v", musicDirection: "m",
    sfxDirection: "s", pacingDirection: "p", transitionDirection: "t",
    typographyDirection: "t", captionDirection: "c", emotionalArcMode: "STRONG"
  };
  assert(validate(oldInstance) === true, "old instance without contentClass still schema-valid");
  var r = router.resolveContentClass({ contentMode: oldInstance.modeId });
  assert(r.ok === true && r.contentClass === "FACTUAL", "old factual mode resolves explicitly at runtime");
});

console.log("\n=== SUMMARY ===");
console.log("Passed assertions: " + passed + ", Failed tests: " + failed);
if (failed > 0) {
  console.log("RESULT: SOME TESTS FAILED");
  process.exit(1);
}
console.log("RESULT: ALL TESTS PASSED");
