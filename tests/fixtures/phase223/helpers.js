"use strict";

/**
 * Phase 2.2 + 2.3 shared test fixtures (tests/fixtures is NOT a test domain).
 *
 * The identity phonemize transport mimics the property the REAL Kokoro
 * quiet path was verified to have: the phonemization of a replacement text
 * appears verbatim inside the phonemization of a sentence containing it
 * (G2P is context-stable for these tokens). Identity output makes the
 * runtime-pass inclusion checks pass deterministically without python.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

function makeRoot(projectId = "p1") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "phase223-"));
  fs.mkdirSync(path.join(root, "projects"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "projects", "registry.json"),
    JSON.stringify({ schemaVersion: "1.0.0", projects: [{ projectId, kind: "VALIDATION", status: "ACTIVE", path: `projects/${projectId}`, manifestRef: null }] }, null, 2),
    "utf8"
  );
  fs.mkdirSync(path.join(root, "projects", projectId), { recursive: true });
  return { root, projectId };
}

const VOICE_BIBLE = {
  voiceBibleId: "vb-0123456789ab",
  narrator: {
    emotionalRange: ["NEUTRAL", "FRIENDLY", "CURIOSITY", "CONFIDENT", "INSTRUCTIVE"],
    prohibitedTraits: ["UNNATURALLY_SLOW_CINEMATIC", "CONSTANT_DRAGMATIC_EMPHASIS", "MONOTONE_CADENCE", "OVERACTING", "ROBOTIC_CLAUSE_RHYTHM", "EXCESSIVE_PAUSES", "ANNOUNCER_BOMBAST"],
  },
  characterVoices: [],
};

const SCRIPT = {
  schemaVersion: "1.0.0",
  scriptArtifactId: "fss-phase223-validation",
  scriptVersion: 1,
  projectId: "p1",
  language: "en-us",
  contentMode: null,
  contentClass: "FACTUAL",
  segments: [
    { segmentId: "S1", ordinal: 0, text: "In 2024, voice AI crossed a threshold that used to sound like science fiction." },
    { segmentId: "S2", ordinal: 1, text: "That threshold was Kokoro. And it changed everything." },
    { segmentId: "S3", ordinal: 2, text: "Mica Reynolds walked through Reykjavik while recording narration for this series." },
    { segmentId: "S4", ordinal: 3, text: "NASA released the weights while CIA briefings mentioned synthetic audio." },
    { segmentId: "S5", ordinal: 4, text: "Misaki turns graphemes into phonemes before UnfoldIQ renders a video." },
    { segmentId: "S6", ordinal: 5, text: "The rest of this series explains how each piece works." },
  ],
  provenance: { source: "test fixture", createdAt: "2026-10-06T00:00:00.000Z", productionScriptStatus: "NOT_APPLICABLE" },
  fingerprint: "0123456789abcdef",
};

/** Identity transport: phonemes == text (see header note). Deterministic. */
function identityTransport(items) {
  return {
    ok: true,
    results: items.map((it) => ({ index: it.index, ok: true, graphemes: [it.text], phonemes: [it.text] })),
  };
}

/** Transport that simulates the runtime being down. */
function unavailableTransport() {
  return { ok: false, code: "PRONUNCIATION_RUNTIME_UNAVAILABLE", message: "PRONUNCIATION_RUNTIME_UNAVAILABLE: simulated outage" };
}

/** Canonical profile entries covering all six categories. */
function profileEntries() {
  return [
    { displayTerm: "Reynolds", language: "en-us", category: "NAME", reading: { notation: "READ_AS", value: "RAYN-ulz" }, scope: { level: "GLOBAL_LANGUAGE" }, source: "OPERATOR_OVERRIDE", quality: "VERIFIED" },
    { displayTerm: "Kokoro", language: "en-us", category: "FOREIGN_TERM", reading: { notation: "READ_AS", value: "koh-koh-roh" }, scope: { level: "GLOBAL_LANGUAGE" }, source: "OPERATOR_OVERRIDE", quality: "VERIFIED" },
    { displayTerm: "NASA", language: "en-us", category: "ACRONYM", acronymMode: "WORD", reading: { notation: "READ_AS", value: "NASA" }, scope: { level: "GLOBAL_LANGUAGE" }, source: "CANONICAL_LEXICON", quality: "AUTO" },
    { displayTerm: "CIA", language: "en-us", category: "ACRONYM", acronymMode: "LETTER_BY_LETTER", reading: { notation: "READ_AS", value: "C.I.A." }, scope: { level: "GLOBAL_LANGUAGE" }, source: "CANONICAL_LEXICON", quality: "AUTO" },
    { displayTerm: "Reykjavik", language: "en-us", category: "PLACE_NAME", reading: { notation: "READ_AS", value: "RAYK-yah-veek" }, scope: { level: "GLOBAL_LANGUAGE" }, source: "VERIFIED_SOURCE", quality: "VERIFIED" },
    { displayTerm: "Misaki", language: "en-us", category: "DOMAIN_TERM", reading: { notation: "READ_AS", value: "mee-SAH-kee" }, scope: { level: "GLOBAL_LANGUAGE" }, source: "OPERATOR_OVERRIDE", quality: "VERIFIED" },
    { displayTerm: "UnfoldIQ", language: "en-us", category: "CUSTOM", reading: { notation: "READ_AS", value: "Unfold I Q" }, scope: { level: "GLOBAL_LANGUAGE" }, source: "OPERATOR_OVERRIDE", quality: "VERIFIED" },
  ];
}

const CANONICAL_PROFILE_INPUT = { language: "en-us", entries: profileEntries(), provenance: { source: "phase-2.3 test profile", evidenceRefs: ["tests/fixtures/phase223/helpers.js"] } };

module.exports = { makeRoot, VOICE_BIBLE, SCRIPT, identityTransport, unavailableTransport, profileEntries, CANONICAL_PROFILE_INPUT };
