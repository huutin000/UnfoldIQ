"use strict";

/**
 * Independence gate tests I1-I5 (Prompt 03, 1G.1H).
 * Deterministic fixtures. No network.
 */

const reg = require("../../lib/research-evidence/source-registry.js");
const ind = require("../../lib/research-evidence/independence.js");
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

function buildIndex() {
  const index = reg.emptyIndex("pi");
  const a = reg.registerSource(index, { acquiredDocument: fx.makeDoc("https://a.example/orig", fx.BODY_A, { metadata: { publisher: "City Gazette" } }) });
  const b = reg.registerSource(index, { acquiredDocument: fx.makeDoc("https://b.example/copy", fx.BODY_B, { metadata: { publisher: "Metro Mirror" } }) });
  const c = reg.registerSource(index, { acquiredDocument: fx.makeDoc("https://c.example/rewrite", fx.BODY_C, { metadata: { publisher: "Metro Mirror" } }) });
  return { index, ids: [a.record.sourceId, b.record.sourceId, c.record.sourceId] };
}

function bodiesABC() {
  const index = reg.emptyIndex("pi");
  const recs = [
    reg.registerSource(index, { acquiredDocument: fx.makeDoc("https://a.example/orig", fx.BODY_A) }).record,
    reg.registerSource(index, { acquiredDocument: fx.makeDoc("https://b.example/copy", fx.BODY_B) }).record,
    reg.registerSource(index, { acquiredDocument: fx.makeDoc("https://c.example/rewrite", fx.BODY_C) }).record,
  ];
  return { records: recs, bodies: { [recs[0].sourceId]: fx.BODY_A, [recs[1].sourceId]: fx.BODY_B, [recs[2].sourceId]: fx.BODY_C } };
}

async function main() {
  console.log("=== INDEPENDENCE TESTS (I1-I5) ===\n");

  await runTest("I1 exact duplicate across 3 URLs is NOT 3 independent", async () => {
    const index = reg.emptyIndex("pi");
    const urls = ["https://a.example/1", "https://b.example/2", "https://c.example/3"];
    const recs = urls.map((u) => reg.registerSource(index, { acquiredDocument: fx.makeDoc(u, fx.BODY_A) }).record);
    const bodies = {};
    for (const r of recs) bodies[r.sourceId] = fx.BODY_A;
    ind.evaluateIndependence(recs, bodies);
    assert(recs.every((r) => r.independenceStatus === "COPY_CHAIN"), "all three COPY_CHAIN");
    assert(new Set(recs.map((r) => r.originGroup)).size === 1, "one shared origin group");
    assert(ind.countIndependentGroups(recs, recs.map((r) => r.sourceId)) === 0, "zero independent groups counted");
  });

  await runTest("I2 near-duplicate syndicated copies detected", async () => {
    const { records, bodies } = bodiesABC();
    ind.evaluateIndependence(records, bodies);
    const byId = Object.fromEntries(records.map((r) => [r.sourceId, r]));
    const ids = Object.keys(bodies);
    const ab = ind.judgePair(byId[ids[0]], byId[ids[1]], bodies);
    assert(ab.status === "COPY_CHAIN", `exact A~B is COPY_CHAIN (${ab.status})`);
    const ac = ind.judgePair(records[0], records[2], bodies);
    assert(["DERIVED", "SYNDICATED", "COPY_CHAIN"].includes(ac.status), `near-duplicate A~C flagged (${ac.status}, sim ${ac.similarity})`);
    assert(ind.countIndependentGroups(records, ids) <= 1, "copy chain never yields multi-source count");
  });

  await runTest("I3 explicit origin link captures derivation", async () => {
    const index = reg.emptyIndex("pi");
    const orig = reg.registerSource(index, { acquiredDocument: fx.makeDoc("https://a.example/orig", fx.BODY_A) }).record;
    const derivedBody = `${fx.BODY_D} Originally published at https://a.example/orig with permission.`;
    const der = reg.registerSource(index, { acquiredDocument: fx.makeDoc("https://d.example/derived", derivedBody) }).record;
    const verdict = ind.judgePair(orig, der, { [orig.sourceId]: fx.BODY_A, [der.sourceId]: derivedBody });
    assert(verdict.status === "DERIVED", `citation captured (${verdict.status})`);
    assert(typeof verdict.originGroup === "string", "origin group assigned");
  });

  await runTest("I4 genuinely separate fixtures are INDEPENDENT-eligible", async () => {
    const index = reg.emptyIndex("pi");
    const a = reg.registerSource(index, { acquiredDocument: fx.makeDoc("https://a.example/orig", fx.BODY_A, { metadata: { publisher: "City Gazette" } }) }).record;
    const d = reg.registerSource(index, { acquiredDocument: fx.makeDoc("https://d.example/other", fx.BODY_D, { metadata: { publisher: "Net Journal" } }) }).record;
    const verdict = ind.judgePair(a, d, { [a.sourceId]: fx.BODY_A, [d.sourceId]: fx.BODY_D });
    assert(verdict.status === "INDEPENDENT", `separate coverage is INDEPENDENT (${verdict.status}, sim ${verdict.similarity})`);
    ind.evaluateIndependence([a, d], { [a.sourceId]: fx.BODY_A, [d.sourceId]: fx.BODY_D });
    assert(ind.countIndependentGroups([a, d], [a.sourceId, d.sourceId]) === 2, "two independent groups counted");
  });

  await runTest("I5 uncertain case stays UNKNOWN, domains alone never suffice", async () => {
    const index = reg.emptyIndex("pi");
    const s1 = reg.registerSource(index, { acquiredDocument: fx.makeDoc("https://a.example/x", fx.BODY_SHORT) }).record;
    const s2 = reg.registerSource(index, { acquiredDocument: fx.makeDoc("https://b.example/y", fx.BODY_SHORT) }).record;
    const verdict = ind.judgePair(s1, s2, { [s1.sourceId]: fx.BODY_SHORT, [s2.sourceId]: fx.BODY_SHORT });
    // identical short stubs share exact bytes only if hashes match; here they do match (same text)
    assert(verdict.status === "COPY_CHAIN" || verdict.status === "UNKNOWN", `short identical stubs not INDEPENDENT (${verdict.status})`);
    const t1 = reg.registerSource(index, { acquiredDocument: fx.makeDoc("https://a.example/p", `${fx.BODY_SHORT} alpha`) }).record;
    const t2 = reg.registerSource(index, { acquiredDocument: fx.makeDoc("https://b.example/q", `${fx.BODY_SHORT} beta`) }).record;
    const v2 = ind.judgePair(t1, t2, { [t1.sourceId]: `${fx.BODY_SHORT} alpha`, [t2.sourceId]: `${fx.BODY_SHORT} beta` });
    assert(v2.status === "UNKNOWN", `thin content stays UNKNOWN even on different domains (${v2.status})`);
  });

  await runTest("I6 bare hyperlink is referencing, not derivation", async () => {
    const index = reg.emptyIndex("pi");
    const a = reg.registerSource(index, { acquiredDocument: fx.makeDoc("https://a.example/orig", fx.BODY_A) }).record;
    const linkerBody = `${fx.BODY_D} See also the specification at https://a.example/orig for normative details. References: https://a.example/orig.`;
    const b = reg.registerSource(index, { acquiredDocument: fx.makeDoc("https://b.example/guide", linkerBody) }).record;
    const verdict = ind.judgePair(a, b, { [a.sourceId]: fx.BODY_A, [b.sourceId]: linkerBody });
    assert(verdict.status === "INDEPENDENT", `mere hyperlink does not imply derivation (${verdict.status})`);
  });

  console.log(`\n=== SUMMARY ===`);
  console.log(`Passed assertions: ${passed}, Failed tests: ${failed}`);
  if (failed > 0) { console.log("RESULT: SOME TESTS FAILED"); process.exit(1); }
  console.log("RESULT: ALL TESTS PASSED");
}

main().catch((e) => { console.log(`[FAIL] harness: ${e.message}`); process.exit(1); });
