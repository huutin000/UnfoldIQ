"use strict";

/**
 * Source Registry tests SR1-SR7 (Prompt 03, 1G.1G).
 * Deterministic fixtures. No network.
 */

const os = require("os");
const path = require("path");
const fs = require("fs");
const reg = require("../../lib/research-evidence/source-registry.js");
const store = require("../../lib/research-evidence/evidence-store.js");
const fx = require("../fixtures/evidence-fixtures.js");

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

async function main() {
  console.log("=== SOURCE REGISTRY TESTS (SR1-SR7) ===\n");

  await runTest("SR1 same canonical + same hash -> same logical source", async () => {
    const index = reg.emptyIndex("p1");
    const doc = fx.makeDoc("https://example.com/a?utm_source=x&utm_medium=y#frag", fx.BODY_A);
    const r1 = reg.registerSource(index, { acquiredDocument: doc, searchResult: fx.makeSearch("q", doc.finalUrl) });
    const r2 = reg.registerSource(index, { acquiredDocument: fx.makeDoc("https://example.com/a", fx.BODY_A) });
    assert(r1.ok && r1.created, "first registration creates");
    assert(r2.ok && r2.deduplicated && r2.record.sourceId === r1.record.sourceId, "same canonical+hash deduplicates");
    assert(index.sources.length === 1, "one logical source");
    assert(/^src-[0-9a-f]{12}$/.test(r1.record.sourceId), "stable sourceId format");
  });

  await runTest("SR2 same URL + changed hash -> new version, lineage kept", async () => {
    const index = reg.emptyIndex("p1");
    reg.registerSource(index, { acquiredDocument: fx.makeDoc("https://example.com/a", fx.BODY_A) });
    const changed = fx.makeDoc("https://example.com/a", `${fx.BODY_A} Update paragraph added later.`, { retrievedAt: "2026-10-03T10:00:00.000Z" });
    const r = reg.registerSource(index, { acquiredDocument: changed });
    assert(r.ok && r.versionAdded, "new version appended");
    assert(r.record.versions.length === 2, "two versions");
    assert(r.record.versions[1].supersedes === r.record.versions[0].contentHash, "supersedes lineage linked");
    assert(r.record.currentVersionHash === changed.contentHash, "current moved, history preserved");
  });

  await runTest("SR3 different URL + exact same hash -> duplicate signal", async () => {
    const index = reg.emptyIndex("p1");
    const a = reg.registerSource(index, { acquiredDocument: fx.makeDoc("https://a.example/orig", fx.BODY_A) });
    const b = reg.registerSource(index, { acquiredDocument: fx.makeDoc("https://b.example/copy", fx.BODY_B) });
    assert(a.record.contentHash === b.record.contentHash, "identical hashes");
    assert(a.record.sourceId !== b.record.sourceId, "distinct URL identities kept (no title-merge)");
  });

  await runTest("SR4 invalid source record rejected", async () => {
    const index = reg.emptyIndex("p1");
    const noUrl = reg.registerSource(index, { acquiredDocument: fx.makeDoc("not a url", fx.BODY_A) });
    assert(!noUrl.ok && noUrl.code === "SOURCE_RECORD_INVALID", "unusable URL rejected");
    const noHash = reg.registerSource(index, { acquiredDocument: { ...fx.makeDoc("https://example.com/x", fx.BODY_A), contentHash: "" } });
    assert(!noHash.ok && noHash.code === "SOURCE_RECORD_INVALID", "missing hash rejected");
  });

  await runTest("SR5 search provenance preserved", async () => {
    const index = reg.emptyIndex("p1");
    const doc = fx.makeDoc("https://example.com/a", fx.BODY_A);
    const r = reg.registerSource(index, { acquiredDocument: doc, searchResult: fx.makeSearch("308 method rule", doc.finalUrl, 2) });
    assert(r.record.searchQuery === "308 method rule", "query kept");
    assert(r.record.searchProvider === "agent-exchange", "provider kept");
    assert(r.record.searchRank === 2, "rank kept as discovery order");
  });

  await runTest("SR6 acquisition warnings preserved", async () => {
    const index = reg.emptyIndex("p1");
    const doc = { ...fx.makeDoc("https://example.com/a", fx.BODY_A), rawTruncated: true, fitMarkdown: "" };
    const r = reg.registerSource(index, { acquiredDocument: doc, acquisitionWarnings: ["browser/auth limitation (fixture)"] });
    assert(r.record.acquisitionWarnings.some((w) => /truncated/.test(w)), "truncation warning kept");
    assert(r.record.acquisitionWarnings.some((w) => /fitMarkdown empty/.test(w)), "weak-fit warning kept");
    assert(r.record.acquisitionWarnings.includes("browser/auth limitation (fixture)"), "caller warning kept");
  });

  await runTest("SR7 refs without duplicating bodies + conservative typing", async () => {
    const index = reg.emptyIndex("p1");
    const r = reg.registerSource(index, { acquiredDocument: fx.makeDoc("https://example.com/a", fx.BODY_A) });
    assert(r.record.versions[0].rawContentRef.includes(r.record.sourceId), "body stored by ref under source id");
    assert(!("rawBody" in r.record), "no full body duplicated in record");
    assert(r.record.sourceType === "UNKNOWN", "uncertain authority stays UNKNOWN, not fabricated");
    assert(typeof r.record.classificationReason === "string", "explainable reason present");
    const official = reg.registerSource(reg.emptyIndex("p2"), {
      acquiredDocument: fx.makeDoc("https://www.ietf.org/rfc.html", fx.BODY_A),
      officialDomains: ["ietf.org"],
    });
    assert(official.record.sourceType === "OFFICIAL", "configured official domain classifies with reason");
  });

  await runTest("SR8 atomic persist + reload round-trip", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "unfoldiq-ev-"));
    try {
      const index = reg.emptyIndex("p9");
      const doc = fx.makeDoc("https://example.com/a", fx.BODY_A);
      reg.registerSource(index, { acquiredDocument: doc });
      const saved = reg.persistRegistry(root, "p9", index, { [doc.contentHash]: doc.rawMarkdown });
      assert(saved.ok, "persist ok");
      const loaded = reg.loadRegistry(root, "p9");
      assert(loaded.ok && loaded.index.sources.length === 1, "reload round-trips");
      assert(store.validateEvidenceFile("index", loaded.index) === true, "persisted index schema-valid");
      const bodyPath = path.join(root, "projects", "p9", index.sources[0].versions[0].rawContentRef);
      assert(fs.readFileSync(bodyPath, "utf8") === fx.BODY_A, "body artifact stored once by ref");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  console.log(`\n=== SUMMARY ===`);
  console.log(`Passed assertions: ${passed}, Failed tests: ${failed}`);
  if (failed > 0) { console.log("RESULT: SOME TESTS FAILED"); process.exit(1); }
  console.log("RESULT: ALL TESTS PASSED");
}

main().catch((e) => { console.log(`[FAIL] harness: ${e.message}`); process.exit(1); });
