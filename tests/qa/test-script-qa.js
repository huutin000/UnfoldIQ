"use strict";

/**
 * Script QA: generic number verifier, ledger-driven constraints, golden
 * regression (real GPS draft v1/v2 errors + positive false-positive guards),
 * topic-agnosticism, verdict gating, and wiring of existing capabilities.
 * No provider, no model, no network.
 */

const fs = require("fs");
const path = require("path");

const REPO = path.join(__dirname, "..", "..");
const numbers = require(REPO + "/lib/script-qa/numbers.js");
const { runScriptQa, deterministic } = require(REPO + "/lib/script-qa/index.js");
const { runGolden } = require(REPO + "/lib/script-qa/golden.js");
const FIX = path.join(REPO, "tests", "fixtures", "script-qa");
const ledger = JSON.parse(fs.readFileSync(path.join(FIX, "ledger.json"), "utf8"));
const golden = JSON.parse(fs.readFileSync(path.join(FIX, "golden-cases.json"), "utf8"));

let passed = 0;
let failed = 0;
function assert(c, m) {
  if (!c) throw new Error("ASSERTION FAILED: " + m);
  console.log("  ok  " + m);
}
function runTest(name, fn) {
  console.log("[TEST] " + name);
  try { fn(); passed += 1; console.log("[PASS] " + name); }
  catch (e) { failed += 1; console.log("[FAIL] " + name + " - " + e.message); }
}

const verdictOf = (spoken, evidenceText) => numbers.matchQuantity(numbers.spokenQuantities(spoken)[0], numbers.evidenceAllQuantities(evidenceText)).verdict;

runTest("spoken numbers: words, decimals, fractions, units and qualifiers", () => {
  const q = (t) => numbers.spokenQuantities(t)[0];
  assert(q("twenty thousand two hundred kilometers").base === 20200000, "20,200 km in meters");
  assert(Math.abs(q("seven hundredths of a second").base - 0.07) < 1e-9 && q("seven hundredths of a second").dimension === "time", "seven hundredths of a second");
  assert(q("about four and a half parts in ten billion").dimension === "fraction", "parts in ten billion");
  assert(q("at least twenty-four satellites").qualifier === "lower", "at least is a lower bound");
  assert(numbers.spokenQuantities("three circles meet").length === 0, "small unitless counts are structure, not claims");
  assert(numbers.spokenQuantities("on one day in 2021").every((x) => x.kind === "year"), "'one day' is a calendar reference");
});

runTest("matching policy: rounding, bounds, coarse approximation, mismatch", () => {
  assert(verdictOf("about five meters", "typically accurate to within a 4.9 m radius") === "MATCH", "5 matches 4.9 at one significant figure");
  assert(verdictOf("under one meter", "was 0.643 m") === "MATCH_QUALIFIED", "upper bound satisfied");
  assert(verdictOf("at most two meters", "of 2.0 m") === "MATCH", "exact");
  assert(verdictOf("about a tenth of a second", "zenith 0.0674 s") === "COARSE", "0.1 vs 0.0674 is a coarse approximation (review)");
  assert(verdictOf("about a tenth of a second", "about 3 meters") === "NO_EVIDENCE", "no time quantity in evidence");
  assert(verdictOf("about nine kilometers", "up to about 11 kilometers") === "COARSE", "18% off is coarse, not a pass");
  assert(verdictOf("about nine hundred kilometers", "up to about 11 kilometers") === "MISMATCH", "far off is a mismatch");
  assert(verdictOf("every two hours", "approximately every two hours") === "MATCH", "numbers written as words in evidence are read");
});

runTest("golden regression from real GPS draft v1/v2 errors and positive guards", () => {
  const r = runGolden(golden.cases, ledger);
  for (const x of r.results) assert(x.pass, `${x.id} (${x.kind}) found=[${x.found.join(",")}] missing=[${x.missing}] unexpected=[${x.unexpected}]`);
  assert(r.summary.negativeDetected === "10/10" && r.summary.falsePositives.length === 0, "all negatives detected, no false positives");
  assert(r.summary.knownFalseNegatives.length === 2, "two documented editorial-only limitations");
});

runTest("engine is topic-agnostic: a different topic works with only ledger data", () => {
  const other = {
    sources: [{ id: "SRC1", title: "t" }],
    claims: {
      C1: { status: "SUPPORTED", evidence: [{ src: "SRC1", quote: "The summit is 8,849 meters above sea level." }], forbidden: ["tallest mountain in the solar system"], caveats: [{ trigger: "highest", requires: "above sea level", note: "say relative to sea level" }] },
    },
  };
  const good = deterministic([{ id: "A", text: "The summit is about eight thousand eight hundred forty-nine meters above sea level.", evidence: "C1 (SRC1)", visual: "D" }], other, {});
  assert(!good.some((f) => f.status === "FAIL"), "matching number passes");
  const bad = deterministic([{ id: "B", text: "It is the tallest mountain in the solar system, about nine thousand kilometers high.", evidence: "C1 (SRC1)", visual: "D" }], other, {});
  assert(bad.some((f) => f.code === "FORBIDDEN_BY_LEDGER") && bad.some((f) => f.code === "NUMBER_NOT_IN_EVIDENCE"), "forbidden phrase and wrong number flagged");
  const cav = deterministic([{ id: "C", text: "It is the highest point on Earth.", evidence: "C1 (SRC1)", visual: "D" }], other, {});
  assert(cav.some((f) => f.code === "MISSING_CAVEAT"), "ledger caveat enforced");
  const src = fs.readdirSync(path.join(REPO, "lib", "script-qa")).map((f) => fs.readFileSync(path.join(REPO, "lib", "script-qa", f), "utf8")).join("\n");
  assert(!/\b(GPS|pseudorange|relativity|satellite|trilateration)\b/i.test(src), "no GPS vocabulary inside lib/script-qa");
});

runTest("verdict gating: nothing certifies itself", () => {
  const scenes = [{ id: "S1", text: "The summit is about eight thousand eight hundred forty-nine meters above sea level. It stands alone.", evidence: "C1 (SRC1)", visual: "D" }];
  const led = { sources: [{ id: "SRC1" }], claims: { C1: { status: "SUPPORTED", evidence: [{ src: "SRC1", quote: "The summit is 8,849 meters above sea level." }] } } };
  const long = { wordsPerSecond: 0.1, minSeconds: 1 };
  let r = runScriptQa({ scenes, ledger: led, options: long });
  assert(r.verdict === "REVIEW_REQUIRED" && r.requirements.some((x) => x.id === "DURATION_MEASURED" && !x.met), "estimated duration alone keeps REVIEW_REQUIRED");
  r = runScriptQa({ scenes, ledger: led, options: { ...long, durationBasis: "MEASURED", goldenPassed: true } });
  assert(r.verdict === "READY_FOR_LOCK" || r.open.every((k) => !/FAIL/.test(k)), "clean script with measured duration and golden proof can be READY (or only has reviews)");
  const failScene = [{ id: "S1", text: "The summit is about nine thousand kilometers.", evidence: "C1 (SRC1)", visual: "D" }];
  r = runScriptQa({ scenes: failScene, ledger: led, options: { ...long, durationBasis: "MEASURED", goldenPassed: true } });
  assert(r.verdict === "FAIL", "a wrong number fails regardless of other proofs");
  // an editorial finding by the same model family cannot clear a deterministic FAIL
  r = runScriptQa({ scenes: failScene, ledger: led, editorial: [{ id: "E1", scene: "S1", severity: "P2", status: "RESOLVED", text: "looks fine", assessor: { type: "MODEL", independent: false } }], options: { ...long, durationBasis: "MEASURED", goldenPassed: true } });
  assert(r.verdict === "FAIL", "editorial RESOLVED does not override a deterministic FAIL");
  // open editorial P1 blocks even when everything else is clean
  r = runScriptQa({ scenes, ledger: led, editorial: [{ id: "E2", scene: "S1", severity: "P1", status: "OPEN", text: "framing implies X", assessor: { type: "MODEL", independent: false } }], options: { ...long, durationBasis: "MEASURED", goldenPassed: true } });
  assert(r.verdict === "REVIEW_REQUIRED" && r.open.includes("EDITORIAL:E2"), "open editorial P1 blocks the lock");
  // REVIEW findings need an explicit accepted disposition with a reason
  const rv = runScriptQa({ scenes: [{ id: "S2", text: "It always works.", evidence: "C1 (SRC1)", visual: "D" }], ledger: led, options: { ...long, durationBasis: "MEASURED", goldenPassed: true } });
  const key = rv.findings.find((f) => f.code === "ABSOLUTE_LANGUAGE").key;
  assert(rv.verdict === "REVIEW_REQUIRED", "absolute language is REVIEW until dispositioned");
  const rv2 = runScriptQa({ scenes: [{ id: "S2", text: "It always works.", evidence: "C1 (SRC1)", visual: "D" }], ledger: led, dispositions: { [key]: { decision: "ACCEPT", reason: "rhetorical" } }, options: { ...long, durationBasis: "MEASURED", goldenPassed: true } });
  assert(!rv2.open.includes(key), "accepted disposition with a reason closes the finding");
});

runTest("existing capabilities are actually invoked (naturalness, retention, routing)", () => {
  const led = { sources: [{ id: "SRC1" }], claims: { C1: { status: "SUPPORTED", evidence: [{ src: "SRC1", quote: "Water boils at 100 degrees Celsius at sea level pressure." }] } } };
  const text = ["So water boils.", "So the pot heats.", "So steam rises.", "So the lid shakes."];
  const scenes = text.map((t, i) => ({ id: "S" + (i + 1), text: t + " It happens at sea level pressure in the kitchen every day.", evidence: "C1 (SRC1)", visual: i === 0 ? "" : "D" }));
  const r = runScriptQa({ scenes, ledger: led, options: { wordsPerSecond: 1, minSeconds: 1 } });
  const classes = new Set(r.findings.map((f) => f.class + ":" + f.checker));
  assert([...classes].some((c) => c.includes("spoken-script.evaluateNaturalness")), "naturalness check ran and reported repetitive openings");
  assert(r.findings.some((f) => f.code === "NO_VISUAL_ROUTE" && f.checker === "visual-motion.routing"), "visual routing check ran");
  assert(r.findings.some((f) => f.class === "EXISTING_CAPABILITY"), "existing-capability findings are labelled as such");
});

console.log(`\n=== script-qa: ${failed} failed, ${passed} passed ===`);
process.exit(failed > 0 ? 1 : 0);
