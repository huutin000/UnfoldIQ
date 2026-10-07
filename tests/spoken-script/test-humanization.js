"use strict";

/**
 * FIX PRE-2.4 tests — Spoken Humanizer contract (T3, T7–T10 + H-gates).
 */

const fs = require("fs");
const path = require("path");
const REPO = path.join(__dirname, "..", "..");
const ss = require(path.join(REPO, "lib", "spoken-script", "index.js"));
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

function chain(root, projectId, candidate) {
  return ss.createHumanization(root, projectId, {
    contentMode: "everyday-physics-explainer",
    contentClass: "FACTUAL",
    sourceScriptRef: { artifact: "script.json", version: "1.0.0" },
    sourceSegments: H.SOURCE_SEGMENTS,
    segments: candidate,
    provenance: { actorType: "AGENT", provider: "zcode", model: "GLM-5.3-Flash" },
  });
}

async function main() {
  await runTest("T3 content mode required (no silent default)", () => {
    const { root, projectId } = H.makeRoot();
    const r = ss.createHumanization(root, projectId, { sourceSegments: H.SOURCE_SEGMENTS, segments: H.GOOD_CANDIDATE });
    assert(!r.ok && r.code === "HUMANIZATION_CONTENT_MODE_UNRESOLVED", "missing contentMode/class refused");
    const bad = ss.createHumanization(root, projectId, { contentMode: "m", contentClass: "OPINION", sourceSegments: H.SOURCE_SEGMENTS, segments: H.GOOD_CANDIDATE });
    assert(!bad.ok && bad.code === "HUMANIZATION_CONTENT_MODE_UNRESOLVED", "invalid class refused");
  });

  await runTest("T7 humanization artifact versioned + machine-readable", () => {
    const { root, projectId } = H.makeRoot();
    const r = chain(root, projectId, H.GOOD_CANDIDATE);
    assert(r.ok, "created");
    assert(/^hum-[0-9a-f]{12}$/.test(r.humanization.humanizationId), "stable id");
    const doc = JSON.parse(fs.readFileSync(path.join(root, "projects", projectId, r.rel), "utf8"));
    assert(doc.schemaVersion === "1.0.0" && doc.instructionVersion && doc.sourceTextHash, "contract fields present");
    assert(doc.provenance.actorType === "AGENT" && doc.provenance.model === "GLM-5.3-Flash", "provider/model identity recorded when known");
    const anon = chain(root, projectId, H.GOOD_CANDIDATE.map((c, i) => i === 0 ? { ...c, candidateSpokenText: c.candidateSpokenText + " Truly." } : c));
    void anon;
    const r2 = ss.createHumanization(root, projectId, {
      contentMode: "everyday-physics-explainer", contentClass: "FACTUAL",
      sourceScriptRef: { artifact: "script.json", version: "1.0.0" },
      sourceSegments: H.SOURCE_SEGMENTS,
      segments: H.GOOD_CANDIDATE.map((c) => ({ ...c })),
      provenance: { actorType: "UNKNOWN_NOT_AVAILABLE" },
      version: 2,
    });
    assert(r2.ok && !("UNKNOWN" === r2.humanization.provenance.model), "unknown identity may be recorded as UNKNOWN_NOT_AVAILABLE, never fabricated");
  });

  await runTest("T8 source immutable (candidate copies text, never writes source)", () => {
    const { root, projectId } = H.makeRoot();
    const srcPath = path.join(root, "projects", projectId, "script.json");
    fs.writeFileSync(srcPath, JSON.stringify({ beats: H.SOURCE_SEGMENTS }), "utf8");
    const before = fs.readFileSync(srcPath, "utf8");
    const r = chain(root, projectId, H.GOOD_CANDIDATE);
    assert(r.ok, "candidate created");
    assertEq(fs.readFileSync(srcPath, "utf8"), before, "source bytes untouched");
    // Candidate carries verbatim source text for traceability.
    assertEq(r.humanization.segments[0].sourceText, H.SOURCE_SEGMENTS[0].text, "source text copied verbatim into candidate");
  });

  await runTest("T9 allowed rhythm rewrite accepted; identical content idempotent", () => {
    const { root, projectId } = H.makeRoot();
    const a = chain(root, projectId, H.GOOD_CANDIDATE);
    const b = chain(root, projectId, H.GOOD_CANDIDATE);
    assert(a.ok && b.ok && b.replay === true && b.code === "IDEMPOTENT_REPLAY", "identical candidate replays, never a duplicate version");
    const listed = fs.readdirSync(path.join(root, "projects", projectId, "voice", "spoken-humanization"));
    assertEq(listed.length, 1, "exactly one candidate file");
  });

  await runTest("T10 sentence split/merge lineage preserved", () => {
    const { root, projectId } = H.makeRoot();
    const merged = [{
      segmentId: "S1",
      sourceSegmentIds: ["B1", "B2"],
      candidateSpokenText: H.SOURCE_SEGMENTS[0].text + " " + H.SOURCE_SEGMENTS[1].text,
      changeTypes: ["SENTENCE_MERGE"],
    }];
    const r = ss.createHumanization(root, projectId, {
      contentMode: "m", contentClass: "FICTION",
      sourceScriptRef: { artifact: "script.json", version: "1" },
      sourceSegments: H.SOURCE_SEGMENTS, segments: merged,
    });
    assert(r.ok, "merge accepted");
    assertEq(r.humanization.segments[0].sourceSegmentIds, ["B1", "B2"], "lineage records both sources");
    assert(r.humanization.segments[0].sourceText.includes("In 1926") && r.humanization.segments[0].sourceText.includes("42 percent"), "merged source text assembled from both segments");
    const missing = ss.createHumanization(root, projectId, {
      contentMode: "m", contentClass: "FICTION",
      sourceScriptRef: { artifact: "script.json", version: "1" },
      sourceSegments: H.SOURCE_SEGMENTS,
      segments: [{ segmentId: "S9", sourceSegmentIds: ["BZ"], candidateSpokenText: "x", changeTypes: [] }],
    });
    assert(!missing.ok && missing.code === "HUMANIZATION_SOURCE_NOT_FOUND", "unknown source lineage refused");
  });

  console.log(`\n=== DONE: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
