"use strict";
// STEP-12 Branch C — asset-stager tests AS1-AS10 via stageAssets with real files.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..", "..");
const Stager = require("../../lib/asset-stager.js");
const RenderErrors = require("../../lib/render-errors.js");

const PID = "__12_as__";
const PROJDIR = path.join(ROOT, "projects", PID);

let passed = 0;
let failed = 0;
function runTest(name, fn) {
  console.log("[TEST] " + name);
  try {
    fn();
    console.log("[PASS] " + name);
    passed++;
  } catch (e) {
    console.log("[FAIL] " + name + ": " + ((e && e.stack) || (e && e.message) || String(e)));
    failed++;
  }
}
function assert(c, m) { if (!c) throw new Error("ASSERT: " + m); }

function setup() {
  try { fs.rmSync(PROJDIR, { recursive: true, force: true }); } catch (e) {}
  try { Stager.cleanStale({ projectRoot: ROOT, projectId: PID }); } catch (e) {}
  fs.mkdirSync(path.join(PROJDIR, "assets"), { recursive: true });
  fs.writeFileSync(path.join(PROJDIR, "assets", "a.png"), Buffer.from([1, 2, 3, 4, 5]));
  fs.writeFileSync(path.join(PROJDIR, "assets", "b.png"), Buffer.from([9, 9, 9, 9, 9]));
  fs.writeFileSync(path.join(PROJDIR, "assets", "v.wav"), Buffer.from([7, 7, 7, 7]));
}
function teardown() {
  try { fs.rmSync(PROJDIR, { recursive: true, force: true }); } catch (e) {}
  try { Stager.cleanStale({ projectRoot: ROOT, projectId: PID }); } catch (e) {}
}
function expectStageFailed(fn, label) {
  let err = null;
  try { fn(); } catch (e) { err = e; }
  assert(err, label + ": expected throw");
  assert(RenderErrors.isRenderError(err) && err.code === "ASSET_STAGE_FAILED",
    label + ": expected ASSET_STAGE_FAILED, got " + (err && (err.code || err.message)));
}

setup();

runTest("AS1 stages ok with real fixture file", () => {
  const entries = Stager.stageAssets({ projectRoot: ROOT, projectId: PID,
    assets: [{ assetId: "A1", sourcePath: "assets/a.png", type: "image" }] });
  assert(entries.length === 1, "one entry");
  assert(entries[0].assetId === "A1", "assetId");
  const abs = path.resolve(ROOT, entries[0].stagedPath.split("/").join(path.sep).replace(/^unfoldiq\//, "remotion/public/unfoldiq/"));
  // stagedPath is relative to public root; resolve via remotion/public
  const abs2 = path.resolve(ROOT, "remotion", "public", entries[0].stagedPath.split("/").join(path.sep));
  assert(fs.statSync(abs2).isFile(), "staged file exists at " + abs2);
  console.log("  stagedPath=" + entries[0].stagedPath);
});

runTest("AS2 traversal ../../evil.png rejected", () => {
  expectStageFailed(() => Stager.stageAssets({ projectRoot: ROOT, projectId: PID,
    assets: [{ assetId: "EVIL", sourcePath: "../../evil.png", type: "image" }] }), "AS2");
});

runTest("AS3 absolute outside path rejected", () => {
  const abs = process.platform === "win32" ? "C:\\Windows\\evil.png" : "/etc/evil.png";
  expectStageFailed(() => Stager.stageAssets({ projectRoot: ROOT, projectId: PID,
    assets: [{ assetId: "ABS", sourcePath: abs, type: "image" }] }), "AS3");
});

runTest("AS4 hash deterministic (same bytes twice equal)", () => {
  const h1 = Stager.hashBytes(Buffer.from([1, 2, 3]));
  const h2 = Stager.hashBytes(Buffer.from([1, 2, 3]));
  assert(h1 === h2, "hash equal");
  assert(h1.length === 64, "sha256 hex length");
  console.log("  hash=" + h1.slice(0, 16) + "...");
});

runTest("AS5 same content reuses stagedPath", () => {
  const a = Stager.stageAssets({ projectRoot: ROOT, projectId: PID,
    assets: [{ assetId: "A1", sourcePath: "assets/a.png", type: "image" }] });
  const b = Stager.stageAssets({ projectRoot: ROOT, projectId: PID,
    assets: [{ assetId: "A1", sourcePath: "assets/a.png", type: "image" }] });
  assert(a[0].stagedPath === b[0].stagedPath, "stagedPath reused: " + a[0].stagedPath);
});

runTest("AS6 different bytes give different hash dir", () => {
  const a = Stager.stageAssets({ projectRoot: ROOT, projectId: PID,
    assets: [{ assetId: "A1", sourcePath: "assets/a.png", type: "image" }] });
  const b = Stager.stageAssets({ projectRoot: ROOT, projectId: PID,
    assets: [{ assetId: "B1", sourcePath: "assets/b.png", type: "image" }] });
  assert(a[0].stagedPath !== b[0].stagedPath, "different content -> different stagedPath");
  console.log("  a=" + a[0].stagedPath + " b=" + b[0].stagedPath);
});

runTest("AS7 source mtime/bytes unchanged by staging", () => {
  const src = path.join(PROJDIR, "assets", "a.png");
  const before = fs.readFileSync(src);
  const stBefore = fs.statSync(src);
  Stager.stageAssets({ projectRoot: ROOT, projectId: PID,
    assets: [{ assetId: "A1", sourcePath: "assets/a.png", type: "image" }] });
  const after = fs.readFileSync(src);
  const stAfter = fs.statSync(src);
  assert(Buffer.compare(before, after) === 0, "bytes unchanged");
  assert(stBefore.mtimeMs === stAfter.mtimeMs, "mtime unchanged");
});

runTest("AS8 cleanStale removes only managed root (decoy outside survives)", () => {
  Stager.stageAssets({ projectRoot: ROOT, projectId: PID,
    assets: [{ assetId: "A1", sourcePath: "assets/a.png", type: "image" }] });
  const decoy = path.resolve(ROOT, "remotion", "public", "unfoldiq-decoy-keep.txt");
  fs.writeFileSync(decoy, "decoy");
  const res = Stager.cleanStale({ projectRoot: ROOT, projectId: PID });
  assert(res.removed === 1, "removed count 1");
  assert(fs.existsSync(decoy), "decoy outside managed root survives");
  const target = path.resolve(ROOT, "remotion", "public", "unfoldiq", PID);
  assert(!fs.existsSync(target), "managed root removed");
  fs.rmSync(decoy, { force: true });
});

runTest("AS9 manifest entries have all 7 fields", () => {
  const entries = Stager.stageAssets({ projectRoot: ROOT, projectId: PID,
    assets: [{ assetId: "A1", sourcePath: "assets/a.png", type: "image" }] });
  const e = entries[0];
  ["assetId", "sourcePath", "stagedPath", "staticFilePath", "contentHash", "size", "type"].forEach((k) => {
    assert(e[k] !== undefined, "field " + k + " present");
  });
  console.log("  entry=" + JSON.stringify(e));
});

runTest("AS10 staticFilePath inside public root (startsWith unfoldiq/)", () => {
  const entries = Stager.stageAssets({ projectRoot: ROOT, projectId: PID,
    assets: [{ assetId: "A1", sourcePath: "assets/a.png", type: "image" }] });
  assert(entries[0].staticFilePath.indexOf("unfoldiq/") === 0,
    "startsWith unfoldiq/, got " + entries[0].staticFilePath);
});

teardown();

console.log("\n=== SUMMARY test-asset-stager AS1-AS10 ===");
console.log("passed=" + passed + " failed=" + failed);
console.log(failed === 0 ? "RESULT: PASS" : "RESULT: FAIL");
process.exit(failed === 0 ? 0 : 1);
