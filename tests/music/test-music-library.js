"use strict";

/**
 * Phase 2.7-C/D tests — Music Library: ingest, rights fail-closed,
 * project usage decision, acquisition brief, search/ranking.
 */

const path = require("path");
const REPO = path.join(__dirname, "..", "..");
const library = require(REPO + "/lib/music-library/index.js");
const H = require(REPO + "/tests/fixtures/audio-synth.js");

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
  try { await fn(); passed += 1; console.log("[PASS] " + name); }
  catch (e) { failed += 1; console.log("[FAIL] " + name + " — " + e.message); }
}

(async () => {
await runTest("L1 ingest measures duration from real bytes", async () => {
  const repo = H.makeTempRepo();
  const bytes = H.makeMusicWav({ durationMs: 30000 });
  const r = library.ingestMusicAsset({ bytes, metadata: { title: "T", sourceType: "USER_IMPORTED_LICENSED_ASSET", vocalType: "INSTRUMENTAL" }, rights: H.APPROVED_RIGHTS, repoRoot: repo });
  assert(r.ok, "ingest ok: " + (r.message || ""));
  const rec = library.getAsset(repo, r.assetId);
  assertEq(rec.durationMs, 30000, "duration measured, not trusted");
  assert(rec.audioHash.length === 64, "sha256 hash recorded");
  assert(require("fs").existsSync(path.join(repo, rec.audioRef)), "audio bytes stored");
});

await runTest("L2 duplicate bytes rejected", async () => {
  const repo = H.makeTempRepo();
  const bytes = H.makeMusicWav({ durationMs: 5000 });
  library.ingestMusicAsset({ bytes, metadata: { title: "A", sourceType: "USER_IMPORTED_LICENSED_ASSET" }, rights: H.APPROVED_RIGHTS, repoRoot: repo });
  const r2 = library.ingestMusicAsset({ bytes, metadata: { title: "B", sourceType: "USER_IMPORTED_LICENSED_ASSET" }, rights: H.APPROVED_RIGHTS, repoRoot: repo });
  assertEq(r2.ok, false, "dedup");
  assertEq(r2.code, "ASSET_DUPLICATE", "canonical code");
});

await runTest("L3 disallowed source types rejected at ingest", async () => {
  const repo = H.makeTempRepo();
  for (const src of ["RANDOM_WEB", "YOUTUBE_UPLOAD", "UNKNOWN_REPO"]) {
    const r = library.ingestMusicAsset({ bytes: H.makeMusicWav({ durationMs: 1000 }), metadata: { title: "x", sourceType: src }, rights: H.APPROVED_RIGHTS, repoRoot: repo });
    assertEq(r.ok, false, `${src} rejected`);
    assertEq(r.code, "PROVIDER_NOT_ALLOWED", `${src} canonical code`);
  }
});

await runTest("L4 non-WAV bytes rejected", async () => {
  const repo = H.makeTempRepo();
  const r = library.ingestMusicAsset({ bytes: Buffer.from("not a wav"), metadata: { title: "x", sourceType: "USER_IMPORTED_LICENSED_ASSET" }, rights: H.APPROVED_RIGHTS, repoRoot: repo });
  assertEq(r.ok, false, "non-wav rejected");
  assertEq(r.code, "ASSET_NOT_WAV", "canonical code");
});

await runTest("L5 rights fail-closed: unknown evidence → REVIEW_REQUIRED", async () => {
  const repo = H.makeTempRepo();
  const r = library.ingestMusicAsset({
    bytes: H.makeMusicWav({ durationMs: 1000 }),
    metadata: { title: "x", sourceType: "USER_IMPORTED_LICENSED_ASSET" },
    rights: { provider: "USER_IMPORTED_LICENSED_ASSET", licenseType: "ROYALTY_FREE", reuseScope: "MULTI_PROJECT", status: "APPROVED" }, // no evidence
    repoRoot: repo,
  });
  assertEq(r.record.rights.status, "REVIEW_REQUIRED", "APPROVED downgraded without evidence");
});

await runTest("L6 usage decision: platform scope violation", async () => {
  const d = library.decideUsage(
    { ...H.APPROVED_RIGHTS, allowedPlatforms: ["youtube"], status: "APPROVED", policyVersion: library.RIGHTS_POLICY_VERSION },
    { assetId: "a", projectId: "p", targetPlatforms: ["tiktok"], commercialContext: "STANDARD" }
  );
  assertEq(d.decision, "REVIEW_REQUIRED", "not auto-REJECTED — platform mismatch needs review");
  assert(d.reason.includes("platform scope violation"), "reason explains violation");
});

await runTest("L7 usage decision: commercial context requires commercialUse", async () => {
  const d = library.decideUsage(
    { ...H.APPROVED_RIGHTS, commercialUse: false, status: "APPROVED", policyVersion: library.RIGHTS_POLICY_VERSION },
    { assetId: "a", projectId: "p", targetPlatforms: ["youtube"], commercialContext: "COMMERCIAL" }
  );
  assertEq(d.decision, "REVIEW_REQUIRED", "commercial blocked");
});

await runTest("L8 usage decision: expiry date enforced", async () => {
  const d = library.decideUsage(
    { ...H.APPROVED_RIGHTS, validForNewProjectsUntil: "2026-01-01T00:00:00Z", status: "APPROVED", policyVersion: library.RIGHTS_POLICY_VERSION },
    { assetId: "a", projectId: "p", targetPlatforms: ["youtube"], commercialContext: "STANDARD" }
  );
  assertEq(d.decision, "REVIEW_REQUIRED", "expired rights blocked");
});

await runTest("L9 usage decision: REJECTED stays REJECTED; unknown reuseScope fail-closed", async () => {
  const d1 = library.decideUsage({ ...H.APPROVED_RIGHTS, status: "REJECTED", policyVersion: "v" }, { assetId: "a", projectId: "p" });
  assertEq(d1.decision, "REJECTED", "REJECTED propagates");
  const d2 = library.decideUsage({ ...H.APPROVED_RIGHTS, reuseScope: "UNKNOWN", status: "APPROVED", policyVersion: "v" }, { assetId: "a", projectId: "p" });
  assertEq(d2.decision, "REVIEW_REQUIRED", "UNKNOWN scope fail-closed");
  const d3 = library.decideUsage(null, { assetId: "a", projectId: "p" });
  assertEq(d3.decision, "REVIEW_REQUIRED", "missing rights fail-closed");
});

await runTest("L10 happy path: APPROVED rights → APPROVED_FOR_PROJECT with evidence", async () => {
  const repo = H.makeTempRepo();
  const r = library.ingestMusicAsset({ bytes: H.makeMusicWav({ durationMs: 1000 }), metadata: { title: "x", sourceType: "USER_IMPORTED_LICENSED_ASSET" }, rights: H.APPROVED_RIGHTS, repoRoot: repo });
  const d = library.decideUsage(r.record.rights, { assetId: r.assetId, projectId: "p1", targetPlatforms: ["youtube"], commercialContext: "STANDARD" });
  assertEq(d.decision, "APPROVED_FOR_PROJECT", "approved");
  const rec = library.recordUsageDecision(repo, r.assetId, d);
  assert(rec.ok, "decision recorded on asset record");
});

await runTest("L11 search: INSTRUMENTAL_ONLY excludes LYRICAL_VOCAL; only APPROVED returned", async () => {
  const repo = H.makeTempRepo();
  library.ingestMusicAsset({ bytes: H.makeMusicWav({ durationMs: 10000, segments: [{ untilMs: 5000, energy: 0.2 }, { untilMs: 10000, energy: 0.8 }] }), metadata: { title: "inst", sourceType: "USER_IMPORTED_LICENSED_ASSET", mood: ["calm"], vocalType: "INSTRUMENTAL" }, rights: H.APPROVED_RIGHTS, repoRoot: repo });
  library.ingestMusicAsset({ bytes: H.makeMusicWav({ durationMs: 11000, freq: 330 }), metadata: { title: "vocal", sourceType: "USER_IMPORTED_LICENSED_ASSET", mood: ["calm"], vocalType: "LYRICAL_VOCAL" }, rights: H.APPROVED_RIGHTS, repoRoot: repo });
  library.ingestMusicAsset({ bytes: H.makeMusicWav({ durationMs: 12000, freq: 440 }), metadata: { title: "no-rights", sourceType: "USER_IMPORTED_LICENSED_ASSET", mood: ["calm"] }, rights: { ...H.APPROVED_RIGHTS, status: "REVIEW_REQUIRED" }, repoRoot: repo });
  const hits = library.searchLibrary(repo, { vocalPolicy: "INSTRUMENTAL_ONLY", mood: ["calm"] });
  assertEq(hits.length, 1, "only the approved instrumental survives");
  assertEq(hits[0].asset.title, "inst", "correct asset");
});

await runTest("L12 acquisition brief: schema-valid, disallowed sources listed", async () => {
  const r = library.buildAcquisitionBrief({
    projectId: "p1",
    needs: [{ narrativeRole: "EMOTION", mood: ["calm"], vocalPolicy: "INSTRUMENTAL_ONLY", targetCueDurationMs: 60000 }],
  });
  assert(r.ok, "brief valid: " + (r.message || ""));
  assertEq(r.brief.disallowedSources.join(","), "RANDOM_WEB,YOUTUBE_UPLOAD,UNKNOWN_REPO", "scraping sources disallowed");
  assert(r.brief.needs[0].needId, "need id assigned");
});

await runTest("L13 markUsed tracks reuse metrics", async () => {
  const repo = H.makeTempRepo();
  const r = library.ingestMusicAsset({ bytes: H.makeMusicWav({ durationMs: 1000 }), metadata: { title: "x", sourceType: "USER_IMPORTED_LICENSED_ASSET" }, rights: H.APPROVED_RIGHTS, repoRoot: repo });
  library.markUsed(repo, r.assetId);
  library.markUsed(repo, r.assetId);
  assertEq(library.getAsset(repo, r.assetId).reuseCount, 2, "reuseCount incremented");
});

console.log(`\n=== music-library: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
})();
