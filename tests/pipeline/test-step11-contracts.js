"use strict";

/**
 * UNFOLDIQ STEP-11 Branch C — cross-contract tests (SC1-SC10).
 * Covers lib/step11-contract-check.js checkStep11Contracts with minimal objects.
 * Fixtures under projects/__11_contracts__/ (removed in teardown).
 * No network, no installs, no MP4 render.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const PROJECT = "__11_contracts__";
const PROJDIR = path.join(ROOT, "projects", PROJECT);

const { checkStep11Contracts } = require("../../lib/step11-contract-check.js");

let passed = 0;
let failed = 0;

function assert(c, m) {
  if (!c) throw new Error(`ASSERTION FAILED: ${m}`);
  console.log(`  ok ${m}`);
  passed++;
}

function runTest(name, fn) {
  console.log(`\n[TEST] ${name}`);
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`[PASS] ${name}`))
    .catch((e) => {
      console.log(`[FAIL] ${name}: ${e.message}`);
      failed++;
    });
}

function teardown() {
  fs.rmSync(PROJDIR, { recursive: true, force: true });
}

function kinds(r) {
  return (r.issues || []).map((i) => `${i.kind}:${i.status}`).join(" | ");
}

function has(r, kind) {
  return (r.issues || []).some((i) => i.kind === kind);
}

async function main() {
  console.log("=== STEP-11 CONTRACT TESTS (SC1-SC10) ===\n");
  fs.rmSync(PROJDIR, { recursive: true, force: true });
  fs.mkdirSync(PROJDIR, { recursive: true });

  const scenes = { scenes: [{ sceneId: "S01" }, { sceneId: "S02" }] };

  await runTest("SC1 orphan scene asset -> BLOCKED", async () => {
    const r = checkStep11Contracts({
      sceneScript: scenes,
      assetManifest: { assets: [{ assetId: "A1", sceneId: "NOPE" }] }
    });
    console.log(`  output: status=${r.status} issues=[${kinds(r)}]`);
    assert(r.status === "BLOCKED", "orphan scene asset must BLOCK");
    assert(has(r, "ORPHAN_SCENE_ASSET"), "must record ORPHAN_SCENE_ASSET");
  });

  await runTest("SC2 orphan audio assetId -> BLOCKED", async () => {
    const r = checkStep11Contracts({
      sceneScript: scenes,
      assetManifest: { assets: [{ assetId: "A1" }] },
      audioManifest: { tracks: [{ audioId: "V1", assetId: "NOPE" }] }
    });
    console.log(`  output: status=${r.status} issues=[${kinds(r)}]`);
    assert(r.status === "BLOCKED", "orphan audio assetId must BLOCK");
    assert(has(r, "ORPHAN_AUDIO_ID"), "must record ORPHAN_AUDIO_ID");
  });

  await runTest("SC3 orphan caption sceneId -> BLOCKED", async () => {
    const r = checkStep11Contracts({
      sceneScript: scenes,
      captions: { items: [{ captionId: "c1", sceneId: "NOPE", startMs: 0, endMs: 500, text: "hi" }] }
    });
    console.log(`  output: status=${r.status} issues=[${kinds(r)}]`);
    assert(r.status === "BLOCKED", "orphan caption sceneId must BLOCK");
    assert(has(r, "ORPHAN_CAPTION_SCENE"), "must record ORPHAN_CAPTION_SCENE");
  });

  await runTest("SC4 duration within ±250ms ok; 5000ms drift -> REVIEW", async () => {
    const ok = checkStep11Contracts({
      sceneScript: scenes,
      audioManifest: { tracks: [{ audioId: "V1", kind: "voice", durationMs: 1100 }] },
      timelineMeasured: { voiceEndMs: 1000 },
      requireVoice: true, requireCaptions: false
    });
    console.log(`  output(ok): status=${ok.status} issues=[${kinds(ok)}]`);
    assert(!has(ok, "DURATION_MISMATCH"), "±250ms drift must not flag DURATION_MISMATCH");
    const drift = checkStep11Contracts({
      sceneScript: scenes,
      audioManifest: { tracks: [{ audioId: "V1", kind: "voice", durationMs: 6000 }] },
      timelineMeasured: { voiceEndMs: 1000 },
      requireVoice: true, requireCaptions: false
    });
    console.log(`  output(drift): status=${drift.status} issues=[${kinds(drift)}]`);
    assert(has(drift, "DURATION_MISMATCH"), "5000ms drift must flag DURATION_MISMATCH");
    assert(drift.status === "REVIEW_REQUIRED", `drift must REVIEW (not block), got ${drift.status}`);
  });

  await runTest("SC5 caption end beyond voice/timeline end -> BLOCKED", async () => {
    const r = checkStep11Contracts({
      sceneScript: scenes,
      captions: { items: [{ captionId: "c1", sceneId: "S01", startMs: 0, endMs: 9000, text: "hi" }] },
      timelineMeasured: { voiceEndMs: 1000, actualTimelineEndMs: 1200 }
    });
    console.log(`  output: status=${r.status} issues=[${kinds(r)}]`);
    assert(r.status === "BLOCKED", "caption beyond timeline must BLOCK");
    assert(has(r, "CAPTION_BEYOND_TIMELINE"), "must record CAPTION_BEYOND_TIMELINE");
  });

  await runTest("SC6 preflight READY requires contracts -> BLOCKED when missing", async () => {
    const r = checkStep11Contracts({
      sceneScript: { scenes: [{ sceneId: "S01", narration: "hello world" }] },
      preflight: { status: "READY" },
      requireVoice: true, requireCaptions: true
    });
    console.log(`  output: status=${r.status} issues=[${kinds(r)}]`);
    assert(r.status === "BLOCKED", "READY preflight with missing contracts must BLOCK");
    assert(has(r, "CONTRACTS_INCOMPLETE"), "must record CONTRACTS_INCOMPLETE");
  });

  await runTest("SC7 target intact ok; tampered target -> BLOCKED", async () => {
    const ok = checkStep11Contracts({
      sceneScript: scenes,
      durationContract: { targetMs: 60000 },
      originalTargetMs: 60000,
      requireVoice: false, requireCaptions: false
    });
    console.log(`  output(ok): status=${ok.status} issues=[${kinds(ok)}]`);
    assert(!has(ok, "TARGET_OVERWRITTEN"), "intact target must not flag TARGET_OVERWRITTEN");
    const bad = checkStep11Contracts({
      sceneScript: scenes,
      durationContract: { targetMs: 99999 },
      originalTargetMs: 60000,
      requireVoice: false, requireCaptions: false
    });
    console.log(`  output(tampered): status=${bad.status} issues=[${kinds(bad)}]`);
    assert(bad.status === "BLOCKED", "tampered target must BLOCK");
    assert(has(bad, "TARGET_OVERWRITTEN"), "must record TARGET_OVERWRITTEN");
  });

  await runTest("SC8 measured evidence separate -> PASS note", async () => {
    const r = checkStep11Contracts({
      sceneScript: scenes,
      timelineMeasured: { voiceEndMs: 1000 },
      requireVoice: false, requireCaptions: false
    });
    console.log(`  output: status=${r.status} issues=[${kinds(r)}]`);
    assert(has(r, "MEASURED_EVIDENCE_SEPARATE"), "must record MEASURED_EVIDENCE_SEPARATE PASS note");
    const note = r.issues.find((i) => i.kind === "MEASURED_EVIDENCE_SEPARATE");
    assert(note.status === "PASS", "evidence-separate entry must be PASS");
  });

  await runTest("SC9 safety-blocked result re-entering as READY -> BLOCKED SAFETY_REENTRY", async () => {
    const r = checkStep11Contracts({
      sceneScript: scenes,
      assetManifest: { assets: [{ assetId: "A1", path: "assets/x.png", status: "READY" }] },
      providerResults: [{ assetId: "A1", path: "assets/x.png", status: "BLOCKED", safetyRefusal: true }]
    });
    console.log(`  output: status=${r.status} issues=[${kinds(r)}]`);
    assert(r.status === "BLOCKED", "safety re-entry must BLOCK");
    assert(has(r, "SAFETY_REENTRY"), "must record SAFETY_REENTRY");
  });

  await runTest("SC10 continuity refs intact -> ok", async () => {
    const r = checkStep11Contracts({
      sceneScript: scenes,
      assetManifest: { assets: [{ assetId: "A1", continuityEntities: ["E1"] }] },
      continuityRegistry: { lockedIds: ["E1"] },
      requireVoice: false, requireCaptions: false
    });
    console.log(`  output: status=${r.status} issues=[${kinds(r)}]`);
    assert(!has(r, "CONTINUITY_DRIFT"), "locked refs must not drift");
  });

  teardown();
  console.log(`\n=== SUMMARY ===`);
  console.log(`Passed assertions: ${passed}, Failed tests: ${failed}`);
  if (failed > 0) {
    console.log("RESULT: SOME TESTS FAILED");
    process.exit(1);
  }
  console.log("RESULT: ALL TESTS PASSED");
}

main().catch((e) => {
  console.log(`FATAL: ${e.stack || e.message}`);
  try { teardown(); } catch {}
  process.exit(1);
});
