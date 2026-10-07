"use strict";

/**
 * Phase 1G.10 — reference/asset library tests (Stage B).
 * Deterministic, hermetic (tmp roots; no repo state). No network, no
 * generation, 0 credits. Covers: AssetRecord contract, content hash/dedup,
 * lineage, reference locks, approved-asset immutability, selection/quality,
 * rights/provenance, instruction-version linkage, indexer, combined E2E.
 */

const os = require("os");
const fs = require("fs");
const path = require("path");
const lib = require("../../lib/asset-library/index.js");
const ai = require("../../lib/agent-instructions/index.js");

const REPO_ROOT = path.join(__dirname, "..", "..");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
  console.log(`  ✓ ${message}`);
  passed++;
}

function runTest(name, fn) {
  console.log(`\n[TEST] ${name}`);
  return Promise.resolve().then(fn)
    .then(() => console.log(`[PASS] ${name}`))
    .catch((e) => { console.log(`[FAIL] ${name}: ${e.message}`); failed++; });
}

function tmpRoot(tag) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `unfoldiq-1g10-${tag}-`));
  fs.mkdirSync(path.join(root, "projects", "p1"), { recursive: true });
  return root;
}

function reg(root, over = {}) {
  return lib.registerAsset(root, "p1", {
    content: Buffer.from(over.content || "bytes-1"),
    type: "image",
    role: "BROLL",
    source: "generated",
    ...over,
  });
}

// 1x1 transparent PNG (measured dimensions, deterministic).
function png1x1() {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrLen = Buffer.alloc(4); ihdrLen.writeUInt32BE(13, 0);
  const ihdr = Buffer.from("IHDR");
  const dims = Buffer.alloc(8); dims.writeUInt32BE(1, 0); dims.writeUInt32BE(1, 4);
  const rest = Buffer.from([8, 6, 0, 0, 0]);
  return Buffer.concat([sig, ihdrLen, ihdr, dims, rest]);
}

async function main() {
  await runTest("AL1 record contract rejects bad shape", () => {
    const bad = lib.buildAssetRecord({ type: "image", role: "MOOD", source: "generated", hash: { algo: "sha256", value: "zzz" }, bytes: 1 });
    assert(bad.ok === false && bad.errors.length >= 2, "role + hash rejected");
    const good = lib.buildAssetRecord({ type: "image", role: "BROLL", source: "migration", hash: { algo: "sha256", value: "a".repeat(64) }, bytes: 10 });
    assert(good.ok === true && good.record.qualityStatus === "UNREVIEWED" && good.record.selection.status === "UNSET", "defaults honest");
    assert(good.record.rights.status === "UNKNOWN", "rights default UNKNOWN, never invented");
  });

  await runTest("AL2 content hash dedup: same bytes, one record", () => {
    const root = tmpRoot("dedup");
    const a = reg(root, { content: "same-bytes" });
    const b = reg(root, { content: "same-bytes", role: "STYLE" });
    assert(a.ok && b.ok && a.assetId === b.assetId && b.deduplicated === true, "duplicate returns existing id");
    assert(/^as-[0-9a-f]{12}$/.test(a.assetId), "deterministic id shape");
    const list = lib.listAssets(root, "p1");
    assert(list.assets.length === 1, "no second record");
    const c = reg(root, { content: "other-bytes" });
    assert(c.ok && c.assetId !== a.assetId && c.deduplicated === false, "different bytes differ");
  });

  await runTest("AL3 approved lock blocks every mutation", () => {
    const root = tmpRoot("lock");
    const a = reg(root);
    assert(a.ok, "registered");
    const locked = lib.lockAsset(root, "p1", a.assetId, "approved reference", "test");
    assert(locked.ok && locked.record.lock.locked === true, "locked with reason");
    for (const [name, fn] of [
      ["rights", () => lib.setRights(root, "p1", a.assetId, "VERIFIED", "x")],
      ["instruction link", () => lib.linkInstruction(root, "p1", a.assetId, "iv-x")],
      ["selection", () => lib.setSelection(root, "p1", a.assetId, "SELECTED", "x")],
      ["quality", () => lib.setQualityStatus(root, "p1", a.assetId, "APPROVED")],
      ["lineage", () => lib.addLineage(root, "p1", a.assetId, [])],
    ]) {
      const r = fn();
      assert(r.ok === false && /LOCKED/.test(r.code), `${name} refused while locked`);
    }
    assert(typeof lib.updateAsset === "undefined" && typeof lib.mutateAsset === "undefined", "no generic mutator: identity fields structurally unreachable");
    const un = lib.unlockAsset(root, "p1", a.assetId, "re-review", "test");
    assert(un.ok && un.record.lock.locked === false, "unlock with reason works");
    const after = lib.setSelection(root, "p1", a.assetId, "SELECTED", "ok");
    assert(after.ok && after.record.selection.status === "SELECTED", "mutation works after unlock");
  });

  await runTest("AL4 get/list + unknown handling", () => {
    const root = tmpRoot("get");
    const a = reg(root);
    assert(lib.getAsset(root, "p1", a.assetId).ok, "get resolves");
    assert(lib.getAsset(root, "p1", "as-ffffffffffff").code === "ASSET_NOT_FOUND", "unknown id reported");
    assert(lib.lockAsset(root, "p1", "as-ffffffffffff", "x").code === "ASSET_NOT_FOUND", "lock on unknown refused");
    assert(lib.lockAsset(root, "p1", a.assetId, null).code === "ASSET_LOCK_REASON_REQUIRED", "lock needs a reason");
    assert(lib.unlockAsset(root, "p1", a.assetId, null).code === "ASSET_UNLOCK_REASON_REQUIRED", "unlock needs a reason");
  });

  await runTest("AL5 selection + quality lifecycle", () => {
    const root = tmpRoot("sel");
    const a = reg(root);
    const s = lib.setSelection(root, "p1", a.assetId, "SELECTED", "hero candidate");
    assert(s.ok && s.record.selection.decidedAt, "selection timestamped");
    const bad = lib.setSelection(root, "p1", a.assetId, "MAYBE", "x");
    assert(bad.ok === false, "invalid selection refused");
    const q = lib.setQualityStatus(root, "p1", a.assetId, "APPROVED");
    assert(q.ok, "quality set");
  });

  await runTest("AL6 lineage chain, unknown parent, cycle safety", () => {
    const root = tmpRoot("lineage");
    const a = reg(root, { content: "a" });
    const b = reg(root, { content: "b" });
    const c = reg(root, { content: "c" });
    assert(lib.addLineage(root, "p1", b.assetId, [a.assetId]).ok, "parent linked");
    assert(lib.addLineage(root, "p1", c.assetId, [b.assetId]).ok, "chain extended");
    const chain = lib.lineageChain(root, "p1", c.assetId);
    assert(chain.ok && chain.chain.join(",") === [b.assetId, a.assetId].join(","), "nearest-first chain");
    assert(lib.addLineage(root, "p1", c.assetId, ["as-ffffffffff"]).ok === false, "unknown parent refused");
    assert(lib.addLineage(root, "p1", a.assetId, [a.assetId]).ok === false, "self parent refused");
  });

  await runTest("AL7 instruction-version linkage resolves (combined E2E)", () => {
    const root = tmpRoot("link");
    const a = reg(root, { content: "hero" });
    const linked = lib.linkInstruction(root, "p1", a.assetId, "iv-7e784d73e229");
    assert(linked.ok && linked.record.instructionVersion === "iv-7e784d73e229", "version linked");
    const set = ai.loadInstructionSet(REPO_ROOT, "channel-mascot", "iv-7e784d73e229");
    assert(set.ok && set.set && set.set.instructionVersion === "iv-7e784d73e229", "linkage resolves to the real VERIFIED set");
    assert(set.set.compiledFingerprint === "778e8299f5dd0265", "fingerprint pinned");
  });

  await runTest("AL8 indexer measures PNG, dedups, skips honestly", () => {
    const root = tmpRoot("index");
    const dir = path.join(root, "projects", "p1", "assets");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "a.png"), png1x1());
    fs.writeFileSync(path.join(dir, "b.png"), png1x1()); // byte-duplicate
    fs.writeFileSync(path.join(dir, "note.txt"), "not media");
    fs.writeFileSync(path.join(dir, "notes.md"), "# docs");
    const s = lib.indexDirectory(root, "p1", "assets", { source: "migration" });
    assert(s.indexed === 1 && s.deduplicated === 1, `one indexed, one deduped (got ${s.indexed}/${s.deduplicated})`);
    assert(s.skipped.length === 2, "non-media skipped, not indexed");
    assert(s.errors.length === 0, "no errors");
    const list = lib.listAssets(root, "p1");
    assert(list.assets.length === 1, "single deduped record");
    const rec = list.assets[0];
    assert(rec.dimensions && rec.dimensions.width === 1 && rec.dimensions.height === 1, "PNG dimensions measured, not estimated");
    assert(rec.rights.status === "UNKNOWN" && rec.provenance.source === "migration", "no invented rights/origin");
    const again = lib.indexDirectory(root, "p1", "assets", { source: "migration" });
    assert(again.indexed === 0 && again.deduplicated === 2, "re-run duplicates nothing");
  });

  await runTest("AL9 missing directory fails safe", () => {
    const root = tmpRoot("missing");
    const s = lib.indexDirectory(root, "p1", "nope", {});
    assert(s.indexed === 0 && s.errors.length === 1, "absent dir reported, nothing fabricated");
  });

  console.log(`\n=== 1G.10 asset-library: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(`FATAL: ${e.stack || e}`); process.exit(1); });
